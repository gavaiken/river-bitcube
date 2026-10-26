import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sshJson, sshFrames, sshPixelmap, sshCalibrate, planCalibrate, decodeFrames, rgbAt, summarizePixelmap, ropePaths,
         syntheticFrames, Lights, PIXELMAP_CACHE_MS, readLocalPixelmap, readLocalScreens } from '../lib/lights.mjs';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MAP = join(HERE, '..', '..', 'tools', 'pixelmap', 'pixelmap-2026-10-18.json');

/** An execFile stand-in: records the call, answers with stdout (and err) on the next tick. */
function fakeExec(stdout, err = null) {
  const calls = [];
  const exec = (file, args, opts, cb) => { calls.push({ file, args, opts }); setImmediate(() => cb(err, stdout)); };
  exec.calls = calls;
  return exec;
}

function framesPayload({ w = 20, h = 400 } = {}) {
  const ropes = Buffer.alloc(w * h * 3);
  ropes[0] = 255;                                 // (0, 0): plug end of rope 1, red
  ropes[(5 * w + 2) * 3 + 1] = 128;               // (x 2, y 5): rope 3, pixel 5, half green
  const panels = Buffer.alloc(256 * 32 * 3, 7);
  return { ok: true, action: 'frames', file: 'river-local-oct-22-seasons.toe', fps: 60,
           frames: { at: 1761220000.5, source: 'canvas', brightness: 1,
                     ropes: { w, h, rgb: ropes.toString('base64'), source: 'canvas', brightness: 0.4, watts: [182, 191] },
                     panels: { w: 256, h: 32, rgb: panels.toString('base64'), source: 'canvas', brightness: 1, output: true, atlas: [1024, 128] } } };
}

/** What pixelmap.ps1 prints: the file on one line with file/modified in front. */
function pixelmapLine(file = 'pixelmap-2026-10-18.json', modified = '2026-10-18T16:05:00') {
  const raw = readFileSync(REAL_MAP, 'utf8').replace(/\r?\n/g, '').trim();
  return `{"file":"${file}","modified":"${modified}",` + raw.slice(1);
}

test('sshFrames runs frames.ps1 over ssh and parses the last JSON line', async () => {
  const exec = fakeExec('Warning: something on stderr-ish\r\n' + JSON.stringify(framesPayload()) + '\r\n');
  const r = await sshFrames('bitcube', { exec });
  assert.equal(r.ok, true);
  assert.equal(r.frames.ropes.w, 20);
  const [call] = exec.calls;
  assert.equal(call.file, 'ssh');
  assert.deepEqual(call.args.slice(0, 5), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'bitcube']);
  assert.match(call.args[5], /^powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\user\\River\\river-bitcube\\tools\\mission\\frames\.ps1$/);
  assert.equal(call.opts.timeout, 25_000);
  assert.ok(call.opts.maxBuffer >= 4 << 20);
});

test('fetch failures become { ok: false, error } and never reject', async () => {
  // killed for time, or ended without a word: it may or may not have happened (maybe), never a plain failure
  assert.deepEqual(await sshJson('bitcube', 'frames.ps1', '', { exec: fakeExec('', Object.assign(new Error('x'), { killed: true })) }),
                   { ok: false, maybe: true, error: 'bitcube took too long to answer' });
  assert.deepEqual(await sshJson('bitcube', 'frames.ps1', '', { exec: fakeExec('', Object.assign(new Error('x'), { code: 255 })) }),
                   { ok: false, error: "can't reach bitcube over SSH" });
  assert.deepEqual(await sshJson('bitcube', 'pixelmap.ps1', '', { exec: fakeExec('nothing useful\n') }), { ok: false, maybe: true, error: 'no answer from pixelmap.ps1' });
  assert.deepEqual(await sshJson('bitcube', 'calibrate.ps1', '', { exec: fakeExec('{not json', Object.assign(new Error('x'), { code: 1 })) }),
                   { ok: false, error: 'calibrate.ps1 failed (exit 1)' });
  // bitcube's own error line is passed through as it is
  assert.deepEqual(await sshFrames('bitcube', { exec: fakeExec('{"ok":false,"error":"TouchDesigner is not running"}\n') }),
                   { ok: false, error: 'TouchDesigner is not running' });
});

