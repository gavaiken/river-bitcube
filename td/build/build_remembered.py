# Build (or update) river-remembered.toe, "The remembered river" (docs/files/river-remembered.md, design and contracts
# docs/remembered-river.md). Idempotent; run with
#   .\tools\td.ps1 -File .\td\build\build_remembered.py -Timeout 120
# Only runs while TouchDesigner has river-remembered.toe open, and only in a copy of the baseline template (it needs the
# template's inputs, outputs, ropes and panels): open river-baseline-template.toe, .\tools\td_save.ps1 -Target
# river-remembered.toe, then run this.
#
#   /project1/inputs      the template's: river cam (recorded clip when stale) -> inputs/river. Unchanged.
#   /project1/remembered  THE SHOW. The brains are plain Python files in td/remembered/ (clock, palette, zones, ropes,
#                         panels, status, show), imported from the repo (sys.path), reloaded by this build:
#                           remembered_exec (Execute DAT, every frame) -> show.frame(): reads River\gallery_state\
#                             state.json + reflex.json, River\presence.json, River\remembered\control.json and
#                             data\remembered\ (fallback days); runs the loop; renders; writes River\remembered\status.json
#                           river_small (320x180 of inputs/river, read ~10 fps for the screens' moving highlights)
#                           rope_render (Script TOP, 20x400, LED 0 on top) -> rope_canvas -> /project1/ropes
#                           panel_render (Script TOP, 512x256: the four screens upright side by side) -> screen<k>_crop
#   /project1/outputs     the template's screens (td/build/screens.py, pinned screens file): screen<k>_src now takes
#                         remembered/screen<k>_crop instead of the camera-space field; the field's rope sampler is removed
#                         (the ropes come straight from rope_render, not through the pixel map).
#   /project1/ropes       Art-Net sender: Canvas = remembered/rope_canvas, brightness 1.0, 1,500 W/box, and artnet_out's
#                         1,400 W limit for both boxes (td/remembered/ropes.py keeps itself under 1,250 W).
#   /project1/panels      the HDMI window for the four HUB75 screens (unchanged).
import importlib
import sys

REPO = 'C:/Users/user/River/river-bitcube'
TOE = 'river-remembered.toe'
TD_DIR = REPO + '/td'
ROPE_BRIGHTNESS, ROPE_MAXBRIGHTNESS, ROPE_BOXWATTS = 1.0, 1.0, 1500
T = ' + 0 * absTime.frame'

if REPO + '/td/build' not in sys.path:
    sys.path.insert(0, REPO + '/td/build')
import registry
importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_remembered.py')    # never another show file
_cal = registry.calibration_for(TOE)
PIXELMAP, SCREENS = _cal['pixelmap'], _cal['screens']
ZONES = registry.zones_for(TOE)                                       # None: the show's built-in default zones
proj = op('/project1')
missing = [n for n in ('inputs', 'outputs', 'ropes', 'panels') if proj.op(n) is None]
if missing:
    raise RuntimeError(f'{TOE} must be a copy of river-baseline-template.toe (missing /project1/{", /project1/".join(missing)}): '
                       'open the template, td_save.ps1 -Target river-remembered.toe, then run this again')

# Reload the brains from the repo (a git pull then a rebuild picks up new code) and start the show fresh. They are the
# package td/remembered ("remembered"), imported with <repo>/td on sys.path.
if TD_DIR not in sys.path:
    sys.path.insert(0, TD_DIR)
for _m in ('palette', 'zones', 'clock', 'ropes', 'panels', 'status', 'show'):
    if 'remembered.' + _m in sys.modules:
        importlib.reload(sys.modules['remembered.' + _m])
from remembered import show as remembered_show                         # noqa: E402
remembered_show.reset()


def page(comp, name):
    for pg in comp.customPages:
        if pg.name == name:
            return pg
    return comp.appendCustomPage(name)


def res(o, w, h):
    o.par.outputresolution = 'custom'
    o.par.resolutionw, o.par.resolutionh = w, h


