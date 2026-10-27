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
  // as probe.ps1: its answer reads the boot file back after setting it (an answer that doesn't show it waits for a full check, R8 #32)
  const m = new Mission({ seasonsUrl: url, probe: async (_h, args) => { probes.push(args); const bf = /-Action bootfile -BootFile (\S+)/.exec(args ?? '')?.[1]; return { ok: true, td: {}, ...(bf ? { boot_file: bf } : {}) }; }, later: () => {} });
  await m.control('mode', { mode: 'manual' });
  await m.control('target', { season: 'summer', intensity: 0.8 });
  await m.control('ropes', { dark: true });
  await m.control('hub75', { brightness: 0.5 });
  await m.control('bootfile', { file: 'river-online-oct-23.toe' });
  await m.control('lightsroute', { route: 'router' });
  await m.control('switch', { file: 'river-local-oct-22-seasons.toe' });     // last: it holds its lock until TouchDesigner answers on the file
  assert.deepEqual(calls.map((c) => c.path), ['/mode', '/target']);
  assert.deepEqual(calls[1].body, { season: 'summer', intensity: 0.8 });
  assert.deepEqual(probes, ['-Action ropes -Dark', '-Action hub75 -Brightness 0.50', '-Action bootfile -BootFile river-online-oct-23.toe', '-Action lightsroute -LightsRoute router', '-Action switch -BootFile river-local-oct-22-seasons.toe']);
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
  let td = { ok: false, error: 'restarting on river-local-oct-22-seasons.toe' };
  const m = new Mission({ probe: async (_h, args) => { if (args) calls.push(args); if (/rebuild/.test(args)) await gate; return { ok: true, td }; }, later: () => {} });
  const first = m.control('rebuild', { file: 'river-local-oct-22-seasons.toe' });
  await assert.rejects(m.control('rebuild', { file: 'river-local-oct-22-seasons.toe' }), (e) => e.status === 409 && /^wait: the rebuild of the river's year is being applied \(started \d\d:\d\d\)$/.test(e.message));
  await assert.rejects(m.control('switch', { file: 'river-online-oct-23.toe' }), (e) => e.status === 409);
  await assert.rejects(m.control('ropes', { dark: false }), (e) => e.status === 409, 'a rebuild ends in a restart: nothing touches TouchDesigner meanwhile');
  release();
  assert.equal((await first).ok, true);
  await assert.rejects(m.control('switch', { file: 'river-online-oct-23.toe' }), (e) => e.status === 409, 'still confirming: TouchDesigner is opening the file');
  td = { ok: true, file: 'river-local-oct-22-seasons.toe', fps: 60 };
  await m.pollProbe();
  assert.equal((await m.control('switch', { file: 'river-online-oct-23.toe' })).ok, true, 'free again once the full check shows it');
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
  assert.deepEqual({ ...e, id: typeof e.id }, { id: 'string', action: 'switch', label: 'the switch to the live river', file: LIVE, source: 'mission control', phase: 'applying',
                                                started_at: AT_2104, expect_s: 60, blocks: ['overlay', 'ropes', 'hub75', 'test', 'mode', 'target', 'rules', 'rules-reset', 'lightsroute', 'switch', 'rebuild', 'bootfile', 'calibrate'] });
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
  assert.deepEqual(m.snapshot().applying.map((e) => [e.label, e.blocks]), [['the change of the default to the live river', ['switch', 'rebuild', 'bootfile', 'calibrate']]]);
  for (const [a, b] of [['switch', { file: LIVE }], ['rebuild', { file: YEAR }], ['bootfile', { file: YEAR }]]) await assert.rejects(m.control(a, b), (e) => e.status === 409 && /^wait: the change of the default to the live river is being applied/.test(e.message), a);
  assert.equal((await m.control('ropes', { dark: false })).ok, true, 'the ropes are not held up by it');
  gates.bootfile.release({ ok: true, boot_file: LIVE }); await bf;     // as probe.ps1, the answer reads the boot file back (R8 #32)
  gates.lightsroute = gated();
  const lr = m.control('lightsroute', { route: 'router' });
  for (const [a, b] of [['ropes', { dark: true }], ['hub75', { brightness: 1 }], ['lightsroute', { route: 'direct' }]]) await assert.rejects(m.control(a, b), (e) => e.status === 409 && /^wait: the change of the lighting port to the spare router port/.test(e.message), a);
  gates.lightsroute.release({ ok: true }); await lr;
  gates.ropes = gated();
  const rp = m.control('ropes', { dark: true });
  await assert.rejects(m.control('ropes', { dark: false }), (e) => e.status === 409 && /^wait: the change of the ropes to dark is being applied/.test(e.message));
  gates.hub75 = gated();
  const hb = m.control('hub75', { brightness: 0.4 });
  assert.deepEqual(m.snapshot().applying.map((e) => [e.action, e.label, e.expect_s]), [['ropes', 'the change of the ropes to dark', 15], ['hub75', 'the change of the panels to 40 %', 15]]);
  gates.ropes.release({ ok: true }); gates.hub75.release({ ok: true }); await rp; await hb;
  // a seasons change that throws (the page didn't answer) frees its lock as surely as one that answers
  await assert.rejects(m.control('mode', { mode: 'manual' }));
  assert.deepEqual(m.snapshot().applying, []);
});

