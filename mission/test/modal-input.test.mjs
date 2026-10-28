// The Modal input show (river-combined-modal-inputs.toe, docs/modal-inputs.md): its control's whitelist, the server's and fixture
// mode's refusals, the model's view of td.modal_input (what Dave's agent is sending) and its stale warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planControl, checkedControl, calBlocked, testBlocked, actionResult, Mission } from '../lib/mission.mjs';
import { APPLY_BLOCKS, EXPECT_S, changeLabel, derive, MODAL_INPUT_FILE } from '../public/model.js';
import { modalInputView, MODAL_BASE, frameIssuedMs, cadenceS, sourceIntro, FRAME_FIELD_FROM, FRAME_FIELD_INFO, PARAM_INFO } from '../public/modal-input.js';
import { FixtureMission, fixtureModalInput, rebase } from '../lib/fixtures.mjs';
import { ModalSeen, withSeen } from '../lib/modal-seen.mjs';
import { ACTIONS } from '../bin/mc.mjs';

const DIR = new URL('./fixtures/', import.meta.url).pathname;
const fx = (name) => JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
const run = (f) => derive({ ...f.status, now: f._scenario.now }, f._scenario.now + 2000);
/** The panel's view of a derived model, as status.js makes it. */
const view = (d) => modalInputView(d.show.modal_input, d.show.fresh.probe_age_s ?? 0);

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
  assert.equal(view(d).source, 'frames');
  assert.equal(d.controls.modalinput.possible, true);
  // a stale source chosen in a world reads stale
  const st = new FixtureMission({ dir: DIR, stateDir: mkdtempSync(join(tmpdir(), 'mi-')), now: () => f._scenario.now, applyS: 0 });
  await st.control('modalinput', { source: 'scene', strength: 0.6 }, 'modal-input-frames-stale');
  assert.equal(st.snapshot('modal-input-frames-stale').probe.value.td.modal_input.stale, false, 'the scene is fresh there');
});

