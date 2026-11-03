// Run: node tests/scene-images.mjs
// Exercise real scene/media code with local raster decoding and browser-storage doubles.
import assert from 'node:assert/strict';
import { browser } from './project-privacy.mjs';

const scripts = ['examples/starter.js', 'controls.js', 'scene-frames.js', 'scene-media.js', 'studio.js', 'animation-engine.js'];
const clone = value => JSON.parse(JSON.stringify(value));
function png(width = 1024, height = 768, marker = 1, padding = 0) {
  const bytes = Buffer.alloc(32 + padding); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes.writeUInt32BE(marker >>> 0, 24);
  return 'data:image/png;base64,' + bytes.toString('base64');
}
function picture(marker = 1) { const bytes = Uint8Array.from([255, 216, 255, marker, ...Buffer.from('EXIF private-camera-name ' + '/' + 'Users/private-person/My Photos/')]); return { name: 'private-real-name-' + marker + '.jpg', size: bytes.length, arrayBuffer: async () => bytes.buffer }; }
function databaseDouble() {
  const stores = new Map(), held = []; let hold = false;
  const db = {
    objectStoreNames: { contains: key => stores.has(key) }, createObjectStore: key => stores.set(key, new Map()), close() {},
    transaction(names) {
      let pending = 0, scheduled = false;
      const transaction = { objectStore: name => ({
        put(value) { stores.get(name).set(value.id, clone(value)); schedule(); },
        get(key) {
          const request = {}; pending++;
          const run = () => { request.result = clone(stores.get(name).get(key) ?? null); request.onsuccess?.(); pending--; schedule(); };
          if (hold) held.push(run); else queueMicrotask(run); return request;
        }
      }) };
      const schedule = () => { if (scheduled) return; scheduled = true; setImmediate(() => { scheduled = false; if (!pending) transaction.oncomplete?.(); }); };
      schedule(); return transaction;
    }
  };
  return { stores, hold: () => { hold = true; }, release: () => { hold = false; for (const run of held.splice(0)) queueMicrotask(run); },
    indexedDB: { open() { const request = {}; queueMicrotask(() => { request.result = db; request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; } } };
}
async function makeBrowser({ storage = new Map(), database = databaseDouble(), padding = 0 } = {}) {
  return await browser(storage, { scripts, prepare({ sandbox, Element, blobs }) {
    sandbox.indexedDB = database.indexedDB; sandbox.atob = value => Buffer.from(value, 'base64').toString('binary');
    class Raster {
      set src(value) {
        this._src = value;
        void (async () => {
          let marker = 1, width = 1024, height = 768;
          if (blobs.has(value)) { const bytes = new Uint8Array(await blobs.get(value).arrayBuffer()); marker = bytes[3] || 1; }
          else if (value.startsWith('data:image/png;base64,')) { const bytes = Buffer.from(value.split(',')[1], 'base64'); width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); marker = bytes.readUInt32BE(24); }
          else { width = 224; height = 48; }
          Object.assign(this, { width, height, naturalWidth: width, naturalHeight: height, marker }); this.onload?.();
        })();
      }
      get src() { return this._src; }
    }
    sandbox.Image = Raster;
    Element.prototype.getContext = function () {
      if (this._context) return this._context;
      const element = this, trace = this.trace = [];
      return this._context = new Proxy({ canvas: element, globalAlpha: 1, imageSmoothingEnabled: false, measureText: text => ({ width: String(text).length * 6 }), getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) }, {
        get(object, key) { if (key in object) return object[key]; return (...args) => { if (key === 'drawImage') element._lastRaster = args[0]; trace.push({ method: key, args, smoothing: object.imageSmoothingEnabled }); }; }
      });
    };
    Element.prototype.toDataURL = function () { return png(this.width, this.height, this._lastRaster?.marker || 1, padding); };
    Element.prototype.toBlob = function (callback) { callback(new Blob([JSON.stringify({ width: this.width, height: this.height })], { type: 'image/png' })); };
  } });
}
function blank(profile) { const slide = profile.scene.getScene(); slide.objects = []; slide.frame = { style: 'none', size: 0 }; profile.scene.loadProject({ format: 'minish-cap-studio', name: 'Private picture project', activeSlide: slide.id, slides: [slide] }); }