test('a calibration cannot start while a switch, rebuild or boot-file change is in flight; Stop always gets through', async () => {
  for (const [action, body] of [['switch', { file: LIVE }], ['rebuild', { file: YEAR }], ['bootfile', { file: LIVE }]]) {
    const g = gated(), lights = fakeLights();
    let file = YEAR;
    const m = new Mission({ lights, probe: async (_h, args) => (args ? g.gate : { ok: true, td: { ok: true, file } }), later: () => {} });
    await m.pollProbe();
    const p = m.control(action, body);
    await assert.rejects(m.calibrate('start', {}), (e) => e.status === 409 && /^wait: /.test(e.message), action);
    assert.deepEqual(lights.calls, [], 'nothing reached bitcube');
    assert.equal((await m.calibrate('cancel', {})).cancelled, true, 'Stop is never held up');
    g.release({ ok: true, rebuilt: true, saved: true, boot_file: body.file }); await p;   // a boot file the answer shows (R8 #32)
    file = body.file; await m.pollProbe();               // a switch or rebuild holds until TouchDesigner answers on its file
    assert.equal((await m.calibrate('start', {})).started, true);
  }
  // and while a calibration is starting, what a run blocks waits for it
  const g = gated();
  const m = new Mission({ lights: { calibrate: () => g.gate }, probe: async () => ({ ok: true, td: { ok: true } }) });
  const st = m.calibrate('start', {});
  assert.deepEqual(m.snapshot().applying.map((e) => [e.action, e.label]), [['calibrate', 'the calibration start']]);
  await assert.rejects(m.control('switch', { file: LIVE }), (e) => e.status === 409 && /^wait: the calibration start/.test(e.message));
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
  // a progress read that failed, or one that finds no job, changes nothing
  for (const nothing of [{ ok: false, error: "can't reach bitcube over SSH" }, { running: false, none: true }]) {
    lights.status = nothing;
    await m.calibrationStatus();
    assert.equal(m.snapshot().probe.value.calibration.stale, true, JSON.stringify(nothing));
  }
  // a start answer without its updated stamp still holds the lock at once (it counts as now)
  const bare = new Mission({ lights: fakeLights({ start: { ok: true, started: true, calibration: { running: true } } }), probe: async () => ({ ok: true, td: { ok: true }, calibration: null }) });
  await bare.pollProbe();
  await bare.calibrate('start', {});
  await assert.rejects(bare.control('switch', { file: LIVE }), (e) => e.status === 409 && /calibration is running/.test(e.message));
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
  assert.equal(m.rebuilt(), null, 'TouchDesigner is still restarting on it: recorded once it is confirmed (R7 #26)');
  answer = { ok: true, td: { ok: true, file: YEAR } };
  t += 30_000; await m.pollProbe();
  assert.deepEqual(m.rebuilt(), { at: AT_2104 + 90_000, map: 'pixelmap-2026-10-25.json', file: YEAR, run: null }, 'no finished run with this map: no run named');
  assert.deepEqual(new Mission({ stateDir: dir }).rebuilt(), { at: AT_2104 + 90_000, map: 'pixelmap-2026-10-25.json', file: YEAR, run: null }, 'kept across a restart');
  // without the map in the answer: the finished calibration's map
  const lights = fakeLights();
  lights.status = { running: false, ok: true, stage: 'done', started: T0 - 300, updated: T0, result: { map: 'pixelmap-2026-10-24.json' } };
  const m2 = new Mission({ lights, probe: async (_h, args) => (args ? { ok: true, rebuilt: true, saved: true, td: {} } : { ok: true, td: { ok: true, file: YEAR } }), later: () => {} });
  await m2.calibrationStatus();
  await m2.control('rebuild', { file: YEAR });
  await m2.pollProbe();
  assert.equal(m2.rebuilt().map, 'pixelmap-2026-10-24.json');
  assert.equal(m2.rebuilt().run, T0 - 300, 'the run baked in, by its own started stamp (bitcube\'s clock)');
});

