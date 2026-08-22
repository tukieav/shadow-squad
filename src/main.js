// Shadow Squad — real-time tactics stealth (Commandos-like) for CrazyGames
// No blood: enemies are robot sentries that deactivate with sparks.
import { MISSIONS } from './maps.js';
import * as SDK from './sdk.js';
import * as AUDIO from './audio.js';
import * as ART from './art.js';

const TILE = 40;
const VW = 960, VH = 600;      // virtual UI space (menus/dialogs) — scaled to fit any window
let GAME_W = 960, GAME_H = 600, DPR = 1;   // real canvas size = full window
const DETECT_TIME = 0.8;       // base seconds in cone before alarm (early missions are more forgiving)
const ALARM_COOLDOWN = 10;     // seconds without contact -> back to patrol
const EMP_RADIUS = 3 * TILE;
const EMP_STUN = 5;
const HACK_TIME = 3.0;
const CATCH_DIST = 0.55 * TILE;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Full-window canvas: the game fills 100% of the viewport (desktop-first).
// Wide screens see MORE of the mission map; UI screens scale via a virtual 960x600 space.
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  GAME_W = Math.max(1, window.innerWidth);
  GAME_H = Math.max(1, window.innerHeight);
  canvas.width = Math.round(GAME_W * DPR);
  canvas.height = Math.round(GAME_H * DPR);
  canvas.style.width = GAME_W + 'px';
  canvas.style.height = GAME_H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (level) clampCam();
}
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();
// Some mobile browsers finalize the meta-viewport after the script executes.
window.addEventListener('load', resize, { once: true });
requestAnimationFrame(resize);
setTimeout(resize, 120);

// virtual UI space helpers (menus / dialogs designed at 960x600, scaled to fit)
function uiOffset() {
  const s = Math.min(GAME_W / VW, GAME_H / VH);
  return { s, ox: (GAME_W - VW * s) / 2, oy: (GAME_H - VH * s) / 2 };
}
function beginUI() { const o = uiOffset(); ctx.save(); ctx.translate(o.ox, o.oy); ctx.scale(o.s, o.s); }
function endUI() { ctx.restore(); }
function toUI(sx, sy) { const o = uiOffset(); return { x: (sx - o.ox) / o.s, y: (sy - o.oy) / o.s }; }

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
let graceUsed = false;        // one free "close call" per mission in early ops
let startFromCheckpoint = false;
let cam = { x: 0, y: 0 };
let camFollow = true;
let shake = 0;
let adInProgress = false;
let lastStats = null;
let menuScroll = 0;
let rmbDrag = null;
let hoverGuard = -1;
let paused = false;
let pauseReason = '';
let userMuted = false;
let reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let tutorialStage = 0;
let onboardingSeen = false;
let onboardingActive = false;
let lastSafeCheckpoint = null;
let safeCheckpointT = 0;

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
  // v2 retains the old individual-key save format while bounding malformed values.
  const number = (key, fallback = 0, max = 999999) => Math.max(0, Math.min(max, parseInt(SDK.loadData(key, String(fallback)), 10) || fallback));
  intel = number('intel');
  try { stars = JSON.parse(SDK.loadData('stars', '{}')) || {}; } catch (e) { stars = {}; }
  upgrades.emp = number('up.emp', 0, 1);
  upgrades.hack = number('up.hack', 0, 1);
  upgrades.sprint = number('up.sprint', 0, 1);
  skin = SDK.loadData('skin', 'default');
  if (!SKINS[skin]) skin = 'default';
  try { ownedSkins = JSON.parse(SDK.loadData('skins', '{"default":true}')) || { default: true }; } catch (e) { ownedSkins = { default: true }; }
  ownedSkins.default = true;
  streak = number('streak', 0, 3650);
  userMuted = SDK.loadData('mute', '0') === '1';
  onboardingSeen = SDK.loadData('onboarding.seen', '0') === '1';
  SDK.saveData('meta.version', '2');
}
function saveMeta() {
  SDK.saveData('intel', intel);
  SDK.saveData('stars', JSON.stringify(stars));
  SDK.saveData('up.emp', upgrades.emp);
  SDK.saveData('up.hack', upgrades.hack);
  SDK.saveData('up.sprint', upgrades.sprint);
  SDK.saveData('skin', skin);
  SDK.saveData('skins', JSON.stringify(ownedSkins));
  SDK.saveData('mute', userMuted ? '1' : '0');
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
  graceUsed = false;
  empCharges = 2 + bonusEmp + upgrades.emp;
  hackProgress = hacked ? hackTimeFor() : 0;
  if (!opts.keepCheckpointUse) checkpointUsed = false;
  levelArt = ART.buildLevelArt(level, mi, TILE);
  camFollow = true;
  cam.x = agents[0].x - GAME_W / 2; cam.y = agents[0].y - GAME_H / 2;
  clampCam();
  state = 'playing';
  // The control card is a first-run aid, never a repeatable mission wall.
  tutorialStage = 4;
  onboardingActive = mi === 0 && !onboardingSeen;
  safeCheckpointT = 0;
  lastSafeCheckpoint = makeCheckpoint();
  if (opts.checkpoint) {
    restoreCheckpoint(opts.checkpoint);
    // Keep the in-memory safe point aligned with the restored world, too.
    lastSafeCheckpoint = makeCheckpoint();
  }
  SDK.gameplayStart();
}

