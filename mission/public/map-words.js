// The System map's words and levels (docs/mission-ui.md, "System map (engineers)"): what the signal chain (map.js) and the
// full diagram's live dots (map-live.js, on /map/) show for each item, from derive() in model.js. Pure ES module, no DOM:
// the pages use it in the browser and test/map.test.mjs under node --test.
import { derive, dur, POLL_S, STALE_FACTOR, PAGE_STALE_S } from './model.js';

const WORD = { ok: 'OK', warning: 'Attention', down: 'Down', unknown: 'Unknown' };   // ui.js WORD (ui.js can't load under node)
const RANK = { down: 0, warning: 1, unknown: 2, ok: 3 };                                 // the headline order: worst first

// ---- the chain's rows --------------------------------------------------------------------------------------------
/** The level a row, a mark, a chip or a pill shows: an item from a last answer (its source is old, or contact is lost) is
 *  never green and never red: grey, with its word kept and "last answer" beside it (contract rule 3, as Status's tiles). */
export const shownLevel = (it) => (!it || it.stale ? 'unknown' : (WORD[it.level] ? it.level : 'unknown'));
/** A sub-item that is not there yet (the people counter): a known, normal absence. */
export const notYet = (it) => !!it?.muted && it.level !== 'unknown';
/** A row's state word: "OK", "Down · last answer", "Not available yet". */
export function rowWord(it) {
  if (!it) return WORD.unknown;
  if (notYet(it)) return 'Not available yet';
  return `${WORD[it.level] ?? WORD.unknown}${it.stale ? ' · last answer' : ''}`;
}
/** "Down for 9 min" from the server's history (`s` = status.since.items[id], already checked against the words beside it
 *  with ui.js sinceAgrees), carried forward by `elapsedS` while the answer is fresh. From a last answer it stops where the
 *  item was last seen ("Down for over 22 min when last seen") and never grows: nobody saw the rest (Status's rule). */
