// Shadow Squad — procedural art layer.
// Builds a pre-rendered static canvas per level (floors, walls, decor, lamp glow)
// so the per-frame cost stays tiny. All placement is deterministic (seeded).

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2654435761) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Region flood fill over walkable tiles; each region gets a floor style.
function buildRegions(level) {
  const { W, H, tiles } = level;
  const region = new Int16Array(W * H).fill(-1);
  let nr = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (tiles[y][x] === '#' || region[y * W + x] !== -1) continue;
    const q = [[x, y]];
    region[y * W + x] = nr;
    while (q.length) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (tiles[ny][nx] === '#' || region[ny * W + nx] !== -1) continue;
        region[ny * W + nx] = nr;
        q.push([nx, ny]);
      }
    }
    nr++;
  }
  return { region, count: nr };
}

// ---------- floor painters ----------
function paintMetal(g, x, y, T, seed) {
  const v = hash2(x >> 1, y >> 1, seed);           // 2x2 plate tint
  const base = 34 + Math.floor(v * 8);
  g.fillStyle = `rgb(${base},${base + 6},${base + 16})`;
  g.fillRect(x * T, y * T, T, T);
  // plate seams on even boundaries
  g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 1;
  if (x % 2 === 0) { g.beginPath(); g.moveTo(x * T + 0.5, y * T); g.lineTo(x * T + 0.5, y * T + T); g.stroke(); }
  if (y % 2 === 0) { g.beginPath(); g.moveTo(x * T, y * T + 0.5); g.lineTo(x * T + T, y * T + 0.5); g.stroke(); }
  // seam highlight
  g.strokeStyle = 'rgba(255,255,255,0.045)';
  if (x % 2 === 0) { g.beginPath(); g.moveTo(x * T + 1.5, y * T); g.lineTo(x * T + 1.5, y * T + T); g.stroke(); }
  // rivets at plate corners
  if (x % 2 === 0 && y % 2 === 0) {
    for (const [rx, ry] of [[4, 4], [2 * T - 4, 4], [4, 2 * T - 4], [2 * T - 4, 2 * T - 4]]) {
      const px = x * T + rx, py = y * T + ry;
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(px + 0.8, py + 0.8, 2, 0, 7); g.fill();
      g.fillStyle = 'rgba(160,180,205,0.5)'; g.beginPath(); g.arc(px, py, 1.6, 0, 7); g.fill();
    }
  }
  // scratches
  const s = hash2(x, y, seed + 5);
  if (s < 0.14) {
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
    const a = s * 40, cx = x * T + T / 2, cy = y * T + T / 2, L = 6 + s * 60;
    g.beginPath(); g.moveTo(cx - Math.cos(a) * L, cy - Math.sin(a) * L); g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.stroke();
  }
}

function paintConcrete(g, x, y, T, seed) {
  const v = hash2(x, y, seed);
  const base = 38 + Math.floor(v * 7);
  g.fillStyle = `rgb(${base},${base + 3},${base + 8})`;
  g.fillRect(x * T, y * T, T, T);
  // mottle
  for (let i = 0; i < 3; i++) {
    const mx = hash2(x * 3 + i, y, seed + 9), my = hash2(x, y * 3 + i, seed + 11);
    g.fillStyle = `rgba(${my > 0.5 ? '255,255,255' : '0,0,0'},0.035)`;
    g.fillRect(x * T + mx * (T - 10), y * T + my * (T - 10), 6 + mx * 8, 5 + my * 7);
  }
  // expansion joints every 3 tiles
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  if (x % 3 === 0) { g.beginPath(); g.moveTo(x * T + 0.5, y * T); g.lineTo(x * T + 0.5, y * T + T); g.stroke(); }
  if (y % 3 === 0) { g.beginPath(); g.moveTo(x * T, y * T + 0.5); g.lineTo(x * T + T, y * T + 0.5); g.stroke(); }
  // crack
  const c = hash2(x, y, seed + 21);
  if (c < 0.07) {
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    let px = x * T + 4, py = y * T + c * 400 % T;
    g.beginPath(); g.moveTo(px, py);
    for (let i = 0; i < 4; i++) { px += 8; py += (hash2(x + i, y, seed + 30) - 0.5) * 14; g.lineTo(px, py); }
    g.stroke();
  }
}

