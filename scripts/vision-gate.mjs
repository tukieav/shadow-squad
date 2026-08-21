// Vision gate: renders desktop screenshots at 1280x720 and 1920x1080
// (menu, mission 1 first minute, alarm, fail screen) for manual/vision QA.
import { chromium } from 'playwright';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  const tag = `${w}x${h}`;
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('HTML5 SDK')) errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8532/?debug=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
  await sleep(800);
  await page.screenshot({ path: `shots/gate-${tag}-menu.png` });
  // mission 1: the first minute a CrazyGames reviewer sees
  await page.evaluate(() => window.__astro.startMission(0));
  await sleep(600);
  await page.evaluate(() => window.__astro.clickWorld(9, 4));
  await sleep(2200);
  await page.screenshot({ path: `shots/gate-${tag}-m1.png` });
  // alarm state
  for (let i = 0; i < 10; i++) {
    const alarmed = await page.evaluate(() => {
      const s = window.__astro.getState();
      if (s.alarm === 2) return true;
      const g = s.guards[0];
      window.__astro.teleport(0, Math.round(g.x + Math.cos(g.facing) * 3), Math.round(g.y + Math.sin(g.facing) * 3));
      return false;
    });
    if (alarmed) break;
    await sleep(400);
  }
  await sleep(400);
  await page.screenshot({ path: `shots/gate-${tag}-alarm.png` });
  // fail screen (softened)
  await page.evaluate(() => window.__astro.forceGameOver());
  await sleep(500);
  await page.screenshot({ path: `shots/gate-${tag}-failed.png` });
  console.log(`${tag}: shots done, errors=${errors.length}`, errors.slice(0, 3));
  await page.close();
}
await browser.close();
console.log('vision gate renders complete');
