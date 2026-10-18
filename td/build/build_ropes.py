# Build (or update) /project1/ropes: canvas -> crop -> 20x400 rope texture -> Art-Net.
# Idempotent; run with  .\tools\td.ps1 -File .\td\build\build_ropes.py
# Output starts OFF. Turn on with  op('/project1/ropes').par.Active = True

REPO = 'C:/Users/user/River/river-bitcube'
proj = op('/project1')
ropes = proj.op('ropes') or proj.create(baseCOMP, 'ropes')
ropes.nodeX, ropes.nodeY = 1325, -250
ropes.color = (0.2, 0.45, 0.7)


def page(comp, name):
    for pg in comp.customPages:
        if pg.name == name:
            return pg
    return comp.appendCustomPage(name)


pg = page(ropes, 'Ropes')
if not hasattr(ropes.par, 'Active'):
    pg.appendToggle('Active', label='Output Active')[0].default = False
    pg.appendMenu('Source')[0].default = 'canvas'
    p = pg.appendInt('Identify', label='Identify Rope (0-19)')[0]
    p.normMin, p.normMax, p.clampMin, p.min, p.default = 0, 19, True, 0, 0
    p = pg.appendFloat('Brightness')[0]
    p.normMin, p.normMax, p.default = 0, 1, 0.15
    p = pg.appendFloat('Maxbrightness', label='Max Brightness (cap)')[0]
    p.normMin, p.normMax, p.default = 0, 1, 0.4
    p = pg.appendFloat('Boxwatts', label='Power Limit per Box (W)')[0]
    p.normMin, p.normMax, p.default = 0, 1500, 600
    p = pg.appendInt('Fps')[0]
    p.normMin, p.normMax, p.default = 1, 60, 40
    pg.appendTOP('Canvas')[0].default = '/project1/null5'
    for name in ('Cropleft', 'Cropbottom'):
        pg.appendFloat(name)[0].default = 0
    for name in ('Cropright', 'Croptop'):
        pg.appendFloat(name)[0].default = 1
    for p in ropes.customPars:
        p.val = p.default
# Menu entries are (re)set on every build so new sources reach an existing COMP.
# Test sources: see the *_frame functions in td/ropes/artnet_out.py and tools/rope_tests.ps1.
ropes.par.Source.menuNames = ['canvas', 'identify', 'order', 'box1_red', 'box2_green', 'rope', 'heads', 'black']
ropes.par.Source.menuLabels = ['Canvas', 'Identify rope (markers)', 'Rope order (steps)', 'Box 1 red',
                               'Box 2 green', 'One rope (Identify)', 'Rope heads (first 20 px)', 'Black']

# canvas -> crop -> fit to 20 x 400 (one column per rope, top row = pixel 0)
src = ropes.op('canvas') or ropes.create(selectTOP, 'canvas')
src.par.top.expr = 'parent().par.Canvas'
src.nodeX, src.nodeY = 0, 0

crop = ropes.op('crop') or ropes.create(cropTOP, 'crop')
crop.inputConnectors[0].connect(src)
for side in ('left', 'right', 'bottom', 'top'):
    getattr(crop.par, 'crop' + side).expr = f"parent().par.Crop{side}"
crop.nodeX, crop.nodeY = 150, 0

fit = ropes.op('fit') or ropes.create(fitTOP, 'fit')
fit.inputConnectors[0].connect(crop)
fit.par.fit = 'fill'
fit.par.outputresolution = 'custom'
fit.par.resolutionw, fit.par.resolutionh = 20, 400
fit.par.inputfiltertype = 'mipmap'
fit.nodeX, fit.nodeY = 300, 0

tex = ropes.op('rope_tex') or ropes.create(nullTOP, 'rope_tex')
tex.inputConnectors[0].connect(fit)
tex.nodeX, tex.nodeY = 450, 0
tex.viewer = True

mod = ropes.op('artnet_out') or ropes.create(textDAT, 'artnet_out')
mod.par.file = REPO + '/td/ropes/artnet_out.py'
mod.par.syncfile = True
mod.nodeX, mod.nodeY = 0, -200

ex = ropes.op('exec') or ropes.create(executeDAT, 'exec')
ex.par.file = REPO + '/td/ropes/ropes_exec.py'
ex.par.syncfile = True
ex.par.frameend = True
ex.par.active = True
ex.nodeX, ex.nodeY = 150, -200

# Andi's earlier DMX Out prototype broadcasts Art-Net; keep it off so only this COMP sends.
old = proj.op('dmxout1')
if old is not None:
    old.par.active = False

print('ropes built:', ropes.path, '| errors:', ropes.errors(recurse=True) or 'none')