test('sshPixelmap fetches the newest map (or a named one) and parses the real file format', async () => {
  const exec = fakeExec(pixelmapLine() + '\n');
  const m = await sshPixelmap('bitcube', { exec });
  assert.equal(m.file, 'pixelmap-2026-10-18.json');
  assert.equal(m.points.length, 7200);
  assert.deepEqual(m.meta.frame_size, [1440, 808]);
  assert.ok(m.hub75_quad1.tl.length === 2);
  assert.match(exec.calls[0].args[5], /pixelmap\.ps1$/);
  assert.equal(exec.calls[0].opts.maxBuffer, 16 << 20);
  const exec2 = fakeExec(pixelmapLine('pixelmap-2026-10-24.json') + '\n');
  await sshPixelmap('bitcube', { file: 'pixelmap-2026-10-24.json', exec: exec2 });
  assert.match(exec2.calls[0].args[5], /pixelmap\.ps1 -File pixelmap-2026-10-24\.json$/);
  await assert.rejects(sshPixelmap('bitcube', { file: '../secrets.local.json', exec: exec2 }), (e) => e.status === 400);
  assert.equal(exec2.calls.length, 1);
});

test('planCalibrate is a whitelist with checked arguments', () => {
  assert.equal(planCalibrate('start'), '-Action start');
  assert.equal(planCalibrate('start', { dry_run: true }), '-Action start -DryRun');
  assert.equal(planCalibrate('start', { decode_only: 'pixelmap-20261018-154155', cam: 'gallery' }), '-Action start -DecodeOnly pixelmap-20261018-154155 -Cam gallery');
  assert.equal(planCalibrate('start', { task: true }), '-Action start -Task');
  assert.equal(planCalibrate('start', { dry_run: 'no', task: 'x' }), '-Action start', 'only a real true is a flag');
  assert.equal(planCalibrate('cancel', { dry_run: true }), '-Action cancel');
  assert.equal(planCalibrate('status'), '-Action status');
  for (const [a, b] of [['shell', {}], ['start', { decode_only: 'x; rm -rf' }], ['start', { decode_only: '..\\..\\secrets' }],
                        ['start', { cam: 'kitchen' }], ['start', null], ['', {}]]) {
    assert.throws(() => planCalibrate(a, b), (e) => e.status === 400, `${a} ${JSON.stringify(b)}`);
  }
});

test('sshCalibrate passes the planned arguments and parses the answer', async () => {
  const exec = fakeExec('{"ok":true,"started":true,"pid":4242,"calibration":{"running":true,"stage":"ropes-capture"}}\n');
  const r = await sshCalibrate('bitcube', 'start', { dry_run: true, exec });
  assert.equal(r.pid, 4242);
  assert.match(exec.calls[0].args[5], /calibrate\.ps1 -Action start -DryRun$/);
  assert.equal(exec.calls[0].opts.timeout, 60_000);
  await assert.rejects(async () => sshCalibrate('bitcube', 'rm', { exec }), (e) => e.status === 400);
  assert.equal(exec.calls.length, 1);
});

test('decodeFrames turns base64 into bytes and checks the sizes', () => {
  const d = decodeFrames(framesPayload());
  assert.equal(d.at, 1761220000.5);
  assert.equal(d.ropes.rgb.length, 20 * 400 * 3);
  assert.ok(d.ropes.rgb instanceof Uint8Array);
  assert.deepEqual(rgbAt(d.ropes, 0, 0), [255, 0, 0]);
  assert.deepEqual(rgbAt(d.ropes, 2, 5), [0, 128, 0]);
  assert.deepEqual(rgbAt(d.panels, 255, 31), [7, 7, 7]);
  assert.equal(rgbAt(d.panels, 256, 0), null);
  assert.equal(d.ropes.watts[1], 191);
  assert.equal(d.panels.output, true);
  // the frames object itself works too, and a short payload is an error on that part only
  const p = framesPayload();
  p.frames.ropes.rgb = Buffer.alloc(10).toString('base64');
  const e = decodeFrames(p.frames);
  assert.match(e.ropes.error, /10 bytes, expected 24000/);
  assert.equal(e.panels.rgb.length, 256 * 32 * 3);
  p.frames.panels = { error: "AttributeError('panel_out')" };
  assert.deepEqual(decodeFrames(p).panels, { error: "AttributeError('panel_out')" });
  assert.throws(() => decodeFrames(null), /no frames/);
});

test('syntheticFrames (fixture mode) has the real shape and moves with time', () => {
  const a = decodeFrames(syntheticFrames(1_000_000));
  const b = decodeFrames(syntheticFrames(1_500_000));
  assert.equal(a.ropes.rgb.length, 20 * 400 * 3);
  assert.equal(a.panels.rgb.length, 256 * 32 * 3);
  assert.equal(a.at, 1000);
  assert.ok(!a.ropes.error && !a.panels.error);
  assert.notDeepEqual(Array.from(a.ropes.rgb.slice(0, 300)), Array.from(b.ropes.rgb.slice(0, 300)));
  assert.equal(syntheticFrames().synthetic, true);
});

