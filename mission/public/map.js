// Mission control v2: the System map page (docs/mission-ui.md, "System map (engineers)"). Prototype B's signal chain
// on its own page: inputs (gallery camera, river camera, internet) → bitcube → TouchDesigner → the ropes and the
// panels, and bitcube → Dave's agent with the clips on that arrow. Every box shows ITS OWN item from derive() in
// /model.js (never the worst of a bundle); every link pill is that link's item in a word or two; a tap opens the
// item's sheet with "Addresses and links (for Will)". Below it, the engineers' full diagram (/map/) in a frame.
// Plain ES module, no build, no framework, no external scripts.
import { mountShell, poll, tick, watchContact, art, fmt, sheet, esc, mark, chip, WORD, MARK, DOC_LINKS, sinceAgrees, NAMES_FROM_BITCUBE, WARN_MS } from '/ui.js';
import { derive, dur } from '/model.js';
import { shownLevel, notYet, rowWord, sinceWords, mapAction, pointsAtStatus, contactNotice } from '/map-words.js';

const FROM = { mini: 'the Mac mini', bitcube: 'bitcube', modal: "Dave's agent" };
const CHECK = { mini: 'the Mac mini', bitcube: "bitcube's full check", modal: "the Mac mini, asking Dave's agent" };
const SOURCE_OF = { bitcube: 'bitcube', seasons: 'seasons', 'mission control': null };   // which source an item's raw error lives in
const $ = (sel, root = document) => root.querySelector(sel);
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? '');
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// The boxes. `item` is the one item the box shows; `subs` are the items listed inside it, each with its own mark;
// `map` is the node on the full diagram (docs/system/system.json) the sheet deep-links to.
const BOXES = [
  { id: 'gallery', item: 'gallery camera', name: 'Gallery camera', title: 'Gallery camera', map: 'cam-gallery',
    lead: "Watches the room: the still on Status and the clips to Dave. On our router's Wi-Fi." },
  { id: 'river', item: 'river camera', name: 'River camera', title: 'River camera (the river site)', map: 'cam-river',
    lead: 'At the real river, on solar power and Starlink. The live river shows it; the recorder and the clips to Dave use it in any show file.' },
  { id: 'internet', item: 'internet', name: 'Internet at Gray Area', title: 'Internet at Gray Area', subs: ['router'], map: 'public-internet',
    lead: "Gray Area's internet connection, through our router in the ceiling. The show runs without it; the clips to Dave and the river camera need it." },
  { id: 'bitcube', item: 'bitcube', name: 'bitcube', title: 'bitcube (the show PC)', subs: ['recorder', 'people counter'], map: 'bitcube',
    lead: 'The show PC in the ceiling. Mission control reaches it from the Mac mini; its full check reports everything behind it about once a minute. The river recorder and the people counter run on it.' },
  { id: 'td', item: 'touchdesigner', name: 'TouchDesigner', title: 'TouchDesigner', subs: ['seasons'], map: 'bitcube',
    lead: "Runs the show file on bitcube and drives the ropes and the panels. The river's year has its own page, which mission control reads too." },
  { id: 'dave', item: 'modal agent', name: "Dave's agent", title: "Dave's agent", map: 'modal-app',
    lead: "Dave's agent gets clips from both cameras and makes a scene. Only the live river shows the scene." },
  { id: 'ropes', item: 'ropes', name: 'Ropes', title: 'Ropes (the sender)', subs: ['rope box 1', 'rope box 2'], map: 'gallery-switch',
    lead: "The 20 LED ropes, fed from bitcube's LIGHTS port through the two rope boxes (ropes 1–10 and 11–20)." },
  { id: 'panels', item: 'hub75 panels', name: 'Panels', title: 'Panels (HUB75 LED panels)', map: 'colorlight-sender',
    lead: "The four screens, fed from bitcube's HDMI through the panel sender." },
  { id: 'mini', item: 'mission control', name: 'Mission control', title: 'Mission control (the Mac mini)', map: 'mission-control',
    lead: "This app, on the Mac mini at Agape. Mission control checks bitcube and Dave's agent from the Mac mini, and serves these pages." },
];
const BOX = Object.fromEntries(BOXES.map((b) => [b.id, b]));
// The links: each carries one item; `word()` is its pill. Clips to Dave sit on the arrow to Dave's agent.
const LINKS = [
  { from: 'gallery', to: 'bitcube', item: 'gallery camera' },
  { from: 'river', to: 'bitcube', item: 'river camera' },
  { from: 'internet', to: 'bitcube', item: 'internet' },
  { from: 'bitcube', to: 'td', item: 'touchdesigner' },
  { from: 'td', to: 'ropes', item: 'ropes' },
  { from: 'td', to: 'panels', item: 'hub75 panels' },
  { from: 'bitcube', to: 'dave', item: 'modal link' },
];
const SUB_MAP = { recorder: 'bitcube', router: 'router-gallery', 'people counter': 'bitcube', seasons: 'bitcube', 'rope box 1': 'psac10-1', 'rope box 2': 'psac10-2', 'modal link': 'ep-ingest' };
const SUB_OF_MAP = Object.fromEntries(Object.entries(SUB_MAP).map(([k, v]) => [v, k]));   // a full-map node back to the item it shows
const wide = () => matchMedia('(min-width: 760px)').matches;

