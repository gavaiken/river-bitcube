"""The river (all looks), river-looks.toe (milestone M8, 27 Oct): several looks in one show file, moved between by fading
to black and back in, never by restarting TouchDesigner. numpy only.

Looks: the remembered river (td/remembered/show.py), Fill my cup (simple) and Fill my cup (configurable)
(td/filling). Each draws the same two images: the ropes (20 x 400) and the screens (256 x 512). Only the look on the
lights runs.

  auto     four loops of the remembered river, then one full cycle of Fill my cup (simple) (from an empty cup), again;
           a flood day (the remembered day's flow in the top 10 % of the record, FLOOD_PCT) brings the fill on right
           after that loop (M6: the fill as the river's flood)
  manual   fade to the chosen look and stay on it, looping
Control: River\\looks\\control.json {"mode": "auto" | "manual", "look": ...}; status: River\\looks\\status.json twice a
second {t, show, mode, look, target, fading, fade, auto: {remembered_loops, next}, looks}. The looks' own controls stay
where they were: River\\remembered\\control.json, River\\filling\\control.json.
"""
import json
import sys
import time
import types
from pathlib import Path

import numpy as np

from remembered import files   # td/ is on sys.path (the builds, the tests)

LOOKS = ('remembered', 'fill-simple', 'fill-configurable', 'seasons', 'modal')
UNIT = {'remembered': 'loops', 'fill-simple': 'cycles', 'fill-configurable': 'cycles', 'seasons': 'minutes', 'modal': 'minutes'}
OPERATOR = ('seasons', 'modal')     # looks that are TouchDesigner networks (a COMP each), not numpy frames
FADE_S = 2.0                        # to black, and back in
AUTO_REMEMBERED_LOOPS = 4
DEFAULT_PLAYLIST = ({'look': 'remembered', 'for': {'loops': AUTO_REMEMBERED_LOOPS}}, {'look': 'fill-simple', 'for': {'cycles': 1}})
FLOOD_PCT = 90                      # a remembered day this high in the record is a flood: the fill follows it (M6)
MAX_ENTRIES, MAX_COUNT, MAX_MINUTES = 12, 20, 120
RIVER = files.RIVER
SHOW = 'river-looks.toe'


def check_playlist(pl, available=LOOKS):
    """A playlist from control.json -> a clean list of {look, for: {unit: n}}, or None if it isn't one (the default
    then plays). Units: loops only for the remembered river, cycles only for the fills, minutes (1..120) for any."""
    if not isinstance(pl, list) or not 1 <= len(pl) <= MAX_ENTRIES:
        return None
    out = []
    for e in pl:
        if not isinstance(e, dict) or e.get('look') not in available or not isinstance(e.get('for'), dict) or len(e['for']) != 1:
            return None
        (unit, n), = e['for'].items()
        if isinstance(n, bool) or not isinstance(n, (int, float)) or n != int(n):
            return None
        n = int(n)
        if unit == 'minutes':
            if not 1 <= n <= MAX_MINUTES:
                return None
        elif unit != UNIT[e['look']] or not 1 <= n <= MAX_COUNT:
            return None
        out.append({'look': e['look'], 'for': {unit: n}})
    return out


