// The studio chat's step lines (docs/mission-ui.md, "Studio chat" and "Copy rules"): one line per tool the agent used, in the
// team's words, for the activity lines under a request. The agent writes its own Bash descriptions, in whatever words it likes;
// here they become plain past-tense lines in the glossary's words, or a plain fallback ("ran a command on bitcube") when the
// jargon can't be put into words. The raw line (the command, the path, the address) is kept apart, scrubbed of logins, for the
// step's tooltip, never on the line itself.
//
// describeTool(block) -> { text, raw, acting }
//   text    the line the page shows ("checked TouchDesigner's frame rate and errors")
//   raw     what the tool was given (a command, a path, a URL, a pattern), logins scrubbed, at most RAW_MAX characters
//   acting  true only when the step changes something on the installation (set, switched, restarted, turned, …); reading,
//           checking and changing a file in the repo are not acting
// No SDK import here: the fake agent (MISSION_FAKE_AGENT) uses it too.
import { scrubCreds } from './scrub.mjs';
import { FILES } from '../public/model.js';

export const TEXT_MAX = 100;
export const RAW_MAX = 300;
/** Words the copy rules keep off the page (mission-ui.md "Sentences" and "Names"); a line still holding one is replaced. */
export const BANNED = /\b(fps|tcp|ssh|vnc|rtsp|psac10|probe|oserror|art-?net|wmi|http|https|json|null|undefined|epoch|toe|td|bridge|colorlight|gl\.inet|ffmpeg|pixelmap|gray code|ingest|modal|stdout|stderr|powershell|pwsh|grep|python3?|node|npm)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|:\d{2,5}\b|:\/\/|\.(?:py|ps1|mjs|js|json|toe|cmd|sh|log)\b/i;

const PAST = { check: 'checked', run: 'ran', restart: 'restarted', set: 'set', switch: 'switched', list: 'listed', show: 'showed', get: 'got',
  fetch: 'fetched', pull: 'pulled', push: 'pushed', save: 'saved', rebuild: 'rebuilt', start: 'started', stop: 'stopped', open: 'opened',
  read: 'looked at', look: 'looked', capture: 'captured', take: 'took', grab: 'grabbed', make: 'made', turn: 'turned', send: 'sent', test: 'tested',
  verify: 'verified', compare: 'compared', count: 'counted', find: 'found', search: 'searched', print: 'printed', query: 'queried',
  update: 'updated', install: 'installed', write: 'wrote', create: 'created', delete: 'deleted', remove: 'removed', kill: 'killed',
  tail: 'looked at the end of', ping: 'pinged', inspect: 'inspected', measure: 'measured', confirm: 'confirmed', report: 'reported', wait: 'waited',
  commit: 'committed', build: 'built', render: 'rendered', dim: 'dimmed', raise: 'raised', lower: 'lowered', ask: 'asked', call: 'called',
  change: 'changed', reset: 'reset', apply: 'applied', move: 'moved', aim: 'aimed', light: 'lit', enable: 'enabled', disable: 'disabled',
  reboot: 'rebooted', put: 'put', watch: 'watched', see: 'saw', try: 'tried', copy: 'copied', fix: 'fixed', add: 'added', edit: 'edited',
  view: 'viewed', note: 'noted', reload: 'reloaded', cancel: 'cancelled', calibrate: 'calibrated', bring: 'brought', go: 'went', use: 'used' };
/** Verbs that change something on the installation: only these lines are acting lines (highlighted on the page). */
const CHANGE = new Set(['set', 'switch', 'restart', 'turn', 'start', 'stop', 'kill', 'rebuild', 'dim', 'raise', 'lower', 'move', 'aim',
  'reboot', 'change', 'reset', 'apply', 'light', 'enable', 'disable', 'put', 'reload', 'cancel', 'calibrate', 'send', 'save']);
