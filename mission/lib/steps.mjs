// The studio chat's step lines (docs/mission-ui.md, "Studio chat" and "Copy rules"): one line per tool the agent used, in the
// team's words, for the activity lines under a request. The agent writes its own Bash descriptions, in whatever words it likes;
// here they become plain past-tense lines in the glossary's words, or a plain fallback ("ran a command on bitcube") when the
// jargon can't be put into words. The raw line (the command, the path, the address) is kept apart, scrubbed of logins, for the
// step's tooltip, never on the line itself.
//
// describeTool(block, ctx) -> { text, raw, acting }   ctx: { running, calDry } (the live agent's: what TouchDesigner runs, a dry run going),
//                                                     or a function that returns it, asked only by a step that needs it (CR9 #18)
//   text    the line the page shows ("checked TouchDesigner's frame rate and errors")
//   raw     what the tool was given (a command, a path, a URL, a pattern), logins scrubbed, at most RAW_MAX characters
//   acting  true only when the step changes something on the installation (set, switched, restarted, turned, …); reading,
//           checking and changing a file in the repo are not acting
// Every input is scrubbed of logins BEFORE any words are made from it: a word rule that cut a URL first ("https://admin:pw@…"
// into "httpa file:pw@…") left a login the scrubber no longer recognised (round 6 #36). A line the page's own guard would
// reword (public/chat-words.js) is never sent: an acting line then says what it changed ("changed the ropes"), never only
// "worked on it" (round 6 #20). A change asked of mission control (node mission/bin/mc.mjs <action> '<body>') is named as the band
// and Last done name it ("asked mission control for the change of the ropes to dark", model.js changeLabel: R9 #22).
// No SDK import here: the fake agent (MISSION_FAKE_AGENT) uses it too.
import { scrubCreds } from './scrub.mjs';
import { FILES, changeLabel, EXPECT_S } from '../public/model.js';
import { ACTS } from '../public/chat-words.js';   // the things that make up the installation: one list for the server and the page

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
  view: 'viewed', note: 'noted', reload: 'reloaded', cancel: 'cancelled', calibrate: 'calibrated', bring: 'brought', go: 'went', use: 'used',
  pan: 'panned', tilt: 'tilted', power: 'powered' };
/** Verbs that change something on the installation: only these lines are acting lines (highlighted on the page). */
const CHANGE = new Set(['set', 'switch', 'restart', 'turn', 'start', 'stop', 'kill', 'rebuild', 'dim', 'raise', 'lower', 'move', 'aim',
  'reboot', 'change', 'reset', 'apply', 'light', 'enable', 'disable', 'put', 'reload', 'cancel', 'calibrate', 'send', 'save', 'pan', 'tilt', 'power']);
/** The page's own guard (public/chat-words.js `bad`): a line it would reword is never sent as it is. Kept equal by
 *  test/steps.test.mjs, which checks the page shows every line this file makes exactly as it was sent. */
