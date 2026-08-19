# Shadow Squad

Real-time tactics stealth game (Commandos-style) for CrazyGames. Two agents —
SCOUT (silent takedowns) and TECH (remote hacking + EMP) — infiltrate
robot-guarded facilities: dodge vision cones, hack the terminal, reach evac.

**Play:** https://tukieav.github.io/shadow-squad/

## Dev

```bash
npm install
npm run dev    # esbuild watch + server
npm run build  # dist/ bundle
node tests/e2e.mjs             # Playwright e2e (server on :8487 required)
node scripts/validate-maps.mjs # map sanity checks
```

- Canvas 2D, zero asset files (procedural gfx + WebAudio synth), bundle ~32 KB
- CrazyGames SDK v3: midgame/rewarded ads, happytime, data module progress
- 5 handcrafted missions defined as ASCII grids in `src/maps.js`
