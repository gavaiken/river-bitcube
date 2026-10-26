// Round 8 (critics on dd38ad2, fixed on 1373e81): the server's verdict kept with the history for every change, a page's own request
// id on its entry, the lighting port and the boot file confirmed by a reading that shows them, the ended lists capped and named;
// on the pages a maybe switch that holds the lock while TouchDesigner is seen down, the usual times on other phones, and how
// another phone's change ended said once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Applying, ENDED_MAX } from '../lib/applying.mjs';
import { Mission, awaitsReading } from '../lib/mission.mjs';
import { History, describeEvent } from '../lib/history.mjs';
import { derive, entryVerdict, entryIdOf, entryWords, bandSaid, endedSaid, notSentWords, failWords, ENDED_SAID_S, clock } from '../public/model.js';
import { lastDoneParts } from '../public/status-words.js';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const T0 = Date.UTC(2026, 9, 26, 4, 4, 0);          // 21:04 Pacific
const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function payload({ t, td, applying = [], extra = {} } = {}) {
  return { now: t, bitcube: { ok: true, at: t, value: { online: true } }, seasons: { ok: true, at: t, value: { season: 'winter', mode: 'automatic', intensity: 0.2, presence: { available: false } } },
    modal: { ok: true, at: t, value: { ok: true, tick: 1, next_tick_epoch: t / 1000 + 200, finished_at: new Date(t - 60_000).toISOString() } },
    probe: { ok: true, at: t, value: { ok: true, uptime_h: 30, time: '2026-10-25T21:04:00', boot_file: YEAR, show_files: [YEAR, LIVE], displays: ['M14', 'LED 1920X1080'],
      devices: { psac10_1: true, psac10_2: true, gallery_cam: true, river_cam: true, router: true, internet: true },
      td: td ?? { ok: true, file: YEAR, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } } } },
    applying, ...extra };
}

// ---- the server -----------------------------------------------------------------------------------------------------------

test('R8 #2: a page\'s own request id is kept on its entry and in status.confirmed / status.expired; one that isn\'t an id is not', async () => {
  let t = T0;
  const a = new Applying({ now: () => t });
  const sw = a.run('switch', { file: LIVE }, async () => ({ ok: true }), { awaits: () => true, requestId: 'rkx1.ab12' });
  assert.equal(a.list()[0].request_id, 'rkx1.ab12', 'on the entry while it is in flight');
  const r = await sw;
  t += 20_000;
  a.confirm({ td: { ok: true, file: LIVE } }, t);
  assert.deepEqual(a.ended().confirmed.map((e) => [e.id, e.request_id]), [[r.applying_id, 'rkx1.ab12']]);
  const bad = await a.run('ropes', { dark: true }, async () => ({ ok: true }), { requestId: '<img src=x>' });
  assert.equal(a.ended().confirmed.find((e) => e.id === bad.applying_id).request_id, undefined);
});

test('R8 #39: status.confirmed and status.expired keep at most ENDED_MAX entries, the quick changes confirmed at their answer going first', async () => {
  let t = T0;
  const a = new Applying({ now: () => t });
  const sw = await a.run('switch', { file: LIVE }, async () => ({ ok: true }), { awaits: () => true });
  t += 1000; a.confirm({ td: { ok: true, file: LIVE } }, t);
  for (let i = 0; i < ENDED_MAX + 150; i++) { t += 10; await a.run('ropes', { dark: i % 2 === 0 }, async () => ({ ok: true })); }
  const e = a.ended();
  assert.equal(e.confirmed.length + e.expired.length, ENDED_MAX);
  assert.ok(e.confirmed.some((x) => x.id === sw.applying_id), 'the switch a page waits on outlives a burst of quick changes');
  assert.ok(JSON.stringify(e).length < 20_000, 'every phone downloads it on every poll');
});

