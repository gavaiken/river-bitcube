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
