(() => {
  'use strict';
  const LIMITS = Object.freeze({ maxFrames: 600, maxFramePixels: 16777216, maxGIFFramePixels: 4194304,
    maxGIFPixels: 80000000, maxRenderedPixels: 400000000, maxBytes: 268435456, maxSheetPixels: 16777216, maxEdge: 8192 });
  const textEncoder = new TextEncoder();
  const integer = (value, fallback) => value == null ? fallback : Number(value);
  function abortError() { const error = new Error('Animation export cancelled.'); error.name = 'AbortError'; return error; }
  function checkCancelled(options) { if (options.signal?.aborted || options.cancelled?.()) throw abortError(); }
  function progress(options, frame, total, phase, value = frame / total) {
    checkCancelled(options); options.onProgress?.({ frame, total, phase, progress: Math.max(0, Math.min(1, value)) });
  }
  const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
  function settings(clip, options, format) {
    if (!clip || !Array.isArray(clip.objects)) throw new Error('Open an animation clip before exporting.');
    const width = integer(clip.width), height = integer(clip.height), frames = integer(clip.duration), fps = integer(options.fps, clip.fps || 12), scale = integer(options.scale, 1);
    if (![width, height, frames, fps, scale].every(Number.isSafeInteger) || width < 1 || height < 1 || frames < 1 || frames > LIMITS.maxFrames || fps < 1 || fps > 60 || scale < 1 || scale > 8) throw new Error('Use 1–600 frames, 1–60 fps, and an integer enlargement from 1× to 8×.');
    const w = width * scale, h = height * scale, pixels = w * h;
    if (w > LIMITS.maxEdge || h > LIMITS.maxEdge || pixels > LIMITS.maxFramePixels) throw new Error('The enlarged frame is too large. Reduce the canvas size or export enlargement.');
    const order = Array.from({ length: frames }, (_, i) => i);
    if (clip.loop === 'pingpong' && frames > 2 && (format === 'gif' || format === 'video')) for (let i = frames - 2; i > 0; i--) order.push(i);
    if (pixels * order.length > LIMITS.maxRenderedPixels) throw new Error('This export contains too many pixels. Use a smaller enlargement, a shorter clip, or export it in sections.');
    if (format === 'gif' && (pixels > LIMITS.maxGIFFramePixels || pixels * order.length > LIMITS.maxGIFPixels)) throw new Error('This GIF would be too large. Reduce enlargement or clip length. PNG frames preserve the original colors for larger animations.');
    return { width: w, height: h, nativeWidth: width, nativeHeight: height, frames, fps, scale, order, pixels, format };
  }
  function renderer(options) {
    const evaluate = options.evaluateFrame || window.MINISH_ANIMATION?.evaluateFrame;
    const render = options.renderFrame || window.MINISH_STUDIO?.renderSceneToCanvas;
    if (typeof evaluate !== 'function' || typeof render !== 'function') throw new Error('The animation renderer is unavailable. Reopen the complete app folder.');
    return async (clip, frame, config) => {
      checkCancelled(options);
      const scene = evaluate(clip, frame);
      const canvas = await render(scene, { scale: config.scale });
      if (!canvas || canvas.width !== config.width || canvas.height !== config.height || typeof canvas.getContext !== 'function') throw new Error('The frame renderer returned an unexpected canvas size.');
      return { canvas, scene };
    };
  }
  function canvasPNG(canvas) { return new Promise((resolve, reject) => { try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create a PNG frame.')), 'image/png'); } catch (error) { reject(error); } }); }
  function withInfo(blob, info) { Object.defineProperty(blob, 'exportInfo', { value: Object.freeze(info), enumerable: true }); return blob; }
  const safeName = name => String(name || 'Minish animation').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80) || 'Minish animation';
  function sourceProject(clip, options) {
    if (options.project) return options.project;
    return { format: 'minish-cap-animation', version: 1, name: clip.name || 'Minish animation', activeClip: clip.id, clips: [clip] };
  }
  function sourceReferences(ids) {
    return [...ids].sort().map(id => {
      const a = window.MINISH_STUDIO?.getAsset?.(id) || window.MINISH_STUDIO?.assets?.find(asset => String(asset.id) === id);
      return a ? { id, name: a.name || '', path: a.path || '', sourceUrl: a.sourceUrl || '', contributors: a.contributors || '', sourceId: a.sourceId || null } : { id };
    });
  }
  function manifest(clip, config, refs, extra = {}) {
    const order = Array.from({ length: config.frames }, (_, i) => i);
    if (clip.loop === 'pingpong' && config.frames > 2) for (let i = config.frames - 2; i > 0; i--) order.push(i);
    return { format: 'minish-animation-' + config.format, version: 1, creator: 'SerakSan', name: clip.name || 'Minish animation',
      width: config.width, height: config.height, nativeWidth: config.nativeWidth, nativeHeight: config.nativeHeight, enlargement: config.scale,
      fps: config.fps, frames: config.frames, loop: clip.loop || 'loop', playbackOrder: order,
      game: 'The Legend of Zelda: The Minish Cap', artwork: 'Nintendo / Capcom. Third-party game art is separate from the editor code license.',
      sourceUrl: 'https://www.spriters-resource.com/game_boy_advance/thelegendofzeldatheminishcap/', sources: sourceReferences(refs), ...extra };
  }
  const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; table[n] = c >>> 0; } return table; })();
  function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
  async function makeZip(files, options = {}) {
    const parts = [], central = []; let offset = 0, size = 0;
    for (const file of files) {
      checkCancelled(options);
      const name = textEncoder.encode(file.name), body = file.blob instanceof Blob ? file.blob : new Blob([file.data || '']);
      size += body.size; if (size > LIMITS.maxBytes) throw new Error('The export archive is too large. Use a smaller enlargement or split the clip into shorter sections.');
      const crc = crc32(new Uint8Array(await body.arrayBuffer())), header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint16(12, 0x21, true);
      view.setUint32(14, crc, true); view.setUint32(18, body.size, true); view.setUint32(22, body.size, true); view.setUint16(26, name.length, true); header.set(name, 30);
      const directory = new Uint8Array(46 + name.length), dv = new DataView(directory.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x800, true); dv.setUint16(14, 0x21, true);
      dv.setUint32(16, crc, true); dv.setUint32(20, body.size, true); dv.setUint32(24, body.size, true); dv.setUint16(28, name.length, true); dv.setUint32(42, offset, true); directory.set(name, 46);
      parts.push(header, body); central.push(directory); offset += header.length + body.size;
    }
    const directorySize = central.reduce((sum, part) => sum + part.length, 0), end = new Uint8Array(22), endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true); endView.setUint32(12, directorySize, true); endView.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  const sourceIds = (scene, refs) => (scene.objects || []).filter(o => o.kind === 'sprite' && o.assetId != null).forEach(o => refs.add(String(o.assetId)));
  const creditsText = 'Minish animation by SerakSan\n\nOriginal game artwork: Nintendo / Capcom.\nSource sheets: The Spriters Resource and each credited sheet contributor.\nSource URLs and contributor names are recorded in animation.json.\nGame art is not covered by the editor code license.\n\nPNG frames and sprite sheets preserve full RGBA pixels at integer enlargement.\nGIF uses a 256-color palette and binary transparency; use PNG frames for lossless colors and alpha.\nWild and multipart editor arrangements do not claim to be extracted ROM animation frames.\n';
  async function exportFrames(clip, options = {}) {
    const config = settings(clip, options, 'frames'), render = renderer(options), files = [], refs = new Set(), entries = []; let bytes = 0;
    for (let frame = 0; frame < config.frames; frame++) {
      const { canvas, scene } = await render(clip, frame, config), blob = await canvasPNG(canvas), name = 'frames/frame-' + String(frame + 1).padStart(4, '0') + '.png';
      sourceIds(scene, refs); bytes += blob.size; if (bytes > LIMITS.maxBytes) throw new Error('The PNG frames exceed the archive limit. Use smaller enlargement or a shorter clip.');
      files.push({ name, blob }); entries.push({ frame, file: name, time: frame / config.fps, duration: 1 / config.fps });
      progress(options, frame + 1, config.frames, 'Rendering lossless PNG frames'); await yieldUI();
    }
    files.push({ name: 'animation.json', data: JSON.stringify(manifest(clip, config, refs, { entries }), null, 2) },
      { name: 'project.minish-animation.json', data: JSON.stringify(sourceProject(clip, options), null, 2) }, { name: 'CREDITS.txt', data: creditsText });
    progress(options, config.frames, config.frames, 'Packing PNG frames');
    return withInfo(await makeZip(files, options), { format: 'frames', width: config.width, height: config.height, frames: config.frames, exact: true, alpha: 'full', filename: safeName(clip.name) + '-frames.zip' });
  }
  async function exportSheet(clip, options = {}) {
    const config = settings(clip, options, 'sheet'), render = renderer(options), files = [], refs = new Set(), entries = [], pages = [];
    const budgetCells = Math.max(1, Math.floor(LIMITS.maxSheetPixels / config.pixels)), maxCells = Math.min(config.frames, budgetCells);
    const cols = Math.max(1, Math.min(Math.floor(LIMITS.maxEdge / config.width), Math.ceil(Math.sqrt(maxCells * config.height / config.width))));
    const rows = Math.max(1, Math.min(Math.floor(LIMITS.maxEdge / config.height), Math.floor(budgetCells / cols))), capacity = Math.min(config.frames, cols * rows);
    for (let start = 0; start < config.frames; start += capacity) {
      const count = Math.min(capacity, config.frames - start), pageCols = Math.min(cols, count), pageRows = Math.ceil(count / pageCols), sheet = document.createElement('canvas');
      sheet.width = pageCols * config.width; sheet.height = pageRows * config.height; const ctx = sheet.getContext('2d'); ctx.imageSmoothingEnabled = false;
      const page = pages.length, file = 'sheets/sheet-' + String(page + 1).padStart(3, '0') + '.png';
      for (let index = 0; index < count; index++) {
        const frame = start + index, { canvas, scene } = await render(clip, frame, config), x = index % pageCols * config.width, y = Math.floor(index / pageCols) * config.height;
        ctx.drawImage(canvas, x, y); sourceIds(scene, refs); entries.push({ frame, page, file, x, y, w: config.width, h: config.height, duration: 1 / config.fps });
        progress(options, frame + 1, config.frames, 'Building lossless sprite sheets'); await yieldUI();
      }
      files.push({ name: file, blob: await canvasPNG(sheet) }); pages.push({ file, width: sheet.width, height: sheet.height }); sheet.width = 1; sheet.height = 1;
    }
    files.push({ name: 'animation.json', data: JSON.stringify(manifest(clip, config, refs, { pages, entries }), null, 2) },
      { name: 'project.minish-animation.json', data: JSON.stringify(sourceProject(clip, options), null, 2) }, { name: 'CREDITS.txt', data: creditsText });
    return withInfo(await makeZip(files, options), { format: 'sheet', width: config.width, height: config.height, frames: config.frames, pages: pages.length, exact: true, alpha: 'full', filename: safeName(clip.name) + '-sprite-sheets.zip' });
  }
  function pixelData(canvas) {
    try { return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data; }
    catch (_) { throw new Error('Could not read frame pixels. Keep the local artwork with the app, then reopen it and try again.'); }
  }
  function paletteFor(histogram, exactColors, transparent) {
    const limit = transparent ? 255 : 256;
    if (exactColors.size <= limit) return { colors: [...exactColors.keys()].map(color => [color >>> 16, color >>> 8 & 255, color & 255]), exact: true };
    const points = [];
    for (let i = 0; i < histogram.count.length; i++) if (histogram.count[i]) points.push({ rgb: [histogram.r[i] / histogram.count[i], histogram.g[i] / histogram.count[i], histogram.b[i] / histogram.count[i]], count: histogram.count[i] });
    function box(items) {
      const lo = [255, 255, 255], hi = [0, 0, 0]; let weight = 0;
      for (const p of items) { weight += p.count; for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.rgb[i]); hi[i] = Math.max(hi[i], p.rgb[i]); } }
      const range = hi.map((v, i) => v - lo[i]), axis = range.indexOf(Math.max(...range));
      return { items, weight, axis, score: items.length > 1 ? range[axis] * Math.sqrt(weight) : -1 };
    }
    const boxes = points.length ? [box(points)] : [];
    while (boxes.length < limit) {
      let best = -1; for (let i = 0; i < boxes.length; i++) if (boxes[i].score > (best < 0 ? -1 : boxes[best].score)) best = i;
      if (best < 0 || boxes[best].score <= 0) break;
      const current = boxes.splice(best, 1)[0], items = current.items.sort((a, b) => a.rgb[current.axis] - b.rgb[current.axis]);
      let sum = 0, split = 1;
      for (; split < items.length; split++) { sum += items[split - 1].count; if (sum >= current.weight / 2) break; }
      split = Math.min(items.length - 1, Math.max(1, split)); boxes.push(box(items.slice(0, split)), box(items.slice(split)));
    }
    return { colors: boxes.map(current => [0, 1, 2].map(axis => Math.round(current.items.reduce((sum, p) => sum + p.rgb[axis] * p.count, 0) / current.weight))), exact: false };
  }
  // GIF LZW grows from nine to twelve bits, then clears its full dictionary.
  // Width changes follow the decoder's one-entry lag, including the final code.
  async function gifLZW(indices, options) {
    let bytes = new Uint8Array(Math.min(65536, Math.max(64, indices.length))), byteOffset = 0, bits = 0, buffer = 0, width = 9, nextCode = 258;
    const dictionary = new Map();
    const byte = value => { if (byteOffset === bytes.length) { const grown = new Uint8Array(bytes.length * 2); grown.set(bytes); bytes = grown; } bytes[byteOffset++] = value; };
    const code = value => {
      buffer |= value << bits; bits += width;
      while (bits >= 8) { byte(buffer & 255); buffer >>>= 8; bits -= 8; }
      if (nextCode === 1 << width && width < 12) width++;
    };
    code(256);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      if (i % 131072 === 0) { checkCancelled(options); await yieldUI(); }
      const suffix = indices[i], pair = prefix << 8 | suffix;
      if (dictionary.has(pair)) prefix = dictionary.get(pair);
      else {
        code(prefix);
        if (nextCode < 4096) dictionary.set(pair, nextCode++);
        else { code(256); dictionary.clear(); width = 9; nextCode = 258; }
        prefix = suffix;
      }
    }
    if (indices.length) code(prefix);
    code(257); if (bits) byte(buffer & 255);
    const result = new Uint8Array(2 + byteOffset + Math.ceil(byteOffset / 255)); let offset = 0; result[offset++] = 8;
    for (let i = 0; i < byteOffset; i += 255) { const count = Math.min(255, byteOffset - i); result[offset++] = count; result.set(bytes.subarray(i, i + count), offset); offset += count; }
    result[offset] = 0; return result;
  }
  async function exportGIF(clip, options = {}) {
    const config = settings(clip, options, 'gif'), render = renderer(options), histogram = { count: new Uint32Array(32768), r: new Float64Array(32768), g: new Float64Array(32768), b: new Float64Array(32768) }, exactColors = new Map();
    let transparent = false, partialAlpha = false;
    for (let i = 0; i < config.order.length; i++) {
      const { canvas } = await render(clip, config.order[i], config), data = pixelData(canvas);
      for (let p = 0; p < data.length; p += 4) {
        const alpha = data[p + 3]; if (alpha !== 0 && alpha !== 255) partialAlpha = true;
        if (alpha < 128) { transparent = true; continue; }
        const r = data[p], g = data[p + 1], b = data[p + 2], color = r << 16 | g << 8 | b, bin = (r >>> 3) << 10 | (g >>> 3) << 5 | b >>> 3;
        if (exactColors.size <= 256) exactColors.set(color, true);
        histogram.count[bin]++; histogram.r[bin] += r; histogram.g[bin] += g; histogram.b[bin] += b;
      }
      progress(options, i + 1, config.order.length, 'Reviewing GIF colors', (i + 1) / config.order.length * .45); await yieldUI();
    }
    const palette = paletteFor(histogram, exactColors, transparent), colors = transparent ? [[0, 0, 0], ...palette.colors] : palette.colors;
    if (!colors.length) colors.push([0, 0, 0]);
    const table = new Uint8Array(768); colors.forEach((color, index) => table.set(color, index * 3));
    const header = new Uint8Array(13); header.set(textEncoder.encode('GIF89a')); const hv = new DataView(header.buffer); hv.setUint16(6, config.width, true); hv.setUint16(8, config.height, true); header[10] = 0xf7;
    const parts = [header, table];
    if (clip.loop !== 'once') parts.push(new Uint8Array([0x21, 0xff, 11]), textEncoder.encode('NETSCAPE2.0'), new Uint8Array([3, 1, 0, 0, 0]));
    const lookup = new Map(), start = transparent ? 1 : 0;
    if (palette.exact) colors.forEach((color, index) => { if (index >= start) lookup.set(color[0] << 16 | color[1] << 8 | color[2], index); });
    function indexFor(r, g, b) {
      const key = r << 16 | g << 8 | b; if (lookup.has(key)) return lookup.get(key);
      let chosen = start, distance = Infinity;
      for (let index = start; index < colors.length; index++) { const color = colors[index], d = (color[0] - r) ** 2 + (color[1] - g) ** 2 + (color[2] - b) ** 2; if (d < distance) { distance = d; chosen = index; } }
      if (lookup.size > 100000) lookup.clear(); lookup.set(key, chosen); return chosen;
    }
    let durationCentiseconds = 0;
    for (let i = 0; i < config.order.length; i++) {
      const { canvas } = await render(clip, config.order[i], config), data = pixelData(canvas), indices = new Uint8Array(config.pixels);
      for (let p = 0, index = 0; p < data.length; p += 4, index++) indices[index] = data[p + 3] < 128 && transparent ? 0 : indexFor(data[p], data[p + 1], data[p + 2]);
      const delay = Math.max(1, Math.round((i + 1) * 100 / config.fps) - Math.round(i * 100 / config.fps)); durationCentiseconds += delay;
      const control = new Uint8Array([0x21, 0xf9, 4, 8 | (transparent ? 1 : 0), delay & 255, delay >>> 8, 0, 0]), descriptor = new Uint8Array(10), dv = new DataView(descriptor.buffer);
      descriptor[0] = 0x2c; dv.setUint16(5, config.width, true); dv.setUint16(7, config.height, true);
      parts.push(control, descriptor, await gifLZW(indices, options));
      progress(options, i + 1, config.order.length, 'Encoding GIF', .45 + (i + 1) / config.order.length * .55); await yieldUI();
    }
    parts.push(new Uint8Array([0x3b])); const blob = new Blob(parts, { type: 'image/gif' });
    if (blob.size > LIMITS.maxBytes) throw new Error('The GIF is too large. Use smaller enlargement or a shorter clip.');
    return withInfo(blob, { format: 'gif', width: config.width, height: config.height, frames: config.order.length, fps: config.fps,
      duration: durationCentiseconds / 100, palette: palette.exact ? 'exact' : 'quantized', exact: palette.exact && !partialAlpha,
      alpha: transparent || partialAlpha ? 'binary' : 'opaque', partialAlphaReduced: partialAlpha, filename: safeName(clip.name) + '.gif',
      note: palette.exact ? partialAlpha ? 'Original RGB colors retained. GIF reduces transparency to on/off; PNG frames retain full alpha.' : 'Original RGB colors retained within the GIF palette.' : 'GIF uses a reduced 256-color palette. PNG frames and sprite sheets retain original RGBA colors.' });
  }
  function supportsVideo() {
    if (typeof window.MediaRecorder !== 'function' || typeof document?.createElement !== 'function') return { supported: false, mimeType: null, container: null, extension: null, reason: 'Video recording is unavailable here. Export GIF or lossless PNG frames instead.' };
    const canvas = document.createElement('canvas');
    if (typeof canvas.captureStream !== 'function') return { supported: false, mimeType: null, container: null, extension: null, reason: 'This browser cannot record a canvas. GIF and PNG-frame exports remain available.' };
    const mimeType = ['video/mp4', 'video/mp4;codecs=avc1', 'video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => window.MediaRecorder.isTypeSupported?.(type));
    const container = mimeType?.startsWith('video/mp4') ? 'mp4' : 'webm';
    return mimeType ? { supported: true, mimeType, container, extension: container, reason: '' } : { supported: false, mimeType: null, container: null, extension: null, reason: 'This browser does not record MP4 or WebM. Use a compatible browser, GIF, or lossless PNG frames.' };
  }
  async function exportVideo(clip, options = {}) {
    const capability = supportsVideo(); if (!capability.supported) throw new Error(capability.reason);
    const config = settings(clip, options, 'video'), render = renderer(options), first = await render(clip, 0, config);
    const output = document.createElement('canvas');
    output.width = config.width + (capability.container === 'mp4' ? config.width % 2 : 0);
    output.height = config.height + (capability.container === 'mp4' ? config.height % 2 : 0);
    const ctx = output.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const matte = /^#[0-9a-f]{6}$/i.test(options.videoBackground || '') ? options.videoBackground : /^#[0-9a-f]{6}$/i.test(clip.color || '') ? clip.color : '#000000';
    const draw = canvas => { ctx.fillStyle = matte; ctx.fillRect(0, 0, output.width, output.height); ctx.drawImage(canvas, 0, 0); };
    draw(first.canvas);
    const stream = output.captureStream(config.fps), chunks = []; let recorder, recorderError = null;
    try {
      recorder = new window.MediaRecorder(stream, { mimeType: capability.mimeType, videoBitsPerSecond: Math.min(20000000, Math.max(2000000, config.pixels * config.fps)) });
      const complete = new Promise((resolve, reject) => { recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); }; recorder.onerror = event => { recorderError = event.error || new Error('The browser could not record this animation.'); reject(recorderError); }; recorder.onstop = resolve; });
      complete.catch(() => {});
      recorder.start();
      const now = () => window.performance?.now?.() ?? Date.now(), startedAt = now();
      for (let i = 0; i < config.order.length; i++) {
        checkCancelled(options); if (recorderError) throw recorderError;
        if (i) draw((await render(clip, config.order[i], config)).canvas);
        progress(options, i + 1, config.order.length, 'Recording ' + capability.container.toUpperCase() + ' video in real time');
        await new Promise(resolve => setTimeout(resolve, Math.max(0, startedAt + (i + 1) * 1000 / config.fps - now())));
      }
      recorder.stop(); await complete; checkCancelled(options);
      const blob = new Blob(chunks, { type: 'video/' + capability.container }); if (!blob.size) throw new Error('The browser did not produce video data. Export GIF or PNG frames instead.');
      if (blob.size > LIMITS.maxBytes) throw new Error('The recorded video is too large. Use smaller enlargement or a shorter clip.');
      return withInfo(blob, { format: capability.container, width: output.width, height: output.height, sourceWidth: config.width, sourceHeight: config.height,
        frames: config.order.length, fps: config.fps, exact: false, alpha: 'flattened', background: matte, filename: safeName(clip.name) + '.' + capability.extension,
        padding: { right: output.width - config.width, bottom: output.height - config.height },
        note: capability.container.toUpperCase() + ' uses browser video compression. Transparent areas use the scene background.' + ((output.width !== config.width || output.height !== config.height) ? ' One background pixel pads odd dimensions for MP4 compatibility.' : '') + ' PNG frames retain the original RGBA pixels.' });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error((error.message || 'Video recording failed.') + ' GIF and lossless PNG frames are available as alternatives.');
    } finally { if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} } stream.getTracks().forEach(track => track.stop()); output.width = 1; output.height = 1; }
  }
  async function generate(clip, options = {}) {
    const format = options.format || 'gif', fn = { gif: exportGIF, frames: exportFrames, png: exportFrames, sheet: exportSheet, webm: exportVideo, mp4: exportVideo, video: exportVideo }[format];
    if (!fn) throw new Error('Choose GIF, PNG frames, sprite sheets, or video.'); return fn(clip, options);
  }
  window.MINISH_ANIMATION_EXPORT = { exportFrames, exportGIF, exportSheet, exportVideo, supportsVideo, generate, limits: LIMITS, makeZip, safeName, version: '5.0.0' };
})();
