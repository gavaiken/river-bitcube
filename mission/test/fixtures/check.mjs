#!/usr/bin/env node
// Validates every fixture in this folder:  node check.mjs [name ...]
//   1. the file parses and has the fixture format (_scenario, status, cameras, camera_age_s);
//   2. _scenario.expect is complete (headline, severity, items, action);
//   3. the payload is internally consistent (age_s matches at, errors have no value, nothing is known behind an
//      offline bitcube, the online file has no seasons, the seasons file has no river-cam relay, ...);
//   4. the current pages' reading code accepts it: rows() from mission/public/status.html, the "Now" block of
//      mission.html and toMap() from map-live.js are copied below verbatim (worktree ui-v2, 23 Oct 2026) with the
//      DOM stubbed, so a payload that would throw in the browser throws here.
// Exit code 1 if anything fails. The last column prints what today's status page would say, for comparison.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const NOW = 1792749540000;                       // the moment every fixture is "taken" (build.mjs)
const SEVERITIES = ['ok', 'warning', 'down', 'unknown'];
const MODES = ['automatic', 'dynamic', 'manual'];
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const SEASONS_FILE = 'river-local-oct-22-seasons.toe', ONLINE_FILE = 'river-online-oct-23.toe';
// probe.ps1 offers only the first two; a bitcube that hasn't pulled the old-… rename (execution plan D27), like the
// 23 Oct recording behind lights-not-connected, still lists the 20 Oct file under its earlier name.
const SHOW_FILES = [SEASONS_FILE, ONLINE_FILE, 'river-online-oct-20.toe', 'river-baseline-template.toe', 'river-fixture-fireflies.toe'];   // + viz-running's template and test viz (_shows.json)
const DEVICES = ['internet', 'router', 'gallery_cam', 'river_cam', 'psac10_1', 'psac10_2', 'seasons_page'];
const SENDER_KEYS = ['error', 'sent', 'dropped', 'packets', 'watts', 'seq', 'active', 'open', 'source', 'retrying'];
const RELAY_KEYS = ['relay', 'frames', 'last_frame_age_s', 'fresh', 'error', 'colourfulness', 'night', 'nightness'];
const YEAR_KEYS = ['mode', 'effective_mode', 'phase', 'season', 'weights', 'intensity', 'target', 'manual', 'presence'];
const STATE_KEYS = [...YEAR_KEYS, 'counter_available', 'rules', 'history', 'file'];
const MODAL_KEYS = ['tick', 'mood', 'ok', 'finished_at', 'next_tick_epoch', 'scene', 'set_at'];

