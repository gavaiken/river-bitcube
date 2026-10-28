// The status model against every scenario fixture: the verdict, each piece's state, plain words, staleness and
// broken payloads. Fixtures are the ground truth (test/fixtures/README.md); DISAGREE lists where the model reads
// the payload differently, on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { derive, dur, daytimeMinutes, intensityWord, seasonOfPhase, contactFor, seasonPace, EXPECT_S, PAGE_STALE_S, POLL_S, STALE_FACTOR } from '../public/model.js';

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
  assert.match(m.overall.action, /Switch to the river.s year/);
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
  assert.match(m.items.find((x) => x.id === 'modal agent').summary, /Update due/);
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
  assert.equal(m.controls.bootfile.possible, false, "what the boot file is isn't known before the full check");
  assert.equal(m.controls.lightsroute.why, "bitcube's full check hasn't run yet");
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
  const full = readFileSync(new URL('../public/model.js', import.meta.url), 'utf8');
  // the one exception: loadRegistry reads shows.json from disk under node (guarded), and fetches /shows.json in a page
  const loader = /^async function loadRegistry\(\) \{[\s\S]*?^\}$/m.exec(full);
  assert.ok(loader && /typeof window === 'undefined'/.test(loader[0]) && /fetch\('\/shows\.json'/.test(loader[0]));
  const src = full.replace(loader[0], '');
  assert.doesNotMatch(src, /^\s*import\b|require\(|\bprocess\.|node:|\bBuffer\b|\b__dirname\b/m);
  assert.match(src, /^export function derive\(/m);
});

test("timeline extensions: the season of a phase, the year's history with seasons, uptime, and who to call per cause", () => {
  assert.deepEqual([0, 0.49, 0.51, 1.12, 2, 3.4, 3.6, 4.2, -0.3].map(seasonOfPhase),
    ['winter', 'winter', 'spring', 'spring', 'summer', 'autumn', 'winter', 'winter', 'winter']);
  assert.equal(seasonOfPhase(null), null);
  assert.equal(seasonOfPhase('1'), null);
  const m = run(byName['all-good']);
  assert.equal(m.show.history.length, 6);
  assert.deepEqual(m.show.history.map((h) => h.season), ['winter', 'winter', 'spring', 'spring', 'spring', 'spring']);
  assert.equal(m.show.history[0].t_ms, 1792749481000);
  assert.equal(m.show.history[5].intensity, 0.464);
  assert.equal(m.show.uptime_s, Math.round(3.1 * 3600 + m.sources.probe.age_s));
  const off = run(byName['bitcube-offline']);
  assert.deepEqual(off.show.history, []);
  assert.equal(off.show.uptime_s, null);
  assert.equal(run(byName['just-booted']).show.history.length, 0);
  // every cause the fixtures produce names a person to call, or deliberately nobody (wait and look again)
  const nobody = new Set(['coming-up', 'not-checked', 'td-restarting', 'unknown']);
  const seen = new Set();
  for (const [name, fx] of fixtures) for (const p of run(fx).problems) {
    seen.add(p.id);
    const c = contactFor(p.id);
    if (nobody.has(p.id)) assert.equal(c, null, `${name} ${p.id}`);
    else assert.ok(c?.name && c?.owns, `${name} ${p.id} has nobody to call`);
  }
  assert.ok(seen.size >= 10, 'the fixtures exercise many causes');
  assert.equal(contactFor('no-such-cause'), null);
  assert.equal(contactFor(null), null);
});

test('the panels, like the ropes, carry a state word and plain words for the page', () => {
  const p = (name) => run(byName[name]).show.panels;
  assert.equal(p('all-good').state, 'river');
  assert.match(p('all-good').words, /show the river at 100 %/);
  assert.equal(p('td-frozen').state, 'frozen');
  assert.match(p('td-frozen').words, /frozen picture/);
  assert.equal(p('lights-not-connected').state, 'no-sender');
  assert.equal(p('bitcube-offline').state, 'unknown');
  assert.equal(p('nothing-known-yet').state, 'unknown');
  assert.equal(p('just-booted').state, 'river', 'TouchDesigner is up with the file open: the panels show it');
  assert.match(p('seasons-not-running').words, /the live river/);
  assert.match(p('river-cam-stale').words, /rain fallback/);
  assert.match(p('ropes-dark-on-purpose').words, /show the river/, 'the panels keep the river while the ropes are dark');
  for (const [name] of fixtures) {
    const x = p(name);
    assert.ok(['unknown', 'no-sender', 'restarting', 'frozen', 'gone', 'no-output', 'off', 'river'].includes(x.state), `${name}: ${x.state}`);
    assert.ok(x.words && x.summary, name);
    assert.doesNotMatch(x.words, JARGON, `${name}: ${x.words}`);
  }
});

test('a stale full check invents no fault: the clips are not judged failing, and "hasn\'t heard from bitcube" heads the band', () => {
  for (const name of ['all-good', 'td-low-fps']) {
    const fx = clone(byName[name]);
    fx.status.probe.at = fx._scenario.now - 600_000;
    delete fx.status.probe.age_s;
    const m = run(fx);
    assert.equal(m.overall.cause, 'probe-stale', `${name}: "${m.overall.headline}"`);
    assert.match(m.overall.headline, /hasn't heard from bitcube for 10 min/);
    assert.equal(m.problems.find((p) => p.id === 'link-failing'), undefined, `${name}: no clips fault from an old check`);
    assert.notEqual(m.items.find((x) => x.id === 'modal link').level, 'down');
  }
  // a Down read from the old check still wins: it was true then and matters most
  const fx = clone(byName['td-frozen']);
  fx.status.probe.at = fx._scenario.now - 600_000; delete fx.status.probe.age_s;
  const m = run(fx);
  assert.equal(m.overall.cause, 'td-frozen');
  assert.equal(m.problems.find((p) => p.id === 'link-failing'), undefined);
});

test('a failing full check says how long it has been failing, not how old its last attempt is', () => {
  const fx = clone(byName['bitcube-offline']);
  fx.status.probe = { at: fx._scenario.now - 20_000, error: "can't reach bitcube over SSH", failing_since: fx._scenario.now - 52 * 60_000 };
  const m = run(fx);
  assert.match(m.overall.detail, /has failed for 52 min/);
  assert.equal(m.sources.probe.failing_s, 52 * 60, "on the server's clock");
});

test('controls stay off while what they change is in use: the ropes during a calibration', () => {
  const fx = clone(byName['all-good']);
  fx.status.probe.value.calibration = { running: true, stage: 'ropes-capture', expected_s: 170, elapsed_s: 20 };
  const m = run(fx);
  assert.equal(m.overall.cause, 'calibrating');
  assert.equal(m.controls.ropes.possible, false);
  assert.match(m.controls.ropes.why, /calibration is running/);
  // the panels (in the picture), the show file (restarts TouchDesigner mid-run) and the lighting port (darkens every rope) too
  for (const c of ['hub75', 'switch', 'lightsroute']) assert.match(m.controls[c].why ?? '', /calibration is running/, c);
  // what doesn't touch the lights stays possible
  assert.equal(m.controls.bootfile.possible, true);
});

test("the advice names the button that is there: 'Restart on the river's year' when it runs, 'Switch to' when another file runs", () => {
  const slow = run(byName['td-low-fps']);
  assert.equal(slow.show.file.kind, 'year');
  assert.match(slow.overall.action, /press Restart on the river's year/);
  assert.doesNotMatch(JSON.stringify(slow), /Switch to the river's year/);
  const live = run(byName['seasons-not-running']);
  assert.match(live.items.find((x) => x.id === 'seasons').action, /Switch to the river's year/);
});

test('a clip log line from yesterday at the same minute is a day old, not seconds: the file\'s own age is the floor', () => {
  const fx = clone(byName['all-good']);
  const g = fx.status.probe.value.modal_link.gallery;
  g.last = '02:58:31 INFO    gallery/video -> media/gallery/video/2026-10-22T09-58-32-197Z.mp4 (50 KB)';
  g.log_age_s = 86_520;                                   // nothing written since yesterday (the 19 Oct relay hang lasted 11 h)
  const m = run(fx);
  assert.notEqual(m.items.find((x) => x.id === 'modal link').level, 'ok', 'clips to Dave are not posting');
  assert.notEqual(m.overall.level, 'ok', 'not "Everything is up"');
});

test('lost contact flips by the unrounded > 30 s rule, in the same second as the header (ui.js watchContact)', () => {
  const fx = byName['all-good'];
  const at = (ms) => derive({ ...fx.status, now: fx._scenario.now }, fx._scenario.now + ms);
  assert.equal(at(30_000).problems.some((p) => p.id === 'page'), false, 'exactly 30 s: not yet');
  assert.equal(at(30_400).problems.some((p) => p.id === 'page'), true, '30.4 s rounds to 30 but is past the rule');
  assert.equal(at(30_400).overall.cause, 'page');
});

test("raw errors never reach the words: a failed full check, a year page's HTTP 500, an unreachable agent (the raw text stays in sources and raw)", () => {
  const RAW = /\b(ssh|probe|exit \d|HTTP|fetch failed)\b/i;
  for (const [err, want] of [["can't reach bitcube over SSH", /couldn't log in to bitcube/], ['probe failed (exit 1)', /couldn't run the check/],
    ['no answer from the probe', /couldn't run the check/], ['bitcube took too long to answer', /didn't answer the check in time/]]) {
    const fx = clone(byName['all-good']);
    fx.status.probe = { at: fx._scenario.now - 20_000, error: err };
    const m = run(fx);
    assert.equal(m.overall.cause, 'check-failed');
    assert.match(m.overall.detail, want);
    assert.match(m.overall.detail, /^[A-Zb]/, 'sentence case (bitcube stays lowercase)');
    for (const x of m.items) { assert.doesNotMatch(x.summary, RAW, x.id); assert.doesNotMatch(x.detail, RAW, `${x.id}: ${x.detail}`); }
    assert.doesNotMatch(m.overall.detail, RAW);
    assert.equal(m.items.find((x) => x.id === 'bitcube').raw, err, 'the raw text is kept for Addresses and links');
  }
  const yp = clone(byName['all-good']);
  yp.status.seasons = { at: yp._scenario.now - 2000, error: 'HTTP 500' };
  let m = run(yp);
  assert.equal(m.overall.cause, 'year-page');
  assert.doesNotMatch(m.overall.detail + m.items.find((x) => x.id === 'seasons').detail, /HTTP/);
  assert.equal(m.sources.seasons.error, 'HTTP 500');
  const md = clone(byName['all-good']);
  md.status.modal = { at: md._scenario.now - 2000, error: 'fetch failed' };
  m = run(md);
  const p = m.problems.find((x) => x.id === 'modal-unreachable');
  assert.match(p.detail, /^The connection failed/);
  assert.doesNotMatch(p.detail, /port/, 'one fault, one explanation: no port for a service on the internet');
});

test('the show file can not be switched again while TouchDesigner restarts, nor from a full check too old to say what runs', () => {
  const fx = clone(byName['all-good']);
  fx.status.probe.value.td = { ok: false, error: 'restarting on river-local-oct-22-seasons.toe' };
  let m = run(fx);
  assert.equal(m.controls.switch.possible, false);
  assert.match(m.controls.switch.why, /restarting/);
  const old = clone(byName['all-good']);
  old.status.probe.at = old._scenario.now - 10 * 60_000;
  m = run(old);
  for (const c of ['switch', 'lightsroute']) assert.match(m.controls[c].why ?? '', /hasn't heard from bitcube for 10 min/, c);
});

test('summaries say what the ropes do, never a measurement; the watts stay in the detail', () => {
  for (const name of ['all-good', 'river-cam-stale', 'gallery-cam-down']) {
    const r = run(byName[name]).items.find((x) => x.id === 'ropes');
    if (r.level !== 'ok') continue;
    assert.doesNotMatch(r.summary, /\bW\b|\(/, `${name}: ${r.summary}`);
    assert.match(r.detail, /\d+ \+ \d+ W/, name);
  }
});

test("an old show file running is Attention with the way back to the river's year, and old files are never offered (D27)", () => {
  const fx = clone(byName['seasons-not-running']);
  fx.status.probe.value.td.file = 'old-river-online-oct-20.toe';
  fx.status.probe.value.show_files = ['river-local-oct-22-seasons.toe', 'river-online-oct-23.toe', 'river-online-oct-20.toe', 'old-river.toe'];
  const m = run(fx);
  assert.deepEqual([m.show.file.kind, m.show.file.label], ['other', 'an old show file']);
  assert.equal(m.overall.cause, 'old-file');
  assert.equal(m.overall.level, 'warning');
  assert.match(m.overall.headline, /^TouchDesigner is showing an old show file, not the river's year/);
  assert.match(m.overall.action, /Switch to the river's year below/);
  assert.equal(contactFor('old-file').name, 'Gavin');
  assert.doesNotMatch(`${m.overall.headline} ${m.overall.detail} ${m.overall.action}`, JARGON);
  assert.deepEqual(m.show.show_files, ['river-local-oct-22-seasons.toe', 'river-online-oct-23.toe'], 'the old names (before and after the rename) are not offered');
  assert.match(m.items.find((x) => x.id === 'seasons').action, /Switch to the river's year/);
  // a bitcube that hasn't pulled the rename still reports the old name: same reading
  fx.status.probe.value.td.file = 'river-online-oct-20.toe';
  assert.equal(run(fx).overall.cause, 'old-file');
});

// ---- round 5 ---------------------------------------------------------------------------------------------------------
const calib = (fx, cal) => { fx.status.probe.value.calibration = { running: true, mode: 'full', dry_run: false, ...cal }; return fx; };

test('during a calibration the ropes (and the panels in their own stages) are in calibration patterns at Attention, never "showing the river" or "dark on purpose" (R5 #17)', () => {
  const fx = calib(clone(byName['all-good']), { stage: 'ropes-capture', expected_s: 170, elapsed_s: 20 });
  let m = run(fx);
  const ropes = () => m.items.find((x) => x.id === 'ropes'), panels = () => m.items.find((x) => x.id === 'hub75 panels');
  assert.equal(m.show.ropes.state, 'calibrating');
  assert.match(m.show.ropes.words, /^the ropes are in calibration patterns for about \d+ min more$/);
  assert.equal(ropes().level, 'warning');
  assert.match(ropes().summary, /^In calibration patterns for about \d+ min more$/);
  assert.equal(ropes().cause, 'calibrating');
  assert.equal(m.show.ropes.summary, ropes().summary);
  assert.doesNotMatch(`${m.show.ropes.words} ${ropes().summary} ${m.show.words}`, /show the river|showing the river|dark on purpose/i);
  assert.equal(m.show.panels.state, 'river', 'the panels are photographed only in their own stages');
  // capture.py sends black between patterns: still calibrating, never "dark on purpose"
  fx.status.probe.value.td.ropes.source = 'black'; fx.status.probe.value.td.ropes.status.source = 'black';
  m = run(fx);
  assert.equal(m.show.ropes.state, 'calibrating');
  assert.equal(m.problems.find((p) => p.id === 'ropes-dark'), undefined);
  // the panel stages: the panels too
  calib(fx, { stage: 'hub75-capture', expected_s: 35, elapsed_s: 210 });
  m = run(fx);
  assert.equal(m.show.panels.state, 'calibrating');
  assert.match(m.show.panels.words, /^the panels are in calibration patterns/);
  assert.equal(panels().level, 'warning');
  assert.equal(panels().cause, 'calibrating');
  assert.match(panels().summary, /^In calibration patterns/);
  assert.equal(m.show.ropes.state, 'calibrating');
  assert.match(m.overall.headline, /^Calibrating the lights: the ropes and the panels are in patterns/);
  assert.doesNotMatch(`${ropes().detail} ${panels().detail} ${m.overall.detail}`, /gallery camera is working/);
  // a dry run touches no lights: the ropes show the river, and the band doesn't say they are in patterns
  calib(fx, { mode: 'dry-run', dry_run: true, stage: 'ropes-capture', expected_s: 170, elapsed_s: 5 });
  fx.status.probe.value.td.ropes.source = 'canvas'; fx.status.probe.value.td.ropes.status.source = 'canvas';
  m = run(fx);
  assert.equal(m.show.ropes.state, 'river');
  assert.equal(ropes().level, 'ok');
  assert.equal(m.overall.cause, 'calibrating');
  assert.doesNotMatch(m.overall.headline, /patterns/);
});

test("the ropes' connection held by another program (10048) says so and calls Gavin; never the cable advice (R5 #20)", () => {
  const fx = clone(byName['all-good']);
  Object.assign(fx.status.probe.value.td.ropes.status, { open: false, retrying: true, error: '[WinError 10048] Only one usage of each socket address is normally permitted' });
  const m = run(fx);
  assert.equal(m.overall.cause, 'sender-taken');
  assert.match(m.overall.headline, /^Another program on bitcube is using the ropes' connection/);
  assert.equal(m.overall.action, "Call Gavin to stop the other lights program (Will's rope lights) on bitcube; the sender picks up by itself once it has stopped.");
  // R6 #21: the studio chat has to refuse this (CLAUDE.md: only with Gavin's OK), so it is never offered
  for (const s of [m.overall.action, m.items.find((x) => x.id === 'ropes').action]) assert.doesNotMatch(s, /studio chat/i, s);
  assert.equal(contactFor(m.overall.cause).name, 'Gavin');
  const r = m.items.find((x) => x.id === 'ropes');
  assert.match(r.summary, /another program/i);
  for (const s of [m.overall.headline, m.overall.detail, m.overall.action, r.summary, r.detail, r.action]) assert.doesNotMatch(s ?? '', /cable|lighting switch|ceiling|10048|WinError/i, s);
  assert.doesNotMatch(m.overall.headline, JARGON);
  // any other sender error names which port, still with the cable advice
  fx.status.probe.value.td.ropes.status.error = 'OSError: something else';
  const o = run(fx);
  assert.equal(o.overall.cause, 'sender');
  assert.match(o.overall.headline, /LIGHTS port/);
  assert.equal(contactFor('sender').name, 'Lilian');
});

test('fallback words read as sentences: "its page answered with an error", "its page didn\'t answer", "couldn\'t log in to bitcube" (R5 #22)', () => {
  const yp = clone(byName['all-good']);
  yp.status.seasons = { at: yp._scenario.now - 2000, error: 'HTTP 500' };
  let m = run(yp);
  assert.equal(m.overall.detail, "Its page answered with an error; the year's controls come back when it answers properly.");
  yp.status.seasons.error = 'fetch failed';
  m = run(yp);
  assert.match(m.overall.detail, /^Its page didn't answer; /);
  const row = m.items.find((x) => x.id === 'seasons');
  assert.doesNotMatch(`${row.detail} ${m.overall.detail}`, /port|until it does/);
  assert.match(row.detail, /its page didn't answer/);
  const cf = clone(byName['all-good']);
  cf.status.probe = { at: cf._scenario.now - 20_000, error: "can't reach bitcube over SSH" };
  m = run(cf);
  assert.equal(m.overall.cause, 'check-failed');
  assert.match(m.overall.detail, /^The check couldn't log in to bitcube/);
  assert.doesNotMatch(m.overall.detail, /couldn't reach bitcube/, "bitcube answers: the check reached it");
});

test('a stale full check keeps the last answer\'s verdict on the clips (greyed), and never says "posting" for an old clip (R5 #31)', () => {
  for (const name of ['no-internet', 'gallery-cam-down', 'river-cam-stale']) {
    const fx = clone(byName[name]);
    const fresh = run(fx);
    fx.status.probe.at -= 200_000; delete fx.status.probe.age_s;
    const m = run(fx);
    assert.equal(m.overall.cause, 'probe-stale', name);
    const link = m.items.find((x) => x.id === 'modal link'), was = fresh.items.find((x) => x.id === 'modal link');
    assert.equal(link.level, was.level, `${name}: clips to Dave keep the last answer's level (${was.summary})`);
    assert.equal(link.stale, true, name);
    for (const it of m.items) assert.doesNotMatch(`${it.summary} ${it.detail}`, /posting/i, `${name} ${it.id}: ${it.summary} / ${it.detail}`);
  }
  // fresh clips from an old check: not failing, and not "posting" either (only that they were fine then is known)
  const ok = clone(byName['all-good']);
  ok.status.probe.at -= 600_000; delete ok.status.probe.age_s;
  const m = run(ok);
  assert.equal(m.items.find((x) => x.id === 'modal link').level, 'ok');
  assert.doesNotMatch(JSON.stringify(m.items), /posting/i);
});

test("the show-file switch waits while TouchDesigner is still starting after bitcube restarted (R5 #35)", () => {
  const NOW = byName['all-good']._scenario.now;
  const s = { ...clone(byName['all-good'].status), now: NOW };
  s.probe.value.uptime_h = 0.05; s.probe.value.td = { ok: false, error: 'TouchDesigner is not running' };
  let m = derive(s, NOW + 2000);
  assert.equal(m.controls.switch.possible, false);
  assert.equal(m.controls.switch.why, 'bitcube is still coming up; wait a minute');   // the band's words (R10 #15)
  // open, first check after the start (frame rate not known yet), bitcube just booted: wait too
  s.probe.value.td = clone(byName['all-good'].status.probe.value.td); s.probe.value.td.fps = null;
  m = derive(s, NOW + 2000);
  assert.equal(m.controls.switch.why, 'bitcube is still coming up; wait a minute');   // the band's words (R10 #15)
  // long after the boot, TouchDesigner not running: the switch is the way to start it
  s.probe.value.uptime_h = 3; s.probe.value.td = { ok: false, error: 'TouchDesigner is not running' };
  m = derive(s, NOW + 2000);
  assert.equal(m.controls.switch.possible, true);
});

test('model sentences carry no ages that freeze while the page ticks: clock times instead (R5 #41)', () => {
  const AGO = /\b\d+ (?:s|min|h|days) ago\b|\bin \d+ (?:s|min|h)\b/;
  for (const name of ['all-good', 'river-cam-stale', 'seasons-not-running', 'no-internet', 'just-booted', 'bitcube-offline']) {
    const m = run(byName[name]);
    for (const it of m.items) for (const k of ['summary', 'detail']) assert.doesNotMatch(it[k] ?? '', AGO, `${name} ${it.id}.${k}: ${it[k]}`);
    for (const p of m.problems) assert.doesNotMatch(p.detail, AGO, `${name} ${p.id}: ${p.detail}`);
  }
  const m = run(byName['all-good']);
  // Dave's agent on schedule: the summary says so, the detail has the clock times (no "Last updated 3 min ago" that freezes)
  assert.equal(m.items.find((x) => x.id === 'modal agent').summary, 'Updating on schedule');
  assert.match(m.items.find((x) => x.id === 'modal agent').detail, /^Last updated at \d\d:\d\d; next update due at \d\d:\d\d/);
  assert.equal(m.items.find((x) => x.id === 'modal link').summary, 'Posting');
  assert.match(m.items.find((x) => x.id === 'modal link').detail, /^Gallery clip at \d\d:\d\d, river clip at \d\d:\d\d/);
  const live = run(byName['seasons-not-running']).items.find((x) => x.id === 'river camera');
  assert.match(live.detail, /^Last frame at \d\d:\d\d/);
});

test("the boot file Start-River.cmd's default reads as the file it opens, and unlisted files never show a .toe name (R5 #19, #27)", () => {
  const fx = clone(byName['all-good']);
  fx.status.probe.value.boot_file = 'Start-River.cmd default';
  let m = run(fx);
  // shows.json's boot_default is the playlist file since 28 Oct (Gavin)
  assert.deepEqual([m.show.boot_file.name, m.show.boot_file.label, m.show.boot_file.default], ['river-all-looks.toe', 'the river (playlist)', true]);
  assert.equal(typeof m.show.boot_file.kind, 'string');
  // (an older probe's "Start-River.cmd default" is shows.json's boot_default; probe.ps1 now reports the file itself)
  // an old file running is Attention with the way back (810b48e), for each of the retired names
  for (const f of ['old-river.toe', 'river-local-oct-18.toe', 'river.toe', 'old-river-online-oct-20.toe']) {
    const o = clone(byName['all-good']); o.status.probe.value.td.file = f; o.status.seasons = { at: o._scenario.now - 2000, error: 'fetch failed' };
    const r = run(o);
    assert.equal(r.overall.cause, 'old-file', f);
    assert.equal(r.overall.level, 'warning', f);
    assert.equal(r.show.file.label, 'an old show file', f);
  }
  // a file mission control doesn't list: no .toe name on the main view (the raw name stays in raw)
  const u = clone(byName['all-good']); u.status.probe.value.td.file = 'river-local-oct-26-seasons.toe'; u.status.probe.value.boot_file = 'river-local-oct-26-seasons.toe';
  m = run(u);
  assert.doesNotMatch(`${m.overall.headline} ${m.overall.detail} ${m.show.file.label} ${m.show.boot_file.label} ${m.show.words}`, /\.toe|\btoe\b/);
  for (const it of m.items) assert.doesNotMatch(`${it.summary} ${it.detail}`, /\.toe/, it.id);
  assert.match(m.items.find((x) => x.id === 'touchdesigner').raw ?? '', /river-local-oct-26-seasons\.toe/);
  // one meaning of "fallback": the rain the live river shows without frames
  for (const [, f] of fixtures) for (const s of [JSON.stringify(run(f).items), JSON.stringify(run(f).show)]) for (const x of s.matchAll(/[^".]*fallback[^".]*/g)) assert.match(x[0], /rain fallback/, x[0]);
});

test("the model's own words: no raw display names on the main view (R5 #28)", () => {
  const fx = clone(byName['all-good']);
  fx.status.probe.value.displays = ['M14'];
  const m = run(fx);
  const p = m.items.find((x) => x.id === 'hub75 panels');
  assert.doesNotMatch(`${p.summary} ${p.detail}`, /M14/);
  assert.match(p.detail, /^bitcube sees only its own small screen/);
  assert.match(p.raw, /M14/, 'the names go to Addresses and links');
});

test("the mode's pace comes from the year-length rule, never a fixed 'one season a minute' (R5 #18)", () => {
  assert.equal(seasonPace(240), 'one season a minute');
  assert.equal(seasonPace(120), 'one season every 30 s');
  assert.equal(seasonPace(60), 'one season every 15 s');
  assert.equal(seasonPace(480), 'one season every 2 min');
  assert.equal(seasonPace(600), 'one season every 2.5 min');
  assert.equal(seasonPace(1800), 'one season every 7.5 min');
  assert.equal(seasonPace(null), null);
  assert.equal(seasonPace('x'), null);
  const fx = clone(byName['all-good']);
  let m = run(fx);
  assert.equal(m.show.mode.words, 'the clock turns the year, one season a minute');
  fx.status.seasons.value.rules.cycle_seconds.value = 600;
  m = run(fx);
  assert.equal(m.show.mode.words, 'the clock turns the year, one season every 2.5 min');
  assert.match(m.items.find((x) => x.id === 'seasons').detail, /^The clock turns the year, one season every 2\.5 min\./);
  // the rules not known (the year only from the full check): no pace is made up
  delete fx.status.seasons.value.rules;
  m = run(fx);
  assert.equal(m.show.mode.words, 'the clock turns the year');
});

test("a calibration's time left is on show.calibration, so a tile can say it without parsing words", () => {
  const fx = calib(clone(byName['all-good']), { stage: 'ropes-capture', expected_s: 170, elapsed_s: 20 });
  let m = run(fx);
  assert.equal(m.show.calibration.dry, false);
  assert.equal(m.show.calibration.stage, 'ropes-capture');
  assert.ok(m.show.calibration.left_s >= 30, String(m.show.calibration.left_s));
  assert.match(m.show.ropes.words, new RegExp(`about ${dur(m.show.calibration.left_s)} more$`));
  assert.equal(run(byName['all-good']).show.calibration, null);
  calib(fx, { mode: 'dry-run', dry_run: true, stage: 'ropes-capture', expected_s: 170, elapsed_s: 5 });
  m = run(fx);
  assert.equal(m.show.calibration.dry, true);
});

test("the usual time of each change is the server's own (lib/applying.mjs EXPECT_S): a page shows 'usually about 1 min' from it", async () => {
  const { EXPECT_S: server } = await import('../lib/applying.mjs');
  assert.deepEqual(EXPECT_S, server);
});

test('R6 #33: one time left for a calibration, aged by its own copy\'s read time and the seconds since the answer, never by the full check\'s age', () => {
  // Lights' newer copy, read 2 s ago, inside a full check 50 s old: 20 s into a 255 s run, 233 s left, not 48 s fewer
  const fx = calib(clone(byName['all-good']), { stage: 'ropes-capture', expected_s: 170, elapsed_s: 20, read_age_s: 2 });
  fx.status.probe.age_s = 50; fx.status.probe.at = fx._scenario.now - 50_000;
  const at = (later) => derive({ ...fx.status, now: fx._scenario.now }, fx._scenario.now + later).show.calibration;
  assert.equal(at(0).left_s, 233);
  assert.equal(at(5000).left_s, 228, 'it counts down between answers, as the Lights card does');
  // read_at on the served clock does the same
  delete fx.status.probe.value.calibration.read_age_s; fx.status.probe.value.calibration.read_at = fx._scenario.now - 2000;
  assert.equal(at(0).left_s, 233);
  // without a read time of its own, the copy is as old as the full check that carried it
  delete fx.status.probe.value.calibration.read_at;
  assert.equal(at(0).left_s, 255 - 20 - 50);
  // the last 45 s are "nearly done" on every page (the Lights card's own words), never a floor of "about 30 s more" for a minute
  calib(fx, { stage: 'hub75-locate', expected_s: 10, elapsed_s: 240, read_age_s: 0 });
  const c = at(0);
  assert.equal(c.left_s, 15);
  assert.equal(c.left_words, 'nearly done');
  const m = derive({ ...fx.status, now: fx._scenario.now }, fx._scenario.now);
  assert.match(m.overall.headline, /nearly done$/);
  assert.equal(m.show.ropes.words, 'the ropes are in calibration patterns, nearly done');
  calib(fx, { stage: 'ropes-capture', expected_s: 170, elapsed_s: 20, read_age_s: 0 });
  assert.equal(at(0).left_words, 'about 4 min more');
  assert.equal(at(500_000).left_s, 0, 'never below nothing');
});
