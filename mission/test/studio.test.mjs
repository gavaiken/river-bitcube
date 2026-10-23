import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Studio } from '../lib/studio.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = () => mkdtempSync(join(tmpdir(), 'studio-'));

function fakeRunner(log, { delay = 20, session = 'S1' } = {}) {
  return async function* ({ text, resume, signal }) {
    log.push({ text, resume });
    yield { kind: 'session', sessionId: resume ?? session };
    for (let i = 0; i < 3; i++) {
      if (signal.aborted) return;
      await sleep(delay);
      yield { kind: 'activity', text: `step ${i} for ${text}` };
    }
    yield { kind: 'text', text: `done: ${text}` };
    yield { kind: 'result', ok: true, text: '', cost: 0.01, turns: 1 };
  };
}

test('messages run one at a time, in order, resuming one session', async () => {
  const log = [];
  const s = new Studio({ runner: fakeRunner(log), dir: dir() });
  s.send('first'); s.send('second'); s.send('third');
  assert.equal(s.status().queue.length, 2);           // one running, two waiting
  await s.drained();
  assert.deepEqual(log.map((l) => l.text), ['first', 'second', 'third']);
  assert.deepEqual(log.map((l) => l.resume), [undefined, 'S1', 'S1']);
  const texts = s.history().filter((e) => e.kind === 'text').map((e) => e.text);
  assert.deepEqual(texts, ['done: first', 'done: second', 'done: third']);
});

test('stop interrupts the current request; the queue carries on', async () => {
  const log = [];
  const s = new Studio({ runner: fakeRunner(log, { delay: 50 }), dir: dir() });
  s.send('long'); s.send('next');
  await sleep(60);
  assert.equal(s.stop(), true);
  await s.drained();
  const kinds = s.history().map((e) => e.kind);
  assert.ok(kinds.includes('stopped'));
  assert.ok(s.history().some((e) => e.kind === 'text' && e.text === 'done: next'));
  assert.ok(!s.history().some((e) => e.kind === 'text' && e.text === 'done: long'));
});

test('the conversation and its history survive a restart', async () => {
  const d = dir();
  const log = [];
  const a = new Studio({ runner: fakeRunner(log), dir: d });
  a.send('hello'); await a.drained();
  const b = new Studio({ runner: fakeRunner(log), dir: d });
  assert.ok(b.history().some((e) => e.text === 'done: hello'));
  b.send('again'); await b.drained();
  assert.equal(log.at(-1).resume, 'S1');
});

test('a lost session starts a fresh conversation instead of failing forever', async () => {
  const d = dir();
  const ok = new Studio({ runner: fakeRunner([]), dir: d });
  ok.send('x'); await ok.drained();
  let calls = 0;
  const flaky = async function* ({ resume }) {
    calls++;
    if (resume) throw new Error('No conversation found with session ID: S1');
    yield { kind: 'session', sessionId: 'S2' };
    yield { kind: 'text', text: 'fresh' };
  };
  const s = new Studio({ runner: flaky, dir: d });
  s.send('y'); await s.drained();
  assert.equal(calls, 2);
  assert.ok(s.history().some((e) => e.kind === 'notice'));
  assert.equal(s.state.sessionId, 'S2');
});

test('errors are recorded, not thrown', async () => {
  const s = new Studio({ runner: async function* () { throw new Error('boom'); }, dir: dir() });
  s.send('z'); await s.drained();
  assert.ok(s.history().some((e) => e.kind === 'error' && e.text === 'boom'));
});

test('empty and huge messages are refused', () => {
  const s = new Studio({ runner: fakeRunner([]), dir: dir() });
  assert.throws(() => s.send('   '));
  assert.throws(() => s.send('x'.repeat(20001)));
});
