"""Screens-only look control, shared by runtime and tests. Three normalized weights: Current, Gavin-style live, Recorded river."""
import math

MODES = ('current', 'gavin', 'recorded', 'manual', 'cycle')
HOLDS = (15, 30, 60, 120)
FADE_S = 8.0
DEFAULT = {'mode': 'current', 'blend': 0.0, 'hold': 30, 'recorded': 0.0}


def checked(value):
    if not isinstance(value, dict) or value.get('mode') not in MODES:
        raise ValueError('unknown screen look mode')
    blend, hold = value.get('blend'), value.get('hold')
    if isinstance(blend, bool) or not isinstance(blend, (int, float)) or not math.isfinite(blend) or not 0 <= blend <= 1:
        raise ValueError('screen blend must be a number from 0 to 1')
    if isinstance(hold, bool) or not isinstance(hold, (int, float)) or hold not in HOLDS:
        raise ValueError('screen hold must be 15, 30, 60 or 120 seconds')
    recorded = value.get('recorded', 0.0)
    if isinstance(recorded, bool) or not isinstance(recorded, (int, float)) or not math.isfinite(recorded) or not 0 <= recorded <= 1:
        raise ValueError('recorded screen blend must be a number from 0 to 1')
    return {'mode': value['mode'], 'blend': float(blend), 'hold': int(hold), 'recorded': float(recorded)}


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def weights(settings, elapsed):
    mode, blend, hold = settings['mode'], settings['blend'], settings['hold']
    if mode == 'current':
        return (1.0, 0.0, 0.0)
    if mode == 'gavin':
        return (0.0, 1.0, 0.0)
    if mode == 'recorded':
        return (0.0, 0.0, 1.0)
    if mode == 'manual':
        recorded = settings.get('recorded', 0.0)
        return ((1 - blend) * (1 - recorded), blend * (1 - recorded), recorded)
    # Current -> Gavin live -> Recorded -> Current, with the same hold/fade on every leg.
    span = hold + FADE_S
    t = max(0, elapsed) % (3 * span)
    index = int(t // span)
    fade = smooth((t % span - hold) / FADE_S)
    result = [0.0, 0.0, 0.0]
    result[index], result[(index + 1) % 3] = 1 - fade, fade
    return tuple(result)


def amount(settings, elapsed):
    """Actual Gavin-live share; retained for existing callers."""
    return weights(settings, elapsed)[1]


def step(st, settings, now):
    signature = (settings['mode'], settings['blend'], settings['hold'], settings.get('recorded', 0.0))
    if st.get('screen_signature') != signature:
        old_gavin = st.get('screen_mix', 0.0)
        previous = st.get('screen_weights', (1 - old_gavin, old_gavin, 0.0))
        st.update(screen_signature=signature, screen_origin=now, screen_from_weights=previous)
    elapsed = max(0, now - st['screen_origin'])
    target = weights(settings, elapsed)
    w = smooth(elapsed / FADE_S)
    st['screen_weights'] = tuple(a * (1 - w) + b * w for a, b in zip(st['screen_from_weights'], target))
    st['screen_mix'] = st['screen_weights'][1]
    return st['screen_mix']
