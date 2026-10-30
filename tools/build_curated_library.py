#!/usr/bin/env python3
"""Build an audited game-art gallery without sheet presentation material.

Every environment is copied from explicit source rectangles. Reserved outside
presentation colors may become transparent; artwork RGB is never repainted.
The original sheets remain separate archival sources.
"""
from __future__ import annotations
import argparse
import base64
from collections import Counter, deque
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import zipfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/curated'

# Visually reviewed map rectangles: source pixels only, excluding captions,
# loose sprites, logos, palette panels, and inter-panel spacing.
MAPS = {
    '142450': [('armos-room', 'Armos chamber', (0,112,240,160))],
    '6507': [('bakery', 'Bakery interior', (0,0,240,160))],
    '6439': [('barrel-interior', 'Barrel house interior', (215,0,240,330))],
    '31008': [('castor-wilds', 'Castor Wilds map', (0,0,1008,960))],
    '6447': [('dampe', "Dampé's shack", (0,0,240,160))],
    '6563': [
        ('sanctuary-upper','Sanctuary upper chamber',(82,2,304,344)),
        ('sanctuary-hall','Elemental Sanctuary hall',(2,348,464,648)),
        ('sanctuary-crystals','Sanctuary crystal passage',(34,998,400,568)),
        ('sanctuary-garden','Sanctuary garden',(2,1568,272,432)),
        ('sanctuary-dark','Sanctuary dark garden',(276,1568,272,432))],
    '6434': [('ezlo-empty',"Ezlo's house floor",(12,106,240,234)),('ezlo-furnished',"Ezlo's furnished house",(254,106,240,234))],
    '6543': [('fairy-fountain','Fairy fountain',(0,0,240,160))],
    '6446': [('abbey',"Festari's Abbey",(0,26,466,256))],
    '16014': [('gallery-empty','Figurine gallery floor',(338,0,240,160)),('gallery','Figurine gallery',(590,0,240,160)),('gallery-cave','Figurine cave',(840,162,239,160))],
    '34658': [('school-entrance','Funday school entrance',(0,0,240,240)),('school-classroom','Funday school classroom',(245,0,320,176))],
    '31009': [(f'wind-room-{n+1}',f'Wind tribe room {n+1}',(262,y,240,h)) for n,(y,h) in enumerate([(44,168),(228,160),(488,168),(672,160),(928,168),(1112,160),(1356,168),(1540,160)])],
    '6440': [('castle-throne','Hyrule Castle throne room',(112,0,272,320)),('castle-bedroom','Castle bedroom',(384,0,263,192)),('castle-hall','Castle main hall',(16,352,480,512)),('castle-entry','Castle entrance hall',(32,1040,432,413))],
    '6441': [('castle-garden','Hyrule Castle Garden',(0,0,1008,528))],
    '6526': [('town','Hyrule Town',(0,0,1008,960))],
    '142448': [('inner-mazaal-a','Inside Mazaal: pillars',(0,0,272,304)),('inner-mazaal-b','Inside Mazaal: sand',(277,0,272,304))],
    '6550': [('bookshelf','Librari bookshelf',(0,0,336,440)),('librari-room',"Librari's room",(350,232,240,240))],
    '6490': [('ranch','Lon Lon Ranch',(0,0,720,960))],
    '34087': [('cafe',"Mama's Cafe",(0,0,240,192))],
    '6560': [('mine','Melari mine',(0,0,722,610)),('mine-room-a','Mine sleeping chamber',(724,200,354,160)),('mine-room-b','Mine workshop',(50,612,240,160)),('mine-room-c','Mine dining chamber',(434,612,240,160))],
    '6450': [('elder',"Minish Elder's house",(0,48,240,160))],
    '37861': [('minish-path','Minish forest path',(0,0,240,880)),('minish-tree-a','Forest parallax layer',(260,0,240,880)),('minish-tree-b','Forest parallax layer 2',(520,0,240,960))],
    '6548': [('minish-ice','Mountain Minish house',(0,0,240,240)),('minish-cave','Mountain Minish cave',(0,242,240,160)),('minish-home-a','Minish house: yellow',(240,33,176,160)),('minish-home-b','Minish house: green',(416,33,176,160)),('minish-home-c','Minish house: orange',(240,195,176,160)),('minish-home-d','Minish house: purple',(416,195,176,160))],
    '6431': [(f'portal-{n+1}',f'Minish portal background {n+1}',(x,y,240,320)) for n,(x,y) in enumerate([(0,0),(254,0),(507,0),(775,0),(0,329),(254,329),(507,329),(775,329)])],
    '6540': [('village','Minish Village',(0,0,1008,984))],
    '142449': [('village-lake','Minish Village lake',(0,0,480,416))],
    '6554': [('woods','Minish Woods',(50,0,1008,1008)),('shrine-entry','Deepwood Shrine entrance',(493,1020,240,200))],
    '6553': [('crenel-path','Mount Crenel Minish path',(46,42,244,826)),('crenel-ledge-a','Crenel ledge',(301,42,244,124)),('crenel-ledge-b','Crenel ledge 2',(550,42,244,123)),('crenel-ledge-c','Crenel ledge 3',(301,170,244,127))],
    '6555': [('post-office','Post office',(184,11,240,160))],
    '6521': [('shoe-table',"Rem's work table",(0,0,320,240))],
    '34627': [('shoe-shop',"Rem's shoe shop",(0,0,240,160))],
    '6518': [('crypt-a','Royal Crypt chamber 1',(15,0,560,304)),('crypt-b','Royal Crypt chamber 2',(159,304,272,224)),('crypt-c','Royal Crypt passage',(139,528,312,320)),('crypt-d','Royal Crypt puzzle chamber',(0,848,592,384)),('crypt-e','Royal Crypt chamber 3',(160,1232,272,320)),('crypt-f','Royal Crypt chamber 4',(160,1552,272,192))],
    '6479': [('library-a','Royal Library',(0,0,224,176)),('library-b','Royal Library reading room',(0,198,352,256))],
    '6519': [('valley','Royal Valley',(2,2,480,1008)),('valley-cave-a','Valley cave entrance',(492,2,240,160)),('valley-cave-b','Valley fairy room',(492,168,240,160)),('valley-cave-c','Valley cave passage',(492,336,240,320))],
    '34626': [('simon',"Simon's Simulations",(0,0,240,160))],
    '6483': [('south-field','South Hyrule Field',(0,0,1008,688))],
    '6470': [('stockwell',"Stockwell's Shop",(0,0,240,184))],
    '6488': [('ranch-house-a',"Talon and Malon's house",(0,0,240,160)),('ranch-house-b','Ranch barn',(240,0,240,160))],
    '142447': [('wrath-hand-a',"Inside Vaati's first hand",(0,0,304,224)),('wrath-hand-b',"Inside Vaati's second hand",(308,0,304,224))],
    '6566': [('wind-shrine','Wind Shrine',(0,0,320,416))],
    '86016': [('witch',"Witch's hut",(0,0,240,160))],
    '6430': [('crenel-sky','Mount Crenel backdrop',(20,48,256,256)),('cloud-tops','Cloud Tops backdrop',(297,49,256,256)),('veil-falls','Veil Falls backdrop',(19,328,256,256)),('palace-sky','Palace of Winds backdrop',(297,329,256,256)),('forest-title','Forest title backdrop',(578,49,240,160)),('file-background','File select backdrop',(578,231,240,160)),('beanstalk','Beanstalk vista',(577,414,240,168))],
}

