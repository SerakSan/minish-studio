#!/usr/bin/env python3
"""Build transparent, editable, reference-informed complete boss presets.

Only published sprite pixels are used. GBA affine scale/rotation is reproduced
with nearest-neighbour sampling. Articulated arrangements are scene presets,
not claimed ROM animation captures. Every part retains its source rectangle.
"""
from __future__ import annotations
import argparse, base64, copy, hashlib, json, math, zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

GS='https://www.gamespot.com/wp-content/uploads/original/gamespot/images/2005/013/reviews/'
VIDEO='https://www.youtube.com/watch?v=YHydYUR37bQ'
CODE='https://github.com/zeldaret/tmc/blob/master/src/'
REFERENCES={
 '6415': [{'title':'Nintendo: official Minish Cap gameplay screenshot','url':'https://www.nintendo.com/jp/games/feature/nintendo-classics/detail/img/A-8665_j_05.jpg'},{'title':'Chuchu component offsets and affine scale','url':CODE+'enemy/chuchuBoss.c'}],
 '6460': [{'title':'Chuchu gameplay reference','url':VIDEO+'&t=37'},{'title':'Chuchu component offsets and affine scale','url':CODE+'enemy/chuchuBoss.c'}],
 '6506': [{'title':'GameSpot: Big Octorok gameplay','url':GS+'632853-920670_20050114_036.jpg'},{'title':'Octorok gameplay, normal and frozen phases','url':VIDEO+'&t=482'},{'title':'Octorok separate body, legs, mouth and tail; affine scale','url':CODE+'enemy/octorokBoss.c'}],
 '6546': [{'title':'GameSpot: Gleerok stunned with extended neck','url':GS+'632836-920670_20050114_019.jpg'},{'title':'Gleerok five neck entities and head spacing','url':CODE+'enemy/gleerok.c'}],
 '6461': [{'title':'GameSpot: Red Gyorg eye phase','url':GS+'632863-920670_20050114_046.jpg'},{'title':'Gyorg Pair gameplay','url':VIDEO+'&t=659'},{'title':'Blue Gyorg affine size','url':CODE+'enemy/gyorgMale.c'},{'title':'Gyorg tail segment counts and distances','url':CODE+'projectile/gyorgTail.c'}],
 '535841': [{'title':'GameSpot: Mazaal head and detached hands','url':GS+'632844-920670_20050114_027.jpg'}],
 '6534': [{'title':'Zelda Universe: Vaati Reborn captured gameplay','url':'https://zeldauniverse.net/wp-content/uploads/2019/11/vaati-reborn-886x593.png'},{'title':'GameSpot: Vaati Reborn gameplay','url':GS+'632870-920670_20050114_053.jpg'}],
 '31116': [{'title':'GameSpot: Transfigured with four open red orbs','url':GS+'632871-920670_20050114_054.jpg'}],
 '6535': [{'title':'GameSpot: Wrath four-eye phase','url':GS+'632873-920670_20050114_056.jpg'},{'title':'Wrath armed and eye phases gameplay','url':VIDEO+'&t=1150'},{'title':'Wrath four articulated arm links plus claw','url':CODE+'enemy/vaatiArm.c'},{'title':'Wrath eye arrangement coordinates','url':CODE+'enemy/vaatiWrathEye.c'}],
}
COVERAGE={
 '6415':'Six upright head expressions on the four-part standing arrangement checked against Nintendo gameplay, at normal 1.6× affine scale. All 27 large head states remain available in Boss parts. Falling and defeat expressions are not attached to an unsupported standing body; exact collapse curves and ROM timing are not reconstructed.',
 '6460':'Six upright head expressions with genuine narrow neck and wide foot, using the shared Chuchu four-part geometry and normal 1.6× affine scale. All 27 head states and electric effects remain in Boss parts. Falling, defeat curves and the ROM timeline are not reconstructed.',
 '6506':'Normal, burning and frozen source states; four separate legs, mouth, four tail joints and tail flower; eight rotation presets. Body uses the game’s normal 1.6× affine scale. Rotation, breathing and tail movement vary continuously, so these are reference-informed editor poses.',
 '6546':'Genuine rocky body, five neck links and distinct jawed head. Front, side, lowered and damaged arrangements use the available directional source frames. Neck curves are editable presets; exact ROM animation timings and every curve are not asserted.',
 '6461':'Three red body source frames with all eight genuine eye overlays, articulated red tail; five blue body frames at game affine scale with eye and articulated tail. Eye patterns and tail bends are editable gameplay phase presets, not every possible combination.',
 '535841':'All eight published active hand poses, corresponding inactive blue poses, head and mirrored opposite hand. Includes mixed and inactive hand phases. Floating hand spacing is an editable scene arrangement.',
 '6534':'Available complete humanoid action, moving and teleport frames; two-eye, four-eye and covered-eye shield presets. No detached transformation fragments are presented as complete bosses. Eye orbit angle is editable rather than a claim of every ROM state.',
 '31116':'Complete eight-orb body and energy frames, four-open-eye gameplay patterns and exposed body frames. Projectile effects and transformation fragments remain separate in Boss parts.',
 '6535':'All 14 published normal body animation states with two articulated arms, five source claw angles, one-arm states, four real eye states, charging and exposed phase. Arm curves and eye wave positions are editable reference-informed presets, not exact ROM animation captures.',
}

