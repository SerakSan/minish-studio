#!/usr/bin/env python3
"""Build editable examples from visually reviewed, genuine Link walking poses."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
curated = json.loads((ROOT / 'assets/curated.json').read_text())
poses = sorted([p for p in curated['sheets']['6369']['pieces'] if 28 <= p['sequence'] <= 37], key=lambda p: p['sequence'])
assert len(poses) == 10
base = poses[0]


def hero(identifier, x, y):
    return {'id': identifier, 'kind': 'sprite', 'assetId': base['assetId'],
            **{key: base[key] for key in ['sx', 'sy', 'sw', 'sh', 'sourceId']},
            'pieceId': base['id'], 'pieceName': 'Link: walk away', 'animationAnchor': 'feet',
            'x': x, 'y': y, 'scale': 1, 'flipX': False, 'flipY': False,
            'keyColor': None, 'layer': 'objects', 'visible': True}


template = next(s for s in curated['scenes'] if s['id'] == 'town-arch')
background = {'id': 'demo-town', 'kind': 'sprite', **template['background'], 'x': 0, 'y': 0,
              'sourceId': '6526', 'pieceName': 'Hyrule Town: north square', 'scale': 1,
              'flipX': False, 'flipY': False, 'keyColor': None, 'layer': 'terrain', 'visible': True}
keys = [{'frame': frame, 'values': {'pieceId': poses[(frame // 2) % len(poses)]['id']}, 'easing': 'hold'} for frame in range(0, 40, 2)]
keys[0]['values'].update({'x': 111, 'y': 119})
keys[0]['easing'] = 'linear'
idle = next(p for p in curated['sheets']['6369']['pieces'] if p['sequence'] == 3)
keys.append({'frame': 40, 'values': {'x': 111, 'y': 87, 'pieceId': idle['id']}, 'easing': 'hold'})
walk = {'id': 'demo-town-walk', 'name': 'A walk through Hyrule', 'width': 240, 'height': 160,
        'exportScale': 4, 'fps': 12, 'duration': 48, 'loop': 'once', 'color': '#182a25', 'transparent': False,
        'objects': [background, hero('demo-link', 111, 119)],
        'tracks': [{'id': 'track-demo-link', 'objectId': 'demo-link', 'name': 'Link: walk away', 'muted': False, 'locked': False, 'keys': keys}]}
cycle = {'id': 'demo-walk-cycle', 'name': 'A looping walk cycle', 'width': 64, 'height': 64,
         'exportScale': 4, 'fps': 12, 'duration': 20, 'loop': 'loop', 'color': '#182a25', 'transparent': True,
         'objects': [hero('cycle-link', 23, 26)],
         'tracks': [{'id': 'track-cycle', 'objectId': 'cycle-link', 'name': 'Genuine walking poses', 'muted': False, 'locked': False,
                     'keys': [{'frame': i * 2, 'values': {'pieceId': p['id']}, 'easing': 'hold'} for i, p in enumerate(poses)]}]}
project = {'format': 'minish-cap-animation', 'version': 1, 'name': 'A little world in motion',
           'activeClip': walk['id'], 'clips': [walk, cycle]}
(ROOT / 'examples/Walking Adventure.minish-animation.json').write_text(json.dumps(project, indent=2) + '\n')
(ROOT / 'examples/animation-demo.js').write_text('window.MINISH_ANIMATION_DEMO = ' + json.dumps(project, separators=(',', ':')) + ';\n')
print('Built two editable examples with genuine Link poses. Source artwork unchanged.')
