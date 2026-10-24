// Live status on the system map (docs/system/index.html, served by mission control at /map/).
// Every 5 s it reads mission control's /api/status and repaints each box's status dot: green = up, red = down,
// amber = not known (or needs attention). Things behind bitcube are checked from bitcube (tools/mission/probe.ps1).
// A last answer is never green (docs/mission-ui.md, rule 3): a request is abandoned after 8 s, and once 30 s pass without
// an answer, or bitcube's full check is older than 3 min, every dot it can no longer vouch for goes amber and says so.
(function () {
  const C = { up: '#2ea043', down: '#f85149', unknown: '#d29922' };
  const LOST_MS = 30_000, PROBE_OLD_S = 180, TIMEOUT_MS = 8000;
  let live = {}, last = null, gotAt = null, gotWall = null, derive = null;
  // the model's own verdict for Dave's agent (late or reporting a problem is not "up"); until it loads, that dot is amber
  import('/model.js').then((M) => { derive = M.derive; if (last) { live = toMap(last); paint(); } }).catch(() => {});
  /** ms since the last answer: the larger of the monotonic and the wall clock (a phone that slept). */
  const sinceMs = () => (gotAt == null ? Infinity : Math.max(performance.now() - gotAt, Date.now() - gotWall, 0));
  const probeAgeS = () => (last && last.probe && typeof last.probe.age_s === 'number' ? last.probe.age_s + sinceMs() / 1000 : null);
  function toMap(s) {
    const pa = s.probe && typeof s.probe.age_s === 'number' ? s.probe.age_s : null;
    const pr = s.probe && s.probe.value, dv = (pr && pr.devices) || {}, known = !!pr && !(pa != null && pa > PROBE_OLD_S);
    const k = (v) => (known ? !!v : undefined);
    const led = ((pr && pr.displays) || []).some((d) => /^LED/i.test(d));
    const bc = s.bitcube && s.bitcube.value;
    let modal;
    if (s.modal && derive) {
      try {
        const it = derive(s, typeof s.now === 'number' ? s.now : Date.now()).items.find((x) => x.id === 'modal agent');
        modal = it && it.level === 'ok' ? true : it && it.level === 'down' ? false : undefined;
      } catch (e) { modal = undefined; }
    }
    const m = {
      'gavin-mini': true,
      bitcube: bc ? (bc.online ? (known ? true : undefined) : false) : undefined,
      'router-gallery': k(dv.router), 'gallery-net': k(dv.internet), 'public-internet': k(dv.internet),
      'cam-gallery': k(dv.gallery_cam), 'cam-river': k(dv.river_cam), glinet: k(dv.river_cam), starlink: k(dv.river_cam),
      'psac10-1': k(dv.psac10_1), 'psac10-2': k(dv.psac10_2), 'colorlight-sender': known ? led : undefined,
      'modal-app': modal,
      'ep-data': s.modal ? !!s.modal.value : undefined,
    };
    for (let i = 1; i <= 20; i++) m['rope-' + String(i).padStart(2, '0')] = k(i <= 10 ? dv.psac10_1 : dv.psac10_2);
    return m;
  }
  function paint() {
    const lost = sinceMs() > LOST_MS;
    for (const [id, ok] of Object.entries(live)) {
      const v = lost ? undefined : ok;    // no answer: nothing is known now, not even that the mini is up
      document.querySelectorAll(`g.node[data-id="${id}"] circle.dot`).forEach((dot) => {
        dot.style.fill = v === true ? C.up : v === false ? C.down : C.unknown;
        dot.style.stroke = 'rgba(0,0,0,.35)';
      });
    }
    const a = document.getElementById('live-age');
    if (!a) return;
    const n = (s) => Math.round(s);
    const pa = probeAgeS();
    const t = gotAt == null ? '· no answer from mission control yet'
      : lost ? `· no answer from mission control for ${n(sinceMs() / 1000)} s: every dot is not known`
      : pa == null ? '· bitcube not checked yet'
      : pa > PROBE_OLD_S ? `· bitcube last checked ${n(pa / 60)} min ago: what it reports is not known now`
      : `· bitcube checked ${n(pa)} s ago`;
    if (a.textContent !== t) a.textContent = t;
  }
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9;padding:6px 10px;border-radius:8px;font:12px system-ui;background:rgba(20,24,30,.85);color:#e8ecf1;max-width:calc(100vw - 20px)';
  bar.innerHTML = `Live: <b style="color:${C.up}">●</b> up · <b style="color:${C.down}">●</b> down · <b style="color:${C.unknown}">●</b> not known or needs attention <span id="live-age"></span>`;
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar));
  new MutationObserver(() => paint()).observe(document.documentElement, { childList: true, subtree: true });
  let busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const r = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) return;
      const s = await r.json();
      last = s; gotAt = performance.now(); gotWall = Date.now();
      live = toMap(s); paint();
    } catch (e) { /* no answer: the age keeps growing, and past 30 s every dot goes amber */ } finally { busy = false; }
  }
  poll(); setInterval(poll, 5000); setInterval(paint, 1000);
})();
