// The Status page's words and form rules (public/status-words.js), in node: the forms keep units and ranges in the box's
// own unit (R5 #18), the switch says it changes the boot file (R5 #36), a control's status line in each state of the
// contract, the tiles never repeat their state word (R5 #25), and the room's still after waking with no network (R5 #4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, dur, ctlInit, ctlStep } from '../public/model.js';
import { ruleLabel, ruleRange, ruleError, rulesForm, targetForm, modeEffect, switchWords, switchShows, bootShows, bootWords, controlLine,
  failText, notSentText, applyingLine, ropesTile, panelsTile, stillDue, rowFromHash, ROPES_STATE, PANELS_STATE } from '../public/status-words.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const run = (f, later = 2000) => derive({ ...f.status, now: f._scenario.now }, f._scenario.now + later);
const RULES = fx('all-good').status.seasons.value.rules;
const item = (m, id) => m.items.find((x) => x.id === id);

test('Rules: the unit beside the box, the range in the box unit, never minutes beside a box of seconds (R5 #18)', () => {
  assert.equal(ruleRange(RULES.cycle_seconds), '60 to 1800 s');
  assert.equal(ruleRange(RULES.warmer), '1.05 to 3 × usual');
  assert.equal(ruleLabel(RULES.cycle_seconds.label), 'Length of the year, in Automatic');
  assert.equal(ruleLabel(RULES.usual_window.label), 'Usual presence is the middle value over the last');
  for (const r of Object.values(RULES)) assert.doesNotMatch(ruleRange(r), /min\b/, r.label);
  assert.equal(ruleError(RULES.cycle_seconds, '5'), 'Must be 60 to 1800 s', 'a 5 typed for "5 minutes" is out of range, and says so');
  assert.equal(ruleError(RULES.cycle_seconds, ''), 'Must be 60 to 1800 s');
  assert.equal(ruleError(RULES.cycle_seconds, 'abc'), 'Must be 60 to 1800 s');
  assert.equal(ruleError(RULES.cycle_seconds, '300'), null);
  assert.equal(ruleError(RULES.warmer, '0.9'), 'Must be 1.05 to 3 × usual');
});

test('Rules form: Apply only when something changed and all is valid, and says how many; the draft and "now N on bitcube"', () => {
  let f = rulesForm(RULES, {});
  assert.deepEqual([f.count, f.canApply, f.label], [0, false, 'Apply']);
  assert.equal(f.fields.cycle_seconds.shown, '240');
  assert.equal(f.fields.cycle_seconds.now, null);
  f = rulesForm(RULES, { cycle_seconds: '300', empty_seconds: '90' });
  assert.deepEqual([f.count, f.canApply, f.label], [2, true, 'Apply 2 changes']);
  assert.deepEqual(f.changed, { cycle_seconds: 300, empty_seconds: 90 });
  assert.equal(f.fields.cycle_seconds.now, 'now 240 s on bitcube');
  // typed back to bitcube's value: not a change
  f = rulesForm(RULES, { cycle_seconds: '240' });
  assert.deepEqual([f.count, f.label], [0, 'Apply']);
  // one out of range: its error, Apply off, the count still says what was typed
  f = rulesForm(RULES, { cycle_seconds: '5', empty_seconds: '90' });
  assert.equal(f.fields.cycle_seconds.error, 'Must be 60 to 1800 s');
  assert.deepEqual([f.count, f.canApply, f.invalid, f.label], [2, false, true, 'Apply 2 changes']);
  assert.deepEqual(f.changed, { empty_seconds: 90 });
  // another phone changed it meanwhile: the draft stays, and says what bitcube has now
  const other = JSON.parse(JSON.stringify(RULES)); other.cycle_seconds.value = 600;
  f = rulesForm(other, { cycle_seconds: '300' });
  assert.equal(f.fields.cycle_seconds.shown, '300');
  assert.equal(f.fields.cycle_seconds.now, 'now 600 s on bitcube');
  // the ranges keep Quieter than usual (at most 0.95) below Busier than usual (at least 1.05)
  assert.equal(rulesForm(RULES, { cooler: '1.5' }).fields.cooler.error, 'Must be 0.1 to 0.95 × usual');
  assert.equal(rulesForm(RULES, { warmer: '0.6' }).fields.warmer.error, 'Must be 1.05 to 3 × usual');
});

