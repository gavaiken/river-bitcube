# Build (or update) river-all-looks.toe, The river (all looks): every look in one file with a configurable playlist (td/looks/mixer.py, docs/all-looks.md).
#   .\tools\td.ps1 -File .\td\build\build_all_looks.py -Timeout 120
# The network is the remembered river's (build_remembered.py builds it), driven by the looks mixer (td/looks/mixer.py).
import importlib
import sys

REPO = 'C:/Users/user/River/river-bitcube'
TOE = 'river-all-looks.toe'
if REPO + '/td/build' not in sys.path:
    sys.path.insert(0, REPO + '/td/build')
import registry
importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_all_looks.py')         # never another show file
_cal = registry.calibration_for(TOE)
TOE_OVERRIDE, BUILD_OVERRIDE, DRIVER_OVERRIDE = TOE, 'td/build/build_all_looks.py', 'looks'
exec(open(REPO + '/td/build/build_remembered.py', encoding='utf-8').read())
