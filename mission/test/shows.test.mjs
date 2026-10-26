// The show registry in mission control (shows.json, docs/shows.md): what a switch and Set as default offer, the preview card,
// Back to default, and the What's showing card on Status. npm test (test/run.mjs) adds the fixtures' test visualization
// (fixtures/_shows.extra.json) to the registry, so viz-running reads as a listed show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, FILES, REGISTRY, showCard, BOOT_DEFAULT_FILE } from '../public/model.js';
import { planControl, SWITCH_FILES, BOOT_FILES, REBUILD_FILES } from '../lib/mission.mjs';
import { showCardHTML, firstSentence, kindWords, switchWords } from '../public/status-words.js';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const run = (f) => derive({ ...f.status, now: f._scenario.now }, f._scenario.now);
const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe', TEMPLATE = 'river-baseline-template.toe', VIZ = 'river-fixture-fireflies.toe';
const REAL = JSON.parse(readFileSync(new URL('../../shows.json', import.meta.url), 'utf8'));

test('the registry mission control reads is shows.json (plus the test viz under npm test)', () => {
  assert.equal(BOOT_DEFAULT_FILE, REAL.boot_default);
  for (const s of REAL.shows) assert.ok(REGISTRY.shows.some((x) => x.file === s.file), s.file);
  assert.ok(!REAL.shows.some((x) => x.file === VIZ), 'the test viz is never in the real registry');
  assert.equal(FILES[YEAR].kind, 'year');
  assert.equal(FILES[LIVE].kind, 'live');
  assert.equal(FILES[TEMPLATE].kind, 'other');
  assert.equal(FILES[TEMPLATE].label, 'Baseline template');
  assert.equal(FILES['old-river.toe'].offered, false, 'retired files are named but never offered');
});

test('a switch or Set as default: any offered show; anything else is refused', () => {
  for (const f of [YEAR, LIVE, TEMPLATE, VIZ]) {
    assert.ok(SWITCH_FILES.includes(f) && BOOT_FILES.includes(f), f);
    assert.equal(planControl('switch', { file: f }).args, `-Action switch -BootFile ${f}`);
    assert.equal(planControl('bootfile', { file: f }).args, `-Action bootfile -BootFile ${f}`, 'any offered show may be the default');
  }
  for (const f of ['old-river.toe', 'evil.toe; rm -rf', 'nope.toe', '../x.toe']) {
    assert.throws(() => planControl('switch', { file: f }), (e) => e.status === 400, f);
    assert.throws(() => planControl('bootfile', { file: f }), (e) => e.status === 400, f);
  }
  assert.deepEqual(REBUILD_FILES, [YEAR], 'a rebuild only bakes the river\'s year');
});

test('the preview card: title, kind, description, inputs, who made it, who edited it last, the last change, the default', () => {
  const c = showCard(VIZ);
  assert.deepEqual([c.title, c.kind, c.created_by, c.updated_by, c.updated, c.last_change], ['Fireflies (test viz)', 'viz', 'will', 'will', '2026-10-26', 'Slower drift; fewer lights at once']);
  assert.equal(showCard('old-river.toe'), null);
  const h = showCardHTML(VIZ, { showing: true, isDefault: false });
  for (const want of ['Fireflies (test viz)', 'Visualization', 'Showing', 'river camera (recorded clip as fallback) · gallery camera', 'Will, 26 Oct 2026', 'Slower drift; fewer lights at once', '<dt>Default</dt><dd>No</dd>']) assert.ok(h.includes(want), want);
  assert.ok(!h.includes('tag def'), 'not the default: no Default mark');
  const y = showCardHTML(YEAR, { isDefault: true });
  assert.ok(y.includes('<span class="tag def">Default</span>') && y.includes('Yes: it opens when bitcube restarts'));
  assert.ok(showCardHTML(YEAR).includes("The river&#39;s year"), 'escaped');
  assert.equal(firstSentence('One. Two.'), 'One.');
  assert.deepEqual(['show', 'template', 'viz', undefined].map(kindWords), ['Show', 'Template', 'Visualization', 'Show file']);
});

test("What's showing, for the three kinds of show: the year, the live river, a new viz (fixtures)", () => {
  // the river's year, the default: nothing to go back to
  let m = run(fx('all-good'));
  assert.equal(m.show.file.name, YEAR);
  assert.deepEqual(m.show.show_files, [YEAR, LIVE]);
  assert.equal(m.show.back_to_boot, null);
  assert.ok(m.show.season, 'the year has its season');
  // the live river: Back to default (the river's year); the default stays
  m = run(fx('seasons-not-running'));
  assert.deepEqual(m.show.back_to_boot, { file: YEAR, label: "the river's year" });
  assert.equal(m.show.boot_file.name, YEAR);
  assert.equal(m.show.season, null);
  // a new visualization from the registry: chosen on purpose, so all is well; no year; Back to default
  m = run(fx('viz-running'));
  assert.equal(m.show.file.name, VIZ);
  assert.equal(m.show.file.label, 'Fireflies (test viz)');
  assert.deepEqual([m.overall.level, m.overall.headline], ['ok', 'Everything is up: Fireflies (test viz) is showing; lights and cameras fine']);
  assert.equal(m.items.find((x) => x.id === 'seasons').level, 'ok');
  assert.deepEqual(m.show.show_files, [YEAR, LIVE, TEMPLATE, VIZ]);
  assert.deepEqual(m.show.back_to_boot, { file: YEAR, label: "the river's year" });
  assert.equal(m.show.season, null);
  assert.ok(m.show.ropes && m.show.panels, 'the ropes and panels are there for every show');
  assert.match(switchWords(YEAR, VIZ, m.show.boot_file).title, /^Switch to the river's year now\?$/);
});

test("Status lays it out: the verdict, What's showing, then the show's own panel (the seasons only while the year runs)", () => {
  const html = readFileSync(new URL('../public/status.html', import.meta.url), 'utf8');
  const band = html.indexOf('id="band"'), showing = html.indexOf('id="showing"'), now = html.indexOf('class="card now"');
  assert.ok(band > 0 && band < showing && showing < now, 'band, then What\'s showing, then the panel');
  const js = readFileSync(new URL('../public/status.js', import.meta.url), 'utf8');
  for (const want of ["What's showing", '>Change</button>', 'Back to default', "'Set as default'", "Change what's showing", 'Back to the list',
                      "case 'show-list': openShowList(); break;", "case 'show-card': openShowCard(b.dataset.file); break;", "setHTML($('#showing'), m ? showingHTML(m) : '');"]) {
    assert.ok(js.includes(want), want);
  }
  // the seasons strip only for the river's year: the generic panel otherwise, with the same tiles and still
  const now_ = js.slice(js.indexOf('function nowHTML(m)'), js.indexOf('/** A tile.'));
  assert.ok(now_.includes("} else if (s.file?.kind === 'year') {") && now_.includes('<div class="generic-row">'));
  assert.equal((now_.match(/class="strip[ "]/g) ?? []).length, 2, 'two strips: the running year, and the year whose page is not answering');
  assert.ok(now_.includes('${ropesTile(m)}${panelsTile(m)}${roomHTML(m)}'));
  assert.ok(!js.includes('switch-now'));
  // the default's words in the UI; a switch never says it changes it
  assert.doesNotMatch(js, /also opens at boot|show-file switch sets it too/);
});