test('R8 #31: a lighting port change bitcube didn\'t answer in time is confirmed by a reading asked after it that shows the port', async () => {
  let t = T0, lr = 'direct';
  const reads = [];
  const m = new Mission({ now: () => t, later: (fn, ms) => reads.push({ fn, ms }),
                          probe: async (_h, args) => (args ? { ok: false, maybe: true, error: 'bitcube took too long to answer' } : { ok: true, lights_route: lr, td: { ok: true, file: YEAR } }) });
  await m.pollProbe();
  const r = await m.control('lightsroute', { route: 'router' });
  assert.equal(r.maybe, true);
  assert.deepEqual(m.snapshot().applying.map((e) => [e.action, e.phase, e.maybe]), [['lightsroute', 'confirming', true]]);
  await assert.rejects(m.control('ropes', { dark: true }), (e) => e.status === 409 && /^wait: the change of the lighting port to the spare router port got no answer from bitcube in time; it unlocks by 21:06$/.test(e.message));
  t += 5000; await m.pollProbe();
  assert.equal(m.snapshot().applying.length, 1, 'a reading that still shows the old port: not yet');
  lr = 'router'; t += 15_000; await m.pollProbe();
  assert.deepEqual(m.snapshot().applying, [], 'the reading shows the port: confirmed, the ropes free again');
  assert.deepEqual(m.snapshot().confirmed.map((e) => [e.id, e.action]), [[r.applying_id, 'lightsroute']]);
  assert.equal((await m.control('ropes', { dark: true }).catch((e) => e)).status, undefined);
});

test('R8 #32: a boot-file change is confirmed by its answer only when that answer shows the new boot file; else by a reading that does', async () => {
  assert.equal(awaitsReading('bootfile', { ok: true, boot_file: LIVE }, { file: LIVE }), false);
  assert.equal(awaitsReading('bootfile', { ok: true, boot_file: YEAR }, { file: LIVE }), true, 'the answer still names the old one');
  assert.equal(awaitsReading('bootfile', { ok: false, boot_file: YEAR }, { file: LIVE }), false, 'a failure is a failure');
  assert.equal(awaitsReading('lightsroute', { ok: true, lights_route: 'direct' }, { route: 'router' }), true);
  assert.equal(awaitsReading('lightsroute', { ok: true, lights_route: 'router' }, { route: 'router' }), false);
  let t = T0, boot = YEAR;
  const m = new Mission({ now: () => t, later: () => {}, probe: async (_h, args) => ({ ok: true, boot_file: boot, td: { ok: true, file: YEAR } }) });
  await m.pollProbe();
  const r = await m.control('bootfile', { file: LIVE });            // probe.ps1's Set-Content failed without an error: the old one
  assert.deepEqual(m.snapshot().confirmed, [], 'never confirmed by an OK answer that shows the old boot file');
  assert.deepEqual(m.snapshot().applying.map((e) => [e.id, e.phase]), [[r.applying_id, 'confirming']]);
  t += 20_000; await m.pollProbe();
  assert.equal(m.snapshot().applying.length, 1);
  boot = LIVE; t += 20_000; await m.pollProbe();
  assert.deepEqual(m.snapshot().confirmed.map((e) => e.id), [r.applying_id]);
  // one whose reading never shows it expires at its limit: "bitcube didn't show it in time", never "Now … opens at boot"
  boot = YEAR;
  const r2 = await m.control('bootfile', { file: LIVE });
  t += 121_000;
  assert.deepEqual(m.snapshot().expired.map((e) => e.id), [r2.applying_id]);
});

