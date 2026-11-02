// Run: node tests/world-scenes.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const curated = read('assets/curated.json'), bosses = read('assets/full-bosses.json'), sprites = read('assets/sprites.json');
const original = read('assets/catalog.json'), pieces = read('assets/pieces.json');
const actualWorldData = read('assets/world-maps.json');
const combatSandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'combat-library.js'), 'utf8'), combatSandbox);
const combat = combatSandbox.window.MINISH_COMBAT_LIBRARY;
const terrainLocations = Array.from({ length: 6 }, (_, index) => ({ id: 'region-' + index, name: 'Reviewed region ' + index,
  theme: ['field', 'woods', 'town', 'ruins', 'mountain', 'ranch'][index],
  rect: { x: 100 + index % 3 * 1600, y: 100 + Math.floor(index / 3) * 1450, w: 1400, h: 1200 } }));
const illustratedLocations = Array.from({ length: 9 }, (_, index) => ({ id: 'map-region-' + index, name: 'Map region ' + index,
  theme: ['field', 'woods', 'town'][index % 3], rect: { x: 8 + index % 3 * 52, y: 15 + Math.floor(index / 3) * 37, w: 40, h: 28 } }));
const mapAssets = [
  { id: 'world-terrain-test', width: 4992, height: 3168 },
  { id: 'world-illustrated-test', width: 164, height: 131 }
];
const worldData = { assets: mapAssets, worlds: [
  { id: 'hyrule', name: 'Hyrule', style: 'terrain', width: 4992, height: 3168, backgroundScale: 1,
    assetId: 'world-terrain-test', pieceId: 'world-terrain-test', locations: terrainLocations, presetId: 'world-hyrule' },
  { id: 'hyrule-illustrated', name: 'Hyrule illustrated map', style: 'illustrated', width: 164, height: 131, backgroundScale: 8,
    assetId: 'world-illustrated-test', pieceId: 'world-illustrated-test', locations: illustratedLocations, presetId: 'world-illustrated' }
] };
const sandbox = { console, MINISH_CURATED: curated, MINISH_BOSSES: bosses, MINISH_SPRITES: sprites, MINISH_WORLD_MAPS: worldData, MINISH_COMBAT_LIBRARY: combat };
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(path.join(root, 'world-scenes.js'), 'utf8'), vm.createContext(sandbox), { filename: 'world-scenes.js' });
const generator = sandbox.MINISH_WORLD_SCENES;
const generate = options => JSON.parse(JSON.stringify(generator.buildScene(options)));
const allPieces = new Map([...Object.values({ ...curated.sheets, ...bosses.sheets }), ...Object.values(combat.sheets)].flatMap(sheet => sheet.pieces || []).map(piece => [piece.id, piece]));
const allAssets = new Map([...original.assets, ...pieces.assets, ...sprites.assets, ...curated.assets, ...bosses.assets, ...actualWorldData.assets, ...mapAssets, ...combat.assets].map(asset => [asset.id, asset]));
const excluded = new Set([...curated.excludedPieceIds, ...sprites.excludedPieceIds]);
const box = object => ({ x: object.x, y: object.y, w: object.sw * object.scale, h: object.sh * object.scale });
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function check(scene, world, options, roomy = true) {
  assert.equal(scene.width, world.width * world.backgroundScale);
  assert.equal(scene.height, world.height * world.backgroundScale);
  assert.equal(scene.exportScale, 1, 'Large map exports retain native canvas pixels');
  assert(scene.width * scene.height <= 16777216);
  const background = scene.objects[0];
  assert.equal(background.assetId, world.assetId);
  assert.equal(background.layer, 'terrain');
  assert.equal(background.scale, world.backgroundScale, 'Only the illustrated map is enlarged, by an integer');
  const seen = new Set();
  for (const object of scene.objects) {
    assert(!seen.has(object.id)); seen.add(object.id);
    const asset = allAssets.get(object.assetId); assert(asset, 'Every object resolves an included image');
    for (const value of ['x', 'y', 'sx', 'sy', 'sw', 'sh', 'scale']) assert(Number.isInteger(object[value]), value);
    assert(object.x >= 0 && object.y >= 0 && object.sw > 0 && object.sh > 0 && object.scale >= 1);
    assert(object.x + object.sw * object.scale <= scene.width && object.y + object.sh * object.scale <= scene.height, object.pieceId);
    assert(object.sx >= 0 && object.sy >= 0 && object.sx + object.sw <= asset.width && object.sy + object.sh <= asset.height);
    if (object !== background) {
      const source = allPieces.get(object.pieceId); assert(source, 'Every encounter uses a genuine ready-gallery piece');
      assert(!excluded.has(object.pieceId));
      for (const key of ['assetId', 'sx', 'sy', 'sw', 'sh']) assert.equal(object[key], source[key], 'Native source crop: ' + key);
      assert.equal(object.scale, 1, 'Encounter art retains its native pixel scale');
      assert(!['part', 'marker', 'effect', 'tile', 'region', 'environment'].includes(source.kind));
      if (source.sourceId === '19728') assert.equal(source.group, 'Tiny Link', 'No detached marker rays become characters');
    }
  }
  const cast = scene.objects.slice(1);
  const occupiedPixels = cast.reduce((sum, object) => sum + object.sw * object.sh * object.scale ** 2, 0);
  assert(occupiedPixels / (scene.width * scene.height) < .15, 'Encounters keep the world map visually dominant');
  for (let first = 0; first < cast.length; first++) for (let second = first + 1; second < cast.length; second++) {
    assert(!overlap(box(cast[first]), box(cast[second])), 'Encounter pieces must remain individually readable');
  }
  if (options.populate === false) {
    assert.equal(scene.objects.length, 1); assert(!scene.generated, 'A blank canvas is a handmade scene, never a reroll target');
    return;
  }
  assert.equal(scene.generated.kind, 'world');
  assert.equal(scene.generated.worldId, world.id);
  assert.equal(scene.generated.requestedOptions.scope, world.style === 'illustrated' ? 'world-illustrated' : 'world-terrain');
  assert.equal(scene.generated.requestedOptions.density, options.density || 'varied');
  assert.equal(scene.generated.easterEggCount, scene.generated.easterEggs.length);
  assert.equal(scene.generated.encounters.length, scene.generated.easterEggCount);
  assert(scene.generated.easterEggCount > 0);
  if (roomy) assert.equal(scene.generated.easterEggCount, world.style === 'illustrated'
    ? { quiet: 5, balanced: 9, lively: 13 }[scene.generated.density]
    : { quiet: 20, balanced: 36, lively: 52 }[scene.generated.density], 'Roomy reviewed areas support each requested density');
  for (const encounter of scene.generated.encounters) {
    assert(encounter.name && encounter.location && encounter.region);
    const location = world.locations.find(value => value.name === encounter.location); assert(location);
    const area = location.rect, scale = world.backgroundScale;
    assert(encounter.x >= area.x * scale && encounter.y >= area.y * scale);
    assert(encounter.x + encounter.w <= (area.x + area.w) * scale && encounter.y + encounter.h <= (area.y + area.h) * scale);
    assert(!('objectIds' in encounter) && !('pieceIds' in encounter), 'Discoveries survive imported object-ID remapping');
  }
  assert.equal(scene.generated.bossCount, cast.filter(object => object.sourceId.startsWith('full-boss-')).length);
  assert.equal(scene.generated.battleCount, scene.generated.easterEggs.filter(egg => egg.battle).length);
  for (const egg of scene.generated.easterEggs) {
    if (egg.battle) {
      const actors = cast.filter(object => object.easterEggId === egg.id && !object.combat?.staticEffect);
      const sides = [0, 1].map(side => actors.filter(object => object.worldEncounter.side === side));
      assert(sides.every(team => team.length > 0), 'A battle has two opposing teams');
      assert(actors.every(object => object.worldEncounter.battle && object.worldEncounter.axis === egg.formation));
      for (const actor of actors.filter(object => object.sourceId === '6369')) {
        if (actor.combat?.actionId) {
          const action = combat.getAction(actor.combat.actionId); assert(action && action.kind !== 'equip');
          assert.equal(action.direction, egg.formation === 'horizontal' ? actor.flipX ? 'left' : actor.combat.direction : actor.worldEncounter.side ? 'up' : 'down');
          assert(action.poseIds.includes(actor.pieceId), 'The static weapon pose belongs to a reviewed genuine action');
          continue;
        }
        const side = actor.worldEncounter.side, sequence = allPieces.get(actor.pieceId).sequence;
        const range = egg.formation === 'horizontal' ? [18, 27] : side ? [28, 37] : [9, 17];
        assert(sequence >= range[0] && sequence <= range[1], 'Link uses a genuinely directional source pose for his opponent');
        assert.equal(actor.flipX, egg.formation === 'horizontal' && side === 0);
      }
      for (const actor of actors) {
        const target = actors.find(other => other.combat?.actorKey === actor.combat.targetKey); assert(target);
        assert.notEqual(target.combat.side, actor.combat.side, 'Weapon targets stay on the opposing team');
        if (actor.worldCombat) {
          const action = combat.getAction(actor.worldCombat.actionId); assert(action);
          assert.equal(actor.combat.weapon, action.weapon);
          assert(actor.x >= actor.worldCombat.cell.x && actor.y >= actor.worldCombat.cell.y && actor.x + actor.sw <= actor.worldCombat.cell.x + actor.worldCombat.cell.w && actor.y + actor.sh <= actor.worldCombat.cell.y + actor.worldCombat.cell.h,
            'A weapon action reserves the full reviewed source footprint');
        }
      }
      const maxEnd = (team, axis) => Math.max(...team.map(object => object[axis] + object[axis === 'x' ? 'sw' : 'sh']));
      const minStart = (team, axis) => Math.min(...team.map(object => object[axis]));
      const axis = egg.formation === 'horizontal' ? 'x' : 'y';
      assert(maxEnd(sides[0], axis) + 20 <= minStart(sides[1], axis), 'Battle teams face a clear attack corridor');
    }
    for (const effect of cast.filter(object => object.easterEggId === egg.id && object.combat?.staticEffect)) {
      assert(effect.combat.ownerKey && effect.combat.targetKey && effect.combat.phase === 'release');
      assert(cast.some(actor => actor.combat?.actorKey === effect.combat.ownerKey));
      assert(cast.some(actor => actor.combat?.actorKey === effect.combat.targetKey));
    }
    assert.equal(cast.filter(object => object.easterEggId === egg.id).length, egg.sourcePieceIds.length);
    assert(egg.sourcePieceIds.length > 0 && egg.sourcePieceIds.every(id => allPieces.has(id)));
  }
}

