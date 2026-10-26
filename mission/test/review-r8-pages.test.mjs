// Round 8, the pages' share (critics on dd38ad2, fixed on fix-r8): the change labels read as plain noun phrases in every frame, a
// dry run's Stop by its own name, Lights' checklist and state line say why and say it once, the map's arrows agree with its boxes
// during a restart; and the pages' wiring for what node can't run (the speech queue, the sheet's region, the box being typed in,
// the pressed control's line in view, the chat's send line and composer, the jumps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive, changeLabel, entryWords, entrySaid, waitWords, unconfirmedWords, notSentWords, endedSaid, heldWords } from '../public/model.js';
import { lastDoneWhat } from '../public/status-words.js';
import { calChecklist, startWhy, stateWords, nextLine, CAL_CTL } from '../public/lights-words.js';
import { linkWord } from '../public/map-words.js';
import { FixtureMission } from '../lib/fixtures.mjs';
import { describeEvent } from '../lib/history.mjs';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const splitHeadline = (h) => [String(h ?? ''), ''];   // ui.js's own needs a DOM; nextLine only reads the cause
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const fm = new FixtureMission({ dir: FIXTURES, stateDir: mkdtempSync(join(tmpdir(), 'r8p-')) });
const modelOf = (sc) => { const st = fm.snapshot(sc); return derive(st, st.now); };

// ---- R8 #20, #21: one name per change that reads as speech in every frame -----------------------------------------------------

const BODIES = [['ropes', { dark: true }], ['ropes', { dark: false }], ['hub75', { brightness: 0.9 }], ['hub75', {}], ['mode', { mode: 'manual' }], ['mode', {}],
  ['target', { season: 'summer', intensity: 0.7 }], ['target', {}], ['rules', { rules: { a: 1, b: 2 } }], ['rules', {}], ['rules-reset', {}],
  ['bootfile', { file: YEAR }], ['bootfile', {}], ['lightsroute', { route: 'router' }], ['lightsroute', { route: 'direct' }], ['lightsroute', {}],
  ['calibrate', { action: 'start' }], ['calibrate', { action: 'start', dry_run: true }], ['calibrate', { action: 'cancel' }], ['calibrate', { action: 'cancel', dry_run: true }],
  ['switch', { file: LIVE }], ['switch', { file: YEAR }, { running: YEAR }], ['rebuild', { file: YEAR }], ['check', {}]];

test('R8 #20: no change\'s name reads as a clause ("the ropes change to dark is being applied") or as no one talks ("the stop of the calibration")', () => {
  const labels = BODIES.map(([a, b, o]) => changeLabel(a, b, o));
  for (const l of labels) {
    // a plural or mass noun followed by a verb-like "change"/"reset" is a clause: "the ropes change", "the rules reset"
    assert.doesNotMatch(l, /\b(ropes|panels|rules|mode|target|boot file|lighting port) (change|reset)\b/, l);
    assert.doesNotMatch(l, /\bthe (start|stop) of\b/, l);
    // and it is a noun phrase every frame can carry
    for (const framed of [waitWords(l), `Applying: ${l}`, entryWords({ label: l, phase: 'confirming', expect_s: 15 }, 3), unconfirmedWords(l, '21:04'), notSentWords(waitWords(l), '21:04'),
      `Last done: ${lastDoneWhat({ action: 'x', label: l })}`, heldWords(l, '21:07')]) assert.doesNotMatch(framed, /\b(ropes|panels|rules) (change|reset) (to|is|was|got)\b/, framed);
  }
  assert.equal(changeLabel('ropes', { dark: true }), 'the change of the ropes to dark');
  assert.equal(changeLabel('hub75', { brightness: 0.9 }), 'the change of the panels to 90 %');
  assert.equal(changeLabel('mode', { mode: 'manual' }), 'the change of the mode to Manual');
  assert.equal(changeLabel('target', { season: 'summer', intensity: 0.7 }), 'the change of the target to summer, strong');
  assert.equal(changeLabel('rules-reset'), 'the reset of the rules');
  assert.equal(changeLabel('bootfile', { file: LIVE }), 'the change of the boot file to the live river');
  assert.equal(changeLabel('calibrate', { action: 'start' }), 'the calibration start');
  assert.equal(changeLabel('calibrate', { action: 'start', dry_run: true }), 'the dry run start');
  assert.equal(waitWords(changeLabel('ropes', { dark: true })), 'wait: the change of the ropes to dark is being applied');
  assert.equal(lastDoneWhat({ action: 'calibrate', body: { action: 'cancel' } }), 'The calibration stop');
  assert.equal(CAL_CTL.stop.what, 'the calibration stop');
  assert.equal(CAL_CTL.stopDry.what, 'the dry run stop');
});

