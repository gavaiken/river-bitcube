# screens.py: the four HUB75 screens, shared by both show files (phase G, 23 Oct). Exec'd by
# build_seasons_local.py and build_river_local.py with these globals:
#   SCREENS_COMP  the show's COMP (gets the Screens page and the per-screen operators)
#   FIELD         the field TOP in camera space (1280x720, what the ropes sample)
#   ROPE_CANVAS   the 20 x 400 rope canvas TOP (for the preview)
#   REPO, proj, get(optype, name, x, y), res(op, w, h), page(comp, name)
#   optional: SCREEN_PREFIX (operator names, default 'quad'), SCREEN_GAIN / SCREEN_GAMMA (expressions)
# and sets SCREEN_OUTS (the four quad feeds) and SCREEN_INFO (one line for the build's print).
#
# Per screen k (1-4):
#   source   the field under the screen's camera-space corners (tools/pixelmap/screens-<date>.json, from
#            tools/pixelmap/screens.py), upright 128x256 -- or, for a screen not in that file, a portrait window
#            stacked down one column of the field (Screenorder, top first; Screencolumn)
#   switch   source | big "F<k>" (Screentest) | corner pattern (Screencorners: red TL, green TR, blue BL, yellow
#            BR as seen; Screenquarter 1-4 = only that quarter white) | black (Screensolo = another screen; 9 = all)
#   as seen  Quad<k>vflip / Quad<k>hflip (screen 3 hangs the other way up)
#   feed     flop + flips turn the upright portrait into the 256x128 quad the receive card shows on its side;
#            Quad<k>swap swaps its two panel rows (screens 3 and 4 are wired that way)
# The Gray Area receive card stacks the quads down the left edge of the HDMI picture (0,0) (0,128) (0,256)
# (0,384); found by lighting bands of the picture and watching the camera, 23 Oct.
# `screens_preview` shows the ropes and the four screens upright side by side (672x256): what TD sends, for the
# live page (VNC shows TD's panels window as black).
import glob
import json

SC = SCREENS_COMP
P = globals().get('SCREEN_PREFIX', 'quad')
GAIN = globals().get('SCREEN_GAIN', 'parent().par.Panelgain')
GAMMA = globals().get('SCREEN_GAMMA', 'parent().par.Panelgamma')
SCR = page(SC, 'Screens')
if not hasattr(SC.par, 'Screenorder'):
    SCR.appendStr('Screenorder', label='Screen order, top to bottom (quad numbers)')[0].val = '1 2 3 4'
    p = SCR.appendFloat('Screencolumn', label='Column centre (u)')[0]
    p.val, p.normMin, p.normMax = 0.5, 0, 1
if not hasattr(SC.par, 'Screentest'):
    SCR.appendToggle('Screentest', label='Test: show F<quad> instead of the river')[0].val = False
if not hasattr(SC.par, 'Screencorners'):
    SCR.appendToggle('Screencorners', label='Test: four-colour corner pattern (red TL as seen)')[0].val = False
    p = SCR.appendInt('Screensolo', label='Light only this screen (0 = all, 9 = none)')[0]
    p.val, p.normMin, p.normMax = 0, 0, 9
if not hasattr(SC.par, 'Screenquarter'):
    p = SCR.appendInt('Screenquarter', label='Corner pattern: 0 = four colours, 1-4 = only that quarter white (TL TR BL BR)')[0]
    p.val, p.normMin, p.normMax = 0, 0, 4
for k in range(1, 5):
    if not hasattr(SC.par, f'Quad{k}flop'):
        m = SCR.appendMenu(f'Quad{k}flop', label=f'Quad {k} flop')[0]
        m.menuNames = ['noflop', 'bottomleft', 'topleft']
        m.menuLabels = ['Off', 'Bottom left', 'Top left']
        SCR.appendToggle(f'Quad{k}flipx', label=f'Quad {k} flip x')
        SCR.appendToggle(f'Quad{k}flipy', label=f'Quad {k} flip y')
    if not hasattr(SC.par, f'Quad{k}swap'):
        SCR.appendToggle(f'Quad{k}swap', label=f'Quad {k} swap its two panel rows')
    if not hasattr(SC.par, f'Quad{k}vflip'):
        SCR.appendToggle(f'Quad{k}vflip', label=f'Quad {k} flip top to bottom (as seen)')
    if not hasattr(SC.par, f'Quad{k}hflip'):
        SCR.appendToggle(f'Quad{k}hflip', label=f'Quad {k} flip left to right (as seen)')