test('summarizePixelmap and ropePaths describe the real map like the probe does', () => {
  const m = JSON.parse(pixelmapLine());
  const s = summarizePixelmap(m);
  assert.equal(s.file, 'pixelmap-2026-10-18.json');
  assert.equal(s.date, '2026-10-18');
  assert.equal(s.points, 7200);
  assert.equal(s.seen, Object.values(m.ropes).reduce((a, v) => a + v.visible, 0));
  assert.ok(s.seen > 0 && s.seen < s.points, `seen ${s.seen} of ${s.points}`);
  assert.equal(s.ropes, 18);
  assert.deepEqual(s.ropes_dark, [9, 17]);
  assert.deepEqual(s.ropes_found.slice(0, 3), [1, 2, 3]);
  assert.deepEqual(s.hub75_quads, ['hub75_quad1']);
  assert.deepEqual(s.frame_size, [1440, 808]);
  assert.equal(s.camera, 'gallery');
  assert.equal(s.drift_px, 13.28);
  assert.equal(summarizePixelmap({ error: 'no pixel map on bitcube' }), null);
  const paths = ropePaths(m);
  assert.equal(paths.size, 18);
  assert.equal(paths.get(0).length, 400);
  assert.equal(paths.get(0)[399].px, 399);
  assert.equal(paths.has(8), false);                 // rope 9 is dark
});

test('Lights caches frames (one fetch at a time), refetches the map per new file, and keeps calibration fresh', async () => {
  let t = 1_000_000;
  const counts = { frames: 0, pixelmap: 0, status: 0, start: 0 };
  const lights = new Lights({
    now: () => t,
    frames: async () => { counts.frames++; await new Promise((r) => setTimeout(r, 10)); return framesPayload(); },
    pixelmap: async (_h, { file }) => { counts.pixelmap++; return { file: file ?? 'pixelmap-2026-10-18.json', modified: 'm1', points: [] }; },
    calibrate: async (_h, action, body) => {
      counts[action === 'status' ? 'status' : 'start']++;
      if (action === 'status') return { running: false, none: true };
      return { ok: true, started: true, pid: 7, calibration: { running: true, stage: 'ropes-capture', dry_run: !!body.dry_run } };
    },
  });
  const [a, b] = await Promise.all([lights.frames(), lights.frames()]);
  assert.equal(counts.frames, 1);
  assert.equal(a.frames.ropes.w, 20); assert.equal(b.age_s, 0);
  t += 5000; await lights.frames(); assert.equal(counts.frames, 1);           // still fresh
  t += 5000; const c = await lights.frames(); assert.equal(counts.frames, 2); assert.equal(c.age_s, 0);

  const m1 = await lights.pixelmap({ file: 'pixelmap-2026-10-18.json', modified: 'm1' });
  await lights.pixelmap({ file: 'pixelmap-2026-10-18.json', modified: 'm1' });
  assert.equal(counts.pixelmap, 1); assert.equal(m1.file, 'pixelmap-2026-10-18.json');
  await lights.pixelmap({ file: 'pixelmap-2026-10-18.json', modified: 'm2' });   // the same name rewritten today
  assert.equal(counts.pixelmap, 2);
  const m3 = await lights.pixelmap({ file: 'pixelmap-2026-10-24.json', modified: 'm3' });
  assert.equal(counts.pixelmap, 3); assert.equal(m3.file, 'pixelmap-2026-10-24.json');
  await lights.pixelmap(null); assert.equal(counts.pixelmap, 3);               // no summary: the cached map, while fresh
  t += PIXELMAP_CACHE_MS + 1; await lights.pixelmap(null); assert.equal(counts.pixelmap, 4);

  assert.deepEqual(await lights.calibration(), { running: false, none: true });
  await lights.calibration(); assert.equal(counts.status, 1);
  const s = await lights.calibrate('start', { dry_run: true });
  assert.equal(s.pid, 7); assert.equal(counts.start, 1);
  assert.equal((await lights.calibration()).stage, 'ropes-capture');            // the answer's progress is the new cache
  assert.equal(counts.status, 1);
  t += 4000; await lights.calibration(); assert.equal(counts.status, 2);
  await assert.rejects(lights.calibrate('shell', {}), (e) => e.status === 400);
  assert.equal(counts.start, 1);
});

