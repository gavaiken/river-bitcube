# Build (or update) /project1/river_local: a rain/river field in camera space, sampled onto the ropes
# (via the camera pixel map) and HUB75 quad 1 (via its camera-space corners). Built-in TOPs only, no GLSL.
# Idempotent; run with  .\tools\td.ps1 -File .\td\build\build_river_local.py
# Pixel map: tools/pixelmap/pixelmap-2026-10-18.json (tools/pixelmap/capture.py + decode.py + hub75.py).
# The UVs are copied into a Table DAT inside the .toe, so the show file needs no outside input.
#
#   field (1280x720, camera frame) = river (noise -> level -> colour ramp) + rain (feedback streaks)
#   -> TOP to CHOP at 8000 UVs (rope-major) -> CHOP to TOP 400x20 -> flop -> 20x400 rope_canvas
#   -> /project1/ropes Canvas;  field -> Corner Pin (quad 1 corners) -> 256x128 -> /project1/panels Quad1
import json

REPO = 'C:/Users/user/River/river-bitcube'
PIXELMAP = REPO + '/tools/pixelmap/pixelmap-2026-10-18.json'
N_ROPES, N_PX = 20, 400
FIELD_W, FIELD_H = 1280, 720

proj = op('/project1')
rl = proj.op('river_local') or proj.create(baseCOMP, 'river_local')
rl.nodeX, rl.nodeY = 1325, -500
rl.color = (0.15, 0.4, 0.45)


def page(comp, name):
    for pg in comp.customPages:
        if pg.name == name:
            return pg
    return comp.appendCustomPage(name)


# Look parameters (tuned in B7). Added once; later builds keep live values but update the defaults,
# so  [setattr(p, 'val', p.default) for p in op('/project1/river_local').customPars]  resets the look.
LOOK = [  # name, label, default, min, max
    ('Gain', 'Overall Gain', 1.0, 0, 2),
    ('Riverlevel', 'River Level', 0.8, 0, 1),
    ('Flowspeed', 'River Flow Speed (width/s)', 0.012, 0, 0.1),
    ('Breatheperiod', 'Breathing Period (s)', 14.0, 2, 60),
    ('Breathedepth', 'Breathing Depth', 0.22, 0, 0.6),
    ('Rainlevel', 'Rain Level', 1.0, 0, 2),
    ('Rainspeed', 'Rain Speed (height/s)', 0.22, 0.02, 1),
    ('Raindensity', 'Rain Density', 0.06, 0, 0.6),
    ('Raindecay', 'Rain Trail Decay (per frame)', 0.9, 0.5, 0.99),
    ('Blur', 'Field Blur (px)', 6.0, 0, 30),
]
pg = page(rl, 'River')
for name, label, default, lo, hi in LOOK:
    if not hasattr(rl.par, name):
        p = pg.appendFloat(name, label=label)[0]
        p.val = default
    p = getattr(rl.par, name)
    p.normMin, p.normMax, p.default = lo, hi, default
if not hasattr(rl.par, 'Uvtest'):
    p = pg.appendToggle('Uvtest', label='UV Test Field (R=u, G=v)')[0]
    p.default = False
    p.val = False


def get(optype, name, x, y):
    o = rl.op(name) or rl.create(optype, name)
    o.nodeX, o.nodeY = x, y
    return o


def res(o, w, h, fmt=None):
    o.par.outputresolution = 'custom'
    o.par.resolutionw, o.par.resolutionh = w, h
    if fmt:
        o.par.format = fmt


def keys(name, rows, x, y):
    t = get(tableDAT, name, x, y)
    t.clear()
    t.appendRow(['pos', 'r', 'g', 'b', 'a'])
    for r in rows:
        t.appendRow(r)
    return t


def wire(dst, srcs):
    """Connect srcs to dst inputs 0..n. A multi-input TOP gains its next connector on a later frame,
    so whatever can't be wired yet is retried next frame (as in build_panels.py)."""
    for i, s in enumerate(srcs):
        if i < len(dst.inputConnectors):
            if dst.inputConnectors[i].connections[:1] != [s.outputConnectors[0]]:
                dst.inputConnectors[i].connect(s)
        else:
            run(lambda d=dst, ss=srcs: wire(d, ss), delayFrames=1)
            return


# ---- river: slow horizontal drift, breathing between blue/teal and white highlights -----------
nr = get(noiseTOP, 'noise_river', 0, 300)
res(nr, 640, 360)
nr.par.type = 'simplex3d'
nr.par.period = 1.1
nr.par.harmon = 2
nr.par.rough = 0.45
nr.par.amp, nr.par.offset = 0.5, 0.5
nr.par.mono = True
nr.par.sx, nr.par.sy = 0.45, 1.3         # small sx = long in x: stretched along the flow
nr.par.tx.expr = "-absTime.seconds * parent().par.Flowspeed * 0.45 / 1.1"
nr.par.tz.expr = "absTime.seconds * 0.025"

