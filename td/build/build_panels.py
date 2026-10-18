# Build (or update) /project1/panels: two 256x128 quads -> top-left of the HDMI output.
# Idempotent; run with  .\tools\td.ps1 -File .\td\build\build_panels.py
# Open the output window with  op('/project1/panels').par.Output = True

REPO = 'C:/Users/user/River/river-bitcube'
proj = op('/project1')
panels = proj.op('panels') or proj.create(baseCOMP, 'panels')
panels.nodeX, panels.nodeY = 1575, 400
panels.color = (0.55, 0.35, 0.7)


def page(comp, name):
    for pg in comp.customPages:
        if pg.name == name:
            return pg
    return comp.appendCustomPage(name)


pg = page(panels, 'Panels')
if not hasattr(panels.par, 'Source'):
    p = pg.appendMenu('Source')[0]
    p.menuNames = ['canvas', 'test', 'black']
    p.menuLabels = ['Canvas', 'Test pattern', 'Black']
    p.default = 'test'
    p = pg.appendFloat('Brightness')[0]
    p.normMin, p.normMax, p.default = 0, 1, 0.8
    pg.appendTOP('Quad1')[0].default = '/project1/null1'
    pg.appendTOP('Quad2')[0].default = '/project1/null2'
    for name, (x, y) in (('Quad1pos', (0, 0)), ('Quad2pos', (256, 0))):   # TD names the parts Quad1pos1, Quad1pos2
        px, py = pg.appendInt(name, label=name.replace('pos', ' x,y (px)'), size=2)
        px.default, py.default = x, y
        px.normMax, py.normMax = 1024, 512
    pg.appendToggle('Output', label='Output Window Open')[0].default = False
    for p in panels.customPars:
        p.val = p.default
if not hasattr(panels.par, 'Sweep'):
    pg.appendToggle('Sweep', label='Test Sweep Bar')[0].default = False
    pg.appendToggle('Quad2off', label='Blank Quad 2')[0].default = False
    panels.par.Sweep = panels.par.Quad2off = False

# Canvas inputs and test patterns
for i in (1, 2):
    sel = panels.op(f'quad{i}') or panels.create(selectTOP, f'quad{i}')
    # Canvas crop or test pattern, switched here so layout needs only two inputs.
    sel.par.top.expr = f"parent().par.Quad{i}.eval() if parent().par.Source == 'canvas' else op('test{i}')"
    sel.nodeX, sel.nodeY = 0, 300 - 150 * i

    t = panels.op(f'test{i}') or panels.create(glslTOP, f'test{i}')
    t.par.pixeldat = ''
    pix = panels.op('test_pixel') or panels.create(textDAT, 'test_pixel')
    pix.par.file = REPO + '/td/panels/panel_test.glsl'
    pix.par.syncfile = True
    pix.nodeX, pix.nodeY = 0, -300
    t.par.pixeldat = pix
    t.par.outputresolution = 'custom'
    t.par.resolutionw, t.par.resolutionh = 256, 128
    t.par.vec0name = 'uQuad'
    t.par.vec0valuex = i
    t.par.vec0valuey.expr = 'absTime.seconds'
    t.par.vec0valuez.expr = 'parent().par.Sweep'
    t.nodeX, t.nodeY = 0, -150 * i - 150

lay_pix = panels.op('layout_pixel') or panels.create(textDAT, 'layout_pixel')
lay_pix.par.file = REPO + '/td/panels/panel_layout.glsl'
lay_pix.par.syncfile = True
lay_pix.nodeX, lay_pix.nodeY = 300, -300

lay = panels.op('layout') or panels.create(glslTOP, 'layout')


def wire(dst, names, k=0):
    """Connect names[k:] to dst inputs k.. in order. A multi-input TOP only gains its next free
    connector on a later frame, so whatever can't be wired now is retried next frame."""
    if k == 0:
        for c in dst.inputConnectors:
            c.disconnect()
    while k < len(names) and k < len(dst.inputConnectors):
        dst.parent().op(names[k]).outputConnectors[0].connect(dst.inputConnectors[k])
        k += 1
    if k < len(names):
        run(wire, dst, names, k, delayFrames=1)


