(() => {
  'use strict';
  const FORMAT = 'minish-cap-animation', STORAGE = 'minish-maker-animation-v1';
  const LIMITS = Object.freeze({ minSize: 16, maxSize: 1024, maxClips: 30, maxObjects: 1000, maxFrames: 600, maxFps: 60, maxScale: 8, maxExportPixels: 16777216, maxExportEdge: 8192 });
  const LAYERS = ['terrain', 'objects', 'overlay'];
  const POSE = ['pieceId', 'assetId', 'sx', 'sy', 'sw', 'sh', 'sourceId', 'pieceName', 'keyColor'];
  const PROPS = ['x', 'y', 'scale', 'flipX', 'flipY', 'visible', ...POSE, 'layer', 'text', 'fontSize', 'w', 'h', 'color', 'box'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => 'anim-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const integer = (value, fallback = 0) => Math.round(finite(value, fallback));
  const validNumber = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value));
  const color = (value, fallback = '#182a25') => /^#[\da-f]{6}$/i.test(String(value)) ? String(value) : fallback;
  let adapter = window.MINISH_STUDIO || null, frame = 0, selection = null, playing = false, request = null, playStart = null, playFrom = 0, dirty = false, revision = 0;
  let undoStack = [], redoStack = [], saveTimer = null, initialized = false, batching = 0;
  const listeners = new Set();
  function freshClip(patch = {}) {
    return { id: uid(), name: 'Animation 01', width: 240, height: 160, exportScale: 4, fps: 12, duration: 48, loop: 'loop', color: '#182a25', transparent: true, objects: [], tracks: [], ...patch };
  }
  let first = freshClip(), project = { format: FORMAT, version: 1, name: 'My animated adventure', activeClip: first.id, clips: [first] };
  const current = () => project.clips.find(clip => clip.id === project.activeClip) || project.clips[0];
  const findObject = (id, clip = current()) => clip.objects.find(object => object.id === id);
  const findTrack = (id, clip = current()) => clip.tracks.find(track => track.objectId === id);
  function getAsset(id) { return adapter?.getAsset?.(String(id)) || adapter?.assets?.find(asset => String(asset.id) === String(id)) || null; }
  function resolvePiece(value) {
    const piece = typeof value === 'string' ? adapter?.getPiece?.(value) : value;
    if (!piece || !piece.assetId) throw new Error('Choose a genuine game pose from the collection.');
    return clone(piece);
  }
  function normalizeObject(input, id = null) {
    if (!input || !['sprite', 'dialogue'].includes(input.kind)) throw new Error('This animation contains an unsupported piece.');
    for (const prop of ['x', 'y', 'scale']) if (prop in input && !validNumber(input[prop])) throw new Error('Use finite numbers for piece position and scale.');
    const object = { ...clone(input), id: String(id || input.id || uid()), x: clamp(integer(input.x), -100000, 100000), y: clamp(integer(input.y), -100000, 100000),
      scale: clamp(integer(input.scale, 1), 1, LIMITS.maxScale), layer: LAYERS.includes(input.layer) ? input.layer : 'objects', visible: input.visible !== false };
    if (object.kind === 'sprite') {
      object.assetId = String(input.assetId || '');
      const asset = getAsset(object.assetId);
      if (adapter && !asset) throw new Error('A source image is missing from this animation. Keep the app and its assets together.');
      for (const key of ['sx', 'sy', 'sw', 'sh']) if (key in input && !validNumber(input[key])) throw new Error('Use valid source crop dimensions.');
      for (const key of ['sx', 'sy', 'sw', 'sh']) object[key] = integer(input[key], key[0] === 's' && ['sw', 'sh'].includes(key) ? 16 : 0);
      if (object.sx < 0 || object.sy < 0 || object.sw < 1 || object.sh < 1 || asset && (object.sx + object.sw > asset.width || object.sy + object.sh > asset.height)) throw new Error('A pose crop extends beyond its source image.');
      object.flipX = !!object.flipX; object.flipY = !!object.flipY;
      object.keyColor = /^#[\da-f]{6}$/i.test(String(input.keyColor)) ? input.keyColor : null;
      for (const key of ['pieceId', 'sourceId', 'pieceName']) if (input[key] != null) object[key] = String(input[key]).slice(0, key === 'pieceName' ? 160 : 120);
      // Animation projects store references, never a copied source bitmap or a local path.
      delete object.dataUrl; delete object.thumbnailDataUrl; delete object.path;
    } else {
      object.text = String(input.text || '').slice(0, 5000); object.w = clamp(integer(input.w, 192), 20, 2000); object.h = clamp(integer(input.h, 58), 12, 2000);
      object.fontSize = clamp(integer(input.fontSize, 12), 4, 48); object.color = color(input.color, '#fff7d3'); object.box = input.box !== false;
    }
    return object;
  }
  function normalizeValues(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A keyframe must contain piece properties.');
    const result = {};
    for (const prop of PROPS) if (Object.prototype.hasOwnProperty.call(input, prop)) {
      const value = input[prop];
      if (['x', 'y'].includes(prop)) { if (!validNumber(value)) throw new Error('Use a number for keyframe coordinates.'); result[prop] = clamp(integer(value), -100000, 100000); }
      else if (prop === 'scale') result[prop] = clamp(integer(value, 1), 1, 8);
      else if (['flipX', 'flipY', 'visible', 'box'].includes(prop)) result[prop] = !!value;
      else if (prop === 'layer') { if (!LAYERS.includes(value)) throw new Error('Choose Terrain, Objects or Overlay.'); result[prop] = value; }
      else if (['sx', 'sy', 'sw', 'sh', 'fontSize', 'w', 'h'].includes(prop)) { if (!validNumber(value)) throw new Error('Use valid keyframe dimensions.'); result[prop] = integer(value); }
      else if (prop === 'keyColor') result[prop] = /^#[\da-f]{6}$/i.test(String(value)) ? value : null;
      else if (prop === 'color') result[prop] = color(value, '#fff7d3');
      else result[prop] = String(value == null ? '' : value).slice(0, prop === 'text' ? 5000 : 160);
    }
    if (result.pieceId && !adapter?.getPiece?.(result.pieceId)) throw new Error('This keyframe references a pose that is not in the supplied collection.');
    if (result.assetId && adapter && !getAsset(result.assetId)) throw new Error('This keyframe references a missing source image.');
    return result;
  }
  function normalizeClip(input) {
    if (!input || typeof input !== 'object') throw new Error('Choose a valid animation clip.');
    for (const prop of ['width', 'height', 'exportScale', 'fps', 'duration']) if (prop in input && !validNumber(input[prop])) throw new Error('Use finite numbers for clip dimensions, timing, and export enlargement.');
    const width = integer(input.width, 240), height = integer(input.height, 160), exportScale = integer(input.exportScale, 4), fps = integer(input.fps, 12), duration = integer(input.duration, 48);
    if (width < 16 || width > 1024 || height < 16 || height > 1024) throw new Error('Animation dimensions must be between 16 and 1024 native pixels.');
    if (fps < 1 || fps > 60 || duration < 1 || duration > 600) throw new Error('Choose 1–60 FPS and 1–600 frames.');
    if (exportScale < 1 || exportScale > 8 || width * exportScale > 8192 || height * exportScale > 8192 || width * height * exportScale ** 2 > LIMITS.maxExportPixels) throw new Error('Choose a smaller integer export enlargement.');
    if (!Array.isArray(input.objects) || input.objects.length > LIMITS.maxObjects) throw new Error('An animation supports up to 1000 pieces per clip.');
    const ids = new Set();
    const objects = input.objects.map(value => { const o = normalizeObject(value); if (ids.has(o.id)) throw new Error('Each animated piece needs a unique ID.'); ids.add(o.id); return o; });
    const seen = new Set(), tracks = [];
    if (input.tracks != null && !Array.isArray(input.tracks)) throw new Error('This animation has an invalid timeline.');
    for (const track of input.tracks || []) {
      if (!ids.has(String(track.objectId)) || seen.has(String(track.objectId))) continue;
      if (!Array.isArray(track.keys) || track.keys.length > 600) throw new Error('A track supports one keyframe per frame.');
      const keys = new Map();
      for (const key of track.keys) {
        const at = integer(key.frame, -1);
        if (at < 0 || at >= duration) throw new Error('A keyframe is outside the clip duration.');
        if (keys.has(at)) throw new Error('Two keyframes cannot occupy the same frame on one track.');
        keys.set(at, { frame: at, values: normalizeValues(key.values || {}), easing: key.easing === 'linear' ? 'linear' : 'hold' });
      }
      seen.add(String(track.objectId));
      tracks.push({ id: String(track.id || uid()), objectId: String(track.objectId), name: String(track.name || '').slice(0, 100), muted: !!track.muted, locked: !!track.locked, keys: [...keys.values()].sort((a, b) => a.frame - b.frame) });
    }
    const clip = { id: String(input.id || uid()), name: String(input.name || 'Untitled animation').slice(0, 80), width, height, exportScale, fps, duration,
      loop: ['loop', 'once', 'pingpong'].includes(input.loop) ? input.loop : 'loop', color: color(input.color || input.background?.color), transparent: input.transparent ?? input.background?.transparent ?? true,
      objects, tracks };
    for (const object of objects) {
      const track = tracks.find(track => track.objectId === object.id);
      for (const key of track?.keys || []) evaluateObject(object, track, key.frame);
    }
    return clip;
  }
  function validateProject(data) {
    if (!data || data.format !== FORMAT || !Array.isArray(data.clips) || !data.clips.length || data.clips.length > LIMITS.maxClips) throw new Error('Choose a Minish Studio animation project JSON file.');
    const clips = data.clips.map(normalizeClip), ids = new Set();
    for (const clip of clips) { if (ids.has(clip.id)) throw new Error('Animation clips need unique IDs.'); ids.add(clip.id); }
    return { format: FORMAT, version: 1, name: String(data.name || 'My animated adventure').slice(0, 80), activeClip: ids.has(data.activeClip) ? data.activeClip : clips[0].id, clips };
  }
  function valueAt(base, keys, prop, at) {
    let before = null, after = null;
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(key.values, prop)) {
      if (key.frame <= at) before = key; else { after = key; break; }
    }
    if (!before) return base;
    const value = before.values[prop];
    if (after && before.easing === 'linear' && ['x', 'y'].includes(prop)) return Math.round(value + (after.values[prop] - value) * (at - before.frame) / (after.frame - before.frame));
    return value;
  }
  function evaluateObject(base, track, at) {
    const object = clone(base), keys = track?.keys || [];
    const values = {};
    for (const prop of PROPS) values[prop] = valueAt(base[prop], keys, prop, at);
    if (values.pieceId && values.pieceId !== base.pieceId) {
      const piece = adapter?.getPiece?.(values.pieceId);
      if (!piece) throw new Error('A pose is missing from the collection.');
      for (const prop of POSE) if (piece[prop] != null) object[prop] = piece[prop];
      object.pieceName = piece.name || piece.pieceName || base.pieceName;
    }
    // Explicit crop keys override the resolved pose only when they exist.
    for (const prop of PROPS) {
      if (values[prop] === undefined) continue;
      if (POSE.includes(prop) && !keys.some(key => key.frame <= at && Object.prototype.hasOwnProperty.call(key.values, prop))) continue;
      object[prop] = values[prop];
    }
    const offset = poseOffset(base, object);
    object.x = Math.round(finite(values.x, base.x) + offset.x); object.y = Math.round(finite(values.y, base.y) + offset.y);
    object.visible = values.visible !== false && !track?.muted;
    return normalizeObject(object);
  }
  function poseOffset(base, resolved) {
    if (base.kind !== 'sprite') return { x: 0, y: 0 };
    if (base.animationAnchor === 'top-left') return { x: 0, y: 0 };
    const category = window.MINISH_CURATED?.sheets?.[String(base.sourceId)]?.category || window.MINISH_BOSSES?.sheets?.[String(base.sourceId)]?.category || '';
    const scale = resolved.scale || 1, center = base.animationAnchor === 'center' || base.animationAnchor !== 'feet' && (base.layer === 'terrain' || ['objects', 'environments', 'full-bosses', 'complete-bosses'].includes(category));
    return { x: (base.sw - resolved.sw) * scale / 2, y: (base.sh - resolved.sh) * scale * (center ? .5 : 1) };
  }
  function evaluateFrame(clip = current(), at = frame, options = {}) {
    const time = clamp(integer(at), 0, clip.duration - 1);
    const objects = clip.objects.map(base => evaluateObject(base, findTrack(base.id, clip), time)).filter(object => options.includeHidden || object.visible !== false);
    return { id: clip.id, name: clip.name, width: clip.width, height: clip.height, exportScale: clip.exportScale, color: clip.color, transparent: !!clip.transparent, preset: 'custom', objects };
  }
  function state(type = 'state') {
    return { type, project: clone(project), currentClip: clone(current()), activeClip: clone(current()), frame, currentFrame: frame, selectedObjectId: selection, selectedTrackId: selection,
      playing, canUndo: !!undoStack.length, canRedo: !!redoStack.length, dirty, revision };
  }
  function emit(type = 'change') { const snapshot = state(type); for (const listener of listeners) { try { listener(snapshot); } catch (error) { setTimeout(() => { throw error; }, 0); } } }
  function flushBrowserSave() {
    clearTimeout(saveTimer);
    try { const json = JSON.stringify(project); if (json.length > 8000000) return false; localStorage.setItem(STORAGE, json); return true; } catch (_) { return false; }
  }
  function scheduleSave() {
    dirty = true; clearTimeout(saveTimer);
    saveTimer = setTimeout(flushBrowserSave, 400);
  }
  function commit(edit, type = 'change') {
    if (batching) { edit(); return true; }
    pause(false);
    const before = JSON.stringify(project), previousFrame = frame, previousSelection = selection;
    try { edit(); project = validateProject(project); } catch (error) { project = JSON.parse(before); frame = previousFrame; selection = previousSelection; throw error; }
    if (JSON.stringify(project) === before) { emit(type); return false; }
    undoStack.push({ data: before, frame: previousFrame, selection: previousSelection }); if (undoStack.length > 50) undoStack.shift(); redoStack = [];
    frame = clamp(frame, 0, current().duration - 1); if (!findObject(selection)) selection = null;
    revision++; scheduleSave(); emit(type); return true;
  }
  function batch(edit) {
    if (typeof edit !== 'function' || edit.constructor?.name === 'AsyncFunction') throw new Error('Group animation edits in one synchronous action.');
    let result;
    commit(() => { batching++; try { result = edit(); if (result?.then) throw new Error('Group animation edits in one synchronous action.'); } finally { batching--; } }, 'batch');
    return result;
  }
  function ensureTrack(id) {
    const base = findObject(id); if (!base) throw new Error('Select a piece in this animation first.');
    let track = findTrack(id);
    if (!track) { track = { id: uid(), objectId: id, name: base.pieceName || (base.kind === 'dialogue' ? 'Dialogue' : 'Game piece'), muted: false, locked: false, keys: [] }; current().tracks.push(track); }
    return track;
  }
  function editable(id) { if (!findObject(id)) throw new Error('Select a piece in this animation first.'); if (findTrack(id)?.locked) throw new Error('Unlock this track before editing it.'); }
  function setKeyInternal(id, at, patch, options = {}) {
    editable(id); const clip = current(), time = integer(at);
    if (time < 0 || time >= clip.duration) throw new Error('Choose a frame inside this clip.');
    const values = normalizeValues(patch), base = findObject(id), track = ensureTrack(id);
    if (!options.raw && ('x' in values || 'y' in values)) {
      const resolved = evaluateObject(base, track, time);
      if (values.pieceId) {
        const piece = resolvePiece(values.pieceId); for (const prop of POSE) if (piece[prop] != null) resolved[prop] = piece[prop];
      }
      if ('scale' in values) resolved.scale = values.scale;
      const offset = poseOffset(base, resolved);
      if ('x' in values) values.x = Math.round(values.x - offset.x); if ('y' in values) values.y = Math.round(values.y - offset.y);
    }
    let key = track.keys.find(key => key.frame === time);
    if (!key) { key = { frame: time, values: {}, easing: 'hold' }; track.keys.push(key); }
    Object.assign(key.values, values); if (options.easing) key.easing = options.easing === 'linear' ? 'linear' : 'hold';
    track.keys.sort((a, b) => a.frame - b.frame);
    // Validate source bounds at the key before committing it.
    evaluateObject(base, track, time);
    return key;
  }
  function setKey(id = selection, at = frame, patch = {}, options = {}) { commit(() => setKeyInternal(id, at, patch, options), 'key'); return clone(findTrack(id)?.keys.find(key => key.frame === integer(at)) || null); }
  function setKeys(id = selection, values = []) {
    if (!Array.isArray(values) || !values.length || values.length > 600) throw new Error('Choose between 1 and 600 keyframes.');
    commit(() => { for (const key of values) setKeyInternal(id, key.frame, key.values || {}, { easing: key.easing, raw: key.raw }); }, 'key');
    return clone(findTrack(id));
  }
  function removeKey(id = selection, at = frame) { return commit(() => { editable(id); const track = findTrack(id); if (track) track.keys = track.keys.filter(key => key.frame !== integer(at)); }, 'key'); }
  function clearKeyProperties(id = selection, properties = ['text'], range = {}) {
    if (!Array.isArray(properties) || !properties.length || properties.some(prop => !PROPS.includes(prop))) throw new Error('Choose valid keyframe properties to clear.');
    const from = range.from == null ? 0 : integer(range.from, -1), to = range.to == null ? current().duration - 1 : integer(range.to, -1);
    if (from < 0 || to >= current().duration || from > to) throw new Error('Choose an ordered keyframe range inside this clip.');
    return commit(() => {
      editable(id); const track = findTrack(id); if (!track) return;
      for (const key of track.keys) if (key.frame >= from && key.frame <= to) for (const prop of properties) delete key.values[prop];
      track.keys = track.keys.filter(key => Object.keys(key.values).length);
    }, 'key');
  }
  function moveKey(id, from, to, options = {}) {
    return commit(() => { editable(id); const track = findTrack(id), key = track?.keys.find(key => key.frame === integer(from)), target = integer(to);
      if (!key) throw new Error('Choose an existing keyframe first.'); if (target < 0 || target >= current().duration) throw new Error('Choose a frame inside this clip.');
      if (track.keys.some(other => other !== key && other.frame === target) && !options.replace) throw new Error('A keyframe already exists there.');
      track.keys = track.keys.filter(other => other === key || other.frame !== target); key.frame = target; track.keys.sort((a, b) => a.frame - b.frame);
    }, 'key');
  }
  function duplicateKey(id = selection, from = frame, to = frame + 1) {
    return commit(() => { editable(id); const track = findTrack(id), key = track?.keys.find(key => key.frame === integer(from)), target = integer(to);
      if (!key) throw new Error('Choose an existing keyframe first.'); if (target < 0 || target >= current().duration) throw new Error('Choose a frame inside this clip.');
      if (track.keys.some(key => key.frame === target)) throw new Error('A keyframe already exists there.');
      track.keys.push({ ...clone(key), frame: target }); track.keys.sort((a, b) => a.frame - b.frame);
    }, 'key');
  }
  function applyPoseSequence(id = selection, values, options = {}) {
    const pieces = (values || []).map(resolvePiece); if (!pieces.length) throw new Error('Choose at least one genuine game pose.');
    if (pieces.length > 600) throw new Error('A pose sequence supports up to 600 poses.');
    const start = integer(options.start, frame), hold = clamp(integer(options.hold, 2), 1, 600);
    if (start < 0 || start >= current().duration) throw new Error('Choose a starting frame inside this clip.');
    return commit(() => {
      editable(id); if (findObject(id).kind !== 'sprite') throw new Error('Pose sequences need a game sprite.');
      const track = ensureTrack(id);
      if (options.replace !== false) {
        for (const key of track.keys) for (const prop of POSE) delete key.values[prop];
        track.keys = track.keys.filter(key => Object.keys(key.values).length);
      }
      let sequence = pieces;
      if (options.pingpong && pieces.length > 2) sequence = [...pieces, ...pieces.slice(1, -1).reverse()];
      const end = options.loop === false ? Math.min(current().duration, start + sequence.length * hold) : current().duration;
      for (let at = start, index = 0; at < end; at += hold, index++) {
        const piece = sequence[index % sequence.length];
        const patch = piece.id && adapter?.getPiece?.(piece.id) ? { pieceId: piece.id } : { ...Object.fromEntries(POSE.filter(prop => piece[prop] != null).map(prop => [prop, piece[prop]])), pieceId: '', pieceName: piece.name || piece.pieceName || 'Game crop' };
        setKeyInternal(id, at, patch, { raw: true });
      }
    }, 'sequence');
  }
  function updateObject(id = selection, patch = {}, options = {}) {
    if (options.keyframe) { const value = setKey(id, options.frame ?? frame, patch, options); return value; }
    commit(() => { editable(id); const index = current().objects.findIndex(object => object.id === id); current().objects[index] = normalizeObject({ ...current().objects[index], ...patch }, id); }, 'object');
    return clone(findObject(id));
  }
  function addObject(value, options = {}) {
    const object = normalizeObject({ ...value, id: uid() });
    commit(() => { if (current().objects.length >= 1000) throw new Error('This clip already has 1000 pieces.'); current().objects.push(object); selection = object.id; const track = ensureTrack(object.id);
      const at = integer(options.at); if (at > 0) { if (at >= current().duration) throw new Error('Choose a frame inside this clip.'); object.visible = false; track.keys.push({ frame: at, values: { visible: true }, easing: 'hold' }); }
    }, 'object');
    return clone(findObject(object.id));
  }
  function removeObject(id = selection) { return commit(() => { editable(id); current().objects = current().objects.filter(object => object.id !== id); current().tracks = current().tracks.filter(track => track.objectId !== id); if (selection === id) selection = null; }, 'object'); }
  function duplicateObject(id = selection) {
    let duplicated;
    commit(() => { editable(id); const base = findObject(id); if (current().objects.length >= 1000) throw new Error('This clip already has 1000 pieces.'); duplicated = { ...clone(base), id: uid(), x: base.x + 8, y: base.y + 8 }; current().objects.push(duplicated);
      const track = findTrack(id); if (track) { const copy = { ...clone(track), id: uid(), objectId: duplicated.id }; copy.keys.forEach(key => { if ('x' in key.values) key.values.x += 8; if ('y' in key.values) key.values.y += 8; }); current().tracks.push(copy); } selection = duplicated.id;
    }, 'object'); return clone(duplicated);
  }
  function reorderObject(id = selection, direction = 1, absolute = false) {
    return commit(() => { editable(id); const objects = current().objects, from = objects.findIndex(object => object.id === id); const object = objects.splice(from, 1)[0];
      const target = absolute ? direction > 0 ? objects.length : 0 : clamp(from + integer(direction), 0, objects.length); objects.splice(target, 0, object);
    }, 'object');
  }
  function setTrack(id = selection, patch = {}) { return commit(() => { const track = ensureTrack(id); for (const prop of ['locked', 'muted']) if (prop in patch) track[prop] = !!patch[prop]; if ('name' in patch) track.name = String(patch.name).slice(0, 100); }, 'track'); }
  function configureClip(patch = {}) {
    return commit(() => {
      const clip = current(), next = { ...clip, ...clone(patch), id: clip.id, objects: clip.objects, tracks: clip.tracks };
      if (integer(next.duration, 48) < clip.duration) next.tracks = clone(clip.tracks).map(track => ({ ...track, keys: track.keys.filter(key => key.frame < integer(next.duration)) }));
      project.clips[project.clips.indexOf(clip)] = normalizeClip(next);
    }, 'clip');
  }
  function addClip(patch = {}) {
    let added;
    commit(() => { if (project.clips.length >= 30) throw new Error('This animation project already has 30 clips.'); added = normalizeClip(freshClip({ name: 'Animation ' + String(project.clips.length + 1).padStart(2, '0'), ...clone(patch) }));
      project.clips.push(added); project.activeClip = added.id; selection = null; frame = 0;
    }, 'clip'); return clone(added);
  }
  function importScene(scene, options = {}) {
    if (!scene || !Array.isArray(scene.objects)) throw new Error('Choose a scene to animate first.');
    const remap = new Map(scene.objects.map(object => [object.id, uid()]));
    return addClip({ name: options.name || scene.name || 'Animated scene', width: scene.width, height: scene.height, exportScale: scene.exportScale,
      color: scene.color, transparent: scene.transparent, fps: options.fps || 12, duration: options.duration || 48, loop: options.loop || 'loop',
      objects: scene.objects.map(object => ({ ...clone(object), id: remap.get(object.id) })), tracks: [] });
  }
  function duplicateClip(id = current().id) {
    const clip = project.clips.find(clip => clip.id === id); if (!clip) throw new Error('Choose a clip first.');
    const copied = clone(clip), remap = new Map(copied.objects.map(object => [object.id, uid()]));
    copied.id = uid(); copied.name = copied.name + ' copy'; copied.objects.forEach(object => { object.id = remap.get(object.id); });
    copied.tracks.forEach(track => { track.id = uid(); track.objectId = remap.get(track.objectId); }); return addClip(copied);
  }
  function deleteClip(id = current().id) {
    return commit(() => { if (project.clips.length === 1) throw new Error('Keep at least one animation clip.'); const index = project.clips.findIndex(clip => clip.id === id); if (index < 0) return;
      project.clips.splice(index, 1); if (project.activeClip === id) { project.activeClip = project.clips[Math.max(0, index - 1)].id; frame = 0; selection = null; }
    }, 'clip');
  }
  function switchClip(id) { if (!project.clips.some(clip => clip.id === id)) throw new Error('Choose a clip first.'); pause(false); project.activeClip = id; frame = 0; selection = null; scheduleSave(); emit('clip'); }
  function reorderClip(id = current().id, direction = 1) { return commit(() => { const clips = project.clips, index = clips.findIndex(clip => clip.id === id); if (index < 0) throw new Error('Choose a clip first.'); const clip = clips.splice(index, 1)[0]; clips.splice(clamp(index + integer(direction), 0, clips.length), 0, clip); }, 'clip'); }
  function loadProject(data, options = {}) {
    const checked = validateProject(clone(data));
    if (options.history === false) { pause(false); project = checked; frame = 0; selection = null; undoStack = []; redoStack = []; revision++; dirty = false; emit('load'); }
    else commit(() => { project = checked; frame = 0; selection = null; }, 'load');
    return clone(project);
  }
  function saveData() { dirty = false; const data = { ...clone(project), savedAt: new Date().toISOString() }; emit('saved'); return data; }
  function undo() {
    if (!undoStack.length) return false; pause(false); redoStack.push({ data: JSON.stringify(project), frame, selection });
    const previous = undoStack.pop(); project = JSON.parse(previous.data); frame = previous.frame; selection = previous.selection; revision++; scheduleSave(); emit('undo'); return true;
  }
  function redo() {
    if (!redoStack.length) return false; pause(false); undoStack.push({ data: JSON.stringify(project), frame, selection });
    const next = redoStack.pop(); project = JSON.parse(next.data); frame = next.frame; selection = next.selection; revision++; scheduleSave(); emit('redo'); return true;
  }
  function cancelRequest() { if (request != null) window.cancelAnimationFrame?.(request); request = null; }
  function pause(notify = true) { const wasPlaying = playing; playing = false; playStart = null; cancelRequest(); if (notify && wasPlaying) emit('playback'); return frame; }
  function play() {
    if (playing) return;
    if (current().loop === 'once' && frame >= current().duration - 1) frame = 0;
    playing = true; playFrom = frame; playStart = null;
    const tick = timestamp => {
      if (!playing) return;
      if (playStart == null) playStart = timestamp;
      const clip = current(), elapsed = Math.floor(Math.max(0, timestamp - playStart) * clip.fps / 1000), next = playFrom + elapsed;
      let value;
      if (clip.loop === 'once') { value = Math.min(clip.duration - 1, next); if (next >= clip.duration - 1) { frame = value; pause(false); emit('playback'); return; } }
      else if (clip.loop === 'pingpong' && clip.duration > 1) { const period = (clip.duration - 1) * 2, phase = next % period; value = phase < clip.duration ? phase : period - phase; }
      else value = next % clip.duration;
      if (value !== frame) { frame = value; emit('frame'); }
      if (playing) request = window.requestAnimationFrame(tick);
    };
    emit('playback'); request = window.requestAnimationFrame(tick);
  }
  function seek(at, options = {}) {
    if (options.pause !== false) pause(false);
    frame = clamp(integer(at), 0, current().duration - 1);
    if (playing) { playFrom = frame; playStart = null; }
    emit('frame'); return frame;
  }
  function stop() { pause(false); frame = 0; emit('playback'); }
  function step(amount = 1) { return seek(frame + integer(amount, 1)); }
  function selectObject(id) { selection = id != null && findObject(id) ? id : null; emit('selection'); return selection; }
  function init(value = window.MINISH_STUDIO) {
    adapter = value || adapter;
    if (!initialized) {
      try { const saved = localStorage.getItem(STORAGE); if (saved && !dirty) project = validateProject(JSON.parse(saved)); } catch (_) { /* A damaged save never prevents access to the scene maker. */ }
      initialized = true;
    }
    frame = clamp(frame, 0, current().duration - 1); emit('init'); return api;
  }
  const api = {
    format: FORMAT, version: '5.0.0', limits: LIMITS, init, validateProject, evaluateFrame,
    get project() { return clone(project); }, get currentClip() { return clone(current()); }, get activeClip() { return clone(current()); },
    get frame() { return frame; }, get currentFrame() { return frame; }, get selectedObjectId() { return selection; }, get playing() { return playing; },
    get state() { return state(); }, get canUndo() { return !!undoStack.length; }, get canRedo() { return !!redoStack.length; },
    getObjectAt: (id = selection, at = frame) => { const base = findObject(id); return base ? evaluateObject(base, findTrack(id), clamp(integer(at), 0, current().duration - 1)) : null; },
    getTrack: (id = selection) => { const track = findTrack(id); return track ? clone(track) : null; },
    subscribe(listener) { listeners.add(listener); listener(state('init')); return () => listeners.delete(listener); },
    addClip, importScene, duplicateClip, deleteClip, switchClip, reorderClip, configureClip,
    addObject, updateObject, removeObject, duplicateObject, reorderObject, selectObject, selectTrack: selectObject, setTrack,
    setKey, setKeys, batch, removeKey, clearKeyProperties, moveKey, duplicateKey, applyPoseSequence, createPoseSequence: applyPoseSequence,
    loadProject, saveData, flushBrowserSave, undo, redo, play, pause, stop, seek, setFrame: seek, step,
    renameProject(name) { return commit(() => { project.name = String(name || 'My animated adventure').slice(0, 80); }, 'project'); }
  };
  window.MINISH_ANIMATION = api;
})();
