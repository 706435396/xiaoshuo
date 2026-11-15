// 章节页：/chapter/{id}/{n} → 服务端渲染含完整正文的 SEO HTML。
// Cloudflare Pages Functions 动态路由；context.params.id / context.params.n。
import { getBooks, getBookText, buildChapters, chapterHtml, esc } from '../_lib.js';

export async function onRequestGet(context) {
  const { params, request } = context;
  const id = String(params.id || '');
  const n = parseInt(params.n, 10);

  const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };
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

    return new Response(chapterHtml(book, chapters, n - 1), { headers: htmlHeaders });
  } catch (e) {
    return errPage('章节加载失败：' + (e && e.message ? e.message : '未知错误'));
  }
}
