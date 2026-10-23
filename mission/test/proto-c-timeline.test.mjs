// Direction C's timeline module against the scenario fixtures: seeds from the payload's own dates, the diff between
// two polls, the store's "since when", de-duplication under shifting dates, and the hour window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { derive, clock } from '../public/model.js';
import { digest, seed, diff, observe, merge, newStore, prune, feed, sinceWords, gapWords, AWAY_MS, WINDOW_MS, RESTART_MS, RUN_GAP_MS } from '../public/proto/c-timeline.js';

const DIR = new URL('./fixtures/', import.meta.url);
const byName = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))]));
const NOW = byName['all-good']._scenario.now;
/** A fixture as the page sees it `later` ms after its moment, optionally re-dated by `shift` ms (as fixture mode does). */
function poll(name, { later = 2000, shift = 0 } = {}) {
  const fx = JSON.parse(JSON.stringify(byName[name]));
  const walk = (x, k) => Array.isArray(x) ? x.map((e) => walk(e, k)) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([kk, v]) => [kk, walk(v, kk)]))
    : typeof x === 'number' && k === 'at' ? x + shift : typeof x === 'number' && /^(t|next_tick_epoch)$/.test(k) && x > 1e9 ? Math.round(x + shift / 1000)
    : typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) && shift ? new Date(Date.parse(x) + shift).toISOString() : x;
  const status = { ...walk(fx.status, ''), now: NOW + shift };
  const m = derive(status, NOW + shift + later);
  return { status, m, d: digest(m, status) };
}

test('digest: the facts one poll keeps for the next', () => {
  const { d } = poll('all-good');
  assert.equal(d.t, NOW);
  assert.equal(d.level, 'ok');
  assert.equal(d.cause, null);
  assert.equal(d.items['gallery camera'], 'ok');
  assert.equal(d.names['hub75 panels'], 'HUB75 panels');
  assert.equal(d.season, 'spring');
  assert.equal(d.mode, 'automatic');
  assert.equal(d.file_kind, 'year');
  assert.equal(d.ropes, 'river');
  assert.equal(d.scene_ms, Date.parse('2026-10-23T02:57:47-07:00'));
  assert.equal(d.tick_ms, Date.parse('2026-10-23T09:57:48+00:00'));
  assert.ok(Math.abs(d.boot_ms - (NOW - 3.1 * 3600e3)) < 120e3, 'bitcube restarted 3.1 h ago');
  assert.equal(d.history.length, 6);
  const off = poll('bitcube-offline').d;
  assert.equal(off.boot_ms, null);
  assert.equal(off.file, null);
  assert.deepEqual(off.history, []);
});

test('seed: the season turn in the history, Dave\'s scene and tick, bitcube\'s restart, with the payload\'s own times', () => {
  const ev = seed(poll('all-good').d);
  const season = ev.filter((e) => e.kind === 'season');
  assert.equal(season.length, 1);
  assert.equal(season[0].title, 'Season turned to spring');
  assert.equal(season[0].t, 1792749501000);
  assert.match(season[0].detail, /one season a minute/);
  const scene = ev.find((e) => e.kind === 'scene');
  assert.equal(scene.title, "Dave's agent set a new scene: blooms / sandstone-dusk");
  assert.match(scene.detail, /river's year doesn't use it/);
  assert.equal(ev.find((e) => e.kind === 'tick').title, "Dave's agent ticked (attentive)");
  assert.equal(ev.find((e) => e.kind === 'boot').title, 'bitcube restarted');
  // manual summer, no turn in its history; the live river says the panels show Dave's scene
  const lnc = seed(poll('lights-not-connected').d);
  assert.equal(lnc.filter((e) => e.kind === 'season').length, 0);
  assert.match(seed(poll('seasons-not-running').d).find((e) => e.kind === 'scene').detail, /live river shows it/);
  // nothing known: no seeds at all
  assert.deepEqual(seed(poll('nothing-known-yet').d), []);
});

