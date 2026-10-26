// Studio chat's words (public/chat-words.js): a request's state from its events and the live status, the activity lines in
// the team's words, and the steps toggle's accessible name. Pure functions, shared by chat.js and these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateOf, plainStep, stepWords, stepsToggle } from '../public/chat-words.js';

// Words the team should never read on the main view (docs/mission-ui.md, "Copy rules"), and code-looking text.
const JARGON = /\b(TD|fps|tcp|ssh|vnc|rtsp|psac10|probe|oserror|art-?net|artnet|wmi|http|https|json|undefined|null|epoch|toe|bridge|Modal|ToolSearch|ffmpeg|pixelmap|Colorlight|Reolink)\b/;
const CODEY = /[|\\{}=`$<>]|\.(ps1|py|toe|json|mjs|js|md|sh|cmd)\b|https?:|\/\w|\w_\w|\b[a-z]+[A-Z]\w*\b/;

test('stateOf: a "started" that arrives before the status listing its request is working, never "Not finished" (R5 #14)', () => {
  // the status the page holds is from before the request: not running, nothing queued
  const old = { running: false, current: null, queue: [] };
  const statusAt = 1000;
  const r = { id: 'a', t: 1, text: 'hello', steps: [], texts: [], notices: [], arrivedAt: 1001, started: 2, startedArrivedAt: 1002 };
  assert.equal(stateOf(r, old, { statusAt }).s, 'working');
  // once a newer status says nothing is running and gives no verdict, it is not finished (the server moved on)
  assert.equal(stateOf(r, old, { statusAt: 1003 }).s, 'unknown');
  // history loaded in one go: the events came before the status that came with them
  const h = { ...r, arrivedAt: 10, startedArrivedAt: 10 };
  assert.equal(stateOf(h, old, { statusAt: 11 }).s, 'unknown');
  // the round 3 rule still holds for the 'user' event alone: waiting for the status that lists it
  const u = { id: 'b', t: 1, text: 'hi', steps: [], texts: [], notices: [], arrivedAt: 1001 };
  assert.deepEqual(stateOf(u, old, { statusAt }), { s: 'waiting', place: null });
  assert.equal(stateOf(u, old, { statusAt: 1002 }).s, 'unknown');
  // the live status decides when it lists it
  assert.equal(stateOf(r, { running: true, current: { id: 'a' }, queue: [] }, { statusAt: 5000 }).s, 'working');
  assert.deepEqual(stateOf(u, { running: true, current: { id: 'a' }, queue: [{ id: 'x' }, { id: 'b' }] }, { statusAt: 5000 }), { s: 'waiting', place: 2 });
  // its own events decide first
  assert.equal(stateOf({ ...r, result: { ok: true, t: 9 } }, old, { statusAt }).s, 'done');
  assert.equal(stateOf({ ...r, stopped: 9 }, old, { statusAt }).s, 'stopped');
  assert.equal(stateOf({ ...r, failed: { t: 9, text: "bitcube didn't answer" } }, old, { statusAt }).reason, "bitcube didn't answer");
  // while the stream is lost nothing is judged "not finished"
  assert.equal(stateOf({ ...r, startedArrivedAt: 10 }, old, { statusAt: 11, lost: true }).s, 'working');
});

test('plainStep: the agent\'s tool lines in the team\'s words, never its working words (R5 #21)', () => {
  const cases = [
    ['ran: Check TD fps and errors via the bridge', /^checked TouchDesigner/, false],
    ['ran: SSH to bitcube and run probe.ps1', /^ran the full check on bitcube$/, false],
    ['ran: Take a VNC screenshot of bitcube', /^took a picture of bitcube's screen$/, false],
    ['ran: Run td.ps1 to set Source=black on artnet_out', /^ran the TouchDesigner script/, true],
    ['ran: Restart TouchDesigner on river-local-oct-22-seasons.toe', /^restarted TouchDesigner on the river's year$/, true],
    ['ran: Fetch Modal state JSON', /^fetched Dave's agent's state$/, false],
    ['ran: Check bitcube is online', /^checked bitcube is online$/, false],
    ['searched for fps|td\\.ok', /^searched the repo$/, false],
    ['fetched https://to-be-a-river--river.modal.run/data/state.json', /^looked at what Dave's agent posted$/, false],
    ['fetched https://example.com/a?b=c', /^looked something up online$/, false],
    ['used ToolSearch', /^used a tool$/, false],
    ['read CLAUDE.md', /^looked at the repo's notes$/, false],
    ['edited docs/sessions/U.md', /^changed the session notes$/, false],
    ['ran: ssh bitcube "powershell -File C:\\river\\tools\\td.ps1 -Action ropes -Dark"', /^ran a command on bitcube$/, true],
    ['ran: git log -3', /^ran a command$/, false],
    ['ran: Turn the ropes dark', /^turned the ropes dark$/, true],
    ['ran: Set the panels to 50 % brightness', /^set the panels to 50 % brightness$/, true],
    ['ran: Check whether TouchDesigner stopped', /^checked whether TouchDesigner stopped$/, false],
    ['ran: Check the PSAC10 boxes answer on 2.0.0.10', /^checked the rope boxes answer/, false],
    ['ran: Grab a frame from the Reolink over RTSP', /^grabbed a frame from the (gallery )?camera/, false],
    ['searched the web: TouchDesigner Art-Net universe limits', /^searched the web/, false],
    ['asked a helper: Look at the TD log for errors', /^asked a helper to look at the TouchDesigner log for errors$/, false],
    ['updated its to-do list', /^updated its to-do list$/, false],
    ['synced the repo: 3d7bc23 mission-ui: applying a change', /^brought its copy of the repo up to date$/, false],
    ['ran: Check that 60 fps holds', /^checked that 60 frames a second holds$/, false],
    ['ran: Query WMI for the display names', /^queried/, false],
  ];
  for (const [raw, want, act] of cases) {
    const p = plainStep(raw);
    assert.match(p.text, want, `${raw} → ${p.text}`);
    assert.equal(p.act, act, `${raw}: acting ${p.act}`);
    assert.doesNotMatch(p.text, JARGON, `${raw} → ${p.text}`);
    assert.doesNotMatch(p.text, CODEY, `${raw} → ${p.text}`);
  }
  // whatever the agent writes, nothing raw or jargon reaches the line
  for (const raw of ['ran: Run Get-CimInstance Win32_DesktopMonitor', 'ran: curl -s http://100.126.113.14:8790/api/status | jq .probe',
    'ran: Look at C:\\river\\logs\\probe.log', 'ran: Check the TCP port 22 and the HTTP 9981 page', 'ran: Read state.json from Modal',
    'ran: Ping 192.168.8.217', 'used mcp__claude_ai__thing', 'fetched http://10.0.7.203:8790/', 'ran: Tail the ffmpeg log for the pixelmap capture']) {
    const p = plainStep(raw);
    assert.ok(p.text.length > 0, raw);
    assert.doesNotMatch(p.text, JARGON, `${raw} → ${p.text}`);
    assert.doesNotMatch(p.text, CODEY, `${raw} → ${p.text}`);
    assert.doesNotMatch(p.text, /\d+\.\d+\.\d+\.\d+|:\d{2,5}\b/, `${raw} → ${p.text}`);
  }
});

test('stepWords: the old shape (a raw line) and the new one (plain words with the raw line beside them) both read plainly', () => {
  // old: text is the raw describeTool line; it goes to the tooltip, the words are worked out here
  const o = stepWords({ kind: 'activity', text: 'ran: Restart TouchDesigner on river-local-oct-22-seasons.toe' });
  assert.equal(o.text, "restarted TouchDesigner on the river's year");
  assert.equal(o.title, 'ran: Restart TouchDesigner on river-local-oct-22-seasons.toe');
  assert.equal(o.act, true);
  // new: the server already sends the team's words, and the raw line beside them
  const n = stepWords({ kind: 'activity', text: 'looked at bitcube', raw: 'ran: Check bitcube is online' });
  assert.deepEqual(n, { text: 'looked at bitcube', title: 'ran: Check bitcube is online', act: false });
  // its own act flag wins; without one, only a change to the installation is highlighted
  assert.equal(stepWords({ text: 'checked the ropes', raw: 'x', act: true }).act, true);
  // lib/steps.mjs names the flag `acting`: it wins the same way, in both directions
  assert.equal(stepWords({ text: 'checked the ropes', raw: 'x', acting: true }).act, true);
  assert.equal(stepWords({ text: 'turned the ropes dark', raw: 'x', acting: false }).act, false);
  assert.equal(stepWords({ text: 'turned the ropes dark', raw: 'x' }).act, true);
  assert.equal(stepWords({ text: 'looked at the ropes', raw: 'x' }).act, false);
  // the server's words still pass the same guard (a slip never shows a file name)
  const g = stepWords({ text: 'ran probe.ps1 on bitcube', raw: 'ran: probe.ps1' });
  assert.doesNotMatch(g.text, CODEY);
  // and a missing text never shows "undefined"
  assert.doesNotMatch(stepWords({ kind: 'activity' }).text, /undefined|null/);
});

test('stepsToggle: the accessible name starts with the visible words (label in name, R5 #15)', () => {
  const a = stepsToggle(2, 1, 'hello');
  assert.equal(a.visible, '2 steps more');
  assert.equal(a.label, '2 steps more, for ‘hello’');
  assert.ok(a.label.startsWith(a.visible));
  const b = stepsToggle(1, 0, 'Turn the ropes dark please, and then check the panels are still showing the river');
  assert.equal(b.visible, '1 step');
  assert.ok(b.label.startsWith('1 step, for ‘Turn the ropes dark'));
  assert.ok(b.label.length < 80);
  assert.equal(stepsToggle(3, 0, '').label, '3 steps, for ‘this request’');
});
