# Build (or update) river-combined-v0.toe: the clean starting point for a new visualization
# (docs/files/river-baseline-template.md). Idempotent; run with
#   .\tools\td.ps1 -File .\td\build\build_combined_v0.py -Timeout 120
# Only runs while TouchDesigner has river-combined-v0.toe open. A new viz copies the template
# (td_save.ps1 -Target river-<name>.toe) and gets its OWN build script; it never runs this one.
#
#   /project1/inputs   river cam (live, td/cameras/river_cam.py relay), falling back to the recorded clip
#                      River\recordings\river\seasons\river-normal.mp4 while the cam is stale  -> inputs/river
#                      gallery cam (live, same relay)                                          -> inputs/gallery
#   /project1/viz      THE place to change: viz/river_in, viz/gallery_in -> ... -> viz/viz_out
#                      (the template just passes the river through)
#   /project1/outputs  viz_out -> 1280x720 field in gallery-camera space -> 20 ropes (per-LED sampling through the
#                      pinned pixel map) and the four HUB75 screens (td/build/screens.py). Don't touch.
#   /project1/ropes, /project1/panels   the shared Art-Net sender and HDMI panel window (build_ropes.py /
#                      build_panels.py; mission control finds them there). Don't touch.
import json
import os
import sys

REPO = 'C:/Users/user/River/river-bitcube'
TOE = 'river-combined-v0.toe'
CLIP = 'C:/Users/user/River/recordings/river/seasons/river-normal.mp4'
N_ROPES, N_PX = 20, 400
FIELD_W, FIELD_H = 1280, 720
# Rope power cap, the same as the show files (artnet_out uses min(Brightness, Maxbrightness); Boxwatts limits each box).
ROPE_BRIGHTNESS, ROPE_MAXBRIGHTNESS, ROPE_BOXWATTS = 1.0, 1.0, 1500

# Calibration is PINNED, never "newest file wins": a re-map must not silently change a show file. The pin, and which file
# this script builds, come from the show registry (shows.json, docs/shows.md; td/build/registry.py).
if REPO + '/td/build' not in sys.path:
    sys.path.insert(0, REPO + '/td/build')
import importlib
import registry
importlib.reload(registry)
registry.require_build(project.name, 'td/build/build_combined_v0.py')    # rebuilds the whole project: never another file
_cal = registry.calibration_for(project.name)
PIXELMAP, SCREENS, CAL_FROM = _cal['pixelmap'], _cal['screens'], 'shows.json'
proj = op('/project1')

