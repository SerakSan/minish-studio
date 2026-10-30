#!/usr/bin/env python3
"""Package the complete offline studio, original artwork, and tile packs."""
from pathlib import Path
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {".venv", "__pycache__", ".git", ".cache", ".DS_Store", ".versions", "release", "_site"}


def main():
    destination = ROOT.parent / "Minish-Studio-Complete.zip"
    with tempfile.NamedTemporaryFile(prefix=".minish-studio-", suffix=".zip", dir=ROOT.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(ROOT.rglob("*")):
                relative = path.relative_to(ROOT)
                if not path.is_file() or set(relative.parts) & EXCLUDED:
                    continue
                archive.write(path, (Path("Minish Studio") / relative).as_posix())
        with zipfile.ZipFile(temporary) as archive:
            failure = archive.testzip()
            if failure:
                raise SystemExit("Archive verification failed: " + failure)
            count = len(archive.infolist())
        temporary.replace(destination)
        print(str(destination))
        print(str(count) + " files; " + str(destination.stat().st_size) + " bytes; ZIP integrity passed.")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
