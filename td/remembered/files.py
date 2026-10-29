"""The files the remembered river and the looks mixer read, read the same way everywhere: one JSON reader, one cache that
re-parses a file only when it changed (stat is cheap; parsing state.json, presence.json and control.json several times a
second was not), and the shared paths and freshness limits. Plain Python.

  read_json(path)          parsed JSON, or None (missing, unreadable, malformed)
  read_json_cached(path)   (parsed JSON or None, mtime or None); the same object back while the file's stat
                           (mtime_ns, size, inode) is unchanged, so callers must treat it as read-only (copy before
                           changing it)
"""
import json
import os
from pathlib import Path

RIVER = Path(r'C:\Users\user\River')
RIVER_STALE_S = 10.0                # no river frame for this long: the river is gone (status 'none')
PRESENCE_STALE_S = 30.0             # presence.json older than this: the counter isn't running

_cache = {}                         # str(path) -> (stat signature, data, mtime)


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None


def read_json_cached(path):
    key = os.fspath(path)
    try:
        st = os.stat(key)
    except OSError:
        _cache.pop(key, None)
        return None, None
    sig = (st.st_mtime_ns, st.st_size, st.st_ino)
    hit = _cache.get(key)
    if hit is not None and hit[0] == sig:
        return hit[1], hit[2]
    data = read_json(key)
    _cache[key] = (sig, data, st.st_mtime)
    return data, st.st_mtime


def clear_cache():
    _cache.clear()