test('Target form: how many changes, and the draft never overwritten by another phone', () => {
  let t = targetForm({ season: 'summer', intensity: 0.8 }, {});
  assert.deepEqual([t.season, t.intensity, t.count, t.canApply, t.label], ['summer', 0.8, 0, false, 'Apply']);
  t = targetForm({ season: 'summer', intensity: 0.8 }, { season: 'winter', intensity: 0.2 });
  assert.deepEqual([t.count, t.canApply, t.label, t.nowSeason, t.nowIntensity], [2, true, 'Apply 2 changes', 'now summer on bitcube', 'now 0.8 on bitcube']);
  t = targetForm(null, { season: 'spring' }, 0.4);
  assert.deepEqual([t.season, t.intensity, t.count, t.canApply], ['spring', 0.4, 1, true]);
  assert.equal(targetForm(null, {}, 0.4).canApply, false, 'no season chosen: nothing to send');
});

test("the mode's effect line takes Automatic's pace from the year-length rule", () => {
  assert.match(modeEffect(RULES), /^Automatic turns the year by itself, one season a minute\./);
  assert.match(modeEffect({ cycle_seconds: { value: 600 } }), /one season every 2\.5 min\./);
  assert.match(modeEffect(null), /^Automatic turns the year by itself\. /);
});

test('the switch says it also changes the boot file, in the confirm and the result, only when it does (R5 #36)', () => {
  const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
  const yearBoot = { name: YEAR, label: "the river's year", default: true };
  let w = switchWords(LIVE, YEAR, yearBoot);
  assert.equal(w.title, 'Switch to the live river now?');
  assert.equal(w.ok, 'Switch to the live river');
  assert.match(w.body, /the lights go dark for about a minute/);
  assert.match(w.body, /The live river also opens at boot from now on/);
  assert.equal(w.done, 'Now showing the live river; it also opens at boot from now on');
  assert.equal(w.what, 'the switch to the live river');
  // a restart on the boot file changes nothing at boot: it doesn't say so
  w = switchWords(YEAR, YEAR, yearBoot);
  assert.deepEqual([w.verb, w.setsBoot, w.done, w.what], ['Restart on', false, "Now showing the river's year", "the restart on the river's year"]);
  assert.doesNotMatch(w.body, /boot/);
  // the boot file not known: it says so (probe.ps1 writes it either way)
  assert.equal(switchWords(YEAR, LIVE, null).setsBoot, true);
  const m = run(fx('all-good'));
  assert.equal(switchShows(m, YEAR), true);
  assert.equal(switchShows(m, LIVE), false);
  assert.equal(switchShows(run(fx('td-frozen')), YEAR), false, 'TouchDesigner not answering never confirms a switch');
  assert.equal(bootShows(m, m.show.boot_file?.name), true);
  assert.equal(bootWords(yearBoot), "the river's year (by default)");
  assert.equal(bootWords({ ...yearBoot, default: false }), "the river's year");
});

test("a control's status line in each state: applying (m:ss and the usual time when long), confirming, done, failed, unconfirmed", () => {
  const t0 = 1_000_000;
  let s = ctlStep(ctlInit(), { type: 'press', now: t0 });
  let c = { s, applyText: 'Applying: the switch to the live river…', expectS: 60 };
  assert.deepEqual(controlLine(c, t0 + 23_000), { cls: 'pending applying', spin: true, text: 'Applying: the switch to the live river · 0:23 · usually about 1 min' });
  c = { s, applyText: 'Applying: ropes dark…', expectS: 15 };
  assert.equal(controlLine(c, t0 + 3000).text, 'Applying: ropes dark…', 'a short change: no ticking time');
  s = ctlStep(s, { type: 'ok', confirmed: false, now: t0 + 6000 });
  assert.deepEqual(controlLine({ s }, t0 + 34_000), { cls: 'pending confirming', spin: true, text: 'Sent · waiting for bitcube to show it · 0:34' });
  for (const st of ['done', 'failed', 'unconfirmed']) assert.deepEqual(controlLine({ s: { state: st }, text: 'x' }, t0), { cls: st, spin: false, text: 'x' });
  assert.equal(controlLine(undefined, t0).text, '');
});

