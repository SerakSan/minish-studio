(() => {
  'use strict';
  // Ready loops are explicit, visually reviewed pose lists. Atlas rows also contain
  // directions, loose body parts and contributor notes, so they are never cycled.
  const POSE = ['pieceId', 'assetId', 'sx', 'sy', 'sw', 'sh', 'sourceId', 'pieceName', 'keyColor'];
  const MOVEMENT = ['x', 'y'];
  const SPEED = { slow: .5, normal: 1, fast: 2 };
  const MOTIONS = ['none', 'left', 'right', 'up', 'down', 'bob', 'outback'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalizeRotation = value => ((Math.round((Number(value) || 0) / 45) * 45) % 360 + 360) % 360;
  function rotateVector(x, y, degrees) {
    const index = normalizeRotation(degrees) / 45, q = Math.SQRT1_2;
    const cos = [1, q, 0, -q, -1, -q, 0, q][index], sin = [0, q, 1, q, 0, -q, -1, -q][index];
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  }
  function localOffset(width, height, point, scale, rotation) {
    const turned = rotateVector((point.x - width / 2) * scale, (point.y - height / 2) * scale, rotation);
    return { x: width * scale / 2 + turned.x, y: height * scale / 2 + turned.y };
  }
  const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const reverse = values => [...values].reverse();
  const swing = values => [...values, ...values.slice(1, -1).reverse()];
  // These fixed components have their own source mapping inside each flattened
  // assembly. Keep the component in place as the surrounding head or hands move.
  const ASSEMBLY_ANCHORS = {
    'full-boss-6415': 'Foot/base', 'full-boss-6460': 'Foot/base', 'full-boss-6506': 'Affine-scaled body',
    'full-boss-6546': 'Rocky shell/body', 'full-boss-535841': 'Head'
  };
  const definitions = [
    ['link-walk-toward', '6369', 'Walk toward', range(9, 17)],
    ['link-walk-right', '6369', 'Walk left', range(18, 27)],
    ['link-walk-away', '6369', 'Walk away', range(28, 37)],
    ['capless-walk-toward', '6370', 'Walk toward', range(9, 17)],
    ['capless-walk-right', '6370', 'Walk left', range(18, 26)],
    ['capless-walk-away', '6370', 'Walk away', range(27, 34)],
    ['zelda-walk-toward', '22716', 'Walk toward', range(1, 8)],
    ['zelda-walk-left', '22716', 'Walk left', range(9, 16)],
    ['zelda-walk-away', '22716', 'Walk away', range(17, 20)],
    ['zelda-walk-right', '22716', 'Walk right', range(21, 28)],
    ['gray-cat-walk', '6402', 'Gray cat · walk right', range(1, 4)],
    ['white-cat-walk', '6402', 'White cat · walk right', range(23, 26)],
    ['brown-cat-walk', '6402', 'Brown cat · walk right', range(52, 55)],
    ['cucco-step', '6403', 'White cucco · step', [1, 2, 3, 4]],
    ['dog-step-right', '6400', 'Dog · step right', [9, 10, 11]],
    ['dog-step-left', '6400', 'Dog · step left', [16, 17, 18, 19]],
    ['guard-step-left', '6391', 'Blue guard · step left', [29, 30, 31]],
    ['guard-step-toward', '6391', 'Blue guard · step toward', [32, 33, 34]],
    ['guard-step-away', '6391', 'Blue guard · step away', [35, 36, 37]],
    ['keese-flap', '6475', 'Flap wings', range(1, 6)],
    ['like-like-wobble', '6480', 'Wobble', range(1, 7)],
    ['sluggula-away', '6564', 'Crawl away', range(1, 4)],
    ['sluggula-right', '6564', 'Crawl right', range(5, 8)],
    ['sluggula-left', '6564', 'Crawl left', range(9, 12)],
    ['red-wisp-flame', '6448', 'Red skull · flicker', range(17, 20)],
    ['blue-wisp-flame', '6448', 'Blue skull · flicker', range(22, 25)],
    ['fireball-spin', '6452', 'Fireball · spin', range(1, 4)],
    ['fireball-flame', '6452', 'Flame · flicker', range(5, 8)],
    ['green-chuchu-expression', 'full-boss-6415', 'Expressions · editor assembly', range(1, 6), true],
    ['blue-chuchu-expression', 'full-boss-6460', 'Expressions · editor assembly', range(1, 6), true],
    ['octorok-leaf-turn', 'full-boss-6506', 'Leaf-covered turn · editor assembly', range(1, 8), true],
    ['octorok-leaf-turn-reverse', 'full-boss-6506', 'Leaf-covered reverse turn · editor assembly', reverse(range(1, 8)), true],
    ['octorok-burning-turn', 'full-boss-6506', 'Burning turn · editor assembly', range(9, 16), true],
    ['octorok-burning-turn-reverse', 'full-boss-6506', 'Burning reverse turn · editor assembly', reverse(range(9, 16)), true],
    ['octorok-frozen-turn', 'full-boss-6506', 'Frozen turn · editor assembly', range(17, 24), true],
    ['octorok-frozen-turn-reverse', 'full-boss-6506', 'Frozen reverse turn · editor assembly', reverse(range(17, 24)), true],
    ['gleerok-look-around', 'full-boss-6546', 'Head sweep · editor assembly', [2, 1, 3, 1], true],
    ['gleerok-lower-head', 'full-boss-6546', 'Lower and raise head · editor assembly', [2, 4, 4, 2], true],
    ['gleerok-damage-pulse', 'full-boss-6546', 'Damage flash · editor assembly', [4, 5], true],
    ['gyorg-red-shielded', 'full-boss-6461', 'Red Gyorg · shielded · editor assembly', [1, 4, 7, 4], true],
    ['gyorg-red-three-eyes', 'full-boss-6461', 'Red Gyorg · three eyes · editor assembly', [2, 5, 8, 5], true],
    ['gyorg-red-four-eyes', 'full-boss-6461', 'Red Gyorg · four eyes · editor assembly', [3, 6, 9, 6], true],
    ['gyorg-blue-eye-upper-left', 'full-boss-6461', 'Blue Gyorg · upper-left eye · editor assembly', swing([10, 14, 18, 22, 26]), true],
    ['gyorg-blue-eye-upper-right', 'full-boss-6461', 'Blue Gyorg · upper-right eye · editor assembly', swing([11, 15, 19, 23, 27]), true],
    ['gyorg-blue-eye-lower-right', 'full-boss-6461', 'Blue Gyorg · lower-right eye · editor assembly', swing([12, 16, 20, 24, 28]), true],
    ['gyorg-blue-eye-lower-left', 'full-boss-6461', 'Blue Gyorg · lower-left eye · editor assembly', swing([13, 17, 21, 25, 29]), true],
    ['mazaal-active-hands', 'full-boss-535841', 'Active hands · editor assembly', [1, 4, 7, 10, 13, 16, 19, 22], true],
    ['mazaal-one-disabled', 'full-boss-535841', 'One hand disabled · editor assembly', [2, 5, 8, 11, 14, 17, 20, 23], true],
    ['mazaal-inactive-hands', 'full-boss-535841', 'Inactive hands · editor assembly', [3, 6, 9, 12, 15, 18, 21, 24], true],
    ['vaati-reborn-transformation', 'full-boss-6534', 'Transformation · editor assembly', range(1, 24), true, false],
    ['vaati-reborn-moving', 'full-boss-6534', 'Robe movement · editor assembly', range(25, 36), true],
    ['vaati-reborn-casting', 'full-boss-6534', 'Cast and recover · editor assembly', swing(range(37, 42)), true],
    ['vaati-reborn-teleport-closed', 'full-boss-6534', 'Materialize · closed eye · editor assembly', range(43, 50), true, false],
    ['vaati-reborn-teleport-open', 'full-boss-6534', 'Dissolve · open eye · editor assembly', range(51, 57), true, false],
    ['vaati-reborn-teleport-pulse', 'full-boss-6534', 'Teleport pulse · editor assembly', range(43, 57), true],
    ['vaati-reborn-protective-eyes', 'full-boss-6534', 'Protective eyes · editor assembly', [59, 60], true],
    ['vaati-transfigured-closed', 'full-boss-31116', 'Closed orbs · editor assembly', [1, 4, 7, 10], true],
    ['vaati-transfigured-upper-eyes', 'full-boss-31116', 'Upper eyes open · editor assembly', [2, 5, 8, 11], true],
    ['vaati-transfigured-lower-eyes', 'full-boss-31116', 'Lower eyes open · editor assembly', [3, 6, 9, 12], true],
    ['vaati-transfigured-energy', 'full-boss-31116', 'Energy pulse · editor assembly', range(13, 16), true],
    ['vaati-transfigured-exposed', 'full-boss-31116', 'Exposed body · editor assembly', range(17, 20), true],
    ['vaati-wrath-body', 'full-boss-6535', 'Body cycle · editor assembly', range(1, 14), true],
    ['vaati-wrath-charge', 'full-boss-6535', 'Charging · editor assembly', range(26, 29), true],
    ['vaati-wrath-claws', 'full-boss-6535', 'Extended claws · editor assembly', swing(range(15, 19)), true],
    ['vaati-wrath-eyes', 'full-boss-6535', 'Four-eye pulse · editor assembly', range(22, 25), true],
    ['vaati-wrath-exposed', 'full-boss-6535', 'Exposed tremble · editor assembly', [30, 31], true]
  ];
  let animation = null, studio = null;
  const still = () => ({ id: 'still', label: 'Still pose', sourceId: null, poseIds: [], fps: 6, defaultHold: 2,
    description: 'Keep the chosen pose. Add movement below if you like.' });
  const textReveal = () => ({ id: 'text-reveal', label: 'Text reveal', sourceId: null, poseIds: [], fps: 6, defaultHold: 2,
    description: 'Reveal your full message, then hold it for reading.' });
  function init(engine = window.MINISH_ANIMATION, adapter = window.MINISH_STUDIO) {
    if (!engine || !adapter) throw new Error('Open the animation studio before choosing an animation.');
    animation = engine; studio = adapter; return api;
  }
  function ready() { if (!animation) init(); }
  function baseFor(value) {
    ready();
    if (value && typeof value === 'object') {
      return animation.currentClip.objects.find(object => object.id === value.id) || value;
    }
    return animation.currentClip.objects.find(object => object.id === value) || null;
  }
  function requireBase(value) {
    const base = baseFor(value);
    if (!base || !animation.currentClip.objects.some(object => object.id === base.id)) throw new Error('Choose a piece in this animation first.');
    return base;
  }
  function presetList(sourceId) {
    ready();
    const id = String(sourceId || ''), sheet = window.MINISH_CURATED?.sheets?.[id] || window.MINISH_BOSSES?.sheets?.[id];
    const pieces = sheet?.pieces || [];
    const legacy = !sheet || sheet.hidden || sheet.excluded ? [] : definitions.filter(definition => definition[1] === id).flatMap(([presetId, source, label, sequences, assembly, repeat = true]) => {
      const selected = sequences.map(sequence => pieces.find(piece => piece.sequence === sequence));
      if (selected.some(piece => !piece || piece.excluded || piece.hidden || !studio.getPiece?.(piece.id))) return [];
      return [{ id: presetId, label, sourceId: source, poseIds: selected.map(piece => piece.id), fps: 6, defaultHold: 2, assembly: !!assembly, repeat,
        anchorPart: ASSEMBLY_ANCHORS[id] || null,
        description: assembly ? (repeat ? 'An editor loop of assembled game sprites.' : 'Plays once, then holds the last assembled pose. A short clip extends to fit.') + ' The assembly and timing are editable, not extracted game frames.' : 'A reviewed loop of genuine poses. Speed and movement are editor settings.' }];
    });
    const combat = (window.MINISH_COMBAT_LIBRARY?.actions || []).filter(action => String(action.sourceId) === id).flatMap(action => {
      const selected = (action.poseIds || []).map(pieceId => studio.getPiece?.(pieceId));
      if (!selected.length || selected.some(piece => !piece || piece.excluded || piece.hidden)) return [];
      return [{ ...clone(action), sourceId: id, poseIds: selected.map(piece => piece.id),
        fps: action.fps || 6, defaultHold: action.defaultHold || 2, repeat: action.repeat !== false,
        combat: true, assembly: !!action.assembly, anchorPart: '__combat__',
        description: action.description || (action.inventoryDerivedProp ? 'Editor assembly: a genuine item sprite held by the character.' : action.assembly ? 'An editable weapon assembly made from genuine game parts.' : 'A reviewed weapon action using genuine game poses.') + ' Timing and movement are made for the editor.' }];
    });
    return [...legacy, ...combat];
  }
  function presetsFor(value) {
    ready();
    const base = baseFor(value);
    if (base?.kind === 'dialogue') return [{ ...still(), label: 'Full message' }, textReveal()];
    const source = base?.sourceId || (typeof value === 'string' ? value : value?.sourceId);
    return [still(), ...presetList(source)];
  }
  function cyclesFor(value) { return presetsFor(value); }
  function getRecipe(value) {
    const base = baseFor(value); if (!base) return null;
    const stored = base.simpleAnimation?.version === 1 ? base.simpleAnimation.recipe : null;
    const recipe = { presetId: 'still', motion: 'none', speed: 'normal', distance: 32, ...(stored ? clone(stored) : {}) };
    if (base.kind === 'dialogue') recipe.fullText = typeof stored?.fullText === 'string' ? stored.fullText : String(base.text || '');
    return recipe;
  }
  function previewHold(preset, speed = 'normal', fps = 12) {
    // Combat recipes use their reviewed reference hold at 12 FPS. This leaves
    // readable time for release, travel and recovery rather than a 7-frame toss.
    const cadence = typeof preset === 'object' ? preset.combat ? 12 / (preset.defaultHold || 2) : preset.fps || 6 : 6;
    return Math.max(1, Math.round(Number(fps) / (cadence * (SPEED[speed] || 1))));
  }
  const COMPANION_PROPS = [...POSE, ...MOVEMENT, 'visible', 'scale', 'rotation', 'flipX', 'flipY', 'layer'];
  function ownedCompanions(value) {
    const id = typeof value === 'object' ? value?.id : value;
    return animation.currentClip.objects.filter(object => object.simpleCompanion?.version === 1 && object.simpleCompanion.ownerId === id);
  }
  function companionModified(base) {
    const children = ownedCompanions(base), roles = base.simpleAnimation?.companionRoles || [];
    if (roles.some(role => !children.some(child => child.simpleCompanion.role === role))) return true;
    return children.some(child => JSON.stringify(projectKeys(animation.getTrack(child.id)?.keys, COMPANION_PROPS, animation.currentClip.duration)) !==
      JSON.stringify(projectKeys(child.simpleCompanion.generated, COMPANION_PROPS, animation.currentClip.duration)));
  }
  const critical = base => base.kind === 'dialogue' ? [...MOVEMENT, 'text'] : [...POSE, ...MOVEMENT];
  function projectKeys(keys, properties, duration) {
    return (Array.isArray(keys) ? keys : []).filter(key => key && key.values && typeof key.values === 'object' && key.frame >= 0 && key.frame < duration).flatMap(key => {
      const values = Object.fromEntries(properties.filter(prop => Object.prototype.hasOwnProperty.call(key.values, prop)).map(prop => [prop, key.values[prop]]));
      if (!Object.keys(values).length) return [];
      return [{ frame: key.frame, values, ...(('x' in values || 'y' in values) ? { easing: key.easing === 'linear' ? 'linear' : 'hold' } : {}) }];
    }).sort((a, b) => a.frame - b.frame);
  }
  function inspect(value) {
    const base = baseFor(value); if (!base) return { recipe: null, hasCustomKeys: false, modified: false, needsReplacement: false };
    const keys = animation.getTrack(base.id)?.keys || [], properties = critical(base), metadata = base.simpleAnimation;
    const actual = projectKeys(keys, properties, animation.currentClip.duration);
    const expected = metadata?.version === 1 && Array.isArray(metadata.generated) ? projectKeys(metadata.generated, properties, animation.currentClip.duration) : [];
    const modified = metadata?.version === 1 && (JSON.stringify(actual) !== JSON.stringify(expected) || companionModified(base));
    const hasCustomKeys = metadata?.version === 1 ? modified : !!actual.length;
    return { recipe: getRecipe(base), hasCustomKeys, modified: !!modified, needsReplacement: hasCustomKeys };
  }
  function replacementError() {
    const error = new Error('This piece has custom animation. Use Timeline to keep editing it, or replace its pose and movement with this ready animation. Other settings are kept.');
    error.code = 'SIMPLE_CUSTOM_KEYS'; return error;
  }
  function recipeFor(base, input) {
    const recipe = { ...getRecipe(base), ...clone(input || {}) };
    if (typeof recipe.presetId !== 'string' || !presetsFor(base).some(preset => preset.id === recipe.presetId)) throw new Error('Choose an animation available for this game piece.');
    if (!MOTIONS.includes(recipe.motion)) throw new Error('Choose one of the available movements.');
    if (!Object.prototype.hasOwnProperty.call(SPEED, recipe.speed)) throw new Error('Choose Slow, Normal or Fast.');
    if (recipe.distance == null || String(recipe.distance).trim() === '' || !Number.isFinite(Number(recipe.distance)) || Number(recipe.distance) < 0 || Number(recipe.distance) > 2048) throw new Error('Choose a movement distance from 0 to 2048 native pixels.');
    const result = { presetId: recipe.presetId, motion: recipe.motion, speed: recipe.speed, distance: Math.round(Number(recipe.distance)) };
    if (base.kind === 'dialogue') result.fullText = String(recipe.fullText ?? base.text ?? '').slice(0, 5000);
    return result;
  }
  function assemblyPartPoint(piece, label, flipX, flipY) {
    if (label === '__combat__') {
      if (!piece) return null;
      const point = piece.combatAnchor || { x: piece.sw / 2, y: piece.sh };
      return { x: flipX ? piece.sw - point.x : point.x, y: flipY ? piece.sh - point.y : point.y };
    }
    const part = piece?.sourceParts?.find(part => part.label === label), crop = piece?.compositionCrop;
    if (!part || !crop) return null;
    const x = part.at.x + part.sourceRect.w / 2 - crop.x + crop.padding;
    const y = part.at.y + part.sourceRect.h / 2 - crop.y + crop.padding;
    return { x: flipX ? piece.sw - x : x, y: flipY ? piece.sh - y : y };
  }
  function assemblyPoseOffset(base, piece, label) {
    if (!label) return null;
    const basePiece = studio.getPiece?.(base.pieceId);
    const from = assemblyPartPoint(basePiece, label, base.flipX, base.flipY), to = assemblyPartPoint(piece, label, base.flipX, base.flipY);
    if (!from || !to) return null;
    const scale = base.scale || 1;
    const category = window.MINISH_CURATED?.sheets?.[String(base.sourceId)]?.category || window.MINISH_BOSSES?.sheets?.[String(base.sourceId)]?.category || '';
    const centered = base.animationAnchor === 'center' || base.animationAnchor !== 'feet' && (base.layer === 'terrain' || ['objects', 'environments', 'full-bosses', 'complete-bosses'].includes(category));
    const heightChange = (base.sh - piece.sh) * scale, automaticTurn = rotateVector(0, centered ? 0 : heightChange / 2, base.rotation);
    const automaticX = base.animationAnchor === 'top-left' ? 0 : (base.sw - piece.sw) * scale / 2 + automaticTurn.x;
    const automaticY = base.animationAnchor === 'top-left' ? 0 : heightChange / 2 + automaticTurn.y;
    const fromOffset = localOffset(base.sw, base.sh, from, scale, base.rotation), toOffset = localOffset(piece.sw, piece.sh, to, scale, base.rotation);
    // Canonical key positions are whole pixels. Compensate for the engine's
    // rounded automatic pose offset rather than rounding two half-pixel shifts.
    return { x: Math.round(fromOffset.x - toOffset.x) - Math.round(automaticX), y: Math.round(fromOffset.y - toOffset.y) - Math.round(automaticY) };
  }
  function compile(base, recipe, clip) {
    const map = new Map(), put = (at, values) => { const key = map.get(at) || { frame: at, values: {}, easing: 'hold' }; Object.assign(key.values, values); map.set(at, key); };
    let duration = clip.duration;
    let calibratedOffset = () => null;
    if (recipe.presetId === 'text-reveal') {
      const letters = Array.from(recipe.fullText), hold = Math.max(1, Math.round(clip.fps * { slow: 3, normal: 2, fast: 1 }[recipe.speed] / 12));
      const required = letters.length ? letters.length * hold + Math.max(1, clip.fps) : 1;
      if (required > 600) throw new Error('This message needs more than 600 frames. Shorten it or choose a faster reveal.');
      duration = Math.max(duration, required); put(0, { text: '' });
      for (let i = 1; i <= letters.length; i++) put(i * hold, { text: letters.slice(0, i).join('') });
    } else if (recipe.presetId !== 'still') {
      const preset = presetsFor(base).find(preset => preset.id === recipe.presetId), hold = previewHold(preset, recipe.speed, clip.fps);
      if (preset.repeat === false) {
        const required = preset.poseIds.length * hold + Math.max(1, clip.fps);
        if (required > 600) throw new Error('This action needs more than 600 frames. Choose a faster speed.');
        duration = Math.max(duration, required);
      }
      const poseAt = at => preset.poseIds[preset.repeat === false ? Math.min(preset.poseIds.length - 1, Math.floor(at / hold)) : Math.floor(at / hold) % preset.poseIds.length];
      calibratedOffset = at => assemblyPoseOffset(base, studio.getPiece?.(poseAt(at)), preset.anchorPart);
      for (let at = 0; at < duration; at += hold) {
        const offset = calibratedOffset(at);
        put(at, { pieceId: poseAt(at), ...(offset ? { x: base.x + offset.x, y: base.y + offset.y } : {}) });
      }
    }
    if (recipe.motion !== 'none' && recipe.distance) {
      const period = Math.max(2, Math.round(clip.fps * 2 / SPEED[recipe.speed]));
      const travel = Math.max(1, Math.round(clip.fps * 2 / SPEED[recipe.speed]));
      const loops = Math.max(1, Math.round(duration / period));
      for (let at = 0; at < duration; at++) {
        let x = base.x, y = base.y;
        // Fit whole cycles into this clip so looping never jumps from a half
        // completed float back to its starting position.
        if (recipe.motion === 'bob') y -= Math.round(recipe.distance * (1 - Math.cos(at / duration * loops * Math.PI * 2)) / 2);
        else if (recipe.motion === 'outback') x += Math.round(recipe.distance * (1 - Math.cos(at / duration * loops * Math.PI * 2)) / 2);
        else {
          const distance = Math.round(recipe.distance * Math.min(1, at / travel));
          if (recipe.motion === 'left') x -= distance; else if (recipe.motion === 'right') x += distance;
          else if (recipe.motion === 'up') y -= distance; else if (recipe.motion === 'down') y += distance;
        }
        const offset = calibratedOffset(at);
        put(at, { x: x + (offset?.x || 0), y: y + (offset?.y || 0) });
      }
    }
    return { duration, keys: [...map.values()].sort((a, b) => a.frame - b.frame) };
  }
  function companionPlans(base, recipe) {
    const pack = window.MINISH_COMBAT_LIBRARY, preset = presetsFor(base).find(item => item.id === recipe.presetId);
    if (!preset?.combat || !['throw', 'ranged', 'magic'].includes(preset.kind) || !preset.effectId || !pack) return [];
    const effect = pack.getEffect?.(preset.effectId), impact = preset.impactEffectId && pack.getEffect?.(preset.impactEffectId);
    if (!effect?.pieceIds?.length) throw new Error('This action needs its game effects. Reopen the complete app folder.');
    const clip = animation.currentClip, hold = previewHold(preset, recipe.speed, clip.fps), period = Math.max(2, preset.poseIds.length * hold);
    const release = Math.min(period - 1, Math.max(1, Math.round(period * (preset.releasePhase || .5))));
    const flight = Math.max(2, Math.round(period * .3)), land = Math.min(period - 1, release + flight);
    const burstLength = Math.min(period - 1, Math.max(2, Math.round(clip.fps * .5 / (SPEED[recipe.speed] || 1))));
    const representative = studio.getPiece(preset.representativePoseId || preset.poseIds[0]);
    const pivot = representative?.combatAnchor || { x: (representative?.sw || base.sw) / 2, y: representative?.sh || base.sh };
    const muzzle = preset.releasePoint ? { x: preset.releasePoint.x - pivot.x, y: preset.releasePoint.y - pivot.y } : { x: 0, y: -12 };
    const direction = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[preset.direction] || [1, 0];
    const actorOnly = clone(base); delete actorOnly.simpleAnimation; delete actorOnly.simpleCompanion;
    const actorClip = { ...clip, objects: [actorOnly], tracks: [animation.getTrack(base.id)].filter(Boolean) };
    const actorFrames = Array.from({ length: clip.duration }, (_, frame) => animation.evaluateFrame(actorClip, frame, { includeHidden: true }).objects[0]);
    function hand(frame) {
      const actor = actorFrames[Math.min(clip.duration - 1, Math.max(0, frame))], piece = studio.getPiece(actor.pieceId);
      const anchor = piece?.combatAnchor || { x: actor.sw / 2, y: actor.sh };
      const offset = localOffset(actor.sw, actor.sh, { x: (actor.flipX ? actor.sw - anchor.x : anchor.x) + (actor.flipX ? -muzzle.x : muzzle.x),
        y: (actor.flipY ? actor.sh - anchor.y : anchor.y) + (actor.flipY ? -muzzle.y : muzzle.y) }, actor.scale, actor.rotation);
      return { actor, x: actor.x + offset.x, y: actor.y + offset.y };
    }
    function route(cycle) {
      const start = hand(cycle * period + release), scale = start.actor.scale;
      const vector = rotateVector(direction[0] * (start.actor.flipX ? -1 : 1), direction[1] * (start.actor.flipY ? -1 : 1), start.actor.rotation);
      const up = rotateVector(0, start.actor.flipY ? 1 : -1, start.actor.rotation);
      return { start, end: { x: start.x + vector.x * 48 * scale, y: start.y + vector.y * 48 * scale }, scale, up };
    }
    function plan(role, fx) {
      const keys = [];
      for (let at = 0; at < clip.duration; at++) {
        let cycle = Math.floor(at / period), age = at - cycle * period, visible = false, progress = 0;
        let path = route(cycle), point = path.start;
        if (role === 'burst') {
          cycle = Math.floor((at - land) / period); age = at - cycle * period - land;
          path = route(Math.max(0, cycle)); point = path.end;
          if (String(base.sourceId) === '6413') point = hand(at);
          visible = cycle >= 0 && age >= 0 && age < burstLength;
          progress = Math.max(0, Math.min(1, age / Math.max(1, burstLength - 1)));
        } else if (preset.weapon === 'boomerang') {
          visible = age >= release;
          progress = Math.max(0, Math.min(1, (age - release) / Math.max(1, period - release - 1)));
          const returnTo = hand(at), t = Math.sin(progress * Math.PI);
          const home = { x: path.start.x * (1 - progress) + returnTo.x * progress, y: path.start.y * (1 - progress) + returnTo.y * progress };
          const arc = Math.sin(progress * Math.PI * 2) * 7 * path.scale;
          point = { x: home.x + (path.end.x - path.start.x) * t + path.up.x * arc, y: home.y + (path.end.y - path.start.y) * t + path.up.y * arc };
        } else {
          visible = age >= release && age < land;
          progress = Math.max(0, Math.min(1, (age - release) / Math.max(1, land - release - 1)));
          const t = preset.effectId === 'gust' ? 1 - progress : progress;
          point = { x: path.start.x + (path.end.x - path.start.x) * t, y: path.start.y + (path.end.y - path.start.y) * t };
          const arc = Math.sin(progress * Math.PI) * (preset.weapon === 'bomb' ? 14 : preset.weapon === 'bone' ? 6 : 0) * path.scale;
          point.x += path.up.x * arc; point.y += path.up.y * arc;
        }
        const current = actorFrames[at], ids = fx.directions?.[preset.direction] || fx.pieceIds;
        const phase = preset.effectId === 'gust' ? 1 - progress : progress;
        const index = role === 'burst' || preset.effectId === 'gust' ? Math.min(ids.length - 1, Math.floor(phase * ids.length)) : Math.floor(at / Math.max(1, hold)) % ids.length;
        const piece = studio.getPiece(ids[index]);
        if (!piece) throw new Error('A game effect is missing from this action. Reopen the complete app folder.');
        const anchor = piece.effectAnchor || { x: piece.sw / 2, y: piece.sh / 2 };
        const offset = localOffset(piece.sw, piece.sh, { x: current.flipX ? piece.sw - anchor.x : anchor.x, y: current.flipY ? piece.sh - anchor.y : anchor.y }, current.scale, current.rotation);
        keys.push({ frame: at, easing: 'hold', values: { pieceId: piece.id,
          x: Math.round(point.x - offset.x), y: Math.round(point.y - offset.y),
          scale: current.scale, rotation: normalizeRotation(current.rotation), flipX: current.flipX, flipY: current.flipY, visible: visible && current.visible && path.start.actor.visible, layer: current.layer } });
      }
      return { role, effect: fx, keys, actionId: preset.id };
    }
    // Bob-ombs are the bomb themselves. Give their fuse an explosion, not an
    // unrelated second bomb thrown out of their face.
    if (String(base.sourceId) === '6413') return [plan('burst', pack.getEffect('explosion'))];
    return [plan('projectile', effect), ...(impact ? [plan('burst', impact)] : [])];
  }
  function syncCompanions(base, recipe) {
    const plans = companionPlans(base, recipe), existing = ownedCompanions(base), keep = new Set();
    for (const plan of plans) {
      const first = studio.getPiece(plan.keys[0].values.pieceId);
      const value = { kind: 'sprite', assetId: first.assetId, sourceId: first.sourceId, pieceId: first.id, pieceName: (base.pieceName || 'Action') + ' · ' + plan.role,
        sx: first.sx, sy: first.sy, sw: first.sw, sh: first.sh, scale: base.scale, x: plan.keys[0].values.x, y: plan.keys[0].values.y,
        rotation: normalizeRotation(base.rotation), flipX: base.flipX, flipY: base.flipY, layer: base.layer, visible: false, keyColor: first.keyColor || null, animationAnchor: 'top-left',
        simpleCompanion: { version: 1, ownerId: base.id, actionId: plan.actionId, role: plan.role, generated: clone(plan.keys) } };
      let child = existing.find(object => !keep.has(object.id) && object.simpleCompanion.role === plan.role);
      if (child) { animation.clearKeyProperties(child.id, COMPANION_PROPS); child = animation.updateObject(child.id, value, { keyframe: false }); }
      else child = animation.addObject(value);
      animation.setKeys(child.id, plan.keys.map(key => ({ ...key, raw: true }))); keep.add(child.id);
    }
    for (const child of existing) if (!keep.has(child.id)) animation.removeObject(child.id);
    return plans.map(plan => plan.role);
  }
  function apply(value, input = {}, options = {}) {
    const base = requireBase(value), recipe = recipeFor(base, input);
    if (inspect(base).needsReplacement && !options.replaceCustom) throw replacementError();
    const compiled = compile(base, recipe, animation.currentClip), properties = critical(base), extended = compiled.duration !== animation.currentClip.duration;
    const oldKeys = new Map((animation.getTrack(base.id)?.keys || []).map(key => [key.frame, key]));
    animation.batch(() => {
      if (compiled.duration !== animation.currentClip.duration) animation.configureClip({ duration: compiled.duration });
      // Clear just this recipe's properties. Visibility, styling and unrelated
      // character properties stay on their original frames.
      animation.clearKeyProperties(base.id, properties);
      const keys = compiled.keys.map(key => ({ ...key, raw: true,
        easing: ('x' in key.values || 'y' in key.values) ? 'hold' : oldKeys.get(key.frame)?.easing || 'hold' }));
      if (keys.length) animation.setKeys(base.id, keys);
      animation.updateObject(base.id, {
        ...(base.kind === 'dialogue' ? { text: recipe.fullText } : {}),
        ...(base.simpleCompanion ? { simpleCompanion: null } : {}),
        simpleAnimation: { version: 1, recipe, generated: projectKeys(keys, properties, compiled.duration), fps: animation.currentClip.fps, duration: compiled.duration }
      }, { keyframe: false });
      const roles = syncCompanions(baseFor(base.id), recipe), live = baseFor(base.id);
      animation.updateObject(base.id, { simpleAnimation: { ...live.simpleAnimation, companionRoles: roles } }, { keyframe: false });
      // A longer message can extend the clip. Existing ready loops should keep
      // playing for that extra time, while custom timeline edits stay untouched.
      if (extended) for (const other of animation.currentClip.objects) if (other.id !== base.id && other.simpleAnimation?.version === 1 && !inspect(other).needsReplacement) apply(other.id, getRecipe(other), options);
      animation.selectObject(base.id);
    });
    return getRecipe(base.id);
  }
  function compileRecipe(value, input = {}, clip = null) {
    ready();
    if (!value || !['sprite', 'dialogue'].includes(value.kind)) throw new Error('Choose a game sprite or dialogue to animate.');
    const timing = clip || animation.currentClip;
    if (!Number.isInteger(timing?.duration) || timing.duration < 1 || timing.duration > 600 || !Number.isInteger(timing.fps) || timing.fps < 1 || timing.fps > 60) throw new Error('Choose valid animation timing.');
    // A detached input must never resolve to an edited live object whose ID
    // happens to match a seeded generated clip. Compilation changes no state.
    const base = clone(value); delete base.id;
    const recipe = recipeFor(base, input);
    return clone({ ...compile(base, recipe, timing), recipe });
  }
  function finitePosition(value, fallback) {
    if (value === undefined) return fallback;
    if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('Use a number for piece placement.');
    const number = Math.round(Number(value));
    if (number < -100000 || number > 100000) throw new Error('Keep placement between -100000 and 100000 native pixels.');
    return number;
  }
  function place(value, patch = {}, options = {}) {
    const base = requireBase(value), x = finitePosition(patch.x, base.x), y = finitePosition(patch.y, base.y), dx = x - base.x, dy = y - base.y;
    const safe = ['scale', 'rotation', 'flipX', 'flipY', 'layer', 'visible', 'text', 'fontSize', 'w', 'h', 'color', 'box', 'animationAnchor'];
    const changes = Object.fromEntries(safe.filter(prop => Object.prototype.hasOwnProperty.call(patch, prop)).map(prop => [prop, patch[prop]]));
    const metadata = base.simpleAnimation?.version === 1 ? clone(base.simpleAnimation) : null;
    const transforming = ['scale', 'rotation', 'flipX', 'flipY', 'animationAnchor'].some(prop => prop in changes);
    if (metadata && transforming && companionModified(base) && !options.replaceCustom) throw replacementError();
    const recalibrate = !!metadata && (!inspect(base).needsReplacement || options.replaceCustom) && transforming &&
      presetsFor(base).some(preset => preset.id === metadata.recipe?.presetId && preset.anchorPart);
    const revealing = base.kind === 'dialogue' && metadata?.recipe?.presetId === 'text-reveal' && 'text' in changes;
    if (revealing && inspect(base).needsReplacement && !options.replaceCustom) throw replacementError();
    const keys = animation.getTrack(base.id)?.keys || [], moved = keys.filter(key => 'x' in key.values || 'y' in key.values).map(key => ({ frame: key.frame, raw: true, easing: key.easing,
      values: { ...('x' in key.values ? { x: finitePosition(key.values.x + dx) } : {}), ...('y' in key.values ? { y: finitePosition(key.values.y + dy) } : {}) } }));
    if (metadata && (dx || dy)) for (const key of metadata.generated || []) {
      if ('x' in key.values) key.values.x += dx; if ('y' in key.values) key.values.y += dy;
    }
    animation.batch(() => {
      animation.updateObject(base.id, { ...changes, x, y, ...(metadata ? { simpleAnimation: metadata } : {}) }, { keyframe: false });
      if ((dx || dy) && moved.length) animation.setKeys(base.id, moved);
      if (revealing) apply(base.id, { ...metadata.recipe, fullText: changes.text }, options);
      else if (recalibrate) apply(base.id, metadata.recipe, options);
      else if (base.kind === 'dialogue' && metadata && 'text' in changes) {
        metadata.recipe.fullText = String(changes.text || ''); animation.updateObject(base.id, { simpleAnimation: metadata }, { keyframe: false });
      }
      if (!revealing && !recalibrate && ownedCompanions(base.id).length) {
        if (metadata && !inspect(base.id).needsReplacement) syncCompanions(baseFor(base.id), metadata.recipe);
        else if (dx || dy) for (const child of ownedCompanions(base.id)) {
          const generated = clone(child.simpleCompanion); for (const key of generated.generated) { if ('x' in key.values) key.values.x += dx; if ('y' in key.values) key.values.y += dy; }
          animation.updateObject(child.id, { x: child.x + dx, y: child.y + dy, simpleCompanion: generated }, { keyframe: false });
          animation.setKeys(child.id, (animation.getTrack(child.id)?.keys || []).map(key => ({ ...key, raw: true, values: { ...key.values, ...('x' in key.values ? { x: key.values.x + dx } : {}), ...('y' in key.values ? { y: key.values.y + dy } : {}) } })));
        }
      }
      animation.selectObject(base.id);
    });
    return baseFor(base.id);
  }
  function moveBase(value, patch = {}, options = {}) {
    const base = requireBase(value);
    if ('dx' in patch || 'dy' in patch) return place(base.id, { ...patch, x: base.x + finitePosition(patch.dx, 0), y: base.y + finitePosition(patch.dy, 0) }, options);
    return place(base.id, patch, options);
  }
  function remove(value, options = {}) {
    const base = requireBase(value);
    if (inspect(base).needsReplacement && !options.replaceCustom) throw replacementError();
    animation.batch(() => { for (const child of ownedCompanions(base)) animation.removeObject(child.id); animation.clearKeyProperties(base.id, critical(base)); animation.updateObject(base.id, { simpleAnimation: null }, { keyframe: false }); });
    return baseFor(base.id);
  }
  function duplicate(value) {
    const base = requireBase(value); let copy;
    animation.batch(() => {
      copy = animation.duplicateObject(base.id);
      // A copied effect is an independent scene piece. Only duplicating its
      // actor should create another effect owned by that actor's copy.
      if (base.simpleCompanion) animation.updateObject(copy.id, { simpleCompanion: null }, { keyframe: false });
      if (copy.simpleAnimation?.version === 1) {
        const metadata = clone(copy.simpleAnimation), dx = copy.x - base.x, dy = copy.y - base.y;
        for (const key of metadata.generated || []) { if ('x' in key.values) key.values.x += dx; if ('y' in key.values) key.values.y += dy; }
        animation.updateObject(copy.id, { simpleAnimation: metadata }, { keyframe: false });
      }
      for (const child of ownedCompanions(base)) {
        const childCopy = animation.duplicateObject(child.id), dx = copy.x - base.x, dy = copy.y - base.y;
        const metadata = clone(child.simpleCompanion); metadata.ownerId = copy.id;
        for (const key of metadata.generated) { if ('x' in key.values) key.values.x += dx; if ('y' in key.values) key.values.y += dy; }
        animation.updateObject(childCopy.id, { x: child.x + dx, y: child.y + dy, simpleCompanion: metadata }, { keyframe: false });
      }
      animation.selectObject(copy.id);
    });
    return baseFor(copy.id);
  }
  function refreshAll(options = {}) {
    ready();
    const objects = animation.currentClip.objects.filter(base => base.simpleAnimation?.version === 1);
    if (!options.replaceCustom && objects.some(base => inspect(base).needsReplacement)) throw replacementError();
    animation.batch(() => { for (const base of objects) apply(base.id, getRecipe(base), options); });
    return objects.length;
  }
  const api = { init, presetsFor, cyclesFor, getRecipe, inspect, apply, compileRecipe, place, moveBase, remove, duplicate, refreshAll, previewHold, ownedCompanions,
    hasCustomKeys: value => inspect(value).hasCustomKeys,
    get coverage() { ready(); const sourceIds = [...new Set([...definitions.map(definition => definition[1]), ...(window.MINISH_COMBAT_LIBRARY?.actions || []).map(action => String(action.sourceId))])];
      const sources = sourceIds.filter(source => presetList(source).length), presets = sources.flatMap(presetList);
      return { presets: presets.length, sources, combatActions: presets.filter(preset => preset.combat).length,
      note: 'Reviewed ready actions from the downloaded collection, with movement for every piece. Multipart boss animations are editor assemblies. This is not a claim of complete game animation coverage.' }; } };
  window.MINISH_SIMPLE_ANIMATION = api;
})();
