// What happened, and since when. The UI audit found that no fault says since when (P39: wait or act?) and nothing
// records what was last done (P40: on purpose or broken? is someone on it?). The server feeds History after every
// poll and every control; it keeps TRANSITIONS only, so a quiet night is a few lines and a flapping camera is one
// line per flap, never one per poll. Every verdict comes from public/model.js derive(), so the feed, the "since"
// and the page can never disagree about a state. Persisted as <state>/history.jsonl, one JSON line per event.
//
// new History({ file, now = () => Date.now(), keepMs = 48 h, max = 5000 })   file: null keeps it in memory only
//   observe(status, nowMs) -> [events]   after every poll: the /api/status payload (with or without its `now`). The
//                                        verdict is judged by the payload's own clock (`now`, else nowMs); nowMs only
//                                        stamps the events. The server is not a page: it can never "fail to fetch".
//   action(entry) -> event               a control was used: { action, body, ok, note, source, t? }
//   since(id, nowMs) -> { level, since, for_s, at_least } | null      id: an item id or 'overall' (adds cause, stale)
//   sinceShow(field, nowMs) -> { value, since, for_s, at_least } | null   field: file | mode | season | ropes
//   recent({ limit = 50, kinds, sinceT }) -> events, newest first (default window: the last keepMs); an action that waited for
//                                        the server's verdict carries it (verdict: 'confirmed' | 'expired'), so its words do, or
//                                        pending: true while one can still come (summary().last_action too; CR8 #7)
//   summary(nowMs) -> { since: { overall, items: { id }, show: { field } }, last_action, count }
//   verdicts(nowMs, { limit, quick, withinMs }) -> [{ id, request_id?, verdict }]   the server's verdicts kept, newest first
//                                        (status.verdicts): the newest `limit` on changes that waited for one (model.js AWAITED, a
//                                        maybe), whatever came after them, and the newest `quick` on the rest, within `withinMs`
// describeEvent(ev) -> one plain sentence for a feed (glossary words, no jargon; never throws).
//
// Events (all carry t, ms epoch on the server's clock; `from` is null the first time something is seen):
//   { kind: 'overall', t, level, cause, headline, stale, lost, from: { level, cause, stale, lost } | null, back? }
//       the verdict changed: level, cause, or contact. stale: a source the verdict needs has gone quiet and `lost`
//       names it ('bitcube', "the river's year page", "Dave's agent"). back: the fault TouchDesigner restarting interrupted
//       (never OK: CR8 #8), the same after it: it keeps its since from before the restart ("After the restart, as before: …", R8 #5).
//   { kind: 'item', t, id, from, to, summary, stale?, gap?, still? }   a piece of equipment changed level (levels: ok warning
//                                                          down); stale: its source was already quiet at the time; gap: it
//                                                          was not seen just before (since is "at least"); still: the same
//                                                          state seen again after a long unseen stretch (since restarts)
//   { kind: 'show', t, field, from, to }                   file (the .toe name) | mode | season | ropes (the state word)
//   { kind: 'calibration', t, running, stage, ok, cancelled, mode, error, stale, from: { running, stage } | null }
//   { kind: 'action', t, action, body, ok, note, source, label?, maybe?, applying_id?, request_id? }   source: 'mission control' | 'studio chat' (never a
//                                                          person: MD4); body: the request's checked fields (what the
//                                                          whitelist read), cut to BODY_MAX chars of JSON; label: the change's
//                                                          own words ("the restart on the river's year"); maybe: no answer in
//                                                          time, so it may or may not have happened; applying_id: its entry
//                                                          (lib/applying.mjs), so a page can tell it is still being confirmed
//                                                          (status.applying), confirmed or expired; request_id: the page's own
//                                                          id for the press (R8 #2). Logins are scrubbed.
//   { kind: 'verdict', t, applying_id, request_id?, verdict, awaited? }   the server's verdict on an action's entry ('confirmed' or
//                                                          'expired'; awaited: its action waited for it, awaitsVerdict),
//                                                          for every action with an entry (the words of those that wait for it,
//                                                          awaitsVerdict: a switch, a rebuild, a boot-file or lighting port change,
//                                                          a calibration start, a maybe, follow it), read from status.confirmed /
//                                                          status.expired: kept with the
//                                                          history, so Last done, Recent and a page that slept know it after those
//                                                          10 min and after a restart (summary().last_action.verdict, CR7 #5;
//                                                          verdicts(), R8 #0, #19). Bookkeeping: not in recent().
//
// Rules, and why:
// - 'unknown' is the absence of knowledge, not a state. A piece that can't be checked (bitcube offline, the server
//   just started, the full check not back yet) keeps its last known level and its since, and nothing is written: the
//   overall verdict says "bitcube went offline" once instead of fifteen "can't be checked" lines at every restart.
//   The exception is a STALE unknown: a source going quiet is "lost contact", worth a line, so overall events carry
//   the stale flag; but it does not reset since('overall'), because the show did not change, only our view of it.
// - Seen again after a long unseen stretch (over UNSEEN_GAP_MS: bitcube offline, contact lost, a full check stuck), the same
//   level and reason is a first sighting again: the piece may have changed and changed back meanwhile, so its since restarts
//   at the reappearance with at_least ("for over 1 min"), never the whole stretch nobody saw. A piece read only from a last
//   answer (its source quiet) is not seen. The overall does the same after a stretch of lost contact. The rule needs a
//   sighting in this process: after a restart the file's since stands (a fault three days old still says so).
// - since() answers from the last transition into the current level. The last transition per key is kept past
//   keepMs and max (a fault three days old must still say "since Monday" after a restart); recent() hides those
//   old markers by defaulting its window to keepMs. at_least: true means the state began at or before `since`
//   (it was already so when first seen).
// - The file is the memory across restarts: loaded on start, appended per event, rewritten (compacted) once it
//   has grown past twice `max` lines. A failed read or write (full disk, torn line) is logged and ignored, and
//   nothing here ever throws: history never stops the show.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { derive, FILES, intensityWord, awaited, changeLabel, confirmLimitS, EXPECT_S, calDryRun, calStep, CAL_STAGE_WORDS, MODAL_SOURCE_WORDS, fillingWords, looksWords } from '../public/model.js';
import { scrubCreds } from './scrub.mjs';
import { REQUEST_ID } from './applying.mjs';

