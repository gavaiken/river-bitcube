// Live status on the system map (docs/system/index.html, served by mission control at /map/).
// Every 5 s it reads mission control's /api/status and repaints each box's status dot: green = up, red = down,
// amber = not known yet. Things behind bitcube are checked from bitcube (tools/mission/probe.ps1).
(function () {
  const C = { up: '#2ea043', down: '#f85149', unknown: '#d29922' };
  let live = {};
  function toMap(s) {
    const pr = s.probe && s.probe.value, dv = (pr && pr.devices) || {}, known = !!pr;
    const k = (v) => (known ? !!v : undefined);
    const led = ((pr && pr.displays) || []).some((d) => /^LED/i.test(d));
    const bc = s.bitcube && s.bitcube.value;
    const m = {
      'gavin-mini': true,
      bitcube: bc ? (bc.online ? (known ? true : undefined) : false) : undefined,
      'router-gallery': k(dv.router), 'gallery-net': k(dv.internet), 'public-internet': k(dv.internet),
      'cam-gallery': k(dv.gallery_cam), 'cam-river': k(dv.river_cam), glinet: k(dv.river_cam), starlink: k(dv.river_cam),
      'psac10-1': k(dv.psac10_1), 'psac10-2': k(dv.psac10_2), 'colorlight-sender': known ? led : undefined,
      'modal-app': s.modal ? !!(s.modal.value && s.modal.value.ok) : undefined,
      'ep-data': s.modal ? !!s.modal.value : undefined,
    };
    for (let i = 1; i <= 20; i++) m['rope-' + String(i).padStart(2, '0')] = k(i <= 10 ? dv.psac10_1 : dv.psac10_2);
    return m;
  }
  function paint() {
    for (const [id, ok] of Object.entries(live)) {
      document.querySelectorAll(`g.node[data-id="${id}"] circle.dot`).forEach((dot) => {
        dot.style.fill = ok === true ? C.up : ok === false ? C.down : C.unknown;
        dot.style.stroke = 'rgba(0,0,0,.35)';
      });
    }
  }
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9;padding:6px 10px;border-radius:8px;font:12px system-ui;background:rgba(20,24,30,.85);color:#e8ecf1';
  bar.innerHTML = `Live: <b style="color:${C.up}">●</b> up · <b style="color:${C.down}">●</b> down · <b style="color:${C.unknown}">●</b> not known <span id="live-age"></span>`;
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar));
  new MutationObserver(paint).observe(document.documentElement, { childList: true, subtree: true });
  async function poll() {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      live = toMap(s); paint();
      const a = document.getElementById('live-age');
      if (a && s.probe) a.textContent = `· bitcube checked ${s.probe.age_s}s ago`;
    } catch (e) { /* next time */ }
  }
  poll(); setInterval(poll, 5000);
})();
