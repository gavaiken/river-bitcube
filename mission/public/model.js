// Mission control's status model: derive(status, nowMs) turns one GET /api/status payload into everything the
// pages say, so every verdict on screen comes from one place that the fixtures test (test/model.test.mjs).
// Pure ES module, no imports: it runs in the browser and under node --test. Long version of the shape and the
// rules: ~/claude/local/ui-shots/design/model.md.
//
// derive(status, nowMs) -> {
//   overall: { level, headline, detail, action, stale, cause, also, checked }
//     level     'ok' | 'warning' | 'down' | 'unknown': what it means for the show (not the worst dot on the page)
//     headline  one line of plain words: the one thing that matters
//     detail    one or two sentences: why, since when
//     action    what to do, or null when there is nothing to do
//     stale     a source the verdict needs is older than it should be, or the page could not fetch
//     cause     the id of the problem behind the headline (null when all is well)
//     also      the other problems' headlines, most important first
//     checked   { page_age_s, bitcube_age_s, seasons_age_s, modal_age_s, probe_age_s }: seconds, or null
//   problems: [ { id, level, headline, detail, action, items } ]   one per cause, the headline's first
//   show: what the piece is doing: { file, boot_file, show_files, season, phase, weights, intensity, mode, target,
//         presence, ropes, panels, river, scene, modal, fresh, calibration, applying, words }, each with plain words for the page
//         (ropes and panels carry { state, words, summary }: a state word, a sentence, and the item's summary)
//   items: [ { id, name, level, summary, detail, action, checked_from, age_s, stale, address, cause, muted } ]
//     one per piece of equipment or link, what matters most first and OK items last. `level` is the state of
//     that piece itself (a down camera is down even when the show does not need it; `overall` says what it
//     means), `cause` the problem it belongs to, `muted` a piece with nothing to show (the people counter).
//   controls: { mode, target, rules, ropes, hub75, switch, bootfile, lightsroute }: { possible, why }
//   sources: { bitcube, seasons, modal, probe }: { present, ok, error, age_s, stale }
// }

// ---- the rules, as constants --------------------------------------------------------------------------------
export const POLL_S = { bitcube: 5, seasons: 5, modal: 30, probe: 60 };   // mission.mjs's timers
export const STALE_FACTOR = 3;                  // a source is stale after three missed polls
export const PAGE_STALE_S = 30;                 // the page could not fetch for this long: it cannot see the show
export const TD_SLOW_FPS = 30;                  // under this the river visibly jerks (the timeline is 60)
export const COMING_UP_H = 0.25;                // bitcube up for less than this: still starting
export const MODAL_LATE_MIN = 15;               // Dave's agent ticks every 5 min; this many daytime minutes late is a fault
export const MODAL_REST = { from: 23 * 60 + 55, to: 7 * 60 };   // it rests 23:55-07:00 Pacific (01:55-09:00 Central)
export const CLIP_LATE_S = 5 * 60;              // the Modal link posts a clip every 20-70 s; none for 5 min = failing
export const DISK_LOW_GB = 20;
export const TZ = 'America/Los_Angeles';        // bitcube, the mini and the team keep Pacific time
export const FILES = {                          // GLOSSARY.md: the local-only file is "the river's year", the online one "the live river"
  'river-local-oct-22-seasons.toe': { kind: 'year', label: "the river's year" },
  'river-online-oct-23.toe': { kind: 'live', label: 'the live river' },
  // Retired show files (execution plan D27): renamed old-… on 24 Oct, never offered for the boot file or a switch. Their
  // earlier names stay here so a bitcube that hasn't pulled the rename still reads right.
  'old-river-online-oct-20.toe': { kind: 'other', label: 'an old show file' },
  'old-river.toe': { kind: 'other', label: 'an old show file' },
  'river-online-oct-20.toe': { kind: 'other', label: 'an old show file' },
  'river-local-oct-18.toe': { kind: 'other', label: 'an old show file' },
  'river.toe': { kind: 'other', label: 'an old show file' },
};
const OFFERED = ['year', 'live'];               // the kinds the boot file and the show-file switch offer
const UNLISTED = 'an unlisted show file';       // a file mission control doesn't list: its name (a .toe) stays in raw
// probe.ps1 reports this when boot-file.txt is missing: Start-River.cmd then opens the seasons file, else the online one
export const BOOT_DEFAULT = 'Start-River.cmd default';
const YEAR_FILE = Object.keys(FILES).find((k) => FILES[k].kind === 'year'), LIVE_FILE = Object.keys(FILES).find((k) => FILES[k].kind === 'live');
export const CAL_STAGE_S = { 'ropes-capture': 170, 'ropes-decode': 40, 'hub75-capture': 35, 'hub75-locate': 10 };   // calibrate.py EXPECTED_S
export const CAL_TOTAL_S = Object.values(CAL_STAGE_S).reduce((a, b) => a + b, 0);
export const CAL_STAGE_WORDS = { 'ropes-capture': 'photographing the ropes', 'ropes-decode': 'working out where each rope is', 'hub75-capture': 'photographing the panels', 'hub75-locate': 'finding the panels' };
// Applying a change (docs/mission-ui.md): what a change in flight blocks, when the server's entry names no blocks of its own.
// A switch or a rebuild restarts TouchDesigner on the year: everything that touches either waits; a boot-file change only
// the file controls (and a calibration's start); a lighting port change the lights; the rest only a second copy of itself.
const TD_TOUCHING = ['ropes', 'hub75', 'mode', 'target', 'rules', 'rules-reset', 'lightsroute', 'switch', 'rebuild', 'bootfile', 'calibrate'];
export const APPLY_BLOCKS = {
  switch: TD_TOUCHING, rebuild: TD_TOUCHING, bootfile: ['switch', 'rebuild', 'bootfile', 'calibrate'], lightsroute: ['ropes', 'hub75', 'lightsroute', 'calibrate'],
  ropes: ['ropes'], hub75: ['hub75'], mode: ['mode'], target: ['target'], rules: ['rules'], 'rules-reset': ['rules-reset'],
  calibrate: ['ropes', 'hub75', 'switch', 'lightsroute', 'rebuild', 'calibrate'],   // a calibration's start: what a running one blocks, and a second start
};
/** The team's words for a change in flight when the server's entry has no label of its own. */
export const APPLY_LABEL = { switch: 'a show-file switch', rebuild: "a rebuild of the river's year", bootfile: 'the boot file change', lightsroute: 'a lighting port change',
  ropes: 'a ropes change', hub75: 'a panels change', mode: 'a mode change', target: 'a target change', rules: 'a rules change', 'rules-reset': 'a rules reset', calibrate: 'a calibration start' };
/** The usual time of each change, in seconds, until bitcube's reading shows it: the server's own table (lib/applying.mjs EXPECT_S,
 *  kept equal by test/model.test.mjs), so a page can say "usually about 1 min" for its own change before status.applying has it. */
export const EXPECT_S = { switch: 60, rebuild: 150, bootfile: 15, lightsroute: 20, ropes: 15, hub75: 15, mode: 3, target: 3, rules: 3, 'rules-reset': 3, calibrate: 10,
  check: 30 };   // the full check (an SSH round trip): never a lock (lib/applying.mjs records only what APPLY_BLOCKS names), only its usual time
/** What the boot file's confirming line says in place of a usual time: its reading comes with bitcube's next full check. */
export const BOOT_USUAL = "bitcube's full check shows it within a minute";
export const SHORT_CHANGE_S = 10;               // a change with no usual time of its own: past this, its line shows m:ss and "usually a few seconds"
export const NEARLY_DONE_S = 45;                // a calibration's last 45 s (or last quarter, for a short scripted run) are "nearly done" on every page
export const CONFIRM_MIN_S = 120;               // a change not shown by bitcube's reading within max(3 × its usual time, this) is "unconfirmed"
export const LONG_CHANGE_S = 20;                // a change usually longer than this shows its elapsed m:ss and the usual time
/** How long a change may go unconfirmed (and an entry in status.applying stay a lock): 3 × its usual time, at least 2 min. */
export function confirmLimitS(expectS) { return Math.max(3 * (num(expectS) ?? 0), CONFIRM_MIN_S); }
export const INTENSITY_WORDS = [[0.1, 'stillness'], [0.3, 'trickle'], [0.6, 'flowing'], [0.8, 'strong'], [Infinity, 'torrent']];
export const LEVELS = { down: 0, warning: 1, unknown: 2, ok: 3 };   // what wins the headline (after a stale page), and the items' order
export const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
/** The season a phase of the year falls in (seasons.py: the rounded phase, wrapped to four), or null. */
export function seasonOfPhase(phase) {
  return typeof phase === 'number' && Number.isFinite(phase) ? SEASONS[Math.round(((phase % 4) + 4) % 4) % 4] : null;
}
// Who to call, by the cause behind the headline (ia.md, "What to do"): first names and what they own. The numbers
// live in an untracked file on the mini and never in the repo. A cause mapped to null means "wait and look again".
export const CONTACTS = {
  gavin: { name: 'Gavin', owns: 'bitcube, TouchDesigner, the show file and mission control' },
  lilian: { name: 'Lilian', owns: 'the lights and the rigging' },
  andi: { name: 'Andi', owns: 'the panels' },
  will: { name: 'Will', owns: 'the network, the cameras and the river site' },
  dave: { name: 'Dave', owns: 'his agent' },
  colin: { name: 'Colin', owns: 'how the piece should look' },
};
const CONTACT_BY_CAUSE = {
  page: 'gavin', 'bitcube-unchecked': 'gavin', 'bitcube-offline': 'gavin', 'check-failed': 'gavin', 'probe-stale': 'gavin',
  'td-unknown': 'gavin', 'td-frozen': 'gavin', 'td-off': 'gavin', 'td-slow': 'gavin', 'year-page': 'gavin', 'sender-off': 'gavin', 'sender-taken': 'gavin',
  'link-off': 'gavin', 'link-failing': 'gavin', recorder: 'gavin', disk: 'gavin', 'modal-stale': 'gavin', 'seasons-stale': 'gavin',
  lights: 'lilian', sender: 'lilian', box: 'lilian',
  panels: 'andi', 'panels-off': 'andi', 'panels-dark': 'andi',
  'ropes-dark': 'colin', 'online-file': 'colin', 'old-file': 'gavin',
  'river-stale': 'will', 'no-internet': 'will', router: 'will', 'river-site': 'will', 'gallery-cam': 'will',
  'modal-unreachable': 'dave', 'modal-stalled': 'dave', 'modal-not-ok': 'dave',
  'td-restarting': null, 'coming-up': null, 'not-checked': null, calibrating: null, unknown: null,
};
/** The show-file button the advice names, by what runs now: "Restart on the river's year" when it runs, else "Switch to
 *  the river's year" (status.js labels the band's jump button and the show-file control's buttons the same way). */
export function yearPress(kind) { return kind === 'year' ? "Restart on the river's year" : "Switch to the river's year"; }
export function contactFor(cause) { const k = CONTACT_BY_CAUSE[cause]; return k ? CONTACTS[k] : null; }
// Actions said in more than one place, in the show's words.
const GALLERY_ACTION = "Turn the gallery camera's power off and on again (leave its network cable out: it works on Wi-Fi), then call Will.";
const INTERNET_ACTION = "Check the router's internet connection (the venue's staff Wi-Fi, or the wired connection) from its admin page. The show keeps running meanwhile; clips resume by themselves.";
const DAVE_LATE_ACTION = "Tell Dave his agent has stopped updating. Nothing to do in the gallery.";
// WinError 10048: another program on bitcube (Will's RopeLights app, or a second sender) holds the ropes' connection; no cable fixes it.
// Only Gavin stops Will's rope lights (CLAUDE.md), so the studio chat would have to refuse: it is never offered (R6 #21).
const TAKEN_ACTION = "Call Gavin to stop the other lights program (Will's rope lights) on bitcube; the sender picks up by itself once it has stopped.";
const ROPE_BOX = { 'rope box 1': ['2.0.0.10', '1–10'], 'rope box 2': ['2.0.0.11', '11–20'] };
// name, where it is checked from, address for the details drawer
const NAMES = {
  'mission control': ['Mission control (the Mac mini)', 'mini', 'gav-m1-mini.tailddc624.ts.net'],
  bitcube: ['bitcube (the show PC)', 'mini', '100.73.68.60 (Tailscale)'],
  touchdesigner: ['TouchDesigner', 'bitcube', 'on bitcube'],
  seasons: ["The river's year", 'mini', 'bitcube:9981'],
  ropes: ['Ropes (the sender)', 'bitcube', "2.0.0.8 (bitcube's LIGHTS port)"],
  'rope box 1': ['Rope box 1 (ropes 1–10)', 'bitcube', '2.0.0.10'],
  'rope box 2': ['Rope box 2 (ropes 11–20)', 'bitcube', '2.0.0.11'],
  'hub75 panels': ['Panels', 'bitcube', 'HDMI from bitcube, through the panel sender'],
  'gallery camera': ['Gallery camera', 'bitcube', '192.168.9.76'],
  'river camera': ['River camera (the river site)', 'bitcube', '192.168.8.217 (Starlink)'],
  router: ['Router', 'bitcube', '192.168.9.1 (Wi-Fi gray-river)'],
  internet: ['Internet at Gray Area', 'bitcube', null],
  'modal agent': ["Dave's agent", 'modal', 'to-be-a-river--river.modal.run'],
  'modal link': ['Clips to Dave', 'bitcube', 'on bitcube (the Modal link)'],
  recorder: ['River recorder', 'bitcube', 'on bitcube'],
  'people counter': ['People counter', 'bitcube', null],
};
// Importance within one level: the show first, then what feeds it, then the mini itself.
const ORDER = ['bitcube', 'touchdesigner', 'ropes', 'rope box 1', 'rope box 2', 'hub75 panels', 'seasons', 'river camera',
  'gallery camera', 'modal agent', 'modal link', 'internet', 'router', 'recorder', 'people counter', 'mission control'];