def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write_json(path,value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def rect_part(sid,rect,at=(0,0),flip_x=False,label='Source frame',resize=None,rotation=0):
 x,y,w,h=rect
 p={'sourceId':sid,'sourceRect':{'x':x,'y':y,'w':w,'h':h},'at':{'x':round(at[0]),'y':round(at[1])},'flipX':flip_x,'label':label}
 if resize: p['resize']={'w':round(resize[0]),'h':round(resize[1])}
 if rotation: p['rotation']=rotation
 return p

def part_size(p):
 r=p.get('resize',p['sourceRect']); w,h=r['w'],r['h']
 return Image.new('RGBA',(w,h)).rotate(p.get('rotation',0),expand=True).size

def centered(sid,rect,center,label,scale=1,flip=False,rotation=0):
 p=rect_part(sid,rect,flip_x=flip,label=label,resize=(rect[2]*scale,rect[3]*scale) if scale!=1 else None,rotation=rotation)
 w,h=part_size(p);p['at']={'x':round(center[0]-w/2),'y':round(center[1]-h/2)}
 return p

def normalize(parts):
 x=min(p['at']['x'] for p in parts); y=min(p['at']['y'] for p in parts)
 for p in parts: p['at']['x']-=x;p['at']['y']-=y
 return parts

def rotate_parts(parts,angle):
 parts=copy.deepcopy(parts)
 if angle==0:return normalize(parts)
 rad=math.radians(angle)
 for p in parts:
  w,h=part_size(p);x=p['at']['x']+w/2;y=p['at']['y']+h/2
  p['rotation']=p.get('rotation',0)+angle
  nw,nh=part_size(p)
  p['at']={'x':round(x*math.cos(rad)+y*math.sin(rad)-nw/2),'y':round(-x*math.sin(rad)+y*math.cos(rad)-nh/2)}
 return normalize(parts)

def recipes(library):
 items=[]
 def add(sid,key,name,parts,group,direction='Front',method='reference-informed-multipart-preset',note='',cover=False):
  items.append({'sourceId':sid,'key':key,'name':name,'parts':normalize(parts),'group':group,'phase':group,'state':name,'direction':direction,'method':method,'note':note or COVERAGE[sid],'cover':cover})
 for sid,offset in [('6415',(0,0)),('6460',(3,5))]:
  dx,dy=offset
  frames=[p for p in library['sheets'][sid]['pieces'] if p['name'].startswith('Body frame')]
  assert len(frames)==27
  for i,p in enumerate(frames[:6]):
   phase='Upright expressions'
   # In-game normal chain distances are 14,18,14px. Each object has its own
   # affine transform; the large head crop alone is not the whole boss.
   lean=0
   foot=(37,83);belly=(37+lean//3,69);neck=(37+lean*2//3,51);head=(37+lean,37)
   parts=[centered(sid,(247+dx,352+dy,40,22),foot,'Foot/base',1.6),centered(sid,(196+dx,346+dy,15,23),belly,'Lower neck',1.6),centered(sid,(180+dx,345+dy,15,25),neck,'Upper neck',1.6),centered(sid,tuple(p[k] for k in ('sx','sy','sw','sh')),head,'Head / expression',1.6)]
   add(sid,f'upright-{i+1:02}',f'Upright · head {i+1:02}',parts,phase,cover=i==0)
 # Body scale 256/0xa0; appendages retain 1× scale. Four legs and four
 # chain objects are required by the game's entity construction.
 for state,body,mouth,leg,flower,joint in [
  ('Leaf-covered',(0,0,64,64),(124,18,42,46),(74,31,38,33),(215,37,31,27),(172,33,14,14)),
  ('Burning',(0,77,64,64),(124,95,42,46),(74,108,38,33),(215,114,31,27),(172,110,14,14)),
  ('Frozen',(0,225,64,64),(124,243,42,46),(74,256,38,33),(215,264,19,24),(172,258,14,14))]:
  for angle,direction in [(0,'Front'),(45,'Front-right'),(90,'Right'),(135,'Back-right'),(180,'Back'),(225,'Back-left'),(270,'Left'),(315,'Front-left')]:
   parts=[]
   for j,(cx,cy,flip,rot) in enumerate([(39,51,False,180),(111,51,True,180),(35,92,True,0),(115,92,False,0)]):
    parts.append(centered('6506',leg,(cx,cy),f'Leg {j+1}',flip=flip,rotation=rot))
   parts.append(centered('6506',mouth,(75,120),'Mouth tube'))
   parts.append(centered('6506',body,(75,75),'Affine-scaled body',1.6))
   for j,cy in enumerate([24,16,8,0]):parts.append(centered('6506',joint,(75,cy),f'Tail joint {j+1}'))
   parts.append(centered('6506',flower,(75,-8),'Tail flower'))
   add('6506',f'{state.lower()}-{angle:03}',f'{state} · {direction.lower()}',rotate_parts(parts,angle),state,direction,cover=state=='Leaf-covered' and angle==0)
 # Gleerok is a body, FIVE link entities, and one head. Published profiles
 # already encode direction; they are not freely rotated skull approximations.
 gleerok=[('front','Raised front',(23,405,47,67),(41,163,26,28),[(40,58),(40,70),(40,82),(40,94),(40,106)],(40,119),'Front'),('right','Extended right',(23,405,47,67),(127,206,33,24),[(46,48),(58,48),(70,48),(82,48),(94,48)],(110,48),'Right'),('left','Extended left',(23,405,47,67),(168,204,32,29),[(46,48),(58,48),(70,48),(82,48),(94,48)],(110,48),'Left'),('lowered','Lowered head',(95,407,48,63),(112,163,32,26),[(46,48),(58,52),(70,56),(82,60),(94,64)],(110,68),'Right'),('damage','Stunned / flashing',(233,417,50,51),(230,165,28,24),[(46,40),(58,40),(70,40),(82,40),(94,40)],(110,40),'Right')]
 for key,name,body,head,links,hc,direction in gleerok:
  parts=[centered('6546',body,(25,40),'Rocky shell/body')]
  for j,c in enumerate(links):parts.append(centered('6546',(362,223,16,15) if key=='damage' else (212,316,16,16) if key=='front' else (238,343,16,16),c,f'Neck link {j+1}'))
  parts.append(centered('6546',head,hc,'Jawed head',flip=key in ('right','damage')))
  if key=='left':
   for p in parts:p['at']['x']=-p['at']['x']-part_size(p)[0];p['flipX']=not p.get('flipX',False)
  add('6546',key,name,parts,'Stunned' if key=='damage' else 'Neck / direction',direction,cover=key=='right')
 # Red Gyorg's black-star socket pixels are source placeholders. All eight
 # are covered with real closed/open eye discs, and the tail is separate.
 red_rects=[(8,10,236,167),(249,7,236,170),(490,6,236,171)]
 redparts=None
 for frame,body in enumerate(red_rects,1):
  for state,open_indices in [('Shielded',[]),('Three eyes',[0,3,5]),('Four eyes',[0,2,5,7])]:
   parts=[rect_part('6461',body,(0,0),label='Red Gyorg body')]
   # Eye sockets are at the same coordinates relative to the curled horns.
   for eye in range(8):
    r=(820,3,14,14) if eye in open_indices else (786,3,14,13)
    parts.append(rect_part('6461',r,(87+(eye%4)*16,30+[0,3,4][frame-1]+(eye//4)*16),label=f'Eye {eye+1}'))
   # Red tail consists of three links, a tip and the root helper. The first
   # link is occluded by the body; joints are 20,18,17px from root outward.
   for j,(cy,r) in enumerate([(158,(800,53,20,20)),(178,(801,97,18,18)),(196,(801,117,18,18))]):parts.insert(0,centered('6461',r,(118,cy+[0,3,4][frame-1]),f'Red tail link {j+1}'))
   parts.insert(0,centered('6461',(794,139,32,31),(118,220+[0,3,4][frame-1]),'Red tail tip'))
   add('6461',f'red-{frame}-{state.lower().replace(" ","-")}',f'Red Gyorg · {state.lower()} · frame {frame}',parts,'Red Gyorg / '+state,cover=frame==1 and state=='Three eyes')
   if frame==1 and state=='Three eyes':redparts=copy.deepcopy(parts)
 blue_rects=[(7,183,52,46),(70,182,56,47),(132,182,62,47),(198,183,60,46),(264,184,58,45)]
 blueparts=None
 for frame,body in enumerate(blue_rects,1):
  for eye_index in range(4):
   parts=[]
   # Tail segments: 32px from body to first link, then16, then15 to tip.
   for j,cy in enumerate([67,83]):parts.append(centered('6461',(805,199,16,16),(45,cy),f'Blue tail link {j+1}'))
   parts.append(centered('6461',(803,251,21,24),(45,98),'Blue tail tip'))
   parts.append(centered('6461',body,(45,35),'Affine-scaled blue body',256/170))
   ex,ey=[(-16,-16),(17,-16),(17,16),(-16,16)][eye_index]
   parts.append(centered('6461',(788,181,12,14),(45+ex,35+ey),'Open corner eye'))
   add('6461',f'blue-{frame}-eye-{eye_index+1}',f'Blue Gyorg · eye {eye_index+1} · frame {frame}',parts,'Blue Gyorg / Open eye',cover=False)
   if frame==1 and eye_index==0:blueparts=copy.deepcopy(parts)
 for p in blueparts:p['at']['x']+=246;p['at']['y']+=70
 add('6461','pair','Gyorg Pair · both complete',redparts+blueparts,'Gyorg Pair',cover=True,note='Two complete bosses at their genuine normal relative scales. Spacing is an editable scene preset. '+COVERAGE['6461'])
 active=[(42,161,50,47),(112,160,47,63),(176,160,33,63),(240,164,41,57),(316,175,36,49),(378,176,37,48),(428,173,50,50),(491,176,49,48)]
 inactive=[(36,225,50,47),(97,224,47,63),(175,224,33,63),(231,228,41,57),(288,239,36,49),(353,240,37,48),(418,237,50,50),(484,240,49,48)]
 for i,(left,right) in enumerate(zip(active,inactive)):
  for state,lr,rr in [('Active hands',left,left),('One hand disabled',left,right),('Inactive hands',right,right)]:
   parts=[rect_part('535841',(33,34,94,66),(68,0),label='Head'),rect_part('535841',lr,(0,34),label='Left hand'),rect_part('535841',rr,(230-rr[2],34),True,label='Right hand')]
   add('535841',f'{state.lower().replace(" ","-")}-{i+1}',f'{state} · pose {i+1}',parts,state,cover=i==0 and state=='One hand disabled')
 # Complete Reborn humanoid frames. The source's reference picture and
 # transformation silhouettes are excluded from the ready-to-place gallery.
 reborn=[]
 for p in library['sheets']['6534']['pieces']:
  x,y,w,h=(p[k] for k in ('sx','sy','sw','sh'))
  if w>=24 and w<=90 and h>=45 and y>=70 and (y>=110 or x>=180) and not(x>557 and y>285):
   if y<200:phase='Transformation' 
   elif y<290:phase='Moving'
   elif y<365:phase='Casting'
   elif y<435:phase='Teleport / closed'
   else:phase='Teleport / open'
   reborn.append(((x,y,w,h),phase))
 for i,(r,phase) in enumerate(reborn,1):add('6534',f'body-{i:02}',f'{phase} · frame {i:02}',[rect_part('6534',r,label='Complete humanoid body')],phase,method='source-complete-frame')
 r=(294,73,42,56)
 for count,covered in [(2,False),(4,False),(4,True)]:
  parts=[centered('6534',r,(50,45),'Complete humanoid body')]
  coords=[(19,45),(81,45)] if count==2 else [(18,45),(50,12),(82,45),(50,78)]
  for i,c in enumerate(coords):parts.append(centered('6534',(26,440,16,16) if covered else (6,293,10,10),c,f'Protective eye {i+1}'))
  name=f'{count} protective eyes'+(' · covered' if covered else '')
  add('6534',f'shield-{count}-{covered}',name,parts,'Shielded',cover=count==4 and not covered)
 orb_positions=[(16,0),(32,0),(0,16),(48,16),(0,32),(48,32),(16,48),(32,48)]
 for i,r in enumerate([(366,157,64,64),(436,157,64,64),(506,157,64,64),(577,157,64,64)],1):
  for state,mask in [('Closed orbs',[]),('Four open eyes',[0,1,2,3]),('Four open eyes lower',[4,5,6,7])]:
   parts=[rect_part('31116',r,label='Complete body and eight closed orbs')]
   for j in mask:parts.append(rect_part('31116',(612,228,16,16),orb_positions[j],label=f'Open red eye {j+1}'))
   add('31116',f'orbs-{i}-{state.lower().replace(" ","-")}',f'{state} · frame {i}',parts,'Orb phase',method='source-complete-frame' if not mask else 'reference-informed-multipart-preset',cover=i==1 and bool(mask))
 for i,r in enumerate([(690,103,83,86),(782,103,84,86),(873,103,84,86),(965,103,84,86)],1):add('31116',f'energy-{i}',f'Energy · frame {i}',[rect_part('31116',r,label='Complete energy frame')],'Energy',method='source-complete-frame')
 # These four source frames are the body after the surrounding orb shield is removed.
 for i,r in enumerate([(14,159,40,48),(64,159,44,48),(116,159,40,48),(166,159,44,48)],1):add('31116',f'exposed-{i}',f'Exposed · frame {i}',[rect_part('31116',r,label='Exposed body')],'Exposed',method='source-complete-frame')
 bodies=[p for p in library['sheets']['6535']['pieces'] if p['sy']==1 and p['sw']>=40 and p['sh']>=50]
 claws=[(1,207,30,29),(34,208,30,32),(66,208,31,29),(133,206,31,32),(165,206,32,29)]
 def wrath_parts(body,claw_index=3,arms='both',bent=False):
  parts=[]
  # Each arm is four joint objects and a claw, links12,14,16px. Root sits
  # 28px from body; exact curves vary continuously under gameplay control.
  for side in [-1,1]:
   if arms=='none' or (arms=='left' and side==1) or (arms=='right' and side==-1):continue
   coords=[(side*22,43),(side*33,48),(side*45,56),(side*55,68)] if bent else [(side*22,42),(side*34,42),(side*48,42),(side*64,42)]
   for j,(x,y) in enumerate(reversed(coords)):parts.append(centered('6535',(0,239,16,15),(85+x,y),('Left' if side<0 else 'Right')+f' arm joint {4-j}'))
   end=(side*62,84) if bent else (side*76,45)
   parts.append(centered('6535',claws[claw_index],(85+end[0],end[1]),('Left' if side<0 else 'Right')+' claw',flip=side==1))
  parts.append(centered('6535',(131,116,32,16),(85,46),'Central eye beneath body aperture'))
  parts.append(centered('6535',body,(85,31.5),'Complete main body'))
  return parts
 for i,p in enumerate(bodies,1):
  body=tuple(p[k] for k in ('sx','sy','sw','sh'))
  add('6535',f'armed-body-{i:02}',f'Two arms · body frame {i:02}',wrath_parts(body,bent=True),'Armed',cover=i==1)
 for i in range(5):add('6535',f'claw-angle-{i+1}',f'Extended arms · claw pose {i+1}',wrath_parts((6,1,53,63),i),'Armed / extended')
 for side in ['left','right']:add('6535',f'one-arm-{side}',f'One arm · {side}',wrath_parts((6,1,53,63),arms=side,bent=True),'One arm')
 for i,eye in enumerate([(167,258,12,12),(184,258,12,12),(201,258,12,12),(218,258,12,12)],1):
  parts=wrath_parts((6,1,53,63),arms='none')
  # Relative x,y from vaatiWrathEye.c; screeny incorporates floating z.
  for j,(x,y) in enumerate([(-24,68),(-8,72),(8,72),(24,68)]):parts.append(centered('6535',eye,(85+x,y),f'Eye {j+1}'))
  add('6535',f'four-eyes-{i}',f'Four eyes · state {i}',parts,'Four eyes')
 for i,eye in enumerate([(183,274,14,14),(199,273,16,16),(216,273,16,16),(233,273,16,16)],1):
  parts=wrath_parts((6,1,53,63),arms='none')
  for j,(x,y) in enumerate([(-24,68),(-8,72),(8,72),(24,68)]):parts.append(centered('6535',eye,(85+x,y),f'Charging eye {j+1}'))
  add('6535',f'charging-{i}',f'Charging eyes · frame {i}',parts,'Charging')
 for i,body in enumerate([(7,66,58,64),(65,77,48,56)],1):
  parts=[centered('6535',(131,65+(i-1)*17,32,16),(85,46),'Exposed central eye'),centered('6535',body,(85,31.5),'Exposed main body')]
  add('6535',f'exposed-{i}',f'Exposed · frame {i}',parts,'Exposed')
 return items


def source_images(root,catalog,library,sprites):
 assets={a['id']:a for a in catalog['assets']+library['assets']+sprites['assets']};result={}
 for source in catalog['assets']:
  if source['section']!='Bosses':continue
  sid=source['id'];aid='clean-'+sid if 'clean-'+sid in assets else sid;aid=sprites['assetOverrides'].get(aid,aid)
  result[sid]=(Image.open(root/assets[aid]['path']).convert('RGBA'),aid)
 return result

def transformed_part(part,images):
 source,_=images[part['sourceId']];r=part['sourceRect']
 assert 0<=r['x']<source.width and 0<=r['y']<source.height and r['x']+r['w']<=source.width and r['y']+r['h']<=source.height,(part,source.size)
 crop=source.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h']))
 if part.get('flipX'):crop=ImageOps.mirror(crop)
 if part.get('resize'):crop=crop.resize((part['resize']['w'],part['resize']['h']),Image.Resampling.NEAREST)
 if part.get('rotation'):crop=crop.rotate(part['rotation'],Image.Resampling.NEAREST,expand=True)
 return crop

def compose(recipe,images):
 crops=[transformed_part(p,images) for p in recipe['parts']]
 w=max(p['at']['x']+im.width for p,im in zip(recipe['parts'],crops));h=max(p['at']['y']+im.height for p,im in zip(recipe['parts'],crops))
 canvas=Image.new('RGBA',(w,h))
 for p,im in zip(recipe['parts'],crops):canvas.alpha_composite(im,(p['at']['x'],p['at']['y']))
 b=canvas.getchannel('A').getbbox();assert b
 trimmed=canvas.crop(b);padded=Image.new('RGBA',(trimmed.width+4,trimmed.height+4));padded.paste(trimmed,(2,2))
 return padded,{'x':b[0],'y':b[1],'w':b[2]-b[0],'h':b[3]-b[1],'padding':2}

def image_asset(root,path,im,aid,source,**extra):
 im.save(path,optimize=True)
 return {'id':aid,'name':source['name'],'path':path.relative_to(root).as_posix(),'width':im.width,'height':im.height,'sourceId':source['id'],'originalSourceId':source['id'],'sourceUrl':source['sourceUrl'],'contributors':source.get('contributors',''),'sha256':digest(path),'dataUrl':'data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode(),**extra}

def build(root):
 catalog=json.loads((root/'assets/catalog.json').read_text());library=json.loads((root/'assets/pieces.json').read_text());sprites=json.loads((root/'assets/sprites.json').read_text());sources={a['id']:a for a in catalog['assets']};images=source_images(root,catalog,library,sprites)
 dest=root/'assets/bosses';dest.mkdir(exist_ok=True)
 for p in list(dest.glob('boss-v4-*.png'))+list(dest.glob('boss-part-v4-*.png'))+list(dest.glob('boss-complete-*.png')):p.unlink()
 result={'version':4,'generatedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),'assets':[],'catalog':[],'sheets':{},'recipes':[],'references':REFERENCES,'scope':'Available published complete frames and reference-informed editable multipart presets for all nine boss sheets. Continuous affine transforms, joint curves, hidden ROM states and exact animation timelines are not exhaustively reconstructed. No community labels or example collages are included as boss artwork.'}
 counts=Counter();thumbs={};part_cache={}
 for recipe in recipes(library):
  sid=recipe['sourceId'];source=sources[sid];synthetic='full-boss-'+sid;aid='boss-v4-'+sid+'-'+recipe['key'];pid=aid+'-piece';im,bounds=compose(recipe,images);resolved=[]
  for p in recipe['parts']:
   q=copy.deepcopy(p);q['sourceAssetId']=images[p['sourceId']][1]
   if p.get('resize') or p.get('rotation'):
    proof={k:p[k] for k in ['sourceId','sourceRect','resize','rotation','flipX'] if k in p};key=hashlib.sha256(json.dumps(proof,sort_keys=True).encode()).hexdigest()[:16];paid='boss-part-v4-'+sid+'-'+key
    crop=transformed_part(p,images)
    if paid not in part_cache:
     asset=image_asset(root,dest/(paid+'.png'),crop,paid,source,internalBossPart=True,sourceTransform=proof)
     result['assets'].append(asset);part_cache[paid]=asset
    q={'sourceId':sid,'sourceAssetId':paid,'sourceRect':{'x':0,'y':0,'w':crop.width,'h':crop.height},'at':p['at'],'flipX':False,'label':p['label'],'originalSourceId':sid,'originalSourceAssetId':images[sid][1],'originalSourceRect':p['sourceRect'],'sourceTransform':proof}
   resolved.append(q)
  asset=image_asset(root,dest/(aid+'.png'),im,aid,source,name=source['name']+' · '+recipe['name'],compositionMethod=recipe['method'],sourceParts=resolved,compositionCrop=bounds,gameplayReferences=REFERENCES[sid])
  result['assets'].append(asset)
  piece={'id':pid,'name':recipe['name'],'assetId':aid,'sourceId':synthetic,'originalSourceId':sid,'sx':0,'sy':0,'sw':im.width,'sh':im.height,'sourceRect':{'x':0,'y':0,'w':im.width,'h':im.height},'kind':'assembled-boss','group':recipe['group'],'phase':recipe['phase'],'state':recipe['state'],'direction':recipe['direction'],'sequence':counts[sid]+1,'sourceParts':resolved,'compositionCrop':bounds,'compositionMethod':recipe['method'],'note':recipe['note'],'coverageNote':COVERAGE[sid],'gameplayReferences':REFERENCES[sid]}
  if synthetic not in result['sheets']:
   result['sheets'][synthetic]={'sourceId':synthetic,'originalSourceId':sid,'category':'full-bosses','pieces':[],'note':COVERAGE[sid],'coverageNote':COVERAGE[sid],'coverage':{'fullSourceAvailable':True,'sourceUrl':source['sourceUrl'],'originalSha256':source['originalSha256'],'gameplayReferences':REFERENCES[sid],'exhaustiveRomPoses':False}}
   result['catalog'].append({'id':synthetic,'name':source['name'],'sourceId':sid,'originalSourceId':sid,'section':'Full bosses','category':'full-bosses','sourceUrl':source['sourceUrl'],'contributors':source.get('contributors',''),'derived':True,'sourceType':'complete-boss-presets','coverageNote':COVERAGE[sid],'gameplayReferences':REFERENCES[sid]})
  result['sheets'][synthetic]['pieces'].append(piece);result['recipes'].append({**recipe,'assetId':aid,'sourceParts':resolved,'compositionCrop':bounds});counts[sid]+=1
  if sid not in thumbs or recipe['cover']:thumbs[sid]=(im,recipe['name'],pid,aid)
 for sid,(_,_,pid,_) in thumbs.items():result['sheets']['full-boss-'+sid].update(coverPieceId=pid,previewPieceId=pid)
 for item in result['catalog']:
  im,_,_,aid=thumbs[item['sourceId']];item.update(path='assets/bosses/'+aid+'.png',thumbnail='assets/bosses/'+aid+'.png',width=im.width,height=im.height)
  if item['sourceId']=='535841':item['printedSheetCredits']='Sprites ripped by Moosh. Special thanks to P-Tux7 for the save state.'
 result['stats']={'bossSources':len(counts),'completeBossPresets':sum(counts.values()),'bySource':dict(counts),'editableTransformParts':len(part_cache),'multipartEditorAssemblies':sum(r['method']=='reference-informed-multipart-preset' for r in result['recipes'])}
 write_json(root/'assets/full-bosses.json',result);(root/'assets/full-bosses.js').write_text('window.MINISH_BOSSES='+json.dumps(result,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
 write_json(dest/'source-recipes.json',{'version':4,'recipes':result['recipes'],'scope':result['scope'],'references':REFERENCES,'coverageNotes':COVERAGE})
 contact=Image.new('RGB',(1080,900),'#172735');draw=ImageDraw.Draw(contact)
 for i,(sid,(sprite,name,_,_)) in enumerate(thumbs.items()):
  x,y=(i%3)*360,(i//3)*300
  for yy in range(y,y+255,8):
   for xx in range(x,x+360,8):draw.rectangle((xx,yy,xx+7,yy+7),fill='#3d5361' if ((xx-x)//8+(yy-y)//8)%2 else '#233d49')
  scale=min(3,344/sprite.width,247/sprite.height);scale=int(scale) if scale>=1 else scale
  ti=sprite.resize((round(sprite.width*scale),round(sprite.height*scale)),Image.Resampling.NEAREST);contact.paste(ti,(x+(360-ti.width)//2,y+(255-ti.height)//2),ti)
  draw.text((x+8,y+260),sources[sid]['name']+' / '+sid,fill='white');draw.text((x+8,y+277),name[:50],fill='#c9e6c5')
 contact.save(dest/'complete-bosses-preview.png')
 # Crops with coordinate labels make provenance inspectable independently of
 # the source sheet's printed arrangement examples.
 proof=Image.new('RGB',(1080,900),'#203945');pd=ImageDraw.Draw(proof)
 for i,(sid,(_,_,pid,aid)) in enumerate(thumbs.items()):
  x,y=(i%3)*360,(i//3)*300;rec=next(r for r in result['recipes'] if r['assetId']==aid);pd.text((x+6,y+4),sources[sid]['name'],fill='white');seen=set();col=0;row=0
  for p in rec['parts']:
   key=json.dumps(p['sourceRect'],sort_keys=True)
   if key in seen:continue
   seen.add(key);r=p['sourceRect'];src=images[sid][0].crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h']));sc=min(2,100/src.width,95/src.height);ti=src.resize((round(src.width*sc),round(src.height*sc)),Image.Resampling.NEAREST);px=x+col*120+6;py=y+row*130+24;proof.paste(ti,(px,py),ti);pd.text((px,py+96),f"{r['x']},{r['y']} {r['w']}x{r['h']}",fill='#d0e2d4');col+=1
   if col==3:col=0;row+=1
   if row==2:break
 proof.save(dest/'source-parts-preview.png')
 credits='Minish Studio complete boss presets\nGame artwork: The Legend of Zelda: The Minish Cap, Nintendo / Capcom.\nSource sheets: The Spriters Resource.\n\n'+'\n'.join(f"{a['name']}: {a['contributors']}\n{a['sourceUrl']}" for a in result['catalog'])+'\n\nMazaal source also credits Moosh and P-Tux7.\n\n'+result['scope']+'\nNo license to game artwork is granted. Source rectangles, transforms, gameplay references and coverage limitations are in source-recipes.json.\n'
 with zipfile.ZipFile(dest/'minish-studio-full-bosses.zip','w',compression=zipfile.ZIP_DEFLATED) as archive:
  archive.write(dest/'source-recipes.json','source-recipes.json');archive.writestr('CREDITS.txt',credits)
  for a in result['assets']:archive.write(root/a['path'],Path(a['path']).name)
 write_json(dest/'reference-review.json',{'reviewedAt':result['generatedAt'],'references':REFERENCES,'coverageNotes':COVERAGE,'method':'Original sprites visually compared with published captured gameplay; affine scales and articulated component counts cross-checked against public game-code research. Positions remain explicitly labeled editable presets.','limitations':result['scope']})
 import html
 review=['<!doctype html><meta charset="utf-8"><title>Minish Studio boss review</title><style>body{background:#172e38;color:#e7ecce;font:16px/1.5 system-ui;margin:32px}a{color:#f6d985}article{border:2px solid #6b8262;padding:20px;margin:24px 0;display:grid;grid-template-columns:340px 1fr;gap:24px}img{max-width:100%;image-rendering:pixelated;background:repeating-conic-gradient(#263e4a 0% 25%,#3d5361 0% 50%) 0/16px 16px}h1,h2{color:#f7dc8c}</style><h1>Complete boss reference review</h1><p>Minish Studio by SerakSan. '+html.escape(result['scope'])+'</p><p>Every preset can be separated into its genuine source parts in the editor. The links below open independent captured gameplay or geometry research for comparison. They are references, not copied artwork in this pack.</p><img src="source-parts-preview.png" alt="Source part crops with original coordinates">']
 for item in result['catalog']:
  sid=item['sourceId'];_,_,_,aid=thumbs[sid]
  links=' · '.join('<a href="'+html.escape(r['url'],quote=True)+'">'+html.escape(r['title'])+'</a>' for r in REFERENCES[sid])
  review.append('<article><div><img src="'+aid+'.png" alt="'+html.escape(item['name'],quote=True)+' complete editor preset"></div><div><h2>'+html.escape(item['name'])+'</h2><p>'+html.escape(COVERAGE[sid])+'</p><p>'+links+'</p><p>Sprite source: <a href="'+html.escape(item['sourceUrl'],quote=True)+'">The Spriters Resource</a>. '+html.escape(item.get('contributors',''))+'</p></div></article>')
 (dest/'reference-review.html').write_text('\n'.join(review),encoding='utf-8')
 print(json.dumps(result['stats'],indent=2));return result

def verify(root):
 catalog=json.loads((root/'assets/catalog.json').read_text());library=json.loads((root/'assets/pieces.json').read_text());sprites=json.loads((root/'assets/sprites.json').read_text());bosses=json.loads((root/'assets/full-bosses.json').read_text());images=source_images(root,catalog,library,sprites);assets={a['id']:a for a in bosses['assets']}
 assert {a['sourceId'] for a in bosses['catalog']}=={a['id'] for a in catalog['assets'] if a['section']=='Bosses'}
 for source in catalog['assets']:
  assert digest(root/source['originalPath'])==source['originalSha256'];assert digest(root/source['path'])==source['sha256']
 palettes={sid:{rgb[:3] for rgb in image.getdata() if rgb[3]} for sid,(image,_) in images.items()}
 for a in assets.values():
  path=root/a['path'];assert digest(path)==a['sha256'];assert base64.b64decode(a['dataUrl'].split(',',1)[1])==path.read_bytes()
  im=Image.open(path);assert im.mode=='RGBA' and im.format=='PNG';assert im.size==(a['width'],a['height'])
  assert set(im.getchannel('A').getdata())<={0,255},a['id']
  assert {rgb[:3] for rgb in im.getdata() if rgb[3]}<=palettes[a['originalSourceId']],a['id']
  if a.get('internalBossPart'):
   p={**a['sourceTransform'],'at':{'x':0,'y':0}};expected=transformed_part(p,images);assert im.tobytes()==expected.tobytes()
 for recipe in bosses['recipes']:
  expected,bounds=compose(recipe,images);a=assets[recipe['assetId']];im=Image.open(root/a['path']);assert im.size==expected.size and im.tobytes()==expected.tobytes();assert bounds==recipe['compositionCrop'];assert not im.getchannel('A').crop((0,0,im.width,2)).getbbox()
  # Independent reconstruction uses exactly the part assets/positions the
  # browser's "Edit boss parts" feature receives.
  w=max(p['at']['x']+p['sourceRect']['w'] for p in recipe['sourceParts']);h=max(p['at']['y']+p['sourceRect']['h'] for p in recipe['sourceParts']);flat=Image.new('RGBA',(w,h))
  for p in recipe['sourceParts']:
   src=Image.open(root/assets[p['sourceAssetId']]['path']).convert('RGBA') if p['sourceAssetId'] in assets else images[p['sourceId']][0];r=p['sourceRect'];part=src.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h']))
   if p.get('flipX'):part=ImageOps.mirror(part)
   flat.alpha_composite(part,(p['at']['x'],p['at']['y']))
  b=bounds;trim=flat.crop((b['x'],b['y'],b['x']+b['w'],b['y']+b['h']));out=Image.new('RGBA',(b['w']+4,b['h']+4));out.paste(trim,(2,2));assert out.tobytes()==expected.tobytes()
 ids=set()
 for sheet in bosses['sheets'].values():
  for p in sheet['pieces']:
   assert p['id'] not in ids;ids.add(p['id']);a=assets[p['assetId']];assert (p['sx'],p['sy'],p['sw'],p['sh'])==(0,0,a['width'],a['height'])
 with zipfile.ZipFile(root/'assets/bosses/minish-studio-full-bosses.zip') as archive:assert archive.testzip() is None and len(archive.infolist())==len(assets)+2
 report={'status':'passed','verifiedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),'unchangedSourceSheets':len(catalog['assets']),'bossSourcesCovered':len(images),'rgbaPngsVerified':len(assets),'completePresetsVerified':len(ids),'exactSourceCompositionsVerified':len(ids),'explodedPartReconstructionsVerified':len(ids),'embeddedPngsVerified':len(assets),'originalGameColorPalettesVerified':len(assets),'zipCrcVerified':True,'scope':bosses['scope']};write_json(root/'assets/bosses/verification.json',report);print(json.dumps(report,indent=2));return report

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',nargs='?',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--verify-only',action='store_true');args=p.parse_args();root=args.root.resolve()
 if not args.verify_only:build(root)
 verify(root)
if __name__=='__main__':main()
