// The studio chat (docs/mission-plan.md): one long-running conversation, single-threaded.
// Messages queue and run one at a time; each run resumes the same agent session; Stop aborts the current
// run (queued messages still run after it). Every event is appended to chat.jsonl and emitted live.
//
// A runner is an async generator function run({ text, resume, signal }) yielding events:
//   { kind: 'session', sessionId }          the agent session id (kept in state.json, resumed next time)
//   { kind: 'text', text }                  something the agent said
//   { kind: 'activity', text }              a short line about a tool it used
//   { kind: 'result', ok, text, cost, turns }
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
    return item.id;
  }

  /** Interrupt the request that is running now. Returns false if nothing was running. */
  stop() {
    if (!this.current) return false;
    this.current.abort.abort();
    return true;
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
    const attempt = async (resume) => {
      let produced = false;
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
        try { await attempt(undefined); } catch (e2) { this.#record({ kind: 'error', id: item.id, text: String(e2?.message ?? e2) }); }
      } else {
        this.#record({ kind: 'error', id: item.id, text: String(e?.message ?? e) });
      }
    }
    if (abort.signal.aborted) this.#record({ kind: 'stopped', id: item.id });
  }

  #record(ev) {
    const e = { t: this.now(), ...ev };
    this.events.push(e);
    if (this.events.length > HISTORY_IN_MEMORY) this.events.splice(0, this.events.length - HISTORY_IN_MEMORY);
    appendFileSync(this.chatFile, JSON.stringify(e) + '\n');
    this.emit('event', e);
  }
}

function readJson(path, dflt) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return dflt; } }
function readLines(path) {
  try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
