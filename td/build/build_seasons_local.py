# Build (or update) river-local-oct-22-seasons.toe: the river's year, local-only (see GLOSSARY.md and
# docs/files/river-local-oct-22-seasons.md). Idempotent; run with
#   .\tools\td.ps1 -File .\td\build\build_seasons_local.py
# The file is made once from the online show file with   td_save.ps1 -Target river-local-oct-22-seasons.toe
# and this script then removes the online parts and builds /project1/seasons. Built-in TOPs only, no GLSL
# (apart from the shared panel layout shader).
#
#   river library (3 pre-rendered speeds of the same clip, tools/seasons/prerender.py)
#     -> crossfaded by intensity (slow = winter stillness ... fast = summer torrent)
#     -> graded: luminance through the seasons' blended palette, plus a little natural colour, tinted
#     -> overlays: torrent streaks on bright water, glints (ice / sun), autumn leaves, spring rain
#     -> field_out 1280x720 (camera space) -> ropes via the camera pixel map, HUB75 quads 1-4
#   seasons_engine (td/seasons/seasons.py) + seasons_mod (td/seasons/seasons_td.py): the year, the rules,
#   presence, and the control page on port 9981.
import glob
import json
import sys

REPO = 'C:/Users/user/River/river-bitcube'
LIB = 'C:/Users/user/River/recordings/river/seasons'
PIXELMAP = sorted(glob.glob(REPO + '/tools/pixelmap/pixelmap-????-??-??.json'))[-1].replace('\\', '/')
N_ROPES, N_PX = 20, 400
FIELD_W, FIELD_H = 1280, 720
PORT = 9981

if 'seasons' not in project.name:
    raise RuntimeError(f'build_seasons_local.py rebuilds the whole show; open river-local-oct-22-seasons.toe first '
                       f'(TD has {project.name} open).')

proj = op('/project1')

# ---- remove the online show's parts (this file is local-only) -----------------------------------------
old = proj.op('river_local')
if old is not None:
    try:
        old.op('river_cam_mod').module.stop_all()     # its camera relay would otherwise run until TD exits
    except Exception:
        pass
    old.destroy()
for name in ('preview_window', 'preview'):
    o = proj.op(name)
    if o is not None:
        if name == 'preview_window' and o.isOpen:
            o.par.winclose.pulse()
        o.destroy()
web = proj.op('Mask_Panels/webrender1')
if web is not None:
    web.par.active = False

sz = proj.op('seasons') or proj.create(baseCOMP, 'seasons')
sz.nodeX, sz.nodeY = 1325, -500
sz.color = (0.3, 0.45, 0.25)


def page(comp, name):
    for pg in comp.customPages:
        if pg.name == name:
            return pg
    return comp.appendCustomPage(name)


LOOK = [  # name, label, default, min, max
    ('Gain', 'Overall Gain', 1.0, 0, 2),
    ('Rivergain', 'River Brightness', 1.0, 0, 3),
    ('Rivercontrast', 'River Contrast (dark water to black)', 1.6, 0.5, 4),
    ('Naturalmix', 'Natural Colour (0 = season palette, 1 = tinted natural)', 0.35, 0, 1),
    ('Overlay', 'Overlays (torrent, glints, leaves, rain)', 1.0, 0, 2),
    ('Blur', 'Field Blur (px)', 3.0, 0, 30),
    ('Panelgain', 'HUB75 Gain', 1.0, 0, 4),
    ('Panelgamma', 'HUB75 Gamma', 1.0, 0.3, 1.5),
]
pg = page(sz, 'Look')
for name, label, default, lo, hi in LOOK:
    if not hasattr(sz.par, name):
        p = pg.appendFloat(name, label=label)[0]
        p.val = default
    p = getattr(sz.par, name)
    p.normMin, p.normMax, p.default = lo, hi, default


def get(optype, name, x, y):
    o = sz.op(name) or sz.create(optype, name)
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
    """Connect srcs to dst inputs 0..n; a multi-input TOP gains its next connector on a later frame."""
    for i, s in enumerate(srcs):
        if i < len(dst.inputConnectors):
            if dst.inputConnectors[i].connections[:1] != [s.outputConnectors[0]]:
                dst.inputConnectors[i].connect(s)
        else:
            run(lambda d=dst, ss=srcs: wire(d, ss), delayFrames=1)
            return