lr = get(levelTOP, 'level_river', 150, 300)
lr.inputConnectors[0].connect(nr)
lr.par.inlow, lr.par.inhigh = 0.5, 1.0            # more than half the area stays black
lr.par.brightness1.expr = ("1 + parent().par.Breathedepth * "
                           "math.sin(2 * math.pi * absTime.seconds / parent().par.Breatheperiod)")

keys('ramp_river_keys', [[0, 0, 0, 0, 1], [0.3, 0.0, 0.05, 0.3, 1], [0.62, 0.0, 0.42, 0.55, 1],
                         [0.86, 0.35, 0.8, 0.85, 1], [1.0, 1.0, 1.0, 1.0, 1]], 300, 450)
rr = get(rampTOP, 'ramp_river', 300, 450)
res(rr, 256, 4)
rr.par.type = 'horizontal'
rr.par.dat = 'ramp_river_keys'

lk = get(lookupTOP, 'lookup_river', 300, 300)
wire(lk, [lr, rr])
lk.par.channel = 'luminance'

lv = get(levelTOP, 'river', 450, 300)
lv.inputConnectors[0].connect(lk)
lv.par.brightness1.expr = 'parent().par.Riverlevel'

# ---- rain: thin vertical streak noise scrolling down, thresholded to sparse drops, ---------------
# ---- then a feedback loop (move down + fade) that gives each drop a trail -----------------------
for old in ('noise_seed', 'level_seed'):             # first version used per-frame random seeds
    if rl.op(old) is not None:
        rl.op(old).destroy()
if hasattr(rl.par, 'Rainrate'):
    rl.par.Rainrate.destroy()

ns = get(noiseTOP, 'rain_noise', 0, 0)
res(ns, 640, 360, 'rgba16float')
ns.par.type = 'simplex3d'
ns.par.period = 0.6
ns.par.harmon = 0
ns.par.amp, ns.par.offset = 0.5, 0.5
ns.par.mono = True
ns.par.sx, ns.par.sy = 4.5, 0.55                     # narrow in x, long in y: streaks
ns.par.ty.expr = "absTime.seconds * parent().par.Rainspeed * 0.55 / 0.6"
ns.par.tz.expr = "absTime.seconds * 0.35"            # drops form and dissolve as they fall
ls = get(levelTOP, 'rain_drops', 150, 0)
ls.inputConnectors[0].connect(ns)
ls.par.inlow.expr = '1 - parent().par.Raindensity'
ls.par.inhigh.expr = 'me.par.inlow + 0.1'
ls.par.clamp = True

seed_up = get(nullTOP, 'seed_up', 300, 0)
seed_up.inputConnectors[0].connect(ls)

fb = get(feedbackTOP, 'feedback_rain', 300, -150)
fb.inputConnectors[0].connect(seed_up)
fb.par.top = 'rain_sum'

mv = get(transformTOP, 'fall', 450, -150)
mv.inputConnectors[0].connect(fb)
mv.par.tunit = 'fraction'
mv.par.ty.expr = '-parent().par.Rainspeed / max(1, project.cookRate)'
mv.par.extend = 'zero'

dk = get(levelTOP, 'decay', 600, -150)
dk.inputConnectors[0].connect(mv)
dk.par.brightness1.expr = 'parent().par.Raindecay'

rs = get(compositeTOP, 'rain_sum', 750, -150)
wire(rs, [dk, seed_up])
rs.par.operand = 'add'
res(rs, 640, 360, 'rgba16float')

tint = get(constantTOP, 'rain_tint', 750, 0)
res(tint, 8, 8)
tint.par.colorr, tint.par.colorg, tint.par.colorb = 0.72, 0.88, 1.0
rain = get(compositeTOP, 'rain', 900, -150)
wire(rain, [rs, tint])
rain.par.operand = 'multiply'
rain.par.prefit = 'fill'
res(rain, 640, 360, 'rgba16float')
rl_ = get(levelTOP, 'rain_level', 1050, -150)
rl_.inputConnectors[0].connect(rain)
rl_.par.brightness1.expr = 'parent().par.Rainlevel'

# ---- field --------------------------------------------------------------------------------------
fld = get(compositeTOP, 'field_mix', 1200, 150)
wire(fld, [lv, rl_])
fld.par.operand = 'add'
fld.par.prefit = 'fill'
res(fld, FIELD_W, FIELD_H)

lo = get(levelTOP, 'field_gain', 1350, 150)
lo.inputConnectors[0].connect(fld)
lo.par.brightness1.expr = 'parent().par.Gain'
lo.par.clamp = True

bl = get(blurTOP, 'field_blur', 1500, 150)
bl.inputConnectors[0].connect(lo)
bl.par.size.expr = 'parent().par.Blur'
bl.par.extend = 'hold'

