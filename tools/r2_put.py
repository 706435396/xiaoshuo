# -*- coding: utf-8 -*-
"""
r2_put.py — 单文件上传到 R2（覆盖写），用于逐张替换封面。
凭证通过环境变量传入（不落盘）：
  R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
  R2_PUBLIC_BASE 可选（默认下方公开 dev 域名）
用法：python3 tools/r2_put.py <local_file> <key>
成功打印 "URL <public_url>"
"""
import os
import sys
import time
import datetime
import hashlib
import hmac
import urllib.parse
import requests

ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
BUCKET = os.environ["R2_BUCKET"]
PUBLIC_BASE = os.environ.get(
    "R2_PUBLIC_BASE", "https://pub-0286f9f1305243479f676d853bc3c827.r2.dev"
)

REGION = "auto"
SERVICE = "s3"
ALGORITHM = "AWS4-HMAC-SHA256"
CT = "image/jpeg"


def sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def get_signature_key(key, date_stamp, region, service):
    k = sign(("AWS4" + key).encode("utf-8"), date_stamp)
    k = sign(k, region)
    k = sign(k, service)
    return sign(k, "aws4_request")


def put_object(local_file, key, retries=3):
    data = open(local_file, "rb").read()
    for attempt in range(1, retries + 1):
        try:
            t = datetime.datetime.utcnow()
            amz_date = t.strftime("%Y%m%dT%H%M%SZ")
            date_stamp = t.strftime("%Y%m%d")
            host = f"{BUCKET}.{ACCOUNT_ID}.r2.cloudflarestorage.com"
            endpoint = f"https://{host}/{urllib.parse.quote(key, safe='')}"
            payload_hash = hashlib.sha256(data).hexdigest()
            headers = {
                "host": host,
                "x-amz-date": amz_date,
                "x-amz-content-sha256": payload_hash,
            }
            signed_headers = "host;x-amz-content-sha256;x-amz-date"
            canonical_headers = (
                "host:" + host + "\n"
                + "x-amz-content-sha256:" + payload_hash + "\n"
                + "x-amz-date:" + amz_date + "\n"
            )
            canonical_request = "\n".join([
                "PUT", "/" + key, "", canonical_headers, signed_headers, payload_hash
            ])
            scope = f"{date_stamp}/{REGION}/{SERVICE}/aws4_request"
            string_to_sign = "\n".join([
                ALGORITHM, amz_date, scope,
                hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
            ])
            signing_key = get_signature_key(SECRET_KEY, date_stamp, REGION, SERVICE)
            signature = hmac.new(signing_key, string_to_sign.encode("utf-8"),
                                 hashlib.sha256).hexdigest()
            authorization = (
                f"{ALGORITHM} Credential={ACCESS_KEY}/{scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            )
            headers["authorization"] = authorization
            headers["content-type"] = CT
            r = requests.put(endpoint, data=data, headers=headers, timeout=120)
            if r.status_code in (200, 204):
                print("URL " + PUBLIC_BASE.rstrip("/") + "/" + key)
                return True
            else:
                sys.stderr.write(f"attempt {attempt} HTTP {r.status_code}: {r.text[:200]}\n")
        except Exception as e:
            sys.stderr.write(f"attempt {attempt} error: {e}\n")
        time.sleep(2 * attempt)
    return False


if __name__ == "__main__":
    local = sys.argv[1]
    key = sys.argv[2]
    ok = put_object(local, key)
    sys.exit(0 if ok else 1)
