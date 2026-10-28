// Mission control: the Looks page (/looks; docs/mission-ui.md "Looks page"). The river (all looks, playlist): what shows now, the
// playlist editor (a local draft until Apply, then bitcube's), one section per look the running file lists (its description, inputs
// and where its settings are), and the inputs the looks share. Every word comes from looks-words.js (pure, tested in node); the
// controls follow "Applying a change" through ui.js control(), greyed with the model's reason (model.js controls.looks).
// GET /api/status every 5 s. Plain ES module, no build step.
import { mountShell, poll, tick, watchContact, art, control, api, esc, DOC_LINKS, serverNow } from '/ui.js';
import { derive, changeLabel, EXPECT_S } from '/model.js';
import { askedIs, looksView } from '/looks.js';
import { pageView, editPlaylist, settingsWords, lookInfo } from '/looks-words.js';

const $ = (s) => document.querySelector(s);
const S = { m: null, v: null, draft: null, html: {}, sectionsKey: null, pins: {} };
const put = (id, html) => { if (S.html[id] !== html) { S.html[id] = html; const el = document.getElementById(id); if (el) el.innerHTML = html; } };

const shell = mountShell({ page: 'looks', title: 'Looks' });
const status = poll('/api/status', { every: 5000, onData: () => { S.m = derive(status.last, serverNow()); render(); judge(); }, onError: () => render() });
const contact = watchContact(status, shell, () => render());
const lkv = (m) => looksView(m?.show?.looks, m?.show?.fresh?.probe_age_s ?? 0);
const whyOf = (extra = null) => (contact.lost ? "mission control isn't answering" : S.m?.controls?.looks?.why ?? extra);
const by = () => S.m?.controls?.looks?.by ?? null;

// ---- the controls ------------------------------------------------------------------------------------------------------------
const applyCtl = control($('#pl-apply'), { action: 'looks', expectS: EXPECT_S.looks, label: 'Apply the playlist', kind: 'primary',
  before: 'Sends the playlist; bitcube plays it from its first look, again and again.', what: changeLabel('looks', { mode: 'auto', playlist: [] }),
  noAnswer: 'the line at the top shows what bitcube reports',
  run: () => api('/api/control/looks', S.v.playlist.body),
  holds: (m) => askedIs(lkv(m), S.lastBody ?? {}),
  done: 'Sent: bitcube plays the new playlist', fail: 'The playlist is unchanged',
  onSent: () => { S.lastBody = S.v?.playlist?.body; S.draft = null; status.refresh(); render(); }, onFail: () => status.refresh() });
const backCtl = control($('#pl-back'), { action: 'looks', expectS: EXPECT_S.looks, label: 'Back to the playlist', kind: 'plain',
  before: 'Leaves the pinned look and plays the playlist again.', what: changeLabel('looks', { mode: 'auto' }),
  run: () => api('/api/control/looks', { mode: 'auto' }), done: 'Back on the playlist', fail: 'Still pinned',
  onSent: () => status.refresh(), onFail: () => status.refresh() });
$('#pl-reset').onclick = () => { S.draft = null; render(); };
$('#pl-add').onclick = () => { const l = $('#pl-pick').value; if (l && S.v) { S.draft = editPlaylist(currentList(), { op: 'add', look: l }); render(); } };
$('#pl-pick').onchange = () => render();
$('#pl-rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-op]');
  if (!b || !S.v) return;
  const i = Number(b.dataset.i), op = b.dataset.op;
  if (op === 'pin') { S.pins[b.dataset.look]?.button.click(); return; }
  S.draft = editPlaylist(currentList(), { op, i });
  render();
  document.querySelector(`#pl-rows button[data-op="${op}"][data-i="${op === 'up' ? i - 1 : op === 'down' ? i + 1 : i}"]`)?.focus();
});
const currentList = () => S.v.playlist.rows.map((r) => ({ look: r.look, for: { [r.unit]: r.n } }));

