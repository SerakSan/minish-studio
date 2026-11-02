import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'combat-library.js'), 'utf8'), sandbox);
const pack = sandbox.window.MINISH_COMBAT_LIBRARY;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/combat/manifest.json'), 'utf8'));
const pieces = new Map(Object.values(pack.sheets).flatMap(sheet => sheet.pieces).map(piece => [piece.id, piece]));
const actions = new Map(pack.actions.map(action => [action.id, action]));
assert.equal(pack.actions.length, manifest.stats.actions);
assert.equal(pieces.size, manifest.stats.frames);
assert.equal(manifest.frames.length, pieces.size);
assert(pack.actions.length >= 35 && pack.effects.length >= 8);
assert.deepEqual(new Set(pack.actions.filter(a => a.sourceId === '6369').map(a => a.weapon)), new Set(['sword', 'shield', 'bomb', 'boomerang', 'bow', 'gust-jar', 'pacci', 'mole-mitts']));
for (const source of ['6369', '64168', '6556', '6472', '6524', '6504', '6413', '6530']) assert(pack.actions.some(action => action.sourceId === source), 'Include reviewed actions for ' + source);
for (const action of pack.actions) {
  assert(action.id && action.label && action.poseIds.length > 1);
  assert(['left', 'right', 'up', 'down'].includes(action.direction));
  assert.equal(action.animationAnchor, 'feet');
  assert(Number.isFinite(action.fps) && action.fps > 0 && Number.isInteger(action.defaultHold) && action.defaultHold > 0);
  assert(action.releasePhase > 0 && action.releasePhase < 1);
  assert(action.poseIds.includes(action.representativePoseId));
  for (const id of action.poseIds) {
    const p = pieces.get(id); assert(p && p.sourceId === action.sourceId, 'Every action pose resolves to the correct actor');
    assert(p.combatAnchor.x >= 0 && p.combatAnchor.x <= p.sw);
    assert(p.combatAnchor.y >= 0 && p.combatAnchor.y <= p.sh + 1);
    if (p.representation === 'editor-assembly') assert(p.sourceParts?.length && /editor assembly/.test(p.name));
  }
  if (action.effectId) assert(pack.getEffect(action.effectId));
  if (action.inventoryDerivedProp) assert(action.assembly && /inventory item art/.test(action.note));
}
// Gameplay sword art is supplied separately from Link's body. The assembly
// must retain its source mapping and use an actual arm gesture, not a walk.
for (const direction of ['left', 'up', 'down']) {
  for (const id of actions.get('link-sword-' + direction).poseIds) {
    const frame = manifest.frames.find(frame => frame.pieceId === id);
    assert.equal(frame.sourceParts.length, 2);
    assert.equal(frame.sourceParts[0].sourceId, '6369');
    assert.equal(frame.sourceParts[1].sourceId, '180815');
    assert(frame.sourceParts[0].sourceRect.y >= 600);
  }
  const mitts = actions.get('link-mitts-' + direction);
  assert(!mitts.inventoryDerivedProp && !mitts.assembly);
  assert(mitts.poseIds.every(id => pieces.get(id).sourceRect.y >= 1990));
  assert.equal(actions.get('link-bow-' + direction).kind, 'equip', 'Do not advertise an invented arrow shot');
  assert.equal(actions.get('link-bow-' + direction).effectId, null);
  for (const weapon of ['bomb', 'boomerang']) {
    const action = actions.get('link-' + weapon + '-' + direction);
    assert.equal(action.releasePhase, 4 / action.poseIds.length);
    for (const [index, id] of action.poseIds.entries()) {
      const frame = manifest.frames.find(frame => frame.pieceId === id);
      assert.equal(frame.sourceParts.length, index < 4 ? 2 : 1, 'The held object disappears at the release phase');
    }
  }
}
for (const effect of pack.effects) {
  assert(effect.pieceIds.length && effect.pieceIds.every(id => pieces.has(id)));
  for (const direction of ['left', 'right', 'up', 'down']) assert(effect.directions[direction]?.every(id => pieces.has(id)));
}
assert.equal(pack.getEffect('boomerang').pieceIds.length, 4, 'A thrown boomerang has four lossless quarter-turn frames');
assert(pack.getEffect('gust').pieceIds.every(id => pieces.get(id).sw <= 16), 'Use individual puff states instead of the whole presentation strip');
assert(pack.getEffect('stone').pieceIds.every(id => pieces.get(id).sw <= 9), 'Cut the separate actual brown stone frames');
const old = { sourceId: '6369', coverPieceId: 'old-cover', note: 'Keep source notes', pieces: [{ id: 'old-frame' }] };
const merged = pack.mergeSheets({ '6369': old });
assert.equal(merged['6369'].coverPieceId, old.coverPieceId);
assert.equal(merged['6369'].note, old.note);
assert.equal(merged['6369'].pieces[0].id, 'old-frame');
assert.equal(pack.mergeSheets(merged)['6369'].pieces.length, merged['6369'].pieces.length, 'Merging twice does not duplicate combat art');
assert.equal(old.pieces.length, 1, 'The previous source library is not mutated');
const python = fs.existsSync(path.join(root, '.venv/bin/python')) ? path.join(root, '.venv/bin/python') : 'python3';
const report = JSON.parse(execFileSync(python, ['tools/build_combat_library.py', '--verify-only'], { cwd: root, encoding: 'utf8' }));
assert.equal(report.status, 'passed');
assert(report.originalChecksumsPreserved && report.everyAssemblyReconstructed && report.sourceRgbaMatches);
console.log('PASS: 42 reviewed weapon/item actions, eight actor sources, exact source RGBA and assembly reconstruction, held-item release timing, real sword parts, Mole Mitts and armed foes, directional crops, explicit inventory-prop labels, source credits and repeat-safe library merging.');
