"""tools/mission/calibrate.py, the calibration job behind mission control's Calibrate button, run locally with the
pipeline scripts (capture.py, decode.py, hub75.py) replaced by fakes that print what the real ones print and write
the files calibrate.py reads: the progress file's lifecycle, the lock, dry-run, decode-only, cancel (with the
restore through a fake TD bridge), and failures."""
import importlib.util
import json
import os
import pathlib
import socket
import socketserver
import subprocess
import sys
import textwrap
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
MODULE = REPO / 'tools' / 'mission' / 'calibrate.py'

spec = importlib.util.spec_from_file_location('calibrate_under_test', MODULE)
cal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cal)

STAMP = '20261024-101010'
BEFORE = "{'Active': True, 'Source': 'canvas', 'Brightness': 0.4, 'Graybit': 0, 'Grayinvert': False, 'Panels': 'canvas', 'Maxbrightness': 0.4}"

# ---- fakes: same layout as the real repo (tools/pixelmap/*.py under a repo root), same stdout lines ----------------

FAKE_CAPTURE = textwrap.dedent(f'''
    import json, os, sys, time
    from pathlib import Path
    mode = sys.argv[1]
    repo = Path(__file__).resolve().parents[2]
    print("before: {BEFORE}", flush=True)
    if os.environ.get('FAKE_FAIL') == 'capture-' + mode:
        print('RuntimeError: no camera frames (is the camera reachable?)', flush=True)
        sys.exit(1)
    slow = float(os.environ.get('FAKE_SLOW', '0'))
    stamp = '{STAMP}'
    out = repo / 'frames' / (('pixelmap' if mode == 'ropes' else 'hub75') + '-' + stamp)
    out.mkdir(parents=True, exist_ok=True)
    print('settle 1.75 s, start 10:10:10', flush=True)
    if mode == 'ropes':
        for name in 'AB':
            time.sleep(slow)
            if os.environ.get('FAKE_PATTERN_LINES'):          # the per-pattern line capture.py prints
                for i in range(1, 30):
                    print(f'pass {{name}}: pattern {{i}} of 29 (b{{i:02d}})', flush=True)
            print(f'pass {{name}} done 10:1{{name}}:00', flush=True)
        print('  b04n: retaken, 3 takes, best disagreement 0.012', flush=True)
    meta = {{'mode': mode, 'camera': 'gallery', 'date': stamp[:8], 'stamp': stamp, 'settle': 1.75, 'brightness_cap': 0.4,
            'drift': float(os.environ.get('FAKE_DRIFT', '2.5')), 'lit_camera_px': 1234}}
    (out / 'meta.json').write_text(json.dumps(meta))
    print(json.dumps(meta), flush=True)
    print(f'OUT {{out}}', flush=True)
''')

FAKE_DECODE = textwrap.dedent('''
    import json, os, sys
    from pathlib import Path
    capture = Path(sys.argv[1])
    meta = json.loads((capture / 'meta.json').read_text())
    if os.environ.get('FAKE_FAIL') == 'decode':
        print('Traceback (most recent call last):'); print('ValueError: decode exploded'); sys.exit(1)
    date = meta['date']
    out = Path(__file__).parent / f'pixelmap-{date[:4]}-{date[4:6]}-{date[6:8]}.json'
    ropes = {str(r): {'visible': 50 + r, 'filled': 350 - r} for r in range(20) if r not in (8, 16)}
    points = [{'rope': int(r), 'px': p, 'u': 0.5, 'v': 0.5, 'visible': p < 10} for r in ropes for p in range(20)]
    pm = {'meta': {'capture': capture.name, 'camera': meta['camera'], 'frame_size': [1440, 808], 'drift': meta['drift'],
                   'decoded_camera_px': 164124}, 'ropes': ropes, 'points': points}
    out.write_text(json.dumps(pm))
    print('decoded camera px: 164124  rope px with a position: 2000')
    for r in range(20):
        s = ropes.get(str(r))
        print(f'rope {r + 1:2d}: ' + (f"visible {s['visible']:3d}  filled {s['filled']:3d}" if s else 'not seen'))
    print(f'wrote {out} and {capture / "overlay.png"}')
''')

