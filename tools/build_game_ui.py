#!/usr/bin/env python3
"""Derive the maker's lettering and frames from unchanged game artwork.

Rebuilding requires Pillow and fonttools. The finished editor has no dependencies.
"""
from pathlib import Path
import base64
import io
import json
import sys
from collections import deque
from PIL import Image

try:
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
except ImportError:
    raise SystemExit('Rebuilding game UI lettering requires fonttools. Install the project requirements first.')

ROOT = Path(__file__).resolve().parents[1]


def uri(data, mime='image/png'):
    return 'data:' + mime + ';base64,' + base64.b64encode(data).decode()


def png(image):
    stream = io.BytesIO()
    image.save(stream, 'PNG')
    return stream.getvalue()


def clear_border(image, rgb):
    image = image.copy()
    pixels = image.load()
    todo = deque()
    seen = set()
    for x in range(image.width):
        todo.extend(((x, 0), (x, image.height - 1)))
    for y in range(image.height):
        todo.extend(((0, y), (image.width - 1, y)))
    while todo:
        x, y = todo.popleft()
        if (x, y) in seen or not (0 <= x < image.width and 0 <= y < image.height):
            continue
        seen.add((x, y))
        if pixels[x, y][:3] != rgb:
            continue
        pixels[x, y] = (*rgb, 0)
        todo.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    return image


