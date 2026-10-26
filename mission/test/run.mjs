#!/usr/bin/env node
// `npm test`: node --test over test/, with the fixtures' test visualization added to the show registry
// (MISSION_SHOWS_EXTRA = test/fixtures/_shows.extra.json; model.js registryPaths), so the viz-running fixture reads as a
// listed show. Works the same on the Mac mini, in CI and in Git Bash on bitcube (no shell syntax in package.json).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env, MISSION_SHOWS_EXTRA: process.env.MISSION_SHOWS_EXTRA || join(HERE, 'fixtures', '_shows.extra.json') };
const r = spawnSync(process.execPath, ['--test', ...(process.argv.slice(2).length ? process.argv.slice(2) : ['test/*.test.mjs'])],
  { stdio: 'inherit', env, cwd: join(HERE, '..') });
process.exit(r.status ?? 1);
