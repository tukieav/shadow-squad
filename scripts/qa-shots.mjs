import { chromium } from 'playwright';
// QA screenshot harness: menu, briefing, gameplay, alarm moment
const shot = process.argv[2] || 'qa1';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('http://localhost:8532/?debug=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `shots/${shot}-menu.png` });
// briefing: click mission 1 tile
const box = await page.locator('#game').boundingBox();
const k = box.width / 960;
const click = (gx, gy) => page.mouse.click(box.x + gx * k, box.y + gy * k);
await click(480 - 260 + 48, 118 + 48); // mission 1 tile
await page.waitForTimeout(2500);
await page.screenshot({ path: `shots/${shot}-briefing.png` });
// start mission
await page.evaluate(() => window.__astro.startMission(0));
await page.waitForTimeout(800);
// move agent to make it lively
await page.evaluate(() => window.__astro.clickWorld(11, 6));
await page.waitForTimeout(1600);
await page.screenshot({ path: `shots/${shot}-gameplay.png` });
// force alarm: teleport scout in front of guard
for (let tries = 0; tries < 8; tries++) {
  const alarmed = await page.evaluate(() => {
    const s = window.__astro.getState();
    if (s.alarm === 2) return true;
    const g = s.guards[0];
    window.__astro.teleport(0, Math.round(g.x + Math.cos(g.facing) * 4), Math.round(g.y + Math.sin(g.facing) * 4));
    return false;
  });
  if (alarmed) { await page.evaluate(() => window.__astro.teleport(0, 2, 12)); break; }
  await page.waitForTimeout(450);
}
await page.waitForTimeout(600);
await page.screenshot({ path: `shots/${shot}-alarm.png` });
// bigger mission for texture variety (mission 4 server farm)
await page.evaluate(() => window.__astro.setMission(3));
await page.waitForTimeout(900);
await page.screenshot({ path: `shots/${shot}-m4.png` });
// EMP visual
await page.evaluate(() => window.__astro.tryEmp());
await page.waitForTimeout(350);
await page.screenshot({ path: `shots/${shot}-emp.png` });
console.log('STATE:', JSON.stringify(await page.evaluate(() => ({ state: window.__astro.getState().state, alarm: window.__astro.getState().alarm }))));
console.log('ERRORS:', errors.length, errors.slice(0, 5).join(' | '));
await browser.close();
