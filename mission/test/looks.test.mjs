// The river (all looks) (river-looks.toe, docs/mission-ui.md "Looks") and the remembered river's video under the particles (M9): the
// whitelist, the server's and fixture mode's refusals (one rule: model.js showBoundWhy), the model's controls and show.looks, the
// card's view (public/looks.js), the Remembered river page's answer while the looks show runs, the studio agent, the route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planControl, checkedControl, calBlocked, testBlocked, CAL_BLOCKED, Mission } from '../lib/mission.mjs';
import { FixtureMission } from '../lib/fixtures.mjs';
import { actionPhrase } from '../lib/history.mjs';
import { shapeRemembered } from '../lib/remembered.mjs';
import { APPLY_BLOCKS, EXPECT_S, changeLabel, derive, showBoundWhy, LOOKS_FILE, LOOKS, LOOKS_ONLY, LOOK_UNKNOWN, REMEMBERED_LOOK_ONLY, FILLING_LOOK_ONLY,
  REMEMBERED_ONLY, FILLING_ONLY, FILLING_FILE, REMEMBERED_FILE } from '../public/model.js';
import { looksView, nowWords, askedIs, LOOK_MODES, LOOK_WORDS, DEFAULT_PLAYLIST, playlistProblem, checkPlaylist, positionWords, entryWords, unitFor } from '../public/looks.js';
import { playlistArg } from '../lib/mission.mjs';
import { rememberedView } from '../public/remembered-words.js';
import { ACTIONS } from '../bin/mc.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
const run = (f) => derive({ ...f.status, now: f._scenario.now }, f._scenario.now + 2000);
const fixtureMission = () => new FixtureMission({ dir: FIXTURES, stateDir: mkdtempSync(join(tmpdir(), 'looks-')), applyS: 0 });

test('looks: auto or manual with a listed look; remembered-screens: video 0 to 1; nothing else reaches the probe', () => {
  assert.deepEqual([LOOKS, LOOK_MODES], [['remembered', 'fill-simple', 'fill-configurable', 'seasons', 'modal'], ['auto', 'manual']]);
  assert.deepEqual(planControl('looks', { mode: 'auto' }), { kind: 'probe', args: '-Action looks -Mode auto' });
  assert.deepEqual(planControl('looks', { mode: 'manual', look: 'fill-simple' }), { kind: 'probe', args: '-Action looks -Mode manual -Look fill-simple' });
  assert.equal(planControl('looks', { mode: 'auto', look: 'remembered' }).args, '-Action looks -Mode auto -Look remembered');
  for (const mode of [undefined, null, '', 'Auto', 'auto; whoami', ['auto'], true]) assert.throws(() => planControl('looks', { mode }), /mode is auto or manual/);
  assert.throws(() => planControl('looks', { mode: 'manual' }), /manual needs a look/);
  for (const look of [null, '', 'fill', 'remembered -Mode auto', ['fill-simple'], 1]) assert.throws(() => planControl('looks', { mode: 'manual', look }), /look is/);
  assert.deepEqual(checkedControl('looks', { mode: 'manual', look: 'fill-configurable', file: 'x', extra: 1 }), { mode: 'manual', look: 'fill-configurable' });
  assert.deepEqual(checkedControl('looks', { mode: 'auto' }), { mode: 'auto' });
  assert.deepEqual(planControl('remembered-screens', { video: 0.25 }), { kind: 'remembered', args: '-Action remembered-screens -Video 0.25' });
  assert.equal(planControl('remembered-screens', { video: '1' }).args, '-Action remembered-screens -Video 1.00');
  for (const video of [undefined, null, '', true, [], -0.01, 1.01, NaN, '0.5; whoami']) assert.throws(() => planControl('remembered-screens', { video }), /video is 0 to 1/, String(video));
  assert.deepEqual(checkedControl('remembered-screens', { video: 0.333, light: 'pool' }), { video: 0.33 });
});

