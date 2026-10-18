# Art-Net output for the 20 ropes. Synced into /project1/ropes/artnet_out (edit here, not in TD).
#
# Mapping, packet layout and colour order follow Will's RopeLights app and are read from its
# config.local.json, so TD and RopeLights put the same pixel in the same place:
#   rope r -> box ip, 4 universes per rope (170 RGB px each, 3 used, 4th cleared), 512-byte payloads.
#
# The socket binds source_ip:6454 exclusively, exactly like RopeLights. If RopeLights is still
# running, opening fails and TD sends nothing: the two can never drive the ropes at once.
#
# Frame layout everywhere in this file: float array [rope][pixel][rgb], pixel 0 = top of the canvas.

import json
import socket
import struct
import sys
import types

import numpy as np

CONFIG_PATH = r'C:\Users\user\RopeLights\config.local.json'
PORT = 6454
WATTS_PER_CHANNEL = 150 / 400 / 3   # 150 W per rope at full white, 400 px, 3 channels


def load_config(path=CONFIG_PATH):
    with open(path, encoding='utf-8-sig') as f:
        return json.load(f)


def rope_targets(config):
    """[(box index, box ip, first universe of that rope)], one entry per rope in rope order."""
    out = []
    for b, box in enumerate(config['boxes']):
        for r in range(box['ropes']):
            out.append((b, box['ip'], box['first_universe'] + r * config['universes_per_rope']))
    return out


# ---- frame sources ----------------------------------------------------------------------------

def canvas_frame(top, ropes, pixels):
    """Sample a TOP into [rope][pixel][rgb]: column = rope, row = pixel (top row = pixel 0)."""
    a = top.numpyArray(delayed=True) if top is not None else None
    if a is None:
        return np.zeros((ropes, pixels, 3), np.float32)
    a = a[::-1, :, :3]                                  # TD rows start at the bottom
    h, w = a.shape[:2]
    ys = (np.arange(pixels) * h) // pixels
    xs = (np.arange(ropes) * w) // ropes
    return np.transpose(a[ys][:, xs], (1, 0, 2))


def identify_frame(ropes, pixels, selected, capacity=170):
    """One rope lit dim amber, with markers to check direction and universe boundaries:
    red = first 5 px (input end), green = 4 px around 170, blue = 4 px around 340, white = last 5 px."""
    f = np.zeros((ropes, pixels, 3), np.float32)
    if 0 <= selected < ropes:
        f[selected] = (0.3, 0.1, 0.0)
        f[selected, :5] = (1, 0, 0)
        for k, col in ((1, (0, 1, 0)), (2, (0, 0, 1))):
            b = k * capacity
            if b < pixels:
                f[selected, max(0, b - 2):b + 2] = col
        f[selected, -5:] = (1, 1, 1)
    return f


def order_frame(ropes, pixels, step=15):
    """Rope r lights its first (r + 1) * step px: rope order and direction readable in one camera frame.
    Box 1 ropes cyan, box 2 magenta (assumes 10 per box), every 5th rope white."""
    f = np.zeros((ropes, pixels, 3), np.float32)
    for r in range(ropes):
        col = (1, 1, 1) if r % 5 == 4 else ((0, 1, 1) if r < 10 else (1, 0, 1))
        f[r, :min(pixels, (r + 1) * step)] = col
    return f


def box_frame(ropes, pixels, box, rgb, per_box=10):
    """Every pixel of one box's ropes set to rgb, the other box dark (colour-order test)."""
    f = np.zeros((ropes, pixels, 3), np.float32)
    f[box * per_box:(box + 1) * per_box] = rgb
    return f


def rope_frame(ropes, pixels, selected):
    """One rope white over its full length (rope-order test)."""
    f = np.zeros((ropes, pixels, 3), np.float32)
    if 0 <= selected < ropes:
        f[selected] = 1
    return f


