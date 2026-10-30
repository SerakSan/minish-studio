#!/usr/bin/env python3
"""Build a portable, allowlisted GitHub repository or static Pages site."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CORE = [
    'index.html', 'studio.css', 'maker.css', 'studio.js', 'library.js', 'controls.js', 'animation-engine.js', 'simple-animation.js', 'animation-export.js', 'ezlo-switch.js', 'ezlo-switch.css', 'animation-ui.js', 'animation.css', 'animation-shell.html', 'animation-mode-switch.html', 'random-scenes.js', 'pwa.js',
    'service-worker.js', 'manifest.webmanifest', '.nojekyll', 'LICENSE',
    'README.md', 'GUIDE.md', 'START-HERE.txt', 'CREDITS.md', 'ASSET_RIGHTS.md', 'PRIVACY.md', 'PUBLISHING.md',
    'CHANGELOG.md', 'UX-NOTES.md', 'assets/catalog.js', 'assets/catalog.json',
    'assets/pieces.js', 'assets/pieces.json', 'assets/game-ui.js',
    'assets/full-bosses.js', 'assets/full-bosses.json', 'assets/legacy-bosses.js', 'assets/sprites.js', 'assets/sprites.json',
    'assets/curated.js', 'assets/curated.json', 'assets/logo.js', 'assets/logo.json',
    'assets/source-manifest.json', 'assets/source-credits.tsv', 'assets/verification-report.json',
    'examples/starter.js', 'examples/animation-demo.js', 'examples/minish-studio-name-preview.png', 'examples/Walking Adventure.minish-animation.json', 'examples/exports/Walking-Adventure.gif', 'examples/exports/Walking-Adventure.mp4', 'examples/exports/Walking-Adventure-frames.zip', 'examples/My Hyrule Story.minish.json', 'examples/Boss Showcase.minish.json',
]
ART_DIRS = ['assets/sheets', 'assets/thumbnails', 'assets/pieces', 'assets/ui',
            'assets/bosses', 'assets/sprites', 'assets/curated', 'icons']
REPO_FILES = ['.gitignore', 'requirements.txt', '.github/workflows/pages.yml']
REPO_DIRS = ['tools', 'tests', 'assets/originals']
SKIP = {'.DS_Store', '__pycache__', '.venv', '.git', '.versions', '_site', 'release'}
TEXT_EXTENSIONS = {'.html', '.js', '.mjs', '.css', '.json', '.md', '.txt', '.yml', '.yaml', '.py', '.tsv', '.svg', '.webmanifest'}


def archived_processing_output(relative):
    parts = relative.parts
    if parts[:2] != ('assets', 'sprites'):
        return False
    return len(parts) > 2 and (parts[2] in {'characters', 'enemies', 'bosses', 'objects', 'review'} or parts[2] in {'minish-maker-sprites.zip', 'minish-studio-sprites.zip'})


def source_files(site_only):
    files = {Path(name) for name in CORE}
    directories = list(ART_DIRS)
    if not site_only:
        files.update(Path(name) for name in REPO_FILES)
        directories += REPO_DIRS
    for directory in directories:
        base = ROOT / directory
        if not base.is_dir():
            raise ValueError('Missing release directory: ' + directory)
        for path in base.rglob('*'):
            relative = path.relative_to(ROOT)
            if path.is_file() and not set(relative.parts).intersection(SKIP) and not archived_processing_output(relative):
                files.add(relative)
    return sorted(files)


def check_private_paths(path):
    if path.suffix.lower() not in TEXT_EXTENSIONS:
        return
    content = path.read_text(encoding='utf-8')
    patterns = [
        r'/' + r'Users/[^/\s]+/',
        r'/' + r'home/[^/\s]+/',
        r'file:' + r'///',
        r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        r'gh[pousr]_[A-Za-z0-9]{30,}',
        r'github_pat_[A-Za-z0-9_]{30,}',
        r'sk-' + r'[A-Za-z0-9]{32,}',
    ]
    for pattern in patterns:
        if re.search(pattern, content):
            raise ValueError('Private local path or credential-like value in ' + str(path.relative_to(ROOT)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'release' / 'minish-studio-github')
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--site-only', action='store_true')
    args = parser.parse_args()
    destination = args.output.resolve()
    if destination == ROOT or ROOT.is_relative_to(destination):
        raise SystemExit('Choose a separate output folder.')
    if args.archive and args.archive.resolve().is_relative_to(destination):
        raise SystemExit('Choose an archive outside the output folder.')
    files = source_files(args.site_only)
    for relative in files:
        path = ROOT / relative
        if not path.is_file():
            raise SystemExit('Missing required release file: ' + str(relative))
        if path.stat().st_size >= 100 * 1024 * 1024:
            raise SystemExit('File exceeds GitHub size limit: ' + str(relative))
        check_private_paths(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # A temporary sibling prevents an interrupted build replacing a good release.
    temporary = Path(tempfile.mkdtemp(prefix='.minish-public-', dir=destination.parent))
    try:
        records = []
        for relative in files:
            source, target = ROOT / relative, temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            target.chmod(0o644)
            records.append({'path': relative.as_posix(), 'bytes': target.stat().st_size,
                            'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        report = {'version': '7.0.1', 'author': 'SerakSan', 'edition': 'site' if args.site_only else 'github',
                  'fileCount': len(records), 'bytes': sum(r['bytes'] for r in records),
                  'localPathsAndCredentialsCheck': 'passed', 'files': records}
        (temporary / 'release-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
        if destination.exists():
            marker = destination / 'release-manifest.json'
            if not marker.is_file():
                raise SystemExit('Refusing to replace an unrecognized output folder: ' + str(destination))
            shutil.rmtree(destination)
        temporary.replace(destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    if args.archive:
        args.archive.parent.mkdir(parents=True, exist_ok=True)
        archive_root = Path('Minish Studio' if args.site_only else 'minish-studio')
        with zipfile.ZipFile(args.archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(destination.rglob('*')):
                if path.is_file():
                    archive.write(path, (archive_root / path.relative_to(destination)).as_posix())
        with zipfile.ZipFile(args.archive) as archive:
            if archive.testzip() is not None:
                raise SystemExit('Release ZIP integrity failed.')
    print(json.dumps({k: report[k] for k in ['version', 'author', 'edition', 'fileCount', 'bytes', 'localPathsAndCredentialsCheck']}))
    print('Public release: ' + str(destination))
    if args.archive:
        print('Verified archive: ' + str(args.archive))


if __name__ == '__main__':
    main()
