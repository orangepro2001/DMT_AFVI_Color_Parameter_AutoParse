# -*- coding: utf-8 -*-
"""Inline src/*.css|js into SpecParamTool.html (the distributable single file).

Development happens in index.html + src/*.js (see TOOL_ARCHITECTURE.md).
This script assembles the single-file tool that can be copied to any machine:

    python build.py

The output is byte-for-byte reproducible from the sources; index.html stays
the entry point for development (works from file:// without a build).
"""
import io, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'src')
OUT = os.path.join(BASE, 'SpecParamTool.html')


def read(path):
    return io.open(path, encoding='utf-8').read()


def main():
    html = read(os.path.join(BASE, 'index.html'))

    def inline_css(m):
        path = os.path.join(BASE, m.group(1).replace('/', os.sep))
        return '<style>\n' + read(path).rstrip('\n') + '\n</style>'

    def inline_js(m):
        path = os.path.join(BASE, m.group(1).replace('/', os.sep))
        body = read(path).rstrip('\n')
        if '</script>' in body:
            raise SystemExit('ERROR: %s contains a literal </script>' % m.group(1))
        return '<script>\n' + body + '\n</script>'

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)

    if '<link rel="stylesheet"' in html or '<script src=' in html:
        raise SystemExit('ERROR: some assets were not inlined')

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(html)
    print('wrote %s (%d bytes, %d lines)' % (OUT, len(html.encode('utf-8')), html.count('\n')))


if __name__ == '__main__':
    main()