def heads_frame(ropes, pixels, n=20):
    """First n px of every rope white: shows which end is pixel 0 (direction test)."""
    f = np.zeros((ropes, pixels, 3), np.float32)
    f[:, :n] = 1
    return f


ROPE_BITS = 5      # Gray-code bits for the rope index (20 ropes)


def gray_frame(ropes, pixels, bit, invert=False):
    """Structured-light pattern for tools/pixelmap: white where bit `bit` of the Gray code is 1.
    Bits 0..4 encode the rope index, bits 5.. the pixel index (bit 5 = pixel LSB). invert flips it.
    Plain Gray codes are unbalanced (bit 4 inverted lights every rope of box 1): the capture script
    dims those pairs (tools/pixelmap/graycode.pattern_brightness). Must match tools/pixelmap/graycode.py
    (tested by tools/pixelmap/tests/test_td_sync.py)."""
    if not 0 <= bit < ROPE_BITS + 9:
        return np.zeros((ropes, pixels, 3), np.float32)     # never let a bad bit become all-white
    r = np.arange(ropes)[:, None]
    p = np.arange(pixels)[None, :]
    code = (r ^ (r >> 1)) if bit < ROPE_BITS else (p ^ (p >> 1))
    k = bit if bit < ROPE_BITS else bit - ROPE_BITS
    on = ((np.broadcast_to(code, (ropes, pixels)) >> k) & 1).astype(bool) != bool(invert)
    f = np.zeros((ropes, pixels, 3), np.float32)
    f[on] = 1
    return f


# ---- output -----------------------------------------------------------------------------------

def to_bytes(frame, config, brightness, box_watts):
    """Scale, power-limit per box, reverse/reorder, quantise. Returns (uint8 [rope][pixel][3], watts per box)."""
    rgb = np.clip(frame, 0, 1) * brightness
    targets = rope_targets(config)
    boxes = [[i for i, t in enumerate(targets) if t[0] == b] for b in range(len(config['boxes']))]
    watts = []
    for idx in boxes:
        w = float(rgb[idx].sum()) * WATTS_PER_CHANNEL
        if box_watts > 0 and w > box_watts:
            rgb[idx] *= box_watts / w
            w = box_watts
        watts.append(round(w))
    data = (rgb * 255 + 0.5).astype(np.uint8)
    for r in config.get('reverse_ropes', []):
        data[r] = data[r][::-1]
    order = config.get('color_order', 'RGB')
    data = data[:, :, ['RGB'.index(c) for c in order]]
    return data, watts


def packets(data, config, sequence):
    """Yield ((ip, port), packet) for every universe, byte-for-byte like RopeLights."""
    per_uni = config['pixels_per_universe'] * 3
    for r, (_, ip, first) in enumerate(rope_targets(config)):
        rope = data[r].tobytes()
        for part in range(config['universes_per_rope']):
            payload = rope[part * per_uni:(part + 1) * per_uni].ljust(512, b'\0')
            header = (b'Art-Net\0' + struct.pack('<H', 0x5000) + struct.pack('>H', 14)
                      + bytes([sequence, 0]) + struct.pack('<H', first + part) + struct.pack('>H', 512))
            yield (ip, PORT), header + payload


def open_socket(config):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1 << 20)   # a frame is 80 x 530 B
        sock.bind((config['source_ip'], PORT))
    except OSError:
        sock.close()
        raise
    sock.setblocking(False)      # never stall TD's main thread on the network
    return sock


# ---- per-frame driver (called from the Execute DAT) -------------------------------------------

def _live(comp):
    """Per-COMP dict for the socket and config. It lives in a holder module in sys.modules, so it
    survives this file being re-synced, and it is NOT in comp.storage: TD pickles storage into the
    .toe on save, a socket can't be pickled, and that raised a modal "saved with errors" dialog."""
    holder = sys.modules.setdefault('river_ropes_live', types.ModuleType('river_ropes_live'))
    if not hasattr(holder, 'by_path'):
        holder.by_path = {}
    live = holder.by_path.setdefault(comp.path, {'sock': None, 'config': None})
    for key in ('sock', 'config'):          # migrate from older versions that kept them in storage
        if key in comp.storage:
            live[key] = live[key] or comp.storage[key]
            comp.unstore(key)
    return live


