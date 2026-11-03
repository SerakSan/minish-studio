// Run: node tests/inline-dialogue.mjs
// Inline dialogue edits use the real scene code with an isolated native-input DOM double.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { browser } from './project-privacy.mjs';

const scripts = ['examples/starter.js', 'controls.js', 'studio.js', 'animation-engine.js'];
const clone = value => JSON.parse(JSON.stringify(value));
const traces = [], markupAssignments = [];
const profile = await browser(new Map(), { scripts, prepare({ Element, nodes, sandbox }) {
  Element.prototype.contains = function (node) {
    while (node) { if (node === this) return true; node = node.parent || node.parentElement; }
    return false;
  };
  Element.prototype.setSelectionRange = function (start, end) { this.selectionStart = start; this.selectionEnd = end; };
  Element.prototype.getContext = function () {
    if (this._inlineContext) return this._inlineContext;
    const canvas = this, context = { canvas, font: '', imageSmoothingEnabled: false,
      measureText: text => ({ width: [...String(text)].length * 6 }),
      getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }) };
    return this._inlineContext = new Proxy(context, { get: (target, key) => key in target ? target[key] : (...args) => traces.push({ canvas, method: key, args }) });
  };
  Element.prototype.toBlob = function (callback, type) { callback(new Blob(['local PNG'], { type })); };
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true,
    get() { return this._html || ''; }, set(value) { this._html = String(value); if (this._html.includes('inlineSecret')) markupAssignments.push({ id: this.id, value }); } });
  const wrap = nodes.get('canvasWrap'), editor = nodes.get('inlineDialogueEditor');
  if (editor) {
    editor.hidden = true; editor.parent = editor.parentElement = wrap;
    wrap.children.push(editor);
    for (const id of ['inlineDialogueText', 'inlineDialogueToolbar', 'inlineDialogueHint']) {
      const node = nodes.get(id); if (node) { node.parent = node.parentElement = editor; editor.children.push(node); }
    }
    const toolbar = nodes.get('inlineDialogueToolbar');
    for (const id of ['finishInlineDialogueBtn', 'cancelInlineDialogueBtn']) {
      const node = nodes.get(id); if (node) { node.parent = node.parentElement = toolbar; toolbar.children.push(node); }
    }
  }
  // A text field's blur and default keyboard editing are emulated explicitly below.
  sandbox.getComputedStyle = () => ({ paddingLeft: '4', paddingRight: '4', paddingTop: '4', paddingBottom: '4' });
} });
const studio = profile.scene, node = id => profile.nodes.get(id);
const canvas = node('sceneCanvas'), viewport = node('stageViewport'), wrap = node('canvasWrap');
const editor = node('inlineDialogueEditor'), input = node('inlineDialogueText');
assert(editor && input, 'The canvas has a native inline text editor');
assert.equal(typeof studio.editDialogue, 'function');
assert.equal(typeof studio.finishDialogueEditing, 'function');
assert.match(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /<textarea(?=[^>]*\bid="inlineDialogueText")(?=[^>]*\bmaxlength="5000")[^>]*>/, 'Inline typing has the same 5000-character limit as saved dialogue');

const settle = () => new Promise(resolve => setImmediate(resolve));
function event(target, extra = {}) {
  return { target, currentTarget: target, button: 0, pointerId: 1, defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.propagationStopped = true; }, ...extra };
}
async function fire(target, type, extra = {}) {
  const value = event(target, extra);
  for (const callback of target.listeners[type] || []) await callback(value);
  return value;
}
async function bubble(target, type, extra = {}) {
  const value = event(target, extra);
  for (let current = target; current && !value.propagationStopped; current = current.parent) {
    value.currentTarget = current;
    for (const callback of current.listeners[type] || []) await callback(value);
  }
  return value;
}
async function clickEditorControl(id) {
  const control = node(id), pointer = await bubble(control, 'pointerdown');
  if (!pointer.defaultPrevented) {
    const mouse = await bubble(control, 'mousedown');
    if (!mouse.defaultPrevented) await fire(input, 'blur', { relatedTarget: control });
  }
  return await fire(control, 'click');
}
async function key(key, extra = {}) {
  const value = await fire(input, 'keydown', { key, ...extra });
  if (!value.propagationStopped) for (const callback of profile.events.get('keydown') || []) await callback(value);
  return value;
}
async function draft(text) { input.value = text; await fire(input, 'input'); await settle(); }
async function doubleClick(x, y, extra = {}) {
  const value = await fire(canvas, 'dblclick', { clientX: x * studio.view.zoom, clientY: y * studio.view.zoom, detail: 2, ...extra });
  if (!value.propagationStopped) {
    value.currentTarget = viewport;
    for (const callback of viewport.listeners.dblclick || []) await callback(value);
  }
  await settle(); return value;
}