def maker(parent):
    def get(optype, name, x, y):
        o = parent.op(name) or parent.create(optype, name)
        o.nodeX, o.nodeY = x, y
        return o
    return get


def note(parent, text):
    t = parent.op('NOTE') or parent.create(textDAT, 'NOTE')
    t.text = text
    t.nodeX, t.nodeY = -300, 300
    t.viewer = True
    return t


# ==== /project1/remembered ===========================================================================================
rem = proj.op('remembered') or proj.create(baseCOMP, 'remembered')
rem.nodeX, rem.nodeY = 250, -250
rem.color = (0.1, 0.45, 0.55)
pg = page(rem, 'Remembered')
if not hasattr(rem.par, 'Seed'):
    p = pg.appendInt('Seed', label='Random seed (rope order, drips, foam)')[0]
    p.val, p.normMin, p.normMax = 0, 0, 99
if not hasattr(rem.par, 'Zonesfile'):
    pg.appendStr('Zonesfile', label='Calibration zones (from shows.json; empty = built-in defaults)')
rem.par.Zonesfile = ZONES or ''
note(rem, "THE REMEMBERED RIVER (built by td/build/build_remembered.py; docs/files/river-remembered.md)\n"
          "The logic is in the repo, td/remembered/*.py (not in this file): edit there, git pull, rebuild.\n"
          "remembered_exec -> show.frame(): inputs (state.json, reflex.json, presence.json, control.json, data/remembered),\n"
          "  loop clock, ropes, panels, River\\remembered\\status.json twice a second.\n"
          "rope_render (20x400) -> rope_canvas -> /project1/ropes.  panel_render (512x256) -> screen1..4_crop -> outputs.\n"
          "Status: from remembered import show; show.status()   (or read River\\remembered\\status.json)")
get = maker(rem)

sel = get(selectTOP, 'river_in', 0, 0)
sel.par.top = '/project1/inputs/river'
small = get(fitTOP, 'river_small', 150, 0)
small.inputConnectors[0].connect(sel)
small.par.fit = 'fill'
res(small, 320, 180)

cb = get(textDAT, 'render_callbacks', 0, -200)
cb.text = ("# Script TOP callbacks for the remembered river (generated by build_remembered.py).\n"
           "import sys\n"
           f"if '{TD_DIR}' not in sys.path:\n    sys.path.insert(0, '{TD_DIR}')\n"
           "from remembered import show\n\n"
           "def onSetupParameters(scriptOp):\n    return\n\n"
           "def onPulse(par):\n    return\n\n"
           "def onCook(scriptOp):\n"
           "    if scriptOp.name == 'rope_render':\n        show.cook_ropes(scriptOp)\n"
           "    else:\n        show.cook_panels(scriptOp)\n")
rr = get(scriptTOP, 'rope_render', 150, -200)
rr.par.callbacks = cb
rc = get(nullTOP, 'rope_canvas', 300, -200)
rc.inputConnectors[0].connect(rr)
rc.viewer = True
pr = get(scriptTOP, 'panel_render', 150, -350)
pr.par.callbacks = cb
crops = []
for k in range(1, 5):
    c = get(cropTOP, f'screen{k}_crop', 300, -350 - 100 * (k - 1))
    c.inputConnectors[0].connect(pr)
    c.par.cropleft, c.par.cropright = (k - 1) / 4, k / 4
    c.par.cropbottom, c.par.croptop = 0, 1
    crops.append(c)

ex = get(executeDAT, 'remembered_exec', 0, -500)
ex.text = ("# The remembered river, every frame (generated by build_remembered.py): inputs, loop, render, status.\n"
           "import sys\n"
           f"if '{TD_DIR}' not in sys.path:\n    sys.path.insert(0, '{TD_DIR}')\n"
           "from remembered import show\n\n"
           "def onFrameStart(frame):\n"
           "    show.frame(me.parent())\n"
           "    return\n")
ex.par.framestart = True
ex.par.active = True

