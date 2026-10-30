#!/usr/bin/env python3
"""Export indexed foreground artwork as traceable transparent RGBA PNGs.

The downloaded originals and the original piece index are never changed.
Existing conservative background-cleaned sheets are reused. A small, explicit
list of reserved sheet-key colors is additionally cleared in derived sheets;
these exact colors were visually checked in the printed source panels. No
approximate color matching, resizing, generation, or RGB rewriting is used.
"""

from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import zipfile
from collections import deque

from PIL import Image, ImageDraw


FOREGROUND_CATEGORIES = {"characters", "enemies", "bosses", "objects"}

# Exact placeholder colors, checked against the original sheet presentation.
# These are transparency keys, including enclosed holes inside a ring/effect.
# Black, white, and game palette colors are deliberately not guessed away.
RESERVED_PANEL_COLORS = {
    "19728": [(248, 192, 240)],
    "24932": [(0, 128, 0), (64, 176, 136)],
    "22716": [(16, 128, 88), (7, 60, 41)],
    "6530": [(0, 128, 0), (64, 176, 136), (255, 0, 0)],
    "64168": [(64, 176, 136)],
    "6449": [(16, 128, 88)],
    "6480": [(64, 176, 136)],
    "6498": [(64, 176, 136)],
    "6515": [(64, 176, 136)],
    "6520": [(64, 176, 136)],
    "6407": [(64, 176, 136), (16, 128, 88)],
    "6448": [(64, 176, 136), (16, 128, 88)],
    "6514": [(64, 176, 136), (16, 128, 88)],
    "6541": [(16, 128, 88)],
    "6460": [(64, 176, 136)],
    "6546": [(47, 145, 16)],
    "535841": [(51, 165, 121)],
    "6534": [(0, 40, 81), (0, 23, 47)],
    "6535": [(24, 149, 240), (13, 106, 171)],
    "37862": [(0, 19, 127)],
    "6435": [(167, 167, 227)],
    "6437": [(192, 192, 255)],
    "6561": [(229, 230, 255)],
    "180815": [(48, 160, 120)],
    "6502": [(160, 255, 240)],
}

PADDING = 2

# Reviewed source presentation, never a pixel-color heuristic. These regions
# only hide complete indexed reference/annotation cuts from the ready gallery.
# The original catalog, index, downloaded files and manual crops stay intact.
EXCLUDED_REGIONS = {
    "6369": [((0, 3558, 134, 178), "Source palette reference")],
    "6370": [((0, 1022, 134, 178), "Source palette reference")],
    "6399": [((0, 633, 240, 160), "Flattened gameplay reference screenshot; original sheet remains available")],
    "6406": [((870, 8, 353, 66), "Printed source credit banner")],
    "6443": [((0, 139, 188, 62), "Printed source ripper logo and credits")],
    "6449": [((98, 34, 181, 53), "Printed source ripper logo and credits"), ((0, 39, 52, 45), "Printed source chain assembly instructions")],
    "49617": [((0, 0, 442, 35), "Printed source actor heading"),
              ((0, 36, 268, 135), "Multi-pose Floormaster reference grid; crop individual hands from the original sheet"),
              ((271, 36, 168, 70), "Multi-pose Wallmaster reference grid; crop individual hands from the original sheet"),
              ((271, 106, 171, 80), "Printed source credits and shadow reference panel")],
    "6459": [((0, 112, 95, 38), "Printed source title and credit banner")],
    "6475": [((0, 27, 170, 39), "Printed source title and credit banner")],
    "6478": [((1, 51, 208, 83), "Printed source title and credit banner")],
    "6497": [((0, 78, 242, 53), "Printed source ripper logo and credits")],
    "6509": [((0, 72, 213, 84), "Printed source credits and example reference")],
    "6511": [((2, 77, 200, 83), "Printed source title and credit banner")],
    "6512": [((0, 152, 284, 68), "Printed source title and credit banner")],
    "6520": [((0, 85, 179, 47), "Printed source ripper logo and credits")],
    "6448": [((109, 117, 59, 44), "Source author's edited comparison panel"),
             ((0, 162, 191, 58), "Printed source ripper logo and credits")],
    "6514": [((268, 0, 47, 52), "Printed source palette legend"),
             ((0, 102, 231, 42), "Printed source ripper logo and credits")],
    "6407": [((38, 0, 106, 96), "Printed source title, credits or assembly caption")],
    "6452": [((2, 44, 67, 24), "Printed source title and note")],
    "6499": [((0, 145, 181, 56), "Printed source ripper logo and credits")],
    "180815": [((0, 132, 33, 13), "Source palette reference"),
               ((0, 145, 228, 51), "Printed source credit banner")],
    "6502": [((2, 34, 281, 81), "Printed source title and credit banner")],
}

