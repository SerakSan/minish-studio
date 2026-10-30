// Browser-independent export regressions, plus an optional independent Pillow decode.
// Run: node tests/animation-export.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, body) { const t = Buffer.from(type), result = Buffer.alloc(body.length + 12); result.writeUInt32BE(body.length); t.copy(result, 4); body.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([t, body])), 8 + body.length); return result; }
function png(width, height, rgba) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
function decodePNG(bytes) {
  const b = Buffer.from(bytes); assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let width, height; const data = [];
  for (let p = 8; p < b.length;) { const n = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), body = b.subarray(p + 8, p + 8 + n); assert.equal(b.readUInt32BE(p + 8 + n), crc32(b.subarray(p + 4, p + 8 + n))); if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); } if (type === 'IDAT') data.push(body); p += n + 12; }
  const raw = inflateSync(Buffer.concat(data)), rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) { assert.equal(raw[y * (width * 4 + 1)], 0); rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4); }
  return { width, height, rgba };
}
class Canvas {
  constructor() { this.width = 300; this.height = 150; }
  pixels() { if (this.data?.length !== this.width * this.height * 4) this.data = new Uint8ClampedArray(this.width * this.height * 4); return this.data; }
  getContext() { return this.ctx ||= { imageSmoothingEnabled: true, getImageData: () => ({ data: this.pixels() }), drawImage: (source, x, y) => { const a = source.pixels(), b = this.pixels(); for (let row = 0; row < source.height; row++) b.set(a.subarray(row * source.width * 4, (row + 1) * source.width * 4), ((row + y) * this.width + x) * 4); } }; }
  toBlob(callback) { callback(new Blob([png(this.width, this.height, this.pixels())], { type: 'image/png' })); }
}
const window = {}, document = { createElement: tag => { assert.equal(tag, 'canvas'); return new Canvas(); } };
const context = vm.createContext({ window, document, Blob, TextEncoder, Uint8Array, Uint32Array, Float64Array, DataView, Map, Set, setTimeout: fn => { queueMicrotask(fn); return 1; }, console });
vm.runInContext(fs.readFileSync(path.join(root, 'animation-export.js'), 'utf8'), context);
const api = window.MINISH_ANIMATION_EXPORT;
const clip = { id: 'clip-test', name: 'A tiny adventure', width: 4, height: 3, duration: 3, fps: 12, loop: 'loop', color: '#112233', transparent: true, objects: [{ kind: 'sprite', assetId: 'test-sheet' }], tracks: [] };
const evaluateFrame = (c, frame) => ({ ...c, objects: [{ kind: 'sprite', assetId: 'test-sheet', frame }] });
function frameCanvas(c, frame, scale, gradient = false, alpha = 255) {
  const canvas = new Canvas(); canvas.width = c.width * scale; canvas.height = c.height * scale; const data = canvas.pixels();
  if (gradient) { for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const p = (y * canvas.width + x) * 4; data.set([x * 7 % 256, y * 11 % 256, (x * 13 + y * 17) % 256, 255], p); } }
  else for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) data.set([[255, 0, 0], [0, 255, 0], [0, 0, 255]][frame % 3].concat(alpha), (sy * canvas.width + frame % c.width * scale + sx) * 4);
  return canvas;
}
const renderFrame = async (scene, { scale }) => frameCanvas(scene, scene.objects[0].frame, scale);
window.MINISH_ANIMATION = { evaluateFrame };
window.MINISH_STUDIO = { renderSceneToCanvas: renderFrame, getAsset: id => ({ id, name: 'Genuine source fixture', path: 'assets/sheets/test.png', contributors: 'Source contributor', sourceUrl: 'https://example.test/source' }) };
async function zipEntries(blob) {
  const b = Buffer.from(await blob.arrayBuffer()), files = new Map(); let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    assert.equal(b.readUInt16LE(p + 8), 0); const crc = b.readUInt32LE(p + 14), size = b.readUInt32LE(p + 18), nameSize = b.readUInt16LE(p + 26), extraSize = b.readUInt16LE(p + 28), name = b.toString('utf8', p + 30, p + 30 + nameSize), start = p + 30 + nameSize + extraSize, data = b.subarray(start, start + size);
    assert.equal(crc32(data), crc, 'Every ZIP member passes CRC'); files.set(name, data); p = start + size;
  }
  assert.equal(b.readUInt32LE(p), 0x02014b50); assert.equal(b.readUInt32LE(b.length - 22), 0x06054b50); assert.equal(b.readUInt16LE(b.length - 12), files.size); return files;
}
function decodeGIF(bytes) {
  const b = Buffer.from(bytes); assert.equal(b.toString('ascii', 0, 6), 'GIF89a');
  const width = b.readUInt16LE(6), height = b.readUInt16LE(8), tableSize = 1 << ((b[10] & 7) + 1); let p = 13, palette = null, delay = 0, transparent = null, loop = null; const frames = [];
  if (b[10] & 128) { palette = b.subarray(p, p + tableSize * 3); p += tableSize * 3; }
  function blocks() { const a = []; while (b[p]) { const n = b[p++]; a.push(b.subarray(p, p + n)); p += n; } p++; return Buffer.concat(a); }
  function lzw(data, min) {
    const clear = 1 << min, end = clear + 1; let dictionary, size, next, previous = null, bit = 0; const output = [];
    function reset() { dictionary = Array.from({ length: clear }, (_, i) => [i]); size = min + 1; next = clear + 2; previous = null; }
    reset();
    while (bit + size <= data.length * 8) {
      let code = 0; for (let n = 0; n < size; n++, bit++) code |= (data[bit >>> 3] >>> (bit & 7) & 1) << n;
      if (code === clear) { reset(); continue; } if (code === end) break;
      const entry = dictionary[code] || (code === next && previous ? [...previous, previous[0]] : null); assert(entry, 'Valid standard GIF LZW code'); output.push(...entry);
      if (previous) { dictionary[next++] = [...previous, entry[0]]; if (next === 1 << size && size < 12) size++; } previous = entry;
    }
    return output;
  }
  while (b[p] !== 0x3b) {
    const marker = b[p++];
    if (marker === 0x21) {
      const label = b[p++]; if (label === 0xf9) { assert.equal(b[p++], 4); const flags = b[p++]; delay = b.readUInt16LE(p); p += 2; const index = b[p++]; transparent = flags & 1 ? index : null; assert.equal(flags >>> 2 & 7, 2); assert.equal(b[p++], 0); }
      else if (label === 0xff) { const n = b[p++], app = b.toString('ascii', p, p + n); p += n; const data = blocks(); if (app === 'NETSCAPE2.0') loop = data.readUInt16LE(1); }
      else blocks();
    } else {
      assert.equal(marker, 0x2c); const x = b.readUInt16LE(p), y = b.readUInt16LE(p + 2), w = b.readUInt16LE(p + 4), h = b.readUInt16LE(p + 6), flags = b[p + 8]; p += 9; assert.equal(x, 0); assert.equal(y, 0);
      let colors = palette; if (flags & 128) { const n = (1 << ((flags & 7) + 1)) * 3; colors = b.subarray(p, p + n); p += n; }
      const min = b[p++], indices = lzw(blocks(), min); assert.equal(indices.length, w * h); const rgba = new Uint8ClampedArray(w * h * 4);
      indices.forEach((index, at) => { if (index !== transparent) rgba.set([colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2], 255], at * 4); }); frames.push({ width: w, height: h, rgba, delay });
    }
  }
  return { width, height, frames, loop };
}
const progress = [];
const gif = await api.exportGIF(clip, { scale: 2, onProgress: event => progress.push(event) });
assert.equal(gif.type, 'image/gif'); assert.equal(gif.exportInfo.palette, 'exact'); assert.equal(gif.exportInfo.filename, 'A tiny adventure.gif');
const decoded = decodeGIF(await gif.arrayBuffer()); assert.equal(decoded.width, 8); assert.equal(decoded.height, 6); assert.equal(decoded.frames.length, 3); assert.equal(decoded.loop, 0);
for (let frame = 0; frame < 3; frame++) assert.deepEqual(decoded.frames[frame].rgba, frameCanvas(clip, frame, 2).pixels(), 'GIF exact palette preserves every RGB and transparent pixel');
assert.deepEqual(decoded.frames.map(frame => frame.delay), [8, 9, 8]); assert.equal(progress.at(-1).progress, 1);
const once = decodeGIF(await (await api.exportGIF({ ...clip, loop: 'once' })).arrayBuffer()); assert.equal(once.loop, null);
const pong = decodeGIF(await (await api.exportGIF({ ...clip, loop: 'pingpong' })).arrayBuffer()); assert.equal(pong.frames.length, 4); assert.deepEqual(pong.frames[3].rgba, frameCanvas(clip, 1, 1).pixels());
const long = { ...clip, width: 40, height: 30, duration: 2 };
const blocks = decodeGIF(await (await api.exportGIF(long)).arrayBuffer()); assert.equal(blocks.frames.length, 2, 'LZW clear blocks cross the 255-byte data boundaries correctly');
const gradient = { ...clip, width: 40, height: 30, duration: 1, transparent: false };
const quantized = await api.exportGIF(gradient, { renderFrame: async scene => frameCanvas(scene, 0, 1, true) });
assert.equal(quantized.exportInfo.palette, 'quantized'); assert.equal(quantized.exportInfo.exact, false); assert.match(quantized.exportInfo.note, /reduced 256-color/); assert.equal(decodeGIF(await quantized.arrayBuffer()).frames[0].rgba.length, 4800);
function patternedCanvas(c, frame, scale, noise = false) {
  const canvas = new Canvas(); canvas.width = c.width * scale; canvas.height = c.height * scale; const data = canvas.pixels(); let state = frame + 1;
  const colors = [[57, 120, 49], [82, 144, 57], [106, 161, 65], [139, 177, 82], [189, 161, 106], [205, 185, 131], [106, 82, 57], [57, 65, 82]];
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    let rgb;
    if (noise) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const value = state >>> 24; rgb = [value, value, value]; }
    else rgb = colors[((x >>> 4) + (y >>> 4) + (x >= 80 + frame * 2 && x < 96 + frame * 2 && y >= 60 && y < 84 ? 3 : 0)) % colors.length];
    data.set([...rgb, 255], (y * canvas.width + x) * 4);
  }
  return canvas;
}
const noiseClip = { ...clip, width: 256, height: 256, duration: 2, transparent: false };
const noiseGIF = await api.exportGIF(noiseClip, { renderFrame: async (scene, { scale }) => patternedCanvas(scene, scene.objects[0].frame, scale, true) });
assert.equal(noiseGIF.exportInfo.palette, 'exact');
const noiseDecoded = decodeGIF(await noiseGIF.arrayBuffer());
for (let i = 0; i < 2; i++) assert.deepEqual(noiseDecoded.frames[i].rgba, patternedCanvas(noiseClip, i, 1, true).pixels(), 'Dictionary growth and repeated 4096-entry clears preserve noisy pixel data');
const gameClip = { ...clip, width: 320, height: 240, duration: 4, transparent: false };
const gameGIF = await api.exportGIF(gameClip, { renderFrame: async (scene, { scale }) => patternedCanvas(scene, scene.objects[0].frame, scale) });
assert(gameGIF.size < gameClip.width * gameClip.height * gameClip.duration / 10, 'Dictionary compression makes repeated pixel-art backgrounds compact');
const gameDecoded = decodeGIF(await gameGIF.arrayBuffer());
for (let i = 0; i < 4; i++) assert.deepEqual(gameDecoded.frames[i].rgba, patternedCanvas(gameClip, i, 1).pixels());
const partial = await api.exportGIF({ ...clip, duration: 1 }, { renderFrame: async scene => frameCanvas(scene, 0, 1, false, 64) });
assert.equal(partial.exportInfo.partialAlphaReduced, true); assert.equal(partial.exportInfo.exact, false);
const framesBlob = await api.exportFrames(clip, { scale: 2 }), frames = await zipEntries(framesBlob);
assert.equal(frames.size, 6); const timing = JSON.parse(frames.get('animation.json'));
assert.equal(timing.fps, 12); assert.equal(timing.sources[0].contributors, 'Source contributor'); assert.equal(JSON.parse(frames.get('project.minish-animation.json')).format, 'minish-cap-animation');
for (let frame = 0; frame < 3; frame++) assert.deepEqual(decodePNG(frames.get('frames/frame-' + String(frame + 1).padStart(4, '0') + '.png')).rgba, frameCanvas(clip, frame, 2).pixels(), 'PNG sequence keeps exact original RGBA');
const sheetBlob = await api.exportSheet(clip, { scale: 2 }), sheets = await zipEntries(sheetBlob), map = JSON.parse(sheets.get('animation.json'));
for (const entry of map.entries) { const page = decodePNG(sheets.get(entry.file)), crop = new Uint8ClampedArray(entry.w * entry.h * 4); for (let y = 0; y < entry.h; y++) crop.set(page.rgba.subarray(((entry.y + y) * page.width + entry.x) * 4, ((entry.y + y) * page.width + entry.x + entry.w) * 4), y * entry.w * 4); assert.deepEqual(crop, frameCanvas(clip, entry.frame, 2).pixels(), 'Atlas coordinates reconstruct each exact frame'); }
const many = await api.exportSheet({ ...clip, width: 240, height: 160, duration: 600 });
assert(many.exportInfo.pages >= 2, 'Long sprite-sheet exports split into memory-bounded pages');
for (const invalid of [{ scale: 0 }, { scale: 1.5 }, { scale: 9 }]) await assert.rejects(api.exportGIF(clip, invalid), /integer enlargement/);
await assert.rejects(api.exportFrames({ ...clip, duration: 601 }), /1–600/);
await assert.rejects(api.exportGIF({ ...clip, width: 1024, height: 1024, duration: 600 }), /too large|too many pixels/);
await assert.rejects(api.generate(clip, { format: 'unknown' }), /Choose GIF/);
for (const method of ['exportGIF', 'exportFrames', 'exportSheet']) await assert.rejects(api[method](clip, { cancelled: () => true }), error => error.name === 'AbortError');
let cancel = false;
await assert.rejects(api.exportGIF(clip, { cancelled: () => cancel, onProgress: () => { cancel = true; } }), error => error.name === 'AbortError');
assert.equal(api.supportsVideo().supported, false);
await assert.rejects(api.exportVideo(clip), /GIF|PNG/);
const originalCreate = document.createElement;
document.createElement = () => ({ captureStream() {} });
window.MediaRecorder = class { static isTypeSupported(type) { return type === 'video/mp4' || type === 'video/webm'; } };
assert.equal(api.supportsVideo().container, 'mp4', 'MP4 is preferred only when the browser advertises support');
window.MediaRecorder.isTypeSupported = type => type === 'video/webm'; assert.equal(api.supportsVideo().container, 'webm');
document.createElement = originalCreate; delete window.MediaRecorder;
let stoppedTracks = 0;
const recordedCanvases = [];
Canvas.prototype.captureStream = function () { recordedCanvases.push(this); return { getTracks: () => [{ stop() { stoppedTracks++; } }] }; };
const priorGetContext = Canvas.prototype.getContext;
Canvas.prototype.getContext = function () { const ctx = priorGetContext.call(this); ctx.fillRect = () => { const color = ctx.fillStyle || '#000000', rgb = [1, 3, 5].map(i => Number.parseInt(color.slice(i, i + 2), 16)); const data = this.pixels(); for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i); }; return ctx; };
window.MediaRecorder = class {
  static isTypeSupported(type) { return type === 'video/mp4'; }
  constructor(_stream, options) { this.state = 'inactive'; this.mimeType = options.mimeType; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['recorded fixture'], { type: this.mimeType }) }); queueMicrotask(() => this.onstop?.()); }
};
const video = await api.exportVideo({ ...clip, width: 5, height: 3 });
assert.equal(video.type, 'video/mp4'); assert.equal(video.exportInfo.filename, 'A tiny adventure.mp4');
assert.equal(video.exportInfo.width, 6); assert.equal(video.exportInfo.height, 4); assert.equal(video.exportInfo.padding.right, 1); assert.equal(video.exportInfo.padding.bottom, 1); assert.equal(stoppedTracks, 1);
let videoCancelled = false;
await assert.rejects(api.exportVideo(clip, { cancelled: () => videoCancelled, onProgress: () => { videoCancelled = true; } }), error => error.name === 'AbortError');
assert.equal(stoppedTracks, 2, 'Cancelling recording releases every media track');
window.MediaRecorder.prototype.start = function () { throw new Error('encoder fixture failed'); };
await assert.rejects(api.exportVideo(clip), /encoder fixture failed.*PNG/); assert.equal(stoppedTracks, 3, 'Failed recording also releases its stream');
delete Canvas.prototype.captureStream; Canvas.prototype.getContext = priorGetContext; delete window.MediaRecorder;

