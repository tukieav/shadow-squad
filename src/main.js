// Shadow Squad — real-time tactics stealth (Commandos-like) for CrazyGames
// No blood: enemies are robot sentries that deactivate with sparks.
import { MISSIONS } from './maps.js';
import * as SDK from './sdk.js';
import * as AUDIO from './audio.js';
import * as ART from './art.js';

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
  levelArt = ART.buildLevelArt(level, mi, TILE);
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
  // typewriter skip: tap anywhere except buttons finishes the text instantly
  if (!briefSkip && stateT * 55 < MISSIONS[missionIdx].brief.length && !(sy >= 440 && sy <= 496) && !(sy >= 510 && sy <= 552)) { briefSkip = true; return; }
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
const PAL = {
  cyan: '#35e0ff', cyanDim: 'rgba(53,224,255,0.35)',
  amber: '#ffb545', text: '#c9d6e6', dim: '#66788c',
  panel: 'rgba(8,13,21,0.92)', edge: '#1e3242',
};
let levelArt = null;      // { canvas, lamps } — set in startMission
let lightCv = null, lightG = null;
let stateT = 0, lastStateName = '', briefSkip = false;

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBrackets(x, y, w, h, col, len = 9) {
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke(); ctx.lineWidth = 1;
}

function drawPanel(x, y, w, h, opts = {}) {
  ctx.fillStyle = opts.fill || PAL.panel;
  roundRect(x, y, w, h, opts.r ?? 4); ctx.fill();
  ctx.strokeStyle = opts.stroke || PAL.edge; ctx.lineWidth = 1;
  roundRect(x + 0.5, y + 0.5, w - 1, h - 1, opts.r ?? 4); ctx.stroke();
  if (opts.brackets) drawBrackets(x - 2, y - 2, w + 4, h + 4, opts.brackets);
}

