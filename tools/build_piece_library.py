#!/usr/bin/env python3
"""Build traceable pose/object cut rectangles from the downloaded source sheets.

Only derivative PNGs are written. A piece always maps to its exact source
rectangle. This is a sheet-art index, not a claim about every frame in the ROM.
Requires Pillow only. Run with the project's Python environment.
"""

from __future__ import annotations

import argparse
import base64
from collections import Counter, deque
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ACTOR_SECTIONS = {"Playable Characters", "Non-Playable Characters", "Enemies", "Bosses"}
OBJECT_IDS = {"604585", "37862", "6514", "6435", "6452", "6437", "6561", "6562", "6499", "180815", "6541", "6528"}
ENVIRONMENT_IDS = {"6430", "6496", "6492", "142451"}

# Exact, visually checked sheet background colors. Zelda's own sheet legend
# explicitly identifies both green colors as transparency. Some opaque sheets
# use two background colors or place frames on blocks of a second key color.
KEY_OVERRIDES = {
    "19728": [(255,255,255),(248,192,240)], "6542": [(255,255,255)],
    "6375": [(171,0,0)], "6391": [(255,255,255)],
    "22716": [(16,128,88),(7,60,41)],
    "6475": [(255,255,255),(64,176,136)],
    "6512": [(255,255,255),(64,176,136)],
    "6564": [(255,255,255)],
    "6460": [(255,255,255),(64,176,136)],
    "6415": [(255,255,255),(0,172,255)],
    "6546": [(47,145,16)],
    "6534": [(0,40,81),(0,23,47)],
    "6535": [(24,149,240),(13,106,171)],
    "6372": [(255,255,255),(64,176,136)],
    "6530": [(0,128,0),(64,176,136)],
    "6411": [(255,255,255),(64,176,136)],
    "6413": [(255,255,255)],
    "6445": [(255,255,255),(16,128,88)],
    "64168": [(184,184,216),(64,176,136)],
    "6459": [(255,255,255),(0,128,0)],
    "6405": [(16,128,88),(64,176,136)],
    "6478": [(255,255,255),(64,176,136)],
    "6504": [(255,0,255)],
    "6509": [(255,255,255),(64,176,136)],
    "6511": [(255,255,255),(64,176,136)],
    "6523": [(255,255,255)],
    "6524": [(255,255,255),(64,176,136)],
    "6452": [(255,255,255),(64,176,136)],
    "6502": [(255,255,255),(160,255,240)],
    "6528": [(255,255,255),(64,176,136)],
    "6377": [(16,128,88),(7,60,41)],
}

# Credit banners and labels are excluded from the default gallery only. They
# remain untouched in original/full-sheet views. Rectangles are x,y,w,h.
EXCLUDED = {
    "6369": [(140,0,146,68)],
    "6370": [(0,0,1112,26)],
    "19728": [(0,379,102,43)],
    "6396": [(480,526,266,190)],
    "6384": [(0,0,120,31),(121,149,229,128)],
    "6403": [(0,131,152,25)], "6400": [(0,98,169,27)],
    "6542": [(0,390,226,73)],
    "24932": [(0,74,263,32)],
    "6372": [(0,303,480,71)],
    "6373": [(0,466,373,52)],
    "6392": [(0,137,429,62)],
    "6379": [(315,187,80,40)],
    "6387": [(288,192,169,129),(384,352,73,129),(0,0,457,32),(1,180,28,10),(1,340,53,11)],
    "6394": [(370,0,272,135)],
    "22716": [(304,0,136,76),(0,786,111,22),(0,0,280,18),(0,153,342,17),(0,268,99,14),(0,344,116,15),(0,473,107,13),(0,610,176,16),(0,689,64,14),(20,313,23,28),(170,313,257,23),(3,463,29,15)],
    "6391": [(0,201,456,23)],
    "6398": [(0,176,306,64)],
    "6377": [(0,118,368,338)],
    "6393": [(0,627,399,64)],
    "6506": [(255,165,137,125)],
    "6460": [(0,0,195,71)], "6415": [(0,0,194,64)],
    "6546": [(329,607,263,43),(372,578,143,24)],
    "535841": [(0,579,576,45),(0,0,576,15),(139,50,95,15),(139,106,95,16),(0,303,259,28),(0,367,225,22),(0,434,225,27),(0,495,130,25),(348,492,176,28)],
    "6534": [(557,285,142,238),(230,197,145,18),(210,276,180,25),(173,347,229,15),(168,435,223,15),(0,430,100,12)],
    "31116": [(0,327,211,105),(900,315,196,117)],
    "6535": [(314,74,128,126),(900,68,53,9)],
    "6461": [(540,284,191,43),(690,270,34,27)],
    "6437": [(372,528,137,45),(0,557,614,59)],
    "6561": [(548,231,139,49)],
    "6562": [(128,336,115,45)],
    "6564": [(120,0,210,145)],
    "6523": [(0,180,101,65)],
    "6413": [(0,124,100,99)],
    "6504": [(161,161,115,61),(0,0,292,18)],
    "6375": [(301,0,156,56)],
    "6389": [(0,1439,364,57)],
}