class Looks:
    """Which look is on the lights, and how bright (the fade). Pure: time and the looks' progress are passed in.
    auto plays the playlist in a loop (each entry for so many loops, cycles or minutes); manual pins a look."""

    def __init__(self, mode='auto', look='remembered', playlist=None, available=LOOKS, now=0.0):
        self.available = tuple(l for l in LOOKS if l in available)
        self.playlist = check_playlist(playlist, self.available) or check_playlist(list(DEFAULT_PLAYLIST), self.available) \
            or [{'look': self.available[0], 'for': {'minutes': 3}}]
        self.position = 0
        self.mode = mode
        self.target = look if look in self.available else self.playlist[0]['look']
        self.look = self.target if mode == 'manual' else self.playlist[0]['look']
        self.fading = None           # 'out' (current to black) | 'in' (new from black) | None
        self.fade = 1.0
        self.loops_done = 0
        self.last_loop = None
        self.started = None          # a fill's cycle time when it came on (auto: one full cycle)
        self.came_on = now           # when the look showing came on (minutes entries)
        self.now = now
        self.flood = False           # the remembered day playing now is a flood (M6)
        self.why = None              # why the look changes next, in words (status)
        self.fill_seen_end = False

    # ---- the playlist ------------------------------------------------------------------------------------------------
    @property
    def entry(self):
        return self.playlist[self.position % len(self.playlist)]

    def _next_position(self):
        return (self.position + 1) % len(self.playlist)

    def set(self, control):
        c = control or {}
        mode = c.get('mode') if c.get('mode') in ('auto', 'manual') else self.mode
        pl = check_playlist(c.get('playlist'), self.available) if 'playlist' in c else None
        if pl is not None and pl != self.playlist:
            self.playlist = pl                                   # keep our place by the look showing, else start over
            at = [i for i, e in enumerate(pl) if e['look'] == self.look]
            self.position = at[0] if at else 0
            if not at and mode == 'auto':
                self.target, self.why = pl[0]['look'], 'a new playlist'
        if mode == 'manual' and c.get('look') in self.available:
            self.target = c['look']
        elif mode == 'auto' and self.mode != 'auto':
            at = [i for i, e in enumerate(self.playlist) if e['look'] == self.look]
            self.position = at[0] if at else 0
            self.target = self.look if at else self.playlist[0]['look']
            self.loops_done = 0
        self.mode = mode

    def _advance(self, why):
        self.position = self._next_position()
        self.target, self.why = self.entry['look'], why

    def auto_next(self, remembered_loop=None, fill_t=None, flow_pct=None, now=None):
        """In auto: the remembered river's loop index (and its day's flow percentile) while it shows; a fill's cycle
        time while it shows; the clock for minutes entries."""
        if now is not None:
            self.now = now
        if self.mode != 'auto' or self.fading:
            return
        e = self.entry
        (unit, n), = e['for'].items()
        if self.look == 'remembered' and remembered_loop is not None:
            if self.last_loop is None:
                self.last_loop = remembered_loop
            elif remembered_loop > self.last_loop:
                self.loops_done += remembered_loop - self.last_loop
                self.last_loop = remembered_loop
                nxt = self.playlist[self._next_position()]['look']
                if self.flood and nxt.startswith('fill'):        # the loop that just ended relived a flood
                    self._advance('a flood day')
                    return
            if self.target == 'remembered':
                self.flood = flow_pct is not None and flow_pct >= FLOOD_PCT
            if unit == 'loops' and self.loops_done >= n:
                self._advance(f'{n} loop{"s" if n != 1 else ""}')
        elif self.look.startswith('fill') and fill_t is not None:
            if self.started is not None and fill_t < self.started - 1:   # the cycle wrapped: one full fill and drain done
                self.loops_done += 1
                if unit == 'cycles' and self.loops_done >= n:
                    self._advance(f'{n} cycle{"s" if n != 1 else ""}')
            self.started = fill_t                                # where the cycle is now (the wrap test next time)
        if unit == 'minutes' and self.now - self.came_on >= n * 60 and self.target == self.look:
            self._advance(f'{n} minute{"s" if n != 1 else ""}')

    def step(self, dt):
        """Advance the fade. Returns True on the frame the look changes (at black)."""
        changed = False
        self.now += dt
        if self.fading is None and self.target != self.look:
            self.fading = 'out'
        if self.fading == 'out':
            self.fade = max(0.0, self.fade - dt / FADE_S)
            if self.fade <= 0.0:
                self.look = self.target
                self.fading = 'in'
                changed = True
                self.loops_done, self.last_loop, self.started, self.flood = 0, None, None, False
                self.came_on = self.now
        elif self.fading == 'in':
            self.fade = min(1.0, self.fade + dt / FADE_S)
            if self.fade >= 1.0:
                self.fading = None
        return changed

    def progress(self):
        e = self.entry
        (unit, n), = e['for'].items()
        done = int((self.now - self.came_on) // 60) if unit == 'minutes' else self.loops_done
        return {'done': min(done, n), 'of': n, 'unit': unit}

    def status(self, now):
        nxt = self.playlist[self._next_position()]['look'] if self.mode == 'auto' else None
        return {'t': now, 'show': SHOW, 'mode': self.mode, 'look': self.look, 'target': self.target,
                'fading': self.fading, 'fade': round(self.fade, 3),
                'auto': {'remembered_loops': self.loops_done, 'next': nxt, 'flood': self.flood, 'why': self.why},
                'playlist': self.playlist, 'position': self.position % len(self.playlist), 'progress': self.progress(),
                'looks': list(self.available)}


# ---- TouchDesigner side --------------------------------------------------------------------------------------------

def _holder():
    h = sys.modules.setdefault('looks_live', types.ModuleType('looks_live'))
    for k, v in (('looks', None), ('fills', {}), ('last', None), ('read_at', 0.0), ('wrote_at', 0.0), ('error', None),
                 ('ropes', None), ('panels', None), ('frame', 0), ('fill_t', {})):
        if not hasattr(h, k):
            setattr(h, k, v)
    return h


def reset():
    h = _holder()
    h.looks, h.fills, h.last, h.ropes, h.panels = None, {}, None, None, None


def _read(path):
    """A control file, parsed again only when it changed (files.read_json_cached; never change what comes back)."""
    return files.read_json_cached(path)[0]


def _write(path, data):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(data), encoding='utf-8')
        tmp.replace(path)
    except OSError:
        pass


