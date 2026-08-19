// Generates src/maps.js with literal ASCII grids (composed from counted segments)
import { writeFileSync } from 'node:fs';
const d = (n) => '.'.repeat(n);
const w = (n) => '#'.repeat(n);

// Mission 1 — BREACH (24x15)
const M1 = [
  w(24),
  '#' + 'S.T' + d(19) + '#',
  '#' + d(22) + '#',
  '#' + d(3) + 'B' + d(6) + ',,,' + d(9) + '#',
  '#' + d(10) + ',,,' + d(9) + '#',
  '#' + d(10) + ',,,' + d(9) + '#',
  '#' + d(22) + '#',
  '#' + d(6) + 'B' + d(15) + '#',
  '#' + w(10) + '.' + w(11) + '#',
  '#' + d(4) + ',,' + d(16) + '#',
  '#' + d(16) + ',,' + d(4) + '#',
  '#' + d(18) + 'X' + d(3) + '#',
  '#' + d(22) + '#',
  '#' + 'EE' + d(20) + '#',
  w(24),
];

// Mission 2 — WAREHOUSE (28x17)
const M2 = [
  w(28),
  '#' + 'S.T' + d(23) + '#',
  '#' + d(26) + '#',
  '#' + d(4) + 'BB' + d(20) + '#',
  '#' + d(26) + '#',
  '#' + w(6) + '.' + w(12) + '.' + w(6) + '#',
  '#' + d(26) + '#',
  '#' + d(6) + ',,,,' + d(16) + '#',
  '#' + d(6) + ',,,,' + d(6) + 'B' + d(9) + '#',
  '#' + d(26) + '#',
  '#' + w(10) + '.' + w(15) + '#',
  '#' + d(26) + '#',
  '#' + d(20) + ',,,' + d(3) + '#',
  '#' + d(10) + 'B' + d(9) + 'X' + d(5) + '#',
  '#' + d(26) + '#',
  '#' + 'EE' + d(24) + '#',
  w(28),
];

// Mission 3 — TWIN PATHS (30x19)
const M3 = [
  w(30),
  '#' + 'S.T' + d(25) + '#',
  '#' + d(28) + '#',
  '#' + w(8) + '.' + w(10) + '.' + w(8) + '#',
  '#' + d(4) + ',,,' + d(21) + '#',
  '#' + d(4) + ',,,' + d(9) + 'B' + d(11) + '#',
  '#' + d(4) + ',,,' + d(21) + '#',
  '#' + d(28) + '#',
  '#' + d(8) + w(12) + d(8) + '#',
  '#' + d(8) + '#' + d(10) + '#' + d(8) + '#',
  '#' + d(8) + '.' + d(4) + 'X' + d(5) + '#' + d(8) + '#',
  '#' + d(8) + '#' + d(10) + '#' + d(8) + '#',
  '#' + d(8) + w(5) + '.' + w(6) + d(8) + '#',
  '#' + d(28) + '#',
  '#' + d(4) + ',,,,' + d(20) + '#',
  '#' + w(12) + '.' + w(15) + '#',
  '#' + d(28) + '#',
  '#' + d(24) + 'EE' + d(2) + '#',
  w(30),
];

// Mission 4 — SERVER FARM (32x21)
const M4 = [
  w(32),
  '#' + 'S.T' + d(27) + '#',
  '#' + d(30) + '#',
  '#' + d(4) + 'B' + d(25) + '#',
  '#' + w(10) + '.' + w(8) + '.' + w(10) + '#',
  '#' + d(30) + '#',
  '#' + d(2) + ',,,,' + d(24) + '#',
  '#' + d(2) + ',,,,' + d(12) + 'B' + d(11) + '#',
  '#' + d(30) + '#',
  '#' + w(6) + '.' + w(16) + '.' + w(6) + '#',
  '#' + d(30) + '#',
  '#' + d(8) + 'B' + d(8) + ',,,' + d(10) + '#',
  '#' + d(14) + 'X' + d(15) + '#',
  '#' + d(30) + '#',
  '#' + w(14) + '.' + w(15) + '#',
  '#' + d(30) + '#',
  '#' + d(4) + ',,,' + d(23) + '#',
  '#' + d(20) + 'B' + d(9) + '#',
  '#' + d(30) + '#',
  '#' + d(26) + 'EE' + d(2) + '#',
  w(32),
];