test('readLocalPixelmap and readLocalScreens read the newest files in the clone like pixelmap.ps1 prints them', () => {
  const dir = join(HERE, '..', '..', 'tools', 'pixelmap');
  const m = readLocalPixelmap(dir);
  assert.equal(m.file, 'pixelmap-2026-10-23.json');
  assert.match(m.modified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(m.points.length, 8000);
  assert.equal(Object.keys(m.ropes).length, 20);
  assert.deepEqual(m.meta.frame_size, [1440, 808]);
  assert.equal(m.meta.camera, 'gallery');
  assert.equal(summarizePixelmap(m).date, '2026-10-23');
  assert.equal(readLocalPixelmap(dir), m, 'the same file is parsed once');
  const sc = readLocalScreens(dir);
  assert.equal(sc.file, 'screens-2026-10-23.json');
  assert.deepEqual(Object.keys(sc.screens), ['1', '2', '3', '4']);
  assert.deepEqual(Object.keys(sc.meta).sort(), ['camera', 'capture', 'frame_size', 'uv']);
  assert.deepEqual([sc.screens['1'].estimated, sc.screens['2'].estimated, sc.screens['2'].tl.length], [true, undefined, 2]);
  // an empty folder, an unreadable file, a rewritten file
  const tmp = mkdtempSync(join(tmpdir(), 'pm-'));
  assert.equal(readLocalPixelmap(tmp), null);
  assert.equal(readLocalScreens('/nowhere/at/all'), null);
  writeFileSync(join(tmp, 'pixelmap-2026-10-01.json'), '{ nope');
  assert.match(readLocalPixelmap(tmp).error, /unreadable pixelmap-2026-10-01.json/);
  writeFileSync(join(tmp, 'pixelmap-2026-10-02.json'), JSON.stringify({ meta: { drift: 1 }, ropes: {}, points: [] }));
  assert.equal(readLocalPixelmap(tmp).file, 'pixelmap-2026-10-02.json');
  writeFileSync(join(tmp, 'pixelmap-2026-10-02.json'), JSON.stringify({ meta: { drift: 2 }, ropes: {}, points: [] }));
  utimesSync(join(tmp, 'pixelmap-2026-10-02.json'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  assert.equal(readLocalPixelmap(tmp).meta.drift, 2, 'a changed file is read again');
});

test('screens: the stacked Gray Area atlas comes apart into one upright screen per quad (never all four on every screen)', async () => {
  const { uprightsFromAtlas, atlasFromUprights, quadPos, isStacked } = await import('../public/screens.js');
  const AW = 64, AH = 128, COL = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  const atlas = new Uint8Array(AW * AH * 3);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) atlas.set(COL[Math.floor(y / 32)], (y * AW + x) * 3);   // quad k: rows 32(k-1)..
  const up = uprightsFromAtlas(atlas, AW, AH);
  assert.deepEqual([up.w, up.h], [128, 64], 'four 32 × 64 portraits side by side');
  for (let k = 0; k < 4; k++) for (const [x, y] of [[0, 0], [31, 63], [16, 40]]) {
    const i = (y * 128 + k * 32 + x) * 3;
    assert.deepEqual([...up.bytes.slice(i, i + 3)], COL[k], `screen ${k + 1} at ${x},${y}`);
  }
  // the transform is a bijection per quad, and the inverse gives the atlas back
  for (let k = 1; k <= 4; k++) { const seen = new Set(); for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) seen.add(quadPos(k, x, y, 32, 64).join()); assert.equal(seen.size, 32 * 64); }
  const rnd = Uint8Array.from({ length: 128 * 64 * 3 }, (_, i) => (i * 37) % 251);
  const back = atlasFromUprights(rnd, 128, 64);
  assert.deepEqual([back.w, back.h], [64, 128]);
  assert.deepEqual(uprightsFromAtlas(back.bytes, 64, 128).bytes, rnd);
  assert.equal(isStacked(256, 32), false, 'the pre-Gray-Area atlas (quads in a row) is cut as it is');
  assert.equal(uprightsFromAtlas(new Uint8Array(256 * 32 * 3), 256, 32), null);
});

test('Lights.calibrate passes on only the request fields (never timeout, maxBuffer or exec), and never a camera login', async () => {
  const seen = [];
  const PW = 'rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_main';
  const lights = new Lights({
    calibrate: async (_h, action, opts) => {
      seen.push({ action, opts });
      return { ok: false, error: `ropes-capture failed (exit 1): Error opening input file ${PW}.`, calibration: { running: false, log: [`Error opening input file ${PW}.`], error: `x ${PW}` } };
    },
  });
  const r = await lights.calibrate('start', { action: 'start', dry_run: true, cam: 'gallery', timeout: 0, maxBuffer: 1e12, exec: 'x' });
  assert.deepEqual(seen[0].opts, { dry_run: true, cam: 'gallery' });
  assert.doesNotMatch(JSON.stringify(r), /NOT-A-REAL-PW|admin:/);
  assert.match(r.calibration.log[0], /rtsp:\/\/\*\*\*@192\.168\.9\.76:554/);
  const st = await lights.calibration();
  assert.doesNotMatch(JSON.stringify(st), /NOT-A-REAL-PW/);
  // the real ssh path: those keys from a body can't reach execFile's options
  const calls = [];
  const exec = (cmd, args, opts, cb) => { calls.push(opts); setImmediate(() => cb(null, '{"ok":true}')); };
  await sshCalibrate('bitcube', 'status', { exec });
  assert.equal(calls[0].timeout, 60_000);
});