FAKE_HUB75 = textwrap.dedent('''
    import json, os, sys
    from pathlib import Path
    capture = Path(sys.argv[1])
    pm = Path(sys.argv[2]) if len(sys.argv) > 2 else sorted(Path(__file__).parent.glob('pixelmap-????-??-??.json'))[-1]
    if os.environ.get('FAKE_FAIL') == 'hub75':
        print('Traceback (most recent call last):')
        print('ValueError: the HUB75 test pattern was not seen (panels off, window not on the LED display, ...)'); sys.exit(1)
    d = json.loads(pm.read_text())
    d['hub75_quad1'] = {'tl': [0.46, 0.58], 'tr': [0.6, 0.59], 'br': [0.62, 0.44], 'bl': [0.48, 0.43],
                        'capture': capture.name, 'frame_size': [1440, 808], 'check_px': 3.2}
    pm.write_text(json.dumps(d))
    print('WARNING: red panel is nearest the tr corner, not tl: check the orientation')
    print(f'wrote hub75_quad1 into {pm} and {capture / "corners.png"}')
''')


class QuietServer(HTTPServer):
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)      # HTTPServer's own bind calls getfqdn(), ~30 s on a Mac with slow reverse DNS
        self.server_name, self.server_port = '127.0.0.1', self.socket.getsockname()[1]


