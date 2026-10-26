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
