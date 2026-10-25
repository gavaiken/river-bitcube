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
  const probes = [['ropes', { dark: true }], ['hub75', { brightness: 0.5 }], ['bootfile', { file: 'river-online-oct-23.toe' }],
                  ['switch', { file: 'river-local-oct-22-seasons.toe' }], ['lightsroute', { route: 'router' }], ['rebuild', { file: 'river-local-oct-22-seasons.toe' }]].map(([a, b]) => planControl(a, b));
  assert.ok(probes.every((p) => p.kind === 'probe'));
  assert.deepEqual(probes.map((p) => p.args), ['-Action ropes -Dark', '-Action hub75 -Brightness 0.50', '-Action bootfile -BootFile river-online-oct-23.toe',
                                               '-Action switch -BootFile river-local-oct-22-seasons.toe', '-Action lightsroute -LightsRoute router', '-Action rebuild -BootFile river-local-oct-22-seasons.toe']);
  assert.ok(probes[5].timeout >= 300_000, 'a rebuild builds, saves and restarts: minutes');
  for (const dark of ['no', 1, 'true', {}]) assert.equal(planControl('ropes', { dark }).args, '-Action ropes', `dark: ${JSON.stringify(dark)} is not true`);
  for (const [a, b] of [['mode', { mode: 'chaos' }], ['target', { season: 'monsoon' }], ['hub75', { brightness: 3 }],
                        ['bootfile', { file: 'evil.toe; rm -rf' }], ['bootfile', { file: 'old-river-online-oct-20.toe' }], ['switch', { file: 'river-online-oct-20.toe' }], ['lightsroute', { route: 'both' }], ['rules', { rules: { 'x; y': 1 } }], ['shell', {}],
                        ['ropes', null], ['mode', 'manual'], ['rebuild', { file: 'river-online-oct-23.toe' }], ['rebuild', {}],
                        // a half-filled form or a buggy client gets a 400, never "0" (panels dark, intensity 0)
                        ['hub75', { brightness: null }], ['hub75', { brightness: '' }], ['hub75', { brightness: false }], ['hub75', { brightness: [] }],
                        ['hub75', { brightness: [0.5] }], ['hub75', { brightness: true }], ['hub75', {}], ['target', { intensity: null }], ['target', { intensity: '' }],
                        ['rules', { rules: { cycle_seconds: null } }]]) {
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
  assert.deepEqual(m.snapshot(), { ...STATUS, fixture: 'all-good', now: 5_000_000 });          // no _scenario.now: served on the real clock
  assert.deepEqual(m.snapshot('bitcube-offline'), { ...STATUS, fixture: 'bitcube-offline', now: 5_000_000 });
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
  await m.control('switch', { file: 'river-online-oct-23.toe' });
  for (const [a, b] of [['mode', { mode: 'chaos' }], ['switch', { file: 'evil.toe' }], ['shell', {}]]) {
    await assert.rejects(m.control(a, b), (e) => e.status === 400, a);
  }
  const log = readFileSync(join(dir, 'state', 'controls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log, [{ t: 5_000_000, action: 'mode', body: { mode: 'manual' } }, { t: 5_000_000, action: 'switch', body: { file: 'river-online-oct-23.toe' } }]);
  // nothing in the module can reach bitcube, Modal or ssh
  const src = readFileSync(new URL('../lib/fixtures.mjs', import.meta.url), 'utf8');
  assert.ok(!/node:(net|child_process|dns|http|https)|fetch\(/.test(src));
});

test('fixture timestamps are moved to the present by whole days, so ages never drift and the time of day holds', async () => {
  const { rebase, fixtureClock, DAY_MS } = await import('../lib/fixtures.mjs');
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
  // The clock a scenario is served on: its moment moved forward by whole days (the same Pacific time of day), never ahead of now.
  const T0 = 1_792_749_540_000;                          // 2026-10-23 02:59:00 PDT, every fixture's moment
  assert.equal(fixtureClock(T0, T0 + 15 * 3600_000), T0);                 // later the same day: the fixture's own moment
  assert.equal(fixtureClock(T0, T0 + 40 * 3600_000), T0 + DAY_MS);        // the next day, 02:59 again
  assert.equal(fixtureClock(T0, T0 - 1000), T0 - DAY_MS);                 // before its moment: yesterday's 02:59
  assert.equal(fixtureClock(undefined, 123), 123);                        // a frozen fixture (no _scenario.now) is on the real clock
  const pst = fixtureClock(T0, Date.UTC(2026, 10, 5, 12));               // after the clocks change (1 Nov): still 02:59 Pacific, now PST
  assert.equal(new Date(pst).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false }), '02:59:00');
  // the point of it: a scenario served hours or days after its moment still reads the same (all-good stays OK, a failing camera's
  // clips stay 15 min old, and the agent's overnight rest at 02:59 never turns into "hasn't ticked for 15 h" by day)
  const { derive } = await import('../public/model.js');
  for (const hours of [15, 40, 24 * 7 + 3]) {
    const real = new FixtureMission({ dir: new URL('./fixtures/', import.meta.url).pathname, stateDir: mkdtempSync(join(tmpdir(), 'fx-')), now: () => T0 + hours * 3600_000 });
    const later = (name) => { const snap = real.snapshot(name); return derive(snap, snap.now + 2000); };
    assert.equal(later('all-good').overall.level, 'ok', later('all-good').overall.headline);
    assert.equal(later('lights-not-connected').items.find((x) => x.id === 'modal agent').level, 'ok', `+${hours} h: Dave's agent is resting at 02:59`);
    assert.match(later('gallery-cam-down').items.find((x) => x.id === 'modal link').summary, /Gallery clips failing since 02:4\d/);
    assert.equal(real.snapshot('all-good').bitcube.age_s, 4);             // the ages the scenario wrote (its at is 3.5 s before its moment), any day
  }
  const d = mkdtempSync(join(tmpdir(), 'fx-'));
  writeFileSync(join(d, 'all-good.json'), JSON.stringify({ _scenario: { now: 1000 }, status: { modal: { at: 0, value: { set_at: '2026-10-22T23:53:14-07:00' } } } }));
  const fm = new FixtureMission({ dir: d, stateDir: d, now: () => 1000 + 2 * DAY_MS + 3_600_000 });
  const s = fm.snapshot();
  assert.equal(s.now, 1000 + 2 * DAY_MS);                // the fixture's moment, two days on
  assert.equal(s.modal.at, 2 * DAY_MS);                  // 1 s before "now", as 0 was 1 s before the fixture's now
  assert.equal(s.modal.age_s, 1);
  assert.equal(s.modal.value.set_at, '2026-10-24T23:53:14-07:00');
  assert.equal((await fm.camera('gallery')).jpeg, undefined);   // no cameras in that file
});

