#!/usr/bin/env python3
"""Build reviewed combat choices from unchanged game-art PNGs."""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/combat'
PRIVATE = ROOT / '.versions/review-20261102/combat'
CURATED = json.loads((ROOT / 'assets/curated.json').read_text())
PIECES = json.loads((ROOT / 'assets/pieces.json').read_text())
SOURCES = {str(a['id']): a for a in json.loads((ROOT / 'assets/source-manifest.json').read_text())['assets']}
ART = {str(a['id']): a for a in PIECES['assets']}
IMAGES = {}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def image(source):
    source = str(source)
    if source not in IMAGES:
        IMAGES[source] = Image.open(ROOT / ART['clean-' + source]['path']).convert('RGBA')
    return IMAGES[source]


def original(source, sequence):
    return next(p for p in PIECES['sheets'][str(source)]['pieces'] if p.get('sequence') == sequence)


def part(source, sequence=None, rect=None, purpose='game artwork', rotation=0):
    source = str(source)
    p = original(source, sequence) if sequence is not None else None
    rect = rect or [p['sx'], p['sy'], p['sw'], p['sh']]
    x, y, w, h = rect
    crop = image(source).crop((x, y, x + w, y + h))
    return {'sourceId': source, 'assetId': 'clean-' + source, 'sourcePieceId': p['id'] if p else None,
            'sourceRect': {'x': x, 'y': y, 'w': w, 'h': h}, 'sourceRgbaSha256': sha(crop.tobytes()),
            'purpose': purpose, 'rotation': rotation, 'x': 0, 'y': 0}, crop.rotate(rotation, expand=True)


def link_feet(crop):
    # Reviewed Link boots use these two reds. Hair, skin and mitts are excluded.
    points = [(x, y) for y in range(crop.height) for x in range(crop.width)
              if crop.getpixel((x, y)) in {(216, 40, 40, 255), (120, 16, 40, 255)}]
    if not points:
        return crop.width // 2, crop.height
    low = max(y for _, y in points)
    xs = [x for x, y in points if y >= low - 2]
    return round(sum(xs) / len(xs)), low + 2


