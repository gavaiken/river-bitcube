// Studio chat v2 (docs/mission-ui.md, "Studio chat"). The shell (header, tab bar, menu, art) comes from ui.js; this file
// turns the chat's events (GET /api/chat/history, the SSE /api/chat/events) into one card per request, pairs replies with
// their request by id, and keeps the pinned status bar and the composer. Server API unchanged: history, events, send, stop.
import { mountShell, tick, art, fmt, control, confirm, api, esc, md, chip, mark, plainError, WARN_MS, LOST_MS } from '/ui.js';
import { TZ } from '/model.js';

const $ = (id) => document.getElementById(id);
const shell = mountShell({ page: 'chat', title: 'Studio chat' });
art.setSeason(null);

// ---- state --------------------------------------------------------------------------------------------------
const S = {
  reqs: new Map(),          // id → { id, t, text, started, steps: [], texts: [], notices: [], result, stopped, failed, error }
  order: [],                // request ids in the order they were asked
  seen: new Set(),          // event keys, so history and the live stream never double up
  markers: [],              // { t, text } connection-lost dividers
  status: null,             // studio.status(): { running, current, queue }
  statusAt: 0,              // performance.now() the status arrived
  statusWall: 0,            // Date.now() the status arrived
  startedAt: new Map(),     // id → { at: performance.now(), wall: Date.now() } when it started (for the m:ss; see runS)
  lastEventT: null,         // the newest event's t (server clock)
  lostAt: null,             // performance.now() the stream dropped, or null
  lastEventAt: null,        // { at: performance.now(), wall: Date.now() } of the stream's last event (chat, status or ping)
  everOpen: false,
  pendingSend: null,        // the id the server gave the message we just sent
  open: new Set(),          // request ids whose "N steps" is open
  dirty: new Set(),
};
const pageStart = performance.now();   // when this page started asking (the header's "No answer yet · N s")
/** Seconds since a moment kept as { at: performance.now(), wall: Date.now() }: the larger of the monotonic and the wall clock,
 *  so a phone whose monotonic clock paused in sleep never undercounts a request that has run for an hour. */
