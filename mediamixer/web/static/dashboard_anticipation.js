// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Build-ups, near-misses, payoff SFX, jackpot tier tables, color themes and the due-for-a-rating aura.

// ---- Anticipation / near-miss / payoff FX (experimental) ----
// "Honest" build-up: the server already tells every viewer how many barrage
// steps are left (d.barrage) before it resolves into a real jackpot - we
// just watch that count tick down and ramp a tension cue timed to peak
// around when it lands, then fire a real payoff when d.jackpot flips on.
// "Fake" near-miss: the same build-up cue, triggered by a random client-side
// timer with nothing real behind it, left to fizzle instead of pay off.
// Both are purely visual/audio flourish layered on the existing barrage/
// jackpot mechanic - nothing here changes what actually gets selected.
const FAKE_NEAR_MISS_CHECK_MS = 15000;
const FAKE_NEAR_MISS_PROBABILITY = 0.25;
const FAKE_NEAR_MISS_BUILD_S = 3.5;
const HONEST_BUILD_SAFETY_MS = 6000; // auto-fizzle if a real payoff never arrives (shouldn't normally fire)

let anticipationFxEnabled = true;
let nearMissEnabled = true;
let sfxVolume = 70;
let sfxGain = null;
let anticipationActive = false;
let anticipationRunId = 0;
let lastKnownBarrage = 0;
let lastKnownBarrageTiles = [];
let lastKnownJackpot = false;

function loadAnticipationPrefs() {
  try {
    const en = localStorage.getItem('mm_anticipation_enabled');
    const nm = localStorage.getItem('mm_near_miss_enabled');
    const vol = localStorage.getItem('mm_sfx_vol');
    if (en !== null) anticipationFxEnabled = en === '1';
    if (nm !== null) nearMissEnabled = nm === '1';
    if (vol !== null) sfxVolume = parseInt(vol, 10);
  } catch (e) {}
  document.getElementById('anticipation-toggle').innerText = anticipationFxEnabled ? 'ON' : 'OFF';
  document.getElementById('anticipation-toggle').classList.toggle('active', anticipationFxEnabled);
  document.getElementById('near-miss-toggle').innerText = nearMissEnabled ? 'ON' : 'OFF';
  document.getElementById('near-miss-toggle').classList.toggle('active', nearMissEnabled);
  document.getElementById('sfx-vol-input').value = sfxVolume;
  document.getElementById('l-sfx-vol').innerText = sfxVolume + '%';
}

function toggleAnticipationFx() {
  anticipationFxEnabled = !anticipationFxEnabled;
  try { localStorage.setItem('mm_anticipation_enabled', anticipationFxEnabled ? '1' : '0'); } catch (e) {}
  document.getElementById('anticipation-toggle').innerText = anticipationFxEnabled ? 'ON' : 'OFF';
  document.getElementById('anticipation-toggle').classList.toggle('active', anticipationFxEnabled);
}

function toggleNearMiss() {
  nearMissEnabled = !nearMissEnabled;
  try { localStorage.setItem('mm_near_miss_enabled', nearMissEnabled ? '1' : '0'); } catch (e) {}
  document.getElementById('near-miss-toggle').innerText = nearMissEnabled ? 'ON' : 'OFF';
  document.getElementById('near-miss-toggle').classList.toggle('active', nearMissEnabled);
}

function setSfxVolume(v) {
  sfxVolume = parseInt(v, 10);
  document.getElementById('l-sfx-vol').innerText = sfxVolume + '%';
  try { localStorage.setItem('mm_sfx_vol', sfxVolume); } catch (e) {}
  if (sfxGain) sfxGain.gain.setTargetAtTime(sfxVolume / 100, audioCtx.currentTime, 0.05);
}

function ensureSfxBus() {
  if (!audioCtx) return null;
  if (!sfxGain) {
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = sfxVolume / 100;
    sfxGain.connect(audioCtx.destination);
  }
  return sfxGain;
}

let reverbImpulseBuffer = null;
let reverbSendGain = null;

function getReverbImpulse() {
  if (reverbImpulseBuffer) return reverbImpulseBuffer;
  // Synthesized impulse response (exponentially-decaying noise) - no audio
  // asset needed, consistent with every other sound in this file.
  const len = Math.ceil(audioCtx.sampleRate * 2.2);
  const buffer = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  reverbImpulseBuffer = buffer;
  return buffer;
}

