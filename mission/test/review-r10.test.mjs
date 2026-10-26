// Round 10 (critics on 1e731d3, fixed on 15e7f34), the server's share: the login masks in linear time and the forms they missed;
// a calibration's own "pass" left alone; a boolean that isn't a real true or false refused; the step lines that read changes as
// checks; every live answer scrubbed; the chat's event stream with the shared headers; the login form never a GET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrubCreds, PATTERNS } from '../lib/scrub.mjs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const F = 'NOT-A-REAL-PW-r10';

// ---- #34: the calibration's own progress goes through the masks unchanged ---------------------------------------------------

test('R10 #34: a calibrate.py progress object (its pass letter, step, of, retakes) goes through scrubCreds unchanged, as an object and as JSON', () => {
  for (const pass of ['A', 'B']) {
    const p = { running: true, stage: 'ropes-capture', pass, step: 20, of: 29, retakes: 1, elapsed_s: 140, expected_s: 300, started: 1792749540, mode: 'full' };
    const cal = { ok: true, running: true, progress: p, ...p };
    assert.deepEqual(scrubCreds(cal), cal, `pass ${pass}`);
    assert.deepEqual(scrubCreds({ probe: { calibration: cal } }), { probe: { calibration: cal } });
    assert.equal(scrubCreds(JSON.stringify(cal)), JSON.stringify(cal));
    assert.equal(scrubCreds(JSON.stringify(JSON.stringify(cal))), JSON.stringify(JSON.stringify(cal)), 'escaped JSON too');
  }
});

// ---- #35: every mask in linear time --------------------------------------------------------------------------------------------

test('R10 #35: a 20,000-character run of any shape scrubs in milliseconds (no mask is quadratic), and probe.ps1 carries the same patterns', () => {
  const N = 20_000;
  const shapes = {
    letters: 'a'.repeat(N), 'letters-dashes': 'a-'.repeat(N / 2), dots: 'a.'.repeat(N / 2), digits: '1'.repeat(N), pass: 'pass'.repeat(N / 4),
    token: 'token'.repeat(N / 5), key: 'a.key'.repeat(N / 5), 'curl -u': 'curl -u '.repeat(N / 8), curl: 'curl '.repeat(N / 5), mysql: 'mysql '.repeat(N / 6),
    'mysql -p': 'mysql -x '.repeat(N / 9), scheme: 'x://'.repeat(N / 4), quotes: '"user":"a",'.repeat(N / 11), braces: '{'.repeat(N), backslashes: '\\"'.repeat(N / 2),
    smb: '//a'.repeat(N / 3), 'smb-user': '//a:'.repeat(N / 4), '-U': 'smbclient -U '.repeat(N / 13), secure: 'ConvertTo-SecureString '.repeat(N / 23),
    cookie: 'Cookie: '.repeat(N / 8), mc: 'mc='.repeat(N / 3), psk: 'psk'.repeat(N / 3), schtasks: 'schtasks /rp '.repeat(N / 13), b64: 'QUJD+/'.repeat(N / 6),
  };
  for (const [name, s] of Object.entries(shapes)) {
    const t = performance.now();
    scrubCreds(s);
    const ms = performance.now() - t;
    assert.ok(ms < 150, `${name}: ${ms.toFixed(0)} ms`);
  }
  // a URL login is still masked where the scheme starts after digits or a dash (the old pattern's leftmost match)
  for (const [line, want] of [[`x=1rtsp://admin:${F}@cam/x`, 'x=1rtsp://***@cam/x'], [`-i "rtsp://admin:${F}@192.168.9.76:554/Preview_01_main"`, '-i "rtsp://***@192.168.9.76:554/Preview_01_main"'],
                              [`a${'b'.repeat(300)}://u:${F}@h`, `a${'b'.repeat(300)}://***@h`], [`curl -s x curl -u admin:${F} y`, 'curl -s x curl -u admin:*** y']]) {
    assert.equal(scrubCreds(line), want, line);
  }
});

