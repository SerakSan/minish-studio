#!/usr/bin/env python3
"""Keep the offline page in sync with the animation workspace source snippets."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
index = ROOT / 'index.html'
source = index.read_text()
source = source.replace('<main class="studio-layout">', '<main id="sceneWorkspace" class="studio-layout">')
for name, marker, anchor in [
    ('animation-mode-switch.html', 'ANIMATION_MODE_SWITCH', '    <div class="game-logo"'),
    ('animation-shell.html', 'ANIMATION_WORKSPACE', '  <div class="toast"'),
]:
    block = '<!-- ' + marker + '_START -->\n' + (ROOT / name).read_text().strip() + '\n<!-- ' + marker + '_END -->\n'
    pattern = r'<!-- ' + marker + r'_START -->[\s\S]*?<!-- ' + marker + r'_END -->\n?'
    if re.search(pattern, source):
        source = re.sub(pattern, lambda _: block, source)
    else:
        if anchor not in source:
            raise SystemExit('Missing page insertion point for ' + name)
        source = source.replace(anchor, block + anchor, 1)
index.write_text(source)
print('Animation switch and workspace markup synchronized.')
