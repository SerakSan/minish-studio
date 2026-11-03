/* Personal pictures stay in this browser or in a project file you save. */
(() => {
  'use strict';
  const records = new Map(), contentIds = new Map();
  const limits = Object.freeze({ maxFiles: 100, maxFileBytes: 33554432, maxPixels: 33554432, maxEdge: 16384, maxEncodedBytes: 134217728 });
  const copy = value => JSON.parse(JSON.stringify(value));
  const referenced = project => [...new Set((project.slides || []).flatMap(slide => (slide.objects || []).filter(object => object.kind === 'image').map(object => String(object.imageId))))];
  const notify = () => document.dispatchEvent(new CustomEvent('minish:media-ready'));
  function metadata(record) { return record ? { id: record.id, width: record.width, height: record.height, label: record.label } : null; }
  function checkDimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > limits.maxEdge || height > limits.maxEdge || width * height > limits.maxPixels) throw new Error('This picture is too large. Use a picture under 32 megapixels and 16,384 pixels per side.');
  }
  function fingerprint(text) {
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489917); }
    return 'picture-' + (a >>> 0).toString(36) + (b >>> 0).toString(36) + '-' + text.length.toString(36);
  }
  function pngDimensions(dataUrl) {
    if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl) || dataUrl.length > limits.maxEncodedBytes) throw new Error('Project pictures must be embedded PNG images. Links and SVG images are not supported.');
    const bytes = atob(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 44));
    if (bytes.length < 24 || [137,80,78,71,13,10,26,10].some((byte, i) => bytes.charCodeAt(i) !== byte) || bytes.slice(12, 16) !== 'IHDR') throw new Error('This project contains an invalid PNG picture.');
    const number = offset => ((bytes.charCodeAt(offset) * 16777216) + (bytes.charCodeAt(offset + 1) << 16) + (bytes.charCodeAt(offset + 2) << 8) + bytes.charCodeAt(offset + 3));
    const width = number(16), height = number(20); checkDimensions(width, height); return { width, height };
  }
  function register(dataUrl, dimensions, requestedId) {
    const same = contentIds.get(dataUrl);
    if (same && (!requestedId || requestedId === same)) return records.get(same);
    let id = String(requestedId || fingerprint(dataUrl));
    if (!/^picture-[a-z0-9-]{1,100}$/i.test(id)) throw new Error('This project has an invalid picture reference.');
    const existing = records.get(id);
    if (existing) {
      if (existing.dataUrl === dataUrl) return existing;
      if (requestedId) throw new Error('Two different pictures have the same project reference.');
      let suffix = 2; while (records.has(id + '-' + suffix)) suffix++; id += '-' + suffix;
    }
    if ([...records.values()].reduce((sum, record) => sum + record.dataUrl.length, dataUrl.length) > limits.maxEncodedBytes) throw new Error('Too many large pictures are open in this session. Save your project, then reload Minish Studio to free unused pictures, or use smaller pictures.');
    const record = { id, ...dimensions, label: 'Picture ' + (records.size + 1), dataUrl, image: null, ready: false, promise: null };
    records.set(id, record); contentIds.set(dataUrl, id); return record;
  }
  function image(id) {
    const record = records.get(String(id));
    if (!record) return Promise.reject(new Error('A picture is missing. Open the saved project file that contains it.'));
    if (record.promise) return record.promise;
    record.image = new Image();
    record.promise = new Promise((resolve, reject) => {
      record.image.onload = () => { record.ready = true; notify(); resolve(record.image); };
      record.image.onerror = () => { record.promise = null; reject(new Error('A project picture could not be opened.')); };
      record.image.src = record.dataUrl;
    });
    record.promise.catch(() => {}); return record.promise;
  }
  async function importFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size < 1) throw new Error('Choose a PNG, JPEG, WebP or GIF picture from your device.');
    if (file.size > limits.maxFileBytes) throw new Error('This picture is over 32 MB. Use a smaller picture.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let type;
    if ([137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte)) type = 'image/png';
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'image/jpeg';
    else if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') type = 'image/webp';
    else if (/^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0, 6)))) type = 'image/gif';
    else throw new Error('Use a PNG, JPEG, WebP or GIF picture. SVG files and image links are not supported.');
    // Re-encoding only the visible raster removes filenames, EXIF and other source metadata.
    const blob = new Blob([bytes], { type }), url = URL.createObjectURL(blob), decoded = new Image();
    try {
      await new Promise((resolve, reject) => { decoded.onload = resolve; decoded.onerror = () => reject(new Error('This picture could not be opened. Try a PNG or JPEG copy.')); decoded.src = url; });
      const width = decoded.naturalWidth || decoded.width, height = decoded.naturalHeight || decoded.height;
      checkDimensions(width, height);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); context.drawImage(decoded, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      return { dataUrl, dimensions: pngDimensions(dataUrl) };
    } finally { URL.revokeObjectURL(url); }
  }
  function hydrate(payload) {
    if (payload == null) return;
    if (!payload || payload.version !== 1 || !Array.isArray(payload.images) || payload.images.length > limits.maxFiles) throw new Error('This project has an invalid picture library.');
    let total = 0; const ids = new Set();
    const checked = payload.images.map(value => {
      if (!value || typeof value.id !== 'string' || typeof value.dataUrl !== 'string') throw new Error('This project has an invalid picture.');
      if (!/^picture-[a-z0-9-]{1,100}$/i.test(value.id) || ids.has(value.id)) throw new Error('This project has an invalid or duplicate picture reference.');
      ids.add(value.id);
      total += value.dataUrl.length; if (total > limits.maxEncodedBytes) throw new Error('This project contains too much picture data.');
      return { id: value.id, dataUrl: value.dataUrl, dimensions: pngDimensions(value.dataUrl) };
    });
    let additional = 0;
    for (const value of checked) { const existing = records.get(value.id); if (existing && existing.dataUrl !== value.dataUrl) throw new Error('Two different pictures have the same project reference.'); if (!existing) additional += value.dataUrl.length; }
    if ([...records.values()].reduce((sum, record) => sum + record.dataUrl.length, additional) > limits.maxEncodedBytes) throw new Error('Too many large pictures are open in this session. Save your current project, then reload Minish Studio before opening this file.');
    for (const value of checked) register(value.dataUrl, value.dimensions, value.id);
  }
  function portable(project) {
    const images = referenced(project).map(id => {
      const record = records.get(id); if (!record) throw new Error('A picture is missing. Open the complete saved project before exporting it.');
      return { id, width: record.width, height: record.height, dataUrl: record.dataUrl };
    });
    return images.length ? { version: 1, images } : undefined;
  }
  let databasePromise;
  function database() {
    if (!window.indexedDB) return Promise.reject(new Error('Picture autosave is unavailable. Save a project file to keep your pictures.'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open('minish-studio-local-pictures-v1', 1);
      request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' }); if (!db.objectStoreNames.contains('pictures')) db.createObjectStore('pictures', { keyPath: 'id' }); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); databasePromise = null; }; resolve(db); };
      request.onerror = () => { databasePromise = null; reject(new Error('Picture autosave is unavailable. Save a project file to keep your pictures.')); };
      request.onblocked = () => { databasePromise = null; reject(new Error('Close other Minish Studio tabs to enable picture autosave, or save a project file.')); };
    });
    return databasePromise;
  }
  async function save(project, key, updatedAt) {
    const snapshot = copy(project), payload = portable(snapshot), db = await database();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['projects', 'pictures'], 'readwrite');
      transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(new Error('Picture autosave is full or unavailable. Save a project file to keep your work.'));
      for (const record of payload?.images || []) transaction.objectStore('pictures').put(record);
      transaction.objectStore('projects').put({ id: key, project: snapshot, updatedAt });
    });
  }
  async function restore(key) {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(['projects', 'pictures'], 'readonly'), request = transaction.objectStore('projects').get(key);
      let result = null, failure;
      request.onsuccess = () => {
        if (!request.result) return;
        const saved = request.result, images = []; result = { project: saved.project, updatedAt: saved.updatedAt, media: { version: 1, images } };
        for (const id of referenced(saved.project)) {
          const picture = transaction.objectStore('pictures').get(id);
          picture.onsuccess = () => { if (picture.result) images.push(picture.result); else failure = new Error('A saved picture is missing. Open your saved project file to restore it.'); };
        }
      };
      transaction.oncomplete = () => failure ? reject(failure) : resolve(result);
      transaction.onerror = transaction.onabort = () => reject(new Error('Could not reopen the picture autosave. Open your saved project file.'));
    });
  }
  window.MINISH_SCENE_MEDIA = Object.freeze({
    limits, importFiles: async files => {
      const list = Array.from(files || []); if (!list.length || list.length > limits.maxFiles) throw new Error('Choose between 1 and 100 pictures.');
      const decoded = []; for (const file of list) decoded.push(await importFile(file));
      const unique = new Set(decoded.filter(value => !contentIds.has(value.dataUrl)).map(value => value.dataUrl));
      const additional = [...unique].reduce((sum, dataUrl) => sum + dataUrl.length, 0);
      if ([...records.values()].reduce((sum, record) => sum + record.dataUrl.length, additional) > limits.maxEncodedBytes) throw new Error('Too many large pictures are open in this session. Save your project, then reload Minish Studio or use smaller pictures.');
      const imported = decoded.map(value => register(value.dataUrl, value.dimensions));
      await Promise.all(imported.map(record => image(record.id))); return imported.map(metadata);
    },
    hydrate, portable, image, ready: id => { const record = records.get(String(id)); if (record && !record.promise) image(id); return record?.ready ? record.image : null; },
    has: id => records.has(String(id)), metadata: id => metadata(records.get(String(id))), list: () => [...records.values()].map(metadata), referenced, save, restore
  });
})();
