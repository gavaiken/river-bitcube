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
  assert.deepEqual(bandParts(flying).lines, [`Applying: ${RESTART}.`]);
  assert.doesNotMatch(bandSaid(flying), /Done/);
  // it ends: said once, though the same words were said for the first one
  const t2 = T0 + 20_000;
  const ended = derive(payload({ t: t2, extra: { confirmed: [{ ...entry('a.1'), at: T0 - 5000 }, { ...entry('a.2'), at: t2 - 1000 }] } }), t2);
  assert.deepEqual(say(ended, {}, t2), [`Done: ${RESTART}.`]);
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
  assert.match(page('lights.js'), /endedNews\(m, \{ ownIds: own\.ids \}, serverClock\(\)\)/);
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
  assert.deepEqual(say(m, own, t), ['Done: the change of the boot file to the live river.'], 'only the other phone\'s ending is said');
  for (let i = 0; i < 30; i++) mem.request(`x${i}`);
  assert.equal(mem.mine.requestIds.length, 20, 'the newest 20 are kept');
  assert.match(page('status.js'), /M\.ownEntries\(model, [^\n]*mine\.mine\)/);
  assert.match(page('lights.js'), /ownEntries\(S\.m, ctls, Date\.now\(\), \{ ids: S\.ownIds, requestIds: S\.ownRequestIds \}\)/);
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
  assert.equal(rb.overall.action, "Someone is rebuilding the river's year now: wait a minute and look again.");
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
  await assert.rejects(m.control('switch', { file: YEAR }), (e) => e.status === 409 && e.message === 'TouchDesigner is still starting: wait a minute');
  await assert.rejects(m.control('rebuild', { file: YEAR }), (e) => e.status === 409 && e.message === 'TouchDesigner is still starting: wait a minute');
  t += 5000; reading = { ok: true, uptime_h: 30, td: { ok: false, error: `restarting on ${YEAR}` } };   // a crash relaunch, no entry
  await m.pollProbe();
  await assert.rejects(m.control('switch', { file: LIVE }), (e) => e.status === 409 && e.message === 'TouchDesigner is restarting: wait a minute');
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
  await assert.rejects(fx.control('switch', { file: YEAR }, 'just-booted'), (e) => e.status === 409 && /^TouchDesigner is still starting/.test(e.message));
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
  assert.match(det('BOTH'), /; lighting network on both ports: move the address to one\.$/);
  assert.match(det('none'), /; lighting network on neither port: the ropes can't be reached\.$/);
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
