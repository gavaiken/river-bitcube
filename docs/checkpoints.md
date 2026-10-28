# Checkpoints

A checkpoint is a point we can return to: a git tag in both repos plus a copy of everything git doesn't hold (on bitcube and on the Mac mini). Take one before any big change.

## checkpoint-2026-10-26: before handing over to Will

Show and mission control exactly as they ran on 26 Oct 2026, ~14:00 PT, before the show-file registry, the baton (`HANDOFF.md`) and the baseline template.

| What | Where |
|---|---|
| river-bitcube | tag `checkpoint-2026-10-26` → `0042e8c` (also bitcube's HEAD and mission control's running commit) |
| river-agent (Dave's) | tag `checkpoint-2026-10-26` → `1b02e18` |
| bitcube's untracked state | `C:\Users\user\Archive\checkpoint-2026-10-26\` (362 MB, **holds secrets, never copy into git**): `River\` (everything except `.git .venv recordings models gallery_state logs frames Backup`, so the `.toe` files as saved on disk, `boot-file.txt`, `secrets.local.json`, `presence.json`, scratch scripts), `RopeLights\config.local.json` + its `.cmd` files, the `Startup\` folder, every root scheduled task as XML (`tasks\`), and `README.txt` (HEAD, boot file, TD version, what was running) |
| Mac mini | `~/claude/local/checkpoints/checkpoint-2026-10-26/`: mission control's LaunchDaemon plist, its `/version` at the time, the Claude.app login agent. Mission control's own state (`/Users/river/mission-state`: chat history, contacts, logs) is owned by the `river` user and was **not** copied (needs sudo). Copy it with `sudo ditto /Users/river/mission-state ~/claude/local/checkpoints/checkpoint-2026-10-26/mission-state` if you want it too. |

At that moment bitcube's boot file was `river-local-oct-22-seasons.toe`, TouchDesigner 2025.33230, and its working tree had one uncommitted oddity: `river_masks/` moved into `river_masks/river_masks/` (Andi's project, untouched by the show).

### Going back

1. **Repo.** Don't rewrite `main`. Make a commit that puts the old tree back:
   `git checkout checkpoint-2026-10-26 -- . && git commit -m "Back to checkpoint-2026-10-26"`, then push. (For a look without changing anything: `git switch --detach checkpoint-2026-10-26`.)
2. **Mission control** updates itself from `main` within ~5 min of that push; check `GET /version` shows the new commit.
3. **bitcube.** `git pull` in `C:\Users\user\River\river-bitcube`. If a `.toe` or `boot-file.txt` still differs, copy it back from the archive's `River\` folder (close TD first). Untracked files (`secrets.local.json`, RopeLights config) come from the archive too. Restore a scheduled task with `Register-ScheduledTask -Xml (Get-Content <file>.xml -Raw) -TaskName <name> -Force`.
4. Reboot bitcube, or run `Start-River.cmd` through a one-off interactive scheduled task (see `CLAUDE.md`), and check the ropes and panels.

## river-looks-gpu-ribbons-v1: the river (all looks) with the GPU silk ribbons (28 Oct, 09:15 PT)

`river-looks.toe` (the boot default) on auto, as Gavin approved it on the piece the morning of 28 Oct: the remembered river with its
screens as GPU silk ribbons of glitter in the palette's blues and greens over the river clips (tinted, turned to run along the
ropes by each screen), the pool, dynamics, easing and black dots (M3-M5), the flood-day fill (M6), Fill my cup (simple) every
fourth loop. 31 fps.

| What | Where |
|---|---|
| river-bitcube | tag `river-looks-gpu-ribbons-v1` → `dbabb2d` (river-looks.toe committed in it) |
| bitcube | boot file `river-looks.toe` |

Going back: `git checkout river-looks-gpu-ribbons-v1 -- td/remembered td/looks td/build/build_remembered.py td/build/build_looks.py river-looks.toe`, commit, pull on bitcube, then `td.ps1 -File td\build\build_looks.py` (or reopen the file). Only the numpy ribbons (no GPU): `control.json` `screens.gpu: false`. Before the ribbons: tag `before-m2-ribbons`.

## remembered-particles-v1: the remembered river with the particle windows (27 Oct, 22:20 PT)

The remembered river as the artists saw it on the night of 27 Oct: the remembered-day loop on the ropes, and the screens as windows into one particle field in the room (round 2b, `td/remembered/particles.py`, measured tilts). The boot default.

| What | Where |
|---|---|
| river-bitcube | tag `remembered-particles-v1` → `40203ed` (river-remembered.toe committed in it) |
| river-agent (Dave's) | tag `remembered-particles-v1` → `322e92b` |
| bitcube | `C:\Users\user\Archive\remembered-particles-v1\` (river-remembered.toe, boot-file.txt) |

Going back: as above (`git checkout remembered-particles-v1 -- td/remembered td/build/build_remembered.py river-remembered.toe`, commit, pull on bitcube, rebuild or reopen).
