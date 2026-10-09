"""Genera dist/trastes.html: la app en un solo archivo (sin service worker), útil para alojarla en cualquier sitio."""
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text()
css = (root / 'style.css').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '</style>')
html = re.sub(r'\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>', '', html)
def inline(m):
    return '<script>\n' + (root / m.group(1)).read_text() + '</script>'
html = re.sub(r'<script src="(js/[\w-]+\.js)"></script>', inline, html)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'trastes.html').write_text(html)
print('dist/trastes.html', len(html), 'bytes')
# Variante para publicar como Artifact: solo el contenido, sin doctype/html/head/body.
art = re.sub(r'<!doctype html>\s*|</?html[^>]*>|</?head>|</?body>|<meta [^>]*>\s*', '', html)
(root / 'dist' / 'artifact.html').write_text(art.strip() + '\n')
