"""Pure parts of td/cameras/river_cam.py: URL building, ffmpeg args, frame assembly (no TD, no camera)."""
import importlib.util
import pathlib

import numpy as np
import pytest

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'td' / 'cameras' / 'river_cam.py'


@pytest.fixture
def rc():
    spec = importlib.util.spec_from_file_location('river_cam_under_test', MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SECRETS = {'cameras': {'river': 'rtsp://admin:PASSWORD@192.168.8.217:554/Preview_01_main'}}


def test_stream_url_switches_to_sub_and_back(rc):
    assert rc.stream_url(SECRETS, 'river').endswith('/Preview_01_sub')
    assert rc.stream_url(SECRETS, 'river', 'main').endswith('/Preview_01_main')


def test_ffmpeg_args_decode_to_raw_rgba_over_tcp(rc):
    args = rc.ffmpeg_args('ffmpeg', 'rtsp://x/Preview_01_sub', 640, 360)
    assert args[args.index('-rtsp_transport') + 1] == 'tcp'
    assert args[args.index('-pix_fmt') + 1] == 'rgba'
    assert args[-1] == 'pipe:1' and 'scale=640:360,vflip' in args   # ffmpeg flips for TD


def test_assembler_keeps_only_newest_whole_frame(rc):
    asm = rc.FrameAssembler(2, 2)                    # 16 bytes per frame
    f1, f2 = bytes([1]) * 16, bytes([2]) * 16
    assert asm.feed(f1[:10]) == 0 and asm.latest is None
    assert asm.feed(f1[10:] + f2 + bytes([3]) * 5) == 2
    assert asm.latest == f2 and asm.count == 2 and len(asm.buf) == 5


def test_array_is_a_contiguous_writable_copy(rc):
    asm = rc.FrameAssembler(1, 2)                    # one column, two rows (already flipped by ffmpeg)
    asm.feed(bytes([10, 10, 10, 255, 20, 20, 20, 255]))
    a = asm.array()
    assert a.shape == (2, 1, 4) and a[0, 0, 0] == 10 and a[1, 0, 0] == 20
    assert a.flags['C_CONTIGUOUS'] and a.flags['WRITEABLE']        # a flipped view froze TD


def test_shared_memory_header_round_trips(rc):
    buf = bytearray(rc.shm_size(2, 2))
    assert len(buf) == rc.HEADER.size + 16
    buf[:rc.HEADER.size] = rc.pack_header(42, 1792300000.5)
    assert rc.unpack_header(buf) == (42, 1792300000.5)


def test_shared_memory_name_is_per_camera_and_stream(rc):
    assert rc.shm_name('river', 'sub') != rc.shm_name('gallery', 'sub') != rc.shm_name('river', 'main')
