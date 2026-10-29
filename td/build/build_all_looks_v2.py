# Build (or update) river-all-looks-v2.toe, The river: all looks v2 (the remembered river v2: people effects, the day's
# hours driving the knobs, overrides; docs/remembered-v2-plan.md). The same network as river-all-looks.toe
# (build_remembered.py, driven by the looks mixer), built from the LIVE checkout; river-all-looks.toe is the frozen
# rollback (built from River\river-bitcube-v1, docs/checkpoints.md "all-looks-v1-frozen").
#   .\tools\td.ps1 -File .\td\build\build_all_looks_v2.py -Timeout 120
import importlib
import sys

REPO = globals().get('REPO_OVERRIDE', 'C:/Users/user/River/river-bitcube')
TOE = 'river-all-looks-v2.toe'
if REPO + '/td/build' not in sys.path:
    sys.path.insert(0, REPO + '/td/build')
import registry
importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_all_looks_v2.py')      # never another show file
_cal = registry.calibration_for(TOE)
TOE_OVERRIDE, BUILD_OVERRIDE, DRIVER_OVERRIDE = TOE, 'td/build/build_all_looks_v2.py', 'looks'
exec(open(REPO + '/td/build/build_remembered.py', encoding='utf-8').read())
# The softer ribbon projection the artists approved for the all-looks files (update_all_looks_ribbons.py accepts both names).
exec(open(REPO + '/td/build/update_all_looks_ribbons.py', encoding='utf-8').read())
