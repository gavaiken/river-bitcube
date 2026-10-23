// The status model against every scenario fixture: the verdict, each piece's state, plain words, staleness and
// broken payloads. Fixtures are the ground truth (test/fixtures/README.md); DISAGREE lists where the model reads
// the payload differently, on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { derive, dur, daytimeMinutes, intensityWord, PAGE_STALE_S, POLL_S, STALE_FACTOR } from '../public/model.js';

const DIR = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()
  .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))]);
const byName = Object.fromEntries(fixtures);
const LEVELS = ['ok', 'warning', 'down', 'unknown'];
const RANK = { down: 0, warning: 1, unknown: 2, ok: 3 };
const IDS = ['mission control', 'bitcube', 'touchdesigner', 'seasons', 'ropes', 'rope box 1', 'rope box 2', 'hub75 panels',
  'gallery camera', 'river camera', 'router', 'internet', 'modal agent', 'modal link', 'recorder', 'people counter'];
// Words the team should never have to read in a headline, a summary or an action (details may carry them, labelled).
const JARGON = /\b(fps|tcp|ssh|vnc|rtsp|psac10|probe|oserror|art-?net|wmi|http|json|undefined|null|NaN|epoch|toe)\b/i;
// Where the model follows the payload rather than a fixture's expect: the two live-river fixtures carry the same
// seasons situation (the year not running because the live river file has no year) but call it "ok" in one and
// "down" in the other. The model calls it a warning in both: the show runs, the year is deliberately not, and the
// way back is Switch now, exactly like dark ropes.
const DISAGREE = { 'river-cam-stale': { seasons: 'warning' }, 'seasons-not-running': { seasons: 'warning' } };

const run = (fx, later = 2000) => derive({ ...fx.status, now: fx._scenario.now }, fx._scenario.now + later);
const clone = (x) => JSON.parse(JSON.stringify(x));

for (const [name, fx] of fixtures) {
  test(`fixture ${name}: ${fx._scenario.expect.severity}, "${fx._scenario.expect.headline}"`, () => {
    const ex = fx._scenario.expect;
    const m = run(fx);
    assert.equal(m.overall.level, ex.severity, `overall is "${m.overall.headline}"`);
    assert.ok(LEVELS.includes(m.overall.level));
    assert.ok(m.overall.headline.length > 0 && m.overall.headline.length <= 160, m.overall.headline);
    assert.doesNotMatch(m.overall.headline, JARGON);
    assert.doesNotMatch(m.overall.action ?? '', JARGON);
    assert.equal(m.overall.stale, false, 'fresh fixtures are not stale');
    if (ex.severity === 'ok') assert.equal(m.overall.action, null, 'nothing to do: do not nag');
    else assert.ok(m.overall.action, 'a problem comes with what to do');
    for (const [id, want] of Object.entries(ex.items)) {
      const it = m.items.find((x) => x.id === id);
      assert.ok(it, `item ${id} is missing`);
      const level = DISAGREE[name]?.[id] ?? want.split(':')[0];
      assert.equal(it.level, level, `${id}: "${it.summary}" (fixture says "${want}")`);
    }
    // every piece exactly once, short plain summaries, worst first and OK last
    assert.deepEqual([...m.items.map((x) => x.id)].sort(), [...IDS].sort());
    for (const it of m.items) {
      assert.ok(LEVELS.includes(it.level), it.id);
      assert.ok(it.summary.length > 0 && it.summary.length <= 60, `${it.id}: "${it.summary}" (${it.summary.length} chars)`);
      assert.doesNotMatch(it.summary, JARGON, `${it.id}: "${it.summary}"`);
      assert.doesNotMatch(it.action ?? '', JARGON, `${it.id}: "${it.action}"`);
      assert.match(it.summary, /^(?:[A-Z0-9]|bitcube)/, `${it.id}: sentence case ("${it.summary}")`);
      assert.ok(['mini', 'bitcube', 'modal'].includes(it.checked_from), it.id);
      assert.equal(it.stale, false);
    }
    const ranks = m.items.map((x) => RANK[x.level]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'items are ordered worst first');
    // the headline's cause owns its items, and every problem's items exist
    for (const p of m.problems) for (const id of p.items) assert.ok(IDS.includes(id), `${p.id} names ${id}`);
    if (m.overall.cause) assert.equal(m.problems[0].id, m.overall.cause);
  });
}

