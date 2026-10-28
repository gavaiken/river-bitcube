// Mission control: the Remembered river page (/remembered; docs/mission-ui.md "Remembered river page"). The team's realtime debug
// view of river-remembered.toe (docs/remembered-river.md): what goes in (Dave's agent, the river camera, the room), what the loop
// decides and why, what comes out (the lights, the 30 % rule, the ropes' watts), and its two controls. Every word comes from
// remembered-words.js (pure, tested); the frames are drawn by the Lights page's own frames-view.js; the controls follow "Applying a
// change" through ui.js control(), with the model's reasons (model.js controls['remembered-zones'|'remembered-opening']).
// GET /api/remembered every 2 s, /api/status every 5 s, /api/lights every 4 s, the stills every 30 s. Plain ES module, no build step.
import { mountShell, poll, tick, watchContact, art, fmt, control, api, esc, DOC_LINKS, serverNow } from '/ui.js';
import { fetchTimed } from '/app.js';
import { derive, changeLabel, dur, EXPECT_S, REMEMBERED_POOL_M, REMEMBERED_ONLY } from '/model.js';
import { decodeLights, fitCanvas, paintStrips, paintScreens, paintEmpty, litMeterHTML } from '/frames-view.js';
import { rememberedView, dayStripSVG, mss, hourWords, dateWords, PANEL_RULE_PCT } from '/remembered-words.js';

const REM_MS = 2000, LIGHTS_MS = 4000, STILL_MS = 30_000;
const $ = (s) => document.querySelector(s);
const since = (at) => (at == null ? 0 : (performance.now() - at) / 1000);
const S = { m: null, rem: null, remAt: null, remError: null, v: null, lights: null, lightsAt: null, lightsError: null, fetching: {}, pool: null, poolTouched: false, video: null, videoTouched: false, html: {} };
const put = (id, html) => { if (S.html[id] !== html) { S.html[id] = html; const el = document.getElementById(id); if (el) el.innerHTML = html; } };

const shell = mountShell({ page: 'remembered', title: 'Remembered river' });
const status = poll('/api/status', { every: 5000, onData: () => { S.m = derive(status.last, serverNow()); render(); judge(); }, onError: () => render() });
const contact = watchContact(status, shell, () => render());

// ---- reading -----------------------------------------------------------------------------------------------------------------
async function pollRemembered() {
  if (document.hidden || S.fetching.rem) return;
  S.fetching.rem = true;
  try {
    const { r, body } = await fetchTimed('/api/remembered');
    if (r.status === 401) { location.href = '/login'; return; }
    if (!r.ok || body?.ok === false) { S.remError = body?.error ?? `mission control answered ${r.status}`; }
    else { S.rem = body; S.remAt = performance.now(); S.remError = null; }
  } catch (e) { S.remError = e?.message ?? 'no answer'; }
  finally { S.fetching.rem = false; }
  render();
}
async function pollLights() {
  if (document.hidden || S.fetching.lights) return;
  S.fetching.lights = true;
  try {
    const { r, body } = await fetchTimed('/api/lights');
    const f = body?.frames;
    if (!r.ok || body?.ok === false || !f?.ropes?.rgb || !f?.panels?.rgb) S.lightsError = body?.error ?? 'no frames';
    else { S.lights = decodeLights(f); S.lightsAt = performance.now(); S.lightsError = null; }
  } catch (e) { S.lightsError = e?.message ?? 'no frames'; }
  finally { S.fetching.lights = false; }
  drawLights();
}
function stills() {
  if (document.hidden) return;
  for (const cam of ['river', 'gallery']) {
    const img = $(cam === 'river' ? '#river-img' : '#room-img'), none = $(cam === 'river' ? '#river-none' : '#room-none');
    const probe = new Image();
    probe.onload = () => { img.src = probe.src; img.hidden = false; none.hidden = true; };
    probe.onerror = () => { if (img.hidden) none.textContent = `No picture from the ${cam === 'river' ? 'river' : 'gallery'} camera right now`; };
    probe.src = `/api/camera/${cam}.jpg?t=${Date.now()}`;
  }
}

