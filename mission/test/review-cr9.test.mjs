// Code review CR9 (a3f0f55..1e731d3): step lines that tell a look at a script from a run of it, a POST from a curl with -f, and a
// state file read from one written; the login masks for a uci show line, an escaped "key", prose's "pass" and mysql's -P; a lost
// switch that a later full check shows; one name for a dry run and its steps; Recent's split lines from the events themselves; a
// press the server's verdict ends still settles its page; the server's own check that TouchDesigner is starting, closed when it
// can't tell; Lights' own memory and its ownChanges once a paint; the step context only when a step needs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const T0 = Date.UTC(2026, 9, 26, 4, 4, 0);          // 21:04 Pacific
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = (f) => src(`../public/${f}`);

const stepOf = async (command, description = 'Check it', ctx = undefined) => {
  const { describeTool } = await import('../lib/steps.mjs');
  const { stepWords } = await import('../public/chat-words.js');
  const d = describeTool({ name: 'Bash', input: { command, description } }, ctx);
  const shown = stepWords(d);            // the page shows every line as it was sent
  assert.deepEqual([shown.text, shown.act], [d.text, d.acting], `the page reworded "${d.text}"`);
  return [d.text, d.acting];
};
const B = 'ssh bitcube';

// ---- #1: a script's or a cmdlet's name read, grepped or printed is no run of it -------------------------------------------------

test('CR9 #1: reading, grepping or printing a script or a cmdlet by name is a look, never the change it would make when run', async () => {
  for (const cmd of [
    'grep -n Route tools/mission/lights_route.ps1',
    `${B} type C:\\Users\\user\\River\\river-bitcube\\Start-River.cmd`,
    `${B} "type C:\\Users\\user\\River\\river-bitcube\\Start-River.cmd"`,
    'grep -rn Stop-ScheduledTask tools/',
    'cat tools/lights_route.ps1 | head -20',
    `${B} "Get-Content C:\\Users\\user\\River\\river-bitcube\\tools\\lights_route.ps1"`,
    'git log --oneline -- tools/lights_route.ps1',
    'git -C /x show HEAD:Start-River.cmd',
    'sed -n 1,20p Start-River.cmd',
    'tail -5 Start-River.cmd',
    'grep -rn "Restart-Computer\\|shutdown /r" tools/',
    `${B} "powershell -Command \\"Get-Content C:\\x\\Start-River.cmd\\""`,
  ]) assert.equal((await stepOf(cmd))[1], false, cmd);
  // a run stays a run, also after a look in the same command
  for (const [cmd, words] of [
    [`${B} "Get-Content C:\\x\\lights_route.ps1; powershell -File C:\\x\\lights_route.ps1 router"`, 'moved the lighting port'],
    ['grep -n Route lights_route.ps1 && powershell -File lights_route.ps1 direct', 'moved the lighting port'],
    [`${B} "Get-ScheduledTask -TaskName RopeLights | Stop-ScheduledTask"`, 'changed a scheduled task on bitcube'],
    [`${B} "cmd /c C:\\Users\\user\\River\\river-bitcube\\Start-River.cmd"`, 'started TouchDesigner'],
  ]) assert.deepEqual(await stepOf(cmd), [words, true], cmd);
});

// ---- #2: a POST to the year's page by its own flags, case and all ---------------------------------------------------------------

test("CR9 #2: only a POST to the year's page is a change to it: curl's -f (fail) and -D (dump headers) are no -F or -d, and -G sends -d as a GET", async () => {
  for (const cmd of ['curl -s -f http://bitcube:9981/state', 'curl -sf http://100.73.68.60:9981/state', 'curl -s -D - http://bitcube:9981/state',
    'curl -fsSL http://bitcube:9981/state', 'curl -G -d mode=manual http://bitcube:9981/state', 'curl -X GET http://bitcube:9981/state',
    'curl -s -X POST http://bitcube:8770/x -d 1 ; curl -sf http://bitcube:9981/state']) {
    assert.equal((await stepOf(cmd))[1], false, cmd);
  }
  for (const cmd of ['curl -X POST http://100.73.68.60:9981/mode -d \'{"mode":"manual"}\'', 'curl -s -d \'{"mode":"manual"}\' http://bitcube:9981/mode',
    'curl -sd mode=manual http://bitcube:9981/mode', 'curl -F mode=manual http://bitcube:9981/mode', 'curl --data-raw x http://bitcube:9981/rules',
    'curl --json \'{"a":1}\' http://bitcube:9981/rules', 'curl -XPOST http://bitcube:9981/rules/reset', 'curl --request POST http://bitcube:9981/rules/reset',
    `${B} "Invoke-RestMethod -Method Post -Uri http://localhost:9981/target -Body x"`]) {
    assert.deepEqual(await stepOf(cmd), ["changed the river's year", true], cmd);
  }
});

