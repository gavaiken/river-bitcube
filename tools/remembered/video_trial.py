"""Temporary, reversible media-only trial in the running all-looks show; execute through tools/td.ps1.

APPLY (default): exec(open('C:/Users/user/River/river-bitcube/tools/remembered/video_trial.py').read())
ROLLBACK: exec(open('C:/Users/user/River/river-bitcube/tools/remembered/video_trial.py').read(), dict(globals(), TRIAL_ACTION='rollback'))
KEEP: same, TRIAL_ACTION='keep' persists an all-looks media preference for startup.
STATUS: same, TRIAL_ACTION='status'. Rollback also removes this preference. Never saves the project.
The trial videos and manifest must already be verified outside TD and staged in TRIAL_DIR.
"""
import json
import sys
from pathlib import Path

ACTION = globals().get('TRIAL_ACTION', 'apply')
ROOT = Path(globals().get('TRIAL_DIR', 'C:/Users/user/River/recordings/river/motion30-trial-20261028'))
ORIGINAL = Path('C:/Users/user/River/recordings/river/remembered')
NAMES = ('a-cascade-2026-10-27-1451-640.mp4', 'b-evening-2026-10-27-1813-640.mp4')

def trial():
    if ACTION not in ('apply', 'keep', 'rollback', 'status'):
        raise RuntimeError('Expected apply, keep, rollback or status')
    if project.name != 'river-all-looks.toe':
        raise RuntimeError('This trial is only for the running all-looks show')
    holder = sys.modules.get('remembered_live')
    player = op('/project1/remembered/fallback_clip')
    if holder is None or player is None or not getattr(holder, 'clips', None):
        raise RuntimeError('Remembered river is not initialized; nothing changed')
    before = [str(ORIGINAL / n).replace('\\', '/') for n in NAMES]
    after = [str(ROOT / n).replace('\\', '/') for n in NAMES]
    current = list(holder.clips)
    if current not in (before, after):
        raise RuntimeError('Unexpected clip list; preserve it and investigate before changing anything')
    statefile = ROOT / 'trial-state.json'
    preference = ORIGINAL.parents[2] / 'remembered' / 'video-library.json'
    previous = preference.read_bytes() if preference.exists() else None
    config = json.loads(previous.decode('utf-8-sig')) if previous is not None else {'shows': {}}
    if not isinstance(config, dict) or not isinstance(config.get('shows'), dict):
        raise RuntimeError('Unexpected existing video preference; nothing changed')
    choice = {'directory': ROOT.name, 'files': list(NAMES)}
    selected = config['shows'].get(project.name)
    persistent = selected == choice
    def write_preference(data):
        temp = preference.with_suffix('.json.tmp')
        temp.write_text(json.dumps(data, indent=2), encoding='utf-8')
        temp.replace(preference)
    if ACTION == 'status':
        print(json.dumps({'active': current == after, 'clips': current, 'file': player.par.file.eval(),
                          'temporary': not persistent, 'persistent': persistent, 'saved_project_unchanged': True}))
        return
    if ACTION in ('apply', 'keep'):
        manifest = json.loads((ROOT / 'manifest.json').read_text())
        if [m['name'] for m in manifest] != list(NAMES):
            raise RuntimeError('Unexpected render manifest')
        for m in manifest:
            p = ROOT / m['name']
            if not p.is_file() or p.stat().st_size != int(m['output']['format']['size']):
                raise RuntimeError('Trial media not fully staged; nothing changed')
        if not statefile.exists():
            if current != before:
                raise RuntimeError('Cannot establish original state')
            statefile.write_text(json.dumps({'original_clips': before, 'trial_clips': after,
                                            'original_file': player.par.file.eval()}, indent=2))
        state = json.loads(statefile.read_text())
        if state.get('original_clips') != before or state.get('trial_clips') != after:
            raise RuntimeError('Checkpoint mismatch; nothing changed')
        target = after
    else:
        state = json.loads(statefile.read_text())
        if state.get('original_clips') != before or state.get('trial_clips') != after:
            raise RuntimeError('Checkpoint mismatch; nothing changed')
        if not all(Path(p).is_file() for p in before):
            raise RuntimeError('Original footage missing; nothing changed')
        target = before
    if ACTION in ('keep', 'rollback') and selected not in (None, choice):
        raise RuntimeError('Another preference is configured; preserve it and investigate')
    oldfile = player.par.file.eval().replace('\\', '/')
    # Keep the currently selected clip's identity. The normal loop selector keeps rotating the two entries.
    if oldfile not in before + after:
        raise RuntimeError('Unexpected selected movie; nothing changed')
    index = (before if oldfile in before else after).index(oldfile)
    oldlist = list(holder.clips)
    try:
        if ACTION == 'keep':
            config['shows'][project.name] = choice
            write_preference(config)
        elif ACTION == 'rollback' and persistent:
            del config['shows'][project.name]
            write_preference(config)
        holder.clips = list(target)
        if oldfile != target[index]:
            player.par.file = target[index]
    except Exception:
        if ACTION in ('keep', 'rollback'):
            if previous is None:
                preference.unlink(missing_ok=True)
            else:
                preference.write_bytes(previous)
        holder.clips = oldlist
        player.par.file = oldfile
        raise
    print(json.dumps({'action': ACTION, 'clips': holder.clips, 'file': player.par.file.eval(),
                      'temporary': ACTION != 'keep', 'persistent': ACTION == 'keep', 'rollback': str(statefile)}))

trial()
