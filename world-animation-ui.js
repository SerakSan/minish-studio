(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const engine = window.MINISH_ANIMATION, editor = window.MINISH_ANIMATION_UI;
  if (!engine || !editor || !$('animWorldBtn')) return;
  let busy = false, discoveryKey = '', discoveryIndex = -1;
  const clone = value => JSON.parse(JSON.stringify(value));
  const freshSeed = () => {
    const values = new Uint32Array(2);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(values);
    else { values[0] = Date.now(); values[1] = Math.floor(Math.random() * 4294967296); }
    return [...values].map(value => value.toString(36)).join('-');
  };
  const isWorld = clip => !!(clip?.worldId && clip.generated?.encounters?.length);
  function report(message) {
    $('animWorldStatus').textContent = message;
    $('animStatus').textContent = message;
  }
  function refresh(state = engine.state) {
    const world = isWorld(state.currentClip);
    $('animWorldReroll').hidden = !world;
    $('animWorldExplore').hidden = !world;
    for (const id of ['animWorldBtn', 'animWorldCreate', 'animWorldReroll']) $(id).disabled = busy;
  }
  function explore() {
    const clip = engine.currentClip, encounters = clip.generated?.encounters;
    if (!encounters?.length) return;
    const key = clip.id + ':' + clip.generated.seed;
    if (key !== discoveryKey) { discoveryKey = key; discoveryIndex = -1; }
    const index = ++discoveryIndex % encounters.length, encounter = encounters[index];
    editor.focusArea?.(encounter);
    report((index + 1) + ' / ' + encounters.length + ' · ' + encounter.name +
      (encounter.location ? ' · ' + encounter.location : '') + '. Every action is editable.');
  }
  function open() {
    editor.setMode('animation'); engine.pause();
    const clip = engine.currentClip, options = clip.generated?.requestedOptions;
    $('animWorldMap').value = options?.scope || (clip.worldStyle === 'illustrated' ? 'world-illustrated' : 'world-terrain');
    $('animWorldDensity').value = options?.density && options.density !== 'varied' ? options.density : 'balanced';
    $('animWorldStatus').textContent = '';
    $('animWorldDialog').showModal();
  }
  async function prepareClip(clip) {
    const first = engine.evaluateFrame(clip, 0), sources = new Map();
    for (const object of first.objects) if (object.kind === 'sprite') sources.set(String(object.assetId), object);
    for (const track of clip.tracks || []) for (const key of track.keys || []) {
      const values = key.values || {}, pose = values.pieceId && window.MINISH_STUDIO.getPiece(values.pieceId);
      if (pose) sources.set(String(pose.assetId), { ...pose, kind: 'sprite', pieceId: pose.id, x: 0, y: 0, scale: 1, layer: 'objects' });
      if (values.assetId && !sources.has(String(values.assetId))) sources.set(String(values.assetId), {
        kind: 'sprite', assetId: String(values.assetId), sx: 0, sy: 0, sw: 1, sh: 1, x: 0, y: 0, scale: 1, layer: 'objects'
      });
    }
    // Decode later attack poses and impact art before playback, too.
    await window.MINISH_STUDIO.prepareScene({ ...first, objects: [...sources.values(), ...first.objects.filter(object => object.kind === 'dialogue')] });
  }
  async function create(reroll = false) {
    if (busy) return null;
    busy = true; refresh();
    report('Generating a Hyrule animation…');
    editor.setMode('animation'); engine.pause();
    const before = engine.currentClip;
    try {
      const builder = window.MINISH_WORLD_ANIMATION;
      if (!builder?.buildClip) throw new Error('The world animation tools are missing. Reopen the complete app folder.');
      const seed = reroll ? freshSeed() : $('animWorldSeed').value.trim() || freshSeed();
      const options = reroll && isWorld(before) ? clone(before.generated.requestedOptions) : {
        scope: $('animWorldMap').value, density: $('animWorldDensity').value
      };
      const clip = builder.buildClip({ ...options, seed });
      await prepareClip(clip);
      if (reroll && (engine.currentClip.id !== before.id || JSON.stringify(engine.currentClip) !== JSON.stringify(before))) throw new Error('This animation changed while the world was opening. Try Surprise me again.');
      let added;
      if (reroll && isWorld(before)) added = engine.replaceClip(clip, before.id);
      else { delete clip.id; added = engine.addClip(clip); }
      if ($('animWorldDialog').open) $('animWorldDialog').close();
      editor.fitCanvas(); editor.render(); engine.seek(0); engine.play();
      report(added.generated.encounters.length + ' animated discoveries are playing. Explore animations visits each one; Fit shows all of Hyrule. Undo restores your previous animation.');
      return added;
    } catch (error) {
      report(error.message || 'Could not create this animated world. Try another setting.');
      return null;
    } finally { busy = false; refresh(); }
  }
  $('animWorldBtn').addEventListener('click', open);
  $('animWorldClose').addEventListener('click', () => $('animWorldDialog').close());
  $('animWorldCreate').addEventListener('click', () => create(false));
  $('animWorldReroll').addEventListener('click', () => create(true));
  $('animWorldExplore').addEventListener('click', explore);
  engine.subscribe(refresh);
  window.MINISH_WORLD_ANIMATION_UI = { open, create, explore, prepareClip };
})();
