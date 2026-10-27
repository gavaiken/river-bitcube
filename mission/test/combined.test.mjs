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
  assert.equal(derive(status, status.now).controls.overlay.possible, true);
  world.file = 'river-local-oct-22-seasons.toe';
  assert.equal((await m.control('overlay', { strength: 1 }, 'all-good')).ok, false);
  status = m.snapshot('all-good');
  assert.equal(derive(status, status.now).controls.overlay.possible, false);
  assert.equal(status.probe.value.boot_file, f.status.probe.value.boot_file);
});
