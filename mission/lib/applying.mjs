// Applying a change (docs/mission-ui.md, "Applying a change"): every control in flight, kept on the server so every phone
// locks what it conflicts with, and so a request from the studio chat (through the local control socket, server.mjs) or a
// second phone can't run into a change half done.
//
// new Applying({ now })                        now: the server's clock (ms)
//   list(clockMs = now()) -> [entry]           status.applying: { id, request_id?, action, label, file?, source, phase,
//                                              started_at, answered_at?, maybe?, expect_s, blocks }. request_id: the page's own
//                                              id for that press (R8 #2), so a page whose answer was lost still finds its entry. phase 'applying': its request is in
//                                              flight; 'confirming': it answered, but the change is only real when bitcube's
//                                              reading shows it (a switch or rebuild: TouchDesigner answering on that file),
//                                              or it may or may not have happened (maybe: the call timed out). Times are on
//                                              the clock the snapshot is served on (fixture mode: the scenario's moment, which
//                                              stands still; started_at moves back as time passes)
//   conflict(action, body?) -> entry | null    the first entry that blocks this action, or that it would block; a dry run's or
//                                              a decode's start (body) only another calibration start
//   run(action, body, fn, opts) -> fn's answer, with applying_id: the entry's id (a maybe answer too), so a page knows which
//                                              entry is its own (opts.requestId: the page's id for the press, kept on the entry). 409 "wait: <label> is being applied (started 21:04)" on a
//                                              conflict; else records the entry and awaits fn(). When it ends: confirmed (its
//                                              answer was good and is the change: ropes, panels, the year's controls), removed
//                                              (failed), or kept as 'confirming' (opts.awaits(answer) true, or a maybe answer)
//                                              until confirm() sees the reading (confirmed), release() ends it, or its confirm
//                                              limit passes (expired). opts.onConfirmed(entry) runs when it ends confirmed (the
//                                              map in use is recorded only then)
//   confirm(reading, askedAt) -> [entry]       a full check's answer (probe.ps1: { td: { ok, file }, boot_file, lights_route })
//                                              asked at askedAt (ms): ends every confirming switch or rebuild whose file
//                                              TouchDesigner now answers on, boot-file change whose boot file it shows, and lighting
//                                              port change whose port it shows (R8 #31), when the reading was asked after the change
//                                              answered (an older one can't know).
//                                              A restart or rebuild that got no answer in time (maybe) also needs TouchDesigner
//                                              seen down after it: the old TouchDesigner answering on the same file proves nothing
//   release(id, verdict?)                      ends one entry now: 'confirmed' (a calibration start whose run showed up),
//                                              'expired' (one whose run never did), or neither (just gone)
//   ended(clockMs = now) -> { confirmed, expired }   status.confirmed / status.expired: [{ id, request_id?, action, label,
//                                              source, file?, started_at, at, maybe? }], the entries that ended confirmed or ran
//                                              out unconfirmed in the last ENDED_KEEP_MS (the newest ENDED_MAX), so every phone (and
//                                              the one that sent it) sees the server's verdict, and another phone can say how a
//                                              change it watched ended (R8 #9)
// Only the actions in BLOCKS are recorded or checked (a calibration only for its start: Stop must always get through).
import { TZ, EXPECT_S, APPLY_BLOCKS as BLOCKS, confirmLimitS, changeLabel, FILES, dryStart, waitWords, MAYBE_HOLDS } from '../public/model.js';

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
export const CONFIRMED_BY_READING = ['switch', 'rebuild', 'bootfile', 'lightsroute'];
/** A maybe (bitcube didn't answer in time) keeps its lock only for a change that could still be under way on bitcube and must not
 *  be run twice; a quick one (ropes, panels, the year's controls) is no lock: the next reading says what happened. */
export { MAYBE_HOLDS };   // one table for the server and the pages: public/model.js
/** The actions whose entry names the show file they act on (any other `file` in a request is not ours to repeat). */
const FILE_ACTIONS = ['switch', 'rebuild', 'bootfile'];
export const SOURCES = ['mission control', 'studio chat'];
/** How long an ended entry stays in status.confirmed / status.expired: a phone that slept or lost contact for a few minutes still
 *  learns the server's verdict on its own change. */
