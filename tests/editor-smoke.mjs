// Offline engine regressions. Canvas calls are recorded rather than visually rasterized.
// Run: node tests/editor-smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scriptSources = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1].split('?')[0]);
for (const source of ['assets/legacy-bosses.js', 'assets/curated.js', 'assets/full-bosses.js', 'assets/logo.js', 'assets/world-maps.js', 'combat-library.js']) {
  assert(scriptSources.includes(source) && scriptSources.indexOf(source) < scriptSources.indexOf('studio.js'), 'Runtime data must load before the editor: ' + source);
}
assert(scriptSources.indexOf('controls.js') >= 0 && scriptSources.indexOf('controls.js') < scriptSources.indexOf('studio.js'), 'Platform controls load before the editor');
assert(scriptSources.indexOf('random-scenes.js') > scriptSources.indexOf('studio.js'), 'Scene generation loads after the editor API');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog.json'), 'utf8'));
const pieces = JSON.parse(fs.readFileSync(path.join(root, 'assets/pieces.json'), 'utf8'));
const dimensions = new Map();
for (const asset of [...catalog.assets, ...pieces.assets]) {
  // Use metadata and local paths. The harness never opens or changes source artwork.
  dimensions.set(asset.path, [asset.width, asset.height]); delete asset.dataUrl;
}
const drawCalls = [], rotationCalls = [], clearCalls = [], strokeCalls = [], imageRequests = [], fillCalls = [], textCalls = [], pixelWrites = [], blobCanvases = [], downloads = [], elements = new Map(), blobUrls = new Map();
const eventHandlers = new Map(), storage = new Map(), timers = new Map();
let timerId = 0, document;
class ClassList {
  constructor(owner) { this.owner = owner; }
  values() { return new Set(this.owner.className.split(/\s+/).filter(Boolean)); }
  contains(name) { return this.values().has(name); }
  add(...names) { const s = this.values(); names.forEach(n => s.add(n)); this.owner.className = [...s].join(' '); }
  remove(...names) { const s = this.values(); names.forEach(n => s.delete(n)); this.owner.className = [...s].join(' '); }
  toggle(name, force) { const next = force ?? !this.contains(name); next ? this.add(name) : this.remove(name); return next; }
}
function context2d(canvas) {
  return new Proxy({
    canvas, measureText: text => ({ width: [...String(text)].length * 6 }),
    drawImage(...args) { drawCalls.push({ canvas, args }); },
    rotate(angle) { rotationCalls.push({ canvas, angle }); },
    clearRect(...args) { clearCalls.push({ canvas, args }); },
    strokeRect(...args) { strokeCalls.push({ canvas, args }); },
    fillRect(...args) { fillCalls.push({ canvas, args }); },
    fillText(...args) { textCalls.push(args); },
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) data.set(i === 0 ? [255, 255, 255, 255] : [1, 2, 3, i === 8 ? 64 : 255], i);
      return { data, width, height };
    },
    putImageData(data) { pixelWrites.push(new Uint8ClampedArray(data.data)); }
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
}
class Element {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase(); this.id = id; this.children = []; this.dataset = {}; this.className = ''; this.classList = new ClassList(this);
    this.style = {}; this.listeners = {}; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false;
    this.width = 52; this.height = 52; this.clientWidth = 760; this.clientHeight = 700; this.textContent = '';
  }
  getContext() { return this.ctx ||= context2d(this); }
  append(...items) { for (const item of items) { if (item.tagName === 'FRAGMENT') this.append(...item.children); else { this.children.push(item); item.parent = this; } } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  querySelector(selector) { return this.children.find(c => c.tagName === selector.toUpperCase()) || this.children.flatMap(c => c.children).find(c => c.tagName === selector.toUpperCase()) || null; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async fire(name, extra = {}) {
    const event = { target: this, button: 0, pointerId: 1, clientX: 16, clientY: 16, preventDefault() {}, ...extra };
    for (const fn of this.listeners[name] || []) await fn(event);
  }
  closest(selector) { const match = selector.match(/^\[data-(.+)\]$/); return match && this.dataset[match[1]] != null ? this : this.parent?.closest(selector); }
  setAttribute(name, value) { this[name] = value; }
  getBoundingClientRect() { return this._rect ? this._rect() : { left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height }; }
  setPointerCapture() {} scrollTo() {} select() {}
  focus() { document.activeElement = this; }
  click() { if (this.tagName === 'A') downloads.push({ filename: this.download, href: this.href }); return this.fire('click'); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  showModal() { this.open = true; } close() { this.open = false; }
  toBlob(callback, type) {
    blobCanvases.push(this);
    const payload = new Uint8Array(16); payload.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(payload.buffer).setUint32(8, this.width); new DataView(payload.buffer).setUint32(12, this.height);
    callback(new Blob([payload], { type }));
  }
}
const datasetNodes = [];
for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
  const el = new Element(match[1], match[3]), attrs = match[2];
  el.value = attrs.match(/\bvalue="([^"]*)"/)?.[1] || ''; el.className = attrs.match(/\bclass="([^"]*)"/)?.[1] || '';
  el.checked = /\bchecked\b/.test(attrs); el.hidden = /\bhidden\b/.test(attrs);
  elements.set(el.id, el);
}
for (const match of html.matchAll(/<button\b([^>]*\bdata-(tool|layer|size)="([^"]+)"[^>]*)>/gi)) {
  const el = new Element('button'); el.dataset[match[2]] = match[3]; datasetNodes.push(el);
}
elements.get('snapSize').value = '16'; elements.get('objectScale').value = '1';
const libraryNode = new Element('aside'); libraryNode.className = 'library';
document = {
  body: new Element('body'), activeElement: null, fonts: { ready: Promise.resolve() },
  getElementById(id) {
    const optional = ['customSizeFields', 'customWidth', 'customHeight', 'customExportScale', 'applyCustomSize', 'sceneObjects', 'sendBackBtn', 'bringFrontBtn', 'deleteSceneBtn', 'sceneSelectionTools', 'sceneCopyBtn', 'scenePasteBtn', 'sceneDuplicateBtn', 'sceneDeleteBtn'];
    assert(elements.has(id) || optional.includes(id), 'Engine references missing DOM id: ' + id); return elements.get(id) || null;
  },
  createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
  querySelector: selector => selector === '.library' ? libraryNode : selector === 'dialog[open]' ? [...elements.values()].find(e => e.tagName === 'DIALOG' && e.open) || null : null,
  querySelectorAll(selector) { const key = selector.match(/^\[data-(.+)\]$/)?.[1]; return key ? datasetNodes.filter(n => n.dataset[key] != null) : []; },
  addEventListener(name, fn) { (eventHandlers.get(name) || (eventHandlers.set(name, []), eventHandlers.get(name))).push(fn); },
  dispatchEvent(event) { for (const fn of eventHandlers.get(event.type) || []) fn(event); }
};
let deferImageLoads = false;
const pendingImageLoads = [];
class Image {
  set src(value) { this._src = value; imageRequests.push(value); [this.width, this.height] = dimensions.get(value) || [224, 48]; const ready = () => this.onload?.(); deferImageLoads ? pendingImageLoads.push(ready) : queueMicrotask(ready); }
  get src() { return this._src; }
}
const sandbox = {
  document, Image, Blob, TextEncoder, Uint8Array, Uint8ClampedArray, Uint32Array, DataView, Map, Set,
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
  requestAnimationFrame: fn => queueMicrotask(fn),
  setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
  URL: { createObjectURL: blob => { const url = 'blob:test-' + blobUrls.size; blobUrls.set(url, blob); return url; }, revokeObjectURL() {} },
  addEventListener() {}, MINISH_ASSETS: catalog, MINISH_PIECES: pieces
};
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
for (const file of ['assets/sprites.js', 'assets/legacy-bosses.js', 'assets/curated.js', 'assets/full-bosses.js', 'assets/world-maps.js', 'combat-library.js']) if (fs.existsSync(path.join(root, file))) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
for (const supplement of [sandbox.MINISH_SPRITES, sandbox.MINISH_LEGACY_BOSSES, sandbox.MINISH_CURATED, sandbox.MINISH_BOSSES, sandbox.MINISH_WORLD_MAPS, sandbox.MINISH_COMBAT_LIBRARY]) for (const asset of supplement?.assets || []) {
  dimensions.set(asset.path, [asset.width, asset.height]); delete asset.dataUrl;
}
const uiPath = path.join(root, 'assets/game-ui.js');
if (fs.existsSync(uiPath)) vm.runInContext(fs.readFileSync(uiPath, 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'controls.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'studio.js'), 'utf8'), ctx);
const studio = sandbox.MINISH_STUDIO;
const flush = () => new Promise(resolve => setImmediate(resolve));
await flush();
const base = studio.project;
assert.equal(studio.version, '1.1');
assert.equal(studio.sourceAssets.length, 134);
assert.equal(studio.assets.length, 134 + pieces.assets.length + (sandbox.MINISH_SPRITES?.assets?.length || 0) + (sandbox.MINISH_LEGACY_BOSSES?.assets?.length || 0) + (sandbox.MINISH_CURATED?.assets?.length || 0) + (sandbox.MINISH_WORLD_MAPS?.assets?.length || 0) + (sandbox.MINISH_BOSSES?.assets?.length || 0) + (sandbox.MINISH_COMBAT_LIBRARY?.assets?.length || 0));
assert.equal(elements.get('assetList').children.length, 134, 'Cleaned sheets must not double source browser entries');
const assetIndex = new Map(studio.assets.map(a => [String(a.id), a]));
for (const sheet of Object.values({ ...pieces.sheets, ...(sandbox.MINISH_CURATED?.sheets || {}), ...(sandbox.MINISH_BOSSES?.sheets || {}) })) for (const piece of sheet.pieces) {
  const asset = assetIndex.get(String(piece.assetId));
  assert(asset, 'Every indexed piece has a source asset: ' + piece.id);
  assert(piece.sx >= 0 && piece.sy >= 0 && piece.sw > 0 && piece.sh > 0 && piece.sx + piece.sw <= asset.width && piece.sy + piece.sh <= asset.height, 'Every pose fits its sheet: ' + piece.id);
}
// Free canvases accept arbitrary ratios without changing pixel positions. Invalid sizes
// must never enter undo history or trigger a large canvas allocation.
for (const invalid of [
  { width: '', height: 270, exportScale: 5 }, { width: 200.5, height: 270, exportScale: 5 },
  { width: 0, height: 270, exportScale: 5 }, { width: 8193, height: 270, exportScale: 1 },
  { width: 216, height: 270, exportScale: 1.5 }, { width: 216, height: 270, exportScale: 9 },
  { width: 2048, height: 2048, exportScale: 8 }, { width: NaN, height: 270, exportScale: 1 },
  { width: 8192, height: 8192, exportScale: 1 }, { width: 8192, height: 2049, exportScale: 1 },
  { width: 4992, height: 3168, exportScale: 2 }
]) {
  const unchanged = JSON.stringify(studio.project); assert.throws(() => studio.setCanvasFormat(invalid));
  assert.equal(JSON.stringify(studio.project), unchanged, 'Invalid canvas settings leave the project untouched');
}
studio.setCanvasFormat({ width: 4992, height: 3168, exportScale: 1 });
assert.equal(studio.getScene().width, 4992); assert.equal(studio.getScene().height, 3168);
const worldShapeProject = studio.project; studio.loadProject(worldShapeProject);
assert.deepEqual(studio.project, worldShapeProject, 'A world-sized rectangular canvas retains its native dimensions after save/load');
// This harness records canvas dimensions without allocating a real giant raster.
const worldShapePNG = new DataView(await (await studio.exportSlide(studio.getScene())).arrayBuffer());
assert.equal(worldShapePNG.getUint32(8), 4992); assert.equal(worldShapePNG.getUint32(12), 3168, 'World-sized PNG export retains exact native pixels at 1x');
studio.setCanvasFormat({ width: 8192, height: 2048, exportScale: 1 });
assert.equal(studio.getScene().width * studio.getScene().height, studio.canvasLimits.maxNativePixels, 'An elongated canvas can reach the edge and area limits together');
studio.setCanvasFormat({ width: 333, height: 111, exportScale: 7 });
assert.equal(studio.project.slides[0].preset, 'custom');
assert.equal(studio.project.slides[0].width, 333); assert.equal(studio.project.slides[0].height, 111);
const customProject = studio.project; studio.loadProject(customProject);
assert.deepEqual(studio.project, customProject, 'Free ratio dimensions and integer scale round trip');
studio.addSlide();
assert.equal(studio.project.slides[1].width, 333); assert.equal(studio.project.slides[1].height, 111); assert.equal(studio.project.slides[1].exportScale, 7, 'Fresh scenes inherit the custom format');
studio.loadProject(base);
const malformed = structuredClone(base); malformed.slides[0].width = 1e12; malformed.slides[0].height = 1e12; malformed.slides[0].exportScale = 1e12;
studio.loadProject(malformed);
let safeSlide = studio.project.slides[0];
assert(safeSlide.width <= studio.canvasLimits.maxNative && safeSlide.height <= studio.canvasLimits.maxNative);
assert(safeSlide.width * safeSlide.height <= studio.canvasLimits.maxNativePixels, 'Oversized imports are constrained by the native area budget as well as edge length');
assert.equal(safeSlide.width, safeSlide.height, 'Proportional area reduction preserves the aspect ratio after edge clamping');
assert(safeSlide.width * safeSlide.height * safeSlide.exportScale ** 2 <= studio.canvasLimits.maxExportPixels, 'Imported canvas cannot exceed the export memory budget');
await assert.rejects(studio.exportSlide(malformed.slides[0]), /Canvas width/);
studio.loadProject(base);
studio.setCanvasFormat({ width: 16, height: 16, exportScale: 1 }); studio.addDialogue();
const tinyDialogue = studio.selectedObject;
assert(tinyDialogue.w >= 20 && tinyDialogue.h > 0 && Number.isFinite(tinyDialogue.x) && Number.isFinite(tinyDialogue.y), 'A minimum-size canvas creates a valid positive dialogue box');
assert.equal(tinyDialogue.x, 0, 'A dialogue wider than the canvas starts at its left edge');
studio.render();
const tinyPNG = await studio.exportSlide(studio.project.slides[0]), tinyData = new DataView(await tinyPNG.arrayBuffer());
assert.equal(tinyData.getUint32(8), 16); assert.equal(tinyData.getUint32(12), 16, 'Small canvas dialogue renders and exports without changing its format');
studio.loadProject(base);
const actorSheet = Object.values(pieces.sheets).find(s => s.category === 'characters' && s.pieces.length > 2);
const first = actorSheet.pieces[0], alternate = actorSheet.pieces.find(p => p.sw !== first.sw || p.sh !== first.sh) || actorSheet.pieces[1];
let picked;
document.addEventListener('minish:piece-selected', e => { picked = e.detail; });
await studio.choosePiece(first);
assert.equal(studio.brush.sourceId, first.sourceId); assert.equal(studio.brush.pieceId, first.id); assert.equal(picked.id, first.id);
assert.equal(elements.get('keyEnabled').checked, false, 'Cleaned pose brush preserves alpha');
let object = await studio.placePiece(first);
assert.equal(object.layer, 'objects'); assert.equal(object.pieceId, first.id); assert.equal(studio.selection, object.id);
elements.get('objectScale').value = '2'; await elements.get('objectScale').fire('change');
await elements.get('flipXBtn').fire('click');
await datasetNodes.find(n => n.dataset.layer === 'overlay').fire('click');
object = studio.selectedObject;
const anchor = { x: object.x + object.sw * object.scale / 2, feet: object.y + object.sh * object.scale };
await studio.choosePiece(alternate);
assert.equal(studio.selection, object.id, 'Picking a pose should keep the selected actor for pose changes');
assert(studio.canSwapSelected(alternate));
object = await studio.replaceSelectedPose(alternate);
assert.equal(object.x + object.sw * object.scale / 2, anchor.x); assert.equal(object.y + object.sh * object.scale, anchor.feet);
assert.equal(object.pieceId, alternate.id);
assert.equal(object.scale, 2); assert.equal(object.flipX, true); assert.equal(object.layer, 'overlay');
studio.undo(); assert.equal(studio.project.slides[0].objects[0].pieceId, first.id);
studio.redo(); assert.equal(studio.project.slides[0].objects[0].pieceId, alternate.id);
const saved = studio.project; studio.loadProject(saved);
assert.deepEqual(studio.project, saved, 'New pose metadata round trips without dropping old data');
studio.select(object.id);
const positionsBeforeResize = JSON.stringify(studio.project.slides[0].objects);
studio.setCanvasFormat({ width: 321, height: 123, exportScale: 3 });
assert.equal(JSON.stringify(studio.project.slides[0].objects), positionsBeforeResize, 'Changing ratio does not move or scale placed art');
assert.equal(studio.selection, object.id, 'Canvas resize keeps the current selection');
if (elements.has('applyCustomSize')) {
  elements.get('aspectPreset').value = 'custom'; await elements.get('aspectPreset').fire('change'); assert.equal(elements.get('customSizeFields').hidden, false);
  elements.get('customWidth').value = '311'; elements.get('customHeight').value = '177'; elements.get('customExportScale').value = '2';
  await elements.get('applyCustomSize').fire('click'); assert.equal(studio.project.slides[0].width, 311); assert.equal(studio.project.slides[0].height, 177);
  assert.equal(JSON.stringify(studio.project.slides[0].objects), positionsBeforeResize);
  const validScene = JSON.stringify(studio.project); elements.get('customWidth').value = '1'; await elements.get('applyCustomSize').fire('click');
  assert.equal(JSON.stringify(studio.project), validScene); assert.match(elements.get('toast').textContent, /between 16 and 8192/);
  studio.setCanvasFormat({ width: 321, height: 123, exportScale: 3 });
}
const freePNG = await studio.exportSlide(studio.project.slides[0]), freeData = new DataView(await freePNG.arrayBuffer());
assert.equal(freeData.getUint32(8), 963); assert.equal(freeData.getUint32(12), 369);
studio.loadProject(saved); studio.select(object.id);
studio.updateSelected({ x: -45, y: 61, scale: 3, flipY: true });
assert.equal(studio.selectedObject.x, -45); assert.equal(studio.selectedObject.y, 61); assert.equal(studio.selectedObject.scale, 3); assert.equal(studio.selectedObject.flipY, true);
elements.get('objectX').value = ''; await elements.get('objectX').fire('input'); await elements.get('objectX').fire('change'); assert.equal(studio.selectedObject.x, -45, 'Empty position input does not jump a piece to zero');
assert.throws(() => studio.updateSelected({ x: Infinity }), /number/);
const duplicate = studio.duplicateSelected(); assert.notEqual(duplicate.id, object.id); assert.equal(duplicate.pieceId, alternate.id); assert.equal(duplicate.flipY, true);
if (elements.has('sceneObjects')) {
  elements.get('sceneObjects').value = object.id; await elements.get('sceneObjects').fire('change'); assert.equal(studio.selection, object.id, 'The accessible piece list selects a covered object');
  const openDialog = elements.get('creditsDialog') || elements.get('helpDialog'); openDialog.showModal();
  document.dispatchEvent({ type: 'keydown', key: 'Delete', target: document.body, preventDefault() {} });
  assert(studio.project.slides[0].objects.some(o => o.id === object.id), 'Dialog interaction does not delete the selected scene piece'); openDialog.close();
}
studio.select(object.id); assert(studio.bringToFront());
assert.equal(studio.project.slides[0].objects.filter(o => o.layer === 'overlay').at(-1).id, object.id);
assert(studio.sendToBack()); assert.equal(studio.project.slides[0].objects.filter(o => o.layer === 'overlay')[0].id, object.id);
studio.select(duplicate.id); assert(studio.deleteSelected()); assert(!studio.project.slides[0].objects.some(o => o.id === duplicate.id));
studio.undo(); assert(studio.project.slides[0].objects.some(o => o.id === duplicate.id), 'Deleting any placed object remains undoable');
studio.loadProject(saved); studio.select(object.id);
const wrongSheet = Object.values(pieces.sheets).find(s => s.category === 'characters' && s.sourceId !== actorSheet.sourceId);
assert(!studio.canSwapSelected(wrongSheet.pieces[0]));
await assert.rejects(studio.replaceSelectedPose(wrongSheet.pieces[0]), /same character/);
const custom = studio.saveCustomPiece('My favorite pose');
assert.equal(custom.name, 'My favorite pose'); assert.equal(studio.customPieces.length, 1);
assert(!storage.get('minish-cap-studio-custom-pieces-v1').includes('data:image'), 'Custom shelf stores references, not embedded artwork');
studio.removeCustomPiece(custom.id); assert.equal(studio.customPieces.length, 0);
await studio.chooseAsset(catalog.assets[0].id);
elements.get('keyEnabled').checked = true; elements.get('keyColor').value = '#ffffff';
await elements.get('keyEnabled').fire('change');
assert(pixelWrites.length > 0); const written = pixelWrites.at(-1);
assert.equal(written[3], 0, 'Exact key-color pixels become transparent'); assert.equal(written[7], 255, 'Other source pixels remain opaque'); assert.equal(written[11], 64, 'Partial source alpha is preserved');
const brushPiece = studio.getBrushPiece(), piecePNG = await studio.exportPiecePNG(brushPiece, { scale: 2, flipX: true });
const pieceData = new DataView(await piecePNG.arrayBuffer()), pieceCanvas = blobCanvases.at(-1);
assert.equal(piecePNG.type, 'image/png'); assert.equal(pieceData.getUint32(8), brushPiece.sw * 2); assert.equal(pieceData.getUint32(12), brushPiece.sh * 2);
assert(!fillCalls.some(call => call.canvas === pieceCanvas), 'Piece PNG export never paints an opaque canvas background');
assert(drawCalls.some(call => call.canvas === pieceCanvas && call.args[0]?.tagName === 'CANVAS'), 'Keyed PNG draws the alpha-cleaned crop');
await assert.rejects(studio.exportPiecePNG(brushPiece, { scale: 0 }), /scale/);
await assert.rejects(studio.exportPiecePNG(brushPiece, { scale: 1.2 }), /scale/);
await studio.downloadSelectedPiecePNG(); assert(downloads.at(-1).filename.endsWith('.png'));
const beforePaint = studio.project.slides[0].objects.length;
await elements.get('sceneCanvas').fire('pointerdown', { clientX: 32, clientY: 32 });
await elements.get('sceneCanvas').fire('pointerup');
assert.equal(studio.project.slides[0].objects.length, beforePaint + 1);
assert.equal(studio.project.slides[0].objects.at(-1).keyColor, '#ffffff');
studio.undo(); assert.equal(studio.project.slides[0].objects.length, beforePaint);
studio.addDialogue(); await flush();
assert.equal(studio.selectedObject.kind, 'dialogue'); assert.equal(studio.selectedObject.fontSize, 12);
elements.get('dialogueText').value = 'Hello, 한글!'; await elements.get('dialogueText').fire('input');
const slide = studio.project.slides[0], png = await studio.exportSlide(slide);
assert.equal(png.type, 'image/png');
const pngData = new DataView(await png.arrayBuffer());
assert.equal(pngData.getUint32(8), slide.width * slide.exportScale); assert.equal(pngData.getUint32(12), slide.height * slide.exportScale);
if (sandbox.MINISH_GAME_UI) {
  assert(drawCalls.some(c => c.args[0]?.src === sandbox.MINISH_GAME_UI.dialogue.dataUrl), 'Exports use the authentic dialogue frame');
  assert(drawCalls.some(c => c.args[0]?.src === sandbox.MINISH_GAME_UI.font.dataUrl), 'Bitmap font must load before export text is drawn');
  assert(textCalls.some(args => args[0] === '한') && textCalls.some(args => args[0] === '글'), 'Unsupported Unicode uses a native-font fallback');
}
const zip = studio.makeZip([{ name: 'scene.png', data: new Uint8Array(await png.arrayBuffer()) }, { name: 'project.minish.json', data: new TextEncoder().encode(JSON.stringify(studio.project)) }]);
const zipBytes = new Uint8Array(await zip.arrayBuffer());
assert.equal(new DataView(zipBytes.buffer).getUint32(0, true), 0x04034b50);
const endView = new DataView(zipBytes.buffer, zipBytes.length - 22);
assert.equal(endView.getUint32(0, true), 0x06054b50); assert.equal(endView.getUint16(10, true), 2);
studio.addSlide(true); assert.equal(studio.project.slides.length, 2);
assert.notEqual(studio.project.slides[0].objects[0].id, studio.project.slides[1].objects[0].id);
studio.saveProject(); assert(downloads.at(-1).filename.endsWith('.minish.json'));
for (const { fn, ms } of timers.values()) if (ms === 500) fn();
assert(storage.has('minish-cap-studio-v1'), 'Keep the existing autosave storage key');
// A drop follows the cursor center at native-pixel precision, including all four
// frame edges. Off-frame editing must never enlarge an exported image.
studio.loadProject(base); studio.setCanvasFormat({ width: 240, height: 160, exportScale: 4 });
const precisePiece = actorSheet.pieces[0], emptyPlacementProject = studio.project;
elements.get('snapEnabled').checked = false;
for (const point of [{ x: 100, y: 60 }, { x: -20, y: 30 }, { x: 270, y: 30 }, { x: 50, y: -20 }, { x: 50, y: 200 }]) {
  const placed = await studio.placePieceAt(precisePiece, point, { scale: 2, precise: true });
  assert.equal(placed.x, Math.round(point.x - precisePiece.sw)); assert.equal(placed.y, Math.round(point.y - precisePiece.sh));
  assert.equal(placed.scale, 2); assert.equal(placed.layer, 'objects');
  studio.undo(); assert.deepEqual(studio.project, emptyPlacementProject, 'A centered drop is exactly one Undo action');
}
assert.throws(() => studio.piecePosition(precisePiece, { x: NaN, y: 2 }), /position/);
const moving = await studio.placePieceAt(precisePiece, { x: 30, y: 30 }, { scale: 1, precise: true });
studio.updateSelected({ x: 5, y: 7 }); elements.get('snapEnabled').checked = true; elements.get('snapSize').value = '16'; studio.render();
const movementZoom = studio.view.zoom;
await elements.get('sceneCanvas').fire('pointerdown', { clientX: 8 * movementZoom, clientY: 10 * movementZoom });
await elements.get('sceneCanvas').fire('pointermove', { clientX: 24 * movementZoom, clientY: 26 * movementZoom });
await elements.get('sceneCanvas').fire('pointerup');
assert.equal(studio.selectedObject.x, 21); assert.equal(studio.selectedObject.y, 23, 'Grid movement retains the original off-grid alignment');
studio.undo(); studio.select(moving.id);
await elements.get('sceneCanvas').fire('pointerdown', { clientX: 8 * movementZoom, clientY: 10 * movementZoom });
await elements.get('sceneCanvas').fire('pointermove', { clientX: 11 * movementZoom, clientY: 15 * movementZoom, altKey: true });
await elements.get('sceneCanvas').fire('pointercancel');
assert.equal(studio.selectedObject.x, 8); assert.equal(studio.selectedObject.y, 12, 'Alt bypasses grid snapping during a drag');
studio.undo(); studio.select(moving.id);
await elements.get('nudgeRight').fire('click'); assert.equal(studio.selectedObject.x, 6);
await elements.get('nudgeDown').fire('click', { shiftKey: true }); assert.equal(studio.selectedObject.y, 23);
const sceneBeforeOutsideDrop = studio.project;
studio.beginPieceDrag(precisePiece);
await elements.get('stageViewport').fire('dragover', { clientX: -20 * movementZoom, clientY: 40 * movementZoom, altKey: true });
await elements.get('stageViewport').fire('drop', { clientX: -20 * movementZoom, clientY: 40 * movementZoom, altKey: true });
assert(studio.selectedObject.x + studio.selectedObject.sw <= 0, 'A viewport drop may be completely outside the frame');
studio.render();
assert.equal(elements.get('sceneCanvas').width, 240); assert.equal(elements.get('sceneCanvas').height, 160);
assert(elements.get('placementCanvas').width > 240, 'The off-frame preview is a separate editor canvas');
const outsidePNG = await studio.exportSlide(studio.project.slides[0]), outsideData = new DataView(await outsidePNG.arrayBuffer());
assert.equal(outsideData.getUint32(8), 960); assert.equal(outsideData.getUint32(12), 640, 'Off-frame pieces retain the selected export frame');
studio.undo(); assert.deepEqual(studio.project, sceneBeforeOutsideDrop);
await studio.choosePiece(precisePiece); studio.setTool('paint');
const countBeforeOutsidePaint = studio.project.slides[0].objects.length;
await elements.get('stageViewport').fire('pointerdown', { clientX: -32 * movementZoom, clientY: 32 * movementZoom });
await elements.get('stageViewport').fire('pointerup');
assert.equal(studio.project.slides[0].objects.length, countBeforeOutsidePaint + 1, 'The pasteboard also accepts off-frame painting');
studio.undo();
const delayedBossPiece = Object.values(sandbox.MINISH_BOSSES.sheets)[0].pieces[0];
deferImageLoads = true;
const staleDrop = studio.placePieceAt(delayedBossPiece, { x: 80, y: 60 });
await flush(); assert(pendingImageLoads.length > 0);
studio.addSlide(); const afterSwitch = studio.project;
deferImageLoads = false; pendingImageLoads.splice(0).forEach(ready => ready());
await assert.rejects(staleDrop, /scene changed/); assert.deepEqual(studio.project, afterSwitch, 'A stale asynchronous drop never inserts into another scene');
// Both keyboard families drive the real editor without stealing native text
// editing, library widget keys, composition, or Mac secondary-click gestures.
studio.loadProject(emptyPlacementProject);
const keyboardPiece = await studio.placePieceAt(precisePiece, { x: 70, y: 60 }, { precise: true });
const keyEvent = (key, extra = {}) => document.dispatchEvent({ type: 'keydown', key, target: document.body, preventDefault() {}, ...extra });
studio.updateSelected({ x: 5, y: 7 });
keyEvent('z', { ctrlKey: true }); assert.equal(studio.project.slides[0].objects[0].x, keyboardPiece.x, 'Windows Undo changes the editor');
keyEvent('z', { metaKey: true, shiftKey: true }); assert.equal(studio.project.slides[0].objects[0].x, 5, 'Mac Redo restores the edit');
studio.select(keyboardPiece.id);
const beforeBlockedKeys = studio.project;
for (const extra of [{ defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) keyEvent('ArrowRight', extra);
keyEvent('Delete', { ctrlKey: true }); keyEvent('Backspace', { metaKey: true }); keyEvent('t', { altKey: true }); keyEvent('t', { isComposing: true });
keyEvent('Delete', { target: elements.get('objectX') }); keyEvent('z', { ctrlKey: true, target: elements.get('dialogueText') });
assert.deepEqual(studio.project, beforeBlockedKeys, 'Native, handled, modified and composing keys do not mutate scenes');
keyEvent('ArrowRight'); assert.equal(studio.selectedObject.x, 6);
keyEvent('ArrowDown', { shiftKey: true }); assert.equal(studio.selectedObject.y, 23);
keyEvent('d', { ctrlKey: true }); assert.equal(studio.project.slides[0].objects.length, 2);
keyEvent('z', { metaKey: true }); assert.equal(studio.project.slides[0].objects.length, 1);
studio.select(keyboardPiece.id); keyEvent('Backspace'); assert.equal(studio.project.slides[0].objects.length, 0, 'Mac Delete / Backspace removes a selected piece');
keyEvent('y', { ctrlKey: true }); keyEvent('z', { metaKey: true });
const beforeKeyboardSave = downloads.length;
keyEvent('s', { ctrlKey: true }); keyEvent('s', { metaKey: true });
assert.equal(downloads.length, beforeKeyboardSave + 2, 'Windows and Mac Save download editable projects');
let repeatedSaveBlocked = false;
keyEvent('s', { ctrlKey: true, repeat: true, preventDefault() { repeatedSaveBlocked = true; } });
assert(repeatedSaveBlocked); assert.equal(downloads.length, beforeKeyboardSave + 2, 'Holding Save does not repeat downloads or invoke the browser Save dialog');
await studio.choosePiece(precisePiece); studio.setTool('paint');
const beforeSecondaryClick = studio.project;
for (const extra of [{ ctrlKey: true }, { metaKey: true }, { button: 2 }]) {
  await elements.get('sceneCanvas').fire('pointerdown', extra); await elements.get('sceneCanvas').fire('pointerup');
  await elements.get('sheetCanvas').fire('pointerdown', extra);
}
assert.deepEqual(studio.project, beforeSecondaryClick, 'Mac Control-click and secondary clicks never paint');
// A focused piece list is an editing selection, rather than a text field. Copy,
// paste and Backspace therefore work there while its arrows still navigate.
{
studio.loadProject(emptyPlacementProject);
const clipboardPiece = await studio.placePieceAt(precisePiece, { x: 64, y: 52 }, { precise: true });
const beforeCopy = studio.project, pieceListTarget = elements.get('sceneObjects');
keyEvent('c', { metaKey: true, target: pieceListTarget });
assert.deepEqual(studio.project, beforeCopy, 'Copy does not alter the project or Undo history');
studio.addSlide(); const beforePaste = studio.project;
keyEvent('v', { ctrlKey: true, target: pieceListTarget });
assert.equal(studio.getScene().objects.length, 1); assert.notEqual(studio.selectedObject.id, clipboardPiece.id);
assert.equal(studio.selectedObject.pieceId, clipboardPiece.pieceId); assert.equal(studio.selectedObject.x, clipboardPiece.x + 16);
studio.undo(); assert.deepEqual(studio.project, beforePaste, 'Pasting into another scene is one Undo action');
assert.equal(elements.get('sceneSelectionTools').hidden, false, 'A copied piece keeps Paste available on an empty canvas');
assert.equal(elements.get('scenePasteBtn').disabled, false); assert.equal(elements.get('sceneCopyBtn').disabled, true);
await elements.get('scenePasteBtn').fire('click'); assert.equal(studio.getScene().objects.length, 1, 'The visible Paste button adds the copied piece');
studio.undo(); assert.deepEqual(studio.project, beforePaste, 'Button paste is one Undo action');
studio.switchSlide(beforeCopy.activeSlide); studio.select(clipboardPiece.id);
keyEvent('x', { ctrlKey: true, target: pieceListTarget }); assert.equal(studio.getScene().objects.length, 0, 'Cut removes the selected piece');
keyEvent('v', { metaKey: true }); assert.equal(studio.selectedObject.x, clipboardPiece.x, 'The first cut/paste retains exact placement');
const pastedId = studio.selection; keyEvent('Backspace', { target: pieceListTarget }); assert.equal(studio.getScene().objects.length, 0, 'Backspace deletes a piece selected in the list');
studio.undo(); assert.equal(studio.getScene().objects[0].id, pastedId);
// Whole-canvas deletion is available for one or many scenes and restores all
// pieces, dimensions and metadata with one Undo.
const beforeSceneDeletion = studio.project; keyEvent('Backspace', { metaKey: true, shiftKey: true });
assert.equal(studio.project.slides.length, 1); assert.notEqual(studio.project.activeSlide, beforeSceneDeletion.activeSlide);
studio.undo(); assert.deepEqual(studio.project, beforeSceneDeletion);
studio.loadProject(beforeCopy); const beforeLastSceneDeletion = studio.project;
await elements.get('deleteSlide').fire('click');
assert.equal(studio.project.slides.length, 1); assert.equal(studio.getScene().objects.length, 0);
assert.equal(studio.getScene().width, beforeLastSceneDeletion.slides[0].width);
assert.notEqual(studio.project.activeSlide, beforeLastSceneDeletion.activeSlide, 'Deleting the last canvas creates a fresh blank canvas');
studio.undo(); assert.deepEqual(studio.project, beforeLastSceneDeletion);
// Layer ordering shortcuts are atomic and never change another layer.
studio.select(clipboardPiece.id); const orderB = studio.duplicateSelected(), orderC = studio.duplicateSelected();
studio.select(clipboardPiece.id); keyEvent(']');
assert.equal(studio.getScene().objects.map(object => object.id).join(','), [orderB.id, clipboardPiece.id, orderC.id].join(','));
keyEvent('}', { shiftKey: true }); assert.equal(studio.getScene().objects.at(-1).id, clipboardPiece.id);
keyEvent('{', { shiftKey: true }); assert.equal(studio.getScene().objects[0].id, clipboardPiece.id);
// Model the viewport's scroll geometry so zoom checks the native point under
// the cursor, including transient pinch values and the final crisp enlargement.
const zoomViewport = elements.get('stageViewport'), zoomCanvas = elements.get('sceneCanvas'), zoomWrap = elements.get('canvasWrap');
zoomViewport.clientWidth = 700; zoomViewport.clientHeight = 330;
let scrollX = 0, scrollY = 0;
const extent = axis => Math.max(0, parseFloat(zoomCanvas.style[axis === 'x' ? 'width' : 'height'] || 0) + parseFloat(zoomWrap.style.padding || 0) * 2 - zoomViewport[axis === 'x' ? 'clientWidth' : 'clientHeight']);
Object.defineProperty(zoomViewport, 'scrollLeft', { configurable: true, get() { return scrollX = Math.max(0, Math.min(scrollX, extent('x'))); }, set(value) { scrollX = Math.max(0, Math.min(value, extent('x'))); } });
Object.defineProperty(zoomViewport, 'scrollTop', { configurable: true, get() { return scrollY = Math.max(0, Math.min(scrollY, extent('y'))); }, set(value) { scrollY = Math.max(0, Math.min(value, extent('y'))); } });
zoomViewport._rect = () => ({ left: 100, top: 80, width: zoomViewport.clientWidth, height: zoomViewport.clientHeight });
zoomCanvas._rect = () => ({ left: 100 + Math.max(0, (zoomViewport.clientWidth - parseFloat(zoomCanvas.style.width) - parseFloat(zoomWrap.style.padding || 0) * 2) / 2) + parseFloat(zoomWrap.style.padding || 0) - zoomViewport.scrollLeft,
  top: 80 + Math.max(0, (zoomViewport.clientHeight - parseFloat(zoomCanvas.style.height) - parseFloat(zoomWrap.style.padding || 0) * 2) / 2) + parseFloat(zoomWrap.style.padding || 0) - zoomViewport.scrollTop,
  width: parseFloat(zoomCanvas.style.width), height: parseFloat(zoomCanvas.style.height) });
const anchor = { x: 500, y: 180 }, nativePoint = () => { const rect = zoomCanvas.getBoundingClientRect(); return { x: (anchor.x - rect.left) / studio.view.zoom, y: (anchor.y - rect.top) / studio.view.zoom }; };
studio.fitCanvas(); await flush(); assert.equal(studio.view.zoom, 1);
const pointInFit = nativePoint(); studio.zoomAt(2, anchor); await flush();
assert.equal(zoomViewport.scrollLeft > 0, true, 'Manual zoom has scroll room even while the scene width fits the viewport');
assert(Math.abs(nativePoint().x - pointInFit.x) < 1e-8 && Math.abs(nativePoint().y - pointInFit.y) < 1e-8, 'Zoom from centered Fit preserves the pointer with browser-like scroll clamping');
const projectBeforeZoom = studio.project;
const zoomField = elements.get('stageZoomLabel');
const enterSceneZoom = async (value, ending = 'Enter') => {
  zoomField.focus(); zoomField.value = value; await zoomField.fire('input');
  await zoomField.fire(ending === 'blur' ? 'blur' : 'keydown', { key: ending }); await flush();
};
await enterSceneZoom('137%'); assert.equal(studio.view.zoom, 1.37); assert.equal(zoomField.value, '137%');
assert.equal(document.activeElement, zoomCanvas, 'Enter applies custom Scene zoom and returns canvas keyboard control');
keyEvent('+'); await flush(); assert.equal(studio.view.zoom, 1.47, 'Plus changes zoom by ten percentage points without discarding the custom part');
keyEvent('-'); await flush(); assert.equal(studio.view.zoom, 1.37);
await enterSceneZoom('62.5%', 'blur'); assert.equal(studio.view.zoom, .625, 'Leaving a percentage field applies decimal zoom');
await enterSceneZoom('900%', 'Escape'); assert.equal(studio.view.zoom, .625); assert.equal(zoomField.value, '63%', 'Escape restores the whole-percent label without changing precise zoom');
for (const invalid of ['', 'potato', 'Infinity', '10%%', '-20%']) { await enterSceneZoom(invalid, 'blur'); assert.equal(studio.view.zoom, .625, 'Malformed percentages do not change Scene view'); }
await enterSceneZoom('0%'); assert.equal(studio.view.zoom, .05);
await enterSceneZoom('9999%'); assert.equal(studio.view.zoom, 12, 'Typed percentages respect the shared 5%-1200% range');
await enterSceneZoom('100.005%'); assert(Math.abs(studio.view.zoom - 1.00005) < 1e-12, 'Manual percentages are not rounded to preset sizes or ignored by a coarse epsilon');
await enterSceneZoom('137,25%'); assert.equal(studio.view.zoom, 1.3725, 'Decimal commas are accepted');
zoomField.focus(); zoomField.value = '175%'; await zoomField.fire('input'); studio.render();
assert.equal(zoomField.value, '175%', 'Repainting does not overwrite a focused zoom draft');
await zoomField.fire('keydown', { key: 'Escape' });
studio.fitCanvas(); await flush(); keyEvent('v');
const fitZoomBeforePan = studio.view.zoom, fitPointBeforePan = nativePoint(), projectBeforeFitPan = studio.project;
let firstFitWheelPrevented = false;
await zoomViewport.fire('wheel', { deltaX: 24, deltaY: 30, clientX: anchor.x, clientY: anchor.y, preventDefault() { firstFitWheelPrevented = true; } });
assert(!firstFitWheelPrevented && !studio.view.fit, 'The first normal scroll opens native pan space from Fit without preventing default');
assert.equal(studio.view.zoom, fitZoomBeforePan, 'Leaving Fit to pan does not change magnification');
assert(Math.abs(nativePoint().x - fitPointBeforePan.x) < 1e-8 && Math.abs(nativePoint().y - fitPointBeforePan.y) < 1e-8, 'The Fit-to-pan layout preserves the view before native scrolling');
const nativeScrollStart = { x: zoomViewport.scrollLeft, y: zoomViewport.scrollTop };
// Browser default scrolling follows the synchronous wheel handler. Simulate
// that native action with the same scroll clamping as the rest of this harness.
zoomViewport.scrollLeft += 24; zoomViewport.scrollTop += 30; await zoomViewport.fire('scroll'); await flush();
assert.equal(zoomViewport.scrollLeft, nativeScrollStart.x + 24); assert.equal(zoomViewport.scrollTop, nativeScrollStart.y + 30, 'The first wheel event can immediately pan both axes from Fit');
assert.deepEqual(studio.project, projectBeforeFitPan, 'Opening pan space never changes artwork or project history');
studio.fitCanvas(); await flush();
const handButton = datasetNodes.find(button => button.dataset.tool === 'hand');
assert(handButton, 'Scene toolbar offers the explicit Hand zoom tool');
for (const extra of [{ target: new Element('input') }, { isComposing: true }, { keyCode: 229 }, { altKey: true }]) {
  keyEvent('h', extra); assert(!handButton.classList.contains('active'), 'Typing and composition do not select Hand zoom');
}
elements.get('helpDialog').open = true; keyEvent('h'); assert(!handButton.classList.contains('active')); elements.get('helpDialog').open = false;
const beforeHandPan = studio.project, handSelection = studio.selection;
keyEvent('h'); await flush(); assert(handButton.classList.contains('active')); assert.equal(zoomCanvas.style.cursor, 'grab');
await zoomCanvas.fire('pointerdown', { currentTarget: zoomCanvas, clientX: 400, clientY: 200 }); await flush();
const handScroll = { x: zoomViewport.scrollLeft, y: zoomViewport.scrollTop };
assert.equal(zoomCanvas.style.cursor, 'grabbing');
await zoomCanvas.fire('pointermove', { clientX: 350, clientY: 170 }); await flush();
assert(Math.abs(zoomViewport.scrollLeft - handScroll.x - 50) < 1e-8 && Math.abs(zoomViewport.scrollTop - handScroll.y - 30) < 1e-8, 'Hand zoom pans both viewport axes by the pointer drag');
await zoomCanvas.fire('pointercancel'); await flush(); assert.equal(zoomCanvas.style.cursor, 'grab', 'Cancelling a hand drag restores the grab cursor');
assert.deepEqual(studio.project, beforeHandPan, 'Hand zoom never paints, moves artwork, or changes project history'); assert.equal(studio.selection, handSelection, 'Panning preserves the selected object');
keyEvent('v'); await flush(); assert(!handButton.classList.contains('active')); assert.equal(zoomCanvas.style.cursor, 'default');
elements.get('sceneToolsMenu').open = true;
await elements.get('sceneMenuHand').fire('click'); await flush();
assert(handButton.classList.contains('active') && !elements.get('sceneToolsMenu').open, 'Scene Tools menu activates Hand and closes without a shortcut');
assert.equal(document.activeElement, elements.get('sceneToolsLabel'), 'Menu selection restores keyboard focus to its visible label');
await elements.get('sceneMenuSelect').fire('click'); await flush();
assert(!handButton.classList.contains('active'), 'Scene Tools menu returns to selecting pieces');
assert.deepEqual(studio.project, beforeHandPan, 'Changing tools through the menu never changes scene artwork');
keyEvent('0'); await flush();
const beforeWheel = nativePoint();
for (const delta of [{ deltaY: -40 }, { deltaY: 40 }, { deltaX: 40, deltaY: 0 }, { deltaX: -40, deltaY: 0 }]) {
  let blocked = false; await zoomViewport.fire('wheel', { ...delta, clientX: anchor.x, clientY: anchor.y, preventDefault() { blocked = true; } });
  assert(!blocked && studio.view.zoom === 1, 'Normal wheel and two-finger scrolling retain native panning in every direction');
}
let pinchBlocked = false; await zoomViewport.fire('wheel', { ctrlKey: true, deltaY: -40, clientX: anchor.x, clientY: anchor.y, preventDefault() { pinchBlocked = true; } }); await flush();
const freeWheelZoom = Math.exp(.2);
assert(pinchBlocked); assert(Math.abs(studio.view.zoom - freeWheelZoom) < 1e-12, 'Pinch or Ctrl+wheel gives continuous zoom');
assert(Math.abs(nativePoint().x - beforeWheel.x) < 1e-8 && Math.abs(nativePoint().y - beforeWheel.y) < 1e-8, 'Pinch zoom keeps the pointer anchor');
assert(![...timers.values()].some(task => task.ms === 140), 'No delayed timer can snap manual Scene zoom');
await flush(); assert.equal(studio.view.zoom, freeWheelZoom, 'The percentage remains unchanged after the wheel stops');
let readWheelMode = false;
zoomViewport.listeners.wheel[0]({ target: zoomCanvas, ctrlKey: true, clientX: anchor.x, clientY: anchor.y, preventDefault() {},
  get deltaMode() { readWheelMode = true; return 1; }, get deltaY() { assert(readWheelMode, 'Read deltaMode before browser-dependent delta units'); return -3; }, get deltaX() { assert(readWheelMode); return 0; } }); await flush();
assert(Math.abs(studio.view.zoom - freeWheelZoom * Math.exp(48 * .005)) < 1e-12, 'Line-mode wheel units normalize without quantizing their result');
const normalizedZoom = studio.view.zoom;
for (const extra of [{ shiftKey: true, deltaY: -40 }, { deltaX: 40, deltaY: 2 }, { ctrlKey: true, deltaY: 0 }, { ctrlKey: true, deltaY: Infinity }, { ctrlKey: true, deltaY: -40, cancelable: false }, { ctrlKey: true, deltaY: -40, defaultPrevented: true }, { ctrlKey: true, deltaY: -40, target: new Element('input') }]) {
  let blocked = false; const previous = studio.view.zoom;
  await zoomViewport.fire('wheel', { clientX: anchor.x, clientY: anchor.y, preventDefault() { blocked = true; }, ...extra });
  assert(!blocked && studio.view.zoom === previous, 'Panning, fields, handled events, and non-cancelable input keep native behavior');
}
for (const dialog of [true, false]) {
  elements.get('helpDialog').open = dialog; document.body.classList.toggle('animation-mode', !dialog);
  let blocked = false; await zoomViewport.fire('wheel', { ctrlKey: true, deltaY: -40, preventDefault() { blocked = true; } });
  assert(!blocked && studio.view.zoom === normalizedZoom, 'A dialog or inactive Scene never captures new wheel input');
}
elements.get('helpDialog').open = false; document.body.classList.remove('animation-mode');
keyEvent('0'); await flush();
await zoomViewport.fire('wheel', { ctrlKey: true, deltaY: -1, clientX: anchor.x, clientY: anchor.y }); await flush();
assert(Math.abs(studio.view.zoom - Math.exp(.005)) < 1e-12, 'Even a small trackpad movement remains continuous instead of jumping to a preset');
await zoomViewport.fire('wheel', { ctrlKey: true, deltaY: 1, deltaMode: 2, clientX: anchor.x, clientY: anchor.y }); await flush();
assert(Math.abs(studio.view.zoom - Math.exp(.005) * Math.exp(-160 * .005)) < 1e-12, 'Page-mode wheel deltas normalize and clamp');
for (let n = 0; n < 20; n++) await zoomViewport.fire('wheel', { ctrlKey: true, deltaY: -160, clientX: anchor.x, clientY: anchor.y });
assert.equal(studio.view.zoom, 12, 'Wheel zoom respects the upper Scene limit');
for (let n = 0; n < 20; n++) await zoomViewport.fire('wheel', { ctrlKey: true, deltaY: 160, clientX: anchor.x, clientY: anchor.y });
assert.equal(studio.view.zoom, .05, 'Wheel zoom respects the lower Scene limit');
studio.fitCanvas(); await flush(); await enterSceneZoom('137%'); const beforeHiddenZoom = nativePoint();
const visibleCanvasRect = zoomCanvas._rect, visibleViewportRect = zoomViewport._rect;
let hiddenZoomMeasurements = 0;
const hiddenRect = visibleRect => () => {
  if (!document.body.classList.contains('animation-mode')) return visibleRect();
  hiddenZoomMeasurements++; return { left: 0, top: 0, width: 0, height: 0 };
};
zoomCanvas._rect = hiddenRect(visibleCanvasRect); zoomViewport._rect = hiddenRect(visibleViewportRect);
zoomViewport.listeners.wheel[0]({ target: zoomCanvas, ctrlKey: true, deltaY: -40, clientX: anchor.x, clientY: anchor.y, preventDefault() {} });
const beforeSwitchZoom = studio.view.zoom;
document.body.classList.add('animation-mode'); document.dispatchEvent(new sandbox.CustomEvent('minish:workspace-changed', { detail: { mode: 'animation' } })); await flush();
assert.equal(studio.view.zoom, beforeSwitchZoom); assert.equal(hiddenZoomMeasurements, 0, 'A queued zoom repaint never measures hidden Scene layout');
document.body.classList.remove('animation-mode'); studio.render(); await flush();
assert.equal(studio.view.zoom, beforeSwitchZoom, 'Returning to Scene preserves its exact non-preset percentage');
assert(Math.abs(nativePoint().x - beforeHiddenZoom.x) < 1e-8 && Math.abs(nativePoint().y - beforeHiddenZoom.y) < 1e-8, 'Returning to Scene applies the accepted native anchor after layout is visible');
zoomCanvas._rect = visibleCanvasRect; zoomViewport._rect = visibleViewportRect;
keyEvent('0'); await flush();
const beforeSmallZoom = nativePoint();
studio.zoomAt(.1, anchor); await flush();
assert(Math.abs(nativePoint().x - beforeSmallZoom.x) < 1e-8 && Math.abs(nativePoint().y - beforeSmallZoom.y) < 1e-8, '10% Scene zoom keeps an off-center anchor with browser scroll clamping');
studio.zoomAt(.05, anchor); await flush();
assert(Math.abs(nativePoint().x - beforeSmallZoom.x) < 1e-8 && Math.abs(nativePoint().y - beforeSmallZoom.y) < 1e-8, '5% Scene zoom does not force the canvas back to the center');
assert(elements.get('placementCanvas').width <= zoomCanvas.width + 1024 && elements.get('placementCanvas').height <= zoomCanvas.height + 1024, 'Large CSS pasteboard margins keep the Scene overlay raster bounded');
assert(parseFloat(elements.get('placementCanvas').style.left) > 0 && parseFloat(elements.get('placementCanvas').style.top) > 0, 'The bounded Scene overlay remains aligned inside the larger pasteboard');
// Safari may begin pinching between a scheduled Fit repaint and its first
// gesturechange. That repaint must not discard the accepted gesture state.
studio.fitCanvas(); await flush();
const safariFitStart = studio.view.zoom, safariFitPoint = nativePoint();
zoomViewport.listeners.scroll[0]({ target: zoomViewport });
zoomViewport.listeners.gesturestart[0]({ target: zoomViewport, clientX: anchor.x, clientY: anchor.y, preventDefault() {} });
await flush();
await zoomViewport.fire('gesturechange', { scale: 1.1, clientX: anchor.x, clientY: anchor.y });
assert(Math.abs(studio.view.zoom - safariFitStart * Math.pow(1.1,1.25)) < 1e-12, 'A queued Fit repaint does not cancel the first Safari pinch change');
await zoomViewport.fire('gesturechange', { scale: 1.3, clientX: anchor.x, clientY: anchor.y }); await flush();
assert(Math.abs(studio.view.zoom - safariFitStart * Math.pow(1.3,1.25)) < 1e-12, 'Coalesced Safari changes stay proportional to gesture start');
assert(Math.abs(nativePoint().x - safariFitPoint.x) < 1e-8 && Math.abs(nativePoint().y - safariFitPoint.y) < 1e-8, 'Safari pinch keeps its native point through a queued Fit repaint');
const safariFitEnd = studio.view.zoom;
await zoomViewport.fire('gestureend', { clientX: anchor.x, clientY: anchor.y }); await flush();
assert.equal(studio.view.zoom, safariFitEnd, 'Ending the recovered Safari gesture does not snap or change the chosen percentage');
await zoomViewport.fire('gesturestart', { clientX: anchor.x, clientY: anchor.y });
const beforeGestureNavigation = studio.project;
studio.addSlide(); await flush(); const afterGestureNavigation = studio.view.zoom;
await zoomViewport.fire('gesturechange', { scale: 3, clientX: anchor.x, clientY: anchor.y }); await flush();
assert.equal(studio.view.zoom, afterGestureNavigation, 'Changing scenes explicitly discards an obsolete Safari gesture');
studio.undo(); await flush(); assert.deepEqual(studio.project, beforeGestureNavigation);
studio.fitCanvas(); await flush(); await enterSceneZoom('137%');
const beforePinch = nativePoint(), pinchStart = studio.view.zoom;
const firePinch = () => zoomViewport.listeners.wheel[0]({ target: zoomCanvas, ctrlKey: true, deltaY: -20, clientX: anchor.x, clientY: anchor.y, preventDefault() {} });
firePinch(); firePinch(); await flush();
assert(Math.abs(studio.view.zoom - pinchStart * Math.exp(.2)) < 1e-12, 'Queued pinch events accumulate before repaint');
assert(Math.abs(nativePoint().x - beforePinch.x) < 1e-8 && Math.abs(nativePoint().y - beforePinch.y) < 1e-8, 'Queued pinch events preserve the displayed native anchor');
await zoomViewport.fire('gesturestart', { clientX: anchor.x, clientY: anchor.y });
const safariStart = studio.view.zoom; await zoomViewport.fire('gesturechange', { scale: 1.3, clientX: anchor.x, clientY: anchor.y }); await flush();
assert(Math.abs(studio.view.zoom - safariStart * Math.pow(1.3,1.25)) < 1e-12);
const safariEnd = studio.view.zoom; elements.get('helpDialog').open = true;
await zoomViewport.fire('gestureend', {}); await flush(); elements.get('helpDialog').open = false;
assert.equal(studio.view.zoom, safariEnd, 'Safari gesture completion also keeps its exact fractional percentage through a dialog');
keyEvent('0'); await flush(); assert.equal(studio.view.zoom, 1);
keyEvent('+'); await flush(); assert.equal(studio.view.zoom, 1.1);
keyEvent('-'); await flush(); assert.equal(studio.view.zoom, 1);
keyEvent('f'); await flush(); assert(studio.view.fit, 'Fit is accessible without leaving the canvas');
assert.deepEqual(studio.project, projectBeforeZoom, 'Zoom fields, wheel input, and panning never change artwork or project history');
delete zoomCanvas._rect; delete zoomViewport._rect; delete zoomViewport.scrollLeft; delete zoomViewport.scrollTop;
zoomViewport.clientWidth = 760; zoomViewport.clientHeight = 700;
}
// Legacy files containing only original sheets still remain exactly editable.
studio.loadProject(base); assert.equal(studio.project.format, 'minish-cap-studio');
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/legacy-project.json'), 'utf8'));
studio.loadProject(legacy);
assert.equal(studio.project.slides.length, legacy.slides.length);
assert.equal(studio.project.slides[0].objects.length, legacy.slides[0].objects.length);
const oldSprite = legacy.slides[0].objects.find(o => o.kind === 'sprite'), loadedSprite = studio.project.slides[0].objects.find(o => o.kind === 'sprite');
for (const key of ['assetId', 'sx', 'sy', 'sw', 'sh', 'x', 'y', 'scale']) assert.equal(String(loadedSprite[key]), String(oldSprite[key]), 'Preserve legacy sprite ' + key);
await elements.get('exportAllBtn').fire('click');
const carouselBlob = blobUrls.get(downloads.at(-1).href), carouselBuffer = await carouselBlob.arrayBuffer();
const carouselEnd = new DataView(carouselBuffer, carouselBuffer.byteLength - 22);
assert.equal(carouselEnd.getUint16(10, true), legacy.slides.length + 1, 'Carousel includes every PNG and an editable project');
if (sandbox.MINISH_SPRITES) {
  const overrides = sandbox.MINISH_SPRITES.assetOverrides, overriddenPiece = Object.values(pieces.sheets).flatMap(s => s.pieces).find(p => overrides[p.assetId]);
  assert(overriddenPiece, 'Transparent replacement sheets must map to existing indexed pieces');
  await studio.choosePiece(overriddenPiece);
  assert.equal(studio.activeAsset.id, overrides[overriddenPiece.assetId]);
  const selectedPiece = studio.getBrushPiece(); assert.equal(selectedPiece.sx, overriddenPiece.sx); assert.equal(selectedPiece.sy, overriddenPiece.sy);
  const previouslyPlaced = structuredClone(base), oldIndexedObject = { ...overriddenPiece, id: 'old-indexed-object', pieceId: overriddenPiece.id, kind: 'sprite', x: 0, y: 0, scale: 1, layer: 'objects' };
  previouslyPlaced.slides[0].objects.push(oldIndexedObject); studio.loadProject(previouslyPlaced);
  await studio.exportSlide(studio.project.slides[0]);
  const exportCanvas = blobCanvases.at(-1), overrideAsset = assetIndex.get(String(overrides[overriddenPiece.assetId]));
  assert(drawCalls.some(c => c.canvas === exportCanvas && c.args[0]?.src === overrideAsset.path), 'Existing indexed sprites await and render their transparent replacements during PNG export');
  await studio.chooseAsset(catalog.assets.find(a => String(a.id) === String(overriddenPiece.sourceId)).id);
  assert.equal(String(studio.activeAsset.id), String(overriddenPiece.sourceId), 'Full source and manual crops keep their original sheets');
}
if (sandbox.MINISH_BOSSES) {
  const bossPieces = Object.values(sandbox.MINISH_BOSSES.sheets).flatMap(s => s.pieces); assert(bossPieces.length > 0);
  for (const boss of bossPieces) {
    const png = await studio.exportPiecePNG(boss), dims = new DataView(await png.arrayBuffer());
    assert.equal(dims.getUint32(8), boss.sw); assert.equal(dims.getUint32(12), boss.sh);
    assert(!fillCalls.some(c => c.canvas === blobCanvases.at(-1)), 'Complete bosses export without an added background');
  }
  const placedBoss = await studio.placePiece(bossPieces[0]); assert.equal(placedBoss.pieceId, bossPieces[0].id);
  const roundtrip = studio.project; studio.loadProject(roundtrip); assert.deepEqual(studio.project, roundtrip, 'Assembled boss assets and coordinates round trip');
  const multipart = bossPieces.find(piece => { const asset = assetIndex.get(String(piece.assetId)); return !asset.legacy && asset.sourceParts?.length > 1; });
  if (multipart) {
    studio.loadProject(base); await studio.placePiece(multipart);
    studio.updateSelected({ x: 34, y: 28, scale: 2, flipX: true, flipY: true });
    const assembled = studio.selectedObject, originalProject = studio.project, asset = assetIndex.get(assembled.assetId);
    assert(studio.canEditBossParts());
    const components = await studio.explodeSelectedBoss();
    assert.equal(components.length, asset.sourceParts.length);
    for (let i = 0; i < components.length; i++) {
      const part = asset.sourceParts[i], output = components[i], crop = asset.compositionCrop;
      assert.equal(output.x, assembled.x + (assembled.sw - (part.at.x - crop.x + (crop.padding || 0)) - part.sourceRect.w) * assembled.scale, 'Flipped parts retain their composed pixel position');
      assert.equal(output.y, assembled.y + (assembled.sh - (part.at.y - crop.y + (crop.padding || 0)) - part.sourceRect.h) * assembled.scale);
      assert.equal(output.flipX, !Boolean(part.flipX)); assert.equal(output.flipY, !Boolean(part.flipY));
      assert.equal(output.layer, assembled.layer); assert.equal(output.scale, assembled.scale);
    }
    studio.undo(); assert.deepEqual(studio.project, originalProject, 'One Undo restores the original complete boss');
    studio.select(assembled.id); studio.updateSelected({ rotation: 45 });
    const turnedBoss = studio.selectedObject, turnedComponents = await studio.explodeSelectedBoss();
    for (let i = 0; i < turnedComponents.length; i++) {
      const part = asset.sourceParts[i], output = turnedComponents[i], crop = asset.compositionCrop;
      const local = { x: part.at.x - crop.x + (crop.padding || 0) + part.sourceRect.w / 2, y: part.at.y - crop.y + (crop.padding || 0) + part.sourceRect.h / 2 };
      const world = studio.spriteGeometry.point(turnedBoss, local), center = studio.spriteGeometry.center(output);
      assert(Math.abs(world.x - center.x) < 1e-9 && Math.abs(world.y - center.y) < 1e-9, 'Turning a boss then splitting it keeps every component center in the same place');
      assert.equal(output.rotation, 45);
    }
    studio.undo(); studio.select(turnedBoss.id); assert.equal(studio.selectedObject.rotation, 45, 'Boss splitting is still one Undo after rotation');
  }
  if (sandbox.MINISH_LEGACY_BOSSES?.assets?.length) {
    const legacyBoss = sandbox.MINISH_LEGACY_BOSSES.assets[0];
    studio.loadProject(base);
    await studio.placePiece({ id: 'old-boss', name: legacyBoss.name, sourceId: 'full-boss-' + legacyBoss.originalSourceId,
      assetId: legacyBoss.id, sx: 0, sy: 0, sw: legacyBoss.width, sh: legacyBoss.height });
    const oldProject = studio.project, oldObject = studio.selectedObject;
    assert(studio.hasLegacyBossSelection());
    const upgraded = await studio.upgradeSelectedBoss();
    assert(!studio.hasLegacyBossSelection()); assert.notEqual(upgraded.assetId, oldObject.assetId);
    assert.equal(upgraded.x + upgraded.sw * upgraded.scale / 2, oldObject.x + oldObject.sw * oldObject.scale / 2);
    assert.equal(upgraded.y + upgraded.sh * upgraded.scale, oldObject.y + oldObject.sh * oldObject.scale, 'Updating an old boss preserves its feet anchor');
    studio.undo(); assert.deepEqual(studio.project, oldProject, 'Old projects can retain their original appearance with Undo');
  }
}
if (sandbox.MINISH_CURATED?.scenes?.length) {
  vm.runInContext(fs.readFileSync(path.join(root, 'random-scenes.js'), 'utf8'), ctx);
  const generator = sandbox.MINISH_RANDOM, excluded = new Set([...(sandbox.MINISH_SPRITES?.excludedPieceIds || []), ...(sandbox.MINISH_CURATED.excludedPieceIds || [])]);
  for (const template of sandbox.MINISH_CURATED.scenes) {
    for (let index = 0; index < 30; index++) {
      const options = { templateId: template.id, seed: 'regression-' + index };
      const generated = generator.buildScene(options);
      assert.deepEqual(generated, generator.buildScene(options), 'A seed repeats the same composition');
      assert(generated.objects.length >= 2, 'An audited random scene contains a setting and hero');
      for (const object of generated.objects) {
        const asset = assetIndex.get(object.assetId);
        assert(asset && !excluded.has(object.pieceId), 'Random scenes use supplied audited assets');
        assert(object.sx >= 0 && object.sy >= 0 && object.sx + object.sw <= asset.width && object.sy + object.sh <= asset.height);
        assert(object.x >= 0 && object.y >= 0 && object.x + object.sw <= generated.width && object.y + object.sh <= generated.height, 'Generated pieces stay inside the canvas');
      }
      if (template.theme !== 'boss') assert(!generated.objects.some(object => object.generationRole === 'boss'), 'Peaceful settings never receive an arbitrary boss');
      if (template.theme === 'town') assert(!generated.objects.some(object => object.generationRole === 'enemies'), 'Town scenes stay peaceful');
    }
  }
  studio.loadProject(base); const before = studio.project;
  const generated = generator.buildScene({ seed: 'insert-scene' });
  generated.generated.battle = { ...(generated.generated.battle || {}), combatants: generated.objects.slice(1).map(object => object.id), projectiles: [generated.objects[0].id] };
  generated.generated.easterEggs = [{ objectIds: generated.objects.map(object => object.id) }];
  const inserted = await studio.insertScene(generated);
  assert.equal(studio.project.slides.length, before.slides.length + 1);
  assert.deepEqual(studio.project.slides[0], before.slides[0], 'Generating adds a new scene without changing the current scene');
  assert.equal(studio.project.activeSlide, inserted.id);
  assert(inserted.generated.battle.combatants.every(id => inserted.objects.some(object => object.id === id)), 'Placed battle participants retain valid references after fresh object IDs');
  assert.equal(inserted.generated.battle.projectiles[0], inserted.objects[0].id);
  assert.equal(inserted.generated.easterEggs[0].objectIds.join(','), inserted.objects.map(object => object.id).join(','), 'Encounter membership refers to the inserted objects');
  studio.undo(); assert.deepEqual(studio.project, before, 'Random scene insertion is one undoable action');
  const handmade = studio.project;
  const firstReroll = await studio.rerollScene(generated);
  assert.equal(studio.project.slides.length, handmade.slides.length + 1, 'Surprise me again preserves a handmade scene and adds a new one');
  assert.deepEqual(studio.project.slides[0], handmade.slides[0]);
  const beforeReroll = studio.project, nextGenerated = generator.buildScene({ seed: 'a-fresh-surprise' });
  const rerolled = await studio.rerollScene(nextGenerated);
  assert.equal(rerolled.id, firstReroll.id); assert.equal(studio.project.slides.length, beforeReroll.slides.length, 'A quick reroll replaces the generated scene in the same carousel slot');
  assert.equal(studio.project.activeSlide, beforeReroll.activeSlide);
  assert.notEqual(rerolled.generated.seed, firstReroll.generated.seed);
  assert.deepEqual(studio.project.slides.filter(slide => slide.id !== rerolled.id), beforeReroll.slides.filter(slide => slide.id !== rerolled.id), 'Other scenes are untouched');
  studio.undo(); assert.deepEqual(studio.project, beforeReroll, 'One Undo restores every prior piece and the previous generated seed');
  studio.select(firstReroll.objects[0].id);
  const interruptedReroll = studio.rerollScene(nextGenerated);
  studio.updateSelected({ x: studio.selectedObject.x + 1 }); const editedDuringLoad = studio.project;
  await assert.rejects(interruptedReroll, /scene changed/); assert.deepEqual(studio.project, editedDuringLoad, 'A pending reroll never overwrites an edit made while its images load');
  studio.loadProject(before);
  const invalid = structuredClone(generated); invalid.objects[0].assetId = 'missing-scene-asset';
  await assert.rejects(studio.insertScene(invalid), /missing/);
  assert.deepEqual(studio.project, before, 'An invalid generated scene never changes the current project');
  assert.throws(() => generator.buildScene({ theme: 'unknown', seed: 'invalid' }), /No audited scene/);
  elements.get('randomTheme').value = 'town'; elements.get('randomSeed').value = '';
  await elements.get('generateSceneBtn').fire('click');
  const firstAutoSeed = studio.project.slides.find(slide => slide.id === studio.project.activeSlide).generated.seed;
  assert.equal(elements.get('randomSeed').value, '', 'Automatic seeds never silently turn the next random action into a repeat');
  await elements.get('generateSceneBtn').fire('click');
  assert.notEqual(studio.project.slides.find(slide => slide.id === studio.project.activeSlide).generated.seed, firstAutoSeed, 'Repeated random actions create fresh seeds');
  elements.get('randomSeed').value = 'intentional-repeat'; await elements.get('generateSceneBtn').fire('click');
  assert.equal(elements.get('randomSeed').value, 'intentional-repeat', 'An explicitly entered repeat seed is preserved');
}
// Animator shares the genuine renderer without sharing scene projects/history.
const sceneBeforeAnimation = studio.project;
vm.runInContext(fs.readFileSync(path.join(root, 'animation-engine.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'examples/animation-demo.js'), 'utf8'), ctx);
const animator = sandbox.MINISH_ANIMATION;
animator.init(studio); animator.loadProject(sandbox.MINISH_ANIMATION_DEMO);
const animatedScene = animator.evaluateFrame(animator.currentClip, 10);
const preparedFrame = await studio.prepareScene(animatedScene);
const renderedFrame = await studio.renderSceneToCanvas(animatedScene, { scale: 3 });
assert.equal(renderedFrame.width, 720); assert.equal(renderedFrame.height, 480);
assert.equal(preparedFrame.objects.length, 2); assert(preparedFrame.objects.some(object => object.sourceId === '6369'));
assert(drawCalls.some(call => call.canvas === renderedFrame && call.args[0]?.src?.includes('6369')), 'Animator renders the genuine Link source through the shared renderer');
assert.deepEqual(studio.project, sceneBeforeAnimation, 'Frame rendering and animation edits leave scene projects untouched');
await assert.rejects(studio.renderSceneToCanvas(animatedScene, { scale: 1.5 }), /whole numbers/);
await assert.rejects(studio.prepareScene({ ...animatedScene, objects: [{ ...animatedScene.objects[0], assetId: 'missing-animation-image' }] }), /missing/);
// Older saved animations retain source IDs. Playback and every exporter must use
// the transparent replacement without changing those editable source references.
const animationBeforeTransparencyCheck = animator.project;
const farorePoses = sandbox.MINISH_CURATED.sheets['24932'].pieces.filter(piece => ['piece-24932-1-38-31-24', 'piece-24932-33-38-31-32'].includes(piece.id));
assert.equal(farorePoses.length, 2, 'Use the reviewed Farore poses that previously retained a matte');
const faroreObject = { ...farorePoses[0], kind: 'sprite', pieceId: farorePoses[0].id, x: 12, y: 15, scale: 1, keyColor: null, layer: 'objects' };
animator.importScene({ id: 'farore-transparency-check', name: 'Transparency check', width: 240, height: 160, transparent: true, color: '#819452', objects: [faroreObject] });
animator.applyPoseSequence(animator.currentClip.objects[0].id, farorePoses, { hold: 1, loop: false });
const savedFaroreAnimation = JSON.parse(JSON.stringify(animator.saveData()));
const legacyFaroreClip = savedFaroreAnimation.clips.find(clip => clip.id === savedFaroreAnimation.activeClip);
assert.equal(legacyFaroreClip.objects[0].assetId, 'clean-24932', 'Saving never rewrites the original editable source reference');
for (const key of legacyFaroreClip.tracks[0].keys) key.values.assetId = 'clean-24932';
animator.loadProject(savedFaroreAnimation);
const transparentOracleAsset = assetIndex.get('transparent-24932');
assert(transparentOracleAsset, 'The Oracle transparent replacement is bundled');
for (const frame of [0, 1]) {
  const restoredFrame = animator.evaluateFrame(animator.currentClip, frame);
  assert.equal(restoredFrame.objects[0].assetId, 'clean-24932', 'Saved pose references keep their original asset IDs');
  assert.equal(restoredFrame.objects[0].pieceId, farorePoses[frame].id, 'Saved pose keys restore each genuine source crop');
  await studio.prepareScene(restoredFrame);
  const playbackCanvas = new Element('canvas');
  studio.drawSceneToContext(playbackCanvas.getContext('2d'), restoredFrame);
  const exportCanvas = await studio.renderSceneToCanvas(restoredFrame, { scale: 2 });
  for (const canvas of [playbackCanvas, exportCanvas]) {
    const spriteCalls = drawCalls.filter(call => call.canvas === canvas);
    assert.equal(spriteCalls.length, 1, 'A restored animation frame draws one source sprite');
    assert.equal(spriteCalls[0].args[0]?.src, transparentOracleAsset.path, 'Restored animation playback and exports draw the clean transparent sheet');
    assert.deepEqual(spriteCalls[0].args.slice(1, 5), [farorePoses[frame].sx, farorePoses[frame].sy, farorePoses[frame].sw, farorePoses[frame].sh], 'Transparency keeps the original crop coordinates');
  }
}
const manualSourceFrame = animator.evaluateFrame(animator.currentClip, 0);
manualSourceFrame.objects[0] = { ...manualSourceFrame.objects[0], assetId: '24932', pieceId: '' };
const manualSourceCanvas = await studio.renderSceneToCanvas(manualSourceFrame, { scale: 1 });
assert(drawCalls.some(call => call.canvas === manualSourceCanvas && call.args[0]?.src === assetIndex.get('24932').path), 'An intentional manual source-sheet crop keeps its original pixels');
const retiredFarore = sandbox.MINISH_CURATED.legacyPieces.map(piece => studio.getPiece(piece.id));
assert.equal(retiredFarore.length, 2);
assert(retiredFarore.every(Boolean), 'Retired review crops remain resolvable for existing project keys');
assert(sandbox.MINISH_CURATED.sheets['24932'].pieces.every(piece => !retiredFarore.some(old => old.id === piece.id)), 'Incomplete Farore crops stay outside ready choices');
animator.applyPoseSequence(animator.currentClip.objects[0].id, retiredFarore, { hold: 1, loop: false });
animator.loadProject(animator.saveData());
for (const [frame, pose] of retiredFarore.entries()) {
  const restored = animator.evaluateFrame(animator.currentClip, frame).objects[0];
  assert.equal(restored.pieceId, pose.id);
  for (const key of ['sx', 'sy', 'sw', 'sh']) assert.equal(restored[key], pose[key], 'Retired source crops retain their saved geometry');
}
assert(studio.getPiece('piece-19728-1-79-2-4'), 'Old Minish burst keys still resolve even though the fragment is hidden from new choices');
animator.loadProject(animationBeforeTransparencyCheck);
assert.deepEqual(studio.project, sceneBeforeAnimation, 'Animation transparency checks never modify scene projects');
const downloadsBeforeAnimationKeys = downloads.length;
document.body.classList.add('animation-mode');
keyEvent('s', { metaKey: true }); keyEvent('Delete'); keyEvent('t');
assert.equal(downloads.length, downloadsBeforeAnimationKeys); assert.deepEqual(studio.project, sceneBeforeAnimation, 'Animation shortcuts cannot trigger hidden scene commands');
document.body.classList.remove('animation-mode');
// A world-size logical canvas keeps its native background raster, but view-only
// input must repaint only a viewport-size overlay, not the map or scene tabs.
const beforePerformanceCheck = studio.project, performanceScene = structuredClone(base);
const performanceSlide = performanceScene.slides[0];
Object.assign(performanceSlide, { width: 4992, height: 3168, exportScale: 1, preset: 'custom', objects: [
  { ...precisePiece, id: 'performance-background', kind: 'sprite', assetId: String(precisePiece.assetId), x: 0, y: 0, scale: 1, layer: 'terrain', keyColor: null }
] });
const performanceCanvas = elements.get('sceneCanvas'), performanceOverlay = elements.get('placementCanvas'), performanceViewport = elements.get('stageViewport');
performanceViewport.scrollLeft = performanceViewport.scrollTop = 0;
performanceViewport._rect = () => ({ left: 100, top: 80, width: performanceViewport.clientWidth, height: performanceViewport.clientHeight });
performanceCanvas._rect = () => ({ left: 100 - performanceViewport.scrollLeft, top: 80 - performanceViewport.scrollTop, width: parseFloat(performanceCanvas.style.width), height: parseFloat(performanceCanvas.style.height) });
studio.loadProject(performanceScene); studio.setTool('select'); await flush(); studio.render(); await flush();
const tabCanvases = elements.get('slideList').children.map(card => card.querySelector('canvas'));
const mainClears = () => clearCalls.filter(call => call.canvas === performanceCanvas).length;
const tabClears = () => clearCalls.filter(call => tabCanvases.includes(call.canvas)).length;
const overlayDraws = () => drawCalls.filter(call => call.canvas === performanceOverlay).length;
const cachedMain = mainClears(), cachedTabs = tabClears(), containedGhosts = overlayDraws();
await performanceCanvas.fire('pointermove', { clientX: 110, clientY: 90 }); await flush();
await performanceViewport.fire('wheel', { ctrlKey: true, deltaY: -30, clientX: 140, clientY: 110 }); await flush();
studio.select('performance-background'); await flush();
performanceViewport.scrollLeft = 20; await performanceViewport.fire('scroll'); await flush();
assert.equal(mainClears(), cachedMain, 'Hover, zoom, selection and panning reuse the unchanged world raster');
assert.equal(tabClears(), cachedTabs, 'View-only changes never redraw scene thumbnails');
assert.equal(overlayDraws(), containedGhosts, 'Artwork entirely inside the world frame is not redrawn into the off-frame overlay');
assert.equal(performanceOverlay.width, performanceViewport.clientWidth); assert.equal(performanceOverlay.height, performanceViewport.clientHeight, 'World editing overlay is bounded by the viewport, not world dimensions');
assert(strokeCalls.some(call => call.canvas === performanceOverlay && call.args[2] === precisePiece.sw), 'Selection handles still draw on the small editing overlay');
studio.updateSelected({ x: 1 }); await flush();
assert(mainClears() > cachedMain && tabClears() > cachedTabs, 'Editing artwork invalidates both the world raster and its scene thumbnail');
const beforeGridMain = mainClears(), beforeGridTabs = tabClears(), originalGrid = elements.get('sceneGrid').checked;
elements.get('sceneGrid').checked = !originalGrid; await elements.get('sceneGrid').fire('change'); await flush();
assert(mainClears() > beforeGridMain, 'Changing grid visibility invalidates the scene raster');
assert.equal(tabClears(), beforeGridTabs, 'Grid changes leave export-style scene thumbnails cached');
elements.get('sceneGrid').checked = originalGrid;
const withOutsideArt = studio.project, outsideSlide = withOutsideArt.slides[0];
outsideSlide.objects.push({ ...outsideSlide.objects[0], id: 'visible-outside-art', x: -8, y: 20, layer: 'objects' }, { ...outsideSlide.objects[0], id: 'offscreen-outside-art', x: 7000, y: 20, layer: 'objects' });
performanceViewport.scrollLeft = performanceViewport.scrollTop = 0;
studio.loadProject(withOutsideArt); await flush();
const outsideDraws = overlayDraws(); studio.render();
assert.equal(overlayDraws(), outsideDraws + 1, 'Only visible artwork crossing the frame is drawn into the off-frame overlay');
const notLoaded = studio.assets.find(asset => !imageRequests.includes(asset.dataUrl || asset.path));
assert(notLoaded, 'Keep an unused real source for the delayed-image regression');
const pendingScene = studio.project;
pendingScene.slides[0].objects = [{ id: 'delayed-performance-image', kind: 'sprite', assetId: String(notLoaded.id), sx: 0, sy: 0, sw: 16, sh: 16, x: 0, y: 0, scale: 1, keyColor: null, layer: 'terrain' }];
deferImageLoads = true; studio.loadProject(pendingScene); await flush();
assert(pendingImageLoads.length > 0);
const beforeImageReady = mainClears();
deferImageLoads = false; pendingImageLoads.splice(0).forEach(ready => ready()); await flush();
assert(mainClears() > beforeImageReady, 'A delayed source image invalidates the cached raster when it becomes ready');
delete performanceCanvas._rect; delete performanceViewport._rect; performanceViewport.scrollLeft = performanceViewport.scrollTop = 0;
studio.loadProject(beforePerformanceCheck); await flush();
// The real world catalog, format picker and quick reroll share the same
// editable scene API. A handmade canvas stays intact throughout the flow.
vm.runInContext(fs.readFileSync(path.join(root, 'world-scenes.js'), 'utf8'), ctx);
const beforeWorldCheck = studio.project;
elements.get('aspectPreset').value = 'world-hyrule';
await elements.get('aspectPreset').fire('change'); await flush();
let worldScene = studio.getScene();
assert.equal(worldScene.width, 4992); assert.equal(worldScene.height, 3168);
assert.equal(worldScene.preset, 'world-hyrule'); assert.equal(worldScene.objects.length, 1);
assert.equal(worldScene.objects[0].pieceId, 'world-hyrule');
assert(!worldScene.generated, 'A blank world canvas remains a handmade scene');
const handmadeWorld = JSON.stringify(worldScene), worldSceneCount = studio.project.slides.length;
elements.get('randomScope').value = 'world-terrain'; elements.get('randomDensity').value = 'quiet'; elements.get('randomSeed').value = 'whole-hyrule-review';
await elements.get('generateSceneBtn').fire('click'); await flush();
worldScene = studio.getScene();
assert.equal(worldScene.generated.kind, 'world');
assert(worldScene.generated.encounters.length >= 20);
assert.equal(studio.project.slides.length, worldSceneCount + 1);
assert(studio.project.slides.some(slide => JSON.stringify(slide) === handmadeWorld), 'Generating a world preserves the handmade world');
assert.equal(elements.get('worldDiscoveryBtn').hidden, false);
const beforeDiscovery = JSON.stringify(worldScene);
await elements.get('worldDiscoveryBtn').fire('click'); await flush();
assert.equal(JSON.stringify(studio.getScene()), beforeDiscovery, 'Exploring an Easter egg changes only the view');
assert(studio.view.zoom > .5, 'Discovery brings a tiny encounter into a readable view');
const oldWorldSeed = worldScene.generated.seed, oldWorldId = worldScene.id;
elements.get('randomScope').value = 'scene'; elements.get('randomDensity').value = 'lively';
await elements.get('rerollSceneBtn').fire('click'); await flush();
worldScene = studio.getScene();
assert.equal(worldScene.id, oldWorldId); assert.equal(studio.project.slides.length, worldSceneCount + 1);
assert.equal(worldScene.generated.requestedOptions.scope, 'world-terrain');
assert.equal(worldScene.generated.requestedOptions.density, 'quiet');
assert.notEqual(worldScene.generated.seed, oldWorldSeed);
studio.undo(); assert.equal(JSON.stringify(studio.getScene()), beforeDiscovery, 'One Undo restores the full generated world');
elements.get('aspectPreset').value = 'world-hyrule-illustrated';
await elements.get('aspectPreset').fire('change'); await flush();
assert.equal(studio.getScene().width, 1312); assert.equal(studio.getScene().height, 1048);
assert.equal(studio.getScene().objects[0].scale, 8, 'The illustrated world uses crisp integer enlargement');
// Start far across a real large map, including a queued pointer zoom. A new
// adventure must use its own center after resizing, including at minimum zoom
// when a short viewport cannot fit the whole world.
const generationViewport = elements.get('stageViewport'), generationCanvas = elements.get('sceneCanvas'), generationWrap = elements.get('canvasWrap'), generationAnchor = { x: 350, y: 180 };
generationViewport._rect = () => ({ left: 100, top: 80, width: generationViewport.clientWidth, height: generationViewport.clientHeight });
generationCanvas._rect = () => ({ left: 100 + Math.max(0, (generationViewport.clientWidth - parseFloat(generationCanvas.style.width) - parseFloat(generationWrap.style.padding || 0) * 2) / 2) + parseFloat(generationWrap.style.padding || 0) - generationViewport.scrollLeft,
  top: 80 + Math.max(0, (generationViewport.clientHeight - parseFloat(generationCanvas.style.height) - parseFloat(generationWrap.style.padding || 0) * 2) / 2) + parseFloat(generationWrap.style.padding || 0) - generationViewport.scrollTop,
  width: parseFloat(generationCanvas.style.width), height: parseFloat(generationCanvas.style.height) });
const assertCanvasCentered = message => {
  const frame = generationCanvas.getBoundingClientRect(), area = generationViewport.getBoundingClientRect();
  assert(Math.abs(frame.left + frame.width / 2 - area.left - generationViewport.clientWidth / 2) <= 1 &&
    Math.abs(frame.top + frame.height / 2 - area.top - generationViewport.clientHeight / 2) <= 1, message);
};
studio.zoomAt(4, generationAnchor); await flush();
generationViewport.scrollLeft = 2400; generationViewport.scrollTop = 1900;
studio.zoomAt(3, generationAnchor);
elements.get('randomScope').value = 'scene'; elements.get('randomSeed').value = 'centered-battle';
await elements.get('generateSceneBtn').fire('click'); await flush();
assertCanvasCentered('A new random scene centers after a panned map and pending zoom');
const centeredScene = studio.project;
studio.zoomAt(7, generationAnchor); await flush(); generationViewport.scrollLeft = 900; generationViewport.scrollTop = 600;
await elements.get('rerollSceneBtn').fire('click'); await flush();
assertCanvasCentered('A one-click reroll centers the new composition');
studio.undo(); assert.deepEqual(studio.project, centeredScene, 'Centering adds no extra history step to reroll');
generationViewport.clientWidth = 180; generationViewport.clientHeight = 90;
elements.get('randomScope').value = 'world-terrain'; elements.get('randomSeed').value = 'centered-small-world';
await elements.get('generateSceneBtn').fire('click'); await flush();
assert.equal(studio.view.zoom, .05);
assertCanvasCentered('A random Hyrule world opens at its center even when minimum zoom is wider than the viewport');
const worldBeforeNavigation = studio.project;
studio.setTool('hand');
await generationCanvas.fire('pointerdown', { currentTarget: generationCanvas, clientX: 160, clientY: 120 });
await generationCanvas.fire('pointermove', { clientX: 145, clientY: 110 });
await generationCanvas.fire('pointerup'); await flush();
assert.deepEqual(studio.project, worldBeforeNavigation, 'Panning the newly centered world still preserves all artwork');
const pannedFrame = generationCanvas.getBoundingClientRect();
assert(Math.abs(pannedFrame.left + pannedFrame.width / 2 - 190) > 1, 'Hand navigation does not snap back to the center');
generationViewport.clientWidth = 700; generationViewport.clientHeight = 330;
studio.loadProject(beforeWorldCheck); await flush();
const beforeRotationReview = studio.project, geometry = studio.spriteGeometry;
assert.equal(geometry.normalizeRotation(-45), 315); assert.equal(geometry.normalizeRotation(405), 45);
for (const rotation of [0,45,90,135,180,225,270,315]) for (const flipX of [false,true]) for (const flipY of [false,true]) {
  const shape = { kind: 'sprite', x: 100, y: 80, sw: 12, sh: 28, scale: 2, rotation, flipX, flipY };
  const local = { x: 11.5, y: .5 }, world = geometry.point(shape, local), inverse = geometry.localPoint(shape, world);
  assert(Math.abs(inverse.x - local.x) < 1e-9 && Math.abs(inverse.y - local.y) < 1e-9, 'Rotated/flipped picking agrees with the displayed crop');
  assert(geometry.contains(shape, world), 'Turned artwork remains selectable past its former rectangle');
  const bound = geometry.bounds(shape), c = geometry.center(shape);
  assert(Math.abs(bound.x + bound.w / 2 - c.x) < 1e-9 && Math.abs(bound.y + bound.h / 2 - c.y) < 1e-9, 'Rotation leaves the center in place');
  if (rotation % 90) assert(!geometry.contains(shape, { x: bound.x + .01, y: bound.y + .01 }), 'Empty corners of a turned bounding box are not clickable');
}
const rotationActor = await studio.placePiece(alternate); studio.updateSelected({ x: 90, y: 70, scale: 2, rotation: 0 });
const rotationStart = studio.project, centerBeforeTurn = geometry.center(studio.selectedObject);
await elements.get('rotateRightBtn').fire('click'); await flush();
assert.equal(studio.selectedObject.rotation, 45); assert.deepEqual(geometry.center(studio.selectedObject), centerBeforeTurn);
studio.undo(); assert.deepEqual(studio.project, rotationStart, 'A 45-degree turn is one Undo'); studio.redo(); studio.select(rotationActor.id);
elements.get('objectRotation').value = '315'; await elements.get('objectRotation').fire('change'); await elements.get('rotateRightBtn').fire('click');
assert.equal(studio.selectedObject.rotation, 0, 'Clockwise rotation wraps all the way around');
await elements.get('rotateLeftBtn').fire('click'); assert.equal(studio.selectedObject.rotation, 315, 'Left rotation works in the other direction');
const rotatedCopy = studio.duplicateSelected(); assert.equal(rotatedCopy.rotation, 315);
for (const angle of [45,90]) {
  const changingPose = await studio.placePiece(first); studio.updateSelected({ x: 60, y: 50, scale: 2, rotation: angle });
  const anchorBefore = geometry.point(studio.selectedObject, { x: first.sw / 2, y: first.sh });
  await studio.replaceSelectedPose(alternate);
  const anchorAfter = geometry.point(studio.selectedObject, { x: alternate.sw / 2, y: alternate.sh });
  assert(Math.abs(anchorBefore.x - anchorAfter.x) < 1e-9 && Math.abs(anchorBefore.y - anchorAfter.y) < 1e-9, 'Changing a rotated character pose keeps its world feet anchor');
  assert.equal(studio.selectedObject.id, changingPose.id);
}
const turnedProject = studio.project; studio.loadProject(turnedProject); assert.deepEqual(studio.project, turnedProject, 'Save and reopen keep sprite angles');
const raster = document.createElement('canvas'); raster.width = 240; raster.height = 160;
rotationCalls.length = 0; studio.drawSceneToContext(raster.getContext('2d'), { ...studio.getScene(), width: 240, height: 160 });
assert(rotationCalls.some(call => call.canvas === raster && Math.abs(call.angle - 315 * Math.PI / 180) < 1e-12), 'The preview and export renderer use the saved rotation');
rotationCalls.length = 0; await studio.exportSlide(studio.getScene());
assert(rotationCalls.some(call => Math.abs(call.angle - 315 * Math.PI / 180) < 1e-12), 'PNG export includes turned sprites');
studio.select(null); elements.get('objectRotation').value = '90'; await elements.get('objectRotation').fire('change');
const rotatedBrush = await studio.placePieceAt(alternate, { x: 120, y: 80 }); assert.equal(rotatedBrush.rotation, 90, 'Brush angle is applied to dragged and added pieces');
studio.addDialogue(); assert.equal(elements.get('sceneRotationControls').hidden, true, 'Sprite rotation does not expose unsupported dialogue rotation');
studio.loadProject(beforeRotationReview);
console.log('PASS: scene editing, 45-degree sprite transforms and boss parts, accurate picking, rotated PNG export, platform controls, animation isolation, random scenes, and saved-project compatibility.');
