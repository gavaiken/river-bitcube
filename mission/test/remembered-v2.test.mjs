// The Remembered river v2 page (docs/mission-ui.md "Remembered river v2 page"): its three controls (lib/mission.mjs planControl,
// checked by public/remembered-v2-words.js against the generated schema; fixture mode; the live server's 409), GET /api/remembered's
// overrides and GET /api/remembered/history (lib/remembered.mjs), its words (public/remembered-v2-words.js) on the three fixture
// scenarios (remembered-v2-simulating, remembered-v2-stale, all-looks-auto: the v1 file), and the page itself, served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mission, planControl, checkedControl } from '../lib/mission.mjs';
import { FixtureMission } from '../lib/fixtures.mjs';
import { shapeRemembered, checkedHistoryFields, RememberedHistory, shapeHistory, syntheticHistory, HISTORY_CACHE_MS } from '../lib/remembered.mjs';
import { actionPhrase } from '../lib/history.mjs';
import { derive, APPLY_BLOCKS, EXPECT_S, REMEMBERED_V2_FILE, REMEMBERED_V2_ONLY, LOOKS_FILES, isAllLooksFile, showBoundWhy } from '../public/model.js';
import { pageView } from '../public/looks-words.js';
import { ACTIONS } from '../bin/mc.mjs';
import { rememberedV2View, versionBanner, rememberedPage, explainer, HOW_IT_WORKS, PARAM_NAMES, INPUTS, GROUPS, EFFECT_WORDS, HISTORY_FIELDS, sparkSVG,
  checkedOverride, checkedSimulate, checkedClear, paramView, adjusted, v2Label, ropesWords1, inputValueWords, calmProblem, REMEMBERED_V1_FILES } from '../public/remembered-v2-words.js';
import SCHEMA from '../public/remembered-schema.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const V2 = ['remembered-override', 'remembered-override-clear', 'remembered-simulate'];
const fixtureMission = () => new FixtureMission({ dir: FIXTURES, stateDir: mkdtempSync(join(tmpdir(), 'rem2-')), applyS: 0 });
const served = (fm, name) => {
  const td = fm.snapshot(name).probe?.value?.td;
  return shapeRemembered(fm.remembered(name), { tdFile: td?.file ?? null, readAt: fm.clock(name), now: fm.clock(name) });
};
const view = (fm, name) => rememberedV2View(served(fm, name), { now: fm.clock(name) });
const model = (fm, name) => derive({ ...fm.snapshot(name), now: fm.clock(name) }, fm.clock(name) + 1000);