test('R8 #0, #1, #28: the history keeps the server\'s verdict on every change with an entry, not only the last one, with its request id', () => {
  let t = T0;
  const h = new History({ file: null, now: () => t });
  h.action({ action: 'switch', body: { file: LIVE }, ok: true, source: 'mission control', label: 'the switch to the live river', applying_id: 'ax.1', request_id: 'rq.1' });
  t += 1000;
  h.action({ action: 'ropes', body: { dark: true }, ok: true, source: 'mission control', applying_id: 'ax.2' });
  // the switch expires after the ropes change: the last action is not its own, but its verdict is kept all the same
  t += 200_000;
  h.observe({ ...payload({ t }), confirmed: [{ id: 'ax.2', action: 'ropes', at: t - 199_000 }], expired: [{ id: 'ax.1', action: 'switch', file: LIVE, at: t - 1000 }] });
  assert.deepEqual(h.verdicts(t).sort((x, y) => (x.id < y.id ? -1 : 1)), [{ id: 'ax.1', request_id: 'rq.1', verdict: 'expired' }, { id: 'ax.2', verdict: 'confirmed' }]);
  // hours later (the server's lists are long empty) the page still learns it, by its entry or by its request id
  t += 3 * 3600e3;
  const m = derive({ ...payload({ t }), verdicts: h.verdicts(t) }, t);
  assert.equal(entryVerdict(m, 'ax.1'), 'expired');
  assert.equal(entryIdOf(m, 'rq.1'), 'ax.1');
  assert.equal(entryVerdict(m, 'ax.9'), null);
  // and the band's Last line never says done for a change bitcube never showed (R8 #1, #28: verify)
  const la = { ...h.events.find((e) => e.applying_id === 'ax.1'), verdict: 'expired' };
  assert.deepEqual(lastDoneParts(la, { applying: [], confirmed: [], expired: [] }), { head: 'Last sent', tail: " · bitcube didn't show it in time" });
  assert.deepEqual(lastDoneParts({ ...la, verdict: undefined }, { applying: [], confirmed: [], expired: [] }), { head: 'Last sent', tail: '' }, 'no verdict known: never "Last done"');
  assert.deepEqual(lastDoneParts({ ...la, maybe: true, ok: false, verdict: 'confirmed' }, { applying: [], confirmed: [], expired: [] }), { head: 'Last done', tail: '' }, 'a maybe later confirmed stays done after the 10 min');
});

test('R8 #19, #28: Recent says a switch, rebuild, boot-file change or start was asked for until the server\'s verdict, then done or not shown', () => {
  let t = T0;
  const h = new History({ file: null, now: () => t });
  h.action({ action: 'switch', body: { file: LIVE }, ok: true, source: 'studio chat', label: 'the switch to the live river', applying_id: 'ax.1' });
  h.action({ action: 'rebuild', body: { file: YEAR }, ok: true, source: 'mission control', applying_id: 'ax.2' });
  h.action({ action: 'ropes', body: { dark: true }, ok: true, source: 'mission control', applying_id: 'ax.3' });
  const words = () => Object.fromEntries(h.recent({ kinds: 'action' }).map((e) => [e.applying_id, describeEvent(e)]));
  assert.deepEqual(words(), { 'ax.1': 'Asked to switch TouchDesigner to the live river from the studio chat', 'ax.2': "Asked to rebuild the river's year with the new LED map from mission control",
                              'ax.3': 'Turned the ropes dark from mission control' });
  t += 200_000;
  h.observe({ ...payload({ t }), confirmed: [{ id: 'ax.2', action: 'rebuild', at: t }], expired: [{ id: 'ax.1', action: 'switch', at: t }] });
  assert.deepEqual(words(), { 'ax.1': "Asked to switch TouchDesigner to the live river from the studio chat, but bitcube didn't show it in time",
                              'ax.2': "Rebuilt the river's year with the new LED map from mission control", 'ax.3': 'Turned the ropes dark from mission control' });
  // a maybe the server later confirmed or gave up on
  h.action({ action: 'bootfile', body: { file: LIVE }, ok: false, maybe: true, source: 'mission control', applying_id: 'ax.4' });
  assert.match(describeEvent(h.recent({ kinds: 'action', limit: 1 })[0]), /may or may not have happened$/);
  h.observe({ ...payload({ t }), confirmed: [{ id: 'ax.4', action: 'bootfile', at: t }] });
  assert.equal(describeEvent(h.recent({ kinds: 'action', limit: 1 })[0]), 'Set the boot file to the live river from mission control, though bitcube answered late');
});