export const KEEP_MS = 48 * 3600e3;
export const MAX_EVENTS = 5000;
export const BODY_MAX = 300;                 // an action's body, as JSON: a feed line, not a document
export const UNSEEN_GAP_MS = 5 * 60e3;        // unseen for longer than this, a state seen again is a first sighting again
export const RESTART_MARK_MS = 10 * 60e3;     // a piece last seen dark while TouchDesigner restarted, unseen since for longer: its mark lapses
export const SOURCES = ['mission control', 'studio chat'];
export const AWAIT_MS = 60 * 60e3;            // an action waits this long at most for its verdict (the server forgets an entry 10 min after its limit)
export const VERDICT_GRACE_MS = 60e3;         // a verdict is recorded at the next look at the lists (every 5 s): past its limit and this, none will come
export const VERDICTS_SERVED = 20;            // status.verdicts: the newest this many on changes that waited for one (a switch, …) …
export const VERDICTS_QUICK = 10;             // … and on the quick ones (ropes, panels, the year's: a page whose answer was lost) …
export const VERDICTS_MS = 12 * 3600e3;       // … from the last this long (a phone locked for an evening still learns its own)
const VERDICTS_KEPT = 500;                    // in memory, the newest this many of each kind (a burst of quick ones never evicts a switch's)
const SHOW_FIELDS = ['file', 'mode', 'season', 'ropes'];
/** The causes of a restart under way: TouchDesigner restarting on a file, then (its first check) coming up. */
const RESTARTISH = ['td-restarting', 'coming-up'];
/** The pieces dark while TouchDesigner restarts (model.js's td-restarting problem): their state after it is a new instance. */
const RESTARTED_PIECES = ['touchdesigner', 'seasons', 'ropes', 'hub75 panels'];
const BLIND = ['page', 'bitcube-offline', 'bitcube-unchecked', 'probe-stale', 'not-checked', 'check-failed'];   // causes that hide what is behind them
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x, max) => (typeof x === 'string' ? x.slice(0, max) : null);
/** The state a key is in is told by its latest event, so those are kept whatever their age (null: not a state). */
const keyOf = (ev) => (ev.kind === 'item' ? `item:${ev.id}` : ev.kind === 'show' ? `show:${ev.field}` : ['overall', 'calibration', 'action', 'verdict'].includes(ev.kind) ? ev.kind : null);
/** An item's reason, from its summary without the numbers that change with every answer ("Running slowly: 4 of 60 frames
 *  a second" and "…: 5 of 60…" are one reason; "Dark on purpose: sending black" is another). */
export const reasonOf = (summary) => String(summary ?? '').replace(/\d+(?:[.:]\d+)*\s*(?:s|min|h|days|%|W|GB)?(?![A-Za-z])/g, '#').trim();
const forS = (t, now) => Math.max(0, Math.round((now - t) / 1000));
/** Where a control was used: one of SOURCES, never a person's name (MD4: the chat is unattributed). */
const sourceOf = (s) => (/studio|chat|agent/i.test(String(s ?? '')) ? 'studio chat' : 'mission control');
/** Whether an action's entry waits for the server's verdict before it is done (status.confirmed / status.expired): a switch, a
 *  rebuild, a boot-file or lighting port change, a calibration's start, or any change bitcube didn't answer in time (maybe).
 *  Until the verdict, Recent says it was asked for, never that it happened (R8 #19, #28). */
export function awaitsVerdict(ev) {
  return !!ev && ev.kind === 'action' && typeof ev.applying_id === 'string' && (ev.ok !== false || ev.maybe === true)
    && (ev.maybe === true || awaited(ev.action, obj(ev.body)));     // model.js AWAITED: one table (CR8 #12)
}
const warn = (what, e) => console.warn(`history: ${what}: ${e?.message ?? e}`);

export class History {
  constructor({ file = null, now = () => Date.now(), keepMs = KEEP_MS, max = MAX_EVENTS } = {}) {
    Object.assign(this, { file, now, keepMs, max });
    this.events = [];            // oldest first, as in the file
    this.lines = 0;              // lines in the file, dropped ones included: decides when to compact
    this.torn = false;           // the file ends mid-line (the server died while writing): the next append starts a fresh line
    this.state = { overall: null, items: {}, show: {}, calibration: null, last_action: null };   // last known, each with its t
    this.knownAt = {};           // item id -> the observation it was last known in (in memory: after a restart, a gap)
    this.prevObs = null;         // the observation before this one
    this.restarted = new Map();  // piece id -> when it was last seen dark while TouchDesigner restarted (no lines of their own), until
                                 // seen fresh after it, or RESTART_MARK_MS without (CR7 #8)
    this.awaiting = new Map();   // applying_id -> { t, request_id, long }: actions whose entry has no verdict from the server yet (long:
                                 // the action waited for it, awaitsVerdict)
    this.verdictOf = new Map();  // applying_id -> { id, verdict, t, request_id, long }: every verdict kept, by id (recent())
    this.kept = { long: [], quick: [] };   // the same verdicts, oldest first, each kind its own newest VERDICTS_KEPT: verdicts() reads
                                           // only the newest of each, and a burst of quick changes never pushes out a switch's (CR8 #1, #14)
    this.actionOf = new Map();   // applying_id -> its action event, and verdictIn: -> its verdict event, while each is among the events:
    this.verdictIn = new Map();  // kept as events are recorded and pruned (#index), never rebuilt per recent() (CR9 #19); the feed splits
                                 // an action from its verdict exactly when that verdict's event is there to be its own line (CR9 #9)
    this.#load();
  }

