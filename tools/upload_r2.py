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
import mimetypes

# 这些扩展名默认做 gzip 预压缩
GZIP_EXTS = {'.txt', '.text', '.html', '.htm', '.css', '.js', '.json',
             '.svg', '.xml', '.md', '.csv', '.tsv', '.txt'}

# mimetypes 可能不认识的扩展名
EXTRA_TYPES = {
    '.epub': 'application/epub+zip',
    '.mobi': 'application/x-mobipocket-ebook',
    '.azw3': 'application/vnd.amazon.mobi8-ebook',
    '.fb2': 'application/xml',
}


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
    canonical_uri = '/%s/%s' % (bucket, key)
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
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    ap = argparse.ArgumentParser(description='上传文件到 Cloudflare R2（文本类自动 gzip 预压缩）')
    ap.add_argument('path', help='要上传的文件或目录')
    ap.add_argument('--key', help='对象键（单文件时；目录上传时忽略）')
    ap.add_argument('--prefix', default='', help='目录上传时的键前缀，如 book')
    ap.add_argument('--no-gzip', action='store_true', help='关闭 gzip 预压缩（原样上传）')
    ap.add_argument('--cache', default='public, max-age=86400', help='Cache-Control 头')
    ap.add_argument('--dry', action='store_true', help='仅预览，不实际上传')
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
                rel = os.path.relpath(fp, args.path).replace(os.sep, '/')
                key = (args.prefix + '/' + rel) if args.prefix else rel
                tasks.append((fp, key))
    else:
        key = args.key or os.path.basename(args.path)
        tasks.append((args.path, key))

    if not tasks:
        print('没有可上传的文件。')
        return

    for fp, key in tasks:
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
            print('[dry] PUT %s  %s%s  %s' % (key, ctype, (' / ' + enc) if enc else '', size_note))
            continue
        status, resp = upload_object(account_id, access_key, secret_key, bucket,
                                     key, body, ctype, enc, args.cache)
        if 200 <= status < 300:
            print('OK  %s  %s  %s' % (status, key, size_note))
        else:
            print('ERR %s  %s  %s' % (status, key, resp[:300].decode('utf-8', 'ignore')),
                  file=sys.stderr)


if __name__ == '__main__':
    main()
