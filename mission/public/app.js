// Shared helpers for mission control's pages.
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
      if (/^(- |\* |\d+\. )/m.test(p)) return '<ul>' + h.split('\n').map((l) => `<li>${l.replace(/^(- |\* |\d+\. )/, '')}</li>`).join('') + '</ul>';
      return `<p>${h.replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }).join('');
}
export function header(active) {
  const h = document.createElement('header');
  const tab = (href, key, label) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  h.innerHTML = `<div class="in"><b>A River Becoming</b><nav>
    ${tab('/status', 'status', 'System status')}${tab('/mission', 'mission', 'Mission control')}${tab('/chat', 'chat', 'Studio chat')}</nav>
    <button id="logout" title="Log out">Log out</button></div>`;
  document.body.prepend(h);
  h.querySelector('#logout').onclick = async () => { await fetch('/logout', { method: 'POST' }); location.href = '/login'; };
}
export const ago = (s) => s == null ? '–' : s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
