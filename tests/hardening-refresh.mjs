// Fixed-step regression gate. The negative control proves the comparison fails
// when one result is deliberately mutated, without touching production code.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
await page.goto((process.env.BASE_URL || 'http://localhost:8532') + '/?debug=1');
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
const samples = await page.evaluate(() => [60, 144, 165].map(hz => ({ hz, ...window.__astro.simulateAtHz(hz, 18) })));
const same = (a, b) => Math.abs(a.missionTime - b.missionTime) < 1e-6 && a.alarm === b.alarm && a.hacked === b.hacked && a.guard.every((g, i) => Math.abs(g.x - b.guard[i].x) < 1e-6 && Math.abs(g.y - b.guard[i].y) < 1e-6 && g.wpi === b.guard[i].wpi);
const positive = same(samples[0], samples[1]) && same(samples[1], samples[2]);
const mutant = structuredClone(samples[2]); mutant.guard[0].x += 0.1;
const negative = !same(samples[0], mutant);
console.log('refresh determinism', JSON.stringify({ samples, positive, negativeControl: negative }));
await browser.close();
if (!positive || !negative) process.exit(1);