test('one cause reads as one problem: the lights, a frozen TouchDesigner, no internet, bitcube offline', () => {
  let m = run(byName['lights-not-connected']);
  assert.equal(m.overall.cause, 'lights');
  for (const id of ['ropes', 'rope box 1', 'rope box 2', 'hub75 panels']) assert.equal(m.items.find((x) => x.id === id).cause, 'lights', id);
  for (const id of ['river camera', 'modal link', 'recorder']) assert.equal(m.items.find((x) => x.id === id).cause, 'river-site', id);
  assert.match(m.overall.also[0], /river site is down/);
  m = run(byName['td-frozen']);
  for (const id of ['touchdesigner', 'seasons', 'ropes', 'hub75 panels']) assert.equal(m.items.find((x) => x.id === id).cause, 'td-frozen', id);
  assert.equal(m.problems.length, 1, 'no second problem invented from the frozen page or the clips');
  m = run(byName['no-internet']);
  for (const id of ['internet', 'modal link', 'river camera', 'recorder']) assert.equal(m.items.find((x) => x.id === id).cause, 'no-internet', id);
  assert.equal(m.problems.length, 1);
  m = run(byName['bitcube-offline']);
  assert.equal(m.problems.length, 1);
  for (const it of m.items) {
    if (it.checked_from === 'bitcube' || it.id === 'seasons') { assert.equal(it.level, 'unknown', it.id); assert.equal(it.cause, 'bitcube-offline', it.id); }
  }
  assert.equal(m.items.find((x) => x.id === 'modal agent').level, 'ok', 'Modal is reached from the mini, not through bitcube');
  assert.equal(m.items.find((x) => x.id === 'bitcube').level, 'down');
  assert.match(m.overall.action, /power/);
});

