import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planControl, checkedControl, calBlocked, testBlocked, actionResult, Mission } from '../lib/mission.mjs';
import { APPLY_BLOCKS, derive } from '../public/model.js';
import { FixtureMission } from '../lib/fixtures.mjs';

test('overlay rejects malformed values and emits only a bounded numeric probe argument', () => {
  for (const strength of [true, false, null, undefined, '', [], {}, -1, 1.1, NaN, Infinity, '0.5; whoami'])
    assert.throws(() => planControl('overlay', { strength }), /0 to 1/);
  assert.deepEqual(planControl('overlay', { strength: 0.37 }), { kind: 'probe', args: '-Action overlay -Overlay 0.37' });
  assert.deepEqual(checkedControl('overlay', { strength: '0.375', file: 'anything' }), { strength: 0.38 });
  assert.ok(APPLY_BLOCKS.switch.includes('overlay'));
  assert.ok(APPLY_BLOCKS.calibrate.includes('overlay'));
  assert.equal(calBlocked('overlay', { running: true }).status, 409);
  assert.equal(testBlocked('overlay', {}, { value: { td: { ok: true, ropes: { source: 'test' } } } }).status, 409);
  assert.equal(actionResult('overlay', { ok: true, td: { ok: false, error: 'wrong show' } }).ok, false);
});

test('live overlay action refuses an unrelated show without issuing a probe', async () => {
  const m = new Mission({ probe: async () => { throw Error('must not run'); } });
  m.data.probe = { at: Date.now(), value: { td: { ok: true, file: 'river-local-oct-22-seasons.toe' } } };
  await assert.rejects(m.control('overlay', { strength: 1 }), /only available/);
});

test('fixture exercises switch, overlay setting and returning to default independently', async () => {
  const dir = new URL('./fixtures/', import.meta.url).pathname;
  const f = JSON.parse(readFileSync(join(dir, 'all-good.json'), 'utf8'));
  const m = new FixtureMission({ dir, stateDir: mkdtempSync(join(tmpdir(), 'combined-')), now: () => f._scenario.now, applyS: 0 });
  const world = m.worldFor('all-good');
  // Use the same world a real switch would select, even while a new .toe is being built and not offered yet.
  world.file = 'river-combined-v0.toe';
  assert.equal((await m.control('overlay', { strength: 0.6 }, 'all-good')).ok, true);
  let status = m.snapshot('all-good');
  assert.equal(status.probe.value.td.combined.overlay, 0.6);
  assert.equal((await m.control('overlay', { strength: .6, framing: 'pool-multi' }, 'all-good')).ok, true);
  assert.equal(m.snapshot('all-good').probe.value.td.combined.framing, 'pool-multi');
  await m.control('overlay', { strength: .2 }, 'all-good');
  assert.equal(m.snapshot('all-good').probe.value.td.combined.framing, 'pool-multi');
  assert.equal(derive(status, status.now).controls.overlay.possible, true);
  world.file = 'river-local-oct-22-seasons.toe';
  assert.equal((await m.control('overlay', { strength: 1 }, 'all-good')).ok, false);
  status = m.snapshot('all-good');
  assert.equal(derive(status, status.now).controls.overlay.possible, false);
  assert.equal(status.probe.value.boot_file, f.status.probe.value.boot_file);
});

test('river framing is whitelisted and keeps legacy overlay requests valid', () => {
  assert.deepEqual(planControl('overlay', { strength: .1, framing: 'pool-multi' }),
    { kind: 'probe', args: '-Action overlay -Overlay 0.10 -Framing pool-multi' });
  assert.deepEqual(checkedControl('overlay', { strength: .1, framing: 'original', extra: 'drop' }),
    { strength: .1, framing: 'original' });
  for (const framing of [null, true, 'pool; shutdown', 'unknown', {}])
    assert.throws(() => planControl('overlay', { strength: .1, framing }), /framing/);
});

test('automatic framing uses the same guarded action and fixture readback', async () => {
  assert.deepEqual(planControl('overlay', { strength: .1, framing: 'auto' }),
    { kind: 'probe', args: '-Action overlay -Overlay 0.10 -Framing auto' });
  const dir = new URL('./fixtures/', import.meta.url).pathname;
  const f = JSON.parse(readFileSync(join(dir, 'all-good.json'), 'utf8'));
  const m = new FixtureMission({ dir, stateDir: mkdtempSync(join(tmpdir(), 'auto-')), now: () => f._scenario.now, applyS: 0 });
  m.worldFor('all-good').file = 'river-combined-v0.toe';
  await m.control('overlay', { strength: .1, framing: 'auto' }, 'all-good');
  const s = m.snapshot('all-good').probe.value.td.combined;
  assert.equal(s.framing, 'auto');
  assert.equal(s.effective_framing, 'pool-multi');
  assert.equal(s.auto_view.view, 'pool');
});

