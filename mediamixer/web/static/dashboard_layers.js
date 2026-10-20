// ---- Layers built on top of the core dashboard_*.js files ----
// Loaded right after them as a plain (non-module) script, so it shares
// their globals both ways - the core files call into the
// hooks here (globalSpeedMult, maybeFxReward, finaleActive...) and this
// file reads its state (tileElements, audioCtx, TUNING...) directly.
// Split out only to keep each file a size you can still navigate; the
// sections below follow the same conventions as everything in there.
//
//   Global speed multiplier - shared by Rhythm Mode and Finale
//   Session stats           - this-visit counters for the recap card
//   Audio-reactive          - one analyser fed by overlay + tile audio
//   Mantra text             - phrases that drift/flash/pulse over the screen
//   Visual FX rewards       - prism/bloom/duotone/light leak/zoom/RGB/VHS/shockwave tile moments
//   Catch-streak milestones - "one more" + the payoff when you land it
//   Rhythm Mode             - beat walker, tempo waves, tap-along
//   Fresh Drop              - rationed debuts for newly added clips
//   Finale + recap          - one-shot build -> peak -> climax -> afterglow

function loadJsonPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return Object.assign({}, fallback, JSON.parse(raw));
  } catch (e) {}
  return Object.assign({}, fallback);
}

function saveJsonPref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function setToggleBadge(id, on) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.innerText = on ? 'ON' : 'OFF';
  btn.classList.toggle('active', on);
}

// ---- Global speed multiplier ----
// Rhythm Mode's tempo waves and Finale's speed arc both scale every
// tile's natural (server-driven) speed at once. render() multiplies this
// into naturalSpeed, but render only runs when an SSE push arrives - this
// tick re-applies it in between, the same independence the speed
// controller's own 100ms tick has. Tiles with a registered speed effect
// are skipped: the controller owns them until their effect expires.
let tileNaturalBase = []; // per-tile s.speed * lock * manual, written by render()

function globalSpeedMult() {
  return finaleSpeedMult() * rhythmSpeedMult();
}

setInterval(() => {
  const mult = globalSpeedMult();
  tileElements.forEach((tile, i) => {
    const effects = tileSpeedEffects[i];
    if (effects && effects.size) return;
    const base = tileNaturalBase[i];
    const vid = getTileVideo(i);
    if (!vid || !base) return;
    const target = base * mult;
    if (Math.abs(vid.playbackRate - target) > 0.01) vid.playbackRate = target;
  });
}, 200);

// ---- Session stats ----
// Counts for this visit only (page load to now) - the lifetime versions
// live in mm_stats. Feeds the recap card at the end of a Finale, or any
// time from the Progress section.
const sessionStats = { hearts: 0, jackpots: 0, catches: 0, bestChain: 0, bonuses: 0, freshDrops: 0, rhythmBest: 0 };
let sessionXpStart = 0;
let sessionPrestigeStart = 0;

// ---- Audio-reactive ----
// One analysis bus that whatever you can actually hear feeds into: the
// overlay track always, plus every tile's own audio whenever Tile Audio
// is above 0%. Each source is tapped *after* its own volume gain, so the
// visuals follow what's audible rather than raw file levels - and the
// bus only ever feeds an analyser, never the speakers, so this tap can't
// change what you hear. The binaural tone and SFX deliberately aren't on
// it: one is a steady drone that would flatten every reading, and the
// other would make effects trigger off their own sounds.
let audioReactEnabled = true;
let audioReactivity = 60; // 0-100
let reactBus = null;
let reactAnalyser = null;
let reactTimeBuf = null;
let overlaySourceNode = null;
let overlayGainNode = null;
let tileAudioGainNode = null;
const tileSourceNodes = new Map(); // <video> -> MediaElementAudioSourceNode
let audioLevel = 0; // fast follower, 0-1
let audioLevelSlow = 0; // ~1s average, the baseline onsets are measured against
let lastOnsetAt = 0;
const audioOnsetListeners = [];

function onAudioOnset(fn) { audioOnsetListeners.push(fn); }

function ensureReactBus() {
  if (!audioCtx) return null;
  if (!reactBus) {
    reactBus = audioCtx.createGain();
    reactAnalyser = audioCtx.createAnalyser();
    reactAnalyser.fftSize = 1024;
    reactAnalyser.smoothingTimeConstant = 0.5;
    reactBus.connect(reactAnalyser);
    // A silent path to the destination keeps the analyser pulled by the
    // audio graph in every browser, without it ever being audible.
    const sink = audioCtx.createGain();
    sink.gain.value = 0;
    reactAnalyser.connect(sink);
    sink.connect(audioCtx.destination);
    reactTimeBuf = new Float32Array(reactAnalyser.fftSize);
  }
  return reactBus;
}

function hookOverlayAudio() {
  if (!audioCtx || !overlayEl || overlaySourceNode) return;
  try {
    overlaySourceNode = audioCtx.createMediaElementSource(overlayEl);
  } catch (e) { return; }
  overlayGainNode = audioCtx.createGain();
  overlaySourceNode.connect(overlayGainNode);
  overlayGainNode.connect(audioCtx.destination);
  overlayGainNode.connect(ensureReactBus());
  applyVolumes();
}

// Only once Tile Audio is actually turned up - at 0% every tile is muted
// anyway, so there'd be nothing to analyse, and leaving tiles unrouted
// keeps the default setup exactly as it always was. A routed element
// stays routed (createMediaElementSource is once-per-element), with its
// level from the shared gain node from then on.
function hookTileAudio(vid) {
  if (!audioCtx || !vid || tileSourceNodes.has(vid) || tileAudioVolume <= 0) return;
  if (!tileAudioGainNode) {
    tileAudioGainNode = audioCtx.createGain();
    tileAudioGainNode.gain.value = tileAudioVolume;
    tileAudioGainNode.connect(audioCtx.destination);
    tileAudioGainNode.connect(ensureReactBus());
  }
  try {
    const src = audioCtx.createMediaElementSource(vid);
    src.connect(tileAudioGainNode);
    tileSourceNodes.set(vid, src);
    vid.volume = 1;
  } catch (e) {}
}

function hookAllTileAudio() {
  tileElements.forEach((tile, i) => hookTileAudio(getTileVideo(i)));
}

let reactLastFrameAt = 0;
let audioGlowLastOpacity = -1;
let audioGlowKick = 0; // a decaying extra push on top of the level - Rhythm Mode's downbeats

function audioReactFrame(ts) {
  requestAnimationFrame(audioReactFrame);
  if (ts - reactLastFrameAt < 33) return; // ~30fps is plenty for a glow and onset detection
  reactLastFrameAt = ts;
  if (reactAnalyser) analyseAudioFrame(ts);
  updateAudioGlow();
}
requestAnimationFrame(audioReactFrame);

function analyseAudioFrame(ts) {
  reactAnalyser.getFloatTimeDomainData(reactTimeBuf);
  let sum = 0;
  for (let i = 0; i < reactTimeBuf.length; i++) sum += reactTimeBuf[i] * reactTimeBuf[i];
  const rms = Math.sqrt(sum / reactTimeBuf.length);
  const level = Math.min(1, rms * 5); // spoken/music tracks mostly sit around 0.03-0.2 rms
  audioLevel = audioLevel * 0.6 + level * 0.4;
  audioLevelSlow = audioLevelSlow * 0.97 + level * 0.03;
  // Onset: a jump well clear of the recent baseline, not just loudness -
  // a constantly loud track shouldn't fire constantly.
  if (level > 0.06 && level > audioLevelSlow * 1.45 + 0.03 && ts - lastOnsetAt > 180) {
    lastOnsetAt = ts;
    const strength = Math.min(1, (level - audioLevelSlow) * 3);
    audioOnsetListeners.forEach((fn) => { try { fn(strength, ts); } catch (e) {} });
  }
}

// A soft edge glow in the current theme color that breathes with the
// level - opacity only, on its own fixed element.
function updateAudioGlow() {
  const el = document.getElementById('audio-glow');
  if (!el) return;
  audioGlowKick *= 0.86;
  const levelGlow = audioReactEnabled ? Math.min(0.85, audioLevel * (audioReactivity / 100) * 1.1) : 0;
  const target = Math.max(levelGlow, audioGlowKick);
  if (Math.abs(target - audioGlowLastOpacity) < 0.02) return;
  audioGlowLastOpacity = target;
  el.style.opacity = target.toFixed(2);
}

// A quick theme-colored flash on one tile's glow ring. Skips any tile
// whose ring is mid-animation for something else (an ambient breathe or
// a disco pulse) - a CSS animation would win over this inline opacity
// anyway, so there's nothing to gain by fighting it.
function reactPulseTile(idx, strength) {
  const el = tileGlowEls[idx];
  if (!el || el.classList.contains('ambient-breath') || el.classList.contains('disco-pulse')) return;
  el.style.transition = 'opacity .08s ease-out';
  el.style.opacity = Math.min(0.85, 0.2 + strength * 0.6).toFixed(2);
  clearTimeout(el._reactFadeTimer);
  el._reactFadeTimer = setTimeout(() => {
    el.style.transition = 'opacity .45s ease-out';
    el.style.opacity = '0';
    setTimeout(() => { if (el.style.opacity === '0') el.style.transition = ''; }, 460);
  }, 110);
}

let lastReactPulseAt = 0;
onAudioOnset((strength, now) => {
  if (!audioReactEnabled || anticipationActive || !tileGlowEls.length) return;
  const reactivity = audioReactivity / 100;
  if (now - lastReactPulseAt < TUNING.AUDIO_REACT_PULSE_GAP_MS * (1.6 - reactivity)) return;
  if (strength < 0.3 * (1.2 - reactivity)) return;
  lastReactPulseAt = now;
  reactPulseTile(pickAmbientTarget(chaseFlashTileIndex), strength * (0.5 + reactivity * 0.5));
});