# Real scene-object or inventory-icon areas. Sheet headings, diagrams, labels,
# custom palette demonstrations and source credits are deliberately outside.
OBJECT_AREAS = {
    '604585': [(0,0,63,17)],
    '37862': [(0,0,423,48)],
    '6514': [(35,0,199,102)],
    '6435': [(0,0,674,1008),(0,1008,438,64),(0,1080,674,198)],
    '6452': [(0,0,71,49)],
    '6437': [(0,192,113,61),(0,254,190,20),(318,192,214,62),(318,254,110,20),(235,374,64,51)],
    '6561': [(20,202,203,112),(360,222,84,54)],
    '6562': [(45,0,73,96),(123,0,117,96),(0,98,230,135),(2,239,43,166),(68,382,125,28),(205,379,37,31)],
    '180815': [(0,0,228,132)],
    '6541': [(0,0,298,49)],
}
HIDDEN = {'6436','6451','37189','6492','6496','241527','6565','6455','6558','6559','6502','6528','142451','6542'}

# These exact cut IDs were visually reviewed on caption-candidates contact
# sheets. Actual long sword, wing, shadow and beam graphics were retained.
CAPTION_REVIEW_INDICES = (list(range(3,27)) + list(range(29,36)) + list(range(40,68))
    + [73,74,75,76,77,78,79,80,81,82,83,86,87,88,89,90,93]
    + list(range(104,111)) + [116,118,125,126,134])
SMALL_CAPTION_INDICES = ([78,79,93]+list(range(108,112))+list(range(115,122))+
    [134]+list(range(144,154))+[156,157,158,159,160,161]+list(range(172,191))+
    [208]+list(range(214,244))+list(range(250,255))+list(range(264,270))+[286])

# Annotated source areas include short single-letter components that a
# component-size filter cannot reliably identify. These rectangles were
# checked on the original sheets, keeping actual game effects beside them.
ANNOTATION_AREAS = {
    '6399': [(0,570,445,62),(0,632,240,200)],
    '6381': [(0,2168,300,62)],
    '6396': [(0,20,160,20),(0,77,130,17),(0,122,130,17),(0,173,130,17),(0,222,130,20),(0,273,130,20),(0,325,140,17),(0,376,180,18),(430,499,316,216)],
    '6402': [(242,0,110,15),(0,44,160,20),(196,70,55,16),(168,108,60,16),(0,249,423,51)],
    '6379': [(0,65,54,47),(112,155,56,49),(250,110,145,16),(312,192,83,35)],
    '6394': [(396,0,246,203)],
    '6391': [(98,84,81,28),(329,84,83,28),(80,111,194,14),(50,170,70,14),(300,170,70,14),(0,180,457,45)],
    '6377': [(0,0,260,14),(100,43,40,12),(0,118,369,298)],
    '6530': [(0,0,758,9),(0,77,86,15),(196,77,45,15),(372,44,60,18),(371,112,132,48),(0,159,85,12),(530,136,228,33)],
    '6414': [(0,0,60,26),(0,28,52,11),(200,26,50,12),(0,68,40,14),(0,133,40,12),(63,132,110,15),(0,199,44,22),(0,232,52,12),(200,230,50,12),(0,273,40,14),(0,338,40,12),(63,337,110,15),(0,399,65,22),(0,432,52,12),(200,430,50,12),(0,472,40,14),(0,529,40,12),(63,529,110,15),(0,575,65,12),(0,624,60,22),(0,690,70,12),(0,714,60,23),(0,746,52,12),(200,744,50,12),(0,786,40,14),(168,787,65,12),(0,853,40,12),(63,853,110,15),(0,900,484,35)],
    '64168': [(662,0,160,126),(824,0,237,140),(660,342,240,136)],
    '6459': [(38,26,58,12),(0,112,104,40)],
    '6405': [(0,230,379,55)],
    '6480': [(0,25,187,70)],
    '6498': [(0,121,145,48)],
    '6515': [(0,54,186,75)],
    '6517': [(101,58,36,37),(39,92,57,17),(100,96,47,16),(110,20,38,23),(89,207,42,17),(0,232,152,57)],
    '6556': [(233,182,121,42),(0,388,108,45),(508,397,91,30)],
    '6557': [(0,112,311,25)],
    '6472': [(0,248,288,136)],
    '6475': [(0,28,154,45)],
    '6409': [(0,280,389,60)],
    '6524': [(0,612,331,69)],
    '6535': [(0,441,975,274),(889,66,86,80)],
}