const runS = (m) => (m ? Math.max(0, (performance.now() - m.at) / 1000, (Date.now() - m.wall) / 1000) : 0);
const key = (e) => `${e.t}|${e.kind}|${e.id ?? ''}|${(e.text ?? '').length}|${e.ok ?? ''}`;
const excerpt = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4)] ?? 'th'}`;
const touch = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

// ---- events → requests ----------------------------------------------------------------------------------------
let lastOpenId = null;
function take(e) {
  if (!e || typeof e !== 'object') return false;
  const k = key(e);
  if (S.seen.has(k)) return false;
  S.seen.add(k);
  if (typeof e.t === 'number' && (S.lastEventT == null || e.t > S.lastEventT)) S.lastEventT = e.t;
  if (e.kind === 'session') return false;
  let id = e.id ?? (e.kind === 'user' ? `anon-${e.t}` : lastOpenId);
  if (e.kind === 'user') {
    if (!S.reqs.has(id)) { S.reqs.set(id, { id, t: e.t, text: e.text ?? '', steps: [], texts: [], notices: [], arrivedAt: performance.now() }); S.order.push(id); }
    lastOpenId = id;
    S.dirty.add(id);
    if (S.pendingSend === id) { S.pendingSend = null; sendShow('before'); }
    return true;
  }
  if (!id) return false;
  let r = S.reqs.get(id);
  if (!r) { r = { id, t: e.t, text: '', steps: [], texts: [], notices: [], orphan: true }; S.reqs.set(id, r); S.order.push(id); }
  S.dirty.add(id);
  switch (e.kind) {
    case 'started': r.started = e.t; if (!S.startedAt.has(id)) { const ago = Math.max(0, Date.now() - e.t); S.startedAt.set(id, { at: performance.now() - ago, wall: Date.now() - ago }); } break;
    case 'activity': r.steps.push({ t: e.t, text: e.text ?? '' }); break;
    case 'text': if (e.text) r.texts.push(e.text); break;
    case 'notice': r.notices.push(e.text ?? ''); break;
    case 'error': r.error = e.text ?? ''; break;
    case 'result': r.result = { ok: e.ok !== false, text: e.text ?? '', t: e.t, turns: e.turns }; break;
    case 'stopped': r.stopped = e.t; break;
    case 'failed': r.failed = { t: e.t, text: e.text ?? '' }; break;
    default: break;
  }
  return true;
}
/** The ordered requests. */
const reqs = () => S.order.map((id) => S.reqs.get(id)).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

/** A request's state from its events and the live status: waiting (with its place), working, done, stopped, failed, unknown. */
function stateOf(r) {
  if (r.failed) return { s: 'failed', t: r.failed.t, reason: r.failed.text };
  if (r.stopped) return { s: 'stopped', t: r.stopped };
  if (r.result) {
    if (r.result.ok) return { s: 'done', t: r.result.t };
    return { s: 'failed', t: r.result.t, reason: plainFailure(r.result.text || r.error) };
  }
  if (r.error && !S.status?.running) return { s: 'failed', t: r.t, reason: plainFailure(r.error) };
  const st = S.status;
  if (st?.current?.id === r.id) return { s: 'working' };
  const qi = st?.queue?.findIndex((q) => q.id === r.id) ?? -1;
  if (qi >= 0) return { s: 'waiting', place: qi + 1 };
  if (r.started && st && !st.running && !S.lostAt) return { s: 'unknown' };       // the server moved on without a verdict
  // a request newer than the last status (its event came first) is waiting for the status that lists it, not "not finished"
  if (!r.started && st && !S.lostAt) return r.arrivedAt != null && r.arrivedAt > S.statusAt ? { s: 'waiting', place: null } : { s: 'unknown' };
  return r.started ? { s: 'working' } : { s: 'waiting', place: null };
}
/** Why a run failed, in the team's words (the same table as lib/studio.mjs, for history written before 'failed' events). */
function plainFailure(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'the agent stopped with an error';
  if (/ssh|connect to host|port 22|bitcube did not answer|bitcube didn't answer/i.test(s)) return "bitcube didn't answer";
  if (/no claude token|setup-token/i.test(s)) return 'the agent has no token yet';
  if (/timed? ?out|timeout|took too long/i.test(s)) return 'it took too long';
  if (/rate limit|overloaded|529|too many requests/i.test(s)) return 'the agent is busy; try again in a minute';
  if (/quota|budget|credit|billing/i.test(s)) return 'the agent is out of credit';
  if (/network|ENOTFOUND|ECONN|fetch failed/i.test(s)) return "the agent couldn't reach the internet";
  if (/^the agent|^bitcube|^it took/i.test(s)) return s.replace(/[.\s]+$/, '');
  return 'the agent stopped with an error';
}

// ---- activity lines in plain verbs ---------------------------------------------------------------------------------
const PAST = { check: 'checked', run: 'ran', restart: 'restarted', set: 'set', switch: 'switched', list: 'listed', show: 'showed', get: 'got',
  fetch: 'fetched', pull: 'pulled', push: 'pushed', save: 'saved', rebuild: 'rebuilt', start: 'started', stop: 'stopped', open: 'opened',
  read: 'read', look: 'looked', capture: 'captured', take: 'took', grab: 'grabbed', make: 'made', turn: 'turned', send: 'sent', test: 'tested',
  verify: 'verified', compare: 'compared', count: 'counted', find: 'found', search: 'searched', print: 'printed', query: 'queried',
  update: 'updated', install: 'installed', write: 'wrote', create: 'created', delete: 'deleted', remove: 'removed', kill: 'killed',
  tail: 'tailed', ping: 'pinged', inspect: 'inspected', measure: 'measured', confirm: 'confirmed', report: 'reported', wait: 'waited',
  commit: 'committed', build: 'built', render: 'rendered', dim: 'dimmed', raise: 'raised', lower: 'lowered', ask: 'asked', call: 'called' };
const ACTS = /\b(bitcube|touchdesigner|td\.ps1|td_save|probe\.ps1|frames\.ps1|calibrate|rebuild|ropes?|rope box|panels?|hub75|lights?|camera|cam\b|router|switch(ed|ing)?|restart|reboot|brightness|dark|black|season|mode|target|artnet|art-net|sender|boot file|modal|ptz|vnc|screenshot|\/api\/control|start-river|scheduled task)/i;
const RAW_CMD = /[|;&`$<>{}]|^\s*(ssh|scp|powershell|pwsh|python3?|node|git|curl|ffmpeg|ls|cat|grep|tail|head|cd|npm|pytest)\b/;
/** A file the agent read or changed, in plain words ("the calibration script", "the repo's notes"): never a path or a file
 *  name on the page (the raw line stays in the step's tooltip). */
