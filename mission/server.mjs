// Mission control + studio chat server (docs/mission-plan.md, docs/mission-ui.md). Listens on 127.0.0.1 only; Tailscale Funnel
// puts it online at https://gav-m1-mini.tailddc624.ts.net. Configured by environment variables:
//   MISSION_PORT            8790 (0 picks a free port; the start-up line says which)
//   MISSION_PASSWORD_FILE   the shared team password (same as bitcube's login), e.g. /Users/river/.secrets/site-password
//   MISSION_TOKEN_FILE      Claude token from `claude setup-token` (optional until M7: without it the chat says so)
//   MISSION_STATE_DIR       sessions, chat history, agent session id, logs, history.jsonl (since when; what was last done)
//   MISSION_CONTACTS_FILE   who to call (default <MISSION_STATE_DIR>/contacts.json, untracked like the password):
//                           { "<key from model.js CONTACTS>": { "tel": "+1..." } }. Names and what each person owns stay in
//                           public/model.js; this file only adds numbers. Never logged, never in the repo.
//   MISSION_REPO            the studio agent's working folder (its clone of river-bitcube; also where the newest LED map is read)
//   MISSION_FAKE_AGENT=1    a pretend agent, for testing the pages without spending tokens
//   MISSION_FAKE_AGENT_DELAY_MS   its pause between steps (700)
//   MISSION_FIXTURES=<dir>  fixture mode (lib/fixtures.mjs): status, stills, lights and controls come from <dir>/<scenario>.json and
//                           nothing talks to bitcube, Modal or the seasons page. For designing the pages; never for the live site.
//   MISSION_FIXTURE_CALIBRATE_S   fixture mode: how long the scripted calibration run takes (60)
//   MISSION_FIXTURE_APPLY_S       fixture mode: how long a switch or a boot-file change holds before it answers (6; a rebuild
//                                 twice that), so a page can be seen applying and then confirming the change (lib/fixtures.mjs)
//   MISSION_CONTROL_SOCKET  the local control socket (default <MISSION_STATE_DIR>/mc.sock): the studio agent's only way to change
//                           the installation (mission/bin/mc.mjs). Mode 0600: only this server's own user (river) can connect;
//                           removed on exit. The agent gets its path in its environment (lib/agent.mjs).
//
// Routes (all JSON unless said; everything but /login, /healthz, /version, /shows.json and the assets sits behind the login cookie):
//   GET  /status /lights /chat /map /login      the v2 pages (public/*.html, docs/mission-ui.md); /, /mission and /status.html
//                                              (the v1 addresses) redirect to /status; /map/ is the engineers' diagram with live dots
//   GET  /api/status                           lib/mission.mjs snapshot + studio + now (the server's clock) + since + last_action;
//                                              applying: every control in flight (lib/applying.mjs; docs/mission-ui.md "Applying
//                                              a change"); confirmed / expired: the changes it confirmed or gave up on in the last
//                                              10 min ([{ id, request_id?, action, label, source, file?, started_at, at, maybe? }];
//                                              a page confirms its own switch, restart, rebuild or boot-file change by its id
//                                              there); verdicts: the history's verdicts on the last 20 changes that waited for one
//                                              and the last 10 others ([{ id, request_id?, verdict }], 12 h, across a restart: R8 #0,
//                                              CR8 #1);
//                                              probe.value.calibration the newest copy of the calibration job
//   GET  /api/lights                           what TouchDesigner sends the lights now (lib/lights.mjs CONTRACT); 503 in plain words
//   GET  /api/pixelmap                         { map, screens, still }: the newest LED map and screens file (lib/lights.mjs)
//   GET  /api/calibration                      the calibration job's progress file, or { running: false, none: true }; plus
//                                              rebuilt: { at, map, file } | null, the last rebuild that went all the way and was
//                                              confirmed (TouchDesigner back on the file): the map in use
//   GET  /api/history?limit=&kinds=&since=     { now, events (with words), since, last_action, count } (lib/history.mjs)
//   GET  /api/contacts                         { contacts: [{ key, name, owns, tel }] }
//   GET  /api/camera/<gallery|river>.jpg       the newest still (x-taken, x-age-s headers)
//   POST /api/control/<action>                 the whitelist in lib/mission.mjs planControl, plus calibrate (lib/lights.mjs
//                                              planCalibrate), check (the full check now, at most once per 20 s) and rebuild.
//                                              The answer (a maybe answer too) carries applying_id, its entry in status.applying.
//                                              request_id in the body (a page's own id for the press: [A-Za-z0-9._-]{1,40}) is kept
//                                              on the entry, so a page whose answer was lost finds its entry and verdict (R8 #2).
//                                              A refusal is { ok: false, error }: 400 bad request, 409 "wait: <label> is being
//                                              applied (started 21:04)" or "a calibration is running: ...", 429 checked too recently
//   GET  /api/chat/history  /api/chat/events (SSE)   POST /api/chat/send  /api/chat/stop { clear? } (clear drops the waiting requests too)
//
// The local control socket (MISSION_CONTROL_SOCKET; no cookie: the file's mode is the lock), for the studio agent (bin/mc.mjs):
//   GET  /status                               { ok, now, overall { level, cause, headline }, applying [{ id, request_id?, action,
//                                              label, phase, source, file?, started_at, answered_at?, maybe? }], confirmed, expired
//                                              ([{ id, request_id?, action, label, source, file?, started_at, at, maybe? }], as
//                                              /api/status), verdicts ([{ id, request_id?, verdict }]), calibration { running, stage,
//                                              mode, stale, ok } | null, show_file { file, label } | null, boot_file, blocked
//                                              { <action>: why } }: a change is done when confirmed (or verdicts) names its
//                                              applying_id, not shown when expired does (R8 #30)
//   POST /control/<action>                     exactly POST /api/control/<action>: the same whitelist, locks and 409 "wait: …",
//                                              recorded with source 'studio chat' (Applying line, Last done and Recent say so);
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { readFileSync, existsSync, mkdirSync, copyFileSync, chmodSync, lstatSync, unlinkSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Auth, readPasswordFile, parseCookies, clientOf, SESSION_MAX_AGE_S } from './lib/auth.mjs';
import { Studio } from './lib/studio.mjs';
import { Mission, checkedControl } from './lib/mission.mjs';
import { REQUEST_ID } from './lib/applying.mjs';
import { FixtureMission, CALIBRATION_OUTCOMES } from './lib/fixtures.mjs';
import { Lights, readLocalPixelmap, readLocalScreens, checkedCalibrate } from './lib/lights.mjs';
import { History, describeEvent, feed } from './lib/history.mjs';
import { describeTool } from './lib/steps.mjs';
import { SelfUpdate } from './lib/update.mjs';
import { Zipper } from './lib/zip.mjs';
import { scrubCreds } from './lib/scrub.mjs';
import { CONTACTS, derive, calDryRun } from './public/model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.MISSION_PORT || 8790);
const STATE = env.MISSION_STATE_DIR || join(HERE, '..', '..', 'mission-state');
const REPO = env.MISSION_REPO || join(HERE, '..');
const FIXTURES = env.MISSION_FIXTURES || null;
const CONTACTS_FILE = env.MISSION_CONTACTS_FILE || join(STATE, 'contacts.json');
const SOCKET = env.MISSION_CONTROL_SOCKET || join(STATE, 'mc.sock');
const COOKIE = 'mc';
const CHECK_EVERY_MS = 20_000;                 // POST /api/control/check: the full check is an SSH round trip; no faster than this
const OBSERVE_EVERY_MS = 5_000;                // how often the history looks at the snapshot (transitions only are kept)
const PIXELMAP_DIR = join(REPO, 'tools', 'pixelmap');

