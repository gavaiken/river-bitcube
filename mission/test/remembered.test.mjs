// The remembered river's debug page (docs/mission-ui.md "Remembered river page"): its API (lib/remembered.mjs), its two controls
// (lib/mission.mjs planControl, fixture mode), its words (public/remembered-words.js) and the page itself, served (fixture mode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mission, planControl, checkedControl } from '../lib/mission.mjs';
import { FixtureMission } from '../lib/fixtures.mjs';
import { shapeRemembered, plainRememberedError, Remembered } from '../lib/remembered.mjs';
import { actionPhrase } from '../lib/history.mjs';
import { changeLabel, derive, REMEMBERED_FILE, REMEMBERED_ONLY, APPLY_BLOCKS } from '../public/model.js';
import { rememberedView, dayStripSVG, mss, dateWords, ropesWords, relativeWords } from '../public/remembered-words.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const fixtureMission = () => new FixtureMission({ dir: FIXTURES, stateDir: mkdtempSync(join(tmpdir(), 'rem-')), applyS: 0 });
const served = (fm, name) => {
  const td = fm.snapshot(name).probe?.value?.td;
  return shapeRemembered(fm.remembered(name), { tdFile: td?.file ?? null, readAt: fm.clock(name), now: fm.clock(name) });
};

test('the two controls: the whitelist, the probe.ps1 arguments, what is kept, the labels and the history line', () => {
  assert.deepEqual(planControl('remembered-zones', { light: 'pool', pool_height_m: 0.6 }), { kind: 'remembered', args: '-Action remembered-zones -Light pool -PoolHeight 0.60' });
  assert.deepEqual(planControl('remembered-zones', { light: 'off' }), { kind: 'remembered', args: '-Action remembered-zones -Light off' });
  assert.deepEqual(planControl('remembered-zones', { light: 'eddies', pool_height_m: '1.2' }).args, '-Action remembered-zones -Light eddies -PoolHeight 1.20');
  assert.deepEqual(planControl('remembered-opening', { on: true }), { kind: 'remembered', args: '-Action remembered-opening -On' });
  assert.deepEqual(planControl('remembered-opening', { on: false }), { kind: 'remembered', args: '-Action remembered-opening' });
  for (const [a, b] of [['remembered-zones', {}], ['remembered-zones', { light: 'all' }], ['remembered-zones', { light: 'pool', pool_height_m: 2 }],
                        ['remembered-zones', { light: 'pool', pool_height_m: -0.1 }], ['remembered-zones', { light: 'pool', pool_height_m: null }],
                        ['remembered-zones', { light: 'pool; rm -rf /' }], ['remembered-opening', {}], ['remembered-opening', { on: 'true' }], ['remembered-opening', { on: 1 }]]) {
    assert.throws(() => planControl(a, b), (e) => e.status === 400, JSON.stringify([a, b]));
  }
  assert.deepEqual(checkedControl('remembered-zones', { light: 'pool', pool_height_m: 0.555, extra: 'x' }), { light: 'pool', pool_height_m: 0.56 });
  assert.deepEqual(checkedControl('remembered-opening', { on: true, x: 1 }), { on: true });
  assert.equal(changeLabel('remembered-zones', { light: 'pool', pool_height_m: 0.6 }), 'the lighting of the pool (pool line 0.60 m)');
  assert.equal(changeLabel('remembered-zones', { light: 'off' }), 'the pool and eddies back to the show');
  assert.equal(changeLabel('remembered-opening', { on: true }), 'the opening-night switch on');
  assert.deepEqual(APPLY_BLOCKS['remembered-zones'], ['remembered-zones']);
  assert.ok(APPLY_BLOCKS.calibrate.includes('remembered-zones') && !APPLY_BLOCKS.calibrate.includes('remembered-opening'));
  assert.deepEqual(actionPhrase({ action: 'remembered-zones', body: { light: 'eddies', pool_height_m: 0.5 } }), ['Lit', 'light', 'the eddies, the pool line at 0.50 m']);
  assert.deepEqual(actionPhrase({ action: 'remembered-opening', body: { on: false } }), ['Switched', 'switch', 'opening night off']);
});

