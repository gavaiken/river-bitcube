// Applying a change (docs/mission-ui.md "Applying a change"): status.applying as locks across phones in derive(), and the
// states of one control (ctlStep, the pure rules ui.js control() and status.js follow), run in node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, ctlInit, ctlStep, ctlView, confirmLimitS, elapsedClock, applyingWords, confirmingWords, APPLY_BLOCKS, LONG_CHANGE_S } from '../public/model.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const AG = load('all-good'), NOW = AG._scenario.now;
const status = (applying, name = 'all-good') => { const f = name === 'all-good' ? AG : load(name); const s = { ...clone(f.status), now: f._scenario.now }; if (applying !== undefined) s.applying = applying; return s; };
const run = (applying, later = 2000, name) => { const s = status(applying, name); return derive(s, s.now + later); };
const EVERY = ['ropes', 'hub75', 'mode', 'target', 'rules', 'rules-reset', 'lightsroute', 'switch', 'rebuild', 'bootfile', 'calibrate'];
const SWITCH = { id: 'a1', action: 'switch', label: 'the switch to the live river', file: 'river-online-oct-23.toe', started_at: NOW - 20_000, expect_s: 60, blocks: EVERY };

test('status.applying missing, empty or junk means nothing is being applied', () => {
  for (const a of [undefined, [], 'junk', [null, 42, 'x'], {}]) {
    const m = run(a);
    assert.deepEqual(m.show.applying, [], JSON.stringify(a));
    for (const k of EVERY) assert.equal(m.controls[k].possible, true, `${JSON.stringify(a)} ${k}`);
  }
});

test('an entry blocks every action in its blocks on every phone, "wait: <label> is being applied", after the page and offline reasons, before the others', () => {
  let m = run([SWITCH]);
  for (const k of EVERY) assert.equal(m.controls[k].why, 'wait: the switch to the live river is being applied', k);
  assert.equal(m.controls.mode.dynamic.why, 'wait: the switch to the live river is being applied');
  assert.equal(m.show.applying.length, 1);
  const a = m.show.applying[0];
  assert.deepEqual([a.id, a.action, a.label, a.file, a.expect_s, a.elapsed_s], ['a1', 'switch', 'the switch to the live river', 'river-online-oct-23.toe', 60, 22]);
  assert.match(a.words, /^The switch to the live river is being applied \(started \d\d:\d\d\)$/);
  assert.deepEqual(a.blocks, EVERY);
  // the page's own contact and bitcube offline come first
  assert.equal(run([SWITCH], 40_000).controls.ropes.why, "this page can't reach mission control");
  const off = status([SWITCH]); off.bitcube.value.online = false;
  assert.equal(derive(off, NOW + 2000).controls.switch.why, 'bitcube is offline');
  // before the model's other reasons: a frozen TouchDesigner, a calibration
  m = run([{ ...SWITCH, started_at: load('td-frozen')._scenario.now - 5000 }], 2000, 'td-frozen');
  assert.equal(m.controls.ropes.why, 'wait: the switch to the live river is being applied');
  const cal = status([SWITCH]); cal.probe.value.calibration = { running: true, mode: 'full', stage: 'ropes-capture', expected_s: 170, elapsed_s: 10 };
  assert.match(derive(cal, NOW + 2000).controls.ropes.why, /^wait: /);
  // the elapsed time is on the server's clock carried forward, so it ticks between answers
  assert.equal(run([SWITCH], 12_000).show.applying[0].elapsed_s, 32);
});

test('what blocks what: a ropes change blocks the ropes only; without blocks, the contract table', () => {
  let m = run([{ id: 'r', action: 'ropes', label: 'a ropes change', started_at: NOW - 1000, expect_s: 10, blocks: ['ropes'] }]);
  assert.equal(m.controls.ropes.why, 'wait: a ropes change is being applied');
  for (const k of ['hub75', 'mode', 'switch', 'calibrate', 'rebuild']) assert.equal(m.controls[k].possible, true, k);
  m = run([{ id: 'b', action: 'bootfile', label: 'the boot file change', started_at: NOW - 1000, expect_s: 30 }]);
  for (const k of ['switch', 'rebuild', 'bootfile', 'calibrate']) assert.equal(m.controls[k].why, 'wait: the boot file change is being applied', k);
  for (const k of ['ropes', 'hub75', 'mode', 'rules']) assert.equal(m.controls[k].possible, true, k);
  m = run([{ id: 'l', action: 'lightsroute', started_at: NOW - 1000, expect_s: 30 }]);
  for (const k of ['ropes', 'hub75', 'lightsroute', 'calibrate']) assert.equal(m.controls[k].why, 'wait: a lighting port change is being applied', k);
  assert.equal(m.controls.switch.possible, true);
  for (const a of ['switch', 'rebuild']) assert.deepEqual([...APPLY_BLOCKS[a]].sort(), [...EVERY].sort(), a);
  for (const a of ['ropes', 'hub75', 'mode', 'target', 'rules', 'rules-reset']) assert.deepEqual(APPLY_BLOCKS[a], [a], a);
});

