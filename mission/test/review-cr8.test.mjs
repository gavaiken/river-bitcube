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
      modal_link: { processes: 8, gallery: { log_age_s: 1, last: '21:03:59 INFO    gallery/video -> media/gallery/video/2026-10-23T09-58-32-197Z.mp4 (50 KB)' },
                    river: { log_age_s: 4, last: '21:03:56 INFO    river/video -> media/river/video/2026-10-23T09-58-29-197Z.mp4 (63 KB)' },
                    sync: { log_age_s: 57, last: '21:03:03 INFO    sync: updated status.json (611 bytes)' } },
      recorder: { clips: 14, last: '2026-10-25 21:00:41 done' },
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

// ---- #7: "Asked to …" only while a verdict can still come ------------------------------------------------------------------------

test('CR8 #7: Recent says "Asked to …" only while the change can still get a verdict; one that never will reads "Sent …", never done', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'cr8-')), 'history.jsonl');
  let t = T0;
  const h = new History({ file, now: () => t });
  h.action({ action: 'switch', body: { file: LIVE }, ok: true, source: 'studio chat', label: 'the switch to the live river', applying_id: 'ax.1' });
  h.action({ action: 'rebuild', body: { file: YEAR }, ok: true, source: 'mission control', applying_id: 'ax.2' });
  const words = (hh = h) => Object.fromEntries(hh.recent({ kinds: 'action' }).map((e) => [e.applying_id, describeEvent(e)]));
  const last = (hh = h) => describeEvent(hh.summary(t).last_action);
  assert.deepEqual(words(), { 'ax.1': 'Asked to switch TouchDesigner to the live river from the studio chat', 'ax.2': "Asked to rebuild the river's year with the new LED map from mission control" });
  assert.equal(last(), "Asked to rebuild the river's year with the new LED map from mission control", 'Last done\'s words the same');
  // a server restart forgets what it was applying: nothing from before it can still get a verdict
  const after = new History({ file, now: () => t });
  assert.deepEqual(words(after), { 'ax.1': 'Sent the switch to the live river from the studio chat', 'ax.2': "Sent the rebuild of the river's year from mission control" });
  assert.equal(last(after), "Sent the rebuild of the river's year from mission control");
  // past its confirm limit (a switch 3 min, a rebuild 7.5 min, from its answer) and a minute for the next look, no verdict will come
  t += 4 * 60_000 + 1000;
  assert.deepEqual(words(), { 'ax.1': 'Sent the switch to the live river from the studio chat', 'ax.2': "Asked to rebuild the river's year with the new LED map from mission control" });
  t += 5 * 60_000;
  assert.equal(words()['ax.2'], "Sent the rebuild of the river's year from mission control");
  // a verdict that does come still says how it ended
  h.judge({ confirmed: [{ id: 'ax.2' }] }, t);
  assert.equal(words()['ax.2'], "Rebuilt the river's year with the new LED map from mission control");
  // quick changes and failures read as before
  h.action({ action: 'ropes', body: { dark: true }, ok: true, source: 'mission control', applying_id: 'ax.3' });
  h.action({ action: 'bootfile', body: { file: LIVE }, ok: false, maybe: true, source: 'mission control', applying_id: 'ax.4' });
  t += 3600e3;
  assert.equal(words()['ax.3'], 'Turned the ropes dark from mission control');
  assert.match(words()['ax.4'], /may or may not have happened$/);
});

// ---- #8: a restart from OK is a restart, never "as before" -----------------------------------------------------------------------

test('CR8 #8: OK, a restart, then OK again: the OK after it starts its own since and is no "as before"; a fault the restart doesn\'t touch still is', async () => {
  const { feed } = await import('../lib/history.mjs');
  const RESTART = (t) => [{ id: 'ax.8', action: 'switch', label: "the restart on the river's year", file: YEAR, source: 'mission control', phase: 'confirming', started_at: t - 3000, answered_at: t - 1000, expect_s: 60, blocks: ['ropes', 'hub75', 'switch'] }];
  let t = T0;
  const h = new History({ file: null, now: () => t });
  h.observe(payload({ t })); t += 18 * 60_000; h.observe(payload({ t }));
  assert.equal(h.since('overall', t).level, 'ok');
  const n = h.events.length;
  for (const td of [{ ok: false, error: 'not running' }, { ok: false, error: 'not answering' }]) { t += 5000; h.observe(payload({ t, td, applying: RESTART(t) })); }
  assert.equal(h.state.overall.cause, 'td-restarting');
  assert.equal(h.state.overall.before_restart, null, 'nothing to restore: OK is no fault the restart interrupted');
  t += 30_000; h.observe(payload({ t }));
  const back = t;
  t += 33_000;
  const s = h.since('overall', t);
  assert.deepEqual([s.level, s.since], ['ok', back], 'OK since the restart ended, never since before it');
  const ev = h.events.slice(n).filter((e) => e.kind === 'overall').at(-1);
  assert.equal(ev.back, undefined);
  assert.doesNotMatch(feed([ev])[0].words, /as before/);
  // a camera down across the restart still keeps its since (R8 #5)
  const camDown = (extra = {}) => { const p = payload({ t, ...extra }); p.probe.value.devices.gallery_cam = false; return p; };
  t += 5000; h.observe(camDown()); const began = h.since('overall', t).since;
  t += 10 * 60_000; h.observe(camDown());
  t += 5000; h.observe(camDown({ td: { ok: false, error: 'not running' }, applying: RESTART(t) }));
  t += 30_000; h.observe(camDown());
  assert.deepEqual([h.since('overall', t).cause, h.since('overall', t).since], ['gallery-cam', began]);
});
