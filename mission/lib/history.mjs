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
//   recent({ limit = 50, kinds, sinceT }) -> events, newest first (default window: the last keepMs)
//   summary(nowMs) -> { since: { overall, items: { id }, show: { field } }, last_action, count }
// describeEvent(ev) -> one plain sentence for a feed (glossary words, no jargon; never throws).
//
// Events (all carry t, ms epoch on the server's clock; `from` is null the first time something is seen):
//   { kind: 'overall', t, level, cause, headline, stale, lost, from: { level, cause, stale, lost } | null }
//       the verdict changed: level, cause, or contact. stale: a source the verdict needs has gone quiet and `lost`
//       names it ('bitcube', "the river's year page", "Dave's agent").
//   { kind: 'item', t, id, from, to, summary, stale?, gap?, still? }   a piece of equipment changed level (levels: ok warning
//                                                          down); stale: its source was already quiet at the time; gap: it
//                                                          was not seen just before (since is "at least"); still: the same
//                                                          state seen again after a long unseen stretch (since restarts)
//   { kind: 'show', t, field, from, to }                   file (the .toe name) | mode | season | ropes (the state word)
//   { kind: 'calibration', t, running, stage, ok, cancelled, mode, error, stale, from: { running, stage } | null }
//   { kind: 'action', t, action, body, ok, note, source }  source: 'mission control' | 'studio chat' (never a person: MD4);
//                                                          body is the request body cut to BODY_MAX chars of JSON
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
import { derive, FILES } from '../public/model.js';
import { scrubCreds } from './scrub.mjs';

export const KEEP_MS = 48 * 3600e3;
export const MAX_EVENTS = 5000;
export const BODY_MAX = 300;                 // an action's body, as JSON: a feed line, not a document
export const UNSEEN_GAP_MS = 5 * 60e3;        // unseen for longer than this, a state seen again is a first sighting again
export const SOURCES = ['mission control', 'studio chat'];
const SHOW_FIELDS = ['file', 'mode', 'season', 'ropes'];
const BLIND = ['page', 'bitcube-offline', 'bitcube-unchecked', 'probe-stale', 'not-checked', 'check-failed'];   // causes that hide what is behind them
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x, max) => (typeof x === 'string' ? x.slice(0, max) : null);
/** The state a key is in is told by its latest event, so those are kept whatever their age (null: not a state). */
const keyOf = (ev) => (ev.kind === 'item' ? `item:${ev.id}` : ev.kind === 'show' ? `show:${ev.field}` : ['overall', 'calibration', 'action'].includes(ev.kind) ? ev.kind : null);
/** An item's reason, from its summary without the numbers that change with every answer ("Running slowly: 4 of 60 frames
 *  a second" and "…: 5 of 60…" are one reason; "Dark on purpose: sending black" is another). */