test('code review: the lock holds both ways (a switch waits for a ropes change in flight; a boot-file change for a calibration start)', async () => {
  const g = gated();
  const m = new Mission({ probe: async (_h, args) => (/-Action ropes/.test(args ?? '') ? g.gate : { ok: true, td: { ok: true, file: YEAR } }) });
  await m.pollProbe();
  const ropes = m.control('ropes', { dark: true });
  await assert.rejects(m.control('switch', { file: LIVE }), (e) => e.status === 409 && /^wait: the change of the ropes to dark is being applied/.test(e.message));
  g.release({ ok: true, td: { ok: true, file: YEAR } }); await ropes;
  const g2 = gated();
  const lights = fakeLights(); lights.calibrate = async () => g2.gate;
  const m2 = new Mission({ lights, probe: async () => ({ ok: true, td: { ok: true, file: YEAR } }) });
  await m2.pollProbe();
  const start = m2.calibrate('start', {});
  await assert.rejects(m2.control('bootfile', { file: LIVE }), (e) => e.status === 409 && /^wait: the calibration start/.test(e.message));
  g2.release({ ok: true, started: true, calibration: { running: true, stage: null, updated: T0, started: T0 } }); await start;
});

test('code review: a "no job" answer ends a kept run once the start is past (no 24 h lock from a progress file that is gone)', async () => {
  let t = T0 * 1000;
  const lights = fakeLights();
  const m = new Mission({ lights, now: () => t, probe: async () => ({ ok: true, td: { ok: true, file: YEAR } }) });
  await m.pollProbe();
  await m.calibrate('start', {});
  t += 5_000; lights.status = { running: false, none: true }; await m.calibrationStatus();
  assert.equal(m.calibration()?.running, true, 'just after a start the file may not be written yet: the lock stays');
  t += 60_000; await m.calibrationStatus();
  assert.notEqual(m.calibration()?.running, true, 'a minute on, "no job" means the run is gone');
  assert.equal((await m.control('ropes', { dark: false })).ok, true);
});

// ---- round 6 -------------------------------------------------------------------------------------------------------------
/** A Mission whose clock, follow-up timers and full check the test drives: probe(args) answers an action; `reading` the check. */
function driven({ action = async () => ({ ok: true }), lights = null } = {}) {
  const ctx = { t: AT_2104, timers: [], reading: { ok: true, td: { ok: true, file: YEAR, fps: 60 } } };
  ctx.m = new Mission({ now: () => ctx.t, lights, later: (fn, ms) => ctx.timers.push({ fn, ms }),
                        probe: async (_h, args) => (args ? action(args) : ctx.reading) });
  ctx.fire = async () => { const due = ctx.timers.splice(0); for (const x of due) await x.fn(); return due.map((x) => x.ms); };
  return ctx;
}