test('an entry older than 3 × expect_s and at least 2 min is ignored (a request that never ended)', () => {
  const at = (expect_s, ageS) => run([{ ...SWITCH, expect_s, started_at: NOW - ageS * 1000 }], 0).controls.ropes.possible;
  assert.equal(at(60, 179), false);
  assert.equal(at(60, 181), true);
  assert.equal(at(10, 119), false, 'never under 2 min');
  assert.equal(at(10, 121), true);
  assert.equal(at(400, 1100), false, 'a rebuild: 3 × 400 s');
  // started_at in seconds is read as seconds
  assert.equal(run([{ ...SWITCH, started_at: Math.round((NOW - 20_000) / 1000) }]).show.applying[0].elapsed_s, 22);
});

test('Rebuild and Calibrate have controls of their own: why they can or cannot run now', () => {
  let m = run();
  assert.equal(m.controls.rebuild.possible, true);
  assert.equal(m.controls.calibrate.possible, true);
  assert.equal(m.controls['rules-reset'].possible, true);
  m = run(undefined, 2000, 'seasons-not-running');
  assert.match(m.controls.rebuild.why, /river's year isn't running/);
  m = run(undefined, 2000, 'td-frozen');
  assert.equal(m.controls.rebuild.possible, false);
  assert.equal(m.controls.calibrate.why, "TouchDesigner isn't answering");
  m = run(undefined, 2000, 'gallery-cam-down');
  assert.equal(m.controls.calibrate.why, "the gallery camera isn't reachable");
  const cal = status(); cal.probe.value.calibration = { running: true, mode: 'full', stage: 'ropes-capture', expected_s: 170, elapsed_s: 10 };
  m = derive(cal, NOW + 2000);
  assert.equal(m.controls.calibrate.why, 'a calibration is already running');
  assert.match(m.controls.rebuild.why, /calibration is running/);
  m = run(undefined, 2000, 'bitcube-offline');
  for (const k of ['rebuild', 'calibrate', 'rules-reset']) assert.equal(m.controls[k].why, 'bitcube is offline', k);
});

// ---- one control ---------------------------------------------------------------------------------------------------
const T = 1_800_000_000_000;
const step = (s, type, ev = {}) => ctlStep(s, { type, now: T, ...ev });

test('a control: ready → applying (send) → done; blocked follows the model; a press while blocked or busy does nothing', () => {
  let s = ctlInit();
  assert.equal(s.state, 'ready');
  assert.equal(ctlInit('bitcube is offline').state, 'blocked');
  s = step(s, 'press');
  assert.deepEqual([s.state, s.effect, s.sentAt], ['applying', 'send', T]);
  assert.equal(step(s, 'press').effect, null, 'a second press while applying sends nothing');
  assert.equal(step(s, 'press').state, 'applying');
  const v = ctlView(s, null);
  assert.deepEqual([v.state, v.busy, v.disabled, v.lockInputs], ['applying', true, true, true]);
  s = step(s, 'ok', { confirmed: null });
  assert.deepEqual([s.state, s.effect], ['done', null]);
  assert.deepEqual([ctlView(s, null).disabled, ctlView(s, null).lockInputs], [false, false]);
  // the model's why
  s = step(ctlInit(), 'why', { why: 'bitcube is offline' });
  assert.equal(s.state, 'blocked');
  assert.deepEqual(step(s, 'press', { why: 'bitcube is offline' }).effect, null);
  assert.equal(step(s, 'why', { why: null }).state, 'ready');
  const b = ctlView(s, 'bitcube is offline');
  assert.deepEqual([b.state, b.disabled, b.lockInputs], ['blocked', true, true]);
  // a result stays a result when the model blocks the control afterwards (its words stay under the greyed button)
  const d = step(step(step(ctlInit(), 'press'), 'ok'), 'why', { why: 'bitcube is offline' });
  assert.equal(d.state, 'done');
  assert.equal(ctlView(d, 'bitcube is offline').disabled, true);
  // while applying, a new why changes nothing (the request is already out)
  const a = step(step(ctlInit(), 'press'), 'why', { why: 'wait: a ropes change is being applied' });
  assert.equal(a.state, 'applying');
});

