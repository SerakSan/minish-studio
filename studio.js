(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const catalog = window.MINISH_ASSETS || { assets: [], stats: {} };
  const sourceAssets = Array.isArray(catalog.assets) ? catalog.assets : [];
  const piecesCatalog = window.MINISH_PIECES || { assets: [], sheets: {} };
  const bossesCatalog = window.MINISH_BOSSES || { assets: [], sheets: {} };
  const legacyBosses = window.MINISH_LEGACY_BOSSES || { assets: [] };
  const spriteCatalog = window.MINISH_SPRITES || { assets: [], assetOverrides: {} };
  const curatedCatalog = window.MINISH_CURATED || { assets: [], sheets: {} };
  const assets = [...sourceAssets, ...(Array.isArray(piecesCatalog.assets) ? piecesCatalog.assets : []), ...(Array.isArray(spriteCatalog.assets) ? spriteCatalog.assets : []), ...(legacyBosses.assets || []), ...(curatedCatalog.assets || []), ...(Array.isArray(bossesCatalog.assets) ? bossesCatalog.assets : [])];
  const assetMap = new Map(assets.map(a => [String(a.id), a]));
  const allSheets = { ...(piecesCatalog.sheets || {}), ...(curatedCatalog.sheets || {}), ...(bossesCatalog.sheets || {}) };
  const pieceMap = new Map(Object.values(allSheets).flatMap(s => s.pieces || []).map(p => [String(p.id), p]));
  const PRESETS = {
    portrait: { width: 216, height: 270, exportScale: 5 },
    square: { width: 270, height: 270, exportScale: 4 },
    story: { width: 216, height: 384, exportScale: 5 },
    game: { width: 240, height: 160, exportScale: 4 }
  };
  const LAYERS = ['terrain', 'objects', 'overlay'];
  const STORAGE = 'minish-cap-studio-v1';
  const CUSTOM_STORAGE = 'minish-cap-studio-custom-pieces-v1';
  const CANVAS_LIMITS = Object.freeze({ minNative: 16, maxNative: 2048, minScale: 1, maxScale: 8, maxExportEdge: 8192, maxExportPixels: 16777216 });
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const scene = () => project.slides.find(s => s.id === project.activeSlide) || project.slides[0];
  const selected = () => scene().objects.find(o => o.id === selectedId);
  function newSlide(index = 1, preset = 'portrait', customFormat = null) {
    const format = PRESETS[preset] || customFormat || PRESETS.portrait;
    return { id: uid(), name: 'Scene ' + String(index).padStart(2, '0'), preset: PRESETS[preset] ? preset : 'custom', width: format.width, height: format.height, exportScale: format.exportScale, color: '#819452', transparent: true, objects: [] };
  }
  const initialSlide = newSlide();
  let project = { format: 'minish-cap-studio', version: 1, name: 'My little adventure', activeSlide: initialSlide.id, slides: [initialSlide] };
  let activeAsset = null, currentImage = null, brush = null, brushPiece = null, brushSize = 16, sheetZoom = 2;
  let customPieces = [];
  let layer = 'objects', tool = 'paint', selectedId = null, paintScale = 1, flipX = false, flipY = false;
  let stageZoom = 2, fitMode = true, sampleMode = false, sheetDrag = null, canvasDrag = null, hover = null;
  let renderedStageZoom = 2, zoomAnchor = null, zoomSettleTimer = null, gestureZoom = null;
  let copiedObject = null, pasteCount = 0, copiedByCut = false;
  let libraryDrag = null, editorGutter = { x: 16, y: 16 };
  let undoStack = [], redoStack = [], saveTimer, toastTimer, drawScheduled = false;
  const imageCache = new Map(), cropCache = new Map();
  let cropCachePixels = 0;
  const gameUI = window.MINISH_GAME_UI || {}, uiImages = new Map(), tintCache = new Map();
  const mainCanvas = $('sceneCanvas'), mainCtx = mainCanvas.getContext('2d');
  const placementCanvas = $('placementCanvas'), placementCtx = placementCanvas.getContext('2d');
  const sheetCanvas = $('sheetCanvas'), sheetCtx = sheetCanvas.getContext('2d');
  const previewCanvas = $('brushPreview'), previewCtx = previewCanvas.getContext('2d');
  const colorCanvas = document.createElement('canvas'), colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });

  function status(message) { $('statusText').textContent = message; }
  function emit(name, detail) { document.dispatchEvent(new CustomEvent(name, { detail: detail == null ? null : copy(detail) })); }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4500);
    status(message);
  }
  function imageFor(assetId) {
    const a = assetMap.get(String(assetId));
    if (!a) return Promise.reject(new Error('This sheet is missing from the collection.'));
    const key = String(a.id);
    if (imageCache.has(key)) return imageCache.get(key).promise;
    const image = new Image();
    const record = { image, ready: false, error: false };
    record.promise = new Promise((resolve, reject) => {
      image.onload = () => { record.ready = true; resolve(image); scheduleDraw(); };
      image.onerror = () => { record.error = true; reject(new Error('Could not open ' + a.name + '. Keep the assets folder beside this app.')); };
    });
    record.promise.catch(() => {});
    imageCache.set(key, record);
    image.src = a.dataUrl || a.path;
    return record.promise;
  }
  function readyImage(assetId) {
    const record = imageCache.get(String(assetId));
    if (record && record.ready) return record.image;
    if (!record) imageFor(assetId).catch(() => {});
    return null;
  }
  function uiImage(name) {
    const info = gameUI[name];
    if (!info?.dataUrl) return null;
    if (!uiImages.has(name)) {
      const image = new Image(), record = { image, ready: false };
      record.promise = new Promise(resolve => {
        image.onload = () => { record.ready = true; scheduleDraw(); resolve(image); };
        image.onerror = () => resolve(null);
      });
      uiImages.set(name, record); image.src = info.dataUrl;
    }
    const record = uiImages.get(name); return record.ready ? record.image : null;
  }
  async function prepareGameUI() {
    ['font', 'dialogue'].forEach(uiImage);
    await Promise.all([...uiImages.values()].map(record => record.promise));
    if (document.fonts?.ready) await document.fonts.ready;
  }
  function tintedFont(color) {
    const image = uiImage('font'); if (!image) return null;
    if (color.toLowerCase() === '#ffffff') return image;
    if (tintCache.has(color)) return tintCache.get(color);
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (tintCache.size > 24) tintCache.delete(tintCache.keys().next().value);
    tintCache.set(color, canvas); return canvas;
  }
  function drawGameFrame(ctx, w, h) {
    const image = uiImage('dialogue'); if (!image) return false;
    const info = gameUI.dialogue, edge = Math.min(info.slice || 6, w / 2, h / 2), sourceEdge = info.slice || 6;
    const sx = [0, sourceEdge, info.width - sourceEdge], sy = [0, sourceEdge, info.height - sourceEdge];
    const sw = [sourceEdge, info.width - sourceEdge * 2, sourceEdge], sh = [sourceEdge, info.height - sourceEdge * 2, sourceEdge];
    const dx = [0, edge, w - edge], dy = [0, edge, h - edge], dw = [edge, w - edge * 2, edge], dh = [edge, h - edge * 2, edge];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) if (dw[col] > 0 && dh[row] > 0) ctx.drawImage(image, sx[col], sy[row], sw[col], sh[row], dx[col], dy[row], dw[col], dh[row]);
    return true;
  }
  function gameTextMetrics(ctx, size) {
    const font = gameUI.font, atlas = uiImage('font');
    if (!font || !atlas) return null;
    const scale = Math.max(1, Math.round(size / (font.nominalSize || 12))), glyphs = font.glyphs || {};
    const advance = char => glyphs[char] ? glyphs[char].advance * scale : Math.ceil(ctx.measureText(char).width);
    return { scale, glyphs, advance, lineHeight: (font.lineHeight || 16) * scale,
      measure: text => [...text].reduce((sum, char) => sum + advance(char), 0) };
  }
  function drawGameText(ctx, text, x, y, color, metrics) {
    const atlas = tintedFont(color); if (!atlas) return;
    for (const char of text) {
      const glyph = metrics.glyphs[char];
      if (glyph) ctx.drawImage(atlas, glyph.x, glyph.y, glyph.w, glyph.h, Math.round(x), Math.round(y), glyph.w * metrics.scale, glyph.h * metrics.scale);
      else { ctx.fillStyle = color; ctx.fillText(char, Math.round(x), Math.round(y)); }
      x += metrics.advance(char);
    }
  }
  function historyBefore() {
    undoStack.push(JSON.stringify(project));
    if (undoStack.length > 45) undoStack.shift();
    redoStack.length = 0;
  }
  function changed(message) {
    scheduleDraw();
    updateInspector();
    updateHistory();
    scheduleSave();
    if (message) status(message);
  }
  function scheduleSave() {
    $('saveState').textContent = 'Saving in this browser…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const json = JSON.stringify(project);
        if (json.length > 3800000) throw new Error('large');
        localStorage.setItem(STORAGE, json);
        $('saveState').textContent = 'Saved in this browser';
      } catch (_) { $('saveState').textContent = 'Save a project file to keep your work'; }
    }, 500);
  }
  function updateHistory() {
    $('undoBtn').disabled = undoStack.length === 0;
    $('redoBtn').disabled = redoStack.length === 0;
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(project));
    project = JSON.parse(undoStack.pop());
    selectedId = null;
    refreshAll();
    scheduleSave();
    status('Last change undone.');
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(project));
    project = JSON.parse(redoStack.pop());
    selectedId = null;
    refreshAll();
    scheduleSave();
    status('Change restored.');
  }
  function cleanFilename(text) {
    return (text || 'scene').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'scene';
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function saveProject() {
    const saved = { ...project, savedAt: new Date().toISOString(), sourceUrl: catalog.sourceUrl || '', assets: [...new Set(project.slides.flatMap(s => s.objects.filter(o => o.assetId).map(o => o.assetId)))].map(id => { const a = assetMap.get(String(id)); return a ? { id: a.id, name: a.name, path: a.path, sourceUrl: a.sourceUrl } : { id }; }) };
    download(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }), cleanFilename(project.name) + '.minish.json');
    toast('Project saved. Open this JSON in Minish Studio to keep editing.');
  }
  function canvasFormat(value, strict = true) {
    const width = Number(value.width), height = Number(value.height), exportScale = Number(value.exportScale);
    const l = CANVAS_LIMITS;
    if (strict) {
      if (![width, height, exportScale].every(Number.isSafeInteger)) throw new Error('Use whole numbers for canvas width, height and export scale.');
      if (width < l.minNative || height < l.minNative || width > l.maxNative || height > l.maxNative) throw new Error('Canvas width and height must be between ' + l.minNative + ' and ' + l.maxNative + ' native pixels.');
      if (exportScale < l.minScale || exportScale > l.maxScale) throw new Error('Choose an export scale from 1× to 8×.');
      if (width * exportScale > l.maxExportEdge || height * exportScale > l.maxExportEdge || width * height * exportScale * exportScale > l.maxExportPixels) throw new Error('This export is too large. Lower the scale or canvas size to stay within 8192 pixels per side and 16 megapixels.');
      return { width, height, exportScale };
    }
    const w = clamp(Math.round(num(value.width, 216)), l.minNative, l.maxNative), h = clamp(Math.round(num(value.height, 270)), l.minNative, l.maxNative);
    const safeScale = Math.max(1, Math.min(l.maxScale, Math.floor(l.maxExportEdge / Math.max(w, h)), Math.floor(Math.sqrt(l.maxExportPixels / (w * h)))));
    return { width: w, height: h, exportScale: clamp(Math.round(num(value.exportScale, 5)), 1, safeScale) };
  }
  function setCanvasFormat(value) {
    const format = canvasFormat(value), s = scene();
    if (s.preset === 'custom' && Object.keys(format).every(key => s[key] === format[key])) return copy(s);
    historyBefore(); Object.assign(s, format, { preset: 'custom' }); fitMode = true;
    changed('Free canvas applied. Existing pieces keep their positions.');
    return copy(s);
  }
  function validateProject(data) {
    if (!data || data.format !== 'minish-cap-studio' || !Array.isArray(data.slides) || !data.slides.length || data.slides.length > 100) throw new Error('Choose a Minish Studio project JSON file.');
    const ids = new Set();
    data.slides.forEach((s, index) => {
      if (!s || !Array.isArray(s.objects) || s.objects.length > 30000) throw new Error('This project has an invalid scene.');
      if (!s.id || ids.has(s.id)) s.id = uid();
      ids.add(s.id);
      Object.assign(s, canvasFormat(s, false));
      const preset = PRESETS[s.preset];
      s.preset = preset && ['width', 'height', 'exportScale'].every(k => s[k] === preset[k]) ? s.preset : 'custom';
      s.name = String(s.name || 'Scene ' + (index + 1)).slice(0, 80);
      s.color = /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#819452';
      s.transparent = !!s.transparent;
      const objectIds = new Set();
      s.objects = s.objects.filter(o => o && ['sprite', 'dialogue'].includes(o.kind)).map(o => {
        o.id = String(o.id || uid()); if (objectIds.has(o.id)) o.id = uid(); objectIds.add(o.id);
        o.x = clamp(num(o.x), -100000, 100000); o.y = clamp(num(o.y), -100000, 100000);
        o.scale = clamp(Math.round(num(o.scale, 1)), 1, 8); o.layer = LAYERS.includes(o.layer) ? o.layer : 'objects';
        if (o.kind === 'sprite') {
          o.assetId = String(o.assetId); o.sx = Math.max(0, num(o.sx)); o.sy = Math.max(0, num(o.sy)); o.sw = clamp(num(o.sw, 16), 1, 32768); o.sh = clamp(num(o.sh, 16), 1, 32768);
          const asset = assetMap.get(o.assetId);
          if (asset) {
            o.sx = clamp(Math.floor(o.sx), 0, asset.width - 1); o.sy = clamp(Math.floor(o.sy), 0, asset.height - 1);
            o.sw = clamp(Math.round(o.sw), 1, asset.width - o.sx); o.sh = clamp(Math.round(o.sh), 1, asset.height - o.sy);
          }
          o.flipX = !!o.flipX; o.flipY = !!o.flipY;
          o.keyColor = /^#[0-9a-f]{6}$/i.test(o.keyColor) ? o.keyColor : null;
          if (o.sourceId != null) o.sourceId = String(o.sourceId).slice(0, 120);
          if (o.pieceId != null) o.pieceId = String(o.pieceId).slice(0, 160);
          if (o.pieceName != null) o.pieceName = String(o.pieceName).slice(0, 160);
        }
        else { o.text = String(o.text || '').slice(0, 5000); o.w = clamp(num(o.w, 192), 20, 2000); o.h = clamp(num(o.h, 58), 12, 2000); o.fontSize = clamp(num(o.fontSize, 9), 4, 48); o.color = /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#fff7d3'; }
        return o;
      });
    });
    data.name = String(data.name || 'My little adventure').slice(0, 80);
    if (!ids.has(data.activeSlide)) data.activeSlide = data.slides[0].id;
    return { format: 'minish-cap-studio', version: 1, name: data.name, activeSlide: data.activeSlide, slides: data.slides };
  }

  function renderLibrary() {
    const q = $('searchAssets').value.trim().toLocaleLowerCase(), filter = $('sectionFilter').value;
    const shown = sourceAssets.filter(a => (!filter || a.section === filter) && (!q || (a.name + ' ' + a.section).toLocaleLowerCase().includes(q)));
    const list = $('assetList'); list.replaceChildren();
    if (!shown.length) {
      const p = document.createElement('p'); p.className = 'no-results';
      p.textContent = sourceAssets.length ? 'No sheets match this search. Try a place, item or character name.' : 'The collection is still being prepared. Keep assets/catalog.js with this app, then reopen it.';
      list.append(p); return;
    }
    const fragment = document.createDocumentFragment();
    shown.forEach(a => {
      const button = document.createElement('button');
      button.className = 'asset-item' + (activeAsset && activeAsset.id === a.id ? ' active' : '');
      button.title = a.name + ' · ' + a.section; button.dataset.asset = a.id;
      if (a.thumbnail) {
        const img = document.createElement('img'); img.className = 'asset-thumb'; img.alt = ''; img.loading = 'lazy'; img.src = a.thumbnail; button.append(img);
      } else {
        const icon = document.createElement('span'); icon.className = 'asset-thumb asset-thumb-fallback'; icon.textContent = /map|background|area|location|town|forest/i.test(a.section + ' ' + a.name) ? '▦' : '♧'; button.append(icon);
      }
      const info = document.createElement('span'), name = document.createElement('span'), section = document.createElement('span');
      name.className = 'asset-name'; name.textContent = a.name; section.className = 'asset-section'; section.textContent = a.section || 'Collection';
      info.append(name, section); button.append(info); button.addEventListener('click', () => chooseAsset(a)); fragment.append(button);
    });
    list.append(fragment);
  }
  async function chooseAsset(asset) {
    activeAsset = asset; currentImage = null; brush = null; brushPiece = null;
    sampleMode = false;
    $('sampleColor').textContent = 'Pick from sheet';
    $('keyEnabled').checked = false;
    $('keyColor').value = asset.background?.suggestedKeyColor || '#ffffff';
    setTool('paint');
    $('sheetTitle').textContent = asset.name; $('sheetEmpty').hidden = false; $('sheetEmpty').textContent = 'Opening sheet…';
    sheetCanvas.width = 1; sheetCanvas.height = 1; sheetCanvas.style.width = '1px'; sheetCanvas.style.height = '1px';
    $('sheetViewport').scrollTo(0, 0); renderLibrary(); updateBrush();
    try {
      const img = await imageFor(asset.id);
      if (activeAsset.id !== asset.id) return;
      currentImage = img; $('sheetEmpty').hidden = true;
      const firstW = brushSize === 'free' ? Math.min(32, img.width) : Math.min(brushSize, img.width);
      const firstH = brushSize === 'free' ? Math.min(32, img.height) : Math.min(brushSize, img.height);
      brush = { sx: 0, sy: 0, sw: firstW, sh: firstH, sourceId: String(asset.sourceId || asset.id) };
      drawSheet(); updateBrush(); updateInspector(); scheduleDraw();
      status(asset.name + ' · ' + img.width + ' × ' + img.height + ' px. Select the piece you want to paint.');
    } catch (error) { $('sheetEmpty').textContent = error.message; toast(error.message); }
  }
  function normalizePiece(value) {
    const original = typeof value === 'string' ? pieceMap.get(value) || customPieces.find(p => p.id === value) : value;
    if (!original) throw new Error('Choose a piece from the collection first.');
    const originalAssetId = String(original.assetId), override = spriteCatalog.assetOverrides?.[originalAssetId];
    const asset = assetMap.get(override && assetMap.has(String(override)) ? String(override) : originalAssetId);
    if (!asset) throw new Error('The source sheet for this piece is missing.');
    const rect = ['sx', 'sy', 'sw', 'sh'].map(k => Math.round(Number(original[k])));
    if (rect.some(n => !Number.isFinite(n)) || rect[0] < 0 || rect[1] < 0 || rect[2] < 1 || rect[3] < 1 || rect[0] + rect[2] > asset.width || rect[1] + rect[3] > asset.height) throw new Error('This piece has an invalid source rectangle.');
    const sourceId = String(original.sourceId || asset.sourceId || asset.id);
    return { ...original, id: String(original.id || 'crop-' + sourceId + '-' + rect.join('-')), assetId: String(asset.id), sourceId,
      name: String(original.name || asset.name + ' crop').slice(0, 160), sx: rect[0], sy: rect[1], sw: rect[2], sh: rect[3],
      sourceRect: original.sourceRect || { x: rect[0], y: rect[1], w: rect[2], h: rect[3] } };
  }
  async function choosePiece(value) {
    const piece = normalizePiece(value), asset = assetMap.get(piece.assetId);
    if (piece.kind === 'tile' && piece.sw === piece.sh && [8, 16, 32].includes(piece.sw) && $('snapEnabled').checked) $('snapSize').value = String(piece.sw);
    activeAsset = asset; currentImage = null; brushPiece = piece;
    brush = { sx: piece.sx, sy: piece.sy, sw: piece.sw, sh: piece.sh, sourceId: piece.sourceId, pieceId: piece.id, pieceName: piece.name };
    sampleMode = false; $('sampleColor').textContent = 'Pick from sheet';
    $('keyEnabled').checked = !!piece.keyColor; $('keyColor').value = piece.keyColor || asset.background?.suggestedKeyColor || '#ffffff';
    const category = allSheets[piece.sourceId]?.category || '';
    layer = category === 'environments' || piece.kind === 'tile' ? 'terrain' : 'objects';
    setTool('paint', canSwapSelected(piece));
    $('sheetTitle').textContent = asset.name; $('sheetEmpty').hidden = false; $('sheetEmpty').textContent = 'Opening source…';
    renderLibrary(); updateBrush();
    const img = await imageFor(asset.id);
    if (brushPiece?.id !== piece.id || activeAsset?.id !== asset.id) return piece;
    currentImage = img; $('sheetEmpty').hidden = true;
    drawSheet(); updateBrush(); updateInspector(); scheduleDraw();
    emit('minish:piece-selected', piece);
    status(piece.name + ' ready. Paint on the scene, or place it in the center.');
    return copy(piece);
  }
  function getBrushPiece() {
    if (!brush || !activeAsset) return null;
    return { ...(brushPiece || {}), id: brushPiece?.id || 'crop-' + activeAsset.id + '-' + [brush.sx, brush.sy, brush.sw, brush.sh].join('-'),
      name: brushPiece?.name || activeAsset.name + ' crop', assetId: String(activeAsset.id), sourceId: String(brush.sourceId || activeAsset.sourceId || activeAsset.id),
      sx: brush.sx, sy: brush.sy, sw: brush.sw, sh: brush.sh, keyColor: keySetting(), kind: brushPiece?.kind || 'custom',
      sourceRect: brushPiece?.sourceRect || { x: brush.sx, y: brush.sy, w: brush.sw, h: brush.sh } };
  }
  async function getPieceSource(value) {
    const piece = normalizePiece(value);
    await imageFor(piece.assetId);
    return spriteCrop({ ...piece, keyColor: piece.keyColor || null });
  }
  async function exportPiecePNG(value = null, options = {}) {
    const candidate = value || getBrushPiece() || (selected()?.kind === 'sprite' ? selected() : null);
    const piece = normalizePiece(candidate), scale = options.scale == null ? 1 : Number(options.scale);
    if (!Number.isSafeInteger(scale) || scale < 1 || scale > CANVAS_LIMITS.maxScale) throw new Error('Choose a PNG scale from 1× to 8×.');
    const width = piece.sw * scale, height = piece.sh * scale;
    if (width > CANVAS_LIMITS.maxExportEdge || height > CANVAS_LIMITS.maxExportEdge || width * height > CANVAS_LIMITS.maxExportPixels) throw new Error('This piece is too large for a PNG. Use a smaller crop or scale.');
    await imageFor(piece.assetId);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    drawObject(ctx, { ...piece, kind: 'sprite', x: 0, y: 0, scale, flipX: !!options.flipX, flipY: !!options.flipY, keyColor: piece.keyColor || null });
    return new Promise((resolve, reject) => {
      try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not make the piece PNG.')), 'image/png'); }
      catch (_) { reject(new Error('The browser could not export this piece. Please reopen the app and try again.')); }
    });
  }
  async function downloadSelectedPiecePNG(value = null, options = {}) {
    const candidate = value || getBrushPiece() || (selected()?.kind === 'sprite' ? selected() : null);
    const piece = normalizePiece(candidate), blob = await exportPiecePNG(piece, options);
    download(blob, cleanFilename(piece.name) + '.png'); toast('Piece saved as a PNG. Existing transparency is preserved.');
    return blob;
  }
  async function placePiece(value) {
    const piece = await choosePiece(value), s = scene();
    historyBefore();
    const object = { id: uid(), kind: 'sprite', assetId: piece.assetId, sx: piece.sx, sy: piece.sy, sw: piece.sw, sh: piece.sh,
      sourceId: piece.sourceId, pieceId: piece.id, pieceName: piece.name,
      x: Math.max(0, Math.floor((s.width - piece.sw * paintScale) / 2)), y: Math.max(0, Math.floor((s.height - piece.sh * paintScale) / 2)),
      scale: paintScale, flipX, flipY, keyColor: keySetting(), layer };
    s.objects.push(object); selectedId = object.id; setTool('select'); changed(piece.name + ' placed. Drag it into position.');
    return copy(object);
  }
  function piecePosition(value, point, options = {}) {
    const piece = normalizePiece(value), scale = clamp(Math.round(num(options.scale, paintScale)), 1, 8);
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error('Choose a position in the scene workspace.');
    const offset = options.center === false ? { x: 0, y: 0 } : { x: piece.sw * scale / 2, y: piece.sh * scale / 2 };
    return { x: clamp(snapCoord(point.x - offset.x, true, options.precise), -100000, 100000),
      y: clamp(snapCoord(point.y - offset.y, true, options.precise), -100000, 100000), scale };
  }
  async function placePieceAt(value, point, options = {}) {
    const piece = normalizePiece(value), target = scene(), position = piecePosition(piece, point, options);
    const pieceLayer = allSheets[piece.sourceId]?.category === 'environments' || piece.kind === 'tile' ? 'terrain' : 'objects';
    const settings = { flipX: options.flipX ?? flipX, flipY: options.flipY ?? flipY,
      layer: LAYERS.includes(options.layer) ? options.layer : pieceLayer };
    await imageFor(piece.assetId);
    if (scene() !== target) throw new Error('The scene changed while the piece was opening. Drop it again.');
    await choosePiece(piece);
    if (scene() !== target) throw new Error('The scene changed while the piece was opening. Drop it again.');
    const object = { id: uid(), kind: 'sprite', assetId: piece.assetId, sx: piece.sx, sy: piece.sy, sw: piece.sw, sh: piece.sh,
      sourceId: piece.sourceId, pieceId: piece.id, pieceName: piece.name, ...position, ...settings, keyColor: piece.keyColor || null };
    historyBefore(); target.objects.push(object); selectedId = object.id; layer = object.layer;
    setTool('select'); changed(piece.name + ' placed. Arrows move one pixel; Undo restores the scene.');
    return copy(object);
  }
  function beginPieceDrag(value) {
    const piece = normalizePiece(value);
    const pieceLayer = allSheets[piece.sourceId]?.category === 'environments' || piece.kind === 'tile' ? 'terrain' : 'objects';
    if (piece.kind === 'tile' && piece.sw === piece.sh && [8, 16, 32].includes(piece.sw) && $('snapEnabled').checked) $('snapSize').value = String(piece.sw);
    libraryDrag = { piece, scale: paintScale, flipX, flipY, layer: pieceLayer, sceneId: scene().id, position: null };
    imageFor(piece.assetId).catch(error => toast(error.message));
    $('stageViewport').classList.add('accepting-piece'); hover = null; scheduleDraw();
    return { ...copy(piece), scale: paintScale };
  }
  function endPieceDrag() {
    libraryDrag = null; $('stageViewport').classList.remove('accepting-piece'); scheduleDraw();
  }
  function sourceIdFor(object) { return String(object.sourceId || assetMap.get(String(object.assetId))?.sourceId || object.assetId); }
  function canSwapSelected(value) {
    const object = selected();
    if (!object || object.kind !== 'sprite') return false;
    const sourceId = typeof value === 'object' && value ? value.sourceId || assetMap.get(String(value.assetId))?.sourceId || value.assetId : value;
    return sourceId != null && sourceIdFor(object) === String(sourceId);
  }
  async function replaceSelectedPose(value) {
    const piece = normalizePiece(value), object = selected();
    if (!canSwapSelected(piece)) throw new Error('Select a piece from this same character or object sheet to change its pose.');
    await imageFor(piece.assetId);
    if (selected() !== object) throw new Error('Selection changed. Select the piece again to change its pose.');
    const category = allSheets[piece.sourceId]?.category || '';
    const s = object.scale || 1, centerX = object.x + object.sw * s / 2;
    const yAnchor = object.y + object.sh * s * (category === 'objects' || category === 'environments' ? .5 : 1);
    historyBefore();
    Object.assign(object, { assetId: piece.assetId, sx: piece.sx, sy: piece.sy, sw: piece.sw, sh: piece.sh, sourceId: piece.sourceId, pieceId: piece.id, pieceName: piece.name,
      x: centerX - piece.sw * s / 2, y: yAnchor - piece.sh * s * (category === 'objects' || category === 'environments' ? .5 : 1), keyColor: piece.keyColor || null });
    changed('Pose changed. Position, scale and layer kept.');
    emit('minish:piece-selected', piece);
    return copy(object);
  }
  function persistCustomPieces() {
    try { localStorage.setItem(CUSTOM_STORAGE, JSON.stringify(customPieces)); }
    catch (_) { toast('Your custom shelf is full. Remove an unused piece before saving more.'); return false; }
    emit('minish:custom-pieces-changed', customPieces); return true;
  }
  function saveCustomPiece(label) {
    const current = getBrushPiece();
    if (!current) throw new Error('Select a crop from a source sheet first.');
    const piece = normalizePiece({ ...current, id: 'custom-' + uid(), name: String(label || current.name).slice(0, 160), custom: true });
    customPieces.push(piece);
    if (!persistCustomPieces()) { customPieces.pop(); return null; }
    toast('Crop saved to your custom shelf.'); return copy(piece);
  }
  function removeCustomPiece(id) { customPieces = customPieces.filter(p => p.id !== id); persistCustomPieces(); }
  function drawSheet() {
    if (!currentImage) return;
    if (sheetCanvas.width !== currentImage.width || sheetCanvas.height !== currentImage.height) { sheetCanvas.width = currentImage.width; sheetCanvas.height = currentImage.height; }
    sheetCanvas.style.width = Math.round(currentImage.width * sheetZoom) + 'px'; sheetCanvas.style.height = Math.round(currentImage.height * sheetZoom) + 'px';
    sheetCtx.imageSmoothingEnabled = false; sheetCtx.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height); sheetCtx.drawImage(currentImage, 0, 0);
    const size = brushSize === 'free' ? 16 : brushSize;
    if ($('sheetGrid').checked) {
      sheetCtx.save(); sheetCtx.strokeStyle = '#163c3952'; sheetCtx.lineWidth = 1 / sheetZoom; sheetCtx.beginPath();
      for (let x = num($('offsetX').value) % size; x < sheetCanvas.width; x += size) { sheetCtx.moveTo(x, 0); sheetCtx.lineTo(x, sheetCanvas.height); }
      for (let y = num($('offsetY').value) % size; y < sheetCanvas.height; y += size) { sheetCtx.moveTo(0, y); sheetCtx.lineTo(sheetCanvas.width, y); }
      sheetCtx.stroke(); sheetCtx.restore();
    }
    if (brush) {
      sheetCtx.fillStyle = '#fff7ba22'; sheetCtx.fillRect(brush.sx, brush.sy, brush.sw, brush.sh);
      sheetCtx.strokeStyle = '#fff9ce'; sheetCtx.lineWidth = 3 / sheetZoom; sheetCtx.strokeRect(brush.sx, brush.sy, brush.sw, brush.sh);
      sheetCtx.strokeStyle = '#386330'; sheetCtx.lineWidth = 1 / sheetZoom; sheetCtx.strokeRect(brush.sx, brush.sy, brush.sw, brush.sh);
    }
    $('sheetZoomValue').textContent = (sheetZoom % 1 ? sheetZoom.toFixed(1) : sheetZoom) + '×';
  }
  function keySetting() { return $('keyEnabled').checked ? $('keyColor').value.toLowerCase() : null; }
  function renderedAssetId(object) {
    const override = object.pieceId && spriteCatalog.assetOverrides?.[String(object.assetId)];
    return override && assetMap.has(String(override)) ? String(override) : String(object.assetId);
  }
  function spriteCrop(object) {
    const assetId = renderedAssetId(object);
    const img = readyImage(assetId); if (!img) return null;
    if (!object.keyColor) return { image: img, sx: object.sx, sy: object.sy, sw: object.sw, sh: object.sh };
    const key = [assetId, object.sx, object.sy, object.sw, object.sh, object.keyColor].join(':');
    if (cropCache.has(key)) return { image: cropCache.get(key), sx: 0, sy: 0, sw: object.sw, sh: object.sh };
    const c = document.createElement('canvas'); c.width = object.sw; c.height = object.sh;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, object.sx, object.sy, object.sw, object.sh, 0, 0, object.sw, object.sh);
    try {
      const pixels = ctx.getImageData(0, 0, c.width, c.height), hex = object.keyColor.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i] === r && pixels.data[i + 1] === g && pixels.data[i + 2] === b) pixels.data[i + 3] = 0;
      ctx.putImageData(pixels, 0, 0);
      while (cropCache.size && (cropCache.size >= 350 || cropCachePixels + c.width * c.height > 8388608)) {
        const oldest = cropCache.keys().next().value, cached = cropCache.get(oldest); cropCachePixels -= cached.width * cached.height; cropCache.delete(oldest);
      }
      cropCachePixels += c.width * c.height;
      cropCache.set(key, c); return { image: c, sx: 0, sy: 0, sw: object.sw, sh: object.sh };
    } catch (_) {
      throw new Error('The browser blocked local pixel access. Open the supplied studio launcher, or serve this folder locally, then try again.');
    }
  }
  function updateBrush() {
    previewCtx.clearRect(0, 0, 52, 52); previewCtx.imageSmoothingEnabled = false;
    if (!brush || !activeAsset || !currentImage) { $('brushLabel').textContent = 'No tile selected'; $('brushCoords').textContent = 'Click a tile, then paint on the scene.'; return; }
    const object = { ...brush, assetId: activeAsset.id, keyColor: keySetting() };
    try {
      const source = spriteCrop(object);
      if (source) {
        const zoom = Math.min(44 / brush.sw, 44 / brush.sh), w = Math.max(1, Math.floor(brush.sw * zoom)), h = Math.max(1, Math.floor(brush.sh * zoom));
        previewCtx.drawImage(source.image, source.sx, source.sy, source.sw, source.sh, Math.floor((52 - w) / 2), Math.floor((52 - h) / 2), w, h);
      }
    } catch (error) { toast(error.message); $('keyEnabled').checked = false; }
    $('brushLabel').textContent = brushPiece ? brushPiece.name : brush.sw + ' × ' + brush.sh + ' px selected';
    $('brushCoords').textContent = 'At ' + brush.sx + ', ' + brush.sy + ' · ' + (brushSize === 'free' ? 'Free crop' : brushSize + ' px grid');
    emit('minish:piece-selected', getBrushPiece());
  }
  function sheetPoint(event) {
    const rect = sheetCanvas.getBoundingClientRect();
    return { x: clamp(Math.floor((event.clientX - rect.left) / sheetZoom), 0, currentImage.width - 1), y: clamp(Math.floor((event.clientY - rect.top) / sheetZoom), 0, currentImage.height - 1) };
  }
  function samplePixel(x, y) {
    if (!currentImage) return;
    colorCanvas.width = 1; colorCanvas.height = 1; colorCtx.drawImage(currentImage, x, y, 1, 1, 0, 0, 1, 1);
    try {
      const p = colorCtx.getImageData(0, 0, 1, 1).data;
      if (p[3] === 0) {
        $('keyEnabled').checked = false; updateBrush();
        toast('This pixel is already transparent. The original transparency is preserved.');
        return;
      }
      $('keyColor').value = '#' + [...p.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join('');
      $('keyEnabled').checked = true; updateBrush(); toast('Color sampled. New stamps will remove ' + $('keyColor').value + '.');
    } catch (_) { toast('The browser blocked local pixel access. Open the supplied studio launcher to enable sampling and export.'); }
  }
  sheetCanvas.addEventListener('pointerdown', event => {
    if (!currentImage || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); const p = sheetPoint(event);
    if (sampleMode) { samplePixel(p.x, p.y); sampleMode = false; sheetCanvas.style.cursor = 'crosshair'; $('sampleColor').textContent = 'Pick from sheet'; return; }
    sheetCanvas.setPointerCapture(event.pointerId); sheetDrag = { start: p, pointerId: event.pointerId };
    selectSheetRect(p, p); setTool('paint');
  });
  function selectSheetRect(start, end) {
    brushPiece = null;
    if (brushSize === 'free') {
      const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
      brush = { sx: x, sy: y, sw: Math.abs(end.x - start.x) + 1, sh: Math.abs(end.y - start.y) + 1 };
    } else {
      const ox = num($('offsetX').value), oy = num($('offsetY').value), size = brushSize;
      const x1 = Math.floor((Math.min(start.x, end.x) - ox) / size) * size + ox;
      const y1 = Math.floor((Math.min(start.y, end.y) - oy) / size) * size + oy;
      const x2 = Math.floor((Math.max(start.x, end.x) - ox) / size) * size + ox + size;
      const y2 = Math.floor((Math.max(start.y, end.y) - oy) / size) * size + oy + size;
      const x = Math.max(0, x1), y = Math.max(0, y1);
      brush = { sx: x, sy: y, sw: Math.max(1, Math.min(currentImage.width, x2) - x), sh: Math.max(1, Math.min(currentImage.height, y2) - y) };
    }
    brush.sourceId = String(activeAsset.sourceId || activeAsset.id);
    drawSheet(); updateBrush();
    emit('minish:piece-selected', getBrushPiece());
  }
  sheetCanvas.addEventListener('pointermove', event => { if (sheetDrag) selectSheetRect(sheetDrag.start, sheetPoint(event)); });
  function endSheetDrag() { if (sheetDrag) { sheetDrag = null; status('Brush ready. Paint this piece on the scene.'); } }
  sheetCanvas.addEventListener('pointerup', endSheetDrag); sheetCanvas.addEventListener('pointercancel', endSheetDrag);

  function objectBounds(object) {
    const s = object.scale || 1;
    return { x: object.x, y: object.y, w: (object.kind === 'sprite' ? object.sw : object.w) * s, h: (object.kind === 'sprite' ? object.sh : object.h) * s };
  }
  function orderedObjects(slide) { return LAYERS.flatMap(name => slide.objects.filter(o => o.layer === name)); }
  function wrapText(ctx, text, width, measure = text => ctx.measureText(text).width) {
    const result = [];
    String(text || '').split('\n').forEach(paragraph => {
      if (!paragraph) { result.push(''); return; }
      let line = '';
      for (const word of paragraph.split(' ')) {
        if (line && measure(line + ' ' + word) > width) { result.push(line); line = ''; }
        const candidate = line ? line + ' ' + word : word;
        if (measure(candidate) <= width) line = candidate;
        else {
          if (line) { result.push(line); line = ''; }
          for (const char of word) {
            if (line && measure(line + char) > width) { result.push(line); line = ''; }
            line += char;
          }
        }
      }
      result.push(line);
    });
    return result;
  }
  function drawObject(ctx, object) {
    const s = object.scale || 1;
    ctx.save(); ctx.translate(Math.round(object.x), Math.round(object.y)); ctx.scale(s, s);
    if (object.kind === 'sprite') {
      const source = spriteCrop(object);
      if (source) {
        ctx.translate(object.flipX ? object.sw : 0, object.flipY ? object.sh : 0); ctx.scale(object.flipX ? -1 : 1, object.flipY ? -1 : 1);
        ctx.drawImage(source.image, source.sx, source.sy, source.sw, source.sh, 0, 0, object.sw, object.sh);
      }
    } else {
      const w = object.w, h = object.h, pad = object.box === false ? 0 : gameUI.dialogue?.padding || 10;
      if (object.box !== false && !drawGameFrame(ctx, w, h)) {
        ctx.fillStyle = '#18263a'; ctx.fillRect(0, 3, w, h - 6); ctx.fillRect(3, 0, w - 6, h);
        ctx.fillStyle = '#d7c282'; ctx.fillRect(3, 1, w - 6, 2); ctx.fillRect(3, h - 3, w - 6, 2); ctx.fillRect(1, 3, 2, h - 6); ctx.fillRect(w - 3, 3, 2, h - 6);
        ctx.fillStyle = '#f8ecc2'; ctx.fillRect(4, 4, w - 8, 1); ctx.fillRect(4, 4, 1, h - 8); ctx.fillStyle = '#536784'; ctx.fillRect(4, h - 5, w - 8, 1); ctx.fillRect(w - 5, 4, 1, h - 8);
      }
      ctx.beginPath(); ctx.rect(pad, pad, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2)); ctx.clip();
      ctx.font = object.fontSize + 'px ui-monospace, Menlo, Consolas, monospace'; ctx.textBaseline = 'top';
      const metrics = gameTextMetrics(ctx, object.fontSize);
      const lines = wrapText(ctx, object.text, Math.max(1, w - pad * 2), metrics?.measure);
      lines.forEach((lineText, index) => {
        const y = pad + Math.round(index * (metrics?.lineHeight || object.fontSize * 1.45));
        if (metrics) drawGameText(ctx, lineText, pad, y, object.color || '#fff7d3', metrics);
        else { ctx.fillStyle = '#111c29'; ctx.fillText(lineText, pad + 1, y + 1); ctx.fillStyle = object.color || '#fff7d3'; ctx.fillText(lineText, pad, y); }
      });
    }
    ctx.restore();
  }
  function drawScene(ctx, slide, options = {}) {
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, slide.width, slide.height);
    if (!slide.transparent) { ctx.fillStyle = slide.color; ctx.fillRect(0, 0, slide.width, slide.height); }
    for (const object of orderedObjects(slide)) {
      try { drawObject(ctx, object); } catch (error) { if (!options.quiet) status(error.message); }
    }
    if (options.grid && $('sceneGrid').checked) {
      const step = snapStep(); ctx.save(); ctx.strokeStyle = '#12382d33'; ctx.lineWidth = .5;
      ctx.beginPath();
      for (let x = step; x < slide.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, slide.height); }
      for (let y = step; y < slide.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(slide.width, y); }
      ctx.stroke(); ctx.restore();
    }
  }
  function scheduleDraw() {
    if (drawScheduled) return; drawScheduled = true;
    requestAnimationFrame(() => { drawScheduled = false; renderStage(); renderSlides(); });
  }
  function drawPlacement() {
    const s = scene(), ctx = placementCtx, g = editorGutter;
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, placementCanvas.width, placementCanvas.height);
    ctx.save(); ctx.translate(g.x, g.y);
    // The pasteboard is editor-only. Export and carousel canvases keep the scene crop.
    ctx.save(); ctx.beginPath(); ctx.rect(-g.x, -g.y, s.width + g.x * 2, s.height + g.y * 2); ctx.rect(0, 0, s.width, s.height); ctx.clip('evenodd');
    ctx.globalAlpha = .5;
    for (const object of orderedObjects(s)) { try { drawObject(ctx, object); } catch (_) {} }
    ctx.restore();
    let preview = null;
    if (libraryDrag?.position) {
      const { piece, position, scale, flipX, flipY } = libraryDrag;
      preview = { kind: 'sprite', ...piece, ...position, scale, flipX, flipY, keyColor: piece.keyColor || null };
    } else if (hover && tool === 'paint' && brush && activeAsset && currentImage && !canvasDrag) {
      preview = { kind: 'sprite', ...brush, assetId: activeAsset.id,
        x: snapCoord(hover.x, false, hover.precise), y: snapCoord(hover.y, false, hover.precise),
        scale: paintScale, flipX, flipY, keyColor: keySetting() };
    }
    if (preview) { ctx.save(); ctx.globalAlpha = .65; try { drawObject(ctx, preview); } catch (_) {} ctx.restore(); }
    const outline = preview || selected();
    if (outline) {
      const b = objectBounds(outline); ctx.lineWidth = 1 / stageZoom; ctx.strokeStyle = '#fffbd7'; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#2e624b'; ctx.setLineDash([3 / stageZoom, 3 / stageZoom]); ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
    ctx.restore();
    const position = preview || (canvasDrag?.object) || (hover ? { x: Math.floor(hover.x), y: Math.floor(hover.y) } : selected());
    $('placementCoordinates').textContent = position ? 'X ' + Math.round(position.x) + ' · Y ' + Math.round(position.y) : 'Native pixels';
    const precise = !$('snapEnabled').checked || snapStep() === 1;
    $('precisionBtn').setAttribute('aria-pressed', String(precise));
  }
  function renderStage() {
    const s = scene();
    if (mainCanvas.width !== s.width || mainCanvas.height !== s.height) { mainCanvas.width = s.width; mainCanvas.height = s.height; }
    if (fitMode) {
      const vp = $('stageViewport');
      const style = window.getComputedStyle?.(vp);
      const horizontal = style ? num(parseFloat(style.paddingLeft)) + num(parseFloat(style.paddingRight)) : 44;
      const vertical = style ? num(parseFloat(style.paddingTop)) + num(parseFloat(style.paddingBottom)) : 44;
      const available = Math.min((vp.clientWidth - horizontal - 48) / s.width, (vp.clientHeight - vertical - 48) / s.height);
      stageZoom = available >= 1 ? clamp(Math.floor(available), 1, 6) : clamp(available, .05, 1);
    }
    mainCanvas.style.width = (s.width * stageZoom) + 'px'; mainCanvas.style.height = (s.height * stageZoom) + 'px';
    const vp = $('stageViewport');
    // Manual zoom keeps a scrollable pasteboard even when the frame still fits
    // in one axis. That gives the cursor anchor room instead of clamping it to
    // the center. Fit retains small margins and a centered composition.
    const margin = fitMode ? 24 : Math.max(32, vp.clientWidth / 2, vp.clientHeight / 2);
    const layoutGutter = Math.min(512, Math.max(1, Math.ceil(margin / stageZoom)));
    // Use the available surrounding space without moving the frame when a
    // placed piece crosses its edge.
    editorGutter = { x: Math.max(layoutGutter, Math.min(512, Math.floor(((vp.clientWidth - 10) / stageZoom - s.width) / 2))),
      y: Math.max(layoutGutter, Math.min(512, Math.floor(((vp.clientHeight - 10) / stageZoom - s.height) / 2))) };
    const wrap = $('canvasWrap'); wrap.style.padding = layoutGutter * stageZoom + 'px';
    const pw = s.width + editorGutter.x * 2, ph = s.height + editorGutter.y * 2;
    if (placementCanvas.width !== pw || placementCanvas.height !== ph) { placementCanvas.width = pw; placementCanvas.height = ph; }
    placementCanvas.style.width = pw * stageZoom + 'px'; placementCanvas.style.height = ph * stageZoom + 'px';
    placementCanvas.style.left = (layoutGutter - editorGutter.x) * stageZoom + 'px'; placementCanvas.style.top = (layoutGutter - editorGutter.y) * stageZoom + 'px';
    // Flex centering can land on a half pixel and blur even an integer-zoom canvas.
    wrap.style.transform = 'none';
    const canvasRect = mainCanvas.getBoundingClientRect();
    const pixelOffset = { x: Math.round(canvasRect.left) - canvasRect.left, y: Math.round(canvasRect.top) - canvasRect.top };
    wrap.style.transform = 'translate(' + pixelOffset.x + 'px,' + pixelOffset.y + 'px)';
    renderedStageZoom = stageZoom;
    if (zoomAnchor) {
      const anchor = zoomAnchor, updated = mainCanvas.getBoundingClientRect(); zoomAnchor = null;
      vp.scrollLeft = num(vp.scrollLeft) + updated.left + anchor.x * stageZoom - anchor.clientX;
      vp.scrollTop = num(vp.scrollTop) + updated.top + anchor.y * stageZoom - anchor.clientY;
      const scrolled = mainCanvas.getBoundingClientRect();
      wrap.style.transform = 'translate(' + (pixelOffset.x + Math.round(scrolled.left) - scrolled.left) + 'px,' + (pixelOffset.y + Math.round(scrolled.top) - scrolled.top) + 'px)';
    }
    mainCanvas.style.cursor = tool === 'select' ? 'default' : tool === 'erase' ? 'cell' : 'crosshair';
    $('stageViewport').style.cursor = mainCanvas.style.cursor;
    drawScene(mainCtx, s, { grid: true }); drawPlacement();
    $('stageZoomLabel').textContent = Math.round(stageZoom * 100) + '%';
    $('emptyNudge').hidden = s.objects.length > 0;
  }
  function renderSlides() {
    const list = $('slideList');
    if (list.children.length !== project.slides.length || project.slides.some((s, i) => list.children[i]?.dataset.slide !== s.id)) {
      list.replaceChildren();
      project.slides.forEach(s => {
        const button = document.createElement('button'); button.className = 'slide-card'; button.dataset.slide = s.id;
        const c = document.createElement('canvas'), title = document.createElement('span'), number = document.createElement('i');
        button.append(c, title, number); button.addEventListener('click', () => switchSlide(s.id)); list.append(button);
      });
    }
    project.slides.forEach((s, i) => {
      const card = list.children[i], c = card.querySelector('canvas');
      card.classList.toggle('active', s.id === project.activeSlide); card.title = s.name; card.setAttribute('aria-label', 'Open ' + s.name); card.setAttribute('aria-current', s.id === project.activeSlide ? 'true' : 'false');
      card.querySelector('span').textContent = s.name; card.querySelector('i').textContent = String(i + 1).padStart(2, '0');
      const thumbnailScale = Math.min(1, 144 / s.width, 144 / s.height), w = Math.max(1, Math.round(s.width * thumbnailScale)), h = Math.max(1, Math.round(s.height * thumbnailScale));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ctx = c.getContext('2d'); ctx.save(); ctx.setTransform(w / s.width, 0, 0, h / s.height, 0, 0); drawScene(ctx, s, { quiet: true }); ctx.restore();
    });
  }
  function updateInspector() {
    const s = scene(), object = selected();
    const styleBadge = $('sceneStyleBadge'); styleBadge.hidden = !s.generated;
    styleBadge.textContent = s.generated?.style === 'wild' ? 'Wild mashup' : 'Game-inspired';
    styleBadge.title = s.generated?.style === 'wild' ? 'An imaginative editor scene using genuine game art.' : 'A new editor scene using reviewed placement areas.';
    $('sceneHeading').textContent = s.name; $('slideName').value = s.name;
    $('aspectPreset').value = s.preset || 'portrait'; $('sceneColor').value = s.color; $('transparentScene').checked = s.transparent;
    if ($('customSizeFields')) $('customSizeFields').hidden = s.preset !== 'custom';
    for (const [id, value] of [['customWidth', s.width], ['customHeight', s.height], ['customExportScale', s.exportScale]]) if ($(id) && document.activeElement !== $(id)) $(id).value = value;
    $('exportSize').textContent = s.width * s.exportScale + ' × ' + s.height * s.exportScale;
    $('nativeSize').textContent = s.width + ' × ' + s.height + ' native pixels · ' + s.exportScale + '× export';
    $('sceneSize').textContent = s.width + ' × ' + s.height + ' px · export ' + s.width * s.exportScale + ' × ' + s.height * s.exportScale;
    $('objectCount').textContent = s.objects.length + (s.objects.length === 1 ? ' piece' : ' pieces');
    $('selectionHeading').textContent = object ? (object.kind === 'dialogue' ? 'Selected dialogue' : 'Selected piece') : 'Brush settings';
    $('deselectBtn').hidden = !object; $('positionControls').hidden = !object; $('dialogueSettings').hidden = !object || object.kind !== 'dialogue';
    if ($('sceneSelectionTools')) $('sceneSelectionTools').hidden = !object && !copiedObject;
    for (const id of ['sceneCopyBtn', 'sceneDuplicateBtn', 'sceneDeleteBtn']) if ($(id)) $(id).disabled = !object;
    if ($('scenePasteBtn')) $('scenePasteBtn').disabled = !copiedObject;
    const sourceAsset = object?.kind === 'sprite' ? assetMap.get(sourceIdFor(object)) || assetMap.get(String(object.assetId)) : null;
    $('selectedDetails').textContent = object ? (object.kind === 'sprite' ? (object.pieceName || sourceAsset?.name || 'Missing sheet') + ' · ' + object.sw + ' × ' + object.sh + ' px' + (sourceAsset?.contributors ? ' · Sheet by ' + sourceAsset.contributors : '') : 'Your words, inside this little world.') : brush ? (brushPiece?.name || activeAsset.name) + ' · ' + brush.sw + ' × ' + brush.sh + ' px brush' : 'Choose a tile from the collection.';
    $('objectScale').value = object ? (object.scale || 1) : paintScale;
    $('flipXBtn').classList.toggle('active', object ? !!object.flipX : flipX); $('flipYBtn').classList.toggle('active', object ? !!object.flipY : flipY);
    $('flipXBtn').disabled = object?.kind === 'dialogue'; $('flipYBtn').disabled = object?.kind === 'dialogue';
    if (object) { $('objectX').value = Math.round(object.x); $('objectY').value = Math.round(object.y); }
    const siblings = s.objects.filter(o => o.layer === object?.layer), index = siblings.indexOf(object);
    for (const id of ['backwardBtn', 'sendBackBtn']) if ($(id)) $(id).disabled = !object || index <= 0;
    for (const id of ['forwardBtn', 'bringFrontBtn']) if ($(id)) $(id).disabled = !object || index === siblings.length - 1;
    if ($('sceneObjects')) {
      const list = $('sceneObjects'), renderKey = s.id + ':' + s.objects.map(o => [o.id, o.layer, o.kind, o.pieceName, o.text].join('|')).join(';');
      if (list._renderKey !== renderKey) {
        list._renderKey = renderKey; list.replaceChildren();
        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = s.objects.length ? 'Select any placed piece…' : 'No pieces placed yet'; list.append(placeholder);
        orderedObjects(s).reverse().forEach(o => { const option = document.createElement('option'); option.value = o.id; option.textContent = (o.kind === 'dialogue' ? 'Dialogue: ' + o.text.replace(/\s+/g, ' ').slice(0, 30) : o.pieceName || assetMap.get(String(o.assetId))?.name || 'Sprite') + ' · ' + o.layer; list.append(option); });
      }
      list.value = selectedId || ''; list.disabled = !s.objects.length;
    }
    if (object?.kind === 'dialogue') {
      if (document.activeElement !== $('dialogueText')) $('dialogueText').value = object.text;
      $('dialogueSize').value = object.fontSize; $('dialogueWidth').value = object.w; $('dialogueHeight').value = object.h;
      $('dialogueBox').checked = object.box !== false; $('dialogueColor').value = object.color || '#fff7d3';
    }
    document.querySelectorAll('[data-layer]').forEach(b => b.classList.toggle('active', b.dataset.layer === (object?.layer || layer)));
    $('deleteSlide').disabled = false;
    if ($('deleteSceneBtn')) $('deleteSceneBtn').disabled = false;
    emit('minish:selection-changed', object || null);
  }
  function refreshAll() { $('projectName').value = project.name; updateInspector(); updateHistory(); scheduleDraw(); }
  function setTool(next, preserveSelection = false) {
    tool = next; if (next !== 'select' && !preserveSelection) selectedId = null;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === next));
    updateInspector(); scheduleDraw();
    status(next === 'paint' ? 'Paint: click or drag to place the selected piece.' : next === 'select' ? 'Select: click a piece to move it. Drag large maps to frame the scene.' : 'Erase: click or drag to remove whole pieces from the active layer.');
  }
  function snapStep() { return Math.max(1, num($('snapSize').value, 16)); }
  function snapCoord(value, round = false, precise = false) { const step = !precise && $('snapEnabled').checked ? snapStep() : 1; return (round ? Math.round(value / step) : Math.floor(value / step)) * step; }
  function scenePoint(event) { const r = mainCanvas.getBoundingClientRect(); return { x: (event.clientX - r.left) / stageZoom, y: (event.clientY - r.top) / stageZoom, precise: !!event.altKey }; }
  function hitObject(point, restrictLayer = false) {
    return orderedObjects(scene()).reverse().find(o => { const b = objectBounds(o); return (!restrictLayer || o.layer === layer) && point.x >= b.x && point.x < b.x + b.w && point.y >= b.y && point.y < b.y + b.h; });
  }
  function stampAt(x, y) {
    if (!brush || !activeAsset || !currentImage) return false;
    x = clamp(Math.round(x), -100000, 100000); y = clamp(Math.round(y), -100000, 100000);
    if (x >= scene().width + editorGutter.x || y >= scene().height + editorGutter.y || x + brush.sw * paintScale <= -editorGutter.x || y + brush.sh * paintScale <= -editorGutter.y) return false;
    const positionKey = x + ':' + y;
    if (canvasDrag.visited.has(positionKey)) return false;
    canvasDrag.visited.add(positionKey);
    if (!canvasDrag.history) { historyBefore(); canvasDrag.history = true; }
    scene().objects.push({ id: uid(), kind: 'sprite', assetId: String(activeAsset.id), ...brush, x, y, scale: paintScale, flipX, flipY, keyColor: keySetting(), layer });
    return true;
  }
  function eraseAt(p) {
    const object = hitObject(p, true); if (!object) return;
    if (!canvasDrag.history) { historyBefore(); canvasDrag.history = true; }
    scene().objects = scene().objects.filter(o => o.id !== object.id); if (selectedId === object.id) selectedId = null;
  }
  function beginCanvasDrag(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return; event.preventDefault(); mainCanvas.focus({ preventScroll: true });
    const p = scenePoint(event); hover = null; (event.currentTarget || mainCanvas).setPointerCapture(event.pointerId);
    canvasDrag = { start: p, history: false, visited: new Set(), last: p };
    if (tool === 'paint') {
      if (!brush) { canvasDrag = null; toast('Choose a sheet and select a tile first.'); return; }
      selectedId = null; stampAt(snapCoord(p.x, false, p.precise), snapCoord(p.y, false, p.precise));
    } else if (tool === 'erase') eraseAt(p);
    else {
      const object = hitObject(p); selectedId = object?.id || null;
      if (object) { layer = object.layer; canvasDrag.object = object; canvasDrag.origin = { x: object.x, y: object.y }; }
    }
    changed();
  }
  function moveCanvasDrag(event) {
    const p = scenePoint(event); hover = p;
    if (!canvasDrag) { scheduleDraw(); return; }
    if (tool === 'paint') {
      const prev = canvasDrag.last, step = !p.precise && $('snapEnabled').checked ? snapStep() : Math.max(1, Math.min(brush.sw, brush.sh) * paintScale);
      const count = Math.min(4096, Math.max(1, Math.ceil(Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y)) / step)));
      for (let i = 1; i <= count; i++) stampAt(snapCoord(prev.x + (p.x - prev.x) * i / count, false, p.precise), snapCoord(prev.y + (p.y - prev.y) * i / count, false, p.precise));
    } else if (tool === 'erase') eraseAt(p);
    else if (canvasDrag.object) {
      const dx = p.x - canvasDrag.start.x, dy = p.y - canvasDrag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > .5) {
        if (!canvasDrag.history) { historyBefore(); canvasDrag.history = true; }
        canvasDrag.object.x = clamp(canvasDrag.origin.x + snapCoord(dx, true, p.precise), -100000, 100000);
        canvasDrag.object.y = clamp(canvasDrag.origin.y + snapCoord(dy, true, p.precise), -100000, 100000);
      }
    }
    canvasDrag.last = p; changed();
  }
  function endCanvasDrag() { if (canvasDrag) { const edited = canvasDrag.history; canvasDrag = null; if (edited) changed('Scene updated.'); else scheduleDraw(); } }
  mainCanvas.addEventListener('pointerup', endCanvasDrag); mainCanvas.addEventListener('pointercancel', endCanvasDrag);
  mainCanvas.addEventListener('pointerleave', () => { hover = null; if (!canvasDrag) scheduleDraw(); });
  mainCanvas.addEventListener('pointerdown', beginCanvasDrag); mainCanvas.addEventListener('pointermove', moveCanvasDrag);
  const viewport = $('stageViewport');
  function zoomCenter() { const rect = viewport.getBoundingClientRect(); return { x: rect.left + viewport.clientWidth / 2, y: rect.top + viewport.clientHeight / 2 }; }
  function zoomAt(value, center = zoomCenter()) {
    const next = clamp(num(value, stageZoom), .05, 12), rect = mainCanvas.getBoundingClientRect();
    if (Math.abs(next - stageZoom) < .0001) return stageZoom;
    const displayedZoom = rect.width > 0 && mainCanvas.width > 0 ? rect.width / mainCanvas.width : renderedStageZoom;
    zoomAnchor = { x: (center.x - rect.left) / displayedZoom, y: (center.y - rect.top) / displayedZoom, clientX: center.x, clientY: center.y };
    fitMode = false; stageZoom = next; hover = null; scheduleDraw(); return next;
  }
  function zoomStep(direction) {
    clearTimeout(zoomSettleTimer); gestureZoom = null;
    const steps = [.05, .125, .25, .5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return zoomAt(direction > 0 ? steps.find(value => value > stageZoom + .001) || 12 : steps.slice().reverse().find(value => value < stageZoom - .001) || .05);
  }
  function fitCanvas() { clearTimeout(zoomSettleTimer); zoomAnchor = null; gestureZoom = null; fitMode = true; scheduleDraw(); }
  function settleZoom(center) {
    clearTimeout(zoomSettleTimer);
    zoomSettleTimer = setTimeout(() => {
      const value = stageZoom >= 1 ? Math.max(1, Math.round(stageZoom)) : [.05, .125, .25, .5, 1].reduce((best, candidate) => Math.abs(candidate - stageZoom) < Math.abs(best - stageZoom) ? candidate : best, 1);
      zoomAt(value, center); zoomSettleTimer = null;
    }, 140);
  }
  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey || document.body.classList.contains('animation-mode') || document.querySelector('dialog[open]')) return;
    event.preventDefault(); if (canvasDrag || gestureZoom) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const center = { x: event.clientX, y: event.clientY }, delta = clamp(num(event.deltaY) * unit, -160, 160);
    zoomAt(stageZoom * Math.exp(-delta * .004), center); settleZoom(center);
  }, { passive: false });
  // Safari exposes trackpad pinch as GestureEvents rather than Ctrl+wheel.
  viewport.addEventListener('gesturestart', event => {
    if (document.body.classList.contains('animation-mode') || document.querySelector('dialog[open]') || canvasDrag) return;
    event.preventDefault(); clearTimeout(zoomSettleTimer); gestureZoom = { start: stageZoom, center: Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? { x: event.clientX, y: event.clientY } : zoomCenter() };
  }, { passive: false });
  viewport.addEventListener('gesturechange', event => {
    if (!gestureZoom) return; event.preventDefault();
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) gestureZoom.center = { x: event.clientX, y: event.clientY };
    zoomAt(gestureZoom.start * Math.max(.01, num(event.scale, 1)), gestureZoom.center);
  }, { passive: false });
  viewport.addEventListener('gestureend', event => { if (!gestureZoom) return; event.preventDefault(); const center = gestureZoom.center; gestureZoom = null; settleZoom(center); }, { passive: false });
  for (const [type, handler] of [['pointerdown', beginCanvasDrag], ['pointermove', moveCanvasDrag], ['pointerup', endCanvasDrag], ['pointercancel', endCanvasDrag]]) {
    viewport.addEventListener(type, event => { if (event.target !== mainCanvas) handler(event); });
  }
  viewport.addEventListener('pointerleave', () => { hover = null; if (!canvasDrag) scheduleDraw(); });
  viewport.addEventListener('dragover', event => {
    if (!libraryDrag) return;
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    libraryDrag.position = piecePosition(libraryDrag.piece, scenePoint(event), { scale: libraryDrag.scale, precise: event.altKey });
    scheduleDraw();
  });
  viewport.addEventListener('dragleave', event => {
    if (event.relatedTarget && viewport.contains?.(event.relatedTarget)) return;
    if (libraryDrag) { libraryDrag.position = null; scheduleDraw(); }
  });
  viewport.addEventListener('drop', async event => {
    if (!libraryDrag) return;
    event.preventDefault(); const drag = libraryDrag, point = scenePoint(event); endPieceDrag();
    try {
      if (scene().id !== drag.sceneId) throw new Error('The scene changed. Drag the piece again.');
      await placePieceAt(drag.piece, point, { ...drag, precise: event.altKey });
    } catch (error) { toast(error.message); }
  });
  function updateSelected(patch, message = 'Piece updated.') {
    const object = selected(); if (!object) return null;
    const safe = { ...patch };
    for (const key of ['x', 'y']) if (key in safe) {
      if (!Number.isFinite(Number(safe[key])) || String(safe[key]).trim() === '') throw new Error('Use a number for the piece position.');
      safe[key] = clamp(Math.round(Number(safe[key])), -100000, 100000);
    }
    if ('scale' in safe) safe.scale = clamp(Math.round(num(safe.scale, 1)), 1, 8);
    if ('layer' in safe && !LAYERS.includes(safe.layer)) throw new Error('Choose Terrain, Objects or Overlay.');
    for (const key of ['flipX', 'flipY']) if (key in safe) safe[key] = !!safe[key];
    historyBefore(); Object.assign(object, safe); if (safe.layer) layer = safe.layer; changed(message); return copy(object);
  }
  function deleteSelected() { const object = selected(); if (!object) return false; historyBefore(); scene().objects = scene().objects.filter(o => o.id !== object.id); selectedId = null; changed('Piece deleted. Undo brings it back.'); return true; }
  function duplicateObject() { const object = selected(); if (!object) return null; historyBefore(); const duplicate = { ...copy(object), id: uid(), x: clamp(object.x + snapStep(), -100000, 100000), y: clamp(object.y + snapStep(), -100000, 100000) }; scene().objects.push(duplicate); selectedId = duplicate.id; changed('Piece duplicated.'); return copy(duplicate); }
  function copySelected(cut = false) {
    const object = selected(); if (!object) return false;
    copiedObject = copy(object); pasteCount = 0; copiedByCut = cut;
    if (cut) deleteSelected();
    updateInspector(); status(cut ? 'Piece cut. Paste it into any scene. Undo restores the original.' : 'Piece copied. Paste it into any scene.'); return true;
  }
  function pasteSelected() {
    if (!copiedObject) { status('Copy a piece first, then paste it into a scene.'); return null; }
    if (scene().objects.length >= 30000) { toast('This scene already has 30,000 pieces. Delete a piece or use another scene.'); return null; }
    const offset = (pasteCount++ + (copiedByCut ? 0 : 1)) * snapStep();
    const object = { ...copy(copiedObject), id: uid(), x: clamp(copiedObject.x + offset, -100000, 100000), y: clamp(copiedObject.y + offset, -100000, 100000) };
    historyBefore(); scene().objects.push(object); selectedId = object.id; layer = object.layer; setTool('select'); changed('Piece pasted. Drag it into place.'); return copy(object);
  }
  function addDialogue() {
    historyBefore(); const s = scene();
    const object = { id: uid(), kind: 'dialogue', x: Math.min(12, Math.max(0, s.width - 20)), y: Math.max(8, s.height - 74), w: Math.max(20, s.width - 24), h: 58, text: "A little adventure,\na story of your own.", fontSize: 12, color: '#fff7d3', box: true, layer: 'overlay', scale: 1 };
    s.objects.push(object); layer = 'overlay'; selectedId = object.id; setTool('select'); changed('Dialogue added. Edit your words on the right.'); $('dialogueText').focus(); $('dialogueText').select();
  }
  function switchSlide(id) { if (project.activeSlide === id) return; project.activeSlide = id; selectedId = null; hover = null; fitMode = true; refreshAll(); scheduleSave(); }
  function addSlide(duplicate = false) {
    historyBefore(); const s = duplicate ? { ...copy(scene()), id: uid(), name: scene().name + ' copy' } : newSlide(project.slides.length + 1, scene().preset || 'portrait', scene());
    if (duplicate) s.objects.forEach(o => { o.id = uid(); });
    const index = project.slides.findIndex(s => s.id === project.activeSlide); project.slides.splice(index + 1, 0, s); project.activeSlide = s.id; selectedId = null; fitMode = true;
    changed(duplicate ? 'Scene duplicated.' : 'A fresh scene, ready for the next part of your story.');
  }
  function deleteSlide() {
    const index = project.slides.findIndex(slide => slide.id === project.activeSlide), current = scene();
    historyBefore();
    if (project.slides.length > 1) { project.slides.splice(index, 1); project.activeSlide = project.slides[Math.min(index, project.slides.length - 1)].id; }
    else { const blank = newSlide(1, current.preset || 'custom', current); project.slides = [blank]; project.activeSlide = blank.id; }
    selectedId = null; hover = null; canvasDrag = null; zoomAnchor = null; fitMode = true;
    changed('Scene deleted. Undo restores the complete scene.'); return true;
  }
  async function insertScene(value) {
    if (project.slides.length >= 100) throw new Error('This project already has 100 scenes. Save it and start another project to add more.');
    const candidate = copy(value);
    candidate.id = uid();
    candidate.objects = (candidate.objects || []).map(object => ({ ...object, id: uid() }));
    const checked = validateProject({ format: 'minish-cap-studio', version: 4, name: project.name, activeSlide: candidate.id, slides: [candidate] }).slides[0];
    const required = [...new Set(checked.objects.filter(object => object.kind === 'sprite').map(object => object.assetId))];
    if (required.some(id => !assetMap.has(id))) throw new Error('A required scene asset is missing. Reopen the complete app folder and try again.');
    await Promise.all(required.map(imageFor));
    if (project.slides.length >= 100) throw new Error('This project already has 100 scenes.');
    historyBefore();
    const index = project.slides.findIndex(slide => slide.id === project.activeSlide);
    project.slides.splice(index + 1, 0, checked); project.activeSlide = checked.id;
    selectedId = null; hover = null; fitMode = true; refreshAll(); scheduleSave();
    status('A new scene is ready. Every piece is editable. Undo removes the new scene.');
    return copy(checked);
  }
  async function rerollScene(value) {
    const target = scene();
    if (!target.generated) return insertScene(value);
    const before = JSON.stringify(target), candidate = copy(value);
    candidate.id = target.id;
    candidate.objects = (candidate.objects || []).map(object => ({ ...object, id: uid() }));
    const checked = validateProject({ format: 'minish-cap-studio', version: 4, name: project.name, activeSlide: candidate.id, slides: [candidate] }).slides[0];
    if (!checked.generated) throw new Error('Choose a generated adventure to use Surprise me again.');
    const required = [...new Set(checked.objects.filter(object => object.kind === 'sprite').map(object => object.assetId))];
    if (required.some(id => !assetMap.has(id))) throw new Error('A required scene asset is missing. Reopen the complete app folder and try again.');
    await Promise.all(required.map(imageFor));
    if (scene() !== target || JSON.stringify(target) !== before) throw new Error('The scene changed while the adventure was opening. Click Surprise me again to retry.');
    historyBefore();
    project.slides[project.slides.indexOf(target)] = checked;
    selectedId = null; hover = null; fitMode = true; refreshAll(); scheduleSave();
    status('A fresh surprise is ready. Undo brings back the previous scene.');
    return copy(checked);
  }
  function canEditBossParts() {
    const object = selected(), asset = object?.kind === 'sprite' && assetMap.get(String(object.assetId));
    return !!(asset && !asset.legacy && Array.isArray(asset.sourceParts) && asset.sourceParts.length > 1 && asset.compositionCrop);
  }
  function hasLegacyBossSelection() { return !!(selected()?.kind === 'sprite' && assetMap.get(String(selected().assetId))?.legacy); }
  async function upgradeSelectedBoss() {
    if (!hasLegacyBossSelection()) throw new Error('Select an older boss assembly to update it.');
    const object = selected(), old = assetMap.get(String(object.assetId));
    const sheet = bossesCatalog.sheets[object.sourceId] || bossesCatalog.sheets['full-boss-' + (old.originalSourceId || old.sourceId)];
    const candidate = sheet?.pieces?.find(piece => piece.id === sheet.coverPieceId) || sheet?.pieces?.[0];
    if (!candidate) throw new Error('No corrected pose is available for this older boss.');
    const piece = normalizePiece(candidate); await imageFor(piece.assetId);
    if (selected() !== object) throw new Error('Select the older boss again to update it.');
    const scale = object.scale || 1, centerX = object.x + object.sw * scale / 2, feetY = object.y + object.sh * scale;
    historyBefore();
    Object.assign(object, { assetId: piece.assetId, sourceId: piece.sourceId, pieceId: piece.id, pieceName: piece.name,
      sx: piece.sx, sy: piece.sy, sw: piece.sw, sh: piece.sh, x: centerX - piece.sw * scale / 2, y: feetY - piece.sh * scale, keyColor: piece.keyColor || null });
    changed('Older boss updated. Position and scale kept. Undo restores the previous assembly.');
    return copy(object);
  }
  async function explodeSelectedBoss() {
    if (!canEditBossParts()) throw new Error('Select a complete multipart boss to edit its individual parts.');
    const object = selected(), asset = assetMap.get(String(object.assetId)), crop = asset.compositionCrop;
    const padding = Number(crop.padding || 0), scale = object.scale || 1, group = uid();
    const parts = asset.sourceParts.map((part, index) => {
      const sourceAsset = assetMap.get(String(part.sourceAssetId)), rect = part.sourceRect;
      if (!sourceAsset || !rect || ![rect.x, rect.y, rect.w, rect.h, part.at?.x, part.at?.y].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.w < 1 || rect.h < 1 || rect.x + rect.w > sourceAsset.width || rect.y + rect.h > sourceAsset.height) throw new Error('This boss has an invalid part mapping.');
      let x = part.at.x - crop.x + padding, y = part.at.y - crop.y + padding;
      if (object.flipX) x = object.sw - x - rect.w;
      if (object.flipY) y = object.sh - y - rect.h;
      return { id: uid(), kind: 'sprite', assetId: String(sourceAsset.id), sourceId: String(part.originalSourceId || part.sourceId || asset.originalSourceId),
        sx: rect.x, sy: rect.y, sw: rect.w, sh: rect.h,
        x: object.x + x * scale, y: object.y + y * scale, scale,
        flipX: !!part.flipX !== !!object.flipX, flipY: !!part.flipY !== !!object.flipY,
        keyColor: null, layer: object.layer, pieceName: part.label || 'Boss part ' + (index + 1), bossGroup: group, sourceComposite: asset.id };
    });
    await Promise.all([...new Set(parts.map(part => part.assetId))].map(imageFor));
    if (selected() !== object) throw new Error('The selection changed. Select the boss again to edit its parts.');
    historyBefore(); const index = scene().objects.indexOf(object);
    scene().objects.splice(index, 1, ...parts); selectedId = parts[0].id; setTool('select');
    changed('Boss parts are editable. Move or replace a part, or Undo to restore the assembled boss.');
    return copy(parts);
  }
  async function useBackground() {
    if (!activeAsset) { toast('Choose a map or background sheet first.'); return; }
    try {
      const asset = activeAsset, img = await imageFor(asset.id); historyBefore();
      const object = { id: uid(), kind: 'sprite', assetId: String(asset.id), sx: 0, sy: 0, sw: img.width, sh: img.height, x: 0, y: 0, scale: 1, flipX: false, flipY: false, keyColor: keySetting(), layer: 'terrain', background: true };
      scene().objects.unshift(object); selectedId = object.id; layer = 'terrain'; setTool('select'); changed();
      toast('Full sheet placed at its original size. Drag it to frame the area you want.');
    } catch (error) { toast(error.message); }
  }

  async function exportSlide(slide) {
    canvasFormat(slide);
    const ids = [...new Set(slide.objects.filter(o => o.assetId).map(renderedAssetId))]; await Promise.all(ids.map(imageFor));
    if (slide.objects.some(o => o.kind === 'dialogue')) await prepareGameUI();
    const canvas = document.createElement('canvas'); canvas.width = slide.width * slide.exportScale; canvas.height = slide.height * slide.exportScale;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.scale(slide.exportScale, slide.exportScale);
    // Render artwork without editor grid, selection handles or cursor previews.
    ctx.clearRect(0, 0, slide.width, slide.height);
    if (!slide.transparent) { ctx.fillStyle = slide.color; ctx.fillRect(0, 0, slide.width, slide.height); }
    for (const object of orderedObjects(slide)) drawObject(ctx, object);
    return await new Promise((resolve, reject) => {
      try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not make the PNG.')), 'image/png'); }
      catch (_) { reject(new Error('The browser blocked local image export. Open the supplied studio launcher, then export again.')); }
    });
  }
  async function prepareScene(value) {
    if (!value || !Array.isArray(value.objects)) throw new Error('Choose a valid scene to render.');
    canvasFormat({ ...value, exportScale: 1 });
    const candidate = { ...copy(value), id: String(value.id || 'animation-frame'), exportScale: value.exportScale || 1 };
    const prepared = validateProject({ format: 'minish-cap-studio', name: 'Animation frame', activeSlide: candidate.id, slides: [candidate] }).slides[0];
    const ids = [...new Set(prepared.objects.filter(object => object.kind === 'sprite').map(renderedAssetId))];
    if (ids.some(id => !assetMap.has(String(id)))) throw new Error('A required animation image is missing from this app folder.');
    await Promise.all(ids.map(imageFor));
    if (prepared.objects.some(object => object.kind === 'dialogue')) await prepareGameUI();
    return prepared;
  }
  async function renderSceneToCanvas(value, options = {}) {
    const scale = options.scale == null ? 1 : Number(options.scale);
    canvasFormat({ ...value, exportScale: scale });
    const prepared = await prepareScene(value), canvas = document.createElement('canvas');
    canvas.width = prepared.width * scale; canvas.height = prepared.height * scale;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.scale(scale, scale);
    drawScene(ctx, prepared, { quiet: true });
    return canvas;
  }
  // A small uncompressed ZIP writer keeps carousel exports offline and dependency free.
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(files) {
    const encoder = new TextEncoder(), parts = [], directory = []; let offset = 0, directorySize = 0;
    const now = new Date(), dosTime = now.getHours() << 11 | now.getMinutes() << 5 | Math.floor(now.getSeconds() / 2), dosDate = (now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate();
    files.forEach(file => {
      const name = encoder.encode(file.name), data = file.data, crc = crc32(data), header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint16(10, dosTime, true); view.setUint16(12, dosDate, true); view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); header.set(name, 30); parts.push(header, data);
      const entry = new Uint8Array(46 + name.length), d = new DataView(entry.buffer);
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(12, dosTime, true); d.setUint16(14, dosDate, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); entry.set(name, 46); directory.push(entry); directorySize += entry.length; offset += header.length + data.length;
    });
    const end = new Uint8Array(22), view = new DataView(end.buffer); view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], { type: 'application/zip' });
  }
  async function doExport(all = false) {
    const button = all ? $('exportAllBtn') : $('exportBtn'), old = button.textContent; button.disabled = true; button.textContent = 'Preparing…'; hover = null;
    try {
      if (all) {
        const files = [];
        for (let i = 0; i < project.slides.length; i++) { const s = project.slides[i]; status('Rendering scene ' + (i + 1) + ' of ' + project.slides.length + '…'); const blob = await exportSlide(s); files.push({ name: String(i + 1).padStart(2, '0') + '-' + cleanFilename(s.name) + '.png', data: new Uint8Array(await blob.arrayBuffer()) }); }
        files.push({ name: cleanFilename(project.name) + '.minish.json', data: new TextEncoder().encode(JSON.stringify(project, null, 2)) });
        download(makeZip(files), cleanFilename(project.name) + '-carousel.zip'); toast('Carousel exported: ' + project.slides.length + ' PNGs and your editable project.');
      } else {
        const s = scene(), blob = await exportSlide(s); download(blob, cleanFilename(project.name) + '-' + cleanFilename(s.name) + '.png'); toast('PNG exported at ' + s.width * s.exportScale + ' × ' + s.height * s.exportScale + ' pixels.');
      }
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; if (all) button.textContent = old; else button.innerHTML = 'Export PNG <span>↗</span>'; }
  }

  $('searchAssets').addEventListener('input', renderLibrary); $('sectionFilter').addEventListener('change', renderLibrary);
  $('brushSizes').addEventListener('click', event => {
    const b = event.target.closest('[data-size]'); if (!b) return; brushSize = b.dataset.size === 'free' ? 'free' : Number(b.dataset.size);
    document.querySelectorAll('[data-size]').forEach(el => el.classList.toggle('active', el === b));
    if (currentImage && brush && brushSize !== 'free') selectSheetRect({ x: brush.sx, y: brush.sy }, { x: brush.sx, y: brush.sy });
    else drawSheet(); updateBrush();
  });
  $('sheetZoom').addEventListener('input', () => { sheetZoom = num($('sheetZoom').value) / 100; drawSheet(); });
  $('sheetGrid').addEventListener('change', drawSheet); $('offsetX').addEventListener('change', drawSheet); $('offsetY').addEventListener('change', drawSheet);
  $('sheetExpand').addEventListener('click', () => { const open = ($('cropDialog') || document.querySelector('.library')).classList.toggle('crop-expanded'); $('sheetExpand').textContent = open ? '⤡' : '⤢'; $('sheetExpand').title = open ? 'Close expanded sheet picker' : 'Expand sheet picker'; });
  $('keyEnabled').addEventListener('change', updateBrush); $('keyColor').addEventListener('input', updateBrush);
  $('sampleColor').addEventListener('click', () => { if (!currentImage) { toast('Choose a sheet first.'); return; } sampleMode = !sampleMode; sheetCanvas.style.cursor = sampleMode ? 'copy' : 'crosshair'; $('sampleColor').textContent = sampleMode ? 'Click a sheet pixel…' : 'Pick from sheet'; status(sampleMode ? 'Click the background color on the source sheet.' : 'Color picker cancelled.'); });
  $('cornerColor').addEventListener('click', () => { if (brush) samplePixel(brush.sx, brush.sy); else toast('Select a crop first.'); });
  $('backgroundBtn').addEventListener('click', useBackground);
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  document.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => { layer = b.dataset.layer; const object = selected(); if (object && object.layer !== layer) updateSelected({ layer }, 'Piece moved to the ' + layer + ' layer.'); else updateInspector(); }));
  $('sceneGrid').addEventListener('change', scheduleDraw); $('snapSize').addEventListener('change', scheduleDraw);
  $('snapEnabled').addEventListener('change', scheduleDraw);
  $('precisionBtn').addEventListener('click', () => {
    const precise = !$('snapEnabled').checked || snapStep() === 1;
    $('snapEnabled').checked = precise;
    if (precise && snapStep() === 1) $('snapSize').value = '16';
    scheduleDraw(); status(precise ? 'Grid snapping on. Hold ' + window.MINISH_CONTROLS.precisionLabel + ' for one-pixel placement.' : 'One-pixel precision on. Drag freely or use the arrow keys.');
  });
  for (const [id, dx, dy] of [['nudgeLeft', -1, 0], ['nudgeRight', 1, 0], ['nudgeUp', 0, -1], ['nudgeDown', 0, 1]]) {
    $(id).addEventListener('click', event => {
      const object = selected(); if (!object) return;
      const step = event.shiftKey ? snapStep() : 1;
      updateSelected({ x: object.x + dx * step, y: object.y + dy * step }, 'Piece moved ' + step + ' px.');
    });
  }
  $('undoBtn').addEventListener('click', undo); $('redoBtn').addEventListener('click', redo);
  $('textBtn').addEventListener('click', addDialogue); $('deleteObjectBtn').addEventListener('click', deleteSelected); $('duplicateObjectBtn').addEventListener('click', duplicateObject);
  for (const [id, action] of [['sceneCopyBtn', () => copySelected()], ['scenePasteBtn', pasteSelected], ['sceneDuplicateBtn', duplicateObject], ['sceneDeleteBtn', deleteSelected]]) if ($(id)) $(id).addEventListener('click', action);
  $('deselectBtn').addEventListener('click', () => { selectedId = null; updateInspector(); scheduleDraw(); });
  $('objectScale').addEventListener('change', () => { const scale = clamp(Math.round(num($('objectScale').value, 1)), 1, 8); if (selected()) updateSelected({ scale }); else { paintScale = scale; updateInspector(); scheduleDraw(); } });
  $('flipXBtn').addEventListener('click', () => { if (selected()) updateSelected({ flipX: !selected().flipX }); else { flipX = !flipX; updateInspector(); scheduleDraw(); } });
  $('flipYBtn').addEventListener('click', () => { if (selected()) updateSelected({ flipY: !selected().flipY }); else { flipY = !flipY; updateInspector(); scheduleDraw(); } });
  function bindSelectedNumber(id, patch) {
    let editingId = null;
    $(id).addEventListener('focus', () => { editingId = null; });
    $(id).addEventListener('input', () => {
      const object = selected(); if (!object || $(id).value.trim() === '' || !Number.isFinite(Number($(id).value))) return;
      if (editingId !== object.id) { historyBefore(); editingId = object.id; }
      Object.assign(object, patch()); scheduleDraw(); updateHistory(); scheduleSave();
    });
    $(id).addEventListener('change', () => {
      const object = selected(); if (!object) return;
      if ($(id).value.trim() === '' || !Number.isFinite(Number($(id).value))) { editingId = null; updateInspector(); return; }
      if (editingId !== object.id) historyBefore();
      Object.assign(object, patch()); editingId = null; changed();
    });
  }
  bindSelectedNumber('objectX', () => ({ x: clamp(Math.round(num($('objectX').value)), -100000, 100000) }));
  bindSelectedNumber('objectY', () => ({ y: clamp(Math.round(num($('objectY').value)), -100000, 100000) }));
  function reorderSelected(direction, toEdge = false) {
    const object = selected(); if (!object) return; const array = scene().objects, index = array.indexOf(object);
    let other = index + direction; while (other >= 0 && other < array.length && array[other].layer !== object.layer) other += direction;
    if (other < 0 || other >= array.length) return false;
    if (toEdge) {
      const siblingIndices = array.flatMap((o, i) => o.layer === object.layer ? [i] : []);
      other = direction < 0 ? siblingIndices[0] : siblingIndices[siblingIndices.length - 1];
    }
    historyBefore(); array.splice(index, 1); array.splice(other, 0, object); changed(direction < 0 ? 'Piece moved back within its layer.' : 'Piece moved forward within its layer.'); return true;
  }
  $('backwardBtn').addEventListener('click', () => reorderSelected(-1)); $('forwardBtn').addEventListener('click', () => reorderSelected(1));
  if ($('sendBackBtn')) $('sendBackBtn').addEventListener('click', () => reorderSelected(-1, true));
  if ($('bringFrontBtn')) $('bringFrontBtn').addEventListener('click', () => reorderSelected(1, true));
  if ($('sceneObjects')) $('sceneObjects').addEventListener('change', () => {
    selectedId = scene().objects.find(o => o.id === $('sceneObjects').value)?.id || null;
    if (selected()) layer = selected().layer; setTool('select'); updateInspector(); scheduleDraw();
  });
  // Keep the canvas responsive while typing and group the whole edit into one undo step.
  let textEditHistory = false;
  $('dialogueText').addEventListener('focus', () => { textEditHistory = false; });
  $('dialogueText').addEventListener('input', () => { const object = selected(); if (!object || object.kind !== 'dialogue') return; if (!textEditHistory) { historyBefore(); textEditHistory = true; } object.text = $('dialogueText').value; scheduleDraw(); updateHistory(); scheduleSave(); });
  $('dialogueText').addEventListener('change', () => { textEditHistory = false; });
  bindSelectedNumber('dialogueSize', () => ({ fontSize: clamp(Math.round(num($('dialogueSize').value, 9)), 4, 48) }));
  bindSelectedNumber('dialogueWidth', () => ({ w: clamp(Math.round(num($('dialogueWidth').value, 192)), 20, 2000) }));
  bindSelectedNumber('dialogueHeight', () => ({ h: clamp(Math.round(num($('dialogueHeight').value, 58)), 12, 2000) }));
  $('dialogueBox').addEventListener('change', () => updateSelected({ box: $('dialogueBox').checked })); $('dialogueColor').addEventListener('change', () => updateSelected({ color: $('dialogueColor').value }));
  function bindNameField(id, apply, fallback) {
    let editing = false;
    $(id).addEventListener('focus', () => { editing = false; });
    $(id).addEventListener('input', () => {
      if (!editing) { historyBefore(); editing = true; }
      apply($(id).value || fallback); scheduleDraw(); updateHistory(); scheduleSave();
    });
    $(id).addEventListener('change', () => {
      if (!editing) historyBefore();
      apply($(id).value.trim() || fallback); editing = false; changed();
    });
  }
  bindNameField('slideName', value => { scene().name = value; $('sceneHeading').textContent = value; }, 'Untitled scene');
  bindNameField('projectName', value => { project.name = value; }, 'My little adventure');
  $('aspectPreset').addEventListener('change', () => {
    const preset = $('aspectPreset').value;
    if (preset === 'custom') { if ($('customSizeFields')) $('customSizeFields').hidden = false; return; }
    if (!PRESETS[preset]) { updateInspector(); return; }
    historyBefore(); Object.assign(scene(), PRESETS[preset], { preset }); fitMode = true; changed('Canvas format updated. Existing pieces keep their positions.');
  });
  if ($('applyCustomSize')) $('applyCustomSize').addEventListener('click', () => {
    try { setCanvasFormat({ width: $('customWidth').value, height: $('customHeight').value, exportScale: $('customExportScale').value }); }
    catch (error) { toast(error.message); }
  });
  $('sceneColor').addEventListener('change', () => { historyBefore(); scene().color = $('sceneColor').value; scene().transparent = false; changed(); });
  $('transparentScene').addEventListener('change', () => { historyBefore(); scene().transparent = $('transparentScene').checked; changed(); });
  $('addSlide').addEventListener('click', () => addSlide()); $('duplicateSlide').addEventListener('click', () => addSlide(true));
  $('deleteSlide').addEventListener('click', deleteSlide);
  if ($('deleteSceneBtn')) $('deleteSceneBtn').addEventListener('click', deleteSlide);
  $('zoomIn').addEventListener('click', () => zoomStep(1));
  $('zoomOut').addEventListener('click', () => zoomStep(-1)); $('fitBtn').addEventListener('click', fitCanvas);
  if (window.ResizeObserver) new ResizeObserver(() => { if (fitMode) scheduleDraw(); }).observe($('stageViewport'));
  $('exportBtn').addEventListener('click', () => doExport()); $('exportAllBtn').addEventListener('click', () => doExport(true)); $('saveBtn').addEventListener('click', saveProject);
  $('starterBtn').disabled = !window.MINISH_STARTER;
  $('starterBtn').addEventListener('click', () => {
    if (!window.MINISH_STARTER) return;
    try {
      const starter = validateProject(copy(window.MINISH_STARTER)); historyBefore(); project = starter;
      selectedId = null; hover = null; fitMode = true; refreshAll(); scheduleSave();
      toast('Starter scenes loaded. Every piece is editable. Undo restores your previous project.');
    } catch (error) { toast(error.message); }
  });
  $('openBtn').addEventListener('click', () => $('openFile').click());
  $('openFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 30000000) throw new Error('This project is too large to open.');
      const loaded = validateProject(JSON.parse(await file.text())); historyBefore(); project = loaded; selectedId = null; fitMode = true; refreshAll(); scheduleSave();
      const missing = [...new Set(project.slides.flatMap(s => s.objects.filter(o => o.assetId && !assetMap.has(String(o.assetId))).map(o => o.assetId)))];
      toast(missing.length ? 'Project opened. ' + missing.length + ' source sheets are missing from this collection.' : 'Project opened. Your little world is ready.');
    } catch (error) { toast(error.message || 'This project file could not be opened.'); }
    event.target.value = '';
  });
  $('helpBtn').addEventListener('click', () => $('helpDialog').showModal()); $('closeHelp').addEventListener('click', () => $('helpDialog').close());
  $('helpDialog').addEventListener('click', event => { if (event.target === $('helpDialog')) { const r = $('helpDialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('helpDialog').close(); } });
  document.addEventListener('keydown', event => {
    if (document.body.classList.contains('animation-mode')) return;
    if (document.querySelector('dialog[open]')) return;
    const action = window.MINISH_CONTROLS.actionFor(event);
    if (!action) {
      if (event.repeat && ['save', 'open', 'duplicate', 'copy', 'cut', 'paste', 'deleteCanvas', 'dialogue', 'help'].includes(window.MINISH_CONTROLS.actionFor(event, true))) event.preventDefault();
      return;
    }
    // Esc also reaches the library to close its menus and drawers.
    if (action !== 'deselect') event.preventDefault();
    if (action === 'save') saveProject();
    else if (action === 'open') $('openBtn').click();
    else if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'duplicate') duplicateObject();
    else if (action === 'copy') copySelected();
    else if (action === 'cut') copySelected(true);
    else if (action === 'paste') pasteSelected();
    else if (action === 'delete') deleteSelected();
    else if (action === 'deleteCanvas') deleteSlide();
    else if (action === 'backward') reorderSelected(-1);
    else if (action === 'forward') reorderSelected(1);
    else if (action === 'sendBack') reorderSelected(-1, true);
    else if (action === 'bringFront') reorderSelected(1, true);
    else if (action === 'zoomIn') zoomStep(1);
    else if (action === 'zoomOut') zoomStep(-1);
    else if (action === 'actualSize') zoomAt(1);
    else if (action === 'fit') fitCanvas();
    else if (action === 'deselect') {
      selectedId = null; sampleMode = false; sheetCanvas.style.cursor = 'crosshair'; $('sampleColor').textContent = 'Pick from sheet';
      ($('cropDialog') || document.querySelector('.library')).classList.remove('crop-expanded'); $('sheetExpand').textContent = '⤢'; $('sheetExpand').title = 'Expand sheet picker';
      updateInspector(); scheduleDraw();
    } else if (action === 'help') $('helpDialog').showModal();
    else if (action.startsWith('nudge')) {
      const o = selected(); if (!o) return;
      const amount = event.shiftKey ? snapStep() : 1;
      updateSelected({ x: o.x + (action === 'nudgeLeft' ? -amount : action === 'nudgeRight' ? amount : 0), y: o.y + (action === 'nudgeUp' ? -amount : action === 'nudgeDown' ? amount : 0) });
    } else if (action === 'dialogue') addDialogue();
    else if (['paint', 'select', 'erase'].includes(action)) setTool(action);
  });
  window.addEventListener('beforeunload', () => { try { if (JSON.stringify(project).length < 3800000) localStorage.setItem(STORAGE, JSON.stringify(project)); } catch (_) {} });

  $('assetCount').textContent = sourceAssets.length + ' source sheets';
  [...new Set(sourceAssets.map(a => a.section || 'Collection'))].sort().forEach(section => { const option = document.createElement('option'); option.value = section; option.textContent = section; $('sectionFilter').append(option); });
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_STORAGE) || '[]');
    if (Array.isArray(saved)) customPieces = saved.slice(0, 2000).flatMap(p => { try { return [normalizePiece(p)]; } catch (_) { return []; } });
  } catch (_) {}
  let restoredProject = false;
  try { const saved = localStorage.getItem(STORAGE); if (saved) { project = validateProject(JSON.parse(saved)); restoredProject = true; } } catch (_) { $('saveState').textContent = 'Save project to keep your work'; }
  if (!restoredProject && window.MINISH_STARTER) {
    try { project = validateProject(copy(window.MINISH_STARTER)); } catch (_) {}
  }
  prepareGameUI(); renderLibrary(); refreshAll();
  // A small public interface makes projects scriptable and allows repeatable QA.
  window.MINISH_STUDIO = {
    get project() { return copy(project); }, get assets() { return assets; }, get sourceAssets() { return sourceAssets; }, get brush() { return brush && copy(brush); },
    get selection() { return selectedId; }, get activeAsset() { return activeAsset; },
    getScene: () => copy(scene()), getAsset: id => { const asset = assetMap.get(String(id)); return asset ? { ...asset } : null; },
    prepareScene, renderSceneToCanvas, drawSceneToContext: (ctx, slide) => drawScene(ctx, slide, { quiet: true }),
    get selectedObject() { const object = selected(); return object ? copy(object) : null; },
    get customPieces() { return copy(customPieces); },
    chooseAsset: id => { const a = assetMap.get(String(id)); return a ? chooseAsset(a) : Promise.reject(new Error('Unknown sheet')); },
    choosePiece, placePiece, placePieceAt, piecePosition, beginPieceDrag, endPieceDrag, replaceSelectedPose, canSwapSelected, getBrushPiece, getPieceSource, saveCustomPiece, removeCustomPiece,
    exportPiecePNG, downloadSelectedPiecePNG, setCanvasFormat, canvasLimits: CANVAS_LIMITS,
    insertScene, rerollScene, canEditBossParts, explodeSelectedBoss, hasLegacyBossSelection, upgradeSelectedBoss,
    getPiece: id => { const piece = pieceMap.get(String(id)); return piece ? copy(normalizePiece(piece)) : null; },
    setTool, addDialogue, addSlide, switchSlide, deleteSlide, undo, redo, saveProject, exportSlide, makeZip,
    copySelected, cutSelected: () => copySelected(true), pasteSelected, zoomAt, zoomStep, fitCanvas,
    get view() { return { zoom: stageZoom, fit: fitMode }; },
    updateSelected, duplicateSelected: duplicateObject, deleteSelected, reorderSelected,
    bringToFront: () => reorderSelected(1, true), sendToBack: () => reorderSelected(-1, true),
    loadProject: data => { const loaded = validateProject(copy(data)); historyBefore(); project = loaded; selectedId = null; fitMode = true; refreshAll(); scheduleSave(); },
    select: id => { selectedId = scene().objects.find(o => o.id === id)?.id || null; if (selected()) layer = selected().layer; setTool('select'); updateInspector(); scheduleDraw(); },
    useBackground, render: () => { renderStage(); renderSlides(); }, version: '1.0'
  };
})();
