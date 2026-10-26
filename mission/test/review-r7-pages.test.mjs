// Round 7, the pages: a page knows its own change by the entry's id (applying_id) and takes the server's verdict on it
// (status.confirmed / status.expired), never a file name; Last done never says done while the server is still confirming;
// Lights never says a start or a rebuild is done before the server does, and a run that just ended doesn't block Rebuild.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, ctlInit, ctlStep, entryVerdict, entryWords, confirmLimitS } from '../public/model.js';
import { lastDoneParts } from '../public/status-words.js';
import { applyingNow, calNewer, stateLive } from '../public/lights-words.js';
import { noAnswerText } from '../public/app.js';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const fx = JSON.parse(readFileSync(new URL('./fixtures/all-good.json', import.meta.url), 'utf8'));
const NOW = fx._scenario.now;
const status = (extra = {}) => ({ ...JSON.parse(JSON.stringify(fx.status)), now: NOW, ...extra });
const at = (extra) => derive(status(extra), NOW + 1000);
const RESTART = { id: 'ax.7', action: 'switch', label: "the restart on the river's year", file: YEAR, source: 'mission control', phase: 'confirming',
                  started_at: NOW - 20_000, answered_at: NOW - 10_000, expect_s: 60, blocks: ['switch', 'ropes'] };

test('derive serves the server\'s verdicts (status.confirmed, status.expired); entryVerdict reads one entry\'s by its id', () => {
  const m = at({ applying: [RESTART], confirmed: [{ id: 'ax.3', action: 'switch', file: YEAR, started_at: NOW - 400_000, at: NOW - 300_000 }, null, 'junk'],
                 expired: [{ id: 'ax.5', action: 'bootfile', file: LIVE, started_at: NOW - 200_000, at: NOW - 30_000, maybe: true }] });
  // R8 #2, #9: each also carries its request id, its label (an older server: the action's words) and source, and whether it was a maybe
  assert.deepEqual(m.show.confirmed, [{ id: 'ax.3', request_id: null, action: 'switch', file: YEAR, label: 'a show-file switch', source: null, maybe: false, at: NOW - 300_000 }]);
  assert.deepEqual(m.show.expired, [{ id: 'ax.5', request_id: null, action: 'bootfile', file: LIVE, label: 'the change of the boot file', source: null, maybe: true, at: NOW - 30_000 }]);
  assert.equal(entryVerdict(m, 'ax.3'), 'confirmed');
  assert.equal(entryVerdict(m, 'ax.5'), 'expired');
  assert.equal(entryVerdict(m, 'ax.7'), 'pending', 'still in status.applying: the server is still confirming it');
  assert.equal(entryVerdict(m, 'ax.9'), null, 'not known (an older server, or forgotten after 10 min)');
  assert.equal(entryVerdict(m, null), null);
  assert.deepEqual([at({}).show.confirmed, at({}).show.expired], [[], []], 'an older server sends none');
});

test('R7 #6, #25: a restart is confirmed only by the server\'s verdict on its own entry, never because the reading names the file it already ran', () => {
  // the page's restart answered; the reading (from before the restart, or the old TouchDesigner) names the same file
  let s = ctlStep(ctlStep(ctlInit(), { type: 'press', now: 1 }), { type: 'ok', confirmed: false, now: 2 });
  const m = at({ applying: [RESTART] });
  assert.equal(m.show.file.name, YEAR, 'the reading names the file');
  assert.equal(entryVerdict(m, 'ax.7'), 'pending', 'but the server has not confirmed the restart');
  // the server confirms it: done
  const m2 = at({ confirmed: [{ id: 'ax.7', action: 'switch', file: YEAR, started_at: NOW - 20_000, at: NOW - 1000 }] });
  assert.equal(ctlStep(s, { type: 'model', confirmed: entryVerdict(m2, 'ax.7') === 'confirmed', now: 3 }).state, 'done');
  // the server gave up on it: unconfirmed at once (no need to wait for this phone's own limit)
  s = ctlStep(s, { type: 'expired', now: 4 });
  assert.equal(s.state, 'unconfirmed');
  // a later verdict that it was confirmed after all still ends it done (a maybe that showed)
  assert.equal(ctlStep(s, { type: 'model', confirmed: true, now: 5 }).state, 'done');
  // 'expired' only moves a change that is waiting
  assert.equal(ctlStep(ctlInit(), { type: 'expired', now: 6 }).state, 'ready');
});

test('a page\'s own limit counts from the answer, as the server\'s does (a slow rebuild keeps its whole limit)', () => {
  const T = 1_000_000;
  let s = ctlStep(ctlInit(), { type: 'press', now: T });
  s = ctlStep(s, { type: 'ok', confirmed: false, now: T + 300_000 });          // a rebuild that took 5 min to answer
  const lim = confirmLimitS(150) * 1000;
  assert.equal(ctlStep(s, { type: 'tick', expectS: 150, now: T + lim + 1000 }).state, 'confirming', 'past the limit from the press, not from the answer');
  assert.equal(ctlStep(s, { type: 'tick', expectS: 150, now: T + 300_000 + lim + 1000 }).state, 'unconfirmed');
});

test('R7 #15: a change the server got no answer for reads as that on the other phones, not as an ordinary change in progress', () => {
  const w = entryWords({ ...RESTART, label: 'the switch to the live river', maybe: true }, 75);
  assert.equal(w, 'No answer in time for the switch to the live river: waiting for bitcube to show whether it happened · 1:15');
  assert.equal(entryWords({ ...RESTART, maybe: true, source: 'studio chat' }, 5), "No answer in time for the restart on the river's year: waiting for bitcube to show whether it happened · from the studio chat · 0:05");
  assert.equal(entryWords(RESTART, 14), "Waiting for bitcube to show the restart on the river's year · 0:14 · usually about 1\u00a0min");
});

