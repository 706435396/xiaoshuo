#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
upload_r2.py — 上传文件到 Cloudflare R2（S3 兼容），并自动对文本类文件做 gzip 预压缩。

关键点：
  - 文本类（.txt/.html/.css/.js/.json/.svg/.xml/.md/.csv 等）默认 gzip 后上传，
    并在对象上写入 Content-Encoding: gzip。浏览器 fetch 会【透明解压】，前端代码零改动。
  - 既省 R2 存储，又省出流量（中文 txt 通常压掉 70%~85%）。
  - 凭证仅从环境变量读取，不写入任何文件。

环境变量：
  R2_ACCOUNT_ID         Cloudflare 账户 ID
  R2_ACCESS_KEY_ID      R2 API 令牌 Access Key
  R2_SECRET_ACCESS_KEY  R2 API 令牌 Secret
  R2_BUCKET             存储桶名称

用法：
  # 上传单个 txt（自动 gzip，键为 book/test.txt）
  R2_ACCOUNT_ID=xxx R2_ACCESS_KEY_ID=xxx R2_SECRET_ACCESS_KEY=xxx R2_BUCKET=ebook \
    python upload_r2.py novel.txt --key book/novel.txt

  # 上传整个目录（保留相对结构，文本类自动 gzip）
  ... python upload_r2.py ./books --prefix book

  # 只预览会做什么、各文件压缩前后体积（不实际上传）
  python upload_r2.py ./books --prefix book --dry

  # 原样上传、不做 gzip
  python upload_r2.py novel.txt --key book/novel.txt --no-gzip
