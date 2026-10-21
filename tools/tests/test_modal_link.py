"""tools/modal/modal_link.py: nothing it logs may carry a camera login."""
import importlib.util
import pathlib

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'modal' / 'modal_link.py'


def load():
    spec = importlib.util.spec_from_file_location('modal_link_under_test', MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_mask_hides_the_login_in_ffmpeg_command_lines():
    m = load()
    line = "ERROR video: Command '['ffmpeg', '-i', 'rtsp://admin:s3cret@192.168.8.217:554/Preview_01_sub']' timed out"
    out = m.mask(line)
    assert 's3cret' not in out and 'admin' not in out and 'rtsp://***@192.168.8.217' in out


def test_mask_leaves_other_lines_alone():
    m = load()
    assert m.mask('river/video -> media/river/video/x.mp4 (550 KB)') == 'river/video -> media/river/video/x.mp4 (550 KB)'


def test_sub_stream():
    assert load().sub_stream('rtsp://cam/Preview_01_main') == 'rtsp://cam/Preview_01_sub'
