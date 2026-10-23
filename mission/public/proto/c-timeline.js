// Direction C's timeline: what changed, derived on the phone from successive status models (model.js derive()),
// so nobody has to guess what happened while they were away. Pure ES module: digest() boils one model down to the
// facts the feed compares, diff() turns two digests into events, seed() reads the times the payload already knows
// (season turns, Dave's scene and ticks, bitcube's restart), and a store keeps the last hour with "since when" per
// piece. Tested in test/proto-c-timeline.test.mjs. Words come from model.js so nothing is re-derived here.
import { dur, clock, LEVELS } from '../model.js';

export const WINDOW_MS = 60 * 60e3;        // the feed keeps the last hour (older seeds show under "Earlier")
export const AWAY_MS = 20e3;               // a gap between polls longer than this: the page was closed, asleep or offline
export const RESTART_MS = 15 * 60e3;       // bitcube's uptime jitters by minutes; a jump bigger than this is a real restart
export const STATE_WORD = { ok: 'OK', warning: 'Attention', down: 'Down', unknown: 'Unknown' };
export const MARK = { ok: '✓', warning: '▲', down: '✕', unknown: '?' };
export const shortName = (name) => String(name ?? '').replace(/\s*\(.*\)$/, '');
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const worst = (levels) => levels.reduce((a, b) => (LEVELS[b] < LEVELS[a] ? b : a), 'ok');

/** The facts one poll leaves behind for the next one to compare. `status.now` is the server's clock. */
export function digest(m, status) {
  const items = {}, summaries = {}, names = {};
  for (const it of m.items) { items[it.id] = it.level; summaries[it.id] = it.summary; names[it.id] = shortName(it.name); }
  const now = num(status?.now);
  const scene = m.show.scene;
  const sceneMs = scene?.set_at ? Date.parse(scene.set_at) : NaN;
  return {
    t: now,
    level: m.overall.level, cause: m.overall.cause, headline: m.overall.headline, detail: m.overall.detail, action: m.overall.action,
    stale: m.overall.stale,
    items, summaries, names,
    season: m.show.season, mode: m.show.mode?.id ?? null, target: m.show.target?.season ?? null,
    file: m.show.file?.name ?? null, file_label: m.show.file?.label ?? null, file_kind: m.show.file?.kind ?? null,
    ropes: m.show.ropes?.state ?? null,
    scene_ms: Number.isFinite(sceneMs) ? sceneMs : null, scene_words: scene ? `${scene.animation ?? '?'} / ${scene.palette ?? '?'}` : null,
    tick_ms: m.show.modal?.last_tick_ms ?? null, mood: m.show.modal?.mood ?? null,
    boot_ms: m.show.uptime_s != null && now != null ? now - m.show.uptime_s * 1000 : null,
    history: Array.isArray(m.show.history) ? m.show.history.map((h) => ({ t_ms: h.t_ms, season: h.season })) : [],
  };
}

/** Events the payload itself dates, regenerated on every poll (keys make them idempotent). */
export function seed(d) {
  const ev = [];
  const h = d.history;
  for (let i = 1; i < h.length; i++) {
    if (h[i].season && h[i - 1].season && h[i].season !== h[i - 1].season) ev.push(seasonEvent(h[i].season, h[i].t_ms, d));
  }
  if (d.scene_ms != null && d.scene_words) ev.push({
    key: `scene:${d.scene_ms}`, t: d.scene_ms, kind: 'scene', level: 'ok', who: 'from Modal',
    title: `Dave's agent set a new scene: ${d.scene_words}`,
    detail: d.file_kind === 'live' ? 'The live river shows it on the panels.' : d.file_kind === 'year' ? "The river's year doesn't use it, so the room is unchanged." : 'Whether the room shows it depends on the show file.',
  });
  if (d.tick_ms != null) ev.push({ key: 'ticks', t: d.tick_ms, kind: 'tick', level: 'ok', who: 'from Modal', n: 1,
    title: `Dave's agent ticked${d.mood ? ` (${d.mood})` : ''}`, detail: `Last tick ${clock(d.tick_ms)}. It ticks every 5 minutes between 07:00 and 23:55.` });
  if (d.boot_ms != null) ev.push({ key: 'boot', t: d.boot_ms, kind: 'boot', level: 'ok', who: 'from bitcube',
    title: 'bitcube restarted', detail: 'A restart takes about a minute; TouchDesigner opens by itself about a minute after it.' });
  return ev;
}

function seasonEvent(season, t, d) {
  const how = d.mode === 'manual' ? `By hand, heading for ${d.target ?? 'a season'}.` : d.mode === 'dynamic' ? 'Steered by the people in the room.' : 'By the clock: the year turns one season a minute.';
  return { key: `season:${season}:${Math.round(t / 60e3)}`, t, kind: 'season', level: 'ok', who: "from the river's year", season, how,
           title: `Season turned to ${season}`, detail: how, turns: [{ season, t }] };
}

/** What changed between two polls: one entry per moment (the new verdict, or the first changed piece, with the rest
 *  listed under it), plus the show's own moves (season, mode, target, show file). */