test('R8 #21: a dry run\'s Stop is called a dry run\'s, on Last done and in Recent', () => {
  assert.equal(changeLabel('calibrate', { action: 'cancel', dry_run: true }), 'the dry run stop');
  assert.equal(lastDoneWhat({ action: 'calibrate', body: { action: 'cancel', dry_run: true } }), 'The dry run stop');
  assert.equal(describeEvent({ kind: 'action', action: 'calibrate', body: { action: 'cancel', dry_run: true }, ok: true, source: 'mission control' }), 'Stopped the dry run from mission control');
  assert.equal(describeEvent({ kind: 'action', action: 'calibrate', body: { action: 'cancel' }, ok: true, source: 'studio chat' }), 'Stopped the calibration from the studio chat');
});

test('R8 #21: over HTTP, the server records a Stop of a dry run as the dry run\'s (from the run it held), a real run\'s as the calibration\'s', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'r8p-'));
  writeFileSync(join(dir, 'pw'), 'NOT-A-REAL-PW\n');
  const base = { ...process.env }; delete base.MISSION_CONTROL_SOCKET;
  const p = spawn(process.execPath, [SERVER], { env: { ...base, MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'), MISSION_FIXTURES: FIXTURES,
                                                       MISSION_FAKE_AGENT: '1', MISSION_FIXTURE_APPLY_S: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => p.kill());
  const url = await new Promise((resolve, reject) => {
    let out = '';
    p.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); });
    p.on('exit', () => reject(new Error(out)));
  });
  const cookie = (await fetch(url + '/login', { method: 'POST', body: JSON.stringify({ password: 'NOT-A-REAL-PW' }), headers: { 'content-type': 'application/json' } })).headers.get('set-cookie').split(';')[0];
  const h = { cookie: `${cookie}; scenario=all-good`, 'content-type': 'application/json' };
  const post = async (body) => (await fetch(url + '/api/control/calibrate', { method: 'POST', headers: h, body: JSON.stringify(body) })).json();
  const recent = async () => (await (await fetch(url + '/api/history', { headers: h })).json()).events.map((e) => e.words);
  const status = async () => (await fetch(url + '/api/status', { headers: h })).json();
  assert.equal((await post({ action: 'start', dry_run: true })).ok, true);
  for (let i = 0; i < 100; i++) { const c = await (await fetch(url + '/api/calibration', { headers: h })).json(); if (c.running) break; await sleep(30); }
  assert.equal((await post({ action: 'cancel' })).cancelled, true);
  const la = (await status()).last_action;
  assert.equal(lastDoneWhat(la), 'The dry run stop');
  assert.ok((await recent()).includes('Stopped the dry run from mission control'), 'Recent names the dry run');
  // a real run's Stop stays the calibration's
  assert.equal((await post({ action: 'start' })).ok, true);
  for (let i = 0; i < 100; i++) { const c = await (await fetch(url + '/api/calibration', { headers: h })).json(); if (c.running) break; await sleep(30); }
  await post({ action: 'cancel' });
  assert.equal(lastDoneWhat((await status()).last_action), 'The calibration stop');
});

