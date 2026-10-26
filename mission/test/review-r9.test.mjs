// Round 9 (critics on 80b997a, fixed on d48f6fc): how a change ended said once by its id and a live region saying only what is
// new; a page's own changes remembered across its presses; a page's own verdict found while its answer is still on the way; "by"
// times that never come before the lock ends; one tense for one verdict; the band's advice while another phone restarts; the
// server's lock while TouchDesigner starts; Lights' grace for one "no job" read; the lighting port's two odd readings; Recent's
// order and words; the chat's step lines in the band's words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, bandParts, bandSaid, endedOnce, endedEntries, liveNews, ownEntries, ownMemory, ENDED_SAID_S } from '../public/model.js';
import { stateParts, stateLive } from '../public/lights-words.js';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const T0 = Date.UTC(2026, 9, 26, 4, 4, 0);          // 21:04 Pacific
const page = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

function payload({ t, td, applying = [], extra = {}, probe = {} } = {}) {
  return { now: t, bitcube: { ok: true, at: t, value: { online: true } }, seasons: { ok: true, at: t, value: { season: 'winter', mode: 'automatic', intensity: 0.2, presence: { available: false } } },
    modal: { ok: true, at: t, value: { ok: true, tick: 1, next_tick_epoch: t / 1000 + 200, finished_at: new Date(t - 60_000).toISOString() } },
    probe: { ok: true, at: t, value: { ok: true, uptime_h: 30, time: '2026-10-25T21:04:00', boot_file: YEAR, show_files: [YEAR, LIVE], displays: ['M14', 'LED 1920X1080'],
      devices: { psac10_1: true, psac10_2: true, gallery_cam: true, river_cam: true, router: true, internet: true },
      td: td ?? { ok: true, file: YEAR, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } }, ...probe } },
    applying, ...extra };
}
const RESTART = "the restart on the river's year";
const entry = (id, extra = {}) => ({ id, action: 'switch', label: RESTART, file: YEAR, source: 'mission control', phase: 'applying', started_at: T0 - 3000, expect_s: 60, ...extra });

// ---- #5, #17, #30: how a change ended, said once by its id; a region says only what is new ---------------------------------------

test('R9 #5, #30: a live region says the headline only when it changed, and each change in flight once, never again beside a new one', () => {
  const head = 'Attention. TouchDesigner is running slowly: the river will look jerky.';
  assert.deepEqual(liveNews(undefined, { head, lines: [] }), [head], 'the first time: the head');
  assert.deepEqual(liveNews({ head, lines: [] }, { head, lines: [`Applying: ${RESTART}.`] }), [`Applying: ${RESTART}.`], 'a new change alone, never the unchanged headline with it');
  assert.deepEqual(liveNews({ head, lines: [`Applying: ${RESTART}.`] }, { head, lines: [`Waiting for bitcube to show ${RESTART}.`] }), [`Waiting for bitcube to show ${RESTART}.`]);
  assert.deepEqual(liveNews({ head, lines: [`Applying: ${RESTART}.`] }, { head, lines: [] }), [], 'a part that went: nothing');
  const head2 = "Attention. TouchDesigner is restarting on the river's year.";
  assert.deepEqual(liveNews({ head, lines: ['x.'] }, { head: head2, lines: ['x.'] }), [head2], 'the head when it changed');
});

test('R9 #5, #17, #30: how another phone\'s change ended is said once by its id: not on the first answer, a second with the same name too, never beside one in flight', () => {
  const say = endedOnce();
  const first = derive(payload({ t: T0, extra: { confirmed: [{ ...entry('a.1'), at: T0 - 5000 }] } }), T0);
  assert.deepEqual(say(first, {}, T0), [], 'what ended before the page opened is no news');
  // a second restart starts: nothing ended is said again with it, and the band's words hold no "Done"
  const t1 = T0 + 5000;
  const flying = derive(payload({ t: t1, applying: [entry('a.2', { started_at: t1 - 1000 })], extra: { confirmed: [{ ...entry('a.1'), at: T0 - 5000 }] } }), t1);
  assert.deepEqual(say(flying, {}, t1), []);
  assert.deepEqual(bandParts(flying).lines, [`Applying: ${RESTART}, from another phone.`]);
  assert.doesNotMatch(bandSaid(flying), /Done/);
  // it ends: said once, though the same words were said for the first one
  const t2 = T0 + 20_000;
  const ended = derive(payload({ t: t2, extra: { confirmed: [{ ...entry('a.1'), at: T0 - 5000 }, { ...entry('a.2'), at: t2 - 1000 }] } }), t2);
  assert.deepEqual(say(ended, {}, t2), [`Done: ${RESTART}, from another phone.`]);
  assert.deepEqual(say(ended, {}, t2 + 5000), [], 'once');
  assert.deepEqual(say(ended, {}, t2 + 10_000), [], 'and never again while it is listed');
  // one that ends while another with the same name is already in flight: the newer one is what happens now
  const say2 = endedOnce();
  say2(derive(payload({ t: T0 }), T0), {}, T0);
  const t3 = T0 + 6000;
  const both = derive(payload({ t: t3, applying: [entry('a.4', { started_at: t3 - 500 })], extra: { expired: [{ ...entry('a.3'), at: t3 - 1000 }] } }), t3);
  assert.deepEqual(say2(both, {}, t3), []);
  // never this phone's own, and nothing past ENDED_SAID_S
  const say3 = endedOnce();
  say3(derive(payload({ t: T0 }), T0), {}, T0);
  const own = derive(payload({ t: t3, extra: { confirmed: [{ ...entry('a.5'), at: t3 - 1000 }] } }), t3);
  assert.deepEqual(say3(own, { ownIds: ['a.5'] }, t3), []);
  assert.deepEqual(endedEntries(own, {}, t3 + ENDED_SAID_S * 1000 + 2000), []);
});

