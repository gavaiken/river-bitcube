// Round 7, the second fixer's share (docs/mission-ui.md): the scrubber's password fields, the chat's step lines for the panels and
// for a status read chained to a direct change, the chat can't stop a calibration through the socket, the fixtures' time left,
// Recent's lines for a restart, a dry run that locks nothing on the lights, one name per change, the 409's past tense.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubCreds } from '../lib/scrub.mjs';
import { describeTool } from '../lib/steps.mjs';

const YEAR = 'river-local-oct-22-seasons.toe', LIVE = 'river-online-oct-23.toe';
const bash = (command, description = '') => describeTool({ name: 'Bash', input: { description, command } });

test('R7 #37: a password, token or secret in a JSON body, an escaped JSON body or a query is masked, not only a URL login', () => {
  const cases = [
    ['[{"cmd":"Login","param":{"User":{"userName":"admin","password":"hunter2"}}}]', '[{"cmd":"Login","param":{"User":{"userName":"admin","password":"***"}}}]'],
    ['curl -sk "https://192.168.9.76/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=x&user=admin&password=hunter2r7" -o a.jpg',
     'curl -sk "https://192.168.9.76/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=x&user=admin&password=***" -o a.jpg'],
    ['{"password":"x"} ?password=x', '{"password":"***"} ?password=***'],
    ['body \'{\\"password\\":\\"p@ss w\\"}\'', 'body \'{\\"password\\":\\"***\\"}\''],
    ["{'passwd': 'secret one', 'pwd': 'two'}", "{'passwd': '***', 'pwd': '***'}"],
    ['token=abc123&x=1 secret: s3cr3t; Token = "t"', 'token=***&x=1 secret: ***; Token = "***"'],
    ['rtsp://admin:pw@10.0.0.1/x', 'rtsp://***@10.0.0.1/x'],
  ];
  for (const [raw, want] of cases) assert.equal(scrubCreds(raw), want, raw);
  // never what merely looks like one: input_tokens, a passwords file, a word in a sentence
  for (const keep of ['"input_tokens": 1234', 'the passwords file is untracked', 'no token here', 'secrets.local.json', 'cd $PWD/x']) assert.equal(scrubCreds(keep), keep);
  // deep, as before
  assert.deepEqual(scrubCreds({ a: ['user=admin&password=x'], b: { c: '"token": "y"' } }), { a: ['user=admin&password=***'], b: { c: '"token": "***"' } });
  // and a step's raw tooltip (what reaches every phone)
  assert.doesNotMatch(bash('curl -sk "https://192.168.9.76/cgi-bin/api.cgi?cmd=Snap&user=admin&password=hunter2r7" -o a.jpg').raw, /hunter2r7/);
  assert.doesNotMatch(bash(`curl -sk -d '[{"cmd":"Login","param":{"User":{"userName":"admin","password":"hunter2"}}}]' https://192.168.9.76/cgi-bin/api.cgi`).raw, /hunter2/);
});

test('R7 #22: a panels change asked of mission control reads as a change and is an acting line', () => {
  for (const [cmd, desc] of [[`node mission/bin/mc.mjs hub75 '{"brightness":0}'`, 'Panels off'], [`node mission/bin/mc.mjs hub75 '{"brightness":0}'`, ''],
                             [`node mission/bin/mc.mjs hub75 '{"brightness":0.5}'`, 'Ask mission control to set HUB75 brightness 0.5']]) {
    const s = bash(cmd, desc);
    assert.equal(s.acting, true, `${cmd} / ${desc}`);
    assert.match(s.text, /^asked mission control to set the panel brightness to (0|50) %$/, `${cmd} / ${desc}`);
  }
});

test('R7 #34: a status read chained to a change made directly on bitcube is an acting line that says so', () => {
  const cases = [
    [`node mission/bin/mc.mjs status && ssh bitcube powershell -File C:\\x\\probe.ps1 -Action switch -BootFile ${LIVE}`, /show file/],
    ['node mission/bin/mc.mjs check; ssh bitcube "powershell -File C:\\x\\probe.ps1 -Action ropes -Dark"', /ropes/],
    [`node mission/bin/mc.mjs calibrate '{"action":"status"}' ; ssh bitcube "powershell -File C:\\x\\calibrate.ps1 -Action cancel"`, /calibration/],
    ['node mission/bin/mc.mjs status\nssh bitcube "powershell -File C:\\x\\probe.ps1 -Action hub75 -Brightness 0"', /panels/],
  ];
  for (const [cmd, what] of cases) {
    const s = bash(cmd, 'Look at what mission control shows');
    assert.equal(s.acting, true, cmd);
    assert.match(s.text, what, cmd);
    assert.match(s.text, /on bitcube directly, not through mission control$/, cmd);
  }
  // a status read and a change, both through mission control: still the change, in the history's words (R6)
  const both = bash(`node mission/bin/mc.mjs status && node mission/bin/mc.mjs switch '{"file":"${LIVE}"}'`, 'Check, then switch');
  assert.deepEqual([both.text, both.acting], ['asked mission control to switch TouchDesigner to the live river', true]);
  // a status read piped to a filter changes nothing
  assert.deepEqual(Object.values(bash('node mission/bin/mc.mjs status | head -20', 'Look')).filter((v) => typeof v !== 'string' || !v.includes('node')), ['looked at what mission control shows', false]);
  // a separator inside the JSON body is not a second command
  const quoted = bash(`node mission/bin/mc.mjs rules '{"rules":{"note":"a; b && c"}}'`, '');
  assert.equal(quoted.acting, true);
  assert.match(quoted.text, /^asked mission control to change/);
  void YEAR;
});

test('R7 #32: fixture mode serves a calibration copy as read now, so its time left is the run\'s own', async () => {
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const { FixtureMission } = await import('../lib/fixtures.mjs');
  const { derive } = await import('../public/model.js');
  let t = 1_792_749_540_000;
  const fm = new FixtureMission({ dir: new URL('./fixtures/', import.meta.url).pathname, stateDir: mkdtempSync(join(tmpdir(), 'fx-')), now: () => t, calibrateS: 60 });
  assert.equal((await fm.calibrate('start', {}, { scenario: 'all-good' })).ok, true);
  t += 1000;
  const snap = fm.snapshot('all-good');
  assert.equal(snap.probe.value.calibration.read_age_s, 0);
  const left = derive(snap, snap.now).show.calibration.left_s;
  assert.ok(left > 200, `the run's own time left (scaled to a real run), not the full check's age off it: ${left}`);
  const real = derive({ ...snap, probe: { ...snap.probe, value: { ...snap.probe.value, calibration: { ...snap.probe.value.calibration, read_age_s: undefined } } } }, snap.now).show.calibration.left_s;
  assert.ok(left > real || snap.probe.age_s === 0, 'without it the copy would be aged by the full check');
});
