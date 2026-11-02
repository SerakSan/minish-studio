import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const curated = read('assets/curated.json'), bosses = read('assets/full-bosses.json'), pieces = read('assets/pieces.json'), catalog = read('assets/catalog.json'), sprites = read('assets/sprites.json');
const packContext = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, 'combat-library.js'), 'utf8'), packContext);
const pack = packContext.window.MINISH_COMBAT_LIBRARY;
const sheets = pack.mergeSheets({ ...pieces.sheets, ...curated.sheets, ...bosses.sheets });
const pieceMap = new Map(Object.values(sheets).flatMap(sheet => sheet.pieces || []).map(piece => [piece.id, piece]));
const assets = [...catalog.assets, ...pieces.assets, ...sprites.assets, ...curated.assets, ...bosses.assets, ...pack.assets];
let missing = null;
const adapter = { assets, getAsset: id => assets.find(asset => String(asset.id) === String(id)), getPiece: id => id === missing ? null : pieceMap.get(id) || null };
const plain = value => JSON.parse(JSON.stringify(value));
function harness(saved) {
  const window = { MINISH_STUDIO: adapter, MINISH_CURATED: curated, MINISH_BOSSES: bosses, MINISH_COMBAT_LIBRARY: pack, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  const context = vm.createContext({ window, console, setTimeout: () => 1, clearTimeout() {}, localStorage: { getItem() {}, setItem() {} } });
  for (const name of ['animation-engine.js', 'simple-animation.js']) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context);
  window.MINISH_ANIMATION.init(adapter); window.MINISH_SIMPLE_ANIMATION.init();
  if (saved) window.MINISH_ANIMATION.loadProject(saved);
  return { engine: window.MINISH_ANIMATION, simple: window.MINISH_SIMPLE_ANIMATION };
}
function add(engine, actionId, patch = {}) {
  const action = pack.getAction(actionId), p = pieceMap.get(action.poseIds[0]);
  return engine.addObject({ kind: 'sprite', sourceId: p.sourceId, assetId: p.assetId, pieceId: p.id, pieceName: action.label,
    sx: p.sx, sy: p.sy, sw: p.sw, sh: p.sh, x: 80, y: 70, scale: 1, flipX: false, flipY: false, animationAnchor: 'feet', layer: 'objects', ...patch });
}
function transformedPoint(object, point) {
  const x = (object.flipX ? object.sw - point.x : point.x) - object.sw / 2, y = (object.flipY ? object.sh - point.y : point.y) - object.sh / 2;
  const radians = (object.rotation || 0) * Math.PI / 180;
  return { x: object.x + object.sw * object.scale / 2 + (x * Math.cos(radians) - y * Math.sin(radians)) * object.scale,
    y: object.y + object.sh * object.scale / 2 + (x * Math.sin(radians) + y * Math.cos(radians)) * object.scale };
}
function center(object) {
  const p = pieceMap.get(object.pieceId), a = p.effectAnchor || { x: p.sw / 2, y: p.sh / 2 };
  return transformedPoint(object, a);
}
function feet(object) {
  const p = pieceMap.get(object.pieceId), a = p.combatAnchor || { x: p.sw / 2, y: p.sh };
  return transformedPoint(object, a);
}
function hand(engine, ownerId, actionId, frame) {
  const owner = engine.getObjectAt(ownerId, frame), action = pack.getAction(actionId), rep = pieceMap.get(action.representativePoseId), f = feet(owner);
  const x = (action.releasePoint.x - rep.combatAnchor.x) * owner.scale * (owner.flipX ? -1 : 1), y = (action.releasePoint.y - rep.combatAnchor.y) * owner.scale * (owner.flipY ? -1 : 1), radians = (owner.rotation || 0) * Math.PI / 180;
  return { x: f.x + x * Math.cos(radians) - y * Math.sin(radians), y: f.y + x * Math.sin(radians) + y * Math.cos(radians) };
}
const close = (a, b, message) => assert(Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1, message + ': ' + JSON.stringify({a,b}));
const { engine, simple } = harness();
assert.equal(simple.coverage.presets, 108, 'The combined ready catalog keeps legacy and combat actions');
assert.equal(simple.coverage.sources.length, 28);
assert.equal(simple.coverage.combatActions, 42);
const actor = add(engine, 'link-bomb-left'), id = actor.id, before = engine.project;
assert.equal(simple.previewHold(pack.getAction('link-bomb-left'), 'normal', 12), 2);
assert.equal(simple.previewHold(pack.getAction('link-bomb-left'), 'slow', 12), 4);
assert.equal(simple.previewHold(pack.getAction('link-bomb-left'), 'fast', 12), 1);
simple.apply(id, { presetId: 'link-bomb-left', motion: 'none', speed: 'normal' });
const children = simple.ownedCompanions(id), projectile = children.find(o => o.simpleCompanion.role === 'projectile'), burst = children.find(o => o.simpleCompanion.role === 'burst');
assert(projectile && burst && children.length === 2);
assert.equal(engine.selectedObjectId, id, 'Adding companions leaves the character selected');
for (let f=0;f<8;f++) assert(!engine.getObjectAt(projectile.id,f).visible);
assert(engine.getObjectAt(projectile.id,8).visible);
assert.equal(pieceMap.get(engine.getObjectAt(id,8).pieceId).sourceParts.length,1, 'The body releases the held bomb when its moving companion appears');
close(center(engine.getObjectAt(projectile.id,8)),hand(engine,id,'link-bomb-left',8),'Bomb transfers from the character hand');
const launch = center(engine.getObjectAt(projectile.id,8)), middle = center(engine.getObjectAt(projectile.id,10));
assert(middle.x < launch.x - 20 && middle.y < launch.y - 5, 'Bomb travels forward with a visible arc');
assert(!engine.getObjectAt(burst.id,11).visible && engine.getObjectAt(burst.id,12).visible);
assert(!engine.getObjectAt(projectile.id,12).visible, 'The moving bomb ends when its explosion starts');
assert(new Set(engine.getTrack(burst.id).keys.filter(k=>k.values.visible).map(k=>k.values.pieceId)).size >= 4, 'Explosion plays changing genuine effect frames');
engine.undo(); assert.deepEqual(engine.project,before,'Body, projectile and explosion are one Undo action');
engine.redo();
const ids = simple.ownedCompanions(id).map(o=>o.id).sort(); simple.apply(id,{speed:'slow'});
assert.deepEqual(simple.ownedCompanions(id).map(o=>o.id).sort(),ids,'Reapplying reuses owned companion tracks');
assert.equal(engine.currentClip.objects.length,3);
simple.apply(id,{speed:'normal'});
const positions = [8,10,12,16].map(f=>({f,body:engine.getObjectAt(id,f),fx:simple.ownedCompanions(id).map(o=>engine.getObjectAt(o.id,f))}));
simple.moveBase(id,{dx:19,dy:-7});
for(const {f,body,fx} of positions){const now=engine.getObjectAt(id,f);assert.equal(now.x-body.x,19);assert.equal(now.y-body.y,-7);for(const old of fx){const moved=engine.getObjectAt(old.id,f);assert.equal(moved.x-old.x,19);assert.equal(moved.y-old.y,-7);}}
simple.place(id,{scale:2,flipX:true,flipY:true,layer:'overlay'});
const mirrored = engine.getObjectAt(projectile.id,8); assert.equal(mirrored.scale,2); assert(mirrored.flipX && mirrored.flipY);assert.equal(mirrored.layer,'overlay');
close(center(mirrored),hand(engine,id,'link-bomb-left',8),'Scaled and mirrored release stays in the hand');
const mirroredMiddle=center(engine.getObjectAt(projectile.id,10)), mirroredLaunch=center(mirrored);
assert(mirroredMiddle.x>mirroredLaunch.x+40 && mirroredMiddle.y>mirroredLaunch.y+10,'Both path axes mirror with the actor');
const pureBefore=engine.project, pure=simple.compileRecipe(engine.currentClip.objects.find(o=>o.id===id),{presetId:'link-boomerang-left'},{duration:48,fps:12});
assert(pure.keys.length);assert.deepEqual(engine.project,pureBefore,'Pure compilation never modifies live objects or spawns companions');
simple.apply(id,{presetId:'link-boomerang-left',motion:'right',distance:24});
assert.equal(simple.ownedCompanions(id).length,1,'Changing action removes the old explosion track');
const boom=simple.ownedCompanions(id)[0];
close(center(engine.getObjectAt(boom.id,8)),hand(engine,id,'link-boomerang-left',8),'Boomerang starts at the hand');
close(center(engine.getObjectAt(boom.id,13)),hand(engine,id,'link-boomerang-left',13),'Boomerang returns to the moving hand');
assert(!engine.getObjectAt(boom.id,14).visible,'Next windup does not leave an old projectile visible');
const modified=engine.getTrack(boom.id).keys.find(k=>k.frame===9).values.x;
engine.setKey(boom.id,9,{x:modified+3});const custom=engine.project;
assert(simple.inspect(id).needsReplacement);
assert.throws(()=>simple.apply(id,{speed:'slow'}),e=>e.code==='SIMPLE_CUSTOM_KEYS');assert.deepEqual(engine.project,custom);
assert.throws(()=>simple.place(id,{scale:3}),e=>e.code==='SIMPLE_CUSTOM_KEYS');assert.deepEqual(engine.project,custom);
assert.throws(()=>simple.place(id,{rotation:45}),e=>e.code==='SIMPLE_CUSTOM_KEYS');assert.deepEqual(engine.project,custom,'Rotating an action does not erase custom effect edits');
simple.moveBase(id,{dx:5,dy:4});assert.equal(engine.getTrack(boom.id).keys.find(k=>k.frame===9).values.x,modified+8);assert(simple.inspect(id).needsReplacement);
const beforeDuplicate=engine.project, duplicate=simple.duplicate(id), duplicateChildren=simple.ownedCompanions(duplicate.id);
assert.equal(duplicateChildren.length,1);assert.notEqual(duplicateChildren[0].id,boom.id);assert(simple.inspect(duplicate.id).needsReplacement);
for(const f of [0,8,9,13]){const a=engine.getObjectAt(boom.id,f),b=engine.getObjectAt(duplicateChildren[0].id,f);assert.equal(b.x-a.x,8);assert.equal(b.y-a.y,8);}
engine.undo();assert.deepEqual(engine.project,beforeDuplicate,'Duplicating custom combat and its effects is one Undo');
simple.apply(id,{speed:'normal'},{replaceCustom:true});assert(!simple.inspect(id).needsReplacement);
const beforeTiming=engine.project;engine.batch(()=>{engine.configureClip({duration:96,fps:24});simple.refreshAll();});
assert.equal(simple.ownedCompanions(id).length,1);assert.equal(engine.getTrack(simple.ownedCompanions(id)[0].id).keys.length,96);assert(!simple.inspect(id).needsReplacement);
engine.undo();assert.deepEqual(engine.project,beforeTiming,'Timing refresh keeps the entire action atomic');
const saved=engine.saveData(), restored=harness(saved);assert.equal(restored.simple.ownedCompanions(id).length,1);assert(!restored.simple.inspect(id).needsReplacement);
const beforeDelete=restored.engine.project;restored.engine.removeObject(id);assert.equal(restored.engine.currentClip.objects.length,0,'Deleting an actor removes owned companions');restored.engine.undo();assert.deepEqual(restored.engine.project,beforeDelete);
const duplicatedClip=restored.engine.duplicateClip(), owner=duplicatedClip.objects.find(o=>o.simpleAnimation), owned=duplicatedClip.objects.filter(o=>o.simpleCompanion);
assert(owner && owned.length===1 && owned[0].simpleCompanion.ownerId===owner.id,'Clip duplication remaps effect ownership');
restored.simple.refreshAll();assert.equal(restored.simple.ownedCompanions(owner.id).length,1);
const beforeRemove=engine.project;simple.remove(id);assert.equal(engine.currentClip.objects.length,1);engine.undo();assert.deepEqual(engine.project,beforeRemove,'Removing an action removes effects in the same Undo');
const standaloneBefore=engine.project, standalone=simple.duplicate(simple.ownedCompanions(id)[0].id);
assert(!standalone.simpleCompanion,'Duplicating an effect alone creates an independent editable piece');
assert.equal(simple.ownedCompanions(id).length,1);assert(!simple.inspect(id).needsReplacement);
engine.undo();assert.deepEqual(engine.project,standaloneBefore);
const removedChild=simple.ownedCompanions(id)[0];engine.removeObject(removedChild.id);
assert(simple.inspect(id).needsReplacement,'Deleting one companion is a custom edit, not silent regeneration');
assert.throws(()=>simple.refreshAll(),e=>e.code==='SIMPLE_CUSTOM_KEYS');engine.undo();
const rollback=harness(), rollbackActor=add(rollback.engine,'link-bomb-left');
rollback.simple.apply(rollbackActor.id,{presetId:'link-bomb-left'});
const lockedBurst=rollback.simple.ownedCompanions(rollbackActor.id).find(o=>o.simpleCompanion.role==='burst');
rollback.engine.setTrack(lockedBurst.id,{locked:true});const lockedBefore=rollback.engine.project;
assert.throws(()=>rollback.simple.apply(rollbackActor.id,{speed:'slow'}));
assert.deepEqual(rollback.engine.project,lockedBefore,'A locked effect rolls back the whole body and companion edit');
rollback.engine.setTrack(lockedBurst.id,{locked:false});
missing=pack.getEffect('bomb').pieceIds[0];const missingBefore=rollback.engine.project;
assert.throws(()=>rollback.simple.apply(rollbackActor.id,{speed:'fast'}));
assert.deepEqual(rollback.engine.project,missingBefore,'A missing real effect rolls back without leaving a partial animation');missing=null;
const fuse=harness(), fuseOwner=add(fuse.engine,'bobomb-fuse-down');
fuse.simple.apply(fuseOwner.id,{presetId:'bobomb-fuse-down',motion:'right',distance:24});
const fuseChildren=fuse.simple.ownedCompanions(fuseOwner.id);assert.equal(fuseChildren.length,1);assert.equal(fuseChildren[0].simpleCompanion.role,'burst');
const detonate=fuse.engine.getTrack(fuseChildren[0].id).keys.find(key=>key.values.visible).frame;
close(center(fuse.engine.getObjectAt(fuseChildren[0].id,detonate)),hand(fuse.engine,fuseOwner.id,'bobomb-fuse-down',detonate),'Bob-omb explodes at its own moving body');
for(const action of pack.actions){
  const h=harness(), body=add(h.engine,action.id);
  h.simple.apply(body.id,{presetId:action.id,motion:'none'});
  if(action.kind==='melee'||action.kind==='guard'||action.kind==='equip')assert.equal(h.simple.ownedCompanions(body.id).length,0,'No invented arrows or untargeted melee impacts');
  for(const transform of [{scale:1,rotation:0,flipX:false,flipY:false},{scale:2,rotation:0,flipX:true,flipY:true},{scale:1,rotation:45,flipX:false,flipY:false},{scale:2,rotation:270,flipX:true,flipY:true}]){
    h.simple.place(body.id,transform);const start=feet(h.engine.getObjectAt(body.id,0));
    for(let f=0;f<48;f++)close(feet(h.engine.getObjectAt(body.id,f)),start,'Every reviewed combat pose keeps its actor pivot');
    for(const fx of h.simple.ownedCompanions(body.id)){
      assert(fx.simpleCompanion.generated.length===48);
      for(let f=0;f<48;f++){const evaluated=h.engine.getObjectAt(fx.id,f);assert(pieceMap.has(evaluated.pieceId));assert.equal(evaluated.scale,transform.scale);assert.equal(evaluated.flipX,transform.flipX);assert.equal(evaluated.rotation,transform.rotation);}
    }
  }
}
for (const actionId of ['link-bomb-left', 'link-boomerang-left']) for (const angle of [45, 90, 180, 315]) {
  const h = harness(), actor = add(h.engine, actionId); h.simple.apply(actor.id, { presetId: actionId });
  const beforeTurn = h.engine.project, childIds = h.simple.ownedCompanions(actor.id).map(object => object.id).sort();
  const referenceHand = hand(h.engine, actor.id, actionId, 8), referenceEffects = new Map(h.simple.ownedCompanions(actor.id).map(object => [object.simpleCompanion.role,
    Array.from({ length: 14 }, (_, frame) => center(h.engine.getObjectAt(object.id, frame)))]));
  h.simple.place(actor.id, { rotation: angle });
  assert.deepEqual(h.simple.ownedCompanions(actor.id).map(object => object.id).sort(), childIds, 'A rotation refresh keeps the existing owned effect IDs');
  const start = hand(h.engine, actor.id, actionId, 8), radians = angle * Math.PI / 180;
  for (const child of h.simple.ownedCompanions(actor.id)) for (let frame = child.simpleCompanion.role === 'burst' ? 12 : 8; frame < 14; frame++) {
    const evaluated = h.engine.getObjectAt(child.id, frame); if (!evaluated.visible) continue;
    const old = referenceEffects.get(child.simpleCompanion.role)[frame], dx = old.x - referenceHand.x, dy = old.y - referenceHand.y, now = center(evaluated);
    const expected = { x: start.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: start.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
    assert(Math.abs(now.x - expected.x) <= 2 && Math.abs(now.y - expected.y) <= 2, 'The entire released-item path rotates with the character: ' + JSON.stringify({actionId,angle,frame,now,expected}));
    assert.equal(evaluated.rotation, angle);
  }
  const projectile = h.simple.ownedCompanions(actor.id).find(object => object.simpleCompanion.role === 'projectile');
  close(center(h.engine.getObjectAt(projectile.id, 8)), start, 'Rotated throws still release from the hand');
  if (actionId.includes('boomerang')) close(center(h.engine.getObjectAt(projectile.id, 13)), hand(h.engine, actor.id, actionId, 13), 'A rotated boomerang returns to the hand');
  assert(!h.simple.inspect(actor.id).needsReplacement);
  const savedTurn = h.engine.saveData(), reopened = harness(savedTurn);
  assert.equal(reopened.engine.getObjectAt(actor.id, 8).rotation, angle); assert(!reopened.simple.inspect(actor.id).needsReplacement, 'Saving preserves the rotated ready action and effects');
  h.engine.undo(); assert.deepEqual(h.engine.project, beforeTurn, 'Rotating the character, its release and all owned effects is one Undo');
}
const hidden=harness(), hiddenOwner=add(hidden.engine,'octorok-shot-left');hidden.engine.setKey(hiddenOwner.id,0,{visible:false});hidden.simple.apply(hiddenOwner.id,{presetId:'octorok-shot-left'});
assert(hidden.simple.ownedCompanions(hiddenOwner.id).every(o=>hidden.engine.getTrack(o.id).keys.every(k=>!k.values.visible)),'Hidden characters do not emit visible projectiles');
console.log('PASS: owned combat companions, exact hand release, bomb flight/explosion, returning boomerang, source effect frames, all 42 actor pivots, scale/flips/movement, pure compilation, atomic edits, custom guards, duplication, removal, duration refresh, save/reopen and owner deletion.');
