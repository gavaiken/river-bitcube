// Shared helpers for mission control's pages (ui.js builds on these and re-exports them: api, esc, md, plainError, noAnswerText).
// A relative import, so node's tests load it too (test/client.test.mjs); in the browser it is the same /model.js ui.js loads.
import { dur, clock } from './model.js';

/** How long a request may go unanswered before the page gives up: a little past the server's own limit for the action
 *  (about 60 s; a rebuild builds, saves and restarts, up to 400 s), so a hung POST never leaves a control pending for good. */
export function apiTimeout(path, body) {
  if (body === undefined) return 30_000;
  // Check now: its own time, a little past the full check's (45 s), never the 75 s of a change (R10 #3)
  return /\/api\/control\/rebuild$/.test(path) ? 420_000 : /\/api\/control\/check$/.test(path) ? 50_000 : 75_000;
}
export async function api(path, body, { timeout = apiTimeout(path, body) } = {}) {
  const ctrl = new AbortController(), posted = body !== undefined;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    r = await fetch(path, body === undefined ? { signal: ctrl.signal } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    // no answer in time: the request may or may not have reached bitcube (noAnswer tells the control to say so)
    if (ctrl.signal.aborted) throw Object.assign(new Error(`no answer in ${Math.round(timeout / 1000)} s`), { noAnswer: true, maybe: posted, waitedS: timeout / 1000, posted });
    // a POST that failed at the network level (a reset, a phone changing network after the body went out) may have reached
    // mission control: it may or may not have happened, never "unchanged" (R7 #30). A GET is mission control not answering.
    if (posted) throw Object.assign(new Error("mission control didn't answer"), { noAnswer: true, maybe: true, posted: true, waitedS: null, notOurs: true, network: true });
    throw e;
  } finally { clearTimeout(timer); }
  if (r.status === 401) { location.href = '/login'; throw new Error('logged out'); }
  const j = await r.json().catch(() => null);
  const ours = j != null && typeof j === 'object';
  // A POST whose answer can't be read was received: mission control ran it (a 2xx), or a proxy may have passed it on before
  // failing (a 5xx page). It may or may not have happened, so the control never says "unchanged" (maybe, noAnswer).
  const maybe = (msg, extra) => Object.assign(new Error(msg), { noAnswer: true, maybe: true, posted: true, waitedS: null, ...extra });
  // an error that isn't mission control's JSON (a proxy's 502 page while the server is down) means mission control itself
  // didn't answer: never "couldn't reach bitcube", which would send someone to check bitcube's power
  if (!r.ok && !ours) {
    if (posted && r.status >= 500) throw maybe("mission control didn't answer", { status: r.status, notOurs: true });
    throw Object.assign(new Error("mission control didn't answer"), { status: r.status, notOurs: true });
  }
  if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { status: r.status });
  // a 2xx that isn't our JSON (a proxy's page, a cut-off body) is not a success
  if (!ours) { if (posted) throw maybe("mission control's answer couldn't be read", { unreadable: true }); throw Object.assign(new Error("mission control's answer couldn't be read"), { unreadable: true }); }
  return j;
}

/** How long a GET may go unanswered (ui.js poll()'s limit, and Lights' every fetch). */
export const POLL_TIMEOUT_MS = 8000;

/** GET with a time limit (ui.js poll()'s 8 s), the body read inside it: { r, body } (body null when it isn't JSON). Lights reads
 *  everything through it. A request that hangs throws "no answer in 8 s" instead of holding the page's next ask; 401 goes to the
 *  login. The limit runs from the start, headers and body together (CR7 #11); only `idle` puts it on silence instead: 8 s with no
 *  bytes, so the LED map (big even gzipped) loads on a slow phone link as long as it keeps coming (R7 #1). */
export async function fetchTimed(url, read = (r) => r.json(), timeout = POLL_TIMEOUT_MS, { idle = false } = {}) {
  const ctrl = new AbortController();
  let t = setTimeout(() => ctrl.abort(), timeout);
  const heard = () => { clearTimeout(t); t = setTimeout(() => ctrl.abort(), timeout); };
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (r.status === 401) { location.href = '/login'; throw new Error('logged out'); }
    if (idle) heard();                 // only the idle kind is told the answer is coming: any other keeps its limit from the start
    const body = await (idle && r.body ? readJsonWhileHeard(r, heard) : read(r)).catch((e) => { if (ctrl.signal.aborted) throw e; return null; });
    return { r, body };
  } catch (e) {
    if (ctrl.signal.aborted) throw Object.assign(new Error(`no answer in ${Math.round(timeout / 1000)} s`), { noAnswer: true, waitedS: timeout / 1000 });
    throw e;
  } finally { clearTimeout(t); }
}
/** An answer's JSON, read chunk by chunk, each chunk telling the time limit the answer is still coming. */
async function readJsonWhileHeard(r, heard) {
  const reader = r.body.getReader(), parts = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); heard(); }
  return JSON.parse(new TextDecoder().decode(await new Blob(parts).arrayBuffer()));
}

/** A failed request's reason in the team's words, never a library's ("mission control didn't answer"). An error that
 *  came back inside an answer (e.status set) means mission control answered: what failed was its call to bitcube. The
 *  server's own "wait: <label> is being applied (started 21:04)" (a 409 while another change is applied) reads as it is. */
