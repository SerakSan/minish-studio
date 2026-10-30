// Run: node tests/simple-animation.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const curated = read('assets/curated.json'), bosses = read('assets/full-bosses.json'), sprites = read('assets/sprites.json'), catalog = read('assets/catalog.json'), pieces = read('assets/pieces.json');
const sheets = { ...pieces.sheets, ...curated.sheets, ...bosses.sheets };
const pieceMap = new Map(Object.values(sheets).flatMap(sheet => sheet.pieces || []).map(piece => [piece.id, piece]));
const assets = [...catalog.assets, ...pieces.assets, ...sprites.assets, ...curated.assets, ...bosses.assets];
const adapter = { assets, getAsset: id => assets.find(asset => String(asset.id) === String(id)), getPiece: id => pieceMap.get(id) || null };
function harness(saved) {
  const storage = new Map(), window = { MINISH_STUDIO: adapter, MINISH_CURATED: curated, MINISH_BOSSES: bosses,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  const context = vm.createContext({ window, console, setTimeout: () => 1, clearTimeout() {}, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  for (const file of ['animation-engine.js', 'simple-animation.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  window.MINISH_ANIMATION.init(adapter); window.MINISH_SIMPLE_ANIMATION.init();
  if (saved) window.MINISH_ANIMATION.loadProject(saved);
  return { engine: window.MINISH_ANIMATION, simple: window.MINISH_SIMPLE_ANIMATION, storage };
}
const { engine, simple } = harness();
const piece = curated.sheets['6369'].pieces.find(piece => piece.sequence === 28);
const makeSprite = (pose = piece, patch = {}) => engine.addObject({ kind: 'sprite', assetId: pose.assetId, pieceId: pose.id, sourceId: pose.sourceId,
  sx: pose.sx, sy: pose.sy, sw: pose.sw, sh: pose.sh, pieceName: pose.name, x: 30, y: 90, scale: 1, layer: 'objects', ...patch });
const base = makeSprite(), id = base.id;
const ready = simple.presetsFor(id);
assert.equal(ready.length, 4); assert.equal(ready[0].id, 'still');
assert.equal(simple.cyclesFor('6369').length, ready.length);
assert.equal(simple.cyclesFor('6369').find(preset => preset.id === 'link-walk-right').label, 'Walk left', 'The historical preset ID retains the reviewed left-facing label');
assert.equal(simple.cyclesFor('6370').find(preset => preset.id === 'capless-walk-right').label, 'Walk left');
assert.equal(simple.cyclesFor('missing-source').length, 1, 'Unreviewed sources retain still + movement without speculative pose cycles');
assert.equal(simple.previewHold(ready[1], 'normal', 12), 2);
assert.equal(simple.previewHold(ready[1], 'normal', 24), 4, 'Pose cadence is independent of clip FPS');
assert.equal(simple.previewHold(ready[1], 'fast', 24), 2);
assert(simple.coverage.presets >= 30 && simple.coverage.sources.length >= 15);
for (const source of simple.coverage.sources) for (const preset of simple.cyclesFor(source).slice(1)) {
  const sheet = curated.sheets[source] || bosses.sheets[source];
  assert(preset.poseIds.length > 1);
  assert(preset.poseIds.every(id => sheet.pieces.some(piece => piece.id === id)), 'Every ready loop uses explicitly mapped source pieces');
  if (source.startsWith('full-boss-')) { assert(preset.assembly); assert.match(preset.label, /editor assembly/); }
}
const assemblySources = Object.keys(bosses.sheets);
assert.equal(assemblySources.length, 9);
assert(assemblySources.every(source => simple.cyclesFor(source).some(preset => preset.assembly)), 'Every supplied complete-boss family has reviewed editor animation');
const assemblyPresets = assemblySources.flatMap(source => simple.cyclesFor(source).filter(preset => preset.assembly));
assert(assemblyPresets.length >= 38, 'State-specific assembly cycles cover all supplied boss families');
const usedAssemblyPoses = new Set(assemblyPresets.flatMap(preset => preset.poseIds));
assert(usedAssemblyPoses.size >= 202, 'Ready assembly cycles cover 202 of the 206 supplied whole-boss poses without inventing missing frames');
const coverageReport = read('assets/bosses/animation-coverage.json');
assert.equal(coverageReport.counts.readyActions, simple.coverage.presets);
assert.equal(coverageReport.counts.readySources, simple.coverage.sources.length);
assert.equal(coverageReport.counts.assemblyActions, assemblyPresets.length);
assert.equal(coverageReport.counts.uniqueAnimatedWholeBossPoses, usedAssemblyPoses.size);
assert.deepEqual(coverageReport.presets.map(preset => preset.id).sort(), assemblyPresets.map(preset => preset.id).sort());
const checkedPNGs = new Set();
for (const preset of coverageReport.presets) {
  const actual = assemblyPresets.find(item => item.id === preset.id);
  assert.deepEqual(preset.poses.map(pose => pose.pieceId), Array.from(actual.poseIds), 'Coverage records the exact authored pose order');
  assert.equal(preset.repeat, actual.repeat);
  assert.equal(preset.anchorPart, actual.anchorPart);
  for (const pose of preset.poses) if (!checkedPNGs.has(pose.path)) {
    checkedPNGs.add(pose.path);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, pose.path))).digest('hex'), pose.sha256, 'Reused assembly PNGs retain their recorded checksums');
  }
}
function fixedPartPosition(object, label) {
  const pose = pieceMap.get(object.pieceId), part = pose.sourceParts.find(part => part.label === label), crop = pose.compositionCrop;
  let x = part.at.x + part.sourceRect.w / 2 - crop.x + crop.padding;
  let y = part.at.y + part.sourceRect.h / 2 - crop.y + crop.padding;
  if (object.flipX) x = pose.sw - x; if (object.flipY) y = pose.sh - y;
  return { x: object.x + x * object.scale, y: object.y + y * object.scale };
}
for (const [source, presetId, anchorPart] of [
  ['full-boss-6546', 'gleerok-look-around', 'Rocky shell/body'],
  ['full-boss-6506', 'octorok-leaf-turn', 'Affine-scaled body'],
  ['full-boss-535841', 'mazaal-active-hands', 'Head'],
  ['full-boss-6415', 'green-chuchu-expression', 'Foot/base']
]) {
  const h = harness(), first = bosses.sheets[source].pieces[0];
  const actor = h.engine.addObject({ kind: 'sprite', assetId: first.assetId, pieceId: first.id, sourceId: source, sx: first.sx, sy: first.sy, sw: first.sw, sh: first.sh, x: 37, y: 61, scale: 1, layer: 'objects' });
  h.simple.apply(actor.id, { presetId, motion: 'none' });
  for (const transform of [{ scale: 1, flipX: false }, { scale: 2, flipX: false }, { scale: 2, flipX: true, flipY: true }]) {
    h.simple.place(actor.id, transform);
    const start = fixedPartPosition(h.engine.getObjectAt(actor.id, 0), anchorPart);
    for (let frame = 0; frame < h.engine.currentClip.duration; frame++) {
      const point = fixedPartPosition(h.engine.getObjectAt(actor.id, frame), anchorPart);
      assert(Math.abs(point.x - start.x) <= .5 && Math.abs(point.y - start.y) <= .5, 'Changing crop bounds keeps the fixed boss component anchored: ' + JSON.stringify({ source, frame, transform, start, point }));
    }
    h.simple.apply(actor.id, { motion: 'right', distance: 24 });
    const movingStart = fixedPartPosition(h.engine.getObjectAt(actor.id, 0), anchorPart);
    for (const frame of [0, 7, 19, 30, 47]) {
      const point = fixedPartPosition(h.engine.getObjectAt(actor.id, frame), anchorPart);
      assert(Math.abs(point.x - movingStart.x - Math.round(24 * Math.min(1, frame / 24))) <= .5 && Math.abs(point.y - movingStart.y) <= .5, 'Whole-boss movement combines with component anchoring');
    }
    h.simple.apply(actor.id, { motion: 'none' });
  }
}
for (const source of assemblySources) {
  const h = harness(), first = bosses.sheets[source].pieces[0];
  const actor = h.engine.addObject({ kind: 'sprite', assetId: first.assetId, pieceId: first.id, sourceId: source, sx: first.sx, sy: first.sy, sw: first.sw, sh: first.sh, x: 8, y: 16, scale: 1, layer: 'objects' });
  h.engine.configureClip({ duration: 100 });
  for (const preset of h.simple.cyclesFor(source).filter(preset => preset.assembly)) {
    h.simple.apply(actor.id, { presetId: preset.id, motion: 'none' });
    const hold = h.simple.previewHold(preset, 'normal', h.engine.currentClip.fps);
    for (let frame = 0; frame < h.engine.currentClip.duration; frame++) {
      const position = Math.floor(frame / hold), expected = preset.poseIds[preset.repeat === false ? Math.min(preset.poseIds.length - 1, position) : position % preset.poseIds.length];
      const object = h.engine.getObjectAt(actor.id, frame);
      assert.equal(object.pieceId, expected, 'Every assembly action renders its explicit reviewed order');
      assert(Number.isInteger(object.x) && Number.isInteger(object.y));
    }
    assert(!h.simple.hasCustomKeys(actor.id), 'Assembly anchor keys remain owned by their Simple recipe');
  }
}
const transformation = harness(), transformPose = bosses.sheets['full-boss-6534'].pieces[0];
const transformingActor = transformation.engine.addObject({ kind: 'sprite', assetId: transformPose.assetId, pieceId: transformPose.id, sourceId: transformPose.sourceId, sx: 0, sy: 0, sw: transformPose.sw, sh: transformPose.sh, x: 12, y: 24, scale: 1, layer: 'objects' });
transformation.engine.configureClip({ duration: 4 });
transformation.simple.apply(transformingActor.id, { presetId: 'vaati-reborn-transformation', speed: 'slow' });
assert.equal(transformation.engine.currentClip.duration, 108, 'A one-shot assembly action extends a short clip to play completely at Slow');
assert.equal(transformation.engine.getObjectAt(transformingActor.id, 107).pieceId, bosses.sheets['full-boss-6534'].pieces[23].id, 'One-shot transformation holds its final supplied pose');
const expectedPoses = curated.sheets['6369'].pieces.filter(piece => piece.sequence >= 28 && piece.sequence <= 37);
const before = engine.project;
simple.apply(id, { presetId: 'link-walk-away', motion: 'right', distance: 32 });
assert(!simple.hasCustomKeys(id)); assert.equal(simple.getRecipe(id).presetId, 'link-walk-away');
for (let at = 0; at < engine.currentClip.duration; at++) {
  const rendered = engine.getObjectAt(id, at), expected = expectedPoses[Math.floor(at / 2) % expectedPoses.length];
  assert.equal(rendered.pieceId, expected.id);
  assert.equal(rendered.y + rendered.sh, base.y + base.sh, 'Ready pose changes keep actor feet anchored');
  assert(Math.abs(rendered.x + rendered.sw / 2 - (base.x + base.sw / 2 + Math.round(32 * Math.min(1, at / 24)))) <= .5);
  assert(Number.isInteger(rendered.x) && Number.isInteger(rendered.y));
}
engine.undo(); assert.deepEqual(engine.project, before, 'Recipe + metadata are one Undo'); engine.redo();
const beforeMove = engine.project, positions = [0, 7, 23, 47].map(at => engine.getObjectAt(id, at));
engine.seek(23); simple.moveBase(id, { dx: -43, dy: 12 });
for (const [index, at] of [0, 7, 23, 47].entries()) { const rendered = engine.getObjectAt(id, at); assert.equal(rendered.x, positions[index].x - 43); assert.equal(rendered.y, positions[index].y + 12); }
assert.equal(engine.currentClip.objects[0].x, -13, 'Placement is allowed outside the frame'); assert(!simple.hasCustomKeys(id));
engine.undo(); assert.deepEqual(engine.project, beforeMove); engine.redo();
simple.place(id, { x: -22, y: 100, scale: 2, flipX: true, layer: 'overlay' });
assert.equal(engine.currentClip.objects[0].x, -22); assert.equal(engine.currentClip.objects[0].scale, 2); assert.equal(engine.currentClip.objects[0].flipX, true);
assert(!simple.hasCustomKeys(id));
const beforeCopy = engine.project, copy = simple.duplicate(id);
assert(!simple.hasCustomKeys(copy.id), 'Duplicating translates metadata with movement keys');
for (const at of [0, 15, 47]) { const a = engine.getObjectAt(id, at), b = engine.getObjectAt(copy.id, at); assert.equal(b.x - a.x, 8); assert.equal(b.y - a.y, 8); }
engine.undo(); assert.deepEqual(engine.project, beforeCopy);
engine.setKey(id, 4, { visible: false, flipY: true }); engine.setKey(id, 8, { visible: true });
assert(!simple.hasCustomKeys(id), 'Visibility and styling edits do not become pose/movement conflicts');
simple.apply(id, { presetId: 'link-walk-toward', motion: 'bob', distance: 8, speed: 'fast' });
assert.equal(engine.getObjectAt(id, 4).visible, false); assert.equal(engine.getObjectAt(id, 8).visible, true); assert.equal(engine.getObjectAt(id, 10).flipY, true);
const customPose = curated.sheets['6369'].pieces.find(piece => piece.sequence === 18);
engine.setKey(id, 5, { pieceId: customPose.id });
assert(simple.inspect(id).modified); const custom = engine.project;
assert.throws(() => simple.apply(id, { presetId: 'link-walk-away' }), error => error.code === 'SIMPLE_CUSTOM_KEYS');
assert.deepEqual(engine.project, custom, 'Applying over custom keys requires explicit replacement and is otherwise a no-op');
simple.moveBase(id, { dx: 7, dy: -2 }); assert(simple.hasCustomKeys(id), 'Moving a custom track preserves its custom status');
assert.equal(engine.getTrack(id).keys.find(key => key.frame === 5).values.pieceId, customPose.id);
simple.apply(id, { presetId: 'link-walk-away', motion: 'none' }, { replaceCustom: true });
assert(!simple.hasCustomKeys(id)); assert.equal(engine.getObjectAt(id, 4).visible, false); assert.equal(engine.getObjectAt(id, 10).flipY, true);
simple.apply(id, { presetId: 'still', motion: 'none' });
assert(!engine.getTrack(id).keys.some(key => 'pieceId' in key.values || 'x' in key.values || 'y' in key.values));
assert.equal(engine.getObjectAt(id, 10).pieceId, base.pieceId, 'Still uses the chosen base pose');
simple.apply(id, { presetId: 'link-walk-away', motion: 'outback', distance: 20, speed: 'normal' });
engine.configureClip({ duration: 17, fps: 24 }); assert(!simple.hasCustomKeys(id), 'Duration trimming is not mistaken for a manual edit');
simple.refreshAll(); assert.equal(simple.getRecipe(id).motion, 'outback');
assert.equal(engine.getTrack(id).keys.find(key => key.frame === 4).values.pieceId, expectedPoses[1].id, 'Refresh retimes ready poses for new FPS');
engine.configureClip({ duration: 80 }); simple.refreshAll(); assert(engine.getTrack(id).keys.some(key => key.frame === 79));
const saved = engine.saveData(), restored = harness(saved);
assert.equal(JSON.stringify(restored.simple.getRecipe(id)), JSON.stringify(simple.getRecipe(id))); assert(!restored.simple.hasCustomKeys(id));
restored.simple.refreshAll(); assert(!restored.simple.hasCustomKeys(id));
const copiedClip = engine.duplicateClip(); assert(copiedClip.objects.every(object => !simple.hasCustomKeys(object.id)), 'Clip duplication keeps valid recipe ownership'); engine.undo();
const allBeforeInvalid = engine.project;
for (const recipe of [{ presetId: 'zelda-walk-toward' }, { distance: Infinity }, { distance: -1 }, { distance: 2049 }, { motion: 'teleport' }, { speed: 'warp' }]) {
  assert.throws(() => simple.apply(id, recipe)); assert.deepEqual(engine.project, allBeforeInvalid);
}
assert.throws(() => simple.place(id, { x: NaN })); assert.deepEqual(engine.project, allBeforeInvalid);
engine.setTrack(id, { locked: true }); const locked = engine.project;
assert.throws(() => simple.moveBase(id, { dx: 5 }), /Unlock/); assert.deepEqual(engine.project, locked);
assert.throws(() => simple.apply(id, { speed: 'fast' }), /Unlock/); assert.deepEqual(engine.project, locked); engine.setTrack(id, { locked: false });
const advanced = makeSprite(); engine.setKeys(advanced.id, [{ frame: 0, values: { x: 5 }, easing: 'linear' }, { frame: 30, values: { x: 65, pieceId: customPose.id }, easing: 'hold' }]);
assert(simple.hasCustomKeys(advanced.id)); const advancedBefore = engine.project, oldMiddle = engine.getObjectAt(advanced.id, 15);
simple.place(advanced.id, { x: advanced.x + 10, y: advanced.y - 4 });
assert.equal(engine.getObjectAt(advanced.id, 15).x, oldMiddle.x + 10); assert.equal(engine.getObjectAt(advanced.id, 15).y, oldMiddle.y - 4);
assert.equal(engine.getTrack(advanced.id).keys[0].easing, 'linear'); assert.equal(engine.getTrack(advanced.id).keys[1].values.pieceId, customPose.id);
engine.undo(); assert.deepEqual(engine.project, advancedBefore);
const dialogue = engine.addObject({ kind: 'dialogue', text: 'Hello, Hyrule! 🌱', x: 4, y: 100, scale: 1, layer: 'overlay', w: 200, h: 50 });
assert.deepEqual(Array.from(simple.presetsFor(dialogue), preset => preset.id), ['still', 'text-reveal']);
engine.configureClip({ duration: 4, fps: 12 }); simple.refreshAll();
engine.setKey(dialogue.id, 2, { visible: false, color: '#abcdef' });
const beforeText = engine.project;
simple.apply(dialogue.id, { presetId: 'text-reveal', fullText: 'Hi 🌱!', speed: 'normal', motion: 'none' });
assert.equal(engine.currentClip.duration, 22, 'Reveal extends a short clip and includes a reading pause');
assert.equal(engine.currentClip.objects.find(object => object.id === dialogue.id).text, 'Hi 🌱!');
assert.equal(simple.getRecipe(dialogue.id).fullText, 'Hi 🌱!');
assert.equal(engine.getObjectAt(dialogue.id, 0).text, ''); assert.equal(engine.getObjectAt(dialogue.id, 8).text, 'Hi 🌱');
assert.equal(engine.getObjectAt(dialogue.id, 10).text, 'Hi 🌱!');
assert.equal(engine.getObjectAt(dialogue.id, 2).visible, false); assert.equal(engine.getObjectAt(dialogue.id, 3).color, '#abcdef');
assert(engine.getTrack(id).keys.some(key => key.frame === 21), 'Existing ready movement extends when a text reveal lengthens the clip');
engine.undo(); assert.deepEqual(engine.project, beforeText, 'Reveal, clip extension and other ready-loop extension are one Undo'); engine.redo();
engine.seek(4); simple.place(dialogue.id, { text: 'A new full message' });
assert.equal(simple.getRecipe(dialogue.id).fullText, 'A new full message'); assert.equal(engine.currentClip.objects.find(object => object.id === dialogue.id).text, 'A new full message');
assert.equal(engine.getObjectAt(dialogue.id, 36).text, 'A new full message');
engine.setKey(dialogue.id, 3, { text: 'Custom' }); const customText = engine.project;
assert.throws(() => simple.apply(dialogue.id, { speed: 'fast' }), error => error.code === 'SIMPLE_CUSTOM_KEYS'); assert.deepEqual(engine.project, customText);
simple.apply(dialogue.id, { speed: 'fast' }, { replaceCustom: true }); assert(!simple.hasCustomKeys(dialogue.id));
assert.equal(engine.getObjectAt(dialogue.id, 18).text, 'A new full message');
const tooLong = engine.project;
assert.throws(() => simple.apply(dialogue.id, { fullText: 'A'.repeat(600), speed: 'slow' }), /600 frames/); assert.deepEqual(engine.project, tooLong, 'Oversized reveal fails without truncating full text or extending the clip');
simple.apply(dialogue.id, { presetId: 'still' }); assert.equal(engine.getObjectAt(dialogue.id, 0).text, 'A new full message');
simple.remove(dialogue.id); assert.equal(engine.currentClip.objects.find(object => object.id === dialogue.id).simpleAnimation, null);
assert(engine.getTrack(dialogue.id).keys.some(key => key.values.color === '#abcdef'), 'Removing a recipe preserves unrelated style/visibility keys');
const roundtrip = harness(engine.saveData()); assert(!roundtrip.simple.hasCustomKeys(id));
const timing = harness(), timedText = timing.engine.addObject({ kind: 'dialogue', text: 'Hi 🌱!', x: 4, y: 100, scale: 1, layer: 'overlay', w: 200, h: 50 });
timing.engine.configureClip({ duration: 1, fps: 12 });
timing.simple.apply(timedText.id, { presetId: 'text-reveal', speed: 'normal' });
assert.equal(timing.engine.currentClip.duration, 22); assert.equal(timing.engine.getObjectAt(timedText.id, 2).text, 'H');
assert.equal(timing.engine.getObjectAt(timedText.id, 10).text, 'Hi 🌱!');
timing.engine.batch(() => { timing.engine.configureClip({ fps: 24 }); timing.simple.refreshAll(); });
assert.equal(timing.engine.currentClip.duration, 44, 'Higher FPS preserves text reveal time and its one-second reading pause');
assert.equal(timing.engine.getObjectAt(timedText.id, 3).text, ''); assert.equal(timing.engine.getObjectAt(timedText.id, 4).text, 'H');
assert.equal(timing.engine.getObjectAt(timedText.id, 19).text, 'Hi 🌱'); assert.equal(timing.engine.getObjectAt(timedText.id, 20).text, 'Hi 🌱!');
assert.equal(timing.simple.getRecipe(timedText.id).fullText, 'Hi 🌱!');
timing.simple.apply(timedText.id, { speed: 'fast' });
assert.equal(timing.engine.getObjectAt(timedText.id, 2).text, 'H'); assert.equal(timing.engine.getObjectAt(timedText.id, 10).text, 'Hi 🌱!');
const overflow = harness(), longText = 'A'.repeat(150), longDialogue = overflow.engine.addObject({ kind: 'dialogue', text: longText, x: 0, y: 0, scale: 1, layer: 'overlay' });
overflow.simple.apply(longDialogue.id, { presetId: 'text-reveal', speed: 'normal' });
assert.equal(overflow.engine.currentClip.duration, 312);
const beforeFpsOverflow = JSON.stringify(overflow.engine.project);
assert.throws(() => overflow.engine.batch(() => { overflow.engine.configureClip({ fps: 24 }); overflow.simple.refreshAll(); }), /600 frames/);
assert.equal(JSON.stringify(overflow.engine.project), beforeFpsOverflow, 'An FPS change that exceeds the reveal limit rolls back FPS, timing, metadata and full text');
assert.equal(overflow.simple.getRecipe(longDialogue.id).fullText, longText);
assert(!JSON.stringify(engine.saveData()).includes('data:image'), 'Recipes keep genuine source references without embedded bitmaps or private paths');
console.log(`PASS: ${simple.coverage.presets} reviewed actions including ${assemblyPresets.length} boss assemblies across 9 families; calibrated body anchors, time-based cadence, precise whole-path placement, custom-key protection, duplication, trimming/extension, Unicode text reveal, atomic Undo/rollback, and project round trip.`);
