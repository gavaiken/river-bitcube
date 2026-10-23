import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planControl } from '../lib/mission.mjs';
import { FixtureMission } from '../lib/fixtures.mjs';

test('planControl: the whitelist accepts the fixed actions and rejects everything else', () => {
  assert.deepEqual(planControl('mode', { mode: 'manual' }), { kind: 'seasons', path: '/mode', body: { mode: 'manual' } });
  assert.deepEqual(planControl('target', { season: 'summer', intensity: '0.8' }), { kind: 'seasons', path: '/target', body: { season: 'summer', intensity: 0.8 } });
  assert.deepEqual(planControl('rules', { rules: { cycle_seconds: '300' } }), { kind: 'seasons', path: '/rules', body: { cycle_seconds: 300 } });
  assert.deepEqual(planControl('rules-reset', {}), { kind: 'seasons', path: '/rules/reset', body: {} });
  const probes = [['ropes', { dark: true }], ['hub75', { brightness: 0.5 }], ['bootfile', { file: 'river-online-oct-20.toe' }],
                  ['switch', { file: 'river-local-oct-18.toe' }], ['lightsroute', { route: 'router' }]].map(([a, b]) => planControl(a, b));
  assert.ok(probes.every((p) => p.kind === 'probe'));
  assert.deepEqual(probes.map((p) => p.args), ['-Action ropes -Dark', '-Action hub75 -Brightness 0.50', '-Action bootfile -BootFile river-online-oct-20.toe',
                                               '-Action switch -BootFile river-local-oct-18.toe', '-Action lightsroute -LightsRoute router']);
  for (const [a, b] of [['mode', { mode: 'chaos' }], ['target', { season: 'monsoon' }], ['hub75', { brightness: 3 }],
                        ['bootfile', { file: 'evil.toe; rm -rf' }], ['lightsroute', { route: 'both' }], ['rules', { rules: { 'x; y': 1 } }], ['shell', {}],
                        ['ropes', null], ['mode', 'manual']]) {
    assert.throws(() => planControl(a, b), (e) => e.status === 400, a);
  }
});

const STATUS = { bitcube: { at: 1000, value: { online: true }, age_s: 4 }, seasons: { at: 1000, error: 'fetch failed', age_s: 9 } };
function scenario(name, extra = {}) {
  return JSON.stringify({ _scenario: { title: `Title ${name}`, description: `About ${name}` }, status: STATUS,
                          cameras: { gallery: name === 'all-good', river: false }, camera_age_s: { gallery: 30 }, ...extra });
}
function fixtureDir(names = ['bitcube-offline', 'all-good']) {
  const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
  for (const n of names) writeFileSync(join(dir, `${n}.json`), scenario(n));
  writeFileSync(join(dir, 'notes.md'), 'not a scenario');
  writeFileSync(join(dir, 'Bad Name.json'), '{}');           // names are [a-z0-9-]+ only
  return dir;
}
const fm = (dir, now = () => 5_000_000) => new FixtureMission({ dir, stateDir: join(dir, 'state'), now });

test('scenarios: listed alphabetically; the cookie picks one, all-good is the default, else the first', () => {
  const m = fm(fixtureDir());
  assert.deepEqual(m.list(), [{ name: 'all-good', title: 'Title all-good', description: 'About all-good' , expect: null },
                              { name: 'bitcube-offline', title: 'Title bitcube-offline', description: 'About bitcube-offline' , expect: null }]);
  assert.equal(m.active(undefined), 'all-good');
  assert.equal(m.active('bitcube-offline'), 'bitcube-offline');
  for (const bad of ['nope', '../all-good', 'all-good.json', '', 'Bad Name']) assert.equal(m.active(bad), 'all-good', bad);
  assert.equal(fm(fixtureDir(['zz-last', 'river-cam-stale'])).active(undefined), 'river-cam-stale');
  const empty = fm(mkdtempSync(join(tmpdir(), 'fixtures-empty-')));
  assert.equal(empty.active(undefined), null);
  assert.throws(() => empty.snapshot(), (e) => e.status === 503);
  assert.throws(() => new FixtureMission({ dir: '/nowhere/at/all', stateDir: '/tmp' }));
});

test('snapshot: the fixture status plus the scenario name, read again on every call', () => {
  const dir = fixtureDir();
  const m = fm(dir);
  assert.deepEqual(m.snapshot(), { ...STATUS, fixture: 'all-good' });
  assert.deepEqual(m.snapshot('bitcube-offline'), { ...STATUS, fixture: 'bitcube-offline' });
  assert.equal(m.snapshot('nope').fixture, 'all-good');
  // edit the file: no restart needed
  writeFileSync(join(dir, 'all-good.json'), scenario('all-good', { status: { bitcube: { at: 4_990_000, value: { online: false } }, probe: { age_s: 70, error: 'x' }, modal: null } }));
  const s = m.snapshot();
  assert.equal(s.bitcube.value.online, false);
  assert.equal(s.bitcube.age_s, 10);                 // age filled in from `at`
  assert.equal(s.probe.at, 4_930_000);                // `at` filled in from age_s
  assert.equal(s.modal, null);                        // other shapes pass through untouched
  writeFileSync(join(dir, 'all-good.json'), '{ not json');
  assert.throws(() => m.snapshot(), /fixture all-good.json/);
  assert.match(m.list()[0].description, /all-good.json/);   // a broken file is still listed, with the reason
});

