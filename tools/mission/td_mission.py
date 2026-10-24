# Mission control's window into TouchDesigner (docs/mission-plan.md). Run inside TD by tools/mission/probe.ps1
# and frames.ps1 via the Claude bridge:  td.ps1 -File tools\mission\td_mission.py
# Reads its request from %TEMP%\mission_args.json (or from a MISSION_ARGS dict defined before this file runs, as
# frames.ps1 does, so two callers never share the args file) and prints one JSON line. Only these fixed actions exist:
#   {"action": "status"}                       show file, fps, ropes, panels, seasons, river cam
#   {"action": "ropes", "dark": true|false}    keep sending black (dark) or the canvas; never stops the sender
#   {"action": "hub75", "brightness": 0..1}    HUB75 output brightness
#   {"action": "frames"}                       status plus "frames": what the ropes and the HUB75 are being sent now:
#       {"at": unix s, "source": ropes Source, "brightness": panels Brightness,
#        "ropes":  {"w": 20, "h": 400, "rgb": base64 of w*h*3 uint8, row 0 = plug end, columns = ropes 1..20,
#                   "source", "brightness": min(Brightness, Maxbrightness) (not baked into rgb), "watts": [box1, box2]},
#        "panels": {"w": 256, "h": 32, "rgb": base64, a 4x box-downsample of panel_out (the 1024x128 atlas, four
#                   256x128 quads in a row; brightness and black already applied by the layout shader), row 0 = top,
#                   "source", "brightness", "output", "atlas": [w, h]},
#        "screens": {"w": 128, "h": 64, "rgb": base64, "cells": 4: the four screens UPRIGHT AS SEEN, side by side (cell k-1 =
#                   screen k, each its <prefix><k>_src 128x256 portrait downsampled 4x, times the panels' Brightness, black
#                   when the panels' Source is black), what screens.py feeds quad k before turning it on its side for the
#                   receive card (Gray Area stacks the quads: panel_out is 256x512, each quad flopped, flipped, and for
#                   screens 3 and 4 row-swapped). Lights draws cell k on screen k; {"error"} while the panels show a test
#                   pattern or a show file has no screens build}}
#       Either part is {"error": ...} on its own failure. Packing: tools/mission/frames_pack.py (pure numpy, tested).
import json
import os
import sys
import time
import types

args = globals().get('MISSION_ARGS')
if not isinstance(args, dict):
    args = json.load(open(os.path.join(os.environ.get('TEMP', '.'), 'mission_args.json'), encoding='utf-8-sig'))
act = args.get('action', 'status')
ropes = op('/project1/ropes')
panels = op('/project1/panels')
out = {'ok': True, 'action': act}

if act == 'ropes':
    ropes.par.Source = 'black' if args.get('dark') else 'canvas'
    ropes.par.Active = True                     # dark = keep sending black (CLAUDE.md), never Active off
elif act == 'hub75':
    panels.par.Brightness = max(0.0, min(1.0, float(args.get('brightness', 1.0))))

h = sys.modules.setdefault('mission_probe', types.ModuleType('mission_probe'))
now, frame = time.time(), absTime.frame
last = getattr(h, 'last', None)
h.last = (now, frame)
fps = round((frame - last[1]) / (now - last[0]), 1) if last and now - last[0] > 1 and frame >= last[1] else None

def safe(f):
    try:
        return f()
    except Exception as e:
        return {'error': repr(e)[:200]}

rs = safe(lambda: ropes.op('artnet_out').module.status(ropes)) if ropes else None
out.update({
    'file': project.name,
    'fps': fps, 'cook_rate': project.cookRate,
    'ropes': {'active': bool(ropes.par.Active), 'source': ropes.par.Source.eval(),
              'box_watts_cap': ropes.par.Boxwatts.eval(), 'status': rs} if ropes else None,
    'hub75': {'brightness': panels.par.Brightness.eval(), 'output': bool(panels.par.Output)} if panels else None,
    'seasons': safe(lambda: op('/project1/seasons/seasons_mod').module.state()['year'].state()) if op('/project1/seasons') else None,
    'river_cam': safe(lambda: op('/project1/river_local/river_cam_mod').module.status('river', 'sub')) if op('/project1/river_local') else None,
    'errors': len(op('/project1').errors(recurse=True) or ''),
})


# ---- frames (the lights simulator) --------------------------------------------------------------------------

