import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'scene-composer-ui.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = new Map(), calls = [], documentListeners = new Map();
let document, selected = null, sceneFrame = null, importError = null;
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map();
    this.hidden = false; this.disabled = false; this.checked = false; this.open = false; this.className = ''; this.textContent = '';
    this.classList = { toggle: (name, state) => { const names = new Set(this.className.split(' ').filter(Boolean)); const on = state ?? !names.has(name); on ? names.add(name) : names.delete(name); this.className = [...names].join(' '); return on; }, add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false) };
  }
  get value() { return this._value || ''; }
  set value(value) { this._value = String(value); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  async fire(type, extra = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; for (const listener of this.listeners.get(type) || []) await listener(event); return event; }
  click() { return this.fire('click'); }
  focus() { document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    if (selector.startsWith('input[name=')) return this.children.filter(child => child.name === 'picturePlacement' && (!selector.includes(':checked') || child.checked));
    return this.children.filter(child => selector.split(',').some(tag => child.tagName === tag.trim().toUpperCase()));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getContext() { return { clearRect() {}, fillRect() {} }; }
}
for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
  const id = /\bid="([^"]+)"/.exec(match[2])?.[1]; if (!id) continue;
  assert(!nodes.has(id), 'HTML IDs are unique: ' + id);
  const element = new Element(match[1], id); nodes.set(id, element);
  element.hidden = /\shidden(?:\s|$)/.test(match[2]);
}
const $ = id => nodes.get(id);
const current = new Element('input'), carousel = new Element('input');
current.name = carousel.name = 'picturePlacement'; current.value = 'current'; current.checked = true; carousel.value = 'carousel';
const pictureMarkup = html.slice(html.indexOf('<dialog id="picturesDialog"'), html.indexOf('<dialog id="framesDialog"'));
$('picturesDialog').append(current, carousel, ...[...nodes.values()].filter(node => node.id !== 'picturesDialog' && pictureMarkup.includes('id="' + node.id + '"')));
$('frameTarget').value = 'scene'; $('frameSize').value = '0'; $('pictureAspectLock').checked = true;
document = { activeElement: null, getElementById: $, createElement: tag => new Element(tag), addEventListener(type, listener) { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(listener); } };
const frameWindow = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'scene-frames.js'), 'utf8'), { window: frameWindow });
const frames = { styles: frameWindow.MINISH_FRAMES.styles, normalize: frameWindow.MINISH_FRAMES.normalize, draw() {} };
const studio = {
  get selectedObject() { return selected; }, getScene: () => ({ frame: sceneFrame }), getImageMetadata: () => ({ width: 800, height: 600 }),
  async importImages(files, options) { calls.push(['import', files, plain(options)]); if (importError) throw new Error(importError); selected = { id: 'photo', kind: 'image', imageId: 'image1', w: 200, h: 150, rotation: 0, keepAspect: true }; return { count: files.length, slideIds: ['scene1'] }; },
  updateSelectedImage(patch) { calls.push(['update', plain(patch)]); Object.assign(selected, patch); if (patch.width) selected.w = patch.width; if (patch.height) selected.h = patch.height; },
  fitSelectedImage(mode) { calls.push(['fit', mode]); },
  setSceneFrame(config) { sceneFrame = plain(config); calls.push(['scene-frame', sceneFrame]); }, setImageFrame(config) { selected.frame = plain(config); calls.push(['picture-frame', selected.frame]); }
};
vm.runInNewContext(source, { window: { MINISH_STUDIO: studio, MINISH_FRAMES: frames }, document, getComputedStyle: () => ({ display: 'block' }), console }, { filename: 'scene-composer-ui.js' });
const notify = name => { for (const handler of documentListeners.get(name) || []) handler({}); };
assert.equal($('pictureInspector').hidden, true);
assert.equal($('pictureFrameTarget').disabled, true);
assert.equal($('frameStyles').children.length, frames.styles.length + 1, 'The gallery shows every installed style and No frame');
assert.equal($('frameStyles').children[0].tagName, 'BUTTON', 'Frame choices keep native keyboard activation');
assert(!documentListeners.has('keydown'), 'Picture UI does not intercept typing, native controls or global shortcuts');
assert.match(html, /id="picturesDialog"[^>]+aria-labelledby="picturesTitle"[^>]+aria-describedby="picturesIntro"/);
assert.match(html, /id="pictureRotation"[^>]+type="number"[^>]+step="1"/);
assert.match(html, /id="pictureFiles"[^>]+accept="image\/png,image\/jpeg,image\/webp,[^"]+" multiple/);
assert.match(html, /id="frameSearch"[^>]+type="search"/);
assert.match(html, /id="frameResultCount"[^>]+role="status"/);
assert.equal($('frameSearch').getAttribute('aria-controls'), 'frameStyles');

