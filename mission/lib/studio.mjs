// The studio chat (docs/mission-plan.md): one long-running conversation, single-threaded.
// Messages queue and run one at a time; each run resumes the same agent session; Stop aborts the current
// run (queued messages still run after it, unless Stop was asked to clear the queue: those are recorded as 'stopped' before
// they ever start). Every event is appended to chat.jsonl and emitted live.
//
// A runner is an async generator function run({ text, resume, signal }) yielding events:
//   { kind: 'session', sessionId }          the agent session id (kept in state.json, resumed next time)
//   { kind: 'text', text }                  something the agent said
//   { kind: 'activity', text }              a short line about a tool it used
//   { kind: 'result', ok, text, cost, turns }
// Every recorded event carries the request's id (the 'user' event's), so a page pairs replies with their request. A run that
// ends badly (an 'error' event, a result with ok false, or the runner throwing) is closed by { kind: 'failed', id, text } with
// the reason in plain words (plainFailure); one the person stopped is closed by { kind: 'stopped', id } instead.
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const HISTORY_IN_MEMORY = 3000;

export class Studio extends EventEmitter {
  constructor({ runner, dir, now = () => Date.now() }) {
    super();
    this.runner = runner;
    this.dir = dir;
    this.now = now;
    mkdirSync(dir, { recursive: true });
    this.stateFile = join(dir, 'state.json');
    this.chatFile = join(dir, 'chat.jsonl');
    this.state = readJson(this.stateFile, {});
    this.events = readLines(this.chatFile).slice(-HISTORY_IN_MEMORY);
    this.queue = [];
    this.current = null;     // { id, text, abort }
    this.idle = Promise.resolve();
  }

  status() {
    return { running: !!this.current, current: this.current && { id: this.current.id, text: this.current.text },
             queue: this.queue.map(({ id, text }) => ({ id, text })), session: !!this.state.sessionId };
  }

  history(limit = 500) { return this.events.slice(-limit); }

  send(text) {
    text = String(text ?? '').trim();
    if (!text) throw new Error('empty message');
    if (text.length > 20_000) throw new Error('message too long');
    const item = { id: randomUUID(), text };
    this.queue.push(item);
    this.#record({ kind: 'user', id: item.id, text, queued: !!this.current || this.queue.length > 1 });
    this.#pump();
    if (this.current && this.current.id !== item.id) this.emit('status', this.status());   // it queued: tell open pages now
    return item.id;
  }

  /** Interrupt the request that is running now; with clear, drop the waiting ones too (each recorded as 'stopped', so a page
   *  shows them as Stopped). Returns { stopped, cleared }: whether something was running, and how many never started. */
  stop({ clear = false } = {}) {
    let cleared = 0;
    if (clear && this.queue.length) {
      const dropped = this.queue.splice(0);
      cleared = dropped.length;
      for (const item of dropped) this.#record({ kind: 'stopped', id: item.id, queued: true });
      if (!this.current) this.emit('status', this.status());     // nothing running to end the turn: tell open pages now
    }
    const stopped = !!this.current;
    if (stopped) this.current.abort.abort();
    return { stopped, cleared };
  }

  /** Resolves when the queue is empty and nothing is running (for tests and shutdown). */
  async drained() {
    while (this.current || this.queue.length) await this.idle;
  }

  #pump() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    const abort = new AbortController();
    this.current = { ...item, abort };
    this.idle = this.#run(item, abort).finally(() => {
      this.current = null;
      this.emit('status', this.status());
      this.#pump();
    });
    this.emit('status', this.status());
  }

  async #run(item, abort) {
    this.#record({ kind: 'started', id: item.id });
    let failure = null;                       // the raw reason the run went wrong, if it did
    const attempt = async (resume) => {
      let produced = false;
      failure = null;
      for await (const ev of this.runner({ text: item.text, resume, signal: abort.signal })) {
        if (abort.signal.aborted) break;
        if (ev.kind === 'session') {
          if (ev.sessionId && ev.sessionId !== this.state.sessionId) {
            this.state.sessionId = ev.sessionId;
            writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
          }
          continue;
        }
        produced = true;
        if (ev.kind === 'error') failure = String(ev.text ?? 'error');
        if (ev.kind === 'result' && ev.ok === false) failure = String(ev.text || failure || 'the agent stopped with an error');
        this.#record({ ...ev, id: item.id });
      }
      return produced;
    };
    try {
      await attempt(this.state.sessionId);
    } catch (e) {
      if (abort.signal.aborted) {
        // falls through to 'stopped' below
      } else if (this.state.sessionId && /no conversation found|session.*not found/i.test(String(e?.message))) {
        // The saved session is gone (config wiped): start a fresh conversation rather than failing forever.
        this.#record({ kind: 'notice', id: item.id, text: 'The previous conversation could not be found, so this starts a new one.' });
        delete this.state.sessionId;
        writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        try { await attempt(undefined); } catch (e2) { failure = String(e2?.message ?? e2); this.#record({ kind: 'error', id: item.id, text: failure }); }
      } else {
        failure = String(e?.message ?? e);
        this.#record({ kind: 'error', id: item.id, text: failure });
      }
    }
    if (abort.signal.aborted) this.#record({ kind: 'stopped', id: item.id });
    else if (failure != null) this.#record({ kind: 'failed', id: item.id, text: plainFailure(failure) });
  }

  #record(ev) {
    const e = { t: this.now(), ...ev };
    this.events.push(e);
    if (this.events.length > HISTORY_IN_MEMORY) this.events.splice(0, this.events.length - HISTORY_IN_MEMORY);
    appendFileSync(this.chatFile, JSON.stringify(e) + '\n');
    this.emit('event', e);
  }
}

/** Why a run failed, in the words a teammate reads (never the plumbing: ssh, ports, exit codes). */
export function plainFailure(raw) {
  const s = String(raw ?? '').trim();
  if (/ssh|connect to host|port 22|bitcube did not answer|bitcube didn't answer/i.test(s)) return "bitcube didn't answer";
  if (/no claude token|setup-token/i.test(s)) return 'the agent has no token yet';
  if (/timed? ?out|timeout|took too long/i.test(s)) return 'it took too long';
  if (/rate limit|overloaded|529|too many requests/i.test(s)) return 'the agent is busy; try again in a minute';
  if (/quota|budget|credit|billing/i.test(s)) return 'the agent is out of credit';
  if (/network|ENOTFOUND|ECONN|fetch failed/i.test(s)) return "the agent couldn't reach the internet";
  return 'the agent stopped with an error';
}

function readJson(path, dflt) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return dflt; } }
function readLines(path) {
  try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