export function diff(prev, next) {
  if (!prev || !next || next.t == null) return [];
  const ev = [];
  // A gap between polls means the page was away (closed, asleep, offline), unless the page itself is the thing that
  // changed: losing contact is dated when it is noticed, and what changed during an outage is marked "no contact".
  const gap = prev.t != null && next.t - prev.t > AWAY_MS && next.cause !== 'page';
  const away = gap ? { from: prev.t, to: next.t, lost: prev.cause === 'page' } : null;
  const t = next.t;
  const changes = [];
  for (const id of new Set([...Object.keys(prev.items), ...Object.keys(next.items)])) {
    const from = prev.items[id] ?? null, to = next.items[id] ?? null;
    if (from === to) continue;
    changes.push({ id, name: next.names[id] ?? prev.names[id] ?? id, from, to, summary: next.summaries[id] ?? '' });
  }
  changes.sort((a, b) => LEVELS[a.to ?? 'unknown'] - LEVELS[b.to ?? 'unknown']);
  if (prev.cause !== next.cause || prev.level !== next.level) {
    ev.push({ key: `verdict:${t}`, t, kind: 'verdict', level: next.level, who: 'mission control', title: next.headline,
              detail: `Before: ${prev.headline}`, changes });
  } else if (changes.length) {
    const c = changes[0];
    ev.push({ key: `items:${t}`, t, kind: 'items', level: worst(changes.map((x) => x.to ?? 'unknown')), who: 'mission control',
              title: `${c.name} · ${STATE_WORD[c.to] ?? 'Gone'}: ${c.summary}`, detail: c.from ? `Was ${STATE_WORD[c.from]}.` : '', changes: changes.slice(1) });
  }
  if (!next.history.length && prev.season && next.season && prev.season !== next.season) ev.push(seasonEvent(next.season, t, next));
  if (prev.mode && next.mode && prev.mode !== next.mode) ev.push({ key: `mode:${t}`, t, kind: 'mode', level: 'ok', who: "from the river's year",
    title: `Mode set to ${next.mode}`,
    detail: next.mode === 'manual' ? `By hand, heading for ${next.target ?? 'a season'}.` : next.mode === 'automatic' ? 'The clock turns the year again, one season a minute.' : 'People steer it now.' });
  else if (next.mode === 'manual' && prev.target && next.target && prev.target !== next.target) ev.push({ key: `target:${t}`, t, kind: 'mode', level: 'ok', who: "from the river's year",
    title: `Target set to ${next.target}`, detail: 'The river travels forward to it.' });
  if (prev.file && next.file && prev.file !== next.file) ev.push({ key: `file:${t}`, t, kind: 'file', level: 'ok', who: 'from bitcube',
    title: `TouchDesigner switched to ${next.file_label}`, detail: `It was showing ${prev.file_label}.` });
  if (away) for (const e of ev) e.away = away;
  return ev;
}

/** The store: { startedAt, last, since: { overall, items: {id} }, events }. */
export function newStore(startedAt) { return { v: 1, startedAt, last: null, since: { overall: null, items: {} }, events: [] }; }

/** Fold one poll into the store: the start marker once, seeds, the diff with the previous poll, "since when". */
export function observe(store, d, m) {
  if (!store.events.some((e) => e.key === 'start')) {
    store.events.push({ key: 'start', t: store.startedAt, kind: 'start', level: d.level, who: 'this page', title: d.headline,
      detail: `Found like this when this page began watching at ${clock(store.startedAt)}. What happened before isn't known here; the times below come from bitcube, the river's year and Dave's agent themselves.` });
  }
  const events = [...seed(d), ...diff(store.last, d)];
  for (const e of events) merge(store, e);
  updateSince(store, d);
  store.last = d;
  prune(store, d.t ?? Date.now());
  return events;
}

/** Add or update one event. Dated seeds (a season turn, a scene, a tick, a restart) are the same event when they
 *  fall within NEAR of one already kept, whatever their key: a payload's times can shift a little between polls
 *  (bitcube's uptime is coarse; fixture mode re-dates everything to the present), and a real new one is far away.
 *  Ticks are one running entry that counts; a restart more than RESTART_MS away is a new restart. */
const NEAR = { season: 150e3, scene: 4 * 60e3, boot: RESTART_MS };   // the same season recurs after 4 min; a scene lasts a tick
const TICK_GAP_MS = 4 * 60e3;              // Dave's agent ticks every 5 minutes
export const RUN_GAP_MS = 3 * 60e3;        // season turns closer than this (automatic: one a minute) fold into one running entry
export function merge(store, e) {
  if (e.kind === 'season') return foldSeason(store, e);
  if (e.kind === 'tick') {
    const old = store.events.find((x) => x.kind === 'tick');
    if (!old) { store.events.push(e); return e; }
    const n = e.t - old.t > TICK_GAP_MS ? (old.n ?? 1) + 1 : (old.n ?? 1);
    Object.assign(old, { t: Math.max(old.t, e.t), title: e.title, n, detail: `${e.detail}${n > 1 ? ` ${n} ticks seen by this page.` : ''}` });
    return old;
  }
  if (NEAR[e.kind]) {
    const near = store.events.find((x) => x.kind === e.kind && (e.kind !== 'season' || x.season === e.season) && Math.abs(x.t - e.t) < NEAR[e.kind]);
    if (near) { Object.assign(near, { t: e.t, title: e.title, detail: e.detail }); return near; }
    store.events.push(e);
    return e;
  }
  const i = store.events.findIndex((x) => x.key === e.key);
  if (i < 0) { store.events.push(e); return e; }
  store.events[i] = { ...store.events[i], ...e, t: store.events[i].t };    // same moment: keep the time, refresh the words
  return store.events[i];
}