def pack_module():
    """tools/mission/frames_pack.py, reloaded each call so a git pull takes effect without restarting TD."""
    import importlib
    dirs = ['C:/Users/user/River/river-bitcube/tools/mission']
    try:
        dirs.insert(0, project.folder + '/tools/mission')       # the show files live in the repo root
    except Exception:
        pass
    for d in reversed(dirs):
        if os.path.isdir(d) and d not in sys.path:
            sys.path.insert(0, d)
    import frames_pack
    return importlib.reload(frames_pack)


def read_top(top):
    """A TOP's pixels as numpy (h, w, c), rows bottom-up as TD stores them, the way artnet_out.canvas_frame reads
    rope_tex: numpyArray(delayed=True) never stalls the GPU, but it hands back the download requested by the
    PREVIOUS call. The sender calls every frame, so that is one frame old; here calls are seconds apart, so ask
    twice: the first call queues a fresh download, the second returns it. None when nothing has cooked yet."""
    a = top.numpyArray(delayed=True)
    b = top.numpyArray(delayed=True)
    return b if b is not None else a


def ropes_now(fp, cfg):
    mod = ropes.op('artnet_out').module
    p = ropes.par
    n, px = 20, 400
    capacity = 170
    if isinstance(cfg, dict) and 'boxes' in cfg:
        n, px, capacity = sum(b['ropes'] for b in cfg['boxes']), cfg['pixels_per_rope'], cfg['pixels_per_universe']
    source = p.Source.eval()
    st = safe(lambda: mod.status(ropes))
    base = {'source': source, 'brightness': min(p.Brightness.eval(), p.Maxbrightness.eval()),
            'watts': st.get('watts') if isinstance(st, dict) else None}
    if source == 'canvas':
        top = ropes.op('rope_tex')
        a = read_top(top) if top is not None else None
        if a is None:
            return base | fp.pack_black(n, px) | {'note': 'rope_tex has not cooked yet'}
        return base | fp.pack_top(a, size=(n, px)) | {'top': top.path}
    # The test and calibration sources are pure functions of the parameters: show exactly what tick() sends.
    if source == 'identify':
        f = mod.identify_frame(n, px, p.Identify.eval(), capacity)
    elif source == 'order':
        f = mod.order_frame(n, px)
    elif source == 'box1_red':
        f = mod.box_frame(n, px, 0, (1, 0, 0))
    elif source == 'box2_green':
        f = mod.box_frame(n, px, 1, (0, 1, 0))
    elif source == 'rope':
        f = mod.rope_frame(n, px, p.Identify.eval())
    elif source == 'heads':
        f = mod.heads_frame(n, px)
    elif source == 'gray':
        f = mod.gray_frame(n, px, p.Graybit.eval(), p.Grayinvert.eval())
    else:                                                   # 'black' and anything unknown: the sender sends black
        return base | fp.pack_black(n, px)
    return base | fp.pack_frame(f)


def panels_now(fp):
    p = panels.par
    base = {'source': p.Source.eval(), 'brightness': p.Brightness.eval(), 'output': bool(p.Output)}
    top = panels.op('panel_out')
    a = read_top(top) if top is not None else None
    if a is None:
        return base | {'error': 'panel_out has not cooked yet'}
    return base | fp.pack_top(a, downsample=4) | {'atlas': [top.width, top.height], 'top': top.path}


def screens_now(fp):
    """The four screens upright as seen (see the header): the <prefix><k>_src beside each Quad<k> TOP the panels use."""
    p = panels.par
    if p.Source.eval() == 'test':
        return {'error': 'the panels show a test pattern'}
    tops = []
    for k in range(1, 5):
        par = getattr(p, f'Quad{k}', None)
        out = op(par.eval()) if par is not None and par.eval() else None
        src = out.parent().op(out.name[:-len('_out')] + '_src') if out is not None and out.name.endswith('_out') else None
        tops.append(read_top(src) if src is not None else None)
    gain = 0.0 if p.Source.eval() == 'black' else p.Brightness.eval()
    return fp.pack_screens(tops, downsample=4, gain=gain)


def frames_now():
    fp = pack_module()
    cfg = safe(lambda: ropes.op('artnet_out').module.load_config()) if ropes else None
    return {'at': time.time(),
            'source': ropes.par.Source.eval() if ropes else None,
            'brightness': panels.par.Brightness.eval() if panels else None,
            'ropes': safe(lambda: ropes_now(fp, cfg)) if ropes else {'error': 'no /project1/ropes'},
            'panels': safe(lambda: panels_now(fp)) if panels else {'error': 'no /project1/panels'},
            'screens': safe(lambda: screens_now(fp)) if panels else {'error': 'no /project1/panels'}}


if act == 'frames':
    out['frames'] = safe(frames_now)

print(json.dumps(out, default=str))
