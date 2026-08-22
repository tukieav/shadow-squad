// Fixed review-sized evidence for the Round 4 cover and first-impression work.
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8532';
const mediaRoot = process.env.MEDIA_ROOT || base;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const errors = [];

const gallery = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
gallery.on('pageerror', error => errors.push(`covers: ${error.message}`));
await gallery.setContent(`<!doctype html><style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:linear-gradient(135deg,#1b7cdc,#754ccc);display:grid;place-items:center}
  main{height:470px;width:870px;display:flex;align-items:center;justify-content:center;gap:18px}
  img{display:block;object-fit:contain;filter:drop-shadow(0 10px 15px rgba(17,23,93,.42))}
  .wide{width:400px;height:225px}.square{width:205px;height:205px}.tall{width:150px;height:225px}
</style><main><img class="wide" src="${mediaRoot}/marketing/cover-16x9.png"><img class="square" src="${mediaRoot}/marketing/cover-1x1.png"><img class="tall" src="${mediaRoot}/marketing/cover-2x3.png"></main>`);
await gallery.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
await gallery.screenshot({ path: 'qa/round4-covers-907x510.png' });
await gallery.close();

const menu = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 });
menu.on('pageerror', error => errors.push(`menu: ${error.message}`));
await menu.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
await menu.goto(`${base}/?debug=1`);
await menu.waitForFunction(() => window.__astro?.getState().state === 'menu');
await menu.waitForTimeout(650);
await menu.screenshot({ path: 'qa/round4-menu-907x510.png' });
await menu.close();
await browser.close();
console.log('round 4 proof screenshots', JSON.stringify({ errors }));
process.exit(errors.length ? 1 : 0);