test('screen fades use bounded fixed probe arguments and preserve legacy settings', async () => {
  const screens = { mode: 'cycle', blend: 0.25, hold: 30 };
  assert.deepEqual(planControl('overlay', { strength: .18, screens }),
    { kind: 'probe', args: '-Action overlay -Overlay 0.18 -Screenmode cycle -Screenblend 0.25 -Screenhold 30' });
  assert.deepEqual(checkedControl('overlay', { strength: .18, screens: { ...screens, file: 'drop' } }),
    { strength: .18, screens });
  for (const s of [null, [], {}, { ...screens, mode: 'cycle; shutdown' }, { ...screens, hold: 31 },
    { ...screens, blend: true }, { ...screens, blend: NaN }, { ...screens, hold: '30; shutdown' }])
    assert.throws(() => planControl('overlay', { strength: .18, screens: s }));
  const dir = new URL('./fixtures/', import.meta.url).pathname;
  const f = JSON.parse(readFileSync(join(dir, 'all-good.json'), 'utf8'));
  const m = new FixtureMission({ dir, stateDir: mkdtempSync(join(tmpdir(), 'screen-')), now: () => f._scenario.now, applyS: 0 });
  m.worldFor('all-good').file = 'river-combined-v0.toe';
  await m.control('overlay', { strength: .18, framing: 'auto', screens }, 'all-good');
  await m.control('overlay', { strength: .2 }, 'all-good');
  const s = m.snapshot('all-good').probe.value.td.combined;
  assert.equal(s.screens.mode, 'cycle');
  assert.equal(s.screens.hold, 30);
  assert.equal(s.framing, 'auto');
  assert.equal(s.overlay, .2);
});

test('recorded screens are bounded and legacy requests preserve the recorded share', async () => {
  const screens = {mode:'recorded',blend:.25,hold:30,recorded:.4};
  assert.deepEqual(planControl('overlay',{strength:.18,screens}),
    {kind:'probe',args:'-Action overlay -Overlay 0.18 -Screenmode recorded -Screenblend 0.25 -Screenhold 30 -Screenrecorded 0.40'});
  for (const recorded of [true, null, -1, 1.1, NaN, Infinity, '0.4; shutdown'])
    assert.throws(() => planControl('overlay',{strength:.18,screens:{...screens,recorded}}));
  const dir = new URL('./fixtures/', import.meta.url).pathname;
  const f = JSON.parse(readFileSync(join(dir,'all-good.json'),'utf8'));
  const m = new FixtureMission({dir,stateDir:mkdtempSync(join(tmpdir(),'recorded-')),now:()=>f._scenario.now,applyS:0});
  m.worldFor('all-good').file='river-combined-v0.toe';
  await m.control('overlay',{strength:.18,screens},'all-good');
  assert.equal(m.snapshot('all-good').probe.value.td.combined.screens.recorded_mix,1);
  await m.control('overlay',{strength:.18,screens:{mode:'manual',blend:.25,hold:30}},'all-good');
  const s=m.snapshot('all-good').probe.value.td.combined.screens;
  assert.equal(s.recorded,.4);
  assert.equal(s.recorded_mix,.4);
  assert.equal(s.gavin_mix,.15);
});

test('screen delay is bounded and older clients preserve it', async () => {
  const screens={mode:'cycle',blend:0,hold:30,offset:10};
  assert.equal(planControl('overlay',{strength:.18,screens}).args,
    '-Action overlay -Overlay 0.18 -Screenmode cycle -Screenblend 0.00 -Screenhold 30 -Screenoffset 10.00');
  assert.equal(planControl('overlay',{strength:.18,screens:{...screens,hold:120,offset:96}}).args,
    '-Action overlay -Overlay 0.18 -Screenmode cycle -Screenblend 0.00 -Screenhold 120 -Screenoffset 96.00');
  for (const offset of [true,null,-1,121,NaN,Infinity,'10; shutdown'])
    assert.throws(()=>checkedControl('overlay',{strength:.18,screens:{...screens,offset}}));
  const dir=new URL('./fixtures/',import.meta.url).pathname;
  const f=JSON.parse(readFileSync(join(dir,'all-good.json'),'utf8'));
  const m=new FixtureMission({dir,stateDir:mkdtempSync(join(tmpdir(),'offset-')),now:()=>f._scenario.now,applyS:0});
  m.worldFor('all-good').file='river-combined-v0.toe';
  await m.control('overlay',{strength:.18,screens},'all-good');
  await m.control('overlay',{strength:.18,screens:{mode:'cycle',blend:0,hold:30}},'all-good');
  assert.equal(m.snapshot('all-good').probe.value.td.combined.screens.offset,10);
});
