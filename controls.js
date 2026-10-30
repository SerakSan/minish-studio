(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE = 'minish-maker-control-platform';
  const detectPlatform = (info = window.navigator || {}) => /mac|iphone|ipad|ipod/i.test(String(info.userAgentData?.platform || info.platform || info.userAgent || '')) ? 'mac' : 'windows';
  const resolvePlatform = (preference = 'auto', info = window.navigator || {}) => ['mac', 'windows', 'both'].includes(preference) ? preference : detectPlatform(info);
  let preference = 'auto';
  try { const saved = localStorage.getItem(STORAGE); if (['auto', 'windows', 'mac', 'both'].includes(saved)) preference = saved; } catch (_) {}
  const platform = () => resolvePlatform(preference);
  const precisionLabel = () => platform() === 'mac' ? 'Option' : platform() === 'windows' ? 'Alt' : 'Alt / Option';
  function actionFor(event, allowRepeat = false) {
    if (!event || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return null;
    const key = String(event.key || ''), lower = key.toLowerCase();
    if (event.altKey || ['Dead', 'Process', 'Unidentified'].includes(key)) return null;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && (lower === 's' || lower === 'o')) return event.repeat && !allowRepeat ? null : lower === 's' ? 'save' : 'open';
    const target = event.target, pieceList = ['sceneObjects', 'animObjects'].includes(target?.id);
    if (!pieceList && (/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '') || target?.isContentEditable || target?.closest?.('[role="textbox"], [role="combobox"], [role="spinbutton"]'))) return null;
    if (mod) {
      if (event.shiftKey && (key === 'Delete' || key === 'Backspace')) return event.repeat && !allowRepeat ? null : 'deleteCanvas';
      if (lower === 'z') return event.shiftKey ? 'redo' : 'undo';
      if (!event.shiftKey && lower === 'y') return 'redo';
      if (!event.shiftKey && lower === 'd') return event.repeat && !allowRepeat ? null : 'duplicate';
      if (!event.shiftKey && ['c', 'x', 'v'].includes(lower)) return event.repeat && !allowRepeat ? null : { c: 'copy', x: 'cut', v: 'paste' }[lower];
      return null;
    }
    if (!event.shiftKey && (key === 'Delete' || key === 'Backspace')) return 'delete';
    if (key === 'Escape') return 'deselect';
    if (pieceList) return null;
    if (key === '?') return event.repeat && !allowRepeat ? null : 'help';
    if (key.startsWith('Arrow')) return { ArrowLeft: 'nudgeLeft', ArrowRight: 'nudgeRight', ArrowUp: 'nudgeUp', ArrowDown: 'nudgeDown' }[key] || null;
    if (key === '+' || key === '=') return 'zoomIn';
    if (key === '-' || key === '_') return 'zoomOut';
    if (!event.shiftKey && key === '0') return 'actualSize';
    if (!event.shiftKey && lower === 'f') return 'fit';
    if (key === '[' || key === '{') return event.shiftKey || key === '{' ? 'sendBack' : 'backward';
    if (key === ']' || key === '}') return event.shiftKey || key === '}' ? 'bringFront' : 'forward';
    const action = { b: 'paint', v: 'select', e: 'erase', t: 'dialogue' }[lower] || null;
    return event.repeat && !allowRepeat && action === 'dialogue' ? null : action;
  }
  const shortcuts = {
    open: ['Ctrl+O', 'Command+O', 'Control+o Meta+o'], save: ['Ctrl+S', 'Command+S', 'Control+s Meta+s'],
    undo: ['Ctrl+Z', 'Command+Z', 'Control+z Meta+z'], redo: ['Ctrl+Y or Ctrl+Shift+Z', 'Command+Shift+Z', 'Control+y Control+Shift+z Meta+Shift+z Meta+y'],
    duplicate: ['Ctrl+D', 'Command+D', 'Control+d Meta+d'], delete: ['Delete or Backspace', 'Delete (⌫) or Fn+Delete', 'Delete Backspace'],
    copy: ['Ctrl+C', 'Command+C', 'Control+c Meta+c'], cut: ['Ctrl+X', 'Command+X', 'Control+x Meta+x'], paste: ['Ctrl+V', 'Command+V', 'Control+v Meta+v'],
    deleteCanvas: ['Ctrl+Shift+Delete or Backspace', 'Command+Shift+Delete (⌫)', 'Control+Shift+Delete Control+Shift+Backspace Meta+Shift+Delete Meta+Shift+Backspace']
  };
  function shortcut(action) {
    const pair = shortcuts[action];
    return pair ? platform() === 'both' ? pair[0] + ' on Windows; ' + pair[1] + ' on Mac' : pair[platform() === 'mac' ? 1 : 0] : '';
  }
  const rows = [
    ['Open project', 'Ctrl+O', 'Command+O'], ['Save project', 'Ctrl+S', 'Command+S'],
    ['Undo', 'Ctrl+Z', 'Command+Z'], ['Redo', 'Ctrl+Y or Ctrl+Shift+Z', 'Command+Shift+Z'],
    ['Duplicate selected piece', 'Ctrl+D', 'Command+D'], ['Delete selected piece', 'Delete or Backspace', 'Delete (⌫); Fn+Delete also works'],
    ['Copy / cut / paste a piece', 'Ctrl+C / Ctrl+X / Ctrl+V', 'Command+C / Command+X / Command+V'],
    ['Delete the current scene', 'Ctrl+Shift+Delete or Backspace', 'Command+Shift+Delete (⌫)'],
    ['Move backward / forward in its layer', '[ / ]', '[ / ]'], ['Send to back / bring to front', 'Shift+[ / Shift+]', 'Shift+[ / Shift+]'],
    ['Zoom canvas in / out', '+ / −; pinch on the canvas', '+ / −; pinch on the canvas'], ['Canvas at 100% / fit', '0 / F', '0 / F'],
    ['Paint / Select / Erase', 'B / V / E', 'B / V / E'], ['Add dialogue', 'T', 'T'],
    ['Move selected piece by 1 px', 'Arrow keys', 'Arrow keys'], ['Move by one grid step', 'Shift+Arrow keys', 'Shift+Arrow keys'],
    ['Precise placement while dragging', 'Hold Alt', 'Hold Option (⌥)'], ['Deselect / dismiss panels', 'Esc', 'Esc'],
    ['Open the guide', '?', '?'], ['Move between controls', 'Tab / Shift+Tab', 'Tab / Shift+Tab'],
    ['Activate a focused button', 'Enter or Space', 'Enter or Space'], ['Change library window', 'Left/Right arrows; Home/End', 'Left/Right arrows; Home/End']
  ];
  function renderLabels() {
    const select = $('controlPlatform'); if (select) select.value = preference;
    if ($('detectedControlPlatform')) $('detectedControlPlatform').textContent = 'Automatic labels: ' + (detectPlatform() === 'mac' ? 'Mac' : 'Windows') + '. Both sets of shortcuts are listed below.';
    for (const [id, action, label] of [['openBtn', 'open', 'Open project'], ['saveBtn', 'save', 'Save project'], ['undoBtn', 'undo', 'Undo'], ['redoBtn', 'redo', 'Redo'], ['duplicateObjectBtn', 'duplicate', 'Duplicate selected piece'], ['deleteObjectBtn', 'delete', 'Delete selected piece'], ['sceneCopyBtn', 'copy', 'Copy selected piece'], ['scenePasteBtn', 'paste', 'Paste copied piece'], ['sceneDuplicateBtn', 'duplicate', 'Duplicate selected piece'], ['sceneDeleteBtn', 'delete', 'Delete selected piece'], ['deleteSlide', 'deleteCanvas', 'Delete this scene'], ['deleteSceneBtn', 'deleteCanvas', 'Delete this scene'], ['animOpenBtn', 'open', 'Open animation project'], ['animSaveBtn', 'save', 'Save animation project'], ['animUndo', 'undo', 'Undo animation change'], ['animRedo', 'redo', 'Redo animation change'], ['animDuplicateObject', 'duplicate', 'Duplicate animated piece'], ['animDeleteObject', 'delete', 'Delete animated piece'], ['animDeleteClip', 'deleteCanvas', 'Delete this clip']]) {
      if (!$(id)) continue;
      $(id).title = label + ' (' + shortcut(action) + ')';
      $(id).setAttribute('aria-keyshortcuts', shortcuts[action][2]);
    }
    if ($('precisionKeyLabel')) $('precisionKeyLabel').textContent = precisionLabel() + ': 1 px · Arrows: nudge';
    if ($('precisionGuideKey')) $('precisionGuideKey').textContent = precisionLabel();
    if ($('precisionBtn')) $('precisionBtn').title = 'Toggle one-pixel placement. Hold ' + precisionLabel() + ' while dragging to temporarily bypass the grid.';
    for (const id of ['nudgeLeft', 'nudgeRight', 'nudgeUp', 'nudgeDown']) if ($(id)) $(id).title = 'Move one native pixel. Hold Shift to move one grid step.';
    const body = $('controlRows');
    if (body && !body.children.length) for (const row of rows) {
      const tr = document.createElement('tr');
      row.forEach((text, index) => { const cell = document.createElement(index ? 'td' : 'th'); cell.textContent = text; if (!index) cell.setAttribute('scope', 'row'); tr.append(cell); });
      body.append(tr);
    }
    const animationRows = $('animationControlRows');
    if (animationRows && !animationRows.children.length) for (const row of [
      ['Play / pause in either mode', 'Space', 'Space'], ['Timeline: previous / next frame', 'Comma / Period', 'Comma / Period'],
      ['Timeline: first / last frame', 'Home / End', 'Home / End'], ['Timeline: add key for selected piece', 'Enter', 'Enter'],
      ['Nudge selected piece', 'Arrows; Shift moves 8 px', 'Arrows; Shift moves 8 px'],
      ['Open / save animation', 'Ctrl+O / Ctrl+S', 'Command+O / Command+S'],
      ['Undo / redo animation', 'Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z', 'Command+Z / Command+Shift+Z'],
      ['Duplicate / delete piece', 'Ctrl+D / Delete or Backspace', 'Command+D / Delete (⌫)'],
      ['Copy / cut / paste piece and animation', 'Ctrl+C / Ctrl+X / Ctrl+V', 'Command+C / Command+X / Command+V'],
      ['Delete the current animation clip', 'Ctrl+Shift+Delete or Backspace', 'Command+Shift+Delete (⌫)'],
      ['Send backward / forward', '[ / ]', '[ / ]'],
      ['Zoom canvas in / out', '+ / −; pinch on the canvas', '+ / −; pinch on the canvas'], ['Canvas at 100% / fit', '0 / F', '0 / F'],
      ['Deselect', 'Esc', 'Esc']
    ]) {
      const tr = document.createElement('tr');
      row.forEach((text, index) => { const cell = document.createElement(index ? 'td' : 'th'); cell.textContent = text; if (!index) cell.setAttribute('scope', 'row'); tr.append(cell); });
      animationRows.append(tr);
    }
    document.dispatchEvent(new CustomEvent('minish:controls-changed'));
  }
  function open() {
    if ($('helpDialog')?.open) $('helpDialog').close();
    renderLabels(); $('controlsDialog')?.showModal();
  }
  window.MINISH_CONTROLS = { detectPlatform, resolvePlatform, actionFor, renderLabels, open, shortcut,
    get platform() { return platform(); }, get precisionLabel() { return precisionLabel(); },
    get modifierLabel() { return platform() === 'mac' ? 'Command' : platform() === 'windows' ? 'Ctrl' : 'Ctrl / Command'; } };
  for (const id of ['controlsBtn', 'menuControlsBtn', 'helpControlsBtn']) $(id)?.addEventListener('click', open);
  $('closeControlsBtn')?.addEventListener('click', () => $('controlsDialog').close());
  $('controlPlatform')?.addEventListener('change', () => {
    preference = ['auto', 'windows', 'mac', 'both'].includes($('controlPlatform').value) ? $('controlPlatform').value : 'auto';
    try { localStorage.setItem(STORAGE, preference); } catch (_) {}
    renderLabels();
  });
  renderLabels();
})();
