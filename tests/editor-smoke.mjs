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
for (const source of ['assets/legacy-bosses.js', 'assets/curated.js', 'assets/full-bosses.js', 'assets/logo.js']) {
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
const drawCalls = [], fillCalls = [], textCalls = [], pixelWrites = [], blobCanvases = [], downloads = [], elements = new Map(), blobUrls = new Map();
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
  set src(value) { this._src = value; [this.width, this.height] = dimensions.get(value) || [224, 48]; const ready = () => this.onload?.(); deferImageLoads ? pendingImageLoads.push(ready) : queueMicrotask(ready); }
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
for (const file of ['assets/sprites.js', 'assets/legacy-bosses.js', 'assets/curated.js', 'assets/full-bosses.js']) if (fs.existsSync(path.join(root, file))) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
for (const supplement of [sandbox.MINISH_SPRITES, sandbox.MINISH_LEGACY_BOSSES, sandbox.MINISH_CURATED, sandbox.MINISH_BOSSES]) for (const asset of supplement?.assets || []) {
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
assert.equal(studio.version, '7.0.1');
assert.equal(studio.sourceAssets.length, 134);
assert.equal(studio.assets.length, 134 + pieces.assets.length + (sandbox.MINISH_SPRITES?.assets?.length || 0) + (sandbox.MINISH_LEGACY_BOSSES?.assets?.length || 0) + (sandbox.MINISH_CURATED?.assets?.length || 0) + (sandbox.MINISH_BOSSES?.assets?.length || 0));
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
  { width: 0, height: 270, exportScale: 5 }, { width: 2049, height: 270, exportScale: 5 },
  { width: 216, height: 270, exportScale: 1.5 }, { width: 216, height: 270, exportScale: 9 },
  { width: 2048, height: 2048, exportScale: 8 }, { width: NaN, height: 270, exportScale: 1 }
]) {
  const unchanged = JSON.stringify(studio.project); assert.throws(() => studio.setCanvasFormat(invalid));
  assert.equal(JSON.stringify(studio.project), unchanged, 'Invalid canvas settings leave the project untouched');
}
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
  assert.equal(JSON.stringify(studio.project), validScene); assert.match(elements.get('toast').textContent, /between 16 and 2048/);
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
const movementZoom = parseFloat(elements.get('stageZoomLabel').textContent) / 100;
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
const beforePinch = nativePoint(), projectBeforeZoom = studio.project;
let plainWheelBlocked = false; await zoomViewport.fire('wheel', { deltaY: -40, ctrlKey: false, preventDefault() { plainWheelBlocked = true; } });
assert(!plainWheelBlocked); assert.equal(studio.view.zoom, 2, 'Ordinary two-finger scrolling is never intercepted');
let pinchBlocked = false;
await zoomViewport.fire('wheel', { deltaY: -45, ctrlKey: true, clientX: anchor.x, clientY: anchor.y, preventDefault() { pinchBlocked = true; } }); await flush();
assert(pinchBlocked); assert(studio.view.zoom > 2 && !Number.isInteger(studio.view.zoom), 'Pinch zoom updates continuously during the gesture');
assert(Math.abs(nativePoint().x - beforePinch.x) < 1e-8 && Math.abs(nativePoint().y - beforePinch.y) < 1e-8, 'Pinch keeps its native point under the cursor');
const settle = [...timers.values()].find(timer => timer.ms === 140); assert(settle); settle.fn(); await flush();
assert(Number.isInteger(studio.view.zoom), 'The final enlargement uses whole native pixels');
assert(Math.abs(nativePoint().x - beforePinch.x) < 1e-8 && Math.abs(nativePoint().y - beforePinch.y) < 1e-8, 'Settling keeps the same cursor anchor');
const beforeBurst = nativePoint(), burstStart = studio.view.zoom;
const firePinch = () => zoomViewport.listeners.wheel[0]({ ctrlKey: true, deltaY: -20, clientX: anchor.x, clientY: anchor.y, preventDefault() {} });
firePinch(); firePinch(); await flush();
assert(Math.abs(studio.view.zoom - burstStart * Math.exp(.16)) < 1e-8, 'Queued pinch events accumulate before repaint');
assert(Math.abs(nativePoint().x - beforeBurst.x) < 1e-8 && Math.abs(nativePoint().y - beforeBurst.y) < 1e-8, 'Queued pinch events anchor against the displayed canvas, not the pending scale');
await zoomViewport.fire('gesturestart', { clientX: anchor.x, clientY: anchor.y });
const safariStart = studio.view.zoom; await zoomViewport.fire('gesturechange', { scale: 1.3, clientX: anchor.x, clientY: anchor.y }); await flush();
assert(Math.abs(studio.view.zoom - safariStart * 1.3) < 1e-8, 'Safari trackpad GestureEvents scale the canvas');
await zoomViewport.fire('gestureend', {});
keyEvent('0'); await flush(); assert.equal(studio.view.zoom, 1);
keyEvent('+'); await flush(); assert.equal(studio.view.zoom, 2);
keyEvent('-'); await flush(); assert.equal(studio.view.zoom, 1);
keyEvent('f'); await flush(); assert(studio.view.fit, 'Fit is accessible without leaving the canvas');
assert.deepEqual(studio.project, projectBeforeZoom, 'Zoom and scrolling never change artwork or project history');
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
  const inserted = await studio.insertScene(generated);
  assert.equal(studio.project.slides.length, before.slides.length + 1);
  assert.deepEqual(studio.project.slides[0], before.slides[0], 'Generating adds a new scene without changing the current scene');
  assert.equal(studio.project.activeSlide, inserted.id);
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
const downloadsBeforeAnimationKeys = downloads.length;
document.body.classList.add('animation-mode');
keyEvent('s', { metaKey: true }); keyEvent('Delete'); keyEvent('t');
assert.equal(downloads.length, downloadsBeforeAnimationKeys); assert.deepEqual(studio.project, sceneBeforeAnimation, 'Animation shortcuts cannot trigger hidden scene commands');
document.body.classList.remove('animation-mode');
console.log('PASS: scene editing, platform controls, animation render isolation, curated artwork, keyframe integration, random scenes, export sizing, and saved-project compatibility.');
