// The Status page's words and form rules, pure (no DOM), so node's tests check them (test/status.test.mjs): the forms
// (Rules, Target), what a control's status line says in each state, the show-file switch's words (it also sets the boot
// file: probe.ps1 writes boot-file.txt for a switch), the tiles' state words, the band's line for a change in flight from
// another phone, and when the room's still is due again. status.js lays them out. Relative imports: in the browser these are
// the same /model.js and /app.js every page loads.
import { seasonPace, FILES, applyingWords, confirmingWords, entryWords, failWords, notSentWords, LONG_CHANGE_S } from './model.js';
import { plainError } from './app.js';

const cap = (s) => (s && !/^bitcube/.test(s) ? s[0].toUpperCase() + s.slice(1) : s ?? '');
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** A number as the box shows it: no trailing zeros, no thousands separator ("1800", "1.05", "0.7"). */
export const numText = (x) => (num(x) == null ? '' : String(Math.round(x * 1000) / 1000));
const fileLabel = (f) => FILES[f]?.label ?? 'a show file';

// ---- Rules -----------------------------------------------------------------------------------------------------------
/** A rule's label in plain words: "Length of the year (automatic)" → "Length of the year, in Automatic"; "Usual presence =
 *  median of the last" → "Usual presence is the middle value over the last"; never two parentheses or maths. */
export function ruleLabel(l) {
  return String(l ?? '').replace(/\s*\((automatic|dynamic|manual)\)/i, (_m, mode) => `, in ${cap(mode.toLowerCase())}`)
    .replace(/\s*=\s*median of the last/i, ' is the middle value over the last').replace(/median of the last/i, 'the middle value over the last')
    .replace(/\s*\(([^()]*)\)\s*$/, ', $1');
}
/** The unit beside the box, as the box holds it: "s", "× usual". */
export const ruleUnit = (r) => String(r?.unit ?? '').trim();
/** The range in the box's own unit: "60 to 1800 s", "1.05 to 3 × usual" (never minutes beside a box of seconds). */
export function ruleRange(r) {
  const u = ruleUnit(r);
  return `${numText(Number(r?.min))} to ${numText(Number(r?.max))}${u ? ` ${u}` : ''}`;
}
/** Why a typed value can't be applied, under its box, or null: "Must be 60 to 1800 s". */
export function ruleError(r, raw) {
  const t = String(raw ?? '').trim();
  const x = t === '' ? NaN : Number(t);
  if (!Number.isFinite(x) || x < Number(r?.min) || x > Number(r?.max)) return `Must be ${ruleRange(r)}`;
  return null;
}
/** The Rules form from the server's rules and what was typed (draft: key → the box's text, kept across re-renders, a failed
 *  Apply and another phone's change). Per box: what it shows, whether it changed, its error, and "now 240 s on bitcube" when
 *  what is typed differs from bitcube's value. Apply is possible only when something changed and every box is valid, and
 *  says how many ("Apply 2 changes"). */
export function rulesForm(rules, draft = {}) {
  const fields = {}, changed = {};
  const R = rules && typeof rules === 'object' ? rules : {};
  for (const [k, r] of Object.entries(R)) {
    const server = num(r?.value);
    const typed = Object.prototype.hasOwnProperty.call(draft, k) ? String(draft[k]) : null;
    const shown = typed ?? numText(server);
    const error = typed == null ? null : ruleError(r, typed);
    const value = typed != null && !error ? Number(typed) : server;
    const isChange = typed != null && (error != null || value !== server);
    fields[k] = { label: ruleLabel(r?.label), unit: ruleUnit(r), range: ruleRange(r), shown, server, value, error, changed: isChange,
      now: isChange && server != null ? `now ${numText(server)}${ruleUnit(r) ? ` ${ruleUnit(r)}` : ''} on bitcube` : null };
    if (isChange && !error) changed[k] = value;
  }
  const count = Object.values(fields).filter((f) => f.changed).length;
  const bad = Object.values(fields).filter((f) => f.error).length, invalid = bad > 0;
  // while a box is out of range the greyed button says what to do, never a count it won't apply (R6 #24)
  return { fields, changed, count, invalid, canApply: count > 0 && !invalid, label: invalid ? `Fix the ${bad === 1 ? 'box' : 'boxes'} first` : count ? `Apply ${plural(count, 'change')}` : 'Apply' };
}

