// The System map's words and levels (public/map-words.js): the chain's rows from a last answer, its "since", the advice in
// its sheets, the lost-contact announcement, and the full diagram's live dots (map-live.js) from derive(). Pure functions,
// shared by map.js, map-live.js and these tests; the fixtures are the scenarios the pages are shot in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureMission } from '../lib/fixtures.mjs';
import { derive } from '../public/model.js';
import { shownLevel, rowWord, sinceWords, mapAction, contactNotice, dots, dotLabel, liveLine, DOT_ITEMS } from '../public/map-words.js';

const fm = new FixtureMission({ dir: new URL('./fixtures/', import.meta.url).pathname, stateDir: mkdtempSync(join(tmpdir(), 'fx-')) });
const snap = (name) => fm.snapshot(name);
const SCENARIOS = ['all-good', 'bitcube-offline', 'gallery-cam-down', 'just-booted', 'lights-not-connected', 'modal-scene-old', 'no-internet',
  'nothing-known-yet', 'river-cam-stale', 'ropes-dark-on-purpose', 'seasons-not-running', 'td-frozen', 'td-low-fps'];
const item = (m, id) => m.items.find((x) => x.id === id);
/** The full check (probe) `s` seconds old, as if it had stopped answering. */
function probeAged(s, by) {
  const x = structuredClone(s);
  x.probe.age_s = by; x.probe.at = x.now - by * 1000;
  return x;
}

test('a row from a last answer is never green: grey level, "last answer" in its word (R5 #32)', () => {
  const s = probeAged(snap('all-good'), 200);
  const m = derive(s, s.now + 1000);
  const rec = item(m, 'recorder');
  assert.equal(rec.level, 'ok');
  assert.equal(rec.stale, true);
  assert.equal(shownLevel(rec), 'unknown');
  assert.equal(rowWord(rec), 'OK · last answer');
  // the quick check is fresh: bitcube itself is OK now
  assert.equal(shownLevel(item(m, 'bitcube')), 'ok');
  assert.equal(rowWord(item(m, 'bitcube')), 'OK');
  // contact lost: nothing at all is green
  const lost = derive(snap('all-good'), snap('all-good').now + 36_000);
  for (const it of lost.items) assert.notEqual(shownLevel(it), 'ok', it.id);
  // not there yet stays "Not available yet"; unknown stays Unknown
  const pc = item(derive(snap('all-good'), snap('all-good').now), 'people counter');
  assert.equal(rowWord(pc), 'Not available yet');
  assert.equal(shownLevel(null), 'unknown');
});

test('"since" stops where the item was last seen once it is a last answer, and ticks only while fresh (R5 #33)', () => {
  const it = { id: 'gallery camera', level: 'down', stale: false, age_s: 20 };
  const s = { level: 'down', for_s: 1320, at_least: true };
  assert.equal(sinceWords(s, it, 0), 'Down for over 22 min');
  assert.equal(sinceWords(s, it, 120), 'Down for over 24 min');
  const old = { ...it, stale: true };
  // last seen 20 s into the answer's age: 1300 s, whatever the time since
  for (const e of [0, 40, 55, 600]) assert.equal(sinceWords(s, old, e), 'Down for over 22 min when last seen');
  assert.equal(sinceWords({ ...s, for_s: 10 }, old, 0), '', 'never a duration nobody saw');
  assert.equal(sinceWords(s, { ...it, level: 'ok' }, 0), '', 'never for an OK item');
  assert.equal(sinceWords({ ...s, level: 'warning' }, it, 0), '', 'never from a different level');
  assert.equal(sinceWords(null, it, 0), '');
});

test('the sheets\' advice points at Status, where the controls are: never "below" on the map (R5 #23)', () => {
  assert.equal(mapAction("Start it with Switch to the river's year below (about a minute)."), "Start it with Switch to the river's year on Status (about a minute).");
  assert.equal(mapAction('Raise the panels brightness below.'), 'Raise the panels brightness on Status.');
  assert.equal(mapAction("Look at bitcube's screen over screen sharing and answer the dialog, or press Switch to the river's year (about a minute dark)."),
    "Look at bitcube's screen over screen sharing and answer the dialog, or go to Status and press Switch to the river's year (about a minute dark).");
  assert.equal(mapAction('Press Ropes → On to show the river again; they follow within a few seconds.'), 'Go to Status and press Ropes → On to show the river again; they follow within a few seconds.');
  assert.equal(mapAction("Turn the gallery camera's power off and on again, then call Will."), "Turn the gallery camera's power off and on again, then call Will.");
  assert.equal(mapAction(null), null);
  // every piece of advice in every scenario: no "below", and a control named is found on Status
  for (const name of SCENARIOS) {
    const s = snap(name), m = derive(s, s.now + 1000);
    for (const x of m.items) {
      if (!x.action) continue;
      const a = mapAction(x.action);
      assert.doesNotMatch(a, /\bbelow\b/, `${name} ${x.id}: ${a}`);
      if (/\bpress\b/i.test(x.action)) assert.match(a, /\bon Status\b|\bgo to Status\b/i, `${name} ${x.id}: ${a}`);
    }
  }
});

test('lost contact is said once, and its return once, then the region clears (R5 #16)', () => {
  const say = contactNotice(10_000);
  assert.equal(say(false, 0), '');
  assert.equal(say(true, 31_000), 'No contact with mission control.');
  assert.equal(say(true, 40_000), 'No contact with mission control.');
  assert.equal(say(false, 41_000), 'Contact with mission control is back.');
  assert.equal(say(false, 45_000), 'Contact with mission control is back.');
  assert.equal(say(false, 52_000), '');
  assert.equal(say(false, 60_000), '');
  assert.equal(say(true, 90_000), 'No contact with mission control.');
});

