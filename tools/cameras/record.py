"""Record a camera to a file on bitcube (the river library, plan item Q).

    python tools/cameras/record.py river --minutes 5                 # main + sub streams at once
    python tools/cameras/record.py river --minutes 5 --streams sub

Streams are copied as they arrive (no re-encoding: light on the CPU), with their sound, over RTSP/TCP into
C:/Users/user/River/recordings/<cam>/<cam>-<stream>-<yyyyMMdd-HHmm>.mkv. Matroska survives a dropped stream
(the river cam is on Starlink); each finished file is then remuxed to .mp4 next to it (instant) and the .mkv
removed. The camera URL comes from the untracked secrets.local.json and is never printed or logged.
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


def mask(text):
    return re.sub(r'(rtsp://)[^@/\s]*@', r'\1***@', text)


def ffmpeg():
    return next((f for f in FFMPEG if pathlib.Path(f).is_file()), 'ffmpeg')


def stream_url(url, stream):
    for name in ('main', 'sub'):
        url = url.replace(f'Preview_01_{name}', f'Preview_01_{stream}')
    return url


def record_args(url, seconds, out):
    return [ffmpeg(), '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout',
            str(RTSP_TIMEOUT_US), '-i', url, '-t', str(seconds), '-map', '0', '-c', 'copy', '-y', str(out)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cam')
    ap.add_argument('--minutes', type=float, default=5)
    ap.add_argument('--streams', default='main,sub')
    a = ap.parse_args()
    url = json.loads((REPO / 'secrets.local.json').read_text(encoding='utf-8-sig'))['cameras'][a.cam]
    d = OUT / a.cam
    d.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M')
    procs = {}
    for s in a.streams.split(','):
        mkv = d / f'{a.cam}-{s}-{stamp}.mkv'
        procs[s] = (mkv, subprocess.Popen(record_args(stream_url(url, s), int(a.minutes * 60), mkv),
                                          stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.PIPE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)))
    log = open(d / 'record.log', 'a', encoding='utf-8')
    for s, (mkv, p) in procs.items():
        err = p.communicate()[1].decode('utf-8', 'replace')
        mp4 = mkv.with_suffix('.mp4')
        ok = mkv.is_file() and mkv.stat().st_size > 0
        if ok:
            r = subprocess.run([ffmpeg(), '-hide_banner', '-loglevel', 'error', '-i', str(mkv), '-map', '0', '-c', 'copy',
                                '-movflags', '+faststart', '-y', str(mp4)], capture_output=True)
            if r.returncode == 0 and mp4.is_file():
                mkv.unlink()
        out = mp4 if mp4.is_file() else mkv
        line = (f'{time.strftime("%Y-%m-%d %H:%M:%S")} {s}: exit {p.returncode}, '
                f'{out.name if ok else "no file"} {out.stat().st_size // 1024 if ok else 0} KB {mask(err.strip())[:300]}')
        print(line)
        log.write(line + '\n')
    log.close()


if __name__ == '__main__':
    sys.exit(main())
