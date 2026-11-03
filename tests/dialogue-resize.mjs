// Run: node tests/dialogue-resize.mjs
// Real dialogue layout and pointer editing, using the existing isolated browser harness.
import assert from 'node:assert/strict';
import { browser } from './project-privacy.mjs';

const scripts = ['examples/starter.js', 'controls.js', 'assets/game-ui.js', 'studio.js', 'animation-engine.js'];
const clone = value => JSON.parse(JSON.stringify(value));
const traces = [];
const profile = await browser(new Map(), { scripts, prepare({ Element }) {
  Element.prototype.getContext = function () {
    if (this._dialogueContext) return this._dialogueContext;
    const canvas = this;
    const context = { canvas, font: '', imageSmoothingEnabled: false,
      measureText: text => ({ width: [...String(text)].length * 6 }),
      getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }) };
    return this._dialogueContext = new Proxy(context, {
      get(target, key) { return key in target ? target[key] : (...args) => traces.push({ canvas, method: key, args }); }
    });
  };
  Element.prototype.toBlob = function (callback, type) {
    const payload = new Uint8Array(16); payload.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(payload.buffer).setUint32(8, this.width); new DataView(payload.buffer).setUint32(12, this.height);
    callback(new Blob([payload], { type }));
  };
} });
const studio = profile.scene;
assert.equal(typeof studio.getDialogueLayout, 'function', 'Dialogue layout is available to the inspector and renderers');
assert.equal(typeof studio.fitSelectedDialogueToText, 'function', 'The entire message can fit its dialogue box');

const base = { id: 'editable-dialogue', kind: 'dialogue', x: 20, y: 30, w: 240, h: 100, scale: 1,
  text: 'A little adventure across Hyrule Castle.', fontSize: 12, color: '#fff7d3', box: true, fitText: true, layer: 'overlay' };
function loadDialogue(patch = {}) {
  const slide = studio.getScene();
  Object.assign(slide, { id: 'dialogue-scene', name: 'Dialogue layout check', preset: 'custom', width: 480, height: 320, exportScale: 1,
    objects: [{ ...base, ...patch }] });
  studio.loadProject({ format: 'minish-cap-studio', version: 1, name: 'Local dialogue check', activeSlide: slide.id, slides: [slide] });
  studio.select(base.id); studio.zoomAt(1); studio.render();
  return studio.selectedObject;
}
function layout(patch = {}) {
  const object = loadDialogue(patch), before = JSON.stringify(object), result = studio.getDialogueLayout(object);
  assert.equal(JSON.stringify(object), before, 'Layout never changes the saved message or its requested type size');
  return result;
}

const wide = layout({ w: 450, h: 400 }), narrow = layout({ w: 100, h: 400 });
assert(narrow.lines.length > wide.lines.length, 'Narrowing a box wraps the message into more lines');
assert.equal(wide.lines.join(' '), base.text);
assert.equal(narrow.scale, 1); assert.equal(narrow.overflow, false);
assert(narrow.textWidth <= narrow.contentWidth, 'Wrapped lines stay within the content width');
assert.equal(narrow.lineHeight, 16, 'The genuine bitmap font keeps its native line cadence');

const paragraphs = layout({ w: 450, h: 400, text: 'First line\n\nSecond line' });
assert.deepEqual(clone(paragraphs.lines), ['First line', '', 'Second line'], 'Deliberate blank lines remain part of the layout');
const plainText = layout({ w: 100, h: 32, text: 'One\nTwo', box: false });
assert.equal(plainText.padding, 0); assert.equal(plainText.textHeight, 32); assert.equal(plainText.overflow, false, 'Text without a frame can use the full resized area');
const isolatedLines = studio.getDialogueLayout(); isolatedLines.lines.push('External edit');
assert(!studio.getDialogueLayout().lines.includes('External edit'), 'Inspector callers cannot mutate the cached rendering layout');
const word = 'LongUnbrokenWordAcrossHyrule';
const longWord = layout({ w: 64, h: 1000, text: word });
assert(longWord.lines.length > 1); assert.equal(longWord.lines.join(''), word, 'An unbroken word wraps without losing letters');
assert(longWord.textWidth <= longWord.contentWidth);
const unicodeMessage = '한글🙂Zelda🙂한글';
const unicode = layout({ w: 64, h: 1000, text: unicodeMessage });
assert.equal(unicode.lines.join(''), unicodeMessage, 'Unicode fallback and complete code points survive wrapping');
assert(!unicode.lines.some(line => /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u.test(line)), 'A line boundary does not split a surrogate pair');