test('R9 #5: Lights\' state line and the chat bar stand for their words and say how a change ended only once (setLive once)', () => {
  const p = stateParts({ words: 'The ropes show the river · the panels show the river at 100 %.', applying: [{ label: RESTART, said: `Applying: ${RESTART}.` }] });
  assert.deepEqual(p, { head: 'The ropes show the river · the panels show the river at 100 %.', lines: [`Applying: ${RESTART}.`] });
  assert.equal(stateLive({ words: 'x.', applying: [] }), 'x.');
  assert.match(page('lights.js'), /endedNews\(m, \{ ownIds: own\.ids, skip: [^\n]*\}, serverClock\(\)\)/);
  assert.match(page('chat.js'), /setLive\(\$\('pin-live'\), sayAll, \{ once: lost \? \[\] : endedNow\(\) \}\)/);
  assert.match(page('status.js'), /endedNews\(m, own, serverNow\(\)\)/);
  assert.match(page('ui.js'), /const news = liveNews\(prev, \{ head, lines \}\)/);
});

// ---- #6, #31: a page's own changes are remembered across its presses -------------------------------------------------------------

test('R9 #6, #31: a phone\'s earlier change stays its own after the same control is used again: by its id and by the request id it sent', () => {
  const t = T0 + 10_000;
  const boot = (id, rid, file, at) => ({ id, request_id: rid, action: 'bootfile', label: `the change of the boot file to ${file === LIVE ? 'the live river' : "the river's year"}`, file, source: 'mission control', at });
  const m = derive(payload({ t, applying: [{ ...boot('b.2', 'r2', YEAR), phase: 'applying', started_at: t - 1000, expect_s: 15 }],
    extra: { confirmed: [boot('b.1', 'r1', LIVE, t - 3000), boot('b.9', 'r9', LIVE, t - 2000)] } }), t);
  const mem = ownMemory();
  mem.id('b.1'); mem.request('r2');
  // the control now holds only its second press (no id yet: in flight)
  const own = ownEntries(m, [{ action: 'bootfile', state: 'applying', entryId: null, at: Date.now() }], Date.now(), mem.mine);
  assert.ok(own.ownIds.includes('b.1'), 'its first change, by the id its answer named');
  assert.ok(own.ownIds.includes('b.2'), 'its second, by the request id it sent');
  assert.ok(!own.ownIds.includes('b.9'), 'another phone\'s is not');
  const say = endedOnce();
  say(derive(payload({ t: T0 }), T0), {}, T0);
  assert.deepEqual(say(m, own, t), ['Done: the change of the boot file to the live river, from another phone.'], 'only the other phone\'s ending is said');
  for (let i = 0; i < 30; i++) mem.request(`x${i}`);
  assert.equal(mem.mine.requestIds.length, 20, 'the newest 20 are kept');
  assert.match(page('status.js'), /M\.ownEntries\(model, [^\n]*mine\.mine\)/);
  assert.match(page('lights.js'), /ownEntries\(S\.m, ctls, Date\.now\(\), mine\.mine\)/, 'its memory: model.js ownMemory, as Status keeps its own (CR9 #15)');
});

// ---- #1, #29: a page's own change found by its request id while its answer is on the way, or after it was lost -----------------

test('R9 #1: while its POST is in flight, the server\'s verdict found by its request id ends the control: done, confirming, held, expired', async () => {
  const { ownVerdict, ctlStep, ctlInit } = await import('../public/model.js');
  const t = T0 + 20_000;
  const done = derive(payload({ t, extra: { confirmed: [{ ...entry('s.1', { request_id: 'rq.1' }), at: t - 2000 }] } }), t);
  assert.deepEqual(ownVerdict(done, { state: 'applying', requestId: 'rq.1', serverConfirms: true }), { entryId: 's.1', unlockAt: null, judged: true, step: 'done' });
  assert.equal(ownVerdict(done, { state: 'applying', requestId: 'rq.1' }).step, 'done', 'a quick change too: the server confirmed it');
  const conf = derive(payload({ t, applying: [entry('s.2', { request_id: 'rq.2', phase: 'confirming', answered_at: t - 3000 })] }), t);
  assert.equal(ownVerdict(conf, { state: 'applying', requestId: 'rq.2', serverConfirms: true }).step, 'confirming', 'the server answered it: it is confirming');
  const flying = derive(payload({ t, applying: [entry('s.3', { request_id: 'rq.3' })] }), t);
  assert.deepEqual(ownVerdict(flying, { state: 'applying', requestId: 'rq.3', serverConfirms: true }), { entryId: 's.3', unlockAt: null, judged: false, step: null }, 'still applying on the server: wait');
  const held = derive(payload({ t, applying: [entry('s.4', { request_id: 'rq.4', phase: 'confirming', maybe: true, answered_at: t - 3000 })] }), t);
  assert.deepEqual(ownVerdict(held, { state: 'applying', requestId: 'rq.4', serverConfirms: true }), { entryId: 's.4', unlockAt: t - 3000 + 180_000, judged: true, step: 'held' });
  const exp = derive(payload({ t, extra: { expired: [{ ...entry('s.5', { request_id: 'rq.5' }), at: t - 1000 }] } }), t);
  assert.equal(ownVerdict(exp, { state: 'applying', requestId: 'rq.5', serverConfirms: true }).step, 'expired');
  assert.equal(ownVerdict(done, { state: 'applying' }).step, null, 'no request id: nothing to find');
  // the control's own steps: applying → done, confirming, unconfirmed
  const a = ctlStep(ctlInit(), { type: 'press', now: 1 });
  assert.equal(ctlStep(a, { type: 'model', confirmed: true, now: 2 }).state, 'done');
  assert.equal(ctlStep(a, { type: 'pending', now: 2 }).state, 'confirming');
  assert.equal(ctlStep(a, { type: 'pending', now: 2 }).answeredAt, 2, 'its own limit counts from now');
  assert.equal(ctlStep(a, { type: 'expired', now: 2 }).state, 'unconfirmed');
  assert.equal(ctlStep(ctlStep(a, { type: 'ok', now: 2 }), { type: 'pending', now: 3 }).state, 'done', 'a done change stays done');
});

