// The filling glass's dials (river-filling.toe, docs/mission-ui.md "Filling glass dials"): the control's whitelist, the server's and
// fixture mode's refusals, the model's control and its view of probe.filling (public/filling.js), the studio agent, the route.
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
import { APPLY_BLOCKS, EXPECT_S, changeLabel, derive, FILLING_FILE, FILLING_ONLY, FILLING_PALETTES, FILLING_PALETTE_WORDS } from '../public/model.js';
import { fillingView, levelWords, cycleWords, askedIs, toPct, fromPct, FILLING_STATUS_OLD_S } from '../public/filling.js';
import { ACTIONS } from '../bin/mc.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
const run = (f) => derive({ ...f.status, now: f._scenario.now }, f._scenario.now + 2000);
const fixtureMission = () => new FixtureMission({ dir: FIXTURES, stateDir: mkdtempSync(join(tmpdir(), 'fill-')), applyS: 0 });
const BODY = { palette: 'midnight', brightness: 0.8, intensity: 0.6, speed: 1 };

test('filling: a listed palette and three bounded numbers, all four, nothing else reaches the probe', () => {
  assert.deepEqual(FILLING_PALETTES, ['river', 'glacier', 'midnight', 'teal']);
  assert.deepEqual(planControl('filling', BODY), { kind: 'probe', args: '-Action filling -Palette midnight -Brightness 0.80 -Intensity 0.60 -Speed 1.00' });
  assert.equal(planControl('filling', { palette: 'teal', brightness: '0', intensity: 1, speed: '3' }).args, '-Action filling -Palette teal -Brightness 0.00 -Intensity 1.00 -Speed 3.00');
  assert.equal(planControl('filling', { ...BODY, speed: 0.25 }).args, '-Action filling -Palette midnight -Brightness 0.80 -Intensity 0.60 -Speed 0.25');
  for (const palette of [undefined, null, '', 'River', 'blue', 'teal; whoami', ['teal'], {}, true]) assert.throws(() => planControl('filling', { ...BODY, palette }), /palette is/);
  for (const k of ['brightness', 'intensity']) {
    for (const x of [undefined, null, '', true, [], -0.01, 1.01, NaN, Infinity, '0.5; whoami']) assert.throws(() => planControl('filling', { ...BODY, [k]: x }), new RegExp(`${k} is 0 to 1`), `${k} ${x}`);
  }
  for (const x of [undefined, 0, 0.2, 3.01, '1 -Palette teal']) assert.throws(() => planControl('filling', { ...BODY, speed: x }), /speed is 0.25 to 3/, `speed ${x}`);
  assert.deepEqual(checkedControl('filling', { ...BODY, brightness: '0.555', file: 'x', extra: 1 }), { palette: 'midnight', brightness: 0.56, intensity: 0.6, speed: 1 });
});

test('filling is locked like the Modal input: a calibration, the test pattern, a switch; its own copy; words for every page', () => {
  assert.ok(CAL_BLOCKED.includes('filling'), 'probe.ps1 refuses it during a calibration too (tools/tests/test_mission_guards.py)');
  assert.equal(calBlocked('filling', { running: true }).status, 409);
  assert.equal(testBlocked('filling', {}, { value: { td: { ok: true, ropes: { source: 'test' } } } }).status, 409);
  for (const a of ['switch', 'rebuild', 'calibrate']) assert.ok(APPLY_BLOCKS[a].includes('filling'), a);
  assert.deepEqual(APPLY_BLOCKS.filling, ['filling']);
  assert.equal(EXPECT_S.filling, 15);
  assert.equal(changeLabel('filling', BODY), 'the change of the filling glass to Midnight, 80 %, intensity 60 %, speed 100 %');
  assert.equal(changeLabel('filling', {}), 'the change of the filling glass');
  assert.deepEqual(actionPhrase({ action: 'filling', body: { ...BODY, palette: 'river', speed: 2.5 } }), ['Set', 'set', 'the filling glass to River blues, 80 %, intensity 60 %, speed 250 %']);
  assert.ok(ACTIONS.includes('filling'), 'the studio agent has it (bin/mc.mjs)');
  assert.equal(FILLING_PALETTE_WORDS.river, 'River blues');
});