class Bridge:
    """A fake TD bridge: records every POSTed code, answers ok."""

    def __init__(self):
        self.calls = []
        bridge = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get('Content-Length', 0))
                bridge.calls.append(self.rfile.read(n).decode('utf-8'))
                out = json.dumps({'ok': True, 'stdout': '', 'result': None}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def log_message(self, *a):
                pass

        self.http = QuietServer(('127.0.0.1', 0), H)
        self.url = f'http://127.0.0.1:{self.http.server_port}/exec'
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def close(self):
        self.http.shutdown()


def closed_port_url():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return f'http://127.0.0.1:{port}/exec'


class Env:
    """A throwaway repo with the fake scripts, a state folder and a fake bridge; run() calls calibrate.main in-process."""

    def __init__(self, tmp_path, monkeypatch):
        self.repo = tmp_path / 'repo'
        self.scripts = self.repo / 'tools' / 'pixelmap'
        self.scripts.mkdir(parents=True)
        (self.scripts / 'capture.py').write_text(FAKE_CAPTURE)
        (self.scripts / 'decode.py').write_text(FAKE_DECODE)
        (self.scripts / 'hub75.py').write_text(FAKE_HUB75)
        self.state = tmp_path / 'River'
        self.state.mkdir()
        self.bridge = Bridge()
        self.monkeypatch = monkeypatch
        self.snaps = []
        orig = cal.Job.write
        snaps = self.snaps

        def write(job, **changes):
            orig(job, **changes)
            snaps.append(json.loads(json.dumps(job.p)))

        monkeypatch.setattr(cal.Job, 'write', write)

    @property
    def progress_file(self):
        return self.state / 'calibration.json'

    def progress(self):
        return json.loads(self.progress_file.read_text(encoding='utf-8'))

    def run(self, *extra, bridge=None):
        argv = ['--repo', str(self.repo), '--scripts', str(self.scripts), '--python', sys.executable, '--state', str(self.state),
                '--bridge', bridge or self.bridge.url, '--dry-wait', '0.2', *extra]
        return cal.main(argv)

    def close(self):
        self.bridge.close()


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.delenv('FAKE_FAIL', raising=False)
    monkeypatch.delenv('FAKE_SLOW', raising=False)
    monkeypatch.delenv('FAKE_DRIFT', raising=False)
    monkeypatch.delenv('FAKE_PATTERN_LINES', raising=False)
    e = Env(tmp_path, monkeypatch)
    yield e
    e.close()


# ---- the lifecycle -----------------------------------------------------------------------------------------------

def test_full_run_walks_every_stage_and_reports_the_map(env):
    assert env.run() == 0
    p = env.progress()
    assert p['running'] is False and p['ok'] is True and p['error'] is None and p['cancelled'] is False
    assert p['stage'] == 'done' and p['stages'] == list(cal.STAGES) + ['done']
    assert p['mode'] == 'full' and p['pid'] == os.getpid()
    assert p['before']['Source'] == 'canvas' and p['restored'] is True
    assert p['capture'] == f'pixelmap-{STAMP}' and p['hub75_capture'] == f'hub75-{STAMP}'
    assert p['capture_info'] == {'mode': 'hub75', 'drift': 2.5, 'lit_camera_px': 1234, 'settle': 1.75, 'brightness_cap': 0.4}
    r = p['result']
    assert r['map'] == 'pixelmap-2026-10-24.json' and r['date'] == '2026-10-24'
    assert r['points'] == 18 * 20 and r['ropes_found'] == [n for n in range(1, 21) if n not in (9, 17)]
    assert r['ropes_dark'] == [9, 17] and r['drift_px'] == 2.5 and r['hub75_quads'] == ['hub75_quad1']
    assert r['camera'] == 'gallery' and r['frame_size'] == [1440, 808] and 'dry_run' not in r
    assert (env.scripts / 'pixelmap-2026-10-24.json').exists()
    assert env.bridge.calls == ['1']                          # the TD check; no restore was needed
    assert not (env.state / 'calibration.lock').exists()
    # every stage was reported, in order, with running true and step/of moving
    seen = [s['stage'] for s in env.snaps]
    order = [seen.index(st) for st in cal.STAGES]
    assert order == sorted(order) and seen[-1] == 'done'
    assert all(s['running'] for s in env.snaps[:-1])
    capture_steps = [s['step'] for s in env.snaps if s['stage'] == 'ropes-capture']
    assert capture_steps[0] == 0 and 1 in capture_steps and capture_steps[-1] == 2       # no per-pattern lines: a pass is a step
    assert [s for s in env.snaps if s['stage'] == 'ropes-capture'][-1]['retakes'] == 1
    assert p['max_drift'] == 30.0 and 'pass' in p and 'retakes' in p
    decode = [s for s in env.snaps if s['stage'] == 'ropes-decode']
    assert decode[-1]['step'] == 20 and decode[-1]['of'] == 20
    assert any('retaken' in s['message'] for s in env.snaps)
    assert all('updated' in s and 'elapsed_s' in s for s in env.snaps)
    assert len(p['log']) <= cal.LOG_LINES and any(line.startswith('$ ') for line in p['log'])


def test_dry_run_walks_the_stages_without_scripts_lights_or_td(env, tmp_path):
    # No scripts folder and no bridge at all: a dry run must not need them.
    assert env.run('--dry-run', '--scripts', str(tmp_path / 'nowhere'), bridge=closed_port_url()) == 0
    p = env.progress()
    assert p['ok'] is True and p['mode'] == 'dry-run' and p['dry_run'] is True and p['stage'] == 'done'
    assert [s['stage'] for s in env.snaps if s['step'] == 0 and s['stage']][:4] == list(cal.STAGES)
    assert p['restored'] is None and p['before'] is None
    assert p['result'] is None                               # no map exists in this throwaway repo
    assert env.bridge.calls == []


def test_dry_run_result_describes_the_newest_existing_map_flagged(env):
    real = REPO / 'tools' / 'pixelmap' / 'pixelmap-2026-10-18.json'
    (env.scripts / real.name).write_bytes(real.read_bytes())
    assert env.run('--dry-run') == 0
    r = env.progress()['result']
    assert r['dry_run'] is True and r['map'] == 'pixelmap-2026-10-18.json'
    assert r['points'] == 7200 and r['ropes_dark'] == [9, 17] and r['hub75_quads'] == ['hub75_quad1']


def test_decode_only_decodes_an_existing_capture_with_no_lights(env):
    capture = env.repo / 'frames' / f'pixelmap-{STAMP}'
    capture.mkdir(parents=True)
    (capture / 'meta.json').write_text(json.dumps({'mode': 'ropes', 'camera': 'gallery', 'date': STAMP[:8], 'drift': 1.1}))
    assert env.run('--decode-only', f'pixelmap-{STAMP}', bridge=closed_port_url()) == 0
    p = env.progress()
    assert p['mode'] == 'decode-only' and p['stages'] == ['ropes-decode', 'done'] and p['ok'] is True
    assert p['result']['map'] == 'pixelmap-2026-10-24.json' and p['result']['hub75_quads'] == []
    assert p['decode_only'].endswith(f'pixelmap-{STAMP}')
    assert env.bridge.calls == []
    assert env.run('--decode-only', 'pixelmap-20000101-000000', bridge=closed_port_url()) == 2
    assert 'meta.json' in env.progress()['error']


# ---- refusals ----------------------------------------------------------------------------------------------------

def test_a_second_run_is_refused_while_the_lock_is_held(env, capsys):
    holder = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])     # a live process holds it
    try:
        (env.state / 'calibration.lock').write_text(str(holder.pid))
        assert env.run('--dry-run') == 3
        assert not env.progress_file.exists()                              # the running job's file is never touched
        assert 'already running' in json.loads(capsys.readouterr().out.strip().splitlines()[-1])['error']
        assert (env.state / 'calibration.lock').read_text() == str(holder.pid)
    finally:
        holder.kill()
        holder.wait()