export const reasonOf = (summary) => String(summary ?? '').replace(/\d+(?:[.:]\d+)*\s*(?:s|min|h|days|%|W|GB)?(?![A-Za-z])/g, '#').trim();
const forS = (t, now) => Math.max(0, Math.round((now - t) / 1000));
/** Where a control was used: one of SOURCES, never a person's name (MD4: the chat is unattributed). */
const sourceOf = (s) => (/studio|chat|agent/i.test(String(s ?? '')) ? 'studio chat' : 'mission control');
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
        rec({ kind: 'overall', level: o.level, cause, headline: o.headline, stale, lost: stale ? lostWho(m) : null, from: prev, ...(blind && !stale ? { gap: true } : {}) });
      }
      // Each piece: unknown and muted (nothing to show) carry no knowledge, so they keep the last known level. A piece that
      // was not known in the previous observation changed at some moment of the gap: its since is "at least".
      for (const it of m.items) {
        if (it.level === 'unknown' || it.muted) continue;
        // the ropes and panels in calibration patterns are the calibration's own line below, not news of their own: the
        // piece keeps its last level, so the run ending with everything back is no event either
        if (it.cause === 'calibrating') continue;
        const p = this.state.items[it.id], seen = this.knownAt[it.id];
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
        if (to == null || to === 'calibrating' || (p && p.value === to)) continue;
        rec({ kind: 'show', field, from: p?.value ?? null, to });
      }
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

  /** A control was used, from mission control or the studio chat: kept so "was that on purpose?" has an answer. */
  action(entry) {
    const e = obj(entry) ?? {};
    return this.#record({ kind: 'action', t: num(e.t) ?? this.now(), action: str(e.action == null ? 'unknown' : String(e.action), 40) || 'unknown',
                          body: smallBody(e.body), ok: e.ok !== false, note: e.note == null ? null : String(e.note).slice(0, 200), source: sourceOf(e.source) });
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

  /** Newest first (the last recorded first among equal times). kinds: one kind or a list; sinceT: strictly after that
   *  time (default: the keepMs window, which hides the old markers kept for since()). */
  recent({ limit = 50, kinds, sinceT } = {}) {
    const from = num(sinceT) ?? this.now() - this.keepMs;
    const ks = kinds == null ? null : new Set([].concat(kinds));
    const out = [];
    for (let i = this.events.length - 1; i >= 0; i--) { const e = this.events[i]; if (e.t > from && (!ks || ks.has(e.kind))) out.push(e); }
    return out.sort((a, b) => b.t - a.t).slice(0, Math.max(0, num(limit) ?? 50));
  }

  /** For GET /api/history: since when, per piece and for the show, the last thing done, and how much is kept. */
  summary(nowMs) {
    const now = num(nowMs) ?? this.now();
    const items = Object.fromEntries(Object.keys(this.state.items).map((id) => [id, this.since(id, now)]));
    const show = Object.fromEntries(Object.keys(this.state.show).map((f) => [f, this.sinceShow(f, now)]));
    return { since: { overall: this.since('overall', now), items, show }, last_action: this.state.last_action, count: this.events.length };
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
        const base = known && !same ? { level: ev.level, cause: ev.cause ?? null, t: ev.t, at_least: ev.from == null || ev.gap === true }
          : known && longGap ? { level: p.level, cause: p.cause, t: ev.t, at_least: true }
          : { level: p.level, cause: p.cause, t: p.t, at_least: p.at_least };
        S.overall = { ...base, stale: !!ev.stale, lost: ev.lost ?? null, last: { level: ev.level, cause: ev.cause ?? null, stale: !!ev.stale, lost: ev.lost ?? null },
                      blind_since: blindNow ? (typeof p?.blind_since === 'number' ? p.blind_since : ev.t) : null };
        break;
      }
      case 'item': if (typeof ev.id === 'string') S.items[ev.id] = { level: ev.to, reason: reasonOf(ev.summary), t: ev.t, at_least: ev.from == null || ev.gap === true }; break;
      case 'show': if (typeof ev.field === 'string') S.show[ev.field] = { value: ev.to, t: ev.t, at_least: ev.from == null }; break;
      case 'calibration': S.calibration = { running: ev.running === true, stage: ev.stage ?? null, stale: ev.stale === true, t: ev.t }; break;
      case 'action': S.last_action = ev; break;
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
      try { const ev = JSON.parse(l); if (obj(ev) && num(ev.t) != null && typeof ev.kind === 'string') { this.events.push(ev); this.#apply(ev); } }
      catch { /* a torn or hand-edited line: skipped, never fatal */ }
    }
    this.#prune(this.now());
    if (this.lines > 2 * this.max) this.#compact();
  }

  #record(ev) {
    this.events.push(ev);
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
    this.events = extra > 0 ? fresh.filter((ev) => { if (keep.has(ev) || extra <= 0) return true; extra--; return false; }) : fresh;
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
  [/^Offline\b/, 'went offline'], [/^Reachable, but/, 'is reachable, but'], [/^Answers, but/, 'answers, but'],
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
  [/^No internet from bitcube/, 'is down: bitcube cannot reach it'], [/^Reports a problem/, 'reports a problem'], [/^Hasn't (?:ticked|updated)/, "hasn't updated"],
  [/^Clips failing for both cameras/, 'is failing: no clips from either camera'],
  [/^(Gallery|River) clips failing/, (_m, cam) => `=${cam} clips to Dave are failing`],
  [/^Sync has seen no new state/, 'has seen no new state from Dave'], [/^Current run can't/, "can't"],
];
const STAGE = { 'ropes-capture': 'photographing the ropes', 'ropes-decode': 'working out where each rope is', 'hub75-capture': 'photographing the panels', 'hub75-locate': 'finding the panels', done: 'done' };
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
  return String(s ?? '').split(/;\s*/).map((x) => x.replace(/\s*\((?:last|up)\b[^()]*\)/gi, '').trim())
    .filter((x) => x && !/\bago\b|^up \d/i.test(x)).join('; ');
}
function itemWords(ev) {
  const [name, plural] = WHO[ev.id] ?? [cap(String(ev.id ?? 'something'))];
  const s = timeless(String(ev.summary ?? '').trim());
  if (ev.still && ev.to !== 'ok') return ev.to === 'down' ? `${name} ${plural ? 'are' : 'is'} still down${s ? `: ${lc(s)}` : ''}`
    : `${name} still ${plural ? 'need' : 'needs'} attention${s ? `: ${lc(s)}` : ''}`;
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
                           'not-reaching': first ? 'The ropes are not getting the river' : 'The ropes stopped getting the river' }[ev.to] ?? `The ropes are ${ev.to}`;
    default: return `${cap(String(ev.field))} changed to ${ev.to}`;
  }
}

