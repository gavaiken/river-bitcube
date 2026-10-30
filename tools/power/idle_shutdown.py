"""bitcube shuts itself down after IDLE_HOURS without anyone in the gallery cam's view, never between 12:00 and 21:00,
and only until UNTIL (Gavin, 29-30 Oct 2026; replaces the dated nightly shutdown). After UNTIL it never shuts bitcube
down and the task removes itself: no automatic on or off after the show week. Run every 5 minutes as SYSTEM by the scheduled task River-IdleShutdown
(tools/power/idle_shutdown.ps1 registers it). The morning wake is unchanged (the Mac mini, tools/mini/wake_bitcube.sh).

Idle = now - the newest of: the last time the people counter saw anyone (River\\presence-seen.json, written by
tools/presence/counter.py), the boot, and River\\power\\keep-on-until.txt (a unix time; nothing shuts down before it).
It never shuts down on missing information: if the counter isn't writing (River\\presence-status.json older than
STALE_S) or its camera stream is down, it keeps bitcube on and says why. So a broken camera can't turn the show off,
but it also won't turn off at night until the counter works again.

    python tools\\power\\idle_shutdown.py            check once; shut down (shutdown /s /f /t 60) if idle
    python tools\\power\\idle_shutdown.py --status   print the decision, change nothing
Every check is one line in River\\logs\\idle-shutdown.log.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

IDLE_HOURS = 2.0
KEEP_ON_HOURS = (12, 21)   # local time: never shut down from 12:00 until 21:00
UNTIL = (2026, 11, 7)      # local midnight starting 7 Nov: from then on, nothing (the task removes itself)
STALE_S = 120.0            # presence-status.json older than this: the counter isn't running
RIVER = Path(__file__).resolve().parents[3]
STATUS = RIVER / 'presence-status.json'
SEEN = RIVER / 'presence-seen.json'
KEEP_ON = RIVER / 'power' / 'keep-on-until.txt'
LOG = RIVER / 'logs' / 'idle-shutdown.log'
MESSAGE = ('A River Becoming: nobody seen for {h:g} hours; bitcube shuts down in a minute '
           '(tools/power/idle_shutdown.py). Cancel: shutdown /a')


def until_t():
    return time.mktime((*UNTIL, 0, 0, 0, 0, 0, -1))


def decide(now, boot_t, status, seen_t, keep_until=None, idle_s=IDLE_HOURS * 3600, stale_s=STALE_S,
           hour=None, expires_t=None):
    """(shut_down, reason). status: presence-status.json as a dict, or None. hour: local hour now. Pure."""
    if expires_t is not None and now >= expires_t:
        return False, 'the show week is over: no automatic shutdown any more'
    if hour is not None and KEEP_ON_HOURS[0] <= hour < KEEP_ON_HOURS[1]:
        return False, f'{KEEP_ON_HOURS[0]}:00-{KEEP_ON_HOURS[1]}:00: never shuts down in these hours'
    if not isinstance(status, dict) or not isinstance(status.get('t'), (int, float)):
        return False, 'the people counter has written no status: keeping bitcube on'
    if now - status['t'] > stale_s:
        return False, f"the people counter stopped {(now - status['t']) / 60:.0f} min ago: keeping bitcube on"
    if status.get('stream') is False:
        return False, "the counter's camera stream is down: keeping bitcube on"
    marks = [('boot', boot_t), ('someone seen', seen_t), ('keep-on', keep_until)]
    marks = [(k, float(t)) for k, t in marks if isinstance(t, (int, float))]
    if not marks:
        return False, 'no boot time: keeping bitcube on'
    what, last = max(marks, key=lambda m: m[1])
    idle = now - last
    if idle < idle_s:
        return False, f'last {what} {idle / 60:.0f} min ago; shuts down after {idle_s / 3600:g} h of nobody'
    return True, f'last {what} {idle / 3600:.1f} h ago: shutting down'


def _json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None


def _boot_t():
    try:
        import ctypes
        return time.time() - ctypes.windll.kernel32.GetTickCount64() / 1000.0
    except Exception:                                             # noqa: BLE001 - not Windows
        return None


def _keep_until():
    try:
        return float(KEEP_ON.read_text().strip())
    except (OSError, ValueError):
        return None


def main(argv):
    now = time.time()
    seen = _json(SEEN)
    seen_t = seen.get('t') if isinstance(seen, dict) else None
    expires = until_t()
    shut, reason = decide(now, _boot_t(), _json(STATUS), seen_t, _keep_until(), hour=time.localtime(now).tm_hour,
                          expires_t=expires)
    status_only = '--status' in argv
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {'SHUTDOWN' if shut and not status_only else 'on'}: {reason}"
    print(line)
    if status_only:
        return 0
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open('a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass
    if now >= expires and sys.platform == 'win32':            # the week is over: the task removes itself
        subprocess.run(['schtasks.exe', '/Delete', '/TN', 'River-IdleShutdown', '/F'], check=False)
    if shut:
        subprocess.run(['shutdown.exe', '/s', '/f', '/t', '60', '/c', MESSAGE.format(h=IDLE_HOURS)], check=False)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
