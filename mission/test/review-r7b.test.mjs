// Round 7, the second fixer's share (docs/mission-ui.md): the scrubber's password fields, the chat's step lines for the panels and
// for a status read chained to a direct change, the chat can't stop a calibration through the socket, the fixtures' time left,
// Recent's lines for a restart, a dry run that locks nothing on the lights, one name per change, the 409's past tense.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubCreds } from '../lib/scrub.mjs';
import { describeTool } from '../lib/steps.mjs';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const bash = (command, description = '') => describeTool({ name: 'Bash', input: { description, command } });

test('R7 #37: a password, token or secret in a JSON body, an escaped JSON body or a query is masked, not only a URL login', () => {
  const cases = [
    ['[{"cmd":"Login","param":{"User":{"userName":"admin","password":"hunter2"}}}]', '[{"cmd":"Login","param":{"User":{"userName":"admin","password":"***"}}}]'],
    ['curl -sk "https://192.168.9.76/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=x&user=admin&password=hunter2r7" -o a.jpg',
     'curl -sk "https://192.168.9.76/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=x&user=admin&password=***" -o a.jpg'],
    ['{"password":"x"} ?password=x', '{"password":"***"} ?password=***'],
    ['body \'{\\"password\\":\\"p@ss w\\"}\'', 'body \'{\\"password\\":\\"***\\"}\''],
    ["{'passwd': 'secret one', 'pwd': 'two'}", "{'passwd': '***', 'pwd': '***'}"],
    ['token=abc123&x=1 secret: s3cr3t; Token = "t"', 'token=***&x=1 secret: ***; Token = "***"'],
    ['rtsp://admin:pw@10.0.0.1/x', 'rtsp://***@10.0.0.1/x'],
  ];
  for (const [raw, want] of cases) assert.equal(scrubCreds(raw), want, raw);
  // never what merely looks like one: input_tokens, a passwords file, a word in a sentence
  for (const keep of ['"input_tokens": 1234', 'the passwords file is untracked', 'no token here', 'secrets.local.json', 'cd $PWD/x']) assert.equal(scrubCreds(keep), keep);
  // deep, as before
  assert.deepEqual(scrubCreds({ a: ['user=admin&password=x'], b: { c: '"token": "y"' } }), { a: ['user=admin&password=***'], b: { c: '"token": "***"' } });
  // and a step's raw tooltip (what reaches every phone)
  assert.doesNotMatch(bash('curl -sk "https://192.168.9.76/cgi-bin/api.cgi?cmd=Snap&user=admin&password=hunter2r7" -o a.jpg').raw, /hunter2r7/);
  assert.doesNotMatch(bash(`curl -sk -d '[{"cmd":"Login","param":{"User":{"userName":"admin","password":"hunter2"}}}]' https://192.168.9.76/cgi-bin/api.cgi`).raw, /hunter2/);
});

test('R7 #22: a panels change asked of mission control reads as a change and is an acting line', () => {
  for (const [cmd, desc] of [[`node mission/bin/mc.mjs hub75 '{"brightness":0}'`, 'Panels off'], [`node mission/bin/mc.mjs hub75 '{"brightness":0}'`, ''],
                             [`node mission/bin/mc.mjs hub75 '{"brightness":0.5}'`, 'Ask mission control to set HUB75 brightness 0.5']]) {
    const s = bash(cmd, desc);
    assert.equal(s.acting, true, `${cmd} / ${desc}`);
    assert.match(s.text, /^asked mission control to set the panel brightness to (0|50) %$/, `${cmd} / ${desc}`);
  }
});

