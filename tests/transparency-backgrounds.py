#!/usr/bin/env python3
"""Check reviewed background cleanup without erasing genuine sprite colors."""
from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import unittest

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "transparent_sprites", ROOT / "tools/build_transparent_sprites.py"
)
SPRITES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SPRITES)


class ReviewedBackgroundTests(unittest.TestCase):
    def test_minish_link_keeps_complete_frames_without_duplicate_ray_choices(self):
        data = json.loads((ROOT / "assets/curated.json").read_text())
        pieces = data["sheets"]["19728"]["pieces"]
        self.assertEqual(len(pieces), 163)
        self.assertEqual([sum(p["group"] == group for p in pieces) for group in
                          ["Tiny Link", "Water & splashes", "Small effects", "Large markers"]], [95, 19, 1, 48])
        for old_id in ["piece-19728-1-79-2-4", "piece-19728-7-77-3-5", "piece-19728-14-78-3-4"]:
            self.assertNotIn(old_id, {p["id"] for p in pieces})
            self.assertIn(old_id, data["excludedPieceReasons"])
        image = Image.open(ROOT / "assets/sprites/sheets/transparent-19728.png").convert("RGBA")
        coverage = Image.new("L", image.size)
        draw = ImageDraw.Draw(coverage)
        for piece in pieces:
            x, y, w, h = [piece[key] for key in ["sx", "sy", "sw", "sh"]]
            draw.rectangle((x, y, x + w - 1, y + h - 1), fill=255)
            if "sourceCell" in piece:
                cell = piece["sourceCell"]
                cell_alpha = image.crop((cell["x"], cell["y"], cell["x"] + cell["w"], cell["y"] + cell["h"])).getchannel("A")
                crop_alpha = image.crop((x, y, x + w, y + h)).getchannel("A")
                self.assertEqual(sum(cell_alpha.getdata()), sum(crop_alpha.getdata()), piece["id"])
        # Every actual tiny actor/effect pixel is preserved, including dust,
        # the two-pixel blue particle and the previously detached water pixel.
        alpha = image.getchannel("A")
        for y in range(270, 379):
            for x in range(image.width):
                if alpha.getpixel((x, y)):
                    self.assertTrue(coverage.getpixel((x, y)), (x, y))

    def test_incomplete_farore_source_parts_stay_out_of_ready_choices(self):
        data = json.loads((ROOT / "assets/curated.json").read_text())
        ids = {p["id"] for p in data["sheets"]["24932"]["pieces"]}
        self.assertEqual(len(ids), 16)
        retired = {"curated-24932-farore-side-1", "curated-24932-farore-side-2"}
        self.assertTrue(ids.isdisjoint(retired))
        self.assertTrue(retired <= {p["id"] for p in data["legacyPieces"]})
        exported = json.loads((ROOT / "assets/curated/sprite-manifest.json").read_text())
        self.assertTrue(retired.isdisjoint({p["id"] for p in exported["pieces"]}))

    def test_panel_cleanup_preserves_enclosed_art_of_the_same_color(self):
        key = (160, 168, 176, 255)
        image = Image.new("RGBA", (7, 7), key)
        draw = ImageDraw.Draw(image)
        draw.rectangle((1, 1, 5, 5), outline=(24, 32, 40, 255))
        result, removed = SPRITES.panel_flood(image, (0, 0, 7, 7), [key[:3]])
        self.assertEqual(removed, 24)
        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((3, 3)), key)
        self.assertEqual(image.convert("RGB").tobytes(), result.convert("RGB").tobytes())

    def test_panel_cleanup_never_reaches_an_unreviewed_region(self):
        key = (80, 84, 88, 255)
        image = Image.new("RGBA", (8, 5), key)
        result, removed = SPRITES.panel_flood(image, (1, 1, 3, 3), [key[:3]])
        self.assertEqual(removed, 9)
        self.assertEqual(result.getpixel((2, 2))[3], 0)
        self.assertEqual(result.getpixel((4, 2)), key)
        self.assertEqual(result.getpixel((0, 0)), key)

    def test_farore_light_and_dark_panels_are_removed_without_repainting(self):
        image = Image.open(ROOT / "assets/pieces/clean-24932.png").convert("RGBA")
        result, _, _ = SPRITES.clean_sheet(image, "24932")
        self.assertEqual(result.size, image.size)
        self.assertEqual(image.convert("RGB").tobytes(), result.convert("RGB").tobytes())
        # These include the larger blocks, a dark variant, and a small
        # detached pocket beside the final Farore pose.
        for point in [(1, 38), (35, 38), (65, 38), (97, 38), (130, 47), (164, 55)]:
            self.assertEqual(result.getpixel(point)[3], 0, point)
        # Hair, face, and clothing retain their exact published RGBA values.
        for point in [(16, 41), (8, 43), (13, 48), (15, 54), (45, 44), (74, 43), (81, 55)]:
            self.assertEqual(result.getpixel(point), image.getpixel(point), point)
        for rect, colors in SPRITES.PANEL_FLOODS["24932"]:
            x, y, width, height = rect
            crop = result.crop((x, y, x + width, y + height))
            self.assertFalse(any(pixel[3] and pixel[:3] in colors for pixel in crop.getdata()), rect)
        # The top Din and Nayru row already had clean transparency. It must
        # remain byte-identical to the previous reviewed green-key cleanup.
        baseline, _ = SPRITES.clear_reserved_colors(image, SPRITES.RESERVED_PANEL_COLORS["24932"])
        self.assertEqual(result.crop((0, 0, image.width, 34)).tobytes(),
                         baseline.crop((0, 0, image.width, 34)).tobytes())

    def test_vaati_dark_panels_are_scoped_and_art_palette_is_unchanged(self):
        image = Image.open(ROOT / "assets/pieces/clean-6530.png").convert("RGBA")
        result, _, _ = SPRITES.clean_sheet(image, "6530")
        self.assertEqual(image.convert("RGB").tobytes(), result.convert("RGB").tobytes())
        for rect, colors in SPRITES.PANEL_FLOODS["6530"]:
            x, y, width, height = rect
            before = image.crop((x, y, x + width, y + height))
            after = result.crop((x, y, x + width, y + height))
            self.assertFalse(any(pixel[3] and pixel[:3] in colors for pixel in after.getdata()), rect)
            for old, new in zip(before.getdata(), after.getdata()):
                if old[3] and old[:3] not in colors and old[:3] not in SPRITES.RESERVED_PANEL_COLORS["6530"]:
                    self.assertEqual(old, new)
        for point in [(171, 57), (174, 73), (270, 57), (273, 73), (741, 181), (741, 188), (741, 198)]:
            self.assertEqual(result.getpixel(point), image.getpixel(point), point)
        # A source heading uses the same dark green. This is excluded as a
        # complete annotation cut, not stripped from arbitrary sheet pixels.
        baseline, _ = SPRITES.clear_reserved_colors(image, SPRITES.RESERVED_PANEL_COLORS["6530"])
        self.assertEqual(result.crop((88, 1, 287, 44)).tobytes(),
                         baseline.crop((88, 1, 287, 44)).tobytes())

    def test_community_credit_cuts_stay_out_of_gallery_but_in_source_archive(self):
        catalog = json.loads((ROOT / "assets/catalog.json").read_text())
        sources = {asset["id"]: asset for asset in catalog["assets"]}
        ids = ["piece-6370-165-14-142-63", "piece-6411-2-54-104-38", "piece-6445-1-23-95-52"]
        for piece_id in ids:
            _, source_id, x, y, width, height = piece_id.split("-")
            source = sources[source_id]
            self.assertIn("credit", SPRITES.excluded_reason(source_id, {"id": piece_id}).lower())
            original = ROOT / source["originalPath"]
            self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), source["originalSha256"])
            with Image.open(ROOT / source["path"]) as image:
                self.assertTrue(image.convert("RGBA").crop((int(x), int(y), int(x) + int(width), int(y) + int(height))).getbbox())

    def test_enemy_hole_cleanup_changes_only_reviewed_exact_key_pixels(self):
        sources = ["6411", "6472", "6475", "6405", "6478", "6504", "6509", "6511", "6512", "6556", "6524", "6557"]
        for source_id in sources:
            image = Image.open(ROOT / f"assets/pieces/clean-{source_id}.png").convert("RGBA")
            result, _, _ = SPRITES.clean_sheet(image, source_id)
            self.assertEqual(image.convert("RGB").tobytes(), result.convert("RGB").tobytes(), source_id)
            regions = SPRITES.RESERVED_KEY_REGIONS[source_id]
            changed = 0
            for position, (before, after) in enumerate(zip(image.getdata(), result.getdata())):
                if before == after:
                    continue
                x, y = position % image.width, position // image.width
                self.assertTrue(any(rx <= x < rx + width and ry <= y < ry + height and before[:3] in colors
                                    for (rx, ry, width, height), colors in regions), (source_id, x, y))
                self.assertEqual(after[:3], before[:3])
                self.assertEqual(after[3], 0)
                changed += 1
            self.assertGreater(changed, 0, source_id)
        # The purple Tektite head is game artwork, despite resembling its
        # magenta sheet key. Its actual source color and opacity stay intact.
        image = Image.open(ROOT / "assets/pieces/clean-6557.png").convert("RGBA")
        result, _, _ = SPRITES.clean_sheet(image, "6557")
        self.assertEqual(image.getpixel((120, 85)), (168, 24, 199, 255))
        self.assertEqual(result.getpixel((120, 85)), image.getpixel((120, 85)))

    def test_moblin_real_gray_blade_pixels_remain_opaque(self):
        image = Image.open(ROOT / "assets/pieces/clean-6556.png").convert("RGBA")
        result, _, _ = SPRITES.clean_sheet(image, "6556")
        blade_pixels = [(19, 262), (156, 409), (156, 410), (156, 411), (156, 412),
                        (156, 413), (156, 414), (157, 414), (157, 415), (157, 416),
                        (158, 416), (158, 417), (159, 418)]
        for point in blade_pixels:
            self.assertEqual(image.getpixel(point), (192, 192, 192, 255))
            self.assertEqual(result.getpixel(point), image.getpixel(point), point)
        self.assertEqual(image.getpixel((143, 400)), (192, 192, 192, 255))
        self.assertEqual(result.getpixel((143, 400))[3], 0)

    def test_character_pinholes_are_limited_to_reviewed_source_coordinates(self):
        for source_id, expected in [("6372", 27), ("6377", 10)]:
            image = Image.open(ROOT / f"assets/pieces/clean-{source_id}.png").convert("RGBA")
            result, _, _ = SPRITES.clean_sheet(image, source_id)
            allowed = {(rect[0], rect[1]): tuple(colors[0])
                       for rect, colors in SPRITES.RESERVED_KEY_REGIONS[source_id]}
            changed = 0
            for position, (before, after) in enumerate(zip(image.getdata(), result.getdata())):
                if before == after:
                    continue
                point = position % image.width, position // image.width
                self.assertEqual(before[:3], allowed[point])
                self.assertEqual(after, (*before[:3], 0))
                changed += 1
            self.assertEqual(changed, expected, source_id)

    def test_shared_source_colors_in_genuine_clothing_are_preserved(self):
        for source_id, rect, color in [("6396", (508, 44, 38, 31), (0, 128, 0)),
                                       ("6381", (42, 1583, 23, 29), (171, 0, 0))]:
            image = Image.open(ROOT / f"assets/pieces/clean-{source_id}.png").convert("RGBA")
            result, _, _ = SPRITES.clean_sheet(image, source_id)
            x, y, width, height = rect
            before = image.crop((x, y, x + width, y + height))
            after = result.crop((x, y, x + width, y + height))
            self.assertTrue(any(pixel[3] and pixel[:3] == color for pixel in before.getdata()))
            self.assertEqual(after.tobytes(), before.tobytes())


if __name__ == "__main__":
    unittest.main()
