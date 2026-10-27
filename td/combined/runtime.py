"""combined-v0: fixed summer motion, local Modal canvas readiness, and saved overlay, framing and screens-only fade settings.

No new service: inputs use river_cam.py, and the canvas uses the existing Modal mirror on 8770.
Live holders stay in sys.modules, never in saved COMP storage. No camera credentials are read here.
"""
import json
import math
import os
from pathlib import Path
import sys
import time
import types

# Plain helper shared with tests; no TouchDesigner globals.
_HELPERS = str(Path(__file__).parent) if '__file__' in globals() and Path(__file__).is_file() else str(Path('C:/Users/user/River/river-bitcube/td/combined'))
if _HELPERS not in sys.path:
    sys.path.insert(0, _HELPERS)
import screen_fade

SHOW = 'river-combined-v0.toe'
RIVER = Path('C:/Users/user/River')
SETTINGS = RIVER / 'combined-v0.json'
SCENE = RIVER / 'gallery_state/state.json'
DEFAULT_STRENGTH = 0.25
FRAMING = ('auto', 'original', 'channel', 'channel-multi', 'pool', 'pool-multi')
# Same phase speeds as td/seasons/seasons_td.py; summer holds while its water keeps moving.
PHASES = {'torrent': (0.15, 2.6), 'glint': (0.2, 1.2), 'drift': (0.01, 0.06)}


def strength(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError('overlay strength must be a number from 0 to 1')
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError('overlay strength must be a number from 0 to 1')
    return float(value)


def load_strength(path=SETTINGS):
    try:
        return strength(json.loads(path.read_text(encoding='utf-8'))['overlay'])
    except (OSError, ValueError, KeyError, TypeError):
        return DEFAULT_STRENGTH


def framing(value):
    if value not in FRAMING:
        raise ValueError('unknown river framing profile')
    return value


def load_framing(path=SETTINGS):
    try:
        return framing(json.loads(path.read_text(encoding='utf-8'))['framing'])
    except (OSError, ValueError, KeyError, TypeError):
        return 'original'


def load_screens(path=SETTINGS):
    try:
        return screen_fade.checked(json.loads(path.read_text(encoding='utf-8'))['screens'])
    except (OSError, ValueError, KeyError, TypeError):
        return dict(screen_fade.DEFAULT)


def apply_screens(comp, settings):
    comp.par.Screenmode = settings['mode']
    comp.par.Screenblend = settings['blend']
    comp.par.Screenhold = settings['hold']
    if hasattr(comp.par, 'Screenrecorded'):
        comp.par.Screenrecorded = settings.get('recorded', 0.0)
    if hasattr(comp.par, 'Screenoffset'):
        comp.par.Screenoffset = settings.get('offset', 0.0)


def screen_settings(comp):
    return {'mode': comp.par.Screenmode.eval(), 'blend': float(comp.par.Screenblend),
            'hold': int(comp.par.Screenhold),
            'recorded': float(comp.par.Screenrecorded) if hasattr(comp.par, 'Screenrecorded') else 0.0,
            'offset': float(comp.par.Screenoffset) if hasattr(comp.par, 'Screenoffset') else 0.0}


def screen_weights(index=0):
    st = state()
    g = st.get('screen_mix', 0.0)
    first = st.get('screen_weights', (1 - g, g, 0.0))
    return st.get('screen_weights_all', (first,) * 4)[index]


def screen_mix():
    return screen_weights()[1]


def screen_live_mix(index=0):
    current, gavin, _ = screen_weights(index)
    return gavin / (current + gavin) if current + gavin > 1e-8 else 0.0


def screen_record_mix(index=0):
    return screen_weights(index)[2]


def save_strength(value, path=SETTINGS, profile=None, screens=None):
    value = strength(value)
    if profile is not None:
        profile = framing(profile)
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    data['overlay'] = value
    if profile is not None:
        data['framing'] = profile
    if screens is not None:
        data['screens'] = screen_fade.checked(screens)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data) + '\n', encoding='utf-8')
    os.replace(tmp, path)
    return value


def set_strength(comp, value, project_name, profile=None, screens=None):
    if project_name != SHOW:
        raise ValueError('overlay control is only available while combined-v0 is running')
    if profile is not None:
        framing(profile)
        if not hasattr(comp.par, 'Framing'):
            raise ValueError('this show needs the river framing update before using profiles')
    if screens is not None:
        if isinstance(screens, dict) and 'recorded' not in screens and hasattr(comp.par, 'Screenrecorded'):
            screens = dict(screens, recorded=float(comp.par.Screenrecorded))
        if isinstance(screens, dict) and 'offset' not in screens and hasattr(comp.par, 'Screenoffset'):
            screens = dict(screens, offset=float(comp.par.Screenoffset))
        screens = screen_fade.checked(screens)
        if screens['offset'] > 0 and not hasattr(comp.par, 'Screenoffset'):
            raise ValueError('this show needs the screen timing update before using offsets')
        if (screens['mode'] == 'recorded' or screens['recorded'] > 0) and not hasattr(comp.par, 'Screenrecorded'):
            raise ValueError('this show needs the recorded screen update before using that look')
        if not all(hasattr(comp.par, name) for name in ('Screenmode', 'Screenblend', 'Screenhold')):
            raise ValueError('this show needs the screen fade update before using screen controls')
    # Persist first: a disk error must not claim a successful, saved change.
    if profile is None and screens is None:
        comp.par.Canvasmix = save_strength(value)
    else:
        comp.par.Canvasmix = save_strength(value, profile=profile, screens=screens)
        if profile is not None:
            comp.par.Framing = profile
        if screens is not None:
            apply_screens(comp, screens)