// ---- Target (manual) -------------------------------------------------------------------------------------------------
/** The Target form: the season and intensity shown (the draft, else bitcube's), how many differ from bitcube's target, and
 *  "now winter on bitcube" under a part whose draft differs from bitcube's. */
export function targetForm(server, draft = {}, fallbackIntensity = 0.5) {
  const sSeason = server?.season ?? null, sInt = num(server?.intensity);
  const season = draft.season ?? sSeason;
  const intensity = num(draft.intensity) ?? sInt ?? num(fallbackIntensity) ?? 0.5;
  const seasonChanged = draft.season != null && draft.season !== sSeason;
  const intChanged = num(draft.intensity) != null && (sInt == null || Math.abs(draft.intensity - sInt) > 1e-9);
  const count = (seasonChanged ? 1 : 0) + (intChanged ? 1 : 0);
  return { season, intensity, count, canApply: count > 0 && !!season, label: count ? `Apply ${plural(count, 'change')}` : 'Apply',
    nowSeason: seasonChanged && sSeason ? `now ${sSeason} on bitcube` : null,
    nowIntensity: intChanged && sInt != null ? `now ${sInt.toFixed(1)} on bitcube` : null };
}

/** The mode control's line of effect, Automatic's pace from the year-length rule (the rule as bitcube has it, not a draft). */
export function modeEffect(rules) {
  const pace = seasonPace(num(rules?.cycle_seconds?.value));
  return `Automatic turns the year by itself${pace ? `, ${pace}` : ''}. Dynamic lets the people in the room steer it. Manual takes over by hand: the river travels forward to your target.`;
}

// ---- the show file: a switch also sets the boot file (probe.ps1 writes boot-file.txt for 'switch') -----------------------
/** Everything the show-file switch says, for a press on `file` while `running` runs and `boot` (model show.boot_file) opens at
 *  boot: the button's own verb, the confirm, the applying words and the result. It says the boot file changes only when it
 *  does (the boot file is another file, or not known). */
export function switchWords(file, running, boot) {
  const label = fileLabel(file), restart = file === running;
  const verb = restart ? 'Restart on' : 'Switch to';
  const setsBoot = boot?.name !== file;
  return {
    verb, setsBoot,
    title: `${verb} ${label} now?`,
    body: `Restarts TouchDesigner on ${label}: the lights go dark for about a minute, and unsaved changes in TouchDesigner are lost.${setsBoot ? ` ${cap(label)} also opens at boot from now on (the boot file changes too).` : ''}`,
    ok: `${verb} ${label}`,
    what: restart ? `the restart on ${label}` : `the switch to ${label}`,
    done: `Now showing ${label}${setsBoot ? '; it also opens at boot from now on' : ''}`,
  };
}
/** bitcube's reading shows the switch: TouchDesigner answers, on the chosen file. */
export const switchShows = (m, file) => !!m?.show?.file && m.show.file.name === file;
/** bitcube's reading shows the boot file change. */
export const bootShows = (m, file) => m?.show?.boot_file?.name === file;
/** "opens at boot: the river's year (by default)". */
export function bootWords(boot) { return boot ? `${boot.label}${boot.default ? ' (by default)' : ''}` : 'not known'; }

// ---- a control's status line, in each of the contract's states ---------------------------------------------------------
/** What a control's status line says now: c = { s: ctlStep's state, text, applyText, expectS, usual }. Applying: the words, and
 *  for a long change (or a short one past its usual time) the elapsed m:ss and the usual time; confirming: "Sent · waiting for
 *  bitcube to show it · 0:34 · usually about 1 min" (usual: words of its own, the boot file's); done, failed, unconfirmed: their
 *  text. The words are model.js's, the same on every page. Ticking times are never announced. */
