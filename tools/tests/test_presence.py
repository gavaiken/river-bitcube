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


# ---- people, stillness and lingerers (docs/remembered-river.md §4) ----------------------------------------------------
def box(cx, bottom, h, w=None, frame_h=360):
    """A person box in frame pixels: centre x, bottom y, height as a share of the frame."""
    hp = h * frame_h
    w = w or hp * 0.4
    return (cx - w / 2, bottom - hp, cx + w / 2, bottom, 0.9)


def test_tracker_follows_one_person_and_times_stillness():
    t = counter.Tracker(640, 360)
    for k in range(20):                                           # 10 s at 2 fps, a little jitter
        ppl = t.update([box(320 + (k % 3), 340, 0.5)], k * 0.5)
    assert len(ppl) == 1 and len(t.tracks) == 1
    p = ppl[0]
    assert abs(p['x'] - 0.5) < 0.01 and abs(p['y'] - 340 / 360) < 0.01 and abs(p['h'] - 0.5) < 0.01
    assert p['still_s'] == 9.5


def test_walking_restarts_the_stillness_clock():
    t = counter.Tracker(640, 360)
    for k in range(10):
        t.update([box(100 + 15 * k, 340, 0.5)], k * 0.5)          # walking: ~0.04 frame heights a frame
    for k in range(10, 14):
        ppl = t.update([box(250, 340, 0.5)], k * 0.5)             # stops
    assert len(t.tracks) == 1
    assert ppl[0]['still_s'] <= 2.0


def test_two_people_keep_their_own_clocks_when_crossing_paths():
    t = counter.Tracker(640, 360)
    for k in range(20):
        ppl = t.update([box(150, 340, 0.5), box(500 - 10 * k, 330, 0.45)], k * 0.5)
    assert len(t.tracks) == 2
    still = sorted(p['still_s'] for p in ppl)
    assert still[0] < 1 and still[1] == 9.5


def test_a_missed_detection_doesnt_forget_a_person():
    t = counter.Tracker(640, 360)
    for k in range(10):
        t.update([box(320, 340, 0.5)], k * 0.5)
    assert t.update([], 5.0) and len(t.update([], 5.6)) == 0      # kept in people for 1 s, then left out ...
    ppl = t.update([box(321, 340, 0.5)], 6.0)                     # ... but remembered for 2 s: the clock goes on
    assert len(t.tracks) == 1 and ppl[0]['still_s'] == 6.0
    t.update([], 7.0)
    t.update([], 8.5)
    assert t.tracks == []                                         # gone after TRACK_KEEP_S


def test_lingerers_are_still_and_close_with_their_nearest_ropes():
    feet = [{'rope': r, 'x': 0.3 + 0.05 * r, 'y': 0.95} for r in range(8)]
    ppl = [{'x': 0.41, 'y': 0.94, 'h': 0.6, 'still_s': 12.0},     # still and close: a lingerer
           {'x': 0.41, 'y': 0.94, 'h': 0.6, 'still_s': 3.0},      # close, not still long enough
           {'x': 0.41, 'y': 0.60, 'h': 0.2, 'still_s': 30.0},     # still, far
           {'x': 0.95, 'y': 0.94, 'h': 0.5, 'still_s': 9.0}]      # still and close, no rope near
    ls = counter.lingerers(ppl, feet, 640 / 360)
    assert ls == [{'x': 0.41, 'y': 0.94, 'still_s': 12.0, 'ropes': [2, 3]},
                  {'x': 0.95, 'y': 0.94, 'still_s': 9.0, 'ropes': []}]
    assert counter.LINGER_STILL_S == 5.0 and counter.LINGER_MIN_H == 0.25


def test_presence_record_keeps_t_and_count(tmp_path):
    t = counter.Tracker(640, 360)
    for k in range(20):
        t.update([box(320, 350, 0.6)], 100 + k * 0.5)
    rec = counter.record(109.5, 1, t, [{'rope': 4, 'x': 0.52, 'y': 0.97}])
    assert rec['t'] == 109.5 and rec['count'] == 1
    assert rec['lingerers'] == [{'x': 0.5, 'y': 0.972, 'still_s': 9.5, 'ropes': [4]}]
    assert counter.record(1.0, 2, None, []) == {'t': 1.0, 'count': 2, 'people': [], 'lingerers': []}
    f = tmp_path / 'presence.json'
    counter.write_json(f, rec)
    assert json.loads(f.read_text())['count'] == 1