test('the overrides: the whitelist, the probe.ps1 arguments, what is kept, the labels and the history line', () => {
  const p = (b) => planControl('remembered-override', b).args;
  assert.equal(p({ param: 'knob.speed', mode: 'fix', value: 0.7 }), '-Action remembered-override -Param knob.speed -Mode fix -Value 0.7');
  assert.equal(p({ param: 'knob.speed', mode: 'fix', value: '0.33333' }), '-Action remembered-override -Param knob.speed -Mode fix -Value 0.333');
  assert.equal(p({ param: 'surge_hour', mode: 'adjust', offset: -1.5, gain: 1.25 }), '-Action remembered-override -Param surge_hour -Mode adjust -Offset:-1.5 -Gain:1.25');
  assert.equal(p({ param: 'master_brightness', mode: 'adjust' }), '-Action remembered-override -Param master_brightness -Mode adjust -Offset:0 -Gain:1');
  assert.equal(p({ param: 'knob.speed', mode: 'auto', value: 9 }), '-Action remembered-override -Param knob.speed -Mode auto');
  assert.equal(p({ param: 'palette', mode: 'fix', value: ['#0B3D5C', '#1f8fb3', '#bfefff'] }), '-Action remembered-override -Param palette -Mode fix -Value #0b3d5c,#1f8fb3,#bfefff');
  assert.equal(p({ param: 'day', mode: 'fix', value: '2017-02-07' }), '-Action remembered-override -Param day -Mode fix -Value 2017-02-07');
  assert.equal(p({ param: 'lingerer_rope', mode: 'fix', value: 19 }), '-Action remembered-override -Param lingerer_rope -Mode fix -Value 19');
  assert.equal(planControl('remembered-override', { param: 'calm_min', mode: 'fix', value: 0.2 }).kind, 'remembered');
  const bad = [
    {}, { param: 'nope', mode: 'fix', value: 1 }, { param: 'knob.speed' }, { param: 'knob.speed', mode: 'manual' },
    { param: 'knob.speed', mode: 'fix' }, { param: 'knob.speed', mode: 'fix', value: 1.01 }, { param: 'knob.speed', mode: 'fix', value: -0.1 }, { param: 'knob.speed', mode: 'fix', value: '0.5; rm' },
    { param: 'knob.speed', mode: 'fix', value: true }, { param: 'knob.speed', mode: 'adjust', gain: 4.5 }, { param: 'knob.speed', mode: 'adjust', offset: 1.5 },
    { param: 'master_brightness', mode: 'fix', value: 1.6 }, { param: 'surge_hour', mode: 'fix', value: 25 },
    { param: 'palette', mode: 'adjust' }, { param: 'palette', mode: 'fix', value: ['#000000', '#ffffff'] }, { param: 'palette', mode: 'fix', value: '#000000,#111111,#222222' },
    { param: 'palette', mode: 'fix', value: ['#00000', '#111111', '#222222'] }, { param: 'day', mode: 'adjust' }, { param: 'day', mode: 'fix', value: '2017-02-30' },
    { param: 'day', mode: 'fix', value: '1999-01-01' }, { param: 'day', mode: 'fix', value: '7 Feb 2017' },
    { param: 'lingerer_rope', mode: 'fix', value: 20 }, { param: 'lingerer_rope', mode: 'fix', value: 3.5 }, { param: 'headcount', mode: 'adjust' }, { param: 'headcount', mode: 'fix', value: 21 },
  ];
  for (const b of bad) assert.throws(() => planControl('remembered-override', b), (e) => e.status === 400 && e.message.length > 5, JSON.stringify(b));
  assert.match(String((() => { try { planControl('remembered-override', { param: 'knob.speed', mode: 'fix', value: 2 }); } catch (e) { return e.message; } })()), /^knob\.speed is 0 to 1$/);
  assert.deepEqual(checkedControl('remembered-override', { param: 'knob.speed', mode: 'adjust', gain: '1.234', offset: 0.1, extra: 1 }), { param: 'knob.speed', mode: 'adjust', offset: 0.1, gain: 1.23 });
  assert.deepEqual(checkedOverride({ param: 'headcount', mode: 'fix', value: 8 }), { param: 'headcount', mode: 'fix', value: 8 });
  // clear: every override, or one
  assert.equal(planControl('remembered-override-clear', {}).args, '-Action remembered-override-clear');
  assert.equal(planControl('remembered-override-clear', { param: 'palette' }).args, '-Action remembered-override-clear -Param palette');
  assert.throws(() => planControl('remembered-override-clear', { param: 'x' }), (e) => e.status === 400);
  assert.deepEqual(checkedClear({ param: 'calm_max', x: 1 }), { param: 'calm_max' });
  // simulate: a headcount and/or a lingerer, or stop
  assert.equal(planControl('remembered-simulate', { headcount: 8, lingerer_rope: 12 }).args, '-Action remembered-simulate -Headcount 8 -LingerRope 12');
  assert.equal(planControl('remembered-simulate', { lingerer_rope: 0 }).args, '-Action remembered-simulate -LingerRope 0');
  assert.equal(planControl('remembered-simulate', { stop: true, headcount: 3 }).args, '-Action remembered-simulate -Stop');
  for (const b of [{}, { headcount: 21 }, { headcount: -1 }, { lingerer_rope: 20 }, { lingerer_rope: 1.5 }, { stop: false }, { stop: 'true' }, { headcount: null }])
    assert.throws(() => planControl('remembered-simulate', b), (e) => e.status === 400, JSON.stringify(b));
  assert.deepEqual(checkedSimulate({ headcount: 7.25 }), { headcount: 7.3 });
  // the tables: each a change of the overrides block, one at a time; not refused by a calibration or the test pattern (like opening night)
  for (const a of V2) {
    assert.deepEqual(APPLY_BLOCKS[a], V2, a);
    assert.equal(EXPECT_S[a], 10, a);
    assert.ok(ACTIONS.includes(a), `the studio agent has ${a} (bin/mc.mjs)`);
    assert.ok(APPLY_BLOCKS.switch.includes(a) && !APPLY_BLOCKS.calibrate.includes(a), a);
  }
  assert.equal(v2Label('remembered-override', { param: 'knob.speed', mode: 'fix', value: 0.7 }), 'the override: speed fixed at 0.70');
  assert.equal(v2Label('remembered-override', { param: 'master_brightness', mode: 'adjust', gain: 1.2, offset: -0.1 }), "the override: the ropes' master brightness adjusted (auto × 1.2 − 0.1)");
  assert.equal(v2Label('remembered-override', { param: 'palette', mode: 'auto' }), 'the override: the colours back to auto');
  assert.equal(v2Label('remembered-simulate', { headcount: 8, lingerer_rope: 12 }), 'the simulation of 8 people and a lingerer by rope 13');
  assert.equal(v2Label('remembered-override-clear', {}), 'the clearing of every override');
  assert.deepEqual(actionPhrase({ action: 'remembered-override', body: { param: 'calm_min', mode: 'fix', value: 0.25 } }), ['Set', 'set', 'the calm floor fixed at 25 %']);
  assert.deepEqual(actionPhrase({ action: 'remembered-override', body: { param: 'calm_min', mode: 'auto' } }), ['Put', 'put', 'the calm floor back to auto']);
  assert.deepEqual(actionPhrase({ action: 'remembered-simulate', body: { lingerer_rope: 4 } }), ['Simulated', 'simulate', 'a lingerer by rope 5']);
  assert.deepEqual(actionPhrase({ action: 'remembered-simulate', body: { stop: true } }), ['Stopped', 'stop', 'simulating people']);
  assert.deepEqual(actionPhrase({ action: 'remembered-override-clear', body: { param: 'palette' } }), ['Cleared', 'clear', 'the override of the colours']);
});

