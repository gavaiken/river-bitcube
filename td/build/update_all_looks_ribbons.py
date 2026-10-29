# Apply only the approved screen shaders. No show/clock reset, playlist writes or rope changes.
# Default: soft. Rollback through the bridge: exec(open(...).read(), dict(globals(), SOFT_RIBBONS=False))
# Save with tools/td_save.ps1 BEFORE calling this (new GPU shader), and again only after verification.
import importlib
import sys

REPO = globals().get('REPO_OVERRIDE', 'C:/Users/user/River/river-bitcube')   # a frozen show builds from its own pinned checkout
if project.name not in ('river-all-looks.toe', 'river-all-looks-v2.toe'):   # the frozen v1 (from its pinned checkout) and v2
    raise RuntimeError('This update is only for river-all-looks.toe and river-all-looks-v2.toe')
if REPO + '/td' not in sys.path:
    sys.path.insert(0, REPO + '/td')
from remembered import ribbons_gpu
importlib.reload(ribbons_gpu)
_soft = globals().get('SOFT_RIBBONS', True)
_rem = op('/project1/remembered')
if _rem is None:
    raise RuntimeError('Missing remembered look')


def _apply_soft_ribbons(rem, soft):
    draw = rem.op('ribbons_draw')
    trail = rem.op('ribbons_trail')
    if draw is None or trail is None or rem.op('ribbons_glow') is None:
        raise RuntimeError('The existing ribbon chain is incomplete; not changing it')
    if len(trail.inputConnectors) < 2:
        run(_apply_soft_ribbons, rem, soft, delayFrames=3)
        return
    old = rem.allowCooking
    rem.allowCooking = False
    try:
        if soft:
            dat = rem.op('ribbons_glow_soft_ps') or rem.create(textDAT, 'ribbons_glow_soft_ps')
            glow = rem.op('ribbons_glow_soft') or rem.create(glslTOP, 'ribbons_glow_soft')
            # Wire the one input before assigning the guarded shader, never cook an unwired new shader.
            glow.inputConnectors[0].connect(draw)
            if hasattr(glow.par, 'format') and 'rgba16float' in glow.par.format.menuNames:
                glow.par.format = 'rgba16float'
            glow.par.outputresolution = 'custom'
            glow.par.resolutionw, glow.par.resolutionh = 512, 256
            glow.par.pixeldat = dat
            dat.text = ribbons_gpu.SOFT_GLOW_GLSL
        else:
            glow = rem.op('ribbons_glow')
        trail.inputConnectors[1].connect(glow)
        rem.op('ribbons_draw_ps').text = ribbons_gpu.SOFT_DRAW_GLSL if soft else ribbons_gpu.DRAW_GLSL
        rem.store('soft_ribbon_folds', bool(soft))
        # The live module may predate the new stored-flag check; update only its operator list, no reload/reset.
        from remembered import show as runtime
        runtime.GPU_OPS = tuple(n for n in runtime.GPU_OPS if n != 'ribbons_glow_soft')
        if soft:
            runtime.GPU_OPS += ('ribbons_glow_soft',)
    finally:
        rem.allowCooking = old
    print('all-looks ribbon projection:', 'soft' if soft else 'original', '(clock/playlist/ropes preserved)')


_apply_soft_ribbons(_rem, _soft)
