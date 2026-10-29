"""Manual overrides of the remembered river's parameters (v2 plan decision 6; docs/remembered-river.md section 5): the
control.json "overrides" block, validated by control_schema.validate_overrides, applied here. Plain Python.

For each parameter the show drives (control_schema.PARAMS) the show computes its own value (auto) and then asks
    value, how = apply(name, auto, overrides, now)
how is what status.json reports under params.<name>: {mode, auto, value, source: auto|fixed|adjusted, expires_in_s}.
simulated_people() gives the stand-in headcount and lingerer rope while someone simulates people (2 minutes at most).
"""
import math

try:
    from . import control_schema as cs
except ImportError:                                            # run outside the package (tools, a TD text DAT)
    import control_schema as cs

PARAMS = cs.PARAMS
SOURCES = {'auto': 'auto', 'fix': 'fixed', 'adjust': 'adjusted'}


def _expires_t(entry):
    return cs.to_epoch(entry.get('expires_at')) if entry.get('expires_at') else None


def entry(name, overrides, now):
    """The override entry for name that holds at now (a validated entry, see control_schema.override_entry), or None.
    overrides may be the raw control.json block or validate_overrides' output: each entry is checked again here, so an
    entry that expired since it was validated drops out at once."""
    if not isinstance(overrides, dict):
        return None
    return cs.override_entry(name, overrides.get(name), now)


def _clamp(name, v):
    p = PARAMS[name]
    v = min(p['max'], max(p['min'], v))
    return int(round(v)) if p['type'] == 'int' else v


def apply(name, auto_value, overrides, now):
    """The parameter's value now and how it came about: (value, how).
    auto_value: what the show computed (None: it has nothing, e.g. no river camera). fix: the override's value; adjust:
    auto_value * gain + offset clamped to the parameter's range (an auto_value of None stays None: nothing to adjust).
    how = {'mode': auto|fix|adjust, 'auto': auto_value, 'value': value, 'source': auto|fixed|adjusted,
           'expires_in_s': seconds left (None: sticky)}."""
    if name not in PARAMS:
        raise KeyError(f'not an overridable parameter: {name}')
    e = entry(name, overrides, now)
    value, mode = auto_value, 'auto'
    if e is not None and e['mode'] == 'fix':
        value, mode = (list(e['value']) if isinstance(e['value'], list) else e['value']), 'fix'
    elif e is not None and e['mode'] == 'adjust' and isinstance(auto_value, (int, float)) \
            and not isinstance(auto_value, bool) and math.isfinite(auto_value):
        value, mode = _clamp(name, float(auto_value) * e['gain'] + e['offset']), 'adjust'
    exp = _expires_t(e) if mode != 'auto' else None
    how = {'mode': mode, 'auto': auto_value, 'value': value, 'source': SOURCES[mode],
           'expires_in_s': None if exp is None else max(0, int(math.ceil(exp - now)))}
    return value, how


def apply_all(autos, overrides, now):
    """{name: auto_value} -> ({name: value}, {name: how}) for every name in autos."""
    values, hows = {}, {}
    for name, auto in autos.items():
        values[name], hows[name] = apply(name, auto, overrides, now)
    return values, hows


def active(overrides, now):
    """The overrides holding at now, as status.json reports them: {name: {mode, value?, offset?, gain?, at, expires_at,
    expires_in_s, simulated}}."""
    out = {}
    for name in PARAMS:
        e = entry(name, overrides, now)
        if e is None:
            continue
        exp = _expires_t(e)
        out[name] = dict(e, expires_in_s=None if exp is None else max(0, int(math.ceil(exp - now))),
                         simulated=bool(PARAMS[name].get('simulated')))
    return out


def simulated_people(overrides, now):
    """(headcount, lingerer_rope) while someone simulates people (each None when not simulated): the show uses them in
    place of the counter's presence and lingerers. Each clears itself at most SIMULATED_MAX_S after it was set."""
    hc = entry('headcount', overrides, now)
    lr = entry('lingerer_rope', overrides, now)
    return (None if hc is None else hc['value'], None if lr is None else lr['value'])


def simulating(overrides, now):
    """Whether any simulated input (headcount, a lingerer) is in force: the page shows its red SIMULATING banner."""
    return any(v is not None for v in simulated_people(overrides, now))