def menu(par, *choices):
    """Set a menu parameter to the first choice it offers (TD builds differ)."""
    for c in choices:
        if c in par.menuNames:
            par.val = c
            return c
    return None


M = "op('seasons_mod').module"
T = ' + 0 * absTime.frame'          # module calls aren't tracked as dependencies: re-evaluate every frame
I = f"{M}.intensity()"

# ---- the year: engine, glue, frame driver, control page -----------------------------------------------
eng = get(textDAT, 'seasons_engine', 0, 900)
eng.par.file = REPO + '/td/seasons/seasons.py'
eng.par.syncfile = True
mod = get(textDAT, 'seasons_mod', 150, 900)
mod.par.file = REPO + '/td/seasons/seasons_td.py'
mod.par.syncfile = True
ex = get(executeDAT, 'seasons_exec', 300, 900)
ex.text = ("# Step the river's year every frame (generated by build_seasons_local.py).\n"
           "def onFrameStart(frame):\n    op('seasons_mod').module.frame(me.parent())\n    return\n")
ex.par.framestart = True
ex.par.active = True
cb = get(textDAT, 'control_callbacks', 450, 900)
cb.text = ("# Control page (generated by build_seasons_local.py): see td/seasons/seasons_td.py http().\n"
           "def onHTTPRequest(webServerDAT, request, response):\n"
           "    return op('seasons_mod').module.http(request, response)\n\n"
           "def onWebSocketOpen(webServerDAT, client, uri):\n    return\n\n"
           "def onWebSocketClose(webServerDAT, client):\n    return\n\n"
           "def onWebSocketReceiveText(webServerDAT, client, data):\n    return\n\n"
           "def onWebSocketReceiveBinary(webServerDAT, client, data):\n    return\n\n"
           "def onServerStart(webServerDAT):\n    return\n\n"
           "def onServerStop(webServerDAT):\n    return\n")
srv = get(webserverDAT, 'control_server', 600, 900)
srv.par.port = PORT
srv.par.callbacks = cb
srv.par.active = True

# ---- the river library at three speeds, crossfaded by intensity --------------------------------------
vids = []
for k, (name, f) in enumerate((('river_slow', 'river-slow.mp4'), ('river_normal', 'river-normal.mp4'),
                              ('river_fast', 'river-fast.mp4'))):
    mv = get(moviefileinTOP, name, 0, 600 - 150 * k)
    mv.par.file = f'{LIB}/{f}'
    if hasattr(mv.par, 'playmode'):
        menu(mv.par.playmode, 'sequential')
    if hasattr(mv.par, 'extendright'):
        menu(mv.par.extendright, 'loop', 'cycle')
    if hasattr(mv.par, 'play'):
        mv.par.play = True
    if hasattr(mv.par, 'hwdecode'):
        mv.par.hwdecode = False          # hardware decoding needs an NVIDIA GPU; bitcube has Intel Iris Xe
    if hasattr(mv.par, 'audio'):
        try:
            menu(mv.par.audio, 'off')
        except Exception:
            pass
    fit = get(fitTOP, name + '_fit', 150, 600 - 150 * k)
    fit.inputConnectors[0].connect(mv)
    fit.par.fit = 'fill'
    res(fit, FIELD_W, FIELD_H)
    vids.append(fit)
va = get(crossTOP, 'river_speed_a', 300, 525)
wire(va, [vids[0], vids[1]])
va.par.cross.expr = f"min(1, max(0, 2 * {I})){T}"
vb = get(crossTOP, 'river_speed', 450, 450)
wire(vb, [va, vids[2]])
vb.par.cross.expr = f"min(1, max(0, 2 * {I} - 1)){T}"

