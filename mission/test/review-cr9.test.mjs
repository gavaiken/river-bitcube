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
