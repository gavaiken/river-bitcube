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
  assert.deepEqual(s.stop(), { stopped: true, cleared: 0 });
  await s.drained();
  const kinds = s.history().map((e) => e.kind);
  assert.ok(kinds.includes('stopped'));
  assert.ok(!kinds.includes('failed'), 'a stop is not a failure');
  assert.ok(s.history().some((e) => e.kind === 'text' && e.text === 'done: next'));
  assert.ok(!s.history().some((e) => e.kind === 'text' && e.text === 'done: long'));
});

test('stop with clear drops the waiting requests too, each recorded as stopped before it started', async () => {
  const log = [];
  const s = new Studio({ runner: fakeRunner(log, { delay: 50 }), dir: dir() });
  const one = s.send('long'), two = s.send('next'), three = s.send('later');
  await sleep(60);
  assert.deepEqual(s.stop({ clear: true }), { stopped: true, cleared: 2 });
  assert.deepEqual(s.status().queue, []);
  await s.drained();
  const stopped = s.history().filter((e) => e.kind === 'stopped').map((e) => e.id);
  assert.deepEqual(stopped.sort(), [one, two, three].sort());
  assert.ok(!s.history().some((e) => e.kind === 'started' && e.id !== one), 'the cleared ones never started');
  assert.ok(!s.history().some((e) => e.kind === 'text'));
  assert.deepEqual(s.stop({ clear: true }), { stopped: false, cleared: 0 });
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

test('errors are recorded, not thrown, and the run is closed by a failed event in plain words', async () => {
  const s = new Studio({ runner: async function* () { throw new Error('boom'); }, dir: dir() });
  const id = s.send('z'); await s.drained();
  assert.ok(s.history().some((e) => e.kind === 'error' && e.text === 'boom'));
  const failed = s.history().filter((e) => e.kind === 'failed');
  assert.deepEqual(failed.map((e) => [e.id, e.text]), [[id, 'the agent stopped with an error']]);
  assert.ok(s.history().every((e) => e.id === id), 'every event carries the request id');
  // a result with ok false (the agent gave up) or an error event mid-run: one failed event, the reason in plain words
  const bad = async function* ({ text }) {
    yield { kind: 'session', sessionId: 'S' };
    if (/ssh/.test(text)) yield { kind: 'error', text: 'ssh: connect to host bitcube port 22: Operation timed out' };
    yield { kind: 'result', ok: false, text: /ssh/.test(text) ? 'bitcube did not answer' : 'Claude Code process exited with code 1', cost: 0, turns: 1 };
  };
  const b = new Studio({ runner: bad, dir: dir() });
  const one = b.send('try ssh'); await b.drained();
  const two = b.send('plain'); await b.drained();
  assert.deepEqual(b.history().filter((e) => e.kind === 'failed').map((e) => [e.id, e.text]), [[one, "bitcube didn't answer"], [two, 'the agent stopped with an error']]);
  assert.deepEqual(b.history().filter((e) => e.id === one).map((e) => e.kind), ['user', 'started', 'error', 'result', 'failed']);
  assert.ok(!b.history().some((e) => e.kind === 'stopped'));
});

test('plainFailure never leaks the plumbing', async () => {
  const { plainFailure } = await import('../lib/studio.mjs');
  assert.equal(plainFailure('ssh: connect to host bitcube port 22: Operation timed out'), "bitcube didn't answer");
  assert.equal(plainFailure('The studio agent has no Claude token yet (step M7: Gavin runs `claude setup-token`)'), 'the agent has no token yet');
  assert.equal(plainFailure('request timed out after 600 s'), 'it took too long');
  assert.equal(plainFailure('fetch failed: ENOTFOUND api.anthropic.com'), "the agent couldn't reach the internet");
  assert.equal(plainFailure('429 rate limit exceeded'), 'the agent is busy; try again in a minute');
  for (const raw of ['TypeError: x is undefined', '', null]) assert.equal(plainFailure(raw), 'the agent stopped with an error');
  for (const raw of ['ssh x', 'token y', 'ECONNRESET']) assert.ok(!/\b(ssh|tcp|token|ECONN|exit|json)\b/i.test(plainFailure(raw).replace('token yet', '')) || plainFailure(raw) === 'the agent has no token yet');
});

test('empty and huge messages are refused', () => {
  const s = new Studio({ runner: fakeRunner([]), dir: dir() });
  assert.throws(() => s.send('   '));
  assert.throws(() => s.send('x'.repeat(20001)));
});

test('a message that queues behind a running one is announced at once', async () => {
  const s = new Studio({ runner: fakeRunner([], { delay: 50 }), dir: dir() });
  const seen = [];
  s.on('status', (st) => seen.push(st.queue.length));
  s.send('one'); s.send('two');
  assert.ok(seen.includes(1), `status events saw queue lengths ${seen}`);   // "1 waiting" went out when "two" queued
  await s.drained();
});

test('a camera login never reaches the chat: steps, replies, errors and the saved history are scrubbed (and an old file is on load)', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const PW = 'rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_sub';
  const leaky = async function* () {
    yield { kind: 'session', sessionId: 'S' };
    yield { kind: 'activity', text: 'grabbed a frame', raw: `ffmpeg -rtsp_transport tcp -i ${PW} -frames:v 1 a.jpg`, acting: false };
    yield { kind: 'text', text: `ffmpeg said: 401 Unauthorized: ${PW}` };
    yield { kind: 'error', text: `Command failed: ffmpeg -i ${PW}` };
    yield { kind: 'result', ok: false, text: `exit 1: ${PW}`, cost: 0, turns: 1 };
  };
  const d = dir();
  const seen = [];
  const s = new Studio({ runner: leaky, dir: d });
  s.on('event', (e) => seen.push(e));
  s.send(`look at ${PW}`); await s.drained();
  for (const where of [JSON.stringify(s.history()), JSON.stringify(seen), readFileSync(join(d, 'chat.jsonl'), 'utf8')]) {
    assert.doesNotMatch(where, /NOT-A-REAL-PW|admin:/);
    assert.match(where, /rtsp:\/\/\*\*\*@192\.168\.9\.76/);
  }
  // a history file written before the scrub is served clean
  const old = dir();
  writeFileSync(join(old, 'chat.jsonl'), JSON.stringify({ t: 1, kind: 'activity', id: 'x', text: `ran: ffmpeg -i ${PW}` }) + '\n');
  assert.doesNotMatch(JSON.stringify(new Studio({ runner: leaky, dir: old }).history()), /NOT-A-REAL-PW/);
});

test('round 6 #37: the running and waiting requests are served scrubbed (status(), every status event); the agent still gets what was typed', async () => {
  const log = [], seen = [];
  const s = new Studio({ runner: fakeRunner(log, { delay: 30 }), dir: dir() });
  s.on('status', (st) => seen.push(JSON.stringify(st)));
  s.send('why does rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_sub fail');
  s.send("and https://admin:NOT-A-REAL-PW@192.168.9.76/cgi-bin/api.cgi");
  const st = s.status();
  assert.equal(st.current.text, 'why does rtsp://***@192.168.9.76:554/Preview_01_sub fail');
  assert.equal(st.queue[0].text, 'and https://***@192.168.9.76/cgi-bin/api.cgi');
  await s.drained();
  assert.ok(seen.length >= 2);
  for (const x of seen) assert.doesNotMatch(x, /NOT-A-REAL-PW/);
  assert.match(log[0].text, /NOT-A-REAL-PW/, 'the request itself is the person\'s own words, for the agent');
});
