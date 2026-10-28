"""Modal Frames mirror on bitcube (modal-frames/SPEC.md §9). Standard library only.

    python tools/modal/frames_sync.py            # run (started by tools/modal/modal_link.py's supervisor as child 'frames')
    python tools/modal/frames_sync.py status     # what the mirror has

Every 5 s it asks Dave's Modal app for /frames/latest.json with If-None-Match. A new frame_id: fetch the PNGs it names
(30 s budget), check each one's size (layout.json), format (8-bit RGB, non-interlaced) and sha256, write them to
C:/Users/user/River/gallery_state/frames/<frame_id>/<element>.png (plus <element>.rgb: the decoded pixels, w*h*3 bytes,
row 0 = top, so TouchDesigner never decodes a PNG), then targets.json (the newest image of every element), then
latest.json LAST (temp file + rename). Keeps the last 20 frame folders (and any a target still uses).
sync.json says how polling goes (TouchDesigner reads it for "quiet"). Backs off 5 s doubling to 60 s on failures.
The site token (secrets.local.json modal.site_token), when present, goes in an Authorization header; it is never printed.
"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib

REPO = pathlib.Path(__file__).resolve().parents[2]
SITE = 'https://to-be-a-river--river.modal.run'
FRAMES_DIR = REPO.parent / 'gallery_state' / 'frames'
LAYOUT = REPO / 'modal-frames' / 'layout.json'
SCHEMA = 'modal-frames/1'
POLL_S, BACKOFF_MAX_S, FETCH_BUDGET_S = 5.0, 60.0, 30.0
KEEP = 20
LOCK_PORT = 8773                    # a second copy exits at once (8771 is modal_link's, 8772 the people counter's)
FRAME_ID = re.compile(r'^[A-Za-z0-9._-]{1,80}$')
SHA = re.compile(r'^[0-9a-f]{64}$')
EASINGS = ('linear', 'ease-in', 'ease-out', 'ease-in-out')


class Rejected(ValueError):
    """The frame breaks the contract (§7): ignore it, keep the current one, report why."""


def load_layout(path=LAYOUT):
    data = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    return data['layout_version'], {e['id']: (e['width'], e['height']) for e in data['elements']}


def site_token(repo=REPO):
    try:
        s = json.loads((repo / 'secrets.local.json').read_text(encoding='utf-8-sig'))
        t = (s.get('modal') or {}).get('site_token')
        return t if isinstance(t, str) and t else None
    except (OSError, ValueError, AttributeError):
        return None


# ---- PNG: header check and decode (8-bit RGB, non-interlaced: the only kind §5 allows) -----------------------------

def png_info(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise Rejected('not a PNG')
    w, h, depth, ctype, _comp, _filt, interlace = struct.unpack('>IIBBBBB', data[16:29])
    if depth != 8 or ctype != 2 or interlace != 0:
        raise Rejected(f'PNG must be 8-bit RGB non-interlaced (bit depth {depth}, colour type {ctype}, interlace {interlace})')
    return w, h


def png_rgb(data):
    """Raw RGB bytes, row 0 = top. Pure Python (runs in this process, or in a TD worker thread as a fallback)."""
    w, h = png_info(data)
    pos, idat = 8, []
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        if kind == b'IDAT':
            idat.append(data[pos + 8:pos + 8 + n])
        elif kind == b'IEND':
            break
        pos += 12 + n
    raw = zlib.decompress(b''.join(idat))
    stride = w * 3
    if len(raw) != h * (stride + 1):
        raise Rejected('PNG data is truncated')
    out = bytearray(h * stride)
    prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(3, stride):
                line[i] = (line[i] + line[i - 3]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                left = line[i - 3] if i >= 3 else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - 3] if i >= 3 else 0
                b = prev[i]
                c = prev[i - 3] if i >= 3 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f != 0:
            raise Rejected(f'bad PNG filter {f}')
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return bytes(out)


# ---- manifest -------------------------------------------------------------------------------------------------------

def _num(v, lo, hi, what):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        raise Rejected(f'{what} must be a number from {lo} to {hi}')


def check_manifest(m, layout_version, sizes):
    """The parts of frame.schema.json bitcube relies on, plus the layout version (§7)."""
    if not isinstance(m, dict):
        raise Rejected('manifest is not a JSON object')
    if m.get('schema') != SCHEMA:
        raise Rejected(f"schema is {m.get('schema')!r}, bitcube speaks {SCHEMA}")
    if m.get('layout_version') != layout_version:
        raise Rejected(f"layout_version {m.get('layout_version')!r} does not match bitcube's {layout_version}")
    fid = m.get('frame_id')
    if not isinstance(fid, str) or not FRAME_ID.match(fid):
        raise Rejected('bad frame_id')
    ttl = m.get('ttl_s')
    if isinstance(ttl, bool) or not isinstance(ttl, int) or not 10 <= ttl <= 3600:
        raise Rejected('ttl_s must be an integer from 10 to 3600')
    tr = m.get('transition', {})
    if not isinstance(tr, dict):
        raise Rejected('bad transition')
    if 'duration_ms' in tr:
        _num(tr['duration_ms'], 500, 60000, 'transition.duration_ms')
    if tr.get('easing', 'ease-in-out') not in EASINGS:
        raise Rejected('bad transition.easing')
    via = tr.get('via', [])
    if not isinstance(via, list) or len(via) > 3 or not all(isinstance(c, str) and re.match(r'^#[0-9a-fA-F]{6}$', c) for c in via):
        raise Rejected('bad transition.via')
    els = m.get('elements')
    if not isinstance(els, dict) or not els:
        raise Rejected('no elements')
    for name, e in els.items():
        if name not in sizes:
            raise Rejected(f'unknown element {name!r}')
        if not isinstance(e, dict) or not e:
            raise Rejected(f'{name}: empty element')
        if 'image' in e:
            if e['image'] != f'/frames/{fid}/{name}.png':
                raise Rejected(f'{name}: image path must be /frames/{fid}/{name}.png')
            if not isinstance(e.get('sha256'), str) or not SHA.match(e['sha256']):
                raise Rejected(f'{name}: image needs a lowercase sha256')
        river = e.get('river', {})
        if not isinstance(river, dict):
            raise Rejected(f'{name}: bad river')
        for k, (lo, hi) in (('amount', (0, 1)), ('contrast', (0, 1)), ('speed', (0.25, 2))):
            if k in river:
                _num(river[k], lo, hi, f'{name}.river.{k}')
    if 'note' in m and (not isinstance(m['note'], str) or len(m['note']) > 280):
        raise Rejected('bad note')
    return m


def check_image(name, data, sha, sizes):
    if hashlib.sha256(data).hexdigest() != sha:
        raise Rejected(f'{name}: sha256 mismatch')
    w, h = png_info(data)
    if (w, h) != tuple(sizes[name]):
        raise Rejected(f'{name}: {w}x{h}, layout wants {sizes[name][0]}x{sizes[name][1]}')


# ---- files ----------------------------------------------------------------------------------------------------------

def write_atomic(path, data):
    path = pathlib.Path(path)
    tmp = path.with_name(path.name + '.tmp')
    with open(tmp, 'wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    # Windows refuses to replace a file another process has open this instant (TouchDesigner reading sync.json or
    # latest.json): retry briefly rather than fail the poll.
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def write_json(path, obj):
    write_atomic(path, (json.dumps(obj, indent=1) + '\n').encode('utf-8'))


def read_json(path):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def prune(root, keep=KEEP, protect=()):
    """Keep the newest `keep` frame folders (by mtime) and any in `protect`; delete the rest."""
    dirs = sorted((d for d in pathlib.Path(root).iterdir() if d.is_dir()), key=lambda d: d.stat().st_mtime, reverse=True)
    removed = []
    for d in dirs[keep:]:
        if d.name not in protect:
            shutil.rmtree(d, ignore_errors=True)
            removed.append(d.name)
    return removed


class Mirror:
    def __init__(self, site=SITE, root=FRAMES_DIR, layout=LAYOUT, token=None, clock=time.time, log=print, opener=None,
                 sleep=time.sleep):
        self.site, self.root = site.rstrip('/'), pathlib.Path(root)
        self.sleep = sleep
        self.partial = {}                # (frame_id, element) -> PNG bytes already fetched for a frame not yet complete
        self.layout_version, self.sizes = load_layout(layout)
        self.token, self.clock, self.log = token, clock, log
        self.opener = opener or urllib.request.build_opener()
        self.root.mkdir(parents=True, exist_ok=True)
        current = read_json(self.root / 'latest.json') or {}
        self.frame_id = current.get('frame_id')
        prev = read_json(self.root / 'sync.json') or {}
        self.etag = prev.get('etag') if prev.get('frame_id') == self.frame_id else None
        self.status = {'last_poll_epoch': None, 'last_ok_epoch': None, 'last_status': None, 'error': None,
                       'not_found_since': None, 'frame_id': self.frame_id, 'arrived_epoch': prev.get('arrived_epoch'),
                       'etag': self.etag, 'rejected': prev.get('rejected')}

    def _get(self, path, headers=None, timeout=15):
        req = urllib.request.Request(self.site + path, headers=dict(headers or {}, **{'User-Agent': 'river-bitcube frames_sync'}))
        if self.token:
            req.add_header('Authorization', 'Bearer ' + self.token)
        try:
            with self.opener.open(req, timeout=timeout) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers or {}), b''

    def _save_status(self):
        write_json(self.root / 'sync.json', self.status)

    def poll(self):
        """One poll. Returns 'new', 'same', 'not-modified', 'not-found', 'rejected'; raises on a network/server failure."""
        now = self.clock()
        self.status['last_poll_epoch'] = now
        try:
            code, headers, body = self._get('/frames/latest.json', {'If-None-Match': self.etag} if self.etag else None)
            if code == 304:
                result = 'not-modified'
            elif code == 404:
                self.status['not_found_since'] = self.status['not_found_since'] or now
                result = 'not-found'
            elif code != 200:
                raise OSError(f'latest.json: HTTP {code}')
            else:
                self.status['not_found_since'] = None
                etag = {k.lower(): v for k, v in headers.items()}.get('etag')
                result = self._take(body, etag)
            self.status.update(last_ok_epoch=now, last_status=code, error=None)
            return result
        except Exception as e:
            self.status.update(error=str(e)[:200])
            raise
        finally:
            self._save_status()

    def _take(self, body, etag):
        try:
            m = check_manifest(json.loads(body.decode('utf-8')), self.layout_version, self.sizes)
        except (ValueError, UnicodeDecodeError) as e:
            self.status['rejected'] = {'frame_id': None, 'reason': str(e)[:200], 'at_epoch': self.clock()}
            self.etag = self.status['etag'] = etag       # a broken manifest stays broken: wait for a new one
            self.log(f'frames: rejected manifest ({e})')
            return 'rejected'
        fid = m['frame_id']
        if fid == self.frame_id:
            self.etag = self.status['etag'] = etag
            return 'same'
        self.partial = {k: v for k, v in self.partial.items() if k[0] == fid}
        deadline = self.clock() + FETCH_BUDGET_S
        images = {}
        for name, e in m['elements'].items():
            if 'image' not in e:
                continue
            # Modal can briefly answer 404 for an image its manifest already names (seen 27 Oct): retry that image
            # within the 30 s budget, and keep what arrived so a later poll only fetches what is still missing.
            data = self.partial.get((fid, name))
            while data is None:
                if self.clock() > deadline:
                    raise OSError(f'{fid}: images not fetched within {FETCH_BUDGET_S:.0f} s')
                code, _h, body = self._get(e['image'], timeout=max(1, deadline - self.clock()))
                if code == 200:
                    data = self.partial[(fid, name)] = body
                elif code in (404, 408, 425, 429) or code >= 500:
                    if self.clock() + 1 > deadline:
                        raise OSError(f'{fid}/{name}.png: HTTP {code}')
                    self.sleep(1)
                else:
                    raise OSError(f'{fid}/{name}.png: HTTP {code}')
            try:
                check_image(name, data, e['sha256'], self.sizes)
                rgb = png_rgb(data)
            except Rejected as err:
                self.partial.pop((fid, name), None)
                # Not stored as seen (no etag): the next poll tries the newest manifest again (§6.1).
                self.status['rejected'] = {'frame_id': fid, 'reason': str(err), 'at_epoch': self.clock()}
                self.log(f'frames: rejected {fid} ({err})')
                return 'rejected'
            images[name] = (data, rgb)
        if self.clock() > deadline:
            raise OSError(f'{fid}: images not fetched within {FETCH_BUDGET_S:.0f} s')
        self.partial = {}
        folder = self.root / fid
        folder.mkdir(exist_ok=True)
        for name, (data, rgb) in images.items():
            write_atomic(folder / f'{name}.png', data)
            write_atomic(folder / f'{name}.rgb', rgb)
        targets = read_json(self.root / 'targets.json') or {}
        for name in images:
            targets[name] = f'{fid}/{name}'
        write_json(self.root / 'targets.json', targets)
        write_json(self.root / 'latest.json', m)        # LAST: TouchDesigner only follows latest.json
        self.frame_id = fid
        self.etag = etag
        self.status.update(frame_id=fid, arrived_epoch=self.clock(), etag=etag, rejected=None)
        size = sum(len(d) for d, _ in images.values())
        self.log(f'frames: {fid} ({len(images)} images, {size} bytes)')
        prune(self.root, KEEP, protect={fid} | {t.split('/')[0] for t in targets.values()})
        return 'new'


def run(mirror, sleep=time.sleep, polls=None):
    """Poll forever (or `polls` times): 5 s apart, backing off 5 -> 60 s while polls fail."""
    delay, n = POLL_S, 0
    while polls is None or n < polls:
        n += 1
        try:
            mirror.poll()
            delay = POLL_S
        except Exception as e:                       # noqa: BLE001 - never stop mirroring
            mirror.log(f'frames: poll failed ({str(e)[:160]}); next try in {delay:.0f} s')
            sleep(delay)
            delay = min(BACKOFF_MAX_S, delay * 2)
            continue
        sleep(POLL_S)


def status(root=FRAMES_DIR):
    s = read_json(root / 'sync.json') or {}
    s.pop('etag', None)
    print(json.dumps({'sync': s, 'latest': (read_json(root / 'latest.json') or {}).get('frame_id'),
                      'targets': read_json(root / 'targets.json')}, indent=1))


def main():
    if len(sys.argv) > 1 and sys.argv[1] == 'status':
        status()
        return
    lock = socket.socket()
    try:
        lock.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        print('frames_sync is already running')
        return
    run(Mirror(token=site_token()), sleep=time.sleep)


if __name__ == '__main__':
    main()
