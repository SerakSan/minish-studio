#!/usr/bin/env python3
"""Give local scripts and styles content versions so updates cannot reuse stale art."""
import hashlib
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'


def replace(match):
    path = ROOT / match[2]
    if not path.is_file():
        raise SystemExit('Missing runtime file: ' + match[2])
    version = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    return match[1] + match[2] + '?v=4-' + version + '"'


source = INDEX.read_text()
updated = re.sub(r'((?:src|href)=")([^"?]+\.(?:js|css))(?:\?[^"\s]*)?"', replace, source)
if source != updated:
    INDEX.write_text(updated)
print('Runtime scripts and styles have content-based versions.')
