// 章节页：/chapter/{id}/{n} → 服务端渲染章节 HTML。
// 付费规则：免费书全书可读；付费书前 3 章试读，第 4 章起仅会员可读。
// 付费墙对所有人一致输出（不按 UA 区分 → 非 cloaking，符合 Google 规则）。
import { getBooks, getBookText, buildChapters, chapterHtml, paywallHtml, esc } from '../_lib.js';
import { getSession, memberInfo } from '../../api/_shared.js';

const FREE_TRIAL = 3; // 付费书免费试读章节数

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const id = String(params.id || '');
  const n = parseInt(params.n, 10);

  const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8' };
  const errPage = (msg) => new Response('<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><title>章节未找到 | 深夜文库</title><body style="background:#0d0d0d;color:#ddd;font-family:system-ui;text-align:center;padding:60px"><h2>' + esc(msg) + '</h2><p><a href="/" style="color:#ff9500">返回首页</a></p></body></html>', { status: 404, headers: htmlHeaders });

  if (!/^\d+$/.test(id) || !Number.isInteger(n) || n < 1) return errPage('章节地址无效');

  try {
    const books = await getBooks(request, context);
    const book = books.find(b => String(b.id) === id);
    if (!book) return errPage('书籍不存在');
    if (book.type !== 'txt') return errPage('该书为非文本格式，请到作品详情阅读');

    const text = await getBookText(book, context);
    const { chapters } = buildChapters(text);
    if (n > chapters.length) return errPage('章节超出范围（共 ' + chapters.length + ' 章）');

    const isFreeBook = book.free === true;
    const isTrial = n <= FREE_TRIAL;

    let html, cacheControl;
    if (isFreeBook || isTrial) {
      // 免费书 / 试读章：完整正文，可公共缓存（对所有人一致）
      html = chapterHtml(book, chapters, n - 1);
      cacheControl = 'public, max-age=3600';
    } else {
      // 付费章节：先判断是否会员（Bearer 或 Cookie token 均可）
      const sess = await getSession(request, env);
      const info = sess ? await memberInfo(env, sess.user) : { isVip: false };
      if (info.isVip) {
        // 会员：完整正文，但禁止公共缓存，避免把会员内容缓存给非会员
        html = chapterHtml(book, chapters, n - 1);
        cacheControl = 'private, no-store';
      } else {
        // 非会员：付费墙页，正文不进入 HTML；可公共缓存（对所有人一致）
        html = paywallHtml(book, chapters, n - 1, FREE_TRIAL);
        cacheControl = 'public, max-age=3600';
      }
    }

    return new Response(html, { headers: { ...htmlHeaders, 'Cache-Control': cacheControl } });
  } catch (e) {
    return errPage('章节加载失败：' + (e && e.message ? e.message : '未知错误'));
  }
}