// ---- #3: a state file's mode is the open() call's own ---------------------------------------------------------------------------

test('CR9 #3: code that opens a state file to read is a look; only its own open(…, "w"), a Path write or a writer of it is a change', async () => {
  for (const cmd of [
    `${B} "python -c \\"print(open(r'C:\\Users\\user\\River\\boot-file.txt').read(), 'a')\\""`,
    `python -c "x = open('presence.json').read(); print(x, 'w')"`,
    `python -c "import json; d = json.load(open('C:/Users/user/River/calibration.cancel')); print(d, 'x')"`,
    `python -c "from pathlib import Path; print(Path('boot-file.txt').read_text()); Path('/tmp/o').write_text('y')"`,
  ]) assert.equal((await stepOf(cmd))[1], false, cmd);
  for (const [cmd, words] of [
    [`${B} "python -c \\"open(r'C:\\Users\\user\\River\\boot-file.txt','w').write('x')\\""`, 'changed the boot file'],
    [`python -c "open(os.path.join(R, 'boot-file.txt'), mode='w').write('x')"`, 'changed the boot file'],
    [`python -c "p = r'C:\\Users\\user\\River\\calibration.cancel'; open(p, 'a').close()"`, 'stopped the calibration'],
    [`python -c "from pathlib import Path; Path(r'C:/Users/user/River/presence.json').write_text('{}')"`, "changed the people counter's count"],
    [`python -c "Path('C:/Users/user/River/boot-file.txt').open('w').write('x')"`, 'changed the boot file'],
    [`node -e "require('fs').writeFileSync('C:/Users/user/River/boot-file.txt', 'x')"`, 'changed the boot file'],
  ]) assert.deepEqual(await stepOf(cmd), [words, true], cmd);
});

// ---- #14: mysql's password is -p, never its port -P ----------------------------------------------------------------------------