export function sinceWords(s, it, elapsedS = 0) {
  if (!s || s.for_s == null || !it || s.level !== it.level || it.level === 'ok' || !WORD[it.level]) return '';
  const pre = `${WORD[it.level]} for ${s.at_least ? 'over ' : ''}`;
  if (it.stale) {
    const seen = s.for_s - (it.age_s ?? 0);
    return seen > 0 ? `${pre}${dur(seen)} when last seen` : '';
  }
  return `${pre}${dur(s.for_s + Math.max(0, elapsedS || 0))}`;
}
/** The model's advice as the map says it: the controls are on Status, not "below" (there is nothing below on the map). */
export function mapAction(a) {
  if (!a) return a;
  let s = a.replace(/\bbelow\b/g, 'on Status');
  if (s === a) s = s.replace(/\b([Pp])ress /, (_m, P) => `${P === 'P' ? 'Go' : 'go'} to Status and press `);
  if (s === a) s = s.replace(/\b(switch to the river's year)\b/, '$1 on Status');
  return s;
}
/** Does the advice send the reader to a control on Status (so the sheet links there)? */
export const pointsAtStatus = (a) => !!a && /\bon Status\b|\bgo to Status\b/i.test(mapAction(a));

/** The hidden live region's words: "No contact with mission control." while contact is lost, then "Contact with mission
 *  control is back." once it returns (for `backMs`), then nothing, so a screen reader hears each change once. */
export function contactNotice(backMs = 10_000) {
  let was = false, backAt = null;
  return (lost, nowMs) => {
    if (lost) { was = true; backAt = null; return 'No contact with mission control.'; }
    if (was) { was = false; backAt = nowMs; }
    return backAt != null && nowMs - backAt < backMs ? 'Contact with mission control is back.' : '';
  };
}

// ---- the full diagram's live dots (map-live.js) ----------------------------------------------------------------------
/** Which items each node on the full diagram (docs/system/system.json) takes its dot from: the worst of them. The river
 *  site (its router and Starlink) and Dave's data endpoint are judged below, from the river camera and the Modal source. */
export const DOT_ITEMS = {
  'gavin-mini': ['mission control'], 'mission-control': ['mission control'],
  bitcube: ['bitcube', 'touchdesigner'],                      // the PC and the show it runs: one box on the diagram
  'router-gallery': ['router'], 'gallery-net': ['internet'], 'public-internet': ['internet'],
  'cam-gallery': ['gallery camera'], 'cam-river': ['river camera'], glinet: [], starlink: [],
  'psac10-1': ['rope box 1'], 'psac10-2': ['rope box 2'], 'colorlight-sender': ['hub75 panels'],
  'modal-app': ['modal agent'], 'ep-ingest': ['modal link'], 'ep-data': [],
};
for (let i = 1; i <= 20; i++) DOT_ITEMS[`rope-${String(i).padStart(2, '0')}`] = ['ropes', i <= 10 ? 'rope box 1' : 'rope box 2'];

/** Every live dot from one /api/status answer, judged at `nowMs` (the server's clock carried forward by the phone's): { node:
 *  { level, why } }, level 'ok' | 'warning' | 'down' | 'unknown' from derive()'s items, an item from a last answer counting
 *  as not known. {} before the first answer (the diagram keeps its documented colours). */
export function dots(status, nowMs) {
  if (!status || typeof status !== 'object') return {};
  let m;
  try { m = derive(status, nowMs); } catch { return {}; }
  const item = (id) => m.items.find((x) => x.id === id) ?? null;
  const why = (it, many) => (!it ? '' : `${many ? `${it.name.replace(/ \(.*\)$/, '')}: ` : ''}${it.stale ? 'last answer: ' : ''}${it.summary ?? ''}`.trim());
  const out = {};
  for (const [node, ids] of Object.entries(DOT_ITEMS)) {
    if (!ids.length) continue;
    const its = ids.map(item).filter(Boolean);
    if (!its.length) { out[node] = { level: 'unknown', why: '' }; continue; }
    const worst = its.reduce((a, b) => (RANK[shownLevel(b)] < RANK[shownLevel(a)] ? b : a));
    out[node] = { level: shownLevel(worst), why: why(worst, its.length > 1 && worst !== its[0]) };
  }
  // the river site (its router and Starlink): up when the river camera answers through them; down with it when the site is
  // down; not known when Gray Area has no internet (then nothing over there can be seen)
  const cam = item('river camera'), net = item('internet'), cl = shownLevel(cam);
  const site = cl === 'ok' || cl === 'warning' ? { level: 'ok', why: 'The river camera answers through it' }
    : cl === 'down' && shownLevel(net) !== 'down' ? { level: 'down', why: cam.summary ?? '' }
    : { level: 'unknown', why: cl === 'down' ? "No internet at Gray Area, so the river site can't be seen" : '' };
  out.glinet = site; out.starlink = { ...site };
  // Dave's data endpoint: mission control reads it every 30 s
  const md = m.sources.modal, lostPage = shownLevel(item('mission control')) !== 'ok';
  if (md?.present) out['ep-data'] = lostPage || md.stale ? { level: 'unknown', why: 'last answer' } : md.ok ? { level: 'ok', why: 'Mission control reads it' } : { level: 'down', why: "Mission control couldn't read it" };
  return out;
}

const DOT_WORD = { ok: 'OK', warning: 'needs attention', down: 'Down', unknown: 'not known' };
/** A node's accessible name with its live state first: "bitcube, computer: Down now (TouchDesigner: Frozen…). Documented as
 *  working." (`n`: the node's name, kind, documented status and how it was verified, from system.json.) */
export function dotLabel(n, d) {
  const verified = n.verified && n.verified !== 'confirmed' ? `, ${n.verified}` : '';
  return `${n.name}, ${n.kind}: ${dotWords(d)}. Documented as ${n.status}${verified}.`;
}
/** A dot's live state in words: "Down now (TouchDesigner: Frozen…)" (the tooltip says it too). */
export const dotWords = (d) => `${DOT_WORD[d.level] ?? DOT_WORD.unknown} now${d.why ? ` (${d.why})` : ''}`;
/** The live bar's words after "Live: …" (it ticks, so it is not a live region): durations in dur()'s form. */
export function liveLine(status, sinceMs) {
  if (!status || sinceMs == null) return 'no answer from mission control yet';
  if (sinceMs > PAGE_STALE_S * 1000) return `no answer from mission control for ${dur(sinceMs / 1000)}: every dot is not known`;
  let m;
  try { m = derive(status, status.now + sinceMs); } catch { return 'mission control answered'; }
  if (m.items.find((x) => x.id === 'bitcube')?.level === 'down') return "bitcube is offline: what is behind it can't be checked";
  const pa = m.sources.probe?.age_s;
  if (pa == null) return 'bitcube not checked yet';
  const age = pa + sinceMs / 1000;
  return age > POLL_S.probe * STALE_FACTOR ? `bitcube last checked ${dur(age)} ago: what it reports is not known now` : `bitcube checked ${dur(age)} ago`;
}