const BEHIND = ORDER.filter((id) => NAMES[id][1] === 'bitcube');   // everything the full check reports

// ---- small helpers ------------------------------------------------------------------------------------------
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);   // bitcube is spelt lowercase
/** A duration in words: "40 s", "12 min", "9 h", "3 days". */
export function dur(s) {
  if (s == null) return 'a while';
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}
/** How fast Automatic turns the year, from the year-length rule (cycle_seconds; four seasons a year): "one season a minute",
 *  "one season every 30 s", "one season every 2.5 min"; null when the rule isn't known. */
export function seasonPace(cycleS) {
  const per = typeof cycleS === 'number' && Number.isFinite(cycleS) && cycleS > 0 ? cycleS / 4 : null;
  if (per == null) return null;
  if (Math.abs(per - 60) < 0.5) return 'one season a minute';
  if (per < 90) return `one season every ${Math.round(per)} s`;
  const min = Math.round(per / 30) / 2;
  return `one season every ${Number.isInteger(min) ? min : min.toFixed(1)} min`;
}
export function intensityWord(x) { return x == null ? null : INTENSITY_WORDS.find(([max]) => x < max)[1]; }
/** Wall-clock parts in the installation's zone (falls back to a fixed -7 h if Intl has no zones). */
function pacific(ms) {
  try {
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) p[type] = +value;
    return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
  } catch {
    const d = new Date(ms - 7 * 3600e3);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
}
const localMs = (ms) => { const p = pacific(ms); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s); };   // the wall clock as if it were UTC
export const clock = (ms) => { const p = pacific(ms); return `${pad(p.h)}:${pad(p.mi)}`; };
/** "17:58", "17:58 yesterday" or "17:58 on 21 Oct", relative to now. */
function clockDay(ms, now) {
  const dayDiff = Math.floor(localMs(now) / 86400e3) - Math.floor(localMs(ms) / 86400e3);   // local calendar days between
  const p = pacific(ms), MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return clock(ms) + (dayDiff === 0 ? '' : dayDiff === 1 ? ' yesterday' : ` on ${p.d} ${MONTHS[p.mo - 1]}`);
}
const inRest = (ms) => { const p = pacific(ms), t = p.h * 60 + p.mi; return t >= MODAL_REST.from || t < MODAL_REST.to; };
/** Daytime (07:00-23:55 Pacific) minutes between two moments: how many ticks Dave's agent owed. */
export function daytimeMinutes(a, b) {
  if (!(b > a)) return 0;
  const la = localMs(a), lb = localMs(b), DAY = 86400e3;
  let sum = 0;
  for (let day = Math.floor(la / DAY) * DAY; day < lb && sum < 1e6; day += DAY) {
    const from = Math.max(la, day + MODAL_REST.to * 60e3), to = Math.min(lb, day + MODAL_REST.from * 60e3);
    if (to > from) sum += (to - from) / 60e3;
  }
  return sum;
}
/** Age in seconds of a log line "HH:MM:SS INFO ..." against the probe's own clock "YYYY-MM-DDTHH:MM:SS" (both bitcube's).
 *  The probe stamps its time when it starts and reads the logs up to a minute later, so a line a little after
 *  that stamp is brand new, not a day old. */
function lineAge(line, probeTime) {
  const l = /^(\d{2}):(\d{2}):(\d{2})/.exec(line || ''), t = /T(\d{2}):(\d{2}):(\d{2})/.exec(probeTime || '');
  if (!l || !t) return null;
  const tod = (x) => +x[1] * 3600 + +x[2] * 60 + +x[3];
  const diff = tod(t) - tod(l);
  return diff < 0 && diff > -600 ? 0 : (diff % 86400 + 86400) % 86400;
}
/** mission.mjs's fetch errors in plain words, as a clause with its subject (a closed port and an unreachable host both read
 *  "fetch failed"): the river's year's page ("its page didn't answer"), or a service on the internet (remote: Dave's agent). */
