// Studio chat's words (docs/mission-ui.md, "Studio chat" and "Copy rules"): a request's state from its events and the
// live status, each activity line in the team's words, and the steps toggle's name. Pure ES module, no DOM: chat.js uses it
// in the browser and test/chat.test.mjs under node --test.
import { FILES } from './model.js';

export const excerpt = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// ---- a request's state ----------------------------------------------------------------------------------------------
/** A request's state from its events and the live status: waiting (with its place), working, done, stopped, failed, or
 *  unknown ("Not finished": the server moved on without a verdict).
 *  `r`: { id, started, startedArrivedAt, arrivedAt, result, stopped, failed, error } (arrival times on the page's
 *  performance.now() clock); `status`: studio.status() ({ running, current, queue }); `statusAt`: when it arrived. */
export function stateOf(r, status, { statusAt = 0, lost = false } = {}) {
  if (r.failed) return { s: 'failed', t: r.failed.t, reason: r.failed.text };
  if (r.stopped) return { s: 'stopped', t: r.stopped };
  if (r.result) {
    if (r.result.ok) return { s: 'done', t: r.result.t };
    return { s: 'failed', t: r.result.t, reason: plainFailure(r.result.text || r.error) };
  }
  if (r.error && !status?.running) return { s: 'failed', t: r.t, reason: plainFailure(r.error) };
  const st = status;
  if (st?.current?.id === r.id) return { s: 'working' };
  const qi = st?.queue?.findIndex((q) => q.id === r.id) ?? -1;
  if (qi >= 0) return { s: 'waiting', place: qi + 1 };
  // an event newer than the last status (the server writes 'user', 'started' and the status separately, and a slow link
  // can deliver them apart) is judged by what it says, never against a status from before it: "Not finished" only once a
  // status from after it says nothing is running
  const newer = (at) => at != null && at > statusAt;
  if (r.started && st && !st.running && !lost) return newer(r.startedArrivedAt) ? { s: 'working' } : { s: 'unknown' };
  if (!r.started && st && !lost) return newer(r.arrivedAt) ? { s: 'waiting', place: null } : { s: 'unknown' };
  return r.started ? { s: 'working' } : { s: 'waiting', place: null };
}

