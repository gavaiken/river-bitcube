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
        sock.bind((config['source_ip'], PORT))
    except OSError:
        sock.close()
        raise
    sock.setblocking(False)
    return sock


# ---- per-frame driver (called from the Execute DAT) -------------------------------------------

def tick(comp):
    """Send one frame if Active and due. State lives in comp.storage so it survives module reloads."""
    s = comp.storage
    p = comp.par
    if not p.Active.eval():
        if s.get('sock'):
            close(comp)
        return
    now = absTime.seconds
    if now - s.get('last_send', 0) < 1.0 / max(1, p.Fps.eval()):
        return
    try:
        config = s.get('config') or load_config()
        s['config'] = config
        if not s.get('sock'):
            s['sock'] = open_socket(config)
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
        else:
            frame = np.zeros((ropes, pixels, 3), np.float32)
        brightness = min(p.Brightness.eval(), p.Maxbrightness.eval())
        data, watts = to_bytes(frame, config, brightness, p.Boxwatts.eval())
        seq = s.get('seq', 0) % 255 + 1
        n = 0
        for target, packet in packets(data, config, seq):
            s['sock'].sendto(packet, target)
            n += 1
        s.update(seq=seq, last_send=now, sent=s.get('sent', 0) + 1, packets=n, watts=watts, error=None)
    except Exception as e:
        s['error'] = repr(e)
        close(comp, blackout=False)
        p.Active = False          # stop retrying every frame; the error stays in storage


def close(comp, blackout=True):
    """Send a few black frames (if the socket is open), then release the port."""
    s = comp.storage
    sock = s.get('sock')
    if sock and blackout and s.get('config'):
        config = s['config']
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
    s['sock'] = None
    s['config'] = None     # re-read config.local.json on next start


def status(comp):
    s = comp.storage
    return {k: s.get(k) for k in ('error', 'sent', 'packets', 'watts', 'seq')} | {
        'active': comp.par.Active.eval(), 'open': bool(s.get('sock')), 'source': comp.par.Source.eval()}
