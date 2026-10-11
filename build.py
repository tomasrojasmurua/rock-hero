"""Genera dist/frets.html: la app en un solo archivo (sin service worker), útil para alojarla en cualquier sitio."""
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text()
css = (root / 'style.css').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '</style>')
html = re.sub(r'\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>', '', html)
def inline(m):
    return '<script>\n' + (root / m.group(1)).read_text() + '</script>'
html = re.sub(r'<script src="(js/[\w-]+\.js)"></script>', inline, html)
html = html.replace('<script src="vendor/peerjs/peerjs.min.js"></script>', '<script src="https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js"></script>')
# Three.js desde CDN en la versión de un solo archivo
html = html.replace('./vendor/three/three.module.min.js', 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js')
html = html.replace('./vendor/three/addons/', 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/')
html = re.sub(r'<script type="module" src="(js/[\w-]+\.js)"></script>',
              lambda m: '<script type="module">\n' + (root / m.group(1)).read_text() + '</script>', html)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'frets.html').write_text(html)
print('dist/frets.html', len(html), 'bytes')
# Variante para publicar como Artifact: solo el contenido, sin doctype/html/head/body.
art = re.sub(r'<!doctype html>\s*|</?html[^>]*>|</?head>|</?body>|<meta [^>]*>\s*', '', html)
(root / 'dist' / 'artifact.html').write_text(art.strip() + '\n')