test('diff: a camera going down is one entry with the new verdict and what changed under it; coming back is one more', () => {
  const a = poll('all-good').d, b = { ...poll('gallery-cam-down', { later: 7000 }).d, t: NOW + 5000 };
  const down = diff(a, b);
  assert.equal(down.length, 1);
  assert.equal(down[0].kind, 'verdict');
  assert.equal(down[0].level, 'warning');
  assert.match(down[0].title, /gallery camera is down/);
  assert.match(down[0].detail, /^Before: Everything is up/);
  assert.deepEqual(down[0].changes.map((c) => [c.id, c.from, c.to]), [['gallery camera', 'ok', 'down'], ['modal link', 'ok', 'warning']]);
  assert.equal(down[0].away, undefined);
  const back = diff(b, { ...a, t: NOW + 10000 });
  assert.equal(back.length, 1);
  assert.equal(back[0].level, 'ok');
  assert.match(back[0].title, /^Everything is up/);
  assert.match(back[0].detail, /Before: The gallery camera is down/);
  // the same world twice: nothing happened
  assert.deepEqual(diff(a, { ...a, t: NOW + 5000 }), []);
  assert.deepEqual(diff(null, a), []);
});

test('diff: a show-file switch, a mode change and a target change are their own entries; a gap marks them "away"', () => {
  const a = poll('all-good').d, live = { ...poll('seasons-not-running').d, t: NOW + 5000 };
  const ev = diff(a, live);
  assert.ok(ev.some((e) => e.kind === 'verdict' && /live river/.test(e.title)));
  const file = ev.find((e) => e.kind === 'file');
  assert.equal(file.title, 'TouchDesigner switched to the live river');
  assert.equal(file.detail, "It was showing the river's year.");
  const manual = { ...poll('lights-not-connected').d, t: NOW + 5000 };
  const mode = diff(a, manual).find((e) => e.kind === 'mode');
  assert.equal(mode.title, 'Mode set to manual');
  assert.match(mode.detail, /heading for summer/);
  const target = diff(manual, { ...manual, t: NOW + 10000, target: 'autumn' });
  assert.equal(target.length, 1);
  assert.equal(target[0].title, 'Target set to autumn');
  const away = diff(a, { ...live, t: NOW + AWAY_MS + 1000 });
  assert.ok(away.length >= 2);
  for (const e of away) assert.deepEqual(e.away, { from: NOW, to: NOW + AWAY_MS + 1000, lost: false });
});

test('observe: a start marker once, "since at least" on the first poll, a real since after a change, and no churn on a repeated poll', () => {
  const store = newStore(NOW - 1000);
  const first = poll('all-good');
  observe(store, first.d, first.m);
  assert.equal(store.events.filter((e) => e.kind === 'start').length, 1);
  assert.equal(store.events.find((e) => e.kind === 'start').title, first.d.headline);
  assert.equal(store.since.overall.atLeast, true);
  assert.equal(sinceWords(store.since.overall, NOW), `Since at least ${clock(NOW)}`);
  assert.equal(store.since.items.ropes.atLeast, true);
  const n = store.events.length;
  observe(store, { ...first.d, t: NOW + 5000 }, first.m);
  assert.equal(store.events.length, n, 'a repeated poll adds nothing');
  assert.equal(store.events.filter((e) => e.kind === 'start').length, 1);
  const second = poll('ropes-dark-on-purpose');
  observe(store, { ...second.d, t: NOW + 10000 }, second.m);
  assert.equal(store.since.overall.cause, 'ropes-dark');
  assert.equal(store.since.overall.t, NOW + 10000);
  assert.equal(store.since.overall.atLeast, false);
  assert.equal(sinceWords(store.since.overall, NOW + 10000 + 120e3), `Since ${clock(NOW + 10000)} (2 min)`);
  assert.equal(store.since.items.ropes.t, NOW + 10000);
  assert.equal(store.since.items.bitcube.atLeast, true, 'what did not change keeps its since');
  const v = store.events.find((e) => e.kind === 'verdict');
  assert.match(v.title, /dark on purpose/);
  // the page comes back after being away: the change is dated to the gap
  observe(store, { ...first.d, t: NOW + 10000 + 5 * 60e3 }, first.m);
  assert.equal(store.since.overall.from, NOW + 10000);
  assert.match(sinceWords(store.since.overall, NOW + 10000 + 5 * 60e3), /^Since between .* and .* \(this page was away\)$/);
  assert.equal(store.events.find((e) => e.kind === 'verdict' && e.level === 'ok').away.from, NOW + 10000);
});

