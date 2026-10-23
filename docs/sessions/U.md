---
title: Session U (mission control UI v2)
---

# Session U: mission control UI v2 (Mac mini · Claude Code)

Redesign and rebuild of **mission control** (`mission/`) so anyone on the team, on a phone in the dark gallery, can tell within five seconds whether the show is OK and, if not, what is wrong and what to do. Brief: `~/claude/docs/river-ui-v2-prompt.md` (Gavin, 23 Oct). Design write-up: [`docs/mission-ui.md`](../mission-ui.md) (written in step U3).

## 2026-10-23 03:00 start: Mac mini · Claude Code
Working in worktree `.worktrees/ui-v2`, pushing to `main` (`git pull --rebase` first). Dev server on port 8791 with the fake agent and its own state dir under `~/claude/local/ui-shots`; screenshots with Playwright (Google Chrome) at iPhone, iPad and desktop sizes in both themes. Hard rules: never trigger a control on the real installation; never touch the live service, the `river` user, Tailscale or anything needing sudo; every push to `main` is a complete working state (`npm test` green, a clean checkout starts and serves every page).

Planned steps:
- **U1** Groundwork: fixture mode in the server (`MISSION_FIXTURES=<dir>`: recorded `/api/status` scenarios, controls become logged no-ops, placeholder camera stills), unauthenticated `GET /version`, the screenshot harness, 13 hand-written scenarios (all good, bitcube offline, TD frozen, TD low fps, river cam stale, gallery cam down, Modal scene old, ropes dark on purpose, just booted, nothing known yet, lights not connected, seasons not running, no internet).
- **U2** Understand: screenshot every page in every scenario; audit as Colin, Justine, Will, Dave, Andi, Lilian and a Gray Area staffer; ranked problem list.
- **U3** Design: information architecture, three directions as working prototypes on the fixtures, judge panel, one synthesized design; `docs/mission-ui.md` (principles, IA, status vocabulary, copy rules, design tokens).
- **U4** Build page by page; ship to `main` as soon as it beats the old UI, then keep improving.
- **U5** Adversarial review loops (mobile and touch, accessibility, copy, correctness, security) until two rounds in a row find nothing major.
- **U6** Finish: confirm `/version` on the live site, before/after Artifact, update `docs/mission-plan.md` (progress log, "UI v2" section), `docs/execution-plan.md`, SESSION SUMMARY here.

- 04:00 U1 ✅ groundwork: fixture mode (`MISSION_FIXTURES`), `GET /version`, `planControl` whitelist, fake-agent moods, tests 24 pass; harness `~/claude/local/ui-shots/shots.mjs` (Playwright on Google Chrome: 13 scenarios × 4 pages × 3 viewports × 2 themes × fold/full = 643 baseline PNGs); 13 scenario fixtures with an `expect` block each; `preflight.sh` (clean checkout of a commit: `npm ci`, start with the fake agent, every page 200) passed on the commit (commit 3ce16ea)
