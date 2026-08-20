// Shadow Squad — real-time tactics stealth (Commandos-like) for CrazyGames
// No blood: enemies are robot sentries that deactivate with sparks.
import { MISSIONS } from './maps.js';
import * as SDK from './sdk.js';
import * as AUDIO from './audio.js';

const TILE = 40;
const GAME_W = 960, GAME_H = 600;
const DETECT_TIME = 0.8;       // seconds in cone before alarm
const ALARM_COOLDOWN = 10;     // seconds without contact -> back to patrol
const EMP_RADIUS = 3 * TILE;
const EMP_STUN = 5;
const HACK_TIME = 3.0;
const CATCH_DIST = 0.55 * TILE;

const canvas = document.getElementById('game');
canvas.width = GAME_W; canvas.height = GAME_H;
const ctx = canvas.getContext('2d');

function resize() {
  const s = Math.min(window.innerWidth / GAME_W, window.innerHeight / GAME_H);
  canvas.style.width = (GAME_W * s) + 'px';
  canvas.style.height = (GAME_H * s) + 'px';
}
window.addEventListener('resize', resize); resize();

// ---------- state ----------
let state = 'boot'; // boot|menu|briefing|playing|complete|failed|shop
let missionIdx = 0;
let unlocked = 1;
let level = null;         // parsed level
let agents = [];          // [scout, tech]
let activeAgent = 0;
let guards = [];
let cameras = [];
let bodies = [];
let particles = [];
let rings = [];
let footprints = [];
let floats = [];
let alarm = 0;            // 0 calm, 1 suspicious(yellow), 2 alarm(red)
let alarmTimer = 0;
let missionTime = 0;
let takedowns = 0;
let alarmsRaised = 0;
let empCharges = 2;
let bonusEmp = 0;         // rewarded +1 EMP for this mission
let hacked = false;       // all terminals done
let terminals = [];       // [{x,y,progress,done,lock}]
let hackProgress = 0;     // legacy mirror (first terminal) for debug
let checkpointUsed = false;   // rewarded retry-from-checkpoint used this mission
let startFromCheckpoint = false;
let cam = { x: 0, y: 0 };
let camFollow = true;
let shake = 0;
let adInProgress = false;
let lastStats = null;
let menuScroll = 0;
let rmbDrag = null;
let hoverGuard = -1;

// ---------- meta-progression (persisted) ----------
let intel = 0;                                   // currency from stars
let stars = {};                                  // missionIdx -> 0..3
let upgrades = { emp: 0, hack: 0, sprint: 0 };   // permanent gadgets
let skin = 'default';
let ownedSkins = { default: true };
let streak = 0;
let dailyBonus = 0;
let dailyToastT = 0;

const SKINS = {
  default: { name: 'CLASSIC', scout: '#3fd8ff', tech: '#ffab40', cost: 0 },
  crimson: { name: 'CRIMSON', scout: '#ff5470', tech: '#ffd166', cost: 20 },
  viridian: { name: 'VIRIDIAN', scout: '#43e97b', tech: '#b8ff5e', cost: 20 },
};
const SHOP_ITEMS = [
  { id: 'emp', name: '+1 EMP SLOT', desc: 'Start every mission with 3 EMP charges', cost: 30 },
  { id: 'hack', name: 'FAST HACK', desc: 'Terminals hack 35% faster', cost: 40 },
  { id: 'sprint', name: 'SPRINT SERVOS', desc: 'Both agents move 15% faster', cost: 40 },
];

function agentColor(kind) { const s = SKINS[skin] || SKINS.default; return kind === 'scout' ? s.scout : s.tech; }

function loadMeta() {
  intel = parseInt(SDK.loadData('intel', '0'), 10) || 0;
  try { stars = JSON.parse(SDK.loadData('stars', '{}')) || {}; } catch (e) { stars = {}; }
  upgrades.emp = parseInt(SDK.loadData('up.emp', '0'), 10) || 0;
  upgrades.hack = parseInt(SDK.loadData('up.hack', '0'), 10) || 0;
  upgrades.sprint = parseInt(SDK.loadData('up.sprint', '0'), 10) || 0;
  skin = SDK.loadData('skin', 'default');
  if (!SKINS[skin]) skin = 'default';
  try { ownedSkins = JSON.parse(SDK.loadData('skins', '{"default":true}')) || { default: true }; } catch (e) { ownedSkins = { default: true }; }
  ownedSkins.default = true;
  streak = parseInt(SDK.loadData('streak', '0'), 10) || 0;
}
function saveMeta() {
  SDK.saveData('intel', intel);
  SDK.saveData('stars', JSON.stringify(stars));
  SDK.saveData('up.emp', upgrades.emp);
  SDK.saveData('up.hack', upgrades.hack);
  SDK.saveData('up.sprint', upgrades.sprint);
  SDK.saveData('skin', skin);
  SDK.saveData('skins', JSON.stringify(ownedSkins));
}
function totalStars() { let n = 0; for (const k in stars) n += stars[k]; return n; }
function tickDailyStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const last = SDK.loadData('lastDay', '');
  if (last === today) return;
  const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  streak = (last === yest) ? streak + 1 : 1;
  dailyBonus = Math.min(streak * 5, 25);
  intel += dailyBonus;
  SDK.saveData('lastDay', today);
  SDK.saveData('streak', streak);
  SDK.saveData('intel', intel);
  dailyToastT = 6;
}

// ---------- level parsing ----------
function parseLevel(mi) {
  const m = MISSIONS[mi];
  const g = m.grid;
  const H = g.length, W = g[0].length;
  const tiles = [];
  let scout = null, tech = null;
  const terms = [];
  const evac = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      let c = g[y][x];
      if (c === 'S') { scout = { x, y }; c = '.'; }
      else if (c === 'T') { tech = { x, y }; c = '.'; }
      else if (c === 'X') { terms.push({ x, y }); c = '.'; }
      else if (c === 'E') { evac.push({ x, y }); c = '.'; }
      row.push(c);
    }
    tiles.push(row);
  }
  return { W, H, tiles, scout, tech, terms, evac, mission: m };
}
function blocked(l, x, y) {
  if (x < 0 || y < 0 || x >= l.W || y >= l.H) return true;
  const c = l.tiles[y][x];
  if (c === 'L') return !hacked; // laser gate opens once all terminals are hacked
  return c === '#' || c === 'B';
}
function solid(l, x, y) { // for LOS/raycast — lasers do not block sight
  if (x < 0 || y < 0 || x >= l.W || y >= l.H) return true;
  const c = l.tiles[y][x];
  return c === '#' || c === 'B';
}
function isGrass(l, x, y) {
  if (x < 0 || y < 0 || x >= l.W || y >= l.H) return false;
  return l.tiles[y][x] === ',';
}

// BFS pathfinding on grid
function findPath(l, sx, sy, tx, ty) {
  if (blocked(l, tx, ty)) {
    // find nearest walkable neighbor
    let best = null, bd = 1e9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (!blocked(l, nx, ny)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [nx, ny]; } }
    }
    if (!best) return null;
    tx = best[0]; ty = best[1];
  }
  const key = (x, y) => y * l.W + x;
  const prev = new Map();
  prev.set(key(sx, sy), -1);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === tx && y === ty) {
      const path = [];
      let k = key(x, y);
      let cx = x, cy = y;
      while (prev.get(k) !== -1) {
        path.push({ x: cx, y: cy });
        const p = prev.get(k);
        cx = p % l.W; cy = Math.floor(p / l.W);
        k = p;
      }
      path.reverse();
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      const nk = key(nx, ny);
      if (!blocked(l, nx, ny) && !prev.has(nk)) { prev.set(nk, key(x, y)); q.push([nx, ny]); }
    }
  }
  return null;
}