// Running as river: keep its Claude user files in step with the repo (no sudo needed: it's river's own home).
if (userInfo().username === 'river') {
  const home = userInfo().homedir;
  mkdirSync(join(home, '.claude'), { recursive: true, mode: 0o700 });
  copyFileSync(join(HERE, 'setup', 'river-CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'));
  copyFileSync(join(HERE, 'setup', 'river-claude-settings.json'), join(home, '.claude', 'settings.json'));
}

// Self-update: when a pull brings new mission/ code, restart (launchd starts us again) once the chat is idle and nothing is
// being applied (lib/update.mjs).
const git = (...args) => { try { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim(); } catch { return null; } };
const missionTree = () => git('rev-parse', 'HEAD:mission');
const BOOT_TREE = missionTree();
// The show registry (shows.json at the repo root) is mission control's input too (model.js reads it at load): a change there
// restarts it as new mission/ code does.
const codeTree = () => { const t = missionTree(); return t && `${t} ${git('rev-parse', 'HEAD:shows.json') ?? '-'}`; };
const SHOWS_FILE = env.MISSION_SHOWS_FILE || join(HERE, '..', 'shows.json');
// GET /version (no login): so a push can be confirmed from outside once the live site restarts on it. Only this leaves the box.
const COMMIT = git('rev-parse', 'HEAD');
const VERSION = { commit: COMMIT, short: COMMIT && COMMIT.slice(0, 7), mission_tree: BOOT_TREE, started: new Date().toISOString(),
                  node: process.version, fixtures: !!FIXTURES };

const auth = new Auth({ password: readPasswordFile(env.MISSION_PASSWORD_FILE), sessionsFile: join(STATE, 'sessions.json') });

