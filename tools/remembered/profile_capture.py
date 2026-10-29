"""Temporary timings around the existing callbacks of river-all-looks-v2.toe; never saves or changes controls.
Run through tools/td.ps1. CAPTURE_ACTION='status'|'stop'; default start, CAPTURE_SECONDS=1500.
State and open files live outside comp.storage; wrappers automatically remove themselves.
Start refuses on the frozen river-all-looks.toe (runtime_guard.py: its modules come from the pinned v1 checkout); status and
stop always work. Sections are v2's (29 Oct, step 5): the river frame's luma (motion.river_luma), then Motion.feed_luma and
Water.feed_luma (Water.feed and panels.py are gone).
"""
import csv
import functools
import importlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import types

KEY = '_river_full_cycle_profile'
SECTIONS = ('remembered_step', 'show_tick', 'field_step', 'field_ropes', 'field_screens', 'rope_step', 'river_luma', 'motion_feed',
            'water_feed', 'water_step', 'fill_frames')
REPLACED = 'the same capture, timing the v2 sections (river_luma, Motion.feed_luma, Water.feed_luma; no panels)'


def sections(show, ribbons, ropes, motion, water, fill):
    """(object, attribute, label) for every timed section, on the v2 modules."""
    return ((show, 'step', 'remembered_step'), (show.Show, 'tick', 'show_tick'),
            (ribbons.Ribbons, 'step', 'field_step'), (ribbons.Ribbons, 'render_ropes', 'field_ropes'),
            (ribbons.Ribbons, 'render_screens', 'field_screens'), (ropes.Ropes, 'step', 'rope_step'),
            (motion, 'river_luma', 'river_luma'), (motion.Motion, 'feed_luma', 'motion_feed'),
            (water.Water, 'feed_luma', 'water_feed'), (water.Water, 'step', 'water_step'), (fill.Fill, 'frames', 'fill_frames'))


def _guard():
    here = globals().get('__file__')
    folder = str(Path(here).resolve().parent) if here and (Path(here).resolve().parent / 'runtime_guard.py').is_file() \
        else 'C:/Users/user/River/river-bitcube/tools/remembered'
    if folder not in sys.path:
        sys.path.insert(0, folder)
    import runtime_guard
    return importlib.reload(runtime_guard)
FIELDS = ('kind', 'epoch', 'elapsed_s', 'frame', 'interval_ms', 'callback_ms', 'probe_ms', 'look', 'position', 'loop', 'clip',
          'sent', 'send_gap_ms', 'dropped', *[n + '_ms' for n in SECTIONS], 'draw_cpu_ms', 'draw_gpu_ms', 'river_cpu_ms', 'river_gpu_ms', 'trail_gpu_ms')