test('R10 #35: the studio chat scrubs a request once, when it is queued, and the queue has a limit', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Studio } = await import('../lib/studio.mjs');
  let release; const gate = new Promise((r) => { release = r; });
  const runner = async function* () { await gate; yield { kind: 'result', ok: true, text: 'done' }; };
  const s = new Studio({ runner, dir: mkdtempSync(join(tmpdir(), 'r10-studio-')) });
  s.send(`look at rtsp://admin:${F}@cam/x`);
  for (let i = 0; i < 3; i++) s.send('a'.repeat(20_000));
  const t = performance.now();
  for (let i = 0; i < 50; i++) s.status();
  assert.ok(performance.now() - t < 100, `${(performance.now() - t).toFixed(0)} ms for 50 status() calls`);
  assert.equal(s.status().current.text, 'look at rtsp://***@cam/x');
  for (let i = s.queue.length; i < 20; i++) s.send(`request ${i}`);
  assert.throws(() => s.send('one too many'), /too many requests waiting/);
  s.stop({ clear: true }); release(); await s.drained();
});

// ---- #38: the forms the masks missed ------------------------------------------------------------------------------------------

test('R10 #38: a Wi-Fi psk, an SMB login, uci batch and the other forms are masked, there and in probe.ps1', () => {
  const cases = [
    [`psk=${F}`, 'psk=***'], [`wpa_psk=${F} wpa_key=${F}`, 'wpa_psk=*** wpa_key=***'], [`{"psk":"${F}","ssid":"gray-river"}`, '{"psk":"***","ssid":"gray-river"}'],
    [`{"wpa_key":"${F}"}`, '{"wpa_key":"***"}'], [`wpa_cli set_network 0 psk "${F}"`, 'wpa_cli set_network 0 psk "***"'],
    [`mount_smbfs //user:${F}@bitcube/River /tmp/r`, 'mount_smbfs //user:***@bitcube/River /tmp/r'],
    [`mount -t smbfs //user:${F}@100.73.68.60/River /mnt`, 'mount -t smbfs //user:***@100.73.68.60/River /mnt'],
    [`smbclient //bitcube/River -U user%${F}`, 'smbclient //bitcube/River -U user%***'],
    [`uci batch <<EOF\nset wireless.default_radio0.key=${F}\ncommit wireless\nEOF`, 'uci batch <<EOF\nset wireless.default_radio0.key=***\ncommit wireless\nEOF'],
    [`wireless.default_radio0.key='${F}'`, "wireless.default_radio0.key='***'"],
    [`TS_AUTHKEY=tskey-auth-k1234-${F}`, 'TS_AUTHKEY=***'], [`tailscale up --authkey tskey-auth-k1234-${F}`, 'tailscale up --authkey ***'],
    [`tailscale up --auth-key=tskey-auth-k1234-${F}`, 'tailscale up --auth-key=***'], [`key tskey-auth-k1234-${F}`, 'key tskey-***'],
    [`ghp_${F}aaaaaaaaaaaaaaaaaaaa`, 'ghp_***'], [`github_pat_11AB${F}`, 'github_pat_***'],
    [`Cookie: mc=${F}`, 'Cookie: mc=***'], [`-H "Cookie: mc=${F}; theme=dark"`, '-H "Cookie: mc=***; theme=dark"'], [`set-cookie: mc=${F}; Path=/`, 'set-cookie: mc=***; Path=/'],
    [`mysql -u root -p'${F}' db`, 'mysql -u root -p*** db'],
    [`schtasks /create /tn snap /tr x.cmd /ru user /rp ${F} /it`, 'schtasks /create /tn snap /tr x.cmd /ru user /rp *** /it'],
    [`ConvertTo-SecureString '${F}' -AsPlainText -Force`, "ConvertTo-SecureString '***' -AsPlainText -Force"],
    [`net use \\\\bitcube\\River /user:user ${F}`, 'net use \\\\bitcube\\River /user:user ***'],
    [`curl -H "Authorization: Basic YWRtaW46${F}"`, 'curl -H "Authorization: Basic ***"'], [`Basic YWRtaW46aHVudGVyMnh5`, 'Basic ***'],
    [`{"user":"admin","pw":"${F}"}`, '{"user":"admin","pw":"***"}'], [`auth_key=${F} authkey: ${F}`, 'auth_key=*** authkey: ***'],
  ];
  for (const [line, want] of cases) assert.equal(scrubCreds(line), want, line);
  assert.deepEqual(scrubCreds({ psk: F, authkey: F, auth_key: F, pw: F, wpa_key: F, cookie: `mc=${F}`, headers: { Cookie: `mc=${F}` }, Authorization: `Bearer ${F}` }),
    { psk: '***', authkey: '***', auth_key: '***', pw: '***', wpa_key: '***', cookie: '***', headers: { Cookie: '***' }, Authorization: '***' });
  // never what isn't a login
  for (const line of ['the pw command', 'a basic check', 'Basic idea', 'encryption psk2', '"encryption":"psk2"', 'mysql -P3306 river', 'mount //bitcube/River /mnt', 'smbclient -L bitcube',
                      'ls //a/b', 'schtasks /query /tn snap', 'git log --format=%h', 'npm run build', 'ghp_short', '"keys": 3', 'cookies: 0']) {
    assert.equal(scrubCreds(line), line, line);
  }
  assert.deepEqual(scrubCreds({ encryption: 'psk2', cookies: 2, pwm: 1 }), { encryption: 'psk2', cookies: 2, pwm: 1 });
  // probe.ps1 carries the very patterns, in the same order (test/review-cr7.test.mjs; tools/tests/test_masks.py runs them)
  const src = read('../../tools/mission/probe.ps1');
  const ps = Object.fromEntries([...src.matchAll(/^\$(CRED_\w+) = '((?:[^']|'')*)'$/gm)].map((m) => [m[1], m[2].replace(/''/g, "'")]));
  for (const k of ['CREDS', 'USER', 'MYSQL', 'SMB', 'LOGIN', 'TOKEN']) assert.equal(ps[k === 'CREDS' ? 'CRED_URL' : `CRED_${k}`], PATTERNS[k], k);
});