await $('addPicturesBtn').click();
assert.equal($('picturesDialog').open, true); assert.equal(document.activeElement, $('choosePicturesBtn')); assert.equal($('importPicturesBtn').disabled, true);
const files = [{ name: '<img src=x>.png' }, { name: 'holiday.jpg' }];
await $('pictureFiles').fire('change', { target: { files } });
assert.equal($('pictureFileList').children[0].textContent, files[0].name, 'Filenames are rendered as text');
assert.equal($('importPicturesBtn').disabled, false);
assert.equal($('importPicturesBtn').textContent, 'Add 2 pictures');
current.checked = false; carousel.checked = true; await carousel.fire('change');
assert.equal($('importPicturesBtn').textContent, 'Create 2 scenes');
await $('importPicturesBtn').click();
assert.equal(calls.at(-1)[2].placement, 'carousel'); assert.equal($('picturesDialog').open, false); assert.equal($('pictureInspector').hidden, false);
assert.equal($('pictureWidth').value, '200'); assert.equal($('pictureHeight').value, '150');

$('pictureWidth').value = 321; await $('pictureWidth').fire('change');
assert.deepEqual(calls.at(-1), ['update', { width: 321, keepAspect: true }]);
$('pictureAspectLock').checked = false; await $('pictureAspectLock').fire('change');
assert.deepEqual(calls.at(-1), ['update', { keepAspect: false }]);
$('pictureHeight').value = 99; await $('pictureHeight').fire('change');
assert.deepEqual(calls.at(-1), ['update', { height: 99, keepAspect: false }]);
$('pictureRotation').value = 17; await $('pictureRotation').fire('change'); assert.deepEqual(calls.at(-1), ['update', { rotation: 17 }]);
const beforeInvalid = calls.length; $('pictureWidth').value = -5; await $('pictureWidth').fire('change'); assert.equal(calls.length, beforeInvalid); assert.match($('pictureEditStatus').textContent, /between 1/);
await $('fitPictureBtn').click(); assert.deepEqual(calls.at(-1), ['fit', 'contain']);
await $('fillPictureBtn').click(); assert.deepEqual(calls.at(-1), ['fit', 'cover']);

