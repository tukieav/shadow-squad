// Round 3 proof screenshots at the required review viewports.
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8532';
const cases = [
  { width: 907, height: 510, mission: 3, file: 'shots/r3-proof-907x510.png' },
  { width: 1920, height: 1080, mission: 3, file: 'shots/r3-proof-1920x1080.png' },
  { width: 390, height: 844, mission: 0, file: 'shots/r3-proof-390x844.png' },
];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const errors = [];
for (const item of cases) {
  const page = await browser.newPage({ viewport: item, deviceScaleFactor: 1, isMobile: item.width === 390, hasTouch: item.width === 390 });
  await page.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  page.on('pageerror', error => errors.push(`${item.width}x${item.height}: ${error.message}`));
  await page.goto(`${base}/?debug=1`);
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  await page.evaluate((mission) => window.__astro.setMission(mission), item.mission);
  if (item.mission === 3) {
    await page.evaluate(() => {
      const term = window.__astro.getState().terminals[0];
      window.__astro.teleport(1, term.x - 2, term.y);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true }));
    });
    await page.waitForTimeout(900);
  } else {
    // Leave the saved first-run visual control card visible on the mobile proof.
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: item.file });
  await page.close();
}
await browser.close();
console.log('round 3 proof screenshots', JSON.stringify({ files: cases.map(item => item.file), errors }));
if (errors.length) process.exit(1);