test('the all-looks file and its v2 pass every show-name guard (model.js isAllLooksFile, probe.ps1 Test-AllLooksFile)', () => {
  assert.deepEqual(['river-all-looks.toe', 'river-all-looks-v2.toe', 'river-all-looks-v3.toe', 'river-looks.toe', 'x-river-all-looks.toe', null].map(isAllLooksFile),
    [true, true, false, false, false, false]);
  const pr = (file, look = 'remembered') => ({ td: { ok: true, file }, looks: { status: { age_s: 0.3, json: { show: file, look } } } });
  for (const f of ['river-all-looks.toe', REMEMBERED_V2_FILE]) {
    for (const a of ['looks', 'remembered-zones', 'remembered-opening', 'remembered-screens']) assert.equal(showBoundWhy(a, pr(f)), null, `${a} in ${f}`);
    assert.equal(showBoundWhy('filling', pr(f, 'fill-simple')), null, f);
  }
  for (const a of V2) assert.equal(showBoundWhy(a, pr(REMEMBERED_V2_FILE)), null, a);
  const fm = fixtureMission();
  assert.equal(pageView(model(fm, 'remembered-v2-simulating')).allLooks, true, 'the Looks page edits the v2 playlist too');
  assert.equal(model(fm, 'remembered-v2-simulating').controls.looks.possible, true);
});