test('locked like the filling dials: a calibration, the test pattern, a switch; their own copies; words for every page', () => {
  assert.ok(CAL_BLOCKED.includes('looks'), 'probe.ps1 refuses it during a calibration too (tools/tests/test_mission_guards.py)');
  for (const a of ['looks', 'remembered-screens']) {
    assert.equal(calBlocked(a, { running: true }).status, 409, a);
    assert.equal(testBlocked(a, {}, { value: { td: { ok: true, ropes: { source: 'test' } } } }).status, 409, a);
    for (const b of ['switch', 'rebuild', 'calibrate']) assert.ok(APPLY_BLOCKS[b].includes(a), `${b} blocks ${a}`);
    assert.deepEqual(APPLY_BLOCKS[a], [a]);
    assert.equal(EXPECT_S[a], 10);
    assert.ok(ACTIONS.includes(a), `the studio agent has ${a} (bin/mc.mjs)`);
  }
  assert.equal(changeLabel('looks', { mode: 'auto' }), 'the change of the looks to Auto');
  assert.equal(changeLabel('looks', { mode: 'manual', look: 'fill-simple' }), 'the change of the looks to Fill my cup (simple) (manual)');
  assert.equal(changeLabel('looks', {}), 'the change of the looks');
  assert.equal(changeLabel('remembered-screens', { video: 0.25 }), 'the change of the river video under the particles to 25 %');
  assert.deepEqual(actionPhrase({ action: 'looks', body: { mode: 'manual', look: 'remembered' } }), ['Set', 'set', 'the looks to the remembered river (manual)']);
  assert.deepEqual(actionPhrase({ action: 'remembered-screens', body: { video: 0.4 } }), ['Set', 'set', 'the river video under the particles to 40 %']);
  assert.equal(LOOK_WORDS['fill-configurable'], 'Fill my cup (configurable)');
});

test('one rule for the show-bound controls: their show, or in river-looks.toe their look; not known says so', () => {
  const pr = (file, look, age = 0.3) => ({ td: { ok: true, file }, ...(look !== undefined ? { looks: { status: { age_s: age, json: { show: LOOKS_FILE, look } } } } : {}) });
  assert.equal(showBoundWhy('looks', pr(LOOKS_FILE, 'remembered')), null);
  assert.equal(showBoundWhy('looks', pr(REMEMBERED_FILE)), LOOKS_ONLY);
  assert.equal(showBoundWhy('looks', null), LOOKS_ONLY);
  for (const a of ['remembered-zones', 'remembered-opening', 'remembered-screens']) {
    assert.equal(showBoundWhy(a, pr(REMEMBERED_FILE)), null, a);
    assert.equal(showBoundWhy(a, pr(LOOKS_FILE, 'remembered')), null, a);
    assert.equal(showBoundWhy(a, pr(LOOKS_FILE, 'fill-simple')), REMEMBERED_LOOK_ONLY, a);
    assert.equal(showBoundWhy(a, pr(LOOKS_FILE, 'remembered', 30)), LOOK_UNKNOWN, `${a}: an old report says nothing about now`);
    assert.equal(showBoundWhy(a, pr(LOOKS_FILE)), LOOK_UNKNOWN, a);
    assert.equal(showBoundWhy(a, pr(FILLING_FILE)), REMEMBERED_ONLY, a);
  }
  assert.equal(showBoundWhy('filling', pr(FILLING_FILE)), null);
  for (const l of ['fill-simple', 'fill-configurable']) assert.equal(showBoundWhy('filling', pr(LOOKS_FILE, l)), null, l);
  assert.equal(showBoundWhy('filling', pr(LOOKS_FILE, 'remembered')), FILLING_LOOK_ONLY);
  assert.equal(showBoundWhy('filling', pr(REMEMBERED_FILE)), FILLING_ONLY);
  assert.equal(showBoundWhy('ropes', null), null, 'other controls are not bound to a show');
});

