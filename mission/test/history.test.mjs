// History: transitions only (never one line per poll), since when for every piece and the verdict, what was last done
// and from where, persistence in one JSON-lines file, and plain words for a feed. Fixtures are the scenarios the model
// is tested on (test/fixtures/README.md); a payload is a fixture's status with its own clock, as the server feeds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { History, describeEvent, KEEP_MS, MAX_EVENTS, BODY_MAX, SOURCES } from '../lib/history.mjs';
import { POLL_S, STALE_FACTOR, FILES } from '../public/model.js';

const DIR = new URL('./fixtures/', import.meta.url);
const fixtures = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()
  .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))]));
const names = Object.keys(fixtures);
const clone = (x) => JSON.parse(JSON.stringify(x));
/** The payload as the server feeds it: the fixture's status with the clock it was taken at (so its ages hold). */
const payload = (name) => ({ ...clone(fixtures[name].status), now: fixtures[name]._scenario.now });
const T0 = fixtures['all-good']._scenario.now;
// The live river's show file and its glossary label, whatever model.js calls it this week.
const LIVE = Object.keys(FILES).find((k) => FILES[k].kind === 'live'), LIVE_LABEL = FILES[LIVE].label;
const MIN = 60e3, H = 3600e3;
// Words the team never reads in a feed (the same list as model.test.mjs).
const JARGON = /\b(fps|tcp|ssh|vnc|rtsp|psac10|probe|oserror|art-?net|wmi|http|json|undefined|null|NaN|epoch|toe)\b/i;
const tmp = () => join(mkdtempSync(join(tmpdir(), 'history-')), 'history.jsonl');
const byKind = (evs, kind) => evs.filter((e) => e.kind === kind);
const item = (evs, id) => byKind(evs, 'item').find((e) => e.id === id);
const show = (evs, field) => byKind(evs, 'show').find((e) => e.field === field);
const quietly = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };

