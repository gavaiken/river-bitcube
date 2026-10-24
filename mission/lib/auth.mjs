// Shared-password login for mission control (docs/mission-plan.md, MD1).
// The password is read from a file (never logged), kept only as a scrypt hash, compared in constant time.
// Sessions are random cookies; their SHA-256 is what's stored on disk, so the file can't be replayed.
// Wrong guesses slow down: per client the delay doubles (1 s, 2 s, 4 s ... capped at 60 s), and after many
// failures in a short window everyone is slowed, so a distributed guesser gains little.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SESSION_DAYS = 30;
const MAX_DELAY_MS = 60_000;
const GLOBAL_WINDOW_MS = 10 * 60_000;
const GLOBAL_LIMIT = 30;
// one counted guess per GLOBAL_WINDOW_MS / GLOBAL_LIMIT (20 s) once the window is full: the same 30-per-10-min cap as a
// lockout gives, without ever locking the team out for more than seconds
const GLOBAL_DELAY_MS = GLOBAL_WINDOW_MS / GLOBAL_LIMIT;

export function readPasswordFile(path) {
  const pw = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  if (!pw) throw new Error(`password file ${path} is empty`);
  return pw;
}

export class Auth {
  constructor({ password, sessionsFile, now = () => Date.now() }) {
    this.salt = randomBytes(16);
    this.hash = scryptSync(password, this.salt, 32);
    this.sessionsFile = sessionsFile;
    this.now = now;
    this.failures = new Map();       // client -> { count, last }
    this.recent = [];                // times of recent failures (all clients)
    this.sessions = new Map();       // sha256(token) -> expiry ms
    this.#load();
  }

  check(password) {
    const h = scryptSync(String(password ?? ''), this.salt, 32);
    return timingSafeEqual(h, this.hash);
  }

  /** How long this client must wait before its next attempt counts (ms). */
  delayFor(client) {
    const t = this.now();
    this.recent = this.recent.filter((x) => t - x < GLOBAL_WINDOW_MS);
    const f = this.failures.get(client);
    let wait = 0;
    if (f && f.count > 0) wait = Math.max(0, f.last + Math.min(MAX_DELAY_MS, 1000 * 2 ** (f.count - 1)) - t);
    // many failures from everywhere: everyone waits 20 s after the LAST failure (a slowdown, never a lockout:
    // throttled tries don't count, so a burst of guesses can't keep the team out for the whole window)
    if (this.recent.length >= GLOBAL_LIMIT) wait = Math.max(wait, this.recent[this.recent.length - 1] + GLOBAL_DELAY_MS - t);
    return wait;
  }

  /** Try a login. Returns {ok, token?, wait?}. */
  login(client, password) {
    const wait = this.delayFor(client);
    if (wait > 0) return { ok: false, wait, throttled: true };
    if (!this.check(password)) {
      const f = this.failures.get(client) ?? { count: 0, last: 0 };
      f.count += 1; f.last = this.now();
      this.failures.set(client, f);
      this.recent.push(this.now());
      return { ok: false, wait: this.delayFor(client) };
    }
    this.failures.delete(client);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(sha(token), this.now() + SESSION_DAYS * 86_400_000);
    this.#save();
    return { ok: true, token };
  }

  valid(token) {
    if (!token) return false;
    const e = this.sessions.get(sha(token));
    if (!e) return false;
    if (e < this.now()) { this.sessions.delete(sha(token)); this.#save(); return false; }
    return true;
  }

  logout(token) {
    if (token && this.sessions.delete(sha(token))) this.#save();
  }

  #load() {
    if (!this.sessionsFile) return;
    try {
      const d = JSON.parse(readFileSync(this.sessionsFile, 'utf8'));
      for (const [k, v] of Object.entries(d)) if (v > this.now()) this.sessions.set(k, v);
    } catch { /* first start */ }
  }

  #save() {
    if (!this.sessionsFile) return;
    mkdirSync(dirname(this.sessionsFile), { recursive: true });
    writeFileSync(this.sessionsFile, JSON.stringify(Object.fromEntries(this.sessions)), { mode: 0o600 });
  }
}

export const SESSION_MAX_AGE_S = SESSION_DAYS * 86_400;

function sha(s) { return createHash('sha256').update(s).digest('hex'); }

/** Who is asking, for the per-client backoff. Funnel forwards the visitor's address; locally it's the socket's. The LAST
 *  X-Forwarded-For entry is the one the proxy in front of us added; earlier entries are whatever the client claimed, so a
 *  rotating header can't reset its own backoff. */
export function clientOf(xff, socketAddr) {
  const parts = String(xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(socketAddr || '?');
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
