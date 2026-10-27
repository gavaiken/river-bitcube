# Executed in an isolated namespace by build_viz.py. Reuse Gavin's grade/effects and year engine,
# with live river input (the established recorded fallback) and no server, ropes or panel setup.
from pathlib import Path

# 640x360 covers the physical screen pixels while keeping the extra look inexpensive.
FIELD_W, FIELD_H = 640, 360
sc = viz.op('gavin_screens') or viz.create(baseCOMP, 'gavin_screens')
sc.nodeX, sc.nodeY = 950, -1500
sz = sc
get = maker(sc)
source = Path(REPO + '/td/build/build_seasons_local.py').read_text(encoding='utf-8')
# These explicit section boundaries fail a rebuild if the shared builder is reorganized.
look_defaults = source[source.index('LOOK = ['):source.index("pg = page(sz, 'Look')")]
exec(look_defaults, globals())
pg = page(sc, 'Look')
for name, label, default, lo, hi in LOOK:
    if not hasattr(sc.par, name):
        pg.appendFloat(name, label=label)[0].val = default
    p = getattr(sc.par, name)
    p.normMin, p.normMax, p.default = lo, hi, default
# Reuse the original helpers and expression names, scoped to this separate COMP.
helpers = source[source.index('def keys('):source.index('# ---- the year: engine')]
exec(helpers, globals())
eng = get(textDAT, 'seasons_engine', 0, 900)
eng.par.file = REPO + '/td/seasons/seasons.py'
eng.par.syncfile = True
mod = get(textDAT, 'seasons_mod', 150, 900)
original = Path(REPO + '/td/seasons/seasons_td.py').read_text(encoding='utf-8')
assert original.count("op('/project1/seasons/seasons_engine')") == 1
mod.text = original.replace("op('/project1/seasons/seasons_engine')", "op('/project1/viz/gavin_screens/seasons_engine')").replace("'seasons_live'", "'combined_screen_seasons_live'")
# No sync back to Gavin's glue and no copy of its HTTP server. Only frame/look functions are used.
ex = get(executeDAT, 'seasons_exec', 300, 900)
ex.text = "def onFrameStart(frame):\n    op('seasons_mod').module.frame(me.parent())\n"
ex.par.framestart = ex.par.active = True
river = get(selectTOP, 'river_live', 150, 450)
river.par.top = '/project1/inputs/river'
vb = get(fitTOP, 'river_speed', 450, 450)
vb.inputConnectors[0].connect(river)
vb.par.fit = 'fill'
res(vb, FIELD_W, FIELD_H)
# The live stream stays at camera speed; preserve Gavin's original seasonal grade/effects verbatim.
visual = source[source.index('# ---- grade:'):source.index('# ---- ropes:')]
exec(visual, globals())
note(sc, "Gavin's seasonal grade/effects on live river, with the established recorded fallback.\n"
         "Independent year state; shared rules/presence are read, no rules are written. No server or outputs.\n"
         "This branch feeds Combined v0's four screens only. No live playback-speed synthesis.")