function loadAudioReactPrefs() {
  const prefs = loadJsonPref('mm_audio_react', { enabled: true, reactivity: 60 });
  audioReactEnabled = !!prefs.enabled;
  audioReactivity = Number(prefs.reactivity) || 0;
  setToggleBadge('audio-react-toggle', audioReactEnabled);
  const input = document.getElementById('audio-react-input');
  if (input) input.value = audioReactivity;
  const lbl = document.getElementById('l-audio-react');
  if (lbl) lbl.innerText = audioReactivity + '%';
}

function saveAudioReactPrefs() {
  saveJsonPref('mm_audio_react', { enabled: audioReactEnabled, reactivity: audioReactivity });
}

function toggleAudioReact() {
  audioReactEnabled = !audioReactEnabled;
  setToggleBadge('audio-react-toggle', audioReactEnabled);
  saveAudioReactPrefs();
}

function setAudioReactivity(v) {
  audioReactivity = parseInt(v, 10) || 0;
  const lbl = document.getElementById('l-audio-react');
  if (lbl) lbl.innerText = audioReactivity + '%';
  saveAudioReactPrefs();
}

function updateAudioReactStatus() {
  const meter = document.getElementById('audio-react-meter-fill');
  if (meter) meter.style.width = Math.round(audioLevel * 100) + '%';
  const el = document.getElementById('audio-react-status');
  if (!el) return;
  if (!audioCtx || !overlaySourceNode) { el.innerText = 'Waiting for audio - tap anywhere on the page to enable it.'; return; }
  const routedTiles = tileElements.filter((t, i) => tileSourceNodes.has(getTileVideo(i))).length;
  const parts = ['overlay track'];
  if (tileAudioVolume > 0 && routedTiles) parts.push('tile audio (' + routedTiles + ' tile' + (routedTiles === 1 ? '' : 's') + ')');
  el.innerText = 'Listening to: ' + parts.join(' + ') + (tileAudioVolume > 0 ? '' : ' - turn Tile Audio up to add the tiles too.');
}
setInterval(updateAudioReactStatus, 150);

// ---- Mantra text ----
// Short phrases from your own list that surface over everything (above
// the spiral, below the controls). Four looks: "drift" floats up and
// fades somewhere on screen, "flash" is a brief centered word, "beat"
// pops on a strong audio onset or a Rhythm Mode downbeat, and "trance"
// is a slow centered breathe used while a spiral is up. Frequency rises
// with whatever else is building (spiral, Surge, Auto-Pilot's climax,
// Finale) so the text tracks the session's intensity.
const MANTRA_DEFAULT_PHRASES = [
  'Deeper', 'Keep watching', 'Let go', 'Sink in', 'Good', 'Just watch', "Don't look away",
  'Relax', 'More', 'Focus', 'Breathe', 'Give in', 'Drift', 'Mmm',
];
const MANTRA_GAP_MS = [[25000, 45000], [9000, 20000], [3500, 8000]]; // low / medium / high
const MANTRA_FREQ_LABELS = ['Low', 'Medium', 'High'];
const MANTRA_MAX_ON_SCREEN = 8;
let mantraEnabled = true;
let mantraFrequency = 1;
let mantraOpacity = 70;
let mantraStyles = { drift: true, flash: true, beat: true };
let mantraPhrases = MANTRA_DEFAULT_PHRASES.slice();
let mantraNextAt = 0;
let lastMantraBeatAt = 0;
let lastMantraPhrase = '';

function mantraIntensity() {
  let k = 1;
  if (spiralActive) k *= 2.2;
  if (isSurgeActive()) k *= 1.3;
  if (rhythmActive()) k *= 1.2;
  k *= 1 + autopilotAmbientBoost * 0.8;
  k *= finaleMantraMult();
  if (Date.now() < spinMantraRushUntil) k *= 2.5;
  return k;
}

function scheduleNextMantra() {
  const [lo, hi] = MANTRA_GAP_MS[mantraFrequency] || MANTRA_GAP_MS[1];
  mantraNextAt = Date.now() + (lo + Math.random() * (hi - lo)) / mantraIntensity();
}

function pickMantraPhrase() {
  if (!mantraPhrases.length) return '';
  if (mantraPhrases.length === 1) return mantraPhrases[0];
  let pick = lastMantraPhrase;
  for (let i = 0; i < 6 && pick === lastMantraPhrase; i++) pick = mantraPhrases[Math.floor(Math.random() * mantraPhrases.length)];
  lastMantraPhrase = pick;
  return pick;
}

function showMantra(style, text) {
  const layer = document.getElementById('mantra-layer');
  if (!layer) return;
  text = text || pickMantraPhrase();
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'mantra mantra-' + style;
  el.textContent = text;
  const hue = COLOR_RUSH_HUES[Math.floor(Math.random() * COLOR_RUSH_HUES.length)];
  el.style.setProperty('--mantra-hue', hue);
  el.style.setProperty('--mantra-opacity', (mantraOpacity / 100).toFixed(2));
  let sizeVw, x, y, durS;
  if (style === 'flash') { sizeVw = 7 + Math.random() * 4; x = 40 + Math.random() * 20; y = 40 + Math.random() * 20; durS = 1.1; }
  else if (style === 'beat') { sizeVw = 4 + Math.random() * 3; x = 15 + Math.random() * 70; y = 20 + Math.random() * 60; durS = 0.9; }
  else if (style === 'trance') { sizeVw = 6 + Math.random() * 3; x = 50; y = 50; durS = 5.5; }
  else { sizeVw = 3 + Math.random() * 3; x = 12 + Math.random() * 76; y = 18 + Math.random() * 62; durS = 4 + Math.random() * 2.5; }
  el.style.fontSize = sizeVw.toFixed(1) + 'vw';
  el.style.left = x.toFixed(1) + '%';
  el.style.top = y.toFixed(1) + '%';
  el.style.animationDuration = durS + 's';
  el.addEventListener('animationend', () => el.remove());
  layer.appendChild(el);
  while (layer.children.length > MANTRA_MAX_ON_SCREEN) layer.firstChild.remove();
}

function mantraBurst(count) {
  if (!mantraEnabled) return;
  for (let i = 0; i < count; i++) {
    setTimeout(() => showMantra(Math.random() < 0.5 ? 'drift' : 'beat'), i * 380);
  }
}

function maybeMantraOnBeat(strength) {
  if (!mantraEnabled || !mantraStyles.beat || document.hidden) return;
  const now = Date.now();
  if (now - lastMantraBeatAt < 2600 / mantraIntensity()) return;
  if (strength < 0.55) return;
  lastMantraBeatAt = now;
  showMantra('beat');
}

setInterval(() => {
  if (!mantraEnabled || document.hidden) return;
  if (!mantraNextAt) { scheduleNextMantra(); return; }
  if (Date.now() < mantraNextAt) return;
  scheduleNextMantra();
  if (spiralActive && Math.random() < 0.6) { showMantra('trance'); return; }
  const styles = ['drift', 'flash'].filter((s) => mantraStyles[s]);
  if (!styles.length) return;
  showMantra(styles[Math.floor(Math.random() * styles.length)]);
}, 500);

onAudioOnset((strength) => maybeMantraOnBeat(strength * (0.6 + audioReactivity / 250)));

function loadMantraPrefs() {
  const prefs = loadJsonPref('mm_mantra', { enabled: true, frequency: 1, opacity: 70, styles: mantraStyles, phrases: MANTRA_DEFAULT_PHRASES });
  mantraEnabled = !!prefs.enabled;
  mantraFrequency = Math.max(0, Math.min(2, Number(prefs.frequency) || 0));
  mantraOpacity = Number(prefs.opacity) || 70;
  mantraStyles = Object.assign({ drift: true, flash: true, beat: true }, prefs.styles);
  mantraPhrases = Array.isArray(prefs.phrases) ? prefs.phrases.filter((p) => typeof p === 'string' && p.trim()) : MANTRA_DEFAULT_PHRASES.slice();
  updateMantraUi();
}

function saveMantraPrefs() {
  saveJsonPref('mm_mantra', { enabled: mantraEnabled, frequency: mantraFrequency, opacity: mantraOpacity, styles: mantraStyles, phrases: mantraPhrases });
}

function updateMantraUi() {
  setToggleBadge('mantra-toggle', mantraEnabled);
  MANTRA_FREQ_LABELS.forEach((_, i) => {
    const b = document.getElementById('mantra-freq-' + i);
    if (b) b.classList.toggle('active', i === mantraFrequency);
  });
  ['drift', 'flash', 'beat'].forEach((s) => {
    const b = document.getElementById('mantra-style-' + s);
    if (b) b.classList.toggle('active', !!mantraStyles[s]);
  });
  const op = document.getElementById('mantra-opacity-input');
  if (op) op.value = mantraOpacity;
  const opLbl = document.getElementById('l-mantra-opacity');
  if (opLbl) opLbl.innerText = mantraOpacity + '%';
  const ta = document.getElementById('mantra-phrases-input');
  if (ta && document.activeElement !== ta) ta.value = mantraPhrases.join('\n');
}

function toggleMantra() { mantraEnabled = !mantraEnabled; saveMantraPrefs(); updateMantraUi(); }
function setMantraFrequency(i) { mantraFrequency = i; mantraNextAt = 0; saveMantraPrefs(); updateMantraUi(); }
function toggleMantraStyle(s) { mantraStyles[s] = !mantraStyles[s]; saveMantraPrefs(); updateMantraUi(); }
function setMantraOpacity(v) { mantraOpacity = parseInt(v, 10) || 0; saveMantraPrefs(); updateMantraUi(); }