  /** After every poll: records what changed since the last observation and returns it ([] most of the time). */
  observe(status, nowMs) {
    const t = num(nowMs) ?? this.now();
    const out = [];
    try {
      const st = obj(status) ?? {};
      const clock = num(st.now) ?? t;                      // the payload's own clock judges the verdict
      const m = derive({ ...st, now: clock }, clock);
      const rec = (ev) => out.push(this.#record({ t, ...ev }));

      // The verdict: level, cause or contact changed. A plain unknown (not checked yet) is no news; a stale one is.
      const o = m.overall, stale = !!o.stale, cause = o.cause ?? null, prev = this.state.overall?.last ?? null;
      // After a stretch where little could be seen (bitcube offline or unchecked, contact lost), a new cause may have begun
      // at any moment of it: its since is "at least" (a first sighting), never "for 1 min".
      const blind = !!prev && (prev.stale || BLIND.includes(prev.cause));
      if ((o.level !== 'unknown' || stale) && (!prev || prev.level !== o.level || prev.cause !== cause || prev.stale !== stale)) {
        // the verdict a restart interrupted (TouchDesigner restarting, then coming up), the same after it: no new fault (R8 #5). Only
        // for a cause the restart doesn't touch (a camera, the internet): one of TouchDesigner's own pieces still not OK after it is a
        // new instance, its since starting again, as its row's does (R7 #4, CR7 #8)
        const br = this.state.overall?.before_restart, items = m.problems.find((x) => x.id === cause)?.items ?? [];
        const back = !!br && !stale && cause != null && o.level !== 'ok' && !RESTARTISH.includes(cause) && br.level === o.level && br.cause === cause && t - br.at <= RESTART_MARK_MS
          && !items.some((id) => RESTARTED_PIECES.includes(id));
        rec({ kind: 'overall', level: o.level, cause, headline: o.headline, stale, lost: stale ? lostWho(m) : null, from: prev, ...(blind && !stale ? { gap: true } : {}), ...(back ? { back: true } : {}) });
      }
      // Each piece: unknown and muted (nothing to show) carry no knowledge, so they keep the last known level. A piece that
      // was not known in the previous observation changed at some moment of the gap: its since is "at least".
      // A restart's mark lapses when the piece hasn't been seen for RESTART_MARK_MS since: then it is a first sighting again
      // (the unseen-stretch rule below), never "still … for 1 min" as if it had been watched all along (CR7 #8)
      for (const [id, at] of this.restarted) if (t - at > RESTART_MARK_MS) this.restarted.delete(id);
      for (const it of m.items) {
        if (it.level === 'unknown' || it.muted) continue;
        // the ropes and panels in calibration patterns are the calibration's own line below, not news of their own: the
        // piece keeps its last level, so the run ending with everything back is no event either. They are still seen, so
        // a five-minute run is never an "unseen stretch" that restarts their since.
        // The same for a restart (a switch, a rebuild, TouchDesigner restarting on a file): the overall line says it once, so
        // TouchDesigner, the ropes, the panels and the year's page dark meanwhile are not lines of their own (R7 #23)
        if (it.cause === 'calibrating' || it.cause === 'td-restarting') { if (!it.stale) this.knownAt[it.id] = t; if (it.cause === 'td-restarting') this.restarted.set(it.id, t); continue; }
        const p = this.state.items[it.id], seen = this.knownAt[it.id];
        // after a restart, a piece still not OK in the same way is a new instance of it: "still needs attention", and its since
        // starts again there, as the band's does (never "for 12 min" beside a band that says 6). Only a fresh sighting uses the
        // mark: a last answer from a quiet source is not one, so the mark waits for the next (CR7 #8)
        const afterRestart = !it.stale && this.restarted.delete(it.id);
        if (afterRestart && !it.stale && p && p.level === it.level && it.level !== 'ok' && p.reason === reasonOf(it.summary)) {
          this.knownAt[it.id] = t;
          // kept (its since starts here), but when the piece is what the band is about the band's own line says it ("TouchDesigner is
          // running slowly: …"): Recent leaves this one out, never two lines for one moment (R10 #23)
          rec({ kind: 'item', id: it.id, from: p.level, to: it.level, summary: it.summary, still: true, ...(it.cause && it.cause === m.overall?.cause ? { banded: true } : {}) });
          continue;
        }
        const gap = !!p && (seen == null || (this.prevObs != null && seen < this.prevObs));
        if (!it.stale) this.knownAt[it.id] = t;          // a last answer from a quiet source is not a sighting
        // a new reason at the same level is news too ("Attention for 2 h" must never carry over from running slowly to dark
        // on purpose); not for OK, whose words change with every answer and whose since is never shown
        if (p && p.level === it.level && (it.level === 'ok' || p.reason === reasonOf(it.summary))) {
          // the same state seen again after a long unseen stretch: a first sighting again (see the rules above)
          if (it.level !== 'ok' && !it.stale && gap && seen != null && t - seen > UNSEEN_GAP_MS) {
            rec({ kind: 'item', id: it.id, from: p.level, to: it.level, summary: it.summary, gap: true, still: true });
          }
          continue;
        }
        rec({ kind: 'item', id: it.id, from: p?.level ?? null, to: it.level, summary: it.summary, ...(it.stale ? { stale: true } : {}), ...(gap ? { gap: true } : {}) });
      }
      this.prevObs = t;
      // The show's own moves; null (not known right now) keeps the last known value.
      const show = { file: m.show.file?.name, mode: m.show.mode?.id, season: m.show.season, ropes: m.show.ropes?.state === 'unknown' ? null : m.show.ropes?.state };
      for (const field of SHOW_FIELDS) {
        const to = str(show[field], 80), p = this.state.show[field];
        // the ropes in calibration patterns or dark while TouchDesigner restarts: the calibration's or the restart's own line
        if (to == null || to === 'calibrating' || to === 'restarting' || (p && p.value === to)) continue;
        rec({ kind: 'show', field, from: p?.value ?? null, to });
      }
      out.push(...this.judge(st, t));
      // The calibration job (lib/lights.mjs: the full check carries its progress file while one ran in the last 24 h).
      const cal = obj(obj(obj(st.probe)?.value)?.calibration);
      if (cal && (typeof cal.running === 'boolean' || typeof cal.stage === 'string')) {
        const running = cal.running === true, stage = str(cal.stage, 40), calStale = cal.stale === true, p = this.state.calibration;
        if (!p || p.running !== running || p.stage !== stage || p.stale !== calStale) {
          rec({ kind: 'calibration', running, stage, ok: typeof cal.ok === 'boolean' ? cal.ok : null, cancelled: cal.cancelled === true,
                mode: str(cal.mode, 20), error: str(scrubCreds(cal.error), 120), stale: calStale, from: p ? { running: p.running, stage: p.stage } : null });
        }
      }
    } catch (e) { warn('observe failed', e); }           // derive() never throws; belt and braces: history must not stop the server
    return out;
  }

  /** The server's verdict on every action whose entry has none yet (status.confirmed / status.expired keep it 10 min): kept once,
   *  with the history, so Last done, Recent and a page that slept past those 10 min still know it later (CR7 #5, R8 #0, #19). Run
   *  by observe() and before every answer that says it (/api/status, /api/history, the socket's status), so a line never says
   *  "Asked to …" once the lists say it is done. Returns the verdict events it recorded. Never throws. */
  judge(status, nowMs) {
    const out = [];
    try {
      const t = num(nowMs) ?? this.now(), st = obj(status) ?? {};
      for (const [id, w] of this.awaiting) if (t - w.t > AWAIT_MS) this.awaiting.delete(id);
      if (!this.awaiting.size) return out;
      // one look at each list (at most ENDED_MAX), only for the ids still waiting: no copy of either (CR8 #14)
      const found = [];
      for (const verdict of ['confirmed', 'expired']) {
        const list = st[verdict];
        if (!Array.isArray(list)) continue;
        for (const e of list) { const id = obj(e)?.id; if (typeof id === 'string' && this.awaiting.has(id) && !found.some((f) => f.id === id)) found.push({ id, verdict }); }
      }
      for (const { id, verdict } of found) {
        const w = this.awaiting.get(id);
        out.push(this.#record({ kind: 'verdict', t, applying_id: id, ...(w.request_id ? { request_id: w.request_id } : {}), verdict, ...(w.long ? { awaited: true } : {}) }));
      }
    } catch (e) { warn('judge failed', e); }
    return out;
  }

  /** A control was used, from mission control or the studio chat: kept so "was that on purpose?" has an answer. The body is
   *  what the caller checked (server.mjs passes the whitelist's fields only); a login in it or in the note is scrubbed anyway. */
  action(entry) {
    const e = obj(entry) ?? {};
    const label = typeof e.label === 'string' && e.label.trim() ? scrubCreds(e.label.trim()).slice(0, 80) : null;
    return this.#record({ kind: 'action', t: num(e.t) ?? this.now(), action: str(e.action == null ? 'unknown' : String(e.action), 40) || 'unknown',
                          body: smallBody(scrubCreds(e.body)), ok: e.ok !== false, note: e.note == null ? null : scrubCreds(String(e.note)).slice(0, 200),
                          source: sourceOf(e.source), ...(label ? { label } : {}), ...(e.maybe === true ? { maybe: true } : {}),
                          // the change's entry in status.applying: while it is still there (confirming), Last done says "Last sent"
                          ...(typeof e.applying_id === 'string' && e.applying_id ? { applying_id: e.applying_id.slice(0, 40) } : {}),
                          // the page's own id for the press (R8 #2): a page whose answer was lost finds its verdict by it
                          ...(typeof e.request_id === 'string' && REQUEST_ID.test(e.request_id) ? { request_id: e.request_id } : {}) });
  }

