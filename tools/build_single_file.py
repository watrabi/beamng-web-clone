# Bundle the game into one HTML file (game code inline, three.js from jsDelivr,
# sky HDR inlined as a data URI). Usage: python3 tools/build_single_file.py . out/index.html
import re, sys, os, base64
root = sys.argv[1]; out = sys.argv[2]
order = ['physics','world','maps','carbody','flexmesh','vehicle','props','input','audio','main']
code = ["import * as THREE from 'three';", "import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';"]
for m in order:
    s = open(f'{root}/src/{m}.js').read()
    s = re.sub(r"^import .*?;\s*$", "", s, flags=re.M)
    s = re.sub(r"^export (const|class|function) ", r"\1 ", s, flags=re.M)
    code.append(f"// ---- {m}.js ----\n" + s)
html = open(f'{root}/index.html').read()
html = re.sub(r"<!doctype html>\s*<html[^>]*>\s*<head>\s*", "", html)
html = html.replace("</head>\n<body>\n", "").replace("</body>\n</html>\n", "")
html = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', "", html)
# put title first
t = re.search(r"<title>.*?</title>\s*", html).group(0)
html = t + html.replace(t, "")
html = re.sub(r'<script type="importmap">.*?</script>', '<script type="importmap">\n{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/" } }\n</script>', html, flags=re.S)
html = html.replace('<script type="module" src="src/main.js"></script>', '<script type="module">\n' + "\n".join(code) + '\n</script>')
html = html.replace("html, body { margin: 0; height: 100%;", "html, body { margin: 0; height: 100%; background: #0d1014;")
sky = base64.b64encode(open(f'{root}/assets/hdri/sky_1k.hdr', 'rb').read()).decode()
html = html.replace("'assets/hdri/sky_1k.hdr'", "SKY_HDR")
html = html.replace('<script type="module">\n', '<script type="module">\nconst SKY_HDR = \'data:application/octet-stream;base64,' + sky + '\';\n', 1)
open(out, 'w').write(html)
print(len(html))
