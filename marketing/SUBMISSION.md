# Shadow Squad — CrazyGames submission kit

## Game name

Shadow Squad

## Category and discovery

- Primary category: **Strategy**
- Secondary discovery path: **Point and Click**
- Verified tags: **Point and Click, Robot, Escape, Skill, Top Down, 2D, War**

## Short description (155 characters)

Coordinate two specialist agents, bypass robot patrols, hack secure facilities, and escape without raising the alarm.

## Full description

One clean breach can turn a guarded facility into a silent escape route. Lead Scout and Tech through ten handcrafted infiltration operations: issue routes, read vision cones, use cover, breach terminals, then bring both agents to extraction.

The core loop is observe, command, adapt. Scout moves quickly and can disable robots from behind; Tech remotely hacks terminals and carries EMP charges to disable sentries and cameras. Later operations add laser gates, rotating cameras, armoured sentries, patrol-route previews, and timed twin-terminal objectives with clear sync telegraphs.

Earn up to three stars for speed and zero-alarm play, collect Intel, and spend it on an extra EMP slot, faster hacks, sprint servos, and agent cosmetics. A calm-position reset is available once per mission, retaining earned tactical progress instead of forcing a full replay. Typical operations take 3–8 minutes.

## Controls

- Desktop: click to command the selected agent; `1` / `2` switch Scout and Tech; `E` activates EMP; arrow keys issue one-tile nudges. Physical-key bindings work across layouts, including WASD/ZQSD (AZERTY) keyboards.
- Mobile: tap to command or switch agents; a 52 CSS-pixel Deploy control starts the first operation; the in-game EMP and mute controls are at least 44 CSS px.

## SDK, data, ads, and safety

- CrazyGames SDK v3 initializes with a timeout fallback. Loading begins after initialization; gameplay boundaries are idempotent; happytime is throttled.
- Visibility loss, window blur, and ads pause simulation/input/audio and resume once on return. CrazyGames mute settings and the in-game mute control are respected.
- Mission unlocks, stars, Intel, upgrades, skins, scores, and mute preference use the Data Module with safe localStorage fallback and malformed-save bounds.
- A midgame ad may appear only between missions or on a full retry. The free once-per-mission reset to the last safe position never requires an ad.
- PEGI 12 suitable: no blood, no harm to humans, no chat, no user-generated content, and no custom fullscreen.

## QA / quality resubmission note

This quality resubmission adds fixed-step 60/144/165Hz simulation coverage, all required DPR1 viewport checks, accelerated 120-second retry/UI soak coverage, safe lifecycle handling, reduced-motion behavior, route/patrol intent cues, and staged in-play onboarding. Media was regenerated from the final local build.

## Live URL and upload files

- Live URL: https://tukieav.github.io/shadow-squad/
- Upload: `shadow-squad.zip` (contains `dist/index.html` and `dist/bundle.js`)
- Covers: `marketing/cover-16x9.png`, `marketing/cover-1x1.png`, `marketing/cover-2x3.png`
- Screenshots: `marketing/screenshot-menu.png`, `marketing/screenshot-gameplay.png`, `marketing/screenshot-emp.png`
- Videos: `marketing/video-landscape.mp4`, `marketing/video-portrait.mp4`
