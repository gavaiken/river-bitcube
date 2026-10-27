# combined-v0 visual layer. Executed by build_combined_v0.py after the baseline inputs/outputs exist.
# Gavin's summer palette, natural tint, torrent and sun glints; Dave's canvas is added over the result.
# Uses established built-in TOPs only. Never rebuilds or modifies an original show.
# Match the recording pre-render's removal of the camera clock (top 6%) and label (bottom 5%).
# Crop only live river video; the recorded fallback is already cropped.
camcrop = maker(inp)(cropTOP, 'river_cam_crop', 225, 150)
camcrop.inputConnectors[0].connect(inp.op('river_cam'))
camcrop.par.croptop, camcrop.par.cropbottom = 0.94, 0.05
inp.op('river_cam_fit').inputConnectors[0].connect(camcrop)
get = maker(viz)
pg = page(viz, 'Combined')
for name, label, default, lo, hi in (
    ('Canvasmix', "Dave's overlay strength", 0.25, 0, 1),
    ('Intensity', 'Summer intensity', 0.85, 0, 1),
    ('Rivergain', 'River brightness', 1.0, 0, 3),
    ('Rivercontrast', 'River contrast', 1.6, 0.5, 4),
    ('Naturalmix', 'Natural river colour', 0.35, 0, 1),
    ('Overlay', 'Summer effects', 1.0, 0, 2),
    ('Blur', 'Field blur', 3.0, 0, 30),
):
    if not hasattr(viz.par, name):
        pg.appendFloat(name, label=label)[0].val = default
    p = getattr(viz.par, name)
    p.normMin, p.normMax, p.default = lo, hi, default
mod = get(textDAT, 'combined_mod', 0, 900)
mod.par.file = REPO + '/td/combined/runtime.py'
mod.par.syncfile = True
viz.par.Canvasmix = mod.module.load_strength()
M = "op('combined_mod').module"
I = f"{M}.intensity()"
T = ' + 0 * absTime.frame'
ex = get(executeDAT, 'combined_exec', 150, 900)
ex.text = "def onFrameStart(frame):\n    op('combined_mod').module.frame(me.parent())\n"
ex.par.framestart = True
ex.par.active = True

lv = get(levelTOP, 'river_level', 150, 450)
lv.inputConnectors[0].connect(viz.op('river_in'))
lv.par.brightness1.expr = 'parent().par.Rivergain'
lv.par.contrast.expr = 'parent().par.Rivercontrast'
lv.par.clamp = True
mono = get(monochromeTOP, 'river_mono', 300, 450)
mono.inputConnectors[0].connect(lv)
# Exact summer ramp from build_seasons_local.py, black at zero so dark water stays dark.
tab = get(tableDAT, 'palette_summer', 300, 250)
tab.clear()
tab.appendRow(['pos', 'r', 'g', 'b', 'a'])
for row in [[0,0,0,0,1], [0.3,0.05,0.12,0.25,1], [0.6,0.2,0.55,0.6,1],
            [0.82,1,0.8,0.35,1], [1,1,0.97,0.8,1]]:
    tab.appendRow(row)
ramp = get(rampTOP, 'summer_ramp', 450, 250)
ramp.par.type = 'horizontal'
ramp.par.dat = tab
res(ramp, 256, 4)
lk = get(lookupTOP, 'river_palette', 600, 450)
wire(lk, [mono, ramp])
lk.par.channel = 'luminance'
tint = get(constantTOP, 'summer_tint', 450, 650)
res(tint, 8, 8)
tint.par.colorr, tint.par.colorg, tint.par.colorb = 1.0, 0.9, 0.62
nat = get(compositeTOP, 'river_natural', 600, 650)
wire(nat, [lv, tint])
nat.par.operand = 'multiply'
nat.par.prefit = 'fill'
res(nat, FIELD_W, FIELD_H)
look = get(crossTOP, 'river_look', 750, 450)
wire(look, [lk, nat])
look.par.cross.expr = 'parent().par.Naturalmix'

def noise(name, x, y, period, sx, sy, tx='', ty='', tz='', fmt='rgba16float'):
    n = get(noiseTOP, name, x, y)
    res(n, 640, 360, fmt)
    n.par.type = 'simplex3d'
    n.par.period = period
    n.par.harmon = 0
    n.par.amp, n.par.offset = 0.5, 0.5
    n.par.mono = True
    n.par.sx, n.par.sy = sx, sy
    for p, e in (('tx', tx), ('ty', ty), ('tz', tz)):
        if e:
            getattr(n.par, p).expr = e
    return n


def threshold(name, src, x, y, inlow_expr):
    t = get(levelTOP, name, x, y)
    t.inputConnectors[0].connect(src)
    t.par.inlow.expr = inlow_expr
    t.par.inhigh.expr = 'min(1, me.par.inlow + 0.06)'
    t.par.clamp = True
    return t