const base = { id: 'inline-dialogue', kind: 'dialogue', x: 20, y: 30, w: 240, h: 100, scale: 1,
  text: 'Original dialogue', fontSize: 12, color: '#fff7d3', box: true, fitText: true, layer: 'overlay' };
function load(patch = {}, extraObjects = []) {
  studio.finishDialogueEditing(false);
  profile.sandbox.document.body.classList.remove('animation-mode');
  const slide = studio.getScene();
  Object.assign(slide, { id: 'inline-scene', name: 'Inline dialogue check', preset: 'custom', width: 480, height: 320, exportScale: 1,
    objects: [{ ...base, ...patch }, ...clone(extraObjects)] });
  studio.loadProject({ format: 'minish-cap-studio', version: 1, name: 'Local inline text check', activeSlide: slide.id,
    slides: [slide, { ...clone(slide), id: 'other-inline-scene', name: 'Other scene', objects: [] }] });
  studio.select(base.id); studio.zoomAt(1); studio.render();
  return studio.selectedObject;
}

load(); await doubleClick(50, 60);
assert.equal(studio.isEditingDialogue, true, 'Double-click opens a topmost dialogue in Select');
assert.equal(editor.hidden, false); assert.equal(input.value, base.text);
const beforeDraft = studio.project;
await draft('First line'); await draft('First line\nA second line');
assert.deepEqual(studio.project, beforeDraft, 'Typing stays in a draft until the inline edit is committed');
const enter = await key('Enter');
assert.equal(enter.defaultPrevented, false, 'Enter remains native multiline text editing');
assert.equal(studio.isEditingDialogue, true);
for (const [name, extra] of [['Backspace', {}], ['Delete', {}], ['z', { ctrlKey: true }], ['c', { metaKey: true }], ['v', { ctrlKey: true }]]) {
  const value = await key(name, extra);
  assert.equal(value.defaultPrevented, false, 'Native text shortcut ' + name + ' is not intercepted as a scene command');
  assert.equal(studio.isEditingDialogue, true);
  assert.equal(studio.getScene().objects.length, 1, 'Text deletion does not remove its scene object');
}
await key('Enter', { ctrlKey: true, isComposing: true });
assert.equal(studio.isEditingDialogue, true, 'A composing Enter does not submit unfinished IME text');
await key('Escape', { keyCode: 229 });
assert.equal(studio.isEditingDialogue, true, 'Composition key events are not cancellation commands');
await key('Enter', { ctrlKey: true });
assert.equal(studio.isEditingDialogue, false); assert.equal(editor.hidden, true);
assert.equal(studio.getScene().objects[0].text, 'First line\nA second line');
studio.undo(); assert.deepEqual(studio.project, beforeDraft, 'An entire multiline edit is one Undo action');
studio.redo(); assert.equal(studio.getScene().objects[0].text, 'First line\nA second line');

// No-op edits and cancellation must not sit in front of the preceding real edit.
for (const cancel of [false, true]) {
  load(); studio.updateSelected({ x: base.x + 1 });
  assert.equal(studio.editDialogue(), true);
  if (cancel) { await draft('Words that should be cancelled'); await key('Escape'); }
  else studio.finishDialogueEditing(true);
  assert.equal(studio.isEditingDialogue, false); assert.equal(studio.getScene().objects[0].text, base.text);
  studio.undo(); assert.equal(studio.getScene().objects[0].x, base.x, 'A no-op or cancelled edit does not add an Undo entry');
}

