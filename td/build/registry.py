# The show registry (shows.json at the repo root; docs/shows.md): which show files exist, which mission control offers,
# which may boot, and the calibration each one pins. Build scripts use it instead of guessing from file names or taking the
# newest dated map:
#
#   import sys; sys.path.insert(0, REPO + '/td/build'); import registry
#   show = registry.require_build(project.name, 'td/build/build_<name>.py')   # refuses a file this script doesn't build
#   cal = registry.calibration_for(project.name)    # {'pixelmap': '<abs path>', 'screens': '<abs path>' | None}
#
# Plain Python (no TouchDesigner imports), so tools/tests and tools/check use it too. shows.json is read on every call, so a
# pulled change is seen without reloading this module.
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
KINDS = ('show', 'template', 'viz')


class RegistryError(RuntimeError):
    pass


def load(repo=None):
    """shows.json as a dict."""
    path = Path(repo or REPO) / 'shows.json'
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        raise RegistryError(f'no show registry at {path}') from None
    except ValueError as e:
        raise RegistryError(f'{path} is not valid JSON: {e}') from None


def _name(toe_name):
    """'river-x.toe', a path to it, or TouchDesigner's project.name -> 'river-x.toe'."""
    n = str(toe_name).replace('\\', '/').rsplit('/', 1)[-1]
    return n if n.lower().endswith('.toe') else n + '.toe'


def entry(toe_name, repo=None):
    """The registry entry for a show file. RegistryError if it isn't listed."""
    name = _name(toe_name)
    for s in load(repo).get('shows', []):
        if s.get('file') == name:
            return s
    raise RegistryError(f'{name} is not in shows.json: add an entry for it (docs/shows.md) before building or calibrating it')


def calibration_for(toe_name, repo=None):
    """The calibration a show file pins, as absolute paths with forward slashes (TouchDesigner-friendly):
    {'pixelmap': path, 'screens': path or None}. RegistryError when the entry, its pin, or a pinned file is missing.
    Never falls back to the newest dated file: a new calibration is used only once a show pins it."""
    repo = Path(repo or REPO)
    s = entry(toe_name, repo)
    cal = s.get('calibration') or {}
    out = {}
    for key, required in (('pixelmap', True), ('screens', False)):
        rel = cal.get(key)
        if not rel:
            if required:
                raise RegistryError(f"{s['file']} pins no {key} in shows.json (calibration.{key})")
            out[key] = None
            continue
        p = repo / rel
        if not p.is_file():
            raise RegistryError(f"{s['file']} pins {rel} (calibration.{key} in shows.json), but that file is missing")
        out[key] = str(p).replace('\\', '/')
    return out


def require_build(toe_name, script, repo=None):
    """Refuse (RegistryError) unless shows.json says `script` (repo-relative, e.g. 'td/build/build_river_local.py') builds
    this show file. Returns the entry."""
    s = entry(toe_name, repo)
    want = str(script).replace('\\', '/')
    if s.get('build') != want:
        raise RegistryError(f"{want} doesn't build {s['file']} (shows.json says its build script is {s.get('build')!r}); "
                            f'open the show file this script builds')
    return s


def offered(repo=None):
    """Show files mission control may switch to, in registry order."""
    return [s['file'] for s in load(repo).get('shows', []) if s.get('offered')]


def bootable(repo=None):
    """Show files that may be the boot file: offered and can_boot."""
    return [s['file'] for s in load(repo).get('shows', []) if s.get('offered') and s.get('can_boot')]
