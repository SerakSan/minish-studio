(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const choose = (values, random) => values[Math.floor(random() * values.length)];
  const box = object => ({ x: object.x, y: object.y, w: object.sw * object.scale, h: object.sh * object.scale });
  const right = rect => rect.x + rect.w, bottom = rect => rect.y + rect.h;
  const overlaps = (a, b, gap = 0) => a.x < right(b) + gap && right(a) + gap > b.x && a.y < bottom(b) + gap && bottom(a) + gap > b.y;
  function union(rects) {
    const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
    return { x, y, w: Math.max(...rects.map(right)) - x, h: Math.max(...rects.map(bottom)) - y };
  }
  function shuffle(values, random) {
    const result = [...values];
    for (let n = result.length - 1; n > 0; n--) { const index = Math.floor(random() * (n + 1)); [result[n], result[index]] = [result[index], result[n]]; }
    return result;
  }
  function pieceObject(piece, id, eggId, name) {
    return { id, kind: 'sprite', sourceId: String(piece.sourceId), assetId: String(piece.assetId), pieceId: String(piece.id), pieceName: name,
      x: 0, y: 0, sx: piece.sx, sy: piece.sy, sw: piece.sw, sh: piece.sh, scale: 1, flipX: false, flipY: false,
      keyColor: piece.keyColor || null, layer: 'objects', visible: true, easterEggId: eggId };
  }
  function zoneFor(location, scale) {
    const input = location.rect || location.bounds;
    if (!input) return null;
    return { x: input.x * scale, y: input.y * scale, w: (input.w ?? input.width) * scale, h: (input.h ?? input.height) * scale };
  }
  function buildClip(options = {}) {
    const worldScenes = window.MINISH_WORLD_SCENES, engine = window.MINISH_ANIMATION, simple = window.MINISH_SIMPLE_ANIMATION, studio = window.MINISH_STUDIO;
    if (!worldScenes || !engine || !simple?.compileRecipe || !studio) throw new Error('Open the complete animation editor before creating a Hyrule animation.');
    simple.init(engine, studio);
    const fps = Number(options.fps ?? 12), duration = Number(options.duration ?? fps * Number(options.seconds ?? 8));
    if (!Number.isInteger(fps) || fps < 1 || fps > 60 || !Number.isInteger(duration) || duration < Math.max(2, fps * 2) || duration > 600) throw new Error('Choose at least 2 seconds, with 1 to 60 fps and no more than 600 frames.');
    const scene = worldScenes.buildScene({ ...options, populate: true });
    const worldData = window.MINISH_WORLD_MAPS || {}, world = (Array.isArray(worldData.worlds) ? worldData.worlds : Object.values(worldData.worlds || {})).find(value => value.id === scene.worldId);
    if (!world) throw new Error('The complete Hyrule map is missing.');
    const random = worldScenes.randomFor(scene.generated.seed + ':animation'), scale = world.backgroundScale || 1;
    let objects = clone(scene.objects).filter(object => !object.combat?.staticEffect);
    const eggs = clone(scene.generated.easterEggs), zones = new Map((world.locations || []).map(location => [location.id, { ...location, ...zoneFor(location, scale) }]));
    const eggMap = new Map(eggs.map(egg => [egg.id, egg]));
    const modelCache = new Map(), pinnedModels = new Map(), footprints = new Map(), fixedCells = new Map();
    const choreography = new Map();
    const combat = window.MINISH_COMBAT_LIBRARY || {}, combatActions = new Map((combat.actions || []).map(action => [action.id, action]));
    const combatPieces = new Map(Object.values(combat.sheets || {}).flatMap(sheet => sheet.pieces || []).map(piece => [String(piece.id), piece]));
    const resolvePiece = id => studio.getPiece(String(id)) || combatPieces.get(String(id));
    const combatBeat = (frame, side = 0, cycles = 3) => (frame / duration * cycles + 1 - side * .5) % 1;
    const poseProgress = (beat, action) => {
      const contactPose = clamp(Number(action?.impactPhase ?? .67), .1, .95);
      return beat < .12 ? 0 : beat < .6 ? (beat - .12) / .48 * contactPose : beat < .7 ? contactPose
        : contactPose + (beat - .7) / .3 * (1 - contactPose);
    };
    const releaseBeat = action => {
      const phase = clamp(Number(action.releasePhase ?? .4), 0, 1), contactPose = clamp(Number(action.impactPhase ?? .67), .1, .95);
      return phase <= contactPose ? .12 + .48 * phase / contactPose : .7 + .3 * (phase - contactPose) / (1 - contactPose);
    };

    function combatModel(base, action) {
      const poses = action.poseIds.map(resolvePiece);
      if (!poses.length || poses.some(piece => !piece)) return null;
      const initial = resolvePiece(base.pieceId) || base;
      const anchor = piece => ({ x: base.flipX ? piece.sw - (piece.combatAnchor?.x ?? piece.sw / 2) : piece.combatAnchor?.x ?? piece.sw / 2,
        y: base.flipY ? piece.sh - (piece.combatAnchor?.y ?? piece.sh) : piece.combatAnchor?.y ?? piece.sh });
      const start = anchor(initial);
      const frames = poses.map(piece => ({ pieceId: piece.id,
        x: Math.round(start.x - anchor(piece).x), y: Math.round(start.y - anchor(piece).y) }));
      const envelope = union(frames.map((value, index) => ({ x: value.x, y: value.y, w: poses[index].sw, h: poses[index].sh })));
      return { preset: { ...action, poseIds: [...action.poseIds], repeat: true, label: action.label, fps: action.fps || 8 },
        speed: 'normal', action, sourceDuration: frames.length, envelope, rawFrames: frames };
    }

    function modelFor(base, preset, speed) {
      const reviewed = combatActions.get(preset.id);
      if (reviewed) return combatModel(base, reviewed);
      const key = [base.pieceId, preset.id, speed, fps, duration, base.scale, base.flipX, base.flipY, base.animationAnchor || '', base.layer].join(':');
      if (modelCache.has(key)) return modelCache.get(key);
      const normalized = { ...clone(base), x: 0, y: 0 };
      const hold = simple.previewHold(preset, speed, fps), period = Math.max(1, (preset.poseIds?.length || 1) * hold);
      const loops = clamp(Math.round(duration / period), 1, Math.max(1, Math.floor(600 / period)));
      const sourceDuration = preset.id === 'still' ? duration : Math.min(600, period * loops);
      const compiled = simple.compileRecipe(normalized, { presetId: preset.id, motion: 'none', speed, distance: 0 }, { fps, duration: sourceDuration });
      const miniClip = { width: scene.width, height: scene.height, exportScale: 1, duration: compiled.duration, fps,
        objects: [normalized], tracks: [{ objectId: normalized.id, keys: compiled.keys }], transparent: true, color: scene.color };
      const times = [...new Set([0, compiled.duration - 1, ...compiled.keys.map(key => key.frame)])];
      const envelope = union(times.map(frame => box(engine.evaluateFrame(miniClip, frame).objects[0])));
      const rawFrames = [];
      let cursor = 0, state = { pieceId: normalized.pieceId, x: 0, y: 0 };
      for (let frame = 0; frame < compiled.duration; frame++) {
        while (cursor < compiled.keys.length && compiled.keys[cursor].frame <= frame) Object.assign(state, compiled.keys[cursor++].values);
        rawFrames.push({ ...state });
      }
      const result = { preset, speed, sourceDuration: compiled.duration, envelope, rawFrames };
      modelCache.set(key, result); return result;
    }
    function readyChoices(base, activity) {
      if (activity === 'battle' && base.worldCombat?.actionId) {
        const action = combatActions.get(base.worldCombat.actionId);
        if (action) return [action, ...shuffle((combat.actions || []).filter(value => value.kind !== 'equip' && value.id !== action.id &&
          String(value.sourceId) === String(base.sourceId) && value.direction === action.direction), random), { id: 'still', poseIds: [], repeat: true, fps: 6 }];
      }
      let presets = simple.presetsFor({ kind: 'sprite', sourceId: base.sourceId }).filter(preset => preset.id !== 'still' && preset.repeat !== false && !combatActions.has(preset.id));
      if (activity === 'battle' && ['6369', '22716'].includes(String(base.sourceId))) {
        const direction = base.worldEncounter?.axis === 'vertical' ? (base.worldEncounter?.side ? /away/i : /toward/i) : /left/i;
        presets = presets.filter(preset => direction.test(preset.label));
        return [...presets, { id: 'still', poseIds: [], repeat: true, fps: 6 }];
      }
      if (['6402', '6403', '6391'].includes(String(base.sourceId))) presets = presets.filter(preset => preset.poseIds.includes(base.pieceId));
      else if (!String(base.sourceId).startsWith('full-boss-')) {
        const matching = presets.filter(preset => preset.poseIds.includes(base.pieceId));
        if (matching.length) presets = matching;
      }
      if (activity === 'still') presets = [];
      return [...shuffle(presets, random), { id: 'still', poseIds: [], repeat: true, fps: 6 }];
    }
    function activityFor(egg) {
      if (egg.battle) return 'battle';
      if (/monster|octorok|winged/.test(egg.storyId)) return 'dance';
      if (/oracle/.test(egg.storyId)) return 'party';
      if (/pet|dog|cat/.test(egg.storyId)) return 'chase';
      if (/cucco|poultry/.test(egg.storyId)) return 'parade';
      if (egg.editorAssembly) return 'boss';
      return choose(['stroll', 'stroll', 'idle'], random);
    }
    for (const egg of eggs) choreography.set(egg.id, { type: activityFor(egg), cycles: choose([2, 3, 4], random) });

    // Duels replace roomy encounters, keeping the original map and every
    // other encounter intact. Both opponents use supplied complete assemblies.
    let duelCount = 0;
    const maxDuels = { quiet: 2, balanced: 3, lively: 4 }[scene.generated.density] || 3;
    const bossEggs = shuffle(eggs.filter(egg => egg.editorAssembly), random);
    for (const egg of bossEggs) {
      if (duelCount >= maxDuels) continue;
      const zone = zones.get(egg.locationId); if (!zone || zone.bossAllowed === false) continue;
      const existingSources = new Set(objects.filter(object => object.easterEggId === egg.id && String(object.sourceId).startsWith('full-boss-')).map(object => object.sourceId));
      const sourceIds = Object.keys(window.MINISH_BOSSES?.sheets || {}).filter(source => !zone.bossFamilies || zone.bossFamilies.includes(source));
      const candidates = [];
      for (const sourceId of shuffle(sourceIds, random)) {
        const presets = simple.presetsFor({ kind: 'sprite', sourceId }).filter(preset => preset.assembly && preset.repeat !== false);
        for (const preset of shuffle(presets, random).slice(0, 3)) {
          const piece = studio.getPiece(preset.poseIds[0]); if (!piece) continue;
          const base = pieceObject(piece, 'world-duel-candidate', egg.id, 'Boss face-off · editor assembly');
          const model = modelFor(base, preset, 'normal');
          if (model.envelope.w < zone.w - 60 && model.envelope.h < zone.h - 8) candidates.push({ base, model });
        }
      }
      const others = objects.filter(object => object.layer !== 'terrain' && object.easterEggId !== egg.id).map(box);
      const otherArt = others.reduce((sum, rect) => sum + rect.w * rect.h, 0);
      let duel = null;
      const ordered = [...candidates].sort((a, b) => Number(existingSources.has(b.base.sourceId)) - Number(existingSources.has(a.base.sourceId)));
      for (const first of ordered) {
        const opponents = shuffle(candidates.filter(value => value.base.sourceId !== first.base.sourceId), random)
          .sort((a, b) => Number(existingSources.has(b.base.sourceId)) - Number(existingSources.has(a.base.sourceId)));
        for (const second of opponents) {
          const gap = 40, w = first.model.envelope.w + second.model.envelope.w + gap, h = Math.max(first.model.envelope.h, second.model.envelope.h);
          if (w > zone.w - 8 || h > zone.h - 8) continue;
          if (world.style === 'illustrated' && otherArt + first.model.envelope.w * first.model.envelope.h + second.model.envelope.w * second.model.envelope.h + 256 > scene.width * scene.height * .14) continue;
          for (let attempt = 0; attempt < 16; attempt++) {
            const group = { x: zone.x + 4 + Math.floor(random() * Math.max(1, zone.w - w - 7)), y: zone.y + 4 + Math.floor(random() * Math.max(1, zone.h - h - 7)), w, h };
            if (others.some(value => overlaps(group, value, 12))) continue;
            duel = { first, second, group, gap }; break;
          }
          if (duel) break;
        }
        if (duel) break;
      }
      if (!duel) continue;
      objects = objects.filter(object => object.easterEggId !== egg.id);
      const duelObjects = [];
      for (const [index, candidate] of [duel.first, duel.second].entries()) {
        const envelope = candidate.model.envelope;
        const area = { x: duel.group.x + (index ? duel.first.model.envelope.w + duel.gap : 0), y: duel.group.y + Math.floor((duel.group.h - envelope.h) / 2), w: envelope.w, h: envelope.h };
        const base = { ...candidate.base, id: egg.id + '-duel-' + index, x: area.x - envelope.x, y: area.y - envelope.y };
        base.worldAnimation = { role: 'duelist', side: index, editorChoreography: true };
        base.combat = { actorKey: egg.id + '/duelist/' + index, targetKey: egg.id + '/duelist/' + (1 - index),
          side: index, axis: 'horizontal', direction: index ? 'left' : 'right', weapon: 'boss magic', editorChoreography: true };
        objects.push(base); duelObjects.push(base); footprints.set(base.id, area); pinnedModels.set(base.id, candidate.model);
      }
      const firePreset = simple.presetsFor({ kind: 'sprite', sourceId: '6452' }).find(preset => preset.id === 'fireball-spin');
      if (firePreset && !(combat.effects || []).length) {
        const piece = studio.getPiece(firePreset.poseIds[0]);
        const projectile = pieceObject(piece, egg.id + '-volley', egg.id, 'Arcane volley · editor choreography');
        projectile.animationAnchor = 'center'; projectile.layer = 'overlay';
        const model = modelFor(projectile, firePreset, 'fast'), left = footprints.get(duelObjects[0].id), upper = Math.max(footprints.get(duelObjects[0].id).y, footprints.get(duelObjects[1].id).y);
        const corridor = { x: right(left) + 4, y: clamp(Math.round(upper + Math.min(duel.first.model.envelope.h, duel.second.model.envelope.h) * .45), zone.y + 4, bottom(zone) - model.envelope.h - 4), w: duel.gap - 8, h: model.envelope.h };
        projectile.x = corridor.x - model.envelope.x; projectile.y = corridor.y - model.envelope.y;
        projectile.visible = false; projectile.worldAnimation = { role: 'projectile', editorChoreography: true };
        objects.push(projectile); footprints.set(projectile.id, corridor); fixedCells.set(projectile.id, corridor); pinnedModels.set(projectile.id, model);
      }
      egg.name = 'A boss duel nobody scheduled'; egg.storyId = 'world-boss-duel'; egg.battle = true;
      egg.sourcePieceIds = objects.filter(object => object.easterEggId === egg.id).map(object => object.pieceId);
      choreography.set(egg.id, { type: 'duel', cycles: 2 }); duelCount++;
    }

    const actors = objects.filter(object => object.layer !== 'terrain');
    for (const egg of eggs) {
      const activity = choreography.get(egg.id);
      activity.combatCycles = activity.type === 'duel' || actors.some(object => object.easterEggId === egg.id && String(object.sourceId) === '64168') ? 2 : 4;
    }
    // Each actor owns a disjoint cell inside its reviewed source area. Pose
    // changes and all movement remain inside that cell at every frame.
    const cells = new Map();
    for (const object of actors) {
      const egg = eggMap.get(object.easterEggId), zone = zones.get(egg?.locationId), basis = footprints.get(object.id) || box(object);
      if (!zone) throw new Error('A world encounter has no reviewed placement area.');
      const halo = String(object.sourceId).startsWith('full-boss-') ? 40 : 12;
      const reserved = object.worldCombat?.cell;
      const reservedBasis = reserved ? union([basis, reserved]) : basis;
      const cell = fixedCells.get(object.id) || { x: Math.max(zone.x, reservedBasis.x - halo), y: Math.max(zone.y, reservedBasis.y - halo),
        w: Math.min(right(zone), right(reservedBasis) + halo) - Math.max(zone.x, reservedBasis.x - halo), h: Math.min(bottom(zone), bottom(reservedBasis) + halo) - Math.max(zone.y, reservedBasis.y - halo) };
      cells.set(object.id, { ...cell });
    }
    for (let first = 0; first < actors.length; first++) for (let second = first + 1; second < actors.length; second++) {
      const a = actors[first], b = actors[second], ca = cells.get(a.id), cb = cells.get(b.id);
      if (!overlaps(ca, cb)) continue;
      const aa = footprints.get(a.id) || a.worldCombat?.cell || box(a), bb = footprints.get(b.id) || b.worldCombat?.cell || box(b);
      const gx = right(aa) <= bb.x ? bb.x - right(aa) : right(bb) <= aa.x ? aa.x - right(bb) : -1;
      const gy = bottom(aa) <= bb.y ? bb.y - bottom(aa) : bottom(bb) <= aa.y ? aa.y - bottom(bb) : -1;
      if (gx < 0 && gy < 0) throw new Error('World encounter cells overlap before animation.');
      if (gx >= gy) {
        const [left, rightCell, leftBasis, rightBasis] = aa.x <= bb.x ? [ca, cb, aa, bb] : [cb, ca, bb, aa];
        const split = Math.floor((right(leftBasis) + rightBasis.x) / 2), edge = right(rightCell);
        left.w = Math.min(right(left), split) - left.x; rightCell.x = Math.max(rightCell.x, split); rightCell.w = edge - rightCell.x;
      } else {
        const [above, below, topBasis, bottomBasis] = aa.y <= bb.y ? [ca, cb, aa, bb] : [cb, ca, bb, aa];
        const split = Math.floor((bottom(topBasis) + bottomBasis.y) / 2), edge = bottom(below);
        above.h = Math.min(bottom(above), split) - above.y; below.y = Math.max(below.y, split); below.h = edge - below.y;
      }
    }

    const tracks = [{ id: 'world-map-track', objectId: objects[0].id, name: 'Hyrule map', locked: true, muted: false, keys: [] }];
    const activityBounds = new Map(), activityTypes = new Set();
    let animatedObjectCount = 0;
    for (const [actorIndex, object] of actors.entries()) {
      const egg = eggMap.get(object.easterEggId), activity = choreography.get(egg.id), cell = cells.get(object.id);
      const sourceCategory = window.MINISH_CURATED?.sheets?.[object.sourceId]?.category;
      const prop = sourceCategory === 'objects' && object.worldAnimation?.role !== 'projectile';
      let type = prop ? 'still' : object.worldAnimation?.role === 'projectile' ? 'projectile' : activity.type;
      const speed = type === 'dance' || type === 'party' ? 'fast' : choose(['slow', 'normal', 'normal'], random);
      // These keys already contain the reviewed per-pose body-anchor offset.
      // Disable the engine's generic bounding-box offset to avoid applying a
      // second correction when a sword or held tool changes the crop width.
      if (object.worldCombat?.actionId) object.animationAnchor = 'top-left';
      if (type === 'battle' && ['6369', '22716'].includes(String(object.sourceId))) object.flipX = object.worldEncounter?.axis !== 'vertical' && object.worldEncounter?.side === 0;
      let model = pinnedModels.get(object.id);
      if (!model) {
        for (const preset of readyChoices(object, type)) {
          const candidate = modelFor(object, preset, speed);
          if (candidate.envelope.w <= cell.w && candidate.envelope.h <= cell.h) { model = candidate; break; }
        }
      }
      if (!model || model.envelope.w > cell.w || model.envelope.h > cell.h) throw new Error('A complete animated pose does not fit its reviewed area.');
      const battleModels = [model];
      if (model.action) for (const action of shuffle((combat.actions || []).filter(value => value.kind !== 'equip' && String(value.sourceId) === String(object.sourceId) && value.direction === model.action.direction && value.id !== model.action.id), random)) {
        const candidate = combatModel(object, action), envelope = candidate && union([...battleModels.map(value => value.envelope), candidate.envelope]);
        if (candidate && envelope.w <= cell.w && envelope.h <= cell.h) battleModels.push(candidate);
        if (battleModels.length >= 3) break;
      }
      if (battleModels.length > 1) model = { ...model, envelope: union(battleModels.map(value => value.envelope)) };
      if (['stroll', 'chase', 'parade'].includes(type) && /away|toward/i.test(model.preset.label || '')) {
        const opposite = /away/i.test(model.preset.label) ? /toward/i : /away/i;
        const preset = simple.presetsFor({ kind: 'sprite', sourceId: object.sourceId }).find(value => value.repeat !== false && opposite.test(value.label));
        if (preset) {
          const reverseModel = modelFor(object, preset, model.speed), envelope = union([model.envelope, reverseModel.envelope]);
          if (envelope.w <= cell.w && envelope.h <= cell.h) model = { ...model, envelope, reverseModel };
        }
      }
      const envelope = model.envelope, lowX = cell.x - envelope.x, highX = right(cell) - right(envelope), lowY = cell.y - envelope.y, highY = bottom(cell) - bottom(envelope);
      const centerX = Math.round((lowX + highX) / 2), centerY = Math.round((lowY + highY) / 2);
      const amplitudeX = Math.min(type === 'dance' || type === 'party' ? 3 : type === 'duel' ? 2 : type === 'battle' ? 5 : 8, Math.floor((highX - lowX) / 2));
      const amplitudeY = Math.min(type === 'dance' || type === 'party' ? 6 : type === 'boss' ? 4 : type === 'duel' ? 3 : type === 'battle' ? 5 : 3, Math.floor((highY - lowY) / 2));
      const phase = (actorIndex % 4) * Math.PI / 2 + random() * .35, cycles = activity.cycles;
      let previous = null;
      const keys = [], rects = [];
      for (let frame = 0; frame < duration; frame++) {
        const theta = frame / duration * Math.PI * 2 * cycles + phase;
        const verticalWalk = /away|toward/i.test(model.preset.label || ''), movingForward = Math.cos(theta) >= 0;
        const reverse = model.reverseModel && amplitudeY > 0 && movingForward === /away/i.test(model.preset.label);
        const side = object.combat?.side ?? object.worldEncounter?.side ?? 0;
        const battleCycles = activity.combatCycles || 3;
        const beat = combatBeat(frame, side, battleCycles), cycle = Math.floor(frame / duration * battleCycles - side * .5);
        const activeModel = model.action ? battleModels[((cycle % battleModels.length) + battleModels.length) % battleModels.length] : reverse ? model.reverseModel : model;
        const defensive = activeModel.action?.kind === 'guard', poseBeat = defensive ? combatBeat(frame, 1 - side, battleCycles) : beat;
        const actionProgress = poseProgress(poseBeat, activeModel.action);
        const sourceFrame = activeModel.action ? Math.min(activeModel.rawFrames.length - 1, Math.floor(actionProgress * activeModel.rawFrames.length))
          : Math.floor(frame / duration * activeModel.sourceDuration) % activeModel.sourceDuration;
        const raw = activeModel.rawFrames[sourceFrame];
        let x = centerX, y = centerY, visible = true;
        if (type === 'still') { x = clamp(object.x, lowX, highX); y = clamp(object.y, lowY, highY); }
        else if (type === 'projectile') {
          const beat = frame / duration * 2 % 1, backwards = frame >= duration / 2;
          visible = beat >= .18 && beat <= .76;
          const travel = clamp((beat - .18) / .58, 0, 1);
          x = Math.round(lowX + (highX - lowX) * (backwards ? 1 - travel : travel)); y = centerY;
        } else if (type === 'dance' || type === 'party') {
          x += Math.round(amplitudeX * Math.sin(theta)); y -= Math.round(amplitudeY * Math.cos(theta));
        } else if (type === 'stroll' || type === 'chase' || type === 'parade') {
          const vertical = verticalWalk;
          if (vertical) y += Math.round(amplitudeY * Math.sin(theta)); else x += Math.round(amplitudeX * Math.sin(theta));
          if (type === 'parade' && !vertical) y -= Math.round(Math.min(2, amplitudeY) * (1 - Math.cos(theta * 2)) / 2);
        } else if (type === 'battle') {
          const axis = object.combat?.axis || object.worldEncounter?.axis || 'horizontal';
          // A brief anticipation, committed strike, contact hold and recovery
          // make each genuine weapon sequence read as an action, not a dance.
          const strike = beat < .12 ? -Math.sin(beat / .12 * Math.PI) * .35 : beat < .6 ? Math.sin((beat - .12) / .48 * Math.PI / 2)
            : beat < .7 ? 1 : Math.max(0, 1 - (beat - .7) / .3);
          const opponentBeat = combatBeat(frame, 1 - side, battleCycles), recoil = opponentBeat >= .64 && opponentBeat <= .82 ? Math.sin((opponentBeat - .64) / .18 * Math.PI) : 0;
          const move = defensive ? -recoil * .2 : strike - recoil * .85;
          if (axis === 'vertical') y += Math.round(amplitudeY * move * (side ? -1 : 1));
          else x += Math.round(amplitudeX * move * (side ? -1 : 1));
        } else if (type === 'boss' || type === 'duel') {
          x += Math.round(amplitudeX * Math.sin(theta)); y += Math.round(amplitudeY * Math.sin(theta + Math.PI / 2));
        } else if (type === 'idle') y += Math.round(Math.min(1, amplitudeY) * Math.sin(theta));
        const values = { pieceId: raw.pieceId, x: Math.round(raw.x + x), y: Math.round(raw.y + y) };
        if (['stroll', 'chase', 'parade'].includes(type) && !verticalWalk && amplitudeX > 0 && /left|right/i.test(model.preset.label || '')) {
          values.flipX = movingForward === /left/i.test(model.preset.label) ? !object.flipX : !!object.flipX;
        }
        if (type === 'projectile') values.visible = visible;
        if (type === 'battle' && combatActions.size && !defensive) {
          const incoming = combatBeat(frame, 1 - side, battleCycles);
          values.visible = !(incoming >= .66 && incoming < .78 && frame % 2 === 0);
        }
        const signature = JSON.stringify(values);
        if (signature !== previous) { keys.push({ frame, values, easing: 'hold' }); previous = signature; }
        rects.push({ x: x + envelope.x, y: y + envelope.y, w: envelope.w, h: envelope.h });
      }
      const bounds = union(rects);
      if (bounds.x < cell.x || bounds.y < cell.y || right(bounds) > right(cell) || bottom(bounds) > bottom(cell)) throw new Error('An animated encounter extends beyond its safe area.');
      const moving = keys.some(key => key.values.x !== keys[0].values.x || key.values.y !== keys[0].values.y || key.values.pieceId !== keys[0].values.pieceId || key.values.visible !== keys[0].values.visible);
      if (moving) { animatedObjectCount++; activityTypes.add(type); }
      object.worldAnimation = { ...(object.worldAnimation || {}), version: 1, activity: type, presetId: model.preset.id,
        presetIds: [...new Set([...battleModels.map(value => value.preset.id), ...(model.reverseModel ? [model.reverseModel.preset.id] : [])])], speed, motionBounds: bounds, editorChoreography: true };
      if (model.action) {
        object.worldCombat = { ...object.worldCombat, actionId: model.action.id, actionIds: battleModels.map(value => value.action?.id).filter(Boolean),
          weapons: [...new Set(battleModels.map(value => value.action?.weapon).filter(Boolean))], phases: ['anticipation', 'attack', 'contact', 'recovery'], cycles: activity.combatCycles || 3,
          editorAssembly: battleModels.some(value => value.action?.assembly) };
        if (object.worldCombat.editorAssembly && !object.pieceName.includes('editor assembly')) object.pieceName += ' · editor assembly';
      }
      delete object.simpleAnimation;
      tracks.push({ id: 'world-track-' + object.id, objectId: object.id, name: egg.name + (String(object.sourceId).startsWith('full-boss-') ? ' · editor assembly' : ''), locked: false, muted: false, keys: prop ? [] : keys });
      const previousBounds = activityBounds.get(egg.id); activityBounds.set(egg.id, previousBounds ? union([previousBounds, bounds]) : bounds);
    }

    // The body tracks remain editable. Separate source-art tracks stage each
    // release and hit, so arrows, thrown items and impact flashes have real
    // owners and targets instead of drifting between unrelated encounters.
    let combatEffectCount = 0;
    const weaponTypes = new Set(), combatActors = actors.filter(object => object.combat?.actorKey &&
      (object.worldCombat?.actionIds?.length || object.worldAnimation?.role === 'duelist' || ['6504', '6530', '24932'].includes(String(object.sourceId))));
    const effectMap = new Map((combat.effects || []).map(effect => [effect.id, effect]));
    if (combatActors.length && effectMap.size) {
      const bodyClip = { width: scene.width, height: scene.height, fps, duration, exportScale: 1, objects: clone(objects), tracks: clone(tracks), transparent: false, color: scene.color };
      const frames = Array.from({ length: duration }, (_, frame) => engine.evaluateFrame(bodyClip, frame, { includeHidden: true }).objects);
      const perFrame = frames.map(frame => new Map(frame.filter(object => object.combat?.actorKey).map(object => [object.combat.actorKey, object])));
      const selected = new Map();
      for (const owner of shuffle(combatActors, random)) {
        const groupKey = owner.easterEggId + ':' + owner.combat.side;
        if (!selected.has(groupKey) || String(owner.sourceId) === '6369') selected.set(groupKey, owner);
      }
      const actionAt = (owner, frame) => {
        const choices = owner.worldCombat?.actionIds?.map(id => combatActions.get(id)).filter(Boolean) || [];
        if (choices.length) {
          const index = Math.floor(frame / duration * (choreography.get(owner.easterEggId).combatCycles || 3) - (owner.combat.side || 0) * .5);
          return choices[((index % choices.length) + choices.length) % choices.length];
        }
        const stone = ['6504', 'full-boss-6506', 'full-boss-535841'].includes(String(owner.sourceId));
        return { id: 'world-' + owner.sourceId + '-magic', weapon: stone ? 'stone' : 'magic', effectId: stone ? 'stone' : 'fireball', releasePhase: .4 };
      };
      const effectPieces = (effect, direction) => {
        const native = effect?.directions?.[direction] || effect?.directions?.[direction === 'right' ? 'left' : direction];
        const ids = native || effect?.pieceIds;
        if (!ids?.length || !native && effect.direction && effect.direction !== 'neutral' && effect.direction !== direction && !(effect.direction === 'left' && direction === 'right')) return [];
        return ids.map(resolvePiece).filter(Boolean);
      };
      for (const owner of selected.values()) {
        const egg = eggMap.get(owner.easterEggId), zone = zones.get(egg.locationId), target = actors.find(object => object.combat?.actorKey === owner.combat.targetKey);
        if (!target) continue;
        for (const role of ['projectile', 'impact']) {
          const states = [], usedEffects = new Set(), targets = new Set([target.combat.actorKey]), blockedCycles = new Set();
          let valid = true, visibleFrames = 0, fallbackPiece = null;
          for (let frame = 0; frame < duration; frame++) {
            const action = actionAt(owner, frame), weapon = String(action.weapon || '').toLowerCase(), shield = /shield|guard/.test(weapon);
            weaponTypes.add(action.weapon || 'magic');
            const side = owner.combat.side || 0, beat = combatBeat(frame, shield ? 1 - side : side, choreography.get(owner.easterEggId).combatCycles || 3), release = releaseBeat(action);
            const cycle = Math.floor(frame / duration * (choreography.get(owner.easterEggId).combatCycles || 3) - side * .5);
            const impact = .64, returning = /boomerang/.test(weapon), direction = owner.combat.direction || 'left';
            const effectId = role === 'impact' ? /bomb/.test(weapon) ? 'explosion' : 'impact' : action.effectId;
            const effect = effectMap.get(effectId), poses = effectPieces(effect, direction);
            const projectile = role === 'projectile' && effect && !['impact', 'explosion'].includes(effect.id) && !shield;
            const show = role === 'impact' ? beat >= impact && beat < (effectId === 'explosion' ? .86 : .75)
              : projectile && beat >= release && beat < (returning ? .95 : impact);
            if (!poses.length) { states.push(null); continue; }
            const poseIndex = role === 'impact' ? Math.floor(clamp((beat - impact) / (effectId === 'explosion' ? .22 : .11), 0, .999) * poses.length)
              : Math.floor(frame * (effect.fps || 10) / fps) % poses.length;
            const piece = poses[Math.min(poses.length - 1, poseIndex)]; fallbackPiece ||= piece;
            const from = perFrame[frame].get(owner.combat.actorKey), to = perFrame[frame].get(target.combat.actorKey);
            if (!from || !to) { valid = false; break; }
            const horizontal = owner.combat.axis !== 'vertical';
            const fromPiece = resolvePiece(from.pieceId), toPiece = resolvePiece(to.pieceId);
            const feet = (object, piece) => ({ x: object.x + (object.flipX ? object.sw - (piece?.combatAnchor?.x ?? object.sw / 2) : piece?.combatAnchor?.x ?? object.sw / 2),
              y: object.y + (object.flipY ? object.sh - (piece?.combatAnchor?.y ?? object.sh) : piece?.combatAnchor?.y ?? object.sh) });
            const sourceFeet = feet(from, fromPiece), targetFeet = feet(to, toPiece);
            const source = { x: from.x + from.sw / 2, y: from.y + from.sh * .5 }, destination = toPiece?.combatAnchor ? { x: targetFeet.x, y: targetFeet.y - Math.min(22, to.sh * .45) }
              : { x: to.x + to.sw / 2, y: to.y + to.sh * .5 };
            const representative = resolvePiece(action.representativePoseId);
            if (action.releasePoint && representative?.combatAnchor) {
              source.x = sourceFeet.x + (action.releasePoint.x - representative.combatAnchor.x) * (from.flipX ? -1 : 1);
              source.y = sourceFeet.y + (action.releasePoint.y - representative.combatAnchor.y) * (from.flipY ? -1 : 1);
            } else if (horizontal) source.x = side ? from.x : from.x + from.sw;
            else source.y = side ? from.y : from.y + from.sh;
            let progress = clamp((beat - release) / Math.max(.1, impact - release), 0, 1);
            if (returning && beat > impact) progress = clamp((.95 - beat) / (.95 - impact), 0, 1);
            let center = role === 'impact' ? shield ? source : destination : { x: source.x + (destination.x - source.x) * progress, y: source.y + (destination.y - source.y) * progress };
            if (role === 'projectile' && /bomb|stone|bone/.test(weapon)) center.y -= Math.sin(progress * Math.PI) * Math.min(12, zone.h / 8);
            const x = Math.round(clamp(center.x - piece.sw / 2, zone.x, right(zone) - piece.sw)), y = Math.round(clamp(center.y - piece.sh / 2, zone.y, bottom(zone) - piece.sh));
            if (piece.sw > zone.w || piece.sh > zone.h) { blockedCycles.add(cycle); states.push(null); continue; }
            if (show) {
              visibleFrames++; usedEffects.add(effectId);
              for (const other of frames[frame].filter(object => object.layer !== 'terrain' && object.visible !== false)) {
                if (!overlaps({ x, y, w: piece.sw, h: piece.sh }, box(other))) continue;
                if (other.combat?.actorKey === owner.combat.actorKey) continue;
                if (other.easterEggId === owner.easterEggId && other.combat?.side !== side && other.combat?.actorKey) targets.add(other.combat.actorKey);
                else { blockedCycles.add(cycle); break; }
              }
            }
            const mirror = direction === 'right' && !effect.directions?.right?.length && !!(effect.directions?.left?.length || effect.direction === 'left');
            states.push({ pieceId: piece.id, x, y, visible: !!show, flipX: mirror, flipY: false, _cycle: cycle, _effectId: effectId });
            if (!valid) break;
          }
          visibleFrames = 0; usedEffects.clear();
          for (const state of states) if (state) {
            if (blockedCycles.has(state._cycle)) state.visible = false;
            if (state.visible) { visibleFrames++; usedEffects.add(state._effectId); }
            delete state._cycle; delete state._effectId;
          }
          if (!valid || !visibleFrames || !fallbackPiece) continue;
          const id = owner.id + '-combat-' + role, fallback = states.find(Boolean);
          const effectObject = pieceObject(resolvePiece(fallback.pieceId), id, egg.id,
            role === 'impact' ? 'Weapon impact · editor choreography' : 'Weapon in flight · editor choreography');
          const keys = [], rects = []; let previous = '';
          for (let frame = 0; frame < duration; frame++) {
            const values = states[frame] || { ...fallback, visible: false };
            const signature = JSON.stringify(values); if (signature !== previous) { keys.push({ frame, values, easing: 'hold' }); previous = signature; }
            const piece = resolvePiece(values.pieceId); rects.push({ x: values.x, y: values.y, w: piece.sw, h: piece.sh });
          }
          const bounds = union(rects);
          Object.assign(effectObject, fallback, { visible: false, layer: 'overlay', combat: { ownerKey: owner.combat.actorKey,
            targetKey: target.combat.actorKey, targetKeys: [...targets], actionId: owner.combat.actionId || null,
            phase: role === 'impact' ? 'contact' : 'release', role, editorChoreography: true },
            worldAnimation: { role: 'combat-effect', activity: role === 'impact' ? 'impact' : 'weapon-flight',
              effectIds: [...usedEffects], motionBounds: bounds, editorChoreography: true } });
          effectObject.animationAnchor = 'top-left';
          objects.push(effectObject); tracks.push({ id: 'world-track-' + id, objectId: id, name: effectObject.pieceName, locked: false, muted: false, keys });
          combatEffectCount++; animatedObjectCount++; activityTypes.add(role === 'impact' ? 'impact' : 'weapon-flight');
          const previousBounds = activityBounds.get(egg.id); activityBounds.set(egg.id, previousBounds ? union([previousBounds, bounds]) : bounds);
        }
      }
    }
    const labels = { dance: 'A monster dance rehearsal', party: 'The Oracle afterparty', chase: 'A tiny chase around Hyrule', parade: 'A very unofficial Cucco parade', duel: 'A boss duel nobody scheduled' };
    const encounters = eggs.map(egg => ({ name: labels[choreography.get(egg.id).type] || egg.name, location: egg.location, region: egg.location, activity: choreography.get(egg.id).type,
      ...(activityBounds.get(egg.id) || egg.bounds), editorChoreography: true }));
    const animatedEggs = eggs.map(egg => ({ ...egg, name: labels[choreography.get(egg.id).type] || egg.name,
      bounds: activityBounds.get(egg.id) || egg.bounds, activity: choreography.get(egg.id).type,
      sourcePieceIds: [...new Set(objects.filter(object => object.easterEggId === egg.id).flatMap(object => [object.pieceId,
        ...(tracks.find(track => track.objectId === object.id)?.keys || []).map(key => key.values.pieceId).filter(Boolean)]))] }));
    const generated = { ...clone(scene.generated), kind: 'world-animation', story: 'Random Hyrule animation', encounters, easterEggs: animatedEggs,
      bossCount: objects.filter(object => String(object.sourceId).startsWith('full-boss-')).length,
      bossFamilies: [...new Set(objects.filter(object => String(object.sourceId).startsWith('full-boss-')).map(object => object.sourceId))],
      battleCount: animatedEggs.filter(egg => egg.battle).length,
      fps, duration, animatedObjectCount, duelCount, combatEffectCount, weaponTypes: [...weaponTypes].sort(),
      equippedActorCount: actors.filter(object => object.worldCombat?.actionIds?.length).length, activityTypes: [...activityTypes].sort(),
      requestedOptions: { ...clone(scene.generated.requestedOptions), fps, duration },
      note: 'New editor choreography using genuine game artwork. Weapon and multipart boss assemblies, movement, dances, fights and timing are authored for this editor, not extracted game-engine animation.' };
    return { id: scene.id + '-animation', name: 'Random Hyrule animation', width: scene.width, height: scene.height, exportScale: 1, fps, duration, loop: 'loop',
      color: scene.color, transparent: false, worldId: scene.worldId, worldStyle: scene.worldStyle, generated, objects, tracks };
  }
  function buildProject(options = {}) {
    const clip = buildClip(options);
    return { format: 'minish-cap-animation', version: 1, name: 'Random Hyrule animation', activeClip: clip.id, clips: [clip] };
  }
  window.MINISH_WORLD_ANIMATION = { buildClip, buildProject, version: 1 };
})();