const signatures = new Set(), recipes = new Set(), bossFamilies = new Set(), featuredSources = new Set(), weapons = new Set();
for (let index = 0; index < 100; index++) {
  const options = { seed: 'world-review-' + index, scope: 'world-terrain', density: ['quiet', 'balanced', 'lively', 'varied'][index % 4] };
  const scene = generate(options);
  check(scene, worldData.worlds[0], options);
  assert.deepEqual(scene, generate(options), 'The same seed recreates every placement and joke');
  signatures.add(JSON.stringify(scene.objects.map(({ pieceId, x, y }) => ({ pieceId, x, y }))));
  scene.generated.easterEggs.forEach(egg => recipes.add(egg.storyId));
  scene.objects.forEach(object => featuredSources.add(object.sourceId));
  scene.objects.forEach(object => { if (object.combat?.weapon) weapons.add(object.combat.weapon); });
  assert(scene.generated.battleCount >= 2, 'Every populated world offers battles alongside peaceful encounters');
  scene.objects.filter(object => object.sourceId.startsWith('full-boss-')).forEach(object => bossFamilies.add(object.sourceId));
}
assert.equal(signatures.size, 100, 'Fresh seeds produce different world compositions');
assert(recipes.size >= 45, 'New worlds include a broad mixture of stories and battles');
for (const source of ['6373', '6530', '6396', '6394', '6393', '24932']) assert(featuredSources.has(source), 'Featured genuine cast source appears: ' + source);
for (const source of ['6556', '64168', '6524', '6472']) assert(featuredSources.has(source), 'Genuinely armed enemy source appears: ' + source);
for (const weapon of ['sword', 'shield', 'bomb', 'boomerang', 'mole-mitts', 'spear', 'bone', 'stone']) assert(weapons.has(weapon), 'World scenes use varied reviewed weapons and tools: ' + weapon);
assert.equal(bossFamilies.size, 9, 'Every included boss family can appear where its complete pose fits');
for (const density of ['quiet', 'balanced', 'lively', 'varied']) {
  const options = { seed: 'illustrated-' + density, scope: 'world-illustrated', density };
  check(generate(options), worldData.worlds[1], options);
}
for (const world of worldData.worlds) {
  const options = { worldId: world.id, seed: 'blank', populate: false };
  check(generate(options), world, options);
}
const saved = generate({ seed: 'portable-world', scope: 'world-terrain', density: 'quiet' });
const rerolled = generate({ ...saved.generated.requestedOptions, seed: 'another-world' });
assert.equal(rerolled.worldId, saved.worldId);
assert.equal(rerolled.generated.density, 'quiet');
assert.notDeepEqual(rerolled.objects, saved.objects);