function makeCheckpoint() {
  if (!level || !agents.length) return null;
  return {
    agents: agents.map(a => ({ x: a.x, y: a.y, facing: a.facing })),
    terminals: terminals.map(t => ({ progress: t.progress, done: t.done, doneAt: t.doneAt })),
    guards: guards.map(g => ({
      x: g.x, y: g.y, wpi: g.wpi, facing: g.facing, detect: g.detect, stun: g.stun,
      alive: g.alive, state: g.state, target: g.target && { ...g.target }, repath: g.repath,
      path: g.path.map(node => ({ ...node })), seenBodies: [...g.seenBodies],
    })),
    cameras: cameras.map(c => ({ facing: c.facing, detect: c.detect, stun: c.stun })),
    bodies: bodies.map(b => ({ ...b })),
    hacked, missionTime, empCharges, graceUsed, tutorialStage, activeAgent, takedowns, alarmsRaised,
  };
}

function restoreCheckpoint(snapshot) {
  if (!snapshot) return;
  snapshot.agents.forEach((saved, i) => {
    const a = agents[i];
    if (!a) return;
    a.x = saved.x; a.y = saved.y; a.facing = saved.facing; a.path = []; a.takedownTarget = -1;
  });
  terminals.forEach((t, i) => Object.assign(t, snapshot.terminals[i] || {}));
  hacked = snapshot.hacked;
  missionTime = snapshot.missionTime;
  empCharges = snapshot.empCharges;
  graceUsed = snapshot.graceUsed;
  tutorialStage = snapshot.tutorialStage;
  activeAgent = Math.max(0, Math.min(agents.length - 1, snapshot.activeAgent ?? activeAgent));
  takedowns = snapshot.takedowns ?? takedowns;
  alarmsRaised = snapshot.alarmsRaised ?? alarmsRaised;
  bodies = (snapshot.bodies || []).map(b => ({ ...b }));
  snapshot.guards?.forEach((saved, i) => {
    const g = guards[i];
    if (!g) return;
    g.x = saved.x; g.y = saved.y; g.wpi = saved.wpi; g.facing = saved.facing;
    g.detect = saved.detect; g.stun = saved.stun; g.alive = saved.alive; g.state = saved.state;
    g.target = saved.target && { ...saved.target }; g.repath = saved.repath;
    g.path = (saved.path || []).map(node => ({ ...node }));
    g.seenBodies = new Set(saved.seenBodies || []);
  });
  snapshot.cameras?.forEach((saved, i) => {
    const c = cameras[i];
    if (c) { c.facing = saved.facing; c.detect = saved.detect; c.stun = saved.stun; }
  });
  floats.push({ x: agents[activeAgent].x, y: agents[activeAgent].y - 30, t: 1.8, kind: 'text', text: 'LAST SAFE POSITION RESTORED', color: '#8dffc0' });
}
function hackTimeFor() { return HACK_TIME * (1 - upgrades.hack * 0.35); }
// dynamic difficulty: missions 1-2 use narrower vision cones
function fovFor() { return missionIdx <= 1 ? 0.5 : 0.62; }
// gentler onboarding: early missions give much more time to react before an alarm
function detectTimeFor() { return missionIdx === 0 ? 1.6 : missionIdx === 1 ? 1.15 : DETECT_TIME; }

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
};
function empBtnRect() { return { x: GAME_W - 92, y: GAME_H - 92, w: 78, h: 78 }; }
function muteBtnRect() { return { x: GAME_W - 64, y: 14, w: 50, h: 44 }; }
function mobileDeployRect() { return { x: 18, y: GAME_H - 74, w: Math.max(44, GAME_W - 36), h: 52 }; }
function onboardingPanelRect() {
  const w = Math.min(380, GAME_W - 28), h = 184;
  return { x: (GAME_W - w) / 2, y: Math.max(96, (GAME_H - h) / 2 - 14), w, h };
}
function onboardingSkipRect() {
  const r = onboardingPanelRect();
  return { x: r.x + r.w / 2 - 68, y: r.y + r.h - 42, w: 136, h: 30 };
}
function finishOnboarding() {
  if (!onboardingActive) return;
  onboardingActive = false;
  onboardingSeen = true;
  SDK.saveData('onboarding.seen', '1');
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function hudLayout() {
  const compact = GAME_W < 620;
  const mute = muteBtnRect();
  const mission = compact
    ? { x: UI.portraits[1].x + UI.portraits[1].w + 8, y: 10, w: Math.max(54, mute.x - (UI.portraits[1].x + UI.portraits[1].w) - 16), h: 46 }
    : { x: GAME_W / 2 - 135, y: 10, w: 270, h: 46 };
  const cue = compact
    ? { x: 12, y: UI.portraits[0].y + UI.portraits[0].h + 14, w: GAME_W - 24, h: 31 }
    : { x: GAME_W / 2 - 174, y: 66, w: 348, h: 31 };
  return { compact, mission, cue, mute };
}
function sidePanelRect() {
  if (GAME_W < 1180 || state !== 'playing') return null;
  return { x: GAME_W - 264, y: 76, w: 248, h: Math.min(430, GAME_H - 260) };
}

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
  if (particles.length >= 360) return;
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
  if (state !== 'playing') {
    if (state === 'menu' && GAME_W <= 500) {
      const mb = mobileDeployRect();
      if (sx >= mb.x && sx <= mb.x + mb.w && sy >= mb.y && sy <= mb.y + mb.h) {
        missionIdx = Math.min(unlocked, MISSIONS.length) - 1; bonusEmp = 0; startMission(missionIdx); return;
      }
    }
    const u = toUI(sx, sy);
    if (state === 'menu') return menuTap(u.x, u.y);
    if (state === 'shop') return shopTap(u.x, u.y);
    if (state === 'briefing') return briefingTap(u.x, u.y);
    if (state === 'complete') return completeTap(u.x, u.y);
    if (state === 'failed') return failedTap(u.x, u.y);
    return;
  }

  if (onboardingActive) {
    const skip = onboardingSkipRect();
    if (sx >= skip.x && sx <= skip.x + skip.w && sy >= skip.y && sy <= skip.y + skip.h) {
      finishOnboarding();
      return;
    }
    // The first real command dismisses the card and still reaches the game.
    finishOnboarding();
  }

  // HUD portraits
  for (let i = 0; i < 2; i++) {
    const p = UI.portraits[i];
    if (sx >= p.x && sx <= p.x + p.w && sy >= p.y && sy <= p.y + p.h) {
      if (activeAgent !== i) { activeAgent = i; camFollow = true; AUDIO.switchSound(); }
      return;
    }
  }
  // EMP button
  const b = empBtnRect();
  if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) { tryEmp(); return; }
  const mb = muteBtnRect();
  if (sx >= mb.x && sx <= mb.x + mb.w && sy >= mb.y && sy <= mb.y + mb.h) {
    userMuted = !userMuted; AUDIO.setMuted(userMuted || SDK.getMuteSetting()); saveMeta(); return;
  }
  // side intel panel (wide screens) is not a move order
  const sp = sidePanelRect();
  if (sp && sx >= sp.x && sx <= sp.x + sp.w && sy >= sp.y && sy <= sp.y + sp.h) return;

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
  // Physical key codes make 1/2, E and arrows layout-independent (AZERTY included).
  if (state === 'playing' && onboardingActive && (e.code === 'Escape' || e.code === 'Backspace')) {
    e.preventDefault();
    finishOnboarding();
    return;
  }
  if (state !== 'playing') return;
  if (onboardingActive) finishOnboarding();
  if (e.code === 'Digit1') { e.preventDefault(); if (activeAgent !== 0) { activeAgent = 0; camFollow = true; AUDIO.switchSound(); } }
  if (e.code === 'Digit2') { e.preventDefault(); if (activeAgent !== 1) { activeAgent = 1; camFollow = true; AUDIO.switchSound(); } }
  if (e.code === 'KeyE') { e.preventDefault(); tryEmp(); }
  const dirs = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  };
  if (dirs[e.code]) {
    e.preventDefault();
    const a = agents[activeAgent], [dx, dy] = dirs[e.code];
    orderMove(a, a.x + dx * TILE, a.y + dy * TILE);
  }
});

