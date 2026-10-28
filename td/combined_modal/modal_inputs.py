"""The Modal input selector inside TouchDesigner (module DAT /project1/viz/modal_inputs_mod). docs/modal-inputs.md.

frame(comp)       executeDAT onFrameStart: settings on the first frame, data every 2 s, fades, the scene ramp
target(op, name)  Script TOP onCook for the Modal Frames target of one element ('screen-1' .. 'ropes')
canvas_mix(), scene_mix(), factor(knob), element_mix(name), ripple_k(name), luma_alpha(name)   expressions
set_input(comp, source, strength, project_name)   mission control's modalinput action (td_mission.py)
status(comp)      td.modal_input in probe.ps1's status

Modal Frames journeys (OKLCH, numpy) run in one daemon worker thread; the TOPs only copy its newest arrays.
Live objects stay in sys.modules ('combined_modal_inputs_live'), never in COMP storage.
"""
import json
import math
import pathlib
import re
import sys
import threading
import time
import types

REPO = pathlib.Path('C:/Users/user/River/river-bitcube')
_HERE = str(REPO / 'td' / 'combined_modal')
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import numpy as np            # noqa: E402
import selector               # noqa: E402
import frames_journey         # noqa: E402

SHOW = 'river-combined-modal-inputs.toe'
RIVER = REPO.parent
SETTINGS = RIVER / 'combined-modal-inputs.json'
STATE_DIR = RIVER / 'gallery_state'
FRAMES_DIR = STATE_DIR / 'frames'
READ_S = 2.0
WORKER_STEP_S = 0.05
FRAMES_POLL_S = 1.0
ELEMENTS = frames_journey.ELEMENTS
LABEL = {'screen-1': 'screen 1', 'screen-2': 'screen 2', 'screen-3': 'screen 3', 'screen-4': 'screen 4', 'ropes': 'rope'}


def H():
    h = sys.modules.setdefault('combined_modal_inputs_live', types.ModuleType('combined_modal_inputs_live'))
    if not hasattr(h, 'st'):
        h.st = None
        h.lock = threading.Lock()
        h.worker = None
        h.out = {}                 # element -> contiguous float32 RGBA, bottom-up (TOP order)
        h.out_version = dict.fromkeys(ELEMENTS, 0)
        h.seen = {}                # Script TOP path -> version copied
    return h


def _st():
    h = H()
    if h.st is None:
        s = selector.load(SETTINGS)
        h.st = {'settings': s, 'fader': selector.Fader('off', s['strength']), 'scene': selector.Scene(),
                'frames': frames_journey.Frames(FRAMES_DIR), 'started': False, 'next_read': 0.0, 'last': None,
                'stale': dict.fromkeys(selector.SOURCES, (False, None)), 'ages': {}, 'scene_info': {},
                'canvas_ok': False, 'slots_written': None, 'error': None, 'worker_error': None,
                'frames_quiet': (None, True, 'not read yet'), 'journal': (None, None)}
    return h.st


# ---- worker: Modal Frames -----------------------------------------------------------------------------------------

def _publish(h, fr):
    for name in ELEMENTS:
        if h.out_version[name] != fr.versions[name] and fr.elements[name].now is not None:
            rgb = fr.elements[name].now
            rgba = np.ones(rgb.shape[:2] + (4,), dtype=np.float32)
            rgba[:, :, :3] = rgb
            h.out[name] = np.ascontiguousarray(rgba[::-1])     # TOP rows are bottom-up
            h.out_version[name] = fr.versions[name]


def _work(h):
    next_poll = 0.0
    while not getattr(h, 'stop', False):
        st = h.st
        try:
            now = time.monotonic()
            fr = st['frames']
            if now >= next_poll:
                next_poll = now + FRAMES_POLL_S
                fr.poll(now, time.time())
                st['frames_quiet'] = fr.quiet(time.time())
            fr.step(now)
            _publish(h, fr)
            st['worker_error'] = None
        except Exception as e:                                  # noqa: BLE001 - never stop the show
            st['worker_error'] = repr(e)[:200]
        time.sleep(WORKER_STEP_S)


def _ensure_worker():
    h = H()
    if h.worker is None or not h.worker.is_alive():
        h.stop = False
        h.worker = threading.Thread(target=_work, args=(h,), name='modal_frames_worker', daemon=True)
        h.worker.start()


def stop_worker():
    h = H()
    h.stop = True


# ---- reading the scene / canvas -------------------------------------------------------------------------------------

