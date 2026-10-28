"""Per-show recorded-footage preference, with the untouched original library as fallback.

River/remembered/video-library.json:
{"shows": {"river-all-looks.toe": {"directory": "remembered-30fps-20261028", "files": ["a.mp4", "b.mp4"]}}}
Directory and files are plain names under River/recordings/river. Read only on project initialization.
"""
import json
from pathlib import Path


def clips_for(river, show):
    river = Path(river)
    base = river / 'recordings' / 'river'
    fallback = sorted(str(p).replace('\\', '/') for p in (base / 'remembered').glob('*.mp4'))
    try:
        config = json.loads((river / 'remembered' / 'video-library.json').read_text(encoding='utf-8-sig'))
        entry = config['shows'][show]
        directory, files = entry['directory'], entry['files']
        def plain(value):
            return isinstance(value, str) and value not in ('', '.', '..') and not any(c in value for c in '/\\:')
        if not plain(directory) or not isinstance(files, list) or not files or len(files) > 12:
            return fallback
        if len(set(files)) != len(files) or not all(plain(n) and n.lower().endswith('.mp4') for n in files):
            return fallback
        paths = [base / directory / n for n in files]
        if not all(p.is_file() and p.stat().st_size > 0 for p in paths):
            return fallback
        return [str(p).replace('\\', '/') for p in paths]
    except (OSError, ValueError, KeyError, TypeError):
        return fallback
