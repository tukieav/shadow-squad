// Validates mission maps: uniform width, required chars, connectivity, walkable guard waypoints
import { MISSIONS } from '../src/maps.js';

let fail = 0;
for (let mi = 0; mi < MISSIONS.length; mi++) {
  const m = MISSIONS[mi];
  const g = m.grid;
  const H = g.length, W = g[0].length;
  const err = (s) => { console.log(`M${mi + 1} ${m.name}: ${s}`); fail++; };
  for (let y = 0; y < H; y++) if (g[y].length !== W) err(`row ${y} width ${g[y].length} != ${W}`);
  const find = (ch) => { const r = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === ch) r.push([x, y]); return r; };
  const S = find('S'), T = find('T'), X = find('X'), E = find('E');
  if (S.length !== 1) err(`S count ${S.length}`);
  if (T.length !== 1) err(`T count ${T.length}`);
  if (X.length !== 1) err(`X count ${X.length}`);
  if (E.length < 1) err('no evac');
  const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && g[y][x] !== '#' && g[y][x] !== 'B';
  const bfs = (sx, sy) => {
    const seen = new Set([sx + ',' + sy]); const q = [[sx, sy]];
    while (q.length) { const [x, y] = q.shift();
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy;
        if (walkable(nx, ny) && !seen.has(nx + ',' + ny)) { seen.add(nx + ',' + ny); q.push([nx, ny]); } } }
    return seen;
  };
  const reach = bfs(S[0][0], S[0][1]);
  if (!reach.has(T[0][0] + ',' + T[0][1])) err('T unreachable from S');
  if (X.length && !reach.has(X[0][0] + ',' + X[0][1])) err('X unreachable from S');
  for (const e of E) if (!reach.has(e[0] + ',' + e[1])) err(`evac ${e} unreachable`);
  m.guards.forEach((gd, gi) => {
    for (const [wx, wy] of gd.wps) {
      if (!walkable(wx, wy)) err(`guard ${gi} waypoint ${wx},${wy} not walkable (char '${g[wy] ? g[wy][wx] : '?'}')`);
      else if (!reach.has(wx + ',' + wy)) err(`guard ${gi} waypoint ${wx},${wy} disconnected`);
    }
  });
  console.log(`M${mi + 1} ${m.name}: ${W}x${H}, guards ${m.guards.length} — checked`);
}
if (fail) { console.log(`FAIL: ${fail} problems`); process.exit(1); }
console.log('ALL MAPS OK');
