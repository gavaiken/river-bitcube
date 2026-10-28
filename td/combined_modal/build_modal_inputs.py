# The Modal input selector's operators (docs/modal-inputs.md). Executed by td/build/build_combined_modal_inputs.py
# AFTER Combined v0's visual layer (td/combined/build_viz.py, with this show's runtime), with its globals:
# REPO, proj, inp, viz, out_c, get/maker, res, wire, page, note, FIELD_W, FIELD_H.
#   scene:   viz/scene_keys -> scene_ramp -> scene_palette (lookup of river_mono) -> scene_look (cross into summer_mix)
#            + Combined's torrent / glints / summer_gain / torrent_streaks expressions take the selector's factors
#   canvas:  viz/canvas_gain = the selector's canvas mix (Combined's additive overlay path)
#   frames:  viz/fr_<e>_target (Script TOP) x river ripple (fr_<e>_region -> fit -> mono -> luma (feedback smoothing)
#            -> mean) in fr_<e>_out (GLSL), then outputs/screen<k>_modal (into screen<k>_src) and outputs/rope_modal
#            (the ropes' canvas): the 20x400 picture goes straight to the ropes, bypassing the camera map.
import importlib
import json
import sys

for _m in ('selector', 'frames_journey'):
    if _m in sys.modules:
        importlib.reload(sys.modules[_m])
get = maker(viz)
MI = "op('/project1/viz/modal_inputs_mod').module"
I = "op('/project1/viz/combined_mod').module.intensity()"
T = ' + 0 * absTime.frame'

mi = viz.op('modal_inputs_mod')
if mi is not None:
    try:
        mi.module.stop_worker()                                   # a rebuild starts a fresh worker with fresh state
        sys.modules['combined_modal_inputs_live'].st = None
    except Exception:
        pass
mi = get(textDAT, 'modal_inputs_mod', 0, 1100)
mi.par.file = REPO + '/td/combined_modal/modal_inputs.py'
mi.par.syncfile = True
ex = get(executeDAT, 'modal_inputs_exec', 150, 1100)
ex.text = ("# Modal input selector (td/combined_modal/build_modal_inputs.py).\n"
           "TARGETS = ('fr_screen1_target', 'fr_screen2_target', 'fr_screen3_target', 'fr_screen4_target', 'fr_ropes_target')\n"
           "def onFrameStart(frame):\n"
           "    op('modal_inputs_mod').module.frame(me.parent())\n"
           "    for n in TARGETS:\n"
           "        t = op(n)\n"
           "        if t is not None:\n"
           "            t.cook(force=True)\n")
ex.par.framestart = True
ex.par.active = True

# ---- scene: palette gradient map + steering ----------------------------------------------------------------------
keys = get(tableDAT, 'scene_keys', 300, 1250)
if keys.numRows < 2:                                              # start on Combined's summer ramp until a scene arrives
    keys.clear()
    keys.appendRow(['pos', 'r', 'g', 'b', 'a'])
    for row in [[0, 0, 0, 0, 1], [0.3, 0.05, 0.12, 0.25, 1], [0.6, 0.2, 0.55, 0.6, 1], [0.82, 1, 0.8, 0.35, 1], [1, 1, 0.97, 0.8, 1]]:
        keys.appendRow(row)
sramp = get(rampTOP, 'scene_ramp', 450, 1250)
sramp.par.type = 'horizontal'
sramp.par.dat = keys
res(sramp, 256, 4)
slk = get(lookupTOP, 'scene_palette', 600, 1250)
wire(slk, [viz.op('river_mono'), sramp])
slk.par.channel = 'luminance'
slook = get(crossTOP, 'scene_look', 825, 600)
wire(slook, [viz.op('river_look'), slk])
res(slook, FIELD_W, FIELD_H)
slook.par.cross.expr = f"{MI}.scene_mix(){T}"
sm = viz.op('summer_mix')
if sm.inputConnectors[0].connections[:1] != [slook.outputConnectors[0]]:
    sm.inputConnectors[0].connect(slook)
viz.op('torrent').par.brightness1.expr = (f"parent().par.Overlay * 1.6 * {I} ** 1.5 * {MI}.factor('density')"
                                          f" * {MI}.factor('turbulence'){T}")
viz.op('glints').par.brightness1.expr = f"parent().par.Overlay * 0.9 * {MI}.factor('density'){T}"
viz.op('summer_gain').par.brightness1.expr = f"(0.7 + 0.45 * {I}) * {MI}.factor('brightness'){T}"
viz.op('torrent_streaks').par.inlow.expr = f"1 - min(0.9, (0.04 + 0.3 * {I}) * {MI}.factor('turbulence')){T}"

# ---- canvas: Combined's additive overlay, at the selector's canvas mix ----------------------------------------------
viz.op('canvas_gain').par.brightness1.expr = f"{MI}.canvas_mix(){T}"

# ---- frames: per-element targets x river ripple -----------------------------------------------------------------
with open(REPO + '/modal-frames/layout.json', encoding='utf-8') as f:
    LAYOUT = {e['id']: e for e in json.load(f)['elements']}
cb = get(textDAT, 'frames_target_callbacks', 1500, 1250)
cb.text = ("# Script TOP callbacks: Modal Frames targets (td/combined_modal/build_modal_inputs.py).\n"
           "def onSetupParameters(scriptOp):\n    return\n\n"
           "def onPulse(par):\n    return\n\n"
           "def onCook(scriptOp):\n"
           "    n = scriptOp.name[len('fr_'):-len('_target')]\n"
           "    op('modal_inputs_mod').module.target(scriptOp, 'ropes' if n == 'ropes' else 'screen-' + n[-1])\n")
