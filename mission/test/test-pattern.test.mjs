// Lights → Test pattern (Gavin, 26 Oct): one control that switches the ropes and the panels into the test pattern and back
// (td/ropes/artnet_out.py test_frame, td/panels/panel_test.glsl), locked like every other change, refused during a calibration,
// and refusing the ropes button and a calibration while it shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planControl, checkedControl, testBlocked, calBlocked } from '../lib/mission.mjs';
import { FixtureMission, testRope, panelTestPixel } from '../lib/fixtures.mjs';
import { actionPhrase } from '../lib/history.mjs';
import { derive, changeLabel, testShowing, TEST_ON, EXPECT_S, APPLY_BLOCKS } from '../public/model.js';

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const load = (n) => JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
/** all-good with the full check showing the test pattern on the ropes and/or the panels. */
function testing({ ropes = true, panels = true } = {}) {
  const f = load('all-good'), s = { ...clone(f.status), now: f._scenario.now }, td = s.probe.value.td;
  if (ropes) { td.ropes.source = 'test'; td.ropes.status.source = 'test'; }
  td.hub75 = { ...td.hub75, source: panels ? 'test' : 'canvas' };
  return s;
}
const fm = () => new FixtureMission({ dir: FIXTURES, stateDir: mkdtempSync(join(tmpdir(), 'test-pattern-')), now: () => load('all-good')._scenario.now, applyS: 0 });

test('the whitelist: on is a real true or false, probe.ps1 -Action test [-On]; nothing else', () => {
  assert.deepEqual(planControl('test', { on: true }), { kind: 'probe', args: '-Action test -On' });
  assert.deepEqual(planControl('test', { on: false }), { kind: 'probe', args: '-Action test' });
  for (const on of ['true', 1, null, undefined]) assert.throws(() => planControl('test', { on }), /on is true or false/, String(on));
  assert.deepEqual(checkedControl('test', { on: true, extra: 'x' }), { on: true });
  assert.equal(changeLabel('test', { on: true }), 'the test pattern start');
  assert.equal(changeLabel('test', { on: false }), 'the test pattern stop');
  assert.deepEqual(actionPhrase({ action: 'test', body: { on: true } }), ['Started', 'start', 'the test pattern on the ropes and panels']);
  assert.equal(EXPECT_S.test, 15);
  assert.deepEqual(APPLY_BLOCKS.test, ['test', 'ropes', 'calibrate']);
});

test('the server: a calibration refuses the test pattern; the test pattern refuses the ropes button and a real calibration, never a dry run', () => {
  assert.equal(calBlocked('test', { running: true, stage: 'ropes-capture' })?.status, 409);
  const probe = { at: 1, value: testing().probe.value };
  assert.equal(testBlocked('ropes', { dark: true }, probe)?.message, TEST_ON);
  assert.equal(testBlocked('calibrate', { action: 'start' }, probe)?.status, 409);
  assert.equal(testBlocked('calibrate', { action: 'start', dry_run: true }, probe), null, 'a dry run touches no lights');
  assert.equal(testBlocked('calibrate', { action: 'cancel' }, probe), null);
  for (const a of ['hub75', 'test', 'switch']) assert.equal(testBlocked(a, {}, probe), null, a);
  assert.equal(testBlocked('ropes', { dark: true }, { at: 1, value: load('all-good').status.probe.value }), null, 'no test pattern: nothing refused');
  assert.equal(testShowing({ td: { ok: false, ropes: { source: 'test' } } }), false, "TouchDesigner not answering: what it shows isn't known");
});

test('the pages: the test pattern is a warning on purpose (never a fault), the band says how to end it, and it locks the ropes and Calibrate', () => {
  const m = derive(testing(), testing().now + 2000);
  assert.deepEqual(m.show.test, { on: true, ropes: true, panels: true });
  assert.equal(m.show.ropes.state, 'test');
  assert.equal(m.show.panels.state, 'test');
  const ropes = m.items.find((x) => x.id === 'ropes'), panels = m.items.find((x) => x.id === 'hub75 panels');
  assert.equal(ropes.level, 'warning'); assert.match(ropes.summary, /^Test pattern/);
  assert.equal(panels.level, 'warning'); assert.match(panels.summary, /number in white squares/);
  const p = m.problems.find((x) => x.id === 'test-pattern');
  assert.ok(p, 'a band line'); assert.equal(p.level, 'warning'); assert.match(p.action, /Stop the test pattern on the Lights page/);
  assert.equal(m.controls.ropes.why, TEST_ON);
  assert.equal(m.controls.calibrate.why, TEST_ON);
  assert.equal(m.controls.calibrate.dry.possible, true, 'a dry run touches no lights');
  assert.equal(m.controls.test.possible, true, 'Stop is always possible while TouchDesigner answers');
  assert.equal(m.controls.hub75.possible, true);
  // the ropes dark underneath are not "dark on purpose" while the test pattern shows
  assert.equal(m.problems.some((x) => x.id === 'ropes-dark'), false);
  const off = derive({ ...clone(load('all-good').status), now: load('all-good')._scenario.now }, load('all-good')._scenario.now + 2000);
  assert.equal(off.show.test.on, false); assert.equal(off.controls.test.possible, true); assert.equal(off.controls.ropes.possible, true);
});

test('the pages: no Start while a calibration runs or TouchDesigner is not answering', () => {
  const frozen = load('td-frozen'), m = derive({ ...clone(frozen.status), now: frozen._scenario.now }, frozen._scenario.now + 2000);
  assert.equal(m.controls.test.possible, false);
});

test('fixture mode: Start turns the scenario world into the test pattern (status, Lights frames), it refuses the ropes and a calibration, Stop puts it back', async () => {
  const m = fm();
  const r = await m.control('test', { on: true }, 'all-good');
  assert.equal(r.ok, true);
  const td = m.snapshot('all-good').probe.value.td;
  assert.equal(td.ropes.source, 'test'); assert.equal(td.hub75.source, 'test');
  const l = m.lights('all-good');
  assert.equal(l.frames.source, 'test'); assert.equal(l.frames.panels.source, 'test'); assert.ok(l.frames.screens.error);
  await assert.rejects(m.control('ropes', { dark: true }, 'all-good'), (e) => e.status === 409 && e.message === TEST_ON);
  await assert.rejects(m.calibrate('start', {}, { scenario: 'all-good' }), (e) => e.status === 409);
  await m.control('test', { on: false }, 'all-good');
  assert.equal(m.snapshot('all-good').probe.value.td.ropes.source, 'canvas');
  assert.equal(m.lights('all-good').frames.source, 'canvas');
});

test('the simulator draws what TouchDesigner sends: the rope wipe (artnet_out.test_frame) and panel_test.glsl', () => {
  const at = testRope(1.5);                 // halfway through the first wipe: red over white
  assert.deepEqual(at(0), [0.6, 0, 0]); assert.deepEqual(at(399), [0.2, 0.2, 0.2]);
  assert.deepEqual(panelTestPixel(3, 0, 0), [1, 1, 1], 'a white border');
  assert.deepEqual(panelTestPixel(3, 8 + 32, 10), [1, 1, 1], "quad 3's third white square");
  assert.deepEqual(panelTestPixel(2, 8 + 32, 10), [0.35, 0, 0], 'quad 2 has only two');
  assert.deepEqual(panelTestPixel(1, 200, 100), [0.35, 0.8 * 0.35, 0], 'bottom right is yellow');
});