test('R9 #29: an answer lost on the way back: the entry found by its request id says the change is under way, never "may or may not" with grey buttons', async () => {
  const { ownVerdict, ctlStep, ctlInit } = await import('../public/model.js');
  const t = T0 + 20_000;
  const conf = derive(payload({ t, applying: [entry('s.2', { request_id: 'rq.2', phase: 'confirming', answered_at: t - 3000 })] }), t);
  assert.equal(ownVerdict(conf, { state: 'unconfirmed', requestId: 'rq.2', serverConfirms: true, lost: true }).step, 'confirming');
  assert.equal(ownVerdict(conf, { state: 'unconfirmed', requestId: 'rq.2', serverConfirms: true }).step, null, 'a server maybe or its own limit: as before');
  const held = derive(payload({ t, applying: [entry('s.4', { request_id: 'rq.4', phase: 'confirming', maybe: true, answered_at: t - 3000 })] }), t);
  assert.deepEqual(ownVerdict(held, { state: 'unconfirmed', requestId: 'rq.4', serverConfirms: true, lost: true }), { entryId: 's.4', unlockAt: t - 3000 + 180_000, judged: true, step: 'held' });
  const lost = ctlStep(ctlStep(ctlInit(), { type: 'press', now: 1 }), { type: 'error', maybe: true, now: 2 });
  assert.equal(ctlStep(lost, { type: 'pending', now: 3 }).state, 'confirming');
  // and a quick change found that way is judged on the server's verdict from then on
  const ropes = derive(payload({ t, extra: { confirmed: [{ id: 'q.1', request_id: 'rq.9', action: 'ropes', label: 'the change of the ropes to dark', source: 'mission control', at: t - 1000 }] } }), t);
  assert.equal(ownVerdict(ropes, { state: 'confirming', entryId: 'q.1' }).step, 'done');
  // Status hides its own Wait line only while its line says when it unlocks
  assert.match(page('status.js'), /const ownBlock = \(name\) => !!model && !!ctl\[name\]\?\.entryId && model\.controls\[name\]\?\.by === ctl\[name\]\.entryId && !!ctl\[name\]\.held;/);
});

// ---- #13, #33: "by" times never come before the lock ends; #14: one tense for one verdict --------------------------------------

test('R9 #13, #33: an unlock time said with "by" is rounded up to the next minute; "at" and "started" times stay as they were', async () => {
  const { waitWords, byMinute, clock, unconfirmedWords, notSentWords } = await import('../public/model.js');
  const end = T0 + 50_000;                              // 21:04:50
  assert.equal(waitWords("the restart on the river's year", { maybe: true, unlockMs: end }), "wait: the restart on the river's year got no answer from bitcube in time; it unlocks by 21:05");
  assert.equal(waitWords('x', { maybe: true, unlockMs: T0 }), 'wait: x got no answer from bitcube in time; it unlocks by 21:04', 'on the minute: that minute');
  assert.equal(clock(byMinute(end)), '21:05');
  assert.equal(byMinute(T0), T0);
  assert.match(notSentWords(waitWords('x', { maybe: true, unlockMs: end }), '21:04'), /the buttons unlock by 21:05\. Press again then\.$/);
  // the server's 409 says the same (lib/applying.mjs waitWords)
  const { Applying } = await import('../lib/applying.mjs');
  let t = T0;
  const a = new Applying({ now: () => t });
  await a.run('switch', { file: YEAR }, async () => ({ ok: false, maybe: true }), { awaits: () => true });
  t += 10_000;
  assert.match(a.waitError(a.conflict('ropes')).message, /it unlocks by 21:07$/, '21:04:00 + 3 min');
  t = T0 + 30_500;
  const b = new Applying({ now: () => t });
  await b.run('switch', { file: YEAR }, async () => ({ ok: false, maybe: true }), { awaits: () => true });
  assert.match(b.waitError(b.conflict('ropes')).message, /it unlocks by 21:08$/, '21:04:30.5 + 3 min is 21:07:30.5: by 21:08');
  // #14: given up, in the past like every other line
  assert.equal(unconfirmedWords('the switch to the live river', '21:04'), "The switch to the live river was sent at 21:04, but bitcube didn't show it in time: look at the Now line, or call Gavin.");
  assert.match(page('status.js'), /heldWords\(c\.o\?\.what, sclock\(byMinute\(own\.unlockAt\)\)\)/);
  assert.match(page('ui.js'), /heldWords\(o\.what, sclock\(byMinute\(own\.unlockAt\)\)\)/);
});

// ---- #12, #16, #18: the band's advice while a switch or restart is in flight -------------------------------------------------------

