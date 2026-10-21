// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Shared Pulse (one energy/tempo signal the sensory layers ride together),
// brainwave presets for the binaural beat, and Taste Learning (a gentle lean toward the FX and beat patterns you like).

// ---- Shared Pulse ----
// rhythmDrive (dashboard_layers.js) is the session's energy: engagement,
// build-ups and fresh payoffs, surges, Overdrive and the Auto-Pilot zone,
// glided over a few seconds. With the pulse on, the other layers follow it
// too instead of each keeping its own clock:
//  - spirals (manual + event) play faster/slower with it, and brighten a
//    touch on each downbeat;
//  - the binaural beat frequency rises and settles with it;
//  - floaters and the screen-edge glow get a soft kick on downbeats.
// With Rhythm Mode on the pulse uses its beat clock; otherwise it keeps an
// invisible one at the same tempo (no beat walker, nothing on the tiles).
const PULSE_TICK_MS = 100;
const PULSE_BINAURAL_MIN_HZ = 1;
const PULSE_BINAURAL_MAX_HZ = 16;
let sharedPulseEnabled = true;
let pulseVirtualNextAt = 0;
let pulseVirtualBeat = 0;
let lastSynthParams = null; // the last status-stream synth block, re-applied as the energy moves
let pulseBinauralAppliedAt = 0;
let pulseSpiralsReset = true;

function pulseSpiralRate() {
  let rate = rhythmDrive;
  if (rhythmActive()) rate *= 1 + 0.25 * rhythmWaveFrac();
  return Math.max(TUNING.PULSE_SPIRAL_RATE_MIN, Math.min(TUNING.PULSE_SPIRAL_RATE_MAX, rate));
}

// Multiplier on the binaural beat frequency (called from updateSynthParams).
function pulseBinauralMult() {
  return sharedPulseEnabled ? rhythmDrive : 1;
}

function pulseBinauralHz(synth) {
  const band = brainwaveBand();
  if (band) return band.hz; // a brainwave preset sits exactly on its band - no drift
  return Math.max(PULSE_BINAURAL_MIN_HZ, Math.min(PULSE_BINAURAL_MAX_HZ, synth.beat_hz * pulseBinauralMult()));
}

function spiralLayers() {
  return ['spiral-manual', 'spiral-overlay'].map((id) => document.getElementById(id)).filter(Boolean);
}

// Called on every beat - Rhythm Mode's own (from onRhythmBeat) or the
// virtual one below.
function onPulseBeat(n) {
  if (!sharedPulseEnabled || n % 4 !== 0) return;
  spiralLayers().forEach((el) => {
    if (parseFloat(getComputedStyle(el).opacity) < 0.02 || !el.animate) return;
    el.animate([{ filter: 'brightness(1.3)' }, { filter: 'brightness(1)' }], { duration: 480, easing: 'ease-out' });
  });
  const fx = document.getElementById('fx-layer');
  if (fx && fx.animate && fx.childElementCount) fx.animate([{ filter: 'brightness(1.15)' }, { filter: 'brightness(1)' }], { duration: 420, easing: 'ease-out' });
  if (!rhythmActive()) audioGlowKick = Math.max(audioGlowKick, 0.3); // Rhythm Mode already kicks it harder
}

setInterval(() => {
  if (!rhythmActive()) updateRhythmDrive(); // Rhythm Mode's beat loop drives it while that's on
  if (!sharedPulseEnabled) {
    if (!pulseSpiralsReset) { spiralLayers().forEach((el) => { el.playbackRate = 1; }); pulseSpiralsReset = true; }
    return;
  }
  pulseSpiralsReset = false;
  const rate = pulseSpiralRate();
  // Re-applied every tick: loading a new src resets playbackRate to 1.
  spiralLayers().forEach((el) => { if (Math.abs(el.playbackRate - rate) > 0.01) el.playbackRate = rate; });
  const now = Date.now();
  if (lastSynthParams && now - pulseBinauralAppliedAt > 500) {
    pulseBinauralAppliedAt = now;
    updateSynthParams(lastSynthParams);
  }
  if (!rhythmActive()) {
    const t = performance.now();
    if (t >= pulseVirtualNextAt) {
      onPulseBeat(pulseVirtualBeat++);
      pulseVirtualNextAt = t + 60000 / (rhythmEffectiveBaseBpm() * rhythmDrive);
    }
  }
}, PULSE_TICK_MS);