def test_zones_path_prefers_the_argument_then_a_pin_then_the_newest(tmp_path):
    (tmp_path / 'tools' / 'pixelmap').mkdir(parents=True)
    assert counter.zones_path(None, tmp_path) is None
    for d in ('2026-10-27', '2026-10-29'):
        (tmp_path / 'tools' / 'pixelmap' / f'zones-{d}.json').write_text('{"feet": []}')
    assert counter.zones_path(None, tmp_path).name == 'zones-2026-10-29.json'
    (tmp_path / 'shows.json').write_text(json.dumps({'shows': [
        {'file': 'a.toe', 'calibration': {'pixelmap': 'x.json'}},
        {'file': 'b.toe', 'calibration': {'zones': 'tools/pixelmap/zones-2026-10-27.json'}}]}))
    assert counter.zones_path(None, tmp_path).name == 'zones-2026-10-27.json'
    assert counter.zones_path('elsewhere.json', tmp_path) == Path('elsewhere.json')
    feet = counter.Feet(tmp_path / 'tools' / 'pixelmap' / 'zones-2026-10-27.json')
    assert feet.get(0) == []


# ---- surviving a busy presence.json and a restart (docs/remembered-v2-plan.md step 1a) -------------------------------
def refusing_replace(fails, calls):
    """An os.replace that raises Windows' WinError 5 the first `fails` times (a reader has the file open)."""
    import os

    def replace(src, dst):
        calls.append(dst)
        if len(calls) <= fails:
            raise PermissionError(13, 'Access is denied')
        os.replace(src, dst)
    return replace


def test_write_json_retries_a_refused_swap(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(counter, '_replace', refusing_replace(2, calls))
    f = tmp_path / 'presence.json'
    assert counter.write_json(f, {'t': 1.0, 'count': 3}, wait=0) is True
    assert len(calls) == 3 and json.loads(f.read_text()) == {'t': 1.0, 'count': 3}


def test_write_json_skips_a_write_it_cant_swap_in_without_raising(tmp_path, monkeypatch):
    calls, logged = [], []
    monkeypatch.setattr(counter, '_replace', refusing_replace(10 ** 6, calls))
    monkeypatch.setattr(counter, 'log', logged.append)
    monkeypatch.setattr(counter, '_logged', {})
    f = tmp_path / 'presence.json'
    f.write_text('{"t": 0.5, "count": 1}')                        # the last good one stays for readers
    for _ in range(3):
        assert counter.write_json(f, {'t': 1.0, 'count': 3}, wait=0) is False
    assert len(calls) == 3 * counter.REPLACE_TRIES
    assert json.loads(f.read_text()) == {'t': 0.5, 'count': 1}
    assert len(logged) == 1 and 'presence.json not written' in logged[0]   # logged once, not every 0.5 s


def test_write_json_never_raises_on_an_unwritable_object(tmp_path):
    assert counter.write_json(tmp_path / 'x.json', {'bad': object()}) is False


def test_tracker_state_round_trips_and_keeps_the_stillness_clock(tmp_path):
    t = counter.Tracker(640, 360)
    for k in range(12):                                           # 5.5 s still
        t.update([box(320, 340, 0.5), box(100 + 15 * k, 330, 0.45)], 1000 + k * 0.5)
    f = tmp_path / 'presence-tracker.json'
    assert counter.write_json(f, t.state(1005.5))
    restarted = counter.Tracker(640, 360)                         # the supervisor's restart, 15 s later
    assert restarted.restore(counter.read_tracker_state(f), 1020.5) == 2
    assert restarted.next_id == t.next_id and restarted.people(1020.5) == []   # nobody shown until seen again
    ppl = restarted.update([box(321, 340, 0.5)], 1021.0)          # the still one is seen again; the walker has gone
    assert len(ppl) == 1 and ppl[0]['still_s'] == 21.0            # clock from 1000, not from the restart
    assert len(counter.lingerers(ppl, [])) == 1                   # so they count as a lingerer at once
    restarted.update([box(320, 340, 0.5)], 1023.0)
    assert len(restarted.tracks) == 1                             # the walker, never seen again, is forgotten


def test_tracker_state_too_old_or_broken_is_ignored(tmp_path):
    t = counter.Tracker(640, 360)
    t.update([box(320, 340, 0.5)], 1000.0)
    fresh = counter.Tracker(640, 360)
    assert fresh.restore(t.state(1000.0), 1000.0 + counter.TRACKER_MAX_AGE_S + 1) == 0 and fresh.tracks == []
    assert fresh.restore(None, 1000.0) == 0
    assert fresh.restore({'t': 1000.0, 'people': [{'id': 1}]}, 1001.0) == 0 and fresh.tracks == []
    assert counter.read_tracker_state(tmp_path / 'missing.json') is None