"""
import os
import sys
import gzip
import json
import argparse
import hashlib
import hmac
import datetime
import urllib.request
import urllib.error
import urllib.parse
import mimetypes

# 这些扩展名默认做 gzip 预压缩
GZIP_EXTS = {'.txt', '.text', '.html', '.htm', '.css', '.js', '.json',
             '.svg', '.xml', '.md', '.csv', '.tsv'}

# mimetypes 可能不认识的扩展名
EXTRA_TYPES = {
    '.epub': 'application/epub+zip',
    '.mobi': 'application/x-mobipocket-ebook',
    '.azw3': 'application/vnd.amazon.mobi8-ebook',
    '.fb2': 'application/xml',
}

# R2 公共访问域名（r2.dev）。如需自定义域名，用 --public-base 覆盖。
DEFAULT_PUBLIC_BASE = 'https://pub-0286f9f1305243479f676d853bc3c827.r2.dev/'


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def sign(key, msg):
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()


def get_signature_key(key, date_stamp, region, service):
    k = sign(('AWS4' + key).encode('utf-8'), date_stamp)
    k = sign(k, region)
    k = sign(k, service)
    k = sign(k, 'aws4_request')
    return k


def guess_type(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in EXTRA_TYPES:
        return EXTRA_TYPES[ext]
    t, _ = mimetypes.guess_type(path)
    return t or 'application/octet-stream'


def upload_object(account_id, access_key, secret_key, bucket, key, body,
                  content_type, content_encoding=None, cache_control=None):
    """用 AWS Signature V4（S3 兼容）PUT 一个对象到 R2。"""
    host = '%s.r2.cloudflarestorage.com' % account_id
    endpoint = 'https://' + host
    region = 'auto'
    now = datetime.datetime.now(datetime.timezone.utc)
    amzdate = now.strftime('%Y%m%dT%H%M%SZ')
    datestamp = now.strftime('%Y%m%d')
    payload_hash = sha256_hex(body)

    headers = {
        'host': host,
        'x-amz-content-sha256': payload_hash,
        'x-amz-date': amzdate,
        'content-type': content_type,
    }
    if content_encoding:
        headers['content-encoding'] = content_encoding
    if cache_control:
        headers['cache-control'] = cache_control

    canonical_headers = ''.join('%s:%s\n' % (k, headers[k].strip()) for k in sorted(headers))
    signed_headers = ';'.join(sorted(headers))
    enc_key = urllib.parse.quote(key, safe='/~')  # 中文/空格键做百分号编码，签名与实际请求一致
    canonical_uri = '/%s/%s' % (bucket, enc_key)
    canonical_request = '\n'.join(['PUT', canonical_uri, '',
                                   canonical_headers, signed_headers, payload_hash])
    scope = '%s/%s/s3/aws4_request' % (datestamp, region)
    string_to_sign = '\n'.join(['AWS4-HMAC-SHA256', amzdate, scope,
                                sha256_hex(canonical_request.encode('utf-8'))])
    signing_key = get_signature_key(secret_key, datestamp, region, 's3')
    signature = hmac.new(signing_key, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
    headers['authorization'] = (
        'AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s'
        % (access_key, scope, signed_headers, signature)
    )

    url = endpoint + canonical_uri
    req = urllib.request.Request(url, data=body, method='PUT')
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        # 网络抖动（握手/读取超时等）一律当作失败，交给上层重试
        return -1, ('NETERR: ' + str(e)).encode('utf-8')


def head_object(account_id, access_key, secret_key, bucket, key):
    """用 HEAD 判断对象是否已存在（用于 --skip-existing 断点续传）。"""
    host = '%s.r2.cloudflarestorage.com' % account_id
    endpoint = 'https://' + host
    region = 'auto'
    now = datetime.datetime.now(datetime.timezone.utc)
    amzdate = now.strftime('%Y%m%dT%H%M%SZ')
    datestamp = now.strftime('%Y%m%d')
    payload_hash = 'UNSIGNED-PAYLOAD'
    headers = {
        'host': host,
        'x-amz-content-sha256': payload_hash,
        'x-amz-date': amzdate,
    }
    canonical_headers = ''.join('%s:%s\n' % (k, headers[k].strip()) for k in sorted(headers))
    signed_headers = ';'.join(sorted(headers))
    enc_key = urllib.parse.quote(key, safe='/~')
    canonical_uri = '/%s/%s' % (bucket, enc_key)
    canonical_request = '\n'.join(['HEAD', canonical_uri, '',
                                   canonical_headers, signed_headers, payload_hash])
    scope = '%s/%s/s3/aws4_request' % (datestamp, region)
    string_to_sign = '\n'.join(['AWS4-HMAC-SHA256', amzdate, scope,
                                sha256_hex(canonical_request.encode('utf-8'))])
    signing_key = get_signature_key(secret_key, datestamp, region, 's3')
    signature = hmac.new(signing_key, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
    headers['authorization'] = (
        'AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s'
        % (access_key, scope, signed_headers, signature)
    )
    url = endpoint + canonical_uri
    req = urllib.request.Request(url, method='HEAD')
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, TimeoutError, OSError):
        return -1


def main():
    ap = argparse.ArgumentParser(description='上传文件到 Cloudflare R2（文本类自动 gzip 预压缩）')
    ap.add_argument('path', help='要上传的文件或目录')
    ap.add_argument('--key', help='对象键（单文件时；目录上传时忽略）')
    ap.add_argument('--prefix', default='', help='目录上传时的键前缀，如 book')
    ap.add_argument('--no-gzip', action='store_true', help='关闭 gzip 预压缩（原样上传）')
    ap.add_argument('--only-txt', action='store_true',
                    help='目录模式下只上传 .txt / .text 文件（跳过其他类型）')
    ap.add_argument('--cache', default='public, max-age=86400', help='Cache-Control 头')
    ap.add_argument('--retries', type=int, default=3, help='上传失败重试次数（默认 3）')
    ap.add_argument('--dry', action='store_true', help='仅预览，不实际上传')
    ap.add_argument('--manifest', default='r2_urls.txt',
                    help='成功上传的直链清单输出路径（默认 r2_urls.txt，写入当前目录）')
    ap.add_argument('--skip-existing', action='store_true',
                    help='上传前先 HEAD 检查，已存在的对象跳过（断点续传，避免重复传）')
    ap.add_argument('--public-base', default=DEFAULT_PUBLIC_BASE,
                    help='生成直链清单用的公共域名前缀')
    args = ap.parse_args()

    account_id = os.environ.get('R2_ACCOUNT_ID')
    access_key = os.environ.get('R2_ACCESS_KEY_ID')
    secret_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    bucket = os.environ.get('R2_BUCKET')
    if not args.dry and not (account_id and access_key and secret_key and bucket):
        print('缺少 R2 凭证环境变量：R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / '
              'R2_SECRET_ACCESS_KEY / R2_BUCKET', file=sys.stderr)
        sys.exit(1)

    tasks = []
    if os.path.isdir(args.path):
        for root, _, files in os.walk(args.path):
            for f in files:
                fp = os.path.join(root, f)
                if args.only_txt and os.path.splitext(f)[1].lower() not in ('.txt', '.text'):
                    continue
                rel = os.path.relpath(fp, args.path).replace(os.sep, '/')
                key = (args.prefix + '/' + rel) if args.prefix else rel
                key = key.replace(' ', '_')
                tasks.append((fp, key))
    else:
        key = args.key or os.path.basename(args.path)
        key = key.replace(' ', '_')
        tasks.append((args.path, key))

    if not tasks:
        print('没有可上传的文件。')
        return

    public_base = args.public_base
    if not public_base.endswith('/'):
        public_base += '/'
    manifest_path = args.manifest
    total = len(tasks)
    success = 0
    skipped = 0
    failed = 0
    # 以追加模式打开清单文件，边传边写，即使中断也不丢已成功的直链
    mfh = open(manifest_path, 'a', encoding='utf-8')

    try:
        for idx, (fp, key) in enumerate(tasks, 1):
            with open(fp, 'rb') as fh:
                raw = fh.read()
            ext = os.path.splitext(fp)[1].lower()
            do_gzip = (not args.no_gzip) and ext in GZIP_EXTS
            body = gzip.compress(raw, 9) if do_gzip else raw
            ctype = guess_type(fp)
            enc = 'gzip' if do_gzip else None
            if do_gzip and raw:
                ratio = (1 - len(body) / len(raw)) * 100
                size_note = '%d -> %d bytes (压缩 %.1f%%)' % (len(raw), len(body), ratio)
            else:
                size_note = '%d bytes (未压缩)' % len(raw)

            if args.dry:
                print('[dry] [%d/%d] PUT %s  %s%s  %s'
                      % (idx, total, key, ctype, (' / ' + enc) if enc else '', size_note))
                continue

            # 断点续传：已存在则跳过
            if args.skip_existing:
                hs = head_object(account_id, access_key, secret_key, bucket, key)
                if 200 <= hs < 300:
                    skipped += 1
                    url = public_base + urllib.parse.quote(key, safe='/~')
                    print('SKIP %d/%d  %s' % (idx, total, key))
                    print('URL ' + url)
                    mfh.write(url + '\n')
                    mfh.flush()
                    continue

            status, resp = 0, b''
            for attempt in range(1, (args.retries or 1) + 1):
                status, resp = upload_object(account_id, access_key, secret_key, bucket,
                                             key, body, ctype, enc, args.cache)
                if 200 <= status < 300:
                    break
                if attempt < (args.retries or 1):
                    import time
                    time.sleep(min(2 * attempt, 10))
            if 200 <= status < 300:
                success += 1
                url = public_base + urllib.parse.quote(key, safe='/~')
                print('OK  %d/%d  %s  %s' % (idx, total, key, size_note))
                print('URL ' + url)
                mfh.write(url + '\n')
                mfh.flush()
            else:
                failed += 1
                print('ERR %d/%d  %s  %s' % (idx, total, key,
                      resp[:300].decode('utf-8', 'ignore')), file=sys.stderr)
    finally:
        mfh.close()

    print('==== 汇总 ====')
    print('总数: %d  成功: %d  跳过(已存在): %d  失败: %d' % (total, success, skipped, failed))
    print('直链清单: %s' % os.path.abspath(manifest_path))


if __name__ == '__main__':
    main()
