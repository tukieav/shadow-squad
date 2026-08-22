// Records a short, gameplay-only submission preview and immediately converts it
// to MP4. The raw WebM lives in /tmp and is removed after conversion.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2] || 'landscape';
const base = process.env.BASE_URL || 'http://localhost:8532';
const size = mode === 'portrait' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
const output = `marketing/video-${mode}.mp4`;
const rawDir = mkdtempSync(join(tmpdir(), `shadow-squad-${mode}-`));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ viewport: size, recordVideo: { dir: rawDir, size } });
const page = await context.newPage();
await page.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
await page.goto(`${base}/?debug=1`);
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
// Begin recording in a rich mission, never showing menu, ad, results, or failure.
await page.evaluate(() => { window.__astro.setMission(3); window.__astro.clickWorld(10, 6); });
await sleep(2600);
await page.evaluate(() => { window.__astro.clickWorld(17, 11); });
await sleep(2600);
await page.keyboard.press('2');
await page.evaluate(() => { const g = window.__astro.getState().guards[0]; window.__astro.teleport(1, Math.round(g.x), Math.round(g.y) + 1); window.__astro.tryEmp(); });
await sleep(1300);
await page.evaluate(() => window.__astro.clickWorld(14, 12));
await sleep(4100);
const video = page.video();
await context.close();
await browser.close();
try {
  execFileSync('ffmpeg', ['-y', '-i', await video.path(), '-t', '14', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { stdio: 'inherit' });
  console.log('recorded', output);
} finally {
  rmSync(rawDir, { recursive: true, force: true });
}