/** One plain sentence: sentence case, three words or more, one colon at most, nothing that reads as code. */
function sentence(line, what) {
  assert.equal(typeof line, 'string', what);
  assert.ok(line.length >= 10 && line.length <= 240, `${what}: "${line}" (${line.length} chars)`);
  assert.match(line, /^(?:[A-Z]|bitcube)/, `${what}: sentence case ("${line}")`);
  assert.doesNotMatch(line, JARGON, `${what}: "${line}"`);
  assert.doesNotMatch(line, /:\s*$|: :|  |\[object|\$\{/, `${what}: "${line}"`);
  assert.ok((line.match(/: /g) ?? []).length <= 1, `${what}: one colon at most ("${line}")`);
  assert.ok(line.trim().split(/\s+/).length >= 3, `${what}: "${line}"`);
}

test('all good, then the lights not connected, then all good again: transitions only, each with since when', () => {
  const h = new History({ now: () => T0 });
  const T1 = T0 + 10 * MIN, T2 = T0 + 25 * MIN;

  // The first observation records every known piece once: the verdict, 15 pieces (the muted people counter is not
  // news), and the show's four fields; all from: null (seen for the first time).
  const a = h.observe(payload('all-good'), T0);
  assert.equal(a.length, 20, a.map(describeEvent).join('\n'));
  assert.deepEqual(a[0], { kind: 'overall', t: T0, level: 'ok', cause: null, headline: a[0].headline, stale: false, lost: null, from: null });
  assert.match(a[0].headline, /^Everything is up/);
  assert.equal(byKind(a, 'item').length, 15);
  assert.ok(byKind(a, 'item').every((e) => e.from === null && e.to === 'ok' && e.t === T0 && typeof e.summary === 'string' && e.stale === undefined));
  assert.equal(item(a, 'people counter'), undefined, 'a muted piece (nothing to show) is not news');
  assert.deepEqual(byKind(a, 'show').map((e) => [e.field, e.from, e.to, e.t]),
    [['file', null, 'river-local-oct-22-seasons.toe', T0], ['mode', null, 'automatic', T0], ['season', null, 'spring', T0], ['ropes', null, 'river', T0]]);

  // The lights are not connected: the verdict, the seven pieces that changed, the show's three fields that moved.
  const b = h.observe(payload('lights-not-connected'), T1);
  assert.equal(b.length, 11, b.map(describeEvent).join('\n'));
  assert.deepEqual([b[0].kind, b[0].level, b[0].cause, b[0].stale, b[0].lost, b[0].from, b[0].t],
    ['overall', 'down', 'lights', false, null, { level: 'ok', cause: null, stale: false, lost: null }, T1]);
  assert.match(b[0].headline, /lights aren't connected/);
  for (const [id, to] of [['ropes', 'down'], ['rope box 1', 'down'], ['rope box 2', 'down'], ['hub75 panels', 'down'], ['river camera', 'down'], ['modal link', 'warning'], ['recorder', 'warning']]) {
    const e = item(b, id);
    assert.ok(e, id);
    assert.deepEqual([e.from, e.to, e.t, e.stale], ['ok', to, T1, undefined], id);
  }
  for (const id of ['bitcube', 'touchdesigner', 'seasons', 'modal agent', 'mission control']) assert.equal(item(b, id), undefined, `${id} stayed OK: not news`);
  assert.deepEqual(byKind(b, 'show').map((e) => [e.field, e.from, e.to]), [['mode', 'automatic', 'manual'], ['season', 'spring', 'summer'], ['ropes', 'river', 'not-reaching']]);
  // since: the verdict and the lights since T1; bitcube and the file since at least T0 (already so when first seen)
  assert.deepEqual(h.since('overall', T1 + 5 * MIN), { level: 'down', cause: 'lights', stale: false, since: T1, for_s: 300, at_least: false });
  assert.deepEqual(h.since('ropes', T1 + 5 * MIN), { level: 'down', since: T1, for_s: 300, at_least: false });
  assert.deepEqual(h.since('rope box 2', T1), { level: 'down', since: T1, for_s: 0, at_least: false });
  assert.deepEqual(h.since('bitcube', T1 + 5 * MIN), { level: 'ok', since: T0, for_s: 900, at_least: true });
  assert.deepEqual(h.sinceShow('ropes', T1), { value: 'not-reaching', since: T1, for_s: 0, at_least: false });
  assert.deepEqual(h.sinceShow('file', T1), { value: 'river-local-oct-22-seasons.toe', since: T0, for_s: 600, at_least: true });
  assert.equal(h.since('no such piece', T1), null);
  assert.equal(h.sinceShow('weather', T1), null);

  // All good again: the way back, piece by piece, and since() moves to T2 for what came back only.
  const c = h.observe(payload('all-good'), T2);
  assert.equal(c.length, 11, c.map(describeEvent).join('\n'));
  assert.deepEqual([c[0].kind, c[0].level, c[0].cause, c[0].stale, c[0].from], ['overall', 'ok', null, false, { level: 'down', cause: 'lights', stale: false, lost: null }]);
  for (const id of ['ropes', 'rope box 1', 'rope box 2', 'hub75 panels', 'river camera']) assert.deepEqual([item(c, id).from, item(c, id).to], ['down', 'ok'], id);
  for (const id of ['modal link', 'recorder']) assert.deepEqual([item(c, id).from, item(c, id).to], ['warning', 'ok'], id);
  assert.deepEqual(show(c, 'ropes'), { kind: 'show', t: T2, field: 'ropes', from: 'not-reaching', to: 'river' });
  assert.deepEqual(h.since('overall', T2 + MIN), { level: 'ok', cause: null, stale: false, since: T2, for_s: 60, at_least: false });
  assert.equal(h.since('ropes', T2).since, T2);
  assert.equal(h.since('bitcube', T2).since, T0);
  assert.equal(h.sinceShow('ropes', T2).since, T2);
  assert.deepEqual([h.sinceShow('season', T2).value, h.sinceShow('season', T2).since], ['spring', T2]);

  // summary() is what GET /api/history serves beside the feed
  const s = h.summary(T2 + MIN);
  assert.deepEqual(Object.keys(s).sort(), ['count', 'last_action', 'since']);
  assert.equal(s.count, 42);
  assert.equal(s.last_action, null);
  assert.equal(Object.keys(s.since.items).length, 15);
  assert.deepEqual(s.since.overall, h.since('overall', T2 + MIN));
  assert.deepEqual(s.since.items['rope box 1'], h.since('rope box 1', T2 + MIN));
  assert.deepEqual(Object.keys(s.since.show), ['file', 'mode', 'season', 'ropes']);

  // recent(): newest first, the last recorded first among equal times; kinds and sinceT (strictly after) narrow it
  const r = h.recent({ limit: 100, sinceT: 0 });
  assert.equal(r.length, 42);
  assert.deepEqual([r[0].t, r[0].kind, r[0].field, r[10].kind, r[41].t], [T2, 'show', 'ropes', 'overall', T0]);
  assert.deepEqual(h.recent({ kinds: 'overall', sinceT: 0 }).map((e) => e.level), ['ok', 'down', 'ok']);
  assert.deepEqual(h.recent({ kinds: ['show', 'overall'], sinceT: T1 }).map((e) => e.kind), ['show', 'show', 'show', 'overall']);
  assert.equal(h.recent({ limit: 5, sinceT: 0 }).length, 5);
  assert.equal(h.recent({ limit: 0 }).length, 0);
  assert.equal(h.recent().length, 42, 'the default window is the last keepMs');
});

test('the same payload again adds nothing; wording that moves with the clock adds nothing; a payload without its clock is judged by nowMs', () => {
  const h = new History({ now: () => T0 });
  h.observe(payload('all-good'), T0);
  for (let i = 1; i <= 5; i++) assert.deepEqual(h.observe(payload('all-good'), T0 + i * 5000), [], `poll ${i}`);
  assert.equal(h.summary().count, 20);
  // a newer tick of Dave's agent ("Updating on schedule" either way, its clock times in the detail) is no event
  const p = payload('all-good'); p.modal.value.finished_at = '2026-10-23T09:50:00+00:00';
  assert.deepEqual(h.observe(p, T0 + 30_000), []);
  // /api/status extras (studio, fixture) are ignored
  assert.deepEqual(h.observe({ ...payload('all-good'), studio: { running: false }, fixture: 'all-good' }, T0 + MIN), []);
  // every scenario is quiet with itself
  for (const n of names) { const g = new History({ now: () => T0 }); g.observe(payload(n), T0); assert.deepEqual(g.observe(payload(n), T0 + 5000), [], n); }
  // the real server feeds mission.snapshot() without a `now`: nowMs is then the clock. Shift the fixture to a later
  // moment and it is the same scenario, not a stale one (nowMs is never "a page that could not fetch").
  const later = T0 + 3 * H, shifted = payload('all-good');
  delete shifted.now;
  for (const k of ['bitcube', 'seasons', 'modal', 'probe']) shifted[k].at += later - T0;
  assert.deepEqual(h.observe(shifted, later), [], 'all good at a later time is still all good');
  assert.equal(h.since('overall', later).level, 'ok');
  // a `now` in the payload wins over nowMs: observing a fixture "late" judges it by its own clock
  assert.deepEqual(h.observe(payload('all-good'), T0 + 24 * H), []);
});

test("bitcube offline: one line; the pieces behind it keep their last known state and their since (unknown is not a state)", () => {
  const h = new History({ now: () => T0 });
  h.observe(payload('all-good'), T0);
  const off = h.observe(payload('bitcube-offline'), T0 + MIN);
  assert.deepEqual(off.map((e) => [e.kind, e.level ?? e.to, e.cause ?? e.id]), [['overall', 'down', 'bitcube-offline'], ['item', 'down', 'bitcube']]);
  assert.equal(describeEvent(off[1]), 'bitcube went offline: not reachable from the Mac mini');
  assert.deepEqual(h.since('ropes', T0 + MIN), { level: 'ok', since: T0, for_s: 60, at_least: true }, 'last known, not unknown');
  assert.equal(h.sinceShow('file', T0 + MIN).value, 'river-local-oct-22-seasons.toe');
  assert.deepEqual(h.observe(payload('bitcube-offline'), T0 + 2 * MIN), []);
  const back = h.observe(payload('all-good'), T0 + 3 * MIN);
  assert.deepEqual(back.map((e) => [e.kind, e.level ?? e.to]), [['overall', 'ok'], ['item', 'ok']]);
  assert.equal(describeEvent(back[1]), 'bitcube is back: online');
  assert.equal(h.since('ropes', T0 + 3 * MIN).since, T0, 'the ropes never changed');
  // the server has just started: nothing is known, so nothing is written but the one piece it can see
  const g = new History({ now: () => T0 });
  const first = g.observe(payload('nothing-known-yet'), T0);
  assert.deepEqual(first.map((e) => [e.kind, e.id, e.to]), [['item', 'bitcube', 'ok'], ['item', 'mission control', 'ok']]);
  assert.equal(g.since('overall'), null, 'no verdict yet: no since');
  assert.equal(g.observe(payload('all-good'), T0 + MIN).length, 18, 'the verdict, 13 more pieces, the four show fields');
  assert.deepEqual(g.since('overall', T0 + MIN), { level: 'ok', cause: null, stale: false, since: T0 + MIN, for_s: 0, at_least: true });
});

test("stale: a source going quiet is one 'lost contact' line (stale: true) that does not reset since; coming back says so", () => {
  const h = new History({ now: () => T0 });
  h.observe(payload('all-good'), T0);
  const quiet = payload('all-good'); quiet.probe.at = T0 - (POLL_S.probe * STALE_FACTOR + 20) * 1000;
  const a = h.observe(quiet, T0 + 5 * MIN);
  assert.equal(a.length, 1, a.map(describeEvent).join('\n'));
  assert.deepEqual([a[0].kind, a[0].level, a[0].cause, a[0].stale, a[0].lost, a[0].from], ['overall', 'unknown', 'probe-stale', true, 'bitcube', { level: 'ok', cause: null, stale: false, lost: null }]);
  assert.equal(describeEvent(a[0]), 'Lost contact with bitcube');
  assert.deepEqual(h.since('overall', T0 + 5 * MIN), { level: 'ok', cause: null, stale: true, since: T0, for_s: 300, at_least: true }, 'the show did not change, only our view of it');
  assert.deepEqual(h.observe(quiet, T0 + 6 * MIN), [], 'still quiet: no new line');
  // a piece that changes while its source is quiet: the transition carries stale: true
  const box = clone(quiet); box.probe.value.devices.psac10_1 = false;
  const b = h.observe(box, T0 + 7 * MIN);
  assert.deepEqual([item(b, 'rope box 1').from, item(b, 'rope box 1').to, item(b, 'rope box 1').stale], ['ok', 'down', true]);
  assert.equal(describeEvent(item(b, 'rope box 1')), 'Rope box 1 stopped answering');
  // the band keeps saying the check is old: a warning read from that same old check doesn't head it (model.js staleHead)
  assert.equal(b.find((e) => e.kind === 'overall'), undefined, b.map(describeEvent).join('\n'));
  // back in touch, all good
  const c = h.observe(payload('all-good'), T0 + 10 * MIN);
  assert.deepEqual([c[0].level, c[0].stale, c[0].from.stale], ['ok', false, true]);
  assert.equal(describeEvent(c[0]), "Back in touch with bitcube: everything is up; the river's year is in spring; lights and cameras fine");
  assert.equal(describeEvent(item(c, 'rope box 1')), 'Rope box 1 is back: answers');
  assert.equal(h.since('overall', T0 + 10 * MIN).since, T0, 'the band never left OK as far as anyone could tell: since stands');
  // which source went quiet is named in words
  for (const [patch, who] of [[(p) => { p.bitcube.at = T0 - 60_000; }, 'bitcube'], [(p) => { p.seasons.at = T0 - 60_000; }, "the river's year page"], [(p) => { p.modal.at = T0 - 300_000; }, "Dave's agent"]]) {
    const g = new History({ now: () => T0 });
    g.observe(payload('all-good'), T0);
    const p = payload('all-good'); patch(p);
    const evs = g.observe(p, T0 + MIN);
    assert.equal(evs.length, 1, who);
    assert.deepEqual([evs[0].stale, evs[0].lost, describeEvent(evs[0])], [true, who, `Lost contact with ${who}`]);
    assert.equal(g.since('overall', T0 + MIN).since, T0, who);
  }
});

test('persistence: a new History on the same file knows every state, its since and the last action, and only appends', () => {
  const file = tmp();
  const h = new History({ file, now: () => T0 });
  h.observe(payload('all-good'), T0);
  h.observe(payload('td-frozen'), T0 + 10 * MIN);
  h.action({ action: 'switch', body: { file: 'river-local-oct-22-seasons.toe' }, ok: true, source: 'mission control', t: T0 + 12 * MIN });
  const before = readFileSync(file, 'utf8');
  const lines = before.split('\n').filter(Boolean);
  assert.equal(lines.length, h.summary().count);
  assert.ok(before.endsWith('\n'));
  for (const l of lines) assert.equal(typeof JSON.parse(l).kind, 'string');
  assert.deepEqual(JSON.parse(lines[lines.length - 1]), h.summary().last_action);

  const g = new History({ file, now: () => T0 + 20 * MIN });
  assert.deepEqual(g.summary(T0 + 20 * MIN), h.summary(T0 + 20 * MIN));
  assert.deepEqual(g.since('touchdesigner', T0 + 20 * MIN), { level: 'down', since: T0 + 10 * MIN, for_s: 600, at_least: false });
  assert.deepEqual(g.since('bitcube', T0 + 20 * MIN), { level: 'ok', since: T0, for_s: 1200, at_least: true });
  assert.deepEqual([g.since('overall').level, g.since('overall').cause], ['down', 'td-frozen']);
  assert.equal(g.summary().last_action.action, 'switch');
  assert.deepEqual(g.recent({ limit: 2 }).map((e) => e.kind), ['action', 'show']);
  assert.deepEqual(g.recent({ sinceT: 0, limit: 100 }), h.recent({ sinceT: 0, limit: 100 }));
  // the new History knows the states, so the next poll records only what changed, and the file only grows
  const back = g.observe(payload('all-good'), T0 + 20 * MIN);
  assert.ok(back.length > 0 && back.length < 10, back.map(describeEvent).join('\n'));
  assert.equal(describeEvent(item(back, 'touchdesigner')), "TouchDesigner is back: running the river's year at 60 frames a second");
  assert.deepEqual(g.observe(payload('all-good'), T0 + 21 * MIN), []);
  const after = readFileSync(file, 'utf8');
  assert.ok(after.startsWith(before), 'appended, never rewritten');
  assert.equal(after.split('\n').filter(Boolean).length, lines.length + back.length);
  assert.deepEqual(new History({ file, now: () => T0 + 22 * MIN }).summary(T0 + 22 * MIN), g.summary(T0 + 22 * MIN));
  // in memory only: file null writes nothing and still answers
  assert.equal(new History({ file: null, now: () => T0 }).observe(payload('all-good'), T0).length, 20);
});

test('pruning: past keepMs events go, except the latest per piece (so since() survives a restart); past max the oldest go', () => {
  const file = tmp();
  const h = new History({ file, now: () => T0, keepMs: H });
  h.action({ action: 'ropes', body: { dark: true }, t: T0 - 5 * H });          // old and superseded: goes
  h.observe(payload('all-good'), T0 - 4 * H);                                   // old markers: what has been so since then
  h.action({ action: 'ropes', body: { dark: false }, t: T0 - 3 * H });         // old, but the last thing done: kept
  const fresh = h.observe(payload('ropes-dark-on-purpose'), T0 - 30 * MIN);     // within the window
  assert.equal(fresh.length, 3, fresh.map(describeEvent).join('\n'));           // the verdict, the ropes, the show's ropes
  assert.equal(h.summary().count, 1 + 17 + 3, 'the superseded action and the three superseded old markers are gone');
  assert.equal(h.recent().length, 3, 'the feed shows the window');
  assert.equal(h.recent({ sinceT: 0 }).length, 21, 'asked for, the old markers are there');
  assert.equal(h.summary().last_action.t, T0 - 3 * H);
  assert.deepEqual(h.since('bitcube', T0), { level: 'ok', since: T0 - 4 * H, for_s: 4 * 3600, at_least: true }, 'older than keepMs and still known');
  assert.deepEqual(h.since('ropes', T0), { level: 'warning', since: T0 - 30 * MIN, for_s: 1800, at_least: false });
  assert.equal(readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 25, 'the file keeps everything until it is compacted');
  const g = new History({ file, now: () => T0, keepMs: H });
  assert.deepEqual(g.summary(T0), h.summary(T0));
  assert.equal(g.recent({ sinceT: 0 }).length, 21);
  // a day later the window has moved on: the feed is empty, the states are still known
  const later = new History({ file, now: () => T0 + 24 * H, keepMs: H });
  assert.equal(later.recent().length, 0);
  assert.equal(later.since('ropes', T0 + 24 * H).since, T0 - 30 * MIN);
  assert.equal(later.summary().last_action.t, T0 - 3 * H);
  assert.deepEqual([KEEP_MS, MAX_EVENTS], [48 * H, 5000]);
});

test('the file: a torn last line is skipped and the next event starts a fresh line; past twice max it is compacted; a bad path never throws', () => {
  const file = tmp();
  const good = JSON.stringify({ kind: 'action', t: T0, action: 'ropes', body: { dark: true }, ok: true, note: null, source: 'mission control' });
  writeFileSync(file, `${good}\n{"kind":"item","t":${T0},"id":"bitc`);        // the server died mid-write
  const h = new History({ file, now: () => T0 });
  assert.equal(h.summary().count, 1);
  h.action({ action: 'mode', body: { mode: 'manual' }, t: T0 + MIN });
  const lines = readFileSync(file, 'utf8').split('\n');
  assert.equal(lines.length, 4, 'the good line, the torn one, the new one on its own line, then the newline');
  assert.equal(JSON.parse(lines[2]).action, 'mode');
  assert.equal(new History({ file, now: () => T0 }).summary().count, 2);

  const f2 = tmp();
  const g = new History({ file: f2, now: () => T0, max: 10 });
  for (let i = 1; i <= 30; i++) g.action({ action: 'hub75', body: { brightness: i / 100 }, t: T0 + i * 1000 });
  const n = readFileSync(f2, 'utf8').split('\n').filter(Boolean).length;
  assert.ok(n <= 20 && n >= 11, `${n} lines: compacted once past twice max`);
  assert.equal(g.recent({ sinceT: 0, limit: 100 }).length, 11, 'max events plus the last action');
  assert.equal(g.recent({ sinceT: 0 })[0].body.brightness, 0.3);
  const g2 = new History({ file: f2, now: () => T0, max: 10 });
  assert.equal(g2.summary().count, 11);
  assert.equal(g2.summary().last_action.body.brightness, 0.3);

  quietly(() => {
    const bad = new History({ file: join(file, 'not-a-folder', 'history.jsonl'), now: () => T0 });   // a file is in the way
    assert.equal(bad.observe(payload('all-good'), T0).length, 20, 'recorded in memory although it could not be written');
    assert.equal(bad.action({ action: 'ropes' }).kind, 'action');
    assert.equal(bad.since('bitcube', T0).level, 'ok');
  });
});

test('action(): what was done, from where, whether it worked; the body cut to a feed line; a source is a place, never a person', () => {
  const h = new History({ now: () => T0 });
  const e = h.action({ action: 'ropes', body: { dark: true }, ok: true, source: 'mission control' });
  assert.deepEqual(e, { kind: 'action', t: T0, action: 'ropes', body: { dark: true }, ok: true, note: null, source: 'mission control' });
  assert.equal(h.summary().last_action, e);
  assert.equal(describeEvent(e), 'Turned the ropes dark from mission control');
  const f = h.action({ action: 'switch', body: { file: LIVE }, ok: false, note: "can't reach bitcube over SSH", source: 'studio chat', t: T0 + MIN });
  assert.deepEqual([f.ok, f.note, f.source, f.t], [false, "can't reach bitcube over SSH", 'studio chat', T0 + MIN]);
  assert.equal(describeEvent(f), `Tried to switch TouchDesigner to ${LIVE_LABEL} from the studio chat, but bitcube did not answer`);
  assert.equal(h.summary().last_action, f);
  assert.deepEqual(h.recent({ kinds: 'action' }), [f, e]);
  // the source is where, never who (MD4: the chat is unattributed): anything but the studio chat is mission control
  for (const [given, want] of [['Gavin', 'mission control'], [undefined, 'mission control'], ['studio', 'studio chat'], ['the studio chat', 'studio chat'], [42, 'mission control']]) {
    assert.equal(h.action({ action: 'mode', body: { mode: 'manual' }, source: given }).source, want, String(given));
  }
  assert.deepEqual(SOURCES, ['mission control', 'studio chat']);
  // a big body is cut to a line of JSON: top-level scalars, strings shortened, the rest as counts
  const big = h.action({ action: 'rules', body: { rules: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`rule_${i}`, i])), note: 'x'.repeat(500), list: [1, 2, 3], n: 7, on: true, nothing: null } });
  assert.ok(JSON.stringify(big.body).length <= BODY_MAX, JSON.stringify(big.body));
  assert.deepEqual(big.body, { rules: '{40 keys}', note: 'x'.repeat(60), list: '[3 items]', n: 7, on: true, nothing: null });
  const wide = h.action({ action: 'rules', body: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`a_long_rule_name_${i}`, i])) });
  assert.ok(JSON.stringify(wide.body).length <= BODY_MAX);
  assert.equal(wide.body._more, true);
  // a body JSON cannot hold, odd bodies, long fields: cut, never thrown
  const circ = {}; circ.self = circ;
  assert.equal(h.action({ action: 'x', body: circ }).body, null);
  assert.ok(JSON.stringify(h.action({ action: 'x', body: 'y'.repeat(1000) }).body).length <= BODY_MAX);
  assert.deepEqual(h.action({ action: 'x', body: [1, 2, 3, 4] }).body, [1, 2, 3, 4], 'small enough: kept whole');
  assert.equal(h.action({ action: 'x', body: Array.from({ length: 400 }, (_, i) => i) }).body, '[400 items]');
  assert.equal(h.action({ action: 'x', body: () => 1 }).body, null);
  assert.equal(h.action({ action: 'hub75', body: { brightness: 0.5 } }).body.brightness, 0.5);
  assert.deepEqual([h.action(null).action, h.action('junk').kind, h.action({}).body], ['unknown', 'action', null]);
  assert.equal(h.action({ action: 'x'.repeat(100) }).action.length, 40);
  assert.equal(h.action({ note: 'n'.repeat(300) }).note.length, 200);
  assert.equal(h.action({ action: 'ropes', ok: 'yes' }).ok, true, 'only ok: false is a failure');
});

