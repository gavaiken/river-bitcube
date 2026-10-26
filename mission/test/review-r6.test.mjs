// Code review of the round 6 fixes: lock lifetimes, a maybe that can't hide a crash, focus words, the agent's steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Applying } from '../lib/applying.mjs';
import { Mission } from '../lib/mission.mjs';
import { describeTool } from '../lib/steps.mjs';
import { derive, ctlInit, ctlStep, sansTime } from '../public/model.js';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const fx = JSON.parse(readFileSync(new URL('./fixtures/all-good.json', import.meta.url), 'utf8'));
const at = (edit) => { const st = edit({ ...JSON.parse(JSON.stringify(fx.status)), now: fx._scenario.now }); return derive(st, st.now + 1000); };

test('a maybe on a quick change is no lock (the next reading says what happened); a maybe on a show-file change is, and its reading ends it', async () => {
  const a = new Applying({ now: () => 1_000_000 });
  await a.run('mode', { mode: 'manual' }, async () => ({ ok: false, maybe: true }));
  assert.equal(a.list().length, 0, 'mode: no 2 min lock for a slow seasons page');
  await a.run('ropes', { dark: true }, async () => ({ ok: false, maybe: true }));
  assert.equal(a.list().length, 0);
  await a.run('bootfile', { file: LIVE }, async () => ({ ok: false, maybe: true }));
  assert.equal(a.list()[0]?.phase, 'confirming', 'a boot-file change bitcube may still be making keeps its lock');
  assert.equal(a.confirm({ td: { ok: true, file: YEAR }, boot_file: LIVE }, 1_000_000).length, 1, 'the reading that shows the boot file ends it');
  assert.equal(a.list().length, 0);
});

test('a confirming lock is counted from the answer, not the start (a slow rebuild keeps it while TouchDesigner reopens)', async () => {
  let t = 0;
  const a = new Applying({ now: () => t });
  const p = a.run('rebuild', { file: YEAR }, async () => { t += 400_000; return { ok: true }; }, { awaits: () => true });
  await p;
  t += 100_000;                                  // 500 s after the start, 100 s after the answer
  assert.equal(a.list()[0]?.phase, 'confirming');
  const m = at((st) => ({ ...st, applying: a.list(st.now) }));
  assert.match(m.controls.switch.why ?? '', /^wait: a rebuild/, 'the pages keep the lock too');
});

test('a maybe switch never hides a crash; a switch that answered and a rebuild in progress read as a restart', () => {
  const now = fx._scenario.now;
  const tdDown = (st, error) => ({ ...st, probe: { ...st.probe, value: { ...st.probe.value, td: { ok: false, error } } } });
  let m = at((st) => ({ ...tdDown(st, 'not running'), applying: [{ id: 'a1', action: 'switch', file: LIVE, phase: 'confirming', maybe: true, started_at: now - 30_000, answered_at: now - 5_000, expect_s: 60, blocks: ['switch'] }] }));
  assert.notEqual(m.overall.cause, 'td-restarting', 'a switch that may never have run can\'t explain TouchDesigner being down');
  m = at((st) => ({ ...tdDown(st, 'not running'), applying: [{ id: 'a2', action: 'switch', file: LIVE, phase: 'confirming', started_at: now - 30_000, answered_at: now - 5_000, expect_s: 60, blocks: ['switch'] }] }));
  assert.equal(m.overall.cause, 'td-restarting');
  m = at((st) => ({ ...tdDown(st, 'not running'), applying: [{ id: 'a4', action: 'switch', file: LIVE, phase: 'applying', started_at: now - 10_000, expect_s: 60, blocks: ['switch'] }] }));
  assert.equal(m.overall.cause, 'td-restarting', 'a switch in flight is the restart itself');
  m = at((st) => ({ ...tdDown(st, 'no answer from the TD bridge'), applying: [{ id: 'a3', action: 'rebuild', file: YEAR, phase: 'applying', started_at: now - 30_000, expect_s: 150, blocks: ['switch'] }] }));
  assert.equal(m.overall.cause, 'td-restarting', 'a rebuild keeps TouchDesigner busy and then restarts it');
});

test('a second press starts from scratch: the last done line\'s "seen" never carries over', () => {
  let s = ctlInit();
  s = ctlStep(s, { type: 'press', now: 1 }); s = ctlStep(s, { type: 'ok', now: 2 });
  s = ctlStep(s, { type: 'reading', holds: true, now: 3 });
  assert.equal(s.seen, true);
  s = ctlStep(s, { type: 'press', now: 10 });
  assert.equal(s.seen, false);
});

test('only times are taken out of the screen reader\'s words, never a box\'s number', () => {
  assert.notEqual(sansTime('Rope box 1 is silent'), sansTime('Rope box 2 is silent'));
  assert.equal(sansTime('Calibrating: about 4 min more · 0:34'), sansTime('Calibrating: about 3 min more · 0:59'));
});

test('a status read and a change in one command: the step says the change and is an acting line', () => {
  const r = describeTool({ name: 'Bash', input: { description: 'Check, then switch', command: `node mission/bin/mc.mjs status && node mission/bin/mc.mjs switch '{"file":"${LIVE}"}'` } });
  assert.equal(r.acting, true);
  assert.match(r.text, /live river/);
});

test('the same progress copy read again keeps its first read time (the time left is not overstated)', async () => {
  let t = 1_800_000_000_000;
  const lights = { calibrate: async () => ({ ok: true, started: true, calibration: { running: true, stage: 'ropes-capture', started: 1_800_000_000, updated: 1_800_000_000 } }), calibration: async () => ({ running: true, stage: 'ropes-capture', started: 1_800_000_000, updated: 1_800_000_000 }) };
  const m = new Mission({ lights, now: () => t, probe: async () => ({ ok: true, td: { ok: true, file: YEAR } }) });
  await m.pollProbe();
  await m.calibrate('start', {});
  t += 5_000; await m.calibrationStatus();
  t += 5_000;
  assert.equal(m.snapshot().probe.value.calibration.read_age_s, 10);
});