test('a failure in words: a 409 reads as the server wrote it, a refusal that says "apply again" adds nothing', () => {
  const e409 = Object.assign(new Error('wait: the switch to the live river is being applied (started 21:04)'), { status: 409 });
  assert.equal(failText('The ropes are unchanged', e409, '21:05'), 'The ropes are unchanged: the switch to the live river is being applied (started 21:04). Try again when it is done.');
  const e502 = Object.assign(new Error('HTTP 502'), { status: 502 });
  assert.equal(failText('The ropes are unchanged', e502, '21:05'), "The ropes are unchanged: mission control couldn't reach bitcube (21:05). Try again, or see the verdict above.");
  const refused = Object.assign(new Error('"quieter" must be below "busier"'), { status: 400 });
  assert.match(failText('The rules are unchanged', refused, '21:05'), /apply again \(21:05\)\.$/);
});

test('a confirm withdrawn, or a press found impossible when answered: "Not sent: <why>", never "wait:"', () => {
  assert.equal(notSentText('bitcube is offline', '21:04'), 'Not sent: bitcube is offline (21:04).');
  assert.equal(notSentText('wait: the switch to the live river is being applied', '21:04'), 'Not sent: the switch to the live river is being applied (21:04).');
  assert.equal(notSentText(null, '21:04'), "Not sent: this page can't reach mission control (21:04).");
});

test("another phone's change on the band: 'Applying: <label> · 0:23', with the usual time when it is long", () => {
  assert.equal(applyingLine({ label: 'the switch to the live river', expect_s: 60 }, 23), 'Applying: the switch to the live river · 0:23 · usually about 1 min');
  assert.equal(applyingLine({ label: 'a ropes change', expect_s: 15 }, 4), 'Applying: a ropes change · 0:04');
});

test('the tiles: calibration patterns with the time left, and a second line that never repeats the state word (R5 #25)', () => {
  const cal = fx('all-good'); cal.status.probe.value.calibration = { running: true, mode: 'full', dry_run: false, stage: 'hub75-capture', expected_s: 35, elapsed_s: 210 };
  let m = run(cal);
  let r = ropesTile(m, item(m, 'ropes'), false), p = panelsTile(m, item(m, 'hub75 panels'));
  assert.equal(r.state, 'In calibration patterns');
  assert.equal(r.words, `about ${dur(m.show.calibration.left_s)} more · stop it on the Lights page`);
  assert.equal(p.state, 'In calibration patterns');
  assert.equal(p.words, r.words);
  assert.equal(ROPES_STATE.calibrating, PANELS_STATE.calibrating);
  for (const n of ['all-good', 'lights-not-connected', 'td-frozen', 'bitcube-offline', 'ropes-dark-on-purpose', 'just-booted', 'river-cam-stale', 'seasons-not-running', 'td-low-fps', 'nothing-known-yet']) {
    m = run(fx(n));
    const bothDown = item(m, 'rope box 1')?.level === 'down' && item(m, 'rope box 2')?.level === 'down';
    r = ropesTile(m, item(m, 'ropes'), bothDown); p = panelsTile(m, item(m, 'hub75 panels'));
    for (const t of [r, p]) {
      assert.ok(t.state && t.words, `${n}: ${JSON.stringify(t)}`);
      assert.ok(!t.words.toLowerCase().startsWith(t.state.toLowerCase()), `${n}: "${t.state}" / "${t.words}"`);
    }
  }
  m = run(fx('lights-not-connected'));
  assert.deepEqual(panelsTile(m, item(m, 'hub75 panels')), { state: 'No panel sender', words: "bitcube doesn't see it on its HDMI" });
});

test("the room's still: due again when contact returns after a failed wake-up try, not only after 30 s (R5 #4)", () => {
  const now = 1_000_000;
  assert.equal(stillDue({ now, tried: now - 5000, netFailed: true }, 30_000), true, 'the wake-up try failed for want of a network');
  assert.equal(stillDue({ now, tried: now - 5000, netFailed: false }, 30_000), false);
  assert.equal(stillDue({ now, tried: now - 31_000, netFailed: false }, 30_000), true);
  assert.equal(stillDue({ now, tried: 0, netFailed: false }, 30_000), true);
});

test('a link to /status#r-<item> names its row', () => {
  assert.equal(rowFromHash('#r-hub75-panels'), 'r-hub75-panels');
  assert.equal(rowFromHash('#r-rope%20box%201'), null);
  assert.equal(rowFromHash('#steer'), null);
  assert.equal(rowFromHash(''), null);
  assert.equal(rowFromHash('#r-%E0%A4%A'), null);
});