function saveMantraPhrases() {
  const ta = document.getElementById('mantra-phrases-input');
  if (!ta) return;
  mantraPhrases = ta.value.split('\n').map((p) => p.trim()).filter(Boolean);
  saveMantraPrefs();
  toast('💬 Saved ' + mantraPhrases.length + ' phrase' + (mantraPhrases.length === 1 ? '' : 's'));
}

function resetMantraPhrases() {
  mantraPhrases = MANTRA_DEFAULT_PHRASES.slice();
  saveMantraPrefs();
  const ta = document.getElementById('mantra-phrases-input');
  if (ta) ta.value = mantraPhrases.join('\n');
  toast('💬 Phrases reset to defaults');
}

function previewMantra() {
  ['drift', 'flash', 'beat', 'trance'].forEach((s, i) => setTimeout(() => showMantra(s), i * 900));
}

// ---- Visual FX rewards ----
// Short visual moments on a single tile that ride along with a reward -
// a new kind of thing to win that also pulls the eye straight to the
// video it lands on. Each kind is either a CSS class on the tile (prism,
// RGB split, VHS - filter/transform on that one <video> for a few
// seconds), a canvas laid over it (bloom), Web Animations kicks on its
// transform (zoom pulse, synced to audio onsets/Rhythm beats when there
// are any), or a one-shot ring (shockwave). One effect per tile at a
// time; a second one on the same tile just waits its turn out.
//
// Every lasting kind is driven by fxEnvelope: a quick ease in, then its
// last FX_FADE_OUT_MS eases back to the untouched video instead of
// snapping off. Each one's ms includes that fade. They all live on the
// tile (classes, CSS vars, an overlay) or read the tile's one <video>,
// which is reused across clip changes - so an effect still running when
// the clip rotates just carries on over the next clip until its window
// is up.
const TILE_FX_KINDS = {
  prism: { label: '🌈 Prism', ms: 8000 },
  bloom: { label: '✨ Dreamy Bloom', ms: 7000 },
  duotone: { label: '🎨 Duotone', ms: 7500 },
  leak: { label: '🌅 Light Leak', ms: 8500 },
  zoom: { label: '💓 Zoom Pulse', ms: 9000 },
  rgb: { label: '🎞 RGB Split', ms: 8000 },
  vhs: { label: '📼 VHS', ms: 7500 },
  shock: { label: '💥 Shockwave', ms: 900 },
};
const FX_FADE_IN_MS = 400;
const FX_FADE_OUT_MS = 2500;

function fxSmoothstep(x) { return x * x * (3 - 2 * x); }

// 0 -> 1 over the fade-in, holds at 1, then 1 -> 0 over the last
// FX_FADE_OUT_MS (or half the run, if it's ever shorter than that).
function fxEnvelope(elapsed, ms) {
  if (elapsed <= 0 || elapsed >= ms) return 0;
  const fadeOut = Math.min(FX_FADE_OUT_MS, ms / 2);
  const fin = Math.min(1, elapsed / FX_FADE_IN_MS);
  const left = ms - elapsed;
  return fxSmoothstep(fin) * fxSmoothstep(left < fadeOut ? left / fadeOut : 1);
}
const TILE_FX_NAMES = Object.keys(TILE_FX_KINDS);
let fxRewardsEnabled = true;
const tileFxBusyUntil = {}; // tile idx -> timestamp
const zoomFxTiles = new Map(); // tile idx -> { start, until } timestamps
let rgbSplitActiveUntil = 0; // the SVG filter is shared, so one RGB split at a time

function pickFxKind() {
  const pool = TILE_FX_NAMES.filter((k) => k !== 'shock' && !(k === 'rgb' && Date.now() < rgbSplitActiveUntil));
  return weightedPick(pool, (k) => tasteWeight('fx', k));
}

function fireTileFx(idx, kind) {
  const tile = tileElements[idx];
  const vid = getTileVideo(idx);
  if (!tile || !vid) return false;
  const spec = TILE_FX_KINDS[kind];
  if (!spec) return false;
  const now = Date.now();
  if (kind !== 'shock') {
    if (now < (tileFxBusyUntil[idx] || 0)) return false;
    tileFxBusyUntil[idx] = now + spec.ms;
    tasteNoteFx(idx, kind, spec.ms);
  }
  if (kind === 'prism') {
    startPrismFx(tile, spec.ms);
  } else if (kind === 'bloom') {
    startBloomFx(tile, vid, spec.ms);
  } else if (kind === 'duotone') {
    startDuotoneFx(tile, vid, spec.ms);
  } else if (kind === 'leak') {
    startLightLeakFx(tile, spec.ms);
  } else if (kind === 'zoom') {
    zoomFxTiles.set(idx, { start: now, until: now + spec.ms });
    kickZoomTile(idx, 0.8);
  } else if (kind === 'rgb') {
    if (now < rgbSplitActiveUntil) return false;
    startRgbSplitFx(tile, spec.ms);
  } else if (kind === 'vhs') {
    startVhsFx(tile, vid, spec.ms);
  } else if (kind === 'shock') {
    const ring = document.createElement('div');
    ring.className = 'fx-shock-ring';
    ring.addEventListener('animationend', () => ring.remove());
    tile.insertBefore(ring, vid.nextSibling);
  }
  return true;
}

// Returns the label of whatever fired (for the caller to fold into its
// own reward label), or null if nothing did.
function maybeFxReward(idx, chance) {
  if (!fxRewardsEnabled || Math.random() >= chance) return null;
  const kind = pickFxKind();
  return fireTileFx(idx, kind) ? TILE_FX_KINDS[kind].label : null;
}