// touch: tap = move / all taps route through handleTap; double-tap portrait handled by same switch logic
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  AUDIO.unlockAudio();
  const t = e.changedTouches[0];
  const { sx, sy, wx, wy } = screenToWorld(t);
  handleTap(sx, sy, wx, wy);
}, { passive: false });

function setPaused(next, reason = '') {
  if (paused === next) return;
  paused = next; pauseReason = next ? reason : '';
  if (next) { AUDIO.pauseAudio(); SDK.gameplayStop(); }
  else {
    lastT = performance.now(); accumulator = 0;
    AUDIO.resumeAudio();
    if (state === 'playing' && !adInProgress) SDK.gameplayStart();
  }
}
window.addEventListener('blur', () => setPaused(true, 'focus'));
window.addEventListener('focus', () => { if (!document.hidden && !adInProgress) setPaused(false); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true, 'hidden');
  else if (!adInProgress) setPaused(false);
});
if (window.matchMedia) window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => { reducedMotion = e.matches; });

// ---------- screens tap handlers ----------
const menuButtons = [];
function menuTap(sx, sy) {
  const GAME_W = VW, GAME_H = VH;
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
  const GAME_W = VW, GAME_H = VH;
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
      onStart: () => { setPaused(true, 'ad'); AUDIO.setMuted(true); },
      onFinish: () => { AUDIO.setMuted(userMuted || SDK.getMuteSetting()); setPaused(false); },
    }).then((ok) => {
      adInProgress = false;
      if (ok) { bonusEmp = 1; floats.push({ x: 0, y: 0, t: 0, kind: 'none' }); }
    });
  }
}
function completeTap(sx, sy) {
  const GAME_W = VW, GAME_H = VH;
  // rewarded: x2 intel (only when intel was gained)
  if (lastStats && lastStats.intelGain > 0 && !lastStats.doubled && sx >= GAME_W / 2 - 130 && sx <= GAME_W / 2 + 130 && sy >= 530 && sy <= 572) {
    adInProgress = true;
    SDK.requestAd('rewarded', {
      onStart: () => { setPaused(true, 'ad'); AUDIO.setMuted(true); },
      onFinish: () => { AUDIO.setMuted(userMuted || SDK.getMuteSetting()); setPaused(false); },
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
      onStart: () => { setPaused(true, 'ad'); AUDIO.setMuted(true); },
      onFinish: () => { AUDIO.setMuted(userMuted || SDK.getMuteSetting()); setPaused(false); },
    }).then(() => {
      adInProgress = false;
      bonusEmp = 0;
      if (next < MISSIONS.length) { missionIdx = next; state = 'briefing'; }
      else state = 'menu';
    });
  }
}
function shopTap(sx, sy) {
  const GAME_W = VW, GAME_H = VH;
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
  const GAME_W = VW, GAME_H = VH;
  // RETRY
  if (sx >= GAME_W / 2 - 110 && sx <= GAME_W / 2 + 110 && sy >= 420 && sy <= 476) {
    adInProgress = true;
    SDK.requestAd('midgame', {
      onStart: () => { setPaused(true, 'ad'); AUDIO.setMuted(true); },
      onFinish: () => { AUDIO.setMuted(userMuted || SDK.getMuteSetting()); setPaused(false); },
    }).then(() => {
      adInProgress = false;
      startMission(missionIdx);
    });
    return;
  }
  // One free tactical reset per mission: retain the latest calm position/progress.
  if (lastSafeCheckpoint && !checkpointUsed && sx >= GAME_W / 2 - 150 && sx <= GAME_W / 2 + 150 && sy >= 492 && sy <= 540) {
    checkpointUsed = true;
    startMission(missionIdx, { checkpoint: lastSafeCheckpoint, keepCheckpointUse: true });
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
  let seenAgent = null;
  for (const a of agents) {
    if (agentHidden(a, g)) continue;
    if (guardSees(g, a.x, a.y)) {
      seenAgent = a;
      break;
    }
  }
  if (seenAgent) {
    // A sentry has one awareness meter. Seeing the whole squad is not a
    // hidden multiplier on the published detection window.
    g.detect += dt;
    if (alarm < 1) alarm = 1;
    if (Math.random() < dt * 6) AUDIO.detectTick();
    if (g.detect >= detectTimeFor()) raiseAlarm(seenAgent.x, seenAgent.y);
    if (alarm === 2) { g.state = 'chase'; g.target = { x: seenAgent.x, y: seenAgent.y }; }
  } else g.detect = Math.max(0, g.detect - dt * 1.2);

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
    // catch agent — first catch in early missions is a CLOSE CALL, not instant fail
    for (const a of agents) {
      if (Math.hypot(a.x - g.x, a.y - g.y) < CATCH_DIST) {
        if (missionIdx <= 1 && !graceUsed) {
          graceUsed = true;
          g.stun = 3.5; g.detect = 0;
          alarm = 0; alarmTimer = 0;
          for (const gg of guards) if (gg.state === 'chase') { gg.state = 'return'; gg.path = []; gg.detect = 0; }
          for (let i = 0; i < 14; i++) spawnSpark(g.x, g.y, '#7df');
          floats.push({ x: a.x, y: a.y - 26, t: 2.2, kind: 'text', text: 'CLOSE CALL — SLIP AWAY!', color: '#ffd545' });
          AUDIO.empSound();
          return;
        }
        missionFail('Agent captured by a sentry!');
        return;
      }
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
        if (c.detect >= detectTimeFor()) raiseAlarm(a.x, a.y);
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

  // A calm, non-moving moment is a safe reset point. Keep snapshots bounded to one.
  safeCheckpointT += dt;
  if (alarm === 0 && safeCheckpointT >= 1.5 && !agents.some(a => a.moving)) {
    lastSafeCheckpoint = makeCheckpoint();
    safeCheckpointT = 0;
  }

  // particles etc.
  particles = particles.filter(p => (p.t -= dt) > 0);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
  rings = rings.filter(r => r.a > 0);
  for (const r of rings) { if (r.delay > 0) { r.delay -= dt; continue; } r.r += 220 * dt; r.a -= dt * 1.1; }
  footprints = footprints.filter(f => (f.t -= dt) > 0);
  floats = floats.filter(f => (f.t -= dt) > 0);
  if (particles.length > 360) particles.length = 360;
  if (rings.length > 48) rings.splice(0, rings.length - 48);
  if (footprints.length > 120) footprints.splice(0, footprints.length - 120);
  if (floats.length > 80) floats.splice(0, floats.length - 80);
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
  if (levelArt) ctx.drawImage(levelArt.canvas, -cam.x - (levelArt.pad || 0), -cam.y - (levelArt.pad || 0));
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
      const p = Math.min(1, g.detect / detectTimeFor());
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
      const p = Math.min(1, c.detect / detectTimeFor());
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
  if (!lightCv || lightCv.width !== Math.ceil(GAME_W) || lightCv.height !== Math.ceil(GAME_H)) {
    lightCv = document.createElement('canvas');
    lightCv.width = Math.ceil(GAME_W); lightCv.height = Math.ceil(GAME_H);
    lightG = lightCv.getContext('2d');
  }
  const lg = lightG;
  lg.globalCompositeOperation = 'source-over';
  lg.clearRect(0, 0, GAME_W, GAME_H);
  // lighter noir: readable scene, mood without murk (CrazyGames feedback: too dark)
  lg.fillStyle = alarm === 2 ? 'rgba(18,3,8,0.36)' : 'rgba(3,6,15,0.38)';
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
  const layout = hudLayout();
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
  // Keep command portraits unobstructed on narrow touch screens.
  const mr = layout.mission;
  drawPanel(mr.x, mr.y, mr.w, mr.h, { brackets: 'rgba(53,224,255,0.35)' });
  ctx.fillStyle = PAL.cyan; ctx.font = `bold ${layout.compact ? 10 : 13}px monospace`; ctx.textAlign = 'center';
  ctx.fillText(layout.compact ? `OP ${String(missionIdx + 1).padStart(2, '0')} · ${level.mission.name}` : `OP ${String(missionIdx + 1).padStart(2, '0')} // ${level.mission.name}`, mr.x + mr.w / 2, 27);
  ctx.fillStyle = PAL.amber; ctx.font = `bold ${layout.compact ? 10 : 12}px monospace`;
  const mm = Math.floor(missionTime / 60), ss = (missionTime % 60).toFixed(1).padStart(4, '0');
  ctx.fillText(`T+${mm}:${ss}`, layout.compact ? mr.x + mr.w * 0.3 : GAME_W / 2 - 42, 46);
  // threat readout
  const thrCol = alarm === 2 ? '#ff4455' : alarm === 1 ? '#ffcc44' : '#57e08a';
  ctx.fillStyle = thrCol; ctx.font = `bold ${layout.compact ? 9 : 10}px monospace`; ctx.textAlign = layout.compact ? 'center' : 'left';
  ctx.fillText(alarm === 2 ? '▮▮▮ ALARM' : alarm === 1 ? '▮▮▯ WARY' : '▮▯▯ CALM', layout.compact ? mr.x + mr.w * 0.74 : GAME_W / 2 + 8, 46);
  if (alarm === 2 && Math.floor(now / 220) % 2) {
    ctx.strokeStyle = '#ff4455'; ctx.lineWidth = 2;
    roundRect(mr.x - 2, mr.y - 2, mr.w + 4, mr.h + 4, 5); ctx.stroke(); ctx.lineWidth = 1;
  }
  // 50px visual mute target; it also respects the CrazyGames settings mute.
  const mb = muteBtnRect();
  drawPanel(mb.x, mb.y, mb.w, mb.h, { stroke: userMuted || SDK.getMuteSetting() ? '#66788c' : PAL.cyan });
  ctx.fillStyle = userMuted || SDK.getMuteSetting() ? '#7b8798' : '#bdeeff'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(userMuted || SDK.getMuteSetting() ? '🔇' : '🔊', mb.x + mb.w / 2, mb.y + 29);
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
  const b = empBtnRect();
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
  ctx.fillText('[E]', bx, by + 24);
  drawSidePanel();
}

function drawOnboarding() {
  if (!onboardingActive) return;
  const r = onboardingPanelRect();
  ctx.fillStyle = 'rgba(2,7,14,0.58)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  drawPanel(r.x, r.y, r.w, r.h, { fill: 'rgba(7,17,29,0.97)', stroke: PAL.cyan, brackets: 'rgba(53,224,255,0.8)' });
  ctx.fillStyle = PAL.cyan; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('FIELD CONTROLS', r.x + r.w / 2, r.y + 22);
  // Visual command card: pointer + physical WASD cluster and compact action keys.
  const my = r.y + 62, mx = r.x + r.w * 0.16;
  ctx.save(); ctx.shadowColor = 'rgba(53,224,255,0.75)'; ctx.shadowBlur = 10;
  ctx.strokeStyle = PAL.cyan; ctx.lineWidth = 2;
  roundRect(mx - 16, my - 12, 32, 24, 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mx - 4, my - 6); ctx.lineTo(mx + 7, my); ctx.lineTo(mx + 1, my + 2); ctx.lineTo(mx + 5, my + 9); ctx.lineTo(mx + 1, my + 11); ctx.lineTo(mx - 4, my + 4); ctx.lineTo(mx - 9, my + 8); ctx.closePath(); ctx.fillStyle = '#d9f8ff'; ctx.fill();
  ctx.restore();
  const keycap = (x, y, label, col = PAL.cyan) => {
    drawPanel(x - 14, y - 12, 28, 24, { fill: 'rgba(13,31,46,0.95)', stroke: col });
    ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.fillText(label, x, y + 4);
  };
  const kx = r.x + r.w * 0.41;
  keycap(kx, my - 14, 'W'); keycap(kx - 16, my + 13, 'A'); keycap(kx + 16, my + 13, 'D'); keycap(kx, my + 13, 'S');
  keycap(r.x + r.w * 0.67, my, '1'); keycap(r.x + r.w * 0.76, my, '2'); keycap(r.x + r.w * 0.85, my, 'E', PAL.amber);
  ctx.fillStyle = '#c9f5ff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('CLICK / TAP OR WASD / ZQSD: COMMAND', r.x + r.w * 0.34, r.y + 112);
  ctx.fillText('1 / 2: AGENTS  ·  E: EMP', r.x + r.w * 0.73, r.y + 112);
  const skip = onboardingSkipRect();
  drawButton(skip.x, skip.y, skip.w, skip.h, 'SKIP', { color: 'rgba(20,31,45,0.96)', stroke: '#6f8fa9', font: 12 });
  ctx.fillStyle = '#6f8fa9'; ctx.font = '10px monospace'; ctx.fillText('BACKSPACE / ESC', r.x + r.w / 2, r.y + r.h - 8);
}

// wide-screen tactical side panel: mission brief + live objectives, blended into the scene
function drawSidePanel() {
  const sp = sidePanelRect();
  if (!sp) return;
  const now = performance.now();
  const m = level.mission;
  drawPanel(sp.x, sp.y, sp.w, sp.h, { fill: 'rgba(7,12,20,0.78)', brackets: 'rgba(53,224,255,0.30)' });
  let y = sp.y + 26;
  ctx.textAlign = 'left';
  ctx.fillStyle = PAL.cyan; ctx.font = 'bold 12px monospace';
  const blink = Math.floor(now / 600) % 2 ? '▸' : '▹';
  ctx.fillText(`${blink} TACTICAL UPLINK`, sp.x + 14, y); y += 8;
  ctx.strokeStyle = 'rgba(53,224,255,0.25)';
  ctx.beginPath(); ctx.moveTo(sp.x + 12, y); ctx.lineTo(sp.x + sp.w - 12, y); ctx.stroke(); y += 20;
  // mission brief, word-wrapped
  ctx.fillStyle = '#8fb2c8'; ctx.font = '11px monospace';
  const words = m.brief.split(' ');
  let line = '';
  for (const w of words) {
    if (ctx.measureText(line + w).width > sp.w - 28) { ctx.fillText(line, sp.x + 14, y); y += 15; line = ''; }
    line += w + ' ';
  }
  ctx.fillText(line, sp.x + 14, y); y += 26;
  // objectives checklist
  ctx.fillStyle = PAL.amber; ctx.font = 'bold 11px monospace';
  ctx.fillText('OBJECTIVES', sp.x + 14, y); y += 17;
  ctx.font = '11px monospace';
  for (const t of terminals) {
    ctx.fillStyle = t.done ? '#57e08a' : '#c9d6e6';
    ctx.fillText(`${t.done ? '☑' : '☐'} HACK TERMINAL [${t.x},${t.y}]`, sp.x + 14, y); y += 16;
  }
  ctx.fillStyle = hacked ? '#c9d6e6' : '#4d586c';
  ctx.fillText(`${state === 'complete' ? '☑' : '☐'} BOTH AGENTS → EVAC`, sp.x + 14, y); y += 24;
  // live squad readout
  ctx.fillStyle = PAL.amber; ctx.font = 'bold 11px monospace';
  ctx.fillText('SQUAD', sp.x + 14, y); y += 17;
  for (let i = 0; i < 2; i++) {
    const a = agents[i];
    const col = agentColor(a.kind);
    ctx.fillStyle = col; ctx.font = 'bold 11px monospace';
    ctx.fillText(`● ${a.kind.toUpperCase()}`, sp.x + 14, y);
    ctx.fillStyle = '#66788c'; ctx.font = '10px monospace';
    ctx.fillText(a.hacking ? 'HACKING…' : a.moving ? 'MOVING' : 'HOLDING', sp.x + 92, y);
    y += 16;
  }
  y += 8;
  // threat board
  ctx.fillStyle = PAL.amber; ctx.font = 'bold 11px monospace';
  ctx.fillText('THREATS', sp.x + 14, y); y += 17;
  const aliveG = guards.filter(g => g.alive).length;
  ctx.fillStyle = '#c9d6e6'; ctx.font = '11px monospace';
  ctx.fillText(`SENTRIES ACTIVE  ${aliveG}/${guards.length}`, sp.x + 14, y); y += 16;
  if (cameras.length) { ctx.fillText(`CAMERAS  ${cameras.length}`, sp.x + 14, y); y += 16; }
  ctx.fillText(`EMP CHARGES  ${empCharges}`, sp.x + 14, y); y += 16;
  const thrCol = alarm === 2 ? '#ff4455' : alarm === 1 ? '#ffcc44' : '#57e08a';
  ctx.fillStyle = thrCol; ctx.font = 'bold 11px monospace';
  ctx.fillText(alarm === 2 ? 'STATUS: ALARM' : alarm === 1 ? 'STATUS: WARY' : 'STATUS: CALM', sp.x + 14, y); y += 20;
  // par tracker
  if (y < sp.y + sp.h - 14) {
    ctx.fillStyle = missionTime <= m.par ? '#57e08a' : '#66788c'; ctx.font = '10px monospace';
    ctx.fillText(`PAR ${m.par}s · T+${missionTime.toFixed(0)}s ${missionTime <= m.par ? '(★ PACE)' : ''}`, sp.x + 14, y);
  }
}

function drawWorld() {
  ctx.save();
  if (shake > 0 && !reducedMotion) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
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
  drawIntentOverlay();
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

// Planning cues are deliberately quiet: only the selected agent's route and the
// next sentry segment are shown, so the facility remains readable rather than noisy.
function drawIntentOverlay() {
  const a = agents[activeAgent];
  if (!a) return;
  if (a.path.length) {
    ctx.save();
    ctx.strokeStyle = agentColor(a.kind); ctx.globalAlpha = 0.58; ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]); ctx.beginPath(); ctx.moveTo(a.x - cam.x, a.y - cam.y);
    for (const node of a.path.slice(0, 14)) ctx.lineTo((node.x + 0.5) * TILE - cam.x, (node.y + 0.5) * TILE - cam.y);
    ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }
  ctx.save(); ctx.globalAlpha = 0.34; ctx.strokeStyle = '#ffbd58'; ctx.fillStyle = '#ffcf78'; ctx.lineWidth = 1.4;
  for (const g of guards) {
    if (!g.alive || g.state === 'chase') continue;
    const wp = g.wps[g.wpi];
    const x1 = g.x - cam.x, y1 = g.y - cam.y, x2 = (wp[0] + 0.5) * TILE - cam.x, y2 = (wp[1] + 0.5) * TILE - cam.y;
    ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(ang - 0.5) * 7, y2 - Math.sin(ang - 0.5) * 7); ctx.lineTo(x2 - Math.cos(ang + 0.5) * 7, y2 - Math.sin(ang + 0.5) * 7); ctx.closePath(); ctx.fill();
  }
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
  ctx.globalAlpha = (reducedMotion ? 0.18 : 0.5) * strength;
  ctx.drawImage(ART.getScanlines(GAME_W, GAME_H), 0, 0);
  ctx.globalAlpha = strength;
  ctx.drawImage(ART.getVignette(GAME_W, GAME_H), 0, 0);
  ctx.globalAlpha = 1;
}

