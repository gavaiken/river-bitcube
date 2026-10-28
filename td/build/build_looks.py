# Build (or update) river-looks.toe, "The river (all looks)" (M8, docs/remembered-river.md; td/looks/mixer.py): the
# remembered river, Fill my cup (simple) and Fill my cup (configurable) in one show file, faded between (auto: four
# remembered loops, then one fill; manual: a chosen look). In a copy of the baseline template:
#   open river-baseline-template.toe, .\tools\td_save.ps1 -Target river-looks.toe, then
#   .\tools\td.ps1 -File .\td\build\build_looks.py -Timeout 120
# The network is the remembered river's (build_remembered.py builds it), driven by the looks mixer.
import importlib
import sys

REPO = 'C:/Users/user/River/river-bitcube'
TOE = 'river-looks.toe'
if REPO + '/td/build' not in sys.path:
    sys.path.insert(0, REPO + '/td/build')
import registry
importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_looks.py')         # never another show file
_cal = registry.calibration_for(TOE)
TOE_OVERRIDE, BUILD_OVERRIDE, DRIVER_OVERRIDE = TOE, 'td/build/build_looks.py', 'looks'
exec(open(REPO + '/td/build/build_remembered.py', encoding='utf-8').read())
