(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const studio = window.MINISH_STUDIO;
  if (!studio) return;

  function hash(text) {
    let value = 2166136261;
    for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return value >>> 0;
  }
  function randomFor(seed) {
    let value = hash(seed);
    return () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let t = Math.imul(value ^ value >>> 15, value | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function seedNow() {
    const bytes = new Uint32Array(2);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else { bytes[0] = Date.now() >>> 0; bytes[1] = Math.floor(Math.random() * 4294967296); }
    return [...bytes].map(value => value.toString(36)).join('-');
  }
  const shuffle = (list, random) => {
    const result = [...list];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  };

  // These sequence ranges were visually checked as whole, game-derived sprites.
  // A sheet can include detached parts, menu icons, or transformation frames, so
  // generation deliberately does not sample every cut from a source collection.
  const CAST = {
    boy: ['6379', [[1, 3], [16, 18]], false], girl: ['6379', [[4, 6], [19, 21], [28, 30]], false],
    vendor: ['6379', [[7, 15], [22, 27]], false], gentleman: ['6381', [[1, 12]], false],
    bandana: ['6381', [[13, 24]], false], brunette: ['6381', [[25, 36]], false], blonde: ['6381', [[37, 48]], false],
    greenChild: ['6387', [[1, 3], [16, 18], [31, 33], [46, 48]], false],
    blueChild: ['6387', [[4, 6], [19, 21], [34, 36]], false],
    brownChild: ['6387', [[7, 9], [22, 24], [37, 39]], false],
    smith: ['6377', [[1, 2]], false], carpenter: ['6384', [[1, 2]], false],
    cat: ['6402', [[1, 4]], true], dog: ['6400', [[1, 3]], true],
    whiteCucco: ['6403', [[1, 4], [8, 11]], true], yellowCucco: ['6403', [[5, 7], [12, 14]], true],
    zelda: ['22716', [[1, 10]], false], king: ['6375', [[2, 9]], false],
    guard: ['6391', [[1, 13]], true], festari: ['6392', [[1, 9]], false],
    gentari: ['6392', [[10, 18]], false], forestMinish: ['6392', [[22, 38]], true],
    octorok: ['6504', [[1, 5], [9, 12]], true], rope: ['6517', [[1, 8]], true],
    keese: ['6475', [[1, 6]], true], puffstool: ['6512', [[1, 4], [6, 8]], true],
    pesto: ['6511', [[7, 13]], true], chest: ['6514', [[6, 8]], false],
    fireball: ['6452', [[1, 4]], true], treasure: ['6514', [[6, 8]], true]
  };
  const PEOPLE = ['boy', 'girl', 'vendor', 'gentleman', 'bandana', 'brunette', 'blonde', 'greenChild', 'blueChild', 'brownChild', 'smith', 'carpenter'];
  const STORIES = {
    town: [
      { id: 'neighbors', name: 'Meeting the neighbors', mood: 'peaceful', actors: PEOPLE, counts: { actors: 2 }, formations: ['conversation', 'stroll'] },
      { id: 'town-gathering', name: 'A busy day in Hyrule', mood: 'lively', actors: PEOPLE, counts: { actors: 4 }, formations: ['gathering', 'stroll'] },
      { id: 'pets', name: 'An afternoon with the pets', mood: 'peaceful', actors: ['cat', 'dog', 'girl', 'boy'], counts: { actors: 3 }, formations: ['conversation', 'stroll'] },
      { id: 'cucco-chase', name: 'Cucco commotion', mood: 'lively', actors: ['whiteCucco', 'yellowCucco', 'boy'], counts: { actors: 4 }, formations: ['scatter', 'stroll'], hero: 'walking' },
      { id: 'royal-stroll', name: 'A stroll with Zelda', mood: 'peaceful', actors: ['zelda', 'girl', 'cat'], counts: { actors: 2 }, formations: ['conversation', 'stroll'] },
      { id: 'workday', name: 'A break from the workshop', mood: 'adventure', actors: ['smith', 'carpenter', 'boy', 'dog'], counts: { actors: 3 }, formations: ['gathering', 'stroll'], hero: 'walking' }
    ],
    castle: [
      { id: 'honor-guard', name: 'The honor guard', mood: 'peaceful', actors: ['guard'], counts: { actors: 2 }, formations: ['guard-line'] },
      { id: 'royal-visit', name: 'An audience at the castle', mood: 'peaceful', actors: ['king', 'zelda', 'guard'], counts: { actors: 3 }, formations: ['conversation', 'guard-line'] },
      { id: 'castle-gathering', name: 'The royal gathering', mood: 'lively', actors: ['zelda', 'king', 'guard'], counts: { actors: 4 }, formations: ['gathering', 'guard-line'] },
      { id: 'castle-watch', name: 'A change of watch', mood: 'adventure', actors: ['guard'], counts: { actors: 3 }, formations: ['stroll', 'guard-line'], hero: 'walking' }
    ],
    minish: [
      { id: 'village-greeting', name: 'A tiny welcome', mood: 'peaceful', actors: ['festari', 'forestMinish'], counts: { actors: 2 }, formations: ['conversation', 'stroll'] },
      { id: 'elder-council', name: 'A word with the elders', mood: 'peaceful', actors: ['festari', 'gentari', 'forestMinish'], counts: { actors: 3 }, formations: ['conversation', 'gathering'] },
      { id: 'village-neighbors', name: 'Life in Minish Village', mood: 'lively', actors: ['forestMinish'], counts: { actors: 4 }, formations: ['stroll', 'gathering'] },
      { id: 'village-journey', name: 'The start of a tiny adventure', mood: 'adventure', actors: ['forestMinish', 'gentari'], counts: { actors: 2 }, formations: ['stroll'], hero: 'walking' }
    ],
    woods: [
      { id: 'treasure-trail', name: 'A treasure in the clearing', mood: 'adventure', enemies: ['octorok', 'rope'], props: ['chest'], counts: { enemies: 1, props: 1 }, formations: ['scatter'], hero: 'walking', priority: ['props', 'enemies'] },
      { id: 'forest-patrol', name: 'Trouble on the forest trail', mood: 'adventure', enemies: ['octorok', 'rope', 'keese'], counts: { enemies: 3 }, formations: ['stroll', 'scatter'], hero: 'walking', oneSpecies: true },
      { id: 'mushroom-trail', name: 'The Puffstool patch', mood: 'lively', enemies: ['puffstool'], counts: { enemies: 2 }, formations: ['gathering', 'scatter'], oneSpecies: true },
      { id: 'forest-wings', name: 'Wings above the clearing', mood: 'lively', enemies: ['pesto', 'keese'], counts: { enemies: 2 }, formations: ['scatter', 'stroll'], hero: 'walking', oneSpecies: true },
      { id: 'quiet-woods', name: 'A quiet path through the woods', mood: 'peaceful', counts: {}, formations: ['stroll'] }
    ],
    boss: [
      { id: 'boss-standoff', name: 'Face to face with Vaati', mood: 'adventure', counts: {}, formations: ['standoff'] },
      { id: 'boss-volley', name: 'Vaati unleashes a volley', mood: 'lively', effects: ['fireball'], counts: { effects: 2 }, formations: ['standoff'], hero: 'battle' },
      { id: 'boss-duel', name: 'The final duel', mood: 'adventure', effects: ['fireball'], counts: { effects: 1 }, formations: ['standoff'], hero: 'battle' }
    ],
    home: [
      { id: 'friendly-visit', name: 'Someone at the door', mood: 'peaceful', actors: ['boy', 'girl', 'gentleman', 'brunette'], counts: { actors: 2 }, formations: ['conversation', 'stroll'] },
      { id: 'indoor-pets', name: 'The pets made themselves at home', mood: 'lively', actors: ['cat', 'dog', 'girl'], counts: { actors: 3 }, formations: ['scatter', 'gathering'] },
      { id: 'homecoming', name: 'Home from an adventure', mood: 'adventure', actors: ['smith', 'carpenter', 'boy'], counts: { actors: 2 }, formations: ['conversation'], hero: 'walking' },
      { id: 'afternoon-call', name: 'An afternoon with friends', mood: 'peaceful', actors: ['blonde', 'brunette', 'boy', 'girl'], counts: { actors: 3 }, formations: ['gathering', 'stroll'] }
    ],
    shop: [
      { id: 'errand', name: 'One more errand', mood: 'peaceful', actors: ['girl', 'gentleman', 'boy'], counts: { actors: 2 }, formations: ['stroll'] },
      { id: 'busy-shop', name: 'A busy little business', mood: 'lively', actors: ['brunette', 'blonde', 'boy', 'bandana'], counts: { actors: 4 }, formations: ['stroll', 'gathering'] },
      { id: 'unexpected-visitor', name: 'An unexpected customer', mood: 'adventure', actors: ['smith', 'guard', 'cat'], counts: { actors: 2 }, formations: ['conversation'], hero: 'walking' }
    ],
    school: [
      { id: 'study-group', name: 'A small study group', mood: 'peaceful', actors: ['greenChild', 'blueChild', 'brownChild'], counts: { actors: 3 }, formations: ['gathering', 'stroll'] },
      { id: 'school-break', name: 'Time for a break', mood: 'lively', actors: ['greenChild', 'blueChild', 'brownChild', 'girl'], counts: { actors: 4 }, formations: ['scatter'], hero: 'walking' },
      { id: 'new-student', name: 'A new face in class', mood: 'adventure', actors: ['boy', 'greenChild'], counts: { actors: 2 }, formations: ['conversation'] }
    ],
    dungeon: [
      { id: 'ancient-silence', name: 'The silence of an ancient room', mood: 'peaceful', counts: {}, formations: ['stroll'] },
      { id: 'dungeon-treasure', name: 'A chest worth finding', mood: 'adventure', props: ['chest'], counts: { props: 1 }, formations: ['scatter'], hero: 'walking' },
      { id: 'dungeon-wings', name: 'Something stirs in the shadows', mood: 'adventure', enemies: ['keese'], counts: { enemies: 2 }, formations: ['scatter'], hero: 'battle' },
      { id: 'dungeon-company', name: 'An unexpected companion', mood: 'lively', actors: ['guard'], counts: { actors: 1 }, formations: ['conversation'] }
    ],
    wild: [
      { id: 'wild-cucco-kingdom', name: 'The Cucco kingdom', mood: 'lively', actors: ['whiteCucco', 'yellowCucco', 'guard'], counts: { actors: 7 }, formations: ['gathering', 'guard-line', 'scatter'] },
      { id: 'wild-royal-trip', name: 'The royal field trip', mood: 'peaceful', actors: ['king', 'zelda', 'guard', 'forestMinish'], counts: { actors: 5 }, formations: ['stroll', 'gathering'] },
      { id: 'wild-boss-tea', name: 'Tea with a very large guest', mood: 'peaceful', actors: ['cat', 'dog', 'king'], bossCount: 1, counts: { actors: 3 }, formations: ['conversation', 'scatter'] },
      { id: 'wild-boss-summit', name: 'The boss summit', mood: 'adventure', bossCount: 2, counts: {}, formations: ['standoff'], hero: 'battle' },
      { id: 'wild-team-up', name: 'The impossible team-up', mood: 'adventure', actors: ['zelda', 'guard', 'forestMinish'], bossCount: 1, counts: { actors: 3 }, formations: ['stroll', 'scatter'], hero: 'battle' },
      { id: 'wild-portal-party', name: 'Everyone took the wrong portal', mood: 'lively', actors: ['king', 'forestMinish', 'whiteCucco', 'cat', 'smith', 'guard'], counts: { actors: 7 }, formations: ['scatter', 'gathering'], hero: 'walking' },
      { id: 'wild-midnight-parade', name: 'The midnight monster parade', mood: 'adventure', enemies: ['octorok', 'rope', 'keese', 'puffstool', 'pesto'], counts: { enemies: 6 }, formations: ['stroll', 'guard-line', 'scatter'], hero: 'battle' },
      { id: 'wild-treasure-rush', name: 'An unreasonable amount of treasure', mood: 'lively', props: ['treasure'], actors: ['boy', 'girl'], counts: { props: 5, actors: 2 }, formations: ['gathering', 'stroll'], priority: ['props', 'actors'] },
      { id: 'wild-cucco-escort', name: 'The most unlikely bodyguards', mood: 'lively', bossCount: 1, actors: ['whiteCucco', 'yellowCucco'], counts: { actors: 5 }, formations: ['guard-line', 'scatter'] },
      { id: 'wild-cloud-court', name: 'A court beyond the clouds', mood: 'peaceful', actors: ['king', 'zelda', 'guard', 'gentari'], counts: { actors: 5 }, formations: ['gathering', 'guard-line'] },
      { id: 'wild-pet-heroes', name: 'The pets save the day', mood: 'adventure', actors: ['cat', 'dog'], enemies: ['keese', 'pesto'], counts: { actors: 3, enemies: 2 }, formations: ['scatter', 'stroll'], hero: 'walking' },
      { id: 'wild-magic-weather', name: 'A forecast of magical trouble', mood: 'adventure', effects: ['fireball'], actors: ['festari', 'smith', 'guard'], counts: { actors: 3, effects: 4 }, formations: ['scatter'], hero: 'battle' }
    ]
  };

  // Foot rectangles here were reviewed against these clean room images. They
  // describe scene-editor placement areas, not collision data extracted from ROM.
  const ROOM_SETTINGS = [
    ['env-6377-home-empty', 'home', [42, 76, 150, 57]], ['env-6377-home-forge', 'home', [34, 76, 100, 35]],
    ['env-6507-bakery', 'shop', [45, 90, 150, 42]], ['env-6447-dampe', 'home', [55, 88, 120, 42]],
    ['env-6470-stockwell', 'shop', [48, 141, 142, 15]], ['env-34087-cafe', 'shop', [47, 72, 84, 40]],
    ['env-6555-post-office', 'shop', [45, 124, 147, 12]], ['env-6488-ranch-house-a', 'home', [56, 87, 121, 43]],
    ['env-6488-ranch-house-b', 'home', [47, 87, 143, 43]], ['env-34627-shoe-shop', 'shop', [50, 95, 147, 37]],
    ['env-16014-gallery-empty', 'shop', [47, 88, 148, 42]], ['env-16014-gallery', 'shop', [47, 109, 148, 21]],
    ['env-34626-simon', 'shop', [51, 115, 141, 15]], ['env-6479-library-a', 'school', [50, 133, 125, 10]],
    ['env-6479-library-b', 'school', [160, 211, 137, 15]], ['env-34658-school-entrance', 'school', [57, 118, 126, 74]],
    ['env-34658-school-classroom', 'school', [47, 145, 191, 2]],
    ['env-31009-wind-room-1', 'home', [66, 79, 112, 49]], ['env-31009-wind-room-2', 'home', [54, 84, 138, 40]],
    ['env-31009-wind-room-3', 'home', [51, 103, 146, 22]], ['env-31009-wind-room-4', 'home', [54, 84, 138, 40]],
    ['env-31009-wind-room-5', 'home', [54, 94, 138, 31]], ['env-31009-wind-room-6', 'home', [54, 84, 138, 40]],
    ['env-31009-wind-room-7', 'home', [58, 102, 130, 24]], ['env-31009-wind-room-8', 'home', [54, 84, 138, 40]],
    ['env-6450-elder', 'minish', [68, 79, 105, 43]], ['env-6548-minish-home-a', 'minish', [49, 84, 80, 35]],
    ['env-6548-minish-home-b', 'minish', [49, 84, 80, 35]], ['env-6548-minish-home-c', 'minish', [49, 84, 80, 35]],
    ['env-6548-minish-home-d', 'minish', [49, 84, 80, 35]], ['env-6548-minish-ice', 'minish', [101, 109, 39, 65]],
    ['env-6548-minish-cave', 'minish', [66, 85, 108, 12]], ['env-6550-librari-room', 'minish', [88, 145, 59, 36]],
    ['env-6560-mine-room-a', 'minish', [44, 105, 152, 23]], ['env-6560-mine-room-b', 'minish', [109, 80, 64, 24]],
    ['env-6560-mine-room-c', 'minish', [64, 124, 45, 10]],
    ['env-6440-castle-throne', 'castle', [65, 99, 142, 35], [0, 0, 272, 240]],
    ['env-6440-castle-bedroom', 'castle', [71, 158, 133, 8]],
    ['env-6518-crypt-b', 'dungeon', [83, 129, 113, 44]], ['env-6518-crypt-f', 'dungeon', [77, 105, 124, 42]],
    ['env-6519-valley-cave-a', 'dungeon', [62, 89, 120, 40]], ['env-6519-valley-cave-b', 'dungeon', [59, 93, 121, 33]],
    ['env-142447-wrath-hand-a', 'dungeon', [73, 119, 156, 53]], ['env-142447-wrath-hand-b', 'dungeon', [73, 119, 156, 53]],
    ['env-142448-inner-mazaal-a', 'dungeon', [76, 194, 120, 20], [0, 0, 272, 240]],
    ['env-142448-inner-mazaal-b', 'dungeon', [76, 194, 120, 20], [0, 0, 272, 240]]
  ];
  function cleanEnvironments() {
    const curated = window.MINISH_CURATED || {};
    const excluded = new Set(curated.excludedPieceIds || []), hidden = new Set(curated.hiddenSourceIds || []);
    return Object.values(curated.sheets || {}).filter(sheet => sheet.category === 'environments').flatMap(sheet => sheet.pieces || [])
      .filter(piece => piece.kind === 'environment' && piece.representation === 'gameplay-region' && piece.sw >= 160 && piece.sh >= 120 && !excluded.has(piece.id) && !hidden.has(piece.sourceId)
        && !/title|file.select|parallax/i.test(piece.name));
  }
  function settingTheme(region) {
    if (/sky|backdrop|vista|beanstalk|portal/i.test(region.name)) return 'sky';
    if (/crypt|mazaal|vaati|armos|sanctuary|shrine|cave|mine/i.test(region.name)) return 'dungeon';
    if (/minish|librari|elder/i.test(region.name)) return 'minish';
    if (/woods|forest|field|ranch|valley|crenel|wilds|lake/i.test(region.name)) return 'woods';
    if (/town|garden/i.test(region.name)) return 'town';
    return 'indoors';
  }
  function allTemplates() {
    const curated = window.MINISH_CURATED || {}, regions = cleanEnvironments(), regionMap = new Map(regions.map(region => [region.id, region]));
    const faithful = (curated.scenes || []).map(template => ({ ...template, style: 'faithful', storySet: template.id === 'castle-garden' ? 'castle' : template.theme }));
    for (const [regionId, storySet, floor, crop] of ROOM_SETTINGS) {
      const region = regionMap.get(regionId);
      if (!region) continue;
      const [sx, sy, width, height] = crop || [0, 0, region.sw, region.sh];
      if (sx + width > region.sw || sy + height > region.sh || width > 384 || height > 256) continue;
      const [x, y, w, h] = floor;
      faithful.push({ id: 'setting-' + regionId, name: region.name, theme: storySet === 'minish' || storySet === 'dungeon' ? storySet : 'indoors', storySet, style: 'faithful',
        sourceId: region.sourceId, width, height, background: { assetId: region.assetId, sx, sy, sw: width, sh: height },
        zones: [{ x, y, w, h, roles: ['actors', 'props', 'enemies', 'effects'] }], heroAnchor: { x: Math.round(x + w / 2), y: y + h }, reviewedRoom: true });
    }
    const wild = regions.map(region => {
      const width = Math.min(384, region.sw), height = Math.min(256, region.sh);
      const sx = Math.floor((region.sw - width) / 2), sy = Math.floor((region.sh - height) / 2);
      return { id: 'wild-' + region.id, name: region.name, theme: settingTheme(region), storySet: 'wild', style: 'wild', sourceId: region.sourceId, width, height,
        background: { assetId: region.assetId, sx, sy, sw: width, sh: height },
        zones: [{ x: 20, y: 42, w: width - 40, h: height - 62, roles: ['actors', 'enemies', 'props', 'effects'] }],
        heroAnchor: { x: Math.round(width / 2), y: height - 8 }, bossArea: { x: 12, y: 5, w: width - 24, h: height - 54 }, imaginative: true };
    });
    return [...faithful, ...wild];
  }
  function templateStories(template) {
    return (STORIES[template.storySet] || []).filter(story => !story.bossCount || (template.bossArea?.w >= 100 && template.bossArea?.h >= 62));
  }
  function experiences() {
    return allTemplates().flatMap(template => templateStories(template).map(story => ({ id: template.id + ':' + story.id, templateId: template.id, setting: template.name,
      backgroundId: template.background.assetId, storyId: story.id, story: story.name, theme: template.theme, style: template.style })));
  }
  function getPossibilities() {
    const templates = allTemplates(), choices = experiences();
    return { settings: new Set(templates.map(template => template.background.assetId)).size, faithfulSettings: templates.filter(template => template.style === 'faithful').length,
      wildSettings: templates.filter(template => template.style === 'wild').length, faithfulExperiences: choices.filter(choice => choice.style === 'faithful').length,
      wildExperiences: choices.filter(choice => choice.style === 'wild').length, totalExperiences: choices.length, storyCount: new Set(choices.map(choice => choice.storyId)).size };
  }

  function buildScene(options = {}) {
    const seed = String(options.seed || seedNow()).slice(0, 80), random = randomFor(seed);
    const curated = window.MINISH_CURATED || {}, theme = String(options.theme || 'any');
    const requestedStyle = ['faithful', 'wild', 'mixed'].includes(options.style) ? options.style : 'faithful';
    const available = allTemplates().filter(scene => (!options.templateId || scene.id === options.templateId) && (theme === 'any' || scene.theme === theme || theme === 'boss' && scene.style === 'wild'));
    const styles = [...new Set(available.map(scene => scene.style))];
    const style = requestedStyle === 'mixed' ? styles[Math.floor(random() * styles.length)] : requestedStyle;
    const templates = available.filter(scene => scene.style === style);
    if (!templates.length) throw new Error('No audited scene is available for that setting. Choose another setting.');
    const template = templates[Math.floor(random() * templates.length)];
    const width = Number(template.width || template.background?.sw || 240), height = Number(template.height || template.background?.sh || 160);
    const background = { ...template.background };
    if (!background.assetId || background.sw !== width || background.sh !== height) throw new Error('This scene has an invalid background mapping.');
    const excluded = new Set([...(window.MINISH_SPRITES?.excludedPieceIds || []), ...(curated.excludedPieceIds || [])]);
    const hidden = new Set(curated.hiddenSourceIds || []);
    const choose = list => list[Math.floor(random() * list.length)];
    const sourceStories = templateStories(template).filter(story => theme !== 'boss' || style !== 'wild' || story.bossCount);
    const requestedMood = String(options.mood || 'any');
    const matchingStories = sourceStories.filter(story => (requestedMood === 'any' || story.mood === requestedMood) && (!options.storyId || story.id === options.storyId));
    const story = choose(matchingStories.length ? matchingStories : sourceStories);
    if (!story) throw new Error('No story fits this setting. Choose another setting.');
    const density = ['quiet', 'balanced', 'lively'].includes(options.density) ? options.density : choose(['quiet', 'balanced', 'balanced', 'lively']);
    const formation = choose(story.formations || ['scatter']);
    const piece = entry => {
      const spec = typeof entry === 'string' ? { pieceId: entry } : entry || {};
      const result = studio.getPiece(spec.pieceId || spec.id);
      if (!result || excluded.has(result.id) || hidden.has(result.sourceId) || ['reference', 'label', 'palette'].includes(result.kind)) return null;
      return { ...result, identity: String(spec.identity || result.sourceId), repeatable: !!spec.repeatable, generationLabel: spec.label || result.name };
    };
    const pool = entries => (entries || []).map(piece).filter(Boolean);
    function castPool(key) {
      const spec = CAST[key];
      if (!spec) return [];
      const [sourceId, ranges, repeatable] = spec;
      return pool((curated.sheets?.[sourceId]?.pieces || []).filter(p => ranges.some(([low, high]) => p.sequence >= low && p.sequence <= high))
        .map(p => ({ pieceId: p.id, identity: key, repeatable })));
    }
    function castChoices(keys, target) {
      const groups = shuffle((keys || []).map(key => castPool(key)).filter(group => group.length), random);
      if (story.oneSpecies && groups.length) groups.splice(1);
      const result = [];
      for (let pass = 0; pass < Math.max(1, target); pass++) {
        for (const group of groups) if (!pass || group[0].repeatable) result.push(choose(group));
      }
      return result;
    }

    // Camera shifts preserve the same reviewed world-space walk zones. They do
    // not assume that other areas on a large source map are safe placement ground.
    const asset = (studio.assets || []).find(a => String(a.id) === String(background.assetId));
    const baseAnchor = template.heroAnchor || (template.anchors || []).find(anchor => anchor.role === 'hero') || null;
    const cameras = [];
    for (const dx of [-24, -16, -8, 0, 8, 16, 24]) for (const dy of [-16, -8, 0, 8, 16]) {
      if (baseAnchor && (baseAnchor.x - dx < 16 || baseAnchor.x - dx > width - 16 || baseAnchor.y - dy < 32 || baseAnchor.y - dy > height)) continue;
      if (background.sx + dx >= 0 && background.sy + dy >= 0 && background.sx + dx + width <= (asset?.width || width) && background.sy + dy + height <= (asset?.height || height)) cameras.push({ dx, dy });
    }
    const camera = cameras.length ? choose(cameras) : { dx: 0, dy: 0 };
    background.sx = (background.sx || 0) + camera.dx; background.sy = (background.sy || 0) + camera.dy;
    const zones = (template.zones || []).map(zone => ({ ...zone, x: zone.x - camera.dx, y: zone.y - camera.dy }));
    const objects = [{ id: 'random-background', kind: 'sprite', assetId: String(background.assetId),
      sx: background.sx, sy: background.sy, sw: background.sw, sh: background.sh,
      x: 0, y: 0, scale: 1, flipX: false, flipY: false, keyColor: null, layer: 'terrain', background: true,
      sourceId: String(background.sourceId || template.sourceId || background.assetId), pieceName: template.name, generationRole: 'background' }];
    const occupied = [], used = new Set();
    const integer = (low, high) => Math.round(low + random() * Math.max(0, high - low));
    const overlaps = (a, b) => a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
    function sprite(p, x, y, role) {
      return { id: 'random-' + objects.length, kind: 'sprite', assetId: p.assetId,
        sx: p.sx, sy: p.sy, sw: p.sw, sh: p.sh, x, y, scale: 1,
        flipX: false, flipY: false, keyColor: p.keyColor || null, layer: role === 'effects' ? 'overlay' : 'objects',
        sourceId: p.sourceId, pieceId: p.id, pieceName: p.generationLabel || p.name, generationRole: role };
    }
    function formationFoot(zone, index, count) {
      const midX = zone.x + zone.w / 2, midY = zone.y + zone.h / 2;
      if (formation === 'guard-line') return { x: zone.x + zone.w * (index + 1) / (count + 1), y: midY - 4 };
      if (formation === 'stroll') return { x: zone.x + zone.w * (index + 1) / (count + 1), y: midY + (index % 2 ? 5 : -5) };
      if (formation === 'conversation') return { x: midX + (index % 2 ? 22 : -22), y: midY + (index % 3 - 1) * 10 };
      if (formation === 'gathering') { const angle = (index / Math.max(3, count)) * Math.PI * 2; return { x: midX + Math.cos(angle) * Math.min(35, zone.w * .38), y: midY + Math.sin(angle) * Math.min(13, zone.h * .38) }; }
      return null;
    }
    function place(p, role, forced = null, index = 0, count = 1) {
      const roleZones = zones.filter(zone => zone.role === role || Array.isArray(zone.roles) && zone.roles.includes(role));
      if (!forced && !roleZones.length) return false;
      for (let attempt = 0; attempt < (forced ? 1 : 120); attempt++) {
        const zone = roleZones.length ? choose(roleZones) : null;
        const preferred = !forced && attempt < roleZones.length ? formationFoot(zone, index, count) : null;
        const foot = forced || preferred || { x: integer(zone.x, zone.x + zone.w), y: integer(zone.y, zone.y + zone.h) };
        if (!forced && (foot.x < zone.x || foot.x > zone.x + zone.w || foot.y < zone.y || foot.y > zone.y + zone.h)) continue;
        const x = Math.round(foot.x - p.sw / 2), y = Math.round(foot.y - p.sh), bounds = { x, y, w: p.sw, h: p.sh };
        if (x < 0 || y < 0 || x + p.sw > width || y + p.sh > height || occupied.some(box => overlaps(bounds, box))) continue;
        objects.push(sprite(p, x, y, role)); occupied.push(bounds); used.add(p.identity); return true;
      }
      return false;
    }
    if (template.theme === 'boss' || story.bossCount) {
      const bosses = window.MINISH_BOSSES || {}, sources = new Set(template.bossSourceIds || []), area = template.bossArea;
      const count = story.bossCount || 1;
      for (let index = 0; index < count; index++) {
        const slot = count === 1 ? area : { x: area.x + index * (area.w + 12) / count, y: area.y, w: (area.w - 12) / count, h: area.h };
        const families = Object.entries(bosses.sheets || {}).filter(([id]) => style === 'wild' || sources.has(id))
          .map(([, sheet]) => pool(sheet.pieces || []).filter(p => slot && p.sw <= slot.w && p.sh <= slot.h)).filter(list => list.length);
        if (!families.length) throw new Error('No complete boss pose fits this setting. Choose another setting.');
        const boss = choose(choose(families));
        const x = Math.round(slot.x + (slot.w - boss.sw) / 2), y = Math.round(slot.y + (slot.h - boss.sh) / 2);
        objects.push(sprite(boss, x, y, 'boss')); occupied.push({ x, y, w: boss.sw, h: boss.sh });
      }
      if (style === 'faithful' && story.effects?.length) zones.push({ x: 30, y: 120, w: 180, h: 10, role: 'effects' });
    }
    const heroRanges = story.hero === 'walking' ? [[9, 48]] : story.hero === 'battle' ? [[28, 37], [47, 48]] : [[1, 8]];
    const expandedHeroes = (curated.sheets?.['6369']?.pieces || []).filter(p => heroRanges.some(([low, high]) => p.sequence >= low && p.sequence <= high)).map(p => p.id);
    const heroes = shuffle(pool(expandedHeroes.length ? expandedHeroes : template.heroes || (Array.isArray(template.hero) ? template.hero : template.hero ? [template.hero] : [])), random);
    const heroAnchor = baseAnchor ? { x: baseAnchor.x - camera.dx, y: baseAnchor.y - camera.dy } : null;
    if (!heroes.length || !heroes.some(hero => place(hero, 'actors', heroAnchor))) throw new Error('The hero could not be placed safely. Try another seed.');
    const counts = Object.fromEntries(['actors', 'enemies', 'props', 'effects'].map(role => {
      const base = story.counts?.[role] || 0;
      const adjusted = role === 'props' || role === 'effects' ? base : base ? Math.max(1, base + (density === 'quiet' ? -1 : density === 'lively' ? 1 : 0)) : 0;
      return [role, adjusted];
    }));
    for (const role of [...(story.priority || []), ...['actors', 'enemies', 'props', 'effects'].filter(role => !(story.priority || []).includes(role))]) {
      let placed = 0;
      const candidates = story[role] ? castChoices(story[role], counts[role]) : pool(template[role]);
      for (const candidate of candidates) {
        if (placed >= counts[role]) break;
        if (used.has(candidate.identity) && !candidate.repeatable) continue;
        if (place(candidate, role, null, placed, counts[role])) placed++;
      }
    }
    const layerRank = { terrain: 0, objects: 1, overlay: 2 };
    objects.sort((a, b) => layerRank[a.layer] - layerRank[b.layer] || a.y + a.sh - b.y - b.sh);
    return { id: 'generated-' + hash(seed + template.id + story.id + density + formation).toString(36), name: story.name + ' · ' + template.name.split(':')[0],
      width, height, preset: width === 240 && height === 160 ? 'game' : 'custom', exportScale: width === 240 ? 4 : 3,
      color: '#182a25', transparent: false, objects,
      generated: { version: 3, seed, theme: template.theme, templateId: template.id, sourceId: template.sourceId || null, libraryRevision: curated.generatedAt || curated.version || '4.0.0',
        storyId: story.id, story: story.name, mood: story.mood, requestedMood, density, formation, cameraOffset: camera,
        style, requestedStyle, imaginative: style === 'wild', requestedOptions: { theme, mood: requestedMood, density: options.density || 'varied', style: requestedStyle,
          ...(options.templateId ? { templateId: options.templateId } : {}), ...(options.storyId ? { storyId: options.storyId } : {}) },
        note: style === 'wild' ? 'Wild editor imagination using genuine game art. Cast, bosses, effects and environments are intentionally unlikely combinations; positions are creative arrangements, not verified game collision ground or reconstructed gameplay moments.'
          : 'A game-inspired editor assembly using genuine game artwork and reviewed placement areas. Cast, effects and camera framing are new compositions, rather than reconstructed gameplay moments.' } };
  }

  function announce(message) {
    if ($('randomStatus')) $('randomStatus').textContent = message;
    if ($('statusText')) $('statusText').textContent = message;
  }
  function updateAvailability() {
    const style = $('randomStyle')?.value || 'mixed', templates = allTemplates().filter(template => style === 'mixed' || template.style === style);
    const themes = new Set(templates.map(template => template.theme));
    if (templates.some(template => template.style === 'wild')) themes.add('boss');
    const themeControl = $('randomTheme');
    if (themeControl) {
      for (const option of Array.from(themeControl.options || [])) option.disabled = option.value !== 'any' && !themes.has(option.value);
      if (themeControl.value !== 'any' && !themes.has(themeControl.value)) themeControl.value = 'any';
    }
    if ($('randomPossibilities')) {
      const counts = getPossibilities();
      $('randomPossibilities').textContent = style === 'wild' ? 'Across all settings: ' + counts.wildExperiences + ' imaginative setting and story combinations across ' + counts.wildSettings + ' genuine game environments. Unlikely encounters are editor inventions.'
        : style === 'mixed' ? 'Across all settings: ' + counts.totalExperiences + ' setting and story combinations. Each surprise chooses Game-inspired or Wild mashups.'
          : 'Across all settings: ' + counts.faithfulExperiences + ' game-inspired setting and story combinations across ' + counts.faithfulSettings + ' reviewed placements. Every piece stays editable.';
    }
  }
  function open() {
    if (!$('randomDialog')) return;
    updateAvailability();
    announce('Create adds a new editable scene. Surprise me again rerolls a generated scene, and Undo restores it.');
    $('randomDialog').showModal();
  }
  if ($('randomSceneBtn')) $('randomSceneBtn').addEventListener('click', open);
  if ($('closeRandomBtn')) $('closeRandomBtn').addEventListener('click', () => $('randomDialog').close());
  if ($('randomStyle')) $('randomStyle').addEventListener('change', updateAvailability);
  let generating = false;
  function controlOptions() {
    return { theme: $('randomTheme')?.value || 'any', mood: $('randomMood')?.value || 'any', density: $('randomDensity')?.value || 'varied', style: $('randomStyle')?.value || 'mixed' };
  }
  async function generate(reroll = false) {
    if (generating) return null;
    generating = true;
    const button = $(reroll ? 'rerollSceneBtn' : 'generateSceneBtn'), label = button?.textContent;
    const controls = ['generateSceneBtn', 'rerollSceneBtn'].map($).filter(Boolean), previousDisabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    if (button) button.textContent = 'Building scene…';
    try {
      const requestedSeed = reroll ? '' : $('randomSeed')?.value.trim() || '', seed = requestedSeed || seedNow();
      const project = studio.project, active = project?.slides?.find(slide => slide.id === project.activeSlide);
      const previous = reroll && active?.generated;
      const options = previous ? previous.requestedOptions || { theme: previous.theme || 'any', mood: previous.requestedMood || 'any', density: previous.density || 'varied', style: previous.requestedStyle || previous.style || 'faithful' } : controlOptions();
      const result = buildScene({ ...options, seed });
      if (reroll && typeof studio.rerollScene === 'function') await studio.rerollScene(result);
      else await studio.insertScene(result);
      if (!reroll && $('randomSeed')) $('randomSeed').value = requestedSeed;
      if (!reroll && $('randomDialog')?.open) $('randomDialog').close();
      announce(result.generated.story + (reroll && previous ? ' replaces this generated scene.' : ' added.') + ' Seed ' + seed + '. Undo restores your previous view.');
      return result;
    } catch (error) { announce(error.message || 'Could not build this scene. Try another setting.'); return null; }
    finally {
      generating = false;
      controls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
      if (button) button.textContent = label;
    }
  }
  if ($('generateSceneBtn')) $('generateSceneBtn').addEventListener('click', () => generate(false));
  if ($('rerollSceneBtn')) $('rerollSceneBtn').addEventListener('click', () => generate(true));
  updateAvailability();
  window.MINISH_RANDOM = { buildScene, randomFor, open, reroll: () => generate(true), experiences, getPossibilities, updateAvailability,
    stories: Object.values(STORIES).flat().map(({ id, name, mood }) => ({ id, name, mood })), version: '4.2.0' };
})();
