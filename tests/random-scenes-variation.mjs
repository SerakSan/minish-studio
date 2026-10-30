import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {};
const context = vm.createContext({ window, document: { getElementById: () => null }, console });
for (const file of ['assets/catalog.js', 'assets/pieces.js', 'assets/sprites.js', 'assets/curated.js', 'assets/full-bosses.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const pieces = new Map(Object.values({ ...window.MINISH_PIECES.sheets, ...window.MINISH_CURATED.sheets, ...window.MINISH_BOSSES.sheets }).flatMap(sheet => sheet.pieces || []).map(piece => [piece.id, piece]));
const assets = [...window.MINISH_ASSETS.assets, ...window.MINISH_PIECES.assets, ...window.MINISH_SPRITES.assets, ...window.MINISH_CURATED.assets, ...window.MINISH_BOSSES.assets];
const assetMap = new Map(assets.map(asset => [String(asset.id), asset]));
window.MINISH_STUDIO = { assets, getPiece: id => pieces.get(id) || null };
vm.runInContext(fs.readFileSync(path.join(root, 'random-scenes.js'), 'utf8'), context);
const random = window.MINISH_RANDOM;
assert(random.stories.length >= 40);
const stories = new Set(), cameras = new Set(), poses = new Set(), groups = new Set(), compositions = new Set();
const densityTotals = { quiet: 0, lively: 0 };
const exclusions = new Set([...window.MINISH_SPRITES.excludedPieceIds, ...window.MINISH_CURATED.excludedPieceIds]);
const hidden = new Set(window.MINISH_CURATED.hiddenSourceIds);
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
          const foot = { x: object.x + object.sw / 2 + scene.generated.cameraOffset.dx, y: object.y + object.sh + scene.generated.cameraOffset.dy };
          const zones = template.zones.filter(zone => zone.role === object.generationRole || zone.roles?.includes(object.generationRole));
          assert(zones.some(zone => foot.x >= zone.x - .5 && foot.x <= zone.x + zone.w + .5 && foot.y >= zone.y - .5 && foot.y <= zone.y + zone.h + .5), 'Ground placements remain in reviewed source-world zones after camera movement');
        }
      }
      for (let a = 0; a < foreground.length; a++) for (let b = a + 1; b < foreground.length; b++) {
        const x = foreground[a], y = foreground[b];
        assert(!(x.x < y.x + y.sw && x.x + x.sw > y.x && x.y < y.y + y.sh && x.y + x.sh > y.y), 'Generated cast and effects do not collide');
      }
      if (template.theme === 'town' || template.theme === 'minish') assert(!scene.objects.some(object => ['enemies', 'boss', 'effects'].includes(object.generationRole)), 'Town and village stories stay peaceful');
      if (scene.generated.storyId === 'quiet-woods') assert(!scene.objects.some(object => object.generationRole === 'enemies'), 'Quiet woodland stories stay quiet');
      verified++;
    }
  }
}
assert.equal(stories.size, 22, 'Every authored story can be reached');
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
assert(possibilities.faithfulExperiences >= 150 && possibilities.wildExperiences >= 1000, 'Hundreds of named setting/story experiences are supplied');
assert(possibilities.settings >= 90 && possibilities.faithfulSettings >= 40, 'Generation reaches a broad genuine environment collection');
const allExperiences = random.experiences(), reachedExperiences = new Set(), reachedSettings = new Set();
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
    }
    for (let a = 0; a < foreground.length; a++) for (let b = a + 1; b < foreground.length; b++) {
      const x = foreground[a], y = foreground[b];
      assert(!(x.x < y.x + y.sw && x.x + x.sw > y.x && x.y < y.y + y.sh && x.y + x.sh > y.y), 'Every expanded arrangement is geometrically collision-free');
    }
    if (experience.storyId === 'wild-boss-summit') assert.equal(scene.objects.filter(object => object.generationRole === 'boss').length, 2, 'Boss summits contain two complete bosses');
    if (experience.style === 'faithful' && scene.generated.theme !== 'boss') assert(!scene.objects.some(object => object.generationRole === 'boss'), 'Game-inspired settings do not acquire an unrelated boss');
  }
}
assert.equal(reachedExperiences.size, possibilities.totalExperiences);
assert.equal(reachedSettings.size, possibilities.settings);
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
const uiStudio = { assets, getPiece: id => pieces.get(id) || null,
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
console.log(`PASS: ${verified} original-setting density cases; all ${reachedExperiences.size} named experiences across ${reachedSettings.size} genuine environments; all 9 boss families; ${poses.size} reviewed poses; source bounds, placement, labels, and one-click reroll controls.`);