load(); studio.editDialogue(); await draft('Committed on blur'); await fire(input, 'blur');
assert.equal(studio.isEditingDialogue, false); assert.equal(studio.getScene().objects[0].text, 'Committed on blur');
for (const name of ['Enter', 'F2']) {
  load(); const opened = await fire(canvas, 'keydown', { key: name });
  assert.equal(opened.defaultPrevented, true); assert.equal(studio.isEditingDialogue, true, name + ' opens the selected dialogue without a mouse');
  studio.finishDialogueEditing(false);
}
load(); await fire(node('editDialogueOnCanvasBtn'), 'click');
assert.equal(studio.isEditingDialogue, true, 'The inspector offers a keyboard-accessible Edit on canvas control');
await draft('Committed with Command Enter'); await key('Enter', { metaKey: true });
assert.equal(studio.isEditingDialogue, false); assert.equal(studio.getScene().objects[0].text, 'Committed with Command Enter');
load(); studio.editDialogue(); await draft('Committed by the Done control'); await clickEditorControl('finishInlineDialogueBtn');
assert.equal(studio.getScene().objects[0].text, 'Committed by the Done control');
load(); studio.editDialogue(); await draft('Cancelled by the button'); await clickEditorControl('cancelInlineDialogueBtn');
assert.equal(studio.getScene().objects[0].text, base.text);
assert.equal(studio.isEditingDialogue, false);

load(); await doubleClick(450, 300); assert.equal(studio.isEditingDialogue, false, 'Empty canvas does not open the editor');
for (const tool of ['paint', 'erase', 'hand']) {
  load(); studio.setTool(tool); const before = studio.project; await doubleClick(50, 60);
  assert.equal(studio.isEditingDialogue, false, tool + ' keeps its own behavior'); assert.deepEqual(studio.project, before);
}
const asset = studio.assets[0];
load({}, [{ id: 'covering-piece', kind: 'sprite', assetId: asset.id, sx: 0, sy: 0, sw: 40, sh: 40, x: 20, y: 30,
  scale: 1, rotation: 0, keyColor: null, flipX: false, flipY: false, layer: 'overlay' }]);
await doubleClick(40, 50); assert.equal(studio.isEditingDialogue, false, 'Double-click does not edit dialogue through a covering piece');

load({ w: 100, h: 50, scale: 2 });
studio.zoomAt(1.37); studio.render(); studio.editDialogue(); await settle();
const near = (actual, expected, name) => assert(Math.abs(parseFloat(actual) - expected) < 1e-6, name + ': ' + actual + ' versus ' + expected);
function checkGeometry() {
  const zoom = studio.view.zoom, padding = parseFloat(wrap.style.padding), object = studio.selectedObject;
  near(editor.style.left, padding + object.x * zoom, 'Overlay horizontal placement follows canvas zoom and pasteboard padding');
  near(editor.style.top, padding + object.y * zoom, 'Overlay vertical placement follows the dialogue');
  near(editor.style.width, object.w * object.scale * zoom, 'Legacy object scale is included in editor width');
  near(editor.style.height, object.h * object.scale * zoom, 'Legacy object scale is included in editor height');
  const layout = studio.getDialogueLayout(object), scale = object.scale * zoom;
  near(input.style.left, layout.padding * scale, 'Editable text begins at the dialogue left inset');
  near(input.style.top, layout.padding * scale, 'Editable text begins at the dialogue top inset');
  near(input.style.width, layout.contentWidth * scale, 'Normal text width matches the rendered content area');
  near(input.style.height, layout.contentHeight * scale, 'Normal text height matches the rendered content area');
}
checkGeometry(); viewport.scrollLeft = 70; viewport.scrollTop = 30; await fire(viewport, 'scroll'); await settle(); checkGeometry();
studio.zoomAt(2); studio.render(); await settle();
assert.equal(studio.isEditingDialogue, true, 'View changes do not silently discard a draft'); checkGeometry();
studio.finishDialogueEditing(false);
load({ x: -25, y: -10, w: 100, h: 50, scale: 2 }); studio.zoomAt(1.37); studio.render(); studio.editDialogue(); await settle();
assert(parseFloat(editor.style.left) < parseFloat(wrap.style.padding), 'The edited dialogue can remain beyond the canvas edge');
const visibleInputLeft = -25 * studio.view.zoom + parseFloat(input.style.left), visibleInputTop = -10 * studio.view.zoom + parseFloat(input.style.top);
assert(visibleInputLeft >= 8 && visibleInputTop >= 38, 'Off-frame typing is moved into the visible viewport');
assert(visibleInputLeft + parseFloat(input.style.width) <= viewport.clientWidth - 8);
assert(visibleInputTop + parseFloat(input.style.height) <= viewport.clientHeight - 8);
studio.finishDialogueEditing(false);
load({ w: 5000, h: 3000 }); studio.editDialogue(); await settle();
assert(parseFloat(editor.style.width) <= viewport.clientWidth && parseFloat(editor.style.height) <= viewport.clientHeight, 'Huge boxes do not create an unbounded editing overlay');
assert(parseFloat(input.style.width) <= viewport.clientWidth - 16 && parseFloat(input.style.height) <= viewport.clientHeight - 58, 'The native editor stays usable on very large dialogue');
studio.finishDialogueEditing(false);

