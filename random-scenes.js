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
    octorok: ['6504', [[1, 4], [9, 12]], true], rope: ['6517', [[1, 12]], true],
    keese: ['6475', [[1, 6]], true], puffstool: ['6512', [[1, 4], [6, 8]], true],
    pesto: ['6511', [[7, 13]], true], chest: ['6514', [[6, 8]], false],
    fireball: ['6452', [[1, 4]], true], treasure: ['6514', [[6, 8]], true],
    din: ['24932', [[1, 6]], false], nayru: ['24932', [[7, 11]], false], farore: ['24932', [[12, 16]], false],
    ezlo: ['6373', [[1, 6]], false], vaati: ['6530', [[4, 4], [25, 34]], false],
    swordmaster: ['6396', [[13, 13], [16, 23], [29, 30]], true],
    mountainMinish: ['6394', [[1, 4], [9, 11]], true],
    dampe: ['6398', [[5, 9]], false], graveyardSpirit: ['6398', [[10, 18]], true]
  };
  const ARMED_CAST = { darknut: '64168', spearMoblin: '6556', octorok: '6504', keaton: '6472', stalfos: '6524', bobomb: '6413', vaati: '6530' };
  const directionName = value => ({ toward: 'down', away: 'up' }[value] || value);
  const canFace = (action, direction) => directionName(action.direction) === 'any' || directionName(action.direction) === direction ||
    ['left', 'right'].includes(direction) && ['left', 'right'].includes(directionName(action.direction));
  const mirrorAction = (action, direction) => ['left', 'right'].includes(directionName(action.direction)) && directionName(action.direction) !== direction;
  const combatActions = (sourceId, direction, weapons = null) => (window.MINISH_COMBAT_LIBRARY?.actions || []).filter(action =>
    String(action.sourceId) === String(sourceId) && canFace(action, direction) &&
    (!weapons?.length || weapons.includes(action.weapon)));
  const PEOPLE = ['boy', 'girl', 'vendor', 'gentleman', 'bandana', 'brunette', 'blonde', 'greenChild', 'blueChild', 'brownChild', 'smith', 'carpenter'];
  const STORIES = {
    town: [
      { id: 'neighbors', name: 'Meeting the neighbors', mood: 'peaceful', actors: PEOPLE, counts: { actors: 2 }, formations: ['conversation', 'stroll'] },
      { id: 'town-gathering', name: 'A busy day in Hyrule', mood: 'lively', actors: PEOPLE, counts: { actors: 4 }, formations: ['gathering', 'stroll'] },
      { id: 'pets', name: 'An afternoon with the pets', mood: 'peaceful', actors: ['cat', 'dog', 'girl', 'boy'], counts: { actors: 3 }, formations: ['conversation', 'stroll'] },
      { id: 'cucco-chase', name: 'Cucco commotion', mood: 'lively', actors: ['whiteCucco', 'yellowCucco', 'boy'], counts: { actors: 4 }, formations: ['scatter', 'stroll'], hero: 'walking' },
      { id: 'royal-stroll', name: 'A stroll with Zelda', mood: 'peaceful', actors: ['zelda', 'girl', 'cat'], counts: { actors: 2 }, formations: ['conversation', 'stroll'] },
      { id: 'workday', name: 'A break from the workshop', mood: 'adventure', actors: ['smith', 'carpenter', 'boy', 'dog'], counts: { actors: 3 }, formations: ['gathering', 'stroll'], hero: 'walking' },
      { id: 'oracle-outing', name: 'The Oracles have plans', mood: 'lively', actors: ['din', 'nayru', 'farore'], fixedCast: true, counts: { actors: 3 }, formations: ['gathering', 'stroll'] },
      { id: 'ezlo-reunion', name: 'Ezlo finally gets a proper visit', mood: 'peaceful', actors: ['ezlo', 'zelda'], fixedCast: true, counts: { actors: 2 }, formations: ['conversation'] },
      { id: 'swordmaster-break', name: 'Even swordmasters need lunch', mood: 'lively', actors: ['swordmaster', 'din', 'vendor'], counts: { actors: 3 }, formations: ['stroll', 'gathering'] }
    ],
    castle: [
      { id: 'honor-guard', name: 'The honor guard', mood: 'peaceful', actors: ['guard'], counts: { actors: 2 }, formations: ['guard-line'] },
      { id: 'royal-visit', name: 'An audience at the castle', mood: 'peaceful', actors: ['king', 'zelda', 'guard'], counts: { actors: 3 }, formations: ['conversation', 'guard-line'] },
      { id: 'castle-gathering', name: 'The royal gathering', mood: 'lively', actors: ['zelda', 'king', 'guard'], counts: { actors: 4 }, formations: ['gathering', 'guard-line'] },
      { id: 'castle-watch', name: 'A change of watch', mood: 'adventure', actors: ['guard'], counts: { actors: 3 }, formations: ['stroll', 'guard-line'], hero: 'walking' },
      { id: 'oracle-audience', name: 'An audience for the Oracles', mood: 'lively', actors: ['din', 'nayru', 'farore', 'king'], fixedCast: true, counts: { actors: 4 }, formations: ['guard-line', 'gathering'] },
      { id: 'castle-sword-school', name: 'The royal sword lesson', mood: 'adventure', actors: ['swordmaster', 'zelda', 'guard'], counts: { actors: 3 }, formations: ['guard-line'], hero: 'walking' }
    ],
    minish: [
      { id: 'village-greeting', name: 'A tiny welcome', mood: 'peaceful', actors: ['festari', 'forestMinish'], counts: { actors: 2 }, formations: ['conversation', 'stroll'] },
      { id: 'elder-council', name: 'A word with the elders', mood: 'peaceful', actors: ['festari', 'gentari', 'forestMinish'], counts: { actors: 3 }, formations: ['conversation', 'gathering'] },
      { id: 'village-neighbors', name: 'Life in Minish Village', mood: 'lively', actors: ['forestMinish'], counts: { actors: 4 }, formations: ['stroll', 'gathering'] },
      { id: 'village-journey', name: 'The start of a tiny adventure', mood: 'adventure', actors: ['forestMinish', 'gentari'], counts: { actors: 2 }, formations: ['stroll'], hero: 'walking' },
      { id: 'minish-ezlo-homecoming', name: 'Ezlo meets his old friends', mood: 'peaceful', actors: ['ezlo', 'gentari', 'festari'], fixedCast: true, counts: { actors: 3 }, formations: ['conversation', 'gathering'] },
      { id: 'minish-mountain-visitors', name: 'Visitors from the mountain', mood: 'lively', actors: ['mountainMinish', 'forestMinish', 'gentari'], counts: { actors: 4 }, formations: ['stroll', 'gathering'] }
    ],
    woods: [
      { id: 'treasure-trail', name: 'A treasure in the clearing', mood: 'adventure', enemies: ['octorok', 'rope'], props: ['chest'], counts: { enemies: 1, props: 1 }, formations: ['scatter'], hero: 'walking', priority: ['props', 'enemies'] },
      { id: 'forest-patrol', name: 'Trouble on the forest trail', mood: 'adventure', enemies: ['octorok', 'rope', 'keese'], counts: { enemies: 3 }, formations: ['stroll', 'scatter'], hero: 'walking', oneSpecies: true },
      { id: 'mushroom-trail', name: 'The Puffstool patch', mood: 'lively', enemies: ['puffstool'], counts: { enemies: 2 }, formations: ['gathering', 'scatter'], oneSpecies: true },
      { id: 'forest-wings', name: 'Wings above the clearing', mood: 'lively', enemies: ['pesto', 'keese'], counts: { enemies: 2 }, formations: ['scatter', 'stroll'], hero: 'walking', oneSpecies: true },
      { id: 'quiet-woods', name: 'A quiet path through the woods', mood: 'peaceful', counts: {}, formations: ['stroll'] },
      { id: 'forest-ambush', name: 'An ambush on the forest path', mood: 'adventure', enemies: ['octorok', 'rope', 'keese'], counts: { enemies: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies'] },
      { id: 'forest-swordmaster', name: 'A sword lesson with an interruption', mood: 'adventure', actors: ['swordmaster'], enemies: ['octorok'], counts: { actors: 1, enemies: 1 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies', 'actors'] },
      { id: 'forest-oracle-trail', name: 'An Oracle off the beaten path', mood: 'peaceful', actors: ['din', 'nayru', 'farore', 'ezlo'], counts: { actors: 1 }, formations: ['conversation'] }
    ],
    boss: [
      { id: 'boss-standoff', name: 'Face to face with Vaati', mood: 'adventure', counts: {}, formations: ['standoff'], hero: 'battle', battle: 'boss-assault' },
      { id: 'boss-volley', name: 'Vaati unleashes a volley', mood: 'lively', effects: ['fireball'], counts: { effects: 2 }, formations: ['standoff'], hero: 'battle', battle: 'boss-assault' },
      { id: 'boss-duel', name: 'The final duel', mood: 'adventure', effects: ['fireball'], counts: { effects: 1 }, formations: ['standoff'], hero: 'battle', battle: 'boss-assault' },
      { id: 'boss-royal-rescue', name: 'A rescue beneath the dark castle', mood: 'adventure', actors: ['zelda'], effects: ['fireball'], counts: { actors: 1, effects: 2 }, formations: ['standoff'], hero: 'battle', battle: 'rescue' },
      { id: 'boss-last-line', name: 'The last line of defense', mood: 'lively', actors: ['guard', 'swordmaster'], effects: ['fireball'], counts: { actors: 2, effects: 2 }, formations: ['standoff'], hero: 'battle', battle: 'boss-assault' },
      { id: 'boss-ezlo-return', name: 'Ezlo has unfinished business', mood: 'adventure', actors: ['ezlo'], effects: ['fireball'], counts: { actors: 1, effects: 1 }, formations: ['standoff'], hero: 'battle', battle: 'boss-assault' }
    ],
    home: [
      { id: 'friendly-visit', name: 'Someone at the door', mood: 'peaceful', actors: ['boy', 'girl', 'gentleman', 'brunette'], counts: { actors: 2 }, formations: ['conversation', 'stroll'] },
      { id: 'indoor-pets', name: 'The pets made themselves at home', mood: 'lively', actors: ['cat', 'dog', 'girl'], counts: { actors: 3 }, formations: ['scatter', 'gathering'] },
      { id: 'homecoming', name: 'Home from an adventure', mood: 'adventure', actors: ['smith', 'carpenter', 'boy'], counts: { actors: 2 }, formations: ['conversation'], hero: 'walking' },
      { id: 'afternoon-call', name: 'An afternoon with friends', mood: 'peaceful', actors: ['blonde', 'brunette', 'boy', 'girl'], counts: { actors: 3 }, formations: ['gathering', 'stroll'] },
      { id: 'oracle-housewarming', name: 'The Oracles move in', mood: 'lively', actors: ['din', 'nayru', 'farore'], fixedCast: true, counts: { actors: 3 }, formations: ['gathering', 'stroll'] },
      { id: 'ezlo-workshop', name: 'Ezlo inspects the workshop', mood: 'adventure', actors: ['ezlo', 'smith', 'mountainMinish'], counts: { actors: 3 }, formations: ['conversation'] }
    ],
    shop: [
      { id: 'errand', name: 'One more errand', mood: 'peaceful', actors: ['girl', 'gentleman', 'boy'], counts: { actors: 2 }, formations: ['stroll'] },
      { id: 'busy-shop', name: 'A busy little business', mood: 'lively', actors: ['brunette', 'blonde', 'boy', 'bandana'], counts: { actors: 4 }, formations: ['stroll', 'gathering'] },
      { id: 'unexpected-visitor', name: 'An unexpected customer', mood: 'adventure', actors: ['smith', 'guard', 'cat'], counts: { actors: 2 }, formations: ['conversation'], hero: 'walking' },
      { id: 'oracle-shopping', name: 'A very magical shopping trip', mood: 'lively', actors: ['din', 'nayru', 'farore', 'vendor'], counts: { actors: 3 }, formations: ['stroll', 'gathering'] },
      { id: 'swordmaster-shopping', name: 'The swordmaster needs supplies', mood: 'adventure', actors: ['swordmaster', 'mountainMinish'], counts: { actors: 2 }, formations: ['conversation'] }
    ],
    school: [
      { id: 'study-group', name: 'A small study group', mood: 'peaceful', actors: ['greenChild', 'blueChild', 'brownChild'], counts: { actors: 3 }, formations: ['gathering', 'stroll'] },
      { id: 'school-break', name: 'Time for a break', mood: 'lively', actors: ['greenChild', 'blueChild', 'brownChild', 'girl'], counts: { actors: 4 }, formations: ['scatter'], hero: 'walking' },
      { id: 'new-student', name: 'A new face in class', mood: 'adventure', actors: ['boy', 'greenChild'], counts: { actors: 2 }, formations: ['conversation'] },
      { id: 'ezlo-guest-lesson', name: 'Professor Ezlo takes questions', mood: 'lively', actors: ['ezlo', 'greenChild', 'blueChild'], counts: { actors: 3 }, formations: ['gathering'] }
    ],
    dungeon: [
      { id: 'ancient-silence', name: 'The silence of an ancient room', mood: 'peaceful', counts: {}, formations: ['stroll'] },
      { id: 'dungeon-treasure', name: 'A chest worth finding', mood: 'adventure', props: ['chest'], counts: { props: 1 }, formations: ['scatter'], hero: 'walking' },
      { id: 'dungeon-wings', name: 'Something stirs in the shadows', mood: 'adventure', enemies: ['keese'], counts: { enemies: 2 }, formations: ['scatter'], hero: 'battle' },
      { id: 'dungeon-company', name: 'An unexpected companion', mood: 'lively', actors: ['guard'], counts: { actors: 1 }, formations: ['conversation'] },
      { id: 'dungeon-ambush', name: 'No turning back now', mood: 'adventure', actors: ['swordmaster'], enemies: ['rope', 'keese'], counts: { actors: 1, enemies: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies', 'actors'] },
      { id: 'dungeon-dampe', name: 'Dampe brought unexpected company', mood: 'lively', actors: ['dampe', 'graveyardSpirit'], counts: { actors: 2 }, formations: ['gathering'] }
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
      { id: 'wild-magic-weather', name: 'A forecast of magical trouble', mood: 'adventure', effects: ['fireball'], actors: ['festari', 'smith', 'guard'], counts: { actors: 3, effects: 4 }, formations: ['scatter'], hero: 'battle' },
      { id: 'wild-boss-rivalry', name: 'Two bosses, one very bad day', mood: 'adventure', bossCount: 2, effects: ['fireball'], counts: { effects: 2 }, formations: ['battle'], hero: 'battle', battle: 'boss-duel' },
      { id: 'wild-boss-crossfire', name: 'Caught in the boss crossfire', mood: 'lively', bossCount: 2, actors: ['zelda'], effects: ['fireball'], counts: { actors: 1, effects: 3 }, formations: ['battle'], hero: 'battle', battle: 'boss-duel' },
      { id: 'wild-boss-tag-team', name: 'The villains formed a tag team', mood: 'adventure', bossCount: 2, actors: ['swordmaster', 'guard'], counts: { actors: 2 }, formations: ['battle'], hero: 'battle', battle: 'boss-assault' },
      { id: 'wild-oracle-rescue', name: 'A rescue mission for the Oracles', mood: 'adventure', bossCount: 1, actors: ['din', 'nayru', 'farore'], fixedCast: true, effects: ['fireball'], counts: { actors: 3, effects: 2 }, formations: ['battle'], hero: 'battle', battle: 'rescue' },
      { id: 'wild-zelda-rescue', name: 'Zelda has a very large problem', mood: 'adventure', bossCount: 1, actors: ['zelda', 'guard'], effects: ['fireball'], counts: { actors: 2, effects: 1 }, formations: ['battle'], hero: 'battle', battle: 'rescue' },
      { id: 'wild-ezlo-revenge', name: 'Ezlo came prepared this time', mood: 'adventure', bossCount: 1, actors: ['ezlo', 'swordmaster'], effects: ['fireball'], counts: { actors: 2, effects: 2 }, formations: ['battle'], hero: 'battle', battle: 'boss-assault' },
      { id: 'wild-boss-army', name: 'A boss and its very confused army', mood: 'lively', bossCount: 1, enemies: ['octorok', 'rope', 'keese'], counts: { enemies: 4 }, formations: ['battle'], hero: 'battle', battle: 'boss-assault' },
      { id: 'wild-swordmaster-duel', name: 'The swordmaster challenges Vaati', mood: 'adventure', actors: ['swordmaster'], enemies: ['vaati'], effects: ['fireball'], counts: { actors: 1, enemies: 1, effects: 1 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies', 'actors', 'effects'] },
      { id: 'wild-vaati-ambush', name: 'Vaati picked the wrong shortcut', mood: 'adventure', enemies: ['vaati', 'octorok', 'rope'], counts: { enemies: 3 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies'] },
      { id: 'wild-oracle-battle', name: 'The Oracles hold the line', mood: 'lively', actors: ['din', 'nayru', 'farore'], fixedCast: true, enemies: ['octorok', 'pesto'], counts: { actors: 3, enemies: 3 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies', 'actors'] },
      { id: 'wild-royal-defense', name: 'The royal guard fights back', mood: 'adventure', actors: ['guard', 'zelda', 'king'], enemies: ['octorok', 'rope', 'keese'], counts: { actors: 3, enemies: 4 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies', 'actors'] },
      { id: 'wild-monster-uprising', name: 'The monsters take over', mood: 'lively', enemies: ['octorok', 'rope', 'keese', 'puffstool', 'pesto'], counts: { enemies: 7 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies'] },
      { id: 'wild-mountain-defense', name: 'The mountain crew fights back', mood: 'adventure', actors: ['mountainMinish', 'smith', 'carpenter'], enemies: ['octorok', 'rope'], counts: { actors: 3, enemies: 3 }, formations: ['battle'], hero: 'battle', battle: 'skirmish' },
      { id: 'wild-haunted-battle', name: 'A ghost joined the wrong side', mood: 'adventure', actors: ['dampe', 'graveyardSpirit'], enemies: ['vaati', 'keese'], counts: { actors: 2, enemies: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', priority: ['enemies', 'actors'] },
      { id: 'wild-oracle-festival', name: 'The Oracles throw a festival', mood: 'peaceful', actors: ['din', 'nayru', 'farore', 'ezlo', 'swordmaster', 'zelda'], fixedCast: true, counts: { actors: 6 }, formations: ['gathering', 'stroll'] },
      { id: 'wild-vaati-day-off', name: 'Vaati tries being sociable', mood: 'peaceful', actors: ['vaati', 'ezlo', 'king', 'cat'], fixedCast: true, counts: { actors: 4 }, formations: ['conversation', 'gathering'] },
      { id: 'wild-boss-judges', name: 'The bosses judge the talent show', mood: 'lively', bossCount: 2, actors: ['din', 'nayru', 'farore'], counts: { actors: 3 }, formations: ['stroll', 'gathering'] },
      { id: 'wild-boss-pets', name: 'A boss discovers pet ownership', mood: 'peaceful', bossCount: 1, actors: ['cat', 'dog', 'ezlo'], counts: { actors: 4 }, formations: ['scatter', 'stroll'] },
      { id: 'wild-boss-training', name: 'An extremely advanced sword lesson', mood: 'adventure', bossCount: 1, actors: ['swordmaster', 'swordmaster'], counts: { actors: 3 }, formations: ['battle'], hero: 'battle', battle: 'boss-assault' },
      { id: 'wild-boss-monster-rescue', name: 'Even the monsters need rescuing', mood: 'adventure', bossCount: 1, actors: ['puffstool', 'rope', 'octorok'], effects: ['fireball'], counts: { actors: 3, effects: 2 }, formations: ['battle'], hero: 'battle', battle: 'rescue' },
      { id: 'wild-bomb-squad', name: 'Link brought the loud solution', mood: 'lively', enemies: ['spearMoblin', 'octorok'], counts: { enemies: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['bomb'], requiresCombat: true, priority: ['enemies'] },
      { id: 'wild-arrow-duel', name: 'A very unfair archery contest', mood: 'adventure', enemies: ['keaton', 'octorok'], actors: ['guard'], counts: { actors: 1, enemies: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['bow'], requiresCombat: true, priority: ['enemies', 'actors'] },
      { id: 'wild-boomerang-flank', name: 'The return trip is the dangerous part', mood: 'lively', enemies: ['spearMoblin', 'keaton'], actors: ['ezlo'], counts: { actors: 1, enemies: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['boomerang'], requiresCombat: true, priority: ['enemies', 'actors'] },
      { id: 'wild-spear-vs-shield', name: 'A spear meets a stubborn shield', mood: 'adventure', enemies: ['spearMoblin'], actors: ['guard'], counts: { actors: 1, enemies: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['shield'], requiresCombat: true, priority: ['enemies', 'actors'] },
      { id: 'wild-sword-vs-darknut', name: 'The duel that woke the whole castle', mood: 'adventure', enemies: ['darknut'], counts: { enemies: 1 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['sword'], requiresCombat: true, priority: ['enemies'] },
      { id: 'wild-toolbox-rescue', name: 'The rescue party packed everything', mood: 'lively', actors: ['din', 'nayru', 'farore', 'zelda'], enemies: ['spearMoblin', 'darknut'], counts: { actors: 3, enemies: 2 }, formations: ['battle'], hero: 'battle', battle: 'rescue', requiresCombat: true, priority: ['enemies', 'actors'] },
      { id: 'wild-bone-volley', name: 'Nobody ordered the flying bones', mood: 'lively', enemies: ['stalfos', 'keaton'], actors: ['dampe', 'graveyardSpirit'], counts: { enemies: 3, actors: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['shield', 'boomerang'], requiresCombat: true, priority: ['enemies', 'actors'] },
      { id: 'wild-bomb-counterattack', name: 'Bombs on both sides', mood: 'lively', enemies: ['bobomb', 'spearMoblin'], actors: ['guard', 'ezlo'], counts: { enemies: 3, actors: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['bomb'], requiresCombat: true, priority: ['enemies', 'actors'] },
      { id: 'wild-gust-counter', name: 'A terrible day for standing still', mood: 'lively', enemies: ['spearMoblin', 'stalfos'], actors: ['mountainMinish', 'smith'], counts: { enemies: 3, actors: 2 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['gust-jar'], requiresCombat: true, priority: ['enemies', 'actors'] },
      { id: 'wild-pacci-chaos', name: 'Pacci and extremely bad timing', mood: 'lively', enemies: ['darknut', 'keaton', 'vaati'], actors: ['din', 'nayru', 'farore'], counts: { enemies: 3, actors: 3 }, formations: ['battle'], hero: 'battle', battle: 'skirmish', gear: ['pacci'], requiresCombat: true, priority: ['enemies', 'actors'] }
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
    return (STORIES[template.storySet] || []).filter(story => {
      if (story.requiresCombat && (!combatActions('6369', 'right', story.gear).length ||
        !story.enemies?.some(name => !ARMED_CAST[name] || combatActions(ARMED_CAST[name], 'left').length))) return false;
      if (!story.bossCount) return true;
      const area = template.bossArea;
      if (!area || area.w < 100 || area.h < 62) return false;
      const width = story.bossCount === 1 ? area.w : (area.w - 20) / story.bossCount;
      const families = Object.values(window.MINISH_BOSSES?.sheets || {}).filter(sheet =>
        (sheet.pieces || []).some(p => p.kind === 'assembled-boss' && p.sw <= width && p.sh <= area.h));
      return families.length >= story.bossCount;
    });
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
    const combatLibrary = window.MINISH_COMBAT_LIBRARY;
    const combatPieces = new Map(Object.values(combatLibrary?.sheets || {}).flatMap(sheet => sheet.pieces || []).map(entry => [entry.id, entry]));
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
      const result = studio.getPiece(spec.pieceId || spec.id) || combatPieces.get(spec.pieceId || spec.id);
      if (!result || excluded.has(result.id) || hidden.has(result.sourceId) || ['reference', 'label', 'palette'].includes(result.kind)) return null;
      return { ...result, identity: String(spec.identity || result.sourceId), repeatable: !!spec.repeatable, generationLabel: spec.label || result.name };
    };
    const pool = entries => (entries || []).map(piece).filter(Boolean);
    function armedPose(action, identity, direction) {
      const pose = piece(action.representativePoseId || action.poseIds?.[Math.floor(action.poseIds.length / 2)]);
      if (!pose) return null;
      const foot = action.anchors?.[pose.id] || pose.combatAnchor || pose.animationAnchor || action.animationAnchor;
      const body = foot && Number.isFinite(foot.x) && Number.isFinite(foot.y) ? { x: foot.x, y: foot.y } : { x: pose.sw / 2, y: pose.sh };
      if (mirrorAction(action, direction)) body.x = pose.sw - body.x;
      return { ...pose, identity, repeatable: identity !== 'link', generationLabel: action.label,
        combatAction: action, combatDirection: direction,
        bodyAnchor: body };
    }
    function castPool(key) {
      if (story.battle && ARMED_CAST[key]) {
        const direction = style === 'wild' ? 'left' : 'down';
        const armed = (key === 'bobomb' ? combatActions(ARMED_CAST[key], 'down') : combatActions(ARMED_CAST[key], direction))
          .map(action => armedPose(action, key, key === 'bobomb' ? 'down' : direction)).filter(Boolean);
        if (armed.length) return armed;
      }
      const spec = CAST[key];
      if (!spec) return [];
      const [sourceId, ranges, repeatable] = spec;
      return pool((curated.sheets?.[sourceId]?.pieces || []).filter(p => ranges.some(([low, high]) => p.sequence >= low && p.sequence <= high))
        .filter(p => !(story.battle && key === 'vaati') || p.sequence === 34)
        .filter(p => !story.battle || key !== 'octorok' || (style === 'wild' ? p.sequence >= 9 && p.sequence <= 12 : p.sequence <= 4))
        .filter(p => !story.battle || key !== 'rope' || (style === 'wild' ? p.sequence <= 4 : p.sequence >= 9))
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
    let primaryHero = null;
    const closeCombat = () => ['sword', 'shield', 'mole-mitts'].includes(primaryHero?.combat?.weapon);
    const integer = (low, high) => Math.round(low + random() * Math.max(0, high - low));
    const overlaps = (a, b) => a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
    function sprite(p, x, y, role) {
      return { id: 'random-' + objects.length, kind: 'sprite', assetId: p.assetId,
        sx: p.sx, sy: p.sy, sw: p.sw, sh: p.sh, x, y, scale: 1,
        flipX: false, flipY: false, keyColor: p.keyColor || null, layer: role === 'effects' ? 'overlay' : 'objects',
        sourceId: p.sourceId, pieceId: p.id, pieceName: p.generationLabel || p.name, generationRole: role,
        generationCharacter: p.identity || p.sourceId,
        ...(p.combatAction ? { combat: { actorKey: 'fighter-' + objects.length, actionId: p.combatAction.id, weapon: p.combatAction.weapon,
          direction: p.combatDirection, anchor: p.bodyAnchor, editorAssembly: !!(p.combatAction.editorAssembly || p.combatAction.assembly), choreography: 'editor-authored encounter' },
          generationFacing: p.combatDirection,
          flipX: mirrorAction(p.combatAction, p.combatDirection) } : {}),
        ...(story.battle && ['actors', 'enemies', 'boss'].includes(role) ? { generationTeam: role === 'actors' ? 'heroes' : 'opponents' } : {}) };
    }
    function formationFoot(zone, index, count, role) {
      const midX = zone.x + zone.w / 2, midY = zone.y + zone.h / 2;
      if (story.battle && style === 'wild' && role !== 'effects') {
        const side = role === 'enemies' ? .77 : .24;
        return { x: zone.x + zone.w * side, y: zone.y + zone.h * (.5 + (index % 3 - 1) * .22) };
      }
      if (formation === 'guard-line') return { x: zone.x + zone.w * (index + 1) / (count + 1), y: midY - 4 };
      if (formation === 'stroll') return { x: zone.x + zone.w * (index + 1) / (count + 1), y: midY + (index % 2 ? 5 : -5) };
      if (formation === 'conversation') return { x: midX + (index % 2 ? 22 : -22), y: midY + (index % 3 - 1) * 10 };
      if (formation === 'gathering') { const angle = (index / Math.max(3, count)) * Math.PI * 2; return { x: midX + Math.cos(angle) * Math.min(35, zone.w * .38), y: midY + Math.sin(angle) * Math.min(13, zone.h * .38) }; }
      return null;
    }
    function place(p, role, forced = null, index = 0, count = 1) {
      const roleZones = zones.filter(zone => zone.role === role || Array.isArray(zone.roles) && zone.roles.includes(role)).map(zone => {
        if (!story.battle || style !== 'wild' || !['actors', 'enemies'].includes(role)) return zone;
        return role === 'enemies' ? { ...zone, x: zone.x + zone.w * (closeCombat() ? .38 : .6), w: zone.w * (closeCombat() ? .62 : .4) } : { ...zone, w: zone.w * .4 };
      });
      if (!forced && !roleZones.length) return false;
      for (let attempt = 0; attempt < (forced ? 1 : 120); attempt++) {
        const zone = roleZones.length ? choose(roleZones) : null;
        let preferred = !forced && attempt < roleZones.length ? formationFoot(zone, index, count, role) : null;
        if (!forced && attempt === 0 && role === 'enemies' && story.battle && style === 'wild' && closeCombat() && !story.bossCount && index === 0) {
          const body = p.bodyAnchor || { x: p.sw / 2, y: p.sh };
          preferred = { x: primaryHero.x + primaryHero.sw + 6 + body.x, y: primaryHero.y + primaryHero.combat.anchor.y };
        }
        const foot = forced || preferred || { x: integer(zone.x, zone.x + zone.w), y: integer(zone.y, zone.y + zone.h) };
        if (!forced && (foot.x < zone.x || foot.x > zone.x + zone.w || foot.y < zone.y || foot.y > zone.y + zone.h)) continue;
        const anchor = p.bodyAnchor || { x: p.sw / 2, y: p.sh };
        const x = Math.round(foot.x - anchor.x), y = Math.round(foot.y - anchor.y), bounds = { x, y, w: p.sw, h: p.sh };
        if (x < 0 || y < 0 || x + p.sw > width || y + p.sh > height || occupied.some(box => overlaps(bounds, box))) continue;
        objects.push(sprite(p, x, y, role)); occupied.push(bounds); used.add(p.identity); return true;
      }
      return false;
    }
    if (template.theme === 'boss' || story.bossCount) {
      const bosses = window.MINISH_BOSSES || {}, sources = new Set(template.bossSourceIds || []), area = template.bossArea;
      const count = story.bossCount || 1, chosenFamilies = new Set();
      for (let index = 0; index < count; index++) {
        const slot = count === 1 ? area : { x: area.x + index * (area.w + 20) / count, y: area.y, w: (area.w - 20) / count, h: area.h };
        const families = Object.entries(bosses.sheets || {}).filter(([id]) => !chosenFamilies.has(id) && (style === 'wild' || sources.has(id)))
          .map(([, sheet]) => pool(sheet.pieces || []).filter(p => p.kind === 'assembled-boss' && slot && p.sw <= slot.w && p.sh <= slot.h)).filter(list => list.length);
        if (!families.length) throw new Error('No complete boss pose fits this setting. Choose another setting.');
        const boss = choose(choose(families));
        const x = Math.round(slot.x + (slot.w - boss.sw) / 2), y = Math.round(slot.y + (slot.h - boss.sh) / 2);
        const object = sprite(boss, x, y, 'boss');
        if (story.battle === 'boss-duel') object.generationTeam = index ? 'rival-right' : 'rival-left';
        objects.push(object); occupied.push({ x, y, w: boss.sw, h: boss.sh }); chosenFamilies.add(boss.sourceId);
      }
      if (style === 'faithful' && story.effects?.length) zones.push({ x: 30, y: 120, w: 180, h: 10, role: 'effects' });
    }
    // Whole left-facing Link bodies can be mirrored toward an opposing side.
    // Vertical encounters use the genuine away-facing bodies instead.
    const sideBattle = !!story.battle && style === 'wild';
    const heroRanges = story.hero === 'walking' ? [[9, 48]] : story.hero === 'battle' ? sideBattle ? [[18, 27]] : [[28, 37]] : [[1, 8]];
    const expandedHeroes = (curated.sheets?.['6369']?.pieces || []).filter(p => heroRanges.some(([low, high]) => p.sequence >= low && p.sequence <= high)).map(p => p.id);
    const direction = sideBattle ? 'right' : 'up';
    const armedHeroes = story.battle ? shuffle(combatActions('6369', direction, story.gear), random).map(action => armedPose(action, 'link', direction)).filter(Boolean) : [];
    const heroes = [...armedHeroes, ...shuffle(pool(expandedHeroes.length ? expandedHeroes : template.heroes || (Array.isArray(template.hero) ? template.hero : template.hero ? [template.hero] : [])), random)];
    const skirmishZone = zones.find(zone => zone.role === 'actors' || zone.roles?.includes('actors'));
    const heroAnchor = story.battle && style === 'wild'
      ? { x: Math.round(width * .23), y: !story.bossCount && template.theme !== 'boss' && skirmishZone ? Math.round(skirmishZone.y + skirmishZone.h * .28) : height - 8 }
      : baseAnchor ? { x: baseAnchor.x - camera.dx, y: baseAnchor.y - camera.dy } : null;
    if (!heroes.length || !heroes.some(hero => {
      const body = hero.bodyAnchor || { x: hero.sw / 2, y: hero.sh };
      const foot = heroAnchor && style === 'wild' && hero.combatAction ? {
        x: Math.max(body.x, Math.min(width - hero.sw + body.x, heroAnchor.x)),
        y: Math.max(body.y, Math.min(height - hero.sh + body.y, heroAnchor.y)) } : heroAnchor;
      return place(hero, 'actors', foot);
    })) throw new Error('The hero could not be placed safely. Try another seed.');
    const heroObject = objects[objects.length - 1];
    primaryHero = heroObject;
    if (story.hero === 'battle' && !heroObject.combat) {
      heroObject.flipX = sideBattle;
      heroObject.generationFacing = heroObject.flipX ? 'right' : 'up';
    }
    const counts = Object.fromEntries(['actors', 'enemies', 'props', 'effects'].map(role => {
      const base = story.counts?.[role] || 0;
      const adjusted = role === 'props' || role === 'effects' || story.fixedCast && role === 'actors' ? base : base ? Math.max(1, base + (density === 'quiet' ? -1 : density === 'lively' ? 1 : 0)) : 0;
      return [role, adjusted];
    }));
    for (const role of [...(story.priority || []), ...['actors', 'enemies', 'props', 'effects'].filter(role => !(story.priority || []).includes(role))]) {
      let placed = 0;
      const candidates = story[role] ? castChoices(story[role], counts[role]) : pool(template[role]);
      for (const candidate of candidates) {
        if (placed >= counts[role]) break;
        if (used.has(candidate.identity) && !candidate.repeatable) continue;
        let forced = null;
        if (role === 'effects' && story.battle) {
          const combatants = objects.filter(object => object.generationRole === 'boss');
          const left = combatants.length > 1 ? combatants[0] : heroObject;
          const right = combatants.length > 1 ? combatants[1] : combatants[0] || objects.find(object => object.generationRole === 'enemies');
          if (right) {
            const offset = (placed - (counts[role] - 1) / 2) * (candidate.sh + 4);
            forced = { x: (left.x + left.sw / 2 + right.x + right.sw / 2) / 2,
              y: (left.y + left.sh / 2 + right.y + right.sh / 2) / 2 + candidate.sh / 2 + offset };
          }
        }
        const placedAtFocus = forced && place(candidate, role, forced, placed, counts[role]);
        if (placedAtFocus || place(candidate, role, null, placed, counts[role])) {
          const object = objects[objects.length - 1];
          if (story.battle && candidate.identity === 'vaati') object.generationFacing = 'left';
          placed++;
        }
      }
    }
    if (story.battle) {
      const fighters = objects.filter(object => object.generationTeam);
      for (const fighter of fighters) fighter.combat ||= { actorKey: 'fighter-' + fighter.id, direction: fighter.generationFacing || null };
      const center = object => ({ x: object.x + object.sw / 2, y: object.y + object.sh / 2 });
      const targetsFor = fighter => fighters.filter(other => other.generationTeam !== fighter.generationTeam).sort((a, b) => {
        const from = center(fighter), ac = center(a), bc = center(b);
        return Math.hypot(from.x - ac.x, from.y - ac.y) - Math.hypot(from.x - bc.x, from.y - bc.y);
      });
      const effectFor = id => combatLibrary?.getEffect?.(id) || combatLibrary?.effects?.find(effect => effect.id === id);
      function addWeaponEffect(owner, target, action) {
        if (owner.sourceId === '6413') return false; // The living bomb is the weapon, not a bomb launcher.
        const effect = effectFor(action.effectId); if (!effect) return false;
        const nativeDirection = directionName(action.direction), direction = owner.combat.direction;
        const directional = effect.directions?.[nativeDirection];
        const ids = Array.isArray(directional) ? directional : directional?.pieceIds || effect.pieceIds;
        const candidates = pool(ids).filter(candidate => !candidate.direction || directionName(candidate.direction) === nativeDirection || candidate.direction === 'any');
        if (!candidates.length) return false;
        const candidate = choose(candidates), source = center(owner), destination = center(target);
        const hand = action.releasePoint || { x: nativeDirection === 'left' ? 0 : nativeDirection === 'right' ? owner.sw : owner.sw / 2,
          y: nativeDirection === 'up' ? 0 : nativeDirection === 'down' ? owner.sh : Math.max(0, (owner.combat.anchor?.y || owner.sh) - Math.min(12, owner.sh / 2)) };
        source.x = owner.x + (owner.flipX ? owner.sw - hand.x : hand.x);
        source.y = owner.y + hand.y;
        const axis = ['left', 'right'].includes(direction) ? 'x' : 'y';
        const gapX = Math.max(target.x - owner.x - owner.sw, owner.x - target.x - target.sw, 0);
        const gapY = Math.max(target.y - owner.y - owner.sh, owner.y - target.y - target.sh, 0);
        const contact = ['melee', 'guard'].includes(action.kind);
        if (contact) {
          if (Math.hypot(gapX, gapY) > 18) return false;
          if (axis === 'x') {
            source.x = direction === 'right' ? owner.x + owner.sw : owner.x;
            destination.x = direction === 'right' ? target.x : target.x + target.sw;
            source.y = destination.y = Math.max(Math.max(owner.y, target.y), Math.min(owner.y + owner.sh, target.y + target.sh, source.y));
          } else {
            source.y = direction === 'down' ? owner.y + owner.sh : owner.y;
            destination.y = direction === 'down' ? target.y : target.y + target.sh;
            source.x = destination.x = Math.max(Math.max(owner.x, target.x), Math.min(owner.x + owner.sw, target.x + target.sw, source.x));
          }
        }
        // Arrows travel along their actual cardinal sprite direction. Bombs
        // and returning tools can be caught in the middle of an authored arc.
        if (['bow', 'stone'].includes(action.weapon)) {
          if (axis === 'x') { if (source.y < target.y || source.y > target.y + target.sh) return false; destination.y = source.y; }
          else { if (source.x < target.x || source.x > target.x + target.sw) return false; destination.x = source.x; }
        }
        for (const progress of [.52, .4, .64, .3, .73]) {
          const x = Math.round(source.x + (destination.x - source.x) * progress - candidate.sw / 2);
          const y = Math.round(source.y + (destination.y - source.y) * progress - candidate.sh / 2);
          const bounds = { x, y, w: candidate.sw, h: candidate.sh };
          const otherObjects = objects.filter(object => object.generationRole !== 'background' && object !== owner && object !== target);
          const blocked = contact ? otherObjects.some(object => overlaps(bounds, { x: object.x, y: object.y, w: object.sw, h: object.sh })) : occupied.some(rect => overlaps(bounds, rect));
          if (x < 0 || y < 0 || x + candidate.sw > width || y + candidate.sh > height || blocked) continue;
          const object = sprite(candidate, x, y, 'effects');
          object.flipX = owner.flipX && ['left', 'right'].includes(nativeDirection);
          object.combat = { ownerKey: owner.combat.actorKey, targetKey: target.combat.actorKey,
            actionId: action.id, weapon: action.weapon, effectId: effect.id, phase: contact ? 'impact' : 'release', direction,
            origin: { x: Math.round(source.x), y: Math.round(source.y) }, aim: { x: Math.round(destination.x), y: Math.round(destination.y) }, progress };
          objects.push(object); occupied.push(bounds); return true;
        }
        return false;
      }
      for (const fighter of fighters) {
        const action = combatLibrary?.getAction?.(fighter.combat.actionId) || combatLibrary?.actions?.find(value => value.id === fighter.combat.actionId);
        const targets = targetsFor(fighter);
        const direction = fighter.combat.direction;
        const aimingTargets = targets.filter(target => {
          const a = center(fighter), b = center(target);
          return direction === 'right' ? b.x > a.x : direction === 'left' ? b.x < a.x : direction === 'up' ? b.y < a.y : direction === 'down' ? b.y > a.y : true;
        });
        const target = (aimingTargets.length ? aimingTargets : targets)[0];
        if (!target) continue;
        fighter.combat.targetKey = target.combat.actorKey;
        if (action?.effectId) {
          for (const candidate of aimingTargets.length ? aimingTargets : [target]) if (addWeaponEffect(fighter, candidate, action)) { fighter.combat.targetKey = candidate.combat.actorKey; break; }
        }
      }
      // The older boss volleys are also tied to a visible shooter and target.
      // The stable keys survive scene insertion, duplication and animation import.
      for (const effect of objects.filter(object => object.generationRole === 'effects' && !object.combat)) {
        const shooter = fighters.find(object => object.generationRole === 'boss') || fighters.find(object => object.generationTeam === 'opponents');
        const target = shooter && targetsFor(shooter)[0];
        if (target) effect.combat = { ownerKey: shooter.combat.actorKey, targetKey: target.combat.actorKey, weapon: 'magic', effectId: 'fireball', phase: 'release' };
      }
    }
    const layerRank = { terrain: 0, objects: 1, overlay: 2 };
    objects.sort((a, b) => layerRank[a.layer] - layerRank[b.layer] || a.y + a.sh - b.y - b.sh);
    return { id: 'generated-' + hash(seed + template.id + story.id + density + formation).toString(36), name: story.name + ' · ' + template.name.split(':')[0],
      width, height, preset: width === 240 && height === 160 ? 'game' : 'custom', exportScale: width === 240 ? 4 : 3,
      color: '#182a25', transparent: false, objects,
      generated: { version: 4, seed, theme: template.theme, templateId: template.id, sourceId: template.sourceId || null, libraryRevision: curated.generatedAt || curated.version || '4.0.0',
        ...(story.battle && combatLibrary ? { combatLibraryRevision: combatLibrary.version || 1 } : {}),
        storyId: story.id, story: story.name, mood: story.mood, requestedMood, density, formation, cameraOffset: camera,
        ...(story.battle ? { battle: { kind: story.battle,
          teams: [...new Set(objects.map(object => object.generationTeam).filter(Boolean))],
          combatants: objects.filter(object => object.generationTeam).map(object => object.id),
          projectiles: objects.filter(object => object.generationRole === 'effects').map(object => object.id),
          loadouts: objects.filter(object => object.combat?.actionId && object.generationTeam).map(object => ({ actorKey: object.combat.actorKey,
            character: object.generationCharacter, actionId: object.combat.actionId, weapon: object.combat.weapon, targetKey: object.combat.targetKey })),
          phases: ['anticipation', 'attack', 'impact', 'recovery'], snapshotPhase: 'attack',
          choreography: 'Genuine weapon poses and editor-authored equipment placements.' } } : {}),
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
    const scope = $('randomScope')?.value || 'scene', world = scope !== 'scene';
    if ($('randomLocalOptions')) $('randomLocalOptions').hidden = world;
    if ($('randomStyleNote')) $('randomStyleNote').hidden = world;
    if ($('randomMoodLabel')) $('randomMoodLabel').hidden = world;
    for (const id of ['randomTheme', 'randomStyle', 'randomMood']) if ($(id)) $(id).disabled = world;
    if (world) {
      if ($('randomPossibilities')) $('randomPossibilities').textContent = scope === 'world-terrain'
        ? 'Explore the complete Hyrule terrain atlas, including cloud-area insets. Small, editable Easter egg encounters are spread across the map. Zoom in to discover them.'
        : 'The illustrated game map becomes a canvas for character cameos, bosses and little surprises. Its original pixels are enlarged at a crisp integer scale.';
      return;
    }
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
    const active = studio.getScene?.();
    if ($('randomScope')) $('randomScope').value = active?.generated?.requestedOptions?.scope ||
      (active?.preset === 'world-hyrule' ? 'world-terrain' : active?.preset === 'world-hyrule-illustrated' ? 'world-illustrated' : 'scene');
    updateAvailability();
    announce('Create adds a new editable scene. Surprise me again rerolls a generated scene, and Undo restores it.');
    $('randomDialog').showModal();
  }
  if ($('randomSceneBtn')) $('randomSceneBtn').addEventListener('click', open);
  if ($('closeRandomBtn')) $('closeRandomBtn').addEventListener('click', () => $('randomDialog').close());
  if ($('randomStyle')) $('randomStyle').addEventListener('change', updateAvailability);
  if ($('randomScope')) $('randomScope').addEventListener('change', updateAvailability);
  let generating = false;
  function controlOptions() {
    return { scope: $('randomScope')?.value || 'scene', theme: $('randomTheme')?.value || 'any', mood: $('randomMood')?.value || 'any', density: $('randomDensity')?.value || 'varied', style: $('randomStyle')?.value || 'mixed' };
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
      if (reroll && !previous && active?.preset?.startsWith('world-hyrule')) options.scope = active.preset === 'world-hyrule' ? 'world-terrain' : 'world-illustrated';
      if (options.scope && options.scope !== 'scene' && !window.MINISH_WORLD_SCENES) throw new Error('The world scene tools are missing. Reopen the complete app folder.');
      const result = options.scope && options.scope !== 'scene' ? window.MINISH_WORLD_SCENES.buildScene({ ...options, seed }) : buildScene({ ...options, seed });
      if (reroll && typeof studio.rerollScene === 'function') await studio.rerollScene(result);
      else await studio.insertScene(result);
      if (!reroll && $('randomSeed')) $('randomSeed').value = requestedSeed;
      if (!reroll && $('randomDialog')?.open) $('randomDialog').close();
      announce(result.generated.story + (reroll && previous ? ' replaces this generated scene.' : ' added.') + ' Seed ' + seed + '. Undo restores your previous scene.');
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
    stories: Object.values(STORIES).flat().map(({ id, name, mood }) => ({ id, name, mood })), version: '4.3.0' };
})();
