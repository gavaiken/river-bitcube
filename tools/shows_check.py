"""Checks the show registry (shows.json; docs/shows.md). Run by tools/check, locally and in CI.

    python tools/shows_check.py [--base <git ref>]

- schema: every field there, of the right type; kind show|template|viz; dates YYYY-MM-DD; file names unique
- files: every offered entry's .toe exists; every entry's build script and pinned calibration files exist
- description: at most 100 words
- boot_default: an offered entry
- freshness: when the changes since --base (default origin/main; plus the working tree) touch an entry's .toe or its build
  script, that entry's last_change must differ from the base's, and its updated date must not go backwards. A new entry passes.
  With no usable base (a fresh clone, a first push) the freshness check is skipped and says so.
Prints one line per problem; exit 1 if any.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
KINDS = ('show', 'template', 'viz')
ROLES = ('year', 'live')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MAX_WORDS = 100
REQUIRED_STR = ('file', 'title', 'kind', 'build', 'description', 'created_by', 'created', 'updated_by', 'updated', 'last_change')


def words(s):
    return len(str(s).split())


def check_registry(reg, repo=REPO):
    """Problems (strings) with a parsed shows.json, without git."""
    out = []
    if not isinstance(reg, dict) or not isinstance(reg.get('shows'), list):
        return ['shows.json: needs {"boot_default": ..., "shows": [...]}']
    seen = set()
    for i, s in enumerate(reg['shows']):
        where = f"shows[{i}]" + (f" ({s.get('file')})" if isinstance(s, dict) and s.get('file') else '')
        if not isinstance(s, dict):
            out.append(f'{where}: not an object')
            continue
        for k in REQUIRED_STR:
            if not isinstance(s.get(k), str) or not s[k].strip():
                out.append(f'{where}: {k} must be a non-empty string')
        for k in ('offered',):
            if not isinstance(s.get(k), bool):
                out.append(f'{where}: {k} must be true or false')
        f = s.get('file')
        if isinstance(f, str):
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*\.toe', f) or f.startswith('old-'):
                out.append(f'{where}: file must be a plain .toe name in the repo root (retired old-… files are not listed)')
            if f in seen:
                out.append(f'{where}: listed twice')
            seen.add(f)
            if s.get('offered') is True and not (repo / f).is_file():
                out.append(f'{where}: offered, but {f} is not in the repo (set offered false until it lands)')
        if s.get('kind') not in KINDS:
            out.append(f"{where}: kind must be one of {', '.join(KINDS)}")
        if 'role' in s and s['role'] not in ROLES:
            out.append(f"{where}: role, if given, is {' or '.join(ROLES)} (leave it out for a new viz)")
        if 'label' in s and (not isinstance(s['label'], str) or not s['label'].strip()):
            out.append(f'{where}: label, if given, is a non-empty string')
        for k in ('created', 'updated'):
            if isinstance(s.get(k), str) and not DATE.match(s[k]):
                out.append(f'{where}: {k} must be YYYY-MM-DD')
        if isinstance(s.get('created'), str) and isinstance(s.get('updated'), str) and s['updated'] < s['created']:
            out.append(f'{where}: updated is before created')
        if isinstance(s.get('description'), str) and words(s['description']) > MAX_WORDS:
            out.append(f"{where}: description is {words(s['description'])} words; at most {MAX_WORDS}")
        if not isinstance(s.get('inputs'), list) or not all(isinstance(x, str) and x.strip() for x in s['inputs']):
            out.append(f'{where}: inputs must be a list of short phrases')
        b = s.get('build')
        if isinstance(b, str) and b.strip():
            if not re.fullmatch(r'td/build/build_[\w-]+\.py', b):
                out.append(f'{where}: build must be td/build/build_<name>.py')
            elif not (repo / b).is_file():
                out.append(f'{where}: build script {b} is missing')
        cal = s.get('calibration')
        if not isinstance(cal, dict):
            out.append(f'{where}: calibration must be {{"pixelmap": ..., "screens": ...}}')
        else:
            for k, pat, required in (('pixelmap', r'tools/pixelmap/pixelmap-\d{4}-\d{2}-\d{2}\.json', True),
                                     ('screens', r'tools/pixelmap/screens-\d{4}-\d{2}-\d{2}\.json', False)):
                v = cal.get(k)
                if v is None and not required:
                    continue
                if not isinstance(v, str) or not re.fullmatch(pat, v):
                    out.append(f'{where}: calibration.{k} must be a dated file under tools/pixelmap/'
                               + ('' if required else ' (or null)'))
                elif not (repo / v).is_file():
                    out.append(f'{where}: calibration.{k} {v} is missing')
    bd = reg.get('boot_default')
    entry = next((s for s in reg['shows'] if isinstance(s, dict) and s.get('file') == bd), None)
    if not entry:
        out.append(f'boot_default {bd!r} is not a listed show')
    elif entry.get('offered') is not True:
        out.append(f'boot_default {bd} must be offered')
    return out


def git(*args):
    r = subprocess.run(['git', '-C', str(REPO), *args], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def changed_paths(base):
    """Paths changed since base (commits) plus the working tree (staged, unstaged, untracked), or None without a base."""
    if not base or re.fullmatch(r'0+', base) or git('rev-parse', '--verify', '--quiet', f'{base}^{{commit}}') is None:
        return None
    paths = set()
    for args in (('diff', '--name-only', f'{base}...HEAD'), ('diff', '--name-only', 'HEAD'),
                 ('ls-files', '--others', '--exclude-standard')):
        out = git(*args)
        if out is None and args[0] == 'diff' and '...' in args[2]:
            out = git('diff', '--name-only', base, 'HEAD')
        paths.update(p for p in (out or '').splitlines() if p)
    return paths


def check_freshness(reg, base_reg, changed):
    """Problems: an entry whose .toe or build script changed while its metadata didn't."""
    out = []
    before = {s.get('file'): s for s in (base_reg or {}).get('shows', []) if isinstance(s, dict)}
    for s in reg.get('shows', []):
        if not isinstance(s, dict):
            continue
        touched = [p for p in (s.get('file'), s.get('build')) if p and p in changed]
        if not touched or s.get('file') not in before:
            continue
        old = before[s['file']]
        why = ', '.join(touched)
        if s.get('last_change') == old.get('last_change'):
            out.append(f"{s['file']}: {why} changed, so update its shows.json entry: last_change (one line on what changed), "
                       f'updated (YYYY-MM-DD) and updated_by')
        elif str(s.get('updated', '')) < str(old.get('updated', '')):
            out.append(f"{s['file']}: updated went backwards ({old.get('updated')} -> {s.get('updated')})")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--base', default='origin/main', help='git ref the freshness check compares with (default origin/main)')
    a = ap.parse_args(argv)
    try:
        reg = json.loads((REPO / 'shows.json').read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'shows.json: {e}')
        return 1
    problems = check_registry(reg)
    changed = changed_paths(a.base)
    if changed is None:
        print(f'shows: freshness check skipped (no base {a.base!r} to compare with)')
    else:
        raw = git('show', f'{a.base}:shows.json')
        try:
            base_reg = json.loads(raw) if raw else None
        except ValueError:
            base_reg = None
        problems += check_freshness(reg, base_reg, changed)
    for p in problems:
        print(f'shows: {p}')
    if not problems:
        print(f"shows: ok ({len(reg['shows'])} entries)")
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