function ensureReverbSend() {
  const bus = ensureSfxBus();
  if (!bus) return null;
  if (!reverbSendGain) {
    const convolver = audioCtx.createConvolver();
    convolver.buffer = getReverbImpulse();
    reverbSendGain = audioCtx.createGain();
    reverbSendGain.gain.value = 0.55;
    reverbSendGain.connect(convolver);
    convolver.connect(bus);
  }
  return reverbSendGain;
}

function playRiserSound(durationS) {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const tail = durationS + 0.35;

  // Pan the riser across the stereo field, speeding up as it builds (same
  // trick film sound design uses to pull attention) - routed in front of
  // the bus so both layers below move together.
  const panner = audioCtx.createStereoPanner();
  panner.connect(bus);
  const panLfo = audioCtx.createOscillator();
  panLfo.type = 'sine';
  const panLfoGain = audioCtx.createGain();
  panLfoGain.gain.value = 0.85;
  panLfo.connect(panLfoGain);
  panLfoGain.connect(panner.pan);
  panLfo.frequency.setValueAtTime(0.3, now);
  panLfo.frequency.exponentialRampToValueAtTime(3.2, now + durationS);
  panLfo.start(now);
  panLfo.stop(now + tail);

  // Main body: filtered noise that starts muffled and quiet, then opens up
  // in brightness and volume as it builds - the standard "cinematic riser"
  // technique. A raw sawtooth/square tone sweep is harmonic-rich and reads
  // as a buzzy drone (a "bee in your ear") when sustained for a few
  // seconds; filtered noise builds the same sense of rising tension
  // without that buzz.
  const bufferSize = Math.ceil(audioCtx.sampleRate * tail);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(200, now);
  filter.frequency.exponentialRampToValueAtTime(3200, now + durationS);

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.18, now + durationS * 0.9);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
  noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(panner);

  // Soft sine undertone: adds a sense of pitch rising without the harmonics
  // a sawtooth/square would add.
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(260, now + durationS);
  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.0001, now);
  oscGain.gain.exponentialRampToValueAtTime(0.09, now + durationS * 0.85);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
  osc.connect(oscGain); oscGain.connect(panner);

  noise.start(now); noise.stop(now + tail);
  osc.start(now); osc.stop(now + tail);

  scheduleHeartbeat(durationS);
}

function scheduleHeartbeat(durationS) {
  // A low rhythmic thump that speeds up through the build-up - the
  // thriller-score trick for perceived urgency, distinct from the riser's
  // continuous pitch/brightness sweep. Scheduled all at once up front using
  // precise Web Audio timestamps (accurate; a setTimeout loop would drift).
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const minInterval = 0.14;
  const maxInterval = 0.62;
  let t = 0;
  while (t < durationS) {
    const frac = t / durationS;
    playHeartbeatThump(now + t);
    const interval = maxInterval - (maxInterval - minInterval) * (frac * frac);
    t += interval;
  }
}

function playHeartbeatThump(startTime) {
  const bus = ensureSfxBus();
  if (!bus) return;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(70, startTime);
  g.gain.setValueAtTime(0.0001, startTime);
  g.gain.exponentialRampToValueAtTime(0.16, startTime + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);
  osc.start(startTime);
  osc.stop(startTime + 0.15);
}

function playFizzleSound() {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(480, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.5);
  g.gain.setValueAtTime(0.22, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.start(now);
  osc.stop(now + 0.6);
}

function playChimeSound(scale, pitch) {
  const bus = ensureSfxBus();
  if (!bus) return;
  scale = scale || 1.0;
  pitch = pitch || 1.0; // slight upward creep for chase-catch streaks - see catchChaseFlash
  const now = audioCtx.currentTime;
  const notes = scale >= 1.3
    ? [523.25, 659.25, 783.99, 1046.5, 1318.5] // mega gets a fifth, higher note
    : [523.25, 659.25, 783.99, 1046.5];
  const reverbSend = scale >= 1.3 ? ensureReverbSend() : null; // mega only: richer, more "epic" tail
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(bus);
    if (reverbSend) g.connect(reverbSend);
    const t0 = now + i * 0.09;
    osc.frequency.setValueAtTime(freq * pitch, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.min(0.45, 0.255 * scale), t0 + 0.02); // base is already 15% quieter
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.start(t0);
    osc.stop(t0 + 0.55);
  });
}

