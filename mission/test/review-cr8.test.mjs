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

// ---- #1, #14: the long changes' verdicts outlive a burst of quick ones; verdicts() never copies what it keeps --------------------

/** One change through the history as the server records it: its action, then the server's verdict on its entry. */
function change(h, t, { id, action, body, verdict = 'confirmed', requestId = null }) {
  h.action({ action, body, ok: true, source: 'mission control', applying_id: id, ...(requestId ? { request_id: requestId } : {}), t });
  h.judge({ [verdict]: [{ id, action, at: t }] }, t);
}

test('CR8 #1: a switch\'s verdict stays in status.verdicts for its 12 h however many quick changes come after it, also after a restart', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'cr8-')), 'history.jsonl');
  let t = T0;
  const h = new History({ file, now: () => t });
  change(h, t, { id: 'ax.sw', action: 'switch', body: { file: LIVE }, requestId: 'rq.sw' });
  change(h, t += 1000, { id: 'ax.bf', action: 'bootfile', body: { file: YEAR }, verdict: 'expired' });
  // an evening of quick changes after it: far more than the 20 served and the 500 kept
  for (let i = 0; i < 700; i++) change(h, t += 1000, { id: `ax.q${i}`, action: i % 2 ? 'ropes' : 'hub75', body: {} });
  const has = (list, id) => list.find((v) => v.id === id);
  for (const [who, hh] of [['this server', h], ['after a restart', new History({ file, now: () => t })]]) {
    const v = hh.verdicts(t);
    assert.deepEqual(has(v, 'ax.sw'), { id: 'ax.sw', request_id: 'rq.sw', verdict: 'confirmed' }, who);
    assert.deepEqual(has(v, 'ax.bf'), { id: 'ax.bf', verdict: 'expired' }, who);
    assert.ok(has(v, 'ax.q699'), `${who}: the newest quick ones are served too (a lost answer's verdict)`);
    assert.ok(v.length <= 40, `${who}: every phone downloads it on every poll (${v.length})`);
    assert.deepEqual(v.map((x) => x.id), [...v].sort((a, b) => hh.verdictOf.get(b.id).t - hh.verdictOf.get(a.id).t).map((x) => x.id), `${who}: newest first`);
    // a page that slept finds its own switch by its request id, and its verdict
    const m = derive({ ...payload({ t }), verdicts: v }, t);
    const { entryIdOf, entryVerdict } = await import('../public/model.js');
    assert.equal(entryVerdict(m, entryIdOf(m, 'rq.sw')), 'confirmed', who);
  }
  // its 12 h over, it goes
  t = T0 + 12 * 3600e3 + 1000;
  assert.equal(has(h.verdicts(t), 'ax.sw'), undefined);
});

test('CR8 #14: verdicts() reads only the newest it serves, never a copy of everything kept; judge() on no change waiting is free', () => {
  let t = T0;
  const h = new History({ file: null, now: () => t });
  for (let i = 0; i < 600; i++) change(h, t += 1000, { id: `ax.${i}`, action: i % 50 ? 'ropes' : 'switch', body: { file: LIVE } });
  const kept = h.verdictOf;
  for (const k of [Symbol.iterator, 'entries', 'keys', 'values', 'forEach']) kept[k] = () => { throw new Error(`verdicts() walked the whole map (${String(k)})`); };
  const v = h.verdicts(t);
  assert.equal(v[0].id, 'ax.599');
  assert.ok(v.some((x) => x.id === 'ax.550'), 'a switch from 50 changes ago');
  // judge() with nothing waiting reads neither list
  const lists = { get confirmed() { throw new Error('read the lists'); }, get expired() { throw new Error('read the lists'); } };
  assert.deepEqual(h.judge(lists, t), []);
});
