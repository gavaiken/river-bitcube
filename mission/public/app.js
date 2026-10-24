// Shared helpers for mission control's pages (ui.js builds on these: api, esc, md).
export async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('logged out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
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