// ---- state -------------------------------------------------------------------------------------------------
const S = { m: null, openBox: null, sheetHtml: '', sheetEl: null };
const shell = mountShell({ page: 'map', title: 'System map' });
const p = poll('/api/status', { every: 5000,
  onData: () => { shell.setAge(0); shell.setStale(null); render(); },
  onError: () => render() });   // before any answer, watchContact's header says "No answer yet · N s"
// the shared rule (ui.js): from the time since the last answer, so a hung request greys every box as surely as an error
const contact = watchContact(p, shell, () => render());
document.addEventListener('mc:check', () => p.refresh());
document.addEventListener('mc:theme', () => requestAnimationFrame(drawLinks));

/** The model on the server's clock, carried forward by this phone's monotonic clock. */
function model() { return p.last ? derive(p.last, p.last.now + p.elapsed()) : null; }
const itemOf = (m, id) => m?.items.find((x) => x.id === id) ?? null;
const lost = () => contact.lost || (S.m && S.m.overall.cause === 'page');
const elapsedS = () => (p.receivedAt == null ? 0 : p.elapsed() / 1000);
const notice = contactNotice();

// ---- words -------------------------------------------------------------------------------------------------
/** The pill on a link: the spec's words ("no answer", "no frames", "no internet", "not driven", "picture frozen",
 *  "sending black", "clips failing", "sync quiet", "not known"), from the link's own item; from a last answer (the item is stale:
 *  an old full check, contact lost) with "· last answer", as the boxes say it, never "running" as if now (R8 #33). */