def load_json(path): return json.loads(path.read_text(encoding='utf-8'))
def write_json(path,data): path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def png_data(image):
    output=io.BytesIO(); image.save(output,format='PNG',optimize=True)
    return 'data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
def rect_dict(rect): return dict(zip(('x','y','w','h'),rect))
def inside(piece,rect):
    x,y,w,h=rect
    return piece['sx']>=x and piece['sy']>=y and piece['sx']+piece['sw']<=x+w and piece['sy']+piece['sh']<=y+h
def intersects(piece,rect):
    x,y,w,h=rect
    return piece['sx']<x+w and piece['sy']<y+h and piece['sx']+piece['sw']>x and piece['sy']+piece['sh']>y


def outside_transparent(image,colors):
    """Remove only the reviewed edge-connected presentation background."""
    if not colors:return image,0
    out=image.copy();px=out.load();w,h=out.size;keys=set(tuple(c) for c in colors)
    todo=deque();seen=set()
    def offer(x,y):
        if 0<=x<w and 0<=y<h and (x,y) not in seen and px[x,y][:3] in keys:
            seen.add((x,y));todo.append((x,y))
    for x in range(w):offer(x,0);offer(x,h-1)
    for y in range(h):offer(0,y);offer(w-1,y)
    while todo:
        x,y=todo.popleft();r,g,b,a=px[x,y];px[x,y]=(r,g,b,0)
        for nx,ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:offer(nx,ny)
    return out,len(seen)


def tile_masks(image):
    alpha=image.getchannel('A');result={}
    for size in (8,16,32):
        columns=math.ceil(image.width/size);indices=[]
        for row in range(math.ceil(image.height/size)):
            for col in range(columns):
                if alpha.crop((col*size,row*size,min(image.width,(col+1)*size),min(image.height,(row+1)*size))).getbbox():indices.append(row*columns+col)
        result[str(size)]=indices
    return result