function paintServer(g, x, y, T, seed) {
  const v = hash2(x, y, seed);
  const base = 22 + Math.floor(v * 5);
  g.fillStyle = `rgb(${base - 4},${base + 2},${base + 14})`;
  g.fillRect(x * T, y * T, T, T);
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.strokeRect(x * T + 0.5, y * T + 0.5, T - 1, T - 1);
  // glowing data lines every 4th row/col
  if (y % 4 === 1) {
    g.save(); g.shadowColor = 'rgba(60,220,255,0.8)'; g.shadowBlur = 6;
    g.strokeStyle = 'rgba(60,200,255,0.22)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x * T, y * T + T / 2); g.lineTo(x * T + T, y * T + T / 2); g.stroke();
    g.restore();
  }
  if (x % 4 === 2) {
    g.save(); g.shadowColor = 'rgba(60,220,255,0.8)'; g.shadowBlur = 6;
    g.strokeStyle = 'rgba(60,200,255,0.14)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x * T + T / 2, y * T); g.lineTo(x * T + T / 2, y * T + T); g.stroke();
    g.restore();
  }
  // tiny LED
  const l = hash2(x, y, seed + 40);
  if (l < 0.1) {
    g.fillStyle = l < 0.05 ? 'rgba(60,255,150,0.7)' : 'rgba(60,200,255,0.7)';
    g.fillRect(x * T + 4 + l * 200 % (T - 8), y * T + 5, 2, 2);
  }
}

function paintGrass(g, x, y, T, seed) {
  g.fillStyle = '#13251a'; g.fillRect(x * T, y * T, T, T);
  // soil patches
  g.fillStyle = 'rgba(40,32,20,0.35)';
  const sv = hash2(x, y, seed + 3);
  g.beginPath(); g.ellipse(x * T + T * sv, y * T + T * (1 - sv), 8, 5, 0, 0, 7); g.fill();
  // tufts
  for (let i = 0; i < 7; i++) {
    const tx = x * T + 3 + hash2(x * 7 + i, y, seed) * (T - 6);
    const ty = y * T + 4 + hash2(x, y * 7 + i, seed) * (T - 8);
    const h = 4 + hash2(i, x + y, seed) * 5;
    g.strokeStyle = i % 2 ? 'rgba(48,110,64,0.9)' : 'rgba(72,150,84,0.8)';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(tx, ty + h); g.quadraticCurveTo(tx - 2, ty + h / 2, tx - 3, ty); g.stroke();
    g.beginPath(); g.moveTo(tx, ty + h); g.quadraticCurveTo(tx + 2, ty + h / 2, tx + 3, ty - 1); g.stroke();
    g.beginPath(); g.moveTo(tx, ty + h); g.lineTo(tx, ty - 1); g.stroke();
  }
}