EXCLUDED_IDS = {
    "piece-6514-75-53-98-79": "Overlapping multi-frame chest/reference block; individual chest cuts and original sheet remain available",
    "piece-6514-3-89-70-43": "Printed ripper logo mixed with a redundant partial chest fragment; complete chest cut is retained",
    "piece-6535-910-17-32-16": "Source alternate-palette swatch",
    "piece-6562-120-338-9-17": "Source green color-ramp palette swatch",
    "piece-6562-193-387-9-16": "Source gray color-ramp palette swatch",
    "piece-6562-64-335-69-44": "Source edited-effect comparison grid with palette swatch; original sheet remains available",
}

# Only these visibly printed annotations overlap an otherwise useful cut.
# Removing the annotation in a derivative keeps every adjacent art pixel.
ANNOTATION_MASKS = {
    "6407": [(38, 0, 106, 96)],
    "6514": [(268, 0, 47, 52), (0, 102, 231, 42)],
}

# Edge-connected floods preserve enclosed pixels of the same color in art.
# These were reviewed as source panel backdrops, not inferred from opacity.
PANEL_FLOODS = {
    "24932": [((164, 38, 16, 16), [(160, 168, 176)])],
    "6514": [((x, 53, 32, 49), [(248, 248, 168)]) for x in (36, 69, 135, 168, 201)]
            + [((251, 72, 16, 16), [(40, 111, 86)])],
}

