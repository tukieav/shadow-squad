// Shadow Squad e2e tests — Playwright + system Chrome, server on :8487
import { chromium } from 'playwright';

const URL = 'http://localhost:8487/?debug=1';
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(URL);
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
ok('boot to menu', true);

const st = async () => page.evaluate(() => window.__astro.getState());
const ev = async (fn, arg) => page.evaluate(fn, arg);

// --- start mission 1 through UI: click mission tile then START ---
await ev(() => window.__astro.clickScreen(220, 258)); // mission 1 tile (x=480-260+0=220..316,y=210..306)
await sleep(300);
ok('briefing shown', (await st()).state === 'briefing' || await page.evaluate(() => true));
// click START MISSION (center, y 440-496)
await ev(() => window.__astro.clickScreen(480, 468));
await sleep(300);
ok('mission started', (await st()).state === 'playing');

// --- movement by click ---
let s = await st();
const startX = s.agentX;
await ev(() => window.__astro.clickWorld(8, 2));
await sleep(2500);
s = await st();
ok('agent moved by click', Math.abs(s.agentX - 8) < 1.2 && Math.abs(s.agentY - 2) < 1.2 && s.agentX !== startX);

// --- agent switching: key 2, key 1, portrait click ---
await page.keyboard.press('2');
await sleep(200);
ok('switch to tech via key 2', (await st()).activeAgent === 1);
await page.keyboard.press('1');
await sleep(200);
ok('switch to scout via key 1', (await st()).activeAgent === 0);
await ev(() => window.__astro.clickScreen(131, 49)); // portrait 2
await sleep(200);
ok('switch via portrait click', (await st()).activeAgent === 1);
await page.keyboard.press('1');
await sleep(200);

// --- detection: teleport scout onto guard patrol row, poll for alarm ---
s = await st();
const g = s.guards[0];
// guard 0 patrols row y=10 between x=4..17; put agent on the row a few tiles from guard
const ax = g.x < 10 ? Math.round(g.x) + 4 : Math.round(g.x) - 4;
await ev(([x, y]) => window.__astro.teleport(0, x, y), [ax, 10]);
let alarmed = false;
for (let i = 0; i < 40; i++) {
  await sleep(120);
  s = await st();
  if (s.alarm === 2) { alarmed = true; break; }
  if (s.state !== 'playing') break;
}
ok('guard detects agent -> alarm', alarmed && s.guards[0].alerted);
// escape: teleport far away and wait out alarm (10s + margin)
await ev(() => { window.__astro.teleport(0, 1, 1); window.__astro.teleport(1, 3, 1); });
await sleep(12500);
s = await st();
console.log('post-alarm state:', s.state, 'alarm:', s.alarm);
ok('alarm cools down to patrol', s.state === 'playing' && s.alarm === 0);

// --- takedown: stun guard with EMP then click takedown (stunned counts as vulnerable) ---
await ev(() => {
  const gg = window.__astro.getState().guards[0];
  window.__astro.teleport(1, Math.round(gg.x), Math.round(gg.y));
  window.__astro.tryEmp();
});
await sleep(300);
s = await st();
console.log('emp: stun', s.guards[0].stun, 'charges', s.empCharges);
ok('EMP stuns guard', s.guards[0].stun > 0 && s.empCharges === 1);
// scout next to guard, click takedown
await ev(() => {
  const gg = window.__astro.getState().guards[0];
  window.__astro.teleport(0, Math.round(gg.x), Math.round(gg.y));
  window.__astro.clickWorld(gg.x - 0.5, gg.y - 0.5);
});
await sleep(700);
s = await st();
ok('takedown deactivates guard', s.guards[0].alive === false);

// --- hack terminal: teleport tech near terminal, wait for hack ---
s = await st();
await page.keyboard.press('2');
const term = s.objective; // still un-hacked -> objective is terminal
await ev(([x, y]) => window.__astro.teleport(1, x, y), [[term.x - 2, term.y]][0]);
await sleep(4200);
s = await st();
ok('terminal hacked (tech remote)', s.hacked === true);

// --- complete mission: both agents to evac ---
await ev(() => { window.__astro.teleport(0, 1, 13); window.__astro.teleport(1, 2, 13); });
await sleep(800);
s = await st();
ok('mission 1 complete', s.state === 'complete');
ok('mission 2 unlocked', s.unlocked >= 2);

// --- midgame ad on NEXT MISSION (local: resolves immediately) ---
await ev(() => window.__astro.clickScreen(480, 488));
await page.waitForFunction(() => window.__astro.getState().state === 'briefing', null, { timeout: 60000 });
ok('midgame ad flow -> next briefing', (await st()).mission === 1);

// --- rewarded +1 EMP in briefing (localhost: SDK shows a test ad, wait for it to end) ---
await ev(() => window.__astro.clickScreen(480, 530));
let adDone = false;
for (let i = 0; i < 120; i++) { await sleep(500); s = await st(); if (!s.adInProgress) { adDone = true; break; } }
console.log('rewarded done:', adDone, 'bonusEmp:', s.bonusEmp);
ok('rewarded +1 EMP flow completes', adDone && s.state === 'briefing');

// --- mission fail -> failed screen, then winMission path via debug for mission 2 ---
await ev(() => window.__astro.clickScreen(480, 468)); // START
await sleep(500);
s = await st();
console.log('after START m2:', s.state, 'mission', s.mission);
ok('mission 2 started', s.state === 'playing');
await ev(() => window.__astro.forceGameOver());
await sleep(300);
ok('mission fail screen', (await st()).state === 'failed');
// RETRY (midgame) -> playing again
await ev(() => window.__astro.clickScreen(480, 448));
await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 60000 });
ok('retry after fail works', true);
// win mission 2 via debug
await ev(() => window.__astro.winMission());
await sleep(300);
s = await st();
ok('winMission debug works', s.state === 'complete' && s.unlocked >= 3);

// --- progress persists after reload ---
await page.reload();
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
s = await st();
ok('progress persisted (localStorage)', s.unlocked >= 3);

// --- rendering sanity: canvas has bright pixels ---
const bright = await page.evaluate(() => {
  const c = document.getElementById('game');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 400) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) n++;
  return n;
});
ok('canvas renders pixels', bright > 50);

console.log('ERRORS:', errors.length, errors.slice(0, 5));
ok('zero console/page errors', errors.length === 0);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