// LOS: sample along segment, blocked by walls/crates (lasers don't block sight)
function los(l, x0, y0, x1, y1) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / (TILE * 0.2)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    if (solid(l, Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}

// ---------- entities ----------
function makeAgent(kind, tile) {
  const sprintMult = 1 + upgrades.sprint * 0.15;
  return {
    kind, // 'scout'|'tech'
    x: (tile.x + 0.5) * TILE, y: (tile.y + 0.5) * TILE,
    path: [], speed: (kind === 'scout' ? 175 : 125) * sprintMult,
    facing: 0, moving: false,
    takedownTarget: -1,
    hacking: false,
    stepT: 0,
  };
}
function makeGuard(gdef) {
  const wps = gdef.wps;
  return {
    x: (wps[0][0] + 0.5) * TILE, y: (wps[0][1] + 0.5) * TILE,
    wps, wpi: 1 % wps.length,
    facing: 0, speed: 95, chaseSpeed: 165,
    detect: 0, stun: 0, alive: true,
    elite: !!gdef.elite,
    state: 'patrol', // patrol|chase|return
    target: null, repath: 0, path: [],
    seenBodies: new Set(),
  };
}
function makeCamera(cdef) {
  return { x: (cdef.x + 0.5) * TILE, y: (cdef.y + 0.5) * TILE, base: cdef.base, arc: cdef.arc, speed: cdef.speed, facing: cdef.base, detect: 0, stun: 0 };
}

function startMission(mi, opts = {}) {
  missionIdx = mi;
  hacked = !!opts.fromCheckpoint;   // must be set before parseLevel (laser gates)
  level = parseLevel(mi);
  agents = [makeAgent('scout', level.scout), makeAgent('tech', level.tech)];
  activeAgent = 0;
  guards = level.mission.guards.map(makeGuard);
  cameras = (level.mission.cameras || []).map(makeCamera);
  terminals = level.terms.map(t => ({ x: t.x, y: t.y, progress: hacked ? hackTimeFor() : 0, done: hacked, lock: 0 }));
  bodies = []; particles = []; rings = []; footprints = []; floats = [];
  alarm = 0; alarmTimer = 0; missionTime = 0; takedowns = 0; alarmsRaised = 0;
  empCharges = 2 + bonusEmp + upgrades.emp;
  hackProgress = hacked ? hackTimeFor() : 0;
  if (!opts.keepCheckpointUse) checkpointUsed = false;
  camFollow = true;
  cam.x = agents[0].x - GAME_W / 2; cam.y = agents[0].y - GAME_H / 2;
  clampCam();
  state = 'playing';
  SDK.gameplayStart();
}
function hackTimeFor() { return HACK_TIME * (1 - upgrades.hack * 0.35); }
// dynamic difficulty: missions 1-2 use narrower vision cones
function fovFor() { return missionIdx <= 1 ? 0.5 : 0.62; }

function clampCam() {
  const mw = level.W * TILE, mh = level.H * TILE;
  cam.x = Math.max(Math.min(cam.x, mw - GAME_W), Math.min(0, (mw - GAME_W) / 2));
  cam.y = Math.max(Math.min(cam.y, mh - GAME_H), Math.min(0, (mh - GAME_H) / 2));
  if (mw < GAME_W) cam.x = (mw - GAME_W) / 2;
  if (mh < GAME_H) cam.y = (mh - GAME_H) / 2;
}

// ---------- alarm / detection ----------
function raiseAlarm(px, py) {
  if (alarm !== 2) { alarmsRaised++; AUDIO.alarmSound(); }
  alarm = 2; alarmTimer = ALARM_COOLDOWN;
  shake = Math.min(shake + 6, 10);
  for (let i = 0; i < 3; i++) rings.push({ x: px, y: py, r: 10, max: 180 + i * 60, a: 1, delay: i * 0.25 });
  for (const g of guards) {
    if (!g.alive || g.stun > 0) continue;
    g.state = 'chase';
    g.target = { x: px, y: py };
    g.repath = 0;
  }
}

function agentHidden(a, g) {
  // grass hides beyond 2 tiles
  const tx = Math.floor(a.x / TILE), ty = Math.floor(a.y / TILE);
  if (!isGrass(level, tx, ty)) return false;
  return Math.hypot(a.x - g.x, a.y - g.y) > 2.2 * TILE;
}

function guardSees(g, px, py, fovOverride) {
  const d = Math.hypot(px - g.x, py - g.y);
  const range = alarm === 2 ? 7.5 * TILE : 6 * TILE;
  if (d > range) return false;
  const ang = Math.atan2(py - g.y, px - g.x);
  let da = Math.abs(((ang - g.facing) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
  const fov = fovOverride != null ? fovOverride : fovFor();
  if (da > fov) return false;
  return los(level, g.x, g.y, px, py);
}

// ---------- input ----------
function screenToWorld(e) {
  const r = canvas.getBoundingClientRect();
  const sx = (e.clientX - r.left) * (GAME_W / r.width);
  const sy = (e.clientY - r.top) * (GAME_H / r.height);
  return { sx, sy, wx: sx + cam.x, wy: sy + cam.y };
}

const UI = {
  portraits: [{ x: 12, y: 12, w: 74, h: 74 }, { x: 94, y: 12, w: 74, h: 74 }],
  empBtn: { x: GAME_W - 92, y: GAME_H - 92, w: 78, h: 78 },
};

function orderMove(a, wx, wy) {
  const p = findPath(level, Math.floor(a.x / TILE), Math.floor(a.y / TILE), Math.floor(wx / TILE), Math.floor(wy / TILE));
  if (p) {
    a.path = p; a.takedownTarget = -1;
    AUDIO.pingSound();
    floats.push({ x: wx, y: wy, t: 0.5, kind: 'marker' });
  }
}

function tryEmp() {
  const a = agents[1]; // tech carries EMP
  if (empCharges <= 0 || state !== 'playing') return;
  empCharges--;
  AUDIO.empSound();
  shake = 8;
  rings.push({ x: a.x, y: a.y, r: 5, max: EMP_RADIUS, a: 1, delay: 0, blue: true });
  for (const g of guards) {
    if (!g.alive) continue;
    if (Math.hypot(g.x - a.x, g.y - a.y) <= EMP_RADIUS) {
      g.stun = EMP_STUN; g.detect = 0;
      for (let i = 0; i < 12; i++) spawnSpark(g.x, g.y, '#7df');
    }
  }
  for (const c of cameras) {
    if (Math.hypot(c.x - a.x, c.y - a.y) <= EMP_RADIUS) {
      c.stun = EMP_STUN; c.detect = 0;
      for (let i = 0; i < 8; i++) spawnSpark(c.x, c.y, '#7df');
    }
  }
}

function doTakedown(gi) {
  const g = guards[gi];
  g.alive = false;
  takedowns++;
  bodies.push({ x: g.x, y: g.y, facing: g.facing });
  AUDIO.takedownSound();
  shake = 4;
  for (let i = 0; i < 22; i++) spawnSpark(g.x, g.y, i % 2 ? '#ffd45e' : '#7df');
  floats.push({ x: g.x, y: g.y - 20, t: 1, kind: 'text', text: 'SILENT TAKEDOWN', color: '#8f8' });
}

function spawnSpark(x, y, color) {
  const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 140;
  particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0.4 + Math.random() * 0.4, color });
}

let lastTapTime = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  AUDIO.unlockAudio();
  if (e.button === 2) { rmbDrag = { x: e.clientX, y: e.clientY }; return; }
  const { sx, sy, wx, wy } = screenToWorld(e);
  handleTap(sx, sy, wx, wy);
});
canvas.addEventListener('mousemove', (e) => {
  if (rmbDrag) {
    const r = canvas.getBoundingClientRect();
    const k = GAME_W / r.width;
    cam.x -= (e.clientX - rmbDrag.x) * k;
    cam.y -= (e.clientY - rmbDrag.y) * k;
    rmbDrag = { x: e.clientX, y: e.clientY };
    camFollow = false;
    clampCam();
  } else if (state === 'playing') {
    const { wx, wy } = screenToWorld(e);
    hoverGuard = -1;
    guards.forEach((g, i) => { if (g.alive && Math.hypot(g.x - wx, g.y - wy) < TILE * 0.7) hoverGuard = i; });
  }
});
window.addEventListener('mouseup', () => { rmbDrag = null; });

function handleTap(sx, sy, wx, wy) {
  if (adInProgress) return;
  if (state === 'menu') return menuTap(sx, sy);
  if (state === 'shop') return shopTap(sx, sy);
  if (state === 'briefing') return briefingTap(sx, sy);
  if (state === 'complete') return completeTap(sx, sy);
  if (state === 'failed') return failedTap(sx, sy);
  if (state !== 'playing') return;

  // HUD portraits
  for (let i = 0; i < 2; i++) {
    const p = UI.portraits[i];
    if (sx >= p.x && sx <= p.x + p.w && sy >= p.y && sy <= p.y + p.h) {
      if (activeAgent !== i) { activeAgent = i; camFollow = true; AUDIO.switchSound(); }
      return;
    }
  }
  // EMP button
  const b = UI.empBtn;
  if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) { tryEmp(); return; }

  const a = agents[activeAgent];
  // click on guard?
  for (let gi = 0; gi < guards.length; gi++) {
    const g = guards[gi];
    if (!g.alive) continue;
    if (Math.hypot(g.x - wx, g.y - wy) < TILE * 0.7) {
      if (a.kind === 'scout') {
        a.takedownTarget = gi;
        const p = findPath(level, Math.floor(a.x / TILE), Math.floor(a.y / TILE), Math.floor(g.x / TILE), Math.floor(g.y / TILE));
        if (p) a.path = p;
        return;
      }
    }
  }
  // click on terminal?
  for (const t of terminals) {
    if (t.done) continue;
    const tx = (t.x + 0.5) * TILE, ty = (t.y + 0.5) * TILE;
    if (Math.hypot(tx - wx, ty - wy) < TILE * 0.8) {
      orderMove(a, tx, ty);
      return;
    }
  }
  camFollow = true;
  orderMove(a, wx, wy);
}

window.addEventListener('keydown', (e) => {
  AUDIO.unlockAudio();
  if (e.key === '1' && state === 'playing') { if (activeAgent !== 0) { activeAgent = 0; camFollow = true; AUDIO.switchSound(); } }
  if (e.key === '2' && state === 'playing') { if (activeAgent !== 1) { activeAgent = 1; camFollow = true; AUDIO.switchSound(); } }
  if ((e.key === 'r' || e.key === 'R') && state === 'playing') tryEmp();
});

// touch: tap = move / all taps route through handleTap; double-tap portrait handled by same switch logic
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  AUDIO.unlockAudio();
  const t = e.changedTouches[0];
  const { sx, sy, wx, wy } = screenToWorld(t);
  handleTap(sx, sy, wx, wy);
}, { passive: false });

