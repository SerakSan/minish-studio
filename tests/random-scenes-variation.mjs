import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {};
const context = vm.createContext({ window, document: { getElementById: () => null }, console });
for (const file of ['assets/catalog.js', 'assets/pieces.js', 'assets/sprites.js', 'assets/curated.js', 'assets/full-bosses.js', 'combat-library.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const combat = window.MINISH_COMBAT_LIBRARY;
const pieces = new Map([...Object.values({ ...window.MINISH_PIECES.sheets, ...window.MINISH_CURATED.sheets, ...window.MINISH_BOSSES.sheets }), ...Object.values(combat.sheets)].flatMap(sheet => sheet.pieces || []).map(piece => [piece.id, piece]));
const assets = [...window.MINISH_ASSETS.assets, ...window.MINISH_PIECES.assets, ...window.MINISH_SPRITES.assets, ...window.MINISH_CURATED.assets, ...window.MINISH_BOSSES.assets, ...(combat.assets || [])];
const assetMap = new Map(assets.map(asset => [String(asset.id), asset]));
const resolvedPiece = id => {
  const value = pieces.get(id); if (!value) return null;
  return { ...value, assetId: String(window.MINISH_SPRITES.assetOverrides?.[value.assetId] || value.assetId) };
};
window.MINISH_STUDIO = { assets, getPiece: resolvedPiece };
vm.runInContext(fs.readFileSync(path.join(root, 'random-scenes.js'), 'utf8'), context);
const random = window.MINISH_RANDOM;
assert(random.stories.length >= 80, 'The authored story collection covers character outings, rescues, skirmishes and boss rivalries');
const stories = new Set(), cameras = new Set(), poses = new Set(), groups = new Set(), compositions = new Set();
const densityTotals = { quiet: 0, lively: 0 };
const exclusions = new Set([...window.MINISH_SPRITES.excludedPieceIds, ...window.MINISH_CURATED.excludedPieceIds]);
const hidden = new Set(window.MINISH_CURATED.hiddenSourceIds);
const deliberateWeaponContact = (a, b) => {
  const effect = a.generationRole === 'effects' && a.combat?.phase === 'impact' ? a : b.generationRole === 'effects' && b.combat?.phase === 'impact' ? b : null;
  const fighter = effect === a ? b : a;
  return !!(effect && fighter.combat?.actorKey && [effect.combat.ownerKey, effect.combat.targetKey].includes(fighter.combat.actorKey) &&
    ['melee', 'guard'].includes(combat.getAction(effect.combat.actionId)?.kind));
};
let verified = 0;
for (const template of window.MINISH_CURATED.scenes) {
  for (const density of ['quiet', 'balanced', 'lively']) {
    for (let index = 0; index < 150; index++) {
      const options = { templateId: template.id, density, seed: `variation-${index}` };
      const scene = random.buildScene(options);
      assert.deepEqual(scene, random.buildScene(options), 'A fixed seed and options repeat every choice');
      stories.add(scene.generated.storyId); cameras.add(template.id + ':' + JSON.stringify(scene.generated.cameraOffset));
      compositions.add(JSON.stringify(scene.objects));
      assert(scene.objects.some(object => object.sourceId === '6369'), 'Every composition has Link');
      assert.equal(scene.generated.density, density);
      const background = scene.objects.find(object => object.generationRole === 'background');
      assert.equal(background.sx - template.background.sx, scene.generated.cameraOffset.dx);
      assert.equal(background.sy - template.background.sy, scene.generated.cameraOffset.dy);
      if (density !== 'balanced') densityTotals[density] += scene.objects.length;
      const foreground = scene.objects.filter(object => object.generationRole !== 'background');
      for (const object of scene.objects) {
        const asset = assetMap.get(object.assetId);
        assert(asset, 'Every generated image belongs to the supplied catalog');
        assert(object.sx >= 0 && object.sy >= 0 && object.sx + object.sw <= asset.width && object.sy + object.sh <= asset.height, 'All crops remain inside their source');
        assert(Number.isInteger(object.x) && Number.isInteger(object.y), 'Placement stays on native pixels');
        assert(object.x >= 0 && object.y >= 0 && object.x + object.sw <= scene.width && object.y + object.sh <= scene.height, 'Every random piece is fully visible');
        assert(!exclusions.has(object.pieceId) && !hidden.has(object.sourceId), 'Reference labels and excluded cuts never enter a scene');
        if (object.pieceId) poses.add(object.pieceId);
        if (object.sourceId) groups.add(object.sourceId);
        if (['actors', 'enemies', 'props'].includes(object.generationRole) && object.sourceId !== '6369') {
          const foot = { x: object.x + (object.combat?.anchor?.x ?? object.sw / 2) + scene.generated.cameraOffset.dx,
            y: object.y + (object.combat?.anchor?.y ?? object.sh) + scene.generated.cameraOffset.dy };
          const zones = template.zones.filter(zone => zone.role === object.generationRole || zone.roles?.includes(object.generationRole));
          assert(zones.some(zone => foot.x >= zone.x - .5 && foot.x <= zone.x + zone.w + .5 && foot.y >= zone.y - .5 && foot.y <= zone.y + zone.h + .5), 'Ground placements remain in reviewed source-world zones after camera movement');
        }
      }
      for (let a = 0; a < foreground.length; a++) for (let b = a + 1; b < foreground.length; b++) {
        const x = foreground[a], y = foreground[b];
        assert(deliberateWeaponContact(x, y) || !(x.x < y.x + y.sw && x.x + x.sw > y.x && x.y < y.y + y.sh && x.y + x.sh > y.y), 'Only a tied genuine weapon impact may contact its fighters');
      }
      if (template.theme === 'town' || template.theme === 'minish') assert(!scene.objects.some(object => ['enemies', 'boss', 'effects'].includes(object.generationRole)), 'Town and village stories stay peaceful');
      if (scene.generated.storyId === 'quiet-woods') assert(!scene.objects.some(object => object.generationRole === 'enemies'), 'Quiet woodland stories stay quiet');
      verified++;
    }
  }
}
assert.equal(stories.size, 35, 'Every story authored for the original six settings can be reached');
assert(cameras.size > 100, 'Setting composition varies through safe camera offsets');
assert(poses.size > 200, 'A broad set of actual reviewed whole poses is reachable');
assert(groups.size >= 20, 'The expanded cast uses several genuine source collections');
assert(compositions.size > 2000, 'Seeds produce distinct compositions across stories and settings');
assert(densityTotals.lively > densityTotals.quiet, 'Lively density produces more pieces across the reviewed settings');
for (const mood of ['peaceful', 'lively', 'adventure']) for (const template of window.MINISH_CURATED.scenes) {
  const scene = random.buildScene({ seed: 'mood-check', templateId: template.id, mood });
  assert.equal(scene.generated.requestedMood, mood);
  assert(scene.generated.story);
}

const possibilities = random.getPossibilities();
assert(possibilities.faithfulExperiences >= 300 && possibilities.wildExperiences >= 3000, 'The expanded named stories are available across the actual environment collection');
assert(possibilities.settings >= 90 && possibilities.faithfulSettings >= 40, 'Generation reaches a broad genuine environment collection');
const allExperiences = random.experiences(), reachedExperiences = new Set(), reachedSettings = new Set(), namedCast = new Set(), battleStories = new Set();
const heroWeapons = new Set(), enemyWeapons = new Set(), visibleEffects = new Set(), armedFoes = new Set();
assert.equal(allExperiences.length, possibilities.totalExperiences);
for (const experience of allExperiences) {
  for (let index = 0; index < 3; index++) {
    const options = { seed: 'experience-' + index, templateId: experience.templateId, storyId: experience.storyId, style: experience.style, density: 'lively' };
    const scene = random.buildScene(options);
    assert.deepEqual(scene, random.buildScene(options), 'Expanded settings remain deterministic');
    assert.equal(scene.generated.storyId, experience.storyId, 'Every advertised story is constructible in its setting');
    assert.equal(scene.generated.style, experience.style);
    assert.equal(scene.generated.imaginative, experience.style === 'wild', 'Unlikely combinations are labeled editor imagination');
    assert(scene.width <= 384 && scene.height <= 256, 'Random canvas sizes stay manageable');
    reachedExperiences.add(experience.id); reachedSettings.add(experience.backgroundId);
    const foreground = scene.objects.filter(object => object.generationRole !== 'background');
    for (const object of scene.objects) {
      const asset = assetMap.get(object.assetId);
      assert(asset && !exclusions.has(object.pieceId) && !hidden.has(object.sourceId));
      assert(object.sx >= 0 && object.sy >= 0 && object.sx + object.sw <= asset.width && object.sy + object.sh <= asset.height);
      assert(object.x >= 0 && object.y >= 0 && object.x + object.sw <= scene.width && object.y + object.sh <= scene.height);
      assert.equal(object.scale, 1, 'Wild combinations retain native game pixels');
      assert(Number.isInteger(object.x) && Number.isInteger(object.y));
      if (object.generationCharacter) namedCast.add(object.generationCharacter);
    }
    for (let a = 0; a < foreground.length; a++) for (let b = a + 1; b < foreground.length; b++) {
      const x = foreground[a], y = foreground[b];
      assert(deliberateWeaponContact(x, y) || !(x.x < y.x + y.sw && x.x + x.sw > y.x && x.y < y.y + y.sh && x.y + x.sh > y.y), 'Every expanded arrangement is clear apart from its tied weapon impacts');
    }
    if (experience.storyId === 'wild-boss-summit') assert.equal(scene.objects.filter(object => object.generationRole === 'boss').length, 2, 'Boss summits contain two complete bosses');
    if (experience.style === 'faithful' && scene.generated.theme !== 'boss') assert(!scene.objects.some(object => object.generationRole === 'boss'), 'Game-inspired settings do not acquire an unrelated boss');
    if (scene.generated.battle) {
      battleStories.add(experience.storyId);
      const battle = scene.generated.battle, combatants = scene.objects.filter(object => battle.combatants.includes(object.id));
      assert(battle.teams.length >= 2, 'A battle contains actual visible opposing teams');
      assert.equal(combatants.length, battle.combatants.length, 'Battle metadata maps to editable placed pieces');
      const hero = combatants.find(object => object.sourceId === '6369');
      assert(hero, 'Link is present in battle compositions');
      const source = pieces.get(hero.pieceId);
      if (hero.combat?.actionId) {
        const action = combat.getAction(hero.combat.actionId);
        assert(action && action.poseIds.includes(hero.pieceId), 'Link uses an explicitly reviewed genuine weapon action');
        heroWeapons.add(action.weapon);
        assert.equal(hero.generationFacing, experience.style === 'wild' ? 'right' : 'up');
        assert.equal(hero.combat.direction, hero.generationFacing);
        assert.equal(hero.flipX, action.direction !== hero.combat.direction);
      }
      if (experience.style === 'wild') {
        if (!hero.combat?.actionId) assert(source.sequence >= 18 && source.sequence <= 27 && hero.flipX && hero.generationFacing === 'right', 'A genuine left-facing Link pose is mirrored toward the opposing side');
        for (const foe of combatants.filter(object => object.generationRole === 'enemies')) {
          assert(foe.x + foe.sw / 2 > hero.x + hero.sw / 2, 'Enemy teams are composed opposite Link');
          const pose = pieces.get(foe.pieceId);
          if (foe.combat?.actionId) {
            const action = combat.getAction(foe.combat.actionId);
            assert(action && action.poseIds.includes(foe.pieceId) && action.sourceId === foe.sourceId);
            enemyWeapons.add(action.weapon); armedFoes.add(foe.sourceId);
            continue;
          }
          if (foe.generationCharacter === 'vaati') assert.equal(pose.sequence, 34, 'The actual left-facing Sorcerer pose faces Link');
          if (foe.generationCharacter === 'octorok') assert(pose.sequence >= 9 && pose.sequence <= 12, 'Octoroks face left toward Link instead of using a detached particle');
          if (foe.generationCharacter === 'rope') assert(pose.sequence >= 1 && pose.sequence <= 4, 'Ropes face left toward Link');
        }
      } else if (!hero.combat?.actionId) assert(source.sequence >= 28 && source.sequence <= 37 && !hero.flipX && hero.generationFacing === 'up', 'Link faces into the reviewed encounter area');
      const keys = new Map(combatants.map(object => [object.combat.actorKey, object]));
      assert.equal(keys.size, combatants.length, 'Each fighter has a unique stable key independent of editable object IDs');
      for (const object of combatants) {
        if (!object.combat?.targetKey) continue;
        const target = keys.get(object.combat.targetKey); assert(target);
        assert.notEqual(target.generationTeam, object.generationTeam, 'Weapons aim at an actual opposing fighter');
      }
      for (const effect of scene.objects.filter(object => object.generationRole === 'effects')) {
        const owner = keys.get(effect.combat?.ownerKey), target = keys.get(effect.combat?.targetKey);
        assert(owner && target && owner.generationTeam !== target.generationTeam, 'A combat effect belongs to a visible fighter and opponent');
        if (effect.combat.actionId) {
          const action = combat.getAction(effect.combat.actionId), definition = combat.getEffect(effect.combat.effectId);
          assert.equal(action.id, owner.combat.actionId);
          const effectPieces = [...(definition.pieceIds || []), ...Object.values(definition.directions || {}).flatMap(value => Array.isArray(value) ? value : value.pieceIds || [])];
          assert(effectPieces.includes(effect.pieceId), 'Weapons emit their own genuine gameplay effect');
          if (action.weapon === 'bow') assert(effect.combat.direction === 'left' || effect.combat.direction === 'right'
            ? effect.combat.origin.y === effect.combat.aim.y : effect.combat.origin.x === effect.combat.aim.x, 'Arrow sprites follow an actual cardinal shot line');
          visibleEffects.add(effect.combat.effectId);
        }
      }
      for (const loadout of battle.loadouts) assert(keys.has(loadout.actorKey) && combat.getAction(loadout.actionId), 'Saved loadouts remain tied to stable fighter keys');
      if (battle.kind === 'boss-duel') {
        const bosses = combatants.filter(object => object.generationRole === 'boss');
        assert.equal(bosses.length, 2);
        assert.equal(new Set(bosses.map(object => object.sourceId)).size, 2, 'Boss rivals come from distinct genuine boss families');
        assert.equal(new Set(bosses.map(object => object.generationTeam)).size, 2, 'Rival bosses have opposing teams');
        assert(battle.projectiles.length >= 1, 'Boss crossfire has visible genuine projectiles');
        const centers = bosses.map(object => object.x + object.sw / 2).sort((a, b) => a - b);
        for (const effect of scene.objects.filter(object => battle.projectiles.includes(object.id))) assert(effect.x + effect.sw / 2 > centers[0] && effect.x + effect.sw / 2 < centers[1], 'Boss projectiles travel through the space between rivals');
      }
    }
  }
}
assert.equal(reachedExperiences.size, possibilities.totalExperiences);
assert.equal(reachedSettings.size, possibilities.settings);
for (const character of ['din', 'nayru', 'farore', 'ezlo', 'vaati', 'swordmaster', 'mountainMinish', 'dampe', 'graveyardSpirit']) assert(namedCast.has(character), character + ' can appear in an actual generated scene');
assert(battleStories.size >= 20, 'Battles include many distinct authored encounters');
for (const weapon of ['sword', 'bow', 'bomb', 'boomerang', 'shield', 'mole-mitts', 'gust-jar', 'pacci']) assert(heroWeapons.has(weapon), 'Link can actually use ' + weapon + ' in generated battles');
for (const source of ['64168', '6556', '6504', '6472', '6524', '6413']) assert(armedFoes.has(source), 'The armed enemy source ' + source + ' is reachable');
assert(enemyWeapons.size >= 5, 'Opponents use several genuine weapon and projectile families');
assert(visibleEffects.size >= 3, 'Different tools produce visible, owned gameplay effects');
const bossFamilies = new Set();
for (let index = 0; index < 150; index++) {
  const scene = random.buildScene({ seed: 'all-bosses-' + index, style: 'wild', templateId: 'wild-env-6526-town', storyId: 'wild-boss-tea' });
  for (const object of scene.objects.filter(object => object.generationRole === 'boss')) bossFamilies.add(object.sourceId);
}
assert.equal(bossFamilies.size, 9, 'Wild mashups can reach all nine supplied complete boss families');

// Test the actual one-click handler with a controlled asynchronous insertion.
const controls = new Map();
function control(id, value = '') {
  const node = { id, value, textContent: id, disabled: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  controls.set(id, node); return node;
}
for (const id of ['generateSceneBtn', 'rerollSceneBtn', 'randomSceneBtn', 'closeRandomBtn', 'randomStatus', 'statusText', 'randomPossibilities']) control(id);
const themeControl = control('randomTheme', 'any');
themeControl.options = ['any', 'town', 'woods', 'minish', 'boss', 'indoors', 'dungeon', 'sky'].map(value => ({ value, disabled: false }));
control('randomMood', 'any'); control('randomDensity', 'varied'); control('randomStyle', 'mixed'); control('randomSeed', '');
const dialog = control('randomDialog'); dialog.open = false; dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
let current = { activeSlide: 'handmade', slides: [{ id: 'handmade', name: 'Keep this', objects: [] }] }, insertions = 0, rolls = 0, seedCounter = 0, unblock = null;
const originalHandmade = JSON.stringify(current.slides[0]);
const uiStudio = { assets, getPiece: resolvedPiece,
  get project() { return structuredClone(current); },
  async insertScene(scene) { insertions++; current.slides.push(structuredClone(scene)); current.activeSlide = scene.id; },
  async rerollScene(scene) {
    rolls++;
    if (unblock) await new Promise(resolve => { unblock.resolve = resolve; });
    const existing = current.slides.find(slide => slide.id === current.activeSlide);
    if (existing?.generated) current.slides[current.slides.indexOf(existing)] = { ...structuredClone(scene), id: existing.id };
    else { current.slides.push(structuredClone(scene)); current.activeSlide = scene.id; }
  }
};
const uiWindow = { ...window, MINISH_STUDIO: uiStudio, crypto: { getRandomValues(bytes) { bytes[0] = ++seedCounter; bytes[1] = seedCounter * 7919; return bytes; } } };
const uiContext = vm.createContext({ window: uiWindow, document: { getElementById: id => controls.get(id) || null }, console });
vm.runInContext(fs.readFileSync(path.join(root, 'random-scenes.js'), 'utf8'), uiContext);
unblock = {};
const firstRoll = uiWindow.MINISH_RANDOM.reroll();
assert.equal(await uiWindow.MINISH_RANDOM.reroll(), null, 'A fast second click is ignored while a scene loads');
assert.equal(rolls, 1);
unblock.resolve(); unblock = null;
const firstResult = await firstRoll;
assert(firstResult);
assert.equal(JSON.stringify(current.slides[0]), originalHandmade, 'One-click Surprise never replaces a handmade scene');
assert.equal(current.slides.length, 2);
const oldSeed = firstResult.generated.seed, generatedId = current.activeSlide;
controls.get('randomStyle').value = 'faithful'; controls.get('randomTheme').value = 'indoors'; controls.get('randomDensity').value = 'quiet';
const secondResult = await controls.get('rerollSceneBtn').handlers.click();
assert(secondResult);
assert.notEqual(secondResult.generated.seed, oldSeed, 'One-click Surprise always uses a fresh seed');
assert.equal(secondResult.generated.requestedStyle, 'mixed', 'One-click Surprise preserves the generated scene choices instead of silently using different dialog settings');
assert.equal(current.activeSlide, generatedId);
assert.equal(current.slides.length, 2, 'One-click Surprise replaces an active generated scene instead of filling the carousel');
assert.equal(JSON.stringify(current.slides[0]), originalHandmade);
controls.get('randomTheme').value = 'sky'; controls.get('randomStyle').value = 'faithful'; uiWindow.MINISH_RANDOM.updateAvailability();
assert.equal(controls.get('randomTheme').value, 'any', 'An unavailable sky setting resets when switching to Game-inspired');
assert(themeControl.options.find(option => option.value === 'sky').disabled);
controls.get('randomStyle').value = 'wild'; uiWindow.MINISH_RANDOM.updateAvailability();
assert(!themeControl.options.find(option => option.value === 'sky').disabled);
assert(controls.get('randomPossibilities').textContent.includes(String(possibilities.wildExperiences)));
assert.equal(insertions, 0, 'The quick handler delegates to the safe reroll API');
console.log(`PASS: ${verified} original-setting density cases; all ${reachedExperiences.size} named experiences across ${reachedSettings.size} genuine environments; ${battleStories.size} authored battles; ${heroWeapons.size} Link tools and ${armedFoes.size} armed enemy sources; ${visibleEffects.size} genuine owned effects; directional source poses, body/weapon anchors, tied contact impacts, distinct boss families, stable loadouts, readable placement and safe one-click rerolls.`);