// ---- R8 #34: Lights' checklist says why a line isn't known ------------------------------------------------------------------

test('R8 #34: the Calibrate checklist says bitcube is offline when it is, a failed full check when it failed, "not checked yet" only before the first', () => {
  const off = calChecklist(modelOf('bitcube-offline')).map((c) => c.text);
  assert.deepEqual(off, ["TouchDesigner can't be checked: bitcube is offline", "The rope boxes can't be checked: bitcube is offline", "The gallery camera can't be checked: bitcube is offline"]);
  const first = calChecklist(modelOf('nothing-known-yet')).map((c) => c.text);
  for (const t of first) assert.match(t, /(hasn't|haven't) been checked yet$|can't be checked: bitcube is offline$/, t);
  // a full check that failed while bitcube answers
  const st = fm.snapshot('all-good');
  const failed = { ...st, probe: { ok: false, at: st.now, error: 'ssh: timed out', value: null } };
  const lines = calChecklist(derive(failed, failed.now)).map((c) => c.text);
  assert.deepEqual(lines, ["TouchDesigner can't be checked: the full check of bitcube failed", "The rope boxes can't be checked: the full check of bitcube failed",
    "The gallery camera can't be checked: the full check of bitcube failed"]);
  assert.ok(startWhy(modelOf('bitcube-offline')), 'Start still says why it can\'t run');
});

// ---- R8 #24: Lights' state line during a chosen restart -----------------------------------------------------------------------

const restartEntry = (t) => ({ id: 'ax.8', action: 'switch', label: "the restart on the river's year", file: YEAR, source: 'mission control', phase: 'confirming', started_at: t - 3000, answered_at: t - 1000,
  expect_s: 60, blocks: ['ropes', 'hub75', 'switch'] });
function restarting() {
  const st = fm.snapshot('all-good'), t = st.now;
  const pv = st.probe.value;
  const s = { ...st, applying: [restartEntry(t)], probe: { ...st.probe, value: { ...pv, td: { ok: false, running: false, file: null, error: 'not running' } } } };
  return derive(s, t);
}

test('R8 #24: during a chosen restart Lights says the dark ropes and panels once, and sends nobody to Status for nothing', () => {
  const m = restarting();
  assert.equal(m.overall.cause, 'td-restarting');
  assert.equal(m.show.restart?.chosen, true);
  assert.equal(stateWords(m), 'The ropes and the panels are dark while TouchDesigner restarts.');
  const nx = nextLine(m, 'from bitcube · 3 s ago', splitHeadline);
  assert.equal(nx.text, 'Started on purpose; back in about a minute.');
  assert.equal(nx.href, null, 'no "What to do → Status": there is nothing to do but wait');
  // an ordinary moment keeps both halves
  assert.match(stateWords(modelOf('all-good')), /^The ropes show the river · the panels show the river at \d+ %\.$/);
});

// ---- R8 #26: the map's arrows agree with its boxes during a restart ------------------------------------------------------------

test('R8 #26: during a restart the map\'s arrows say "restarting" and "dark, restarting", as the boxes do', () => {
  const m = restarting();
  const it = (id) => m.items.find((x) => x.id === id);
  assert.equal(linkWord({ item: 'touchdesigner' }, it('touchdesigner'), m), 'restarting');
  assert.equal(linkWord({ item: 'ropes' }, it('ropes'), m), 'dark, restarting');
  assert.equal(linkWord({ item: 'hub75 panels' }, it('hub75 panels'), m), 'dark, restarting');
  const doc = readFileSync(new URL('../../docs/mission-ui.md', import.meta.url), 'utf8');
  assert.ok(/"restarting", "dark, restarting"/.test(doc), 'the contract\'s pill list has them');
});

// ---- the pages' wiring (no DOM under node: the walks check the behaviour) --------------------------------------------------------

test('R8 #8, #11: every hidden region speaks through ui.js\'s one queue; a sheet has its own region, kept across the sheets it shows', () => {
  const ui = page('ui.js');
  assert.match(ui, /export function setLive\(region, words\)/);
  assert.match(ui, /SAY_GAP_MS = 1000/, 'a message never follows the one before within the same moment');
  assert.match(ui, /const l = sheetUp \? sheetRegion\(sheetUp\)/, 'with a sheet up, its region speaks');
  assert.match(ui, /if \(!\(n instanceof Element && n\.hasAttribute\('data-sheet-live'\)\)\) n\.remove\(\)/, 'a new sheet keeps the region');
  assert.match(page('status.js'), /setLive\(\$\('#band-live'\), said\)/);
  assert.match(page('lights.js'), /setLive\(\$\('#state-live'\), t\)/);
  assert.match(page('chat.js'), /setLive\(\$\('pin-live'\), sayAll\)/);
  assert.match(page('map.js'), /setLive\(\$\('#map-live'\), said\)/);
  for (const f of ['status.js', 'lights.js', 'chat.js', 'map.js']) assert.ok(!/\b(live|l)\.textContent = (said|sayAll|t)\b/.test(page(f)), `${f}: no region written around the queue`);
});

test('R8 #7, #14: the chat\'s Send line is not a live region (its words are said once), and the box is named by its visible words', () => {
  const html = page('chat.html'), chat = page('chat.js');
  assert.match(html, /<div class="ctl-status" id="send-status"><\/div>/);
  assert.match(chat, /if \(state !== 'before' && msg\) announce\(msg\.replace\(\/…\$\/, ''\)\)/);
  const ta = /<textarea id="text"[^>]*>/.exec(html)[0];
  const ph = /placeholder="([^"]*)"/.exec(ta)[1].replace(/…$/, ''), name = /aria-label="([^"]*)"/.exec(ta)[1];
  assert.ok(name.startsWith(ph), `"${name}" starts with what is seen, "${ph}"`);
});

test('R8 #4, #15: the chat keeps a reader at the bottom when the composer grows; the working mark never fades below its contrast', () => {
  assert.match(page('chat.js'), /const stick = grew && atBottom\(\)/);
  const css = page('v2.css');
  const pulse = /@keyframes pulse \{([^}]*\})?[^}]*\}/.exec(css)[0];
  assert.doesNotMatch(pulse, /opacity/, pulse);
});