// ---------- screens tap handlers ----------
const menuButtons = [];
function menuTap(sx, sy) {
  // SHOP button
  if (sx >= GAME_W - 160 && sx <= GAME_W - 20 && sy >= 14 && sy <= 58) { state = 'shop'; AUDIO.switchSound(); return; }
  // QUICK PLAY: jump straight into the furthest unlocked mission
  if (sx >= GAME_W / 2 - 130 && sx <= GAME_W / 2 + 130 && sy >= 348 && sy <= 398) {
    missionIdx = Math.min(unlocked, MISSIONS.length) - 1; bonusEmp = 0;
    startMission(missionIdx);
    return;
  }
  for (const b of menuButtons) {
    if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h && b.mi < unlocked) {
      missionIdx = b.mi; bonusEmp = 0; state = 'briefing';
      return;
    }
  }
}
function briefingTap(sx, sy) {
  // START button
  if (sx >= GAME_W / 2 - 110 && sx <= GAME_W / 2 + 110 && sy >= 440 && sy <= 496) {
    startMission(missionIdx);
    return;
  }
  // +1 EMP rewarded
  if (bonusEmp === 0 && sx >= GAME_W / 2 - 130 && sx <= GAME_W / 2 + 130 && sy >= 510 && sy <= 552) {
    adInProgress = true;
    SDK.gameplayStop();
    SDK.requestAd('rewarded', {
      onStart: () => AUDIO.setMuted(true),
      onFinish: () => AUDIO.setMuted(SDK.getMuteSetting()),
    }).then((ok) => {
      adInProgress = false;
      if (ok) { bonusEmp = 1; floats.push({ x: 0, y: 0, t: 0, kind: 'none' }); }
    });
  }
}
function completeTap(sx, sy) {
  // rewarded: x2 intel (only when intel was gained)
  if (lastStats && lastStats.intelGain > 0 && !lastStats.doubled && sx >= GAME_W / 2 - 130 && sx <= GAME_W / 2 + 130 && sy >= 530 && sy <= 572) {
    adInProgress = true;
    SDK.requestAd('rewarded', {
      onStart: () => AUDIO.setMuted(true),
      onFinish: () => AUDIO.setMuted(SDK.getMuteSetting()),
    }).then((ok) => {
      adInProgress = false;
      if (ok) {
        intel += lastStats.intelGain;
        lastStats.doubled = true;
        saveMeta();
      }
    });
    return;
  }
  // NEXT / MENU button
  if (sx >= GAME_W / 2 - 110 && sx <= GAME_W / 2 + 110 && sy >= 460 && sy <= 516) {
    const next = missionIdx + 1;
    adInProgress = true;
    SDK.requestAd('midgame', {
      onStart: () => AUDIO.setMuted(true),
      onFinish: () => AUDIO.setMuted(SDK.getMuteSetting()),
    }).then(() => {
      adInProgress = false;
      bonusEmp = 0;
      if (next < MISSIONS.length) { missionIdx = next; state = 'briefing'; }
      else state = 'menu';
    });
  }
}
function shopTap(sx, sy) {
  // back button
  if (sx >= 20 && sx <= 140 && sy >= 20 && sy <= 62) { state = 'menu'; AUDIO.switchSound(); return; }
  // upgrades
  for (let i = 0; i < SHOP_ITEMS.length; i++) {
    const it = SHOP_ITEMS[i];
    const bx = GAME_W / 2 - 330 + i * 225, by = 160;
    if (sx >= bx && sx <= bx + 205 && sy >= by && sy <= by + 150) {
      if (!upgrades[it.id] && intel >= it.cost) {
        intel -= it.cost; upgrades[it.id] = 1; saveMeta();
        AUDIO.hackDoneSound();
        floats.push({ x: 0, y: 0, t: 0, kind: 'none' });
      } else if (!upgrades[it.id]) AUDIO.detectTick();
      return;
    }
  }
  // skins
  const keys = Object.keys(SKINS);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const bx = GAME_W / 2 - 330 + i * 225, by = 370;
    if (sx >= bx && sx <= bx + 205 && sy >= by && sy <= by + 130) {
      if (ownedSkins[k]) { skin = k; saveMeta(); AUDIO.switchSound(); }
      else if (intel >= SKINS[k].cost) { intel -= SKINS[k].cost; ownedSkins[k] = true; skin = k; saveMeta(); AUDIO.hackDoneSound(); }
      else AUDIO.detectTick();
      return;
    }
  }
}
function failedTap(sx, sy) {
  // RETRY
  if (sx >= GAME_W / 2 - 110 && sx <= GAME_W / 2 + 110 && sy >= 420 && sy <= 476) {
    adInProgress = true;
    SDK.requestAd('midgame', {
      onStart: () => AUDIO.setMuted(true),
      onFinish: () => AUDIO.setMuted(SDK.getMuteSetting()),
    }).then(() => {
      adInProgress = false;
      startMission(missionIdx);
    });
    return;
  }
  // rewarded: retry from checkpoint (terminal already hacked)
  if (hacked && !checkpointUsed && sx >= GAME_W / 2 - 150 && sx <= GAME_W / 2 + 150 && sy >= 492 && sy <= 540) {
    adInProgress = true;
    SDK.requestAd('rewarded', {
      onStart: () => AUDIO.setMuted(true),
      onFinish: () => AUDIO.setMuted(SDK.getMuteSetting()),
    }).then((ok) => {
      adInProgress = false;
      if (ok) {
        checkpointUsed = true;
        startMission(missionIdx, { fromCheckpoint: true, keepCheckpointUse: true });
      }
    });
    return;
  }
  // MENU
  if (sx >= GAME_W / 2 - 70 && sx <= GAME_W / 2 + 70 && sy >= 552 && sy <= 590) state = 'menu';
}

// ---------- mission end ----------
function starsFor(m, time, ghost, tds) {
  // 1 star for completing; +1 for under par time OR ghost; 3 requires ghost AND under par
  let s = 1;
  if (time <= m.par) s++;
  if (ghost) s++;
  return Math.min(3, s);
}
function missionComplete() {
  SDK.gameplayStop();
  const m = level.mission;
  const timeBonus = Math.max(0, Math.round((m.par - missionTime) * 10));
  const ghost = alarmsRaised === 0;
  const score = 1000 + timeBonus + takedowns * 100 + (ghost ? 500 : 0);
  const earned = starsFor(m, missionTime, ghost, takedowns);
  const prevStars = stars[missionIdx] || 0;
  const newStars = Math.max(prevStars, earned);
  const gained = Math.max(0, newStars - prevStars);
  const intelGain = gained * 5;
  if (gained > 0) { stars[missionIdx] = newStars; intel += intelGain; }
  lastStats = { time: missionTime, takedowns, ghost, score, timeBonus, stars: earned, bestStars: newStars, intelGain, doubled: false };
  if (ghost || earned === 3) SDK.happytime();
  AUDIO.successSound();
  if (missionIdx + 1 >= unlocked && unlocked < MISSIONS.length) {
    unlocked = missionIdx + 2;
    SDK.saveData('unlocked', unlocked);
  }
  const bk = 'best' + missionIdx;
  const prev = parseInt(SDK.loadData(bk, '0'), 10) || 0;
  if (score > prev) SDK.saveData(bk, score);
  lastStats.best = Math.max(prev, score);
  saveMeta();
  state = 'complete';
}

function missionFail(reason) {
  SDK.gameplayStop();
  AUDIO.failSound();
  lastStats = { reason };
  state = 'failed';
}

