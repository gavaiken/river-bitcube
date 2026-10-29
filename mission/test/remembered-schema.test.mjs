// The remembered river's control schema (td/remembered/control_schema.py -> public/remembered-schema.js, docs/remembered-river.md
// section 5): mission control and the page take their choices, ranges and defaults from the generated module, never their own
// copies; the screens' Apply sends only the sliders moved, at 1 % resolution. (tools/tests/test_control_schema.py checks the
// module matches the Python source.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import SCHEMA from '../public/remembered-schema.js';
import { planControl } from '../lib/mission.mjs';
import { rememberedView, screensChange, REMEMBERED_SCREENS_DEFAULT } from '../public/remembered-words.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the generated schema: what mission control and the page rely on', () => {
  assert.match(read('../public/remembered-schema.js'), /^\/\/ GENERATED from td\/remembered\/control_schema\.py/);
  assert.deepEqual(SCHEMA.ui.lights, ['off', 'pool', 'eddies']);
  assert.deepEqual([SCHEMA.fields.pool_height_m.min, SCHEMA.fields.pool_height_m.max], [0, 1.5]);
  assert.equal(SCHEMA.fields.opening_night.default, true);
  assert.deepEqual(REMEMBERED_SCREENS_DEFAULT, { intensity: 0.82, threshold: 0.35, video: 0.7 });
  assert.equal(SCHEMA.light_max_s, 600);
});

test('planControl checks the zones and the screens against the schema', () => {
  assert.equal(planControl('remembered-zones', { light: 'pool', pool_height_m: 1.5 }).args, '-Action remembered-zones -Light pool -PoolHeight 1.50');
  assert.throws(() => planControl('remembered-zones', { light: 'leds' }), /light is off, pool or eddies/, 'leds: zones.py only');
  assert.throws(() => planControl('remembered-zones', { light: 'pool', pool_height_m: 1.51 }), /pool_height_m is 0 to 1.5 metres/);
  assert.equal(planControl('remembered-screens', { intensity: 0 }).args, '-Action remembered-screens -Intensity 0.00', '0 is a value');
  assert.equal(planControl('remembered-screens', { threshold: 0.37 }).args, '-Action remembered-screens -Threshold 0.37', '1 % steps');
});

test('the screens: only the sliders moved are sent, in whole percent', () => {
  assert.deepEqual(screensChange({ intensity: 82, threshold: 35, video: 70 }, {}), {});
  assert.deepEqual(screensChange({ intensity: 0, threshold: 37, video: 70 }, { intensity: true }), { intensity: 0 });
  assert.deepEqual(screensChange({ intensity: 81.6, threshold: 37, video: 70 }, { intensity: true, threshold: true }), { intensity: 0.82, threshold: 0.37 });
  assert.deepEqual(screensChange({ video: 140 }, { video: true }), { video: 1 });
  assert.deepEqual(screensChange({ video: null }, { video: true }), {});
});

test("the page's defaults come from the schema, and its sliders move in 1 % steps", () => {
  const v = rememberedView({ ok: true, status: null, control: null }, { now: 0, sinceS: 0 });
  for (const k of ['intensity', 'threshold', 'video']) assert.equal(v[k].default, SCHEMA.fields[`screens.${k}`].default, k);
  const js = read('../public/remembered.js'), html = read('../public/remembered.html');
  assert.doesNotMatch(js, /0\.82|0\.35|\b0\.7\b|\/ 5\) \* 5/, 'no hardcoded defaults, no 5 % snap');
  assert.match(js, /screensChange\(S\.scr, S\.scrTouched\)/);
  for (const k of ['intensity', 'threshold', 'video']) {
    const tag = html.match(new RegExp(`<input type="range" id="${k}"[^>]*>`))[0];
    assert.match(tag, /step="1"/, k);
    assert.doesNotMatch(tag, /value=/, `${k}: the page sets it from bitcube or the schema`);
  }
});