function linkWord(link, it, m) {
  const w = linkWordNow(link, it, m);
  return it?.stale && w !== 'not known' ? `${w} · last answer` : w;
}
function linkWordNow(link, it, m) {
  if (!it || it.level === 'unknown') return 'not known';
  const L = it.level, s = it.summary ?? '';
  switch (link.item) {
    case 'gallery camera': return L === 'ok' ? 'answers' : L === 'down' ? 'no answer' : 'see details';
    case 'river camera':
      if (m.show.river.live === true) return 'live frames';
      if (/no frames/i.test(s)) return 'no frames';
      if (it.cause === 'no-internet' || /no internet/i.test(s)) return 'no internet';
      return L === 'down' ? 'no answer' : L === 'ok' ? 'answers' : 'see details';
    case 'internet': return L === 'ok' ? 'online' : L === 'down' ? 'no internet' : 'see details';
    case 'touchdesigner':
      if (/frozen|not answering/i.test(s)) return 'not answering';
      if (/not running/i.test(s)) return 'not running';
      if (/restart|starting|coming up/i.test(s)) return 'starting';
      if (/slow/i.test(s)) return 'running slowly';
      return L === 'ok' ? 'running' : 'see details';
    case 'ropes': {
      const st = m.show.ropes.state;
      if (st === 'calibrating') return 'calibrating';
      if (st === 'dark') return 'sending black';
      if (st === 'restarting') return 'dark, restarting';
      if (st === 'not-reaching') return /frozen|not running|not being driven/i.test(s) ? 'not driven' : /restart|starts/i.test(s) ? 'dark, restarting' : 'not reaching';
      if (L === 'warning') return /slowly|frames a second/i.test(s) ? 'driven slowly' : 'see details';
      return L === 'ok' ? 'sender open' : 'see details';
    }
    case 'hub75 panels':
      if (m.show.panels.state === 'calibrating') return 'calibrating';
      if (/frozen/i.test(s)) return 'picture frozen';
      if (L === 'down') return 'no sender';
      if (L === 'warning') return /dark|off|brightness 0/i.test(s) ? 'dark' : 'see details';
      return 'picture sent';
    case 'modal link':
      if (/not running|not started/i.test(s)) return 'not running';
      if (/failing/i.test(s)) return 'clips failing';
      if (/nothing new/i.test(s)) return 'agent quiet';
      return L === 'ok' ? 'clips posting' : 'see details';
  }
  return WORD[L].toLowerCase();
}
/** "from bitcube · 20 s ago", amber past 2 min; "not checked yet" without an age. */
function fromLine(it) {
  if (!it) return '';
  const age = it.age_s == null ? null : it.age_s + elapsedS();
  const old = age != null && age > 120;
  return `<span class="from ${old ? 'old' : ''}">from ${FROM[it.checked_from] ?? it.checked_from}${age == null ? ' · not checked yet' : ` · ${fmt.nb(dur(age))} ago`}${it.stale ? ' · last answer' : ''}</span>`;
}
/** "Down for 9 min" from the server's history (status.since), carried forward while fresh; never this page's own watch start. */
function sinceLine(it) {
  const s = p.last?.since?.items?.[it.id];
  // as Status: never for an OK item, and never when it would contradict the words beside it (ui.js sinceAgrees)
  // nor for a piece dark while TouchDesigner restarts: its history keeps the state before the restart (R7 #4)
  if (!s || s.for_s == null || s.level !== it.level || it.level === 'ok' || it.cause === 'td-restarting' || !sinceAgrees(s, [it.summary, it.detail], NAMES_FROM_BITCUBE.has(it.id), S.m?.show.uptime_s)) return '';
  // from a last answer it stops where the item was last seen ("Down for over 22 min when last seen"), never ticking on
  const w = sinceWords(s, it, elapsedS());
  return w ? `<div class="since">${esc(fmt.nb(w))}</div>` : '';
}

// ---- the chain -----------------------------------------------------------------------------------------------
/** A sub-item that is not there yet (the people counter) is a known, normal absence: the grey '·' mark Status uses and
 *  "Not available yet"; never a green ✓. An unknown one (behind an offline bitcube) says Unknown, never "not available". */
// A row from a last answer (its source is old, or contact is lost) is never green: the grey mark and "· last answer"
// (map-words.js shownLevel, rowWord), whatever the box around it shows.
function subRow(m, id) {
  const it = itemOf(m, id), ny = notYet(it), lvl = ny ? 'unknown' : shownLevel(it);
  const mk = ny ? '<span class="mk lv-unknown" aria-hidden="true">·</span>' : mark(lvl);
  return `<span class="sub lv-${lvl} ${it?.muted ? 'muted-sub' : ''} ${it?.stale ? 'stale' : ''}">${mk}<span>${esc(shortName(id, it))}</span><span class="w">${esc(rowWord(it))}</span></span>`;
}
function shortName(id, it) {
  const n = { recorder: 'River recorder', router: 'Router', 'people counter': 'People counter', seasons: "The river's year (its page)", 'rope box 1': 'Rope box 1', 'rope box 2': 'Rope box 2', 'modal link': 'Clips to Dave' }[id];
  return n ?? (it?.name ?? id).replace(/ \(.*\)$/, '');
}
/** A box's parts (its class, its accessible name, its inside): render() patches the button in place, so a box that has
 *  focus keeps it (and a screen reader its place) when its words change, as Status keeps focus across its re-renders. */