// ---------- update ----------
function updateAgent(a, dt) {
  a.moving = false;
  if (a.path.length) {
    const t = a.path[0];
    const tx = (t.x + 0.5) * TILE, ty = (t.y + 0.5) * TILE;
    const dx = tx - a.x, dy = ty - a.y;
    const d = Math.hypot(dx, dy);
    const onGrass = isGrass(level, Math.floor(a.x / TILE), Math.floor(a.y / TILE));
    const sp = a.speed * (onGrass ? 0.55 : 1);
    if (d < sp * dt) { a.x = tx; a.y = ty; a.path.shift(); }
    else { a.x += dx / d * sp * dt; a.y += dy / d * sp * dt; a.facing = Math.atan2(dy, dx); }
    a.moving = true;
    a.stepT -= dt;
    if (a.stepT <= 0) {
      a.stepT = onGrass ? 0.34 : 0.26;
      AUDIO.stepSound(onGrass);
      if (onGrass) footprints.push({ x: a.x, y: a.y, t: 2.5, ang: a.facing });
    }
  }
  // takedown attempt
  if (a.takedownTarget >= 0) {
    const g = guards[a.takedownTarget];
    if (!g || !g.alive) { a.takedownTarget = -1; }
    else {
      const d = Math.hypot(g.x - a.x, g.y - a.y);
      if (d < 1.45 * TILE) {
        const toAgent = Math.atan2(a.y - g.y, a.x - g.x);
        let da = Math.abs(((toAgent - g.facing) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        const behind = da > Math.PI * 0.55;
        // elite sentries are armored: only a stunned elite can be taken down
        const vulnerable = g.elite ? g.stun > 0 : (behind || g.stun > 0);
        if (vulnerable) {
          doTakedown(a.takedownTarget);
          a.takedownTarget = -1; a.path = [];
        } else if (g.elite && behind && !g.stun) {
          floats.push({ x: g.x, y: g.y - 24, t: 1, kind: 'text', text: 'ARMORED — EMP FIRST!', color: '#f88' });
          a.takedownTarget = -1; a.path = [];
        }
      } else if (!a.path.length) {
        // repath to guard (it moved)
        const p = findPath(level, Math.floor(a.x / TILE), Math.floor(a.y / TILE), Math.floor(g.x / TILE), Math.floor(g.y / TILE));
        if (p && p.length) a.path = p; else a.takedownTarget = -1;
      }
    }
  }
  // hacking: tech within 3 tiles, scout within 1.2 tiles, agent idle
  a.hacking = false;
  if (!hacked && !a.moving) {
    for (const t of terminals) {
      if (t.done) continue;
      const tx = (t.x + 0.5) * TILE, ty = (t.y + 0.5) * TILE;
      const d = Math.hypot(tx - a.x, ty - a.y);
      const range = a.kind === 'tech' ? 3.2 * TILE : 1.5 * TILE;
      if (d <= range && los(level, a.x, a.y, tx, ty)) {
        a.hacking = true;
        t.progress += dt;
        if (Math.random() < dt * 8) AUDIO.hackTick();
        if (t.progress >= hackTimeFor()) {
          t.done = true; t.doneAt = missionTime;
          AUDIO.hackDoneSound();
          shake = 3;
          const left = terminals.filter(q => !q.done).length;
          if (left === 0) {
            hacked = true;
            const hasLaser = level.tiles.some(row => row.includes('L'));
            floats.push({ x: tx, y: ty - 24, t: 1.4, kind: 'text', text: hasLaser ? 'LASERS DOWN — GO TO EVAC' : 'TERMINAL HACKED — GO TO EVAC', color: '#6ef' });
          } else {
            floats.push({ x: tx, y: ty - 24, t: 1.4, kind: 'text', text: level.mission.sync ? `1 MORE TERMINAL — ${level.mission.sync}s!` : 'TERMINAL HACKED — 1 MORE', color: '#6ef' });
          }
        }
        break;
      }
    }
  }
  hackProgress = terminals.length ? Math.max(...terminals.map(t => t.progress)) : 0;
}

function updateGuard(g, gi, dt) {
  if (!g.alive) return;
  if (g.stun > 0) { g.stun -= dt; g.detect = Math.max(0, g.detect - dt); if (Math.random() < dt * 6) spawnSpark(g.x, g.y, '#7df'); return; }

  // vision: detect agents
  let seeing = false;
  for (const a of agents) {
    if (agentHidden(a, g)) continue;
    if (guardSees(g, a.x, a.y)) {
      seeing = true;
      g.detect += dt;
      if (alarm < 1) alarm = 1;
      if (Math.random() < dt * 6) AUDIO.detectTick();
      if (g.detect >= DETECT_TIME) raiseAlarm(a.x, a.y);
      if (alarm === 2) { g.state = 'chase'; g.target = { x: a.x, y: a.y }; }
    }
  }
  if (!seeing) g.detect = Math.max(0, g.detect - dt * 1.2);

  // bodies raise alarm
  for (let bi = 0; bi < bodies.length; bi++) {
    if (g.seenBodies.has(bi)) continue;
    const b = bodies[bi];
    if (guardSees(g, b.x, b.y)) {
      g.seenBodies.add(bi);
      raiseAlarm(b.x, b.y);
    }
  }

  // movement
  if (g.state === 'chase' && alarm === 2 && g.target) {
    g.repath -= dt;
    if (g.repath <= 0) {
      g.repath = 0.5;
      const p = findPath(level, Math.floor(g.x / TILE), Math.floor(g.y / TILE), Math.floor(g.target.x / TILE), Math.floor(g.target.y / TILE));
      g.path = p || [];
    }
    moveAlong(g, g.chaseSpeed, dt);
    // catch agent
    for (const a of agents) {
      if (Math.hypot(a.x - g.x, a.y - g.y) < CATCH_DIST) { missionFail('Agent captured by a sentry!'); return; }
    }
  } else {
    if (g.state === 'chase') { g.state = 'return'; g.path = []; }
    if (g.state === 'return') {
      if (!g.path.length) {
        const wp = g.wps[g.wpi];
        const p = findPath(level, Math.floor(g.x / TILE), Math.floor(g.y / TILE), wp[0], wp[1]);
        g.path = p || [];
        if (!g.path.length) g.state = 'patrol';
      }
      moveAlong(g, g.speed, dt);
      if (!g.path.length) g.state = 'patrol';
    } else {
      // patrol between waypoints
      if (!g.path.length) {
        const wp = g.wps[g.wpi];
        const gx = Math.floor(g.x / TILE), gy = Math.floor(g.y / TILE);
        if (gx === wp[0] && gy === wp[1]) {
          g.wpi = (g.wpi + 1) % g.wps.length;
        }
        const nwp = g.wps[g.wpi];
        const p = findPath(level, gx, gy, nwp[0], nwp[1]);
        g.path = p || [];
      }
      moveAlong(g, g.speed, dt);
    }
  }
}

function moveAlong(g, sp, dt) {
  if (!g.path.length) return;
  const t = g.path[0];
  const tx = (t.x + 0.5) * TILE, ty = (t.y + 0.5) * TILE;
  const dx = tx - g.x, dy = ty - g.y;
  const d = Math.hypot(dx, dy);
  if (d < sp * dt) { g.x = tx; g.y = ty; g.path.shift(); }
  else {
    g.x += dx / d * sp * dt; g.y += dy / d * sp * dt;
    const target = Math.atan2(dy, dx);
    let da = ((target - g.facing) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    g.facing += da * Math.min(1, dt * 6);
  }
}

function update(dt) {
  if (dailyToastT > 0) dailyToastT -= dt;
  if (state !== 'playing' || adInProgress) return;
  missionTime += dt;

  for (const a of agents) updateAgent(a, dt);
  if (state !== 'playing') return;
  guards.forEach((g, i) => updateGuard(g, i, dt));
  if (state !== 'playing') return;

  // rotating cameras: sweep + detection
  for (const c of cameras) {
    if (c.stun > 0) { c.stun -= dt; c.detect = Math.max(0, c.detect - dt); continue; }
    c.facing = c.base + Math.sin(missionTime * c.speed * Math.PI) * c.arc;
    let seeing = false;
    for (const a of agents) {
      if (agentHidden(a, c)) continue;
      if (guardSees(c, a.x, a.y, 0.42)) {
        seeing = true;
        c.detect += dt * 1.7; // cameras lock on fast
        if (alarm < 1) alarm = 1;
        if (Math.random() < dt * 6) AUDIO.detectTick();
        if (c.detect >= DETECT_TIME) raiseAlarm(a.x, a.y);
      }
    }
    if (!seeing) c.detect = Math.max(0, c.detect - dt * 1.2);
  }

  // synced terminals: if window elapses with only some hacked, they re-lock
  const syncWin = level.mission.sync;
  if (syncWin && !hacked) {
    const done = terminals.filter(t => t.done);
    if (done.length > 0 && done.length < terminals.length) {
      const oldest = Math.min(...done.map(t => t.doneAt ?? 0));
      if (missionTime - oldest > syncWin) {
        for (const t of terminals) { t.done = false; t.progress = 0; t.doneAt = undefined; }
        floats.push({ x: agents[activeAgent].x, y: agents[activeAgent].y - 30, t: 1.5, kind: 'text', text: 'SYNC LOST — TERMINALS RESET', color: '#f88' });
        AUDIO.failTick();
        shake = 3;
      }
    }
  }

  // alarm cooldown
  if (alarm === 2) {
    let contact = false;
    for (const g of guards) {
      if (!g.alive || g.stun > 0) continue;
      for (const a of agents) if (!agentHidden(a, g) && guardSees(g, a.x, a.y)) { contact = true; g.target = { x: a.x, y: a.y }; }
    }
    if (contact) alarmTimer = ALARM_COOLDOWN;
    else {
      alarmTimer -= dt;
      if (alarmTimer <= 0) { alarm = 0; for (const g of guards) if (g.state === 'chase') { g.state = 'return'; g.path = []; } }
    }
  } else if (alarm === 1) {
    let anyDetect = false;
    for (const g of guards) if (g.alive && g.detect > 0) anyDetect = true;
    for (const c of cameras) if (c.detect > 0) anyDetect = true;
    if (!anyDetect) alarm = 0;
  }

  // win check: hacked + both agents in evac zone
  if (hacked) {
    let inEvac = 0;
    for (const a of agents) {
      for (const e of level.evac) {
        if (Math.hypot(a.x - (e.x + 0.5) * TILE, a.y - (e.y + 0.5) * TILE) < 1.6 * TILE) { inEvac++; break; }
      }
    }
    if (inEvac === 2) { missionComplete(); return; }
  }

  // camera
  if (camFollow) {
    const a = agents[activeAgent];
    cam.x += (a.x - GAME_W / 2 - cam.x) * Math.min(1, dt * 5);
    cam.y += (a.y - GAME_H / 2 - cam.y) * Math.min(1, dt * 5);
    clampCam();
  }

  // particles etc.
  particles = particles.filter(p => (p.t -= dt) > 0);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
  rings = rings.filter(r => r.a > 0);
  for (const r of rings) { if (r.delay > 0) { r.delay -= dt; continue; } r.r += 220 * dt; r.a -= dt * 1.1; }
  footprints = footprints.filter(f => (f.t -= dt) > 0);
  floats = floats.filter(f => (f.t -= dt) > 0);
  shake = Math.max(0, shake - dt * 18);
}

// ---------- rendering ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTiles() {
  const x0 = Math.max(0, Math.floor(cam.x / TILE)), x1 = Math.min(level.W - 1, Math.ceil((cam.x + GAME_W) / TILE));
  const y0 = Math.max(0, Math.floor(cam.y / TILE)), y1 = Math.min(level.H - 1, Math.ceil((cam.y + GAME_H) / TILE));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = level.tiles[y][x];
      const px = x * TILE - cam.x, py = y * TILE - cam.y;
      if (c === '#') {
        ctx.fillStyle = '#2a3244';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#343e54';
        ctx.fillRect(px, py, TILE, 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
      } else if (c === 'B') {
        ctx.fillStyle = '#151b28'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#6b5335';
        ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
        ctx.fillStyle = '#7d6240';
        ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);
        ctx.strokeStyle = '#4a3a24'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px + 4, py + 4); ctx.lineTo(px + TILE - 4, py + TILE - 4);
        ctx.moveTo(px + TILE - 4, py + 4); ctx.lineTo(px + 4, py + TILE - 4); ctx.stroke();
        ctx.lineWidth = 1;
      } else if (c === ',') {
        ctx.fillStyle = '#17301f'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#1f4029';
        const s = (x * 7 + y * 13) % 5;
        for (let i = 0; i < 4; i++) {
          const gx = px + ((i * 9 + s * 5) % (TILE - 8)) + 4, gy = py + ((i * 13 + s * 7) % (TILE - 8)) + 4;
          ctx.fillRect(gx, gy - 4, 2, 6);
          ctx.fillRect(gx - 3, gy - 2, 2, 4);
        }
      } else if (c === 'L') {
        // laser gate tile
        ctx.fillStyle = (x + y) % 2 ? '#151b28' : '#161d2b';
        ctx.fillRect(px, py, TILE, TILE);
        if (!hacked) {
          const puls = 0.55 + 0.35 * Math.sin(performance.now() / 160 + x);
          ctx.strokeStyle = `rgba(255,60,80,${puls})`;
          ctx.lineWidth = 3;
          for (let i = 0; i < 3; i++) {
            const ly = py + 8 + i * 12;
            ctx.beginPath(); ctx.moveTo(px, ly); ctx.lineTo(px + TILE, ly); ctx.stroke();
          }
          ctx.lineWidth = 1;
          ctx.fillStyle = '#801822';
          ctx.fillRect(px, py, 4, TILE); ctx.fillRect(px + TILE - 4, py, 4, TILE);
        } else {
          ctx.fillStyle = '#2a3244';
          ctx.fillRect(px, py, 4, TILE); ctx.fillRect(px + TILE - 4, py, 4, TILE);
        }
      } else {
        ctx.fillStyle = (x + y) % 2 ? '#151b28' : '#161d2b';
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }
  // evac zone
  for (const e of level.evac) {
    const px = e.x * TILE - cam.x, py = e.y * TILE - cam.y;
    const pulse = 0.35 + 0.2 * Math.sin(performance.now() / 300);
    ctx.fillStyle = `rgba(80,240,140,${pulse})`;
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = '#5f8'; ctx.strokeRect(px + 2.5, py + 2.5, TILE - 5, TILE - 5);
  }
  if (level.evac.length) {
    const e = level.evac[0];
    ctx.fillStyle = '#8fc';
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('EVAC', (e.x + 1) * TILE - cam.x, e.y * TILE - cam.y - 4);
  }
  // terminals
  for (const t of terminals) {
    const px = (t.x + 0.5) * TILE - cam.x, py = (t.y + 0.5) * TILE - cam.y;
    const done = t.done;
    const glow = done ? 'rgba(80,240,140,0.5)' : 'rgba(80,180,255,0.5)';
    const grd = ctx.createRadialGradient(px, py, 2, px, py, TILE);
    grd.addColorStop(0, glow); grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(px, py, TILE, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#223'; ctx.fillRect(px - 12, py - 14, 24, 24);
    ctx.fillStyle = done ? '#4f8' : '#4af';
    ctx.fillRect(px - 9, py - 11, 18, 12);
    ctx.fillStyle = '#112';
    for (let i = 0; i < 3; i++) ctx.fillRect(px - 7, py - 9 + i * 3, 14 - (i * 4 + (done ? 0 : Math.floor(performance.now() / 200 + i) % 8)), 2);
    ctx.fillStyle = '#556'; ctx.fillRect(px - 6, py + 10, 12, 3);
    // sync window countdown ring
    if (done && !hacked && level.mission.sync) {
      const rem = Math.max(0, level.mission.sync - (missionTime - (t.doneAt ?? 0)));
      const frac = rem / level.mission.sync;
      ctx.strokeStyle = frac < 0.35 ? '#f66' : '#6ef'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 20, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
  // rotating cameras
  for (const c of cameras) {
    const px = c.x - cam.x, py = c.y - cam.y;
    ctx.fillStyle = '#1c2333';
    ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a4458'; ctx.stroke();
    ctx.save();
    ctx.translate(px, py); ctx.rotate(c.facing);
    ctx.fillStyle = c.stun > 0 ? '#4a5a78' : '#8892a8';
    ctx.fillRect(-3, -5, 16, 10);
    ctx.fillStyle = c.stun > 0 ? '#7df' : (alarm === 2 ? '#f55' : '#f66');
    ctx.beginPath(); ctx.arc(13, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (c.stun > 0) {
      ctx.fillStyle = '#7df'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('zzz', px, py - 16);
    }
  }
}

function drawVisionCones() {
  const fov = fovFor();
  for (const g of guards) {
    if (!g.alive || g.stun > 0) continue;
    const range = (alarm === 2 ? 7.5 : 6) * TILE;
    const n = 26;
    ctx.beginPath();
    ctx.moveTo(g.x - cam.x, g.y - cam.y);
    for (let i = 0; i <= n; i++) {
      const ang = g.facing - fov + (2 * fov * i) / n;
      // raycast
      let d = range;
      for (let s = TILE * 0.3; s < range; s += TILE * 0.22) {
        const x = g.x + Math.cos(ang) * s, y = g.y + Math.sin(ang) * s;
        if (solid(level, Math.floor(x / TILE), Math.floor(y / TILE))) { d = s; break; }
      }
      ctx.lineTo(g.x + Math.cos(ang) * d - cam.x, g.y + Math.sin(ang) * d - cam.y);
    }
    ctx.closePath();
    if (alarm === 2) ctx.fillStyle = 'rgba(255,60,60,0.16)';
    else if (g.detect > 0) ctx.fillStyle = 'rgba(255,200,40,0.18)';
    else if (g.elite) ctx.fillStyle = 'rgba(255,140,220,0.12)';
    else ctx.fillStyle = 'rgba(255,230,120,0.10)';
    ctx.fill();
    // detection meter
    if (g.detect > 0 && alarm !== 2) {
      const p = Math.min(1, g.detect / DETECT_TIME);
      ctx.fillStyle = '#000a';
      ctx.fillRect(g.x - cam.x - 16, g.y - cam.y - 34, 32, 6);
      ctx.fillStyle = p > 0.7 ? '#f44' : '#fc3';
      ctx.fillRect(g.x - cam.x - 15, g.y - cam.y - 33, 30 * p, 4);
    }
  }
  // camera cones (red tint, narrower)
  for (const c of cameras) {
    if (c.stun > 0) continue;
    const range = 6 * TILE, cfov = 0.42, n = 18;
    ctx.beginPath();
    ctx.moveTo(c.x - cam.x, c.y - cam.y);
    for (let i = 0; i <= n; i++) {
      const ang = c.facing - cfov + (2 * cfov * i) / n;
      let d = range;
      for (let s = TILE * 0.3; s < range; s += TILE * 0.22) {
        const x = c.x + Math.cos(ang) * s, y = c.y + Math.sin(ang) * s;
        if (solid(level, Math.floor(x / TILE), Math.floor(y / TILE))) { d = s; break; }
      }
      ctx.lineTo(c.x + Math.cos(ang) * d - cam.x, c.y + Math.sin(ang) * d - cam.y);
    }
    ctx.closePath();
    ctx.fillStyle = c.detect > 0 ? 'rgba(255,80,80,0.22)' : 'rgba(255,80,120,0.12)';
    ctx.fill();
    if (c.detect > 0 && alarm !== 2) {
      const p = Math.min(1, c.detect / DETECT_TIME);
      ctx.fillStyle = '#000a';
      ctx.fillRect(c.x - cam.x - 16, c.y - cam.y - 30, 32, 6);
      ctx.fillStyle = p > 0.7 ? '#f44' : '#fc3';
      ctx.fillRect(c.x - cam.x - 15, c.y - cam.y - 29, 30 * p, 4);
    }
  }
}

function drawRobot(x, y, facing, opts = {}) {
  ctx.save();
  ctx.translate(x - cam.x, y - cam.y);
  ctx.rotate(facing + Math.PI / 2);
  const body = opts.dead ? '#3a4150' : (opts.stun ? '#4a5a78' : (opts.elite ? '#b06a9a' : '#8892a8'));
  // treads
  ctx.fillStyle = opts.dead ? '#232833' : '#333c4e';
  ctx.fillRect(-13, -10, 5, 22);
  ctx.fillRect(8, -10, 5, 22);
  // body
  ctx.fillStyle = body;
  roundRect(-10, -12, 20, 24, 5); ctx.fill();
  ctx.fillStyle = opts.dead ? '#2a2f3a' : (opts.elite ? '#d8a0c8' : '#aab4ca');
  roundRect(-7, -9, 14, 12, 4); ctx.fill();
  // elite armor plates
  if (opts.elite && !opts.dead) {
    ctx.strokeStyle = '#f9c'; ctx.lineWidth = 2;
    roundRect(-11, -13, 22, 26, 6); ctx.stroke();
    ctx.lineWidth = 1;
  }
  // eye
  if (!opts.dead) {
    ctx.fillStyle = opts.stun ? '#7df' : (alarm === 2 ? '#f55' : '#fd5');
    ctx.beginPath(); ctx.arc(0, -10, 3.4, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = '#556'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-4, -12); ctx.lineTo(2, -6); ctx.moveTo(2, -12); ctx.lineTo(-4, -6); ctx.stroke();
  }
  ctx.restore();
  if (opts.stun) {
    ctx.fillStyle = '#7df';
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    const zt = Math.floor(performance.now() / 250) % 3;
    ctx.fillText('z'.repeat(zt + 1), x - cam.x + 14, y - cam.y - 18);
  }
}

function drawAgent(a, active) {
  const x = a.x - cam.x, y = a.y - cam.y;
  const color = agentColor(a.kind);
  const tx = Math.floor(a.x / TILE), ty = Math.floor(a.y / TILE);
  const hidden = isGrass(level, tx, ty);
  ctx.save();
  if (hidden) ctx.globalAlpha = 0.6;
  if (active) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(x, y, 17, performance.now() / 500, performance.now() / 500 + Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.translate(x, y);
  ctx.rotate(a.facing + Math.PI / 2);
  // body
  ctx.fillStyle = '#10141f';
  ctx.beginPath(); ctx.ellipse(0, 0, 11, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
  // head
  ctx.fillStyle = '#0c0f18';
  ctx.beginPath(); ctx.arc(0, -3, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, -5, 2, 0, Math.PI * 2); ctx.fill();
  // walk bob legs
  if (a.moving) {
    const ph = Math.sin(performance.now() / 70);
    ctx.fillStyle = '#10141f';
    ctx.fillRect(-6, 8 + ph * 3, 4, 5);
    ctx.fillRect(2, 8 - ph * 3, 4, 5);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // path preview for active
  if (active && a.path.length) {
    const last = a.path[a.path.length - 1];
    ctx.strokeStyle = 'rgba(140,220,255,0.35)';
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (const p of a.path) ctx.lineTo((p.x + 0.5) * TILE - cam.x, (p.y + 0.5) * TILE - cam.y);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(140,220,255,0.6)';
    ctx.beginPath(); ctx.arc((last.x + 0.5) * TILE - cam.x, (last.y + 0.5) * TILE - cam.y, 6, 0, Math.PI * 2); ctx.stroke();
  }
  // hacking indicator
  if (a.hacking) {
    ctx.fillStyle = '#000a'; ctx.fillRect(x - 22, y - 32, 44, 8);
    ctx.fillStyle = '#4af'; ctx.fillRect(x - 21, y - 31, 42 * Math.min(1, hackProgress / hackTimeFor()), 6);
    ctx.fillStyle = '#9cf'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('HACKING…', x, y - 36);
  }
  if (hidden) {
    ctx.fillStyle = 'rgba(140,255,170,0.8)';
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('hidden', x, y + 26);
  }
}

function drawHUD() {
  // portraits
  for (let i = 0; i < 2; i++) {
    const p = UI.portraits[i];
    const a = agents[i];
    const col = agentColor(a.kind);
    ctx.fillStyle = i === activeAgent ? 'rgba(30,42,66,0.95)' : 'rgba(16,22,34,0.85)';
    roundRect(p.x, p.y, p.w, p.h, 10); ctx.fill();
    ctx.strokeStyle = i === activeAgent ? col : '#3a4458'; ctx.lineWidth = i === activeAgent ? 3 : 1.5;
    roundRect(p.x, p.y, p.w, p.h, 10); ctx.stroke();
    // mini portrait
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + 27, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0c0f18';
    ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + 24, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#dfe6f5';
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(a.kind === 'scout' ? 'SCOUT' : 'TECH', p.x + p.w / 2, p.y + 55);
    ctx.fillStyle = '#8b96ad'; ctx.font = '10px sans-serif';
    ctx.fillText(i === 0 ? '[1]' : '[2]', p.x + p.w / 2, p.y + 68);
  }
  ctx.lineWidth = 1;
  // mission + timer + alert
  ctx.fillStyle = 'rgba(12,16,26,0.8)';
  roundRect(GAME_W / 2 - 130, 10, 260, 44, 10); ctx.fill();
  ctx.fillStyle = '#dfe6f5'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`MISSION ${missionIdx + 1}: ${level.mission.name}`, GAME_W / 2, 28);
  ctx.fillStyle = '#8b96ad'; ctx.font = '12px monospace';
  ctx.fillText(missionTime.toFixed(1) + 's', GAME_W / 2, 46);
  // alert lamp
  const lampCol = alarm === 2 ? '#f44' : alarm === 1 ? '#fc3' : '#4d6';
  ctx.fillStyle = lampCol;
  ctx.beginPath(); ctx.arc(GAME_W / 2 + 110, 32, 8 + (alarm === 2 ? Math.sin(performance.now() / 120) * 2 : 0), 0, Math.PI * 2); ctx.fill();
  // objective text
  ctx.fillStyle = 'rgba(12,16,26,0.7)';
  roundRect(GAME_W / 2 - 150, GAME_H - 34, 300, 26, 8); ctx.fill();
  ctx.fillStyle = hacked ? '#6f9' : '#9cf'; ctx.font = 'bold 12px sans-serif';
  const termLeft = terminals.filter(t => !t.done).length;
  ctx.fillText(hacked ? 'OBJECTIVE: both agents to EVAC' : (terminals.length > 1 ? `OBJECTIVE: hack ${termLeft} terminal${termLeft > 1 ? 's' : ''}${level.mission.sync ? ' (synced!)' : ''}` : 'OBJECTIVE: hack the terminal'), GAME_W / 2, GAME_H - 16);
  // EMP button
  const b = UI.empBtn;
  ctx.fillStyle = empCharges > 0 ? 'rgba(30,50,90,0.9)' : 'rgba(25,28,38,0.8)';
  ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = empCharges > 0 ? '#5af' : '#444e60'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = empCharges > 0 ? '#bdf' : '#5a6478';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('EMP', b.x + b.w / 2, b.y + b.h / 2 - 2);
  ctx.font = '12px sans-serif';
  ctx.fillText('×' + empCharges + '  [R]', b.x + b.w / 2, b.y + b.h / 2 + 16);
  ctx.lineWidth = 1;
}

function drawWorld() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawTiles();
  // footprints
  for (const f of footprints) {
    ctx.fillStyle = `rgba(190,230,200,${Math.min(0.35, f.t * 0.2)})`;
    ctx.save(); ctx.translate(f.x - cam.x, f.y - cam.y); ctx.rotate(f.ang);
    ctx.beginPath(); ctx.ellipse(0, -4, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 4, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  drawVisionCones();
  // bodies
  for (const b of bodies) drawRobot(b.x, b.y, b.facing, { dead: true });
  // guards
  for (const g of guards) if (g.alive) drawRobot(g.x, g.y, g.facing, { stun: g.stun > 0, elite: g.elite });
  // hover takedown hint
  if (hoverGuard >= 0 && guards[hoverGuard] && guards[hoverGuard].alive && agents[activeAgent].kind === 'scout') {
    const g = guards[hoverGuard];
    ctx.strokeStyle = '#f88'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.x - cam.x, g.y - cam.y, 20, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
  }
  // agents
  drawAgent(agents[1 - activeAgent], false);
  drawAgent(agents[activeAgent], true);
  // rings
  for (const r of rings) {
    if (r.delay > 0) continue;
    ctx.strokeStyle = r.blue ? `rgba(90,170,255,${Math.max(0, r.a)})` : `rgba(255,60,60,${Math.max(0, r.a)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x - cam.x, r.y - cam.y, r.r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.lineWidth = 1;
  // particles
  for (const p of particles) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.min(1, p.t * 2.5);
    ctx.fillRect(p.x - cam.x - 1.5, p.y - cam.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  // floats
  for (const f of floats) {
    if (f.kind === 'text') {
      ctx.fillStyle = f.color || '#fff';
      ctx.globalAlpha = Math.min(1, f.t * 2);
      ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x - cam.x, f.y - cam.y - (1 - f.t) * 20);
      ctx.globalAlpha = 1;
    } else if (f.kind === 'marker') {
      ctx.strokeStyle = `rgba(140,220,255,${f.t * 2})`;
      ctx.beginPath(); ctx.arc(f.x - cam.x, f.y - cam.y, (0.5 - f.t) * 30 + 6, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBackdrop() {
  const bg = ctx.createLinearGradient(0, 0, 0, GAME_H);
  bg.addColorStop(0, '#0b0e18'); bg.addColorStop(1, '#101526');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, GAME_W, GAME_H);
}

function drawButton(x, y, w, h, label, opts = {}) {
  ctx.fillStyle = opts.disabled ? 'rgba(30,34,46,0.9)' : (opts.color || 'rgba(40,90,160,0.95)');
  roundRect(x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = opts.disabled ? '#3a4152' : (opts.stroke || '#6cf');
  ctx.lineWidth = 2; roundRect(x, y, w, h, 12); ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = opts.disabled ? '#5a6478' : '#eaf2ff';
  ctx.font = `bold ${opts.font || 20}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawStars(cx, cy, n, size = 10, dim = '#3a4458') {
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < n ? '#fd5' : dim;
    ctx.font = `bold ${size + 2}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('★', cx + (i - 1) * (size + 3), cy);
  }
}

function drawMenu() {
  drawBackdrop();
  // decorative cones
  for (let i = 0; i < 3; i++) {
    const gx = 150 + i * 300, gy = 500 + Math.sin(performance.now() / 900 + i) * 10;
    const fa = performance.now() / 1400 + i * 2;
    ctx.beginPath(); ctx.moveTo(gx, gy);
    ctx.arc(gx, gy, 80, fa - 0.5, fa + 0.5); ctx.closePath();
    ctx.fillStyle = 'rgba(255,230,120,0.07)'; ctx.fill();
  }
  ctx.fillStyle = '#eaf2ff';
  ctx.font = '900 46px sans-serif'; ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(80,200,255,0.7)'; ctx.shadowBlur = 20;
  ctx.fillText('SHADOW SQUAD', GAME_W / 2, 66);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#8b96ad'; ctx.font = '600 15px sans-serif';
  ctx.fillText('Real-time tactics. Two agents. Zero alarms.', GAME_W / 2, 92);
  // intel + streak (top-left)
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(16,22,34,0.85)'; roundRect(16, 14, 190, 44, 10); ctx.fill();
  ctx.strokeStyle = '#3a4458'; roundRect(16, 14, 190, 44, 10); ctx.stroke();
  ctx.fillStyle = '#6ef'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText('◆ INTEL: ' + intel, 28, 33);
  ctx.fillStyle = streak > 1 ? '#fd5' : '#68738c'; ctx.font = 'bold 12px sans-serif';
  ctx.fillText('🔥 streak: ' + streak + ' day' + (streak === 1 ? '' : 's'), 28, 51);
  // shop button (top-right)
  drawButton(GAME_W - 160, 14, 140, 44, '◆ SHOP', { color: 'rgba(60,44,110,0.95)', stroke: '#b8f', font: 17 });
  // mission tiles: 2 rows of 5
  menuButtons.length = 0;
  for (let i = 0; i < MISSIONS.length; i++) {
    const bx = GAME_W / 2 - 260 + (i % 5) * 110, by = 118 + Math.floor(i / 5) * 106;
    const locked = i >= unlocked;
    menuButtons.push({ x: bx, y: by, w: 96, h: 96, mi: i });
    ctx.fillStyle = locked ? 'rgba(24,28,38,0.9)' : 'rgba(30,52,86,0.95)';
    roundRect(bx, by, 96, 96, 12); ctx.fill();
    ctx.strokeStyle = locked ? '#333c4e' : '#5af'; ctx.lineWidth = 2;
    roundRect(bx, by, 96, 96, 12); ctx.stroke();
    ctx.fillStyle = locked ? '#4a5468' : '#eaf2ff';
    ctx.font = '900 28px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(locked ? '🔒' : String(i + 1), bx + 48, by + 38);
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = locked ? '#4a5468' : '#9db4d8';
    ctx.fillText(MISSIONS[i].name, bx + 48, by + 58);
    if (!locked) drawStars(bx + 48, by + 78, stars[i] || 0, 11);
  }
  ctx.lineWidth = 1;
  // quick play
  const qm = Math.min(unlocked, MISSIONS.length);
  drawButton(GAME_W / 2 - 130, 348, 260, 50, '▶ PLAY MISSION ' + qm, { font: 19 });
  ctx.fillStyle = '#68738c'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('…or pick any unlocked mission above. Replay for 3★!', GAME_W / 2, 420);
  // how to play
  ctx.textAlign = 'left';
  const hx = GAME_W / 2 - 300; let hy = 452;
  ctx.fillStyle = '#9db4d8'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText('HOW TO PLAY', hx, hy); hy += 22;
  ctx.fillStyle = '#7c88a0'; ctx.font = '13px sans-serif';
  const lines = [
    'Click / tap to move. Keys 1 & 2 (or tap portraits) switch agents.',
    'SCOUT: silent takedowns from behind. TECH: remote hacks + EMP [R].',
    'Stay out of vision cones (guards AND cameras). Grass hides you.',
    'Hack every terminal, then get BOTH agents to the evac zone.',
    'Earn ★ for par time & ghost runs → spend INTEL in the shop.',
  ];
  for (const l of lines) { ctx.fillText(l, hx, hy); hy += 20; }
  ctx.textAlign = 'center';
  // daily bonus toast
  if (dailyToastT > 0) {
    ctx.globalAlpha = Math.min(1, dailyToastT);
    ctx.fillStyle = 'rgba(20,40,30,0.95)'; roundRect(GAME_W / 2 - 160, 560, 320, 34, 10); ctx.fill();
    ctx.strokeStyle = '#5f8'; roundRect(GAME_W / 2 - 160, 560, 320, 34, 10); ctx.stroke();
    ctx.fillStyle = '#8f8'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`DAILY LOGIN — day ${streak}: +${dailyBonus} intel!`, GAME_W / 2, 582);
    ctx.globalAlpha = 1;
  }
}

function drawShop() {
  drawBackdrop();
  drawButton(20, 20, 120, 42, '← BACK', { color: 'rgba(35,42,58,0.95)', stroke: '#5a6a88', font: 15 });
  ctx.fillStyle = '#eaf2ff'; ctx.font = '900 36px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('BLACK MARKET', GAME_W / 2, 52);
  ctx.fillStyle = '#6ef'; ctx.font = 'bold 18px sans-serif';
  ctx.fillText('◆ INTEL: ' + intel, GAME_W / 2, 84);
  ctx.fillStyle = '#8b96ad'; ctx.font = '13px sans-serif';
  ctx.fillText('Earn intel by collecting mission stars (★ = 5 intel). Replay missions for better ratings!', GAME_W / 2, 110);
  ctx.fillStyle = '#9db4d8'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('PERMANENT GADGETS', GAME_W / 2 - 330, 148);
  for (let i = 0; i < SHOP_ITEMS.length; i++) {
    const it = SHOP_ITEMS[i];
    const bx = GAME_W / 2 - 330 + i * 225, by = 160;
    const owned = !!upgrades[it.id];
    const afford = intel >= it.cost;
    ctx.fillStyle = owned ? 'rgba(24,52,38,0.95)' : 'rgba(30,42,66,0.95)';
    roundRect(bx, by, 205, 150, 12); ctx.fill();
    ctx.strokeStyle = owned ? '#5f8' : (afford ? '#5af' : '#333c4e'); ctx.lineWidth = 2;
    roundRect(bx, by, 205, 150, 12); ctx.stroke();
    ctx.fillStyle = '#eaf2ff'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(it.name, bx + 102, by + 34);
    ctx.fillStyle = '#8b96ad'; ctx.font = '12px sans-serif';
    const words = it.desc.split(' '); let line = '', ly = by + 62;
    for (const w of words) {
      if (ctx.measureText(line + w).width > 180) { ctx.fillText(line, bx + 102, ly); ly += 17; line = ''; }
      line += w + ' ';
    }
    ctx.fillText(line, bx + 102, ly);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = owned ? '#5f8' : (afford ? '#6ef' : '#f88');
    ctx.fillText(owned ? '✓ OWNED' : '◆ ' + it.cost, bx + 102, by + 128);
  }
  ctx.fillStyle = '#9db4d8'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('AGENT SKINS', GAME_W / 2 - 330, 356);
  const keys = Object.keys(SKINS);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], sk = SKINS[k];
    const bx = GAME_W / 2 - 330 + i * 225, by = 370;
    const owned = !!ownedSkins[k], active = skin === k;
    ctx.fillStyle = active ? 'rgba(24,52,38,0.95)' : 'rgba(30,42,66,0.95)';
    roundRect(bx, by, 205, 130, 12); ctx.fill();
    ctx.strokeStyle = active ? '#5f8' : (owned ? '#5af' : '#333c4e'); ctx.lineWidth = 2;
    roundRect(bx, by, 205, 130, 12); ctx.stroke();
    // preview dots
    ctx.fillStyle = sk.scout; ctx.beginPath(); ctx.arc(bx + 80, by + 44, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sk.tech; ctx.beginPath(); ctx.arc(bx + 124, by + 44, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eaf2ff'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(sk.name, bx + 102, by + 84);
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = active ? '#5f8' : (owned ? '#9db4d8' : (intel >= sk.cost ? '#6ef' : '#f88'));
    ctx.fillText(active ? '✓ EQUIPPED' : (owned ? 'TAP TO EQUIP' : '◆ ' + sk.cost), bx + 102, by + 110);
  }
  ctx.lineWidth = 1;
  ctx.fillStyle = '#68738c'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`Total stars: ${totalStars()} / ${MISSIONS.length * 3}`, GAME_W / 2, 540);
}

function drawBriefing() {
  drawBackdrop();
  const m = MISSIONS[missionIdx];
  ctx.fillStyle = '#8b96ad'; ctx.font = '600 18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('MISSION BRIEFING', GAME_W / 2, 110);
  ctx.fillStyle = '#eaf2ff'; ctx.font = '900 44px sans-serif';
  ctx.fillText(`${missionIdx + 1}. ${m.name}`, GAME_W / 2, 165);
  ctx.fillStyle = '#9db4d8'; ctx.font = '17px sans-serif';
  // wrap brief
  const words = m.brief.split(' ');
  let line = '', ly = 230;
  for (const w of words) {
    if (ctx.measureText(line + w).width > 600) { ctx.fillText(line, GAME_W / 2, ly); ly += 26; line = ''; }
    line += w + ' ';
  }
  ctx.fillText(line, GAME_W / 2, ly);
  ctx.fillStyle = '#7c88a0'; ctx.font = '15px sans-serif';
  ctx.fillText(`Sentries: ${m.guards.length}${m.cameras ? '   ·   Cameras: ' + m.cameras.length : ''}   ·   Par time: ${m.par}s   ·   EMP charges: ${2 + bonusEmp + upgrades.emp}`, GAME_W / 2, ly + 50);
  ctx.fillStyle = '#5f8';
  ctx.fillText('★ under par time   ·   ★ ghost (zero alarms)   ·   stars → intel ◆', GAME_W / 2, ly + 78);
  drawButton(GAME_W / 2 - 110, 440, 220, 56, 'START MISSION');
  if (bonusEmp === 0) drawButton(GAME_W / 2 - 130, 510, 260, 42, '▶ +1 EMP (watch ad)', { color: 'rgba(90,60,140,0.95)', stroke: '#b8f', font: 16 });
  else { ctx.fillStyle = '#8f8'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('✓ Bonus EMP armed!', GAME_W / 2, 536); }
}

function drawComplete() {
  drawWorld();
  ctx.fillStyle = 'rgba(6,10,18,0.82)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  const s = lastStats;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5f8'; ctx.font = '900 52px sans-serif';
  ctx.shadowColor = 'rgba(80,255,140,0.6)'; ctx.shadowBlur = 22;
  ctx.fillText('MISSION COMPLETE', GAME_W / 2, 140);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#eaf2ff'; ctx.font = '20px sans-serif';
  ctx.fillText(`Time: ${s.time.toFixed(1)}s   (bonus +${s.timeBonus})`, GAME_W / 2, 220);
  ctx.fillText(`Takedowns: ${s.takedowns}   (+${s.takedowns * 100})`, GAME_W / 2, 256);
  if (s.ghost) {
    ctx.fillStyle = '#6ef'; ctx.font = 'bold 24px sans-serif';
    ctx.fillText('👻 GHOST — zero alarms! (+500)', GAME_W / 2, 300);
  }
  ctx.fillStyle = '#fd5'; ctx.font = '900 40px sans-serif';
  ctx.fillText('SCORE: ' + s.score, GAME_W / 2, 366);
  drawStars(GAME_W / 2, 410, s.stars || 0, 22);
  ctx.fillStyle = '#8b96ad'; ctx.font = '15px sans-serif';
  ctx.fillText('Best: ' + s.best + (s.intelGain > 0 ? `   ·   +${s.doubled ? s.intelGain * 2 : s.intelGain} intel ◆` : ''), GAME_W / 2, 440);
  drawButton(GAME_W / 2 - 110, 460, 220, 56, missionIdx + 1 < MISSIONS.length ? 'NEXT MISSION' : 'MAIN MENU');
  if (s.intelGain > 0 && !s.doubled) {
    drawButton(GAME_W / 2 - 130, 530, 260, 42, '▶ x2 INTEL (watch ad)', { color: 'rgba(90,60,140,0.95)', stroke: '#b8f', font: 16 });
  } else if (s.doubled) {
    ctx.fillStyle = '#8f8'; ctx.font = 'bold 16px sans-serif';
    ctx.fillText('✓ Intel doubled!', GAME_W / 2, 556);
  }
}

function drawFailed() {
  drawWorld();
  ctx.fillStyle = 'rgba(20,6,8,0.85)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f66'; ctx.font = '900 52px sans-serif';
  ctx.shadowColor = 'rgba(255,60,60,0.6)'; ctx.shadowBlur = 22;
  ctx.fillText('MISSION FAILED', GAME_W / 2, 160);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#eaf2ff'; ctx.font = '19px sans-serif';
  ctx.fillText(lastStats.reason || 'You were caught.', GAME_W / 2, 220);
  drawButton(GAME_W / 2 - 110, 420, 220, 56, 'RETRY MISSION');
  if (hacked && !checkpointUsed) {
    drawButton(GAME_W / 2 - 150, 492, 300, 48, '▶ RETRY FROM CHECKPOINT (ad)', { color: 'rgba(90,60,140,0.95)', stroke: '#b8f', font: 15 });
  }
  drawButton(GAME_W / 2 - 70, 552, 140, 38, 'MENU', { color: 'rgba(35,42,58,0.95)', stroke: '#5a6a88', font: 15 });
}

function render() {
  if (state === 'menu') drawMenu();
  else if (state === 'shop') drawShop();
  else if (state === 'briefing') drawBriefing();
  else if (state === 'playing') { drawBackdrop(); drawWorld(); drawHUD(); }
  else if (state === 'complete') drawComplete();
  else if (state === 'failed') drawFailed();
  else { drawBackdrop(); }
  if (adInProgress) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = '#eaf2ff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Advertisement…', GAME_W / 2, GAME_H / 2);
  }
}

// ---------- main loop ----------
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

// ---------- boot ----------
async function boot() {
  await SDK.initSDK();
  SDK.loadingStart(); // AFTER init — otherwise it's a no-op
  unlocked = Math.max(1, Math.min(MISSIONS.length, parseInt(SDK.loadData('unlocked', '1'), 10) || 1));
  loadMeta();
  tickDailyStreak();
  AUDIO.setMuted(SDK.getMuteSetting());
  SDK.onSettingsChange((s) => { if (s && typeof s.muteAudio === 'boolean') AUDIO.setMuted(s.muteAudio); });
  state = 'menu';
  SDK.loadingStop();
  requestAnimationFrame(loop);
}
boot();

// ---------- debug hooks ----------
if (new URLSearchParams(location.search).get('debug') === '1') {
  window.__astro = {
    forceGameOver: () => { if (state === 'playing') missionFail('debug'); },
    winMission: () => { if (state === 'playing') missionComplete(); },
    addScore: () => {},
    startMission: (i) => { missionIdx = i || 0; startMission(missionIdx); },
    setMission: (n) => { missionIdx = Math.max(0, Math.min(MISSIONS.length - 1, n)); startMission(missionIdx); },
    setUnlocked: (n) => { unlocked = n; SDK.saveData('unlocked', n); },
    addIntel: (n) => { intel += n; saveMeta(); },
    setUpgrade: (id, v) => { upgrades[id] = v; saveMeta(); },
    hackAll: () => { for (const t of terminals) { t.progress = hackTimeFor(); t.done = true; t.doneAt = missionTime; } hacked = true; },
    teleport: (i, tx, ty) => { const a = agents[i]; if (a) { a.x = (tx + 0.5) * TILE; a.y = (ty + 0.5) * TILE; a.path = []; } },
    clickWorld: (wx, wy) => handleTap(-1000, -1000, (wx + 0.5) * TILE, (wy + 0.5) * TILE),
    clickScreen: (sx, sy) => handleTap(sx, sy, sx + cam.x, sy + cam.y),
    tryEmp: () => tryEmp(),
    getState: () => {
      const a = agents[activeAgent];
      const firstTerm = terminals.find(t => !t.done) || terminals[0];
      const obj = level ? (!hacked && firstTerm ? firstTerm : level.evac[0]) : { x: 0, y: 0 };
      return {
        state, mission: missionIdx,
        agentX: a ? a.x / TILE : 0, agentY: a ? a.y / TILE : 0,
        activeAgent,
        agents: agents.map(ag => ({ x: ag.x / TILE, y: ag.y / TILE, kind: ag.kind })),
        alarm, hacked, hackProgress, empCharges, unlocked, adInProgress, bonusEmp,
        objective: { x: obj.x, y: obj.y },
        guards: guards.map(g => ({ x: g.x / TILE, y: g.y / TILE, facing: g.facing, alerted: g.state === 'chase', alive: g.alive, stun: g.stun, elite: !!g.elite })),
        terminals: terminals.map(t => ({ x: t.x, y: t.y, done: t.done, progress: t.progress })),
        cameras: cameras.map(c => ({ x: c.x / TILE, y: c.y / TILE, facing: c.facing, stun: c.stun })),
        intel, stars: { ...stars }, upgrades: { ...upgrades }, skin, ownedSkins: { ...ownedSkins }, streak,
        missionCount: MISSIONS.length,
      };
    },
  };
}