async function makeRunner() {
  if (env.MISSION_FAKE_AGENT) {
    const delay = Number(env.MISSION_FAKE_AGENT_DELAY_MS ?? 700);
    return async function* ({ text, resume, signal }) {
      yield { kind: 'session', sessionId: resume ?? 'fake-session' };
      // the same step lines the real agent's tools give (lib/steps.mjs): plain words, the raw input apart
      for (const tool of [{ name: 'Read', input: { file_path: 'CLAUDE.md' } },
                          { name: 'Bash', input: { description: 'Check bitcube is online', command: 'ssh bitcube hostname' } },
                          { name: 'Edit', input: { file_path: 'docs/sessions/U.md' } }]) {
        await new Promise((r) => setTimeout(r, delay));
        if (signal.aborted) return;
        yield { kind: 'activity', ...describeTool(tool) };
      }
      // A message with the word "fail" shows what a broken run looks like; anything else gets a markdown reply.
      const failed = /\bfail\b/i.test(text);
      if (failed) yield { kind: 'error', text: '(pretend) ssh: connect to host bitcube port 22: Operation timed out' };
      else yield { kind: 'text', text: `(pretend agent) You said: ${text}\n\nWhat I found:\n- bitcube is online\n- TouchDesigner is running **the river's year** at 60 frames a second\n- the River camera is **offline**, so the panels show the gallery\n\nNothing needed changing.` };
      yield { kind: 'result', ok: !failed, text: failed ? 'bitcube did not answer' : '', cost: 0, turns: 4 };
    };
  }
  const tokenFile = env.MISSION_TOKEN_FILE;
  if (!tokenFile || !existsSync(tokenFile)) {
    return async function* () {
      yield { kind: 'error', text: 'The studio agent has no Claude token yet (step M7: Gavin runs `claude setup-token` and saves it). Everything else works.' };
    };
  }
  const { agentRunner } = await import('./lib/agent.mjs');
  return agentRunner({ cwd: REPO, appendPrompt: readFileSync(join(HERE, 'STUDIO.md'), 'utf8'),
                       token: readFileSync(tokenFile, 'utf8').trim(), model: env.MISSION_MODEL || undefined,
                       controlSocket: SOCKET, onSynced: () => update.check(), context: () => stepContext() });
}
/** What a step line needs to name a change as the band does (R9 #22): the show file TouchDesigner runs (a switch to it is the restart
 *  on it), and whether the calibration going is a dry run (its Stop is the dry run stop): by the rule the server records that Stop by
 *  (model.js calDryRun: a decode of earlier photos is a calibration, CR9 #7). */
function stepContext() {
  const s = mission?.snapshot?.(), td = s?.probe?.value?.td, cal = s?.probe?.value?.calibration;
  return { running: td && td.ok !== false && typeof td.file === 'string' ? td.file : null,
           ...(cal?.running === true ? { calDry: calDryRun(cal) } : {}) };
}

let mission = null;                // set below; the self-update's quiet() reads it
const update = new SelfUpdate({ boot: codeTree(), tree: codeTree, exit: () => process.exit(0),
                                quiet: () => { const st = studio.status(); return !st.running && !st.queue.length && !!mission && !mission.busy(); } });
const studio = new Studio({ runner: await makeRunner(), dir: STATE });
const lights = FIXTURES ? null : new Lights({ sshHost: 'bitcube' });
mission = FIXTURES ? new FixtureMission({ dir: FIXTURES, stateDir: STATE, pixelmapDir: PIXELMAP_DIR, calibrateS: Number(env.MISSION_FIXTURE_CALIBRATE_S || 60),
                                                applyS: Number(env.MISSION_FIXTURE_APPLY_S ?? 6) })
                         : new Mission({ sshHost: 'bitcube', lights, stateDir: STATE });   // fixtures: nothing is polled or run
mission.start();
studio.on('status', () => update.maybeRestart());
setInterval(() => update.maybeRestart(), 10_000).unref();       // a change in flight ended: restart now if one is pending
setInterval(async () => {
  if (studio.status().running || env.MISSION_FAKE_AGENT || FIXTURES) return;
  const { syncRepo } = await import('./lib/agent.mjs');
  await syncRepo(REPO);
  update.check();
  update.maybeRestart();
}, 5 * 60_000).unref();

// ---- history: since when, and what was last done ----------------------------------------------------------
// Live: one History on disk, fed the snapshot every 5 s. Fixture mode: one in memory per scenario (each is its own world; a
// restart forgets them, which is fine: "since" then starts at the restart, as it does live after a long outage).
const history = FIXTURES ? null : new History({ file: join(STATE, 'history.jsonl') });
const fixtureHistories = new Map();
function historyFor(scenario) {
  if (!FIXTURES) return history;
  const name = mission.active(scenario) ?? '-';
  if (!fixtureHistories.has(name)) fixtureHistories.set(name, new History({ file: null }));
  return fixtureHistories.get(name);
}
function observeAll() {
  try {
    if (!FIXTURES) { history.observe(mission.snapshot()); return; }
    for (const name of mission.names()) { try { historyFor(name).observe(mission.snapshot(name)); } catch { /* a half-edited fixture */ } }
  } catch (e) { console.warn(`history: ${e.message}`); }
}
observeAll();
setInterval(observeAll, OBSERVE_EVERY_MS).unref();
/** Every control, done or failed, goes into the history: its checked fields only (what the whitelist read, never what a client
 *  added), where it came from (mission control or the studio chat: never a person's name, MD4), its label (a restart on the
 *  running file reads as one), whether it may or may not have happened (maybe: no answer in time) and its entry's id (while the
 *  entry is still confirming, the band says "Last sent … waiting for bitcube to show it", not "Last done"). */
function recordAction(scenario, action, checked, result, error, { source = 'mission control', label = null, requestId = null } = {}) {
  try {
    historyFor(scenario).action({ action, body: checked, ok: !error && result?.ok !== false, maybe: !error && result?.maybe === true,
                                  note: error ? String(error.message ?? error) : result?.error ?? result?.note ?? null, source, label,
                                  applying_id: !error && typeof result?.applying_id === 'string' ? result.applying_id : null, request_id: requestId });
  } catch (e) { console.warn(`history: ${e.message}`); }
}

