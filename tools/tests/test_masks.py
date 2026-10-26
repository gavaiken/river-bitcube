"""Every copy of the camera-login mask on bitcube masks up to the authority's LAST @ (as mission/lib/scrub.mjs and
calibrate.py do): ffmpeg takes the last @ too, so an @ or a quote in a camera password is all login. A mask that stopped
at the first @ left the password's tail in record.log, modal-*.log and a hand-run capture.py (review round 5, finding 46).
"""
import importlib.util
import pathlib
import re

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1]
PROBE = TOOLS / 'mission' / 'probe.ps1'


def load(rel, name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def masks():
    out = {'record.py': load('cameras/record.py', 'record_under_test').mask,
           'modal_link.py': load('modal/modal_link.py', 'modal_link_masks_under_test').mask,
           'calibrate.py': load('mission/calibrate.py', 'calibrate_masks_under_test').scrub}
    try:
        out['capture.py'] = load('pixelmap/capture.py', 'capture_under_test').scrub
    except ImportError as e:            # capture.py needs numpy (and its camera libraries); the venv on bitcube has them
        pytest.skip(f'capture.py needs {e.name}')
    return out


CASES = [
    ('rtsp://admin:p@ss@10.0.0.1/x', 'rtsp://***@10.0.0.1/x'),
    ("rtsp://admin:ab'cd@10.0.0.1:554/x", 'rtsp://***@10.0.0.1:554/x'),
    ('Error opening input rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_main.', 'Error opening input rtsp://***@192.168.9.76:554/Preview_01_main.'),
    ("['ffmpeg', '-i', 'rtsp://admin:s3cret@192.168.8.217:554/Preview_01_sub']", "['ffmpeg', '-i', 'rtsp://***@192.168.8.217:554/Preview_01_sub']"),
    ('rtsp://admin:pw@10.0.0.1?x=a@b', 'rtsp://***@10.0.0.1?x=a@b'),
    ('see https://example.org/a@b and me@y', 'see https://example.org/a@b and me@y'),
    ('river/video -> media/river/video/x.mp4 (550 KB)', 'river/video -> media/river/video/x.mp4 (550 KB)'),
]


@pytest.mark.parametrize('line,want', CASES)
def test_every_mask_hides_the_whole_login(line, want):
    for name, mask in masks().items():
        got = mask(line)
        assert got == want, f'{name}: {line!r} -> {got!r}'
        assert 'NOT-A-REAL-PW' not in got and 's3cret' not in got and 'ss@10' not in got, name


def test_probe_masks_log_lines_before_it_cuts_them():
    """probe.ps1 cuts the Modal link's and the recorder's last log line to 120 characters: cut first, and a cut between the
    two @ of a login leaves a tail mission control can no longer recognise as one. It masks first (the same pattern)."""
    src = PROBE.read_text(encoding='utf-8')
    assert re.search(r"function Mask-Creds", src), 'probe.ps1 has a mask'
    assert "[^\\s/?#\"<>]*@" in src, 'the same pattern as scrub.mjs: up to the last @ of the authority'
    for field in ('$link[$cam]', '$out.recorder'):
        block = src[src.index(field):src.index(field) + 400]
        cut = block.index('Substring(0')
        assert 'Mask-Creds' in block[:cut], f'{field}: masked before the cut'


def test_probe_reports_the_boot_file_start_river_would_open():
    """boot_file is the show file Start-River.cmd opens, never 'Start-River.cmd default' (review round 5, finding 19):
    boot-file.txt's file when it exists, else the same files in the same order as the launcher's fallbacks."""
    src = PROBE.read_text(encoding='utf-8')
    cmd = (TOOLS.parent / 'Start-River.cmd').read_text(encoding='utf-8')
    assert 'Start-River.cmd default' not in src
    default = re.search(r'^set "TOE=%~dp0([\w.-]+\.toe)"', cmd, re.M).group(1)
    overrides = re.findall(r'^if exist "%~dp0([\w.-]+\.toe)" set "TOE=%~dp0\1"', cmd, re.M)
    launcher = list(reversed(overrides)) + [default]          # a later line overrides an earlier one: the last that exists wins
    probe = re.search(r"if \(-not \$boot\) \{ \$boot = @\(([^)]*)\)", src).group(1)
    assert re.findall(r"'([\w.-]+\.toe)'", probe) == launcher, (probe, launcher)
    assert 'boot-file.txt' in cmd and re.search(r"Join-Path \$river 'boot-file.txt'", src), 'both read River\\boot-file.txt'
    assert '$out.boot_file_chosen' in src
