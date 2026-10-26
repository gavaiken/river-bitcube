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
//
// Routes (all JSON unless said; everything but /login, /healthz, /version and the assets sits behind the login cookie):
//   GET  /status /lights /chat /map /login      the v2 pages (public/*.html, docs/mission-ui.md); /, /mission and /status.html
//                                              (the v1 addresses) redirect to /status; /map/ is the engineers' diagram with live dots
//   GET  /api/status                           lib/mission.mjs snapshot + studio + now (the server's clock) + since + last_action
//   GET  /api/lights                           what TouchDesigner sends the lights now (lib/lights.mjs CONTRACT); 503 in plain words
//   GET  /api/pixelmap                         { map, screens, still }: the newest LED map and screens file (lib/lights.mjs)
//   GET  /api/calibration                      the calibration job's progress file, or { running: false, none: true }
//   GET  /api/history?limit=&kinds=&since=     { now, events (with words), since, last_action, count } (lib/history.mjs)
//   GET  /api/contacts                         { contacts: [{ key, name, owns, tel }] }
//   GET  /api/camera/<gallery|river>.jpg       the newest still (x-taken, x-age-s headers)
//   POST /api/control/<action>                 the whitelist in lib/mission.mjs planControl, plus calibrate (lib/lights.mjs
//                                              planCalibrate), check (the full check now, at most once per 20 s) and rebuild
//   GET  /api/chat/history  /api/chat/events (SSE)   POST /api/chat/send  /api/chat/stop { clear? } (clear drops the waiting requests too)
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Auth, readPasswordFile, parseCookies, clientOf, SESSION_MAX_AGE_S } from './lib/auth.mjs';
import { Studio } from './lib/studio.mjs';
import { Mission } from './lib/mission.mjs';
import { FixtureMission, CALIBRATION_OUTCOMES } from './lib/fixtures.mjs';
import { Lights, readLocalPixelmap, readLocalScreens } from './lib/lights.mjs';
import { History, describeEvent } from './lib/history.mjs';
import { describeTool } from './lib/steps.mjs';
import { CONTACTS } from './public/model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.MISSION_PORT || 8790);
const STATE = env.MISSION_STATE_DIR || join(HERE, '..', '..', 'mission-state');
const REPO = env.MISSION_REPO || join(HERE, '..');
const FIXTURES = env.MISSION_FIXTURES || null;
const CONTACTS_FILE = env.MISSION_CONTACTS_FILE || join(STATE, 'contacts.json');
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

// Self-update: when a pull brings new mission/ code, restart (launchd starts us again) as soon as the chat is idle.
const git = (...args) => { try { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim(); } catch { return null; } };
const missionTree = () => git('rev-parse', 'HEAD:mission');
const BOOT_TREE = missionTree();
// GET /version (no login): so a push can be confirmed from outside once the live site restarts on it. Only this leaves the box.
const COMMIT = git('rev-parse', 'HEAD');
const VERSION = { commit: COMMIT, short: COMMIT && COMMIT.slice(0, 7), mission_tree: BOOT_TREE, started: new Date().toISOString(),
                  node: process.version, fixtures: !!FIXTURES };
let restartPending = false;
function checkForUpdate() {
  if (!restartPending && BOOT_TREE && missionTree() && missionTree() !== BOOT_TREE) {
    restartPending = true;
    console.log('mission/ changed in the repo: restarting when the chat is idle');
  }
}

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
                       onSynced: checkForUpdate });
}

const studio = new Studio({ runner: await makeRunner(), dir: STATE });
const mission = FIXTURES ? new FixtureMission({ dir: FIXTURES, stateDir: STATE, pixelmapDir: PIXELMAP_DIR, calibrateS: Number(env.MISSION_FIXTURE_CALIBRATE_S || 60) })
                         : new Mission();   // fixtures: nothing is polled or run
