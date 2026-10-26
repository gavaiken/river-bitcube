// Self-update (server.mjs): when a pull brings new mission/ code, the server exits and launchd starts it on the new code. It
// waits for a quiet moment: the studio chat idle (nothing running, nothing waiting) and nothing being applied anywhere
// (status.applying empty: no change in flight or confirming, no calibration starting). An exit mid-rebuild would kill the
// ssh call building, saving and restarting TouchDesigner, drop every lock, and never record the map in use (round 6 #34).
//
// new SelfUpdate({ boot, tree, quiet, exit })   boot: the mission/ tree the server started on (null: not a git checkout, never
//                                              restarts); tree(): the tree in the repo now; quiet(): whether nothing is going
//                                              on; exit(): restart (process.exit, for launchd)
//   check() -> pending                         after a pull: new code in the repo makes the restart pending
//   maybeRestart() -> bool                     restarts when one is pending and it is quiet; call it on every chance
export class SelfUpdate {
  constructor({ boot, tree, quiet, exit, log = (s) => console.log(s) }) {
    Object.assign(this, { boot, tree, quiet, exit, log });
    this.pending = false;
  }

  check() {
    if (!this.pending && this.boot) {
      const now = this.tree();
      if (now && now !== this.boot) { this.pending = true; this.log('mission/ changed in the repo: restarting when nothing is in flight and the chat is idle'); }
    }
    return this.pending;
  }

  maybeRestart() {
    if (!this.pending) return false;
    let quiet = false;
    try { quiet = this.quiet() === true; } catch { quiet = false; }
    if (!quiet) return false;
    this.log('restarting for new code');
    this.exit();
    return true;
  }
}