test('camera: a placeholder still when the scenario has the camera, nothing (503) when it does not', async () => {
  const dir = fixtureDir();
  const m = fm(dir);
  const g = await m.camera('gallery');
  assert.equal(g.type, 'image/svg+xml');
  assert.match(g.jpeg.toString(), /^<svg [^>]*width="960" height="540"/);
  assert.match(g.jpeg.toString(), /gallery camera: placeholder still/);
  assert.equal(g.at, 5_000_000 - 30_000);                      // camera_age_s
  assert.deepEqual(await m.camera('river'), {});                // cameras.river is false
  assert.deepEqual(await m.camera('gallery', 'bitcube-offline'), {});
  await assert.rejects(m.camera('../etc'), (e) => e.status === 400);
  writeFileSync(join(dir, 'placeholder.jpg'), Buffer.from('any-jpeg'));
  writeFileSync(join(dir, 'all-good.json'), scenario('all-good', { camera_age_s: {} }));
  const p = await m.camera('gallery');
  assert.deepEqual([p.jpeg.toString(), p.type, p.at], ['any-jpeg', 'image/jpeg', 5_000_000 - 20_000]);   // default age 20 s
  writeFileSync(join(dir, 'placeholder-gallery.jpg'), Buffer.from('gallery-jpeg'));
  assert.equal((await m.camera('gallery')).jpeg.toString(), 'gallery-jpeg');
});

test('control: checked exactly like the real one, logged, and never acted on', async (t) => {
  const dir = fixtureDir();
  const m = fm(dir);
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fixture mode must not use the network'); };
  t.after(() => { globalThis.fetch = realFetch; });
  assert.deepEqual(await m.control('mode', { mode: 'manual' }),
                   { ok: true, fixture: true, action: 'mode', body: { mode: 'manual' }, note: 'fixture mode: nothing was changed' });
  await m.control('switch', { file: 'river-online-oct-20.toe' });
  for (const [a, b] of [['mode', { mode: 'chaos' }], ['switch', { file: 'evil.toe' }], ['shell', {}]]) {
    await assert.rejects(m.control(a, b), (e) => e.status === 400, a);
  }
  const log = readFileSync(join(dir, 'state', 'controls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log, [{ t: 5_000_000, action: 'mode', body: { mode: 'manual' } }, { t: 5_000_000, action: 'switch', body: { file: 'river-online-oct-20.toe' } }]);
  // nothing in the module can reach bitcube, Modal or ssh
  const src = readFileSync(new URL('../lib/fixtures.mjs', import.meta.url), 'utf8');
  assert.ok(!/node:(net|child_process|dns|http|https)|fetch\(/.test(src));
});

test('fixture timestamps are moved to the present, so ages never drift', async () => {
  const { rebase } = await import('../lib/fixtures.mjs');
  const r = rebase({ at: 1000, value: { next_tick_epoch: 1_792_738_500, set_at: '2026-10-22T23:53:14-07:00', finished_at: '2026-10-23T06:53:15Z',
                                        history: [{ t: 1_792_747_739, phase: 2 }], fps: 60.2, last: '02:58:48 INFO x' } }, 3_600_000);
  assert.equal(r.at, 3_601_000);
  assert.equal(r.value.next_tick_epoch, 1_792_742_100);
  assert.equal(r.value.set_at, '2026-10-23T00:53:14-07:00');
  assert.equal(r.value.finished_at, '2026-10-23T07:53:15Z');
  assert.equal(r.value.history[0].t, 1_792_751_339);
  assert.equal(r.value.fps, 60.2);                       // numbers that aren't times stay
  assert.equal(r.value.last, '02:58:48 INFO x');         // log lines stay
  const d = mkdtempSync(join(tmpdir(), 'fx-'));
  writeFileSync(join(d, 'all-good.json'), JSON.stringify({ _scenario: { now: 1000 }, status: { modal: { at: 0, value: { set_at: '2026-10-22T23:53:14-07:00' } } } }));
  const fm = new FixtureMission({ dir: d, stateDir: d, now: () => 7_201_000 });
  const s = fm.snapshot();
  assert.equal(s.modal.at, 7_200_000);                   // 1 s before "now", as 0 was 1 s before the fixture's now
  assert.equal(s.modal.age_s, 1);
  assert.equal(s.modal.value.set_at, '2026-10-23T01:53:14-07:00');
});
