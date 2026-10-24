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
  await m.control('bootfile', { file: 'river-online-oct-20.toe' });
  await m.control('switch', { file: 'river-local-oct-18.toe' });
  await m.control('lightsroute', { route: 'router' });
  assert.deepEqual(calls.map((c) => c.path), ['/mode', '/target']);
  assert.deepEqual(calls[1].body, { season: 'summer', intensity: 0.8 });
  assert.deepEqual(probes, ['-Action ropes -Dark', '-Action hub75 -Brightness 0.50', '-Action bootfile -BootFile river-online-oct-20.toe', '-Action switch -BootFile river-local-oct-18.toe', '-Action lightsroute -LightsRoute router']);
  for (const [a, b] of [['mode', { mode: 'chaos' }], ['target', { season: 'monsoon' }], ['hub75', { brightness: 3 }],
                        ['bootfile', { file: 'evil.toe; rm -rf' }], ['lightsroute', { route: 'both' }], ['rules', { rules: { 'x; y': 1 } }], ['shell', {}]]) {
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

test('only one rebuild, switch or boot-file change at a time: a second answers 409 while the first runs', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  const m = new Mission({ probe: async (_h, args) => { calls.push(args); if (/rebuild/.test(args)) await gate; return { ok: true, td: {} }; } });
  const first = m.control('rebuild', { file: 'river-local-oct-22-seasons.toe' });
  await assert.rejects(m.control('rebuild', { file: 'river-local-oct-22-seasons.toe' }), (e) => e.status === 409 && /already running/.test(e.message));
  await assert.rejects(m.control('switch', { file: 'river-online-oct-23.toe' }), (e) => e.status === 409);
  assert.equal((await m.control('ropes', { dark: false })).ok, true, 'the ropes are not held up by it');
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
