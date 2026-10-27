// Applying a change (docs/mission-ui.md "Applying a change"): status.applying as locks across phones in derive(), and the
// states of one control (ctlStep, the pure rules ui.js control() and status.js follow), run in node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, ctlInit, ctlStep, ctlView, confirmLimitS, elapsedClock, applyingWords, confirmingWords, APPLY_BLOCKS, LONG_CHANGE_S,
  usualWords, applyingText, entryWords, unconfirmedWords, notSentWords, failWords, CONFIRMING_SAID, sansTime } from '../public/model.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const AG = load('all-good'), NOW = AG._scenario.now;
const status = (applying, name = 'all-good') => { const f = name === 'all-good' ? AG : load(name); const s = { ...clone(f.status), now: f._scenario.now }; if (applying !== undefined) s.applying = applying; return s; };
const run = (applying, later = 2000, name) => { const s = status(applying, name); return derive(s, s.now + later); };
const EVERY = ['ropes', 'hub75', 'test', 'mode', 'target', 'rules', 'rules-reset', 'lightsroute', 'switch', 'rebuild', 'bootfile', 'calibrate'];
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

test('what blocks what: a ropes change blocks the ropes, and what would block it waits for it; without blocks, the contract table', () => {
  let m = run([{ id: 'r', action: 'ropes', label: 'a ropes change', started_at: NOW - 1000, expect_s: 10, blocks: ['ropes'] }]);
  for (const k of ['ropes', 'switch', 'calibrate', 'rebuild']) assert.equal(m.controls[k].why, 'wait: a ropes change is being applied', k);
  for (const k of ['hub75', 'mode']) assert.equal(m.controls[k].possible, true, k);
  m = run([{ id: 'b', action: 'bootfile', label: 'the change of the default', started_at: NOW - 1000, expect_s: 30 }]);
  for (const k of ['switch', 'rebuild', 'bootfile', 'calibrate']) assert.equal(m.controls[k].why, 'wait: the change of the default is being applied', k);
  for (const k of ['ropes', 'hub75', 'mode', 'rules']) assert.equal(m.controls[k].possible, true, k);
  m = run([{ id: 'l', action: 'lightsroute', started_at: NOW - 1000, expect_s: 30 }]);
  for (const k of ['ropes', 'hub75', 'lightsroute', 'calibrate', 'switch', 'rebuild']) assert.equal(m.controls[k].why, 'wait: the change of the lighting port is being applied', k);
  assert.equal(m.controls.mode.possible, true, 'the year is not touched by the lighting port');
  for (const a of ['switch', 'rebuild']) assert.deepEqual([...APPLY_BLOCKS[a]].sort(), [...EVERY, 'overlay', 'modalinput'].sort(), a);
  for (const a of ['hub75', 'mode', 'target']) assert.deepEqual(APPLY_BLOCKS[a], [a], a);
  // the ropes button and the test pattern both set the ropes' source: each waits for the other (and a calibration for the test)
  assert.deepEqual(APPLY_BLOCKS.ropes, ['ropes', 'test']);
  assert.deepEqual(APPLY_BLOCKS.test, ['test', 'ropes', 'calibrate']);
  // the rules and their reset change the same thing: each waits for the other
  assert.deepEqual(APPLY_BLOCKS.rules, ['rules', 'rules-reset']);
  assert.deepEqual(APPLY_BLOCKS['rules-reset'], ['rules-reset', 'rules']);
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

test('elapsed m:ss and "usually about" for long changes (short ones once past their usual time); ticking times are for the screen, never the live region', () => {
  assert.deepEqual([0, 9, 34, 60, 65, 754].map(elapsedClock), ['0:00', '0:09', '0:34', '1:00', '1:05', '12:34']);
  assert.equal(LONG_CHANGE_S, 20);
  assert.equal(applyingWords('Applying: the switch…', 34, 60), 'Applying: the switch · 0:34 · usually about 1\u00a0min');
  assert.equal(applyingWords('Applying: a ropes change…', 3, 10), 'Applying: a ropes change…', 'a short change shows no clock within its usual time');
  assert.equal(applyingWords('Rebuilding…', 75, 400), 'Rebuilding · 1:15 · usually about 6.5\u00a0min');
  assert.equal(applyingWords('Sending…', 5, null), 'Sending…');
  assert.equal(confirmingWords(34), 'Sent · waiting for bitcube to show it · 0:34');
});

test('code review: the pages lock both ways too, from one table shared with the server', async () => {
  const { BLOCKS } = await import('../lib/applying.mjs');
  assert.equal(BLOCKS, APPLY_BLOCKS, 'one table: lib/applying.mjs takes model.js APPLY_BLOCKS');
  const f = JSON.parse(readFileSync(new URL('./fixtures/all-good.json', import.meta.url), 'utf8'));
  const st = { ...f.status, now: f._scenario.now, applying: [{ id: 'a1', action: 'ropes', label: 'a ropes change', started_at: f._scenario.now, expect_s: 15, blocks: ['ropes'] }] };
  const m = derive(st, st.now + 1000);
  assert.match(m.controls.switch.why ?? '', /^wait: a ropes change is being applied/, 'a switch would restart TouchDesigner under the ropes change');
  assert.match(m.controls.ropes.why ?? '', /^wait: a ropes change/);
  assert.equal(m.controls.mode.why, null, 'a ropes change does not touch the mode');
});

test('code review: the boot file reads "(by default)" from the probe\'s own boot_file_chosen flag', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/all-good.json', import.meta.url), 'utf8'));
  const at = (chosen) => { const st = { ...f.status, now: f._scenario.now }; st.probe = { ...st.probe, value: { ...st.probe.value, boot_file: 'river-local-oct-22-seasons.toe', boot_file_chosen: chosen } }; return derive(st, st.now + 1000).show.boot_file; };
  assert.equal(at(false).default, true, 'no boot-file.txt: the seasons file by default');
  assert.equal(at(true).default, false);
  assert.equal(at(undefined).default, false, 'an older probe without the flag');
});

// ---- round 6 -------------------------------------------------------------------------------------------------------------
const YEAR = 'river-local-oct-22-seasons.toe';
const TO_YEAR = { ...SWITCH, label: "the switch to the river's year", file: YEAR };
/** all-good with TouchDesigner as the full check reads it in the minute after a switch, and the switch's entry still kept. */
const afterSwitch = (td, entries, later = 2000) => { const s = status(entries); s.probe.value.td = td; return derive(s, s.now + later); };
const SAID = (m) => [m.overall.headline, m.overall.detail, m.overall.action, ...m.items.flatMap((x) => [x.summary, x.detail, x.action])].filter(Boolean);

test('R6 #26: a switch or rebuild still in status.applying reads TouchDesigner not running, not answering or frozen as restarting on its file, never Down or "press Switch"', () => {
  const tds = [{ ok: false, error: 'not running' }, { ok: false, error: 'no answer from the TD bridge' }, { ok: false, error: 'TD bridge timed out after 15 s' }];
  for (const td of tds) for (const phase of [undefined, 'applying', 'confirming']) {
    const m = afterSwitch(td, [{ ...TO_YEAR, phase }]);
    const at = `${td.error} / ${phase}`;
    assert.equal(m.overall.cause, 'td-restarting', at);
    assert.equal(m.overall.level, 'warning', at);
    assert.equal(m.overall.headline, "TouchDesigner is restarting on the river's year", at);
    const tdItem = m.items.find((x) => x.id === 'touchdesigner');
    assert.deepEqual([tdItem.level, tdItem.summary], ['warning', "Restarting on the river's year"], at);
    for (const id of ['touchdesigner', 'seasons', 'ropes', 'hub75 panels']) assert.notEqual(m.items.find((x) => x.id === id).level, 'down', `${at} ${id}`);
    for (const s of SAID(m)) assert.doesNotMatch(s, /press (Switch|Restart)|Start it with|frozen|not running/i, `${at}: ${s}`);
    assert.match(m.controls.switch.why, /^wait: the switch to the river's year/, 'Switch stays blocked by the entry');
    assert.equal(m.show.panels.state, 'restarting');
  }
  // a rebuild ends in a switch to the river's year: the same, on the river's year
  const r = afterSwitch({ ok: false, error: 'not running' }, [{ id: 'b', action: 'rebuild', label: "the rebuild of the river's year", file: YEAR, started_at: NOW - 90_000, expect_s: 150 }]);
  assert.equal(r.overall.headline, "TouchDesigner is restarting on the river's year");
  // the live river: its own label
  const live = afterSwitch({ ok: false, error: 'not running' }, [SWITCH]);
  assert.equal(live.overall.headline, 'TouchDesigner is restarting on the live river');
  // without the entry, or with one past its limit, or with an entry that restarts nothing, the same reading is the fault it is
  assert.equal(afterSwitch({ ok: false, error: 'not running' }, []).overall.cause, 'td-off');
  assert.equal(afterSwitch({ ok: false, error: 'no answer from the TD bridge' }, []).overall.cause, 'td-frozen');
  assert.equal(afterSwitch({ ok: false, error: 'not running' }, [{ ...TO_YEAR, started_at: NOW - 200_000 }]).overall.cause, 'td-off', 'an entry older than 3 min no longer covers it');
  assert.equal(afterSwitch({ ok: false, error: 'not running' }, [{ id: 'r', action: 'ropes', label: 'a ropes change', started_at: NOW - 1000, expect_s: 15 }]).overall.cause, 'td-off');
  // TouchDesigner still answering on the old file (the check before the restart): as it is, with the switch's lock
  const before = afterSwitch(clone(AG.status.probe.value.td), [TO_YEAR]);
  assert.equal(before.overall.level, 'ok');
  assert.match(before.controls.switch.why, /^wait: /);
});

test('R6 #0: confirming turns unconfirmed only once a reading taken after the limit was judged; a reading that shows it turns unconfirmed into done', () => {
  const c = step(step(ctlInit(), 'press'), 'ok', { confirmed: false });
  const tick = (now, readAt) => ctlStep(c, { type: 'tick', expectS: 60, now, readAt }).state;
  assert.equal(tick(T + 3_600_000, null), 'confirming', 'a phone that slept an hour: no reading judged since it woke');
  assert.equal(tick(T + 3_600_000, T + 30_000), 'confirming', 'the last reading judged is from before the limit');
  assert.equal(tick(T + 3_600_000, T + 3_599_000), 'unconfirmed', 'a reading after the limit was judged and did not show it');
  assert.equal(tick(T + 181_000, undefined), 'unconfirmed', 'a caller that tracks no readings: by the clock alone');
  const u = ctlStep(c, { type: 'tick', expectS: 60, now: T + 181_000 });
  const d = ctlStep(u, { type: 'model', confirmed: true, now: T + 200_000 });
  assert.equal(d.state, 'done', 'a later reading that shows the change');
  assert.equal(ctlStep(u, { type: 'model', confirmed: false, now: T + 200_000 }).state, 'unconfirmed');
  // no answer (it may or may not have happened), then a reading that shows it: done
  assert.equal(ctlStep(step(step(ctlInit(), 'press'), 'error', { maybe: true }), { type: 'model', confirmed: true, now: T + 5000 }).state, 'done');
  assert.equal(ctlStep(step(step(ctlInit(), 'press'), 'error', { maybe: false }), { type: 'model', confirmed: true, now: T + 5000 }).state, 'failed', 'a refusal stays a refusal');
});

test('R6 #30: a done line gives way to a newer reading that differs (once the change was seen, or after a minute)', () => {
  const d = step(step(ctlInit(), 'press'), 'ok');
  const r = (s, holds, dt, why = null) => ctlStep(s, { type: 'reading', holds, why, now: T + dt });
  assert.equal(r(d, false, 5000).state, 'done', 'not seen yet: the reading may lag the answer by a few seconds');
  const seen = r(d, true, 5000);
  assert.deepEqual([seen.state, seen.seen], ['done', true]);
  assert.deepEqual([r(seen, false, 8000).state, r(seen, false, 8000).effect], ['ready', 'drop']);
  assert.equal(r(seen, false, 8000, 'bitcube is offline').state, 'blocked');
  assert.equal(r(d, false, 61_000).state, 'ready', 'never seen, and a minute on');
  assert.equal(r(d, undefined, 61_000).state, 'done', 'a control that says nothing about the reading keeps its line');
  assert.equal(r(step(step(ctlInit(), 'press'), 'error'), false, 61_000).state, 'failed', 'only a done line gives way');
});

test('R6 #1 #12 #17: one set of words on every page: a short change past its usual time shows m:ss, the waiting line its usual time, numbers kept with their units', () => {
  const NB = ' ';
  assert.equal(applyingWords('Applying: ropes dark…', 3, 15), 'Applying: ropes dark…');
  assert.equal(applyingWords('Applying: ropes dark…', 16, 15), 'Applying: ropes dark · 0:16 · usually a few seconds');
  assert.equal(applyingWords('Sending…', 5, null), 'Sending…');
  assert.equal(applyingWords('Sending…', 11, null), 'Sending · 0:11 · usually a few seconds', 'no usual time given: a few seconds');
  assert.equal(applyingWords('Applying: the switch…', 34, 60), `Applying: the switch · 0:34 · usually about 1${NB}min`);
  assert.equal(applyingWords('Applying: the rebuild…', 75, 150), `Applying: the rebuild · 1:15 · usually about 2.5${NB}min`, '150 s is 2.5 min, never 3');
  assert.equal(usualWords(150), `usually about 2.5${NB}min`);
  assert.equal(usualWords(15), 'usually a few seconds');
  assert.equal(usualWords(45), `usually about 45${NB}s`);
  assert.equal(confirmingWords(34, 60), `Sent · waiting for bitcube to show it · 0:34 · usually about 1${NB}min`);
  assert.equal(confirmingWords(6, "bitcube's full check shows it within a minute"), "Sent · waiting for bitcube to show it · 0:06 · bitcube's full check shows it within a minute");
  assert.equal(confirmingWords(34), 'Sent · waiting for bitcube to show it · 0:34');
  assert.equal(CONFIRMING_SAID, 'Sent; waiting for bitcube to show it');
  assert.equal(applyingText("the rebuild of the river's year"), "Applying: the rebuild of the river's year…");
  // another phone's change on the band, applying and then confirming
  assert.equal(entryWords({ label: 'the switch to the live river', expect_s: 60 }, 23), `Applying: the switch to the live river · 0:23 · usually about 1${NB}min`);
  assert.equal(entryWords({ label: 'a ropes change', expect_s: 15 }, 3), 'Applying: a ropes change · 0:03 · usually a few seconds');
  assert.equal(entryWords({ label: 'the switch to the live river', expect_s: 60, phase: 'confirming' }, 40), `Waiting for bitcube to show the switch to the live river · 0:40 · usually about 1${NB}min`);
});

test('R6 #16 #4: an unconfirmed change names what was sent; a withdrawn confirm is said in the past tense', () => {
  assert.equal(unconfirmedWords('the change of the default to the live river', '21:13', 'look at the Now line, or call Gavin'),
    "The change of the default to the live river was sent at 21:13, but bitcube didn't show it in time: look at the Now line, or call Gavin.");
  assert.equal(unconfirmedWords(null, '21:13', 'look at the Now line, or call Gavin'), "Sent at 21:13, but bitcube didn't show it in time: look at the Now line, or call Gavin.");
  assert.equal(notSentWords("wait: the restart on the river's year is being applied", '21:17'), "Not sent at 21:17: the restart on the river's year was being applied. Press again when it is done.");
  assert.equal(notSentWords('bitcube is offline', '21:04'), 'Not sent at 21:04: bitcube is offline.');
  assert.equal(notSentWords(null, '21:04'), "Not sent at 21:04: this page can't reach mission control.");
});

test('R6 #14: a change refused because a calibration is running says to stop it or wait, never "try again" alone', () => {
  assert.equal(failWords('The ropes are unchanged', 'a calibration is running. Stop it on the Lights page first', '21:14'),
    'The ropes are unchanged: a calibration is running (21:14). Stop it on the Lights page, or try again when it ends.');
  assert.equal(failWords('The ropes are unchanged', "wait: the switch to the live river is being applied (started 21:04)", '21:05'),
    'The ropes are unchanged: the switch to the live river was being applied (started 21:04). Press again when it is done.');
  assert.equal(failWords('The ropes are unchanged', "bitcube didn't answer", '21:04'), "The ropes are unchanged: bitcube didn't answer (21:04). Try again, or see the verdict above.");
  assert.equal(failWords('The ropes are unchanged', "bitcube didn't answer", '21:04', { tail: 'Try again, or check Status.' }), "The ropes are unchanged: bitcube didn't answer (21:04). Try again, or check Status.");
  assert.equal(failWords('The rules are unchanged', 'no answer', '21:04', { kept: 'What you typed is kept.' }), 'The rules are unchanged: no answer (21:04). What you typed is kept. Try again, or see the verdict above.');
});

test('R6 #8: a live region tells a new headline from the same one with a time that moved on', () => {
  const a = 'Attention. Calibrating the lights: the ropes are in patterns for about 40 s more.';
  assert.equal(sansTime(a), sansTime('Attention. Calibrating the lights: the ropes are in patterns for about 4 min more.'));
  assert.equal(sansTime('Attention. bitcube restarted 6 min ago and is still coming up.'), sansTime('Attention. bitcube restarted 7\u00a0min ago and is still coming up.'));
  assert.notEqual(sansTime(a), sansTime('Attention. Calibrating the lights: the ropes are in patterns, nearly done.'));
  assert.notEqual(sansTime(a), sansTime('Attention. The ropes are dark on purpose; everything else is up.'));
});