  /** When the current level began. `level` is the last KNOWN level: while the page's model says unknown (not checked,
   *  behind an offline bitcube) this still answers with the state before that, so show it as "last known" or not at all. */
  since(id, nowMs) {
    const s = id === 'overall' ? this.state.overall : this.state.items[id];
    if (!s) return null;
    const now = num(nowMs) ?? this.now();
    return id === 'overall' ? { level: s.level, cause: s.cause, stale: s.stale, since: s.t, for_s: forS(s.t, now), at_least: s.at_least }
                            : { level: s.level, since: s.t, for_s: forS(s.t, now), at_least: s.at_least };
  }

  sinceShow(field, nowMs) {
    const s = this.state.show[field];
    return s ? { value: s.value, since: s.t, for_s: forS(s.t, num(nowMs) ?? this.now()), at_least: s.at_least } : null;
  }

  /** Newest first (the last recorded first among equal times). kinds: one kind or a list (default: every kind but the
   *  verdicts, which are bookkeeping); sinceT: strictly after that time (default: the keepMs window, which hides the old markers
   *  kept for since()). */
  recent({ limit = 50, kinds, sinceT } = {}) {
    const from = num(sinceT) ?? this.now() - this.keepMs;
    const ks = kinds == null ? null : new Set([].concat(kinds));
    const out = [], now = this.now();
    // the feed (every kind: Recent): a change that waited for the server's verdict keeps "Asked to …" at its time, and the verdict is
    // its own line at its own time, so the list never says it was done before it began (R9 #20); asked for by kind, as before
    const split = ks == null;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (!(e.t > from)) continue;
      if (split && e.kind === 'verdict') {
        const a = this.actionOf.get(e.applying_id);
        // a calibration start that showed its run: the run's own line ("The calibration started: …") carries the verdict (R10 #23)
        if (a?.action === 'calibrate' && e.verdict === 'confirmed') continue;
        if (a && awaitsVerdict(a)) out.push({ kind: 'verdict', t: e.t, applying_id: e.applying_id, verdict: e.verdict, action: a.action, source: a.source,
                                              label: typeof a.label === 'string' && a.label ? a.label : changeLabel(a.action, obj(a.body) ?? {}) });
        continue;
      }
      if (!(ks ? ks.has(e.kind) : e.kind !== 'verdict')) continue;
      // the band's "Calibrating the lights: …" beside the run's own lines says the same event again (R10 #23)
      if (split && e.kind === 'overall' && e.cause === 'calibrating' && !e.stale) continue;
      // and a piece "still" not OK after a restart, at the moment the band's line about the same cause says it (R10 #23)
      if (split && e.kind === 'item' && e.banded) continue;
      out.push(this.#judged(e, now, split));
    }
    return out.sort((a, b) => b.t - a.t).slice(0, Math.max(0, num(limit) ?? 50));
  }

