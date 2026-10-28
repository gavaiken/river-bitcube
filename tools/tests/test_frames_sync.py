"""tools/modal/frames_sync.py against a fake Modal (modal-frames/SPEC.md §3, §6.1, §7, §9)."""
import hashlib
import http.server
import importlib.util
import json
import os
import pathlib
import random
import struct
import threading
import zlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODULE = ROOT / 'tools' / 'modal' / 'frames_sync.py'


def load():
    spec = importlib.util.spec_from_file_location('frames_sync_under_test', MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


fs = load()


def png(w, h, seed=0, filters=(0, 1, 2, 3, 4)):
    rnd = random.Random(seed)
    rows, pixels = [], []
    for y in range(h):
        line = bytes(rnd.randrange(256) for _ in range(w * 3))
        pixels.append(line)
        rows.append(bytes([0]) + line)          # filter 0 here; decoder filters are tested separately
    raw = b''.join(rows)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    return data, b''.join(pixels)


def filtered_png(w, h, seed=1):
    """Every row with a different filter type, encoded properly, to check the decoder's unfiltering."""
    rnd = random.Random(seed)
    img = [bytes(rnd.randrange(256) for _ in range(w * 3)) for _ in range(h)]
    out, prev = [], bytes(w * 3)
    for y, line in enumerate(img):
        f = y % 5
        enc = bytearray()
        for i, x in enumerate(line):
            a = line[i - 3] if i >= 3 else 0
            b = prev[i]
            c = prev[i - 3] if i >= 3 else 0
            if f == 0:
                pred = 0
            elif f == 1:
                pred = a
            elif f == 2:
                pred = b
            elif f == 3:
                pred = (a + b) >> 1
            else:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else b if pb <= pc else c
            enc.append((x - pred) & 255)
        out.append(bytes([f]) + bytes(enc))
        prev = line

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(out))) + chunk(b'IEND', b''))
    return data, b''.join(img)


def test_png_decoder_handles_every_filter():
    data, pixels = filtered_png(7, 11)
    assert fs.png_rgb(data) == pixels


def test_png_info_rejects_alpha():
    data, _ = png(4, 4)
    rgba = data[:25] + bytes([6]) + data[26:]
    with pytest.raises(fs.Rejected):
        fs.png_info(rgba)


class Fake:
    """A tiny Modal: /frames/latest.json with a strong ETag and 304, and the PNGs."""

    def __init__(self):
        self.manifest, self.files, self.requests, self.auth = None, {}, [], []
        fake = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                fake.requests.append(self.path)
                fake.auth.append(self.headers.get('Authorization'))
                if self.path == '/frames/latest.json':
                    if fake.manifest is None:
                        self.send_response(404)
                        self.end_headers()
                        return
                    body = json.dumps(fake.manifest).encode()
                    etag = '"' + hashlib.sha1(body).hexdigest()[:16] + '"'
                    if self.headers.get('If-None-Match') == etag:
                        self.send_response(304)
                        self.send_header('ETag', etag)
                        self.end_headers()
                        return
                    self.send_response(200)
                    self.send_header('ETag', etag)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(body)
                elif self.path in fake.files:
                    self.send_response(200)
                    self.send_header('Content-Type', 'image/png')
                    self.end_headers()
                    self.wfile.write(fake.files[self.path])
                else:
                    self.send_response(404)
                    self.end_headers()

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'

    def publish(self, fid, elements=('screen-1', 'ropes'), bad_sha=False, seed=0):
        sizes = {'screen-1': (128, 256), 'screen-2': (128, 256), 'screen-3': (128, 256), 'screen-4': (128, 256), 'ropes': (20, 400)}
        els, pixels = {}, {}
        for i, name in enumerate(elements):
            data, px = png(*sizes[name], seed=seed + i)
            path = f'/frames/{fid}/{name}.png'
            self.files[path] = data
            pixels[name] = px
            sha = hashlib.sha256(data).hexdigest()
            els[name] = {'image': path, 'sha256': ('0' * 64 if bad_sha else sha), 'river': {'amount': 0.5}}
        self.manifest = {'schema': 'modal-frames/1', 'layout_version': 1, 'frame_id': fid,
                         'issued_at': '2026-10-27T18:00:00Z', 'ttl_s': 120, 'elements': els, 'note': 'test'}
        return pixels

    def close(self):
        self.server.shutdown()


