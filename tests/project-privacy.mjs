// Run: node tests/project-privacy.mjs
// The real scene and animation code runs in independent browser-storage contexts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const metadata = ['assets/catalog.json', 'assets/pieces.json', 'assets/curated.json'].map(name => JSON.parse(read(name)));
const assets = metadata.flatMap(data => data.assets).map(({ dataUrl, thumbnailDataUrl, ...asset }) => asset);
const publicScripts = ['examples/starter.js', 'controls.js', 'studio.js', 'animation-engine.js'];
const scripts = publicScripts.map(name => [name, read(name)]);
const freshId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

async function browser(storage = new Map()) {
  const nodes = new Map(), datasets = [], timers = new Map(), events = new Map(), blobs = new Map(), downloads = [];
  let timer = 0, document;
  class Classes {
    constructor(owner) { this.owner = owner; }
    contains(value) { return this.owner.className.split(/\s+/).includes(value); }
    add(...values) { this.owner.className = [...new Set([...this.owner.className.split(/\s+/).filter(Boolean), ...values])].join(' '); }
    remove(...values) { this.owner.className = this.owner.className.split(/\s+/).filter(value => !values.includes(value)).join(' '); }
    toggle(value, force) { const on = force ?? !this.contains(value); on ? this.add(value) : this.remove(value); return on; }
  }
  class Element {
    constructor(tag = 'div', id = '') { Object.assign(this, { tagName: tag.toUpperCase(), id, value: '', textContent: '', className: '', dataset: {}, style: {}, children: [], listeners: {}, width: 52, height: 52, clientWidth: 760, clientHeight: 700 }); this.classList = new Classes(this); }
    append(...items) { for (const child of items) { this.children.push(child); child.parent = this; } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(key, callback) { (this.listeners[key] ||= []).push(callback); }
    closest() { return null; }
    querySelector(selector) { return this.children.find(child => child.tagName === selector.toUpperCase()) || null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height }; }
    getContext() { return new Proxy({ measureText: text => ({ width: String(text).length * 6 }), getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) }, { get: (object, key) => object[key] || (() => {}) }); }
    click() { if (this.tagName === 'A') downloads.push({ href: this.href, filename: this.download }); for (const callback of this.listeners.click || []) callback({ target: this }); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; } close() { this.open = false; }
    setPointerCapture() {} scrollTo() {} select() {}
  }
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const node = new Element(match[1], match[3]); node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || ''; node.className = match[2].match(/\bclass="([^"]*)"/)?.[1] || ''; nodes.set(node.id, node);
  }
  for (const match of html.matchAll(/<button\b([^>]*\bdata-(tool|layer|size)="([^"]+)"[^>]*)>/gi)) { const node = new Element('button'); node.dataset[match[2]] = match[3]; datasets.push(node); }
  nodes.get('snapSize').value = '16'; nodes.get('objectScale').value = '1';
  const library = new Element('aside');
  document = {
    body: new Element('body'), fonts: { ready: Promise.resolve() }, activeElement: null,
    getElementById: id => nodes.get(id) || null, createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
    querySelector: selector => selector === '.library' ? library : selector === 'dialog[open]' ? [...nodes.values()].find(node => node.open) || null : null,
    querySelectorAll: selector => { const key = selector.match(/^\[data-(.+)\]$/)?.[1]; return key ? datasets.filter(node => node.dataset[key] != null) : []; },
    addEventListener: (name, callback) => { (events.get(name) || (events.set(name, []), events.get(name))).push(callback); }, dispatchEvent() {}
  };
  const networkAttempts = [];
  const network = (...args) => { networkAttempts.push(args); assert.fail('Personal project operations must not make network requests'); };
  const dimensions = new Map(assets.map(asset => [asset.path, [asset.width, asset.height]]));
  class Image { set src(value) { this._src = value; [this.width, this.height] = dimensions.get(value) || [224, 48]; queueMicrotask(() => this.onload?.()); } get src() { return this._src; } }
  const sandbox = {
    document, Image, Blob, TextEncoder, Uint8Array, Uint8ClampedArray, Uint32Array, DataView, Map, Set, console,
    navigator: { platform: 'Linux x86_64' },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout: (callback, milliseconds) => { timers.set(++timer, { callback, milliseconds }); return timer; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { queueMicrotask(callback); return 1; }, cancelAnimationFrame() {},
    addEventListener: (name, callback) => { (events.get(name) || (events.set(name, []), events.get(name))).push(callback); },
    fetch: network, XMLHttpRequest: network, WebSocket: network,
    URL: { createObjectURL: blob => { const url = 'blob:local-' + blobs.size; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
    MINISH_ASSETS: { assets: assets.filter(asset => /^\d+$/.test(asset.id)), stats: {} },
    MINISH_PIECES: { assets: assets.filter(asset => !/^\d+$/.test(asset.id)), sheets: {} }
  };
  sandbox.window = sandbox; sandbox.navigator.sendBeacon = network;
  const context = vm.createContext(sandbox);
  for (const [name, code] of scripts) vm.runInContext(code, context, { filename: name });
  sandbox.MINISH_ANIMATION.init(sandbox.MINISH_STUDIO);
  await new Promise(resolve => setImmediate(resolve));
  return {
    storage, scene: sandbox.MINISH_STUDIO, animation: sandbox.MINISH_ANIMATION, starter: sandbox.MINISH_STARTER,
    save() { for (const [id, item] of [...timers]) if (item.milliseconds === 500 || item.milliseconds === 400) { timers.delete(id); item.callback(); } },
    close() { for (const callback of events.get('beforeunload') || []) callback(); },
    downloads, blobs, networkAttempts
  };
}

const markerA = 'private-a-' + freshId(), markerB = 'private-b-' + freshId();
const profileA = await browser(), profileB = await browser();
for (const [profile, marker] of [[profileA, markerA], [profileB, markerB]]) {
  const project = profile.scene.project; project.name = marker; project.slides[0].objects.find(object => object.kind === 'dialogue').text = marker + ' scene dialogue';
  profile.scene.loadProject(project);
  profile.animation.renameProject(marker + ' animation');
  profile.animation.addObject({ kind: 'dialogue', x: 8, y: 8, w: 180, h: 48, text: marker + ' animation dialogue', fontSize: 12, color: '#ffffff', box: true, scale: 1, layer: 'overlay' });
  profile.save(); profile.close();
}
assert(profileA.storage.has('minish-cap-studio-v1') && profileA.storage.has('minish-maker-animation-v1'));
assert(!JSON.stringify([...profileA.storage]).includes(markerB));
assert(!JSON.stringify([...profileB.storage]).includes(markerA));
for (const [original, own, other] of [[profileA, markerA, markerB], [profileB, markerB, markerA]]) {
  const reopened = await browser(original.storage);
  assert.equal(reopened.scene.project.name, own, 'Reopening restores that profile’s scene');
  assert.equal(reopened.animation.project.name, own + ' animation', 'Reopening restores that profile’s animation');
  assert(JSON.stringify(reopened.scene.project).includes(own + ' scene dialogue'));
  assert(JSON.stringify(reopened.animation.project).includes(own + ' animation dialogue'));
  assert(!JSON.stringify(reopened.scene.project).includes(other) && !JSON.stringify(reopened.animation.project).includes(other));
  assert.equal(reopened.networkAttempts.length, 0);
}
const visitor = await browser();
assert.equal(visitor.scene.project.name, visitor.starter.name, 'A new visitor gets the bundled public examples');
assert.equal(visitor.animation.project.name, 'My animated adventure');
for (const marker of [markerA, markerB]) {
  assert(!JSON.stringify(visitor.scene.project).includes(marker) && !JSON.stringify(visitor.animation.project).includes(marker));
  for (const [, code] of scripts) assert(!code.includes(marker), 'Private project text never changes the distributed application');
}
profileA.scene.saveProject();
const download = profileA.downloads.at(-1);
assert(download.filename.endsWith('.minish.json') && download.href.startsWith('blob:'));
assert((await profileA.blobs.get(download.href).text()).includes(markerA), 'Save project makes a local downloadable backup');
for (const profile of [profileA, profileB, visitor]) assert.equal(profile.networkAttempts.length, 0, 'Even a caught network failure must not hide an attempted project upload');
console.log('PASS: independent scene/animation autosaves, same-profile reopen, separate-visitor isolation, public starter defaults, local-only project export, and no project network requests.');