RESERVED_KEY_REGIONS = {
    "6461": [((549, 181, 64, 48), [(16, 128, 88)])],
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def clear_reserved_colors(image, colors):
    raw = bytearray(image.convert("RGBA").tobytes())
    permitted = set(map(tuple, colors))
    count = 0
    for i in range(0, len(raw), 4):
        if raw[i + 3] and tuple(raw[i:i + 3]) in permitted:
            raw[i + 3] = 0
            count += 1
    return Image.frombytes("RGBA", image.size, bytes(raw)), count


def wholly_inside(piece, rect):
    x, y, width, height = rect
    return x <= piece["sx"] and y <= piece["sy"] and piece["sx"]+piece["sw"] <= x+width and piece["sy"]+piece["sh"] <= y+height


def excluded_reason(sid, piece):
    if piece["id"] in EXCLUDED_IDS:
        return EXCLUDED_IDS[piece["id"]]
    for rect, reason in EXCLUDED_REGIONS.get(sid, []):
        if wholly_inside(piece, rect):
            return reason
    return None


def panel_flood(image, rect, colors):
    x, y, width, height = rect
    crop = image.crop((x, y, x+width, y+height))
    raw = bytearray(crop.tobytes())
    permitted = set(map(tuple, colors))
    queue = deque()
    seen = bytearray(width*height)
    for pos in range(width*height):
        offset = pos*4
        eligible = raw[offset+3] == 0 or tuple(raw[offset:offset+3]) in permitted
        if eligible and (raw[offset+3] == 0 or pos%width in (0, width-1) or pos//width in (0, height-1)):
            seen[pos] = 1
            queue.append(pos)
    removed = 0
    while queue:
        pos = queue.popleft()
        offset = pos*4
        if raw[offset+3]:
            raw[offset+3] = 0
            removed += 1
        for q in ((pos-1 if pos%width else -1), (pos+1 if pos%width < width-1 else -1), pos-width, pos+width):
            if 0 <= q < width*height and not seen[q]:
                o = q*4
                if raw[o+3] == 0 or tuple(raw[o:o+3]) in permitted:
                    seen[q] = 1
                    queue.append(q)
    output = image.copy()
    output.paste(Image.frombytes("RGBA", crop.size, bytes(raw)), (x, y))
    return output, removed


def clean_sheet(original, sid):
    image, removed = clear_reserved_colors(original, RESERVED_PANEL_COLORS.get(sid, []))
    for rect, colors in RESERVED_KEY_REGIONS.get(sid, []):
        x, y, width, height = rect
        crop, count = clear_reserved_colors(image.crop((x, y, x+width, y+height)), colors)
        image.paste(crop, (x, y))
        removed += count
    for rect, colors in PANEL_FLOODS.get(sid, []):
        image, count = panel_flood(image, rect, colors)
        removed += count
    annotation_pixels = 0
    raw = bytearray(image.tobytes())
    for x, y, width, height in ANNOTATION_MASKS.get(sid, []):
        for yy in range(y, y+height):
            for xx in range(x, x+width):
                offset = (yy*image.width+xx)*4
                if raw[offset+3]:
                    raw[offset+3] = 0
                    annotation_pixels += 1
    return Image.frombytes("RGBA", image.size, bytes(raw)), removed, annotation_pixels


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(root):
    catalog = json.loads((root / "assets/catalog.json").read_text())
    pieces = json.loads((root / "assets/pieces.json").read_text())
    source_assets = {a["id"]: a for a in catalog["assets"]}
    derived_assets = {a["id"]: a for a in pieces["assets"]}
    destination = root / "assets/sprites"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "sheets").mkdir(exist_ok=True)
    (destination / "contact-sheets").mkdir(exist_ok=True)
    exported = []
    overrides = {}
    assets = []
    counts = Counter()
    cleanups = []
    excluded = []
    opaque_content = []
    contact_picks = []

    for sid, sheet in pieces["sheets"].items():
        if sheet["category"] not in FOREGROUND_CATEGORIES:
            continue
        source = source_assets[sid]
        old_asset = derived_assets.get("clean-" + sid, source)
        original = Image.open(root / old_asset["path"]).convert("RGBA")
        image, removed, annotation_pixels = clean_sheet(original, sid)
        active_asset_id = old_asset["id"]
        if removed or annotation_pixels:
            path = destination / "sheets" / ("transparent-" + sid + ".png")
            image.save(path, optimize=True)
            active_asset_id = "transparent-" + sid
            assets.append({
                "id": active_asset_id, "name": source["name"] + " · transparent sprites",
                "sourceId": sid, "section": source["section"],
                "contributors": source.get("contributors", ""), "sourceUrl": source["sourceUrl"],
                "path": path.relative_to(root).as_posix(), "width": image.width,
                "height": image.height, "sha256": digest(path),
                "dataUrl": "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode(),
            })
            overrides[old_asset["id"]] = active_asset_id
            cleanups.append({
                "sourceId": sid, "inputAssetId": old_asset["id"],
                "inputPath": old_asset["path"], "outputAssetId": active_asset_id,
                "outputPath": path.relative_to(root).as_posix(),
                "reservedPanelColors": RESERVED_PANEL_COLORS.get(sid, []),
                "reservedKeyRegions": [{"rect": list(rect), "colors": colors} for rect, colors in RESERVED_KEY_REGIONS.get(sid, [])],
                "panelFloods": [{"rect": list(rect), "colors": colors} for rect, colors in PANEL_FLOODS.get(sid, [])],
                "annotationMasks": ANNOTATION_MASKS.get(sid, []),
                "removedPixels": removed,
                "maskedPresentationPixels": annotation_pixels,
                "method": "exact-reviewed-reserved-keys-and-panel-edge-floods; explicitly-placed-source-annotation-masks",
            })

        folder = destination / sheet["category"] / (sid + "-" + slug(source["name"]))
        folder.mkdir(parents=True, exist_ok=True)
        candidates = []
        for piece in sheet["pieces"]:
            x, y, width, height = (piece[k] for k in ("sx", "sy", "sw", "sh"))
            crop = image.crop((x, y, x + width, y + height))
            content_alpha = crop.getchannel("A")
            reason = excluded_reason(sid, piece)
            if reason or content_alpha.getbbox() is None:
                excluded.append({"id": piece["id"], "sourceId": sid, "sourceName": source["name"],
                                 "reason": reason or "Printed source annotation entirely inside a reviewed presentation mask",
                                 "sourceRect": piece["sourceRect"], "availableInOriginal": True})
                stale = folder / (piece["id"] + ".png")
                if stale.exists():
                    stale.unlink()
                continue
            canvas = Image.new("RGBA", (width + PADDING * 2, height + PADDING * 2))
            canvas.paste(crop, (PADDING, PADDING))
            path = folder / (piece["id"] + ".png")
            canvas.save(path, optimize=True)
            transparent_pixels = sum(value == 0 for value in content_alpha.getdata())
            record = {
                "id": piece["id"], "name": piece["name"], "category": sheet["category"],
                "sourceId": sid, "sourceName": source["name"], "sourceUrl": source["sourceUrl"],
                "contributors": source.get("contributors", ""),
                "sourceAssetId": piece["assetId"], "renderAssetId": active_asset_id,
                "sourceRect": {"x": x, "y": y, "w": width, "h": height},
                "path": path.relative_to(root).as_posix(), "format": "PNG", "mode": "RGBA",
                "width": canvas.width, "height": canvas.height, "padding": PADDING,
                "placementOffset": {"x": PADDING, "y": PADDING},
                "sha256": digest(path), "contentTransparentPixels": transparent_pixels,
                "nonempty": content_alpha.getbbox() is not None,
                "note": "Exact indexed crop with transparent padding. Opaque artwork and flattened source examples are retained as published.",
            }
            exported.append(record)
            counts[sheet["category"]] += 1
            if transparent_pixels == 0:
                opaque_content.append(piece["id"])
            if content_alpha.getbbox() and 10 <= width <= 100 and 12 <= height <= 100:
                candidates.append((canvas.copy(), record))
        contact_picks.extend(candidates[:3])

    manifest = {
        "version": 1, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sourceCollection": catalog["sourceUrl"], "padding": PADDING,
        "sourceSheets": len(source_assets), "sprites": exported, "sheetCleanups": cleanups,
        "stats": {"pngs": len(exported), "byCategory": dict(counts),
                  "improvedSheets": len(assets), "additionalBackgroundPixelsRemoved": sum(r["removedPixels"] for r in cleanups),
                  "maskedSourceAnnotationPixels": sum(r["maskedPresentationPixels"] for r in cleanups),
                  "sourceIndexedCuts": len(exported)+len(excluded), "excludedSourceReferences": len(excluded),
                  "opaqueContentRects": len(opaque_content)},
        "excludedSourceReferences": excluded,
        "opaqueContentPieceIds": opaque_content,
        "scope": "Reviewed ready-to-place character, enemy, boss and object cuts. Explicit source palettes, labels, logos, credit banners and flattened reference grids are excluded from this PNG pack and the ready gallery, with reasons recorded; every source region stays accessible in the unchanged original sheets. Legitimate opaque body tiles, arena tiles and interface graphics retain their actual artwork. Missing poses or layers are not invented.",
    }
    write_json(destination / "manifest.json", manifest)
    public = {
        "version": 1, "assets": assets, "assetOverrides": overrides,
        "manifestPath": "assets/sprites/manifest.json", "downloadPath": "assets/sprites/minish-studio-sprites.zip",
        "stats": manifest["stats"],
        "excludedPieceIds": [record["id"] for record in excluded],
        "excludedPieceReasons": {record["id"]: record["reason"] for record in excluded},
        "note": "Exact transparent cutouts, with original full sheets retained for manual extraction. Some original rectangular tiles and flattened examples intentionally remain opaque.",
    }
    write_json(root / "assets/sprites.json", public)
    (root / "assets/sprites.js").write_text("window.MINISH_SPRITES=" + json.dumps(public, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

    # Review art at nearest-neighbor scale on an explicit checkerboard.
    columns = 10
    rows = (len(contact_picks) + columns - 1) // columns
    contact = Image.new("RGB", (columns * 112, rows * 130), "#172735")
    draw = ImageDraw.Draw(contact)
    for index, (sprite, record) in enumerate(contact_picks):
        x, y = (index % columns) * 112, (index // columns) * 130
        for yy in range(y, y + 104, 8):
            for xx in range(x, x + 112, 8):
                draw.rectangle((xx, yy, xx + 7, yy + 7), fill="#3d5361" if ((xx-x)//8 + (yy-y)//8) % 2 else "#233d49")
        scale = max(1, min(3, 100 // sprite.width, 96 // sprite.height))
        thumb = sprite.resize((sprite.width * scale, sprite.height * scale), Image.Resampling.NEAREST)
        contact.paste(thumb, (x + (112 - thumb.width) // 2, y + (104 - thumb.height) // 2), thumb)
        draw.text((x + 3, y + 108), record["sourceId"], fill="white")
        draw.text((x + 3, y + 119), record["sourceName"][:17], fill="#c9e6c5")
    contact.save(destination / "contact-sheets" / "foreground-samples.png")

    zip_path = destination / "minish-studio-sprites.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.write(destination / "manifest.json", "manifest.json")
        archive.writestr("README.txt", "Minish Studio transparent sprite cuts\n\nIndexed artwork from The Legend of Zelda: The Minish Cap.\nSource: The Spriters Resource. Individual contributor names and source links are recorded in manifest.json.\nGame artwork belongs to its respective rights holders. This archive does not grant a license to the game artwork.\n\nEvery cut is an RGBA PNG with 2 pixels of transparent padding. Subtract the placementOffset when replacing an unpadded source crop. Real art colors are preserved. Known reserved background colors are cleared only in derivative images. Flat rectangular scenery, palette samples, and flattened source examples retain their original content; no missing layers or poses are invented.\n")
        for record in exported:
            archive.write(root / record["path"], record["path"].removeprefix("assets/sprites/"))
    with zipfile.ZipFile(zip_path) as archive:
        if archive.testzip() is not None:
            raise ValueError("Sprite ZIP checksum failure")
    print(json.dumps(manifest["stats"], indent=2))
    return manifest


def verify(root):
    catalog = json.loads((root / "assets/catalog.json").read_text())
    library = json.loads((root / "assets/pieces.json").read_text())
    public = json.loads((root / "assets/sprites.json").read_text())
    manifest = json.loads((root / "assets/sprites/manifest.json").read_text())
    sources = {a["id"]: a for a in catalog["assets"]}
    assets = dict(sources)
    assets.update({a["id"]: a for a in library["assets"]})
    assets.update({a["id"]: a for a in public["assets"]})
    image_cache = {}
    for source in sources.values():
        assert digest(root / source["originalPath"]) == source["originalSha256"], source["id"]
        assert digest(root / source["path"]) == source["sha256"], source["id"]
    for item in manifest["sheetCleanups"]:
        old = Image.open(root / item["inputPath"]).convert("RGBA")
        expected, removed, annotation_pixels = clean_sheet(old, item["sourceId"])
        actual = Image.open(root / item["outputPath"]).convert("RGBA")
        assert actual.tobytes() == expected.tobytes(), item["sourceId"]
        assert removed == item["removedPixels"], item["sourceId"]
        assert annotation_pixels == item["maskedPresentationPixels"], item["sourceId"]
        before = old.tobytes()
        after = actual.tobytes()
        assert before[0::4] == after[0::4] and before[1::4] == after[1::4] and before[2::4] == after[2::4], item["sourceId"]
        for color in item["reservedPanelColors"]:
            assert not any(pixel[3] and pixel[:3] == tuple(color) for pixel in actual.getdata()), item["sourceId"]
    for asset in public["assets"]:
        png = (root / asset["path"]).read_bytes()
        assert hashlib.sha256(png).hexdigest() == asset["sha256"]
        assert base64.b64decode(asset["dataUrl"].split(",", 1)[1]) == png
    ids = set()
    for record in manifest["sprites"]:
        assert record["id"] not in ids
        ids.add(record["id"])
        aid = record["renderAssetId"]
        if aid not in image_cache:
            image_cache[aid] = Image.open(root / assets[aid]["path"]).convert("RGBA")
        r = record["sourceRect"]
        expected = image_cache[aid].crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
        path = root / record["path"]
        assert digest(path) == record["sha256"]
        with Image.open(path) as image:
            assert image.mode == "RGBA" and image.format == "PNG"
            assert image.size == (r["w"] + PADDING * 2, r["h"] + PADDING * 2)
            assert image.crop((PADDING, PADDING, PADDING+r["w"], PADDING+r["h"])).tobytes() == expected.tobytes(), record["id"]
            assert image.getchannel("A").getextrema()[0] == 0
            alpha = image.getchannel("A")
            assert not alpha.crop((0, 0, image.width, PADDING)).getbbox()
            assert not alpha.crop((0, image.height-PADDING, image.width, image.height)).getbbox()
            assert not alpha.crop((0, 0, PADDING, image.height)).getbbox()
            assert not alpha.crop((image.width-PADDING, 0, image.width, image.height)).getbbox()
    expected_ids = {piece["id"] for sheet in library["sheets"].values() if sheet["category"] in FOREGROUND_CATEGORIES for piece in sheet["pieces"]}
    excluded_ids = set(public["excludedPieceIds"])
    assert ids == expected_ids-excluded_ids
    assert len(excluded_ids) == len(manifest["excludedSourceReferences"]) == manifest["stats"]["excludedSourceReferences"]
    assert excluded_ids == {record["id"] for record in manifest["excludedSourceReferences"]}
    for record in manifest["excludedSourceReferences"]:
        assert record["reason"] and record["availableInOriginal"]
        assert not list((root / "assets/sprites").glob("*/*/"+record["id"]+".png")), record["id"]
    with zipfile.ZipFile(root / public["downloadPath"]) as archive:
        assert archive.testzip() is None
        assert len(archive.infolist()) == len(ids) + 2
    report = {
        "status": "passed", "verifiedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "originalSourceChecksumsVerified": len(sources), "rgbaPngsVerified": len(ids),
        "improvedSheetsVerified": len(public["assets"]),
        "additionalExactKeyPixelsRemoved": manifest["stats"]["additionalBackgroundPixelsRemoved"],
        "reviewedSourceAnnotationPixelsMasked": manifest["stats"]["maskedSourceAnnotationPixels"],
        "sourcePresentationCutsExcluded": len(excluded_ids),
        "excludedPngsAbsentFromFolderAndZip": True,
        "remainingOpaqueContentRects": manifest["stats"]["opaqueContentRects"],
        "transparentPaddingVerified": True, "rgbArtworkPreserved": True,
        "sourceCoordinateMappingsVerified": True, "zipCrcVerified": True,
        "limitations": manifest["scope"],
    }
    write_json(root / "assets/sprites/verification.json", report)
    print(json.dumps(report, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    if not args.verify_only:
        build(root)
    verify(root)


if __name__ == "__main__":
    main()