function loadPulsePrefs() {
  sharedPulseEnabled = loadJsonPref('mm_pulse', { enabled: true }).enabled !== false;
  updatePulseUi();
}

function toggleSharedPulse() {
  sharedPulseEnabled = !sharedPulseEnabled;
  saveJsonPref('mm_pulse', { enabled: sharedPulseEnabled });
  if (lastSynthParams) updateSynthParams(lastSynthParams);
  updatePulseUi();
}

function updatePulseUi() {
  setToggleBadge('pulse-toggle', sharedPulseEnabled);
  const el = document.getElementById('pulse-status');
  if (!el) return;
  if (!sharedPulseEnabled) { el.innerText = 'Off - spirals, binaural and glow each keep their own pace.'; return; }
  const hz = lastSynthParams ? ' · binaural ' + pulseBinauralHz(lastSynthParams).toFixed(1) + ' Hz' : '';
  el.innerText = 'Energy ×' + rhythmDrive.toFixed(2) + ' · spirals ×' + pulseSpiralRate().toFixed(2) + hz;
}
setInterval(updatePulseUi, 1000);

// ---- Brainwave presets ----
// The binaural beat locked to a specific brainwave frequency instead of
// wandering with the beat slider, clip tension and the Shared Pulse (which
// lands it between bands - "off key"). 'free' keeps the old behaviour.
// 'mood' picks Theta / Alpha / Beta from the zone and energy, only after a
// mood has held for BRAINWAVE_MOOD_HOLD_MS, glides across, then sits exactly
// on the new frequency.
const BRAINWAVE_BANDS = {
  delta: { label: 'Delta', hz: 2.5, desc: 'deep' },
  theta: { label: 'Theta', hz: 6, desc: 'dreamy, trance' },
  alpha: { label: 'Alpha', hz: 10, desc: 'relaxed flow' },
  beta: { label: 'Beta', hz: 15, desc: 'alert, energised' },
  gamma: { label: 'Gamma', hz: 40, desc: 'peak' },
};
const BRAINWAVE_MOOD_HOLD_MS = 15000;
const BRAINWAVE_GLIDE_TAU_S = 2.5; // ~7s to settle on a new band
let brainwaveMode = 'theta'; // 'free' | 'mood' | a band key
let brainwaveMoodBand = 'alpha';
let brainwaveMoodCandidate = null;
let brainwaveMoodCandidateAt = 0;

function brainwaveMoodTarget() {
  if (floaterBarrageActive || autopilotZone === 'vault' || rhythmDrive < 0.95) return 'theta';
  if (rhythmDrive > 1.18 || autopilotZone === 'jackpot' || autopilotZone === 'chase') return 'beta';
  return 'alpha';
}

setInterval(() => {
  if (brainwaveMode !== 'mood') return;
  const want = brainwaveMoodTarget();
  const now = Date.now();
  if (want === brainwaveMoodBand) { brainwaveMoodCandidate = null; return; }
  if (want !== brainwaveMoodCandidate) { brainwaveMoodCandidate = want; brainwaveMoodCandidateAt = now; return; }
  if (now - brainwaveMoodCandidateAt >= BRAINWAVE_MOOD_HOLD_MS) {
    brainwaveMoodBand = want;
    brainwaveMoodCandidate = null;
    if (lastSynthParams) updateSynthParams(lastSynthParams);
  }
}, 1000);

// The band in effect right now, or null in free mode.
function brainwaveBand() {
  if (brainwaveMode === 'free') return null;
  if (typeof breathBandUntil !== 'undefined' && Date.now() < breathBandUntil) return BRAINWAVE_BANDS.theta; // a Breath moment settles to Theta
  return BRAINWAVE_BANDS[brainwaveMode === 'mood' ? brainwaveMoodBand : brainwaveMode] || null;
}

function setBrainwaveMode(mode) {
  brainwaveMode = mode === 'free' || mode === 'mood' || BRAINWAVE_BANDS[mode] ? mode : 'free';
  if (brainwaveMode === 'mood') { brainwaveMoodBand = brainwaveMoodTarget(); brainwaveMoodCandidate = null; }
  saveJsonPref('mm_brainwave', { mode: brainwaveMode });
  if (lastSynthParams) updateSynthParams(lastSynthParams);
  updateBrainwaveUi();
}