test('R8 #2, #30: over HTTP, a request id rides on the entry and its verdict; the socket\'s status names ids and verdicts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'r8-'));
  writeFileSync(join(dir, 'pw'), 'NOT-A-REAL-PW\n');
  const base = { ...process.env }; delete base.MISSION_CONTROL_SOCKET;
  const p = spawn(process.execPath, [SERVER], { env: { ...base, MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'), MISSION_FIXTURES: FIXTURES,
                                                       MISSION_FAKE_AGENT: '1', MISSION_FIXTURE_APPLY_S: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => p.kill());
  const url = await new Promise((resolve, reject) => {
    let out = '';
    p.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); });
    p.on('exit', () => reject(new Error(out)));
  });
  const cookie = (await fetch(url + '/login', { method: 'POST', body: JSON.stringify({ password: 'NOT-A-REAL-PW' }), headers: { 'content-type': 'application/json' } })).headers.get('set-cookie').split(';')[0];
  const h = { cookie: `${cookie}; scenario=all-good`, 'content-type': 'application/json' };
  const status = async () => (await fetch(url + '/api/status', { headers: h })).json();
  // the answer is lost on the way back: the page only knows the id it sent
  const sent = fetch(url + '/api/control/switch', { method: 'POST', headers: h, body: JSON.stringify({ file: LIVE, request_id: 'rq-lost.1' }) });
  let e;
  for (let i = 0; i < 100 && !e; i++) { e = (await status()).applying.find((x) => x.request_id === 'rq-lost.1'); if (!e) await sleep(20); }
  assert.ok(e, 'its entry carries the request id');
  await sent;
  let st;
  for (let i = 0; i < 200; i++) { st = await status(); if (!st.applying.length) break; await sleep(25); }
  assert.ok(st.confirmed.some((x) => x.id === e.id && x.request_id === 'rq-lost.1'), 'and its verdict');
  assert.ok(st.verdicts.some((x) => x.id === e.id && x.request_id === 'rq-lost.1' && x.verdict === 'confirmed'), 'kept with the history too');
  const m = derive(st, st.now);
  assert.equal(entryIdOf(m, 'rq-lost.1'), e.id);
  assert.equal(entryVerdict(m, entryIdOf(m, 'rq-lost.1')), 'confirmed');
  assert.equal(st.last_action.request_id, 'rq-lost.1');
  assert.equal(st.last_action.words, 'Switched TouchDesigner to the live river from mission control');
});

// ---- the pages ---------------------------------------------------------------------------------------------------------------

const maybeSwitch = (t, extra = {}) => ({ id: 'ax.5', action: 'switch', label: "the restart on the river's year", file: YEAR, source: 'mission control', phase: 'confirming', maybe: true,
                                         started_at: t - 93_000, answered_at: t - 30_000, expect_s: 60, blocks: ['ropes', 'hub75', 'switch', 'rebuild', 'bootfile', 'calibrate'], ...extra });