test('round 6 #26: a switch that answered stays in status.applying as "confirming" until the full check shows TouchDesigner on the file, and keeps blocking a second switch', async () => {
  const restarting = { ok: false, error: `restarting on ${LIVE}` };
  const c = driven({ action: async (args) => (/switch/.test(args) ? { ok: true, switched_to: LIVE, td: restarting } : { ok: true, td: { ok: true, file: LIVE } }), lights: fakeLights() });
  await c.m.pollProbe();
  // a full check already on its way when the switch answers can't confirm it (it was asked before)
  let releaseOld; const old = new Promise((r) => { releaseOld = r; });
  const before = new Mission({ now: () => c.t, later: () => {}, probe: async (_h, args) => (args ? { ok: true, td: restarting } : old) });
  const early = before.pollProbe();
  c.t += 1000;
  assert.equal((await before.control('switch', { file: LIVE })).ok, true);
  releaseOld({ ok: true, td: { ok: true, file: LIVE } }); await early;
  assert.deepEqual(before.snapshot().applying.map((e) => e.phase), ['confirming'], 'a check asked before the answer knows nothing of it');

  c.t += 5000;
  const r = await c.m.control('switch', { file: LIVE });
  assert.equal(r.ok, true);
  const [e] = c.m.snapshot().applying;
  assert.deepEqual([e.action, e.phase, e.file, e.label, e.source, e.started_at, e.answered_at, e.maybe], ['switch', 'confirming', LIVE, 'the switch to the live river', 'mission control', c.t, c.t, undefined]);
  // the next full check comes sooner than its 60 s timer: at 15 s and 45 s
  assert.deepEqual(c.timers.map((x) => x.ms), [15_000, 45_000]);
  for (const [action, body] of [['switch', { file: YEAR }], ['rebuild', { file: YEAR }], ['ropes', { dark: true }], ['mode', { mode: 'manual' }], ['calibrate', null]]) {
    const p = action === 'calibrate' ? c.m.calibrate('start', {}) : c.m.control(action, body);
    await assert.rejects(p, (err) => err.status === 409 && /^wait: the switch to the live river is being applied \(started 21:04\)$/.test(err.message), action);
  }
  // TouchDesigner not up yet, then still loading (no answer from its bridge): still confirming
  c.t += 15_000; c.reading = { ok: true, td: { ok: false, error: 'TouchDesigner is not running' } };
  await c.timers.shift().fn();
  c.t += 10_000; c.reading = { ok: true, td: { ok: false, error: 'no answer from the TD bridge' } };
  await c.m.pollProbe();
  assert.deepEqual(c.m.snapshot().applying.map((x) => x.phase), ['confirming']);
  // answering on another file is not this switch done
  c.reading = { ok: true, td: { ok: true, file: YEAR, fps: 60 } }; await c.m.pollProbe();
  assert.equal(c.m.snapshot().applying.length, 1);
  // answering on the file: done, and the controls are free
  c.t += 20_000; c.reading = { ok: true, td: { ok: true, file: LIVE, fps: null } };
  await c.timers.shift().fn();
  assert.deepEqual(c.m.snapshot().applying, []);
  assert.equal((await c.m.control('ropes', { dark: false })).ok, true);
});

test('round 6 #26: a rebuild that went all the way confirms the same way; one that never shows is dropped at its confirm limit (3 x usual, at least 2 min)', async () => {
  const c = driven({ action: async (args) => (/rebuild/.test(args) ? { ok: true, rebuilt: true, saved: true, switched: true, td: { ok: false, error: `restarting on ${YEAR}` } } : { ok: true, td: { ok: true, file: YEAR } }) });
  await c.m.pollProbe();
  await c.m.control('rebuild', { file: YEAR });
  assert.deepEqual(c.m.snapshot().applying.map((e) => [e.action, e.phase, e.file]), [['rebuild', 'confirming', YEAR]]);
  c.t += 30_000; await c.m.pollProbe();
  assert.deepEqual(c.m.snapshot().applying, [], 'TouchDesigner answers on the river\'s year: the rebuild is real');
  // a switch whose file never shows: unconfirmed after max(3 x 60, 120) = 180 s from its start; the lock goes with it
  c.reading = { ok: true, td: { ok: false, error: 'no answer from the TD bridge' } };
  await c.m.control('switch', { file: YEAR });
  c.t += 179_000;
  await assert.rejects(c.m.control('switch', { file: YEAR }), (e) => e.status === 409);
  c.t += 2_000;
  assert.deepEqual(c.m.snapshot().applying, []);
  assert.equal((await c.m.control('switch', { file: YEAR })).ok, true);
  // a refused switch or a rebuild that stopped short (nothing restarted) ends at once, as before
  const f = driven({ action: async () => ({ ok: false, error: 'rebuilt, but the save failed: not restarting', rebuilt: true, saved: false }) });
  await f.m.control('rebuild', { file: YEAR });
  assert.deepEqual([f.m.snapshot().applying, f.timers], [[], []]);
});

