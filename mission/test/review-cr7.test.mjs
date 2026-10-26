// Code review 7 (af75ab1..dd38ad2): the scrubber's objects, escapes and bare values; the server's verdict when a page can't
// know it; dry and decode-only starts; the history's restart mark and feed; the step lines' bridge changes and redirections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrubCreds, PATTERNS } from '../lib/scrub.mjs';

const FAKE = 'NOT-A-REAL-TOKEN-a1b2c3';

test('CR7 #1: a password-like key whose value is an object or an array has the whole value masked, and JSON stays JSON', () => {
  // the camera's login reply: the token sits one level down, under "Token"
  const reply = `[{"cmd":"Login","code":0,"value":{"Token":{"leaseTime":3600,"name":"${FAKE}"}}}]`;
  const got = scrubCreds(reply);
  assert.doesNotMatch(got, /a1b2c3/);
  assert.deepEqual(JSON.parse(got), [{ cmd: 'Login', code: 0, value: { Token: '***' } }]);
  // nested deeper, arrays, a closing bracket inside a string value
  for (const [raw, want] of [
    ['{"token":{"a":{"b":[1,{"c":"x}y"}]}},"ok":1}', { token: '***', ok: 1 }],
    ['{"secret":["s1","s2"],"n":2}', { secret: '***', n: 2 }],
    ['{"password":{}}', { password: '***' }],
  ]) {
    const s = scrubCreds(raw);
    assert.deepEqual(JSON.parse(s), want, raw);
  }
  // a bare number in JSON text becomes the string "***" (valid JSON); null, true and false stay
  assert.deepEqual(JSON.parse(scrubCreds('{"token": 123, "secret": null, "pwd": true, "passwd": false}')),
    { token: '***', secret: null, pwd: true, passwd: false });
  // the same inside an escaped JSON body (a JSON string in a JSON string, or a quoted command)
  const esc = JSON.stringify(JSON.stringify({ value: { Token: { leaseTime: 3600, name: FAKE } }, token: 99 }));
  const e = scrubCreds(esc);
  assert.doesNotMatch(e, /a1b2c3|99/);
  assert.deepEqual(JSON.parse(JSON.parse(e)), { value: { Token: '***' }, token: '***' });
  // a Python dict's repr keeps its own quotes
  assert.equal(scrubCreds("{'token': 123, 'secret': {'a': 1}}"), "{'token': '***', 'secret': '***'}");
  // outside JSON (a query, a form, "key: value") a bare value is still just ***
  assert.equal(scrubCreds('token=abc123&x=1 secret: s3cr3t; password={abc}'), 'token=***&x=1 secret: ***; password=***');
  // an object cut off before it closes (a line cut short) is masked to the end of its line, never left readable
  assert.equal(scrubCreds(`{"Token":{"leaseTime":3600,"name":"${FAKE}\nnext line`), '{"Token":"***"\nnext line');
});

test('CR7 #2: in an object, every value under an exact password-like key is masked, deep; other keys are left alone', () => {
  const input = { password: 'hunter2', nested: { token: 't', Token: { name: FAKE }, list: [{ secret: 42 }, { pwd: ['x'] }] }, passwd: 'p',
                  input_tokens: 1234, passwords: 'the file', tokens: 3, secret_ref: 'ok', note: 'fine', none: { token: null, secret: false } };
  const before = JSON.stringify(input);
  assert.deepEqual(scrubCreds(input), { password: '***', nested: { token: '***', Token: '***', list: [{ secret: '***' }, { pwd: '***' }] }, passwd: '***',
                                        input_tokens: 1234, passwords: 'the file', tokens: 3, secret_ref: 'ok', note: 'fine', none: { token: null, secret: false } });
  assert.equal(JSON.stringify(input), before, 'the input is left alone (a copy)');
});