test('R8 #16: while a maybe restart holds the lock and TouchDesigner is seen not running, the advice says when it got no answer and what to do when the buttons unlock', () => {
  const t = T0;
  for (const [err, word, fix] of [['TouchDesigner is not running', 'running', /press Switch to the river's year below/], ['no answer from the TD bridge in 15 s', 'answering', /answer the dialog, or press Switch to the river's year/]]) {
    const m = derive(payload({ t, td: { ok: false, error: err }, applying: [maybeSwitch(t)] }), t + 1000);
    const want = new RegExp(`^The restart on the river's year got no answer from bitcube at ${clock(t - 30_000)}; if TouchDesigner still isn't ${word} when the buttons unlock \\(about ${clock(t - 30_000 + 180_000)}\\), `);
    assert.match(m.overall.action, want, err);
    assert.match(m.overall.action, fix);
    assert.match(m.items.find((x) => x.id === 'touchdesigner').action, want, 'the TouchDesigner row says the same');
    assert.equal(m.overall.level, 'down', 'a maybe explains nothing: the fault is said as it is');
    assert.match(m.controls.switch.why, /^wait: the restart on the river's year got no answer from bitcube in time; it unlocks by \d\d:\d\d$/);
    assert.equal(m.controls.switch.by, 'ax.5');
    assert.deepEqual(m.show.held, { label: "the restart on the river's year", on: "the river's year", answered_at: t - 30_000, unlock_at: t - 30_000 + 180_000 });
  }
  // without a maybe holding the lock, the plain advice (and no held restart)
  const plain = derive(payload({ t, td: { ok: false, error: 'TouchDesigner is not running' } }), t + 1000);
  assert.equal(plain.overall.action, "Start it with Switch to the river's year below (about a minute).");
  assert.equal(plain.show.held, null);
});

test('R8 #17: every "Wait: …" for a change bitcube didn\'t answer in time says when it unlocks, and a refusal or withdrawn confirm says it in the past', () => {
  const t = T0;
  const m = derive(payload({ t, applying: [maybeSwitch(t, { label: 'the switch to the live river', file: LIVE })] }), t + 1000);
  for (const k of ['ropes', 'hub75', 'switch', 'rebuild', 'bootfile', 'calibrate']) assert.equal(m.controls[k].why, `wait: the switch to the live river got no answer from bitcube in time; it unlocks by ${clock(t + 150_000)}`, k);
  assert.equal(notSentWords(m.controls.ropes.why, '21:05'), `Not sent at 21:05: the switch to the live river had got no answer from bitcube; the buttons unlock by ${clock(t + 150_000)}. Press again then.`);
  assert.equal(failWords('The panels are unchanged', m.controls.hub75.why, '21:05'), `The panels are unchanged: the switch to the live river had got no answer from bitcube; the buttons unlock by ${clock(t + 150_000)}. Press again then.`);
  // an ordinary change in flight reads as before
  const n = derive(payload({ t, applying: [maybeSwitch(t, { maybe: false })] }), t + 1000);
  assert.equal(n.controls.ropes.why, "wait: the restart on the river's year is being applied");
});

test('R8 #22: another phone says the same usual time as the sending phone for a calibration start and a boot-file change', () => {
  const c = { action: 'calibrate', label: 'the calibration start', phase: 'confirming', expect_s: 10 };
  assert.equal(entryWords(c, 15), 'Waiting for bitcube to show the calibration start · 0:15 · a run usually shows within a minute');
  assert.equal(entryWords({ ...c, action: 'bootfile', label: 'the change of the boot file to the live river', expect_s: 15 }, 43), "Waiting for bitcube to show the change of the boot file to the live river · 0:43 · bitcube's full check shows it within a minute");
  assert.equal(entryWords({ ...c, phase: 'applying' }, 3), 'Applying: the calibration start · 0:03 · usually a few seconds', 'while its request is in flight, as before');
});

test('R8 #9: another phone\'s change that ended is said once by the band\'s region: done, or not shown in time; never this phone\'s own', () => {
  const t = T0;
  const st = payload({ t, extra: { confirmed: [{ id: 'ax.1', action: 'bootfile', label: 'the change of the boot file to the live river', source: 'studio chat', at: t - 5000 },
                                                { id: 'ax.2', action: 'ropes', label: 'the change of the ropes to dark', source: 'mission control', at: t - 4000 }],
                                    expired: [{ id: 'ax.3', action: 'switch', label: 'the switch to the live river', source: 'mission control', at: t - 2000 }] } });
  const m = derive(st, t);
  assert.deepEqual(endedSaid(m, {}, t), ['Done: the change of the boot file to the live river, from the studio chat.', "The switch to the live river: bitcube didn't show it in time."]);
  // R9 #5: how a change ended is said once beside the band's words (model.js endedOnce), never part of them
  assert.doesNotMatch(bandSaid(m, {}), /Done:|didn't show it in time/);
  assert.deepEqual(endedSaid(m, { ownIds: ['ax.3'] }, t), ['Done: the change of the boot file to the live river, from the studio chat.'], 'this phone\'s own is said on its control');
  assert.deepEqual(endedSaid(m, {}, t + ENDED_SAID_S * 1000 + 5000), [], 'said once, then gone');
  assert.deepEqual(endedSaid(m, {}, null), [], 'without the server\'s clock: nothing');
});


test('R8 #18: this page\'s own change that bitcube didn\'t answer in time says once when the buttons unlock, never a Wait line about itself', async () => {
  const { heldWords, MAYBE_HOLDS } = await import('../public/model.js');
  const { MAYBE_HOLDS: SERVER_HOLDS } = await import('../lib/applying.mjs');
  assert.equal(SERVER_HOLDS, MAYBE_HOLDS, 'one table for the server and the pages');
  assert.equal(heldWords('the switch to the live river', '21:07'), 'The switch to the live river got no answer from bitcube in time: it may or may not have happened; the buttons unlock when bitcube shows it, or by 21:07.');
  const st = readFileSync(new URL('../public/status.js', import.meta.url), 'utf8'), ui = readFileSync(new URL('../public/ui.js', import.meta.url), 'utf8');
  assert.match(st, /const w = busy\(name\) \|\| ownBlock\(name\) \? null : whyOf\(name\)/, 'Status: no "Wait: …" about its own change');
  assert.match(st, /model\.controls\[name\]\?\.by === ctl\[name\]\.entryId/);
  assert.match(ui, /o\.whyBy === entryId\) \|\| o\.whyOwn === true/, 'control(): the same, and for a sibling on the page (Dry run under Start)');
});

test('R8 #2: every page sends its own request id with a control and finds a lost answer\'s entry by it', () => {
  const st = readFileSync(new URL('../public/status.js', import.meta.url), 'utf8'), ui = readFileSync(new URL('../public/ui.js', import.meta.url), 'utf8');
  const lights = readFileSync(new URL('../public/lights.js', import.meta.url), 'utf8');
  assert.match(st, /api\(path, requestId \? \{ \.\.\.body, request_id: requestId \} : body\)/);
  assert.match(st, /ownVerdict\(model, \{ state: c\.s\.state, entryId: c\.entryId, requestId: c\.requestId,/);   // CR8 #10: one rule
  assert.match(st, /if \(fresh\) \{ c\.entryId = own\.entryId; mine\.id\(c\.entryId\); \}/);
  assert.match(ui, /o\.run\?\.\(\{ requestId \}\)/);
  assert.match(ui, /ownVerdict\(n\.model, \{ state: s\.state, entryId, requestId,/);
  assert.match(ui, /if \(own\) entryId = own\.entryId/);
  assert.match(readFileSync(new URL('../public/model.js', import.meta.url), 'utf8'), /\(waiting && c\?\.requestId \? entryIdOf\(m, c\.requestId\) : null\)/, 'found by its request id while it waits');
  assert.equal((lights.match(/request_id: requestId/g) ?? []).length, 2, 'Lights: a start (or dry run) and a rebuild send theirs');
});

test('R8 #16, #17, #22, #23, #33, #35: Status wires them: the band line\'s maybe and action, the Wait line for a locked jump, the Last line once, past readouts, the server\'s clock', () => {
  const st = readFileSync(new URL('../public/status.js', import.meta.url), 'utf8');
  assert.match(st, /data-maybe="\$\{a\.maybe \? '1' : ''\}" data-action="\$\{esc\(a\.action\)\}"/);
  assert.match(st, /maybe: s\.dataset\.maybe === '1', action: s\.dataset\.action \|\| null/);
  assert.match(st, /class="ctl-why jump-wait"/);
  assert.match(st, /others\.some\(\(x\) => x\.id === a\.applying_id\)\) return ''/);
  assert.match(st, /Last seen: showing <b>/);
  assert.match(st, /Maybe restarting on <b>/);
  assert.doesNotMatch(st.replace(/fmt\.clock\(a\.t\)/, ''), /fmt\.clock\(Date\.now\(\)\)/, 'no control line stamped with the phone\'s clock');
  const chat = readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /serverNow\(\) - e\.t/, 'the chat counts a request from its start on the server\'s clock (ui.js serverNow, CR8 #13)');
});

test('every page script parses (a slip in a page file breaks the whole page, and no other test loads it)', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  const dir = fileURLToPath(new URL('../public/', import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) execFileSync(process.execPath, ['--check', join(dir, f)], { stdio: 'pipe' });
});

const RESTART = (t) => [{ id: 'ax.8', action: 'switch', label: "the restart on the river's year", file: YEAR, source: 'mission control', phase: 'confirming', started_at: t - 3000, answered_at: t - 1000, expect_s: 60, blocks: ['ropes', 'hub75', 'switch'] }];

test('R8 #5: a chosen restart never makes the band\'s fault look as if it started seconds ago; Recent says it was as before', async () => {
  const { feed } = await import('../lib/history.mjs');
  let t = T0;
  const h = new History({ file: null, now: () => t });
  const camDown = (extra = {}) => { const p = payload({ t, ...extra }); p.probe.value.devices.gallery_cam = false; return p; };
  h.observe(camDown()); t += 18 * 60_000; h.observe(camDown());
  assert.equal(h.since('overall', t).cause, 'gallery-cam');
  const began = h.since('overall', t).since;
  const n = h.events.length;
  for (const td of [{ ok: false, error: 'not running' }, { ok: false, error: 'not answering' }]) { t += 5000; h.observe(camDown({ td, applying: RESTART(t) })); }
  assert.equal(h.state.overall.cause, 'td-restarting', 'the restart is a line of its own');
  t += 30_000; h.observe(camDown());
  t += 33_000;
  const s = h.since('overall', t);
  assert.deepEqual([s.cause, s.since], ['gallery-cam', began], 'the same fault as before the restart keeps its since (not "Attention for 33 s")');
  const lines = feed(h.events.slice(n)).map((e) => e.words);
  assert.ok(lines.includes("TouchDesigner is restarting on the river's year"), JSON.stringify(lines));
  assert.ok(lines.some((w) => /^After the restart, as before: the gallery camera is down/.test(w)), JSON.stringify(lines));
  // TouchDesigner's own fault still there after a restart is a new instance: its since starts again, as its row's does (R7 #4)
  t += 5000;
  const slow = { ok: true, file: YEAR, fps: 4, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [1, 1] } }, hub75: { brightness: 1, output: true } };
  h.observe(payload({ t, td: slow })); t += 10 * 60_000; h.observe(payload({ t, td: slow }));
  t += 5000; h.observe(payload({ t, td: { ok: false, error: 'not running' }, applying: RESTART(t) }));
  t += 30_000; h.observe(payload({ t, td: slow }));
  assert.deepEqual([h.since('overall', t).cause, h.since('overall', t).since], ['td-slow', t]);
  // a different cause after the restart is news, with its own since
  t += 5000; h.observe(camDown({ td: { ok: false, error: 'not running' }, applying: RESTART(t) }));
  t += 30_000; h.observe(payload({ t, td: { ok: true, file: YEAR, fps: 4, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [1, 1] } }, hub75: { brightness: 1, output: true } } }));
  assert.equal(h.since('overall', t).since, t);
});

