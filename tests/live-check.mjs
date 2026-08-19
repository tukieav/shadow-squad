// Live verification of GitHub Pages deploy: console errors + canvas pixels + play a bit
import { chromium } from 'playwright';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('https://tukieav.github.io/shadow-squad/?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 20000 });
console.log('menu reached');
// play a few moves
await page.evaluate(() => { window.__astro.clickScreen(220, 258); });
await sleep(300);
await page.evaluate(() => { window.__astro.clickScreen(480, 468); });
await sleep(500);
let s = await page.evaluate(() => window.__astro.getState());
console.log('state:', s.state, 'mission:', s.mission);
await page.evaluate(() => window.__astro.clickWorld(6, 3));
await sleep(2000);
s = await page.evaluate(() => window.__astro.getState());
console.log('agent at', s.agentX.toFixed(1), s.agentY.toFixed(1));
const bright = await page.evaluate(() => {
  const c = document.getElementById('game');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 400) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) n++;
  return n;
});
console.log('bright samples:', bright);
console.log('errors:', errors.length, errors);
console.log(s.state === 'playing' && bright > 50 && errors.length === 0 ? 'LIVE OK' : 'LIVE FAIL');
await browser.close();