  /** An action with the server's verdict on its entry, once there is one, its words waiting for it (R8 #19); without one, pending:
   *  true only while one can still come (CR8 #7): it was sent since this server started (still awaiting: a restart forgets what
   *  was being applied, #load), and it is within its confirm limit from its answer (model.js confirmLimitS, as lib/applying.mjs
   *  counts it) and VERDICT_GRACE_MS. One that never got a verdict is "Sent …", never "Asked to …" forever. Anything else as is. */
  #judged(e, now, split = false) {
    if (!e || e.kind !== 'action' || typeof e.applying_id !== 'string') return e;
    // its verdict: the one kept by id (the newest VERDICTS_KEPT), else its own event among the events (kept 48 h)
    const ve = this.verdictIn.get(e.applying_id), v = this.verdictOf.get(e.applying_id)?.verdict ?? ve?.verdict;
    // split: its verdict is a line of its own in the feed, so this one says only that it was asked for (R9 #20); decided by that
    // event being there, as recent() decides the verdict's line, never by the capped map (CR9 #9)
    if (v) return { ...e, verdict: v, ...(split && ve && awaitsVerdict(e) ? { split: true } : {}) };
    const pending = awaitsVerdict(e) && this.awaiting.has(e.applying_id) && now - e.t <= confirmLimitS(EXPECT_S[e.action]) * 1000 + VERDICT_GRACE_MS;
    return pending ? { ...e, pending: true } : e;
  }

  /** The server's verdicts kept, newest first: [{ id, request_id?, verdict }] for the last `limit` changes that waited for one (a
   *  switch, a rebuild, a boot-file or lighting port change, a calibration start, a maybe: whatever came after them, CR8 #1) and
   *  the last `quick` others, within `withinMs` (status.verdicts: a phone that slept past status.confirmed's 10 min, or a restart
   *  of the server, still learns the verdict on its own change, R8 #0). Reads only what it serves, from the newest back (CR8 #14). */
  verdicts(nowMs, { limit = VERDICTS_SERVED, quick = VERDICTS_QUICK, withinMs = VERDICTS_MS } = {}) {
    const now = num(nowMs) ?? this.now();
    const newest = (list, n) => {
      const out = [];
      for (let i = list.length - 1; i >= 0 && out.length < n; i--) { if (now - list[i].t > withinMs) break; out.push(list[i]); }
      return out;
    };
    const a = newest(this.kept.long, limit), b = newest(this.kept.quick, quick), out = [];
    for (let i = 0, j = 0; i < a.length || j < b.length;) {      // both newest first: merged, the later of two equal times first
      const v = j >= b.length || (i < a.length && a[i].t >= b[j].t) ? a[i++] : b[j++];
      out.push({ id: v.id, ...(v.request_id ? { request_id: v.request_id } : {}), verdict: v.verdict });
    }
    return out;
  }

  /** For GET /api/history: since when, per piece and for the show, the last thing done, and how much is kept. */
  summary(nowMs) {
    const now = num(nowMs) ?? this.now();
    const items = Object.fromEntries(Object.keys(this.state.items).map((id) => [id, this.since(id, now)]));
    const show = Object.fromEntries(Object.keys(this.state.show).map((f) => [f, this.sinceShow(f, now)]));
    return { since: { overall: this.since('overall', now), items, show }, last_action: this.#judged(this.state.last_action, now), count: this.events.length };
  }

  // ---- state, from events (the same code replays the file at start) ------------------------------------------
  #apply(ev) {
    const S = this.state;
    switch (ev.kind) {
      case 'overall': {
        // A stale unknown is lost contact, not a new state of the show: level, cause and since carry on through it. But the
        // same verdict seen again after a long blind stretch is a first sighting again (the rules above): since restarts.
        const p = S.overall, known = ev.level !== 'unknown' || !p, same = p && p.level === ev.level && p.cause === (ev.cause ?? null);
        const blindNow = !!ev.stale || BLIND.includes(ev.cause);
        const longGap = !!p && ev.gap === true && typeof p.blind_since === 'number' && ev.t - p.blind_since > UNSEEN_GAP_MS;
        // what a restart interrupted (R8 #5): remembered as TouchDesigner starts restarting, kept through coming up, and restored
        // (its since too) when the same verdict is back after it; anything else ends it. Only a fault (not OK, a cause): OK after a
        // restart is OK since the restart, never "as before" with its since from before it, which would hide the restart (CR8 #8)
        const br0 = p?.before_restart ?? null;
        const fault = !!p && p.level !== 'ok' && p.cause != null && !RESTARTISH.includes(p.cause);
        const before = ev.cause === 'td-restarting' ? br0 ?? (fault ? { level: p.level, cause: p.cause, t: p.t, at_least: p.at_least, at: ev.t } : null)
          : ev.cause === 'coming-up' || ev.stale ? br0 : null;
        const base = ev.back === true && br0 ? { level: br0.level, cause: br0.cause, t: br0.t, at_least: br0.at_least }
          : known && !same ? { level: ev.level, cause: ev.cause ?? null, t: ev.t, at_least: ev.from == null || ev.gap === true }
          : known && longGap ? { level: p.level, cause: p.cause, t: ev.t, at_least: true }
          : { level: p.level, cause: p.cause, t: p.t, at_least: p.at_least };
        S.overall = { ...base, stale: !!ev.stale, lost: ev.lost ?? null, last: { level: ev.level, cause: ev.cause ?? null, stale: !!ev.stale, lost: ev.lost ?? null },
                      blind_since: blindNow ? (typeof p?.blind_since === 'number' ? p.blind_since : ev.t) : null, before_restart: before };
        break;
      }
      case 'item': if (typeof ev.id === 'string') S.items[ev.id] = { level: ev.to, reason: reasonOf(ev.summary), t: ev.t, at_least: ev.from == null || ev.gap === true }; break;
      case 'show': if (typeof ev.field === 'string') S.show[ev.field] = { value: ev.to, t: ev.t, at_least: ev.from == null }; break;
      case 'calibration': S.calibration = { running: ev.running === true, stage: ev.stage ?? null, stale: ev.stale === true, t: ev.t }; break;
      case 'action':
        S.last_action = ev;
        // every change with an entry gets the server's verdict kept (a quick one too: Last done reads it, CR7 #5)
        if (typeof ev.applying_id === 'string') this.awaiting.set(ev.applying_id, { t: ev.t, request_id: ev.request_id ?? null, long: awaitsVerdict(ev) });
        break;
      case 'verdict': {
        const id = ev.applying_id;
        if (typeof id !== 'string' || !['confirmed', 'expired'].includes(ev.verdict)) break;
        // a change that waited for it (a line written before the flag: its action, still waiting, says so)
        const long = ev.awaited === true || this.awaiting.get(id)?.long === true;
        this.awaiting.delete(id);
        const old = this.verdictOf.get(id);
        if (old) { const l = this.kept[old.long ? 'long' : 'quick'], i = l.lastIndexOf(old); if (i >= 0) l.splice(i, 1); }
        const v = { id, verdict: ev.verdict, t: ev.t, request_id: typeof ev.request_id === 'string' ? ev.request_id : null, long };
        this.verdictOf.set(id, v);
        const list = this.kept[long ? 'long' : 'quick'];
        list.push(v);
        if (list.length > VERDICTS_KEPT) this.verdictOf.delete(list.shift().id);
        if (S.last_action && S.last_action.applying_id === id) S.last_action = { ...S.last_action, verdict: ev.verdict };
        break;
      }
    }
  }

  // ---- the file --------------------------------------------------------------------------------------------
  #load() {
    if (!this.file) return;
    let raw = '';
    try { raw = readFileSync(this.file, 'utf8'); } catch { try { mkdirSync(dirname(this.file), { recursive: true }); } catch { /* the first write says so */ } return; }
    const lines = raw.split('\n').filter(Boolean);
    this.lines = lines.length;
    this.torn = raw.length > 0 && !raw.endsWith('\n');
    for (const l of lines) {
      try { const ev = JSON.parse(l); if (obj(ev) && num(ev.t) != null && typeof ev.kind === 'string') { this.events.push(ev); this.#index(ev); this.#apply(ev); } }
      catch { /* a torn or hand-edited line: skipped, never fatal */ }
    }
    // what was being applied before this start can't get a verdict now: the server keeps its entries in memory only (CR8 #7)
    this.awaiting.clear();
    this.#prune(this.now());
    if (this.lines > 2 * this.max) this.#compact();
  }

  #record(ev) {
    this.events.push(ev);
    this.#index(ev);
    this.#apply(ev);
    this.#prune(this.now());                 // events are rare (transitions, not polls), so a scan per event costs nothing
    if (!this.file) return ev;
    try {
      appendFileSync(this.file, (this.torn ? '\n' : '') + JSON.stringify(ev) + '\n');
      this.torn = false;
      this.lines++;
      if (this.lines > 2 * this.max) this.#compact();
    } catch (e) { warn(`could not write ${this.file}`, e); }
    return ev;
  }

  /** Drop what is older than keepMs and beyond max, keeping the latest event per key: those say what state things are in. */
  #prune(now) {
    const latest = new Map();
    for (const ev of this.events) { const k = keyOf(ev); if (k) latest.set(k, ev); }
    const keep = new Set(latest.values());
    const fresh = this.events.filter((ev) => keep.has(ev) || now - ev.t <= this.keepMs);
    let extra = fresh.length - keep.size - this.max;      // non-markers beyond max go, oldest first
    const before = this.events;
    this.events = extra > 0 ? fresh.filter((ev) => { if (keep.has(ev) || extra <= 0) return true; extra--; return false; }) : fresh;
    if (this.events.length !== before.length) { const still = new Set(this.events); for (const ev of before) if (!still.has(ev)) this.#index(ev, false); }
  }

  /** recent()'s index of the actions and verdicts among the events, by their entry's id (CR9 #19): added as an event is recorded or
   *  loaded, dropped as it is pruned. */
  #index(ev, add = true) {
    const id = ev?.applying_id, map = ev?.kind === 'action' ? this.actionOf : ev?.kind === 'verdict' ? this.verdictIn : null;
    if (!map || typeof id !== 'string') return;
    if (add) map.set(id, ev);
    else if (map.get(id) === ev) map.delete(id);
  }

  /** Rewrite the file as what is in memory, so it stays near max lines however long the server runs. */
  #compact() {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, this.events.map((e) => JSON.stringify(e)).join('\n') + (this.events.length ? '\n' : ''));
      renameSync(tmp, this.file);
      this.lines = this.events.length;
      this.torn = false;
    } catch (e) { warn(`could not compact ${this.file}`, e); }
  }
}

/** Which source went quiet, in plain words: the stale cause names it, else the sources do. */
function lostWho(m) {
  const BY = { 'bitcube-unchecked': 'bitcube', 'probe-stale': 'bitcube', 'seasons-stale': "the river's year page", 'modal-stale': "Dave's agent" };
  if (BY[m.overall.cause]) return BY[m.overall.cause];
  const s = m.sources ?? {}, bitcubeDown = m.items.some((x) => x.id === 'bitcube' && x.level === 'down');
  if (s.bitcube?.stale || (s.probe?.stale && !bitcubeDown)) return 'bitcube';
  if (s.seasons?.stale) return "the river's year page";
  if (s.modal?.stale) return "Dave's agent";
  return 'bitcube';
}

