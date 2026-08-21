import { chromium } from 'playwright';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto('http://localhost:8532/?debug=1');
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu');
const st = () => page.evaluate(() => window.__astro.getState());
// go to briefing mission 2 (assumes unlocked>=2 from previous run)
await page.evaluate(() => { window.__astro.setUnlocked(3); window.__astro.clickScreen(378, 166); });
await sleep(200);
console.log('1', await st().then(s => [s.state, s.mission, s.adInProgress]));
// rewarded click
await page.evaluate(() => window.__astro.clickScreen(480, 530));
await page.waitForFunction(() => !window.__astro.getState().adInProgress, null, { timeout: 20000 }).catch(() => {});
await sleep(300);
console.log('2 after rewarded', await st().then(s => [s.state, s.adInProgress, s.bonusEmp]));
// START
await page.evaluate(() => window.__astro.clickScreen(480, 468));
await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 10000 }).catch(() => {});
await sleep(400);
console.log('3 after START', await st().then(s => [s.state, s.mission, s.adInProgress]));
// takedown repro on mission 2
await page.evaluate(() => {
  const gg = window.__astro.getState().guards[0];
  window.__astro.teleport(1, Math.round(gg.x), Math.round(gg.y));
  window.__astro.tryEmp();
});
await sleep(300);
await page.evaluate(() => {
  const gg = window.__astro.getState().guards[0];
  window.__astro.teleport(0, Math.round(gg.x), Math.round(gg.y));
  window.__astro.clickWorld(gg.x - 0.5, gg.y - 0.5);
});
await sleep(700);
console.log('4 takedown', await st().then(s => [s.guards[0].alive, s.activeAgent]));
await browser.close();