test("CR9 #14: mysql's -P<port> is no password: only a lower-case -p<pw> is masked, here and in probe.ps1", async () => {
  const { scrubCreds } = await import('../lib/scrub.mjs');
  for (const line of ['mysql -h db -P3306 -u root river', 'mysqldump -P 3306 river', 'mariadb -P3307 -u x']) assert.equal(scrubCreds(line), line, line);
  assert.equal(scrubCreds('mysql -u root -P3306 -pNOT-A-REAL-PW river'), 'mysql -u root -P3306 -p*** river');
  assert.match(src('../../tools/mission/probe.ps1'), /^\$CRED_MYSQL = '[^\n]*\(\?-i:-p\)/m, 'the same case rule on bitcube');
});

// ---- #5: "pass" is a login only in a login's shape, never in prose ------------------------------------------------------------

test('CR9 #5: prose keeps its "pass"; a pass= in a query or form, --pass, or a JSON "pass" beside a user or login is still masked', async () => {
  const { scrubCreds } = await import('../lib/scrub.mjs');
  const F = 'NOT-A-REAL-PW-cr9';
  for (const line of ['First pass: all 20 ropes answer', 'Second pass: 3 patterns photographed again', 'pass: the ropes are fine', 'one pass = 29 patterns',
    '{"stage":"ropes-capture","pass":"A","step":12}', "{'pass': 'B', 'of': 29}", '"pass": 2', 'else: pass']) assert.equal(scrubCreds(line), line, line);
  for (const [line, want] of [
    [`https://cam/api.cgi?cmd=Snap&user=admin&pass=${F}`, 'https://cam/api.cgi?cmd=Snap&user=admin&pass=***'],
    [`pass=${F} x`, 'pass=*** x'],
    [`db_pass=${F} DB_PASS: ${F}`, 'db_pass=*** DB_PASS: ***'],
    [`openssl enc --pass ${F}`, 'openssl enc --pass ***'],
    [`{"user":"admin","pass":"${F}"}`, '{"user":"admin","pass":"***"}'],
    [`{"pass":"${F}","user":"admin"}`, '{"pass":"***","user":"admin"}'],
    [`{"username": "admin", "pass": "${F}"}`, '{"username": "admin", "pass": "***"}'],
    [`{'login': 'admin', 'pass': '${F}'}`, "{'login': 'admin', 'pass': '***'}"],
    [`{\\"user\\":\\"admin\\",\\"pass\\":\\"${F}\\"}`, '{\\"user\\":\\"admin\\",\\"pass\\":\\"***\\"}'],
    [`{"user":"admin","pass":"ab\\"${F}"}`, '{"user":"admin","pass":"***"}'],
  ]) assert.equal(scrubCreds(line), want, line);
});

// ---- #12: the Wi-Fi key in escaped JSON too ------------------------------------------------------------------------------------

test('CR9 #12: a "key" inside a JSON string (escaped quotes) is masked like the other names, and the JSON stays JSON', async () => {
  const { scrubCreds, PATTERNS } = await import('../lib/scrub.mjs');
  const F = 'NOT-A-REAL-PW-cr9';
  const out = JSON.stringify({ out: JSON.stringify({ ssid: 'gray-river', key: `${F}"x\\`, encryption: 'psk2' }) });
  const got = scrubCreds(out);
  assert.doesNotMatch(got, /NOT-A-REAL/);
  assert.deepEqual(JSON.parse(JSON.parse(got).out), { ssid: 'gray-river', key: '***', encryption: 'psk2' });
  assert.equal(scrubCreds(`{"out":"{\\"key\\":\\"${F}\\"}"}`), '{"out":"{\\"key\\":\\"***\\"}"}');
  assert.equal(scrubCreds(`{"ssid":"gray-river","key":"${F}'s"}`), '{"ssid":"gray-river","key":"***"}', "an apostrophe in a double-quoted key");
  for (const line of ['"keys": ["a"]', '"primary_key":"id"', 'sort key=name', '"key": 5', 'the primary key: id']) assert.equal(scrubCreds(line), line, line);
  assert.equal(PATTERNS.KEYJSON, undefined, 'one rule: "key" is one of the names, so QUOTED and ESCAPED mask it');
  assert.doesNotMatch(src('../../tools/mission/probe.ps1'), /CRED_KEY_JSON/);
});

// ---- #4: the Wi-Fi key in uci show and uci export output ----------------------------------------------------------------------

test('CR9 #4: a uci show line (<anything>.key=…, quoted or not, a space or an apostrophe in it) and uci export are masked, here and in probe.ps1', async () => {
  const { scrubCreds } = await import('../lib/scrub.mjs');
  const F = 'NOT-A-REAL-PW-cr9';
  const show = `wireless.radio0.channel='36'\nwireless.default_radio0.ssid='gray-river'\nwireless.default_radio0.key='${F}'\nwireless.default_radio0.encryption='psk2'\n`;
  assert.equal(scrubCreds(show), show.replace(F, '***'));
  for (const [line, want] of [
    [`wireless.@wifi-iface[1].key='${F}'`, "wireless.@wifi-iface[1].key='***'"],
    [`wireless.wifinet2.key=${F}`, 'wireless.wifinet2.key=***'],
    [`wireless.default_radio0.key='a b ${F}'`, "wireless.default_radio0.key='***'"],
    [`wireless.default_radio0.key='it'\\''s ${F}'`, "wireless.default_radio0.key='***'"],
    [`wireless.wep.key1='${F}'`, "wireless.wep.key1='***'"],
    [`wireless.default_radio0.sae_password='${F}' wireless.x.password=${F}`, "wireless.default_radio0.sae_password='***' wireless.x.password=***"],
    [`uci set wireless.@wifi-iface[1].key='two ${F}'`, "uci set wireless.@wifi-iface[1].key='***'"],
    [`\toption key '${F} x'`, "\toption key '***'"],
  ]) assert.equal(scrubCreds(line), want, line);
  for (const line of ['sort key=name', 'x.keys=1', 'wireless.default_radio0.ssid=\'gray-river\'', 'option keyfile x']) assert.equal(scrubCreds(line), line, line);
});

// ---- #13: an object's "key" or "pass" is a login only by what is beside it ----------------------------------------------------

test('CR9 #13: in an object, "key" is masked only as a Wi-Fi key (beside an ssid or encryption, or under the wireless settings) and "pass" only beside a user; never a number or a boolean', async () => {
  const { scrubCreds } = await import('../lib/scrub.mjs');
  const F = 'NOT-A-REAL-PW-cr9';
  const keep = [{ key: 'river-local', file: 'x' }, { running: true, stage: 'ropes-capture', pass: 'A', step: 3, of: 29 }, { pass: 2 }, { key: 5, ssid: 'gray-river' },
    { user: 'admin', pass: 1234 }, { ssid: 'gray-river', key: true }, { wireless: { radio0: { channel: 36, key: 7 } } }, { keys: ['a'], bypass: true, compass: 'n' }];
  for (const x of keep) assert.deepEqual(scrubCreds(x), x, JSON.stringify(x));
  assert.deepEqual(scrubCreds({ ssid: 'gray-river', key: F, encryption: 'psk2' }), { ssid: 'gray-river', key: '***', encryption: 'psk2' });
  assert.deepEqual(scrubCreds({ wireless: { default_radio0: { key: F, mode: 'ap' } } }), { wireless: { default_radio0: { key: '***', mode: 'ap' } } });
  assert.deepEqual(scrubCreds({ router: { wifi: [{ key: F }] } }), { router: { wifi: [{ key: '***' }] } });
  assert.deepEqual(scrubCreds({ user: 'admin', pass: F }), { user: 'admin', pass: '***' });
  assert.deepEqual(scrubCreds({ Login: 'admin', PASS: { x: F } }), { Login: 'admin', PASS: '***' });
  // the names that are always a login stay so, a number too (a numeric secret)
  assert.deepEqual(scrubCreds({ SSHPASS: F, db_pass: F, password: 42, api_key: F }), { SSHPASS: '***', db_pass: '***', password: '***', api_key: '***' });
});

// ---- #6: a lost switch to another file ends done when a later full check shows it ----------------------------------------------

function payload({ t, td, uptime_h = 30, applying = [], extra = {} } = {}) {
  return { now: t, bitcube: { ok: true, at: t, value: { online: true } }, seasons: { ok: true, at: t, value: { season: 'winter', mode: 'automatic', intensity: 0.2, presence: { available: false } } },
    modal: { ok: true, at: t, value: { ok: true, tick: 1, next_tick_epoch: t / 1000 + 200, finished_at: new Date(t - 60_000).toISOString() } },
    probe: { ok: true, at: t, value: { ok: true, uptime_h, time: '2026-10-25T21:04:00', boot_file: YEAR, show_files: [YEAR, LIVE], displays: ['M14', 'LED 1920X1080'],
      devices: { psac10_1: true, psac10_2: true, gallery_cam: true, river_cam: true, router: true, internet: true },
      modal_link: { processes: 8, gallery: { log_age_s: 1, last: '21:03:59 INFO ok' }, river: { log_age_s: 4, last: '21:03:56 INFO ok' }, sync: { log_age_s: 57, last: '21:03:03 INFO ok' } },
      recorder: { clips: 14, last: '2026-10-25 21:00:41 done' },
      td: td ?? { ok: true, file: YEAR, fps: 60, errors: 0, ropes: { source: 'canvas', status: { open: true, active: true, watts: [100, 100] } }, hub75: { brightness: 1, output: true } } } },
    applying, ...extra };
}

test("CR9 #6: a switch whose answer was lost, its entry known to no list, is done once a full check taken after it shows TouchDesigner on that file", async () => {
  const { derive, ownVerdict } = await import('../public/model.js');
  const t = T0 + 120_000;
  const live = derive(payload({ t, td: { ok: true, file: LIVE, fps: 60, errors: 0 } }), t);
  const lost = { state: 'unconfirmed', lost: true, held: false, entryId: null, requestId: 'rlost1', serverConfirms: true };
  const sent = { action: 'switch', file: LIVE, before: YEAR, sentAt: T0 };
  assert.equal(ownVerdict(live, { ...lost, sent }).step, 'done', 'CR7 #4: the reading shows it');
  assert.equal(ownVerdict(live, { ...lost, sent }).judged, true);
  // never from a reading taken before the send, a restart (the same file) or a rebuild: no reading can tell
  assert.equal(ownVerdict(live, { ...lost, sent: { ...sent, sentAt: t + 1000 } }).step, null);
  assert.equal(ownVerdict(derive(payload({ t, td: { ok: true, file: YEAR, fps: 60, errors: 0 } }), t), { ...lost, sent: { ...sent, file: YEAR } }).step, null);
  assert.equal(ownVerdict(live, { ...lost, sent: { ...sent, action: 'rebuild' } }).step, null);
  // a boot-file change the same way
  const boot = derive(payload({ t, extra: {} }), t);
  boot.show.boot_file = { name: LIVE };
  assert.equal(ownVerdict(boot, { ...lost, sent: { action: 'bootfile', file: LIVE, before: YEAR, sentAt: T0 } }).step, 'done');
});

// ---- #7, #8, #16: one rule for what a dry run is, one helper for its steps ------------------------------------------------------

test('CR9 #7, #8: a decode of earlier photos touches no lights but is no dry run: real stage words, "the calibration stop", one helper everywhere', async () => {
  const { derive, calDryRun, calNoLights } = await import('../public/model.js');
  const { describeEvent } = await import('../lib/history.mjs');
  const DECODE = { running: true, pid: 9, mode: 'decode-only', decode_only: 'pixelmap-20261018-154155', dry_run: false, stage: 'ropes-decode', expected_s: 40, elapsed_s: 5 };
  const DRY = { running: true, pid: 9, mode: 'dry-run', dry_run: true, decode_only: null, stage: 'ropes-decode', expected_s: 2, elapsed_s: 1 };
  assert.deepEqual([calDryRun(DECODE), calNoLights(DECODE), calDryRun(DRY), calNoLights(DRY), calDryRun({ mode: 'full' }), calNoLights({ mode: 'full' })],
    [false, true, true, true, false, false]);
  const at = (cal) => { const p = payload({ t: T0 }); p.probe.value.calibration = cal; return derive(p, T0); };
  const d = at(DECODE), y = at(DRY);
  assert.equal(d.show.calibration.words, 'working out where each rope is', 'a decode really works out where each rope is');
  assert.equal(d.show.calibration.dry, false);
  assert.equal(y.show.calibration.words, 'step 2 of 4');
  assert.equal(y.show.calibration.dry, true);
  // a decode locks nothing on the lights (R7 #20), and it is "a calibration", never "a dry run", in its headline and its reasons
  assert.equal(d.controls.ropes.why, null);
  assert.equal(d.controls.calibrate.why, 'a calibration is already running');
  assert.equal(y.controls.calibrate.why, 'a dry run is already running');
  const dp = d.problems.find((p) => p.id === 'calibrating');
  assert.doesNotMatch(`${dp.headline} ${dp.summary}`, /dry run|step \d/i);
  assert.match(dp.headline, /earlier photos: the lights stay as they are/);
  // the history and the step lines name it the same: a calibration from earlier photos, its stop the calibration stop
  assert.equal(describeEvent({ kind: 'calibration', running: true, stage: 'ropes-decode', mode: 'decode-only', from: { running: true, stage: null } }), 'A calibration from earlier photos is working out where each rope is');
  const server = src('../server.mjs');
  assert.match(server, /const isDryRun = \(c\) => !!c && typeof c === 'object' && c\.running === true && calDryRun\(c\);/);
  assert.match(server, /calDry: calDryRun\(cal\)/, "the agent's step context: the same rule as the server's record of a Stop");
  assert.doesNotMatch(server, /mode === 'decode-only'/);
  assert.match(src('../lib/history.mjs'), /const dry = calDryRun\(ev\);/);
  assert.match(src('../lib/mission.mjs'), /calNoLights\(cal\)/);
  assert.match(page('lights.js'), /const dry = calDryRun\(p\);/);
  assert.match(page('lights-words.js'), /const dry = calDryRun\(p\) \|\| !!p\?\.result\?\.dry_run;/);
});

test("CR9 #16: a dry run's \"step N of 4\" comes from one helper (model.js calStep), never a table or a literal 4 of its own", async () => {
  const { calStep, CAL_STAGES, CAL_STAGE_S } = await import('../public/model.js');
  assert.deepEqual(CAL_STAGES, Object.keys(CAL_STAGE_S));
  assert.deepEqual(calStep('ropes-decode'), { n: 2, of: 4, words: 'step 2 of 4' });
  assert.deepEqual(calStep('hub75-locate'), { n: 4, of: 4, words: 'step 4 of 4' });
  assert.equal(calStep('done'), null);
  assert.equal(calStep(null), null);
  const { describeEvent } = await import('../lib/history.mjs');
  assert.equal(describeEvent({ kind: 'calibration', running: true, stage: 'hub75-capture', mode: 'dry-run', from: { running: true, stage: 'ropes-decode' } }), 'A dry run is at step 3 of 4');
  assert.doesNotMatch(src('../lib/history.mjs'), /STAGE_STEP|of 4/);
  assert.doesNotMatch(page('lights.js'), /of 4|const STAGE_ORDER = \['ropes-capture'/);
  assert.match(page('lights.js'), /calStep\(/);
  assert.doesNotMatch(page('model.js').slice(page('model.js').indexOf('export function derive')), /step \$\{calStep\} of/);
});

// ---- #9, #19: Recent's split lines from the events themselves, its index kept as they come and go -------------------------------

test("CR9 #9: an older change whose verdict the capped map forgot is still \"Asked to …\" beside its own verdict line, never \"Sent …\" and a verdict too", async () => {
  const { History, feed } = await import('../lib/history.mjs');
  let t = T0;
  const h = new History({ file: null, now: () => t });
  const asked = (i) => {
    h.action({ action: 'switch', body: { file: i % 2 ? LIVE : YEAR }, ok: true, source: 'mission control', applying_id: `a.${i}`, t });
    t += 1000;
    h.judge({ confirmed: [{ id: `a.${i}`, action: 'switch' }] }, t);
    t += 1000;
  };
  for (let i = 0; i < 502; i++) asked(i);          // more than the verdicts the history keeps by id (VERDICTS_KEPT, 500)
  const lines = feed(h.recent({ limit: 5000 }));
  const first = lines.filter((l) => l.applying_id === 'a.0');
  assert.deepEqual(first.map((l) => l.words).sort(), ["Asked to switch TouchDesigner to the river's year from mission control", "bitcube showed the switch to the river's year"].sort());
  assert.ok(!lines.some((l) => /^Sent /.test(l.words)), 'never "Sent …" beside a verdict line of its own');
});

test('CR9 #19: Recent reads its actions by id from an index kept as events are added and pruned, never a Map rebuilt over every event per call', async () => {
  const { History, feed } = await import('../lib/history.mjs');
  let t = T0;
  const h = new History({ file: null, now: () => t, keepMs: 60_000, max: 50 });
  for (let i = 0; i < 40; i++) {
    h.action({ action: 'switch', body: { file: YEAR }, ok: true, source: 'mission control', applying_id: `b.${i}`, t });
    t += 1000;
    h.judge({ confirmed: [{ id: `b.${i}` }] }, t);
    t += 1000;
  }
  h.events.filter = () => { throw new Error('recent() rebuilt its index over every event'); };
  const lines = feed(h.recent({ limit: 500 }));
  // the window is the last minute: what was pruned is gone from the index too, and every action left has its verdict line
  const ids = new Set(lines.filter((l) => l.kind === 'action').map((l) => l.applying_id));
  const verdicts = lines.filter((l) => l.kind === 'verdict');
  assert.ok(ids.size > 0 && ids.size < 40);
  for (const v of verdicts) assert.ok(ids.has(v.applying_id) || !h.events.some((e) => e.kind === 'action' && e.applying_id === v.applying_id), v.applying_id);
  assert.ok(lines.filter((l) => l.kind === 'action').every((l) => /^Asked to /.test(l.words)));
});

test('CR9 #9, #19: a history read back from its file indexes its actions and verdicts too: the split lines survive a restart of the server', async () => {
  const { History, feed } = await import('../lib/history.mjs');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'cr9-')), 'history.jsonl');
  let t = T0;
  const a = new History({ file, now: () => t });
  a.action({ action: 'bootfile', body: { file: LIVE }, ok: true, source: 'studio chat', applying_id: 'c.1', t });
  t += 5000;
  a.judge({ expired: [{ id: 'c.1' }] }, t);
  const b = new History({ file, now: () => t + 1000 });
  assert.deepEqual(feed(b.recent()).filter((l) => l.applying_id === 'c.1').map((l) => l.words),
    ["bitcube didn't show the change of the boot file to the live river in time", 'Asked to set the boot file to the live river from the studio chat']);
});