def colour(name, x, y, exprs):
    c = get(constantTOP, name, x, y)
    res(c, 8, 8)
    for v, e in zip('rgb', exprs):
        getattr(c.par, f'color{v}').expr = e
    return c


def mult(name, a, b, x, y, w=FIELD_W, h=FIELD_H):
    m = get(compositeTOP, name, x, y)
    wire(m, [a, b])
    m.par.operand = 'multiply'
    m.par.prefit = 'fill'
    res(m, w, h, 'rgba16float')
    return m


def amount(name, src, x, y, expr):
    a = get(levelTOP, name, x, y)
    a.inputConnectors[0].connect(src)
    a.par.brightness1.expr = expr
    return a



# Summer torrent and sun glints: same equations and downward phase direction as Gavin's show.
tn = noise('torrent_noise', 0, -150, 0.5, 6, 0.35,
           ty=f"-{M}.ph('torrent'){T}", tz=f"{M}.ph('drift'){T}")
tt = threshold('torrent_streaks', tn, 150, -150, f"1 - (0.04 + 0.3 * {I}){T}")
tm = mult('torrent_foam', tt, mono, 300, -150)
tc = colour('torrent_tint', 300, -300, ['0.9', '0.85', '0.55'])
tcol = mult('torrent_col', tm, tc, 450, -150)
ta = amount('torrent', tcol, 600, -150, f"parent().par.Overlay * 1.6 * {I} ** 1.5{T}")
gn = noise('glint_noise', 0, -450, 0.04, 1, 1, tz=f"{M}.ph('glint'){T}")
gt = threshold('glint_points', gn, 150, -450, '0.9')
gm = mult('glint_water', gt, mono, 300, -450)
gc = colour('glint_tint', 300, -600, ['1.0', '0.85', '0.45'])
gcol = mult('glint_col', gm, gc, 450, -450)
ga = amount('glints', gcol, 600, -450, 'parent().par.Overlay * 0.9')
fld = get(compositeTOP, 'summer_mix', 900, 450)
wire(fld, [look, ta, ga])
fld.par.operand = 'add'
fld.par.prefit = 'fill'
res(fld, FIELD_W, FIELD_H)
fg = amount('summer_gain', fld, 1050, 450, f"0.7 + 0.45 * {I}{T}")
fg.par.clamp = True
bl = get(blurTOP, 'summer_blur', 1200, 450)
bl.inputConnectors[0].connect(fg)
bl.par.size.expr = 'parent().par.Blur'
bl.par.extend = 'hold'

# Same local canvas endpoint as the live-river show; no change to Dave's app or deployment.
cv = viz.op('modal_canvas')
if cv is None:
    cv = get(webrenderTOP, 'modal_canvas', 900, 0)
    cv.par.active = False
for p in cv.pars():
    if p.mode != ParMode.CONSTANT:
        p.bindExpr = ''
        p.mode = ParMode.CONSTANT
cv.par.url = 'http://127.0.0.1:8770/canvas.html?w=640&h=360'
res(cv, 640, 360)
cv.par.maxrenderrate = 30
cv.par.audio = 'off'
cvf = get(fitTOP, 'canvas_fit', 1050, 0)
cvf.inputConnectors[0].connect(cv)
cvf.par.fit = 'fill'
res(cvf, FIELD_W, FIELD_H)
cvg = amount('canvas_gain', cvf, 1200, 0, f"{M}.effective_strength(parent()){T}")
mix = get(compositeTOP, 'combined_mix', 1350, 450)
wire(mix, [bl, cvg])
mix.par.operand = 'add'
mix.par.prefit = 'fill'
res(mix, FIELD_W, FIELD_H)
clamp = get(levelTOP, 'combined_clamp', 1500, 450)
clamp.inputConnectors[0].connect(mix)
clamp.par.clamp = True
viz.op('viz_out').inputConnectors[0].connect(clamp)
run("op('/project1/viz/modal_canvas').par.active = True", delayFrames=60)
note(viz, "COMBINED V0: live river (recorded fallback), fixed summer, additive Modal canvas.\n"
          "Canvasmix: 0 = summer alone; 1 = full additive overlay, clamped before calibrated outputs.\n"
          "Mission control adjusts and saves Canvasmix in River/combined-v0.json.\n"
          "Gallery video is available at gallery_in but does not influence v0. No audio.\n"
          "Live footage runs at camera speed: seasonal playback-speed changes are deferred.")
rd.text = "COMBINED V0: inputs -> summer + additive Dave canvas -> calibrated outputs.\n" + viz.op('NOTE').text
print('combined-v0 visual built | fixed summer | additive overlay', float(viz.par.Canvasmix),
      '| errors:', viz.errors(recurse=True) or 'none')