// Mission 5 — CITADEL (36x23)
const M5 = [
  w(36),
  '#' + 'S.T' + d(31) + '#',
  '#' + d(34) + '#',
  '#' + d(6) + ',,,' + d(25) + '#',
  '#' + w(12) + '.' + w(21) + '#',
  '#' + d(34) + '#',
  '#' + d(4) + 'B' + d(20) + 'B' + d(8) + '#',
  '#' + d(34) + '#',
  '#' + w(24) + '.' + w(9) + '#',
  '#' + d(34) + '#',
  '#' + d(2) + ',,,,' + d(28) + '#',
  '#' + d(2) + ',,,,' + d(10) + 'B' + d(17) + '#',
  '#' + d(34) + '#',
  '#' + d(10) + w(14) + d(10) + '#',
  '#' + d(10) + '#' + d(5) + 'X' + d(6) + '#' + d(10) + '#',
  '#' + d(10) + w(6) + '.' + w(7) + d(10) + '#',
  '#' + d(34) + '#',
  '#' + d(4) + ',,,' + d(27) + '#',
  '#' + w(8) + '.' + w(25) + '#',
  '#' + d(34) + '#',
  '#' + d(15) + 'B' + d(18) + '#',
  '#' + d(30) + 'EE' + d(2) + '#',
  w(36),
];

const missions = [
  {
    name: 'BREACH', grid: M1,
    brief: 'Infiltrate the outpost. Hack the terminal, then reach the evac zone. Stay out of the guard\'s vision cone.',
    guards: [{ wps: [[4, 10], [17, 10]] }],
    par: 60,
  },
  {
    name: 'WAREHOUSE', grid: M2,
    brief: 'Two patrol robots guard the warehouse. Use grass and crates for cover. Tech can hack from 3 tiles away.',
    guards: [{ wps: [[3, 9], [24, 9]] }, { wps: [[4, 14], [23, 14]] }],
    par: 90,
  },
  {
    name: 'TWIN PATHS', grid: M3,
    brief: 'The terminal sits in a guarded vault. Pick a path: grass fields west or open halls east. EMP is your friend.',
    guards: [
      { wps: [[9, 7], [20, 7]] },
      { wps: [[6, 9], [6, 13], [22, 13], [22, 9]] },
      { wps: [[3, 16], [26, 16]] },
    ],
    par: 120,
  },
  {
    name: 'SERVER FARM', grid: M4,
    brief: 'Four sentries sweep the server farm. Silent takedowns leave bodies — hide your tracks or move fast.',
    guards: [
      { wps: [[8, 2], [24, 2]] },
      { wps: [[3, 8], [27, 8]] },
      { wps: [[5, 10], [25, 10], [25, 13], [5, 13]] },
      { wps: [[4, 18], [26, 18]] },
    ],
    par: 150,
  },
  {
    name: 'CITADEL', grid: M5,
    brief: 'The final fortress. Five sentries, one vault, one exit. Ghost it for the ultimate bonus. Good luck, squad.',
    guards: [
      { wps: [[16, 2], [30, 2]] },
      { wps: [[3, 5], [30, 5]] },
      { wps: [[4, 9], [30, 9], [30, 12], [4, 12]] },
      { wps: [[13, 16], [24, 16]] },
      { wps: [[3, 19], [31, 19]] },
    ],
    par: 180,
  },
];

let out = '// Shadow Squad — mission data. ASCII grid legend:\n';
out += '// # wall  . floor  , grass (slow+hidden)  B crate  S scout spawn  T tech spawn  X terminal  E evac\n';
out += 'export const MISSIONS = [\n';
for (const m of missions) {
  out += '  {\n';
  out += `    name: ${JSON.stringify(m.name)},\n`;
  out += `    brief: ${JSON.stringify(m.brief)},\n`;
  out += `    par: ${m.par},\n`;
  out += `    guards: ${JSON.stringify(m.guards)},\n`;
  out += '    grid: [\n';
  for (const row of m.grid) out += `      ${JSON.stringify(row)},\n`;
  out += '    ],\n';
  out += '  },\n';
}
out += '];\n';
writeFileSync('src/maps.js', out);
console.log('maps.js written');
