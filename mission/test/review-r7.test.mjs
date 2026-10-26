// Round 7: the server is the one authority on when a switch, a restart, a rebuild or a boot-file change is done
// (docs/mission-ui.md "Applying a change"). Every control answer names its entry (applying_id); the server keeps the entries it
// confirmed (status.confirmed) and the ones that ran out (status.expired) for about 10 minutes; a full check asked before the
// one already kept never replaces it; the map in use is recorded only when the rebuild is confirmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Applying, ENDED_KEEP_MS } from '../lib/applying.mjs';
import { Mission } from '../lib/mission.mjs';
import { FixtureMission } from '../lib/fixtures.mjs';
import { History } from '../lib/history.mjs';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const AT_2104 = Date.UTC(2026, 9, 25, 4, 4, 30);
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const gated = () => { let release; const gate = new Promise((r) => { release = r; }); return { gate, release: (v) => release(v) }; };

/** A Mission whose clock, follow-up timers and full check the test drives. */
function driven({ action = async () => ({ ok: true }), lights = null, reading = { ok: true, td: { ok: true, file: YEAR, fps: 60 } } } = {}) {
  const ctx = { t: AT_2104, timers: [], reading };
  ctx.m = new Mission({ now: () => ctx.t, lights, later: (fn, ms) => ctx.timers.push({ fn, ms }),
                        probe: async (_h, args) => (args ? action(args) : (typeof ctx.reading === 'function' ? ctx.reading() : ctx.reading)) });
  return ctx;
}

test('every control answer names its entry (applying_id), a maybe answer too; a change the server saw through is in confirmed', async () => {
  let t = 1_000_000;
  const a = new Applying({ now: () => t });
  const r = await a.run('ropes', { dark: true }, async () => ({ ok: true, td: { ok: true } }));
  assert.equal(typeof r.applying_id, 'string');
  assert.equal(r.ok, true);
  assert.deepEqual(a.ended().confirmed.map((e) => [e.id, e.action]), [[r.applying_id, 'ropes']], 'done on its own answer');
  const m = await a.run('switch', { file: LIVE }, async () => ({ ok: false, maybe: true, error: 'bitcube took too long to answer' }));
  assert.equal(m.maybe, true);
  assert.equal(a.list()[0].id, m.applying_id, 'the maybe answer names the entry it left confirming');
  assert.notEqual(m.applying_id, r.applying_id);
  // a refused change made an entry too, but it is neither confirmed nor expired: it failed
  const a2 = new Applying({ now: () => t });
  const f = await a2.run('hub75', { brightness: 0.5 }, async () => ({ ok: false, error: 'TouchDesigner did not answer' }));
  assert.equal(typeof f.applying_id, 'string');
  assert.deepEqual(a2.ended(), { confirmed: [], expired: [] });
  // an action that isn't recorded (a calibration's cancel, the full check) has none
  assert.equal((await a.run('calibrate', { action: 'cancel' }, async () => ({ ok: true }))).applying_id, undefined);
  // ids from two servers (a restart) never collide
  const b = new Applying({ now: () => t });
  const r2 = await b.run('ropes', { dark: true }, async () => ({ ok: true }));
  assert.notEqual(r2.applying_id, r.applying_id);
});

test('status.confirmed and status.expired: { id, action, file, started_at, at } for about 10 min, on the served clock', async () => {
  let t = 1_000_000;
  const a = new Applying({ now: () => t });
  const sw = await a.run('switch', { file: LIVE }, async () => { t += 10_000; return { ok: true }; }, { awaits: () => true });
  t += 20_000;
  assert.equal(a.confirm({ td: { ok: true, file: LIVE } }, t).length, 1);
  const bf = await a.run('bootfile', { file: YEAR }, async () => ({ ok: false, maybe: true }));
  t += 200_000;                                        // past the boot file's limit (max(3 x 15, 120) s from its answer)
  const ended = a.ended(t + 5000);                     // served 5 s ahead (fixture mode's clock)
  // R8 #9: with the change's label and source, so another phone can say how it ended
  assert.deepEqual(ended.confirmed, [{ id: sw.applying_id, action: 'switch', label: 'the switch to the live river', source: 'mission control', file: LIVE, started_at: 1_000_000 + 5000, at: 1_030_000 + 5000 }]);
  assert.deepEqual(ended.expired, [{ id: bf.applying_id, action: 'bootfile', label: "the boot file change to the river's year", source: 'mission control', file: YEAR, started_at: 1_030_000 + 5000, at: t + 5000, maybe: true }]);
  assert.deepEqual(a.list(), [], 'the lock went with it');
  t += ENDED_KEEP_MS - 100_000;
  assert.equal(a.ended().expired.length, 1);
  assert.equal(a.ended().confirmed.length, 0, 'the switch confirmed over 10 min ago is forgotten');
  t += 200_000;
  assert.deepEqual(a.ended(), { confirmed: [], expired: [] });
});

