// Windows and Mac control regressions. Run: node tests/controls.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'controls.js'), 'utf8');

class Element {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toUpperCase(); this.attributes = { ...attributes }; this.dataset = {}; this.listeners = {};
    this.id = attributes.id || ''; this.textContent = ''; this.title = attributes.title || ''; this.value = attributes.value || '';
    this.hidden = false; this.isContentEditable = false; this.children = [];
    for (const [key, value] of Object.entries(attributes)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_m, char) => char.toUpperCase())] = value;
  }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'title') this.title = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  append(...children) { this.children.push(...children); }
  showModal() { this.open = true; } close() { this.open = false; }
  fire(name) { for (const listener of this.listeners[name] || []) listener({ target: this }); }
  closest(selector) {
    if (this.isContentEditable && /contenteditable/.test(selector)) return this;
    return selector.split(',').some(part => {
      const role = part.trim().match(/^\[role="([^"]+)"\]$/);
      return role ? this.attributes.role === role[1] : part.trim().toUpperCase() === this.tagName;
    }) ? this : null;
  }
}

function harness(navigator = {}, initialStorage = []) {
  const nodes = [], elements = new Map(), storage = new Map(initialStorage), events = new Map();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const attributes = Object.fromEntries([...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map(value => [value[1], value[2]]));
    const element = new Element(match[1], attributes); nodes.push(element);
    if (element.id) elements.set(element.id, element);
  }
  const document = {
    readyState: 'complete', documentElement: { dataset: {}, setAttribute() {} },
    getElementById: id => elements.get(id) || null,
    createElement: tag => new Element(tag),
    querySelector: selector => selector === 'dialog[open]' ? null : document.querySelectorAll(selector)[0] || null,
    querySelectorAll(selector) {
      return nodes.filter(node => selector.split(',').some(raw => {
        const part = raw.trim(), id = part.match(/^#([\w-]+)$/), attr = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
        return id ? node.id === id[1] : attr ? attr[1] in node.attributes && (attr[2] == null || node.attributes[attr[1]] === attr[2]) : node.tagName === part.toUpperCase();
      }));
    },
    addEventListener(name, listener) { (events.get(name) || (events.set(name, []), events.get(name))).push(listener); },
    dispatchEvent(event) { for (const listener of events.get(event.type) || []) listener(event); }
  };
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
  const window = { navigator, localStorage, addEventListener() {} };
  const context = vm.createContext({ window, document, navigator, localStorage, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  vm.runInContext(source, context);
  return { controls: window.MINISH_CONTROLS, elements, storage, document };
}

const win = harness({ platform: 'Win32', userAgent: 'Windows NT 10.0' });
const controls = win.controls;
assert(controls, 'Shared control mappings load offline');
assert.equal(controls.detectPlatform({ platform: 'Win32' }), 'windows');
assert.equal(controls.detectPlatform({ platform: 'MacIntel' }), 'mac');
assert.equal(controls.detectPlatform({ userAgentData: { platform: 'Windows' } }), 'windows');
assert.equal(controls.detectPlatform({ userAgentData: { platform: 'macOS' } }), 'mac');
assert.equal(controls.resolvePlatform('auto', { platform: 'MacIntel' }), 'mac');
assert.equal(controls.resolvePlatform('auto', { platform: 'Win32' }), 'windows');
for (const preference of ['windows', 'mac', 'both']) assert.equal(controls.resolvePlatform(preference, { platform: 'MacIntel' }), preference, 'A manual keyboard hint choice overrides detection');

const event = (key, extra = {}) => ({ key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  isComposing: false, defaultPrevented: false, target: new Element('canvas'), getModifierState: () => false, ...extra });
for (const modifier of ['ctrlKey', 'metaKey']) {
  for (const [key, action] of [['s', 'save'], ['o', 'open'], ['z', 'undo'], ['y', 'redo'], ['d', 'duplicate'], ['c', 'copy'], ['x', 'cut'], ['v', 'paste']]) {
    assert.equal(controls.actionFor(event(key, { [modifier]: true })), action, 'Both keyboard modifier families support ' + action);
    assert.equal(controls.actionFor(event(key.toUpperCase(), { [modifier]: true })), action, 'Shortcut letters are case-insensitive');
  }
  assert.equal(controls.actionFor(event('z', { [modifier]: true, shiftKey: true })), 'redo', 'Shift+primary+Z supports Mac and Windows redo');
  for (const key of ['Delete', 'Backspace']) assert.equal(controls.actionFor(event(key, { [modifier]: true, shiftKey: true })), 'deleteCanvas');
}
for (const [key, action] of [['b', 'paint'], ['v', 'select'], ['e', 'erase'], ['t', 'dialogue'], ['Delete', 'delete'], ['Backspace', 'delete'], ['Escape', 'deselect'], ['?', 'help'], ['ArrowLeft', 'nudgeLeft'], ['ArrowRight', 'nudgeRight'], ['ArrowUp', 'nudgeUp'], ['ArrowDown', 'nudgeDown']]) {
  assert.equal(controls.actionFor(event(key)), action);
}
assert.equal(controls.actionFor(event('ArrowDown', { shiftKey: true })), 'nudgeDown', 'Shift+arrows retain the nudge action for the engine grid step');
for (const [key, action] of [['+', 'zoomIn'], ['=', 'zoomIn'], ['-', 'zoomOut'], ['0', 'actualSize'], ['f', 'fit'], ['[', 'backward'], [']', 'forward'], ['{', 'sendBack'], ['}', 'bringFront']]) assert.equal(controls.actionFor(event(key)), action);
for (const id of ['sceneObjects', 'animObjects']) {
  const target = new Element('select', { id });
  for (const key of ['Delete', 'Backspace']) assert.equal(controls.actionFor(event(key, { target })), 'delete', 'A focused piece list permits piece deletion');
  assert.equal(controls.actionFor(event('c', { target, metaKey: true })), 'copy');
  assert.equal(controls.actionFor(event('Backspace', { target, ctrlKey: true, shiftKey: true })), 'deleteCanvas');
  for (const key of ['ArrowDown', 't', 'b', '0', '[']) assert.equal(controls.actionFor(event(key, { target })), null, 'Piece lists retain native navigation and type-to-select');
}

// Native editing, international input and already-handled widget keys must not
// mutate a selected scene piece or trigger a browser download.
for (const tag of ['input', 'textarea', 'select']) {
  const target = new Element(tag);
  for (const key of ['b', 't', 'Delete', 'Backspace', 'ArrowRight']) assert.equal(controls.actionFor(event(key, { target })), null, tag + ' keeps native keyboard behavior');
  for (const modifier of ['ctrlKey', 'metaKey']) for (const key of ['z', 'y', 'd', 'c', 'x', 'v']) assert.equal(controls.actionFor(event(key, { target, [modifier]: true })), null, 'Text controls retain native editing shortcuts');
  assert.equal(controls.actionFor(event('Backspace', { target, ctrlKey: true, shiftKey: true })), null, 'Whole-scene deletion never overrides field editing');
}
const editable = new Element('div'); editable.isContentEditable = true;
assert.equal(controls.actionFor(event('Delete', { target: editable })), null);
for (const key of ['s', 'o', 'z', 't', 'Delete', 'ArrowRight']) {
  const command = ['s', 'o', 'z'].includes(key) ? { ctrlKey: true } : {};
  assert.equal(controls.actionFor(event(key, { ...command, defaultPrevented: true })), null, 'Handled widget events stay handled');
  assert.equal(controls.actionFor(event(key, { ...command, isComposing: true })), null, 'IME composition is protected');
  assert.equal(controls.actionFor(event(key, { ...command, keyCode: 229 })), null, 'Legacy composition events are protected');
  assert.equal(controls.actionFor(event(key, { ...command, altKey: true })), null, 'Option/Alt combinations do not trigger scene commands');
  assert.equal(controls.actionFor(event(key, { ...command, ctrlKey: true, altKey: true, getModifierState: name => name === 'AltGraph' })), null, 'AltGr input is protected');
}
for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) for (const key of ['ArrowLeft', 'ArrowUp', 'Delete', 'Backspace']) {
  assert.equal(controls.actionFor(event(key, { [modifier]: true })), null, 'Modified navigation and deletion keep their native meaning');
}
for (const role of ['textbox', 'combobox', 'spinbutton']) {
  const target = new Element('div', { role });
  for (const key of ['ArrowDown', 'Backspace', 't']) assert.equal(controls.actionFor(event(key, { target })), null, 'ARIA editing controls keep native behavior');
}
for (const [key, modifiers] of [['s', { ctrlKey: true }], ['o', { metaKey: true }], ['d', { metaKey: true }], ['c', { ctrlKey: true }], ['x', { metaKey: true }], ['v', { ctrlKey: true }], ['Backspace', { metaKey: true, shiftKey: true }], ['t', {}], ['?', {}]]) {
  assert.equal(controls.actionFor(event(key, { ...modifiers, repeat: true })), null, 'Held keys do not repeat one-shot actions');
}
assert.equal(controls.actionFor(event('ArrowRight', { repeat: true })), 'nudgeRight', 'Holding an arrow still nudges repeatedly');
for (const key of ['s', 'o', 'd', 'y']) assert.equal(controls.actionFor(event(key, { ctrlKey: true, shiftKey: true })), null, 'Unassigned shifted browser shortcuts are not intercepted');
for (const key of ['Dead', 'Process', 'Unidentified', '']) assert.equal(controls.actionFor(event(key)), null);

// The preference affects labels, never the accepted modifier family.
const chooser = win.elements.get('controlPlatform');
assert(chooser, 'Users can change the keyboard hint platform');
for (const preference of ['windows', 'mac', 'both']) {
  chooser.value = preference; chooser.fire('change'); controls.renderLabels();
  const expectedModifier = preference === 'windows' ? /Ctrl/ : preference === 'mac' ? /Command|⌘/ : /Ctrl/;
  const expectedPrecision = preference === 'windows' ? /Alt/ : preference === 'mac' ? /Option|⌥/ : /Alt/;
  assert.match(controls.modifierLabel, expectedModifier);
  assert.match(controls.precisionLabel, expectedPrecision);
  assert.match(win.elements.get('undoBtn').title, expectedModifier, 'Undo tooltip follows the selected platform');
  assert.equal(controls.actionFor(event('s', { ctrlKey: true })), 'save');
  assert.equal(controls.actionFor(event('s', { metaKey: true })), 'save');
}
assert(win.storage.size > 0, 'The keyboard hint preference is retained locally');
assert.equal(win.storage.size, 1, 'Only the control-label preference is stored by this module');
const restored = harness({ platform: 'MacIntel' }, win.storage);
assert.match(restored.controls.modifierLabel, /Ctrl/);
assert.match(restored.controls.modifierLabel, /Command|⌘/, 'Both-platform preference survives a reload');
const table = win.elements.get('controlRows');
assert(table?.children.length >= 16, 'The guide explains keyboard controls for both platforms');
assert(table.children.every(row => row.children.length === 3 && row.children[0].getAttribute('scope') === 'row'), 'Each control has a labeled Windows and Mac comparison row');
const tableText = table.children.map(row => row.children.map(cell => cell.textContent).join(' ')).join('\n');
assert.match(tableText, /Ctrl\+S/); assert.match(tableText, /Command\+S/); assert.match(tableText, /Option/); assert.match(tableText, /Alt/);
chooser.value = 'mac'; chooser.fire('change');
assert.match(win.elements.get('precisionKeyLabel').textContent, /Option/);
assert.match(win.elements.get('precisionGuideKey').textContent, /Option/);
assert.match(win.elements.get('redoBtn').title, /Command\+Shift\+Z/);
assert.match(win.elements.get('undoBtn').getAttribute('aria-keyshortcuts'), /Control\+z/);
assert.match(win.elements.get('undoBtn').getAttribute('aria-keyshortcuts'), /Meta\+z/);
win.elements.get('controlsBtn').fire('click'); assert.equal(win.elements.get('controlsDialog').open, true);
win.elements.get('closeControlsBtn').fire('click'); assert.equal(win.elements.get('controlsDialog').open, false);

console.log('PASS: Windows and Mac shortcuts, keyboard hint overrides, redo conventions, native editing, widget events, IME/AltGr protection, and modifier-safe navigation/deletion.');
