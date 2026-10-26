// Round 9, the pages' share (critics on 80b997a, fixed on fix-r9): Calibrate's finished stages at full contrast; a sheet that
// replaces another takes focus into itself and names it, and its way out stays in reach; the chat's Send keeps focus on the box;
// the chat thread's log speaks through the page's one queue; a re-render patches the focused tile, button or row in place.
// What node can't run (a DOM) is checked as wiring here and walked in Chrome (shots/fix-r9/pages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

// ---- #11: Calibrate's finished stages ----------------------------------------------------------------------------------------

/** WCAG contrast of two #rrggbb colours. */
function contrast(a, b) {
  const lum = (h) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('R9 #11: a finished stage is struck through, never faded: --muted on the sheet\'s white is 4.5:1 or more in both themes', () => {
  const css = page('lights.css'), v2 = page('v2.css');
  const rule = /\.stages \.done \{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /line-through/);
  assert.doesNotMatch(rule, /opacity/, 'an opacity under 1 takes --muted under 4.5:1 on the light panel (3.99:1 at 0.8)');
  for (const scope of [/:root \{([^}]*)\}/, /:root\[data-theme="dark"\] \{([^}]*)\}/]) {
    const block = scope.exec(v2)[1];
    const muted = /--muted: (#[0-9a-f]{6})/i.exec(block)[1], panel = /--panel-solid: (#[0-9a-f]{6})/i.exec(block)[1];
    assert.ok(contrast(muted, panel) >= 4.5, `${muted} on ${panel}: ${contrast(muted, panel).toFixed(2)}`);
  }
});

// ---- #8, #3: a sheet that replaces another; its way out in reach ---------------------------------------------------------------

test('R9 #8: a sheet shown over an open one moves focus into it and names it (its title, else the action asked for), never <body>', () => {
  const ui = page('ui.js');
  const body = /export function sheet\([\s\S]*?\n\}/.exec(ui)[0];
  assert.match(body, /const was = d\.open;/, 'whether the dialog was open before this sheet');
  assert.match(body, /if \(!was\) d\.showModal\(\);/);
  assert.match(body, /if \(focus != null && btns\[focus\]\) btns\[focus\]\.focus\(\);\s*else if \(was\) \(inner\.querySelector\('#mc-sheet-title'\) \?\? btns\[0\]\)\?\.focus\(\);/,
    'the browser\'s initial focus runs only at showModal(): a replaced sheet focuses its own title');
  assert.match(body, /<h3 id="mc-sheet-title" tabindex="-1">/, 'the title can hold focus');
});

test('R9 #3: a sheet\'s actions stay in reach under a long list (a sticky row), and Recent and Who to call have a Close beside Back to the menu', () => {
  const ui = page('ui.js'), css = page('v2.css');
  const body = /export function sheet\([\s\S]*?\n\}/.exec(ui)[0];
  assert.match(body, /el\(`<div class="stack sheet-acts\$\{row \? ' row' : ''\}"><\/div>`\)/);
  const acts = /dialog\.sheet \.sheet-acts \{([^}]*)\}/.exec(css)[1];
  assert.match(acts, /position: sticky;/);
  assert.match(acts, /bottom: 0;/);
  assert.match(acts, /background: var\(--panel-solid\);/, 'opaque: the list scrolls under it');
  assert.match(css, /dialog\.sheet \.sheet-in \{[^}]*scroll-padding-bottom: var\(--acts-h, 0px\);/, 'a focused link is never left under the row');
  for (const fn of ['openRecent', 'openContacts']) {
    const src = new RegExp(`async function ${fn}\\(shell\\) \\{[\\s\\S]*?\\n\\}`).exec(ui)[0];
    assert.match(src, /actions: \[\{ label: 'Back to the menu', onClick: \(\) => openMenu\(shell\) \}, \{ label: 'Close' \}\], row: true/, fn);
  }
});