test('the model: the Looks card and the look\'s own controls follow the look showing', () => {
  const auto = run(fx('looks-auto')), fill = run(fx('looks-manual-fill')), fading = run(fx('looks-fading'));
  for (const m of [auto, fill, fading]) {
    assert.equal(m.overall.level, 'ok', m.overall.headline);
    assert.equal(m.show.file.name, LOOKS_FILE);
    assert.equal(m.controls.looks.possible, true);
    assert.ok(m.show.looks?.status, 'the full check\'s files reach the page');
  }
  assert.deepEqual([auto.show.look, auto.controls['remembered-zones'].possible, auto.controls['remembered-screens'].possible, auto.controls.filling.why, auto.show.filling],
    ['remembered', true, true, FILLING_LOOK_ONLY, null]);
  assert.deepEqual([fill.show.look, fill.controls.filling.possible, fill.controls['remembered-opening'].why], ['fill-configurable', true, REMEMBERED_LOOK_ONLY]);
  assert.ok(fill.show.filling?.status, 'a fill look: the filling dials card');
  assert.equal(fading.show.look, 'remembered', 'during a fade the look showing is the one fading out');
  const other = run(fx('remembered-calm'));
  assert.deepEqual([other.show.looks, other.show.look, other.controls.looks.why, other.controls['remembered-screens'].possible], [null, null, LOOKS_ONLY, true]);
});