test('round 6 #32: a call killed for time, or one that ended without a word, is "maybe" (it may have happened); one that never connected is not', async () => {
  const { sshProbe } = await import('../lib/mission.mjs');
  const { sshJson } = await import('../lib/lights.mjs');
  const exec = (err, stdout = '') => (_c, _a, _o, cb) => cb(err, stdout);
  const killed = Object.assign(new Error('killed'), { killed: true, code: null });
  assert.deepEqual(await sshProbe('h', '-Action switch', 1000, { exec: exec(killed) }), { ok: false, maybe: true, error: 'bitcube took too long to answer' });
  assert.deepEqual(await sshProbe('h', '', 1000, { exec: exec(null, 'garbage\n') }), { ok: false, maybe: true, error: 'no answer from the probe' });
  assert.deepEqual(await sshProbe('h', '', 1000, { exec: exec(Object.assign(new Error('x'), { code: 255 })) }), { ok: false, error: "can't reach bitcube over SSH" });
  assert.deepEqual(await sshProbe('h', '', 1000, { exec: exec(Object.assign(new Error('x'), { code: 1 })) }), { ok: false, error: 'probe failed (exit 1)' });
  assert.deepEqual(await sshJson('h', 'calibrate.ps1', '-Action start', { exec: exec(killed) }), { ok: false, maybe: true, error: 'bitcube took too long to answer' });
  assert.deepEqual(await sshJson('h', 'calibrate.ps1', '', { exec: exec(Object.assign(new Error('x'), { code: 255 })) }), { ok: false, error: "can't reach bitcube over SSH" });
});

test('round 6 #32: a maybe answer keeps its lock until the confirm limit (bitcube may still be at it); a switch that timed out confirms when TouchDesigner shows the file', async () => {
  const c = driven({ action: async () => ({ ok: false, maybe: true, error: 'bitcube took too long to answer' }) });
  await c.m.pollProbe();
  const r = await c.m.control('ropes', { dark: true });
  assert.deepEqual(r, { ok: false, maybe: true, error: 'bitcube took too long to answer', applying_id: r.applying_id });
  // a quick change (ropes, panels, the year's controls) that may or may not have happened is no lock: the next reading says
  // which (code review of round 6: a 2 min lock on the mode for a slow page was worse than the doubt)
  assert.deepEqual(c.m.snapshot().applying, []);
  // a switch that timed out: done as soon as TouchDesigner answers on its file
  await c.m.control('switch', { file: LIVE });
  assert.deepEqual(c.m.snapshot().applying.map((e) => [e.action, e.phase, e.maybe]), [['switch', 'confirming', true]]);
  c.t += 20_000; c.reading = { ok: true, td: { ok: true, file: LIVE } }; await c.m.pollProbe();
  assert.deepEqual(c.m.snapshot().applying, []);
  // the river's year page: no answer in time is maybe; a page that answered no, or no page at all, is a plain failure
  const slow = createServer(() => {});              // takes the request, never answers
  await new Promise((ok) => slow.listen(0, '127.0.0.1', ok));
  const m = new Mission({ seasonsUrl: `http://127.0.0.1:${slow.address().port}`, seasonsTimeoutMs: 150, later: () => {} });
  try {
    const mr = await m.control('mode', { mode: 'manual' });
    assert.deepEqual(mr, { ok: false, maybe: true, error: "the river's year page took too long to answer", applying_id: mr.applying_id });
    assert.deepEqual(m.snapshot().applying, [], 'a quick change: no lock (the next reading of the page says which)');
  } finally { slow.closeAllConnections(); slow.close(); }
  const none = new Mission({ seasonsUrl: 'http://127.0.0.1:9', later: () => {} });
  await assert.rejects(none.control('mode', { mode: 'manual' }));
  assert.deepEqual(none.snapshot().applying, []);
});

