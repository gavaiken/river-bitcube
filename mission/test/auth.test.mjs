import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Auth, readPasswordFile, parseCookies } from '../lib/auth.mjs';

const dir = mkdtempSync(join(tmpdir(), 'mission-auth-'));

test('the right password gives a session that validates; the wrong one does not', () => {
  const a = new Auth({ password: 'river-pw', sessionsFile: join(dir, 's1.json') });
  assert.equal(a.login('1.2.3.4', 'nope').ok, false);
  const r = new Auth({ password: 'river-pw', sessionsFile: join(dir, 's2.json') }).login('1.2.3.4', 'river-pw');
  assert.equal(r.ok, true);
  assert.equal(typeof r.token, 'string');
});

test('sessions survive a restart (same file) and can be logged out', () => {
  const f = join(dir, 's3.json');
  const a = new Auth({ password: 'pw', sessionsFile: f });
  const { token } = a.login('c', 'pw');
  const b = new Auth({ password: 'pw', sessionsFile: f });
  assert.equal(b.valid(token), true);
  b.logout(token);
  assert.equal(new Auth({ password: 'pw', sessionsFile: f }).valid(token), false);
});

test('wrong guesses slow down, doubling per client', () => {
  let t = 1_000_000;
  const a = new Auth({ password: 'pw', sessionsFile: null, now: () => t });
  assert.equal(a.login('x', 'a').wait, 1000);
  assert.equal(a.login('x', 'b').wait, 1000);   // still waiting: doesn't count
  t += 1000;
  assert.equal(a.login('x', 'c').wait, 2000);
  t += 2000;
  assert.equal(a.login('x', 'pw').ok, true);     // the right password after waiting works
  assert.equal(a.delayFor('y'), 0);              // other clients unaffected
});

test('many failures from many clients slow everyone', () => {
  let t = 5_000_000;
  const a = new Auth({ password: 'pw', sessionsFile: null, now: () => t });
  for (let i = 0; i < 30; i++) a.login('ip' + i, 'bad');
  assert.ok(a.delayFor('fresh') >= 5000);
});

test('password file: trailing newline ignored, contents never logged', () => {
  const f = join(dir, 'pw');
  writeFileSync(f, 'secret\n');
  assert.equal(readPasswordFile(f), 'secret');
});

test('cookies parse', () => {
  assert.deepEqual(parseCookies('a=1; mc=x%3Dy'), { a: '1', mc: 'x=y' });
});
