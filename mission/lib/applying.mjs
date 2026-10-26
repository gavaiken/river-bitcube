// Applying a change (docs/mission-ui.md, "Applying a change"): every control in flight, kept on the server so every phone
// locks what it conflicts with, and so a request from the studio chat or a second phone can't run into a change half done.
//
// new Applying({ now })                        now: the server's clock (ms)
//   list(clockMs = now()) -> [entry]           status.applying: { id, action, label, file?, started_at, expect_s, blocks }
//                                              started_at is on the clock the snapshot is served on (fixture mode: the
//                                              scenario's moment, which stands still; started_at moves back as time passes)
//   conflict(action) -> entry | null           the first entry that blocks this action, or that it would block
//   run(action, body, fn, { clock, running })  409 "wait: <label> is being applied (started 21:04)" on a conflict; else
//                                              records the entry, awaits fn(), and removes the entry when it ends, either way
// Only the actions in BLOCKS are recorded or checked (a calibration only for its start: Stop must always get through).
import { FILES, TZ, EXPECT_S, APPLY_BLOCKS as BLOCKS } from '../public/model.js';

/** What an action in flight blocks (mission-ui.md "What blocks what"): one table for the server and the pages, model.js
 *  APPLY_BLOCKS. A boot-file change also keeps a calibration from starting, so the pages grey Calibrate exactly when the server
 *  would answer 409; a calibration's start blocks what a running calibration blocks (CAL_BLOCKED in mission.mjs) and a second start. */
export { BLOCKS };
/** The usual time of each change, in seconds, until bitcube's reading shows it (a page shows "usually about 1 min" from it, and
 *  gives up on confirming at 3 x this, at least 2 min). A switch: about 10 s to stop TouchDesigner and start the launcher, which
 *  waits 10 s and opens the file (about 40 s). A rebuild: the build and the save, then the switch. A calibration's entry is
 *  only its start (the run reports its own progress). */
export { EXPECT_S };   // one table for the server and the pages: public/model.js

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

export class Applying {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.entries = new Map();      // id -> { id, action, label, file?, t0, expect_s, blocks }
    this.seq = 0;
  }

  /** status.applying, oldest first; started_at on the clock the snapshot is served on (clockMs: that clock's now). */
  list(clockMs = this.now()) {
    const off = clockMs - this.now();
    return [...this.entries.values()].map(({ t0, ...e }) => ({ ...e, started_at: t0 + off, blocks: [...e.blocks] }));
  }

  /** Both ways: an entry blocks what it names, and an action waits for an entry it would block (a switch restarts
   *  TouchDesigner, so it waits for a ropes change in flight; a boot-file change for a calibration's start). */
  conflict(action) {
    const mine = BLOCKS[action] ?? [];
    for (const e of this.entries.values()) if (e.blocks.includes(action) || mine.includes(e.action)) return e;
    return null;
  }

  /** The 409 a conflicting request gets: the label and when it started, on the clock the pages are served. */
  waitError(entry, clockMs = this.now()) {
    const started = entry.t0 + (clockMs - this.now());
    return Object.assign(new Error(`wait: ${entry.label} is being applied (started ${hhmm(started)})`), { status: 409, applying: entry.id });
  }

  /** Run fn as the change `action`: refused with 409 while an entry blocks it; recorded while it runs; removed when it ends. */
  async run(action, body, fn, { clock = null, running = null } = {}) {
    if (!recorded(action, body)) return fn();
    const c = this.conflict(action);
    if (c) throw this.waitError(c, clock ? clock() : this.now());
    const id = `a${++this.seq}`;
    const f = body && typeof body === 'object' && typeof body.file === 'string' ? body.file : null;
    this.entries.set(id, { id, action, label: applyLabel(action, body, { running }), ...(f ? { file: f } : {}), t0: this.now(),
                           expect_s: EXPECT_S[action], blocks: BLOCKS[action] });
    try { return await fn(); } finally { this.entries.delete(id); }
  }
}