function paintCrate(g, x, y, T) {
  // heavy cargo crate
  g.fillStyle = '#0e131d'; g.fillRect(x * T, y * T, T, T);
  g.fillStyle = '#57492e'; g.fillRect(x * T + 2, y * T + 2, T - 4, T - 4);
  g.fillStyle = '#6b5a3a'; g.fillRect(x * T + 4, y * T + 4, T - 8, T - 8);
  // planks
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1;
  for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(x * T + 4, y * T + 4 + i * (T - 8) / 3); g.lineTo(x * T + T - 4, y * T + 4 + i * (T - 8) / 3); g.stroke(); }
  // metal straps + corner bolts
  g.fillStyle = '#3d4454';
  g.fillRect(x * T + 2, y * T + 8, T - 4, 4); g.fillRect(x * T + 2, y * T + T - 12, T - 4, 4);
  g.fillStyle = '#98a4b8';
  for (const [bx, by] of [[6, 6], [T - 6, 6], [6, T - 6], [T - 6, T - 6]]) { g.beginPath(); g.arc(x * T + bx, y * T + by, 1.7, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.strokeRect(x * T + 2.5, y * T + 2.5, T - 5, T - 5);
}

// ---------- walls ----------
function paintWalls(g, level, T, seed) {
  const { W, H, tiles } = level;
  const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && tiles[y][x] !== '#';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (tiles[y][x] !== '#') continue;
    const px = x * T, py = y * T;
    const v = hash2(x, y, seed + 60);
    const b = 44 + Math.floor(v * 6);
    // top face
    g.fillStyle = `rgb(${b},${b + 8},${b + 22})`;
    g.fillRect(px, py, T, T);
    // subtle panel seam
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
    // south face (visible wall front) when floor below
    if (walk(x, y + 1)) {
      const grd = g.createLinearGradient(0, py + T - 12, 0, py + T);
      grd.addColorStop(0, '#171d2b'); grd.addColorStop(1, '#0b0f18');
      g.fillStyle = grd; g.fillRect(px, py + T - 12, T, 12);
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(px, py + T - 12, T, 1);
    }
    // top edge highlight when floor above
    if (walk(x, y - 1)) { g.fillStyle = 'rgba(190,215,255,0.16)'; g.fillRect(px, py, T, 3); }
    if (walk(x - 1, y)) { g.fillStyle = 'rgba(190,215,255,0.09)'; g.fillRect(px, py, 3, T); }
    if (walk(x + 1, y)) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(px + T - 3, py, 3, T); }
    // hard outline against floor
    g.strokeStyle = 'rgba(2,4,10,0.8)'; g.lineWidth = 1.5;
    g.beginPath();
    if (walk(x, y + 1)) { g.moveTo(px, py + T - 0.5); g.lineTo(px + T, py + T - 0.5); }
    if (walk(x, y - 1)) { g.moveTo(px, py + 0.7); g.lineTo(px + T, py + 0.7); }
    if (walk(x - 1, y)) { g.moveTo(px + 0.7, py); g.lineTo(px + 0.7, py + T); }
    if (walk(x + 1, y)) { g.moveTo(px + T - 0.5, py); g.lineTo(px + T - 0.5, py + T); }
    g.stroke(); g.lineWidth = 1;
  }
  // pipes + vents along long horizontal interior wall runs
  for (let y = 1; y < H - 1; y++) {
    let run = 0;
    for (let x = 0; x <= W; x++) {
      const isW = x < W && tiles[y][x] === '#' && walk(x, y + 1);
      if (isW) run++;
      else {
        if (run >= 5 && hash2(x, y, seed + 70) < 0.75) {
          const sx = (x - run) * T, len = run * T;
          const py = y * T + 10 + hash2(x, y, seed + 71) * 8;
          // pipe with sheen
          g.strokeStyle = '#1d2432'; g.lineWidth = 5;
          g.beginPath(); g.moveTo(sx + 6, py); g.lineTo(sx + len - 6, py); g.stroke();
          g.strokeStyle = 'rgba(140,165,200,0.35)'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(sx + 6, py - 1.4); g.lineTo(sx + len - 6, py - 1.4); g.stroke();
          // brackets
          g.fillStyle = '#3a4457';
          for (let bxp = sx + 14; bxp < sx + len - 10; bxp += T * 2.5) g.fillRect(bxp, py - 4, 3, 8);
          // vent grille mid-run
          if (run >= 7) {
            const vx = sx + len / 2 - 12, vy = y * T + 22;
            g.fillStyle = '#141a26'; g.fillRect(vx, vy, 24, 10);
            g.strokeStyle = 'rgba(150,170,200,0.3)'; g.lineWidth = 1;
            for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(vx + 2, vy + i * 2.5); g.lineTo(vx + 22, vy + i * 2.5); g.stroke(); }
            g.strokeRect(vx + 0.5, vy + 0.5, 23, 9);
          }
        }
        run = 0;
      }
    }
  }
}