test('describeEvent: one plain sentence for every kind, in glossary words', () => {
  const h = new History({ now: () => T0 });
  const a = h.observe(payload('all-good'), T0);
  assert.equal(describeEvent(a[0]), "Everything is up: the river's year is in spring; lights and cameras fine");
  assert.equal(describeEvent(item(a, 'bitcube')), 'bitcube is fine: online', 'no age frozen at the time ("up 3 h") beside the feed\'s own');
  assert.equal(describeEvent(item(a, 'touchdesigner')), "TouchDesigner is fine: running the river's year at 60 frames a second");
  assert.equal(describeEvent(item(a, 'seasons')), "The river's year is fine: automatic, spring, flowing");
  assert.equal(describeEvent(item(a, 'modal agent')), "Dave's agent is fine: updating on schedule", 'its summary carries no age that froze ("last updated 3 min ago")');
  assert.equal(describeEvent(show(a, 'file')), "TouchDesigner is showing the river's year");
  assert.equal(describeEvent(show(a, 'mode')), 'The year runs in automatic mode: the clock turns the year by itself'); // its pace depends on the rule, which Recent doesn't keep
  assert.equal(describeEvent(show(a, 'season')), 'The season is spring');
  assert.equal(describeEvent(show(a, 'ropes')), 'The ropes show the river');
  const b = h.observe(payload('lights-not-connected'), T0 + MIN);
  assert.equal(describeEvent(b[0]), "The lights aren't connected: neither rope box answers and bitcube sees no panel sender");
  assert.equal(describeEvent(item(b, 'ropes')), 'The ropes are not reaching the lights: sender retrying, both boxes silent');
  assert.equal(describeEvent(item(b, 'rope box 1')), 'Rope box 1 stopped answering');
  assert.equal(describeEvent(item(b, 'hub75 panels')), 'The panels have no sender: bitcube does not see one');
  assert.equal(describeEvent(item(b, 'river camera')), 'The river camera stopped answering: the river site is down');
  assert.equal(describeEvent(item(b, 'modal link')), "River clips to Dave are failing for a while; gallery fine");
  assert.equal(describeEvent(item(b, 'recorder')), "The river recorder can't reach the river camera");
  assert.equal(describeEvent(show(b, 'mode')), "The year's mode changed to manual: someone is steering the year by hand");
  assert.equal(describeEvent(show(b, 'season')), 'The season turned to summer');
  assert.equal(describeEvent(show(b, 'ropes')), 'The ropes stopped getting the river');
  const c = h.observe(payload('all-good'), T0 + 2 * MIN);
  assert.equal(describeEvent(item(c, 'ropes')), 'The ropes are back: showing the river');
  assert.equal(describeEvent(item(c, 'modal link')), "Clips to Dave is OK again: posting");
  assert.equal(describeEvent(show(c, 'ropes')), 'The ropes show the river again');
  // the other scenarios' first lines
  const first = (name, id) => { const g = new History({ now: () => T0 }); const evs = g.observe(payload(name), T0); return describeEvent(id === 'overall' ? evs[0] : item(evs, id)); };
  assert.equal(first('td-frozen', 'touchdesigner'), 'TouchDesigner froze: not answering');
  assert.equal(first('td-frozen', 'seasons'), "The river's year page stopped answering: TouchDesigner is frozen");
  assert.equal(first('td-frozen', 'hub75 panels'), 'The panels hold a frozen picture');
  assert.equal(first('td-low-fps', 'touchdesigner'), 'TouchDesigner is running slowly: 4 of 60 frames a second');
  assert.equal(first('td-low-fps', 'ropes'), 'The ropes are driven at only 4 frames a second');
  assert.equal(first('ropes-dark-on-purpose', 'ropes'), 'The ropes are dark on purpose: sending black');
  assert.equal(first('seasons-not-running', 'seasons'), "The river's year stopped running: TouchDesigner is showing the live river");
  assert.equal(first('seasons-not-running', 'overall'), "TouchDesigner is showing the live river, not the river's year: the year and its controls are unavailable");
  assert.equal(first('river-cam-stale', 'river camera'), 'The river camera answers, but no frames');      // the age was only true then (round 6 #19)
  assert.equal(first('gallery-cam-down', 'gallery camera'), 'The gallery camera stopped answering');
  assert.equal(first('gallery-cam-down', 'modal link'), "Gallery clips to Dave are failing since 02:43; river fine");
  assert.equal(first('no-internet', 'internet'), 'The internet at Gray Area is down: bitcube cannot reach it');
  assert.equal(first('no-internet', 'river camera'), 'The river camera became unreachable: no internet at Gray Area');
  assert.equal(first('modal-scene-old', 'modal agent'), "Dave's agent hasn't updated");      // no age that was only true then (round 6 #19)
  assert.equal(first('just-booted', 'modal link'), "Clips to Dave hasn't started yet: bitcube just restarted");
  assert.equal(first('bitcube-offline', 'overall'), 'bitcube is offline: nothing behind it can be checked');
  assert.equal(first('nothing-known-yet', 'bitcube'), 'bitcube is fine: reachable; full check still to come');

  // the calibration job: its stages, how it ended, a process gone quiet; progress within a stage is not news
  const all = (calibration, t) => { const p = payload('all-good'); p.probe.value.calibration = calibration; return h.observe(p, t); };
  const cal = (calibration, t) => all(calibration, t).filter((e) => e.kind === 'calibration');     // the band's own line is tested once, below
  let evs = all({ running: true, stage: 'ropes-capture', mode: 'full', ok: null, step: 1, of: 12, expected_s: 170, elapsed_s: 20 }, T0 + 3 * MIN);
  assert.deepEqual(evs.map((e) => e.kind), ['overall', 'calibration'], 'the band turns to Attention: Calibrating, and the job started');
  assert.deepEqual([evs[0].level, evs[0].cause], ['warning', 'calibrating']);
  assert.match(evs[0].headline, /^Calibrating the lights: the ropes are in patterns for about .+ more$/, 'the band said how long was left');
  assert.equal(describeEvent(evs[0]), 'Calibrating the lights: the ropes are in patterns', 'Recent keeps no age that was only true then (round 6 #19)');
  evs = evs.slice(1);
  assert.deepEqual(evs[0], { kind: 'calibration', t: T0 + 3 * MIN, running: true, stage: 'ropes-capture', ok: null, cancelled: false, mode: 'full', error: null, stale: false, from: null });
  assert.equal(describeEvent(evs[0]), 'The calibration started: photographing the ropes');
  assert.deepEqual(all({ running: true, stage: 'ropes-capture', mode: 'full', ok: null, step: 5, of: 12 }, T0 + 4 * MIN), []);
  evs = cal({ running: true, stage: 'ropes-decode', mode: 'full', ok: null }, T0 + 5 * MIN);
  assert.equal(describeEvent(evs[0]), 'The calibration is working out where each rope is');
  evs = cal({ running: false, stage: 'done', mode: 'full', ok: true }, T0 + 6 * MIN);
  assert.equal(describeEvent(evs[0]), 'The calibration finished');
  evs = cal({ running: true, stage: 'ropes-capture', mode: 'dry-run', ok: null }, T0 + 7 * MIN);
  assert.equal(describeEvent(evs[0]), 'A dry-run calibration started: photographing the ropes');
  evs = cal({ running: false, stage: 'ropes-capture', mode: 'dry-run', ok: false, cancelled: true }, T0 + 8 * MIN);
  assert.equal(describeEvent(evs[0]), 'A dry-run calibration was cancelled');
  evs = cal({ running: false, stage: 'hub75-locate', mode: 'full', ok: false, error: 'Traceback (most recent call last): ssh exited 255' }, T0 + 9 * MIN);
  assert.equal(describeEvent(evs[0]), 'The calibration failed');
  assert.equal(evs[0].error, 'Traceback (most recent call last): ssh exited 255', 'the raw error stays on the event for the details');
  evs = cal({ running: true, stage: 'ropes-capture', mode: 'full', ok: null, stale: true }, T0 + 10 * MIN);
  assert.equal(describeEvent(evs[0]), 'The calibration stopped answering: its process is gone');
  assert.deepEqual(all(null, T0 + 11 * MIN), [], 'no progress file (none in 24 h) is not news');

  // actions, from each control, and why one failed in plain words
  const act = (action, body, extra = {}) => describeEvent(h.action({ action, body, ...extra }));
  assert.equal(act('mode', { mode: 'automatic' }), "Set the year's mode to automatic from mission control");
  assert.equal(act('target', { season: 'winter', intensity: 0.2 }), 'Set the target to winter, trickle from mission control');   // the band's words: Target → winter, trickle
  assert.equal(act('rules', { rules: { cycle_seconds: 300 } }), "Changed 1 of the year's rules from mission control");
  assert.equal(act('rules-reset', {}), "Reset the year's rules from mission control");
  assert.equal(act('ropes', {}), 'Turned the ropes on from mission control');
  assert.equal(act('hub75', { brightness: 0.5 }), 'Set the panel brightness to 50 % from mission control');
  assert.equal(act('switch', { file: LIVE }, { source: 'studio chat' }), `Switched TouchDesigner to ${LIVE_LABEL} from the studio chat`);
  assert.equal(act('switch', { file: 'river-oct-30.toe' }), 'Switched TouchDesigner to the show file river-oct-30 from mission control');
  assert.equal(act('bootfile', { file: 'river-local-oct-22-seasons.toe' }), "Set the boot file to the river's year from mission control");
  assert.equal(act('lightsroute', { route: 'router' }), 'Moved the lighting network to the spare router port from mission control');
  assert.equal(act('lightsroute', { route: 'direct' }), "Moved the lighting network to bitcube's LIGHTS port from mission control");
  assert.equal(act('calibrate', { action: 'start', dry_run: true }), 'Started a dry-run calibration from mission control');
  assert.equal(act('calibrate', { action: 'start' }), 'Started a calibration from mission control');
  assert.equal(act('calibrate', { action: 'cancel' }), 'Cancelled the calibration from mission control');
  assert.equal(act('hub75', { brightness: 2 }, { ok: false, note: 'brightness is 0 to 1' }), 'Tried to set the panel brightness to 200 % from mission control, but brightness is 0 to 1');
  assert.equal(act('ropes', { dark: true }, { ok: false, note: 'HTTP 502' }), 'Tried to turn the ropes dark from mission control, but the page did not answer');
  assert.equal(act('mode', { mode: 'manual' }, { ok: false, note: 'bitcube took too long to answer' }), "Tried to set the year's mode to manual from mission control, but it took too long");
  assert.equal(act('mode', { mode: 'manual' }, { ok: false }), "Tried to set the year's mode to manual from mission control, but it failed");
  assert.equal(act('frobnicate', {}), 'Used the "frobnicate" control from mission control');

  // odd input never throws and never reads as code
  assert.equal(describeEvent(null), '');
  assert.equal(describeEvent('x'), '');
  assert.equal(describeEvent({ kind: 'nope' }), 'Something happened');
  assert.equal(describeEvent({ kind: 'overall' }), 'The verdict is unknown');
  assert.equal(describeEvent({ kind: 'item', id: 'x', to: 'down' }), 'X went down');
  assert.equal(describeEvent({ kind: 'item', id: 'ropes', to: 'warning', summary: 'Something odd: a: b: c' }), 'The ropes need attention: something odd; a; b; c');
  assert.equal(describeEvent({ kind: 'show', field: 'file', to: 7 }), 'TouchDesigner is showing a show file');
  assert.equal(describeEvent({ kind: 'show', field: 'ropes', to: 'odd' }), 'The ropes are odd');
  assert.equal(describeEvent({ kind: 'calibration' }), 'The calibration is not running');
  assert.equal(describeEvent({ kind: 'action' }), 'Used the "unknown" control from mission control');
});