/** Why a run failed, in the team's words (the same table as lib/studio.mjs, for history written before 'failed' events). */
export function plainFailure(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'the agent stopped with an error';
  if (/ssh|connect to host|port 22|bitcube did not answer|bitcube didn't answer/i.test(s)) return "bitcube didn't answer";
  if (/no claude token|setup-token/i.test(s)) return 'the agent has no token yet';
  if (/timed? ?out|timeout|took too long/i.test(s)) return 'it took too long';
  if (/rate limit|overloaded|529|too many requests/i.test(s)) return 'the agent is busy; try again in a minute';
  if (/quota|budget|credit|billing/i.test(s)) return 'the agent is out of credit';
  if (/network|ENOTFOUND|ECONN|fetch failed/i.test(s)) return "the agent couldn't reach the internet";
  if (/^the agent|^bitcube|^it took/i.test(s)) return s.replace(/[.\s]+$/, '');
  return 'the agent stopped with an error';
}

// ---- activity lines in the team's words ----------------------------------------------------------------------------
const PAST = { check: 'checked', run: 'ran', restart: 'restarted', set: 'set', switch: 'switched', list: 'listed', show: 'showed', get: 'got',
  fetch: 'fetched', pull: 'pulled', push: 'pushed', save: 'saved', rebuild: 'rebuilt', start: 'started', stop: 'stopped', open: 'opened',
  read: 'read', look: 'looked', capture: 'captured', take: 'took', grab: 'grabbed', make: 'made', turn: 'turned', send: 'sent', test: 'tested',
  verify: 'verified', compare: 'compared', count: 'counted', find: 'found', search: 'searched', print: 'printed', query: 'queried',
  update: 'updated', install: 'installed', write: 'wrote', create: 'created', delete: 'deleted', remove: 'removed', kill: 'killed',
  tail: 'read the end of', ping: 'pinged', inspect: 'inspected', measure: 'measured', confirm: 'confirmed', report: 'reported', wait: 'waited',
  commit: 'committed', build: 'built', render: 'rendered', dim: 'dimmed', raise: 'raised', lower: 'lowered', ask: 'asked', call: 'called',
  connect: 'connected', reboot: 'rebooted', reset: 'reset', apply: 'applied', change: 'changed', move: 'moved', aim: 'aimed', watch: 'watched',
  calibrate: 'calibrated', load: 'loaded', reload: 'reloaded', see: 'saw', try: 'tried', retry: 'retried', copy: 'copied', note: 'noted' };
// the things that make up the installation: a change to one of these is "acting" (highlighted); looking at them is not
const ACTS = /\b(bitcube|touchdesigner|td|td\.ps1|td_save|show file|river's year|live river|ropes?|rope box(es)?|psac-?10s?|panels?|hub75|brightness|lights?|camera|cam|router|season|mode|target|rules|artnet|art-net|sender|boot file|calibration|led map|recorder|ffmpeg|people counter|ptz|start-river|scheduled task|source|black|dark)\b/i;
// a change: the line leads with one of these, or says it ran something "to" do one ("Run td.ps1 to set Source=black")
const CHANGE = 'set|switch(?:ed)?|restart(?:ed)?|reboot(?:ed)?|turn(?:ed)?|start(?:ed)?|stop(?:ped)?|change[d]?|rebuil[dt]|raise[d]?|lower(?:ed)?|dim(?:med)?|kill(?:ed)?|send|sent|appl(?:y|ied)|calibrate[d]?|reset|power(?:ed)?|enable[d]?|disable[d]?|save[d]?|move[d]?|aim(?:ed)?|pan(?:ned)?|tilt(?:ed)?';
const LEAD_CHANGE = new RegExp(`^(?:${CHANGE})\\b`, 'i'), TO_CHANGE = new RegExp(`\\bto (?:${CHANGE})\\b`, 'i');
const actOf = (desc) => (LEAD_CHANGE.test(desc.trim()) || TO_CHANGE.test(desc)) && ACTS.test(desc);
const RAW_CMD = /[|;&`$<>{}]|^\s*(ssh|scp|powershell|pwsh|python3?|node|git|curl|ffmpeg|ls|cat|grep|tail|head|cd|npm|pytest|jq|rg|find|sed|awk)\b/;
const CHANGE_CMD = /-Action\s+(ropes|hub75|switch|bootfile|lightsroute|rebuild|calibrate|mode|target|rules)|\/api\/control\/|Restart-Computer|Stop-Process|Start-Process|taskkill|\bkill\b|schtasks\s+\/(run|end|change)|ptz\.py|td_save/i;

/** Words the team never reads on the main view (docs/mission-ui.md, "Copy rules"), and anything that looks like code. */
const JARGON = /\b(TD|fps|tcp|udp|ssh|vnc|rtsp|psac-?10s?|probe|oserror|art-?net|artnet|wmi|https?|json|null|undefined|epoch|toe|bridge|modal|ffmpeg|pixelmap|colorlight|reolink|gl\.?inet|claude|uplink|wan|ToolSearch)\b/i;
const CODE = /[|\\{}=`$<>~#]|\.(ps1|py|toe|json|mjs|js|md|sh|cmd|bat|log|txt|csv)\b|https?:|\/\w|\w_\w|\b[a-z]+[A-Z]\w*|\b[A-Z][a-z]+[A-Z]\w*|\d+\.\d+\.\d+\.\d+|:\d{2,5}\b|(^|\s)--?[A-Za-z]/;
const bad = (s) => JARGON.test(s) || CODE.test(String(s).replace(/TouchDesigner/g, 'Touchdesigner'));

/** A file the agent read or changed, in plain words ("the calibration script", "the repo's notes"): never a path or a file
 *  name on the page (the raw line stays in the step's tooltip). */
export function plainFile(path) {
  const p = String(path ?? '').trim().replace(/\\/g, '/'), f = p.split('/').pop().toLowerCase();
  if (FILES[f]) return FILES[f].label;
  if (/^calibrate\.(py|ps1)$/.test(f)) return 'the calibration script';
  if (/^(td|td_save|td_mission)\.(ps1|py)$/.test(f)) return 'the TouchDesigner script';
  if (/^probe\.ps1$/.test(f)) return 'the full-check script';
  if (/^frames\.ps1$/.test(f)) return 'the script that reads the lights';
  if (/^capture\.py$/.test(f)) return 'the camera script';
  if (/\.toe$/.test(f)) return 'a show file';
  if (f === 'claude.md') return "the repo's notes";
  if (f === 'glossary.md') return 'the glossary';
  if (/\/sessions\//.test(p)) return 'the session notes';
  if (/plan\.md$/.test(f)) return 'the plan';
  if (/\.md$/.test(f)) return 'the docs';
  if (/^system\.json$/.test(f)) return 'the system map';
  if (/^pixelmap-.*\.json$|^screens-.*\.json$/.test(f)) return 'the LED map';
  if (/(^|\/)mission\//.test(p)) return "mission control's code";
  if (/(^|\/)td\//.test(p)) return "the show file's code";
  if (/(^|\/)tools\/pixelmap\//.test(p)) return 'the LED map tools';
  if (/\.(py|ps1|mjs|js|sh|cmd|bat)$/.test(f)) return 'a script';
  if (/\.(json|ya?ml|ini|cfg|conf)$/.test(f)) return 'a settings file';
  if (/\.(log|txt)$/.test(f)) return 'a log';
  return 'a file';
}

const IPS = { '2.0.0.10': 'rope box 1', '2.0.0.11': 'rope box 2', '192.168.8.217': 'the river camera', '192.168.9.76': 'the gallery camera',
  '192.168.9.1': 'the router', '1.1.1.1': 'the internet' };
// The agent's own working words → the team's (GLOSSARY.md, the names table), in order: specific before general.
const SUBS = [
  [/\bhttps?:\/\/\S*modal\.run\S*/gi, "Dave's agent"],
  [/\bhttps?:\/\/\S+/gi, 'a web page'],
  [/(?:\b[A-Za-z]:)?(?:[\w.~-]*[\\/])+[\w.~-]+\.\w+|\b[\w.-]+\.(?:toe|ps1|py|mjs|js|sh|cmd|bat|json|ya?ml|ini|cfg|conf|log|txt|csv|md)\b/gi,
    (f) => (/(^|[\\/])probe\.ps1$/i.test(f) ? 'the full check' : plainFile(f))],
  [/\s+(?:on|at|to|from)\s+\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, ''],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, (ip) => IPS[ip.split(':')[0]] ?? 'an address'],
  [/\b(?:the )?(?:HTTP |seasons )?(?:control )?(?:page on |page at |port )?:?9981(?: page)?\b/gi, "the river's year page"],
  [/\b(?:the )?(?:TCP |UDP )?port \d+\b/gi, 'its port'],
  [/\b(?:TCP|UDP|HTTPS?)\s+/g, ''],
  [/\bTD fps\b/g, "TouchDesigner's frame rate"],
  [/(\d+)\s*fps\b/gi, '$1 frames a second'],
  [/\bfps\b/gi, 'frame rate'],
  [/\s*\b(?:via|through|over|with|using) (?:the )?(?:TD |TouchDesigner )?bridge\b/gi, ''],
  [/\b(?:the )?(?:TD |TouchDesigner )?bridge\b/gi, 'TouchDesigner'],
  [/\bTD's\b/g, "TouchDesigner's"],
  [/\bTD\b/g, 'TouchDesigner'],
  [/\b(?:a |the )?VNC screenshot(?: of (?:bitcube|the show PC))?/gi, "a picture of bitcube's screen"],
  [/\b(?:a |the )?screenshot of bitcube\b/gi, "a picture of bitcube's screen"],
  [/\b(?:over|via|through) VNC\b/gi, 'over screen sharing'],
  [/\bVNC\b/gi, 'screen sharing'],
  [/\s*\b(?:over|via|with) RTSP\b/gi, ''],
  [/\bRTSP\b/gi, 'video'],
  [/\b(?:the )?Reolink(?: camera| cam)?s?\b/gi, 'the camera'],
  [/\bPSAC-?10s\b/gi, 'rope boxes'],
  [/\bPSAC-?10 (box(?:es)?)\b/gi, 'rope $1'],
  [/\bPSAC-?10\b/gi, 'rope box'],
  [/\b(?:the )?Colorlight(?: sender)?\b/gi, 'the panel sender'],
  [/\bGL\.?iNet(?: router)?\b/gi, 'router'],
  [/\b(?:the )?art-?net(?:_out)?\b/gi, 'the rope signal'],
  [/\bModal state(?: JSON| file)?\b/g, "Dave's agent's state"],
  [/\bModal\b/g, "Dave's agent"],
  [/\bJSON\b/gi, 'data'],
  [/\bWMI\b/g, 'Windows'],
  [/\b(?:the )?ffmpeg\b/gi, 'the video tool'],
  [/\bpixel ?map\b/gi, 'LED map'],
  [/\bGray code\b/gi, 'patterns'],
  [/\bClaude\b/g, 'the agent'],
  [/\bOSError\b/g, 'an error'],
  [/\b(?:the )?uplink\b/gi, 'the internet'],
  [/\bprobe\b/gi, 'full check'],
];
const translate = (s) => SUBS.reduce((x, [re, to]) => x.replace(re, to), s).replace(/\s{2,}/g, ' ').trim();
/** The first word in the past tense, and a second verb after "and" too ("checked X and restarted Y"). */
function past(s) {
  const w = s.match(/^([A-Za-z]+)(\b.*)$/);
  let out = w ? `${PAST[w[1].toLowerCase()] ?? w[1].toLowerCase()}${w[2]}` : s;
  out = out.replace(/\b(and|then) ([a-z]+)\b/g, (m, a, v) => (PAST[v] ? `${a} ${PAST[v]}` : m));
  return out.replace(/[.\s]+$/, '');
}
/** The longest leading clause that reads plainly ("ran the TouchDesigner script to set Source=black…" → "ran the
 *  TouchDesigner script"), else null. */
function leadingClause(s) {
  const cuts = [...s.matchAll(/ (?:to|and|with|on|from|for|in|using|via|then|so) | \(|[:;,]/g)].map((m) => m.index).sort((a, b) => b - a);
  for (const i of cuts) { const head = s.slice(0, i).trim(); if (head.split(/\s+/).length >= 2 && !bad(head)) return head; }
  return null;
}
/** Free text the agent wrote about a step ("Check TD fps via the bridge"), as the team would say it, or `fallback`. */
function plainWords(desc, fallback, { asDone = true } = {}) {
  let s = String(desc ?? '').trim(), onBitcube = false;
  // "SSH to bitcube and run probe.ps1" → "run the full check" on bitcube
  const ssh = s.match(/^(?:ssh|connect) (?:in)?to (?:bitcube|the show pc)\b(?:,? and |, then |: | to |\s*$)?/i);
  if (ssh) { s = s.slice(ssh[0].length); onBitcube = true; if (!s) return 'connected to bitcube'; }
  if (/\b(?:over|via|through) ssh\b/i.test(s)) { s = s.replace(/\s*\b(?:over|via|through) ssh\b/gi, ''); onBitcube = true; }
  let t = asDone ? past(translate(s)) : translate(s).replace(/[.\s]+$/, '');
  if (onBitcube && !/bitcube/i.test(t)) t += ' on bitcube';
  if (!bad(t) && t) return t;
  return leadingClause(t) ?? fallback;
}

/** One raw activity line (lib/agent.mjs describeTool: "read X", "edited X", "ran: <what it says it does>", "searched for X",
 *  "fetched URL", "searched the web: Q", "asked a helper: X", "used Tool") → { text, act }: the team's words, never a path,
 *  a command, a URL or the agent's working words; `act` when the step changes the installation (highlighted). */
export function plainStep(raw) {
  const s = String(raw ?? '').trim();
  let m;
  if (!s) return { text: 'worked on it', act: false };
  if ((m = s.match(/^read (.+)$/i))) return { text: `looked at ${plainFile(m[1])}`, act: false };
  if ((m = s.match(/^edited (.+)$/i))) return { text: `changed ${plainFile(m[1])}`, act: false };
  if ((m = s.match(/^ran:\s*(.*)$/i))) {
    const y = m[1].trim();
    if (!y) return { text: 'ran a command', act: false };
    if (RAW_CMD.test(y)) return { text: /bitcube|ssh/i.test(y) ? 'ran a command on bitcube' : 'ran a command', act: CHANGE_CMD.test(y) };
    return { text: plainWords(y, /bitcube|ssh/i.test(y) ? 'ran a command on bitcube' : 'ran a command'), act: actOf(y.replace(/^(?:ssh|connect) (?:in)?to (?:bitcube|the show pc)\b(?:,? and |, then |: | to )?/i, '')) || CHANGE_CMD.test(y) };
  }
  if (/^synced the repo/i.test(s)) return { text: 'brought its copy of the repo up to date', act: false };
  if (/^couldn't sync the repo/i.test(s)) return { text: "couldn't bring its copy of the repo up to date; working from an older copy", act: false };
  if (/^searched for /i.test(s)) return { text: 'searched the repo', act: false };
  if ((m = s.match(/^searched the web:?\s*(.*)$/i))) return { text: m[1] && !bad(m[1]) ? `searched the web for ${m[1]}` : 'searched the web', act: false };
  if ((m = s.match(/^fetched (.+)$/i))) return { text: /modal\.run/i.test(m[1]) ? "looked at what Dave's agent posted" : 'looked something up online', act: false };
  if ((m = s.match(/^asked a helper:?\s*(.*)$/i))) {
    const w = m[1] ? plainWords(m[1].replace(/^[A-Z]/, (c) => c.toLowerCase()), '', { asDone: false }) : '';
    return { text: w ? `asked a helper to ${w.replace(/^[A-Z]/, (c) => c.toLowerCase())}` : 'asked a helper', act: false };
  }
  if (/^used /i.test(s)) return { text: 'used a tool', act: false };
  if (/^updated its to-do list$/i.test(s)) return { text: 'updated its to-do list', act: false };
  return { text: plainWords(s, 'worked on it'), act: actOf(s) };
}

/** An activity event, old or new shape → { text, title, act }. Old: `text` is the raw line (it becomes the tooltip, and the
 *  words are worked out here). New (lib/agent.mjs sending the team's words): `text` is already plain and `raw` carries the raw
 *  line for the tooltip; an `acting` boolean (or the older `act`), when sent, says whether it changed the installation. Either way the words pass the
 *  same guard, so a slip never puts a file name or a working word on the page. */
export function stepWords(e) {
  const text = typeof e?.text === 'string' ? e.text.trim() : '';
  // lib/steps.mjs sends `acting`; `act` is the older name
  const flag = typeof e?.acting === 'boolean' ? e.acting : typeof e?.act === 'boolean' ? e.act : null;
  if (typeof e?.raw === 'string') {
    const t = !text ? plainStep(e.raw).text : bad(text) ? plainWords(text, plainStep(e.raw).text) : text.replace(/[.\s]+$/, '');
    return { text: t, title: e.raw, act: flag ?? actOf(t) };
  }
  const p = plainStep(text);
  return { text: p.text, title: text, act: flag ?? p.act };
}

/** The "N steps" toggle: its visible words, and its accessible name starting with them (label in name: a Voice Control
 *  user says what they see), then which request it belongs to. */
export function stepsToggle(quiet, acting, ask) {
  const visible = `${quiet} ${quiet === 1 ? 'step' : 'steps'}${acting ? ' more' : ''}`;
  return { visible, label: `${visible}, for ‘${excerpt(ask || 'this request', 50)}’` };
}
