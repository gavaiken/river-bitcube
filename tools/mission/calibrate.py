"""Mission control's calibration job: the structured-light pipeline as a background job with a progress file.

    .venv\\Scripts\\python tools\\mission\\calibrate.py [--dry-run | --decode-only frames\\pixelmap-YYYYMMDD-HHMMSS]
                                                      [--cam gallery] [--brightness 0.4] [--settle S] [--max-drift 30] [--log FILE]

Stages (each a subprocess of the existing tools, their stdout parsed as it arrives):
    ropes-capture   capture.py ropes     Gray-code patterns on the ropes, two passes, retakes (docs/sessions/B.md)
    ropes-decode    decode.py <frames>   -> tools/pixelmap/pixelmap-<date>.json
    hub75-capture   capture.py hub75     panels black / test pattern, twice each
    hub75-locate    hub75.py <frames>    -> hub75_quad1 corners into the map
    done
Progress goes to C:/Users/user/River/calibration.json after every step (the shape is in mission/lib/lights.mjs; the
probe and calibrate.ps1 -Action status read it). During ropes-capture, capture.py's stdout becomes step/of/pass/retakes:
"pass A: pattern 12 of 29 (b03)" -> step 12, of 29, pass 'A' (capture.py prints one such line per pattern; a capture.py
that only prints "pass A done" still moves step 0 -> 1 -> 2 of 2 passes); "  b04n: retaken, 3 takes, ..." -> retakes +1.
The camera must not move during a run: when capture.py's meta drift (camera px between the first and last black frame)
is above --max-drift (default 30), the run fails BEFORE decoding, so no map is saved, with the words the portal shows. A lock file refuses a second run; a full run also refuses to start
when TouchDesigner's bridge does not answer. --dry-run walks the stages with short waits and no lights, camera or
subprocesses (for exercising the portal); --decode-only decodes an existing capture (no lights).

Cancelling (calibrate.ps1 -Action cancel writes calibration.cancel): the running child is stopped. Stopping a
process on Windows is TerminateProcess, so capture.py's own restore (its finally:) does NOT run then; this job
puts the ropes and panels back itself, from the settings capture.py printed first ('before: {...}'), through the
bridge. A capture that ends by itself, even with an error, has already restored them. The outcome is recorded
as "restored" in the progress file; a failed restore says so, and the Ropes control puts them right.
"""
import argparse
import ast
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BRIDGE = 'http://127.0.0.1:9980/exec'
STAGES = ('ropes-capture', 'ropes-decode', 'hub75-capture', 'hub75-locate')
STEPS = {'ropes-capture': 2, 'ropes-decode': 20, 'hub75-capture': 1, 'hub75-locate': 1}     # "of" per stage
EXPECTED_S = {'ropes-capture': 170, 'ropes-decode': 40, 'hub75-capture': 35, 'hub75-locate': 10}   # typical, for a bar
CAPTURE_STAGES = ('ropes-capture', 'hub75-capture')
N_ROPES = 20
MAX_DRIFT_PX = 30.0          # --max-drift default: camera movement (px) between the first and last black frame that voids a run
# capture.py's per-pattern line: "pass A: pattern 12 of 29 (b03)" (the pass letter may also trail: "pattern 12 of 29 pass A")
PATTERN_RE = re.compile(r'^\s*(?:pass\s+(?P<pass1>[A-Z])\b[:\s]*)?pattern\s+(?P<i>\d+)\s+of\s+(?P<n>\d+)\b(?P<rest>.*)$', re.IGNORECASE)
PASS_RE = re.compile(r'\bpass\s+(?P<p>[A-Z])\b')
RETAKE_RE = re.compile(r'retaken,\s*(?P<takes>\d+)\s+takes')


# The progress file's `reason`: why a run failed or was refused, in the team's words (docs/mission-ui.md, Calibrate >
# Failure); `error` keeps the raw text (step ids, exit codes, the log tail) for Gavin and the tests.
STAGE_WORDS = {'ropes-capture': 'Photographing the ropes', 'ropes-decode': 'Working out where each rope is',
               'hub75-capture': 'Photographing the panels', 'hub75-locate': 'Finding the panels'}
STAGE_CAUSE = {'ropes-capture': "the camera's pictures of the patterns couldn't be taken",
               'ropes-decode': "the patterns couldn't be read from the pictures (someone in view, or light in the room)",
               'hub75-capture': "the camera's pictures of the panels couldn't be taken",
               'hub75-locate': "the panels couldn't be picked out in the picture"}