function calibrationWords(ev) {
  const what = ev.mode === 'dry-run' ? 'A dry-run calibration' : ev.mode === 'decode-only' ? 'A calibration from earlier photos' : 'The calibration';
  const stage = STAGE[ev.stage] ?? null;
  if (ev.stale) return `${what} stopped answering: its process is gone`;
  if (ev.running && !ev.from?.running) return `${what} started${stage && stage !== 'done' ? `: ${stage}` : ''}`;
  if (ev.running) return `${what} is ${stage ?? 'running'}`;
  if (ev.cancelled) return `${what} was cancelled`;
  if (ev.ok === false) return `${what} failed`;
  if (ev.from?.running || ev.stage === 'done') return `${what} finished`;
  return `${what} is not running`;
}

/** [past, infinitive, what] for an action, from its body. */
function actionPhrase(ev) {
  const b = obj(ev.body) ?? {};
  const pct = num(Number(b.brightness)) != null ? `${Math.round(Number(b.brightness) * 100)} %` : 'a new level';
  switch (ev.action) {
    case 'mode': return ['Set', 'set', `the year's mode to ${b.mode ?? 'a new mode'}`];
    case 'target': return ['Set', 'set', `the target to ${[b.season, b.intensity != null ? `intensity ${b.intensity}` : null].filter(Boolean).join(', ') || 'a new value'}`];
    case 'rules': { const n = Object.keys(obj(b.rules) ?? {}).length; return ['Changed', 'change', n ? `${n} of the year's rules` : "the year's rules"]; }
    case 'rules-reset': return ['Reset', 'reset', "the year's rules"];
    case 'ropes': return ['Turned', 'turn', b.dark === true ? 'the ropes dark' : 'the ropes on'];   // as planControl: only a real true goes dark
    case 'hub75': return ['Set', 'set', `the panel brightness to ${pct}`];
    case 'switch': return ['Switched', 'switch', `TouchDesigner to ${fileLabel(b.file)}`];
    case 'bootfile': return ['Set', 'set', `the show file for the next restart to ${fileLabel(b.file)}`];
    case 'lightsroute': return ['Routed', 'route', `the lights through ${b.route === 'router' ? 'the router' : "bitcube's LIGHTS port"}`];
    case 'check': return ['Ran', 'run', 'the full check of bitcube'];
    case 'rebuild': return ['Rebuilt', 'rebuild', `${fileLabel(b.file)} with the new LED map`];
    case 'calibrate': return b.action === 'cancel' ? ['Cancelled', 'cancel', 'the calibration'] : b.action === 'status' ? ['Checked', 'check', 'the calibration']
      : ['Started', 'start', `a ${b.dry_run === true ? 'dry-run ' : ''}calibration${b.decode_only ? ' from earlier photos' : ''}`];   // as planCalibrate
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

/** One plain sentence for a feed; never throws. */
export function describeEvent(ev) {
  const e = obj(ev);
  if (!e) return '';
  try {
    let line;
    switch (e.kind) {
      case 'overall': {
        const who = e.lost ?? 'bitcube';
        const head = e.headline || `The verdict is ${e.level ?? 'unknown'}`;
        if (e.stale) {
          const same = e.from && e.from.level === e.level && e.from.cause === (e.cause ?? null);
          line = e.level === 'unknown' || same ? `Lost contact with ${who}` : `${head} (and no word from ${who})`;
        } else line = e.from?.stale ? `Back in touch with ${e.from.lost ?? 'bitcube'}: ${lc(head)}` : head;
        break;
      }
      case 'item': line = itemWords(e); break;
      case 'show': line = showWords(e); break;
      case 'calibration': line = calibrationWords(e); break;
      case 'action': {
        const [past, inf, what] = actionPhrase(e), from = `from ${e.source === 'studio chat' ? 'the studio chat' : 'mission control'}`;
        line = e.ok === false ? `Tried to ${inf} ${what} ${from}, but ${plainNote(e.note) ?? 'it failed'}` : `${past} ${what} ${from}`;
        break;
      }
      default: line = e.headline || e.summary || 'Something happened';
    }
    return oneColon(String(line));
  } catch { return 'Something happened'; }
}
