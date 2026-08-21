// Shadow Squad e2e tests — Playwright + system Chrome, server on :8532
import { chromium } from 'playwright';

const URL = 'http://localhost:8532/?debug=1';
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('HTML5 SDK')) errors.push('console: ' + m.text());
});

await page.goto(URL);
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
ok('boot to menu', true);

const st = async () => page.evaluate(() => window.__astro.getState());
const ev = async (fn, arg) => page.evaluate(fn, arg);

let s = await st();
ok('10 missions present', s.missionCount === 10);

// --- start mission 1 through UI: click mission tile then START ---
await ev(() => window.__astro.clickScreen(268, 166)); // mission 1 tile (row1: y=118..214)
await sleep(300);
s = await st();
ok('briefing shown', s.state === 'briefing');
// click START MISSION (center, y 440-496)
await ev(() => window.__astro.clickScreen(480, 468));
await sleep(300);
ok('mission started', (await st()).state === 'playing');

// --- movement by click ---
s = await st();
const startX = s.agentX;
await ev(() => window.__astro.clickWorld(8, 2));
await sleep(2500);
s = await st();
ok('agent moved by click', Math.abs(s.agentX - 8) < 1.2 && Math.abs(s.agentY - 2) < 1.2 && s.agentX !== startX);

// --- agent switching: key 2, key 1, portrait click ---
await page.keyboard.down('2'); await sleep(120); await page.keyboard.up('2');
await sleep(200);
ok('switch to tech via key 2', (await st()).activeAgent === 1);
await page.keyboard.down('1'); await sleep(120); await page.keyboard.up('1');
await sleep(200);
ok('switch to scout via key 1', (await st()).activeAgent === 0);
await ev(() => window.__astro.clickScreen(131, 49)); // portrait 2
await sleep(200);
ok('switch via portrait click', (await st()).activeAgent === 1);
await page.keyboard.down('1'); await sleep(120); await page.keyboard.up('1');
await sleep(200);

// --- detection: teleport scout onto guard patrol row, poll for alarm ---
s = await st();
const g = s.guards[0];
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
ok('alarm cools down to patrol', s.state === 'playing' && s.alarm === 0);

// --- takedown: stun guard with EMP then click takedown ---
await ev(() => {
  const gg = window.__astro.getState().guards[0];
  window.__astro.teleport(1, Math.round(gg.x), Math.round(gg.y));
  window.__astro.tryEmp();
});
await sleep(300);
s = await st();
ok('EMP stuns guard', s.guards[0].stun > 0 && s.empCharges === 1);
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
await page.keyboard.down('2'); await sleep(120); await page.keyboard.up('2');
const term = s.objective;
await ev(([x, y]) => window.__astro.teleport(1, x, y), [term.x - 2, term.y]);
await sleep(4200);
s = await st();
ok('terminal hacked (tech remote)', s.hacked === true);

// --- complete mission: both agents to evac ---
await ev(() => { window.__astro.teleport(0, 1, 13); window.__astro.teleport(1, 2, 13); });
await sleep(800);
s = await st();
ok('mission 1 complete', s.state === 'complete');
ok('mission 2 unlocked', s.unlocked >= 2);
ok('stars awarded', (s.stars['0'] || s.stars[0] || 0) >= 1);
ok('intel earned', s.intel > 0);

// --- midgame ad on NEXT MISSION (local: resolves immediately) ---
await ev(() => window.__astro.clickScreen(480, 488));
await page.waitForFunction(() => window.__astro.getState().state === 'briefing', null, { timeout: 60000 });
ok('midgame ad flow -> next briefing', (await st()).mission === 1);

// --- rewarded +1 EMP in briefing (localhost: SDK may show a test ad) ---
await ev(() => window.__astro.clickScreen(480, 530));
let adDone = false;
for (let i = 0; i < 120; i++) { await sleep(500); s = await st(); if (!s.adInProgress) { adDone = true; break; } }
ok('rewarded +1 EMP flow completes', adDone && s.state === 'briefing');

