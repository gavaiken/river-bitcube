# Build (or update) river-two-looks.toe, The river (two looks): a frozen copy of river-looks.toe as it ran on 28 Oct (the remembered river and Fill my cup alternating).
#   .\tools\td.ps1 -File .\td\build\build_two_looks.py -Timeout 120
# The network is the remembered river's (build_remembered.py builds it), driven by the looks mixer (td/looks/mixer.py).
import importlib
import sys

REPO = globals().get('REPO_OVERRIDE', 'C:/Users/user/River/river-bitcube')   # a frozen show builds from its own pinned checkout
TOE = 'river-two-looks.toe'
if REPO + '/td/build' not in sys.path:
    sys.path.insert(0, REPO + '/td/build')
import registry
importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_two_looks.py')         # never another show file
_cal = registry.calibration_for(TOE)
TOE_OVERRIDE, BUILD_OVERRIDE, DRIVER_OVERRIDE = TOE, 'td/build/build_two_looks.py', 'looks'
exec(open(REPO + '/td/build/build_remembered.py', encoding='utf-8').read())