# UV test field: R = u, G = v, to check the sampling orientation end to end
keys('ramp_u_keys', [[0, 0, 0, 0, 1], [1, 1, 0, 0, 1]], 1350, 450)
keys('ramp_v_keys', [[0, 0, 0, 0, 1], [1, 0, 1, 0, 1]], 1500, 450)
ru = get(rampTOP, 'ramp_u', 1350, 350)
rv = get(rampTOP, 'ramp_v', 1500, 350)
for r, t, d in ((ru, 'horizontal', 'ramp_u_keys'), (rv, 'vertical', 'ramp_v_keys')):
    res(r, FIELD_W, FIELD_H, 'rgba32float')
    r.par.type = t
    r.par.dat = d
uvt = get(compositeTOP, 'uv_test', 1650, 350)
wire(uvt, [ru, rv])
uvt.par.operand = 'add'
res(uvt, FIELD_W, FIELD_H, 'rgba32float')

sw = get(switchTOP, 'field_select', 1800, 150)
wire(sw, [bl, uvt])
sw.par.index.expr = 'int(parent().par.Uvtest)'

out = get(nullTOP, 'field_out', 1950, 150)
out.inputConnectors[0].connect(sw)
out.viewer = True

# ---- pixel map -> UV table (stored in the .toe) ----------------------------------------------------
with open(PIXELMAP, encoding='utf-8') as f:
    pm = json.load(f)
uv = {(p['rope'], p['px']): (p['u'], p['v']) for p in pm['points']}
tab = get(tableDAT, 'uv_table', 1950, -150)
tab.clear()
tab.appendRow(['u', 'v'])
for r in range(N_ROPES):
    for px in range(N_PX):
        tab.appendRow(uv.get((r, px), (-1, -1)))      # unmapped ropes sample outside the field = black
tab.par.file = ''

dc = get(dattoCHOP, 'uv_chop', 2100, -150)
dc.par.dat = tab
dc.par.output = 'chanpercol'
dc.par.firstrow = 'names'
dc.par.firstcolumn = 'values'

tc = get(toptoCHOP, 'sample_ropes', 2250, -150)
tc.inputConnectors[0].connect(dc)
tc.par.top = out
tc.par.r, tc.par.g, tc.par.b, tc.par.a = 'r', 'g', 'b', ''
tc.par.uvunits = 'norm'
tc.par.interp = 'linear'
for side in ('imageleft', 'imageright', 'imagebottom', 'imagetop'):
    setattr(tc.par, side, 'default')
tc.par.defcolorr = tc.par.defcolorg = tc.par.defcolorb = tc.par.defcolora = 0

ct = get(choptoTOP, 'rope_rows', 2400, -150)
ct.par.chop = tc
ct.par.dataformat = 'rgb'
ct.par.layout = 'rowswrapped'
res(ct, N_PX, N_ROPES)           # x = px, y = rope (row 0 at the bottom = rope 0)

fl = get(flipTOP, 'rope_flop', 2550, -150)
fl.inputConnectors[0].connect(ct)
# transpose to x = rope (rope 0 left), px 0 on the top row, as artnet_out.canvas_frame expects.
# 'bottomleft' alone reverses both axes; the two flips undo that (checked by td/scripts/check_river_local.py).
fl.par.flop = 'bottomleft'
fl.par.flipx, fl.par.flipy = True, False

rc = get(nullTOP, 'rope_canvas', 2700, -150)
rc.inputConnectors[0].connect(fl)
rc.viewer = True

# ---- HUB75 quad 1: camera-space quad -> 256x128 --------------------------------------------------
q = pm['hub75_quad1']
cp = get(cornerpinTOP, 'quad1', 2100, 150)
cp.inputConnectors[0].connect(out)
res(cp, 256, 128)
for corner, key in (('tl', 'tl'), ('tr', 'tr'), ('bl', 'bl'), ('br', 'br')):
    getattr(cp.par, f'extract{corner}unit').val = 'fraction'
    getattr(cp.par, f'extract{corner}x').val = q[key][0]
    getattr(cp.par, f'extract{corner}y').val = q[key][1]
cp.par.extractmapping = 'perspective'
cp.par.extend = 'zero'

q1 = get(nullTOP, 'quad1_out', 2250, 150)
q1.inputConnectors[0].connect(cp)
q1.viewer = True
blk = get(constantTOP, 'quad_black', 2250, 300)
res(blk, 256, 128)
blk.par.colorr = blk.par.colorg = blk.par.colorb = 0

# ---- hook up the ropes and panels -------------------------------------------------------------------
ropes = proj.op('ropes')
ropes.par.Canvas = rc.path
ropes.par.Cropleft = ropes.par.Cropbottom = 0
ropes.par.Cropright = ropes.par.Croptop = 1

panels = proj.op('panels')
panels.par.Quad1 = q1.path
panels.par.Quad2 = blk.path
panels.par.Quad2off = True

# No web input in the local checkpoint: Andi's Web Render (Dave's canvas) is switched off.
web = proj.op('Mask_Panels/webrender1')
if web is not None:
    web.par.active = False

print('river_local built:', rl.path, '| uv rows:', tab.numRows - 1, '| mapped ropes:', sorted(int(k) + 1 for k in pm['ropes']),
      '| errors:', rl.errors(recurse=True) or 'none', '| warnings:', rl.warnings(recurse=True) or 'none')