/** The run a progress copy describes is a dry run going (model.js calDryRun: its own flag, or its mode; one rule with the pages, the
 *  history and the agent's step lines, CR9 #7). */
const isDryRun = (c) => !!c && typeof c === 'object' && c.running === true && calDryRun(c);
/** One control, from a page (POST /api/control/<action>) or the studio agent (the control socket): the whitelist, the locks and
 *  the 409s, the history line. -> { status, body }. A refused request (400, 409, 429) is not something that happened: not recorded. */
async function runControl(action, b, { scenario, source = 'mission control', calib = 'ok' } = {}) {
  let checked = null, label = null;
  // the page's own id for this press (R8 #2): kept on the entry and in the history, never part of what the control does
  const requestId = typeof b?.request_id === 'string' && REQUEST_ID.test(b.request_id) ? b.request_id : null;
  try {
    let r;
    if (action === 'calibrate') {
      checked = checkedCalibrate(b.action, b);
      // a Stop is recorded as the stop of the run it stopped: a dry run's by its own name (R8 #21; the body bitcube gets is the same)
      if (checked.action === 'cancel' && isDryRun(mission.calibration(scenario))) checked = { ...checked, dry_run: true };
      // through the mission, which records a start as a change in flight and keeps the job's answer as its newest state
      r = await mission.calibrate(b.action, b, { scenario, outcome: calib, source, requestId });
    } else if (action === 'check') { checked = {}; r = await checkNow(scenario); }
    else {
      checked = checkedControl(action, b);
      label = mission.label(action, checked, scenario);          // before it runs: "the restart on …" when its file runs now
      r = await mission.control(action, b, scenario, { source, requestId });   // fixture mode: that scenario's own world
    }
    recordAction(scenario, action, checked, r, null, { source, label, requestId });
    return { status: 200, body: r };
  } catch (e) {
    if (!e.status || e.status >= 500) recordAction(scenario, action, checked, null, e, { source, label, requestId });
    return { status: e.status || 502, body: { ok: false, error: scrubCreds(e.message) } };
  }
}

/** GET /status on the control socket: what the agent reads before it changes anything (derive() on the snapshot, as a page), and
 *  after: every entry's id, and the server's verdicts (confirmed, expired, the history's), so the agent tells a change done from
 *  one the server gave up on by the applying_id its own answer named (R8 #30). */
function localStatus(scenario) {
  const snap = mission.snapshot(scenario);
  historyFor(scenario).judge(snap);
  const now = snap.now ?? Date.now();
  const m = derive({ ...snap, now }, now);
  const pv = snap.probe?.value, cal = pv?.calibration && typeof pv.calibration === 'object' ? pv.calibration : null;
  return {
    ok: true, now,
    overall: { level: m.overall.level, cause: m.overall.cause, headline: m.overall.headline },
    applying: (snap.applying ?? []).map((a) => ({ id: a.id, ...(a.request_id ? { request_id: a.request_id } : {}), action: a.action, label: a.label, phase: a.phase, source: a.source,
                                                ...(a.file ? { file: a.file } : {}), started_at: a.started_at, ...(a.answered_at != null ? { answered_at: a.answered_at } : {}),
                                                ...(a.maybe ? { maybe: true } : {}) })),
    confirmed: snap.confirmed ?? [], expired: snap.expired ?? [], verdicts: historyFor(scenario).verdicts(),
    calibration: cal ? { running: cal.running === true && cal.stale !== true, stage: cal.stage ?? null, mode: cal.mode ?? null, stale: cal.stale === true, ok: cal.ok ?? null } : null,
    show_file: m.show.file ? { file: m.show.file.name, label: m.show.file.label } : null,
    boot_file: typeof pv?.boot_file === 'string' ? pv.boot_file : null,
    blocked: Object.fromEntries(Object.entries(m.controls).filter(([, c]) => !c.possible).map(([k, c]) => [k, c.why])),
  };
}
function withWords(ev) { return ev ? { ...ev, words: describeEvent(ev), ago_s: Math.max(0, Math.round((Date.now() - ev.t) / 1000)) } : null; }

// ---- helpers ---------------------------------------------------------------------------------------------
// The v2 pages (docs/mission-ui.md). A page file that is not built yet answers 404 { error: 'not built yet' } rather than 500.
const PAGES = { '/status': 'status.html', '/lights': 'lights.html', '/chat': 'chat.html', '/map': 'map.html', '/login': 'login.html' };
const REDIRECTS = { '/': '/status', '/mission': '/status', '/status.html': '/status' };     // the v1 addresses
// Assets under public/ (styles, scripts, icons, the manifest) are served to anyone, like the login page itself: they hold no data.
// HTML is only served through PAGES (behind the login); the design prototypes (public/proto/) are in git history.
const PUBLIC = join(HERE, 'public');
const TYPES = { css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', svg: 'image/svg+xml', png: 'image/png',
                ico: 'image/x-icon', webmanifest: 'application/manifest+json', woff2: 'font/woff2', json: 'application/json' };
