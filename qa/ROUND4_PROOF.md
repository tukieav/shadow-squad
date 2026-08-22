# Round 4 proof — Shadow Squad

Fresh Round 4 evidence was generated on 2026-08-22 from this worktree's newly
built `dist/` bundle. All browser gates used the isolated local server at
`http://localhost:8574/dist`; no production or shared development server was
used.

## Cover brightness gate

The committed `scripts/check-cover-brightness.mjs` measures decoded submitted
PNG pixels using the following hard limits: mean luminance >= 80, fraction with
luminance < 40 <= 0.35, and mean HSL saturation >= 0.35.

| Cover | Previous meanLum / darkFrac / meanSat | New meanLum / darkFrac / meanSat | Result |
| --- | --- | --- | --- |
| 16:9 | 30.31 / 0.9294 / 0.3691 | 139.24 / 0.0000 / 0.7381 | PASS |
| 2:3 | 30.04 / 0.9284 / 0.3739 | 139.60 / 0.0000 / 0.7583 | PASS |
| 1:1 | 35.49 / 0.8924 / 0.3626 | 141.62 / 0.0000 / 0.7627 | PASS |

## Media and review captures

| File | Verified output |
| --- | --- |
| `marketing/cover-16x9.png` | 1920x1080, 16:9 |
| `marketing/cover-2x3.png` | 800x1200, 2:3 |
| `marketing/cover-1x1.png` | 800x800, 1:1 |
| `marketing/video-landscape.mp4` | H.264 video-only, 1920x1080, 25 fps, 16.04s |
| `marketing/video-portrait.mp4` | H.264 video-only, 720x1080, 25 fps, 15.92s |
| `qa/round4-covers-907x510.png` | cover-gallery review capture, 907x510 |
| `qa/round4-menu-907x510.png` | menu first-impression capture, 907x510 |

`scripts/record-video.mjs` was rerun for both ratios after the menu change. It
prepends the regenerated matching cover for 0.7 seconds before gameplay, so the
encoded opening frame is the new 16:9 or 2:3 cover. The MP4 streams were
verified with `ffprobe`; no audio stream was reported.

## Gate results

| Command | Exit code |
| --- | ---: |
| `npm run build` | 0 |
| `node scripts/validate-maps.mjs` | 0 |
| `npm run test:cover-brightness` | 0 |
| `BASE_URL=http://localhost:8574/dist npm run test:viewport` | 0 |
| `BASE_URL=http://localhost:8574/dist npm run test:refresh` | 0 |
| `BASE_URL=http://localhost:8574/dist npm run test:soak` | 0 |
| `BASE_URL=http://localhost:8574/dist npm run test:polish` | 0 |
| `BASE_URL=http://localhost:8574/dist node tests/round3-compliance.mjs` | 0 |
| `BASE_URL=http://localhost:8574/dist node tests/e2e.mjs` | 0 |
| `BASE_URL=http://localhost:8574/dist node scripts/vision-gate.mjs` | 0 |

`ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate`
reported the media values above. The visual change is intentionally confined to
cover art and the menu backdrop/title treatment; mission scenes retain their
existing stealth lighting.