# ---- grade: the seasons' palettes ------------------------------------------------------------------------
lv = get(levelTOP, 'river_level', 600, 450)
lv.inputConnectors[0].connect(vb)
lv.par.brightness1.expr = 'parent().par.Rivergain'
lv.par.contrast.expr = 'parent().par.Rivercontrast'
lv.par.clamp = True
mono = get(monochromeTOP, 'river_mono', 750, 450)
mono.inputConnectors[0].connect(lv)
PALETTES = {   # dark -> bright; black at 0 so dark water stays dark on the LEDs
    'winter': [[0, 0, 0, 0, 1], [0.35, 0.05, 0.10, 0.28, 1], [0.65, 0.35, 0.55, 0.85, 1], [0.85, 0.75, 0.88, 1.0, 1], [1, 1, 1, 1, 1]],
    'spring': [[0, 0, 0, 0, 1], [0.35, 0.0, 0.18, 0.12, 1], [0.6, 0.1, 0.55, 0.4, 1], [0.85, 0.55, 0.95, 0.65, 1], [1, 0.9, 1, 0.9, 1]],
    'summer': [[0, 0, 0, 0, 1], [0.3, 0.05, 0.12, 0.25, 1], [0.6, 0.2, 0.55, 0.6, 1], [0.82, 1.0, 0.8, 0.35, 1], [1, 1, 0.97, 0.8, 1]],
    'autumn': [[0, 0, 0, 0, 1], [0.35, 0.18, 0.08, 0.03, 1], [0.6, 0.55, 0.28, 0.08, 1], [0.82, 0.95, 0.5, 0.15, 1], [1, 1, 0.85, 0.6, 1]],
}
ramps = []
for k, (season, rows) in enumerate(PALETTES.items()):
    keys(f'palette_{season}', rows, 600, 300 - 100 * k)
    rp = get(rampTOP, f'ramp_{season}', 750, 300 - 100 * k)
    res(rp, 256, 4)
    rp.par.type = 'horizontal'
    rp.par.dat = f'palette_{season}'
    rw = get(levelTOP, f'ramp_{season}_w', 900, 300 - 100 * k)
    rw.inputConnectors[0].connect(rp)
    rw.par.brightness1.expr = f"{M}.w({k}){T}"
    ramps.append(rw)
rs = get(compositeTOP, 'palette_now', 1050, 150)
wire(rs, ramps)
rs.par.operand = 'add'
res(rs, 256, 4)
lk = get(lookupTOP, 'river_palette', 900, 450)
wire(lk, [mono, rs])
lk.par.channel = 'luminance'
tint = get(constantTOP, 'season_tint', 900, 600)
res(tint, 8, 8)
for ch, c in enumerate('rgb'):
    getattr(tint.par, f'color{c}').expr = f"{M}.tint({ch}){T}"
nat = get(compositeTOP, 'river_natural', 1050, 600)
wire(nat, [lv, tint])
nat.par.operand = 'multiply'
nat.par.prefit = 'fill'
res(nat, FIELD_W, FIELD_H)
look = get(crossTOP, 'river_look', 1200, 450)
wire(look, [lk, nat])
look.par.cross.expr = 'parent().par.Naturalmix'


# ---- overlays ------------------------------------------------------------------------------------------
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


# 1. torrent: fast streaks down the water, only where it's bright (foam), stronger with intensity
tn = noise('torrent_noise', 0, -150, 0.5, 6.0, 0.35, ty=f"{M}.ph('torrent'){T}", tz=f"{M}.ph('drift'){T}")
tt = threshold('torrent_streaks', tn, 150, -150, f"1 - (0.04 + 0.3 * {I}){T}")
tm = mult('torrent_foam', tt, mono, 300, -150)
tc = colour('torrent_tint', 300, -300, [f"1 - 0.1 * {M}.w(2){T}", f"1 - 0.15 * {M}.w(2){T}", f"1 - 0.45 * {M}.w(2){T}"])
tcol = mult('torrent_col', tm, tc, 450, -150)
ta = amount('torrent', tcol, 600, -150, f"parent().par.Overlay * 1.6 * {I} ** 1.5{T}")
# 2. glints: ice in winter, sun in summer, on bright water
gn = noise('glint_noise', 0, -450, 0.04, 1.0, 1.0, tz=f"{M}.ph('glint'){T}")
gt = threshold('glint_points', gn, 150, -450, '0.9')
gm = mult('glint_water', gt, mono, 300, -450)
gc = colour('glint_tint', 300, -600, [f"{M}.tint(0, 'glint'){T}", f"{M}.tint(1, 'glint'){T}", f"{M}.tint(2, 'glint'){T}"])
gcol = mult('glint_col', gm, gc, 450, -450)
ga = amount('glints', gcol, 600, -450, f"parent().par.Overlay * (1.2 * {M}.w(0) + 0.9 * {M}.w(2) + 0.3 * {M}.w(1)){T}")
# 3. autumn leaves: sparse warm flecks drifting down
ln = noise('leaf_noise', 0, -750, 0.12, 1.4, 1.0, ty=f"{M}.ph('leaves'){T}", tz=f"0.3 * {M}.ph('drift'){T}")
lt = threshold('leaf_flecks', ln, 150, -750, '0.86')
lc = colour('leaf_tint', 300, -900, ['1.0', '0.42', '0.12'])
lcol = mult('leaf_col', lt, lc, 450, -750)
la = amount('leaves', lcol, 600, -750, f"parent().par.Overlay * 1.3 * {M}.w(3){T}")
# 4. spring rain: thin streaks with trails (feedback), as in the rain checkpoint
rn = noise('rain_noise', 0, -1050, 0.6, 4.5, 0.55, ty=f"{M}.ph('rain'){T}", tz="absTime.seconds * 0.35")
rd = threshold('rain_drops', rn, 150, -1050, '0.93')
rseed = get(nullTOP, 'rain_seed', 300, -1050)
rseed.inputConnectors[0].connect(rd)
rfb = get(feedbackTOP, 'rain_feedback', 300, -1200)
rfb.inputConnectors[0].connect(rseed)
rfb.par.top = 'rain_sum'
rfall = get(transformTOP, 'rain_fall', 450, -1200)
rfall.inputConnectors[0].connect(rfb)
rfall.par.tunit = 'fraction'
rfall.par.ty = -0.004
rfall.par.extend = 'zero'
rdec = get(levelTOP, 'rain_decay', 600, -1200)
rdec.inputConnectors[0].connect(rfall)
rdec.par.brightness1 = 0.9
rsum = get(compositeTOP, 'rain_sum', 750, -1200)
wire(rsum, [rdec, rseed])
rsum.par.operand = 'add'
res(rsum, 640, 360, 'rgba16float')
rc_ = colour('rain_tint', 750, -1350, ['0.72', '0.95', '0.85'])
rcol = mult('rain_col', rsum, rc_, 900, -1200)
ra = amount('rain', rcol, 1050, -1200, f"parent().par.Overlay * {M}.w(1){T}")

