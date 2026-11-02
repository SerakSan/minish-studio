// Run: node tests/world-animation.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const catalog = read('assets/catalog.json'), indexed = read('assets/pieces.json'), sprites = read('assets/sprites.json');
const curated = read('assets/curated.json'), bosses = read('assets/full-bosses.json'), worlds = read('assets/world-maps.json');
const combatSandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'combat-library.js'), 'utf8'), combatSandbox);
const combat = combatSandbox.window.MINISH_COMBAT_LIBRARY;
const pieces = new Map([...Object.values(indexed.sheets).flatMap(sheet => sheet.pieces || []), ...(curated.legacyPieces || []),
  ...Object.values({ ...curated.sheets, ...bosses.sheets, ...worlds.sheets }).flatMap(sheet => sheet.pieces || []),
  ...Object.values(combat.sheets).flatMap(sheet => sheet.pieces || [])].map(piece => [piece.id, piece]));
const assets = new Map([...catalog.assets, ...indexed.assets, ...sprites.assets, ...curated.assets, ...bosses.assets, ...worlds.assets, ...combat.assets].map(asset => [asset.id, asset]));
const storage = new Map(), timers = new Map();
let timer = 0;
const adapter = { assets: [...assets.values()], getAsset: id => assets.get(String(id)) || null, getPiece: id => pieces.get(String(id)) || null };
const noNetwork = () => assert.fail('World generation must not upload projects or make network requests');
const sandbox = { console, MINISH_ASSETS: catalog, MINISH_PIECES: indexed, MINISH_SPRITES: sprites,
  MINISH_CURATED: curated, MINISH_BOSSES: bosses, MINISH_WORLD_MAPS: worlds, MINISH_STUDIO: adapter, MINISH_COMBAT_LIBRARY: combat,
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  setTimeout: callback => { timers.set(++timer, callback); return timer; }, clearTimeout: id => timers.delete(id),
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, fetch: noNetwork, XMLHttpRequest: noNetwork, WebSocket: noNetwork };
sandbox.window = sandbox;
const context = vm.createContext(sandbox);
for (const file of ['animation-engine.js', 'simple-animation.js', 'world-scenes.js', 'world-animation.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
const engine = sandbox.MINISH_ANIMATION.init(adapter), simple = sandbox.MINISH_SIMPLE_ANIMATION.init(engine, adapter);
const generator = sandbox.MINISH_WORLD_ANIMATION;
const plain = value => JSON.parse(JSON.stringify(value));
const buildClip = options => plain(generator.buildClip(options));
const bounds = object => ({ x: object.x, y: object.y, w: object.sw * object.scale, h: object.sh * object.scale });
const right = box => box.x + box.w, bottom = box => box.y + box.h;
const overlap = (a, b) => a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);

// Old local review projects retain their references. A seeded ID collision
// must not cause pure ready-action compilation to use an edited live object.
const retired = adapter.getPiece('curated-24932-farore-side-1'); assert(retired);
const legacyBase = { id: 'egg-1-0', kind: 'sprite', assetId: retired.assetId, sourceId: retired.sourceId, pieceId: retired.id,
  sx: retired.sx, sy: retired.sy, sw: retired.sw, sh: retired.sh, x: 32, y: 32, scale: 1, layer: 'objects', visible: true };
engine.loadProject({ format: 'minish-cap-animation', version: 1, name: 'Private compatibility check', activeClip: 'old-project', clips: [{ id: 'old-project', name: 'Saved source parts',
  width: 240, height: 160, exportScale: 1, fps: 12, duration: 48, loop: 'loop', objects: [legacyBase], tracks: [{ id: 'old-track', objectId: legacyBase.id,
    keys: [{ frame: 12, values: { pieceId: 'curated-24932-farore-side-2' }, easing: 'hold' }] }] }] }, { history: false });
assert.equal(engine.evaluateFrame(engine.currentClip, 12).objects[0].pieceId, 'curated-24932-farore-side-2');
const untouched = JSON.stringify(engine.project), savedTimers = timers.size, selectedBefore = engine.selectedObjectId;
const linkPiece = curated.sheets['6369'].pieces.find(piece => piece.sequence === 28);
const detached = { ...legacyBase, ...linkPiece, id: legacyBase.id, pieceId: linkPiece.id, kind: 'sprite', x: 40, y: 40, scale: 1 };
const compiled = simple.compileRecipe(detached, { presetId: 'link-walk-away', motion: 'none', distance: 0, speed: 'normal' }, { fps: 12, duration: 48 });
assert(compiled.keys.length > 1 && compiled.keys.every(key => pieces.has(key.values.pieceId)));
assert.equal(JSON.stringify(engine.project), untouched);

const excluded = new Set([...curated.excludedPieceIds, ...sprites.excludedPieceIds]);
const observedActivities = new Set(), observedBossSources = new Set(), observedWeapons = new Set(), observedEffects = new Set();
let multiToolFighters = 0, contactFrames = 0;
let duelClips = 0, maxDuelsObserved = 0;
const actualTerrainBossFamilies = new Set();
function verify(clip) {
  const world = worlds.worlds.find(world => world.id === clip.worldId); assert(world);
  assert.equal(clip.width, world.canvasWidth); assert.equal(clip.height, world.canvasHeight);
  assert.equal(clip.fps, 12); assert.equal(clip.duration, 96); assert.equal(clip.loop, 'loop'); assert.equal(clip.exportScale, 1);
  assert.equal(clip.generated.kind, 'world-animation');
  assert.equal(clip.generated.worldId, world.id);
  assert.deepEqual([...clip.generated.bossFamilies].sort(), [...new Set(clip.objects.filter(object => object.sourceId.startsWith('full-boss-')).map(object => object.sourceId))].sort());
  assert.equal(clip.generated.battleCount, clip.generated.easterEggs.filter(egg => egg.battle).length);
  if (world.style === 'terrain') clip.objects.filter(object => object.sourceId.startsWith('full-boss-')).forEach(object => actualTerrainBossFamilies.add(object.sourceId));
  assert.equal(clip.generated.requestedOptions.fps, clip.fps);
  assert.equal(clip.generated.requestedOptions.duration, clip.duration);
  assert(clip.generated.animatedObjectCount > clip.objects.length * .5, 'Most placed actors should visibly move or change genuine pose');
  assert(/editor/.test(clip.generated.note) && /not extracted/.test(clip.generated.note));
  const background = clip.objects.find(object => object.layer === 'terrain'); assert(background);
  const backgroundTrack = clip.tracks.find(track => track.objectId === background.id);
  assert(backgroundTrack.locked && backgroundTrack.keys.length === 0, 'The complete map is static and protected from accidental drags');
  const ids = new Set(clip.objects.map(object => object.id)); assert.equal(ids.size, clip.objects.length);
  const tracks = new Map(clip.tracks.map(track => [track.objectId, track])); assert.equal(tracks.size, clip.tracks.length);
  for (const object of clip.objects) {
    assert(assets.has(object.assetId)); assert(pieces.has(object.pieceId));
    if (object.layer !== 'terrain') assert(!excluded.has(object.pieceId));
    if (object.sourceId.startsWith('full-boss-')) {
      observedBossSources.add(object.sourceId); assert(/editor assembly/.test(object.pieceName));
    }
    const track = tracks.get(object.id); assert(track);
    assert(track.keys.length <= clip.duration);
    const keyFrames = new Set();
    for (const key of track.keys) {
      assert(key.frame >= 0 && key.frame < clip.duration && !keyFrames.has(key.frame)); keyFrames.add(key.frame);
      if (key.values.pieceId) assert(pieces.has(key.values.pieceId) && !excluded.has(key.values.pieceId));
      for (const field of ['x', 'y']) if (field in key.values) assert(Number.isInteger(key.values[field]));
    }
    if (object.worldAnimation) {
      if (object.worldAnimation.role === 'combat-effect') {
        assert(object.combat.ownerKey && object.combat.targetKey);
        assert(clip.objects.some(actor => actor.combat?.actorKey === object.combat.ownerKey));
        assert(clip.objects.some(actor => actor.combat?.actorKey === object.combat.targetKey));
        const effects = object.worldAnimation.effectIds.map(id => combat.getEffect(id)); assert(effects.every(Boolean));
        effects.forEach(effect => observedEffects.add(effect.id));
        const allowed = new Set(effects.flatMap(effect => effect.pieceIds));
        for (const key of track.keys) if (key.values.visible) assert(allowed.has(key.values.pieceId), 'Weapon effects use their exact reviewed source frames');
        assert(track.keys.some(key => key.values.visible) && track.keys.some(key => key.values.visible === false), 'Weapon effects appear only during release or contact');
        continue;
      }
      const available = simple.presetsFor({ kind: 'sprite', sourceId: object.sourceId });
      const presets = (object.worldAnimation.presetIds || [object.worldAnimation.presetId]).map(id => available.find(preset => preset.id === id)); assert(presets.every(Boolean));
      for (const key of track.keys) if (key.values.pieceId && object.worldAnimation.presetId !== 'still') assert(presets.some(preset => preset.poseIds.includes(key.values.pieceId)), 'Every changed pose belongs to a reviewed ready action');
      if (object.worldCombat?.actionIds?.length) {
        const actions = object.worldCombat.actionIds.map(id => combat.getAction(id)); assert(actions.every(Boolean));
        assert(actions.every(action => action.kind !== 'equip'), 'A readied bow does not pretend to shoot without authentic arrow art');
        actions.forEach(action => observedWeapons.add(action.weapon));
        assert.deepEqual(object.worldCombat.phases, ['anticipation', 'attack', 'contact', 'recovery']);
        if (new Set(actions.map(action => action.weapon)).size > 1) multiToolFighters++;
      }
    }
  }
  const validated = engine.validateProject({ format: 'minish-cap-animation', activeClip: clip.id, name: 'Generated world', clips: [clip] });
  assert.equal(validated.clips[0].generated.encounters.length, clip.generated.encounters.length);
  assert.equal(validated.clips[0].worldId, clip.worldId);
  const positions = new Map(), poses = new Map();
  for (let frame = 0; frame < clip.duration; frame++) {
    const evaluated = engine.evaluateFrame(clip, frame, { includeHidden: true });
    const actors = evaluated.objects.filter(object => object.layer !== 'terrain');
    if (world.style === 'illustrated') assert(actors.filter(object => object.visible !== false).reduce((sum, object) => sum + object.sw * object.sh * object.scale ** 2, 0) / (clip.width * clip.height) < .18, 'Animated battles keep the illustrated map visible');
    for (const object of evaluated.objects) {
      const asset = assets.get(object.assetId); assert(asset);
      const rect = bounds(object);
      assert(contains({ x: 0, y: 0, w: clip.width, h: clip.height }, rect), object.pieceId + ' world bounds');
      assert(object.sx >= 0 && object.sy >= 0 && object.sw > 0 && object.sh > 0 && object.sx + object.sw <= asset.width && object.sy + object.sh <= asset.height);
      if (object.layer === 'terrain') { assert.equal(object.x, 0); assert.equal(object.y, 0); continue; }
      const original = clip.objects.find(base => base.id === object.id), motion = original.worldAnimation;
      assert(contains(motion.motionBounds, rect), 'Evaluated poses stay inside whole-motion bounds: ' + JSON.stringify({ frame, id: object.id, piece: object.pieceId, rect, motion: motion.motionBounds }));
      const egg = clip.generated.easterEggs.find(egg => egg.id === object.easterEggId), location = world.locations.find(location => location.id === egg.locationId);
      const sourceArea = location.rect, scale = world.backgroundScale;
      assert(contains({ x: sourceArea.x * scale, y: sourceArea.y * scale, w: sourceArea.w * scale, h: sourceArea.h * scale }, rect), 'Every frame stays in a reviewed area');
      if (location.allowedRoles?.length === 1 && location.allowedRoles[0] === 'boss' && !['projectile', 'combat-effect'].includes(motion.role)) assert(location.bossFamilies.includes(object.sourceId));
      const signature = object.x + ',' + object.y + ',' + object.visible; if (!positions.has(object.id)) positions.set(object.id, new Set()); positions.get(object.id).add(signature);
      if (!poses.has(object.id)) poses.set(object.id, new Set()); poses.get(object.id).add(object.pieceId);
    }
    for (let first = 0; first < actors.length; first++) for (let second = first + 1; second < actors.length; second++) {
      const a = actors[first], b = actors[second];
      if (!overlap(bounds(a), bounds(b))) continue;
      const effects = [a, b].filter(object => object.worldAnimation?.role === 'combat-effect');
      if (effects.length && (a.visible === false || b.visible === false)) continue;
      if (effects.length === 2 && a.easterEggId === b.easterEggId) continue;
      const effect = effects[0], actor = effect === a ? b : a;
      if (effect && [effect.combat.ownerKey, ...(effect.combat.targetKeys || [])].includes(actor.combat?.actorKey)) { contactFrames++; continue; }
      assert.fail('Only an owned weapon effect may contact its declared opponent; unrelated bodies stay readable: ' + a.id + ' / ' + b.id);
    }
  }
  const animated = clip.objects.filter(object => object.layer !== 'terrain' && ((positions.get(object.id)?.size || 0) > 1 || (poses.get(object.id)?.size || 0) > 1 || object.worldAnimation?.role === 'projectile'));
  assert.equal(clip.generated.animatedObjectCount, animated.length);
  for (const type of clip.generated.activityTypes) observedActivities.add(type);
  for (const encounter of clip.generated.encounters) {
    assert(encounter.name && encounter.location && encounter.activity);
    assert(contains({ x: 0, y: 0, w: clip.width, h: clip.height }, encounter));
    assert(!('objectIds' in encounter), 'Discovery camera hints survive clip object-ID remapping');
  }
  if (clip.generated.duelCount) {
    duelClips++; maxDuelsObserved = Math.max(maxDuelsObserved, clip.generated.duelCount);
    const duelists = clip.objects.filter(object => object.worldAnimation?.role === 'duelist'); assert.equal(duelists.length, clip.generated.duelCount * 2);
    for (const eggId of new Set(duelists.map(object => object.easterEggId))) {
      const pair = duelists.filter(object => object.easterEggId === eggId); assert.equal(pair.length, 2);
      assert.notEqual(pair[0].sourceId, pair[1].sourceId, 'Each duel uses two distinct boss families');
    }
    const shot = clip.objects.find(object => object.worldAnimation?.role === 'projectile' || object.worldAnimation?.role === 'combat-effect' && object.combat.role === 'projectile'); assert(shot);
    const track = tracks.get(shot.id); assert(track.keys.some(key => key.values.visible === true) && track.keys.some(key => key.values.visible === false));
  }
}

const signatures = new Set();
for (const scope of ['world-terrain', 'world-illustrated']) for (const [index, density] of ['quiet', 'balanced', 'lively'].entries()) {
  const options = { scope, density, seed: 'world-animation-' + index };
  const clip = buildClip(options); verify(clip);
  assert.deepEqual(clip, buildClip(options), 'A seed recreates choreography, timing and source poses');
  signatures.add(JSON.stringify(clip.tracks));
}
assert.equal(signatures.size, 6);
for (let index = 0; index < 18; index++) verify(buildClip({ scope: index % 5 === 0 ? 'world-illustrated' : 'world-terrain', density: ['quiet', 'balanced', 'lively'][index % 3], seed: 'battle-safety-' + index }));
verify(buildClip({ scope: 'world-terrain', density: 'lively', seed: 'mazaal-review-2' }));
assert(maxDuelsObserved >= 2, 'Roomy worlds can contain several independent boss battles');
assert.equal(actualTerrainBossFamilies.size, 9, 'All nine boss families appear in real terrain zones across reviewed seeds');
assert(duelClips > 0, 'Roomy reviewed world areas can host a genuine two-boss face-off');
assert(observedActivities.has('dance') && observedActivities.has('parade') && observedActivities.has('chase') && observedActivities.has('stroll'));
assert(observedBossSources.size >= 4);
assert(observedActivities.has('battle'), 'Characters and mobs fight in opposed teams as well as dancing');
for (const weapon of ['sword', 'shield', 'bomb', 'boomerang', 'mole-mitts', 'spear', 'bone', 'stone']) assert(observedWeapons.has(weapon), 'Real world animations use diverse weapons: ' + weapon);
assert(observedEffects.has('impact') && observedEffects.has('explosion') && observedEffects.has('boomerang') && observedEffects.has('bone'));
assert(multiToolFighters > 0, 'Link can change between real reviewed tools during one battle');
assert(contactFrames > 0, 'Targeted game-art effects visibly contact opponents rather than hovering in the gap');
const project = plain(generator.buildProject({ scope: 'world-terrain', density: 'quiet', seed: 'saved-world-animation' }));
assert.equal(project.format, 'minish-cap-animation'); assert.equal(project.activeClip, project.clips[0].id);
const reopened = engine.validateProject(project); assert.equal(reopened.clips[0].generated.kind, 'world-animation');
const rerolled = buildClip({ ...project.clips[0].generated.requestedOptions, seed: 'a-new-performance' });
assert.equal(rerolled.worldId, project.clips[0].worldId); assert.equal(rerolled.duration, project.clips[0].duration);
assert.notDeepEqual(rerolled.tracks, project.clips[0].tracks);
assert.equal(JSON.stringify(engine.project), untouched, 'Generation preserves the user’s existing clips, retired source references and keys');
assert.equal(engine.selectedObjectId, selectedBefore); assert.equal(timers.size, savedTimers); assert.equal(storage.size, 0);
assert.throws(() => buildClip({ fps: 61 }), /valid|Choose/);
assert.throws(() => buildClip({ duration: 601 }), /valid|Choose/);
console.log('PASS: whole-world animation on both actual maps, genuine ready poses, multiple editor boss duels and volleys, opposed teams with real directional poses, featured characters, mob dances, coherent motions, every-frame safe bounds and separation, deterministic saves/rerolls, static backdrop, portable discoveries and untouched private projects.');