test('every transition between any two scenarios reads as a plain sentence, with no jargon', () => {
  let n = 0;
  for (const a of names) for (const b of names) {
    const h = new History({ now: () => T0 });
    const evs = [...h.observe(payload(a), T0), ...h.observe(payload(b), T0 + MIN)];
    for (const e of evs) { sentence(describeEvent(e), `${a} -> ${b}: ${JSON.stringify(e)}`); n++; }
    assert.equal(h.observe(payload(b), T0 + 2 * MIN).length, 0, `${a} -> ${b}: settled`);
  }
  assert.ok(n > 1000, `${n} lines checked`);
});

test('a broken payload never throws, in memory or on disk, and the next good one is understood', () => {
  const file = tmp();
  for (const h of [new History({ now: () => T0 }), new History({ file, now: () => T0 })]) {
    for (const s of [null, undefined, {}, 'junk', 42, [], { now: 1 }, { now: 'never' }, { bitcube: null, seasons: null, modal: null, probe: null },
                     { bitcube: { at: 1, value: null }, probe: { at: 1, value: null }, now: 5 },
                     { bitcube: 'junk', seasons: 42, modal: [], probe: { at: 'soon' }, now: 'never' },
                     { bitcube: { at: 1, value: { online: true } }, probe: { at: 1, value: { ok: true, td: null, calibration: 'soon' } }, now: 5 },
                     { bitcube: { at: 1, value: { online: true } }, probe: { at: 1, value: { ok: true, td: null, calibration: { running: 'yes', stage: 42 } } }, now: 5 },
                     { bitcube: { at: 1, value: { online: true } }, probe: { at: 1, value: { ok: true, td: { ok: true, file: 'x.toe', ropes: { status: { error: 'boom' } }, seasons: { error: 'boom' }, river_cam: { running: false } } } }, now: 5 },
                     { bitcube: { at: 1, value: { online: true } }, modal: { at: 1, value: { ok: true, finished_at: 'garbage', next_tick_epoch: 'x' } }, now: 5 }]) {
      const evs = h.observe(s, T0);
      assert.ok(Array.isArray(evs), JSON.stringify(s));
      for (const e of evs) { assert.equal(typeof e.t, 'number'); assert.equal(typeof describeEvent(e), 'string'); }
    }
    assert.deepEqual(h.observe(payload('all-good'), 'soon').length > 0, true, 'a bad nowMs falls back to the clock');
    assert.equal(h.since('overall').level, 'ok');
    assert.equal(h.since('ropes').level, 'ok');
    assert.equal(h.observe(payload('all-good'), T0 + MIN).length, 0);
    assert.equal(typeof h.summary().count, 'number');
  }
  const g = new History({ file, now: () => T0 });
  assert.equal(g.since('overall').level, 'ok', 'what was written reads back');
});