test('the card\'s view: Now in words, what was asked, where the choice starts', () => {
  const m = run(fx('looks-auto')), v = looksView(m.show.looks, m.show.fresh.probe_age_s);
  assert.equal(v.now.words, 'Showing the remembered river · auto: loop 2 of 4, then Fill my cup (simple)');
  assert.deepEqual([v.now.age_s, v.now.old, v.asked.mode, v.base.mode, v.base.look], [20, false, 'auto', 'auto', 'remembered']);
  assert.equal(askedIs(v, { mode: 'auto' }), true);
  assert.equal(askedIs(v, { mode: 'manual', look: 'remembered' }), false);
  const f = run(fx('looks-fading')), fv = looksView(f.show.looks, 0);
  assert.equal(fv.now.words, 'Fading to Fill my cup (simple)');
  assert.deepEqual([fv.now.fading, fv.now.fade, fv.base.mode, fv.base.look], ['out', 0.4, 'manual', 'fill-simple']);
  const mf = looksView(run(fx('looks-manual-fill')).show.looks, 0);
  assert.equal(mf.now.words, 'Showing Fill my cup (configurable) · manual: it stays on it');
  assert.equal(nowWords({ mode: 'auto', look: 'fill-simple', next: 'remembered', loops: 4 }), 'Showing Fill my cup (simple) · auto: one full cycle, then the remembered river');
  const stopped = looksView({ ...m.show.looks, status: { ...m.show.looks.status, age_s: 11 } }, 0);
  assert.equal(stopped.now.old, true);
  const odd = looksView({ control: { missing: true }, status: { age_s: 1, json: { mode: 'sideways', look: 'disco', auto: { remembered_loops: 9 } } } }, 0);
  assert.deepEqual([odd.asked, odd.now.mode, odd.now.look, odd.now.loops, odd.base], [null, null, null, 4, { mode: 'auto', look: 'remembered' }]);
  assert.match(odd.problems[0], /looks file isn't there yet/);
  assert.equal(looksView(null), null);
});

test('fixture mode: refused while another show runs or another look shows; taken into the world while it runs', async () => {
  const fm = fixtureMission();
  await assert.rejects(fm.control('looks', { mode: 'auto' }, 'remembered-calm'), (e) => e.status === 409 && e.message === LOOKS_ONLY);
  await assert.rejects(fm.control('remembered-zones', { light: 'pool' }, 'looks-manual-fill'), (e) => e.status === 409 && e.message === REMEMBERED_LOOK_ONLY);
  await assert.rejects(fm.control('filling', { palette: 'teal', brightness: 0.5, intensity: 0.5, speed: 1 }, 'looks-auto'), (e) => e.status === 409 && e.message === FILLING_LOOK_ONLY);
  const r = await fm.control('looks', { mode: 'manual', look: 'fill-simple' }, 'looks-auto');
  assert.deepEqual([r.ok, r.written.mode, r.written.look], [true, 'manual', 'fill-simple']);
  const s = fm.snapshot('looks-auto'), m = derive(s, s.now);
  assert.deepEqual([m.show.look, m.controls.filling.possible, m.controls['remembered-zones'].why], ['fill-simple', true, REMEMBERED_LOOK_ONLY]);
  // the remembered river's three controls while its look shows, and the video under the particles taken into control.json
  const fm2 = fixtureMission();
  assert.equal((await fm2.control('remembered-screens', { video: 0.4 }, 'looks-auto')).written.screens.video, 0.4);
  const raw = fm2.remembered('looks-auto');
  assert.deepEqual([raw.control.json.screens.video, raw.control.json.pool_height_m, raw.status.json.screens.video], [0.4, 0.6, 0.4]);
});

test('the Remembered river page: running while river-looks.toe shows the remembered river, and says so when it doesn\'t', () => {
  const fm = fixtureMission(), now = fm.clock('looks-auto');
  const on = shapeRemembered(fm.remembered('looks-auto'), { tdFile: LOOKS_FILE, readAt: now, now });
  assert.deepEqual([on.running, on.show, on.look.look], [true, LOOKS_FILE, 'remembered']);
  const v = rememberedView(on, { now });
  assert.deepEqual([v.running, v.inLooks, v.video.now, v.video.asked], [true, true, 0.25, 0.25]);
  // the remembered look writing its status under its own name changes nothing: only the look counts while the looks show reports
  const raw = fm.remembered('looks-fading');
  raw.looks.json = { ...raw.looks.json, look: 'fill-simple', target: 'fill-simple', fading: null };
  raw.status.json.show = REMEMBERED_FILE;
  const off = shapeRemembered(raw, { tdFile: LOOKS_FILE, readAt: now, now });
  assert.deepEqual([off.running, off.show], [false, LOOKS_FILE]);
  assert.match(rememberedView(off, { now }).notRunning, /^TouchDesigner is showing the river \(all looks\), on Fill my cup \(simple\) now\. Pick the remembered river under Looks on Status\./);
  // the remembered river's own file, as before
  const calm = fm.remembered('remembered-calm');
  assert.equal(shapeRemembered(calm, { tdFile: REMEMBERED_FILE, readAt: now, now }).running, true);
});

test('live: looks and the video go to probe.ps1; refused (409) by the full check\'s look', async () => {
  const calls = [];
  let pr = { ok: true, td: { ok: true, file: LOOKS_FILE }, looks: { status: { age_s: 0.4, json: { show: LOOKS_FILE, look: 'remembered' } } } };
  const m = new Mission({ now: () => 1_000_000, probe: async (_h, args) => { calls.push(args ?? ''); return /remembered-screens/.test(args ?? '') ? { ok: true, written: { screens: { video: 0.3 } } } : pr; } });
  await m.pollProbe();
  assert.equal((await m.control('looks', { mode: 'manual', look: 'fill-simple' })).ok, true);
  assert.equal(calls.at(-1), '-Action looks -Mode manual -Look fill-simple');
  assert.equal((await m.control('remembered-screens', { video: 0.3 })).ok, true);
  assert.equal(calls.at(-1), '-Action remembered-screens -Video 0.30');
  pr = { ...pr, looks: { status: { age_s: 0.4, json: { show: LOOKS_FILE, look: 'fill-simple' } } } }; await m.pollProbe();
  await assert.rejects(m.control('remembered-screens', { video: 0.3 }), (e) => e.status === 409 && e.message === REMEMBERED_LOOK_ONLY);
  pr = { ok: true, td: { ok: true, file: FILLING_FILE } }; await m.pollProbe();
  await assert.rejects(m.control('looks', { mode: 'auto' }), (e) => e.status === 409 && e.message === LOOKS_ONLY);
});

function startServer(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`server did not start:\n${out}`)); }, 20_000);
    p.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve({ p, base: m[0] }); } });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${out}`)); });
  });
}

test('server: POST /api/control/looks behind the login, refused while another show runs; /api/remembered runs on the look', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-looks-'));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: FIXTURES, MISSION_FAKE_AGENT: '1', MISSION_FIXTURE_APPLY_S: '0' });
  t.after(() => p.kill());
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), redirect: 'manual', headers: { 'content-type': 'application/json', ...headers } });
  assert.equal((await post('/api/control/looks', { mode: 'auto' })).status, 401);
  const mc = (await post('/login', { password: 'test-password' })).headers.get('set-cookie').split(';')[0];
  const on = (s) => ({ cookie: `${mc}; scenario=${s}` });
  assert.equal((await fetch(base + '/looks.js', { headers: { cookie: mc } })).status, 200);
  const rem = await (await fetch(base + '/api/remembered', { headers: on('looks-auto') })).json();
  assert.deepEqual([rem.running, rem.show, rem.look?.look], [true, LOOKS_FILE, 'remembered']);
  const ok = await post('/api/control/looks', { mode: 'manual', look: 'fill-configurable' }, on('looks-auto'));
  assert.equal(ok.status, 200);
  const st = await (await fetch(base + '/api/status', { headers: on('looks-auto') })).json();
  assert.deepEqual([st.probe.value.looks.control.json.look, st.probe.value.looks.status.json.look], ['fill-configurable', 'fill-configurable']);
  const refused = await post('/api/control/looks', { mode: 'auto' }, on('filling-running'));
  assert.deepEqual([refused.status, (await refused.json()).error], [409, LOOKS_ONLY]);
  assert.equal((await post('/api/control/looks', { mode: 'manual' }, on('looks-auto'))).status, 400);
});

test('remembered-screens: the M7 sliders (intensity, threshold) with or without the video, each 0 to 1', async () => {
  assert.deepEqual(planControl('remembered-screens', { intensity: 0.8, threshold: 0.4, video: 0.15 }),
    { kind: 'remembered', args: '-Action remembered-screens -Video 0.15 -Intensity 0.80 -Threshold 0.40' });
  assert.equal(planControl('remembered-screens', { threshold: 0.5 }).args, '-Action remembered-screens -Threshold 0.50');
  assert.throws(() => planControl('remembered-screens', { intensity: 1.2 }), /intensity is 0 to 1/);
  assert.throws(() => planControl('remembered-screens', { threshold: '0.5; whoami' }), /threshold is 0 to 1/);
  assert.throws(() => planControl('remembered-screens', {}), /video is 0 to 1/);
  assert.deepEqual(checkedControl('remembered-screens', { intensity: 0.666, threshold: 0.3, light: 'pool' }), { intensity: 0.67, threshold: 0.3 });
  assert.equal(changeLabel('remembered-screens', { intensity: 0.8, threshold: 0.35, video: 0.15 }), 'the change of the screens to intensity 80 %, threshold 35 %, river video 15 %');
  assert.deepEqual(actionPhrase({ action: 'remembered-screens', body: { intensity: 0.6 } }), ['Set', 'set', 'the screens to intensity 60 %']);
  const fm = fixtureMission();
  const w = (await fm.control('remembered-screens', { intensity: 0.7, threshold: 0.45 }, 'looks-auto')).written;
  assert.deepEqual([w.screens.intensity, w.screens.threshold], [0.7, 0.45]);
});

// ---- the playlist (river-all-looks.toe; docs/mission-ui.md "Looks" and "Looks page") ----------------------------------------------
const PL = [{ look: 'remembered', for: { loops: 4 } }, { look: 'fill-simple', for: { cycles: 1 } }, { look: 'seasons', for: { minutes: 10 } }];

test('playlist: the shape, the units per look and the bounds, with a 400 that says why', () => {
  assert.equal(playlistProblem(PL), null);
  assert.equal(playlistProblem(DEFAULT_PLAYLIST), null);
  assert.deepEqual(checkPlaylist([{ for: { minutes: 3 }, look: 'modal', extra: 1 }]), [{ look: 'modal', for: { minutes: 3 } }]);
  assert.equal(checkPlaylist([]), null);
  const bad = [
    [{}, /list of \{ look, for \}/], [[], /1 to 12 entries/], [Array(13).fill(PL[0]), /1 to 12 entries/], [[null], /entry 1 is/],
    [[{ look: 'disco', for: { loops: 1 } }], /entry 1: look is remembered, fill-simple/],
    [[{ look: 'fill-simple', for: { loops: 2 } }], /plays for cycles or minutes, not loops/],
    [[{ look: 'remembered', for: { cycles: 2 } }], /plays for loops or minutes, not cycles/],
    [[{ look: 'seasons', for: { loops: 2 } }], /plays for minutes, not loops/],
    [[PL[0], { look: 'modal', for: { minutes: 121 } }], /entry 2: minutes is a whole number from 1 to 120/],
    [[{ look: 'remembered', for: { loops: 21 } }], /loops is a whole number from 1 to 20/],
    [[{ look: 'remembered', for: { loops: 0 } }], /from 1 to 20/], [[{ look: 'remembered', for: { loops: 1.5 } }], /whole number/],
    [[{ look: 'remembered', for: { loops: '4' } }], /whole number/],
    [[{ look: 'remembered', for: { loops: 4, minutes: 2 } }], /for is \{ loops: n \}/], [[{ look: 'remembered', for: 4 }], /for is/],
  ];
  for (const [p, re] of bad) {
    assert.match(playlistProblem(p), re, JSON.stringify(p));
    assert.throws(() => planControl('looks', { mode: 'auto', playlist: p }), (e) => e.status === 400 && re.test(e.message), JSON.stringify(p));
  }
  assert.throws(() => planControl('looks', { mode: 'manual', look: 'seasons', playlist: PL }), /a playlist goes with mode auto/);
  assert.deepEqual([unitFor('remembered'), unitFor('fill-configurable'), unitFor('seasons'), unitFor('modal')], ['loops', 'cycles', 'minutes', 'minutes']);
});

test('playlist: to probe.ps1 as one argument of compact JSON, quotes escaped; checkedControl keeps only what was checked', () => {
  const args = planControl('looks', { mode: 'auto', playlist: PL }).args;
  assert.equal(args, `-Action looks -Mode auto -Playlist ${playlistArg(PL)}`);
  assert.equal(playlistArg([PL[0]]), '[{\\"look\\":\\"remembered\\",\\"for\\":{\\"loops\\":4}}]');
  assert.doesNotMatch(args.split(' -Playlist ')[1], /[\s;&|<>'`$]/, 'nothing inside the playlist argument a shell would act on');
  assert.equal(planControl('looks', { mode: 'manual', look: 'modal' }).args, '-Action looks -Mode manual -Look modal');
  assert.deepEqual(checkedControl('looks', { mode: 'auto', playlist: [{ look: 'seasons', for: { minutes: 5 }, x: 1 }], file: 'y' }),
    { mode: 'auto', playlist: [{ look: 'seasons', for: { minutes: 5 } }] });
});

