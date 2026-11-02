"""Public packages must leave personal project exports out of art directories too."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('public_builder', ROOT / 'tools/build_public_release.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PublicProjectPrivacy(unittest.TestCase):
    def test_personal_exports_are_never_discovered_in_art_folders(self):
        with tempfile.TemporaryDirectory(prefix='minish-public-privacy-') as directory:
            root = Path(directory)
            for folder in set(builder.ART_DIRS + builder.REPO_DIRS):
                (root / folder).mkdir(parents=True, exist_ok=True)
            for name in builder.CORE + builder.REPO_FILES:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('{}')
            private = [
                ('My private scene.minish.json', {'format': 'minish-cap-studio'}),
                ('My private animation.minish-animation.json', {'format': 'minish-cap-animation'}),
                ('A private import.json', {'format': 'minish-cap-studio'}),
                ('assets/curated/private scene.minish.json', {'format': 'minish-cap-studio'}),
                ('assets/sprites/private animation.minish-animation.json', {'format': 'minish-cap-animation'}),
                ('assets/bosses/saved-story.json', {'format': 'minish-cap-studio'}),
                ('assets/pieces/clip.json', {'format': 'minish-cap-animation'}),
            ]
            for name, data in private:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps({**data, 'name': 'Personal test project'}))
            provenance = root / 'assets/curated/provenance.json'
            provenance.write_text(json.dumps({'format': 'PNG', 'source': 'Public artwork source'}))
            legacy = root / 'tests/fixtures/legacy-project.json'
            legacy.parent.mkdir(parents=True, exist_ok=True)
            legacy.write_text(json.dumps({'format': 'minish-cap-studio', 'name': 'Public compatibility fixture'}))
            original_root = builder.ROOT
            try:
                builder.ROOT = root
                for site_only in [False, True]:
                    selected = {path.as_posix() for path in builder.source_files(site_only)}
                    for name, _ in private:
                        self.assertFalse(name in selected, f'Personal export included in site_only={site_only}: {name}')
                    self.assertIn('assets/curated/provenance.json', selected)
                    if not site_only:
                        self.assertIn('tests/fixtures/legacy-project.json', selected)
                    for name in [
                        'examples/My Hyrule Story.minish.json',
                        'examples/Boss Showcase.minish.json',
                        'examples/Walking Adventure.minish-animation.json',
                    ]:
                        self.assertIn(name, selected, 'The explicitly bundled public examples stay available')
            finally:
                builder.ROOT = original_root


if __name__ == '__main__':
    unittest.main()