test('after a two-hour outage, a fault found when contact returns reads as a first sighting ("for over"), never "for 1 min"', async () => {
  const { readFileSync } = await import('node:fs');
  const fx = (n) => { const j = JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8')); return { ...j.status, now: j._scenario.now }; };
  const at = (j, T) => { const d = T - j.now; const c = structuredClone(j); c.now = T; for (const k of ['bitcube', 'seasons', 'modal', 'probe']) if (c[k]?.at) { c[k].at += d; if (c[k].failing_since) c[k].failing_since += d; } return c; };
  let T = 1_792_749_540_000;
  const h = new History({ file: null, now: () => T });
  h.observe(at(fx('all-good'), T), T);
  for (let i = 0; i < 25; i++) { T += 5 * 60e3; h.observe(at(fx('bitcube-offline'), T), T); }
  T += 60e3; h.observe(at(fx('gallery-cam-down'), T), T);
  T += 60e3; h.observe(at(fx('gallery-cam-down'), T), T);
  const g = h.since('gallery camera', T), o = h.since('overall', T);
  assert.equal(g.at_least, true, JSON.stringify(g));
  assert.equal(o.at_least, true, JSON.stringify(o));
  // a fault that begins while everything is watched keeps its exact since
  T += 60e3; h.observe(at(fx('all-good'), T), T);
  T += 60e3; h.observe(at(fx('gallery-cam-down'), T), T);
  assert.equal(h.since('gallery camera', T).at_least, false);
});

test("a new reason at the same level restarts its since: running slowly for 2 h, then Ropes → Dark, is 'Attention for 0 s', not 2 h", () => {
  const h = new History({ now: () => T0 });
  h.observe(payload('td-low-fps'), T0);
  assert.equal(h.since('ropes', T0 + 2 * H).level, 'warning');
  // the same reason with other numbers (4 then 5 frames a second) is no news
  const slower = payload('td-low-fps'); slower.probe.value.td.fps = Number(slower.probe.value.td.fps) + 1;
  assert.equal(item(h.observe(slower, T0 + H), 'ropes'), undefined, 'a number moving inside the same reason');
  const dark = { ...payload('ropes-dark-on-purpose'), now: T0 + 2 * H };
  for (const k of ['bitcube', 'seasons', 'modal', 'probe']) dark[k].at += T0 + 2 * H - fixtures['ropes-dark-on-purpose']._scenario.now;
  const evs = h.observe(dark, T0 + 2 * H);
  const ev = item(evs, 'ropes');
  assert.ok(ev, 'the ropes changed reason: an item event');
  assert.deepEqual([ev.from, ev.to], ['warning', 'warning']);
  const s = h.since('ropes', T0 + 2 * H + 5000);
  assert.equal(s.for_s, 5, 'since the new reason, not since the level began');
  assert.equal(s.at_least, false);
  // a file written before this rule (item events without a reason change) still loads: the reason comes from the summary
  assert.equal(h.summary(T0 + 2 * H).since.items.ropes.for_s, 0);
});

test('never a login in the history: a calibration error carrying an RTSP address is scrubbed; an audit line follows what ran', () => {
  const h = new History({ now: () => T0 });
  const p = payload('all-good');
  p.probe.value.calibration = { running: false, stage: 'ropes-capture', ok: false, error: 'ropes-capture failed (exit 1): Error opening input file rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_main.' };
  const ev = byKind(h.observe(p, T0), 'calibration')[0];
  assert.ok(ev);
  assert.doesNotMatch(JSON.stringify(ev), /NOT-A-REAL-PW|admin:/);
  assert.match(ev.error, /rtsp:\/\/\*\*\*@192\.168\.9\.76/);
  // planControl turns the ropes dark only for a real true, and planCalibrate dry-runs only for a real true: the feed says what ran
  assert.equal(describeEvent(h.action({ action: 'ropes', body: { dark: 'true' } })), 'Turned the ropes on from mission control');
  assert.equal(describeEvent(h.action({ action: 'calibrate', body: { action: 'start', dry_run: 'yes' } })), 'Started a calibration from mission control');
});

test('the same state seen again after a long unseen stretch is a first sighting ("for over"), never the whole stretch', async () => {
  const { UNSEEN_GAP_MS } = await import('../lib/history.mjs');
  // a scenario's status as if every source answered at T (its ages hold)
  const at = (name, T, tweak) => { const j = fixtures[name], c = clone(j.status), d = T - j._scenario.now;
    for (const k of ['bitcube', 'seasons', 'modal', 'probe']) if (c[k]) { if (c[k].at != null) c[k].at += d; if (c[k].failing_since != null) c[k].failing_since += d; }
    if (c.modal?.value?.next_tick_epoch) c.modal.value.next_tick_epoch += d / 1000;
    tweak?.(c); return { ...c, now: T }; };
  // 1. the gallery camera seen down for 9 min, then bitcube offline for 2 h, then the camera down again
  {
    const h = new History({ file: null, now: () => T0 });
    h.observe(at('all-good', T0), T0);
    h.observe(at('gallery-cam-down', T0 + MIN), T0 + MIN);
    h.observe(at('gallery-cam-down', T0 + 10 * MIN), T0 + 10 * MIN);
    for (let k = 11; k <= 130; k += 10) h.observe(at('bitcube-offline', T0 + k * MIN), T0 + k * MIN);
    const back = h.observe(at('gallery-cam-down', T0 + 131 * MIN), T0 + 131 * MIN);
    const g = h.since('gallery camera', T0 + 132 * MIN);
    assert.deepEqual([g.level, g.since, g.for_s, g.at_least], ['down', T0 + 131 * MIN, 60, true], 'for over 1 min, not down for 131 min');
    const ev = item(back, 'gallery camera');
    assert.deepEqual([ev.from, ev.to, ev.gap, ev.still], ['down', 'down', true, true]);
    sentence(describeEvent(ev), 'still down');
    assert.match(describeEvent(ev), /^The gallery camera is still down/);
    assert.equal(h.since('overall', T0 + 132 * MIN).at_least, true);
  }
  // 2. the full check stuck for 2 h (every reading a last answer), then fresh again with the camera still down
  {
    const h = new History({ file: null, now: () => T0 });
    h.observe(at('all-good', T0), T0);
    h.observe(at('gallery-cam-down', T0 + MIN), T0 + MIN);
    for (let k = 5; k <= 125; k += 10) h.observe(at('gallery-cam-down', T0 + k * MIN, (c) => { c.probe.at = T0 + MIN; c.probe.age_s = (k - 1) * 60; }), T0 + k * MIN);
    h.observe(at('gallery-cam-down', T0 + 126 * MIN), T0 + 126 * MIN);
    const g = h.since('gallery camera', T0 + 127 * MIN), o = h.since('overall', T0 + 127 * MIN);
    assert.deepEqual([g.since, g.at_least], [T0 + 126 * MIN, true], `gallery camera: ${JSON.stringify(g)}`);
    assert.deepEqual([o.level, o.since, o.at_least], ['warning', T0 + 126 * MIN, true], `overall: ${JSON.stringify(o)}`);
  }
  // 3. a short blip (under UNSEEN_GAP_MS) changes nothing: the since stands
  {
    const h = new History({ file: null, now: () => T0 });
    h.observe(at('gallery-cam-down', T0), T0);
    h.observe(at('bitcube-offline', T0 + MIN), T0 + MIN);
    const back = h.observe(at('gallery-cam-down', T0 + MIN + UNSEEN_GAP_MS / 2), T0 + MIN + UNSEEN_GAP_MS / 2);
    assert.equal(item(back, 'gallery camera'), undefined);
    assert.equal(h.since('gallery camera', T0 + 10 * MIN).since, T0);
  }
  // 4. a state watched all along keeps its exact since, however long; and after a restart (nothing seen yet in this
  //    process) the since from the file stands, as before
  {
    const file = tmp();
    const h = new History({ file, now: () => T0 });
    for (let k = 0; k <= 180; k += 5) h.observe(at('gallery-cam-down', T0 + k * MIN), T0 + k * MIN);
    assert.deepEqual([h.since('gallery camera', T0 + 180 * MIN).since, h.since('gallery camera', T0 + 180 * MIN).at_least], [T0, true]);
    const again = new History({ file, now: () => T0 + 181 * MIN });
    assert.equal(item(again.observe(at('gallery-cam-down', T0 + 181 * MIN), T0 + 181 * MIN), 'gallery camera'), undefined);
    assert.equal(again.since('gallery camera', T0 + 181 * MIN).since, T0);
  }
});

// ---- round 6 -------------------------------------------------------------------------------------------------------------
test('round 6 #18: a restart on the running file is recorded with its label and reads "Restarted TouchDesigner on …"', () => {
  const h = new History({ now: () => T0 });
  const ev = h.action({ action: 'switch', body: { file: 'river-local-oct-22-seasons.toe' }, label: "the restart on the river's year", source: 'studio chat' });
  assert.equal(ev.label, "the restart on the river's year");
  assert.equal(describeEvent(ev), "Restarted TouchDesigner on the river's year from the studio chat");
  assert.equal(describeEvent(h.action({ action: 'switch', body: { file: 'river-online-oct-23.toe' }, label: 'the switch to the live river' })), 'Switched TouchDesigner to the live river from mission control');
  assert.equal(h.summary().last_action.label, 'the switch to the live river');
});

test('round 6 #19: Recent keeps no ages that were only true at the time, in headlines as in summaries', async () => {
  const { ageless } = await import('../lib/history.mjs');
  const cases = [
    ['Calibrating the lights: the ropes are in patterns for about 36 s more', 'Calibrating the lights: the ropes are in patterns'],
    ["Dave's agent hasn't updated for 9 h (the room is unaffected: the river's year doesn't use its scene)", "Dave's agent hasn't updated (the room is unaffected: the river's year doesn't use its scene)"],
    ['bitcube restarted 6 min ago and is still coming up', 'bitcube restarted and is still coming up'],
    ["Mission control hasn't heard from bitcube for 3 min", "Mission control hasn't heard from bitcube"],
    ['Clips are failing; it has missed 9 h of daytime updates', 'Clips are failing; it has missed daytime updates'],
    ['TouchDesigner is running slowly: 4 of 60 frames a second', 'TouchDesigner is running slowly: 4 of 60 frames a second'],
    ['The clock turns the year, one season every 2.5 min', 'The clock turns the year, one season every 2.5 min'],
  ];
  for (const [s, want] of cases) assert.equal(ageless(s), want, s);
  const ev = { kind: 'overall', t: T0, level: 'warning', cause: 'calibrating', headline: cases[0][0], stale: false, lost: null, from: null };
  assert.equal(describeEvent(ev), 'Calibrating the lights: the ropes are in patterns');
  assert.equal(describeEvent({ kind: 'item', t: T0, id: 'modal agent', from: 'ok', to: 'warning', summary: "Hasn't updated for 9 h" }), "Dave's agent hasn't updated");
});

test('round 6 #40: an action keeps the checked body; a login in a body or a note never reaches the history file or a feed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hist-r6-'));
  const file = join(dir, 'history.jsonl');
  const h = new History({ file, now: () => T0 });
  const ev = h.action({ action: 'mode', body: { mode: 'manual', note: 'rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/x' }, ok: false,
                       note: 'ffmpeg rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/x failed', label: 'rtsp://admin:NOT-A-REAL-PW@h/x' });
  assert.doesNotMatch(JSON.stringify(ev) + readFileSync(file, 'utf8') + describeEvent(ev), /NOT-A-REAL-PW/);
  assert.match(ev.body.note, /rtsp:\/\/\*\*\*@/);
});

test('round 6 #32: a change that got no answer in time reads as "may or may not have happened", never as a failure', () => {
  const h = new History({ now: () => T0 });
  const ev = h.action({ action: 'switch', body: { file: 'river-online-oct-23.toe' }, ok: false, maybe: true, note: 'bitcube took too long to answer' });
  assert.equal(ev.maybe, true);
  assert.equal(describeEvent(ev), 'Tried to switch TouchDesigner to the live river from mission control: no answer in time, so it may or may not have happened');
});
