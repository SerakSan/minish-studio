(() => {
  'use strict';
  const $ = id => document.getElementById(id), animation = window.MINISH_ANIMATION, studio = window.MINISH_STUDIO;
  if (!animation || !studio || !$('animationWorkspace')) return;
  animation.init(studio);
  const simple = window.MINISH_SIMPLE_ANIMATION?.init(animation, studio);
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const integer = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  const curated = window.MINISH_CURATED || {}, bosses = window.MINISH_BOSSES || {};
  const worlds = window.MINISH_WORLD_MAPS || {};
  const combat = window.MINISH_COMBAT_LIBRARY || {};
  const excluded = new Set([...(curated.excludedPieceIds || []), ...(window.MINISH_SPRITES?.excludedPieceIds || [])].map(String));
  const hiddenSources = new Set((curated.hiddenSourceIds || []).map(String));
  const sources = new Map([...(window.MINISH_ASSETS?.assets || []), ...(curated.catalog || []), ...(worlds.catalog || []), ...(bosses.catalog || [])].map(source => [String(source.id), source]));
  const baseSheets = { ...(curated.sheets || {}), ...(worlds.sheets || {}), ...(bosses.sheets || {}) };
  const sheets = combat.mergeSheets?.(baseSheets) || baseSheets;
  const pieces = new Map(Object.values(sheets).flatMap(sheet => sheet.pieces || []).filter(piece => !excluded.has(String(piece.id)) && !hiddenSources.has(String(piece.sourceId))).map(piece => [String(piece.id), piece]));
  const canvas = $('animationCanvas'), context = canvas.getContext('2d'), overlay = $('animOverlayCanvas'), overlayContext = overlay.getContext('2d');
  let mode = 'scene', state = animation.state, selectedPiece = null, selectedPoses = new Set(), sourceId = '', visiblePoses = [], shown = 64;
  let editorMode = 'simple', libraryView = 'actions', libraryPresetId = 'still', recipeObjectId = null, recipeDirty = false, modeInitialized = false;
  try { editorMode = localStorage.getItem('minish-maker-animation-editor') || (animation.project.clips.some(clip => clip.tracks.some(track => track.keys.length && !clip.objects.find(object => object.id === track.objectId)?.simpleAnimation)) ? 'timeline' : 'simple'); } catch (_) {}
  if (!simple) editorMode = 'timeline';
  const isSimple = () => editorMode === 'simple';
  let zoom = 2, fit = true, drawing = false, drawToken = 0, drag = null, dragKey = null, copyKey = null, lastStructure = '', exportCancelled = false, exporting = false;
  const thumbCache = new Map();
  let staticRasterKey = null, exportCamera = null, fitCenterPending = true, lastFitLayout = '';
  let handTool = false, handDrag = null;
  let pieceClipboard = null, pasteCount = 0, zoomAnchor = null, gestureZoom = null, zoomFieldDraft = false;
  const fieldDrafts = new Set();
  function flushFieldDrafts() {
    const pending = [...fieldDrafts].map(field => ({ field, value: field.value, checked: field.checked }));
    fieldDrafts.clear();
    for (const { field, value, checked } of pending) {
      field.value = value; if (field.type === 'checkbox') field.checked = checked;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  let trackPage = 0, frameCells = [], highlightedFrame = -1;
  const TRACK_PAGE_SIZE = 24;
  const LAYERS = { terrain: 0, objects: 1, overlay: 2 };
  const currentClip = () => state.currentClip || animation.currentClip;
  const selectedId = () => state.selectedObjectId;
  const currentObject = () => selectedId() ? animation.getObjectAt(selectedId(), state.frame) : null;
  const report = message => { $('animStatus').textContent = message; };
  const attempt = fn => { try { return fn(); } catch (error) { report(error.message || 'This animation change could not be applied.'); return null; } };
  const create = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  function setField(id, value) { if (document.activeElement !== $(id)) $(id).value = value == null ? '' : value; }
  function setMode(next) {
    flushFieldDrafts();
    if (mode === 'animation' && next !== 'animation') { finishGestureZoom(); finishHandPan(); }
    mode = next === 'animation' ? 'animation' : 'scene';
    if (mode === 'scene') animation.pause();
    document.body.classList.toggle('animation-mode', mode === 'animation');
    document.body.classList.remove('anim-library-open', 'anim-inspector-open', 'collection-open', 'inspector-open');
    const sceneRoot = $('sceneWorkspace') || document.querySelector('.studio-layout');
    if (sceneRoot) { sceneRoot.hidden = mode === 'animation'; sceneRoot.inert = mode === 'animation'; }
    $('animationWorkspace').hidden = mode !== 'animation'; $('animationWorkspace').inert = mode !== 'animation';
    $('workspaceModeSwitch')?.classList.toggle('is-animation', mode === 'animation');
    $('sceneModeBtn')?.setAttribute('aria-pressed', String(mode === 'scene'));
    $('animationModeBtn')?.setAttribute('aria-pressed', String(mode === 'animation'));
    window.MINISH_EZLO_SWITCH?.setMode(mode, { animate: modeInitialized }); modeInitialized = true;
    try { localStorage.setItem('minish-maker-workspace', mode); } catch (_) {}
    if (mode === 'animation') { render(state); scheduleDraw(); }
    else { studio.render(); window.dispatchEvent(new Event('resize')); }
    document.dispatchEvent(new CustomEvent('minish:workspace-changed', { detail: { mode } }));
  }
  $('sceneModeBtn')?.addEventListener('click', () => setMode('scene'));
  $('animationModeBtn')?.addEventListener('click', () => setMode('animation'));
  function setEditorMode(next, persist = true) {
    flushFieldDrafts(); animation.pause();
    editorMode = simple && next !== 'timeline' ? 'simple' : 'timeline';
    document.body.classList.toggle('anim-simple-mode', isSimple());
    $('animSimpleMode').setAttribute('aria-pressed', String(isSimple()));
    $('animTimelineMode').setAttribute('aria-pressed', String(!isSimple()));
    canvas.setAttribute('aria-label', isSimple() ? 'Animation canvas. Select and drag a piece to place its whole animation. Arrow keys move it one pixel; Shift moves it eight pixels.' : 'Animation canvas. Select and drag a piece. Position edits add a key at the playhead when recording is enabled.');
    $('animEmptyDescription').textContent = isSimple() ? 'Choose a piece and its action, then place it on the canvas. Or bring in a scene you have made.' : 'Choose game poses and arrange their changes on the timeline. You can also import a scene.';
    $('animAddPiece').textContent = isSimple() ? 'Add to canvas' : 'Add to clip';
    if (persist) try { localStorage.setItem('minish-maker-animation-editor', editorMode); } catch (_) {}
    recipeObjectId = null; recipeDirty = false; syncLibraryView(); renderLibrary(); render(animation.state); fitCanvas();
  }
  function setFocus(focused) {
    document.body.classList.toggle('anim-preview-focus', !!focused); document.body.classList.remove('anim-library-open', 'anim-inspector-open');
    $('animFocusBtn').textContent = focused ? 'Show panels' : 'Focus'; $('animFocusBtn').setAttribute('aria-pressed', String(!!focused)); fitCanvas();
  }
  function drawPieceThumbnail(target, piece) {
    target.dataset.piece = String(piece.id);
    if (!thumbCache.has(piece.id)) thumbCache.set(piece.id, studio.getPieceSource(piece));
    thumbCache.get(piece.id).then(source => {
      if (target.dataset.piece !== String(piece.id)) return;
      const ctx = target.getContext('2d'); ctx.clearRect(0, 0, target.width, target.height); ctx.imageSmoothingEnabled = false;
      const box = window.MINISH_THUMBNAILS.layout(piece.sw, piece.sh, target.width, target.height, 2, piece.previewBox);
      if (!box) return;
      ctx.drawImage(source.image, source.sx, source.sy, source.sw, source.sh, box.x, box.y, box.width, box.height);
    }).catch(() => { target.title = 'Keep the assets folder beside the app to preview this game piece.'; });
  }
  function refreshSources() {
    const category = $('animCategory').value, previous = $('animSource').value;
    $('animSource').replaceChildren();
    for (const [id, sheet] of Object.entries(sheets)) {
      if (sheet.category !== category || hiddenSources.has(id)) continue;
      const available = (sheet.pieces || []).filter(piece => pieces.has(String(piece.id)));
      if (!available.length) continue;
      const option = create('option', '', sources.get(id)?.name || sources.get(String(sheet.originalSourceId))?.name || id);
      option.value = id; $('animSource').append(option);
    }
    if ([...$('animSource').options].some(option => option.value === previous)) $('animSource').value = previous;
    sourceId = $('animSource').value; refreshGroups();
  }
  function refreshGroups() {
    sourceId = $('animSource').value;
    libraryPresetId = 'still'; selectedPiece = (sheets[sourceId]?.pieces || []).find(piece => pieces.has(String(piece.id))) || null;
    if (isSimple()) libraryView = simple.cyclesFor(sourceId).length > 1 ? 'actions' : 'poses';
    syncLibraryView();
    $('animPoseGroup').replaceChildren(new Option('All groups', ''));
    const list = (sheets[sourceId]?.pieces || []).filter(piece => pieces.has(String(piece.id)));
    for (const group of [...new Set(list.map(piece => piece.group || piece.phase).filter(Boolean))]) $('animPoseGroup').append(new Option(group, group));
    $('animPoseSearch').value = ''; renderLibrary(true);
  }
  function renderLibrary(reset = true) {
    if (isSimple() && libraryView === 'actions') { renderActionLibrary(); return; }
    if (reset) { shown = 64; $('animPoseGrid').replaceChildren(); }
    const query = $('animPoseSearch').value.trim().toLowerCase(), group = $('animPoseGroup').value;
    visiblePoses = (sheets[sourceId]?.pieces || []).filter(piece => pieces.has(String(piece.id)) && (!group || (piece.group || piece.phase) === group) && (!query || [piece.name, piece.group, piece.phase, piece.sequence, piece.direction].join(' ').toLowerCase().includes(query)));
    $('animLibraryCount').textContent = visiblePoses.length.toLocaleString('en-US') + ' game pieces';
    const start = reset ? 0 : Math.max(0, shown - 64), fragment = document.createDocumentFragment();
    for (const piece of visiblePoses.slice(start, shown)) {
      const entry = create('div', 'anim-pose-entry'), button = create('button', 'anim-pose-card'); button.type = 'button'; button.dataset.piece = piece.id;
      button.title = piece.name + ' · ' + piece.sw + ' × ' + piece.sh + ' px. Double-click to add to the clip.';
      button.setAttribute('aria-label', piece.name + ', ' + (piece.group || '') + ', ' + piece.sw + ' by ' + piece.sh + ' pixels');
      button.classList.toggle('active', selectedPiece?.id === piece.id);
      const image = create('canvas'); image.width = 70; image.height = 60; image.setAttribute('aria-hidden', 'true');
      const label = create('small', '', piece.kind === 'environment' || piece.kind === 'assembled-boss' ? piece.name : String(piece.sequence || '') + ' · ' + piece.sw + ' × ' + piece.sh);
      button.append(image, label); drawPieceThumbnail(image, piece);
      button.addEventListener('click', event => { selectedPiece = piece; if (isSimple()) libraryPresetId = 'still'; else if (event.shiftKey) toggleSequence(piece); updatePoseButtons(); });
      button.addEventListener('dblclick', () => addPiece(piece));
      button.draggable = true;
      button.addEventListener('dragstart', event => { selectedPiece = piece; updatePoseButtons(); beginPieceDrag(event, piece, image); });
      const checkLabel = create('label', 'anim-seq-check'), check = create('input'); check.type = 'checkbox'; check.checked = selectedPoses.has(String(piece.id)); check.setAttribute('aria-label', 'Include ' + piece.name + ' in pose sequence');
      check.addEventListener('change', () => { check.checked ? selectedPoses.add(String(piece.id)) : selectedPoses.delete(String(piece.id)); updatePoseButtons(); });
      checkLabel.append(check, create('span', '', 'Sequence')); entry.append(button, checkLabel); fragment.append(entry);
    }
    $('animPoseGrid').append(fragment); $('animMorePoses').hidden = shown >= visiblePoses.length; updatePoseButtons();
  }
  function syncLibraryView() {
    $('animLibrary').classList.toggle('anim-actions-view', isSimple() && libraryView === 'actions');
    $('animBrowseActions').setAttribute('aria-pressed', String(libraryView === 'actions')); $('animBrowsePoses').setAttribute('aria-pressed', String(libraryView === 'poses'));
    $('animPoseSearch').placeholder = isSimple() && libraryView === 'actions' ? 'Search attacks, tools, walks...' : 'Find a pose or group...';
    $('animPoseSearch').setAttribute('aria-label', isSimple() && libraryView === 'actions' ? 'Find a ready action' : 'Find animation poses');
  }
  function renderActionLibrary() {
    const query = $('animPoseSearch').value.trim().toLowerCase(), available = simple.cyclesFor(sourceId);
    const actions = available.filter(preset => !query || [preset.label, preset.description].join(' ').toLowerCase().includes(query));
    $('animPoseGrid').replaceChildren(); $('animMorePoses').hidden = true;
    $('animLibraryCount').textContent = available.length > 1 ? (available.length - 1) + ' ready ' + (available.length === 2 ? 'action' : 'actions') + ' + still poses' : 'Choose a still pose and add movement';
    for (const preset of actions) {
      const piece = pieces.get(String(preset.poseIds[0])) || (selectedPiece?.sourceId === sourceId ? selectedPiece : (sheets[sourceId]?.pieces || []).find(item => pieces.has(String(item.id))));
      if (!piece) continue;
      const button = create('button', 'anim-pose-card anim-action-card'); button.type = 'button'; button.dataset.preset = preset.id;
      button.classList.toggle('active', libraryPresetId === preset.id); button.setAttribute('aria-pressed', String(libraryPresetId === preset.id));
      const image = create('canvas'); image.width = 64; image.height = 48; image.setAttribute('aria-hidden', 'true');
      button.append(image, create('strong', '', preset.assembly ? preset.label.replace(/\s*·\s*editor assembly$/i, '') : preset.label), create('small', '', preset.assembly ? (preset.repeat === false ? 'Assembly · plays once' : 'Editor assembly') : preset.poseIds.length ? preset.poseIds.length + ' game poses' : 'Choose any pose'));
      button.title = preset.description; drawPieceThumbnail(image, piece);
      const choose = () => { libraryPresetId = preset.id; selectedPiece = piece; updatePoseButtons(); };
      button.addEventListener('click', choose); button.addEventListener('dblclick', () => { choose(); addPiece(piece); });
      button.draggable = true; button.addEventListener('dragstart', event => { choose(); beginPieceDrag(event, piece, image); });
      $('animPoseGrid').append(button);
    }
    if (!actions.length) $('animPoseGrid').append(create('p', 'anim-library-empty', 'No matching actions. Try another search or browse still poses.'));
    updatePoseButtons();
  }
  function toggleSequence(piece) { const id = String(piece.id); selectedPoses.has(id) ? selectedPoses.delete(id) : selectedPoses.add(id); }
  function updatePoseButtons() {
    const preset = simple && isSimple() ? simple.cyclesFor(sourceId).find(value => value.id === libraryPresetId) : null;
    $('animChosenPose').textContent = preset && preset.id !== 'still' ? preset.label : selectedPiece?.name || 'Choose a piece';
    $('animAddPiece').disabled = !selectedPiece; $('animUsePose').disabled = !selectedPiece || currentObject()?.kind !== 'sprite';
    $('animSequenceBtn').disabled = !selectedPoses.size || !!(currentObject() && currentObject().kind !== 'sprite');
    $('animPoseSelectionCount').textContent = selectedPoses.size + (selectedPoses.size === 1 ? ' pose' : ' poses') + ' in sequence';
    $('animPoseGrid').querySelectorAll('.anim-pose-card').forEach(button => { button.classList.toggle('active', button.dataset.piece === selectedPiece?.id); button.classList.toggle('sequence-selected', selectedPoses.has(String(button.dataset.piece))); });
    $('animPoseGrid').querySelectorAll('.anim-pose-entry').forEach(entry => { const id = entry.querySelector('button')?.dataset.piece, check = entry.querySelector('input'); if (check) check.checked = selectedPoses.has(String(id)); });
    $('animPoseGrid').querySelectorAll('[data-preset]').forEach(button => { const active = button.dataset.preset === libraryPresetId; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  }
  function pieceObject(piece, point = null) {
    const clip = currentClip(), category = sheets[String(piece.sourceId)]?.category;
    if (!point && isLargeClip(clip) && piece.kind !== 'environment') {
      const camera = cameraFromView(clip); point = { x: camera.x + camera.w / 2, y: camera.y + camera.h / 2 };
    }
    return { kind: 'sprite', assetId: String(piece.assetId), sourceId: String(piece.sourceId), pieceId: String(piece.id), pieceName: piece.name,
      sx: piece.sx, sy: piece.sy, sw: piece.sw, sh: piece.sh, x: Math.round(point ? point.x - piece.sw / 2 : (clip.width - piece.sw) / 2),
      y: Math.round(point ? point.y - piece.sh / 2 : (clip.height - piece.sh) / 2), scale: 1, flipX: false, flipY: false,
      keyColor: piece.keyColor || null, layer: category === 'environments' || piece.kind === 'tile' ? 'terrain' : 'objects', visible: true };
  }
  function libraryRecipe(piece) {
    if (!isSimple() || !simple) return null;
    const available = simple.cyclesFor(String(piece.sourceId));
    return { presetId: available.some(preset => preset.id === libraryPresetId) ? libraryPresetId : 'still',
      speed: $('animLibrarySpeed').value, motion: $('animLibraryMotion').value, distance: 32 };
  }
  function beginPieceDrag(event, piece, image) {
    const recipe = libraryRecipe(piece);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-minish-animation-piece', piece.id);
    if (recipe) {
      event.dataTransfer.setData('application/x-minish-animation-preset', recipe.presetId);
      event.dataTransfer.setData('application/x-minish-animation-recipe', JSON.stringify({ version: 1, sourceId: String(piece.sourceId), ...recipe }));
    }
    const rect = image.getBoundingClientRect(); event.dataTransfer.setDragImage(image, rect.width / 2, rect.height / 2);
  }
  function addPiece(piece = selectedPiece, point = null, chosenRecipe = null) {
    if (!piece) return;
    // Capture before pausing or selecting a new object can refresh the controls.
    const recipe = isSimple() ? chosenRecipe || libraryRecipe(piece) : null;
    animation.pause(); recipeDirty = false;
    const added = attempt(() => animation.batch(() => { const object = animation.addObject(pieceObject(piece, point), { at: isSimple() ? 0 : state.frame }); if (recipe) simple.apply(object.id, recipe); return object; }));
    if (!added) return;
    window.MINISH_WORLD_ANIMATION_UI?.prepareClip?.(animation.currentClip)?.catch(error => report(error.message));
    document.body.classList.remove('anim-library-open'); $('animLibraryToggle').setAttribute('aria-expanded', 'false');
    report(isSimple() ? 'Piece added. Drag to place it, then press Play.' : piece.name + ' added. Move the playhead and edit to animate it.');
  }
  function scheduleDraw() { if (drawing || mode !== 'animation') return; drawing = true; requestAnimationFrame(() => { drawing = false; draw(); }); }
  function evaluatedScene() {
    const result = animation.evaluateFrame(currentClip(), state.frame);
    if (drag?.preview) { const object = result.objects.find(value => value.id === drag.id); if (object) Object.assign(object, drag.preview); }
    return result;
  }
  const isLargeClip = clip => clip.width > 1024 || clip.height > 1024;
  function cameraFromView(clip = currentClip()) {
    const area = $('animStageViewport').getBoundingClientRect(), frame = canvas.getBoundingClientRect();
    const width = Math.min(clip.width, 1024, Math.max(1, Math.floor($('animStageViewport').clientWidth / zoom)));
    const height = Math.min(clip.height, 576, Math.max(1, Math.floor($('animStageViewport').clientHeight / zoom)));
    const centerX = (area.left + $('animStageViewport').clientWidth / 2 - frame.left) / zoom;
    const centerY = (area.top + $('animStageViewport').clientHeight / 2 - frame.top) / zoom;
    return { x: clamp(Math.round(centerX - width / 2), 0, clip.width - width),
      y: clamp(Math.round(centerY - height / 2), 0, clip.height - height), w: width, h: height };
  }
  function drawCameraGuide(ctx, clip) {
    const opened = $('animExportDialog').open;
    if (!opened || $('animExportArea').value !== 'view') return;
    const camera = opened && exportCamera ? exportCamera : cameraFromView(clip);
    ctx.save(); ctx.lineWidth = 1 / zoom; ctx.strokeStyle = '#ffef91'; ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.strokeRect(camera.x, camera.y, camera.w, camera.h);
    ctx.setLineDash([]); ctx.font = (11 / zoom) + 'px monospace'; ctx.fillStyle = '#ffef91';
    ctx.fillText('Export view', camera.x + 4 / zoom, camera.y + 14 / zoom); ctx.restore();
  }
  function drawLargeClip(clip, scene, previous, vp, layoutGutter) {
    // Keep one native static backdrop. Only visible changing pieces are drawn
    // each frame, on an overlay bounded by the viewport rather than the world.
    const changing = new Set(clip.tracks.filter(track => !track.muted && track.keys.length).map(track => track.objectId));
    if (drag?.preview) changing.add(drag.id);
    const ordered = scene.objects.slice().sort((a, b) => (LAYERS[a.layer] || 0) - (LAYERS[b.layer] || 0));
    let end = ordered.findIndex(object => changing.has(object.id)); if (end < 0) end = ordered.length;
    const prefix = ordered.slice(0, end), rest = ordered.slice(end);
    const key = JSON.stringify([clip.id, clip.width, clip.height, scene.color, scene.transparent, prefix]);
    if (staticRasterKey !== key) {
      context.imageSmoothingEnabled = false; studio.drawSceneToContext(context, { ...scene, objects: prefix });
      staticRasterKey = key;
    }
    const area = vp.getBoundingClientRect(), frame = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(vp.clientWidth)), height = Math.max(1, Math.ceil(vp.clientHeight));
    if (overlay.width !== width || overlay.height !== height) { overlay.width = width; overlay.height = height; }
    overlay.style.width = width + 'px'; overlay.style.height = height + 'px';
    overlay.style.left = (area.left - frame.left + layoutGutter * zoom) + 'px';
    overlay.style.top = (area.top - frame.top + layoutGutter * zoom) + 'px';
    const ctx = overlayContext, gutter = Math.min(512, layoutGutter);
    const view = { x: (area.left - frame.left) / zoom, y: (area.top - frame.top) / zoom, w: width / zoom, h: height / zoom };
    const visible = object => { const b = bounds(object); return b.x < view.x + view.w && b.y < view.y + view.h && b.x + b.w > view.x && b.y + b.h > view.y; };
    const paint = (objects, opacity = 1) => {
      if (!objects.length) return; ctx.save(); ctx.globalAlpha = opacity;
      studio.drawSceneToContext(ctx, { ...scene, transparent: true, objects }, { clear: false }); ctx.restore();
    };
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, width, height);
    ctx.save(); ctx.translate(frame.left - area.left, frame.top - area.top); ctx.scale(zoom, zoom);
    ctx.beginPath(); ctx.rect(-gutter, -gutter, clip.width + gutter * 2, clip.height + gutter * 2); ctx.clip();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, clip.width, clip.height); ctx.clip();
    if (previous) paint(previous.objects.filter(object => changing.has(object.id) && visible(object)), .18);
    paint(rest.filter(visible)); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(-gutter, -gutter, clip.width + gutter * 2, clip.height + gutter * 2); ctx.rect(0, 0, clip.width, clip.height); ctx.clip('evenodd');
    paint(ordered.filter(object => { const b = bounds(object); return visible(object) && (b.x < 0 || b.y < 0 || b.x + b.w > clip.width || b.y + b.h > clip.height); }), .45);
    ctx.restore();
    if ($('animGrid').checked) {
      ctx.save(); ctx.lineWidth = 1 / zoom; ctx.strokeStyle = '#d8e8bc35'; ctx.beginPath();
      for (let x = Math.max(8, Math.ceil(view.x / 8) * 8); x < Math.min(clip.width, view.x + view.w); x += 8) { ctx.moveTo(x, Math.max(0, view.y)); ctx.lineTo(x, Math.min(clip.height, view.y + view.h)); }
      for (let y = Math.max(8, Math.ceil(view.y / 8) * 8); y < Math.min(clip.height, view.y + view.h); y += 8) { ctx.moveTo(Math.max(0, view.x), y); ctx.lineTo(Math.min(clip.width, view.x + view.w), y); }
      ctx.stroke(); ctx.restore();
    }
    drawCameraGuide(ctx, clip);
    const selected = scene.objects.find(object => object.id === selectedId());
    if (selected) { const b = bounds(selected); ctx.lineWidth = 1 / zoom; ctx.strokeStyle = '#fff2b6'; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([3 / zoom, 3 / zoom]); ctx.strokeStyle = '#184e48'; ctx.strokeRect(b.x, b.y, b.w, b.h); }
    ctx.restore();
  }
  async function draw() {
    if (mode !== 'animation') return;
    const token = ++drawToken, clip = currentClip(), scene = evaluatedScene(), previous = !isSimple() && $('animOnion').checked && state.frame > 0 ? animation.evaluateFrame(clip, state.frame - 1) : null;
    if (previous) previous.transparent = true;
    try { await Promise.all([studio.prepareScene(scene), previous ? studio.prepareScene(previous) : Promise.resolve()]); } catch (error) { report(error.message); return; }
    if (token !== drawToken || mode !== 'animation') return;
    if (canvas.width !== clip.width || canvas.height !== clip.height) { canvas.width = clip.width; canvas.height = clip.height; staticRasterKey = null; }
    const vp = $('animStageViewport');
    const fitLayout = [clip.id, clip.width, clip.height, vp.clientWidth, vp.clientHeight].join(':');
    const centerFit = fit && (fitCenterPending || lastFitLayout !== fitLayout);
    if (centerFit) {
      zoomAnchor = null;
      // A panned world's viewport-sized overlay can sit thousands of pixels
      // away. Clear that old overflow before measuring the new fitted canvas.
      overlay.style.left = overlay.style.top = '0px';
      overlay.style.width = overlay.style.height = '1px';
      $('animCanvasWrap').style.transform = 'none';
    }
    if (fit) { const available = Math.min((vp.clientWidth - 32) / clip.width, (vp.clientHeight - 32) / clip.height); zoom = available >= 1 ? clamp(Math.floor(available), 1, 12) : clamp(available, .05, 1); }
    canvas.style.width = clip.width * zoom + 'px'; canvas.style.height = clip.height * zoom + 'px';
    const layoutGutter = Math.ceil((fit ? 16 : Math.max(32, vp.clientWidth, vp.clientHeight)) / zoom), gutter = Math.min(512, layoutGutter);
    $('animCanvasWrap').style.padding = layoutGutter * zoom + 'px';
    if (!isLargeClip(clip)) {
      if (overlay.width !== clip.width + gutter * 2 || overlay.height !== clip.height + gutter * 2) { overlay.width = clip.width + gutter * 2; overlay.height = clip.height + gutter * 2; }
      overlay.style.width = overlay.width * zoom + 'px'; overlay.style.height = overlay.height * zoom + 'px';
      overlay.style.left = (layoutGutter - gutter) * zoom + 'px'; overlay.style.top = (layoutGutter - gutter) * zoom + 'px';
    }
    const wrap = $('animCanvasWrap'); wrap.style.transform = 'none'; const rect = canvas.getBoundingClientRect(), alignX = Math.round(rect.left) - rect.left, alignY = Math.round(rect.top) - rect.top; wrap.style.transform = 'translate(' + alignX + 'px,' + alignY + 'px)';
    if (centerFit) {
      // Use the actual laid-out canvas. A second pass allows native scrollbar
      // clamping and removal to settle before the visible-area overlay returns.
      for (let pass = 0; pass < 2; pass++) {
        const frame = canvas.getBoundingClientRect(), area = vp.getBoundingClientRect();
        vp.scrollLeft += frame.left + frame.width / 2 - area.left - vp.clientWidth / 2;
        vp.scrollTop += frame.top + frame.height / 2 - area.top - vp.clientHeight / 2;
      }
      fitCenterPending = false;
      lastFitLayout = [clip.id, clip.width, clip.height, vp.clientWidth, vp.clientHeight].join(':');
    }
    if (zoomAnchor) { const positioned = canvas.getBoundingClientRect(), viewportRect = vp.getBoundingClientRect(); vp.scrollLeft += positioned.left + zoomAnchor.x * zoom - (viewportRect.left + zoomAnchor.viewportX); vp.scrollTop += positioned.top + zoomAnchor.y * zoom - (viewportRect.top + zoomAnchor.viewportY); zoomAnchor = null; const final = canvas.getBoundingClientRect(); wrap.style.transform = 'translate(' + (alignX + Math.round(final.left) - final.left) + 'px,' + (alignY + Math.round(final.top) - final.top) + 'px)'; }
    if (isLargeClip(clip)) {
      drawLargeClip(clip, scene, previous, vp, layoutGutter);
      updateZoomField(); $('animSizeLabel').textContent = clip.width + ' × ' + clip.height + ' px · ' + clip.fps + ' fps';
      $('animEmpty').hidden = clip.objects.length > 0; return;
    }
    staticRasterKey = null;
    context.imageSmoothingEnabled = false; context.clearRect(0, 0, clip.width, clip.height); studio.drawSceneToContext(context, scene);
    overlayContext.imageSmoothingEnabled = false; overlayContext.clearRect(0, 0, overlay.width, overlay.height); overlayContext.save(); overlayContext.translate(gutter, gutter);
    if (previous) { overlayContext.save(); overlayContext.globalAlpha = .18; studio.drawSceneToContext(overlayContext, previous); overlayContext.restore(); }
    overlayContext.save(); overlayContext.beginPath(); overlayContext.rect(-gutter, -gutter, overlay.width, overlay.height); overlayContext.rect(0, 0, clip.width, clip.height); overlayContext.clip('evenodd'); overlayContext.globalAlpha = .45; studio.drawSceneToContext(overlayContext, scene); overlayContext.restore();
    if ($('animGrid').checked) { overlayContext.save(); overlayContext.lineWidth = 1 / zoom; overlayContext.strokeStyle = '#d8e8bc35'; overlayContext.beginPath(); for (let x = 8; x < clip.width; x += 8) { overlayContext.moveTo(x, 0); overlayContext.lineTo(x, clip.height); } for (let y = 8; y < clip.height; y += 8) { overlayContext.moveTo(0, y); overlayContext.lineTo(clip.width, y); } overlayContext.stroke(); overlayContext.restore(); }
    drawCameraGuide(overlayContext, clip);
    const object = scene.objects.find(value => value.id === selectedId());
    if (object) { const box = bounds(object); overlayContext.lineWidth = 1 / zoom; overlayContext.strokeStyle = '#fff2b6'; overlayContext.strokeRect(box.x, box.y, box.w, box.h); overlayContext.setLineDash([3 / zoom, 3 / zoom]); overlayContext.strokeStyle = '#184e48'; overlayContext.strokeRect(box.x, box.y, box.w, box.h); }
    overlayContext.restore();
    updateZoomField(); $('animSizeLabel').textContent = clip.width + ' × ' + clip.height + ' px · ' + clip.fps + ' fps';
    $('animEmpty').hidden = clip.objects.length > 0;
  }
  function captureZoomAnchor(clientX, clientY) {
    const vp = $('animStageViewport'), area = vp.getBoundingClientRect(), rect = canvas.getBoundingClientRect();
    const px = Number.isFinite(clientX) ? clientX : area.left + vp.clientWidth / 2, py = Number.isFinite(clientY) ? clientY : area.top + vp.clientHeight / 2;
    const displayedZoom = rect.width > 0 && canvas.width > 0 ? rect.width / canvas.width : zoom;
    return { x: (px - rect.left) / displayedZoom, y: (py - rect.top) / displayedZoom, viewportX: px - area.left, viewportY: py - area.top };
  }
  function zoomAt(value, clientX, clientY, capturedAnchor = null) {
    const next = clamp(Number.isFinite(Number(value)) ? Number(value) : zoom, .05, 12);
    zoomAnchor = capturedAnchor || captureZoomAnchor(clientX, clientY);
    fit = false; zoom = next; scheduleDraw(); return zoom;
  }
  function resetZoomInput() { gestureZoom = null; }
  function zoomStep(direction) { resetZoomInput(); return zoomAt(Number((zoom + Math.sign(direction) * .1).toFixed(10))); }
  function fitCanvas() { resetZoomInput(); zoomAnchor = null; fit = true; fitCenterPending = true; scheduleDraw(); }
  function focusArea(area) {
    if (!area || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(Number(area[key]))) || Number(area.w) <= 0 || Number(area.h) <= 0) return;
    const vp = $('animStageViewport'), value = clamp(Math.min(2, vp.clientWidth / (Number(area.w) + 96), vp.clientHeight / (Number(area.h) + 96)), .05, 12);
    resetZoomInput();
    zoomAt(value, undefined, undefined, { x: Number(area.x) + Number(area.w) / 2, y: Number(area.y) + Number(area.h) / 2, viewportX: vp.clientWidth / 2, viewportY: vp.clientHeight / 2 });
  }
  function updateZoomField(force = false) {
    if (force || document.activeElement !== $('animZoomLabel')) $('animZoomLabel').value = Math.round(zoom * 100) + '%';
  }
  function applyZoomField() {
    const field = $('animZoomLabel'), text = field.value.trim().replace(',', '.');
    if (zoomFieldDraft && /^(?:\d+(?:\.\d+)?|\.\d+)\s*%?$/.test(text)) {
      const percentage = Number(text.replace(/\s*%$/, ''));
      if (Number.isFinite(percentage)) { resetZoomInput(); zoomAt(percentage / 100); }
    }
    zoomFieldDraft = false; updateZoomField(true);
  }
  function canZoomInput(event) {
    const target = event?.target;
    return mode === 'animation' && !document.querySelector('dialog[open]') && !event?.defaultPrevented &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '') && !target?.isContentEditable &&
      !target?.closest?.('[role="textbox"], [role="combobox"], [role="spinbutton"]');
  }
  const zoomViewport = $('animStageViewport');
  function preparePanSpace() {
    const frame = canvas.getBoundingClientRect(), wrap = $('animCanvasWrap');
    zoomAt(zoom);
    // Open overflow before the browser performs native wheel scrolling. This
    // changes layout only, so asynchronous artwork preparation cannot lose it.
    // A second pass accounts for browsers whose scrollbars use layout space.
    for (let pass = 0; pass < 2; pass++) {
      wrap.style.padding = Math.ceil(Math.max(32, zoomViewport.clientWidth, zoomViewport.clientHeight) / zoom) * zoom + 'px';
      const positioned = canvas.getBoundingClientRect();
      zoomViewport.scrollLeft += positioned.left - frame.left; zoomViewport.scrollTop += positioned.top - frame.top;
    }
    zoomAnchor = null;
  }
  function updateHandCursor() {
    const cursor = handTool ? handDrag ? 'grabbing' : 'grab' : 'default';
    canvas.style.cursor = cursor; zoomViewport.style.cursor = cursor;
  }
  function finishHandPan() { handDrag = null; updateHandCursor(); }
  function setHandTool(enabled) {
    finishHandPan(); drag = null; handTool = !!enabled; updateHandCursor();
    $('animHandTool')?.setAttribute('aria-pressed', String(handTool));
    $('animSelectTool')?.setAttribute('aria-pressed', String(!handTool));
    if ($('animToolsLabel')) { $('animToolsLabel').textContent = handTool ? 'Hand ▾' : 'Tools ▾'; $('animToolsLabel').setAttribute('data-active-tool', handTool ? 'hand' : 'select'); }
    report(handTool ? 'Hand: drag to move the view. Pinch or Ctrl+wheel zooms. Tools > Select pieces returns to editing.' : 'Select and drag a piece to move it. Choose Tools > Hand to pan the view.');
    scheduleDraw();
  }
  zoomViewport.addEventListener('wheel', event => {
    if (!event.ctrlKey) {
      if (fit && canZoomInput(event) && !event.altKey && !event.metaKey) {
        void event.deltaMode;
        if ((Number.isFinite(event.deltaX) && event.deltaX) || (Number.isFinite(event.deltaY) && event.deltaY)) preparePanSpace();
      }
      return;
    }
    if (!canZoomInput(event) || event.cancelable === false || event.altKey || event.metaKey) return;
    const deltaMode = event.deltaMode;
    if (!Number.isFinite(event.deltaY) || !event.deltaY) return;
    event.preventDefault(); if (gestureZoom || drag || handDrag) return;
    const delta = clamp(event.deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? zoomViewport.clientHeight : 1), -160, 160);
    zoomAt(zoom * Math.exp(-delta * .005), event.clientX, event.clientY);
  }, { passive: false });
  zoomViewport.addEventListener('gesturestart', event => { if (!canZoomInput(event) || drag || handDrag) return; event.preventDefault(); resetZoomInput(); gestureZoom = { zoom }; }, { passive: false });
  zoomViewport.addEventListener('gesturechange', event => { if (!gestureZoom || !canZoomInput(event)) return; event.preventDefault(); const scale = Number(event.scale); zoomAt(gestureZoom.zoom * Math.pow(Number.isFinite(scale) ? Math.max(.01, scale) : 1, 1.25), event.clientX, event.clientY); }, { passive: false });
  function finishGestureZoom(event) {
    if (!gestureZoom) return;
    gestureZoom = null;
    if (canZoomInput(event)) event?.preventDefault();
  }
  zoomViewport.addEventListener('gestureend', finishGestureZoom, { passive: false });
  function normalizeRotation(value) { return studio.spriteGeometry?.normalizeRotation(value) ?? ((Math.round((Number(value) || 0) / 45) * 45 % 360) + 360) % 360; }
  function bounds(object) {
    if (studio.spriteGeometry) return studio.spriteGeometry.bounds(object);
    const scale = object.scale || 1, w = (object.kind === 'sprite' ? object.sw : object.w) * scale, h = (object.kind === 'sprite' ? object.sh : object.h) * scale;
    const angle = (object.kind === 'sprite' ? normalizeRotation(object.rotation) : 0) * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const width = c * w + s * h, height = s * w + c * h;
    return { x: object.x + (w - width) / 2, y: object.y + (h - height) / 2, w: width, h: height };
  }
  function contains(object, position) {
    if (studio.spriteGeometry) return studio.spriteGeometry.contains(object, position);
    const scale = object.scale || 1, w = (object.kind === 'sprite' ? object.sw : object.w) * scale, h = (object.kind === 'sprite' ? object.sh : object.h) * scale;
    const angle = (object.kind === 'sprite' ? normalizeRotation(object.rotation) : 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), dx = position.x - object.x - w / 2, dy = position.y - object.y - h / 2;
    const x = dx * c + dy * s + w / 2, y = -dx * s + dy * c + h / 2;
    return x >= 0 && x < w && y >= 0 && y < h;
  }
  function point(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }; }
  function pointerDown(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || !canZoomInput(event)) return; event.preventDefault(); canvas.focus({ preventScroll: true });
    if (handTool) {
      if (fit) preparePanSpace();
      const pendingLayout = !!zoomAnchor;
      handDrag = { x: event.clientX, y: event.clientY, scrollLeft: zoomViewport.scrollLeft, scrollTop: zoomViewport.scrollTop, pendingLayout };
      (event.currentTarget || zoomViewport).setPointerCapture(event.pointerId); updateHandCursor(); return;
    }
    animation.pause();
    const p = point(event), list = evaluatedScene().objects.slice().sort((a, b) => (LAYERS[a.layer] || 0) - (LAYERS[b.layer] || 0));
    const object = list.reverse().find(value => contains(value, p));
    animation.selectObject(object?.id || null);
    if (!object) return;
    if (animation.getTrack(object.id)?.locked) { report('This track is locked. Unlock it in Settings to move it.'); return; }
    drag = { id: object.id, start: p, origin: { x: object.x, y: object.y }, preview: null, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (handDrag) {
      if (!canZoomInput(event)) { finishHandPan(); return; }
      if (handDrag.pendingLayout) {
        if (zoomAnchor) return;
        handDrag.scrollLeft = zoomViewport.scrollLeft; handDrag.scrollTop = zoomViewport.scrollTop; handDrag.pendingLayout = false;
      }
      zoomViewport.scrollLeft = handDrag.scrollLeft - (event.clientX - handDrag.x);
      zoomViewport.scrollTop = handDrag.scrollTop - (event.clientY - handDrag.y);
      scheduleDraw(); return;
    }
    const p = point(event); $('animCoordinates').textContent = 'X ' + Math.round(p.x) + ' · Y ' + Math.round(p.y);
    if (!drag) return;
    drag.preview = { x: Math.round(drag.origin.x + p.x - drag.start.x), y: Math.round(drag.origin.y + p.y - drag.start.y) };
    $('animCoordinates').textContent = 'X ' + drag.preview.x + ' · Y ' + drag.preview.y; scheduleDraw();
  }
  function pointerUp() {
    if (handDrag) { finishHandPan(); scheduleDraw(); return; }
    const ending = drag; drag = null;
    if (ending?.preview && (ending.preview.x !== ending.origin.x || ending.preview.y !== ending.origin.y)) attempt(() => isSimple() ? simple.moveBase(ending.id, { dx: ending.preview.x - ending.origin.x, dy: ending.preview.y - ending.origin.y }) : animation.updateObject(ending.id, ending.preview, { keyframe: $('animAutoKey').checked, frame: state.frame }));
    scheduleDraw();
  }
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', () => { drag = null; finishHandPan(); scheduleDraw(); });
  $('animStageViewport').addEventListener('pointerdown', event => { if (event.target !== canvas && !$('animEmpty').contains(event.target)) pointerDown(event); });
  $('animStageViewport').addEventListener('pointermove', event => { if (event.target !== canvas) pointerMove(event); });
  $('animStageViewport').addEventListener('pointerup', event => { if (event.target !== canvas) pointerUp(event); });
  $('animStageViewport').addEventListener('pointercancel', () => { drag = null; finishHandPan(); scheduleDraw(); });
  $('animStageViewport').addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-minish-animation-piece')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  $('animStageViewport').addEventListener('drop', event => {
    const id = event.dataTransfer.getData('application/x-minish-animation-piece'); if (!pieces.has(id)) return;
    event.preventDefault(); const piece = pieces.get(id); let recipe = null;
    if (isSimple()) {
      const payload = event.dataTransfer.getData('application/x-minish-animation-recipe');
      if (payload) {
        try {
          if (payload.length > 1024) throw new Error();
          const input = JSON.parse(payload);
          if (input.version !== 1 || String(input.sourceId) !== String(piece.sourceId)) throw new Error();
          recipe = { presetId: input.presetId, speed: input.speed, motion: input.motion, distance: input.distance };
        } catch (_) { report('Could not read this dragged animation. Choose the action and drag it again.'); return; }
      } else {
        recipe = libraryRecipe(piece);
        const presetId = event.dataTransfer.getData('application/x-minish-animation-preset');
        if (presetId) recipe.presetId = presetId;
      }
    }
    addPiece(piece, point(event), recipe);
  });
  function structureSignature(clip) { return JSON.stringify([clip.id, clip.duration, trackPage, clip.objects.map(object => [object.id, object.pieceName, object.kind]), clip.tracks.map(track => [track.objectId, track.name, track.muted, track.locked, track.keys.map(key => key.frame)])]); }
  function renderTimeline(force = false) {
    const clip = currentClip(), signature = structureSignature(clip);
    if (force || signature !== lastStructure) {
      lastStructure = signature; frameCells = Array.from({ length: clip.duration }, () => []); highlightedFrame = -1; const ruler = $('animTimelineRuler'), tracks = $('animTrackRows'); ruler.replaceChildren(create('span', 'anim-ruler-label', 'Tracks ' + (trackPage * TRACK_PAGE_SIZE + 1) + '–' + Math.min(clip.objects.length, (trackPage + 1) * TRACK_PAGE_SIZE) + ' / ' + clip.objects.length)); tracks.replaceChildren();
      for (let frame = 0; frame < clip.duration; frame++) { const tick = create('span', 'anim-frame-tick', frame % Math.max(1, Math.ceil(clip.duration / 24)) === 0 ? String(frame + 1) : ''); tick.dataset.frame = frame; tick.title = 'Frame ' + (frame + 1); tick.addEventListener('click', () => animation.seek(frame)); ruler.append(tick); frameCells[frame].push(tick); }
      ruler.style.minWidth = (145 + clip.duration * 16) + 'px';
      for (const object of clip.objects.slice(trackPage * TRACK_PAGE_SIZE, (trackPage + 1) * TRACK_PAGE_SIZE)) {
        const track = clip.tracks.find(value => value.objectId === object.id), row = create('div', 'anim-track-row'); row.dataset.object = object.id; row.classList.toggle('muted', !!track?.muted); row.classList.toggle('locked', !!track?.locked);
        const name = create('button', 'anim-track-name', track?.name || object.pieceName || (object.kind === 'dialogue' ? 'Dialogue' : 'Piece')); name.title = 'Select ' + name.textContent; name.addEventListener('click', () => animation.selectObject(object.id)); row.append(name);
        const cells = create('div', 'anim-track-cells');
        for (let frame = 0; frame < clip.duration; frame++) {
          const key = track?.keys.find(value => value.frame === frame), cell = create('button', 'anim-frame-cell' + (key ? ' has-key' : ''), key ? '◆' : ''); cell.dataset.frame = frame; cell.title = name.textContent + ' · frame ' + (frame + 1) + (key ? ' · keyframe' : ''); cell.setAttribute('aria-label', cell.title); cell.setAttribute('aria-pressed', 'false'); cell.tabIndex = -1;
          cell.addEventListener('click', () => { animation.selectObject(object.id); animation.seek(frame); });
          cell.addEventListener('keydown', event => {
            if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); const clip = currentClip(); let destination = frame, targetId = object.id;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') destination = clamp(frame + (event.key === 'ArrowLeft' ? -1 : 1), 0, clip.duration - 1);
            else if (event.key === 'Home' || event.key === 'End') destination = event.key === 'Home' ? 0 : clip.duration - 1;
            else { const index = clip.objects.findIndex(item => item.id === object.id), next = clip.objects[clamp(index + (event.key === 'ArrowUp' ? -1 : 1), 0, clip.objects.length - 1)]; targetId = next?.id || object.id; }
            animation.selectObject(targetId); animation.seek(destination);
            const targetRow = [...$('animTrackRows').children].find(value => value.dataset.object === targetId); targetRow?.querySelector('[data-frame="' + destination + '"]')?.focus({ preventScroll: false });
          });
          cell.addEventListener('dblclick', () => { animation.selectObject(object.id); animation.seek(frame); addKey(); });
          if (key) { cell.draggable = true; cell.addEventListener('dragstart', event => { dragKey = { objectId: object.id, frame }; event.dataTransfer.setData('application/x-minish-keyframe', object.id + ':' + frame); event.dataTransfer.effectAllowed = 'move'; }); }
          cell.addEventListener('dragover', event => { if (dragKey) event.preventDefault(); });
          cell.addEventListener('drop', event => { if (!dragKey || dragKey.objectId !== object.id) return; event.preventDefault(); attempt(() => animation.moveKey(object.id, dragKey.frame, frame)); animation.seek(frame); dragKey = null; });
          cell.addEventListener('dragend', () => { dragKey = null; }); cells.append(cell); frameCells[frame].push(cell);
        }
        row.append(cells); tracks.append(row);
      }
    }
    $('animTrackRows').querySelectorAll('.anim-track-row').forEach(row => row.classList.toggle('selected', row.dataset.object === selectedId()));
    updatePlayhead();
    $('animTrackPagePrev').disabled = trackPage <= 0; $('animTrackPageNext').disabled = (trackPage + 1) * TRACK_PAGE_SIZE >= clip.objects.length;
  }
  function updatePlayhead() {
    if (highlightedFrame === state.frame) return;
    for (const [frame, active] of [[highlightedFrame, false], [state.frame, true]]) for (const cell of frameCells[frame] || []) { cell.classList.toggle('current', active); if (cell.tagName === 'BUTTON') { cell.setAttribute('aria-pressed', String(active)); cell.tabIndex = active ? 0 : -1; } }
    highlightedFrame = state.frame;
  }
  function updateTransport() {
    const clip = currentClip(); $('animPlay').textContent = state.playing ? 'Ⅱ Pause' : '▶ Play'; $('animPlay').setAttribute('aria-pressed', String(state.playing)); $('animPlay').setAttribute('aria-label', state.playing ? 'Pause animation' : 'Play animation');
    setField('animFrameNumber', state.frame + 1); $('animScrubber').value = state.frame;
    const seconds = state.frame / clip.fps; $('animTimecode').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + (seconds % 60).toFixed(3).padStart(6, '0');
    $('animSimplePlay').textContent = state.playing ? 'Ⅱ Pause' : '▶ Play'; $('animSimplePlay').setAttribute('aria-pressed', String(state.playing)); $('animSimplePlay').setAttribute('aria-label', state.playing ? 'Pause animation' : 'Play animation');
    $('animSimpleTime').textContent = seconds.toFixed(1) + ' / ' + (clip.duration / clip.fps).toFixed(1) + ' s';
  }
  function keyPatch(object) {
    const keys = object.kind === 'dialogue' ? ['x', 'y', 'scale', 'visible', 'text', 'w', 'h', 'fontSize', 'color', 'box'] : ['x', 'y', 'scale', 'flipX', 'flipY', 'rotation', 'visible', 'assetId', 'sourceId', 'pieceId', 'pieceName', 'sx', 'sy', 'sw', 'sh', 'keyColor'];
    return Object.fromEntries(keys.filter(key => object[key] !== undefined).map(key => [key, object[key]]));
  }
  function addKey() { const object = currentObject(); if (!object) { report('Select a piece or track before adding a key.'); return; } const added = attempt(() => animation.setKey(object.id, state.frame, keyPatch(object), { easing: $('animEasing').value })); if (added !== null) report('Key added at frame ' + (state.frame + 1) + '.'); }
  function updateObject(patch, basePosition = false) {
    const object = currentObject(); if (!object) return; animation.pause();
    if (isSimple()) {
      const base = currentClip().objects.find(item => item.id === object.id), changes = { ...patch };
      if ('x' in changes && !basePosition) changes.x = base.x + changes.x - object.x;
      if ('y' in changes && !basePosition) changes.y = base.y + changes.y - object.y;
      attempt(() => simple.place(object.id, changes));
    } else attempt(() => animation.updateObject(object.id, patch, { keyframe: $('animAutoKey').checked, frame: state.frame }));
  }
  function renderSimple(object) {
    const clip = currentClip(); setField('animSimpleDuration', Math.round(clip.duration / clip.fps * 100) / 100); $('animSimpleDuration').max = 600 / clip.fps;
    $('animSimpleUndo').disabled = !state.canUndo; $('animSimpleRedo').disabled = !state.canRedo;
    if (!object || !simple) return;
    const details = simple.inspect(object), recipe = details.recipe || {}, presets = simple.presetsFor(object), changed = recipeObjectId !== object.id;
    if (changed || !recipeDirty) {
      recipeObjectId = object.id; recipeDirty = false;
      $('animSimplePreset').replaceChildren(...presets.map(preset => new Option(preset.label, preset.id)));
      setField('animSimplePreset', recipe.presetId || 'still'); setField('animSimpleSpeed', recipe.speed || 'normal'); setField('animSimpleMotion', recipe.motion || 'none'); setField('animSimpleDistance', recipe.distance ?? 32);
    }
    $('animSimpleCustom').hidden = !details.needsReplacement; $('animSimpleReplace').hidden = !details.needsReplacement; $('animSimpleApply').hidden = details.needsReplacement;
    $('animSimpleRecipeState').textContent = details.needsReplacement ? 'Custom animation' : recipeDirty ? 'Not applied' : object.simpleAnimation ? 'Ready' : 'Still';
    updateRecipeDescription();
  }
  function updateTimelineStyles(object) {
    const keys = object ? animation.getTrack(object.id)?.keys || [] : [], animated = new Set(keys.flatMap(key => Object.keys(key.values)));
    const controls = [['animObjectScale', 'scale'], ['animFlipX', 'flipX'], ['animFlipY', 'flipY'], ['animObjectRotation', 'rotation'], ['animRotateLeft', 'rotation'], ['animRotateRight', 'rotation'], ['animVisible', 'visible'], ['animObjectLayer', 'layer'], ['animDialogueWidth', 'w'], ['animDialogueHeight', 'h'], ['animDialogueFontSize', 'fontSize'], ['animDialogueColor', 'color'], ['animDialogueBox', 'box']];
    for (const [id, property] of controls) { const governed = isSimple() && animated.has(property); $(id).disabled = governed || (property === 'rotation' && object?.kind !== 'sprite'); if (governed) $(id).setAttribute('aria-describedby', 'animSimpleStyleNotice'); else $(id).removeAttribute('aria-describedby'); }
    $('animSimpleStyleNotice').hidden = !isSimple() || !controls.some(([, property]) => animated.has(property));
  }
  function updateRecipeDescription() {
    const object = currentObject(); if (!object || !simple) return;
    const preset = simple.presetsFor(object).find(item => item.id === $('animSimplePreset').value);
    $('animSimplePresetDescription').textContent = preset?.description || '';
    $('animSimpleDistanceLabel').hidden = $('animSimpleMotion').value === 'none';
    if (recipeDirty) $('animSimpleRecipeState').textContent = 'Not applied';
  }
  function applySimpleRecipe(replaceCustom = false) {
    flushFieldDrafts(); const object = currentObject(); if (!object) return;
    animation.pause();
    const recipe = { presetId: $('animSimplePreset').value, speed: $('animSimpleSpeed').value, motion: $('animSimpleMotion').value, distance: Number($('animSimpleDistance').value), ...(object.kind === 'dialogue' ? { fullText: $('animDialogueText').value } : {}) };
    recipeDirty = false;
    const result = attempt(() => simple.apply(object.id, recipe, { replaceCustom }));
    if (result) { render(animation.state); report('Animation applied. Press Play to preview.'); }
    else { recipeDirty = true; updateRecipeDescription(); }
  }
  function configureClip(patch) {
    return attempt(() => animation.batch(() => {
      animation.configureClip(patch);
      if (simple && ('duration' in patch || 'fps' in patch)) for (const base of animation.currentClip.objects) {
        if (base.simpleAnimation?.version === 1 && !simple.inspect(base).needsReplacement) simple.apply(base.id, simple.getRecipe(base));
      }
    }));
  }
  function render(snapshot) {
    state = snapshot || animation.state;
    if (state.playing && (state.type === 'frame' || state.type === 'playback')) { updateTransport(); if (!isSimple()) updatePlayhead(); scheduleDraw(); return; }
    const clip = currentClip(), object = currentObject(), track = object ? animation.getTrack(object.id) : null;
    if (!clip) return;
    if (selectedId()) { const index = clip.objects.findIndex(item => item.id === selectedId()); if (index >= 0 && Math.floor(index / TRACK_PAGE_SIZE) !== trackPage) trackPage = Math.floor(index / TRACK_PAGE_SIZE); }
    trackPage = Math.min(trackPage, Math.max(0, Math.ceil(clip.objects.length / TRACK_PAGE_SIZE) - 1));
    updateTransport();
    $('animUndo').disabled = !state.canUndo; $('animRedo').disabled = !state.canRedo;
    setField('animProjectName', state.project.name); $('animSaveState').textContent = state.dirty ? 'Project modified' : 'Project ready';
    $('animClipTitle').textContent = clip.name; document.body.classList.toggle('anim-has-selection', !!object); setField('animClipName', clip.name); setField('animDuration', clip.duration); setField('animFps', clip.fps); setField('animLoop', clip.loop); setField('animWidth', clip.width); setField('animHeight', clip.height);
    $('animTransparent').checked = !!clip.transparent; setField('animColor', clip.color || '#819452');
    $('animFrameNumber').max = clip.duration; setField('animFrameNumber', state.frame + 1); $('animScrubber').max = clip.duration - 1; $('animScrubber').value = state.frame;
    const seconds = state.frame / clip.fps; $('animTimecode').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + (seconds % 60).toFixed(3).padStart(6, '0');
    const clipList = $('animClipTabs');
    if (clipList.children.length !== state.project.clips.length || [...clipList.children].some((node, i) => node.dataset.clip !== state.project.clips[i].id || node.textContent !== state.project.clips[i].name)) {
      clipList.replaceChildren(); for (const item of state.project.clips) { const button = create('button', '', item.name); button.dataset.clip = item.id; button.addEventListener('click', () => { drag = null; animation.switchClip(item.id); fitCanvas(); }); clipList.append(button); }
    }
    [...clipList.children].forEach(node => node.setAttribute('aria-current', String(node.dataset.clip === clip.id))); $('animDeleteClip').disabled = false; $('animDeleteClip').title = 'Delete this entire animation clip. Undo restores it.';
    $('animSelectionTools').hidden = !object && !pieceClipboard; $('animSelectionName').textContent = object ? (track?.name || object.pieceName || 'Dialogue') : 'Clipboard ready';
    for (const id of ['animQuickCopy', 'animQuickDuplicate', 'animQuickDelete']) $(id).disabled = !object; $('animQuickPaste').disabled = !pieceClipboard;
    const objectNames = new Map(clip.tracks.map(track => [track.objectId, track.name])); const displayName = item => objectNames.get(item.id) || item.pieceName || (item.kind === 'dialogue' ? 'Dialogue' : 'Piece');
    const list = $('animObjects'); if (list.options.length !== clip.objects.length || [...list.options].some((node, i) => node.value !== clip.objects[i].id || node.textContent !== displayName(clip.objects[i]))) {
      list.replaceChildren(); for (const item of clip.objects) list.append(new Option(displayName(item), item.id));
    }
    list.value = selectedId() || ''; $('animObjectSettings').hidden = !object; $('animDialogueSettings').hidden = !object || object.kind !== 'dialogue';
    for (const id of ['animAddKey', 'animDeleteKey', 'animCopyKey', 'animPrevKey', 'animNextKey']) $(id).disabled = !object;
    $('animPasteKey').disabled = !object || !copyKey;
    if (object) {
      const placement = isSimple() ? clip.objects.find(item => item.id === object.id) : object;
      setField('animObjectName', track?.name || object.pieceName || 'Dialogue'); setField('animObjectX', placement.x); setField('animObjectY', placement.y); setField('animObjectScale', object.scale || 1); setField('animObjectRotation', normalizeRotation(object.rotation)); setField('animObjectLayer', object.layer);
      $('animVisible').checked = object.visible !== false; $('animTrackLocked').checked = !!track?.locked; $('animTrackMuted').checked = !!track?.muted;
      $('animFlipX').classList.toggle('active', !!object.flipX); $('animFlipY').classList.toggle('active', !!object.flipY);
      if (object.kind === 'dialogue') { setField('animDialogueText', isSimple() ? simple.getRecipe(object)?.fullText ?? object.text : object.text); setField('animDialogueWidth', object.w); setField('animDialogueHeight', object.h); setField('animDialogueFontSize', object.fontSize || 12); setField('animDialogueColor', object.color || '#fff7d3'); $('animDialogueBox').checked = object.box !== false; }
      const key = track?.keys.find(value => value.frame === state.frame); if (key) setField('animEasing', key.easing || 'hold');
      $('animKeyHint').textContent = track?.locked ? 'This track is locked. Unlock it before editing its keys.' : key ? 'This frame has a key. Edits update it when Record edits as keys is enabled.' : 'No key at this frame. Add one, or edit with Record edits as keys enabled.';
    }
    updateTimelineStyles(object); if (isSimple()) renderSimple(object); else renderTimeline(); updatePoseButtons(); scheduleDraw();
  }
  function applyMotion() {
    const object = currentObject(); if (!object) return;
    const clip = currentClip(), start = state.frame, length = clamp(integer($('animMotionLength').value, 24), 2, 600), end = start + length - 1, distance = clamp(integer($('animMotionDistance').value, 48), 1, 1024), preset = $('animMotion').value;
    if (end >= 600) { report('Move the playhead earlier or shorten this motion. A clip supports up to 600 frames.'); return; }
    const x = object.x, y = object.y; const changed = attempt(() => animation.batch(() => {
      if (end >= clip.duration) animation.configureClip({ duration: end + 1 });
      animation.setKey(object.id, start, { x, y }, { easing: 'linear' });
      if (preset === 'bob' || preset === 'return') { const middle = Math.round((start + end) / 2); animation.setKey(object.id, middle, preset === 'bob' ? { x, y: y - distance } : { x: x + distance, y }, { easing: 'linear' }); animation.setKey(object.id, end, { x, y }, { easing: 'linear' }); }
      else animation.setKey(object.id, end, { x: x + (preset === 'left' ? -distance : preset === 'right' ? distance : 0), y: y + (preset === 'up' ? -distance : preset === 'down' ? distance : 0) }, { easing: 'linear' });
    })); if (changed !== null) report('Motion keys added. Choose real game poses to animate the action itself.');
  }
  function importCurrentScene() { animation.pause(); const scene = studio.getScene ? studio.getScene() : studio.project.slides.find(value => value.id === studio.project.activeSlide); const imported = attempt(() => animation.importScene(scene, { name: scene.name })); if (!imported) return; fitCanvas(); report('Scene imported as a new clip. Your scene-maker project is unchanged.'); }
  function demo() {
    if (!window.MINISH_ANIMATION_DEMO) { report('The walking demo is not included in this copy. Import a scene or choose game poses instead.'); return; }
    flushFieldDrafts(); animation.pause(); recipeObjectId = null; recipeDirty = false;
    const loaded = attempt(() => animation.batch(() => {
      const data = clone(window.MINISH_ANIMATION_DEMO); if (isSimple()) data.name = 'Walking demo';
      animation.loadProject(data);
      if (isSimple()) {
        for (const clip of data.clips) {
          animation.switchClip(clip.id);
          for (const object of clip.objects.filter(item => String(item.sourceId) === '6369')) simple.apply(object.id, { presetId: 'link-walk-away', speed: 'normal', motion: clip.transparent ? 'none' : 'up', distance: 32 }, { replaceCustom: true });
        }
        animation.switchClip(data.activeClip);
        animation.selectObject(animation.currentClip.objects.find(object => String(object.sourceId) === '6369')?.id || null);
      }
      return animation.project;
    }));
    if (!loaded) return; fitCanvas();
    report(isSimple() ? 'Simple walking demo loaded. Choose a piece to change its action or movement. Undo restores your previous project.' : 'Walking demo loaded. Play it, move keys, or choose your own poses. Undo restores your previous animation.');
  }
  function save() { flushFieldDrafts(); const name = $('animProjectName').value.trim() || 'My animated adventure'; if (name !== state.project.name && attempt(() => animation.renameProject(name)) === null) return; const data = animation.saveData(); download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename(data.name) + '.minish-animation.json'); report('Editable animation project downloaded.'); }
  function filename(value) { return String(value || 'minish-animation').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'minish-animation'; }
  function download(blob, name) { const url = URL.createObjectURL(blob), link = create('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  function exportSummary() {
    const clip = currentClip(), scale = integer($('animExportScale').value, 4), support = window.MINISH_ANIMATION_EXPORT?.supportsVideo?.();
    const camera = $('animExportArea').value === 'view' ? exportCamera || cameraFromView(clip) : null;
    const width = (camera ? camera.w : clip.width) * scale, height = (camera ? camera.h : clip.height) * scale;
    const playbackFrames = clip.loop === 'pingpong' && clip.duration > 2 ? clip.duration * 2 - 2 : clip.duration;
    const sequence = ['frames', 'sheet'].includes($('animExportFormat').value);
    $('animExportSummary').textContent = (sequence ? clip.duration + ' unique frames' : playbackFrames + ' output frames') + ' · ' + (playbackFrames / clip.fps).toFixed(2) + ' seconds playback · ' + width + ' × ' + height + ' px';
    const limits = window.MINISH_ANIMATION_EXPORT?.limits || {}, pixels = width * height, frames = sequence ? clip.duration : playbackFrames;
    const gif = $('animExportFormat').value === 'gif';
    const tooLarge = width > (limits.maxEdge || 8192) || height > (limits.maxEdge || 8192) || pixels > (limits.maxFramePixels || 16777216) ||
      pixels * frames > (limits.maxRenderedPixels || 400000000) || gif && (pixels > (limits.maxGIFFramePixels || 4194304) || pixels * frames > (limits.maxGIFPixels || 80000000));
    $('animExportCameraHint').textContent = tooLarge ? 'This export is too large. Choose Current view, a smaller enlargement, or a shorter clip.' :
      camera ? 'Camera: X ' + camera.x + ', Y ' + camera.y + ' · ' + camera.w + ' × ' + camera.h + ' native pixels. Center the part you want before opening Export. Large views are framed to at most 1024 × 576 pixels.' : 'Exports the entire clip. Your editable project always keeps the complete world.';
    if (!exporting) $('animStartExport').disabled = tooLarge;
    const option = $('animExportFormat').querySelector('option[value="webm"]'); if (option) option.disabled = !support?.supported;
    $('animVideoSupport').textContent = support?.supported ? (support?.container === 'mp4' ? 'MP4' : 'WebM') + ' recording is available in this browser. PNG exports preserve source colors and transparency.' : 'Video recording is unavailable here. GIF, PNG frames, and sprite sheets remain available.';
    scheduleDraw();
  }
  function openExport() {
    flushFieldDrafts(); animation.pause(); exportCamera = cameraFromView();
    $('animExportArea').value = isLargeClip(currentClip()) ? 'view' : 'whole';
    $('animExportScale').value = String(isLargeClip(currentClip()) ? 1 : currentClip().exportScale || 4);
    exportSummary(); $('animExportStatus').textContent = ''; $('animExportProgress').hidden = true;
    $('animExportDialog').showModal(); scheduleDraw();
  }
  async function startExport() {
    if (exporting) return;
    const exporter = window.MINISH_ANIMATION_EXPORT; if (!exporter) { $('animExportStatus').textContent = 'Keep animation-export.js with the app folder to export animations.'; return; }
    const format = $('animExportFormat').value, methods = { gif: 'exportGIF', frames: 'exportFrames', sheet: 'exportSheet', webm: 'exportVideo' }, clip = clone(currentClip());
    exporting = true; exportCancelled = false; $('animStartExport').disabled = true; $('animCloseExport').disabled = true; $('animExportProgress').hidden = false; $('animExportProgress').value = 0;
    $('animExportStatus').textContent = 'Preparing genuine game frames…';
    try {
      const blob = await exporter[methods[format]](clip, { scale: integer($('animExportScale').value, 4),
        camera: $('animExportArea').value === 'view' ? exportCamera || cameraFromView(clip) : null,
        evaluateFrame: animation.evaluateFrame, renderFrame: (scene, options) => studio.renderSceneToCanvas(scene, options), project: animation.saveData(), cancelled: () => exportCancelled,
        onProgress: progress => { $('animExportProgress').value = progress.progress || (progress.frame || 0) / Math.max(1, progress.total || 1); $('animExportStatus').textContent = (progress.phase || 'Rendering') + ' · ' + (progress.frame || 0) + ' / ' + (progress.total || clip.duration) + ' frames'; } });
      if (exportCancelled) throw new Error('Export cancelled.');
      const support = exporter.supportsVideo?.(), extension = format === 'gif' ? '.gif' : format === 'webm' ? '.' + (support?.extension || 'webm') : '.zip'; download(blob, blob.exportInfo?.filename || filename(clip.name) + extension);
      $('animExportProgress').value = 1; $('animExportStatus').textContent = 'Download ready. ' + (blob.exportInfo?.note || (blob.exportInfo?.palette === 'quantized' ? 'This GIF uses a reduced color palette. PNG exports keep every source color.' : 'Your editable animation project is kept separately.'));
    } catch (error) { $('animExportStatus').textContent = error.message || 'The animation could not be exported. Try fewer frames or a smaller scale.'; }
    finally { exporting = false; $('animCloseExport').disabled = false; exportSummary(); }
  }
  $('animCategory').addEventListener('change', refreshSources); $('animSource').addEventListener('change', refreshGroups); $('animPoseSearch').addEventListener('input', () => renderLibrary(true)); $('animPoseGroup').addEventListener('change', () => renderLibrary(true));
  $('animSimpleMode').addEventListener('click', () => setEditorMode('simple')); $('animTimelineMode').addEventListener('click', () => setEditorMode('timeline'));
  $('animSimpleOpenTimeline').addEventListener('click', () => setEditorMode('timeline'));
  $('animSimpleStyleTimeline').addEventListener('click', () => setEditorMode('timeline'));
  for (const [id, view] of [['animBrowseActions', 'actions'], ['animBrowsePoses', 'poses']]) $(id).addEventListener('click', () => { libraryView = view; $('animPoseSearch').value = ''; syncLibraryView(); renderLibrary(); });
  for (const id of ['animSimplePreset', 'animSimpleSpeed', 'animSimpleMotion', 'animSimpleDistance']) $(id).addEventListener('change', () => { recipeDirty = true; updateRecipeDescription(); });
  $('animSimpleApply').addEventListener('click', () => applySimpleRecipe()); $('animSimpleReplace').addEventListener('click', () => applySimpleRecipe(true));
  $('animSimpleDuration').addEventListener('change', () => { const seconds = Number($('animSimpleDuration').value); if ($('animSimpleDuration').value.trim() && Number.isFinite(seconds) && seconds > 0) { configureClip({ duration: clamp(Math.round(seconds * currentClip().fps), 1, 600) }); report('Animation length updated.'); } else render(animation.state); });
  $('animSimplePlay').addEventListener('click', () => { flushFieldDrafts(); state.playing ? animation.pause() : animation.play(); }); $('animSimpleStop').addEventListener('click', () => animation.stop());
  $('animSimpleUndo').addEventListener('click', () => animation.undo()); $('animSimpleRedo').addEventListener('click', () => animation.redo());
  $('animMorePoses').addEventListener('click', () => { shown += 64; renderLibrary(false); });
  $('animAddPiece').addEventListener('click', () => addPiece()); $('animUsePose').addEventListener('click', () => { if (selectedPiece && selectedId()) attempt(() => animation.setKey(selectedId(), state.frame, { pieceId: selectedPiece.id }, { easing: $('animEasing').value })); });
  $('animClearPoses').addEventListener('click', () => { selectedPoses.clear(); updatePoseButtons(); });
  $('animSequenceBtn').addEventListener('click', () => { const chosen = [...selectedPoses].map(id => pieces.get(id)).filter(Boolean); if (!chosen.length) return; const hold = clamp(integer($('animPoseHold').value, 3), 1, 120), sequenceLength = $('animPosePingpong').checked && chosen.length > 2 ? chosen.length * 2 - 2 : chosen.length, needed = state.frame + sequenceLength * hold; if (needed > 600) { report('Use fewer poses or fewer frames per pose. A clip supports up to 600 frames.'); return; } const changed = attempt(() => animation.batch(() => { if (needed > currentClip().duration) animation.configureClip({ duration: needed }); const id = selectedId() || animation.addObject(pieceObject(chosen[0]), { at: state.frame }).id; animation.clearKeyProperties(id, ['pieceId', 'assetId', 'sx', 'sy', 'sw', 'sh', 'sourceId', 'pieceName', 'keyColor'], { from: state.frame, to: currentClip().duration - 1 }); animation.applyPoseSequence(id, chosen, { start: state.frame, hold, loop: $('animPoseLoop').checked, pingpong: $('animPosePingpong').checked, replace: false }); })); if (changed !== null) report(chosen.length + ' genuine poses added in your selection order.'); });
  $('animVerifiedWalk').addEventListener('click', () => {
    const poses = (sheets['6369']?.pieces || []).filter(piece => piece.sequence >= 28 && piece.sequence <= 37 && pieces.has(String(piece.id))).sort((a, b) => a.sequence - b.sequence);
    if (state.frame > 580) { report('Move the playhead earlier to add the complete twenty-frame walk cycle.'); return; }
    if (poses.length !== 10) { report('Keep the reviewed Link pose collection with the app to use this cycle.'); return; }
    const actor = attempt(() => animation.batch(() => { if (state.frame + 20 > currentClip().duration) animation.configureClip({ duration: Math.min(600, state.frame + 20) }); const added = animation.addObject(pieceObject(poses[0]), { at: state.frame }); animation.applyPoseSequence(added.id, poses, { start: state.frame, hold: 2, loop: true, replace: false }); return added; }));
    if (actor) { report('Ten reviewed back-facing Link walk poses added. Add movement keys to walk through your scene.'); }
  });
  $('animPlay').addEventListener('click', () => state.playing ? animation.pause() : animation.play()); $('animStop').addEventListener('click', () => animation.stop()); $('animFirst').addEventListener('click', () => animation.seek(0)); $('animLast').addEventListener('click', () => animation.seek(currentClip().duration - 1)); $('animPrev').addEventListener('click', () => animation.step(-1)); $('animNext').addEventListener('click', () => animation.step(1));
  $('animScrubber').addEventListener('input', () => { animation.pause(); animation.seek(integer($('animScrubber').value)); }); for (const eventName of ['input', 'change']) $('animFrameNumber').addEventListener(eventName, () => { if ($('animFrameNumber').value.trim() === '') return; animation.pause(); animation.seek(integer($('animFrameNumber').value, 1) - 1); });
  $('animUndo').addEventListener('click', () => animation.undo()); $('animRedo').addEventListener('click', () => animation.redo()); $('animAddKey').addEventListener('click', addKey);
  $('animDeleteKey').addEventListener('click', () => { if (selectedId()) attempt(() => animation.removeKey(selectedId(), state.frame)); });
  $('animCopyKey').addEventListener('click', () => { const object = currentObject(); if (object) { copyKey = { values: keyPatch(object), easing: $('animEasing').value }; render(state); report('Piece state copied. Move the playhead and paste a key.'); } });
  $('animPasteKey').addEventListener('click', () => { if (copyKey && selectedId()) attempt(() => animation.setKey(selectedId(), state.frame, copyKey.values, { easing: copyKey.easing })); });
  $('animEasing').addEventListener('change', () => { const key = animation.getTrack(selectedId())?.keys.find(value => value.frame === state.frame); if (key) attempt(() => animation.setKey(selectedId(), state.frame, keyPatch(currentObject()), { easing: $('animEasing').value })); });
  for (const [id, direction] of [['animPrevKey', -1], ['animNextKey', 1]]) $(id).addEventListener('click', () => { const list = animation.getTrack(selectedId())?.keys || [], candidates = list.filter(key => direction < 0 ? key.frame < state.frame : key.frame > state.frame).sort((a, b) => direction < 0 ? b.frame - a.frame : a.frame - b.frame); if (candidates.length) animation.seek(candidates[0].frame); });
  for (const [id, delta] of [['animTrackPagePrev', -1], ['animTrackPageNext', 1]]) $(id).addEventListener('click', () => { animation.selectObject(null); trackPage = Math.max(0, trackPage + delta); renderTimeline(true); });
  $('animObjects').addEventListener('change', () => animation.selectObject($('animObjects').value));
  for (const [id, key] of [['animObjectX', 'x'], ['animObjectY', 'y'], ['animObjectScale', 'scale']]) $(id).addEventListener('change', () => { if ($(id).value.trim() !== '' && Number.isFinite(Number($(id).value))) updateObject({ [key]: integer($(id).value) }, isSimple()); else render(state); });
  $('animObjectLayer').addEventListener('change', () => updateObject({ layer: $('animObjectLayer').value })); $('animObjectName').addEventListener('change', () => { if (selectedId()) attempt(() => animation.setTrack(selectedId(), { name: $('animObjectName').value })); });
  $('animFlipX').addEventListener('click', () => { const object = currentObject(); if (object) updateObject({ flipX: !object.flipX }); }); $('animFlipY').addEventListener('click', () => { const object = currentObject(); if (object) updateObject({ flipY: !object.flipY }); }); $('animVisible').addEventListener('change', () => updateObject({ visible: $('animVisible').checked }));
  function rotateSelected(direction) {
    const object = currentObject(); if (object?.kind !== 'sprite') return;
    updateObject({ rotation: normalizeRotation((object.rotation || 0) + direction * 45) });
  }
  $('animRotateLeft').addEventListener('click', () => rotateSelected(-1)); $('animRotateRight').addEventListener('click', () => rotateSelected(1));
  $('animObjectRotation').addEventListener('change', () => { if (currentObject()?.kind === 'sprite') updateObject({ rotation: normalizeRotation($('animObjectRotation').value) }); });
  $('animTrackLocked').addEventListener('change', () => { if (selectedId()) attempt(() => animation.setTrack(selectedId(), { locked: $('animTrackLocked').checked })); }); $('animTrackMuted').addEventListener('change', () => { if (selectedId()) attempt(() => animation.setTrack(selectedId(), { muted: $('animTrackMuted').checked })); });
  for (const [id, dx, dy] of [['animNudgeLeft', -1, 0], ['animNudgeRight', 1, 0], ['animNudgeUp', 0, -1], ['animNudgeDown', 0, 1]]) $(id).addEventListener('click', event => { const object = currentObject(); if (object) updateObject({ x: object.x + dx * (event.shiftKey ? 8 : 1), y: object.y + dy * (event.shiftKey ? 8 : 1) }); });
  $('animMoveBack').addEventListener('click', () => { if (selectedId()) attempt(() => animation.reorderObject(selectedId(), -1)); }); $('animMoveFront').addEventListener('click', () => { if (selectedId()) attempt(() => animation.reorderObject(selectedId(), 1)); });
  const duplicateSelected = () => { if (selectedId()) attempt(() => isSimple() || currentObject()?.simpleCompanion || currentClip().objects.some(object => object.simpleCompanion?.ownerId === selectedId()) ? simple.duplicate(selectedId()) : animation.duplicateObject(selectedId())); };
  function copySelected(cut = false) {
    flushFieldDrafts(); const base = currentClip().objects.find(object => object.id === selectedId()); if (!base) return false;
    const track = animation.getTrack(base.id), payload = { object: clone(base), track: track ? clone(track) : null, cut: !!cut, ready: !!base.simpleAnimation && !simple?.inspect(base.id).needsReplacement,
      companions: currentClip().objects.filter(object => object.simpleCompanion?.ownerId === base.id).map(object => ({ object: clone(object), track: clone(animation.getTrack(object.id)) })) };
    // Copying an effect by itself makes an independent editable effect.
    delete payload.object.simpleCompanion;
    if (cut && attempt(() => animation.removeObject(base.id)) === null) return false;
    pieceClipboard = payload; pasteCount = 0; report(cut ? 'Piece cut. Paste it into this clip or another clip.' : 'Piece and its animation copied.'); render(animation.state); return true;
  }
  function pasteSelected() {
    if (!pieceClipboard) { report('Copy a piece first.'); return null; }
    flushFieldDrafts(); animation.pause(); const delta = (pieceClipboard.cut ? pasteCount : pasteCount + 1) * 8, payload = clone(pieceClipboard);
    payload.object.x += delta; payload.object.y += delta;
    for (const key of payload.object.simpleAnimation?.generated || []) { if ('x' in key.values) key.values.x += delta; if ('y' in key.values) key.values.y += delta; }
    const result = attempt(() => animation.batch(() => {
      const last = Math.max(0, ...(payload.track?.keys || []).map(key => key.frame), ...(payload.companions || []).flatMap(child => (child.track?.keys || []).map(key => key.frame)));
      if (last >= animation.currentClip.duration) {
        const readyLoops = animation.currentClip.objects.filter(base => base.simpleAnimation?.version === 1 && !simple.inspect(base.id).needsReplacement);
        animation.configureClip({ duration: last + 1 });
        for (const base of readyLoops) simple.apply(base.id, simple.getRecipe(base));
      }
      const added = animation.addObject(payload.object);
      if (payload.track?.keys.length) animation.setKeys(added.id, payload.track.keys.map(key => ({ ...key, raw: true, values: { ...key.values, ...('x' in key.values ? { x: key.values.x + delta } : {}), ...('y' in key.values ? { y: key.values.y + delta } : {}) } })));
      if (payload.track) animation.setTrack(added.id, { name: payload.track.name, muted: payload.track.muted, locked: false });
      if (payload.ready && simple) simple.apply(added.id, payload.object.simpleAnimation.recipe, { replaceCustom: true });
      else for (const companion of payload.companions || []) {
        const object = clone(companion.object); object.x += delta; object.y += delta;
        object.simpleCompanion.ownerId = added.id;
        for (const key of object.simpleCompanion.generated || []) { if ('x' in key.values) key.values.x += delta; if ('y' in key.values) key.values.y += delta; }
        const copied = animation.addObject(object);
        if (companion.track?.keys?.length) animation.setKeys(copied.id, companion.track.keys.map(key => ({ ...key, raw: true, values: { ...key.values, ...('x' in key.values ? { x: key.values.x + delta } : {}), ...('y' in key.values ? { y: key.values.y + delta } : {}) } })));
        if (companion.track) animation.setTrack(copied.id, { name: companion.track.name, muted: companion.track.muted, locked: false });
      }
      animation.selectObject(added.id);
      return added;
    }));
    if (result) { pasteCount++; report('Piece and animation pasted. Drag to place it.'); } return result;
  }
  function deleteSelectedPiece() {
    flushFieldDrafts(); const id = selectedId(); if (!id) return false;
    const removed = attempt(() => animation.removeObject(id));
    if (removed) report('Piece deleted. Undo restores it.');
    return removed;
  }
  $('animQuickCopy').addEventListener('click', () => copySelected()); $('animQuickPaste').addEventListener('click', pasteSelected); $('animQuickDuplicate').addEventListener('click', duplicateSelected); $('animQuickDelete').addEventListener('click', deleteSelectedPiece);
  $('animDuplicateObject').addEventListener('click', duplicateSelected); $('animDeleteObject').addEventListener('click', deleteSelectedPiece); $('animApplyMotion').addEventListener('click', applyMotion);
  for (const [id, key] of [['animClipName', 'name'], ['animDuration', 'duration'], ['animFps', 'fps'], ['animLoop', 'loop']]) $(id).addEventListener('change', () => configureClip({ [key]: ['duration', 'fps'].includes(key) ? integer($(id).value) : $(id).value }));
  $('animApplySize').addEventListener('click', () => { attempt(() => animation.configureClip({ width: integer($('animWidth').value), height: integer($('animHeight').value) })); fitCanvas(); }); $('animTransparent').addEventListener('change', () => attempt(() => animation.configureClip({ transparent: $('animTransparent').checked }))); $('animColor').addEventListener('change', () => attempt(() => animation.configureClip({ color: $('animColor').value })));
  function deleteCurrentClip() {
    flushFieldDrafts(); animation.pause(); const name = currentClip().name;
    const removed = attempt(() => {
      if (animation.project.clips.length > 1) return animation.deleteClip();
      const data = clone(animation.project), clip = data.clips[0];
      clip.objects = []; clip.tracks = []; clip.name = 'New animation'; delete clip.generated;
      return animation.loadProject(data);
    });
    if (removed !== null) { recipeObjectId = null; recipeDirty = false; fitCanvas(); report('Deleted ' + name + '. Undo restores the entire clip.'); }
  }
  $('animAddClip').addEventListener('click', () => { flushFieldDrafts(); attempt(() => animation.addClip()); fitCanvas(); }); $('animDuplicateClip').addEventListener('click', () => { flushFieldDrafts(); attempt(() => animation.duplicateClip()); fitCanvas(); }); $('animDeleteClip').addEventListener('click', deleteCurrentClip);
  const addDialogue = () => { const clip = currentClip(); recipeDirty = false; attempt(() => animation.batch(() => { const object = animation.addObject({ kind: 'dialogue', x: 12, y: Math.max(0, clip.height - 68), w: Math.max(20, clip.width - 24), h: 58, text: 'Your message here.', fontSize: 12, color: '#fff7d3', box: true, scale: 1, layer: 'overlay', visible: true }, { at: isSimple() ? 0 : state.frame }); if (isSimple()) simple.apply(object.id, { presetId: 'still' }); return object; })); report('Dialogue added. Write your message in Settings, then choose Full message or Text reveal.'); };
  $('animNewDialogue').addEventListener('click', addDialogue); $('animDialogueText').addEventListener('change', () => updateObject({ text: $('animDialogueText').value })); $('animDialogueWidth').addEventListener('change', () => updateObject({ w: integer($('animDialogueWidth').value, 192) })); $('animDialogueHeight').addEventListener('change', () => updateObject({ h: integer($('animDialogueHeight').value, 58) })); $('animDialogueFontSize').addEventListener('change', () => updateObject({ fontSize: clamp(integer($('animDialogueFontSize').value, 12), 4, 48) })); $('animDialogueColor').addEventListener('change', () => updateObject({ color: $('animDialogueColor').value })); $('animDialogueBox').addEventListener('change', () => updateObject({ box: $('animDialogueBox').checked }));
  $('animTypewriter').addEventListener('click', () => {
    flushFieldDrafts();
    const object = currentObject(); if (!object || object.kind !== 'dialogue') return;
    const text = $('animDialogueText').value, characters = Array.from(text), hold = clamp(integer($('animTypewriterHold').value, 1), 1, 12), start = state.frame, end = start + characters.length * hold;
    if (!characters.length) { report('Write your dialogue before adding a text reveal.'); return; }
    if (end >= 600) { report('Use shorter text, fewer frames per character, or an earlier starting frame. A clip supports 600 frames.'); return; }
    if (object.text !== text && attempt(() => animation.updateObject(object.id, { text }, { keyframe: $('animAutoKey').checked, frame: start })) === null) return;
    const result = attempt(() => animation.batch(() => {
      if (end >= currentClip().duration) animation.configureClip({ duration: end + 1 });
      animation.clearKeyProperties(object.id, ['text'], { from: start, to: end });
      animation.setKey(object.id, start, { text: '' }, { easing: 'hold' });
      let revealed = ''; characters.forEach((character, index) => { revealed += character; animation.setKey(object.id, start + (index + 1) * hold, { text: revealed }, { easing: 'hold' }); });
    })); if (result !== null) report('Text reveal added. Play from frame ' + (start + 1) + ' to watch it unfold.');
  });
  $('animImportScene').addEventListener('click', importCurrentScene); $('animImportEmpty').addEventListener('click', importCurrentScene); $('animationDemoBtn').addEventListener('click', demo);
  $('animSaveBtn').addEventListener('click', save); $('animProjectName').addEventListener('change', () => attempt(() => animation.renameProject($('animProjectName').value))); $('animOpenBtn').addEventListener('click', () => $('animOpenFile').click()); $('animOpenFile').addEventListener('change', async () => { const file = $('animOpenFile').files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); animation.loadProject(data); fitCanvas(); report('Editable animation opened.'); } catch (error) { report(error.message || 'Choose a Minish Studio animation project JSON file.'); } finally { $('animOpenFile').value = ''; } });
  $('animExportBtn').addEventListener('click', openExport); $('animExportFormat').addEventListener('change', exportSummary); $('animExportScale').addEventListener('change', exportSummary);
  $('animExportArea').addEventListener('change', exportSummary);
  $('animExportDialog').addEventListener('close', () => { exportCamera = null; scheduleDraw(); });
  $('animStartExport').addEventListener('click', startExport); $('animCancelExport').addEventListener('click', () => { if (exporting) { exportCancelled = true; $('animExportStatus').textContent = 'Cancelling…'; } else $('animExportDialog').close(); }); $('animCloseExport').addEventListener('click', () => { if (!exporting) $('animExportDialog').close(); }); $('animExportDialog').addEventListener('cancel', event => { if (exporting) { event.preventDefault(); exportCancelled = true; } });
  $('animationControlsBtn').addEventListener('click', () => { animation.pause(); window.MINISH_CONTROLS?.open(); });
  $('animZoomOut').addEventListener('click', () => zoomStep(-1)); $('animZoomIn').addEventListener('click', () => zoomStep(1)); $('animFit').addEventListener('click', fitCanvas); $('animFocusBtn').addEventListener('click', () => setFocus(!document.body.classList.contains('anim-preview-focus')));
  for (const [id, enabled] of [['animHandTool', true], ['animSelectTool', false]]) $(id)?.addEventListener('click', () => {
    setHandTool(enabled); $('animToolsMenu').open = false; $('animToolsLabel').focus();
  });
  $('animToolsMenu')?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('animToolsMenu').open) { event.preventDefault(); $('animToolsMenu').open = false; $('animToolsLabel').focus(); }
  });
  $('animZoomLabel').addEventListener('focus', () => $('animZoomLabel').select?.());
  $('animZoomLabel').addEventListener('input', () => { zoomFieldDraft = true; });
  $('animZoomLabel').addEventListener('change', applyZoomField);
  $('animZoomLabel').addEventListener('blur', applyZoomField);
  $('animZoomLabel').addEventListener('keydown', event => {
    if (!['Enter', 'Escape'].includes(event.key) || event.isComposing) return;
    event.preventDefault(); event.stopPropagation?.();
    if (event.key === 'Enter') applyZoomField(); else { zoomFieldDraft = false; updateZoomField(true); }
    canvas.focus({ preventScroll: true });
  });
  for (const [buttonId, className, other] of [['animLibraryToggle', 'anim-library-open', 'anim-inspector-open'], ['animInspectorToggle', 'anim-inspector-open', 'anim-library-open']]) $(buttonId).addEventListener('click', () => { if (document.body.classList.contains('anim-preview-focus')) setFocus(false); const open = document.body.classList.toggle(className); document.body.classList.remove(other); $(buttonId).setAttribute('aria-expanded', String(open)); });
  $('animCloseLibrary').addEventListener('click', () => { document.body.classList.remove('anim-library-open'); $('animLibraryToggle').setAttribute('aria-expanded', 'false'); }); $('animCloseInspector').addEventListener('click', () => { document.body.classList.remove('anim-inspector-open'); $('animInspectorToggle').setAttribute('aria-expanded', 'false'); });
  document.addEventListener('keydown', event => {
    if (mode !== 'animation' || event.defaultPrevented || document.querySelector('dialog[open]') || event.isComposing || event.keyCode === 229 || event.altKey || event.getModifierState?.('AltGraph')) return;
    const key = event.key, lower = key.toLowerCase(), mod = event.ctrlKey || event.metaKey, pieceList = event.target?.id === 'animObjects';
    const editing = (!pieceList && /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '')) || event.target?.isContentEditable || event.target?.closest?.('[role="textbox"], [role="combobox"], [role="spinbutton"]');
    if (mod && !event.shiftKey && ['s', 'o'].includes(lower)) { event.preventDefault(); if (!event.repeat) lower === 's' ? save() : $('animOpenBtn').click(); return; }
    if (editing) return;
    if (mod && event.shiftKey && ['Delete', 'Backspace'].includes(key)) { event.preventDefault(); if (!event.repeat) deleteCurrentClip(); return; }
    if (mod) {
      if (lower === 'z') { event.preventDefault(); event.shiftKey ? animation.redo() : animation.undo(); }
      else if (lower === 'y' && !event.shiftKey) { event.preventDefault(); animation.redo(); }
      else if (lower === 'd' && !event.shiftKey) { event.preventDefault(); if (!event.repeat) duplicateSelected(); }
      else if (!event.shiftKey && ['c', 'x', 'v'].includes(lower)) { event.preventDefault(); if (!event.repeat) lower === 'v' ? pasteSelected() : copySelected(lower === 'x'); }
      return;
    }
    if (!event.shiftKey && (key === 'Delete' || key === 'Backspace')) { event.preventDefault(); deleteSelectedPiece(); return; }
    if (pieceList) return;
    const nativeButton = /BUTTON|SUMMARY|A/.test(event.target?.tagName || '');
    if (lower === 'h') { event.preventDefault(); setHandTool(true); }
    else if (lower === 'v') { event.preventDefault(); setHandTool(false); }
    else if ((key === ' ' || key === 'Spacebar') && !nativeButton) { event.preventDefault(); if (!event.repeat) state.playing ? animation.pause() : animation.play(); }
    else if (['+', '=', '-', '_', '0'].includes(key)) { event.preventDefault(); if (key === '0') { resetZoomInput(); zoomAt(1); } else zoomStep(key === '+' || key === '=' ? 1 : -1); }
    else if (lower === 'f') { event.preventDefault(); fitCanvas(); }
    else if (['[', ']', '{', '}'].includes(key) && selectedId()) { event.preventDefault(); attempt(() => animation.reorderObject(selectedId(), key === '[' || key === '{' ? -1 : 1, event.shiftKey)); }
    else if (!isSimple() && (key === ',' || key === '.')) { event.preventDefault(); animation.pause(); animation.step(key === ',' ? -1 : 1); }
    else if (!isSimple() && (key === 'Home' || key === 'End') && !nativeButton) { event.preventDefault(); animation.seek(key === 'Home' ? 0 : currentClip().duration - 1); }
    else if (!isSimple() && key === 'Enter' && !nativeButton) { event.preventDefault(); if (!event.repeat) addKey(); }
    else if (key === 'Escape') { animation.selectObject(null); document.body.classList.remove('anim-library-open', 'anim-inspector-open'); }
    else if (key.startsWith('Arrow') && !nativeButton) { const object = currentObject(); if (object) { event.preventDefault(); updateObject({ x: object.x + (key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0) * (event.shiftKey ? 8 : 1), y: object.y + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0) * (event.shiftKey ? 8 : 1) }); } }
  });
  for (const field of $('animationWorkspace').querySelectorAll('input, textarea, select')) {
    field.addEventListener('input', () => fieldDrafts.add(field));
    field.addEventListener('change', () => fieldDrafts.delete(field));
    field.addEventListener('blur', () => { if (fieldDrafts.delete(field)) field.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  animation.subscribe(render); refreshSources(); setEditorMode(editorMode, false);
  window.addEventListener('resize', scheduleDraw);
  $('animStageViewport').addEventListener('scroll', scheduleDraw, { passive: true });
  const keepLatestEdits = () => { flushFieldDrafts(); animation.flushBrowserSave(); };
  window.addEventListener('pagehide', keepLatestEdits);
  window.addEventListener('beforeunload', keepLatestEdits);
  window.MINISH_ANIMATION_UI = { setMode, setEditorMode, importCurrentScene, openExport, demo, get mode() { return mode; }, get editorMode() { return editorMode; }, setFocus, zoomAt, fitCanvas, focusArea, zoomStep, setHandTool, copySelected, pasteSelected, deleteSelectedPiece, deleteCurrentClip,
    get exportCamera() { return clone(exportCamera || cameraFromView()); },
    get view() { return { zoom, fit, hand: handTool }; }, render: () => { render(animation.state); scheduleDraw(); } };
  let preferred = 'scene'; try { preferred = localStorage.getItem('minish-maker-workspace') || 'scene'; } catch (_) {} setMode(preferred);
})();
