// DPR=1 CrazyGames viewport gate. It deliberately uses physical mouse clicks,
// so a scaled-only debug route cannot mask a broken player control path.
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8532';
const viewports = [[907,510],[1216,684],[1077,606],[821,462],[1366,768],[1920,1080],[1536,864],[1280,720],[800,450],[1080,607]];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
let failed = 0;

for (const [width, height] of [...viewports, [390, 844]]) {
  const mobile = width === 390;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  await page.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?debug=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  await page.waitForTimeout(150);
  const vp = await page.evaluate(() => window.__astro.getViewport());
  const canvas = await page.locator('#game').boundingBox();
  const canvasFits = canvas.width >= width * 0.98 && canvas.height >= height * 0.98 && canvas.width <= width + 1 && canvas.height <= height + 1;
  if (width === 390) {
    const rect = await page.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return { x: 18, y: r.height - 74, w: r.width - 36, h: 52 }; });
    await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
  } else {
    // The large deploy control is 260x50 in virtual 960x600 UI space.
    await page.mouse.click(width / 2, height * 0.62);
  }
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => window.__astro.getState().state);
  const ok = vp.w === width && vp.h === height && canvasFits && state === 'playing' && errors.length === 0;
  console.log(`${width}x${height} DPR1 ${ok ? 'PASS' : 'FAIL'}`, JSON.stringify({ vp, canvas: { w: canvas.width, h: canvas.height }, state, errors }));
  if (!ok) failed++;
  await context.close();
}
await browser.close();
if (failed) process.exit(1);