test('the model: the controls only while the remembered river runs', () => {
  const read = (n) => JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), 'utf8'));
  const m = (n) => { const f = read(n); return derive({ ...f.status, now: f._scenario.now }, f._scenario.now + 2000); };
  assert.equal(m('remembered-calm').controls['remembered-zones'].possible, true);
  assert.equal(m('remembered-calm').controls['remembered-opening'].possible, true);
  assert.equal(m('remembered-not-running').controls['remembered-zones'].why, REMEMBERED_ONLY);
  assert.equal(m('remembered-not-running').controls['remembered-opening'].why, REMEMBERED_ONLY);
});

test('GET /api/remembered in fixture mode: running or not, the day\'s hours from TouchDesigner or from Dave, nothing twice', () => {
  const fm = fixtureMission();
  const calm = served(fm, 'remembered-calm');
  assert.deepEqual([calm.ok, calm.running, calm.show, calm.status.phase, calm.profile_date, calm.problems], [true, true, REMEMBERED_FILE, 'calm', '2017-02-07', []]);
  assert.equal(calm.profile.rain.length, 24);
  assert.equal('profile' in calm.dave.memory, false, 'the profile is served once, as profile');
  const fb = served(fm, 'remembered-fallback');
  assert.deepEqual([fb.running, fb.status.day.source, fb.profile_date, fb.profile.flow[12]], [true, 'notable', '2017-01-08', 412]);
  const off = served(fm, 'remembered-not-running');
  assert.deepEqual([off.running, off.show, off.status_age_s], [false, 'river-local-oct-22-seasons.toe', 5400]);
  assert.equal(off.dave.memory.date, '2017-02-07');
  // a file that is missing or unreadable: said in words, the rest still served
  const half = shapeRemembered({ ok: true, status: { error: 'unreadable status.json' }, state: { missing: true }, reflex: { age_s: 1, json: { heard: 0.3 } } });
  assert.deepEqual([half.ok, half.running, half.dave, half.reflex.heard], [true, false, null, 0.3]);
  assert.match(half.problems[0], /TouchDesigner's status file couldn't be read/);
  // bitcube not read at all
  assert.deepEqual(shapeRemembered({ ok: false, error: "can't reach bitcube over SSH" }), { ok: false, error: 'bitcube is offline' });
  assert.equal(plainRememberedError('bitcube took too long to answer'), "bitcube didn't answer in time");
  // a login in a file never reaches a browser
  const leak = shapeRemembered({ ok: true, state: { age_s: 1, json: { memory: { date: '2017-02-07', reason: 'rtsp://admin:hunter2@192.168.9.76:554/x' } } } });
  assert.doesNotMatch(JSON.stringify(leak), /hunter2/);
});

test('fixture mode: the controls refused while another show runs, and taken into the world while it runs', async () => {
  const fm = fixtureMission();
  await assert.rejects(fm.control('remembered-zones', { light: 'pool' }, 'remembered-not-running'), (e) => e.status === 409 && e.message === REMEMBERED_ONLY);
  await assert.rejects(fm.control('remembered-opening', { on: true }, 'all-good'), (e) => e.status === 409);
  const r = await fm.control('remembered-zones', { light: 'pool', pool_height_m: 0.75 }, 'remembered-calm');
  assert.deepEqual([r.ok, r.written.light, r.written.pool_height_m], [true, 'pool', 0.75]);
  await fm.control('remembered-opening', { on: true }, 'remembered-calm');
  const now = served(fm, 'remembered-calm');
  assert.deepEqual([now.status.zones.light, now.status.zones.pool_height_m, now.status.opening_night, now.control.opening_night], ['pool', 0.75, true, true]);
  assert.equal(served(fm, 'remembered-surge').status.opening_night, false, 'each scenario is its own world');
});