function plainFile(path) {
  const p = String(path ?? '').trim().replace(/\\/g, '/'), f = p.split('/').pop().toLowerCase();
  if (/^calibrate\.(py|ps1)$/.test(f)) return 'the calibration script';
  if (/^(td|td_save|td_mission)\.(ps1|py)$/.test(f)) return 'the TouchDesigner script';
  if (/^probe\.ps1$/.test(f)) return 'the full-check script';
  if (/^frames\.ps1$/.test(f)) return 'the script that reads the lights';
  if (/\.toe$/.test(f)) return 'a show file';
  if (f === 'claude.md') return "the repo's notes";
  if (f === 'glossary.md') return 'the glossary';
  if (/\/sessions\//.test(p)) return 'the session notes';
  if (/plan\.md$/.test(f)) return 'the plan';
  if (/\.md$/.test(f)) return 'the docs';
  if (/^system\.json$/.test(f)) return 'the system map';
  if (/^pixelmap-.*\.json$|^screens-.*\.json$/.test(f)) return 'the LED map';
  if (/(^|\/)mission\//.test(p)) return "mission control's code";
  if (/(^|\/)td\//.test(p)) return "the show file's code";
  if (/(^|\/)tools\/pixelmap\//.test(p)) return 'the LED map tools';
  if (/\.(py|ps1|mjs|js|sh|cmd)$/.test(f)) return 'a script';
  if (/\.(json|ya?ml|ini|cfg|conf)$/.test(f)) return 'a settings file';
  return 'a file';
}
/** "read X" → "looked at <X in words>"; "ran: Y" → Y as what it did; "edited Z" → "changed <Z in words>". Returns { text, act };
 *  a raw command is never shown (the whole line is the step's tooltip). Changing a file is not acting on the installation. */
function plainStep(raw) {
  let s = String(raw ?? '').trim();
  let m;
  if ((m = s.match(/^read (.+)$/i))) return { text: `looked at ${plainFile(m[1])}`, act: false };
  if ((m = s.match(/^edited (.+)$/i))) return { text: `changed ${plainFile(m[1])}`, act: false };
  if ((m = s.match(/^ran:\s*(.+)$/i))) {
    const y = m[1].trim();
    if (RAW_CMD.test(y)) return { text: /bitcube|ssh/i.test(y) ? 'ran a command on bitcube' : 'ran a command', act: ACTS.test(y) };
    const w = y.match(/^([A-Za-z]+)(\b.*)$/);
    const verb = w ? (PAST[w[1].toLowerCase()] ?? w[1].toLowerCase()) : '';
    const text = w ? `${verb}${w[2]}` : y;
    return { text: text.replace(/[.\s]+$/, ''), act: ACTS.test(y) };
  }
  if ((m = s.match(/^synced the repo/i))) return { text: 'brought its copy of the repo up to date', act: false };
  if ((m = s.match(/^couldn't sync the repo/i))) return { text: "couldn't bring its copy of the repo up to date; working from an older copy", act: false };
  if ((m = s.match(/^searched for (.+)$/i))) return { text: `searched for ${m[1]}`, act: false };
  if ((m = s.match(/^searched the web: (.+)$/i))) return { text: `searched the web for ${m[1]}`, act: false };
  if ((m = s.match(/^fetched (.+)$/i))) return { text: `fetched ${m[1]}`, act: false };
  if ((m = s.match(/^asked a helper: (.+)$/i))) return { text: `asked a helper to ${m[1].replace(/^[A-Z]/, (c) => c.toLowerCase())}`, act: false };
  if ((m = s.match(/^used (.+)$/i))) return { text: `used ${m[1]}`, act: false };
  return { text: s, act: false };
}

// ---- rendering ----------------------------------------------------------------------------------------------------
const thread = $('thread');
const cards = new Map();   // id → element
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' });
function dayKey(t) { try { return dayFmt.format(new Date(t)); } catch { return ''; } }
function dayLabel(t) {
  const k = dayKey(t), today = dayKey(Date.now()), yest = dayKey(Date.now() - 86400e3);
  if (k === today) return 'Today';
  if (k === yest) return 'Yesterday';
  return k.replace(/ \d{4}$/, (y) => (y.trim() === String(new Date().getFullYear()) ? '' : y));
}
const stepHtml = (st, p) => `<div class="step${p.act ? ' act' : ''}"><span class="dot" aria-hidden="true"></span><span title="${esc(excerpt(st.text, 200))}">${esc(p.text)}</span></div>`;

function chipFor(r, st) {
  switch (st.s) {
    case 'done': return chip('ok', `Done ${fmt.clock(st.t)}`);
    case 'stopped': return chip('warning', 'Stopped');
    case 'failed': return chip('down', `Failed: ${st.reason}`);
    case 'working': return `<span class="chip working"><span class="mk live" aria-hidden="true">•</span><span>Working</span></span>`;
    case 'waiting': return chip('unknown', st.place ? `Waiting (${ordinal(st.place)} in line)` : 'Waiting');
    default: return chip('unknown', 'Not finished');
  }
}
function cardHtml(r) {
  const st = stateOf(r);
  const steps = r.steps.map((x) => [x, plainStep(x.text)]);
  const acting = steps.filter(([, p]) => p.act), quiet = steps.filter(([, p]) => !p.act);
  const stepsHtml = steps.length ? `<div class="steps">
      ${acting.map(([x, p]) => stepHtml(x, p)).join('')}
      ${quiet.length ? `<details class="more" ${S.open.has(r.id) ? 'open' : ''}><summary aria-label="${esc(`${quiet.length} ${acting.length ? 'more ' : ''}${quiet.length === 1 ? 'step' : 'steps'} for ‘${excerpt(r.text || 'this request', 50)}’`)}"><span class="chev" aria-hidden="true">›</span>${quiet.length} ${quiet.length === 1 ? 'step' : 'steps'}${acting.length ? ' more' : ''}</summary><div class="steps">${quiet.map(([x, p]) => stepHtml(x, p)).join('')}</div></details>` : ''}
    </div>` : '';
  const lastStep = steps.length ? steps[steps.length - 1][1] : null;
  const working = st.s === 'working' ? `<div class="working-line"><span class="spin" aria-hidden="true"></span><span>Working on it…${lastStep ? ` <span class="now">· just now: ${esc(lastStep.text)}</span>` : ''}</span></div>` : '';
  const reply = r.texts.length ? `<div class="reply">${r.texts.map((t) => md(t)).join('')}</div>` : '';
  const notices = r.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join('');
  let outcome = '';
  if (st.s === 'failed') outcome = `<div class="outcome"><span>The agent stopped: ${esc(st.reason)}.</span><a href="/status">Check Status →</a></div>`;
  else if (st.s === 'stopped') outcome = `<div class="outcome"><span>Stopped at ${esc(fmt.clock(st.t))}; the agent was cut off here.</span></div>`;
  else if (st.s === 'unknown') outcome = `<div class="outcome"><span>Mission control didn't record how this ended.</span></div>`;
  const who = r.orphan ? 'The agent' : 'Someone on the team';
  const level = { done: 'ok', stopped: 'warning', failed: 'down', working: 'working', waiting: 'unknown', unknown: 'unknown' }[st.s];
  return [`req card ${st.s} lv-${level === 'working' ? 'ok' : level}`, `<header class="req-h"><span class="who">${who} · ${esc(fmt.clock(r.t))}</span>${chipFor(r, st)}</header>
    ${r.text ? `<p class="ask" id="${askId(r.id)}">${esc(r.text)}</p>` : ''}${notices}${stepsHtml}${working}${reply}${outcome}`];
}
/** The id of a request's ask paragraph: its card (an <article>) is named by it, for a screen reader's list of articles. */
const askId = (id) => `ask-${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}`;
function renderCard(r) {
  const [cls, html] = cardHtml(r);
  let el = cards.get(r.id);
  if (!el) { el = document.createElement('article'); el.dataset.id = r.id; cards.set(r.id, el); if (r.text) el.setAttribute('aria-labelledby', askId(r.id)); el.addEventListener('toggle', (e) => { if (e.target.matches('details.more')) { if (e.target.open) S.open.add(r.id); else S.open.delete(r.id); } }, true); }
  if (el.className !== cls) el.className = cls;
  // while it works the card changes at every step: busy, so the log (role="log") reads it once when it settles, not each time
  const busy = /\b(working|waiting)\b/.test(cls);
  if (busy) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  return el;
}
function layout({ all = false } = {}) {
  const list = reqs();
  const stick = atBottom();
  const nodes = [];
  let day = null;
  const markers = [...S.markers].sort((a, b) => a.t - b.t);
  let mi = 0;
  const pushMarkers = (upTo) => { while (mi < markers.length && markers[mi].t <= upTo) { nodes.push(markerEl(markers[mi])); mi++; } };
  for (const r of list) {
    if (all || S.dirty.has(r.id) || !cards.has(r.id)) renderCard(r);
    pushMarkers(r.t);
    const k = dayKey(r.t);
    if (k !== day) { day = k; nodes.push(dayEl(r.t)); }
    nodes.push(cards.get(r.id));
  }
  pushMarkers(Infinity);
  if (!list.length) nodes.push(noteEl(S.status ? 'No one has asked anything yet. Say who you are and ask the agent to look at something.' : 'Loading the conversation…'));
  S.dirty.clear();
  // patch the thread in place: a node already where it belongs stays, so the log (role="log") announces only what is
  // new, never the whole conversation again
  for (let i = 0; i < nodes.length; i++) if (thread.children[i] !== nodes[i]) thread.insertBefore(nodes[i], thread.children[i] ?? null);
  while (thread.children.length > nodes.length) thread.lastElementChild.remove();
  if (stick) scrollToEnd();
  // the conversation is loaded in one go (chat.html starts the log busy): only what is added after this is announced
  if (S.status && thread.getAttribute('aria-busy')) requestAnimationFrame(() => thread.removeAttribute('aria-busy'));
}
const dayEls = new Map();
function dayEl(t) { const k = dayKey(t); let el = dayEls.get(k); if (!el) { el = document.createElement('div'); el.className = 'day'; el.setAttribute('role', 'separator'); dayEls.set(k, el); } const l = dayLabel(t); if (el.textContent !== l) el.textContent = l; return el; }
const markerEls = new Map();
function markerEl(m) { let el = markerEls.get(m); if (!el) { el = document.createElement('div'); el.className = 'gap-mark'; el.innerHTML = `${mark('unknown')}<span>${esc(m.text)}</span>`; markerEls.set(m, el); } return el; }
function noteEl(text) { const el = document.createElement('p'); el.className = 'muted thread-note'; el.textContent = text; return el; }
function atBottom() { return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200; }
function scrollToEnd() { requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' })); }

// ---- the pinned status bar and Stop ---------------------------------------------------------------------------------
const pin = $('pinned'), pinMark = $('pin-mark'), pinText = $('pin-text');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function renderPinned() {
  const st = S.status;
  const lost = S.lostAt != null;
  let cls = 'pinned', mk = 'mk lv-unknown', glyph = '?', html;
  if (lost) { cls += ' lost'; html = `Reconnecting to mission control…${st?.running ? ` (the agent was working on ‘${esc(excerpt(st.current?.text, 40))}’)` : ''}`; }
  else if (!st) {
    // before the first answer, by the header's thresholds (ui.js WARN_MS, LOST_MS) from when the page started asking
    const ms = performance.now() - pageStart;
    if (ms > LOST_MS) { cls += ' lost'; html = "This page can't reach mission control"; }
    else html = ms > WARN_MS ? 'No answer from mission control yet' : 'Connecting…';
  }
  else if (st.running) {
    cls += ' working'; mk = 'mk live'; glyph = '•';
    const t0 = S.startedAt.get(st.current?.id);
    const el = runS(t0 ?? { at: S.statusAt, wall: S.statusWall });
    html = `Working on: ‘${esc(excerpt(st.current?.text, 44))}’ <span class="t">· ${mmss(el)}</span>${st.queue?.length ? `<span class="t"> · ${st.queue.length} waiting</span>` : ''}`;
  } else if (st.queue?.length) { mk = 'mk lv-unknown'; glyph = '…'; html = `${st.queue.length} waiting`; }
  else { mk = 'mk lv-ok'; glyph = '✓'; html = 'Ready'; }
  if (pin.className !== cls) pin.className = cls;
  const mkCls = mk === 'mk live' ? 'mk live mk-accent' : mk;
  if (pinMark.className !== mkCls) pinMark.className = mkCls;
  if (pinMark.textContent !== glyph) pinMark.textContent = glyph;
  if (pinText.innerHTML !== html) pinText.innerHTML = html;
  // screen readers hear the bar's state word when it changes, never its ticking m:ss (chat.html #pin-live)
  const said = lost ? 'Reconnecting to mission control' : !st ? (performance.now() - pageStart > LOST_MS ? "This page can't reach mission control" : '') : st.running ? `Working on: ${excerpt(st.current?.text, 60)}` : st.queue?.length ? `${st.queue.length} waiting` : 'Ready';
  const live = $('pin-live');
  if (live && live.textContent !== said) live.textContent = said;
  const q = st?.queue?.length ?? 0;
  const label = q ? 'Stop, and clear the queue' : 'Stop';
  const busy = !!(st?.running || q);
  if (stopCtl.state !== 'pending') stopCtl.update({ label, why: busy ? null : 'nothing is running', confirm: stopConfirm(st) });
}
const stopCtl = control($('stop'), {
  label: 'Stop', kind: 'danger', pending: 'Stopping the agent…', why: 'nothing is running',
  done: (r) => (r?.stopped ? `Stop sent; the request ends in a moment${r.cleared ? ` · ${r.cleared} waiting dropped` : ''}` : r?.cleared ? `${r.cleared} waiting dropped; nothing was running` : 'Nothing was running'),
  fail: "The agent wasn't stopped", noAnswer: 'the bar above shows whether the agent is still working',
  run: async () => api('/api/chat/stop', { clear: (S.status?.queue?.length ?? 0) > 0 }),     // Stop, and clear the queue: the waiting ones are dropped too
});
/** The confirm names the cost: the running request ends half done; with a queue, the waiting ones are dropped too. */
function stopConfirm(st) {
  const q = st?.queue?.length ?? 0;
  const cur = st?.current?.text ? `‘${excerpt(st.current.text, 60)}’` : 'the current request';
  return { title: q ? 'Stop the agent, and the queue?' : 'Stop the agent?',
    body: `The agent stops ${cur} now, half done; anything it already changed stays changed.` + (q
      ? ` The ${q} waiting ${q === 1 ? 'request is' : 'requests are'} dropped and never ${q === 1 ? 'starts' : 'start'}; send ${q === 1 ? 'it' : 'them'} again later if still wanted.`
      : ''),
    ok: q ? 'Stop, and clear the queue' : 'Stop', cancel: 'Let it finish' };
}
// the control's own status line lives under the bar, not inside it
$('stop-status').replaceWith($('stop-host').querySelector('.ctl-status'));

// ---- the composer: send; Return makes a new line on touch -------------------------------------------------------------
const text = $('text'), sendBtn = $('send'), sendStatus = $('send-status');
function sendShow(state, msg = '') {
  sendStatus.className = `ctl-status ${state === 'before' ? '' : state}`;
  sendStatus.innerHTML = state === 'before' ? '' : `${state === 'pending' ? '<span class="spin" aria-hidden="true"></span>' : ''}<span>${esc(msg)}</span>`;
  sendBtn.disabled = state === 'pending' || !text.value.trim();
}
function autogrow() { text.style.height = 'auto'; text.style.height = `${Math.min(160, Math.max(48, text.scrollHeight))}px`; }
let sending = false;
async function send() {
  const t = text.value.trim();
  if (!t || sending) return;
  sending = true;
  sendShow('pending', 'Sending…');
  try {
    const r = await api('/api/chat/send', { text: t });
    S.pendingSend = r?.id ?? null;
    text.value = ''; autogrow();
    sendShow('pending', 'Sent; waiting for it to show up…');
    if (r?.status) setStatus(r.status);
    setTimeout(() => { if (S.pendingSend === r?.id) { S.pendingSend = null; sendShow('before'); } }, 6000);
    text.focus({ preventScroll: true });
  } catch (e) {
    sendShow('failed', e?.noAnswer
      ? `No answer in ${fmt.dur(e.waitedS)}: it may or may not have been sent; look for it above before sending again (${fmt.clock(Date.now())}). Your message is still in the box.`
      : `Not sent: ${plainError(e)} (${fmt.clock(Date.now())}). Your message is still in the box.`);
  } finally { sending = false; if (sendStatus.className.includes('failed')) sendBtn.disabled = !text.value.trim(); }
}
sendBtn.addEventListener('click', send);
text.addEventListener('input', () => { autogrow(); if (!sending) sendBtn.disabled = !text.value.trim(); if (sendStatus.className.includes('failed') && text.value.trim()) sendShow('before'); });
text.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (touch()) return;                    // on a phone or tablet Return makes a new line; only Send sends
  if (e.shiftKey) return;
  e.preventDefault(); send();
});
sendBtn.disabled = true;
autogrow();

// the composer's height sets the room the thread leaves at the bottom
const composer = $('composer');
new ResizeObserver(() => document.querySelector('main.chat').style.setProperty('--composer-h', `${composer.offsetHeight}px`)).observe(composer);

// ---- status, history, the stream --------------------------------------------------------------------------------------
function setStatus(st) {
  if (!st || typeof st !== 'object') return;
  const before = S.status;
  S.status = { running: !!st.running, current: st.current ?? null, queue: Array.isArray(st.queue) ? st.queue : [] };
  S.statusAt = performance.now(); S.statusWall = Date.now();
  if (S.status.running && S.status.current?.id && !S.startedAt.has(S.status.current.id)) S.startedAt.set(S.status.current.id, { at: performance.now(), wall: Date.now() });
  // every request's chip depends on the status (waiting places, working), so they are all dirty
  for (const id of S.order) { const r = S.reqs.get(id); if (r && !r.result && !r.stopped && !r.failed) S.dirty.add(id); }
  if (before?.current?.id && before.current.id !== S.status.current?.id) {
    S.dirty.add(before.current.id);
    if (stopCtl.state === 'done') setTimeout(() => stopCtl.show('before'), 2500);
  }
  renderPinned();
}
async function fetchHistory() {
  const h = await api('/api/chat/history?limit=500');
  const fresh = [];
  for (const e of h.events ?? []) if (take(e)) fresh.push(e);
  if (h.status) setStatus(h.status);
  return fresh;
}
let es = null, reconnectTimer = null;
/** Seconds since the stream's last event: the larger of the monotonic and the wall clock (a phone that slept). */
const sinceEventS = () => (S.lastEventAt ? Math.max(0, (performance.now() - S.lastEventAt.at) / 1000, (Date.now() - S.lastEventAt.wall) / 1000) : 0);
/** The stream said something (a message, a status, the server's 25 s ping): the header's age means the connection. */
function heard() { S.lastEventAt = { at: performance.now(), wall: Date.now() }; if (S.lostAt == null) shell.setAge(0); }
/** The stream is gone (an error, or silent past STREAM_SILENT_S): lost since its last event, never "just now". */
function lose() {
  if (S.lostAt != null) return;
  S.lostAt = S.lastEventAt ? performance.now() - sinceEventS() * 1000 : performance.now();
  shell.setAge(sinceEventS() * 1000);
  renderPinned(); tickLost();
}
const STREAM_SILENT_S = 40;   // the server pings every 25 s: 40 s of nothing is a stalled connection (a half-open link, a buffering proxy)
function connect() {
  if (es) { es.close(); es = null; }
  es = new EventSource('/api/chat/events');
  S.lastEventAt ??= { at: performance.now(), wall: Date.now() };
  es.addEventListener('chat', (m) => {
    heard();
    let e; try { e = JSON.parse(m.data); } catch { return; }
    if (take(e)) layout();
  });
  es.addEventListener('ping', () => heard());
  es.addEventListener('status', (m) => {
    heard();
    let st; try { st = JSON.parse(m.data); } catch { return; }
    setStatus(st); layout();
  });
  es.onopen = async () => {
    const wasLost = S.lostAt;
    S.lostAt = null;
    heard();
    shell.setStale(null); shell.setAge(0);
    if (S.everOpen && wasLost != null) await resync(wasLost);
    S.everOpen = true;
    renderPinned();
  };
  es.onerror = () => {
    lose();
    // the browser retries by itself; if it gave up (readyState CLOSED), start again in 3 s
    if (es?.readyState === EventSource.CLOSED) { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 3000); }
  };
}
/** The watchdog: a stream that stalls never fires onerror, so silence past STREAM_SILENT_S counts as lost: reconnect, and
 *  catch up from the history meanwhile (the reply may already be there). */
function watchStream() {
  if (S.lostAt != null || !es || sinceEventS() <= STREAM_SILENT_S) return;
  lose();
  es.close(); es = null;
  clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 500);
  fetchHistory().then((fresh) => { if (fresh.length) layout(); }).catch(() => { /* the reconnect will tell */ });
}
/** For the screenshot harness only: drop the stream as a lost Wi-Fi link would, so the reconnect path can be exercised
 *  (Chrome's offline emulation leaves an open stream alone). The page then reconnects by itself after 3 s. */
window.mcChatDebug = { drop() { if (es) { es.close(); es = null; } lose(); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 3000); } };
/** After the stream came back: re-fetch the history and mark what ran while this page was away. */
async function resync(lostAtPerf) {
  const lostForS = (performance.now() - lostAtPerf) / 1000;
  let fresh = [];
  try { fresh = await fetchHistory(); } catch { /* the stream carries on; the next status fills the gap */ }
  const ran = new Set(fresh.filter((e) => ['started', 'result', 'stopped', 'failed'].includes(e.kind) && e.id).map((e) => e.id));
  const n = ran.size;
  const at = Date.now() - lostForS * 1000;
  const text = `Connection lost for ${fmt.dur(lostForS)} · ${n ? `${n} ${n === 1 ? 'request' : 'requests'} ran while you were away` : 'nothing ran while you were away'}`;
  S.markers.push({ t: at, text });
  layout({ all: true });
}

// ---- go ------------------------------------------------------------------------------------------------------------
// Before the first answer the header counts the wait as every page does ("Connecting…", then "No answer yet · N s", amber
// from 12 s, red from 30 s), from when the page started asking; a failed load is retried in place, so the count carries on.
const startedAt = pageStart;
let loaded = false, loadWhy = null;
/** The failed load's note, its wait counted from when the page started asking, as the header counts it (it ticks). */
function paintLoadNote() {
  if (loaded || loadWhy == null) return;
  const t = `The conversation hasn't loaded: ${loadWhy} (waiting ${fmt.dur((performance.now() - startedAt) / 1000)} so far). Trying again…`;
  const el = thread.querySelector('.thread-note');
  if (el && thread.children.length === 1) { if (el.textContent !== t) el.textContent = t; } else thread.replaceChildren(noteEl(t));
}
function tickWaiting() {
  if (loaded) return;
  const ms = performance.now() - startedAt;
  shell.setWaiting(startedAt);
  shell.setStale(ms > LOST_MS ? 'down' : ms > WARN_MS ? 'warning' : null);
  paintLoadNote(); renderPinned();
}
tick(tickWaiting);
(async function load() {
  try {
    await fetchHistory();
  } catch (e) {
    // a request that hung says only that nothing answered: the wait beside it is the page's, not that one request's
    loadWhy = e?.noAnswer ? 'no answer from mission control' : plainError(e);
    paintLoadNote();
    setTimeout(load, 8000);
    return;
  }
  loaded = true;
  shell.setStale(null); shell.setAge(0);   // the age means the connection (history just answered), never the last message's
  layout({ all: true });
  scrollToEnd();
  connect();
})();
// the skip link: straight to the request box, past the whole conversation
$('skip').addEventListener('click', (e) => { e.preventDefault(); text.focus(); text.scrollIntoView({ block: 'nearest' }); });
/** While lost: the header counts from the stream's last event (amber from 12 s, red from 30 s), the same rule as the other pages. */
function tickLost() {
  if (S.lostAt == null) return;
  const s = sinceEventS();
  shell.setStale(s > 30 ? 'down' : s > 12 ? 'warning' : null);
}
tick(() => {
  if (S.status?.running && S.lostAt == null) renderPinned();
  watchStream();
  tickLost();
});
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !S.everOpen) return;
  // phones pause the stream in the background: catch up, and reopen it if the browser gave up
  if (es && es.readyState === EventSource.CLOSED) connect();
  try { const fresh = await fetchHistory(); if (fresh.length) layout(); } catch { /* the stream will tell */ }
});