test('which page for which file: the banner both ways, the menu\'s link, and v2 controls only in the v2 file', () => {
  assert.ok(LOOKS_FILES.includes(REMEMBERED_V2_FILE), 'the v2 file reports looks like the other all-looks files');
  assert.deepEqual(versionBanner('v2', 'river-all-looks.toe'), { text: 'The v1 file is showing; this page is for v2', href: '/remembered', link: 'open /remembered' });
  assert.deepEqual(versionBanner('v1', REMEMBERED_V2_FILE), { text: 'The v2 file is showing; this page is for v1', href: '/remembered-v2', link: 'open /remembered-v2' });
  for (const f of REMEMBERED_V1_FILES) assert.ok(versionBanner('v2', f) && !versionBanner('v1', f), f);
  for (const f of [null, 'river-local-oct-22-seasons.toe']) assert.deepEqual([versionBanner('v1', f), versionBanner('v2', f)], [null, null]);
  assert.equal(versionBanner('v2', REMEMBERED_V2_FILE), null);
  assert.deepEqual([rememberedPage(REMEMBERED_V2_FILE), rememberedPage('river-all-looks.toe'), rememberedPage(null)], ['/remembered-v2', '/remembered', '/remembered']);
  const fm = fixtureMission();
  for (const a of V2) {
    assert.equal(model(fm, 'remembered-v2-simulating').controls[a].possible, true, a);
    assert.equal(model(fm, 'all-looks-auto').controls[a].why, REMEMBERED_V2_ONLY, a);
    assert.equal(model(fm, 'remembered-not-running').controls[a].why, REMEMBERED_V2_ONLY, a);
  }
  assert.equal(model(fm, 'remembered-v2-simulating').controls['remembered-zones'].possible, true, "v1's controls work in v2 too");
  assert.match(model(fm, 'remembered-v2-stale').controls['remembered-override'].why, /isn't known yet/, "a looks report over 10 s old says nothing about now");
});

test('fixture mode: overrides, a simulation, stop and clear all go into the world and come back in TouchDesigner\'s status', async () => {
  const fm = fixtureMission(), S = 'remembered-v2-simulating';
  await assert.rejects(fm.control('remembered-override', { param: 'knob.speed', mode: 'fix', value: 0.4 }, 'all-looks-auto'), (e) => e.status === 409 && e.message === REMEMBERED_V2_ONLY);
  await assert.rejects(fm.control('remembered-simulate', { headcount: 3 }, 'remembered-not-running'), (e) => e.status === 409);
  let v = view(fm, S);
  assert.deepEqual([v.running, v.sim.active, v.sim.headcount, v.sim.rope, v.overriddenCount], [true, true, 8, 12, 1]);
  const r = await fm.control('remembered-override', { param: 'palette', mode: 'fix', value: ['#112233', '#445566', '#778899'] }, S);
  assert.deepEqual([r.ok, r.written.overrides.palette.value, r.written.overrides.palette.expires_at], [true, ['#112233', '#445566', '#778899'], null]);
  assert.ok(r.written.overrides['knob.speed'] && r.written.overrides.headcount, 'merged: every other override kept');
  v = view(fm, S);
  assert.deepEqual([v.params.palette.mode, v.params.palette.palette, v.overriddenCount], ['fix', ['#112233', '#445566', '#778899'], 2]);
  await fm.control('remembered-simulate', { stop: true }, S);
  v = view(fm, S);
  assert.deepEqual([v.sim.active, v.params.headcount.mode, v.inputs.headcount.source, v.inputs.lingerers.source], [false, 'auto', 'counter', 'counter']);
  await fm.control('remembered-simulate', { lingerer_rope: 3 }, S);
  v = view(fm, S);
  assert.deepEqual([v.sim.active, v.sim.rope, v.sim.headcount, v.inputs.lingerers.value, v.params.lingerer_rope.expiresIn], [true, 3, null, [3], 120]);
  assert.equal(v.sim.words, 'SIMULATING a lingerer by rope 4 · clears in 2:00');
  await fm.control('remembered-override', { param: 'master_brightness', mode: 'adjust', gain: 1.2, offset: 0 }, S);
  assert.equal(view(fm, S).params.master_brightness.line, "auto 100 % → 120 % (adjusted ×1.2)");
  await fm.control('remembered-override', { param: 'master_brightness', mode: 'auto' }, S);
  assert.equal(view(fm, S).params.master_brightness.mode, 'auto');
  await fm.control('remembered-override-clear', {}, S);
  v = view(fm, S);
  assert.deepEqual([v.sim.active, v.overriddenCount, Object.keys(v.overrides)], [false, 0, []]);
  assert.equal(served(fm, S).overrides && Object.keys(served(fm, S).overrides).length, 0, "control.json's block, emptied");
  assert.equal(view(fm, 'remembered-v2-stale').overriddenCount, 1, 'each scenario is its own world');
});

test('live: an override goes to probe.ps1 and never replaces the full check; refused (409) while the v1 file runs', async () => {
  const calls = [];
  let file = REMEMBERED_V2_FILE;
  const looks = () => ({ control: { age_s: 9, json: {} }, status: { age_s: 0.4, json: { show: file, look: 'remembered' } } });
  const m = new Mission({ now: () => 1_000_000, probe: async (_h, args) => {
    calls.push(args ?? '');
    if (/remembered/.test(args ?? '')) return { ok: true, action: 'remembered-override', written: { overrides: {} }, status: { missing: true } };
    return { ok: true, td: { ok: true, file }, looks: looks() };
  } });
  await m.pollProbe();
  const r = await m.control('remembered-override', { param: 'knob.turbulence', mode: 'fix', value: 0.9 });
  assert.equal(r.action, 'remembered-override');
  assert.equal(calls.at(-1), '-Action remembered-override -Param knob.turbulence -Mode fix -Value 0.9');
  await m.control('remembered-simulate', { headcount: 12 });
  assert.equal(calls.at(-1), '-Action remembered-simulate -Headcount 12');
  assert.equal(m.snapshot().probe.value.td.file, REMEMBERED_V2_FILE, 'the full check is still the full check');
  await assert.rejects(m.control('remembered-override', { param: 'knob.speed', mode: 'fix', value: 2 }), (e) => e.status === 400);
  file = 'river-all-looks.toe'; await m.pollProbe();
  await assert.rejects(m.control('remembered-override-clear', {}), (e) => e.status === 409 && e.message === REMEMBERED_V2_ONLY);
  const opening = await m.control('remembered-opening', { on: true });
  assert.equal(opening.ok, true, "v1's controls still work in the v1 file");
});

test('GET /api/remembered: v2 status served as-is, plus control.json\'s overrides block', () => {
  const fm = fixtureMission();
  const b = served(fm, 'remembered-v2-simulating');
  assert.deepEqual([b.ok, b.running, b.show, b.status.simulating], [true, true, REMEMBERED_V2_FILE, true]);
  for (const k of ['inputs', 'params', 'effects', 'overrides']) assert.ok(b.status[k] && typeof b.status[k] === 'object', k);
  assert.deepEqual(Object.keys(b.status.inputs), INPUTS);
  assert.deepEqual(Object.keys(b.status.params).sort(), [...PARAM_NAMES].sort());
  assert.deepEqual(Object.keys(b.overrides).sort(), ['headcount', 'knob.speed', 'lingerer_rope']);
  assert.match(b.overrides.headcount.expires_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(served(fm, 'remembered-calm').overrides, null, 'v1: no overrides block');
  assert.equal(shapeRemembered({ ok: true, control: { age_s: 1, json: { overrides: 'junk' } } }).overrides, null);
});

test('GET /api/remembered/history: the fields checked, cached 30 s per list, shaped; fixture mode draws 24 h from the status', async () => {
  assert.deepEqual(checkedHistoryFields('params.knob.speed, inputs.heard,inputs.heard'), ['inputs.heard', 'params.knob.speed']);
  assert.deepEqual(checkedHistoryFields(HISTORY_FIELDS.join(',')).length, HISTORY_FIELDS.length);
  for (const q of ['', null, 'inputs.nope', 'params.knob', 'status.heard', 'inputs.heard;calc', 'params.knob.speed,../x', Array(30).fill(0).map((_, k) => `inputs.x${k}`).join(',')])
    assert.throws(() => checkedHistoryFields(q), (e) => e.status === 400, String(q).slice(0, 40));
  let t = 0, n = 0;
  const h = new RememberedHistory({ now: () => t, fetch: async (_h, f) => { n++; return { ok: true, now_s: 5, fields: Object.fromEntries(f.map((x) => [x, [[1, 0.5], [2, 0.6]]])) }; } });
  await Promise.all([h.read(['inputs.heard']), h.read(['inputs.heard'])]);
  t = HISTORY_CACHE_MS - 1; await h.read(['inputs.heard']);
  assert.equal(n, 1);
  await h.read(['params.flow_level']); assert.equal(n, 2, 'another list is its own entry');
  t = HISTORY_CACHE_MS + 1; await h.read(['inputs.heard']); assert.equal(n, 3);
  const failing = new RememberedHistory({ fetch: async () => ({ ok: false, error: "can't reach bitcube over SSH" }) });
  const bad = await failing.read(['inputs.heard']);
  assert.deepEqual(shapeHistory(bad.raw, ['inputs.heard']), { ok: false, error: 'bitcube is offline' });
  const ok = shapeHistory({ ok: true, now_s: 9, fields: { 'inputs.heard': [[1, 0.5], 'junk'] } }, ['inputs.heard', 'params.flow_level'], { readAt: 0, now: 3000 });
  assert.deepEqual(ok, { ok: true, now_s: 9, fields: { 'inputs.heard': [[1, 0.5]], 'params.flow_level': [] }, read_at: 0, age_s: 3 });
  const fm = fixtureMission(), raw = fm.remembered('remembered-v2-simulating');
  const s1 = syntheticHistory(raw, ['inputs.heard', 'params.palette', 'params.knob.speed'], 1_800_000_000);
  assert.equal(s1.fields['inputs.heard'].length, 288);
  assert.deepEqual(s1.fields['inputs.heard'].at(-1), [1_800_000_000, 0.62]);
  assert.deepEqual(s1.fields['params.palette'], [], 'not a number: no line');
  assert.deepEqual(syntheticHistory(raw, ['inputs.heard'], 1_800_000_000).fields, { 'inputs.heard': s1.fields['inputs.heard'] }, 'deterministic');
});

test('the page\'s words: inputs → parameters, the simulation, a stale status, the v1 file', () => {
  const fm = fixtureMission();
  const v = view(fm, 'remembered-v2-simulating');
  assert.deepEqual([v.isV2, v.stale, v.onV2, v.sim.active, v.sim.words], [true, false, true, true, 'SIMULATING 8 people and a lingerer by rope 13 · clears in 1:14']);
  assert.deepEqual(v.groups.map((g) => g.id), ['day', 'scene', 'flow', 'room', 'control']);
  assert.deepEqual(GROUPS.flatMap((g) => g.params).sort(), [...PARAM_NAMES].sort(), 'every parameter sits under its inputs, once');
  assert.deepEqual(GROUPS.flatMap((g) => g.inputs).sort(), [...INPUTS].sort(), 'every input once');
  assert.deepEqual([v.inputs.headcount.source, v.inputs.headcount.sourceWords, v.inputs.headcount.words, v.inputs.headcount.simulated], ['simulated', 'SIMULATED', '8 people', true]);
  assert.deepEqual([v.inputs.day.words, v.inputs.day.sourceWords, v.inputs.day.ageWords, v.inputs.day.fresh], ['7 Feb 2017', "Dave's agent", '4 min ago', true]);
  assert.equal(v.inputs.scene.words, 'speed 0.50 · density 0.60 · brightness 0.70 · turbulence 0.40');
  assert.equal(v.inputs.reflex.words, 'speed +0.05 · turbulence −0.04');
  assert.equal(v.inputs.lingerers.words, 'by rope 13');
  assert.deepEqual([v.params['knob.speed'].line, v.params['knob.speed'].who], ['auto 0.50 → 0.62 (adjusted ×1.2 +0.02)', 'set 10 min ago · until cleared']);
  assert.deepEqual([v.params.headcount.line, v.params.headcount.simulated, v.params.headcount.who], ['auto 3.2 people → fixed 8 people', true, 'set 46 s ago · clears in 1:14']);
  assert.deepEqual([v.params.lingerer_rope.line, v.params.surge_hour.line, v.params.calm_min.line], ['auto rope 8 → fixed rope 13', 'auto hour 13.5', 'auto 18 %']);
  assert.deepEqual(v.effects.map((e) => [e.name, e.words]), [['lingerer', '82 %'], ['crowd', '55 %'], ['empty', '0 %'], ['sparks', '14']]);
  assert.equal(v.overriddenCount, 1, 'the simulated people are counted as the simulation, not as overrides');
  // carried forward: a page that read it 30 s ago counts down
  assert.match(rememberedV2View(served(fm, 'remembered-v2-simulating'), { now: fm.clock('remembered-v2-simulating'), sinceS: 30 }).sim.words, /clears in 0:44$/);
  const st = view(fm, 'remembered-v2-stale');
  assert.deepEqual([st.running, st.stale, st.sim.active], [false, true, false]);
  assert.equal(st.staleWords, "TouchDesigner's status is 45 s old: everything below is as it was then, not now");
  assert.equal(st.inputs.heard.fresh, false, 'nothing reads as fresh in an old status');
  const v1 = view(fm, 'all-looks-auto');
  assert.deepEqual([v1.running, v1.isV2, v1.onV2, v1.overriddenCount], [true, false, false, 0]);
  assert.match(v1.v2Missing, /isn't the v2 river/);
  assert.equal(v1.params['knob.speed'].line, 'not reported');
  const none = rememberedV2View(null);
  assert.deepEqual([none.running, none.sim.active, none.groups.length], [false, false, 5]);
  // pieces
  assert.equal(adjusted('knob.speed', 0.9, 1.5, 0.2), 1, 'clamped to the range');
  assert.equal(adjusted('surge_hour', null, 1, 1), null);
  assert.deepEqual([ropesWords1([0, 19]), ropesWords1([]), inputValueWords('lingerers', []), inputValueWords('control', null), inputValueWords('headcount', 1)], ['ropes 1, 20', null, 'nobody standing still', 'nothing set', '1 person']);
  assert.deepEqual([calmProblem(0.2, 0.6), calmProblem(0.6, 0.2), calmProblem(null, 0.3)], [null, 'the calm floor must be below the ceiling', 'move a slider first']);
  assert.equal(paramView('palette', { mode: 'auto', auto: ['#000000', '#111111', '#222222'], value: ['#000000', '#111111', '#222222'] }, null).line, 'auto #000000 #111111 #222222');
});

test('explainers: every input, parameter, effect and control has one; How this works is ten lines; sparklines draw', () => {
  assert.equal(HOW_IT_WORKS.length, 10);
  assert.deepEqual(explainer('how').lines, HOW_IT_WORKS);
  for (const k of [...INPUTS.map((x) => `in.${x}`), ...PARAM_NAMES.map((x) => `p.${x}`), ...Object.keys(EFFECT_WORDS).map((x) => `fx.${x}`),
                   ...['master', 'calm', 'simulate', 'clear', 'screens', 'pool', 'opening', 'effects', 'ropes'].map((x) => `ctl.${x}`), 'mode.auto', 'mode.fix', 'mode.adjust']) {
    const x = explainer(k);
    assert.ok(x && x.title && (x.body || x.lines) && (x.body ?? '').length < 400, k);
    assert.doesNotMatch(JSON.stringify(x), /TouchDesigner's status\.json|control_schema|\bTD\b/, `${k}: plain words`);
  }
  assert.equal(explainer('p.nope'), null);
  assert.match(explainer('p.master_brightness').body, /1,400 W/);
  assert.match(explainer('ctl.simulate').body, /2 minutes/);
  assert.equal(SCHEMA.overrides.simulated_max_s, 120, 'the 2 minutes the words say');
  const svg = sparkSVG([[1000, 0.1], [40000, 0.5], [86000, 0.9]], { lo: 0, hi: 1, nowS: 86400, label: 'Heard' });
  assert.match(svg, /^<svg class="spark"[^>]*aria-label="Heard"><path d="M[\d.]+,[\d.]+L/);
  assert.doesNotMatch(svg, /NaN|undefined/);
  assert.match(sparkSVG([]), /class="spark none"/);
});

function startServer(env) {
  return new Promise((resolve, reject) => {
    const base = { ...process.env }; delete base.MISSION_CONTROL_SOCKET;
    const p = spawn(process.execPath, [SERVER], { env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`server did not start:\n${out}`)); }, 20_000);
    p.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve({ p, base: m[0] }); } });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${out}`)); });
  });
}

test('server: /remembered-v2, /api/remembered/history and the three controls behind the login', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-rem2-'));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const { p, base } = await startServer({ MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                                          MISSION_FIXTURES: FIXTURES, MISSION_FAKE_AGENT: '1', MISSION_FIXTURE_APPLY_S: '0' });
  t.after(() => p.kill());
  const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), redirect: 'manual', headers: { 'content-type': 'application/json', ...headers } });
  assert.equal((await get('/remembered-v2')).status, 302);
  assert.equal((await get('/api/remembered/history?fields=inputs.heard')).status, 401);
  assert.equal((await post('/api/control/remembered-simulate', { headcount: 3 })).status, 401);
  const mc = (await post('/login', { password: 'test-password' })).headers.get('set-cookie').split(';')[0];
  const on = (s) => ({ cookie: `${mc}; scenario=${s}` });
  const page = await get('/remembered-v2', { cookie: mc });
  assert.equal(page.status, 200);
  const html = await page.text();
  for (const id of ['version', 'sim-banner', 'sim-banner-stop', 'now-phase', 'how-btn', 'master', 'master-apply', 'master-auto', 'calm-lo', 'calm-hi', 'calm-apply', 'sim-hc', 'sim-lr',
                    'sim-go', 'sim-stop', 'clear-all', 'intensity', 'z-video', 'pool', 'z-pool', 'z-opening', 'flow', 'strips-canvas', 'quads-canvas', 'fx-body'])
    assert.match(html, new RegExp(`id="${id}"`), id);
  assert.ok((html.match(/class="q"/g) ?? []).length >= 9, 'a ? on every control');
  assert.match(html, /<script type="module" src="\/remembered-v2.js"><\/script>/);
  for (const f of ['/remembered-v2.js', '/remembered-v2-words.js', '/remembered-v2.css', '/remembered.css', '/remembered-schema.js']) assert.equal((await get(f)).status, 200, f);
  const h = await (await get(`/api/remembered/history?fields=${HISTORY_FIELDS.join(',')}`, on('remembered-v2-simulating'))).json();
  assert.deepEqual([h.ok, Object.keys(h.fields).length, h.fields['inputs.heard'].length], [true, HISTORY_FIELDS.length, 288]);
  assert.equal((await get('/api/remembered/history?fields=inputs.nope', on('remembered-v2-simulating'))).status, 400);
  assert.equal((await get('/api/remembered/history?fields=inputs.heard', on('bitcube-offline'))).status, 503);
  const sim = await post('/api/control/remembered-simulate', { headcount: 5 }, on('remembered-v2-stale'));
  assert.equal(sim.status, 409, 'a stale looks report: which look shows is not known');
  const ok = await post('/api/control/remembered-override', { param: 'knob.density', mode: 'fix', value: 0.25 }, on('remembered-v2-simulating'));
  assert.equal(ok.status, 200);
  const b = await (await get('/api/remembered', on('remembered-v2-simulating'))).json();
  assert.deepEqual([b.status.params['knob.density'].mode, b.status.params['knob.density'].value, b.overrides['knob.density'].value], ['fix', 0.25, 0.25]);
  assert.equal((await post('/api/control/remembered-override', { param: 'knob.density', mode: 'fix', value: 2 }, on('remembered-v2-simulating'))).status, 400);
  const refused = await post('/api/control/remembered-override-clear', {}, on('all-looks-auto'));
  assert.deepEqual([refused.status, (await refused.json()).error], [409, REMEMBERED_V2_ONLY]);
});
