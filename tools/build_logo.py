#!/usr/bin/env python3
"""Extract the genuine title-screen logo without changing its artwork pixels."""
from pathlib import Path
import base64
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/sheets/6558-title-screen-usa.png'
RECT = (285, 447, 167, 88)
PANEL_KEY = (112, 216, 248)


def main():
    source = Image.open(SOURCE).convert('RGBA')
    x, y, width, height = RECT
    logo = source.crop((x, y, x + width, y + height))
    pixels = list(logo.getdata())
    removed = sum(p[:3] == PANEL_KEY for p in pixels)
    logo.putdata([(r, g, b, 0 if (r, g, b) == PANEL_KEY else a) for r, g, b, a in pixels])
    path = ROOT / 'assets/ui/game-logo.png'
    logo.save(path)
    # Pixel verification: all non-key game artwork remains byte-for-byte exact.
    assert all(after[:3] == before[:3] and after[3] == before[3]
               for before, after in zip(pixels, logo.getdata()) if before[:3] != PANEL_KEY)
    assert logo.getchannel('A').getextrema() == (0, 255)
    metadata = {
        'version': 1, 'name': 'The Legend of Zelda: The Minish Cap',
        'path': 'assets/ui/game-logo.png', 'width': width, 'height': height,
        'sourceId': '6558', 'sourceRect': {'x': x, 'y': y, 'w': width, 'h': height},
        'sourceUrl': 'https://www.spriters-resource.com/game_boy_advance/thelegendofzeldatheminishcap/asset/6558/',
        'contributors': 'Yue', 'originalGameArtwork': 'Nintendo / Capcom',
        'backgroundKey': list(PANEL_KEY), 'backgroundPixelsRemoved': removed,
        'verification': 'All logo artwork RGB and alpha pixels unchanged; only the exact reserved blue presentation key is made transparent.',
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'dataUrl': 'data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode('ascii')
    }
    (ROOT / 'assets/logo.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (ROOT / 'assets/logo.js').write_text('window.MINISH_LOGO=' + json.dumps(metadata, separators=(',', ':')) + ';\n')
    print('Extracted exact source logo:', path, 'background pixels:', removed)


if __name__ == '__main__':
    main()
