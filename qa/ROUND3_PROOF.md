# Round 3 proof — Shadow Squad

Fresh evidence was generated from this worktree's built `dist/` bundle served on
the isolated local port `8573` on 2026-08-22. No production or stale global
server was used for the listed local gates.

## Marketing media

| File | Verified dimensions / ratio | Duration | Notes |
| --- | --- | --- | --- |
| `marketing/cover-16x9.png` | 1920x1080, 16:9 | — | Title-only landscape cover |
| `marketing/cover-2x3.png` | 800x1200, 2:3 | — | Title-only portrait cover |
| `marketing/cover-1x1.png` | 800x800, 1:1 | — | Title-only square cover |
| `marketing/video-landscape.mp4` | 1920x1080, 16:9 | 16.00s | H.264 video-only; starts with the 16:9 cover held for 0.7s |
| `marketing/video-portrait.mp4` | 720x1080, 2:3 | 15.88s | H.264 video-only; starts with the 2:3 cover held for 0.7s |

`ffprobe` verified the two MP4 streams as video-only and confirmed the listed
dimensions and durations. The recording script trims its setup lead-in before
joining the held cover to gameplay, so no menu, cursor, ad, results, or game-over
screen appears in the delivered clips.

## Fresh screenshot review

- `shots/r3-proof-907x510.png` — selected Tech pulse ring and live terminal
  `UPLINK` hologram.
- `shots/r3-proof-1920x1080.png` — wide tactical presentation and aligned HUD.
- `shots/r3-proof-390x844.png` — mobile first-run visual control card, including
  the physical WASD/ZQSD key cluster and visible Skip control.

## Gate results

All commands below used the freshly built local bundle at `http://localhost:8573`
where applicable.

| Command | Exit code |
| --- | ---: |
| `npm run build` | 0 |
| `node scripts/validate-maps.mjs` | 0 |
| `BASE_URL=http://localhost:8573 npm run test:viewport` | 0 |
| `BASE_URL=http://localhost:8573 npm run test:refresh` | 0 |
| `BASE_URL=http://localhost:8573 npm run test:soak` | 0 |
| `BASE_URL=http://localhost:8573 npm run test:polish` | 0 |
| `BASE_URL=http://localhost:8573 node tests/round3-compliance.mjs` | 0 |
| `BASE_URL=http://localhost:8573 node tests/e2e.mjs` | 0 |
| `BASE_URL=http://localhost:8573 node scripts/vision-gate.mjs` | 0 |

The round-specific regression dispatches `KeyboardEvent({ code: 'KeyW', key:
'z' })` and verifies movement, then dispatches `Digit2` and `KeyE` with
layout-mismatched key text. It also verifies that the saved first-run control
card does not reappear.