test('R8 #25: after a restart, a deliberate state reads as itself ("The ropes are still dark on purpose"), never "still need attention"', async () => {
  const { describeEvent: words } = await import('../lib/history.mjs');
  assert.equal(words({ kind: 'item', id: 'ropes', from: 'warning', to: 'warning', summary: 'Dark on purpose: sending black', still: true }), 'The ropes are still dark on purpose: sending black');
  assert.equal(words({ kind: 'item', id: 'hub75 panels', from: 'warning', to: 'warning', summary: "At 0 %, so they're dark", still: true }), "The panels are still at 0 %, so they're dark");
  // a real fault keeps "still needs attention"; down stays "still down"
  assert.equal(words({ kind: 'item', id: 'touchdesigner', from: 'warning', to: 'warning', summary: 'Running slowly: 4 of 60 frames a second', still: true }), 'TouchDesigner still needs attention: running slowly; 4 of 60 frames a second');
  assert.equal(words({ kind: 'item', id: 'modal link', from: 'warning', to: 'warning', summary: 'Gallery clips failing since 02:43; river fine', still: true }), 'Clips to Dave still needs attention: gallery clips failing since 02:43; river fine');
  assert.equal(words({ kind: 'item', id: 'gallery camera', from: 'down', to: 'down', summary: 'Not answering', still: true }), 'The gallery camera is still down: not answering');
});

