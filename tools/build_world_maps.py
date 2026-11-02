#!/usr/bin/env python3
"""Build credited whole-Hyrule map assets without changing source artwork."""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/world'
MANIFEST = OUT / 'source-manifest.json'
JSON_OUT = ROOT / 'assets/world-maps.json'
JS_OUT = ROOT / 'assets/world-maps.js'

# The source already has transparent paper around its terrain. These two
# rectangles contain only the map compiler's heading and credit/contact text.
# The unchanged download retains that attribution; runtime metadata records it.
ANNOTATIONS = [
    {'x': 2976, 'y': 0, 'w': 2016, 'h': 192, 'reason': 'Community title outside terrain'},
    {'x': 3984, 'y': 2208, 'w': 1008, 'h': 960, 'reason': 'Community credit and contact panel outside terrain'},
]
ILLUSTRATED_RECT = {'x': 331, 'y': 169, 'w': 164, 'h': 131}

# These are thematic source-atlas bounds, not game-engine room IDs or collision
# maps. Cloud layers retain their separate inset positions in the credited map.
REGIONS = [
    ('crenel', 'Mount Crenel', 'mountain', (0, 0, 1008, 1200)),
    ('crenel-base', "Mount Crenel's Base", 'mountain', (0, 1200, 1008, 480)),
    ('royal-valley', 'Royal Valley', 'graveyard', (1008, 192, 480, 1008)),
    ('castle', 'Hyrule Castle Garden', 'town', (1488, 192, 1008, 528)),
    ('veil-falls', 'Veil Falls', 'mountain', (2496, 0, 480, 1200)),
    ('north-field', 'North Hyrule Field', 'field', (1488, 720, 1008, 800)),
    ('trilby', 'Trilby Highlands', 'field', (1008, 1200, 480, 960)),
    ('town', 'Hyrule Town', 'town', (1488, 1520, 1008, 960)),
    ('ranch', 'Lon Lon Ranch', 'ranch', (2496, 1200, 720, 960)),
    ('lake', 'Lake Hylia', 'lake', (3216, 1200, 768, 960)),
    ('castor', 'Castor Wilds', 'swamp', (0, 1680, 1008, 960)),
    ('western-wood', 'Western Wood', 'woods', (1008, 2160, 480, 1008)),
    ('south-field', 'South Hyrule Field', 'field', (1488, 2480, 1008, 688)),
    ('eastern-hills', 'Eastern Hills', 'field', (2496, 2160, 480, 1008)),
    ('woods', 'Minish Woods', 'woods', (2976, 2160, 1008, 1008)),
    ('wind-ruins', 'Wind Ruins', 'ruins', (0, 2640, 1008, 528)),
    ('wind-tribe', 'Home of the Wind Tribe', 'sky', (2976, 192, 1008, 1008)),
    ('cloud-upper', 'Cloud Tops: upper inset', 'sky', (3984, 192, 1008, 1008)),
    ('cloud-lower', 'Cloud Tops: lower inset', 'sky', (3984, 1200, 1008, 1008)),
]