test('R7 #3, #16, #28: Last done says "Last sent … waiting for bitcube to show it" while the server is still confirming it, "didn\'t show it" when it gave up', () => {
  const a = { action: 'switch', ok: true, applying_id: 'ax.7', t: NOW - 10_000 };
  assert.deepEqual(lastDoneParts(a, status({ applying: [RESTART] })), { head: 'Last sent', tail: ' · waiting for bitcube to show it' });
  assert.deepEqual(lastDoneParts(a, status({ expired: [{ id: 'ax.7', action: 'switch', at: NOW }] })), { head: 'Last sent', tail: " · bitcube didn't show it in time" });
  assert.deepEqual(lastDoneParts(a, status({ confirmed: [{ id: 'ax.7', action: 'switch', at: NOW }] })), { head: 'Last done', tail: '' });
  // an entry the server no longer lists (over 10 min ago, or a restart): the verdict the history kept, else only "sent" (CR7 #5)
  assert.deepEqual(lastDoneParts({ ...a, verdict: 'confirmed' }, status()), { head: 'Last done', tail: '' });
  assert.deepEqual(lastDoneParts(a, status()), { head: 'Last sent', tail: '' }, 'no verdict known: never "done"');
  assert.deepEqual(lastDoneParts({ ...a, applying_id: undefined }, status({ applying: [RESTART] })), { head: 'Last sent', tail: '' }, 'an older history line without an id');
  // a maybe the server then confirmed is done; one it still holds is sent; one with no lock says it may or may not have happened
  const mb = { ...a, ok: false, maybe: true };
  assert.deepEqual(lastDoneParts(mb, status({ confirmed: [{ id: 'ax.7', action: 'switch', at: NOW }] })), { head: 'Last done', tail: '' });
  assert.deepEqual(lastDoneParts(mb, status({ applying: [{ ...RESTART, maybe: true }] })), { head: 'Last sent', tail: ' · no answer in time; waiting for bitcube to show whether it happened' });
  assert.deepEqual(lastDoneParts({ action: 'ropes', ok: false, maybe: true, t: NOW }, status()), { head: 'Last sent', tail: ' · no answer in time: it may or may not have happened' });
  assert.deepEqual(lastDoneParts({ action: 'ropes', ok: false, note: 'TouchDesigner did not answer', t: NOW }, status()), { head: 'Last tried', tail: ' · failed: TouchDesigner did not answer' });
});

test('R7 #14, #15: Lights leaves this page\'s own change out of the state line by its id, whatever its control\'s state', () => {
  const m = at({ applying: [{ ...RESTART, id: 'ax.8', action: 'rebuild', label: "the rebuild of the river's year" }, { ...RESTART, id: 'ax.9', action: 'ropes', label: 'a ropes change', phase: 'applying' }] });
  assert.deepEqual(applyingNow(m).map((l) => l.label), ["the rebuild of the river's year", 'a ropes change']);
  assert.deepEqual(applyingNow(m, { ids: ['ax.8'] }).map((l) => l.label), ['a ropes change'], 'its own rebuild, confirming after its control ended');
  assert.deepEqual(applyingNow(m, { actions: ['ropes'] }).map((l) => l.label), ["the rebuild of the river's year"], 'a request still in flight (no id yet) by its action');
  assert.deepEqual(applyingNow(m, ['rebuild']).map((l) => l.label), ['a ropes change'], 'a list of actions as before');
  const said = stateLive({ words: 'The ropes show the river · the panels show the river.', applying: applyingNow(m, { ids: ['ax.8', 'ax.9'] }) });
  assert.doesNotMatch(said, /rebuild|ropes change/);
});

test('R7 #31: a progress read that shows the run ended speaks for the calibration until the next status answer catches up', () => {
  const T = 1_792_749_000;
  const running = { running: true, alive: true, mode: 'full', stage: 'hub75-locate', started: T, updated: T + 60, elapsed_s: 60, expected_s: 10 };
  const ended = { running: false, ok: true, mode: 'full', stage: 'done', started: T, updated: T + 62, result: { map: 'pixelmap-2026-10-23.json' } };
  const st = status(); st.probe.value.calibration = running;
  assert.match(derive(st, NOW + 1000).controls.rebuild.why ?? '', /calibration is running/);
  const fresh = calNewer(st, ended);
  assert.equal(derive(fresh, NOW + 1000).controls.rebuild.why, null, 'Rebuild is not blocked by the run that just ended');
  assert.equal(st.probe.value.calibration, running, 'the status itself is not changed');
  // an older copy, or one that still runs, changes nothing (the status's own copy is as new or newer)
  assert.equal(calNewer(st, { ...ended, updated: T + 50 }), st);
  assert.equal(calNewer(st, { ...running, updated: T + 70 }), st);
  assert.equal(calNewer(st, null), st);
  assert.equal(calNewer(null, ended), null);
});

test('R7 #2: an answer that came at once but said bitcube didn\'t answer in time never reads "No answer in a while"', () => {
  assert.match(noAnswerText({ serverMaybe: true, maybe: true }, 'this block shows the run if it started'), /^bitcube didn't answer in time: it may or may not have happened; this block shows the run if it started \(\d\d:\d\d\)\.$/);
  assert.match(noAnswerText({ maybe: true }, 'x'), /^No answer in time: it may or may not have happened; x/, 'never "in a while"');
  assert.match(noAnswerText({ noAnswer: true, waitedS: 75 }, 'x'), /^No answer in 1 min: /);
});
