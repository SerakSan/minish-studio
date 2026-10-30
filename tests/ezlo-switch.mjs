import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(root, 'ezlo-switch.js'), 'utf8');
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

function harness({ reducedMotion = false, selected = 'scene', width = 146 } = {}) {
  const draws = [], transforms = [], scheduled = new Map(), cancelled = [], listeners = new Map();
  const attributes = pressed => new Map([['aria-pressed', String(pressed)]]);
  const sceneAttrs = attributes(selected === 'scene'), animationAttrs = attributes(selected === 'animation');
  const button = attrs => ({ getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value) });
  const classes = new Set(), style = {};
  let nextFrame = 1, canvasWidth = width;
  const ctx = {
    imageSmoothingEnabled: true,
    save() {}, restore() {}, clearRect() {},
    translate: (...args) => transforms.push(['translate', ...args]),
    scale: (...args) => transforms.push(['scale', ...args]),
    drawImage: (...args) => draws.push(args)
  };
  const canvas = { width: 142, height: 54, getContext: () => ctx, getBoundingClientRect: () => ({ width: canvasWidth }) };
  const control = {
    style, clientWidth: width + 4,
    getBoundingClientRect: () => ({ left: 100.25, top: 10.5 }),
    classList: { toggle(name, state) { if (state) classes.add(name); else classes.delete(name); } }
  };
  const mediaListeners = new Map();
  const media = {
    matches: reducedMotion,
    addEventListener: (name, listener) => mediaListeners.set(name, listener),
    removeEventListener: name => mediaListeners.delete(name)
  };
  const elements = { workspaceModeSwitch: control, ezloSwitchCanvas: canvas, sceneModeBtn: button(sceneAttrs), animationModeBtn: button(animationAttrs) };
  const images = [];
  class Image {
    constructor() { images.push(this); }
    set src(value) { this.dataUrl = value; }
  }
  const window = {
    matchMedia: () => media,
    requestAnimationFrame(callback) { const id = nextFrame++; scheduled.set(id, callback); return id; },
    cancelAnimationFrame(id) { cancelled.push(id); scheduled.delete(id); },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name)
  };
  vm.runInNewContext(script, { window, Image, document: { getElementById: id => elements[id] } });
  const api = window.MINISH_EZLO_SWITCH;
  return {
    api, ctx, canvas, control, sceneAttrs, animationAttrs, classes, draws, transforms, scheduled, cancelled, images,
    load() { images[0].onload(); },
    step(time) { const batch = [...scheduled.values()]; scheduled.clear(); for (const callback of batch) callback(time); },
    reduce(value) { media.matches = value; mediaListeners.get('change')?.(); },
    resize(value) { canvasWidth = value; listeners.get('resize')?.(); },
    get listenerCount() { return listeners.size + mediaListeners.size; }
  };
}

// A local, embedded lossless atlas is used even when the editor is opened as file://.
const h = harness();
assert.equal(h.api.state.mode, 'scene');
assert.equal(h.api.state.position, 0);
assert.equal(h.api.state.animating, false);
assert.equal(h.scheduled.size, 0, 'startup must settle without an animation or flash');
assert.match(h.images[0].dataUrl, /^data:image\/png;base64,/);
assert.equal(h.draws.length, 0, 'wait until the real PNG is decoded');
h.load();
assert.equal(h.api.state.ready, true);
assert.equal(h.canvas.width, 146);
assert.equal(h.ctx.imageSmoothingEnabled, false);
assert.deepEqual(h.draws.at(-1).slice(3), [24, 28, -24, 0, 48, 56], 'enlarge source cells exactly 2x');
assert.equal(h.control.style.transform, 'translate(-0.25px,0.5px)');

// Entering Animate advances right with stepped game poses and finishes exactly on the right.
h.api.setMode('animation', { animate: true });
assert.equal(h.animationAttrs.get('aria-pressed'), 'true');
assert.equal(h.sceneAttrs.get('aria-pressed'), 'false');
const outbound = [];
for (const time of [100, 260, 420, 580, 740]) { h.step(time); outbound.push(h.api.state.position); }
assert.ok(outbound.every((value, index) => index === 0 || value >= outbound[index - 1]));
assert.equal(outbound.at(-1), 1);
assert.equal(h.api.state.animating, false);
assert.equal(h.scheduled.size, 0);
assert.ok(h.transforms.some(value => value[0] === 'scale' && value[1] === -1 && value[2] === 1), 'face the destination');
assert.ok(h.classes.has('is-animation'));

