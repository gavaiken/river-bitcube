// The Modal input show (river-combined-modal-inputs.toe, docs/modal-inputs.md): its control's whitelist, the server's and fixture
// mode's refusals, the model's view of td.modal_input (what Dave's agent is sending) and its stale warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planControl, checkedControl, calBlocked, testBlocked, actionResult, Mission } from '../lib/mission.mjs';
import { APPLY_BLOCKS, EXPECT_S, changeLabel, derive, modalInputView, MODAL_INPUT_FILE, MODAL_BASE } from '../public/model.js';
import { FixtureMission, fixtureModalInput } from '../lib/fixtures.mjs';
import { ACTIONS } from '../bin/mc.mjs';

const DIR = new URL('./fixtures/', import.meta.url).pathname;
const fx = (name) => JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
const run = (f) => derive({ ...f.status, now: f._scenario.now }, f._scenario.now + 2000);

test('modalinput: a listed source and a strength 0..1, nothing else reaches the probe', () => {
  assert.deepEqual(planControl('modalinput', { source: 'scene', strength: 0.6 }), { kind: 'probe', args: '-Action modalinput -Source scene -Strength 0.60' });
  assert.deepEqual(planControl('modalinput', { source: 'off', strength: '0' }), { kind: 'probe', args: '-Action modalinput -Source off -Strength 0.00' });
  for (const source of [undefined, null, '', 'Scene', 'frames; shutdown', ['scene'], {}, true]) assert.throws(() => planControl('modalinput', { source, strength: 0.5 }), /source is/);
  for (const strength of [undefined, null, '', true, [], -0.1, 1.01, NaN, Infinity, '0.5; whoami']) assert.throws(() => planControl('modalinput', { source: 'frames', strength }), /0 to 1/);
  assert.deepEqual(checkedControl('modalinput', { source: 'frames', strength: '0.375', file: 'x', framing: 'pool' }), { source: 'frames', strength: 0.38 });
});

test('modalinput is locked like the overlay: calibration, test pattern, a switch; its own copy; a TouchDesigner refusal fails it', () => {
  assert.equal(calBlocked('modalinput', { running: true }).status, 409);
  assert.equal(testBlocked('modalinput', {}, { value: { td: { ok: true, ropes: { source: 'test' } } } }).status, 409);
  for (const a of ['switch', 'rebuild', 'calibrate']) assert.ok(APPLY_BLOCKS[a].includes('modalinput'), a);
  assert.deepEqual(APPLY_BLOCKS.modalinput, ['modalinput']);
  assert.equal(EXPECT_S.modalinput, 15);
  assert.equal(actionResult('modalinput', { ok: true, td: { ok: false, error: 'wrong show' } }).ok, false);
  assert.equal(changeLabel('modalinput', { source: 'scene', strength: 0.6 }), 'the change of the Modal input to Scene at 60 %');
  assert.equal(changeLabel('modalinput', { source: 'off', strength: 0.6 }), 'the change of the Modal input to Off');
  assert.ok(ACTIONS.includes('modalinput'), 'the studio agent has it (bin/mc.mjs)');
});

test('the live server refuses a Modal input change while another show runs, without asking bitcube', async () => {
  const m = new Mission({ probe: async () => { throw Error('must not run'); } });
  m.data.probe = { at: Date.now(), value: { td: { ok: true, file: 'river-combined-v0.toe' } } };
  await assert.rejects(m.control('modalinput', { source: 'scene', strength: 0.5 }), (e) => e.status === 409 && /only available/.test(e.message));
  await assert.rejects(m.control('modalinput', { source: 'nope', strength: 0.5 }), (e) => e.status === 400);
});

test('the live server sends the checked probe action while the show runs', async () => {
  let args = null;
  const m = new Mission({ probe: async (_h, a) => { args = a; return { ok: true, td: { ok: true, file: MODAL_INPUT_FILE } }; } });
  m.data.probe = { at: Date.now(), value: { td: { ok: true, file: MODAL_INPUT_FILE, modal_input: fixtureModalInput('scene') } } };
  const r = await m.control('modalinput', { source: 'frames', strength: 0.25, extra: 'dropped' });
  assert.equal(r.ok, true);
  assert.equal(args, '-Action modalinput -Source frames -Strength 0.25');
});

test('fixture mode: a world switched to the show reports it, a change holds there, and another show refuses it', async () => {
  const f = fx('all-good');
  const m = new FixtureMission({ dir: DIR, stateDir: mkdtempSync(join(tmpdir(), 'mi-')), now: () => f._scenario.now, applyS: 0 });
  const w = m.worldFor('all-good');
  assert.equal((await m.control('modalinput', { source: 'scene', strength: 0.5 }, 'all-good')).ok, false, 'the year runs: refused');
  w.file = MODAL_INPUT_FILE;
  let s = m.snapshot('all-good');
  assert.equal(s.probe.value.td.modal_input.source, 'scene', 'a default Modal input until one is chosen');
  assert.equal((await m.control('modalinput', { source: 'frames', strength: 0.8 }, 'all-good')).ok, true);
  s = m.snapshot('all-good');
  const mi = s.probe.value.td.modal_input;
  assert.equal(mi.source, 'frames');
  assert.equal(mi.strength, 0.8);
  assert.equal(mi.params.length, 5, 'the five elements');
  const d = derive(s, s.now);
  assert.equal(d.show.modal_input.source, 'frames');
  assert.equal(d.controls.modalinput.possible, true);
  // a stale source chosen in a world reads stale
  const st = new FixtureMission({ dir: DIR, stateDir: mkdtempSync(join(tmpdir(), 'mi-')), now: () => f._scenario.now, applyS: 0 });
  await st.control('modalinput', { source: 'scene', strength: 0.6 }, 'modal-input-frames-stale');
  assert.equal(st.snapshot('modal-input-frames-stale').probe.value.td.modal_input.stale, false, 'the scene is fresh there');
});