export function controlLine(c, nowMs) {
  const st = c?.s?.state ?? 'ready', el = c?.s?.sentAt != null ? Math.max(0, (nowMs - c.s.sentAt) / 1000) : 0;
  if (st === 'applying') {
    // a long change's time follows its words: "Applying: the switch to the live river · 0:23 · usually about 1 min" (no "…" before it)
    const t = c.applyText ?? 'Sending to bitcube…', long = num(c.expectS) != null && c.expectS > LONG_CHANGE_S;
    return { cls: 'pending applying', spin: true, text: applyingWords(long ? t.replace(/…$/, '') : t, el, c.expectS) };
  }
  if (st === 'confirming') return { cls: 'pending confirming', spin: true, text: confirmingWords(el, c.usual ?? c.expectS ?? null) };
  if (['done', 'failed', 'unconfirmed'].includes(st)) return { cls: st, spin: false, text: c.text ?? '' };
  return { cls: '', spin: false, text: c?.text ?? '' };
}
/** A refused or failed change on its control: "<fail>: <reason> (21:04). Try again, or see the verdict above." A 409 from
 *  another change in flight reads as the server wrote it, without its "wait:" ("…: the switch to the live river is being
 *  applied (started 21:04). Try again when it is done."); a calibration running says to stop it or wait. `kept`: a form's
 *  "What you typed is kept." after the reason. model.js failWords, the same words as Lights'. */
export function failText(fail, e, clock, kept = '') { return failWords(fail, plainError(e), clock, { kept }); }

/** A press judged again and found impossible, or a confirm withdrawn: "Not sent at 21:04: bitcube is offline."; another change in
 *  flight in the past tense, so it stays true after it ends: "Not sent at 21:17: the restart on the river's year was being
 *  applied. Press again when it is done." (model.js notSentWords). */
export const notSentText = (why, clock) => notSentWords(why, clock);

// ---- Last done: from the server's history, and its verdict on that change ------------------------------------------------
/** The band's "Last done" line's head and tail for the last action (status.last_action) and the status it came with: "Last sent"
 *  and "waiting for bitcube to show it" while the server is still confirming its entry (status.applying, by applying_id), "didn't
 *  show it in time" when it gave up (status.expired), "Last done" once confirmed or when it is no longer listed; a failure is
 *  "Last tried", a quick change bitcube didn't answer in time (no lock) "may or may not have happened". Never "done" for a change
 *  the server is still confirming (R7 #3, #16, #28). */
export function lastDoneParts(a, st) {
  const id = typeof a?.applying_id === 'string' ? a.applying_id : null;
  const has = (list) => !!id && Array.isArray(list) && list.some((e) => e && e.id === id);
  if (has(st?.applying)) {
    return a.maybe === true ? { head: 'Last sent', tail: ' · no answer in time; waiting for bitcube to show whether it happened' }
      : { head: 'Last sent', tail: ' · waiting for bitcube to show it' };
  }
  if (has(st?.expired)) return { head: 'Last sent', tail: " · bitcube didn't show it in time" };
  if (has(st?.confirmed)) return { head: 'Last done', tail: '' };
  if (a?.maybe === true) return { head: 'Last sent', tail: ' · no answer in time: it may or may not have happened' };
  if (a?.ok === false) return { head: 'Last tried', tail: a.note ? ` · failed: ${plainError(a.note)}` : '' };
  return { head: 'Last done', tail: '' };
}

// ---- another phone's change in flight, on the band ---------------------------------------------------------------------
/** "Applying: the switch to the live river · 0:23 · usually about 1 min", then "Waiting for bitcube to show the switch to the
 *  live river · …" once its request answered (model show.applying entry, seconds since it began; model.js entryWords). */