# Full sprite bounds fit inside these visually reviewed open-ground rectangles.
# Tiny flower/grass textures remain genuine ground. This is composition guidance,
# not a claim that the editor simulates the game's collisions.
GROUND_LOCATIONS = [
    ('crenel-peak', 'Mount Crenel: summit path', 'mountain', (224, 112, 48, 48)),
    ('crenel-base', 'Mount Crenel: sandy ledge', 'mountain', (502, 1384, 72, 64)),
    ('trilby-north', 'Trilby Highlands: northern clearing', 'field', (1168, 1352, 88, 48)),
    ('trilby-south', 'Trilby Highlands: grass path', 'field', (1304, 1816, 32, 48)),
    ('western-north', 'Western Wood: northern grass', 'woods', (1136, 2295, 64, 30)),
    ('western-south', 'Western Wood: southern path', 'woods', (1257, 2724, 48, 88)),
    ('western-crossing', 'Western Wood: path crossing', 'woods', (1182, 2674, 88, 40)),
    ('castor-platform', 'Castor Wilds: grassy platform', 'swamp', (384, 2000, 64, 32)),
    ('wind-ruins-path', 'Wind Ruins: stone path', 'ruins', (662, 2816, 32, 96)),
    ('wind-ruins-grass', 'Wind Ruins: grass clearing', 'ruins', (580, 2914, 48, 40)),
    ('royal-valley', 'Royal Valley: cemetery path', 'graveyard', (1316, 700, 64, 40)),
    ('royal-forest', 'Royal Valley: forest clearing', 'graveyard', (1286, 1040, 96, 56)),
    ('castle-garden', 'Hyrule Castle: garden path', 'town', (1968, 544, 64, 112)),
    ('north-field-west', 'North Hyrule Field: western grass', 'field', (1932, 1024, 40, 64)),
    ('north-field-path', 'North Hyrule Field: central path', 'field', (1936, 1280, 64, 96)),
    ('north-field-east', 'North Hyrule Field: eastern grass', 'field', (2308, 1300, 56, 112)),
    ('town-square', 'Hyrule Town: north square', 'town', (1922, 1936, 120, 44)),
    ('town-south', 'Hyrule Town: south street', 'town', (1948, 2270, 104, 64)),
    ('town-west', 'Hyrule Town: western lawn', 'town', (1596, 1990, 48, 40)),
    ('south-field-north', 'South Hyrule Field: northern path', 'field', (1982, 2695, 64, 96)),
    ('south-field-south', 'South Hyrule Field: southern clearing', 'field', (1852, 3080, 144, 32)),
    ('eastern-north', 'Eastern Hills: northern path', 'field', (2792, 2420, 40, 128)),
    ('eastern-south', 'Eastern Hills: southern path', 'field', (2602, 2886, 80, 32)),
    ('ranch-yard', 'Lon Lon Ranch: fenced yard', 'ranch', (2912, 1728, 56, 32)),
    ('ranch-north', 'Lon Lon Ranch: northern grass', 'ranch', (2860, 1340, 80, 40)),
    ('woods-north', 'Minish Woods: northern clearing', 'woods', (3333, 2621, 43, 38)),
    ('woods-east', 'Minish Woods: eastern path', 'woods', (3728, 3064, 64, 48)),
    ('woods-west', 'Minish Woods: forest grass', 'woods', (3402, 2992, 40, 36)),
    ('veil-falls', 'Veil Falls: plateau', 'mountain', (2740, 678, 128, 36)),
    ('wind-tribe', 'Wind Tribe: cloud platform', 'sky', (3484, 584, 64, 64)),
    ('cloud-upper', 'Cloud Tops: upper cloud path', 'sky', (4612, 556, 64, 96)),
    ('cloud-upper-east', 'Cloud Tops: eastern cloud path', 'sky', (4870, 1008, 48, 48)),
    ('cloud-lower', 'Cloud Tops: lower cloud clearing', 'sky', (4460, 1640, 48, 48)),
]
BOSS_LOCATIONS = [
    {'id': 'lake-encounter', 'name': 'Lake Hylia: water encounter', 'theme': 'lake',
     'rect': {'x': 3788, 'y': 1520, 'w': 136, 'h': 320}, 'allowedRoles': ['boss'],
     'bossAllowed': True, 'bossFamilies': ['full-boss-6506'],
     'note': 'Lake water east of the central tree island, including genuine floating ice patches. Excludes the island and shore.'},
    {'id': 'sky-encounter', 'name': 'Wind Tribe: sky encounter', 'theme': 'sky',
     'rect': {'x': 3296, 'y': 800, 'w': 624, 'h': 320}, 'allowedRoles': ['boss'],
     'bossAllowed': True, 'bossFamilies': ['full-boss-6461', 'full-boss-6534', 'full-boss-31116', 'full-boss-6535'],
     'note': 'Open sky south of the cloud platform for flying Gyorgs and floating Vaati forms. Excludes cloud walls; ground actors use the separate platform locations.'},
    {'id': 'sky-west-encounter', 'name': 'Wind Tribe: western sky', 'theme': 'sky',
     'rect': {'x': 3032, 'y': 304, 'w': 224, 'h': 368}, 'allowedRoles': ['boss'],
     'bossAllowed': True, 'bossFamilies': ['full-boss-6534', 'full-boss-31116', 'full-boss-6535'],
     'note': 'Open sky west of the central building and its platform, without cloud-wall tiles.'},
    {'id': 'castle-battle-plaza', 'name': 'Hyrule Castle: courtyard showdown', 'theme': 'town',
     'rect': {'x': 1904, 'y': 272, 'w': 192, 'h': 152},
     'bossAllowed': True, 'bossFamilies': ['full-boss-6415', 'full-boss-6460', 'full-boss-6546'],
     'note': 'Paved courtyard and grass between the entrance steps and hedges. Complete native sprite bounds fit without covering the building or guard.'},
    {'id': 'north-field-battle-strip', 'name': 'North Hyrule Field: southern approach', 'theme': 'field',
     'rect': {'x': 2072, 'y': 1392, 'w': 272, 'h': 96},
     'bossAllowed': True, 'bossFamilies': ['full-boss-535841', 'full-boss-6546'],
     'note': 'Clear dirt and grass below the trees and above the town wall. Only Mazaal poses whose full bounds fit this short strip are eligible.'},
    {'id': 'north-field-battle-clearing', 'name': 'North Hyrule Field: southeast showdown', 'theme': 'field',
     'rect': {'x': 2168, 'y': 1368, 'w': 192, 'h': 112},
     'bossAllowed': True, 'bossFamilies': ['full-boss-6415', 'full-boss-6460', 'full-boss-6546'],
     'note': 'Clear grass and dirt east of the tree line, excluding the flower plants and town wall. Alternative to the overlapping southern-approach area.'},
    {'id': 'ranch-west-boss', 'name': 'Lon Lon Ranch: western roadblock', 'theme': 'ranch',
     'rect': {'x': 2540, 'y': 1480, 'w': 96, 'h': 192}, 'allowedRoles': ['boss'],
     'bossAllowed': True, 'bossFamilies': ['full-boss-6415', 'full-boss-6460', 'full-boss-6546'],
     'note': 'Narrow dirt road west of the ranch, between the town wall and rocky ledge. Single-boss bounds fit; neighboring scenery is retained.'},
    {'id': 'south-field-boss-road', 'name': 'South Hyrule Field: a blocked road', 'theme': 'field',
     'rect': {'x': 1952, 'y': 2704, 'w': 88, 'h': 200}, 'allowedRoles': ['boss'],
     'bossAllowed': True, 'bossFamilies': ['full-boss-6415', 'full-boss-6460', 'full-boss-6546'],
     'note': 'Open central dirt road between the trees and the raised house plot. Narrow single-boss placement avoids the cliff and plants.'},
    {'id': 'south-field-battle-crossing', 'name': 'South Hyrule Field: crossroads battle', 'theme': 'field',
     'rect': {'x': 1938, 'y': 2994, 'w': 176, 'h': 112},
     'bossAllowed': True, 'bossFamilies': ['full-boss-6415', 'full-boss-6460', 'full-boss-6546'],
     'note': 'Clear dirt and grass at the southern road bend, below the house plot and above the tree line.'},
]


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rectangle(values):
    return dict(zip(('x', 'y', 'w', 'h'), values))


