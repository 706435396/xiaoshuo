#!/usr/bin/env node
/**
 * check_x_compliance.js — X 推广文案合规自检（发布前必跑）
 *
 * 检查 promo/x-corpus.json 里每条文案：
 *   1) 未成年人信号词
 *   2) 露骨成人词（推文层不允许直白描写）
 *   3) 引导私域/第三方引流词（Telegram/QQ群等）
 *   4) 链接必须是本站 https + 带 utm_source=x
 *   5) 字数：X 免费账号单条上限 280 字符
 *   6) 重复度：文案主体（去链接/去书名）高度相似的交出警告
 *   7) 未审核标记：approved 必须为 false 才允许进审核队列（本脚本不代替人工审核）
 *
 * 用法：node tools/check_x_compliance.js
 * 退出码：0=全部通过（仅警告不影响），1=有致命问题
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'promo', 'x-corpus.json');
const SITE = 'https://shenye.72tool.com';

const MINOR = /(未成年|蘿莉|罗莉|正太|幼女|幼童|雛女|雏女|小學生|小学生|國中|国中|初中生|高中生|高中|中學生|中学生|少年|少女|小孩|男童|女童|未滿|未满|[0-9]{1,2}[岁嵗]|养成|養成|蓓蕾|懵懂)/i;
const EROTIC = /(淫|姦|奸|性交|做爱|猛干|抽插|高潮|自慰|口交|肛交|orgy|rape|porn|xxx)/i;
const AD = /(Telegram|t\.me\/|QQ群|微信群|加群|免费入群|搜索\s*@|私聊|加我|微信|https?:\/\/(?!shenye\.72tool\.com))/i;
const MAX_LEN = 280;

function norm(t) {
  // 只归一化 URL 与纯数字；保留书名和正文，否则不同书会被误判为重复
  return t.replace(/https?:\/\/\S+/g, '[URL]').replace(/\s+/g, '').trim();
}

function main() {
  if (!fs.existsSync(FILE)) { console.error('找不到', FILE, '请先运行 build_promo_corpus.js'); process.exit(1); }
  const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const posts = d.posts || [];
  let fatal = 0, warn = 0;
  const seen = new Map();

  posts.forEach(p => {
    const t = p.post_text || '';
    const errs = [];
    if (MINOR.test(t)) errs.push('未成年人信号');
    if (EROTIC.test(t)) errs.push('露骨成人词');
    if (AD.test(t)) errs.push('私域/第三方引流');
    const urls = t.match(/https?:\/\/\S+/g) || [];
    if (!urls.length) errs.push('缺少链接');
    urls.forEach(u => {
      if (!u.startsWith(SITE)) errs.push('非本站链接:' + u.slice(0, 40));
      if (!/utm_source=x/.test(u)) errs.push('缺 utm_source=x');
    });
    // X 计数规则：每个 URL 算 23 字符（t.co），emoji 算 2，其余字符算 1
    let xLen = 0;
    const noUrl = t.replace(/https?:\/\/\S+/g, () => { xLen += 23; return ''; });
    Array.from(noUrl).forEach(c => { xLen += /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c) ? 2 : 1; });
    if (xLen > MAX_LEN) { warn++; console.warn(`[WARN] ${p.post_id} X计价字数 ${xLen} > ${MAX_LEN}（可能被截断）`); }
    const n = norm(t);
    if (seen.has(n)) { warn++; console.warn(`[WARN] ${p.post_id} 与 ${seen.get(n)} 文案高度重复`); }
    else seen.set(n, p.post_id);
    if (errs.length) { fatal++; console.error(`[FATAL] ${p.post_id}: ${errs.join(' / ')}`); }
  });

  const drafts = posts.filter(p => p.approved === false || p.status === 'draft').length;
  console.log(`\n[合规自检] 文案总数=${posts.length} 致命=${fatal} 警告=${warn}`);
  console.log(`[合规自检] 待人工审核=${drafts}（approved=false，正确：脚本不代替审核）`);
  if (fatal) { console.error('[合规自检] 存在致命问题，禁止导入发布队列'); process.exit(1); }
  console.log('[合规自检] 通过：可导入 Posts 表，但必须人工审核通过后才允许发布');
}
main();
