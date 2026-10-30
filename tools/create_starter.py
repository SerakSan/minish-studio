#!/usr/bin/env python3
"""Create editable example scenes from unchanged original maps and Link art."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    catalog = json.loads((ROOT / "assets/catalog.json").read_text())
    assets = {str(a["id"]): a for a in catalog["assets"]}
    settings = [
        ("town", "01 Hyrule Town", "6526", 396, 304, 100, 100,
         "A new adventure begins.\nMake this little world your own."),
        ("woods", "02 Minish Woods", "6554", 776, 128, 142, 154,
         "Take the scenic route.\nSome stories need a little magic."),
        ("village", "03 Minish Village", "6540", 320, 176, 114, 65,
         "Small world. Big ideas.\nYour next chapter starts here."),
    ]
    slides = []
    for tag, name, map_id, crop_x, crop_y, link_x, link_y, text in settings:
        source = assets[map_id]
        slides.append({
            "id": "starter-" + tag, "name": name, "preset": "portrait",
            "width": 216, "height": 270, "exportScale": 5,
            "color": "#819452", "transparent": False,
            "objects": [
                {"id": tag + "-map", "kind": "sprite", "assetId": map_id,
                 "sx": 0, "sy": 0, "sw": source["width"], "sh": source["height"],
                 "x": -crop_x, "y": -crop_y, "scale": 1, "flipX": False, "flipY": False,
                 "keyColor": None, "layer": "terrain", "background": True},
                {"id": tag + "-link", "kind": "sprite", "assetId": "6369",
                 "sx": 15, "sy": 7, "sw": 19, "sh": 27,
                 "x": link_x, "y": link_y, "scale": 1, "flipX": False, "flipY": False,
                 "keyColor": None, "layer": "objects"},
                {"id": tag + "-dialogue", "kind": "dialogue", "x": 10, "y": 200,
                 "w": 196, "h": 58, "text": text, "fontSize": 9,
                 "color": "#fff7d3", "box": True, "layer": "overlay", "scale": 1},
            ],
        })
    project = {"format": "minish-cap-studio", "version": 1, "name": "My Hyrule Story",
               "activeSlide": slides[0]["id"], "slides": slides,
               "sourceUrl": catalog["sourceUrl"],
               "assets": [{"id": a["id"], "name": a["name"], "path": a["path"],
                           "sourceUrl": a["sourceUrl"]} for a in assets.values()
                          if str(a["id"]) in {"6526", "6554", "6540", "6369"}]}
    directory = ROOT / "examples"
    directory.mkdir(exist_ok=True)
    (directory / "My Hyrule Story.minish.json").write_text(json.dumps(project, indent=2) + "\n")
    (directory / "starter.js").write_text("window.MINISH_STARTER=" + json.dumps(project, separators=(",", ":")) + ";\n")
    print("Created three editable portrait starter scenes.")


if __name__ == "__main__":
    main()
