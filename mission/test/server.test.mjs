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
  assert.deepEqual(fx, { active: 'all-good', scenarios: [{ name: 'all-good', title: 'All good', description: 'everything up', expect: null }, { name: 'quiet', title: 'quiet', description: '', expect: null }] });
  const pick = await get('/fixtures/quiet', { cookie: mc });
  assert.deepEqual([pick.status, pick.headers.get('location'), pick.headers.get('set-cookie')], [302, '/status', 'scenario=quiet; Path=/; SameSite=Lax']);
  assert.equal((await get('/fixtures/nope', { cookie: mc })).status, 404);
  assert.equal((await get('/fixtures/quiet.json', { cookie: mc })).status, 404);
  const both = `${mc}; scenario=quiet`;
  assert.equal((await (await get('/fixtures', { cookie: both })).json()).active, 'quiet');

  // status: the fixture, plus the live studio part and the scenario name
  const st = await (await get('/api/status', { cookie: both })).json();
  assert.deepEqual([st.fixture, st.bitcube.value.online, st.studio.running, st.studio.queue], ['quiet', false, false, []]);
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

  // the pages, and the fake agent's two moods
  for (const page of ['/status', '/mission', '/chat', '/map', '/login']) assert.match((await get(page, { cookie: mc })).headers.get('content-type'), /text\/html/, page);
  assert.equal((await post('/api/chat/send', { text: 'please fail' }, { cookie: mc })).status, 200);
  assert.equal((await post('/api/chat/send', { text: 'hello' }, { cookie: mc })).status, 200);
  let events = [];
  for (let i = 0; i < 100 && events.filter((e) => e.kind === 'result').length < 2; i++) { await sleep(20); events = (await (await get('/api/chat/history', { cookie: mc })).json()).events; }
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => k !== 'started'), ['user', 'user', 'activity', 'activity', 'activity', 'error', 'result', 'activity', 'activity', 'activity', 'text', 'result']);
  assert.deepEqual(events.filter((e) => e.kind === 'activity').slice(0, 3).map((e) => e.text), ['read CLAUDE.md', 'ran: Check bitcube is online', 'edited docs/sessions/U.md']);
  assert.match(events.find((e) => e.kind === 'error').text, /ssh: connect to host bitcube/);
  assert.match(events.find((e) => e.kind === 'text').text, /You said: hello[\s\S]*\n- .*`river-local-oct-22-seasons.toe`/);
  assert.deepEqual(events.filter((e) => e.kind === 'result').map((e) => e.ok), [false, true]);
});

test('assets under public/ are served to anyone; prototype pages only behind the login; nothing outside public/', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-static-'));
  const fixtures = join(dir, 'fixtures'); mkdirSync(fixtures);
  writeFileSync(join(fixtures, 'all-good.json'), JSON.stringify({ status: {}, cameras: {} }));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: fixtures, MISSION_FAKE_AGENT: '1' });
  t.after(() => p.kill());
  const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
  assert.match((await get('/app.css')).headers.get('content-type'), /text\/css/);
  for (const miss of ['/nope.js', '/..%2Fserver.mjs', '/lib/auth.mjs', '/proto/example']) assert.equal((await get(miss)).status, 302, miss);   // not an asset: login first, as before
  const login = await fetch(base + '/login', { method: 'POST', body: JSON.stringify({ password: 'test-password' }), headers: { 'content-type': 'application/json' } });
  const mc = login.headers.get('set-cookie').split(';')[0];
  for (const miss of ['/nope.js', '/..%2Fserver.mjs', '/lib/auth.mjs']) assert.equal((await get(miss, { cookie: mc })).status, 404, miss);   // only files under public/
  assert.equal((await get('/proto/example', { cookie: mc })).status, 404); // no such prototype
});
