// The Lights page's words and decisions (public/lights-words.js): the Calibrate checklist and its buttons' reasons, the
// Calibrate block's view (a failed read is not a lost run), "Map in use" from the server on every phone, the run's "last
// heard" note, the state line's next line, the map's words, and the rope numbers' places on the map (round 5 findings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive } from '../public/model.js';
import { calChecklist, startWhy, dryWhy, calView, lostWhy, rebuiltFor, runNote, nextLine, driftWords, resultWords, captureWhen,
  mapMissing, placeLabels, ROOM_CHECK, CAL_QUIET_S, calRead, untimed, stateLive, calLeft, changeSince, stateLevel, applyingNow, CAL_COPY,
  runFine, resultHead, CAL_CTL } from '../public/lights-words.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const model = (name, edit = (s) => s, later = 2000) => { const f = load(name); const s = edit({ ...f.status, now: f._scenario.now }); return derive(s, s.now + later); };
const SPLIT = (h) => { const i = h.search(/[:;]/); return i >= 12 ? [h.slice(0, i), h.slice(i + 1).trim()] : [h, '']; };
const RUN = { running: true, started: 1761200000, updated: 1761200040, stage: 'ropes-capture', mode: 'full', dry_run: false };
const DONE = { running: false, ok: true, started: 1761200000, updated: 1761200255, stage: 'done', mode: 'full', dry_run: false,
  result: { map: 'pixelmap-2026-10-23.json', capture: 'pixelmap-20261023-122417', drift_px: 10.23, ropes_found: Array.from({ length: 20 }, (_, i) => i + 1), ropes_dark: [] } };