function staticFile(path) {
  const m = path.match(/^\/([a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.([a-z0-9]+))$/);
  if (!m || !TYPES[m[2]]) return null;
  const file = join(PUBLIC, m[1]);
  return existsSync(file) ? [file, TYPES[m[2]]] : null;
}
const MAP_DIR = join(REPO, 'docs', 'system');      // the interactive system map, served with live status
function sendPage(req, res, name) {
  if (!existsSync(join(PUBLIC, name))) return send(res, 404, { error: 'not built yet' });
  return sendFile(req, res, join(PUBLIC, name), 'text/html; charset=utf-8');
}

// On a poor phone link (a gallery's Wi-Fi, cellular) every byte counts (R7 #1): text answers are gzipped when the request accepts
// it (the LED map 481 → 39 KB, model.js 100 → 30 KB, /api/status 6 → 2 KB), and the page files revalidate instead of downloading
// again on every tab (ETag and Last-Modified, cache-control no-cache: a 304 when unchanged, so a self-update is seen at once).
// Every API answer stays no-store. Compressing never blocks the server (lib/zip.mjs, CR7 #12): a page file once per ETag, a big
// answer (the LED map) off the event loop and once per content.
const ZIPPED = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg\+xml)/;
const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY' };
const zipper = new Zipper();
/** zipKey: a page file's path and ETag (its gzipped bytes are kept under it). */
function send(res, status, body, type = 'application/json', headers = {}, zipKey = null) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const h = { 'content-type': type, 'cache-control': 'no-store', ...SECURITY, ...headers };
  const out = (bytes, zipped) => { res.writeHead(status, zipped ? { ...h, 'content-encoding': 'gzip' } : h); res.end(bytes); };
  if (ZIPPED.test(type)) {
    h.vary = 'Accept-Encoding';
    if (/\bgzip\b/i.test(String(res.req?.headers?.['accept-encoding'] ?? '')) && Buffer.byteLength(data) >= 1024) {
      let z;
      try { z = zipper.zip(data, zipKey); } catch { return out(data, false); }
      if (Buffer.isBuffer(z)) return out(z, true);
      z.then((bytes) => out(bytes, true), () => out(data, false));
      return;
    }
  }
  out(data, false);
}
/** A file from public/ that may be kept by the browser and revalidated: 304 when its ETag still matches (its size and time), else
 *  the file (gzipped when asked). Only ever called after the login check for a page. */
function sendFile(req, res, file, type) {
  const st = statSync(file);
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const h = { 'cache-control': 'no-cache', etag, 'last-modified': st.mtime.toUTCString() };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...SECURITY, ...h, ...(ZIPPED.test(type) ? { vary: 'Accept-Encoding' } : {}) }); return res.end(); }
  return send(res, 200, readFileSync(file), type, h, `${file}|${etag}`);
}

function client(req) { return clientOf(req.headers['x-forwarded-for'], req.socket.remoteAddress); }

async function body(req, limit = 64_000) {
  let b = '';
  for await (const c of req) { b += c; if (b.length > limit) throw Object.assign(new Error('too large'), { status: 413 }); }
  if (!b) return {};
  if (String(req.headers['content-type']).includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(b));
  try { return JSON.parse(b); } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); }
}

/** A control's body (a page's POST /api/control/<action>, the control socket): JSON only. A form (curl -d sends one by default) or
 *  any other type is refused (400) before it is read, never taken as one odd key and run with its flags missing (R10 #37). */
async function controlBody(req) {
  const type = String(req.headers['content-type'] ?? '');
  const b = await body(req);
  const empty = isObject(b) && !Object.keys(b).length;          // no body at all (mc.mjs check, rules-reset)
  if (!empty && !/^application\/json\b/i.test(type)) throw Object.assign(new Error("mission control didn't accept it: the request must be JSON (content-type: application/json)"), { status: 400 });
  return b;
}

/** A request body is a JSON object (or form fields); null, a list, a number or a string is refused before anything reads it. */
const isObject = (b) => !!b && typeof b === 'object' && !Array.isArray(b);
const NOT_OBJECT = "mission control didn't accept it: the request must be a JSON object";

function sameOrigin(req) {
  // State-changing requests must come from our own pages (cookie is SameSite=Lax; this is belt and braces).
  const o = req.headers.origin;
  return !o || o === `https://${req.headers.host}` || o === `http://${req.headers.host}`;
}

/** A failed frames fetch, in the words the Lights page shows (the raw reason rides along for the engineers' drawer). */
function plainLightsError(raw) {
  const s = scrubCreds(String(raw ?? ''));
  const error = /not running/i.test(s) ? "TouchDesigner isn't running: no frames"
    : /can't reach bitcube|ssh/i.test(s) ? 'bitcube is offline: no frames'
    : /too long|timed out|timeout/i.test(s) ? "bitcube didn't answer in time: no frames"
    : /dialog|blocked/i.test(s) ? "TouchDesigner isn't answering (a dialog is blocking it): no frames"
    : /no answer|bridge/i.test(s) ? "TouchDesigner isn't answering: no frames"
    : "Can't show the lights right now";
  return { ok: false, error, raw: s || null };
}

/** What TouchDesigner sends, as a browser gets it: every field scrubbed of logins as every live answer is (R10 #40), but the frames'
 *  pixels (base64 rgb) left as they are: they hold no words, and a mask that happened to match inside one would spoil the picture. */