function drawMenu() {
  const now = performance.now();
  drawBackdrop();
  beginUI();
  const GAME_W = VW, GAME_H = VH;
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
  // Keep the first screen focused on deployment; contextual field cues teach in play.
  drawPanel(GAME_W / 2 - 300, 446, 600, 48, {});
  ctx.fillStyle = '#9ccfe5'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText('CLICK / TAP TO COMMAND  ·  1 / 2 SWITCH AGENTS  ·  WASD / ZQSD OR ARROWS NUDGE  ·  [E] EMP', GAME_W / 2, 468);
  ctx.fillStyle = '#667f95'; ctx.font = '11px monospace';
  ctx.fillText('DEPLOY NOW — THE FIRST OP TEACHES COVER, SWITCHING, AND REMOTE HACKING IN PLAY.', GAME_W / 2, 486);
  // daily bonus toast
  if (dailyToastT > 0) {
    ctx.globalAlpha = Math.min(1, dailyToastT);
    drawPanel(GAME_W / 2 - 160, 560, 320, 34, { stroke: '#57e08a', brackets: 'rgba(87,224,138,0.6)' });
    ctx.fillStyle = '#8dffc0'; ctx.font = 'bold 13px monospace';
    ctx.fillText(`DAILY LOGIN — DAY ${streak}: +${dailyBonus} INTEL`, GAME_W / 2, 582);
    ctx.globalAlpha = 1;
  }
  endUI();
  if (canvas.clientWidth <= 500) {
    const mb = mobileDeployRect();
    drawButton(mb.x, mb.y, mb.w, mb.h, `▶ DEPLOY: OP ${String(qm).padStart(2, '0')}`, { font: 16 });
  }
  drawScreenFx(0.6);
}

