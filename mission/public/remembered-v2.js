// Mission control: the Remembered river v2 page (/remembered-v2; docs/mission-ui.md "Remembered river v2 page"). For
// river-all-looks-v2.toe: inputs → parameters → outputs with their sources, ages and 24 h sparklines, every parameter's override
// (auto / fix / adjust) in a sheet, the global steer controls (master brightness, calm range, simulated people, clear all), the
// screens, pool and opening-night controls of v1, and a ? on everything. Every word comes from remembered-v2-words.js (pure, tested);
// the frames are drawn by the Lights page's own frames-view.js; the controls follow "Applying a change" through ui.js control().
// GET /api/remembered every 2 s, /api/status every 5 s, /api/lights every 4 s, /api/remembered/history every 60 s.
import { mountShell, poll, tick, watchContact, art, fmt, control, sheet, api, esc, DOC_LINKS, serverNow } from '/ui.js';
import { fetchTimed } from '/app.js';
import { derive, changeLabel, dur, EXPECT_S, REMEMBERED_ONLY } from '/model.js';
import { decodeLights, fitCanvas, paintStrips, paintScreens, paintEmpty } from '/frames-view.js';
import { hourWords, screensChange, REMEMBERED_SCREENS_DEFAULT } from '/remembered-words.js';
import { rememberedV2View, versionBanner, explainer, PARAMS, PARAM_LABEL, PARAM_EXPLAIN, MODE_EXPLAIN, MODE_WORDS, SIMULATED, SIM, SPARK,
  HISTORY_FIELDS, sparkSVG, sparkRange, adjusted, paramValueWords, calmProblem, TERMS, v2Label } from '/remembered-v2-words.js';
import SCHEMA from '/remembered-schema.js';

const REM_MS = 2000, LIGHTS_MS = 4000, HIST_MS = 60_000;
const $ = (s) => document.querySelector(s);
const since = (at) => (at == null ? 0 : (performance.now() - at) / 1000);
const S = { m: null, rem: null, remAt: null, remError: null, v: null, lights: null, lightsAt: null, lightsError: null, hist: null, histAt: null, fetching: {}, html: {} };
const put = (id, html) => { if (S.html[id] !== html) { S.html[id] = html; const el = document.getElementById(id); if (el) el.innerHTML = html; } };
const pct = (x) => fmt.nb(`${Math.round(x)} %`);

const shell = mountShell({ page: 'remembered-v2', title: 'Remembered river v2' });
const status = poll('/api/status', { every: 5000, onData: () => { S.m = derive(status.last, serverNow()); render(); judge(); }, onError: () => render() });
const contact = watchContact(status, shell, () => render());