const RAW_CMD = /[|;&`$<>{}]|^\s*(ssh|scp|powershell|pwsh|python3?|node|git|curl|ffmpeg|ls|dir|cat|type|grep|tail|head|cd|npm|pytest|tasklist|Get-[A-Z]\w+)\b/;

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
/** Scrub, then clip: a cut made first could leave half a login the scrubber no longer recognises. */
const rawOf = (s) => clip(scrubCreds(String(s ?? '')), RAW_MAX);

/** A file the agent read or changed, in plain words ("the calibration script", "the repo's notes"): never a path or a name. */
export function plainFile(path) {
  const p = String(path ?? '').trim().replace(/\\/g, '/'), f = p.split('/').pop().toLowerCase();
  if (FILES[p.split('/').pop()]) return FILES[p.split('/').pop()].label;
  if (/\.toe$/.test(f)) return 'a show file';
  if (/^calibrate\.(py|ps1)$/.test(f)) return 'the calibration script';
  if (/^(td|td_save|td_mission)\.(ps1|py)$/.test(f)) return 'the TouchDesigner script';
  if (/^probe\.ps1$/.test(f)) return 'the full-check script';
  if (/^frames\.ps1$/.test(f)) return 'the script that reads the lights';
  if (f === 'claude.md') return "the repo's notes";
  if (f === 'glossary.md') return 'the glossary';
  if (f === 'studio.md') return 'its own brief';
  if (/\/sessions\//.test(p)) return 'the session notes';
  if (/plan\.md$/.test(f)) return 'the plan';
  if (/\.md$/.test(f)) return 'the docs';
  if (f === 'system.json') return 'the system map';
  if (f === 'boot-file.txt') return 'the boot file setting';
  if (/^(pixelmap|screens)-.*\.json$/.test(f)) return 'the LED map';
  if (/\.log$/.test(f)) return 'a log';
  if (/(^|\/)mission\//.test(p)) return "mission control's code";
  if (/(^|\/)td\//.test(p)) return "the show file's code";
  if (/(^|\/)tools\/pixelmap\//.test(p)) return 'the LED map tools';
  if (/\.(py|ps1|mjs|js|sh|cmd)$/.test(f)) return 'a script';
  if (/\.(json|ya?ml|ini|cfg|conf)$/.test(f)) return 'a settings file';
  return 'a file';
}

const PATH = /(?:\bthe )?(?:[A-Za-z]:)?(?:[\w.~-]*[\\/])+[\w.-]+|(?:\bthe )?\b[\w-]+\.(?:md|py|ps1|mjs|js|json|cmd|sh|txt|log|ya?ml|toe)\b/g;
// The copy rules' names, in order (earlier rules see the raw words). Each is [pattern, replacement].
const WORDS = [
  [/https?:\/\/[^\s"'<>]*modal\.run[^\s"'<>]*/gi, "Dave's agent's page"],
  [/https?:\/\/[^\s"'<>]+/gi, 'a web page'],
  [/\b(?:the )?(?:TD|TouchDesigner)(?:'s)? (?:fps|frame ?rate)\b/gi, "TouchDesigner's frame rate"],
  [/\b(\d+(?:\.\d+)?) ?fps\b/gi, '$1 frames a second'],
  [/\bfps\b/gi, 'frame rate'],
  [/\s*\b(?:via|through|over|using|with) (?:the )?(?:TD |TouchDesigner )?bridge\b/gi, ''],
  [/\s*\b(?:via|through|over|using|with) (?:SSH|VNC)\b/gi, ''],
  [/\b(?:a |the )?(?:VNC )?screen ?shot of bitcube(?:'s (?:screen|desktop|console))?/gi, "a picture of bitcube's screen"],
  [/\b(?:a |the )?VNC screen ?shot\b/gi, "a picture of bitcube's screen"],
  [/\bscreen ?shot\b/gi, 'picture of the screen'],
  [/\b(?:run |ran )?(?:the )?probe(?:\.ps1)?(?: on bitcube)?\b/gi, (m) => `${/^r(u|a)n /i.test(m) ? m.slice(0, 4) : ''}the full check of bitcube`],
  [/^(?:ssh|connect|log ?in) ?(?:in)?to bitcube(?: and| to|,)? +(.+)$/i, (_m, rest) => (/bitcube/i.test(rest) ? rest : `${rest} on bitcube`)],
  [/\bTD\b/g, 'TouchDesigner'],
  [/\b(?:the )?Modal agent\b/gi, "Dave's agent"],
  [/\bModal(?:'s)? (status|state|tick|scene|mood)\b/gi, "Dave's agent's $1"],
  [/\bDave's agent (status|state|tick|scene|mood)\b/g, "Dave's agent's $1"],
  [/\b(?:the )?HUB75(?: LED)?(?: panels?)?\b/gi, 'the panels'],
  [/\b(?:the )?PSAC10 boxes\b|\b(?:the )?PSAC10s\b/gi, 'the rope boxes'],
  [/\b(?:the )?PSAC10(?: box)?\b/gi, 'a rope box'],
  [/\s*\bJSON\b/g, ''],
  [/\bthe the\b/gi, 'the'],
];
/** Free text in the copy rules' words: show files by their names, files as what they are, the gear by the glossary. */
export function plainWords(s) {
  let out = String(s ?? '').replace(/\b(run|ran) (?:the )?(?:[\w.~-]*[\\/])*probe(?:\.ps1)?\b(?: on bitcube)?/gi, '$1 the full check of bitcube');
  for (const name of Object.keys(FILES)) out = out.split(name).join(FILES[name].label);
  out = out.replace(/\b[\w-]+\.toe\b/g, 'a show file');
  out = out.replace(PATH, (m) => plainFile(m.replace(/^the /i, '')));
  for (const [re, to] of WORDS) out = out.replace(re, to);
  // "Check the panels brightness" reads as the copy wants; tidy what the rules left
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

/** "Check bitcube" -> ["checked bitcube", "check"]; the first word is the verb when it is one we know. */
function pastTense(s) {
  const m = String(s).match(/^([A-Za-z]+)(\b[\s\S]*)$/);
  if (!m) return [s, null];
  const v = m[1].toLowerCase();
  if (PAST[v]) return [`${PAST[v]}${m[2]}`, v];
  return [/^[A-Z][a-z]/.test(m[1]) ? m[1].toLowerCase() + m[2] : s, null];
}

/** A Bash step: the agent's description in plain words, else a plain fallback. */
function bashLine(description, command) {
  const desc = String(description ?? '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const onBitcube = /bitcube|\bssh\b/i.test(`${desc} ${command ?? ''}`);
  const fallback = { text: onBitcube ? 'ran a command on bitcube' : 'ran a command', acting: false };
  if (!desc || RAW_CMD.test(desc)) return fallback;
  const [first, verb] = pastTense(plainWords(desc));
  // "Commit and push the plan": every verb of a list in the past tense, not only the first
  const verbs = verb ? [verb] : [];
  const past = (m, j, w) => (PAST[w] ? (verbs.push(w), `${j}${PAST[w]}`) : m);
  const line = first.replace(/\b((?:and|then) )([a-z]+)\b/g, past).replace(/(, )([a-z]+)\b/g, past);
  if (!line || BANNED.test(line)) return fallback;
  return { text: clip(line, TEXT_MAX), acting: verbs.some((v) => CHANGE.has(v)) };
}

/** One step line for a tool the agent used (see the header). Never throws. */
export function describeTool(block) {
  const i = block?.input && typeof block.input === 'object' ? block.input : {};
  const line = (text, raw, acting = false) => ({ text: clip(text, TEXT_MAX), raw: rawOf(raw), acting });
  try {
    switch (block?.name) {
      case 'Bash': { const b = bashLine(i.description, i.command); return line(b.text, i.command ?? i.description ?? '', b.acting); }
      case 'Read': return line(`looked at ${plainFile(i.file_path)}`, i.file_path);
      case 'Edit': case 'Write': case 'NotebookEdit': return line(`changed ${plainFile(i.file_path ?? i.notebook_path)}`, i.file_path ?? i.notebook_path);
      case 'Glob': case 'Grep': return line('searched the repo', i.pattern);
      case 'WebFetch': return line(/modal\.run/i.test(String(i.url)) ? "looked at what Dave's agent is doing" : 'looked something up online', i.url);
      case 'WebSearch': { const q = plainWords(clip(i.query, 60)); return line(q && !BANNED.test(q) ? `searched the web for ${q}` : 'searched the web', i.query); }
      case 'TodoWrite': return line('updated its to-do list', '');
      case 'Agent': case 'Task': {
        const d = plainWords(clip(i.description, 60)).replace(/[.\s]+$/, '');
        return line(d && !BANNED.test(d) ? `asked a helper to ${d[0].toLowerCase()}${d.slice(1)}` : 'asked a helper', i.description);
      }
      default: return line('used a tool', `${block?.name ?? 'a tool'}${Object.keys(i).length ? ' ' + JSON.stringify(i) : ''}`);
    }
  } catch { return { text: 'used a tool', raw: '', acting: false }; }
}