// --- mission fail -> failed screen -> retry ---
await ev(() => window.__astro.clickScreen(480, 468)); // START
await sleep(500);
s = await st();
ok('mission 2 started', s.state === 'playing');
await ev(() => window.__astro.forceGameOver());
await sleep(300);
ok('mission fail screen', (await st()).state === 'failed');
await ev(() => window.__astro.clickScreen(480, 448)); // RETRY (midgame)
await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 60000 });
ok('retry after fail works', true);
await ev(() => window.__astro.winMission());
await sleep(300);
s = await st();
ok('winMission debug works', s.state === 'complete' && s.unlocked >= 3);

// ============ NEW SYSTEMS ============

// --- mission 6 (NIGHT WATCH): rotating cameras exist and sweep ---
await ev(() => { window.__astro.setUnlocked(10); window.__astro.setMission(5); });
await sleep(300);
s = await st();
ok('setMission(5) starts mission 6', s.state === 'playing' && s.mission === 5);
ok('cameras present in mission 6', s.cameras.length === 2);
const f0 = s.cameras[0].facing;
await sleep(1500);
s = await st();
ok('camera rotates', Math.abs(s.cameras[0].facing - f0) > 0.02);
// camera detection: put scout right below camera 0 (base 1.57 = down), open row y=6
await ev(() => {
  const c = window.__astro.getState().cameras[0];
  window.__astro.teleport(0, Math.floor(c.x), Math.floor(c.y) + 2);
});
let camAlarm = false;
for (let i = 0; i < 50; i++) {
  await sleep(120);
  s = await st();
  if (s.alarm >= 1) { camAlarm = true; break; }
  if (s.state !== 'playing') break;
}
ok('camera detects agent', camAlarm);

// --- mission 7 (LASER VAULT): laser gate blocks until hack ---
await ev(() => window.__astro.setMission(6));
await sleep(300);
s = await st();
ok('mission 7 started', s.state === 'playing' && s.mission === 6);
// evac is behind laser row y=13 (L at x=13,14). Teleport both agents just above, try to path through
await ev(() => { window.__astro.teleport(0, 13, 12); window.__astro.clickWorld(14, 15); });
await sleep(2500);
s = await st();
const blockedByLaser = Math.abs(s.agents[0].y - 15) > 1.5; // could not reach evac side
ok('laser gate blocks before hack', blockedByLaser);
await ev(() => window.__astro.hackAll());
await sleep(200);
await ev(() => window.__astro.clickWorld(14, 15));
await sleep(3500);
s = await st();
ok('laser gate opens after hack', Math.abs(s.agents[0].x - 14) < 1.5 && Math.abs(s.agents[0].y - 15) < 1.5);

// --- mission 8 (IRONCLAD): elite guard resists frontal takedown, dies when stunned ---
await ev(() => window.__astro.setMission(7));
await sleep(300);
s = await st();
const eIdx = s.guards.findIndex(gg => gg.elite);
ok('elite guard present in mission 8', eIdx >= 0);
await ev((idx) => {
  const gg = window.__astro.getState().guards[idx];
  // approach from behind (guard faces along patrol) — should NOT take down
  window.__astro.teleport(0, Math.round(gg.x), Math.round(gg.y));
  window.__astro.clickWorld(gg.x - 0.4, gg.y - 0.4);
}, eIdx);
await sleep(900);
s = await st();
ok('elite resists takedown without stun', s.guards[eIdx].alive === true);
await ev((idx) => {
  const gg = window.__astro.getState().guards[idx];
  window.__astro.teleport(1, Math.round(gg.x), Math.round(gg.y));
  window.__astro.tryEmp();
}, eIdx);
await sleep(300);
await ev((idx) => {
  const gg = window.__astro.getState().guards[idx];
  window.__astro.teleport(0, Math.round(gg.x), Math.round(gg.y));
  window.__astro.clickWorld(gg.x - 0.4, gg.y - 0.4);
}, eIdx);
await sleep(900);
s = await st();
ok('elite falls when stunned', s.guards[eIdx].alive === false);

