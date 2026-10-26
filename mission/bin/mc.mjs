#!/usr/bin/env node
// mc: the studio agent's way to change the installation, through mission control's local control socket (server.mjs), so a
// change from the chat gets the same whitelist, the same locks and the same 409 "wait: …" as a phone, shows on every page as
// Applying and Last done "from studio chat", and is refused while a calibration runs. mission/STUDIO.md tells the agent to use
// it, and only it, for every change; reading and looking over SSH stay as they are.
//
//   node mission/bin/mc.mjs status                          what mission control sees now: the verdict, what is being
//                                                           applied, a calibration, the show file, what is blocked and why
//   node mission/bin/mc.mjs <action> ['<json body>']        one control, the body as a page sends it:
//     ropes '{"dark":true}'   hub75 '{"brightness":0.8}'   switch '{"file":"river-local-oct-22-seasons.toe"}'
//     bootfile '{"file":"river-online-oct-23.toe"}'   rebuild '{"file":"river-local-oct-22-seasons.toe"}'
//     lightsroute '{"route":"router"}'   mode '{"mode":"manual"}'   target '{"season":"summer","intensity":0.7}'
//     rules '{"rules":{"cycle_seconds":240}}'   rules-reset   check   calibrate '{"action":"start"}'
//   A calibration is stopped on the Lights page, by a person: calibrate '{"action":"cancel"}' is refused here (403).
//
// Prints mission control's JSON answer. Exit 0: done (ok); 1: refused, failed or may not have happened (the answer says which:
// a 409 "wait: …" means try again when that is done; maybe: true means look at status before trying again); 2: a usage error,
// or mission control isn't answering on its socket. The socket: MISSION_CONTROL_SOCKET (the server sets it for the agent), else
// $MISSION_STATE_DIR/mc.sock, else ~/mission-state/mc.sock.
import { request } from 'node:http';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACTIONS = ['ropes', 'hub75', 'switch', 'bootfile', 'rebuild', 'lightsroute', 'mode', 'target', 'rules', 'rules-reset', 'check', 'calibrate'];
const LIMIT_S = { status: 10, rebuild: 420 };          // a rebuild builds, saves and restarts: minutes; the rest a little past 60 s
const socketPath = (env) => env.MISSION_CONTROL_SOCKET || join(env.MISSION_STATE_DIR || join(homedir(), 'mission-state'), 'mc.sock');

const USAGE = `usage: node mission/bin/mc.mjs status
       node mission/bin/mc.mjs <action> ['<json body>']     actions: ${ACTIONS.join(', ')}
Run status first; when something is being applied or a calibration runs, wait for it (or say so) instead of retrying.
A calibration is stopped on the Lights page, by a person: the chat can't stop one.`;

/** One request over the socket -> { status, body } (body: the parsed JSON, or { ok: false, error } in words). */
export function call(socket, method, path, body, limitS) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = request({ socketPath: socket, method, path, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, body: { ok: false, error: "mission control's answer couldn't be read" } }); }
      });
    });
    req.setTimeout(limitS * 1000, () => {
      req.destroy();
      resolve({ status: 0, body: { ok: false, maybe: method === 'POST', error: `no answer from mission control in ${limitS} s${method === 'POST' ? ': it may or may not have happened; run status' : ''}` } });
    });
    req.on('error', (e) => resolve({ status: 0, unreachable: true, body: { ok: false, error: `mission control isn't answering on ${socket} (${e.code ?? e.message}); is it running?` } }));
    if (data) req.write(data);
    req.end();
  });
}

/** argv (after the script) -> { code, out }: what to print, and the exit code (see the header). */
export async function main(argv, env = process.env) {
  const [cmd, json, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return { code: cmd ? 0 : 2, out: USAGE };
  const socket = socketPath(env);
  if (cmd === 'status') {
    if (json !== undefined) return { code: 2, out: USAGE };
    const r = await call(socket, 'GET', '/status', undefined, LIMIT_S.status);
    return { code: r.status === 200 ? 0 : 2, out: JSON.stringify(r.body, null, 2) };
  }
  if (!ACTIONS.includes(cmd) || rest.length) return { code: 2, out: `unknown action "${cmd}"\n${USAGE}` };
  let body = {};
  if (json !== undefined && json !== '') {
    try { body = JSON.parse(json); } catch { return { code: 2, out: `the body is not JSON: ${json}\n${USAGE}` }; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { code: 2, out: `the body must be a JSON object, like '{"dark":true}'\n${USAGE}` };
  }
  const r = await call(socket, 'POST', `/control/${cmd}`, body, LIMIT_S[cmd] ?? 75);
  if (r.unreachable) return { code: 2, out: JSON.stringify(r.body, null, 2) };
  return { code: r.status === 200 && r.body?.ok !== false ? 0 : 1, out: JSON.stringify({ status: r.status || null, ...r.body }, null, 2) };
}

const runAsScript = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (runAsScript) {
  const { code, out } = await main(process.argv.slice(2));
  (code === 2 && !out.startsWith('{') ? process.stderr : process.stdout).write(out + '\n');
  process.exit(code);
}