function fireRandomTileFx(count) {
  if (!fxRewardsEnabled || !tileElements.length) return;
  const used = new Set();
  for (let n = 0; n < count && used.size < tileElements.length; n++) {
    let idx = pickAmbientTarget();
    for (let tries = 0; tries < 6 && used.has(idx); tries++) idx = Math.floor(Math.random() * tileElements.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const kind = pickFxKind();
    setTimeout(() => {
      if (fireTileFx(idx, kind)) showClaimRewardLabel(idx, TILE_FX_KINDS[kind].label);
    }, n * 220);
  }
}

// Shared by the canvas-overlay FX (bloom, duotone): a canvas laid over
// just this tile, redrawn from the <video> at ~30fps at 1/`downscale`
// resolution, with its look driven by style(canvas, elapsed) every frame.
// Matches the tile video's object-fit: contain so the overlay lines up.
// Inserted right after the <video> so the glow/claim/label layers stay on
// top of it.
function startCanvasOverlayFx(tile, vid, ms, className, downscale, style, onEnd) {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.style.opacity = '0';
  tile.insertBefore(canvas, vid.nextSibling);
  const g = canvas.getContext('2d');
  const start = performance.now();
  let last = 0;
  function draw(ts) {
    const elapsed = ts - start;
    if (!canvas.isConnected || elapsed >= ms) {
      canvas.remove();
      if (onEnd) onEnd();
      return;
    }
    requestAnimationFrame(draw);
    style(canvas, elapsed);
    if (ts - last < 33) return;
    last = ts;
    const w = Math.max(1, Math.round(tile.clientWidth / downscale)), h = Math.max(1, Math.round(tile.clientHeight / downscale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const vw = vid.videoWidth, vh = vid.videoHeight;
    if (!vw || !vh) return;
    g.clearRect(0, 0, w, h);
    const scale = Math.min(w / vw, h / vh);
    const dw = vw * scale, dh = vh * scale;
    g.drawImage(vid, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  requestAnimationFrame(draw);
}

// A soft, glowing copy of the clip screened over itself - the video stays
// fully recognisable (unlike the mirrored kaleidoscope this replaced) but
// blooms brighter and dreamier, breathing slowly while it's up. Drawn at
// quarter resolution and blurred by CSS, so it stays cheap.
const BLOOM_BREATHS = 2; // slow swells over the run
function startBloomFx(tile, vid, ms) {
  startCanvasOverlayFx(tile, vid, ms, 'fx-bloom-canvas', 4, (canvas, elapsed) => {
    const breath = 0.75 + 0.25 * Math.sin((elapsed / ms) * Math.PI * 2 * BLOOM_BREATHS - Math.PI / 2);
    canvas.style.opacity = (fxEnvelope(elapsed, ms) * TUNING.BLOOM_PEAK_OPACITY * breath).toFixed(3);
    canvas.style.transform = 'scale(' + (1.02 + 0.03 * breath).toFixed(4) + ')';
  });
}

// The clip re-printed in two tones from a color theme (deep shadow ->
// bright highlight), like a screen-print poster, faded in over the real
// video and back out. Each run gets its own SVG gradient-map filter so two
// tiles can wear different palettes at once; it's removed when the run ends.
let duotoneSeq = 0;
function duotoneFilter(theme) {
  const ns = 'http://www.w3.org/2000/svg';
  const host = document.getElementById('mm-rgb-split').ownerSVGElement;
  const dark = theme.glow.split(',').map((c) => (+c / 255) * 0.18);
  const light = theme.flash.split(',').map((c) => Math.min(1, (+c / 255) * 1.05));
  const filter = document.createElementNS(ns, 'filter');
  filter.setAttribute('id', 'mm-duotone-' + (++duotoneSeq));
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const lum = document.createElementNS(ns, 'feColorMatrix');
  lum.setAttribute('type', 'matrix');
  lum.setAttribute('values', '.2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  0 0 0 1 0');
  const map = document.createElementNS(ns, 'feComponentTransfer');
  ['R', 'G', 'B'].forEach((ch, i) => {
    const fn = document.createElementNS(ns, 'feFunc' + ch);
    fn.setAttribute('type', 'table');
    fn.setAttribute('tableValues', dark[i].toFixed(3) + ' ' + light[i].toFixed(3));
    map.appendChild(fn);
  });
  filter.append(lum, map);
  host.appendChild(filter);
  return filter;
}

function startDuotoneFx(tile, vid, ms) {
  const theme = moodDuotoneTheme();
  const filter = duotoneFilter(theme);
  startCanvasOverlayFx(tile, vid, ms, 'fx-duotone-canvas', 2, (canvas, elapsed) => {
    if (!canvas.style.filter) canvas.style.filter = 'url(#' + filter.id + ') contrast(1.15)';
    canvas.style.opacity = (fxEnvelope(elapsed, ms) * TUNING.DUOTONE_PEAK_OPACITY).toFixed(3);
  }, () => filter.remove());
}

// Warm film-style light spilling in from one side and drifting across -
// two blurred amber/pink patches screened over the tile. Pure CSS
// gradients (no per-frame drawing); JS only drives the fade and drift.
function startLightLeakFx(tile, ms) {
  const leak = document.createElement('div');
  leak.className = 'fx-leak-overlay';
  leak.style.opacity = '0';
  // Random entry angle and a slight hue shift, so repeat leaks don't look stamped.
  leak.style.setProperty('--leak-angle', Math.round(Math.random() * 360) + 'deg');
  leak.style.setProperty('--leak-hue', Math.round(Math.random() * 30 - 15 + moodLeakHueDeg()) + 'deg');
  const vid = tile.querySelector('video:not(.preload)');
  tile.insertBefore(leak, vid ? vid.nextSibling : tile.firstChild);
  const start = performance.now();
  function step(ts) {
    const elapsed = ts - start;
    if (elapsed >= ms || !leak.isConnected) { leak.remove(); return; }
    const flicker = 0.9 + 0.1 * Math.sin(elapsed / 170) * Math.sin(elapsed / 430);
    leak.style.opacity = (fxEnvelope(elapsed, ms) * TUNING.LIGHT_LEAK_PEAK_OPACITY * flicker).toFixed(3);
    leak.style.setProperty('--leak-p', (elapsed / ms).toFixed(4));
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Hue keeps rotating while the saturation boost rides the envelope. The
// spin rate is picked so the fade-out (an ease-out that starts at the
// same angular speed and decelerates to a stop) lands on an exact
// multiple of 360deg - the colors drift back home instead of jumping
// there when the class comes off. Driven through CSS vars on the tile so
// it applies to whatever clip the tile's <video> is showing.
function startPrismFx(tile, ms) {
  const fadeMs = Math.min(FX_FADE_OUT_MS, ms / 2);
  const fadeStart = ms - fadeMs;
  // An ease-out quad covers half the distance a constant speed would.
  const turns = Math.max(1, Math.round((fadeStart + fadeMs / 2) / 3200));
  const degPerMs = (turns * 360) / (fadeStart + fadeMs / 2);
  const start = performance.now();
  tile.classList.add('fx-prism');
  function step(ts) {
    const elapsed = ts - start;
    if (elapsed >= ms || !tile.isConnected) {
      tile.classList.remove('fx-prism');
      tile.style.removeProperty('--prism-hue');
      tile.style.removeProperty('--prism-sat');
      return;
    }
    let hue;
    if (elapsed < fadeStart) hue = elapsed * degPerMs;
    else {
      const u = (elapsed - fadeStart) / fadeMs;
      hue = fadeStart * degPerMs + degPerMs * fadeMs / 2 * (1 - (1 - u) * (1 - u));
    }
    tile.style.setProperty('--prism-hue', (hue % 360).toFixed(1) + 'deg');
    tile.style.setProperty('--prism-sat', (1 + 0.7 * fxEnvelope(elapsed, ms)).toFixed(3));
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function startRgbSplitFx(tile, ms) {
  const offsets = document.querySelectorAll('#mm-rgb-split feOffset');
  if (!offsets.length) return;
  rgbSplitActiveUntil = Date.now() + ms;
  tile.classList.add('fx-rgb');
  const start = performance.now();
  function step(ts) {
    const elapsed = ts - start;
    if (elapsed >= ms) {
      tile.classList.remove('fx-rgb');
      offsets.forEach((o) => o.setAttribute('dx', '0'));
      return;
    }
    // A slow swell and a faster wobble riding on top, all scaled by the
    // envelope so the channels slide back together over the fade-out.
    const swell = 0.5 + 0.5 * Math.sin(elapsed / 900);
    const dx = (4 + 8 * swell) * (0.75 + 0.25 * Math.sin(ts / 60)) * fxEnvelope(elapsed, ms);
    offsets[0].setAttribute('dx', dx.toFixed(1));
    if (offsets[1]) offsets[1].setAttribute('dx', (-dx).toFixed(1));
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function startVhsFx(tile, vid, ms) {
  const overlay = document.createElement('div');
  overlay.className = 'fx-vhs-overlay';
  overlay.style.opacity = '0';
  tile.insertBefore(overlay, vid.nextSibling);
  tile.style.setProperty('--vhs-k', '0');
  tile.classList.add('fx-vhs');
  const start = performance.now();
  const fadeStart = ms - Math.min(FX_FADE_OUT_MS, ms / 2);
  function step(ts) {
    const elapsed = ts - start;
    if (elapsed >= ms || !tile.isConnected) {
      tile.classList.remove('fx-vhs', 'fx-vhs-fading');
      tile.style.removeProperty('--vhs-k');
      overlay.remove();
      return;
    }
    const k = fxEnvelope(elapsed, ms).toFixed(3);
    tile.style.setProperty('--vhs-k', k);
    overlay.style.opacity = k;
    // The jitter is a hard step animation - it stops rather than fading.
    if (elapsed >= fadeStart) tile.classList.add('fx-vhs-fading');
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function kickZoomTile(idx, strength) {
  const vid = getTileVideo(idx);
  const z = zoomFxTiles.get(idx);
  if (!vid || !vid.animate || !z) return;
  const env = fxEnvelope(Date.now() - z.start, z.until - z.start);
  if (env < 0.02) return;
  const scale = 1 + (0.05 + strength * 0.07) * env;
  vid.animate([{ transform: 'scale(' + scale.toFixed(3) + ')' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
}

let lastZoomKickAt = 0;
function kickAllZoomTiles(strength) {
  const now = Date.now();
  lastZoomKickAt = now;
  zoomFxTiles.forEach((z, idx) => {
    if (now > z.until) { zoomFxTiles.delete(idx); return; }
    kickZoomTile(idx, strength);
  });
}
onAudioOnset((strength) => { if (zoomFxTiles.size) kickAllZoomTiles(strength); });
// Steady fallback beat for when nothing audible is driving the kicks.
setInterval(() => { if (zoomFxTiles.size && Date.now() - lastZoomKickAt > 500) kickAllZoomTiles(0.5); }, 520);

function loadFxRewardsPref() {
  try { const raw = localStorage.getItem('mm_fx_rewards'); if (raw !== null) fxRewardsEnabled = raw === '1'; } catch (e) {}
  setToggleBadge('fx-rewards-toggle', fxRewardsEnabled);
}

function toggleFxRewards() {
  fxRewardsEnabled = !fxRewardsEnabled;
  try { localStorage.setItem('mm_fx_rewards', fxRewardsEnabled ? '1' : '0'); } catch (e) {}
  setToggleBadge('fx-rewards-toggle', fxRewardsEnabled);
}

function previewTileFx(kind) {
  if (!tileElements.length) return;
  const idx = pickAmbientTarget();
  if (fireTileFx(idx, kind)) showClaimRewardLabel(idx, TILE_FX_KINDS[kind].label + ' (preview)');
  else toast('That tile is still mid-effect - try again in a sec', true);
}

// ---- Catch-streak milestones ----
// A chase chain landing on one of these pays a bonus on top of the
// normal catch - and the flash right before one says "1 more" on the
// tile (see activateChaseFlash), with a matching "1 away" if it slips.
const CHASE_MILESTONES = [5, 10, 15, 20, 30, 40, 50, 75, 100];

function awardChaseMilestone(idx, chain) {
  const xp = Math.round(chain * TUNING.CHASE_MILESTONE_XP_MULT);
  awardXp(xp);
  bumpJackpotHeat(0.8);
  playChimeSound(1.3, 1.08);
  burstConfetti(18 + Math.min(chain, 30));
  fireTileFx(idx, 'shock');
  fireTileFx(idx, chain >= 10 ? 'bloom' : 'prism');
  showClaimRewardLabel(idx, '🏅 x' + chain + ' STREAK +' + xp + 'xp');
  toast('🏅 Catch streak x' + chain + '! +' + xp + 'xp');
  nudgeEngagement(0.15);
}

// ---- Rhythm Mode ----
// A beat clock that the grid moves to: each beat lights the next tile
// in a snake through the grid (the "beat walker"), every downbeat (1 of
// 4) gives the edge glow a kick, and floaters/mantras/zoom FX can ride
// it too. Tempo can breathe in waves - an accelerando over ~70s that
// drops back to base - and with Speed Sync on, every tile's playback
// speed follows the tempo (0.95x at base, up to ~1.25x at the top of a
// wave), so each wave builds and releases.
//
// Engaged manually, or automatically for as long as Auto-Pilot's Rhythm
// Zone runs (rhythmZoneActive) and during a Finale's build/peak.
const RHYTHM_WAVE_RISE_FRAC = 0.85; // rises over 85% of the period, drops back over the last 15%
let rhythmEnabled = false;
let rhythmZoneActive = false;
let rhythmBaseBpm = 90;
let rhythmBpmSource = 'manual'; // 'manual' | 'audio'
let rhythmWaves = true;
let rhythmSound = false;
let rhythmSpeedSync = true;
let rhythmStartedAt = 0;
let rhythmNextBeatAt = 0;
let rhythmBeatCount = 0;
let rhythmWasActive = false;
let detectedBpm = null;
let rhythmRunMinutesPaid = 0;

// Tempo follows the session's energy: engagement, a barrage build-up or
// fresh payoff, surges, Overdrive and the Auto-Pilot zone push a target
// multiplier that the actual tempo glides toward - so the beat quickens
// into a hype moment and settles after it, instead of jumping. A Floater
// Barrage slows it into a dreamier pace.
//
// Shaped to flow rather than see-saw (real-session feedback: "a high, then
// low, then high state"): each payoff adds a swell that fades out over
// ~12s instead of a flat 5s block that switched off, and the drive rises
// over ~8s but settles over ~20s. Replaying that session: 3.8 -> 1.5
// direction swings a minute, changes ~2.5x gentler, same overall range.
let rhythmPayoffGlow = 0;
let rhythmPayoffSeenAt = 0;
let rhythmReactive = true;
let rhythmCutOnBeat = true;
let rhythmDrive = 1;
let rhythmDriveTargetValue = 1;
let rhythmDriveUpdatedAt = Date.now();
let rhythmDriveTargetAt = 0;

// The session's energy - always computed (Shared Pulse rides it too);
// Rhythm Mode's tempo only follows it with Tempo Follows Energy on.
function rhythmDriveTarget() {
  let d = 1 + Math.max(-0.08, Math.min(0.08, (readEngagement() - 1.6) * 0.16));
  if (lastKnownBarrage > 0 || anticipationActive) d += 0.1;
  d += rhythmPayoffGlow;
  if (isSurgeActive()) d += 0.05;
  if (overdriveActive) d += 0.1;
  if (floaterBarrageActive) d -= 0.12;
  if (autopilotZone === 'vault') d -= 0.06;
  else if (autopilotZone === 'jackpot') d += 0.04;
  if (typeof windDownK === 'function') d -= 0.2 * windDownK(); // winding down settles everything
  return Math.max(TUNING.RHYTHM_DRIVE_MIN, Math.min(TUNING.RHYTHM_DRIVE_MAX, d));
}

function rhythmTempoDrive() {
  return rhythmReactive ? rhythmDrive : 1;
}

function updateRhythmDrive() {
  const now = Date.now();
  const dt = now - rhythmDriveUpdatedAt;
  rhythmDriveUpdatedAt = now;
  rhythmPayoffGlow *= Math.pow(0.5, dt / TUNING.RHYTHM_PAYOFF_GLOW_HALFLIFE_MS);
  if (lastAnyPayoffAt > rhythmPayoffSeenAt) {
    if (rhythmPayoffSeenAt) rhythmPayoffGlow = Math.min(TUNING.RHYTHM_PAYOFF_GLOW_CAP, rhythmPayoffGlow + TUNING.RHYTHM_PAYOFF_GLOW_ADD);
    rhythmPayoffSeenAt = lastAnyPayoffAt; // the first read is the session-start seed, not a payoff
  }
  if (now - rhythmDriveTargetAt > 250) { rhythmDriveTargetValue = rhythmDriveTarget(); rhythmDriveTargetAt = now; }
  const tau = rhythmDriveTargetValue > rhythmDrive ? TUNING.RHYTHM_DRIVE_RISE_MS : TUNING.RHYTHM_DRIVE_FALL_MS;
  rhythmDrive += (rhythmDriveTargetValue - rhythmDrive) * (1 - Math.exp(-dt / tau));
}

// Beat patterns - how the beat moves across the grid. 'mix' rotates
// between them every few bars, leaning toward the punchier ones when the
// tempo is driven up and the flowing ones when it's settled.
const RHYTHM_PATTERNS = {
  snake: { label: '🐍 Snake', energy: 'calm' },
  pingpong: { label: '↔️ Ping-pong', energy: 'calm' },
  ripple: { label: '🌊 Ripple', energy: 'calm' },
  scatter: { label: '✨ Scatter', energy: 'hype' },
  heartbeat: { label: '💓 Heartbeat', energy: 'hype' },
};
const RHYTHM_PATTERN_NAMES = Object.keys(RHYTHM_PATTERNS);
let rhythmPatternPref = 'mix';
let rhythmPattern = 'snake';
let rhythmLastScatter = -1;

function pickRhythmPattern() {
  const hype = rhythmDrive > 1.1;
  const options = RHYTHM_PATTERN_NAMES.filter((p) => p !== rhythmPattern);
  const weights = options.map((p) => ((RHYTHM_PATTERNS[p].energy === 'hype') === hype ? 2 : 1) * tasteWeight('pattern', p));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) { roll -= weights[i]; if (roll <= 0) return options[i]; }
  return options[options.length - 1];
}

// Tiles grouped into rings around the grid's centre, innermost first.
function rhythmRings() {
  const n = tileElements.length;
  const cols = Math.max(1, currentColumns || 1);
  const rows = Math.ceil(n / cols);
  const byRing = new Map();
  for (let i = 0; i < n; i++) {
    // Straight-line distance in half-tile steps: a 3x3 gets centre ->
    // edges -> corners rather than centre -> all eight at once.
    const ring = Math.round(Math.hypot((i % cols) - (cols - 1) / 2, Math.floor(i / cols) - (rows - 1) / 2) * 2);
    if (!byRing.has(ring)) byRing.set(ring, []);
    byRing.get(ring).push(i);
  }
  return [...byRing.keys()].sort((a, b) => a - b).map((k) => byRing.get(k));
}

// [tileIndex, strength] pairs to light on beat n.
function rhythmPatternHits(n) {
  const downbeat = n % 4 === 0;
  const strength = downbeat ? 0.9 : 0.55;
  const order = rhythmWalkOrder();
  const len = order.length;
  if (!len) return [];
  if (rhythmPattern === 'pingpong') {
    const period = Math.max(1, 2 * (len - 1));
    const k = n % period;
    return [[order[k < len ? k : period - k], strength]];
  }
  if (rhythmPattern === 'scatter') {
    let idx = Math.floor(Math.random() * len);
    if (len > 1 && idx === rhythmLastScatter) idx = (idx + 1 + Math.floor(Math.random() * (len - 1))) % len;
    rhythmLastScatter = idx;
    return [[idx, strength]];
  }
  if (rhythmPattern === 'ripple') {
    const rings = rhythmRings();
    if (rings.length < 2) return [[order[n % len], strength]]; // e.g. dual: no centre to ripple from
    const ring = n % rings.length;
    return rings[ring].map((i) => [i, Math.max(0.35, strength - ring * 0.12)]);
  }
  if (rhythmPattern === 'heartbeat') {
    const step = n % 4; // lub, dub, rest, rest
    if (step > 1) return [];
    return tileElements.map((t, i) => [i, step === 0 ? 0.8 : 0.45]);
  }
  return [[order[n % len], strength]]; // snake
}

function rhythmActive() {
  return rhythmEnabled || rhythmZoneActive || finaleWantsRhythm() || Date.now() < spinRhythmUntil;
}

function rhythmWaveFrac() {
  if (!rhythmWaves || !rhythmActive()) return 0;
  const phase = ((Date.now() - rhythmStartedAt) % TUNING.RHYTHM_WAVE_PERIOD_MS) / TUNING.RHYTHM_WAVE_PERIOD_MS;
  if (phase < RHYTHM_WAVE_RISE_FRAC) {
    const t = phase / RHYTHM_WAVE_RISE_FRAC;
    return t * t * (3 - 2 * t); // smoothstep - eases into the climb and into the top
  }
  const t = (phase - RHYTHM_WAVE_RISE_FRAC) / (1 - RHYTHM_WAVE_RISE_FRAC);
  return 1 - t * t * (3 - 2 * t);
}

function rhythmEffectiveBaseBpm() {
  return rhythmBpmSource === 'audio' && detectedBpm ? detectedBpm : rhythmBaseBpm;
}

function currentRhythmBpm() {
  return Math.min(TUNING.RHYTHM_MAX_BPM, rhythmEffectiveBaseBpm() * (1 + TUNING.RHYTHM_WAVE_DEPTH * rhythmWaveFrac()) * finaleTempoMult() * rhythmTempoDrive());
}

function rhythmSpeedMult() {
  if (!rhythmActive() || !rhythmSpeedSync) return 1;
  // Tile speed rides half of the energy drive, on top of the wave.
  return (0.95 + 0.3 * rhythmWaveFrac()) * (1 + (rhythmTempoDrive() - 1) * 0.5);
}

// Snake order through the grid (left-to-right, then right-to-left on the
// next row) so the walker reads as one continuous path. Under Mosaic Fit
// the visual order differs a bit from the index order - close enough.
function rhythmWalkOrder() {
  const n = tileElements.length;
  const cols = Math.max(1, currentColumns || 1);
  const order = [];
  for (let r = 0; r * cols < n; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) { const i = r * cols + c; if (i < n) row.push(i); }
    if (r % 2) row.reverse();
    order.push(...row);
  }
  return order;
}

function onRhythmBeat(n) {
  const downbeat = n % 4 === 0;
  if (n > 0 && n % TUNING.RHYTHM_PATTERN_SWITCH_BEATS === 0) {
    if (rhythmPatternPref !== 'mix') rhythmPattern = rhythmPatternPref;
    else if (Math.random() < TUNING.RHYTHM_PATTERN_SWITCH_CHANCE) rhythmPattern = pickRhythmPattern();
  }
  flushPendingCuts(downbeat);
  if (!anticipationActive) rhythmPatternHits(n).forEach(([idx, s]) => reactPulseTile(idx, s));
  onPulseBeat(n);
  if (downbeat) audioGlowKick = Math.max(audioGlowKick, 0.55); // updateAudioGlow decays it back down
  if (rhythmSound) playRhythmClick(downbeat);
  if (zoomFxTiles.size) kickAllZoomTiles(downbeat ? 0.9 : 0.5);
  if (n % 8 === 0) maybeMantraOnBeat(0.8);
}

function playRhythmClick(downbeat) {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(downbeat ? 95 : 70, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(downbeat ? 0.14 : 0.08, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.start(now);
  osc.stop(now + 0.13);
}

setInterval(() => {
  const active = rhythmActive();
  if (active !== rhythmWasActive) {
    rhythmWasActive = active;
    if (active) {
      rhythmPattern = rhythmPatternPref === 'mix' ? RHYTHM_PATTERN_NAMES[Math.floor(Math.random() * RHYTHM_PATTERN_NAMES.length)] : rhythmPatternPref;
      rhythmStartedAt = Date.now();
      rhythmNextBeatAt = performance.now();
      rhythmBeatCount = 0;
      rhythmRunMinutesPaid = 0;
    }
    updateRhythmUi();
  }
  if (!active) return;
  updateRhythmDrive();
  const runMs = rhythmRunMs();
  sessionStats.rhythmBest = Math.max(sessionStats.rhythmBest, runMs);
  const runMinutes = Math.floor(runMs / 60000);
  if (runMinutes > rhythmRunMinutesPaid) {
    rhythmRunMinutesPaid = runMinutes;
    onRhythmRunMinute(runMinutes);
  }
  const now = performance.now();
  if (now >= rhythmNextBeatAt) {
    onRhythmBeat(rhythmBeatCount++);
    const interval = 60000 / currentRhythmBpm();
    rhythmNextBeatAt += interval;
    if (rhythmNextBeatAt < now) rhythmNextBeatAt = now + interval; // fell behind (background tab) - resync instead of firing a burst
  }
}, 15);

// Tempo from the audio: inter-onset intervals between nearby onsets,
// folded into a 70-150 bpm range and histogrammed - the strongest bin
// wins if it stands out enough. Spoken-word tracks often have no steady
// pulse at all; then this stays null and the manual BPM is used.
const rhythmOnsetTimes = [];
onAudioOnset((strength, now) => {
  rhythmOnsetTimes.push(now);
  while (rhythmOnsetTimes.length && now - rhythmOnsetTimes[0] > 12000) rhythmOnsetTimes.shift();
});

function detectBpmFromOnsets() {
  const t = rhythmOnsetTimes;
  if (t.length < 10) return null;
  const hist = new Map();
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < Math.min(t.length, i + 6); j++) {
      const d = t[j] - t[i];
      if (d < 250 || d > 2000) continue;
      let bpm = 60000 / d;
      while (bpm < 70) bpm *= 2;
      while (bpm > 150) bpm /= 2;
      const bin = Math.round(bpm / 3) * 3;
      const w = 1 / (j - i);
      hist.set(bin, (hist.get(bin) || 0) + w);
      total += w;
    }
  }
  let best = null, bestW = 0;
  hist.forEach((w, bin) => { if (w > bestW) { bestW = w; best = bin; } });
  return best && total > 0 && bestW / total >= 0.15 ? best : null;
}

setInterval(() => {
  if (rhythmBpmSource !== 'audio') return;
  detectedBpm = detectBpmFromOnsets();
  updateRhythmUi();
}, 4000);

// An "in-sync run" is how long Rhythm Mode has stayed engaged without a
// break; each full minute pays a little XP, every other one a tile FX.
function rhythmRunMs() {
  return rhythmActive() && rhythmStartedAt ? Date.now() - rhythmStartedAt : 0;
}

function onRhythmRunMinute(minutes) {
  const xp = 4 + minutes * 2;
  const mult = registerCombo();
  awardXp(Math.round(xp * mult));
  playChimeSound(0.6, 1 + Math.min(minutes, 16) * 0.016);
  toast('🥁 In sync ' + minutes + ' min! +' + Math.round(xp * mult) + 'xp');
  if (minutes % 2 === 0) {
    const order = rhythmWalkOrder();
    const idx = order.length ? order[(rhythmBeatCount - 1 + order.length) % order.length] : 0;
    const kind = pickFxKind();
    if (fxRewardsEnabled && fireTileFx(idx, kind)) showClaimRewardLabel(idx, '🥁 ' + TILE_FX_KINDS[kind].label);
  }
}

// True when a moment (e.g. a heart) lands close to a Rhythm Mode beat.
function rhythmOnBeatNow() {
  if (!rhythmActive()) return false;
  const interval = 60000 / currentRhythmBpm();
  const now = performance.now();
  const err = Math.min(Math.abs(now - (rhythmNextBeatAt - interval)), Math.abs(rhythmNextBeatAt - now));
  return err <= Math.min(140, interval * 0.22);
}

function updateRhythmUi() {
  setToggleBadge('rhythm-toggle', rhythmEnabled);
  setToggleBadge('rhythm-waves-toggle', rhythmWaves);
  setToggleBadge('rhythm-sound-toggle', rhythmSound);
  setToggleBadge('rhythm-speed-toggle', rhythmSpeedSync);
  setToggleBadge('rhythm-reactive-toggle', rhythmReactive);
  setToggleBadge('rhythm-cut-toggle', rhythmCutOnBeat);
  ['mix'].concat(RHYTHM_PATTERN_NAMES).forEach((p) => {
    const b = document.getElementById('rhythm-pattern-' + p);
    if (b) b.classList.toggle('active', rhythmPatternPref === p);
  });
  ['manual', 'audio'].forEach((s) => {
    const b = document.getElementById('rhythm-src-' + s);
    if (b) b.classList.toggle('active', rhythmBpmSource === s);
  });
  const input = document.getElementById('rhythm-bpm-input');
  if (input) input.value = rhythmBaseBpm;
  const lbl = document.getElementById('l-rhythm-bpm');
  if (lbl) lbl.innerText = rhythmBaseBpm + ' BPM';
  const status = document.getElementById('rhythm-status');
  if (status) {
    const why = rhythmEnabled ? 'on' : rhythmZoneActive ? 'on (Rhythm Zone)' : finaleWantsRhythm() ? 'on (Finale)'
      : Date.now() < spinRhythmUntil ? 'on (Spin, ' + Math.ceil((spinRhythmUntil - Date.now()) / 1000) + 's left)' : 'off';
    const src = rhythmBpmSource === 'audio' ? (detectedBpm ? 'detected ~' + detectedBpm + ' BPM' : 'no steady beat in the audio - using ' + rhythmBaseBpm) : rhythmBaseBpm + ' BPM base';
    const energy = rhythmReactive && Math.abs(rhythmDrive - 1) >= 0.02 ? ' (energy ×' + rhythmTempoDrive().toFixed(2) + ')' : '';
    status.innerText = 'Rhythm ' + why + ' · ' + src + (rhythmActive() ? ' · now ' + Math.round(currentRhythmBpm()) + ' BPM' + energy + ' · ' + RHYTHM_PATTERNS[rhythmPattern].label + ' · in sync ' + formatRunSeconds(rhythmRunMs()) : '');
  }
}

function formatRunSeconds(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
setInterval(() => { if (rhythmActive()) updateRhythmUi(); }, 1000);

function loadRhythmPrefs() {
  const prefs = loadJsonPref('mm_rhythm', { enabled: false, bpm: 90, source: 'manual', waves: true, sound: false, speedSync: true, reactive: true, pattern: 'mix', cutOnBeat: true });
  rhythmEnabled = !!prefs.enabled;
  rhythmBaseBpm = Math.max(50, Math.min(160, Number(prefs.bpm) || 90));
  rhythmBpmSource = prefs.source === 'audio' ? 'audio' : 'manual';
  rhythmWaves = !!prefs.waves;
  rhythmSound = !!prefs.sound;
  rhythmSpeedSync = !!prefs.speedSync;
  rhythmReactive = prefs.reactive !== false;
  rhythmCutOnBeat = prefs.cutOnBeat !== false;
  rhythmPatternPref = prefs.pattern === 'mix' || RHYTHM_PATTERNS[prefs.pattern] ? prefs.pattern : 'mix';
  updateRhythmUi();
}

function saveRhythmPrefs() {
  saveJsonPref('mm_rhythm', { enabled: rhythmEnabled, bpm: rhythmBaseBpm, source: rhythmBpmSource, waves: rhythmWaves, sound: rhythmSound, speedSync: rhythmSpeedSync, reactive: rhythmReactive, pattern: rhythmPatternPref, cutOnBeat: rhythmCutOnBeat });
  updateRhythmUi();
}

function toggleRhythm() { rhythmEnabled = !rhythmEnabled; saveRhythmPrefs(); }
function toggleRhythmWaves() { rhythmWaves = !rhythmWaves; saveRhythmPrefs(); }
function toggleRhythmSound() { rhythmSound = !rhythmSound; saveRhythmPrefs(); }
function toggleRhythmSpeedSync() { rhythmSpeedSync = !rhythmSpeedSync; saveRhythmPrefs(); }
function toggleRhythmReactive() { rhythmReactive = !rhythmReactive; saveRhythmPrefs(); }
function toggleRhythmCutOnBeat() { rhythmCutOnBeat = !rhythmCutOnBeat; saveRhythmPrefs(); }
function setRhythmPattern(p) {
  rhythmPatternPref = p === 'mix' || RHYTHM_PATTERNS[p] ? p : 'mix';
  if (rhythmPatternPref !== 'mix') rhythmPattern = rhythmPatternPref;
  saveRhythmPrefs();
}
function setRhythmBpm(v) { rhythmBaseBpm = parseInt(v, 10) || 90; saveRhythmPrefs(); }
function setRhythmSource(s) { rhythmBpmSource = s; if (s === 'audio') detectedBpm = detectBpmFromOnsets(); saveRhythmPrefs(); }

// ---- Fresh Drop ----
// Newly added clips are held out of ordinary rotation server-side (see
// _FRESH_CONDITION in db.py) and debut here one at a time instead: a
// tile dims under a "fresh drop incoming" shimmer with a riser, then the
// new clip lands with a reveal. Rationed so a batch isn't burned through
// in one sitting - not before FRESH_DROP_FIRST_DELAY_MS into a session,
// at least FRESH_DROP_MIN_GAP_MS apart, at most FRESH_DROP_SESSION_CAP
// per visit. Whatever's left waits for the next session. Once a clip has
// debuted it joins normal rotation, where its low play count already
// earns it extra exploration weight for a while.
const FRESH_DROP_REVEAL_DELAY_MS = 2200;
let freshDropEnabled = true;
let freshWaiting = 0;
let freshDropsThisSession = 0;
let lastFreshDropAt = 0;
let freshDropInFlight = false;

function checkFreshStatus(announce) {
  fetch('/api/fresh_status')
    .then((r) => r.json())
    .then((d) => {
      const prev = freshWaiting;
      freshWaiting = (d && d.waiting) || 0;
      if (announce && freshWaiting > 0) toast('🆕 ' + freshWaiting + ' fresh clip' + (freshWaiting === 1 ? '' : 's') + ' waiting to drop');
      else if (!announce && freshWaiting > prev) toast('🆕 New clips noticed - they\'ll drop in over time');
      updateFreshUi();
    })
    .catch(() => {});
}

function maybeTriggerFreshDrop() {
  if (!freshDropEnabled || freshDropInFlight || freshWaiting <= 0 || !tileElements.length) return;
  const now = Date.now();
  if (now - sessionStartedAt < TUNING.FRESH_DROP_FIRST_DELAY_MS) return;
  if (freshDropsThisSession >= TUNING.FRESH_DROP_SESSION_CAP) return;
  if (now - lastFreshDropAt < TUNING.FRESH_DROP_MIN_GAP_MS) return;
  if (anticipationActive || finalePhaseNow() === 'afterglow') return;
  if (Math.random() >= TUNING.FRESH_DROP_PROBABILITY) return;
  runFreshDrop();
}

function runFreshDrop(manual) {
  if (freshDropInFlight || !tileElements.length) return;
  if (freshWaiting <= 0) { if (manual) toast('🆕 No fresh clips waiting', true); return; }
  freshDropInFlight = true;
  lastFreshDropAt = Date.now();
  const idx = pickAmbientTarget(chaseFlashTileIndex);
  const tile = tileElements[idx];
  if (tile) tile.classList.add('fresh-incoming');
  playRiserSound(FRESH_DROP_REVEAL_DELAY_MS / 1000);
  setTimeout(() => {
    fetch('/api/fresh_drop?screen=' + idx)
      .then((r) => r.json())
      .then((d) => {
        freshWaiting = (d && d.waiting) || 0;
        if (!d || !d.picked) {
          if (tile) tile.classList.remove('fresh-incoming');
          playFizzleSound();
          return;
        }
        freshDropsThisSession++;
        sessionStats.freshDrops++;
        // A beat for the new clip to actually start loading before the reveal.
        setTimeout(() => {
          if (tile) {
            tile.classList.remove('fresh-incoming');
            tile.classList.add('fresh-reveal');
            setTimeout(() => tile.classList.remove('fresh-reveal'), 7000);
          }
          playChimeSound(1.15);
          playBassDropSound(0.8);
          fireTileFx(idx, 'shock');
          burstConfetti(16);
          showClaimRewardLabel(idx, '🆕 Fresh Drop!');
          awardXp(10);
          markNoveltyHappened();
          nudgeEngagement(0.1);
          toast('🆕 Fresh Drop! +10xp' + (freshWaiting ? ' (' + freshWaiting + ' still waiting)' : ''));
        }, 600);
      })
      .catch(() => { if (tile) tile.classList.remove('fresh-incoming'); })
      .finally(() => { freshDropInFlight = false; updateFreshUi(); });
  }, FRESH_DROP_REVEAL_DELAY_MS);
}

function updateFreshUi() {
  setToggleBadge('fresh-drop-toggle', freshDropEnabled);
  const el = document.getElementById('fresh-drop-status');
  if (el) {
    el.innerText = freshWaiting + ' waiting · ' + freshDropsThisSession + ' / ' + TUNING.FRESH_DROP_SESSION_CAP + ' dropped this session';
  }
}

function loadFreshDropPref() {
  try { const raw = localStorage.getItem('mm_fresh_drop_enabled'); if (raw !== null) freshDropEnabled = raw === '1'; } catch (e) {}
  updateFreshUi();
}

function toggleFreshDrop() {
  freshDropEnabled = !freshDropEnabled;
  try { localStorage.setItem('mm_fresh_drop_enabled', freshDropEnabled ? '1' : '0'); } catch (e) {}
  updateFreshUi();
}

// ---- Finale ----
// A one-shot planned peak, distinct from Auto-Pilot's repeating arc:
// Auto-Pilot keeps cycling calm -> climax -> cooldown for as long as it
// runs, while a Finale is a single longer climb that goes further than
// any one cycle does and then actually lands, with a recap at the end.
//
//   build (0-55%)      pace quickens, barrage/jackpot odds and floaters
//                      climb, selection leans toward your favorites,
//                      speed eases up, mantras get more frequent
//   peak (55-85%)      spiral fades in, a Surge runs for the whole
//                      stretch, color splashes and tile FX keep firing
//   climax (85%)       a forced MEGA jackpot + full Color Rush + mantra
//                      flood, all at once
//   afterglow (85-100) everything eases back below normal and settles,
//                      then the recap card
//
// While it runs it owns every control Auto-Pilot would otherwise drive
// (autopilotTick steps aside) and hands them back when it ends. Rhythm
// Mode rides along through build and peak. With Auto-Pilot on, it can
// also offer itself once a session has run long (see maybeOfferFinale).
const FINALE_BUILD_END = 0.55;
const FINALE_CLIMAX_AT = 0.85;
const FINALE_TICK_MS = 2000;
const FINALE_OFFER_CHECK_MS = 60000;
const FINALE_OFFER_MIN_SESSION_MS = 15 * 60000;
const FINALE_OFFER_COOLDOWN_MS = 25 * 60000;
const FINALE_OFFER_WINDOW_MS = 12000;
let finaleActive = false;
let finaleMinutes = 5;
let finaleOfferEnabled = true;
let finaleStartedAt = 0;
let finaleDurationMs = 0;
let finaleClimaxFired = false;
let finaleLastPhase = null;
let finaleLastPace = null;
let finaleSavedPace = 2;
let finaleSavedFxCount = null;
let finaleTimer = null;
let lastFinaleOfferAt = 0;
let finaleOfferTimer = null;

function finaleProgress() {
  return finaleActive ? Math.min(1, (Date.now() - finaleStartedAt) / finaleDurationMs) : 0;
}

function finalePhaseNow() {
  if (!finaleActive) return null;
  const p = finaleProgress();
  return p < FINALE_BUILD_END ? 'build' : p < FINALE_CLIMAX_AT ? 'peak' : 'afterglow';
}

function finaleSpeedMult() {
  if (!finaleActive) return 1;
  const p = finaleProgress();
  if (p < FINALE_BUILD_END) { const t = p / FINALE_BUILD_END; return 1 + 0.12 * t * t; }
  if (p < FINALE_CLIMAX_AT) return 1.12 + 0.16 * ((p - FINALE_BUILD_END) / (FINALE_CLIMAX_AT - FINALE_BUILD_END));
  // Afterglow dips below normal (a real exhale), then settles back to 1x
  // by the end so handing control back doesn't jump.
  const t = (p - FINALE_CLIMAX_AT) / (1 - FINALE_CLIMAX_AT);
  return t < 0.6 ? lerp(1.28, 0.85, t / 0.6) : lerp(0.85, 1, (t - 0.6) / 0.4);
}

function finaleAmbientBoost() {
  const phase = finalePhaseNow();
  if (phase === 'build') return 0.6 * (finaleProgress() / FINALE_BUILD_END);
  if (phase === 'peak') return 1.0;
  return 0;
}

function finaleMantraMult() {
  const phase = finalePhaseNow();
  if (phase === 'build') return 1 + finaleProgress() / FINALE_BUILD_END;
  if (phase === 'peak') return 3;
  if (phase === 'afterglow') return 0.6;
  return 1;
}

function finaleTempoMult() {
  const phase = finalePhaseNow();
  if (phase === 'build') return 1 + 0.15 * (finaleProgress() / FINALE_BUILD_END);
  if (phase === 'peak') return 1.2;
  return 1;
}

function finaleWantsRhythm() {
  const phase = finalePhaseNow();
  return phase === 'build' || phase === 'peak';
}

function finaleStatusText() {
  const phase = finalePhaseNow();
  const pct = Math.round(finaleProgress() * 100);
  const names = { build: 'Building', peak: 'Peak', afterglow: 'Afterglow' };
  return '🎆 Finale · ' + (names[phase] || '') + ' ' + pct + '%';
}

function startFinale() {
  if (finaleActive) return;
  markInteraction();
  hideFinaleOffer();
  finaleActive = true;
  finaleStartedAt = Date.now();
  finaleDurationMs = finaleMinutes * 60000;
  finaleClimaxFired = false;
  finaleLastPhase = null;
  finaleLastPace = null;
  const paceInput = document.getElementById('pace-input');
  finaleSavedPace = paceInput ? parseInt(paceInput.value, 10) : 2;
  finaleSavedFxCount = fxCount;
  toast('🎆 Finale starting - ' + finaleMinutes + ' min');
  mantraBurst(2);
  finaleTick();
  finaleTimer = setInterval(finaleTick, FINALE_TICK_MS);
  updateFinaleUi();
}

function onFinalePhaseChange(phase) {
  if (phase === 'peak') {
    toast('🎆 Finale: Peak');
    maybeTriggerSpiralOverlay();
    // A Surge for the whole peak stretch - the badge and every odds roll
    // that already reads isSurgeActive() pick it up for free.
    surgeExpireAt = Math.max(surgeExpireAt, finaleStartedAt + finaleDurationMs * FINALE_CLIMAX_AT);
    mantraBurst(3);
    fireColorSplashPiece('border');
  } else if (phase === 'afterglow') {
    const theater = document.getElementById('theater-box');
    if (theater) {
      theater.style.setProperty('--afterglow-duration', Math.round(finaleDurationMs * (1 - FINALE_CLIMAX_AT) / 1000) + 's');
      theater.classList.remove('afterglow');
      void theater.offsetWidth;
      theater.classList.add('afterglow');
    }
  }
}

function finaleClimax() {
  finaleClimaxFired = true;
  pendingServerTier = 'mega'; // consumed by resolveTier inside runPayoff
  runPayoff();
  triggerColorRush();
  mantraBurst(5);
  fireRandomTileFx(4);
  playBassDropSound(2);
  awardXp(50);
  toast('🎆 FINALE! +50xp');
}

function finaleTick() {
  if (!finaleActive) return;
  const p = finaleProgress();
  const phase = finalePhaseNow();
  if (phase !== finaleLastPhase) { finaleLastPhase = phase; onFinalePhaseChange(phase); }
  if (p >= FINALE_CLIMAX_AT && !finaleClimaxFired) finaleClimax();
  let barrage, jackpot, novelty, paceIdx, fxTarget;
  if (phase === 'build') {
    const t = p / FINALE_BUILD_END;
    barrage = lerp(0.03, 0.18, t);
    jackpot = lerp(0.06, 0.3, t);
    novelty = lerp(0.25, 0.05, t); // leans into favorites as it builds
    paceIdx = t < 0.4 ? 2 : 1;
    fxTarget = Math.round(lerp(2, 5, t));
  } else if (phase === 'peak') {
    barrage = 0.28;
    jackpot = 0.45;
    novelty = 0.05;
    paceIdx = 0;
    fxTarget = 7;
    if (Math.random() < 0.3) fireColorSplashPiece();
    if (Math.random() < 0.3) fireRandomTileFx(1);
  } else {
    barrage = 0.01;
    jackpot = 0.02;
    novelty = 0.2;
    paceIdx = 3;
    fxTarget = 1;
  }
  if (!overdriveActive) fetch('/api/intensity?barrage=' + barrage.toFixed(3) + '&jackpot=' + jackpot.toFixed(3));
  fetch('/api/novelty?bonus=' + novelty.toFixed(3));
  if (paceIdx !== finaleLastPace) { finaleLastPace = paceIdx; pace(paceIdx, true); }
  if (fxEnabled && fxCount !== fxTarget) setFxCount(fxTarget);
  updateFinaleUi();
  if (p >= 1) endFinale(false);
}

function endFinale(early) {
  if (!finaleActive) return;
  finaleActive = false;
  clearInterval(finaleTimer);
  finaleTimer = null;
  if (fxEnabled && finaleSavedFxCount != null) setFxCount(finaleSavedFxCount);
  if (autopilotEnabled) {
    autopilotLastPace = null; // force its next tick to re-send pace rather than assume it's unchanged
    autopilotTick();
  } else {
    fetch('/api/intensity?reset=1');
    applyVibeDial(vibeDialValue);
    pace(finaleSavedPace, true);
  }
  updateFinaleUi();
  if (!early) onFinaleCompleted();
  showSessionRecap(early ? '🎆 Finale (ended early)' : '🎆 Finale complete');
}

function toggleFinale() {
  if (finaleActive) endFinale(true);
  else startFinale();
}

function setFinaleMinutes(v) {
  finaleMinutes = Math.max(2, Math.min(15, parseInt(v, 10) || 5));
  saveFinalePrefs();
  updateFinaleUi();
}

function toggleFinaleOffer() {
  finaleOfferEnabled = !finaleOfferEnabled;
  saveFinalePrefs();
  updateFinaleUi();
}

function saveFinalePrefs() {
  saveJsonPref('mm_finale', { minutes: finaleMinutes, offer: finaleOfferEnabled });
}

function loadFinalePrefs() {
  const prefs = loadJsonPref('mm_finale', { minutes: 5, offer: true });
  finaleMinutes = Math.max(2, Math.min(15, Number(prefs.minutes) || 5));
  finaleOfferEnabled = !!prefs.offer;
  updateFinaleUi();
}

function updateFinaleUi() {
  const btn = document.getElementById('finale-btn');
  if (btn) {
    btn.innerText = finaleActive ? '⏹ End Finale Now' : '🎆 Start Finale';
    btn.classList.toggle('active', finaleActive);
  }
  const input = document.getElementById('finale-minutes-input');
  if (input) input.value = finaleMinutes;
  const lbl = document.getElementById('l-finale-minutes');
  if (lbl) lbl.innerText = finaleMinutes + ' min';
  setToggleBadge('finale-offer-toggle', finaleOfferEnabled);
  const status = document.getElementById('finale-status');
  if (status) status.innerText = finaleActive ? finaleStatusText() : 'Ready.';
}

// Only offers itself while Auto-Pilot is steering and the session has
// genuinely run long - a suggestion to land the session on a high, not
// a nag. Ignoring it just lets it fade; it won't ask again for a while.
function maybeOfferFinale() {
  if (!finaleOfferEnabled || finaleActive || !autopilotEnabled || document.hidden || anticipationActive) return;
  const now = Date.now();
  if (now - sessionStartedAt < Math.max(FINALE_OFFER_MIN_SESSION_MS, typicalSessionLenMs * 0.8)) return;
  if (now - lastFinaleOfferAt < FINALE_OFFER_COOLDOWN_MS) return;
  lastFinaleOfferAt = now;
  showFinaleOffer();
}
setInterval(maybeOfferFinale, FINALE_OFFER_CHECK_MS);

function showFinaleOffer() {
  const box = document.getElementById('finale-offer-prompt');
  if (!box) return;
  box.style.display = 'flex';
  void box.offsetWidth;
  box.classList.add('show');
  const fill = box.querySelector('.finale-offer-timer-fill');
  if (fill) {
    fill.style.transition = 'none';
    fill.style.width = '100%';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + (FINALE_OFFER_WINDOW_MS / 1000) + 's linear';
    fill.style.width = '0%';
  }
  clearTimeout(finaleOfferTimer);
  finaleOfferTimer = setTimeout(hideFinaleOffer, FINALE_OFFER_WINDOW_MS);
}

function hideFinaleOffer() {
  clearTimeout(finaleOfferTimer);
  const box = document.getElementById('finale-offer-prompt');
  if (!box) return;
  box.classList.remove('show');
  setTimeout(() => { if (!box.classList.contains('show')) box.style.display = 'none'; }, 260);
}

// ---- Session recap ----
const RECAP_AUTO_HIDE_MS = 30000;
let recapHideTimer = null;

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h ? h + 'h ' + m + 'm' : m + 'm';
}

function showSessionRecap(title) {
  const box = document.getElementById('session-recap');
  if (!box) return;
  // Prestiging resets xpTotal to 0 - count from wherever it restarted.
  const xpGained = prestigeCount > sessionPrestigeStart ? xpTotal : Math.max(0, xpTotal - sessionXpStart);
  const rows = [
    ['⏱', 'Session', formatDuration(Date.now() - sessionStartedAt)],
    ['⭐', 'XP earned', '+' + xpGained + ' (LV ' + xpLevel + ')'],
    ['❤️', 'Hearts given', sessionStats.hearts],
    ['🎰', 'Jackpots', sessionStats.jackpots],
    ['🏃', 'Catches', sessionStats.catches + (sessionStats.bestChain ? ' (best chain x' + sessionStats.bestChain + ')' : '')],
    ['✨', 'Bonus taps', sessionStats.bonuses],
    ['🥁', 'Best in-sync run', sessionStats.rhythmBest >= 1000 ? formatRunSeconds(sessionStats.rhythmBest) : '-'],
    ['🆕', 'Fresh drops', sessionStats.freshDrops],
  ];
  document.getElementById('session-recap-title').innerText = title || '📊 Session Recap';
  document.getElementById('session-recap-grid').innerHTML = rows.map(([icon, label, value]) =>
    '<div class="recap-row"><span class="recap-icon">' + icon + '</span><span class="recap-label">' + label + '</span><span class="recap-value">' + value + '</span></div>'
  ).join('');
  box.style.display = 'flex';
  void box.offsetWidth;
  box.classList.add('show');
  clearTimeout(recapHideTimer);
  recapHideTimer = setTimeout(hideSessionRecap, RECAP_AUTO_HIDE_MS);
}

function hideSessionRecap() {
  clearTimeout(recapHideTimer);
  const box = document.getElementById('session-recap');
  if (!box) return;
  box.classList.remove('show');
  setTimeout(() => { if (!box.classList.contains('show')) box.style.display = 'none'; }, 300);
}

// ---- Init ----
// Called from window.onload (dashboard_boot.js), after its own prefs/state
// have loaded (XP in particular, for the recap's starting point).
function initLayers() {
  sessionXpStart = xpTotal;
  sessionPrestigeStart = prestigeCount;
  loadAudioReactPrefs();
  loadMantraPrefs();
  loadFxRewardsPref();
  loadRhythmPrefs();
  loadFreshDropPref();
  loadFinalePrefs();
  startTunableInterval('FRESH_DROP_CHECK_MS', maybeTriggerFreshDrop);
  checkFreshStatus(true);
  setInterval(() => checkFreshStatus(false), 120000);
}