def build():
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'environments').mkdir(exist_ok=True)
    cat=load_json(ROOT/'assets/catalog.json');base=load_json(ROOT/'assets/pieces.json');sprite=load_json(ROOT/'assets/sprites.json')
    sources={a['id']:a for a in cat['assets']};assets={a['id']:a for a in cat['assets']+base['assets']+sprite['assets']}
    exclusions=set(sprite.get('excludedPieceIds',[]));reasons=dict(sprite.get('excludedPieceReasons',{}))
    candidates=load_json(OUT/'review/caption-candidates.json')
    for index in CAPTION_REVIEW_INDICES:
        p=candidates[index];exclusions.add(p['id']);reasons[p['id']]='Reviewed community text, source caption or presentation label'
    small=load_json(OUT/'review/small-captions.json')
    for index in SMALL_CAPTION_INDICES:
        p=small[index];exclusions.add(p['id']);reasons[p['id']]='Reviewed short source caption, text fragment or placeholder marker'
    result={'version':1,'generatedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),'assets':[],'catalog':[],'sheets':{},'environments':[],'scenes':[],'excludedPieceIds':[],'excludedPieceReasons':{},'hiddenSourceIds':sorted(HIDDEN),'notes':[
        'Normal scene galleries contain audited game-art regions, separate from archived full source sheets.',
        'Environment pixels are exact source crops. Only reviewed outside presentation colors and annotation-only rectangles may have their alpha cleared.',
        'Source captures are not a verified extraction of every ROM tile or every game pose.',
        'Unused examples, custom palette demonstrations, source headings, contributor graphics, and credit blocks are excluded from the normal gallery.',
        'Grid cuts are regular image selections, not a claim about the game\'s internal tile IDs.'],
        'gameplayCrossChecks':[{'sourceId':'6483','sourceRect':{'x':544,'y':304,'w':240,'h':192},
            'referenceUrl':'https://thekingofgrabs.com/2019/07/28/the-legend-of-zelda-the-minish-cap-game-boy-advance/#jp-carousel-73244',
            'referenceKind':'Original captured-gameplay gallery, image 005',
            'checkedFeatures':['Smith house thatch and green doorway','logs and stump at the left','stairs below the house','fence and crops to the right','native character scale'],
            'scope':'Visual cross-check of this exterior area, not a ROM comparison or verification of every map.'}]}
    # Copy all pose sheets with exact exclusions, then replace maps and object
    # sheets with their explicitly audited regions below.
    for sid,sheet in base['sheets'].items():
        pieces=[dict(p) for p in sheet.get('pieces',[]) if p['id'] not in exclusions]
        if sid in HIDDEN:pieces=[]
        elif sheet['category']=='objects' or sheet['category']=='interface':
            allowed=OBJECT_AREAS.get(sid,[])
            pieces=[p for p in pieces if any(inside(p,rect) for rect in allowed)]
        pieces=[p for p in pieces if not any(intersects(p,rect) for rect in ANNOTATION_AREAS.get(sid,[]))]
        if sid=='6375':pieces=[p for p in pieces if inside(p,(296,64,248,44))]
        if sid=='6530':pieces=[p for p in pieces if p['id']!='piece-6530-460-78-265-34']
        # This mixed rip explicitly contains edits and alternate tree colors.
        # Retain the normal green tree, shrub and recognizable game props;
        # orange tree recolors and comparison patches stay in the archive.
        if sid=='6562':
            pieces=[p for p in pieces if p['id'] not in {'piece-6562-5-99-68-61','piece-6562-78-163-73-70','piece-6562-6-177-68-56'}]
        for p in sheet.get('pieces',[]):
            if p['id'] not in {q['id'] for q in pieces}:
                exclusions.add(p['id']);reasons.setdefault(p['id'],'Outside the audited gameplay artwork areas; archive source remains available')
        result['sheets'][sid]={**{k:v for k,v in sheet.items() if k!='pieces'},'pieces':pieces,'curated':True}
    images={};verification=[]
    def add_region(sid,key,name,rect,source_key=None):
        source=sources[sid];x,y,w,h=rect
        original=Image.open(ROOT/source['path']).convert('RGBA')
        assert 0<=x and 0<=y and x+w<=original.width and y+h<=original.height,(sid,rect)
        image=original.crop((x,y,x+w,y+h));keys=[];annotation=[]
        if sid in {'6548','142448'}:keys=[(255,0,255)]
        if sid=='6540':
            keys=[original.getpixel((300,0))[:3]]
            annotation=[(0,696,172,288)]
        if sid=='6446':annotation=[(190,26,96,8)]
        if sid=='37861' and key in {'minish-tree-a','minish-tree-b'}:keys=[(0,135,101)]
        if sid in {'6446','6450','6479','6440'}:keys=[(255,255,255)]
        image,removed=outside_transparent(image,keys)
        for ax,ay,aw,ah in annotation:
            l,t=max(0,ax-x),max(0,ay-y);rr,bb=min(w,ax+aw-x),min(h,ay+ah-y)
            if rr>l and bb>t:
                alpha=image.getchannel('A');ImageDraw.Draw(alpha).rectangle((l,t,rr-1,bb-1),fill=0);image.putalpha(alpha)
        aid='env-'+sid+'-'+key;path=OUT/'environments'/f'{aid}.png';image.save(path,optimize=True)
        thumb=image.copy();thumb.thumbnail((160,112),Image.Resampling.NEAREST)
        record={'id':aid,'name':name,'sourceId':sid,'originalSourceId':sid,'section':'Maps','path':path.relative_to(ROOT).as_posix(),'width':w,'height':h,'dataUrl':png_data(image),'sha256':digest(path),'sourceUrl':source['sourceUrl'],'contributors':source['contributors'],'sourceRect':rect_dict(rect),'derivation':'exact-source-rectangle-with-reviewed-exterior-alpha','presentationColors':[list(c) for c in keys],'annotationOnlyRects':[rect_dict(a) for a in annotation]}
        piece={'id':aid,'name':name,'assetId':aid,'sourceId':source_key or sid,'originalSourceId':sid,'sx':0,'sy':0,'sw':w,'sh':h,'sourceRect':rect_dict(rect),'kind':'environment','group':'Clean game regions','tileMasks':tile_masks(image),'thumbnailDataUrl':png_data(thumb),'representation':'gameplay-region'}
        result['assets'].append(record);result['environments'].append(piece);images[aid]=image
        verification.append({'assetId':aid,'sourceId':sid,'sourceRect':rect_dict(rect),'exteriorAlphaCleared':removed,'annotationOnlyRects':record['annotationOnlyRects']})
        return piece
    for sid,regions in MAPS.items():
        pieces=[add_region(sid,key,name,rect) for key,name,rect in regions]
        for p in base['sheets'].get(sid,{}).get('pieces',[]):
            exclusions.add(p['id']);reasons[p['id']]='Replaced by audited game-region crops without sheet annotations'
        result['sheets'][sid]={'category':'environments','pieces':pieces,'coverPieceId':pieces[0]['id'],'thumbnailDataUrl':pieces[0]['thumbnailDataUrl'],'curated':True}
    # A real full boss arena occurs on the Wrath sprite sheet. It is not one
    # of the inside-hand chambers on the separate Vaati's Arms source.
    arena_sid='curated-environment-6535'
    arena=add_region('6535','arena',"Vaati's Wrath arena floor",(312,483,240,160),arena_sid)
    s=sources['6535'];result['catalog'].append({'id':arena_sid,'name':"Vaati's Wrath Arena Floor",'section':'Maps','category':'environments','sourceId':'6535','originalSourceId':'6535','sourceUrl':s['sourceUrl'],'contributors':s['contributors'],'width':240,'height':160,'path':result['assets'][-1]['path'],'thumbnailDataUrl':arena['thumbnailDataUrl']})
    result['sheets'][arena_sid]={'category':'environments','pieces':[arena],'curated':True,'coverPieceId':arena['id'],'thumbnailDataUrl':arena['thumbnailDataUrl']}
    smith_sid='curated-environment-6377';s=sources['6377']
    smith_regions=[add_region('6377','home-empty',"Link and Smith's home",(8,120,240,160),smith_sid),add_region('6377','home-forge',"Smith's forge",(8,288,240,128),smith_sid)]
    result['catalog'].append({'id':smith_sid,'name':"Link and Smith's Home",'section':'Maps','category':'environments','sourceId':'6377','originalSourceId':'6377','sourceUrl':s['sourceUrl'],'contributors':s['contributors'],'width':240,'height':160,'path':next(a['path'] for a in result['assets'] if a['id']==smith_regions[0]['assetId']),'thumbnailDataUrl':smith_regions[0]['thumbnailDataUrl']})
    result['sheets'][smith_sid]={'category':'environments','pieces':smith_regions,'curated':True,'coverPieceId':smith_regions[0]['id'],'thumbnailDataUrl':smith_regions[0]['thumbnailDataUrl']}
    # Recover intact tiles separated by a 1 px source grid. The final two
    # rows have a misplaced horizontal divider and are intentionally omitted.
    original=Image.open(ROOT/sources['6465']['path']).convert('RGBA');atlas=Image.new('RGBA',(240,384));tiles=[];parts=[]
    for block,(bx,by) in enumerate([(0,0),(0,171),(256,171)]):
        for row in range(8):
            for col in range(15):
                sx,sy=bx+1+col*17,by+1+row*17;dx,dy=col*16,(block*8+row)*16
                crop=original.crop((sx,sy,sx+16,sy+16));atlas.paste(crop,(dx,dy))
                part={'sourceRect':{'x':sx,'y':sy,'w':16,'h':16},'at':{'x':dx,'y':dy}};parts.append(part)
                tiles.append({'id':f'env-6465-tile-{block}-{row}-{col}','name':f"Link's House tile {block+1}.{row+1}.{col+1}",'assetId':'env-6465-tiles','sourceId':'6465','sx':dx,'sy':dy,'sw':16,'sh':16,'sourceRect':part['sourceRect'],'kind':'tile','group':f'Room {block+1} tiles','representation':'intact-16px-source-cell'})
    path=OUT/'environments/env-6465-tiles.png';atlas.save(path,optimize=True);thumb=atlas.copy();thumb.thumbnail((100,160),Image.Resampling.NEAREST)
    result['assets'].append({'id':'env-6465-tiles','name':"Link's House intact tile atlas",'sourceId':'6465','path':path.relative_to(ROOT).as_posix(),'width':240,'height':384,'dataUrl':png_data(atlas),'sha256':digest(path),'sourceParts':parts,'derivation':'intact-16px-cells-with-inserted-community-grid-removed'})
    result['sheets']['6465']={'category':'environments','pieces':tiles,'curated':True,'coverPieceId':tiles[80]['id'],'thumbnailDataUrl':png_data(thumb),'notes':'Only intact 16 px cells are included. Two source rows with a displaced divider remain archive-only.'}
    for p in base['sheets']['6465']['pieces']:exclusions.add(p['id']);reasons[p['id']]='Presentation-grid sheet replaced with intact 16 px source cells'
    # Mushroom caps are intact 16 px source cells inside blue presentation
    # dividers. Whole 'Alt Palette' examples are not original game frames.
    mush=Image.open(ROOT/sources['6499']['path']).convert('RGBA');mushpieces=[]
    mushroom_rects=[(x,2,16,16) for x in (53,70,87,104)]+[(11,y,16,16) for y in (45,62,79,96)]+[(147,y,16,16) for y in (45,62,79,96)]+[(x,141,16,16) for x in (53,70,87,104)]
    for old in OUT.glob('curated-mushroom-*.png'):old.unlink()
    for n,rect in enumerate(mushroom_rects,1):
        x,y,w,h=rect;aid=f'curated-mushroom-{n}';im=mush.crop((x,y,x+w,y+h));im,_=outside_transparent(im,[(255,255,255)])
        path=OUT/f'{aid}.png';im.save(path,optimize=True)
        result['assets'].append({'id':aid,'name':f'Mushroom frame {n}','sourceId':'6499','path':path.relative_to(ROOT).as_posix(),'width':w,'height':h,'dataUrl':png_data(im),'sha256':digest(path),'sourceRect':rect_dict(rect)})
        mushpieces.append({'id':aid,'name':f'Mushroom cap: original palette {n}','sourceId':'6499','assetId':aid,'sx':0,'sy':0,'sw':w,'sh':h,'sourceRect':rect_dict(rect),'kind':'object','group':'Intact original cap cells'})
    result['sheets']['6499']={'category':'objects','pieces':mushpieces,'curated':True}
    for p in base['sheets']['6499']['pieces']:exclusions.add(p['id']);reasons[p['id']]='Mixed alternate-palette panel replaced by isolated original red-cap frames'
    # A source border joined eight Sorcerer Vaati poses into one component.
    # Split only at fully transparent columns after reviewed border cleanup.
    vaati_asset=sprite.get('assetOverrides',{}).get('clean-6530','clean-6530')
    vaati_image=Image.open(ROOT/assets[vaati_asset]['path']).convert('RGBA')
    alpha=vaati_image.getchannel('A');runs=[];start=None
    for x in range(450,758):
        used=bool(alpha.crop((x,78,x+1,112)).getbbox())
        if used and start is None:start=x
        if not used and start is not None:runs.append((start,x-start));start=None
    if start is not None:runs.append((start,758-start))
    assert len(runs)==8,runs
    for n,(x,w) in enumerate(runs):
        y,h=78,34
        cell=vaati_image.crop((x,y,x+w,y+h));bbox=cell.getchannel('A').getbbox()
        if not bbox:continue
        l,t,rr,bb=bbox;sx,sy=x+l,y+t;pw,ph=rr-l,bb-t
        result['sheets']['6530']['pieces'].append({'id':f'curated-6530-pose-{n+1}','name':f'Vaati action frame {n+1}','sourceId':'6530','assetId':vaati_asset,'sx':sx,'sy':sy,'sw':pw,'sh':ph,'sourceRect':{'x':sx,'y':sy,'w':pw,'h':ph},'kind':'pose','group':'Action frames','rowIndex':4})
    cat_asset=sprite.get('assetOverrides',{}).get('clean-6402','clean-6402')
    result['sheets']['6402']['pieces'].append({'id':'curated-6402-meow-front','name':'Cat meowing: front','sourceId':'6402','assetId':cat_asset,'sx':90,'sy':44,'sw':21,'sh':19,'sourceRect':{'x':90,'y':44,'w':21,'h':19},'kind':'pose','group':'Meowing'})
    # Clone pads are genuine square floor graphics, not body poses. Give
    # them their own Objects entry while keeping the exact source pixels.
    pad_sid='curated-objects-6461';source=sources['6461']
    pads=[p for p in result['sheets']['6461']['pieces'] if p['sy']==181 and p['sx'] in range(326,531,17) and p['sw']==p['sh']==16]
    assert len(pads)==13
    pad_ids={p['id'] for p in pads}
    result['sheets']['6461']['pieces']=[p for p in result['sheets']['6461']['pieces'] if p['id'] not in pad_ids]
    pads=[{**p,'sourceId':pad_sid,'originalSourceId':'6461','name':f'Gyorg clone pad: frame {n+1}','kind':'object','group':'Arena tiles'} for n,p in enumerate(pads)]
    pad_asset=sprite.get('assetOverrides',{}).get(pads[0]['assetId'],pads[0]['assetId'])
    pad_image=Image.open(ROOT/assets[pad_asset]['path']).convert('RGBA')
    thumb=pad_image.crop((326,181,342,197)).resize((64,64),Image.Resampling.NEAREST)
    result['catalog'].append({'id':pad_sid,'name':'Gyorg Arena Clone Pads','section':'Miscellaneous','category':'objects','sourceId':'6461','originalSourceId':'6461','sourceUrl':source['sourceUrl'],'contributors':source['contributors'],'width':pad_image.width,'height':pad_image.height,'path':assets[pad_asset]['path'],'thumbnailDataUrl':png_data(thumb)})
    result['sheets'][pad_sid]={'category':'objects','pieces':pads,'curated':True,'coverPieceId':pads[0]['id'],'thumbnailDataUrl':png_data(thumb)}
    # Scene templates use deliberately reviewed walkable foot-placement zones.
    # The normal Link pose is used in the zoomed Minish Village camera, as in
    # gameplay; the tiny overworld dot is not used for that enlarged world.
    def pool(sid,count=4):
        return [p['id'] for p in result['sheets'][sid]['pieces'] if 10<=p['sw']<=32 and 12<=p['sh']<=36 and p.get('kind') not in ('region','tile')][:count]
    hero=pool('6369',3);villagers=pool('6379',4)+pool('6377',2)+pool('6402',2)+pool('6400',2)+pool('6384',2)+pool('22716',2)
    forest_minish=next((a['id'] for a in cat['assets'] if a['name']=='Forest Minish'),None)
    guards=pool('6391',4);minish=pool(forest_minish,6) if forest_minish else []
    props=['piece-6514-69-21-32-31']
    # Small enemy choices are drawn from the genuine source galleries.
    enemies=[]
    for name in ('Octorok','Rope','Keese'):
        sid=next((a['id'] for a in cat['assets'] if a['name']==name),None)
        if sid:enemies+=pool(sid,3)
    def template(key,name,theme,aid,rect,zones,actors=(),items=(),foes=(),bosses=(),anchors=(),width=240,height=160,**more):
        x,y,w,h=rect
        return {'id':key,'name':name,'theme':theme,'width':width,'height':height,'scale':1,'background':{'assetId':aid,'sx':x,'sy':y,'sw':w,'sh':h},'zones':zones,'anchors':list(anchors),'hero':hero,'actors':list(actors),'props':list(items),'enemies':list(foes),'bossSourceIds':list(bosses),'notes':'Foot placement uses visually reviewed walkable ground. Background is an unchanged source-map camera region.',**more}
    result['scenes']=[
        template('town-arch','Hyrule Town: north square','town','env-6526-town',(384,304,240,160),[{'x':91,'y':105,'w':55,'h':42,'role':'actors'}],villagers,[],anchors=[{'x':120,'y':141,'role':'hero'}]),
        template('town-street','Hyrule Town: south street','town','env-6526-town',(384,704,240,160),[{'x':78,'y':78,'w':90,'h':30,'role':'actors'}],villagers,[],anchors=[{'x':120,'y':108,'role':'hero'}]),
        template('woods-clearing','Minish Woods: forest clearing','woods','env-6554-woods',(206,352,240,160),[{'x':151,'y':109,'w':43,'h':38,'role':'actors'},{'x':151,'y':109,'w':43,'h':38,'role':'enemies'},{'x':169,'y':125,'w':32,'h':18,'role':'props'}],[],props,enemies,anchors=[{'x':157,'y':149,'role':'hero'},{'x':185,'y':134,'role':'props'}]),
        template('minish-village','Minish Village: elder path','minish','env-6540-village',(72,160,240,160),[{'x':40,'y':90,'w':160,'h':28,'role':'actors'},{'x':20,'y':107,'w':20,'h':15,'role':'props'}],minish,[],anchors=[{'x':120,'y':118,'role':'hero'}]),
        template('castle-garden','Hyrule Castle: forecourt','town','env-6441-castle-garden',(384,112,240,160),[{'x':75,'y':70,'w':95,'h':43,'role':'actors'}],guards,[],anchors=[{'x':120,'y':111,'role':'hero'}]),
        template('wrath-arena',"Dark Hyrule Castle: Vaati encounter",'boss','env-6535-arena',(0,0,240,160),[{'x':40,'y':139,'w':158,'h':14,'role':'actors'}],[],[],[],['full-boss-6534','full-boss-31116','full-boss-6535'],anchors=[{'x':120,'y':150,'role':'hero'}],bossArea={'x':18,'y':0,'w':204,'h':118},notes="Creative castle encounter using a genuine Wrath arena-floor viewport. Source presentation matte outside the inner floor is excluded. Other Vaati forms are optional new scene arrangements, not a reconstruction of their canonical fight room. Oversized poses remain available for manual placement on larger canvases."),
    ]
    result['excludedPieceIds']=sorted(exclusions);result['excludedPieceReasons']={k:reasons[k] for k in sorted(reasons)}
    result['annotationExclusionAreas']={sid:[rect_dict(rect) for rect in rects] for sid,rects in ANNOTATION_AREAS.items()}
    result['downloadPath']='assets/curated/minish-studio-game-sprites.zip'
    result['stats']={'sourceSheets':len(sources),'curatedEnvironmentSources':len(MAPS)+3,'cleanEnvironmentRegions':len(result['environments']),'intactHouseTiles':len(tiles),'curatedPieces':sum(len(s['pieces']) for s in result['sheets'].values()),'excludedIndexedCuts':len(exclusions),'hiddenUiReferenceSources':len(HIDDEN),'randomTemplates':len(result['scenes']),'byCategory':dict(Counter({c:sum(len(s['pieces']) for s in result['sheets'].values() if s['category']==c) for c in ['environments','characters','enemies','bosses','objects']}))}
    write_json(ROOT/'assets/curated.json',result)
    (ROOT/'assets/curated.js').write_text('window.MINISH_CURATED='+json.dumps(result,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    write_json(OUT/'environment-provenance.json',verification)
    export_foreground(result,assets,sprite)
    return result


def export_foreground(data,source_assets,sprite):
    directory=OUT/'sprites';directory.mkdir(exist_ok=True);cached={};records=[]
    own_assets={a['id']:a for a in data['assets']};all_assets={**source_assets,**own_assets};credits={a['id']:a for a in load_json(ROOT/'assets/catalog.json')['assets']}
    target_ids=set()
    for sid,sheet in data['sheets'].items():
        if sheet['category'] not in ('characters','enemies','bosses','objects'):continue
        for p in sheet['pieces']:
            aid=sprite.get('assetOverrides',{}).get(p['assetId'],p['assetId'])
            if aid not in cached:cached[aid]=Image.open(ROOT/all_assets[aid]['path']).convert('RGBA')
            crop=cached[aid].crop((p['sx'],p['sy'],p['sx']+p['sw'],p['sy']+p['sh']))
            im=Image.new('RGBA',(crop.width+4,crop.height+4));im.paste(crop,(2,2))
            path=directory/f'{p["id"]}.png';im.save(path,optimize=True);target_ids.add(path.name)
            sid=p.get('originalSourceId',p['sourceId']);credit=credits[sid]
            contributor='Moosh (sprite rip); P-Tux7 (source contributor)' if sid=='535841' else credit['contributors']
            records.append({'id':p['id'],'name':p['name'],'sourceId':sid,'sourceRect':p.get('sourceRect'),'sourceUrl':credit['sourceUrl'],'contributors':contributor,'assetId':aid,'path':path.relative_to(ROOT).as_posix(),'width':im.width,'height':im.height,'padding':2,'sha256':digest(path)})
    for path in directory.glob('*.png'):
        if path.name not in target_ids:path.unlink()
    manifest={'version':1,'sourceCollection':'https://www.spriters-resource.com/game_boy_advance/thelegendofzeldatheminishcap/','count':len(records),'scope':'Curated foreground game-art cuts. Source headings, credits, palette demonstrations, reference examples and presentation grids are excluded. Original source sheets remain in the separate archive.','pieces':records}
    write_json(OUT/'sprite-manifest.json',manifest)
    with zipfile.ZipFile(OUT/'minish-studio-game-sprites.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        archive.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        used=sorted({p['sourceId'] for p in records});lines=['Game artwork: Nintendo / Capcom. Original editor: SerakSan.','These game graphics are excluded from the software MIT license.','Source: The Spriters Resource. Individual sheet sources and contributors:','']
        for sid in used:
            a=credits[sid];contributor='Moosh (sprite rip); P-Tux7 (source contributor)' if sid=='535841' else a['contributors'];lines.append(f"{a['name']} | {contributor} | {a['sourceUrl']}")
        archive.writestr('CREDITS.txt','\n'.join(lines)+'\n')
        for p in records:archive.write(ROOT/p['path'],'sprites/'+Path(p['path']).name)
    data['stats']['foregroundPngs']=len(records)
    # Export count is intentionally part of both the embedded and JSON catalog.
    write_json(ROOT/'assets/curated.json',data)
    (ROOT/'assets/curated.js').write_text('window.MINISH_CURATED='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')


def verify(data):
    catalog=load_json(ROOT/'assets/catalog.json');sources={a['id']:a for a in catalog['assets']};by={a['id']:a for a in data['assets']}
    base=load_json(ROOT/'assets/pieces.json');sprite=load_json(ROOT/'assets/sprites.json')
    all_assets={a['id']:a for a in catalog['assets']+base['assets']+sprite['assets']+data['assets']}
    pieces={p['id']:p for sheet in data['sheets'].values() for p in sheet['pieces']}
    for source in catalog['assets']:
        assert digest(ROOT/source['originalPath'])==source['originalSha256'],source['id']
    verified_regions=0;verified_tiles=0
    for asset in data['assets']:
        image=Image.open(ROOT/asset['path']).convert('RGBA');assert digest(ROOT/asset['path'])==asset['sha256'];assert (image.width,image.height)==(asset['width'],asset['height'])
        assert base64.b64decode(asset['dataUrl'].split(',',1)[1])==(ROOT/asset['path']).read_bytes()
        source=Image.open(ROOT/sources[asset['sourceId']]['path']).convert('RGBA')
        if asset.get('sourceParts'):
            for part in asset['sourceParts']:
                r=part['sourceRect'];x,y=part['at']['x'],part['at']['y']
                assert image.crop((x,y,x+r['w'],y+r['h'])).tobytes()==source.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h'])).tobytes();verified_tiles+=1
        else:
            rect=asset['sourceRect'];crop=source.crop((rect['x'],rect['y'],rect['x']+rect['w'],rect['y']+rect['h']))
            assert image.convert('RGB').tobytes()==crop.convert('RGB').tobytes(),asset['id']
            assert all(a<=b for a,b in zip(image.getchannel('A').getdata(),crop.getchannel('A').getdata())),asset['id']
            verified_regions+=1
    for sid,sheet in data['sheets'].items():
        for piece in sheet['pieces']:
            assert piece['id'] not in data['excludedPieceIds'],piece['id']
            if piece['assetId'] in by:
                a=by[piece['assetId']];assert 0<=piece['sx']<a['width'] and 0<=piece['sy']<a['height'];assert piece['sx']+piece['sw']<=a['width'] and piece['sy']+piece['sh']<=a['height']
    for scene in data['scenes']:
        bg=scene['background'];a=by[bg['assetId']];assert bg['sx']+bg['sw']<=a['width'] and bg['sy']+bg['sh']<=a['height']
        for role in ('hero','actors','props','enemies'):
            assert all(pid in pieces for pid in scene[role]),(scene['id'],role)
    foreground=load_json(OUT/'sprite-manifest.json');cache={}
    assert foreground['count']==len(foreground['pieces'])==data['stats']['foregroundPngs']
    for record in foreground['pieces']:
        p=pieces[record['id']];aid=sprite.get('assetOverrides',{}).get(p['assetId'],p['assetId'])
        if aid not in cache:cache[aid]=Image.open(ROOT/all_assets[aid]['path']).convert('RGBA')
        original_crop=cache[aid].crop((p['sx'],p['sy'],p['sx']+p['sw'],p['sy']+p['sh']))
        path=ROOT/record['path'];image=Image.open(path).convert('RGBA');pad=record['padding']
        assert digest(path)==record['sha256'],p['id']
        assert image.size==(p['sw']+2*pad,p['sh']+2*pad)==(record['width'],record['height']),p['id']
        assert image.crop((pad,pad,pad+p['sw'],pad+p['sh'])).tobytes()==original_crop.tobytes(),p['id']
        for border in [(0,0,image.width,pad),(0,image.height-pad,image.width,image.height),(0,0,pad,image.height),(image.width-pad,0,image.width,image.height)]:
            assert not image.getchannel('A').crop(border).getbbox(),p['id']
    with zipfile.ZipFile(OUT/'minish-studio-game-sprites.zip') as archive:
        assert archive.testzip() is None
        assert len(archive.namelist())==len(foreground['pieces'])+2
        assert json.loads(archive.read('manifest.json'))==foreground
        for record in foreground['pieces']:
            assert hashlib.sha256(archive.read('sprites/'+Path(record['path']).name)).hexdigest()==record['sha256'],record['id']
    report={'status':'passed','verifiedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),'originalSourceChecksumsVerified':len(catalog['assets']),'sourceRgbRegionsVerified':verified_regions,'intactSource16pxTilesVerified':verified_tiles,'cleanEnvironmentRegions':len(data['environments']),'reviewedExclusions':len(data['excludedPieceIds']),'randomSceneCameraBoundsVerified':len(data['scenes']),'foregroundPngCropsAndTransparentPaddingVerified':len(foreground['pieces']),'foregroundZipChecksumsVerified':len(foreground['pieces']),'gameplayVisualCrossChecks':len(data['gameplayCrossChecks']),'scope':'Exact source-RGB preservation, reviewed presentation-alpha edits, map bounds, regular tile mappings and PNG/ZIP source-crop equality verified. This is not a ROM-level authenticity or complete-pose inventory claim.'}
    write_json(OUT/'verification.json',report);print(json.dumps(report,indent=2))


def contacts(data):
    regions=data['environments']
    for start in range(0,len(regions),12):
        page=Image.new('RGB',(1200,960),'#213848');draw=ImageDraw.Draw(page)
        for n,p in enumerate(regions[start:start+12]):
            im=Image.open(ROOT/next(a['path'] for a in data['assets'] if a['id']==p['assetId'])).convert('RGBA');im.thumbnail((292,276),Image.Resampling.NEAREST)
            x=(n%4)*300;y=(n//4)*320;page.paste(im,(x+(300-im.width)//2,y),im);draw.text((x+4,y+280),p['name'],fill='white');draw.text((x+4,y+297),p['id'],fill='#aed8dc')
        page.save(OUT/f'review/curated-maps-{start//12+1}.png')
    page=Image.new('RGB',(960,480),'#213848');draw=ImageDraw.Draw(page);assets={a['id']:a for a in data['assets']}
    for n,s in enumerate(data['scenes']):
        bg=s['background'];im=Image.open(ROOT/assets[bg['assetId']]['path']).convert('RGBA').crop((bg['sx'],bg['sy'],bg['sx']+bg['sw'],bg['sy']+bg['sh']))
        im.thumbnail((320,208),Image.Resampling.NEAREST);x=(n%3)*320;y=(n//3)*240;page.paste(im,(x,y),im);draw.text((x+3,y+211),s['name'],fill='white')
    page.save(OUT/'review/random-cameras.png')


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--verify-only',action='store_true');args=parser.parse_args()
    data=load_json(ROOT/'assets/curated.json') if args.verify_only else build()
    verify(data)
    if not args.verify_only:contacts(data)


if __name__=='__main__':main()
