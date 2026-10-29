"""The recorded-video motion mask switch for river-all-looks-v2.toe. Through td.ps1:
    exec(open('C:/Users/user/River/river-bitcube/tools/remembered/direct_video.py').read(), dict(globals(), DIRECT_VIDEO=True))
DIRECT_VIDEO=True (default) lets recorded video bypass the slow motion mask; False restores the mask.

v2 needs no patching: the switch is control.json's screens.motion_mask (control_schema field; the show reads control.json
itself, mtime-gated) and the GPU readback skip is built in (show.all_looks). This writes only screens.motion_mask (and the
file's "at" stamp) in the schema's canonical shape, atomically (a .tmp beside it, then os.replace), and patches nothing.
Refuses on the frozen river-all-looks.toe (runtime_guard.py): the v1-era version patched show.py from the live checkout.
"""
import importlib
import json
import os
import sys
import time
from pathlib import Path

CONTROL = Path('C:/Users/user/River/remembered/control.json')
REPLACED = ("this only writes control.json screens.motion_mask (the show reads it itself; the readback skip is built in, "
            "show.all_looks); no module patching")


def _guard():
    here = globals().get('__file__')
    folder = str(Path(here).resolve().parent) if here and (Path(here).resolve().parent / 'runtime_guard.py').is_file() \
        else 'C:/Users/user/River/river-bitcube/tools/remembered'
    if folder not in sys.path:
        sys.path.insert(0, folder)
    import runtime_guard
    return importlib.reload(runtime_guard)


def write_motion_mask(path, mask, now=None):
    """control.json with screens.motion_mask = mask (and "at"), every other key as it was. Returns the new dict."""
    if not isinstance(mask, bool):
        raise RuntimeError('motion_mask must be boolean; nothing changed')
    path = Path(path)
    control = json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}
    if not isinstance(control, dict) or ('screens' in control and not isinstance(control['screens'], dict)):
        raise RuntimeError('Unexpected control.json shape; nothing changed')
    control.setdefault('screens', {})['motion_mask'] = mask
    control['at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() if now is None else now))
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(control, indent=2), encoding='utf-8')
    os.replace(temp, path)
    return control


def run(project, enabled=True, control=CONTROL, modules=None):
    _guard().check('direct_video.py', project=project, modules=modules, replaced=REPLACED)
    if not isinstance(enabled, bool):
        raise RuntimeError('DIRECT_VIDEO must be boolean; nothing changed')
    written = write_motion_mask(control, not enabled)
    print(json.dumps({'direct_recorded_video_enabled': enabled, 'screens.motion_mask': written['screens']['motion_mask'],
                      'control': str(control), 'at': written['at'],
                      'note': 'v2 picks this up on its next control read (show.parse_control); nothing patched'}))
    return written


if 'op' in globals() and 'project' in globals():
    run(project, globals().get('DIRECT_VIDEO', True))