// ---- render ------------------------------------------------------------------------------------------------------------------
function render() {
  const v = S.rem ? rememberedView(S.rem, { now: serverNow(), sinceS: since(S.remAt) }) : null;
  S.v = v;
  art.setSeason(null);
  renderNow(v); renderDave(v); renderRiver(v); renderRoom(v); renderDecision(v); renderOutputs(v); renderControls(v); renderFooter();
}

function renderNow(v) {
  const sec = $('#now');
  const phase = $('#now-phase'), line = $('#now-line'), nr = $('#now-notrunning');
  const pageDown = contact.lost;
  if (!v) {
    phase.textContent = S.remError ? "Can't read the remembered river" : 'Connecting…';
    phase.className = 'phase';
    line.textContent = S.remError ? `${S.remError[0].toUpperCase()}${S.remError.slice(1)}. It tries again every 2 s.` : '';
    nr.hidden = true;
  } else if (v.running) {
    phase.textContent = v.phase ? v.phase[0].toUpperCase() + v.phase.slice(1) : 'Running';
    phase.className = `phase ph-${v.phase ?? 'none'}`;
    const day = v.day?.dateWords ? `${v.day.dateWords}${v.day.fromDave ? " (Dave's day)" : ' (a notable day)'}` : 'a remembered day';
    line.innerHTML = `${v.loop ? `<b>${esc(v.loop.words)}</b> of the loop` : 'The loop'} · reliving ${esc(day)}${v.hour != null ? ` at <b>${esc(hourWords(v.hour))}</b>` : ''}`;
    nr.hidden = true;
  } else {
    phase.textContent = v.inLooks ? "The remembered river isn't the look showing" : "The remembered river isn't running";
    phase.className = 'phase ph-off';
    line.textContent = '';
    nr.textContent = v.notRunning; nr.hidden = false;
  }
  const bar = $('#now-loopbar');
  bar.hidden = !v?.loop;
  if (v?.loop) {
    bar.querySelector('.fill').style.width = `${(v.loop.frac * 100).toFixed(1)}%`;
    const s = bar.querySelector('.surge');
    s.hidden = !(v.surge && !v.surge.dry && v.surge.t_s != null);
    if (!s.hidden) s.style.left = `${(Math.min(1, v.surge.t_s / v.loop.length) * 100).toFixed(1)}%`;
  }
  const age = S.remAt == null ? null : (S.rem?.age_s ?? 0) + since(S.remAt);
  const from = $('#now-from');
  from.textContent = age == null ? '' : `From bitcube · ${fmt.nb(dur(age))} ago${v?.running && v.statusAgeS != null && v.statusAgeS > 2 ? ` · TouchDesigner's status ${fmt.nb(dur(v.statusAgeS))} old` : ''}${S.remError && v ? ` · last read failed: ${S.remError}` : ''}`;
  from.classList.toggle('old', age != null && age > 10);
  sec.classList.toggle('dim', pageDown || (age != null && age > 10));
  const pr = $('#now-problems');
  pr.hidden = !v?.problems?.length;
  put('now-problems', (v?.problems ?? []).map((p) => `<li>${esc(p)}</li>`).join(''));
}

