// Records a gameplay-only submission preview, then prepends the exact cover frame.
// The raw WebM lives in /tmp and is removed after conversion.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2] || 'landscape';
const base = process.env.BASE_URL || 'http://localhost:8532';
const size = mode === 'portrait' ? { width: 720, height: 1080 } : { width: 1920, height: 1080 };
const output = `marketing/video-${mode}.mp4`;
const cover = mode === 'portrait' ? 'marketing/cover-2x3.png' : 'marketing/cover-16x9.png';
const rawDir = mkdtempSync(join(tmpdir(), `shadow-squad-${mode}-`));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ viewport: size, recordVideo: { dir: rawDir, size } });
const page = await context.newPage();
await page.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
await page.goto(`${base}/?debug=1`);
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
// Begin recording in a rich mission, never showing menu, ads, results, or failure.
await page.evaluate(() => { window.__astro.setMission(3); window.__astro.clickWorld(10, 6); });
await sleep(2600);
await page.evaluate(() => { window.__astro.clickWorld(17, 11); });
await sleep(2600);
await page.keyboard.press('2');
await page.evaluate(() => { const g = window.__astro.getState().guards[0]; window.__astro.teleport(1, Math.round(g.x), Math.round(g.y) + 1); window.__astro.tryEmp(); });
await sleep(1300);
await page.evaluate(() => window.__astro.clickWorld(14, 12));
await sleep(8800);
const video = page.video();
await context.close();
await browser.close();
try {
  const duration = '15.4';
  const scale = `${size.width}:${size.height}`;
  // Trim the setup/menu lead-in from the raw recording. The cover is held for 0.7s,
  // so the encoded first frame is the corresponding submission cover.
  execFileSync('ffmpeg', [
    '-y', '-loop', '1', '-t', '0.7', '-i', cover, '-ss', '1.2', '-i', await video.path(),
    '-filter_complex', `[0:v]scale=${scale},setsar=1[vcover];[1:v]scale=${scale},setsar=1,trim=duration=${duration},setpts=PTS-STARTPTS[vplay];[vcover][vplay]concat=n=2:v=1:a=0[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ], { stdio: 'inherit' });
  console.log('recorded', output);
} finally {
  rmSync(rawDir, { recursive: true, force: true });
}