test('round 6 #39: a calibration start that launched but has not reported holds a "starting" lock, read every 5 s, until the run shows up', async () => {
  const lights = fakeLights({ start: { ok: false, maybe: true, started: true, pid: 4242, requested: T0, error: "the calibration was launched but hasn't reported yet" } });
  lights.status = { running: false, ok: true, stage: 'done', started: T0 - 3000, updated: T0 - 2700 };      // the run before
  const c = driven({ lights });
  await c.m.pollProbe();
  await c.m.calibrationStatus();
  const r = await c.m.calibrate('start', {});
  assert.equal(r.maybe, true);
  assert.deepEqual(c.m.snapshot().applying.map((e) => [e.action, e.phase, e.label]), [['calibrate', 'confirming', 'the calibration start']]);
  for (const [action, body] of [['ropes', { dark: true }], ['switch', { file: LIVE }], ['rebuild', { file: YEAR }]]) {
    // a start bitcube didn't answer in full (maybe) says when its lock ends at the latest (R8 #17)
    await assert.rejects(c.m.control(action, body), (e) => e.status === 409 && /^wait: the calibration start got no answer from bitcube in time; it unlocks by \d\d:\d\d$/.test(e.message), action);
  }
  // the first reads still find the old run's file: the lock stays
  c.t += 5000; assert.deepEqual(await c.fire(), [5000]);
  assert.equal(c.m.snapshot().applying.length, 1);
  // the run's own first write: the run holds the lock from now on, and the start's own entry ends
  lights.status = { running: true, alive: true, stage: 'ropes-capture', started: T0 + 2, updated: T0 + 8 };
  c.t += 5000; await c.fire();
  assert.deepEqual(c.m.snapshot().applying, []);
  assert.equal(c.m.snapshot().probe.value.calibration.running, true);
  await assert.rejects(c.m.control('ropes', { dark: true }), (e) => e.status === 409 && /calibration is running/.test(e.message));
  assert.equal(c.timers.length, 0, 'no more reads');
});

test('round 6 #39: a clear refusal holds nothing; a start that never shows up frees the controls after about a minute', async () => {
  const refused = driven({ lights: fakeLights({ start: { ok: false, started: false, error: 'TouchDesigner is not running' } }) });
  await refused.m.calibrate('start', {});
  assert.deepEqual([refused.m.snapshot().applying, refused.timers], [[], []]);
  // an older calibrate.ps1's refusal (no started, no pid) is clear too; its slow-start answer ("did not report within 6 s",
  // the run before's file, no pid after the -Task launch) is not: the job may well be starting
  const older = driven({ lights: fakeLights({ start: { ok: false, error: 'a calibration is already running' } }) });
  await older.m.calibrate('start', {});
  assert.deepEqual(older.m.snapshot().applying, []);
  const slow = driven({ lights: fakeLights({ start: { ok: false, error: 'the job did not report within 6 s', calibration: { running: false, ok: true, started: AT_2104 / 1000 - 3700, updated: AT_2104 / 1000 - 3600 } } }) });
  await slow.m.calibrate('start', {});
  assert.deepEqual(slow.m.snapshot().applying.map((e) => [e.action, e.phase]), [['calibrate', 'confirming']]);
  await assert.rejects(slow.m.control('ropes', { dark: true }), (e) => e.status === 409);
  // the call itself timed out: maybe; no file ever comes
  const lights = fakeLights({ start: { ok: false, maybe: true, error: 'bitcube took too long to answer' } });
  const c = driven({ lights });
  await c.m.calibrate('start', {});
  let reads = 0;
  while (c.timers.length && reads < 20) { c.t += 5000; await c.fire(); reads++; }
  assert.equal(reads, 12, 'twelve reads, 5 s apart');
  assert.deepEqual(c.m.snapshot().applying, []);
  assert.equal((await c.m.control('ropes', { dark: true })).ok, true);
});