load(); await settle(); traces.length = 0;
node('sceneGrid').checked = !node('sceneGrid').checked; await fire(node('sceneGrid'), 'change'); await settle();
assert(traces.some(trace => trace.canvas === canvas && trace.method === 'fillText' && trace.args[0] === base.text));
studio.editDialogue(); await settle(); traces.length = 0;
node('sceneGrid').checked = !node('sceneGrid').checked; await fire(node('sceneGrid'), 'change'); await settle();
assert(traces.some(trace => trace.canvas === canvas && trace.method === 'clearRect'), 'A normal grid change redraws the scene while its text is being edited');
assert(!traces.some(trace => trace.canvas === canvas && trace.method === 'fillText' && trace.args[0] === base.text), 'The old canvas text is hidden during an actual redraw while the overlay is editing it');
await draft('Exported inline words'); traces.length = 0;
await fire(node('exportBtn'), 'click'); await settle();
assert.equal(studio.isEditingDialogue, false, 'Export finishes the active draft first');
assert.equal(studio.getScene().objects[0].text, 'Exported inline words');
assert(traces.some(trace => trace.canvas !== canvas && trace.canvas.width === 480 && trace.canvas.height === 320 && trace.method === 'fillText' && trace.args[0] === 'Exported inline words'), 'The PNG renderer receives the committed words');

load(); studio.editDialogue(); await draft('Portable inline words'); studio.saveProject();
assert.equal(studio.isEditingDialogue, false);
const download = profile.downloads.at(-1), portable = JSON.parse(await profile.blobs.get(download.href).text());
assert.equal(portable.slides[0].objects[0].text, 'Portable inline words', 'Save project includes the active draft');
load(); studio.editDialogue(); await draft('Reopened inline words'); profile.close(); profile.save(); await settle();
assert.equal(studio.isEditingDialogue, false);
const reopened = await browser(profile.storage, { scripts });
assert.equal(reopened.scene.getScene().objects[0].text, 'Reopened inline words', 'Closing the app preserves the active words locally');

load(); studio.editDialogue(); await draft('Old scene remains correct'); studio.switchSlide('other-inline-scene');
assert.equal(studio.isEditingDialogue, false); assert.equal(studio.getScene().objects.length, 0);
assert.equal(studio.project.slides.find(slide => slide.id === 'inline-scene').objects[0].text, 'Old scene remains correct', 'Switching scenes commits to the original target');
load(); studio.editDialogue(); await draft('Words before selection changed'); studio.select(null);
assert.equal(studio.isEditingDialogue, false); assert.equal(studio.getScene().objects[0].text, 'Words before selection changed');
load(); studio.editDialogue(); await draft('Undo this draft'); studio.undo();
assert.equal(studio.isEditingDialogue, false); assert.equal(studio.getScene().objects[0].text, base.text, 'Undo closes and reverts the active inline edit');
load(); studio.editDialogue(); await draft('Before animation switch');
profile.sandbox.document.body.classList.add('animation-mode');
for (const callback of profile.events.get('minish:workspace-changed') || []) callback({ detail: { mode: 'animation' } });
assert.equal(studio.isEditingDialogue, false); assert.equal(studio.getScene().objects[0].text, 'Before animation switch');

load(); studio.editDialogue();
const literal = '<img src=x onerror="inlineSecret()"> & <script>inlineSecret()</script>';
await draft(literal); studio.finishDialogueEditing(true);
assert.equal(studio.getScene().objects[0].text, literal, 'HTML-looking text is retained literally');
assert.equal(markupAssignments.length, 0, 'User words are never assigned to an HTML sink');
studio.editDialogue(); await draft('A'.repeat(5100)); studio.finishDialogueEditing(true);
assert.equal(studio.getScene().objects[0].text.length, 5000, 'Programmatic input cannot exceed the saved dialogue limit');
assert.equal(profile.networkAttempts.length, 0, 'Inline text editing and its exports stay local');

console.log('PASS: inline dialogue activation, native typing and IME, atomic Undo/cancel, zoom/scale geometry, rendering, portable saves, exports, scene/mode safety and plain-text privacy.');