# ==== outputs: our screens instead of the camera-space field; our rope canvas instead of the pixel map =================
out_c = proj.op('outputs')
for n in ('uv_table', 'uv_chop', 'sample_ropes', 'rope_rows', 'rope_flop', 'rope_canvas'):
    o = out_c.op(n)
    if o is not None:
        o.destroy()
rope_sel = out_c.op('rope_remembered') or out_c.create(selectTOP, 'rope_remembered')   # no wires across COMPs
rope_sel.par.top = rc.path
_g = dict(globals(), SCREENS_COMP=out_c, FIELD=out_c.op('field_out'), ROPE_CANVAS=rope_sel, SCREEN_PREFIX='screen',
          PINNED_SCREENS=SCREENS, get=maker(out_c))
exec(open(REPO + '/td/build/screens.py', encoding='utf-8').read(), _g)
for k, c in enumerate(crops, start=1):
    sw = out_c.op(f'screen{k}_src')
    assert sw is not None, f'outputs/screen{k}_src missing after screens.py'
    # a wire can't cross COMPs (remembered -> outputs): a Select TOP inside outputs brings each screen in
    sel = out_c.op(f'screen{k}_remembered') or out_c.create(selectTOP, f'screen{k}_remembered')
    sel.par.top = c.path
    sel.nodeX, sel.nodeY = sw.nodeX - 150, sw.nodeY + 40
    if sw.inputConnectors[0].connections[:1] != [sel.outputConnectors[0]]:
        sw.inputConnectors[0].connect(sel)
    assert sw.inputs and sw.inputs[0] == sel, f'outputs/screen{k}_src input 0 is not screen{k}_remembered'
out_c.par.Panelgain, out_c.par.Panelgamma = 1.0, 1.0               # the show caps its own screens at 55 %
note(out_c, "OUTPUTS (river-remembered.toe, built by td/build/build_remembered.py).\n"
            "ROPES: remembered/rope_canvas (20x400, straight from td/remembered/ropes.py) -> /project1/ropes.\n"
            "SCREENS: remembered/screen<k>_crop (128x256 upright, td/remembered/panels.py) -> screen<k>_src -> orientation\n"
            "  -> panels (td/build/screens.py, the pinned screens file only sets each screen's orientation here).\n"
            "screens_preview = ropes + the four screens upright, for td.ps1 -Screenshot.")

# ==== ropes ===========================================================================================================
ropes = proj.op('ropes')
ropes.par.Canvas = rc.path
ropes.par.Cropleft = ropes.par.Cropbottom = 0
ropes.par.Cropright = ropes.par.Croptop = 1
ropes.par.Brightness, ropes.par.Maxbrightness, ropes.par.Boxwatts = ROPE_BRIGHTNESS, ROPE_MAXBRIGHTNESS, ROPE_BOXWATTS
ropes.par.Source = 'canvas'
ropes.par.Active = True

# ==== README ==========================================================================================================
rd = proj.op('README') or proj.create(textDAT, 'README')
rd.viewer = True
rd.text = f"""THE REMEMBERED RIVER  (river-remembered.toe, built by td/build/build_remembered.py)

Dry Creek relives one remembered day every 5-minute loop: calm, building, the surge, settling.
Logic: td/remembered/*.py in the repo (docs/files/river-remembered.md; contracts docs/remembered-river.md).

inputs      -> river cam / recorded clip (the screens' moving highlights)
remembered  -> the show: loop clock, ropes (20x400), screens (4 x 128x256), status.json
outputs     -> screens.py orientation into the panels window; ropes -> Art-Net (1,400 W limit)

Calibration: {PIXELMAP.rsplit('/', 1)[-1]} (not used for the ropes: they are drawn rope by rope),
             {(SCREENS or 'no screens file').rsplit('/', 1)[-1]} (screen orientation), zones: {(ZONES or 'built-in defaults').rsplit('/', 1)[-1]}
Save only with tools/td_save.ps1.
"""

print('remembered built | zones', (ZONES or 'built-in defaults').rsplit('/', 1)[-1], '|', _g['SCREEN_INFO'],
      '| project1:', sorted(c.name for c in proj.children), '| errors:', proj.errors(recurse=True) or 'none')
