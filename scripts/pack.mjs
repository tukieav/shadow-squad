// Copies index.html into dist/ so dist is a self-contained CrazyGames bundle
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
copyFileSync('index.html', 'dist/index.html');
console.log('dist/ ready');