export const applyingLine = (a, elapsedS) => entryWords(a, elapsedS);

// ---- the tiles ---------------------------------------------------------------------------------------------------------
export const ROPES_STATE = { river: 'Showing the river', dark: 'Dark on purpose', 'not-reaching': 'Not getting the river', calibrating: 'In calibration patterns', unknown: 'Not known' };
export const PANELS_STATE = { unknown: 'Not known', 'no-sender': 'No panel sender', restarting: 'Dark while restarting', frozen: 'Picture frozen',
  gone: 'Nothing drawn', 'no-output': 'No panel output', off: 'Switched off', calibrating: 'In calibration patterns', river: 'Showing the river' };
/** A calibration's second line: "about 4 min more · stop it on the Lights page" ("nearly done" in its last 45 s): the model's one
 *  time left, the same as the band's and Lights'. */
const calLine = (m) => `${m?.show?.calibration?.left_words ?? 'time left not known'} · stop it on the Lights page`;
/** The second line never repeats the state word: a summary that starts with it keeps only what it adds. */
function adds(state, summary) {
  const s = String(summary ?? ''), w = String(state ?? '').toLowerCase();
  if (w && s.toLowerCase().startsWith(w)) { const rest = s.slice(w.length).replace(/^[\s:;,.]+/, ''); return rest ? cap(rest) : ''; }
  return s;
}
/** The Ropes tile: a state word and a second line that adds something. x: the ropes item; bothDown: neither box answers. */
export function ropesTile(m, x, bothDown) {
  const r = m.show.ropes, live = m.show.file?.kind === 'live';
  const state = r.state === 'not-reaching' && bothDown ? 'Not connected'
    : r.state === 'river' && live ? cap(r.words.replace(/^the ropes show /, 'showing ')) : ROPES_STATE[r.state] ?? 'Not known';
  // the power is a measurement: it stays in the row's Power line (copy rules: a number in a summary only when it is the reason)
  const words = r.state === 'calibrating' ? calLine(m)
    : r.state === 'dark' ? 'Someone pressed Dark; nothing is broken'
    : r.state === 'river' && x.level === 'ok' ? (live && !m.show.river.live ? 'No live frames; sender open' : 'Sender open')
    : adds(state, x.summary);
  return { state, words };
}
const PANEL_WORDS = { 'no-sender': "bitcube doesn't see it on its HDMI", frozen: "TouchDesigner isn't answering", gone: "TouchDesigner isn't running",
  restarting: 'Back in about a minute', 'no-output': 'This show file draws none' };
/** The Panels tile, the same way. */
export function panelsTile(m, x) {
  const pn = m.show.panels;
  const state = pn.state === 'river' ? cap(pn.words.replace(/^the panels show /, 'showing ')) : PANELS_STATE[pn.state] ?? 'Not known';
  const words = pn.state === 'calibrating' ? calLine(m)
    : pn.state === 'river' && x.level === 'ok' ? 'Panel sender connected'
    : pn.state === 'off' ? (pn.output === false ? 'Output off in the show file' : 'Brightness 0 %')
    : PANEL_WORDS[pn.state] ?? adds(state, x.summary);
  return { state, words };
}

// ---- the room's still ------------------------------------------------------------------------------------------------
/** Is the room's still due when an answer arrives? When the last try failed for want of a network (a phone waking with none:
 *  its wake-up try failed), or the last try is older than the interval. A camera that answered "no picture" is not retried
 *  sooner than the interval. */
export function stillDue({ now, tried, netFailed }, intervalMs) {
  return !!netFailed || now - (tried ?? 0) > intervalMs;
}

/** The row a link to /status#r-<id> names (the map's sheets link there), or null. */
export function rowFromHash(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  let id; try { id = decodeURIComponent(h); } catch { return null; }
  return /^r-[a-z0-9-]+$/i.test(id) ? id : null;
}
