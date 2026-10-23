// Mission control + studio chat server (docs/mission-plan.md). Listens on 127.0.0.1 only; Tailscale Funnel
// puts it online at https://gav-m1-mini.tailddc624.ts.net. Configured by environment variables:
//   MISSION_PORT            8790
//   MISSION_PASSWORD_FILE   the shared team password (same as bitcube's login), e.g. /Users/river/.secrets/site-password
//   MISSION_TOKEN_FILE      Claude token from `claude setup-token` (optional until M7: without it the chat says so)
//   MISSION_STATE_DIR       sessions, chat history, agent session id, logs
//   MISSION_REPO            the studio agent's working folder (its clone of river-bitcube)
//   MISSION_FAKE_AGENT=1    a pretend agent, for testing the pages without spending tokens
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Auth, readPasswordFile, parseCookies, SESSION_MAX_AGE_S } from './lib/auth.mjs';
import { Studio } from './lib/studio.mjs';
import { Mission } from './lib/mission.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.MISSION_PORT || 8790);
const STATE = env.MISSION_STATE_DIR || join(HERE, '..', '..', 'mission-state');
const REPO = env.MISSION_REPO || join(HERE, '..');
const COOKIE = 'mc';

// Running as river: keep its Claude user files in step with the repo (no sudo needed: it's river's own home).
if (userInfo().username === 'river') {
  const home = userInfo().homedir;
  mkdirSync(join(home, '.claude'), { recursive: true, mode: 0o700 });
  copyFileSync(join(HERE, 'setup', 'river-CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'));
  copyFileSync(join(HERE, 'setup', 'river-claude-settings.json'), join(home, '.claude', 'settings.json'));
}

// Self-update: when a pull brings new mission/ code, restart (launchd starts us again) as soon as the chat is idle.
const missionTree = () => { try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD:mission'], { encoding: 'utf8' }).trim(); } catch { return null; } };
const BOOT_TREE = missionTree();
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
    return async function* ({ text, resume, signal }) {
      yield { kind: 'session', sessionId: resume ?? 'fake-session' };
      for (const step of ['read CLAUDE.md', 'ran: Check bitcube is online']) {
        await new Promise((r) => setTimeout(r, 700));
        if (signal.aborted) return;
        yield { kind: 'activity', text: step };
      }
      yield { kind: 'text', text: `(pretend agent) You said: ${text}` };
      yield { kind: 'result', ok: true, text: '', cost: 0, turns: 1 };
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
const mission = new Mission();
mission.start();
studio.on('status', (st) => { if (restartPending && !st.running && !st.queue.length) { console.log('restarting for new code'); process.exit(0); } });
setInterval(async () => {
  if (studio.status().running || env.MISSION_FAKE_AGENT) return;
  const { syncRepo } = await import('./lib/agent.mjs');
  await syncRepo(REPO);
  checkForUpdate();
  if (restartPending && !studio.status().running && !studio.status().queue.length) { console.log('restarting for new code'); process.exit(0); }
}, 5 * 60_000).unref();

// ---- helpers ---------------------------------------------------------------------------------------------
const PAGES = { '/status': 'status.html', '/chat': 'chat.html', '/mission': 'mission.html', '/login': 'login.html' };
const STATIC = { '/app.css': ['app.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
const page = (name) => readFileSync(join(HERE, 'public', name));

function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
                          'referrer-policy': 'same-origin', 'x-frame-options': 'DENY', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function client(req) {
  // Funnel forwards the visitor's address; locally it's the socket's.
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
}

async function body(req, limit = 64_000) {
  let b = '';
  for await (const c of req) { b += c; if (b.length > limit) throw Object.assign(new Error('too large'), { status: 413 }); }
  if (!b) return {};
  if (String(req.headers['content-type']).includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(b));
  try { return JSON.parse(b); } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); }
}

function sameOrigin(req) {
  // State-changing requests must come from our own pages (cookie is SameSite=Lax; this is belt and braces).
  const o = req.headers.origin;
  return !o || o === `https://${req.headers.host}` || o === `http://${req.headers.host}`;
}

// ---- server ----------------------------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (STATIC[path]) return send(res, 200, page(STATIC[path][0]), STATIC[path][1]);
    if (path === '/login' && req.method === 'GET') return send(res, 200, page('login.html'), 'text/html; charset=utf-8');
    if (path === '/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'cross-origin' });
      const b = await body(req);
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

    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!auth.valid(token)) {
      if (path.startsWith('/api/')) return send(res, 401, { error: 'log in first' });
      return send(res, 302, '', 'text/plain', { location: '/login' });
    }
    if (path === '/logout' && req.method === 'POST') {
      auth.logout(token);
      return send(res, 200, { ok: true }, 'application/json', { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });
    }
    if (path === '/') return send(res, 302, '', 'text/plain', { location: '/status' });
    if (PAGES[path]) return send(res, 200, page(PAGES[path]), 'text/html; charset=utf-8');

    // studio chat
    if (path === '/api/chat/history') return send(res, 200, { events: studio.history(Number(url.searchParams.get('limit') || 500)), status: studio.status() });
    if (path === '/api/chat/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const push = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      const onEvent = (e) => push('chat', e);
      const onStatus = (s) => push('status', s);
      studio.on('event', onEvent); studio.on('status', onStatus);
      push('status', studio.status());
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { clearInterval(ping); studio.off('event', onEvent); studio.off('status', onStatus); });
      return;
    }
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'cross-origin' });
    if (path === '/api/chat/send' && req.method === 'POST') {
      const b = await body(req);
      try { return send(res, 200, { id: studio.send(b.text), status: studio.status() }); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (path === '/api/chat/stop' && req.method === 'POST') return send(res, 200, { stopped: studio.stop() });

    // mission control
    if (path === '/api/status') return send(res, 200, { ...mission.snapshot(), studio: studio.status() });
    const cam = path.match(/^\/api\/camera\/([a-z]+)\.jpg$/);
    if (cam) {
      const c = await mission.camera(cam[1]);
      if (!c.jpeg) return send(res, 503, { error: 'no picture from that camera right now' });
      return send(res, 200, c.jpeg, 'image/jpeg', { 'x-taken': new Date(c.at).toISOString() });
    }
    const m = path.match(/^\/api\/control\/([a-z0-9-]+)$/);
    if (m && req.method === 'POST') {
      try { return send(res, 200, await mission.control(m[1], await body(req))); }
      catch (e) { return send(res, e.status || 502, { error: e.message }); }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`mission control on http://127.0.0.1:${PORT} (state in ${STATE}, agent in ${REPO})`));
const quit = () => { mission.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', quit); process.on('SIGINT', quit);