test('the full diagram\'s dots take derive()\'s verdict, never the raw booleans (R5 #34)', () => {
  const at = (name, extra = 1000, s = snap(name)) => dots(s, s.now + extra);
  // td-frozen: TouchDesigner frozen, the ropes not driven, the panels' picture frozen
  const f = at('td-frozen');
  assert.equal(f.bitcube.level, 'down');
  assert.match(f.bitcube.why, /TouchDesigner/);
  for (let i = 1; i <= 20; i++) assert.equal(f[`rope-${String(i).padStart(2, '0')}`].level, 'down', `rope ${i}`);
  assert.equal(f['colorlight-sender'].level, 'warning');
  assert.equal(f['psac10-1'].level, 'ok', 'the box itself answers');
  assert.equal(at('river-cam-stale')['cam-river'].level, 'warning');
  assert.equal(at('ropes-dark-on-purpose')['rope-07'].level, 'warning');
  assert.equal(at('td-low-fps')['rope-15'].level, 'warning');
  assert.equal(at('td-low-fps').bitcube.level, 'warning');
  assert.equal(at('lights-not-connected')['rope-03'].level, 'down');
  assert.equal(at('gallery-cam-down')['cam-gallery'].level, 'down');
  assert.equal(at('no-internet')['public-internet'].level, 'down');
  assert.equal(at('no-internet').starlink.level, 'unknown', 'with no internet the river site cannot be seen');
  assert.equal(at('bitcube-offline').bitcube.level, 'down');
  assert.equal(at('bitcube-offline')['psac10-2'].level, 'unknown');
  assert.equal(at('all-good').bitcube.level, 'ok');
  // a quick check 60 s old: bitcube is not vouched for
  const q = snap('all-good'); q.bitcube.age_s = 60; q.bitcube.at = q.now - 60_000;
  assert.equal(dots(q, q.now + 1000).bitcube.level, 'unknown');
  // a full check 200 s old: nothing it reports is green
  const p = probeAged(snap('all-good'), 200), pd = dots(p, p.now + 1000);
  for (const id of ['rope-01', 'psac10-1', 'colorlight-sender', 'cam-gallery', 'cam-river', 'router-gallery']) assert.equal(pd[id].level, 'unknown', id);
  // contact lost: every dot is not known, the mini's too
  const l = at('all-good', 31_000);
  for (const [id, d] of Object.entries(l)) assert.equal(d.level, 'unknown', id);
  // every dot agrees with its item, in every scenario
  for (const name of SCENARIOS) {
    const s = snap(name), m = derive(s, s.now + 1000), d = dots(s, s.now + 1000);
    for (const [node, ids] of Object.entries(DOT_ITEMS)) {
      if (!d[node] || !ids.length) continue;
      const lv = ids.map((id) => shownLevel(item(m, id)));
      if (lv.length === 1) assert.equal(d[node].level, lv[0], `${name} ${node}`);
      else assert.ok(lv.includes(d[node].level), `${name} ${node}: ${d[node].level} not one of ${lv}`);
      assert.ok(!(d[node].level === 'ok' && lv.some((x) => x !== 'ok')), `${name} ${node} green over a problem`);
    }
  }
  // nothing loaded yet: no dots at all (they keep the documented colours until there is an answer)
  assert.deepEqual(dots(null, Date.now()), {});
});

test('a dot\'s accessible name says the live state first, never the documented "working" alone (R5 #10)', () => {
  const n = { name: 'bitcube', kind: 'computer', status: 'working', verified: 'confirmed' };
  const l = dotLabel(n, { level: 'down', why: 'TouchDesigner: Frozen: a dialog is open' });
  assert.ok(l.startsWith('bitcube, computer: Down now'), l);
  assert.match(l, /TouchDesigner: Frozen/);
  assert.ok(l.indexOf('working') === -1 || l.indexOf('working') > l.indexOf('Down now'), l);
  assert.equal(dotLabel(n, { level: 'unknown', why: '' }), 'bitcube, computer: not known now. Documented as working.');
  assert.match(dotLabel({ ...n, verified: 'unverified' }, { level: 'ok', why: '' }), /^bitcube, computer: OK now\. Documented as working, unverified\.$/);
  assert.equal(dotLabel(n, { level: 'warning', why: 'Running slowly' }), 'bitcube, computer: needs attention now (Running slowly). Documented as working.');
});

test('the live bar says durations in words, never "for 3725 s" (R5 #28)', () => {
  const s = snap('all-good');
  assert.equal(liveLine(null, null), 'no answer from mission control yet');
  assert.equal(liveLine(s, 3_725_000), 'no answer from mission control for 62 min: every dot is not known');
  assert.equal(liveLine(s, 45_000), 'no answer from mission control for 45 s: every dot is not known');
  assert.match(liveLine(s, 2000), /^bitcube checked \d+ s ago$/);
  assert.equal(liveLine(probeAged(s, 250), 2000), 'bitcube last checked 4 min ago: what it reports is not known now');
  const off = snap('bitcube-offline');
  assert.equal(liveLine(off, 2000), "bitcube is offline: what is behind it can't be checked");
  for (const x of [liveLine(s, 3_725_000), liveLine(probeAged(s, 250), 2000)]) assert.doesNotMatch(x, /\d{3,} s\b/);
});