// --- mission 9 (TWIN LOCKS): two terminals, sync window resets ---
await ev(() => window.__astro.setMission(8));
await sleep(300);
s = await st();
ok('mission 9 has 2 terminals', s.terminals.length === 2);
// hack only terminal A (scout adjacent + tech far) and wait > sync window
await ev(() => {
  const t = window.__astro.getState().terminals[0];
  window.__astro.teleport(1, t.x - 2, t.y);
});
await page.waitForFunction(() => window.__astro.getState().terminals[0].done, null, { timeout: 10000 });
await ev(() => window.__astro.teleport(1, 1, 1)); // walk away, let sync expire
await sleep(7500);
s = await st();
ok('sync window resets lone hacked terminal', s.terminals[0].done === false && s.hacked === false);
// now hack both: tech at T0, scout at T1
await ev(() => {
  const ts = window.__astro.getState().terminals;
  window.__astro.teleport(1, ts[0].x - 2, ts[0].y);
  window.__astro.teleport(0, ts[1].x - 1, ts[1].y);
});
let bothHacked = false;
for (let i = 0; i < 80; i++) {
  await sleep(200);
  s = await st();
  if (s.hacked) { bothHacked = true; break; }
  if (s.state !== 'playing') break;
}
ok('both terminals hacked within sync window', bothHacked);

// --- shop: buy upgrade with intel, persists ---
await ev(() => window.__astro.forceGameOver());
await sleep(200);
await ev(() => window.__astro.clickScreen(480, 570)); // MENU on failed screen
await sleep(400);
s = await st();
ok('back to menu', s.state === 'menu');
await ev(() => window.__astro.addIntel(100));
await ev(() => window.__astro.clickScreen(890, 36)); // SHOP button
await sleep(300);
s = await st();
ok('shop opens', s.state === 'shop');
const intelBefore = s.intel;
await ev(() => window.__astro.clickScreen(252, 235)); // first gadget card (+1 EMP SLOT)
await sleep(300);
s = await st();
ok('bought +1 EMP slot', s.upgrades.emp === 1 && s.intel === intelBefore - 30);
// buy skin
await ev(() => window.__astro.clickScreen(477, 435)); // second skin (crimson)
await sleep(300);
s = await st();
ok('bought + equipped skin', s.ownedSkins.crimson === true && s.skin === 'crimson');
await ev(() => window.__astro.clickScreen(80, 41)); // BACK
await sleep(300);
ok('shop back to menu', (await st()).state === 'menu');

// --- upgrade affects gameplay: EMP charges = base 2 + upgrade 1 (+ any bonusEmp) ---
await ev(() => window.__astro.setMission(0));
await sleep(300);
s = await st();
ok('EMP upgrade grants extra charge', s.empCharges === 2 + 1 + s.bonusEmp);

// --- quick play from menu ---
await ev(() => window.__astro.forceGameOver());
await sleep(200);
await ev(() => window.__astro.clickScreen(480, 570));
await sleep(300);
await ev(() => window.__astro.clickScreen(480, 373)); // PLAY MISSION N (quick play)
await sleep(400);
s = await st();
ok('quick play starts mission', s.state === 'playing');
await ev(() => window.__astro.forceGameOver());
await sleep(200);

// --- progress + meta persist after reload ---
await page.reload();
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
s = await st();
ok('progress persisted (unlocked)', s.unlocked >= 3);
ok('meta persisted (upgrades+skin+intel)', s.upgrades.emp === 1 && s.skin === 'crimson' && s.intel > 0);
ok('streak active', s.streak >= 1);

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