test('merge: re-dated seeds (fixture mode, coarse uptime) stay one event; a real new tick counts, a real restart is new', () => {
  const store = newStore(NOW);
  const a = poll('all-good');
  observe(store, a.d, a.m);
  const seeds = () => store.events.filter((e) => ['scene', 'tick', 'boot', 'season'].includes(e.kind)).length;
  const n = seeds();
  for (const shift of [5000, 10000, 65000, 130000]) { const b = poll('all-good', { shift }); observe(store, b.d, b.m); }
  assert.equal(seeds(), n, 'the same scene, tick, restart and season turn shifted by seconds or a minute are not new');
  assert.equal(store.events.find((e) => e.kind === 'tick').n, 1);
  // a real tick later (the shifted polls above moved the kept tick forward by 130 s, as fixture mode would)
  merge(store, { key: 'ticks', t: a.d.tick_ms + 10 * 60e3, kind: 'tick', level: 'ok', title: "Dave's agent ticked (calm)", detail: 'Last tick 03:03.' });
  const tick = store.events.find((e) => e.kind === 'tick');
  assert.equal(tick.n, 2);
  assert.match(tick.detail, /2 ticks seen by this page/);
  assert.equal(tick.title, "Dave's agent ticked (calm)");
  // a real restart: both restarts stay
  merge(store, { key: 'boot', t: NOW - 1000, kind: 'boot', level: 'ok', title: 'bitcube restarted', detail: '' });
  assert.equal(store.events.filter((e) => e.kind === 'boot').length, 2);
  // the same restart seen with jitter: still two
  merge(store, { key: 'boot', t: NOW - 1000 + RESTART_MS / 2, kind: 'boot', level: 'ok', title: 'bitcube restarted', detail: '' });
  assert.equal(store.events.filter((e) => e.kind === 'boot').length, 2);
  // a second scene at the next tick (5 min later) is a new scene; one re-dated by a minute is not
  merge(store, { key: 'scene:y', t: a.d.scene_ms + 190e3, kind: 'scene', level: 'ok', title: 'same', detail: '' });
  assert.equal(store.events.filter((e) => e.kind === 'scene').length, 1);
  merge(store, { key: 'scene:x', t: a.d.scene_ms + 8 * 60e3, kind: 'scene', level: 'ok', title: 'Dave\'s agent set a new scene: x / y', detail: '' });
  assert.equal(store.events.filter((e) => e.kind === 'scene').length, 2);
});

test('prune and feed: the hour window, dated seeds kept under "Earlier", newest first, the start marker apart', () => {
  const store = newStore(NOW - 3 * 3600e3);
  const a = poll('all-good');
  observe(store, a.d, a.m);
  store.events.push({ key: 'verdict:old', t: NOW - 2 * 3600e3, kind: 'verdict', level: 'down', title: 'old', detail: '' });
  store.events.push({ key: 'verdict:new', t: NOW - 60e3, kind: 'verdict', level: 'ok', title: 'new', detail: '' });
  prune(store, NOW);
  assert.ok(!store.events.some((e) => e.key === 'verdict:old'), 'a two-hour-old change is gone');
  assert.ok(store.events.some((e) => e.kind === 'boot'), 'the 3 h old restart stays');
  const f = feed(store, NOW);
  assert.equal(f.start.kind, 'start');
  assert.ok(f.events.every((e) => NOW - e.t <= WINDOW_MS));
  assert.ok(f.earlier.some((e) => e.kind === 'boot'));
  assert.ok(f.events.some((e) => e.key === 'verdict:new'));
  for (let i = 1; i < f.events.length; i++) assert.ok(f.events[i - 1].t >= f.events[i].t, 'newest first');
  assert.ok(!f.events.some((e) => e.kind === 'start'));
});

