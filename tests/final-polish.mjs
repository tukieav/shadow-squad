// Regression coverage for the three defects documented in FINAL_POLISH_AUDIT.
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8532';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
let failed = 0;
const ok = (name, value, detail = '') => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`);
  if (!value) failed++;
};

async function debugPage(viewport = { width: 907, height: 510 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: viewport.width === 390, hasTouch: viewport.width === 390 });
  await page.route('**/crazygames-sdk-v3.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.goto(`${base}/?debug=1`);
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  return page;
}

// 1) One sentry owns one detection meter, independent of squad count.
{
  const page = await debugPage();
  const expose = async (twoAgents) => {
    await page.evaluate(() => window.__astro.setMission(2));
    await page.waitForTimeout(50);
    await page.evaluate((two) => {
      const g = window.__astro.getState().guards[0];
      const x = Math.floor(g.x) + 3, y = Math.floor(g.y);
      window.__astro.teleport(0, x, y);
      window.__astro.teleport(1, two ? x : 1, two ? y : 1);
    }, twoAgents);
    await page.waitForTimeout(500);
    return page.evaluate(() => window.__astro.getState());
  };
  const single = await expose(false);
  const squad = await expose(true);
  ok('one visible agent is still warning at 500ms', single.alarm === 1 && single.guards[0].detect > 0 && single.guards[0].detect < 0.8);
  ok('two visible agents do not accelerate one sentry meter', squad.alarm === 1 && squad.guards[0].detect > 0 && squad.guards[0].detect < 0.8);
  const mutant = { ...squad, alarm: 2 };
  ok('mutation control rejects accelerated alarm', mutant.alarm !== squad.alarm);
  await page.close();
}

// 2) A safe reset restores earned tactical state instead of rebuilding threats.
{
  const page = await debugPage();
  await page.evaluate(() => window.__astro.setMission(0));
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const g = window.__astro.getState().guards[0];
    window.__astro.teleport(1, Math.floor(g.x), Math.floor(g.y));
    window.__astro.tryEmp();
    window.__astro.teleport(0, Math.floor(g.x), Math.floor(g.y));
    window.__astro.clickWorld(Math.floor(g.x), Math.floor(g.y));
  });
  await page.waitForTimeout(700);
  const neutralized = await page.evaluate(() => window.__astro.getState());
  await page.waitForTimeout(1800); // wait for the calm safe snapshot
  await page.evaluate(() => window.__astro.forceGameOver());
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__astro.clickScreen(480, 516));
  await page.waitForTimeout(160);
  const restored = await page.evaluate(() => window.__astro.getState());
  ok('checkpoint captures a neutralized sentry', neutralized.guards[0].alive === false);
  ok('checkpoint reset keeps neutralized sentry and takedown', restored.state === 'playing' && restored.guards[0].alive === false && restored.checkpointUsed === true);
  await page.close();
}

// 3) The narrow touch HUD reserves the fixed agent-switch controls.
{
  const page = await debugPage({ width: 390, height: 844 });
  await page.evaluate(() => window.__astro.setMission(0));
  await page.waitForTimeout(100);
  const layout = await page.evaluate(() => window.__astro.getHudLayout());
  ok('390px HUD leaves portraits unobstructed', layout.compact && !layout.portraitOverlap && layout.mission.x > layout.portraits[1].x + layout.portraits[1].w && layout.cue.y > layout.portraits[0].y + layout.portraits[0].h);
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
