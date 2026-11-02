import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const thumbnailSandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'library.js'), 'utf8'), thumbnailSandbox);
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const curated = read('assets/curated.json'), bosses = read('assets/full-bosses.json');
const combatSandbox = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, 'combat-library.js'), 'utf8'), combatSandbox);
const combat = combatSandbox.window.MINISH_COMBAT_LIBRARY;
const assets = [...read('assets/catalog.json').assets, ...read('assets/pieces.json').assets, ...read('assets/sprites.json').assets, ...curated.assets, ...bosses.assets, ...combat.assets];
const pieceMap = new Map(Object.values(combat.mergeSheets({ ...curated.sheets, ...bosses.sheets })).flatMap(sheet => sheet.pieces).map(piece => [piece.id, piece]));
const nodes = new Map(), handlers = new Map(), frames = [], timers = new Map();
let document, timer = 0, zoomDialogOpen = false, enforceHiddenZoomLayout = false, hiddenZoomMeasurements = 0;
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.dataset = {}; this.style = {}; this.className = ''; this.listeners = new Map(); this.attributes = new Map();
    this.width = 240; this.height = 160; this.clientWidth = 640; this.clientHeight = 390; this.scrollLeft = this.scrollTop = 0; this.hidden = this.disabled = this.checked = false;
    this.classList = { contains: value => this.className.split(' ').includes(value), toggle: (value, enabled) => { const set = new Set(this.className.split(' ').filter(Boolean)); const next = enabled ?? !set.has(value); next ? set.add(value) : set.delete(value); this.className = [...set].join(' '); return next; }, add: (...values) => values.forEach(value => this.classList.toggle(value, true)), remove: (...values) => values.forEach(value => this.classList.toggle(value, false)) };
  }
  get value() { return this._value || (this.tagName === 'SELECT' ? this.children[0]?.value || '' : ''); }
  set value(value) { this._value = String(value); }
  get options() { return this.children; }
  getContext() {
    return this.context ||= new Proxy({ drawImage: (...args) => { this.lastDraw = args; }, measureText: text => ({ width: text.length * 6 }) }, { get: (target, prop) => prop in target ? target[prop] : () => {} });
  }
  append(...children) { for (const child of children) if (child.tagName === 'FRAGMENT') this.append(...child.children); else { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this._value = ''; this.append(...children); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  fire(type, extra = {}) { const event = { type, target: this, button: 0, pointerId: 1, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const fn of this.listeners.get(type) || []) fn(event); return event; }
  dispatchEvent(event) { this.fire(event.type, event); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    if (this.id === 'animationWorkspace' && selector === 'input, textarea, select') return [...nodes.values()].filter(node => /INPUT|SELECT|TEXTAREA/.test(node.tagName));
    const all = this.descendants();
    if (selector.startsWith('.')) return all.filter(node => node.classList.contains(selector.slice(1)));
    if (selector === '[data-preset]') return all.filter(node => node.dataset.preset != null);
    return all.filter(node => node.tagName === selector.toUpperCase());
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() {
    if (enforceHiddenZoomLayout && !document.body.classList.contains('animation-mode') && ['animationCanvas', 'animStageViewport'].includes(this.id)) {
      hiddenZoomMeasurements++; return { left: 0, top: 0, width: 0, height: 0 };
    }
    const width = parseFloat(this.style.width) || this.width, height = parseFloat(this.style.height) || this.height;
    if (this.id !== 'animationCanvas') return { left: 20, top: 30, width: this.clientWidth, height: this.clientHeight, right: 20 + this.clientWidth, bottom: 30 + this.clientHeight };
    const vp = nodes.get('animStageViewport'), wrap = nodes.get('animCanvasWrap'), padding = parseFloat(wrap.style.padding) || 0;
    const transform = wrap.style.transform?.match(/translate\(([-.\d]+)px,([-.\d]+)px\)/);
    const left = 20 + Math.max(0, (vp.clientWidth - width - padding * 2) / 2) + padding - vp.scrollLeft + Number(transform?.[1] || 0);
    const top = 30 + Math.max(0, (vp.clientHeight - height - padding * 2) / 2) + padding - vp.scrollTop + Number(transform?.[2] || 0);
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  contains(node) { return node === this || this.descendants().includes(node); }
  focus() { document.activeElement = this; }
  setPointerCapture() {} remove() {} click() { return this.fire('click'); }
  showModal() { this.open = true; } close() { this.open = false; }
}
const markup = fs.readFileSync(path.join(root, 'animation-shell.html'), 'utf8');
for (const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
  const node = new Element(match[1], match[3]), attrs = match[2];
  node.className = attrs.match(/\bclass="([^"]*)"/)?.[1] || ''; node.value = attrs.match(/\bvalue="([^"]*)"/)?.[1] || ''; node.checked = /\bchecked\b/.test(attrs); nodes.set(node.id, node);
}
for (const id of ['sceneModeBtn', 'animationModeBtn', 'workspaceModeSwitch', 'sceneWorkspace']) nodes.set(id, new Element('div', id));
document = { body: new Element('body'), activeElement: null, getElementById: id => { assert(nodes.has(id), 'Unknown UI element: ' + id); return nodes.get(id); }, createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'), querySelector: selector => selector === 'dialog[open]' && zoomDialogOpen ? {} : null,
  addEventListener: (name, fn) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }, dispatchEvent() {} };
nodes.get('animCategory').value = 'characters'; nodes.get('animLibrarySpeed').value = 'normal'; nodes.get('animLibraryMotion').value = 'none';
const adapter = { assets, getAsset: id => assets.find(asset => String(asset.id) === String(id)), getPiece: id => pieceMap.get(id), getPieceSource: async () => ({ image: {}, sx: 0, sy: 0, sw: 16, sh: 24 }), prepareScene: async () => {}, drawSceneToContext() {}, render() {} };
const storage = new Map();
const sandbox = { document, MINISH_STUDIO: adapter, MINISH_CURATED: curated, MINISH_BOSSES: bosses, MINISH_COMBAT_LIBRARY: combat, MINISH_ASSETS: { assets }, console,
  MINISH_THUMBNAILS: thumbnailSandbox.window.MINISH_THUMBNAILS,
  Option: function(text, value) { const node = new Element('option'); node.textContent = text; node.value = value; return node; },
  Event: class { constructor(type, extra) { this.type = type; Object.assign(this, extra); } }, CustomEvent: class { constructor(type, extra) { this.type = type; Object.assign(this, extra); } },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
  setTimeout: (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; }, clearTimeout: id => timers.delete(id), addEventListener() {}, dispatchEvent() {} };
sandbox.window = sandbox;
const context = vm.createContext(sandbox);
for (const file of ['animation-engine.js', 'simple-animation.js', 'animation-ui.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const engine = sandbox.MINISH_ANIMATION, simple = sandbox.MINISH_SIMPLE_ANIMATION, ui = sandbox.MINISH_ANIMATION_UI;
const flush = async () => { for (let i = 0; i < 5; i++) { for (const fn of frames.splice(0)) fn(16); await Promise.resolve(); } };
const key = (value, target = document.body, extra = {}) => { const event = { key: value, target, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const fn of handlers.get('keydown') || []) fn(event); return event; };
ui.setMode('animation'); await flush();
const originalSource = nodes.get('animSource').value, originalEditorMode = ui.editorMode;
ui.setEditorMode('timeline'); nodes.get('animSource').value = '24932'; nodes.get('animSource').fire('change'); await flush();
const oracleThumbnails = nodes.get('animPoseGrid').descendants().filter(node => node.tagName === 'CANVAS');
assert(oracleThumbnails.length > 10, 'Animate previews the real Oracle pose collection');
for (const thumbnail of oracleThumbnails) {
  const piece = pieceMap.get(thumbnail.dataset.piece), expected = sandbox.MINISH_THUMBNAILS.layout(piece.sw, piece.sh, thumbnail.width, thumbnail.height, 2);
  assert.deepEqual(thumbnail.lastDraw.slice(5), [expected.x, expected.y, expected.width, expected.height], 'Animate pose thumbnails use the shared native-size policy');
  assert.equal(thumbnail.getContext().imageSmoothingEnabled, false, 'Animation thumbnails retain nearest-neighbor pixels');
}
nodes.get('animSource').value = originalSource; nodes.get('animSource').fire('change'); ui.setEditorMode(originalEditorMode); await flush();
for (const thumbnail of nodes.get('animPoseGrid').descendants().filter(node => node.tagName === 'CANVAS')) {
  const piece = pieceMap.get(thumbnail.dataset.piece), expected = sandbox.MINISH_THUMBNAILS.layout(piece.sw, piece.sh, thumbnail.width, thumbnail.height, 2);
  assert.deepEqual(thumbnail.lastDraw.slice(5), [expected.x, expected.y, expected.width, expected.height], 'Ready-action thumbnails use the same shared policy');
}
const pose = curated.sheets['6369'].pieces.find(piece => piece.sequence === 28);
const base = engine.addObject({ ...pose, kind: 'sprite', pieceId: pose.id, pieceName: pose.name, x: 20, y: 40, scale: 1, layer: 'objects' });
simple.apply(base.id, { presetId: 'link-walk-away', motion: 'up', distance: 32 }); await flush();
const copied = JSON.stringify(engine.project);
assert(key('c', nodes.get('animObjects'), { metaKey: true }).defaultPrevented, 'Piece-list copy is a command');
key('v', nodes.get('animObjects'), { ctrlKey: true });
assert.equal(engine.currentClip.objects.length, 2); assert(!simple.inspect(engine.selectedObjectId).needsReplacement, 'Pasted recipe metadata remains valid');
engine.undo(); assert.equal(JSON.stringify(engine.project), copied, 'Paste is one Undo');
const cutBase = JSON.parse(JSON.stringify(engine.currentClip.objects[0])), cutTrack = JSON.parse(JSON.stringify(engine.currentClip.tracks[0]));
key('x', nodes.get('animObjects'), { metaKey: true }); assert.equal(engine.currentClip.objects.length, 0);
key('v', nodes.get('animObjects'), { metaKey: true });
assert.equal(engine.currentClip.objects[0].x, cutBase.x, 'The first cut/paste keeps the exact X coordinate');
assert.equal(engine.currentClip.objects[0].y, cutBase.y, 'The first cut/paste keeps the exact Y coordinate');
assert.equal(JSON.stringify(engine.currentClip.tracks[0].keys), JSON.stringify(cutTrack.keys), 'The entire cut animation path and timing remain exact');
assert(!simple.inspect(engine.selectedObjectId).needsReplacement, 'Cut/pasted metadata remains valid');
key('v', nodes.get('animObjects'), { metaKey: true }); assert.equal(engine.currentClip.objects[1].x, cutBase.x + 8, 'Repeated paste offsets the next copy by eight pixels');
engine.undo(); engine.undo(); assert.equal(engine.currentClip.objects.length, 0, 'One Undo removes each pasted piece with all animation keys');
engine.undo(); assert.equal(JSON.stringify(engine.project), copied, 'Undo restores the entire original cut piece and keys');
engine.setTrack(engine.selectedObjectId, { locked: true }); const locked = JSON.stringify(engine.project);
ui.deleteSelectedPiece(); assert.equal(JSON.stringify(engine.project), locked); assert.match(nodes.get('animStatus').textContent, /Unlock/, 'Failed deletion retains the useful lock error');
engine.undo();

assert(!key('Backspace', nodes.get('animDialogueText')).defaultPrevented, 'Typing Backspace stays native');
assert(key('Backspace', nodes.get('animObjects')).defaultPrevented, 'Piece-list Backspace deletes the selected element');
assert.equal(engine.currentClip.objects.length, 0); assert.equal(nodes.get('animStatus').textContent, 'Piece deleted. Undo restores it.'); engine.undo();
assert(!key('ArrowDown', nodes.get('animObjects')).defaultPrevented, 'Piece-list arrow navigation stays native');
const beforeClear = JSON.stringify(engine.project); ui.deleteCurrentClip();
assert.equal(engine.project.clips.length, 1); assert.equal(engine.currentClip.objects.length, 0); assert.match(nodes.get('animStatus').textContent, /Undo restores the entire clip/); engine.undo(); assert.equal(JSON.stringify(engine.project), beforeClear, 'Deleting the final clip is fully undoable');
engine.addClip(); engine.switchClip(engine.project.clips[0].id); const beforeDelete = JSON.stringify(engine.project);
key('Backspace', nodes.get('animObjects'), { metaKey: true, shiftKey: true }); assert.equal(engine.project.clips.length, 1); engine.undo(); assert.equal(JSON.stringify(engine.project), beforeDelete);
const beforeZoomProject = JSON.stringify(engine.project);
ui.fitCanvas(); await flush();
const canvas = nodes.get('animationCanvas'), vp = nodes.get('animStageViewport'), wrap = nodes.get('animCanvasWrap'), zoomField = nodes.get('animZoomLabel');
let zoomScrollX = vp.scrollLeft, zoomScrollY = vp.scrollTop;
const scrollExtent = axis => {
  const dimension = axis === 'x' ? 'width' : 'height', offset = axis === 'x' ? 'left' : 'top';
  const client = vp[axis === 'x' ? 'clientWidth' : 'clientHeight'];
  const content = parseFloat(canvas.style[dimension]) + parseFloat(wrap.style.padding) * 2;
  const absolute = nodes.get('animOverlayCanvas'), reach = (parseFloat(absolute.style[offset]) || 0) + (parseFloat(absolute.style[dimension]) || absolute[dimension]);
  // Absolute overlays contribute real scrollable overflow even though they
  // do not change the centered flex child's own measured dimensions.
  return Math.max(0, content - client, Math.max(0, (client - content) / 2) + reach - client);
};
Object.defineProperty(vp, 'scrollLeft', { get() { return zoomScrollX = Math.max(0, Math.min(zoomScrollX, scrollExtent('x'))); }, set(value) { zoomScrollX = Math.max(0, Math.min(value, scrollExtent('x'))); } });
Object.defineProperty(vp, 'scrollTop', { get() { return zoomScrollY = Math.max(0, Math.min(zoomScrollY, scrollExtent('y'))); }, set(value) { zoomScrollY = Math.max(0, Math.min(value, scrollExtent('y'))); } });
const point = { x: vp.getBoundingClientRect().left + 115, y: vp.getBoundingClientRect().top + 85 };
const nativePoint = () => { const rect = canvas.getBoundingClientRect(); return { x: (point.x - rect.left) / ui.view.zoom, y: (point.y - rect.top) / ui.view.zoom }; };
const enterZoom = async (value, ending = 'Enter') => {
  zoomField.focus(); zoomField.value = value; zoomField.fire('input');
  zoomField.fire(ending === 'blur' ? 'blur' : 'keydown', { key: ending }); await flush();
};
await enterZoom('62.5%'); assert.equal(ui.view.zoom, .625); assert.equal(zoomField.value, '63%');
assert.equal(document.activeElement, canvas, 'Enter applies a custom Animate percentage and restores canvas keyboard control');
key('+'); await flush(); assert.equal(ui.view.zoom, .725, 'Animate plus changes ten percentage points and preserves the custom fractional part');
key('-'); await flush(); assert.equal(ui.view.zoom, .625);
await enterZoom('137.25%', 'blur'); assert.equal(ui.view.zoom, 1.3725, 'Blur applies decimal zoom without preset rounding');
await enterZoom('800%', 'Escape'); assert.equal(ui.view.zoom, 1.3725); assert.equal(zoomField.value, '137%', 'Escape cancels a zoom draft and restores the whole-percent label');
for (const invalid of ['', 'potato', 'Infinity', '10%%', '-20%']) { await enterZoom(invalid, 'blur'); assert.equal(ui.view.zoom, 1.3725, 'Malformed percentages leave Animate view unchanged'); }
await enterZoom('0%'); assert.equal(ui.view.zoom, .05);
await enterZoom('9999%'); assert.equal(ui.view.zoom, 12, 'Typed zoom shares the 5%-1200% range');
await enterZoom('100.005%'); assert(Math.abs(ui.view.zoom - 1.00005) < 1e-12);
await enterZoom('62,5%'); assert.equal(ui.view.zoom, .625, 'Decimal commas are accepted');
zoomField.focus(); zoomField.value = '175%'; zoomField.fire('input'); ui.render(); await flush();
assert.equal(zoomField.value, '175%', 'Animation redraws preserve a focused zoom draft');
zoomField.fire('keydown', { key: 'Escape' });
const beforeHandPan = JSON.stringify(engine.project), selectedBeforeHand = engine.selectedObjectId;
for (const extra of [{ target: nodes.get('animDialogueText') }, { isComposing: true }, { keyCode: 229 }, { altKey: true }]) {
  key('h', extra.target || document.body, extra); assert(!ui.view.hand, 'Typing and IME events do not activate Animate Hand zoom');
}
zoomDialogOpen = true; key('h'); assert(!ui.view.hand); zoomDialogOpen = false;
ui.fitCanvas(); await flush();
const fitZoomBeforePan = ui.view.zoom, fitFrameBeforePan = canvas.getBoundingClientRect(), fitArea = vp.getBoundingClientRect();
const fitCenter = { x: fitArea.left + vp.clientWidth / 2, y: fitArea.top + vp.clientHeight / 2 };
const fitNativeBeforePan = { x: (fitCenter.x - fitFrameBeforePan.left) / fitZoomBeforePan, y: (fitCenter.y - fitFrameBeforePan.top) / fitZoomBeforePan };
const firstFitWheel = vp.fire('wheel', { deltaX: 12, deltaY: 15, clientX: fitCenter.x, clientY: fitCenter.y });
const beforeNativeDefault = canvas.getBoundingClientRect();
assert(Math.abs(beforeNativeDefault.left - fitFrameBeforePan.left) < .6 && Math.abs(beforeNativeDefault.top - fitFrameBeforePan.top) < .6, 'Opening manual scroll space keeps the fitted animation in the same screen position');
// Simulate the browser defaults after dispatch. The first event already has
// overflow available, without waiting for asynchronous scene drawing.
vp.scrollLeft += 12; vp.scrollTop += 15;
const queuedFitWheel = vp.fire('wheel', { deltaX: 8, deltaY: 10, clientX: fitCenter.x, clientY: fitCenter.y });
vp.scrollLeft += 8; vp.scrollTop += 10; await flush();
assert(!firstFitWheel.defaultPrevented && !queuedFitWheel.defaultPrevented && !ui.view.fit, 'The first normal Animate scroll opens pan space without preventing native input');
assert.equal(ui.view.zoom, fitZoomBeforePan, 'Fit-to-pan keeps the animation zoom unchanged');
const fitFrameAfterPan = canvas.getBoundingClientRect();
const fitNativeAfterPan = { x: (fitCenter.x - fitFrameAfterPan.left) / ui.view.zoom, y: (fitCenter.y - fitFrameAfterPan.top) / ui.view.zoom };
assert(Math.abs((fitNativeAfterPan.x - fitNativeBeforePan.x) * ui.view.zoom - 20) < 1 && Math.abs((fitNativeAfterPan.y - fitNativeBeforePan.y) * ui.view.zoom - 25) < 1, 'Native panning from Fit retains both wheel movements through the later async draw without a jump or duplicate');
assert.equal(JSON.stringify(engine.project), beforeHandPan, 'First-scroll pan changes no animation artwork, timing, or history');
ui.fitCanvas(); await flush();
assert(key('h').defaultPrevented); await flush(); assert(ui.view.hand); assert.equal(canvas.style.cursor, 'grab');
engine.play(); assert(engine.state.playing);
vp.fire('pointerdown', { currentTarget: vp, clientX: 300, clientY: 200 }); await flush();
assert(engine.state.playing, 'Hand zoom can pan while the animation keeps playing'); engine.pause();
const handScroll = { x: vp.scrollLeft, y: vp.scrollTop }; assert.equal(canvas.style.cursor, 'grabbing');
vp.fire('pointermove', { currentTarget: vp, clientX: 260, clientY: 175 }); await flush();
assert(Math.abs(vp.scrollLeft - handScroll.x - 40) < 1 && Math.abs(vp.scrollTop - handScroll.y - 25) < 1, 'Animate Hand zoom drags both viewport axes without editing a piece');
vp.fire('pointerup', { currentTarget: vp }); await flush(); assert.equal(canvas.style.cursor, 'grab');
assert.equal(JSON.stringify(engine.project), beforeHandPan, 'Hand dragging does not add keys, change artwork, or create animation history'); assert.equal(engine.selectedObjectId, selectedBeforeHand);
assert(key('v').defaultPrevented); assert(!ui.view.hand); assert.equal(canvas.style.cursor, 'default');
nodes.get('animToolsMenu').open = true;
nodes.get('animHandTool').fire('click'); assert(ui.view.hand, 'Tools menu activates Hand without a keyboard shortcut');
assert(!nodes.get('animToolsMenu').open && document.activeElement === nodes.get('animToolsLabel'), 'Choosing a tool closes its menu and returns keyboard focus');
assert.equal(nodes.get('animHandTool').getAttribute('aria-pressed'), 'true');
nodes.get('animHandTool').fire('click'); assert(ui.view.hand, 'Selecting Hand again keeps the chosen tool');
nodes.get('animSelectTool').fire('click'); assert(!ui.view.hand, 'Tools menu restores piece selection without a keyboard shortcut');
assert.equal(JSON.stringify(engine.project), beforeHandPan, 'Tool menu choices preserve all animation pieces and keys');
key('0'); await flush();
const beforeWheel = nativePoint();
for (const delta of [{ deltaY: -30 }, { deltaY: 30 }, { deltaX: 30, deltaY: 0 }, { deltaX: -30, deltaY: 0 }]) {
  const ordinary = vp.fire('wheel', { ...delta, clientX: point.x, clientY: point.y }); assert(!ordinary.defaultPrevented && ui.view.zoom === 1, 'Normal two-finger scrolling and wheel input pan natively in all four directions');
}
const pinch = vp.fire('wheel', { ctrlKey: true, deltaY: -30, clientX: point.x, clientY: point.y }); await flush();
const freeZoom = Math.exp(.15);
assert(pinch.defaultPrevented && Math.abs(ui.view.zoom - freeZoom) < 1e-12, 'Pinch or Ctrl+wheel produces continuous animation zoom');
assert(Math.abs(nativePoint().x - beforeWheel.x) < .6 && Math.abs(nativePoint().y - beforeWheel.y) < .6, 'Pinch keeps the native point under the cursor');
assert(![...timers.values()].some(task => task.delay === 180), 'No delayed timer can snap manual Animate zoom');
await flush(); assert.equal(ui.view.zoom, freeZoom, 'Animation zoom stays at the exact percentage after scrolling stops');
for (const extra of [{ shiftKey: true, deltaY: -30 }, { deltaX: 20, deltaY: 2 }, { ctrlKey: true, deltaY: 0 }, { ctrlKey: true, deltaY: Infinity }, { ctrlKey: true, deltaY: -30, cancelable: false }, { ctrlKey: true, deltaY: -30, defaultPrevented: true }, { ctrlKey: true, deltaY: -30, target: new Element('input') }]) {
  const previous = ui.view.zoom, event = vp.fire('wheel', extra);
  assert.equal(ui.view.zoom, previous, 'Panning and protected input never zoom the canvas');
  if (!extra.defaultPrevented) assert(!event.defaultPrevented, 'Panning and protected input keep native wheel behavior');
}
zoomDialogOpen = true;
assert(!vp.fire('wheel', { ctrlKey: true, deltaY: -30 }).defaultPrevented); assert.equal(ui.view.zoom, freeZoom, 'Dialog opening leaves the accepted fractional view intact'); zoomDialogOpen = false;
ui.setMode('scene'); assert(!vp.fire('wheel', { ctrlKey: true, deltaY: -30 }).defaultPrevented && ui.view.zoom === freeZoom, 'Inactive Animate ignores new wheel input');
ui.setMode('animation'); await flush(); assert.equal(ui.view.zoom, freeZoom, 'Workspace return does not force Fit or round manual zoom');
key('0'); await flush();
let readWheelMode = false;
vp.listeners.get('wheel')[0]({ target: canvas, ctrlKey: true, clientX: point.x, clientY: point.y, preventDefault() {},
  get deltaMode() { readWheelMode = true; return 1; }, get deltaY() { assert(readWheelMode, 'Read deltaMode before browser-dependent delta units'); return -3; }, get deltaX() { assert(readWheelMode); return 0; } }); await flush();
assert(Math.abs(ui.view.zoom - Math.exp(48 * .005)) < 1e-12, 'Line-mode wheel zoom is normalized without quantizing');
const afterLineZoom = ui.view.zoom;
vp.fire('wheel', { ctrlKey: true, deltaY: 1, deltaMode: 2, clientX: point.x, clientY: point.y }); await flush();
assert(Math.abs(ui.view.zoom - afterLineZoom * Math.exp(-160 * .005)) < 1e-12, 'Page-mode wheel units normalize and clamp');
for (let n = 0; n < 20; n++) vp.fire('wheel', { ctrlKey: true, deltaY: -160, clientX: point.x, clientY: point.y });
assert.equal(ui.view.zoom, 12);
for (let n = 0; n < 20; n++) vp.fire('wheel', { ctrlKey: true, deltaY: 160, clientX: point.x, clientY: point.y });
assert.equal(ui.view.zoom, .05);
await enterZoom('137%'); const beforeHiddenZoom = nativePoint(); enforceHiddenZoomLayout = true;
vp.fire('wheel', { ctrlKey: true, deltaY: -40, clientX: point.x, clientY: point.y }); const pendingView = ui.view.zoom; ui.setMode('scene'); await flush();
assert.equal(ui.view.zoom, pendingView); assert.equal(hiddenZoomMeasurements, 0, 'Queued zoom never measures a hidden animation canvas');
ui.setMode('animation'); await flush();
assert.equal(ui.view.zoom, pendingView, 'Returning to Animate preserves its exact non-preset percentage');
assert(Math.abs(nativePoint().x - beforeHiddenZoom.x) < .6 && Math.abs(nativePoint().y - beforeHiddenZoom.y) < .6, 'Returning after a queued repaint applies its accepted native anchor');
assert.equal(hiddenZoomMeasurements, 0); enforceHiddenZoomLayout = false;
// Browser-like scroll clamping makes this fail if pasteboard padding is capped
// to512 native pixels or only half a viewport at very small zoom levels.
key('0'); await flush();
const lowAnchorRect = canvas.getBoundingClientRect(); point.x = lowAnchorRect.left + 40; point.y = lowAnchorRect.top + 35;
const beforeSmallZoom = nativePoint();
ui.zoomAt(.1, point.x, point.y); await flush();
assert(Math.abs(nativePoint().x - beforeSmallZoom.x) < 5.1 && Math.abs(nativePoint().y - beforeSmallZoom.y) < 5.1, '10% zoom keeps an off-center anchor within half a screen pixel');
const beforeFivePercent = nativePoint();
ui.zoomAt(.05, point.x, point.y); await flush();
assert(Math.abs(nativePoint().x - beforeFivePercent.x) < 10.1 && Math.abs(nativePoint().y - beforeFivePercent.y) < 10.1, '5% zoom retains an off-center anchor within half a screen pixel');
const overlay = nodes.get('animOverlayCanvas');
assert(overlay.width <= canvas.width + 1024 && overlay.height <= canvas.height + 1024, 'Large CSS pasteboard margins do not allocate a large overlay raster');
assert(parseFloat(overlay.style.left) > 0 && parseFloat(overlay.style.top) > 0, 'The bounded overlay stays aligned inside the larger pasteboard');
await enterZoom('137%');
const pinchRect = canvas.getBoundingClientRect(); point.x = pinchRect.left + 30 * ui.view.zoom; point.y = pinchRect.top + 25 * ui.view.zoom;
const pinchPoint = nativePoint(), pinchStart = ui.view.zoom;
vp.fire('wheel', { ctrlKey: true, deltaY: -12, clientX: point.x, clientY: point.y }); vp.fire('wheel', { ctrlKey: true, deltaY: -15, clientX: point.x, clientY: point.y }); await flush();
assert(Math.abs(ui.view.zoom - pinchStart * Math.exp(27 * .005)) < 1e-12, 'Queued pinch accumulates continuously');
assert(Math.abs(nativePoint().x - pinchPoint.x) < .6 && Math.abs(nativePoint().y - pinchPoint.y) < .6, 'Queued pinch preserves the native pointer anchor');
ui.fitCanvas(); await flush();
vp.fire('gesturestart', { clientX: point.x, clientY: point.y }); const safariStart = ui.view.zoom;
ui.render(); await flush();
vp.fire('gesturechange', { scale: 1.8, clientX: point.x, clientY: point.y });
const safariEnd = ui.view.zoom; vp.fire('gestureend', { clientX: point.x, clientY: point.y }); await flush();
assert.equal(ui.view.zoom, safariStart * Math.pow(1.8, 1.25), 'A redraw between Fit-view gesture start and movement does not cancel Animate pinch'); assert.equal(ui.view.zoom, safariEnd, 'Safari pinch completion never snaps its percentage');
key('0'); await flush(); assert.equal(ui.view.zoom, 1);
key('+'); await flush(); assert.equal(ui.view.zoom, 1.1);
key('-'); await flush(); assert.equal(ui.view.zoom, 1);
key('f'); assert(ui.view.fit);
assert.equal(JSON.stringify(engine.project), beforeZoomProject, 'Zoom fields, wheel input, and panning never modify the animation project');
// A whole world must not allocate a world-sized transient overlay or repaint
// its immutable terrain for every change of animation frame.
const largeWorldData = JSON.parse(fs.readFileSync(path.join(root, 'assets/world-maps.json'), 'utf8'));
assets.push(...largeWorldData.assets);
for (const sheet of Object.values(largeWorldData.sheets)) for (const piece of sheet.pieces) pieceMap.set(piece.id, piece);
const worldPiece = largeWorldData.sheets['world-hyrule'].pieces[0];
const worldBackdrop = { ...worldPiece, id: 'world-backdrop', kind: 'sprite', pieceId: worldPiece.id, x: 0, y: 0, scale: 1, layer: 'terrain' };
const worldActor = { ...base, id: 'world-actor', x: 2496, y: 1584, layer: 'objects' };
const worldForeground = { ...base, id: 'world-front', x: 2550, y: 1600, layer: 'objects' };
const sceneDraws = [];
adapter.drawSceneToContext = (ctx, scene, options = {}) => sceneDraws.push({ target: ctx === canvas.getContext() ? 'backdrop' : 'overlay', ids: Array.from(scene.objects, object => object.id), options });
engine.addClip({ width: 4992, height: 3168, exportScale: 1, duration: 12, fps: 12, worldId: 'hyrule', objects: [worldBackdrop, worldActor, worldForeground],
  tracks: [{ id: 'backdrop-lock', objectId: worldBackdrop.id, locked: true, keys: [] }, { id: 'world-motion', objectId: worldActor.id,
    keys: [{ frame: 0, values: { x: 2496 }, easing: 'linear' }, { frame: 6, values: { x: 2528 }, easing: 'linear' }] }] });
ui.fitCanvas(); await flush();
assert.equal(canvas.width, 4992); assert.equal(canvas.height, 3168, 'The backdrop keeps its exact native world pixels');
assert.equal(overlay.width, vp.clientWidth); assert.equal(overlay.height, vp.clientHeight, 'The dynamic world raster is bounded by the visible viewport');
assert.deepEqual(sceneDraws.find(draw => draw.target === 'backdrop').ids, [worldBackdrop.id], 'Only the static drawing prefix is cached below changing pieces');
const backdropDraws = sceneDraws.filter(draw => draw.target === 'backdrop').length;
engine.seek(1); await flush();
assert.equal(sceneDraws.filter(draw => draw.target === 'backdrop').length, backdropDraws, 'Advancing the world animation reuses the native static backdrop');
assert(sceneDraws.some(draw => draw.target === 'overlay' && draw.ids.join(',') === 'world-actor,world-front' && draw.options.clear === false), 'Animated and later static pieces preserve their order on the bounded overlay');
const beforePanRaster = sceneDraws.length; vp.scrollLeft += 50; vp.fire('scroll'); await flush();
assert(sceneDraws.length > beforePanRaster, 'Native panning refreshes the visible animated region');
assert.equal(sceneDraws.filter(draw => draw.target === 'backdrop').length, backdropDraws, 'Panning never repaints the complete world');
engine.configureClip({ color: '#112244' }); await flush();
assert.equal(sceneDraws.filter(draw => draw.target === 'backdrop').length, backdropDraws + 1, 'A backdrop edit invalidates the cache once');
engine.play(); ui.focusArea({ x: 2460, y: 1540, w: 160, h: 120 }); await flush();
assert(engine.playing, 'Exploring a world animation keeps playback running'); engine.pause();
const exploredCamera = ui.exportCamera, existingWorldObjects = JSON.stringify(engine.currentClip.objects);
engine.selectObject(worldActor.id); nodes.get('animAddPiece').click(); await flush();
const addedInView = engine.currentClip.objects.at(-1);
assert(Math.abs(addedInView.x + addedInView.sw / 2 - exploredCamera.x - exploredCamera.w / 2) <= .5 &&
  Math.abs(addedInView.y + addedInView.sh / 2 - exploredCamera.y - exploredCamera.h / 2) <= .5, 'Add to canvas places a new actor at the explored camera center, on whole native pixels');
assert.equal(JSON.stringify(engine.currentClip.objects.slice(0, -1)), existingWorldObjects, 'Adding a visible actor leaves every existing world piece unchanged');
engine.undo();
ui.fitCanvas(); await flush(); nodes.get('animExportFormat').value = 'gif';
const projectBeforeCamera = JSON.stringify(engine.project); ui.openExport(); await flush();
assert.equal(nodes.get('animExportArea').value, 'view'); assert.equal(nodes.get('animExportScale').value, '1');
assert(ui.exportCamera.w <= 1024 && ui.exportCamera.h <= 576, 'The current-view export camera is capped in native pixels');
assert(!nodes.get('animStartExport').disabled, 'A default world camera GIF fits the export budget');
nodes.get('animExportArea').value = 'whole'; nodes.get('animExportArea').fire('change');
assert(nodes.get('animStartExport').disabled, 'Oversized whole-world GIFs are blocked before rendering');
assert.match(nodes.get('animExportCameraHint').textContent, /Current view/);
assert.equal(JSON.stringify(engine.project), projectBeforeCamera, 'Export framing never changes the editable world or animation');
nodes.get('animExportDialog').close(); nodes.get('animExportDialog').fire('close');

// A distant large-world camera leaves a viewport-sized absolute overlay far
// into the pasteboard. New worlds and same-slot rerolls must fit the actual
// canvas, including when image decoding and viewport layout settle later.
const centerError = () => {
  const frame = canvas.getBoundingClientRect(), area = vp.getBoundingClientRect();
  return { x: frame.left + frame.width / 2 - area.left - vp.clientWidth / 2,
    y: frame.top + frame.height / 2 - area.top - vp.clientHeight / 2 };
};
ui.focusArea({ x: 4400, y: 2800, w: 90, h: 80 }); await flush();
assert(parseFloat(overlay.style.left) > 1000 && parseFloat(overlay.style.top) > 1000, 'The regression starts with a genuinely distant viewport overlay');
const prepareBeforeFit = adapter.prepareScene;
let releaseFitImages;
const fitImagesReady = new Promise(resolve => { releaseFitImages = resolve; });
adapter.prepareScene = () => fitImagesReady;
ui.zoomAt(1.75, point.x, point.y); await flush();
engine.replaceClip({ ...engine.currentClip, name: 'Rerolled world review' });
ui.fitCanvas(); vp.clientWidth = 570; vp.clientHeight = 120; await flush();
releaseFitImages(); adapter.prepareScene = prepareBeforeFit; await flush();
assert(ui.view.fit);
assert(Math.abs(centerError().x) <= .51 && Math.abs(centerError().y) <= .51, 'A same-slot world reroll discards stale pan and queued zoom anchors, then centers after async layout');
const fittedScroll = { x: vp.scrollLeft, y: vp.scrollTop };
ui.render(); await flush();
assert(Math.abs(vp.scrollLeft - fittedScroll.x) <= .51 && Math.abs(vp.scrollTop - fittedScroll.y) <= .51, 'Playback redraws preserve the completed fitted view');
const projectBeforeNewPan = JSON.stringify(engine.project);
const panArea = vp.getBoundingClientRect();
vp.fire('wheel', { deltaX: 35, deltaY: 20, clientX: panArea.left + vp.clientWidth / 2, clientY: panArea.top + vp.clientHeight / 2 });
vp.scrollLeft += 35; vp.scrollTop += 20; vp.fire('scroll'); await flush();
const movedCenter = centerError();
ui.render(); await flush();
assert(Math.abs(centerError().x - movedCenter.x) <= .51 && Math.abs(centerError().y - movedCenter.y) <= .51, 'Ordinary panning stays where the user leaves it instead of recentering during redraw');
assert(Math.abs(movedCenter.x) > 20 && Math.abs(movedCenter.y) > 10);
assert.equal(JSON.stringify(engine.project), projectBeforeNewPan, 'Fitting and manual navigation never edit the animation');
// A newly created clip also starts centered after a far-away camera.
engine.addClip({ width: 4992, height: 3168, exportScale: 1, duration: 12, fps: 12, objects: [worldBackdrop] });
ui.fitCanvas(); await flush();
assert(Math.abs(centerError().x) <= .51 && Math.abs(centerError().y) <= .51, 'A new world clip opens centered after panning a previous map');
vp.clientWidth = 640; vp.clientHeight = 390; ui.fitCanvas(); await flush();
// Dragging uses the same recipe as Add, captured before any selection or
// control refresh. Compare actual pose cadence and relative motion frame by
// frame, not just the recipe label.
ui.setEditorMode('simple'); engine.addClip({ width: 240, height: 160, exportScale: 2, duration: 48, fps: 12, objects: [] }); await flush();
nodes.get('animCategory').value = 'characters'; nodes.get('animCategory').fire('change');
nodes.get('animSource').value = '6369'; nodes.get('animSource').fire('change'); await flush();
const chooseWalk = () => nodes.get('animPoseGrid').descendants().find(node => node.dataset.preset === 'link-walk-right').fire('click');
const transfer = () => { const data = new Map(); return { get types() { return [...data.keys()]; }, setData: (type, value) => data.set(type, value), getData: type => data.get(type) || '', setDragImage() {} }; };
const placedAnimation = () => {
  const actor = engine.currentClip.objects.at(-1), first = engine.getObjectAt(actor.id, 0);
  return { recipe: simple.getRecipe(actor.id), frames: Array.from({ length: 48 }, (_, frame) => {
    const value = engine.getObjectAt(actor.id, frame);
    return { pieceId: value.pieceId, x: value.x - first.x, y: value.y - first.y, sw: value.sw, sh: value.sh };
  }) };
};
chooseWalk(); nodes.get('animLibrarySpeed').value = 'fast'; nodes.get('animLibraryMotion').value = 'right';
nodes.get('animAddPiece').click(); await flush(); const buttonAnimation = placedAnimation();
engine.undo(); await flush(); assert.equal(engine.currentClip.objects.length, 0, 'Add plus its animation is one Undo action');
const actionCard = nodes.get('animPoseGrid').descendants().find(node => node.dataset.preset === 'link-walk-right'), actionTransfer = transfer();
actionCard.fire('dragstart', { dataTransfer: actionTransfer });
nodes.get('animLibrarySpeed').value = 'slow'; nodes.get('animLibraryMotion').value = 'none';
vp.fire('drop', { dataTransfer: actionTransfer, clientX: 280, clientY: 200 }); await flush();
assert.deepEqual(placedAnimation(), buttonAnimation, 'Dragged actions retain the same speed, pose cadence and movement as Add, even if controls refresh during the drag');
engine.undo(); await flush(); assert.equal(engine.currentClip.objects.length, 0, 'A dragged ready action also has one complete Undo');
nodes.get('animLibrarySpeed').value = 'normal'; nodes.get('animLibraryMotion').value = 'down'; chooseWalk();
nodes.get('animBrowsePoses').click(); await flush();
const poseCard = nodes.get('animPoseGrid').descendants().find(node => node.dataset.piece), poseTransfer = transfer();
poseCard.fire('dragstart', { dataTransfer: poseTransfer });
vp.fire('drop', { dataTransfer: poseTransfer, clientX: 300, clientY: 210 }); await flush();
assert.equal(simple.getRecipe(engine.selectedObjectId).presetId, 'link-walk-right', 'Dragging a pose retains the chosen compatible action instead of resetting it to Still');
assert.equal(simple.getRecipe(engine.selectedObjectId).speed, 'normal'); assert.equal(simple.getRecipe(engine.selectedObjectId).motion, 'down');
const legacyTransfer = transfer(); legacyTransfer.setData('application/x-minish-animation-piece', poseCard.dataset.piece);
vp.fire('drop', { dataTransfer: legacyTransfer, clientX: 320, clientY: 220 }); await flush();
assert.equal(simple.getRecipe(engine.selectedObjectId).presetId, 'link-walk-right', 'A piece-only drag uses current Add settings instead of forcing Still');
const malformedTransfer = transfer(); malformedTransfer.setData('application/x-minish-animation-piece', poseCard.dataset.piece); malformedTransfer.setData('application/x-minish-animation-recipe', '{broken');
const beforeMalformedDrop = JSON.stringify(engine.project);
vp.fire('drop', { dataTransfer: malformedTransfer, clientX: 320, clientY: 220 }); await flush();
assert.equal(JSON.stringify(engine.project), beforeMalformedDrop, 'A malformed dragged recipe leaves the animation intact');
const combatAction = combat.actions.find(action => action.sourceId === '6369' && action.weapon === 'sword');
nodes.get('animBrowseActions').click(); await flush();
const combatCard = nodes.get('animPoseGrid').descendants().find(node => node.dataset.preset === combatAction.id);
assert(combatCard, 'Reviewed weapon actions are available in the Simple action collection');
combatCard.fire('click'); nodes.get('animLibrarySpeed').value = 'fast'; nodes.get('animLibraryMotion').value = 'outback';
const combatTransfer = transfer(); combatCard.fire('dragstart', { dataTransfer: combatTransfer });
vp.fire('drop', { dataTransfer: combatTransfer, clientX: 310, clientY: 190 }); await flush();
assert.equal(simple.getRecipe(engine.selectedObjectId).presetId, combatAction.id, 'Dragging a new combat action applies its complete ready animation');
assert.equal(simple.getRecipe(engine.selectedObjectId).motion, 'outback');
const timelineCount = engine.currentClip.objects.length;
ui.setEditorMode('timeline'); engine.seek(7); vp.fire('drop', { dataTransfer: legacyTransfer, clientX: 290, clientY: 180 }); await flush();
assert.equal(engine.currentClip.objects.length, timelineCount + 1); assert(!engine.currentClip.objects.at(-1).simpleAnimation, 'Timeline pose drops retain manual keyframe editing');
// Compound actions must paste all the way through the final effect frame,
// even when the actor's own sparse track ends earlier than its projectile.
engine.addClip({ width: 240, height: 160, exportScale: 2, duration: 48, fps: 12, objects: [] });
const bombAction = combat.actions.find(action => action.sourceId === '6369' && action.weapon === 'bomb'), bombPose = pieceMap.get(bombAction.representativePoseId);
const bombActor = engine.addObject({ ...bombPose, kind: 'sprite', pieceId: bombPose.id, pieceName: bombPose.name, x: 95, y: 70, scale: 1, layer: 'objects' });
simple.apply(bombActor.id, { presetId: bombAction.id, speed: 'normal', motion: 'none' });
engine.selectObject(bombActor.id); ui.copySelected();
engine.addClip({ width: 240, height: 160, exportScale: 2, duration: 12, fps: 12, objects: [] });
const existingWalker = engine.addObject({ ...pose, kind: 'sprite', pieceId: pose.id, x: 20, y: 40, scale: 1, layer: 'objects' });
simple.apply(existingWalker.id, { presetId: 'link-walk-away', motion: 'up', distance: 32 });
const beforeCompoundPaste = JSON.stringify(engine.project);
const pastedBomb = ui.pasteSelected(); await flush();
assert(pastedBomb, 'A ready bomb action pastes into a shorter clip');
assert.equal(engine.currentClip.duration, 48, 'Paste includes the final companion frame when extending the clip');
assert(simple.ownedCompanions(pastedBomb.id).length >= 2, 'Ready paste recreates the projectile and explosion once');
assert(!simple.inspect(pastedBomb.id).needsReplacement, 'Pasted owned effects remain part of their ready action');
assert.equal(engine.currentClip.objects.find(object => object.id === existingWalker.id).simpleAnimation.duration, 48, 'Existing unmodified ready loops follow the extended duration');
engine.undo(); assert.equal(JSON.stringify(engine.project), beforeCompoundPaste, 'Compound paste and duration refresh are one Undo');
engine.switchClip(engine.project.clips.at(-2).id);
const customEffect = simple.ownedCompanions(bombActor.id)[0];
engine.setKey(customEffect.id, 47, { x: 177, visible: true }); engine.selectObject(bombActor.id); ui.copySelected();
engine.addClip({ width: 240, height: 160, exportScale: 2, duration: 12, fps: 12, objects: [] });
const customPaste = ui.pasteSelected(); await flush();
assert(customPaste && engine.currentClip.duration === 48, 'Custom compound paste also includes the last effect key');
const customPastedFx = simple.ownedCompanions(customPaste.id).find(object => object.simpleCompanion.role === customEffect.simpleCompanion.role);
assert.equal(engine.getTrack(customPastedFx.id).keys.find(key => key.frame === 47).values.x, 185, 'Custom effect keys keep their timing and receive the same placement offset');
assert(simple.inspect(customPaste.id).needsReplacement, 'Custom effect edits stay custom after paste');
engine.selectObject(customPastedFx.id); ui.setEditorMode('timeline'); key('d', document.body, { metaKey: true });
assert(!engine.currentClip.objects.find(object => object.id === engine.selectedObjectId).simpleCompanion, 'Duplicating an effect alone in Timeline detaches its ownership');
// Rotation controls affect the complete ready action in Simple, and make
// explicit held angle keys in Timeline. Picking uses the oriented crop rather
// than accepting empty corners of its enlarged axis-aligned selection box.
ui.setEditorMode('simple'); engine.addClip({ width: 240, height: 160, duration: 48, fps: 12, objects: [] });
const rotating = engine.addObject({ ...pose, kind: 'sprite', pieceId: pose.id, pieceName: pose.name, x: 90, y: 70, scale: 1, layer: 'objects' });
simple.apply(rotating.id, { presetId: 'link-walk-away', motion: 'none' }); await flush();
const beforeRotate = JSON.stringify(engine.project);
nodes.get('animRotateRight').click(); await flush();
assert.equal(engine.currentClip.objects.find(object => object.id === rotating.id).rotation, 45, 'Clockwise rotates the whole Simple sprite action by 45 degrees');
assert.equal(nodes.get('animObjectRotation').value, '45');
for (const frame of [0, 5, 23, 47]) assert.equal(engine.getObjectAt(rotating.id, frame).rotation, 45, 'All ready-action frames retain the chosen angle');
engine.undo(); assert.equal(JSON.stringify(engine.project), beforeRotate, 'One rotation click is one complete Undo');
nodes.get('animRotateLeft').click(); await flush();
assert.equal(engine.getObjectAt(rotating.id, 0).rotation, 315, 'Counterclockwise wraps from zero to 315 degrees');
nodes.get('animObjectRotation').value = '0'; nodes.get('animObjectRotation').fire('change'); await flush();
for (let turn = 0; turn < 8; turn++) nodes.get('animRotateRight').click(); await flush();
assert.equal(engine.getObjectAt(rotating.id, 0).rotation, 0, 'Eight clockwise steps return to the original direction');
nodes.get('animObjectRotation').value = '45'; nodes.get('animObjectRotation').fire('change'); await flush();
const rotatedObject = engine.getObjectAt(rotating.id, 0), w = rotatedObject.sw, h = rotatedObject.sh;
const center = { x: rotatedObject.x + w / 2, y: rotatedObject.y + h / 2 }, half = (w + h) / Math.sqrt(8);
const clickNative = (x, y) => { const rect = canvas.getBoundingClientRect(); canvas.fire('pointerdown', { currentTarget: canvas, clientX: rect.left + x * ui.view.zoom, clientY: rect.top + y * ui.view.zoom }); canvas.fire('pointerup', { currentTarget: canvas }); };
clickNative(center.x - half + .1, center.y - half + .1); await flush();
assert.equal(engine.selectedObjectId, null, 'Empty corners of a rotated bounding box do not select the sprite');
const dx = 1 - w / 2, dy = 1 - h / 2;
clickNative(center.x + (dx - dy) / Math.sqrt(2), center.y + (dx + dy) / Math.sqrt(2)); await flush();
assert.equal(engine.selectedObjectId, rotating.id, 'Visible rotated crop extensions remain selectable beyond the original unrotated box');
ui.setEditorMode('timeline'); engine.seek(5); nodes.get('animAutoKey').checked = true;
const beforeAngleKey = JSON.stringify(engine.project); nodes.get('animRotateRight').click(); await flush();
assert.equal(engine.getTrack(rotating.id).keys.find(key => key.frame === 5).values.rotation, 90, 'Timeline rotation creates an angle key at the playhead');
assert.equal(engine.getObjectAt(rotating.id, 0).rotation, 45, 'Recording a later rotation preserves earlier frames');
engine.undo(); assert.equal(JSON.stringify(engine.project), beforeAngleKey, 'A recorded rotation key is also one Undo');
nodes.get('animObjectRotation').value = '315'; nodes.get('animObjectRotation').fire('change'); await flush();
assert.equal(engine.getObjectAt(rotating.id, 5).rotation, 315, 'The angle menu records the selected exact direction');
ui.setEditorMode('simple'); await flush();
for (const id of ['animObjectRotation', 'animRotateLeft', 'animRotateRight']) assert(nodes.get(id).disabled, 'Simple protects existing custom angle keys');
const dialogue = engine.addObject({ kind: 'dialogue', text: 'Turn the hero', x: 20, y: 20, w: 100, h: 40 }); await flush();
for (const id of ['animObjectRotation', 'animRotateLeft', 'animRotateRight']) assert(nodes.get(id).disabled, 'Sprite rotation is unavailable for dialogue');
const beforeDialogueRotate = JSON.stringify(engine.project); nodes.get('animRotateLeft').fire('click');
assert.equal(JSON.stringify(engine.project), beforeDialogueRotate, 'A dialogue cannot acquire sprite rotation through the control callback');
console.log('PASS: animation shortcuts, compound-action clipboard and deletion Undo, 45-degree rotation controls and oriented picking, continuous anchored zoom, exact percentage inputs, modal/mode safety, centered worlds, bounded rendering, and drag/Add parity for poses, movement, speed and combat actions.');
