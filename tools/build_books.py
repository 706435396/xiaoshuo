#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_books.py —— 由 R2 直链清单批量生成 books.json 骨架

功能：
  1. 读取 r2_urls.txt（每行一条 R2 公共直链），生成 txt 条目骨架；
  2. 自动补全字段：
       - url / cover 只存相对路径(key)，去掉重复的 R2 域名前缀（前端 R2_BASE 拼接，省体积）；
       - title 取文件名去扩展名；
       - 若文件名含「作者：xxx」自动提取到 author，并从标题剔除；
       - category 按标题关键词自动细分（未命中归「小说」）；
  3. 保留 books.json 中现有的「演示条目」（默认前 3 条 epub/pdf/txt 示例），
     追加在前面，其余旧 txt 条目会被本脚本依据 urls 重新生成覆盖。

用法：
  python tools/build_books.py
  python tools/build_books.py --urls ../r2_urls.txt --out books.json --keep-demos 3

依赖：Python 标准库，无需 pip install。
"""
import json
import os
import re
import argparse
import urllib.parse

# R2 公共域名前缀（与 index.html / read.html 中的 R2_BASE 保持一致）
R2_BASE = "https://pub-0286f9f1305243479f676d853bc3c827.r2.dev/"

# 细分分类：按标题关键词命中，优先级从高到低；未命中归「小说」
GENRE_RULES = [
    ("同人",     ["同人", "综漫", "动漫", "二次元", "fate", "火影", "海贼"]),
    ("玄幻奇幻", ["玄幻", "奇幻", "魔法", "异界", "修真", "修仙", "仙侠", "洪荒", "神话", "西游", "练气", "斗破", "斗罗", "召唤"]),
    ("武侠",     ["武侠", "江湖", "剑客", "剑侠", "侠客", "门派"]),
    ("科幻末世", ["科幻", "星际", "机甲", "末世", "丧尸", "进化", "未来", "废土", "系统流", "异能"]),
    ("历史军事", ["历史", "三国", "大唐", "大清", "王朝", "宫廷", "帝王", "军事", "抗战", "战争", "特种", "谍战", "将军", "皇帝"]),
    ("都市",     ["都市", "商战", "商场", "职场", "乡村", "农村", "山村", "赘婿", "神医", "战神", "奶爸"]),
    ("校园青春", ["校园", "青春", "大学", "高中", "学妹", "学长", "同桌", "学霸"]),
    ("言情情感", ["总裁", "豪门", "婚", "娇妻", "新娘", "情人", "恋", "宠", "甜", "虐", "前夫", "小叔", "少妇", "出轨", "秘书", "护士", "教师", "空姐"]),
    ("悬疑灵异", ["悬疑", "推理", "侦探", "盗墓", "灵异", "诡", "恐怖", "惊悚", "凶宅"]),
    ("游戏竞技", ["网游", "游戏", "电竞", "直播", "手游"]),
]


def url_to_key(url):
    return url[len(R2_BASE):] if url.startswith(R2_BASE) else url


def extract_author(title):
    m = re.search(r'作者[：:]\s*([^（）。，,．.\s]+)', title)
    return m.group(1).strip() if m else ""


def clean_title(title, author):
    if author:
        title = re.sub(r'作者[：:][^（）。，,．.\s]*\s*$', '', title)
    return title.strip()


def classify(title):
    t = title.lower()
    for cat, kws in GENRE_RULES:
        if any(kw.lower() in t for kw in kws):
            return cat
    return "小说"


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    ap.add_argument('--urls', default=os.path.join(root, '..', '..', 'r2_urls.txt'),
                    help='R2 直链清单（每行一条），默认 Desktop/r2_urls.txt')
    ap.add_argument('--out', default=os.path.join(root, 'books.json'),
                    help='输出 books.json 路径')
    ap.add_argument('--keep-demos', type=int, default=3,
                    help='保留现有 books.json 前 N 条作为演示条目（默认 3，0=不保留）')
    args = ap.parse_args()

    # 现有演示条目（转为 key 形态）
    demos = []
    if args.keep_demos > 0 and os.path.exists(args.out):
        try:
            with open(args.out, encoding='utf-8') as f:
                cur = json.load(f)
            for d in cur[:args.keep_demos]:
                nd = dict(d)
                if d.get('url'):
                    nd['url'] = url_to_key(d['url'])
                if d.get('cover'):
                    nd['cover'] = url_to_key(d['cover'])
                demos.append(nd)
        except Exception as e:
            print('读取现有 books.json 失败，跳过演示保留：', e)

    # 读取直链
    with open(args.urls, encoding='utf-8') as f:
        urls = [l.strip() for l in f if l.strip()]

    entries = list(demos)
    next_id = 1
    # 演示条目占用前若干 id
    for d in demos:
        next_id = max(next_id, (d.get('id') or 0) + 1)

    authors_found = 0
    cat_counter = {}
    for url in urls:
        key = url_to_key(url)
        raw = urllib.parse.unquote(key.split('/')[-1])
        title0 = re.sub(r'\.(txt|TXT)$', '', raw)
        author = extract_author(title0)
        if author:
            authors_found += 1
        title = clean_title(title0, author)
        cat = classify(title0)
        cat_counter[cat] = cat_counter.get(cat, 0) + 1
        entries.append({
            "id": next_id,
            "title": title,
            "author": author,
            "category": cat,
            "cover": "",
            "intro": "",
            "type": "txt",
            "url": key,
            "hot": False
        })
        next_id += 1

    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

    print('生成条目总数:', len(entries), '(演示', len(demos), '+ txt', len(entries) - len(demos), ')')
    print('成功提取 author:', authors_found, '/', len(entries) - len(demos))
    print('分类分布:', cat_counter)
    print('输出:', args.out, '大小:', os.path.getsize(args.out), '字节')


if __name__ == '__main__':
    main()