ov = get(compositeTOP, 'overlays', 900, -450)
wire(ov, [ta, ga, la, ra])
ov.par.operand = 'add'
ov.par.prefit = 'fill'
res(ov, FIELD_W, FIELD_H, 'rgba16float')

# ---- field ---------------------------------------------------------------------------------------------
fld = get(compositeTOP, 'field_mix', 1350, 300)
wire(fld, [look, ov])
fld.par.operand = 'add'
fld.par.prefit = 'fill'
res(fld, FIELD_W, FIELD_H)
fg = get(levelTOP, 'field_gain', 1500, 300)
fg.inputConnectors[0].connect(fld)
fg.par.brightness1.expr = f"parent().par.Gain * (0.7 + 0.45 * {I}){T}"
fg.par.clamp = True
bl = get(blurTOP, 'field_blur', 1650, 300)
bl.inputConnectors[0].connect(fg)
bl.par.size.expr = 'parent().par.Blur'
bl.par.extend = 'hold'
out = get(nullTOP, 'field_out', 1800, 300)
out.inputConnectors[0].connect(bl)
out.viewer = True

# ---- ropes: the camera pixel map (as in the rain checkpoint) ------------------------------------------
with open(PIXELMAP, encoding='utf-8') as f:
    pm = json.load(f)
uv = {(p['rope'], p['px']): (p['u'], p['v']) for p in pm['points']}
# Ropes the capture missed (dark on 18 Oct: 9 and 17) borrow a neighbour's positions until the re-map (S4).
if REPO + '/tools' not in sys.path:
    sys.path.insert(0, REPO + '/tools')
from pixelmap.fill import fill_unmapped
uv, BORROWED = fill_unmapped(uv, N_ROPES, N_PX)
tab = get(tableDAT, 'uv_table', 1800, 0)
tab.clear()
tab.appendRow(['u', 'v'])
for r in range(N_ROPES):
    for px in range(N_PX):
        tab.appendRow(uv.get((r, px), (-1, -1)))      # (-1, -1): outside the field = black
tab.par.file = ''
dc = get(dattoCHOP, 'uv_chop', 1950, 0)
dc.par.dat = tab
dc.par.output = 'chanpercol'
dc.par.firstrow = 'names'
dc.par.firstcolumn = 'values'
tc_ = get(toptoCHOP, 'sample_ropes', 2100, 0)
tc_.inputConnectors[0].connect(dc)
tc_.par.top = out
tc_.par.r, tc_.par.g, tc_.par.b, tc_.par.a = 'r', 'g', 'b', ''
tc_.par.uvunits = 'norm'
tc_.par.interp = 'linear'
for side in ('imageleft', 'imageright', 'imagebottom', 'imagetop'):
    setattr(tc_.par, side, 'default')