test('R9 #16: while a switch or restart is in flight, the band never says to press it again or to call Gavin', () => {
  const t = T0 + 5000;
  const slowTd = { ok: true, file: YEAR, fps: 20, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } };
  const m = derive(payload({ t, td: slowTd, applying: [entry('w.1', { started_at: t - 3000 })] }), t);
  assert.equal(m.overall.cause, 'td-slow');
  assert.equal(m.overall.action, "Someone is restarting TouchDesigner on the river's year now: wait a minute and look again.");
  assert.equal(m.overall.waits, 'w.1', 'the band leaves out its jump\'s Wait line: the action says it');
  assert.equal(m.overall.chosen, true, 'started on purpose: nothing to call about');
  const live = derive(payload({ t, td: { ...slowTd, file: LIVE, fps: 60 }, applying: [entry('w.2', { started_at: t - 3000, label: "the switch to the river's year" })] }), t);
  assert.equal(live.overall.cause, 'online-file');
  assert.equal(live.overall.action, "Someone is switching TouchDesigner to the river's year now: wait a minute and look again.");
  const rb = derive(payload({ t, td: slowTd, applying: [entry('w.3', { action: 'rebuild', label: "the rebuild of the river's year", started_at: t - 3000, expect_s: 150 })] }), t);
  assert.equal(rb.overall.action, "Someone is rebuilding the river's year now: wait a few minutes and look again.");   // R10 #13
  const none = derive(payload({ t, td: slowTd }), t);
  assert.match(none.overall.action, /press Restart on the river's year/);
  assert.equal(none.overall.waits, null);
  assert.match(page('status.js'), /if \(o\.waits\) return '';/);
  assert.match(page('status.js'), /m\?\.overall\.chosen/);
});

test('R9 #12, #18: a held switch says its unlock once, with "by", and points at the button for the file it was going to', () => {
  const t = T0 + 30_000;
  const off = { ok: false, error: 'not running' };
  const held = (file, label) => derive(payload({ t, td: off, applying: [entry('h.1', { file, label, phase: 'confirming', maybe: true, started_at: T0 - 10_000, answered_at: T0 + 20_000 })] }), t);
  const y = held(YEAR, RESTART);
  assert.equal(y.overall.cause, 'td-off');
  assert.equal(y.overall.action, "If TouchDesigner still isn't running when the buttons unlock (by 21:08), press Switch to the river's year below (about a minute).");
  assert.equal(y.overall.waits, 'h.1');
  assert.equal(y.overall.chosen, false, 'a maybe explains nothing: Call Gavin stays');
  const l = held(LIVE, 'the switch to the live river');
  assert.equal(l.overall.action, "If TouchDesigner still isn't running when the buttons unlock (by 21:08), press Switch to the live river below to try again, or Switch to the river's year if the live river isn't needed tonight (about a minute).");
  const frozen = derive(payload({ t, td: { ok: false, error: 'not answering' }, applying: [entry('h.2', { file: LIVE, label: 'the switch to the live river', phase: 'confirming', maybe: true, started_at: T0 - 10_000, answered_at: T0 + 20_000 })] }), t);
  assert.match(frozen.overall.action, /answer the dialog, or press Switch to the live river to try again, or Switch to the river's year if the live river isn't needed tonight \(about a minute dark\)\.$/);
  assert.doesNotMatch(frozen.overall.action, /got no answer|about 21/);
});

test('R9 #15: a lighting port change waiting for a full check gives the full check\'s time, on the sending phone and every other', async () => {
  const { entryWords, BOOT_USUAL } = await import('../public/model.js');
  const e = { action: 'lightsroute', label: 'the change of the lighting port to the spare router port', phase: 'confirming', expect_s: 20 };
  assert.equal(entryWords(e, 25), `Waiting for bitcube to show the change of the lighting port to the spare router port · 0:25 · ${BOOT_USUAL}`);
  assert.match(page('status.js'), /usual: name === 'bootfile' \|\| name === 'lightsroute' \? BOOT_USUAL : null/);
});

// ---- #34: the server refuses a switch or rebuild while TouchDesigner starts by itself, as the pages do ------------------------------