test('a restart or a rebuild that got no answer in time is confirmed only once TouchDesigner was seen restarting: the old one answering proves nothing', async () => {
  let t = 1_000_000;
  const a = new Applying({ now: () => t });
  const r = await a.run('switch', { file: YEAR }, async () => ({ ok: false, maybe: true }), { running: YEAR });
  t += 10_000;
  assert.deepEqual(a.confirm({ td: { ok: true, file: YEAR } }, t), [], 'TouchDesigner answering on the same file may be the one that never restarted');
  t += 10_000;
  a.confirm({ td: { ok: false, error: 'TouchDesigner is not running' } }, t);
  t += 10_000;
  assert.deepEqual(a.confirm({ td: { ok: true, file: YEAR } }, t).map((e) => e.id), [r.applying_id], 'down, then up on the file: the restart happened');
  // a maybe switch to another file: answering on that file proves it
  const s = await a.run('switch', { file: LIVE }, async () => ({ ok: false, maybe: true }), { running: YEAR });
  t += 10_000;
  assert.deepEqual(a.confirm({ td: { ok: true, file: LIVE } }, t).map((e) => e.id), [s.applying_id]);
  // a maybe rebuild needs the restart too
  const b = await a.run('rebuild', { file: YEAR }, async () => ({ ok: false, maybe: true }), { running: YEAR });
  t += 10_000;
  assert.deepEqual(a.confirm({ td: { ok: true, file: YEAR } }, t), []);
  a.confirm({ td: { ok: false, error: 'no answer from the TD bridge' } }, t + 1);
  assert.deepEqual(a.confirm({ td: { ok: true, file: YEAR } }, t + 2).map((e) => e.id), [b.applying_id]);
  // a restart that answered OK: TouchDesigner was stopped before the answer, so a reading asked after it on the file is the restart
  const ok = await a.run('switch', { file: YEAR }, async () => ({ ok: true }), { running: YEAR, awaits: () => true });
  assert.deepEqual(a.confirm({ td: { ok: true, file: YEAR } }, t + 3).map((e) => e.id), [ok.applying_id]);
});

test('round 7 #25: a full check asked before the reading already kept never replaces it (a slow check landing after a switch answered)', async () => {
  const old = gated();
  let n = 0;
  const c = driven({ action: async () => ({ ok: true, switched_to: YEAR, td: { ok: false, error: `restarting on ${YEAR}` } }) });
  c.reading = () => (++n === 1 ? { ok: true, td: { ok: true, file: YEAR, fps: 20 } } : old.gate);
  await c.m.pollProbe();                                 // TouchDesigner on the year, slow: the band advises a restart
  c.t += 1000;
  const early = c.m.pollProbe();                         // the 60 s timer's check, asked before the restart
  c.t += 5000;
  const r = await c.m.control('switch', { file: YEAR });
  assert.equal(r.ok, true);
  assert.equal(c.m.snapshot().probe.value.td.error, `restarting on ${YEAR}`);
  c.t += 20_000;
  old.release({ ok: true, td: { ok: true, file: YEAR, fps: 20 } }); await early;
  const s = c.m.snapshot();
  assert.equal(s.probe.value.td.error, `restarting on ${YEAR}`, 'the reading from before the restart is not kept');
  assert.deepEqual(s.applying.map((e) => [e.id, e.phase]), [[r.applying_id, 'confirming']]);
  assert.deepEqual(s.confirmed, []);
  // a check asked after the answer is kept, and confirms it
  c.reading = { ok: true, td: { ok: true, file: YEAR, fps: null } };
  await c.m.pollProbe();
  const after = c.m.snapshot();
  assert.equal(after.probe.value.td.file, YEAR);
  assert.deepEqual(after.confirmed.map((e) => [e.id, e.action, e.file]), [[r.applying_id, 'switch', YEAR]]);
  assert.deepEqual(after.applying, []);
});

test('round 7 #25: a restart that timed out keeps the reading it had; only a later check can confirm it', async () => {
  const c = driven({ action: async () => ({ ok: false, maybe: true, error: 'bitcube took too long to answer' }) });
  await c.m.pollProbe();
  c.t += 1000;
  const r = await c.m.control('switch', { file: YEAR });
  assert.equal(r.maybe, true);
  c.t += 20_000; await c.m.pollProbe();                  // TouchDesigner answers on the year: maybe the old one
  assert.deepEqual(c.m.snapshot().confirmed, [], 'never confirmed from the file name alone');
  c.reading = { ok: true, td: { ok: false, error: 'TouchDesigner is not running' } };
  c.t += 5000; await c.m.pollProbe();
  c.reading = { ok: true, td: { ok: true, file: YEAR, fps: null } };
  c.t += 20_000; await c.m.pollProbe();
  assert.deepEqual(c.m.snapshot().confirmed.map((e) => e.id), [r.applying_id]);
});

