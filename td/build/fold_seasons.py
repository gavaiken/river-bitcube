# Fold the river's year into the playlist file (river-all-looks.toe): run build_seasons_local.py's network builder inside
# this file as /project1/seasons, with this file's pinned calibration. Idempotent. Then run build_all_looks.py again: it
# re-points the ropes and panels at the look switches (the seasons build points them at its own outputs) and wires the
# seasons COMP's rope_canvas and quad<k>_out into them. Only while TouchDesigner has river-all-looks.toe open.
#   .\tools\td.ps1 -File .\td\build\fold_seasons.py -Timeout 180
import importlib
import sys

REPO = 'C:/Users/user/River/river-bitcube'
if REPO + '/td/build' not in sys.path:
    sys.path.insert(0, REPO + '/td/build')
import registry
importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_all_looks.py')            # noqa: F821 - never another show file
src = open(REPO + '/td/build/build_seasons_local.py', encoding='utf-8').read()
a = "SHOW = registry.require_build(project.name, 'td/build/build_seasons_local.py')"
assert a in src, 'build_seasons_local.py changed: update fold_seasons.py'
src = src.replace(a, "SHOW = registry.entry('river-local-oct-22-seasons.toe')")   # the look's own entry, this file's pins
sz = op('/project1/seasons')                                                     # noqa: F821
try:
    exec(src, dict(globals()))
except Exception:
    if sz is None and op('/project1/seasons') is not None:                       # noqa: F821 - a half-built COMP: remove it
        op('/project1/seasons').destroy()                                        # noqa: F821
    raise
print('seasons folded in:', op('/project1/seasons').path, '| now run build_all_looks.py')   # noqa: F821
