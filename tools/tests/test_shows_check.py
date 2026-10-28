"""tools/shows_check.py: the show registry's rules (docs/shows.md), as tools/check and CI run them."""
import copy
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'tools'))
import shows_check  # noqa: E402

REAL = json.loads((REPO / 'shows.json').read_text(encoding='utf-8'))


def test_the_real_registry_passes():
    assert shows_check.check_registry(REAL) == []


def problems(mutate):
    reg = copy.deepcopy(REAL)
    mutate(reg)
    return shows_check.check_registry(reg)


def test_schema_problems_are_named():
    assert any('kind must be one of' in p for p in problems(lambda r: r['shows'][0].update(kind='film')))
    assert any('offered must be true or false' in p for p in problems(lambda r: r['shows'][0].update(offered='yes')))
    assert any('updated must be YYYY-MM-DD' in p for p in problems(lambda r: r['shows'][0].update(updated='26 Oct')))
    assert any('last_change must be' in p for p in problems(lambda r: r['shows'][0].pop('last_change')))
    assert any('inputs must be a list' in p for p in problems(lambda r: r['shows'][0].update(inputs='cams')))
    assert any('listed twice' in p for p in problems(lambda r: r['shows'].append(copy.deepcopy(r['shows'][0]))))
    assert any('retired' in p for p in problems(lambda r: r['shows'][0].update(file='old-river.toe')))


def test_description_is_at_most_100_words():
    assert any('101 words' in p for p in problems(lambda r: r['shows'][0].update(description=' '.join(['w'] * 101))))
    assert problems(lambda r: r['shows'][0].update(description=' '.join(['w'] * 100))) == []


def test_files_build_scripts_and_pins_must_exist_but_an_unoffered_file_may_be_missing():
    assert any('not in the repo' in p for p in problems(lambda r: r['shows'][0].update(file='river-nope.toe')))
    def unoffered(r):
        r['shows'].append(dict(copy.deepcopy(r['shows'][-1]), file='river-later.toe', offered=False))
    assert problems(unoffered) == []
    assert any('build script td/build/build_nope.py is missing' in p for p in problems(lambda r: r['shows'][0].update(build='td/build/build_nope.py')))
    assert any('calibration.pixelmap tools/pixelmap/pixelmap-1999-01-01.json is missing' in p
               for p in problems(lambda r: r['shows'][0]['calibration'].update(pixelmap='tools/pixelmap/pixelmap-1999-01-01.json')))
    assert problems(lambda r: r['shows'][0]['calibration'].update(screens=None)) == [], 'screens may be null'


def test_zones_pin_is_optional_dated_and_must_exist():
    assert problems(lambda r: r['shows'][0]['calibration'].update(zones=None)) == [], 'zones may be null'
    assert any('calibration.zones must be a dated file' in p
               for p in problems(lambda r: r['shows'][0]['calibration'].update(zones='zones.json')))
    assert any('calibration.zones tools/pixelmap/zones-1999-01-01.json is missing' in p
               for p in problems(lambda r: r['shows'][0]['calibration'].update(zones='tools/pixelmap/zones-1999-01-01.json')))


def test_boot_default_must_be_an_offered_show():
    assert problems(lambda r: r.update(boot_default='river-baseline-template.toe')) == [], 'any offered show may be the default'
    assert any('boot_default' in p for p in problems(lambda r: r['shows'][0].update(offered=False)))
    assert any('boot_default' in p for p in problems(lambda r: r.update(boot_default='nope.toe')))