def test_a_stale_lock_from_a_dead_process_is_taken_over(env):
    p = subprocess.Popen([sys.executable, '-c', 'pass'])
    p.wait()
    (env.state / 'calibration.lock').write_text(str(p.pid))               # its process is gone
    assert env.run('--dry-run') == 0
    assert env.progress()['ok'] is True
    assert not (env.state / 'calibration.lock').exists()


def test_a_full_run_refuses_when_touchdesigner_does_not_answer(env):
    assert env.run(bridge=closed_port_url()) == 2
    p = env.progress()
    assert p['running'] is False and p['ok'] is False and 'TouchDesigner' in p['error']
    assert p['reason'] == "TouchDesigner isn't answering"
    assert p['stage'] is None and p['result'] is None
    assert not (env.state / 'calibration.lock').exists()
    assert not (env.repo / 'frames').exists()                             # nothing ran


# ---- cancel and failures -----------------------------------------------------------------------------------------

def test_cancel_stops_the_capture_and_restores_the_ropes_through_the_bridge(env, monkeypatch):
    monkeypatch.setenv('FAKE_SLOW', '5')                                   # capture.py waits inside a pass
    (env.state / 'calibration.cancel').write_text('stale')                 # a leftover must not cancel the new run
    result = {}
    t = threading.Thread(target=lambda: result.setdefault('code', env.run()))
    t.start()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            p = env.progress()
            if p['stage'] == 'ropes-capture' and p['before']:
                break
        except (OSError, ValueError):
            pass
        time.sleep(0.05)
    else:
        pytest.fail('the capture stage never reported its before: line')
    assert not (env.state / 'calibration.cancel').exists()
    (env.state / 'calibration.cancel').write_text(str(p['pid']))           # what calibrate.ps1 -Action cancel does
    t.join(timeout=15)
    assert not t.is_alive() and result['code'] == 4
    p = env.progress()
    assert p['running'] is False and p['ok'] is False and p['cancelled'] is True and p['error'] == 'cancelled'
    assert p['restored'] is True
    assert p['stage'] == 'ropes-capture' and p['result'] is None
    restore = [c for c in env.bridge.calls if c.startswith("r=op('/project1/ropes')")]
    assert restore == [cal.restore_code(p['before'])]
    assert "r.par.Source='canvas'" in restore[0] and "r.par.Brightness=0.4" in restore[0] and "par.Source='canvas'" in restore[0]
    assert not (env.state / 'calibration.lock').exists() and not (env.state / 'calibration.cancel').exists()
    assert any('child stopped' in line for line in p['log'])
    assert not (env.repo / 'frames' / f'pixelmap-{STAMP}' / 'meta.json').exists()    # it never finished


def test_a_failed_stage_is_recorded_and_the_ropes_were_restored_by_capture_itself(env, monkeypatch):
    monkeypatch.setenv('FAKE_FAIL', 'decode')
    assert env.run() == 1
    p = env.progress()
    assert p['running'] is False and p['ok'] is False and p['cancelled'] is False
    assert p['error'].startswith('ropes-decode failed (exit 1)') and 'decode exploded' in p['error']
    # the portal shows the reason: the step in words and the next step, never a traceback or an exit code
    assert p['reason'] == ("Working out where each rope is failed: the patterns couldn't be read from the pictures "
                           "(someone in view, or light in the room); run it again when the room is dark and empty")
    assert p['stage'] == 'ropes-decode' and p['result'] is None
    assert p['restored'] is True                                           # capture.py ended by itself: its finally ran
    assert env.bridge.calls == ['1']                                       # no restore from this side
    assert not (env.state / 'calibration.lock').exists()


def test_a_capture_failure_before_any_pattern_needs_no_restore_from_us(env, monkeypatch):
    monkeypatch.setenv('FAKE_FAIL', 'capture-ropes')
    assert env.run() == 1
    p = env.progress()
    assert p['error'].startswith('ropes-capture failed (exit 1)') and 'no camera frames' in p['error']
    assert p['reason'].startswith('Photographing the ropes failed:') and 'exit' not in p['reason']
    assert p['restored'] is True and env.bridge.calls == ['1']


