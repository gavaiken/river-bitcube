// Applying a change (docs/mission-ui.md, "Applying a change"): every control in flight, kept on the server so every phone
// locks what it conflicts with, and so a request from the studio chat (through the local control socket, server.mjs) or a
// second phone can't run into a change half done.
//
// new Applying({ now })                        now: the server's clock (ms)
//   list(clockMs = now()) -> [entry]           status.applying: { id, action, label, file?, source, phase, started_at,
//                                              answered_at?, maybe?, expect_s, blocks }. phase 'applying': its request is in
//                                              flight; 'confirming': it answered, but the change is only real when bitcube's
//                                              reading shows it (a switch or rebuild: TouchDesigner answering on that file),
//                                              or it may or may not have happened (maybe: the call timed out). Times are on
//                                              the clock the snapshot is served on (fixture mode: the scenario's moment, which
//                                              stands still; started_at moves back as time passes)
//   conflict(action) -> entry | null           the first entry that blocks this action, or that it would block
//   run(action, body, fn, opts) -> fn's answer 409 "wait: <label> is being applied (started 21:04)" on a conflict; else
//                                              records the entry and awaits fn(). When it ends: removed (done or failed), or
//                                              kept as 'confirming' (opts.awaits(answer) true, or a maybe answer) until
//                                              confirm() sees the reading, release() drops it, or its confirm limit passes
//   confirm(reading, askedAt) -> [entry]       a full check's answer (probe.ps1: { td: { ok, file } }) asked at askedAt (ms):
//                                              ends every confirming switch or rebuild whose file TouchDesigner now answers on,
//                                              when the reading was asked after the change answered (an older one can't know)
//   release(id)                                ends one entry now (a calibration start whose run showed up, or never did)
// Only the actions in BLOCKS are recorded or checked (a calibration only for its start: Stop must always get through).
import { FILES, TZ, EXPECT_S, APPLY_BLOCKS as BLOCKS, confirmLimitS } from '../public/model.js';

/** What an action in flight blocks (mission-ui.md "What blocks what"): one table for the server and the pages, model.js
 *  APPLY_BLOCKS. A boot-file change also keeps a calibration from starting, so the pages grey Calibrate exactly when the server
 *  would answer 409; a calibration's start blocks what a running calibration blocks (CAL_BLOCKED in mission.mjs) and a second start. */
export { BLOCKS };
/** The usual time of each change, in seconds, until bitcube's reading shows it (a page shows "usually about 1 min" from it, and
 *  gives up on confirming at 3 x this, at least 2 min). A switch: about 10 s to stop TouchDesigner and start the launcher, which
 *  waits 10 s and opens the file (about 40 s). A rebuild: the build and the save, then the switch. A calibration's entry is
 *  only its start (the run reports its own progress). */
export { EXPECT_S };   // one table for the server and the pages: public/model.js
/** Changes whose answer comes before they are real: TouchDesigner is still opening the file when a switch or a rebuild answers. */
export const CONFIRMED_BY_READING = ['switch', 'rebuild'];
/** The actions whose entry names the show file they act on (any other `file` in a request is not ours to repeat). */
const FILE_ACTIONS = ['switch', 'rebuild', 'bootfile'];
export const SOURCES = ['mission control', 'studio chat'];

const fileLabel = (f) => FILES[f]?.label ?? 'a show file';
/** The entry's label, in team words ("the switch to the live river"); `running` is the show file TouchDesigner runs now, so a
 *  switch to that same file reads as the button does ("the restart on the river's year"). */
export function applyLabel(action, body = {}, { running = null } = {}) {
  const f = body && typeof body === 'object' ? body.file : null;
  switch (action) {
    case 'switch': return f && f === running ? `the restart on ${fileLabel(f)}` : `the switch to ${fileLabel(f)}`;
    case 'rebuild': return `a rebuild of ${fileLabel(f)}`;
    case 'bootfile': return 'the boot file change';
    case 'lightsroute': return 'a lighting port change';
    case 'ropes': return 'a ropes change';
    case 'hub75': return 'a panels change';
    case 'mode': return 'a mode change';
    case 'target': return 'a target change';
    case 'rules': return 'a rules change';
    case 'rules-reset': return 'a rules reset';
    case 'calibrate': return 'the start of a calibration';
    default: return 'a change';
  }
}

const HHMM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** A moment as the team's clock reads it: 24-hour Pacific, "21:04". */
export const hhmm = (ms) => HHMM.format(new Date(ms));

/** Whether an action takes part: a calibration only for its start. */
const recorded = (action, body) => !!BLOCKS[action] && (action !== 'calibrate' || body?.action === 'start');
/** TouchDesigner answers on this show file in a full check's reading (the model's tdOk, on that file). */
const answersOn = (reading, file) => {
  const td = reading && typeof reading === 'object' ? reading.td : null;
  return !!td && typeof td === 'object' && td.ok !== false && typeof td.file === 'string' && td.file === file;
};

