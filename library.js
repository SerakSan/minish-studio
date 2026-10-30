(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const studio = window.MINISH_STUDIO;
  if (!studio) return;
  const catalog = window.MINISH_ASSETS || { assets: [] };
  const piecesData = window.MINISH_PIECES || { assets: [], sheets: {}, stats: {} };
  const curatedData = window.MINISH_CURATED || { assets: [], sheets: {}, hiddenSourceIds: [], excludedPieceIds: [] };
  const bossesData = window.MINISH_BOSSES || { catalog: [], assets: [], sheets: {} };
  const bossSources = Array.isArray(bossesData.catalog) ? bossesData.catalog : (bossesData.catalog && bossesData.catalog.assets || []);
  const allSources = [...catalog.assets, ...(curatedData.catalog || []), ...bossSources];
  const allAssets = [...allSources, ...(piecesData.assets || []), ...(curatedData.assets || []), ...(bossesData.assets || [])];
  const assetMap = new Map(allAssets.map(a => [String(a.id), a]));
  const sourceMap = new Map(allSources.map(a => [String(a.id), a]));
  const images = new Map(), thumbnails = new Map();
  const PAGE_SIZE = 64;
  const excludedPieceIds = new Set([...(window.MINISH_SPRITES?.excludedPieceIds || []), ...(curatedData.excludedPieceIds || [])].map(String));
  const hiddenSourceIds = new Set((curatedData.hiddenSourceIds || []).map(String));
  const STORAGE = 'minish-maker-library-v2';
  const categories = [
    { id: 'environments', label: 'Environments', icon: '▦', placeholder: 'Find a place or tileset...', type: 'Game places & tilesets' },
    { id: 'characters', label: 'Characters', icon: '♙', placeholder: 'Find Link, Zelda, a villager...', type: 'Heroes & residents' },
    { id: 'full-bosses', label: 'Full bosses', icon: '♛', placeholder: 'Find a complete boss...', type: 'Complete bosses & states' },
    { id: 'objects', label: 'Objects', icon: '◇', placeholder: 'Find items, objects, effects...', type: 'Items & effects' },
    { id: 'enemies', label: 'Enemies', icon: '♟', placeholder: 'Find an enemy...', type: 'Enemies & creatures' },
    { id: 'bosses', label: 'Boss parts', icon: '♜', placeholder: 'Find Vaati, Mazaal, Gleerok...', type: 'Individual boss components' }
  ];  const windows = new Map();
  let activeCategory = 'environments', currentPiece = null, remembered = {};
  try { remembered = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch (_) {}
  if (categories.some(c => c.id === remembered.category)) activeCategory = remembered.category;
  const number = value => Number(value || 0).toLocaleString('en-US');
  const creditNames = source => String(source.id) === '535841' ? 'Moosh (sprite rip); P-Tux7 (source contributor)' : source.contributors || 'See original sheet';
  const create = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const normalize = category => {
    const c = String(category || '').toLowerCase();
    if (/environment|tileset|maps/.test(c)) return 'environments';
    if (/full.?boss|complete.?boss|assembled/.test(c)) return 'full-bosses';
    if (/boss/.test(c)) return 'bosses';
    if (/enemies|enemy/.test(c)) return 'enemies';
    if (/character|playable/.test(c)) return 'characters';
    return 'objects';
  };
  function saveState() {
    const state = { category: activeCategory, windows: {} };
    windows.forEach((w, id) => { state.windows[id] = { sourceId: w.sourceId, mode: w.mode.value, search: w.search.value, row: w.initialized ? w.row.value : w.pendingRow || '', direction: w.initialized ? w.direction.value : w.pendingDirection || '' }; });
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch (_) {}
  }
  function showToast(message) {
    $('statusText').textContent = message;
    const toast = $('toast'); toast.textContent = message; toast.classList.add('visible');
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('visible'), 4000);
  }
  function getImage(id) {
    id = String(id);
    if (images.has(id)) return images.get(id);
    const a = assetMap.get(id);
    if (!a) return Promise.reject(new Error('Source image not found.'));
    const promise = new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = a.dataUrl || a.path;
    });
    promise.catch(() => {}); images.set(id, promise); return promise;
  }
  async function drawSourceThumbnail(canvas, source) {
    const region = sourcePieces(source)[0];
    const src = sheetFor(source).thumbnailDataUrl || region?.thumbnailDataUrl || assetMap.get(String(region?.assetId))?.thumbnailDataUrl;
    // A source-sheet thumbnail can contain a community caption. Only preview
    // a curated game region, even if its optional small thumbnail is missing.
    if (!src) { if (region) await drawPiece(canvas, region, 1); return; }
    canvas.dataset.sourceThumbnail = String(source.id);
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!thumbnails.has(src)) thumbnails.set(src, new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
    }));
    try {
      const image = await thumbnails.get(src);
      if (canvas.dataset.sourceThumbnail !== String(source.id)) return;
      const scale = Math.min((canvas.width - 2) / image.width, (canvas.height - 2) / image.height);
      const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, Math.floor((canvas.width - width) / 2), Math.floor((canvas.height - height) / 2), width, height);
    } catch (_) { /* A missing optional preview must not decode a full map. */ }
  }
  async function drawPiece(canvas, piece, padding = 3) {
    const token = piece && piece.id; canvas.dataset.piece = token || '';
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!piece) return;
    try {
      const keyed = studio.getPieceSource ? await studio.getPieceSource(piece) : null;
      const image = keyed ? keyed.image : await getImage(piece.assetId);
      if (canvas.dataset.piece !== token) return;
      const sw = Number(piece.sw), sh = Number(piece.sh);
      let scale = Math.min((canvas.width - padding * 2) / sw, (canvas.height - padding * 2) / sh);
      if (scale >= 1) scale = Math.max(1, Math.floor(scale));
      const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, keyed ? keyed.sx : piece.sx, keyed ? keyed.sy : piece.sy, keyed ? keyed.sw : sw, keyed ? keyed.sh : sh, Math.floor((canvas.width - dw) / 2), Math.floor((canvas.height - dh) / 2), dw, dh);
    } catch (_) { /* The core source window reports missing local assets. */ }
  }
  function fullPiece(source) {
    return { id: 'full-' + source.id, name: source.name, sourceId: String(source.id), assetId: String(source.id), sx: 0, sy: 0, sw: source.width, sh: source.height, sourceRect: { x: 0, y: 0, w: source.width, h: source.height }, kind: 'region', group: 'Full sheet' };
  }
  function sheetFor(source) { return bossesData.sheets[String(source.id)] || curatedData.sheets[String(source.id)] || piecesData.sheets[String(source.id)] || { category: normalize(source.section), pieces: [] }; }
  function sourcePieces(source) {
    if (hiddenSourceIds.has(String(source.id))) return [];
    // Raw sheet fallbacks can expose a ripper title or credit as a scene piece.
    // The source archive keeps those sheets intact, outside the ready gallery.
    return (sheetFor(source).pieces || []).filter(piece => !excludedPieceIds.has(String(piece.id)));
  }
  function makeGrid(source, size) {
    const pieces = [];
    sourcePieces(source).forEach(region => {
      const columns = Math.ceil(region.sw / size), rows = Math.ceil(region.sh / size);
      const mask = region.tileMasks && region.tileMasks[size] ? new Set(region.tileMasks[size]) : null;
      const sourceRect = region.sourceRect || { x: region.sx, y: region.sy };
      for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        if (mask && !mask.has(y * columns + x)) continue;
        const sx = Number(region.sx) + x * size, sy = Number(region.sy) + y * size;
        const sw = Math.min(size, region.sw - x * size), sh = Math.min(size, region.sh - y * size);
        pieces.push({ id: 'tile-' + region.id + '-' + size + '-' + x + '-' + y, name: size + ' px tile · ' + (x + 1) + ', ' + (y + 1), assetId: String(region.assetId), sourceId: String(source.id), sx, sy, sw, sh, sourceRect: { x: Number(sourceRect.x) + x * size, y: Number(sourceRect.y) + y * size, w: sw, h: sh }, kind: 'tile', group: region.group || region.name, sequence: y * columns + x + 1 });
      }
    });
    return pieces;
  }
  function getWindowPieces(w) {
    const source = sourceMap.get(w.sourceId); if (!source) return [];
    if (/^grid/.test(w.mode.value)) {
      const key = source.id + ':' + w.mode.value;
      if (w.gridKey !== key) { w.gridKey = key; w.gridPieces = makeGrid(source, Number(w.mode.value.slice(4))); }
      return w.gridPieces;
    }
    return sourcePieces(source);
  }
  function availableLabel(w, pieces) {
    if (/^grid/.test(w.mode.value)) return number(pieces.length) + ' game tiles';
    if (w.id === 'environments') return number(pieces.length) + (pieces.every(piece => piece.kind === 'tile') ? ' game tiles' : ' game map region' + (pieces.length === 1 ? '' : 's'));
    if (w.id === 'full-bosses') return number(pieces.length) + ' editor boss preset' + (pieces.length === 1 ? '' : 's');
    if (w.id === 'bosses') return number(pieces.length) + ' available poses & parts';
    if (w.id === 'objects') return number(pieces.length) + ' available variants & parts';
    return number(pieces.length) + ' available poses & parts';
  }
  function createPoseCard(piece, onClick) {
    const button = create('button', 'pose-card' + (currentPiece && currentPiece.id === piece.id ? ' active' : ''));
    button.type = 'button'; button.dataset.pieceId = piece.id;
    const coords = piece.sourceRect || { x: piece.sx, y: piece.sy, w: piece.sw, h: piece.sh };
    button.title = piece.name + '\n' + (piece.group ? piece.group + ' · ' : '') + piece.sw + ' × ' + piece.sh + ' px\nSource: ' + coords.x + ', ' + coords.y;
    button.setAttribute('aria-label', piece.name + ', ' + (piece.group || '') + ', ' + piece.sw + ' by ' + piece.sh + ' pixels');
    button.setAttribute('aria-pressed', currentPiece && currentPiece.id === piece.id ? 'true' : 'false');
    const isRegion = piece.kind === 'environment' || piece.kind === 'region';
    const isCompleteBoss = String(piece.sourceId).startsWith('full-boss-');
    const canvas = create('canvas', isRegion ? 'piece-thumb-environment' : isCompleteBoss ? 'piece-thumb-boss' : 'piece-thumb-sprite');
    canvas.width = isRegion ? 130 : isCompleteBoss ? 90 : 64;
    canvas.height = isRegion ? 82 : isCompleteBoss ? 78 : 64;
    canvas.setAttribute('aria-hidden', 'true');
    const label = create('small', '', piece.kind === 'environment' || piece.kind === 'region' || piece.kind === 'assembly' || piece.kind === 'assembled-boss' || piece.kind === 'boss-assembly' ? piece.name : piece.sw + ' × ' + piece.sh);
    button.append(canvas, label);
    if (piece.sequence) button.append(create('span', 'piece-sequence', String(piece.sequence)));
    button.addEventListener('click', () => onClick(piece));
    button.addEventListener('dblclick', () => placePiece(piece));
    enablePieceDrag(button, () => piece, canvas);
    drawPiece(canvas, piece);
    return button;
  }
  function enablePieceDrag(node, getPiece, preview) {
    node.draggable = true;
    node.addEventListener('dragstart', event => {
      const piece = getPiece(); if (!piece) { event.preventDefault(); return; }
      try {
        studio.beginPieceDrag(piece);
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-minish-piece', piece.id);
        // The artwork is centered in its preview, including unusually shaped pieces.
        const rect = preview.getBoundingClientRect();
        event.dataTransfer.setDragImage(preview, rect.width / 2, rect.height / 2);
      } catch (error) { event.preventDefault(); studio.endPieceDrag(); showToast(error.message); }
    });
    node.addEventListener('dragend', () => studio.endPieceDrag());
  }
  function renderPoses(w, reset = true) {
    if (reset) { w.shown = 0; w.grid.replaceChildren(); w.scroll.scrollTop = 0; }
    const q = w.frameSearch.value.trim().toLowerCase();
    const pieces = getWindowPieces(w);
    const filtered = pieces.filter(p => (!w.row.value || p.group === w.row.value) && (!w.direction.value || p.direction === w.direction.value) && (!q || [p.name, p.group, p.phase, p.state, p.direction, ...(p.tags || []), p.sequence, p.sw + 'x' + p.sh, p.sw + ' × ' + p.sh].join(' ').toLowerCase().includes(q)));
    w.count.textContent = availableLabel(w, pieces) + (filtered.length !== pieces.length ? ' · ' + number(filtered.length) + ' shown' : '');
    const more = filtered.slice(w.shown, w.shown + PAGE_SIZE), fragment = document.createDocumentFragment();
    more.forEach(piece => fragment.append(createPoseCard(piece, choosePiece)));
    w.grid.append(fragment); w.shown += more.length;
    w.more.hidden = w.shown >= filtered.length;
    w.more.textContent = 'More pieces (' + number(w.shown) + ' / ' + number(filtered.length) + ')';
    w.empty.hidden = filtered.length > 0;
    const source = sourceMap.get(w.sourceId), coverage = sheetFor(source || {}).coverageNote || source?.coverageNote;
    w.note.textContent = w.id === 'full-bosses' ? (coverage || 'Choose a complete pose. Select a placed boss and use Edit boss parts to adjust its components.') : w.mode.value.startsWith('grid') ? 'Tiles come only from the clean game map region. Labels, palettes and source credits stay in the archive.' : w.id === 'environments' ? 'Place a game map region, or choose a tile size to build with its tiles. Select a placed map to frame another area.' : w.id === 'bosses' ? 'Individual game components. Use Full bosses for a complete starting pose.' : 'Drag a piece into the scene. Click to choose a brush; double-click to place it in the center.';
  }
  function updateRows(w) {
    const before = w.row.value, groups = [...new Set(getWindowPieces(w).map(p => p.group).filter(Boolean))];
    w.row.replaceChildren(new Option(w.id === 'full-bosses' ? 'All states' : w.id === 'environments' ? 'All regions' : 'All pose groups', ''));
    groups.forEach(group => w.row.append(new Option(group, group)));
    w.row.hidden = groups.length < 2;
    if (groups.includes(before)) w.row.value = before;
    const priorDirection = w.direction.value, directions = [...new Set(getWindowPieces(w).map(p => p.direction).filter(Boolean))];
    w.direction.replaceChildren(new Option('All directions', ''));
    directions.forEach(direction => w.direction.append(new Option(direction, direction)));
    w.direction.hidden = directions.length < 2;
    if (directions.includes(priorDirection)) w.direction.value = priorDirection;
  }
  function setSourceMetadata(w, id) {
    const source = sourceMap.get(String(id)); if (!source) return null;
    const creditSource = sourceMap.get(String(source.originalSourceId || source.sourceId || source.id)) || source;
    w.credit.textContent = 'Source: ' + creditNames(creditSource) + ' · Artwork © Nintendo / Capcom';
    w.creditLink.href = creditSource.sourceUrl || catalog.sourceUrl;
    w.creditLink.textContent = 'Original sheet & credits ↗';
    w.sourceId = String(id); w.title.textContent = source.name; w.sourceSummary.textContent = source.name;
    w.sourceSummary.setAttribute('aria-label', 'Choose ' + (w.id === 'environments' ? 'a place' : w.id === 'objects' ? 'an object collection' : w.id.includes('boss') ? 'a boss' : w.id === 'enemies' ? 'an enemy' : 'a character') + '. Current: ' + source.name);
    w.sourceButton.title = 'Open the original ' + source.name + ' sheet in the advanced source archive';
    return source;
  }
  function chooseSource(w, id, initial = false) {
    const source = setSourceMetadata(w, id); if (!source) return;
    w.initialized = true;
    if (!initial) { w.sourcePicker.open = false; w.sourceSummary.focus({ preventScroll: true }); }
    w.actorList.querySelectorAll('.actor-card').forEach(b => { const active = b.dataset.sourceId === w.sourceId; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    if (!initial) { w.frameSearch.value = ''; w.row.value = ''; w.direction.value = ''; }
    updateRows(w);
    if (initial && w.pendingRow && [...w.row.options].some(option => option.value === w.pendingRow)) w.row.value = w.pendingRow;
    if (initial && w.pendingDirection && [...w.direction.options].some(option => option.value === w.pendingDirection)) w.direction.value = w.pendingDirection;
    w.pendingRow = ''; w.pendingDirection = ''; renderPoses(w); saveState();
  }
  function initializeWindow(w) {
    if (w.initialized) return;
    w.initialized = true;
    if (w.sourceId) chooseSource(w, w.sourceId, true);
  }
  function renderActors(w) {
    w.actorsRendered = true;
    const q = w.search.value.trim().toLowerCase(); w.actorList.replaceChildren();
    const shown = w.sources.filter(s => !q || (s.name + ' ' + s.section).toLowerCase().includes(q));
    if (!shown.length) w.actorList.append(create('p', 'library-empty', 'No sources match. Try a shorter name.'));
    const fragment = document.createDocumentFragment();
    shown.forEach(source => {
      const pieces = sourcePieces(source), button = create('button', 'actor-card' + (w.sourceId === String(source.id) ? ' active' : ''));
      button.dataset.sourceId = String(source.id); button.setAttribute('aria-pressed', String(w.sourceId === String(source.id)));
      const canvas = create('canvas'); canvas.width = 39; canvas.height = 36; canvas.setAttribute('aria-hidden', 'true');
      const info = create('span', 'actor-info'); info.append(create('strong', '', source.name), create('small', '', w.id === 'environments' ? source.section + ' · ' + source.width + ' × ' + source.height : pieces.length === 1 && pieces[0].kind === 'region' ? 'Full source sheet' : number(pieces.length) + (w.id === 'full-bosses' ? ' assembled poses' : w.id === 'objects' ? ' variants & parts' : ' poses & parts')));
      button.append(canvas, info, create('span', 'actor-arrow', '▶')); button.addEventListener('click', () => chooseSource(w, source.id));
      const previewId = sheetFor(source).coverPieceId || sheetFor(source).previewPieceId;
      let preview = pieces.find(p => p.id === previewId);
      if (!preview && w.id !== 'environments') preview = pieces.find(p => p.sw >= 12 && p.sh >= 16 && p.sw <= 100 && p.sh <= 100);
      if (!preview) preview = pieces[0];
      if (w.id === 'environments') drawSourceThumbnail(canvas, source); else drawPiece(canvas, preview, 1);
      fragment.append(button);
    });
    w.actorList.append(fragment); saveState();
  }
  function buildWindow(category) {
    const panel = create('section', 'category-window'); panel.id = 'window-' + category.id; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'tab-' + category.id);
    const searchLabel = create('label', 'search'), search = create('input'); search.type = 'search'; search.placeholder = category.placeholder; search.setAttribute('aria-label', 'Search ' + category.label.toLowerCase()); searchLabel.append(create('span', '', '⌕'), search);
    const actorList = create('div', 'actor-list'); actorList.setAttribute('aria-label', category.type);
    const sourcePicker = create('details', 'source-picker'), sourceSummary = create('summary', '', 'Choose a source'), sourcePopover = create('div', 'source-popover'); sourcePopover.append(searchLabel, actorList); sourcePicker.append(sourceSummary, sourcePopover);
    const heading = create('div', 'pose-window-heading'), headingText = create('div'), title = create('h2'), count = create('span', 'pose-count'), sourceButton = create('button', 'source-button', 'Source archive'); headingText.append(title, count); heading.append(headingText, sourceButton);
    const controls = create('div', 'frame-controls'), frameSearch = create('input'); frameSearch.type = 'search'; frameSearch.placeholder = 'Filter poses...'; frameSearch.setAttribute('aria-label', 'Filter available poses or variants');
    const mode = create('select'); mode.setAttribute('aria-label', 'Piece view');
    mode.append(new Option(category.id === 'environments' ? 'Map regions' : 'Game pieces', 'pieces'));
    if (category.id === 'environments') mode.append(new Option('16 px tiles', 'grid16'), new Option('8 px tiles', 'grid8'), new Option('32 px tiles', 'grid32'));
    else mode.hidden = true;
    if (category.id === 'full-bosses') { mode.replaceChildren(new Option('Complete poses', 'pieces')); frameSearch.placeholder = 'Find a state or direction...'; }
    const row = create('select'); row.setAttribute('aria-label', 'Pose group or state'); row.append(new Option('All pose groups', ''));
    const direction = create('select'); direction.setAttribute('aria-label', 'Pose direction'); direction.append(new Option('All directions', '')); direction.hidden = true;
    controls.append(frameSearch, row, direction, mode);
    const scroll = create('div', 'pose-scroll'), grid = create('div', 'pose-grid'), empty = create('p', 'library-empty', 'No pieces match this filter.'), more = create('button', 'load-poses'), note = create('p', 'pose-note'); scroll.append(grid, empty, more, note);
    const creditRow = create('div', 'context-credit'), credit = create('span'), creditLink = create('a'); creditLink.target = '_blank'; creditLink.rel = 'noopener noreferrer'; creditRow.append(credit, creditLink);
    panel.append(sourcePicker, heading, controls, scroll, creditRow);
    const sources = allSources.filter(source => !hiddenSourceIds.has(String(source.id)) && normalize(sheetFor(source).category || source.section) === category.id && sourcePieces(source).length > 0);
    const previous = remembered.windows && remembered.windows[category.id] || {};
    const defaultSource = category.id === 'environments' ? '6526' : category.id === 'characters' ? '6369' : category.id === 'bosses' ? '6534' : category.id === 'full-bosses' ? 'full-boss-6535' : category.id === 'objects' ? '6437' : '6504';
    const sourceId = sources.some(s => String(s.id) === previous.sourceId) ? previous.sourceId : sources.some(s => String(s.id) === defaultSource) ? defaultSource : sources[0] && String(sources[0].id);
    const w = { ...category, panel, sourcePicker, sourceSummary, search, actorList, title, count, sourceButton, frameSearch, mode, row, direction, scroll, grid, empty, more, note, credit, creditLink, sources, sourceId, shown: 0, initialized: false, actorsRendered: false, pendingRow: previous.row || '', pendingDirection: previous.direction || '' };
    windows.set(category.id, w); $('libraryWindows').append(panel);
    if (previous.mode && [...mode.options].some(o => o.value === previous.mode)) mode.value = previous.mode;
    search.value = previous.search || '';
    sourcePicker.addEventListener('toggle', () => { if (sourcePicker.open) { if (!w.actorsRendered) renderActors(w); search.focus(); } });
    search.addEventListener('input', () => renderActors(w));
    frameSearch.addEventListener('input', () => renderPoses(w));
    row.addEventListener('change', () => { renderPoses(w); saveState(); });
    direction.addEventListener('change', () => { renderPoses(w); saveState(); });
    mode.addEventListener('change', () => { w.row.value = ''; updateRows(w); renderPoses(w); saveState(); });
    more.addEventListener('click', () => renderPoses(w, false));
    sourceButton.addEventListener('click', () => openCrop(originalSourceId(w.sourceId)));
    if (sourceId) setSourceMetadata(w, sourceId);
    panel.hidden = category.id !== activeCategory;
  }
  function showCategory(id) {
    if (!windows.has(id)) return;
    activeCategory = id;
    windows.forEach((w, key) => { w.panel.hidden = key !== id; if (key !== id) w.sourcePicker.open = false; });
    initializeWindow(windows.get(id));
    $('libraryTabs').querySelectorAll('button').forEach(b => { const active = b.dataset.category === id; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
    saveState();
  }
  function updateSelected() {
    const source = currentPiece && sourceMap.get(String(currentPiece.sourceId));
    $('pieceName').textContent = currentPiece ? (source ? source.name : currentPiece.name) : 'Choose a piece';
    $('pieceDimensions').textContent = currentPiece ? currentPiece.name + ' · ' + currentPiece.sw + ' × ' + currentPiece.sh + ' px' : 'Pick a window, then a pose.';
    $('placePieceBtn').disabled = !currentPiece;
    $('downloadPieceBtn').disabled = !currentPiece;
    const canSwap = currentPiece && studio.canSwapSelected && studio.canSwapSelected(currentPiece);
    $('swapPoseBtn').disabled = !canSwap;
    $('swapPoseBtn').textContent = canSwap ? 'Change selected pose' : 'Select a scene piece to change its pose';
    $('swapPoseBtn').title = canSwap ? 'Replace the selected piece with this pose, keeping its position and scale.' : 'Select a placed character or object, then choose another pose from the same source.';
    const canEditParts = !!studio.canEditBossParts?.();
    $('editBossPartsBtn').disabled = !canEditParts;
    $('bossEditHint').hidden = !canEditParts;
    const isLegacyBoss = !!studio.hasLegacyBossSelection?.();
    $('updateLegacyBossBtn').hidden = !isLegacyBoss;
    $('legacyBossHint').hidden = !isLegacyBoss;
    drawPiece($('piecePreview'), currentPiece);
    document.querySelectorAll('.pose-card').forEach(card => { const active = currentPiece && card.dataset.pieceId === currentPiece.id; card.classList.toggle('active', !!active); card.setAttribute('aria-pressed', String(!!active)); });
  }
  async function choosePiece(piece) {
    try { await studio.choosePiece(piece); currentPiece = piece; updateSelected(); } catch (error) { showToast(error.message || 'This piece could not be opened.'); }
  }
  async function placePiece(piece) {
    try { await studio.placePiece(piece); currentPiece = piece; updateSelected(); document.body.classList.remove('collection-open'); $('collectionToggle').setAttribute('aria-expanded', 'false'); } catch (error) { showToast(error.message || 'This piece could not be placed.'); }
  }
  function originalSourceId(id) { const source = sourceMap.get(String(id)); return String(source && (source.originalSourceId || source.sourceId) || id || ''); }
  async function openCrop(sourceId) {
    const dialog = $('cropDialog');
    if (!dialog.open) dialog.showModal();
    if (sourceId) {
      try { await studio.chooseAsset(String(sourceId)); } catch (error) { showToast(error.message); }
    } else if (!studio.activeAsset) {
      const w = windows.get(activeCategory); if (w && w.sourceId) await studio.chooseAsset(originalSourceId(w.sourceId));
    }
  }
  function renderCustomCrops() {
    const custom = studio.customPieces || [];
    $('customCropCount').textContent = custom.length;
    $('customCropsEmpty').hidden = custom.length > 0;
    const list = $('customCropsList'); list.replaceChildren();
    custom.forEach(piece => {
      const card = createPoseCard(piece, p => { choosePiece(p); $('customCropsDialog').close(); });
      card.querySelector('small').textContent = piece.name;
      const remove = create('button', 'delete-crop', '×'); remove.title = 'Remove this saved crop'; remove.setAttribute('aria-label', 'Remove ' + piece.name);
      // A sibling overlay avoids placing one button inside another button.
      const wrap = create('div', 'custom-piece-wrap'); wrap.style.position = 'relative'; remove.addEventListener('click', () => { studio.removeCustomPiece(piece.id); renderCustomCrops(); }); wrap.append(card, remove); list.append(wrap);
    });
  }
  function installGameArt() {
    const ui = window.MINISH_GAME_UI || {};
    const root = document.documentElement;
    if (ui.cssFontDataUrl) {
      const style = document.createElement('style'); style.textContent = '@font-face{font-family:MinishGame;src:url("' + ui.cssFontDataUrl + '") format("truetype");font-weight:normal;font-style:normal;font-display:swap}'; document.head.append(style);
    }
    if (ui.inventoryFrame) root.style.setProperty('--inventory-frame', 'url("' + ui.inventoryFrame.dataUrl + '")');
    if (ui.menuTab) root.style.setProperty('--menu-tab', 'url("' + ui.menuTab.dataUrl + '")');
    if (ui.menuPattern) root.style.setProperty('--menu-pattern', 'url("' + ui.menuPattern.dataUrl + '")');
    if (ui.dialogue) root.style.setProperty('--frame-image', 'url("' + ui.dialogue.dataUrl + '")');
    if (ui.pointer) root.style.setProperty('--game-pointer', 'url("' + ui.pointer.dataUrl + '")');
    if (window.MINISH_LOGO?.dataUrl) $('gameLogo').src = window.MINISH_LOGO.dataUrl;
    const source = sourceMap.get('6369'); if (source) { const poses = sourcePieces(source); const piece = poses.find(p => p.sw >= 14 && p.sw <= 24 && p.sh >= 22 && p.sh <= 34) || poses[0]; drawPiece($('makerEmblem'), piece, 0); }
  }
  installGameArt();
  categories.forEach(category => {
    const tab = create('button', ''); tab.id = 'tab-' + category.id; tab.dataset.category = category.id; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'window-' + category.id); tab.title = category.type;
    tab.append(create('span', 'tab-icon', category.icon), create('span', '', category.label)); tab.addEventListener('click', () => showCategory(category.id));
    tab.addEventListener('keydown', event => { if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const i = categories.findIndex(c => c.id === category.id); const next = event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length; showCategory(categories[next].id); $('tab-' + categories[next].id).focus(); });
    $('libraryTabs').append(tab); buildWindow(category);
  });
  showCategory(activeCategory);
  $('collectionSummary').textContent = 'Game artwork · clean regions & poses';
  $('placePieceBtn').addEventListener('click', () => { if (currentPiece) placePiece(currentPiece); });
  enablePieceDrag($('piecePreview'), () => currentPiece, $('piecePreview'));
  $('downloadPieceBtn').addEventListener('click', async () => { try { await studio.downloadSelectedPiecePNG(); } catch (error) { showToast(error.message || 'Choose a piece first.'); } });
  $('swapPoseBtn').addEventListener('click', async () => { if (!currentPiece) return; try { await studio.replaceSelectedPose(currentPiece); updateSelected(); } catch (error) { showToast(error.message); } });
  $('editBossPartsBtn').addEventListener('click', async () => { try { await studio.explodeSelectedBoss(); updateSelected(); } catch (error) { showToast(error.message || 'Select a complete multipart boss first.'); } });
  $('updateLegacyBossBtn').addEventListener('click', async () => { try { await studio.upgradeSelectedBoss(); updateSelected(); } catch (error) { showToast(error.message || 'Select an older full boss first.'); } });
  $('openCropBtn').addEventListener('click', () => openCrop(originalSourceId(windows.get(activeCategory).sourceId)));
  $('closeCropBtn').addEventListener('click', () => { $('cropDialog').close(); $('cropDialog').classList.remove('crop-expanded'); });
  $('saveCustomCropBtn').addEventListener('click', () => { try { const piece = studio.saveCustomPiece($('customCropName').value.trim()); if (piece) { currentPiece = piece; updateSelected(); renderCustomCrops(); $('customCropName').value = ''; showToast('Crop saved to My crops.'); } } catch (error) { showToast(error.message || 'Select a crop from the source sheet first.'); } });
  $('customPiecesBtn').addEventListener('click', () => { renderCustomCrops(); $('customCropsDialog').showModal(); });
  $('closeCustomCrops').addEventListener('click', () => $('customCropsDialog').close());
  $('coverageBtn').addEventListener('click', () => { const details = document.querySelector('.source-credit'); details.open = !details.open; });
  function renderCredits() {
    const query = $('creditsSearch').value.trim().toLowerCase();
    const sources = catalog.assets.filter(source => !query || [source.name, source.section, creditNames(source)].join(' ').toLowerCase().includes(query));
    const list = $('creditsList'); list.replaceChildren();
    $('creditsCount').textContent = number(sources.length) + ' of ' + number(catalog.assets.length) + ' source sheets';
    const fragment = document.createDocumentFragment();
    sources.forEach(source => {
      const row = create('article', 'credit-row'), copy = create('div');
      copy.append(create('strong', '', source.name), create('span', '', source.section + ' · ' + creditNames(source)));
      if (String(source.id) === '535841') copy.append(create('small', 'printed-sheet-credit', 'Printed sheet credit: Sprites ripped by Moosh. No credit is needed. Special thanks to P-Tux7.'));
      const link = create('a', '', 'Source ↗'); link.href = source.sourceUrl || catalog.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', 'Original ' + source.name + ' sheet and contributor credits');
      row.append(copy, link); fragment.append(row);
    });
    if (!sources.length) fragment.append(create('p', 'library-empty', 'No credits match. Try a sheet name or contributor.'));
    list.append(fragment);
  }
  function openCredits() { if ($('helpDialog').open) $('helpDialog').close(); renderCredits(); $('creditsDialog').showModal(); $('creditsSearch').focus(); }
  ['creditsBtn', 'libraryCreditsBtn', 'helpCreditsBtn'].forEach(id => $(id).addEventListener('click', openCredits));
  $('closeCredits').addEventListener('click', () => $('creditsDialog').close());
  $('creditsSearch').addEventListener('input', renderCredits);
  $('quickGuideBtn').addEventListener('click', () => { $('helpDialog').showModal(); });
  function setCanvasFocus(focused) {
    document.body.classList.toggle('canvas-focus', focused);
    document.body.classList.remove('inspector-open', 'collection-open');
    $('inspectorToggle').setAttribute('aria-expanded', 'false');
    $('collectionToggle').setAttribute('aria-expanded', 'false');
    $('canvasFocusBtn').textContent = focused ? 'Show panels' : 'Focus';
    $('canvasFocusBtn').setAttribute('aria-pressed', String(focused));
    requestAnimationFrame(() => $('fitBtn').click());
  }
  $('canvasFocusBtn').addEventListener('click', () => setCanvasFocus(!document.body.classList.contains('canvas-focus')));
  ['creditsDialog', 'customCropsDialog'].forEach(id => $(id).addEventListener('click', event => { if (event.target === $(id)) { const rect = $(id).getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $(id).close(); } }));
  $('inspectorToggle').addEventListener('click', () => { const open = document.body.classList.toggle('inspector-open'); if (open) { document.body.classList.remove('collection-open'); $('collectionToggle').setAttribute('aria-expanded', 'false'); } $('inspectorToggle').setAttribute('aria-expanded', String(open)); });
  $('inspectorClose').addEventListener('click', () => { document.body.classList.remove('inspector-open'); $('inspectorToggle').setAttribute('aria-expanded', 'false'); });
  $('collectionToggle').addEventListener('click', () => { if (document.body.classList.contains('canvas-focus')) setCanvasFocus(false); const open = document.body.classList.toggle('collection-open'); if (open) { document.body.classList.remove('inspector-open'); $('inspectorToggle').setAttribute('aria-expanded', 'false'); } $('collectionToggle').setAttribute('aria-expanded', String(open)); });
  $('libraryClose').addEventListener('click', () => { document.body.classList.remove('collection-open'); $('collectionToggle').setAttribute('aria-expanded', 'false'); });
  $('libraryExpand').addEventListener('click', () => { const expanded = document.querySelector('.library').classList.toggle('library-large'); $('libraryExpand').textContent = expanded ? '⤡' : '⤢'; $('libraryExpand').setAttribute('aria-label', expanded ? 'Dock piece library' : 'Expand piece library'); });
  document.addEventListener('click', event => { if (!event.target.closest('.source-picker')) windows.forEach(w => { w.sourcePicker.open = false; }); });
  document.addEventListener('keydown', event => { if (!document.body.classList.contains('animation-mode') && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.metaKey && !event.altKey && !document.querySelector('dialog[open]') && !/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '') && !event.target?.isContentEditable && event.key === 'Escape') { windows.forEach(w => { w.sourcePicker.open = false; }); document.querySelector('.app-menu').open = false; document.querySelector('.library').classList.remove('library-large'); document.body.classList.remove('inspector-open', 'collection-open'); $('collectionToggle').setAttribute('aria-expanded', 'false'); $('inspectorToggle').setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('minish:piece-selected', event => { currentPiece = event.detail && (event.detail.piece || event.detail); updateSelected(); });
  document.addEventListener('minish:selection-changed', updateSelected);
  document.addEventListener('minish:custom-pieces-changed', renderCustomCrops);
  function updateModeHint() {
    const active = document.querySelector('[data-tool].active'), mode = active?.dataset.tool || 'paint';
    const labels = { paint: 'Paint', select: 'Select', erase: 'Erase' };
    $('modeLabel').textContent = labels[mode] || 'Scene';
    $('modeHint').textContent = mode === 'select' ? 'Move pieces inside or outside the frame. ' + window.MINISH_CONTROLS.precisionLabel + ' places by 1 px.' : mode === 'erase' ? 'Remove whole pieces from the active layer. Undo restores them.' : currentPiece ? 'Drag a collection piece into the scene, or paint copies.' : 'Choose a piece, then drag it into the scene.';
    document.querySelectorAll('[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === mode)));
  }
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(updateModeHint);
    document.querySelectorAll('[data-tool]').forEach(button => observer.observe(button, { attributes: true, attributeFilter: ['class'] }));
  }
  document.addEventListener('minish:piece-selected', updateModeHint);
  document.addEventListener('minish:selection-changed', updateModeHint);
  document.addEventListener('minish:controls-changed', updateModeHint);
  document.addEventListener('click', event => { if (!event.target.closest('.app-menu')) document.querySelector('.app-menu').open = false; else if (event.target.closest('.app-menu-items button')) document.querySelector('.app-menu').open = false; });
  renderCustomCrops(); updateSelected(); updateModeHint();
  window.MINISH_LIBRARY = { showCategory, openCrop, choosePiece, refresh: () => { renderCustomCrops(); updateSelected(); }, get category() { return activeCategory; }, get selectedPiece() { return currentPiece; }, get windows() { return windows; } };
})();
