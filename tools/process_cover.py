# -*- coding: utf-8 -*-
"""
process_cover.py — 处理 ImageGen 原始图：
1) 裁掉底部水印区域（"AI生成/WORKBUDDY" 在右下角）
2) 居中裁切到 3:4 比例（封面显示比例）
3) 缩放到 600x800 JPEG
用法：python3 tools/process_cover.py <input_png> <output_jpg>
"""
import sys
from PIL import Image

TARGET_W, TARGET_H = 600, 800  # 3:4


def process(src, dst):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    # 目标宽高比 3:4 => 高度 = 宽 / 0.75
    target_ratio = TARGET_W / TARGET_H
    cur_ratio = w / h
    if cur_ratio > target_ratio:
        # 太宽：裁掉左右
        new_w = int(h * target_ratio)
        x = (w - new_w) // 2
        im = im.crop((x, 0, x + new_w, h))
    else:
        # 太高：裁掉上下（同时去除底部水印）
        new_h = int(w / target_ratio)
        y_top = (h - new_h) // 2
        # 额外向下偏一点，确保底部水印被裁掉
        y_top = min(y_top + int(h * 0.02), h - new_h)
        im = im.crop((0, y_top, w, y_top + new_h))
    im = im.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    im.save(dst, "JPEG", quality=85, optimize=True)
    print("saved", dst, im.size)


if __name__ == "__main__":
    process(sys.argv[1], sys.argv[2])