# A few composition examples are useful pieces, but are deliberately labeled
# as composites so a detached boss limb is never advertised as a full pose.
EXPLICIT = {
    "604585": [(0,0,16,17,"Bread roll"),(16,0,16,17,"Croissant"),(32,0,16,17,"Slice of pie"),(48,0,15,17,"Sandwich")],
    "6535": [(626,442,159,160,"Boss example A"),(734,438,64,67,"Boss example B"),(801,504,63,70,"Boss example C"),(0,442,257,257,"Explosion backdrop"),(257,442,368,266,"Arena backdrop"),(900,78,53,63,"Alternate palette body"),(943,56,32,11,"Horn part")],
    "6461": [(589,238,50,45,"Blue body frame")],
    "6562": [(5,99,68,61,"Orange tree canopy"),(77,99,70,62,"Green tree canopy"),(78,163,73,70,"Orange tree"),(158,163,70,70,"Green tree"),(6,177,68,56,"Tree trunk and opening"),(4,240,39,41,"Small shrub"),(5,290,38,114,"Flower bed"),
             (70,385,18,22,"Spinning effect 1"),(89,383,20,24,"Spinning effect 2"),(110,387,19,20,"Spinning effect 3"),(130,387,19,20,"Spinning effect 4"),(150,387,20,20,"Spinning effect 5"),(171,385,20,22,"Spinning effect 6"),(193,387,9,16,"Tombstone"),(206,381,35,28,"Seat")],
}

# The two Chuchu sheets print captions immediately below animation rows.
# Use their visibly regular background panels as complete body frame bounds,
# so a nearby caption can never become attached to a body by component joins.
for _sid,_dx,_dy in (("6460",0,0),("6415",-3,-5)):
    _cells=[(198+_dx,14+_dy,46,46)]
    for _x,_y,_n in ((57,71,5),(80,130,4),(80,188,4),(33,244,6),(10,290,7)):
        _cells.extend((_x+_dx+i*47,_y+_dy,46,45) for i in range(_n))
    EXPLICIT[_sid]=[(*r,f"Body frame {i:02d}") for i,r in enumerate(_cells,1)]
EXCLUDED["6460"].extend([(190,0,60,14),(145,60,56,11),(135,117,80,13),(140,175,80,13),(144,233,62,11),(0,335,342,16)])
EXCLUDED["6415"].extend([(187,0,60,9),(142,55,56,11),(132,112,80,13),(137,170,80,13),(141,228,62,11),(0,330,339,15)])

# These are specific source-printing annotations checked in the source and
# contact sheets. Hide only these exact rectangles from the default picker.
GALLERY_OMISSIONS = {
    "6534": [(287,361,35,9,"Sheet annotation: Teleport"),(326,361,17,9,"Sheet annotation: eye"),(347,361,28,9,"Sheet annotation: closed"),(304,447,23,8,"Sheet annotation: open"),(331,446,17,9,"Sheet annotation: eye"),(352,446,24,9,"Sheet annotation: open"),(29,494,38,9,"Sheet annotation: Eyeshield")],
    "535841": [(32,16,66,10,"Source palette reference"),(144,16,22,26,"Source palette reference"),(172,16,22,26,"Source palette reference"),(144,64,66,18,"Source palette reference"),(288,320,66,10,"Source palette reference")],
    "6562": [(4,4,33,29,"Source palette reference"),(125,58,17,29,"Source palette reference"),(179,114,17,29,"Source palette reference"),(48,238,9,29,"Source palette reference"),(66,239,9,25,"Source palette reference")],
}

