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

