// The local control socket (round 6, findings 23, 27, 35): the studio agent changes the installation only through mission
// control, so its changes get the same whitelist, locks and 409s as a phone's, show as Applying and Last done "from studio
// chat", and are refused while a calibration runs. The real server in fixture mode, and the real CLI (bin/mc.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SelfUpdate } from '../lib/update.mjs';
import { agentEnv } from '../lib/agent.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const MC = fileURLToPath(new URL('../bin/mc.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(env) {
  return new Promise((resolve, reject) => {
    // never the live control socket a session's environment names (the agent's MISSION_CONTROL_SOCKET): the test server's own,
    // in its state folder, unless the test names one (R7 #33)
    const base = { ...process.env }; delete base.MISSION_CONTROL_SOCKET;
    const p = spawn(process.execPath, [SERVER], { env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`server did not start:\n${out}`)); }, 20_000);
    const look = (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve({ p, base: m[0], log: () => out }); } };
    p.stdout.on('data', look); p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${out}`)); });
  });
}
/** The CLI as the agent runs it: node mission/bin/mc.mjs <args>, the socket from its environment. */
function mc(socket, ...args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [MC, ...args], { env: { ...process.env, MISSION_CONTROL_SOCKET: socket }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('exit', (code) => { let json = null; try { json = JSON.parse(out); } catch { /* usage text */ } resolve({ code, out, err, json }); });
  });
}

test('the control socket: 0600 in the state folder, the same controls and locks as a phone, recorded "from the studio chat", gone on exit', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-'));
  writeFileSync(join(dir, 'pw'), 'NOT-A-REAL-PW\n');
  const state = join(dir, 'state'), socket = join(state, 'mc.sock');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: state, MISSION_PASSWORD_FILE: join(dir, 'pw'), MISSION_FIXTURES: FIXTURES,
                                          MISSION_FAKE_AGENT: '1', MISSION_FIXTURE_APPLY_S: '1', MISSION_FIXTURE_CALIBRATE_S: '4' });
  let exited = false;
  p.on('exit', () => { exited = true; });
  t.after(() => { if (!exited) p.kill(); });
  for (let i = 0; i < 50 && !existsSync(socket); i++) await sleep(20);
  // only this server's own user can connect: a socket, mode 0600
  const st = statSync(socket);
  assert.equal(st.isSocket(), true);
  assert.equal(st.mode & 0o777, 0o600);

  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
  const mcCookie = (await post('/login', { password: 'NOT-A-REAL-PW' })).headers.get('set-cookie').split(';')[0];
  const phone = { cookie: `${mcCookie}; scenario=all-good` };
  const status = async () => (await fetch(base + '/api/status', { headers: phone })).json();
  const lastAction = async () => (await (await fetch(base + '/api/history?kinds=action&limit=1', { headers: phone })).json()).events[0];

  // status: what the agent reads before it acts
  const s = await mc(socket, 'status');
  assert.equal(s.code, 0, s.out);
  // R8 #30: with the server's verdicts (confirmed, expired, the history's), so the agent can tell done from given up by its applying_id
  assert.deepEqual(Object.keys(s.json).sort(), ['applying', 'blocked', 'boot_file', 'calibration', 'confirmed', 'expired', 'now', 'ok', 'overall', 'show_file', 'verdicts']);
  assert.deepEqual([s.json.overall.level, s.json.applying, s.json.calibration, s.json.show_file], ['ok', [], null, { file: 'river-local-oct-22-seasons.toe', label: "the river's year" }]);

  // a change from the chat: through the whitelist, and recorded as the studio chat's (Recent and Last done say so)
  const mode = await mc(socket, 'mode', '{"mode":"manual","note":"rtsp://admin:NOT-A-REAL-PW@cam/x"}');
  assert.deepEqual([mode.code, mode.json.ok, mode.json.status], [0, true, 200]);
  let a = await lastAction();
  assert.deepEqual([a.action, a.source, a.body, a.words], ['mode', 'studio chat', { mode: 'manual' }, "Set the year's mode to manual from the studio chat"]);
  assert.equal((await status()).last_action.source, 'studio chat');
  assert.deepEqual([(await mc(socket, 'mode', '{"mode":"chaos"}')).json.status, (await mc(socket, 'mode', '{"mode":"chaos"}')).code], [400, 1]);

  // a switch from the chat is in status.applying on every phone, from the studio chat, and a phone waits for it (409)
  const sw = mc(socket, 'switch', '{"file":"river-online-oct-23.toe"}');
  let e;
  for (let i = 0; i < 100 && !e; i++) { e = (await status()).applying[0]; if (!e) await sleep(20); }
  assert.deepEqual([e.action, e.source, e.phase, e.label], ['switch', 'studio chat', 'applying', 'the switch to the live river']);
  const phoneRopes = await post('/api/control/ropes', { dark: true }, phone);
  assert.equal(phoneRopes.status, 409);
  assert.match((await phoneRopes.json()).error, /^wait: the switch to the live river is being applied \(started \d\d:\d\d\)$/);
  // ... and the chat waits for the phones' changes the same way (and for its own: TouchDesigner is restarting)
  const chatRopes = await mc(socket, 'ropes', '{"dark":true}');
  assert.deepEqual([chatRopes.code, chatRopes.json.status, chatRopes.json.ok], [1, 409, false]);
  assert.match(chatRopes.json.error, /^wait: the switch to the live river is being applied/);
  const swDone = await sw;
  assert.equal(swDone.code, 0);
  const during = await mc(socket, 'status');
  assert.deepEqual(during.json.applying.map((x) => [x.id, x.action, x.phase, x.source]), [[swDone.json.applying_id, 'switch', 'confirming', 'studio chat']], 'the entry by the id its answer named');
  assert.match(swDone.json.request_id, /^mc[a-z0-9]+$/, 'mc.mjs prints the request id it sent');
  assert.equal(during.json.applying[0].request_id, swDone.json.request_id, 'and the entry carries it: a lost answer is still found (R8 #2, #30)');
  assert.match(during.json.blocked.ropes, /^wait: the switch to the live river is being applied/);
  for (let i = 0; i < 150 && (await status()).applying.length; i++) await sleep(20);
  a = await lastAction();
  assert.deepEqual([a.action, a.source, a.words], ['switch', 'studio chat', 'Switched TouchDesigner to the live river from the studio chat']);
  // and the agent reads the verdict on its own change by that id: done (R8 #30)
  const after = await mc(socket, 'status');
  assert.ok(after.json.confirmed.some((x) => x.id === swDone.json.applying_id && x.action === 'switch' && x.source === 'studio chat'));
  assert.ok(after.json.verdicts.some((x) => x.id === swDone.json.applying_id && x.verdict === 'confirmed'));
  assert.ok(!after.json.expired.some((x) => x.id === swDone.json.applying_id));

  // while a calibration runs, what it would spoil is refused for the chat as for a phone
  assert.equal((await post('/api/control/calibrate', { action: 'start' }, phone)).status, 200);
  const spoil = await mc(socket, 'ropes', '{"dark":false}');
  assert.deepEqual([spoil.code, spoil.json.status, spoil.json.error], [1, 409, 'a calibration is running. Stop it on the Lights page first']);
  const cs = await mc(socket, 'status');
  assert.equal(cs.json.calibration.running, true);
  assert.equal(cs.json.blocked.switch, 'a calibration is running. Stop it on the Lights page first');
  // the chat can stop a run when it is asked to (Gavin, 26 Oct: the agent does whatever it is asked), and Stop is never blocked
  const stop = await mc(socket, 'calibrate', '{"action":"cancel"}');
  assert.deepEqual([stop.code, stop.json.ok, stop.json.cancelled], [0, true, true]);
  assert.equal((await lastAction()).source, 'studio chat', 'recorded as the chat\'s');
  assert.equal((await lastAction()).words, 'Stopped the calibration from the studio chat', 'Recent and Last done say the chat stopped it (R8 #36: verified)');

  // the CLI's own refusals: unknown action, a body that is not a JSON object
  assert.equal((await mc(socket, 'shell', '{}')).code, 2);
  assert.equal((await mc(socket, 'ropes', '[1]')).code, 2);
  assert.equal((await mc(socket, 'ropes', 'not json')).code, 2);
  // the socket serves only its two routes, never the pages' API
  const raw = await new Promise((resolve) => {
    import('node:http').then(({ request }) => {
      const r = request({ socketPath: socket, path: '/api/status' }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve([res.statusCode, b])); });
      r.end();
    });
  });
  assert.equal(raw[0], 404);

  // gone when the server stops
  p.kill('SIGTERM');
  for (let i = 0; i < 100 && !exited; i++) await sleep(30);
  assert.equal(existsSync(socket), false);
  const gone = await mc(socket, 'status');
  assert.equal(gone.code, 2);
  assert.match(gone.json.error, /isn't answering/);
});

test('the agent gets the socket in its environment; the self-update waits for nothing in flight and an idle chat', () => {
  const env = agentEnv({ PATH: '/bin' }, { token: 'NOT-A-REAL-TOKEN', controlSocket: '/Users/river/mission-state/mc.sock' });
  assert.deepEqual(env, { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'NOT-A-REAL-TOKEN', MISSION_CONTROL_SOCKET: '/Users/river/mission-state/mc.sock' });
  let tree = 'a', quiet = false, exits = 0;
  const u = new SelfUpdate({ boot: 'a', tree: () => tree, quiet: () => quiet, exit: () => { exits++; }, log: () => {} });
  assert.equal(u.check(), false);
  assert.equal(u.maybeRestart(), false, 'nothing new');
  tree = 'b';
  assert.equal(u.check(), true);
  assert.equal(u.maybeRestart(), false, 'something in flight (or the chat busy): wait');
  assert.equal(exits, 0);
  quiet = true;
  assert.equal(u.maybeRestart(), true);
  assert.equal(exits, 1);
  const none = new SelfUpdate({ boot: null, tree: () => 'b', quiet: () => true, exit: () => { exits++; }, log: () => {} });
  assert.equal(none.check(), false, 'not a git checkout: never restarts');
});

test('code review: a second server on the same state folder never takes the live one\'s control socket, and leaves it in place when it exits', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mc2-'));
  writeFileSync(join(dir, 'pw'), 'NOT-A-REAL-PW\n');
  const state = join(dir, 'state'), socket = join(state, 'mc.sock');
  const env = { MISSION_PORT: '0', MISSION_STATE_DIR: state, MISSION_PASSWORD_FILE: join(dir, 'pw'), MISSION_FIXTURES: FIXTURES, MISSION_FAKE_AGENT: '1' };
  const a = await startServer(env);
  t.after(() => a.p.kill());
  await sleep(300);
  assert.equal((await mc(socket, 'status')).code, 0, 'the first server answers on its socket');
  const b = await startServer(env);
  await sleep(1500);
  assert.match(b.log(), /another mission control answers on it/);
  b.p.kill('SIGTERM'); await sleep(800);
  assert.equal((await mc(socket, 'status')).code, 0, 'still the first server\'s socket after the second one exits');
});
