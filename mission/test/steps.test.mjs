// The studio chat's step lines (lib/steps.mjs): what the agent did, in the team's words; the raw line kept apart for a tooltip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTool, plainWords, BANNED } from '../lib/steps.mjs';

const bash = (description, command = 'ssh bitcube powershell -File x.ps1') => describeTool({ name: 'Bash', input: { description, command } });

test('a Bash step reads as what it did, in the past tense and the glossary words; the command is only in raw', () => {
  const cases = [
    ['Check TD fps and errors via the bridge', "checked TouchDesigner's frame rate and errors"],
    ['SSH to bitcube and run probe.ps1', 'ran the full check of bitcube'],
    ['Take a VNC screenshot of bitcube', "took a picture of bitcube's screen"],
    ['Restart TouchDesigner on river-local-oct-22-seasons.toe', "restarted TouchDesigner on the river's year"],
    ['Switch to river-online-oct-23.toe', 'switched to the live river'],
    ['Check the Modal agent status JSON', "checked Dave's agent's status"],
    ['Check bitcube is online', 'checked bitcube is online'],
    ['Look at old-river.toe', 'looked at an old show file'],
    ['Commit and push the plan', 'committed and pushed the plan'],
    ['Compare the map and light in the room', 'compared the map and light in the room'],
    ['Read the newest calibration log on bitcube', 'looked at the newest calibration log on bitcube'],
    ['Run python tools/pixelmap/screens.py', 'ran a command on bitcube'],   // the command went to bitcube
  ];
  for (const [desc, want] of cases) {
    const s = bash(desc);
    assert.equal(s.text, want, desc);
    assert.doesNotMatch(s.text, BANNED, desc);
    assert.equal(s.raw, 'ssh bitcube powershell -File x.ps1', desc);
  }
  // what can't be put in plain words falls back to a plain line, never the jargon
  for (const [desc, want] of [['Grep the PSAC10 Art-Net universes over TCP', 'ran a command'], ['ssh bitcube "tasklist"', 'ran a command on bitcube'], ['', 'ran a command']]) {
    const s = describeTool({ name: 'Bash', input: { description: desc, command: 'tasklist' } });
    assert.equal(s.text, want, desc);
  }
  assert.equal(describeTool({ name: 'Bash', input: { command: 'ssh bitcube tasklist' } }).text, 'ran a command on bitcube');
});

test('only a step that changes something on the installation is an acting line (read-only checks are not)', () => {
  for (const d of ['Check bitcube is online', 'Take a VNC screenshot of bitcube', 'List the show files', 'Read the calibration log']) assert.equal(bash(d).acting, false, d);
  for (const d of ['Restart TouchDesigner on river-local-oct-22-seasons.toe', 'Set the ropes dark', 'Switch to the live river', 'Turn the panels to 50 %', 'Stop the calibration', 'Check, then restart TD']) assert.equal(bash(d).acting, true, d);
  assert.equal(describeTool({ name: 'Edit', input: { file_path: 'td/build/build_ropes.py' } }).acting, false, 'changing a file is not acting on the installation');
});

test('the other tools: plain verbs, no paths, addresses, patterns or tool names on the line', () => {
  const d = (name, input) => describeTool({ name, input });
  assert.deepEqual(d('Read', { file_path: '/Users/river/river-bitcube/CLAUDE.md' }), { text: "looked at the repo's notes", raw: '/Users/river/river-bitcube/CLAUDE.md', acting: false });
  assert.equal(d('Read', { file_path: 'tools/mission/calibrate.py' }).text, 'looked at the calibration script');
  assert.equal(d('Edit', { file_path: 'docs/sessions/U.md' }).text, 'changed the session notes');
  assert.equal(d('Write', { file_path: 'tools/pixelmap/pixelmap-2026-10-23.json' }).text, 'changed the LED map');
  assert.equal(d('Grep', { pattern: 'fps|td\\.ok' }).text, 'searched the repo');
  assert.equal(d('Glob', { pattern: '**/*.toe' }).text, 'searched the repo');
  assert.equal(d('WebFetch', { url: 'https://to-be-a-river--river.modal.run/data/state.json' }).text, "looked at what Dave's agent is doing");
  assert.equal(d('WebFetch', { url: 'https://example.org/x' }).text, 'looked something up online');
  assert.equal(d('WebSearch', { query: 'TouchDesigner web render' }).text, 'searched the web for TouchDesigner web render');
  assert.equal(d('WebSearch', { query: 'Colorlight 5A-75 HTTP API' }).text, 'searched the web');
  assert.equal(d('TodoWrite', {}).text, 'updated its to-do list');
  assert.equal(d('Agent', { description: 'Check the ropes' }).text, 'asked a helper to check the ropes');
  assert.equal(d('ToolSearch', { query: 'x' }).text, 'used a tool');
  for (const [n, i] of [['Read', { file_path: '/x/y.md' }], ['Bash', { command: 'x'.repeat(500) }], ['WebFetch', { url: 'https://a.example/' + 'b'.repeat(400) }]]) {
    const s = d(n, i);
    assert.ok(s.text.length <= 100 && s.raw.length <= 300, n);
  }
});