// ---- #10: a press the server's verdict ends while its POST is on the way still settles its page ---------------------------------

test("CR9 #10: when the server's verdict ends a press in flight, expired and held run onFail (with its entry) as done and confirming run onSent", () => {
  const ui = page('ui.js');
  const block = /if \(own\?\.judged && s\.state === 'applying'\) \{[\s\S]*?\n    \}\n/.exec(ui)?.[0] ?? '';
  assert.match(block, /sendToken = null;/, 'its late answer changes nothing');
  assert.match(block, /if \(own\.step === 'done' \|\| own\.step === 'confirming'\) hook\('onSent', null\);/);
  assert.match(block, /else if \(own\.step === 'expired'\) hook\('onFail', Object\.assign\(new Error\("bitcube didn't show it in time"\), \{ applyingId: own\.entryId, expired: true \}\)\);/);
  assert.match(block, /else if \(own\.step === 'held'\) hook\('onFail', Object\.assign\(new Error\("bitcube didn't answer in time"\), \{ applyingId: own\.entryId, maybe: true, serverMaybe: true \}\)\);/);
  // the hooks run before the state moves on, as send() runs them before go()
  assert.ok(block.indexOf("hook('onFail'") < block.indexOf("if (own.step === 'expired') return go("));
  assert.match(ui, /const hook = \(name, arg\) => \{ try \{ o\[name\]\?\.\(arg\); \} catch \(e\) \{ console\.warn\(name, e\); \} \};/);
  // Lights' Start, Dry run and Rebuild refresh on it (pollCal; Rebuild remembers the entry as its own)
  assert.match(page('lights.js'), /serverConfirms: true, onSent: afterStart, onFail: \(\) => pollCal\(\) \}\);/);
});