const restricted = { ...worldData.worlds[0], locations: [{ id: 'air', name: 'Open air', theme: 'sky',
  placement: 'boss-only', bossFamilies: ['full-boss-6534'], rect: { x: 500, y: 500, w: 240, h: 160 } }] };
sandbox.MINISH_WORLD_MAPS = { ...worldData, worlds: [restricted] };
const airScene = generate({ scope: 'world-terrain', seed: 'air-test', density: 'quiet' });
assert(airScene.objects.length > 1);
assert(airScene.objects.slice(1).every(object => object.sourceId === 'full-boss-6534'), 'Only the reviewed floating boss family enters an air-only zone');
sandbox.MINISH_WORLD_MAPS = { ...worldData, worlds: [{ ...worldData.worlds[0], locations: [] }] };
assert.throws(() => generate({ seed: 'no-areas' }), /reviewed encounter areas/);
assert.equal(generate({ seed: 'empty-map', populate: false }).objects.length, 1);
sandbox.MINISH_WORLD_MAPS = { ...worldData, worlds: [{ ...worldData.worlds[0], width: 8192, height: 8192 }] };
assert.throws(() => generate({ seed: 'too-large' }), /supported size/);
sandbox.MINISH_WORLD_MAPS = worldData;
assert.throws(() => generate({ worldId: 'missing-world' }), /not available/);

