// Round 10, the pages' share (critics on 1e731d3, fixed on fix-r10): nothing moves under a finger mid-tap in the chat; a confirm
// judged again when the show file changes; a press mission control never got; a lost answer said once, in one state; how changes
// end said once, in order, by whom; advice that waits only for its remedy; the words of a refusal, a held restart, a dry run and the
// lighting port; Recent's one line per event; a cabling fault that a restart never hides.
// What node can't run (a DOM) is checked as wiring here and walked in Chrome (shots/fix-r10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, bandParts, entrySaid, entryWords, endedEntries, endedOnce, ownVerdict, failWords, notSentWords, confirmChanged, CHANGED_MEANWHILE,
  neverGotWords, NOT_RECEIVED, UNKNOWN_ANSWERS, calStep, tdStartingWhy } from '../public/model.js';
import { stateWords } from '../public/lights-words.js';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const T0 = Date.UTC(2026, 9, 26, 4, 4, 0);          // 21:04 Pacific
const page = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const TD = { ok: true, file: YEAR, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } };
function payload({ t = T0, td = TD, applying = [], extra = {}, probe = {}, devices = {} } = {}) {
  return { now: t, bitcube: { ok: true, at: t, value: { online: true } }, seasons: { ok: true, at: t, value: { season: 'winter', mode: 'automatic', intensity: 0.2, presence: { available: false } } },
    modal: { ok: true, at: t, value: { ok: true, tick: 1, next_tick_epoch: t / 1000 + 200, finished_at: new Date(t - 60_000).toISOString() } },
    probe: { ok: true, at: t, value: { ok: true, uptime_h: 30, time: '2026-10-25T21:04:00', boot_file: YEAR, show_files: [YEAR, LIVE], displays: ['M14', 'LED 1920X1080'],
      devices: { psac10_1: true, psac10_2: true, gallery_cam: true, river_cam: true, router: true, internet: true, ...devices }, td, ...probe } },
    applying, ...extra };
}
const RESTART = "the restart on the river's year";
const entry = (id, extra = {}) => ({ id, action: 'switch', label: RESTART, file: YEAR, source: 'mission control', phase: 'applying', started_at: T0 - 3000, expect_s: 60, ...extra });

// ---- #0: the chat's Send and Stop land on the first tap ----------------------------------------------------------------------------

test('R10 #0: the tab bar stays aside while focus is anywhere in the composer, and a press of Send or Stop keeps focus in the box', () => {
  const css = page('chat.css'), js = page('chat.js');
  assert.doesNotMatch(css, /textarea:focus\)/, 'never only while the box itself has focus');
  assert.match(css, /body:has\(\.composer:focus-within\) nav\.tabs \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 300px\) \{[\s\S]*?body:has\(\.composer:focus-within\) \{ padding-bottom/);
  assert.match(js, /for \(const b of \[sendBtn, \$\('stop'\)\]\) b\.addEventListener\('mousedown', \(e\) => \{ if \(document\.activeElement === text && !b\.disabled\) e\.preventDefault\(\); \}\);/);
});

// ---- #28: a confirm is judged again when what it asks changed ----------------------------------------------------------------------

test('R10 #28: a confirm whose question changed (the show file changed meanwhile) is withdrawn on an answer and on yes, never sent', () => {
  const restartYear = { title: "Restart on the river's year now?", ok: "Restart on the river's year" };
  const switchYear = { title: "Switch to the river's year now?", ok: "Switch to the river's year" };
  assert.equal(confirmChanged(restartYear, switchYear), true);
  assert.equal(confirmChanged(restartYear, { ...restartYear, body: 'other words' }), false, 'its title and its action decide');
  assert.equal(confirmChanged(restartYear, null), false, 'nothing to compare: kept');
  assert.equal(notSentWords(CHANGED_MEANWHILE, '21:04'), 'Not sent at 21:04: the show file changed meanwhile.');
  const st = page('status.js');
  assert.match(st, /c\.asked = ask; c\.askFn = typeof o\.ask === 'function' \? o\.ask : null;/);
  assert.match(st, /const w = whyOf\(name\) \?\? askedElse\(c\);/, 'on every status answer');
  assert.match(st, /why: whyOf\(name\) \?\? \(yes \? askedElse\(c\) : null\)/, 'and on yes');
  assert.match(st, /if \(!c\.askFn \|\| !c\.asked \|\| !model\?\.show\.file\) return null;/, 'never when what runs isn\'t known');
});

