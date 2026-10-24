// Studio chat v2 (docs/mission-ui.md, "Studio chat"). The shell (header, tab bar, menu, art) comes from ui.js; this file
// turns the chat's events (GET /api/chat/history, the SSE /api/chat/events) into one card per request, pairs replies with
// their request by id, and keeps the pinned status bar and the composer. Server API unchanged: history, events, send, stop.
import { mountShell, tick, art, fmt, control, confirm, api, esc, md, chip, mark, plainError } from '/ui.js';
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
  startedAt: new Map(),     // id → performance.now() when its 'started' event was seen (for the m:ss)
  lastEventT: null,         // the newest event's t (server clock)
  lostAt: null,             // performance.now() the stream dropped, or null
  everOpen: false,
  pendingSend: null,        // the id the server gave the message we just sent
  open: new Set(),          // request ids whose "N steps" is open
  dirty: new Set(),
};
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
    if (!S.reqs.has(id)) { S.reqs.set(id, { id, t: e.t, text: e.text ?? '', steps: [], texts: [], notices: [] }); S.order.push(id); }
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
    case 'started': r.started = e.t; if (!S.startedAt.has(id)) S.startedAt.set(id, performance.now() - Math.max(0, Date.now() - e.t)); break;
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
  if (!r.started && st && !S.lostAt) return { s: 'unknown' };
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
/** "read X" → "looked at X"; "ran: Y" → Y as what it did; "edited Z" → "changed Z". Returns { text, code, act }. */
function plainStep(raw) {
  let s = String(raw ?? '').trim();
  let m;
  if ((m = s.match(/^read (.+)$/i))) return { text: `looked at ${m[1]}`, act: false };
  if ((m = s.match(/^edited (.+)$/i))) return { text: `changed ${m[1]}`, act: ACTS.test(m[1]) && !/^docs\//i.test(m[1]) };
  if ((m = s.match(/^ran:\s*(.+)$/i))) {
    const y = m[1].trim();
    if (RAW_CMD.test(y)) return { text: /bitcube|ssh/i.test(y) ? 'ran a command on bitcube' : 'ran a command', code: y, act: ACTS.test(y) };
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
const stepHtml = (st, p) => `<div class="step${p.act ? ' act' : ''}"><span class="dot" aria-hidden="true"></span><span>${esc(p.text)}${p.code ? `: <code>${esc(excerpt(p.code, 80))}</code>` : ''}</span></div>`;

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
      ${quiet.length ? `<details class="more" ${S.open.has(r.id) ? 'open' : ''}><summary><span class="chev">›</span>${quiet.length} ${quiet.length === 1 ? 'step' : 'steps'}${acting.length ? ' more' : ''}</summary><div class="steps">${quiet.map(([x, p]) => stepHtml(x, p)).join('')}</div></details>` : ''}
    </div>` : '';
  const lastStep = steps.length ? steps[steps.length - 1][1] : null;
  const working = st.s === 'working' ? `<div class="working-line"><span class="spin" aria-hidden="true"></span><span>Working on it…${lastStep ? ` <span class="now">· just now: ${esc(lastStep.text)}</span>` : ''}</span></div>` : '';
  const reply = r.texts.length ? `<div class="reply">${r.texts.map((t) => md(t)).join('')}</div>` : '';
  const notices = r.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join('');
  let outcome = '';
  if (st.s === 'failed') outcome = `<div class="outcome"><span>The agent stopped: ${esc(st.reason)}.</span><a href="/status">Check Status →</a></div>`;
  else if (st.s === 'stopped') outcome = `<div class="outcome"><span>Stopped at ${esc(fmt.clock(st.t))}; the agent was cut off here.</span></div>`;
  else if (st.s === 'unknown') outcome = `<div class="outcome"><span>Mission control has no ending for this one (it may have restarted).</span></div>`;
  const who = r.orphan ? 'The agent' : 'Someone on the team';
  const level = { done: 'ok', stopped: 'warning', failed: 'down', working: 'working', waiting: 'unknown', unknown: 'unknown' }[st.s];
  return [`req card ${st.s} lv-${level === 'working' ? 'ok' : level}`, `<header class="req-h"><span class="who">${who} · ${esc(fmt.clock(r.t))}</span>${chipFor(r, st)}</header>
    ${r.text ? `<p class="ask">${esc(r.text)}</p>` : ''}${notices}${stepsHtml}${working}${reply}${outcome}`];
}
function renderCard(r) {
  const [cls, html] = cardHtml(r);
  let el = cards.get(r.id);
  if (!el) { el = document.createElement('article'); el.dataset.id = r.id; cards.set(r.id, el); el.addEventListener('toggle', (e) => { if (e.target.matches('details.more')) { if (e.target.open) S.open.add(r.id); else S.open.delete(r.id); } }, true); }
  if (el.className !== cls) el.className = cls;
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
  thread.replaceChildren(...nodes);
  if (stick) scrollToEnd();
}
const dayEls = new Map();
function dayEl(t) { const k = dayKey(t); let el = dayEls.get(k); if (!el) { el = document.createElement('div'); el.className = 'day'; el.setAttribute('role', 'separator'); dayEls.set(k, el); } el.textContent = dayLabel(t); return el; }
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
  else if (!st) html = 'Connecting…';
  else if (st.running) {
    cls += ' working'; mk = 'mk live'; glyph = '•';
    const t0 = S.startedAt.get(st.current?.id);
    const el = t0 != null ? (performance.now() - t0) / 1000 : (performance.now() - S.statusAt) / 1000;
    html = `Working on: ‘${esc(excerpt(st.current?.text, 44))}’ <span class="t">· ${mmss(el)}</span>${st.queue?.length ? `<span class="t"> · ${st.queue.length} waiting</span>` : ''}`;
  } else if (st.queue?.length) { mk = 'mk lv-unknown'; glyph = '…'; html = `${st.queue.length} waiting`; }
  else { mk = 'mk lv-ok'; glyph = '✓'; html = 'Ready'; }
  if (pin.className !== cls) pin.className = cls;
  const mkCls = mk === 'mk live' ? 'mk live mk-accent' : mk;
  if (pinMark.className !== mkCls) pinMark.className = mkCls;
  if (pinMark.textContent !== glyph) pinMark.textContent = glyph;
  if (pinText.innerHTML !== html) pinText.innerHTML = html;
  const q = st?.queue?.length ?? 0;
  const label = q ? 'Stop, and clear the queue' : 'Stop';
  const busy = !!(st?.running || q);
  if (stopCtl.state !== 'pending') stopCtl.update({ label, why: busy ? null : 'nothing is running', confirm: stopConfirm(st) });
}
const stopCtl = control($('stop'), {
  label: 'Stop', kind: 'danger', pending: 'Stopping the agent…', why: 'nothing is running',
  done: (r) => (r?.stopped ? `Stop sent; the request ends in a moment${r.cleared ? ` · ${r.cleared} waiting dropped` : ''}` : r?.cleared ? `${r.cleared} waiting dropped; nothing was running` : 'Nothing was running'),
  fail: "The agent wasn't stopped",
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
    sendShow('failed', `Not sent: ${plainError(e)} (${fmt.clock(Date.now())}). Your message is still in the box.`);
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
  S.statusAt = performance.now();
  if (S.status.running && S.status.current?.id && !S.startedAt.has(S.status.current.id)) S.startedAt.set(S.status.current.id, performance.now());
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
function connect() {
  if (es) { es.close(); es = null; }
  es = new EventSource('/api/chat/events');
  es.addEventListener('chat', (m) => {
    let e; try { e = JSON.parse(m.data); } catch { return; }
    if (take(e)) { shell.setAge(0); layout(); }
  });
  es.addEventListener('status', (m) => {
    let st; try { st = JSON.parse(m.data); } catch { return; }
    shell.setAge(0);
    setStatus(st); layout();
  });
  es.onopen = async () => {
    const wasLost = S.lostAt;
    S.lostAt = null;
    shell.setStale(null);
    if (S.everOpen && wasLost != null) await resync(wasLost);
    S.everOpen = true;
    renderPinned();
  };
  es.onerror = () => {
    if (S.lostAt == null) { S.lostAt = performance.now(); shell.setAge(0); renderPinned(); }
    // the browser retries by itself; if it gave up (readyState CLOSED), start again in 3 s
    if (es.readyState === EventSource.CLOSED) { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 3000); }
  };
}
/** For the screenshot harness only: drop the stream as a lost Wi-Fi link would, so the reconnect path can be exercised
 *  (Chrome's offline emulation leaves an open stream alone). The page then reconnects by itself after 3 s. */
window.mcChatDebug = { drop() { if (es) { es.close(); es = null; } if (S.lostAt == null) { S.lostAt = performance.now(); shell.setAge(0); renderPinned(); } clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 3000); } };
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
(async () => {
  try {
    await fetchHistory();
    shell.setAge(S.lastEventT != null ? Math.max(0, Date.now() - S.lastEventT) : 0);
  } catch (e) {
    thread.replaceChildren(noteEl(`The conversation didn't load: ${plainError(e)}. Trying again…`));
    setTimeout(() => location.reload(), 8000);
    return;
  }
  layout({ all: true });
  scrollToEnd();
  connect();
})();
tick(() => {
  if (S.status?.running && S.lostAt == null) renderPinned();
  if (S.lostAt != null) {
    const s = (performance.now() - S.lostAt) / 1000;
    shell.setStale(s >= 30 ? 'down' : s >= 12 ? 'warning' : null);
  }
});
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !S.everOpen) return;
  // phones pause the stream in the background: catch up, and reopen it if the browser gave up
  if (es && es.readyState === EventSource.CLOSED) connect();
  try { const fresh = await fetchHistory(); if (fresh.length) layout(); } catch { /* the stream will tell */ }
});
