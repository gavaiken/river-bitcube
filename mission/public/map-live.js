// Live status on the system map (docs/system/index.html, served by mission control at /map/).
// Every 5 s it reads mission control's /api/status, and each box with a live check gets a mark from derive()'s verdict for
// its item (public/map-words.js dots(): the same verdicts as Status and the signal chain): ✓ OK (green circle), ▲ needs
// attention (amber triangle), ✕ down (red square), ? not known (grey ring). Shape and word as well as colour, so a
// colour-blind engineer reads it too; each box's accessible name says its live state first.
// A last answer is never green (docs/mission-ui.md, rule 3): a request is abandoned after 8 s, and once 30 s pass without an
// answer, or a check is older than it should be, every mark it can no longer vouch for turns "not known" and says so.
(function () {
  const TIMEOUT_MS = 8000;
  const SVGNS = 'http://www.w3.org/2000/svg';
  let last = null, gotAt = null, gotWall = null, W = null, notice = null;
  const startedAt = performance.now();
  import('/map-words.js').then((M) => { W = M; notice = M.contactNotice(); paint(); }).catch(() => { /* the documented colours stay */ });
  /** ms since the last answer: the larger of the monotonic and the wall clock (a phone that slept). */
  const sinceMs = () => (gotAt == null ? null : Math.max(performance.now() - gotAt, Date.now() - gotWall, 0));

  // the marks' colours follow the diagram's theme (its own switch, data-theme on <html>), from mission control's tokens
  const style = document.createElement('style');
  const LIGHT = '--lv-ok:#1b6e3a;--lv-ok-ink:#fff;--lv-warn:#f2b233;--lv-warn-ink:#1c2228;--lv-down:#b9372a;--lv-down-ink:#fff;--lv-unk:#5c6670;--lv-ring:#1c2228;';
  const DARK = '--lv-ok:#2fae62;--lv-ok-ink:#06140b;--lv-warn:#f0b429;--lv-warn-ink:#1d1500;--lv-down:#ef6a57;--lv-down-ink:#1e0905;--lv-unk:#8a949e;--lv-ring:#e2ebee;';
  style.textContent = `:root{${LIGHT}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
#map .node.live circle.dot{display:none}
.live-mk{pointer-events:none}
.live-mk .b{stroke:var(--lv-ring);stroke-width:.8}
.live-mk.ok .b{fill:var(--lv-ok)} .live-mk.ok .g{stroke:var(--lv-ok-ink)}
.live-mk.warning .b{fill:var(--lv-warn)} .live-mk.warning .g{stroke:var(--lv-warn-ink)}
.live-mk.down .b{fill:var(--lv-down)} .live-mk.down .g{stroke:var(--lv-down-ink)}
.live-mk.unknown .b{fill:var(--surface,#fff);stroke:var(--lv-unk);stroke-width:2}
.live-mk .g{fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.live-mk.unknown .g{stroke:var(--lv-unk)}
#live-bar{position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:9;padding:8px 12px;border-radius:10px;
  font:14px/1.4 system-ui,-apple-system,sans-serif;background:var(--surface,#fff);color:var(--ink,#13232c);border:1px solid var(--line-strong,#7d8f97);
  box-shadow:var(--shadow,0 4px 16px rgba(0,0,0,.2));max-width:calc(100vw - 20px);box-sizing:border-box}
#live-bar .k{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;margin-right:8px}
#live-bar svg{width:14px;height:14px;flex:none}`;
  document.head.appendChild(style);

  /** A mark's shape, centred on (0, 0) with radius r: the level's own outline and glyph (✓ ▲ ✕ ?), never colour alone. */
  function shape(level, r) {
    const g = r * 0.45;
    if (level === 'ok') return `<circle class="b" r="${r}"/><path class="g" d="M${-g},${g * 0.05} L${-g * 0.25},${g * 0.75} L${g},${-g * 0.7}"/>`;
    if (level === 'warning') return `<path class="b" d="M0,${-r * 1.1} L${r * 1.05},${r * 0.8} L${-r * 1.05},${r * 0.8} Z"/><path class="g" d="M0,${-r * 0.45} L0,${r * 0.15} M0,${r * 0.48} L0,${r * 0.5}"/>`;
    if (level === 'down') return `<rect class="b" x="${-r * 0.92}" y="${-r * 0.92}" width="${r * 1.84}" height="${r * 1.84}" rx="${r * 0.25}"/><path class="g" d="M${-g},${-g} L${g},${g} M${g},${-g} L${-g},${g}"/>`;
    return `<circle class="b" r="${r * 0.85}"/><path class="g" d="M${-g * 0.55},${-g * 0.55} C${-g * 0.55},${-g * 1.3} ${g * 0.75},${-g * 1.3} ${g * 0.6},${-g * 0.45} C${g * 0.5},${-g * 0.05} 0,${g * 0.05} 0,${g * 0.45} M0,${g * 1.05} L0,${g * 1.07}"/>`;
  }
  const icon = (level) => `<svg viewBox="-8 -8 16 16" aria-hidden="true"><g class="live-mk ${level}">${shape(level, 6)}</g></svg>`;

  /** The live marks: patched in place (the observer below calls this after every redraw of the diagram, so every write
   *  here is skipped when nothing changed, or it would wake itself). */
  function paint() {
    let d = {};
    if (W) {
      const ms = sinceMs();
      if (last) d = W.dots(last, last.now + ms);
      else for (const id of Object.keys(W.DOT_ITEMS)) d[id] = { level: 'unknown', why: 'no answer from mission control yet' };
    }
    document.querySelectorAll('#map g.node[data-id]').forEach((g) => {
      const x = d[g.getAttribute('data-id')], dot = g.querySelector('circle.dot');
      let mk = g.querySelector(':scope > g.live-mk');
      if (!x || !dot) {
        if (mk) { mk.remove(); g.classList.remove('live'); }
        if (g.dataset.baseLabel && g.getAttribute('aria-label') !== g.dataset.baseLabel) g.setAttribute('aria-label', g.dataset.baseLabel);
        return;
      }
      const cx = dot.getAttribute('cx'), cy = dot.getAttribute('cy'), r = Math.max(5.5, +dot.getAttribute('r') * 1.5);
      if (!mk) { mk = document.createElementNS(SVGNS, 'g'); mk.setAttribute('aria-hidden', 'true'); g.appendChild(mk); }
      const key = `${x.level}|${cx}|${cy}|${r}`;
      if (mk.dataset.key !== key) {
        mk.dataset.key = key;
        mk.setAttribute('class', `live-mk ${x.level}`);
        mk.setAttribute('transform', `translate(${cx},${cy})`);
        mk.innerHTML = shape(x.level, r);
      }
      if (!g.classList.contains('live')) g.classList.add('live');
      // the accessible name: its live state first ("bitcube, computer: Down now (TouchDesigner: …). Documented as working.")
      if (!g.dataset.baseLabel) g.dataset.baseLabel = g.getAttribute('aria-label') || '';
      const n = { name: g.dataset.name, kind: g.dataset.kind, status: g.dataset.status, verified: g.dataset.verified };
      const label = n.name && W ? W.dotLabel(n, x) : `${g.dataset.baseLabel}; now ${x.level === 'warning' ? 'needs attention' : x.level === 'unknown' ? 'not known' : x.level}`;
      if (g.getAttribute('aria-label') !== label) g.setAttribute('aria-label', label);
      const t = g.querySelector(':scope > title');
      if (t) {
        if (g.dataset.baseTitle == null) g.dataset.baseTitle = t.textContent;
        const tip = `${g.dataset.baseTitle}\n${W ? W.dotWords(x) : x.level}`;
        if (t.textContent !== tip) t.textContent = tip;
      }
    });
    // the bar ticks, so it is not a live region: a hidden one says "No contact with mission control." once when contact is
    // lost (30 s without an answer, or none since the page started asking) and "Contact with mission control is back." once
    const said = document.getElementById('live-said'), ms = sinceMs();
    if (said && notice) { const t = notice((ms ?? performance.now() - startedAt) > 30_000, performance.now()); if (said.textContent !== t) said.textContent = t; }
    const a = document.getElementById('live-age');
    if (!a) return;
    const words = W ? `· ${W.liveLine(last, sinceMs())}` : '· connecting to mission control';
    if (a.textContent !== words) a.textContent = words;
  }

  const bar = document.createElement('div');
  bar.id = 'live-bar';
  // spaces between the keys, so a screen reader says "OK, needs attention, down" and not "OKneeds attention"
  bar.innerHTML = `<b>Live:</b> <span class="k">${icon('ok')}OK,</span> <span class="k">${icon('warning')}needs attention,</span> <span class="k">${icon('down')}down,</span> <span class="k">${icon('unknown')}not known</span> <span id="live-age"></span><span id="live-said" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"></span>`;
  // the bar sits over the page's bottom: the page gets that much room below its last line, so nothing stays covered
  const room = () => { document.body.style.paddingBottom = `${bar.offsetHeight + 20}px`; };
  document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(bar); room(); if (window.ResizeObserver) new ResizeObserver(room).observe(bar); paint(); });
  new MutationObserver(() => paint()).observe(document.documentElement, { childList: true, subtree: true });
  let busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const r = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) return;
      const s = await r.json();
      if (typeof s.now !== 'number') s.now = Date.now();
      last = s; gotAt = performance.now(); gotWall = Date.now();
      paint();
    } catch (e) { /* no answer: the age keeps growing, and past 30 s every mark is not known */ } finally { busy = false; }
  }
  poll(); setInterval(poll, 5000); setInterval(paint, 1000);
})();
