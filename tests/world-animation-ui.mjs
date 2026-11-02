import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const catalog = json('assets/catalog.json'), pieces = json('assets/pieces.json');
const curated = json('assets/curated.json'), bosses = json('assets/full-bosses.json'), sprites = json('assets/sprites.json'), worlds = json('assets/world-maps.json');
const assets = [...catalog.assets, ...pieces.assets, ...curated.assets, ...bosses.assets, ...sprites.assets, ...worlds.assets];
const allPieces = [...Object.values(pieces.sheets).flatMap(sheet => sheet.pieces), ...(curated.legacyPieces || []), ...Object.values({ ...curated.sheets, ...bosses.sheets, ...worlds.sheets }).flatMap(sheet => sheet.pieces)];
const assetMap = new Map(assets.map(asset => [asset.id, asset])), pieceMap = new Map(allPieces.map(piece => [piece.id, piece]));
class Field {
  constructor() { this.value = ''; this.open = false; this.hidden = false; this.disabled = false; this.listeners = {}; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  showModal() { this.open = true; } close() { this.open = false; }
}
const fields = new Map(['animWorldBtn', 'animWorldCreate', 'animWorldReroll', 'animWorldExplore', 'animWorldClose', 'animWorldMap', 'animWorldDensity', 'animWorldSeed', 'animWorldDialog', 'animWorldStatus', 'animStatus'].map(id => [id, new Field()]));
let prepare = async () => {}, focused = null, fits = 0;
const adapter = { assets, getAsset: id => assetMap.get(String(id)), getPiece: id => pieceMap.get(String(id)), prepareScene: scene => prepare(scene) };
const sandbox = { console, document: { getElementById: id => fields.get(id) }, MINISH_STUDIO: adapter,
  MINISH_ASSETS: catalog, MINISH_PIECES: pieces, MINISH_CURATED: curated, MINISH_BOSSES: bosses, MINISH_SPRITES: sprites, MINISH_WORLD_MAPS: worlds,
  MINISH_ANIMATION_UI: { setMode() {}, render() {}, fitCanvas() { fits++; }, focusArea: area => { focused = area; } },
  setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  localStorage: { getItem: () => null, setItem() {} } };
sandbox.window = sandbox;
const context = vm.createContext(sandbox);
for (const file of ['animation-engine.js', 'simple-animation.js', 'world-scenes.js', 'world-animation.js', 'world-animation-ui.js']) vm.runInContext(read(file), context, { filename: file });
const engine = sandbox.MINISH_ANIMATION, ui = sandbox.MINISH_WORLD_ANIMATION_UI;
engine.init(adapter); sandbox.MINISH_SIMPLE_ANIMATION.init(engine, adapter);
engine.renameProject('Private local test');
const handmade = JSON.stringify(engine.currentClip), initialCount = engine.project.clips.length;
fields.get('animWorldMap').value = 'world-terrain'; fields.get('animWorldDensity').value = 'quiet'; fields.get('animWorldSeed').value = 'repeat-this-world';
const first = await ui.create();
assert(first && first.width === 4992 && first.height === 3168);
assert.equal(engine.project.clips.length, initialCount + 1);
assert(engine.project.clips.some(clip => JSON.stringify(clip) === handmade), 'Creating an animated world preserves existing clips');
assert.equal(engine.project.name, 'Private local test');
assert(engine.playing && fits > 0, 'The generated world is ready to watch');
ui.explore(); assert(focused && focused.w > 0 && focused.h > 0, 'Explore uses portable encounter bounds');
assert.equal(fields.get('animWorldExplore').hidden, false);
const repeated = await ui.create();
assert(repeated && repeated.id !== first.id, 'Repeating a seed adds a distinct clip ID');
engine.loadProject(engine.project);
const beforeReroll = JSON.stringify(engine.currentClip), beforeCount = engine.project.clips.length;
fields.get('animWorldMap').value = 'world-illustrated'; fields.get('animWorldDensity').value = 'lively';
const rerolled = await ui.create(true);
assert.equal(rerolled.id, repeated.id); assert.equal(engine.project.clips.length, beforeCount);
assert.equal(rerolled.generated.requestedOptions.scope, 'world-terrain');
assert.equal(rerolled.generated.requestedOptions.density, 'quiet');
assert.notEqual(rerolled.generated.seed, repeated.generated.seed);
engine.undo(); assert.equal(JSON.stringify(engine.currentClip), beforeReroll, 'One Undo restores the whole previous animated world');
const beforeFailure = JSON.stringify(engine.project);
prepare = async () => { throw new Error('Image unavailable for test'); };
assert.equal(await ui.create(), null);
assert.equal(JSON.stringify(engine.project), beforeFailure, 'An image preparation failure cannot replace or append a clip');
prepare = async () => {};
engine.pause();
console.log('PASS: animated-world creation, existing-clip privacy, unique repeat-seed clips, playback, discoveries, safe reroll, complete Undo, and preflight failure isolation.');
