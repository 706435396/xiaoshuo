#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
txt_to_epub.py — 把纯文本小说转成标准 EPUB（仅用 Python 标准库，无需 pip 安装任何依赖）

特性：
  - 自动识别章节：第N章/卷/回/部/篇/节/集、Chapter N、序章/序言/前言/楔子/番外/后记/尾声
  - 自动处理 UTF-8 / GBK / GB18030 编码（中文 txt 常见）
  - 生成合规 EPUB2：mimetype + container.xml + content.opf + toc.ncx + 分章 xhtml
  - 章节自动生成目录（NCX navMap），epub.js 的目录跳转直接可用

用法：
  python txt_to_epub.py input.txt                       # 输出 input.epub
  python txt_to_epub.py input.txt -o out.epub           # 指定输出
  python txt_to_epub.py input.txt --title "书名" --author "作者"

转完后把生成的 .epub 上传到 R2 的 book/ 目录，并在 books.json 里把该条目 type 设为 "epub" 即可。
"""
import sys
import os
import re
import html
import zipfile
import argparse
from datetime import datetime, timezone

CHAPTER_RE = re.compile(
    r'^\s*(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章卷回部篇节集]'
    r'|Chapter\s+\d+|序章|序言|前言|引言|后记|尾声|楔子|番外)'
)

CONTAINER_XML = '''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>'''


def read_text(path):
    """读取文本，依次尝试 utf-8 / gbk / gb18030。"""
    with open(path, 'rb') as f:
        raw = f.read()
    for enc in ('utf-8', 'gbk', 'gb18030'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    # 都失败则强行 utf-8 忽略错误
    return raw.decode('utf-8', errors='ignore')


def split_chapters(text):
    lines = text.split('\n')
    chapters = []
    cur = None
    for line in lines:
        if CHAPTER_RE.match(line):
            if cur:
                chapters.append(cur)
            title = line.strip()[:40] or ('第%d节' % (len(chapters) + 1))
            cur = {'title': title, 'paras': []}
        else:
            if cur is None:
                cur = {'title': '正文', 'paras': []}
            if line.strip():
                cur['paras'].append(line.strip())
    if cur:
        chapters.append(cur)
    if not chapters:
        chapters.append({'title': '全文', 'paras': [l for l in lines if l.strip()]})
    return chapters


def esc(s):
    return html.escape(s, quote=True)


def build_chapter_xhtml(chapter):
    body = ''.join(
        '<p style="text-indent:2em;line-height:1.8">%s</p>' % esc(p) for p in chapter['paras']
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" '
        '"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n'
        '<html xmlns="http://www.w3.org/1999/xhtml">\n'
        '<head><meta charset="utf-8"/><title>%s</title></head>\n'
        '<body>\n<h2>%s</h2>\n%s\n</body>\n</html>\n'
        % (esc(chapter['title']), esc(chapter['title']), body)
    )


def build_opf(meta, chapters):
    manifest = ['<item id="ncx" href="toc.ncx" media-type="application/x-dash+xml"/>']
    spine = []
    for i, ch in enumerate(chapters):
        fid = 'chap%d' % i
        manifest.append('<item id="%s" href="text/chap%d.xhtml" media-type="application/xhtml+xml"/>' % (fid, i))
        spine.append('<itemref idref="%s"/>' % fid)
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">\n'
        '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
        '    <dc:identifier id="bookid">urn:uuid:%s</dc:identifier>\n'
        '    <dc:title>%s</dc:title>\n'
        '    <dc:creator>%s</dc:creator>\n'
        '    <dc:language>zh</dc:language>\n'
        '    <dc:date>%s</dc:date>\n'
        '    <meta name="generator" content="txt_to_epub.py"/>\n'
        '  </metadata>\n'
        '  <manifest>\n    %s\n  </manifest>\n'
        '  <spine toc="ncx">\n    %s\n  </spine>\n'
        '</package>\n'
        % (meta['uuid'], esc(meta['title']), esc(meta['author']), now,
           '\n    '.join(manifest), '\n    '.join(spine))
    )


def build_ncx(meta, chapters):
    nav = []
    for i, ch in enumerate(chapters):
        nav.append(
            '    <navPoint id="nav%d" playOrder="%d">\n'
            '      <navLabel><text>%s</text></navLabel>\n'
            '      <content src="text/chap%d.xhtml"/>\n'
            '    </navPoint>' % (i, i + 1, esc(ch['title']), i)
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
        '  <head>\n'
        '    <meta name="dtb:uid" content="urn:uuid:%s"/>\n'
        '    <meta name="dtb:depth" content="1"/>\n'
        '    <meta name="dtb:totalPageCount" content="0"/>\n'
        '    <meta name="dtb:maxPageNumber" content="0"/>\n'
        '  </head>\n'
        '  <docTitle><text>%s</text></docTitle>\n'
        '  <navMap>\n%s\n  </navMap>\n'
        '</ncx>\n'
        % (meta['uuid'], esc(meta['title']), '\n'.join(nav))
    )


def convert(input_path, output_path, title=None, author='佚名'):
    import uuid
    text = read_text(input_path)
    chapters = split_chapters(text)
    meta = {
        'uuid': str(uuid.uuid4()),
        'title': title or os.path.splitext(os.path.basename(input_path))[0],
        'author': author,
    }

    # mimetype 必须是未压缩的第一个条目
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', CONTAINER_XML)
        z.writestr('OEBPS/content.opf', build_opf(meta, chapters))
        z.writestr('OEBPS/toc.ncx', build_ncx(meta, chapters))
        for i, ch in enumerate(chapters):
            z.writestr('OEBPS/text/chap%d.xhtml' % i, build_chapter_xhtml(ch))

    print('已生成：%s（共 %d 章）' % (output_path, len(chapters)))
    return output_path


def main():
    ap = argparse.ArgumentParser(description='纯文本小说转 EPUB（标准库实现）')
    ap.add_argument('input', help='输入的 .txt 文件')
    ap.add_argument('-o', '--output', help='输出 .epub 路径（默认与输入同名）')
    ap.add_argument('--title', help='书名（默认取文件名）')
    ap.add_argument('--author', default='佚名', help='作者（默认「佚名」')
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        print('错误：找不到输入文件 %s' % args.input, file=sys.stderr)
        sys.exit(1)

    out = args.output or (os.path.splitext(args.input)[0] + '.epub')
    convert(args.input, out, title=args.title, author=args.author)


if __name__ == '__main__':
    main()