const KNOB_WORDS = { speed: 'Speed', density: 'Density', brightness: 'Brightness', turbulence: 'Turbulence' };
function renderDave(v) {
  if (!v) return put('dave-body', `<p class="muted">${S.remError ? "Can't read Dave's agent's choice from bitcube." : 'Waiting for bitcube…'}</p>`);
  const d = v.dave;
  if (!d.present) return put('dave-body', `<p class="muted">Nothing from Dave's agent on bitcube yet (no remembered day in its scene).</p>`);
  const age = d.ageS != null ? `<span class="${d.old ? 'old' : ''}">${esc(fmt.nb(dur(d.ageS)))} ago${d.old ? ' (over 5 min: bitcube plays a notable day)' : ''}</span>` : 'when not known';
  const sw = d.palette.length ? `<div class="swatches" role="img" aria-label="Dave's palette: ${esc(d.palette.join(', '))}">${d.palette.map((c) => `<span style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')}</div>` : '<p class="muted">No palette</p>';
  const knobs = d.knobs.map((k) => {
    const w = k.value == null ? 0 : k.value * 100, e = k.effective == null ? 0 : k.effective * 100;
    const nudge = k.nudge ? `<span class="nudge">${k.nudge > 0 ? '+' : '−'}${Math.abs(k.nudge).toFixed(2)} reflex</span>` : '';
    return `<div class="knob"><span class="kname">${KNOB_WORDS[k.name]}</span>
      <span class="kbar" role="img" aria-label="${KNOB_WORDS[k.name]} ${k.value == null ? 'not known' : k.value.toFixed(2)}${k.nudge ? `, nudged to ${k.effective.toFixed(2)} by the reflex` : ''}"><span class="fill" style="width:${w.toFixed(0)}%"></span>${k.nudge ? `<span class="eff" style="left:${e.toFixed(0)}%"></span>` : ''}</span>
      <span class="kval">${k.value == null ? '–' : k.value.toFixed(2)}${nudge}</span></div>`;
  }).join('');
  const heard = d.heard == null ? '<b>not known</b> (no sound from Dave)' : `<b>${d.heard.toFixed(2)}</b>`;
  put('dave-body', `<p class="dday"><b>${esc(d.dateWords ?? 'No day')}</b>${d.chosenBy ? ` · chosen for ${esc(d.chosenBy)}` : ''}</p>
    ${d.reason ? `<p class="reason">“${esc(d.reason)}”</p>` : ''}
    <p class="muted secondary">Chosen ${age}</p>
    ${sw}
    <div class="knobs">${knobs}</div>
    <p class="secondary">Heard (how loud the river sounds): ${heard}</p>`);
}

function renderRiver(v) {
  if (!v) return put('river-body', '');
  const r = v.river;
  const m = r.motion;
  put('river-body', `${v.running ? `<div class="meter"><span class="mname">Motion</span><span class="mbar" role="img" aria-label="River motion ${m == null ? 'not known' : m.toFixed(2)}"><span class="fill" style="width:${m == null ? 0 : Math.round(m * 100)}%"></span></span><span class="mval">${m == null ? '–' : m.toFixed(2)}</span></div>
    <p class="secondary">${r.source ? `<span class="tag ${r.source}">${r.source === 'live' ? 'Live' : 'Recorded'}</span> ` : ''}${esc(r.sourceWords ?? "TouchDesigner doesn't say which picture it uses")}</p>`
    : '<p class="muted secondary">The still is the river camera now; its motion is measured only while the remembered river runs.</p>'}`);
}

function renderRoom(v) {
  const dots = $('#room-dots');
  if (!v) { put('room-body', ''); dots.innerHTML = ''; return; }
  const r = v.room;
  const html = r.lingerers.map((l, i) => `<span class="dot${i % 2 ? " below" : ""}" style="left:${(l.x * 100).toFixed(1)}%;top:${(l.y * 100).toFixed(1)}%"><span class="lab">${esc(l.label)}${l.still_s != null ? ` · ${Math.round(l.still_s)} s` : ''}</span></span>`).join('');
  if (S.html.dots !== html) { S.html.dots = html; dots.innerHTML = html; }
  const pres = r.presence != null ? `<b>${+r.presence.toFixed(1)}</b> people${r.usual != null ? `, usually ${+r.usual.toFixed(1)}` : ''}${r.relWords ? `: <b>${esc(r.relWords)}</b>` : ''}${r.relative != null ? ` (×${r.relative.toFixed(2)})` : ''}` : 'Presence not known';
  const ling = r.lingerers.length ? `<ul class="ling">${r.lingerers.map((l) => `<li>Standing still ${l.still_s != null ? `${Math.round(l.still_s)} s` : ''} by <b>${esc(l.label)}</b></li>`).join('')}</ul>` : '<p class="muted secondary">No lingerers: nobody standing still close to the column.</p>';
  put('room-body', `<p>${pres}</p>${ling}`);
}

