"""The one check every runtime hot-patch tool in tools/remembered runs first (direct_video.py, video_trial.py,
profile_capture.py), inside the running TouchDesigner through tools/td.ps1.

Since 29 Oct river-all-looks.toe is FROZEN: its modules load from the pinned checkout C:\\Users\\user\\River\\river-bitcube-v1
(docs/checkpoints.md "all-looks-v1-frozen"), and patching them with source from the live checkout would corrupt it. The file
that runs the live code is river-all-looks-v2.toe.

A tool executed with exec(open(...).read()) has no __file__, so it finds this file the way they all do:
    sys.path.insert(0, 'C:/Users/user/River/river-bitcube/tools/remembered'); import runtime_guard
    runtime_guard.check('direct_video.py', project=project, replaced='...')
"""
import sys

V1_CHECKOUT = 'river-bitcube-v1'
V2 = 'river-all-looks-v2.toe'
TOOLS = 'C:/Users/user/River/river-bitcube/tools/remembered'


def frozen_v1(modules=None):
    """The loaded remembered.show's file when it comes from the pinned v1 checkout, else None."""
    show = (sys.modules if modules is None else modules).get('remembered.show')
    path = str(getattr(show, '__file__', '') or '').replace('\\', '/')
    return path if V1_CHECKOUT in path.lower() else None


def check(tool_name, allow=(V2,), project=None, modules=None, replaced=None):
    """Raise RuntimeError (nothing changed) when the frozen v1 file is running or the open file isn't in allow.
    Prints one line on what replaced the tool in v2 first, so the reminder shows even when it refuses."""
    if replaced:
        print(f'{tool_name}: in v2, {replaced}')
    v1 = frozen_v1(modules)
    if v1:
        raise RuntimeError(f'{tool_name}: the frozen v1 file is running (remembered.show loads from {v1}): never patch it; '
                           f'switch to {V2} or change v1 by moving its pinned checkout, docs/checkpoints.md. Nothing changed.')
    if project is None:
        try:
            import td                                         # TouchDesigner's module (absent in tests)
            project = td.project
        except Exception:                                     # noqa: BLE001
            project = None
    name = getattr(project, 'name', None)
    if name not in allow:
        raise RuntimeError(f'{tool_name}: runs only in {", ".join(allow)}; the open file is {name or "unknown"}. '
                           'Nothing changed.')
    return name