// Use the actual included maps as well as the roomy geometry fixture. Safe
// source areas may cap a busy world before its requested maximum is reached.
sandbox.MINISH_WORLD_MAPS = actualWorldData;
const actualSignatures = new Set(), actualBossFamilies = new Set();
for (const world of actualWorldData.worlds) for (const density of ['quiet', 'balanced', 'lively']) {
  for (let index = 0; index < 12; index++) {
    const options = { worldId: world.id, density, seed: 'actual-world-' + index };
    const scene = generate(options); check(scene, world, options, false);
    if (world.style === 'terrain') scene.objects.filter(object => object.sourceId.startsWith('full-boss-')).forEach(object => actualBossFamilies.add(object.sourceId));
    assert.deepEqual(scene, generate(options));
    const minimum = world.style === 'terrain' ? { quiet: 16, balanced: 28, lively: 40 }[density] : { quiet: 5, balanced: 9, lively: 13 }[density];
    assert(scene.generated.easterEggCount >= minimum, 'The actual map has enough encounters for its chosen density');
    assert(scene.generated.battleCount >= Math.floor(scene.generated.easterEggCount * .28), 'Actual maps contain a visible share of action encounters');
    assert(scene.generated.bossCount >= (world.style === 'illustrated' ? {quiet: 3, balanced: 4, lively: 5}[density] : 1), 'Each populated world includes complete bosses in reviewed zones');
    actualSignatures.add(JSON.stringify(scene.objects.map(({ pieceId, x, y }) => ({ pieceId, x, y }))));
    for (const egg of scene.generated.easterEggs) {
      const location = world.locations.find(value => value.id === egg.locationId); assert(location);
      const objects = scene.objects.filter(object => object.easterEggId === egg.id);
      if (location.allowedRoles?.length === 1 && location.allowedRoles[0] === 'boss') {
        assert(objects.every(object => location.bossFamilies.includes(object.sourceId)), 'Only reviewed boss families use sky or water-only locations');
      }
      for (const input of world.annotationOnlyRects || []) {
        const rect = { x: input.x * world.backgroundScale, y: input.y * world.backgroundScale, w: input.w * world.backgroundScale, h: input.h * world.backgroundScale };
        assert(objects.every(object => !overlap(box(object), rect)), 'No discovery lands on a community annotation exclusion');
      }
    }
  }
}
assert.equal(actualBossFamilies.size, 9, 'The reviewed terrain zones can show every included boss family across seeds');
assert.equal(actualSignatures.size, 72, 'Every reviewed actual-map seed and density produces a fresh arrangement');
console.log('PASS: actual and fixture world maps, deterministic Easter eggs, native source crops, readable non-overlapping clusters, 9 boss families where space permits, featured characters, opposed-team battles, increased bosses, density-preserving rerolls, portable discoveries, safe source zones and blank canvases.');