// ---- #37: a boolean is a real JSON true or false -------------------------------------------------------------------------------

test('R10 #37: ropes dark, a dry run and a task flag are refused (400) unless a real true or false; never read as the opposite', async () => {
  const { planControl, checkedControl } = await import('../lib/mission.mjs');
  const { planCalibrate, checkedCalibrate } = await import('../lib/lights.mjs');
  assert.equal(planControl('ropes', { dark: true }).args, '-Action ropes -Dark');
  assert.equal(planControl('ropes', { dark: false }).args, '-Action ropes');
  for (const dark of ['true', 'false', 1, 0, null, {}, undefined]) {
    assert.throws(() => planControl('ropes', { dark }), (e) => e.status === 400 && /dark is true or false/.test(e.message), JSON.stringify(dark));
    assert.throws(() => checkedControl('ropes', { dark }), (e) => e.status === 400);
  }
  assert.throws(() => planControl('ropes', {}), (e) => e.status === 400);
  assert.equal(planCalibrate('start', { dry_run: false }), '-Action start');
  assert.equal(planCalibrate('start', { dry_run: true, task: false }), '-Action start -DryRun');
  for (const v of ['true', 1, 'yes', null, 0]) {
    assert.throws(() => planCalibrate('start', { dry_run: v }), (e) => e.status === 400 && /dry_run is true or false/.test(e.message), JSON.stringify(v));
    assert.throws(() => planCalibrate('start', { task: v }), (e) => e.status === 400 && /task is true or false/.test(e.message), JSON.stringify(v));
    assert.throws(() => checkedCalibrate('start', { dry_run: v }), (e) => e.status === 400);
  }
  // cancel and status take no flags: what a page sends with them is not read
  assert.equal(planCalibrate('cancel', { dry_run: 'x' }), '-Action cancel');
  // the server refuses a control body that isn't JSON (curl -d sends a form by default), on the page's route and the socket
  const src = read('../server.mjs');
  assert.match(src, /async function controlBody\(req\)/);
  assert.equal((src.match(/await controlBody\(req\)/g) ?? []).length, 2, 'both control routes read a JSON body only');
});

// ---- #39: the step lines that read changes as checks ---------------------------------------------------------------------------