class Capture:
    def __init__(self, out, seconds=1500):
        self.out = Path(out)
        self.out.mkdir(parents=True, exist_ok=False)
        self.seconds = seconds
        self.start = time.perf_counter()
        self.started_epoch = time.time()
        self.previous = None
        self.active = True
        self.patches = []
        self.acc = {}
        self.buffer = []
        self.q = queue.Queue(maxsize=128)
        self.rows = 0
        self.lost = 0
        self.last_sent_at = None
        self.metadata = {'pid': os.getpid(), 'start_epoch': self.started_epoch, 'duration_s': seconds, 'state': 'running',
                         'timings': 'Section times are inclusive/nested. GPU cook times are TD-reported values; no image readbacks.'}
        self.writer = threading.Thread(target=self._write, daemon=True)
        self.writer.start()

    def _write(self):
        try:
            with (self.out / 'events.csv').open('w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=FIELDS)
                w.writeheader()
                (self.out / 'capture.json').write_text(json.dumps(self.metadata, indent=2))
                while True:
                    try:
                        batch = self.q.get(timeout=.5)
                    except queue.Empty:
                        if not self.active:
                            break
                        continue
                    if batch is None:
                        break
                    w.writerows(batch)
                    self.rows += len(batch)
                    f.flush()
                f.flush()
            self.metadata.update(state='complete', end_epoch=time.time(), rows=self.rows, lost_rows=self.lost)
            (self.out / 'capture.json').write_text(json.dumps(self.metadata, indent=2))
        except Exception as e:
            self.metadata.update(state='writer_error', error=repr(e))
            (self.out / 'capture.json').write_text(json.dumps(self.metadata, indent=2))

    def emit(self, row):
        self.buffer.append(row)
        if len(self.buffer) >= 120:
            self.flush()

    def flush(self):
        batch, self.buffer = self.buffer, []
        if batch:
            try:
                self.q.put_nowait(batch)
            except queue.Full:
                self.lost += len(batch)

    def stop(self):
        if not self.active:
            return
        self.active = False
        for obj, name, original, wrapper in reversed(self.patches):
            if getattr(obj, name) is wrapper:
                setattr(obj, name, original)
        self.flush()
        # Queue capacity is many seconds of batches; do not block TD on disk.
        try:
            self.q.put_nowait(None)
        except queue.Full:
            self.metadata.update(state='stop_queue_full')

    def patch_section(self, obj, name, label):
        original = getattr(obj, name)
        @functools.wraps(original)
        def wrapper(*a, **kw):
            t = time.perf_counter()
            try:
                return original(*a, **kw)
            finally:
                self.acc[label] = self.acc.get(label, 0.0) + (time.perf_counter() - t) * 1000
        setattr(obj, name, wrapper)
        self.patches.append((obj, name, original, wrapper))

    def patch_frame(self, module, tags, metrics):
        original = module.frame
        @functools.wraps(original)
        def wrapper(*a, **kw):
            if not self.active or time.perf_counter() - self.start >= self.seconds:
                self.stop()
                return original(*a, **kw)
            t = time.perf_counter()
            interval = None if self.previous is None else (t - self.previous) * 1000
            self.previous = t
            self.acc = {}
            try:
                return original(*a, **kw)
            finally:
                end = time.perf_counter()
                row = dict(kind='frame', epoch=time.time(), elapsed_s=end-self.start, interval_ms=interval, callback_ms=(end-t)*1000)
                row.update({k+'_ms': v for k,v in self.acc.items()})
                try:
                    row.update(tags())
                    row.update(metrics())
                except Exception:
                    pass
                row['probe_ms'] = (time.perf_counter() - end) * 1000
                self.emit(row)
        module.frame = wrapper
        self.patches.append((module, 'frame', original, wrapper))

    def patch_artnet(self, module):
        original = module.tick
        @functools.wraps(original)
        def wrapper(comp):
            if not self.active:
                return original(comp)
            before = comp.storage.get('sent', 0)
            t = time.perf_counter()
            try:
                return original(comp)
            finally:
                end = time.perf_counter()
                sent = comp.storage.get('sent', 0)
                if sent != before or end-t > .01:
                    gap = None if self.last_sent_at is None else (t-self.last_sent_at)*1000
                    if sent != before:
                        self.last_sent_at = t
                    self.emit(dict(kind='artnet', epoch=time.time(), elapsed_s=end-self.start,
                                   callback_ms=(end-t)*1000, sent=sent, dropped=comp.storage.get('dropped', 0), send_gap_ms=gap))
        module.tick = wrapper
        self.patches.append((module, 'tick', original, wrapper))


def run_td(op, project, action='start', seconds=1500):
    holder = sys.modules.setdefault(KEY, types.ModuleType(KEY))
    existing = getattr(holder, 'capture', None)
    if action == 'status':
        print(json.dumps({'active': bool(existing and existing.active), 'out': str(existing.out) if existing else None,
                          'elapsed_s': time.perf_counter()-existing.start if existing else None}))
        return
    if action == 'stop':
        if existing:
            existing.stop()
        print('Profiler stopped; original functions restored')
        return
    _guard().check('profile_capture.py', project=project, replaced=REPLACED)
    if existing and existing.active:
        raise RuntimeError('An active profiler already exists; nothing changed')
    from looks import mixer
    from remembered import show, ribbons, ropes, motion, water
    from filling import fill
    if mixer._holder().looks is None:
        raise RuntimeError('Playlist not initialized')
    out = Path('C:/Users/user/River/profiles') / ('cycle-' + time.strftime('%Y%m%d-%H%M%S'))
    cap = Capture(out, seconds)
    try:
        for obj,name,label in sections(show, ribbons, ropes, motion, water, fill):
            cap.patch_section(obj,name,label)
        cache = {'at': 0, 'clip': ''}
        def tags():
            h=mixer._holder();s=show._holder().show
            now=time.perf_counter()
            if now-cache['at'] > 1:
                cache.update(at=now,clip=op('/project1/remembered/fallback_clip').par.file.eval())
            return {'frame':h.frame,'look':h.looks.look,'position':h.looks.position,'loop':s.loop.index if s else None,'clip':cache['clip']}
        nodes={k:op('/project1/remembered/'+n) for k,n in [('draw','ribbons_draw'),('river','river_gpu'),('trail','ribbons_trail')]}
        def metrics():
            return {'draw_cpu_ms':nodes['draw'].cpuCookTime, 'draw_gpu_ms':nodes['draw'].gpuCookTime,
                    'river_cpu_ms':nodes['river'].cpuCookTime, 'river_gpu_ms':nodes['river'].gpuCookTime,
                    'trail_gpu_ms':nodes['trail'].gpuCookTime}
        cap.patch_artnet(op('/project1/ropes/artnet_out').module)
        cap.patch_frame(mixer,tags,metrics)
        holder.capture = cap
        # OS sampling runs in another process; no WMI queries, GPU readback or CPU profiler hooks on TD's frame thread.
        script=Path('C:/Users/user/River/river-bitcube/tools/remembered/profile_system.py')
        with (out/'system.log').open('w') as log:
            child=subprocess.Popen(['C:/Users/user/River/river-bitcube/.venv/Scripts/python.exe',str(script),str(os.getpid()),str(seconds+5),str(out)],
                                   stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        cap.metadata['system_pid']=child.pid
        (out/'metadata.json').write_text(json.dumps(cap.metadata,indent=2))
        print(json.dumps({'active':True,'out':str(out),'duration_s':seconds,'pid':os.getpid(),'system_pid':child.pid}))
    except Exception:
        cap.stop()
        raise


if 'op' in globals() and 'project' in globals():
    run_td(op, project, globals().get('CAPTURE_ACTION','start'), globals().get('CAPTURE_SECONDS',1500))
