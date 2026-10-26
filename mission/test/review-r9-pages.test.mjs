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