PREVIEW_RECT = {
    "6460": (198,14,46,46), "6415": (195,9,46,46), "6506": (0,0,64,64),
    "6546": (171,1,48,72), "6461": (8,10,236,167), "535841": (33,34,94,66),
    "6534": (187,73,42,56), "31116": (18,12,42,55), "6535": (6,1,53,63),
    "6437": (6,196,14,14), "6562": (78,163,73,70),
}

# Interior panels whose exact background is separated from the sheet edge
# by a printed separator line. Only exact key pixels touching the boundary
# of one of these visually checked panels seed an additional flood.
PANELS = {
    "6534": [(1,1,697,210),(1,213,697,70),(1,286,107,154),(110,286,447,70),(110,359,447,82),(110,444,447,78)],
    "6562": [(2,2,117,93),(121,2,120,93),(2,99,225,134),(2,238,59,170),(65,238,176,94),(65,335,176,45),(65,383,140,26)],
    "6542": [(1,1,148,386)],
    "6504": [(1,1,290,225)],
    "6523": [(1,1,99,178),(1,181,99,63)],
    "6413": [(1,1,98,121),(1,125,98,97)],
    "6387": [(x+1,y+1,71,127) for y,n in ((32,5),(192,3),(352,4)) for x in range(0,n*96,96)],
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def category(asset):
    if asset["section"] in ("Playable Characters", "Non-Playable Characters") or asset["id"] == "6502": return "characters"
    if asset["section"] == "Enemies" or asset["id"] == "6528": return "enemies"
    if asset["section"] == "Bosses": return "bosses"
    if asset["section"] in ("Maps", "Tilesets") or asset["id"] in ENVIRONMENT_IDS: return "environments"
    if asset["id"] in OBJECT_IDS: return "objects"
    return "interface"


def key_colors(asset, image):
    if asset["id"] in KEY_OVERRIDES:
        return KEY_OVERRIDES[asset["id"]]
    if image.getchannel("A").getextrema()[0] == 0:
        return []
    value = asset.get("background", {}).get("suggestedKeyColor")
    if value:
        return [tuple(bytes.fromhex(value[1:]))]
    # Only sheets explicitly selected for foreground indexing reach this path.
    # The dominant exact color is a candidate; it must be border connected.
    return [Counter(image.convert("RGB").getdata()).most_common(1)[0][0]]


def clean_background(source, colors, panels=()):
    """Remove only exact-key pixels reachable from an image edge or alpha-0.

    A union flood handles a sheet's documented two-color backgrounds. Enclosed
    exact-color pixels are preserved. Every other RGBA channel is untouched.
    """
    image = source.copy()
    width, height = image.size
    raw = bytearray(image.tobytes())
    permitted = set(colors)
    eligible = bytearray(width*height)
    seen = bytearray(width*height)
    work = deque()
    for p in range(width*height):
        offset = p*4
        if raw[offset+3] == 0:
            eligible[p] = 1
            seen[p] = 1
            work.append(p)
        elif tuple(raw[offset:offset+3]) in permitted:
            eligible[p] = 1
            x, y = p % width, p // width
            if x in (0,width-1) or y in (0,height-1):
                seen[p] = 1
                work.append(p)
    for px,py,pw,ph in panels:
        for x in range(px,px+pw):
            for y in (py,py+ph-1):
                p=y*width+x
                if eligible[p] and not seen[p]: seen[p]=1; work.append(p)
        for y in range(py,py+ph):
            for x in (px,px+pw-1):
                p=y*width+x
                if eligible[p] and not seen[p]: seen[p]=1; work.append(p)
    while work:
        p = work.popleft()
        x = p % width
        for q in ((p-1 if x else -1), (p+1 if x+1<width else -1), p-width, p+width):
            if 0 <= q < len(seen) and eligible[q] and not seen[q]:
                seen[q] = 1
                work.append(q)
    removed = 0
    for p, flag in enumerate(seen):
        if flag and raw[p*4+3]:
            raw[p*4+3] = 0
            removed += 1
    return Image.frombytes("RGBA", image.size, bytes(raw)), removed


def overlaps(rect, other):
    x,y,w,h = rect; ox,oy,ow,oh = other
    return x < ox+ow and x+w > ox and y < oy+oh and y+h > oy


def components(image):
    """Eight-connected components without changing or resampling pixels."""
    width,height = image.size
    mask = bytearray(image.getchannel("A").tobytes())
    result = []
    for start in range(width*height):
        if not mask[start]: continue
        mask[start] = 0
        todo = [start]
        xs = start % width; ys = start // width
        left=right=xs; top=bottom=ys; count=0
        while todo:
            p = todo.pop(); x=p%width; y=p//width; count+=1
            left=min(left,x); right=max(right,x); top=min(top,y); bottom=max(bottom,y)
            for dy in (-1,0,1):
                if not 0 <= y+dy < height: continue
                for dx in (-1,0,1):
                    if not (dx or dy) or not 0 <= x+dx < width: continue
                    q=(y+dy)*width+x+dx
                    if mask[q]: mask[q]=0; todo.append(q)
        result.append([left,top,right-left+1,bottom-top+1,count])
    return result


def nearby(a,b):
    """Join close detached details within a frame, never fill a silhouette."""
    x,y,w,h,_=a; xx,yy,ww,hh,_=b
    xgap=max(x-(xx+ww),xx-(x+w),0)
    ygap=max(y-(yy+hh),yy-(y+h),0)
    # Keep adjacent poses apart. The small threshold joins a detached eye,
    # carried object, or foot only when boxes overlap on the other axis.
    if min(a[4],b[4]) > 80: return False
    return (xgap <= 2 and ygap == 0) or (ygap <= 2 and xgap == 0)


def merge_components(items):
    items = list(items)
    changed = True
    while changed:
        changed=False; output=[]
        for rect in sorted(items,key=lambda r:(r[1],r[0])):
            match=None
            for i,old in enumerate(output):
                if old[1]+old[3]+3 < rect[1]: continue
                if nearby(old,rect): match=i; break
            if match is None: output.append(rect); continue
            old=output[match]
            left=min(old[0],rect[0]); top=min(old[1],rect[1])
            right=max(old[0]+old[2],rect[0]+rect[2]); bottom=max(old[1]+old[3],rect[1]+rect[3])
            output[match]=[left,top,right-left,bottom-top,old[4]+rect[4]]
            changed=True
        items=output
    return items


def make_piece(asset, derived_id, rect, index, row, title=None, explicit=False):
    x,y,w,h=rect[:4]; cat=category(asset)
    kind="pose" if cat in ("characters","enemies") else "part-pose" if cat=="bosses" else "object" if cat=="objects" else "region"
    if title and title.startswith("Body frame"): kind="pose"
    noun="Pose" if kind=="pose" else "Part / pose" if kind=="part-pose" else "Object" if kind=="object" else "Region"
    return {"id":f"piece-{asset['id']}-{x}-{y}-{w}-{h}","name":title or f"{noun} {index:03d} · {w} × {h}",
            "assetId":derived_id,"sx":x,"sy":y,"sw":w,"sh":h,"sourceId":asset["id"],
            "sourceRect":{"x":x,"y":y,"w":w,"h":h},"kind":kind,"group":f"Row {row:02d}","sequence":index,
            "rowIndex":row,"sourceRow":row,"representation":"whole-body" if title and title.startswith("Body frame") else "source-component",
            "extraction":"curated-region" if explicit else "foreground-component"}


def build(root, contact_dir):
    catalog=json.loads((root/"assets/catalog.json").read_text())
    output=root/"assets/pieces"; output.mkdir(parents=True,exist_ok=True)
    result={"version":1,"generatedAt":datetime.now(timezone.utc).isoformat(timespec="seconds"),"assets":[],"sheets":{},"stats":{}}
    total_pieces=0; counts=Counter(); all_contact=[]
    for asset in catalog["assets"]:
        sid=asset["id"]; cat=category(asset)
        source=Image.open(root/asset["path"]).convert("RGBA")
        foreground=cat in ("characters","bosses","enemies","objects")
        if not foreground:
            result["sheets"][sid]={"sourceId":sid,"category":cat,"pieces":[{
                "id":f"region-{sid}","name":asset["name"],"assetId":sid,"sx":0,"sy":0,"sw":source.width,"sh":source.height,
                "sourceId":sid,"sourceRect":{"x":0,"y":0,"w":source.width,"h":source.height},"kind":"region","group":"Full sheet","sequence":1,"extraction":"full-sheet"}],
                "coverage":{"fullSourceAvailable":True,"originalSha256":asset["originalSha256"],"indexedPieces":1},
                "note":"The full source is preserved. Use the sheet crop and grid tools to select individual scenery or interface pieces."}
            counts[cat]+=1; total_pieces+=1
            continue
        colors=key_colors(asset,source)
        cleaned,removed=clean_background(source,colors,PANELS.get(sid,())) if colors else (source.copy(),0)
        did=f"clean-{sid}"; path=f"assets/pieces/{did}.png"; cleaned.save(root/path,optimize=True)
        png=(root/path).read_bytes()
        result["assets"].append({"id":did,"sourceId":sid,"name":asset["name"]+" · cutouts","section":asset["section"],"path":path,
            "width":source.width,"height":source.height,"dataUrl":"data:image/png;base64,"+base64.b64encode(png).decode(),"sha256":hashlib.sha256(png).hexdigest()})
        raw=components(cleaned)
        excluded=EXCLUDED.get(sid,[])
        # Overlapping an excluded block is not enough to hide a large sprite
        # crossing its edge. Only component centers inside it are excluded.
        kept=[]; filtered_count=0
        for rect in raw:
            x,y,w,h,n=rect
            # Printed rule lines/credit frames must be removed before joining
            # nearby fragments, otherwise a line could join an entire row.
            if (max(w,h)>90 and n/(w*h)<0.17) or (w>60 and h<=3) or (h>60 and w<=3):
                filtered_count+=1; continue
            if any(ex<=x+w/2<ex+ew and ey<=y+h/2<ey+eh for ex,ey,ew,eh in excluded):
                filtered_count+=1; continue
            kept.append(rect)
        merged=kept if sid=="19728" else merge_components(kept)
        accepted=[]
        for rect in merged:
            x,y,w,h,n=rect
            tiny_minish=sid=="19728"
            if n < (4 if tiny_minish else 20) or w < (2 if tiny_minish else 5) or h < (2 if tiny_minish else 7):
                filtered_count+=1; continue
            # Most sheet labels are 6 or 7 pixels high. Tiny real objects can
            # still be picked in the full sheet and 8px grid.
            if not tiny_minish and h <= 8 and (w > 24 or n < 32):
                filtered_count+=1; continue
            if w > h*8 and h < 16:
                filtered_count+=1; continue
            accepted.append(rect)
        # Remove component boxes intersecting an explicitly grouped object;
        # the curated crop preserves all its constituent art pixels together.
        for r in EXPLICIT.get(sid,[]):
            accepted=[v for v in accepted if not overlaps(v[:4],r[:4])]
        omitted={tuple(r[:4]) for r in GALLERY_OMISSIONS.get(sid,[])}
        accepted=[v for v in accepted if tuple(v[:4]) not in omitted]
        accepted.sort(key=lambda r:(r[1]//8,r[0],r[1]))
        pieces=[]; row=0; previous_top=-100
        for i,rect in enumerate(accepted,1):
            if abs(rect[1]-previous_top)>9: row+=1; previous_top=rect[1]
            pieces.append(make_piece(asset,did,rect,i,row))
        for explicit in EXPLICIT.get(sid,[]):
            if explicit[0]+explicit[2] <= source.width and explicit[1]+explicit[3]<=source.height:
                pieces.append(make_piece(asset,did,explicit,len(pieces)+1,row+1,explicit[4],True))
        preview=next((p for p in pieces if (p["sx"],p["sy"],p["sw"],p["sh"])==PREVIEW_RECT.get(sid)),None)
        if preview is None:
            # Prefer a substantial colorful art component over tiny effect
            # fragments. This only selects a thumbnail, never changes cuts.
            preview=next((p for p in pieces if 10<=p["sw"]<=96 and 12<=p["sh"]<=96),pieces[0] if pieces else None)
        alpha_pixels=sum(1 for x in cleaned.getchannel("A").getdata() if x)
        coverage_mask=Image.new("1",source.size); coverage_draw=ImageDraw.Draw(coverage_mask)
        for piece in pieces: coverage_draw.rectangle((piece["sx"],piece["sy"],piece["sx"]+piece["sw"]-1,piece["sy"]+piece["sh"]-1),fill=1)
        covered=sum(1 for a,m in zip(cleaned.getchannel("A").getdata(),coverage_mask.getdata()) if a and m)
        result["sheets"][sid]={"sourceId":sid,"category":cat,"pieces":pieces,
            "previewPieceId":preview["id"] if preview else None,"coverPieceId":preview["id"] if preview else None,
            "coverage":{"fullSourceAvailable":True,"originalSha256":asset["originalSha256"],"sourceSheetSha256":asset["sha256"],"indexedPieces":len(pieces),
                        "foregroundPixels":alpha_pixels,"foregroundPixelsInIndexedRects":covered,"foregroundCoverageRatio":round(covered/alpha_pixels,5) if alpha_pixels else 0,
                        "removedBackgroundPixels":removed,"backgroundColors":[list(c) for c in colors],"backgroundMethod":"sheet-or-curated-panel-edge-connected-exact-colors","backgroundPanels":PANELS.get(sid,[]),"filteredComponents":filtered_count,
                        "galleryExclusions":EXCLUDED.get(sid,[]),"galleryExclusionsReason":"Visually checked source annotations, credit banners and presentation examples. Every excluded source region remains available in the original sheet.",
                        "galleryOmissions":[{"sourceRect":{"x":x,"y":y,"w":w,"h":h},"reason":reason,"availableInOriginal":True} for x,y,w,h,reason in GALLERY_OMISSIONS.get(sid,[])]},
            "note":"Every indexed cut retains the source pixels except the recorded connected background colors. Components may be separate body parts or effects. Credits, tiny fragments and unrecognized groupings remain available in the original sheet and manual crop tool. The library covers the downloaded sheets, not a verified list of all frames in the game."}
        counts[cat]+=len(pieces); total_pieces+=len(pieces)
        if cat in ("characters","bosses") or sid in ("6437","6562","6561","604585"):
            all_contact.append((asset,cleaned,pieces))
        print(f"{sid}: {asset['name']}: {len(pieces)} cuts, {covered}/{alpha_pixels} indexed pixels",flush=True)
    result["stats"]={"sourceSheets":len(catalog["assets"]),"derivedSheets":len(result["assets"]),"pieces":total_pieces,"byCategory":dict(counts),
        "actorSourceSheets":sum(1 for s in result["sheets"].values() if s["category"] in ("characters","enemies","bosses")),
        "scope":"Indexed artwork from all 134 downloaded source sheets. Every original sheet remains available for precise manual cropping."}
    data=json.dumps(result,ensure_ascii=False,separators=(",",":"))
    (root/"assets/pieces.json").write_text(data+"\n")
    (root/"assets/pieces.js").write_text("window.MINISH_PIECES="+data+";\n")
    if contact_dir:
        contact_dir.mkdir(parents=True,exist_ok=True)
        for asset,cleaned,pieces in all_contact:
            cellw=90; cellh=94; columns=12
            preview=Image.new("RGB",(cellw*columns,((len(pieces)+columns-1)//columns)*cellh),(51,63,61))
            draw=ImageDraw.Draw(preview)
            for i,piece in enumerate(pieces):
                tile=cleaned.crop((piece["sx"],piece["sy"],piece["sx"]+piece["sw"],piece["sy"]+piece["sh"]))
                target=(cellw-8,cellh-23)
                scale=max(1,min(target[0]//tile.width,target[1]//tile.height))
                if tile.width>target[0] or tile.height>target[1]: tile=ImageOps.contain(tile,target,Image.Resampling.NEAREST)
                else: tile=tile.resize((tile.width*scale,tile.height*scale),Image.Resampling.NEAREST)
                xx=(i%columns)*cellw+(cellw-tile.width)//2; yy=(i//columns)*cellh+2
                preview.paste(tile,(xx,yy),tile)
                draw.text(((i%columns)*cellw+3,(i//columns)*cellh+cellh-17),str(i+1)+" "+str(piece["sw"])+"x"+str(piece["sh"]),fill=(230,235,220))
            if pieces: preview.save(contact_dir/f"{asset['id']}.png")
    print(json.dumps(result["stats"],indent=2))
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root",nargs="?",type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument("--contact-dir",type=Path)
    args=parser.parse_args()
    build(args.root.resolve(),args.contact_dir)


if __name__=="__main__": main()
