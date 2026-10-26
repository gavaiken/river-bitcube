"""Record a camera to a file on bitcube (the river library, plan item Q).

    python tools/cameras/record.py river --minutes 5                 # main + sub streams at once
    python tools/cameras/record.py river --minutes 5 --streams sub

The river link drops every minute or two (Starlink; 21 Oct), so each stream reconnects and keeps recording
numbered parts until it has --minutes in total (or --give-up minutes have passed). Parts are kept as they are
(-part1.mp4, -part2.mp4...): every one is a clean, playable clip.

Streams are copied as they arrive (no re-encoding: light on the CPU), with their sound, over RTSP/TCP into
C:/Users/user/River/recordings/<cam>/<cam>-<stream>-<yyyyMMdd-HHmm>.mkv. Matroska survives a dropped stream
(the river cam is on Starlink); each finished part is then remuxed to .mp4 next to it (instant) and the
.mkv removed. The camera URL comes from the untracked secrets.local.json and is never printed or logged.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO.parent / 'recordings'
FFMPEG = [r'C:\Program Files\WinGet\Links\ffmpeg.exe', 'ffmpeg']
RTSP_TIMEOUT_US = 15_000_000


# A camera's login, up to the authority's LAST @ (as calibrate.py and mission/lib/scrub.mjs): ffmpeg takes the last @ too, so
# an @ or a quote in the password is all login.
_CREDS = re.compile(r'([a-z][a-z0-9+.-]*://)[^\s/?#"<>]*@', re.I)


def mask(text):
    return _CREDS.sub(r'\1***@', str(text))


def ffmpeg():
    return next((f for f in FFMPEG if pathlib.Path(f).is_file()), 'ffmpeg')


def stream_url(url, stream):
    for name in ('main', 'sub'):
        url = url.replace(f'Preview_01_{name}', f'Preview_01_{stream}')
    return url


def record_args(url, seconds, out):
    return [ffmpeg(), '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout',
            str(RTSP_TIMEOUT_US), '-i', url, '-t', str(seconds), '-map', '0', '-c', 'copy', '-y', str(out)]


def duration(path):
    """Seconds of video in a file (ffprobe), or 0."""
    probe = ffmpeg().replace('ffmpeg.exe', 'ffprobe.exe') if ffmpeg().endswith('.exe') else 'ffprobe'
    try:
        r = subprocess.run([probe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                           capture_output=True, text=True, timeout=30)
        return float(r.stdout.strip() or 0)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 0.0


def record_stream(url, base, want, give_up, log):
    """Parts base-part<n>.mp4 until `want` seconds are recorded or `give_up` (monotonic) passes."""
    got, n = 0.0, 0
    while got < want - 2 and time.monotonic() < give_up:
        n += 1
        mkv = base.with_name(f'{base.name}-part{n}.mkv')
        p = subprocess.run(record_args(url, int(want - got) + 1, mkv), stdin=subprocess.DEVNULL,
                           capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        err = mask(p.stderr.decode('utf-8', 'replace').strip())[:200]
        secs = 0.0
        if mkv.is_file() and mkv.stat().st_size > 0:
            mp4 = mkv.with_suffix('.mp4')
            r = subprocess.run([ffmpeg(), '-hide_banner', '-loglevel', 'error', '-i', str(mkv), '-map', '0', '-c', 'copy',
                                '-movflags', '+faststart', '-y', str(mp4)], capture_output=True)
            out = mp4 if r.returncode == 0 and mp4.is_file() else mkv
            if out is mp4:
                mkv.unlink()
            secs = duration(out)
            got += secs
            line = f'{out.name}: {secs:.0f} s, {out.stat().st_size // 1024} KB (total {got:.0f}/{want:.0f} s) {err}'
        else:
            mkv.unlink(missing_ok=True)
            line = f'{mkv.name}: no video {err}'
        log(line)
        if secs < 1:
            time.sleep(5)                  # camera unreachable: wait before trying again
    return got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cam')
    ap.add_argument('--minutes', type=float, default=5)
    ap.add_argument('--streams', default='main,sub')
    ap.add_argument('--give-up', type=float, default=30, help='stop trying after this many minutes')
    a = ap.parse_args()
    url = json.loads((REPO / 'secrets.local.json').read_text(encoding='utf-8-sig'))['cameras'][a.cam]
    d = OUT / a.cam
    d.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M')
    lock = __import__('threading').Lock()
    logf = d / 'record.log'

    def log(line):
        line = f'{time.strftime("%Y-%m-%d %H:%M:%S")} {line}'
        with lock, open(logf, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
        print(line, flush=True)

    give_up = time.monotonic() + a.give_up * 60
    import threading
    threads = [threading.Thread(target=record_stream, args=(stream_url(url, s), d / f'{a.cam}-{s}-{stamp}',
                                                            a.minutes * 60, give_up, log)) for s in a.streams.split(',')]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    log('done')


if __name__ == '__main__':
    sys.exit(main())