def box(rect):
    return rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h']


def data_url(image):
    buffer = io.BytesIO()
    image.save(buffer, format='PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')


def source_image(source):
    path = ROOT / source['originalPath']
    assert source['status'] in {'downloaded', 'already-downloaded-existing-source'}, source['id']
    assert digest(path) == source['originalSha256'], source['id']
    return Image.open(path).convert('RGBA')


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = {item['id']: item for item in load(MANIFEST)['sources']}
    source = sources['vgmaps-hyrule-rocktyt']
    terrain = source_image(source)
    assert terrain.size == (4992, 3168)
    alpha = terrain.getchannel('A')
    for rect in ANNOTATIONS:
        x, y, right, bottom = box(rect)
        ImageDraw.Draw(alpha).rectangle((x, y, right - 1, bottom - 1), fill=0)
    terrain.putalpha(alpha)
    illustrated_source = sources['6492']
    illustrated = source_image(illustrated_source).crop(box(ILLUSTRATED_RECT))
    result = {'version': 1, 'assets': [], 'catalog': [], 'sheets': {}, 'worlds': [],
              'notes': ['Source downloads and contributor attribution are preserved separately.',
                        'Terrain is a credited overworld atlas. Cloud layers are separate source-map insets, not continuous adjacent terrain.',
                        'The illustrated map is genuine menu-map artwork and does not represent playable ground tiles.',
                        'Placement locations are reviewed composition areas, not extracted collision data.']}

    def add(aid, name, image, src, source_rect, style, scale, exclusions):
        path = OUT / (aid + '.png')
        image.save(path, optimize=True)
        thumb = image.copy()
        thumb.thumbnail((160, 112), Image.Resampling.NEAREST)
        thumb_path = OUT / (aid + '-thumbnail.png')
        thumb.save(thumb_path, optimize=True)
        asset = {'id': aid, 'name': name, 'sourceId': src['id'], 'originalSourceId': src['id'],
                 'section': 'Maps', 'category': 'environments', 'width': image.width, 'height': image.height,
                 'path': path.relative_to(ROOT).as_posix(), 'dataUrl': data_url(image),
                 'thumbnail': thumb_path.relative_to(ROOT).as_posix(), 'thumbnailDataUrl': data_url(thumb),
                 'sha256': digest(path), 'sourceUrl': src['sourceUrl'], 'contributors': src['contributors'],
                 'originalPath': src['originalPath'], 'originalSha256': src['originalSha256'],
                 'sourceRect': source_rect, 'annotationOnlyRects': exclusions,
                 'derivation': 'exact-source-region-with-reviewed-annotation-alpha-exclusions' if exclusions else 'exact-source-region'}
        piece = {'id': aid, 'name': name, 'assetId': aid, 'sourceId': aid, 'originalSourceId': src['id'],
                 'sx': 0, 'sy': 0, 'sw': image.width, 'sh': image.height, 'sourceRect': source_rect,
                 'kind': 'environment', 'group': 'Whole Hyrule maps', 'thumbnailDataUrl': asset['thumbnailDataUrl'],
                 'representation': 'credited-overworld-atlas' if style == 'terrain' else 'illustrated-game-map'}
        result['assets'].append(asset)
        result['catalog'].append({**{key: value for key, value in asset.items() if key != 'dataUrl'}, 'sourceId': aid})
        result['sheets'][aid] = {'sourceId': aid, 'category': 'environments', 'pieces': [piece],
                                 'coverPieceId': aid, 'curated': True}
        world = {'id': 'hyrule' if style == 'terrain' else 'hyrule-illustrated', 'name': name,
                 'style': style, 'presetId': aid, 'pieceId': aid, 'assetId': aid, 'sourceId': aid,
                 'originalSourceId': src['id'], 'width': image.width, 'height': image.height,
                 'backgroundScale': scale, 'canvasWidth': image.width * scale,
                 'canvasHeight': image.height * scale, 'sourceRect': source_rect,
                 'locations': [], 'regions': [], 'annotationOnlyRects': exclusions,
                 'scope': 'Overworld atlas with separate cloud-layer insets. Does not include every dungeon, interior, layer or state.' if style == 'terrain' else 'Illustrated menu-map overview, enlarged with nearest-neighbor integer scaling.'}
        result['worlds'].append(world)
        return world

    world = add('world-hyrule', 'Hyrule: whole overworld', terrain, source,
                rectangle((0, 0, 4992, 3168)), 'terrain', 1, ANNOTATIONS)
    world['regions'] = [{'id': rid, 'name': name, 'theme': theme, 'rect': rectangle(rect)}
                        for rid, name, theme, rect in REGIONS]
    world['locations'] = [{'id': lid, 'name': name, 'theme': theme, 'rect': rectangle(rect),
                           'bossAllowed': False, 'placement': 'full-bounds'}
                          for lid, name, theme, rect in GROUND_LOCATIONS] + BOSS_LOCATIONS
    illustrated_world = add('world-hyrule-illustrated', 'Hyrule: illustrated map', illustrated,
                            illustrated_source, ILLUSTRATED_RECT, 'illustrated', 8, [])
    # Native map coordinates. The scene generator multiplies these by the
    # world's integer backgroundScale before placing ordinary sprite artwork.
    mini_regions = [
        ('crenel', 'Mount Crenel', 'mountain', (2, 2, 36, 44)),
        ('crenel-base', "Mount Crenel's Base", 'mountain', (2, 51, 36, 12)),
        ('castor', 'Castor Wilds', 'swamp', (2, 68, 36, 36)),
        ('wind-ruins', 'Wind Ruins', 'ruins', (2, 109, 36, 20)),
        ('valley', 'Royal Valley', 'graveyard', (43, 2, 16, 44)),
        ('trilby', 'Trilby Highlands', 'field', (43, 51, 16, 36)),
        ('western-wood', 'Western Wood', 'woods', (43, 92, 16, 36)),
        ('castle', 'Hyrule Castle Garden', 'town', (64, 2, 36, 28)),
        ('north-field', 'North Hyrule Field', 'field', (64, 35, 36, 24)),
        ('town', 'Hyrule Town', 'town', (64, 64, 36, 36)),
        ('south-field', 'South Hyrule Field', 'field', (64, 105, 36, 24)),
        ('veil', 'Veil Falls', 'mountain', (105, 2, 16, 44)),
        ('ranch', 'Lon Lon Ranch', 'ranch', (105, 52, 24, 36)),
        ('eastern-hills', 'Eastern Hills', 'field', (105, 93, 16, 36)),
        ('clouds', 'Cloud Tops', 'sky', (126, 2, 36, 36)),
        ('lake', 'Lake Hylia', 'lake', (134, 44, 28, 44)),
        ('woods', 'Minish Woods', 'woods', (126, 93, 36, 36)),
    ]
    illustrated_world['regions'] = [{'id': rid, 'name': name, 'theme': theme, 'rect': rectangle(rect)}
                                   for rid, name, theme, rect in mini_regions]
    illustrated_world['locations'] = [{**region, 'bossAllowed': True, 'placement': 'illustrated-map'}
                                     for region in illustrated_world['regions']]
    write(JSON_OUT, result)
    JS_OUT.write_text('window.MINISH_WORLD_MAPS=' + json.dumps(result, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    return result


def verify(data):
    embedded = JS_OUT.read_text(encoding='utf-8')
    prefix = 'window.MINISH_WORLD_MAPS='
    assert embedded.startswith(prefix) and embedded.endswith(';\n')
    assert json.loads(embedded[len(prefix):-2]) == data
    sources = {item['id']: item for item in load(MANIFEST)['sources']}
    for source in sources.values():
        source_image(source)
    # New maps must never modify the previous source collection.
    catalog = load(ROOT / 'assets/catalog.json')
    for source in catalog['assets']:
        assert digest(ROOT / source['originalPath']) == source['originalSha256'], source['id']
    for asset in data['assets']:
        path = ROOT / asset['path']
        image = Image.open(path).convert('RGBA')
        assert digest(path) == asset['sha256']
        assert base64.b64decode(asset['dataUrl'].split(',', 1)[1]) == path.read_bytes()
        source = source_image(sources[asset['originalSourceId']]).crop(box(asset['sourceRect']))
        assert image.size == source.size == (asset['width'], asset['height'])
        assert image.convert('RGB').tobytes() == source.convert('RGB').tobytes(), asset['id']
        expected = source.getchannel('A')
        for rect in asset['annotationOnlyRects']:
            x, y, right, bottom = box(rect)
            ImageDraw.Draw(expected).rectangle((x, y, right - 1, bottom - 1), fill=0)
            assert not image.getchannel('A').crop(box(rect)).getbbox()
        assert image.getchannel('A').tobytes() == expected.tobytes(), asset['id']
        assert len(data['sheets'][asset['id']]['pieces']) == 1
    for world in data['worlds']:
        assert world['canvasWidth'] == world['width'] * world['backgroundScale']
        assert world['canvasHeight'] == world['height'] * world['backgroundScale']
        assert world['pieceId'] in data['sheets']
        for location in world['locations'] + world['regions']:
            rect = location['rect']
            assert rect['x'] >= 0 and rect['y'] >= 0 and rect['w'] > 0 and rect['h'] > 0
            assert rect['x'] + rect['w'] <= world['width'] and rect['y'] + rect['h'] <= world['height'], location['id']
            if world['style'] == 'terrain':
                for excluded in ANNOTATIONS:
                    assert not (rect['x'] < excluded['x'] + excluded['w'] and rect['x'] + rect['w'] > excluded['x'] and
                                rect['y'] < excluded['y'] + excluded['h'] and rect['y'] + rect['h'] > excluded['y']), location['id']
    report = {'status': 'passed', 'worldMaps': len(data['worlds']), 'newSourceDownloadsVerified': 1,
              'previousOriginalSourceChecksumsVerified': len(catalog['assets']),
              'sourceRgbPreserved': True, 'onlyRecordedAnnotationAlphaChanged': True,
              'embeddedPngsMatchFiles': True, 'nativeDimensionsPreserved': True,
              'placementLocationsChecked': sum(len(world['locations']) for world in data['worlds']),
              'scope': 'Source checksum, exact image pixels, annotation exclusions and placement bounds. Not ROM collision or layer/state completeness verification.'}
    write(OUT / 'verification-report.json', report)
    print(json.dumps(report))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    verify(load(JSON_OUT) if args.verify_only else build())


if __name__ == '__main__':
    main()