def test_hub75_failure_still_reports_the_new_map(env, monkeypatch):
    monkeypatch.setenv('FAKE_FAIL', 'hub75')
    assert env.run() == 1
    p = env.progress()
    assert p['ok'] is False and p['stage'] == 'hub75-locate' and 'not seen' in p['error']
    assert p['result']['map'] == 'pixelmap-2026-10-24.json' and p['result']['hub75_quads'] == []
    assert p['result']['ropes_dark'] == [9, 17]


# ---- helpers -----------------------------------------------------------------------------------------------------

def test_summarize_map_on_the_real_map():
    s = cal.summarize_map(REPO / 'tools' / 'pixelmap' / 'pixelmap-2026-10-18.json')
    assert s['map'] == 'pixelmap-2026-10-18.json' and s['date'] == '2026-10-18'
    assert s['points'] == 7200 and s['ropes_dark'] == [9, 17] and len(s['ropes_found']) == 18
    assert s['hub75_quads'] == ['hub75_quad1'] and s['drift_px'] == 13.28 and s['frame_size'] == [1440, 808]
    assert s['camera'] == 'gallery' and s['capture'] == 'pixelmap-20261018-154155'


def test_restore_code_matches_capture_py():
    before = {'Active': True, 'Source': 'canvas', 'Brightness': 0.4, 'Graybit': 0, 'Grayinvert': False, 'Panels': 'canvas', 'Maxbrightness': 0.4}
    assert cal.restore_code(before) == ("r=op('/project1/ropes'); r.par.Active=True; r.par.Source='canvas'; r.par.Brightness=0.4; "
                                        "r.par.Graybit=0; r.par.Grayinvert=False; op('/project1/panels').par.Source='canvas'")


def test_pid_alive():
    assert cal.pid_alive(os.getpid()) is True
    p = subprocess.Popen([sys.executable, '-c', 'pass'])
    p.wait()
    assert cal.pid_alive(p.pid) is False
    assert cal.pid_alive(0) is False and cal.pid_alive('x') is False and cal.pid_alive(None) is False


# ---- capture.py's stdout -> step / of / pass / retakes; the drift threshold ----------------------------------------

def test_parse_capture_line_reads_patterns_passes_and_retakes():
    assert cal.parse_capture_line('pass A: pattern 12 of 29 (b03)') == {'step': 12, 'of': 29, 'pass': 'A', 'message': 'pass A: pattern 12 of 29 (b03)'}
    assert cal.parse_capture_line('pattern 3 of 29 b02n pass B') == {'step': 3, 'of': 29, 'pass': 'B', 'message': 'pattern 3 of 29 b02n pass B'}
    assert cal.parse_capture_line('Pattern 29 of 29') == {'step': 29, 'of': 29, 'message': 'Pattern 29 of 29'}
    assert cal.parse_capture_line('  b04n: retaken, 3 takes, best disagreement 0.012') == {'retakes': 1, 'message': 'b04n: retaken, 3 takes, best disagreement 0.012'}
    assert cal.parse_capture_line('pass A done 10:11:00') == {'pass_done': True, 'message': 'pass A done 10:11:00'}
    assert cal.parse_capture_line('settle 1.75 s, start 10:10:10') == {'message': 'settle 1.75 s, start 10:10:10'}
    assert cal.parse_capture_line('settle series: 0.0:1 0.3:40') == {'message': 'settle series: 0.0:1 0.3:40'}
    for noise in ('before: {}', 'OUT frames/x', '', 'RuntimeError: no camera frames'):
        assert cal.parse_capture_line(noise) == {}, noise