const stepOf = async (command, description = 'Check it') => {
  const { describeTool } = await import('../lib/steps.mjs');
  const { stepWords } = await import('../public/chat-words.js');
  const d = describeTool({ name: 'Bash', input: { command, description } }, { running: 'river-local-oct-22-seasons.toe' });
  const shown = stepWords(d);
  assert.deepEqual([shown.text, shown.act], [d.text, d.acting], `the page reworded "${d.text}"`);
  return [d.text, d.acting];
};

test('R10 #39: a router reboot, Wi-Fi down or up, ifdown wan, a POST to the year\'s page by any client, a service, a camera reboot and the start scripts read as changes', async () => {
  const R = 'ssh root@100.127.193.8', B = 'ssh bitcube';
  const cases = [
    [`${R} reboot`, 'restarted the router'],
    [`${R} "wifi down; wifi up"`, "restarted the router's Wi-Fi"], [`${R} "wifi reload"`, "restarted the router's Wi-Fi"], [`${R} wifi`, "restarted the router's Wi-Fi"],
    [`${R} "ifdown wan && ifup wan"`, "restarted the router's network"], [`${R} "ubus call network.interface.wan down"`, "restarted the router's network"],
    [`${R} "ubus call repeater stop"`, "changed the router's settings"], [`${R} "crontab -r"`, "changed the router's scheduled jobs"],
    ['curl --json \'{"mode":"manual"}\' http://100.73.68.60:9981/mode', "changed the river's year"],
    ['wget --post-data \'{"mode":"manual"}\' http://100.73.68.60:9981/mode', "changed the river's year"],
    ['http POST http://100.73.68.60:9981/mode mode=manual', "changed the river's year"],
    ['python3 -c "import requests; requests.post(\'http://100.73.68.60:9981/mode\', json={\'mode\':\'manual\'})"', "changed the river's year"],
    [`${B} "Stop-Service Tailscale"`, 'changed a service on bitcube'], [`${B} "Restart-Service sshd"`, 'changed a service on bitcube'],
    [`${B} "Set-ItemProperty HKCU:\\x -Name y -Value z"`, "changed bitcube's settings"], [`${B} "powercfg /change standby-timeout-ac 10"`, "changed bitcube's settings"],
    ['curl -k "https://192.168.9.76/cgi-bin/api.cgi?cmd=Reboot&token=abc"', 'restarted a camera'],
    [`${B} "C:\\Users\\user\\River\\river-bitcube\\Start-Modal.cmd"`, 'started Clips to Dave'],
    [`${B} "C:\\Users\\user\\River\\river-bitcube\\Start-Presence.cmd"`, 'started the people counter'],
    [`${B} "schtasks /create /tn x /tr C:\\Users\\user\\River\\river-bitcube\\Start-Modal.cmd /sc once /st 00:00"`, 'changed a scheduled task on bitcube'],
  ];
  for (const [cmd, words] of cases) assert.deepEqual(await stepOf(cmd), [words, true], cmd);
  // reads stay reads
  for (const cmd of [`${R} "uci show wireless"`, `${R} "cat /tmp/river-wan/status"`, `${R} "crontab -l"`, `${R} "logread | grep reboot"`, `${R} "ubus call network.interface.wan status"`,
                     'curl http://100.73.68.60:9981/state', 'wget -qO- http://100.73.68.60:9981/state', 'http GET http://100.73.68.60:9981/state',
                     'python3 -c "import requests; print(requests.get(\'http://100.73.68.60:9981/state\').json())"', `${B} "Get-Service Tailscale"`,
                     `${B} "Get-ItemProperty HKCU:\\x"`, `${B} "powercfg /query"`, `${B} "type C:\\Users\\user\\River\\river-bitcube\\Start-Modal.cmd"`,
                     `${B} "schtasks /query /tn RopeLights"`, 'curl -k "https://192.168.9.76/cgi-bin/api.cgi?cmd=Snap&token=abc"']) {
    assert.equal((await stepOf(cmd))[1], false, cmd);
  }
});

// ---- #40, #41: every live answer scrubbed; the event stream's headers -----------------------------------------------------------