/** An action's body as plain JSON that fits BODY_MAX: whole when small, else top-level scalars with strings shortened,
 *  arrays and objects as counts, cut off with _more: true. Never throws (a body JSON cannot hold becomes null). */
function smallBody(body) {
  let b;
  try { b = body == null ? null : JSON.parse(JSON.stringify(body)); } catch { return null; }
  if (b == null) return null;
  const fits = (x) => JSON.stringify(x).length <= BODY_MAX;
  if (fits(b)) return b;
  if (typeof b === 'string') { let s = b; while (s.length && !fits(s)) s = s.slice(0, Math.floor(s.length * 0.8)); return s; }
  if (Array.isArray(b)) return `[${b.length} items]`;
  if (typeof b !== 'object') return String(b).slice(0, 80);
  const out = {};
  for (const [k, v] of Object.entries(b)) {
    const small = typeof v === 'string' ? v.slice(0, 60) : v == null || typeof v === 'number' || typeof v === 'boolean' ? v
      : Array.isArray(v) ? `[${v.length} items]` : `{${Object.keys(v).length} keys}`;
    if (!fits({ ...out, [k]: small, _more: true })) { out._more = true; break; }
    out[k] = small;
  }
  return out;
}

// ---- words for a feed -------------------------------------------------------------------------------------------
// Short names for the pieces (model.js's names carry a parenthesis for the details drawer); plural ones are marked.
const WHO = { bitcube: ['bitcube'], touchdesigner: ['TouchDesigner'], ropes: ['The ropes', true], 'rope box 1': ['Rope box 1'], 'rope box 2': ['Rope box 2'],
  'hub75 panels': ['The panels', true], seasons: ["The river's year"], 'gallery camera': ['The gallery camera'], 'river camera': ['The river camera'],
  router: ['The router'], internet: ['The internet at Gray Area'], 'modal agent': ["Dave's agent"], 'modal link': ['Clips to Dave'],
  recorder: ['The river recorder'], 'people counter': ['The people counter'], 'mission control': ['Mission control'] };