def tick(comp):
    """Send one frame if Active and due. Counters live in comp.storage (picklable), the socket in _live()."""
    s = comp.storage
    live = _live(comp)
    p = comp.par
    if not p.Active.eval():
        if live['sock']:
            close(comp)
        return
    now = absTime.seconds
    period = 1.0 / max(1, p.Fps.eval())
    last = s.get('last_send', 0)
    if last > now:      # absTime restarts at 0 on project load/reboot, but last_send was saved in the .toe
        last = 0
    if now - last < period - 0.002:      # small slack so 40 fps on a 60 fps timeline isn't rounded down to 30
        return
    now = last + period if now - last < 2 * period else now
    try:
        config = live['config'] or load_config()
        live['config'] = config
        if not live['sock']:
            live['sock'] = open_socket(config)
            s['error'] = None
        ropes = sum(b['ropes'] for b in config['boxes'])
        pixels = config['pixels_per_rope']
        source = p.Source.eval()
        if source == 'canvas':
            frame = canvas_frame(comp.op('rope_tex'), ropes, pixels)
        elif source == 'identify':
            frame = identify_frame(ropes, pixels, p.Identify.eval(), config['pixels_per_universe'])
        elif source == 'order':
            frame = order_frame(ropes, pixels)
        elif source == 'box1_red':
            frame = box_frame(ropes, pixels, 0, (1, 0, 0))
        elif source == 'box2_green':
            frame = box_frame(ropes, pixels, 1, (0, 1, 0))
        elif source == 'rope':
            frame = rope_frame(ropes, pixels, p.Identify.eval())
        elif source == 'heads':
            frame = heads_frame(ropes, pixels)
        elif source == 'gray':
            frame = gray_frame(ropes, pixels, p.Graybit.eval(), p.Grayinvert.eval())
        else:
            frame = np.zeros((ropes, pixels, 3), np.float32)
        brightness = min(p.Brightness.eval(), p.Maxbrightness.eval())
        data, watts = to_bytes(frame, config, brightness, p.Boxwatts.eval())
        seq = s.get('seq', 0) % 255 + 1
        n = 0
        try:
            for target, packet in packets(data, config, seq):
                live['sock'].sendto(packet, target)
                n += 1
        except BlockingIOError:
            s['dropped'] = s.get('dropped', 0) + 1     # send buffer momentarily full: skip the frame
        s.update(seq=seq, last_send=now, sent=s.get('sent', 0) + 1, packets=n, watts=watts, error=None)
    except Exception as e:
        s['error'] = repr(e)
        close(comp, blackout=False)
        p.Active = False          # stop retrying every frame; the error stays in storage


def close(comp, blackout=True):
    """Send a few black frames (if the socket is open), then release the port."""
    live = _live(comp)
    sock = live['sock']
    if sock and blackout and live['config']:
        config = live['config']
        ropes = sum(b['ropes'] for b in config['boxes'])
        data = np.zeros((ropes, config['pixels_per_rope'], 3), np.uint8)
        for _ in range(3):
            for target, packet in packets(data, config, 0):
                try:
                    sock.sendto(packet, target)
                except OSError:
                    pass
    if sock:
        sock.close()
    live['sock'] = None
    live['config'] = None     # re-read config.local.json on next start


def status(comp):
    s = comp.storage
    return {k: s.get(k) for k in ('error', 'sent', 'dropped', 'packets', 'watts', 'seq')} | {
        'active': comp.par.Active.eval(), 'open': bool(_live(comp)['sock']), 'source': comp.par.Source.eval()}