test('R8 #38: the credential mask catches prefixed keys and the common login forms, and still spares input_tokens', async () => {
  const { scrubCreds } = await import('../lib/scrub.mjs');
  const S = 'NOTREALhunter2r8';
  for (const [raw, want] of [
    [`{"cam_password":"${S}"}`, '{"cam_password":"***"}'],
    [`{"admin_password": "${S}", "user": "admin"}`, '{"admin_password": "***", "user": "admin"}'],
    [`CAM_PASSWORD=${S} python tools/cameras/ptz.py gallery Left 0.2`, 'CAM_PASSWORD=*** python tools/cameras/ptz.py gallery Left 0.2'],
    [`export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-${S}`, 'export CLAUDE_CODE_OAUTH_TOKEN=***'],
    [`curl -H "X-Auth-Token: ${S}" https://h/x`, 'curl -H "X-Auth-Token: ***" https://h/x'],
    [`{"access_token":"${S}","refresh_token":"${S}2","expires_in":3600}`, '{"access_token":"***","refresh_token":"***","expires_in":3600}'],
    [`curl -u admin:${S} https://192.168.9.76/cgi-bin/api.cgi`, 'curl -u admin:*** https://192.168.9.76/cgi-bin/api.cgi'],
    [`curl --user admin:${S} x`, 'curl --user admin:*** x'],
    [`curl -H 'Authorization: Bearer sk-ant-${S}' x`, "curl -H 'Authorization: Bearer ***' x"],
    [`Authorization: Basic YWRtaW46${S}==`, 'Authorization: Basic ***'],
    [`sshpass -p ${S} ssh root@100.127.193.8`, 'sshpass -p *** ssh root@100.127.193.8'],
    [`python ptz.py --password ${S} --user admin`, 'python ptz.py --password *** --user admin'],
    [`{"api_key":"${S}","apiKey":"${S}"}`, '{"api_key":"***","apiKey":"***"}'],
    ['"input_tokens": 1234, "max_tokens": 9, the passwords file, secret_ref: x, pwd; ls', '"input_tokens": 1234, "max_tokens": 9, the passwords file, secret_ref: x, pwd; ls'],
  ]) {
    const got = scrubCreds(raw);
    assert.equal(got, want, raw);
    assert.doesNotMatch(got, /hunter2/, raw);
  }
  // an object's key with a prefix is masked whatever it holds, as the exact keys are
  assert.deepEqual(scrubCreds({ cam_password: 'x', access_token: { a: 1 }, input_tokens: 5, refresh_token: null }), { cam_password: '***', access_token: '***', input_tokens: 5, refresh_token: null });
});

