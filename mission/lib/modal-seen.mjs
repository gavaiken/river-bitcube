// What Dave's agent has sent lately, as mission control saw it (docs/mission-ui.md "Modal input"): the last few distinct frame ids
// and scene set_at times from successive full checks of the Modal input show, kept in memory only (a restart forgets them, and the
// page then says nothing about how often until it has seen two). The page turns them into "about every 2 min lately"
// (public/modal-input.js cadenceS). Each full check is a minute apart and Dave sends every 1–4 min, so one may be missed now and
// then: the page says "about".
const KEEP = 10;
const FRAME_ID = /^[A-Za-z0-9._-]{1,80}$/;
const SET_AT = /^[0-9T:.+\-Z]{10,40}$/;
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);

export class ModalSeen {
  constructor(keep = KEEP) { this.keep = keep; this.frames = []; this.scene = []; }
  /** Note the frame id and the scene's set_at in a td.modal_input reading (new ones only, oldest first, the last `keep`). */
  observe(mi) {
    const s = obj(obj(mi)?.sources);
    if (!s) return;
    const push = (list, x, ok) => {
      if (typeof x !== 'string' || !ok.test(x) || list.includes(x)) return;
      list.push(x);
      if (list.length > this.keep) list.splice(0, list.length - this.keep);
    };
    push(this.frames, obj(s.frames)?.frame_id, FRAME_ID);
    push(this.scene, obj(s.scene)?.set_at, SET_AT);
  }
  /** What the page reads: td.modal_input.seen. */
  list() { return { frames: [...this.frames], scene: [...this.scene] }; }
}

/** A td.modal_input with what was seen lately beside it (a copy; anything else is returned as it is). A reading that already
 *  carries its own `seen` (a fixture) keeps it. */
export function withSeen(mi, seen) {
  if (!obj(mi) || obj(mi.seen)) return mi;
  return { ...mi, seen: seen.list() };
}
