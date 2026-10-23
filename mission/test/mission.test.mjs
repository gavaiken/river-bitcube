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
  assert.deepEqual(calls.map((c) => c.path), ['/mode', '/target']);
  assert.deepEqual(calls[1].body, { season: 'summer', intensity: 0.8 });
  assert.deepEqual(probes, ['-Action ropes -Dark', '-Action hub75 -Brightness 0.50', '-Action bootfile -BootFile river-online-oct-20.toe', '-Action switch -BootFile river-local-oct-18.toe']);
  for (const [a, b] of [['mode', { mode: 'chaos' }], ['target', { season: 'monsoon' }], ['hub75', { brightness: 3 }],
                        ['bootfile', { file: 'evil.toe; rm -rf' }], ['rules', { rules: { 'x; y': 1 } }], ['shell', {}]]) {
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