test('live: a remembered control goes to probe.ps1 and never replaces the full check; refused (409) while another show runs', async () => {
  const calls = [];
  let file = REMEMBERED_FILE;
  const m = new Mission({ now: () => 1_000_000, probe: async (_h, args) => {
    calls.push(args ?? '');
    if (/remembered/.test(args ?? '')) return { ok: true, action: 'remembered-zones', written: { light: 'pool' }, status: { missing: true } };
    return { ok: true, td: { ok: true, file } };
  } });
  await m.pollProbe();
  const r = await m.control('remembered-zones', { light: 'pool', pool_height_m: 0.6 });
  assert.equal(r.written.light, 'pool');
  assert.equal(calls.at(-1), '-Action remembered-zones -Light pool -PoolHeight 0.60');
  assert.equal(m.snapshot().probe.value.td.file, REMEMBERED_FILE, 'the full check is still the full check');
  file = 'river-local-oct-22-seasons.toe'; await m.pollProbe();
  await assert.rejects(m.control('remembered-opening', { on: true }), (e) => e.status === 409 && e.message === REMEMBERED_ONLY);
});

test('the live reader caches 1.5 s, one fetch at a time', async () => {
  let t = 0, n = 0;
  const r = new Remembered({ now: () => t, fetch: async () => { n++; return { ok: true }; } });
  await Promise.all([r.read(), r.read()]);
  t = 1000; await r.read();
  assert.equal(n, 1);
  t = 2000; await r.read();
  assert.equal(n, 2);
});