def stage_reason(stage, cause=None):
    """"Working out where each rope is failed: <cause>; run it again when the room is dark and empty"."""
    what = STAGE_WORDS.get(stage, 'The run')
    return f"{what} failed: {cause or STAGE_CAUSE.get(stage, 'it stopped with an error')}; run it again when the room is dark and empty"


def drift_error(drift):
    """The words the portal shows when the camera moved (docs/mission-ui.md, Calibrate > Failure)."""
    return f'The camera moved during the run (drift {drift:.0f}): the map was not saved. Fix the camera and run again'


def parse_capture_line(line):
    """What one capture.py stdout line means for the progress file: a dict of changes (possibly empty).
    Pure, so it is tested on its own; on_capture_line applies it (and keeps the OUT folder / before: side effects)."""
    m = PATTERN_RE.match(line)
    if m:
        letter = m.group('pass1')
        if not letter:
            t = PASS_RE.search(m.group('rest') or '')
            letter = t.group('p') if t else None
        out = {'step': int(m.group('i')), 'of': int(m.group('n')), 'message': line.strip()}
        if letter:
            out['pass'] = letter.upper()
        return out
    if RETAKE_RE.search(line):
        return {'retakes': +1, 'message': line.strip()}
    if line.startswith('pass ') and ' done' in line:
        return {'pass_done': True, 'message': line.strip()}
    if line.startswith('settle '):
        return {'message': line.strip()}
    return {}
KEEP = ('Active', 'Source', 'Brightness', 'Graybit', 'Grayinvert')      # what capture.py restores, in its order
MAP_GLOB = 'pixelmap-????-??-??.json'
LOG_LINES = 40
_CREDS = re.compile(r'([a-z][a-z0-9+.-]*://)[^\s/?#"<>]*@', re.I)   # up to the authority's last @ (lib/scrub.mjs)


def scrub(text):
    """'rtsp://admin:pw@10.0.0.1/x' -> 'rtsp://***@10.0.0.1/x': no login in anything written or shown."""
    return _CREDS.sub(r'\1***@', str(text))


class Cancelled(Exception):
    pass


class StageFailed(Exception):
    """A stage failed: str(e) is the raw text, e.reason the team's words (the raw text when it is already plain)."""
    def __init__(self, error, reason=None):
        super().__init__(error)
        self.reason = reason or error


# ---- small pure helpers ---------------------------------------------------------------------------------