export class Applying {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.entries = new Map();      // id -> { id, action, label, file?, source, phase, t0, answered?, maybe?, expect_s, blocks }
    this.seq = 0;
  }

  /** Drop confirming entries past their confirm limit (3 x the usual time, at least 2 min, from the start): unconfirmed. A
   *  request still in flight stays (it ends by itself: every call to bitcube has its own time limit). */
  #prune() {
    const t = this.now();
    for (const [id, e] of this.entries) if (e.phase === 'confirming' && t - e.t0 > confirmLimitS(e.expect_s) * 1000) this.entries.delete(id);
  }

  /** status.applying, oldest first; times on the clock the snapshot is served on (clockMs: that clock's now). */
  list(clockMs = this.now()) {
    this.#prune();
    const off = clockMs - this.now();
    return [...this.entries.values()].map(({ t0, answered, ...e }) => ({ ...e, started_at: t0 + off, ...(answered != null ? { answered_at: answered + off } : {}),
                                                                         blocks: [...e.blocks] }));
  }

  /** Both ways: an entry blocks what it names, and an action waits for an entry it would block (a switch restarts
   *  TouchDesigner, so it waits for a ropes change in flight; a boot-file change for a calibration's start). */
  conflict(action) {
    this.#prune();
    const mine = BLOCKS[action] ?? [];
    for (const e of this.entries.values()) if (e.blocks.includes(action) || mine.includes(e.action)) return e;
    return null;
  }

  /** The 409 a conflicting request gets: the label and when it started, on the clock the pages are served. */
  waitError(entry, clockMs = this.now()) {
    const started = entry.t0 + (clockMs - this.now());
    return Object.assign(new Error(`wait: ${entry.label} is being applied (started ${hhmm(started)})`), { status: 409, applying: entry.id });
  }

  /** Run fn as the change `action`: refused with 409 while an entry blocks it; recorded while it runs. When fn ends it is
   *  removed, unless its answer leaves the change to be confirmed: awaits(answer) says so (a switch that answered OK), or the
   *  answer is a maybe ({ ok: false, maybe: true }: the call timed out, bitcube may still be at it). Then it stays as
   *  'confirming', still blocking what it blocks, and onPending(entry) is told (to look again sooner). A thrown request ends
   *  it either way. `body` is the request's checked fields only (never what a client added). */
  async run(action, body, fn, { clock = null, running = null, source = 'mission control', awaits = null, onPending = null } = {}) {
    if (!recorded(action, body)) return fn();
    const c = this.conflict(action);
    if (c) throw this.waitError(c, clock ? clock() : this.now());
    const id = `a${++this.seq}`;
    const f = FILE_ACTIONS.includes(action) && body && typeof body === 'object' && typeof body.file === 'string' && FILES[body.file] ? body.file : null;
    const entry = { id, action, label: applyLabel(action, body, { running }), ...(f ? { file: f } : {}), source: SOURCES.includes(source) ? source : 'mission control',
                    phase: 'applying', t0: this.now(), expect_s: EXPECT_S[action], blocks: BLOCKS[action] };
    this.entries.set(id, entry);
    let r;
    try { r = await fn(); } catch (e) { this.entries.delete(id); throw e; }
    const maybe = !!r && typeof r === 'object' && r.maybe === true;
    let pending = maybe;
    try { pending = pending || (typeof awaits === 'function' && awaits(r) === true); } catch { /* a bad answer: not pending */ }
    if (pending && this.entries.has(id)) {
      Object.assign(entry, { phase: 'confirming', answered: this.now(), ...(maybe ? { maybe: true } : {}) });
      try { onPending?.({ id, action, file: entry.file ?? null, answered: entry.answered }); } catch (e) { console.warn(`applying: ${e.message}`); }
    } else this.entries.delete(id);
    return r;
  }

  /** A full check's reading, asked at askedAt (this clock): every confirming switch or rebuild whose file TouchDesigner answers
   *  on is done. Returns the entries it ended. */
  confirm(reading, askedAt) {
    const done = [];
    for (const [id, e] of this.entries) {
      if (e.phase !== 'confirming' || !CONFIRMED_BY_READING.includes(e.action) || !e.file) continue;
      if (typeof askedAt === 'number' && askedAt >= e.answered && answersOn(reading, e.file)) { this.entries.delete(id); done.push(e); }
    }
    return done;
  }

  /** End one entry now (no-op when it is gone). */
  release(id) { this.entries.delete(id); }

  /** Whether an entry is still there (in flight or confirming). */
  has(id) { return this.entries.has(id); }
}