test('R10 #40: /api/lights, its raw error, the 503 raws, the year page\'s answer and the map\'s remote error go through scrubCreds', () => {
  const src = read('../server.mjs');
  assert.match(src, /function plainLightsError\(raw\) \{\n  const s = scrubCreds\(String\(raw \?\? ''\)\);/);
  assert.match(src, /return send\(res, 200, scrubFrames\(r\)\);/);
  assert.match(src, /raw: scrubCreds\(r\?\.error \?\? null\)/);
  assert.match(src, /map = \{ file: summary\.file, error: scrubCreds\(remote\?\.error \?\? 'could not fetch the map from bitcube'\) \}/);
  assert.match(read('../lib/mission.mjs'), /if \(plan\.kind === 'seasons'\) return scrubCreds\(await this\.#seasons\(plan\.path, plan\.body\)\);/);
  assert.match(src, /return send\(res, e\.status \|\| 500, \{ error: scrubCreds\(e\.message\) \}\);/);
});

test('R10 #41: the chat\'s event stream carries the shared security headers', () => {
  assert.match(read('../server.mjs'), /res\.writeHead\(200, \{ \.\.\.SECURITY, 'content-type': 'text\/event-stream'/);
});

// ---- #36: the login form never submits the password in a URL --------------------------------------------------------------------

test('R10 #36: the login form posts, and its handler needs no import: a page whose scripts failed still never sends the password as a GET', () => {
  const html = read('../public/login.html');
  assert.match(html, /<form class="card" id="f" method="post" action="\/login" novalidate>/);
  const classic = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  assert.match(classic, /f\.addEventListener\('submit'/, 'the submit handler is in a classic script');
  assert.doesNotMatch(classic, /\bimport\b/);
  const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.doesNotMatch(mod, /addEventListener\('submit'/);
});

// ---- the server itself: a native login form, a control's form body, the event stream's headers ----------------------------------

test('R10 #36, #37, #41: on a running server, a native login form is redirected, a control body that is a form or not a real boolean is refused, and the event stream has the headers', async (t) => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'r10-server-'));
  writeFileSync(join(dir, 'pw'), 'test-password\n');
  const env = { ...process.env, MISSION_PORT: '0', MISSION_STATE_DIR: join(dir, 'state'), MISSION_PASSWORD_FILE: join(dir, 'pw'),
                MISSION_FIXTURES: fileURLToPath(new URL('./fixtures', import.meta.url)), MISSION_FAKE_AGENT: '1', MISSION_FAKE_AGENT_DELAY_MS: '1' };
  delete env.MISSION_CONTROL_SOCKET;
  const p = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => p.kill());
  const base = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(out)), 20_000);
    p.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve(m[0]); } });
  });
  const form = (path, body, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } });
  // the login page's own form, posted by the browser: a redirect, never JSON, never the password in a URL
  const bad = await form('/login', 'password=wrong', { 'x-forwarded-for': '10.9.9.9' });     // another address: its wait is its own
  assert.deepEqual([bad.status, bad.headers.get('location')], [303, '/login?failed=wrong']);
  const good = await form('/login', 'password=test-password');
  assert.deepEqual([good.status, good.headers.get('location')], [303, '/status']);
  const cookie = good.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^mc=/);
  const json = (path, body) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie } });
  // a control's body: a form is refused; so is a dark that isn't a real boolean; a real one runs
  const f = await form('/api/control/ropes', 'dark=true', { cookie });
  assert.equal(f.status, 400);
  assert.match((await f.json()).error, /must be JSON/);
  assert.equal((await json('/api/control/ropes', { dark: 'true' })).status, 400);
  assert.equal((await json('/api/control/ropes', {})).status, 400);
  assert.equal((await json('/api/control/calibrate', { action: 'start', dry_run: 'true' })).status, 400);
  assert.equal((await json('/api/control/ropes', { dark: false })).status, 200);
  // the chat's event stream: the shared security headers
  const ctrl = new AbortController();
  const ev = await fetch(`${base}/api/chat/events`, { headers: { cookie }, signal: ctrl.signal });
  assert.deepEqual(['x-content-type-options', 'referrer-policy', 'x-frame-options', 'content-type'].map((h) => ev.headers.get(h)),
    ['nosniff', 'same-origin', 'DENY', 'text/event-stream']);
  ctrl.abort();
});