test('the view: palette swatches, numbers as bars, per-element frame values, images from Modal, sources aged on the server clock', () => {
  const v = run(fx('modal-input-scene')).show.modal_input;
  assert.equal(v.source, 'scene');
  assert.equal(v.strength, 0.6);
  assert.equal(v.stale, false);
  const pal = v.params.find((p) => p.name === 'palette');
  assert.equal(pal.kind, 'palette');
  assert.ok(pal.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
  const sp = v.params.find((p) => p.name === 'speed');
  assert.equal(sp.kind, 'number');
  assert.equal(sp.frac, 0.19);
  assert.equal(v.params.find((p) => p.name === 'turbulence').effective, 0.55, 'what TouchDesigner uses, when it differs');
  assert.equal(v.scene.palette_name, 'froth-deepening');
  assert.ok(v.scene.journal);
  // the full check is 20 s old in every fixture: its ages are 20 s older now
  assert.equal(v.sources.find((x) => x.id === 'scene').age_s, 62);
  assert.equal(v.fresh_words, 'Canvas live · Scene 1 min ago · Frames 2 min ago');
  assert.ok(sp.age_s != null, 'a parameter without its own age takes its source\'s');

  const fr = run(fx('modal-input-frames')).show.modal_input;
  const el = fr.params.find((p) => p.name === 'ropes');
  assert.equal(el.kind, 'frame');
  assert.deepEqual(el.fields.map((x) => x.key), ['amount', 'contrast', 'speed', 'journey']);
  assert.equal(fr.frames.images.length, 5);
  assert.equal(fr.frames.images[4].url, `${MODAL_BASE}/frames/2026-10-23T09-57-25Z-7f3a/ropes.png`);
  assert.equal(fr.frames.note, 'dusk: cooling toward deep blue');
});

test('the view keeps anything odd out of a page and a URL', () => {
  const v = modalInputView({ source: 'rm -rf', strength: 7, sources: { frames: { ok: true, age_s: 5, frame_id: '../../etc"><script>' } },
    params: [{ name: 'palette', value: ['red', '#12345g'] }, { name: 'screen-1', value: { amount: 0.5 }, image: 'https://evil.example/x.png' }, { name: 'x', value: { a: 1 }, image: '/frames/ok/ropes.png' }, 'junk', { value: 1 }] });
  assert.equal(v.source, null);
  assert.equal(v.strength, 1);
  assert.equal(v.frames.frame_id, null);
  assert.deepEqual(v.frames.images, []);
  assert.equal(v.params.length, 3);
  assert.notEqual(v.params[0].kind, 'palette', 'not colours');
  assert.equal(v.params[1].image, null, 'only Modal\'s own image paths');
  assert.equal(v.params[2].image, `${MODAL_BASE}/frames/ok/ropes.png`);
  assert.equal(modalInputView(null), null);
  assert.equal(modalInputView('x'), null);
});

test('every Modal input fixture is OK; old frames are a warning on Dave\'s agent, never a fault, with what to do', () => {
  for (const n of ['modal-input-scene', 'modal-input-frames', 'modal-input-canvas', 'modal-input-off']) {
    const d = run(fx(n));
    assert.equal(d.overall.level, 'ok', n);
    assert.equal(d.controls.modalinput.possible, true, n);
    assert.equal(d.show.modal_input.stale, false, n);
  }
  const d = run(fx('modal-input-frames-stale'));
  assert.equal(d.overall.level, 'warning');
  assert.equal(d.overall.cause, 'modal-input-stale');
  assert.equal(d.overall.headline, "Dave's frames are more than 15 minutes old: showing the river without them");
  assert.match(d.overall.action, /Tell Dave|rests overnight/);
  assert.equal(d.items.find((x) => x.id === 'modal agent').level, 'warning');
  assert.ok(!d.problems.some((p) => p.level === 'down'));
  assert.equal(d.show.modal_input.effective_source, 'off');
  assert.equal(d.controls.modalinput.possible, true, 'another source can still be chosen');
});

test('the control is greyed with a reason on any other show, and while the show has not answered', () => {
  const d = run(fx('all-good'));
  assert.equal(d.show.modal_input, null);
  assert.match(d.controls.modalinput.why, /isn't running or hasn't answered/);
  const f = fx('modal-input-scene');
  delete f.status.probe.value.td.modal_input;
  const e = run(f);
  assert.equal(e.show.modal_input, null);
  assert.equal(e.controls.modalinput.possible, false);
});
