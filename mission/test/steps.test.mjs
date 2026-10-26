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
