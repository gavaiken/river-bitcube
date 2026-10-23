import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTool, DENIED, ALLOWED } from '../lib/agent.mjs';

test('tool activity lines are short and readable', () => {
  assert.equal(describeTool({ name: 'Bash', input: { command: 'ssh bitcube dir', description: 'List files on bitcube' } }), 'ran: List files on bitcube');
  assert.equal(describeTool({ name: 'Read', input: { file_path: '/x/y.md' } }), 'read /x/y.md');
  assert.ok(describeTool({ name: 'Bash', input: { command: 'x'.repeat(500) } }).length < 100);
});

test('the fence denies sudo, Tailscale and Gavin\'s files', () => {
  for (const r of ['Bash(sudo:*)', 'Bash(tailscale:*)', 'Read(/Users/gav/**)', 'Bash(signal-cli:*)']) assert.ok(DENIED.includes(r), r);
  assert.ok(ALLOWED.includes('Bash'));
});
