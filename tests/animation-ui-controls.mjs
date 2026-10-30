import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const curated = read('assets/curated.json'), bosses = read('assets/full-bosses.json');
const assets = [...read('assets/catalog.json').assets, ...read('assets/pieces.json').assets, ...read('assets/sprites.json').assets, ...curated.assets, ...bosses.assets];
const pieceMap = new Map(Object.values({ ...curated.sheets, ...bosses.sheets }).flatMap(sheet => sheet.pieces).map(piece => [piece.id, piece]));
const nodes = new Map(), handlers = new Map(), frames = [], timers = new Map();
let document, timer = 0;
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.dataset = {}; this.style = {}; this.className = ''; this.listeners = new Map(); this.attributes = new Map();
    this.width = 240; this.height = 160; this.clientWidth = 640; this.clientHeight = 390; this.scrollLeft = this.scrollTop = 0; this.hidden = this.disabled = this.checked = false;
    this.classList = { contains: value => this.className.split(' ').includes(value), toggle: (value, enabled) => { const set = new Set(this.className.split(' ').filter(Boolean)); const next = enabled ?? !set.has(value); next ? set.add(value) : set.delete(value); this.className = [...set].join(' '); return next; }, add: (...values) => values.forEach(value => this.classList.toggle(value, true)), remove: (...values) => values.forEach(value => this.classList.toggle(value, false)) };
  }
  get value() { return this._value || (this.tagName === 'SELECT' ? this.children[0]?.value || '' : ''); }
  set value(value) { this._value = String(value); }
  get options() { return this.children; }
  getContext() { return new Proxy({}, { get: (_, prop) => prop === 'measureText' ? text => ({ width: text.length * 6 }) : () => {} }); }
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
document = { body: new Element('body'), activeElement: null, getElementById: id => { assert(nodes.has(id), 'Unknown UI element: ' + id); return nodes.get(id); }, createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'), querySelector: () => null,
  addEventListener: (name, fn) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }, dispatchEvent() {} };
nodes.get('animCategory').value = 'characters'; nodes.get('animLibrarySpeed').value = 'normal'; nodes.get('animLibraryMotion').value = 'none';
const adapter = { assets, getAsset: id => assets.find(asset => String(asset.id) === String(id)), getPiece: id => pieceMap.get(id), getPieceSource: async () => ({ image: {}, sx: 0, sy: 0, sw: 16, sh: 24 }), prepareScene: async () => {}, drawSceneToContext() {}, render() {} };
const storage = new Map();
const sandbox = { document, MINISH_STUDIO: adapter, MINISH_CURATED: curated, MINISH_BOSSES: bosses, MINISH_ASSETS: { assets }, console,
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
ui.fitCanvas(); await flush();
const canvas = nodes.get('animationCanvas'), vp = nodes.get('animStageViewport'), before = canvas.getBoundingClientRect(), point = { x: before.left + 30 * ui.view.zoom, y: before.top + 25 * ui.view.zoom };
const ordinary = vp.fire('wheel', { deltaY: 20, clientX: point.x, clientY: point.y }); assert(!ordinary.defaultPrevented, 'Ordinary wheel remains viewport scrolling');
vp.fire('wheel', { ctrlKey: true, deltaY: -12, clientX: point.x, clientY: point.y }); vp.fire('wheel', { ctrlKey: true, deltaY: -15, clientX: point.x, clientY: point.y }); await flush();
let after = canvas.getBoundingClientRect(); assert(Math.abs((point.x - after.left) / ui.view.zoom - 30) < .6, 'Rapid queued pinch retains the horizontal native anchor'); assert(Math.abs((point.y - after.top) / ui.view.zoom - 25) < .6, 'Rapid queued pinch retains the vertical native anchor');
for (const [id, task] of [...timers]) if (task.delay === 180) { timers.delete(id); task.fn(); } await flush();
assert(Number.isInteger(ui.view.zoom)); after = canvas.getBoundingClientRect(); assert(Number.isInteger(after.left) && Number.isInteger(after.top), 'Settled pixel art sits on whole CSS pixels');
vp.fire('gesturestart', { clientX: point.x, clientY: point.y }); vp.fire('gesturechange', { scale: 1.8, clientX: point.x, clientY: point.y }); vp.fire('gestureend', { clientX: point.x, clientY: point.y }); await flush(); assert(Number.isInteger(ui.view.zoom), 'Safari gesture ends on integer enlargement');
key('0'); assert.equal(ui.view.zoom, 1); await flush();
const one = canvas.getBoundingClientRect(), exactAnchor = { x: one.left + 18, y: one.top + 27 };
ui.zoomAt(2, exactAnchor.x, exactAnchor.y); await flush(); const two = canvas.getBoundingClientRect();
assert(Math.abs((exactAnchor.x - two.left) / ui.view.zoom - 18) < .26, '1x to 2x preserves the exact horizontal anchor within half a CSS pixel');
assert(Math.abs((exactAnchor.y - two.top) / ui.view.zoom - 27) < .26, '1x to 2x preserves the exact vertical anchor within half a CSS pixel');
key('0'); key('+'); assert.equal(ui.view.zoom, 2); key('f'); assert(ui.view.fit);
console.log('PASS: animation UI shortcuts, piece-list deletion/native typing, copy/paste with recipe metadata, whole-clip Undo, queued pinch anchoring, Safari gestures, and crisp settled zoom.');