const fitted = layout({ text: 'Hi', w: 300, h: 68, fontSize: 48, fitText: true });
assert(fitted.scale < 4 && fitted.scale >= 1, 'Auto fit reduces the bitmap font by whole pixel scales');
assert.equal(fitted.shrunk, true); assert.equal(fitted.overflow, false);
const fixed = layout({ text: 'Hi', w: 300, h: 68, fontSize: 48, fitText: false });
assert.equal(fixed.scale, 4, 'Manual text size remains the requested bitmap scale');
assert.equal(fixed.shrunk, false); assert.equal(fixed.overflow, true, 'Manual overflow is reported instead of silently discarded');
const tooSmall = layout({ text: 'A long adventure cannot fit here.', w: 30, h: 12, fontSize: 48, fitText: true });
assert.equal(tooSmall.scale, 1, 'Auto fit never blurs the authentic font below its native pixels');
assert.equal(tooSmall.overflow, true); assert(tooSmall.requiredHeight > 12);

loadDialogue({ text: 'An adventure across Hyrule, with a message that needs several lines.', w: 120, h: 30, fontSize: 24 });
const requested = studio.getDialogueLayout({ ...studio.selectedObject, fitText: false });
studio.fitSelectedDialogueToText();
assert(studio.selectedObject.h >= requested.requiredHeight, 'Fit box to text provides room at the requested size');
assert.equal(studio.selectedObject.fontSize, 24, 'Fitting the box never rewrites the selected text size');
assert.equal(studio.getDialogueLayout().overflow, false);
const fitBeforeUndo = studio.selectedObject;
studio.undo(); studio.select(base.id); assert.equal(studio.selectedObject.h, 30, 'Fit box is one reversible edit');
studio.redo(); studio.select(base.id); assert.equal(studio.selectedObject.h, fitBeforeUndo.h);
loadDialogue({ text: 'A'.repeat(600), w: 20, h: 20, fontSize: 48 });
studio.fitSelectedDialogueToText();
assert(studio.selectedObject.h <= 8192 && studio.selectedObject.h > 0, 'Very long messages respect the maximum editable box size');

const canvas = profile.nodes.get('sceneCanvas');
function pointer(type, x, y, extra = {}) {
  for (const callback of canvas.listeners[type] || []) callback({ button: 0, pointerId: 1, clientX: x, clientY: y,
    target: canvas, currentTarget: canvas, preventDefault() {}, ...extra });
}
function drag(from, to, extra = {}) {
  pointer('pointerdown', ...from, extra);
  pointer('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra);
  pointer('pointermove', ...to, extra); pointer('pointerup', ...to, extra);
}
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-7, message + ': ' + actual + ' versus ' + expected);

