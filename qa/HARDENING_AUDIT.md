# Shadow Squad hardening audit

Audited 2026-08-21 against the CrazyGames gameplay and quality requirements,
the repository sources, and the `shadow-squad` entry in the supplied portfolio
map. Baseline was built locally with `npm run build`, map-checked, and exercised
at DPR 1 in 907x510 and 1920x1080: menu, mission one, a forced fail/retry
attempt, and the mission-progress UI. No browser errors were observed in that
short pass; the retry remained on the fail screen locally because its ad flow
does not resolve a rewarded retry without the SDK.

## Core loop and current depth

The player clicks or taps a destination for Scout or Tech, avoids time-based
robot vision, hacks terminals, and brings both agents to extraction. The ten
ASCII-grid missions add patrols, cameras, lasers, elite sentries, and synced
terminals. Stars, Intel, upgrades, skins, best scores, and daily streaks provide
persisted replay depth. The current visual identity is a dark cyan industrial
facility with procedural detail, robot sparks, cones, HUD, and tactical panels.

## Prioritized issues

1. **FAIL — no production visibility/blur lifecycle.** The loop runs forever
   (`src/main.js:2081-2089`) and input/audio are not paused when the tab loses
   focus; only an in-game ad guard stops updates (`src/main.js:843-846`).
2. **FAIL — no required viewport gate.** Existing viewport coverage is one
   live 1920x1080 check (`tests/live-viewport.mjs:3-12`); there is no local DPR1
   gate for all ten required viewports, physical controls, or portrait.
3. **FAIL — no refresh-rate determinism proof.** Movement is delta-based
   (`src/main.js:668-685`, `828-841`), but update/render are coupled to RAF
   (`src/main.js:2081-2089`) and no 60/144/165Hz simulation test exists.
4. **FAIL — no soak/performance proof.** Effects are filtered (`src/main.js:924-931`),
   but there is no 120-second automated mission/retry/UI soak, error capture,
   listener accounting, or frame/heap bound.
5. **PARTIAL — onboarding still presents a choice/tutorial wall.** The default
   deploy is one click (`src/main.js:490-497`), but the menu also centers a
   large five-line Field Manual (`src/main.js:1846-1861`) rather than teaching
   the requested Scout -> hide -> Tech -> remote-hack sequence in play.
6. **PARTIAL — checkpoint is ad-gated and restarts from spawn.** The only
   checkpoint keeps a hacked-terminal boolean (`src/main.js:606-618`) and
   rebuilds agents at their starting positions (`src/main.js:270-297`), so it
   is not a last-safe-position reset after alarm failure.
7. **PARTIAL — path and patrol intent are opaque.** A selected agent path is
   stored but never rendered (`src/main.js:461-468`, `1625-1697`); patrol
   waypoints/turn direction are neither previewed nor explained, creating
   avoidable first-minute failures.
8. **PARTIAL — camera/terminal edge-state reset lacks a dedicated assertion.**
   Camera and terminal state are re-created (`src/main.js:278-281`), and synced
   terminals reset in-place (`src/main.js:871-884`), but no regression checks
   cover retry, mission switch, or pathfinding/vision cone boundaries.
9. **PARTIAL — audio/SDK boundaries are incomplete.** SDK init has a timeout
   (`src/sdk.js:5-20`) and mute setting is read, but `gameplayStart/Stop` are
   unguarded against duplicate transitions (`src/sdk.js:25-31`), happytime is
   unthrottled (`src/sdk.js:41-43`), and ad callbacks do not centralize pause
   and resume.
10. **PARTIAL — accessibility and input quality are under-specified.** Touch
   always prevents default (`src/main.js:446-453`), there is no reduced-motion
   behavior or explicit mute UI, and the required 44px mobile target and
   overlay-input behavior are not asserted.

## Likely quit causes

| Moment | Likely cause | Evidence |
| --- | --- | --- |
| First 10 seconds | Patrol intent and safe route are unreadable; manual competes with deploy. | `src/main.js:1846-1861`, `461-468` |
| First 60 seconds | An alarm discards position/progress instead of restoring a safe tactical state. | `src/main.js:783-797`, `606-618` |
| Five minutes | Repeated retries, uncertain mobile layout, and no proven resource bounds risk fatigue or instability. | `src/main.js:592-623`, no soak test |

## Graphics and game-feel observations

The procedural art, cone lighting, sparks, and operational HUD are cohesive.
At 907x510 the virtual menu is legible but dense; gameplay has useful contrast.
At 1920x1080 the wide tactical panel increases scene density. The key missing
feedback is predictive: a restrained route and patrol-turn cue would turn the
existing art direction into a readable planning interface. Alarm flashes and
shake should respect reduced-motion preference.

## Requirement matrix

| Requirement | Status | Baseline evidence |
| --- | --- | --- |
| New user reaches useful gameplay in at most one click | PARTIAL | Deploy does so, but primary menu is dense; `src/main.js:490-497`, `1846-1861` |
| Readable DPR1 viewports / controls | PARTIAL | Manual 907x510 + 1920x1080 pass; only one automated viewport test |
| 60/144/165Hz consistency | PARTIAL | Delta movement, no deterministic gate |
| Visibility, focus, ad lifecycle | FAIL | No visibility/blur hooks |
| Safe persistence/migration | PARTIAL | Parse fallbacks exist; no versioned migration or reload test |
| 120s performance soak | FAIL | No soak harness |
| Keyboard, mouse, touch, AZERTY-friendly paths | PARTIAL | Click/touch and 1/2/R exist; no arrow fallback or tests |
| Audio, SDK, ads | PARTIAL | SDK fallback exists; boundary accounting absent |
| Polished, coherent graphics/game-feel | PARTIAL | Strong base art, missing planning overlay/reduced motion |
| Accessibility | FAIL | No mute control or reduced-motion implementation |

## Taxonomy and marketing audit

The current submission claims the invalid secondary/category vocabulary
`Action / Stealth` and invented portal tags such as `stealth`, `tactics`,
`commandos`, `real-time`, `squad`, `hacking`, and `strategy`
(`marketing/SUBMISSION.md:8-11`). It also contains clone-comparison wording in
the full description (`marketing/SUBMISSION.md:17`). The supplied map requires
exactly **Strategy**; secondary discovery **Point and Click**; verified tags
**Point and Click, Robot, Escape, Skill, Top Down, 2D, War**. The description
must avoid the current Commandos/clone wording.
