import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Mission } from '../lib/mission.mjs';

function fakeSeasons() {
  const calls = [];
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      calls.push({ path: req.url, body: b ? JSON.parse(b) : null });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ season: 'winter', mode: 'automatic', phase: 0.1 }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` })));
}

test('controls are fixed actions with checked arguments', async () => {
  const { srv, calls, url } = await fakeSeasons();
  const probes = [];
  const m = new Mission({ seasonsUrl: url, probe: async (_h, args) => { probes.push(args); return { ok: true, td: {} }; } });
  await m.control('mode', { mode: 'manual' });
  await m.control('target', { season: 'summer', intensity: 0.8 });
  await m.control('ropes', { dark: true });
  await m.control('hub75', { brightness: 0.5 });
  await m.control('bootfile', { file: 'river-online-oct-23.toe' });
  await m.control('switch', { file: 'river-local-oct-22-seasons.toe' });
  await m.control('lightsroute', { route: 'router' });
  assert.deepEqual(calls.map((c) => c.path), ['/mode', '/target']);
  assert.deepEqual(calls[1].body, { season: 'summer', intensity: 0.8 });
  assert.deepEqual(probes, ['-Action ropes -Dark', '-Action hub75 -Brightness 0.50', '-Action bootfile -BootFile river-online-oct-23.toe', '-Action switch -BootFile river-local-oct-22-seasons.toe', '-Action lightsroute -LightsRoute router']);
  for (const [a, b] of [['mode', { mode: 'chaos' }], ['target', { season: 'monsoon' }], ['hub75', { brightness: 3 }],
                        ['bootfile', { file: 'evil.toe; rm -rf' }], ['bootfile', { file: 'old-river-online-oct-20.toe' }], ['switch', { file: 'river-online-oct-20.toe' }], ['lightsroute', { route: 'both' }], ['rules', { rules: { 'x; y': 1 } }], ['shell', {}]]) {
    await assert.rejects(m.control(a, b), (e) => e.status === 400, a);
  }
  srv.close();
});

test('status: seasons state and probe results land in the snapshot with ages', async () => {
  const { srv, url } = await fakeSeasons();
  const m = new Mission({ seasonsUrl: url, bitcubeHost: '127.0.0.1',
                          probe: async () => ({ ok: true, td: { file: 'river-local-oct-22-seasons.toe', fps: 60 } }) });
  await m.pollFast(); await m.pollProbe();
  const s = m.snapshot();
  assert.equal(s.seasons.value.season, 'winter');
  assert.equal(s.probe.value.td.fps, 60);
  assert.equal(typeof s.seasons.age_s, 'number');
  srv.close();
});

test('camera stills are cached and fetched one at a time', async () => {
  let calls = 0;
  const m = new Mission({ snap: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return Buffer.from('jpeg'); } });
  const [a, b] = await Promise.all([m.camera('gallery'), m.camera('gallery')]);
  assert.equal(calls, 1); assert.equal(a.jpeg.toString(), 'jpeg'); assert.equal(b.jpeg.toString(), 'jpeg');
  await m.camera('gallery'); assert.equal(calls, 1);
  await assert.rejects(m.camera('../etc'), (e) => e.status === 400);
});

test('a ropes or panels action that TouchDesigner did not carry out is a failure, whatever the probe said on top', async () => {
  const m = new Mission({ probe: async () => ({ ok: true, td: { ok: false, error: 'no answer from the TD bridge' } }) });
  const r = await m.control('ropes', { dark: true });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no answer from the TD bridge');
  const ok = new Mission({ probe: async () => ({ ok: true, td: { ok: true } }) });
  assert.equal((await ok.control('hub75', { brightness: 0.5 })).ok, true);
  // other actions are judged by their own ok (a switch's td says "restarting", which is not a failure)
  const sw = new Mission({ probe: async () => ({ ok: true, td: { ok: false, error: 'restarting on river-local-oct-22-seasons.toe' } }) });
  assert.equal((await sw.control('switch', { file: 'river-local-oct-22-seasons.toe' })).ok, true);
});

test('only one rebuild, switch or boot-file change at a time: a second answers 409 "wait: ..." while the first runs', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  const m = new Mission({ probe: async (_h, args) => { calls.push(args); if (/rebuild/.test(args)) await gate; return { ok: true, td: {} }; } });
  const first = m.control('rebuild', { file: 'river-local-oct-22-seasons.toe' });
  await assert.rejects(m.control('rebuild', { file: 'river-local-oct-22-seasons.toe' }), (e) => e.status === 409 && /^wait: a rebuild of the river's year is being applied \(started \d\d:\d\d\)$/.test(e.message));
  await assert.rejects(m.control('switch', { file: 'river-online-oct-23.toe' }), (e) => e.status === 409);
  await assert.rejects(m.control('ropes', { dark: false }), (e) => e.status === 409, 'a rebuild ends in a restart: nothing touches TouchDesigner meanwhile');
  release();
  assert.equal((await first).ok, true);
  assert.equal((await m.control('switch', { file: 'river-online-oct-23.toe' })).ok, true, 'free again once it ended');
  assert.equal(calls.filter((a) => /rebuild/.test(a)).length, 1);
});

test("a failing full check keeps when it started failing, so 'failing for' grows", async () => {
  let t = 1_000_000, fail = false;
  const m = new Mission({ now: () => t, probe: async () => (fail ? { ok: false, error: "can't reach bitcube over SSH" } : { ok: true, td: {} }) });
  await m.pollProbe();
  fail = true; t += 60_000; await m.pollProbe();
  const first = m.snapshot().probe;
  assert.equal(first.failing_since, 1_060_000);
  t += 60_000; await m.pollProbe();
  t += 60_000; await m.pollProbe();
  const s = m.snapshot().probe;
  assert.deepEqual([s.at, s.failing_since, s.age_s], [1_180_000, 1_060_000, 0]);
  fail = false; t += 60_000; await m.pollProbe();
  assert.equal(m.snapshot().probe.failing_since, undefined, 'a good check clears it');
});

test('never a login in the snapshot (an ffmpeg line in a probe error or value); while a calibration runs, the controls that would spoil it answer 409', async () => {
  const PW = 'rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_main';
  let value = { ok: true, td: {}, calibration: { running: true, stage: 'ropes-capture', log: [`Error opening input file ${PW}.`] } };
  const probes = [];
  const m = new Mission({ probe: async (_h, args) => { if (args) probes.push(args); return value; } });
  await m.pollProbe();
  const snap = JSON.stringify(m.snapshot());
  assert.doesNotMatch(snap, /NOT-A-REAL-PW|admin:/);
  assert.match(snap, /rtsp:\/\/\*\*\*@192\.168\.9\.76/);
  for (const [action, body] of [['ropes', { dark: true }], ['hub75', { brightness: 0.5 }], ['switch', { file: 'river-local-oct-22-seasons.toe' }], ['lightsroute', { route: 'direct' }], ['rebuild', { file: 'river-local-oct-22-seasons.toe' }]]) {
    await assert.rejects(m.control(action, body), (e) => e.status === 409 && /calibration is running/.test(e.message), action);
  }
  assert.deepEqual(probes, [], 'nothing reached bitcube');
  // a stale run (its process is gone) or a finished one blocks nothing
  value = { ok: true, td: {}, calibration: { running: true, stale: true } };
  await m.pollProbe();
  await m.control('ropes', { dark: false });
  assert.equal(probes.length, 1);
  // an error string is scrubbed too
  const e = new Mission({ probe: async () => ({ ok: false, error: `probe failed: ${PW}` }) });
  await e.pollProbe();
  assert.doesNotMatch(JSON.stringify(e.snapshot()), /NOT-A-REAL-PW/);
});

test("a control's answer is scrubbed like the snapshot; a password holding @ or ' is all login", async () => {
  const { scrubCreds } = await import('../lib/scrub.mjs');
  assert.equal(scrubCreds('rtsp://admin:p@ss@10.0.0.1/x'), 'rtsp://***@10.0.0.1/x');
  assert.equal(scrubCreds("rtsp://admin:ab'cd@10.0.0.1:554/x"), 'rtsp://***@10.0.0.1:554/x');
  assert.equal(scrubCreds('rtsp://admin:pw@10.0.0.1?x=a@b'), 'rtsp://***@10.0.0.1?x=a@b');
  assert.equal(scrubCreds('see https://example.org/a@b and "x://h" "me@y"'), 'see https://example.org/a@b and "x://h" "me@y"');
  const PW = 'rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_main';
  const m = new Mission({ probe: async () => ({ ok: true, td: { ok: true }, modal_link: { gallery: { last: `12:00:00 INFO opening ${PW}` } }, recorder: { last: `failed ${PW}` } }) });
  const r = await m.control('ropes', { dark: false });
  assert.doesNotMatch(JSON.stringify(r), /NOT-A-REAL-PW|admin:/);
  assert.match(r.modal_link.gallery.last, /rtsp:\/\/\*\*\*@192\.168\.9\.76/);
});

// ---- applying a change (docs/mission-ui.md "Applying a change") -------------------------------------------------------
const AT_2104 = Date.UTC(2026, 9, 25, 4, 4, 30);       // 24 Oct 21:04:30 Pacific
const gated = () => { let release; const gate = new Promise((r) => { release = r; }); return { gate, release: (v) => release(v) }; };
const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const T0 = Math.round(Date.now() / 1000);              // a progress file's updated is bitcube's clock, unix seconds
function fakeLights({ start = null } = {}) {
  const calls = [];
  let status = { running: false, none: true };
  return { calls, set status(v) { status = v; },
           async calibrate(action, body) { calls.push([action, body]); return action === 'start' ? (start ?? { ok: true, started: true, calibration: { running: true, stage: null, updated: T0, started: T0 } }) : { ok: true, cancelled: true, forced: false, calibration: status }; },
           async calibration() { calls.push(['status']); return status; } };
}

test('every control in flight is in status.applying (label in team words, file, start on the server clock, usual time, what it blocks), and goes when its request ends', async () => {
  const g = gated();
  let t = AT_2104;
  const m = new Mission({ now: () => t, probe: async (_h, args) => { if (/switch/.test(args ?? '')) return g.gate; return { ok: true, td: { ok: true, file: YEAR } }; } });
  await m.pollProbe();
  assert.deepEqual(m.snapshot().applying, []);
  const sw = m.control('switch', { file: LIVE });
  const [e] = m.snapshot().applying;
  assert.deepEqual({ ...e, id: typeof e.id }, { id: 'string', action: 'switch', label: 'the switch to the live river', file: LIVE, started_at: AT_2104, expect_s: 60,
                                                blocks: ['ropes', 'hub75', 'mode', 'target', 'rules', 'rules-reset', 'lightsroute', 'switch', 'rebuild', 'bootfile', 'calibrate'] });
  t += 30_000;
  for (const [action, body] of [['ropes', { dark: true }], ['hub75', { brightness: 0.5 }], ['mode', { mode: 'manual' }], ['target', { season: 'summer' }], ['rules', { rules: { x: 1 } }],
                                ['rules-reset', {}], ['lightsroute', { route: 'router' }], ['switch', { file: YEAR }], ['rebuild', { file: YEAR }], ['bootfile', { file: YEAR }]]) {
    await assert.rejects(m.control(action, body), (err) => err.status === 409 && err.message === 'wait: the switch to the live river is being applied (started 21:04)', action);
  }
  g.release({ ok: false, error: 'no show file river-online-oct-23.toe on bitcube' });
  assert.equal((await sw).ok, false);
  assert.deepEqual(m.snapshot().applying, [], 'removed when it ended, a failure too');
  // a switch to the file that runs reads as the button does
  const g2 = gated();
  const m2 = new Mission({ probe: async (_h, args) => (args ? g2.gate : { ok: true, td: { ok: true, file: YEAR } }) });
  await m2.pollProbe();
  const r2 = m2.control('switch', { file: YEAR });
  assert.equal(m2.snapshot().applying[0].label, "the restart on the river's year");
  g2.release({ ok: true }); await r2;
});

test('what blocks what: a boot-file change, a lighting port change, and two phones changing one thing at once; a thrown request frees its lock too', async () => {
  const gates = {};
  const m = new Mission({ seasonsUrl: 'http://127.0.0.1:9', probe: async (_h, args) => { const a = /-Action (\w+)/.exec(args ?? '')?.[1]; if (a && gates[a]) return gates[a].gate; return { ok: true, td: { ok: true } }; } });
  gates.bootfile = gated();
  const bf = m.control('bootfile', { file: LIVE });
  assert.deepEqual(m.snapshot().applying.map((e) => [e.label, e.blocks]), [['the boot file change', ['switch', 'rebuild', 'bootfile', 'calibrate']]]);
  for (const [a, b] of [['switch', { file: LIVE }], ['rebuild', { file: YEAR }], ['bootfile', { file: YEAR }]]) await assert.rejects(m.control(a, b), (e) => e.status === 409 && /^wait: the boot file change is being applied/.test(e.message), a);
  assert.equal((await m.control('ropes', { dark: false })).ok, true, 'the ropes are not held up by it');
  gates.bootfile.release({ ok: true }); await bf;
  gates.lightsroute = gated();
  const lr = m.control('lightsroute', { route: 'router' });
  for (const [a, b] of [['ropes', { dark: true }], ['hub75', { brightness: 1 }], ['lightsroute', { route: 'direct' }]]) await assert.rejects(m.control(a, b), (e) => e.status === 409 && /^wait: a lighting port change/.test(e.message), a);
  gates.lightsroute.release({ ok: true }); await lr;
  gates.ropes = gated();
  const rp = m.control('ropes', { dark: true });
  await assert.rejects(m.control('ropes', { dark: false }), (e) => e.status === 409 && /^wait: a ropes change is being applied/.test(e.message));
  gates.hub75 = gated();
  const hb = m.control('hub75', { brightness: 0.4 });
  assert.deepEqual(m.snapshot().applying.map((e) => [e.action, e.label, e.expect_s]), [['ropes', 'a ropes change', 15], ['hub75', 'a panels change', 15]]);
  gates.ropes.release({ ok: true }); gates.hub75.release({ ok: true }); await rp; await hb;
  // a seasons change that throws (the page didn't answer) frees its lock as surely as one that answers
  await assert.rejects(m.control('mode', { mode: 'manual' }));
  assert.deepEqual(m.snapshot().applying, []);
});

test('a calibration cannot start while a switch, rebuild or boot-file change is in flight; Stop always gets through', async () => {
  for (const [action, body] of [['switch', { file: LIVE }], ['rebuild', { file: YEAR }], ['bootfile', { file: LIVE }]]) {
    const g = gated(), lights = fakeLights();
    const m = new Mission({ lights, probe: async (_h, args) => (args ? g.gate : { ok: true, td: { ok: true, file: YEAR } }) });
    const p = m.control(action, body);
    await assert.rejects(m.calibrate('start', {}), (e) => e.status === 409 && /^wait: /.test(e.message), action);
    assert.deepEqual(lights.calls, [], 'nothing reached bitcube');
    assert.equal((await m.calibrate('cancel', {})).cancelled, true, 'Stop is never held up');
    g.release({ ok: true }); await p;
    assert.equal((await m.calibrate('start', {})).started, true);
  }
  // and while a calibration is starting, what a run blocks waits for it
  const g = gated();
  const m = new Mission({ lights: { calibrate: () => g.gate }, probe: async () => ({ ok: true, td: { ok: true } }) });
  const st = m.calibrate('start', {});
  assert.deepEqual(m.snapshot().applying.map((e) => [e.action, e.label]), [['calibrate', 'the start of a calibration']]);
  await assert.rejects(m.control('switch', { file: LIVE }), (e) => e.status === 409 && /^wait: the start of a calibration/.test(e.message));
  g.release({ ok: false, error: 'TouchDesigner is not running' }); await st;
  assert.deepEqual(m.snapshot().applying, []);
});

test('the calibration lock holds from the first second: a started run is taken from Lights\' own answer at once, on the server and in the snapshot', async () => {
  const lights = fakeLights();
  const probes = [];
  let probeCal = null;
  const m = new Mission({ lights, probe: async (_h, args) => { if (args) probes.push(args); return { ok: true, td: { ok: true, file: YEAR }, calibration: probeCal }; } });
  await m.pollProbe();                                   // the full check ran just before the start: no run in it
  assert.equal((await m.calibrate('start', {})).started, true);
  assert.equal(m.snapshot().probe.value.calibration.running, true, '/api/status shows the run at once');
  for (const [action, body] of [['ropes', { dark: true }], ['hub75', { brightness: 0 }], ['switch', { file: LIVE }], ['rebuild', { file: YEAR }], ['lightsroute', { route: 'router' }]]) {
    await assert.rejects(m.control(action, body), (e) => e.status === 409 && /calibration is running/.test(e.message), action);
  }
  assert.deepEqual(probes, [], 'nothing reached bitcube');
  // a full check from before the start (an older progress file) never undoes it
  probeCal = null; await m.pollProbe();
  assert.equal(m.snapshot().probe.value.calibration.running, true);
  // a newer full check wins (the run moved on)
  probeCal = { running: true, stage: 'ropes-capture', updated: T0 + 30, alive: true }; await m.pollProbe();
  assert.equal(m.snapshot().probe.value.calibration.stage, 'ropes-capture');
  // the run ends: the next progress read frees the controls at once, not a minute later
  lights.status = { running: false, ok: true, stage: 'done', updated: T0 + 100, alive: false };
  await m.calibrationStatus();
  assert.equal(m.snapshot().probe.value.calibration.running, false);
  assert.equal((await m.control('ropes', { dark: false })).ok, true);
  // while a run is on, the server reads its progress itself (every 5 s from start()), so the lock ends with the run even with no page open
  lights.status = { running: true, stage: 'ropes-decode', updated: T0 + 200, alive: true };
  await m.calibrationStatus();
  lights.status = { running: true, stale: true, stage: 'ropes-decode', updated: T0 + 200, alive: false };
  await m.pollCalibration();
  assert.equal(m.snapshot().probe.value.calibration.stale, true);
  assert.equal((await m.control('ropes', { dark: false })).ok, true, 'a run whose process is gone blocks nothing');
  // a progress read that failed changes nothing
  lights.status = { ok: false, error: "can't reach bitcube over SSH" };
  await m.calibrationStatus();
  assert.equal(m.snapshot().probe.value.calibration.stale, true);
});

test('a successful rebuild is recorded, kept in the state folder across a restart, and names the map baked in; a failed one is not', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'mission-rebuilt-'));
  let t = AT_2104, answer = { ok: false, error: 'the rebuild failed inside TouchDesigner (see td.ps1); nothing was saved', rebuilt: false, saved: false, switched: false, td: { ok: true } };
  const m = new Mission({ stateDir: dir, now: () => t, probe: async () => answer });
  assert.equal(m.rebuilt(), null);
  await m.control('rebuild', { file: YEAR });
  assert.equal(m.rebuilt(), null, 'a failed rebuild is not a map in use');
  answer = { ok: true, rebuilt: true, saved: true, switched: true, td: { ok: false, error: `restarting on ${YEAR}` }, pixelmap: { file: 'pixelmap-2026-10-25.json' } };
  t += 60_000;
  await m.control('rebuild', { file: YEAR });
  assert.deepEqual(m.rebuilt(), { at: AT_2104 + 60_000, map: 'pixelmap-2026-10-25.json', file: YEAR });
  assert.deepEqual(new Mission({ stateDir: dir }).rebuilt(), { at: AT_2104 + 60_000, map: 'pixelmap-2026-10-25.json', file: YEAR }, 'kept across a restart');
  // without the map in the answer: the finished calibration's map
  const lights = fakeLights({ start: { ok: true, started: true, calibration: { running: false, ok: true, stage: 'done', updated: T0, result: { map: 'pixelmap-2026-10-24.json' } } } });
  const m2 = new Mission({ lights, probe: async () => ({ ok: true, rebuilt: true, saved: true, td: {} }) });
  await m2.calibrate('start', {});
  await m2.control('rebuild', { file: YEAR });
  assert.equal(m2.rebuilt().map, 'pixelmap-2026-10-24.json');
});