// --- desktop-first viewport: canvas fills the full window (no letterbox bars) ---
const vp = await page.evaluate(() => {
  const c = document.getElementById('game');
  const r = c.getBoundingClientRect();
  const v = window.__astro.getViewport();
  return { rw: r.width, rh: r.height, iw: window.innerWidth, ih: window.innerHeight, ...v };
});
ok('canvas fills window width', Math.abs(vp.rw - vp.iw) < 2);
ok('canvas fills window height', Math.abs(vp.rh - vp.ih) < 2);
ok('internal resolution matches window', Math.abs(vp.w - vp.iw) < 2 && Math.abs(vp.h - vp.ih) < 2);

// --- edge-to-edge density: no pure-black bands at screen edges during gameplay ---
await ev(() => { window.__astro.setUnlocked(10); window.__astro.setMission(0); });
await sleep(700);
const edges = await page.evaluate(() => {
  const c = document.getElementById('game');
  const g = c.getContext('2d');
  const bandDark = (x, y, w, h) => {
    const d = g.getImageData(x, y, w, h).data;
    let lit = 0, tot = 0;
    for (let i = 0; i < d.length; i += 16) { tot++; if (d[i] + d[i + 1] + d[i + 2] > 24) lit++; }
    return lit / tot;
  };
  return {
    left: bandDark(0, 0, 40, c.height),
    right: bandDark(c.width - 40, 0, 40, c.height),
    top: bandDark(0, 0, c.width, 40),
    bottom: bandDark(0, c.height - 40, c.width, 40),
  };
});
ok('left edge alive (no black bar)', edges.left > 0.25);
ok('right edge alive (no black bar)', edges.right > 0.25);
ok('top edge alive (no black bar)', edges.top > 0.25);
ok('bottom edge alive (no black bar)', edges.bottom > 0.25);

// --- wide screens (>=1180px) show the tactical side panel ---
ok('side panel visible on wide viewport', (await page.evaluate(() => window.__astro.getViewport())).sidePanel === true);

// --- softer failure: early-mission catch gives a CLOSE CALL grace, not instant fail ---
await ev(() => window.__astro.setMission(0));
await sleep(400);
let graceSurvived = false;
// stand in front of the guard until the alarm trips (mission 1 detect time ~1.6s)
await ev(() => {
  const gg = window.__astro.getState().guards[0];
  window.__astro.teleport(0, Math.round(gg.x + Math.cos(gg.facing) * 3), Math.round(gg.y + Math.sin(gg.facing) * 3));
});
for (let i = 0; i < 40; i++) {
  await sleep(150);
  s = await st();
  if (s.alarm === 2) break;
  if (s.state !== 'playing') break;
  // keep standing in the cone
  await ev(() => {
    const gg = window.__astro.getState().guards[0];
    window.__astro.teleport(0, Math.round(gg.x + Math.cos(gg.facing) * 3), Math.round(gg.y + Math.sin(gg.facing) * 3));
  });
}
// now let the chasing guard reach the agent -> should trigger grace, not fail
for (let i = 0; i < 40; i++) {
  await sleep(150);
  s = await st();
  if (s.state !== 'playing') break;
  if (s.guards[0].stun > 0) { graceSurvived = true; break; }
  await ev(() => {
    const gg = window.__astro.getState().guards[0];
    window.__astro.teleport(0, Math.round(gg.x), Math.round(gg.y));
  });
}
ok('first catch in mission 1 = grace (still playing)', graceSurvived && s.state === 'playing');
await ev(() => window.__astro.forceGameOver());
await sleep(200);
await ev(() => window.__astro.clickScreen(480, 570));
await sleep(300);

// screenshot for vision check
await page.screenshot({ path: '/tmp/shadow-squad-menu.png' });
console.log('screenshot: /tmp/shadow-squad-menu.png');

console.log('ERRORS:', errors.length, errors.slice(0, 5));
ok('zero console/page errors', errors.length === 0);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
