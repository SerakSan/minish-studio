(() => {
  'use strict';

  // The map catalog supplies visually reviewed placement areas. These are
  // editor composition guides, not collision information extracted from ROM.
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  function hash(text) {
    let value = 2166136261;
    for (const character of String(text)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
    return value >>> 0;
  }
  function randomFor(seed) {
    let value = hash(seed);
    return () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let next = Math.imul(value ^ value >>> 15, value | 1);
      next ^= next + Math.imul(next ^ next >>> 7, next | 61);
      return ((next ^ next >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffled(values, random) {
    const result = [...values];
    for (let n = result.length - 1; n > 0; n--) {
      const index = Math.floor(random() * (n + 1));
      [result[n], result[index]] = [result[index], result[n]];
    }
    return result;
  }
  const choose = (values, random) => values[Math.floor(random() * values.length)];

  // These whole-pose ranges are shared with the reviewed small-scene cast.
  // Sampling every connected component would include detached sprite parts.
  const CAST = {
    link: ['6369', [[28, 37]]], tinyLink: ['19728', [[1, 95]]],
    ezlo: ['6373', [[1, 6]]], vaati: ['6530', [[4, 6]]],
    blade: ['6396', [[2, 3], [9, 10]]], mountainMinish: ['6394', [[1, 4]]], townMinish: ['6393', [[11, 14]]],
    boy: ['6379', [[1, 3], [16, 18]]], girl: ['6379', [[4, 6], [19, 21], [28, 30]]],
    vendor: ['6379', [[7, 15], [22, 27]]], gentleman: ['6381', [[1, 12]]],
    bandana: ['6381', [[13, 24]]], brunette: ['6381', [[25, 36]]], blonde: ['6381', [[37, 48]]],
    smith: ['6377', [[1, 2]]], carpenter: ['6384', [[1, 2]]],
    cat: ['6402', [[1, 4]]], dog: ['6400', [[1, 3]]],
    cucco: ['6403', [[1, 14]]], zelda: ['22716', [[1, 10]]], king: ['6375', [[2, 9]]],
    guard: ['6391', [[1, 13]]], festari: ['6392', [[1, 9]]],
    gentari: ['6392', [[10, 18]]], forestMinish: ['6392', [[22, 38]]],
    din: ['24932', [[1, 6]]], nayru: ['24932', [[7, 11]]], farore: ['24932', [[12, 16]]],
    octorok: ['6504', [[1, 4], [9, 12]]], rope: ['6517', [[1, 8]]],
    keese: ['6475', [[1, 6]]], puffstool: ['6512', [[1, 4], [6, 8]]],
    pesto: ['6511', [[7, 13]]], chest: ['6514', [[6, 8]]]
  };
  const PEOPLE = ['boy', 'girl', 'vendor', 'gentleman', 'bandana', 'brunette', 'blonde'];
  const ARMED_CAST = { moblin: '6556', darknut: '64168', stalfos: '6524', keaton: '6472' };
  const RECIPES = [
    { id: 'cucco-escort', name: 'The royal Cucco escort', themes: ['town', 'castle', 'field', 'ranch'], cast: ['king', 'cucco', 'cucco', 'guard'] },
    { id: 'oracle-reunion', name: 'The Oracles took a day off', themes: ['town', 'field', 'woods', 'lake'], cast: ['din', 'nayru', 'farore'] },
    { id: 'lost-carpenters', name: 'The very lost work crew', themes: ['town', 'field', 'mountain', 'ruins'], cast: ['smith', 'carpenter', 'dog'] },
    { id: 'cat-court', name: 'The cats run this kingdom', themes: ['town', 'castle', 'field'], cast: ['king', 'cat', 'cat', 'cat'] },
    { id: 'cucco-parade', name: 'A parade with no permit', themes: ['town', 'field', 'ranch'], cast: ['cucco', 'cucco', 'cucco', 'cucco', 'cucco'] },
    { id: 'picnic', name: 'A treasure chest picnic', themes: ['field', 'woods', 'lake', 'ranch'], cast: ['zelda', 'link', 'chest', 'dog'] },
    { id: 'minish-meeting', name: 'A tiny secret meeting', themes: ['woods', 'field', 'ruins'], cast: ['festari', 'gentari', 'forestMinish'] },
    { id: 'cucco-standoff', name: 'Link considers his choices', themes: ['field', 'ranch', 'town'], cast: ['link', 'cucco', 'cucco', 'cucco'] },
    { id: 'guard-break', name: 'The guards are on a break', themes: ['castle', 'town', 'field'], cast: ['guard', 'guard', 'cat'] },
    { id: 'pet-adventure', name: 'The pets found the treasure', themes: ['field', 'woods', 'town'], cast: ['cat', 'dog', 'chest'] },
    { id: 'monster-meeting', name: 'A very serious monster meeting', themes: ['woods', 'field', 'ruins', 'mountain'], cast: ['octorok', 'puffstool', 'rope'] },
    { id: 'winged-escort', name: 'The wrong sort of bodyguards', themes: ['woods', 'field', 'ruins'], cast: ['link', 'keese', 'pesto'] },
    { id: 'treasure-queue', name: 'Please wait your turn', themes: ['town', 'field', 'ruins'], cast: ['chest', 'person', 'person', 'person'] },
    { id: 'forest-class', name: 'A class outside the classroom', themes: ['woods', 'field', 'ranch'], cast: ['gentari', 'boy', 'girl', 'forestMinish'] },
    { id: 'royal-detour', name: 'The royal scenic route', themes: ['field', 'castle', 'mountain', 'lake'], cast: ['zelda', 'king', 'guard'] },
    { id: 'smith-security', name: 'Workshop security is improving', themes: ['town', 'field', 'mountain'], cast: ['smith', 'carpenter', 'cucco', 'cucco'] },
    { id: 'octorok-hoard', name: 'The Octorok treasure club', themes: ['field', 'woods', 'lake', 'ruins'], cast: ['chest', 'octorok', 'octorok'] },
    { id: 'minish-tour', name: 'A tour with questionable directions', themes: ['field', 'woods', 'town', 'mountain'], cast: ['link', 'forestMinish', 'dog'] },
    { id: 'tiny-link-secret', name: 'A very small treasure hunter', themes: ['field', 'woods', 'ranch'], cast: ['tinyLink', 'chest'] },
    { id: 'zelda-cucco', name: 'Royal poultry business', themes: ['castle', 'town', 'ranch', 'field'], cast: ['zelda', 'cucco'] },
    { id: 'pet-conspiracy', name: 'The pets have a plan', themes: ['town', 'field', 'woods', 'ranch'], cast: ['cat', 'dog'] },
    { id: 'smith-link', name: 'A sword warranty discussion', themes: ['town', 'field', 'mountain'], cast: ['smith', 'link'] },
    { id: 'guard-cat', name: 'The smallest captain', themes: ['castle', 'town', 'field'], cast: ['guard', 'cat'] },
    { id: 'dog-chest', name: 'A very good treasure hunter', themes: ['field', 'woods', 'ruins', 'ranch'], cast: ['dog', 'chest'] },
    { id: 'lost-link', name: 'This was definitely the shortcut', themes: ['field', 'woods', 'mountain', 'ruins', 'lake'], cast: ['link'] },
    { id: 'lost-king', name: 'The king lost his entourage', themes: ['town', 'castle', 'field', 'ranch'], cast: ['king'] },
    { id: 'solo-zelda', name: 'A princess deserves a day off', themes: ['town', 'field', 'woods', 'lake'], cast: ['zelda'] },
    { id: 'solo-cat', name: 'The true ruler of Hyrule', themes: ['town', 'castle', 'field', 'woods'], cast: ['cat'] },
    { id: 'solo-smith', name: 'The forge can wait five minutes', themes: ['town', 'field', 'mountain', 'ranch'], cast: ['smith'] },
    { id: 'solo-guard', name: 'A captain on birdwatching duty', themes: ['castle', 'town', 'field', 'woods'], cast: ['guard'] },
    { id: 'tiny-surprise', name: 'The smallest Easter egg in Hyrule', themes: ['field', 'woods', 'ranch', 'ruins'], cast: ['tinyLink'] },
    { id: 'neighbors-detour', name: 'The neighbors took a detour', themes: ['town', 'field', 'ranch'], cast: ['boy', 'girl'] },
    { id: 'guard-cucco', name: 'A promotion for the Cucco', themes: ['castle', 'town', 'field', 'ranch'], cast: ['guard', 'cucco'] },
    { id: 'boss-guest', name: 'An unexpectedly large guest', themes: ['field', 'ruins', 'mountain', 'lake'], cast: ['boss', 'king', 'cat'], boss: true },
    { id: 'boss-treasure', name: 'A very committed treasure guard', themes: ['field', 'ruins', 'mountain', 'lake'], cast: ['boss', 'chest', 'link'], boss: true },
    { id: 'boss-cucco', name: 'Even bosses respect Cuccos', themes: ['field', 'ruins', 'ranch', 'lake'], cast: ['boss', 'cucco', 'cucco'], boss: true },
    { id: 'boss-holiday', name: 'The boss is on holiday', themes: ['field', 'ruins', 'mountain', 'lake'], cast: ['boss'], boss: true },
    { id: 'ezlo-shortcut', name: 'Ezlo is absolutely sure this time', themes: ['field', 'woods', 'mountain', 'ruins'], cast: ['ezlo', 'link'] },
    { id: 'vaati-detour', name: 'Vaati asks for directions', themes: ['town', 'field', 'ruins'], cast: ['vaati', 'guard', 'cat'] },
    { id: 'blade-class', name: 'An outdoor sword lesson', themes: ['field', 'town', 'mountain'], cast: ['blade', 'link', 'guard'] },
    { id: 'minish-reunion', name: 'The three Minish delegations', themes: ['woods', 'town', 'mountain', 'field'], cast: ['forestMinish', 'mountainMinish', 'townMinish'] },
    { id: 'ezlo-oracles', name: 'A very opinionated magic lesson', themes: ['woods', 'field', 'town'], cast: ['ezlo', 'din', 'nayru', 'farore'] },
    { id: 'vaati-cucco', name: 'Vaati picked the wrong opponent', themes: ['field', 'town', 'ranch'], cast: ['vaati', 'cucco', 'cucco'] },
    { id: 'battle-ambush', name: 'Link breaks the monster ambush', themes: ['field', 'woods', 'ruins', 'mountain'], cast: ['link', 'octorok', 'rope'], battle: true, teamSplit: 1 },
    { id: 'battle-duo', name: 'Link and Zelda hold the line', themes: ['field', 'castle', 'woods', 'ruins'], cast: ['link', 'zelda', 'octorok', 'rope'], battle: true, teamSplit: 2 },
    { id: 'battle-guard', name: 'The royal guard fights back', themes: ['town', 'castle', 'field', 'ruins'], cast: ['guard', 'guard', 'rope', 'rope'], battle: true, teamSplit: 2 },
    { id: 'battle-vaati', name: 'Link confronts the wind sorcerer', themes: ['field', 'ruins', 'mountain', 'town'], cast: ['link', 'vaati'], battle: true, teamSplit: 1 },
    { id: 'battle-blade', name: 'A sword lesson interrupted', themes: ['field', 'ruins', 'mountain', 'woods'], cast: ['link', 'octorok', 'puffstool'], battle: true, teamSplit: 1 },
    { id: 'battle-oracles', name: 'The Oracles challenge Vaati', themes: ['field', 'woods', 'town', 'ruins'], cast: ['din', 'nayru', 'farore', 'vaati'], battle: true, teamSplit: 3 },
    { id: 'battle-minish', name: 'A tiny hero takes a huge risk', themes: ['woods', 'field', 'mountain'], cast: ['tinyLink', 'mountainMinish', 'puffstool'], battle: true, teamSplit: 2 },
    { id: 'battle-rivals', name: 'The monsters settle a disagreement', themes: ['field', 'woods', 'ruins', 'lake'], cast: ['octorok', 'octorok', 'rope', 'puffstool'], battle: true, teamSplit: 2 },
    { id: 'battle-rescue', name: 'The royal rescue party arrives', themes: ['field', 'ruins', 'town', 'castle'], cast: ['link', 'guard', 'vaati', 'zelda'], battle: true, teamSplit: 2 },
    { id: 'boss-rivalry', name: 'Two bosses want the same kingdom', themes: ['field', 'ruins', 'mountain', 'lake', 'sky'], cast: ['boss', 'boss'], boss: true, battle: true, teamSplit: 1 },
    { id: 'boss-challenge', name: 'Link challenges a giant', themes: ['field', 'ruins', 'mountain', 'lake'], cast: ['boss', 'link'], boss: true, battle: true, teamSplit: 1 },
    { id: 'boss-alliance', name: 'An unlikely alliance against a giant', themes: ['field', 'ruins', 'mountain', 'lake'], cast: ['boss', 'link', 'zelda'], boss: true, battle: true, teamSplit: 1 },
    { id: 'boss-guard-siege', name: 'The guards defend Hyrule', themes: ['field', 'ruins', 'town', 'castle'], cast: ['boss', 'guard', 'guard'], boss: true, battle: true, teamSplit: 1 },
    { id: 'boss-sorcerer', name: 'Vaati has competition', themes: ['field', 'ruins', 'mountain', 'sky'], cast: ['boss', 'vaati'], boss: true, battle: true, teamSplit: 1 },
    { id: 'armed-moblin', name: 'Link brought more than a sword', themes: ['field', 'woods', 'ruins'], cast: ['link', 'moblin'], battle: true, teamSplit: 1, armed: true },
    { id: 'armed-darknut', name: 'A very unfair sword lesson', themes: ['field', 'castle', 'ruins'], cast: ['link', 'darknut'], battle: true, teamSplit: 1, armed: true },
    { id: 'armed-stalfos', name: 'The skeletons brought backup', themes: ['field', 'woods', 'ruins'], cast: ['link', 'stalfos', 'stalfos'], battle: true, teamSplit: 1, armed: true },
    { id: 'armed-royal-rescue', name: 'The royal rescue has a plan', themes: ['field', 'castle', 'ruins'], cast: ['link', 'guard', 'moblin'], battle: true, teamSplit: 2, armed: true },
    { id: 'armed-rival-patrols', name: 'Two monster patrols meet', themes: ['field', 'woods', 'ruins'], cast: ['moblin', 'moblin', 'stalfos', 'stalfos'], battle: true, teamSplit: 2, armed: true },
    { id: 'armed-knight', name: 'A knight refuses to yield', themes: ['field', 'castle', 'ruins'], cast: ['darknut', 'moblin'], battle: true, teamSplit: 1, armed: true },
    { id: 'armed-oracle-escort', name: 'The Oracles hired the right escort', themes: ['field', 'woods', 'town'], cast: ['link', 'din', 'nayru', 'farore', 'moblin'], battle: true, teamSplit: 4, armed: true },
    { id: 'armed-keaton', name: 'The ambush needs a better plan', themes: ['field', 'woods', 'ruins'], cast: ['link', 'keaton'], battle: true, teamSplit: 1, armed: true },
    { id: 'armed-monster-rivals', name: 'The monsters argue over the loot', themes: ['field', 'woods', 'ruins'], cast: ['keaton', 'moblin'], battle: true, teamSplit: 1, armed: true }

  ];

  function catalogs() {
    const curated = window.MINISH_CURATED || {}, bosses = window.MINISH_BOSSES || {}, worldData = window.MINISH_WORLD_MAPS || {};
    const excluded = new Set([...(curated.excludedPieceIds || []), ...(window.MINISH_SPRITES?.excludedPieceIds || [])].map(String));
    const hidden = new Set((curated.hiddenSourceIds || []).map(String));
    const combat = window.MINISH_COMBAT_LIBRARY || {}, sheets = { ...(curated.sheets || {}), ...(bosses.sheets || {}) };
    for (const [source, sheet] of Object.entries(combat.sheets || {})) sheets[source] = { ...(sheets[source] || {}), ...sheet,
      pieces: [...(sheets[source]?.pieces || []), ...(sheet.pieces || [])] };
    const pieces = new Map(Object.values(sheets).flatMap(sheet => sheet.pieces || []).map(piece => [String(piece.id), piece]));
    const allowed = piece => !excluded.has(String(piece.id)) && !hidden.has(String(piece.sourceId)) &&
      Number(piece.sw) > 0 && Number(piece.sh) > 0 && !['part', 'marker', 'region', 'tile', 'environment'].includes(piece.kind);
    const cast = Object.fromEntries(Object.entries(CAST).map(([name, [source, ranges]]) => [name,
      (sheets[source]?.pieces || []).filter(piece => allowed(piece) && (source !== '19728' || piece.group === 'Tiny Link') && ranges.some(([first, last]) => piece.sequence >= first && piece.sequence <= last))]));
    for (const [name, source] of Object.entries(ARMED_CAST)) cast[name] = [...new Set((combat.actions || []).filter(action => String(action.sourceId) === source).flatMap(action => action.poseIds || []))]
      .map(id => pieces.get(String(id))).filter(piece => piece && allowed(piece));
    const bossPieces = Object.values(bosses.sheets || {}).flatMap(sheet => {
      const candidates = (sheet.pieces || []).filter(allowed);
      const cover = candidates.find(piece => piece.id === sheet.coverPieceId);
      // The cover and a few supplied whole poses add variety without sampling
      // a stripped body component as a complete boss.
      return [cover, ...candidates.filter(piece => piece.kind === 'assembled-boss').slice(0, 4)].filter(Boolean);
    });
    return { curated, bosses, worldData, combat, sheets, pieces, cast, bossPieces };
  }
  function resolveWorld(options, worldData) {
    const worlds = Array.isArray(worldData.worlds) ? worldData.worlds : Object.values(worldData.worlds || {});
    const requestedId = options.worldId || options.mapId;
    const style = options.scope === 'world-illustrated' || options.style === 'illustrated' ? 'illustrated' : 'terrain';
    const world = requestedId ? worlds.find(value => value.id === requestedId) : worlds.find(value => value.style === style);
    if (!world) throw new Error('This Hyrule map is not available. Keep the complete app folder together.');
    const scale = Number(world.backgroundScale ?? (world.style === 'illustrated' ? 8 : 1));
    const width = Number(world.canvasWidth ?? Number(world.width) * scale), height = Number(world.canvasHeight ?? Number(world.height) * scale);
    if (!Number.isInteger(scale) || scale < 1 || scale > 8 || !Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 8192 || height > 8192 || width * height > 16777216) throw new Error('This Hyrule canvas exceeds the supported size.');
    const worldSheets = Object.values(worldData.sheets || {});
    const piece = worldSheets.flatMap(sheet => sheet.pieces || []).find(value => value.id === world.pieceId) || {
      id: world.pieceId || world.assetId, assetId: world.assetId, sourceId: world.sourceId || world.id,
      name: world.name || 'Hyrule', sx: 0, sy: 0, sw: world.width, sh: world.height
    };
    if (!piece.assetId || !Number.isFinite(Number(piece.sw)) || !Number.isFinite(Number(piece.sh))) throw new Error('The Hyrule map image is missing.');
    return { world, piece, scale, width, height };
  }
  function placementZones(world, scale, width, height) {
    const result = [];
    for (const location of world.locations || []) {
      const areas = location.areas || location.zones || [location.rect || location.bounds];
      for (let index = 0; index < areas.length; index++) {
        const input = areas[index];
        if (!input) continue;
        const values = Array.isArray(input) ? input : [input.x, input.y, input.w ?? input.width, input.h ?? input.height];
        const [x, y, w, h] = values.map(value => Math.round(Number(value) * scale));
        if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w < 8 || h < 8 || x + w > width || y + h > height) continue;
        result.push({ id: String(location.id || 'location-' + result.length) + '-' + index, locationId: String(location.id || ''), name: String(location.name || 'Hyrule'),
          theme: String(location.theme || 'field'), bossAllowed: location.bossAllowed !== false,
          bossOnly: location.placement === 'boss-only' || location.allowedRoles?.length === 1 && location.allowedRoles[0] === 'boss',
          bossFamilies: location.bossFamilies || null, x, y, w, h });
      }
    }
    return result;
  }
  const overlaps = (a, b, gap = 5) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  function objectFromPiece(piece, id, x, y, label, scale = 1) {
    const name = (label || piece.name) + (String(piece.sourceId).startsWith('full-boss-') ? ' · editor assembly' : '');
    return { id, kind: 'sprite', assetId: String(piece.assetId), sourceId: String(piece.sourceId), pieceId: String(piece.id),
      pieceName: name, sx: piece.sx || 0, sy: piece.sy || 0, sw: piece.sw, sh: piece.sh, x, y, scale,
      flipX: false, flipY: false, keyColor: piece.keyColor || null, layer: 'objects', visible: true };
  }
  function availableBosses(zone, data) {
    return data.bossPieces.filter(piece => piece.sw <= zone.w - 8 && piece.sh <= zone.h - 8 && (!zone.bossFamilies || zone.bossFamilies.includes(piece.sourceId)));
  }
  // Reviewed directional poses. Flipping a front-facing sprite does not
  // make a side view, so teams choose a real matching direction first.
  const DIRECTIONS = {
    link: { left: [18, 27], down: [9, 17], up: [28, 37] },
    zelda: { left: [9, 16], down: [1, 8], up: [17, 20] },
    guard: { left: [29, 31], down: [32, 34], up: [35, 37] },
    vaati: { left: [34, 34], down: [4, 4], up: [5, 5] },
    octorok: { left: [9, 12], down: [1, 4], up: [27, 30] },
    rope: { left: [1, 4], down: [9, 12], up: [15, 18] },
    puffstool: { down: [1, 8], up: [23, 30] },
    din: { down: [1, 4] }, nayru: { down: [7, 9] }, farore: { down: [12, 12] }
  };
  function directionalEntry(entry, side, axis, data, random) {
    const direction = axis === 'horizontal' ? 'left' : side ? 'up' : 'down';
    const facing = axis === 'horizontal' ? side ? 'left' : 'right' : direction;
    const source = CAST[entry.family]?.[0] || ARMED_CAST[entry.family];
    let actions = (data.combat.actions || []).filter(action => action.kind !== 'equip' && String(action.sourceId) === String(source) &&
      (action.direction === facing || axis === 'horizontal' && ['left', 'right'].includes(action.direction)) &&
      action.poseIds?.length && action.poseIds.every(id => data.pieces.has(String(id))));
    const direct = actions.filter(action => action.direction === facing); if (direct.length) actions = direct;
    if (actions.length) {
      const action = choose(actions, random), poses = action.poseIds.map(id => data.pieces.get(String(id)));
      const piece = data.pieces.get(String(action.representativePoseId)) || poses[Math.min(poses.length - 1, Math.floor(poses.length * Number(action.releasePhase ?? .5)))];
      const flipX = axis === 'horizontal' && action.direction !== facing;
      const anchor = pose => ({ x: flipX ? pose.sw - (pose.combatAnchor?.x ?? pose.sw / 2) : pose.combatAnchor?.x ?? pose.sw / 2,
        y: pose.combatAnchor?.y ?? pose.sh });
      const lowX = Math.min(...poses.map(pose => -anchor(pose).x)), lowY = Math.min(...poses.map(pose => -anchor(pose).y));
      const highX = Math.max(...poses.map(pose => pose.sw - anchor(pose).x)), highY = Math.max(...poses.map(pose => pose.sh - anchor(pose).y));
      return { ...entry, piece, action, side, axis, flipX,
        footprint: { w: Math.ceil(highX - lowX), h: Math.ceil(highY - lowY), anchorX: -lowX, anchorY: -lowY, pieceAnchor: anchor(piece) } };
    }
    if (ARMED_CAST[entry.family]) return null;
    const reviewed = DIRECTIONS[entry.family], range = reviewed?.[direction];
    if (reviewed && !range) return null;
    if (!range) return { ...entry, side, axis, flipX: false };
    const pool = (data.curated.sheets[source]?.pieces || []).filter(piece => piece.sequence >= range[0] && piece.sequence <= range[1]);
    if (!pool.length) return null;
    return { ...entry, piece: choose(pool, random), side, axis, flipX: axis === 'horizontal' && side === 0 };
  }
  function planFor(recipe, zone, data, random, familyUses = new Map()) {
    const entries = [], chosenBosses = new Set();
    for (const role of recipe.cast) {
      const family = role === 'person' ? choose(PEOPLE, random) : role;
      if (zone.bossOnly && family !== 'boss') return null;
      let pool = family === 'boss' ? availableBosses(zone, data) : data.cast[family] || [];
      if (!pool.length) return null;
      if (family === 'boss') {
        if (recipe.battle && chosenBosses.size) pool = pool.filter(piece => !chosenBosses.has(piece.sourceId));
        if (!pool.length) return null;
        const minimum = Math.min(...pool.map(piece => familyUses.get(piece.sourceId) || 0));
        pool = pool.filter(piece => (familyUses.get(piece.sourceId) || 0) === minimum);
      }
      const piece = choose(pool, random); if (family === 'boss') chosenBosses.add(piece.sourceId);
      entries.push({ piece, family });
    }
    // Opponents occupy different sides, with room between the teams for an
    // attack. A vertical arrangement keeps narrow paths usable as battlefields.
    if (recipe.battle) {
      const teams = [entries.slice(0, recipe.teamSplit || 1), entries.slice(recipe.teamSplit || 1)], gap = 20, spacing = 7;
      const plans = [];
      const axes = recipe.boss && recipe.cast.some(role => role !== 'boss') ? ['vertical'] : ['horizontal', 'vertical'];
      for (const axis of axes) {
        const facingTeams = teams.map((team, side) => team.map(entry => directionalEntry(entry, side, axis, data, random)));
        if (facingTeams.some(team => team.some(entry => !entry))) continue;
        const width = entry => entry.footprint?.w || entry.piece.sw, height = entry => entry.footprint?.h || entry.piece.sh;
        const sizes = facingTeams.map(team => axis === 'horizontal'
          ? { w: Math.max(...team.map(width)), h: team.reduce((sum, entry) => sum + height(entry), 0) + spacing * (team.length - 1) }
          : { w: team.reduce((sum, entry) => sum + width(entry), 0) + spacing * (team.length - 1), h: Math.max(...team.map(height)) });
        const w = axis === 'horizontal' ? sizes[0].w + gap + sizes[1].w : Math.max(...sizes.map(size => size.w));
        const h = axis === 'vertical' ? sizes[0].h + gap + sizes[1].h : Math.max(...sizes.map(size => size.h));
        if (w > zone.w - 4 || h > zone.h - 4) continue;
        const placements = [];
        facingTeams.forEach((team, side) => {
          let x = axis === 'horizontal' ? (side ? sizes[0].w + gap : 0) : Math.floor((w - sizes[side].w) / 2);
          let y = axis === 'vertical' ? (side ? sizes[0].h + gap : 0) : Math.floor((h - sizes[side].h) / 2);
          for (const entry of team) {
            const cell = { x: x + (axis === 'horizontal' ? Math.floor((sizes[side].w - width(entry)) / 2) : 0),
              y: y + (axis === 'vertical' ? sizes[side].h - height(entry) : 0), w: width(entry), h: height(entry) };
            placements.push({ ...entry, x: entry.action ? Math.round(cell.x + entry.footprint.anchorX - entry.footprint.pieceAnchor.x) : cell.x + Math.floor((cell.w - entry.piece.sw) / 2),
              y: entry.action ? Math.round(cell.y + entry.footprint.anchorY - entry.footprint.pieceAnchor.y) : cell.y + cell.h - entry.piece.sh, cell, side, axis });
            if (axis === 'horizontal') y += height(entry) + spacing; else x += width(entry) + spacing;
          }
        });
        plans.push({ placements, w, h, axis });
      }
      return plans[0] || null;
    }
    const gap = 10, hasBoss = entries.some(entry => entry.family === 'boss');
    const rows = !hasBoss && entries.length >= 4 && random() < .5 ? [entries.slice(0, Math.ceil(entries.length / 2)), entries.slice(Math.ceil(entries.length / 2))] : [entries];
    const widths = rows.map(row => row.reduce((sum, entry) => sum + entry.piece.sw, 0) + gap * (row.length - 1));
    const heights = rows.map(row => Math.max(...row.map(entry => entry.piece.sh)));
    const w = Math.max(...widths), h = heights.reduce((sum, value) => sum + value, 0) + gap * (rows.length - 1);
    if (w > zone.w - 4 || h > zone.h - 4) return null;
    const placements = [];
    let y = 0;
    rows.forEach((row, index) => {
      let x = Math.floor((w - widths[index]) / 2);
      for (const entry of row) { placements.push({ ...entry, x, y: y + heights[index] - entry.piece.sh }); x += entry.piece.sw + gap; }
      y += heights[index] + gap;
    });
    return { placements, w, h };
  }

  function buildScene(options = {}) {
    const data = catalogs(), resolved = resolveWorld(options, data.worldData), { world, piece, scale, width, height } = resolved;
    const scope = world.style === 'illustrated' ? 'world-illustrated' : 'world-terrain';
    const seed = String(options.seed || 'hyrule'), random = randomFor(seed + ':' + world.id);
    const requestedDensity = String(options.density || 'varied');
    const density = requestedDensity === 'varied' ? choose(['quiet', 'balanced', 'lively'], random)
      : ['quiet', 'light', 'sparse'].includes(requestedDensity) ? 'quiet' : ['lively', 'busy', 'dense'].includes(requestedDensity) ? 'lively' : 'balanced';
    const target = world.style === 'illustrated' ? { quiet: 5, balanced: 9, lively: 13 }[density] : { quiet: 20, balanced: 36, lively: 52 }[density];
    const background = objectFromPiece(piece, 'world-background', 0, 0, world.name || piece.name, scale); background.layer = 'terrain';
    const objects = [background], easterEggs = [], occupied = [], recipeUses = new Map(), familyUses = new Map(), zones = shuffled(placementZones(world, scale, width, height), random)
      .sort((a, b) => Number(b.bossAllowed && availableBosses(b, data).length > 0) - Number(a.bossAllowed && availableBosses(a, data).length > 0));
    if (options.populate !== false && !zones.length) throw new Error('This map has no reviewed encounter areas yet. You can still use its blank canvas.');
    const maxBosses = world.style === 'illustrated' ? { quiet: 3, balanced: 5, lively: 7 }[density] : { quiet: 4, balanced: 8, lively: 12 }[density];
    const battleTarget = Math.max(2, Math.round(target * .4));
    let bossCount = 0, battleCount = 0, occupiedArt = 0, visits = 0;
    const maxVisits = zones.length * Math.max(6, Math.ceil(target / Math.max(1, zones.length)) * 7);
    while (options.populate !== false && easterEggs.length < target && visits < maxVisits) {
      const zone = zones[visits++ % zones.length];
      const preferBoss = bossCount < maxBosses && zone.bossAllowed && availableBosses(zone, data).length > 0;
      const recipes = shuffled(RECIPES.filter(recipe => (!recipe.armed || recipe.cast.every(role => !ARMED_CAST[role] || data.cast[role]?.length)) && (!zone.bossOnly || recipe.cast.every(role => role === 'boss')) && (!recipe.boss || zone.bossAllowed && bossCount + recipe.cast.filter(role => role === 'boss').length <= maxBosses) &&
        (!preferBoss || recipe.boss)), random);
      const themed = recipes.filter(recipe => recipe.themes.includes(zone.theme));
      // Prefer a new joke before repeating an encounter elsewhere. The shuffle
      // still varies its pose, cast and placement for every seed.
      const candidates = [...themed, ...recipes.filter(recipe => !themed.includes(recipe))]
        .sort((a, b) => (battleCount < battleTarget ? Number(!!b.battle) - Number(!!a.battle) : 0) || (recipeUses.get(a.id) || 0) - (recipeUses.get(b.id) || 0));
      let placed = false;
      for (const recipe of candidates) {
        const plan = planFor(recipe, zone, data, random, familyUses);
        if (!plan) continue;
        const pixels = plan.placements.reduce((sum, entry) => sum + entry.piece.sw * entry.piece.sh, 0);
        if (occupiedArt + pixels > width * height * .14) continue;
        for (let attempt = 0; attempt < 12; attempt++) {
          const x = zone.x + 2 + Math.floor(random() * Math.max(1, zone.w - plan.w - 3));
          const y = zone.y + 2 + Math.floor(random() * Math.max(1, zone.h - plan.h - 3));
          const box = { x, y, w: plan.w, h: plan.h };
          if (occupied.some(value => overlaps(box, value, 12))) continue;
          const id = 'egg-' + (easterEggs.length + 1), placedIds = [];
          for (const entry of plan.placements) {
            const object = objectFromPiece(entry.piece, id + '-' + placedIds.length, x + entry.x, y + entry.y, recipe.name + ' · ' + entry.family);
            object.easterEggId = id;
            object.worldEncounter = { role: entry.family, battle: !!recipe.battle, ...(recipe.battle ? { side: entry.side, axis: entry.axis } : {}) };
            if (recipe.battle) object.combat = { actorKey: id + '/fighter/' + placedIds.length,
              direction: entry.axis === 'horizontal' ? (entry.side ? 'left' : 'right') : entry.side ? 'up' : 'down',
              side: entry.side, axis: entry.axis, editorChoreography: true };
            if (entry.action) {
              object.animationAnchor = entry.action.animationAnchor || 'feet';
              object.worldCombat = { actionId: entry.action.id, weapon: entry.action.weapon, direction: entry.action.direction,
                side: entry.side, axis: entry.axis, editorChoreography: true,
                cell: { x: x + entry.cell.x, y: y + entry.cell.y, w: entry.cell.w, h: entry.cell.h } };
              Object.assign(object.combat, { actionId: entry.action.id, weapon: entry.action.weapon });
              if (entry.action.assembly) object.pieceName += ' · editor assembly';
            }
            if (recipe.battle) object.flipX = !!entry.flipX;
            objects.push(object); placedIds.push(object.id);
            if (entry.family === 'boss') familyUses.set(entry.piece.sourceId, (familyUses.get(entry.piece.sourceId) || 0) + 1);
          }
          if (recipe.battle) for (const object of objects.filter(object => object.easterEggId === id)) {
            const opponents = objects.filter(other => other.easterEggId === id && other.combat?.side !== object.combat.side);
            const target = opponents.sort((a, b) => Math.hypot(a.x - object.x, a.y - object.y) - Math.hypot(b.x - object.x, b.y - object.y))[0];
            if (target) object.combat.targetKey = target.combat.actorKey;
          }
          // A paused battle can show a real thrown item in its clear attack
          // corridor. Effects without room remain available for animation;
          // no impact spark floats in empty space or replaces a body sprite.
          const fxRandom = randomFor(seed + ':' + id + ':weapon-flight');
          const fighters = objects.filter(object => object.easterEggId === id && object.worldCombat?.actionId);
          for (const owner of shuffled(fighters, fxRandom)) {
            const action = (data.combat.actions || []).find(value => value.id === owner.worldCombat.actionId);
            const effect = (data.combat.effects || []).find(value => value.id === action?.effectId && value.kind === 'projectile');
            const target = objects.find(object => object.combat?.actorKey === owner.combat.targetKey);
            if (!effect || !target) continue;
            const native = effect.directions?.[owner.combat.direction] || effect.directions?.left || effect.pieceIds;
            const projectile = data.pieces.get(String(native?.[Math.floor(fxRandom() * native.length)])); if (!projectile) continue;
            const horizontal = owner.combat.axis === 'horizontal', side = owner.combat.side;
            const centerX = horizontal ? (side ? owner.x + target.x + target.sw : owner.x + owner.sw + target.x) / 2 : (owner.x + owner.sw / 2 + target.x + target.sw / 2) / 2;
            const centerY = horizontal ? (owner.y + owner.sh / 2 + target.y + target.sh / 2) / 2 : (side ? owner.y + target.y + target.sh : owner.y + owner.sh + target.y) / 2;
            const rect = { x: Math.round(centerX - projectile.sw / 2), y: Math.round(centerY - projectile.sh / 2), w: projectile.sw, h: projectile.sh };
            if (rect.x < box.x || rect.y < box.y || rect.x + rect.w > box.x + box.w || rect.y + rect.h > box.y + box.h || objects.slice(1).some(object => overlaps(rect, { x: object.x, y: object.y, w: object.sw, h: object.sh }, 2))) continue;
            const object = objectFromPiece(projectile, id + '-weapon-flight', rect.x, rect.y, action.label + ' · in flight');
            object.easterEggId = id; object.layer = 'overlay';
            object.combat = { ownerKey: owner.combat.actorKey, targetKey: target.combat.actorKey, actionId: action.id, weapon: action.weapon,
              phase: 'release', role: 'projectile', staticEffect: true, editorChoreography: true };
            object.worldEncounter = { role: 'weapon', battle: true, side, axis: owner.combat.axis };
            objects.push(object); break;
          }
          occupied.push(box); occupiedArt += pixels;
          recipeUses.set(recipe.id, (recipeUses.get(recipe.id) || 0) + 1);
          easterEggs.push({ id, storyId: recipe.id, name: recipe.name, locationId: zone.locationId, location: zone.name,
            bounds: box, sourcePieceIds: objects.filter(object => object.easterEggId === id).map(object => object.pieceId), editorAssembly: !!recipe.boss, battle: !!recipe.battle, formation: plan.axis || 'gathering' });
          bossCount += plan.placements.filter(entry => entry.family === 'boss').length;
          if (recipe.battle) battleCount++;
          placed = true; break;
        }
        if (placed) break;
      }
    }
    const rank = { terrain: 0, objects: 1, overlay: 2 };
    objects.sort((a, b) => rank[a.layer] - rank[b.layer] || a.y + a.sh * a.scale - b.y - b.sh * b.scale);
    const populated = options.populate !== false;
    return { id: 'world-' + world.id + '-' + hash(seed + ':' + density).toString(36),
      name: populated ? 'Hyrule Easter egg hunt' : world.name || 'Hyrule', width, height,
      preset: world.presetId || 'custom', worldId: world.id, worldStyle: world.style, exportScale: 1, color: '#182a25', transparent: false, objects,
      generated: populated ? { version: 1, kind: 'world', worldId: world.id, scope, seed, density,
        theme: 'world', templateId: 'world-' + world.id, storyId: 'world-easter-eggs', story: 'Hyrule Easter egg hunt',
        requestedOptions: { scope, worldId: world.id, density: requestedDensity },
        backgroundScale: scale, easterEggCount: easterEggs.length, bossCount, battleCount, bossFamilies: [...familyUses.keys()], easterEggs,
        encounters: easterEggs.map(egg => ({ name: egg.name, location: egg.location, region: egg.location, battle: egg.battle, formation: egg.formation,
          x: egg.bounds.x, y: egg.bounds.y, w: egg.bounds.w, h: egg.bounds.h })),
        note: 'A new editor composition on the credited Hyrule map. Encounters and multipart boss assemblies are creative placements, not reconstructed gameplay moments or game collision data.' } : undefined };
  }

  window.MINISH_WORLD_SCENES = { buildScene, randomFor, recipes: RECIPES.map(({ id, name }) => ({ id, name })), version: 1 };
})();
