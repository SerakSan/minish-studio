#!/usr/bin/env python3
"""Read-only loopback preview of the editor and its public art files."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
FILES = {"index.html", "studio.css", "studio.js", "library.js", "controls.js", "animation-engine.js", "simple-animation.js", "ezlo-switch.js", "ezlo-switch.css", "animation-export.js", "animation-ui.js", "animation.css", "maker.css", "random-scenes.js", "pwa.js", "service-worker.js", "manifest.webmanifest", "README.md", "CREDITS.md", "ASSET_RIGHTS.md", "PRIVACY.md", "PUBLISHING.md", "LICENSE", "assets/catalog.js", "assets/catalog.json", "assets/game-ui.js", "assets/pieces.js", "assets/pieces.json", "assets/full-bosses.js", "assets/full-bosses.json", "assets/sprites.js", "assets/legacy-bosses.js", "assets/curated.js", "assets/curated.json", "assets/logo.js", "assets/logo.json"}
PREFIXES = ("assets/sheets/", "assets/thumbnails/", "assets/ui/", "assets/pieces/", "assets/bosses/", "assets/sprites/", "assets/curated/", "icons/", "examples/")
ART_ROOTS = [ROOT, (ROOT / "assets/sheets").resolve(), (ROOT / "assets/thumbnails").resolve()]


class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        relative = unquote(urlparse(self.path).path).lstrip("/") or "index.html"
        path = (ROOT / relative).resolve()
        if ".." in Path(relative).parts or not any(path.is_relative_to(root) for root in ART_ROOTS) or not path.is_file():
            self.send_error(404)
            return None
        if relative not in FILES and not relative.startswith(PREFIXES):
            self.send_error(404)
            return None
        return super().send_head()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Preview)
    print("Minish Studio: http://127.0.0.1:8765", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