// ---- #11: the server's own check that TouchDesigner is starting, on the reading itself, closed when it can't tell -----------------

test('CR9 #11: "TouchDesigner is starting" is one small rule on the full check\'s reading (model.js tdStartingWhy), the pages\' and the server\'s', async () => {
  const { tdStartingWhy, TD_STARTING_WHY, TD_RESTARTING_WHY, TD_UNREADABLE_WHY, derive } = await import('../public/model.js');
  assert.equal(TD_STARTING_WHY, 'TouchDesigner is still starting: wait a minute');
  assert.equal(TD_RESTARTING_WHY, 'TouchDesigner is restarting: wait a minute');
  for (const [pr, want] of [
    [{ uptime_h: 0.05, td: { ok: false, error: 'TouchDesigner is not running' } }, TD_STARTING_WHY],     // bitcube's own boot
    [{ uptime_h: 30, td: { ok: false, error: 'TouchDesigner is not running' } }, null],                 // a fault, not a start
    [{ uptime_h: 30, td: { ok: false, error: `restarting on ${YEAR}` } }, TD_RESTARTING_WHY],          // a crash relaunch, no entry
    [{ uptime_h: 0.1, td: { ok: true, file: YEAR } }, TD_STARTING_WHY],                                // its first check: no frame rate yet
    [{ uptime_h: 30, td: { ok: true, file: YEAR } }, null],
    [{ uptime_h: 30, td: { ok: true, file: YEAR, fps: 60 } }, null],
    [null, null],                                                                                       // no reading: the pages' own reasons
    [{ uptime_h: 30 }, TD_UNREADABLE_WHY], [{ uptime_h: 30, td: 'x' }, TD_UNREADABLE_WHY], [{ uptime_h: 'soon', td: { ok: true, file: YEAR } }, TD_UNREADABLE_WHY], ['x', TD_UNREADABLE_WHY],
  ]) assert.equal(tdStartingWhy(pr), want, JSON.stringify(pr));
  // the pages grey a switch and a rebuild by the very rule
  const t = T0, booting = payload({ t, uptime_h: 0.05, td: { ok: false, error: 'TouchDesigner is not running' } });
  assert.equal(derive(booting, t).controls.switch.starting, TD_STARTING_WHY);
  assert.equal(derive(booting, t).controls.rebuild.why, TD_STARTING_WHY);
});

