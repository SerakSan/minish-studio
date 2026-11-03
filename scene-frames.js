(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MINISH_FRAMES = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // New editor artwork, inspired by Zelda worlds, items and menu borders.
  // These patterns are not extracted sprites or game animation frames.
  const definitions = [
    {
      id: 'minish-woodland', label: 'Minish woodland',
      description: 'Sage-green trim, warm gold and little leaf details.',
      colors: ['#142e37', '#355a48', '#8da66a', '#e5dbac', '#d4ae58'],
      rim: [0, 1, 4, 3, 2, 1, 0],
      corner: ['0011100', '0144410', '1422241', '1423241', '1422241', '0144410', '0011100'],
      edge: ['02200', '23320', '02200']
    },
    {
      id: 'hyrule-royal', label: 'Royal Hyrule',
      description: 'Lavender stone, gold links and a ruby in each corner.',
      colors: ['#251f3b', '#5e587b', '#b4a8c9', '#fff0b5', '#d8b65c', '#a94d69'],
      rim: [0, 2, 1, 4, 3, 1, 0],
      corner: ['0000000', '0444440', '0433340', '0435340', '0433340', '0444440', '0000000'],
      edge: ['44344', '43034', '44344']
    },
    {
      id: 'dream-island', label: 'Dream island',
      description: 'Four-tone handheld greens with a checkered inner trim.',
      colors: ['#173c35', '#476c43', '#8fae60', '#d3dfa0'],
      rim: [0, 3, 1, 2, 3, 1, 0],
      corner: ['0000000', '0333330', '0311130', '0312130', '0311130', '0333330', '0000000'],
      edge: ['23232', '32323', '23232']
    },
    {
      id: 'classic-gold', label: 'Classic gold',
      description: 'Chunky 8-bit gold, dark red outlines and square knots.',
      colors: ['#351b24', '#7b4431', '#c68b3b', '#ffe6a0', '#ae5341'],
      rim: [0, 1, 2, 3, 2, 1, 0],
      corner: ['0011100', '0122210', '1233321', '1234321', '1233321', '0122210', '0011100'],
      edge: ['22222', '21312', '22222']
    },
    {
      id: 'oracle-jewel', label: 'Oracle jewel',
      description: 'Blue-green rails, gold highlights and pink crystal details.',
      colors: ['#192c4b', '#406581', '#68b6b4', '#d8edcd', '#dabd72', '#b8669d'],
      rim: [0, 1, 4, 3, 2, 1, 0],
      corner: ['0001000', '0012100', '0123210', '1235321', '0123210', '0012100', '0001000'],
      edge: ['00200', '03530', '00200']
    },
    {
      id: 'sacred-triforce', label: 'Sacred Triforce',
      description: 'Three golden triangles, emerald rails and a little Hyrule legend in every corner.',
      units: 11, pitch: 24,
      colors: ['#172b28', '#355a48', '#7b7439', '#ffe7a0', '#c69a39'],
      rim: [0, 1, 2, 4, 3, 4, 2, 1, 2, 1, 0],
      corner: ['00000000000','00000400000','00004440000','00043334000','00000000000','00040004000','00444044400','04333433340','00000000000','00000000000','00000000000'],
      edge: ['00000400000','00004440000','00043334000','00000000000','00040004000','00444044400','04333433340']
    },
    {
      id: 'fairy-fountain', label: 'Fairy fountain',
      description: 'Ocarina of Time-inspired fairy wings, soft violet water and white starbursts.',
      units: 11, pitch: 22,
      colors: ['#24223f', '#665780', '#81ced0', '#fff5dc', '#d6a2d1', '#a6e9e0'],
      rim: [0, 1, 4, 1, 2, 5, 3, 5, 2, 1, 0],
      corner: ['00000000000','00220004400','02552041440','02555244440','00255344400','00023334000','00255344400','02555244440','02552041440','00220004400','00000000000'],
      edge: ['0003000','0003000','0033300','3333333','0033300','0003000','0003000']
    },
    {
      id: 'lost-woods', label: 'Lost Woods',
      description: 'Leafy vines, curled roots and forest greens inspired by the Lost Woods and Kokiri Forest.',
      units: 11, pitch: 20,
      colors: ['#162c26', '#3c4d2b', '#6d8750', '#c2d788', '#a27d42', '#53764c'],
      rim: [0, 1, 4, 1, 5, 2, 3, 2, 5, 1, 0],
      corner: ['00004000000','00004400000','00224400000','02332402200','02332423320','00224423320','00044502200','00444550000','04440555000','04400055000','00000000000'],
      edge: ['002200000','023320000','023320220','002242332','000442332','000044220','000004400']
    },
    {
      id: 'great-sea', label: 'Great Sea',
      description: 'Wind Waker-inspired waves, white sails and gold compass points for an ocean adventure.',
      units: 11, pitch: 24,
      colors: ['#102e4b', '#23668a', '#49aaa9', '#f0edd2', '#d2ad5b', '#9bdfcb'],
      rim: [0, 1, 2, 5, 3, 5, 2, 1, 4, 1, 0],
      corner: ['00000400000','00004340000','00043334000','00433333400','04333333340','00000400000','02222222220','23555555532','23500000532','02355555320','00222222200'],
      edge: ['00022200000','00255320000','02333320022','02300020253','00222222333','00000022000','22222220000']
    },
    {
      id: 'twilight-mirror', label: 'Twilight mirror',
      description: 'Twilight Princess-inspired mirror shards, angular turquoise runes and a dark silver rim.',
      units: 11, pitch: 24,
      colors: ['#151e2d', '#3b4256', '#6f808c', '#c9dccb', '#5ed4ce', '#347f8c'],
      rim: [0, 1, 2, 1, 5, 4, 3, 4, 5, 1, 0],
      corner: ['00000400000','00004540000','00045354000','00453035400','04530003540','45300200354','04530003540','00453035400','00045354000','00004540000','00000400000'],
      edge: ['440004400','044004040','004440040','000040040','004444440','004000040','004444400']
    },
    {
      id: 'moonlit-mask', label: 'Moonlit mask',
      description: "Majora's Mask-inspired heart masks, glowing green eyes and a violet carnival trim.",
      units: 11, pitch: 24,
      colors: ['#271f3b', '#613466', '#b05d83', '#f1ba68', '#c15d40', '#bcd97b', '#5b8099'],
      rim: [0, 1, 2, 3, 4, 1, 6, 3, 2, 1, 0],
      corner: ['00030003000','03043034030','00444444400','04414441440','04255255240','04251215240','00422122400','03044244030','00004440000','00030403000','00000000000'],
      edge: ['003000300','032303230','002444200','024555420','002454200','000242000','000020000']
    },
    {
      id: 'sheikah-eye', label: 'Sheikah eye',
      description: 'A Sheikah eye, a single red tear and indigo cloth inspired by Ocarina of Time.',
      units: 11, pitch: 24,
      colors: ['#192238', '#35466c', '#7e93b1', '#ece9d2', '#ad4e58', '#486e8b'],
      rim: [0, 1, 2, 1, 3, 5, 3, 1, 2, 1, 0],
      corner: ['00030303000','00300000300','00033333000','00333233300','03332023330','00333233300','00033333000','00000400000','00004440000','00000400000','00000000000'],
      edge: ['0003000','0033300','0332330','0033300','0004000','0044400','0004000']
    },
    {
      id: 'dungeon-keys', label: 'Dungeon keys',
      description: 'A Link to the Past-inspired stone blocks, iron chain links and a golden dungeon key.',
      units: 11, pitch: 22,
      colors: ['#252b34', '#4b5862', '#7d8c8e', '#c2c5a7', '#d7ab54', '#f8dda0'],
      rim: [0, 1, 2, 3, 2, 1, 0, 1, 2, 1, 0],
      corner: ['00004440000','00045554000','00045054000','00045554000','00004440000','00000400000','00000400000','00000444000','00000400000','00000444000','00000000000'],
      edge: ['00222002220','02333223332','02303223032','02333223332','00222002220','00000000000','11101110111']
    },
    {
      id: 'heart-containers', label: 'Heart containers',
      description: 'Ruby heart containers, little life-meter hearts and cream-and-gold Zelda menu trim.',
      units: 11, pitch: 22,
      colors: ['#392637', '#824958', '#c15c66', '#fff0c8', '#d0a762', '#ef9c8c'],
      rim: [0, 1, 4, 3, 4, 1, 3, 4, 1, 4, 0],
      corner: ['00000000000','00333033300','03444344430','34225422543','34222222243','03422222430','00342224300','00034243000','00003430000','00000300000','00000000000'],
      edge: ['0220220','2552552','2522222','0222220','0022200','0002000','0000000']
    },
    {
      id: 'rupee-treasure', label: 'Rupee treasure',
      description: 'A treasure chest of green, blue and red rupees set into dark wood and golden rails.',
      units: 11, pitch: 22,
      colors: ['#282a31', '#65503c', '#ae8847', '#f4dca0', '#41906c', '#8ed69b', '#4c8eb8', '#a6dbe2', '#bf6070', '#efa6a1'],
      rim: [0, 1, 2, 3, 2, 1, 2, 1, 2, 1, 0],
      corner: ['00003330000','00034443000','00345544300','03445544430','03445454430','03445454430','03445454430','00344444300','00034443000','00003330000','00000000000'],
      edge: ['04400660088','45546776899','45446766898','45446766898','04400660088','00000000000','23223223223']
    },
    {
      id: 'oracle-seasons', label: 'Oracle seasons',
      description: 'Oracle of Seasons-inspired spring flowers, summer leaves, autumn gold and winter snow.',
      units: 11, pitch: 24,
      colors: ['#273a36', '#59764a', '#a2bb67', '#fff0c5', '#cd8c4a', '#e8aec3', '#73a6c4', '#d5e9e2'],
      rim: [0, 1, 2, 3, 4, 1, 2, 7, 6, 1, 0],
      corner: ['00000500000','00005550000','00005550000','00555355500','05553335550','00555355500','00005550000','00001500000','00011200000','00112200000','00000000000'],
      cornerVariants: [
        ['00000500000','00005550000','00005550000','00555355500','05553335550','00555355500','00005550000','00001500000','00011200000','00112200000','00000000000'],
        ['00000222000','00002333200','00023333200','00233333200','02333222000','02332200000','00221000000','00011000000','00110000000','01100000000','00000000000'],
        ['00000400000','00004440000','00444444400','00043334000','00433333400','00043334000','00444444400','00004440000','00000400000','00000400000','00000000000'],
        ['00000700000','00700700700','00070707000','00007770000','07777777770','00007770000','00070707000','00700700700','00000700000','00000000000','00000000000']
      ],
      edge: ['00220007700','02332076760','00220007700','00000400000','00004440000','00000400000','00000000000']
    },
    {
      id: 'spirit-tracks', label: 'Spirit Tracks',
      description: 'Spirit Tracks-inspired iron rails, wooden sleepers and copper clockwork in the corners.',
      units: 11, pitch: 16,
      colors: ['#24313a', '#56666d', '#a5b3ad', '#e0d7ad', '#97724d', '#c6a06a'],
      rim: [0, 4, 5, 4, 1, 3, 2, 1, 5, 4, 0],
      corner: ['00005550000','00555455500','05544444550','05443334450','54433033445','54430303445','54433033445','05443334450','05544444550','00555455500','00005550000'],
      edge: ['0044400','1154511','2235322','1154511','0044400','0044400','0055500']
    }
  ];
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const styles = Object.freeze(definitions.map(({ id, label, description }) => Object.freeze({ id, label, description })));
  const MAX_SIZE = 8, MAX_EDGE = 32768, MAX_POSITION = 16777216;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function numeric(value, fallback) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : fallback;
  }
  function normalize(value) {
    const config = typeof value === 'string' ? { style: value } : value && typeof value === 'object' ? value : {};
    const style = typeof config.style === 'string' && byId.has(config.style) ? config.style : 'none';
    return { style, size: clamp(Math.round(numeric(config.size, 0)), 0, MAX_SIZE) };
  }
  function measure(options = {}) {
    options = options && typeof options === 'object' ? options : {};
    const config = normalize(options), w = clamp(Math.round(numeric(options.w, 0)), 0, MAX_EDGE), h = clamp(Math.round(numeric(options.h, 0)), 0, MAX_EDGE);
    const x = clamp(Math.round(numeric(options.x, 0)), -MAX_POSITION, MAX_POSITION), y = clamp(Math.round(numeric(options.y, 0)), -MAX_POSITION, MAX_POSITION);
    const short = Math.min(w, h);
    const preferred = config.size || clamp(Math.round(short / 160), 1, MAX_SIZE);
    const units = byId.get(config.style)?.units || 7;
    const cell = Math.min(preferred, Math.max(1, Math.floor(short / (units * 3))));
    const border = config.style === 'none' || short < 3 ? 0 : Math.min(units * cell, Math.floor(short / 3));
    return { ...config, x, y, w, h, cell, border };
  }
  function draw(ctx, options = {}) {
    const metrics = measure(options), definition = byId.get(metrics.style);
    if (!ctx || typeof ctx.fillRect !== 'function' || !definition || !metrics.border) return { ...metrics, drawn: false };
    const { x, y, w, h, cell, border } = metrics;
    const right = x + w, bottom = y + h;
    const inner = { left: x + border, top: y + border, right: right - border, bottom: bottom - border };
    let rectangles = 0;

    // Every decorative mark is clipped to the rim, keeping the whole center
    // transparent even on unusually small or narrow picture rectangles.
    function paint(rx, ry, rw, rh, color) {
      const left = Math.max(x, Math.round(rx)), top = Math.max(y, Math.round(ry));
      const r = Math.min(right, Math.round(rx + rw)), b = Math.min(bottom, Math.round(ry + rh));
      if (left >= r || top >= b) return;
      ctx.fillStyle = color;
      function rectangle(l, t, rr, bb) {
        if (rr > l && bb > t) { ctx.fillRect(l, t, rr - l, bb - t); rectangles++; }
      }
      rectangle(left, top, r, Math.min(b, inner.top));
      rectangle(left, Math.max(top, inner.bottom), r, b);
      const midTop = Math.max(top, inner.top), midBottom = Math.min(b, inner.bottom);
      if (midTop < midBottom) {
        rectangle(left, midTop, Math.min(r, inner.left), midBottom);
        rectangle(Math.max(left, inner.right), midTop, r, midBottom);
      }
    }
    function pixel(px, py, colorIndex) {
      const color = definition.colors[Number(colorIndex)];
      if (color) paint(px, py, cell, cell, color);
    }
    function corners() {
      if (definition.cornerVariants) {
        definition.cornerVariants.forEach((pattern, index) => {
          for (let row = 0; row < pattern.length; row++) for (let col = 0; col < pattern[row].length; col++) {
            pixel(index % 2 ? right - (col + 1) * cell : x + col * cell, index > 1 ? bottom - (row + 1) * cell : y + row * cell, pattern[row][col]);
          }
        });
        return;
      }
      for (let row = 0; row < definition.corner.length; row++) {
        for (let col = 0; col < definition.corner[row].length; col++) {
          const color = definition.corner[row][col];
          pixel(x + col * cell, y + row * cell, color);
          pixel(right - (col + 1) * cell, y + row * cell, color);
          pixel(x + col * cell, bottom - (row + 1) * cell, color);
          pixel(right - (col + 1) * cell, bottom - (row + 1) * cell, color);
        }
      }
    }
    function edgePattern(length, vertical) {
      const pattern = definition.edge, patternWidth = pattern[0].length * cell;
      const available = length - 2 * border;
      if (border < 5 * cell || available < patternWidth + 4 * cell) return;
      let pitch = (definition.pitch || 16) * cell;
      const naturalCount = Math.max(1, Math.floor((available - 4 * cell) / pitch));
      // Bigger illustrated motifs stay evenly spaced and inexpensive on atlases.
      // The original five borders retain their exact repeat positions.
      const count = definition.units ? Math.min(128, naturalCount) : naturalCount;
      if (count < naturalCount && count > 1) pitch = Math.floor((available - 4 * cell - patternWidth) / (count - 1) / cell) * cell;
      const start = border + Math.floor((available - ((count - 1) * pitch + patternWidth)) / 2);
      for (let n = 0; n < count; n++) {
        const offset = start + n * pitch;
        for (let row = 0; row < pattern.length; row++) for (let col = 0; col < pattern[row].length; col++) {
          const along = offset + col * cell, depth = (row + 2) * cell, color = pattern[row][col];
          if (vertical) {
            pixel(x + depth, y + along, color);
            pixel(right - depth - cell, y + along, color);
          } else {
            pixel(x + along, y + depth, color);
            pixel(x + along, bottom - depth - cell, color);
          }
        }
      }
    }
    ctx.save();
    try {
      ctx.imageSmoothingEnabled = false;
      for (let depth = 0; depth < border; depth += cell) {
        const thickness = Math.min(cell, border - depth);
        const colorIndex = definition.rim[Math.min(definition.rim.length - 1, Math.floor(depth / cell))];
        const color = definition.colors[colorIndex];
        paint(x + depth, y + depth, w - depth * 2, thickness, color);
        paint(x + depth, bottom - depth - thickness, w - depth * 2, thickness, color);
        paint(x + depth, y + depth, thickness, h - depth * 2, color);
        paint(right - depth - thickness, y + depth, thickness, h - depth * 2, color);
      }
      edgePattern(w, false);
      edgePattern(h, true);
      corners();
    } finally {
      ctx.restore();
    }
    return { ...metrics, drawn: rectangles > 0 };
  }
  return Object.freeze({ styles, normalize, measure, draw, maxSize: MAX_SIZE });
});
