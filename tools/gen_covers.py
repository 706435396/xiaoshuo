#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_covers.py — 程序化生成小说封面（无需真 AI，按书名哈希生成专属配色 + 排版 + 纹样）。

设计：
  - 每本书根据「书名 + id」哈希得到唯一色相，生成竖向渐变背景（深色调，像真实书封）。
  - 大号半透明「首字水印」作为主视觉，保证每本封面各不相同。
  - 底部暗化面板保证书名可读；书名按宽度自动换行、过长自动缩小字号。
  - 顶部分类标签（pill），底部作者名。
  - 全程中文用系统黑体（simhei.ttf），无外部依赖（仅 Pillow）。

用法：
  # 生成全部缺封面的书（默认只生成 books.json 中 cover 为空的书）
  python tools/gen_covers.py

  # 仅生成前 5 本做冒烟测试
  python tools/gen_covers.py --limit 5

  # 强制为所有书重新生成（覆盖已有）
  python tools/gen_covers.py --all

  # 指定输出目录
  python tools/gen_covers.py --out covers
"""
import os
import sys
import json
import hashlib
import argparse

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONT_PATH = r'C:/Windows/Fonts/simhei.ttf'
W, H = 600, 800            # 3:4 书封比例
MARGIN = 46                # 左右安全边距


# ---------------- 颜色工具 ----------------
def hsl_to_rgb(h, s, l):
    h = h % 360 / 360.0
    if s == 0:
        r = g = b = l
    else:
        def f(n):
            k = (n + h * 12) % 12
            a = s * min(l, 1 - l)
            return l - a * max(-1.0, min(k - 3, 9 - k, 1.0))
        r, g, b = f(0), f(8), f(4)
    return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))


def seed_of(s):
    return int(hashlib.md5(s.encode('utf-8')).hexdigest(), 16)


def palette(seed):
    h1 = seed % 360
    h2 = (h1 + 28) % 360
    top = hsl_to_rgb(h2, 0.42, 0.16)
    bot = hsl_to_rgb(h1, 0.52, 0.30)
    accent = hsl_to_rgb(h1, 0.72, 0.58)
    motif = hsl_to_rgb(h1, 0.55, 0.62)
    return top, bot, accent, motif


# ---------------- 渐变 ----------------
def vgradient_rgb(w, h, c_top, c_bot):
    col = Image.new('RGB', (1, h))
    px = col.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(c_top[0] + (c_bot[0] - c_top[0]) * t)
        g = int(c_top[1] + (c_bot[1] - c_top[1]) * t)
        b = int(c_top[2] + (c_bot[2] - c_top[2]) * t)
        px[0, y] = (r, g, b)
    return col.resize((w, h))


def vgradient_alpha(w, h, a_top, a_bot, rgb=(0, 0, 0)):
    col = Image.new('RGBA', (1, h))
    px = col.load()
    for y in range(h):
        t = y / max(1, h - 1)
        a = int(a_top + (a_bot - a_top) * t)
        px[0, y] = (rgb[0], rgb[1], rgb[2], a)
    return col.resize((w, h))


# ---------------- 文本换行 ----------------
def wrap_text(text, font, max_w):
    lines, cur = [], ''
    for ch in text:
        test = cur + ch
        if not cur or font.getlength(test) <= max_w:
            cur = test
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def clean_title(t):
    # 仅用于挑选「首字水印」：跳过书名号/引号等标点
    for ch in t:
        if ch.isalnum() or ('\u4e00' <= ch <= '\u9fff'):
            return ch
    return t[0] if t else '书'


def choose_title_font(title, max_w, max_lines=5, max_h=320):
    size = 66
    while size >= 34:
        f = ImageFont.truetype(FONT_PATH, size)
        lines = wrap_text(title, f, max_w)
        lh = int(size * 1.2)
        if len(lines) <= max_lines and len(lines) * lh <= max_h:
            return f, lines, lh
        size -= 4
    f = ImageFont.truetype(FONT_PATH, size)
    lines = wrap_text(title, f, max_w)
    return f, lines, int(size * 1.2)


def draw_cover(book, out_path):
    title = (book.get('title') or '未命名').strip()
    author = (book.get('author') or '').strip()
    category = (book.get('category') or '').strip()
    seed = seed_of(title + '|' + str(book.get('id', '')))
    top, bot, accent, motif = palette(seed)

    base = vgradient_rgb(W, H, top, bot).convert('RGBA')

    # 主视觉：大号半透明首字水印
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    ch = clean_title(title)
    wm_font = ImageFont.truetype(FONT_PATH, 430)
    bb = d.textbbox((0, 0), ch, font=wm_font)
    wm_w, wm_h = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((W - wm_w) / 2 - bb[0], (H * 0.40) - wm_h / 2 - bb[1]),
           ch, font=wm_font, fill=(motif[0], motif[1], motif[2], 55))
    base = Image.alpha_composite(base, ov)

    # 底部暗化面板（保证书名可读）
    panel_h = 360
    panel = vgradient_alpha(W, panel_h, 0, 190).crop((0, 0, W, panel_h))
    base.paste(panel, (0, H - panel_h), panel)

    d = ImageDraw.Draw(base)

    # 顶部分类标签（pill）
    if category:
        cat_font = ImageFont.truetype(FONT_PATH, 26)
        cat_text = category
        pad_x, pad_y = 16, 8
        cw = cat_font.getlength(cat_text) + pad_x * 2
        chh = 26 + pad_y * 2
        x0, y0 = MARGIN, 40
        d.rounded_rectangle([x0, y0, x0 + cw, y0 + chh], radius=chh / 2,
                            fill=(accent[0], accent[1], accent[2], 230))
        d.text((x0 + pad_x, y0 + pad_y), cat_text, font=cat_font,
               fill=(255, 255, 255, 255))

    # 书名（自动换行 + 字号自适应）
    tf, lines, lh = choose_title_font(title, W - 2 * MARGIN)
    block_h = len(lines) * lh
    # 底部留白 70，作者区预留
    bottom_margin = 64
    author_h = 40 if author else 0
    y = H - bottom_margin - author_h - block_h
    # 标题下 accent 细线
    cur_y = y
    for line in lines:
        d.text((MARGIN, cur_y), line, font=tf, fill=(255, 255, 255, 255))
        cur_y += lh
    # accent 细线（标题与作者之间）
    if author:
        line_y = cur_y + 6
        d.rectangle([MARGIN, line_y, MARGIN + 60, line_y + 4],
                    fill=(accent[0], accent[1], accent[2], 255))
        d.text((MARGIN, cur_y + 20), '著 · ' + author,
               font=ImageFont.truetype(FONT_PATH, 26),
               fill=(225, 225, 225, 255))

    # 细内边框
    d.rectangle([6, 6, W - 7, H - 7], outline=(255, 255, 255, 40), width=2)

    img = base.convert('RGB')
    img.save(out_path, 'JPEG', quality=85, optimize=True)


def main():
    ap = argparse.ArgumentParser(description='程序化生成小说封面')
    ap.add_argument('--out', default=os.path.join(ROOT, 'covers'), help='输出目录')
    ap.add_argument('--limit', type=int, default=0, help='只生成前 N 本（冒烟测试）')
    ap.add_argument('--all', action='store_true', help='为所有书重新生成（覆盖已有）')
    ap.add_argument('--books', default=os.path.join(ROOT, 'books.json'), help='books.json 路径')
    args = ap.parse_args()

    if not os.path.exists(FONT_PATH):
        print('缺少中文字体：', FONT_PATH, file=sys.stderr)
        sys.exit(1)

    books = json.load(open(args.books, 'r', encoding='utf-8'))
    os.makedirs(args.out, exist_ok=True)

    todo = []
    for b in books:
        cid = b.get('id')
        out_path = os.path.join(args.out, '%s.jpg' % cid)
        need = args.all or not os.path.exists(out_path)
        if need:
            todo.append((b, out_path))

    if args.limit:
        todo = todo[:args.limit]

    total = len(todo)
    print('待生成封面：%d 本（输出目录 %s）' % (total, args.out))
    ok, fail = 0, 0
    for i, (b, out_path) in enumerate(todo, 1):
        try:
            draw_cover(b, out_path)
            ok += 1
            if i % 50 == 0 or i == total:
                print('  进度 %d/%d' % (i, total))
        except Exception as e:
            fail += 1
            print('  失败 id=%s title=%s: %s' % (b.get('id'), b.get('title'), e),
                  file=sys.stderr)
    print('==== 封面生成完成 ====  成功 %d  失败 %d' % (ok, fail))


if __name__ == '__main__':
    main()