# Found with the F test (23 Oct): flop bottom left + flip y is upright on every screen. Screens 3 and 4 have
# their two panel columns the other way round ("4F"), so they swap them back; screen 3 also hangs the other way
# up, so it gets a half turn as seen. Without the swap, the half turn left a seam down its middle.
for k in range(1, 5):
    setattr(SC.par, f'Quad{k}flop', 'bottomleft')
    setattr(SC.par, f'Quad{k}flipx', False)
    setattr(SC.par, f'Quad{k}flipy', True)
    setattr(SC.par, f'Quad{k}swap', k in (3, 4))
    setattr(SC.par, f'Quad{k}vflip', k == 3)
    setattr(SC.par, f'Quad{k}hflip', k == 3)
SC.par.Screentest = SC.par.Screencorners = False
SC.par.Screensolo = 0
SC.par.Screenquarter = 0

# Where each screen hangs in the camera frame (newest screens-*.json), if located.
_files = sorted(glob.glob(REPO + '/tools/pixelmap/screens-????-??-??.json'))
SCREEN_FILE = _files[-1].replace('\\', '/') if _files else None
LOCATED = {}
if SCREEN_FILE:
    with open(SCREEN_FILE, encoding='utf-8') as f:
        LOCATED = {int(k): v for k, v in json.load(f)['screens'].items()}

pat = get(moviefileinTOP, 'screen_corners', 1950, 500)
pat.par.file.expr = (f"'{REPO}/td/screens/' + ('corners.png' if parent().par.Screenquarter == 0 "
                     f"else 'q%d.png' % parent().par.Screenquarter)")
blk = get(constantTOP, 'screen_black', 2000, 500)
res(blk, 128, 256)
blk.par.colorr = blk.par.colorg = blk.par.colorb = 0

