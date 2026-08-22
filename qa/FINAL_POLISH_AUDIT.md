# Final Polish audit — Shadow Squad

Audited 2026-08-22 against the current hardened build. I exercised the menu,
first mission, retry/reset, a later patrol mission, touch layout, and the
existing automated 120-second simulation at 907x510, 1920x1080, and 390x844.
The existing viewport, fixed-step, lifecycle, persistence, and soak work was
left intact. This document intentionally records **only** the three remaining,
reproduced defects selected for this polish pass.

## 1. Two exposed agents consume one sentry's detection timer twice

- **Reproduction:** Start OP 03 in the debug build. Put both agents three open
  tiles directly in front of guard 1, then wait 500 ms. With one agent exposed,
  the guard remains `WARY` (`alarm: 1`); with both exposed, the same guard
  enters `ALARM` (`alarm: 2`) before the advertised 0.8 s detection window.
- **User impact:** A player can lose a fair recovery window merely by keeping
  the squad together. This is especially punishing at cone edges, where the
  visual meter promises time that is silently divided by the number of agents.
- **Root cause:** `src/main.js:826-835` increments the same `g.detect` once
  for every visible agent in a loop, instead of treating visibility as a
  boolean for the sentry.
- **Evidence:** [907x510 dual-detection state](../shots/final-audit-907-double-detection.png)
  shows OP 03 at `T+0:00.6` already in `ALARM` with both agents together.

## 2. “Reset to last safe position” revives neutralized sentries

- **Reproduction:** In OP 01, EMP and silently deactivate the only sentry;
  wait for a calm safe snapshot, force a failure, and choose `RESET TO LAST
  SAFE POSITION`. The squad returns to its checkpoint but that sentry is alive
  again. Reproduced state: before reset `guards[0].alive: false`; after reset
  `guards[0].alive: true` and `checkpointUsed: true`.
- **User impact:** The one free tactical reset discards earned stealth progress
  while implying it preserves it, creating an unexpected repeat threat and an
  unfair score/pacing loss in later missions.
- **Root cause:** `src/main.js:306-329` snapshots only agents and terminals.
  `startMission()` recreates guards/bodies/counters before `restoreCheckpoint()`
  (`src/main.js:270-303`), and the restore does not put their safe state back.
- **Evidence:** [907x510 restored checkpoint state](../shots/final-audit-907-checkpoint-reset.png)
  is captured immediately after that reset, with the previously disabled
  sentry rendered active again.

## 3. Narrow touch HUD paints over the agent-switch controls

- **Reproduction:** At 390x844, start OP 01 and leave the first field cue
  active. The centered mission panel overlaps both portrait controls, and the
  full-width field cue covers their lower labels/borders.
- **User impact:** The primary touch agent-switch affordance looks obstructed
  exactly when onboarding asks the player to use it. This reduces command
  readability even though the underlying tap hit test still happens to work.
- **Root cause:** `src/main.js:1592-1616` always positions a 270 px mission
  readout at `GAME_W / 2 - 135` and a 348 px cue at `GAME_W / 2 - 174`, without
  reserving the fixed portrait rectangles from `src/main.js:384-386`.
- **Evidence:** [390x844 HUD overlap](../shots/final-audit-390-hud-overlap.png)
  shows the title panel over `SCOUT`/`TECH` and the field cue through their
  bottom edge.

