import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(root, 'scene-frames.js'), 'utf8'), sandbox, { filename: 'scene-frames.js' });
const frames = sandbox.MINISH_FRAMES;
assert.equal(frames.styles.length, 17);
assert.equal(new Set(frames.styles.map(style => style.id)).size, 17);
assert(Object.isFrozen(frames.styles));
const originalFrames = new Map([
  ['minish-woodland', '930bc45ab16f3ca0b0a2b878bd9302c8261df52367e8b89d9df448372b8072b2'],
  ['hyrule-royal', 'a790b83386917f7b4febd139e0950302d2f15b3c254860670319b397111559cf'],
  ['dream-island', 'c75d65de21e6055a3ec4119dca71e2ff0617e5cd04c53c8a8b09e9c1d97fca83'],
  ['classic-gold', 'e73458293569ed24a951ff28e3497c7f6ffab5976a5bdc0487bf80980e5af8cd'],
  ['oracle-jewel', '430f7048af63eba3ae20a37716c8174ac25d760bb068079523ff8970e4c4df9c'],
]);

class RecordingContext {
  constructor() { this.fillStyle = '#abcdef'; this.imageSmoothingEnabled = true; this.globalAlpha = 0.625; this.stack = []; this.rectangles = []; }
  save() { this.stack.push({ fillStyle: this.fillStyle, imageSmoothingEnabled: this.imageSmoothingEnabled, globalAlpha: this.globalAlpha }); }
  restore() { Object.assign(this, this.stack.pop()); }
  fillRect(x, y, w, h) {
    assert([x, y, w, h].every(Number.isSafeInteger), 'Pixel frame geometry uses whole native pixels');
    assert(w > 0 && h > 0);
    assert.equal(this.imageSmoothingEnabled, false);
    assert.equal(this.globalAlpha, 0.625, 'Frame respects caller opacity');
    this.rectangles.push({ x, y, w, h, color: this.fillStyle });
  }
}
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(frames.normalize()), { style: 'none', size: 0 });
assert.deepEqual(plain(frames.normalize('classic-gold')), { style: 'classic-gold', size: 0 });
assert.deepEqual(plain(frames.normalize({ style: '__proto__', size: Infinity })), { style: 'none', size: 0 });
assert.equal(frames.normalize({ style: 'minish-woodland', size: 50000 }).size, 8);
assert.equal(frames.normalize({ style: 'minish-woodland', size: -50000 }).size, 0);
assert.equal(frames.normalize({ style: 'minish-woodland', size: Symbol('invalid') }).size, 0);
assert.equal(frames.normalize({ style: 'minish-woodland', size: '3.7' }).size, 4);

const fingerprints = new Set();
const motifFingerprints = new Set();
for (const style of frames.styles) {
  assert(style.label && style.description && !style.label.includes('—') && !style.description.includes('—'));
  for (const [w, h] of [[3, 3], [4, 101], [16, 16], [16, 8192], [8192, 16], [216, 270], [270, 270], [216, 384], [240, 160], [731, 287], [4992, 3168], [8192, 8192]]) {
    for (const size of [0, 1, 4, 8]) {
      const ctx = new RecordingContext(), metrics = frames.draw(ctx, { style: style.id, size, x: -17.4, y: 9.8, w, h });
      assert(metrics.drawn);
      assert.equal(metrics.x, -17); assert.equal(metrics.y, 10);
      assert.equal(ctx.stack.length, 0);
      assert.equal(ctx.fillStyle, '#abcdef'); assert.equal(ctx.imageSmoothingEnabled, true); assert.equal(ctx.globalAlpha, 0.625);
      assert(ctx.rectangles.length < 40000, 'Border rendering is bounded for large maps');
      const il = metrics.x + metrics.border, it = metrics.y + metrics.border;
      const ir = metrics.x + w - metrics.border, ib = metrics.y + h - metrics.border;
      for (const r of ctx.rectangles) {
        assert(r.x >= metrics.x && r.y >= metrics.y && r.x + r.w <= metrics.x + w && r.y + r.h <= metrics.y + h, 'Ornaments stay inside their picture/canvas');
        assert(r.x + r.w <= il || r.x >= ir || r.y + r.h <= it || r.y >= ib, 'The whole content interior remains transparent');
      }
    }
  }
  const first = new RecordingContext(), second = new RecordingContext();
  frames.draw(first, { style: style.id, w: 216, h: 270 });
  frames.draw(second, { style: style.id, w: 216, h: 270 });
  assert.deepEqual(first.rectangles, second.rectangles, 'Frame layout is deterministic');
  fingerprints.add(JSON.stringify(first.rectangles));
  const legacy = originalFrames.get(style.id);
  if (legacy) {
    const encoded = first.rectangles.map(({ x, y, w, h, color }) => [x, y, w, h, color]);
    assert.equal(createHash('sha256').update(JSON.stringify(encoded)).digest('hex'), legacy, 'The original five frame drawings stay exactly unchanged');
  } else {
    const palette = new Map();
    const motif = first.rectangles.map(({ color, ...rect }) => { if (!palette.has(color)) palette.set(color, palette.size); return { ...rect, ink: palette.get(color) }; });
    motifFingerprints.add(JSON.stringify(motif));
  }
}
assert.equal(fingerprints.size, 17, 'Each frame style has a distinct palette/pattern');
assert.equal(motifFingerprints.size, 12, 'All twelve new designs use distinct pixel motifs rather than palette swaps');

for (const style of frames.styles.slice(5)) {
  const ctx = new RecordingContext();
  const metrics = frames.draw(ctx, { style: style.id, w: 32768, h: 32768, size: 1 });
  assert.equal(metrics.border, 11);
  assert(ctx.rectangles.length < 40000, 'Illustrated motifs stay bounded even at the maximum supported image size');
}

for (const options of [null, false, {}, { style: 'none', w: 240, h: 160 }, { style: 'classic-gold', w: 0, h: 0 }, { style: 'classic-gold', w: 1, h: 300 }, { style: 'classic-gold', w: Infinity, h: 999999 }, { style: 'classic-gold', w: NaN, h: 3 }]) {
  const ctx = new RecordingContext();
  assert.equal(frames.draw(ctx, options).drawn, false);
  assert.equal(ctx.rectangles.length, 0);
  assert.equal(ctx.stack.length, 0);
}
const large = new RecordingContext();
const largeMetrics = frames.draw(large, { style: 'classic-gold', w: 1e100, h: 1e100, x: -1e100, y: 1e100, size: 1 });
assert.equal(largeMetrics.w, 32768); assert.equal(largeMetrics.h, 32768);
assert(large.rectangles.length < 150000);
assert.equal(frames.draw(null, { style: 'classic-gold', w: 240, h: 160 }).drawn, false);

const throwing = new RecordingContext();
throwing.fillRect = () => { throw new Error('drawing interrupted'); };
assert.throws(() => frames.draw(throwing, { style: 'minish-woodland', w: 240, h: 160 }), /drawing interrupted/);
assert.equal(throwing.stack.length, 0);
assert.equal(throwing.fillStyle, '#abcdef'); assert.equal(throwing.imageSmoothingEnabled, true);
console.log('PASS: 17 pixel-frame styles, 12 distinct illustrated themes, unchanged original borders, all ratios, transparent interiors, integer geometry, bounded rendering, deterministic layout and context restoration.');