// A short, distinct two-note blip (square wave, not the chime's triangle)
// layered on top of the normal payoff when a jackpot lands right inside
// the streak-reset warning window - a "just made it" cue, not a bigger one.
function playClutchSting() {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  [880, 1174.66].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(bus);
    const t0 = now + i * 0.07;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  });
}

function playBassDropSound(scale) {
  const bus = ensureSfxBus();
  if (!bus) return;
  scale = scale || 1.0;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(42, now + 0.25); // fast pitch drop - the "thump"
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.min(0.85, 0.5 * scale), now + 0.02); // fast attack, felt more than heard
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.start(now);
  osc.stop(now + 0.6);
}

function pickRandomTiles() {
  if (!tileElements.length) return [];
  const count = tileElements.length >= 2 && Math.random() < 0.5 ? 2 : 1;
  const indices = [];
  while (indices.length < count && indices.length < tileElements.length) {
    const idx = Math.floor(Math.random() * tileElements.length);
    if (!indices.includes(idx)) indices.push(idx);
  }
  return indices;
}

function runAnticipationBuildUp(durationS, isReal, weightedTiles, tierName) {
  if (!anticipationFxEnabled) return;
  anticipationActive = true;
  const runId = ++anticipationRunId;
  const theater = document.getElementById('theater-box');
  const theaterGlow = document.getElementById('theater-glow');
  teaseNextTheme(theater);
  // A running CSS animation on opacity/border-color wins out over this
  // loop's own inline style writes to the same element until it ends -
  // clear any ambient color-breathe in progress so it can't fight with
  // the real build-up's glow on whichever tile it happened to land on.
  tileGlowEls.forEach(el => { if (el) el.classList.remove('ambient-breath'); });
  // Variable build-up length: the shape of the tension, not just whether
  // it resolves, is part of the uncertainty. Purely a visual/audio pacing
  // change - a real jackpot's actual timing is still driven by the status
  // stream, not by this duration.
  const variedDuration = durationS * (0.7 + Math.random() * 0.9);
  playRiserSound(variedDuration);
  const start = performance.now();
  // Real barrages pass the server's actual list of screens about to get
  // new content (so the glow highlights tiles that are really about to
  // change); fake near-misses have no such list, so pick 1-2 at random
  // purely for the "something's choosing" feeling - nothing behind it.
  if (!weightedTiles) weightedTiles = pickRandomTiles();
  // Every real barrage (not just mega) dims the screens that aren't
  // actually part of it, so attention goes to the ones that are really
  // about to change - previously only mega got this, so a small/medium
  // barrage's untouched screens had no visual distinction from the
  // selected ones at all (and, combined with every screen getting a
  // speed-up target, read as "the rest of the grid is stuttering/
  // loading" rather than "these specific tiles are the showcased ones").
  // A plain opacity overlay (see .tile-dimmed), never filter/brightness
  // on the video itself.
  if (isReal && weightedTiles.length) {
    tileElements.forEach((tile, idx) => {
      if (tile && !weightedTiles.includes(idx)) startBarrageDim(tile);
    });
  }

  function tick() {
    if (runId !== anticipationRunId) return;
    const elapsed = (performance.now() - start) / 1000;
    const progress = Math.min(1, elapsed / variedDuration);
    const intensity = progress * progress; // ease-in: stays subtle, then ramps hard near the end
    const freq = 2 + intensity * 10;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * freq);
    // Glow is driven entirely through opacity on dedicated overlay divs
    // (never box-shadow/filter on the theater or tile/video elements
    // themselves) so this per-frame loop only ever touches a
    // compositor-only property - it doesn't force paint and so doesn't
    // compete with video decode, no matter how many tiles are on screen.
    if (theaterGlow) theaterGlow.style.opacity = Math.min(1, (0.15 + intensity * 0.65) * (0.6 + 0.4 * pulse)).toFixed(2);
    // Smooth, slow-sine glow on every tile (not a flicker/strobe - frequency
    // here tops out around 7Hz and the transition is a continuous sine, well
    // outside the 3-30Hz flash range that can trigger photosensitive seizures)
    // so the eye is drawn to the grid without any rapid on/off flashing.
    const tileGlowAlpha = (0.15 + intensity * 0.5) * (0.65 + 0.35 * pulse);
    tileGlowEls.forEach((el, idx) => {
      if (!el) return;
      const weightedFade = weightedTiles.includes(idx) ? (1 - intensity) : 0;
      el.style.opacity = Math.min(1, tileGlowAlpha + weightedFade * 0.4).toFixed(2);
    });
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else if (!isReal) {
      fizzleAnticipation(runId);
    } else {
      // Peak reached before the real jackpot landed yet - hold, then a safety
      // net in case the expected payoff status update never arrives.
      setTimeout(() => fizzleAnticipation(runId), HONEST_BUILD_SAFETY_MS);
    }
  }
  requestAnimationFrame(tick);
}