// How a summary's opening reads after the name, as a verb phrase ("Not running on bitcube" -> "TouchDesigner stopped running
// on bitcube"); the rest of the summary follows unchanged. A replacement starting with '=' is the whole sentence.
// Summaries matched by none read "<name> went down: <summary>" or "<name> needs attention: <summary>".
const SAID = [
  // the row's source line says from where, Recent has none: it says so (R10 #33)
  [/^Offline: not reachable$/, 'went offline: not reachable from the Mac mini'], [/^Offline\b/, 'went offline'], [/^Reachable, but/, 'is reachable, but'], [/^Answers, but/, 'answers, but'],
  [/^Not started yet/, "hasn't started yet"], [/^Not running\b/, 'stopped running'], [/^Restarting\b/, 'is restarting'],
  [/^Frozen\b/, 'froze'], [/^Running slowly/, 'is running slowly'], [/^Not served while/, 'is not served while'],
  [/^Page not answering/, 'page stopped answering'], [/^Page not served/, 'page is not served'], [/^Not answering\b/, 'stopped answering'],
  [/^Unreachable\b/, 'became unreachable'], [/^Dark while/, 'are dark while'], [/^Not being driven/, 'are not being driven'],
  [/^Not reaching the lights/, 'are not reaching the lights'], [/^Sender can't open its port/, "are not getting the river: the sender can't open its port"],
  [/^Sender switched off/, 'have their sender switched off'], [/^Dark on purpose/, 'are dark on purpose'],
  [/^Both rope boxes are silent: the ropes are dark$/, 'are dark: both rope boxes are silent'],
  [/^(Rope box \d) \((ropes [\d–-]+)\) silent: those ropes may be dark$/, (_m, box, ropes) => `=${cap(ropes)} may be dark: ${box.toLowerCase()} is silent`],
  [/^Driven at only/, 'are driven at only'], [/^No panel sender/, 'have no sender'], [/^Panel sender present; dark while/, 'are dark while'],
  [/^Panel sender present, but the picture is frozen/, 'hold a frozen picture'], [/^Panel sender present, but the picture is gone/, 'show nothing'],
  [/^Panel sender present; this file has no panel output/, 'have no picture: this show file has no panel output'],
  [/^Panel sender present, but the panel output is off/, 'are switched off in the show file'], [/^Panel sender present, brightness 0/, 'are at brightness 0'],
  [/^No internet(?: from bitcube)?$/, 'is down: bitcube cannot reach it'], [/^Reports a problem/, 'reports a problem'], [/^Hasn't (?:ticked|updated)/, "hasn't updated"],
  [/^Clips failing for both cameras/, 'is failing: no clips from either camera'],
  [/^(Gallery|River) clips failing/, (_m, cam) => `=${cam} clips to Dave are failing`],
  [/^Sync has seen no new state/, 'has seen no new state from Dave'], [/^Current run can't/, "can't"],
];
/** A piece still not OK in the same way after a restart, in its own words where it is a deliberate state rather than a fault: "The
 *  ropes are still dark on purpose", never "still need attention" (R8 #25). A real fault keeps "still needs attention" (a warning)
 *  or "is still down". */
const STILL = [
  [/^Dark on purpose\b/, 'are still dark on purpose'], [/^At 0 %/, 'are still at 0 %'], [/^Panel sender present, but the panel output is off/, 'are still switched off in the show file'],
];
const STAGE = { ...CAL_STAGE_WORDS, done: 'done' };   // one set of stage words with the band and Lights (model.js)
const MODE_WHY = { automatic: 'the clock turns the year by itself', dynamic: 'the people in the room steer the year', manual: 'someone is steering the year by hand' };
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
const lc = (s) => (!s || /^(?:[A-Z][a-z]+[A-Z]|[A-Z]{2}|Dave|Modal|Gray|Mac |Wi-Fi|Starlink|Colorlight|Ethernet|Tailscale)/.test(s) ? s : s[0].toLowerCase() + s.slice(1));   // keep proper nouns
/** A show file in glossary words; an unlisted one by its name without the extension (never "toe" in a feed). */
const fileLabel = (name) => FILES[name]?.label ?? (typeof name === 'string' && name ? `the show file ${name.replace(/\.toe$/i, '')}` : 'a show file');
/** One sentence keeps one colon: later ones (a summary's own) become semicolons. Clock times (02:43) have no space. */
const oneColon = (s) => { const i = s.indexOf(': '); return i < 0 ? s : s.slice(0, i + 2) + s.slice(i + 2).replace(/: /g, '; '); };

/** A stored summary without the parts that were only true at that moment ("last clip 21 s ago", "up 3 h"): the feed shows
 *  its own "12 min ago" beside it, and a frozen age would contradict it. */
function timeless(s) {
  return ageless(String(s ?? '').split(/;\s*/).map((x) => x.replace(/\s*\((?:last|up)\b[^()]*\)/gi, '').trim())
    .filter((x) => x && !/\bago\b|^up \d/i.test(x)).join('; '));
}
// A duration as model.js dur() writes it ("36 s", "4 min", "9 h", "2 days").
const DUR = String.raw`\d+(?:\.\d+)? ?(?:s|min|h|days?)`;
const AGES = [new RegExp(String.raw`\s*\bfor (?:about |over |at least )?${DUR}(?: more)?(?![\w%])`, 'gi'),     // "for about 36 s more", "for 9 h"
              new RegExp(String.raw`\s*\b(?:about |over )?${DUR} ago(?![\w%])`, 'gi'),                           // "restarted 6 min ago"
              new RegExp(String.raw`(\bmissed) ${DUR} of\b`, 'gi')];                                                // "it has missed 9 h of daytime updates"
/** A headline or summary without the ages that were only true when it was recorded ("the ropes are in patterns for about 36 s
 *  more", "hasn't updated for 9 h", "bitcube restarted 6 min ago"): Recent shows when each line happened, never how old
 *  something was then (mission-ui.md "Since when"). */
export function ageless(s) {
  let out = String(s ?? '');
  for (const re of AGES) out = out.replace(re, (m, missed) => (typeof missed === 'string' && /^missed$/i.test(missed) ? missed : ''));
  return out.replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
}
function itemWords(ev) {
  const [name, plural] = WHO[ev.id] ?? [cap(String(ev.id ?? 'something'))];
  const s = timeless(String(ev.summary ?? '').trim());
  if (ev.still && ev.to !== 'ok') {
    const own = ev.to === 'warning' ? STILL.find(([re]) => re.test(s)) : null;
    if (own) return `${name} ${s.replace(own[0], own[1])}`;
    return ev.to === 'down' ? `${name} ${plural ? 'are' : 'is'} still down${s ? `: ${lc(s)}` : ''}`
      : `${name} still ${plural ? 'need' : 'needs'} attention${s ? `: ${lc(s)}` : ''}`;
  }
  if (ev.to === 'ok') return `${name} ${plural ? 'are' : 'is'} ${ev.from == null ? 'fine' : ev.from === 'down' ? 'back' : 'OK again'}${s ? `: ${lc(s)}` : ''}`;
  const said = SAID.find(([re]) => re.test(s));
  if (said) { const r = s.replace(said[0], said[1]); return r.startsWith('=') ? r.slice(1) : `${name} ${r}`; }
  const verb = ev.to === 'down' ? 'went down' : ev.to === 'warning' ? (plural ? 'need attention' : 'needs attention') : "can't be checked";
  return `${name} ${verb}${s ? `: ${lc(s)}` : ''}`;
}

function showWords(ev) {
  const first = ev.from == null;
  switch (ev.field) {
    case 'file': return first ? `TouchDesigner is showing ${fileLabel(ev.to)}` : `TouchDesigner switched from ${fileLabel(ev.from)} to ${fileLabel(ev.to)}`;
    case 'mode': return `${first ? 'The year runs in' : "The year's mode changed to"} ${ev.to}${first ? ' mode' : ''}${MODE_WHY[ev.to] ? `: ${MODE_WHY[ev.to]}` : ''}`;
    case 'season': return first ? `The season is ${ev.to}` : `The season turned to ${ev.to}`;
    case 'ropes': return { river: first ? 'The ropes show the river' : 'The ropes show the river again', dark: first ? 'The ropes are dark on purpose' : 'The ropes went dark on purpose',
                           'not-reaching': first ? 'The ropes are not getting the river' : 'The ropes stopped getting the river',
                           'not-driven': first ? 'The ropes are not being driven' : 'The ropes stopped being driven',   // TouchDesigner frozen or not running (R9 #36)
                           restarting: 'The ropes are dark while TouchDesigner restarts',
                           test: 'The ropes run the test pattern' }[ev.to] ?? `The ropes are ${ev.to}`;
    default: return `${cap(String(ev.field))} changed to ${ev.to}`;
  }
}

function calibrationWords(ev) {
  // what a run is called and what its stages are: one rule with the band and Lights (model.js calDryRun, calStep: CR9 #7, #8, #16)
  const dry = calDryRun(ev);
  const what = dry ? 'A dry run' : ev.mode === 'decode-only' ? 'A calibration from earlier photos' : 'The calibration';
  const stage = STAGE[ev.stage] ?? null;
  if (ev.stale) return `${what} stopped answering: its process is gone`;
  // a dry run touches no lights and no camera: its stages are steps, never "photographing the ropes" (R9 #19)
  const step = calStep(ev.stage);
  if (ev.running && !ev.from?.running) return `${what} started${!dry && stage && stage !== 'done' ? `: ${stage}` : ''}`;
  if (ev.running) return dry ? `${what} is ${step ? `at ${step.words}` : 'running'}` : `${what} is ${stage ?? 'running'}`;
  if (ev.cancelled) return `${what} was stopped`;
  if (ev.ok === false) return `${what} failed`;
  if (ev.from?.running || ev.stage === 'done') return `${what} finished`;
  return `${what} is not running`;
}

/** [past, infinitive, what] for an action, from its body (also lib/steps.mjs: a change the agent asks mission control for). */
export function actionPhrase(ev) {
  const b = obj(ev.body) ?? {};
  const pct = num(Number(b.brightness)) != null ? `${Math.round(Number(b.brightness) * 100)} %` : 'a new level';
  switch (ev.action) {
    case 'mode': return ['Set', 'set', `the year's mode to ${b.mode ?? 'a new mode'}`];
    case 'target': {     // the band's words: "summer, strong"
      const x = Number(b.intensity), w = b.intensity != null && b.intensity !== '' && Number.isFinite(x) ? intensityWord(Math.min(1, Math.max(0, x))) : null;
      return ['Set', 'set', `the target to ${[b.season, w].filter(Boolean).join(', ') || 'a new value'}`]; }
    case 'rules': { const n = Object.keys(obj(b.rules) ?? {}).length; return ['Changed', 'change', n ? `${n} of the year's rules` : "the year's rules"]; }
    case 'rules-reset': return ['Reset', 'reset', "the year's rules"];
    case 'ropes': return ['Turned', 'turn', b.dark === true ? 'the ropes dark' : 'the ropes on'];   // as planControl: only a real true goes dark
    case 'hub75': return ['Set', 'set', `the panel brightness to ${pct}`];
    case 'overlay': return ['Set', 'set', `Dave's overlay to ${Math.round(Number(b.strength) * 100)} %${b.framing ? '; river framing: ' + b.framing : ''}${b.screens ? '; screens: ' + b.screens.mode + (b.screens.mode === 'cycle' ? ', ' + b.screens.hold + ' s per look' + (b.screens.offset !== undefined ? ', ' + b.screens.offset + ' s between screens' : '') : '') : ''}`];
    case 'modalinput': return ['Set', 'set', `the Modal input to ${MODAL_SOURCE_WORDS[b.source]?.label ?? 'a new source'}${b.source !== 'off' && Number.isFinite(Number(b.strength)) ? ` at ${Math.round(Number(b.strength) * 100)} %` : ''}`];
    case 'remembered-zones': {
      const h = Number.isFinite(Number(b.pool_height_m)) && b.pool_height_m != null ? `, the pool line at ${Number(b.pool_height_m).toFixed(2)} m` : '';
      return b.light === 'pool' ? ['Lit', 'light', `the pool${h}`] : b.light === 'eddies' ? ['Lit', 'light', `the eddies${h}`] : ['Put', 'put', `the pool and eddies back to the show${h}`];
    }
    case 'filling': return ['Set', 'set', `the filling glass to ${fillingWords(b) ?? 'new settings'}`];
    case 'remembered-opening': return ['Switched', 'switch', `opening night ${b.on === true ? 'on' : 'off'}`];
    case 'remembered-screens': return ['Set', 'set', `the river video under the particles to ${Number.isFinite(Number(b.video)) && b.video != null ? Math.round(Number(b.video) * 100) + ' %' : 'a new strength'}`];
    case 'looks': return ['Set', 'set', `the looks to ${looksWords(b) ?? 'a new choice'}`];
    case 'test': return b.on === true ? ['Started', 'start', 'the test pattern on the ropes and panels'] : ['Stopped', 'stop', 'the test pattern'];
    // a switch to the file TouchDesigner was running is the button's "Restart on …" (its label says so, model.js changeLabel)
    case 'switch': return /^the restart on /.test(String(ev.label ?? '')) ? ['Restarted', 'restart', `TouchDesigner on ${fileLabel(b.file)}`]
      : ['Switched', 'switch', `TouchDesigner to ${fileLabel(b.file)}`];
    case 'bootfile': return ['Set', 'set', `the default to ${fileLabel(b.file)}`];
    case 'lightsroute': return ['Moved', 'move', `the lighting network to ${b.route === 'router' ? 'the spare router port' : "bitcube's LIGHTS port"}`];
    case 'check': return ['Ran', 'run', 'the full check of bitcube'];
    case 'rebuild': return ['Rebuilt', 'rebuild', `${fileLabel(b.file)} with the new LED map`];
    // Stop, as the page's button says it; a dry run by its own name, its Stop too (R7 #19, #20, R8 #21: the server records which run it stopped)
    case 'calibrate': return b.action === 'cancel' ? ['Stopped', 'stop', b.dry_run === true ? 'the dry run' : 'the calibration'] : b.action === 'status' ? ['Checked', 'check', 'the calibration']
      : ['Started', 'start', b.dry_run === true ? 'a dry run' : `a calibration${b.decode_only ? ' from earlier photos' : ''}`];   // as planCalibrate
    default: return ['Used', 'use', `the "${ev.action ?? 'unknown'}" control`];
  }
}
/** Why a control failed, in plain words (mission.mjs's error strings name the plumbing); null when it has none to offer. */
function plainNote(note) {
  const n = String(note ?? '').trim();
  if (!n) return null;
  if (/ssh|probe|no answer/i.test(n)) return 'bitcube did not answer';
  if (/timeout|too long|aborted/i.test(n)) return 'it took too long';
  if (/fetch failed|ECONN|HTTP \d/i.test(n)) return 'the page did not answer';
  return /\b(fps|tcp|vnc|rtsp|psac10|oserror|art-?net|wmi|json|undefined|null|NaN|epoch|toe)\b/i.test(n) ? null : lc(n);
}

/** Events as a feed shows them (GET /api/history, the menu's Recent): each with its words, and never the same words twice at one
 *  moment (the verdict and the piece that caused it can say the same thing: "TouchDesigner is restarting on the river's year"
 *  once, R7 #23). Any order; the first of two equal lines is kept. */
export function feed(events) {
  const out = [], said = new Set();     // t|words: one look per event, never a scan of what is already out (CR7 #14)
  for (const ev of Array.isArray(events) ? events : []) {
    const words = describeEvent(ev), k = `${ev?.t}|${words}`;
    if (said.has(k)) continue;
    said.add(k);
    out.push({ ...ev, words });
  }
  return out;
}

/** One plain sentence for a feed; never throws. */
export function describeEvent(ev) {
  const e = obj(ev);
  if (!e) return '';
  try {
    let line;
    switch (e.kind) {
      case 'overall': {
        const who = e.lost ?? 'bitcube';
        const head = ageless(e.headline) || `The verdict is ${e.level ?? 'unknown'}`;
        if (e.stale) {
          const same = e.from && e.from.level === e.level && e.from.cause === (e.cause ?? null);
          line = e.level === 'unknown' || same ? `Lost contact with ${who}` : `${head} (and no word from ${who})`;
        } else line = e.from?.stale ? `Back in touch with ${e.from.lost ?? 'bitcube'}: ${lc(head)}`
          : e.back === true ? `After the restart, as before: ${lc(head)}`     // no new fault: the one a restart interrupted (R8 #5)
          : head;
        break;
      }
      case 'item': line = itemWords(e); break;
      case 'show': line = showWords(e); break;
      case 'calibration': line = calibrationWords(e); break;
      // the server's verdict on a change that waited for it, at its own time (the feed: R9 #20)
      case 'verdict': line = typeof e.label === 'string' && e.label ? (e.verdict === 'confirmed' ? `bitcube showed ${e.label}` : `bitcube didn't show ${e.label} in time`) : 'Something happened'; break;
      case 'action': {
        const [past, inf, what] = actionPhrase(e), from = `from ${e.source === 'studio chat' ? 'the studio chat' : 'mission control'}`;
        // a change done only on the server's verdict (awaitsVerdict) is never said done from its answer alone: "Asked to …" while
        // the verdict can still come (pending), then done, or "… but bitcube didn't show it in time" (R8 #19, #28); one that never
        // got a verdict (from before a restart of the server, or past its limit) "Sent <its name> …": neither waiting nor done
        // (CR8 #7). recent() and summary() put the verdict, or pending, on it
        // one bitcube didn't answer in time is asked for too, in the contract's words, until its verdict; bitcube never answered it,
        // a later reading showed it (R9 #21). split: the feed says the verdict as its own line (R9 #20)
        const waits = awaitsVerdict(e), asked = `Asked to ${inf} ${what} ${from}`;
        const name = typeof e.label === 'string' && e.label ? e.label : changeLabel(e.action, obj(e.body) ?? {});
        line = e.maybe === true ? (e.split ? `${asked}: no answer in time`
            : e.verdict === 'confirmed' ? `${past} ${what} ${from} (bitcube showed it, though it didn't answer in time)`
            : e.verdict === 'expired' ? `${asked}: no answer in time, and bitcube didn't show it`
            : e.pending === true ? `${asked}: no answer in time, waiting for bitcube to show whether it happened`
            : `Sent ${name} ${from}: no answer in time, so it may or may not have happened`)
          : e.ok === false ? `Tried to ${inf} ${what} ${from}, but ${plainNote(e.note) ?? 'it failed'}`
          : waits && e.split ? asked
          : waits && e.verdict === 'expired' ? `${asked}, but bitcube didn't show it in time`
          : waits && e.verdict !== 'confirmed' ? (e.pending === true ? asked : `Sent ${name} ${from}`)
          : `${past} ${what} ${from}`;
        break;
      }
      default: line = e.headline || e.summary || 'Something happened';
    }
    return oneColon(String(line));
  } catch { return 'Something happened'; }
}