# Avoid cooking partially rewired graphs on bitcube's Intel Vulkan driver.
_cooking_before_build = proj.allowCooking
proj.allowCooking = False
try:
    # ---- strip everything that isn't the template (the file starts as a Save As of a show file) ------------------------
    KEEP = {'inputs', 'viz', 'outputs', 'ropes', 'panels', 'README'}
    for o in list(proj.children):
        if not o.valid or o.name in KEEP:           # destroying one op can take another with it (dmxout1's table)
            continue
        try:
            if o.name == 'river_local':
                o.op('river_cam_mod').module.stop_all()
        except Exception:
            pass
        if o.name == 'seasons' and o.op('control_server') is not None:
            o.op('control_server').par.active = False
        if o.OPType == 'windowCOMP' and o.isOpen:
            o.par.winclose.pulse()
        o.destroy()


    def page(comp, name):
        for pg in comp.customPages:
            if pg.name == name:
                return pg
        return comp.appendCustomPage(name)


    def comp(name, x, y, colour):
        c = proj.op(name) or proj.create(baseCOMP, name)
        c.nodeX, c.nodeY = x, y
        c.color = colour
        return c


    def res(o, w, h, fmt=None):
        o.par.outputresolution = 'custom'
        o.par.resolutionw, o.par.resolutionh = w, h
        if fmt:
            o.par.format = fmt


    def wire(dst, srcs):
        """Connect srcs to dst inputs 0..n; a multi-input TOP gains its next connector on a later frame."""
        for i, s in enumerate(srcs):
            if i < len(dst.inputConnectors):
                if dst.inputConnectors[i].connections[:1] != [s.outputConnectors[0]]:
                    dst.inputConnectors[i].connect(s)
            else:
                run(lambda d=dst, ss=srcs: wire(d, ss), delayFrames=1)
                return


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


    T = ' + 0 * absTime.frame'          # module calls aren't tracked as dependencies: re-evaluate every frame

    # ==== inputs ==========================================================================================================
    inp = comp('inputs', 0, 0, (0.2, 0.5, 0.3))
    get = maker(inp)
    pg = page(inp, 'Inputs')
    if not hasattr(inp.par, 'Forceclip'):
        pg.appendToggle('Forceclip', label='Use the recorded clip even when the river cam is live (test the fallback)')[0].val = False
    if not hasattr(inp.par, 'Gallerycam'):
        pg.appendToggle('Gallerycam', label='Run the gallery cam (inputs/gallery)')[0].val = True
    note(inp, "INPUTS (built by td/build/build_combined_v0.py)\n"
              "river   = live river cam (640x360, ~10 fps) while it is fresh; the recorded clip\n"
              "          river-normal.mp4 (1280x720, looping) when no frame came for 10 s.\n"
              "gallery = live gallery cam (640x360), the room and the piece itself.\n"
              "Status:  op('river_cam_mod').module.status('river', 'sub')   (or 'gallery')\n"
              "Never add a Video Stream In TOP: cameras come only through river_cam.py.")

    cm = get(textDAT, 'river_cam_mod', 0, -300)
    cm.par.file = REPO + '/td/cameras/river_cam.py'
    cm.par.syncfile = True
    for cam, y in (('river', 150), ('gallery', -150)):
        cb = get(textDAT, f'{cam}_cam_callbacks', 0, y - 100)
        cb.text = (f"# Script TOP callbacks for the {cam} cam (generated by build_combined_v0.py).\n"
                   "def onSetupParameters(scriptOp):\n    return\n\n"
                   "def onPulse(par):\n    return\n\n"
                   f"def onCook(scriptOp):\n    op('river_cam_mod').module.cook(scriptOp, '{cam}', 'sub')\n")
        s = get(scriptTOP, f'{cam}_cam', 150, y)
        s.par.callbacks = cb
    cx = get(executeDAT, 'cams_exec', 150, -300)
    cx.text = ("# Cook the camera Script TOPs every frame (generated by build_combined_v0.py).\n"
               "def onFrameStart(frame):\n"
               "    op('river_cam').cook(force=True)\n"
               "    if parent().par.Gallerycam:\n"
               "        op('gallery_cam').cook(force=True)\n"
               "    return\n")
    cx.par.framestart = True
    cx.par.active = True

    clip = get(moviefileinTOP, 'river_clip', 150, 0)
    if clip.par.file.eval() != CLIP:
        clip.par.file = CLIP
    for p, v in (('play', True), ('hwdecode', False)):     # Iris Xe: no NVIDIA hardware decode
        if hasattr(clip.par, p):
            setattr(clip.par, p, v)
    if hasattr(clip.par, 'extendright') and 'loop' in clip.par.extendright.menuNames:
        clip.par.extendright = 'loop'
    if hasattr(clip.par, 'audio'):
        try:
            clip.par.audio = 'off'
        except Exception:
            pass

    camfit = get(fitTOP, 'river_cam_fit', 300, 150)
    camfit.inputConnectors[0].connect(get(scriptTOP, 'river_cam', 150, 150))
    camfit.par.fit = 'fill'
    res(camfit, FIELD_W, FIELD_H)
    clipfit = get(fitTOP, 'river_clip_fit', 300, 0)
    clipfit.inputConnectors[0].connect(clip)
    clipfit.par.fit = 'fill'
    res(clipfit, FIELD_W, FIELD_H)
    sw = get(switchTOP, 'river_select', 450, 75)
    wire(sw, [camfit, clipfit])
    # The online show file's staleness rule: river_cam.fresh() = a frame in the last 10 s (STALE_SECONDS).
    sw.par.index.expr = f"(1 if parent().par.Forceclip or not op('river_cam_mod').module.fresh('river', 'sub') else 0){T}"
    river = get(nullTOP, 'river', 600, 75)
    river.inputConnectors[0].connect(sw)
    river.viewer = True
    gfit = get(fitTOP, 'gallery_fit', 300, -150)
    gfit.inputConnectors[0].connect(get(scriptTOP, 'gallery_cam', 150, -150))
    gfit.par.fit = 'fill'
    res(gfit, FIELD_W, FIELD_H)
    gal = get(nullTOP, 'gallery', 600, -150)
    gal.inputConnectors[0].connect(gfit)
    gal.viewer = True

    # ==== viz =============================================================================================================
    viz = comp('viz', 250, 0, (0.75, 0.55, 0.15))
    get = maker(viz)
    note(viz, "VIZ: YOUR VISUAL GOES HERE.\n"
              "In:  river_in   (the river: live cam, or the recorded clip when the cam is down)\n"
              "     gallery_in (the gallery cam)\n"
              "Out: viz_out, any size; it is stretched to the 1280x720 field (16:9), which is laid\n"
              "     over the whole sculpture as the calibration's stitched map sees it (floor at the bottom,\n"
              "     rig at the top): a pixel lands on the rope/screen that hangs there. Not the gallery cam's\n"
              "     own picture: the map gives each LED's place in that too (hu, hv).\n"
              "The template wires river_in straight to viz_out. Replace what is between them.\n"
              "Brightness is limited downstream (ropes: 1,400 W for both boxes together), so you can't overload the power.")
    rin = get(selectTOP, 'river_in', 0, 0)
    rin.par.top = '/project1/inputs/river'
    gin = get(selectTOP, 'gallery_in', 0, -150)
    gin.par.top = '/project1/inputs/gallery'
    vout = viz.op('viz_out')
    if vout is None:                       # wired only the first time: a viz built on the template keeps its own wiring
        vout = get(nullTOP, 'viz_out', 300, 0)
        vout.inputConnectors[0].connect(rin)
    vout.viewer = True

    # ==== outputs =========================================================================================================
    out_c = comp('outputs', 500, 0, (0.45, 0.45, 0.5))
    get = maker(out_c)
    pg = page(out_c, 'Outputs')
    for name, label, default, lo, hi in (('Panelgain', 'HUB75 Gain', 1.0, 0, 4), ('Panelgamma', 'HUB75 Gamma', 1.0, 0.3, 1.5)):
        if not hasattr(out_c.par, name):
            p = pg.appendFloat(name, label=label)[0]
            p.val = default
        p = getattr(out_c.par, name)
        p.normMin, p.normMax, p.default = lo, hi, default
    note(out_c, "OUTPUTS: DON'T TOUCH (rebuilt by td/build/build_combined_v0.py).\n"
                "viz_out -> field_out (1280x720, the map's frame: the whole sculpture)\n"
                "  -> ropes: one sample per LED through the pinned pixel map -> rope_canvas (20x400) -> /project1/ropes\n"
                "  -> screens: the four HUB75 screens (td/build/screens.py) -> /project1/panels\n"
                "screens_preview = what TD sends (ropes + 4 screens), for td.ps1 -Screenshot.\n"
                f"Calibration: {PIXELMAP.rsplit('/', 1)[-1]}, {(SCREENS or 'no screens file').rsplit('/', 1)[-1]} ({CAL_FROM}).")
    vin = get(selectTOP, 'viz_in', 0, 0)
    vin.par.top = '/project1/viz/viz_out'
    fld = get(fitTOP, 'field', 150, 0)
    fld.inputConnectors[0].connect(vin)
    fld.par.fit = 'fill'
    res(fld, FIELD_W, FIELD_H)
    fout = get(nullTOP, 'field_out', 300, 0)
    fout.inputConnectors[0].connect(fld)
    fout.viewer = True

    with open(PIXELMAP, encoding='utf-8') as f:
        pm = json.load(f)
    uv = {(p['rope'], p['px']): (p['u'], p['v']) for p in pm['points']}
    if REPO + '/tools' not in sys.path:
        sys.path.insert(0, REPO + '/tools')
    from pixelmap.fill import fill_unmapped                   # noqa: E402
    uv, _borrowed = fill_unmapped(uv, N_ROPES, N_PX)
    tab = get(tableDAT, 'uv_table', 300, -200)
    tab.clear()
    tab.appendRow(['u', 'v'])
    for r in range(N_ROPES):
        for px in range(N_PX):
            tab.appendRow(uv.get((r, px), (-1, -1)))          # (-1, -1): outside the field = black
    tab.par.file = ''
    dc = get(dattoCHOP, 'uv_chop', 450, -200)
    dc.par.dat = tab
    dc.par.output = 'chanpercol'
    dc.par.firstrow = 'names'
    dc.par.firstcolumn = 'values'
    tc = get(toptoCHOP, 'sample_ropes', 600, -200)
    tc.inputConnectors[0].connect(dc)
    tc.par.top = fout
    tc.par.r, tc.par.g, tc.par.b, tc.par.a = 'r', 'g', 'b', ''
    tc.par.uvunits = 'norm'
    tc.par.interp = 'linear'
    for side in ('imageleft', 'imageright', 'imagebottom', 'imagetop'):
        setattr(tc.par, side, 'default')
    tc.par.defcolorr = tc.par.defcolorg = tc.par.defcolorb = tc.par.defcolora = 0
    ct = get(choptoTOP, 'rope_rows', 750, -200)
    ct.par.chop = tc
    ct.par.dataformat = 'rgb'
    ct.par.layout = 'rowswrapped'
    res(ct, N_PX, N_ROPES)
    fl = get(flipTOP, 'rope_flop', 900, -200)
    fl.inputConnectors[0].connect(ct)
    fl.par.flop = 'bottomleft'                                # x = rope (0 left), px 0 on the top row (artnet_out)
    fl.par.flipx, fl.par.flipy = True, False
    rcv = get(nullTOP, 'rope_canvas', 1050, -200)
    rcv.inputConnectors[0].connect(fl)
    rcv.viewer = True

    ropes = proj.op('ropes')
    if ropes is None:
        exec(open(REPO + '/td/build/build_ropes.py', encoding='utf-8').read(), dict(globals()))
        ropes = proj.op('ropes')
    ropes.nodeX, ropes.nodeY = 750, 100
    ropes.par.Canvas = rcv.path
    ropes.par.Cropleft = ropes.par.Cropbottom = 0
    ropes.par.Cropright = ropes.par.Croptop = 1
    ropes.par.Brightness, ropes.par.Maxbrightness, ropes.par.Boxwatts = ROPE_BRIGHTNESS, ROPE_MAXBRIGHTNESS, ROPE_BOXWATTS
    ropes.par.Source = 'canvas'
    ropes.par.Active = True

    _g = dict(globals(), SCREENS_COMP=out_c, FIELD=fout, ROPE_CANVAS=rcv, SCREEN_PREFIX='screen', PINNED_SCREENS=SCREENS)
    exec(open(REPO + '/td/build/screens.py', encoding='utf-8').read(), _g)
    panels = proj.op('panels')
    panels.nodeX, panels.nodeY = 750, -100

    # ==== README ==========================================================================================================
    rd = proj.op('README') or proj.create(textDAT, 'README')
    rd.nodeX, rd.nodeY = 0, 250
    rd.viewer = True
    rd.text = f"""COMBINED V0: LIVE SUMMER + MODAL OVERLAY  (river-combined-v0.toe, built by td/build/build_combined_v0.py)

    inputs  ->  viz  ->  outputs  ->  ropes + panels

    inputs/   river   = the live river cam, or the recorded clip (river-normal.mp4) when the cam is stale (10 s)
              gallery = the live gallery cam
    viz/      YOUR VISUAL. river_in, gallery_in  ->  ...  ->  viz_out. The template passes the river through.
    outputs/  don't touch: viz_out -> 1280x720 field -> 20 ropes (pixel map) + 4 HUB75 screens
    ropes, panels   don't touch: Art-Net sender (brightness cap 0.4, 600 W/box) and the HDMI panel window

    Start a new viz (docs/files/river-baseline-template.md):
      1. Open the template, then  .\\tools\\td_save.ps1 -Target river-<name>.toe
      2. Add a shows.json entry for river-<name>.toe (with its pinned calibration)
      3. Write td/build/build_<name>.py that only touches /project1/viz and refuses to run in any other file
    Save only with tools/td_save.ps1. Cameras only via river_cam.py (never a Video Stream In TOP).
    Calibration in this file: {PIXELMAP.rsplit('/', 1)[-1]}, {(SCREENS or 'no screens file').rsplit('/', 1)[-1]} ({CAL_FROM}).
    """

    print('baseline built | calibration', PIXELMAP.rsplit('/', 1)[-1], (SCREENS or 'no screens file').rsplit('/', 1)[-1], f'({CAL_FROM})', '|',
          _g['SCREEN_INFO'], '| project1:', sorted(c.name for c in proj.children),
          '| errors:', proj.errors(recurse=True) or 'none')

    # Own visual layer; shared calibrated outputs above retain the baseline structure and power caps.
    exec(open(REPO + '/td/combined/build_viz.py', encoding='utf-8').read(), dict(globals()))
finally:
    proj.allowCooking = _cooking_before_build
