import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTool, DENIED, ALLOWED } from '../lib/agent.mjs';

test('tool activity lines are short and readable: plain words on the line, the raw input apart (lib/steps.mjs)', () => {
  assert.deepEqual(describeTool({ name: 'Bash', input: { command: 'ssh bitcube dir', description: 'List files on bitcube' } }), { text: 'listed files on bitcube', raw: 'ssh bitcube dir', acting: false });
  assert.deepEqual(describeTool({ name: 'Read', input: { file_path: '/x/y.md' } }), { text: 'looked at the docs', raw: '/x/y.md', acting: false });
  assert.ok(describeTool({ name: 'Bash', input: { command: 'x'.repeat(500) } }).text.length < 100);
});

test('the fence denies sudo, Tailscale and Gavin\'s files', () => {
  for (const r of ['Bash(sudo:*)', 'Bash(tailscale:*)', 'Read(/Users/gav/**)', 'Bash(signal-cli:*)']) assert.ok(DENIED.includes(r), r);
  assert.ok(ALLOWED.includes('Bash'));
});