function drawTiles() {
  if (levelArt) ctx.drawImage(levelArt.canvas, -cam.x, -cam.y);
  const now = performance.now();
  const x0 = Math.max(0, Math.floor(cam.x / TILE)), x1 = Math.min(level.W - 1, Math.ceil((cam.x + GAME_W) / TILE));
  const y0 = Math.max(0, Math.floor(cam.y / TILE)), y1 = Math.min(level.H - 1, Math.ceil((cam.y + GAME_H) / TILE));
  // dynamic laser gates
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (level.tiles[y][x] !== 'L') continue;
    const px = x * TILE - cam.x, py = y * TILE - cam.y;
    // emitter pillars
    ctx.fillStyle = hacked ? '#2a3244' : '#4a1620';
    ctx.fillRect(px, py, 5, TILE); ctx.fillRect(px + TILE - 5, py, 5, TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(px, py, 5, 2); ctx.fillRect(px + TILE - 5, py, 5, 2);
    if (!hacked) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,60,80,0.9)'; ctx.shadowBlur = 8;
      for (let i = 0; i < 3; i++) {
        const puls = 0.5 + 0.4 * Math.sin(now / 130 + x * 2 + i * 2.1);
        const ly = py + 8 + i * 12;
        ctx.strokeStyle = `rgba(255,60,80,${puls})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px + 5, ly); ctx.lineTo(px + TILE - 5, ly); ctx.stroke();
        ctx.strokeStyle = `rgba(255,190,200,${puls * 0.7})`; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(px + 5, ly); ctx.lineTo(px + TILE - 5, ly); ctx.stroke();
      }
      ctx.restore();
      // emitter LEDs
      ctx.fillStyle = '#ff5468';
      for (let i = 0; i < 3; i++) { ctx.fillRect(px + 1, py + 7 + i * 12, 3, 3); ctx.fillRect(px + TILE - 4, py + 7 + i * 12, 3, 3); }
      ctx.lineWidth = 1;
    }
  }
  // evac pulse (pad painted statically; pulse ring on top)
  for (const e of level.evac) {
    const cx = (e.x + 0.5) * TILE - cam.x, cy = (e.y + 0.5) * TILE - cam.y;
    const ph = (now / 1100) % 1;
    ctx.strokeStyle = `rgba(90,255,150,${0.55 * (1 - ph)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 6 + ph * 16, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(90,255,150,${0.5 + 0.3 * Math.sin(now / 300)})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy + 3); ctx.lineTo(cx - 5, cy + 3);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1;
  }
  if (level.evac.length) {
    const e = level.evac[0];
    ctx.fillStyle = '#7dffb0';
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('◤ EVAC ◥', (e.x + 1) * TILE - cam.x, e.y * TILE - cam.y - 5);
  }
  // terminals — server consoles with glow + holo ring
  for (const t of terminals) {
    const px = (t.x + 0.5) * TILE - cam.x, py = (t.y + 0.5) * TILE - cam.y;
    const done = t.done;
    const col = done ? '90,255,150' : '60,200,255';
    const flick = 0.85 + 0.15 * Math.sin(now / 90 + t.x);
    const grd = ctx.createRadialGradient(px, py, 2, px, py, TILE * 1.15);
    grd.addColorStop(0, `rgba(${col},${0.4 * flick})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(px, py, TILE * 1.15, 0, Math.PI * 2); ctx.fill();
    // holo ring
    const hr = 16 + Math.sin(now / 500) * 2;
    ctx.strokeStyle = `rgba(${col},0.4)`; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(px, py + 2, hr, now / 900, now / 900 + Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // console body
    ctx.fillStyle = '#10151f'; roundRect(px - 13, py - 15, 26, 27, 3); ctx.fill();
    ctx.strokeStyle = '#2c3648'; roundRect(px - 13, py - 15, 26, 27, 3); ctx.stroke();
    ctx.fillStyle = '#1a2230'; ctx.fillRect(px - 10, py + 6, 20, 4);
    // screen
    ctx.save(); ctx.shadowColor = `rgba(${col},0.9)`; ctx.shadowBlur = 7;
    ctx.fillStyle = `rgba(${col},${0.28 * flick})`;
    ctx.fillRect(px - 10, py - 12, 20, 14);
    ctx.restore();
    ctx.fillStyle = `rgba(${col},0.9)`;
    if (done) { // check mark
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${col},0.95)`;
      ctx.beginPath(); ctx.moveTo(px - 5, py - 5); ctx.lineTo(px - 1, py - 1); ctx.lineTo(px + 6, py - 10); ctx.stroke();
      ctx.lineWidth = 1;
    } else { // data rows + scan bar
      for (let i = 0; i < 3; i++) ctx.fillRect(px - 8, py - 10 + i * 4, 16 - ((Math.floor(now / 180) + i * 3) % 10), 2);
      const sy = py - 12 + ((now / 25) % 14);
      ctx.fillStyle = `rgba(255,255,255,0.25)`; ctx.fillRect(px - 10, sy, 20, 1.5);
    }
    // sync window countdown ring
    if (done && !hacked && level.mission.sync) {
      const rem = Math.max(0, level.mission.sync - (missionTime - (t.doneAt ?? 0)));
      const frac = rem / level.mission.sync;
      ctx.strokeStyle = frac < 0.35 ? '#f66' : '#6ef'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
  // rotating security cameras — armored dome + lens
  for (const c of cameras) {
    const px = c.x - cam.x, py = c.y - cam.y;
    // mount plate
    ctx.fillStyle = '#161c2a'; roundRect(px - 12, py - 12, 24, 24, 5); ctx.fill();
    ctx.strokeStyle = '#39465c'; roundRect(px - 12, py - 12, 24, 24, 5); ctx.stroke();
    ctx.fillStyle = '#232c3e'; ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(px, py); ctx.rotate(c.facing);
    // housing
    ctx.fillStyle = c.stun > 0 ? '#3d4c66' : '#7d8aa2';
    roundRect(-4, -6, 19, 12, 4); ctx.fill();
    ctx.fillStyle = c.stun > 0 ? '#2c3a52' : '#5a6a86';
    ctx.fillRect(9, -6, 3, 12);
    // lens + glint
    const lensCol = c.stun > 0 ? '#7df' : (alarm === 2 ? '#ff4455' : (c.detect > 0 ? '#ffcc44' : '#ff6677'));
    ctx.save(); ctx.shadowColor = lensCol; ctx.shadowBlur = 7;
    ctx.fillStyle = lensCol;
    ctx.beginPath(); ctx.arc(14, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(13.2, -1, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // status LED blink
    if (c.stun <= 0) {
      ctx.fillStyle = Math.floor(now / 400) % 2 ? '#f55' : '#611';
      ctx.fillRect(px - 10, py - 10, 3, 3);
    } else {
      ctx.fillStyle = '#7df'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('OFFLINE', px, py - 17);
    }
  }
}

function coneGradFill(gx, gy, range, rgb, aNear) {
  const grd = ctx.createRadialGradient(gx, gy, 6, gx, gy, range);
  grd.addColorStop(0, `rgba(${rgb},${aNear})`);
  grd.addColorStop(0.65, `rgba(${rgb},${aNear * 0.45})`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  return grd;
}

function drawVisionCones() {
  const now = performance.now();
  const fov = fovFor();
  let gi = 0;
  for (const g of guards) {
    gi++;
    if (!g.alive || g.stun > 0) continue;
    const range = (alarm === 2 ? 7.5 : 6) * TILE;
    const gx = g.x - cam.x, gy = g.y - cam.y;
    const n = 26;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const ang = g.facing - fov + (2 * fov * i) / n;
      let d = range;
      for (let s = TILE * 0.3; s < range; s += TILE * 0.22) {
        const x = g.x + Math.cos(ang) * s, y = g.y + Math.sin(ang) * s;
        if (solid(level, Math.floor(x / TILE), Math.floor(y / TILE))) { d = s; break; }
      }
      pts.push([gx + Math.cos(ang) * d, gy + Math.sin(ang) * d, d, ang]);
    }
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    let rgb, aNear;
    if (alarm === 2) { rgb = '255,60,60'; aNear = 0.30; }
    else if (g.detect > 0) { rgb = '255,200,40'; aNear = 0.30; }
    else if (g.elite) { rgb = '255,120,200'; aNear = 0.20; }
    else { rgb = '255,225,120'; aNear = 0.18; }
    ctx.fillStyle = coneGradFill(gx, gy, range, rgb, aNear);
    ctx.fill();
    // animated scan sweep inside the cone
    ctx.save();
    ctx.clip();
    const sw = g.facing + Math.sin(now / 420 + gi * 1.7) * fov * 0.75;
    const sweepGrd = ctx.createRadialGradient(gx, gy, 4, gx, gy, range);
    sweepGrd.addColorStop(0, `rgba(${rgb},0.30)`); sweepGrd.addColorStop(1, `rgba(${rgb},0.02)`);
    ctx.fillStyle = sweepGrd;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.arc(gx, gy, range, sw - 0.07, sw + 0.07);
    ctx.closePath(); ctx.fill();
    // faint range rings
    ctx.strokeStyle = `rgba(${rgb},0.10)`;
    ctx.beginPath(); ctx.arc(gx, gy, range * 0.55, g.facing - fov, g.facing + fov); ctx.stroke();
    ctx.restore();
    // outer rim
    ctx.strokeStyle = `rgba(${rgb},0.28)`;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    // detection meter
    if (g.detect > 0 && alarm !== 2) {
      const p = Math.min(1, g.detect / DETECT_TIME);
      ctx.fillStyle = 'rgba(4,8,14,0.85)';
      ctx.fillRect(gx - 17, gy - 36, 34, 7);
      ctx.strokeStyle = '#39465c'; ctx.strokeRect(gx - 17.5, gy - 36.5, 35, 8);
      ctx.fillStyle = p > 0.7 ? '#ff4455' : '#ffcc44';
      ctx.fillRect(gx - 15, gy - 34, 30 * p, 3);
      ctx.fillStyle = '#ffcc44'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('!', gx, gy - 40);
    }
  }
  // camera cones
  for (const c of cameras) {
    if (c.stun > 0) continue;
    const range = 6 * TILE, cfov = 0.42, n = 18;
    const cx = c.x - cam.x, cy = c.y - cam.y;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
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
    const rgb = c.detect > 0 ? '255,80,80' : '255,70,110';
    ctx.fillStyle = coneGradFill(cx, cy, range, rgb, c.detect > 0 ? 0.34 : 0.20);
    ctx.fill();
    // scan line
    ctx.save(); ctx.clip();
    const swd = ((now / 700) % 1) * range;
    ctx.strokeStyle = `rgba(${rgb},0.35)`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, swd, c.facing - cfov, c.facing + cfov); ctx.stroke();
    ctx.restore(); ctx.lineWidth = 1;
    if (c.detect > 0 && alarm !== 2) {
      const p = Math.min(1, c.detect / DETECT_TIME);
      ctx.fillStyle = 'rgba(4,8,14,0.85)';
      ctx.fillRect(cx - 17, cy - 32, 34, 7);
      ctx.fillStyle = p > 0.7 ? '#ff4455' : '#ffcc44';
      ctx.fillRect(cx - 15, cy - 30, 30 * p, 3);
    }
  }
}

function drawRobot(x, y, facing, opts = {}) {
  const now = performance.now();
  const sx = x - cam.x, sy = y - cam.y;
  const scale = opts.elite ? 1.18 : 1;
  // drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(sx + 2, sy + 4, 14 * scale, 11 * scale, 0, 0, Math.PI * 2); ctx.fill();
  if (opts.dead) { // scorch
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 17, 14, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(facing + Math.PI / 2);
  ctx.scale(scale, scale);
  // treads with segment marks
  ctx.fillStyle = opts.dead ? '#1e232e' : '#262e3e';
  roundRect(-14, -12, 6, 25, 2); ctx.fill();
  roundRect(8, -12, 6, 25, 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  const tOff = opts.dead ? 0 : (now / 60) % 5;
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(-13.5, -11 + ((i * 5 + tOff) % 23), 5, 1.6);
    ctx.fillRect(8.5, -11 + ((i * 5 + tOff) % 23), 5, 1.6);
  }
  // chassis
  ctx.fillStyle = opts.dead ? '#333a48' : (opts.stun ? '#41547a' : (opts.elite ? '#96547e' : '#6b7890'));
  roundRect(-10, -13, 20, 26, 5); ctx.fill();
  // hull plating
  const plate = opts.dead ? '#2a303c' : (opts.stun ? '#54689a' : (opts.elite ? '#c07aaa' : '#8b99b4'));
  ctx.fillStyle = plate;
  roundRect(-8, -11, 16, 10, 3); ctx.fill();
  roundRect(-8, 1, 16, 10, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke();
  // vents on rear plate
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let i = 0; i < 3; i++) ctx.fillRect(-5 + i * 4, 4, 2, 5);
  // manipulator arms
  ctx.strokeStyle = opts.dead ? '#2a303c' : '#4c586e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(-15, -2); ctx.moveTo(9, -6); ctx.lineTo(15, -2); ctx.stroke();
  ctx.fillStyle = opts.dead ? '#2a303c' : '#5c6a84';
  ctx.beginPath(); ctx.arc(-15, -1, 2.6, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(15, -1, 2.6, 0, 7); ctx.fill();
  ctx.lineWidth = 1;
  // elite armor rim
  if (opts.elite && !opts.dead) {
    ctx.strokeStyle = 'rgba(255,170,220,0.85)'; ctx.lineWidth = 2;
    roundRect(-11.5, -14.5, 23, 29, 6); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ffd0ea';
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(3, -13); ctx.lineTo(-3, -13); ctx.closePath(); ctx.fill();
  }
  // sensor head
  ctx.fillStyle = opts.dead ? '#232834' : '#39435a';
  ctx.beginPath(); ctx.arc(0, -8, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.arc(0, -8, 6, 0, Math.PI * 2); ctx.stroke();
  if (!opts.dead) {
    // glowing eye + emissive trail
    const eye = opts.stun ? '#7df' : (alarm === 2 ? '#ff4455' : '#ffd545');
    ctx.save(); ctx.shadowColor = eye; ctx.shadowBlur = 8;
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.arc(0, -11, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // scanning antenna
    const aw = Math.sin(now / 300) * 0.8;
    ctx.strokeStyle = 'rgba(160,180,210,0.7)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(Math.sin(aw) * 4, -19); ctx.stroke();
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.arc(Math.sin(aw) * 4, -19.5, 1.3, 0, 7); ctx.fill();
    ctx.lineWidth = 1;
  } else {
    ctx.strokeStyle = '#5a6478'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-3, -11); ctx.lineTo(3, -5); ctx.moveTo(3, -11); ctx.lineTo(-3, -5); ctx.stroke();
    ctx.lineWidth = 1;
  }
  ctx.restore();
  if (opts.stun) {
    ctx.fillStyle = '#7df';
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    const zt = Math.floor(now / 250) % 3;
    ctx.fillText('z'.repeat(zt + 1), sx + 15, sy - 20);
  }
}

function drawAgent(a, active) {
  const now = performance.now();
  const x = a.x - cam.x, y = a.y - cam.y;
  const color = agentColor(a.kind);
  const tx = Math.floor(a.x / TILE), ty = Math.floor(a.y / TILE);
  const hidden = isGrass(level, tx, ty);
  // drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + 4, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  if (hidden) ctx.globalAlpha = 0.55;
  if (active) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(x, y, 18, now / 500, now / 500 + Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.translate(x, y);
  ctx.rotate(a.facing + Math.PI / 2);
  // 2-frame step animation
  if (a.moving) {
    const ph = Math.sin(now / 90) > 0 ? 1 : -1;
    ctx.fillStyle = '#0b0e16';
    roundRect(-6.5, 6 + ph * 3.4, 5, 7, 2); ctx.fill();
    roundRect(1.5, 6 - ph * 3.4, 5, 7, 2); ctx.fill();
  }
  // tech backpack (behind body)
  if (a.kind === 'tech') {
    ctx.fillStyle = '#20242e'; roundRect(-6, 5, 12, 9, 3); ctx.fill();
    ctx.save(); ctx.shadowColor = '#ff9a3d'; ctx.shadowBlur = 6;
    ctx.fillStyle = Math.floor(now / 600) % 2 ? '#ff9a3d' : '#c96f1e';
    ctx.fillRect(-2, 8, 4, 3);
    ctx.restore();
    // antenna
    ctx.strokeStyle = '#4c586e'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(5, 8); ctx.lineTo(8, 14); ctx.stroke(); ctx.lineWidth = 1;
  }
  // cloaked body with rim light
  ctx.fillStyle = '#10161f';
  ctx.beginPath(); ctx.ellipse(0, 0, 11.5, 13.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2c3a50';
  ctx.beginPath(); ctx.ellipse(0, 0, 9.5, 11.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3d5070';
  ctx.beginPath(); ctx.ellipse(-1.5, -2, 7, 8.5, 0, 0, Math.PI * 2); ctx.fill();
  // rim light in agent color
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.globalAlpha *= 0.9;
  ctx.beginPath(); ctx.ellipse(0, 0, 11, 13, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = hidden ? 0.55 : 1;
  // shoulder rig + accent straps
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-8, -2); ctx.lineTo(-3, 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, -2); ctx.lineTo(3, 6); ctx.stroke();
  ctx.lineWidth = 1;
  if (a.kind === 'scout') {
    // knife sheath
    ctx.fillStyle = '#39435a'; roundRect(6, 0, 3.4, 9, 1.5); ctx.fill();
  }
  // hood
  ctx.fillStyle = '#151c2a';
  ctx.beginPath(); ctx.arc(0, -3.5, 6.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#232e42';
  ctx.beginPath(); ctx.arc(-0.5, -4.2, 5.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath(); ctx.arc(0, -3.5, 6.5, Math.PI * 0.85, Math.PI * 2.15); ctx.stroke();
  // hood rim accent (direction!)
  ctx.strokeStyle = color; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(0, -3.5, 6.3, -Math.PI * 0.92, -Math.PI * 0.08); ctx.stroke();
  ctx.lineWidth = 1;
  // glowing visor wedge = facing direction
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-3.4, -6.5); ctx.lineTo(3.4, -6.5); ctx.lineTo(2.2, -4.3); ctx.lineTo(-2.2, -4.3);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
  ctx.globalAlpha = 1;
  // path preview for active
  if (active && a.path.length) {
    const last = a.path[a.path.length - 1];
    ctx.strokeStyle = 'rgba(53,224,255,0.4)';
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -now / 40;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (const p of a.path) ctx.lineTo((p.x + 0.5) * TILE - cam.x, (p.y + 0.5) * TILE - cam.y);
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    const lx = (last.x + 0.5) * TILE - cam.x, ly = (last.y + 0.5) * TILE - cam.y;
    ctx.strokeStyle = 'rgba(53,224,255,0.7)';
    ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx - 9, ly); ctx.lineTo(lx - 4, ly); ctx.moveTo(lx + 4, ly); ctx.lineTo(lx + 9, ly);
    ctx.moveTo(lx, ly - 9); ctx.lineTo(lx, ly - 4); ctx.moveTo(lx, ly + 4); ctx.lineTo(lx, ly + 9); ctx.stroke();
  }
  // hacking indicator
  if (a.hacking) {
    drawPanel(x - 24, y - 34, 48, 10, { r: 2 });
    ctx.fillStyle = PAL.cyan; ctx.fillRect(x - 22, y - 32, 44 * Math.min(1, hackProgress / hackTimeFor()), 6);
    ctx.fillStyle = '#9ceaff'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('▸ HACKING', x, y - 38);
  }
  if (hidden) {
    ctx.fillStyle = 'rgba(140,255,170,0.85)';
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('◈ CONCEALED', x, y + 28);
  }
}

// ---------- lighting & atmosphere ----------
function drawLighting() {
  if (!lightCv) {
    lightCv = document.createElement('canvas');
    lightCv.width = GAME_W; lightCv.height = GAME_H;
    lightG = lightCv.getContext('2d');
  }
  const lg = lightG;
  lg.globalCompositeOperation = 'source-over';
  lg.clearRect(0, 0, GAME_W, GAME_H);
  lg.fillStyle = alarm === 2 ? 'rgba(18,3,8,0.50)' : 'rgba(3,6,15,0.54)';
  lg.fillRect(0, 0, GAME_W, GAME_H);
  lg.globalCompositeOperation = 'destination-out';
  const hole = (hx, hy, r, a) => {
    if (hx < -r || hy < -r || hx > GAME_W + r || hy > GAME_H + r) return;
    const grd = lg.createRadialGradient(hx, hy, r * 0.12, hx, hy, r);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    lg.fillStyle = grd;
    lg.beginPath(); lg.arc(hx, hy, r, 0, Math.PI * 2); lg.fill();
  };
  if (levelArt) for (const l of levelArt.lamps) hole(l.x - cam.x, l.y - cam.y, 3.0 * TILE, 0.92);
  for (const t of terminals) hole((t.x + 0.5) * TILE - cam.x, (t.y + 0.5) * TILE - cam.y, 1.9 * TILE, 0.6);
  for (const e of level.evac) hole((e.x + 0.5) * TILE - cam.x, (e.y + 0.5) * TILE - cam.y, 1.5 * TILE, 0.5);
  for (const a of agents) hole(a.x - cam.x, a.y - cam.y, 1.7 * TILE, 0.55);
  for (const g of guards) if (g.alive) hole(g.x - cam.x, g.y - cam.y, TILE, 0.32);
  ctx.drawImage(lightCv, 0, 0);
  // alarm atmosphere: red pulse + rotating beacons
  if (alarm === 2) {
    const now = performance.now();
    const pulse = 0.05 + 0.05 * Math.sin(now / 110);
    ctx.fillStyle = `rgba(255,30,45,${pulse})`;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    if (levelArt) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      let bi = 0;
      for (const l of levelArt.lamps) {
        if ((bi++ % 2) !== 0) continue;
        const bx = l.x - cam.x, by = l.y - cam.y;
        if (bx < -100 || by < -100 || bx > GAME_W + 100 || by > GAME_H + 100) continue;
        const ba = now / 350 + bi;
        for (const off of [0, Math.PI]) {
          const grd = ctx.createRadialGradient(bx, by, 4, bx, by, 2.4 * TILE);
          grd.addColorStop(0, 'rgba(255,40,50,0.20)'); grd.addColorStop(1, 'rgba(255,40,50,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.moveTo(bx, by);
          ctx.arc(bx, by, 2.4 * TILE, ba + off - 0.35, ba + off + 0.35);
          ctx.closePath(); ctx.fill();
        }
        // beacon dot
        ctx.fillStyle = `rgba(255,70,80,${0.6 + 0.4 * Math.sin(now / 120)})`;
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  } else if (alarm === 1) {
    ctx.fillStyle = `rgba(255,190,40,${0.03 + 0.02 * Math.sin(performance.now() / 200)})`;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  }
}

function drawHUD() {
  const now = performance.now();
  // agent portraits — military tags
  for (let i = 0; i < 2; i++) {
    const p = UI.portraits[i];
    const a = agents[i];
    const col = agentColor(a.kind);
    const isActive = i === activeAgent;
    drawPanel(p.x, p.y, p.w, p.h, {
      fill: isActive ? 'rgba(12,22,34,0.95)' : 'rgba(7,11,18,0.85)',
      stroke: isActive ? col : PAL.edge,
      brackets: isActive ? col : null,
    });
    // drawn portrait: hooded head with visor
    const cx = p.x + p.w / 2, cy = p.y + 26;
    ctx.fillStyle = '#060910';
    ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10151f';
    ctx.beginPath(); ctx.arc(cx, cy, 13, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a0d15';
    ctx.beginPath(); ctx.ellipse(cx, cy + 6, 12, 8, 0, Math.PI, Math.PI * 2, true); ctx.fill();
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = isActive ? 8 : 3;
    ctx.fillStyle = col;
    ctx.fillRect(cx - 8, cy - 2, 16, 3.4);
    ctx.restore();
    ctx.strokeStyle = col; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, 13.5, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = isActive ? '#eaf4ff' : PAL.dim;
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(a.kind === 'scout' ? 'SCOUT' : 'TECH', cx, p.y + 56);
    ctx.fillStyle = isActive ? col : '#3d4a5c'; ctx.font = '9px monospace';
    ctx.fillText(i === 0 ? '[1]' : '[2]', cx, p.y + 68);
  }
  // mission readout (top center)
  drawPanel(GAME_W / 2 - 135, 10, 270, 46, { brackets: 'rgba(53,224,255,0.35)' });
  ctx.fillStyle = PAL.cyan; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`OP ${String(missionIdx + 1).padStart(2, '0')} // ${level.mission.name}`, GAME_W / 2, 27);
  ctx.fillStyle = PAL.amber; ctx.font = 'bold 12px monospace';
  const mm = Math.floor(missionTime / 60), ss = (missionTime % 60).toFixed(1).padStart(4, '0');
  ctx.fillText(`T+${mm}:${ss}`, GAME_W / 2 - 42, 46);
  // threat readout
  const thrCol = alarm === 2 ? '#ff4455' : alarm === 1 ? '#ffcc44' : '#57e08a';
  ctx.fillStyle = thrCol; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(alarm === 2 ? '▮▮▮ ALARM' : alarm === 1 ? '▮▮▯ WARY' : '▮▯▯ CALM', GAME_W / 2 + 8, 46);
  if (alarm === 2 && Math.floor(now / 220) % 2) {
    ctx.strokeStyle = '#ff4455'; ctx.lineWidth = 2;
    roundRect(GAME_W / 2 - 137, 8, 274, 50, 5); ctx.stroke(); ctx.lineWidth = 1;
  }
  // objective strip (bottom center) with icon
  drawPanel(GAME_W / 2 - 165, GAME_H - 36, 330, 28, {});
  const termLeft = terminals.filter(t => !t.done).length;
  ctx.textAlign = 'left';
  const obx = GAME_W / 2 - 152, oby = GAME_H - 22;
  if (hacked) { // evac icon
    ctx.fillStyle = '#57e08a';
    ctx.beginPath(); ctx.moveTo(obx + 5, oby - 6); ctx.lineTo(obx + 10, oby + 1); ctx.lineTo(obx, oby + 1); ctx.closePath(); ctx.fill();
    ctx.fillRect(obx + 3, oby + 2, 4, 4);
  } else { // terminal icon
    ctx.fillStyle = PAL.cyan;
    ctx.fillRect(obx, oby - 7, 10, 8);
    ctx.fillStyle = '#04121c'; ctx.fillRect(obx + 1.5, oby - 5.5, 7, 5);
    ctx.fillStyle = PAL.cyan; ctx.fillRect(obx + 3, oby + 2, 4, 2.5);
  }
  ctx.fillStyle = hacked ? '#8dffc0' : '#9ceaff'; ctx.font = 'bold 11px monospace';
  ctx.fillText(hacked ? 'EXFIL: BOTH AGENTS → EVAC PAD' : (terminals.length > 1 ? `BREACH ${termLeft} TERMINAL${termLeft > 1 ? 'S' : ''}${level.mission.sync ? ' [SYNCED]' : ''}` : 'BREACH THE TERMINAL'), obx + 18, GAME_H - 17);
  // EMP button — hex charge unit
  const b = UI.empBtn;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2, br = b.w / 2;
  const armed = empCharges > 0;
  ctx.fillStyle = armed ? 'rgba(10,20,36,0.92)' : 'rgba(10,13,20,0.8)';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a2 = i / 6 * Math.PI * 2 - Math.PI / 2; const px2 = bx + Math.cos(a2) * br, py2 = by + Math.sin(a2) * br; i ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2); }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = armed ? PAL.cyan : '#2c3648'; ctx.lineWidth = 2;
  ctx.stroke(); ctx.lineWidth = 1;
  if (armed) {
    ctx.save(); ctx.shadowColor = PAL.cyan; ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(53,224,255,0.5)';
    ctx.beginPath(); ctx.arc(bx, by, br - 8, now / 800, now / 800 + Math.PI * 1.2); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = armed ? '#bdeeff' : '#44506480'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = armed ? '#bdeeff' : '#445064';
  ctx.fillText('EMP', bx, by - 4);
  // charge pips
  for (let i = 0; i < Math.max(empCharges, 1); i++) {
    if (i >= empCharges) break;
    ctx.fillStyle = PAL.amber;
    ctx.fillRect(bx - (empCharges * 5) + i * 10 + 1, by + 6, 7, 4);
  }
  if (empCharges === 0) { ctx.fillStyle = '#445064'; ctx.font = '9px monospace'; ctx.fillText('EMPTY', bx, by + 12); }
  ctx.fillStyle = armed ? '#6f90a8' : '#3a4658'; ctx.font = '9px monospace';
  ctx.fillText('[R]', bx, by + 24);
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
    const gx = g.x - cam.x, gy = g.y - cam.y;
    ctx.strokeStyle = '#ff8899'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(gx, gy, 21, performance.now() / 300, performance.now() / 300 + Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
  }
  // agents
  drawAgent(agents[1 - activeAgent], false);
  drawAgent(agents[activeAgent], true);
  // rings (EMP shockwave = layered blue wave)
  for (const r of rings) {
    if (r.delay > 0) continue;
    const a = Math.max(0, r.a);
    const rx = r.x - cam.x, ry = r.y - cam.y;
    if (r.blue) {
      const grd = ctx.createRadialGradient(rx, ry, Math.max(1, r.r - 18), rx, ry, r.r + 6);
      grd.addColorStop(0, 'rgba(90,170,255,0)');
      grd.addColorStop(0.7, `rgba(120,200,255,${a * 0.35})`);
      grd.addColorStop(1, 'rgba(90,170,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(rx, ry, r.r + 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(180,230,255,${a})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(rx, ry, r.r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(90,170,255,${a * 0.5})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(rx, ry, r.r * 0.8, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeStyle = `rgba(255,60,60,${a})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(rx, ry, r.r, 0, Math.PI * 2); ctx.stroke();
    }
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
      ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x - cam.x, f.y - cam.y - (1 - f.t) * 20);
      ctx.globalAlpha = 1;
    } else if (f.kind === 'marker') {
      ctx.strokeStyle = `rgba(53,224,255,${f.t * 2})`;
      ctx.beginPath(); ctx.arc(f.x - cam.x, f.y - cam.y, (0.5 - f.t) * 30 + 6, 0, Math.PI * 2); ctx.stroke();
    }
  }
  drawLighting();
  ctx.restore();
}

function drawBackdrop() {
  const bg = ctx.createLinearGradient(0, 0, 0, GAME_H);
  bg.addColorStop(0, '#04060c'); bg.addColorStop(1, '#080d18');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, GAME_W, GAME_H);
  // faint blueprint grid
  ctx.strokeStyle = 'rgba(53,224,255,0.035)'; ctx.lineWidth = 1;
  for (let x = 0; x <= GAME_W; x += 48) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, GAME_H); ctx.stroke(); }
  for (let y = 0; y <= GAME_H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(GAME_W, y + 0.5); ctx.stroke(); }
}

function drawButton(x, y, w, h, label, opts = {}) {
  const grd = ctx.createLinearGradient(0, y, 0, y + h);
  if (opts.disabled) { grd.addColorStop(0, 'rgba(20,24,32,0.9)'); grd.addColorStop(1, 'rgba(14,17,24,0.9)'); }
  else if (opts.color) { ctx.fillStyle = opts.color; }
  else { grd.addColorStop(0, 'rgba(16,42,60,0.95)'); grd.addColorStop(1, 'rgba(9,24,38,0.95)'); }
  ctx.fillStyle = (opts.color && !opts.disabled) ? opts.color : grd;
  roundRect(x, y, w, h, 5); ctx.fill();
  const edge = opts.disabled ? '#2a3140' : (opts.stroke || PAL.cyan);
  ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
  roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 5); ctx.stroke(); ctx.lineWidth = 1;
  drawBrackets(x - 3, y - 3, w + 6, h + 6, opts.disabled ? 'rgba(60,70,90,0.4)' : edge, 8);
  ctx.fillStyle = opts.disabled ? '#4d586c' : '#eaf6ff';
  ctx.font = `bold ${opts.font || 18}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawStars(cx, cy, n, size = 10, dim = '#2c3648', animT = -1) {
  for (let i = 0; i < 3; i++) {
    let sc = 1;
    if (animT >= 0 && i < n) {
      const t = Math.max(0, Math.min(1, (animT - 0.25 - i * 0.3) * 3));
      if (t <= 0) continue;
      sc = t < 0.6 ? 0.4 + t * 1.6 : 1.36 - (t - 0.6) * 0.9;
    }
    const lit = i < n;
    if (lit) { ctx.save(); ctx.shadowColor = 'rgba(255,213,85,0.9)'; ctx.shadowBlur = 10; }
    ctx.fillStyle = lit ? '#ffd555' : dim;
    ctx.font = `bold ${Math.round((size + 2) * sc)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('★', cx + (i - 1) * (size + 4), cy);
    if (lit) ctx.restore();
  }
}

function drawScreenFx(strength = 1) {
  ctx.globalAlpha = 0.5 * strength;
  ctx.drawImage(ART.getScanlines(GAME_W, GAME_H), 0, 0);
  ctx.globalAlpha = strength;
  ctx.drawImage(ART.getVignette(GAME_W, GAME_H), 0, 0);
  ctx.globalAlpha = 1;
}

function drawMenu() {
  const now = performance.now();
  drawBackdrop();
  // radar sweep decor
  ctx.save();
  const rx = GAME_W - 110, ry = 520;
  ctx.strokeStyle = 'rgba(53,224,255,0.10)';
  for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(rx, ry, i * 26, 0, Math.PI * 2); ctx.stroke(); }
  const ra = now / 1300;
  const rg = ctx.createRadialGradient(rx, ry, 2, rx, ry, 80);
  rg.addColorStop(0, 'rgba(53,224,255,0.20)'); rg.addColorStop(1, 'rgba(53,224,255,0)');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.moveTo(rx, ry); ctx.arc(rx, ry, 80, ra, ra + 0.6); ctx.closePath(); ctx.fill();
  ctx.restore();
  // title
  ctx.textAlign = 'center';
  ctx.font = '900 46px monospace';
  ctx.fillStyle = 'rgba(53,224,255,0.14)';
  ctx.fillText('SHADOW SQUAD', GAME_W / 2 + 2, 68);
  ctx.save();
  ctx.shadowColor = 'rgba(53,224,255,0.8)'; ctx.shadowBlur = 22;
  ctx.fillStyle = '#e8f8ff';
  ctx.fillText('SHADOW SQUAD', GAME_W / 2, 66);
  ctx.restore();
  ctx.strokeStyle = 'rgba(53,224,255,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(GAME_W / 2 - 250, 80); ctx.lineTo(GAME_W / 2 + 250, 80); ctx.stroke();
  ctx.fillStyle = PAL.amber; ctx.font = 'bold 12px monospace';
  ctx.fillText('// REAL-TIME TACTICS · TWO AGENTS · ZERO ALARMS //', GAME_W / 2, 96);
  // intel + streak (top-left)
  drawPanel(16, 14, 190, 44, { brackets: 'rgba(53,224,255,0.3)' });
  ctx.textAlign = 'left';
  ctx.fillStyle = PAL.cyan; ctx.font = 'bold 14px monospace';
  ctx.fillText('◆ INTEL: ' + intel, 28, 33);
  ctx.fillStyle = streak > 1 ? PAL.amber : '#4d586c'; ctx.font = 'bold 11px monospace';
  ctx.fillText('▲ STREAK: ' + streak + ' DAY' + (streak === 1 ? '' : 'S'), 28, 51);
  // shop button (top-right)
  drawButton(GAME_W - 160, 14, 140, 44, '◆ SHOP', { color: 'rgba(44,26,66,0.95)', stroke: '#b385ff', font: 15 });
  // mission network: connection lines behind tiles
  const centers = [];
  for (let i = 0; i < MISSIONS.length; i++) {
    centers.push([GAME_W / 2 - 260 + (i % 5) * 110 + 48, 118 + Math.floor(i / 5) * 106 + 48]);
  }
  ctx.save();
  for (let i = 0; i < centers.length - 1; i++) {
    const on = i + 1 < unlocked;
    ctx.strokeStyle = on ? 'rgba(53,224,255,0.45)' : 'rgba(60,72,92,0.35)';
    ctx.lineWidth = on ? 2 : 1;
    ctx.setLineDash(on ? [] : [4, 5]);
    ctx.beginPath(); ctx.moveTo(centers[i][0], centers[i][1]); ctx.lineTo(centers[i + 1][0], centers[i + 1][1]); ctx.stroke();
    if (on) { // data pulse traveling the link
      const t = (now / 1400 + i * 0.37) % 1;
      const px = centers[i][0] + (centers[i + 1][0] - centers[i][0]) * t;
      const py = centers[i][1] + (centers[i + 1][1] - centers[i][1]) * t;
      ctx.fillStyle = PAL.cyan;
      ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.setLineDash([]); ctx.lineWidth = 1;
  ctx.restore();
  // mission nodes: 2 rows of 5
  menuButtons.length = 0;
  for (let i = 0; i < MISSIONS.length; i++) {
    const bx = GAME_W / 2 - 260 + (i % 5) * 110, by = 118 + Math.floor(i / 5) * 106;
    const locked = i >= unlocked;
    menuButtons.push({ x: bx, y: by, w: 96, h: 96, mi: i });
    if (!locked) { ctx.save(); ctx.shadowColor = 'rgba(53,224,255,0.55)'; ctx.shadowBlur = 12; }
    ctx.fillStyle = locked ? 'rgba(12,15,22,0.9)' : 'rgba(10,20,32,0.96)';
    roundRect(bx, by, 96, 96, 6); ctx.fill();
    if (!locked) ctx.restore();
    ctx.strokeStyle = locked ? '#232b3a' : PAL.cyan; ctx.lineWidth = locked ? 1 : 1.5;
    roundRect(bx + 0.5, by + 0.5, 95, 95, 6); ctx.stroke(); ctx.lineWidth = 1;
    if (!locked) drawBrackets(bx - 3, by - 3, 102, 102, 'rgba(53,224,255,0.5)', 10);
    ctx.textAlign = 'center';
    if (locked) {
      ctx.fillStyle = '#333e52'; ctx.font = '20px monospace';
      ctx.fillText('▓', bx + 48, by + 40);
      ctx.fillStyle = '#3d4a60'; ctx.font = 'bold 10px monospace';
      ctx.fillText('LOCKED', bx + 48, by + 60);
    } else {
      ctx.fillStyle = '#eaf6ff'; ctx.font = '900 26px monospace';
      ctx.fillText(String(i + 1).padStart(2, '0'), bx + 48, by + 38);
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#7fb8d8';
      ctx.fillText(MISSIONS[i].name, bx + 48, by + 58);
      drawStars(bx + 48, by + 80, stars[i] || 0, 11);
    }
  }
  // quick play
  const qm = Math.min(unlocked, MISSIONS.length);
  drawButton(GAME_W / 2 - 130, 348, 260, 50, '▶ DEPLOY: OP ' + String(qm).padStart(2, '0'), { font: 17 });
  ctx.fillStyle = '#4d586c'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('· SELECT ANY UNLOCKED OP ABOVE — REPLAY FOR 3★ ·', GAME_W / 2, 420);
  // how to play — terminal card
  const hx = GAME_W / 2 - 300;
  drawPanel(hx - 16, 436, 632, 138, {});
  ctx.textAlign = 'left';
  let hy = 458;
  ctx.fillStyle = PAL.cyan; ctx.font = 'bold 12px monospace';
  ctx.fillText('> FIELD MANUAL', hx, hy); hy += 20;
  ctx.fillStyle = '#7c93a8'; ctx.font = '12px monospace';
  const lines = [
    'CLICK/TAP to move · keys 1 & 2 (or portraits) switch agents',
    'SCOUT: silent takedowns from behind · TECH: remote hacks + EMP [R]',
    'Avoid vision cones (sentries AND cameras) · grass conceals you',
    'Hack every terminal, then get BOTH agents to the evac pad',
    'Earn ★ for par time & ghost runs → spend INTEL in the shop',
  ];
  for (const l of lines) { ctx.fillText(l, hx, hy); hy += 19; }
  ctx.textAlign = 'center';
  // daily bonus toast
  if (dailyToastT > 0) {
    ctx.globalAlpha = Math.min(1, dailyToastT);
    drawPanel(GAME_W / 2 - 160, 560, 320, 34, { stroke: '#57e08a', brackets: 'rgba(87,224,138,0.6)' });
    ctx.fillStyle = '#8dffc0'; ctx.font = 'bold 13px monospace';
    ctx.fillText(`DAILY LOGIN — DAY ${streak}: +${dailyBonus} INTEL`, GAME_W / 2, 582);
    ctx.globalAlpha = 1;
  }
  drawScreenFx(0.6);
}

function drawShop() {
  drawBackdrop();
  drawButton(20, 20, 120, 42, '← BACK', { color: 'rgba(20,26,38,0.95)', stroke: '#5a7088', font: 14 });
  ctx.textAlign = 'center';
  ctx.save(); ctx.shadowColor = 'rgba(179,133,255,0.7)'; ctx.shadowBlur = 18;
  ctx.fillStyle = '#f2eaff'; ctx.font = '900 34px monospace';
  ctx.fillText('BLACK MARKET', GAME_W / 2, 52);
  ctx.restore();
  ctx.fillStyle = PAL.cyan; ctx.font = 'bold 17px monospace';
  ctx.fillText('◆ INTEL: ' + intel, GAME_W / 2, 84);
  ctx.fillStyle = '#66788c'; ctx.font = '11px monospace';
  ctx.fillText('EARN INTEL FROM MISSION STARS (★ = 5) · REPLAY OPS FOR BETTER RATINGS', GAME_W / 2, 110);
  ctx.fillStyle = PAL.amber; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
  ctx.fillText('▸ PERMANENT GADGETS', GAME_W / 2 - 330, 148);
  for (let i = 0; i < SHOP_ITEMS.length; i++) {
    const it = SHOP_ITEMS[i];
    const bx = GAME_W / 2 - 330 + i * 225, by = 160;
    const owned = !!upgrades[it.id];
    const afford = intel >= it.cost;
    drawPanel(bx, by, 205, 150, {
      fill: owned ? 'rgba(10,32,22,0.95)' : 'rgba(10,18,30,0.95)',
      stroke: owned ? '#57e08a' : (afford ? PAL.cyan : '#232b3a'),
      brackets: owned ? 'rgba(87,224,138,0.5)' : (afford ? 'rgba(53,224,255,0.4)' : null),
    });
    ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
    ctx.fillText(it.name, bx + 102, by + 34);
    ctx.fillStyle = '#7c93a8'; ctx.font = '11px monospace';
    const words = it.desc.split(' '); let line = '', ly = by + 62;
    for (const w of words) {
      if (ctx.measureText(line + w).width > 180) { ctx.fillText(line, bx + 102, ly); ly += 16; line = ''; }
      line += w + ' ';
    }
    ctx.fillText(line, bx + 102, ly);
    ctx.font = 'bold 15px monospace';
    ctx.fillStyle = owned ? '#57e08a' : (afford ? PAL.cyan : '#ff6677');
    ctx.fillText(owned ? '✓ OWNED' : '◆ ' + it.cost, bx + 102, by + 128);
  }
  ctx.fillStyle = PAL.amber; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
  ctx.fillText('▸ AGENT SKINS', GAME_W / 2 - 330, 356);
  const keys = Object.keys(SKINS);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], sk = SKINS[k];
    const bx = GAME_W / 2 - 330 + i * 225, by = 370;
    const owned = !!ownedSkins[k], active = skin === k;
    drawPanel(bx, by, 205, 130, {
      fill: active ? 'rgba(10,32,22,0.95)' : 'rgba(10,18,30,0.95)',
      stroke: active ? '#57e08a' : (owned ? PAL.cyan : '#232b3a'),
      brackets: active ? 'rgba(87,224,138,0.5)' : null,
    });
    // agent bust previews
    for (const [j, col] of [[0, sk.scout], [1, sk.tech]]) {
      const cx = bx + 80 + j * 44, cy = by + 42;
      ctx.fillStyle = '#0a0d15'; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 6;
      ctx.fillStyle = col; ctx.fillRect(cx - 7, cy - 2, 14, 3);
      ctx.restore();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 12, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillText(sk.name, bx + 102, by + 84);
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = active ? '#57e08a' : (owned ? '#7fb8d8' : (intel >= sk.cost ? PAL.cyan : '#ff6677'));
    ctx.fillText(active ? '✓ EQUIPPED' : (owned ? 'TAP TO EQUIP' : '◆ ' + sk.cost), bx + 102, by + 110);
  }
  ctx.fillStyle = '#4d586c'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`TOTAL STARS: ${totalStars()} / ${MISSIONS.length * 3}`, GAME_W / 2, 540);
  drawScreenFx(0.6);
}

function drawBriefing() {
  drawBackdrop();
  const m = MISSIONS[missionIdx];
  ctx.textAlign = 'center';
  drawPanel(GAME_W / 2 - 340, 66, 680, 330, { brackets: 'rgba(53,224,255,0.4)' });
  ctx.fillStyle = PAL.amber; ctx.font = 'bold 12px monospace';
  const blink = Math.floor(performance.now() / 500) % 2 ? '●' : '○';
  ctx.fillText(`${blink} INCOMING TRANSMISSION — CLEARANCE LEVEL ${missionIdx + 1} ${blink}`, GAME_W / 2, 98);
  ctx.save(); ctx.shadowColor = 'rgba(53,224,255,0.7)'; ctx.shadowBlur = 14;
  ctx.fillStyle = '#e8f8ff'; ctx.font = '900 40px monospace';
  ctx.fillText(`OP ${String(missionIdx + 1).padStart(2, '0')}: ${m.name}`, GAME_W / 2, 152);
  ctx.restore();
  ctx.strokeStyle = 'rgba(53,224,255,0.35)';
  ctx.beginPath(); ctx.moveTo(GAME_W / 2 - 300, 172); ctx.lineTo(GAME_W / 2 + 300, 172); ctx.stroke();
  // typewriter effect (skippable via any click)
  const full = m.brief;
  const chars = briefSkip ? full.length : Math.min(full.length, Math.floor(stateT * 55));
  const shown = full.slice(0, chars) + (chars < full.length && Math.floor(performance.now() / 250) % 2 ? '▌' : '');
  ctx.fillStyle = '#9fd8ef'; ctx.font = '15px monospace';
  const words = shown.split(' ');
  let line = '', ly = 214;
  for (const w of words) {
    if (ctx.measureText(line + w).width > 600) { ctx.fillText(line, GAME_W / 2, ly); ly += 24; line = ''; }
    line += w + ' ';
  }
  ctx.fillText(line, GAME_W / 2, ly);
  ctx.fillStyle = '#66788c'; ctx.font = '13px monospace';
  ctx.fillText(`SENTRIES: ${m.guards.length}${m.cameras ? '  ·  CAMERAS: ' + m.cameras.length : ''}  ·  PAR: ${m.par}s  ·  EMP: ${2 + bonusEmp + upgrades.emp}`, GAME_W / 2, 330);
  ctx.fillStyle = '#57e08a'; ctx.font = '12px monospace';
  ctx.fillText('★ UNDER PAR TIME  ·  ★ GHOST (ZERO ALARMS)  ·  STARS → INTEL ◆', GAME_W / 2, 358);
  drawButton(GAME_W / 2 - 110, 440, 220, 56, '▶ START MISSION', { font: 16 });
  if (bonusEmp === 0) drawButton(GAME_W / 2 - 130, 510, 260, 42, '▶ +1 EMP (WATCH AD)', { color: 'rgba(44,26,66,0.95)', stroke: '#b385ff', font: 13 });
  else { ctx.fillStyle = '#8dffc0'; ctx.font = 'bold 14px monospace'; ctx.fillText('✓ BONUS EMP ARMED', GAME_W / 2, 536); }
  drawScreenFx(0.6);
}

function drawComplete() {
  drawWorld();
  ctx.fillStyle = 'rgba(3,8,14,0.85)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  const s = lastStats;
  ctx.textAlign = 'center';
  drawPanel(GAME_W / 2 - 280, 70, 560, 390, { brackets: 'rgba(87,224,138,0.5)' });
  ctx.fillStyle = '#57e08a'; ctx.font = '900 44px monospace';
  ctx.save(); ctx.shadowColor = 'rgba(87,224,138,0.7)'; ctx.shadowBlur = 22;
  ctx.fillText('MISSION COMPLETE', GAME_W / 2, 140);
  ctx.restore();
  ctx.strokeStyle = 'rgba(87,224,138,0.35)';
  ctx.beginPath(); ctx.moveTo(GAME_W / 2 - 230, 160); ctx.lineTo(GAME_W / 2 + 230, 160); ctx.stroke();
  ctx.fillStyle = '#c9d6e6'; ctx.font = '17px monospace';
  ctx.fillText(`TIME  ${s.time.toFixed(1)}s   (BONUS +${s.timeBonus})`, GAME_W / 2, 212);
  ctx.fillText(`TAKEDOWNS  ${s.takedowns}   (+${s.takedowns * 100})`, GAME_W / 2, 246);
  if (s.ghost) {
    ctx.fillStyle = PAL.cyan; ctx.font = 'bold 20px monospace';
    ctx.fillText('◈ GHOST — ZERO ALARMS (+500)', GAME_W / 2, 288);
  }
  ctx.save(); ctx.shadowColor = 'rgba(255,213,85,0.6)'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#ffd555'; ctx.font = '900 36px monospace';
  ctx.fillText('SCORE ' + s.score, GAME_W / 2, 352);
  ctx.restore();
  drawStars(GAME_W / 2, 400, s.stars || 0, 22, '#2c3648', stateT);
  ctx.fillStyle = '#66788c'; ctx.font = '13px monospace';
  ctx.fillText('BEST ' + s.best + (s.intelGain > 0 ? `   ·   +${s.doubled ? s.intelGain * 2 : s.intelGain} INTEL ◆` : ''), GAME_W / 2, 440);
  drawButton(GAME_W / 2 - 110, 460, 220, 56, missionIdx + 1 < MISSIONS.length ? 'NEXT MISSION ▶' : 'MAIN MENU', { font: 15 });
  if (s.intelGain > 0 && !s.doubled) {
    drawButton(GAME_W / 2 - 130, 530, 260, 42, '▶ x2 INTEL (WATCH AD)', { color: 'rgba(44,26,66,0.95)', stroke: '#b385ff', font: 13 });
  } else if (s.doubled) {
    ctx.fillStyle = '#8dffc0'; ctx.font = 'bold 14px monospace';
    ctx.fillText('✓ INTEL DOUBLED', GAME_W / 2, 556);
  }
  drawScreenFx(0.5);
}

function drawFailed() {
  drawWorld();
  ctx.fillStyle = 'rgba(16,3,6,0.87)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  // glitch bars
  const now = performance.now();
  for (let i = 0; i < 4; i++) {
    const gy = ((now / 35 + i * 173) % GAME_H);
    ctx.fillStyle = `rgba(255,60,70,${0.05 + (i % 2) * 0.04})`;
    ctx.fillRect(0, gy, GAME_W, 2 + (i % 3));
  }
  ctx.textAlign = 'center';
  drawPanel(GAME_W / 2 - 260, 90, 520, 180, { stroke: '#ff4455', brackets: 'rgba(255,68,85,0.5)' });
  ctx.fillStyle = '#ff4455'; ctx.font = '900 44px monospace';
  ctx.save(); ctx.shadowColor = 'rgba(255,60,60,0.7)'; ctx.shadowBlur = 22;
  const gl = Math.floor(now / 90) % 7 === 0 ? 2 : 0;
  ctx.fillText('MISSION FAILED', GAME_W / 2 + gl, 160);
  ctx.restore();
  ctx.fillStyle = '#c9d6e6'; ctx.font = '15px monospace';
  ctx.fillText('// ' + (lastStats.reason || 'You were caught.') + ' //', GAME_W / 2, 220);
  drawButton(GAME_W / 2 - 110, 420, 220, 56, '↻ RETRY MISSION', { font: 15 });
  if (hacked && !checkpointUsed) {
    drawButton(GAME_W / 2 - 150, 492, 300, 48, '▶ RETRY FROM CHECKPOINT (AD)', { color: 'rgba(44,26,66,0.95)', stroke: '#b385ff', font: 13 });
  }
  drawButton(GAME_W / 2 - 70, 552, 140, 38, 'MENU', { color: 'rgba(20,26,38,0.95)', stroke: '#5a7088', font: 13 });
  drawScreenFx(0.5);
}

function render() {
  if (state === 'menu') drawMenu();
  else if (state === 'shop') drawShop();
  else if (state === 'briefing') drawBriefing();
  else if (state === 'playing') { drawBackdrop(); drawWorld(); drawScreenFx(0.8); drawHUD(); }
  else if (state === 'complete') drawComplete();
  else if (state === 'failed') drawFailed();
  else { drawBackdrop(); }
  if (adInProgress) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = '#eaf2ff'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center';
    ctx.fillText('ADVERTISEMENT…', GAME_W / 2, GAME_H / 2);
  }
}

// ---------- main loop ----------
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (state !== lastStateName) { lastStateName = state; stateT = 0; briefSkip = false; }
  stateT += dt;
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