wire(lay, ['quad1', 'quad2'])      # input order matters: see panel_layout.glsl
lay.par.pixeldat = lay_pix
lay.par.outputresolution = 'custom'
# Output just big enough for both quads (smaller window = less desktop covered).
lay.par.resolutionw.expr = "max(parent().par.Quad1pos1, parent().par.Quad2pos1) + 256"
lay.par.resolutionh.expr = "max(parent().par.Quad1pos2, parent().par.Quad2pos2) + 128"
lay.par.vec0name = 'uQuad0'
lay.par.vec0valuex.expr, lay.par.vec0valuey.expr = 'parent().par.Quad1pos1', 'parent().par.Quad1pos2'
lay.par.vec0valuez, lay.par.vec0valuew = 256, 128
lay.par.vec1name = 'uQuad1'
lay.par.vec1valuex.expr, lay.par.vec1valuey.expr = 'parent().par.Quad2pos1', 'parent().par.Quad2pos2'
lay.par.vec1valuez, lay.par.vec1valuew = 256, 128
lay.par.vec2name = 'uMode'
lay.par.vec2valuex.expr = "parent().par.Source.menuIndex"
lay.par.vec2valuey.expr = 'parent().par.Brightness'
lay.par.vec2valuez.expr = 'parent().par.Quad2off'
lay.nodeX, lay.nodeY = 300, 0

out = panels.op('panel_out') or panels.create(nullTOP, 'panel_out')
out.inputConnectors[0].connect(lay)
out.nodeX, out.nodeY = 450, 0
out.viewer = True

win = panels.op('window') or panels.create(windowCOMP, 'window')
win.par.winop = out
win.par.borders = False
win.par.alwaysontop = True
win.par.justifyh, win.par.justifyv = 'left', 'top'
# Put the window on the Colorlight sender: the monitor whose EDID name starts with 'LED' ("LED 1920X1080").
# Works with or without the USB-C monitor plugged in; falls back to monitor 0 if no LED display is found.
win.par.location = 'specifydisplay'
win.par.justifyoffsetto = 'specifydisplay'
win.par.monitor.expr = "next((m.index for m in monitors if m.description.upper().startswith('LED')), 0)"
win.par.winoffsetx, win.par.winoffsety = 0, 0
win.par.dpiscaling = 'native'        # 1 TD pixel = 1 HDMI pixel regardless of Windows scaling
win.par.size = 'custom'
win.par.winw.expr = "op('panel_out').width"
win.par.winh.expr = "op('panel_out').height"
win.nodeX, win.nodeY = 600, 0

wx = panels.op('window_exec') or panels.create(parameterexecuteDAT, 'window_exec')
wx.par.op = panels
wx.par.pars = 'Output'
wx.par.valuechange = True
wx.text = (
    "# Open/close the panel output window from the Output toggle (generated by build_panels.py).\n"
    "def onValueChange(par, prev):\n"
    "    w = op('window')\n"
    "    w.par.winopen.pulse() if par.eval() else w.par.winclose.pulse()\n"
    "    return\n"
)
wx.nodeX, wx.nodeY = 600, -200

st = panels.op('startup') or panels.create(executeDAT, 'startup')
st.par.start = True
st.text = (
    "# Reopen the panel output window when the project loads (generated by build_panels.py).\n"
    "def onStart():\n"
    "    if parent().par.Output.eval():\n"
    "        op('window').par.winopen.pulse()\n"
    "    return\n"
)
st.nodeX, st.nodeY = 750, -200

# Andi's single-quad window would fight for the same corner; panels/window replaces it.
old = proj.op('window1')
if old is not None and old.isOpen:
    old.par.winclose.pulse()

print('panels built:', panels.path, '| out', out.width, 'x', out.height,
      '| errors:', panels.errors(recurse=True) or 'none', '| warnings:', panels.warnings(recurse=True) or 'none')