// ---- render ------------------------------------------------------------------------------------------------------------------
function render() {
  const v = S.m ? pageView(S.m, S.draft) : null;
  S.v = v;
  art.setSeason(null);
  renderNow(v); renderPlaylist(v); renderInputs(v); renderSections(v); renderFooter();
}
function renderNow(v) {
  const t = $('#now-title'), line = $('#now-line'), why = $('#now-why');
  if (!v) { t.textContent = 'Connecting…'; line.textContent = ''; why.hidden = true; return; }
  if (!v.running) {
    t.textContent = 'No look is showing';
    line.textContent = '';
    why.hidden = false; why.textContent = `${cap(v.why ?? "the river (all looks) isn't running")}. Switch to it under What's showing on Status.`;
  } else if (!v.now) {
    t.textContent = 'Which look shows isn\'t known yet'; line.textContent = v.problems[0] ? cap(v.problems[0]) : ''; why.hidden = true;
  } else {
    t.textContent = v.now.title;
    line.innerHTML = [v.now.mode, v.now.line, v.now.fading].filter(Boolean).map(esc).join(' · ') + (v.now.old ? ` · <span class="old">its last report is ${esc(String(v.now.age_s))} s old: it has stopped reporting</span>` : '');
    why.hidden = !v.applyWhy || !!v.why; why.textContent = v.applyWhy && !v.why ? `${cap(v.applyWhy)}.` : '';
  }
  put('now-problems', (v.problems ?? []).map((p) => `<li>${esc(cap(p))}</li>`).join(''));
  $('#now-problems').hidden = !(v.problems ?? []).length;
}
function renderPlaylist(v) {
  const off = !v || !v.running;
  $('#pl-note').textContent = !v ? '' : !v.running ? 'The playlist shows here while the river (all looks) runs.' : v.playlist.note;
  const rows = !v || !v.running ? [] : v.playlist.rows;
  const pinWhy = whyOf();
  put('pl-rows', rows.map((r, i) => `<li class="pl-row${v.now?.position === i && v.playlist.source !== 'draft' ? ' on' : ''}">
    <div class="pl-t">${i + 1}. ${esc(r.title)}${v.now?.position === i && v.playlist.source !== 'draft' ? '<small>showing now</small>' : ''}</div>
    <div class="pl-btns">
      <button type="button" class="btn step" data-op="less" data-i="${i}" aria-label="One ${esc(r.unit.slice(0, -1))} less for ${esc(r.title)}" ${r.canLess ? '' : 'disabled'}>−</button>
      <span class="pl-for">${esc(r.words)}</span>
      <button type="button" class="btn step" data-op="more" data-i="${i}" aria-label="One ${esc(r.unit.slice(0, -1))} more for ${esc(r.title)}" ${r.canMore ? '' : 'disabled'}>+</button>
      <button type="button" class="btn" data-op="up" data-i="${i}" aria-label="Move ${esc(r.title)} up" ${i > 0 ? '' : 'disabled'}>↑</button>
      <button type="button" class="btn" data-op="down" data-i="${i}" aria-label="Move ${esc(r.title)} down" ${i < rows.length - 1 ? '' : 'disabled'}>↓</button>
      <button type="button" class="btn" data-op="remove" data-i="${i}" aria-label="Remove ${esc(r.title)}" ${rows.length > 1 ? '' : 'disabled'}>Remove</button>
      <button type="button" class="btn" data-op="pin" data-i="${i}" data-look="${esc(r.look)}" ${pinWhy || !v.listed.includes(r.look) ? 'disabled' : ''}>Pin this look</button>
    </div></li>`).join(''));
  // the picker: only the looks the running file lists, with the picked one's description
  const pick = $('#pl-pick'), was = pick.value, opts = off ? [] : v.playlist.addable;
  const optHTML = opts.map((l) => `<option value="${esc(l)}">${esc(lookInfo(v.file, l).title)}</option>`).join('');
  if (S.html['pl-pick'] !== optHTML) { S.html['pl-pick'] = optHTML; pick.innerHTML = optHTML; if (opts.includes(was)) pick.value = was; }
  const d = pick.value && v ? lookInfo(v.file, pick.value).description : '';
  $('#pl-pick-desc').textContent = d;
  pick.disabled = off || v.playlist.full; $('#pl-add').disabled = off || v.playlist.full || !pick.value;
  $('#pl-reset').hidden = !S.draft;
  const body = v?.playlist?.body;
  applyCtl.update({ why: !v ? 'waiting for bitcube' : whyOf(v.applyWhy) ?? (!v.playlist.changed && v.playlist.source !== 'default' ? 'the playlist is what bitcube already has: change it first' : null), whyBy: by(),
    what: body ? changeLabel('looks', body) : 'the change of the looks' });
  backCtl.update({ why: !v ? 'waiting for bitcube' : whyOf() ?? (v.manual ? null : 'it already plays the playlist'), whyBy: by() });
}
function dl(lines) { return `<dl>${lines.map((l) => `<dt>${esc(l.key)}</dt><dd>${esc(l.words)}</dd>`).join('')}</dl>`; }
function renderInputs(v) {
  const i = v?.inputs;
  if (!v || !v.running) return put('in-body', '<p class="muted">The inputs show here while the river (all looks) runs.</p>');
  if (!i) return put('in-body', `<p class="muted">${esc(v.allLooks ? "The show hasn't reported its inputs yet." : 'This file doesn\'t report its inputs: the river (all looks, playlist) does.')}</p>`);
  const group = (title, g) => (!g ? `<div class="in-group"><h3>${esc(title)}</h3><p class="muted">Not reported</p></div>`
    : `<div class="in-group"><h3>${esc(title)}${g.age ? ` <small class="${g.old ? 'old' : 'muted'}">${esc(g.age)}</small>` : ''}</h3>${g.palette?.length ? `<div class="swatches" aria-hidden="true">${g.palette.map((c) => `<span style="background:${esc(c)}"></span>`).join('')}</div>` : ''}${dl(g.lines)}</div>`);
  put('in-body', group("Dave's agent", i.dave) + group('The river', i.river) + group('The room', i.room)
    + `<div class="in-group"><h3>${esc(i.used.title)}</h3>${i.used.lines.length ? dl(i.used.lines) : `<p class="muted">${esc(i.used.none)}</p>`}</div>`);
}
function renderSections(v) {
  const listed = v?.running ? v.listed : [];
  const key = listed.join(',');
  if (S.sectionsKey !== key) {
    S.sectionsKey = key; S.pins = {};
    const host = $('#sections');
    host.innerHTML = listed.length ? '' : '<section class="card"><p class="muted">One section per look, while the river (all looks) runs.</p></section>';
    for (const l of listed) {
      const sec = document.createElement('section');
      sec.className = 'card lk-sec'; sec.id = `look-${l}`;
      sec.innerHTML = `<h3 class="card-h" id="look-${l}-h"></h3><p class="lk-desc" id="look-${l}-desc"></p><div id="look-${l}-in"></div><p id="look-${l}-set"></p><div class="ctl" id="look-${l}-ctl"><div id="look-${l}-pin"></div></div>`;
      host.append(sec);
      S.pins[l] = control(sec.querySelector(`#look-${l}-pin`), { action: 'looks', expectS: EXPECT_S.looks, label: 'Pin this look', kind: 'plain',
        before: 'Fades to it and stays on it until Back to the playlist.', what: changeLabel('looks', { mode: 'manual', look: l }),
        run: () => api('/api/control/looks', { mode: 'manual', look: l }), done: 'Pinned', fail: 'Nothing changed',
        holds: (m) => askedIs(lkv(m), { mode: 'manual', look: l }), onSent: () => status.refresh(), onFail: () => status.refresh() });
    }
  }
  for (const s of v?.running ? v.sections : []) {
    const w = settingsWords(s.look);
    put(`look-${s.look}-h`, `${esc(s.title)}${s.showing ? '<span class="lk-tag">showing</span>' : ''}${s.pinned ? '<span class="lk-tag">pinned</span>' : ''}`);
    put(`look-${s.look}-desc`, esc(s.description));
    put(`look-${s.look}-in`, s.inputs.length ? `<p class="muted">Its inputs:</p><ul>${s.inputs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    put(`look-${s.look}-set`, `${esc(w.line)}${w.link ? ` <a href="${esc(w.link[1])}" ${w.link[1].startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(w.link[0])}</a>` : ''}`);
    S.pins[s.look]?.update({ why: whyOf() ?? (s.pinned ? 'it is pinned already' : null), whyBy: by() });
  }
}
function judge() {
  if (!S.m || contact.lost) return;
  for (const c of [applyCtl, backCtl, ...Object.values(S.pins)]) if (c.button.isConnected) c.update({ model: S.m, readAt: status.receivedWall });
}
function renderFooter() {
  put('foot', `<div class="links">${[['Status', '/status'], ['Remembered river page', '/remembered'], ['How the looks work', 'https://github.com/gavaiken/river-bitcube/blob/main/docs/mission-ui.md#looks-page'], ...DOC_LINKS]
    .map(([l, h]) => `<a href="${h}" ${h.startsWith('/') ? '' : 'target="_blank" rel="noopener"'}>${esc(l)}</a>`).join('')}</div>`);
}
const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);

// ---- go ----------------------------------------------------------------------------------------------------------------------
render();
document.addEventListener('mc:check', () => status.refresh());
document.addEventListener('mc:theme', () => render());
tick(() => {});
// for the screenshot harness and the engineers' console: what the page last read
window.__looks = () => ({ v: S.v, draft: S.draft });
