#!/usr/bin/env python3
"""Verify originals, normalized sheets, deduplicated PNGs, atlas maps, and grids.

Full verification compares every source-grid cell with its mapped tile pixels.
Use --sample N for a faster deterministic sample of N cells per sheet/grid.
Requires Pillow. This tool does not change the source assets or generated packs.
"""

from __future__ import annotations

import argparse
from collections import OrderedDict
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import random
import sys
import zipfile
from xml.etree.ElementTree import parse as parse_xml

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow is required. Install the project dependencies first.")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def assert_equal(actual, expected, context: str) -> None:
    if actual != expected:
        raise ValueError(f"{context}: expected {expected!r}, got {actual!r}")


def load_rgba(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA")


class TileCache:
    def __init__(self, archive, tiles, limit=8192):
        self.archive, self.tiles, self.limit = archive, tiles, limit
        self.cache = OrderedDict()

    def get(self, tile_id):
        pixels = self.cache.get(tile_id)
        if pixels is not None:
            self.cache.move_to_end(tile_id)
            return pixels
        with Image.open(io.BytesIO(self.archive.read(self.tiles[tile_id]["file"]))) as image:
            pixels = image.convert("RGBA").tobytes()
        self.cache[tile_id] = pixels
        if len(self.cache) > self.limit:
            self.cache.popitem(last=False)
        return pixels


def verify(root: Path, sample: int = 0) -> dict:
    root = root.resolve()
    catalog_path = root / "assets" / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    assert_equal(len(catalog["assets"]), catalog["stats"]["sheetCount"], "Catalog sheet count")
    assets_by_id = {}
    for asset in catalog["assets"]:
        if asset["id"] in assets_by_id:
            raise ValueError(f"Duplicate catalog asset ID: {asset['id']}")
        assets_by_id[asset["id"]] = asset
        original = root / asset["originalPath"]
        sheet_path = root / asset["path"]
        assert_equal(file_sha256(original), asset["originalSha256"], f"Original {asset['id']} SHA-256")
        assert_equal(file_sha256(sheet_path), asset["sha256"], f"Sheet {asset['id']} SHA-256")
        sheet = load_rgba(sheet_path)
        assert_equal(sheet.size, (asset["width"], asset["height"]), f"Sheet {asset['id']} size")
        assert_equal(hashlib.sha256(sheet.tobytes()).hexdigest(), asset["rgbaSha256"],
                     f"Sheet {asset['id']} RGBA checksum")
        with Image.open(original) as source:
            source.seek(0)
            original_image = source.convert("RGBA")
        assert_equal(sheet.size, original_image.size, f"Original dimensions {asset['id']}")
        if sheet.tobytes() != original_image.tobytes():
            raise ValueError(f"Sheet {asset['id']} differs from the original first frame")
        thumbnail = load_rgba(root / asset["thumbnail"])
        if thumbnail.width > 256 or thumbnail.height > 256:
            raise ValueError(f"Thumbnail for {asset['id']} is too large")
    results = []
    for pack in catalog["tilePacks"]:
        size = pack["tileSize"]
        index = json.loads((root / pack["index"]).read_text(encoding="utf-8"))
        tiles = index["tiles"]
        atlas_images = {}
        for atlas in index["atlases"]:
            atlas_path = root / atlas["path"]
            assert_equal(file_sha256(atlas_path), atlas["sha256"], f"{size}px atlas checksum")
            atlas_image = load_rgba(atlas_path)
            assert_equal(atlas_image.size, (atlas["width"], atlas["height"]), f"{size}px atlas size")
            atlas_images[atlas["page"]] = atlas_image
            tsx = parse_xml(root / atlas["tsx"]).getroot()
            assert_equal(int(tsx.attrib["tilewidth"]), size, f"{size}px Tiled width")
            assert_equal(int(tsx.attrib["tileheight"]), size, f"{size}px Tiled height")
            assert_equal(int(tsx.attrib["tilecount"]), atlas["tileCount"], f"{size}px Tiled count")
            assert_equal(tsx.find("image").attrib["source"], atlas_path.name, f"{size}px Tiled source")
        archive_path = root / pack["archive"]
        assert_equal(file_sha256(archive_path), pack["sha256"], f"{size}px archive checksum")
        checked_cells, transparent_cells, total_cells = 0, 0, 0
        referenced = set()
        with zipfile.ZipFile(archive_path) as archive:
            if archive.testzip() is not None:
                raise ValueError(f"Corrupt file in {archive_path.name}")
            archive_index = json.loads(archive.read("index.json"))
            assert_equal(archive_index, index, f"{size}px archive index")
            pngs = [name for name in archive.namelist() if name.endswith(".png")]
            assert_equal(len(pngs), len(tiles), f"{size}px PNG count")
            assert_equal(len(set(pngs)), len(tiles), f"{size}px duplicate ZIP filenames")
            hashes = set()
            for tile_id, tile in enumerate(tiles):
                assert_equal(tile["id"], tile_id, f"{size}px tile ID")
                with Image.open(io.BytesIO(archive.read(tile["file"]))) as image:
                    assert_equal(image.size, (size, size), f"{size}px tile dimensions")
                    image = image.convert("RGBA")
                    pixels = image.tobytes()
                digest = hashlib.sha256(bytes([size]) + pixels).hexdigest()
                assert_equal(digest, tile["sha256"], f"{size}px tile content hash")
                assert_equal(tile["file"], f"tile-{digest}.png", f"{size}px tile filename")
                if digest in hashes:
                    raise ValueError(f"Duplicate deduplicated {size}px tile: {digest}")
                hashes.add(digest)
                if image.getchannel("A").getbbox() is None:
                    raise ValueError(f"Fully transparent tile was not omitted: {tile['file']}")
                atlas = atlas_images[tile["atlasPage"]]
                x, y = tile["atlasX"], tile["atlasY"]
                if atlas.crop((x, y, x + size, y + size)).tobytes() != pixels:
                    raise ValueError(f"{size}px tile {tile_id} differs from its atlas entry")
            cache = TileCache(archive, tiles)
            assert_equal(len(index["sheets"]), len(catalog["assets"]), f"{size}px sheet coverage")
            seen_sheets = set()
            for grid in index["sheets"]:
                asset_id = grid["sheetId"]
                if asset_id in seen_sheets:
                    raise ValueError(f"Duplicate {size}px grid for {asset_id}")
                seen_sheets.add(asset_id)
                asset = assets_by_id[asset_id]
                columns, rows = math.ceil(asset["width"] / size), math.ceil(asset["height"] / size)
                assert_equal((grid["columns"], grid["rows"]), (columns, rows), f"{size}px grid dimensions")
                assert_equal(len(grid["cells"]), rows * columns, f"{size}px grid cell count")
                sheet = load_rgba(root / asset["path"])
                count = len(grid["cells"])
                total_cells += count
                transparent_cells += grid["cells"].count(None)
                for tile_id in grid["cells"]:
                    if tile_id is not None:
                        if not isinstance(tile_id, int) or not 0 <= tile_id < len(tiles):
                            raise ValueError(f"Invalid tile reference in {size}px sheet {asset_id}")
                        referenced.add(tile_id)
                if sample and count > sample:
                    randomizer = random.Random(f"minish-{size}-{asset_id}")
                    # Always include the corners, including padded edge cells.
                    positions = set(randomizer.sample(range(count), sample))
                    positions.update((0, columns - 1, (rows - 1) * columns, count - 1))
                else:
                    positions = range(count)
                for position in positions:
                    x, y = (position % columns) * size, (position // columns) * size
                    expected = sheet.crop((x, y, x + size, y + size))
                    tile_id = grid["cells"][position]
                    if tile_id is None:
                        if expected.getchannel("A").getbbox() is not None:
                            raise ValueError(f"Nontransparent cell omitted: {size}px {asset_id}, {x}, {y}")
                    elif cache.get(tile_id) != expected.tobytes():
                        raise ValueError(f"Tile reconstruction mismatch: {size}px {asset_id}, {x}, {y}")
                    checked_cells += 1
                print(f"Verified {size}px sheet: {asset['name']}", flush=True)
        assert_equal(referenced, set(range(len(tiles))), f"{size}px referenced unique tile coverage")
        assert_equal(total_cells, index["stats"]["gridCellCount"], f"{size}px total cells")
        assert_equal(transparent_cells, index["stats"]["transparentCellCount"], f"{size}px transparent cells")
        assert_equal(len(tiles), index["stats"]["uniqueTileCount"], f"{size}px unique count")
        assert_equal(pack["stats"], index["stats"], f"{size}px pack statistics")
        results.append({"tileSize": size, "uniqueTilesVerified": len(tiles),
                        "gridCells": total_cells, "gridCellsCompared": checked_cells,
                        "atlasPagesVerified": len(atlas_images)})
    result = {"status": "passed", "verifiedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "mode": "full" if sample == 0 else f"sample: {sample} cells per sheet and size",
              "sheetsVerified": len(assets_by_id), "packs": results}
    print(json.dumps(result, indent=2), flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--sample", type=int, default=0,
                        help="0 checks every source cell (default); positive N samples per sheet")
    parser.add_argument("--report", type=Path, help="Optional path to a verification JSON report")
    args = parser.parse_args()
    if args.sample < 0:
        parser.error("--sample must be zero or positive")
    try:
        result = verify(args.root.resolve(), args.sample)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(f"Verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