/** Season turns: one entry per run of turns (the latest on top, the earlier ones listed under it), so an automatic
 *  year turning every minute is one line in the feed, not sixty. A turn seen again with a slightly different time
 *  (fixture mode re-dates the history) refreshes the turn it already is. */
function foldSeason(store, e) {
  const runs = store.events.filter((x) => x.kind === 'season');
  for (const r of runs) {
    r.turns ??= [{ season: r.season, t: r.t }];
    const same = r.turns.find((t) => t.season === e.season && Math.abs(t.t - e.t) < NEAR.season);
    if (same) { same.t = e.t; relabel(r, e.how); return r; }
  }
  const near = runs.find((r) => r.turns.some((t) => Math.abs(t.t - e.t) < RUN_GAP_MS));
  if (near) { near.turns.push({ season: e.season, t: e.t }); relabel(near, e.how); return near; }
  const run = { ...e, turns: [{ season: e.season, t: e.t }] };
  store.events.push(run);
  return run;
}
function relabel(r, how) {
  r.turns.sort((a, b) => a.t - b.t);
  const head = r.turns[r.turns.length - 1];
  Object.assign(r, { t: head.t, season: head.season, title: `Season turned to ${head.season}`, key: `season:${head.season}:${Math.round(head.t / 60e3)}`, how: how ?? r.how });
  const before = r.turns.slice(0, -1).reverse().slice(0, 3).map((t) => `${t.season} ${clock(t.t)}`);
  r.detail = `${r.how ?? ''}${before.length ? ` Before that: ${before.join(', ')}${r.turns.length > 4 ? ` and ${r.turns.length - 4} more` : ''}.` : ''}`.trim();
}

function updateSince(store, d) {
  const gap = store.last && store.last.t != null && d.t != null && d.t - store.last.t > AWAY_MS && d.cause !== 'page';
  const away = gap ? store.last.t : null, lost = gap && store.last.cause === 'page';
  const first = !store.last;
  const o = store.since.overall;
  if (!o || o.cause !== d.cause || o.level !== d.level) store.since.overall = { cause: d.cause, level: d.level, t: d.t, from: first ? null : away, lost, atLeast: first };
  for (const [id, level] of Object.entries(d.items)) {
    const s = store.since.items[id];
    if (!s || s.level !== level) store.since.items[id] = { level, t: d.t, from: first ? null : away, lost, atLeast: first };
  }
}

/** Drop what is older than an hour, except the start marker and the dated seeds (shown under "Earlier"). */
export function prune(store, now) {
  const keep = (e) => e.kind === 'start' || ['scene', 'tick', 'boot', 'season'].includes(e.kind) || now - e.t <= WINDOW_MS;
  store.events = store.events.filter(keep).sort((a, b) => b.t - a.t).slice(0, 300);
}

/** "Since 21:04 (12 min)", "Since at least 21:04", "Since between 21:04 and 21:30 (this page was away)",
 *  "Since about 21:04 (no contact)" when the gap falls within one minute. */
export function sinceWords(s, now) {
  if (!s || s.t == null) return '';
  if (s.atLeast) return `Since at least ${clock(s.t)}`;
  if (s.from) {
    const why = s.lost ? 'no contact' : 'this page was away';
    return clock(s.from) === clock(s.t) ? `Since about ${clock(s.t)} (${why})` : `Since between ${clock(s.from)} and ${clock(s.t)} (${why})`;
  }
  return `Since ${clock(s.t)}${now != null && now - s.t > 45e3 ? ` (${dur((now - s.t) / 1000)})` : ''}`;
}
/** The gap note under a feed entry: "changed while this page was away (21:04 → 21:30)". */
export function gapWords(away) {
  if (!away) return '';
  return `changed while this page ${away.lost ? 'had no contact' : 'was away'} (${clock(away.from)} → ${clock(away.to)})`;
}

/** The feed, newest first: what is inside the hour, and the older dated seeds. */
export function feed(store, now) {
  const inWindow = [], earlier = [];
  for (const e of store.events) {
    if (e.kind === 'start') continue;
    (now - e.t <= WINDOW_MS ? inWindow : earlier).push(e);
  }
  const start = store.events.find((e) => e.kind === 'start') ?? null;
  return { events: inWindow.sort((a, b) => b.t - a.t), earlier: earlier.sort((a, b) => b.t - a.t).slice(0, 6), start };
}
