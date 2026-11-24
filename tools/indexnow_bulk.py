#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
indexnow_bulk.py — IndexNow 批量推送脚本（深夜文库 shenye.72tool.com）

用途：
  从线上 sitemap 索引自动展开全部子 sitemap，解析出 URL + lastmod，
  按批次推送给 IndexNow 参与引擎，并持久化"已推送"状态以支持断点续推。

关键事实（据 indexnow.org 官方 FAQ）：
  - 单个 POST 最多 10,000 个 URL（本脚本默认 5000 更稳，可用 --batch-size 调）
  - 200=接受，202=已排队（首次请求常见，之后多为 200）
  - 向任一参与端点提交，会被共享给所有启用 IndexNow 的引擎
    → 默认只推 global + bing 即可，无需 7 个端点全推

数据源（--source）：
  sitemap  从线上 sitemap.xml 索引展开全部子文件（默认，最新）
  local    从本地 sitemap 目录读取（离线可用，但本地可能是旧版）
  file     从纯文本 URL 列表读取（每行一个 URL）
  promo    从 promo/out.json 的 indexnowUrls 读取（沿用旧脚本增量）

典型用法：
  # 1) 先看会推什么，不实际发送（强烈建议先跑这个）
  python tools/indexnow_bulk.py --dry-run

  # 2) 小样本真实试推 20 条（均匀抽样，验证 key 生效）
  python tools/indexnow_bulk.py --max-urls 20 --endpoints global

  # 3) 只推主站页面（书页+静态页，约 1500 条），不推 10 万章节
  python tools/indexnow_bulk.py --only-main

  # 4) 只推最近 30 天有更新的 URL（依赖 sitemap 里的 lastmod）
  python tools/indexnow_bulk.py --since-days 30

  # 5) 全量推送（10万+，约 20+ 批；默认已推过的会自动跳过）
  python tools/indexnow_bulk.py

  # 6) 重置已推记录，强制全量重推
  python tools/indexnow_bulk.py --reset-state

