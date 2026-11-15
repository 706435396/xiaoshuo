#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成分类缩略图：正方形渐变 + 分类首字水印 + 柔光，每类配色不同。
输出到 cat/{slug}.jpg，随后由 upload_covers_parallel.py 上传到 R2 的 cat/ 前缀。
"""
import os, math, sys
from PIL import Image, ImageDraw, ImageFont

SIZE = 96
FONT_PATH = r'C:/Windows/Fonts/simhei.ttf'

# 分类名 -> (slug, 基准色相 hue 0-360)
CATS = [
    ('全部',     'all',    220),
    ('都市激情', 'dushi',  28),
    ('校园之恋', 'xiaoyuan', 210),
    ('人妻熟女', 'renqi',  330),
    ('家庭乱伦', 'jiating', 275),
    ('经验故事', 'jingyan', 40),
    ('真实体验', 'zhenshi', 145),
    ('猎奇另类', 'lieqi',   265),
    ('短篇笑话', 'duanpian', 52),
    ('古典武侠', 'gudian',  0),
    ('91博客',  'blog91',  175),
]

def hsl_to_rgb(h, s, l):
    h /= 360.0; s /= 100.0; l /= 100.0
    if s == 0:
        r = g = b = l
    else:
        def hue(p, q, t):
            if t < 0: t += 1
            if t > 1: t -= 1
            if t < 1/6: return p + (q - p) * 6 * t
            if t < 1/2: return q
            if t < 2/3: return p + (q - p) * (2/3 - t) * 6
            return p
        q = l * (1 + s) if l < 0.5 else l + s - l * s
        p = 2 * l - q
        r = hue(p, q, h + 1/3); g = hue(p, q, h); b = hue(p, q, h - 1/3)
    return int(r*255), int(g*255), int(b*255)

def make(cat_name, slug, hue):
    c0 = hsl_to_rgb(hue, 62, 50)
    c1 = hsl_to_rgb((hue + 28) % 360, 58, 30)
    base = Image.new('RGB', (SIZE, SIZE), c1)
    # 对角线渐变
    px = base.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t = (x + y) / (2 * SIZE)
            r = int(c0[0]*(1-t) + c1[0]*t)
            g = int(c0[1]*(1-t) + c1[1]*t)
            b = int(c0[2]*(1-t) + c1[2]*t)
            px[x, y] = (r, g, b)
    d = ImageDraw.Draw(base, 'RGBA')
    # 左上柔光
    for i in range(40):
        a = int(70 * (1 - i/40))
        d.ellipse([-20 + i, -20 + i, 60 + i, 60 + i], fill=(255, 255, 255, a//6))
    # 首字水印
    ch = cat_name[0]
    try:
        font = ImageFont.truetype(FONT_PATH, int(SIZE * 0.52))
    except Exception:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), ch, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx, ty = (SIZE - tw) / 2 - bbox[0], (SIZE - th) / 2 - bbox[1]
    d.text((tx, ty), ch, font=font, fill=(255, 255, 255, 55))
    out = 'cat/%s.jpg' % slug
    os.makedirs('cat', exist_ok=True)
    base.save(out, 'JPEG', quality=88)
    return out

if __name__ == '__main__':
    for name, slug, hue in CATS:
        print('wrote', make(name, slug, hue))
    print('done', len(CATS))
