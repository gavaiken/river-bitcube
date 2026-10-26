// The pages' request helper (public/app.js api) and the words for a failed request (plainError, noAnswerText), run in node
// with a fake fetch: a POST whose answer can't be read may or may not have happened (R5 #39); a 409 "wait: …" is shown as is.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, plainError, noAnswerText } from '../public/app.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const answer = (status, body, type = 'application/json') => { globalThis.fetch = async () => new Response(body, { status, headers: { 'content-type': type } }); };
const caught = async (p) => { try { await p; } catch (e) { return e; } assert.fail('expected a throw'); };

test('a POST answered with a 2xx that cannot be read may or may not have happened: never "unchanged" (R5 #39)', async () => {
  for (const [body, type] of [['<html>proxy</html>', 'text/html'], ['', 'text/plain'], ['null', 'application/json'], ['"ok"', 'application/json']]) {
    answer(200, body, type);
    const e = await caught(api('/api/control/ropes', { dark: true }));
    assert.equal(e.maybe, true, JSON.stringify(body));
    assert.equal(e.noAnswer, true, 'the pages that know noAnswer say "may or may not have happened"');
    assert.equal(e.posted, true);
    assert.equal(e.unreadable, true);
    assert.match(noAnswerText(e, 'the Now line shows what bitcube reports'), /^Mission control's answer couldn't be read: it may or may not have happened; the Now line shows what bitcube reports \(\d\d:\d\d\)\.$/);
    assert.equal(plainError(e), "mission control's answer couldn't be read");
  }
});

test("a POST answered by a proxy's 5xx page may or may not have happened; a GET's is mission control not answering", async () => {
  answer(502, '<html>Bad gateway</html>', 'text/html');
  let e = await caught(api('/api/control/switch', { file: 'x' }));
  assert.deepEqual([e.maybe, e.noAnswer, e.posted, e.notOurs], [true, true, true, true]);
  assert.match(noAnswerText(e, 'the Now line shows what bitcube reports'), /^Mission control didn't answer: it may or may not have happened; /);
  answer(502, '<html>Bad gateway</html>', 'text/html');
  e = await caught(api('/api/status'));
  assert.equal(e.maybe, undefined);
  assert.equal(plainError(e), "mission control didn't answer");
  // a 4xx page from a proxy was not forwarded: not "maybe"
  answer(404, '<html>nope</html>', 'text/html');
  e = await caught(api('/api/control/ropes', {}));
  assert.equal(e.maybe, undefined);
});

test('our own JSON answers: an error is a failure in words; a 409 "wait: …" reads as the server wrote it', async () => {
  answer(409, JSON.stringify({ ok: false, error: 'wait: the switch to the live river is being applied (started 21:04)' }));
  let e = await caught(api('/api/control/ropes', { dark: true }));
  assert.equal(e.status, 409);
  assert.equal(e.maybe, undefined);
  assert.equal(plainError(e), 'wait: the switch to the live river is being applied (started 21:04)');
  answer(500, JSON.stringify({ ok: false, error: "can't reach bitcube over SSH" }));
  e = await caught(api('/api/control/ropes', { dark: true }));
  assert.equal(plainError(e), "bitcube didn't answer");
  answer(200, JSON.stringify({ ok: true, td: { ok: true } }));
  assert.deepEqual(await api('/api/control/ropes', { dark: false }), { ok: true, td: { ok: true } });
});

test('a request that hangs past its limit is given up: no answer, it may or may not have happened', async () => {
  globalThis.fetch = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const e = await caught(api('/api/control/ropes', { dark: true }, { timeout: 30 }));
  assert.deepEqual([e.noAnswer, e.maybe, e.posted], [true, true, true]);
  assert.match(noAnswerText(e, 'the Now line shows what bitcube reports'), /^No answer in 0 s: it may or may not have happened/);
});

test('plainError never shows raw text, and passes the team words through', () => {
  assert.equal(plainError(new Error('wait: a ropes change is being applied (started 02:58)')), 'wait: a ropes change is being applied (started 02:58)');
  assert.equal(plainError(Object.assign(new Error('wait: the rebuild of the river\'s year is being applied (started 02:58)'), { status: 409 })), "wait: the rebuild of the river's year is being applied (started 02:58)");
  assert.equal(plainError(new TypeError("Cannot read properties of null (reading 'x')")), "mission control couldn't do it");
  assert.equal(plainError(Object.assign(new Error('Traceback (most recent call last): probe.ps1'), { status: 500 })), "bitcube couldn't do it");
  assert.equal(plainError(new TypeError('Failed to fetch')), "mission control didn't answer");
});

test('R7 #30: a POST that fails at the network level (reset, a phone changing network) may or may not have happened: never "unchanged"', async () => {
  for (const err of [new TypeError('Failed to fetch'), new TypeError('Load failed'), new TypeError('NetworkError when attempting to fetch resource.')]) {
    globalThis.fetch = async () => { throw err; };
    const e = await caught(api('/api/control/mode', { mode: 'manual' }));
    assert.deepEqual([e.maybe, e.noAnswer, e.posted, e.notOurs], [true, true, true, true], err.message);
    assert.match(noAnswerText(e, 'the Now line shows what bitcube reports'), /^Mission control didn't answer: it may or may not have happened; /);
  }
  // a GET that fails is mission control not answering, nothing more
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const g = await caught(api('/api/status'));
  assert.equal(g.maybe, undefined);
  assert.equal(plainError(g), "mission control didn't answer");
});