// ---------- props / decals ----------
function drawDesk(g, px, py, T, r) {
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px + 3, py + 5, T - 4, T - 8); // shadow
  g.fillStyle = '#3a4150'; g.fillRect(px + 2, py + 3, T - 4, T - 8);
  g.fillStyle = '#485064'; g.fillRect(px + 4, py + 5, T - 8, T - 12);
  // monitor w/ glow
  g.save(); g.shadowColor = 'rgba(90,220,255,0.9)'; g.shadowBlur = 8;
  g.fillStyle = '#0a1420'; g.fillRect(px + 9, py + 8, 15, 10);
  g.fillStyle = r < 0.5 ? 'rgba(90,220,255,0.85)' : 'rgba(120,255,170,0.8)';
  g.fillRect(px + 10, py + 9, 13, 8);
  g.restore();
  g.fillStyle = 'rgba(6,12,20,0.8)';
  g.fillRect(px + 11, py + 10, 8, 1); g.fillRect(px + 11, py + 12, 10, 1); g.fillRect(px + 11, py + 14, 6, 1);
  // keyboard
  g.fillStyle = '#232a38'; g.fillRect(px + 10, py + 21, 14, 5);
}
function drawPlant(g, px, py, T, r) {
  const cx = px + T / 2, cy = py + T / 2 + 4;
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(cx + 2, cy + 5, 8, 4, 0, 0, 7); g.fill();
  g.fillStyle = '#5a4632'; g.beginPath(); g.moveTo(cx - 7, cy); g.lineTo(cx + 7, cy); g.lineTo(cx + 5, cy + 8); g.lineTo(cx - 5, cy + 8); g.closePath(); g.fill();
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + r * 6;
    g.fillStyle = i % 2 ? '#2f7a45' : '#3f9a58';
    g.beginPath(); g.ellipse(cx + Math.cos(a) * 6, cy - 8 + Math.sin(a) * 4, 6, 3, a, 0, 7); g.fill();
  }
  g.fillStyle = '#2a6a3c'; g.beginPath(); g.arc(cx, cy - 9, 4, 0, 7); g.fill();
}
function drawBarrel(g, px, py, T, r) {
  const cx = px + T / 2, cy = py + T / 2;
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(cx + 2, cy + 3, 11, 10, 0, 0, 7); g.fill();
  g.fillStyle = r < 0.5 ? '#7a6820' : '#456078'; g.beginPath(); g.arc(cx, cy, 11, 0, 7); g.fill();
  g.fillStyle = r < 0.5 ? '#93801f' : '#54738f'; g.beginPath(); g.arc(cx, cy, 8.5, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, 11, 0, 7); g.stroke();
  g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.ellipse(cx - 4, cy - 4, 3, 2, -0.7, 0, 7); g.fill();
}
function drawPallet(g, px, py, T) {
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(px + 5, py + 6, T - 8, T - 10);
  g.fillStyle = '#4e3f28';
  for (let i = 0; i < 4; i++) g.fillRect(px + 4, py + 4 + i * 8, T - 8, 5);
  g.fillStyle = '#61503a';
  g.fillRect(px + 4, py + 4, 5, T - 10); g.fillRect(px + T - 9, py + 4, 5, T - 10); g.fillRect(px + T / 2 - 2, py + 4, 5, T - 10);
}
function drawGrate(g, px, py, T) {
  g.fillStyle = '#0d1119'; g.fillRect(px + 6, py + 6, T - 12, T - 12);
  g.strokeStyle = 'rgba(140,160,190,0.28)'; g.lineWidth = 1;
  for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(px + 7, py + 6 + i * (T - 12) / 5); g.lineTo(px + T - 7, py + 6 + i * (T - 12) / 5); g.stroke(); }
  g.strokeStyle = 'rgba(160,180,210,0.4)';
  g.strokeRect(px + 6.5, py + 6.5, T - 13, T - 13);
}
function drawStain(g, px, py, T, r) {
  const cx = px + r * T, cy = py + (1 - r) * T;
  const grd = g.createRadialGradient(cx, cy, 1, cx, cy, 8 + r * 12);
  grd.addColorStop(0, 'rgba(0,0,0,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 8 + r * 12, 0, 7); g.fill();
}
function drawCable(g, px, py, T, r) {
  g.strokeStyle = 'rgba(10,14,22,0.85)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(px, py + T * r);
  g.bezierCurveTo(px + T * 0.3, py + T * (1 - r), px + T * 0.7, py + T * r * 0.5, px + T, py + T * (0.3 + r * 0.4));
  g.stroke();
  g.strokeStyle = 'rgba(90,110,150,0.2)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(px, py + T * r - 1);
  g.bezierCurveTo(px + T * 0.3, py + T * (1 - r) - 1, px + T * 0.7, py + T * r * 0.5 - 1, px + T, py + T * (0.3 + r * 0.4) - 1);
  g.stroke();
}

// hazard stripe border around evac tiles + floor paint
function paintEvacPad(g, level, T) {
  for (const e of level.evac) {
    const px = e.x * T, py = e.y * T;
    g.save();
    g.beginPath(); g.rect(px + 1, py + 1, T - 2, T - 2); g.clip();
    g.fillStyle = '#15251c'; g.fillRect(px, py, T, T);
    // diagonal hazard stripes on border ring
    g.beginPath(); g.rect(px + 1, py + 1, T - 2, T - 2);
    g.rect(px + 7, py + 7, T - 14, T - 14);
    g.clip('evenodd');
    for (let i = -T; i < T * 2; i += 10) {
      g.fillStyle = (i / 10 % 2 + 2) % 2 < 1 ? 'rgba(255,205,60,0.75)' : 'rgba(12,14,10,0.9)';
      g.beginPath();
      g.moveTo(px + i, py); g.lineTo(px + i + 6, py); g.lineTo(px + i + 6 - T, py + T); g.lineTo(px + i - T, py + T);
      g.closePath(); g.fill();
    }
    g.restore();
  }
}

// ---------- lamp placement ----------
function placeLamps(level, T, seed) {
  const lamps = [];
  const { W, H, tiles } = level;
  const open = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && (tiles[y][x] === '.' || tiles[y][x] === ',');
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!open(x, y)) continue;
      // sparse deterministic grid with jitter
      if ((x + Math.floor(hash2(0, y, seed) * 3)) % 6 !== 2 || (y + Math.floor(hash2(x, 0, seed) * 2)) % 4 !== 1) continue;
      if (!open(x - 1, y) || !open(x + 1, y)) continue;
      lamps.push({ x: (x + 0.5) * T, y: (y + 0.5) * T, warm: hash2(x, y, seed + 88) < 0.7 });
    }
  }
  return lamps;
}

