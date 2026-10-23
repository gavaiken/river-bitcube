---
title: "Mission control and the studio chat: plan"
---

# Mission control and the studio chat: plan

**Read this first if you are picking this work up.** Terms (**mission control**, **studio chat**) are in [`GLOSSARY.md`](https://github.com/gavaiken/river-bitcube/blob/main/GLOSSARY.md). Steps M1… are also in the [execution plan](execution-plan.md); mark them there **and** in the progress log at the bottom of this page after every step, then commit and push. Decided with Gavin on 22 Oct 2026 (session A, Mac mini).

## What we are building
A small web app on the Mac mini, online at **`https://gav-m1-mini.tailddc624.ts.net`** (Tailscale Funnel, port 443), behind **one shared team password**:
1. **Studio chat:** one long-running conversation with the team's Claude agent. A single text box: whoever has the page types into it, like being handed the laptop. **Single-threaded:** while the agent works, new messages wait in a visible queue and run in order; a **Stop** button interrupts. Replies appear as they're produced, with short activity lines. Messages are not attributed to people. The conversation survives restarts; there is no "new chat" button (Gavin can ask a session to clear it).
2. **Mission control:** live status of the whole installation plus the controls:
   - **Status:** bitcube online, which show file is running, TD frame rate, rope watts, river cam fresh, the seasons wheel and intensity, presence, latest camera still, river site up or down, the Modal link (clips posted, scene age), the hourly recorder.
   - **Controls:** seasons mode, targets and rules (proxied to the control page on bitcube, port 9981); ropes on or dark (send black); HUB75 brightness; which show file opens at boot.
   - The interactive **system map** and links to the show-file pages and the plan.

The public docs stay on GitHub Pages, with no login and no dependence on the mini; mission control links to them.

## Decisions (with Gavin, 22 Oct)
| | Decision | Why |
|---|---|---|
| MD1 | **Team only**, behind **one shared password**: the **same password as bitcube's login** (Gavin insisted; do not use a separate one). Read from a file, never printed or committed; stored in memory only as a hash; repeated wrong guesses are slowed down. | One password for the team. |
| MD2 | The studio chat is an **agent that acts** on the installation (repo, bitcube, cameras, seasons), not just talk. | That's what the team needs. |
| MD3 | It bills **Gavin's Max subscription** through a long-lived token from `claude setup-token` (inference-only: no claude.ai connectors). Can be switched off any time. | No extra account or API billing. |
| MD4 | **One shared, single-threaded conversation**, no names. | "As if I'm passing someone my laptop." Nobody's request trips over another's. |
| MD5 | A **new dedicated agent session**, not Gavin's coordinator session (which has his personal connectors and context). | Privacy; two drivers on one conversation would collide. |
| MD6 | It runs as a **separate, hidden, standard macOS user `river`**, as a **background service started at boot (LaunchDaemon), never logged in** (no second desktop on an 8 GB mini). Gavin's home folder is locked to him only (`chmod 700 /Users/gav`: on 22 Oct it was readable by group `staff`, and `~/.claude` by everyone). | Claude Code's deny rules are guardrails, not walls; a separate user makes the OS enforce privacy. Its own repo clone avoids two agents in one checkout. |
| MD7 | The `river` user has **its own credentials**: a deploy key for `river-bitcube` only, its own SSH key on bitcube, its own copy of the site password and the token. **No Signal access** for now (Signal data is in Gavin's account). | Nothing of Gavin's. |
| MD8 | **Allowed:** work in its clone of `river-bitcube` and push; SSH, VNC and the TD bridge to bitcube; cameras; seasons controls. **Not allowed:** any connector, Gavin's files, `sudo`, Tailscale / router / firewall changes, sending Signal messages, other machines on the house LAN. Anything the repo's rules say "ask Gavin" about is refused in the chat ("Gavin needs to OK this in his own session"). | It's on the internet behind one password. |
| MD9 | **Tailscale Funnel on port 443** for this app only (Gavin OK'd, 22 Oct). Off with `tailscale funnel --https=443 off`. | Real HTTPS, no domain, no router change. |
| MD10 | Code in this repo under **`mission/`** (Node, plain JS, the Claude Agent SDK); runs on the mini from the `river` user's clone. | One repo; `git pull` updates it. |

## How it works (design)
- **Server** (`mission/server.mjs`, Node 26, no framework): listens on `127.0.0.1:8790` only; Funnel forwards HTTPS to it.
  - **Login:** `POST /login` with the password → a random session cookie (HttpOnly, Secure, SameSite=Lax, 30 days; sessions kept in `mission-state/sessions.json` so restarts don't log people out). The password file is read at start and hashed (scrypt); comparisons are constant-time; after failures the response is delayed (doubling per IP, capped) and a global limit applies.
  - **Studio chat:** `GET /api/chat/history`, `GET /api/chat/events` (Server-Sent Events), `POST /api/chat/send {text}`, `POST /api/chat/stop`. A queue feeds one worker; each message is one Agent SDK `query()` that **resumes the same session id** (kept in `mission-state/state.json`); Stop aborts it. Every event (message, activity line, result, error) is appended to `mission-state/chat.jsonl` and pushed to open pages.
  - **Agent options:** working directory = the `river` user's clone of `river-bitcube`; no MCP servers (strict); permission mode that doesn't prompt, with a deny list (`sudo`, `tailscale`, firewall, `networksetup`, `dscl`, Gavin's paths…) in the `river` user's `~/.claude/settings.json`; an appended system prompt from `mission/STUDIO.md` (who it serves, the rules in MD8).
  - **Mission control:** `GET /api/status` is assembled by the server every few seconds: the seasons `/state` from bitcube (port 9981), a fuller bitcube probe over SSH about once a minute (`tools/status_probe.ps1`), Modal's public `state.json`/`status.json`, a TCP check of the river cam (192.168.8.217:554) over the tailnet, the newest snapshot still. Controls are **fixed, whitelisted actions** (`POST /api/control/<action>`), never arbitrary commands.
- **Files on the mini** (outside the repo, owned by `river`, mode 600): `/Users/river/.secrets/site-password` (copy of the bitcube password), `/Users/river/.secrets/claude-token`; state in `/Users/river/mission-state/`.
- **Service:** `/Library/LaunchDaemons/com.agape.river-mission.plist`, `UserName river`, `KeepAlive`, logs in `/Users/river/mission-state/logs/`.

## Runbook
- **Turn it off (internet):** `tailscale funnel --https=443 off` (as Gavin). **Stop the app:** `sudo launchctl bootout system/com.agape.river-mission`. **Start:** `sudo launchctl bootstrap system /Library/LaunchDaemons/com.agape.river-mission.plist`.
- **Update the code:** as `river`, `git -C /Users/river/river-bitcube pull`, then restart the service (`sudo launchctl kickstart -k system/com.agape.river-mission`).
- **Logs:** `/Users/river/mission-state/logs/`.
- **Clear the conversation:** stop the app, delete `session_id` from `/Users/river/mission-state/state.json` (and archive `chat.jsonl`), start it.
- **Rotate the token:** `claude setup-token` (Gavin), replace `/Users/river/.secrets/claude-token`, restart.

## Progress log
Newest last. One line per step: date, step, what changed, commit.
- 22 Oct: M1 this plan written.
- 22 Oct: M2 (part) shared-password login module `mission/lib/auth.mjs` with tests (scrypt hash, cookie sessions on disk as SHA-256, per-client doubling delay, global slow-down); Agent SDK 0.3.309 pinned in `mission/package.json`.
- 22 Oct: M3 (part) studio chat core `mission/lib/studio.mjs` with tests: single-threaded queue, resumes one session id (state.json), Stop aborts the current run, history in chat.jsonl, fresh start if the saved session is lost.
- 22 Oct: M5 (part) agent runner `mission/lib/agent.mjs` (Agent SDK, dontAsk + allow list + deny fence, no MCP, resumes the session) and the studio rules `mission/STUDIO.md`; tests.
