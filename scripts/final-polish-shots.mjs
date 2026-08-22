// Fresh final-proof screenshots at the required review viewports.
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8532';
const cases = [
  { width: 907, height: 510, mission: 2, file: 'shots/final-polish-907x510.png' },
  { width: 1920, height: 1080, mission: 3, file: 'shots/final-polish-1920x1080.png' },
  { width: 390, height: 844, mission: 0, file: 'shots/final-polish-390x844.png' },
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
  await page.waitForTimeout(500);
  await page.screenshot({ path: item.file });
  await page.close();
}
await browser.close();
console.log('final polish screenshots', JSON.stringify({ files: cases.map(item => item.file), errors }));
if (errors.length) process.exit(1);