WIN_W = 128 / 1280                  # fallback window width as a fraction of the 1280x720 field
WIN_H = 256 / 720
STEP = (1 - WIN_H) / 3              # four windows from the top of the field to the bottom, overlapping
uprights, SCREEN_OUTS, how = [], [], []
for k in range(1, 5):
    y = 300 - 150 * (k - 1)
    if k in LOCATED:
        src = get(cornerpinTOP, f'{P}{k}_pin', 1975, y)
        src.inputConnectors[0].connect(FIELD)
        res(src, 128, 256)
        for corner in ('tl', 'tr', 'bl', 'br'):
            getattr(src.par, f'extract{corner}unit').val = 'fraction'
            getattr(src.par, f'extract{corner}x').val = LOCATED[k][corner][0]
            getattr(src.par, f'extract{corner}y').val = LOCATED[k][corner][1]
        src.par.extractmapping = 'perspective'
        src.par.extend = 'zero'
        how.append(f'{k}:' + ('estimated' if LOCATED[k].get('estimated') else 'located'))
    else:
        c = get(cropTOP, f'{P}{k}_window', 1950, y)
        c.inputConnectors[0].connect(FIELD)
        c.par.cropleft.expr = f"parent().par.Screencolumn - {WIN_W / 2:.5f}"
        c.par.cropright.expr = f"parent().par.Screencolumn + {WIN_W / 2:.5f}"
        slot = (f"[int(q) for q in parent().par.Screenorder.eval().split()].index({k}) "
                f"if '{k}' in parent().par.Screenorder.eval().split() else {k - 1}")
        c.par.croptop.expr = f"1 - ({slot}) * {STEP:.5f}"
        c.par.cropbottom.expr = f"1 - ({slot}) * {STEP:.5f} - {WIN_H:.5f}"
        src = get(fitTOP, f'{P}{k}_fit', 2000, y)
        src.inputConnectors[0].connect(c)
        src.par.fit = 'fill'
        res(src, 128, 256)
        how.append(f'{k}:window')
    for old in ((f'{P}{k}_window', f'{P}{k}_fit') if k in LOCATED else (f'{P}{k}_pin',)):
        if SC.op(old):
            SC.op(old).destroy()
    t = get(textTOP, f'{P}{k}_testtext', 2000, y - 60)
    t.par.text = f'F{k}'
    res(t, 128, 256)
    t.par.fontsizex = 90
    t.par.alignx, t.par.aligny = 'center', 'center'
    t.par.bgcolorr, t.par.bgcolorg, t.par.bgcolorb, t.par.bgalpha = 0.0, 0.05, 0.25, 1
    sw = get(switchTOP, f'{P}{k}_src', 2050, y)
    for i, o in enumerate((src, t, pat, blk)):
        sw.inputConnectors[i].connect(o)
    sw.par.index.expr = (f"3 if (parent().par.Screensolo > 0 and parent().par.Screensolo != {k}) else "
                         f"(2 if parent().par.Screencorners else int(parent().par.Screentest))")
    vf = get(flipTOP, f'{P}{k}_vflip', 2060, y - 60)          # as seen: top to bottom = y of the portrait
    vf.inputConnectors[0].connect(sw)
    vf.par.flipy.expr = f'parent().par.Quad{k}vflip'
    vf.par.flipx.expr = f'parent().par.Quad{k}hflip'
    uprights.append(sw)
    fl_ = get(flipTOP, f'{P}{k}_orient', 2075, y)
    fl_.inputConnectors[0].connect(vf)
    fl_.par.flop.expr = f'parent().par.Quad{k}flop'
    fl_.par.flipx.expr = f'parent().par.Quad{k}flipx'
    fl_.par.flipy.expr = f'parent().par.Quad{k}flipy'
    sh = get(transformTOP, f'{P}{k}_swap', 2100, y - 60)       # half a frame down, wrapped = rows swapped
    sh.inputConnectors[0].connect(fl_)
    sh.par.extend = 'repeat'
    sh.par.tunit = 'fraction'
    sh.par.ty.expr = f'0.5 if parent().par.Quad{k}swap else 0'
    g = get(levelTOP, f'{P}{k}_gain', 2125, y)
    g.inputConnectors[0].connect(sh)
    g.par.brightness1.expr = GAIN
    g.par.gamma1.expr = GAMMA
    g.par.clamp = True
    o = get(nullTOP, f'{P}{k}_out', 2250, y)
    o.inputConnectors[0].connect(g)
    o.viewer = True
    SCREEN_OUTS.append(o)

# Preview: ropes (20 columns, 8 px each) then screens 1-4 upright as seen, as one 672x256 image.
rp = get(fitTOP, 'preview_ropes', 2125, 500)
rp.inputConnectors[0].connect(ROPE_CANVAS)
rp.par.fit = 'fill'
res(rp, 160, 256)
pv = get(layoutTOP, 'screens_preview', 2250, 500)
pv.par.tops = ' '.join([rp.path] + [u.path for u in uprights])
pv.par.align = 'horizlr'
pv.par.fit = 'fill'                  # five equal cells across 672x256 (ropes 134 px, screens ~native 128x256)
pv.par.bgcolora = 1
res(pv, 672, 256)
pv.viewer = True

# Hook up the panels: four quads, stacked as the Gray Area receive card has them.
exec(open(REPO + '/td/build/build_panels.py', encoding='utf-8').read(), dict(globals(), PANEL_QUADS=4))
panels = proj.op('panels')
for k, o in enumerate(SCREEN_OUTS, start=1):
    setattr(panels.par, f'Quad{k}', o.path)
panels.par.Quad2off = False
for k, (x, y) in enumerate(((0, 0), (0, 128), (0, 256), (0, 384)), start=1):
    setattr(panels.par, f'Quad{k}pos1', x)
    setattr(panels.par, f'Quad{k}pos2', y)
panels.par.Pairstacked = True
panels.par.Source = 'canvas'
panels.par.Brightness = 1.0
panels.par.Output = True             # the panel window covers the LED display (the show's only display)
SCREEN_INFO = ('screens ' + ' '.join(how) + ' from ' + (SCREEN_FILE.rsplit('/', 1)[-1] if SCREEN_FILE else 'no screens file')
               + f' | preview {pv.path}')
