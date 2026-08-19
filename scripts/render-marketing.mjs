// Renders covers (3 formats) + gameplay screenshots
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const covers = [
  ['cover-16x9.png', 1920, 1080, false],
  ['cover-1x1.png', 1080, 1080, true],
  ['cover-2x3.png', 800, 1200, true],
];
for (const [name, w, h, sq] of covers) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`file:///home/bartek/Projects/shadow-squad/marketing/cover.html?w=${w}&h=${h}${sq ? '&sq=1' : ''}`);
  await page.waitForFunction(() => document.title === 'ready');
  await sleep(300);
  await page.locator('#cover').screenshot({ path: 'marketing/' + name });
  await page.close();
  console.log(name, 'done');
}

// gameplay screenshots 1920x1080
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:8487/?debug=1');
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu');
await sleep(500);
await page.screenshot({ path: 'marketing/screenshot-menu.png' });
// mission 3 for a rich scene
await page.evaluate(() => { window.__astro.setUnlocked(5); window.__astro.startMission(2); });
await sleep(800);
// move scout toward grass and let guards patrol into view
await page.evaluate(() => window.__astro.clickWorld(5, 5));
await sleep(3500);
await page.screenshot({ path: 'marketing/screenshot-gameplay.png' });
// second gameplay shot: EMP blast moment
await page.evaluate(() => {
  const gg = window.__astro.getState().guards[0];
  window.__astro.teleport(1, Math.round(gg.x), Math.round(gg.y) + 1);
  window.__astro.tryEmp();
});
await sleep(350);
await page.screenshot({ path: 'marketing/screenshot-emp.png' });
await browser.close();
console.log('screenshots done');