test('round 6 #40: only the checked fields of a request reach status.applying and bitcube', async () => {
  const c = driven({ lights: fakeLights(), action: async () => ({ ok: true, td: { ok: true, file: YEAR } }) });
  await c.m.pollProbe();
  const junk = '<img src=x onerror=alert(1)>'.repeat(100);
  const g = gated();
  c.m.lights.calibrate = async (action, body) => { c.sent = body; return g.gate; };
  const p = c.m.calibrate('start', { file: junk, note: 'rtsp://admin:NOT-A-REAL-PW@x/y', dry_run: true, cam: 'gallery' });
  const [e] = c.m.snapshot().applying;
  assert.equal(e.file, undefined, 'a calibration has no file');
  assert.doesNotMatch(JSON.stringify(c.m.snapshot().applying), /img|NOT-A-REAL-PW/);
  assert.deepEqual(c.sent, { action: 'start', dry_run: true, cam: 'gallery' });
  g.release({ ok: true, started: true, calibration: { running: true, started: T0 + 5, updated: T0 + 5 } }); await p;
  const { checkedControl } = await import('../lib/mission.mjs');
  const { checkedCalibrate } = await import('../lib/lights.mjs');
  assert.deepEqual(checkedControl('switch', { file: LIVE, extra: junk }), { file: LIVE });
  assert.deepEqual(checkedControl('ropes', { dark: false, x: 1 }), { dark: false });
  assert.throws(() => checkedControl('ropes', { dark: 'true' }), (e) => e.status === 400);       // R10 #37: refused, never "on"
  assert.deepEqual(checkedControl('target', { season: 'summer', intensity: '0.7', why: junk }), { season: 'summer', intensity: 0.7 });
  assert.deepEqual(checkedControl('rules', { rules: { cycle_seconds: '240' }, x: 1 }), { rules: { cycle_seconds: 240 } });
  assert.deepEqual(checkedControl('hub75', { brightness: '0.5', y: 2 }), { brightness: 0.5 });
  assert.deepEqual(checkedControl('rules-reset', { anything: junk }), {});
  assert.deepEqual(checkedCalibrate('cancel', { dry_run: true, x: 1 }), { action: 'cancel' });
  assert.deepEqual(checkedCalibrate('start', { dry_run: false, decode_only: 'pixelmap-20261018-154155', task: true }), { action: 'start', decode_only: 'pixelmap-20261018-154155', task: true });
  assert.throws(() => checkedCalibrate('start', { dry_run: 'yes' }), (e) => e.status === 400);    // R10 #37
  assert.throws(() => checkedControl('mode', { mode: 'chaos' }), (err) => err.status === 400);
  // a control's entry names its show file only for a switch, rebuild or boot-file change, and only a known one
  const g2 = gated();
  const m = new Mission({ later: () => {}, probe: async (_h, args) => (args ? g2.gate : { ok: true, td: { ok: true, file: YEAR } }) });
  const rp = m.control('ropes', { dark: true, file: junk });
  assert.equal(m.snapshot().applying[0].file, undefined);
  g2.release({ ok: true, td: { ok: true } }); await rp;
});

test('integration: a calibration copy from Lights is served with how long ago it was read (one time left on every page)', async () => {
  let t = T0 * 1000;
  const m = new Mission({ lights: fakeLights(), now: () => t, probe: async () => ({ ok: true, td: { ok: true, file: YEAR } }) });
  await m.pollProbe();
  await m.calibrate('start', {});
  t += 7_000;
  assert.equal(m.snapshot().probe.value.calibration.read_age_s, 7);
});