def test_capture_lines_move_the_progress_file(tmp_path):
    job = cal.Job(state_dir=tmp_path)
    job.p = job.fresh_progress()
    job.write(stage='ropes-capture', stage_index=0, step=0, of=cal.STEPS['ropes-capture'])
    job.on_capture_line("before: {'Active': True, 'Source': 'canvas', 'Brightness': 0.4, 'Graybit': 0, 'Grayinvert': False, 'Panels': 'canvas', 'Maxbrightness': 0.4}")
    assert job.p['before']['Source'] == 'canvas'
    job.on_capture_line('settle 1.75 s, start 10:10:10')
    assert job.p['message'].startswith('settle 1.75 s')
    job.on_capture_line('pass A: pattern 1 of 29 (black)')
    job.on_capture_line('pass A: pattern 12 of 29 (b05n)')
    assert (job.p['step'], job.p['of'], job.p['pass'], job.p['retakes']) == (12, 29, 'A', 0)
    job.on_capture_line('pass A done 10:11:00')
    assert (job.p['step'], job.p['of']) == (29, 29)
    job.on_capture_line('pass B: pattern 2 of 29 (b00)')
    assert (job.p['step'], job.p['pass']) == (2, 'B')
    job.on_capture_line('  b04n: retaken, 3 takes, best disagreement 0.012')
    job.on_capture_line('  b07: retaken, 4 takes, best disagreement 0.020')
    assert job.p['retakes'] == 2 and 'retaken' in job.p['message']
    job.on_capture_line('{"mode": "ropes", "drift": 48.3, "lit_camera_px": 1234, "settle": 1.75, "brightness_cap": 0.4}')
    assert job.p['capture_info']['drift'] == 48.3
    job.on_capture_line('OUT C:/x/frames/pixelmap-20261024-101010')
    assert job.capture_dir.endswith('pixelmap-20261024-101010')
    saved = json.loads((tmp_path / 'calibration.json').read_text(encoding='utf-8'))
    assert (saved['step'], saved['of'], saved['pass'], saved['retakes']) == (2, 29, 'B', 2)
    # an old capture.py without per-pattern lines: a pass is a step of two
    job2 = cal.Job(state_dir=tmp_path)
    job2.p = job2.fresh_progress()
    job2.write(stage='ropes-capture', stage_index=0, step=0, of=cal.STEPS['ropes-capture'])
    job2.on_capture_line('pass A done 10:11:00')
    job2.on_capture_line('pass B done 10:12:00')
    assert (job2.p['step'], job2.p['of'], job2.p['pass']) == (2, 2, None)


def test_full_run_with_per_pattern_lines_reports_pass_and_pattern(env, monkeypatch):
    monkeypatch.setenv('FAKE_PATTERN_LINES', '1')
    assert env.run() == 0
    cap = [s for s in env.snaps if s['stage'] == 'ropes-capture']
    assert any(s['pass'] == 'A' and s['step'] == 12 and s['of'] == 29 for s in cap)
    assert any(s['pass'] == 'B' and s['step'] == 29 for s in cap)
    assert cap[-1]['retakes'] == 1 and cap[-1]['step'] == 29
    assert env.progress()['ok'] is True


def test_a_moved_camera_fails_the_run_before_any_map_is_written(env, monkeypatch):
    monkeypatch.setenv('FAKE_DRIFT', '48.3')
    assert env.run() == 1
    p = env.progress()
    assert p['running'] is False and p['ok'] is False and p['cancelled'] is False
    assert p['error'] == 'The camera moved during the run (drift 48): the map was not saved. Fix the camera and run again'
    assert p['message'] == p['error'] == p['reason'] and p['stage'] == 'ropes-capture' and p['result'] is None
    assert p['restored'] is True                                           # capture.py ended by itself: its finally ran
    assert p['capture_info']['drift'] == 48.3 and p['max_drift'] == 30.0
    assert not list(env.scripts.glob('pixelmap-*.json'))                   # decode.py never ran
    assert env.bridge.calls == ['1']
    assert not (env.state / 'calibration.lock').exists()
    # the threshold is a flag: a looser one lets the same run through
    assert env.run('--max-drift', '60') == 0
    assert env.progress()['ok'] is True and env.progress()['max_drift'] == 60.0
    assert cal.drift_error(29.6) == 'The camera moved during the run (drift 30): the map was not saved. Fix the camera and run again'


def test_a_camera_login_never_reaches_the_log_or_the_error():
    # ffmpeg prints the whole RTSP address (login included) when the camera fails; the log and the error carry it to the
    # browser through the full check, GET /api/calibration and mission control's history
    line = 'Error opening input file rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_main.'
    assert cal.scrub(line) == 'Error opening input file rtsp://***@192.168.9.76:554/Preview_01_main.'
    assert cal.scrub('no url here') == 'no url here'
    # a raw @ or ' in the password is login too (ffmpeg takes the last @ before the path)
    assert cal.scrub('rtsp://admin:p@ss@10.0.0.1/x') == 'rtsp://***@10.0.0.1/x'
    assert cal.scrub("rtsp://admin:ab'cd@10.0.0.1:554/x") == 'rtsp://***@10.0.0.1:554/x'
    assert cal.scrub('see https://example.org/a@b') == 'see https://example.org/a@b'
    job = type('J', (), {'log': []})()
    cal.Job.note(job, line)
    assert 'NOT-A-REAL-PW' not in job.log[0] and 'admin' not in job.log[0]