// Each of the eight handles changes only its intended edges.
for (const [cx, cy] of [[0, 0], [.5, 0], [1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [0, .5]]) {
  const initial = loadDialogue({ w: 100, h: 50, scale: 2 });
  const from = [initial.x + cx * initial.w * initial.scale, initial.y + cy * initial.h * initial.scale];
  const to = [from[0] + (cx === .5 ? 0 : cx === 0 ? -20 : 20), from[1] + (cy === .5 ? 0 : cy === 0 ? -10 : 10)];
  drag(from, to);
  const edited = studio.selectedObject;
  near(edited.w, initial.w + (cx === .5 ? 0 : 10), 'Horizontal resizing accounts for legacy object scale');
  near(edited.h, initial.h + (cy === .5 ? 0 : 5), 'Vertical resizing accounts for legacy object scale');
  near(edited.x, initial.x + (cx === 0 ? -20 : 0), 'The opposite horizontal edge remains fixed');
  near(edited.y, initial.y + (cy === 0 ? -10 : 0), 'The opposite vertical edge remains fixed');
  assert.equal(edited.scale, 2, 'Resizing does not silently change a saved dialogue scale');
  studio.undo(); studio.select(base.id);
  assert.deepEqual(studio.selectedObject, initial, 'The full drag, including intermediate movement, is a single Undo');
  studio.redo(); studio.select(base.id); assert.deepEqual(studio.selectedObject, edited);
}

loadDialogue({ x: 10, y: 10, w: 100, h: 50 });
drag([10, 10], [-25, -18], { shiftKey: true });
assert.equal(studio.selectedObject.x, -25); assert.equal(studio.selectedObject.y, -18, 'Dialogue can be resized beyond the canvas');
assert.equal(studio.selectedObject.w, 135); assert.equal(studio.selectedObject.h, 78, 'Dialogue width and height resize independently');
loadDialogue({ w: 100, h: 50 }); drag([20, 30], [400, 400]);
assert.equal(studio.selectedObject.w, 20); assert.equal(studio.selectedObject.h, 12, 'Crossing an opposite corner keeps a positive minimum box');
near(studio.selectedObject.x + studio.selectedObject.w, 120, 'Minimum width keeps the opposite edge');
near(studio.selectedObject.y + studio.selectedObject.h, 80, 'Minimum height keeps the opposite edge');

loadDialogue({ w: 3000, h: 2500, text: 'A large carousel message', fitText: false });
assert.equal(studio.selectedObject.w, 3000); assert.equal(studio.selectedObject.h, 2500, 'Large boxes are no longer clipped to the former 2000 px limit');
const saved = studio.getPortableProject(), savedObject = studio.selectedObject;
const reopened = await browser(new Map(), { scripts });
reopened.scene.loadProject(saved); reopened.scene.select(base.id);
assert.deepEqual(clone(reopened.scene.selectedObject), clone(savedObject), 'Portable projects preserve free box dimensions and fitting preference');
const importedAnimation = reopened.animation.importScene(saved.slides[0]);
const animatedDialogue = importedAnimation.objects.find(object => object.kind === 'dialogue');
assert.equal(animatedDialogue.w, 3000); assert.equal(animatedDialogue.h, 2500, 'Sending a large dialogue into Animate does not silently shrink the box');
assert.equal(animatedDialogue.fitText, false, 'Animation import preserves the requested text fitting preference');
reopened.animation.loadProject(reopened.animation.saveData());
assert.equal(reopened.animation.currentClip.objects.find(object => object.kind === 'dialogue').w, 3000, 'Large animated dialogue survives its project round trip');
const png = await studio.exportSlide(studio.getScene()), header = new DataView(await png.arrayBuffer());
assert.equal(header.getUint32(8), 480); assert.equal(header.getUint32(12), 320, 'A large or off-frame dialogue box does not change the export crop');
assert(traces.some(call => call.method === 'drawImage' && call.args[0]?.src === profile.sandbox.MINISH_GAME_UI.dialogue.dataUrl), 'Dialogue rendering still uses the genuine frame');
assert(traces.some(call => call.method === 'drawImage' && call.args[0]?.src === profile.sandbox.MINISH_GAME_UI.font.dataUrl), 'Dialogue rendering still uses genuine bitmap glyphs');
assert.equal(profile.networkAttempts.length, 0, 'Text layout, resizing and project operations stay on the device');

console.log('PASS: dialogue eight-handle resizing, free proportions, scale-aware anchors, reflow, Unicode, integer font fitting, overflow feedback, fit height, Undo/Redo, large-box persistence and genuine-art exports.');