const lights = FIXTURES ? null : new Lights({ sshHost: mission.sshHost });
mission.start();
studio.on('status', (st) => { if (restartPending && !st.running && !st.queue.length) { console.log('restarting for new code'); process.exit(0); } });
setInterval(async () => {
  if (studio.status().running || env.MISSION_FAKE_AGENT || FIXTURES) return;
  const { syncRepo } = await import('./lib/agent.mjs');
  await syncRepo(REPO);
  checkForUpdate();
  if (restartPending && !studio.status().running && !studio.status().queue.length) { console.log('restarting for new code'); process.exit(0); }
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
/** Every control, done or failed, goes into the history (source: never a person's name, MD4). */
function recordAction(scenario, action, body, result, error) {
  try {
    historyFor(scenario).action({ action, body, ok: !error && result?.ok !== false,
                                  note: error ? String(error.message ?? error) : result?.error ?? result?.note ?? null, source: 'mission control' });
  } catch (e) { console.warn(`history: ${e.message}`); }
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
const page = (name) => readFileSync(join(PUBLIC, name));
function sendPage(res, name) {
  if (!existsSync(join(PUBLIC, name))) return send(res, 404, { error: 'not built yet' });
  return send(res, 200, page(name), 'text/html; charset=utf-8');
}

function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
                          'referrer-policy': 'same-origin', 'x-frame-options': 'DENY', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function client(req) { return clientOf(req.headers['x-forwarded-for'], req.socket.remoteAddress); }

async function body(req, limit = 64_000) {
  let b = '';
  for await (const c of req) { b += c; if (b.length > limit) throw Object.assign(new Error('too large'), { status: 413 }); }
  if (!b) return {};
  if (String(req.headers['content-type']).includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(b));
  try { return JSON.parse(b); } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); }
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
  const s = String(raw ?? '');
  const error = /not running/i.test(s) ? "TouchDesigner isn't running: no frames"
    : /can't reach bitcube|ssh/i.test(s) ? 'bitcube is offline: no frames'
    : /too long|timed out|timeout/i.test(s) ? "bitcube didn't answer in time: no frames"
    : /dialog|blocked/i.test(s) ? "TouchDesigner isn't answering (a dialog is blocking it): no frames"
    : /no answer|bridge/i.test(s) ? "TouchDesigner isn't answering: no frames"
    : "Can't show the lights right now";
  return { ok: false, error, raw: s || null };
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
      else if (!map) map = { file: summary.file, error: remote?.error ?? 'could not fetch the map from bitcube' };
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
    if (st) return send(res, 200, readFileSync(st[0]), st[1]);
    if (path === '/login' && req.method === 'GET') return sendPage(res, PAGES['/login']);
    if (path === '/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'cross-origin' });
      const b = await body(req);
      if (!isObject(b)) return send(res, 400, { error: NOT_OBJECT });
      const r = auth.login(client(req), b.password);
      if (!r.ok) {
        await new Promise((ok) => setTimeout(ok, 400));           // every wrong answer costs time
        if (r.throttled) return send(res, 429, { error: 'too many tries', wait_ms: r.wait });
        return send(res, 401, { error: 'wrong password', wait_ms: r.wait });
      }
      const secure = req.headers['x-forwarded-proto'] === 'https' || !!req.headers['x-forwarded-for'];
      return send(res, 200, { ok: true }, 'application/json', {
        'set-cookie': `${COOKIE}=${r.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure ? '; Secure' : ''}` });
    }
    if (path === '/healthz') return send(res, 200, { ok: true });
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
    if (PAGES[path]) return sendPage(res, PAGES[path]);
    if (path === '/map/' || path === '/map/index.html') {
      const html = readFileSync(join(MAP_DIR, 'index.html'), 'utf8')
        .replace('</body>', '<script>' + readFileSync(join(PUBLIC, 'map-live.js'), 'utf8') + '</script></body>');
      return send(res, 200, html, 'text/html; charset=utf-8', { 'x-frame-options': 'SAMEORIGIN' });
    }
    if (path === '/map/system.json') return send(res, 200, readFileSync(join(MAP_DIR, 'system.json')));
    if (path === '/map/system.html') return send(res, 302, '', 'text/plain', { location: 'https://gavaiken.github.io/river-bitcube/system/system.html' });

    // studio chat
    if (path === '/api/chat/history') return send(res, 200, { events: studio.history(Number(url.searchParams.get('limit') || 500)), status: studio.status() });
    if (path === '/api/chat/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
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
      const snap = mission.snapshot(scenario);
      const summary = historyFor(scenario).summary();
      return send(res, 200, { ...snap, studio: studio.status(), now: snap.now ?? Date.now(), since: summary.since, last_action: withWords(summary.last_action) });
    }
    if (path === '/api/history') {
      const h = historyFor(scenario);
      const kinds = url.searchParams.get('kinds');
      const sinceT = Number(url.searchParams.get('since'));
      const events = h.recent({ limit: Math.min(500, Number(url.searchParams.get('limit')) || 50), kinds: kinds ? kinds.split(',').map((k) => k.trim()).filter(Boolean) : undefined,
                                sinceT: Number.isFinite(sinceT) && sinceT > 0 ? sinceT : undefined });
      const summary = h.summary();
      return send(res, 200, { now: Date.now(), events: events.map((e) => ({ ...e, words: describeEvent(e) })), since: summary.since, last_action: withWords(summary.last_action), count: summary.count });
    }
    if (path === '/api/contacts') return send(res, 200, contacts());
    // What TouchDesigner is sending to the lights right now (the contract at the top of lib/lights.mjs; one shape in both modes).
    if (path === '/api/lights') {
      if (FIXTURES) { try { return send(res, 200, mission.lights(scenario)); } catch (e) { return send(res, e.status || 503, { ok: false, error: e.message }); } }
      if (mission.snapshot().bitcube?.value?.online === false) return send(res, 503, { ok: false, error: 'bitcube is offline: no frames' });
      const r = await lights.frames();
      if (!r || r.ok === false || !r.frames) return send(res, 503, plainLightsError(r?.error));
      return send(res, 200, r);
    }
    if (path === '/api/pixelmap') return send(res, 200, await pixelmapPayload(scenario));
    if (path === '/api/calibration') {
      if (FIXTURES) return send(res, 200, mission.calibration(scenario));
      const r = await lights.calibration();
      if (!r || (r.ok === false && !('running' in r))) return send(res, 503, { ok: false, error: `Can't read the calibration: ${plainLightsError(r?.error).error.replace(/: no frames$/, '')}`, raw: r?.error ?? null });
      return send(res, 200, r);
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
      const action = m[1];
      const b = await body(req);
      // a control's body is a JSON object; anything else (null, a list, a number) is refused before it is run or recorded
      if (!isObject(b)) return send(res, 400, { error: NOT_OBJECT });
      try {
        let r;
        if (action === 'calibrate') {
          const outcome = CALIBRATION_OUTCOMES.includes(url.searchParams.get('calib')) ? url.searchParams.get('calib') : CALIBRATION_OUTCOMES.includes(cookies.calib) ? cookies.calib : 'ok';
          r = FIXTURES ? await mission.calibrate(b.action, b, { scenario, outcome }) : await lights.calibrate(b.action, b);
        } else if (action === 'check') r = await checkNow(scenario);
        else r = await mission.control(action, b, scenario);   // fixture mode: that scenario's own world (a scripted calibration blocks as live)
        recordAction(scenario, action, b, r);
        return send(res, 200, r);
      } catch (e) {
        if (!e.status || e.status >= 500) recordAction(scenario, action, b, null, e);      // a refused request (400, 429) never happened
        return send(res, e.status || 502, { error: e.message });
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`mission control on http://127.0.0.1:${server.address().port} (state in ${STATE}, agent in ${REPO}${FIXTURES ? `, fixtures from ${FIXTURES}` : ''})`));
const quit = () => { mission.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', quit); process.on('SIGINT', quit);
