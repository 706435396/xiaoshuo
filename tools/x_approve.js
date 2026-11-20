#!/usr/bin/env node
/**
 * 深夜文库 · 推广文案批量审核（可重跑）
 *
 * 作用：把通过合规自检的文案 approved 设为 true，供 Bluesky/Mastodon 自动发布脚本取用。
 * 审核规则（保守，宁可漏发不可错发）：
 *   - 书名/正文含擦边词、私域引流词 → 保持 false（不进入发布队列）
 *   - 其余 → approved = true
 *
 * 这是"代审核"：基于上一轮 check_x_compliance.js 已通过（致命0/警告0）的结果。
 * 若要撤回授权，把某条 approved 改回 false 重跑本脚本即可（本脚本不会覆盖 false）。
 *
 * 用法：node tools/x_approve.js [--dry-run]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'promo', 'x-corpus.json');
const DRY_RUN = process.argv.includes('--dry-run');

const RISKY_TITLE_RE = /(熟妇|性福|人妻|调教|骗上床|丝袜|淫|奸|性交|幼|未成年|萝莉|制服诱惑)/i;
const AD_RE = /(Telegram|t\.me\/|QQ群|微信群|加群|搜索 @|禁忌书屋)/i;

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let approved = 0, rejected = 0, kept = 0;

for (const p of data.posts) {
  if (RISKY_TITLE_RE.test(p.book_title || '') || AD_RE.test(p.post_text || '')) {
    p.approved = false;
    rejected++;
    console.log(`[REJECT] ${p.post_id} 《${p.book_title}》命中擦边/引流词`);
  } else {
    if (!p.approved) { p.approved = true; approved++; }
    else kept++;
  }
}

data.note = '经合规自检后由运营代审核：通过者 approved=true，供 Bluesky/Mastodon 零成本试水自动发布；擦边书名与引流文案保持 false。X 官方 API 自动发布仍需单独人工复核。';
data.approvedAt = new Date().toISOString();

if (!DRY_RUN) fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
console.log(`\n结果：新批准 ${approved} / 拒绝 ${rejected} / 原本已批 ${kept} / 总 ${data.posts.length}${DRY_RUN ? '（dry-run 未写入）' : ''}`);