const PAGE_JARGON = /\b(TD|fps|tcp|udp|ssh|vnc|rtsp|psac-?10s?|probe|oserror|art-?net|artnet|wmi|https?|json|null|undefined|epoch|toe|bridge|modal|ffmpeg|pixelmap|colorlight|reolink|gl\.?inet|claude|uplink|wan|ToolSearch)\b/i;
const PAGE_CODE = /[|\\{}=`$<>~#]|\.(ps1|py|toe|json|mjs|js|md|sh|cmd|bat|log|txt|csv)\b|https?:|\/\w|\w_\w|\b[a-z]+[A-Z]\w*|\b[A-Z][a-z]+[A-Z]\w*|\d+\.\d+\.\d+\.\d+|:\d{2,5}\b|(^|\s)--?[A-Za-z]/;
/** Whether a line can't be shown as it is: the copy rules' banned words, or what the page's guard rewords. */
export const unplain = (s) => BANNED.test(s) || PAGE_JARGON.test(s) || PAGE_CODE.test(String(s).replace(/TouchDesigner/g, 'Touchdesigner'));
/** What a change acted on, in the glossary's words, for an acting line whose own words can't be shown (first match wins). */
const THINGS = [
  [/\brope ?box(?:es)?\b|\bpsac-?10s?\b/i, 'a rope box'],
  [/\bropes?\b|\bsender\b|\bart-?net\b|\bsource\b|\bblack\b|\bdark\b|\bropelights\b|\brope lights\b/i, 'the ropes'],
  [/\bpanels?\b|\bhub75\b|\bbrightness\b/i, 'the panels'],
  [/\bboot[ -]?file\b/i, 'the boot file'],
  [/\bgallery cam(?:era)?\b/i, 'the gallery camera'], [/\briver cam(?:era)?\b/i, 'the river camera'], [/\bcam(?:era)?s?\b|\bptz\b/i, 'a camera'],
  [/\brouter\b/i, 'the router'],
  [/\bcalibrat|\bled map\b/i, 'the calibration'],
  [/\brecorder\b/i, 'the river recorder'], [/\bpeople counter\b/i, 'the people counter'],
  [/\briver's year\b|\bseasons?\b|\bmode\b|\btarget\b|\brules\b/i, "the river's year"],
  [/\blive river\b/i, 'the live river'],
  [/\bscheduled task\b|\bschtasks\b/i, 'a scheduled task on bitcube'],
  [/\btouchdesigner\b|\btd\b|\bshow file\b|\bstart-river\b|\.toe\b/i, 'TouchDesigner'],
  [/\blights?\b/i, 'the lights'],
];
const FALLBACK_VERB = { stop: 'stopped', kill: 'stopped', disable: 'switched off', start: 'started', enable: 'switched on', restart: 'restarted',
  reload: 'restarted', reboot: 'restarted', move: 'moved', aim: 'moved', pan: 'moved', tilt: 'moved', calibrate: 'calibrated', cancel: 'stopped' };
// ---- what a command changes on the installation: a small table of state paths and verb classes (R8 #37, CR8 #2, #4, #16) ----
/** The installation's state files on bitcube, each with what writing it does (its words whatever else the command holds): stopping
 *  a run by its cancel file (calibrate.py's check_cancel), the boot file written by hand (R8 #37), the people counter's reading the
 *  year's dynamic mode follows. A write to one is a change wherever it is. */
const STATE_FILES = [['calibration.cancel', 'stopped the calibration'], ['boot-file.txt', 'changed the boot file'], ['presence.json', "changed the people counter's count"]];
/** River\ (C:\Users\user\River, \\bitcube\River): what is in it is the installation's state (recordings, models, the gallery state,
 *  the files above), except the repo checkouts there, which are code and notes (a folder made or a log written in one is no change
 *  to the show, CR8 #2). The folder by its own name: after user\ or bitcube\, or a path of its own, never "media/river/…". */
const REPO_DIRS = ['river-bitcube', 'river-agent'];
const RIVER_DIR = /(?:(?<![\w.~\\/-])|(?<=(?:user|bitcube)[\\/]))River[\\/]+([^\\/\s"';&|]*)/gi;
/** The verb classes that write a file: PowerShell's and cmd's writers (what they write: the rest of their command), and a redirect
 *  (>, >>, 2>, &>: its target; never 2>&1 or >&2). */
const WRITE_VERBS = String.raw`(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Copy-Item|Move-Item|Rename-Item|Clear-Content|\bdel\b|\bcopy\b|\bmove\b|\bren\b)`;
const WRITE_ARGS = new RegExp(String.raw`${WRITE_VERBS}([^;&|\n]*)`, 'gi');
const REDIRECT = /(?<!>)>{1,2}\s*["']?([^\s"';&|]+)/g;
const fileRe = (f) => new RegExp(String.raw`(?<![\w.-])${f.replace(/[.]/g, '\\.')}\b`, 'i');
const STATE_RE = STATE_FILES.map(([f, words]) => [fileRe(f), words]);
/** scp or pscp copies to its last argument: a copy into River\ (bitcube:C:/Users/user/River/…) writes there (R9 #38). */
const SCP = /^\s*(?:\S*[\\/])?p?scp(?:\.exe)?\s+(.*)$/i;
const scpTarget = (part) => { const m = SCP.exec(part); if (!m) return []; const t = m[1].trim().split(/\s+/).filter((x) => !x.startsWith('-')); return t.length >= 2 ? [t.at(-1)] : []; };
/** What a command part writes: each writer's arguments, each redirect's target, and scp's destination. */
const writeTargets = (part) => [...part.matchAll(WRITE_ARGS)].map((m) => m[1]).concat([...part.matchAll(REDIRECT)].map((m) => m[1]), scpTarget(part));
/** Whether a write's target is the installation's state: a state file, or River\ outside its repo checkouts. */
const inState = (t) => STATE_RE.some(([re]) => re.test(t)) || [...t.matchAll(RIVER_DIR)].some((m) => !REPO_DIRS.includes(m[1].toLowerCase()));
/** A command part that writes the installation's state (R8 #37; the repo is not it, CR8 #2). */
const writesState = (part) => writeTargets(part).some(inState);
/** Code that writes a state file (a python or node one-liner): a change too (R9 #38). The mode is the open() call's own (CR9 #3): its
 *  first argument names the file (or a variable that was given its name) and its second is 'w', 'a' or 'x' (mode= too); a Path of it
 *  opened to write, or written (write_text, write_bytes); a writer given it (WriteAllText, writeFileSync, appendFile…). Never a read
 *  of it beside a mode-like word elsewhere: print(open('boot-file.txt').read(), 'a') is a look. */
const STATE_NAMES = String.raw`(?:boot-file\.txt|calibration\.cancel|presence\.json)`;
const OPEN_MODE = String.raw`\s*,\s*(?:mode\s*=\s*)?[rbu]?['"][wax]\+?[bt]?['"]`;
const STATE_CODE = new RegExp([
  String.raw`\bopen\s*\(\s*(?=[^)]*${STATE_NAMES})(?:[^,()]|\([^()]*\))*${OPEN_MODE}`,                            // open(<the file>, 'w')
  String.raw`\b(\w+)\s*=\s*[rRbBuU]{0,2}['"][^'"\n]*${STATE_NAMES}['"][\s\S]*?\bopen\s*\(\s*\1${OPEN_MODE}`,         // p = '…boot-file.txt'; open(p, 'w')
  String.raw`${STATE_NAMES}['"]\s*\)\s*\.(?:open\s*\(\s*(?:mode\s*=\s*)?['"][wax]|write_(?:text|bytes)\s*\()`,        // Path('…').open('w'), .write_text(
  String.raw`\b(?:WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText|writeFileSync|writeFile|appendFileSync|appendFile)\s*\([^)]*${STATE_NAMES}`,
].join('|'), 'i');
/** A POST to the river's year's own page (:9981): around mission control's mode, target and rules lock (R9 #38). curl's flags by
 *  their case (CR9 #2): -d, --data…, -F, --form, --json, -X POST (alone or in a cluster: -sd, -XPOST) send a body; -f (fail) and
 *  -D (dump headers) do not, and -G or --get sends -d as a query (a GET). PowerShell's -Method Post in any case. */
const CURL_POSTS = String.raw`(?-i:\s(?:-[A-Za-z]*(?:[dF]|X\s*POST\b)|--request(?:\s+|=)POST\b|--data(?:-[a-z]+)?\b|--form(?:-string)?\b|--json\b))`;
const CURL_GET = String.raw`(?-i:\s(?:-[A-Za-z]*G|--get\b))`;
const POST_YEAR = new RegExp(String.raw`\bcurl(?:\.exe)?\b(?![^;&|\n]*${CURL_GET})(?=[^;&|\n]*:9981\b)(?=[^;&|\n]*${CURL_POSTS})`
  + String.raw`|Invoke-(?:RestMethod|WebRequest)\b(?=[^;&|\n]*-Method\s+['"]?Post\b)(?=[^;&|\n]*:9981\b)`
  // R10 #39: any other client that sends one: wget's --post-data, --post-file or --method=POST; HTTPie's or xh's method word; Python's
  // requests or httpx; a fetch with method POST
  + String.raw`|\bwget(?:\.exe)?\b(?=[^;&|\n]*:9981\b)(?=[^;&|\n]*\s--(?:post-data|post-file|body-data|body-file|method[=\s]+['"]?(?:POST|PUT|PATCH|DELETE)\b))`
  + String.raw`|\b(?:https?|xh)\s+(?:-\S+\s+)*(?:POST|PUT|PATCH|DELETE)\s+[^;&|\n]*:9981\b`
  + String.raw`|\b(?:requests|httpx|session|s)\.(?:post|put|patch|delete)\s*\([^)]*:9981\b|\bfetch\s*\([^)]*:9981\b[^)]*\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)`, 'i');
/** Direct changes that read like checks, each with its words (R9 #38): the lighting port's own script, Will's rope lights and any
 *  scheduled task, TouchDesigner's launcher, bitcube's restart or shutdown and its network adapters, a POST to the year's page, the
 *  router's settings and its services, and a bridge call into the year's own setters. */
const CHANGE_WORDS = [
  [/\blights_route\.ps1\b/i, 'moved the lighting port'],
  [/\bStart-ScheduledTask\b[^;&|\n]*\bRopeLights\b|\bStart-Rope-Lights\b|\bschtasks\b[^;&|\n]*\/run\b[^;&|\n]*\bRopeLights\b/i, "started Will's rope lights"],
  [/\b(?:Stop|Disable)-ScheduledTask\b[^;&|\n]*\bRopeLights\b|\bStop-Rope-Lights\b|\bschtasks\b[^;&|\n]*\/end\b[^;&|\n]*\bRopeLights\b/i, "stopped Will's rope lights"],
  [/\b(?:Start|Stop|Enable|Disable|Register|Unregister|Set)-ScheduledTask\b/i, 'changed a scheduled task on bitcube'],
  [/\bschtasks\b[^;&|\n]*\/(?:create|delete|change)\b/i, 'changed a scheduled task on bitcube'],
  [/\bStart-River\.cmd\b/i, 'started TouchDesigner'],
  // R10 #39: bitcube's other start scripts, its services and its settings; a camera told to restart
  [/\bStart-Modal\.cmd\b/i, 'started Clips to Dave'],
  [/\bStart-Presence\.cmd\b/i, 'started the people counter'],
  [/\bStart-[\w-]+\.cmd\b/i, 'started a program on bitcube'],
  [/\b(?:Start|Stop|Restart|Set|Suspend|Resume|New|Remove)-Service\b|\bsc(?:\.exe)?\s+(?:start|stop|config|delete|create)\b|\bnet(?:\.exe)?\s+(?:start|stop)\s+\S/i, 'changed a service on bitcube'],
  [/\b(?:Set|New|Remove|Rename)-ItemProperty\b|\breg(?:\.exe)?\s+(?:add|delete|import)\b|\bpowercfg(?:\.exe)?\b(?=[^;&|\n]*\s[-/](?:change|setactive|set(?:ac|dc)valueindex|hibernate|x)\b)/i, "changed bitcube's settings"],
  [/\bcmd=Reboot\b/i, 'restarted a camera'],
  [/\bshutdown(?:\.exe)?\s+(?:\S+\s+)*?\/r\b|\bRestart-Computer\b/i, 'restarted bitcube'],
  [/\bshutdown(?:\.exe)?\s+(?:\S+\s+)*?\/[sp]\b|\bStop-Computer\b/i, 'shut down bitcube'],
  [/\b(?:Disable|Enable|Restart|Set|Rename)-NetAdapter\w*\b|\b(?:New|Remove|Set)-NetIP(?:Address|Interface)\b|\b(?:New|Remove|Set)-NetRoute\b|\bnetsh\b[^;&|\n]*\b(?:set|add|delete)\b/i, "changed bitcube's network"],
  [POST_YEAR, "changed the river's year"],
  [/\buci\s+(?:set|commit|delete|add|add_list|del_list|rename|revert)\b/i, "changed the router's settings"],
  [/\/etc\/init\.d\/network\s+(?:restart|reload|stop|start)\b/i, "restarted the router's network"],
  [/\/etc\/init\.d\/\S+\s+(?:restart|reload|stop|start)\b/i, 'restarted a service on the router'],
  // R10 #39: the router restarted, its Wi-Fi or its uplink taken down and up, its own calls that change it, its scheduled jobs. A
  // Linux reboot is the router's (bitcube restarts with shutdown /r); wifi alone reloads it; wifi status, crontab -l, a ubus status
  // or get stay checks
  [/(?<![\w./=@-])reboot(?![\w.=-])/i, 'restarted the router'],
  [/(?<![\w./=@-])wifi(?:\s+(?:down|up|reload)\b|(?=\s*(?:$|[;&|\n"'])))/i, "restarted the router's Wi-Fi"],
  [/(?<![\w./=@-])if(?:down|up)(?![\w.-])|\bubus\s+call\s+network\.interface\S*\s+(?:down|up|restart|reload|renew)\b|\bubus\s+call\s+network\s+(?:restart|reload)\b/i, "restarted the router's network"],
  [/\bubus\s+call\s+\S+\s+(?!(?:status|list|dump|info|board|get\w*|state)(?![\w-]))[A-Za-z]\w*/i, "changed the router's settings"],
  [/\bcrontab\b(?![^;&|\n]*\s-l\b)/i, "changed the router's scheduled jobs"],
  [/\btd\.ps1\b[\s\S]*?\bset_(?:mode|target|rules?|season|intensity|manual|cycle)\w*\s*\(/i, "changed the river's year"],
];
/** A direct change whose own words are known whatever else the command holds (the state files above, then CHANGE_WORDS). */
const DIRECT_FIRST = [...STATE_RE, ...CHANGE_WORDS];
// ---- a name is a run only where it is run: never an argument to a command that only reads (CR9 #1) ----
/** The commands that only read or print what they are given: a script's or a cmdlet's name after one is an argument (grep -n Route
 *  lights_route.ps1, type …\Start-River.cmd, grep -rn Stop-ScheduledTask tools/, git log -- …), never a run of it. sed only with -n
 *  and never -i. */
const READER = /^(?:\S*[\\/])?(?:grep|egrep|fgrep|zgrep|rg|cat|bat|type|less|more|head|tail|nl|wc|findstr|Get-Content|gc|Select-String|sls)(?:\.exe)?(?![\w-])|^(?:\S*[\\/])?sed(?![\w-])(?![^;&|\n]*\s-[A-Za-z]*i)(?=[^;&|\n]*\s-[A-Za-z]*n)|^(?:\S*[\\/])?git(?:\s+-C\s+\S+)?\s+(?:show|log|diff|blame|grep)(?![\w-])/i;
/** What only carries a command to where it runs, taken off the front of one before its first word is judged: a quote that opens an
 *  inner command, ssh [options] host, powershell's flags up to -Command (never -File: that runs a script), cmd /c. */
const CARRIERS = [
  /^["'`\\]+/,
  /^(?:\S*[\\/])?ssh(?:\.exe)?(?:\s+-[46AaCfGgKkMNnqsTtVvXxYy]+|\s+-[BbcDEeFIiJLlmOoPpQRSWw]\s*\S+)*\s+[^\s"'-]\S*\s+/i,
  /^(?:\S*[\\/])?(?:powershell|pwsh)(?:\.exe)?(?:\s+-(?:NoProfile|NonInteractive|NoLogo|Sta|Mta)(?![\w-])|\s+-(?:ExecutionPolicy|WindowStyle|OutputFormat|InputFormat)\s+\S+)*(?:\s+-(?:Command|c)(?![\w-]))?\s+/i,
  /^(?:\S*[\\/])?cmd(?:\.exe)?\s+\/[cCkK]\s+/,
];
/** The command a place in a command line belongs to: from the last ;, &, | or new line before it (inside quotes too: ssh bitcube
 *  "type x; y" is two; never an escaped one, grep's "a\|b"), without what carries it. */
function commandAt(text, i) {
  let from = i;
  while (from > 0 && !(/[;&|\n]/.test(text[from - 1]) && text[from - 2] !== '\\')) from--;
  let s = text.slice(from).trimStart();
  for (let again = true; again;) {
    again = false;
    for (const re of CARRIERS) { const m = re.exec(s); if (m && m[0]) { s = s.slice(m[0].length).trimStart(); again = true; } }
  }
  return s;
}
/** Whether a pattern of a change matches where something is run or invoked: at least one match not under a reader (CR9 #1). */
function runs(re, text) {
  const t = String(text ?? ''), g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of t.matchAll(g)) if (!READER.test(commandAt(t, m.index))) return true;
  return false;
}
/** An acting line that can't be shown as it is: what it did to what ("stopped a scheduled task on bitcube", "changed the ropes"). */
function actingFallback(verb, ...texts) {
  const t = texts.map((x) => String(x ?? '')).join(' ');
  if (!verb) { const first = DIRECT_FIRST.find(([re]) => runs(re, t)); if (first) return first[1]; }
  const thing = THINGS.find(([re]) => re.test(t))?.[1] ?? 'something on bitcube';
  return `${FALLBACK_VERB[verb] ?? 'changed'} ${thing}`;
}
/** A command that changes the installation whatever its description says (the page's CHANGE_CMD, and calibrate.ps1). */
// A TouchDesigner bridge call that assigns a parameter (td.ps1 "op('/project1/ropes').par.Source='black'") changes the show too,
// though it looks like a read (R7 #35): by its value, or its expression, mode or bind (.par.X.expr =, p.mode =, p.bindExpr =), or
// setattr( (CR7 #9); a comparison (==, !=) or a read is not one
// R8 #37: also a write to the installation's state (writesState, above), a build script run inside the show (td.ps1 -File), and an
// operator switched off or recooked through the bridge (.bypass =, .allowCooking =, .cook(, .store()
const CHANGE_CMD = new RegExp(String.raw`-Action\s+(ropes|hub75|switch|bootfile|lightsroute|rebuild|calibrate|mode|target|rules)\b|\/api\/control\/|Restart-Computer|Stop-Process|Start-Process|taskkill|\bkill\b|schtasks\s+\/(run|end|change|create|delete)|ptz\.py\s+\w+\s+(?!presets)|td_save|calibrate\.ps1\s+-Action\s+(start|cancel)`
  + String.raw`|td\.ps1\b[\s\S]*?(?:\.par\.\w+(?:\.\w+)?\s*=(?!=)|\.(?:val|expr|mode|bindExpr|bypass|allowCooking|lock|display|render)\s*=(?!=)|\bsetattr\s*\(|\.(?:cook|store|unstore|destroy|copy|create)\s*\(|\bset_\w+\s*\(|\s-File\b)`, 'i');
/** A command part that changes the installation: a control, a process, the bridge, a write to its state (also by code, or copied in
 *  with scp), or one of the direct changes that read like checks (R9 #38); a control, a process or a direct change only where it is
 *  run, never its name given to a reader (grep, cat, type, Get-Content, git log: CR9 #1). */
const changes = (part) => runs(CHANGE_CMD, part) || writesState(part) || STATE_CODE.test(part) || CHANGE_WORDS.some(([re]) => runs(re, part));
/** A shell, by name or path (bash, sh, zsh, dash). */
const SHELL = String.raw`(?:\S*[\\/])?(?:bash|sh|zsh|dash)`;
/** An inline shell command: bash -c "…", bash -lc '…', sh -e -c …, any flags holding c (CR8 #4). What it runs is its own command,
 *  judged by its contents (inlineParts), never "ran a script". Groups: the command double-quoted, single-quoted, or bare. */
const INLINE = new RegExp(String.raw`^${SHELL}(?:\s+--?[A-Za-z][\w-]*)*?\s+-[A-Za-z]*c[A-Za-z]*\s+(?:"((?:[^"\\]|\\[\s\S])*)"|'([^']*)'|([\s\S]+))`);
/** A local script run after a look through mission control ("mc.mjs status && bash /tmp/x.sh"): what it does can't be told from
 *  here, but it goes around mission control's locks, so the step says so (R8 #37). A shell with only flags before its script (bash
 *  -x x.sh) too; an inline one (INLINE) is not a script. */
const SCRIPT_RUN = new RegExp(String.raw`^(?:${SHELL}(?:\s+-[A-Za-z]+)*\s+(?!-)\S|source\s+\S|\.\s+\S|\.?\/\S+\.(?:sh|py|mjs|js)\b|(?:python3?|node|pwsh|powershell)\s+(?:-\w+\s+)*\S+\.(?:py|sh|mjs|js|ps1)\b)`, 'i');
/** One command line's commands, an inline shell's own commands in its place (bash -lc "a && b" is a and b: CR8 #4), at most 3 deep. */
function inlineParts(command, depth = 0) {
  return commandParts(command).flatMap((p) => {
    const m = depth < 3 ? INLINE.exec(p) : null;
    if (!m) return [p];
    const inner = m[1] != null ? m[1].replace(/\\(["\\$`])/g, '$1') : m[2] ?? m[3];
    return inlineParts(inner, depth + 1);
  });
}
/** node mission/bin/mc.mjs <action> ['<body>']: a change asked of mission control (or its status read). An action can hold
 *  digits (hub75: R7 #22). */
const MC = /\bmc\.mjs\s+([a-z0-9-]+)(?:\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)"))?/g;
const MC_ONE = new RegExp(MC.source);
/** What a change made directly on bitcube (probe.ps1 or calibrate.ps1 -Action <x>, not through mission control) changed. */
const DIRECT_WORDS = { ropes: 'changed the ropes', hub75: 'changed the panels', switch: "switched TouchDesigner's show file", bootfile: 'changed the boot file',
  lightsroute: 'moved the lighting port', rebuild: "rebuilt the river's year", mode: "changed the river's year", target: "changed the river's year",
  rules: "changed the river's year", calibrate: 'started a calibration', start: 'started a calibration', cancel: 'stopped the calibration' };
const directWords = (part) => DIRECT_WORDS[/-Action\s+([a-z0-9]+)/i.exec(part)?.[1]?.toLowerCase()] ?? DIRECT_FIRST.find(([re]) => runs(re, part))?.[1] ?? actingFallback(null, part);
/** "<what it changed> on bitcube directly": "on bitcube" once, also when the words already end with it ("changed something on
 *  bitcube", "stopped a scheduled task on bitcube": CR8 #3). */
const directly = (words) => `${words}${/\bbitcube\b|\brouter\b/.test(words) ? '' : ' on bitcube'} directly, not through mission control`;
/** One command line's commands: split at ;, &&, ||, |, |&, & and new lines outside quotes (a JSON body's "a; b" is not two); the &
 *  of a redirection (2>&1, >&2, &>, &>>) is not a separator (CR7 #15). */
export function commandParts(command) {
  const s = String(command ?? ''), out = [];
  let cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '&' && (s[i - 1] === '>' || s[i + 1] === '>')) { cur += c; continue; }      // a redirection: >&2, 2>&1, &>, &>>
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      if ((c === '|' || c === '&') && s[i + 1] === c) i++;
      else if (c === '|' && s[i + 1] === '&') i++;                                        // |& pipes both outputs: one separator
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Words that are as often things as actions after "and" ("the ropes and light"), so only a first word is taken as a verb. */
const NOUNISH = new Set(['light', 'note', 'view', 'report', 'count', 'call', 'watch', 'test', 'copy', 'record', 'build', 'search']);
// a raw command, in any case ("SSH bitcube …" as "ssh bitcube …"); "ssh into bitcube and check …" is a description, not one
const RAW_CMD = /[|;&`$<>{}]|^\s*(ssh|scp|powershell|pwsh|python3?|node|git|curl|ffmpeg|ls|dir|cat|type|grep|tail|head|cd|npm|pytest|tasklist|Get-[A-Z]\w+)\b(?! (?:into|to|onto|on)\b)/i;

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
  if (/\/sessions\//.test(p)) return "the team's work log";   // "session" is off the main view (R9 #27)
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
// Addresses first, before the path rule could cut one in two ("https:" + "//host/x" was read as a drive and a path).
// An address runs to the next space or quote, without a closing bracket or a sentence's last mark ("(https://h/x?cmd=Snap).").
const URLS = [
  [/https?:\/\/[^\s"'<>]*modal\.run(?:[^\s"'<>]*[^\s"'<>).,;:!?])?/gi, "Dave's agent's page"],
  [/rtsps?:\/\/[^\s"'<>]*[^\s"'<>).,;:!?]/gi, "a camera's stream"],
  [/https?:\/\/[^\s"'<>]*[^\s"'<>).,;:!?]/gi, 'a web page'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*[^\s"'<>).,;:!?]/gi, 'an address'],
];
// The copy rules' names, in order (earlier rules see the raw words). Each is [pattern, replacement].
const WORDS = [
  [/\b(?:the )?ropes? Source ?= ?['"]?black['"]?/gi, 'the ropes dark'],
  [/\b(?:the )?ropes? Source ?= ?['"]?canvas['"]?/gi, 'the ropes back to the river'],
  [/\bRopeLights\b/g, "Will's rope lights"],
  [/\b(?:the )?modal[_ ]link(?:\.py)?(?: status)?\b/gi, 'Clips to Dave'],
  [/\b(?:the )?seasons? (?:show )?file\b/gi, "the river's year"],
  [/\bon\/off\b/gi, 'on and off'],
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
  let out = scrubCreds(String(s ?? '')).replace(/\b(run|ran) (?:the )?(?:[\w.~-]*[\\/])*probe(?:\.ps1)?\b(?: on bitcube)?/gi, '$1 the full check of bitcube');
  for (const [re, to] of URLS) out = out.replace(re, to);
  for (const name of Object.keys(FILES)) out = out.split(name).join(FILES[name].label);
  out = out.replace(/\b[\w-]+\.toe\b/g, 'a show file');
  // "on/off", "and/or", "24/7": one slash between two plain words is not a path
  out = out.replace(PATH, (m) => (/^(?:the )?[A-Za-z0-9]+\/[A-Za-z0-9]+$/i.test(m) ? m : plainFile(m.replace(/^the /i, ''))));
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

/** The controls mission control has (bin/mc.mjs <action>): their changes are named as the band and Recent name them. */
const MC_ACTIONS = new Set(Object.keys(EXPECT_S));
/** A step's context, asked for when a line needs it and only once (CR9 #18): ctx itself, or what the function returns (the live
 *  agent's context is a whole snapshot of mission control: never made for a step that doesn't use it). One that throws is none. */
function lazyContext(ctx) {
  if (typeof ctx !== 'function') return () => (ctx && typeof ctx === 'object' ? ctx : {});
  let got = null;
  return () => {
    if (got == null) { try { const c = ctx(); got = c && typeof c === 'object' ? c : {}; } catch { got = {}; } }
    return got;
  };
}
/** A change asked of mission control through its control socket (bin/mc.mjs), by the change's one name (model.js changeLabel, as the
 *  band, Last done and the history name it: R9 #22); null if not one. ctx: { running (the show file TouchDesigner runs: a switch to
 *  it is "the restart on …"), calDry (the run going is a dry run: its Stop is "the dry run stop"; not known: "to stop the run") }. */
function mcLine(command, ctxOf = () => ({})) {
  // "status first, then one control" in one command: the step is the control, not the look before it
  const all = [...String(command ?? '').matchAll(MC)];
  if (!all.length) return null;
  const m = all.find((x) => x[1] !== 'status') ?? all[0];
  if (m[1] === 'status') return { text: 'looked at what mission control shows', acting: false };
  let body = {};
  try { const j = JSON.parse(m[2] ?? (m[3] != null ? m[3].replace(/\\(.)/g, '$1') : '{}')); if (j && typeof j === 'object' && !Array.isArray(j)) body = j; } catch { /* words from the action alone */ }
  if (!MC_ACTIONS.has(m[1])) return null;                // not one of mission control's controls
  const acting = m[1] !== 'check' && !(m[1] === 'calibrate' && body.action === 'status');
  // the context only where the words depend on it: a Stop (which run), a switch (to the file running: the restart on it)
  if (m[1] === 'calibrate' && body.action === 'cancel') {
    const calDry = ctxOf().calDry;
    if (typeof calDry !== 'boolean') return { text: 'asked mission control to stop the run', acting };
    body = { ...body, dry_run: calDry };
  }
  const running = m[1] === 'switch' ? ctxOf().running : null;
  return { text: `asked mission control for ${changeLabel(m[1], body, { running: typeof running === 'string' ? running : null })}`, acting };
}

/** A Bash step: the agent's description in plain words, else a plain fallback; an acting one says what it changed. */
function bashLine(description, command, ctxOf = () => ({})) {
  // a look through mission control chained to a change made around it ("mc.mjs status && ssh bitcube … probe.ps1 -Action
  // switch"): the change, and that it went around mission control's locks, never "looked at what mission control shows" (R7 #34)
  // an inline shell's command (bash -lc "…") is judged by what it runs (CR8 #4)
  const ps = inlineParts(command), viaMc = ps.filter((x) => MC_ONE.test(x)), direct = ps.filter((x) => !MC_ONE.test(x) && changes(x));
  if (viaMc.length && direct.length) return { text: clip(directly(directWords(direct[0])), TEXT_MAX), acting: true };
  if (viaMc.length && ps.some((x) => !MC_ONE.test(x) && SCRIPT_RUN.test(x))) return { text: 'ran a script, not through mission control', acting: true };
  const mc = viaMc.length ? mcLine(viaMc.join('\n'), ctxOf) : null;
  if (mc) return mc;
  const desc = String(description ?? '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const onBitcube = /bitcube|\bssh\b/i.test(`${desc} ${command ?? ''}`);
  const cmdActs = direct.length > 0;
  const fallback = cmdActs ? { text: actingFallback(null, command), acting: true } : { text: onBitcube ? 'ran a command on bitcube' : 'ran a command', acting: false };
  if (!desc || RAW_CMD.test(desc)) return fallback;
  const plain = plainWords(desc);
  const [first, verb] = pastTense(plain);
  // "Commit and push the plan": every verb of a list in the past tense, not only the first
  const verbs = verb ? [verb] : [];
  const past = (m, j, w) => (PAST[w] && !NOUNISH.has(w) ? (verbs.push(w), `${j}${PAST[w]}`) : m);
  const line = first.replace(/\b((?:and|then) )([a-z]+)\b/g, past).replace(/(, )([a-z]+)\b/g, past);
  // acting: a change verb on something that makes up the installation ("set the ropes dark"), never on a repo file or a folder;
  // or a command that changes it, whatever the description says
  const acting = (verbs.some((v) => CHANGE.has(v)) && ACTS.test(`${line} ${desc}`)) || cmdActs;
  // a command that changes the installation under a description that only looks ("Check the ropes") says what it changed
  if (!line || unplain(line) || (cmdActs && !verbs.some((v) => CHANGE.has(v)))) {
    // a change is never only "ran a command": say what it changed
    return acting ? { text: actingFallback(verbs.find((v) => CHANGE.has(v)) ?? null, desc, command), acting: true } : fallback;
  }
  return { text: clip(line, TEXT_MAX), acting };
}

/** One step line for a tool the agent used (see the header). Never throws. */
export function describeTool(block, ctx = {}) {
  // every field scrubbed before anything is made from it (the words, the tooltip): a login never reaches a phone or chat.jsonl
  const i = block?.input && typeof block.input === 'object' ? scrubCreds(block.input) : {};
  const line = (text, raw, acting = false) => ({ text: clip(text, TEXT_MAX), raw: rawOf(raw), acting });
  try {
    switch (block?.name) {
      case 'Bash': { const b = bashLine(i.description, i.command, lazyContext(ctx)); return line(b.text, i.command ?? i.description ?? '', b.acting); }
      case 'Read': return line(`looked at ${plainFile(i.file_path)}`, i.file_path);
      case 'Edit': case 'Write': case 'NotebookEdit': return line(`changed ${plainFile(i.file_path ?? i.notebook_path)}`, i.file_path ?? i.notebook_path);
      case 'Glob': case 'Grep': return line('searched the repo', i.pattern);
      case 'WebFetch': return line(/modal\.run/i.test(String(i.url)) ? "looked at what Dave's agent is doing" : 'looked something up online', i.url);
      case 'WebSearch': { const q = plainWords(clip(i.query, 60)); return line(q && !unplain(q) ? `searched the web for ${q}` : 'searched the web', i.query); }
      case 'TodoWrite': return line('updated its to-do list', '');
      case 'Agent': case 'Task': {
        const d = plainWords(clip(i.description, 60)).replace(/[.\s]+$/, '');
        return line(d && !unplain(d) ? `asked a helper to ${d[0].toLowerCase()}${d.slice(1)}` : 'asked a helper', i.description);
      }
      default: return line('used a tool', `${block?.name ?? 'a tool'}${Object.keys(i).length ? ' ' + JSON.stringify(i) : ''}`);
    }
  } catch { return { text: 'used a tool', raw: '', acting: false }; }
}