function boxParts(m, b) {
  const it = itemOf(m, b.item), lvl = shownLevel(it), word = WORD[it?.level] ?? WORD.unknown;
  const sum = it ? it.summary : 'Not known yet';
  // the name a screen reader hears: the box, its own state, and every row inside it (a sub-item can be the one not OK)
  const subs = (b.subs ?? []).map((id) => { const s = itemOf(m, id); return `${shortName(id, s)}: ${notYet(s) ? 'not available yet' : WORD[s?.level ?? 'unknown']}${s?.stale ? ' (last answer)' : ''}`; });
  const label = `${b.name}: ${word}${it?.stale ? ' (last answer)' : ''}. ${sum}${subs.length ? `. ${subs.join('; ')}` : ''}`;
  return { cls: `node ${b.id} lv-${lvl}${it?.stale ? ' stale' : ''}`, label,
    inner: `<span class="nname">${esc(b.name)}</span>
    <span class="nstate">${mark(lvl)}<span>${word}</span>${it?.stale ? '<span class="last">· last answer</span>' : ''}</span>
    <span class="nsum">${esc(fmt.nb(sum))}</span>
    ${b.subs?.length ? `<span class="subs">${b.subs.map((id) => subRow(m, id)).join('')}</span>` : ''}` };
}
const CHAIN = BOXES.filter((b) => b.id !== 'mini');
function render() {
  const m = (S.m = model());
  art.setSeason(m?.show.weights ?? null);
  $('#connecting').hidden = !!m;
  renderMini(m);
  const wrap = $('#nodes');
  // built once; after that every box is patched in place (never re-created), so focus survives every answer
  if (!wrap.querySelector('[data-box]')) {
    wrap.innerHTML = '<svg class="lks" id="lks" aria-hidden="true"></svg>' + CHAIN.map((b) => `<button type="button" data-box="${b.id}" aria-haspopup="dialog"></button>`).join('') +
      '<ul class="links-list" id="linkWords" aria-label="The links"></ul>';
  }
  for (const b of CHAIN) {
    const el = wrap.querySelector(`[data-box="${b.id}"]`), x = boxParts(m, b);
    if (el.className !== x.cls) el.className = x.cls;
    if (el.getAttribute('aria-label') !== x.label) el.setAttribute('aria-label', x.label);
    if (el._mcHtml !== x.inner) { el.innerHTML = x.inner; el._mcHtml = x.inner; }
  }
  // the arrows' words (the drawn links are aria-hidden): "TouchDesigner to Ropes: not driven"; under 300 px wide, where the
  // chain is one box per row and the arrows can't be drawn, this list is shown instead (map.css)
  const ul = $('#linkWords'), words = m ? LINKS.map((l) => `<li>${esc(`${BOX[l.from].name} to ${BOX[l.to].name}: ${linkWord(l, itemOf(m, l.item), m)}`)}</li>`).join('') : '';
  if (ul._mcHtml !== words) { ul.innerHTML = words; ul._mcHtml = words; }
  ul.hidden = !m;
  requestAnimationFrame(drawLinks);
  renderAges();
}
/** Before the first answer: the header's words for the wait ("Connecting…" under 12 s, then "No answer yet"). */
const waitWords = () => (lost() ? 'No answer yet' : performance.now() - p.startedAt > WARN_MS ? 'No answer yet' : 'Connecting…');
/** The Mission control bar (its "No answer for N s" ticks with the banner while contact is lost). */
function renderMini(m) {
  const mini = itemOf(m, 'mission control'), miniLvl = mini?.level ?? 'unknown';
  const miniHtml = `<span class="nname">Mission control</span>${mark(miniLvl)}<span class="w">${WORD[miniLvl]}</span><span class="nsum">${esc(mini ? `${mini.summary}; checks bitcube from the Mac mini` : waitWords())}</span>`;
  const miniEl = $('#mini');
  if (miniEl.innerHTML !== miniHtml) { miniEl.innerHTML = miniHtml; miniEl.className = `mini-bar lv-${miniLvl}`; }
}
/** Once a second: the banner, the "bitcube checked N s ago" line and the open sheet's ages; never the boxes. */
function renderAges() {
  const m = S.m;
  const banner = $('#banner'), isLost = lost();
  // the banner ticks every second, so it is not a live region: #map-live says "No contact" once, and "Contact with mission
  // control is back." once when it returns, then clears (map-words.js contactNotice)
  const said = notice(isLost, performance.now());
  if ($('#map-live').textContent !== said) $('#map-live').textContent = said;
  if (isLost) {
    // before the first answer, from when the page started asking (as the header and Status count), never from the first abort
    const f = p.receivedAt != null ? p.elapsed() / 1000 : (performance.now() - p.startedAt) / 1000;
    const at = p.last ? fmt.clock(p.last.now, p.last.now) : null;   // the server's clock, as Status says it
    banner.innerHTML = `${mark('unknown')}<span><b>No contact with mission control for ${fmt.nb(dur(f))}.</b> ${at ? `Everything below is as it was at ${at}; every box shows its last answer.` : 'Nothing below is known until it answers.'}</span>`;
    banner.hidden = false;
  } else banner.hidden = true;
  renderMini(model());
  const conn = $('#connecting');
  if (!p.last) conn.textContent = isLost ? "This page can't reach mission control." : performance.now() - p.startedAt > WARN_MS ? 'No answer from mission control yet…' : 'Connecting to mission control…';
  const fromEl = $('#chainFrom');
  if (m) {
    const bc = itemOf(m, 'bitcube'), pr = m.sources.probe;
    const age = pr?.age_s != null ? pr.age_s + elapsedS() : null;
    fromEl.textContent = age != null ? `bitcube checked ${fmt.nb(dur(age))} ago` : bc ? `bitcube ${bc.level === 'down' ? 'offline' : 'not checked yet'}` : '';
    fromEl.className = `from ${age != null && age > 120 ? 'old' : ''}`;
  } else fromEl.textContent = '';
  if (S.openBox) renderSheet();
}

