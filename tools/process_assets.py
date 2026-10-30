#!/usr/bin/env python3
"""Build a lossless sprite-sheet library and deduplicated 8px/16px tile packs.

Requires Pillow. Inputs are local files only. The downloaded originals are never
modified. Run from any directory: python tools/process_assets.py [PROJECT_ROOT].
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
import unicodedata
from xml.etree.ElementTree import Element, SubElement, ElementTree
import zipfile

try:
    from PIL import Image, UnidentifiedImageError
except ImportError:
    raise SystemExit("Pillow is required. Install the project dependencies first.")


SCHEMA_VERSION = 1
MAX_EMBED_BYTES = 100 * 1024 * 1024


def json_text(value: object, *, pretty: bool = False) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2 if pretty else None,
                      separators=None if pretty else (",", ":"))


def write_json(path: Path, value: object, *, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json_text(value, pretty=pretty) + "\n", encoding="utf-8")
    temporary.replace(path)


def slug(value: object, *, limit: int = 80) -> str:
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (value or "sheet")[:limit].rstrip("-")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def local_original(root: Path, value: str) -> Path:
    path = (root / value).resolve()
    if not path.is_relative_to(root):
        raise ValueError("originalPath must remain inside the project folder")
    return path


def background_info(image: Image.Image) -> dict:
    """Describe transparency and a conservative corner-color suggestion."""
    alpha_min, alpha_max = image.getchannel("A").getextrema()
    info = {"hasTransparency": alpha_min < 255,
            "alphaRange": [alpha_min, alpha_max]}
    corners = [image.getpixel(point) for point in
               ((0, 0), (image.width - 1, 0), (0, image.height - 1),
                (image.width - 1, image.height - 1))]
    if len(set(corners)) == 1 and corners[0][3] == 255:
        info["suggestedKeyColor"] = "#%02x%02x%02x" % corners[0][:3]
    return info


def normalize_assets(root: Path, manifest: dict, generated_at: str) -> tuple[list, list]:
    sheets_dir = root / "assets" / "sheets"
    thumbs_dir = root / "assets" / "thumbnails"
    sheets_dir.mkdir(parents=True, exist_ok=True)
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    assets, statuses, seen = [], [], set()
    entries = manifest.get("assets", [])
    if not isinstance(entries, list):
        raise ValueError("The manifest assets field must be a list")
    for position, entry in enumerate(entries):
        asset_id = str(entry.get("id", position + 1))
        if asset_id in seen:
            raise ValueError(f"Duplicate asset ID in manifest: {asset_id}")
        seen.add(asset_id)
        name = entry.get("name") or f"Sheet {asset_id}"
        try:
            if not entry.get("originalPath"):
                raise ValueError(entry.get("error") or "No downloaded originalPath")
            original = local_original(root, entry["originalPath"])
            if not original.is_file():
                raise FileNotFoundError(f"Original not found: {entry['originalPath']}")
            with Image.open(original) as source:
                original_format = source.format
                frame_count = getattr(source, "n_frames", 1)
                source.seek(0)
                image = source.convert("RGBA")
            if image.width == 0 or image.height == 0:
                raise ValueError("The source image is empty")
            basename = f"{slug(asset_id, limit=40)}-{slug(name)}"
            destination = sheets_dir / f"{basename}.png"
            image.save(destination, format="PNG", compress_level=6)
            thumbnail = image.copy()
            thumbnail.thumbnail((256, 256), Image.Resampling.NEAREST)
            thumb_path = thumbs_dir / f"{basename}.png"
            thumbnail.save(thumb_path, format="PNG", compress_level=6)
            item = dict(entry)
            item.update({
                "id": asset_id, "name": name, "section": entry.get("section", "Other"),
                "path": relative(destination, root),
                "thumbnail": relative(thumb_path, root),
                "width": image.width, "height": image.height,
                "format": "PNG", "originalFormat": original_format,
                "frameCount": frame_count, "animated": frame_count > 1,
                "sha256": file_sha256(destination),
                "originalSha256": file_sha256(original),
                "rgbaSha256": hashlib.sha256(image.tobytes()).hexdigest(),
                "byteSize": destination.stat().st_size,
                "background": background_info(image),
            })
            if frame_count > 1:
                item["animationNote"] = ("The original animation is preserved at originalPath. "
                                         "The normalized sheet and tile packs use frame 1.")
            assets.append(item)
            statuses.append({"id": asset_id, "name": name, "status": "processed"})
            print(f"Normalized {len(assets)}/{len(entries)}: {name} "
                  f"({image.width} x {image.height})", flush=True)
        except (OSError, ValueError, UnidentifiedImageError) as error:
            statuses.append({"id": asset_id, "name": name, "status": "failed",
                             "error": str(error)})
            print(f"Skipped {asset_id} ({name}): {error}", file=sys.stderr, flush=True)
    return assets, statuses


class AtlasWriter:
    """Pack unique tiles into compact, ordinary PNG/Tiled atlas pages."""

    def __init__(self, root: Path, size: int, max_size: int):
        self.root, self.size = root, size
        self.columns = max_size // size
        self.capacity = self.columns * self.columns
        self.page_number = 0
        self.page = Image.new("RGBA", (self.columns * size, self.columns * size))
        self.page_count = 0
        self.pages = []

    def add(self, tile: Image.Image) -> tuple[int, int, int]:
        if self.page_count == self.capacity:
            self.flush()
        x = (self.page_count % self.columns) * self.size
        y = (self.page_count // self.columns) * self.size
        self.page.paste(tile, (x, y))
        self.page_count += 1
        return self.page_number, x, y

    def flush(self) -> None:
        if not self.page_count:
            return
        rows = math.ceil(self.page_count / self.columns)
        actual_columns = min(self.columns, self.page_count)
        width, height = actual_columns * self.size, rows * self.size
        output = self.page.crop((0, 0, width, height))
        stem = f"atlas-{self.size}x{self.size}-{self.page_number:03d}"
        png_path = self.root / "tiles" / f"{stem}.png"
        output.save(png_path, "PNG", compress_level=6)
        tsx_path = png_path.with_suffix(".tsx")
        tileset = Element("tileset", {
            "version": "1.10", "tiledversion": "1.10.2", "name": stem,
            "tilewidth": str(self.size), "tileheight": str(self.size),
            "tilecount": str(self.page_count), "columns": str(actual_columns),
            "spacing": "0", "margin": "0",
        })
        SubElement(tileset, "image", {"source": png_path.name,
                                     "width": str(width), "height": str(height)})
        properties = SubElement(tileset, "properties")
        SubElement(properties, "property", {
            "name": "globalTileIdStart", "type": "int",
            "value": str(self.page_number * self.capacity),
        })
        ElementTree(tileset).write(tsx_path, encoding="utf-8", xml_declaration=True)
        self.pages.append({"page": self.page_number, "path": relative(png_path, self.root),
                           "tsx": relative(tsx_path, self.root), "width": width,
                           "height": height, "columns": actual_columns,
                           "tileCount": self.page_count,
                           "firstTileId": self.page_number * self.capacity,
                           "sha256": file_sha256(png_path)})
        self.page_number += 1
        self.page_count = 0
        self.page = Image.new("RGBA", (self.columns * self.size, self.columns * self.size))


def tile_pack(root: Path, assets: list, size: int, source_url: str,
              generated_at: str, atlas_size: int) -> dict:
    output_dir = root / "tiles"
    output_dir.mkdir(exist_ok=True)
    archive_path = output_dir / f"tiles-{size}x{size}.zip"
    temporary = archive_path.with_suffix(".zip.tmp")
    index_path = output_dir / f"tiles-{size}x{size}-index.json"
    hashes, unique_tiles, sheet_grids = {}, [], []
    atlas = AtlasWriter(root, size, atlas_size)
    total_cells = 0
    transparent_cells = 0
    repeated_cells = 0
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=6, allowZip64=True) as archive:
        for sheet_number, asset in enumerate(assets, start=1):
            with Image.open(root / asset["path"]) as source:
                sheet = source.convert("RGBA")
            columns, rows = math.ceil(sheet.width / size), math.ceil(sheet.height / size)
            cells = []
            for row in range(rows):
                for column in range(columns):
                    x, y = column * size, row * size
                    tile = sheet.crop((x, y, x + size, y + size))
                    total_cells += 1
                    if tile.getchannel("A").getbbox() is None:
                        cells.append(None)
                        transparent_cells += 1
                        continue
                    pixels = tile.tobytes()
                    # The size prefix makes a tile's content hash unambiguous.
                    digest = hashlib.sha256(bytes([size]) + pixels).digest()
                    existing = hashes.get(digest)
                    if existing is not None:
                        cells.append(existing)
                        repeated_cells += 1
                        continue
                    tile_id = len(unique_tiles)
                    hashes[digest] = tile_id
                    filename = f"tile-{digest.hex()}.png"
                    buffer = io.BytesIO()
                    tile.save(buffer, "PNG", compress_level=6)
                    archive.writestr(filename, buffer.getvalue())
                    page, atlas_x, atlas_y = atlas.add(tile)
                    unique_tiles.append({"id": tile_id, "file": filename,
                                         "sha256": digest.hex(), "atlasPage": page,
                                         "atlasX": atlas_x, "atlasY": atlas_y})
                    cells.append(tile_id)
            sheet_grids.append({"sheetId": asset["id"], "path": asset["path"],
                                "width": sheet.width, "height": sheet.height,
                                "columns": columns, "rows": rows, "cells": cells})
            print(f"{size}px grid {sheet_number}/{len(assets)}: {asset['name']} | "
                  f"{len(unique_tiles):,} unique tiles", flush=True)
        atlas.flush()
        index = {
            "schemaVersion": SCHEMA_VERSION, "sourceUrl": source_url,
            "generatedAt": generated_at, "tileSize": size, "origin": [0, 0],
            "edgePolicy": "Partial edge cells are padded with transparent pixels.",
            "transparentPolicy": "Only fully transparent cells are omitted (null).",
            "deduplication": "Exact RGBA SHA-256 within each grid size, across all sheets.",
            "hashFormat": "sha256(one byte containing tile size + RGBA bytes)",
            "mapping": ("sheets[].cells is row-major. Cell n begins at "
                        "x=(n % columns)*tileSize, y=floor(n/columns)*tileSize. "
                        "Its integer is an index into tiles; null means transparent."),
            "stats": {"sheetCount": len(sheet_grids), "gridCellCount": total_cells,
                      "transparentCellCount": transparent_cells,
                      "nontransparentCellCount": total_cells - transparent_cells,
                      "repeatedCellCount": repeated_cells,
                      "uniqueTileCount": len(unique_tiles),
                      "atlasPageCount": len(atlas.pages)},
            "tiles": unique_tiles, "sheets": sheet_grids, "atlases": atlas.pages,
        }
        archive.writestr("index.json", json_text(index).encode("utf-8"))
        archive.writestr("README.txt", (
            f"The Minish Cap: {size} x {size} pixel grid tiles\n\n"
            "These are lossless grid cuts of the downloaded resource sheets. "
            "Their layout is not a claim about the game's internal tile boundaries. "
            "Sheets can contain labels, colored backdrops, baked objects, maps, and "
            "other non-tile material. No background removal has been applied.\n\n"
            "Every nontransparent grid cell is mapped in index.json, including "
            "partial edge cells. Equal RGBA cells share one PNG. Fully transparent "
            "cells have a null index. PNGs are lossless and retain their alpha.\n\n"
            "The original downloads preserve animations; these tile cuts use "
            "the first frame. This library contains the resources available in the "
            "source manifest, not a complete rip of every game scene or layer.\n\n"
            f"Source: {source_url}\n"
        ).encode("utf-8"))
    temporary.replace(archive_path)
    write_json(index_path, index)
    return {"tileSize": size, "archive": relative(archive_path, root),
            "index": relative(index_path, root), "byteSize": archive_path.stat().st_size,
            "sha256": file_sha256(archive_path), "atlases": atlas.pages,
            "stats": index["stats"]}


def build(root: Path, manifest_path: Path, *, sizes: list[int], atlas_size: int,
          embed_limit: int) -> dict:
    root = root.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    source_url = manifest.get("sourceUrl", "")
    assets, statuses = normalize_assets(root, manifest, generated_at)
    if not assets:
        raise ValueError("No source images were successfully normalized")
    packs = [tile_pack(root, assets, size, source_url, generated_at, atlas_size)
             for size in sizes]
    total_bytes = sum(asset["byteSize"] for asset in assets)
    catalog = {
        "schemaVersion": SCHEMA_VERSION, "sourceUrl": source_url,
        "generatedAt": generated_at, "assets": assets, "tilePacks": packs,
        "sourceStatuses": statuses,
        "stats": {"sourceCount": len(statuses), "sheetCount": len(assets),
                  "sourceFailureCount": sum(item["status"] == "failed" for item in statuses),
                  "normalizedBytes": total_bytes,
                  "animatedSourceCount": sum(item["animated"] for item in assets),
                  "uniqueTiles": {str(pack["tileSize"]): pack["stats"]["uniqueTileCount"]
                                  for pack in packs}},
        "notes": [
            "This collection covers the downloaded source manifest, not every game scene or layer.",
            "Grid cuts start at the top-left corner. Sheet labels, backgrounds, and baked objects remain intact.",
            "Original downloads are unchanged. Animated sources use frame 1 in normalized sheets and tile packs.",
        ],
    }
    write_json(root / "assets" / "catalog.json", catalog, pretty=True)
    js_catalog = dict(catalog)
    js_catalog["assets"] = [dict(asset) for asset in assets]
    js_catalog["embeddedImages"] = total_bytes <= embed_limit
    if js_catalog["embeddedImages"]:
        for asset in js_catalog["assets"]:
            data = base64.b64encode((root / asset["path"]).read_bytes()).decode("ascii")
            asset["dataUrl"] = "data:image/png;base64," + data
    js_path = root / "assets" / "catalog.js"
    js_path.write_text("window.MINISH_ASSETS=" + json_text(js_catalog) + ";\n", encoding="utf-8")
    print(f"Built {len(assets)} sheets, {len(packs)} tile packs. "
          f"Embedded images: {js_catalog['embeddedImages']}", flush=True)
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[1])
    parser.add_argument("--manifest", type=Path, default=None,
                        help="Defaults to ROOT/assets/source-manifest.json")
    parser.add_argument("--tile-sizes", nargs="+", type=int, default=[8, 16])
    parser.add_argument("--atlas-size", type=int, default=2048,
                        help="Maximum atlas page dimension, a multiple of tile size")
    parser.add_argument("--embed-limit-mb", type=float, default=100,
                        help="Embed sheets in catalog.js below this total PNG size; 0 disables")
    args = parser.parse_args()
    root = args.root.resolve()
    for size in args.tile_sizes:
        if not 1 <= size <= 255 or args.atlas_size < size or args.atlas_size % size:
            parser.error("Tile sizes must be 1..255 and divide --atlas-size evenly")
    if len(set(args.tile_sizes)) != len(args.tile_sizes):
        parser.error("Do not repeat a tile size")
    manifest_path = args.manifest or root / "assets" / "source-manifest.json"
    try:
        build(root, manifest_path, sizes=args.tile_sizes, atlas_size=args.atlas_size,
              embed_limit=int(args.embed_limit_mb * 1024 * 1024))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error))


if __name__ == "__main__":
    main()