function fetchWords(e, remote = false) {
  const who = remote ? 'it' : 'its page';
  if (!e) return `${who} gave no answer`;
  if (/timeout|aborted/i.test(e)) return `${who} didn't answer in time`;
  if (/fetch failed/i.test(e)) return remote ? 'the connection failed' : "its page didn't answer";
  return `${who} answered with an error`;   // "HTTP 500" and the like: the raw text stays in sources.*.error (Addresses and links)
}
/** Why bitcube's full check failed (mission.mjs sshProbe), in the team's words: never SSH, the probe or an exit code. */
function probeWords(e) {
  if (!e) return "the check didn't answer";
  if (/took too long|timeout|timed out/i.test(e)) return "bitcube didn't answer the check in time";
  if (/can't reach bitcube|ssh/i.test(e)) return "the check couldn't log in to bitcube";   // port 22 answers: it reached bitcube
  return "bitcube couldn't run the check";
}
/** One source of the snapshot: { at, value | error, age_s } -> freshness and content. */
function source(raw, name, serverNow) {
  const r = obj(raw);
  if (!r) return { present: false, ok: false, value: null, error: null, age_s: null, failing_s: null, stale: false };
  const at = num(r.at);
  const age_s = serverNow != null && at != null ? Math.max(0, Math.round((serverNow - at) / 1000)) : num(r.age_s);   // the server's clock, never the phone's
  const error = typeof r.error === 'string' && r.error ? r.error : null;
  const value = error ? null : r.value ?? null;
  // a failing source keeps the time of its first failure in a row (mission.mjs failing_since): "failing for 52 min"
  const fs = num(r.failing_since), failing_s = error && fs != null && serverNow != null ? Math.max(0, Math.round((serverNow - fs) / 1000)) : null;
  return { present: true, ok: value != null, value, error: error ?? (value == null ? 'no answer' : null), age_s, failing_s,
           stale: age_s != null && age_s > POLL_S[name] * STALE_FACTOR };
}

/** The boot file probe.ps1 reports, in glossary words: "Start-River.cmd default" (no boot-file.txt) is the file Start-River.cmd
 *  then opens (the river's year, else the live river); a name mission control doesn't list is "an unlisted show file". */
function bootFile(pr) {
  const raw = typeof pr?.boot_file === 'string' ? pr.boot_file.trim() : null;
  if (!raw) return null;
  if (raw === BOOT_DEFAULT) {
    const have = Array.isArray(pr.show_files) ? pr.show_files : null;
    const name = !have || have.includes(YEAR_FILE) || !have.includes(LIVE_FILE) ? YEAR_FILE : LIVE_FILE;
    return { name, kind: FILES[name].kind, label: FILES[name].label, default: true, reported: raw };
  }
  return { name: raw, kind: FILES[raw]?.kind ?? 'other', label: FILES[raw]?.label ?? UNLISTED, default: pr.boot_file_chosen === false, reported: raw };
}

// ---- the model ----------------------------------------------------------------------------------------------
export function derive(status, nowMs) {
  const st = obj(status) ?? {};
  const serverNow = num(st.now), pageNow = num(nowMs);
  const now = serverNow ?? pageNow ?? Date.now();
  const page_age_s = serverNow != null && pageNow != null ? Math.max(0, Math.round((pageNow - serverNow) / 1000)) : 0;
  // the unrounded age, by the same > 30 s rule as ui.js watchContact, so the verdict flips in the same second as the header
  const pageStale = serverNow != null && pageNow != null && pageNow - serverNow > PAGE_STALE_S * 1000;
  const S = {};
  for (const k of Object.keys(POLL_S)) S[k] = source(st[k], k, serverNow);
  const { bitcube: bc, seasons: se, modal: md, probe: pb } = S;

  // ---- changes being applied (status.applying, from every phone and the studio chat) -------------------------------------
  // Each entry is a lock on the actions in its blocks until its request ends (a switch or a rebuild: until TouchDesigner answers
  // on its file, the server's phase 'confirming'); one older than its limit is a request that never ended and is ignored.
  // Elapsed time is on the server's clock carried forward by this phone's (as page_age_s), so it ticks.
  const applyNow = pageNow ?? now;
  const applying = (Array.isArray(st.applying) ? st.applying : []).map(obj).filter((a) => a && typeof a.action === 'string').map((a) => {
    const raw = num(a.started_at), started = raw == null ? null : raw < 1e12 ? raw * 1000 : raw;   // ms (seconds accepted)
    const expect_s = num(a.expect_s) ?? 60, elapsed = started != null ? Math.max(0, (applyNow - started) / 1000) : 0;
    const label = typeof a.label === 'string' && a.label.trim() ? a.label.trim() : APPLY_LABEL[a.action] ?? 'a change';
    const blocks = Array.isArray(a.blocks) ? a.blocks.filter((b) => typeof b === 'string') : APPLY_BLOCKS[a.action] ?? [a.action];
    return { id: a.id ?? null, action: a.action, label, file: typeof a.file === 'string' ? a.file : null, started_at: started, expect_s, elapsed_s: Math.round(elapsed), blocks,
             phase: a.phase === 'confirming' ? 'confirming' : 'applying',
             words: `${cap(label)} is being applied${started != null ? ` (started ${clock(started)})` : ''}`, old: started != null && elapsed > confirmLimitS(expect_s) };
  }).filter((a) => !a.old).map(({ old: _o, ...a }) => a);
  // A switch or a rebuild (it ends in a switch to the river's year) restarts TouchDesigner: until it answers on the file, the full
  // check sees it not running (the launcher waits 10 s), then not answering while the file loads. That is the restart, never a
  // fault to press Switch for (a second switch kills the half-opened file: another minute dark) (R6 #26).
  const restartBy = applying.find((a) => a.action === 'switch' || a.action === 'rebuild') ?? null;

  // What each source says, defensively: a half-written payload must never throw.
  const online = typeof obj(bc.value)?.online === 'boolean' ? bc.value.online : null;      // null = not checked
  const pr = obj(pb.value), td = obj(pr?.td), dv = obj(pr?.devices), link = obj(pr?.modal_link), rec = obj(pr?.recorder);
  const tdErr = td && td.ok === false ? String(td.error || 'not answering') : null;
  const tdOk = !!td && td.ok !== false && typeof td.file === 'string';
  const byEntry = !!tdErr && !!restartBy && !/restarting/i.test(tdErr);   // not running or not answering, while a switch restarts it
  const frozen = !!tdErr && !byEntry && !/not running|restarting/i.test(tdErr);
  const tdOff = !!tdErr && !byEntry && /not running/i.test(tdErr);
  const tdRestarting = !!tdErr && (byEntry || /restarting/i.test(tdErr));
  const restartingOn = !tdRestarting ? null : byEntry ? FILES[restartBy.file ?? YEAR_FILE]?.label ?? 'a show file' : FILES[/on (\S+)/.exec(tdErr)?.[1]]?.label ?? 'a show file';
  const file = tdOk ? FILES[td.file] ?? { kind: 'other', label: UNLISTED } : null;
  const kind = file?.kind ?? null, label = file?.label ?? null;
  // One name for the button the advice points at: the show-file control says "Restart on the river's year" when it already
  // runs, and "Switch to the river's year" when another file (or nothing known) runs. status.js labels its jump the same way.
  const YEAR_PRESS = yearPress(kind);
  const y = obj(se.value);                                                   // the seasons page's /state
  const year = (y && !se.stale ? y : null) ?? obj(td?.seasons) ?? y;        // the year, from whichever report is fresher
  const yearOk = !!year && typeof year.season === 'string';
  const m = obj(md.value);
  const fps = tdOk ? num(td.fps) : null, tdErrors = tdOk ? num(td.errors) ?? 0 : 0;
  const slow = fps != null && fps < TD_SLOW_FPS;
  const uptimeH = num(pr?.uptime_h), upS = uptimeH != null ? uptimeH * 3600 + (pb.age_s ?? 0) : null;
  const booted = uptimeH != null && uptimeH < COMING_UP_H;                  // bitcube itself just restarted
  const tdStarting = tdOk && fps == null;                                    // first check since TouchDesigner (re)started
  const tdOffBooting = tdOff && booted;                                      // not up yet, but bitcube only just started: wait, not a fault
  const comingUp = !!pr && (booted || tdStarting);
  const ro = obj(td?.ropes), rs = obj(ro?.status), senderKnown = !!rs && typeof rs.open === 'boolean';
  const senderErr = senderKnown && !!rs.error ? String(rs.error) : null;
  const senderOpen = senderKnown && rs.open === true && !senderErr;
  const senderOff = senderKnown && rs.active === false;
  const senderTaken = /10048/.test(senderErr || '');   // the ropes' connection held by another program (Will's rope lights)
  const ropesDark = tdOk && (ro?.source === 'black' || rs?.source === 'black');
  const box = { 'rope box 1': dv ? dv.psac10_1 === true : null, 'rope box 2': dv ? dv.psac10_2 === true : null };
  const boxesDown = Object.keys(box).filter((k) => box[k] === false);
  const displays = Array.isArray(pr?.displays) ? pr.displays : null;
  const led = displays ? displays.some((d) => /^LED/i.test(String(d))) : null;
  const realDisplays = displays ? displays.map((d) => String(d ?? '').replace(/\u0000/g, '').trim()).filter(Boolean) : [];   // the list can hold only a NUL
  const ledMissing = led === false;
  const hub = obj(td?.hub75);
  const internetDown = dv?.internet === false, routerDown = dv?.router === false;
  const galleryDown = dv?.gallery_cam === false, riverDown = dv?.river_cam === false;
  const relay = obj(td?.river_cam);                                          // only the live river file has one
  const relayAge = relay ? num(relay.last_frame_age_s) : null;
  const riverStale = !!relay && relay.running !== false && relay.fresh !== true && !riverDown;
  const relayAgeNow = relayAge != null ? relayAge + (pb.age_s ?? 0) : null;
  const counter = yearOk ? obj(year.presence)?.available === true : null;
  const diskGb = num(pr?.disk_free_gb), diskLow = diskGb != null && diskGb < DISK_LOW_GB;
  // A calibration run (lib/lights.mjs: the probe carries the job's progress file): the ropes are in patterns on purpose.
  // Time left: the stage's expected_s scaled to the whole run by the stages' typical lengths, minus what has elapsed.
  // The copy's own age: mission control serves the newest copy there is (Lights' reads every 5 s, inside an older full check), so
  // it is aged by its own read time (read_age_s, or read_at on the served clock), else as old as the full check that carried it;
  // then by the seconds since this answer, so it counts down between answers as the Lights card does (R6 #33).
  const cal = obj(pr?.calibration), calibrating = !!cal && cal.running === true && cal.stale !== true;
  const calTotalS = calibrating && num(cal.expected_s) != null && CAL_STAGE_S[cal.stage] ? CAL_TOTAL_S / CAL_STAGE_S[cal.stage] * cal.expected_s : CAL_TOTAL_S;
  const calReadAge = !calibrating ? null : num(cal.read_age_s) ?? (num(cal.read_at) != null && serverNow != null ? Math.max(0, (serverNow - cal.read_at) / 1000) : null) ?? pb.age_s ?? 0;
  const sinceAnswerS = serverNow != null && pageNow != null ? Math.max(0, (pageNow - serverNow) / 1000) : 0;
  const calLeftS = calibrating ? Math.max(0, Math.round(calTotalS - (num(cal.elapsed_s) ?? 0) - calReadAge - sinceAnswerS)) : null;
  const calNearly = calibrating && calLeftS < Math.min(NEARLY_DONE_S, calTotalS / 4);
  const calLeftWords = calibrating ? (calNearly ? 'nearly done' : `about ${dur(calLeftS)} more`) : null;
  // a dry run (or a decode of earlier photos) touches no lights; a full run has the ropes in patterns from start to end, and
  // the panels in their own stages: then they are "in calibration patterns", never "showing the river" or "dark on purpose"
  const calDry = calibrating && (cal.mode === 'dry-run' || cal.mode === 'decode-only' || cal.dry_run === true || !!cal.decode_only);
  const calRopes = calibrating && !calDry, calPanels = calRopes && /^hub75-/.test(String(cal.stage ?? ''));
  const calWords = calRopes ? (calNearly ? 'in calibration patterns, nearly done' : `in calibration patterns for ${calLeftWords}`) : null;
  const calStageWords = calibrating ? CAL_STAGE_WORDS[cal.stage] ?? 'at work' : null;

  // Dave's agent: a past next tick is a fault only by day (it rests overnight), measured in daytime minutes.
  const finMs = m ? Date.parse(m.finished_at) : NaN, nextMs = m && num(m.next_tick_epoch) != null ? m.next_tick_epoch * 1000 : null;
  const lateMin = nextMs != null ? daytimeMinutes(nextMs, now) : 0;
  const modalOverdue = !!m && lateMin > MODAL_LATE_MIN;
  const modalUnreachable = md.present && !m;
  const sinceTickS = Number.isFinite(finMs) ? (now - finMs) / 1000 : null;

  // The Modal link's clips, per camera: the last good clip is the last INFO line; failures only touch the file. A fresh check
  // judges them now (their ages grow with the check's own age); a stale one as of its own time, so the last answer's verdict
  // is kept and only greyed, never turned into "posting" by an age nobody saw.
  const probeAge = pb.age_s ?? 0, probeFresh = !pb.stale;
  const at = (ageS) => (ageS == null ? 'an unknown time' : clockDay(now - ageS * 1000, now));   // a moment, never an age that freezes
  const clips = {};
  for (const cam of ['gallery', 'river']) {
    const l = obj(link?.[cam]);
    if (!l) { clips[cam] = { present: false }; continue; }
    // a line is never newer than its file: the time of day alone wraps at 24 h, so a log not written since yesterday's
    // same minute would read as seconds old; the file's own age (log_age_s) is the floor
    const lineA = l.last == null ? null : lineAge(l.last, pr?.time), fileA = num(l.log_age_s);
    const age = lineA == null ? null : Math.max(lineA, fileA ?? 0);
    const ageNow = age != null ? age + probeAge : null;
    const judged = probeFresh ? ageNow : age, fileJudged = (fileA ?? 0) + (probeFresh ? probeAge : 0);
    const sinceClock = l.last ? String(l.last).slice(0, 5) : null;
    const quiet = fileJudged > CLIP_LATE_S;   // nothing written at all: not posting
    clips[cam] = { present: true, age_s: ageNow, since: sinceClock, failing: l.last == null || judged == null || judged > CLIP_LATE_S || quiet,
                   quiet, last: l.last ?? null };
  }
  const linkProcs = link ? num(link.processes) ?? 0 : null;
  const linkDown = linkProcs === 0;
  const failing = ['gallery', 'river'].filter((c) => clips[c].present && clips[c].failing && !linkDown);
  const syncLine = obj(link?.sync), syncAge = syncLine?.last ? lineAge(syncLine.last, pr?.time) : null;
  const syncAgeNow = syncAge != null ? syncAge + probeAge : null;
  const syncOld = (probeFresh ? syncAgeNow : syncAge) != null && (probeFresh ? syncAgeNow : syncAge) > MODAL_LATE_MIN * 60;
  const recLast = rec && rec.last != null ? String(rec.last) : null;
  const recErr = !!recLast && !/\bdone\b/i.test(recLast) && /no video|connection|timed out|error|failed/i.test(recLast);

  // Why the things behind bitcube cannot be judged (null when the full check answered).
  const behind = online === false ? ['Behind bitcube, which is offline', "It is checked from bitcube, so nothing is known while bitcube is offline."]
    : !pb.present ? ['Not checked yet', "bitcube's full check runs about once a minute; the first one is still to come."]
    : !pr ? ['Not known: the full check of bitcube failed', `The last full check failed: ${probeWords(pb.error)}.`]
    : null;

  // ---- items ------------------------------------------------------------------------------------------------
  const items = [];
  const it = (id, level, summary, detail, extra = {}) => {
    const [name, from, address] = NAMES[id];
    const srcKey = extra.source ?? (from === 'mini' ? null : 'probe');
    const src = srcKey ? S[srcKey] : null;
    const stale = pageStale || (src ? src.stale && !(srcKey === 'probe' && online === false) : false);
    items.push({ id, name, level, summary, detail, action: extra.action ?? null, checked_from: from,
                 age_s: extra.age_s ?? src?.age_s ?? null, stale, address: extra.address ?? address, cause: null, muted: !!extra.muted,
                 raw: extra.raw ?? null });   // raw text for "Addresses and links (for Will)", never the main view
  };
  const unknown = (id, [summary, detail], extra) => it(id, 'unknown', summary, detail, extra);

  it('mission control', pageStale ? 'unknown' : 'ok', pageStale ? `No answer for ${dur(page_age_s)}` : 'Serving this page',
    pageStale ? `This page last heard from mission control ${dur(page_age_s)} ago. Your connection, or the Mac mini, may be down.`
              : 'It checks bitcube every 5 s and runs a full check about once a minute.', { age_s: page_age_s });

  const upWords = uptimeH == null ? 'a while' : dur(uptimeH * 3600);   // dur()'s form, like every other duration
  if (online === false) it('bitcube', 'down', 'Offline: not reachable from the Mac mini',
    `The Mac mini could not connect to bitcube${pb.error ? `; its full check has been failing for ${dur(pb.failing_s ?? pb.age_s)}` : ''}. The show may still be running by itself.`,
    { source: 'bitcube', action: "Someone at Gray Area checks bitcube's power light and the router; a restart takes about a minute and it comes back by itself." });
  else if (online === true && pr) it('bitcube', 'ok', `Online; up ${upWords}${diskLow ? `, only ${diskGb} GB of disk free` : ''}`,   // the disk only when it is the reason
    `${comingUp ? 'Restarted recently and still coming up. ' : ''}Its full check answered${diskGb != null ? `; ${diskGb} GB of disk free` : ''}.`,
    { source: 'bitcube', raw: Array.isArray(pr.addresses) && pr.addresses.length ? `addresses: ${pr.addresses.map((a) => `${a?.nic} ${a?.ip}`).join(', ')}` : null });
  else if (online === true && pb.present) it('bitcube', 'warning', 'Reachable, but its full check failed',
    `bitcube accepts connections, but the full check from the Mac mini failed: ${probeWords(pb.error)}.`, { source: 'bitcube', raw: pb.error, action: 'Wait a minute; the check runs again by itself. If it keeps failing, ask the studio chat to look at bitcube.' });
  else if (online === true) it('bitcube', 'ok', 'Reachable; full check still to come', 'bitcube answers the Mac mini; its first full check takes up to a minute.', { source: 'bitcube' });
  else unknown('bitcube', ['Not checked yet', 'Mission control has not checked bitcube yet.'], { source: 'bitcube' });

  if (behind) unknown('touchdesigner', behind);
  else if (!td) unknown('touchdesigner', ['Not reported by the full check', 'The full check answered without a word about TouchDesigner.']);
  else if (tdOffBooting) it('touchdesigner', 'warning', 'Not started yet: bitcube just restarted', `bitcube has been up for ${dur(upS)}; TouchDesigner opens by itself about a minute after it.`, { action: 'Wait a minute and look again.' });
  else if (tdOff) it('touchdesigner', 'down', 'Not running on bitcube', 'bitcube is up but TouchDesigner is not running, so nothing is driving the lights.',
    { action: "Start it with Switch to the river's year below (about a minute)." });
  else if (tdRestarting) it('touchdesigner', 'warning', `Restarting on ${restartingOn}`, 'The lights are dark for about a minute while it opens.', { action: 'Wait a minute and look again.', raw: tdErr });
  else if (frozen) it('touchdesigner', 'down', 'Frozen: not answering', 'TouchDesigner did not answer within 15 s, which usually means a dialog is blocking it. The lights are not being driven: the rope boxes play their own colour cycle and the panels keep their last picture.',
    { action: `Look at bitcube's screen over screen sharing and answer the dialog, or press ${YEAR_PRESS} (about a minute dark).` });
  else if (fps == null) it('touchdesigner', 'ok', `Running ${label}; frame rate not known yet`, 'The first check after a start cannot measure the frame rate; the next one can.', { raw: `file: ${td.file}` });
  else if (slow) it('touchdesigner', 'warning', `Running slowly: ${Math.round(fps)} of 60 frames a second`,
    `${cap(label)} at ${fps} frames a second, where it should run at 60${tdErrors ? `, with ${tdErrors} errors in the file` : ''}: the river moves in jerks.`,
    { action: `Look at bitcube's screen for what is slow or erroring; if it does not recover in a few minutes, press ${YEAR_PRESS} (about a minute dark).` });
  else it('touchdesigner', 'ok', `Running ${label} at ${Math.round(fps)} frames a second`, `${cap(label)}: ${fps} frames a second, ${tdErrors ? `${tdErrors} errors in the file` : 'no errors'}.`, { raw: `file: ${td.file}` });

  const intensity = yearOk ? num(year.intensity) : null;
  // Automatic's pace from the year-length rule (the seasons page's rules; the full check's copy of the year has none)
  const pace = seasonPace(num(obj(obj(year?.rules)?.cycle_seconds)?.value) ?? num(obj(obj(y?.rules)?.cycle_seconds)?.value));
  const modeWords = !yearOk ? '' : year.mode === 'manual' ? `set by hand, heading for ${year.target ?? obj(year.manual)?.season ?? 'a season'}`
    : year.mode === 'dynamic' ? (year.effective_mode === 'dynamic' ? 'people are steering it' : 'dynamic, but running automatic while the people counter is unavailable')
    : ['the clock turns the year', pace].filter(Boolean).join(', ');
  if (y && yearOk) it('seasons', 'ok', `${cap(y.mode)}, ${y.season}, ${intensityWord(intensity)}`,
    `${cap(modeWords)}. ${Array.isArray(y.history) && y.history.length === 0 ? 'The year has just started. ' : ''}${counter ? '' : 'There is no people counter yet; that is normal.'}`,
    { source: 'seasons' });
  else if (online === false) unknown('seasons', ['Behind bitcube, which is offline', 'Its page could not be fetched because bitcube is offline, not because the year is not running.'], { source: 'seasons' });
  else if (!se.present) unknown('seasons', ['Not checked yet', 'Mission control has not asked its page yet.'], { source: 'seasons' });
  else if (tdOffBooting || tdRestarting) it('seasons', 'warning', `Not served while TouchDesigner ${tdRestarting ? 'restarts' : 'starts'}`, 'Its page comes up with TouchDesigner, in about a minute.', { source: 'seasons' });
  else if (frozen || tdOff) it('seasons', 'down', frozen ? 'Page not answering: TouchDesigner is frozen' : 'Page not served: TouchDesigner is not running',
    `The river's year page is served by TouchDesigner, so it ${frozen ? 'froze' : 'went'} with it.`, { source: 'seasons' });
  else if (kind === 'live') it('seasons', 'warning', 'Not running: TouchDesigner is showing the live river',
    "The live river has no year of seasons and no year page, so the year's controls are unavailable until the river's year runs.",
    { source: 'seasons', action: "Press Switch to the river's year if the year is wanted (the lights go dark for about a minute)." });
  else if (kind === 'year') it('seasons', 'warning', 'Page not answering', `TouchDesigner runs the river's year, but ${fetchWords(se.error)}.`,
    { source: 'seasons', action: `Wait a minute; if it stays down, press ${YEAR_PRESS}.` });
  else if (kind === 'other') it('seasons', 'warning', `Not running: TouchDesigner is showing ${label}`, 'That show file serves no year page.',
    { source: 'seasons', action: "Press Switch to the river's year (the lights go dark for about a minute)." });
  else it('seasons', 'warning', 'Page not answering', `${cap(fetchWords(se.error))}; waiting for the full check of bitcube to say why.`, { source: 'seasons' });

  const watts = Array.isArray(rs?.watts) ? rs.watts.map(num) : null, capW = num(ro?.box_watts_cap);
  const wattsWords = watts ? `${watts.join(' + ')} W${capW ? ` of ${capW} W per box` : ''}` : 'sender open';
  const showing = kind === 'live' ? (relay?.fresh ? 'Showing the live river' : 'Showing the rain fallback: no live frames') : 'Showing the river';
  const boxWords = (k) => `rope box ${k.slice(-1)} (ropes ${ROPE_BOX[k][1]})`;
  if (behind) unknown('ropes', behind);
  else if (!td) unknown('ropes', ['Not reported by the full check', 'The full check answered without a word about TouchDesigner, which drives the ropes.']);
  else if (tdRestarting || tdOffBooting) it('ropes', 'warning', `Dark while TouchDesigner ${tdRestarting ? 'restarts' : 'starts'}`, 'The sender comes back with TouchDesigner, in about a minute.');
  else if (!tdOk) it('ropes', 'down', `Not being driven: TouchDesigner is ${tdOff ? 'not running' : 'frozen'}`,
    `With nothing sending, the boxes ${boxesDown.length === 2 ? 'are silent too' : 'play their own colour cycle'}.`);
  else if (!senderKnown) it('ropes', 'warning', 'Sender state not reported', rs?.error ? `The sender's status could not be read: ${rs.error}` : 'This show file has no rope sender.');
  else if (senderErr || !rs.open) {
    const why = /10049/.test(senderErr || '') ? "bitcube's LIGHTS port has no link (nothing is plugged into it)" : senderTaken ? "another lights program on bitcube (Will's rope lights, or a second sender) is using the ropes' connection; the two must never run at once" : 'it cannot open its connection on the lighting network';
    const both = boxesDown.length === 2;
    it('ropes', both ? 'down' : 'warning', both ? `Not reaching the lights: sender ${rs.retrying ? 'retrying' : 'closed'}, both boxes silent` : senderTaken ? "Another program on bitcube is using the ropes' connection" : `Sender can't open its port${boxesDown.length ? `; ${boxWords(boxesDown[0])} silent` : ''}`,
      `The sender is ${rs.retrying ? 'retrying' : 'stopped'}: ${why}.${both ? ' Expected before the lights are connected; it picks up by itself once they are.' : ''}`,
      { action: both ? "In the ceiling: plug the lighting switch into bitcube's LIGHTS port; the sender picks up by itself." : senderTaken ? TAKEN_ACTION : "Check the lighting switch and the cable into bitcube's LIGHTS port.", raw: senderErr });
  } else if (senderOff) it('ropes', 'warning', 'Sender switched off', 'The sender is not active, so the ropes get nothing.', { action: 'Press Ropes → On to turn it back on.' });
  else if (calRopes && boxesDown.length < 2) it('ropes', 'warning', cap(calWords), `The calibration is ${calStageWords}; the ropes come back to the river by themselves when it ends.`,
    { action: 'If the room is needed now, stop it on the Lights page: the ropes come back at once.' });
  else if (ropesDark) it('ropes', 'warning', 'Dark on purpose: sending black', 'The sender is open and sending black; both boxes stay dark instead of playing their own colour cycle. Not a fault.',
    { action: 'Press Ropes → On to show the river again; they follow within a few seconds.', raw: watts ? wattsWords : null });
  else if (boxesDown.length === 2) it('ropes', 'down', 'Both rope boxes are silent: the ropes are dark', 'The sender is open but neither box answers over the lighting network.', { action: 'Check power to the rope boxes and the lighting switch.' });
  else if (boxesDown.length === 1) it('ropes', 'warning', `${cap(boxWords(boxesDown[0]))} silent: those ropes may be dark`, `The sender is open (${wattsWords}) but ${boxWords(boxesDown[0])} does not answer.`, { action: 'Check power to that box and its cable to the lighting switch.' });
  else if (slow) it('ropes', 'warning', `Driven at only ${Math.round(fps)} frames a second`, `TouchDesigner is slow, so the river moves in jerks on the ropes. Sender open, ${wattsWords}.`);
  else it('ropes', 'ok', showing, `Sender open, ${wattsWords}${pr.lights_route ? `; lighting network on ${pr.lights_route === 'direct' ? "bitcube's LIGHTS port" : pr.lights_route === 'router' ? 'the router port' : pr.lights_route}` : ''}.`);

  for (const k of Object.keys(ROPE_BOX)) {
    const [addr] = ROPE_BOX[k];
    if (behind) unknown(k, behind);
    else if (box[k] == null) unknown(k, ['Not reported by the full check', 'No answer from the full check about this box.']);
    else if (box[k]) it(k, 'ok', 'Answers', `Answers from bitcube over the lighting network${!tdOk ? `, but nothing is driving it: TouchDesigner is ${tdOff ? 'not running' : tdRestarting || tdOffBooting ? 'starting' : 'frozen'}` : ''}.`);
    else it(k, 'down', 'Not answering', "No answer over the lighting network: no power, or the lighting switch is not connected to bitcube's LIGHTS port.");
  }

  const brightness = hub ? num(hub.brightness) : null;
  if (behind) unknown('hub75 panels', behind);
  else if (led == null) unknown('hub75 panels', ['Not reported by the full check', 'The full check did not list bitcube\'s displays.']);
  else if (ledMissing) it('hub75 panels', 'down', 'No panel sender: bitcube does not see one', `bitcube sees ${realDisplays.length === 1 ? 'only its own small screen' : realDisplays.length ? `only ${realDisplays.length} other screens` : 'no display at all'}, no panel sender. The panels get their picture over HDMI through the panel sender; until bitcube sees it they stay dark.${boxesDown.length === 2 ? ' Expected before the lights are connected.' : ''}`,
    { action: "Plug the panel sender into bitcube's HDMI; bitcube then sees it.", raw: realDisplays.length ? `displays: ${realDisplays.join(', ')}` : null });   // never an empty "displays:" line
  else if (!td) unknown('hub75 panels', ['Panel sender present; picture not reported', 'The full check answered without a word about TouchDesigner, which draws the picture.']);
  else if (tdRestarting || tdOffBooting) it('hub75 panels', 'warning', `Panel sender present; dark while TouchDesigner ${tdRestarting ? 'restarts' : 'starts'}`, 'The picture comes back with TouchDesigner.');
  else if (!tdOk) it('hub75 panels', 'warning', `Panel sender present, but the picture is ${frozen ? 'frozen' : 'gone'}`, frozen ? 'TouchDesigner is frozen, so the panels keep their last picture.' : 'TouchDesigner is not running, so nothing is drawn.');
  else if (!hub) it('hub75 panels', 'warning', 'Panel sender present; this file has no panel output', 'TouchDesigner reports no panels in this show file.');
  else if (calPanels) it('hub75 panels', 'warning', cap(calWords), `The calibration is ${calStageWords}; the panels come back to the river by themselves when it ends.`,
    { action: 'If the room is needed now, stop it on the Lights page: the lights come back at once.' });
  else if (hub.output === false) it('hub75 panels', 'warning', 'Panel sender present, but the panel output is off', 'The panels are switched off in the show file.');
  else if (brightness === 0) it('hub75 panels', 'warning', "At 0 %, so they're dark", 'Someone turned the panels down to nothing.', { action: 'Raise the panels brightness below.' });
  else it('hub75 panels', 'ok', `Panel sender present, brightness ${brightness != null ? `${Math.round(brightness * 100)} %` : 'not known'}`, `${ropesDark ? 'Still showing the river while the ropes are dark. ' : ''}bitcube sees the panel sender.`, { raw: realDisplays.length ? `displays: ${realDisplays.join(', ')}` : null });

  const noClip = (c) => (c.since ? `no clips to Dave since ${c.since}` : 'no clips to Dave lately');
  const clipWords = (cam) => { const c = clips[cam]; return !c.present ? '' : c.failing ? `; ${noClip(c)}` : probeFresh ? `; clips posting (last at ${at(c.age_s)})` : `; last clip at ${at(c.age_s)}`; };
  if (behind) unknown('gallery camera', behind);
  else if (!dv) unknown('gallery camera', ['Not reported by the full check', '']);
  else if (galleryDown) it('gallery camera', 'down', 'Not answering', `No answer from the camera${clipWords('gallery')}; no picture can be fetched.`,
    { action: GALLERY_ACTION });
  else it('gallery camera', 'ok', `Reachable${clips.gallery.present && !clips.gallery.failing && probeFresh ? '; clips posting' : ''}`, `Answers${clipWords('gallery')}.`);

  if (behind) unknown('river camera', behind);
  else if (!dv) unknown('river camera', ['Not reported by the full check', '']);
  else if (riverDown && internetDown) it('river camera', 'down', 'Unreachable: no internet at Gray Area', 'The river camera is reached over the internet (Starlink at the river); without internet bitcube cannot see it.');
  else if (riverDown) it('river camera', 'down', 'Not answering: the river site is down', `The river site runs on solar power and Starlink and goes down when the battery is flat. ${kind === 'live' ? 'The show is running on the rain fallback' : "The river's year does not use it"}${clipWords('river')}.`,
    { action: 'The river site needs sun; nothing to do from here.' });
  else if (relay && relay.running === false) it('river camera', 'warning', "Reachable, but TouchDesigner isn't reading it", "The camera answers, but TouchDesigner's reader for it has stopped.");
  else if (relay && relay.fresh) it('river camera', 'ok', `Live: fresh frames${relay.night ? ' (infrared, night)' : ''}`, `Last frame at ${at(relayAgeNow)}${clipWords('river')}.`, { raw: num(relay.frames) ? `${relay.frames} frames so far` : null });
  else if (relay) it('river camera', 'warning', `Answers, but no frames for ${dur(relayAgeNow)}`, `The camera accepts connections but has sent nothing for ${dur(relayAgeNow)}; the panels and ropes show the rain fallback meanwhile${clipWords('river')}.`,
    { action: "Ask Will to restart the river camera, or wait for the Starlink link to settle. If the live river isn't needed tonight, switch to the river's year, which doesn't use it." });
  else it('river camera', 'ok', `Reachable${clips.river.present && !clips.river.failing && probeFresh ? '; clips posting' : ''}`, `Answers over Starlink${clipWords('river')}. The river's year does not use it; the recorder and clips to Dave do.`);

  if (behind) unknown('router', behind);
  else if (!dv) unknown('router', ['Not reported by the full check', '']);
  else if (routerDown) it('router', 'down', 'Not answering', 'bitcube cannot reach the router; the gallery camera and the internet go through it.', { action: 'Check the router\'s power; it comes back by itself in about two minutes.' });
  else it('router', 'ok', 'Answers', 'bitcube reaches the router, on the gray-river Wi-Fi.');

  if (behind) unknown('internet', behind);
  else if (!dv) unknown('internet', ['Not reported by the full check', '']);
  else if (internetDown) it('internet', 'down', 'No internet from bitcube', routerDown ? 'The router is not answering either.' : "The router answers, so its internet connection has gone (the venue's staff Wi-Fi, or the wired connection). Mission control still reaches bitcube.",
    { action: INTERNET_ACTION });
  else it('internet', 'ok', 'bitcube reaches the internet', 'A connection out of Gray Area works.');

  if (!md.present) unknown('modal agent', ['Not checked yet', "Mission control has not asked Dave's agent yet."], { source: 'modal' });
  else if (!m) it('modal agent', 'warning', 'Unreachable from the Mac mini', `The Mac mini asked Dave's agent and ${fetchWords(md.error, true)}.`, { source: 'modal', action: "Tell Dave if it stays unreachable; the room is unaffected while the river's year runs." });
  else if (m.ok === false) it('modal agent', 'warning', 'Reports a problem', "Dave's agent says something is wrong on its side.", { source: 'modal', action: 'Tell Dave.', raw: `mood ${m.mood}, tick ${m.tick}` });
  else if (modalOverdue) it('modal agent', 'warning', `Hasn't updated for ${dur(sinceTickS)}`,
    `It last updated at ${Number.isFinite(finMs) ? clockDay(finMs, now) : 'an unknown time'}. It updates every 5 minutes by day and rests overnight; it has missed ${dur(lateMin * 60)} of daytime updates, though it doesn't report a problem itself.`,
    { source: 'modal', action: DAVE_LATE_ACTION });
  else if (nextMs != null && nextMs < now) it('modal agent', 'ok', `${inRest(now) ? 'Resting overnight' : 'Update due'}; last update ${Number.isFinite(finMs) ? clockDay(finMs, now) : 'not known'}`,
    inRest(now) ? 'It rests from 23:55 to 07:00 Pacific, so a missed update is normal at this hour.' : 'An update is due; it gets 15 minutes of daytime before that counts as a fault.', { source: 'modal' });
  else it('modal agent', 'ok', 'Updating on schedule', `${Number.isFinite(finMs) ? `Last updated at ${clockDay(finMs, now)}` : 'Last update time not known'}${nextMs != null ? `; next update due at ${clockDay(nextMs, now)}` : ''}${obj(m.scene) ? `; its scene is ${m.scene.animation} / ${m.scene.palette}` : ''}.`, { source: 'modal', raw: `tick ${m.tick}, mood ${m.mood ?? 'none'}` });

  const sinceWords = (c) => (c.since ? `since ${c.since}` : 'for a while');
  if (behind) unknown('modal link', behind);
  else if (!link) unknown('modal link', ['Not reported by the full check', '']);
  else if (linkDown) it('modal link', 'warning', comingUp ? 'Not started yet: bitcube just restarted' : 'Not running on bitcube',
    `Nothing on bitcube is sending clips to Dave; it last posted at ${at(Math.max(...['gallery', 'river', 'sync'].map((c) => num(obj(link[c])?.log_age_s) ?? 0)) + probeAge)}.`,
    { action: comingUp ? 'Wait two minutes; if it is still not running after five, ask the studio chat to start it.' : 'Ask the studio chat to start it on bitcube.' });
  else if (failing.length === 2) it('modal link', 'down', `Clips failing for both cameras ${sinceWords(clips.gallery)}`, `Gallery ${sinceWords(clips.gallery)}, river ${sinceWords(clips.river)}${syncOld ? `; nothing new has come back from Dave's agent for ${dur(syncAgeNow)}` : ''}. ${internetDown ? 'Without internet nothing can be posted.' : 'Both cameras answer, so the link itself or the upload is failing.'}`);
  else if (failing.length === 1) it('modal link', 'warning', `${cap(failing[0])} clips failing ${sinceWords(clips[failing[0]])}; ${failing[0] === 'gallery' ? 'river' : 'gallery'} fine`,
    `${cap(failing[0])} clips: ${clips[failing[0]].last ? `last good one at ${clips[failing[0]].since}` : 'no good clip lately'}; the other camera posts normally.`, { raw: `${linkProcs} processes` });
  else if (modalOverdue && syncOld) it('modal link', 'warning', `Nothing new from Dave's agent for ${dur(syncAgeNow)}`, "Clips are posting fine; nothing comes back until Dave's agent changes something, and it has not.");
  else it('modal link', 'ok', probeFresh ? 'Posting' : 'Clips fine at the last check', `Gallery clip at ${at(clips.gallery.age_s)}, river clip at ${at(clips.river.age_s)}${syncAgeNow != null ? `; Dave's agent last sent something back at ${at(syncAgeNow)}` : ''}.`, { raw: `${linkProcs} processes` });

  const recClips = num(rec?.clips) ?? 0, recAt = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(recLast || '')?.[1];
  if (behind) unknown('recorder', behind);
  else if (!rec) unknown('recorder', ['Not reported by the full check', '']);
  else if (recLast == null) it('recorder', 'ok', `${recClips} clips; no log yet`, 'The hourly recorder has not written a log line.');
  else if (recErr) it('recorder', 'warning', riverDown || internetDown ? "Current run can't reach the river camera" : "Current run can't get video", `${recClips} clips so far; this hour's recording got no video from the river camera.`, { action: riverDown || internetDown ? null : 'It retries every hour; check the river camera.', raw: recLast });
  else if (/\bdone\b/i.test(recLast)) it('recorder', 'ok', `${recClips} clips; last run finished${recAt ? ` at ${recAt}` : ''}`, 'It records the river for an hour at a time.', { raw: recLast });
  else it('recorder', 'ok', `${recClips} clips; recording`, 'It records the river for an hour at a time.', { raw: recLast });

  const presence = yearOk ? obj(year.presence) : null;
  if (presence?.available) it('people counter', 'ok', `${presence.now} people now; usual ${presence.usual}`, `Relative presence ${presence.relative}× usual; empty for ${dur(presence.empty_for_s)}.`, { source: y ? 'seasons' : 'probe' });
  else if (yearOk) it('people counter', 'ok', 'Not available yet (normal)', 'There is no people counter yet, so presence is unavailable and dynamic mode cannot be chosen. The year runs without it.', { source: y ? 'seasons' : 'probe', muted: true });
  else if (behind) unknown('people counter', behind, { muted: true });
  else it('people counter', 'ok', 'Not available yet (normal)', 'There is no people counter yet; that is normal. The river\'s year runs without it.', { source: 'probe', muted: true });   // planned: never "not known"

  // ---- problems: one per cause, each explaining several items --------------------------------------------------
  const P = [];
  let fromProbe = false;   // set while adding the problems read from the full check (they are as old as it is)
  const add = (id, level, pri, headline, detail, action, ids) => P.push({ id, level, pri, headline, detail, action: action ?? null, items: ids.filter(Boolean), fromProbe });
  const tdWords = tdOk ? `TouchDesigner runs ${label}${fps != null ? ` at ${Math.round(fps)} frames a second` : ''}` : '';
  if (pageStale) add('page', 'unknown', 100, `This page can't reach mission control (no answer for ${dur(page_age_s)})`, 'What is shown is the last answer, not now.',
    'Check your connection. If other sites load, the Mac mini may be down or off its network.', ['mission control']);
  if (bc.present && bc.stale) add('bitcube-unchecked', 'unknown', 95, `Mission control hasn't checked bitcube for ${dur(bc.age_s)}`, 'Its own polling has stalled; what is shown is the last answer.',
    'Wait a minute. If it stays this way, mission control needs a restart (ask the studio chat).', ['bitcube']);
  const unseen = [...BEHIND, y ? null : 'seasons', m ? null : 'modal agent'];     // what the headline leaves unknown
  if (online === false) add('bitcube-offline', 'down', 90, 'bitcube is offline: nothing behind it can be checked',
    `The Mac mini can't reach bitcube${pb.error ? `; its full check has failed for ${dur(pb.failing_s ?? pb.age_s)}` : ''}. The show may still be running by itself.`,
    "Someone at Gray Area checks bitcube's power light and the router; a restart takes about a minute and bitcube comes back by itself. Nothing can be done from here, and every control would fail.", ['bitcube', ...unseen]);
  else if (online === true && pb.present && !pr) add('check-failed', 'warning', 85, 'bitcube answers, but its full check failed',
    `${cap(probeWords(pb.error))}${pb.failing_s != null && pb.failing_s >= 120 ? `; it has failed for ${dur(pb.failing_s)}` : ''}. TouchDesigner, the lights and the cameras can't be judged until it works.`, 'Wait a minute; the check runs again by itself. If it keeps failing, ask the studio chat to look at bitcube.', ['bitcube', ...unseen]);
  else if (!pb.present) add('not-checked', 'unknown', 70, online === true ? 'Checking: bitcube answers; everything else is not known yet' : online === null ? 'Checking: nothing is known yet' : 'Checking',
    'Mission control has just started; the full check of bitcube takes up to a minute.', 'Wait a minute. Nothing is wrong yet, and nothing is known to be right either.', unseen);
  else if (pr && pb.stale && online !== false) add('probe-stale', 'unknown', 80, `Mission control hasn't heard from bitcube for ${dur(pb.age_s)}`,
    'bitcube answers, but its last full check is old; the lights and cameras below are as they were then.', 'Wait a minute. If it stays this way the check is stuck: ask the studio chat.', ['bitcube', ...BEHIND]);

  if (pr && online !== false) {
    fromProbe = true;
    if (!td) add('td-unknown', 'unknown', 75, "bitcube answers, but its check says nothing about TouchDesigner", 'The full check came back without the TouchDesigner part, so the lights cannot be judged.', 'Wait for the next check; if it keeps happening, ask the studio chat.', ['touchdesigner', 'ropes', 'hub75 panels', y ? null : 'seasons']);
    if (frozen) add('td-frozen', 'down', 80, 'TouchDesigner is frozen: the lights are not being driven',
      "It has not answered bitcube's check; a dialog on its screen is probably blocking it. The rope boxes play their own colour cycle and the panels keep their last picture.",
      `Look at bitcube's screen over screen sharing and answer the dialog, or press ${YEAR_PRESS} (about a minute dark).`, ['touchdesigner', 'seasons', 'ropes', 'hub75 panels']);
    else if (tdOff && !booted) add('td-off', 'down', 80, 'TouchDesigner is not running: the lights are not being driven', 'bitcube is up, but TouchDesigner is not running on it.',
      "Start it with Switch to the river's year below (about a minute).", ['touchdesigner', 'seasons', 'ropes', 'hub75 panels']);
    else if (tdRestarting) add('td-restarting', 'warning', 60, `TouchDesigner is restarting on ${restartingOn}`, 'The lights are dark for about a minute while the file opens.', 'Wait a minute and look again.', ['touchdesigner', 'seasons', 'ropes', 'hub75 panels']);
    if (comingUp) add('coming-up', 'warning', 44, booted ? `bitcube restarted ${dur(upS)} ago and is still coming up` : 'TouchDesigner has just restarted and is still coming up',
      `${tdOk ? `${tdWords}${yearOk ? `, in ${year.season}` : ''}` : "TouchDesigner hasn't started yet"}${tdStarting ? '; its frame rate is not known yet' : ''}${linkDown ? "; clips to Dave haven't started yet" : ''}.`,
      `Wait two minutes and look again.${linkDown ? " If clips to Dave still haven't started after 5 minutes, ask the studio chat to start them." : ''}`,
      ['bitcube', 'touchdesigner', tdOk ? null : 'seasons', tdOk ? null : 'ropes', tdOk ? null : 'hub75 panels', linkDown ? 'modal link' : null]);
    if (tdOk) {
      const both = boxesDown.length === 2, senderBad = senderKnown && (senderErr || !rs.open);
      const senderWhy = /10049/.test(senderErr || '') ? "bitcube's LIGHTS port has no link" : senderTaken ? "another program on bitcube is using the ropes' connection" : "the sender can't use bitcube's LIGHTS port";
      if (both) add('lights', 'down', 70, `The lights aren't connected: neither rope box answers${ledMissing ? ' and bitcube sees no panel sender' : ''}`,
        `${senderBad ? `${cap(senderWhy)}${ledMissing ? ': expected before the lights are connected' : ''}. ` : ''}${tdWords}; the ropes${ledMissing ? ' and the panels' : ''} are dark.`,
        "In the ceiling: plug the lighting switch into bitcube's LIGHTS port and the panel sender into bitcube's HDMI. The ropes pick up by themselves; then check here that both boxes answer and bitcube sees the panel sender.",
        ['ropes', 'rope box 1', 'rope box 2', ledMissing ? 'hub75 panels' : null]);
      else if (senderBad && senderTaken) add('sender-taken', 'warning', 66, "Another program on bitcube is using the ropes' connection: the ropes aren't getting the river",
        `${tdWords}, but the rope sender is ${rs.retrying ? 'retrying' : 'stopped'}: another lights program (Will's rope lights, or a second sender) holds the connection, and the two must never run at once.`,
        TAKEN_ACTION, ['ropes', ...boxesDown]);
      else if (senderBad) add('sender', 'warning', 66, "The rope sender can't use bitcube's LIGHTS port: the ropes aren't getting the river", `${tdWords}, but the sender is ${rs.retrying ? 'retrying' : 'stopped'}${boxesDown.length ? `; ${boxWords(boxesDown[0])} is silent too` : '; both boxes answer'}.`,
        "Check the lighting switch and the cable into bitcube's LIGHTS port; the sender picks up by itself.", ['ropes', ...boxesDown]);
      else if (boxesDown.length) add('box', 'warning', 64, `${cap(boxWords(boxesDown[0]))} isn't answering: those ropes may be dark`, `${tdWords} and the sender is open, but the box does not answer.`,
        'Check power to that box and its cable to the lighting switch.', ['ropes', boxesDown[0]]);
      else if (senderOff) add('sender-off', 'warning', 62, 'The rope sender is switched off', `${tdWords}, but its sender is not active, so the ropes get nothing.`, 'Press Ropes → On.', ['ropes']);
      if (ledMissing && !both) add('panels', 'down', 65, 'The panels have no sender: bitcube sees no panel sender', 'The panels get their picture over HDMI through the panel sender; bitcube does not see it, so they are dark.',
        "Check the HDMI cable from bitcube to the panel sender and the sender's power.", ['hub75 panels']);
      else if (hub && hub.output === false) add('panels-off', 'warning', 58, "The panels' output is switched off in the show file", 'The show file has its panel output off.', 'Ask the studio chat to turn it on.', ['hub75 panels']);
      else if (hub && brightness === 0) add('panels-dark', 'warning', 58, "The panels are at 0 %, so they're dark", 'Someone turned the panels down to nothing.', 'Raise the panels brightness below.', ['hub75 panels']);
      if (slow) add('td-slow', 'warning', 60, 'TouchDesigner is running slowly: the river will look jerky', `${cap(label)} at ${fps} frames a second instead of 60${tdErrors ? `, with ${tdErrors} errors in the file` : ''}.`,
        `Look at bitcube's screen for what is slow or erroring; if it doesn't recover in a few minutes, press ${YEAR_PRESS} (about a minute dark).`, ['touchdesigner', 'ropes']);
      if (calibrating && calDry) add('calibrating', 'warning', 61, "Calibration dry run: the lights stay as they are",
        `It walks the calibration's steps without touching the lights (${calStageWords} now) and ends by itself in about a minute.`,
        'Nothing to do; it ends by itself. To end it now, stop it on the Lights page.', ['ropes']);
      else if (calibrating) add('calibrating', 'warning', 61, `Calibrating the lights: the ropes${calPanels ? ' and the panels are' : ' are'} in patterns${calNearly ? ', nearly done' : ` for ${calLeftWords}`}`,
        `The calibration is ${calStageWords}; the ropes${calPanels ? ' and the panels' : ''} come back to the river by themselves when it ends.`,
        "Keep people out of the camera's view. If the room is needed now, stop it on the Lights page: the ropes come back at once.", ['ropes', calPanels ? 'hub75 panels' : null]);
      else if (ropesDark) add('ropes-dark', 'warning', 42, 'The ropes are dark on purpose; everything else is up',
        'Someone pressed Ropes → Dark: the sender keeps sending black, so the boxes stay dark instead of playing their own colour cycle. The panels still show the river.',
        'If the ropes should be showing the river, press Ropes → On; they follow within a few seconds. Nothing is broken.', ['ropes']);
      if (kind === 'live') add('online-file', 'warning', 40, "TouchDesigner is showing the live river, not the river's year: the year and its controls are unavailable",
        `The live river has no year of seasons and no year page.${FILES[pr.boot_file]?.kind === 'year' ? " The river's year opens at the next restart." : ''}`,
        "If nobody chose this on purpose, press Switch to the river's year below; the lights go dark for about a minute. If the live river is wanted tonight, leave it.", ['seasons']);
      else if (kind === 'other') add('old-file', 'warning', 40, `TouchDesigner is showing ${label}, not the river's year: the year and its controls are unavailable`,
        `It is neither the river's year nor the live river.${FILES[pr.boot_file]?.kind === 'year' ? " The river's year opens at the next restart." : ''}`,
        "Press Switch to the river's year below; the lights go dark for about a minute.", ['seasons']);
      else if (kind === 'year' && !y && se.present) add('year-page', 'warning', 46, "The river's year page isn't answering, though TouchDesigner runs it", `${cap(fetchWords(se.error))}; the year's controls come back when it answers properly.`,
        `Wait a minute; if it stays down, press ${YEAR_PRESS} (about a minute dark).`, ['seasons']);
      if (riverStale) add('river-stale', 'warning', 55, `The river camera has sent no frames for ${dur(relayAgeNow)}: the show is running on the rain fallback`,
        `The camera answers but sends nothing${clips.river.present && clips.river.failing ? `; no clips to Dave ${sinceWords(clips.river)}` : ''}.`,
        "Ask Will to restart the river camera, or wait for the Starlink link to settle. If the live river isn't needed tonight, switch to the river's year, which doesn't use it.",
        ['river camera', clips.river.failing ? 'modal link' : null, recErr ? 'recorder' : null]);
    }
    if (internetDown) add('no-internet', 'warning', 54, routerDown ? "The router isn't answering: no internet and no gallery camera, but the show runs by itself"
                                                     : "No internet at Gray Area: the show runs, but clips can't reach Dave's agent and the river site is unreachable",
      `${routerDown ? 'bitcube cannot reach the router, so nothing behind it answers.' : "The router answers, so its internet connection has gone (the venue's staff Wi-Fi, or the wired connection)."}${kind === 'year' ? " The river's year needs no network." : kind === 'live' ? ' The live river has fallen back to the rain.' : ''}${failing.length ? ` Clips to Dave have been failing ${sinceWords(clips[failing[0]])}.` : ''}`,
      routerDown ? "Check the router's power; it comes back by itself in about two minutes. The show keeps running meanwhile." : INTERNET_ACTION,
      ['internet', routerDown ? 'router' : null, routerDown && galleryDown ? 'gallery camera' : null, 'modal link', riverDown ? 'river camera' : null, recErr ? 'recorder' : null]);
    else if (routerDown) add('router', 'warning', 52, "The router isn't answering; bitcube is still reachable", 'bitcube cannot reach the router, so the gallery camera and the internet may be gone with it.',
      "Check the router's power; it comes back by itself in about two minutes.", ['router', galleryDown ? 'gallery camera' : null]);
    else if (riverDown) add('river-site', 'warning', 50, `The river site is down${kind === 'live' ? ': the show is running on the rain fallback' : "; the river's year doesn't use it"}`,
      `The river camera does not answer${clips.river.present && clips.river.failing ? `; no clips to Dave ${sinceWords(clips.river)}` : ''}${recErr ? '; the recorder cannot get video' : ''}.`,
      `The river site needs sun; nothing to do from here.${kind === 'live' ? " If the live river isn't needed tonight, switch to the river's year." : ''}`, ['river camera', clips.river.failing ? 'modal link' : null, recErr ? 'recorder' : null]);
    if (galleryDown && !routerDown) add('gallery-cam', 'warning', 48, "The gallery camera is down: no picture of the room and no clips to Dave's agent; the show itself is unaffected",
      `No answer from the camera${clips.gallery.present && clips.gallery.failing ? `; no clips to Dave ${sinceWords(clips.gallery)}` : ''}.`,
      GALLERY_ACTION, ['gallery camera', clips.gallery.failing ? 'modal link' : null]);
    const unexplained = failing.filter((c) => !internetDown && !(c === 'gallery' && galleryDown) && !(c === 'river' && (riverDown || riverStale)));
    if (linkDown && !comingUp) add('link-off', 'warning', 35, "Clips to Dave aren't running on bitcube", 'Nothing on bitcube is sending clips; the cameras are fine but nothing reaches Dave.',
      'Ask the studio chat to start clips to Dave on bitcube.', ['modal link']);
    else if (unexplained.length) add('link-failing', 'warning', 34, `Clips from the ${unexplained.join(' and ')} camera${unexplained.length > 1 ? 's' : ''} aren't reaching Dave's agent, ${sinceWords(clips[unexplained[0]])}`,
      'The camera answers and the internet works, so the link itself is failing.', 'Ask the studio chat to look at clips to Dave on bitcube.', ['modal link']);
    if (recErr && !riverDown && !riverStale && !internetDown) add('recorder', 'warning', 30, "The river recorder can't get video from the river camera", "This hour's recording got no video from the river camera.", 'It retries every hour; check the river camera.', ['recorder']);
    if (diskLow) add('disk', 'warning', 32, `bitcube's disk is nearly full (${diskGb} GB free)`, 'Recordings and clips fill it up.', 'Ask the studio chat to clear old recordings.', ['bitcube']);
    fromProbe = false;
  }
  const modalPri = kind === 'live' ? 58 : 45;   // Dave's scene is on the panels only in the live river file
  const roomWords = kind === 'live' ? ': the panels keep his last scene' : " (the room is unaffected: the river's year doesn't use its scene)";
  if (modalUnreachable) add('modal-unreachable', 'warning', modalPri, `Dave's agent is unreachable from the Mac mini${roomWords}`, `${cap(fetchWords(md.error, true))} when the Mac mini asked.`, 'Tell Dave if it stays unreachable.', ['modal agent']);
  else if (modalOverdue) add('modal-stalled', 'warning', modalPri, `Dave's agent hasn't updated for ${dur(sinceTickS)}${roomWords}`,
    `It last updated at ${Number.isFinite(finMs) ? clockDay(finMs, now) : 'an unknown time'}. It updates every 5 minutes by day and rests overnight; it has missed ${dur(lateMin * 60)} of daytime updates.${syncOld ? ` Nothing new has come back to bitcube for ${dur(syncAgeNow)}.` : ''}`,
    DAVE_LATE_ACTION, ['modal agent', syncOld ? 'modal link' : null]);
  else if (m && m.ok === false) add('modal-not-ok', 'warning', modalPri, `Dave's agent reports a problem${roomWords}`, 'It says something is wrong on its side.', 'Tell Dave.', ['modal agent']);
  if (md.present && md.stale) add('modal-stale', 'unknown', 15, `Mission control hasn't checked Dave's agent for ${dur(md.age_s)}`, 'What is shown about it is the last answer.', 'Wait a minute; if it stays this way, mission control needs a look.', ['modal agent']);
  if (se.present && se.stale && y && online !== false && !pageStale) add('seasons-stale', 'unknown', 20, `Mission control hasn't checked the river's year page for ${dur(se.age_s)}`, 'The season and intensity shown are the last answer.', 'Wait a minute; if it stays this way, mission control needs a look.', ['seasons']);

  // Unknown must never look like OK: anything still unknown that no cause explains gets a cause of its own.
  const explained = new Set(P.flatMap((p) => p.items));
  const orphans = items.filter((x) => x.level === 'unknown' && !x.muted && !explained.has(x.id));
  if (orphans.length) add('unknown', 'unknown', 10, `Not known yet: ${orphans.map((x) => x.name.replace(/ \(.*\)$/, '')).join(', ')}`, 'Mission control has no answer about these yet.', 'Wait a minute and look again.', orphans.map((x) => x.id));
  // A page that can't reach mission control knows nothing current, so it heads the list whatever else was wrong last time
  // (docs/mission-ui.md thresholds: 30 s without an answer, the band goes Unknown); otherwise down > warning > unknown, then priority.
  // When the full check itself is old (or mission control's polling stalled), a warning read from that same old check is not
  // news: "hasn't heard from bitcube" heads the band over it (a Down still wins: it was true then and matters most).
  const staleHead = P.some((p) => p.id === 'probe-stale' || p.id === 'bitcube-unchecked');
  const rank = (p) => (staleHead && p.fromProbe && p.level === 'warning' ? LEVELS.unknown + 0.5 : LEVELS[p.level]);
  P.sort((a, b) => (b.id === 'page') - (a.id === 'page') || rank(a) - rank(b) || b.pri - a.pri);
  const causeOf = {};
  for (const p of P) for (const id of p.items) causeOf[id] ??= p.id;
  for (const x of items) x.cause = causeOf[x.id] ?? null;
  items.sort((a, b) => LEVELS[a.level] - LEVELS[b.level] || ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

  const top = P[0] ?? null;
  const okHeadline = kind === 'live' ? 'Everything is up: the live river is showing; lights and cameras fine'
    : yearOk ? `Everything is up: the river's year is in ${year.season}; lights and cameras fine` : 'Everything is up';
  const overall = {
    level: top?.level ?? 'ok',
    headline: top?.headline ?? okHeadline,
    detail: top?.detail ?? (tdWords ? `${cap(tdWords)}.` : 'Every check answered.'),   // freshness has its own line; it isn't the problem here
    action: top?.action ?? null,
    stale: pageStale || bc.stale || (online === true && pb.present && pb.stale) || (md.present && md.stale) || (se.present && se.stale && !!y && online !== false),
    cause: top?.id ?? null,
    also: P.slice(1).map((p) => p.headline),
    checked: { page_age_s, bitcube_age_s: bc.age_s, seasons_age_s: se.age_s, modal_age_s: md.age_s, probe_age_s: pb.age_s },
  };

  // both ways: a change in flight blocks what it names, and an action that would block it waits for it (a switch restarts
  // TouchDesigner, so it waits for a ropes change still in flight), as the server's Applying.conflict does
  const waitFor = (action) => { const a = applying.find((x) => x.blocks.includes(action) || (APPLY_BLOCKS[action] ?? []).includes(x.action)); return a ? `wait: ${a.label} is being applied` : null; };

  // ---- show: what the piece is doing -----------------------------------------------------------------------------
  const ropesState = !pr || online === false || !td ? 'unknown' : !tdOk || !senderKnown || senderErr || !rs.open || senderOff || boxesDown.length === 2 ? 'not-reaching' : calRopes ? 'calibrating' : ropesDark ? 'dark' : 'river';
  const ropesWords = { river: kind === 'live' ? (relay?.fresh ? 'the ropes show the live river' : 'the ropes show the rain fallback') : 'the ropes show the river',
                       dark: 'the ropes are dark on purpose', 'not-reaching': 'the ropes are not getting the river', unknown: 'the ropes are not known',
                       calibrating: `the ropes are ${calWords}` }[ropesState];
  const ropesItem = items.find((x) => x.id === 'ropes');
  // The panels, the same way: a state word for the page and plain words, beside the item's summary.
  const riverWords = kind === 'live' ? (relay?.fresh ? 'the live river' : 'the rain fallback') : 'the river';
  const panelsState = !pr || online === false || led == null ? 'unknown' : ledMissing ? 'no-sender' : !td ? 'unknown'
    : tdRestarting || tdOffBooting ? 'restarting' : frozen ? 'frozen' : !tdOk ? 'gone' : !hub ? 'no-output'
    : calPanels ? 'calibrating' : hub.output === false || brightness === 0 ? 'off' : 'river';
  const panelsWords = { unknown: 'the panels are not known', 'no-sender': 'the panels have no sender: dark', restarting: 'the panels are dark while TouchDesigner restarts',
    frozen: 'the panels hold a frozen picture', gone: 'the panels show nothing: TouchDesigner is not running', 'no-output': 'this show file has no panel output',
    off: 'the panels are switched off', calibrating: `the panels are ${calWords}`, river: `the panels show ${riverWords}${brightness != null ? ` at ${Math.round(brightness * 100)} %` : ''}` }[panelsState];
  const manual = yearOk ? obj(year.manual) : null;
  const show = {
    file: tdOk ? { name: td.file, kind, label, words: `TouchDesigner is showing ${label}` } : null,
    boot_file: bootFile(pr),
    show_files: (Array.isArray(pr?.show_files) ? pr.show_files : []).filter((f) => OFFERED.includes(FILES[f]?.kind)),
    season: yearOk ? year.season : null, phase: yearOk ? num(year.phase) : null, weights: yearOk ? obj(year.weights) : null,
    intensity: intensity != null ? { value: intensity, word: intensityWord(intensity), words: `${intensityWord(intensity)} (${intensity.toFixed(2)})` } : null,
    mode: yearOk ? { id: year.mode, effective: year.effective_mode ?? year.mode, words: modeWords } : null,
    target: yearOk && year.mode === 'manual' ? { season: year.target ?? manual?.season ?? null, intensity: num(manual?.intensity) } : null,
    presence: presence ? { available: presence.available === true, now: num(presence.now), usual: num(presence.usual), relative: num(presence.relative),
      words: presence.available ? `${presence.now} people (usual ${presence.usual})` : 'people counter not available' } : null,
    ropes: { state: ropesState, words: ropesWords, summary: ropesItem?.summary ?? 'not known', source: rs?.source ?? ro?.source ?? null, open: senderKnown ? rs.open : null, watts, cap: capW, route: pr?.lights_route ?? null },
    panels: { present: led, brightness, output: hub ? hub.output !== false : null, state: panelsState, words: panelsWords,
              summary: items.find((x) => x.id === 'hub75 panels')?.summary ?? 'not known' },
    river: relay ? { live: relay.fresh === true, last_frame_age_s: relayAge, night: relay.night ?? null, words: relay.fresh ? 'live frames from the river' : `no live frames for ${dur(relayAgeNow)}: the rain fallback` }
                 : { live: null, last_frame_age_s: null, night: null, words: kind === 'year' ? "the river library (the live river isn't used)" : 'not known' },
    scene: m && obj(m.scene) ? { ...m.scene, set_at: m.set_at ?? null, words: `${m.scene.animation ?? '?'} / ${m.scene.palette ?? '?'}${m.set_at && Number.isFinite(Date.parse(m.set_at)) ? `, set ${clockDay(Date.parse(m.set_at), now)}` : ''}` } : null,
    modal: m ? { tick: m.tick ?? null, mood: m.mood ?? null, ok: m.ok !== false, resting: inRest(now), overdue_min: Math.round(lateMin), last_tick_ms: Number.isFinite(finMs) ? finMs : null, next_tick_ms: nextMs } : null,
    fresh: { seasons_age_s: se.age_s, probe_age_s: pb.age_s, stale: overall.stale },
    // the year's recent path (the seasons page keeps a point every 10 s): when each season began, for a timeline
    history: Array.isArray(y?.history) ? y.history.map(obj).filter((h) => h && num(h.t) != null)
      .map((h) => ({ t_ms: h.t * 1000, phase: num(h.phase), season: seasonOfPhase(num(h.phase)), intensity: num(h.intensity) })) : [],
    // a calibration run: its time left (on the server's clock), its stage, and whether it is a dry run that touches no lights
    // left_s is the one number every page shows (the band, the tiles, Lights' state line and its card); left_words says it
    calibration: calibrating ? { left_s: calLeftS, left_words: calLeftWords, stage: typeof cal.stage === 'string' ? cal.stage : null, dry: calDry, words: calStageWords } : null,
    uptime_s: upS != null ? Math.round(upS) : null,   // bitcube's uptime as of the server's clock (its restart = now - uptime)
    applying,   // [{ id, action, label, file, started_at (ms), expect_s, elapsed_s, blocks, phase, words }]: changes in flight, from any phone
    words: tdOk ? `${cap(tdWords)}${yearOk ? `: ${year.season}, ${intensityWord(intensity)}, ${modeWords}` : ''}. ${cap(ropesWords)}.` : (top?.headline ?? ''),
  };

  // ---- controls: possible now, or why not ------------------------------------------------------------------------
  const ctl = (why, extra = {}) => ({ possible: !why, why: why ?? null, ...extra });
  const cantPage = pageStale ? "this page can't reach mission control" : null;
  const cantBitcube = online === false ? 'bitcube is offline' : online == null ? "bitcube hasn't been checked yet" : bc.stale ? `mission control hasn't checked bitcube for ${dur(bc.age_s)}` : null;
  const cantTd = !pr ? (pb.present ? 'the full check of bitcube failed' : "bitcube's full check hasn't run yet") : tdOff ? "TouchDesigner isn't running" : tdRestarting ? 'TouchDesigner is restarting' : frozen ? "TouchDesigner isn't answering" : pb.stale ? `mission control hasn't heard from bitcube for ${dur(pb.age_s)}` : null;
  const cantYear = y ? (se.stale ? `mission control hasn't checked the river's year page for ${dur(se.age_s)}` : null)
    : kind === 'live' || kind === 'other' ? "the river's year isn't running: switch to it first" : frozen ? "TouchDesigner isn't answering" : tdOff ? "TouchDesigner isn't running" : tdRestarting ? 'TouchDesigner is restarting'
    : se.present ? "the river's year page isn't answering" : "the river's year page hasn't been checked yet";
  const cantUnknown = !pr ? (pb.present ? 'the full check of bitcube failed' : "bitcube's full check hasn't run yet") : null;   // what it would change isn't known
  const cantCal = calibrating ? 'a calibration is running: stop it on the Lights page first' : null;
  const cantOld = pr && pb.stale ? `mission control hasn't heard from bitcube for ${dur(pb.age_s)}` : null;
  // never a second switch while TouchDesigner is opening a file: it kills the half-opened one (another minute dark), and
  // while bitcube's own login is still opening it, a second TouchDesigner could start beside it
  const tdBusy = tdRestarting ? 'TouchDesigner is restarting: wait a minute' : tdOffBooting || (tdStarting && booted) ? 'TouchDesigner is still starting: wait a minute' : null;
  // first the page's contact and bitcube itself, then a change in flight anywhere (status.applying), then the model's own reasons
  const first = (action) => cantPage ?? cantBitcube ?? waitFor(action);
  const notYear = kind === 'year' ? null : kind ? "the river's year isn't running: switch to it first" : "what TouchDesigner is running isn't known";
  const controls = {
    mode: ctl(first('mode') ?? cantYear, { dynamic: ctl(first('mode') ?? cantYear ?? (counter ? null : "the people counter isn't available yet")) }),
    target: ctl(first('target') ?? cantYear),
    rules: ctl(first('rules') ?? cantYear),
    'rules-reset': ctl(first('rules-reset') ?? cantYear),
    ropes: ctl(first('ropes') ?? cantTd ?? cantCal),
    hub75: ctl(first('hub75') ?? cantTd ?? cantCal),   // the camera is photographing the panels and ropes
    // never while TouchDesigner is restarting (a second switch kills the half-opened file: another minute dark), and never on
    // a full check too old to say what runs now (the buttons' labels come from it)
    switch: ctl(first('switch') ?? cantUnknown ?? tdBusy ?? cantOld ?? cantCal),
    bootfile: ctl(first('bootfile') ?? cantUnknown),
    lightsroute: ctl(first('lightsroute') ?? cantUnknown ?? cantOld ?? cantCal),
    // a rebuild bakes the LED map into the river's year and ends in a switch: the switch's reasons, and only on the river's year
    rebuild: ctl(first('rebuild') ?? cantUnknown ?? tdBusy ?? cantOld ?? cantCal ?? (frozen ? "TouchDesigner isn't answering" : null) ?? notYear),
    // a calibration's start: TouchDesigner answering on a show file, the gallery camera reachable, nothing running already
    calibrate: ctl(first('calibrate') ?? (calibrating ? 'a calibration is already running' : null) ?? cantTd ?? (tdOk ? null : "TouchDesigner isn't answering")
      ?? (galleryDown ? "the gallery camera isn't reachable" : null)),
  };

  const sources = {};
  for (const k of Object.keys(S)) sources[k] = { present: S[k].present, ok: S[k].ok, error: S[k].error, age_s: S[k].age_s, failing_s: S[k].failing_s, stale: S[k].stale };
  return { overall, problems: P.map(({ pri, fromProbe: _f, ...p }) => p), show, items, controls, sources };
}

// ---- one control's state (docs/mission-ui.md "Applying a change") -----------------------------------------------------
// The pure rules ui.js control() follows (and status.js can): ready, blocked, confirm, applying, confirming, done,
// unconfirmed, failed. Nothing on screen claims a change until bitcube's reading shows it.
export const CTL_STATES = ['ready', 'blocked', 'confirm', 'applying', 'confirming', 'done', 'unconfirmed', 'failed'];
const BUSY = new Set(['confirm', 'applying', 'confirming']);
/** A control before anything was pressed: ready, or blocked with the model's why. */
export function ctlInit(why = null) { return { state: why ? 'blocked' : 'ready', sentAt: null, answeredAt: null, at: null, before: null, effect: null, notSent: null, seen: false }; }
/** A done line stands this long without a reading that shows it; once one has, the first that differs takes it away. */
export const DONE_HOLD_S = 60;
/** One event on one control → its next state (a new object; `effect` says what the page must do now: 'confirm' open the sheet,
 *  'send' POST, 'withdraw' close the sheet, else null). Every event carries `now` (ms).
 *    press { why, confirm }  ready/done/failed/unconfirmed → confirm (asks first) or applying (send); blocked or busy: nothing
 *    yes { why }             confirm → applying (send), or failed "Not sent: <why>" when it became impossible meanwhile
 *    no { why }              confirm → what it was before (ready ↔ blocked by the why now)
 *    why { why }             the model's reason changed: ready ↔ blocked; an open confirm is withdrawn (failed, notSent)
 *    ok { confirmed }        applying → done, or confirming when confirmed === false (the reading doesn't show it yet)
 *    error { maybe }         applying → failed, or unconfirmed when it may have happened (no answer, an unreadable one)
 *    model { confirmed }     confirming or unconfirmed → done when bitcube's reading shows it (a phone that slept through
 *                            confirming, or a request whose answer was lost, still ends done when the change shows: R6 #0)
 *    tick { expectS, readAt } confirming → unconfirmed after max(3 × expectS, 120) s since it was sent, but only once a reading
 *                            taken after that limit has been judged (readAt: the wall time of the newest reading judged; null:
 *                            none yet, so a phone waking from sleep, or out of contact, never turns it unconfirmed by its clock
 *                            alone; undefined: a caller that tracks no readings goes by the clock)
 *    reading { holds, why }  done → its line gives way (state ready or blocked, effect 'drop') when a newer reading no longer
 *                            shows what it claims, once one has shown it (seen) or DONE_HOLD_S after it (R6 #30) */
export function ctlStep(s, ev) {
  s = s ?? ctlInit();
  const now = ev?.now ?? null, why = ev?.why ?? null;
  const to = (state, extra = {}) => ({ ...s, state, effect: null, at: now, ...extra });
  const rest = (st) => (st === 'ready' || st === 'blocked' || st == null ? (why ? 'blocked' : 'ready') : st);
  const same = { ...s, effect: null };
  switch (ev?.type) {
    case 'press':
      if (BUSY.has(s.state) || why) return s.state === 'ready' && why ? to('blocked') : same;
      return ev.confirm ? { ...to('confirm', { before: s.state }), effect: 'confirm' } : { ...to('applying', { sentAt: now, answeredAt: null, notSent: null }), effect: 'send' };
    case 'yes':
      if (s.state !== 'confirm') return same;
      return why ? to('failed', { notSent: why }) : { ...to('applying', { sentAt: now, answeredAt: null, notSent: null }), effect: 'send' };
    case 'no': return s.state === 'confirm' ? to(rest(s.before)) : same;
    case 'why':
      if (s.state === 'confirm' && why) return { ...to('failed', { notSent: why }), effect: 'withdraw' };
      if (s.state === 'ready' && why) return to('blocked');
      if (s.state === 'blocked' && !why) return to('ready');
      return same;
    case 'ok': return s.state !== 'applying' ? same : ev.confirmed === false ? to('confirming', { answeredAt: now }) : to('done', { answeredAt: now });
    case 'error': return s.state !== 'applying' ? same : to(ev.maybe ? 'unconfirmed' : 'failed', { answeredAt: now });
    case 'model': return (s.state === 'confirming' || s.state === 'unconfirmed') && ev.confirmed === true ? to('done', { seen: true }) : same;
    case 'tick': {
      if (s.state !== 'confirming' || now == null) return same;
      const limitMs = confirmLimitS(ev.expectS) * 1000, sent = s.sentAt ?? now;
      if (now - sent <= limitMs) return same;
      if (ev.readAt !== undefined && !(num(ev.readAt) != null && ev.readAt - sent > limitMs)) return same;
      return to('unconfirmed');
    }
    case 'reading': {
      if (s.state !== 'done' || typeof ev.holds !== 'boolean') return same;
      if (ev.holds) return s.seen ? same : { ...s, seen: true, effect: null };
      return s.seen || (now != null && s.at != null && now - s.at > DONE_HOLD_S * 1000) ? { ...to(why ? 'blocked' : 'ready', { seen: false }), effect: 'drop' } : same;
    }
    default: return same;
  }
}
/** What a control in state s shows with the model's why now: the contract's state name, whether the button is disabled,
 *  whether its inputs are locked (applying, confirming, or blocked), and busy (a request in flight or awaiting the reading). */
export function ctlView(s, why = null) {
  const st = s?.state ?? 'ready';
  const busy = st === 'applying' || st === 'confirming';
  return { state: st === 'ready' || st === 'blocked' ? (why ? 'blocked' : 'ready') : st, busy, disabled: busy || !!why, lockInputs: busy || !!why };
}
/** Elapsed seconds as m:ss ("0:34", "12:05"). */
export function elapsedClock(s) { s = Math.max(0, Math.floor(num(s) ?? 0)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; }
// ---- the words of a change in flight: one set for every page (status.js, ui.js control(), Lights, the chat) -----------------
const NB = '\u00a0';                                // a number keeps its unit on one line ("1 min", never "1" / "min")
/** The usual time in words: "usually a few seconds" (up to 20 s, or not known), "usually about 45 s", "usually about 1 min",
 *  "usually about 2.5 min" (half minutes: a rebuild's 150 s is 2.5 min, never 3). */
export function usualWords(expectS) {
  const x = num(expectS);
  if (x == null || x <= LONG_CHANGE_S) return 'usually a few seconds';
  if (x < 55) return `usually about ${Math.round(x)}${NB}s`;
  const min = Math.round(x / 30) / 2;
  return `usually about ${Number.isInteger(min) ? min : min.toFixed(1)}${NB}min`;
}
/** "Applying: <what>…", the applying line before any time is added (and, without the "…", what the live region says). */
export function applyingText(what) { return `Applying: ${what}…`; }
/** The applying line: a long change (usually over 20 s) adds its elapsed m:ss and the usual time from the start; a short one
 *  once it runs past its usual time (10 s when it has none), so a request that hangs never looks like a live spinner for a
 *  minute: "Applying: ropes dark · 0:16 · usually a few seconds" (R6 #1). */
export function applyingWords(text, elapsedS, expectS) {
  const usual = num(expectS) ?? SHORT_CHANGE_S, long = usual > LONG_CHANGE_S;
  // the line goes on after its words, so their "…" goes: "Applying: the switch · 0:34 · usually about 1 min"
  return long || (num(elapsedS) ?? 0) > usual ? `${String(text).replace(/…$/, '')} · ${elapsedClock(elapsedS)} · ${usualWords(expectS)}` : text;
}
/** The confirming line: sent, waiting for bitcube's reading to show it, the time since it was sent and the usual time (seconds,
 *  or words of its own: the boot file's BOOT_USUAL). */
export function confirmingWords(elapsedS, usual = null) {
  const u = typeof usual === 'string' ? usual : num(usual) != null ? usualWords(usual) : '';
  return `Sent · waiting for bitcube to show it · ${elapsedClock(elapsedS)}${u ? ` · ${u}` : ''}`;
}
/** What the page's live region says once on entering confirming (never with a time). */
export const CONFIRMING_SAID = 'Sent; waiting for bitcube to show it';
/** Another phone's change in flight (a show.applying entry), for the band: "Applying: the switch to the live river · 0:23 · usually
 *  about 1 min", then, once its request answered (phase 'confirming'), "Waiting for bitcube to show the switch to the live river · …". */
export function entryWords(a, elapsedS) {
  const head = a?.phase === 'confirming' ? `Waiting for bitcube to show ${a?.label ?? 'a change'}` : `Applying: ${a?.label ?? 'a change'}`;
  return `${head} · ${elapsedClock(elapsedS)} · ${usualWords(a?.expect_s)}`;
}
/** A change no reading showed in time, naming what was sent: "The switch to the live river was sent at 21:13, but bitcube doesn't
 *  show it yet: look at the Now line, or call Gavin." (what: the change in team words, or null for "Sent at 21:13, …"). */
export function unconfirmedWords(what, at, where = 'look at the Now line, or call Gavin') {
  return `${what ? `${cap(String(what))} was sent at ${at}` : `Sent at ${at}`}, but bitcube doesn't show it yet: ${where}.`;
}
/** A press judged again and found impossible, or a confirm withdrawn: "Not sent at 21:04: bitcube is offline." Another change in
 *  flight is said in the past tense, so the line stays true after it ends: "Not sent at 21:17: the restart on the river's year
 *  was being applied. Press again when it is done." (R6 #4, #16) */
export function notSentWords(why, at) {
  const w = String(why ?? "this page can't reach mission control").replace(/[.\s]+$/, '');
  if (/^wait: /i.test(w)) return `Not sent at ${at}: ${w.slice(6).replace(/ is being applied\b.*$/, ' was being applied')}. Press again when it is done.`;
  return `Not sent at ${at}: ${w}.`;
}
/** A refused or failed change on its control, from the reason in words (app.js plainError): "<fail>: <reason> (21:04). Try again,
 *  or see the verdict above." Another change in flight reads as the server wrote it ("… is being applied (started 21:04). Try
 *  again when it is done."); a calibration running says to stop it or wait (R6 #14). kept: a form's "What you typed is kept.";
 *  tail: the last words, where the page that has no verdict points ("Try again, or check Status."). */
export function failWords(fail, why, at, { kept = '', tail = 'Try again, or see the verdict above.' } = {}) {
  const w = String(why ?? '').replace(/[.\s]+$/, ''), k = kept ? ` ${kept}` : '';
  if (/^wait: /i.test(w)) return `${fail}: ${w.slice(6)}.${k} Try again when it is done.`;
  if (/^a calibration is running\b/i.test(w)) return `${fail}: a calibration is running (${at}).${k} Stop it on the Lights page, or try again when it ends.`;
  return `${fail}: ${w} (${at}).${k}${/try again|apply again/i.test(w) ? '' : ` ${tail}`}`;
}
