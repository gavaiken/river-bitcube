"""Make the river library's three playback speeds for river-local-oct-22-seasons.toe (run on bitcube).

    python tools/seasons/prerender.py                 # from every river-main-*.mp4 in River/recordings/river
    python tools/seasons/prerender.py --quality mci   # slower to make, smoother slow motion

Writes River/recordings/river/seasons/river-{slow,normal,fast}.mp4: 1280x720 (the Non-Commercial TD limit),
30 fps, H.264, no sound. The clips are joined into one, then
  slow    4x slower, with in-between frames generated (the camera only gives 16 fps, so plain slow motion
          would stutter): 'blend' crossfades neighbouring frames (fast), 'mci' estimates motion (smoother,
          much slower to make)
  normal  as recorded
  fast    2x faster
TouchDesigner crossfades between them by intensity: winter plays the slow one, summer the fast one.
"""
import argparse
import pathlib
import subprocess
import sys
import tempfile

RIVER = pathlib.Path(__file__).resolve().parents[3]
LIB = RIVER / 'recordings' / 'river'
OUT = LIB / 'seasons'
FFMPEG = r'C:\Program Files\WinGet\Links\ffmpeg.exe'


def ffmpeg():
    return FFMPEG if pathlib.Path(FFMPEG).is_file() else 'ffmpeg'


def encode(src, dst, vf):
    tmp = dst.with_suffix('.part.mp4')
    subprocess.run([ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src), '-an', '-vf', vf,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '30',
                    '-movflags', '+faststart', str(tmp)], check=True)
    tmp.replace(dst)
    print('wrote', dst.name, round(dst.stat().st_size / 1e6, 1), 'MB', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--quality', choices=('blend', 'mci'), default='blend')
    ap.add_argument('--lib', type=pathlib.Path, default=LIB, help='folder with river-main-*.mp4 (default: bitcube\'s)')
    a = ap.parse_args()
    global OUT
    OUT = a.lib / 'seasons'
    clips = sorted(p for p in a.lib.glob('river-main-*.mp4'))
    if not clips:
        sys.exit(f'no river-main-*.mp4 in {LIB}')
    OUT.mkdir(parents=True, exist_ok=True)
    scale = 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720'
    with tempfile.TemporaryDirectory() as d:
        joined = pathlib.Path(d) / 'joined.mp4'
        if len(clips) == 1:
            joined = clips[0]
        else:
            lst = pathlib.Path(d) / 'list.txt'
            lst.write_text(''.join(f"file '{c.as_posix()}'\n" for c in clips), encoding='utf-8')
            subprocess.run([ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
                            '-i', str(lst), '-an', '-vf', scale + ',fps=16', '-c:v', 'libx264', '-preset', 'veryfast',
                            '-crf', '18', str(joined)], check=True)
        mi = 'mi_mode=blend' if a.quality == 'blend' else 'mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1'
        encode(joined, OUT / 'river-normal.mp4', f'{scale},fps=30')
        encode(joined, OUT / 'river-fast.mp4', f'{scale},setpts=0.5*PTS,fps=30')
        encode(joined, OUT / 'river-slow.mp4', f'{scale},setpts=4*PTS,minterpolate=fps=30:{mi}')
    print('river library ready in', OUT, f'({len(clips)} clip(s))')


if __name__ == '__main__':
    main()