test('the page\'s words: phase, loop, why, the room and the 24-hour strip', () => {
  const fm = fixtureMission();
  const now = fm.clock('remembered-calm');
  const v = rememberedView(served(fm, 'remembered-calm'), { now });
  assert.deepEqual([v.running, v.phase, v.loop.words, v.dave.dateWords, v.dave.old, v.room.lingerers[0].label], [true, 'calm', '0:41 of 5:00', '7 Feb 2017', false, 'ropes 7, 8']);
  assert.match(v.why[0], /^Dave's choice is 4 min old → playing his day, 7 Feb 2017, chosen for its resemblance/);
  assert.ok(v.why.includes("Surge at hour 13.5 (2:48 into the loop): Dave's choice"), v.why.join('\n'));
  assert.ok(v.why.includes('Ropes follow the sound (heard 0.62); the screens follow the picture'));
  assert.deepEqual(v.dave.knobs.find((k) => k.name === 'speed'), { name: 'speed', value: 0.5, nudge: 0.05, effective: 0.55 });
  const fb = rememberedView(served(fm, 'remembered-fallback'), { now: fm.clock('remembered-fallback') });
  assert.match(fb.why[0], /^Dave's choice is 7 min old \(over the 5 min rule\) → playing a notable day: 8 Jan 2017/);
  assert.ok(fb.why.includes("Surge at hour 11 (2:23 into the loop): the day's heaviest rain, moved 6 s later by the room"), fb.why.join('\n'));
  assert.ok(fb.why.includes('Ropes follow the picture (river motion 0.27): no sound from Dave'));
  assert.equal(fb.river.source, 'recorded');
  const surge = rememberedView(served(fm, 'remembered-surge'), { now });
  assert.deepEqual(surge.panels.over, [3]);
  assert.equal(surge.wattsWords, '1,180 W of the 1,400 W limit');
  const off = rememberedView(served(fm, 'remembered-not-running'), { now: fm.clock('remembered-not-running') });
  assert.deepEqual([off.running, off.why, off.phase, off.dave.dateWords], [false, [], null, '7 Feb 2017']);
  assert.match(off.notRunning, /^TouchDesigner is showing the river's year/);
  for (const x of [v, fb, surge, off, rememberedView(null)]) {
    const svg = dayStripSVG(x);
    assert.match(svg, /^<svg class="daystrip"[^>]*role="img" aria-label="[^"<>]+">/);
    assert.doesNotMatch(svg, /NaN|undefined/);
  }
  assert.match(dayStripSVG(v), /class="ds-surge"/);
  assert.deepEqual([mss(141.2), dateWords('2017-01-08'), dateWords('x'), ropesWords([12]), relativeWords(1.5), relativeWords(1)], ['2:21', '8 Jan 2017', null, 'rope 12', 'busier than usual', 'about as usual']);
});

function startServer(env) {
  return new Promise((resolve, reject) => {
    const base = { ...process.env }; delete base.MISSION_CONTROL_SOCKET;
    const p = spawn(process.execPath, [SERVER], { env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`server did not start:\n${out}`)); }, 20_000);
    p.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve({ p, base: m[0] }); } });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${out}`)); });
  });
}

test('server: /remembered and /api/remembered behind the login, the controls through the usual route', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-rem-'));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: FIXTURES, MISSION_FAKE_AGENT: '1', MISSION_FIXTURE_APPLY_S: '0' });
  t.after(() => p.kill());
  const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), redirect: 'manual', headers: { 'content-type': 'application/json', ...headers } });
  assert.equal((await get('/api/remembered')).status, 401);
  assert.equal((await get('/remembered')).status, 302);
  assert.equal((await post('/api/control/remembered-zones', { light: 'pool' })).status, 401);
  const mc = (await post('/login', { password: 'test-password' })).headers.get('set-cookie').split(';')[0];
  const on = (s) => ({ cookie: `${mc}; scenario=${s}` });

  // the page: HTML behind the login, its modules served
  const page = await get('/remembered', { cookie: mc });
  assert.deepEqual([page.status, /text\/html/.test(page.headers.get('content-type'))], [200, true]);
  const html = await page.text();
  for (const id of ['now-phase', 'dave-body', 'river-img', 'room-dots', 'day-strip', 'why', 'strips-canvas', 'quads-canvas', 'lit', 'pool', 'z-pool', 'z-eddies', 'z-off', 'z-opening']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<script type="module" src="\/remembered.js"><\/script>/);
  for (const f of ['/remembered.js', '/remembered-words.js', '/remembered.css', '/frames-view.js']) assert.equal((await get(f)).status, 200, f);
  const js = await (await get('/remembered.js')).text();
  for (const name of ['decodeLights', 'paintStrips', 'paintScreens', 'litMeterHTML']) assert.match(js, new RegExp(`\\b${name}\\b`), `shares ${name} with Lights`);

  for (const s of ['remembered-calm', 'remembered-surge', 'remembered-fallback']) {
    const b = await (await get('/api/remembered', on(s))).json();
    assert.deepEqual([b.ok, b.running, b.show], [true, true, REMEMBERED_FILE], s);
  }
  const off = await (await get('/api/remembered', on('remembered-not-running'))).json();
  assert.deepEqual([off.ok, off.running, off.dave.memory.date], [true, false, '2017-02-07']);
  const none = await (await get('/api/remembered', on('all-good'))).json();
  assert.deepEqual([none.ok, none.running, none.status, none.dave], [true, false, null, null]);
  assert.equal((await get('/api/remembered', on('bitcube-offline'))).status, 503);

  // the controls
  const ok = await post('/api/control/remembered-zones', { light: 'eddies', pool_height_m: 0.4 }, on('remembered-calm'));
  assert.equal(ok.status, 200);
  assert.equal((await (await get('/api/remembered', on('remembered-calm'))).json()).status.zones.light, 'eddies');
  const refused = await post('/api/control/remembered-opening', { on: true }, on('remembered-not-running'));
  assert.deepEqual([refused.status, (await refused.json()).error], [409, REMEMBERED_ONLY]);
  assert.equal((await post('/api/control/remembered-zones', { light: 'everything' }, on('remembered-calm'))).status, 400);
  assert.equal((await post('/api/control/remembered-zones', { light: 'pool' }, { ...on('remembered-calm'), origin: 'https://elsewhere.example' })).status, 403);
});