function renderDecision(v) {
  if (!v) { put('day-head', ''); put('day-strip', ''); put('why', ''); return; }
  if (!v.running) {
    const d = v.dave;
    put('day-head', `<p class="muted secondary">Not playing. Dave's agent would have it relive <b>${esc(d.dateWords ?? 'no day yet')}</b>.</p>`);
  } else {
    const day = v.day;
    put('day-head', `<p class="dday"><b>${esc(day?.dateWords ?? 'A day')}</b> · ${day?.fromDave ? "Dave's choice" : 'a notable day bitcube picked'}</p>
      ${day?.reason ? `<p class="reason">“${esc(day.reason)}”</p>` : ''}
      ${v.phaseWords ? `<p class="secondary">${esc(v.phaseWords)}</p>` : ''}`);
  }
  put('day-strip', `${dayStripSVG(v)}${v.profileNote ? `<p class="muted secondary">${esc(v.profileNote)}</p>` : v.profileDate && v.profileDate !== (v.day?.date ?? v.dave.date) ? `<p class="muted secondary">The hours shown are ${esc(dateWords(v.profileDate))}'s.</p>` : ''}`);
  put('why', v.running ? v.why.map((w) => `<li>${esc(w)}</li>`).join('') : '<li class="muted">The loop explains itself here while the remembered river runs.</li>');
}

function renderOutputs(v) {
  const run = !!v?.running;
  put('lit', run && v.panels.lit ? litMeterHTML(v.panels.lit, { rule: PANEL_RULE_PCT }) : '<p class="muted secondary">TouchDesigner reports how much of each screen is lit while the remembered river runs.</p>');
  const facts = run ? [
    ['Ropes', v.wattsWords ?? 'watts not known'],
    ['Frames a second', v.fps != null ? `${Math.round(v.fps)}` : 'not known'],
    ['Panel brightness cap', v.panels.cap != null ? fmt.pct(v.panels.cap) : 'not known'],
  ] : [];
  put('facts', facts.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(fmt.nb(x))}</dd></div>`).join(''));
  drawLights();
}
function drawLights() {
  const fr = fitCanvas($('#strips-canvas')), fq = fitCanvas($('#quads-canvas'));
  const note = $('#out-note');
  const ageS = S.lightsAt == null ? null : since(S.lightsAt);
  if (!S.lights) { paintEmpty(fr, fq); note.textContent = S.lightsError ? `Can't show the lights: ${S.lightsError}.` : 'Asking bitcube for the frames…'; return; }
  const mark = (S.v?.room.lingerers ?? []).flatMap((l) => l.ropes).filter((r) => Number.isInteger(r)).map((r) => r - 1);
  paintStrips(fr, S.lights, { mark });
  paintScreens(fq, S.lights.scr);
  const old = S.lightsError ? ` (the last read failed: ${S.lightsError})` : '';
  note.textContent = `What TouchDesigner sends, from bitcube${ageS != null ? ` · ${fmt.nb(dur(ageS + (S.lights.frames.age_s ?? 0)))} ago` : ''}${mark.length ? ' · outlined: the ropes nearest a lingerer' : ''}${old}.`;
}

// ---- controls ----------------------------------------------------------------------------------------------------------------
const poolInput = $('#pool');
const clampPool = (x) => Math.round(Math.min(REMEMBERED_POOL_M[1], Math.max(REMEMBERED_POOL_M[0], x)) * 20) / 20;
function setPool(x, touched = true) { S.pool = clampPool(x); if (touched) S.poolTouched = true; poolInput.value = String(S.pool); $('#pool-out').textContent = `${S.pool.toFixed(2)} m`; }
poolInput.addEventListener('input', () => setPool(Number(poolInput.value)));
$('#pool-less').addEventListener('click', () => setPool((S.pool ?? 0.6) - 0.05));
$('#pool-more').addEventListener('click', () => setPool((S.pool ?? 0.6) + 0.05));
const ZONE_COPY = {
  pool: { label: 'Light the pool', kind: 'primary', done: 'Asked TouchDesigner to light the pool',
    before: 'Lights the LEDs below the pool line so you can see where it falls, until you press Off. Asks first.',
    confirm: () => ({ title: 'Light the pool?', body: `TouchDesigner lights the LEDs below the pool line (${(S.pool ?? 0.6).toFixed(2)} m) instead of the show there, until someone presses Off.`, ok: 'Light the pool', cancel: 'Not now', destructive: true }) },
  eddies: { label: 'Light the eddies', kind: 'primary', done: 'Asked TouchDesigner to light the eddies',
    before: 'Lights the LEDs where a rope crosses a log (the driftwood eddies), until you press Off. Asks first.',
    confirm: () => ({ title: 'Light the eddies?', body: 'TouchDesigner lights the LEDs at the driftwood eddies instead of the show there, until someone presses Off.', ok: 'Light the eddies', cancel: 'Not now', destructive: true }) },
  off: { label: 'Off: back to the show', kind: 'plain', done: 'Asked TouchDesigner to go back to the show', before: 'Puts the pool and eddies back to the show, and keeps the pool line you set.', confirm: null },
};
const ctls = {};
for (const light of ['pool', 'eddies', 'off']) {
  const c = ZONE_COPY[light];
  ctls[light] = control($(`#z-${light}`), { ...c, action: 'remembered-zones', expectS: EXPECT_S['remembered-zones'],
    what: changeLabel('remembered-zones', { light }), noAnswer: 'the pool line under the slider says what bitcube has',
    done: (r) => `${c.done}${r?.written?.pool_height_m != null ? ` (pool line ${Number(r.written.pool_height_m).toFixed(2)} m)` : ''}`,
    run: () => api('/api/control/remembered-zones', { light, ...(S.pool != null ? { pool_height_m: S.pool } : {}) }),
    onSent: () => { S.poolTouched = false; pollRemembered(); status.refresh(); }, onFail: () => status.refresh(),
    lock: () => [poolInput, $('#pool-less'), $('#pool-more')] });
}
ctls.opening = control($('#z-opening'), { action: 'remembered-opening', expectS: EXPECT_S['remembered-opening'], label: 'Turn opening night on', kind: 'primary',
  noAnswer: 'the line above says what bitcube has', done: 'Sent', run: () => api('/api/control/remembered-opening', { on: S.openingWant === true }),
  onSent: () => { pollRemembered(); status.refresh(); }, onFail: () => status.refresh() });
S.openingShown = undefined;
// the screens (M7 intensity and threshold, M9 the river video under the particle windows): drafts in percent until Apply; each
// follows bitcube's value until moved here, and Apply sends all three
const SCREEN_KEYS = ['intensity', 'threshold', 'video'];
const screenInput = Object.fromEntries(SCREEN_KEYS.map((k) => [k, $(`#${k}`)]));
S.scr = {}; S.scrTouched = {};
const screensBody = () => Object.fromEntries(SCREEN_KEYS.filter((k) => S.scr[k] != null).map((k) => [k, S.scr[k] / 100]));
function setScreen(k, pct, touched = true) {
  S.scr[k] = Math.round(Math.min(100, Math.max(0, pct)) / 5) * 5; if (touched) S.scrTouched[k] = true;
  screenInput[k].value = String(S.scr[k]); $(`#${k}-out`).textContent = fmt.nb(`${S.scr[k]} %`);
  ctls.video?.update({ what: changeLabel('remembered-screens', screensBody()) });
}
for (const k of SCREEN_KEYS) screenInput[k].addEventListener('input', () => setScreen(k, Number(screenInput[k].value)));
ctls.video = control($('#z-video'), { action: 'remembered-screens', expectS: EXPECT_S['remembered-screens'], label: 'Apply', kind: 'primary',
  before: 'Moves only the screens: the ropes keep the show.', what: changeLabel('remembered-screens', { intensity: 0.82, threshold: 0.35, video: 0.15 }),
  noAnswer: 'the lines above the button say what bitcube has',
  done: () => `Asked TouchDesigner for ${changeLabel('remembered-screens', screensBody()).replace(/^the change of /, '')}`,
  run: () => api('/api/control/remembered-screens', screensBody()),
  onSent: () => { S.scrTouched = {}; pollRemembered(); status.refresh(); }, onFail: () => status.refresh(),
  lock: () => SCREEN_KEYS.map((k) => screenInput[k]) });

function whyFor(action, v) {
  if (contact.lost) return "mission control isn't answering";
  const m = S.m?.controls?.[action];
  if (m?.why) return m.why;
  if (S.remError && !v) return `the remembered river's files can't be read (${S.remError})`;
  if (v && !v.running) return v.inLooks ? (v.notRunning ?? REMEMBERED_ONLY) : REMEMBERED_ONLY;
  return null;
}
function renderControls(v) {
  // the pool line: bitcube's until someone moves it here
  const now = v?.zones?.pool_height_m ?? v?.control?.pool_height_m ?? null;
  $('#pool-now').textContent = now == null ? 'not known' : `${Number(now).toFixed(2)} m${v?.zones?.light && v.zones.light !== 'off' ? `, ${v.zones.light} lit` : ''}${v?.zones?.file ? ` (${v.zones.file})` : ''}`;
  if (!S.poolTouched && now != null) setPool(Number(now), false);
  else if (S.pool == null) setPool(0.6, false);
  const zwhy = whyFor('remembered-zones', v), owhy = whyFor('remembered-opening', v);
  for (const l of ['pool', 'eddies', 'off']) ctls[l].update({ why: zwhy, whyBy: S.m?.controls?.['remembered-zones']?.by ?? null });
  const on = v?.opening ?? null;
  $('#opening-now').innerHTML = on == null ? 'Not known' : `Now: <b>${on ? 'on' : 'off'}</b>`;
  if (S.openingShown !== on && !ctls.opening.busy && ctls.opening.state !== 'confirm') {
    S.openingShown = on; S.openingWant = !on;
    ctls.opening.update(on ? { label: 'Turn opening night off', kind: 'plain', what: changeLabel('remembered-opening', { on: false }), confirm: null,
      before: "Back to the show's usual nights." }
      : { label: 'Turn opening night on', kind: 'primary', what: changeLabel('remembered-opening', { on: true }),
        before: "For a crowded room: calm runs a little brighter (about 45 %) and a surge comes at least every 5 minutes. The room can still move a surge, never add one. Asks first.",
        confirm: { title: 'Turn opening night on?', body: 'Calm runs about 45 % and a surge comes at least every 5 minutes, until someone turns it off.', ok: 'Turn it on', cancel: 'Not now', destructive: false } });
  }
  ctls.opening.update({ why: owhy, whyBy: S.m?.controls?.['remembered-opening']?.by ?? null });
  for (const k of SCREEN_KEYS) {
    const now = v?.[k]?.now ?? null, asked = v?.[k]?.asked ?? null;
    $(`#${k}-now`).textContent = now != null ? fmt.nb(`${Math.round(now * 100)} %`) : asked != null ? `${fmt.nb(`${Math.round(asked * 100)} %`)} asked (TouchDesigner hasn't said)` : 'not known';
    if (!S.scrTouched[k] && (now ?? asked) != null) setScreen(k, (now ?? asked) * 100, false);
    else if (S.scr[k] == null) setScreen(k, (v?.[k]?.default ?? { intensity: 0.82, threshold: 0.35, video: 0.15 }[k]) * 100, false);
  }
  ctls.video.update({ why: whyFor('remembered-screens', v), whyBy: S.m?.controls?.['remembered-screens']?.by ?? null });
}
/** Each status answer: the controls see the model (their own change's entry, the server's verdict). */
function judge() {
  if (!S.m || contact.lost) return;
  for (const c of Object.values(ctls)) if (c.button.isConnected) c.update({ model: S.m, readAt: status.receivedWall });
}

function renderFooter() {
  put('foot', `<div class="links">${[['Lights: every LED', '/lights'], ['HUB75 simulator', '/hub75'], ['The design and contracts', 'https://github.com/gavaiken/river-bitcube/blob/main/docs/remembered-river.md'], ...DOC_LINKS]
    .map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>`);
}

// ---- go ----------------------------------------------------------------------------------------------------------------------
setPool(0.6, false);
render();
pollRemembered(); pollLights(); stills();
setInterval(pollRemembered, REM_MS);
setInterval(pollLights, LIGHTS_MS);
setInterval(stills, STILL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollRemembered(); pollLights(); stills(); } });
document.addEventListener('mc:check', () => { status.refresh(); pollRemembered(); pollLights(); stills(); });
document.addEventListener('mc:theme', () => render());
addEventListener('resize', () => drawLights());
tick(() => { if (S.rem) renderNow(S.v); });
// for the screenshot harness and the engineers' console: what the page last read
window.__remembered = () => ({ v: S.v, error: S.remError, lights: !!S.lights, mss });