function loadBrainwavePrefs() {
  const p = loadJsonPref('mm_brainwave', { mode: 'theta' });
  brainwaveMode = p.mode === 'mood' || BRAINWAVE_BANDS[p.mode] ? p.mode : 'free';
  if (brainwaveMode === 'mood') brainwaveMoodBand = brainwaveMoodTarget();
  updateBrainwaveUi();
}

function updateBrainwaveUi() {
  ['free', 'mood'].concat(Object.keys(BRAINWAVE_BANDS)).forEach((m) => {
    const b = document.getElementById('brainwave-' + m);
    if (b) b.classList.toggle('active', brainwaveMode === m);
  });
  const el = document.getElementById('brainwave-status');
  if (!el) return;
  const band = brainwaveBand();
  el.innerText = band
    ? band.label + ' · ' + band.hz + ' Hz exactly (' + band.desc + ')' + (brainwaveMode === 'mood' ? ' - following the mood' + (brainwaveMoodCandidate ? ', heading to ' + BRAINWAVE_BANDS[brainwaveMoodCandidate].label : '') : '')
    : 'Free - the beat follows the slider, clip tension and the Shared Pulse.';
}
setInterval(updateBrainwaveUi, 1000);

// ---- Taste Learning ----
// Counts likes while each tile FX / beat pattern is showing against how long
// it was on screen (tile-time), compared with your overall like rate, and
// nudges the random picks toward what you like. Deliberately gentle:
//  - weight = lift ^ strength, strength 25% by default (a 3x favourite gets
//    picked ~1.3x as often, a 0.5x one ~0.84x) - variety stays;
//  - the lean doubles while engagement is low ("when it needs it");
//  - a few pseudo-likes pull every lift toward 1 until there's real data;
//  - everything learned decays 15% per page load, so recent taste counts most.
const TASTE_KEY = 'mm_taste';
const TASTE_LIFT_RANGE = [0.33, 3];
let tasteStrength = 0.25;
let taste = { fx: {}, pattern: {}, base: { likes: 0, ms: 0 }, rhythmBase: { likes: 0, ms: 0 } };
const tasteTileFx = {}; // tile idx -> { kind, until }

function tasteEntry(group, key) {
  if (!taste[group][key]) taste[group][key] = { likes: 0, ms: 0 };
  return taste[group][key];
}

function loadTastePrefs() {
  const saved = loadJsonPref(TASTE_KEY, null);
  if (saved && saved.fx && saved.pattern && saved.base) {
    taste = Object.assign(taste, saved);
    if (!taste.rhythmBase) taste.rhythmBase = { likes: 0, ms: 0 };
    const decay = (e) => { e.likes *= TUNING.TASTE_LOAD_DECAY; e.ms *= TUNING.TASTE_LOAD_DECAY; };
    [taste.base, taste.rhythmBase].forEach(decay);
    ['fx', 'pattern'].forEach((g) => Object.values(taste[g]).forEach(decay));
  }
  const s = Number(loadJsonPref('mm_taste_strength', 0.25));
  tasteStrength = Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : 0.25;
  saveTaste();
  sendTasteStrength();
  loadDnaTaste();
  updateTasteUi();
}

function saveTaste() { saveJsonPref(TASTE_KEY, taste); }

function tasteNoteFx(idx, kind, ms) {
  tasteTileFx[idx] = { kind, until: Date.now() + ms };
  tasteEntry('fx', kind).ms += ms;
}

function tasteNoteLike(idx) {
  taste.base.likes++;
  const fx = tasteTileFx[idx];
  if (fx && fx.until > Date.now()) tasteEntry('fx', fx.kind).likes++;
  if (rhythmActive()) { taste.rhythmBase.likes++; tasteEntry('pattern', rhythmPattern).likes++; }
}

