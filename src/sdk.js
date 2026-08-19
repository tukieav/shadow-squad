// CrazyGames SDK v3 wrapper — safe no-op fallbacks when SDK unavailable (local dev)
let sdk = null;
let inited = false;

export async function initSDK() {
  try {
    if (window.CrazyGames && window.CrazyGames.SDK) {
      // SDK.init() may hang forever on non-whitelisted domains (sitelock),
      // e.g. GitHub Pages — race it against a timeout so the game always boots.
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('sdk init timeout')), 3000));
      await Promise.race([window.CrazyGames.SDK.init(), timeout]);
      sdk = window.CrazyGames.SDK;
      inited = true;
    }
  } catch (e) {
    console.warn('CrazyGames SDK unavailable (local dev / non-CG domain)', e);
    sdk = null;
    inited = false;
  }
  return inited;
}

export function sdkAvailable() { return inited; }

export function gameplayStart() {
  try { if (sdk) sdk.game.gameplayStart(); } catch (e) {}
}

export function gameplayStop() {
  try { if (sdk) sdk.game.gameplayStop(); } catch (e) {}
}

export function loadingStart() {
  try { if (sdk) sdk.game.loadingStart(); } catch (e) {}
}

export function loadingStop() {
  try { if (sdk) sdk.game.loadingStop(); } catch (e) {}
}

export function happytime() {
  try { if (sdk) sdk.game.happytime(); } catch (e) {}
}

// Returns a promise resolving to true if the ad finished (grant reward), false otherwise.
export function requestAd(type, { onStart, onFinish } = {}) {
  return new Promise((resolve) => {
    if (!sdk) { resolve(type !== 'rewarded'); return; } // local dev: midgame "succeeds", rewarded fails
    const callbacks = {
      adStarted: () => { if (onStart) onStart(); },
      adFinished: () => { if (onFinish) onFinish(); resolve(true); },
      adError: (e) => { if (onFinish) onFinish(); resolve(false); },
    };
    try { sdk.ad.requestAd(type, callbacks); }
    catch (e) { if (onFinish) onFinish(); resolve(false); }
  });
}

export function getMuteSetting() {
  try { return sdk ? !!sdk.game.settings.muteAudio : false; } catch (e) { return false; }
}

export function onSettingsChange(fn) {
  try { if (sdk) sdk.game.addSettingsChangeListener(fn); } catch (e) {}
}

// Persistent data: SDK data module (cross-device) with localStorage fallback
export function loadData(key, fallback) {
  try {
    if (sdk) {
      const v = sdk.data.getItem(key);
      if (v != null) return v;
    }
  } catch (e) {}
  try {
    const v = localStorage.getItem('shadowsquad.' + key);
    if (v != null) return v;
  } catch (e) {}
  return fallback;
}

export function saveData(key, value) {
  try { if (sdk) sdk.data.setItem(key, String(value)); } catch (e) {}
  try { localStorage.setItem('shadowsquad.' + key, String(value)); } catch (e) {}
}
