# Executed in an isolated namespace by build_viz.py. Reuse Gavin's grade/effects and year engine,
# with a live-input or original recorded-library variant; no server, ropes or panel setup.
from pathlib import Path

# 640x360 covers the physical screen pixels while keeping the extra look inexpensive.
FIELD_W, FIELD_H = 640, 360
variant = globals().get('SCREEN_VARIANT', 'live')
comp_name = 'gavin_recorded' if variant == 'recorded' else 'gavin_screens'
sc = viz.op(comp_name) or viz.create(baseCOMP, comp_name)
sc.nodeX, sc.nodeY = (950, -2200) if variant == 'recorded' else (950, -1500)
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
mod.text = original.replace("op('/project1/seasons/seasons_engine')", f"op('/project1/viz/{comp_name}/seasons_engine')").replace("'seasons_live'", "'combined_recorded_screen_seasons_live'" if variant == 'recorded' else "'combined_screen_seasons_live'")
# No sync back to Gavin's glue and no copy of its HTTP server. Only frame/look functions are used.
ex = get(executeDAT, 'seasons_exec', 300, 900)
ex.text = "def onFrameStart(frame):\n    op('seasons_mod').module.frame(me.parent())\n"
ex.par.framestart = ex.par.active = True
if variant == 'recorded':
    LIB = 'C:/Users/user/River/recordings/river/seasons'
    library = source[source.index('# ---- the river library'):source.index('# ---- grade:')]
    # Reuse the baseline normal decoder and avoid reopening unchanged movies on a repeat build.
    # The seasonal speed-blend expressions and all grade/effect code remain the original source.
    creation = "mv = get(moviefileinTOP, name, 0, 600 - 150 * k)\n    mv.par.file = f'{LIB}/{f}'"
    assert creation in library
    library = library.replace(creation, """if name == 'river_normal':
        mv = get(selectTOP, name, 0, 600 - 150 * k)
        mv.par.top = '/project1/inputs/river_clip'
    else:
        mv = get(moviefileinTOP, name, 0, 600 - 150 * k)
        if mv.par.file.eval() != f'{LIB}/{f}':
            mv.par.file = f'{LIB}/{f}'""")
    exec(library, globals())
else:
    river = get(selectTOP, 'river_live', 150, 450)
    river.par.top = '/project1/inputs/river'
    vb = get(fitTOP, 'river_speed', 450, 450)
    vb.inputConnectors[0].connect(river)
    vb.par.fit = 'fill'
    res(vb, FIELD_W, FIELD_H)
# The live stream stays at camera speed; preserve Gavin's original seasonal grade/effects verbatim.
visual = source[source.index('# ---- grade:'):source.index('# ---- ropes:')]
exec(visual, globals())
note(sc, f"Gavin's seasonal grade/effects; source: {variant}.\n"
         "Independent year state; shared rules/presence are read, no rules are written. No server or outputs.\n"
         "This branch feeds Combined v0's four screens only. No live playback-speed synthesis.")
