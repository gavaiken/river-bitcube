---
title: "A River Becoming: mission control known issues"
---

# Mission control v2: known issues

26 Oct 2026, as of the merge of round 10's fixes (`2741abc`). The review loop is paused here; no final critic round has run yet. All are minor, and none blocks a control or hides a fault. The numbers are the round-10 critics' findings (R10 #n).

## Open from round 10 (pages and accessibility)
The second round-10 fixer never ran, so none of these was started.
- **R10 #1, Status:** during someone else's restart, a row a teammate is reading jumps about 1,200 px off screen, and comes back afterwards. Fix: anchor on the topmost on-screen row by `data-id` and restore its offset after a render. This also covers R9 #7's leftover: a row that moves to another section (for example TouchDesigner into Not OK while it restarts) is drawn anew there.
- **R10 #4, every confirm sheet:** at 200 % zoom the warning is cut under the sticky buttons, so the danger button is in reach before the warning is read. Fix: no sticky action row on a confirm.
- **R10 #5, menu:** on short screens the menu opens with focus on the whole sheet, not its title. Fix: `sheet()` focuses `#mc-sheet-title` on every open.
- **R10 #7, chat:** a phone with a sheet open (menu, Recent, Who to call, Stop's confirm) never hears the agent's reply. Fix: say the settled card in the sheet's region too, or hold it until the sheet closes.
- **R10 #8, Recent:** while open it redraws its whole list with `innerHTML` at each new event. Fix: patch with `ui.js` `morph`, rows keyed.
- **R10 #10, Lights and Status:** focus passes through two or three places within a few ms as a control changes state. Fix: decide focus once, after the DOM is final.
- **R10 #11, Calibrate:** the stage list doesn't tell a screen reader which stages are done and which is now. Fix: `aria-current="step"` and a hidden "done:" prefix.
- **R10 #12, Status:** Check now's host is the one control never `aria-busy` while it applies. Fix: one attribute in `checkLine()`.

## Not yet reviewed
Round 10's fixes (R10 #0, #2, #3, #6, #9, #13–#24, #26–#41; #25 was the agent brief, `94aa77f`) are covered by unit and server tests (node 400/400, pytest 238). Their fixer's own report, with its browser walks, was lost when its session died, and no critic round or code review has looked at them yet.