test('playlist: the words (history, the applying line, the position line)', () => {
  assert.equal(changeLabel('looks', { mode: 'auto', playlist: PL }), 'the change of the looks to a playlist of 3 looks');
  assert.deepEqual(actionPhrase({ action: 'looks', body: { mode: 'auto', playlist: PL } }), ['Set', 'set', 'the looks to a playlist of 3 looks']);
  assert.deepEqual(actionPhrase({ action: 'looks', body: { mode: 'manual', look: 'seasons' } }), ['Set', 'set', "the looks to the river's year (manual)"]);
  assert.equal(entryWords(PL[1]), 'Fill my cup (simple) for 1 cycle');
  assert.equal(entryWords(PL[2]), "The river's year for 10 minutes");
  assert.equal(positionWords(1, 2, { done: 2, of: 4, unit: 'loops' }), '2 of 2 · loop 3 of 4');
  assert.equal(positionWords(0, 3, null), '1 of 3');
  assert.equal(positionWords(null, 3, { done: 9, of: 10, unit: 'minutes' }), 'minute 10 of 10');
  assert.equal(nowWords({ mode: 'auto', look: 'remembered', playlist: PL, position: 0, progress: { done: 2, of: 4, unit: 'loops' } }),
    'Showing the remembered river · playlist: 1 of 3 · loop 3 of 4');
});