function clearTileGlow() {
  tileGlowEls.forEach(el => { if (el) el.style.opacity = '0'; });
  tileElements.forEach(tile => { if (tile) endBarrageDim(tile); });
}

// ---- Fadeable overlay helper ----
// Shared by every "dim overlay that needs independent fade-in/fade-out
// timing" mechanic (the barrage non-selected dim here, and the sealed-
// tile lock dim below) - previously each hand-rolled its own copy of
// the same technique. The ::after's opacity is driven by a custom
// property rather than the class itself, so the class can stay in place
// for the whole fade (entering AND leaving) instead of a toggle that
// would kill the element - and its CSS transition - the instant it's
// removed. The forced reflow (offsetWidth read) between setting the
// starting opacity and the real target is what makes the fade-IN work
// too: without it, both writes would land in the same style
// recalculation and the browser would never see the 0-opacity starting
// point to animate away from.
//
// Not used by due-aura's own exit fade - that one has a continuous
// breathing pulse running at the same time, which needs its own
// calc()-of-two-properties approach (see startDueAuraExitFade) since a
// single opacity property can't be independently driven by both a
// pulse animation and a one-off fade at once.
function startFadeableOverlay(el, className, propPrefix, targetOpacity, fadeMs) {
  if (!el) return;
  if (!el.classList.contains(className)) {
    el.style.setProperty('--' + propPrefix + '-opacity', '0');
    el.style.setProperty('--' + propPrefix + '-fade-ms', '0ms');
    el.classList.add(className);
    void el.offsetWidth;
  }
  el.style.setProperty('--' + propPrefix + '-fade-ms', fadeMs + 'ms');
  el.style.setProperty('--' + propPrefix + '-opacity', String(targetOpacity));
}

function endFadeableOverlay(el, className, propPrefix, fadeMs) {
  if (!el || !el.classList.contains(className)) return;
  el.style.setProperty('--' + propPrefix + '-fade-ms', fadeMs + 'ms');
  el.style.setProperty('--' + propPrefix + '-opacity', '0');
  setTimeout(() => {
    el.classList.remove(className);
    el.style.removeProperty('--' + propPrefix + '-opacity');
    el.style.removeProperty('--' + propPrefix + '-fade-ms');
  }, fadeMs);
}

// While a Spotlight is up it owns the dim: the spotlit tile is never
// dimmed, and the others stay dimmed until the Spotlight itself ends.
function startBarrageDim(tile) {
  if (spotlightTileIndex >= 0 && tile === tileElements[spotlightTileIndex]) return;
  startFadeableOverlay(tile, 'tile-dimmed', 'dim', TUNING.BARRAGE_DIM_OPACITY, TUNING.BARRAGE_DIM_FADE_IN_MS);
}

function endBarrageDim(tile) {
  if (spotlightTileIndex >= 0 && tile !== tileElements[spotlightTileIndex]) return;
  endFadeableOverlay(tile, 'tile-dimmed', 'dim', TUNING.BARRAGE_DIM_FADE_OUT_MS);
}

