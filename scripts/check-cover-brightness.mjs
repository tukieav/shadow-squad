// Submission-cover luminance gate. Uses the browser's canvas decoder so it
// measures the exact PNG pixels submitted with the game rather than a preview.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const covers = [
  'marketing/cover-16x9.png',
  'marketing/cover-2x3.png',
  'marketing/cover-1x1.png',
];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
let failed = false;
for (const file of covers) {
  const page = await browser.newPage();
  const encoded = `data:image/png;base64,${readFileSync(resolve(file)).toString('base64')}`;
  const metrics = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lumSum = 0, dark = 0, satSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) * 255;
      lumSum += lum;
      if (lum < 40) dark++;
      const light = (max + min) / 2;
      satSum += max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
    }
    const n = data.length / 4;
    return { meanLum: lumSum / n, darkFrac: dark / n, meanSat: satSum / n };
  }, encoded);
  await page.close();
  const pass = metrics.meanLum >= 80 && metrics.darkFrac <= 0.35 && metrics.meanSat >= 0.35;
  console.log(`${file} meanLum=${metrics.meanLum.toFixed(2)} darkFrac=${metrics.darkFrac.toFixed(4)} meanSat=${metrics.meanSat.toFixed(4)} ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