test('playlist: the fixture world keeps it and plays it; the old file keeps its own Auto', async () => {
  const m = run(fx('all-looks-auto')), v = looksView(m.show.looks, m.show.fresh.probe_age_s);
  assert.equal(m.show.file.name, 'river-all-looks.toe');
  assert.deepEqual([m.controls.looks.possible, m.show.look, m.controls['remembered-zones'].possible], [true, 'remembered', true]);
  assert.deepEqual([v.now.looks.length, v.now.playlist.length, v.now.position, v.asked.playlist.length], [5, 3, 0, 3]);
  assert.equal(v.now.words, 'Showing the remembered river · playlist: 1 of 3 · loop 3 of 4');
  assert.equal(v.now.inputs.river.source, 'live');
  const fm = fixtureMission();
  const two = [{ look: 'modal', for: { minutes: 5 } }, { look: 'fill-configurable', for: { cycles: 2 } }];
  const r = await fm.control('looks', { mode: 'auto', playlist: two }, 'all-looks-auto');
  assert.deepEqual([r.ok, r.written.playlist], [true, two]);
  let s = fm.snapshot('all-looks-auto'), lv = looksView(derive(s, s.now).show.looks, 0);
  assert.deepEqual([lv.asked.playlist, lv.now.playlist, lv.now.look, lv.now.position, lv.now.progress], [two, two, 'modal', 0, { done: 0, of: 5, unit: 'minutes' }]);
  assert.equal(askedIs(lv, { mode: 'auto', playlist: two }), true);
  // pinned, the playlist stays in control.json for the way back
  await fm.control('looks', { mode: 'manual', look: 'seasons' }, 'all-looks-auto');
  s = fm.snapshot('all-looks-auto'); lv = looksView(derive(s, s.now).show.looks, 0);
  assert.deepEqual([lv.asked.mode, lv.asked.look, lv.asked.playlist, lv.now.look], ['manual', 'seasons', two, 'seasons']);
  // the old file: no playlist in its status, even after one was sent (it doesn't read it)
  const fm2 = fixtureMission();
  await fm2.control('looks', { mode: 'auto', playlist: two }, 'looks-auto');
  const o = fm2.snapshot('looks-auto'), ov = looksView(derive(o, o.now).show.looks, 0);
  assert.deepEqual([ov.now.playlist, ov.now.looks.length, ov.now.look], [null, 3, 'remembered']);
  const manual = looksView(run(fx('all-looks-manual')).show.looks, 0);
  assert.deepEqual([manual.now.mode, manual.now.look, manual.now.words], ['manual', 'seasons', "Showing the river's year · manual: it stays on it"]);
});