test('round 7 #26: the map in use is recorded when the rebuild is confirmed (TouchDesigner back on the file), never at its answer; one that never shows is expired and records nothing', async () => {
  const c = driven({ action: async (args) => (/rebuild/.test(args) ? { ok: true, rebuilt: true, saved: true, switched: true, pixelmap: { file: 'pixelmap-2026-10-25.json' }, td: { ok: false, error: `restarting on ${YEAR}` } } : { ok: true }) });
  await c.m.pollProbe();
  const r = await c.m.control('rebuild', { file: YEAR });
  assert.equal(c.m.rebuilt(), null, 'answered, but TouchDesigner is still restarting: not in use yet');
  c.reading = { ok: true, td: { ok: false, error: 'TouchDesigner is not running' } };
  c.t += 15_000; await c.m.pollProbe();
  assert.equal(c.m.rebuilt(), null);
  c.reading = { ok: true, td: { ok: true, file: YEAR, fps: null } };
  c.t += 30_000; await c.m.pollProbe();
  assert.deepEqual(c.m.rebuilt(), { at: c.t, map: 'pixelmap-2026-10-25.json', file: YEAR, run: null });
  assert.deepEqual(c.m.snapshot().confirmed.map((e) => [e.id, e.action]), [[r.applying_id, 'rebuild']]);
  // a rebuild whose TouchDesigner never comes back: dropped at its limit, unconfirmed; the map in use stays the old one
  const d = driven({ action: async () => ({ ok: true, rebuilt: true, saved: true, switched: true, pixelmap: { file: 'pixelmap-2026-10-26.json' } }) });
  await d.m.pollProbe();
  const r2 = await d.m.control('rebuild', { file: YEAR });
  d.reading = { ok: true, td: { ok: false, error: 'no answer from the TD bridge' } };
  d.t += 451_000; await d.m.pollProbe();
  const s = d.m.snapshot();
  assert.deepEqual([s.applying, s.confirmed, s.expired.map((e) => [e.id, e.action])], [[], [], [[r2.applying_id, 'rebuild']]]);
  assert.equal(d.m.rebuilt(), null);
});

test('a calibration start held as "starting" ends confirmed when its run shows, expired when none ever does', async () => {
  const T0 = Math.round(AT_2104 / 1000);
  const lights = { status: { running: false, none: true },
    async calibrate() { return { ok: true, started: true, pending: true, pid: 4242, requested: T0 }; }, async calibration() { return this.status; } };
  const c = driven({ lights });
  await c.m.pollProbe();
  const r = await c.m.calibrate('start', {});
  assert.deepEqual(c.m.snapshot().applying.map((e) => [e.id, e.phase]), [[r.applying_id, 'confirming']]);
  lights.status = { running: true, alive: true, stage: 'ropes-capture', started: T0 + 2, updated: T0 + 6 };
  c.t += 5000; await c.timers.shift().fn();
  assert.deepEqual(c.m.snapshot().confirmed.map((e) => [e.id, e.action]), [[r.applying_id, 'calibrate']]);
  // none ever shows: twelve reads, then expired
  const l2 = { status: { running: false, none: true }, async calibrate() { return { ok: true, started: true, pending: true, pid: 9 }; }, async calibration() { return this.status; } };
  const d = driven({ lights: l2 });
  const r2 = await d.m.calibrate('start', {});
  for (let i = 0; i < 20 && d.timers.length; i++) { d.t += 5000; await d.timers.shift().fn(); }
  assert.deepEqual(d.m.snapshot().expired.map((e) => [e.id, e.action]), [[r2.applying_id, 'calibrate']]);
});

test('the history keeps each action\'s entry id, so Last done can tell a change still being confirmed', () => {
  const h = new History({ file: null, now: () => 5 });
  h.action({ action: 'switch', body: { file: YEAR }, ok: true, source: 'mission control', label: "the restart on the river's year", applying_id: 'ax.3' });
  assert.equal(h.summary().last_action.applying_id, 'ax.3');
  h.action({ action: 'ropes', body: { dark: true }, ok: true, applying_id: { evil: 1 } });
  assert.equal(h.summary().last_action.applying_id, undefined, 'only a string id is kept');
});

test('fixture mode: the map in use is recorded once the rebuild is confirmed, and the answer names its entry', async () => {
  let t = 1_761_300_000_000;
  const stateDir = mkdtempSync(join(tmpdir(), 'r7-'));
  const pixelmapDir = new URL('../../tools/pixelmap/', import.meta.url).pathname;
  const m = new FixtureMission({ dir: FIXTURES, stateDir, pixelmapDir, now: () => t, applyS: 6, sleep: async (ms) => { t += ms; } });
  const r = await m.control('rebuild', { file: YEAR }, 'all-good');
  assert.equal(typeof r.applying_id, 'string');
  assert.equal(m.rebuilt('all-good'), null, 'TouchDesigner is restarting on it: not in use yet');
  assert.deepEqual(m.snapshot('all-good').applying.map((e) => [e.id, e.phase]), [[r.applying_id, 'confirming']]);
  t += 6500;
  const s = m.snapshot('all-good');
  assert.deepEqual([s.applying, s.confirmed.map((e) => [e.id, e.action])], [[], [[r.applying_id, 'rebuild']]]);
  assert.equal(m.rebuilt('all-good').at, t);
  assert.deepEqual(m.snapshot('td-low-fps').confirmed, [], 'each scenario is its own world');
});