test('season turns a minute apart fold into one running entry, newest on top; a turn after a long gap starts a new one', () => {
  const store = newStore(NOW);
  const turn = (season, t) => ({ key: `season:${season}:${Math.round(t / 60e3)}`, t, kind: 'season', level: 'ok', season, how: 'By the clock: the year turns one season a minute.', title: `Season turned to ${season}`, detail: '', turns: [{ season, t }] });
  merge(store, turn('winter', NOW - 180e3));
  merge(store, turn('spring', NOW - 120e3));
  merge(store, turn('summer', NOW - 60e3));
  merge(store, turn('autumn', NOW));
  const runs = store.events.filter((e) => e.kind === 'season');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].title, 'Season turned to autumn');
  assert.equal(runs[0].t, NOW);
  assert.equal(runs[0].turns.length, 4);
  assert.match(runs[0].detail, /^By the clock: the year turns one season a minute\. Before that: summer \d\d:\d\d, spring \d\d:\d\d, winter \d\d:\d\d\.$/);
  // the same turn re-dated by 20 s is not a new turn
  merge(store, turn('autumn', NOW + 20e3));
  assert.equal(store.events.filter((e) => e.kind === 'season')[0].turns.length, 4);
  // a fifth turn lists "and 1 more"; a turn after a long pause is a new entry
  merge(store, turn('winter', NOW + 60e3));
  assert.match(store.events.filter((e) => e.kind === 'season')[0].detail, /and 1 more\.$/);
  merge(store, turn('spring', NOW + 60e3 + RUN_GAP_MS + 1000));
  assert.equal(store.events.filter((e) => e.kind === 'season').length, 2);
  // the store survives JSON (localStorage) and keeps folding after a reload
  const again = JSON.parse(JSON.stringify(store));
  merge(again, turn('summer', NOW + 120e3 + RUN_GAP_MS));
  assert.equal(again.events.filter((e) => e.kind === 'season').length, 2);
  assert.equal(again.events.find((e) => e.kind === 'season' && e.season === 'summer').turns.length, 2);
});

test('losing contact is not "away": the outage is dated when noticed, and what changed during it says "no contact"', () => {
  const store = newStore(NOW);
  const a = poll('all-good');
  observe(store, a.d, a.m);
  // 40 s without an answer: the model turns the page unknown (cause "page"); the page observes that digest dated at
  // the last answer it got, since that is when contact was lost
  const stale = derive({ ...a.status }, NOW + 40e3);
  assert.equal(stale.overall.cause, 'page');
  const sd = { ...digest(stale, a.status), t: NOW };
  const lostEvents = observe(store, sd, stale);
  const lost = lostEvents.find((e) => e.kind === 'verdict');
  assert.match(lost.title, /can't reach mission control/);
  assert.equal(lost.away, undefined, 'the page was here, it just got no answer');
  assert.equal(store.since.overall.from, null);
  assert.equal(sinceWords(store.since.overall, NOW + 40e3), `Since ${clock(NOW)}`);
  // contact returns 2 minutes later with the ropes dark: that change happened during the outage
  const b = poll('ropes-dark-on-purpose');
  const backEvents = observe(store, { ...b.d, t: NOW + 160e3 }, b.m);
  const back = backEvents.find((e) => e.kind === 'verdict');
  assert.deepEqual(back.away, { from: NOW, to: NOW + 160e3, lost: true });
  assert.equal(gapWords(back.away), `changed while this page had no contact (${clock(NOW)} \u2192 ${clock(NOW + 160e3)})`);
  assert.equal(store.since.overall.lost, true);
  assert.match(sinceWords(store.since.overall, NOW + 160e3), /\(no contact\)$/);
  // a plain gap (the page was closed) still reads "away", and a same-minute gap says "about"
  const c = poll('all-good');
  observe(store, { ...c.d, t: NOW + 160e3 + 25e3 }, c.m);
  assert.equal(store.since.overall.lost, false);
  assert.match(sinceWords(store.since.overall, NOW + 185e3), /^Since (about|between) .*\(this page was away\)$/);
  assert.equal(gapWords({ from: NOW, to: NOW + 25e3 }), `changed while this page was away (${clock(NOW)} \u2192 ${clock(NOW + 25e3)})`);
  assert.equal(gapWords(null), '');
});