def frame(comp):
    from remembered import show as rshow
    from filling import fill as ffill
    h = _holder()
    t_start = time.perf_counter()
    try:
        now = time.time()
        dt = 0.0 if h.last is None or now < h.last else min(0.25, now - h.last)
        h.last = now
        h.frame += 1
        if h.looks is None:
            c = _read(RIVER / 'looks' / 'control.json') or {}
            # the looks this file has: the numpy ones always; an operator look only if its COMP was built in
            avail = tuple(l for l in LOOKS if l not in OPERATOR or comp.op('/project1/' + l) is not None)
            h.looks = Looks(c.get('mode', 'auto'), c.get('look', 'remembered'), c.get('playlist'), available=avail, now=now)
        L = h.looks
        if now - h.read_at > 1.0:
            h.read_at = now
            L.set(_read(RIVER / 'looks' / 'control.json'))
            for f in h.fills.values():
                ffill.read_control(f)
        look = L.look
        if look in OPERATOR:                                      # a TouchDesigner network: its COMP draws; we only time it
            h.ropes, h.panels = None, None
            L.auto_next(now=now)
        elif look == 'remembered':
            s = rshow.step(comp)
            if s is not None:
                h.ropes, h.panels = s.rope_frame, s.panel_frame
                st = (s.loop.day or {}).get('stats') or {} if hasattr(s.loop, 'day') else {}
                try:
                    fp = float(st.get('flow_pct')) if st.get('flow_pct') is not None else None
                except (TypeError, ValueError):
                    fp = None
                L.auto_next(remembered_loop=s.loop.index, flow_pct=fp, now=now)
        else:
            variant = 'simple' if look == 'fill-simple' else 'configurable'
            f = h.fills.get(look)
            if f is None:
                mf, sf, zf = (getattr(comp.par, n).eval() if hasattr(comp.par, n) else '' for n in ('Mapfile', 'Screensfile', 'Zonesfile'))
                f = h.fills[look] = ffill.make_variant(variant, ffill.space_mod.Space(mf or None, sf or None, zf or None))
                ffill.read_control(f)
            if h.frame % 2 == 0 or h.ropes is None:              # the water at 30 Hz
                h.ropes, h.panels, t = f.frames(now)
                h.fill_t[look] = t
                L.auto_next(fill_t=t, now=now)
            if now - h.wrote_at > 0.5:
                ffill.write_status(f, now, h.fill_t.get(look, 0.0))
        if L.step(dt) and L.look.startswith('fill') and L.look in h.fills:
            fl = h.fills[L.look]                                  # a fill comes on from an empty cup
            fl.t, fl.last = 0.0, None
        _route(comp, L)
        if now - h.wrote_at > 0.5:
            h.wrote_at = now
            st = L.status(now)
            st['show'] = _project_name()
            try:                                                  # the live inputs and what the look did with them
                from looks import inputs as _inputs
                rs = rshow._holder().show
                st['inputs'] = _inputs.gather(RIVER, now, rs)
                st['used'] = _inputs.used_by(L.look, rs)
            except Exception as e:                                # noqa: BLE001
                st['inputs'], st['used'] = None, {'error': repr(e)}
            st['perf'] = {'python_ms': round(getattr(h, 'ms', 0.0), 2), 'cook_ms': round(getattr(h, 'cook_ms', 0.0), 2),
                          'frame_ms': round(getattr(h, 'frame_ms', 0.0), 2)}
            _write(RIVER / 'looks' / 'status.json', st)
        h.error = None
    except Exception as e:                                        # noqa: BLE001 - never stop the show
        h.error = repr(e)
    t_cook = time.perf_counter()
    for n in ('rope_render', 'panel_render', 'ribbon_params', 'river_mask'):
        o = comp.op(n)
        if o is not None:
            o.cook(force=True)
    t_end = time.perf_counter()
    # how long this costs, smoothed (status.json perf): our Python, drawing the two images, and the whole frame
    a = 0.05
    h.ms = getattr(h, 'ms', 0.0) * (1 - a) + (t_cook - t_start) * 1000 * a
    h.cook_ms = getattr(h, 'cook_ms', 0.0) * (1 - a) + (t_end - t_cook) * 1000 * a
    prev = getattr(h, 'prev_start', None)
    if prev is not None and 0 < t_start - prev < 1:
        h.frame_ms = getattr(h, 'frame_ms', 0.0) * (1 - a) + (t_start - prev) * 1000 * a
    h.prev_start = t_start