// ---------- main builder ----------
export function buildLevelArt(level, missionIdx, T) {
  const { W, H, tiles } = level;
  const cv = document.createElement('canvas');
  cv.width = W * T; cv.height = H * T;
  const g = cv.getContext('2d');
  const seed = missionIdx * 7919 + W * 31 + H * 17;
  const { region } = buildRegions(level);
  const styleOf = (r) => Math.floor(hash2(r * 13 + 7, missionIdx, seed + 1) * 3); // 0 metal 1 concrete 2 server

  // floors
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = tiles[y][x];
    if (c === '#') continue;
    const st = styleOf(region[y * W + x]);
    if (st === 0) paintMetal(g, x, y, T, seed);
    else if (st === 1) paintConcrete(g, x, y, T, seed);
    else paintServer(g, x, y, T, seed);
  }
  // grass overlay
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (tiles[y][x] === ',') paintGrass(g, x, y, T, seed);
  }

  // avoid decorating important tiles
  const reserved = new Set();
  const mark = (x, y, r = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) reserved.add((y + dy) * W + (x + dx)); };
  if (level.scout) mark(level.scout.x, level.scout.y);
  if (level.tech) mark(level.tech.x, level.tech.y);
  for (const t of level.terms) mark(t.x, t.y);
  for (const e of level.evac) mark(e.x, e.y);

  // decals (anywhere on plain floor)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (tiles[y][x] !== '.') continue;
    const r = hash2(x, y, seed + 100);
    if (r < 0.025) drawGrate(g, x * T, y * T, T);
    else if (r < 0.06) drawStain(g, x * T, y * T, T, hash2(x, y, seed + 101));
    else if (r < 0.075) drawCable(g, x * T, y * T, T, hash2(x, y, seed + 102));
  }
  // props hug walls
  const nearWall = (x, y) => tiles[y - 1][x] === '#' || tiles[y + 1][x] === '#' || tiles[y][x - 1] === '#' || tiles[y][x + 1] === '#';
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (tiles[y][x] !== '.' || reserved.has(y * W + x) || !nearWall(x, y)) continue;
    const r = hash2(x, y, seed + 200);
    if (r < 0.05) drawDesk(g, x * T, y * T, T, hash2(x, y, seed + 201));
    else if (r < 0.075) drawPlant(g, x * T, y * T, T, hash2(x, y, seed + 202));
    else if (r < 0.105) drawBarrel(g, x * T, y * T, T, hash2(x, y, seed + 203));
    else if (r < 0.125) drawPallet(g, x * T, y * T, T);
  }

  // crates
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (tiles[y][x] === 'B') paintCrate(g, x, y, T);
  }

  paintEvacPad(g, level, T);
  paintWalls(g, level, T, seed);

  // lamps: fixture + warm light pool baked in
  const lamps = placeLamps(level, T, seed);
  for (const l of lamps) {
    const col = l.warm ? '255,238,190' : '190,225,255';
    const grd = g.createRadialGradient(l.x, l.y, 4, l.x, l.y, 3.1 * T);
    grd.addColorStop(0, `rgba(${col},0.14)`);
    grd.addColorStop(0.5, `rgba(${col},0.06)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(l.x, l.y, 3.1 * T, 0, 7); g.fill();
    // round ceiling fixture
    g.fillStyle = 'rgba(16,22,32,0.85)';
    g.beginPath(); g.arc(l.x, l.y, 7, 0, 7); g.fill();
    g.strokeStyle = 'rgba(130,150,180,0.35)';
    g.beginPath(); g.arc(l.x, l.y, 7, 0, 7); g.stroke();
    g.save(); g.shadowColor = `rgba(${col},1)`; g.shadowBlur = 9;
    g.fillStyle = `rgba(${col},0.9)`;
    g.beginPath(); g.arc(l.x, l.y, 3.2, 0, 7); g.fill();
    g.restore();
  }
  return { canvas: cv, lamps };
}

// ---------- shared overlays (screen space) ----------
let scanCv = null, vignCv = null;
export function getScanlines(W, H) {
  if (!scanCv) {
    scanCv = document.createElement('canvas'); scanCv.width = W; scanCv.height = H;
    const g = scanCv.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  }
  return scanCv;
}
export function getVignette(W, H) {
  if (!vignCv) {
    vignCv = document.createElement('canvas'); vignCv.width = W; vignCv.height = H;
    const g = vignCv.getContext('2d');
    const grd = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,10,0.55)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }
  return vignCv;
}
