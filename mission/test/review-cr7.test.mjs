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
  assert.deepEqual(ps, { CRED_URL: PATTERNS.CREDS, CRED_QUOTED: PATTERNS.QUOTED, CRED_ESCAPED: PATTERNS.ESCAPED, CRED_BARE_JSON: PATTERNS.BARE_JSON, CRED_BARE: PATTERNS.BARE });
  const fn = src.slice(src.indexOf('function Mask-Creds'), src.indexOf('\n}\n', src.indexOf('function Mask-Creds')));
  assert.deepEqual([...fn.matchAll(/-replace \$(CRED_\w+), '([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`),
    ['CRED_URL $1***@', 'CRED_QUOTED $1$2***$4', 'CRED_ESCAPED $1$2***$5', 'CRED_BARE_JSON $1$2***$2', 'CRED_BARE $1***']);
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
    assert.match(dryWhy(m), /^wait: the start of a (calibration|dry run) is being applied$/, JSON.stringify(first));
    release({ ok: true, calibration: { running: true } }); await p;
  }
});