依赖：仅 Python 3 标准库，无需 pip install。
"""

import argparse
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

SITE = 'https://shenye.72tool.com'
HOST = 'shenye.72tool.com'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_FILE = os.path.join(ROOT, 'indexnow-key.txt')
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.indexnow_state.json')
PROMO_FILE = os.path.join(ROOT, 'promo', 'out.json')
SITEMAP_INDEX = SITE + '/sitemap.xml'

# 官方参与端点（一次提交共享给全部引擎，故默认只推 global+bing）
ENDPOINTS = {
    'global': 'https://api.indexnow.org/indexnow',
    'bing':   'https://www.bing.com/indexnow',
    'yandex': 'https://yandex.com/indexnow',
    'seznam': 'https://search.seznam.cz/indexnow',
    'naver':  'https://searchadvisor.naver.com/indexnow',
    'yep':    'https://indexnow.yep.com/indexnow',
    'amazon': 'https://indexnow.amazonbot.amazon/indexnow',
}

UA = 'Mozilla/5.0 (compatible; ShenyeIndexNow/1.0)'


def log(*a):
    print('[indexnow]', *a, flush=True)


# ---------- 状态（去重 / 断点续推） ----------
def load_state(path, reset=False):
    if reset:
        return {'version': 1, 'updatedAt': None, 'pushed': []}
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict) and isinstance(d.get('pushed'), list):
            return d
    except Exception:
        pass
    return {'version': 1, 'updatedAt': None, 'pushed': []}


def save_state(path, state):
    state['updatedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, path)


def url_hash(url):
    return hashlib.md5(url.encode('utf-8')).hexdigest()[:16]


# ---------- 读取 key ----------
def load_key(cli_key=''):
    key = (cli_key or '').strip()
    if not key:
        try:
            key = open(KEY_FILE, encoding='utf-8').read().strip()
        except Exception:
            key = ''
    # 官方规则：8~128 位，字母数字和连字符
    import re
    if not re.fullmatch(r'[a-zA-Z0-9-]{8,128}', key):
        raise SystemExit('[indexnow] 无效 key（需 8-128 位字母/数字/连字符）: %r' % key)
    return key


# ---------- 网络 ----------
def http_get(url, timeout=40, retries=3):
    """带重试的 GET：国内访问 CF 偶发超时，重试几次确保拉全"""
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
            if data[:2] == b'\x1f\x8b':  # gzip
                data = gzip.decompress(data)
            return data.decode('utf-8', errors='replace')
        except Exception as e:
            last = e
            if attempt < retries:
                time.sleep(1 + attempt * 2)
    raise last


def post_batch(endpoint, payload, timeout=90):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(endpoint, data=body, method='POST', headers={
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': UA,
        'Content-Length': str(len(body)),
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', errors='replace')[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')[:200]
    except Exception as e:
        return -1, str(e)[:200]


# ---------- sitemap 解析 ----------
def parse_sitemap_urls(xml_text):
    """返回 [(loc, lastmod或'')]"""
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return []
    out = []
    tag = root.tag.lower()
    if 'sitemapindex' in tag:
        for sm in root:
            loc = lastmod = ''
            for c in sm:
                if c.tag.endswith('loc'):
                    loc = (c.text or '').strip()
                elif c.tag.endswith('lastmod'):
                    lastmod = (c.text or '').strip()
            if loc:
                out.append((loc, lastmod))
    else:
        for u in root:
            loc = lastmod = ''
            for c in u:
                if c.tag.endswith('loc'):
                    loc = (c.text or '').strip()
                elif c.tag.endswith('lastmod'):
                    lastmod = (c.text or '').strip()
            if loc:
                out.append((loc, lastmod))
    return out


def collect_from_sitemap(workers=8, only_main=False, local_dir=None):
    if local_dir:
        index_path = os.path.join(local_dir, 'sitemap.xml')
        index_xml = open(index_path, encoding='utf-8').read()
        def fetch(loc):
            fn = os.path.join(local_dir, os.path.basename(loc))
            return open(fn, encoding='utf-8').read()
    else:
        index_xml = http_get(SITEMAP_INDEX + '?t=' + str(int(time.time())))
        def fetch(loc):
            return http_get(loc + ('&' if '?' in loc else '?') + 't=' + str(int(time.time())))

    children = [loc for loc, _ in parse_sitemap_urls(index_xml)]
    if only_main:
        children = [c for c in children if 'sitemap-main' in c or 'main' in c.lower()]
    log(f'索引含 {len(children)} 个子 sitemap' + ('（仅 main）' if only_main else ''))

    pairs = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fetch, c): c for c in children}
        for fut in as_completed(futs):
            c = futs[fut]
            try:
                items = parse_sitemap_urls(fut.result())
                pairs.extend(items)
                log(f'  {os.path.basename(c)}: {len(items)} URL')
            except Exception as e:
                log(f'  警告 {os.path.basename(c)} 读取失败: {e}')
    return pairs


def collect_from_file(path):
    urls = []
    for line in open(path, encoding='utf-8'):
        u = line.strip()
        if u and u.startswith('http'):
            urls.append((u, ''))
    return urls


def collect_from_promo():
    d = json.load(open(PROMO_FILE, encoding='utf-8'))
    return [(u, '') for u in d.get('indexnowUrls', [])]


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser(description='IndexNow 批量推送（深夜文库）')
    ap.add_argument('--source', choices=['sitemap', 'local', 'file', 'promo'], default='sitemap')
    ap.add_argument('--local-dir', help='--source local 时的 sitemap 目录')
    ap.add_argument('--urls-file', help='--source file 时的 URL 列表文件（每行一个）')
    ap.add_argument('--endpoints', default='global,bing',
                    help='逗号分隔端点名，可选: ' + ','.join(ENDPOINTS))
    ap.add_argument('--batch-size', type=int, default=5000, help='每批 URL 数，上限 10000')
    ap.add_argument('--delay', type=float, default=2.0, help='每批之间间隔秒数')
    ap.add_argument('--max-urls', type=int, default=0, help='只推前 N 条（0=全部；均匀抽样）')
    ap.add_argument('--since-days', type=int, default=0, help='只推 lastmod 在 N 天内的 URL')
    ap.add_argument('--only-main', action='store_true', help='只推 sitemap-main（书页+静态页）')
    ap.add_argument('--dry-run', action='store_true', help='只统计不发送')
    ap.add_argument('--reset-state', action='store_true', help='清空已推记录')
    ap.add_argument('--state-file', default=STATE_FILE)
    ap.add_argument('--retries', type=int, default=2, help='单批失败重试次数')
    ap.add_argument('--workers', type=int, default=8, help='读取 sitemap 并发数')
    ap.add_argument('--key', default='', help='覆盖 indexnow key')
    args = ap.parse_args()

    key = load_key(args.key)
    batch_size = min(max(1, args.batch_size), 10000)
    eps = []
    for name in args.endpoints.split(','):
        name = name.strip()
        if name and name in ENDPOINTS and name not in eps:
            eps.append((name, ENDPOINTS[name]))
    if not eps:
        raise SystemExit('[indexnow] 没有有效端点')

    # 收集 URL
    if args.source == 'sitemap':
        pairs = collect_from_sitemap(args.workers, args.only_main)
    elif args.source == 'local':
        if not args.local_dir:
            raise SystemExit('[indexnow] --source local 需要 --local-dir')
        pairs = collect_from_sitemap(args.workers, args.only_main, local_dir=args.local_dir)
    elif args.source == 'file':
        if not args.urls_file:
            raise SystemExit('[indexnow] --source file 需要 --urls-file')
        pairs = collect_from_file(args.urls_file)
    else:
        pairs = collect_from_promo()

    # 只保留本站 URL，去重
    seen = set()
    uniq = []
    for u, lm in pairs:
        if not u.startswith(SITE + '/') and u != SITE:
            continue
        if u in seen:
            continue
        seen.add(u)
        uniq.append((u, lm))
    # 按 URL 排序固定顺序：消除并发拉取的随机性，保证抽样/推送可复现
    pairs = sorted(uniq, key=lambda x: x[0])
    log(f'收集到 {len(pairs)} 条唯一 URL')

    # 按 lastmod 过滤
    if args.since_days > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=args.since_days)).date()
        def fresh(item):
            lm = item[1]
            if not lm:
                return True  # 无 lastmod 的保留，避免误删
            try:
                return datetime.strptime(lm[:10], '%Y-%m-%d').date() >= cutoff
            except Exception:
                return True
        before = len(pairs)
        pairs = [p for p in pairs if fresh(p)]
        log(f'近 {args.since_days} 天过滤: {before} → {len(pairs)} 条')

    # --max-urls 均匀抽样
    if args.max_urls > 0 and len(pairs) > args.max_urls:
        step = len(pairs) / args.max_urls
        pairs = [pairs[int(i * step)] for i in range(args.max_urls)]
        log(f'抽样 {args.max_urls} 条（均匀取样）')

    # 去重状态
    state = load_state(args.state_file, args.reset_state)
    pushed = set(state['pushed'])
    todo = [(u, lm) for u, lm in pairs if url_hash(u) not in pushed]
    log(f'已推记录 {len(pushed)} 条，待推 {len(todo)} 条'
        + ('（--reset-state 已清空）' if args.reset_state else ''))

    if not todo:
        log('没有待推送 URL，结束')
        return

    batches = [todo[i:i + batch_size] for i in range(0, len(todo), batch_size)]
    log(f'共 {len(batches)} 批 × 每批 ≤{batch_size} 条；端点: ' + ', '.join(n for n, _ in eps))
    log(f'key: {key[:6]}…{key[-4:]}；keyLocation: {SITE}/{key}.txt')

    if args.dry_run:
        log('=== DRY RUN，不发送 ===')
        for u, _ in todo[:5]:
            log('  样本:', u)
        log(f'将发送 {len(batches)} 批 × {len(eps)} 端点 = {len(batches)*len(eps)} 次请求')
        return

    # 发送
    ok_batches = 0
    fail = 0
    just_pushed = []
    for bi, batch in enumerate(batches, 1):
        urls = [u for u, _ in batch]
        payload = {
            'host': HOST,
            'key': key,
            'keyLocation': f'{SITE}/{key}.txt',
            'urlList': urls,
        }
        batch_ok = True
        for name, endpoint in eps:
            status = body = None
            for attempt in range(args.retries + 1):
                status, body = post_batch(endpoint, payload)
                if status in (200, 202):
                    break
                # 4xx（除 429）重试无意义
                if 400 <= status < 500 and status != 429:
                    break
                if attempt < args.retries:
                    time.sleep(2 ** attempt)
            if status in (200, 202):
                log(f'批 {bi}/{len(batches)} {name}: HTTP {status} 接受 {len(urls)} 条')
            else:
                log(f'批 {bi}/{len(batches)} {name}: 失败 HTTP {status} {body}')
                fail += 1
                batch_ok = False
        if batch_ok:
            ok_batches += 1
            just_pushed.extend(url_hash(u) for u in urls)
            # 每批成功后即保存，保证中断不丢进度
            state['pushed'] = list(set(state['pushed']) | set(just_pushed))
            save_state(args.state_file, state)
        if bi < len(batches) and args.delay > 0:
            time.sleep(args.delay)

    log(f'完成：成功批 {ok_batches}/{len(batches)}，失败请求 {fail} 次，'
        f'本次记录已推 {len(just_pushed)} 条')
    log(f'状态文件: {args.state_file}')


if __name__ == '__main__':
    main()