test('CR7 #3: a quoted value is masked to its own closing quote, past an escaped quote inside it, and a trailing escaped backslash keeps the JSON whole', () => {
  // "ab\"cd": the escaped quote is part of the value
  const a = JSON.stringify({ password: 'ab"cd', user: 'admin' });
  assert.equal(scrubCreds(a), '{"password":"***","user":"admin"}');
  // a value ending in an escaped backslash: "ab\\" ends at the quote after it
  const b = JSON.stringify({ password: 'ab\\', user: 'admin' });
  assert.deepEqual(JSON.parse(scrubCreds(b)), { password: '***', user: 'admin' });
  // single quotes the same way
  assert.equal(scrubCreds("{'passwd': 'it\\'s me', 'user': 'admin'}"), "{'passwd': '***', 'user': 'admin'}");
  // the escaped-delimiter case still works (a body inside a quoted command), and an escaped quote inside it too
  assert.equal(scrubCreds('body \'{\\"password\\":\\"p@ss w\\"}\''), 'body \'{\\"password\\":\\"***\\"}\'');
  const inner = JSON.stringify(JSON.stringify({ password: 'ab"cd\\', user: 'admin' }));
  const s = scrubCreds(inner);
  assert.doesNotMatch(s, /cd/);
  assert.deepEqual(JSON.parse(JSON.parse(s)), { password: '***', user: 'admin' });
  // a quote opened and never closed (a line cut short): masked to the end
  assert.equal(scrubCreds('{"password":"hunter2'), '{"password":"***');
  assert.equal(scrubCreds('{"password":"hunter2\\'), '{"password":"***', 'cut inside an escape');
  assert.equal(scrubCreds('{\\"password\\":\\"hunter2\\\\'), '{\\"password\\":\\"***', 'an escaped body cut inside an escape');
  // never a long wait on a hostile line (no catastrophic backtracking)
  const t0 = Date.now();
  scrubCreds(`"token":{${'"a":"\\\\\\"'.repeat(3000)}`);
  scrubCreds(`password:\\"${'\\\\\\'.repeat(5000)}x`);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

test('CR7 #1: probe.ps1 Mask-Creds masks with the very patterns scrubCreds uses, in the same order (tools/tests/test_masks.py runs them)', () => {
  const src = readFileSync(new URL('../../tools/mission/probe.ps1', import.meta.url), 'utf8');
  const ps = Object.fromEntries([...src.matchAll(/^\$(CRED_\w+) = '((?:[^']|'')*)'$/gm)].map((m) => [m[1], m[2].replace(/''/g, "'")]));
  assert.deepEqual(ps, { CRED_URL: PATTERNS.CREDS, CRED_QUOTED: PATTERNS.QUOTED, CRED_ESCAPED: PATTERNS.ESCAPED, CRED_BARE_JSON: PATTERNS.BARE_JSON, CRED_BARE: PATTERNS.BARE,
                         CRED_AUTH: PATTERNS.AUTH, CRED_BEARER: PATTERNS.BEARER, CRED_USER: PATTERNS.USER, CRED_FLAG: PATTERNS.FLAG, CRED_SSHPASS: PATTERNS.SSHPASS,   // R8 #38
                         CRED_MYSQL: PATTERNS.MYSQL, CRED_UCI: PATTERNS.UCI, CRED_KEY_JSON: PATTERNS.KEYJSON, CRED_SKANT: PATTERNS.SKANT });   // R9 #37
  const fn = src.slice(src.indexOf('function Mask-Creds'), src.indexOf('\n}\n', src.indexOf('function Mask-Creds')));
  assert.deepEqual([...fn.matchAll(/-replace \$(CRED_\w+), '([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`),
    ['CRED_URL $1***@', 'CRED_QUOTED $1$2***$4', 'CRED_ESCAPED $1$2***$5', 'CRED_BARE_JSON $1$2***$2', 'CRED_BARE $1***',
     'CRED_AUTH $1***', 'CRED_BEARER $1***', 'CRED_USER $1***', 'CRED_FLAG $1***', 'CRED_SSHPASS $1***',
     'CRED_MYSQL $1***', 'CRED_UCI $1***', 'CRED_KEY_JSON $1***', 'CRED_SKANT $1***']);
});

// ---- dry and decode-only starts --------------------------------------------------------------------------------------
const T0 = 1_792_749_540_000;
const all = JSON.parse(readFileSync(new URL('./fixtures/all-good.json', import.meta.url), 'utf8'));
const statusAt = (t, extra = {}) => ({ ...JSON.parse(JSON.stringify(all.status)), now: all._scenario.now, ...extra });
const DECODE = { action: 'start', decode_only: 'pixelmap-20261018-154155' };
const DRY = { action: 'start', dry_run: true };

test('CR7 #6: a decode of earlier photos starts as a dry run does: it locks only a second start, and nothing waits for it', async () => {
  const { Applying } = await import('../lib/applying.mjs');
  const a = new Applying({ now: () => T0 });
  let release; const gate = new Promise((r) => { release = r; });
  const start = a.run('calibrate', DECODE, () => gate);
  const e = a.list()[0];
  assert.deepEqual([e.blocks, e.dry], [['calibrate'], true]);
  for (const x of ['ropes', 'hub75', 'switch', 'rebuild', 'bootfile', 'lightsroute']) assert.equal(a.conflict(x), null, x);
  assert.notEqual(a.conflict('calibrate', { action: 'start' }), null, 'a second start waits');
  release({ ok: true, started: true }); await start;
});

test('CR7 #7: a dry or decode-only start waits only for another calibration start, on the server and on the pages', async () => {
  const { Applying } = await import('../lib/applying.mjs');
  const { derive } = await import('../public/model.js');
  const { dryWhy, startWhy } = await import('../public/lights-words.js');
  for (const busy of [['ropes', { dark: true }], ['hub75', { brightness: 0.5 }], ['lightsroute', { route: 'router' }], ['switch', { file: 'river-online-oct-23.toe' }],
                      ['rebuild', { file: 'river-local-oct-22-seasons.toe' }], ['bootfile', { file: 'river-online-oct-23.toe' }]]) {
    const a = new Applying({ now: () => T0 });
    let release; const gate = new Promise((r) => { release = r; });
    const p = a.run(busy[0], busy[1], () => gate);
    // the server: a full start waits for it; a dry run or a decode doesn't, and runs
    assert.notEqual(a.conflict('calibrate', { action: 'start' }), null, busy[0]);
    for (const b of [DRY, DECODE]) {
      assert.equal(a.conflict('calibrate', b), null, `${busy[0]} / ${JSON.stringify(b)}`);
      const r = await a.run('calibrate', b, async () => ({ ok: true, calibration: { running: true } }));
      assert.equal(r.ok, true, busy[0]);
    }
    // the pages: Start says wait, Dry run doesn't
    const m = derive(statusAt(T0, { applying: a.list(all._scenario.now) }), all._scenario.now + 1000);
    assert.match(startWhy(m), /^wait: /, busy[0]);
    assert.equal(dryWhy(m), null, busy[0]);
    assert.equal(m.controls.calibrate.dry.why, null, busy[0]);
    release({ ok: true }); await p;
  }
  // another calibration start in flight (a full one or a dry one): a dry run waits for it, on both
  for (const first of [{ action: 'start' }, DRY, DECODE]) {
    const a = new Applying({ now: () => T0 });
    let release; const gate = new Promise((r) => { release = r; });
    const p = a.run('calibrate', first, () => gate);
    for (const b of [DRY, DECODE]) assert.notEqual(a.conflict('calibrate', b), null, JSON.stringify(first));
    await assert.rejects(a.run('calibrate', DRY, async () => ({ ok: true })), (e) => e.status === 409);
    const m = derive(statusAt(T0, { applying: a.list(all._scenario.now) }), all._scenario.now + 1000);
    assert.match(dryWhy(m), /^wait: the (calibration|dry run) start is being applied$/, JSON.stringify(first));
    release({ ok: true, calibration: { running: true } }); await p;
  }
});

// ---- the history ---------------------------------------------------------------------------------------------------------
const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
function payload({ t, td, applying = [], probeAt = t, online = true } = {}) {
  return { now: t, bitcube: { ok: true, at: t, value: { online } }, seasons: { ok: true, at: t, value: { season: 'winter', mode: 'automatic', intensity: 0.2, presence: { available: false } } },
    modal: { ok: true, at: t, value: { ok: true, tick: 1, next_tick_epoch: t / 1000 + 200, finished_at: new Date(t - 60_000).toISOString() } },
    probe: { ok: true, at: probeAt, value: { ok: true, uptime_h: 30, time: '2026-10-25T02:59:00', boot_file: YEAR, show_files: [YEAR, LIVE], displays: ['M14', 'LED 1920X1080'],
      devices: { psac10_1: true, psac10_2: true, gallery_cam: true, river_cam: true, router: true, internet: true },
      td: td ?? { ok: true, file: YEAR, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } } } },
    applying };
}
const SWITCH = (t) => [{ id: 'a.1', action: 'switch', label: "the switch to the river's year", file: YEAR, phase: 'confirming', started_at: t - 3000, answered_at: t - 1000, expect_s: 60, blocks: ['ropes', 'hub75', 'switch'] }];
const SLOW = { ok: true, file: YEAR, fps: 4, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } };
/** Slow for 10 min, then a restart seen twice; returns the history and the clock. */
async function restarted() {
  const { History } = await import('../lib/history.mjs');
  const c = { t: T0 };
  const h = new History({ file: null, now: () => c.t });
  h.observe(payload({ t: c.t, td: SLOW })); c.t += 10 * 60_000; h.observe(payload({ t: c.t, td: SLOW })); c.t += 5000;
  for (const td of [{ ok: false, error: 'not running' }, { ok: false, error: 'not answering' }]) { h.observe(payload({ t: c.t, td, applying: SWITCH(c.t) })); c.t += 5000; }
  return { h, c };
}

test('CR7 #8: the restart mark is used up only by a fresh sighting: a stale one in between leaves it for the next', async () => {
  const { feed } = await import('../lib/history.mjs');
  const { h, c } = await restarted();
  // the full check goes quiet once right after the restart: TouchDesigner is read from its last answer (stale), not seen
  h.observe(payload({ t: c.t, td: SLOW, probeAt: c.t - 200_000 })); c.t += 5000;
  const n = h.events.length;
  h.observe(payload({ t: c.t, td: SLOW })); c.t += 60_000;
  assert.equal(h.since('touchdesigner', c.t).for_s, 60, 'slow again since the first fresh sighting after the restart');
  assert.equal(h.since('touchdesigner', c.t).at_least, false);
  assert.ok(feed(h.events.slice(n)).some((e) => /^TouchDesigner still needs attention: running slowly/.test(e.words)));
});

test('CR7 #8: the restart mark lapses after about 10 min; a piece unseen that long is a first sighting again, never "for 1 min"', async () => {
  const { RESTART_MARK_MS } = await import('../lib/history.mjs');
  assert.ok(RESTART_MARK_MS >= 9 * 60_000 && RESTART_MARK_MS <= 11 * 60_000, String(RESTART_MARK_MS));
  const { h, c } = await restarted();
  // bitcube goes offline for 11 min right after the restart: nothing behind it is seen
  for (let i = 0; i < 12; i++) { h.observe(payload({ t: c.t, td: SLOW, online: false })); c.t += 60_000; }
  h.observe(payload({ t: c.t, td: SLOW })); c.t += 60_000;
  const s = h.since('touchdesigner', c.t);
  assert.deepEqual([s.for_s, s.at_least], [60, true], 'seen again after a long blind stretch: "for over 1 min"');
  assert.equal(h.restarted.size, 0, 'no mark is kept past its time');
});

test('CR7 #14: the feed drops a line said twice at one moment with a set, keeping the first, and stays fast on many events', async () => {
  const { feed } = await import('../lib/history.mjs');
  const ev = (t, kind = 'show', to = 'dark') => ({ kind, t, field: 'ropes', from: 'river', to });
  const out = feed([ev(1), ev(1), ev(2), { ...ev(1), extra: 1 }, ev(1, 'show', 'river')]);
  assert.deepEqual(out.map((e) => [e.t, e.words, e.extra]), [[1, 'The ropes went dark on purpose', undefined], [2, 'The ropes went dark on purpose', undefined], [1, 'The ropes show the river again', undefined]]);
  const many = Array.from({ length: 50_000 }, (_, i) => ev(i));
  const t0 = performance.now();
  assert.equal(feed(many).length, 50_000);
  assert.ok(performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)} ms`);
});

// ---- the chat's step lines -----------------------------------------------------------------------------------------------
test('CR7 #9: a bridge call that changes a parameter by .expr, .mode, .bindExpr or setattr( is an acting line too', async () => {
  const { describeTool } = await import('../lib/steps.mjs');
  const bash = (command, description = '') => describeTool({ name: 'Bash', input: { description, command } });
  const td = (py) => `ssh bitcube powershell -File C:\\x\\tools\\td.ps1 "${py}"`;
  for (const py of ["op('/project1/ropes').par.Source.expr = 'black'", "op('/project1/ropes').par.Source.mode=ParMode.CONSTANT",
                    "op('/project1/ropes').par.Source.bindExpr = ''", "p = op('/project1/ropes').par.Source; p.expr = 'x'",
                    "for p in op('/project1/ropes').pars('Source'): p.bindExpr = ''", "setattr(op('/project1/ropes').par, 'Source', 'black')",
                    "op('/project1/ropes').par.Source.val='black'"]) {
    const s = bash(td(py), 'Check the ropes');
    assert.deepEqual([s.text, s.acting], ['changed the ropes', true], py);
  }
  // reads stay reads: a comparison, an eval, getattr
  for (const py of ["print(op('/project1/ropes').par.Source.expr)", "op('/project1/ropes').par.Source.mode == ParMode.EXPRESSION",
                    "getattr(op('/project1/ropes').par, 'Source').eval()", "op('/project1/ropes').par.Source.expr != ''"]) {
    const s = bash(td(py), 'Check the ropes');
    assert.deepEqual([s.text, s.acting], ['checked the ropes', false], py);
  }
});

test('CR7 #15: 2>&1, >&2 and &> are redirections, not command separators', async () => {
  const { describeTool, commandParts } = await import('../lib/steps.mjs');
  assert.deepEqual(commandParts('a 2>&1 | b'), ['a 2>&1', 'b']);
  assert.deepEqual(commandParts('a &> f; b &>> g'), ['a &> f', 'b &>> g']);
  assert.deepEqual(commandParts('a >&2 && b & c || d'), ['a >&2', 'b', 'c', 'd']);
  assert.deepEqual(commandParts('a 1>&2 2>&1 |& b'), ['a 1>&2 2>&1', 'b']);
  assert.deepEqual(commandParts(`x '{"a":"b & c"}' && y "2>&1; z"`), [`x '{"a":"b & c"}'`, 'y "2>&1; z"']);
  const bash = (command, description = '') => describeTool({ name: 'Bash', input: { description, command } });
  // a status read through mission control with its errors redirected stays one look, never a change "around" mission control
  for (const cmd of ['node mission/bin/mc.mjs status 2>&1 | head -20', 'node mission/bin/mc.mjs status &> /tmp/x.json', 'node mission/bin/mc.mjs status >&2']) {
    assert.deepEqual([bash(cmd, 'Look').text, bash(cmd, 'Look').acting], ['looked at what mission control shows', false], cmd);
  }
  // a change asked of mission control with its output redirected is that change, through mission control
  const s = bash(`node mission/bin/mc.mjs ropes '{"dark":true}' 2>&1`, 'Ropes dark');
  assert.deepEqual([s.text, s.acting], ['asked mission control for the change of the ropes to dark', true]);
  // a real & still separates: a look chained to a change made directly on bitcube says so
  const d = bash('node mission/bin/mc.mjs status 2>&1 & ssh bitcube "powershell -File C:\\x\\probe.ps1 -Action ropes -Dark" 2>&1', 'Look');
  assert.match(d.text, /^changed the ropes on bitcube directly, not through mission control$/);
});

// ---- Last done: the server's verdict, kept with the history --------------------------------------------------------------
test('CR7 #5: the server\'s verdict on the last action is kept with the history (persisted) and served on last_action', async () => {
  const { History } = await import('../lib/history.mjs');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'cr7-history-')), 'history.jsonl');
  let t = T0;
  const h = new History({ file, now: () => t });
  h.action({ action: 'switch', body: { file: LIVE }, ok: true, source: 'mission control', label: 'the switch to the live river', applying_id: 'ax.1' });
  t += 5000;
  h.observe(payload({ t, applying: [{ id: 'ax.1', action: 'switch', label: 'the switch to the live river', file: LIVE, phase: 'confirming', started_at: t - 6000, expect_s: 60, blocks: ['switch'] }] }));
  assert.equal(h.summary(t).last_action.verdict, undefined, 'still being confirmed: no verdict yet');
  t += 30_000;
  h.observe({ ...payload({ t }), confirmed: [{ id: 'ax.1', action: 'switch', file: LIVE, started_at: t - 40_000, at: t - 2000 }] });
  assert.equal(h.summary(t).last_action.verdict, 'confirmed');
  h.observe({ ...payload({ t: t + 5000 }), confirmed: [{ id: 'ax.1', action: 'switch', file: LIVE, started_at: t - 40_000, at: t - 2000 }] });
  assert.equal(h.events.filter((e) => e.kind === 'verdict').length, 1, 'recorded once');
  // a restart of the server (and long after the 10 min the status keeps it): still known
  t += 3 * 24 * 3600e3;
  const again = new History({ file, now: () => t });
  assert.equal(again.summary(t).last_action.verdict, 'confirmed');
  assert.equal(again.summary(t).last_action.applying_id, 'ax.1');
  // in Recent a verdict is a line of its own, in words, at its own time (R9 #20); the raw bookkeeping event never is
  assert.deepEqual(again.recent({ limit: 50, sinceT: 0 }).filter((e) => e.kind === 'verdict').map((e) => [e.label, e.verdict]), [['the switch to the live river', 'confirmed']]);
  // expired the same way; a quick change confirmed before its line was written is caught by the next look
  again.action({ action: 'bootfile', body: { file: YEAR }, ok: true, source: 'studio chat', applying_id: 'ax.2' });
  again.observe({ ...payload({ t }), expired: [{ id: 'ax.2', action: 'bootfile', file: YEAR, started_at: t - 200_000, at: t - 1000 }] });
  assert.equal(again.summary(t).last_action.verdict, 'expired');
  again.action({ action: 'ropes', body: { dark: true }, ok: true, source: 'mission control', applying_id: 'ax.3' });
  again.observe({ ...payload({ t }), confirmed: [{ id: 'ax.3', action: 'ropes', started_at: t - 2000, at: t - 1000 }] });
  assert.equal(again.summary(t).last_action.verdict, 'confirmed');
});

test('CR7 #5: Last done uses the kept verdict; with none known, a switch, rebuild, boot-file change or calibration start says "Last sent"', async () => {
  const { lastDoneParts } = await import('../public/status-words.js');
  const none = { applying: [], confirmed: [], expired: [] };
  const sw = { action: 'switch', body: { file: LIVE }, ok: true, applying_id: 'ax.1' };
  assert.deepEqual(lastDoneParts({ ...sw, verdict: 'confirmed' }, none), { head: 'Last done', tail: '' });
  assert.deepEqual(lastDoneParts({ ...sw, verdict: 'expired' }, none), { head: 'Last sent', tail: " · bitcube didn't show it in time" });
  // the status's own lists still come first (the verdict reaches the history within a few seconds)
  assert.deepEqual(lastDoneParts(sw, { ...none, confirmed: [{ id: 'ax.1' }] }), { head: 'Last done', tail: '' });
  // no verdict known (aged out of the status, a server restart before it was kept, an older history line): never "done"
  for (const a of [sw, { ...sw, applying_id: undefined }, { action: 'rebuild', body: { file: YEAR }, ok: true, applying_id: 'ax.4' },
                   { action: 'bootfile', body: { file: YEAR }, ok: true, applying_id: 'ax.5' }, { action: 'calibrate', body: { action: 'start' }, ok: true, applying_id: 'ax.6' },
                   { action: 'calibrate', body: { action: 'start', dry_run: true }, ok: true, applying_id: 'ax.7' }]) {
    assert.equal(lastDoneParts(a, none).head, 'Last sent', JSON.stringify(a));
  }
  // a change whose own answer was the change is done; a stop is done; a failure is tried
  assert.equal(lastDoneParts({ action: 'ropes', body: { dark: true }, ok: true, applying_id: 'ax.8' }, none).head, 'Last done');
  assert.equal(lastDoneParts({ action: 'calibrate', body: { action: 'cancel' }, ok: true }, none).head, 'Last done');
  assert.equal(lastDoneParts({ action: 'check', body: {}, ok: true }, none).head, 'Last done');
  assert.equal(lastDoneParts({ ...sw, ok: false, applying_id: undefined, note: 'bitcube did not answer' }, none).head, 'Last tried');
});

// ---- a page's own change when the server's verdict can't be known -------------------------------------------------------
test('CR7 #4: with no verdict to go on, a switch to another file or a boot-file change ends done once a reading taken after the send shows it', async () => {
  const { derive, serverJudged } = await import('../public/model.js');
  const sent = T0 - 30_000;
  const onLive = { ok: true, file: LIVE, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } };
  const reading = (td, { probeAt = T0 - 5000, boot = YEAR, ...extra } = {}) => {
    const p = payload({ t: T0, td, probeAt });
    p.probe.value.boot_file = boot;
    return derive({ ...p, ...extra }, T0);
  };
  const sw = { action: 'switch', file: LIVE, before: YEAR, sentAt: sent };
  // no id (the answer was lost), or an id no list names (aged out after 10 min, the server restarted): the reading decides
  for (const id of [null, 'ax.gone']) {
    assert.equal(serverJudged(reading(onLive), id, sw), 'confirmed', String(id));
    assert.equal(serverJudged(reading(null), id, sw), null, 'TouchDesigner still on the old file');
    assert.equal(serverJudged(reading(onLive, { probeAt: sent - 1000 }), id, sw), null, 'a reading from before the send says nothing');
    assert.equal(serverJudged(reading({ ok: false, error: 'not running' }), id, sw), null, 'not answering yet');
  }
  // a restart (the same file) or a rebuild: no reading can tell, so it stays as it is
  assert.equal(serverJudged(reading(null), null, { action: 'switch', file: YEAR, before: YEAR, sentAt: sent }), null);
  assert.equal(serverJudged(reading(null), null, { action: 'rebuild', file: YEAR, before: YEAR, sentAt: sent }), null);
  assert.equal(serverJudged(reading(onLive), null, { action: 'switch', file: LIVE, before: LIVE, sentAt: sent }), null);
  // a boot-file change to another boot file: from boot_file, the same way
  const bf = { action: 'bootfile', file: LIVE, before: YEAR, sentAt: sent };
  assert.equal(serverJudged(reading(null, { boot: LIVE }), null, bf), 'confirmed');
  assert.equal(serverJudged(reading(null, { boot: YEAR }), null, bf), null);
  assert.equal(serverJudged(reading(null, { boot: LIVE, probeAt: sent - 1 }), null, bf), null);
  assert.equal(serverJudged(reading(null, { boot: LIVE }), null, { ...bf, before: LIVE }), null, 'the same boot file: nothing to tell');
  // the server's own verdict always comes first: pending waits, expired is expired, even when the reading shows the file
  const listed = (k) => ({ [k]: [{ id: 'ax.1', action: 'switch', label: 'the switch to the live river', file: LIVE, phase: 'confirming', started_at: sent, at: T0 - 1000, expect_s: 60, blocks: ['switch'] }] });
  assert.equal(serverJudged(reading(onLive, listed('applying')), 'ax.1', sw), 'pending');
  assert.equal(serverJudged(reading(onLive, listed('expired')), 'ax.1', sw), 'expired');
  assert.equal(serverJudged(reading(null, listed('confirmed')), 'ax.1', sw), 'confirmed');
  // without a fallback (Lights' rebuild and start), only the verdict
  assert.equal(serverJudged(reading(onLive), null, null), null);
  // the model carries each source's reading time on the server's clock
  assert.equal(reading(onLive).sources.probe.at, T0 - 5000);
});

test('CR7 #4: Status and ui.js control() judge their own change by serverJudged, with what was sent (a switch, a boot-file change)', () => {
  const st = readFileSync(new URL('../public/status.js', import.meta.url), 'utf8'), ui = readFileSync(new URL('../public/ui.js', import.meta.url), 'utf8');
  // both through model.js ownVerdict (CR8 #10), which judges by serverJudged with what was sent
  assert.match(st, /ownVerdict\(model, \{ state: c\.s\.state, entryId: c\.entryId, requestId: c\.requestId, sent: c\.sent,/);
  assert.match(readFileSync(new URL('../public/model.js', import.meta.url), 'utf8'), /const v = serverJudged\(m, entryId, c\?\.sent \?\? null\)/);
  assert.match(st, /sent: \(mm\) => \(\{ action: 'switch', file: f, before: mm\?\.show\.file\?\.name \?\? null \}\)/);
  assert.match(st, /sent: \(mm\) => \(\{ action: 'bootfile', file: f, before: mm\?\.show\.boot_file\?\.name \?\? null \}\)/);
  assert.match(st, /sentAt: serverClock\(\)/, 'the send on the server\'s clock (ui.js, CR8 #13)');
  assert.match(ui, /ownVerdict\(n\.model, \{ state: s\.state, entryId, requestId, sent,/);
  assert.doesNotMatch(st + ui, /entryVerdict\(/, 'never the verdict alone');
});

test('CR7 #10: this phone\'s own change still in status.applying is its own while its control has no id: applying, confirming, or unconfirmed (an entry begun before it gave up)', async () => {
  const { derive, ownEntries, bandSaid } = await import('../public/model.js');
  const now = T0;
  const entry = (id, action, startedAgoS, label) => ({ id, action, label, phase: 'confirming', source: 'mission control', started_at: all._scenario.now - startedAgoS * 1000, expect_s: 60, blocks: [action] });
  const m = derive(statusAt(T0, { applying: [entry('ax.1', 'switch', 70, 'the switch to the live river'), entry('ax.2', 'ropes', 5, 'the change of the ropes to dark')] }), all._scenario.now);
  // the switch timed out on this phone 10 s ago (no answer: no id) and the server still holds its entry: this phone's own
  const own = ownEntries(m, [{ action: 'switch', state: 'unconfirmed', entryId: null, at: now - 10_000 }], now);
  assert.deepEqual(own, { ownIds: ['ax.1'], ownActions: [] });
  assert.doesNotMatch(bandSaid(m, own), /switch to the live river/);
  assert.match(bandSaid(m, own), /change of the ropes to dark/, 'another phone\'s change is still said');
  // an entry begun after this phone gave up is another phone's change of the same thing
  assert.deepEqual(ownEntries(m, [{ action: 'ropes', state: 'unconfirmed', entryId: null, at: now - 60_000 }], now), { ownIds: [], ownActions: [] });
  // applying or confirming without an id: by its action, as before
  for (const state of ['applying', 'confirming']) assert.deepEqual(ownEntries(m, [{ action: 'ropes', state, entryId: null, at: now - 60_000 }], now), { ownIds: [], ownActions: ['ropes'] }, state);
  // with an id: by its id, whatever its state; done or failed without one: not this phone's
  assert.deepEqual(ownEntries(m, [{ action: 'switch', state: 'done', entryId: 'ax.1', at: now }], now), { ownIds: ['ax.1'], ownActions: [] });
  for (const state of ['done', 'failed', 'ready']) assert.deepEqual(ownEntries(m, [{ action: 'switch', state, entryId: null, at: now - 1000 }], now), { ownIds: [], ownActions: [] }, state);
});

// ---- Lights' timed fetch ---------------------------------------------------------------------------------------------------
/** A fetch that answers its headers after headersMs, then its body in chunks (after each wait in chunkMs), and errors on abort. */
function slowFetch(headersMs, chunkMs, text = '{"ok":true}') {
  return (url, { signal } = {}) => new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort);
    setTimeout(() => {
      const parts = chunkMs.map((_, i) => text.slice(Math.floor((i * text.length) / chunkMs.length), Math.floor(((i + 1) * text.length) / chunkMs.length)));
      const body = new ReadableStream({ start(c) {
        signal?.addEventListener('abort', () => { try { c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); } catch { /* closed */ } });
        let t = 0;
        chunkMs.forEach((ms, i) => { t += ms; setTimeout(() => { try { c.enqueue(new TextEncoder().encode(parts[i])); if (i === chunkMs.length - 1) c.close(); } catch { /* errored */ } }, t); });
      } });
      resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    }, headersMs);
  });
}

test('CR7 #11: a timed fetch\'s limit is from the start unless it is the idle kind, which only silence ends', async (t) => {
  const { fetchTimed } = await import('../public/app.js');
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  // not idle: headers at 300 ms, the body 300 ms later: past a 400 ms limit, though no wait was over 400 ms
  globalThis.fetch = slowFetch(300, [300]);
  const t0 = Date.now();
  await assert.rejects(fetchTimed('/x', undefined, 400), (e) => e.noAnswer === true);
  assert.ok(Date.now() - t0 < 580, `${Date.now() - t0} ms: given up at its limit, never later`);
  // the same answer well inside the limit is read
  globalThis.fetch = slowFetch(50, [50]);
  assert.deepEqual((await fetchTimed('/x', undefined, 400)).body, { ok: true });
  // idle: a slow answer that keeps coming loads (each chunk tells the limit it is still coming) ...
  globalThis.fetch = slowFetch(250, [250, 250, 250]);
  assert.deepEqual((await fetchTimed('/x', undefined, 400, { idle: true })).body, { ok: true });
  // ... and silence past the limit ends it
  globalThis.fetch = slowFetch(250, [250, 700]);
  await assert.rejects(fetchTimed('/x', undefined, 400, { idle: true }), (e) => e.noAnswer === true);
});

// ---- gzip without blocking the server ----------------------------------------------------------------------------------------
test('CR7 #12: a static file is gzipped once per ETag, and a big answer off the event loop (the same content once)', async () => {
  const { Zipper, SMALL } = await import('../lib/zip.mjs');
  const { gunzipSync } = await import('node:zlib');
  const z = new Zipper();
  // a static file: once per key (its path and ETag); the second time from the cache, at once
  const file = Buffer.from('x'.repeat(5000));
  const a = await z.zip(file, '/model.js|W/"1-2"');
  const b = z.zip(file, '/model.js|W/"1-2"');
  assert.ok(Buffer.isBuffer(b) && b === a, 'the cached bytes, not a promise');
  assert.equal(gunzipSync(a).toString(), file.toString());
  assert.notEqual(await z.zip(Buffer.from('y'.repeat(5000)), '/model.js|W/"1-3"'), a, 'a new ETag is compressed again');
  // a small answer: at once (gzipSync of a few KB is well under a millisecond)
  assert.ok(Buffer.isBuffer(z.zip('{"a":1}'.repeat(100))));
  // a big answer (the LED map, 481 KB): a promise, compressed off the event loop ...
  const big = JSON.stringify({ points: Array.from({ length: 20_000 }, (_, i) => ({ rope: i % 20, px: i, u: Math.sin(i), v: Math.cos(i) })) });
  assert.ok(Buffer.byteLength(big) > SMALL);
  const p = z.zip(big);
  assert.ok(p instanceof Promise, 'never gzipSync on a big answer');
  const zb = await p;
  assert.equal(gunzipSync(zb).toString(), big);
  // ... and the same content again (the next phone asking for the map) from the cache, at once
  assert.equal(z.zip(String(big)), zb);
  // the caches stay small
  for (let i = 0; i < 300; i++) await z.zip(file, `/f${i}|e`);
  for (let i = 0; i < 10; i++) await z.zip(big + ' '.repeat(i));
  assert.ok(z.files.size <= 64 && z.bodies.length <= 4, `${z.files.size} ${z.bodies.length}`);
});

test('CR7 #12: the server gzips through the Zipper, never gzipSync in send()', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /gzipSync/);
  assert.match(src, /zipper\.zip\(/);
});

// ---- the chat's applying lines --------------------------------------------------------------------------------------------
test('CR7 #13: the chat derives the status once per answer; each second only the entries\' m:ss moves', async () => {
  const { derive, entriesAt } = await import('../public/model.js');
  const m = derive(statusAt(T0, { applying: [{ id: 'ax.1', action: 'switch', label: 'the switch to the live river', phase: 'confirming', started_at: all._scenario.now - 20_000, expect_s: 60, blocks: ['switch'] }] }), all._scenario.now);
  const list = m.show.applying;
  assert.equal(list[0].elapsed_s, 20);
  const later = entriesAt(list, all._scenario.now + 7400);
  assert.deepEqual([later[0].elapsed_s, later[0].label, later[0].phase], [27, 'the switch to the live river', 'confirming']);
  assert.equal(list[0].elapsed_s, 20, 'the derived list is left alone');
  assert.deepEqual(entriesAt([{ action: 'ropes', started_at: null, elapsed_s: 4 }], all._scenario.now).map((a) => a.elapsed_s), [4], 'no start: as derived');
  // chat.js: one derive() per answer (keyed on when it arrived), the tick only moves the times
  const src = readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');
  assert.equal(src.match(/\bderive\(/g)?.length, 1, 'one derive() call');
  const fn = src.slice(src.indexOf('function applyingNow()'), src.indexOf('function paintApplying('));
  assert.match(fn, /receivedAt/);
  assert.match(fn, /entriesAt\(/);
});
