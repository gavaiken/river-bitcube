"""Temporary, reversible media-only trial in the running all-looks show; execute through tools/td.ps1.

APPLY (default): exec(open('C:/Users/user/River/river-bitcube/tools/remembered/video_trial.py').read())
ROLLBACK: exec(open('C:/Users/user/River/river-bitcube/tools/remembered/video_trial.py').read(), dict(globals(), TRIAL_ACTION='rollback'))
STATUS: same, TRIAL_ACTION='status'. Never saves the project or changes the source/defaults.
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
    if ACTION not in ('apply', 'rollback', 'status'):
        raise RuntimeError('Expected apply, rollback or status')
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
    if ACTION == 'status':
        print(json.dumps({'active': current == after, 'clips': current, 'file': player.par.file.eval(),
                          'temporary': True, 'saved_project_unchanged': True}))
        return
    if ACTION == 'apply':
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
    oldfile = player.par.file.eval().replace('\\', '/')
    # Keep the currently selected clip's identity. The normal loop selector keeps rotating the two entries.
    if oldfile not in before + after:
        raise RuntimeError('Unexpected selected movie; nothing changed')
    index = (before if oldfile in before else after).index(oldfile)
    oldlist = list(holder.clips)
    try:
        holder.clips = list(target)
        if oldfile != target[index]:
            player.par.file = target[index]
    except Exception:
        holder.clips = oldlist
        player.par.file = oldfile
        raise
    print(json.dumps({'action': ACTION, 'clips': holder.clips, 'file': player.par.file.eval(),
                      'temporary': True, 'rollback': str(statefile)}))

trial()
