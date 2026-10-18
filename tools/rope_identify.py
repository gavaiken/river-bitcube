"""Find each rope in a camera capture made by tools/rope_capture.ps1.

    python tools/rope_identify.py frames/ropeid-YYYYMMDD-HHMMSS   (needs numpy + pillow)

Each rope is lit alone in its own frame, so the per-pixel median of all frames is a good "dark"
reference even when daylight or exposure drifts. A pixel counts as lit when it is much brighter
than the median and near-white. Prints, per rope, how many pixels lit, where (centroid, box) and
which third of the image; ropes with almost nothing lit are flagged (dead, unplugged or hidden).
Writes ropeid.json and annotated.png into the capture folder.

The camera must not move during the capture: compare base_black.jpg and base_black_end.jpg.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

W = 960
MIN_PX = 300


def load(folder, name):
    im = Image.open(f'{folder}/{name}.jpg').convert('RGB')
    return np.asarray(im.resize((W, int(im.height * W / im.width))), dtype=np.int16)


def main(folder):
    names = [f'rope{i:02d}' for i in range(20)]
    frames = [load(folder, n) for n in names]
    base = load(folder, 'base_black')
    end = load(folder, 'base_black_end')
    moved = float(np.abs(base - end).max(axis=2).mean())
    print(f'camera/scene drift between start and end dark frames: {moved:.1f} (above ~15 means the view changed; rerun)')

    ref = np.median(np.stack(frames + [base, end]), axis=0)
    thirds = ('left', 'middle', 'right')
    out, masks = {}, {}
    for i, f in enumerate(frames):
        m = ((f - ref).max(axis=2) > 45) & (f.min(axis=2) > 150)
        n = int(m.sum())
        r = {'rope': i + 1, 'box': i // 10 + 1, 'out': i % 10 + 1, 'lit_px': n}
        if n >= MIN_PX:
            ys, xs = np.nonzero(m)
            r.update(cx=int(xs.mean()), cy=int(ys.mean()),
                     box_xy=[int(np.percentile(xs, 2)), int(np.percentile(ys, 2)),
                             int(np.percentile(xs, 98)), int(np.percentile(ys, 98))],
                     third=thirds[min(2, int(xs.mean() * 3 / W))])
            masks[i] = m
        else:
            r['flag'] = 'nothing seen: dead, unplugged, or hidden from the camera'
        out[f'rope{i + 1:02d}'] = r
        where = f"{r['third']:6s} centre=({r['cx']},{r['cy']})" if 'cx' in r else r['flag']
        print(f"rope {i + 1:2d} (box {r['box']} OUT{r['out']:2d}): lit={n:6d}  {where}")

    im = Image.fromarray(np.clip(ref, 0, 255).astype('uint8'))
    pal = [(255, 80, 80), (80, 255, 80), (80, 160, 255), (255, 220, 60), (255, 80, 255),
           (80, 255, 255), (255, 160, 60), (200, 200, 255), (160, 255, 160), (255, 255, 255)]
    arr = np.asarray(im).copy()
    for i, m in masks.items():
        arr[m] = (0.4 * arr[m] + 0.6 * np.array(pal[i % 10])).astype('uint8')
    im = Image.fromarray(arr)
    dr = ImageDraw.Draw(im)
    for i in masks:
        r = out[f'rope{i + 1:02d}']
        dr.text((r['cx'] - 6, r['cy'] - 6), str(i + 1), fill=(255, 255, 255))
    im.save(f'{folder}/annotated.png')
    json.dump({'drift': moved, 'ropes': out}, open(f'{folder}/ropeid.json', 'w'), indent=1)
    print(f'wrote {folder}/ropeid.json and annotated.png')


if __name__ == '__main__':
    main(sys.argv[1])