const frameButton = id => $('frameStyles').children.find(button => button.dataset.frameStyle === id);
const visibleFrames = () => $('frameStyles').children.filter(button => !button.hidden);
await $('sceneFramesBtn').click(); assert.equal($('frameTarget').value, 'scene');
assert.equal($('frameResultCount').textContent, frames.styles.length + ' styles + No frame');
await frameButton('classic-gold').click(); $('frameSize').value = 3; await $('frameSize').fire('change');
$('frameSearch').value = 'ORACLE'; await $('frameSearch').fire('input');
assert(visibleFrames().length > 0 && visibleFrames().length < frames.styles.length, 'Theme search filters a growing library');
assert(visibleFrames().every(button => button.dataset.frameSearch.includes('oracle')));
assert.equal(frameButton('classic-gold').hidden, true);
assert.equal(frameButton('classic-gold').getAttribute('aria-pressed'), 'true', 'Filtering keeps the selected draft');
assert.match($('frameDescription').textContent, /Classic gold/, 'The active style stays named even when hidden by search');
$('frameSearch').value = 'nothing-matches-this-theme'; await $('frameSearch').fire('input');
assert.equal(visibleFrames().length, 0); assert.match($('frameResultCount').textContent, /No frames found/);
assert.equal(sceneFrame, null, 'Searching and selecting never change the saved scene before Apply');
await $('applyFrameBtn').click(); assert.deepEqual(calls.at(-1), ['scene-frame', { style: 'classic-gold', size: 3 }]); assert.equal($('framesDialog').open, false);
await $('pictureFrameBtn').click(); assert.equal($('frameTarget').value, 'picture');
assert.equal($('frameSearch').value, '', 'Opening the picker clears the last filter');
assert.equal(visibleFrames().length, frames.styles.length + 1);
assert.equal($('frameStyles').scrollTop, 0, 'Opening starts the scrollable gallery at its first row');
$('frameSearch').value = 'CLASSIC gold'; await $('frameSearch').fire('input');
assert.deepEqual(visibleFrames().map(button => button.dataset.frameStyle), ['classic-gold'], 'Search is case-insensitive and supports multiple words');
$('frameSearch').value = 'classicgold'; await $('frameSearch').fire('input');
assert.deepEqual(visibleFrames().map(button => button.dataset.frameStyle), ['classic-gold'], 'Compact theme names match separated words');
$('frameSearch').value = 'Minish Cap'; await $('frameSearch').fire('input');
assert(visibleFrames().some(button => button.dataset.frameStyle === 'minish-woodland'), 'The original styles can be found by their Zelda game theme');
$('frameSearch').value = 'Zelda classic'; await $('frameSearch').fire('input');
assert.deepEqual(visibleFrames().map(button => button.dataset.frameStyle), ['classic-gold']);
$('frameSearch').value = ''; await $('frameSearch').fire('search'); assert.equal(visibleFrames().length, frames.styles.length + 1, 'Native clear search restores all choices');
await frameButton('classic-gold').click(); await $('applyFrameBtn').click(); assert.equal(calls.at(-1)[0], 'picture-frame');
await $('pictureFrameBtn').click(); selected = null; notify('minish:selection-changed');
assert.equal($('frameTarget').value, 'scene'); assert.equal($('pictureFrameTarget').disabled, true); assert.match($('frameApplyStatus').textContent, /selection changed/);
await $('cancelFramesBtn').click();

await $('addPicturesBtn').click(); current.checked = true; carousel.checked = false;
await $('pictureFiles').fire('change', { target: { files: [files[0]] } });
importError = 'Use a PNG, JPEG or WebP picture.'; await $('importPicturesBtn').click();
assert.equal($('picturesDialog').open, true); assert.equal($('pictureImportErrors').hidden, false); assert.equal($('pictureImportErrors').textContent, importError); assert.equal($('importPicturesBtn').disabled, false);
importError = null; await $('importPicturesBtn').click(); assert.equal(calls.at(-1)[2].placement, 'current'); assert.equal($('picturesDialog').open, false);
const api = studio.updateSelectedImage; delete studio.updateSelectedImage;
$('pictureRotation').value = 45; await $('pictureRotation').fire('change'); assert.match($('pictureEditStatus').textContent, /Keep the app folder together/); studio.updateSelectedImage = api;
assert(html.indexOf('scene-frames.js') < html.indexOf('src="studio.js'));
assert(html.indexOf('scene-media.js') < html.indexOf('src="studio.js'));
assert(html.indexOf('scene-composer-ui.js') > html.indexOf('src="library.js'));
console.log('PASS: picture/carousel import flow, recoverable errors, photo controls, independent canvas/picture frames, searchable style gallery, draft selection safety, keyboard-friendly markup and module order.');