test('specific verdicts: slow TD is a warning, dark ropes name the way back, the live river keeps its controls off', () => {
  let m = run(byName['td-low-fps']);
  assert.equal(m.items.find((x) => x.id === 'touchdesigner').level, 'warning');
  assert.match(m.overall.headline, /slowly/);
  assert.match(m.overall.detail, /4\.1 frames a second/);
  m = run(byName['ropes-dark-on-purpose']);
  assert.match(m.overall.headline, /on purpose/);
  assert.match(m.overall.action, /Ropes → On/);
  assert.equal(m.show.ropes.state, 'dark');
  assert.equal(m.items.find((x) => x.id === 'hub75 panels').level, 'ok');
  m = run(byName['seasons-not-running']);
  assert.equal(m.show.file.kind, 'live');
  assert.equal(m.controls.mode.possible, false);
  assert.match(m.controls.mode.why, /switch to it first/);
  assert.equal(m.controls.ropes.possible, true);
  assert.match(m.overall.action, /Switch now/);
  m = run(byName['river-cam-stale']);
  assert.equal(m.overall.cause, 'river-stale', 'the camera matters more than the file choice');
  assert.match(m.overall.headline, /30 min/);
  assert.match(m.overall.also[0], /live river, not the river's year/);
  assert.equal(m.show.river.live, false);
  m = run(byName['modal-scene-old']);
  assert.match(m.overall.headline, /9 h/);
  assert.match(m.overall.headline, /unaffected/);
  m = run(byName['lights-not-connected']);
  assert.equal(m.items.find((x) => x.id === 'modal agent').level, 'ok', 'resting overnight: a past next tick is normal');
  assert.match(m.items.find((x) => x.id === 'modal agent').summary, /Resting/);
  m = run(byName['just-booted']);
  assert.equal(m.overall.cause, 'coming-up');
  assert.match(m.overall.headline, /6 min ago/);
  assert.equal(m.items.find((x) => x.id === 'modal link').cause, 'coming-up', 'the missing Modal link is part of coming up, not a second problem');
  m = run(byName['gallery-cam-down']);
  assert.match(m.overall.headline, /show itself is unaffected/);
  assert.equal(m.items.find((x) => x.id === 'gallery camera').level, 'down', 'the piece is down even though the show does not need it');
});

test('the show block says what the piece is doing in words', () => {
  const m = run(byName['all-good']);
  assert.deepEqual([m.show.file.kind, m.show.file.label, m.show.season, m.show.intensity.word, m.show.mode.id], ['year', "the river's year", 'spring', 'flowing', 'automatic']);
  assert.equal(m.show.presence.available, false);
  assert.equal(m.show.ropes.state, 'river');
  assert.deepEqual(m.show.ropes.watts, [182, 191]);
  assert.equal(m.show.panels.present, true);
  assert.equal(m.show.scene.animation, 'blooms');
  assert.match(m.show.words, /spring, flowing/);
  assert.equal(m.controls.mode.possible, true);
  assert.equal(m.controls.mode.dynamic.possible, false);
  assert.match(m.controls.mode.dynamic.why, /people counter/);
  for (const k of ['target', 'rules', 'ropes', 'hub75', 'switch', 'bootfile', 'lightsroute']) assert.equal(m.controls[k].possible, true, k);
  const j = run(byName['just-booted']);
  assert.deepEqual([j.show.season, j.show.intensity.word], ['winter', 'stillness']);
  const l = run(byName['lights-not-connected']);
  assert.deepEqual([l.show.mode.id, l.show.target.season, l.show.ropes.state, l.show.panels.present], ['manual', 'summer', 'not-reaching', false]);
});

test('stale never looks OK: a payload the page could not refresh for 5 minutes is unknown', () => {
  const fx = byName['all-good'];
  const m = run(fx, 5 * 60 * 1000);
  assert.equal(m.overall.level, 'unknown');
  assert.equal(m.overall.stale, true);
  assert.match(m.overall.headline, /can't reach mission control/);
  assert.match(m.overall.headline, /5 min/);
  for (const it of m.items) assert.equal(it.stale, true, it.id);
  assert.equal(m.items.find((x) => x.id === 'touchdesigner').level, 'ok', 'items keep their last state');
  for (const c of Object.values(m.controls)) assert.equal(c.possible, false);
  assert.equal(run(fx, PAGE_STALE_S * 1000).overall.level, 'ok', 'up to the limit it is fresh');
  assert.equal(run(fx, PAGE_STALE_S * 1000 + 1000).overall.level, 'unknown');
});

test('stale sources: a source older than three polls turns the verdict unknown, the headline says which and since when', () => {
  const NOW = byName['all-good']._scenario.now;
  const fresh = () => ({ ...clone(byName['all-good'].status), now: NOW });
  let s = fresh(); s.probe.at = NOW - (POLL_S.probe * STALE_FACTOR + 20) * 1000;
  let m = derive(s, NOW + 2000);
  assert.equal(m.overall.level, 'unknown');
  assert.match(m.overall.headline, /hasn't heard from bitcube for 3 min/);
  assert.equal(m.items.find((x) => x.id === 'ropes').stale, true);
  assert.equal(m.items.find((x) => x.id === 'ropes').level, 'ok');
  assert.equal(m.controls.ropes.possible, false);
  s = fresh(); s.bitcube.at = NOW - 60_000;
  m = derive(s, NOW + 2000);
  assert.match(m.overall.headline, /hasn't checked bitcube for 1 min/);
  s = fresh(); s.modal.at = NOW - 300_000;
  m = derive(s, NOW + 2000);
  assert.equal(m.overall.level, 'unknown');
  assert.match(m.overall.headline, /Dave's agent/);
  s = fresh(); s.seasons.at = NOW - 60_000;
  m = derive(s, NOW + 2000);
  assert.match(m.overall.headline, /river's year page/);
  assert.equal(m.controls.mode.possible, false);
  // bitcube down beats stale: the offline verdict is fresh even though the probe error is 400 s old
  m = run(byName['bitcube-offline']);
  assert.equal(m.overall.level, 'down');
  assert.equal(m.overall.stale, false);
  // ages come from the server's clock, so the phone's clock cannot age or freshen anything
  s = fresh(); m = derive(s, NOW - 3_600_000);
  assert.equal(m.overall.level, 'ok');
  assert.equal(m.overall.checked.probe_age_s, 20);
  // no server clock at all: fall back to the ages the server sent
  m = derive({ bitcube: { age_s: 4, value: { online: true } }, seasons: { age_s: 4, value: clone(byName['all-good'].status.seasons.value) },
               modal: { age_s: 9, value: clone(byName['all-good'].status.modal.value) }, probe: { age_s: 200, value: clone(byName['all-good'].status.probe.value) } }, NOW);
  assert.equal(m.overall.level, 'unknown');
  assert.equal(m.overall.checked.probe_age_s, 200);
});

test('nothing known yet is unknown, never down and never ok; a reachable bitcube is not red before its first check', () => {
  const m = run(byName['nothing-known-yet']);
  assert.equal(m.overall.level, 'unknown');
  assert.equal(m.items.find((x) => x.id === 'bitcube').level, 'ok');
  assert.match(m.items.find((x) => x.id === 'bitcube').summary, /full check still to come/);
  assert.ok(m.items.filter((x) => x.level === 'unknown').length >= 13);
  assert.ok(!m.items.some((x) => x.level === 'down'));
  assert.equal(m.controls.switch.possible, false);
  const e = derive({ now: 1 }, 2);
  assert.equal(e.overall.level, 'unknown');
  assert.match(e.overall.headline, /nothing is known yet/);
});

test('right after a restart, TouchDesigner not being up yet is coming up, not down; later it is down', () => {
  const NOW = byName['all-good']._scenario.now;
  const s = { ...clone(byName['all-good'].status), now: NOW };
  s.probe.value.uptime_h = 0.03; s.probe.value.td = { ok: false, error: 'TouchDesigner is not running' }; s.seasons = { at: NOW, error: 'fetch failed' };
  let m = derive(s, NOW + 2000);
  assert.equal(m.overall.level, 'warning');
  assert.equal(m.overall.cause, 'coming-up');
  assert.equal(m.items.find((x) => x.id === 'touchdesigner').level, 'warning');
  s.probe.value.uptime_h = 3;
  m = derive(s, NOW + 2000);
  assert.equal(m.overall.level, 'down');
  assert.equal(m.overall.cause, 'td-off');
  assert.equal(m.controls.ropes.possible, false);
  s.probe.value.td = { ok: false, error: 'restarting on river-local-oct-22-seasons.toe' };
  m = derive(s, NOW + 2000);
  assert.equal(m.overall.level, 'warning');
  assert.match(m.overall.headline, /restarting on the river's year/);
});

test("Dave's agent: a past next tick is normal overnight, a fault after 15 daytime minutes", () => {
  const pdt = (s) => Date.parse(`${s}-07:00`);
  assert.equal(daytimeMinutes(pdt('2026-10-22T23:55:00'), pdt('2026-10-23T02:59:00')), 0);
  assert.equal(Math.round(daytimeMinutes(pdt('2026-10-22T17:59:45'), pdt('2026-10-23T02:59:00'))), 355);
  assert.equal(daytimeMinutes(pdt('2026-10-22T23:55:00'), pdt('2026-10-23T07:20:00')), 20);
  assert.equal(daytimeMinutes(pdt('2026-10-23T13:00:00'), pdt('2026-10-23T13:10:00')), 10);
  assert.equal(daytimeMinutes(pdt('2026-10-23T13:10:00'), pdt('2026-10-23T13:00:00')), 0);
  const NOW = byName['all-good']._scenario.now;
  const s = { ...clone(byName['all-good'].status), now: NOW };
  // 07:20 the next morning: the agent should have resumed at 07:00
  const morning = pdt('2026-10-23T07:20:00');
  s.now = morning; for (const k of ['bitcube', 'seasons', 'modal', 'probe']) s[k].at = morning - 5000;
  s.modal.value.next_tick_epoch = Math.round(pdt('2026-10-22T23:55:00') / 1000); s.modal.value.finished_at = '2026-10-23T06:53:15+00:00';
  let m = derive(s, morning + 2000);
  assert.equal(m.overall.cause, 'modal-stalled');
  s.now = pdt('2026-10-23T07:10:00'); for (const k of ['bitcube', 'seasons', 'modal', 'probe']) s[k].at = s.now - 5000;
  m = derive(s, s.now + 2000);
  assert.equal(m.overall.level, 'ok');
  assert.match(m.items.find((x) => x.id === 'modal agent').summary, /Tick due/);
  // unreachable is a warning; it comes first in the list only when the live river (which shows his scene) runs
  s.modal = { at: s.now - 9000, error: 'fetch failed' };
  m = derive(s, s.now + 2000);
  assert.equal(m.overall.level, 'warning');
  assert.match(m.overall.headline, /unaffected/);
  const live = { ...clone(byName['seasons-not-running'].status), now: NOW };
  live.modal = { at: NOW - 9000, error: 'fetch failed' };
  m = derive(live, NOW + 2000);
  assert.equal(m.overall.cause, 'modal-unreachable');
  assert.match(m.overall.headline, /panels keep his last scene/);
});

test('broken payloads never throw: null status, null sources, no sources, a probe with nothing in it', () => {
  for (const s of [null, undefined, {}, { now: 1 }, { bitcube: null, seasons: null, modal: null, probe: null },
                   { bitcube: { at: 1, value: null }, probe: { at: 1, value: null }, now: 5 },
                   { bitcube: { at: 1, value: { online: true } }, probe: { at: 1, value: { ok: true, td: null } }, now: 5 },
                   { bitcube: { at: 1, value: { online: true } }, probe: { at: 1, value: { ok: true, td: { ok: true, file: 'x.toe', ropes: { status: { error: 'boom' } }, seasons: { error: 'boom' }, river_cam: { running: false } } } }, now: 5 },
                   { bitcube: 'junk', seasons: 42, modal: [], probe: { at: 'soon' }, now: 'never' },
                   { bitcube: { at: 1, value: { online: true } }, modal: { at: 1, value: { ok: true, finished_at: 'garbage', next_tick_epoch: 'x' } }, now: 5 }]) {
    const m = derive(s, 7);
    assert.ok(LEVELS.includes(m.overall.level), JSON.stringify(s));
    assert.ok(m.overall.headline.length > 0);
    assert.equal(m.items.length, IDS.length);
    assert.ok(typeof m.controls.mode.possible === 'boolean');
  }
  const m = derive({ bitcube: { at: 1, value: { online: true } }, probe: { at: 1, value: { ok: true, td: null } }, now: 5 }, 7);
  assert.equal(m.overall.level, 'unknown', 'a check that says nothing about TouchDesigner cannot read as OK');
  assert.equal(derive(null, 7).overall.level, 'unknown');
});

test('controls say why they are not possible, in plain words', () => {
  let m = run(byName['bitcube-offline']);
  for (const [k, c] of Object.entries(m.controls)) { assert.equal(c.possible, false, k); assert.equal(c.why, 'bitcube is offline', k); }
  m = run(byName['td-frozen']);
  assert.equal(m.controls.ropes.why, "TouchDesigner isn't answering");
  assert.equal(m.controls.mode.why, "TouchDesigner isn't answering");
  assert.equal(m.controls.switch.possible, true, 'Switch now is the way out of a frozen TouchDesigner');
  m = run(byName['nothing-known-yet']);
  assert.equal(m.controls.mode.why, "the river's year page hasn't been checked yet");
  assert.equal(m.controls.bootfile.possible, true);
  for (const [, fx] of fixtures) for (const c of Object.values(run(fx).controls)) assert.doesNotMatch(c.why ?? '', JARGON);
});

test('words: durations, intensity, and a page with no jargon anywhere it speaks', () => {
  assert.deepEqual([dur(0), dur(45), dur(72), dur(1800), dur(5399), dur(5400), dur(9 * 3600 + 60), dur(3 * 86400), dur(null)], ['0 s', '45 s', '1 min', '30 min', '90 min', '2 h', '9 h', '3 days', 'a while']);
  assert.deepEqual([0.05, 0.2, 0.46, 0.7, 0.9].map(intensityWord), ['stillness', 'trickle', 'flowing', 'strong', 'torrent']);
  assert.equal(intensityWord(null), null);
  for (const [name, fx] of fixtures) {
    const m = run(fx);
    for (const p of m.problems) { assert.doesNotMatch(p.headline, JARGON, `${name} ${p.id}`); assert.doesNotMatch(p.action ?? '', JARGON, `${name} ${p.id}`); }
    assert.doesNotMatch(m.show.words, JARGON, name);
  }
});

test('model.js runs in the browser: plain ESM with no imports, no Node globals', () => {
  const src = readFileSync(new URL('../public/model.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\b|require\(|\bprocess\.|node:|\bBuffer\b|\b__dirname\b/m);
  assert.match(src, /^export function derive\(/m);
});