test('the view: palette swatches, numbers as bars, per-element frame values, images from Modal, sources aged on the server clock', () => {
  const v = view(run(fx('modal-input-scene')));
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
  assert.equal(v.params.find((p) => p.name === 'speed').factor, 0.85);
  assert.equal(sp.drives, 'how fast the summer effects move', 'plain words, not TouchDesigner\'s');
  assert.equal(sp.drives_raw, 'summer effect speed ×0.6–1.6');
  assert.equal(v.scene.palette_name, 'froth-deepening');
  assert.ok(v.scene.journal);
  // the full check is 20 s old in every fixture: its ages are 20 s older now
  assert.equal(v.sources.find((x) => x.id === 'scene').age_s, 62);
  assert.equal(v.fresh_words, 'Canvas live · Scene 1 min ago · Frames 2 min ago');
  assert.ok(sp.age_s != null, 'a parameter without its own age takes its source\'s');

  const fr = view(run(fx('modal-input-frames')));
  const el = fr.params.find((p) => p.name === 'ropes');
  assert.equal(el.kind, 'frame');
  assert.deepEqual(el.fields.map((x) => x.key), ['amount', 'contrast', 'speed', 'journey', 'mix']);
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
    assert.equal(view(d).stale, false, n);
  }
  const d = run(fx('modal-input-frames-stale'));
  assert.equal(d.overall.level, 'warning');
  assert.equal(d.overall.cause, 'modal-input-stale');
  assert.equal(d.overall.headline, "Modal's frames are 21 min old: showing the river without them");
  assert.match(d.overall.action, /Tell Dave|rests overnight/);
  assert.equal(d.items.find((x) => x.id === 'modal agent').level, 'warning');
  assert.ok(!d.problems.some((p) => p.level === 'down'));
  assert.equal(view(d).effective_source, 'off');
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

// ---- 28 Oct (Gavin: "none of it is explained … looks like no update for 7 minutes"): what arrives, when Dave sent it, how
// often, every value explained and marked by who sets it, screens 1–4 as one row while they read the same ----------------------
const viewAt = (f) => { const d = run(f); return modalInputView(d.show.modal_input, d.show.fresh.probe_age_s ?? 0, f._scenario.now); };

test('a frame id carries its UTC issue time; the page says it on the Pacific clock with its age', () => {
  assert.equal(frameIssuedMs('2026-10-28T01-16-01Z-9672'), Date.UTC(2026, 9, 28, 1, 16, 1));
  for (const bad of [null, 'latest', '2026-10-28T01:16:01Z', '../x', 42]) assert.equal(frameIssuedMs(bad), null, String(bad));
  const v = viewAt(fx('modal-input-frames'));
  assert.equal(v.latest.what, 'new pictures');
  assert.equal(v.latest.clock, '02:57', 'issued 09:57:25 UTC = 02:57 PDT');
  assert.equal(v.latest.age_s, 95, 'from the frame id, on the server clock at the answer');
  assert.equal(v.frames.issued_clock, '02:57');
  // no server clock: no issue age, the arrival age stays
  const w = view(run(fx('modal-input-frames')));
  assert.equal(w.latest.age_s, null);
  assert.equal(w.latest.arrived_age_s, 115);
});

test('how often: the median gap between the frames and scenes mission control has seen, overnight gaps ignored', () => {
  assert.equal(cadenceS([]), null);
  assert.equal(cadenceS([1000]), null, 'one is not a rhythm');
  assert.equal(cadenceS([0, 120_000, 240_000, 420_000]), 120);
  assert.equal(cadenceS([0, 60_000, 60_000, 3 * 3600_000, 3 * 3600_000 + 120_000]), 90, 'duplicates and the 3 h rest left out');
  const v = viewAt(fx('modal-input-frames'));
  assert.ok(v.latest.every_s >= 100 && v.latest.every_s <= 140, `about every 2 min (${v.latest.every_s} s)`);
  const s = viewAt(fx('modal-input-scene'));
  assert.equal(s.latest.what, 'a new scene');
  assert.equal(s.latest.clock, '02:58');
  assert.ok(s.latest.every_s >= 340 && s.latest.every_s <= 400, `about every 6 min (${s.latest.every_s} s)`);
  const st = viewAt(fx('modal-input-frames-stale'));
  assert.equal(st.latest.every_s, null, 'one frame seen: nothing said about how often');
  assert.equal(st.latest.age_s, 1260, 'the stale frame was sent 21 min ago');
  assert.equal(st.stale, true, 'and the stale warning stays');
});

test('one intro line per source says what arrives; the journey time when bitcube reports it', () => {
  assert.match(sourceIntro('frames'), /new set of pictures every few minutes: one for each screen and one for all 20 ropes/);
  assert.match(sourceIntro('frames'), /over a few seconds\.$/);
  assert.match(sourceIntro('frames', 20), /travels to each new set over 20 s\.$/);
  assert.match(sourceIntro('scene', 8), /four settings for how the river moves.*over 8 s\.$/);
  assert.match(sourceIntro('canvas'), /moving picture/);
  assert.equal(sourceIntro('off'), null);
  const f = fx('modal-input-frames');
  f.status.probe.value.td.modal_input.sources.frames.transition_ms = 20000;
  assert.match(viewAt(f).intro, /over 20 s\./);
  assert.match(viewAt(fx('modal-input-canvas')).intro, /web page/);
  assert.equal(viewAt(fx('modal-input-canvas')).latest.live, true);
});

test('every frame value is explained and marked: ripple, strength, speed from Modal; arrived bitcube\'s; mixed in your setting', () => {
  assert.deepEqual(FRAME_FIELD_FROM, { amount: 'modal', contrast: 'modal', speed: 'modal', journey: 'bitcube', mix: 'you' });
  for (const k of Object.keys(FRAME_FIELD_FROM)) assert.ok(FRAME_FIELD_INFO[k]?.length > 20, k);
  assert.match(FRAME_FIELD_INFO.speed, /can't go faster than 1×/);
  assert.match(FRAME_FIELD_INFO.mix, /Strength/);
  for (const k of ['palette', 'speed', 'density', 'brightness', 'turbulence', 'canvas']) assert.ok(PARAM_INFO[k], k);
  const v = viewAt(fx('modal-input-frames'));
  const ropes = v.rows.find((r) => r.name === 'ropes');
  assert.deepEqual(ropes.fields.map((x) => x.from), ['modal', 'modal', 'modal', 'bitcube', 'you']);
  assert.ok(ropes.fields.every((x) => x.info));
  const s = viewAt(fx('modal-input-scene'));
  assert.equal(s.params.find((p) => p.name === 'palette').label, "Modal's colours");
  assert.ok(s.params.every((p) => p.info), 'each knob has its explanation');
  assert.ok(!s.params.some((p) => p.own_age), 'no knob has its own age: the Latest line says when');
});

test('screens 1–4 are one row while they read the same, one row each once they differ', () => {
  const v = viewAt(fx('modal-input-frames'));
  assert.deepEqual(v.rows.map((r) => r.label), ['Screens 1–4', 'Ropes']);
  assert.deepEqual(v.rows[0].names, ['screen-1', 'screen-2', 'screen-3', 'screen-4']);
  assert.equal(v.params.length, 5, 'the elements themselves stay');
  const f = fx('modal-input-frames');
  f.status.probe.value.td.modal_input.params[2].value.amount = 0.531;     // reads 0.53 like the rest: still one row
  assert.equal(viewAt(f).rows.length, 2);
  f.status.probe.value.td.modal_input.params[2].value.amount = 0.7;
  assert.deepEqual(viewAt(f).rows.map((r) => r.label), ['Screen 1', 'Screen 2', 'Screen 3', 'Screen 4', 'Ropes']);
  f.status.probe.value.td.modal_input.params.splice(1, 1);                 // a screen missing: no "1–4" claim
  assert.equal(viewAt(f).rows.some((r) => r.name === 'screens'), false);
});

test('mission control keeps the last 10 distinct frames and scenes it saw, in memory, and serves them beside the reading', () => {
  const s = new ModalSeen();
  for (let k = 0; k < 14; k++) s.observe({ sources: { frames: { frame_id: `2026-10-28T01-${String(k).padStart(2, '0')}-00Z-ab` }, scene: { set_at: '2026-10-27T18:00:00-07:00' } } });
  s.observe({ sources: { frames: { frame_id: '2026-10-28T01-13-00Z-ab' } } });     // the same again: kept once
  s.observe({ sources: { frames: { frame_id: '"><script>' }, scene: { set_at: 'soon' } } });
  s.observe(null); s.observe('x');
  const l = s.list();
  assert.equal(l.frames.length, 10);
  assert.equal(l.frames[0], '2026-10-28T01-04-00Z-ab');
  assert.equal(l.frames.at(-1), '2026-10-28T01-13-00Z-ab');
  assert.deepEqual(l.scene, ['2026-10-27T18:00:00-07:00']);
  assert.deepEqual(withSeen({ seen: { frames: ['x'] } }, s).seen, { frames: ['x'] }, 'a reading with its own (a fixture) keeps it');
  assert.equal(withSeen(null, s), null);
});

test('the live snapshot adds what was seen across successive full checks', () => {
  let t = 1_800_000_000_000;
  const m = new Mission({ now: () => t, probe: async () => ({}) });
  const reading = (id, set) => ({ td: { ok: true, file: MODAL_INPUT_FILE, modal_input: { source: 'frames', strength: 0.5, sources: { frames: { ok: true, age_s: 5, frame_id: id }, scene: { ok: true, set_at: set } }, params: [] } } });
  for (const [k, id] of ['2026-10-28T01-10-00Z-a', '2026-10-28T01-12-00Z-b', '2026-10-28T01-14-10Z-c'].entries()) {
    m.data.probe = { at: t, value: reading(id, '2026-10-27T18:00:00-07:00') };
    m.snapshot(); m.snapshot();
    t += 60_000 * (k + 1);
  }
  const mi = m.snapshot().probe.value.td.modal_input;
  assert.deepEqual(mi.seen.frames, ['2026-10-28T01-10-00Z-a', '2026-10-28T01-12-00Z-b', '2026-10-28T01-14-10Z-c']);
  assert.equal(modalInputView(mi, 0, Date.UTC(2026, 9, 28, 1, 15, 10)).latest.every_s, 125);
  assert.equal(m.data.probe.value.td.modal_input.seen, undefined, 'the kept reading itself is untouched');
});

test('fixture mode moves a frame id with the fixture clock, as every other time', () => {
  const r = rebase({ value: { td: { modal_input: { sources: { frames: { frame_id: '2026-10-23T09-57-25Z-7f3a' } }, seen: { frames: ['2026-10-23T23-59-30Z-x'] } } } } }, 86_400_000);
  assert.equal(r.value.td.modal_input.sources.frames.frame_id, '2026-10-24T09-57-25Z-7f3a');
  assert.equal(r.value.td.modal_input.seen.frames[0], '2026-10-24T23-59-30Z-x');
});

test('the page: ⓘ buttons toggle on tap with aria-expanded and a title, pictures open larger, the Apply line says when you chose', () => {
  const js = readFileSync(new URL('../public/status.js', import.meta.url), 'utf8'), css = readFileSync(new URL('../public/status.css', import.meta.url), 'utf8');
  assert.match(js, /class="mi-i" id="mi-i-\$\{k\}" data-act="mi-info" data-info="\$\{k\}" aria-expanded="\$\{open\}" aria-controls="mi-x-\$\{k\}" title="\$\{esc\(text\)\}"/);
  assert.match(js, /case 'mi-info': \{ const k = b\.dataset\.info; if \(miInfoOpen\.has\(k\)\) miInfoOpen\.delete\(k\); else miInfoOpen\.add\(k\); render\(\);/);
  assert.match(js, /case 'mi-pic': if \(MI_PIC\.test/);
  assert.match(js, /Each column is one rope, top = top\./);
  assert.match(js, /Modal's latest pictures \(before the river ripples them\)/);
  assert.match(js, /<b>Latest from \$\{MODAL_CHIP\}:<\/b>/);
  assert.match(js, /You chose \$\{W\.label\} at \$\{nb\(pct \+ ' %'\)\} at \$\{t\}/);
  assert.doesNotMatch(js, /`Now \$\{W\.label\} at/, 'never "Now Frames at 50 % … 18:09", read as the data\'s age');
  assert.match(css, /\.mi-i \{[^}]*min-width: 32px; min-height: 32px/);
  assert.match(css, /\.mi-big\.ropes/);
});
