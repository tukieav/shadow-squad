// Records preview video: bot plays mission 1 (sneak, takedown, hack, evac)
// usage: node scripts/record-video.mjs landscape|portrait
import { chromium } from 'playwright';
const mode = process.argv[2] || 'landscape';
const size = mode === 'portrait' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: 'marketing/vid-' + mode, size } });
const page = await ctx.newPage();
await page.goto('http://localhost:8532/?debug=1');
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu');
await sleep(1200); // show menu briefly

const st = () => page.evaluate(() => window.__astro.getState());
const go = (x, y) => page.evaluate(([a, b]) => window.__astro.clickWorld(a, b), [x, y]);
const waitArrive = async (x, y, tmo = 9000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < tmo) {
    const s = await st();
    if (s.state !== 'playing') return s;
    if (Math.hypot(s.agentX - x, s.agentY - y) < 1.0) return s;
    await sleep(120);
  }
  return st();
};

// start mission 1 directly
await page.evaluate(() => window.__astro.startMission(0));
await sleep(700);

// scout sneaks down the left side into grass
await go(4, 4); await waitArrive(4, 4);
await go(2, 7); await waitArrive(2, 7);
// wait for guard to face away (patrols y=10), then approach from behind for takedown
let s = await st();
for (let i = 0; i < 60; i++) {
  s = await st();
  const g = s.guards[0];
  if (!g.alive) break;
  const facingRight = Math.abs(g.facing) < 1.2;
  const behindX = facingRight ? g.x - 1.5 : g.x + 1.5;
  const dist = Math.hypot(s.agentX - g.x, s.agentY - g.y);
  if (dist > 2.5) { await go(Math.round(behindX), 10); }
  else { await page.evaluate(() => { const gg = window.__astro.getState().guards[0]; window.__astro.clickWorld(gg.x - 0.4, gg.y - 0.4); }); }
  await sleep(400);
}
// switch to tech, hack terminal remotely
await page.keyboard.press('2');
await sleep(300);
await go(3, 5); await waitArrive(3, 5);
await go(11, 8); await waitArrive(11, 8, 12000);
s = await st();
await go(s.objective.x - 2, s.objective.y); // stand 2 tiles from terminal
await page.waitForFunction(() => window.__astro.getState().hacked, null, { timeout: 25000 }).catch(() => {});
// both to evac
await go(2, 13);
await page.keyboard.press('1');
await sleep(200);
await go(1, 13);
await page.waitForFunction(() => window.__astro.getState().state === 'complete', null, { timeout: 20000 }).catch(() => {});
await sleep(1500);
await ctx.close();
await browser.close();
console.log('recorded', mode);