test('R7 #34: a status read chained to a change made directly on bitcube is an acting line that says so', () => {
  const cases = [
    [`node mission/bin/mc.mjs status && ssh bitcube powershell -File C:\\x\\probe.ps1 -Action switch -BootFile ${LIVE}`, /show file/],
    ['node mission/bin/mc.mjs check; ssh bitcube "powershell -File C:\\x\\probe.ps1 -Action ropes -Dark"', /ropes/],
    [`node mission/bin/mc.mjs calibrate '{"action":"status"}' ; ssh bitcube "powershell -File C:\\x\\calibrate.ps1 -Action cancel"`, /calibration/],
    ['node mission/bin/mc.mjs status\nssh bitcube "powershell -File C:\\x\\probe.ps1 -Action hub75 -Brightness 0"', /panels/],
  ];
  for (const [cmd, what] of cases) {
    const s = bash(cmd, 'Look at what mission control shows');
    assert.equal(s.acting, true, cmd);
    assert.match(s.text, what, cmd);
    assert.match(s.text, /on bitcube directly, not through mission control$/, cmd);
  }
  // a status read and a change, both through mission control: still the change, in the history's words (R6)
  const both = bash(`node mission/bin/mc.mjs status && node mission/bin/mc.mjs switch '{"file":"${LIVE}"}'`, 'Check, then switch');
  assert.deepEqual([both.text, both.acting], ['asked mission control to switch TouchDesigner to the live river', true]);
  // a status read piped to a filter changes nothing
  assert.deepEqual(Object.values(bash('node mission/bin/mc.mjs status | head -20', 'Look')).filter((v) => typeof v !== 'string' || !v.includes('node')), ['looked at what mission control shows', false]);
  // a separator inside the JSON body is not a second command
  const quoted = bash(`node mission/bin/mc.mjs rules '{"rules":{"note":"a; b && c"}}'`, '');
  assert.equal(quoted.acting, true);
  assert.match(quoted.text, /^asked mission control to change/);
  void YEAR;
});

test('R7 #32: fixture mode serves a calibration copy as read now, so its time left is the run\'s own', async () => {
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const { FixtureMission } = await import('../lib/fixtures.mjs');
  const { derive } = await import('../public/model.js');
  let t = 1_792_749_540_000;
  const fm = new FixtureMission({ dir: new URL('./fixtures/', import.meta.url).pathname, stateDir: mkdtempSync(join(tmpdir(), 'fx-')), now: () => t, calibrateS: 60 });
  assert.equal((await fm.calibrate('start', {}, { scenario: 'all-good' })).ok, true);
  t += 1000;
  const snap = fm.snapshot('all-good');
  assert.equal(snap.probe.value.calibration.read_age_s, 0);
  const left = derive(snap, snap.now).show.calibration.left_s;
  assert.ok(left > 200, `the run's own time left (scaled to a real run), not the full check's age off it: ${left}`);
  const real = derive({ ...snap, probe: { ...snap.probe, value: { ...snap.probe.value, calibration: { ...snap.probe.value.calibration, read_age_s: undefined } } } }, snap.now).show.calibration.left_s;
  assert.ok(left > real || snap.probe.age_s === 0, 'without it the copy would be aged by the full check');
});