pix = get(textDAT, 'frames_ripple_pixel', 1500, 1100)
pix.par.file = REPO + '/td/combined_modal/frames_ripple.glsl'
pix.par.syncfile = True
FR_OUTS = {}
for i, el in enumerate(('screen-1', 'screen-2', 'screen-3', 'screen-4', 'ropes')):
    n = el.replace('-', '')
    e = LAYOUT[el]
    w, h = e['width'], e['height']
    x, y, rw, rh = e['river_region']
    Y = 1100 - 160 * (i + 1)
    tgt = get(scriptTOP, f'fr_{n}_target', 1650, Y)
    tgt.par.callbacks = cb
    crop = get(cropTOP, f'fr_{n}_region', 1650, Y - 60)
    crop.inputConnectors[0].connect(viz.op('river_in'))
    crop.par.cropleft, crop.par.cropright = x, x + rw
    crop.par.cropbottom, crop.par.croptop = 1 - (y + rh), 1 - y    # river_region is top-left origin, TOPs bottom-up
    fit = get(fitTOP, f'fr_{n}_fit', 1800, Y - 60)
    fit.inputConnectors[0].connect(crop)
    fit.par.fit = 'fill'
    res(fit, w, h)
    mono = get(monochromeTOP, f'fr_{n}_mono', 1950, Y - 60)
    mono.inputConnectors[0].connect(fit)
    fb = get(feedbackTOP, f'fr_{n}_fb', 2100, Y - 100)
    fb.inputConnectors[0].connect(mono)
    luma = get(crossTOP, f'fr_{n}_luma', 2250, Y - 60)
    wire(luma, [fb, mono])
    res(luma, w, h, 'rgba16float')
    luma.par.cross.expr = f"{MI}.luma_alpha('{el}', max(1, project.cookRate)){T}"
    fb.par.top = luma.name
    mean = get(analyzeTOP, f'fr_{n}_mean', 2400, Y - 100)
    mean.inputConnectors[0].connect(luma)
    for _p, _v in (('op', 'average'), ('operation', 'average')):
        if hasattr(mean.par, _p) and _v in getattr(mean.par, _p).menuNames:
            setattr(mean.par, _p, _v)
    new_glsl = viz.op(f'fr_{n}_out') is None
    out = get(glslTOP, f'fr_{n}_out', 2550, Y)
    if new_glsl:
        out.bypass = True        # AGENTS.md: save before a new shader first cooks; then un-bypass (docs/files page)
    out.par.pixeldat = pix
    res(out, w, h)
    out.par.vec0name = 'uRipple'
    out.par.vec0valuex.expr = f"{MI}.ripple_k('{el}'){T}"
    wire(out, [tgt, luma, mean])
    out.viewer = True
    FR_OUTS[el] = out

# ---- outputs: frames into the four upright screen inputs and straight into the ropes ----------------------------
oget = maker(out_c)
for k in range(1, 5):
    sampler = out_c.op(f'screen{k}_pin') or out_c.op(f'screen{k}_fit')
    sw = out_c.op(f'screen{k}_src')
    assert sampler is not None and sw is not None, f'missing screen {k} sampler/switch'
    sel = oget(selectTOP, f'screen{k}_frames_in', 1975, 330 - 150 * (k - 1))
    sel.par.top = FR_OUTS[f'screen-{k}'].path
    mx = oget(crossTOP, f'screen{k}_modal', 2010, 270 - 150 * (k - 1))
    wire(mx, [sampler, sel])
    res(mx, 128, 256)
    mx.par.cross.expr = f"{MI}.element_mix('screen-{k}'){T}"
    if sw.inputConnectors[0].connections[:1] != [mx.outputConnectors[0]]:
        sw.inputConnectors[0].connect(mx)
rsel = oget(selectTOP, 'rope_frames_in', 1050, -320)
rsel.par.top = FR_OUTS['ropes'].path
rmx = oget(crossTOP, 'rope_modal', 1200, -250)
wire(rmx, [out_c.op('rope_canvas'), rsel])
res(rmx, 20, 400)
rmx.par.cross.expr = f"{MI}.element_mix('ropes'){T}"
rmx.viewer = True
proj.op('ropes').par.Canvas = rmx.path
pr = out_c.op('preview_ropes')
if pr is not None:
    pr.inputConnectors[0].connect(rmx)

note(out_c, "OUTPUTS (Combined with Modal Input Selector).\n"
            "ROPES: field_out -> pinned rope sampler -> rope_canvas -> rope_modal (x Modal Frames ropes 20x400, "
            "bypassing the map) -> /project1/ropes (caps unchanged).\n"
            "SCREENS: screen_field -> Combined screen looks -> pinned samplers -> screen<k>_modal (x Modal Frames "
            "screen-k, upright 128x256) -> screen<k>_src -> orientation -> panels.\n"
            "screens_preview shows ropes (after rope_modal) and the four screens upright.")
note(viz, "COMBINED WITH MODAL INPUT SELECTOR (river-combined-modal-inputs.toe).\n"
          "Combined v0's look (td/combined/build_viz.py) with this show's runtime (td/combined_modal/runtime.py) plus\n"
          "the Modal input selector (td/combined_modal/modal_inputs.py): one source of off / canvas / scene / frames,\n"
          "one strength 0-1, 4 s fades. River/combined-modal-inputs.json. docs/modal-inputs.md.\n"
          "Framing and screen looks follow Combined v0's River/combined-v0.json (read only).")
proj.op('README').text = ("COMBINED WITH MODAL INPUT SELECTOR (river-combined-modal-inputs.toe, "
                          "td/build/build_combined_modal_inputs.py)\n" + viz.op('NOTE').text)
print('modal inputs built | source', mi.module.selector.load(mi.module.SETTINGS),
      '| errors:', viz.errors(recurse=True) or 'none')