def test_freshness_a_changed_toe_or_build_needs_new_metadata():
    base = copy.deepcopy(REAL)
    e = base['shows'][1]
    now = copy.deepcopy(REAL)
    # the build script changed, the entry didn't: refused, naming what to update
    out = shows_check.check_freshness(now, base, {e['build']})
    assert len(out) == 1 and e['file'] in out[0] and 'last_change' in out[0]
    # the .toe changed too: still one problem for the entry
    assert len(shows_check.check_freshness(now, base, {e['build'], e['file']})) == 1
    # updated with it: fine
    now['shows'][1].update(last_change='Rain is heavier', updated='2026-10-27', updated_by='will')
    assert shows_check.check_freshness(now, base, {e['build'], e['file']}) == []
    # a date going backwards is refused
    now['shows'][1]['updated'] = '2026-01-01'
    assert 'backwards' in shows_check.check_freshness(now, base, {e['file']})[0]
    # an untouched entry, and a brand-new entry, need nothing
    assert shows_check.check_freshness(REAL, base, {'docs/index.md'}) == []
    assert shows_check.check_freshness(REAL, {'shows': []}, {e['file'], e['build']}) == []


def test_no_base_skips_freshness():
    assert shows_check.changed_paths('0000000000000000000000000000000000000000') is None
    assert shows_check.changed_paths('no-such-ref-anywhere') is None


ALL_LOOKS = 'river-all-looks.toe'


def all_looks(reg):
    return next(s for s in reg['shows'] if s['file'] == ALL_LOOKS)


def looks_problems(mutate):
    """Problems after mutating the all-looks entry's looks object."""
    return problems(lambda r: mutate(all_looks(r)['looks']))


def test_the_all_looks_file_carries_each_looks_standalone_description():
    reg = {s['file']: s for s in REAL['shows']}
    looks = reg[ALL_LOOKS]['looks']
    assert set(looks) == {'remembered', 'fill-simple', 'fill-configurable', 'seasons', 'modal'}
    for name, lk in looks.items():
        own = reg[lk['file']]
        assert (lk['title'], lk['description'], lk['inputs']) == (own['title'], own['description'], own['inputs']), name
    assert {n: lk['for'] for n, lk in looks.items()} == {
        'remembered': 'loops', 'fill-simple': 'cycles', 'fill-configurable': 'cycles', 'seasons': 'minutes', 'modal': 'minutes'}


def test_looks_are_optional_and_good_looks_pass():
    assert problems(lambda r: all_looks(r).pop('looks')) == []
    assert looks_problems(lambda l: l['fill-simple'].update(inputs=[])) == [], 'a look may read nothing'


def test_bad_looks_are_named():
    assert any('looks, if given, is an object' in p for p in looks_problems(lambda l: l.clear()))
    assert any('looks, if given, is an object' in p for p in problems(lambda r: r['shows'][0].update(looks=['remembered'])))
    assert any('lowercase slug' in p for p in looks_problems(lambda l: l.update(Fill_Simple=l.pop('fill-simple'))))
    assert any('looks.modal: not an object' in p for p in looks_problems(lambda l: l.update(modal='modal')))
    for k in ('title', 'description', 'file'):
        assert any(f'looks.remembered: {k} must be a non-empty string' in p
                   for p in looks_problems(lambda l, k=k: l['remembered'].pop(k)))
    assert any('looks.seasons: description is 101 words' in p
               for p in looks_problems(lambda l: l['seasons'].update(description=' '.join(['w'] * 101))))
    assert looks_problems(lambda l: l['seasons'].update(description=' '.join(['w'] * 100))) == []
    assert any('looks.modal: inputs must be a list' in p for p in looks_problems(lambda l: l['modal'].update(inputs='cams')))
    assert any('looks.modal: inputs must be a list' in p for p in looks_problems(lambda l: l['modal'].update(inputs=[''])))
    assert any('file river-nope.toe is not a listed show file' in p
               for p in looks_problems(lambda l: l['remembered'].update(file='river-nope.toe')))
    assert any('looks.remembered: for must be one of loops, cycles, minutes' in p
               for p in looks_problems(lambda l: l['remembered'].update({'for': 'hours'})))
    assert any('for must be one of' in p for p in looks_problems(lambda l: l['remembered'].pop('for')))