@pytest.fixture
def fake():
    f = Fake()
    yield f
    f.close()


def mirror(fake, tmp_path, **kw):
    return fs.Mirror(site=fake.url, root=tmp_path / 'frames', log=lambda *_: None, **kw)


def test_new_frame_then_304(fake, tmp_path):
    pixels = fake.publish('f1')
    m = mirror(fake, tmp_path)
    assert m.poll() == 'new'
    root = tmp_path / 'frames'
    assert json.loads((root / 'latest.json').read_text())['frame_id'] == 'f1'
    assert (root / 'f1' / 'screen-1.png').read_bytes() == fake.files['/frames/f1/screen-1.png']
    assert (root / 'f1' / 'ropes.rgb').read_bytes() == pixels['ropes']
    assert json.loads((root / 'targets.json').read_text()) == {'screen-1': 'f1/screen-1', 'ropes': 'f1/ropes'}
    n = len(fake.requests)
    assert m.poll() == 'not-modified'
    assert fake.requests[n:] == ['/frames/latest.json']           # a 304: no images fetched again
    sync = json.loads((root / 'sync.json').read_text())
    assert sync['last_status'] == 304 and sync['frame_id'] == 'f1' and sync['error'] is None


def test_404_is_quiet_not_an_error(fake, tmp_path):
    m = mirror(fake, tmp_path)
    assert m.poll() == 'not-found'
    sync = json.loads((tmp_path / 'frames' / 'sync.json').read_text())
    assert sync['not_found_since'] and sync['error'] is None
    assert not (tmp_path / 'frames' / 'latest.json').exists()


def test_sha_mismatch_rejected_and_current_frame_kept(fake, tmp_path):
    fake.publish('good')
    m = mirror(fake, tmp_path)
    assert m.poll() == 'new'
    fake.publish('bad', bad_sha=True, seed=5)
    assert m.poll() == 'rejected'
    root = tmp_path / 'frames'
    assert json.loads((root / 'latest.json').read_text())['frame_id'] == 'good'
    assert not (root / 'bad').exists()
    sync = json.loads((root / 'sync.json').read_text())
    assert sync['rejected']['frame_id'] == 'bad' and 'sha256' in sync['rejected']['reason']
    # Not remembered as seen: the next poll fetches the manifest again (and Modal may have fixed it).
    fake.publish('bad', seed=5)
    assert m.poll() == 'new'


def test_layout_mismatch_rejected(fake, tmp_path):
    fake.publish('f1')
    fake.manifest['layout_version'] = 2
    m = mirror(fake, tmp_path)
    assert m.poll() == 'rejected'
    assert not (tmp_path / 'frames' / 'latest.json').exists()
    assert m.poll() == 'not-modified'                          # a broken manifest isn't refetched until it changes


def test_wrong_size_rejected(fake, tmp_path):
    fake.publish('f1', elements=('screen-1',))
    data, _ = png(64, 64)
    fake.files['/frames/f1/screen-1.png'] = data
    fake.manifest['elements']['screen-1']['sha256'] = hashlib.sha256(data).hexdigest()
    assert mirror(fake, tmp_path).poll() == 'rejected'


def test_latest_json_written_last(fake, tmp_path, monkeypatch):
    fake.publish('f1', elements=('screen-1', 'screen-2', 'ropes'))
    order = []
    real = os.replace

    def spy(src, dst):
        order.append(pathlib.Path(dst).name)
        return real(src, dst)
    monkeypatch.setattr(fs.os, 'replace', spy)
    mirror(fake, tmp_path).poll()
    writes = [n for n in order if n != 'sync.json']
    assert writes[-1] == 'latest.json'
    assert set(writes[:-1]) >= {'screen-1.png', 'screen-2.png', 'ropes.png', 'targets.json'}
    assert writes.index('targets.json') > max(writes.index(n) for n in ('screen-1.png', 'screen-2.png', 'ropes.png'))


def test_elements_left_out_keep_their_target(fake, tmp_path):
    m = mirror(fake, tmp_path)
    fake.publish('a', elements=('screen-1', 'ropes'))
    m.poll()
    fake.publish('b', elements=('screen-1',), seed=9)
    m.poll()
    assert json.loads((tmp_path / 'frames' / 'targets.json').read_text()) == {'screen-1': 'b/screen-1', 'ropes': 'a/ropes'}