export const ENDED_KEEP_MS = 10 * 60_000;
/** At most this many ended entries are kept (status.confirmed and status.expired together): every quick change (ropes, panels, the
 *  year's controls) ends confirmed at its answer, and every phone downloads the lists on every poll, so a burst of them must
 *  never grow them without end (R8 #39). Over it, the oldest quick one goes first (a page waits only on its own switch, rebuild,
 *  boot-file change or calibration start; the history keeps those verdicts for longer: status.verdicts). */
export const ENDED_MAX = 100;
/** A page's own id for one press (R8 #2): letters, digits, '.', '_' and '-', at most 40. Anything else is not kept. */
export const REQUEST_ID = /^[A-Za-z0-9._-]{1,40}$/;
/** Fields kept on an entry for the server's own use, never served. */
const INTERNAL = ['t0', 'answered', 'restart', 'sawDown', 'route', 'awaited'];

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
    this.entries = new Map();      // id -> { id, action, label, file?, source, phase, t0, answered?, maybe?, expect_s, blocks, restart?, sawDown? }
    this.seq = 0;
    // ids are unique across restarts of the server (a page may still hold one from before): a random prefix per instance
    this.prefix = `a${Math.random().toString(36).slice(2, 6)}.`;
    this.done = [];                // [{ id, request_id?, action, label, source, file?, verdict: 'confirmed' | 'expired', t0, at, maybe?, awaited? }], oldest first
    this.hooks = new Map();        // id -> onConfirmed(entry)
  }

  /** End an entry with the server's verdict: 'confirmed' (bitcube's reading showed it, or its own answer was the change) or
   *  'expired' (its confirm limit passed unconfirmed); kept for ENDED_KEEP_MS in ended(). */
  #settle(id, e, verdict) {
    this.entries.delete(id);
    const hook = this.hooks.get(id);
    this.hooks.delete(id);
    this.done.push({ id, ...(e.request_id ? { request_id: e.request_id } : {}), action: e.action, label: e.label, source: e.source, ...(e.file ? { file: e.file } : {}),
                     verdict, t0: e.t0, at: this.now(), ...(e.maybe ? { maybe: true } : {}), ...(e.phase === 'confirming' ? { awaited: true } : {}) });
    // the newest ENDED_MAX, the oldest change confirmed at its own answer first (R8 #39)
    while (this.done.length > ENDED_MAX) { const i = this.done.findIndex((d) => !d.awaited); this.done.splice(i >= 0 ? i : 0, 1); }
    if (verdict === 'confirmed' && hook) { try { hook(this.#served(e)); } catch (x) { console.warn(`applying: ${x.message}`); } }
  }

  /** Drop confirming entries past their confirm limit (3 x the usual time, at least 2 min, from the answer: a slow rebuild
   *  still has its whole limit for TouchDesigner to reopen): expired, unconfirmed. A request still in flight stays (it ends by
   *  itself: every call to bitcube has its own time limit). Ended entries are kept ENDED_KEEP_MS. */
  #prune() {
    const t = this.now();
    for (const [id, e] of this.entries) if (e.phase === 'confirming' && t - (e.answered ?? e.t0) > confirmLimitS(e.expect_s) * 1000) this.#settle(id, e, 'expired');
    this.done = this.done.filter((d) => t - d.at <= ENDED_KEEP_MS);
  }

  /** An entry as status.applying serves it (its internal fields left out), times moved by off. */
  #served(e, off = 0) {
    const out = Object.fromEntries(Object.entries(e).filter(([k]) => !INTERNAL.includes(k)));
    return { ...out, started_at: e.t0 + off, ...(e.answered != null ? { answered_at: e.answered + off } : {}), blocks: [...e.blocks] };
  }

  /** status.applying, oldest first; times on the clock the snapshot is served on (clockMs: that clock's now). */
  list(clockMs = this.now()) {
    this.#prune();
    const off = clockMs - this.now();
    return [...this.entries.values()].map((e) => this.#served(e, off));
  }

  /** status.confirmed and status.expired: the entries that ended in the last ENDED_KEEP_MS, oldest first, on the served clock. */
  ended(clockMs = this.now()) {
    this.#prune();
    const off = clockMs - this.now();
    const out = { confirmed: [], expired: [] };
    for (const d of this.done) {
      out[d.verdict].push({ id: d.id, ...(d.request_id ? { request_id: d.request_id } : {}), action: d.action, label: d.label, source: d.source, ...(d.file ? { file: d.file } : {}),
                            started_at: d.t0 + off, at: d.at + off, ...(d.maybe ? { maybe: true } : {}) });
    }
    return out;
  }

  /** Both ways: an entry blocks what it names, and an action waits for an entry it would block (a switch restarts
   *  TouchDesigner, so it waits for a ropes change in flight; a boot-file change for a calibration's start). A dry run's or a
   *  decode's start (body) touches no lights, camera or TouchDesigner: it waits only for another calibration start (CR7 #7). */
  conflict(action, body = null) {
    this.#prune();
    if (dryStart(action, body)) { for (const e of this.entries.values()) if (e.action === 'calibrate') return e; return null; }
    const mine = BLOCKS[action] ?? [];
    for (const e of this.entries.values()) if (e.blocks.includes(action) || (!e.dry && mine.includes(e.action))) return e;
    return null;
  }

  /** The 409 a conflicting request gets: the label and when it started, on the clock the pages are served; one bitcube didn't
   *  answer in time (maybe), when its lock ends instead: "wait: <label> got no answer from bitcube in time; it unlocks by 21:07"
   *  (model.js waitWords, the pages' "Wait: …" line: R8 #16, #17). */
  waitError(entry, clockMs = this.now()) {
    const off = clockMs - this.now(), started = entry.t0 + off;
    const words = entry.maybe && entry.phase === 'confirming'
      ? waitWords(entry.label, { maybe: true, unlockMs: (entry.answered ?? entry.t0) + confirmLimitS(entry.expect_s) * 1000 + off })
      : `wait: ${entry.label} is being applied (started ${hhmm(started)})`;
    return Object.assign(new Error(words), { status: 409, applying: entry.id });
  }

  /** Run fn as the change `action`: refused with 409 while an entry blocks it; recorded while it runs. When fn ends it is
   *  confirmed when its good answer is the change itself, removed when it failed, unless its answer leaves the change to be
   *  confirmed: awaits(answer) says so (a switch that answered OK), or the answer is a maybe ({ ok: false, maybe: true }: the
   *  call timed out, bitcube may still be at it). Then it stays as 'confirming', still blocking what it blocks, and
   *  onPending(entry) is told (to look again sooner). A thrown request ends it either way. `body` is the request's checked
   *  fields only (never what a client added); `running` the show file TouchDesigner runs now (a switch to it is a restart).
   *  The answer comes back with applying_id, the entry's id. */
  async run(action, body, fn, { clock = null, running = null, source = 'mission control', awaits = null, onPending = null, onConfirmed = null, requestId = null } = {}) {
    if (!recorded(action, body)) return fn();
    const c = this.conflict(action, body);
    if (c) throw this.waitError(c, clock ? clock() : this.now());
    const id = `${this.prefix}${++this.seq}`;
    const f = FILE_ACTIONS.includes(action) && body && typeof body === 'object' && typeof body.file === 'string' && FILES[body.file] ? body.file : null;
    // a dry run's start (or a decode of earlier photos: CR7 #6) touches no lights, camera or TouchDesigner: it blocks only a second
    // start, and nothing waits for it (R7 #20)
    const dry = dryStart(action, body);
    // the change's one name (model.js changeLabel, R7 #19): a switch to the file TouchDesigner runs now reads "the restart on …"
    const rid = typeof requestId === 'string' && REQUEST_ID.test(requestId) ? requestId : null;
    // a lighting port change keeps the port it asked for (internal): a reading that shows it confirms one bitcube didn't answer (R8 #31)
    const route = action === 'lightsroute' && ['direct', 'router'].includes(body?.route) ? body.route : null;
    const entry = { id, ...(rid ? { request_id: rid } : {}), action, label: changeLabel(action, body, { running }), ...(f ? { file: f } : {}), source: SOURCES.includes(source) ? source : 'mission control',
                    phase: 'applying', t0: this.now(), expect_s: EXPECT_S[action], blocks: dry ? ['calibrate'] : BLOCKS[action], ...(dry ? { dry: true } : {}),
                    restart: action === 'switch' && !!f && f === running, route };
    this.entries.set(id, entry);
    if (typeof onConfirmed === 'function') this.hooks.set(id, onConfirmed);
    let r;
    try { r = await fn(); } catch (e) { this.entries.delete(id); this.hooks.delete(id); throw e; }
    const isObj = !!r && typeof r === 'object' && !Array.isArray(r);
    const maybe = isObj && r.maybe === true;
    let pending = maybe && MAYBE_HOLDS.includes(action);
    try { pending = pending || (typeof awaits === 'function' && awaits(r) === true); } catch { /* a bad answer: not pending */ }
    if (pending && this.entries.has(id)) {
      Object.assign(entry, { phase: 'confirming', answered: this.now(), ...(maybe ? { maybe: true } : {}) });
      try { onPending?.({ id, action, file: entry.file ?? null, answered: entry.answered }); } catch (e) { console.warn(`applying: ${e.message}`); }
    } else if (this.entries.has(id)) {
      // its own good answer is the change (ropes, panels, the year's controls, a boot file the answer shows, a calibration whose
      // run is already in the answer); a refusal or a maybe on a quick change is not something the server saw through
      if (isObj && r.ok !== false && !maybe) this.#settle(id, entry, 'confirmed');
      else { this.entries.delete(id); this.hooks.delete(id); }
    }
    return isObj ? { ...r, applying_id: id } : r;
  }

  /** A full check's reading, asked at askedAt (this clock): every confirming switch, rebuild, boot-file change or lighting port
   *  change it shows is done. Only a reading asked after the change answered can show it. A restart or a rebuild that got no
   *  answer in time (maybe) may never have stopped TouchDesigner, so the same file answering proves nothing until TouchDesigner
   *  has been seen not answering after it (a switch that answered stopped TouchDesigner before answering). Returns the entries it
   *  ended. */
  confirm(reading, askedAt) {
    const done = [];
    if (typeof askedAt !== 'number') return done;
    const td = reading && typeof reading === 'object' ? reading.td : null;
    const down = !!td && typeof td === 'object' && (td.ok === false || typeof td.file !== 'string');
    for (const [id, e] of this.entries) {
      if (e.phase !== 'confirming' || !CONFIRMED_BY_READING.includes(e.action) || askedAt < e.answered) continue;
      let shows;
      if (e.action === 'lightsroute') shows = !!e.route && reading?.lights_route === e.route;
      else if (!e.file) continue;
      else if (e.action === 'bootfile') shows = reading?.boot_file === e.file;
      else {
        const needsDown = e.maybe === true && (e.restart || e.action === 'rebuild');
        if (needsDown && down) e.sawDown = true;
        shows = answersOn(reading, e.file) && (!needsDown || e.sawDown === true);
      }
      if (shows) { done.push(this.#served(e)); this.#settle(id, e, 'confirmed'); }
    }
    return done;
  }

  /** End one entry now (no-op when it is gone): 'confirmed' or 'expired' records the server's verdict; without one it is just gone. */
  release(id, verdict = null) {
    const e = this.entries.get(id);
    if (!e) return;
    if (verdict === 'confirmed' || verdict === 'expired') this.#settle(id, e, verdict);
    else { this.entries.delete(id); this.hooks.delete(id); }
  }

  /** Whether an entry is still there (in flight or confirming). */
  has(id) { return this.entries.has(id); }
}