// Exposure clock: tile-time on screen, overall and per beat pattern.
setInterval(() => {
  if (document.hidden || !tileElements.length) return;
  const tileMs = tileElements.length * 1000;
  taste.base.ms += tileMs;
  if (rhythmActive()) { taste.rhythmBase.ms += tileMs; tasteEntry('pattern', rhythmPattern).ms += tileMs; }
}, 1000);
setInterval(saveTaste, 10000);
addEventListener('pagehide', saveTaste);

function tasteLift(group, key) {
  const e = taste[group][key];
  const base = group === 'pattern' ? taste.rhythmBase : taste.base;
  if (!e || !base.ms || !base.likes) return 1;
  const expected = e.ms * (base.likes / base.ms);
  const lift = (e.likes + TUNING.TASTE_PRIOR_LIKES) / (expected + TUNING.TASTE_PRIOR_LIKES);
  return Math.max(TASTE_LIFT_RANGE[0], Math.min(TASTE_LIFT_RANGE[1], lift));
}

function tasteWeight(group, key) {
  if (tasteStrength <= 0) return 1;
  const strength = Math.min(1, tasteStrength * (readEngagement() < TUNING.TASTE_LOW_ENGAGEMENT ? 2 : 1));
  return Math.pow(tasteLift(group, key), strength);
}

function weightedPick(items, weightOf) {
  const weights = items.map(weightOf);
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { roll -= weights[i]; if (roll <= 0) return items[i]; }
  return items[items.length - 1];
}

function setTasteStrength(v) {
  tasteStrength = Math.max(0, Math.min(1, parseInt(v, 10) / 100));
  saveJsonPref('mm_taste_strength', tasteStrength);
  sendTasteStrength();
  updateTasteUi();
}

// The engine leans its clip picks by Clip DNA traits at the same strength.
function sendTasteStrength() { fetch('/api/taste?s=' + tasteStrength.toFixed(2)).catch(() => {}); }

let dnaTasteText = '';
function loadDnaTaste() {
  fetch('/api/dna/taste').then((r) => r.json()).then((d) => {
    if (!d.ready) { dnaTasteText = 'Clips: still analysing'; return; }
    const parts = [];
    Object.values(d.traits).forEach((t) => t.lifts.forEach((lift, k) => {
      if (k !== 1 && Math.abs(lift - 1) >= 0.08) parts.push([t.labels[k], lift]);
    }));
    parts.sort((a, b) => Math.abs(Math.log(b[1])) - Math.abs(Math.log(a[1])));
    dnaTasteText = 'Clips you heart most per play: ' + (parts.map(([l, x]) => l + ' x' + x.toFixed(2)).join(' · ') || 'no strong lean');
    updateTasteUi();
  }).catch(() => {});
}
setInterval(loadDnaTaste, 600000);

function resetTaste() {
  taste = { fx: {}, pattern: {}, base: { likes: 0, ms: 0 }, rhythmBase: { likes: 0, ms: 0 } };
  saveTaste();
  updateTasteUi();
  toast('🧠 Taste Learning reset');
}

function updateTasteUi() {
  const input = document.getElementById('taste-strength-input');
  if (input) input.value = Math.round(tasteStrength * 100);
  const lbl = document.getElementById('l-taste-strength');
  if (lbl) lbl.innerText = tasteStrength <= 0 ? 'Off' : Math.round(tasteStrength * 100) + '%';
  const el = document.getElementById('taste-status');
  if (!el) return;
  const describe = (group, names, labelOf) => names
    .map((k) => [k, tasteWeight(group, k)])
    .filter(([, w]) => Math.abs(w - 1) >= 0.03)
    .sort((a, b) => b[1] - a[1])
    .map(([k, w]) => labelOf(k) + ' ×' + w.toFixed(2))
    .join(' · ');
  const fx = describe('fx', TILE_FX_NAMES.filter((k) => k !== 'shock'), (k) => TILE_FX_KINDS[k].label);
  const pat = describe('pattern', RHYTHM_PATTERN_NAMES, (k) => RHYTHM_PATTERNS[k].label);
  el.innerText = (taste.base.likes < 10 ? 'Still learning - ' + Math.round(taste.base.likes) + ' likes so far.\n' : '')
    + 'Tile FX: ' + (fx || 'no lean yet') + '\nBeat patterns: ' + (pat || 'no lean yet') + (dnaTasteText ? '\n' + dnaTasteText : '');
}
setInterval(updateTasteUi, 5000);