test('R7 #23: a restart is a few lines in Recent: never the same words twice, never the ropes "stopped getting the river"', async () => {
  const { History, describeEvent, feed } = await import('../lib/history.mjs');
  let t = 1_792_749_540_000;
  const h = new History({ file: null, now: () => t });
  const probe = (td) => ({ ok: true, at: t, value: { ok: true, uptime_h: 30, time: '2026-10-25T02:59:00', boot_file: YEAR, show_files: [YEAR, LIVE], displays: ['M14', 'LED 1920X1080'],
    devices: { psac10_1: true, psac10_2: true, gallery_cam: true, river_cam: true, router: true, internet: true },
    td: td ?? { ok: true, file: YEAR, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } } } });
  const status = (td, applying = []) => ({ now: t, bitcube: { ok: true, at: t, value: { online: true } }, probe: probe(td), seasons: { ok: true, at: t, value: { season: 'winter', mode: 'automatic', intensity: 0.2, presence: { available: false } } },
    modal: { ok: true, at: t, value: { ok: true, tick: 1, next_tick_epoch: t / 1000 + 200, finished_at: new Date(t - 60_000).toISOString() } }, applying });
  h.observe(status()); t += 5000;
  const n0 = h.events.length;
  h.action({ action: 'switch', body: { file: YEAR }, ok: true, source: 'mission control', label: "the restart on the river's year" });
  const entry = [{ id: 'a.1', action: 'switch', label: "the restart on the river's year", file: YEAR, phase: 'confirming', started_at: t - 3000, answered_at: t - 1000, expect_s: 60, blocks: ['ropes'] }];
  for (const td of [{ ok: false, error: 'not running' }, { ok: false, error: 'not answering' }, { ok: false, error: 'not answering' }]) { h.observe(status(td, entry)); t += 5000; }
  h.observe(status()); t += 5000;
  const since = feed(h.events.slice(n0)).map((e) => e.words);
  assert.ok(since.length <= 4, `a restart is a few lines: ${JSON.stringify(since)}`);
  assert.ok(since.some((w) => /^TouchDesigner is restarting on the river's year/.test(w)), JSON.stringify(since));
  assert.ok(!since.some((w) => /stopped getting the river|ropes are dark while|ropes are OK again|show the river again/i.test(w)), JSON.stringify(since));
  for (let i = 1; i < since.length; i++) assert.notEqual(since[i], since[i - 1], 'never the same line twice in a row');
  // the same words at the same moment are one line, whatever made them
  const twice = feed([{ kind: 'overall', t: 5, level: 'warning', headline: 'TouchDesigner is restarting on the river\'s year' }, { kind: 'item', t: 5, id: 'touchdesigner', from: 'ok', to: 'warning', summary: "Restarting on the river's year" }]);
  assert.equal(twice.length, 1);
  assert.equal(describeEvent({ kind: 'show', field: 'ropes', from: 'river', to: 'restarting' }) !== '', true);
});

/** A /api/status payload at t, TouchDesigner as given, with what is in flight. */
function payload({ t = 1_792_749_540_000, td, applying = [], calibration = null } = {}) {
  return { now: t, bitcube: { ok: true, at: t, value: { online: true } }, seasons: { ok: true, at: t, value: { season: 'winter', mode: 'automatic', intensity: 0.2, presence: { available: false } } },
    modal: { ok: true, at: t, value: { ok: true, tick: 1, next_tick_epoch: t / 1000 + 200, finished_at: new Date(t - 60_000).toISOString() } },
    probe: { ok: true, at: t, value: { ok: true, uptime_h: 30, time: '2026-10-25T02:59:00', boot_file: YEAR, show_files: [YEAR, LIVE], displays: ['M14', 'LED 1920X1080'],
      devices: { psac10_1: true, psac10_2: true, gallery_cam: true, river_cam: true, router: true, internet: true },
      ...(calibration ? { calibration } : {}),
      td: td ?? { ok: true, file: YEAR, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } } } },
    applying };
}
const SWITCH_ENTRY = (t) => [{ id: 'a.1', action: 'switch', label: "the switch to the river's year", file: YEAR, phase: 'confirming', started_at: t - 3000, answered_at: t - 1000, expect_s: 60, blocks: ['ropes', 'hub75', 'switch'] }];

test('R7 #18: while a chosen switch, restart or rebuild restarts TouchDesigner, the ropes are dark while it restarts, not a fault', async () => {
  const { derive } = await import('../public/model.js');
  const { ropesTile } = await import('../public/status-words.js');
  const t = 1_792_749_540_000;
  const m = derive(payload({ t, td: { ok: false, error: 'not running' }, applying: SWITCH_ENTRY(t) }), t);
  assert.equal(m.overall.cause, 'td-restarting');
  assert.equal(m.show.ropes.state, 'restarting');
  assert.equal(m.show.ropes.words, 'the ropes are dark while TouchDesigner restarts');
  assert.deepEqual(m.show.restart, { on: "the river's year", chosen: true });
  const ropes = m.items.find((x) => x.id === 'ropes');
  assert.deepEqual(ropesTile(m, ropes, false), { state: 'Dark while restarting', words: 'Back in about a minute' });
  // bitcube says it is restarting, but nobody here chose it (no entry): who to call stays "wait and look again"
  const m2 = derive(payload({ t, td: { ok: false, error: `restarting on ${LIVE}` } }), t);
  assert.equal(m2.show.ropes.state, 'restarting');
  assert.deepEqual(m2.show.restart, { on: 'the live river', chosen: false });
  // a frozen TouchDesigner is still a fault: the ropes aren't being driven
  assert.equal(derive(payload({ t, td: { ok: false, error: 'not answering' } }), t).show.ropes.state, 'not-reaching');
  assert.equal(derive(payload({ t }), t).show.restart, null);
});

