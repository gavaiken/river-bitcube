// What Modal sends, read straight from its two public endpoints (Gavin, 28 Oct: "we want to show every value coming from the
// modal thing"): the scene (public/scene.json: the scene, the camera reflex, the effective knobs, the journal) and the newest
// Modal Frames manifest (frames/latest.json, modal-frames/SPEC.md). No token: both are public. Polled every 15 s whatever show
// runs, with If-None-Match (both send an ETag, so an unchanged answer is a 304 with no body), a short timeout, and the last good
// copy kept: a failure only sets ok false and the error beside it, so the page never waits on Modal and never loses what it had.
// The page (public/modal-feed.js modalFeedView) lists every field, known or not.
export const MODAL_FEED_BASE = 'https://to-be-a-river--river.modal.run';
export const MODAL_FEED_PATHS = { scene: '/public/scene.json', frames: '/frames/latest.json' };
export const MODAL_FEED_EVERY_MS = 15_000;
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 64 * 1024;          // today 0.8 and 1.5 KB; anything far bigger is not what we expect and is refused
const ETAG = /^(?:W\/)?"[\x21\x23-\x7e]{1,200}"$/;
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);

export class ModalFeed {
  constructor({ base = MODAL_FEED_BASE, fetch = globalThis.fetch, now = () => Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
    Object.assign(this, { base, fetch, now, timeoutMs });
    this.state = Object.fromEntries(Object.keys(MODAL_FEED_PATHS).map((k) => [k, { json: null, etag: null, fetched_at: null, changed_at: null, ok: null, error: null }]));
    this.inflight = null;
  }

  /** Ask both endpoints (at most one round at a time: a slow Modal never piles up requests). Never throws. */
  poll() {
    if (!this.inflight) this.inflight = Promise.all(Object.keys(MODAL_FEED_PATHS).map((k) => this.#one(k))).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async #one(key) {
    const s = this.state[key];
    try {
      const headers = s.etag && s.json ? { 'if-none-match': s.etag } : {};
      const r = await this.fetch(this.base + MODAL_FEED_PATHS[key], { headers, signal: AbortSignal.timeout(this.timeoutMs) });
      const at = new Date(this.now()).toISOString();
      if (r.status === 304 && s.json) { Object.assign(s, { fetched_at: at, ok: true, error: null }); return; }
      if (!r.ok) throw new Error(`Modal answered ${r.status}`);
      const text = await r.text();
      if (text.length > MAX_BYTES) throw new Error(`Modal's answer is too large (${text.length} bytes)`);
      let json;
      try { json = JSON.parse(text); } catch { throw new Error("Modal's answer isn't readable"); }
      if (!obj(json)) throw new Error("Modal's answer isn't readable");
      const etag = r.headers?.get?.('etag') ?? null;
      const changed = JSON.stringify(json) !== JSON.stringify(s.json);
      Object.assign(s, { json, etag: typeof etag === 'string' && ETAG.test(etag) ? etag : null, fetched_at: at, ok: true, error: null,
                         ...(changed ? { changed_at: at } : {}) });
    } catch (e) {
      const why = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? "Modal didn't answer in time" : String(e?.message ?? e).slice(0, 200);
      Object.assign(s, { ok: false, error: why });                 // the last good copy stays
    }
  }

  /** What /api/status serves as modal_feed: per endpoint the raw answer (json, the last good one), when it was last fetched
   *  (fetched_at: a 200 or a 304), when its content last changed (changed_at), ok and error. */
  value() {
    return Object.fromEntries(Object.entries(this.state).map(([k, s]) => [k, { json: s.json, fetched_at: s.fetched_at, changed_at: s.changed_at, ok: s.ok, error: s.error }]));
  }
}