test('R9 #34: a switch or rebuild while TouchDesigner is starting or restarting with no entry is refused (409) in the pages\' words', async () => {
  const { Mission } = await import('../lib/mission.mjs');
  const { tdStarting } = await import('../public/model.js');
  let t = T0, reading = null;
  const m = new Mission({ now: () => t, later: () => {}, probe: async (_h, args) => (args ? { ok: true, td: { ok: true, file: YEAR } } : reading) });
  reading = { ok: true, uptime_h: 0.05, td: { ok: false, error: 'TouchDesigner is not running' } };   // bitcube's own boot
  await m.pollProbe();
  await assert.rejects(m.control('switch', { file: YEAR }), (e) => e.status === 409 && e.message === 'bitcube is still coming up; wait a minute');
  await assert.rejects(m.control('rebuild', { file: YEAR }), (e) => e.status === 409 && e.message === 'bitcube is still coming up; wait a minute');
  t += 5000; reading = { ok: true, uptime_h: 30, td: { ok: false, error: `restarting on ${YEAR}` } };   // a crash relaunch, no entry
  await m.pollProbe();
  await assert.rejects(m.control('switch', { file: LIVE }), (e) => e.status === 409 && e.message === 'TouchDesigner is restarting; wait a minute');
  t += 5000; reading = { ok: true, uptime_h: 30, td: { ok: true, file: YEAR, fps: 60 } };
  await m.pollProbe();
  const r = await m.control('switch', { file: LIVE });
  assert.equal(typeof r.applying_id, 'string', 'answering: it runs');
  assert.equal(tdStarting({ now: t, probe: { at: t, value: { ok: true, uptime_h: 30, td: { ok: true, file: YEAR, fps: 60 } } } }, t), null);
  // the fixture world the same (just-booted)
  const { FixtureMission } = await import('../lib/fixtures.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = new URL('./fixtures/', import.meta.url).pathname;
  const fx = new FixtureMission({ dir, stateDir: mkdtempSync(join(tmpdir(), 'r9-')), applyS: 0 });
  await assert.rejects(fx.control('switch', { file: YEAR }, 'just-booted'), (e) => e.status === 409 && /^bitcube is still coming up/.test(e.message));
  assert.equal(typeof (await fx.control('switch', { file: YEAR }, 'all-good')).applying_id, 'string');
});

// ---- #32: one "no job" read during a run never swaps the run view away ------------------------------------------------------------

test('R9 #32: a "no job" progress answer while the last good read showed a run, within the server\'s grace, is a failed read; after it, the end', async () => {
  const { calRead, CAL_NONE_GRACE_S } = await import('../public/lights-words.js');
  const none = { ok: true, status: 200, body: { running: false, none: true } };
  assert.equal(CAL_NONE_GRACE_S, 30, 'the server\'s CAL_NONE_GRACE_MS');
  const r = calRead(none, { running: true, heardS: 5 });
  assert.equal(r.good, false, 'the run and Stop stay');
  assert.equal(calRead(none, { running: true, heardS: 31 }).good, true, 'past the grace: the run is gone');
  assert.equal(calRead(none, { running: true, heardS: 31 }).p, null);
  assert.equal(calRead(none).good, true, 'with no run on: there is none');
  assert.match(page('lights.js'), /calRead\(\{ ok: r\.ok, status: r\.status, body \}, \{ running: S\.cal\.p\?\.running === true, heardS: heardS\(\) \}\)/);
});

// ---- #35, #25: the lighting port in plain words; #36: a frozen TouchDesigner never reads as a cable fault ---------------------------

test('R9 #35, #25: the lighting address on both ports or on neither has words of its own; one name for the spare port', async () => {
  const t = T0;
  const at = (lr) => derive(payload({ t, probe: { lights_route: lr } }), t);
  const det = (lr) => at(lr).items.find((x) => x.id === 'ropes').detail;
  assert.match(det('router'), /; lighting network on the spare router port\.$/);
  assert.match(det('direct'), /; lighting network on bitcube's LIGHTS port\.$/);
  assert.match(det('BOTH'), /; lighting network on both ports: under Installer, press the port the lighting switch is plugged into\.$/);   // one instruction (R10 #27)
  assert.match(det('none'), /; lighting network on neither port, so the ropes can't be reached: under Installer, press the port the lighting switch is plugged into\.$/);
  assert.match(det('Ethernet 3'), /; lighting network on another port\.$/);
  assert.equal(at('BOTH').show.ropes.route_words, 'both ports');
  assert.equal(at('none').show.ropes.route_words, 'neither port');
  assert.equal(at('router').show.ropes.route_words, 'the spare router port');
  assert.equal(at(undefined).show.ropes.route_words, null);
  const st = page('status.js');
  assert.match(st, /s\.ropes\.route_words \?\? 'not known'/, 'the Installer reads them, never "not known" for a reading it has');
  assert.doesNotMatch(page('model.js'), /'the router port'/);
});

test('R9 #36: TouchDesigner frozen or not running: the ropes are "not being driven", never the cable or sender words', async () => {
  const { ROPES_STATE, ropesTile } = await import('../public/status-words.js');
  const { stateWords } = await import('../public/lights-words.js');
  const t = T0;
  const fz = derive(payload({ t, td: { ok: false, error: 'not answering' } }), t);
  assert.equal(fz.show.ropes.state, 'not-driven');
  assert.equal(fz.show.ropes.words, 'the ropes are not being driven: TouchDesigner is frozen');
  assert.equal(stateWords(fz), 'The ropes are not being driven: TouchDesigner is frozen · the panels hold a frozen picture.');
  assert.deepEqual(ropesTile(fz, fz.items.find((x) => x.id === 'ropes'), false), { state: 'Not being driven', words: 'TouchDesigner is frozen' });
  const off = derive(payload({ t, td: { ok: false, error: 'TouchDesigner is not running' } }), t);
  assert.equal(off.show.ropes.words, 'the ropes are not being driven: TouchDesigner is not running');
  assert.equal(ROPES_STATE['not-driven'], 'Not being driven');
  const { describeEvent } = await import('../lib/history.mjs');
  assert.equal(describeEvent({ kind: 'show', field: 'ropes', from: 'river', to: 'not-driven', t }), 'The ropes stopped being driven');
  assert.match(page('map-words.js'), /st === 'not-driven'\) return 'not driven'/);
  assert.match(page('lights.js'), /ropesSt === 'not-driven'/);
  // and Lights' next line never says the cause again when the state line now says it
  const { nextLine } = await import('../public/lights-words.js');
  const split = (h) => { const i = h.indexOf(':'); return i < 0 ? [h, ''] : [h.slice(0, i), h.slice(i + 1).trim()]; };
  assert.deepEqual(nextLine(fz, 'from bitcube · 20 s ago', split, stateWords(fz)), { text: '', href: '/status', link: 'What to do → Status' });
  assert.equal(nextLine(fz, 'from bitcube · 20 s ago', split).text, 'TouchDesigner is frozen.', 'without the state words, as before');
  assert.match(page('lights.js'), /nextLine\(m, from, splitHeadline, words\)/);
});

// ---- #26: the Installer's summary; #4: a headline's clock time is never cut ------------------------------------------------------

test('R9 #26: the Installer says it asks first, never "confirms" (which means the server\'s verdict)', () => {
  assert.match(page('status.js'), /changes cabling and boot settings · asks first</);
  assert.doesNotMatch(page('status.js'), /confirms every change/);
});

test('R9 #4: a headline is never split at a clock time\'s colon', async () => {
  // ui.js needs a DOM: the rule is tested on its source and on a copy of the function
  const src = page('ui.js');
  const body = /export function splitHeadline\(h\) \{[\s\S]*?\n\}/.exec(src)[0].replace('export function', 'function');
  const splitHeadline = new Function(`${body}; return splitHeadline;`)();
  assert.deepEqual(splitHeadline("Clips from the river camera aren't reaching Dave's agent, since 01:02"), ["Clips from the river camera aren't reaching Dave's agent, since 01:02", '']);
  assert.deepEqual(splitHeadline('TouchDesigner is frozen: the lights are not being driven'), ['TouchDesigner is frozen', 'the lights are not being driven']);
  assert.deepEqual(splitHeadline('Clips failing since 01:02: the link is down'), ['Clips failing since 01:02', 'the link is down']);
});

// ---- #20, #21: Recent keeps "Asked to …" at its time and says the verdict as its own line; a maybe in the contract's words --------

test('R9 #20: in Recent the verdict is its own line at its own time, after "Asked to …", never the request rewritten as done before it began', async () => {
  const { History, describeEvent, feed } = await import('../lib/history.mjs');
  let t = T0;
  const h = new History({ file: null, now: () => t });
  h.action({ action: 'switch', body: { file: YEAR }, ok: true, source: 'mission control', label: RESTART, applying_id: 'ax.1' });
  h.action({ action: 'ropes', body: { dark: true }, ok: true, source: 'mission control', applying_id: 'ax.2' });
  t += 30_000;
  h.judge({ confirmed: [{ id: 'ax.1' }, { id: 'ax.2' }] }, t);
  const lines = feed(h.recent()).map((e) => e.words);
  assert.deepEqual(lines, ["bitcube showed the restart on the river's year", 'Turned the ropes dark from mission control', "Asked to restart TouchDesigner on the river's year from mission control"],
    'newest first: the verdict above the request; a quick change\'s verdict is no line of its own');
  t += 1000;
  h.action({ action: 'bootfile', body: { file: LIVE }, ok: true, source: 'studio chat', label: 'the change of the boot file to the live river', applying_id: 'ax.3' });
  t += 200_000;
  h.judge({ expired: [{ id: 'ax.3' }] }, t);
  assert.deepEqual(feed(h.recent({ limit: 2 })).map((e) => e.words), ["bitcube didn't show the change of the boot file to the live river in time", 'Asked to set the boot file to the live river from the studio chat']);
  // the last action (Last done, the socket) keeps one line with its verdict in it
  assert.equal(describeEvent(h.summary(t).last_action), "Asked to set the boot file to the live river from the studio chat, but bitcube didn't show it in time");
  assert.equal(describeEvent(h.recent({ kinds: 'action', limit: 3 })[2]), "Restarted TouchDesigner on the river's year from mission control", 'asked for actions alone: folded, as before');
});

test('R9 #21: a change bitcube didn\'t answer in time reads "Asked to …" until its verdict, never "Tried to …" nor "answered late"', async () => {
  const { History, describeEvent, feed } = await import('../lib/history.mjs');
  let t = T0;
  const h = new History({ file: null, now: () => t });
  h.action({ action: 'switch', body: { file: LIVE }, ok: false, maybe: true, source: 'mission control', label: 'the switch to the live river', applying_id: 'ax.1' });
  const one = () => describeEvent(h.recent({ kinds: 'action', limit: 1 })[0]);
  assert.equal(one(), 'Asked to switch TouchDesigner to the live river from mission control: no answer in time, waiting for bitcube to show whether it happened');
  t += 60_000;
  h.judge({ confirmed: [{ id: 'ax.1' }] }, t);
  assert.equal(one(), "Switched TouchDesigner to the live river from mission control (bitcube showed it, though it didn't answer in time)");
  assert.deepEqual(feed(h.recent({ limit: 2 })).map((e) => e.words), ['bitcube showed the switch to the live river', 'Asked to switch TouchDesigner to the live river from mission control: no answer in time']);
  h.action({ action: 'bootfile', body: { file: LIVE }, ok: false, maybe: true, source: 'mission control', applying_id: 'ax.2' });
  t += 200_000;
  h.judge({ expired: [{ id: 'ax.2' }] }, t);
  assert.equal(one(), "Asked to set the boot file to the live river from mission control: no answer in time, and bitcube didn't show it");
  // one that can never get a verdict (no entry): sent, and nobody knows
  assert.equal(describeEvent(h.action({ action: 'switch', body: { file: LIVE }, ok: false, maybe: true })), 'Sent the switch to the live river from mission control: no answer in time, so it may or may not have happened');
});

// ---- #19: a dry run touches no camera: its stages are steps -------------------------------------------------------------------------

test('R9 #19: a dry run is never "photographing the ropes": Recent, the band and Lights name its stage as a step', async () => {
  const { describeEvent } = await import('../lib/history.mjs');
  assert.equal(describeEvent({ kind: 'calibration', running: true, stage: 'ropes-capture', mode: 'dry-run', from: null }), 'A dry run started');
  assert.equal(describeEvent({ kind: 'calibration', running: true, stage: 'ropes-decode', mode: 'dry-run', from: { running: true, stage: 'ropes-capture' } }), 'A dry run is at the rope map');   // in words (R10 #18)
  const t = T0;
  const m = derive(payload({ t, probe: { calibration: { running: true, stage: 'ropes-capture', mode: 'dry-run', dry_run: true, expected_s: 170, elapsed_s: 5 } } }), t);
  assert.equal(m.overall.cause, 'calibrating');
  assert.equal(m.overall.detail, "It walks the calibration's steps without touching the lights; it is at the ropes now, and ends by itself in about a minute.");
  assert.equal(m.show.calibration.words, 'the ropes');
  assert.match(page('lights.js'), /dry \? calStep\(s\)\.label/, 'its stage from model.js calStep (CR9 #16), in words (R10 #18)');
});

// ---- #2: Recent is kept current while it is open -------------------------------------------------------------------------------

test('R9 #2: Recent asks again every few seconds while its sheet shows it, and its ages tick from the server\'s clock', () => {
  const ui = page('ui.js');
  const body = /async function openRecent\(shell\) \{[\s\S]*?\n\}/.exec(ui)[0];
  assert.match(ui, /export const RECENT_EVERY_MS = 5000;/);
  assert.match(body, /setInterval\(\(\) => \{ if \(!showing\(\)\) \{ clearInterval\(timer\); untick\(\); return; \} load\(\); \}, RECENT_EVERY_MS\)/);
  assert.match(body, /const untick = tick\(/, 'its ages tick every second');
  assert.match(body, /data-t="\$\{t\}"/);
  assert.match(body, /const now = typeof st\.j\?\.now === 'number' \? carried\(st\.j\.now, st\.at, st\.wall\) : Date\.now\(\);/, 'on the history\'s own clock, carried forward');
});

// ---- #22, #27, #38: the chat's step lines -------------------------------------------------------------------------------------------

const stepOf = async (command, description = 'Look', ctx = undefined) => {
  const { describeTool } = await import('../lib/steps.mjs');
  const { stepWords } = await import('../public/chat-words.js');
  const d = describeTool({ name: 'Bash', input: { command, description } }, ctx);
  const shown = stepWords(d);            // the page shows every line as it was sent
  assert.deepEqual([shown.text, shown.act], [d.text, d.acting], `the page reworded "${d.text}"`);
  return [d.text, d.acting];
};

test('R9 #22: a change asked of mission control is named as the band and Recent name it (model.js changeLabel)', async () => {
  const mc = (body) => `node mission/bin/mc.mjs ${body}`;
  assert.deepEqual(await stepOf(mc(`ropes '{"dark":true}'`)), ['asked mission control for the change of the ropes to dark', true]);
  assert.deepEqual(await stepOf(mc(`switch '{"file":"${YEAR}"}'`), 'Restart', { running: YEAR }), [`asked mission control for ${RESTART}`, true]);
  assert.deepEqual(await stepOf(mc(`switch '{"file":"${YEAR}"}'`), 'Switch', { running: LIVE }), ["asked mission control for the switch to the river's year", true]);
  assert.deepEqual(await stepOf(mc(`calibrate '{"action":"cancel"}'`), 'Stop', { calDry: true }), ['asked mission control for the dry run stop', true]);
  assert.deepEqual(await stepOf(mc(`calibrate '{"action":"cancel"}'`), 'Stop'), ['asked mission control to stop the run', true], 'which run it is isn\'t known: neutral');
  assert.deepEqual(await stepOf(mc(`calibrate '{"action":"start","dry_run":true}'`)), ['asked mission control for the dry run start', true]);
  assert.deepEqual(await stepOf(mc(`hub75 '{"brightness":0.5}'`)), ['asked mission control for the change of the panels to 50 %', true]);
  assert.deepEqual(await stepOf(mc('check')), ['asked mission control for the full check of bitcube', false]);
  assert.deepEqual(await stepOf(mc('nope'), ''), ['ran a command', false], 'not a control of mission control');
  // the live agent passes what TouchDesigner runs, so a switch to it reads as the restart it is
  assert.match(page('../lib/agent.mjs'), /yield \{ kind: 'activity', \.\.\.describeTool\(b, context\) \}/, 'handed over lazily (CR9 #18)');
  assert.match(readFileSync(new URL('../server.mjs', import.meta.url), 'utf8'), /context: \(\) => stepContext\(\)/);
});

test('R9 #27: the session notes are "the team\'s work log" on a step line', async () => {
  const { describeTool } = await import('../lib/steps.mjs');
  assert.equal(describeTool({ name: 'Edit', input: { file_path: 'docs/sessions/U.md' } }).text, "changed the team's work log");
});

test('R9 #38: the direct changes that read as checks now read as the change they are', async () => {
  const B = 'ssh bitcube';
  const cases = [
    [`${B} "powershell -File C:\\Users\\user\\River\\river-bitcube\\tools\\lights_route.ps1 router"`, 'moved the lighting port'],
    [`${B} "Start-ScheduledTask -TaskName RopeLights"`, "started Will's rope lights"],
    [`${B} "C:\\Users\\user\\RopeLights\\Start-Rope-Lights.cmd"`, "started Will's rope lights"],
    [`${B} "Stop-ScheduledTask -TaskName RopeLights"`, "stopped Will's rope lights"],
    ['curl -X POST http://100.73.68.60:9981/mode -d \'{"mode":"manual"}\'', "changed the river's year"],
    [`${B} "Invoke-RestMethod -Method Post -Uri http://localhost:9981/target -Body x"`, "changed the river's year"],
    ['scp /tmp/c bitcube:C:/Users/user/River/calibration.cancel', 'stopped the calibration'],
    [`${B} "python -c \\"open(r'C:\\Users\\user\\River\\boot-file.txt','w').write('x')\\""`, 'changed the boot file'],
    [`${B} "Disable-NetAdapter -Name 'Ethernet 2' -Confirm:$false"`, "changed bitcube's network"],
    [`${B} "cmd /c C:\\Users\\user\\River\\river-bitcube\\Start-River.cmd"`, 'started TouchDesigner'],
    ["ssh root@100.127.193.8 \"uci set wireless.radio0.channel=36 && uci commit wireless\"", "changed the router's settings"],
    ['ssh root@100.127.193.8 "/etc/init.d/network restart"', "restarted the router's network"],
    [`${B} "shutdown /r /t 0"`, 'restarted bitcube'],
    [`${B} "powershell -File C:\\x\\td.ps1 \\"mod('seasons_td').set_mode('manual')\\""`, "changed the river's year"],
  ];
  for (const [cmd, words] of cases) {
    const [text, acting] = await stepOf(cmd, 'Check it');
    assert.equal(acting, true, cmd);
    assert.equal(text, words, cmd);
  }
  // reads stay reads
  for (const cmd of [`${B} "Get-ScheduledTask -TaskName RopeLights"`, 'curl http://100.73.68.60:9981/state', 'scp bitcube:C:/Users/user/River/calibration.json /tmp/',
    `${B} "Get-NetAdapter"`, 'ssh root@100.127.193.8 "uci show wireless"', `${B} "netsh interface show interface"`]) {
    assert.equal((await stepOf(cmd, 'Check it'))[1], false, cmd);
  }
});

// ---- #37: the login masks: what CR8 left (SSHPASS, pass=, mysql -p…, uci's key, a bare sk-ant token) ---------------------------

test('R9 #37: the masks catch SSHPASS=, pass=, mysql\'s attached -p, a Wi-Fi key in uci, a JSON "key", and a bare sk-ant token', async () => {
  const { scrubCreds, PATTERNS } = await import('../lib/scrub.mjs');
  const F = 'NOT-A-REAL-PW-r9';
  const cases = [
    [`SSHPASS=${F} sshpass -e ssh root@192.168.9.1`, 'SSHPASS=*** sshpass -e ssh root@192.168.9.1'],
    [`https://cam/cgi-bin/api.cgi?cmd=Snap&user=admin&pass=${F}`, 'https://cam/cgi-bin/api.cgi?cmd=Snap&user=admin&pass=***'],
    [`{"user":"admin","pass":"${F}"} db_pass=${F}`, '{"user":"admin","pass":"***"} db_pass=***'],
    [`mysql -u root -p${F} river`, 'mysql -u root -p*** river'],
    [`uci set wireless.@wifi-iface[1].key='${F}'`, "uci set wireless.@wifi-iface[1].key='***'"],
    [`option key '${F}'`, "option key '***'"],
    [`{"ssid":"gray-river","key":"${F}","encryption":"psk2"}`, '{"ssid":"gray-river","key":"***","encryption":"psk2"}'],
    [`my token is sk-ant-oat01-${F}xyzxyz`, 'my token is sk-ant-***'],
    [`openssl enc -pass ${F} -in x`, 'openssl enc -pass *** -in x'],
  ];
  for (const [line, want] of cases) assert.equal(scrubCreds(line), want, line);
  // never what isn't a login
  for (const line of ['op("x").bypass = True', 'the bypass is open', 'sort key=name', 'the primary key: id', 'mysql -u root river', 'else: pass', 'uci show wireless',
                      '"input_tokens": 12', 'a passage', 'compass=north']) assert.equal(scrubCreds(line), line, line);
  assert.deepEqual(scrubCreds({ SSHPASS: F, user: 'admin', pass: F, ssid: 'gray-river', key: F, keys: ['a'], bypass: true }), { SSHPASS: '***', user: 'admin', pass: '***', ssid: 'gray-river', key: '***', keys: ['a'], bypass: true });
  // a "pass" or a "key" with nothing beside it that makes it a login is left alone (CR9 #13)
  assert.deepEqual(scrubCreds({ pass: 'A', key: 'river-local' }), { pass: 'A', key: 'river-local' });
  // probe.ps1 carries the very patterns (tools/tests/test_masks.py runs them)
  const src = readFileSync(new URL('../../tools/mission/probe.ps1', import.meta.url), 'utf8');
  const ps = Object.fromEntries([...src.matchAll(/^\$(CRED_\w+) = '((?:[^']|'')*)'$/gm)].map((m) => [m[1], m[2].replace(/''/g, "'")]));
  for (const [k, v] of [['CRED_MYSQL', PATTERNS.MYSQL], ['CRED_UCI', PATTERNS.UCI], ['CRED_SKANT', PATTERNS.SKANT], ['CRED_QUOTED', PATTERNS.QUOTED]]) assert.equal(ps[k], v, k);
});

// ---- #24: the chat's "Not sent" in the controls' form ----------------------------------------------------------------------------

test('R9 #24: the chat says "Not sent at 21:04: <why>." as every control does', async () => {
  const { notSentWords } = await import('../public/model.js');
  assert.equal(`${notSentWords("mission control didn't accept it", '21:04')} Your message is still in the box.`, "Not sent at 21:04: mission control didn't accept it. Your message is still in the box.");
  assert.match(page('chat.js'), /\$\{notSentWords\(plainError\(e\), sclock\(\)\)\} Your message is still in the box\./);
  assert.doesNotMatch(page('chat.js'), /`Not sent: /);
});