// Pillow is an independent decoder when the local image environment is present.
const python = path.join(root, '.venv/bin/python');
if (fs.existsSync(python)) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'minish-animation-codec-'));
  try {
    fs.writeFileSync(path.join(folder, 'exact.gif'), Buffer.from(await gif.arrayBuffer()));
    fs.writeFileSync(path.join(folder, 'noise.gif'), Buffer.from(await noiseGIF.arrayBuffer()));
    fs.writeFileSync(path.join(folder, 'game.gif'), Buffer.from(await gameGIF.arrayBuffer()));
    for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(folder, 'noise-' + i + '.rgba'), patternedCanvas(noiseClip, i, 1, true).pixels());
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(folder, 'game-' + i + '.rgba'), patternedCanvas(gameClip, i, 1).pixels());
    const result = spawnSync(python, ['-c', "from PIL import Image\nimport sys\nim=Image.open(sys.argv[1]); assert im.size==(8,6); assert im.n_frames==3\nfor i in range(3):\n im.seek(i); frame=im.convert('RGBA'); assert frame.getpixel((i*2,0))==[(255,0,0,255),(0,255,0,255),(0,0,255,255)][i]; assert frame.getpixel((7,5))[3]==0\n\nfrom pathlib import Path\np=Path(sys.argv[1]).parent\nfor name,count in [('noise',2),('game',4)]:\n im=Image.open(p/(name+'.gif')); assert im.n_frames==count\n for i in range(count):\n  im.seek(i); assert im.convert('RGBA').tobytes()==(p/(name+'-'+str(i)+'.rgba')).read_bytes()\nprint('Independent Pillow GIF pixel/timing/dictionary decode passed.')", path.join(folder, 'exact.gif')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); process.stdout.write(result.stdout);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}
console.log('GIF compression fixture: ' + gameGIF.size + ' bytes for four 320×240 pixel-art frames.');
console.log('PASS: exact RGBA PNG sequences and paged atlases, valid GIF colors/transparency/timing/loops/LZW, explicit palette reduction, cancellation, export limits, source credits, and MP4/WebM capability detection.');