test('CR9 #11: the server refuses a switch or rebuild it can\'t judge (a reading it can\'t read, a slip in the check): closed, with a clear 409', async () => {
  const { startingBlocked, Mission } = await import('../lib/mission.mjs');
  const { TD_UNREADABLE_WHY, TD_STARTING_WHY } = await import('../public/model.js');
  const why = (action, probe) => startingBlocked(action, probe)?.message ?? null;
  assert.equal(why('switch', { at: T0, value: { ok: true, uptime_h: 30, td: { ok: true, file: YEAR, fps: 60 } } }), null);
  assert.equal(why('switch', { at: T0, value: { ok: true, uptime_h: 30 } }), TD_UNREADABLE_WHY);
  assert.equal(why('rebuild', { at: T0, value: { get td() { throw new Error('a slip'); } } }), TD_UNREADABLE_WHY, 'an exception fails closed');
  assert.equal(startingBlocked('rebuild', { at: T0, value: { uptime_h: 30 } }).status, 409);
  assert.equal(why('ropes', { at: T0, value: { uptime_h: 30 } }), null, 'only a switch or a rebuild');
  assert.equal(why('switch', { at: T0, error: 'ssh: timed out' }), null, 'a failed check says nothing: bitcube answers the switch itself');
  assert.equal(why('switch', undefined), null);
  // the live server judges its own reading, never the whole page model
  let t = T0, reading = { ok: true, uptime_h: 30 };
  const m = new Mission({ now: () => t, later: () => {}, probe: async (_h, args) => (args ? { ok: true, td: { ok: true, file: YEAR } } : reading) });
  await m.pollProbe();
  await assert.rejects(m.control('switch', { file: LIVE }), (e) => e.status === 409 && e.message === TD_UNREADABLE_WHY);
  t += 5000; reading = { ok: true, uptime_h: 0.05, td: { ok: true, file: YEAR } };
  await m.pollProbe();
  await assert.rejects(m.control('rebuild', { file: YEAR }), (e) => e.status === 409 && e.message === TD_STARTING_WHY);
  const lib = src('../lib/mission.mjs');
  assert.match(lib, /startingBlocked\(action, this\.data\.probe\)/);
  assert.doesNotMatch(lib, /tdStarting\(snap\(\)/);
  assert.match(src('../lib/fixtures.mjs'), /try \{ probe = this\.snapshot\(scenario\)\.probe; \} catch \{ probe = \{ value: 'unreadable' \}; \}[^\n]*\n[^\n]*startingBlocked\(action, probe\)/, 'fixture mode: its scenario\'s reading, closed when it can\'t be read');
});