function drawShop() {
  drawBackdrop();
  beginUI();
  const GAME_W = VW, GAME_H = VH;
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
  endUI();
  drawScreenFx(0.6);
}

function drawBriefing() {
  drawBackdrop();
  beginUI();
  const GAME_W = VW, GAME_H = VH;
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
  endUI();
  drawScreenFx(0.6);
}

function drawComplete() {
  drawWorld();
  ctx.fillStyle = 'rgba(3,8,14,0.85)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  beginUI();
  {
  const GAME_W = VW, GAME_H = VH;
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
  }
  endUI();
  drawScreenFx(0.5);
}

function drawFailed() {
  drawWorld();
  // softened defeat: cool blue-grey wash instead of harsh red blackout
  ctx.fillStyle = 'rgba(6,10,20,0.78)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  beginUI();
  {
  const GAME_W = VW, GAME_H = VH;
  const now = performance.now();
  ctx.textAlign = 'center';
  drawPanel(GAME_W / 2 - 260, 90, 520, 190, { stroke: '#ffb545', brackets: 'rgba(255,181,69,0.45)' });
  ctx.fillStyle = PAL.amber; ctx.font = '900 40px monospace';
  ctx.save(); ctx.shadowColor = 'rgba(255,181,69,0.55)'; ctx.shadowBlur = 18;
  ctx.fillText('SQUAD SPOTTED', GAME_W / 2, 152);
  ctx.restore();
  ctx.fillStyle = '#c9d6e6'; ctx.font = '15px monospace';
  ctx.fillText('// ' + (lastStats.reason || 'You were caught.') + ' //', GAME_W / 2, 196);
  // encouraging tactical tip instead of a punishing game-over vibe
  const tips = [
    'TIP: guards see less in tall grass — crawl through it',
    'TIP: EMP [E] stuns every sentry nearby for 5 seconds',
    'TIP: takedowns from BEHIND are silent — watch the cone',
    'TIP: the TECH hacks terminals from 3 tiles away',
    'TIP: break line of sight and alarms cool down in 10s',
  ];
  ctx.fillStyle = '#7fb8d8'; ctx.font = '13px monospace';
  ctx.fillText(tips[missionIdx % tips.length], GAME_W / 2, 240);
  drawButton(GAME_W / 2 - 110, 420, 220, 56, '↻ TRY AGAIN', { font: 15 });
  if (lastSafeCheckpoint && !checkpointUsed) {
    drawButton(GAME_W / 2 - 150, 492, 300, 48, '↺ RESET TO LAST SAFE POSITION', { color: 'rgba(16,55,43,0.95)', stroke: '#57e08a', font: 13 });
  }
  drawButton(GAME_W / 2 - 70, 552, 140, 38, 'MENU', { color: 'rgba(20,26,38,0.95)', stroke: '#5a7088', font: 13 });
  }
  endUI();
  drawScreenFx(0.4);
}

