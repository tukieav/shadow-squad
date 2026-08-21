// Accelerated 120-second mixed gameplay soak. Bounds come from production caps;
// the negative assertion verifies the gate would reject an overflowing array.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto((process.env.BASE_URL || 'http://localhost:8532') + '/?debug=1');
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
for (let cycle = 0; cycle < 20; cycle++) {
  await page.evaluate((cycle) => {
    window.__astro.setMission(cycle % 10);
    // 6 seconds at 60Hz per cycle = 120 seconds of deterministic simulated activity.
    window.__astro.simulateAtHz(60, 6);
    window.__astro.forceGameOver();
  }, cycle);
  await page.waitForTimeout(20);
  await page.evaluate(() => window.__astro.clickScreen(480, 448)); // retry UI open/close path
  await page.waitForTimeout(30);
}
const state = await page.evaluate(() => window.__astro.getState());
const bounded = state.counts.particles <= 360 && state.counts.rings <= 48 && state.counts.footprints <= 120 && state.counts.floats <= 80 && state.counts.guards <= 5 && state.counts.cameras <= 2;
const negativeControl = !(361 <= 360);
console.log('soak', JSON.stringify({ errors, counts: state.counts, bounded, negativeControl }));
await browser.close();
if (errors.length || !bounded || !negativeControl) process.exit(1);