test('lights: a season-coloured frame in the real frames shape, black ropes when dark on purpose, nothing without TouchDesigner', async () => {
  const { renderLights } = await import('../lib/fixtures.mjs');
  const { decodeFrames } = await import('../lib/lights.mjs');
  const dir = fixtureDir();
  const m = fm(dir);
  assert.throws(() => m.lights(), (e) => e.status === 503 && /not checked yet/.test(e.message));     // the smoke fixtures have no probe
  const td = { ok: true, file: 'river-local-oct-22-seasons.toe', fps: 60, ropes: { source: 'canvas', status: { watts: [182, 191] } }, hub75: { brightness: 0.8, output: true },
               seasons: { weights: { winter: 0, spring: 1, summer: 0, autumn: 0 }, intensity: 0.5 } };
  const withTd = (t) => writeFileSync(join(dir, 'all-good.json'), scenario('all-good', { status: { ...STATUS, probe: { at: 1000, value: { td: t } } } }));
  withTd(td);
  const l = m.lights();
  // the shape lib/lights.mjs documents (td_mission.py's answer with frames), so a page reads one thing in both modes
  assert.deepEqual([l.ok, l.action, l.file, l.fps, l.synthetic, l.age_s], [true, 'frames', 'river-local-oct-22-seasons.toe', 60, true, 0]);
  const f = l.frames;
  // the Gray Area shape: the atlas stacked (256 × 512 → 64 × 128) and the four screens upright, side by side
  assert.deepEqual([f.at, f.source, f.brightness, f.ropes.w, f.ropes.h, f.panels.w, f.panels.h, f.screens.w, f.screens.h], [5000, 'canvas', 0.8, 20, 400, 64, 128, 128, 64]);
  assert.deepEqual([f.ropes.source, f.ropes.brightness, f.ropes.watts, f.panels.source, f.panels.brightness, f.panels.output, f.panels.atlas],
                   ['canvas', 0.4, [182, 191], 'canvas', 0.8, true, [256, 512]]);
  const dec = decodeFrames(l);
  assert.ok(!dec.ropes.error && !dec.panels.error && !dec.screens.error, 'decodes like the real payload');
  const ropes = Buffer.from(f.ropes.rgb, 'base64'), panels = Buffer.from(f.panels.rgb, 'base64');
  assert.deepEqual([ropes.length, panels.length], [20 * 400 * 3, 64 * 128 * 3]);
  const { uprightsFromAtlas } = await import('../public/screens.js');
  assert.deepEqual(Buffer.from(uprightsFromAtlas(panels, 64, 128).bytes), Buffer.from(f.screens.rgb, 'base64'), 'the atlas undone is the upright screens');
  let r = 0, g = 0;
  for (let i = 0; i < ropes.length; i += 3) { r += ropes[i]; g += ropes[i + 1]; }
  assert.ok(g > r, 'spring is green');
  assert.ok(panels.some((x) => x > 0));
  withTd({ ...td, ropes: { source: 'black' } });
  const b = m.lights().frames;
  assert.deepEqual([b.source, b.ropes.source], ['black', 'black']);
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
  for (const name of real.names()) { try { outcome[name] = real.lights(name).frames.source; } catch (e) { outcome[name] = `503 ${e.message}`; } }
  const want = { 'all-good': 'canvas', 'bitcube-offline': '503 bitcube is offline: no frames', 'gallery-cam-down': 'canvas', 'just-booted': 'canvas',
    'lights-not-connected': 'canvas', 'modal-scene-old': 'canvas', 'no-internet': 'canvas', 'nothing-known-yet': '503 not checked yet: no frames until the full check of bitcube answers',
    'river-cam-stale': 'canvas', 'ropes-dark-on-purpose': 'black', 'seasons-not-running': 'canvas', 'td-frozen': "503 TouchDesigner isn't answering: no frames", 'td-low-fps': 'canvas' };
  for (const [name, w] of Object.entries(want)) if (name in outcome) assert.equal(outcome[name], w, name);
  assert.ok(Object.keys(outcome).length >= 13);
});