test('R8 #3, #6, #12, #13, #29: Status brings the pressed line into view, jumps to Lights\' Stop and to the named control, never stops on a heading, keeps the box being typed in', () => {
  const st = page('status.js'), ui = page('ui.js'), lights = page('lights.js');
  assert.match(st, /if \(idle \|\| here\) \{ focusStatus\(name\); bringIntoView\(statusEl\(name\)\); \}/);
  assert.match(ui, /if \(s\.state === 'applying' && was !== 'applying'\) bringIntoView\(status\)/);
  assert.match(ui, /if \(a && a !== document\.body && a\.closest\('main'\)\) bringIntoView\(a\)/, 'a confirmed change\'s line too');
  assert.match(st, /\['Open Lights', 'href', '\/lights#calibrate'\]/);
  assert.match(lights, /const calLink = \{ wanted: location\.hash === '#calibrate'/);
  assert.match(st, /\['Ropes → On', 'goto', rid\('ropes'\), '#ctl-ropes-on'\]/);
  assert.match(st, /'#ctl-hub75-set, #ctl-hub75-more'/);
  assert.match(st, /jumpFocus\(b\.dataset\.target, null, b\.dataset\.focus \?\? null\)/);
  assert.match(st, /if \(onLine && parked\)/);
  assert.match(lights, /if \(c\?\.state === 'confirm'\) c\.update\(\{ why \}\)/, 'Lights: a done control is left as it is when its view goes');
  assert.match(lights, /unannounce\(c\.text\)/);
  assert.match(st, /typing && morphKeeping\(el, html, active\)/);
});