// ---- mission/public/status.html: rows() and the summary/season/modal parts of render(), DOM stubbed -------------
const esc = (s) => String(s);
const link = (href, label) => `${label} <${href}>`;
const ago = (s) => `${s} s ago`;
const PAGES = 'https://gavaiken.github.io/river-bitcube/';
const kv = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${esc(k)}=${esc(v)}`).join(' ');
const dot = (ok) => (ok === true ? '[ok]' : ok === false ? '[bad]' : '[warn]');
function rows(s) {
  const bc = s.bitcube?.value?.online, pr = s.probe?.value, td = pr?.td, dv = pr?.devices ?? {};
  const known = !!pr;           // the probe answered: device checks are real
  const chk = (v) => (known ? !!v : undefined);
  const addr = (pr?.addresses ?? []).map((a) => `${a.nic} ${a.ip}`).join(' · ');
  const led = (pr?.displays ?? []).some((d) => /^LED/i.test(d));
  const y = s.seasons?.value, md = s.modal?.value, link_ = pr?.modal_link;
  return [
    ['Mission control (Mac mini)', true, 'gav-m1-mini · 100.126.113.14', link('https://gav-m1-mini.tailddc624.ts.net', 'this site'), 'serving this page'],
    ['bitcube (show PC)', bc === undefined ? undefined : bc && known, addr || '100.73.68.60 (Tailscale)',
      link('vnc://bitcube.tail03bc1a.ts.net', 'VNC'), bc === false ? 'not reachable' : !known ? (s.probe?.error || 'checking…') : `up ${pr.uptime_h} h · ${pr.disk_free_gb} GB free`],
    ['TouchDesigner', td ? td.ok !== false && !!td.file : chk(false), '', '',
      td?.file ? `${td.file}${td.fps ? ` · ${td.fps} fps` : ''}${td.errors ? ` · ${td.errors} errors` : ''}` : (td?.error || '')],
    ['Seasons control page', y ? true : chk(dv.seasons_page), 'bitcube :9981', link('http://bitcube.tail03bc1a.ts.net:9981', 'open'),
      y ? `${y.season} · ${y.mode}` : (s.seasons?.error ? 'not running (seasons file not deployed yet?)' : '')],
    ['Internet at Gray Area', chk(dv.internet), '', '', known ? (dv.internet ? 'bitcube reaches the internet' : 'no internet from bitcube') : ''],
    ['Install router (GL.iNet)', chk(dv.router), '192.168.9.1 · Wi-Fi gray-river', link('http://192.168.9.1', 'admin'), ''],
    ['Gallery camera', chk(dv.gallery_cam), '192.168.9.76', '', ''],
    ['Rope box 1 (ropes 1–10)', chk(dv.psac10_1), '2.0.0.10', '', td?.ropes ? `${td.ropes.source === 'black' ? 'dark' : 'showing the river'}` : ''],
    ['Rope box 2 (ropes 11–20)', chk(dv.psac10_2), '2.0.0.11', '', td?.ropes?.status?.watts ? `${td.ropes.status.watts.join(' + ')} W (cap ${td.ropes.box_watts_cap} W/box)` : ''],
    ['HUB75 panels (sender)', known ? led : undefined, 'HDMI from bitcube', '', known ? (led ? `LED display connected${td?.hub75 ? ` · brightness ${td.hub75.brightness}` : ''}` : 'no LED display on bitcube') : ''],
    ['River camera', chk(dv.river_cam), '192.168.8.217 · Starlink', '', known && !dv.river_cam ? 'river site down (solar / Starlink)' : ''],
    ["Dave's agent (Modal)", md ? md.ok : s.modal?.error ? false : undefined, 'to-be-a-river--river.modal.run', link('https://to-be-a-river--river.modal.run/', 'journal'),
      md ? `tick ${md.tick} · ${md.mood}` : (s.modal?.error || '')],
    ['Cameras → Modal link', link_ ? link_.processes > 0 : undefined, 'on bitcube', '', link_ ? (link_.gallery?.last || '').replace(/^\S+\s+INFO\s+/, '') : ''],
    ['River recorder', pr?.recorder ? true : undefined, 'on bitcube', '', pr?.recorder ? `${pr.recorder.clips} clips` : ''],
    ['Project site', true, 'GitHub Pages', link(PAGES, 'status') + link(PAGES + 'show-files.html', 'show files') + link(PAGES + 'execution-plan.html', 'plan') + link(PAGES + 'install.html', 'install guide'), ''],
  ];
}
function statusRender(s) {
  const r = rows(s), out = {};
  out.rows = r.map(([name, ok, addr, links, detail]) => `${dot(ok)} ${esc(name)} | ${esc(addr)} | ${links} | ${esc(detail)}`);
  const bad = r.filter((x) => x[1] === false).map((x) => x[0]), unknown = r.filter((x) => x[1] === undefined).length;
  out.sum = bad.length ? `${dot(false)}${bad.length} need${bad.length === 1 ? 's' : ''} attention` : unknown ? `${dot()}checking…` : `${dot(true)}everything is up`;
  out.sumsub = bad.join(' · ') + (s.probe ? ` · bitcube checked ${ago(s.probe.age_s)}` : '');
  const y = s.seasons?.value;
  if (y) {
    out.season = y.season[0].toUpperCase() + y.season.slice(1);
    out.seasonsub = `${y.mode}${y.effective_mode !== y.mode ? ` (running ${y.effective_mode})` : ''}` + (y.target ? ` · heading for ${y.target}` : '');
    out.ibar = y.intensity;
    const p = y.presence || {};
    out.preskv = kv(p.available ? { 'people now': p.now, usual: p.usual, relative: `${p.relative}×` } : { presence: 'people counter not running yet' });
  } else { out.season = '–'; out.seasonsub = 'the seasons file isn’t running yet'; }
  const md = s.modal?.value;
  out.modal = dot(md?.ok) + (md?.scene ? esc(`${md.scene.animation} / ${md.scene.palette}`) : (s.modal?.error ? 'unreachable' : '–'));
  out.modalkv = kv({ mood: md?.mood, tick: md?.tick, 'scene set': md?.set_at?.replace('T', ' ').slice(0, 16) })
    + (md?.scene?.colors ? ` palette=${md.scene.colors.map((c) => esc(c)).join(',')}` : '');
  return out;
}
// ---- mission/public/mission.html: the data parts of render() and drawShowFiles() ------------------------------
function missionRender(s) {
  const pr = s.probe?.value, td = pr?.td, y = s.seasons?.value, out = {};
  if (y) {
    out.modes = MODES.map((m) => ({ m, on: m === y.mode, disabled: m === 'dynamic' ? !y.counter_available : false }));
    out.modenote = !y.counter_available ? 'dynamic needs the people counter' : (y.mode === 'dynamic' ? 'people are steering it' : '');
    out.targets = SEASONS.map((sn) => y.mode === 'manual' && sn === y.manual?.season);
    if (y.manual) { out.tint = y.manual.intensity; out.tival = (+y.manual.intensity).toFixed(2); }
    if (y.rules) out.rules = Object.entries(y.rules).map(([k, r]) => `${esc(r.label)} (${r.min}–${r.max} ${esc(r.unit)}) ${esc(k)}=${r.value}`);
  }
  out.now = kv({
    'show file': td?.file || (s.bitcube?.value?.online === false ? 'bitcube offline' : '–'),
    'season': y ? `${y.season} · ${y.mode}${y.target ? ` → ${y.target}` : ''} · intensity ${y.intensity.toFixed(2)}` : 'seasons file not running yet',
    'ropes': td?.ropes ? (td.ropes.source === 'black' ? 'dark (sending black)' : 'showing the river') : undefined,
    'HUB75 brightness': td?.hub75?.brightness, 'opens at boot': pr?.boot_file,
    'checked': s.probe ? ago(s.probe.age_s) : undefined });
  if (!y) out.modenote = 'the seasons file isn’t running on bitcube yet (step S1)';
  if (td?.hub75) { out.hub = td.hub75.brightness; }
  out.ropesnote = td?.ropes ? (td.ropes.source === 'black' ? 'dark now' : 'showing the river') : '';
  const files = pr?.show_files ?? [], running = pr?.td?.file, boot = pr?.boot_file;
  out.showfiles = files.map((f) => `${esc(f)}${running === f ? ' running' : ''}${boot === f ? ' boot' : ''}`);
  if (pr?.lights_route) out.lrnote = `now: ${pr.lights_route}`;
  return out;
}
// ---- mission/public/map-live.js: toMap() ---------------------------------------------------------------------
function toMap(s) {
  const pr = s.probe && s.probe.value, dv = (pr && pr.devices) || {}, known = !!pr;
  const k = (v) => (known ? !!v : undefined);
  const led = ((pr && pr.displays) || []).some((d) => /^LED/i.test(d));
  const bc = s.bitcube && s.bitcube.value;
  const m = {
    'gavin-mini': true,
    bitcube: bc ? (bc.online ? (known ? true : undefined) : false) : undefined,
    'router-gallery': k(dv.router), 'gallery-net': k(dv.internet), 'public-internet': k(dv.internet),
    'cam-gallery': k(dv.gallery_cam), 'cam-river': k(dv.river_cam), glinet: k(dv.river_cam), starlink: k(dv.river_cam),
    'psac10-1': k(dv.psac10_1), 'psac10-2': k(dv.psac10_2), 'colorlight-sender': known ? led : undefined,
    'modal-app': s.modal ? !!(s.modal.value && s.modal.value.ok) : undefined,
    'ep-data': s.modal ? !!s.modal.value : undefined,
  };
  for (let i = 1; i <= 20; i++) m['rope-' + String(i).padStart(2, '0')] = k(i <= 10 ? dv.psac10_1 : dv.psac10_2);
  return m;
}

// ---- assertions --------------------------------------------------------------------------------------------------
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isInt = (x) => Number.isInteger(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const sameKeys = (o, keys) => isObj(o) && JSON.stringify(Object.keys(o)) === JSON.stringify(keys);
const parsePdt = (t) => Date.parse(`${t}-07:00`);

function checkFixture(name, f) {
  const bad = [];
  const ok = (cond, msg) => { if (!cond) bad.push(msg); return !!cond; };

  // 1. format
  ok(sameKeys(f, ['_scenario', 'status', 'cameras', 'camera_age_s']), `top-level keys must be _scenario, status, cameras, camera_age_s (got ${Object.keys(f).join(', ')})`);
  const sc = f._scenario ?? {}, st = f.status ?? {}, cams = f.cameras ?? {}, ages = f.camera_age_s ?? {};

  // 2. _scenario.expect
  ok(typeof sc.title === 'string' && sc.title.length > 0, '_scenario.title missing');
  ok(typeof sc.description === 'string' && sc.description.length >= 40, '_scenario.description missing or too short');
  const ex = sc.expect ?? {};
  ok(typeof ex.headline === 'string' && ex.headline.length > 0, '_scenario.expect.headline missing');
  ok(SEVERITIES.includes(ex.severity), `_scenario.expect.severity must be one of ${SEVERITIES.join('|')}`);
  ok(isObj(ex.items) && Object.keys(ex.items).length > 0, '_scenario.expect.items missing');
  for (const [k, v] of Object.entries(ex.items ?? {})) ok(/^(ok|warning|down|unknown): .+/.test(v), `expect.items[${k}] must read "ok|warning|down|unknown: reason"`);
  ok(typeof ex.action === 'string' && ex.action.length > 0, '_scenario.expect.action missing');
  if (ex.severity === 'ok') ok(Object.values(ex.items ?? {}).every((v) => v.startsWith('ok:')), 'severity ok but an item is not ok');
  if (ex.severity !== 'ok') ok(Object.values(ex.items ?? {}).some((v) => !v.startsWith('ok:')), `severity ${ex.severity} but every item is ok`);

  // 3. status: the sources
  ok(isObj(st) && !('studio' in st), 'status must not carry a studio key (the server adds it)');
  ok('bitcube' in st, 'status.bitcube is required');
  for (const [k, v] of Object.entries(st)) {
    ok(['bitcube', 'seasons', 'modal', 'probe'].includes(k), `unknown status key ${k}`);
    if (!ok(isObj(v) && isInt(v.at) && isInt(v.age_s), `status.${k} needs integer at and age_s`)) continue;
    ok(('value' in v) !== ('error' in v), `status.${k} must have exactly one of value / error`);
    if ('error' in v) ok(typeof v.error === 'string' && v.error.length > 0, `status.${k}.error must be a string`);
    ok(Math.abs(v.age_s - (NOW - v.at) / 1000) <= 6, `status.${k}.age_s ${v.age_s} does not match at (${((NOW - v.at) / 1000).toFixed(1)} s before NOW)`);
    ok(v.at <= NOW + 1000, `status.${k}.at is in the future`);
  }
  const bc = st.bitcube?.value, online = bc?.online, pr = st.probe?.value, td = pr?.td, y = st.seasons?.value, md = st.modal?.value;
  if (st.bitcube?.value) ok(sameKeys(bc, ['online']) && typeof online === 'boolean', 'bitcube.value must be { online: boolean }');
  if (online === false) {
    ok(!pr, 'bitcube offline but the probe has a value');
    ok(!y, 'bitcube offline but the seasons page answered');
  }
  if (y || pr) ok(online === true, 'seasons or probe answered while bitcube is not online');

  // the probe
  if (pr) {
    ok(typeof pr.ok === 'boolean', 'probe.ok must be boolean');
    ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(pr.time), `probe.time must look like 2026-10-23T02:58:51 (got ${pr.time})`);
    const t = parsePdt(pr.time), dt = (st.probe.at - t) / 1000;
    ok(dt >= 0 && dt <= 60, `probe.time should be 0-60 s before probe.at (is ${dt.toFixed(1)} s)`);
    ok(Array.isArray(pr.show_files) && pr.show_files.every((x) => SHOW_FILES.includes(x)), 'probe.show_files unknown file');
    ok(['direct', 'router', 'BOTH', 'none'].includes(pr.lights_route), 'probe.lights_route');
    ok(typeof pr.boot_file === 'string', 'probe.boot_file');
    ok(isObj(pr.modal_link) && isInt(pr.modal_link.processes), 'probe.modal_link.processes');
    for (const c of ['gallery', 'river', 'sync']) {
      const l = pr.modal_link?.[c];
      ok(isObj(l) && isInt(l.log_age_s) && l.log_age_s >= 0 && (l.last === null || (typeof l.last === 'string' && l.last.length <= 120)), `probe.modal_link.${c} must be { log_age_s, last (<=120 chars or null) }`);
      if (l?.last) ok(/^\d{2}:\d{2}:\d{2} INFO    /.test(l.last), `probe.modal_link.${c}.last must be an INFO line (the probe keeps only those): ${l.last}`);
    }
    ok(isObj(pr.recorder) && isInt(pr.recorder.clips) && (pr.recorder.last === null || (typeof pr.recorder.last === 'string' && pr.recorder.last.length <= 120)), 'probe.recorder');
    ok(sameKeys(pr.devices, DEVICES) && Object.values(pr.devices).every((v) => typeof v === 'boolean'), `probe.devices must be exactly ${DEVICES.join(', ')}, all boolean`);
    ok(Array.isArray(pr.addresses) && pr.addresses.every((a) => typeof a.nic === 'string' && typeof a.ip === 'string'), 'probe.addresses');
    ok(Array.isArray(pr.displays) && pr.displays.every((d) => typeof d === 'string'), 'probe.displays');
    ok(isNum(pr.disk_free_gb) && isNum(pr.uptime_h), 'probe.disk_free_gb / uptime_h');
    ok(isObj(td) && typeof td.ok === 'boolean', 'probe.td must be an object with ok');
    if (td?.ok === false) {
      ok(typeof td.error === 'string', 'td.ok false needs td.error');
      ok(!('file' in td), 'td.ok false must not carry a file');
      ok(!y, 'TD is not answering but the seasons page (served by TD) answered');
    }
    if (td?.ok === true) {
      ok(pr.show_files.includes(td.file), `td.file ${td.file} is not in show_files`);
      ok(td.fps === null || isNum(td.fps), 'td.fps number or null');
      ok(isNum(td.cook_rate) && isInt(td.errors), 'td.cook_rate / errors');
      ok(td.ropes === null || (isObj(td.ropes) && sameKeys(td.ropes, ['active', 'source', 'box_watts_cap', 'status'])), 'td.ropes shape');
      const rs = td.ropes?.status;
      if (rs) {
        ok(sameKeys(rs, SENDER_KEYS), `td.ropes.status keys must be ${SENDER_KEYS.join(', ')}`);
        ok(Array.isArray(rs.watts) && rs.watts.length === 2 && rs.watts.every((w) => isNum(w) && w >= 0 && w <= td.ropes.box_watts_cap), 'watts: two numbers within the cap');
        ok(rs.source === td.ropes.source && rs.active === td.ropes.active, 'ropes.status.source/active must match the parameters');
        if (rs.error === null) ok(rs.open === true && rs.retrying === false, 'no sender error but not open / retrying');
        if (rs.error !== null) ok(rs.open === false, 'a sender error means the socket is closed');
        if (rs.source === 'black' && rs.open) ok(rs.watts[0] === 0 && rs.watts[1] === 0, 'source black must draw 0 + 0 W');
      }
      ok(td.hub75 === null || sameKeys(td.hub75, ['brightness', 'output']), 'td.hub75 shape');
      if (td.file === SEASONS_FILE) {
        ok(td.river_cam === null, 'the seasons file has no river-cam relay: td.river_cam must be null');
        ok(sameKeys(td.seasons, YEAR_KEYS), `td.seasons must be Year.state() with keys ${YEAR_KEYS.join(', ')}`);
        ok(pr.devices.seasons_page === true, 'the seasons file serves 9981: devices.seasons_page must be true');
      }
      if (td.file === ONLINE_FILE) {
        ok(td.seasons === null, 'the online file has no seasons COMP: td.seasons must be null');
        ok(pr.devices.seasons_page === false, 'the online file serves nothing on 9981');
        ok(!y && typeof st.seasons?.error === 'string', 'the online file: status.seasons must be an error');
        ok(isObj(td.river_cam) && sameKeys(td.river_cam, RELAY_KEYS), `td.river_cam must have keys ${RELAY_KEYS.join(', ')}`);
      }
      if (isObj(td.river_cam)) ok(td.river_cam.fresh === (td.river_cam.frames > 0 && td.river_cam.last_frame_age_s < 10), 'river_cam.fresh must equal last_frame_age_s < 10');
      if (td.seasons && y) {
        ok(td.seasons.mode === y.mode && td.seasons.season === y.season, 'td.seasons and the seasons page disagree on mode/season');
        ok(Math.abs(td.seasons.phase - y.phase) < 0.2, 'td.seasons.phase far from the seasons page phase');
      }
    }
    if (y) ok(td?.ok === true && y.file === td.file, 'seasons page answered: its file must be the show file TD runs');
    ok(pr.displays.some((d) => /^LED/i.test(d)) || pr.displays.includes('\u0000') || pr.displays.length === 0, 'displays: expect "LED 1920X1080" (sender attached) or ["\\u0000"] (nothing attached)');
    if (pr.modal_link.processes === 0) ok(Object.values(pr.modal_link).filter(isObj).every((l) => l.log_age_s > 60), 'Modal link not running but its logs are fresh');
  }

  // the seasons page
  if (y) {
    ok(sameKeys(y, STATE_KEYS), `seasons.value keys must be ${STATE_KEYS.join(', ')}`);
    ok(MODES.includes(y.mode) && MODES.includes(y.effective_mode), 'seasons mode');
    ok(isNum(y.phase) && y.phase >= 0 && y.phase < 4, 'seasons phase in [0, 4)');
    ok(y.season === SEASONS[Math.round(y.phase) % 4], `season ${y.season} does not match phase ${y.phase}`);
    const wsum = Object.values(y.weights).reduce((a, b) => a + b, 0);
    ok(sameKeys(y.weights, SEASONS) && Math.abs(wsum - 1) < 0.01, 'weights must be the four seasons summing to 1');
    ok(isNum(y.intensity) && y.intensity >= 0 && y.intensity <= 1, 'intensity 0..1');
    ok(y.target === null || SEASONS.includes(y.target), 'target');
    ok(y.mode !== 'automatic' || y.target === null, 'automatic mode has no target');
    ok(y.mode !== 'manual' || y.target === y.manual.season, 'manual mode: target is the manual season');
    ok(sameKeys(y.manual, ['season', 'intensity']) && SEASONS.includes(y.manual.season), 'manual');
    ok(sameKeys(y.presence, ['available', 'now', 'usual', 'relative', 'empty_for_s']), 'presence');
    ok(y.counter_available === y.presence.available, 'counter_available must match presence.available');
    ok(isObj(y.rules) && Object.values(y.rules).every((r) => sameKeys(r, ['value', 'label', 'default', 'min', 'max', 'unit'])), 'rules');
    ok(Array.isArray(y.history) && y.history.length <= 6, 'history: keep it to about 6 points');
    let prevT = 0;
    for (const h of y.history) {
      ok(sameKeys(h, ['t', 'phase', 'intensity', 'now', 'usual', 'relative']), 'history point keys');
      ok(h.t > prevT && h.t * 1000 <= st.seasons.at && h.t * 1000 >= NOW - 2 * 3600 * 1000, 'history times ascending, within the last 2 h, before seasons.at');
      prevT = h.t;
    }
    if (y.history.length) ok(y.history.at(-1).phase === Math.round(y.phase * 1000) / 1000 || Math.abs(y.history.at(-1).phase - y.phase) < 0.3, 'last history point far from the current phase');
  }

  // Dave's agent
  if (md) {
    ok(sameKeys(md, MODAL_KEYS), `modal.value keys must be ${MODAL_KEYS.join(', ')}`);
    ok(typeof md.ok === 'boolean' && isInt(md.tick) && typeof md.mood === 'string', 'modal tick/mood/ok');
    const fin = Date.parse(md.finished_at), set = Date.parse(md.set_at);
    ok(fin <= NOW && set <= NOW, 'modal finished_at / set_at in the past');
    ok(Math.abs(fin - set) <= 10_000, 'set_at should be within a few seconds of finished_at (same tick)');
    ok(isInt(md.next_tick_epoch) && md.next_tick_epoch * 1000 > fin, 'next_tick_epoch after finished_at');
    ok(md.scene === null || sameKeys(md.scene, ['animation', 'palette', 'colors', 'speed', 'turbulence']), 'modal scene keys');
  }

  // 4. cameras
  ok(sameKeys(cams, ['gallery', 'river']) && Object.values(cams).every((v) => typeof v === 'boolean'), 'cameras must be { gallery: bool, river: bool }');
  ok(sameKeys(ages, ['gallery', 'river']), 'camera_age_s must be { gallery, river }');
  for (const c of ['gallery', 'river']) {
    if (cams[c]) ok(isNum(ages[c]) && ages[c] >= 0, `camera_age_s.${c} must be a number when a still exists`);
    else ok(ages[c] === null, `camera_age_s.${c} must be null when there is no still`);
    if (cams[c]) ok(online === true, `a ${c} still exists but bitcube is offline (stills come through bitcube)`);
    if (cams[c] && pr) ok(pr.devices[`${c}_cam`] === true || ages[c] > 300, `a fresh ${c} still while the probe says the camera is down`);
  }

  // 5. today's pages read it without throwing
  let pages = {};
  try { pages = { status: statusRender(st), mission: missionRender(st), map: toMap(st) }; } catch (e) { bad.push(`today's page code throws: ${e.stack.split('\n').slice(0, 2).join(' ')}`); }
  if (pages.status) ok(pages.status.rows.length === 15, 'rows() must give 15 rows');
  return { bad, pages };
}

const want = process.argv.slice(2);
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_') && (!want.length || want.includes(f.replace(/\.json$/, '')))).sort();   // _recorded-*.json is the base, not a scenario
let failed = 0;
for (const file of files) {
  const name = file.replace(/\.json$/, '');
  let f;
  try { f = JSON.parse(readFileSync(join(DIR, file), 'utf8')); } catch (e) { console.log(`FAIL ${name}: does not parse: ${e.message}`); failed++; continue; }
  const { bad, pages } = checkFixture(name, f);
  const today = pages.status ? `${pages.status.sum}${pages.status.sumsub ? ' (' + pages.status.sumsub + ')' : ''}` : '-';
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${name.padEnd(22)} expect ${f._scenario?.expect?.severity?.padEnd(7) ?? '?'} today's page: ${today}`);
  for (const b of bad) console.log(`       - ${b}`);
  if (bad.length) failed++;
}
console.log(`${files.length - failed} of ${files.length} fixtures pass`);
process.exit(failed ? 1 : 0);
