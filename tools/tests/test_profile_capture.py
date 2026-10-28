"""Diagnostics must preserve callbacks and restore only wrappers they still own."""
import csv
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import pytest

P = Path(__file__).resolve().parents[2] / 'tools/remembered/profile_capture.py'
spec = importlib.util.spec_from_file_location('river_profile_tests', P)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


def test_sections_return_and_exceptions_are_preserved_and_restore(tmp_path):
    def add(n):
        return n+1
    def fail():
        raise ValueError('original')
    obj=SimpleNamespace(add=add, fail=fail)
    c=M.Capture(tmp_path/'capture',30)
    c.patch_section(obj,'add','field_step')
    c.patch_section(obj,'fail','show_tick')
    assert obj.add(2)==3
    with pytest.raises(ValueError,match='original'):
        obj.fail()
    assert c.acc['field_step']>=0 and c.acc['show_tick']>=0
    c.stop();c.writer.join(timeout=2)
    assert obj.add is add and obj.fail is fail
    assert not c.writer.is_alive()


def test_full_frame_records_slow_interval_and_expires_without_skipping_original(tmp_path):
    calls=[]
    def frame(n):
        calls.append(n)
        return n*2
    obj=SimpleNamespace(frame=frame)
    c=M.Capture(tmp_path/'capture',30)
    c.patch_frame(obj,lambda:{'look':'remembered'},lambda:{})
    assert obj.frame(1)==2
    c.previous-=.15
    assert obj.frame(2)==4
    c.start-=31
    assert obj.frame(3)==6 and obj.frame is frame
    c.writer.join(timeout=2)
    with (c.out/'events.csv').open() as f:
        rows=list(csv.DictReader(f))
    assert len(rows)==2 and float(rows[1]['interval_ms'])>=150
    assert calls==[1,2,3]


def test_stop_does_not_overwrite_someone_elses_later_patch(tmp_path):
    obj=SimpleNamespace(f=lambda:1)
    c=M.Capture(tmp_path/'capture',30)
    c.patch_section(obj,'f','show_tick')
    later=lambda:7
    obj.f=later
    c.stop();c.writer.join(timeout=2)
    assert obj.f is later