def actor_feet(source, crop):
    if str(source) == '6369':
        return link_feet(crop)
    # The feet/shadow center, not the weapon envelope, is the actor pivot.
    points = [(x, y) for y in range(max(0, crop.height - 5), crop.height)
              for x in range(crop.width) if crop.getpixel((x, y))[3]]
    return (round(sum(x for x, _ in points) / len(points)) if points else crop.width // 2, crop.height)


def build():
    sheets, actions, effects, frames, rendered = {}, [], [], [], []
    seen = {}

    def native(source, sequence=None, rect=None, label='Combat game pose', effect=False):
        mapping, crop = part(source, sequence, rect, 'game effect' if effect else 'whole actor pose')
        r = mapping['sourceRect']
        key = str(source) + '-' + '-'.join(str(r[k]) for k in ['x', 'y', 'w', 'h'])
        if key in seen:
            return seen[key]
        anchor = (crop.width / 2, crop.height / 2) if effect else actor_feet(source, crop)
        p = {'id': 'combat-native-' + key, 'name': label, 'sourceId': str(source), 'assetId': 'clean-' + str(source),
             'sx': r['x'], 'sy': r['y'], 'sw': r['w'], 'sh': r['h'], 'sourceRect': r,
             'kind': 'object' if effect else 'pose', 'group': 'Combat effects' if effect else 'Armed game poses',
             'combatAnchor': {'x': anchor[0], 'y': anchor[1]}, 'representation': 'source-pose',
             'combat': True, 'provenance': 'Reviewed exact crop of the unchanged transparent source sheet.'}
        if effect:
            p['effectAnchor'] = p['combatAnchor'].copy()
        sheets.setdefault(str(source), {'sourceId': str(source), 'pieces': []})['pieces'].append(p)
        frames.append({'pieceId': p['id'], 'rgbaSha256': sha(crop.tobytes()), 'sourceParts': [mapping], 'representation': 'source-pose'})
        seen[key] = p
        return p

    def action(aid, label, source, poses, direction, weapon, kind, effect_id=None, release=.45, assembly=False, inventory=False):
        representative = poses[min(len(poses) - 1, max(0, len(poses) // 2))]
        dx, dy = {'left': (-12, -12), 'right': (12, -12), 'up': (0, -22), 'down': (0, -7)}[direction]
        a = {'id': aid, 'label': label, 'sourceId': str(source), 'actorSourceId': str(source),
             'poseIds': [p['id'] for p in poses], 'representativePoseId': representative['id'],
             'fps': 12, 'defaultHold': 2, 'repeat': True, 'direction': direction, 'weapon': weapon,
             'kind': kind, 'combat': True, 'assembly': assembly, 'animationAnchor': 'feet',
             'releasePhase': release, 'impactPhase': min(.85, release + .22), 'effectId': effect_id,
             'releasePoint': {'x': representative['combatAnchor']['x'] + dx, 'y': representative['combatAnchor']['y'] + dy},
             'representation': 'editor-assembly' if assembly else 'source-pose-sequence',
             'note': 'Timing and sequencing authored for the editor; not advertised as an extracted game-engine animation.'}
        if inventory:
            a['inventoryDerivedProp'] = True
            a['note'] += ' The attached held prop uses genuine inventory item art; the body is a reviewed arm/tool-use gesture.'
        if weapon == 'bomb':
            a['impactEffectId'] = 'explosion'
        actions.append(a)

    # Genuine separate sword-rendering parts. Each green hilt is aligned with
    # the hand on a reviewed Link arm/tool-use gesture, preserving all pixels.
    sword_rows = {'left': list(range(1, 9)), 'up': [9, 10, 16, 17, 11, 12, 13, 14, 15],
                  'down': list(range(18, 27))}
    bodies = {'left': [244, 245, 246, 247, 248, 249, 248, 245, 244],
              'down': [238, 239, 240, 241, 242, 243, 242, 239, 238],
              'up': [250, 251, 252, 253, 254, 255, 254, 251, 250]}
    gestures = {'left': [790, 791, 792, 793, 794, 795, 796],
                'down': [761, 762, 763, 764, 765, 766, 767],
                'up': [819, 820, 821, 822, 823, 824, 825]}
    pivots = {'left': (-8, -11), 'down': (0, -8), 'up': (0, -18)}

    def assembly(aid, index, body_seq, tool_source=None, tool_sequence=None, sword=False, visible=True, rotation=0):
        body, body_crop = part('6369', body_seq, purpose='Link arm/tool-use body gesture')
        bx, by = link_feet(body_crop)
        parts = [(body, body_crop, -bx, -by)]
        if visible and tool_source:
            tool, tool_crop = part(tool_source, tool_sequence, purpose='gameplay sword component' if sword else 'inventory-derived held prop', rotation=rotation)
            dx, dy = pivots[aid.rsplit('-', 1)[1]]
            if sword:
                hilt = [(x, y) for y in range(tool_crop.height) for x in range(tool_crop.width)
                        if tool_crop.getpixel((x, y))[3] and tool_crop.getpixel((x, y))[1] > tool_crop.getpixel((x, y))[0] * 1.5 and tool_crop.getpixel((x, y))[1] > tool_crop.getpixel((x, y))[2] * 1.5]
                tx = round(sum(x for x, _ in hilt) / len(hilt)) if hilt else tool_crop.width // 2
                ty = round(sum(y for _, y in hilt) / len(hilt)) if hilt else tool_crop.height // 2
            else:
                tx, ty = tool_crop.width // 2, tool_crop.height // 2
            parts.append((tool, tool_crop, dx - tx, dy - ty))
        canvas = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
        for mapping, crop, x, y in parts:
            canvas.alpha_composite(crop, (80 + x, 80 + y))
        bounds = canvas.getbbox(); crop = canvas.crop(bounds)
        source_parts = []
        for mapping, _, x, y in parts:
            source_parts.append({**mapping, 'x': 80 + x - bounds[0], 'y': 80 + y - bounds[1]})
        p = {'id': 'combat-' + aid + '-' + str(index + 1), 'name': aid.replace('-', ' ').title() + ' · editor assembly ' + str(index + 1),
             'sourceId': '6369', 'assetId': 'combat-link-equipment', 'sx': 0, 'sy': 0, 'sw': crop.width, 'sh': crop.height,
             'kind': 'pose', 'group': 'Weapon and item assemblies', 'combat': True,
             'combatAnchor': {'x': 80 - bounds[0], 'y': 80 - bounds[1]}, 'representation': 'editor-assembly',
             'sourceParts': source_parts, 'inventoryDerivedProp': not sword,
             'provenance': 'Editor assembly of genuine source parts; see assets/combat/manifest.json.'}
        frames.append({'pieceId': p['id'], 'rgbaSha256': sha(crop.tobytes()), 'sourceParts': source_parts, 'representation': 'editor-assembly'})
        sheets.setdefault('6369', {'sourceId': '6369', 'pieces': []})['pieces'].append(p)
        rendered.append((p, crop))
        return p

    for direction in ['left', 'up', 'down']:
        aid = 'link-sword-' + direction
        sword_frames = sword_rows['up'] if direction == 'down' else sword_rows[direction]
        poses = [assembly(aid, i, bodies[direction][i], '180815', seq, sword=True, rotation=180 if direction == 'down' else 0) for i, seq in enumerate(sword_frames)]
        action(aid, 'Sword slash ' + direction + ' · editor assembly', '6369', poses, direction, 'sword', 'melee', 'impact', assembly=True)
        for weapon, item, kind, effect_id in [('shield', 68, 'guard', 'impact'), ('bomb', 66, 'throw', 'bomb'),
                                             ('boomerang', 54, 'throw', 'boomerang'), ('bow', 75, 'equip', None),
                                             ('gust-jar', 52, 'magic', 'gust'), ('pacci', 53, 'magic', 'magic')]:
            aid = 'link-' + weapon + '-' + direction
            poses = [assembly(aid, i, body, '6437', item, visible=not (weapon in ['bomb', 'boomerang'] and i >= 4))
                     for i, body in enumerate(gestures[direction])]
            label = {'gust-jar': 'Gust Jar', 'pacci': 'Pacci staff', 'bow': 'Ready bow', 'shield': 'Shield brace', 'bomb': 'Bomb throw', 'boomerang': 'Boomerang throw'}[weapon]
            action(aid, label + ' ' + direction + ' · editor assembly', '6369', poses, direction, weapon, kind, effect_id, assembly=True, inventory=True)
            if weapon in ['bomb', 'boomerang']:
                actions[-1]['representativePoseId'] = poses[2]['id']
                actions[-1]['releasePhase'] = 4 / len(poses)
                actions[-1]['impactPhase'] = .82
                dx, dy = {'left': (-12, -12), 'up': (0, -22), 'down': (0, -7)}[direction]
                actions[-1]['releasePoint'] = {'x': poses[2]['combatAnchor']['x'] + dx, 'y': poses[2]['combatAnchor']['y'] + dy}

    native_actions = [
        ('link-mitts-down', 'Mole Mitts strike down', '6369', [849, 850, 851, 852, 853, 854, 855, 856], 'down', 'mole-mitts', 'melee', 'impact'),
        ('link-mitts-left', 'Mole Mitts strike left', '6369', [860, 861, 862, 863, 864, 865, 866, 867], 'left', 'mole-mitts', 'melee', 'impact'),
        ('link-mitts-up', 'Mole Mitts strike up', '6369', [871, 872, 873, 874, 875, 876, 877], 'up', 'mole-mitts', 'melee', 'impact'),
        ('darknut-sword-left', 'Darknut sword combo left', '64168', [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38], 'left', 'sword', 'melee', 'impact'),
        ('darknut-sword-right', 'Darknut sword combo right', '64168', [79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95], 'right', 'sword', 'melee', 'impact'),
        ('darknut-sword-up', 'Darknut sword combo up', '64168', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'up', 'sword', 'melee', 'impact'),
        ('darknut-sword-down', 'Darknut sword combo down', '64168', [44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 60, 61, 62], 'down', 'sword', 'melee', 'impact'),
        ('moblin-spear-left', 'Moblin spear thrust left', '6556', [46, 47, 48, 49, 48, 47], 'left', 'spear', 'melee', 'impact'),
        ('moblin-spear-right', 'Moblin spear thrust right', '6556', [54, 55, 56, 57, 56, 55], 'right', 'spear', 'melee', 'impact'),
        ('moblin-spear-up', 'Moblin spear attack up', '6556', [1, 6, 7, 8], 'up', 'spear', 'melee', 'impact'),
        ('moblin-spear-down', 'Moblin spear attack down', '6556', [25, 26, 27, 28], 'down', 'spear', 'melee', 'impact'),
        ('keaton-sword-right', 'Keaton sword lunge right', '6472', [14, 15, 16], 'right', 'sword', 'melee', 'impact'),
        ('keaton-sword-down', 'Keaton sword lunge down', '6472', [33, 34, 35, 36], 'down', 'sword', 'melee', 'impact'),
        ('stalfos-bone-left', 'Stalfos bone volley left', '6524', [22, 23, 24, 25, 26, 27, 28, 29, 30, 31], 'left', 'bone', 'ranged', 'bone'),
        ('stalfos-bone-down', 'Stalfos bone volley down', '6524', [43, 44, 45, 46, 47, 48, 49, 50, 51, 52], 'down', 'bone', 'ranged', 'bone'),
        ('octorok-shot-down', 'Octorok stone shot down', '6504', [1, 2, 3, 4], 'down', 'stone', 'ranged', 'stone'),
        ('octorok-shot-left', 'Octorok stone shot left', '6504', [9, 10, 11, 12], 'left', 'stone', 'ranged', 'stone'),
        ('octorok-shot-up', 'Octorok stone shot up', '6504', [27, 28, 29, 30], 'up', 'stone', 'ranged', 'stone'),
        ('bobomb-fuse-down', 'Bob-omb lit fuse', '6413', [7, 8, 9, 10, 11, 12], 'down', 'bomb', 'ranged', 'bomb'),
        ('vaati-cast-down', 'Vaati spell cast', '6530', [4, 5, 25, 26, 27, 28, 29, 30, 31, 32], 'down', 'magic', 'magic', 'fireball'),
        ('vaati-cast-left', 'Vaati spell cast left', '6530', [34, 35, 34], 'left', 'magic', 'magic', 'fireball')
    ]
    for aid, label, sid, seqs, direction, weapon, kind, effect_id in native_actions:
        action(aid, label, sid, [native(sid, n, label=label) for n in seqs], direction, weapon, kind, effect_id)

    def effect(eid, label, sid, seqs, kind='effect', rects=None, inventory=False):
        poses = [native(sid, n, label=label, effect=True) for n in seqs] if rects is None else [native(sid, rect=rect, label=label, effect=True) for rect in rects]
        if inventory:
            for p in poses:
                p['inventoryDerivedProp'] = True
                next(frame for frame in frames if frame['pieceId'] == p['id'])['sourceParts'][0]['purpose'] = 'inventory-derived projectile prop'
        effects.append({'id': eid, 'label': label, 'kind': kind, 'sourceId': str(sid), 'pieceIds': [p['id'] for p in poses],
                        'directions': {direction: [p['id'] for p in poses] for direction in ['left', 'right', 'up', 'down']},
                        'inventoryDerivedProp': inventory, 'direction': 'neutral', 'fps': 12, 'defaultHold': 2})
    effect('impact', 'Game impact spark', '6504', [5, 17], 'impact')
    effect('stone', 'Octorok stone', '6504', [], 'projectile', rects=[[256, 53, 9, 10], [266, 53, 9, 10], [275, 53, 9, 10]])
    effect('fireball', 'Game fireball', '6452', [1, 2, 3, 4], 'projectile')
    effect('magic', 'Magic impact spark', '37862', [7, 9], 'impact')
    effect('explosion', 'Bomb explosion', '37862', [9, 10, 11, 6, 7, 1, 2, 3, 4], 'explosion')
    effect('bomb', 'Bomb prop', '6437', [66], 'projectile', inventory=True)
    effect('boomerang', 'Boomerang prop', '6437', [54], 'projectile', inventory=True)
    effect('gust', 'Game gust and dust', '6556', [], 'gust', rects=[[110, 199, 2, 2], [114, 199, 4, 2], [119, 197, 4, 5], [126, 196, 7, 8], [135, 195, 8, 8], [145, 191, 13, 13], [159, 189, 16, 16]])
    effect('bone', 'Stalfos thrown bone', '6524', [], 'projectile', rects=[[237, 595, 9, 18], [246, 595, 16, 18], [262, 596, 17, 10], [279, 595, 17, 18]])

    # Quarter turns preserve the exact source pixels and give a thrown
    # boomerang a visible spin without pretending these are extracted frames.
    spinning = []
    for index, rotation in enumerate([0, 90, 180, 270]):
        mapping, crop = part('6437', 54, purpose='inventory-derived projectile prop', rotation=rotation)
        normalized = Image.new('RGBA', crop.size, (0, 0, 0, 0)); normalized.alpha_composite(crop); crop = normalized
        p = {'id': 'combat-boomerang-spin-' + str(index + 1), 'name': 'Boomerang spin · editor transform ' + str(index + 1),
             'sourceId': '6437', 'assetId': 'combat-link-equipment', 'sx': 0, 'sy': 0, 'sw': crop.width, 'sh': crop.height,
             'kind': 'object', 'group': 'Combat effects', 'combat': True, 'inventoryDerivedProp': True,
             'combatAnchor': {'x': crop.width / 2, 'y': crop.height / 2}, 'effectAnchor': {'x': crop.width / 2, 'y': crop.height / 2},
             'representation': 'editor-assembly', 'sourceParts': [mapping], 'provenance': 'Quarter-turn editor animation of genuine Boomerang item art.'}
        sheets.setdefault('6437', {'sourceId': '6437', 'pieces': []})['pieces'].append(p)
        frames.append({'pieceId': p['id'], 'rgbaSha256': sha(crop.tobytes()), 'sourceParts': [mapping], 'representation': 'editor-assembly'})
        rendered.append((p, crop)); spinning.append(p['id'])
    boom = next(item for item in effects if item['id'] == 'boomerang')
    boom['pieceIds'] = spinning
    boom['directions'] = {direction: spinning for direction in ['left', 'right', 'up', 'down']}

    atlas_width, gap = 1024, 2
    x = y = row_height = 0
    for p, crop in rendered:
        if x + crop.width + gap > atlas_width:
            x = 0; y += row_height + gap; row_height = 0
        p['sx'], p['sy'] = x, y
        x += crop.width + gap; row_height = max(row_height, crop.height)
    atlas = Image.new('RGBA', (atlas_width, y + row_height), (0, 0, 0, 0))
    for p, crop in rendered:
        atlas.alpha_composite(crop, (p['sx'], p['sy']))
    OUT.mkdir(parents=True, exist_ok=True)
    atlas_path = OUT / 'link-equipment.png'; atlas.save(atlas_path)
    png = atlas_path.read_bytes()
    assets = [{'id': 'combat-link-equipment', 'sourceId': '6369', 'name': 'Link weapon and item editor assemblies', 'section': 'Playable Characters',
               'path': 'assets/combat/link-equipment.png', 'width': atlas.width, 'height': atlas.height,
               'dataUrl': 'data:image/png;base64,' + base64.b64encode(png).decode(), 'sha256': sha(png),
               'representation': 'editor-assembly'}]
    used = sorted({part['sourceId'] for frame in frames for part in frame['sourceParts']})
    source_records = [{k: SOURCES[s].get(k) for k in ['id', 'name', 'contributors', 'sourceUrl', 'downloadUrl', 'originalPath', 'originalSha256', 'status']} |
                      {'transparentPath': ART['clean-' + s]['path'], 'transparentSha256': sha((ROOT / ART['clean-' + s]['path']).read_bytes())} for s in used]
    pack = {'version': 1, 'assets': assets, 'sheets': sheets, 'actions': actions, 'effects': effects,
            'note': 'Genuine game artwork. Link equipment combinations are explicit editor assemblies, with gameplay sword parts or labeled inventory-derived held props. No claim of complete extracted ROM animation coverage.'}
    manifest = {'version': 1, 'sources': source_records, 'frames': frames, 'actions': actions, 'effects': effects,
                'stats': {'actions': len(actions), 'frames': len(frames), 'assemblyFrames': len(rendered), 'effects': len(effects)}, 'note': pack['note']}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    runtime = "(() => {\n  'use strict';\n  const pack = " + json.dumps(pack, separators=(',', ':')) + ";\n"
    runtime += "  pack.getAction = id => pack.actions.find(action => action.id === id) || null;\n  pack.getEffect = id => pack.effects.find(effect => effect.id === id) || null;\n"
    runtime += "  pack.getPiece = id => Object.values(pack.sheets).flatMap(sheet => sheet.pieces).find(piece => piece.id === id) || null;\n"
    runtime += "  pack.mergeSheets = existing => { const merged = { ...(existing || {}) }; for (const [id, sheet] of Object.entries(pack.sheets)) { const previous = merged[id] || {}; const seen = new Set((previous.pieces || []).map(piece => piece.id)); merged[id] = { ...sheet, ...previous, pieces: [...(previous.pieces || []), ...sheet.pieces.filter(piece => !seen.has(piece.id))] }; } return merged; };\n  window.MINISH_COMBAT_LIBRARY = pack;\n})();\n"
    (ROOT / 'combat-library.js').write_text(runtime)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    contact = Image.new('RGBA', (1050, math.ceil(len(actions) / 3) * 150), (27, 47, 57, 255)); draw = ImageDraw.Draw(contact)
    lookup = {p['id']: p for sheet in sheets.values() for p in sheet['pieces']}
    for i, a in enumerate(actions):
        col, row = i % 3, i // 3; px, py = col * 350, row * 150
        draw.text((px + 7, py + 5), a['id'], fill='white')
        choices = [a['poseIds'][0], a['representativePoseId'], a['poseIds'][-1]]
        for j, pid in enumerate(choices):
            p = lookup[pid]; im = atlas if p['assetId'] == 'combat-link-equipment' else image(p['sourceId'])
            crop = im.crop((p['sx'], p['sy'], p['sx'] + p['sw'], p['sy'] + p['sh']))
            crop = crop.resize((p['sw'] * 2, p['sh'] * 2), Image.Resampling.NEAREST)
            contact.alpha_composite(crop, (px + 8 + j * 110, py + 35))
            ax, ay = p['combatAnchor']['x'] * 2 + px + 8 + j * 110, p['combatAnchor']['y'] * 2 + py + 35
            draw.line((ax - 3, ay, ax + 3, ay), fill='#ff8855'); draw.line((ax, ay - 3, ax, ay + 3), fill='#ff8855')
    contact.convert('RGB').save(PRIVATE / 'combat-action-review.png')
    return manifest


def verify():
    manifest = json.loads((OUT / 'manifest.json').read_text())
    text = (ROOT / 'combat-library.js').read_text(); start = text.index('const pack = ') + len('const pack = '); end = text.index(';\n', start)
    pack = json.loads(text[start:end]); lookup = {p['id']: p for sh in pack['sheets'].values() for p in sh['pieces']}
    atlas = Image.open(OUT / 'link-equipment.png').convert('RGBA')
    for asset in pack['assets']:
        png = (ROOT / asset['path']).read_bytes()
        assert base64.b64decode(asset['dataUrl'].split(',', 1)[1]) == png
        assert sha(png) == asset['sha256']
    for source in manifest['sources']:
        assert sha((ROOT / source['originalPath']).read_bytes()) == source['originalSha256'], source['id']
        assert sha((ROOT / source['transparentPath']).read_bytes()) == source['transparentSha256'], source['id']
    for f in manifest['frames']:
        p = lookup[f['pieceId']]
        actual_source = atlas if p['assetId'] == 'combat-link-equipment' else image(p['sourceId'])
        actual = actual_source.crop((p['sx'], p['sy'], p['sx'] + p['sw'], p['sy'] + p['sh']))
        assert sha(actual.tobytes()) == f['rgbaSha256'], p['id']
        reconstructed = Image.new('RGBA', (p['sw'], p['sh']), (0, 0, 0, 0))
        for component in f['sourceParts']:
            r = component['sourceRect']; im = image(component['sourceId'])
            crop = im.crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']))
            assert sha(crop.tobytes()) == component['sourceRgbaSha256']
            crop = crop.rotate(component['rotation'], expand=True)
            if f['representation'] == 'source-pose':
                assert actual.tobytes() == crop.tobytes()
            else:
                reconstructed.alpha_composite(crop, (component['x'], component['y']))
        if f['representation'] == 'editor-assembly':
            assert reconstructed.tobytes() == actual.tobytes(), p['id']
        assert 0 <= p['combatAnchor']['x'] <= p['sw'] and 0 <= p['combatAnchor']['y'] <= p['sh'] + 1, p['id']
    report = {'status': 'passed', **manifest['stats'], 'originalChecksumsPreserved': True, 'sourceRgbaMatches': True,
              'everyAssemblyReconstructed': True, 'opaqueSourcePixelsNotRecolored': True}
    (OUT / 'verification-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--verify-only', action='store_true'); args = parser.parse_args()
    if not args.verify_only:
        build()
    verify()
