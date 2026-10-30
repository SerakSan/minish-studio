#!/usr/bin/env python3
"""Verify scene-maker cutouts against the untouched downloaded artwork.

Checks all source checksums, embedded PNGs, exact RGBA preservation, removal
color whitelist, removal connectivity, crop bounds, stable unique IDs and
coverage counts. Does not alter any source or derivative image.
"""

from __future__ import annotations

import argparse
import base64
from collections import Counter, deque
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone

from PIL import Image, ImageDraw


def check(condition, message):
    if not condition: raise ValueError(message)


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(root):
    source=json.loads((root/"assets/catalog.json").read_text())
    library=json.loads((root/"assets/pieces.json").read_text())
    check(library["version"]==1,"Unsupported piece-library version")
    check((root/"assets/pieces.js").read_text()=="window.MINISH_PIECES="+json.dumps(library,ensure_ascii=False,separators=(",",":"))+";\n","Embedded JS and JSON differ")
    sources={a["id"]:a for a in source["assets"]}
    derived={a["id"]:a for a in library["assets"]}
    check(len(derived)==len(library["assets"]),"Duplicate derived-sheet ID")
    check(set(library["sheets"])==set(sources),"Source-sheet coverage differs from the downloaded catalog")
    seen=set(); count=0; changed_pixels=0; counts=Counter(); pixel_count=0; covered_count=0
    for sid,asset in sources.items():
        check(sha(root/asset["originalPath"])==asset["originalSha256"],f"Original artwork changed: {sid}")
        check(sha(root/asset["path"])==asset["sha256"],f"Source sheet changed: {sid}")
        record=library["sheets"][sid]; coverage=record["coverage"]
        check(coverage["fullSourceAvailable"] is True,f"Missing original access: {sid}")
        check(coverage["originalSha256"]==asset["originalSha256"],f"Provenance mismatch: {sid}")
        original=Image.open(root/asset["path"]).convert("RGBA")
        clean_id=f"clean-{sid}"
        if clean_id in derived:
            derivative=derived[clean_id]
            png=(root/derivative["path"]).read_bytes()
            check(hashlib.sha256(png).hexdigest()==derivative["sha256"],f"Derivative checksum mismatch: {sid}")
            check(base64.b64decode(derivative["dataUrl"].split(",",1)[1])==png,f"Offline embedded PNG mismatch: {sid}")
            cleaned=Image.open(root/derivative["path"]).convert("RGBA")
            check(cleaned.size==original.size,f"Derivative dimensions changed: {sid}")
            before=original.tobytes(); after=cleaned.tobytes()
            colors={tuple(c) for c in coverage["backgroundColors"]}
            width,height=original.size; altered=bytearray(width*height)
            eligible=bytearray(width*height); reached=bytearray(width*height); queue=deque()
            for p in range(width*height):
                i=p*4; src=before[i:i+4]; dst=after[i:i+4]
                if src!=dst:
                    check(src[:3]==dst[:3] and src[3]>0 and dst[3]==0,f"Art pixel/RGB modified: {sid}, {p%width},{p//width}")
                    check(tuple(src[:3]) in colors,f"Non-background color removed: {sid}, {p%width},{p//width}")
                    altered[p]=1
                if src[3]==0 or tuple(src[:3]) in colors:
                    eligible[p]=1
                    if src[3]==0 or p%width in (0,width-1) or p//width in (0,height-1):
                        reached[p]=1; queue.append(p)
            for x,y,w,h in coverage.get("backgroundPanels",[]):
                check(x>=0 and y>=0 and x+w<=width and y+h<=height,f"Background panel out of bounds: {sid}")
                boundary=[yy*width+xx for yy in range(y,y+h) for xx in (x,x+w-1)]
                boundary += [yy*width+xx for xx in range(x,x+w) for yy in (y,y+h-1)]
                for p in boundary:
                    if eligible[p] and not reached[p]: reached[p]=1; queue.append(p)
            while queue:
                p=queue.popleft(); x=p%width
                for q in ((p-1 if x else -1),(p+1 if x<width-1 else -1),p-width,p+width):
                    if 0<=q<len(eligible) and eligible[q] and not reached[q]: reached[q]=1; queue.append(q)
            for p,flag in enumerate(altered):
                check(not flag or reached[p],f"Enclosed art pixel removed outside connected background: {sid}, {p%width},{p//width}")
            removed=sum(altered); changed_pixels+=removed
            check(removed==coverage["removedBackgroundPixels"],f"Removed-pixel count mismatch: {sid}")
            # No selected background component can be partly removed.
            for p,flag in enumerate(reached):
                check(not flag or before[p*4+3]==0 or altered[p],f"Partially processed background: {sid}")
        else:
            cleaned=original
        masks=Image.new("1",original.size); draw=ImageDraw.Draw(masks)
        rects=set()
        for piece in record["pieces"]:
            count+=1; counts[record["category"]]+=1
            check(piece["id"] not in seen,f"Duplicate piece ID: {piece['id']}")
            seen.add(piece["id"])
            x,y,w,h=(piece[k] for k in ("sx","sy","sw","sh"))
            check(all(isinstance(v,int) for v in (x,y,w,h)),f"Fractional crop: {piece['id']}")
            check(0<=x and 0<=y and w>0 and h>0 and x+w<=original.width and y+h<=original.height,f"Crop outside source bounds: {piece['id']}")
            check((x,y,w,h) not in rects,f"Repeated source crop in one gallery: {piece['id']}")
            rects.add((x,y,w,h))
            check(piece["sourceId"]==sid and piece["sourceRect"]=={"x":x,"y":y,"w":w,"h":h},f"Crop-to-source mapping mismatch: {piece['id']}")
            check(piece["assetId"] in (sid,clean_id),f"Crop points to unexpected pixels: {piece['id']}")
            check(cleaned.crop((x,y,x+w,y+h)).getchannel("A").getbbox() is not None,f"Empty gallery cut: {piece['id']}")
            draw.rectangle((x,y,x+w-1,y+h-1),fill=1)
        check(len(record["pieces"])==coverage["indexedPieces"],f"Gallery count mismatch: {sid}")
        ids={p["id"] for p in record["pieces"]}
        for field in ("previewPieceId","coverPieceId"):
            if field in record: check(record[field] in ids,f"Preview points outside the gallery: {sid}")
        for omission in coverage.get("galleryOmissions",[]):
            r=omission["sourceRect"]
            check((r["x"],r["y"],r["w"],r["h"]) not in rects,f"Source annotation remains in default gallery: {sid}")
            check(omission["availableInOriginal"] and omission["reason"],f"Missing annotation provenance: {sid}")
        if clean_id in derived:
            nonempty=sum(bool(v) for v in cleaned.getchannel("A").getdata())
            covered=sum(bool(a and b) for a,b in zip(cleaned.getchannel("A").getdata(),masks.getdata()))
            check(nonempty==coverage["foregroundPixels"] and covered==coverage["foregroundPixelsInIndexedRects"],f"Incorrect foreground coverage: {sid}")
            pixel_count+=nonempty; covered_count+=covered
    check(count==library["stats"]["pieces"],"Total gallery count differs")
    check(dict(counts)==library["stats"]["byCategory"],"Category counts differ")
    result={"status":"passed","verifiedAt":datetime.now(timezone.utc).isoformat(timespec="seconds"),"sourceSheetsUnchanged":len(sources),
        "derivedSheetsVerified":len(derived),"pieceBoundsAndMappingsVerified":count,"recordedBackgroundPixelsRemoved":changed_pixels,
        "foregroundPixels":pixel_count,"foregroundPixelsInIndexedRects":covered_count,"foregroundCoverageRatio":round(covered_count/pixel_count,5),
        "scope":"Source-art crops and connected exact-color background removal verified. No assertion is made that downloaded sheets contain every game pose. Original full-sheet/manual crop access retains every source region."}
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root",nargs="?",type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument("--report",type=Path)
    args=parser.parse_args()
    result=verify(args.root.resolve())
    if args.report: args.report.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))


if __name__=="__main__": main()