test('a login in a command never reaches the line or the tooltip, even when the command is cut short', () => {
  const PW = 'rtsp://admin:NOT-A-REAL-PW@192.168.9.76:554/Preview_01_sub';
  const s = describeTool({ name: 'Bash', input: { description: 'Grab a frame', command: `${'x '.repeat(130)}ffmpeg -rtsp_transport tcp -i ${PW} -frames:v 1 a.jpg` } });
  assert.doesNotMatch(JSON.stringify(s), /NOT-A-REAL-PW|admin:/);
  const f = describeTool({ name: 'WebFetch', input: { url: 'https://user:NOT-A-REAL-PW@example.org/x' } });
  assert.doesNotMatch(JSON.stringify(f), /NOT-A-REAL-PW/);
});

test('plainWords: the copy rules applied to free text', () => {
  assert.equal(plainWords('TD is at 60 fps on river-online-oct-23.toe'), 'TouchDesigner is at 60 frames a second on the live river');
  assert.equal(plainWords('Check the HUB75 brightness'), 'Check the panels brightness');
  assert.equal(plainWords('Check the PSAC10 boxes'), 'Check the rope boxes');
  assert.equal(plainWords('Look at docs/plan.md'), 'Look at the plan');
});

test('code review: slash words are not paths, a repo step is not acting, and "ssh into" reads the same in any case', () => {
  assert.equal(describeTool({ name: 'Bash', input: { description: 'Turn ropes on/off to test box 2', command: 'x' } }).text, 'turned ropes on and off to test box 2');   // the page rewords any "/" (round 6 #20)
  assert.equal(describeTool({ name: 'Bash', input: { description: 'Save the session notes', command: 'x' } }).acting, false);
  assert.equal(describeTool({ name: 'Bash', input: { description: 'Set up a scratch folder', command: 'x' } }).acting, false);
  assert.equal(describeTool({ name: 'Bash', input: { description: 'Set the ropes dark', command: 'x' } }).acting, true);
  const a = describeTool({ name: 'Bash', input: { description: 'ssh into bitcube and check the ropes', command: 'ssh bitcube x' } }).text;
  const b = describeTool({ name: 'Bash', input: { description: 'SSH into bitcube and check the ropes', command: 'ssh bitcube x' } }).text;
  assert.equal(a, b);
});