const database = databaseDouble(), profile = await makeBrowser({ database, padding: 3 * 1024 * 1024 });
await profile.scene.storageReady;
blank(profile);
const imported = await profile.scene.importImages([picture(1)]);
assert.equal(imported.count, 1); const first = profile.scene.selectedObject, mediaId = first.imageId;
assert.equal(first.kind, 'image'); assert.equal(profile.scene.getImageMetadata(mediaId).width, 1024);
assert(!JSON.stringify(profile.scene.project).includes('data:image'), 'Undo/live project snapshots contain only picture references');
assert(!JSON.stringify(profile.scene.project).includes('private-real-name'), 'Original filenames are not retained');
const center = { x: first.x + first.w / 2, y: first.y + first.h / 2 };
profile.scene.updateSelectedImage({ width: 100, rotation: 23.5 });
let selected = profile.scene.selectedObject;
assert.equal(selected.w, 100); assert.equal(selected.h, 75); assert.equal(selected.rotation, 23.5);
assert.equal(selected.x + selected.w / 2, center.x); assert.equal(selected.y + selected.h / 2, center.y);
profile.scene.fitSelectedImage('cover'); assert.equal(profile.scene.selectedObject.keepAspect, true, 'Fit preserves the aspect-lock setting');
profile.scene.updateSelectedImage({ width: 120, height: 70, keepAspect: false, flipX: true });
assert.equal(profile.scene.selectedObject.h, 70); assert.equal(profile.scene.selectedObject.w, 120);
profile.scene.updateSelectedImage({ x: 20, y: 20, width: 100, height: 75, rotation: 0, keepAspect: false }); profile.scene.updateSelectedImage({ keepAspect: true });
profile.scene.zoomAt(1); profile.scene.render();
const sceneCanvas = profile.nodes.get('sceneCanvas');
const pointer = (type, x, y, extra = {}) => { for (const callback of sceneCanvas.listeners[type] || []) callback({ button: 0, pointerId: 1, clientX: x, clientY: y, target: sceneCanvas, currentTarget: sceneCanvas, preventDefault() {}, ...extra }); };
pointer('pointerdown', 120, 95); pointer('pointermove', 140, 110); pointer('pointermove', 160, 125); pointer('pointerup', 160, 125);
assert(Math.abs(profile.scene.selectedObject.w - 140) < 1e-8); assert(Math.abs(profile.scene.selectedObject.h - 105) < 1e-8);
profile.scene.undo(); profile.scene.select(first.id); assert.equal(profile.scene.selectedObject.w, 100, 'An entire corner drag is one undo step');
pointer('pointerdown', 120, 95); pointer('pointermove', 160, 100, { shiftKey: true }); pointer('pointerup', 160, 100);
assert.equal(profile.scene.selectedObject.w, 140); assert.equal(profile.scene.selectedObject.h, 80, 'Shift stretches a normally locked picture');
profile.scene.updateSelectedImage({ rotation: 23.5 });
const turned = profile.scene.selectedObject, bounds = profile.scene.spriteGeometry.bounds(turned);
assert(profile.scene.spriteGeometry.contains(turned, { x: turned.x + turned.w / 2, y: turned.y + turned.h / 2 }));
assert(!profile.scene.spriteGeometry.contains(turned, { x: bounds.x, y: bounds.y }), 'Rotated picture hit-testing excludes empty bounding-box corners');
profile.scene.setImageFrame({ style: 'oracle-jewel', size: 2 }); profile.scene.setSceneFrame({ style: 'hyrule-royal', size: 1 });
profile.scene.copySelected(); profile.scene.pasteSelected(); profile.scene.duplicateSelected(); profile.scene.addSlide(true);
assert.equal(profile.scene.getPortableProject().media.images.length, 1, 'Duplicate objects, clipboard and slides share one embedded PNG');
const portable = profile.scene.getPortableProject();
assert(portable.media.images[0].dataUrl.length > 3800000, 'Pictures exceed the old localStorage ceiling');
assert(!JSON.stringify(portable).includes('EXIF') && !JSON.stringify(portable).includes('/' + 'Users/'));
profile.scene.saveProject(); const savedDownload = profile.downloads.at(-1), savedJSON = JSON.parse(await profile.blobs.get(savedDownload.href).text());
assert.equal(savedJSON.media.images.length, 1); assert.equal(savedJSON.slides[0].frame.style, 'hyrule-royal');
profile.save(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
const reopened = await makeBrowser({ database, storage: profile.storage }); await reopened.scene.storageReady;
assert.equal(reopened.scene.getScene().objects.filter(object => object.kind === 'image').length, 3);
assert.equal(reopened.scene.getPortableProject().media.images.length, 1);
const visitor = await makeBrowser(); await visitor.scene.storageReady; assert.equal(visitor.scene.getImages().length, 0, 'Another browser profile receives no personal pictures');
visitor.scene.loadProject(savedJSON); await visitor.scene.prepareScene(visitor.scene.getScene());
assert.equal(visitor.scene.getPortableProject().media.images.length, 1, 'The JSON reopens without the original files');
const canvas = await visitor.scene.renderSceneToCanvas(visitor.scene.getScene(), { scale: 4 });
assert(canvas.trace.some(call => call.method === 'drawImage' && call.args[0] instanceof visitor.sandbox.Image && call.smoothing), 'Photo pixels are drawn directly at final export resolution');
assert(canvas.trace.some(call => call.method === 'drawImage' && call.args[0].tagName === 'CANVAS' && !call.smoothing), 'Native pixel frames are enlarged without smoothing');
visitor.scene.select(visitor.scene.getScene().objects.find(object => object.kind === 'image').id);
visitor.scene.deleteSelected(); visitor.scene.undo(); assert.equal(visitor.scene.getScene().objects.length, 3); visitor.scene.redo(); assert.equal(visitor.scene.getScene().objects.length, 2);
const beforeInvalid = clone(visitor.scene.project), mediaCount = visitor.scene.getImages().length;
await assert.rejects(visitor.scene.importImages([picture(77), { size: 8, arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer }]), /SVG/);
assert.deepEqual(clone(visitor.scene.project), beforeInvalid); assert.equal(visitor.scene.getImages().length, mediaCount, 'A failed file batch commits no partial media');
assert.throws(() => visitor.scene.loadProject({ ...savedJSON, media: { version: 1, images: [savedJSON.media.images[0], { id: 'picture-bad', dataUrl: 'https://example.com/picture.png' }] } }), /embedded PNG/);
assert.deepEqual(clone(visitor.scene.project), beforeInvalid);

const carousel = await makeBrowser(); await carousel.scene.storageReady; blank(carousel);
await carousel.scene.importImages([picture(10), picture(11), picture(12)], { placement: 'carousel' });
assert.equal(carousel.scene.project.slides.length, 3); assert(carousel.scene.project.slides.every(slide => slide.objects.length === 1));
carousel.scene.undo(); assert.equal(carousel.scene.project.slides.length, 1); carousel.scene.redo(); assert.equal(carousel.scene.project.slides.length, 3);
const limit = await makeBrowser(); await limit.scene.storageReady; blank(limit);
await limit.scene.importImages(Array.from({ length: 100 }, (_, index) => picture(index + 1)));
await assert.rejects(limit.scene.importImages([picture(101)]), /100 different pictures/);
assert.equal(limit.scene.getPortableProject().media.images.length, 100, 'Every accepted project remains reopenable');

database.hold();
const waiting = await makeBrowser({ database, storage: profile.storage });
assert.equal(waiting.scene.isRestoring, true);
const localBefore = [...profile.storage];
for (const callback of waiting.nodes.get('sceneCanvas').listeners.pointerdown || []) callback({ button: 0, preventDefault() {}, target: waiting.nodes.get('sceneCanvas') });
waiting.close(); assert.deepEqual([...profile.storage], localBefore, 'Clicks and closing while reopening cannot replace the saved project with starter content');
assert.throws(() => waiting.scene.deleteSlide(), /still reopening/);
database.release(); await waiting.scene.storageReady; assert.equal(waiting.scene.getPortableProject().media.images.length, 1);
for (const context of [profile, reopened, visitor, carousel, limit, waiting]) assert.equal(context.networkAttempts.length, 0);
console.log('PASS: local picture import, metadata stripping, arbitrary transforms, frames, deduplicated portable files, large-picture autosave, private-profile reopen, carousel import, atomic validation, undo/redo, mixed-resolution exports, limits and restore-race protection.');