test('the scripted calibration: the progress file\'s shape and stages, cancel, the drift and decode failures, the probe mirror', async () => {
  const { FixtureCalibration, DRIFT_ERROR, DECODE_ERROR, DECODE_REASON, mapResult } = await import('../lib/fixtures.mjs');
  const { readLocalPixelmap } = await import('../lib/lights.mjs');
  const dir = new URL('../../tools/pixelmap/', import.meta.url).pathname;
  const map = readLocalPixelmap(dir);
  assert.equal(map.file, 'pixelmap-2026-10-23.json');
  // a hand-driven clock and timers: no waiting
  let t = 1_792_749_540_000, timers = [];
  const setTimer = (fn, ms) => { const h = { fn, at: t + ms, unref() {} }; timers.push(h); return h; };
  const clearTimer = (h) => { timers = timers.filter((x) => x !== h); };
  const advance = (ms) => { t += ms; while (timers.length && timers[0].at <= t) { const h = timers.shift(); h.fn(); } };
  const run = (opts) => new FixtureCalibration({ now: () => t, durationS: 60, map: () => map, setTimer, clearTimer, ...opts });
  const c = run();
  assert.deepEqual(c.status(), { running: false, none: true });
  assert.equal(c.probeView(), null);
  const started = c.start({ outcome: 'ok' });
  assert.deepEqual([started.ok, started.started, typeof started.pid, started.calibration.running, started.calibration.stage, started.calibration.mode], [true, true, 'number', true, null, 'full']);
  assert.deepEqual(Object.keys(started.calibration).sort(), ['alive', 'before', 'brightness_cap', 'cam', 'cancelled', 'capture', 'capture_info', 'decode_only', 'dry_run', 'elapsed_s', 'error', 'expected_s',
    'hub75_capture', 'log', 'max_drift', 'message', 'mode', 'of', 'ok', 'pass', 'pid', 'reason', 'restored', 'result', 'retakes', 'running', 'stage', 'stage_index', 'stages', 'started', 'step', 'updated']);
  assert.deepEqual(c.start(), { ok: false, error: 'a calibration is already running', calibration: c.status() });
  const seen = [];
  for (let i = 0; i < 700; i++) { advance(100); const p = c.status(); seen.push([p.stage, p.step, p.of, p.pass, p.retakes, p.message]); if (!p.running) break; }
  const final = c.status();
  assert.deepEqual([final.running, final.ok, final.stage, final.cancelled, final.error, final.restored, final.alive], [false, true, 'done', false, null, true, false]);
  assert.ok(final.elapsed_s >= 55 && final.elapsed_s <= 65, `about a minute: ${final.elapsed_s}`);
  const stages = [...new Set(seen.map((x) => x[0]).filter(Boolean))];
  assert.deepEqual(stages, ['ropes-capture', 'ropes-decode', 'hub75-capture', 'hub75-locate', 'done']);
  const cap = seen.filter((x) => x[0] === 'ropes-capture');
  assert.ok(cap.some((x) => x[3] === 'A' && x[1] === 12 && x[2] === 29 && /^pass A: pattern 12 of 29/.test(x[5])), 'pass A pattern 12 of 29');
  assert.ok(cap.some((x) => x[3] === 'B' && x[1] === 29), 'pass B reaches 29');
  assert.equal(cap.at(-1)[4], 1, 'one retake');
  assert.ok(seen.some((x) => x[0] === 'ropes-decode' && x[1] === 20 && x[2] === 20), 'all 20 ropes decoded');
  assert.ok(seen.some((x) => x[0] === 'ropes-decode' && /^rope  3: visible/.test(x[5])));
  assert.deepEqual(final.result, mapResult(map));
  assert.deepEqual([final.result.map, final.result.points, final.result.hub75_quads, final.result.camera, final.result.frame_size, final.result.drift_px],
                   ['pixelmap-2026-10-23.json', 8000, ['hub75_quad1'], 'gallery', [1440, 808], 10.23]);
  assert.deepEqual(final.before, { Active: true, Source: 'canvas', Brightness: 0.4, Graybit: 0, Grayinvert: false, Panels: 'canvas', Maxbrightness: 0.4 });
  assert.match(final.capture, /^pixelmap-\d{8}-\d{6}$/); assert.match(final.hub75_capture, /^hub75-\d{8}-\d{6}$/);
  assert.ok(final.log.length > 5 && final.log.length <= 40 && final.log.some((l) => l.startsWith('$ ')));
  assert.deepEqual(c.probeView(), { ...final });                  // the probe carries it for 24 h
  advance(25 * 3600_000); assert.equal(c.probeView(), null);
  // cancel: stopped, restored, no map
  const c2 = run(); c2.start(); advance(10_000);
  assert.equal(c2.status().stage, 'ropes-capture');
  const cancelled = c2.cancel();
  assert.deepEqual([cancelled.ok, cancelled.cancelled, cancelled.forced], [true, true, false]);
  assert.deepEqual([c2.status().running, c2.status().cancelled, c2.status().error, c2.status().restored, c2.status().result], [false, true, 'cancelled', true, null]);
  assert.deepEqual(c2.cancel().cancelled, false);
  advance(120_000); assert.equal(c2.status().running, false);      // nothing wakes up afterwards
  // the failures
  const c3 = run(); c3.start({ outcome: 'drift' }); advance(120_000);
  assert.deepEqual([c3.status().running, c3.status().ok, c3.status().stage, c3.status().error, c3.status().result, c3.status().restored], [false, false, 'ropes-capture', DRIFT_ERROR, null, true]);
  assert.equal(c3.status().capture_info.drift, 48.3);
  const c4 = run(); c4.start({ outcome: 'decode' }); advance(120_000);
  assert.deepEqual([c4.status().ok, c4.status().stage, c4.status().error, c4.status().step], [false, 'ropes-decode', DECODE_ERROR, 6]);
  assert.equal(c4.status().reason, DECODE_REASON, 'the raw text stays in error; the page shows the reason');
  assert.ok(!/exit|Traceback|\.py|ropes-decode/.test(c4.status().reason));
  // a dry run has no lights to restore and flags its result
  const c5 = run(); c5.start({ dry_run: true }); advance(120_000);
  assert.deepEqual([c5.status().mode, c5.status().before, c5.status().restored, c5.status().result.dry_run], ['dry-run', null, null, true]);
  // FixtureMission: the scenario decides whether a run may start; the probe mirrors it
  const fm = new FixtureMission({ dir: new URL('./fixtures/', import.meta.url).pathname, stateDir: mkdtempSync(join(tmpdir(), 'fx-')), pixelmapDir: dir, now: () => t });
  assert.equal((await fm.calibrate('start', {}, { scenario: 'bitcube-offline' })).error, "bitcube is offline: calibration can't start");
  assert.equal((await fm.calibrate('start', {}, { scenario: 'td-frozen' })).error, "TouchDesigner isn't answering: calibration can't start");
  assert.equal((await fm.calibrate('start', {}, { scenario: 'gallery-cam-down' })).error, "The gallery camera isn't reachable: calibration can't start");
  assert.equal((await fm.calibrate('start', {}, { scenario: 'nothing-known-yet' })).error, "bitcube hasn't been checked yet: calibration can't start");
  assert.equal(fm.snapshot('all-good').probe.value.calibration, undefined);
  const s = await fm.calibrate('start', { dry_run: false }, { scenario: 'all-good' });
  assert.equal(s.ok, true);
  assert.equal(fm.snapshot('all-good').probe.value.calibration.running, true);
  assert.equal(fm.snapshot('td-low-fps').probe.value.calibration, undefined);       // each scenario is its own world: its own job
  assert.equal(fm.snapshot('bitcube-offline').probe.value, undefined);              // and never behind an offline bitcube
  assert.equal(fm.calibration('all-good').running, true);
  assert.deepEqual(fm.calibration('td-low-fps'), { running: false, none: true });
  // while the scenario's run is on, its controls answer 409 as the live server's do (a rebuild restarts TouchDesigner too)
  for (const [action, body] of [['ropes', { dark: true }], ['switch', { file: 'river-local-oct-22-seasons.toe' }], ['rebuild', { file: 'river-local-oct-22-seasons.toe' }]]) {
    await assert.rejects(fm.control(action, body, 'all-good'), (e) => e.status === 409 && /calibration is running/.test(e.message), action);
  }
  assert.equal((await fm.control('rebuild', { file: 'river-local-oct-22-seasons.toe' }, 'td-low-fps')).ok, true, 'another scenario is another world');
  assert.equal((await fm.calibrate('cancel', {}, { scenario: 'all-good' })).cancelled, true);
  assert.equal((await fm.control('rebuild', { file: 'river-local-oct-22-seasons.toe' }, 'all-good')).ok, true, 'a stopped run blocks nothing');
  await assert.rejects(fm.calibrate('explode', {}, { scenario: 'all-good' }), (e) => e.status === 400);
  fm.stop();
});

