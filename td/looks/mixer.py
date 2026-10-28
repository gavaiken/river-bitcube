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

LOOKS = ('remembered', 'fill-simple', 'fill-configurable')
FADE_S = 2.0                        # to black, and back in
AUTO_REMEMBERED_LOOPS = 4
FLOOD_PCT = 90                      # a remembered day this high in the record is a flood: the fill follows it (M6)
RIVER = Path(r'C:\Users\user\River')
SHOW = 'river-looks.toe'


class Looks:
    """Which look is on the lights, and how bright (the fade). Pure: time and the looks' progress are passed in."""

    def __init__(self, mode='auto', look='remembered'):
        self.mode = mode
        self.target = look if look in LOOKS else 'remembered'
        self.look = self.target if mode == 'manual' else 'remembered'
        self.fading = None           # 'out' (current to black) | 'in' (new from black) | None
        self.fade = 1.0
        self.loops_done = 0
        self.last_loop = None
        self.started = None          # a fill's cycle time when it came on (auto: one full cycle)
        self.flood = False           # the remembered day playing now is a flood (M6)
        self.why = None              # why the look changes next, in words (status)
        self.fill_seen_end = False

    def set(self, control):
        c = control or {}
        mode = c.get('mode') if c.get('mode') in ('auto', 'manual') else self.mode
        if mode == 'manual' and c.get('look') in LOOKS:
            self.target = c['look']
        elif mode == 'auto' and self.mode != 'auto':
            self.target = self.look if self.look == 'remembered' else 'remembered'
            self.loops_done = 0
        self.mode = mode

    def auto_next(self, remembered_loop=None, fill_t=None, flow_pct=None):
        """In auto: the remembered river's loop index (and its day's flow percentile) while it shows; a fill's cycle
        time while it shows."""
        if self.mode != 'auto' or self.fading:
            return
        if self.look == 'remembered' and remembered_loop is not None:
            if self.last_loop is None:
                self.last_loop = remembered_loop
            elif remembered_loop > self.last_loop:
                self.loops_done += remembered_loop - self.last_loop
                self.last_loop = remembered_loop
                if self.flood:                                   # the loop that just ended relived a flood
                    self.target, self.why = 'fill-simple', 'a flood day'
            if self.target == 'remembered':
                self.flood = flow_pct is not None and flow_pct >= FLOOD_PCT
            if self.loops_done >= AUTO_REMEMBERED_LOOPS:
                self.target, self.why = 'fill-simple', 'four loops'
        elif self.look.startswith('fill') and fill_t is not None:
            if self.started is None:
                self.started = fill_t
            elif fill_t < self.started - 1:                      # the cycle wrapped: one full fill and drain done
                self.target = 'remembered'

    def step(self, dt):
        """Advance the fade. Returns True on the frame the look changes (at black)."""
        changed = False
        if self.fading is None and self.target != self.look:
            self.fading = 'out'
        if self.fading == 'out':
            self.fade = max(0.0, self.fade - dt / FADE_S)
            if self.fade <= 0.0:
                self.look = self.target
                self.fading = 'in'
                changed = True
                self.loops_done, self.last_loop, self.started, self.flood = 0, None, None, False
        elif self.fading == 'in':
            self.fade = min(1.0, self.fade + dt / FADE_S)
            if self.fade >= 1.0:
                self.fading = None
        return changed

    def status(self, now):
        nxt = None
        if self.mode == 'auto':
            nxt = 'fill-simple' if self.look == 'remembered' else 'remembered'
        return {'t': now, 'show': SHOW, 'mode': self.mode, 'look': self.look, 'target': self.target,
                'fading': self.fading, 'fade': round(self.fade, 3),
                'auto': {'remembered_loops': self.loops_done, 'next': nxt, 'flood': self.flood, 'why': self.why},
                'looks': list(LOOKS)}


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
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None


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
    try:
        now = time.time()
        dt = 0.0 if h.last is None or now < h.last else min(0.25, now - h.last)
        h.last = now
        h.frame += 1
        if h.looks is None:
            c = _read(RIVER / 'looks' / 'control.json') or {}
            h.looks = Looks(c.get('mode', 'auto'), c.get('look', 'remembered'))
        L = h.looks
        if now - h.read_at > 1.0:
            h.read_at = now
            L.set(_read(RIVER / 'looks' / 'control.json'))
            for f in h.fills.values():
                ffill.read_control(f)
        look = L.look
        if look == 'remembered':
            s = rshow.step(comp)
            if s is not None:
                h.ropes, h.panels = s.rope_frame, s.panel_frame
                st = (s.loop.day or {}).get('stats') or {} if hasattr(s.loop, 'day') else {}
                try:
                    fp = float(st.get('flow_pct')) if st.get('flow_pct') is not None else None
                except (TypeError, ValueError):
                    fp = None
                L.auto_next(remembered_loop=s.loop.index, flow_pct=fp)
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
                L.auto_next(fill_t=t)
            if now - h.wrote_at > 0.5:
                ffill.write_status(f, now, h.fill_t.get(look, 0.0))
        if L.step(dt) and L.look.startswith('fill') and L.look in h.fills:
            fl = h.fills[L.look]                                  # a fill comes on from an empty cup
            fl.t, fl.last = 0.0, None
        if now - h.wrote_at > 0.5:
            h.wrote_at = now
            _write(RIVER / 'looks' / 'status.json', L.status(now))
        h.error = None
    except Exception as e:                                        # noqa: BLE001 - never stop the show
        h.error = repr(e)
    for n in ('rope_render', 'panel_render'):
        o = comp.op(n)
        if o is not None:
            o.cook(force=True)


def cook(scriptOp):
    h = _holder()
    k = h.looks.fade if h.looks is not None else 1.0
    if scriptOp.name == 'rope_render':
        f = h.ropes
        if f is None:
            return
        img = np.empty((f.shape[1], f.shape[0], 4), np.float32)          # 20 wide, 400 tall, LED 0 on the top row
        img[..., :3] = f.transpose(1, 0, 2)[::-1] * k
    else:
        f = h.panels
        if f is None:
            return
        img = np.empty((f.shape[0], f.shape[1], 4), np.float32)
        img[..., :3] = f[::-1] * k
    img[..., 3] = 1.0
    scriptOp.copyNumpyArray(np.ascontiguousarray(img))