function scrubFrames(r) {
  const keepRgb = (part) => (part && typeof part === 'object' && typeof part.rgb === 'string' ? { ...scrubCreds({ ...part, rgb: '' }), rgb: part.rgb } : scrubCreds(part));
  const f = r?.frames;
  if (!f || typeof f !== 'object') return scrubCreds(r);
  const out = scrubCreds({ ...r, frames: null });
  out.frames = { ...scrubCreds({ ...f, ropes: null, panels: null, screens: null }) };
  for (const k of ['ropes', 'panels', 'screens']) if (k in f) out.frames[k] = keepRgb(f[k]);
  return out;
}

/** Who to call: names and what they own from model.js, numbers from the untracked contacts file (missing: tel null). */
function contacts() {
  let tels = {};
  try { const j = JSON.parse(readFileSync(CONTACTS_FILE, 'utf8')); if (j && typeof j === 'object') tels = j; } catch { /* no file, or unreadable: no numbers */ }
  return { contacts: Object.entries(CONTACTS).map(([key, c]) => ({ key, name: c.name, owns: c.owns,
                                                                      tel: typeof tels[key]?.tel === 'string' && tels[key].tel.trim() ? tels[key].tel.trim() : null })) };
}

/** GET /api/pixelmap: the clone's newest map (or bitcube's when the probe names a newer one), the screens file, no still yet. */
async function pixelmapPayload(scenario) {
  const local = readLocalPixelmap(PIXELMAP_DIR);
  let map = local;
  if (!FIXTURES) {
    const summary = mission.snapshot().probe?.value?.pixelmap;
    if (summary?.file && (!local || local.error || summary.file > local.file)) {
      const remote = await lights.pixelmap(summary);
      if (remote && !remote.error && remote.ok !== false) map = remote;
      else if (!map) map = { file: summary.file, error: scrubCreds(remote?.error ?? 'could not fetch the map from bitcube') };
    }
  }
  void scenario;
  return { map: map ?? null, screens: readLocalScreens(PIXELMAP_DIR), still: null };
}

let lastCheck = 0;
/** POST /api/control/check: the full check now (live: the SSH probe plus the fast polls), at most once per 20 s. */
async function checkNow(scenario) {
  const now = Date.now();
  if (now - lastCheck < CHECK_EVERY_MS) throw Object.assign(new Error(`checked ${Math.round((now - lastCheck) / 1000)} s ago; wait`), { status: 429 });
  lastCheck = now;
  if (FIXTURES) return mission.check(scenario);
  await Promise.all([mission.pollFast().catch(() => {}), mission.pollModal().catch(() => {}), mission.pollProbe()]);
  const pb = mission.snapshot().probe;
  return { ok: true, at: now, took_ms: Date.now() - now, probe: pb ? { ok: !pb.error, error: pb.error ?? null } : null };
}