test('a running calibration shows on the band as Attention: "Calibrating the lights" (the probe mirrors the scripted run)', async () => {
  const { derive } = await import('../public/model.js');
  const dir = new URL('../../tools/pixelmap/', import.meta.url).pathname;
  let t = 1_792_749_540_000;
  const fm = new FixtureMission({ dir: new URL('./fixtures/', import.meta.url).pathname, stateDir: mkdtempSync(join(tmpdir(), 'fx-')), pixelmapDir: dir, now: () => t });
  const before = derive(fm.snapshot('all-good'), t + 2000);
  assert.equal(before.overall.level, 'ok');
  await fm.calibrate('start', {}, { scenario: 'all-good' });
  const cp = fm.calibFor('all-good').p; cp.stage = 'ropes-capture'; cp.expected_s = 40; cp.elapsed_s = 10;      // as the run would be 10 s in (60 s scripted)
  const during = derive(fm.snapshot('all-good'), t + 2000);
  assert.deepEqual([during.overall.level, during.overall.cause], ['warning', 'calibrating']);
  assert.match(during.overall.headline, /^Calibrating the lights: the ropes are in patterns for about .+ more$/);
  assert.match(during.overall.detail, /photographing the ropes/);
  assert.ok(during.problems.find((p) => p.id === 'calibrating').items.includes('ropes'));
  assert.ok(!/fps|probe|ssh|json/i.test(during.overall.headline + during.overall.detail + during.overall.action));
  await fm.calibrate('cancel', {}, { scenario: 'all-good' });
  assert.equal(derive(fm.snapshot('all-good'), t + 2000).overall.level, 'ok', 'a finished run is no longer news');
  fm.stop();
});