function render() {
  if (state === 'menu') drawMenu();
  else if (state === 'shop') drawShop();
  else if (state === 'briefing') drawBriefing();
  else if (state === 'playing') { drawBackdrop(); drawWorld(); drawScreenFx(0.8); drawHUD(); drawOnboarding(); }
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
let accumulator = 0;
const FIXED_STEP = 1 / 120;
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (state !== lastStateName) { lastStateName = state; stateT = 0; briefSkip = false; }
  if (!paused) {
    accumulator = Math.min(accumulator + dt, FIXED_STEP * 12);
    while (accumulator >= FIXED_STEP) {
      stateT += FIXED_STEP;
      update(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
  }
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
  AUDIO.setMuted(userMuted || SDK.getMuteSetting());
  SDK.onSettingsChange((s) => { if (s && typeof s.muteAudio === 'boolean') AUDIO.setMuted(userMuted || s.muteAudio); });
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
    clickScreen: (sx, sy) => {
      // menu/dialog coords are given in the virtual 960x600 UI space
      if (state !== 'playing') { const o = uiOffset(); return handleTap(o.ox + sx * o.s, o.oy + sy * o.s, 0, 0); }
      return handleTap(sx, sy, sx + cam.x, sy + cam.y);
    },
    getViewport: () => ({ w: GAME_W, h: GAME_H, dpr: DPR, canvasW: canvas.width, canvasH: canvas.height, artPad: levelArt ? levelArt.pad : 0, sidePanel: !!sidePanelRect() }),
    getHudLayout: () => {
      const h = hudLayout();
      return { ...h, portraits: UI.portraits.map(p => ({ ...p })), portraitOverlap: UI.portraits.some(p => rectsOverlap(p, h.mission) || rectsOverlap(p, h.cue)) };
    },
    tryEmp: () => tryEmp(),
    simulateAtHz: (hz, seconds = 12) => {
      startMission(0);
      let carry = 0;
      for (let i = 0; i < Math.round(hz * seconds); i++) {
        carry += 1 / hz;
        while (carry + 1e-10 >= FIXED_STEP) { update(FIXED_STEP); carry -= FIXED_STEP; }
      }
      return { missionTime, guard: guards.map(g => ({ x: g.x, y: g.y, facing: g.facing, wpi: g.wpi })), alarm, hacked };
    },
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
        guards: guards.map(g => ({ x: g.x / TILE, y: g.y / TILE, facing: g.facing, detect: g.detect, alerted: g.state === 'chase', alive: g.alive, stun: g.stun, elite: !!g.elite })),
        terminals: terminals.map(t => ({ x: t.x, y: t.y, done: t.done, progress: t.progress })),
        cameras: cameras.map(c => ({ x: c.x / TILE, y: c.y / TILE, facing: c.facing, stun: c.stun })),
        intel, stars: { ...stars }, upgrades: { ...upgrades }, skin, ownedSkins: { ...ownedSkins }, streak,
        tutorialStage, onboardingActive, checkpointUsed, paused, counts: { particles: particles.length, rings: rings.length, footprints: footprints.length, floats: floats.length, guards: guards.length, cameras: cameras.length },
        missionCount: MISSIONS.length,
      };
    },
  };
}