test('round 6 #36: a login in a description, a search or a helper\'s task never reaches the step line (scrubbed before the words are made)', () => {
  const PW = 'NOT-A-REAL-PW';
  const cases = [
    ['Bash', { description: `Log in to https://admin:${PW}@192.168.9.76/cgi-bin/api.cgi`, command: 'python tools/cameras/ptz.py gallery presets' }],
    ['Bash', { description: `Fetch the snapshot from the camera (https://admin:${PW}@192.168.9.76/cgi-bin/api.cgi?cmd=Snap)`, command: 'curl -sk x' }],
    ['WebSearch', { query: `reolink login fails https://admin:${PW}@cam` }],
    ['Agent', { description: `Check https://admin:${PW}@192.168.9.76 answers` }],
    ['Bash', { description: `Grab a frame from rtsp://admin:${PW}@192.168.9.76:554/Preview_01_sub`, command: 'x' }],
    ['WebFetch', { url: `http://admin:${PW}@192.168.9.76/` }],
  ];
  for (const [name, input] of cases) {
    const s = describeTool({ name, input });
    assert.doesNotMatch(JSON.stringify(s), /NOT-A-REAL-PW|admin:/, `${name} ${JSON.stringify(input)}`);
    assert.doesNotMatch(s.text, /htt?pa? ?file|a file:/, `a URL is never cut into a "file": ${s.text}`);
  }
  assert.equal(describeTool({ name: 'Bash', input: { description: 'Log in to https://admin:x@192.168.9.76/cgi-bin/api.cgi', command: 'x' } }).text, 'log in to a web page');
  assert.equal(plainWords('See https://example.org/docs/page for it'), 'See a web page for it');
});

test('round 6 #20: a step that changes the installation never reads only "worked on it": the page shows every line as it was sent', async () => {
  const { stepWords } = await import('../public/chat-words.js');
  const shown = (s) => { const p = stepWords(s); assert.equal(p.text, s.text, `the page reworded "${s.text}"`); assert.equal(p.act, s.acting, s.text); return s; };
  const cases = [
    ['Set ropes Source=black on bitcube', 'set the ropes dark on bitcube', true],
    ['Stop RopeLights scheduled task', "stopped Will's rope lights scheduled task", true],
    ['Check modal_link status', 'checked Clips to Dave', false],
    ['Restart TD on the seasons file', "restarted TouchDesigner on the river's year", true],
    ['Pan the gallery camera left 0.2 s', 'panned the gallery camera left 0.2 s', true],
    ['Tilt the gallery camera up 0.05 s', 'tilted the gallery camera up 0.05 s', true],
    ['Set Active=True on /project1/ropes', 'changed the ropes', true],
    ['Disable the Rope_Lights task on bitcube', 'switched off something on bitcube', true],
  ];
  for (const [desc, want, acting] of cases) {
    const s = shown(bash(desc));
    assert.deepEqual([s.text, s.acting], [want, acting], desc);
  }
  // a command that changes the installation is acting whatever its description, and says what it changed
  const raw = shown(describeTool({ name: 'Bash', input: { description: 'ssh bitcube "probe.ps1 -Action ropes -Dark"', command: 'ssh bitcube powershell -File C:\\x\\probe.ps1 -Action ropes -Dark' } }));
  assert.deepEqual([raw.text, raw.acting], ['changed the ropes', true]);
  const kill = shown(describeTool({ name: 'Bash', input: { description: 'Check something', command: 'ssh bitcube "Stop-Process -Name TouchDesigner"' } }));
  assert.equal(kill.acting, true);
  // a change asked of mission control (the agent's one way, bin/mc.mjs) reads in the history's words
  const mc = (cmd) => shown(describeTool({ name: 'Bash', input: { description: 'Turn the ropes dark through mission control', command: cmd } }));
  assert.deepEqual(Object.values(mc(`node mission/bin/mc.mjs ropes '{"dark":true}'`)), ['asked mission control to turn the ropes dark', `node mission/bin/mc.mjs ropes '{"dark":true}'`, true]);
  assert.equal(mc(`node mission/bin/mc.mjs switch '{"file":"river-local-oct-22-seasons.toe"}'`).text, "asked mission control to switch TouchDesigner to the river's year");
  assert.equal(mc('node mission/bin/mc.mjs calibrate \'{"action":"start","dry_run":true}\'').text, 'asked mission control to start a dry-run calibration');
  assert.deepEqual([mc('node mission/bin/mc.mjs status').text, mc('node mission/bin/mc.mjs status').acting], ['looked at what mission control shows', false]);
  assert.equal(mc('node mission/bin/mc.mjs check').acting, false);
  // the earlier lines too: none is reworded by the page
  for (const d of ['Check TD fps and errors via the bridge', 'Take a VNC screenshot of bitcube', 'Restart TouchDesigner on river-local-oct-22-seasons.toe', 'Check the Modal agent status JSON']) shown(bash(d));
});