test('confirm: yes sends, no goes back; a confirm open when the control becomes blocked is withdrawn with "Not sent"', () => {
  let s = step(ctlInit(), 'press', { confirm: true });
  assert.deepEqual([s.state, s.effect], ['confirm', 'confirm']);
  assert.deepEqual([step(s, 'yes').state, step(s, 'yes').effect], ['applying', 'send']);
  assert.equal(step(s, 'no').state, 'ready');
  assert.equal(step(s, 'no', { why: 'bitcube is offline' }).state, 'blocked');
  // the model blocks it while the sheet is up: withdrawn, focus to the status line (the page's job), nothing sent
  const w = step(s, 'why', { why: "this page can't reach mission control" });
  assert.deepEqual([w.state, w.effect, w.notSent], ['failed', 'withdraw', "this page can't reach mission control"]);
  // answered yes, but blocked meanwhile (judged again when it is answered): nothing sent
  const y = step(s, 'yes', { why: 'bitcube is offline' });
  assert.deepEqual([y.state, y.effect, y.notSent], ['failed', null, 'bitcube is offline']);
  // from a result, a new press asks again
  const again = step(step(step(step(ctlInit(), 'press'), 'error'), 'press', { confirm: true }), 'no');
  assert.equal(again.state, 'failed', 'Not now leaves the last result as it was');
});

test('confirming: a 2xx waits for the reading; done when it shows it; unconfirmed after max(3 × expect, 120) s, and it unlocks', () => {
  let s = step(step(ctlInit(), 'press'), 'ok', { confirmed: false });
  assert.deepEqual([s.state, s.answeredAt], ['confirming', T]);
  assert.deepEqual([ctlView(s, null).busy, ctlView(s, null).lockInputs, ctlView(s, null).disabled], [true, true, true]);
  assert.equal(ctlStep(s, { type: 'model', confirmed: false, now: T + 5000 }).state, 'confirming');
  assert.equal(ctlStep(s, { type: 'model', confirmed: true, now: T + 5000 }).state, 'done');
  assert.equal(ctlStep(s, { type: 'tick', expectS: 60, now: T + 179_000 }).state, 'confirming');
  const u = ctlStep(s, { type: 'tick', expectS: 60, now: T + 181_000 });
  assert.equal(u.state, 'unconfirmed');
  assert.equal(ctlView(u, null).disabled, false);
  assert.equal(ctlStep(s, { type: 'tick', expectS: 10, now: T + 119_000 }).state, 'confirming', 'at least 2 min');
  assert.equal(ctlStep(s, { type: 'tick', now: T + 121_000 }).state, 'unconfirmed');
  assert.deepEqual([confirmLimitS(60), confirmLimitS(10), confirmLimitS(400), confirmLimitS(null)], [180, 120, 1200, 120]);
  // a control whose own answer is bitcube's reading never waits
  assert.equal(step(step(ctlInit(), 'press'), 'ok', { confirmed: true }).state, 'done');
});

test('failed and unconfirmed: a refusal fails; no answer, or an answer that could not be read, is unconfirmed (it may have happened)', () => {
  const s = step(ctlInit(), 'press');
  assert.equal(step(s, 'error', { maybe: false }).state, 'failed');
  assert.equal(step(s, 'error', { maybe: true }).state, 'unconfirmed');
  for (const st of ['failed', 'unconfirmed']) assert.equal(ctlView(step(s, 'error', { maybe: st === 'unconfirmed' }), null).disabled, false, `${st} unlocks`);
  // an answer that arrives for a control no longer applying (a stale promise) changes nothing
  assert.equal(step(ctlInit(), 'ok').state, 'ready');
  assert.equal(step(ctlInit(), 'error').state, 'ready');
});

test('elapsed m:ss and "usually about" for long changes only; ticking times are for the screen, never the live region', () => {
  assert.deepEqual([0, 9, 34, 60, 65, 754].map(elapsedClock), ['0:00', '0:09', '0:34', '1:00', '1:05', '12:34']);
  assert.equal(LONG_CHANGE_S, 20);
  assert.equal(applyingWords('Applying: the switch…', 34, 60), 'Applying: the switch · 0:34 · usually about 1 min');
  assert.equal(applyingWords('Applying: a ropes change…', 3, 10), 'Applying: a ropes change…', 'a short change shows no clock');
  assert.equal(applyingWords('Rebuilding…', 75, 400), 'Rebuilding · 1:15 · usually about 7 min');
  assert.equal(applyingWords('Sending…', 5, null), 'Sending…');
  assert.equal(confirmingWords(34), 'Sent · waiting for bitcube to show it · 0:34');
});
