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
  assert.equal(r.value.last, '03:58:48 INFO x');         // log lines move with the probe's clock, so their ages hold
  assert.equal(rebase({ last: '23:30:00 INFO y' }, 3_600_000).last, '00:30:00 INFO y');
  assert.equal(rebase({ last: '2026-10-23 02:05:41 done' }, 3_600_000).last, '2026-10-23 03:05:41 done');
  assert.equal(rebase({ last: 'Error ope' }, 3_600_000).last, 'Error ope');
  // the point of it: a scenario served hours after its moment still reads the same (all-good stays OK, a failing camera's clips stay 15 min old)
  const real = new FixtureMission({ dir: new URL('./fixtures/', import.meta.url).pathname, stateDir: mkdtempSync(join(tmpdir(), 'fx-')), now: () => 1_792_749_540_000 + 15 * 3600_000 });
  const { derive } = await import('../public/model.js');
  const later = (name) => derive({ ...real.snapshot(name), now: 1_792_749_540_000 + 15 * 3600_000 }, 1_792_749_540_000 + 15 * 3600_000 + 2000);
  assert.equal(later('all-good').overall.level, 'ok', later('all-good').overall.headline);
  assert.match(later('gallery-cam-down').items.find((x) => x.id === 'modal link').summary, /Gallery clips failing since 17:4\d/);
  const d = mkdtempSync(join(tmpdir(), 'fx-'));
  writeFileSync(join(d, 'all-good.json'), JSON.stringify({ _scenario: { now: 1000 }, status: { modal: { at: 0, value: { set_at: '2026-10-22T23:53:14-07:00' } } } }));
  const fm = new FixtureMission({ dir: d, stateDir: d, now: () => 7_201_000 });
  const s = fm.snapshot();
  assert.equal(s.modal.at, 7_200_000);                   // 1 s before "now", as 0 was 1 s before the fixture's now
  assert.equal(s.modal.age_s, 1);
  assert.equal(s.modal.value.set_at, '2026-10-23T01:53:14-07:00');
});

test('lights: a season-coloured frame for the ropes and panels, black ropes when dark on purpose, nothing without TouchDesigner', async () => {
  const { renderLights } = await import('../lib/fixtures.mjs');
  const dir = fixtureDir();
  const m = fm(dir);
  assert.throws(() => m.lights(), (e) => e.status === 503 && /not checked yet/.test(e.message));     // the smoke fixtures have no probe
  const td = { ok: true, file: 'river-local-oct-22-seasons.toe', fps: 60, ropes: { source: 'canvas' }, seasons: { weights: { winter: 0, spring: 1, summer: 0, autumn: 0 }, intensity: 0.5 } };
  const withTd = (t) => writeFileSync(join(dir, 'all-good.json'), scenario('all-good', { status: { ...STATUS, probe: { at: 1000, value: { td: t } } } }));
  withTd(td);
  const l = m.lights();
  assert.deepEqual([l.at, l.source, l.ropes.w, l.ropes.h, l.panels.w, l.panels.h], [5_000_000, 'canvas', 20, 400, 256, 32]);
  const ropes = Buffer.from(l.ropes.rgb, 'base64'), panels = Buffer.from(l.panels.rgb, 'base64');
  assert.deepEqual([ropes.length, panels.length], [20 * 400 * 3, 256 * 32 * 3]);
  let r = 0, g = 0;
  for (let i = 0; i < ropes.length; i += 3) { r += ropes[i]; g += ropes[i + 1]; }
  assert.ok(g > r, 'spring is green');
  assert.ok(panels.some((x) => x > 0));
  withTd({ ...td, ropes: { source: 'black' } });
  const b = m.lights();
  assert.equal(b.source, 'black');
  assert.ok(Buffer.from(b.ropes.rgb, 'base64').every((x) => x === 0), 'dark ropes get black');
  assert.ok(Buffer.from(b.panels.rgb, 'base64').some((x) => x > 0), 'the panels still show the river');
  withTd({ ok: false, error: 'no answer from the TD bridge' });
  assert.throws(() => m.lights(), (e) => e.status === 503 && /TouchDesigner/.test(e.message));
  writeFileSync(join(dir, 'all-good.json'), scenario('all-good', { status: { bitcube: { at: 1000, value: { online: false } } } }));
  assert.throws(() => m.lights(), (e) => e.status === 503 && /offline/.test(e.message));
  // the water moves: a different moment gives a different frame, the same moment the same one; a slow TD steps
  const a1 = renderLights({ at: 1000, weights: { summer: 1 }, intensity: 0.8 }), a2 = renderLights({ at: 1000, weights: { summer: 1 }, intensity: 0.8 });
  const a3 = renderLights({ at: 4000, weights: { summer: 1 }, intensity: 0.8 }), s1 = renderLights({ at: 1000, look: 'live', fps: 4 }), s2 = renderLights({ at: 1010, look: 'live', fps: 4 });
  assert.equal(a1.ropes.rgb, a2.ropes.rgb);
  assert.notEqual(a1.ropes.rgb, a3.ropes.rgb);
  assert.equal(s1.ropes.rgb, s2.ropes.rgb, 'under 30 fps the frame holds for a quarter second');
  // every real scenario either draws or says why not
  const real = new FixtureMission({ dir: new URL('./fixtures/', import.meta.url).pathname, stateDir: dir, now: () => 1_792_749_540_000 });
  const outcome = {};
  for (const name of real.names()) { try { outcome[name] = real.lights(name).source; } catch (e) { outcome[name] = `503 ${e.message}`; } }
  const want = { 'all-good': 'canvas', 'bitcube-offline': '503 bitcube is offline: no frames', 'gallery-cam-down': 'canvas', 'just-booted': 'canvas',
    'lights-not-connected': 'canvas', 'modal-scene-old': 'canvas', 'no-internet': 'canvas', 'nothing-known-yet': '503 not checked yet: no frames until the full check of bitcube answers',
    'river-cam-stale': 'canvas', 'ropes-dark-on-purpose': 'black', 'seasons-not-running': 'canvas', 'td-frozen': "503 TouchDesigner isn't answering: no frames", 'td-low-fps': 'canvas' };
  for (const [name, w] of Object.entries(want)) if (name in outcome) assert.equal(outcome[name], w, name);
  assert.ok(Object.keys(outcome).length >= 13);
});