def state():
    h = sys.modules.setdefault('combined_v0_live', types.ModuleType('combined_v0_live'))
    if not hasattr(h, 'st'):
        h.st = {'last': None, 'started': None, 'phases': dict.fromkeys(PHASES, 0.0),
                'next_read': 0.0, 'scene': None, 'scene_age_s': None, 'reloaded': False}
    return h.st


def frame(comp):
    st, now = state(), time.monotonic()
    if st['started'] is None:
        st['started'] = now
        # A show switch opens the saved .toe without running its build script.
        # Restore the last web-slider setting on the first frame of each load.
        comp.par.Canvasmix = load_strength()
        if hasattr(comp.par, 'Screenmode'):
            apply_screens(comp, load_screens())
        if hasattr(comp.par, 'Framing'):
            comp.par.Framing = load_framing()
    if hasattr(comp.par, 'Screenmode'):
        screen_fade.step(st, screen_settings(comp), now)
    if hasattr(comp.par, 'Framing') and comp.par.Framing.eval() == 'auto':
        detector = comp.op('view_detector')
        if detector is not None:
            detector.module.poll(comp, now, live_source())
    dt = 0 if st['last'] is None else max(0, min(0.25, now - st['last']))
    st['last'] = now
    for k, (lo, hi) in PHASES.items():
        st['phases'][k] = (st['phases'][k] + (lo + (hi - lo) * intensity()) * dt) % 10000
    if now >= st['next_read']:
        st['next_read'] = now + 2
        try:
            data = json.loads(SCENE.read_text(encoding='utf-8'))
            scene = data.get('scene') or {}
            st['scene'] = None if not scene or scene.get('placeholder') else {
                'animation': scene.get('animation'), 'palette': scene.get('palette_name')}
            stamp = data.get('set_at_epoch')
            st['scene_age_s'] = max(0, round(time.time() - stamp)) if isinstance(stamp, (float, int)) else None
        except (OSError, ValueError, TypeError):
            st['scene'], st['scene_age_s'] = None, None
    cv = comp.op('modal_canvas')
    if not st['reloaded'] and now - st['started'] > 30 and cv is not None and cv.par.active:
        cv.par.reload.pulse()   # mirror may start later than TD at login; same recovery as modal_scene.py
        st['reloaded'] = True


def intensity():
    return float(op('/project1/viz').par.Intensity)  # noqa: F821 (TouchDesigner global)


def ph(name):
    return state()['phases'][name]


def effective_strength(comp):
    cv = comp.op('modal_canvas')
    return float(comp.par.Canvasmix) if state()['scene'] and cv is not None and cv.par.active and not cv.errors() else 0.0


def live_source():
    return (op('/project1/inputs/river_cam_mod').module.fresh('river', 'sub')  # noqa: F821
            and not bool(op('/project1/inputs').par.Forceclip))  # noqa: F821


def effective_framing(comp):
    if not live_source():
        return 'original'
    selected = comp.par.Framing.eval()
    if selected == 'auto':
        detector = comp.op('view_detector')
        return detector.module.status()['profile'] if detector is not None else 'original'
    return selected


def status(comp):
    st = state()
    live = op('/project1/inputs/river_cam_mod').module.fresh('river', 'sub')  # noqa: F821
    forced = bool(op('/project1/inputs').par.Forceclip)  # noqa: F821
    return {'season': 'summer', 'intensity': float(comp.par.Intensity),
            'overlay': float(comp.par.Canvasmix), 'effective_overlay': effective_strength(comp),
            'framing': comp.par.Framing.eval() if hasattr(comp.par, 'Framing') else 'original',
            'screens': dict(screen_settings(comp), gavin_mix=round(screen_mix(), 4), current_mix=round(screen_weights()[0], 4), recorded_mix=round(screen_record_mix(), 4), fade_s=screen_fade.FADE_S, per_screen=[dict(current_mix=round(screen_weights(k)[0],4), gavin_mix=round(screen_weights(k)[1],4), recorded_mix=round(screen_weights(k)[2],4)) for k in range(4)]) if hasattr(comp.par, 'Screenmode') else None,
            'auto_view': comp.op('view_detector').module.status() if hasattr(comp.par, 'Framing') and comp.par.Framing.eval() == 'auto' and comp.op('view_detector') is not None else None,
            'effective_framing': effective_framing(comp) if hasattr(comp.par, 'Framing') else 'original',
            'scene': st['scene'], 'scene_age_s': st['scene_age_s'],
            'river_source': 'live' if live and not forced else 'recorded fallback'}
