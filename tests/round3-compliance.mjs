// Round 3 regression: physical keyboard codes must work when displayed keys differ.
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8532';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
const page = await context.newPage();
let failed = 0;
const ok = (name, value) => { console.log(`${value ? 'PASS' : 'FAIL'} ${name}`); if (!value) failed++; };

await page.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
await page.goto(`${base}/?debug=1`);
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
await page.evaluate(() => window.__astro.setMission(0));
ok('first-run control card is visible in gameplay', await page.evaluate(() => window.__astro.getState().onboardingActive));

// Simulate AZERTY text input: only code is a valid source of the action.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: 'é', bubbles: true, cancelable: true })));
await page.waitForTimeout(80);
ok('Digit2 switches agent despite an AZERTY character key', await page.evaluate(() => window.__astro.getState().activeAgent === 1));
ok('first successful input dismisses the control card', await page.evaluate(() => !window.__astro.getState().onboardingActive));
const before = await page.evaluate(() => window.__astro.getState().empCharges);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'r', bubbles: true, cancelable: true })));
await page.waitForTimeout(80);
ok('KeyE activates EMP regardless of key text', await page.evaluate((charges) => window.__astro.getState().empCharges === charges - 1, before));
await page.evaluate(() => window.__astro.teleport(1, 6, 6));
const startY = await page.evaluate(() => window.__astro.getState().agentY);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'z', bubbles: true, cancelable: true })));
await page.waitForTimeout(900);
ok('KeyW moves the player when the AZERTY key text is z', await page.evaluate((y) => window.__astro.getState().agentY < y - 0.1, startY));

await page.reload();
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
await page.evaluate(() => window.__astro.setMission(0));
ok('saved onboarding does not reappear', await page.evaluate(() => !window.__astro.getState().onboardingActive));
await browser.close();
process.exit(failed ? 1 : 0);
