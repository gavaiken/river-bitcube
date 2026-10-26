// Starts the real server in fixture mode on a free port (nothing is polled, so no network) and walks the HTTP API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`server did not start:\n${out}`)); }, 20_000);
    const look = (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve({ p, base: m[0] }); } };
    p.stdout.on('data', look); p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${out}`)); });
  });
}

test('server in fixture mode: /version, login, /fixtures, status, stills, controls and the fake agent', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-smoke-'));
  const fixtures = join(dir, 'fixtures'); mkdirSync(fixtures);
  writeFileSync(join(fixtures, 'all-good.json'), JSON.stringify({ _scenario: { title: 'All good', description: 'everything up', expect: null },
    status: { bitcube: { at: 1, value: { online: true }, age_s: 3 } }, cameras: { gallery: true, river: false } }));
  writeFileSync(join(fixtures, 'quiet.json'), JSON.stringify({ status: { bitcube: { at: 1, value: { online: false }, age_s: 3 } }, cameras: {} }));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: fixtures, MISSION_FAKE_AGENT: '1', MISSION_FAKE_AGENT_DELAY_MS: '1' });
  t.after(() => p.kill());
  const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), redirect: 'manual',
                                                                   headers: { 'content-type': 'application/json', ...headers } });

  // /version needs no login and says only what runs
  const v = await (await get('/version')).json();
  assert.deepEqual(Object.keys(v).sort(), ['commit', 'fixtures', 'mission_tree', 'node', 'short', 'started']);
  assert.ok(v.commit === null || /^[0-9a-f]{40}$/.test(v.commit), v.commit);
  assert.equal(v.short, v.commit && v.commit.slice(0, 7));
  assert.ok(v.mission_tree === null || /^[0-9a-f]{40}$/.test(v.mission_tree));
  assert.deepEqual([v.fixtures, v.node, typeof Date.parse(v.started)], [true, process.version, 'number']);

  // everything else sits behind the login
  assert.equal((await get('/api/status')).status, 401);
  assert.equal((await get('/fixtures')).status, 302);
  assert.equal((await get('/fixtures/quiet')).status, 302);
  assert.equal((await get('/status')).status, 302);
  assert.equal((await post('/login', { password: 'wrong' }, { 'x-forwarded-for': '10.1.1.1' })).status, 401);
  assert.equal((await post('/login', { password: 'test-password' }, { origin: 'https://elsewhere.example' })).status, 403);
  const login = await post('/login', { password: 'test-password' });
  assert.equal(login.status, 200);
  const mc = login.headers.get('set-cookie').split(';')[0];
  assert.match(mc, /^mc=[A-Za-z0-9_-]{20,}$/);

  // scenarios: list, pick one for this browser, unknown is 404
  const fx = await (await get('/fixtures', { cookie: mc })).json();
  assert.deepEqual(fx, { active: 'all-good', scenarios: [{ name: 'all-good', title: 'All good', description: 'everything up', expect: null }, { name: 'quiet', title: 'quiet', description: '', expect: null }], calib: null });
  const pick = await get('/fixtures/quiet', { cookie: mc });
  assert.deepEqual([pick.status, pick.headers.get('location'), pick.headers.getSetCookie()], [302, '/status', ['scenario=quiet; Path=/; SameSite=Lax', 'calib=; Path=/; Max-Age=0']]);
  assert.deepEqual((await get('/fixtures/quiet?calib=drift', { cookie: mc })).headers.getSetCookie()[1], 'calib=drift; Path=/; SameSite=Lax');
  assert.deepEqual((await get('/fixtures/quiet?calib=bogus', { cookie: mc })).headers.getSetCookie()[1], 'calib=; Path=/; Max-Age=0');
  assert.equal((await get('/fixtures/nope', { cookie: mc })).status, 404);
  assert.equal((await get('/fixtures/quiet.json', { cookie: mc })).status, 404);
  const both = `${mc}; scenario=quiet`;
  assert.equal((await (await get('/fixtures', { cookie: both })).json()).active, 'quiet');

  // status: the fixture, plus the live studio part, the scenario name, the clock, and the history's since / last_action
  const st = await (await get('/api/status', { cookie: both })).json();
  assert.deepEqual([st.fixture, st.bitcube.value.online, st.studio.running, st.studio.queue], ['quiet', false, false, []]);
  assert.ok(typeof st.now === 'number' && Date.now() - st.now < 10_000);          // no _scenario.now in these files: the real clock
  assert.deepEqual([typeof st.since, st.last_action], ['object', null]);
  assert.equal((await (await get('/api/status', { cookie: mc })).json()).fixture, 'all-good');

  // the lights: fixture mode synthesises a frame, or says why there is none (these smoke fixtures have no TouchDesigner)
  assert.equal((await get('/api/lights')).status, 401);
  const lights = await get('/api/lights', { cookie: mc });
  assert.equal(lights.status, 503);
  assert.match((await lights.json()).error, /not checked yet/);

  // stills: a placeholder for a camera the scenario has, 503 for one it has not
  const cam = await get('/api/camera/gallery.jpg', { cookie: mc });
  assert.deepEqual([cam.status, cam.headers.get('content-type')], [200, 'image/svg+xml']);
  assert.ok(Date.now() - Date.parse(cam.headers.get('x-taken')) >= 20_000);
  assert.match(await cam.text(), /gallery camera: placeholder still/);
  assert.equal((await get('/api/camera/river.jpg', { cookie: mc })).status, 503);
  assert.equal((await get('/api/camera/gallery.jpg', { cookie: both })).status, 503);

  // controls: same-origin, the whitelist, then only a log line
  assert.equal((await post('/api/control/mode', { mode: 'manual' }, { cookie: mc, origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await post('/api/control/mode', { mode: 'manual' })).status, 401);
  assert.equal((await post('/api/control/mode', { mode: 'chaos' }, { cookie: mc })).status, 400);
  assert.equal((await post('/api/control/shell', { cmd: 'rm' }, { cookie: mc })).status, 400);
  const ctl = await post('/api/control/mode', { mode: 'manual' }, { cookie: mc, origin: new URL(base).origin });
  assert.equal(ctl.status, 200);
  assert.deepEqual(await ctl.json(), { ok: true, fixture: true, action: 'mode', body: { mode: 'manual' }, note: 'fixture mode: nothing was changed' });
  const log = readFileSync(join(dir, 'state', 'controls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l) => [l.action, l.body]), [['mode', { mode: 'manual' }]]);
  // ... and into the history: /api/status says what was last done, /api/history lists it in words
  const after = await (await get('/api/status', { cookie: mc })).json();
  assert.deepEqual([after.last_action.action, after.last_action.ok, after.last_action.source, after.last_action.words, after.last_action.body],
                   ['mode', true, 'mission control', "Set the year's mode to manual from mission control", { mode: 'manual' }]);
  assert.ok(after.last_action.ago_s >= 0 && after.last_action.ago_s < 10);
  const hist = await (await get('/api/history?kinds=action', { cookie: mc })).json();
  assert.deepEqual(Object.keys(hist).sort(), ['count', 'events', 'last_action', 'now', 'since']);
  assert.deepEqual(hist.events.map((e) => [e.kind, e.words]), [['action', "Set the year's mode to manual from mission control"]]);
  assert.equal((await (await get('/api/history', { cookie: both })).json()).last_action, null);     // the other scenario is its own world

  // the pages (a page not built yet is a 404 that says so, never a 500), the redirects, and the fake agent's two moods
  for (const page of ['/status', '/lights', '/chat', '/map', '/login']) {
    const r = await get(page, { cookie: mc });
    if (r.status === 404) assert.deepEqual(await r.json(), { error: 'not built yet' }, page);
    else assert.deepEqual([r.status, /text\/html/.test(r.headers.get('content-type'))], [200, true], page);
  }
  for (const old of ['/', '/mission']) { const r = await get(old, { cookie: mc }); assert.deepEqual([r.status, r.headers.get('location')], [302, '/status'], old); }
  assert.equal((await post('/api/chat/send', { text: 'please fail' }, { cookie: mc })).status, 200);
  assert.equal((await post('/api/chat/send', { text: 'hello' }, { cookie: mc })).status, 200);
  let events = [];
  for (let i = 0; i < 100 && events.filter((e) => e.kind === 'result').length < 2; i++) { await sleep(20); events = (await (await get('/api/chat/history', { cookie: mc })).json()).events; }
  const kinds = events.map((e) => e.kind).filter((k) => k !== 'started');
  // The fake agent starts at once, so the second request can be recorded before or after the first run's first step
  // (it was flaky on a loaded machine): check the two requests apart from the two runs' own order.
  assert.deepEqual(kinds.filter((k) => k !== 'user'), ['activity', 'activity', 'activity', 'error', 'result', 'failed', 'activity', 'activity', 'activity', 'text', 'result']);
  assert.deepEqual([kinds[0], kinds.filter((k) => k === 'user').length], ['user', 2]);
  assert.ok(kinds.lastIndexOf('user') < kinds.indexOf('activity', kinds.indexOf('failed')), 'the second request is recorded before its own run starts');
  assert.equal(events.find((e) => e.kind === 'failed').text, "bitcube didn't answer");
  assert.equal(events.find((e) => e.kind === 'failed').id, events[0].id);
  // step lines in the team's words; the raw input apart, for a tooltip; only a change to the installation is an acting line
  assert.deepEqual(events.filter((e) => e.kind === 'activity').slice(0, 3).map((e) => [e.text, e.raw, e.acting]),
                   [["looked at the repo's notes", 'CLAUDE.md', false], ['checked bitcube is online', 'ssh bitcube hostname', false], ['changed the session notes', 'docs/sessions/U.md', false]]);
  assert.match(events.find((e) => e.kind === 'error').text, /ssh: connect to host bitcube/);
  assert.match(events.find((e) => e.kind === 'text').text, /You said: hello[\s\S]*\n- TouchDesigner is running \*\*the river's year\*\*/);
  assert.deepEqual(events.filter((e) => e.kind === 'result').map((e) => e.ok), [false, true]);
});

test('assets under public/ are served to anyone; HTML only through the page routes behind the login; nothing outside public/', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-static-'));
  const fixtures = join(dir, 'fixtures'); mkdirSync(fixtures);
  writeFileSync(join(fixtures, 'all-good.json'), JSON.stringify({ status: {}, cameras: {} }));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: fixtures, MISSION_FAKE_AGENT: '1' });
  t.after(() => p.kill());
  const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
  assert.match((await get('/v2.css')).headers.get('content-type'), /text\/css/);
  assert.match((await get('/manifest.webmanifest')).headers.get('content-type'), /manifest/);
  for (const miss of ['/nope.js', '/..%2Fserver.mjs', '/lib/auth.mjs', '/proto/a', '/status.html']) assert.equal((await get(miss)).status, 302, miss);   // not an asset: login first, as before
  const login = await fetch(base + '/login', { method: 'POST', body: JSON.stringify({ password: 'test-password' }), headers: { 'content-type': 'application/json' } });
  const mc = login.headers.get('set-cookie').split(';')[0];
  for (const miss of ['/nope.js', '/..%2Fserver.mjs', '/lib/auth.mjs']) assert.equal((await get(miss, { cookie: mc })).status, 404, miss);   // only files under public/
  assert.equal((await get('/proto/a', { cookie: mc })).status, 404);      // the prototypes are gone (git history)
  for (const old of ['/', '/mission', '/status.html']) assert.deepEqual([(await get(old, { cookie: mc })).status, (await get(old, { cookie: mc })).headers.get('location')], [302, '/status'], old);   // the v1 addresses
});

test('the v2 routes on the real fixtures: lights, pixelmap, calibration (scripted), history, contacts, check, rebuild', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-v2-'));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: fixtures, MISSION_FAKE_AGENT: '1', MISSION_FIXTURE_CALIBRATE_S: '3' });
  t.after(() => p.kill());
  const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), redirect: 'manual',
                                                                   headers: { 'content-type': 'application/json', ...headers } });
  const login = await post('/login', { password: 'test-password' });
  const mc = login.headers.get('set-cookie').split(';')[0];
  const on = (scenario) => ({ cookie: `${mc}; scenario=${scenario}` });

  // every new route needs the login; every control the same origin
  for (const path of ['/api/lights', '/api/pixelmap', '/api/calibration', '/api/history', '/api/contacts']) assert.equal((await get(path)).status, 401, path);
  for (const path of ['/api/control/check', '/api/control/calibrate', '/api/control/rebuild']) {
    assert.equal((await post(path, {})).status, 401, path);
    assert.equal((await post(path, {}, { cookie: mc, origin: 'https://elsewhere.example' })).status, 403, path);
  }

  // status: the fixture's own moment is the clock, and since is the history's view of this scenario
  const st = await (await get('/api/status', on('all-good'))).json();
  assert.equal(new Date(st.now).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false }), '02:59:00');
  assert.ok(st.now <= Date.now() && Date.now() - st.now < 8 * 86_400_000);
  assert.equal(st.bitcube.age_s, 4);                                             // the scenario's own age, whatever the day
  assert.ok(st.since && 'overall' in st.since && 'items' in st.since && 'show' in st.since);

  // the lights: one shape in both modes (the contract in lib/lights.mjs), 503 in plain words where there are no frames
  const lights = await (await get('/api/lights', on('all-good'))).json();
  assert.deepEqual([lights.ok, lights.action, lights.synthetic, lights.frames.ropes.w, lights.frames.ropes.h, lights.frames.panels.w, lights.frames.panels.h, lights.frames.screens.w, lights.frames.screens.h, lights.frames.source],
                   [true, 'frames', true, 20, 400, 64, 128, 128, 64, 'canvas']);
  assert.equal(Buffer.from(lights.frames.ropes.rgb, 'base64').length, 20 * 400 * 3);
  assert.equal((await (await get('/api/lights', on('ropes-dark-on-purpose'))).json()).frames.source, 'black');
  const off = await get('/api/lights', on('bitcube-offline'));
  assert.deepEqual([off.status, await off.json()], [503, { ok: false, error: 'bitcube is offline: no frames' }]);
  const frozen = await get('/api/lights', on('td-frozen'));
  assert.deepEqual([frozen.status, (await frozen.json()).error], [503, "TouchDesigner isn't answering: no frames"]);

  // the LED map and the screens, from the worktree's tools/pixelmap
  const pm = await (await get('/api/pixelmap', on('all-good'))).json();
  assert.deepEqual(Object.keys(pm), ['map', 'screens', 'still']);
  assert.deepEqual([pm.map.file, pm.map.points.length, Object.keys(pm.map.ropes).length, pm.map.meta.frame_size, pm.map.meta.camera, !!pm.map.hub75_quad1, pm.still],
                   ['pixelmap-2026-10-23.json', 8000, 20, [1440, 808], 'gallery', true, null]);
  assert.deepEqual([pm.screens.file, Object.keys(pm.screens.screens), pm.screens.meta.frame_size], ['screens-2026-10-23.json', ['1', '2', '3', '4'], [1440, 808]]);
  assert.deepEqual(Object.keys(pm.screens.screens['2']).sort(), ['balance', 'bl', 'br', 'px', 'tl', 'tr']);

  // who to call: names from model.js; numbers only from the untracked file
  const c1 = await (await get('/api/contacts', on('all-good'))).json();
  assert.deepEqual(c1.contacts.map((c) => [c.key, c.name, c.tel]), [['gavin', 'Gavin', null], ['lilian', 'Lilian', null], ['andi', 'Andi', null], ['will', 'Will', null], ['dave', 'Dave', null], ['colin', 'Colin', null]]);
  assert.equal(c1.contacts[1].owns, 'the lights and the rigging');
  writeFileSync(join(dir, 'state', 'contacts.json'), JSON.stringify({ lilian: { tel: '+1 555 010 0199' }, nobody: { tel: '+1 555 010 0100' }, will: { tel: 7 } }));
  const c2 = await (await get('/api/contacts', on('all-good'))).json();
  assert.deepEqual(c2.contacts.filter((c) => c.tel).map((c) => [c.key, c.tel]), [['lilian', '+1 555 010 0199']]);

  // the full check now: at most once per 20 s
  const chk = await post('/api/control/check', {}, on('all-good'));
  assert.deepEqual([chk.status, (await chk.json()).ok], [200, true]);
  const again = await post('/api/control/check', {}, on('all-good'));
  assert.equal(again.status, 429);
  assert.match((await again.json()).error, /^checked \d+ s ago; wait$/);

  // rebuild: only the river's year, and only a logged no-op here
  assert.equal((await post('/api/control/rebuild', { file: 'river-online-oct-23.toe' }, on('all-good'))).status, 400);
  assert.equal((await post('/api/control/rebuild', {}, on('all-good'))).status, 400);
  const rb = await (await post('/api/control/rebuild', { file: 'river-local-oct-22-seasons.toe' }, on('all-good'))).json();
  assert.deepEqual([rb.ok, rb.fixture, rb.action], [true, true, 'rebuild']);

  // the scripted calibration: none -> start -> progress -> done; the probe mirrors it; cancel; the drift flag
  assert.deepEqual(await (await get('/api/calibration', on('all-good'))).json(), { running: false, none: true });
  assert.equal((await post('/api/control/calibrate', { action: 'explode' }, on('all-good'))).status, 400);
  // a body that is not a JSON object is refused before anything runs or is recorded (it threw a TypeError, recorded as a failed start)
  const histBefore = (await (await get('/api/history?kinds=action', on('all-good'))).json()).count;
  for (const junk of [null, [1], 7, 'start']) {
    const r = await post('/api/control/calibrate', junk, on('all-good'));
    assert.equal(r.status, 400, JSON.stringify(junk));
    assert.doesNotMatch((await r.json()).error, /Cannot read|TypeError/);
  }
  assert.equal((await post('/api/control/ropes', null, on('all-good'))).status, 400);
  assert.equal((await (await get('/api/history?kinds=action', on('all-good'))).json()).count, histBefore, 'nothing recorded');
  // fixture mode checks calibrate's arguments with the live whitelist (planCalibrate): a bad one is a 400 here as it is live
  assert.equal((await post('/api/control/calibrate', { action: 'start', decode_only: 'pixelmap-20261018-154155; calc' }, on('all-good'))).status, 400);
  assert.equal((await post('/api/control/calibrate', { action: 'start', decode_only: { toString: 1 } }, on('all-good'))).status, 400);
  assert.equal((await post('/api/control/calibrate', { action: 'start', cam: 'kitchen' }, on('all-good'))).status, 400);
  const refused = await (await post('/api/control/calibrate', { action: 'start' }, on('bitcube-offline'))).json();
  assert.equal(refused.error, "bitcube is offline: calibration can't start");
  const started = await (await post('/api/control/calibrate', { action: 'start' }, on('all-good'))).json();
  assert.deepEqual([started.ok, started.started, started.calibration.running, started.calibration.mode], [true, true, true, 'full']);
  assert.equal((await (await get('/api/status', on('all-good'))).json()).probe.value.calibration.running, true);
  assert.equal((await (await post('/api/control/calibrate', { action: 'start' }, on('all-good'))).json()).error, 'a calibration is already running');
  let cal, stages = new Set();
  for (let i = 0; i < 200; i++) { await sleep(50); cal = await (await get('/api/calibration', on('all-good'))).json(); stages.add(cal.stage); if (!cal.running) break; }
  assert.deepEqual([cal.running, cal.ok, cal.stage, cal.result.map, cal.result.points, cal.restored], [false, true, 'done', 'pixelmap-2026-10-23.json', 8000, true]);
  assert.ok(stages.has('ropes-capture') && stages.has('ropes-decode'), [...stages].join());
  assert.ok(cal.elapsed_s >= 2 && cal.elapsed_s < 10, `a 3 s scripted run: ${cal.elapsed_s}`);
  const s2 = await (await post('/api/control/calibrate', { action: 'start', dry_run: true }, on('all-good'))).json();
  assert.equal(s2.calibration.mode, 'dry-run');
  const cancel = await (await post('/api/control/calibrate', { action: 'cancel' }, on('all-good'))).json();
  assert.deepEqual([cancel.ok, cancel.cancelled, cancel.forced, cancel.calibration.running, cancel.calibration.cancelled], [true, true, false, false, true]);
  const drift = await (await post('/api/control/calibrate?calib=drift', { action: 'start' }, on('all-good'))).json();
  assert.equal(drift.ok, true);
  for (let i = 0; i < 200; i++) { await sleep(50); cal = await (await get('/api/calibration', on('all-good'))).json(); if (!cal.running) break; }
  assert.deepEqual([cal.ok, cal.stage, cal.result], [false, 'ropes-capture', null]);
  assert.match(cal.error, /^The camera moved during the run \(drift 48\): the map was not saved/);
  const viaCookie = await (await post('/api/control/calibrate', { action: 'start' }, { cookie: `${mc}; scenario=all-good; calib=decode` })).json();
  assert.equal(viaCookie.ok, true);
  for (let i = 0; i < 200; i++) { await sleep(50); cal = await (await get('/api/calibration', on('all-good'))).json(); if (!cal.running) break; }
  assert.match(cal.error, /^ropes-decode failed \(exit 1\)/);
  assert.match(cal.reason, /^Working out where each rope is failed: /);
  // every control left a line in this scenario's history, in words; a refused one (400, 429) did not
  const hist = await (await get('/api/history?kinds=action&limit=20', on('all-good'))).json();
  const words = hist.events.map((e) => e.words);
  assert.ok(words.includes('Ran the full check of bitcube from mission control'), words);
  assert.ok(words.includes("Rebuilt the river's year with the new LED map from mission control"), words);
  assert.ok(words.includes('Started a calibration from mission control') && words.includes('Cancelled the calibration from mission control'), words);
  assert.ok(words.some((w) => /Tried to start a calibration from mission control, but/.test(w)), words);   // "already running" is an answer, not a refusal
  assert.equal(hist.events.filter((e) => e.action === 'check').length, 1);
  assert.equal(hist.events.filter((e) => e.action === 'rebuild').length, 1);
  for (const e of hist.events) assert.ok(!/toe|ssh|fps/i.test(e.words), e.words);
  // another site can't log a teammate out: /logout is a state-changing POST like the rest
  assert.equal((await post('/logout', {}, { cookie: mc, origin: 'https://evil.example' })).status, 403);
  assert.equal((await get('/api/status', { cookie: mc })).status, 200, 'still logged in');
});

test("a body that isn't a JSON object, or a foreign cookie with a stray %, gets mission control's own words, never JavaScript's", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-junk-'));
  const fixtures = join(dir, 'fixtures'); mkdirSync(fixtures);
  writeFileSync(join(fixtures, 'all-good.json'), JSON.stringify({ status: {}, cameras: {} }));
  writeFileSync(join(dir, 'pw'), 'NOT-A-REAL-PW\n');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: fixtures, MISSION_FAKE_AGENT: '1', MISSION_FAKE_AGENT_DELAY_MS: '1' });
  t.after(() => p.kill());
  const post = (path, raw, headers = {}) => fetch(base + path, { method: 'POST', body: raw, redirect: 'manual', headers: { 'content-type': 'application/json', ...headers } });
  for (const junk of ['null', '[1]', '7', '"x"']) {
    const r = await post('/login', junk);
    assert.equal(r.status, 400, `login ${junk}`);
    assert.doesNotMatch((await r.json()).error, /Cannot read|TypeError|properties/);
  }
  const login = await post('/login', JSON.stringify({ password: 'NOT-A-REAL-PW' }));
  const mc = login.headers.get('set-cookie').split(';')[0];
  for (const path of ['/api/chat/send', '/api/chat/stop']) {
    for (const junk of ['null', '[1]', '7']) {
      const r = await post(path, junk, { cookie: mc });
      assert.equal(r.status, 400, `${path} ${junk}`);
      assert.doesNotMatch((await r.json()).error, /Cannot read|TypeError|properties/);
    }
  }
  const foreign = `other_app=progress=50%; ${mc}`;
  assert.equal((await fetch(base + '/api/status', { headers: { cookie: foreign } })).status, 200);
  assert.equal((await fetch(base + '/status', { headers: { cookie: foreign }, redirect: 'manual' })).status, 200);
});
