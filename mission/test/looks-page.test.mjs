// The Looks page's words (public/looks-words.js; docs/mission-ui.md "Looks page"): what shows now, the playlist rows and their edits,
// each look's section, the inputs card; the old file (river-looks.toe) shown with the file's default playlist; the page is served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from '../public/model.js';
import { pageView, editPlaylist, rowWords, lookInfo, inputsWords, usedLines, settingsWords, valueWords, PLAYLIST_ONLY, SEASONS_PAGE } from '../public/looks-words.js';
import { DEFAULT_PLAYLIST } from '../public/looks.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
const run = (name) => { const f = fx(name); return derive({ ...f.status, now: f._scenario.now }, f._scenario.now + 2000); };

test('all-looks-auto: now, the playlist from bitcube, five sections, the inputs and what the look did', () => {
  const v = pageView(run('all-looks-auto'));
  assert.deepEqual([v.running, v.allLooks, v.why, v.applyWhy], [true, true, null, null]);
  assert.deepEqual([v.now.title, v.now.mode, v.now.line, v.now.fading], ['The remembered river', 'Playing the playlist (auto)', '1 of 3 · loop 3 of 4', null]);
  assert.deepEqual(v.playlist.rows.map((r) => `${r.title} ${r.words}`), ['The remembered river for 4 loops', 'Fill my cup (simple) for 1 cycle', "The river's year for 10 minutes"]);
  assert.deepEqual([v.playlist.source, v.playlist.changed, v.playlist.note], ['bitcube', false, 'The playlist bitcube plays.']);
  assert.deepEqual(v.listed, ['remembered', 'fill-simple', 'fill-configurable', 'seasons', 'modal']);
  assert.deepEqual(v.sections.map((s) => [s.look, s.showing]), v.listed.map((l) => [l, l === 'remembered']));
  assert.match(v.sections[0].description, /Dry Creek/, "the registry entry's words (the fixtures' _shows.extra.json)");
  const i = v.inputs;
  assert.deepEqual([i.dave.old, i.dave.age, i.river.old, i.river.lines[0].words], [false, 'answered 4 min ago', false, 'the live river camera']);
  assert.deepEqual(i.room.lines.map((l) => l.words), ['3 (usually 2.1)', 'by ropes 7, 8 for 12 s']);
  assert.equal(i.used.title, 'What the remembered river did with them');
  assert.deepEqual(i.used.lines.find((l) => l.key === 'Knobs'), { key: 'Knobs', words: 'Speed 0.55, turbulence 0.36' });
});

test('drafts: edits stay in bounds; the body is sent only for looks the file has; amber inputs', () => {
  const m = run('all-looks-auto'), v = pageView(m);
  const list = v.playlist.rows.map((r) => ({ look: r.look, for: { [r.unit]: r.n } }));
  let d = editPlaylist(list, { op: 'more', i: 0 });
  assert.equal(d[0].for.loops, 5);
  d = editPlaylist([{ look: 'remembered', for: { loops: 20 } }], { op: 'more', i: 0 });
  assert.equal(d[0].for.loops, 20);
  assert.equal(editPlaylist([{ look: 'seasons', for: { minutes: 1 } }], { op: 'less', i: 0 })[0].for.minutes, 1);
  assert.deepEqual(editPlaylist(list, { op: 'down', i: 0 }).map((e) => e.look), ['fill-simple', 'remembered', 'seasons']);
  assert.deepEqual(editPlaylist(list, { op: 'up', i: 0 }).map((e) => e.look), ['remembered', 'fill-simple', 'seasons']);
  assert.equal(editPlaylist([list[0]], { op: 'remove', i: 0 }).length, 1, 'never empty');
  assert.deepEqual(editPlaylist(list, { op: 'add', look: 'modal' }).at(-1), { look: 'modal', for: { minutes: 10 } });
  assert.equal(editPlaylist(Array(12).fill(list[0]), { op: 'add', look: 'modal' }).length, 12);
  const dv = pageView(m, editPlaylist(list, { op: 'remove', i: 2 }));
  assert.deepEqual([dv.playlist.source, dv.playlist.changed, dv.playlist.body.playlist.length], ['draft', true, 2]);
  assert.deepEqual(rowWords('river-all-looks.toe', { look: 'fill-simple', for: { cycles: 1 } }), { look: 'fill-simple', title: 'Fill my cup (simple)', unit: 'cycles', n: 1, words: 'for 1 cycle', min: 1, max: 20, canLess: false, canMore: true });
  const w = inputsWords({ dave: { age_s: 301 }, river: { source: 'clip', age_s: 3 }, room: null }, {}, 'fill-simple');
  assert.deepEqual([w.dave.old, w.river.old, w.room, w.used.none], [true, true, null, "Fill my cup (simple) doesn't use them"]);
  assert.equal(inputsWords({ river: { source: 'live', age_s: 11 } }, null, null).river.old, true);
  assert.equal(inputsWords(null), null);
  assert.deepEqual(usedLines({ steering: 'room', strength: 0.456, novel: [1, 2] }), [{ key: 'Steering', words: 'room' }, { key: 'Strength', words: '0.46' }, { key: 'novel', words: '1, 2' }]);
  assert.equal(valueWords(null), 'not known');
});

test('manual and the old file: pinned words, the default playlist, Apply greyed with why', () => {
  const man = pageView(run('all-looks-manual'));
  assert.deepEqual([man.now.title, man.now.mode, man.manual, man.sections.find((s) => s.look === 'seasons').pinned], ["The river's year", 'Pinned (manual)', true, true]);
  assert.deepEqual(man.inputs.used.lines.map((l) => l.key), ['Steering', 'Speed']);
  assert.equal(man.inputs.river.old, true, 'the river frame is 14 s old');
  const old = pageView(run('looks-auto'));
  assert.deepEqual([old.allLooks, old.applyWhy, old.playlist.source, old.listed.length, old.inputs], [false, PLAYLIST_ONLY, 'default', 3, null]);
  assert.deepEqual(old.playlist.rows.map((r) => r.look), DEFAULT_PLAYLIST.map((e) => e.look));
  assert.match(old.playlist.note, /the file's default/i);
  const none = pageView(run('remembered-calm'));
  assert.deepEqual([none.running, none.listed, none.sections], [false, [], []]);
  assert.match(none.why, /isn't running/);
});

test('each look\'s settings: where they are; built-in titles when the registry has no words', () => {
  assert.deepEqual(settingsWords('remembered').link, ['Pool line, opening night, screens: Remembered river page', '/remembered']);
  assert.equal(settingsWords('seasons').link[1], SEASONS_PAGE);
  assert.equal(settingsWords('fill-configurable').link[1], '/status#ctl-filling');
  assert.deepEqual(lookInfo('river-looks.toe', 'modal'), { look: 'modal', title: 'Combined with Modal Input Selector', description: '', inputs: [] });
  assert.equal(lookInfo('no-such.toe', 'seasons').title, "The river's year");
});

test('the page and its modules are served behind the login; the Looks tab is in the shell', () => {
  const ui = readFileSync(new URL('../public/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /\['looks', 'Looks', '\/looks'/);
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /'\/looks': 'looks\.html'/);
  const html = readFileSync(new URL('../public/looks.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/looks-page\.js"/);
});