test('the model: the dials only while the filling glass runs, and its files only then', () => {
  const on = run(fx('filling-running')), off = run(fx('filling-not-running'));
  assert.equal(on.overall.level, 'ok', on.overall.headline);
  assert.equal(on.controls.filling.possible, true);
  assert.equal(on.show.file.name, FILLING_FILE);
  assert.ok(on.show.filling?.status, 'the full check\'s files reach the page');
  assert.equal(off.controls.filling.why, FILLING_ONLY);
  assert.equal(off.show.filling, null, 'another show: nothing of it shows');
  // an older probe.ps1 that doesn't read the files: the card still shows, saying it doesn't know
  const f = fx('filling-running'); delete f.status.probe.value.filling;
  const v = fillingView(run(f).show.filling, 0);
  assert.deepEqual([v.asked, v.now], [null, null]);
  assert.match(v.problems.join(' '), /hasn't read/);
});

test('the card\'s view: what was asked, what the show reports with its age, and where the dials start', () => {
  const m = run(fx('filling-running')), v = fillingView(m.show.filling, m.show.fresh.probe_age_s);
  assert.deepEqual(v.asked, { palette: 'midnight', brightness: 0.8, intensity: 0.6, speed: 1, at_age_s: 740 });
  assert.equal(v.now.words, 'Midnight, 80 %, filling 42 % full');
  assert.equal(v.now.age_s, 21, 'the file\'s age plus the full check\'s');
  assert.equal(v.now.old, false, 'a full check 20 s old is not a show that stopped reporting');
  const stopped = fillingView({ ...m.show.filling, status: { ...m.show.filling.status, age_s: FILLING_STATUS_OLD_S + 1 } }, 0);
  assert.equal(stopped.now.old, true, `read more than ${FILLING_STATUS_OLD_S} s old: the card says "Last report"`);
  assert.deepEqual(v.base, { palette: 'midnight', brightness: 0.8, intensity: 0.6, speed: 1 });
  assert.deepEqual(toPct(v.base), { palette: 'midnight', brightness: 80, intensity: 60, speed: 100 });
  assert.deepEqual(fromPct(toPct(v.base)), BODY);
  assert.equal(askedIs(v, BODY), true);
  assert.equal(askedIs(v, { ...BODY, speed: 1.05 }), false);
  // words for each phase; nothing guessed from a bad value
  assert.deepEqual([levelWords('filling', 0.421), levelWords('draining', 0.08), levelWords('full', 1), levelWords('empty', 0), levelWords(null, 0.5), levelWords('odd', null)],
    ['filling 42 % full', 'draining 8 % full', 'full', 'empty', '50 % full', null]);
  assert.deepEqual([cycleWords(1), cycleWords(2), cycleWords(0.25), cycleWords(3)], ['about 84 s a full cycle', 'about 42 s a full cycle', 'about 5 min 36 s a full cycle', 'about 28 s a full cycle']);
  const odd = fillingView({ control: { missing: true }, status: { age_s: 1, json: { palette: 'purple', brightness: 7, intensity: 0.2, speed: 1, level: 'x', phase: 'boiling' } } }, 0);
  assert.deepEqual([odd.asked, odd.now.palette, odd.now.brightness, odd.now.intensity, odd.now.phase, odd.now.words], [null, null, null, 0.2, null, 'nothing it can name']);
  assert.deepEqual(odd.base, { palette: 'river', brightness: 0.8, intensity: 0.2, speed: 1 }, 'the show\'s defaults where nothing is known');
  assert.match(odd.problems[0], /dials file isn't there yet/);
  assert.equal(fillingView(null), null);
});

test('fixture mode: refused while another show runs, taken into the world (control and status) while it runs', async () => {
  const fm = fixtureMission();
  await assert.rejects(fm.control('filling', BODY, 'filling-not-running'), (e) => e.status === 409 && e.message === FILLING_ONLY);
  await assert.rejects(fm.control('filling', { ...BODY, palette: 'purple' }, 'filling-running'), (e) => e.status === 400);
  const r = await fm.control('filling', { palette: 'teal', brightness: 0.5, intensity: 0.9, speed: 2 }, 'filling-running');
  assert.deepEqual([r.ok, r.written.palette, r.written.speed], [true, 'teal', 2]);
  const s = fm.snapshot('filling-running');
  const v = fillingView(derive(s, s.now).show.filling, 0);
  assert.deepEqual([v.asked.palette, v.asked.speed, v.now.palette, v.now.intensity, v.now.phase], ['teal', 2, 'teal', 0.9, 'filling']);
  const other = fm.snapshot('filling-not-running');
  assert.equal(other.probe.value.filling.control.json.palette, 'midnight', 'each scenario is its own world');
});

test('live: the dials go to probe.ps1 through the full check; refused (409) while another show runs', async () => {
  const calls = [];
  let file = FILLING_FILE;
  const m = new Mission({ now: () => 1_000_000, probe: async (_h, args) => {
    calls.push(args ?? '');
    return { ok: true, td: { ok: true, file }, ...(/filling/.test(args ?? '') ? { written: { ...BODY, at: 'x' } } : {}) };
  } });
  await m.pollProbe();
  const r = await m.control('filling', BODY);
  assert.equal(r.ok, true);
  assert.equal(calls.at(-1), '-Action filling -Palette midnight -Brightness 0.80 -Intensity 0.60 -Speed 1.00');
  file = 'river-local-oct-22-seasons.toe'; await m.pollProbe();
  await assert.rejects(m.control('filling', BODY), (e) => e.status === 409 && e.message === FILLING_ONLY);
  // bitcube's own refusal (the show changed meanwhile) fails it
  file = FILLING_FILE; await m.pollProbe();
  const m2 = new Mission({ now: () => 2_000_000, probe: async (_h, args) => (/filling/.test(args ?? '') ? { ok: false, error: FILLING_ONLY, refused: 'filling', td: { ok: true, file: 'x.toe' } } : { ok: true, td: { ok: true, file: FILLING_FILE } }) });
  await m2.pollProbe();
  assert.equal((await m2.control('filling', BODY)).ok, false);
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

test('server: POST /api/control/filling behind the login, refused while another show runs, the card\'s module served', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-fill-'));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: FIXTURES, MISSION_FAKE_AGENT: '1', MISSION_FIXTURE_APPLY_S: '0' });
  t.after(() => p.kill());
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), redirect: 'manual', headers: { 'content-type': 'application/json', ...headers } });
  assert.equal((await post('/api/control/filling', BODY)).status, 401);
  const mc = (await post('/login', { password: 'test-password' })).headers.get('set-cookie').split(';')[0];
  const on = (s) => ({ cookie: `${mc}; scenario=${s}` });
  assert.equal((await fetch(base + '/filling.js', { headers: { cookie: mc } })).status, 200);
  const ok = await post('/api/control/filling', { ...BODY, palette: 'glacier' }, on('filling-running'));
  assert.equal(ok.status, 200);
  const st = await (await fetch(base + '/api/status', { headers: on('filling-running') })).json();
  assert.equal(st.probe.value.filling.control.json.palette, 'glacier');
  const refused = await post('/api/control/filling', BODY, on('filling-not-running'));
  assert.deepEqual([refused.status, (await refused.json()).error], [409, FILLING_ONLY]);
  assert.equal((await post('/api/control/filling', { ...BODY, speed: 5 }, on('filling-running'))).status, 400);
  assert.equal((await post('/api/control/filling', BODY, { ...on('filling-running'), origin: 'https://elsewhere.example' })).status, 403);
});