// ---- server ----------------------------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    const st = req.method === 'GET' && staticFile(path);
    if (st) return sendFile(req, res, st[0], st[1]);
    if (path === '/login' && req.method === 'GET') return sendPage(req, res, PAGES['/login']);
    if (path === '/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'cross-origin' });
      const b = await body(req);
      if (!isObject(b)) return send(res, 400, { error: NOT_OBJECT });
      // the login page's form posted by the browser itself (its scripts didn't load): answered with a page to go to, never JSON (R10 #36)
      const form = String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded');
      const r = auth.login(client(req), b.password);
      if (!r.ok) {
        await new Promise((ok) => setTimeout(ok, 400));           // every wrong answer costs time
        if (form) return send(res, 303, '', 'text/plain', { location: `/login?failed=${r.throttled ? 'wait' : 'wrong'}` });
        if (r.throttled) return send(res, 429, { error: 'too many tries', wait_ms: r.wait });
        return send(res, 401, { error: 'wrong password', wait_ms: r.wait });
      }
      const secure = req.headers['x-forwarded-proto'] === 'https' || !!req.headers['x-forwarded-for'];
      const cookie = `${COOKIE}=${r.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure ? '; Secure' : ''}`;
      if (form) return send(res, 303, '', 'text/plain', { location: '/status', 'set-cookie': cookie });
      return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': cookie });
    }
    if (path === '/healthz') return send(res, 200, { ok: true });
    // the show registry, for model.js in the pages (public, as in the repo: no data beyond what GitHub shows)
    if (path === '/shows.json' && req.method === 'GET') return existsSync(SHOWS_FILE) ? sendFile(req, res, SHOWS_FILE, 'application/json') : send(res, 404, { error: 'no shows.json' });
    if (path === '/version') return send(res, 200, VERSION);

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE];
    if (!auth.valid(token)) {
      if (path.startsWith('/api/')) return send(res, 401, { error: 'log in first' });
      return send(res, 302, '', 'text/plain', { location: '/login' });
    }
    if (path === '/logout' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'cross-origin' });
      auth.logout(token);
      return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });
    }
    if (REDIRECTS[path]) return send(res, 302, '', 'text/plain', { location: REDIRECTS[path] });
    const scenario = cookies.scenario;                    // only means something in fixture mode; Mission ignores it
    const fx = FIXTURES && path.match(/^\/fixtures(?:\/([a-z0-9-]+))?$/);
    if (fx) {
      // Fixture mode: list the scenarios, or pick the one this browser sees (a cookie, so every tab can differ). ?calib=drift|decode
      // sets how this browser's next scripted calibration ends (a cookie too; without the query it is cleared).
      if (!fx[1]) return send(res, 200, { active: mission.active(scenario), scenarios: mission.list(), calib: cookies.calib ?? null });
      if (mission.active(fx[1]) !== fx[1]) return send(res, 404, { error: 'no such scenario' });
      const calib = url.searchParams.get('calib');
      const setCalib = CALIBRATION_OUTCOMES.includes(calib) ? `calib=${calib}; Path=/; SameSite=Lax` : 'calib=; Path=/; Max-Age=0';
      return send(res, 302, '', 'text/plain', { location: '/status', 'set-cookie': [`scenario=${fx[1]}; Path=/; SameSite=Lax`, setCalib] });
    }
    if (PAGES[path]) return sendPage(req, res, PAGES[path]);
    if (path === '/map/' || path === '/map/index.html') {
      const html = readFileSync(join(MAP_DIR, 'index.html'), 'utf8')
        .replace('</body>', '<script>' + readFileSync(join(PUBLIC, 'map-live.js'), 'utf8') + '</script></body>');
      return send(res, 200, html, 'text/html; charset=utf-8', { 'x-frame-options': 'SAMEORIGIN' });
    }
    if (path === '/map/system.json') return send(res, 200, readFileSync(join(MAP_DIR, 'system.json')));
    if (path === '/map/system.html') return send(res, 302, '', 'text/plain', { location: 'https://gavaiken.github.io/river-bitcube/system/system.html' });

    // studio chat
    // now: the server's clock, so a page counts a running request's time from its start on that clock (R8 #35)
    if (path === '/api/chat/history') return send(res, 200, { events: studio.history(Number(url.searchParams.get('limit') || 500)), status: studio.status(), now: Date.now() });
    if (path === '/api/chat/events') {
      // the shared security headers too, as every other answer has them (R10 #41)
      res.writeHead(200, { ...SECURITY, 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const push = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      const onEvent = (e) => push('chat', e);
      const onStatus = (s) => push('status', s);
      studio.on('event', onEvent); studio.on('status', onStatus);
      push('status', studio.status());
      // a named keepalive the page can see (a ": comment" is invisible to EventSource): the header's age means the connection
      const ping = setInterval(() => res.write(`event: ping\ndata: {"t":${Date.now()}}\n\n`), 25_000);
      req.on('close', () => { clearInterval(ping); studio.off('event', onEvent); studio.off('status', onStatus); });
      return;
    }
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'cross-origin' });
    if (path === '/api/chat/send' && req.method === 'POST') {
      const b = await body(req);
      if (!isObject(b)) return send(res, 400, { error: NOT_OBJECT });
      try { return send(res, 200, { id: studio.send(b.text), status: studio.status() }); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (path === '/api/chat/stop' && req.method === 'POST') {
      const b = await body(req);
      if (!isObject(b)) return send(res, 400, { error: NOT_OBJECT });
      return send(res, 200, studio.stop({ clear: b.clear === true }));
    }

    // mission control
    if (path === '/api/status') {
      // now: the server's clock, so a phone's skew can't age or freshen anything (fixture mode: the scenario's own moment, see
      // lib/fixtures.mjs). since and last_action come from the history (durations in for_s / ago_s, on the real clock).
      const snap = mission.snapshot(scenario), h = historyFor(scenario);
      h.judge(snap);                   // a verdict in these lists is said at once, never one look of the history later
      const summary = h.summary();
      // verdicts: the history's verdicts on the last changes that waited for one, for hours (status.confirmed keeps 10 min, R8 #0)
      return send(res, 200, { ...snap, studio: studio.status(), now: snap.now ?? Date.now(), since: summary.since, last_action: withWords(summary.last_action),
                              verdicts: h.verdicts() });
    }
    if (path === '/api/history') {
      const h = historyFor(scenario);
      try { h.judge(mission.snapshot(scenario)); } catch { /* a half-edited fixture */ }
      const kinds = url.searchParams.get('kinds');
      const sinceT = Number(url.searchParams.get('since'));
      const events = h.recent({ limit: Math.min(500, Number(url.searchParams.get('limit')) || 50), kinds: kinds ? kinds.split(',').map((k) => k.trim()).filter(Boolean) : undefined,
                                sinceT: Number.isFinite(sinceT) && sinceT > 0 ? sinceT : undefined });
      const summary = h.summary();
      return send(res, 200, { now: Date.now(), events: feed(events), since: summary.since, last_action: withWords(summary.last_action), count: summary.count });
    }
    if (path === '/api/contacts') return send(res, 200, contacts());
    // What TouchDesigner is sending to the lights right now (the contract at the top of lib/lights.mjs; one shape in both modes).
    if (path === '/api/lights') {
      if (FIXTURES) { try { return send(res, 200, mission.lights(scenario)); } catch (e) { return send(res, e.status || 503, { ok: false, error: e.message }); } }
      if (mission.snapshot().bitcube?.value?.online === false) return send(res, 503, { ok: false, error: 'bitcube is offline: no frames' });
      const r = await lights.frames();
      if (!r || r.ok === false || !r.frames) return send(res, 503, plainLightsError(r?.error));
      return send(res, 200, scrubFrames(r));
    }
    if (path === '/api/pixelmap') return send(res, 200, await pixelmapPayload(scenario));
    if (path === '/api/calibration') {
      // rebuilt: the last rebuild that went all the way, so every phone knows which map the river's year uses
      const rebuilt = mission.rebuilt(scenario);
      if (FIXTURES) return send(res, 200, { ...mission.calibration(scenario), rebuilt });
      const r = await mission.calibrationStatus();           // kept as the newest copy: the lock follows the run at once
      if (!r || (r.ok === false && !('running' in r))) return send(res, 503, { ok: false, error: `Can't read the calibration: ${plainLightsError(r?.error).error.replace(/: no frames$/, '')}`, raw: scrubCreds(r?.error ?? null), rebuilt });
      return send(res, 200, { ...r, rebuilt });
    }
    const cam = path.match(/^\/api\/camera\/([a-z]+)\.jpg$/);
    if (cam) {
      const c = await mission.camera(cam[1], scenario);
      if (!c.jpeg) return send(res, 503, { error: 'no picture from that camera right now' });
      const ref = FIXTURES ? mission.clock(scenario) : Date.now();
      return send(res, 200, c.jpeg, c.type || 'image/jpeg', { 'x-taken': new Date(c.at).toISOString(), 'x-age-s': String(Math.max(0, Math.round((ref - c.at) / 1000))) });
    }
    const m = path.match(/^\/api\/control\/([a-z0-9-]+)$/);
    if (m && req.method === 'POST') {
      const b = await controlBody(req);
      // a control's body is a JSON object; anything else (null, a list, a number) is refused before it is run or recorded
      if (!isObject(b)) return send(res, 400, { error: NOT_OBJECT });
      const calib = CALIBRATION_OUTCOMES.includes(url.searchParams.get('calib')) ? url.searchParams.get('calib') : CALIBRATION_OUTCOMES.includes(cookies.calib) ? cookies.calib : 'ok';
      const r = await runControl(m[1], b, { scenario, source: 'mission control', calib });
      return send(res, r.status, r.body);
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, e.status || 500, { error: scrubCreds(e.message) });
  }
});