/** The links as SVG over the grid: one bezier with an arrowhead per link, its pill at the middle. Vertical on a phone
 *  (except nothing), horizontal on wide screens (except bitcube → TouchDesigner, which stack). */
function drawLinks() {
  const m = S.m, svg = $('#lks'), wrap = $('#nodes');
  if (!svg || !wrap) return;
  const W = wrap.offsetWidth, H = wrap.offsetHeight;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  const base = wrap.getBoundingClientRect();
  const rect = (id) => { const r = wrap.querySelector(`[data-box="${id}"]`).getBoundingClientRect(); return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isWide = wide();
  let out = `<defs>${['ok', 'warning', 'down', 'unknown'].map((l) => `<marker id="arrow-${l}" class="lv-${l}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow" d="M0,0 L10,5 L0,10 z"/></marker>`).join('')}</defs>`;
  const pills = [];
  for (const l of LINKS) {
    const a = rect(l.from), b = rect(l.to), it = m ? itemOf(m, l.item) : null;
    const lvl = shownLevel(it), stale = !!it?.stale;   // a link from a last answer is grey, never green
    const vertical = isWide ? (l.from === 'bitcube' && l.to === 'td') : true;
    let x1, y1, x2, y2;
    if (vertical) {
      const down = b.y > a.y, cx = a.w <= b.w ? a.x + a.w / 2 : b.x + b.w / 2;
      x1 = clamp(cx, a.x + 24, a.x + a.w - 24); x2 = clamp(cx, b.x + 24, b.x + b.w - 24);
      y1 = down ? a.y + a.h : a.y; y2 = down ? b.y : b.y + b.h;
    } else {
      const right = b.x > a.x, cy = a.h <= b.h ? a.y + a.h / 2 : b.y + b.h / 2;
      y1 = clamp(cy, a.y + 18, a.y + a.h - 18); y2 = clamp(cy, b.y + 18, b.y + b.h - 18);
      x1 = right ? a.x + a.w : a.x; x2 = right ? b.x : b.x + b.w;
    }
    const d = vertical ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
    out += `<path class="lk lv-${lvl} ${stale ? 'stale' : ''}" d="${d}" marker-end="url(#arrow-${lvl})"/>`;
    pills.push({ lvl, stale, x: (x1 + x2) / 2, y: (y1 + y2) / 2, text: m ? linkWord(l, it, m) : 'not known', short: m ? linkWordNow(l, it, m) : 'not known' });
  }
  for (const q of pills) out += `<g class="pill lv-${q.lvl} ${q.stale ? 'stale' : ''}"><title>${esc(q.text)}</title><rect rx="10"/><text x="${q.x}" y="${q.y}" text-anchor="middle" dominant-baseline="central">${esc(q.text)}</text></g>`;
  svg.innerHTML = out;
  const gs = [...svg.querySelectorAll('g.pill')];
  const place = (g) => {
    const t = g.querySelector('text'), r = g.querySelector('rect'), bb = t.getBBox();
    let x = bb.x - 8;
    if (x < 0) { t.setAttribute('x', +t.getAttribute('x') - x); x = 0; }
    if (x + bb.width + 16 > W) { t.setAttribute('x', +t.getAttribute('x') - (x + bb.width + 16 - W)); x = W - bb.width - 16; }
    r.setAttribute('x', x); r.setAttribute('y', bb.y - 4); r.setAttribute('width', bb.width + 16); r.setAttribute('height', bb.height + 8);
    return { x, y: bb.y - 4, w: bb.width + 16, h: bb.height + 8 };
  };
  const boxes = gs.map(place);
  // a pill from a last answer says so ("running · last answer", R8 #33) where it fits; pills that would overlap side by side on a
  // narrow phone keep their short word (grey, its title and the links list still say "last answer")
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  gs.forEach((g, i) => {
    if (pills[i].text === pills[i].short || !boxes.some((b, j) => j !== i && hit(boxes[i], b))) return;
    const t = g.querySelector('text');
    t.textContent = pills[i].short; t.setAttribute('x', pills[i].x);
    place(g);
  });
}
addEventListener('resize', () => requestAnimationFrame(drawLinks));

// ---- the sheet: the box's own item, its sub-items, the link on its arrow, and the lines for Will ----------------
const srcKey = (it) => (it.checked_from === 'bitcube' ? 'probe' : it.checked_from === 'modal' ? 'modal' : SOURCE_OF[it.id] ?? null);
function itemRow(m, id, extra = '') {
  const it = itemOf(m, id), ny = notYet(it), lvl = ny ? 'unknown' : shownLevel(it);   // a last answer: grey, never green
  return `<div class="r lv-${lvl} ${it?.muted ? 'muted-sub' : ''} ${it?.stale ? 'stale' : ''} ${extra}">${ny ? '<span class="mk lv-unknown" aria-hidden="true">·</span>' : mark(lvl)}<span class="n">${esc(it?.name ?? shortName(id, null))}</span><span class="w">${esc(rowWord(it))}</span>
    <span class="s">${esc(fmt.nb(it?.summary ?? 'Not known yet'))}${it && !it.muted && it.age_s != null ? ` · ${fmt.nb(dur(it.age_s + elapsedS()))} ago` : ''}</span></div>`;
}
function sheetBody(b) {
  const m = S.m, it = itemOf(m, b.item), lvl = shownLevel(it);   // from a last answer: the grey chip, never the green one
  const outLinks = LINKS.filter((l) => l.from === b.id), inLinks = LINKS.filter((l) => l.to === b.id);   // every arrow in, not the first
  const linkRows = outLinks.filter((l) => l.item !== b.item && !(b.subs ?? []).includes(l.item)).map((l) => itemRow(m, l.item, 'lnk-row'));   // clips to Dave: on the arrow
  let html = `<div class="sh">
    <div class="sh-top">${chip(lvl, rowWord(it), it?.stale ? 'stale' : '')}${fromLine(it)}</div>
    <p class="sh-sum">${esc(fmt.nb(it?.summary ?? 'Not known yet'))}</p>
    ${it?.detail ? `<p class="sh-detail">${esc(fmt.nb(it.detail))}</p>` : ''}
    ${it ? sinceLine(it) : ''}
    ${it?.action ? `<div class="todo ${lvl === 'ok' ? 'quiet' : ''}"><div class="label">What to do</div><div class="action">${esc(fmt.nb(mapAction(it.action)))}</div>${pointsAtStatus(it.action) ? `<a class="to-status" href="/status#r-${esc(it.id.replace(/\s+/g, '-'))}">Go to it on Status →</a>` : ''}</div>` : ''}
    <p class="secondary muted">${esc(b.lead)}</p>`;
  const rows = [...(b.subs ?? []).map((id) => itemRow(m, id)), ...linkRows];
  if (rows.length) html += `<div class="rows">${rows.join('')}</div>`;
  if (linkRows.length) html += `<div class="arrow-k">The highlighted row travels on the arrow out of this box.</div>`;
  // Addresses and links (for Will): address, checked from, the words on the arrows, the raw error, the deep links
  const addr = [];
  const line = (name, x) => addr.push(`<div>${esc(name)}: ${x ? `<code>${esc(x)}</code>` : '<span class="muted">no address</span>'}</div>`);
  if (it) line(it.name, it.address);
  for (const id of b.subs ?? []) { const s = itemOf(m, id); if (s) line(s.name, s.address); }
  for (const l of linkRows.length ? outLinks.filter((l) => l.item !== b.item) : []) { const s = itemOf(m, l.item); if (s) line(s.name, s.address); }
  if (it) addr.push(`<div>Checked from: ${esc(CHECK[it.checked_from] ?? it.checked_from)}${it.age_s != null ? ` · ${fmt.nb(dur(it.age_s + elapsedS()))} ago` : ''}${it.stale ? ' · <span class="old">older than it should be</span>' : ''}</div>`);
  const words = [];
  if (m) for (const l of inLinks) words.push(`in from ${BOX[l.from].name}: “${linkWord(l, itemOf(m, l.item), m)}”`);
  for (const l of outLinks) if (m) words.push(`out to ${BOX[l.to].name}: “${linkWord(l, itemOf(m, l.item), m)}”`);
  if (words.length) addr.push(`<div>On the arrows: ${esc(words.join(' · '))}</div>`);
  if (it && m) {
    // the raw error text, from every source this box's answers come through
    const keys = b.id === 'bitcube' ? ['bitcube', 'probe', 'seasons'] : b.id === 'td' ? ['probe', 'seasons'] : b.id === 'mini' ? ['bitcube', 'seasons', 'probe', 'modal'] : [srcKey(it)].filter(Boolean);
    const SRC = { bitcube: "bitcube's quick check", probe: 'the full check', seasons: "the river's year page", modal: 'Modal' };
    const raws = keys.filter((k) => m.sources[k]?.error).map((k) => `<div>raw (${SRC[k]}): <code>${esc(m.sources[k].error)}</code></div>`);
    for (const x of [it, ...(b.subs ?? []).map((id) => itemOf(m, id))]) if (x?.raw) raws.push(`<div>raw (${esc(shortName(x.id, x))}): <code>${esc(x.raw)}</code></div>`);
    if (raws.length) addr.push(...raws);
    else if (it.level !== 'ok' && it.level !== 'unknown') addr.push(`<div class="muted">raw: no error text; the state is read from the answer itself</div>`);
  }
  const mapIds = [b.map, ...(b.subs ?? []).map((id) => SUB_MAP[id])].filter((x, i, a) => x && a.indexOf(x) === i);
  const links = mapIds.map((id, i) => `<a href="/map/#node=${encodeURIComponent(id)}" target="_blank" rel="noopener">${i === 0 ? `${esc(b.name)} on the full map` : `${esc(shortName(SUB_OF_MAP[id], itemOf(m, SUB_OF_MAP[id])))} on the full map`}</a>`);
  links.push('<a href="/status">Status</a>');
  html += `<div class="addr"><div class="label">Addresses and links (for Will)</div>${addr.join('')}<div class="links">${links.join('')}</div></div></div>`;
  return html;
}
function openBox(id) {
  const b = BOX[id];
  if (!b) return;
  S.openBox = id; S.sheetHtml = '';
  const body = el('<div></div>');
  S.sheetEl = body;
  sheet({ title: b.title, body, actions: [{ label: 'Close' }], onClose: () => { if (S.openBox === id) { S.openBox = null; S.sheetEl = null; } } });
  renderSheet();
  if (location.hash.replace(/^#/, '') !== id) history.replaceState(null, '', `#${id}`);
}
function renderSheet() {
  const b = BOX[S.openBox];
  if (!b || !S.sheetEl) return;
  const html = sheetBody(b);
  if (html !== S.sheetHtml) { S.sheetEl.innerHTML = html; S.sheetHtml = html; }
}

// ---- wiring --------------------------------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const box = e.target.closest('[data-box]');
  if (box) openBox(box.dataset.box);
});
tick(renderAges);   // ages only; the boxes re-render only when their words change
$('#legend').innerHTML = ['ok', 'warning', 'down', 'unknown'].map((l) => chip(l, WORD[l], 'small')).join('') +
  '<span class="note">Each box is its own piece; the word on an arrow is what flows along it. A greyed box or arrow shows its last answer: it is older than it should be.</span>';
$('#footLinks').innerHTML = DOC_LINKS.filter(([, h]) => h !== '/map').map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('');
// A deep link: /map#ropes opens that box once the first answer is in (the Status page's "Show on the system map").
// Status links /map#gallery%20camera: decoded first. A link's item (clips to Dave) opens the box its row is in.
const wanted = (() => { try { return decodeURIComponent(location.hash.replace(/^#/, '')); } catch { return ''; } })();
const wantedBox = BOX[wanted] ? wanted : BOXES.find((b) => b.item === wanted || (b.subs ?? []).includes(wanted))?.id ?? LINKS.find((l) => l.item === wanted)?.from ?? null;
if (wantedBox) {
  const id = wantedBox;
  const t = setInterval(() => { if (p.last) { clearInterval(t); openBox(id); } }, 200);
  setTimeout(() => clearInterval(t), 15_000);
}