// ---- #2: a press mission control never got ----------------------------------------------------------------------------------------

test('R10 #2: a press no status answer knows says "Not received by mission control yet"; at its limit, "Not sent … nothing changed" and its buttons unlock', async () => {
  const { controlLine } = await import('../public/status-words.js');
  assert.equal(UNKNOWN_ANSWERS, 2);
  assert.equal(neverGotWords('21:04'), 'Not sent at 21:04: mission control never got it; nothing changed. Press again.');
  const c = { s: { state: 'applying', sentAt: 0 }, applyText: "Applying: the restart on the river's year…", expectS: 60, notReceived: true };
  assert.deepEqual(controlLine(c, 13_000), { cls: 'pending applying', spin: true, text: `${NOT_RECEIVED} · 0:13` });
  assert.match(controlLine({ ...c, notReceived: false }, 13_000).text, /^Applying: the restart on the river's year · 0:13/);
  // the server knows a press by its request id in any list: in flight, confirmed, expired, failed, the history's verdicts
  const t = T0 + 5000;
  const known = derive(payload({ t, applying: [entry('k.1', { request_id: 'rq.k' })] }), t);
  assert.equal(ownVerdict(known, { state: 'applying', requestId: 'rq.k' }).entryId, 'k.1');
  assert.equal(ownVerdict(derive(payload({ t }), t), { state: 'applying', requestId: 'rq.k' }).entryId, null);
  const st = page('status.js'), ui = page('ui.js');
  assert.match(st, /const never = !c\.received && c\.unknown >= UNKNOWN_ANSWERS;/);
  assert.match(st, /else if \(!c\.lostNet && never && !c\.notReceived\) \{ c\.notReceived = true; announce\(NOT_RECEIVED\); \}/);
  assert.match(st, /c\.text = never \? neverGotWords\(sclock\(\)\)/, 'its POST gave up: Not sent');
  assert.match(ui, /if \(!lostNet && never && !notReceived\) \{ notReceived = true; if \(host\.isConnected\) say\(NOT_RECEIVED\); \}/, 'Lights the same (ui.js control())');
  assert.match(ui, /const tracked = \(\) => !!o\.action && !!requestId;/, 'only a press recorded by its request id (Stop sends none)');
});

// ---- #3: Check now ends at its own time ------------------------------------------------------------------------------------------

test('R10 #3: Check now ends on a full check newer than the press, gives up at its own 50 s, and the header keeps its age', async () => {
  const { apiTimeout } = await import('../public/app.js');
  assert.equal(apiTimeout('/api/control/check', {}), 50_000);
  assert.equal(apiTimeout('/api/control/switch', {}), 75_000);
  assert.match(page('status.js'), /if \(name === 'check'\) \{\n\s+const at = model\.sources\.probe\?\.at;\n\s+if \(typeof at === 'number' && c\.sentServer != null && at > c\.sentServer && model\.sources\.probe\?\.ok\)/);
  assert.match(page('ui.js'), /if \(st\.checking && a == null && !st\.stale\) text = 'Checking…';/);
});

// ---- #6, #22, #31, #32: a lost answer, said once in one state; a failure kept as the server's verdict --------------------------------

test('R10 #31: a change the server saw fail is kept as its verdict (status.failed), found by the request id a lost answer sent', async () => {
  const { Applying } = await import('../lib/applying.mjs');
  let t = 1_000_000;
  const a = new Applying({ now: () => t });
  const r = await a.run('switch', { file: YEAR }, async () => ({ ok: false, error: 'probe.ps1 failed (exit 1)' }), { requestId: 'rq.f' });
  assert.deepEqual(a.ended().failed.map((e) => [e.id, e.request_id, e.error]), [[r.applying_id, 'rq.f', 'probe.ps1 failed (exit 1)']]);
  await assert.rejects(a.run('rebuild', { file: YEAR }, async () => { throw new Error('ssh: connect to host bitcube: timed out'); }, { requestId: 'rq.g' }));
  assert.equal(a.ended().failed.find((e) => e.request_id === 'rq.g').error, 'ssh: connect to host bitcube: timed out');
  const q = await a.run('ropes', { dark: true }, async () => ({ ok: false, maybe: true, error: 'bitcube took too long to answer' }), { requestId: 'rq.h' });
  assert.equal(a.ended().failed.find((e) => e.id === q.applying_id).maybe, true, 'a quick change bitcube didn\'t answer: failed, may or may not');
  // the page: its entry, found by the request id, says it failed, with its words
  const at = T0 + 5000;
  const m = derive(payload({ t: at, extra: { failed: a.ended(at).failed } }), at);
  assert.deepEqual(ownVerdict(m, { state: 'applying', requestId: 'rq.f', serverConfirms: true }),
    { entryId: r.applying_id, unlockAt: null, judged: true, step: 'failed', failed: { error: 'probe.ps1 failed (exit 1)', maybe: false } });
  assert.equal(ownVerdict(m, { state: 'applying', requestId: 'rq.h' }).failed.maybe, true);
  // and a phone that slept past the failure still finds it: one that may or may not have happened turns failed
  assert.equal(ownVerdict(m, { state: 'unconfirmed', requestId: 'rq.f', lost: true }).step, 'failed');
});

test('R10 #6, #22, #32: an answer lost on the network says nothing until the next status answer, then the one state its entry is in', () => {
  const st = page('status.js'), ui = page('ui.js');
  // Status: the lost answer waits, its focus left where it is; the answer's entry ends it, once
  assert.match(st, /if \(e\?\.network && requestId\) \{\n\s+c\.lostNet = true; c\.lostErr = e;\n\s+p\.refresh\(\); render\(\);\n\s+return;\n\s+\}/);
  assert.match(st, /if \(c\.lostNet && \(gone \|\| never \|\| Date\.now\(\) - c\.s\.sentAt > c\.limitMs\)\)/);
  // an entry still being applied on the server keeps the control "Applying", never "Sent · waiting" for a change bitcube hasn't answered
  const t = T0 + 5000;
  const m = derive(payload({ t, applying: [entry('l.1', { request_id: 'rq.l' })] }), t);
  assert.equal(ownVerdict(m, { state: 'applying', requestId: 'rq.l', serverConfirms: true }).step, null);
  // ui.js control() the same
  assert.match(ui, /if \(e\?\.network && tracked\(\)\) \{ lostNet = true; lostErr = e; try \{ lastStatus\.h\?\.refresh\?\.\(\); \} catch \{ \/\* the next poll \*\/ \} return; \}/);
});

// ---- #30: an unconfirmed verdict said once --------------------------------------------------------------------------------------

test('R10 #30: the phone that sent a change hears "bitcube didn\'t show it in time" once: the expired step marks it said', () => {
  const t = T0 + 200_000;
  const m = derive(payload({ t, extra: { expired: [{ ...entry('e.1'), at: t - 2000 }] } }), t);
  assert.equal(ownVerdict(m, { state: 'confirming', entryId: 'e.1', serverConfirms: true }).step, 'expired');
  assert.equal(ownVerdict(m, { state: 'unconfirmed', entryId: 'e.1', serverConfirms: true, saidExpired: true }).step, null, 'once said, never "gave up" again');
  assert.match(page('status.js'), /function unconfirm\(name\) \{\n\s+const c = ctl\[name\];\n\s+c\.saidExpired = true;/);
  assert.match(page('ui.js'), /if \(words == null\) saidExpired = true;/);
});

// ---- #9, #21, #26: how changes are said: by whom, in order ----------------------------------------------------------------------

test('R10 #9, #26: another phone\'s change is said as another phone\'s; a maybe\'s source after its words', () => {
  const a = { label: RESTART, phase: 'applying', source: 'mission control' };
  assert.equal(entrySaid(a), `Applying: ${RESTART}, from another phone.`);
  assert.equal(entrySaid({ ...a, source: 'studio chat', phase: 'confirming' }), `Waiting for bitcube to show ${RESTART}, from the studio chat.`);
  assert.equal(entrySaid({ ...a, source: 'studio chat', maybe: true }), `No answer in time for ${RESTART}: waiting for bitcube to show whether it happened, from the studio chat.`);
  assert.equal(entryWords({ ...a, source: 'studio chat', maybe: true }, 75), `No answer in time for ${RESTART}: waiting for bitcube to show whether it happened · from the studio chat · 1:15`);
  const t = T0 + 20_000;
  const m = derive(payload({ t, extra: { confirmed: [{ ...entry('d.1'), at: t - 1000 }] } }), t);
  assert.deepEqual(endedEntries(m, {}, t).map((e) => e.said), [`Done: ${RESTART}, from another phone.`]);
  assert.deepEqual(bandParts(derive(payload({ t, applying: [entry('d.2')] }), t)).lines, [`Applying: ${RESTART}, from another phone.`]);
});

test('R10 #21: a region says how a change ended before what is new', () => {
  const ui = page('ui.js');
  assert.match(ui, /const parts = \[\.\.\.extra\.map\(\(text\) => \(\{ text, once: true \}\)\), \.\.\.news\.map\(\(text\) => \(\{ text \}\)\)\];/);
  assert.match(ui, /const parts = \[\.\.\.kept\.filter\(\(p\) => p\.once\), \.\.\.extra\.map\(\(text\) => \(\{ text, once: true \}\)\), \.\.\.kept\.filter\(\(p\) => !p\.once\)\];/);
});

test('R10 #20: on Lights, a calibration start that showed its run is said by the Calibrate block, never also as "Done: … start"', () => {
  const t = T0 + 20_000;
  const start = { id: 'c.1', action: 'calibrate', label: 'the dry run start', source: 'mission control', at: t - 1000 };
  const m = derive(payload({ t, extra: { confirmed: [start], expired: [{ ...start, id: 'c.2', label: 'the calibration start' }] } }), t);
  const skip = (e, verdict) => e.action === 'calibrate' && verdict === 'confirmed';
  assert.deepEqual(endedEntries(m, { skip }, t).map((e) => e.said), ["The calibration start, from another phone: bitcube didn't show it in time."]);
  const say = endedOnce();
  say(derive(payload({ t: T0 }), T0), {}, T0);
  assert.deepEqual(say(m, { skip }, t), ["The calibration start, from another phone: bitcube didn't show it in time."]);
  assert.match(page('lights.js'), /skip: \(e, verdict\) => e\.action === 'calibrate' && verdict === 'confirmed'/);
});

// ---- #13: the restart's wait advice only for its remedy --------------------------------------------------------------------------

test('R10 #13: a change in flight replaces only advice it is the remedy for; the river camera keeps its own advice and call', () => {
  const t = T0 + 22_000;
  const liveTd = { ...TD, file: LIVE, river_cam: { relay: true, fresh: false, last_frame_age_s: 1800 } };
  const stale = {};
  // the live river restarting doesn't fix a dead camera: its advice and its call line stay
  const cam = derive(payload({ t, td: liveTd, probe: stale, applying: [entry('r.1', { file: LIVE, label: 'the restart on the live river', started_at: t - 22_000 })] }), t);
  assert.equal(cam.overall.cause, 'river-stale');
  assert.match(cam.overall.action, /^Ask Will to restart the river camera/);
  assert.equal(cam.overall.chosen, false, 'its call line stays: Call Will');
  const riverItem = cam.items.find((x) => x.id === 'river camera');
  assert.doesNotMatch(riverItem.action ?? '', /Someone is/);
  // a switch to the year is its remedy
  const sw = derive(payload({ t, td: liveTd, probe: stale, applying: [entry('r.2', { label: "the switch to the river's year", started_at: t - 22_000 })] }), t);
  assert.equal(sw.overall.cause, 'river-stale');
  assert.equal(sw.overall.action, "Someone is switching TouchDesigner to the river's year now: wait a minute and look again.");
  // TouchDesigner slow: any restart is its remedy; a rebuild says a few minutes
  const slow = { ...TD, fps: 20 };
  const rb = derive(payload({ t, td: slow, applying: [entry('r.3', { action: 'rebuild', label: "the rebuild of the river's year", started_at: t - 22_000, expect_s: 150 })] }), t);
  assert.equal(rb.overall.action, "Someone is rebuilding the river's year now: wait a few minutes and look again.");
  const lr = derive(payload({ t, td: { ...slow, file: LIVE, river_cam: undefined }, applying: [entry('r.4', { file: LIVE, label: 'the restart on the live river', started_at: t - 22_000 })] }), t);
  assert.equal(lr.overall.action, 'Someone is restarting TouchDesigner on the live river now: wait a minute and look again.');
});

// ---- #14, #15: the "still starting" refusal ---------------------------------------------------------------------------------------

test('R10 #14, #15: TouchDesigner starting is said in the band\'s words, one colon; refused or withdrawn in the past tense with one instruction', () => {
  const why = tdStartingWhy({ uptime_h: 0.1, td: { ok: true, file: YEAR, fps: null } });
  assert.equal(why, 'bitcube is still coming up; wait a minute');
  assert.equal(failWords('The show file is unchanged', why, '21:04'), 'The show file is unchanged: bitcube was still coming up (21:04). Press again in a minute.');
  assert.equal(failWords("The river's year is unchanged", 'TouchDesigner is restarting; wait a minute', '21:04', { tail: 'Try again, or check Status.' }),
    "The river's year is unchanged: TouchDesigner was restarting (21:04). Press again in a minute.");
  assert.equal(notSentWords(why, '21:04'), 'Not sent at 21:04: bitcube was still coming up. Press again in a minute.');
  assert.equal(notSentWords('TouchDesigner is restarting; wait a minute', '21:04'), 'Not sent at 21:04: TouchDesigner was restarting. Press again in a minute.');
  assert.equal(failWords('The show file is unchanged', 'TouchDesigner is still starting: wait a minute', '21:04'), 'The show file is unchanged: TouchDesigner was still starting (21:04). Press again in a minute.', 'an older server\'s words too');
  // just booted: the row, its control and the band say one state
  const t = T0;
  const m = derive(payload({ t, td: { ...TD, fps: null }, probe: { uptime_h: 0.1 } }), t);
  assert.equal(m.controls.switch.why, 'bitcube is still coming up; wait a minute');
  assert.match(m.overall.headline, /still coming up/);
});

// ---- #16: a held restart said once in the TouchDesigner row ----------------------------------------------------------------------

test('R10 #16: the TouchDesigner row whose advice says when a held restart unlocks shows no Wait line, and its readout only "Maybe restarting on …"', () => {
  const t = T0 + 30_000;
  const m = derive(payload({ t, td: { ok: false, error: 'not running' }, applying: [entry('h.1', { phase: 'confirming', maybe: true, started_at: T0 - 10_000, answered_at: T0 + 20_000 })] }), t);
  const td = m.items.find((x) => x.id === 'touchdesigner');
  assert.equal(td.waits, 'h.1');
  assert.match(td.action, /when the buttons unlock \(by 21:08\)/);
  const st = page('status.js');
  assert.match(st, /x\.id === 'touchdesigner' \? showfileCtlHTML\(m, null, 'td', \{ noWait: !!x\.waits \}\)/);
  assert.match(st, /<div class="ctl-h">Show file<\/div>\$\{noWait \? '' : whyLine\('switch', host\)\}/);
  assert.match(st, /if \(s\.held\) return `Maybe restarting on <b>\$\{esc\(s\.held\.on\)\}<\/b>\$\{boot\}`;/);
});

// ---- #17, #18, #19: Lights' words ------------------------------------------------------------------------------------------------

test('R10 #17: TouchDesigner not running is said once on the Lights state line', () => {
  const m = derive(payload({ td: { ok: false, error: 'not running' } }), T0);
  assert.equal(stateWords(m), 'The ropes and the panels are not being driven: TouchDesigner is not running.');
  const f = derive(payload({ td: { ok: false, error: 'not answering' } }), T0);
  assert.doesNotMatch(stateWords(f), /not running.*not running/);
});

test('R10 #18, #19: a dry run\'s stages in words, never step numbers; the Calibrate card says the lights stay as they are once', async () => {
  const { describeEvent } = await import('../lib/history.mjs');
  assert.deepEqual(['ropes-capture', 'ropes-decode', 'hub75-capture', 'hub75-locate'].map((s) => calStep(s).label), ['Ropes', 'Rope map', 'Panels', 'Panel places']);
  assert.equal(describeEvent({ kind: 'calibration', running: true, stage: 'ropes-decode', mode: 'dry-run', from: { running: true, stage: 'ropes-capture' } }), 'A dry run is at the rope map');
  const m = derive(payload({ probe: { calibration: { running: true, stage: 'ropes-decode', mode: 'dry-run', dry_run: true, expected_s: 40, elapsed_s: 5 } } }), T0);
  assert.equal(m.overall.detail, "It walks the calibration's steps without touching the lights; it is at the rope map now, and ends by itself in about a minute.");
  for (const f of ['model.js', 'lights.js', 'lights-words.js']) assert.doesNotMatch(page(f), /`step \$\{|`Step \$\{|\(step \$\{/, f);
  const lights = page('lights.js'), html = page('lights.html');
  assert.match(html, /<span class="note">the real run interrupts the show<\/span>/);
  assert.match(lights, /before: dry \? 'Ends the dry run now\.' : CAL_COPY\.stopBefore,/);
  assert.doesNotMatch(lights, /a check that bitcube can run one|Ends the check now/);
  assert.match(lights, /\$\{dry \? 'Nothing changed; the lights were never touched\.'/);
  const { CAL_COPY, runFine } = await import('../public/lights-words.js');
  assert.doesNotMatch(CAL_COPY.stopped, /^Stopped/, 'never the heading\'s word again under it');
  assert.equal(runFine({ started: '07:00', dry: true }), 'Started 07:00.');
});

// ---- #23: Recent says one event once ---------------------------------------------------------------------------------------------

test('R10 #23: a calibration start reads "Asked to …" then the run\'s own line; a piece still not OK after a restart isn\'t said beside the band\'s same line', async () => {
  const { History, feed } = await import('../lib/history.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  let now = T0;
  const h = new History({ file: join(mkdtempSync(join(tmpdir(), 'r10-h-')), 'h.jsonl'), now: () => now });
  h.observe(payload({ t: now }), now);
  now += 5000;
  h.action({ action: 'calibrate', body: { action: 'start' }, ok: true, applying_id: 'cal.1', source: 'mission control' });
  now += 10_000;
  const cal = { running: true, stage: 'ropes-capture', mode: 'full', started: now / 1000 - 5, updated: now / 1000, elapsed_s: 5, expected_s: 170, read_age_s: 0 };
  h.observe({ ...payload({ t: now, probe: { calibration: cal } }), confirmed: [{ id: 'cal.1', action: 'calibrate', label: 'the calibration start', source: 'mission control', at: now }] }, now);
  const words = feed(h.recent()).map((e) => e.words);
  assert.ok(words.includes('Asked to start a calibration from mission control'), words.join(' | '));
  assert.ok(words.some((w) => /^The calibration started/.test(w)), words.join(' | '));
  assert.ok(!words.some((w) => /^bitcube showed the calibration start/.test(w)), 'the run\'s own line carries the verdict');
  assert.ok(!words.some((w) => /^Calibrating the lights/.test(w)), 'the band\'s line is not a second line for the same event');
});

// ---- #24: older step lines in today's words --------------------------------------------------------------------------------------

test('R10 #24: a step kept before R9 #27 reads "the team\'s work log" when it is shown', async () => {
  const { stepWords } = await import('../public/chat-words.js');
  assert.equal(stepWords({ text: 'changed the session notes', raw: 'docs/sessions/U.md', acting: false }).text, "changed the team's work log");
  assert.equal(stepWords({ text: 'looked at the session notes' }).text, "looked at the team's work log");
});

// ---- #27: one instruction for the lighting port on both or neither --------------------------------------------------------------

test('R10 #27: both ports or neither: one instruction, the same in the Installer and the Ropes row, and no "only after moving the cable"', () => {
  const at = (lr) => derive(payload({ probe: { lights_route: lr } }), T0);
  assert.equal(at('BOTH').show.ropes.route_note, 'the lighting network is set on both ports; press the port the lighting switch is plugged into');
  assert.match(at('BOTH').items.find((x) => x.id === 'ropes').detail, /press the port the lighting switch is plugged into\.$/);
  assert.match(at('none').show.ropes.route_note, /press the port the lighting switch is plugged into$/);
  for (const lr of ['BOTH', 'none']) assert.doesNotMatch(JSON.stringify(at(lr).show.ropes) + at(lr).items.find((x) => x.id === 'ropes').detail, /address/);
  const st = page('status.js');
  assert.match(st, /\? `\$\{seen\.pre\}: <b>\$\{esc\(s\.ropes\.route_note\)\}<\/b>\$\{seen\.tail\}\. The wrong port leaves all 20 ropes dark\. It asks first\.`/);
});

// ---- #29: a cabling fault never hidden by a restart ------------------------------------------------------------------------------

test('R10 #29: while TouchDesigner restarts, both rope boxes silent and no panel sender stay a Down cause at the head of the band', () => {
  const t = T0 + 10_000;
  const m = derive(payload({ t, td: { ok: false, error: `restarting on ${YEAR}` }, devices: { psac10_1: false, psac10_2: false }, probe: { displays: ['M14'] },
    applying: [entry('w.1', { started_at: t - 10_000 })] }), t);
  assert.equal(m.overall.level, 'down');
  assert.equal(m.overall.cause, 'lights');
  for (const id of ['rope box 1', 'rope box 2']) assert.equal(m.items.find((x) => x.id === id).cause, 'lights', id);
  assert.ok(m.problems.some((p) => p.id === 'td-restarting'), 'the restart is still said, below it');
});

// ---- #33: a row says its source once -----------------------------------------------------------------------------------------------

test('R10 #33: bitcube offline and no internet say their source on the source line only', () => {
  const off = derive({ ...payload(), bitcube: { ok: true, at: T0, value: { online: false } } }, T0);
  assert.equal(off.items.find((x) => x.id === 'bitcube').summary, 'Offline: not reachable');
  const ni = derive(payload({ devices: { internet: false } }), T0);
  assert.equal(ni.items.find((x) => x.id === 'internet').summary, 'No internet');
});
