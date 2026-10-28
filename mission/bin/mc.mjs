#!/usr/bin/env node
// mc: the studio agent's way to change the installation, through mission control's local control socket (server.mjs), so a
// change from the chat gets the same whitelist, the same locks and the same 409 "wait: …" as a phone, shows on every page as
// Applying and Last done "from studio chat", and is refused while a calibration runs. mission/STUDIO.md tells the agent to use
// it, and only it, for every change; reading and looking over SSH stay as they are.
//
//   node mission/bin/mc.mjs status                          what mission control sees now: the verdict, what is being
//                                                           applied (with each entry's id), a calibration, the show file,
//                                                           what is blocked and why, and the server's verdicts: confirmed,
//                                                           expired and verdicts name the applying_id of each change that
//                                                           ended (done, or not shown in time: R8 #30)
//   node mission/bin/mc.mjs <action> ['<json body>']        one control, the body as a page sends it:
//     ropes '{"dark":true}'   hub75 '{"brightness":0.8}'   test '{"on":true}'   switch '{"file":"river-local-oct-22-seasons.toe"}'
//     bootfile '{"file":"river-online-oct-23.toe"}'   rebuild '{"file":"river-local-oct-22-seasons.toe"}'
//     lightsroute '{"route":"router"}'   mode '{"mode":"manual"}'   target '{"season":"summer","intensity":0.7}'
//     rules '{"rules":{"cycle_seconds":240}}'   rules-reset   check   calibrate '{"action":"start"}'   calibrate '{"action":"cancel"}'
//     modalinput '{"source":"scene","strength":0.6}'   (only while Combined with Modal Input Selector runs; source off, canvas,
//                                                       scene or frames; strength 0 to 1)
//     filling '{"palette":"midnight","brightness":0.8,"intensity":0.6,"speed":1}'   (only while the filling glass runs; palette
//                                                       river, glacier, midnight or teal; brightness and intensity 0 to 1; speed
//                                                       0.25 to 3, 1 = about 84 s a cycle; all four every time)
//     remembered-zones '{"light":"pool","pool_height_m":0.6}'   remembered-opening '{"on":true}'   (only while the remembered
//                                                       river runs, or is the look showing in the river (all looks); light off,
//                                                       pool or eddies; the pool line 0 to 1.5 m)
//     remembered-screens '{"intensity":0.82,"threshold":0.35,"video":0.15}'   (the same, any of the three, each 0 to 1:
//                                                       the screens' intensity, their motion threshold, and how strongly
//                                                       the river video shows under the particle windows)
//     looks '{"mode":"auto"}'   looks '{"mode":"manual","look":"fill-simple"}'   (only while the river (all looks) runs; auto:
//                                                       four loops of the remembered river, then one cycle of Fill my cup
//                                                       (simple), again; manual: fade to remembered, fill-simple or
//                                                       fill-configurable and stay; status shows it under `looks`)
//
// Prints mission control's JSON answer, with the request_id it sent (its own id for this request: status names the entry by it
// too, so a change whose answer was lost can still be found). A change that waits for bitcube's reading (a switch, a rebuild, a
// boot-file or lighting port change, a calibration start) is done only when status's confirmed (or verdicts) names its
// applying_id; expired means bitcube didn't show it in time. Exit 0: answered OK (ok); 1: refused, failed or may not have
// happened (the answer says which: a 409 "wait: …" means try again when that is done; maybe: true means look at status before
// trying again); 2: a usage error,
// or mission control isn't answering on its socket. The socket: MISSION_CONTROL_SOCKET (the server sets it for the agent), else
// $MISSION_STATE_DIR/mc.sock, else ~/mission-state/mc.sock.
import { request } from 'node:http';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACTIONS = ['ropes', 'hub75', 'test', 'switch', 'bootfile', 'rebuild', 'lightsroute', 'mode', 'target', 'rules', 'rules-reset', 'check', 'calibrate', 'modalinput', 'filling', 'remembered-zones', 'remembered-opening', 'remembered-screens', 'looks'];
const LIMIT_S = { status: 10, rebuild: 420 };          // a rebuild builds, saves and restarts: minutes; the rest a little past 60 s
const socketPath = (env) => env.MISSION_CONTROL_SOCKET || join(env.MISSION_STATE_DIR || join(homedir(), 'mission-state'), 'mc.sock');

const USAGE = `usage: node mission/bin/mc.mjs status
       node mission/bin/mc.mjs <action> ['<json body>']     actions: ${ACTIONS.join(', ')}
Run status first; when something is being applied or a calibration runs, wait for it (or say so) instead of retrying.
A change is done when status's confirmed (or verdicts) names its applying_id; expired: bitcube didn't show it in time.
Stop a calibration with: calibrate '{"action":"cancel"}' (recorded as the studio chat's).`;

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
  // this request's own id: the entry carries it, so a change whose answer is lost is still found in status (R8 #2, #30)
  const requestId = `mc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const r = await call(socket, 'POST', `/control/${cmd}`, { ...body, request_id: requestId }, LIMIT_S[cmd] ?? 75);
  if (r.unreachable) return { code: 2, out: JSON.stringify(r.body, null, 2) };
  return { code: r.status === 200 && r.body?.ok !== false ? 0 : 1, out: JSON.stringify({ status: r.status || null, request_id: requestId, ...r.body }, null, 2) };
}

const runAsScript = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (runAsScript) {
  const { code, out } = await main(process.argv.slice(2));
  (code === 2 && !out.startsWith('{') ? process.stderr : process.stdout).write(out + '\n');
  process.exit(code);
}