function fizzleAnticipation(runId) {
  if (runId !== anticipationRunId || !anticipationActive) return;
  const theater = document.getElementById('theater-box');
  const theaterGlow = document.getElementById('theater-glow');
  if (theaterGlow) { theaterGlow.style.transition = 'opacity 0.6s ease'; theaterGlow.style.opacity = '0'; }
  clearTileGlow();
  theater.classList.add('glitch');
  playFizzleSound();
  setTimeout(() => {
    theater.classList.remove('glitch');
    if (theaterGlow) theaterGlow.style.transition = '';
    anticipationActive = false;
  }, 650);
}

// Jackpot tiers: magnitude is uncertain too, not just timing - bigger tiers
// get a brighter flash, a fuller chime, more bass, a bigger floater burst,
// and (mega only) a brief screen shake. Picked client-side purely for the
// celebration's scale; doesn't affect what actually gets selected.
const JACKPOT_TIERS = [
  { name: 'small', weight: 65, flash: 1.0, chime: 1.0, burst: 1.0, bass: 1.0, shake: false },
  { name: 'medium', weight: 28, flash: 1.3, chime: 1.15, burst: 1.6, bass: 1.25, shake: false },
  { name: 'mega', weight: 7, flash: 1.7, chime: 1.3, burst: 2.4, bass: 1.6, shake: true },
];
const MILESTONE_TIER = { name: 'milestone', flash: 2.2, chime: 1.5, burst: 3.5, bass: 2.0, shake: true };
const MILESTONE_COUNTS = [5, 10, 25, 50, 100, 200, 500, 1000];
const STREAK_RESET_MS = 180000; // 3 minutes without a jackpot resets the streak back to 0
const STREAK_WARNING_S = 30; // show the "at risk" countdown in the last 30s before that reset
const TIER_REVEAL_DELAYS = [70, 70, 80, 90, 110, 140, 180, 230, 320]; // speeds up then settles, like a reel stopping
const TIER_LABELS = { small: 'JACKPOT', medium: 'BIG JACKPOT', mega: 'MEGA JACKPOT', milestone: 'MILESTONE' };

// Rotating color themes: each real jackpot shifts the palette for the next
// build-up/payoff cycle. Partly "craft and variety" (keeps a long session
// feeling fresh), partly functional - identical repeated stimuli habituate
// the reward response, so novelty here also keeps the payoff itself from
// going stale.
const COLOR_THEMES = [
  { glow: '255,70,30', flash: '255,220,120', after: '255,190,100' }, // ember
  { glow: '190,60,255', flash: '220,160,255', after: '200,140,255' }, // violet
  { glow: '40,220,130', flash: '160,255,200', after: '120,255,180' }, // emerald
  { glow: '40,140,255', flash: '160,210,255', after: '120,190,255' }, // azure
  { glow: '255,60,110', flash: '255,170,200', after: '255,150,190' }, // rose
];
let colorThemeIndex = 0;

function applyColorTheme(idx) {
  const theme = COLOR_THEMES[((idx % COLOR_THEMES.length) + COLOR_THEMES.length) % COLOR_THEMES.length];
  const root = document.documentElement.style;
  root.setProperty('--theme-glow', theme.glow);
  root.setProperty('--theme-flash', theme.flash);
  root.setProperty('--theme-after', theme.after);
}

function rotateColorTheme() {
  colorThemeIndex++;
  applyColorTheme(colorThemeIndex);
}

// Flash-forward teaser: a sub-second glimpse of the *next* theme in the
// rotation, right as a build-up starts - like a coming-attractions sting.
// Safe to overwrite --theme-flash here: a real payoff always calls
// rotateColorTheme() -> applyColorTheme() before using it, which resets it.
function teaseNextTheme(theater) {
  const preview = COLOR_THEMES[(colorThemeIndex + 1) % COLOR_THEMES.length];
  theater.style.setProperty('--theme-flash', preview.flash);
  theater.classList.add('theme-teaser');
  setTimeout(() => theater.classList.remove('theme-teaser'), 150);
}

// Always-on anticipation meter: a persistent charge bar that fills up the
// longer it's been since the last jackpot, instead of tension only
// becoming visible once a barrage is already underway. Purely a feeling -
// it doesn't change real odds - but it ticks faster during Golden
// Hour/Surge/combo since those *do* raise real odds, so it stays honest
// about when things are actually hotter.
const ANTICIPATION_METER_FULL_MS = 90000;
let lastAnyPayoffAt = 0;