def main():
    catalog = json.loads((ROOT / 'assets/catalog.json').read_text())
    assets = {str(a['id']): a for a in catalog['assets']}
    font_source = Image.open(ROOT / assets['6455']['path']).convert('RGBA')
    item_source = Image.open(ROOT / assets['6437']['path']).convert('RGBA')
    rows = [(50, 'abcdefghijklm'), (66, 'nopqrstuvwxyz'),
            (82, 'àáâãäæçèéêëìí'), (114, '0123456789,.'),
            (134, 'ABCDEFGHIJKLM'), (150, 'NOPQRSTUVWXYZ'),
            (166, 'ÀÁÂÃÄÆÇÈÉÊËÌÍ')]
    letters = {}
    for y, chars in rows:
        for column, char in enumerate(chars):
            cell = font_source.crop((20 + column * 16, y, 36 + column * 16, y + 16))
            mask = Image.new('L', cell.size)
            mask.putdata([255 if p[:3] == (248, 248, 248) else 0 for p in cell.getdata()])
            bounds = mask.getbbox()
            if not bounds:
                continue
            glyph = Image.new('RGBA', (bounds[2] - bounds[0], 16), (248, 248, 248, 0))
            glyph.putalpha(mask.crop((bounds[0], 0, bounds[2], 16)))
            letters[char] = glyph
    # The final normal-font cell contains the source's hyphen.
    cell = font_source.crop((212, 182, 228, 198))
    mask = Image.new('L', cell.size)
    mask.putdata([255 if p[:3] == (248, 248, 248) else 0 for p in cell.getdata()])
    bounds = mask.getbbox()
    if bounds:
        glyph = Image.new('RGBA', (bounds[2] - bounds[0], 16), (248, 248, 248, 0))
        glyph.putalpha(mask.crop((bounds[0], 0, bounds[2], 16)))
        letters['-'] = glyph
    atlas = Image.new('RGBA', (16 * 12, ((len(letters) + 15) // 16) * 16))
    glyphs = {}
    for index, (char, glyph) in enumerate(letters.items()):
        x, y = (index % 16) * 12, (index // 16) * 16
        atlas.paste(glyph, (x, y))
        glyphs[char] = {'x': x, 'y': y, 'w': glyph.width, 'h': 16, 'advance': glyph.width + 1}
    glyphs[' '] = {'x': 0, 'y': 0, 'w': 0, 'h': 16, 'advance': 4}

    order = ['.notdef', 'space'] + ['u%04X' % ord(char) for char in letters]
    font_builder = FontBuilder(1024, isTTF=True)
    font_builder.setupGlyphOrder(order)
    font_builder.setupCharacterMap({32: 'space', **{ord(c): 'u%04X' % ord(c) for c in letters}})
    outlines, metrics = {}, {}
    for name in ('.notdef', 'space'):
        outlines[name] = TTGlyphPen(None).glyph()
        metrics[name] = (256, 0)
    for char, glyph in letters.items():
        pen = TTGlyphPen(None)
        alpha = glyph.getchannel('A')
        for y in range(16):
            x = 0
            while x < glyph.width:
                if not alpha.getpixel((x, y)):
                    x += 1
                    continue
                end = x + 1
                while end < glyph.width and alpha.getpixel((end, y)):
                    end += 1
                left, right, top, bottom = x * 64, end * 64, (14 - y) * 64, (13 - y) * 64
                pen.moveTo((left, bottom))
                pen.lineTo((left, top))
                pen.lineTo((right, top))
                pen.lineTo((right, bottom))
                pen.closePath()
                x = end
        name = 'u%04X' % ord(char)
        outlines[name] = pen.glyph()
        metrics[name] = ((glyph.width + 1) * 64, 0)
    font_builder.setupGlyf(outlines)
    font_builder.setupHorizontalMetrics(metrics)
    font_builder.setupHorizontalHeader(ascent=896, descent=-128)
    font_builder.setupOS2(sTypoAscender=896, sTypoDescender=-128, usWinAscent=896, usWinDescent=128)
    font_builder.setupNameTable({'familyName': 'Minish Game', 'styleName': 'Regular',
                                'uniqueFontIdentifier': 'MinishStudio.Source6455.1',
                                'fullName': 'Minish Game Regular', 'psName': 'MinishGame-Regular',
                                'copyright': 'Game artwork Nintendo / Capcom. Source font ripped by Aquatics64, The Spriters Resource asset 6455.'})
    font_builder.setupPost()
    font_builder.setupMaxp()
    output = ROOT / 'assets/ui'
    output.mkdir(parents=True, exist_ok=True)
    font_builder.save(output / 'minish-game.ttf')
    atlas.save(output / 'font-atlas.png')

    def art(name, source, rect, slice=None, key=None):
        image = source.crop(rect)
        if key:
            image = clear_border(image, key)
        data = png(image)
        (output / (name + '.png')).write_bytes(data)
        result = {'dataUrl': uri(data), 'path': 'assets/ui/' + name + '.png',
                  'width': image.width, 'height': image.height, 'sourceRect': list(rect)}
        if slice is not None:
            result['slice'] = slice
        return result

    result = {'version': 1, 'sourceId': '6455', 'sourceUrl': assets['6455']['sourceUrl'],
              'contributors': assets['6455'].get('contributors'),
              'cssFontDataUrl': uri((output / 'minish-game.ttf').read_bytes(), 'font/ttf'),
              'font': {'dataUrl': uri(png(atlas)), 'glyphs': glyphs, 'cellHeight': 16,
                       'nominalSize': 12, 'lineHeight': 16, 'missingAdvance': 6},
              'dialogue': art('dialogue-frame', font_source, (249, 14, 473, 62), 6, (64, 176, 136)),
              'pointer': art('dialogue-arrow', font_source, (288, 76, 300, 86), None, (64, 176, 136)),
              'inventoryFrame': art('inventory-frame', item_source, (7, 57, 214, 190), 16),
              'menuTab': art('menu-tab', item_source, (6, 2, 120, 24), 3),
              'menuPattern': art('ezlo-pattern', item_source, (316, 319, 556, 479)),
              'itemSourceUrl': assets['6437']['sourceUrl']}
    result['dialogue']['padding'] = 10
    (ROOT / 'assets/game-ui.js').write_text('window.MINISH_GAME_UI=' + json.dumps(result, ensure_ascii=False, separators=(',', ':')) + ';\n')
    (output / 'credits.json').write_text(json.dumps({k: v for k, v in result.items() if k not in ('font', 'cssFontDataUrl')}, ensure_ascii=False, indent=2))
    print(json.dumps({'glyphs': len(glyphs), 'fontBytes': (output / 'minish-game.ttf').stat().st_size,
                      'sourceSheetsUnchanged': True, 'gameUI': 'assets/game-ui.js'}))


if __name__ == '__main__':
    main()
