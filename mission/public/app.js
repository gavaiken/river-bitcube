// Shared helpers for mission control's pages (ui.js builds on these: api, esc, md).
/** How long a request may go unanswered before the page gives up: a little past the server's own limit for the action
 *  (about 60 s; a rebuild builds, saves and restarts, up to 400 s), so a hung POST never leaves a control pending for good. */
export function apiTimeout(path, body) {
  if (body === undefined) return 30_000;
  return /\/api\/control\/rebuild$/.test(path) ? 420_000 : 75_000;
}
export async function api(path, body, { timeout = apiTimeout(path, body) } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    r = await fetch(path, body === undefined ? { signal: ctrl.signal } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    // no answer in time: the request may or may not have reached bitcube (noAnswer tells the control to say so)
    if (ctrl.signal.aborted) throw Object.assign(new Error(`no answer in ${Math.round(timeout / 1000)} s`), { noAnswer: true, waitedS: timeout / 1000, posted: body !== undefined });
    throw e;
  } finally { clearTimeout(timer); }
  if (r.status === 401) { location.href = '/login'; throw new Error('logged out'); }
  const j = await r.json().catch(() => null);
  // an error that isn't mission control's JSON (a proxy's 502 page while the server is down) means mission control itself
  // didn't answer: never "couldn't reach bitcube", which would send someone to check bitcube's power
  if (!r.ok && (j == null || typeof j !== 'object')) throw Object.assign(new Error("mission control didn't answer"), { status: r.status, notOurs: true });
  if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { status: r.status });
  // a 2xx that isn't our JSON (a proxy's page, a cut-off body) is not a success
  if (j == null || typeof j !== 'object') throw new Error("mission control's answer couldn't be read");
  return j;
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