test('R8 #37: step lines read the remaining direct changes as changes (calibration.cancel, a write into River\\, td.ps1 -File, .bypass, a script run after a look)', async () => {
  const { describeTool } = await import('../lib/steps.mjs');
  const b = (command, description) => { const d = describeTool({ name: 'Bash', input: { command, description } }); return [d.text, d.acting]; };
  assert.deepEqual(b('ssh bitcube "Set-Content C:\\Users\\user\\River\\calibration.cancel 1"', 'Look at the calibration'), ['stopped the calibration', true]);
  assert.deepEqual(b('ssh bitcube "echo x > C:\\Users\\user\\River\\calibration.cancel"', 'Look at the calibration'), ['stopped the calibration', true]);
  assert.deepEqual(b('node mission/bin/mc.mjs status && ssh bitcube "Set-Content C:\\Users\\user\\River\\calibration.cancel 1"', 'Look at the calibration'),
    ['stopped the calibration on bitcube directly, not through mission control', true]);
  assert.deepEqual(b('ssh bitcube "Set-Content C:\\Users\\user\\River\\boot-file.txt river-online-oct-23.toe"', 'Check bitcube'), ['changed the boot file', true]);
  assert.deepEqual(b('ssh bitcube powershell -File tools/td.ps1 "op(\'/project1/panels\').bypass = True"', 'Check the panels'), ['changed the panels', true]);
  assert.deepEqual(b('ssh bitcube powershell -File tools/td.ps1 -File td/build/build_ropes.py', 'Check the ropes build'), ['changed the ropes', true]);
  assert.deepEqual(b('node mission/bin/mc.mjs status && bash /tmp/x.sh', 'Look'), ['ran a script, not through mission control', true]);
  // reads stay reads
  assert.deepEqual(b('ssh bitcube "Get-Content C:\\Users\\user\\River\\boot-file.txt"', 'Check the boot file'), ['checked the boot file', false]);
  assert.deepEqual(b('ssh bitcube "Test-Path C:\\Users\\user\\River\\calibration.cancel"', 'Check the calibration'), ['checked the calibration', false]);
  assert.deepEqual(b('ssh bitcube powershell -File tools/td.ps1 "op(\'/project1/panels\').bypass"', 'Check the panels'), ['checked the panels', false]);
  assert.deepEqual(b('ssh bitcube powershell -File tools/td.ps1 -Screenshot /project1/seasons/screens_preview', 'Take a screenshot of the panels'), ["took a picture of the screen of the panels", false]);
  assert.deepEqual(b('node mission/bin/mc.mjs status 2>&1 | head -40', 'Look'), ['looked at what mission control shows', false]);
});