// ---- the local control socket (the studio agent's way to change the installation: bin/mc.mjs) -----------------------------
const local = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const scenario = FIXTURES ? url.searchParams.get('scenario') ?? undefined : undefined;   // fixture mode: which world (default as a page)
  try {
    if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, localStatus(scenario));
    const m = url.pathname.match(/^\/control\/([a-z0-9-]+)$/);
    if (m && req.method === 'POST') {
      const b = await controlBody(req);
      if (!isObject(b)) return send(res, 400, { ok: false, error: NOT_OBJECT });
      // every control a page has, Stop of a calibration included (Gavin, 26 Oct: the studio chat does what it is asked), recorded
      // "from the studio chat"
      const r = await runControl(m[1], b, { scenario, source: 'studio chat' });
      return send(res, r.status, r.body);
    }
    return send(res, 404, { ok: false, error: 'not here: GET /status or POST /control/<action>' });
  } catch (e) { return send(res, e.status || 500, { ok: false, error: scrubCreds(e.message) }); }
});
let socketMine = false;
/** Whether a server answers on the socket now (a live mission control), rather than a file left by one that was killed. */
const socketLive = (path) => new Promise((resolve) => {
  const c = netConnect(path);
  const done = (v) => { c.destroy(); resolve(v); };
  c.once('connect', () => done(true)); c.once('error', () => done(false));
  setTimeout(() => done(false), 1000).unref();
});
async function listenLocal() {
  try {
    mkdirSync(dirname(SOCKET), { recursive: true });
    // a socket left by a server that was killed is ours to replace; one a running server answers on is not (a second server
    // started on the same state folder, e.g. a fixture or dev server, must never take the live one's agent away); any other
    // file there is not ours either (listen then fails, said below)
    let stale = false;
    try { stale = lstatSync(SOCKET).isSocket(); } catch { /* none there */ }
    if (stale && await socketLive(SOCKET)) { console.warn(`control socket ${SOCKET}: another mission control answers on it; this one has none`); return; }
    if (stale) unlinkSync(SOCKET);
    const before = process.umask(0o177);           // created 0600 from its first moment; the chmod below makes sure
    try { local.listen(SOCKET); } finally { process.umask(before); }
  } catch (e) { console.warn(`control socket: ${e.message}`); }
}
local.on('listening', () => { socketMine = true; try { chmodSync(SOCKET, 0o600); } catch (e) { console.warn(`control socket: ${e.message}`); } });
local.on('error', (e) => console.warn(`control socket ${SOCKET}: ${e.message} (the studio agent can't change the installation until it is fixed)`));
process.on('exit', () => { if (socketMine) { try { unlinkSync(SOCKET); } catch { /* gone already */ } } });
listenLocal();

server.listen(PORT, '127.0.0.1', () => console.log(`mission control on http://127.0.0.1:${server.address().port} (state in ${STATE}, agent in ${REPO}${FIXTURES ? `, fixtures from ${FIXTURES}` : ''}, control socket ${SOCKET})`));
const quit = () => { mission.stop(); local.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', quit); process.on('SIGINT', quit);
