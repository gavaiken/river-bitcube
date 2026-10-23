# Mission control's window into TouchDesigner (docs/mission-plan.md). Run inside TD by tools/mission/probe.ps1
# and control.ps1 via the Claude bridge:  td.ps1 -File tools\mission\td_mission.py
# Reads its request from %TEMP%\mission_args.json and prints one JSON line. Only these fixed actions exist:
#   {"action": "status"}                       show file, fps, ropes, panels, seasons, river cam
#   {"action": "ropes", "dark": true|false}    keep sending black (dark) or the canvas; never stops the sender
#   {"action": "hub75", "brightness": 0..1}    HUB75 output brightness
import json
import os
import sys
import time
import types

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
print(json.dumps(out, default=str))