test('R7 #19: one name per change, made in one place and the same on every phone, in Last done and in the history', async () => {
  const { changeLabel } = await import('../public/model.js');
  const { applyLabel } = await import('../lib/applying.mjs');
  const { lastDoneWhat } = await import('../public/status-words.js');
  const { describeEvent } = await import('../lib/history.mjs');
  const cases = [
    ['ropes', { dark: true }, 'the ropes change to dark'], ['ropes', { dark: false }, 'the ropes change to the river'],
    ['hub75', { brightness: 0.9 }, 'the panels change to 90 %'], ['hub75', { brightness: 0 }, 'the panels change to 0 %'],
    ['mode', { mode: 'manual' }, 'the mode change to Manual'], ['target', { season: 'summer', intensity: 0.7 }, 'the target change to summer, strong'],
    ['rules', { rules: { cycle_seconds: 300 } }, 'the change of 1 rule'], ['rules', { rules: { a: 1, b: 2 } }, 'the change of 2 rules'], ['rules-reset', {}, 'the rules reset'],
    ['bootfile', { file: YEAR }, "the boot file change to the river's year"], ['lightsroute', { route: 'router' }, 'the lighting port change to the spare router port'],
    ['switch', { file: LIVE }, 'the switch to the live river'], ['rebuild', { file: YEAR }, "the rebuild of the river's year"],
    ['calibrate', { action: 'start' }, 'the start of a calibration'], ['calibrate', { action: 'start', dry_run: true }, 'the start of a dry run'],
  ];
  for (const [action, body, want] of cases) {
    assert.equal(changeLabel(action, body), want, action);
    assert.equal(applyLabel(action, body), want, `the server's entry: ${action}`);
  }
  assert.equal(changeLabel('switch', { file: YEAR }, { running: YEAR }), "the restart on the river's year");
  // Last done: the same name, one form ("The ropes change to dark"), for every action
  assert.equal(lastDoneWhat({ action: 'ropes', body: { dark: true } }), 'The ropes change to dark');
  assert.equal(lastDoneWhat({ action: 'switch', body: { file: YEAR }, label: "the restart on the river's year" }), "The restart on the river's year");
  assert.equal(lastDoneWhat({ action: 'calibrate', body: { action: 'cancel' } }), 'The stop of the calibration');
  assert.equal(lastDoneWhat({ action: 'calibrate', body: { action: 'start', dry_run: true } }), 'The start of a dry run');
  assert.equal(lastDoneWhat({ action: 'check', body: {} }), 'The full check of bitcube');
  // Recent: a stop is a stop, a dry run is a dry run
  assert.equal(describeEvent({ kind: 'action', action: 'calibrate', body: { action: 'cancel' }, ok: true, source: 'studio chat' }), 'Stopped the calibration from the studio chat');
  assert.equal(describeEvent({ kind: 'action', action: 'calibrate', body: { action: 'start', dry_run: true }, ok: true, source: 'mission control' }), 'Started a dry run from mission control');
});

