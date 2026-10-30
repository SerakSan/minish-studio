#!/usr/bin/env python3
"""Resume exact asset URLs from assets/source-manifest.json.

Only missing originals are fetched. Completed files are checked, never replaced.
No page crawling, browser-cookie access, or access-challenge bypass is performed.
The downloader uses the Python standard library only.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile


SUPPORTED_EXTENSIONS = ("png", "gif", "jpg", "jpeg", "zip")
BLOCKED_MESSAGE = (
    "The source requires normal browser access. Open the source page in your "
    "browser and complete any verification. Save remaining originals through "
    "the browser if automated requests remain blocked. Existing files are kept; "
    "rerun this tool to check them and continue."
)


class AccessBlocked(RuntimeError):
    """The source requires browser access or a pause before further requests."""


class RateLimiter:
    def __init__(self, interval: float = 1.0):
        self.interval = max(1.0, interval)
        self.last_request = None

    def wait(self) -> None:
        now = time.monotonic()
        if self.last_request is not None:
            remaining = self.interval - (now - self.last_request)
            if remaining > 0:
                time.sleep(remaining)
        self.last_request = time.monotonic()


class PoliteRedirectHandler(HTTPRedirectHandler):
    def __init__(self, limiter: RateLimiter):
        super().__init__()
        self.limiter = limiter

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None:
            self.limiter.wait()
        return redirected


def validate_url(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("downloadUrl must be a recorded HTTP or HTTPS URL")
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("downloadUrl must be a recorded HTTP or HTTPS URL")
    if parsed.username or parsed.password:
        raise ValueError("URLs containing credentials are not supported")
    return value


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def save_manifest(path: Path, manifest: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")
    temporary.replace(path)


def original_path(root: Path, value: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError("originalPath must be a path inside assets/originals")
    original_root = (root / "assets" / "originals").resolve()
    if not original_root.is_relative_to(root):
        raise ValueError("assets/originals must remain inside the project folder")
    path = (root / value).resolve()
    if not path.is_relative_to(original_root) or path == original_root:
        raise ValueError("originalPath must remain inside assets/originals")
    return path


def inspect_file(path: Path) -> dict:
    with path.open("rb") as stream:
        prefix = stream.read(512)
        digest = hashlib.sha256(prefix)
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    stripped = prefix.lstrip().lower()
    if stripped.startswith((b"<!doctype html", b"<html", b"<?xml")):
        raise ValueError("Received a page instead of an image or ZIP")
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        kind = "png"
    elif prefix.startswith((b"GIF87a", b"GIF89a")):
        kind = "gif"
    elif prefix.startswith(b"\xff\xd8\xff"):
        kind = "jpg"
    elif prefix.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        if not zipfile.is_zipfile(path):
            raise ValueError("The file has a ZIP signature but is not a valid ZIP archive")
        kind = "zip"
    else:
        raise ValueError("Unsupported file signature; expected PNG, GIF, JPEG, or ZIP")
    return {"downloadFormat": kind, "originalSha256": digest.hexdigest(),
            "originalBytes": path.stat().st_size}


def find_existing(root: Path, entry: dict) -> Path | None:
    if entry.get("originalPath"):
        path = original_path(root, entry["originalPath"])
        return path if path.exists() else None
    candidates = [original_path(root, f"assets/originals/{entry['id']}.{extension}")
                  for extension in SUPPORTED_EXTENSIONS]
    existing = [path for path in candidates if path.is_file()]
    if len(existing) > 1:
        raise ValueError("Multiple possible originals exist; set originalPath explicitly")
    return existing[0] if existing else None


def update_record(root: Path, entry: dict, path: Path, metadata: dict) -> None:
    entry.update(metadata)
    entry["originalPath"] = path.relative_to(root).as_posix()
    entry["status"] = "downloaded"
    entry["verifiedAt"] = timestamp()
    entry.pop("error", None)


def fetch_original(root: Path, entry: dict, opener, limiter: RateLimiter,
                   timeout: float, maximum_bytes: int) -> tuple[Path, dict]:
    url = validate_url(entry.get("downloadUrl"))
    directory = root / "assets" / "originals"
    directory.mkdir(parents=True, exist_ok=True)
    temporary = original_path(root, f"assets/originals/{entry['id']}.part")
    request = Request(url, headers={
        "User-Agent": "MinishCapStudioDownloader/1.0 (personal asset archive)",
        "Accept": "image/png,image/gif,image/jpeg,application/zip,application/octet-stream",
    })
    try:
        limiter.wait()
        with opener.open(request, timeout=timeout) as response:
            content_type = (response.headers.get("Content-Type") or "").lower()
            if "text/html" in content_type or "application/xhtml" in content_type:
                raise AccessBlocked("The download returned an HTML page. " + BLOCKED_MESSAGE)
            expected_size = response.headers.get("Content-Length")
            size = 0
            with temporary.open("wb") as stream:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > maximum_bytes:
                        raise ValueError("Download exceeds --max-file-mb; no original was saved")
                    stream.write(chunk)
            if expected_size and expected_size.isdecimal() and size != int(expected_size):
                raise ValueError("Incomplete download; Content-Length does not match the file")
        metadata = inspect_file(temporary)
        if entry.get("originalPath"):
            destination = original_path(root, entry["originalPath"])
        else:
            destination = original_path(root,
                f"assets/originals/{entry['id']}.{metadata['downloadFormat']}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        # A hard link publishes the completed file atomically without replacing
        # an original created during this request. Both paths share a filesystem.
        try:
            os.link(temporary, destination)
        except FileExistsError:
            return destination, inspect_file(destination)
        metadata["downloadedAt"] = timestamp()
        return destination, metadata
    except HTTPError as error:
        if error.code in (401, 403):
            raise AccessBlocked(f"HTTP {error.code}. " + BLOCKED_MESSAGE) from error
        if error.code == 429:
            delay = error.headers.get("Retry-After")
            detail = f" Retry-After: {delay}." if delay else ""
            raise AccessBlocked("HTTP 429: the source requested a pause." + detail +
                                " Rerun later; existing downloads are preserved.") from error
        raise
    finally:
        if temporary.exists():
            temporary.unlink()


def download_assets(root: Path, manifest_path: Path, *, timeout: float = 30,
                    maximum_bytes: int = 256 * 1024 * 1024, opener=None,
                    limiter=None) -> dict:
    root = root.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest.get("assets")
    if not isinstance(entries, list) or not entries:
        raise ValueError("The manifest must contain a nonempty assets list")
    ids = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Every manifest asset must be an object")
        asset_id = str(entry.get("id", ""))
        if not re.fullmatch(r"[A-Za-z0-9_-]+", asset_id):
            raise ValueError("Every asset needs a simple, nonempty id")
        entry["id"] = asset_id
        ids.append(asset_id)
        if entry.get("originalPath"):
            original_path(root, entry["originalPath"])
    if len(set(ids)) != len(ids):
        raise ValueError("The manifest contains duplicate asset IDs")
    limiter = limiter or RateLimiter()
    opener = opener or build_opener(PoliteRedirectHandler(limiter))
    counts = {"downloaded": 0, "existing": 0, "failed": 0, "blocked": 0}
    for number, entry in enumerate(entries, start=1):
        label = entry.get("name") or entry["id"]
        try:
            existing = find_existing(root, entry)
            if existing is not None:
                metadata = inspect_file(existing)
                recorded_hash = entry.get("originalSha256")
                if recorded_hash and metadata["originalSha256"] != recorded_hash:
                    raise ValueError("Existing original differs from its recorded checksum; "
                                     "inspect it before continuing")
                update_record(root, entry, existing, metadata)
                counts["existing"] += 1
                print(f"Checked {number}/{len(entries)}: {label}", flush=True)
            else:
                path, metadata = fetch_original(root, entry, opener, limiter,
                                                timeout, maximum_bytes)
                update_record(root, entry, path, metadata)
                counts["downloaded"] += 1
                print(f"Downloaded {number}/{len(entries)}: {label}", flush=True)
        except AccessBlocked as error:
            counts["blocked"] += 1
            entry.update({"status": "blocked", "error": str(error)})
            manifest["lastDownloadRun"] = {"at": timestamp(), **counts}
            save_manifest(manifest_path, manifest)
            print(f"Stopped at {label}: {error}", file=sys.stderr, flush=True)
            return counts
        except (OSError, ValueError, URLError) as error:
            counts["failed"] += 1
            entry.update({"status": "failed", "error": str(error)})
            print(f"Failed {label}: {error}", file=sys.stderr, flush=True)
        manifest["lastDownloadRun"] = {"at": timestamp(), **counts}
        save_manifest(manifest_path, manifest)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[1])
    parser.add_argument("--manifest", type=Path,
                        help="Defaults to ROOT/assets/source-manifest.json")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--max-file-mb", type=float, default=256)
    args = parser.parse_args()
    if args.timeout <= 0 or args.max_file_mb <= 0:
        parser.error("--timeout and --max-file-mb must be positive")
    root = args.root.resolve()
    manifest_path = args.manifest or root / "assets" / "source-manifest.json"
    try:
        counts = download_assets(root, manifest_path, timeout=args.timeout,
                                 maximum_bytes=int(args.max_file_mb * 1024 * 1024))
        print(json.dumps(counts), flush=True)
        raise SystemExit(2 if counts["blocked"] else 1 if counts["failed"] else 0)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error))


if __name__ == "__main__":
    main()
