# Shadow Squad — CrazyGames Submission Kit

Wszystko poniżej wklejasz w formularz na https://developer.crazygames.com/

## Game name
Shadow Squad

## Category
Strategy (secondary: Action / Stealth)

## Tags
stealth, tactics, commandos, real-time, squad, robots, hacking, top-down, spy, strategy

## Short description (max ~140 chars)
Command a 2-agent stealth squad! Dodge vision cones, take down robot sentries silently, hack terminals and vanish without raising alarms.

## Full description
Shadow Squad is a real-time tactics stealth game inspired by the classics.
Command two elite agents infiltrating robot-guarded facilities: hack the
terminal, then get your whole squad to the evac zone — ideally without
anyone ever knowing you were there.

FEATURES
- Two agents, two playstyles: SCOUT (fast, silent takedowns from behind) and
  TECH (remote terminal hacking, EMP grenades that stun sentries)
- Real vision cones: watch patrol routes, use walls, crates and tall grass
- Dynamic alert system: get spotted and sentries hunt you — break line of
  sight and wait for the heat to die down
- Deactivated sentries stay on the floor — other guards who see them raise
  the alarm! Plan your takedowns
- 10 handcrafted missions with rising complexity: rotating security cameras,
  laser gates, synced twin terminals (use both agents at once!) and armored
  elite sentries immune to frontal takedowns
- 1-3 star ratings per mission (par time + ghost runs) — replay for perfection
- Meta-progression: earn INTEL from stars, spend it in the Black Market on
  permanent gadgets (+1 EMP slot, faster hacking, sprint servos) and agent skins
- Daily login streak bonus
- Score system: time bonus, takedown bonus, and a GHOST bonus for zero alarms
- Mission progress, stars, intel and unlocks saved across devices
- Full-window desktop presentation: the facility fills your whole screen, with
  a live tactical side panel (brief, objectives, threat board) on wide displays
- Mouse + keyboard and full touch support

HOW TO PLAY
1. Click / tap to move the active agent
2. Press 1 / 2 (or tap portraits) to switch agents
3. SCOUT: click a sentry from behind for a silent takedown
4. TECH: stand within 3 tiles of the terminal to hack, press R (or EMP button) to stun
5. Hack the terminal, then bring BOTH agents to the evac zone

No blood, no humans harmed — the guards are robots that power down with a
shower of sparks.

## Controls text
Click / tap — move. 1 / 2 or portraits — switch agent. Click sentry from behind (Scout) — takedown. R / EMP button — EMP grenade (Tech).

## SDK integration notes (QA reviewer info)
- HTML5 SDK v3, manual init before game start (with timeout fallback)
- gameplayStart/gameplayStop on mission start/end/ad breaks
- loadingStart/loadingStop around boot
- Midgame ad between missions (after results screen) and on mission retry
- Rewarded ad #1: "Retry from checkpoint" after failing a mission where the
  terminal was already hacked (once per mission)
- Rewarded ad #2: "+1 EMP charge" in the mission briefing
- Rewarded ad #3: "x2 INTEL" on the mission-complete screen
- happytime() on ghost completion (zero alarms) and 3-star ratings
- game.settings.muteAudio respected + settings change listener; audio muted during ads
- Mission progress, stars, intel, upgrades, skins + best scores via data module with localStorage fallback
- No external requests, all assets procedural, bundle ~47 KB
- Touch + mouse + keyboard; works on low-end devices
- Live demo: https://tukieav.github.io/shadow-squad/

## Files to upload
- Build: dist/index.html + dist/bundle.js (lub shadow-squad.zip)
- Cover 16:9 (1920x1080): marketing/cover-16x9.png
- Cover 1:1 (1080x1080): marketing/cover-1x1.png
- Cover 2:3 (800x1200): marketing/cover-2x3.png
- Screenshots: marketing/screenshot-menu.png, marketing/screenshot-gameplay.png, marketing/screenshot-emp.png
- Videos: marketing/video-landscape.mp4 (1280x720), marketing/video-portrait.mp4 (720x1280)

## Formularz
- "Does your game save progress?" -> "Yes, using the Data Module from the CrazyGames SDK"
- [x] supports mobile devices, [x] supports CrazyGames muting audio through SDK, [ ] online multiplayer

## Age rating / audience
All ages; designed for 10–16. No blood/violence against humans (robot enemies deactivate with sparks), no text chat, no user content.
