"""The show registry's helper (td/build/registry.py) and the pinned calibration: every build reads its show's pin from
shows.json, never the newest dated map (docs/shows.md)."""
import json
import pathlib
import re
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'td' / 'build'))
import registry  # noqa: E402


def make_repo(tmp_path, shows, files=()):
    (tmp_path / 'shows.json').write_text(json.dumps({'boot_default': shows[0]['file'], 'shows': shows}))
    for f in files:
        p = tmp_path / f
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('{}')
    return tmp_path


def show(file='river-x.toe', **kw):
    return {'file': file, 'build': 'td/build/build_x.py',
            'calibration': {'pixelmap': 'tools/pixelmap/pixelmap-2026-01-01.json', 'screens': 'tools/pixelmap/screens-2026-01-01.json'}, **kw}


def test_calibration_for_returns_the_pinned_files_as_absolute_paths(tmp_path):
    repo = make_repo(tmp_path, [show()], ['tools/pixelmap/pixelmap-2026-01-01.json', 'tools/pixelmap/screens-2026-01-01.json',
                                          'tools/pixelmap/pixelmap-2027-01-01.json'])      # a newer map: never picked up
    cal = registry.calibration_for('river-x.toe', repo)
    assert cal['pixelmap'].endswith('/tools/pixelmap/pixelmap-2026-01-01.json') and pathlib.Path(cal['pixelmap']).is_absolute()
    assert cal['screens'].endswith('/tools/pixelmap/screens-2026-01-01.json')
    assert '\\' not in cal['pixelmap']
    # TouchDesigner's project.name, or a path, names the same entry
    assert registry.calibration_for('C:\\Users\\user\\River\\river-bitcube\\river-x.toe', repo) == cal
    assert registry.calibration_for('river-x', repo) == cal


def test_calibration_for_is_clear_when_something_is_missing(tmp_path):
    repo = make_repo(tmp_path, [show()], ['tools/pixelmap/pixelmap-2026-01-01.json'])
    with pytest.raises(registry.RegistryError, match='screens-2026-01-01.json.*missing'):
        registry.calibration_for('river-x.toe', repo)
    with pytest.raises(registry.RegistryError, match='river-y.toe is not in shows.json'):
        registry.calibration_for('river-y.toe', repo)
    repo = make_repo(tmp_path, [show(calibration={'screens': None})])
    with pytest.raises(registry.RegistryError, match='pins no pixelmap'):
        registry.calibration_for('river-x.toe', repo)
    repo = make_repo(tmp_path, [show(calibration={'pixelmap': 'tools/pixelmap/pixelmap-2026-01-01.json', 'screens': None})],
                     ['tools/pixelmap/pixelmap-2026-01-01.json'])
    assert registry.calibration_for('river-x.toe', repo)['screens'] is None, 'screens are optional: the fallback windows'


def test_require_build_refuses_a_file_the_script_does_not_build(tmp_path):
    repo = make_repo(tmp_path, [show()])
    assert registry.require_build('river-x.toe', 'td/build/build_x.py', repo)['file'] == 'river-x.toe'
    with pytest.raises(registry.RegistryError, match="doesn't build river-x.toe"):
        registry.require_build('river-x.toe', 'td/build/build_y.py', repo)


def test_offered(tmp_path):
    repo = make_repo(tmp_path, [show('a.toe', offered=True), show('b.toe', offered=True), show('c.toe', offered=False)])
    assert registry.offered(repo) == ['a.toe', 'b.toe']


def test_every_show_in_the_real_registry_resolves_its_pins():
    for s in registry.load()['shows']:
        cal = registry.calibration_for(s['file'])
        assert pathlib.Path(cal['pixelmap']).is_file(), s['file']


BUILDS = sorted((REPO / 'td' / 'build').glob('build_*.py'))


@pytest.mark.parametrize('path', [p for p in BUILDS if p.name not in ('build_ropes.py', 'build_panels.py')], ids=lambda p: p.name)
def test_show_builds_pin_through_the_registry_never_newest_wins(path):
    src = path.read_text(encoding='utf-8')
    assert not re.search(r'sorted\(\s*glob', src), 'no newest-file-wins'
    assert 'registry.require_build(project.name, ' in src, 'which file it builds comes from shows.json'
    assert 'registry.calibration_for(' in src
    built = re.search(r"registry\.require_build\(project\.name, '([^']+)'\)", src).group(1)
    assert built == f'td/build/{path.name}', 'it names itself'
    assert any(s.get('build') == built for s in registry.load()['shows']), f'{built} is some show\'s build in shows.json'


def test_zones_for_the_pin_or_none(tmp_path):
    files = ['tools/pixelmap/pixelmap-2026-01-01.json', 'tools/pixelmap/screens-2026-01-01.json']
    repo = make_repo(tmp_path, [show()], files + ['tools/pixelmap/zones-2027-01-01.json'])
    assert registry.zones_for('river-x.toe', repo) is None              # no pin: never the newest zones file
    s = show()
    s['calibration']['zones'] = 'tools/pixelmap/zones-2026-01-01.json'
    repo = make_repo(tmp_path, [s], files)
    with pytest.raises(registry.RegistryError, match='missing'):
        registry.zones_for('river-x.toe', repo)
    (tmp_path / 'tools/pixelmap/zones-2026-01-01.json').write_text('{}')
    assert registry.zones_for('river-x.toe', repo).endswith('/tools/pixelmap/zones-2026-01-01.json')


def test_screens_module_takes_the_pin_never_the_newest_screens_file():
    src = (REPO / 'td' / 'build' / 'screens.py').read_text(encoding='utf-8')
    assert 'import glob' not in src and 'glob.glob' not in src
    assert "if 'PINNED_SCREENS' in globals():" in src and "registry.calibration_for(project.name)['screens']" in src


def test_calibrate_never_touches_the_pins():
    """Calibrate writes a new dated map; only a person (or their agent) re-pins a show, in shows.json."""
    for p in [REPO / 'tools' / 'mission' / 'calibrate.py', REPO / 'tools' / 'mission' / 'calibrate.ps1',
              *sorted((REPO / 'tools' / 'pixelmap').glob('*.py'))]:
        assert 'shows.json' not in p.read_text(encoding='utf-8'), p.name