def pid_alive(pid):
    """Is a process with this id still running? (Never os.kill(pid, 0) on Windows: that terminates it.)"""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if sys.platform == 'win32':
        import ctypes
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = k.GetExitCodeProcess(h, ctypes.byref(code))
        k.CloseHandle(h)
        return bool(ok) and code.value == 259          # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def td(bridge, code, timeout=20):
    """Run Python inside TouchDesigner through the Claude bridge (as capture.py does)."""
    req = urllib.request.Request(bridge, code.encode('utf-8'), {'Content-Type': 'text/plain; charset=utf-8'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        out = json.loads(r.read())
    if not out.get('ok', True) or out.get('error'):
        raise RuntimeError(out.get('error'))
    return out


def td_alive(bridge, timeout=5):
    """(True, None) when TouchDesigner's bridge answers, else (False, why)."""
    try:
        td(bridge, '1', timeout)
        return True, None
    except Exception as e:
        return False, f'TouchDesigner is not running or its bridge is not answering ({e.__class__.__name__}: {e})'[:200]


# A refusal's raw text -> the words the portal shows (the raw text stays in the progress file's error and the answer's raw).
def refusal_reason(why):
    w = str(why or '')
    if 'TouchDesigner' in w:
        return "TouchDesigner isn't answering"
    if 'already running' in w:
        return 'a calibration is already running'
    if 'meta.json' in w:
        return "that capture can't be found on bitcube"
    return "bitcube couldn't start it"


def restore_code(before):
    """The same restore capture.py sends in its finally:, from the dict it printed as 'before: {...}'."""
    parts = [f'r.par.{k}={before[k]!r}' for k in KEEP if k in before]
    code = "r=op('/project1/ropes'); " + '; '.join(parts)
    if 'Panels' in before:
        code += f"; op('/project1/panels').par.Source={before['Panels']!r}"
    return code


def latest_map(folder):
    maps = sorted(Path(folder).glob(MAP_GLOB))
    return maps[-1] if maps else None


def summarize_map(path):
    """What the portal shows about a pixel map (rope numbers 1-based, as in the rope map and decode.py's report)."""
    path = Path(path)
    m = json.loads(path.read_text(encoding='utf-8-sig'))
    ropes = m.get('ropes') or {}
    found = sorted(int(k) + 1 for k, v in ropes.items() if (v or {}).get('visible', 0) > 0)
    date = re.search(r'(\d{4}-\d{2}-\d{2})', path.name)
    meta = m.get('meta') or {}
    return {'map': path.name, 'date': date.group(1) if date else None, 'points': len(m.get('points') or []),
            'seen': sum(int((v or {}).get('visible', 0) or 0) for v in ropes.values()),     # LEDs the camera saw; the rest are placed along the rope
            'ropes_found': found, 'ropes_dark': [r for r in range(1, N_ROPES + 1) if r not in found],
            'drift_px': meta.get('drift'), 'hub75_quads': sorted(k for k in m if re.fullmatch(r'hub75_quad\d+', k)),
            'camera': meta.get('camera'), 'frame_size': meta.get('frame_size'), 'capture': meta.get('capture')}


# ---- the job ---------------------------------------------------------------------------------------------

class Job:
    def __init__(self, *, state_dir, repo=REPO, scripts=None, python=None, bridge=BRIDGE, cam='gallery',
                 brightness=0.4, settle=None, dry_run=False, dry_wait=1.0, decode_only=None, poll=0.25, now=time.time,
                 max_drift=MAX_DRIFT_PX):
        self.repo = Path(repo)
        self.max_drift = max_drift
        self.scripts = Path(scripts) if scripts else self.repo / 'tools' / 'pixelmap'
        self.python = python or sys.executable
        self.bridge, self.cam, self.brightness, self.settle = bridge, cam, brightness, settle
        self.dry_run, self.dry_wait, self.decode_only, self.poll, self.now = dry_run, dry_wait, decode_only, poll, now
        state_dir = Path(state_dir)
        self.progress_file = state_dir / 'calibration.json'
        self.lock_file = state_dir / 'calibration.lock'
        self.cancel_file = state_dir / 'calibration.cancel'
        self.mode = 'dry-run' if dry_run else 'decode-only' if decode_only else 'full'
        self.stages = ('ropes-decode',) if decode_only else STAGES
        self.p = None               # the progress dict (what calibration.json holds)
        self.child = None
        self.before = None          # ropes/panels settings capture.py printed, to put back if it is stopped
        self.restored = None
        self.capture_dir = str(decode_only) if decode_only else None
        self.hub75_dir = None
        self.map_path = None
        self.log = []

    def fresh_progress(self):
        """The progress file's initial content (every key the portal may read, lib/lights.mjs)."""
        return {'running': True, 'pid': os.getpid(), 'mode': self.mode, 'stage': None, 'stage_index': -1,
                'stages': list(self.stages) + ['done'], 'step': 0, 'of': 0, 'pass': None, 'retakes': 0, 'expected_s': None,
                'started': round(self.now(), 3), 'updated': None, 'elapsed_s': 0, 'message': 'starting',
                'ok': None, 'error': None, 'reason': None, 'cancelled': False, 'dry_run': self.dry_run,
                'decode_only': str(self.decode_only) if self.decode_only else None, 'cam': self.cam,
                'brightness_cap': self.brightness, 'max_drift': self.max_drift, 'before': None, 'restored': None,
                'capture': None, 'hub75_capture': None, 'capture_info': None, 'result': None, 'log': []}

    # -- progress file --
    def write(self, **changes):
        p = self.p
        p.update(changes)
        p['updated'] = round(self.now(), 3)
        p['elapsed_s'] = round(p['updated'] - p['started'], 1)
        p['log'] = self.log[-LOG_LINES:]
        text = json.dumps(p, indent=1)
        tmp = self.progress_file.with_name('calibration.json.tmp')
        for attempt in range(5):               # a reader may hold the file open for an instant on Windows
            try:
                tmp.write_text(text, encoding='utf-8')
                os.replace(tmp, self.progress_file)
                return
            except OSError:
                time.sleep(0.05)

    def note(self, line):
        # ffmpeg prints a failing camera's whole RTSP address, login included: never store it (the log reaches every
        # logged-in browser through the full check, GET /api/calibration and mission control's history)
        self.log.append(scrub(line)[:300])

    # -- lock --
    def take_lock(self):
        for _ in range(2):
            try:
                fd = os.open(self.lock_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                with os.fdopen(fd, 'w') as f:
                    f.write(str(os.getpid()))
                return True, None
            except FileExistsError:
                try:
                    other = int(self.lock_file.read_text().strip() or 0)
                except (OSError, ValueError):
                    other = 0
                if other and other != os.getpid() and pid_alive(other):
                    return False, f'a calibration is already running (pid {other})'
                try:
                    self.lock_file.unlink()        # stale: its process is gone
                except OSError:
                    pass
        return False, 'could not take the lock'

    def release_lock(self):
        try:
            if self.lock_file.read_text().strip() == str(os.getpid()):
                self.lock_file.unlink()
        except OSError:
            pass

    def check_cancel(self):
        if self.cancel_file.exists():
            raise Cancelled()

    # -- running --
    def run(self):
        ok, why = self.take_lock()
        if not ok:
            print(json.dumps({'ok': False, 'error': refusal_reason(why), 'raw': why}), flush=True)
            return 3
        try:
            try:
                self.cancel_file.unlink()          # a leftover from an earlier run must not stop this one
            except OSError:
                pass
            self.p = self.fresh_progress()
            if self.decode_only and not (Path(self.decode_only) / 'meta.json').exists():
                return self.refuse(2, f'no capture at {self.decode_only} (no meta.json)')
            if self.mode == 'full':
                alive, why = td_alive(self.bridge)
                if not alive:
                    return self.refuse(2, why)
            self.write()
            for i, stage in enumerate(self.stages):
                self.check_cancel()
                self.write(stage=stage, stage_index=i, step=0, of=STEPS[stage], **{'pass': None},
                           expected_s=2 * self.dry_wait if self.dry_run else EXPECTED_S[stage], message=f'{stage} started')
                getattr(self, 'stage_' + stage.replace('-', '_'))()
            self.write(running=False, ok=True, stage='done', stage_index=len(self.stages), step=1, of=1,
                       message='calibration done', result=self.result(), restored=self.restored)
            return 0
        except Cancelled:
            self.stop_child()
            self.restore_if_needed()
            self.write(running=False, ok=False, cancelled=True, error='cancelled', message='cancelled',
                       result=self.result(), restored=self.restored)
            return 4
        except StageFailed as e:
            self.write(running=False, ok=False, error=str(e), reason=e.reason, message=str(e), result=self.result(), restored=self.restored)
            return 1
        except Exception as e:
            self.stop_child()
            self.restore_if_needed()
            err = f'{e.__class__.__name__}: {e}'[:300]
            self.write(running=False, ok=False, error=err, reason='The run stopped with an error on bitcube; ask Gavin',
                       message=err, result=self.result(), restored=self.restored)
            return 1
        finally:
            self.release_lock()
            try:
                self.cancel_file.unlink()
            except OSError:
                pass

    def refuse(self, code, why):
        reason = refusal_reason(why)
        self.write(running=False, ok=False, error=why, reason=reason, message=why)
        print(json.dumps({'ok': False, 'error': reason, 'raw': why}), flush=True)
        return code

    def result(self):
        """Summary of the map this run wrote; in a dry run, of the newest existing one (flagged), so the portal's
        map view can be exercised. None when there is no map."""
        try:
            path = self.map_path or (latest_map(self.scripts) if self.dry_run else None)
            if path is None or not Path(path).exists():
                return None
            return summarize_map(path) | ({'dry_run': True} if self.dry_run else {})
        except Exception as e:                   # a summary problem must not hide the run's own outcome
            return {'error': f'{e.__class__.__name__}: {e}'[:200]}

    # -- stages --
    def stage_ropes_capture(self):
        if self.dry_run:
            return self.pretend([(0.5, 'pass A done'), (1.0, 'pass B done')])
        self.run_capture('ropes')
        self.write(capture=Path(self.capture_dir).name, step=self.p['of'], message='ropes captured')
        # The camera moved: the patterns no longer line up with the first frame, so decoding would place every LED wrong.
        drift = (self.p.get('capture_info') or {}).get('drift')
        if isinstance(drift, (int, float)) and drift > self.max_drift:
            raise StageFailed(drift_error(drift))

    def stage_ropes_decode(self):
        if self.dry_run:
            return self.pretend([(k / 20, f'rope {k:2d}: decoded') for k in range(1, 21)])
        self.run_child([self.python, str(self.scripts / 'decode.py'), str(self.capture_dir)], 'ropes-decode', self.on_decode_line)
        if self.map_path is None:
            raise StageFailed('ropes-decode: decode.py reported no map file', stage_reason('ropes-decode', 'no map came out of it'))
        self.write(step=STEPS['ropes-decode'], message=f'map written: {Path(self.map_path).name}')

    def stage_hub75_capture(self):
        if self.dry_run:
            return self.pretend([(1.0, 'panels captured')])
        self.run_capture('hub75')
        self.write(hub75_capture=Path(self.hub75_dir).name, step=1, message='panels captured')

    def stage_hub75_locate(self):
        if self.dry_run:
            return self.pretend([(1.0, 'hub75_quad1 located')])
        cmd = [self.python, str(self.scripts / 'hub75.py'), str(self.hub75_dir)] + ([str(self.map_path)] if self.map_path else [])
        self.run_child(cmd, 'hub75-locate', self.on_hub75_line)
        self.write(step=1, message='HUB75 quad 1 located')

    def run_capture(self, mode):
        self.before, self.restored = None, None
        cmd = [self.python, str(self.scripts / 'capture.py'), mode, '--cam', self.cam, '--brightness', str(self.brightness)]
        if self.settle is not None:
            cmd += ['--settle', str(self.settle)]
        self.run_child(cmd, f'{mode}-capture', self.on_capture_line)
        folder = self.capture_dir if mode == 'ropes' else self.hub75_dir
        if not folder:
            raise StageFailed(f'{mode}-capture: capture.py printed no OUT folder', stage_reason(f'{mode}-capture', "the pictures weren't saved"))

    def pretend(self, marks):
        """Dry run: wait self.dry_wait seconds in all, reporting the marks (fraction, message) on the way."""
        t0 = self.now()
        for k, (frac, msg) in enumerate(marks, start=1):
            while self.now() - t0 < frac * self.dry_wait:
                self.check_cancel()
                time.sleep(min(0.05, self.poll))
            self.check_cancel()
            self.write(step=k, message=msg)

    # -- the subprocess --
    def run_child(self, cmd, stage, on_line=None):
        env = dict(os.environ, PYTHONUNBUFFERED='1', PYTHONIOENCODING='utf-8')
        self.note('$ ' + ' '.join(cmd))
        self.child = subprocess.Popen(cmd, cwd=str(self.repo), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      stdin=subprocess.DEVNULL, text=True, encoding='utf-8', errors='replace',
                                      creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        q = queue.Queue()

        def pump():
            for line in self.child.stdout:
                q.put(line.rstrip('\r\n'))
            q.put(None)

        threading.Thread(target=pump, daemon=True).start()
        last_write = self.now()
        while True:
            try:
                line = q.get(timeout=self.poll)
            except queue.Empty:
                self.check_cancel()
                if self.now() - last_write >= 2:          # keep updated/elapsed_s moving between lines
                    self.write()
                    last_write = self.now()
                continue
            if line is None:
                break
            self.note(line)
            if on_line:
                on_line(line)
            self.write()
            last_write = self.now()
            self.check_cancel()
        code = self.child.wait()
        self.child = None
        if stage in CAPTURE_STAGES and self.before is not None:
            self.restored = True                           # capture.py's finally: ran, whatever its exit code
            self.write(restored=True)
        if code != 0:
            raise StageFailed(f'{stage} failed (exit {code}): ' + ' | '.join(self.log[-3:]), stage_reason(stage))

    def stop_child(self):
        c = self.child
        self.child = None
        if c is None or c.poll() is not None:
            return
        try:
            c.terminate()                                  # TerminateProcess on Windows (no finally: in the child)
            c.wait(timeout=5)
        except Exception:
            try:
                c.kill()
                c.wait(timeout=5)
            except Exception:
                pass
        self.note('child stopped')

    def restore_if_needed(self):
        """Put the ropes and panels back the way capture.py found them when it was stopped before its own restore
        ran. Nothing to do before it printed 'before:' (nothing had been changed yet), or after it exited by itself."""
        if self.before is None or self.restored is True or self.dry_run:
            return
        code = restore_code(self.before)
        try:
            td(self.bridge, code)
            self.restored = True
            self.note('restored ropes and panels: ' + code)
        except Exception as e:
            self.restored = False
            self.note(f'RESTORE FAILED ({e.__class__.__name__}: {e}): use the Ropes control to put the ropes back')

    # -- stdout parsing --
    def on_capture_line(self, line):
        if line.startswith('before: '):
            try:
                self.before = ast.literal_eval(line[len('before: '):].strip())
                self.write(before=self.before)
            except (ValueError, SyntaxError):
                pass
        elif line.startswith('OUT '):
            folder = line[4:].strip()
            if 'hub75-' in Path(folder).name:
                self.hub75_dir = folder
            else:
                self.capture_dir = folder
        elif line.startswith('{'):
            try:
                info = json.loads(line)
                self.write(capture_info={k: info.get(k) for k in ('mode', 'drift', 'lit_camera_px', 'settle', 'brightness_cap')})
            except ValueError:
                pass
        else:
            changes = parse_capture_line(line)
            if changes.pop('pass_done', False):
                # A pass is complete: with per-pattern lines step reaches "of"; without them (old capture.py) a pass is a step.
                if self.p['of'] == STEPS['ropes-capture']:
                    changes['step'] = min(self.p['step'] + 1, STEPS['ropes-capture'])
                else:
                    changes['step'] = self.p['of']
            if 'retakes' in changes:
                changes['retakes'] = self.p.get('retakes', 0) + 1
            if changes:
                self.write(**changes)

    def on_decode_line(self, line):
        if re.match(r'rope\s+\d+:', line):
            self.write(step=min(self.p['step'] + 1, STEPS['ropes-decode']), message=line.strip())
        elif line.startswith('wrote '):
            self.map_path = Path(line[len('wrote '):].split(' and ')[0].strip())
        elif line.startswith('decoded camera px') or 'carried over' in line:
            self.write(message=line.strip())

    def on_hub75_line(self, line):
        if line.startswith('WARNING') or line.startswith('wrote '):
            self.write(message=line.strip())


# ---- command line ----------------------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description='Mission control calibration job (see the file header).')
    ap.add_argument('--dry-run', action='store_true', help='walk the stages with short waits: no lights, camera or subprocesses')
    ap.add_argument('--decode-only', metavar='FRAMES_DIR', help='decode an existing capture (a folder under frames/): no lights')
    ap.add_argument('--cam', default='gallery')
    ap.add_argument('--brightness', type=float, default=0.4)
    ap.add_argument('--settle', type=float)
    ap.add_argument('--max-drift', type=float, default=MAX_DRIFT_PX,
                    help=f'camera movement (px) during the capture that voids the run (default {MAX_DRIFT_PX:g})')
    ap.add_argument('--log', help='append all output to this file (calibrate.ps1 passes one under River\\logs)')
    ap.add_argument('--state', help='folder for calibration.json/.lock/.cancel (default: the River folder above the repo)')
    ap.add_argument('--repo', help=argparse.SUPPRESS)        # tests
    ap.add_argument('--scripts', help=argparse.SUPPRESS)     # tests: where capture.py, decode.py, hub75.py live
    ap.add_argument('--python', help=argparse.SUPPRESS)      # tests
    ap.add_argument('--bridge', default=BRIDGE, help=argparse.SUPPRESS)
    ap.add_argument('--dry-wait', type=float, default=1.0, help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if a.log:
        sys.stdout = sys.stderr = open(a.log, 'a', buffering=1, encoding='utf-8')
    repo = Path(a.repo) if a.repo else REPO
    decode_only = None
    if a.decode_only:
        decode_only = Path(a.decode_only)
        if not decode_only.is_absolute():
            decode_only = repo / 'frames' / decode_only
    job = Job(state_dir=a.state or repo.parent, repo=repo, scripts=a.scripts, python=a.python, bridge=a.bridge,
              cam=a.cam, brightness=a.brightness, settle=a.settle, dry_run=a.dry_run, dry_wait=a.dry_wait,
              decode_only=decode_only, max_drift=a.max_drift)
    return job.run()


if __name__ == '__main__':
    sys.exit(main())
