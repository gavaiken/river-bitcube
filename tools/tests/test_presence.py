import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'presence'))
import counter  # noqa: E402


def pred_with(boxes, n=8400):
    """A fake YOLOv8 output (1, 84, n): boxes = [(cx, cy, w, h, person_score)] in 640x640 letterbox pixels."""
    p = np.zeros((1, 84, n), np.float32)
    for i, (cx, cy, w, h, s) in enumerate(boxes):
        p[0, :4, i] = cx, cy, w, h
        p[0, 4, i] = s
    return p


def test_letterbox_keeps_aspect_and_centres():
    x, (s, px, py) = counter.letterbox(np.zeros((360, 640, 3), np.uint8))
    assert x.shape == (1, 3, 640, 640) and s == 1.0 and px == 0 and py == 140


def test_people_maps_back_to_frame_pixels():
    geom = (1.0, 0, 140)
    boxes = counter.people(pred_with([(320, 320, 100, 200, 0.9)]), geom, 640, 360)
    assert len(boxes) == 1
    x1, y1, x2, y2, s = boxes[0]
    assert (x1, y1, x2, y2) == (270, 80, 370, 280) and abs(s - 0.9) < 1e-6


def test_low_scores_and_duplicates_are_dropped():
    geom = (1.0, 0, 140)
    boxes = counter.people(pred_with([(320, 320, 100, 200, 0.9), (322, 318, 100, 200, 0.8), (100, 320, 50, 100, 0.2)]),
                           geom, 640, 360)
    assert len(boxes) == 1


def test_two_people_side_by_side_are_two():
    geom = (1.0, 0, 140)
    assert len(counter.people(pred_with([(200, 320, 80, 200, 0.9), (420, 320, 80, 200, 0.85)]), geom, 640, 360)) == 2


def test_near_counts_only_tall_boxes():
    boxes = [(0, 0, 10, 120, 0.9), (0, 0, 10, 60, 0.9)]          # 1/3 and 1/6 of a 360 px frame
    assert counter.near(boxes, 360, 0.25) == 1


def test_motion_count():
    a = np.zeros((100, 100, 3), np.uint8)
    b = a.copy()
    b[:20, :40] = 200                                             # 8% of the frame changed
    assert counter.motion_count(None, a) == 0 and counter.motion_count(a, b) == 2


def test_write_json_is_whole(tmp_path):
    f = tmp_path / 'presence.json'
    counter.write_json(f, {'t': 1.0, 'count': 3})
    assert json.loads(f.read_text()) == {'t': 1.0, 'count': 3} and not (tmp_path / 'presence.tmp').exists()