def test_pruning_keeps_20_and_what_targets_use(fake, tmp_path):
    m = mirror(fake, tmp_path)
    root = tmp_path / 'frames'
    fake.publish('f00', elements=('ropes',))
    m.poll()
    for i in range(1, 25):
        fake.publish(f'f{i:02d}', elements=('screen-1',), seed=i)
        m.poll()
        t = 1_700_000_000 + i
        os.utime(root / f'f{i:02d}', (t, t))
    os.utime(root / 'f00', (1_600_000_000, 1_600_000_000))
    fake.publish('f25', elements=('screen-1',), seed=25)
    m.poll()
    dirs = sorted(d.name for d in root.iterdir() if d.is_dir())
    assert 'f00' in dirs                                        # ropes still points at it
    assert 'f25' in dirs and 'f01' not in dirs
    assert len(dirs) == 21


def test_token_sent_only_when_configured(fake, tmp_path):
    fake.publish('f1')
    mirror(fake, tmp_path).poll()
    assert set(fake.auth) == {None}
    fake.auth.clear()
    m = fs.Mirror(site=fake.url, root=tmp_path / 'other', log=lambda *_: None, token='t0k3n')
    m.poll()
    assert fake.auth and all(a == 'Bearer t0k3n' for a in fake.auth)
    assert 't0k3n' not in (tmp_path / 'other' / 'sync.json').read_text()


def test_backoff_doubles_to_60_and_resets():
    class Flaky:
        def __init__(self):
            self.n = 0

        def poll(self):
            self.n += 1
            if self.n <= 6:
                raise OSError('down')

        def log(self, *_):
            pass
    sleeps = []
    fs.run(Flaky(), sleep=sleeps.append, polls=8)
    assert sleeps == [5, 10, 20, 40, 60, 60, 5, 5]


def test_network_failure_recorded(tmp_path):
    m = fs.Mirror(site='http://127.0.0.1:9', root=tmp_path / 'frames', log=lambda *_: None)
    with pytest.raises(Exception):
        m.poll()
    sync = json.loads((tmp_path / 'frames' / 'sync.json').read_text())
    assert sync['error'] and sync['last_ok_epoch'] is None


def test_site_token_read_only_if_present(tmp_path):
    assert fs.site_token(tmp_path) is None
    (tmp_path / 'secrets.local.json').write_text(json.dumps({'modal': {'ingest_token': 'x'}}))
    assert fs.site_token(tmp_path) is None
    (tmp_path / 'secrets.local.json').write_text(json.dumps({'modal': {'site_token': 'abc'}}))
    assert fs.site_token(tmp_path) == 'abc'


def test_brief_image_404_is_retried_and_partial_kept(fake, tmp_path):
    fake.publish('f1', elements=('screen-1', 'ropes'))
    real = fake.files.pop('/frames/f1/ropes.png')
    slept = []

    def sleep(s):
        slept.append(s)
        if len(slept) == 3:
            fake.files['/frames/f1/ropes.png'] = real          # it turns up a few seconds late
    m = fs.Mirror(site=fake.url, root=tmp_path / 'frames', log=lambda *_: None, sleep=sleep)
    assert m.poll() == 'new'
    assert slept == [1, 1, 1]
    assert fake.requests.count('/frames/f1/screen-1.png') == 1


def test_image_missing_past_the_budget_fails_and_keeps_what_arrived(fake, tmp_path):
    fake.publish('f1', elements=('screen-1', 'ropes'))
    real = fake.files.pop('/frames/f1/ropes.png')
    t = [0.0]
    m = fs.Mirror(site=fake.url, root=tmp_path / 'frames', log=lambda *_: None, clock=lambda: t[0],
                  sleep=lambda s: t.__setitem__(0, t[0] + 10))
    with pytest.raises(OSError):
        m.poll()
    assert not (tmp_path / 'frames' / 'latest.json').exists()
    fake.files['/frames/f1/ropes.png'] = real
    assert m.poll() == 'new'
    assert fake.requests.count('/frames/f1/screen-1.png') == 1      # not fetched again