function tickAnticipationMeter() {
  const fill = document.getElementById('anticipation-meter-fill');
  if (!fill) return;
  const effectiveElapsed = (Date.now() - lastAnyPayoffAt) * oddsMultiplier();
  const pct = Math.min(100, (effectiveElapsed / ANTICIPATION_METER_FULL_MS) * 100);
  fill.style.width = pct + '%';
}

// "Due" tile aura: tiles that haven't been rated in a while get a faint,
// slow pulsing aura - leans into the (not literally true) sense that a
// quiet tile is "due," drawing the eye back to it. Once a tile is picked,
// it holds that spot for at least TUNING.DUE_AURA_MIN_HOLD_MS before
// another tile is allowed to take over - without this, recomputing "most
// idle" fresh every single tick could hand the glow to a different tile
// before you'd even gotten to the one it was just on, which read as
// chasing a moving target around the screen rather than something you
// could actually act on.
let tileLastRatedAt = {};

let dueAuraTileIndex = -1;
let dueAuraSetAt = 0;
let dueAuraExitTimers = {};

// Instead of just removing the class (which killed the glow in the same
// frame it moved on - reported as "hopping... instantly" - and also
// didn't cover the "I rated it, why's it still glowing" gap below), this
// drives --due-exit-mult to 0 while the class (and its pulse/hue
// animations) stay in place, only actually removing the class once the
// transition has had time to finish.
function startDueAuraExitFade(idx) {
  const el = tileAmbientEls[idx];
  if (!el || !el.classList.contains('due-aura')) return;
  el.style.setProperty('--due-exit-fade-ms', TUNING.DUE_AURA_EXIT_FADE_MS + 'ms');
  el.style.setProperty('--due-exit-mult', '0');
  clearTimeout(dueAuraExitTimers[idx]);
  dueAuraExitTimers[idx] = setTimeout(() => {
    el.classList.remove('due-aura');
    el.style.removeProperty('--due-exit-mult');
    el.style.removeProperty('--due-exit-fade-ms');
  }, TUNING.DUE_AURA_EXIT_FADE_MS);
}

function tickDueAura() {
  // Only ever the single most-idle tile, not every tile past the threshold -
  // an infinite box-shadow animation on every tile in the grid at once was
  // heavy enough to visibly stall video playback across the whole screen.
  const now = Date.now();
  let mostIdleTile = -1;
  let mostIdleMs = TUNING.DUE_AURA_THRESHOLD_MS;
  tileElements.forEach((tile, i) => {
    if (!tile) return;
    const idleMs = now - (tileLastRatedAt[i] || sessionStartedAt);
    if (idleMs > mostIdleMs) {
      mostIdleMs = idleMs;
      mostIdleTile = i;
    }
  });

  if (dueAuraTileIndex >= 0 && mostIdleTile !== dueAuraTileIndex) {
    const currentIdleMs = now - (tileLastRatedAt[dueAuraTileIndex] || sessionStartedAt);
    const currentStillQualifies = currentIdleMs > TUNING.DUE_AURA_THRESHOLD_MS;
    if (currentStillQualifies && now - dueAuraSetAt < TUNING.DUE_AURA_MIN_HOLD_MS) {
      mostIdleTile = dueAuraTileIndex; // not time to hand it off yet
    }
  }

  if (mostIdleTile !== dueAuraTileIndex) {
    if (dueAuraTileIndex >= 0) startDueAuraExitFade(dueAuraTileIndex);
    dueAuraSetAt = now;
    dueAuraTileIndex = mostIdleTile;
    if (mostIdleTile >= 0) {
      const el = tileAmbientEls[mostIdleTile];
      if (el) el.classList.add('due-aura');
    }
  }
}

// Tapping a due-aura tile acknowledges it without forcing an actual
// up/down rating - sometimes you just don't feel strongly either way,
// and being nagged with no "leave me alone" option but a real rating
// wasn't great. Resets its idle clock the same as a real rating would,
// so it stops glowing, but sends nothing to the server.
function dismissDueAura(idx) {
  if (idx !== dueAuraTileIndex) return;
  tileLastRatedAt[idx] = Date.now();
  startDueAuraExitFade(idx);
  dueAuraTileIndex = -1;
  toast('👁 Noted - won\'t ask about this one for a while');
}