// The same genuine poses reverse left and source orientation is restored.
const transformCount = h.transforms.length;
h.api.setMode('scene', { animate: true });
const inbound = [];
for (const time of [1000, 1160, 1320, 1480, 1640]) { h.step(time); inbound.push(h.api.state.position); }
assert.ok(inbound.every((value, index) => index === 0 || value <= inbound[index - 1]));
assert.equal(inbound.at(-1), 0);
assert.equal(h.transforms.slice(transformCount).some(value => value[0] === 'scale'), false);
assert.equal(h.classes.has('is-animation'), false);

// A new destination interrupts an in-flight animation without allowing old callbacks to win.
h.api.setMode('animation'); h.step(2000); h.step(2240);
const interruptedPosition = h.api.state.position;
const staleCallback = [...h.scheduled.values()][0];
assert.ok(interruptedPosition > 0 && interruptedPosition < 1);
h.api.setMode('scene');
assert.equal(h.api.state.position, interruptedPosition);
assert.ok(h.cancelled.length > 0);
const beforeStale = JSON.stringify(h.api.state);
staleCallback(9000);
assert.equal(JSON.stringify(h.api.state), beforeStale);
h.step(2300); h.step(3000);
assert.equal(h.api.state.position, 0);
assert.equal(h.api.state.mode, 'scene');
assert.equal(h.scheduled.size, 0);
h.api.setMode('animation'); h.step(3100); h.step(3200);
h.api.setMode('scene'); h.step(3210);
h.api.setMode('animation'); h.step(3220); h.step(4000);
assert.equal(h.api.state.position, 1);
assert.equal(h.api.state.mode, 'animation');
assert.equal(h.api.state.animating, false);

// Reduced motion is immediate at load and also cancels an animation if changed live.
const reduced = harness({ reducedMotion: true, selected: 'animation', width: 108 });
reduced.load();
assert.equal(reduced.api.state.position, 1);
reduced.api.setMode('scene');
assert.equal(reduced.api.state.position, 0);
assert.equal(reduced.scheduled.size, 0);
reduced.reduce(false);
reduced.api.setMode('animation'); reduced.step(0); reduced.step(200);
assert.ok(reduced.api.state.position < 1);
reduced.reduce(true);
assert.equal(reduced.api.state.position, 1);
assert.equal(reduced.scheduled.size, 0);
reduced.resize(108);
assert.equal(reduced.canvas.width, 108);
assert.equal(reduced.canvas.height, 54);
assert.deepEqual(reduced.draws.at(-1).slice(3), [24, 28, -24, 0, 48, 56]);
assert.ok(reduced.transforms.filter(value => value[0] === 'translate').every(value => Number.isInteger(value[1]) && Number.isInteger(value[2])));
reduced.api.destroy();
assert.equal(reduced.listenerCount, 0);

// Credits and exact source mappings travel with every derived frame in public releases.
const mapping = JSON.parse(fs.readFileSync(path.join(root, 'assets/ui/ezlo-switch/manifest.json')));
const verification = JSON.parse(fs.readFileSync(path.join(root, 'assets/ui/ezlo-switch/verification.json')));
assert.equal(mapping.sourceId, '6372');
assert.equal(mapping.sourceContributor, 'Sonikku');
assert.equal(mapping.frames.length, 7);
assert.equal(hash(mapping.originalPath), mapping.originalSha256);
assert.equal(hash(mapping.sourcePath), mapping.sourceSha256);
assert.equal(hash(mapping.cleanPath), mapping.cleanSha256);
assert.equal(hash(mapping.image), mapping.imageSha256);
assert.equal(verification.passed, true);
assert.equal(verification.allFrameRGBAEqualToReviewedSourceCrops, true);
assert.equal(verification.everyVisibleRGBMatchesOriginalSource, true);
assert.deepEqual(verification.alphaValues, [0, 255]);
assert.equal(verification.frames, 7);
assert.equal(verification.foregroundPixels, 1477);
assert.equal(createHash('sha256').update(Buffer.from(h.images[0].dataUrl.split(',')[1], 'base64')).digest('hex'), mapping.imageSha256);
const css = fs.readFileSync(path.join(root, 'ezlo-switch.css'), 'utf8');
assert.match(css, /min-height:44px/);
assert.match(css, /prefers-reduced-motion:reduce/);
const markup = fs.readFileSync(path.join(root, 'animation-mode-switch.html'), 'utf8');
assert.match(markup, /role="group"/);
assert.equal((markup.match(/type="button"/g) || []).length, 2);
assert.match(markup, />Scene<\/button>/);
assert.match(markup, />Animate<\/button>/);
console.log('Ezlo switch: source provenance, embedded PNG, direction, interruption, narrow screens, native buttons, and reduced motion pass.');
