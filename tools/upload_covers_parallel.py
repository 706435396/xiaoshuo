#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
upload_covers_parallel.py — 多线程并行上传封面到 R2（复用 TLS 连接，速度远快于串行）。

复用 upload_r2.py 的 AWS Signature V4 签名逻辑，但用 requests.Session 做连接复用 +
线程池并发，显著缩短 1500+ 小文件的整体上传时间。

环境变量：R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
用法：
  R2_... R2_BUCKET=ebook python tools/upload_covers_parallel.py covers --prefix cover \
        --skip-existing --workers 16 --manifest covers_upload.txt
"""
import os
import sys
import time
import math
import hmac
import hashlib
import datetime
import argparse
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

# 复用 upload_r2 的签名函数
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upload_r2 import sha256_hex, sign, get_signature_key  # noqa


def build_auth_headers(account_id, access_key, secret_key, bucket, key, body,
                       content_type, content_encoding=None, cache_control=None):
    host = '%s.r2.cloudflarestorage.com' % account_id
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
    enc_key = urllib.parse.quote(key, safe='/~')
    canonical_uri = '/%s/%s' % (bucket, enc_key)
    canonical_request = '\n'.join(['PUT', canonical_uri, '', canonical_headers,
                                   signed_headers, payload_hash])
    scope = '%s/%s/s3/aws4_request' % (datestamp, region)
    string_to_sign = '\n'.join(['AWS4-HMAC-SHA256', amzdate, scope,
                                sha256_hex(canonical_request.encode('utf-8'))])
    signing_key = get_signature_key(secret_key, datestamp, region, 's3')
    signature = hmac.new(signing_key, string_to_sign.encode('utf-8'),
                         hashlib.sha256).hexdigest()
    headers['authorization'] = (
        'AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s'
        % (access_key, scope, signed_headers, signature))
    return headers, 'https://' + host + canonical_uri


def head_exists(session, account_id, access_key, secret_key, bucket, key):
    headers, url = build_auth_headers(account_id, access_key, secret_key, bucket,
                                      key, b'', 'application/octet-stream')
    try:
        r = session.head(url, headers=headers, timeout=20)
        return 200 <= r.status_code < 300
    except Exception:
        return False


def put_object(session, account_id, access_key, secret_key, bucket, key, body,
               content_type, cache_control, retries=3):
    for attempt in range(1, retries + 1):
        headers, url = build_auth_headers(account_id, access_key, secret_key, bucket,
                                          key, body, content_type, None, cache_control)
        try:
            r = session.put(url, data=body, headers=headers, timeout=60)
            if 200 <= r.status_code < 300:
                return True, ''
            if attempt < retries:
                time.sleep(min(2 * attempt, 8))
        except Exception as e:
            if attempt < retries:
                time.sleep(min(2 * attempt, 8))
            else:
                return False, 'NETERR: %s' % e
    return False, 'HTTP %s' % (r.status_code if 'r' in dir() else '?')


def main():
    ap = argparse.ArgumentParser(description='多线程并行上传封面到 R2')
    ap.add_argument('path', help='封面目录')
    ap.add_argument('--prefix', default='cover')
    ap.add_argument('--workers', type=int, default=16)
    ap.add_argument('--skip-existing', action='store_true')
    ap.add_argument('--manifest', default='covers_upload.txt')
    ap.add_argument('--cache', default='public, max-age=86400')
    args = ap.parse_args()

    account_id = os.environ.get('R2_ACCOUNT_ID')
    access_key = os.environ.get('R2_ACCESS_KEY_ID')
    secret_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    bucket = os.environ.get('R2_BUCKET')
    if not (account_id and access_key and secret_key and bucket):
        print('缺少 R2 凭证环境变量', file=sys.stderr)
        sys.exit(1)

    files = []
    for fn in sorted(os.listdir(args.path)):
        if fn.lower().endswith('.jpg'):
            files.append((os.path.join(args.path, fn),
                          '%s/%s' % (args.prefix, fn)))

    total = len(files)
    print('待上传封面：%d 个，线程数 %d' % (total, args.workers))
    mfh = open(args.manifest, 'a', encoding='utf-8')
    success = 0
    skipped = 0
    failed = 0

    def worker(fp, key):
        body = open(fp, 'rb').read()
        sess = requests.Session()
        sess.headers.update({'user-agent': 'cover-uploader/1.0'})
        if args.skip_existing and head_exists(sess, account_id, access_key,
                                              secret_key, bucket, key):
            return ('skip', key)
        ok, err = put_object(sess, account_id, access_key, secret_key, bucket,
                             key, body, 'image/jpeg', args.cache)
        return ('ok', key) if ok else ('err', key + ' ' + err)

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(worker, fp, key): key for fp, key in files}
        for fut in as_completed(futs):
            status, info = fut.result()
            done += 1
            if status == 'ok':
                success += 1
                url = 'https://pub-0286f9f1305243479f676d853bc3c827.r2.dev/' + urllib.parse.quote(info, safe='/~')
                mfh.write(url + '\n'); mfh.flush()
            elif status == 'skip':
                skipped += 1
            else:
                failed += 1
                print('  ERR %s' % info, file=sys.stderr)
            if done % 100 == 0 or done == total:
                print('  进度 %d/%d  成功 %d  跳过 %d  失败 %d' %
                      (done, total, success, skipped, failed))
    mfh.close()
    print('==== 汇总 ====  总数 %d  成功 %d  跳过 %d  失败 %d' %
          (total, success, skipped, failed))
    print('直链清单：%s' % os.path.abspath(args.manifest))


if __name__ == '__main__':
    main()
