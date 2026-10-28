# Build (or update) river-filling.toe, "Fill my cup (configurable)" (docs/files/river-filling.md; td/filling/fill.py).
#   .\tools\td.ps1 -File .\td\build\build_filling.py -Timeout 120
# In a copy of the baseline template: open river-baseline-template.toe, .\tools\td_save.ps1 -Target river-filling.toe,
# then run this. The body is td/build/fill_common.py (shared with build_fill_simple.py).
#
#   /project1/filling   THE SHOW: filling_exec (every frame) -> fill.frame(): every rope LED and screen pixel painted by its
#                       real height (td/filling/space.py) -> rope_render (20x400) / panel_render (512x256) -> outputs, ropes
import importlib
import sys

REPO = 'C:/Users/user/River/river-bitcube'
TOE = 'river-filling.toe'
VARIANT = 'configurable'
BUILD = 'td/build/build_filling.py'
TD_DIR = REPO + '/td'
ROPE_BRIGHTNESS, ROPE_MAXBRIGHTNESS, ROPE_BOXWATTS = 1.0, 1.0, 1500

if REPO + '/td/build' not in sys.path:
    sys.path.insert(0, REPO + '/td/build')
import registry
importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_filling.py')       # never another show file
_cal = registry.calibration_for(TOE)
PIXELMAP, SCREENS = _cal['pixelmap'], _cal['screens']
ZONES = registry.zones_for(TOE)
exec(open(REPO + '/td/build/fill_common.py', encoding='utf-8').read())
