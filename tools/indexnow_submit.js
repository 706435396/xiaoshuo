#!/usr/bin/env node
/**
 * indexnow_submit.js — 把新书/更新 URL 推送给 Bing / Yandex（IndexNow）
 *
 * 前提：站点根目录必须有与 key 同名的验证文件
 *   https://shenye.72tool.com/<INDEXNOW_KEY>.txt  内容为该 key 字符串
 * 仓库根目录已放置该文件，push 后由 Cloudflare Pages 自动托管。
 *
 * 凭证（GitHub Secrets，可选）：
 *   INDEXNOW_KEY  自定义 key；不填则读取仓库内 indexnow-key.txt
 *
 * 只用 Node 内置 https，无需 npm install。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'promo', 'out.json');
const SITE = 'https://shenye.72tool.com';
const HOST = 'shenye.72tool.com';
const ENDPOINTS = [
  'https://api.indexnow.org/indexnow',
  'https://www.bing.com/indexnow'
];

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length }
    }, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
    req.write(data);
    req.end();
  });
}

async function main() {
  let key = (process.env.INDEXNOW_KEY || '').trim();
  if (!key) {
    try { key = fs.readFileSync(path.join(ROOT, 'indexnow-key.txt'), 'utf8').trim(); }
    catch (_) { key = ''; }
  }
  if (!/^[a-zA-Z0-9]{8,64}$/.test(key)) {
    console.log('[indexnow] 无有效 INDEXNOW_KEY，跳过推送（非错误）');
    return;
  }
  if (!fs.existsSync(OUT_FILE)) {
    console.error('[indexnow] 找不到 promo/out.json，请先运行 generate_promo.js');
    process.exitCode = 1;
    return;
  }

  const out = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  const urls = (out.indexnowUrls || []).filter(u => u.startsWith(SITE + '/'));
  if (urls.length === 0) {
    console.log('[indexnow] 无待推送 URL，跳过');
    return;
  }

  // IndexNow 单次建议 ≤ 10000 条，这里按 100 条分批，更稳
  const batches = [];
  for (let i = 0; i < urls.length; i += 100) batches.push(urls.slice(i, i + 100));

  let failed = 0;
  for (const batch of batches) {
    const payload = {
      host: HOST,
      key,
      keyLocation: `${SITE}/${key}.txt`,
      urlList: batch
    };
    for (const endpoint of ENDPOINTS) {
      try {
        const res = await postJson(endpoint, payload);
        // 200 = 接受，202 = 已排队
        if (res.status === 200 || res.status === 202) {
          console.log(`[indexnow] ${new URL(endpoint).host} 接受 ${batch.length} 条 (HTTP ${res.status})`);
        } else {
          console.warn(`[indexnow] ${new URL(endpoint).host} 返回 HTTP ${res.status}: ${res.body.slice(0, 200)}`);
          failed++;
        }
      } catch (e) {
        console.warn(`[indexnow] ${new URL(endpoint).host} 请求异常: ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`[indexnow] 完成：${urls.length} 条 URL / ${batches.length} 批，失败 ${failed} 次`);
  if (failed === batches.length * ENDPOINTS.length && failed > 0) process.exitCode = 1;
}

main();