def _project_name():
    try:
        import td
        return td.project.name
    except Exception:                                             # noqa: BLE001
        return SHOW


def _route(comp, L):
    """The operator looks: their COMPs cook only while showing; outputs/look_src picks them over the numpy images and
    outputs/look_fade carries the fade for them (the numpy images carry their own). Never raises."""
    try:
        op_look = L.look if L.look in OPERATOR else None
        for name in OPERATOR:
            c = comp.op('/project1/' + name)
            if c is not None and c.allowCooking != (name == op_look):
                c.allowCooking = name == op_look
        out = comp.op('/project1/outputs')
        if out is None:
            return
        want = 1 + OPERATOR.index(op_look) if op_look else 0
        for sw in out.findChildren(name='look_src*', depth=1):
            if int(sw.par.index.eval()) != want:
                sw.par.index = want
        for lv in out.findChildren(name='look_fade*', depth=1):
            lv.par.brightness1 = L.fade if op_look else 1.0
    except Exception:                                             # noqa: BLE001
        pass


def cook(scriptOp):
    h = _holder()
    k = h.looks.fade if h.looks is not None else 1.0
    if scriptOp.name == 'ribbon_params':                        # the GPU ribbons: faded with the look, off for the fills
        from remembered import show as rshow
        on = h.looks is not None and h.looks.look == 'remembered'
        scriptOp.copyNumpyArray(rshow.params_image(rshow._holder().show, fade=k, on=on))
        return
    if scriptOp.name == 'river_mask':
        from remembered import show as rshow
        scriptOp.copyNumpyArray(rshow.mask_image(rshow._holder().show))
        return
    from remembered import show as rshow
    if scriptOp.name == 'rope_render':
        f = h.ropes
        if f is None:
            return
        img = rshow._rgba('mix_ropes', f.shape[1], f.shape[0])          # 20 wide, 400 tall, LED 0 on the top row
        np.multiply(f.transpose(1, 0, 2)[::-1], np.float32(k), out=img[..., :3])
    else:
        f = h.panels
        if f is None:
            return
        img = rshow._rgba('mix_panels', f.shape[0], f.shape[1])
        s = rshow._holder().show
        static = s is not None and f is s.panel_frame and getattr(s, 'panel_static', False)
        # the GPU ribbons' black frame: black at any fade, so converted once (it was ~1 ms a frame)
        if not (static and rshow._bufs.get('mix_panels_src') is f):
            np.multiply(f[::-1], np.float32(k), out=img[..., :3])
            rshow._bufs['mix_panels_src'] = f if static else None
    scriptOp.copyNumpyArray(img)
