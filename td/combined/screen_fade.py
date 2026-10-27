"""Screens-only look control, shared by runtime and tests. Blend 0=current, 1=Gavin style."""
import math

MODES = ('current', 'gavin', 'manual', 'cycle')
HOLDS = (15, 30, 60, 120)
FADE_S = 8.0
DEFAULT = {'mode': 'current', 'blend': 0.0, 'hold': 30}


def checked(value):
    if not isinstance(value, dict) or value.get('mode') not in MODES:
        raise ValueError('unknown screen look mode')
    blend, hold = value.get('blend'), value.get('hold')
    if isinstance(blend, bool) or not isinstance(blend, (int, float)) or not math.isfinite(blend) or not 0 <= blend <= 1:
        raise ValueError('screen blend must be a number from 0 to 1')
    if isinstance(hold, bool) or not isinstance(hold, (int, float)) or hold not in HOLDS:
        raise ValueError('screen hold must be 15, 30, 60 or 120 seconds')
    return {'mode': value['mode'], 'blend': float(blend), 'hold': int(hold)}


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def amount(settings, elapsed):
    mode, blend, hold = settings['mode'], settings['blend'], settings['hold']
    if mode == 'current':
        return 0.0
    if mode == 'gavin':
        return 1.0
    if mode == 'manual':
        return blend
    t = max(0, elapsed) % (2 * (hold + FADE_S))
    if t < hold:
        return 0.0
    if t < hold + FADE_S:
        return smooth((t - hold) / FADE_S)
    if t < 2 * hold + FADE_S:
        return 1.0
    return 1 - smooth((t - 2 * hold - FADE_S) / FADE_S)


def step(st, settings, now):
    signature = (settings['mode'], settings['blend'], settings['hold'])
    if st.get('screen_signature') != signature:
        st.update(screen_signature=signature, screen_origin=now,
                  screen_from=st.get('screen_mix', 0.0))
    elapsed = max(0, now - st['screen_origin'])
    target = amount(settings, elapsed)
    # Changing modes or applying a manual blend also fades instead of cutting.
    w = smooth(elapsed / FADE_S)
    st['screen_mix'] = st['screen_from'] * (1 - w) + target * w
    return st['screen_mix']