tc_.par.defcolorr = tc_.par.defcolorg = tc_.par.defcolorb = tc_.par.defcolora = 0
ct = get(choptoTOP, 'rope_rows', 2250, 0)
ct.par.chop = tc_
ct.par.dataformat = 'rgb'
ct.par.layout = 'rowswrapped'
res(ct, N_PX, N_ROPES)
fl = get(flipTOP, 'rope_flop', 2400, 0)
fl.inputConnectors[0].connect(ct)
fl.par.flop = 'bottomleft'
fl.par.flipx, fl.par.flipy = True, False
rcv = get(nullTOP, 'rope_canvas', 2550, 0)
rcv.inputConnectors[0].connect(fl)
rcv.viewer = True

# ---- HUB75 quads: quad 1 from its camera-space corners; 2-4 as windows of the field until the re-map ----
quads = []
q1 = pm.get('hub75_quad1')
cp = get(cornerpinTOP, 'quad1_pin', 1950, 300)
cp.inputConnectors[0].connect(out)
res(cp, 256, 128)
if q1 is not None:
    for corner in ('tl', 'tr', 'bl', 'br'):
        getattr(cp.par, f'extract{corner}unit').val = 'fraction'
        getattr(cp.par, f'extract{corner}x').val = q1[corner][0]
        getattr(cp.par, f'extract{corner}y').val = q1[corner][1]
cp.par.extractmapping = 'perspective'
cp.par.extend = 'zero'
quads.append(cp)
for k in (2, 3, 4):
    c = get(cropTOP, f'quad{k}_window', 1950, 300 - 150 * (k - 1))
    c.inputConnectors[0].connect(out)
    c.par.cropleft, c.par.cropright = 0.04 + 0.32 * (k - 2), 0.04 + 0.32 * (k - 2) + 0.28
    c.par.cropbottom, c.par.croptop = 0.3, 0.6
    f_ = get(fitTOP, f'quad{k}_fit', 2025, 300 - 150 * (k - 1))
    f_.inputConnectors[0].connect(c)
    f_.par.fit = 'fill'
    res(f_, 256, 128)
    quads.append(f_)
outs = []
for k, q in enumerate(quads, start=1):
    g = get(levelTOP, f'quad{k}_gain', 2100, 300 - 150 * (k - 1))
    g.inputConnectors[0].connect(q)
    g.par.brightness1.expr = 'parent().par.Panelgain'
    g.par.gamma1.expr = 'parent().par.Panelgamma'
    g.par.clamp = True
    o = get(nullTOP, f'quad{k}_out', 2250, 300 - 150 * (k - 1))
    o.inputConnectors[0].connect(g)
    o.viewer = True
    outs.append(o)

# ---- hook up the ropes and four quads ------------------------------------------------------------------
ropes = proj.op('ropes')
ropes.par.Canvas = rcv.path
ropes.par.Cropleft = ropes.par.Cropbottom = 0
ropes.par.Cropright = ropes.par.Croptop = 1
exec(open(REPO + '/td/build/build_panels.py', encoding='utf-8').read(), dict(globals(), PANEL_QUADS=4))
panels = proj.op('panels')
for k, o in enumerate(outs, start=1):
    setattr(panels.par, f'Quad{k}', o.path)
panels.par.Quad2off = False
# Gray Area receive card (found by camera, 23 Oct): quads stacked down the left edge, quad 4 below quad 3.
for k, (x, y) in enumerate(((0, 0), (0, 128), (0, 256), (0, 384)), start=1):
    setattr(panels.par, f'Quad{k}pos1', x)
    setattr(panels.par, f'Quad{k}pos2', y)
panels.par.Pairstacked = True
panels.par.Source = 'canvas'
panels.par.Brightness = 1.0
panels.par.Output = True             # the panel window covers the LED display (the show's only display)

missing = [f for f in ('river-slow.mp4', 'river-normal.mp4', 'river-fast.mp4') if not glob.glob(f'{LIB}/{f}')]
print('seasons built from', PIXELMAP.rsplit('/', 1)[-1], '|', sz.path, '| control page on port', PORT,
      '| river library missing:', missing or 'none (all three speeds present)',
      '| errors:', sz.errors(recurse=True) or 'none', '| warnings:', sz.warnings(recurse=True) or 'none')