test('R7 #20: a dry run touches no lights, so it locks nothing on them, on the pages and on the server', async () => {
  const { derive } = await import('../public/model.js');
  const { calBlocked } = await import('../lib/mission.mjs');
  const { Applying } = await import('../lib/applying.mjs');
  const t = 1_792_749_540_000;
  const run = (mode) => ({ running: true, stage: 'ropes-capture', mode, dry_run: mode === 'dry-run', started: t / 1000 - 10, updated: t / 1000, elapsed_s: 10, expected_s: 170, read_age_s: 0 });
  const dry = derive(payload({ t, calibration: run('dry-run') }), t);
  for (const a of ['ropes', 'hub75', 'switch', 'lightsroute', 'rebuild']) assert.equal(dry.controls[a].why, null, a);
  assert.equal(dry.controls.calibrate.why, 'a dry run is already running');
  for (const a of ['ropes', 'hub75', 'switch', 'lightsroute', 'rebuild']) assert.equal(calBlocked(a, run('dry-run')), null, a);
  // a full run: one sentence per thought
  const full = derive(payload({ t, calibration: run('full') }), t);
  assert.equal(full.controls.ropes.why, 'a calibration is running. Stop it on the Lights page first');
  assert.equal(calBlocked('ropes', run('full')).message, 'a calibration is running. Stop it on the Lights page first');
  // a dry run's start is no lock on the lights either (its entry blocks only a second start), and nothing waits for it
  let now = t;
  const a = new Applying({ now: () => now });
  let release; const gate = new Promise((r) => { release = r; });
  const start = a.run('calibrate', { action: 'start', dry_run: true }, () => gate);
  const e = a.list()[0];
  assert.deepEqual([e.label, e.blocks, e.dry], ['the start of a dry run', ['calibrate'], true]);
  for (const x of ['ropes', 'switch', 'rebuild', 'bootfile', 'lightsroute']) assert.equal(a.conflict(x), null, x);
  assert.notEqual(a.conflict('calibrate'), null);
  const m = derive({ ...payload({ t }), applying: a.list(t) }, t);
  for (const x of ['ropes', 'switch', 'bootfile']) assert.equal(m.controls[x].why, null, x);
  release({ ok: true, started: true }); await start;
});

test('R7 #21: a refusal for another change in flight is in the past tense, in the same words as a withdrawn confirm', async () => {
  const { failWords, notSentWords } = await import('../public/model.js');
  assert.equal(failWords('The panels are unchanged', "wait: the switch to the river's year is being applied (started 02:58)", '03:00'),
    "The panels are unchanged: the switch to the river's year was being applied (started 02:58). Press again when it is done.");
  assert.equal(notSentWords("wait: the switch to the river's year is being applied", '22:47'),
    "Not sent at 22:47: the switch to the river's year was being applied. Press again when it is done.");
});

test('R7 #12, #13: the hidden band region says the headline without its times, and each change in flight from elsewhere by name and source', async () => {
  const { derive, bandSaid, entrySaid } = await import('../public/model.js');
  const t = 1_792_749_540_000;
  const cal = { running: true, stage: 'ropes-capture', mode: 'full', started: t / 1000 - 10, updated: t / 1000, elapsed_s: 10, expected_s: 170, read_age_s: 0 };
  const m = derive(payload({ t, calibration: cal }), t);
  assert.equal(bandSaid(m), 'Attention. Calibrating the lights: the ropes are in patterns.');
  const boot = { id: 'a.9', action: 'bootfile', label: "the boot file change to the river's year", phase: 'applying', source: 'studio chat', started_at: t - 4000, expect_s: 15, blocks: ['bootfile'] };
  const m2 = derive({ ...payload({ t }), applying: [boot] }, t);
  assert.equal(entrySaid(m2.show.applying[0]), "Applying: the boot file change to the river's year, from the studio chat.");
  const head = `${{ ok: 'OK', warning: 'Attention', unknown: 'Unknown', down: 'Down' }[m2.overall.level]}. ${m2.overall.headline}.`;
  assert.equal(bandSaid(m2), `${head} Applying: the boot file change to the river's year, from the studio chat.`);
  // this phone's own change is said on its control only
  assert.equal(bandSaid(m2, { ownIds: ['a.9'] }), head);
  assert.equal(entrySaid({ ...m2.show.applying[0], phase: 'confirming', source: 'mission control' }), "Waiting for bitcube to show the boot file change to the river's year.");
  assert.equal(entrySaid({ ...m2.show.applying[0], maybe: true }), "No answer in time for the boot file change to the river's year, from the studio chat: waiting for bitcube to show whether it happened.");
});
