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

Lead Scout and Tech through ten handcrafted infiltration operations. Switch agents instantly, use cover, read moving vision cones, disable cameras with EMP, perform silent takedowns, and coordinate terminal hacks before reaching the extraction zone.

Each operation rewards careful planning: Scout moves quickly and can disable a robot from behind, while Tech remotely hacks terminals and carries EMP charges. Later facilities introduce laser gates, rotating cameras, armored sentries, and timed twin-terminal objectives. Earn up to three stars for speed and ghost play, then spend Intel on gadgets, faster hacking, and agent cosmetics.

The first mission teaches movement, concealment, agent switching, and remote hacking through short in-play cues. The tactical view previews a selected agent’s route and the next sentry patrol segment, while one reset to the latest safe position keeps an alarm failure from becoming repetitive.

## Controls

- Desktop: click to command the selected agent; `1` / `2` switch Scout and Tech; arrow keys issue one-tile nudges; `R` activates EMP.
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
