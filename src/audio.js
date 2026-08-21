// Shadow Squad — procedural audio via WebAudio (no audio files)
let ctx = null;
let masterGain = null;
let muted = false;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 0.5;
}

export function unlockAudio() { ensureCtx(); }

export function pauseAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function tone(freq, dur, type, vol, delay = 0, slideTo = null) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo != null ? slideTo : freq * 0.5), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function noise(dur, vol, delay = 0) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(g); g.connect(masterGain);
  src.start(t0);
}

// Silent takedown: soft thud + electric zap fizzle
export function takedownSound() {
  ensureCtx();
  tone(90, 0.12, 'sine', 0.3);
  noise(0.18, 0.12, 0.03);
  tone(1400, 0.15, 'sawtooth', 0.05, 0.05, 200);
}

// Alarm: rising two-tone siren burst
export function alarmSound() {
  ensureCtx();
  tone(520, 0.25, 'square', 0.14, 0, 780);
  tone(780, 0.25, 'square', 0.14, 0.25, 520);
  tone(520, 0.25, 'square', 0.12, 0.5, 780);
}

// Footstep: tiny soft tick
export function stepSound(grass) {
  ensureCtx();
  if (grass) noise(0.05, 0.03);
  else tone(200 + Math.random() * 40, 0.04, 'sine', 0.05);
}

// Move-order ping
export function pingSound() {
  ensureCtx();
  tone(880, 0.08, 'sine', 0.1);
  tone(1320, 0.06, 'sine', 0.06, 0.04);
}

// Agent switch
export function switchSound() {
  ensureCtx();
  tone(660, 0.07, 'triangle', 0.12);
  tone(990, 0.09, 'triangle', 0.1, 0.05);
}

// EMP blast: descending electric whomp
export function empSound() {
  ensureCtx();
  tone(1200, 0.4, 'sawtooth', 0.18, 0, 80);
  noise(0.3, 0.15, 0.02);
  tone(60, 0.35, 'sine', 0.25, 0.05);
}

// Hacking tick
export function hackTick() {
  ensureCtx();
  tone(1100 + Math.random() * 500, 0.05, 'square', 0.05);
}

// Terminal hacked
export function hackDoneSound() {
  ensureCtx();
  [660, 880, 1320].forEach((f, i) => tone(f, 0.15, 'triangle', 0.18, i * 0.09));
}

// Mission success fanfare
export function successSound() {
  ensureCtx();
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, 'triangle', 0.2, i * 0.11));
}

// Mission failed
export function failSound() {
  ensureCtx();
  [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, 'sawtooth', 0.15, i * 0.15));
}

// Detection warning tick (guard spotting you)
export function detectTick() {
  ensureCtx();
  tone(980, 0.07, 'square', 0.07);
}

// Sync-lost / denied buzz
export function failTick() {
  ensureCtx();
  tone(220, 0.18, 'sawtooth', 0.12, 0, 110);
  tone(160, 0.2, 'square', 0.08, 0.08);
}

// Background music: slow ambient pad loop (procedural, starts on first unlock)
let musicTimer = null;
export function startMusic() {
  ensureCtx();
  if (musicTimer) return;
  const bass = [55, 65.4, 49, 58.3];
  let step = 0;
  const bar = () => {
    if (muted || !ctx) return;
    const t0 = ctx.currentTime;
    const root = bass[step % bass.length];
    tone(root, 3.6, 'sine', 0.05, 0, root);
    tone(root * 2, 3.6, 'triangle', 0.02, 0, root * 2);
    if (step % 2 === 1) tone(root * 3, 1.6, 'sine', 0.015, 1.8, root * 3);
    step++;
  };
  bar();
  musicTimer = setInterval(bar, 3800);
}