export function plainError(msg) {
  const m = String(msg?.message ?? msg ?? '');
  if (msg?.unreadable) return "mission control's answer couldn't be read";
  if (msg?.noAnswer && msg?.notOurs) return "mission control didn't answer";
  if (msg?.noAnswer) return typeof msg.waitedS === 'number' ? `no answer in ${dur(msg.waitedS)}` : 'no answer in time';
  if (msg?.notOurs) return "mission control didn't answer";
  if (/^wait: [^{}[\]|\\]+$/.test(m)) return m.replace(/[.\s]+$/, '');
  const answered = typeof msg?.status === 'number';
  // the river's year page's own refusal (td/seasons/seasons_td.py): its reason in the rules' words, not "didn't accept it"
  if (/"quieter" must be below "busier"/i.test(m)) return "the river's year refused it: Quieter than usual must be below Busier than usual; change one and apply again";
  // a slip in mission control's own code (a JavaScript message, which names no 'XxxError'): never shown as it is
  if (/Cannot read propert|Cannot set propert|is not a function|is not defined|is not iterable|of (?:null|undefined)\b|\(reading '/i.test(m)) return "mission control couldn't do it";
  if (/logged out/i.test(m)) return 'you were logged out';
  if (/TD bridge|bridge/i.test(m)) return "TouchDesigner didn't answer";
  if (answered && /fetch failed|timeout|timed out|aborted/i.test(m)) return "bitcube didn't answer";
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(m)) return "mission control didn't answer";
  if (/can't reach bitcube|ssh/i.test(m)) return "bitcube didn't answer";
  if (/took too long|timeout|timed out|aborted/i.test(m)) return 'bitcube took too long to answer';
  if (msg?.status === 429 || /checked \d+ s ago; wait/i.test(m)) return 'the full check ran a moment ago; try again in 20 s';
  if (/^HTTP 404/.test(m) || /not found/i.test(m)) return "this mission control can't do that yet";
  if (/^HTTP 50\d/.test(m)) return "mission control couldn't reach bitcube";
  if (/^HTTP 4\d\d/.test(m) || msg?.status === 400) return "mission control didn't accept it";
  if (/rebuild refused|is running .*\.toe, not /i.test(m)) return 'TouchDesigner is running a different show file, so it was refused';
  if (/no show file/i.test(m)) return "that show file isn't on bitcube";
  if (/nothing was saved/i.test(m)) return "bitcube couldn't save it; nothing was saved";
  if (/probe failed|no answer from the probe|\(exit \d+\)|\bexit \d+\b/i.test(m)) return "bitcube couldn't do it";
  // never a raw message: a step id, a script, a file name, a traceback or a code reads as "bitcube couldn't do it"
  if (/Traceback|[A-Z][a-z]+Error\b|\.(ps1|py|toe|json|mjs)\b|[{}[\]|\\]|\bpid \d+/.test(m)) return "bitcube couldn't do it";
  // a status code inside some other sentence ("… HTTP 503 …"): the code means nothing to the team
  if (/\bHTTP \d{3}\b/.test(m)) return answered ? "bitcube couldn't do it" : "mission control didn't answer";
  return m.replace(/[.\s]+$/, '') || 'no answer';
}

/** A control whose POST got no usable answer (none in time, one that couldn't be read, a proxy's error page): it may or
 *  may not have happened, so it never says "unchanged". `where` names where to look ("the Now line shows what bitcube reports").
 *  nowMs: the time to stamp it with, the server's clock when the page knows it (R8 #35), else the phone's. */
export function noAnswerText(e, where, nowMs = Date.now()) {
  const first = e?.unreadable ? "Mission control's answer couldn't be read" : e?.notOurs ? "Mission control didn't answer" : e?.serverMaybe ? "bitcube didn't answer in time"
    : typeof e?.waitedS === 'number' ? `No answer in ${dur(e.waitedS)}` : 'No answer in time';   // never "in a while" (R7 #2)
  return `${first}: it may or may not have happened; ${where} (${clock(nowMs)}).`;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Just enough markdown for the agent's replies: code blocks, inline code, bold, links, lists, paragraphs. */
export function md(src) {
  const blocks = String(src ?? '').split(/```/);
  return blocks.map((b, i) => {
    if (i % 2) return `<pre><code>${esc(b.replace(/^[a-z]*\n/, ''))}</code></pre>`;
    return b.split(/\n{2,}/).map((p) => {
      let h = esc(p.trim());
      if (!h) return '';
      h = h.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
           .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
           .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
      // A paragraph with list items: the lines that are items become the list, the others ("What I found:") stay text above or below it.
      if (/^(- |\* |\d+\. )/m.test(p)) {
        let out = '', list = [], text = [];
        const flushText = () => { if (text.length) out += `<p>${text.join('<br>')}</p>`; text = []; };
        const flushList = () => { if (list.length) out += `<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`; list = []; };
        for (const l of h.split('\n')) {
          const m = l.match(/^(- |\* |\d+\. )(.*)$/);
          if (m) { flushText(); list.push(m[2]); } else { flushList(); text.push(l); }
        }
        flushText(); flushList();
        return out;
      }
      return `<p>${h.replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }).join('');
}
