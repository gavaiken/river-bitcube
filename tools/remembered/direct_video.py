"""All-looks direct recorded-video mode. Through td.ps1: default enable; DIRECT_VIDEO=False restores the mask, retaining optimized GPU video delivery.
No shader, graph, movie, clock or show reset. Source functions are patched in place to preserve profiler wrappers.
"""
import ast
import json
import sys
import types
from pathlib import Path

if project.name != 'river-all-looks.toe':
    raise RuntimeError('Direct video is scoped to the all-looks show')
ENABLED = globals().get('DIRECT_VIDEO', True)
if not isinstance(ENABLED, bool):
    raise RuntimeError('DIRECT_VIDEO must be boolean')
runtime = sys.modules.get('remembered.show')
holder = sys.modules.get('remembered_live')
if runtime is None or holder is None or holder.show is None:
    raise RuntimeError('Remembered runtime not initialized')
path = Path('C:/Users/user/River/river-bitcube/td/remembered/show.py')
functions = ('parse_control', 'direct_recorded_video', 'cpu_video_crops', 'mask_image', 'step')
tree = ast.parse(path.read_text(encoding='utf-8'))
selected = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in functions}
if set(selected) != set(functions):
    raise RuntimeError('Source functions missing; nothing changed')
# Prepare every code object before editing anything. Existing closure-free functions keep their identity.
prepared = {}
for name, node in selected.items():
    ns = dict(runtime.__dict__)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), ns)
    prepared[name] = ns[name]
    old = getattr(runtime, name, None)
    while old is not None and hasattr(old, '__wrapped__'):
        old = old.__wrapped__
    if old is not None and (old.__code__.co_freevars or ns[name].__code__.co_freevars):
        raise RuntimeError('Unexpected closure; nothing changed')
control_path = Path('C:/Users/user/River/remembered/control.json')
control = json.loads(control_path.read_text(encoding='utf-8-sig'))
if not isinstance(control, dict) or ('screens' in control and not isinstance(control['screens'], dict)):
    raise RuntimeError('Unexpected controls; nothing changed')
for name, new in prepared.items():
    old = getattr(runtime, name, None)
    while old is not None and hasattr(old, '__wrapped__'):
        old = old.__wrapped__
    if old is None:
        # New helpers resolve live globals, including the other prepared functions.
        runtime.__dict__[name] = types.FunctionType(new.__code__, runtime.__dict__, name, new.__defaults__)
    else:
        old.__code__ = new.__code__
runtime.CONTROL_DEFAULT.setdefault('screen_motion_mask', True)
control.setdefault('screens', {})['motion_mask'] = not ENABLED
temp = control_path.with_suffix('.json.tmp')
temp.write_text(json.dumps(control, indent=2), encoding='utf-8')
temp.replace(control_path)
holder.show.control['screen_motion_mask'] = not ENABLED
print(json.dumps({'direct_recorded_video_enabled': ENABLED, 'active': runtime.direct_recorded_video(holder.show),
                  'cpu_crops_needed': runtime.cpu_video_crops(holder.show), 'clip': op('/project1/remembered/fallback_clip').par.file.eval(),
                  'movie_fps': op('/project1/remembered/fallback_clip').rate, 'mask_min': float(runtime.mask_image(holder.show).min()),
                  'mask_max': float(runtime.mask_image(holder.show).max()), 'epoch': __import__('time').time(),
                  'profiler_wrapper_preserved': hasattr(runtime.step, '__wrapped__')}))