def _read(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def _newest_mirror_age(now_wall):
    ages = []
    for n in ('state.json', 'status.json', 'reflex.json', 'pad.json'):
        try:
            ages.append(now_wall - (STATE_DIR / n).stat().st_mtime)
        except OSError:
            pass
    return max(0, round(min(ages))) if ages else None


def _canvas_ok(comp, scene_present):
    cv = comp.op('modal_canvas')
    if cv is None or not cv.par.active:
        return False, "Dave's canvas renderer is off"
    if cv.errors():
        return False, "Dave's canvas renderer has an error"
    if not scene_present:
        return False, "Dave's agent has no scene for the canvas"
    return True, None


def _refresh(comp, st, now, now_wall):
    state = _read(STATE_DIR / 'state.json')
    reflex = _read(STATE_DIR / 'reflex.json')
    st['scene'].update(state, reflex, now, now_wall)
    ok, age, reason, info = selector.scene_info(state, now_wall)
    st['scene_info'] = dict(info, ok=ok, age_s=age)
    scene_present = bool(state and (state.get('scene') or {}) and not (state.get('scene') or {}).get('placeholder'))
    c_ok, c_reason = _canvas_ok(comp, scene_present)
    st['canvas_ok'] = c_ok
    st['ages'] = {'canvas': _newest_mirror_age(now_wall), 'scene': age}
    q_since, q_stale, q_reason = st['frames_quiet']
    st['stale'] = {'off': (False, None), 'canvas': (not c_ok, c_reason), 'scene': (not ok, reason),
                   'frames': (bool(q_stale), q_reason if q_stale else None)}


def effective_source(st):
    s = st['settings']['source']
    return 'off' if s == 'off' or st['stale'][s][0] else s


def frame(comp):
    st = _st()
    now, now_wall = time.monotonic(), time.time()
    if not st['started']:
        st['started'] = True
        _ensure_worker()
        st['frames_quiet'] = (None, True, 'not read yet')
    try:
        if now >= st['next_read']:
            st['next_read'] = now + READ_S
            _refresh(comp, st, now, now_wall)
            eff = effective_source(st)
            st['fader'].aim(eff, now, selector.STALE_FADE_S.get(st['settings']['source'], selector.FADE_S)
                            if eff == 'off' and st['settings']['source'] != 'off' else selector.FADE_S)
        dt = 0.0 if st['last'] is None else max(0.0, min(0.25, now - st['last']))
        st['last'] = now
        st['fader'].step(now)
        st['scene'].smooth_reflex(dt)
        _write_ramp(comp, st, now)
        st['error'] = None
    except Exception as e:                                       # noqa: BLE001 - never stop the show
        st['error'] = repr(e)[:200]
    if H().worker is None or not H().worker.is_alive():
        _ensure_worker()


def _write_ramp(comp, st, now):
    slots = st['scene'].slots(now)
    t = comp.op('scene_keys')
    if not slots or t is None:
        return
    rows = selector.ramp_rows(slots)
    key = tuple(round(v, 3) for r in rows for v in r)
    if key == st['slots_written'] and t.numRows == len(rows) + 1:
        return
    st['slots_written'] = key
    if t.numRows != len(rows) + 1:
        t.clear()
        t.appendRow(['pos', 'r', 'g', 'b', 'a'])
        for r in rows:
            t.appendRow([round(v, 4) for v in r])
    else:
        for i, r in enumerate(rows, start=1):
            for j, v in enumerate(r):
                t[i, j] = round(v, 4)


# ---- expressions ------------------------------------------------------------------------------------------------------

def _mix(source):
    st = _st()
    return st['fader'].mix(source, time.monotonic())


def canvas_mix():
    return _mix('canvas')


def scene_mix():
    """How far the scene recolours the river (0 = Combined's summer palette)."""
    return _mix('scene') if _st()['scene'].palette is not None else 0.0


def factor(knob):
    """The multiplier on Combined's summer effects for 'speed', 'density', 'brightness' or 'turbulence'."""
    st = _st()
    m = _mix('scene')
    if m <= 0:
        return 1.0
    return selector.applied(selector.factors(st['scene'].effective(time.monotonic()))[knob], m)


def element_mix(name):
    st = _st()
    return _mix('frames') if st['frames'].has_target(name) else 0.0


def _river(name):
    return _st()['frames'].elements[name].river(time.monotonic())


def ripple_k(name):
    """gain = 1 + k (luma - mean): k = amount x contrast x 2 (SPEC §6.3)."""
    r = _river(name)
    return r['amount'] * r['contrast'] * 2.0


def luma_alpha(name, fps=60.0):
    """Per-frame smoothing of the river luma: speed >= 1 = the river as it is; slower speeds smooth its changes
    (a time constant of (1/speed - 1) x 0.5 s). The live river can't play faster than the camera."""
    speed = max(0.25, _river(name)['speed'])
    if speed >= 1.0:
        return 1.0
    tau = (1.0 / speed - 1.0) * 0.5
    return 1.0 - math.exp(-1.0 / (max(1.0, fps) * tau))


def target(script_op, name):
    """Script TOP onCook: copy the element's newest target-now array (black until one has arrived)."""
    h = H()
    a = h.out.get(name)
    key = script_op.path
    v = h.out_version.get(name, 0) if a is not None else -1
    if h.seen.get(key) == v:
        return
    if a is None:
        w, hh = frames_journey.SIZES[name]
        a = np.zeros((hh, w, 4), dtype=np.float32)
        a[:, :, 3] = 1
    script_op.copyNumpyArray(a)
    h.seen[key] = v


# ---- control and status -----------------------------------------------------------------------------------------------

def set_input(comp, source, strength, project_name):
    if project_name != SHOW:
        raise ValueError('the Modal input selector is only available while Combined with Modal Input Selector is running')
    s = selector.checked(source, strength)
    s = selector.save(SETTINGS, s)                # persist first: a disk error must not claim a saved change
    st = _st()
    now = time.monotonic()
    st['settings'] = s
    st['fader'].set_strength(s['strength'], now)
    _refresh(comp, st, now, time.time())
    st['fader'].aim(effective_source(st), now)
    return s


def _journal():
    st = _st()
    path = STATE_DIR / 'journal_recent.json'
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    if st['journal'][0] == mtime:
        return st['journal'][1]
    text = None
    try:
        data = json.loads(path.read_text(encoding='utf-8', errors='replace'))
        entries = data.get('entries') if isinstance(data, dict) else data
        entries = [e for e in entries or [] if isinstance(e, dict)]
        if entries:
            e = max(entries, key=lambda x: x.get('tick') if isinstance(x.get('tick'), (int, float)) else -1)
            for k in ('reflection', 'text', 'entry', 'note', 'summary'):
                if isinstance(e.get(k), str) and e[k].strip():
                    text = e[k].strip()
                    break
        if text:
            m = re.match(r'(.+?[.!?])(\s|$)', ' '.join(text.split()))
            text = m.group(1) if m else text
    except (OSError, ValueError, AttributeError):
        text = None
    text = ' '.join(text.split())[:200] if text else None
    st['journal'] = (mtime, text)
    return text


def status(comp):
    st = _st()
    now, now_wall = time.monotonic(), time.time()
    s = st['settings']
    eff = effective_source(st)
    fr = st['frames']
    q_since, q_stale, q_reason = st['frames_quiet']
    sync = fr.sync or {}
    last_ok = sync.get('last_ok_epoch')
    rejected = sync.get('rejected')
    frames_age = round(now_wall - fr.arrived) if fr.arrived else None
    sources = {
        'canvas': {'ok': bool(st['canvas_ok']), 'age_s': st['ages'].get('canvas')},
        'scene': {'ok': bool(st['scene_info'].get('ok')), 'age_s': st['scene_info'].get('age_s'),
                  'set_at': st['scene_info'].get('set_at'), 'palette_name': st['scene_info'].get('palette_name'),
                  'animation': st['scene_info'].get('animation'), 'journal': _journal()},
        'frames': {'ok': fr.frame_id is not None and not q_stale, 'age_s': frames_age, 'frame_id': fr.frame_id,
                   'note': (fr.manifest or {}).get('note'), 'quiet': q_since is not None,
                   'rejected': {'frame_id': rejected.get('frame_id'), 'reason': rejected.get('reason')} if isinstance(rejected, dict) else None,
                   'sync': {'ok': isinstance(last_ok, (int, float)) and now_wall - last_ok <= frames_journey.POLL_DEAD_S,
                            'age_s': round(now_wall - last_ok) if isinstance(last_ok, (int, float)) else None,
                            'error': sync.get('error')}},
    }
    if eff == 'scene':
        params = st['scene'].params(now, st['fader'].mix('scene', now))
    elif eff == 'frames':
        params = []
        for name in ELEMENTS:
            el = fr.elements[name]
            r = el.river(now)
            v = {'amount': round(r['amount'], 3), 'contrast': round(r['contrast'], 3), 'speed': round(r['speed'], 3),
                 'journey': el.progress(now)}
            params.append({'name': name, 'value': v, 'mix': round(element_mix(name), 3),
                           'image': f'/frames/{el.ref}.png' if el.ref else None,
                           'drives': f'{LABEL[name]} target picture x river ripple'})
    elif eff == 'canvas':
        info = st['scene_info']
        params = [{'name': 'canvas', 'value': f"{info.get('animation') or '?'} / {info.get('palette_name') or '?'}",
                   'drives': 'additive overlay'}]
    else:
        params = []
    chosen = s['source']
    stale, reason = st['stale'][chosen] if chosen != 'off' else (False, None)
    data_age = None if chosen == 'off' else sources[chosen]['age_s']
    out = {'source': chosen, 'strength': s['strength'], 'effective_source': eff,
           'fading': bool(st['fader'].fading(now)), 'stale': bool(stale), 'stale_reason': reason, 'data_age_s': data_age,
           'mix': {k: round(st['fader'].mix(k, now), 3) for k in ('canvas', 'scene', 'frames')},
           'sources': sources, 'params': params}
    if st['error'] or st['worker_error']:
        out['error'] = st['error'] or st['worker_error']
    return out
