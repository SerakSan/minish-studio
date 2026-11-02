// Animation data, keyframe, playback and isolation regressions.
// Run: node tests/animation-engine.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const curated = read('assets/curated.json'), bosses = read('assets/full-bosses.json'), sprites = read('assets/sprites.json'), catalog = read('assets/catalog.json'), pieces = read('assets/pieces.json');
const sheets = { ...pieces.sheets, ...curated.sheets, ...bosses.sheets };
const pieceMap = new Map(Object.values(sheets).flatMap(sheet => sheet.pieces || []).map(piece => [piece.id, piece]));
const assets = [...catalog.assets, ...pieces.assets, ...sprites.assets, ...curated.assets, ...bosses.assets];
const adapter = { assets, getAsset: id => assets.find(a => String(a.id) === String(id)), getPiece: id => pieceMap.get(id) || null };
const source = fs.readFileSync(path.join(root, 'animation-engine.js'), 'utf8');
function harness(initial = []) {
  let rafId = 0, timerId = 0; const callbacks = new Map(), timers = new Map(), storage = new Map(initial);
  const window = { MINISH_STUDIO: adapter, MINISH_CURATED: curated, MINISH_BOSSES: bosses,
    requestAnimationFrame(fn) { callbacks.set(++rafId, fn); return rafId; }, cancelAnimationFrame(id) { callbacks.delete(id); } };
  const context = vm.createContext({ window, console, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(source, context); window.MINISH_ANIMATION.init(adapter);
  return { engine: window.MINISH_ANIMATION, storage, tick(time) { const pending = [...callbacks]; callbacks.clear(); pending.forEach(([, callback]) => callback(time)); }, save() { [...timers.values()].forEach(fn => fn()); timers.clear(); }, callbacks };
}
const h = harness(), engine = h.engine;
assert.equal(engine.format, 'minish-cap-animation'); assert.equal(engine.project.clips.length, 1); assert.equal(engine.currentClip.duration, 48);
const original = engine.project; const snapshots = []; const unsubscribe = engine.subscribe(state => snapshots.push(state.type));
engine.renameProject('My Minish film'); assert.equal(engine.project.name, 'My Minish film'); engine.undo(); assert.deepEqual(engine.project, original); engine.redo();
const walking = curated.sheets['6369'].pieces.filter(piece => piece.sequence >= 28 && piece.sequence <= 37);
assert.equal(walking.length, 10, 'Use the reviewed back-facing Link walking poses');
const first = walking[0];
const base = { id: 'source-link', kind: 'sprite', assetId: first.assetId, sx: first.sx, sy: first.sy, sw: first.sw, sh: first.sh, pieceId: first.id, pieceName: first.name, sourceId: first.sourceId,
  x: 30, y: 90, scale: 1, flipX: false, flipY: false, keyColor: null, layer: 'objects' };
const staticScene = { id: 'scene-1', name: 'Walk through Hyrule', width: 240, height: 160, exportScale: 4, transparent: true, color: '#819452', objects: [base] };
const staticBefore = JSON.stringify(staticScene), clip = engine.importScene(staticScene);
assert.equal(JSON.stringify(staticScene), staticBefore, 'Import never mutates the scene editor data');
assert.notEqual(clip.objects[0].id, base.id, 'Imported object IDs are independent from scene objects');
const object = clip.objects[0], id = object.id;
engine.selectObject(id); engine.configureClip({ duration: 36, fps: 12 });
const beforeSequence = engine.project;
engine.applyPoseSequence(id, walking, { hold: 2, loop: true });
assert.equal(engine.getTrack(id).keys.length, 18);
for (let at = 0; at < 36; at++) {
  const rendered = engine.evaluateFrame(engine.currentClip, at).objects[0], expected = walking[Math.floor(at / 2) % walking.length];
  assert.equal(rendered.pieceId, expected.id); assert.equal(rendered.assetId, expected.assetId);
  assert.equal(rendered.sx, expected.sx); assert.equal(rendered.sy, expected.sy);
  assert.equal(rendered.y + rendered.sh, object.y + object.sh, 'Pose changes preserve actor feet');
  assert(Math.abs(rendered.x + rendered.sw / 2 - object.x - object.sw / 2) <= .5, 'Pose changes preserve horizontal center within one native pixel');
}
engine.undo(); assert.deepEqual(engine.project, beforeSequence, 'A whole pose sequence is one Undo action'); engine.redo();
engine.setKey(id, 0, { x: 30, y: 90 }, { easing: 'linear' });
const endPose = engine.getObjectAt(id, 30);
engine.setKey(id, 30, { x: 90 + (endPose.x - 30), y: 90 + (endPose.y - 90) }, { easing: 'hold' });
const renderedMid = engine.getObjectAt(id, 15);
assert.equal(renderedMid.x + renderedMid.sw / 2, object.x + object.sw / 2 + 30, 'Pose keys do not interrupt a separate movement curve');
assert.equal(renderedMid.y + renderedMid.sh, object.y + object.sh);
assert(Number.isInteger(renderedMid.x) && Number.isInteger(renderedMid.y), 'Motion stays on native pixels');
engine.setKey(id, 20, { visible: false }); assert.equal(engine.evaluateFrame(engine.currentClip, 20).objects.length, 0);
assert.equal(engine.getObjectAt(id, 20).visible, false); engine.setKey(id, 24, { visible: true }); assert.equal(engine.evaluateFrame(engine.currentClip, 25).objects.length, 1);
engine.setTrack(id, { muted: true }); assert.equal(engine.evaluateFrame(engine.currentClip, 0).objects.length, 0); engine.setTrack(id, { muted: false, locked: true });
const locked = engine.project; assert.throws(() => engine.setKey(id, 5, { x: 20 }), /Unlock/); assert.deepEqual(engine.project, locked);
engine.setTrack(id, { locked: false });
engine.seek(8); const visible = engine.getObjectAt(id); engine.updateObject(id, { x: visible.x + 5, y: visible.y + 3 }, { keyframe: true });
assert.equal(engine.getObjectAt(id).x, visible.x + 5); assert.equal(engine.getObjectAt(id).y, visible.y + 3, 'Auto Key accepts visible position coordinates');
engine.duplicateKey(id, 8, 9); assert.deepEqual(engine.getTrack(id).keys.find(k => k.frame === 8).values, engine.getTrack(id).keys.find(k => k.frame === 9).values);
assert.throws(() => engine.moveKey(id, 9, 8), /already exists/); engine.moveKey(id, 9, 11); assert(engine.getTrack(id).keys.some(key => key.frame === 11));
engine.removeKey(id, 11); assert(!engine.getTrack(id).keys.some(key => key.frame === 11));
const beforeDuplicate = engine.project, copied = engine.duplicateObject(id);
assert.notEqual(copied.id, id); assert.equal(copied.x, object.x + 8);
for (const at of [0, 8, 17, 30]) { const a = engine.getObjectAt(id, at), b = engine.getObjectAt(copied.id, at); assert.equal(b.x - a.x, 8); assert.equal(b.y - a.y, 8); assert.equal(b.pieceId, a.pieceId); }
engine.undo(); assert.deepEqual(engine.project, beforeDuplicate, 'Duplicate preserves all tracks and remains one Undo');
const beforeBatch = engine.project;
engine.batch(() => { const actor = engine.addObject(base); engine.applyPoseSequence(actor.id, walking, { hold: 3 }); engine.setKeys(actor.id, [{ frame: 0, values: { x: 20 }, easing: 'linear' }, { frame: 30, values: { x: 90 } }]); });
assert.equal(engine.currentClip.objects.length, 2); engine.undo(); assert.deepEqual(engine.project, beforeBatch, 'A combined pose and motion preset is one Undo action');
assert.throws(() => engine.batch(() => { engine.addObject(base); engine.configureClip({ duration: 601 }); }));
assert.deepEqual(engine.project, beforeBatch, 'A failed combined action rolls back every mutation');
for (const x of [Infinity, NaN, '', 'not a position']) { assert.throws(() => engine.updateObject(id, { x })); assert.deepEqual(engine.project, beforeBatch); }
const dialogue = engine.addObject({ kind: 'dialogue', text: 'Hello, 한글!', x: 5, y: 90, w: 180, h: 50, fontSize: 12, color: '#fff7d3', layer: 'overlay', scale: 1 });
engine.setKeys(dialogue.id, [{ frame: 0, values: { text: 'H', x: 5 }, easing: 'linear' }, { frame: 2, values: { text: 'He', x: 9 } }, { frame: 4, values: { text: 'Hello', y: 95 } }, { frame: 6, values: { text: 'Hello, 한글!' } }]);
const beforeTextRewrite = engine.project;
engine.batch(() => {
  engine.clearKeyProperties(dialogue.id, ['text'], { from: 2, to: 6 });
  engine.setKeys(dialogue.id, [{ frame: 2, values: { text: '한' } }, { frame: 3, values: { text: '한글' } }]);
});
const rewritten = engine.getTrack(dialogue.id).keys;
assert.equal(rewritten.find(key => key.frame === 0).values.text, 'H', 'Property clearing preserves keys before its range');
assert.equal(rewritten.find(key => key.frame === 2).values.x, 9); assert.equal(rewritten.find(key => key.frame === 4).values.y, 95, 'Text rewriting never erases motion keys');
assert(!rewritten.some(key => key.frame === 6), 'Property clearing removes only keys that became empty');
assert.equal(engine.getObjectAt(dialogue.id, 4).text, '한글');
engine.undo(); assert.deepEqual(engine.project, beforeTextRewrite, 'A complete Unicode typewriter rewrite is one Undo action');
engine.removeObject(dialogue.id);
const originalClip = engine.currentClip, copiedClip = engine.duplicateClip();
assert.notEqual(copiedClip.id, originalClip.id); assert.notEqual(copiedClip.objects[0].id, originalClip.objects[0].id);
assert.equal(copiedClip.tracks[0].objectId, copiedClip.objects[0].id); assert.deepEqual(copiedClip.tracks[0].keys, originalClip.tracks[0].keys);
engine.deleteClip(copiedClip.id); assert.equal(engine.currentClip.id, originalClip.id); engine.switchClip(originalClip.id);
const beforeShrink = engine.project; engine.configureClip({ duration: 5 }); assert(engine.currentClip.tracks.every(track => track.keys.every(key => key.frame < 5)));
engine.undo(); assert.deepEqual(engine.project, beforeShrink, 'Trimming duration can be reversed with all keys intact');
const beforeInvalid = engine.project;
for (const patch of [{ duration: 601 }, { duration: 0 }, { fps: 0 }, { fps: 61 }, { width: 8193 }, { width: 8192, height: 4096 }, { width: 1024, height: 1024, exportScale: 8 }]) {
  assert.throws(() => engine.configureClip(patch)); assert.deepEqual(engine.project, beforeInvalid, 'Invalid settings never mutate history or clip data');
}
const bad = engine.saveData(); bad.clips.find(clip => clip.id === bad.activeClip).objects[0].sw = 100000; assert.throws(() => engine.loadProject(bad), /crop/); assert.deepEqual(engine.project, beforeInvalid);
const invalidKey = engine.saveData(); invalidKey.clips.find(c => c.id === originalClip.id).tracks[0].keys.push({ frame: 35, values: { assetId: first.assetId, sx: 999999 }, easing: 'hold' });
assert.throws(() => engine.loadProject(invalidKey), /crop/);
const later = engine.addObject(base, { at: 12 }); assert(!engine.evaluateFrame(engine.currentClip, 0).objects.some(o => o.id === later.id));
assert(engine.evaluateFrame(engine.currentClip, 12).objects.some(o => o.id === later.id)); engine.undo(); assert(!engine.currentClip.objects.some(o => o.id === later.id));
engine.configureClip({ duration: 4, fps: 10, loop: 'loop' }); engine.seek(0); engine.play(); h.tick(1000); h.tick(1100); assert.equal(engine.frame, 1); h.tick(1400); assert.equal(engine.frame, 0); engine.pause(); assert.equal(h.callbacks.size, 0);
engine.configureClip({ loop: 'once' }); engine.seek(0); engine.play(); h.tick(2000); h.tick(2300); assert.equal(engine.frame, 3); assert.equal(engine.playing, false);
engine.play(); assert.equal(engine.frame, 0, 'Play at the end of a one-shot clip restarts from the beginning'); h.tick(2400); h.tick(2500); assert.equal(engine.frame, 1); engine.pause();
engine.configureClip({ loop: 'pingpong' }); engine.seek(0); engine.play(); h.tick(3000); h.tick(3300); assert.equal(engine.frame, 3); h.tick(3400); assert.equal(engine.frame, 2); h.tick(3600); assert.equal(engine.frame, 0); engine.stop();
assert.equal(engine.frame, 0); assert.equal(engine.playing, false);
engine.seek(1000); assert.equal(engine.frame, 3); engine.step(-100); assert.equal(engine.frame, 0);
engine.configureClip({ duration: 1, loop: 'pingpong' }); engine.play(); h.tick(4000); h.tick(9000); assert.equal(engine.frame, 0); engine.pause();
const saved = engine.saveData(); h.save(); const restored = harness([...h.storage]); assert.equal(JSON.stringify(restored.engine.project), JSON.stringify(engine.project), 'Independent animation autosave round trips');
restored.engine.loadProject(saved); assert.equal(JSON.stringify(restored.engine.project), JSON.stringify(engine.project)); assert.equal(JSON.stringify(staticScene), staticBefore);
assert(!JSON.stringify(saved).includes('data:image'), 'Saved animation uses asset references, not duplicated source bitmaps');
const detached = engine.project; detached.name = 'Changed outside'; assert.notEqual(engine.project.name, detached.name, 'Project getters cannot mutate live animation state');
const corrupt = harness([['minish-maker-animation-v1', '{bad json']]); assert.equal(corrupt.engine.project.clips.length, 1, 'A corrupt autosave never prevents opening the app');
const demoPath = path.join(root, 'examples/Walking Adventure.minish-animation.json');
if (fs.existsSync(demoPath)) {
  const demo = engine.validateProject(JSON.parse(fs.readFileSync(demoPath, 'utf8')));
  assert.equal(demo.clips.length, 2);
  for (const clip of demo.clips) for (let at = 0; at < clip.duration; at++) {
    const evaluated = engine.evaluateFrame(clip, at);
    assert.equal(evaluated.width, clip.width); assert.equal(evaluated.height, clip.height);
    for (const object of evaluated.objects) assert(Number.isInteger(object.x) && Number.isInteger(object.y), 'Demo poses and movement stay crisp');
  }
}
const beforeWorld = engine.project;
const world = engine.addClip({ name: 'Animated Hyrule', width: 4992, height: 3168, exportScale: 1, duration: 96, fps: 12,
  worldId: 'hyrule', worldStyle: 'terrain', generated: { encounters: [{ id: 'dance', bounds: { x: 400, y: 600, w: 80, h: 60 } }], requestedOptions: { density: 'balanced', seed: 'world fixture' } }, objects: [], tracks: [] });
assert.equal(world.width * world.height, 15814656, 'The complete native Hyrule atlas is supported without reducing its pixels');
const worldBeforeReplace = engine.project, idBeforeReplace = world.id;
const replaced = engine.replaceClip({ name: 'Fresh world', generated: { encounters: [{ id: 'boss' }], requestedOptions: { seed: 'new world' } } });
assert.equal(replaced.id, idBeforeReplace, 'Reroll keeps the current clip identity');
assert.deepEqual(engine.project.clips.filter(clip => clip.id !== idBeforeReplace), beforeWorld.clips, 'Replacing a generated world preserves every other animation');
assert.equal(engine.currentClip.generated.requestedOptions.seed, 'new world');
engine.undo(); assert.deepEqual(engine.project, worldBeforeReplace, 'World reroll is one complete Undo');
const worldSaved = engine.saveData(); engine.loadProject(worldSaved);
assert.deepEqual(engine.currentClip.generated, worldBeforeReplace.clips.at(-1).generated, 'Generated story coordinates and seeds survive saving and reopening');
assert.equal(engine.currentClip.worldId, 'hyrule'); assert.equal(engine.currentClip.worldStyle, 'terrain');
const reopenedWorld = engine.project;
assert.throws(() => engine.replaceClip({ width: 8192, height: 4096, exportScale: 1 })); assert.deepEqual(engine.project, reopenedWorld, 'An invalid replacement never changes a world or its history');
const importedWorld = engine.importScene({ name: 'Plain whole-world scene', width: 4992, height: 3168, exportScale: 1,
  worldId: 'hyrule', worldStyle: 'terrain', generated: { encounters: ['static scene, not choreography'] }, objects: [] });
assert.equal(importedWorld.worldId, 'hyrule'); assert.equal(importedWorld.generated, undefined, 'A static import keeps its map type without claiming animated encounters');
const resized = engine.addClip(); engine.configureClip({ width: 4992, height: 3168 });
assert.equal(engine.currentClip.exportScale, 1, 'Resizing a normal clip to world size chooses a safe integer enlargement without shrinking its native canvas');
assert.equal(engine.currentClip.id, resized.id);
const ownership = harness().engine, owner = ownership.addObject({ ...base, visible: true });
const ownedEffect = ownership.addObject({ ...base, visible: true, simpleCompanion: { version: 1, ownerId: owner.id, role: 'projectile' } });
const nestedEffect = ownership.addObject({ ...base, visible: true, simpleCompanion: { version: 1, ownerId: ownedEffect.id, role: 'burst' } });
const independentEffect = ownership.addObject({ ...base, visible: true });
ownership.setKeys(owner.id, [{ frame: 5, values: { visible: false } }, { frame: 9, values: { visible: true } }]);
ownership.setKeys(ownedEffect.id, [{ frame: 0, values: { visible: true } }, { frame: 11, values: { visible: false } }, { frame: 13, values: { visible: true } }]);
const visibilityBeforeEvaluation = ownership.project, revisionBeforeEvaluation = ownership.state.revision;
for (const at of [0, 5, 8, 9, 11, 13]) {
  const ownerVisible = at < 5 || at >= 9, effectVisible = ownerVisible && (at < 11 || at >= 13);
  assert.equal(ownership.getObjectAt(ownedEffect.id, at).visible, effectVisible, 'An owned effect inherits keyed actor visibility while retaining its own timing');
  assert.equal(ownership.getObjectAt(nestedEffect.id, at).visible, effectVisible, 'Visibility propagates through owned effect chains');
  assert.equal(ownership.getObjectAt(independentEffect.id, at).visible, true, 'Independent effects keep their own visibility');
  const visibleIds = ownership.evaluateFrame(ownership.currentClip, at).objects.map(object => object.id);
  assert.equal(visibleIds.includes(ownedEffect.id), effectVisible);
  assert.equal(visibleIds.includes(nestedEffect.id), effectVisible);
  const hiddenIncluded = ownership.evaluateFrame(ownership.currentClip, at, { includeHidden: true }).objects.find(object => object.id === ownedEffect.id);
  assert.equal(hiddenIncluded.visible, effectVisible, 'Hidden-object inspection agrees with rendered ownership visibility');
}
assert.deepEqual(ownership.project, visibilityBeforeEvaluation, 'Evaluating ownership never rewrites saved objects or tracks');
assert.equal(ownership.state.revision, revisionBeforeEvaluation, 'Evaluation creates no edit or Undo entry');
ownership.setTrack(owner.id, { muted: true }); const mutedProject = ownership.project;
assert.equal(ownership.getObjectAt(ownedEffect.id, 0).visible, false);
assert.equal(ownership.getObjectAt(nestedEffect.id, 0).visible, false);
assert.equal(ownership.getObjectAt(independentEffect.id, 0).visible, true);
assert.deepEqual(ownership.project, mutedProject, 'Muting an actor suppresses effects without rewriting their saved keys');
ownership.undo(); assert.deepEqual(ownership.project, visibilityBeforeEvaluation);
assert.equal(ownership.getObjectAt(ownedEffect.id, 0).visible, true, 'Undoing a mute immediately restores the original effect timing');
ownership.updateObject(owner.id, { visible: false }); assert.equal(ownership.getObjectAt(ownedEffect.id, 0).visible, false, 'Base actor visibility also hides its effects'); ownership.undo();
const ownershipReopened = harness().engine; ownershipReopened.loadProject(ownership.saveData());
assert.equal(ownershipReopened.getObjectAt(ownedEffect.id, 5).visible, false, 'Inherited visibility survives saving and reopening');
const orphan = ownership.addObject({ ...base, simpleCompanion: { version: 1, ownerId: 'missing-owner', role: 'projectile' } });
assert.equal(ownership.getObjectAt(orphan.id, 0).visible, false, 'A missing actor cannot leave an orphaned projectile visible');
const cycleA = ownership.addObject({ ...base, visible: true }), cycleB = ownership.addObject({ ...base, visible: true, simpleCompanion: { version: 1, ownerId: cycleA.id } });
ownership.updateObject(cycleA.id, { simpleCompanion: { version: 1, ownerId: cycleB.id } });
assert.equal(ownership.getObjectAt(cycleA.id, 0).visible, false); assert.equal(ownership.getObjectAt(cycleB.id, 0).visible, false);
assert(!ownership.evaluateFrame().objects.some(object => [cycleA.id, cycleB.id].includes(object.id)), 'Malformed ownership cycles are hidden without recursion errors');
const rotations = harness().engine, rotated = rotations.addObject({ ...base, rotation: -45, animationAnchor: 'feet' });
assert.equal(rotated.rotation, 315, 'Negative angles wrap to one of the eight 45 degree choices');
rotations.updateObject(rotated.id, { rotation: 407 }); assert.equal(rotations.getObjectAt(rotated.id, 0).rotation, 45, 'Imported angles round to the nearest 45 degree step');
rotations.setKeys(rotated.id, [{ frame: 0, values: { rotation: 45 }, easing: 'linear' }, { frame: 10, values: { rotation: 180 } }]);
assert.equal(rotations.getObjectAt(rotated.id, 6).rotation, 45, 'Rotation keys hold exact 45 degree steps even on a linear position curve');
assert.equal(rotations.getObjectAt(rotated.id, 10).rotation, 180);
for (const value of [NaN, Infinity, '', 'turn left']) assert.throws(() => rotations.setKey(rotated.id, 1, { rotation: value }), /number for sprite rotation/);
rotations.clearKeyProperties(rotated.id, ['rotation']);
rotations.applyPoseSequence(rotated.id, walking, { hold: 3 });
const rotatedFeet = object => {
  const radians = object.rotation * Math.PI / 180, halfHeight = object.sh * object.scale / 2;
  return { x: object.x + object.sw * object.scale / 2 - Math.sin(radians) * halfHeight,
    y: object.y + halfHeight + Math.cos(radians) * halfHeight };
};
for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
  rotations.updateObject(rotated.id, { rotation: angle }); const anchor = rotatedFeet(rotations.getObjectAt(rotated.id, 0));
  for (let frame = 0; frame < 48; frame++) {
    const point = rotatedFeet(rotations.getObjectAt(rotated.id, frame));
    assert(Math.abs(point.x - anchor.x) <= .51 && Math.abs(point.y - anchor.y) <= .51, 'Changing crop bounds preserves the rotated actor anchor');
  }
}
const rotationCopy = rotations.duplicateObject(rotated.id); assert.equal(rotationCopy.rotation, 315);
const rotationClipCopy = rotations.duplicateClip(); assert(rotationClipCopy.objects.every(object => object.rotation === 315));
const reopenedRotations = harness().engine; reopenedRotations.loadProject(rotations.saveData());
assert.equal(reopenedRotations.getObjectAt(rotationClipCopy.objects[1].id, 12).rotation, 315, 'Rotation survives duplication, pose sequences and a project round trip');
const legacyRotation = JSON.parse(JSON.stringify(staticScene)); delete legacyRotation.objects[0].rotation;
assert.equal(reopenedRotations.importScene(legacyRotation).objects[0].rotation, 0, 'Older scene files remain upright');
unsubscribe(); assert(snapshots.includes('sequence') && snapshots.includes('frame') && snapshots.includes('undo'));
console.log('PASS: genuine-pose anchoring, independent motion curves, keyed and owned-effect visibility, mute inheritance without saved-track mutation, key editing, track locks, duplication, duration trimming, safe validation, playback/loop/pingpong timing, scene isolation, Undo/Redo, and animation autosave.');
