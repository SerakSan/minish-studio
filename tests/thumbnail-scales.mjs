import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The shared layout policy initializes without starting either editor.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'library.js'), 'utf8'), sandbox);
const layout = sandbox.window.MINISH_THUMBNAILS.layout;
const curated = JSON.parse(fs.readFileSync(path.join(root, 'assets/curated.json'), 'utf8'));
const oraclePoses = curated.sheets['24932'].pieces.filter(piece => Math.max(piece.sw, piece.sh) <= 32);
const tinyLink = curated.sheets['19728'].pieces.filter(piece => piece.group === 'Tiny Link');
const tinyLayouts = tinyLink.map(piece => layout(piece.sw, piece.sh, 64, 64, 3, piece.previewBox));
assert.equal(tinyLink.length, 95);
assert.equal(new Set(tinyLayouts.map(box => box.scale)).size, 1, 'All genuine tiny Link bodies share the same preview scale');
assert(tinyLayouts.every(box => box.scale >= 4), 'The actual tiny Link bodies remain legible in the collection');
assert(oraclePoses.length > 10 && new Set(oraclePoses.map(piece => piece.sw + 'x' + piece.sh)).size > 3, 'Exercise differently sized real Oracle crops');
for (const [width, height, padding] of [[64, 64, 3], [70, 60, 2], [64, 48, 2], [76, 76, 3]]) {
  const scales = oraclePoses.map(piece => layout(piece.sw, piece.sh, width, height, padding).scale);
  assert.equal(new Set(scales).size, 1, 'Comparable Oracle poses use one native pixel scale in each preview');
  const small = layout(2, 7, width, height, padding), full = layout(14, 23, width, height, padding);
  assert.equal(small.scale, full.scale, 'Tiny detached pieces do not inflate to match a whole character');
  assert(small.height < full.height && small.width < full.width);
}
for (const [a, b, band] of [[[24, 32], [16, 25], 32], [[40, 50], [64, 33], 64], [[80, 100], [127, 70], 128]]) {
  const first = layout(...a, 76, 76), second = layout(...b, 76, 76);
  assert.equal(first.band, band); assert.equal(second.band, band); assert.equal(first.scale, second.scale, 'Each native-size band has a stable preview scale');
}
const dimensions = [2, 7, 14, 23, 32, 33, 64, 65, 128, 129, 240, 512];
for (const [width, height, padding] of [[64, 64, 3], [70, 60, 2], [64, 48, 2], [39, 36, 1], [90, 78, 3], [130, 82, 3]]) {
  for (const sw of dimensions) for (const sh of dimensions) {
    const box = layout(sw, sh, width, height, padding);
    assert(box.x >= padding && box.y >= padding && box.x + box.width <= width - padding && box.y + box.height <= height - padding, 'Every complete crop stays inside its preview');
    assert(Number.isInteger(box.x) && Number.isInteger(box.y) && Number.isInteger(box.width) && Number.isInteger(box.height), 'Draw destinations use whole raster pixels');
    if (box.scale >= 1) assert(Number.isInteger(box.scale), 'Enlargements use whole-number magnification');
  }
}
const huge = layout(1280, 512, 130, 82);
assert.equal(huge.band, null); assert.equal(huge.width, 124); assert(huge.height <= 76, 'Large environments fit in full');
for (const invalid of [[0, 10], [10, -1], [NaN, 5], [Infinity, 5]]) assert.equal(layout(...invalid, 64, 64), null);
const scripts = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<script\b[^>]*src="([^"?]+)/g)].map(match => match[1]);
assert(scripts.indexOf('library.js') < scripts.indexOf('animation-ui.js'), 'The shared thumbnail policy loads before Animate');
console.log('PASS: shared native-size thumbnail bands, consistent Oracle and tiny-part scales, full-art fitting, integer enlargement, and centered unclipped raster bounds.');
