// Code review CR8 (1373e81..80b997a): the history's verdicts on the long changes outlive a burst of quick ones, Recent never says
// "Asked to" for a change that can no longer get a verdict, a restart from OK is no "as before", one table of the changes that
// wait for the server's verdict, one rule for a held change and one server clock on every page, step lines that know the repo
// from the installation, and the login masks for curl's -uuser:pw and a keyword with no separator before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { History, describeEvent, awaitsVerdict } from '../lib/history.mjs';
import { CONFIRMED_BY_READING, MAYBE_HOLDS as SERVER_HOLDS } from '../lib/applying.mjs';
import { AWAITED, awaited, MAYBE_HOLDS, derive, endedSaid } from '../public/model.js';
import { lastDoneParts } from '../public/status-words.js';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const T0 = Date.UTC(2026, 9, 26, 4, 4, 0);          // 21:04 Pacific
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function payload({ t, td, applying = [], extra = {} } = {}) {
  return { now: t, bitcube: { ok: true, at: t, value: { online: true } }, seasons: { ok: true, at: t, value: { season: 'winter', mode: 'automatic', intensity: 0.2, presence: { available: false } } },
    modal: { ok: true, at: t, value: { ok: true, tick: 1, next_tick_epoch: t / 1000 + 200, finished_at: new Date(t - 60_000).toISOString() } },
    probe: { ok: true, at: t, value: { ok: true, uptime_h: 30, time: '2026-10-25T21:04:00', boot_file: YEAR, show_files: [YEAR, LIVE], displays: ['M14', 'LED 1920X1080'],
      devices: { psac10_1: true, psac10_2: true, gallery_cam: true, river_cam: true, router: true, internet: true },
      td: td ?? { ok: true, file: YEAR, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } } } },
    applying, ...extra };
}

// ---- #12: one table of the changes that wait for the server's verdict ---------------------------------------------------------

test('CR8 #12: one table (model.js AWAITED) says which changes wait for the server\'s verdict, and every list reads it', () => {
  assert.deepEqual(Object.keys(AWAITED).sort(), ['bootfile', 'calibrate', 'lightsroute', 'rebuild', 'switch']);
  assert.deepEqual(MAYBE_HOLDS, Object.keys(AWAITED), 'a maybe holds its lock exactly for these');
  assert.equal(SERVER_HOLDS, MAYBE_HOLDS, 'the server reads the same table');
  assert.deepEqual(CONFIRMED_BY_READING, Object.keys(AWAITED).filter((k) => AWAITED[k] === 'reading'), 'a reading confirms all but a calibration start (its progress does)');
  assert.equal(awaited('calibrate', { action: 'start' }), true);
  assert.equal(awaited('calibrate', { action: 'cancel' }), false, 'a Stop is no change to wait for');
  assert.equal(awaited('ropes', { dark: true }), false);
  // Recent, Last done and how another phone's change ended all follow it: a lighting port change too (R8 #31)
  for (const action of [...Object.keys(AWAITED), 'ropes', 'mode']) {
    const body = action === 'calibrate' ? { action: 'start' } : action === 'lightsroute' ? { route: 'router' } : { file: LIVE };
    const want = action in AWAITED;
    assert.equal(awaitsVerdict({ kind: 'action', action, body, ok: true, applying_id: 'ax.1' }), want, action);
    assert.equal(lastDoneParts({ action, body, ok: true, applying_id: 'ax.1' }, { applying: [], confirmed: [], expired: [] }).head, want ? 'Last sent' : 'Last done', action);
    const m = derive(payload({ t: T0, extra: { confirmed: [{ id: 'ax.1', action, label: `the ${action}`, source: 'mission control', at: T0 - 1000 }] } }), T0);
    assert.equal(endedSaid(m, {}, T0).length, want ? 1 : 0, action);
  }
  // and no copy of the list is left in the files that read it
  for (const f of ['../lib/history.mjs', '../lib/applying.mjs', '../public/status-words.js', '../public/model.js']) {
    assert.doesNotMatch(src(f).replace(/^const FILE_ACTIONS = .*$/m, ''), /\[\s*'switch', 'rebuild', 'bootfile'(?:, 'lightsroute'(?:, 'calibrate')?)?\s*\]/, f);
  }
});