test('the Calibrate checklist reads as sentences, sentence case; its reasons stay lowercase for "Not possible now: …" (R5 #29)', () => {
  const ok = calChecklist(model('all-good'));
  assert.deepEqual(ok.map((c) => c.text), ['TouchDesigner answers', 'Both rope boxes answer', 'The gallery camera is reachable']);
  assert.ok(ok.every((c) => c.level === 'ok'));
  assert.match(ROOM_CHECK, /^The room is dark and nobody is in the camera's view \(you check\)$/);
  const lnc = calChecklist(model('lights-not-connected'));
  assert.equal(lnc[1].text, 'Neither rope box is answering');
  assert.equal(lnc[1].why, 'neither rope box is answering');
  const off = calChecklist(model('bitcube-offline'));
  for (const c of off) { assert.equal(c.level, 'unknown'); assert.match(c.text, /^[A-Z].*(hasn't|haven't) been checked yet$/, c.text); }
  for (const c of [...ok, ...lnc, ...off]) assert.match(c.text, /^[A-Z]/, c.text);
});

test('Start is blocked by the model\'s calibrate reason (a run on, a change being applied, TouchDesigner, the camera), then the rope boxes', () => {
  assert.equal(startWhy(null), "this page hasn't heard from mission control yet");
  assert.equal(startWhy(model('all-good')), null);
  assert.equal(startWhy(model('td-frozen')), "TouchDesigner isn't answering");
  assert.equal(startWhy(model('gallery-cam-down')), "the gallery camera isn't reachable");
  assert.equal(startWhy(model('lights-not-connected')), 'neither rope box is answering');   // the checklist's own line
  assert.equal(startWhy(model('bitcube-offline')), 'bitcube is offline');
  const sw = (s) => { s.applying = [{ id: 'a1', action: 'switch', label: 'the switch to the live river', started_at: s.now - 5000, expect_s: 60, blocks: ['switch', 'rebuild', 'calibrate'] }]; return s; };
  assert.equal(startWhy(model('all-good', sw)), 'wait: the switch to the live river is being applied');
  const cal = (s) => { s.probe.value.calibration = { running: true, mode: 'full', stage: 'ropes-capture', expected_s: 170, elapsed_s: 20 }; return s; };
  assert.equal(startWhy(model('all-good', cal)), 'a calibration is already running');
});

test('a dry run (no lights, no camera, nothing on TouchDesigner) is stopped only by contact, bitcube, a change being applied or a run on', () => {
  assert.equal(dryWhy(null), "this page hasn't heard from mission control yet");
  assert.equal(dryWhy(model('all-good')), null);
  assert.equal(dryWhy(model('td-frozen')), null);
  assert.equal(dryWhy(model('gallery-cam-down')), null);
  assert.equal(dryWhy(model('bitcube-offline')), 'bitcube is offline');
  assert.equal(dryWhy(model('all-good', (s) => s, 40_000)), "this page can't reach mission control");
  const sw = (s) => { s.applying = [{ id: 'a1', action: 'rebuild', label: "a rebuild of the river's year", started_at: s.now - 5000, expect_s: 150, blocks: ['calibrate', 'rebuild'] }]; return s; };
  assert.equal(dryWhy(model('all-good', sw)), "wait: a rebuild of the river's year is being applied");
  const cal = (s) => { s.probe.value.calibration = { running: true, mode: 'dry-run', dry_run: true, stage: 'ropes-capture', expected_s: 2, elapsed_s: 1 }; return s; };
  assert.equal(dryWhy(model('all-good', cal)), 'a calibration is already running');
});

test('one failed read of the progress never turns a live run into "interrupted": only bitcube offline or a dead job does (R5 #30)', () => {
  const good = model('all-good');
  assert.equal(lostWhy(RUN, good), null);
  assert.equal(calView({ p: RUN, m: good }).view, 'run');
  // the model is what says bitcube is offline; a failed read alone (the page keeps the last good progress) stays a run
  assert.equal(calView({ p: RUN, m: model('bitcube-offline') }).view, 'lost');
  assert.equal(calView({ p: RUN, m: model('bitcube-offline') }).lost, 'offline');
  assert.equal(calView({ p: { ...RUN, stale: true }, m: good }).lost, 'stale');
  // no contact with mission control: nothing is known about bitcube, so the run (and Stop) stays
  assert.equal(calView({ p: RUN, m: model('all-good', (s) => s, 40_000) }).view, 'run');
  assert.equal(calView({ p: RUN, m: null }).view, 'run');
});

test('OK on a lost run hides only the lost view: the same run\'s result still shows when it ends (R5 #30)', () => {
  const dismissedKeys = new Set([`${RUN.started}~lost`]);
  const dismissed = (k) => dismissedKeys.has(k);
  assert.equal(calView({ p: RUN, m: model('bitcube-offline'), dismissed }).view, 'before');
  assert.equal(calView({ p: RUN, m: model('all-good'), dismissed }).view, 'run');      // bitcube back, the run still on
  assert.equal(calView({ p: DONE, m: model('all-good'), dismissed }).view, 'done');    // and its result
  dismissedKeys.add(String(DONE.started));
  assert.equal(calView({ p: DONE, m: model('all-good'), dismissed }).view, 'before');
});

test('the finished views: stopped, failed, done, in use; an old result is not shown', () => {
  const m = model('all-good');
  assert.equal(calView({ p: { ...DONE, ok: false, cancelled: true, restored: true }, m }).view, 'stopped');
  assert.equal(calView({ p: { ...DONE, ok: false, error: 'x' }, m }).view, 'failed');
  assert.equal(calView({ p: DONE, m }).view, 'done');
  assert.equal(calView({ p: DONE, m, old: true }).view, 'before');
  assert.equal(calView({ p: DONE, m, rebuiltAt: 1761200400_000 }).view, 'inuse');
  assert.equal(calView({ p: { ...DONE, dry_run: true, result: { ...DONE.result, dry_run: true } }, m, rebuiltAt: 1761200400_000 }).view, 'done');
  assert.equal(calView({ p: null, m }).view, 'before');
  assert.notEqual(calView({ p: DONE, m }).key, calView({ p: DONE, m, rebuiltAt: 5 }).key);
});

test('"Map in use" comes from the server\'s last rebuild, the same on every phone: the same map, after the run ended (R5 #37)', () => {
  const at = DONE.updated * 1000 + 200_000;
  assert.equal(rebuiltFor(DONE, { at, map: 'pixelmap-2026-10-23.json', file: 'river-local-oct-22-seasons.toe' }), at);
  assert.equal(rebuiltFor(DONE, null), null);
  assert.equal(rebuiltFor(DONE, { at, map: 'pixelmap-2026-10-18.json' }), null);                       // another map
  assert.equal(rebuiltFor(DONE, { at: DONE.updated * 1000 - 60_000, map: 'pixelmap-2026-10-23.json' }), null);   // before this run wrote it
  assert.equal(rebuiltFor({ ...DONE, ok: false }, { at, map: 'pixelmap-2026-10-23.json' }), null);
  assert.equal(rebuiltFor({ ...DONE, result: { ...DONE.result, dry_run: true } }, { at, map: 'pixelmap-2026-10-23.json' }), null);
  assert.equal(rebuiltFor(RUN, { at, map: 'pixelmap-2026-10-23.json' }), null);
});

test('a run\'s progress: a failed read says so with when bitcube was last heard; 30 s without a good read greys it (R5 #0, #30)', () => {
  assert.deepEqual(runNote({ heardS: 4, failing: false }), { grey: false, text: '' });
  assert.deepEqual(runNote({ heardS: 12, failing: true }), { grey: false, text: "Progress can't be read just now · last heard from bitcube 12 s ago" });
  assert.equal(runNote({ heardS: CAL_QUIET_S, failing: true }).grey, true);
  assert.deepEqual(runNote({ heardS: 95, failing: false }), { grey: true, text: 'Last heard from bitcube 2 min ago' });
});

test('the state line\'s next line: the band\'s cause once (never "bitcube is offline" twice), and during a calibration the way to Stop (R5 #25, #17)', () => {
  assert.equal(nextLine(model('all-good'), 'from bitcube · 20 s ago', SPLIT), null);
  const off = nextLine(model('bitcube-offline'), 'bitcube is offline', SPLIT);
  assert.deepEqual(off, { text: '', href: '/status', link: 'What to do → Status' });
  const frozen = nextLine(model('td-frozen'), 'from bitcube · 20 s ago', SPLIT);
  assert.deepEqual(frozen, { text: 'TouchDesigner is frozen.', href: '/status', link: 'What to do → Status' });
  const cal = (s) => { s.probe.value.calibration = { running: true, mode: 'full', stage: 'ropes-capture', expected_s: 170, elapsed_s: 20 }; return s; };
  const c = nextLine(model('all-good', cal), 'from bitcube · 20 s ago', SPLIT);
  assert.equal(c.href, '#calibrate');
  assert.equal(c.link, 'Progress and Stop → Calibrate');
  assert.equal(c.text, 'Calibrating the lights.');
  assert.equal(nextLine(model('all-good', (s) => s, 40_000), 'x', SPLIT), null);   // lost contact: the line above says so
});

test('the camera\'s movement in plain words with its unit, never "camera drift 10" (R5 #28)', () => {
  assert.equal(driftWords(10.23), 'the camera moved 10 px (fine)');
  assert.equal(driftWords(48.3), 'the camera moved 48 px (too much)');
  assert.equal(driftWords(null), '');
  const w = resultWords(DONE.result);
  assert.equal(w, 'Map made 23 Oct 12:24 · 20 of 20 ropes found · the camera moved 10 px (fine).');
  assert.doesNotMatch(w, /drift/);
  assert.equal(resultWords({ ...DONE.result, ropes_dark: [9, 17], ropes_found: Array.from({ length: 18 }), seen: 2103, hub75_quads: [1] }),
    'Map made 23 Oct 12:24 · 18 of 20 ropes found · ropes 9 and 17 not found (dark) · 2,103 LEDs seen, the rest placed along the rope · the camera moved 10 px (fine) · screen 1 found.');
  assert.deepEqual(captureWhen(null, 'pixelmap-2026-10-18.json'), { day: '20261018', words: '18 Oct' });
});

test('the LED map not loaded is "hasn\'t loaded yet" and asked again, never "no LED map on this mission control" (R5 #1, #38)', () => {
  assert.equal(mapMissing({ loaded: true, map: { file: 'x' }, error: null }), null);
  const loading = mapMissing({ loaded: false, map: null, error: null, waitS: 3 });
  assert.equal(loading.note, 'Loading the LED map…');
  const slow = mapMissing({ loaded: false, map: null, error: null, waitS: 33 });
  assert.equal(slow.note, "The LED map hasn't loaded yet: no answer for 33 s. This page asks again by itself.");
  const failed = mapMissing({ loaded: true, map: null, error: "mission control didn't answer", waitS: 40 });
  assert.equal(failed.prov, "The LED map hasn't loaded yet: mission control didn't answer. This page asks again by itself.");
  for (const x of [loading, slow, failed]) { assert.equal(x.screens, 'Screens: not known yet.'); assert.equal(x.chip, 'Not known yet'); assert.doesNotMatch(x.prov, /No LED map/); }
  const none = mapMissing({ loaded: true, map: null, error: null });
  assert.match(none.prov, /^No LED map yet\. Calibrate to make one\.$/);
  assert.equal(none.screens, 'Screens: not located yet.');
});

test('rope numbers: no number without a leader line sits nearer another rope\'s plug end than its own; none overlap or cover a plug end (R5 #42)', () => {
  const map = JSON.parse(readFileSync(new URL('../../tools/pixelmap/pixelmap-2026-10-23.json', import.meta.url), 'utf8'));
  const ends = Array.from({ length: 20 }, () => null);
  for (const p of map.points) if (p.px === 0) ends[p.rope] = { u: p.u, v: p.v };
  // as lights.js zoomBox draws it: the box around every point (with its margins), one scale both ways
  const FW = 1440, FH = 808, xs = map.points.map((p) => p.u * FW), ys = map.points.map((p) => (1 - p.v) * FH);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const mx = Math.max(40, (x1 - x0) * 0.14), my = Math.max(30, (y1 - y0) * 0.05), myTop = Math.max(60, (y1 - y0) * 0.12), bw = x1 - x0 + 2 * mx, bh = y1 - y0 + my + myTop;
  for (const W of [358, 700, 1000]) {   // a phone, a tablet, a desktop
    const H = Math.round(W / Math.min(FW / FH, Math.max(0.8, bw / bh))), k = Math.min(W / bw, H / bh);
    const cy = (y0 - myTop + y1 + my) / 2;
    const anchors = ends.map((e) => (e ? { x: (e.u * FW - (x0 + x1) / 2) * k + W / 2, y: ((1 - e.v) * FH - cy) * k + H / 2 } : null));
    const widths = anchors.map((_, i) => (String(i + 1).length === 1 ? 17 : 24));
    const out = placeLabels(anchors, widths, { h: 20, W, H });
    for (let i = 0; i < 20; i++) {
      const b = out[i], a = anchors[i];
      assert.ok(b, `rope ${i + 1} placed`);
      const own = Math.hypot(a.x - b.x, a.y - b.y);
      const nearestOther = Math.min(...anchors.filter((q, j) => j !== i).map((q) => Math.hypot(q.x - b.x, q.y - b.y)));
      if (!b.leader) assert.ok(own < nearestOther, `${W}px: rope ${i + 1}'s number is nearer another plug end (${own.toFixed(1)} vs ${nearestOther.toFixed(1)}) without a line`);
      for (let j = 0; j < i; j++) { const c = out[j]; assert.ok(Math.abs(c.x - b.x) >= (c.w + b.w) / 2 || Math.abs(c.y - b.y) >= (c.h + b.h) / 2, `${W}px: ${i + 1} overlaps ${j + 1}`); }
      assert.ok(b.x - b.w / 2 >= 0 && b.x + b.w / 2 <= W && b.y - b.h / 2 >= 0 && b.y + b.h / 2 <= H, `${W}px: ${i + 1} inside the canvas`);
    }
    const covered = out.filter((b) => anchors.some((a) => Math.abs(a.x - b.x) < b.w / 2 && Math.abs(a.y - b.y) < b.h / 2));
    assert.equal(covered.length, 0, `${W}px: a number covers a plug end`);
  }
  // one rope picked out: only its number, still never nearer another plug end without a line
  const lone = placeLabels([{ x: 100, y: 100 }, { x: 100, y: 120 }, { x: 140, y: 100 }], [17, 17, 17], { h: 20, W: 400, H: 400, only: new Set([0]) });
  assert.equal(lone[1], null); assert.equal(lone[2], null);
  assert.ok(lone[0].leader || Math.hypot(lone[0].x - 100, lone[0].y - 100) < Math.min(Math.hypot(lone[0].x - 100, lone[0].y - 120), Math.hypot(lone[0].x - 140, lone[0].y - 100)));
  // a label already drawn (a screen's number) is never covered
  const one = placeLabels([{ x: 100, y: 100 }], [24], { h: 20, W: 400, H: 400, taken: [{ x: 100, y: 115, w: 30, h: 20 }] })[0];
  assert.ok(Math.abs(one.y - 115) >= 20 || Math.abs(one.x - 100) >= 27);
});

test('code review: "map in use" never compares two machines\' clocks when the server names the run it rebuilt', () => {
  const run = { running: false, ok: true, started: 1_800_000_000, updated: 1_800_000_400, result: { map: 'pixelmap-2026-10-25.json' } };
  // bitcube's clock 10 min ahead of the mini's: the rebuild's own time is "before" the run ended
  const rebuilt = { at: (1_800_000_400 - 600) * 1000, map: 'pixelmap-2026-10-25.json', run: 1_800_000_000 };
  assert.equal(rebuiltFor(run, rebuilt), rebuilt.at);
  assert.equal(rebuiltFor({ ...run, started: 1_800_009_000 }, rebuilt), null, 'another run on the same day with the same map name is not it');
});

// ---- round 6 ----------------------------------------------------------------------------------------------------
const CAL = (elapsed = 230) => (s) => { s.probe.value.calibration = { running: true, mode: 'full', stage: 'ropes-capture', expected_s: 170, elapsed_s: elapsed }; return s; };

test('R6 #29: a progress read that is a 2xx but not mission control\'s JSON is a failed read, never "no run"', () => {
  // non-JSON (a cut-off body, a proxy's page): fetchTimed gives body null
  assert.equal(calRead({ ok: true, status: 200, body: null }).good, false);
  // JSON, but not a progress answer: no boolean `running`
  for (const body of [{}, [], 'x', 3, { ok: true }, { running: 'yes' }, { ok: false, error: "Can't read the calibration" }]) {
    const r = calRead({ ok: true, status: 200, body });
    assert.equal(r.good, false, JSON.stringify(body));
    assert.ok(r.error && !/null|undefined|JSON|HTTP/.test(r.error), r.error);
  }
  assert.equal(calRead({ ok: false, status: 503, body: { ok: false, error: "Can't read the calibration: bitcube didn't answer" } }).good, false);
  assert.equal(calRead({ ok: false, status: 502, body: null }).good, false);
  // a good read: a run, a finished (or failed) run, or "no job"
  assert.deepEqual(calRead({ ok: true, status: 200, body: { ...RUN, rebuilt: null } }), { good: true, p: { ...RUN, rebuilt: null }, rebuilt: null });
  const failedRun = { running: false, ok: false, started: 1, error: 'x' };
  assert.equal(calRead({ ok: true, status: 200, body: failedRun }).p, failedRun);
  assert.deepEqual(calRead({ ok: true, status: 200, body: { running: false, none: true } }), { good: true, p: null, rebuilt: undefined });
  // a failed read leaves the run on screen: calView of the last good progress is still the run
  assert.equal(calView({ p: RUN, m: model('all-good') }).view, 'run');
});

test('R6 #8: the state line\'s hidden live region never carries a ticking time', () => {
  assert.equal(untimed('The ropes are in calibration patterns for about 40 s more · the panels show the river at 100 %.'),
    'The ropes are in calibration patterns · the panels show the river at 100 %.');
  assert.equal(untimed('The ropes are in calibration patterns for about 4 min more · the panels are in calibration patterns for about 4 min more.'),
    'The ropes are in calibration patterns · the panels are in calibration patterns.');
  assert.equal(untimed("bitcube restarted 6 min ago and is still coming up"), 'bitcube restarted and is still coming up');
  assert.equal(untimed("Mission control hasn't heard from bitcube for 3 min."), "Mission control hasn't heard from bitcube.");
  assert.equal(untimed('The ropes show the river · the panels show the river at 100 %.'), 'The ropes show the river · the panels show the river at 100 %.');
  // the same live words at every poll of a run: said once, not every 5 s
  const at = (elapsed) => { const m = model('all-good', CAL(elapsed)); return [m.show.ropes.words, stateLive({ words: `${m.show.ropes.words} · ${m.show.panels.words}.` })]; };
  const [w1, said1] = at(180), [w2, said2] = at(185);
  assert.notEqual(w1, w2);              // the words tick ("about 55 s more", then "about 50 s more")
  assert.equal(said1, said2);           // what is said doesn't
  assert.doesNotMatch(said1, /\d+ (s|min)\b/);
  // a change in flight is said once, by its name, without its m:ss
  const live = stateLive({ words: 'The ropes show the river.', applying: [{ label: "the restart on the river's year", line: "Applying: the restart on the river's year · 0:05 · usually about 1 min" }] });
  assert.equal(live, "The ropes show the river. Applying: the restart on the river's year.");
  assert.equal(stateLive({ words: 'The ropes show the river.', lost: true }), 'No contact with mission control. The ropes show the river.');
  assert.equal(stateLive({ words: 'The ropes show the river.', stale: true }), 'Last seen: The ropes show the river.');
});

test('R6 #13: the Calibrate card\'s time left is the model\'s, the same number as the state line, the Status tile and the band', () => {
  for (const [elapsed, later] of [[100, 2000], [190, 9000], [230, 20_000]]) {
    const m = model('all-good', CAL(elapsed), later);
    const t = calLeft({ cal: m.show.calibration, dry: false });
    const n = /about (\d+\s(?:s|min|h)) more/.exec(m.show.ropes.words)?.[1];
    if (n) { assert.equal(t, `About ${n} left`); assert.match(m.overall.headline, new RegExp(`about ${n} more`)); }
    else { assert.match(m.show.ropes.words, /nearly done/); assert.equal(t, 'Nearly done'); }
  }
  assert.equal(calLeft({ cal: null, dry: false }), '');            // the model doesn't know the run (yet): no second guess
  assert.equal(calLeft({ cal: { left_s: 40 }, dry: true }), 'A dry run takes about a minute.');
  // the model's own words when it gives them (the last 45 s are "nearly done" on every page)
  assert.equal(calLeft({ cal: { left_s: 20, left_words: 'nearly done' }, dry: false }), 'Nearly done');
  assert.equal(calLeft({ cal: { left_s: 200, left_words: 'about 3 min more' }, dry: false }), 'About 3 min left');
});

test('R6 #3: while a change that alters the lights is in flight, a reading from before it is never shown green', () => {
  const sw = (startedAgoMs, action = 'switch', label = "the restart on the river's year", expect_s = 60) => (s) => {
    s.applying = [{ id: 'a1', action, label, file: 'river-local-oct-22-seasons.toe', started_at: s.now - startedAgoMs, expect_s, blocks: ['ropes'] }]; return s; };
  const m = model('all-good', sw(5000));
  const age = m.overall.checked.probe_age_s;   // the reading is older than the switch
  assert.ok(age > 7);
  const ch = changeSince(m, age);
  assert.equal(ch?.label, "the restart on the river's year");
  assert.equal(stateLevel({ levels: ['ok', 'ok'], change: ch }), 'unknown');
  assert.equal(stateLevel({ levels: ['ok', 'ok'], change: null }), 'ok');
  assert.equal(stateLevel({ levels: ['warning', 'ok'], change: ch }), 'warning');   // the model knows better than "not known"
  assert.equal(stateLevel({ levels: ['ok', 'down'] }), 'down');
  assert.equal(stateLevel({ levels: ['ok', 'ok'], stale: true }), 'unknown');
  // a reading taken after the change began speaks for itself; a mode change doesn't alter what the lights show
  assert.equal(changeSince(m, 3), null);
  assert.equal(changeSince(model('all-good', sw(5000, 'mode', 'a mode change')), age), null);
  for (const a of ['rebuild', 'ropes', 'hub75', 'lightsroute', 'calibrate']) assert.ok(changeSince(model('all-good', sw(5000, a, 'x')), age), a);
  // the band's quiet line, under the state line: every change in flight but this page's own (its control says it)
  const lines = applyingNow(m);
  assert.equal(lines.length, 1);
  assert.match(lines[0].line, /^Applying: the restart on the river's year · 0:0\d · usually about 1\smin$/);
  assert.equal(lines[0].said, "Applying: the restart on the river's year.");
  assert.deepEqual(applyingNow(m, ['switch']), []);
  const short = applyingNow(model('all-good', sw(1000, 'ropes', 'a ropes change', 15)));
  assert.match(short[0].line, /^Applying: a ropes change(…| · 0:0\d · usually a few seconds)$/);
});

test('R6 #22, #24: Calibrate says the ropes go back to what they showed before, never "back to the river"; no fragments', () => {
  const all = [CAL_COPY.stopBefore, CAL_COPY.stopped, CAL_COPY.restored, runFine({ started: '21:14', cam: 'gallery', dry: false })];
  for (const t of all) { assert.doesNotMatch(t, /back (to|on) the river/, t); assert.match(t, /what they showed before/, t); }
  assert.equal(runFine({ started: '21:14', cam: 'gallery', dry: false }),
    'Started 21:14, using the gallery camera. When it ends, the ropes go back to what they showed before, by themselves.');
  assert.equal(runFine({ started: '21:14', cam: null, dry: false }), 'Started 21:14. When it ends, the ropes go back to what they showed before, by themselves.');
  // a dry run touches no lights and no camera
  assert.equal(runFine({ started: '21:14', cam: 'gallery', dry: true }), 'Started 21:14. The lights stay as they are.');
  // the result's heading isn't the first words of its own line ("Map made" over "Map made 23 Oct …")
  assert.equal(resultHead(false), 'New LED map');
  assert.doesNotMatch(resultWords(DONE.result), new RegExp(`^${resultHead(false)}`));
  assert.equal(resultHead(true), 'Dry run finished');
});

test('R6: Lights\' controls take ui.js\'s words for applying ("Applying: <what>…"), never their own', () => {
  for (const [k, c] of Object.entries(CAL_CTL)) {
    assert.equal(c.pending, undefined, k);
    assert.match(c.what, /^(the|a) [a-z]/, k);
  }
  assert.equal(CAL_CTL.start.what, 'the start of a calibration');   // lib/applying.mjs's label: one name on every phone
  assert.equal(CAL_CTL.rebuild.what, "a rebuild of the river's year");
});