// ---- reading -----------------------------------------------------------------------------------------------------------------
async function pollRemembered() {
  if (document.hidden || S.fetching.rem) return;
  S.fetching.rem = true;
  try {
    const { r, body } = await fetchTimed('/api/remembered');
    if (r.status === 401) { location.href = '/login'; return; }
    if (!r.ok || body?.ok === false) S.remError = body?.error ?? `mission control answered ${r.status}`;
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
async function pollHistory() {
  if (document.hidden || S.fetching.hist) return;
  S.fetching.hist = true;
  try {
    const { r, body } = await fetchTimed(`/api/remembered/history?fields=${HISTORY_FIELDS.join(',')}`);
    if (r.ok && body?.ok) { S.hist = body; S.histAt = performance.now(); }
  } catch { /* the sparklines keep what they had */ }
  finally { S.fetching.hist = false; }
  renderFlow(S.v);
}

// ---- render ------------------------------------------------------------------------------------------------------------------
function runningFile() { const td = status.last?.probe?.value?.td; return td && td.ok !== false && typeof td.file === 'string' ? td.file : null; }
function render() {
  const v = S.rem ? rememberedV2View(S.rem, { now: serverNow(), sinceS: since(S.remAt) }) : null;
  S.v = v;
  art.setSeason(null);
  renderVersion(); renderSim(v); renderNow(v); renderFlow(v); renderOutputs(v); renderControls(v); renderFooter();
}

function renderVersion() {
  const b = versionBanner('v2', runningFile()), el = $('#version');
  el.hidden = !b;
  put('version', b ? `<span>${esc(b.text)} → <a href="${b.href}">${esc(b.link)}</a></span>` : '');
}

function renderSim(v) {
  const on = !!v?.sim.active;
  $('#sim-banner').hidden = !on;
  document.body.classList.toggle('simulating', on);
  if (on) $('#sim-words').textContent = v.sim.words;
}

function renderNow(v) {
  const phase = $('#now-phase'), line = $('#now-line'), nr = $('#now-notrunning');
  if (!v) {
    phase.textContent = S.remError ? "Can't read the remembered river" : 'Connecting…';
    phase.className = 'phase';
    line.textContent = S.remError ? `${S.remError[0].toUpperCase()}${S.remError.slice(1)}. It tries again every 2 s.` : '';
    nr.hidden = true;
  } else if (v.running) {
    phase.textContent = v.phase ? v.phase[0].toUpperCase() + v.phase.slice(1) : 'Running';
    phase.className = `phase ph-${v.phase ?? 'none'}`;
    const day = v.day?.dateWords ? `${v.day.dateWords}${v.day.fromDave ? " (Dave's day)" : v.day.source ? ` (${v.day.source === 'notable' ? 'a notable day' : v.day.source})` : ''}` : 'a remembered day';
    line.innerHTML = `${v.loop ? `<b>${esc(v.loop.words)}</b> of the loop` : 'The loop'} · reliving ${esc(day)}${v.hour != null ? ` at <b>${esc(hourWords(v.hour))}</b>` : ''}`;
    nr.hidden = true;
  } else {
    phase.textContent = v.stale ? "TouchDesigner's status has stopped" : v.inLooks ? "The remembered river isn't the look showing" : "The remembered river isn't running";
    phase.className = 'phase ph-off';
    line.textContent = '';
    nr.textContent = v.notRunning; nr.hidden = !v.notRunning;
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
  from.textContent = age == null ? '' : `From bitcube · ${fmt.nb(dur(age))} ago${S.remError && v ? ` · last read failed: ${S.remError}` : ''}`;
  from.classList.toggle('old', age != null && age > 10);
  const stale = $('#now-stale');
  const sw = v?.staleWords ?? v?.v2Missing ?? null;
  stale.hidden = !sw; stale.textContent = sw ?? '';
  document.querySelector('main').classList.toggle('is-stale', !!v?.stale || contact.lost || (age != null && age > 10));
  $('#now-problems').hidden = !v?.problems?.length;
  put('now-problems', (v?.problems ?? []).map((p) => `<li>${esc(p)}</li>`).join(''));
  const n = v?.overriddenCount ?? 0;
  $('#now-overrides').textContent = !v ? '' : n ? `${n} parameter${n === 1 ? '' : 's'} overridden` : 'Everything on Auto';
}

const q = (key, title) => `<button type="button" class="q" data-explain="${esc(key)}" title="${esc(title ?? '')}" aria-label="What is this?">?</button>`;
function spark(key, label) {
  const f = SPARK[key];
  if (!f) return '';
  const pts = S.hist?.fields?.[f];
  if (!pts) return '<span class="spark-wrap"><svg class="spark none" viewBox="0 0 120 28" aria-hidden="true"></svg></span>';
  return `<span class="spark-wrap" title="The last 24 hours">${sparkSVG(pts, { ...sparkRange(key), nowS: S.hist.now_s, label: `${label}, the last 24 hours` })}</span>`;
}
function inputHTML(i) {
  const dot = i.source == null ? 'none' : i.fresh ? 'fresh' : 'quiet';   // drawn as dot-<state> (v2.css .fresh is the header's)
  const dotWords = dot === 'fresh' ? 'arriving' : dot === 'quiet' ? 'gone quiet' : 'nothing';
  return `<div class="in-row${i.simulated ? ' sim' : ''}" data-in="${esc(i.name)}">
    <div class="in-top"><span class="fdot dot-${dot}" title="${esc(dotWords)}" role="img" aria-label="${esc(dotWords)}"></span><b class="in-name">${esc(i.label)}</b>${q(`in.${i.name}`, i.explain)}
      <span class="src src-${esc(i.source ?? 'none')}" title="Where it comes from now">${esc(i.sourceWords)}</span></div>
    <div class="in-val"><span class="val">${esc(i.words)}</span>${i.ageWords ? ` <span class="age${i.age > 600 ? ' old' : ''}">${esc(fmt.nb(i.ageWords))}</span>` : ''}</div>
    ${spark(i.name, i.label)}
  </div>`;
}
function paramHTML(p) {
  const sw = p.palette ? `<span class="swatches mini">${p.palette.map((c) => `<span style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')}</span>` : '';
  return `<div class="par mode-${p.mode}${p.simulated ? ' sim' : ''}">
    <button type="button" class="par-row" data-param="${esc(p.name)}" title="${esc(`${PARAM_EXPLAIN[p.name]} Tap to change.`)}" aria-label="${esc(`${p.label}: ${p.line}. Change it`)}">
      <span class="par-top"><b>${esc(p.label)}</b><span class="mode-chip">${esc(p.simulated ? 'Simulated' : p.modeWords)}</span><span class="chev" aria-hidden="true">›</span></span>
      <span class="par-line">${esc(p.line)}</span>${sw}
      ${p.who ? `<span class="par-who">${esc(p.who)}</span>` : ''}
      ${spark(`p.${p.name}`, p.label)}
    </button>${q(`p.${p.name}`, PARAM_EXPLAIN[p.name])}
  </div>`;
}
function renderFlow(v) {
  if (!v) return put('flow', `<p class="muted card">${S.remError ? `Can't read the remembered river: ${esc(S.remError)}.` : 'Waiting for bitcube…'}</p>`);
  put('flow', v.groups.map((g) => `<section class="group card" id="g-${g.id}" aria-labelledby="gh-${g.id}">
    <h3 class="grp-h" id="gh-${g.id}">${esc(g.title)}</h3><p class="group-why muted">${esc(g.why)}</p>
    <div class="g-in"><h4 class="col-mini">Inputs</h4>${g.inputs.map(inputHTML).join('')}</div>
    <div class="g-arrow" aria-hidden="true"><span>→</span></div>
    <div class="g-par"><h4 class="col-mini">Parameters</h4>${g.params.map(paramHTML).join('')}</div>
  </section>`).join(''));
}

function renderOutputs(v) {
  const facts = v?.statusAgeS != null ? [
    ['Ropes', v.wattsWords ?? 'watts not known'],
    ['Frames a second', v.fps != null ? `${Math.round(v.fps)}` : 'not known'],
    ['Phase', v.phase ? v.phase : 'not known'],
  ] : [];
  put('facts', facts.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(fmt.nb(x))}</dd></div>`).join(''));
  if (!v) put('fx-body', `<p class="muted">${S.remError ? "Can't read the effects from bitcube." : 'Waiting for bitcube…'}</p>`);
  else if (!v.effects.length) put('fx-body', '<p class="muted secondary">TouchDesigner reports no people effects (the v2 river reports them while it runs).</p>');
  else put('fx-body', v.effects.map((e) => `<div class="meter"><span class="mname">${esc(e.label)} ${q(`fx.${e.name}`, e.explain)}</span>
      ${e.meter != null ? `<span class="mbar" role="img" aria-label="${esc(`${e.label} ${e.words}`)}"><span class="fill" style="width:${Math.round(e.meter * 100)}%"></span></span>` : '<span></span>'}
      <span class="mval">${esc(e.words)}</span></div>`).join(''));
  const r = v?.room;
  put('room-body', r ? `<p class="secondary">${r.presence != null ? `<b>${+r.presence.toFixed(1)}</b> people${r.usual != null ? `, usually ${+r.usual.toFixed(1)}` : ''}${r.relWords ? ` (${esc(r.relWords)})` : ''}` : 'People in the room not known'}${v.inputs.lingerers.words && v.inputs.lingerers.value?.length ? ` · lingerer ${esc(v.inputs.lingerers.words)}` : ''}</p>` : '');
  drawLights();
}
function drawLights() {
  const fr = fitCanvas($('#strips-canvas')), fq = fitCanvas($('#quads-canvas'));
  const note = $('#out-note');
  const ageS = S.lightsAt == null ? null : since(S.lightsAt);
  if (!S.lights) { paintEmpty(fr, fq); note.textContent = S.lightsError ? `Can't show the lights: ${S.lightsError}.` : 'Asking bitcube for the frames…'; return; }
  const ling = S.v?.inputs?.lingerers?.value;
  const mark = (Array.isArray(ling) ? ling : []).filter((x) => Number.isInteger(x));
  paintStrips(fr, S.lights, { mark });
  paintScreens(fq, S.lights.scr);
  note.textContent = `What TouchDesigner sends, from bitcube${ageS != null ? ` · ${fmt.nb(dur(ageS + (S.lights.frames.age_s ?? 0)))} ago` : ''}${mark.length ? ' · outlined: the ropes by a lingerer' : ''}${S.lightsError ? ` (the last read failed: ${S.lightsError})` : ''}.`;
}

// ---- explainers --------------------------------------------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-explain]');
  if (b) { e.preventDefault(); openExplainer(b.dataset.explain); return; }
  const p = e.target.closest('[data-param]');
  if (p) { e.preventDefault(); openParam(p.dataset.param); }
});
function openExplainer(key) {
  const x = explainer(key);
  if (!x) return;
  if (x.lines) {
    sheet({ title: x.title, body: `<ol class="how">${x.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
      <h4 class="sub-h">Words on this page</h4><dl class="terms">${TERMS.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
      <p class="muted secondary"><a href="/explainer">What is happening (for the press)</a> · <a href="https://github.com/gavaiken/river-bitcube/blob/main/GLOSSARY.md" target="_blank" rel="noopener">Glossary</a></p>` });
  } else sheet({ title: x.title, body: `<p>${esc(x.body)}</p>` });
}

// ---- controls: shared ---------------------------------------------------------------------------------------------------------
const ctls = {};
function whyFor(action, v = S.v) {
  if (contact.lost) return "mission control isn't answering";
  const m = S.m?.controls?.[action];
  if (m?.why) return m.why;
  if (S.remError && !v) return `the remembered river's files can't be read (${S.remError})`;
  if (v?.stale) return "TouchDesigner's status has stopped (it is over 10 s old)";
  if (v && !v.running) return REMEMBERED_ONLY;
  return null;
}
const afterSend = () => { pollRemembered(); status.refresh(); };
const override = (body) => api('/api/control/remembered-override', body);
/** One override control (a button in el): its action, label and body (a function, read at the press). */
function overrideCtl(el, { label, kind = 'primary', body, what, done, before = '' }) {
  return control(el, { action: 'remembered-override', expectS: EXPECT_S['remembered-override'], label, kind, before, what: what ?? v2Label('remembered-override', {}),
    noAnswer: "the parameter's line shows what bitcube has", done: done ?? 'Sent',
    run: async () => { const bs = [].concat(body()); let r; for (const b of bs) { r = await override(b); if (r?.ok === false) return r; } return r; },
    onSent: afterSend, onFail: () => status.refresh() });
}

// ---- master brightness ----------------------------------------------------------------------------------------------------------
const MB = PARAMS.master_brightness, master = $('#master');
master.min = String(MB.min * 100); master.max = String(MB.max * 100);
S.master = null; S.masterTouched = false;
function setMaster(x, touched = true) {
  S.master = Math.round(Math.min(MB.max * 100, Math.max(MB.min * 100, x)) / 5) * 5; if (touched) S.masterTouched = true;
  master.value = String(S.master); $('#master-out').textContent = pct(S.master);
  if (touched) ctls.masterApply?.update({ what: v2Label('remembered-override', masterBody()), why: masterWhy() });
}
const masterBody = () => ({ param: 'master_brightness', mode: 'fix', value: (S.master ?? 100) / 100 });
master.addEventListener('input', () => setMaster(Number(master.value)));
function masterWhy() { return whyFor('remembered-override') ?? (S.masterTouched ? null : 'move the slider first'); }
ctls.masterApply = overrideCtl($('#master-apply'), { label: 'Apply', body: masterBody, before: 'Every rope, after everything else; the 1,400 W limit still applies.',
  done: () => `Asked TouchDesigner for master brightness ${pct(S.master ?? 100)}` });
ctls.masterAuto = overrideCtl($('#master-auto'), { label: 'Back to auto', kind: 'plain', body: () => ({ param: 'master_brightness', mode: 'auto' }),
  what: v2Label('remembered-override', { param: 'master_brightness', mode: 'auto' }), done: 'Asked TouchDesigner to go back to auto' });

// ---- the calm range -------------------------------------------------------------------------------------------------------------
const calmLo = $('#calm-lo'), calmHi = $('#calm-hi');
S.calm = { lo: null, hi: null }; S.calmTouched = false;
function setCalm(k, x, touched = true) {
  S.calm[k] = Math.round(Math.min(100, Math.max(0, x))); if (touched) S.calmTouched = true;
  (k === 'lo' ? calmLo : calmHi).value = String(S.calm[k]); $(`#calm-${k}-out`).textContent = pct(S.calm[k]);
  const band = $('#calm-bar .calm-band');
  if (S.calm.lo != null && S.calm.hi != null) { band.style.left = `${Math.min(S.calm.lo, S.calm.hi)}%`; band.style.width = `${Math.abs(S.calm.hi - S.calm.lo)}%`; }
  if (touched) ctls.calmApply?.update({ why: calmWhy() });
}
calmLo.addEventListener('input', () => setCalm('lo', Number(calmLo.value)));
calmHi.addEventListener('input', () => setCalm('hi', Number(calmHi.value)));
function calmWhy() { return whyFor('remembered-override') ?? (S.calmTouched ? calmProblem(S.calm.lo / 100, S.calm.hi / 100) : 'move a slider first'); }
ctls.calmApply = overrideCtl($('#calm-apply'), { label: 'Apply', what: 'the change of the calm range',
  body: () => [{ param: 'calm_min', mode: 'fix', value: S.calm.lo / 100 }, { param: 'calm_max', mode: 'fix', value: S.calm.hi / 100 }],
  before: 'Between surges the ropes stay inside this range.', done: () => `Asked TouchDesigner for a calm range of ${pct(S.calm.lo)} to ${pct(S.calm.hi)}` });
ctls.calmAuto = overrideCtl($('#calm-auto'), { label: 'Back to auto', kind: 'plain', what: 'the calm range back to auto',
  body: () => [{ param: 'calm_min', mode: 'auto' }, { param: 'calm_max', mode: 'auto' }], done: 'Asked TouchDesigner to go back to auto' });

// ---- simulate -------------------------------------------------------------------------------------------------------------------
const simHc = $('#sim-hc'), simLr = $('#sim-lr'), simHcOn = $('#sim-hc-on'), simLrOn = $('#sim-lr-on');
const SIM_FOR = `${Math.round(SIM.simulated_max_s / 60)} minutes`;
const simBody = () => ({ ...(simHcOn.checked ? { headcount: Number(simHc.value) } : {}), ...(simLrOn.checked ? { lingerer_rope: Number(simLr.value) - 1 } : {}) });
function simPaint() {
  $('#sim-hc-out').textContent = fmt.nb(`${simHc.value} ${simHc.value === '1' ? 'person' : 'people'}`);
  $('#sim-lr-out').textContent = `rope ${simLr.value}`;
  simHc.disabled = !simHcOn.checked || ctls.simGo?.busy; simLr.disabled = !simLrOn.checked || ctls.simGo?.busy;
  ctls.simGo?.update({ what: v2Label('remembered-simulate', simBody()), why: simWhy() });
}
for (const x of [simHc, simLr, simHcOn, simLrOn]) { x.addEventListener('input', simPaint); x.addEventListener('change', simPaint); }
function simWhy() { return whyFor('remembered-simulate') ?? (Object.keys(simBody()).length ? null : 'pick a headcount or a lingerer first'); }
ctls.simGo = control($('#sim-go'), { action: 'remembered-simulate', expectS: EXPECT_S['remembered-simulate'], label: `Simulate for ${SIM_FOR}`, kind: 'danger',
  before: `The show treats these pretend people as real until you stop it, or for ${SIM_FOR}. A red banner shows while it is on.`,
  what: v2Label('remembered-simulate', simBody()), noAnswer: 'the red banner shows while it is on', done: () => `Simulating ${v2Label('remembered-simulate', S.simSent ?? {}).replace(/^the simulation of /, '')}`,
  run: () => { S.simSent = simBody(); return api('/api/control/remembered-simulate', S.simSent); }, onSent: afterSend, onFail: () => status.refresh() });
ctls.simStop = control($('#sim-stop'), { action: 'remembered-simulate', expectS: EXPECT_S['remembered-simulate'], label: 'Stop simulating', kind: 'plain',
  what: v2Label('remembered-simulate', { stop: true }), noAnswer: 'the red banner goes when it stops', done: 'Asked TouchDesigner to stop simulating',
  run: () => api('/api/control/remembered-simulate', { stop: true }), onSent: afterSend, onFail: () => status.refresh() });
$('#sim-banner-stop').addEventListener('click', () => { const b = ctls.simStop.button; if (!b.disabled) b.click(); $('#sim-ctl').scrollIntoView({ block: 'center' }); });

// ---- clear all --------------------------------------------------------------------------------------------------------------------
ctls.clearAll = control($('#clear-all'), { action: 'remembered-override-clear', expectS: EXPECT_S['remembered-override-clear'], label: 'Clear all overrides', kind: 'plain',
  before: 'Every parameter back to Auto, a simulation too. The screens, pool line and opening night stay.', what: v2Label('remembered-override-clear', {}),
  confirm: () => ({ title: 'Clear all overrides?', body: `${S.v?.overriddenCount ?? 0} overridden parameter(s)${S.v?.sim.active ? ' and the simulation' : ''} go back to Auto: the show steers itself again.`, ok: 'Clear them all', cancel: 'Not now', destructive: true }),
  noAnswer: 'the parameters say Auto again once bitcube has it', done: 'Asked TouchDesigner to clear every override',
  run: () => api('/api/control/remembered-override-clear', {}), onSent: afterSend, onFail: () => status.refresh() });

// ---- one parameter's sheet: auto / fix / adjust -------------------------------------------------------------------------------------
function openParam(name) {
  const def = PARAMS[name], p = S.v?.params?.[name];
  if (!def) return;
  const range = def.type === 'date' ? `a remembered day, ${SIM.days.first} to ${SIM.days.last}` : def.type === 'palette' ? 'three colours: deep, mid, light'
    : `${paramValueWords(name, def.min)} to ${paramValueWords(name, def.max)}${def.unit && !['x', 'rope', 'people', 'h'].includes(def.unit) ? ` ${def.unit}` : ''}`;
  const body = document.createElement('div');
  body.className = 'psheet';
  const sim = SIMULATED.includes(name);
  body.innerHTML = `<p>${esc(PARAM_EXPLAIN[name])}</p>
    <p class="muted secondary">Range: ${esc(range)}${def.default != null ? ` · usually ${esc(paramValueWords(name, def.default))}` : ''}</p>
    <p class="ps-now"><b>Now:</b> ${esc(p?.line ?? 'not reported')}${p?.who ? ` <span class="muted">(${esc(p.who)})</span>` : ''}</p>
    ${sim ? `<p class="secondary">People are simulated from <b>Simulate people</b> under Steer the river: it clears itself after ${SIM_FOR}.</p><div class="ps-clear"></div>`
    : `<div class="seg" role="group" aria-label="How to change it">${def.modes.filter((m) => m !== 'auto').map((m) => `<button type="button" data-mode="${m}">${m === 'fix' ? 'Fix a value' : 'Adjust auto'}</button>`).join('')}</div>
    <p class="muted secondary ps-mode-help"></p>
    <div class="ps-pane" data-pane="fix">${fixInput(name, def, p)}</div>
    ${def.modes.includes('adjust') ? `<div class="ps-pane" data-pane="adjust">
      <div class="poolrow"><label for="ps-gain">Gain (×) <output id="ps-gain-out"></output></label><input type="range" id="ps-gain" min="${SIM.gain[0]}" max="${SIM.gain[1]}" step="0.05"></div>
      <div class="poolrow"><label for="ps-off">Offset (+) <output id="ps-off-out"></output></label><input type="range" id="ps-off" min="${-(def.max - def.min)}" max="${def.max - def.min}" step="${(def.max - def.min) / 100}"></div>
    </div>` : ''}
    <p class="ps-result"></p>
    <div class="ps-apply"></div><div class="ps-clear"></div>`}`;
  const s = sheet({ title: PARAM_LABEL[name], body, actions: [{ label: 'Close', kind: 'plain' }] });
  const st = { mode: p?.mode === 'adjust' ? 'adjust' : 'fix', gain: num(S.v?.overrides?.[name]?.gain) ?? 1, offset: num(S.v?.overrides?.[name]?.offset) ?? 0 };
  const clear = control(body.querySelector('.ps-clear'), { action: 'remembered-override', expectS: EXPECT_S['remembered-override'], label: sim ? 'Stop simulating' : 'Clear: back to auto', kind: 'plain',
    what: sim ? v2Label('remembered-simulate', { stop: true }) : v2Label('remembered-override', { param: name, mode: 'auto' }), done: 'Back to auto asked',
    noAnswer: "the parameter's line shows what bitcube has",
    run: () => (sim ? api('/api/control/remembered-simulate', { stop: true }) : override({ param: name, mode: 'auto' })), onSent: afterSend, onFail: () => status.refresh() });
  clear.update({ why: whyFor('remembered-override') ?? (p?.overridden ? null : 'it is on Auto already') });
  if (sim) return s;
  const val = () => readFix(name, def, body);
  const bodyNow = () => (st.mode === 'fix' ? { param: name, mode: 'fix', value: val() } : { param: name, mode: 'adjust', gain: st.gain, offset: st.offset });
  const apply = control(body.querySelector('.ps-apply'), { action: 'remembered-override', expectS: EXPECT_S['remembered-override'], label: 'Apply', kind: 'primary',
    what: v2Label('remembered-override', bodyNow()), noAnswer: "the parameter's line shows what bitcube has", done: () => `Asked TouchDesigner: ${v2Label('remembered-override', S.psSent ?? {}).replace(/^the override: /, '')}`,
    run: () => { S.psSent = bodyNow(); return override(S.psSent); }, onSent: afterSend, onFail: () => status.refresh() });
  const paint = () => {
    body.querySelectorAll('[data-mode]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)); });
    body.querySelectorAll('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== st.mode; });
    body.querySelector('.ps-mode-help').textContent = MODE_EXPLAIN[st.mode];
    const g = body.querySelector('#ps-gain'), o = body.querySelector('#ps-off');
    if (g) { g.value = String(st.gain); body.querySelector('#ps-gain-out').textContent = `× ${st.gain.toFixed(2)}`; }
    if (o) { o.value = String(st.offset); body.querySelector('#ps-off-out').textContent = `${st.offset >= 0 ? '+' : '−'} ${Math.abs(st.offset).toFixed(name === 'surge_hour' ? 1 : 2)}`; }
    const auto = p?.auto;
    const res = st.mode === 'adjust' ? adjusted(name, auto, st.gain, st.offset) : val();
    body.querySelector('.ps-result').innerHTML = st.mode === 'adjust'
      ? (res == null ? 'The show hasn\'t reported its auto value yet.' : `auto ${esc(paramValueWords(name, auto))} → <b>${esc(paramValueWords(name, res))}</b>`)
      : res == null ? 'Pick a value.' : `Will use <b>${esc(paramValueWords(name, res))}</b> instead of auto ${esc(paramValueWords(name, auto))}`;
    apply.update({ what: v2Label('remembered-override', bodyNow()), why: whyFor('remembered-override') ?? (st.mode === 'fix' && res == null ? 'pick a value first' : null) });
  };
  body.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { st.mode = b.dataset.mode; paint(); } });
  body.addEventListener('input', (e) => {
    if (e.target.id === 'ps-gain') st.gain = Number(e.target.value);
    else if (e.target.id === 'ps-off') st.offset = Number(e.target.value);
    paint();
  });
  paint();
  return s;
}
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
function fixInput(name, def, p) {
  const cur = p?.value ?? p?.auto ?? def.default;
  if (def.type === 'date') return `<div class="poolrow"><label for="ps-date">Day</label><input type="date" id="ps-date" min="${SIM.days.first}" max="${SIM.days.last}" value="${esc(typeof cur === 'string' ? cur : '')}"></div>`;
  if (def.type === 'palette') {
    const c = Array.isArray(cur) && cur.length === 3 ? cur : ['#0b3d5c', '#1f8fb3', '#bfefff'];
    return `<div class="ps-colours">${['Deep', 'Mid', 'Light'].map((l, k) => `<label>${l}<input type="color" id="ps-c${k}" value="${esc(c[k])}"></label>`).join('')}</div>`;
  }
  const step = def.type === 'int' ? 1 : name === 'surge_hour' ? 0.25 : (def.max - def.min) / 100;
  const v = num(cur) ?? def.min;
  return `<div class="poolrow"><label for="ps-val">Value <output id="ps-val-out">${esc(paramValueWords(name, v))}</output></label>
    <input type="range" id="ps-val" min="${def.min}" max="${def.max}" step="${step}" value="${v}"></div>`;
}
function readFix(name, def, body) {
  if (def.type === 'date') { const x = body.querySelector('#ps-date')?.value; return x || null; }
  if (def.type === 'palette') return [0, 1, 2].map((k) => body.querySelector(`#ps-c${k}`)?.value ?? '#000000');
  const el = body.querySelector('#ps-val');
  if (!el) return null;
  const x = Number(el.value);
  body.querySelector('#ps-val-out').textContent = paramValueWords(name, x);
  return def.type === 'int' ? Math.round(x) : x;
}

// ---- v1's controls: the screens, the pool, opening night (the same calls as /remembered) ------------------------------------------
const POOL = SCHEMA.fields.pool_height_m, POOL_START = SCHEMA.ui.pool_height_m;
const poolInput = $('#pool');
poolInput.min = String(POOL.min); poolInput.max = String(POOL.max);
S.pool = null; S.poolTouched = false;
const clampPool = (x) => Math.round(Math.min(POOL.max, Math.max(POOL.min, x)) * 20) / 20;
function setPool(x, touched = true) { S.pool = clampPool(x); if (touched) S.poolTouched = true; poolInput.value = String(S.pool); $('#pool-out').textContent = `${S.pool.toFixed(2)} m`; }
poolInput.addEventListener('input', () => setPool(Number(poolInput.value)));
$('#pool-less').addEventListener('click', () => setPool((S.pool ?? POOL_START) - 0.05));
$('#pool-more').addEventListener('click', () => setPool((S.pool ?? POOL_START) + 0.05));
const LIT_FOR = `${Math.round(SCHEMA.light_max_s / 60)} minutes`;
const ZONE_COPY = {
  pool: { label: 'Light the pool', kind: 'primary', done: 'Asked TouchDesigner to light the pool', before: `Lights the LEDs below the pool line, until you press Off (at most ${LIT_FOR}). Asks first.`,
    confirm: () => ({ title: 'Light the pool?', body: `TouchDesigner lights the LEDs below the pool line (${(S.pool ?? POOL_START).toFixed(2)} m) instead of the show there, until someone presses Off or for ${LIT_FOR}.`, ok: 'Light the pool', cancel: 'Not now', destructive: true }) },
  eddies: { label: 'Light the eddies', kind: 'primary', done: 'Asked TouchDesigner to light the eddies', before: `Lights the LEDs at the driftwood eddies, until you press Off (at most ${LIT_FOR}). Asks first.`,
    confirm: () => ({ title: 'Light the eddies?', body: `TouchDesigner lights the LEDs at the driftwood eddies instead of the show there, until someone presses Off or for ${LIT_FOR}.`, ok: 'Light the eddies', cancel: 'Not now', destructive: true }) },
  off: { label: 'Off: back to the show', kind: 'plain', done: 'Asked TouchDesigner to go back to the show', before: 'Puts the pool and eddies back to the show, and keeps the pool line you set.', confirm: null },
};
for (const light of ['pool', 'eddies', 'off']) {
  const c = ZONE_COPY[light];
  ctls[light] = control($(`#z-${light}`), { ...c, action: 'remembered-zones', expectS: EXPECT_S['remembered-zones'], what: changeLabel('remembered-zones', { light }),
    noAnswer: 'the pool line under the slider says what bitcube has', done: (r) => `${c.done}${r?.written?.pool_height_m != null ? ` (pool line ${Number(r.written.pool_height_m).toFixed(2)} m)` : ''}`,
    run: () => api('/api/control/remembered-zones', { light, ...(S.pool != null ? { pool_height_m: S.pool } : {}) }),
    onSent: () => { S.poolTouched = false; afterSend(); }, onFail: () => status.refresh(), lock: () => [poolInput, $('#pool-less'), $('#pool-more')] });
}
ctls.opening = control($('#z-opening'), { action: 'remembered-opening', expectS: EXPECT_S['remembered-opening'], label: 'Turn opening night on', kind: 'primary',
  noAnswer: 'the line above says what bitcube has', done: 'Sent', run: () => api('/api/control/remembered-opening', { on: S.openingWant === true }), onSent: afterSend, onFail: () => status.refresh() });
S.openingShown = undefined;
const SCREEN_KEYS = ['intensity', 'threshold', 'video'];
const screenInput = Object.fromEntries(SCREEN_KEYS.map((k) => [k, $(`#${k}`)]));
S.scr = {}; S.scrTouched = {};
const screensBody = () => screensChange(S.scr, S.scrTouched);
function setScreen(k, x, touched = true) {
  S.scr[k] = Math.round(Math.min(100, Math.max(0, x))); if (touched) S.scrTouched[k] = true;
  screenInput[k].value = String(S.scr[k]); $(`#${k}-out`).textContent = pct(S.scr[k]);
  if (touched) ctls.video?.update({ what: changeLabel('remembered-screens', screensBody()), why: screensWhy() });
}
for (const k of SCREEN_KEYS) screenInput[k].addEventListener('input', () => setScreen(k, Number(screenInput[k].value)));
ctls.video = control($('#z-video'), { action: 'remembered-screens', expectS: EXPECT_S['remembered-screens'], label: 'Apply', kind: 'primary',
  before: 'Moves only the screens: the ropes keep the show.', what: changeLabel('remembered-screens', REMEMBERED_SCREENS_DEFAULT), noAnswer: 'the lines above the button say what bitcube has',
  done: () => `Asked TouchDesigner for ${changeLabel('remembered-screens', S.scrSent ?? {}).replace(/^the change of /, '')}`,
  run: () => { S.scrSent = screensBody(); return api('/api/control/remembered-screens', S.scrSent); }, onSent: () => { S.scrTouched = {}; afterSend(); }, onFail: () => status.refresh(),
  lock: () => SCREEN_KEYS.map((k) => screenInput[k]) });
function screensWhy() { return whyFor('remembered-screens') ?? (Object.keys(screensBody()).length ? null : 'move a slider first'); }

function renderControls(v) {
  // master brightness and the calm range: bitcube's values until moved here
  const mb = v?.params?.master_brightness, lo = v?.params?.calm_min, hi = v?.params?.calm_max;
  $('#master-now').textContent = `Now on bitcube: ${mb?.value != null ? `${pct(mb.value * 100)} (${mb.modeWords.toLowerCase()})` : 'not known'}`;
  if (!S.masterTouched && num(mb?.value) != null) setMaster(mb.value * 100, false); else if (S.master == null) setMaster(100, false);
  $('#calm-now').textContent = `Now on bitcube: ${lo?.value != null && hi?.value != null ? `${pct(lo.value * 100)} to ${pct(hi.value * 100)} (${lo.mode === 'auto' && hi.mode === 'auto' ? 'auto' : 'overridden'})` : 'not known'}`;
  if (!S.calmTouched) {
    setCalm('lo', (num(lo?.value) ?? PARAMS.calm_min.default) * 100, false);
    setCalm('hi', (num(hi?.value) ?? PARAMS.calm_max.default) * 100, false);
  }
  const ow = whyFor('remembered-override');
  ctls.masterApply.update({ why: masterWhy(), whyBy: S.m?.controls?.['remembered-override']?.by ?? null });
  ctls.masterAuto.update({ why: ow ?? (mb && mb.mode !== 'auto' ? null : 'it is on Auto already') });
  ctls.calmApply.update({ why: calmWhy() });
  ctls.calmAuto.update({ why: ow ?? (lo?.mode !== 'auto' || hi?.mode !== 'auto' ? null : 'it is on Auto already') });
  simPaint();
  ctls.simStop.update({ why: whyFor('remembered-simulate') ?? (v?.sim.active ? null : 'nothing is simulated') });
  const n = v?.overriddenCount ?? 0;
  $('#clear-now').innerHTML = !v ? '–' : n || v.sim.active ? `<b>${n}</b> overridden${v.sim.active ? ', and people simulated' : ''}` : 'Nothing overridden: everything on Auto';
  ctls.clearAll.update({ why: whyFor('remembered-override-clear') ?? (n || v?.sim.active || Object.keys(v?.overrides ?? {}).length ? null : 'nothing is overridden') });
  // v1's: the pool line, opening night, the screens
  const now = v?.zones?.pool_height_m ?? v?.control?.pool_height_m ?? null;
  $('#pool-now').textContent = now == null ? 'not known' : `${Number(now).toFixed(2)} m${v?.zones?.light && v.zones.light !== 'off' ? `, ${v.zones.light} lit` : ''}`;
  if (!S.poolTouched && now != null) setPool(Number(now), false); else if (S.pool == null) setPool(POOL_START, false);
  for (const l of ['pool', 'eddies', 'off']) ctls[l].update({ why: whyFor('remembered-zones'), whyBy: S.m?.controls?.['remembered-zones']?.by ?? null });
  const on = v?.opening ?? null;
  $('#opening-now').innerHTML = on == null ? 'Not known' : `Now: <b>${on ? 'on' : 'off'}</b>`;
  if (S.openingShown !== on && !ctls.opening.busy && ctls.opening.state !== 'confirm') {
    S.openingShown = on; S.openingWant = !on;
    ctls.opening.update(on ? { label: 'Turn opening night off', kind: 'plain', what: changeLabel('remembered-opening', { on: false }), confirm: null, before: "Back to the show's usual nights." }
      : { label: 'Turn opening night on', kind: 'primary', what: changeLabel('remembered-opening', { on: true }), before: 'For a crowded room: calm a little brighter, a surge at least every 5 minutes. Asks first.',
        confirm: { title: 'Turn opening night on?', body: 'Calm runs a little brighter and a surge comes at least every 5 minutes, until someone turns it off.', ok: 'Turn it on', cancel: 'Not now', destructive: false } });
  }
  ctls.opening.update({ why: whyFor('remembered-opening') });
  for (const k of SCREEN_KEYS) {
    const n2 = v?.[k]?.now ?? null, asked = v?.[k]?.asked ?? null;
    $(`#${k}-now`).textContent = n2 != null ? pct(n2 * 100) : asked != null ? `${pct(asked * 100)} asked` : 'not known';
    if (!S.scrTouched[k] && (n2 ?? asked) != null) setScreen(k, (n2 ?? asked) * 100, false);
    else if (S.scr[k] == null) setScreen(k, (v?.[k]?.default ?? REMEMBERED_SCREENS_DEFAULT[k]) * 100, false);
  }
  ctls.video.update({ why: screensWhy() });
}
/** Each status answer: the controls see the model (their own change's entry, the server's verdict). */
function judge() {
  if (!S.m || contact.lost) return;
  for (const c of Object.values(ctls)) if (c.button.isConnected) c.update({ model: S.m, readAt: status.receivedWall });
}
function renderFooter() {
  put('foot', `<div class="links">${[['Remembered river (v1 page)', '/remembered'], ['Looks', '/looks'], ['Lights: every LED', '/lights'],
    ['How overrides work', 'https://github.com/gavaiken/river-bitcube/blob/main/docs/remembered-river.md#5-touchdesigner-status-bitcube--mission-control'], ...DOC_LINKS]
    .map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>`);
}

// ---- go ----------------------------------------------------------------------------------------------------------------------
setPool(POOL_START, false);
simPaint();
render();
pollRemembered(); pollLights(); pollHistory();
setInterval(pollRemembered, REM_MS);
setInterval(pollLights, LIGHTS_MS);
setInterval(pollHistory, HIST_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollRemembered(); pollLights(); } });
document.addEventListener('mc:check', () => { status.refresh(); pollRemembered(); pollLights(); pollHistory(); });
document.addEventListener('mc:theme', () => render());
addEventListener('resize', () => drawLights());
tick(() => { if (S.rem) { S.v = rememberedV2View(S.rem, { now: serverNow(), sinceS: since(S.remAt) }); renderNow(S.v); renderSim(S.v); } });
// for the screenshot harness and the engineers' console: what the page last read
window.__rememberedV2 = () => ({ v: S.v, error: S.remError, lights: !!S.lights, hist: !!S.hist, MODE_WORDS });
