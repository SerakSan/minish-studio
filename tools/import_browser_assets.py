#!/usr/bin/env python3
"""Import this project's observed original files from browser asset bundles."""
import argparse
import csv
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://www.spriters-resource.com/game_boy_advance/thelegendofzeldatheminishcap/"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle_directory", type=Path)
    args = parser.parse_args()
    with (ROOT / "assets/source-credits.tsv").open(encoding="utf-8") as stream:
        credits = list(csv.DictReader(stream, delimiter="\t"))
    needed = {row["id"] for row in credits}
    matches = {}
    for manifest in args.bundle_directory.glob("*/manifest.json"):
        try:
            bundle = json.loads(manifest.read_text())
        except (ValueError, OSError):
            continue
        for asset in bundle.get("assets", []):
            match = re.fullmatch(r"https://www\.spriters-resource\.com/media/assets/\d+/(\d+)\.(png|gif)(?:\?.*)?", asset.get("url", ""))
            if not match or match.group(1) not in needed:
                continue
            candidate = (manifest.stat().st_mtime, asset, match.group(2))
            if match.group(1) not in matches or candidate[0] > matches[match.group(1)][0]:
                matches[match.group(1)] = candidate
    missing = needed - matches.keys()
    if missing:
        raise SystemExit("Missing observed originals: " + ", ".join(sorted(missing)))
    output = ROOT / "assets/originals"
    output.mkdir(parents=True, exist_ok=True)
    assets = []
    for row in credits:
        _, observed, extension = matches[row["id"]]
        original = Path(observed["path"])
        data = original.read_bytes()
        if not (data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith((b"GIF87a", b"GIF89a"))):
            raise SystemExit("Original is not PNG/GIF: " + row["id"])
        destination = output / (row["id"] + "." + extension)
        if destination.exists() and destination.read_bytes() != data:
            raise SystemExit("Existing original differs: " + str(destination))
        if not destination.exists():
            shutil.copy2(original, destination)
        assets.append({**row, "sourceUrl": SOURCE + "asset/" + row["id"] + "/",
                       "downloadUrl": observed["url"], "originalPath": destination.relative_to(ROOT).as_posix(),
                       "originalBytes": len(data), "originalSha256": hashlib.sha256(data).hexdigest(),
                       "status": "downloaded"})
    result = {"sourceUrl": SOURCE, "retrievedAt": datetime.now(timezone(timedelta(hours=9))).isoformat(),
              "expectedAssetCount": 134, "downloadedAssetCount": len(assets),
              "method": "Original image files observed on each public asset page and exported through browser asset bundles.",
              "assets": assets}
    (ROOT / "assets/source-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"downloaded": len(assets), "originalBytes": sum(a["originalBytes"] for a in assets),
                      "categories": {section: sum(a["section"] == section for a in assets) for section in sorted({a["section"] for a in assets})}}))


if __name__ == "__main__":
    main()
