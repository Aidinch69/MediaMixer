// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Spiral overlay and manual spiral, Color Rush, color splash pieces, mystery tile, double feature and ambient pulses.

// ---- Spiral overlay ----
// A single full-screen spiral video, layered above every tile/floater/FX,
// that fades in to a low opacity during a real mega+/milestone jackpot
// moment, holds for a while, then fades back out - sourced from whatever
// video files sit in the Spirals/ folder. Lazy-fetched once and cached,
// same pattern as fetchFxList above.
let spiralList = null;
let spiralListPromise = null;
let spiralActive = false;
function fetchSpiralList() {
  if (spiralList) return Promise.resolve(spiralList);
  if (spiralListPromise) return spiralListPromise;
  spiralListPromise = fetch('/api/spirals/list')
    .then(r => r.json())
    .then(d => { spiralList = d.items || []; return spiralList; })
    .catch(() => { spiralList = []; return spiralList; });
  return spiralListPromise;
}

const SPIRAL_STALL_CHECK_MS = 2000;
let spiralStallTimer = null;
let spiralLastCurrentTime = -1;

function maybeTriggerSpiralOverlay() {
  if (!anticipationFxEnabled || spiralActive) return;
  fetchSpiralList().then(items => {
    if (!items.length || spiralActive) return;
    const el = document.getElementById('spiral-overlay');
    if (!el) return;
    // A different clip from the manual spiral underneath, if one is up.
    const pool = items.length > 1 ? items.filter((it) => it.base + it.path !== manualSpiralPath()) : items;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    spiralActive = true;
    el.muted = true;
    el.loop = true;
    // Belt-and-suspenders alongside the HTML `loop` attribute - these
    // source clips typically only run a few seconds, well short of the
    // 30-60s hold below, so if `loop` ever fails to restart playback for
    // any reason the spiral would just freeze on its last frame for the
    // rest of the hold instead of looping for as long as it's up.
    el.onended = () => { el.currentTime = 0; el.play().catch(() => {}); };
    const targetOpacity = (TUNING.SPIRAL_OPACITY_MIN + Math.random() * TUNING.SPIRAL_OPACITY_RANGE).toFixed(2);
    const fadeMs = TUNING.SPIRAL_FADE_MIN_MS + Math.random() * TUNING.SPIRAL_FADE_RANGE_MS; // same fade both ways
    // Not every time - some activations also get a slow "breathing" wave
    // once the fade-in settles: nudges opacity +-5% every 10s. Started
    // only after the fade-in completes (see the canplay handler) and
    // explicitly stopped before the real fade-out begins, so it never
    // fights that transition.
    const shouldBreathe = Math.random() < TUNING.SPIRAL_BREATHE_PROBABILITY;
    let breatheTimer = null;
    // Don't start the fade until the video actually has a decodable
    // frame - starting it right on src assignment meant the CSS
    // transition ran on schedule regardless of buffering, so by the
    // time anything was actually visible the fade had often already
    // silently finished (or was most of the way there), reading as a
    // sudden pop-in instead of a visible fade.
    el.addEventListener('canplay', () => {
      el.style.transition = 'opacity ' + (fadeMs / 1000).toFixed(2) + 's ease-in-out';
      void el.offsetWidth; // force a reflow so the transition reliably engages
      requestAnimationFrame(() => { el.style.opacity = targetOpacity; });
      if (shouldBreathe) {
        let dir = 1;
        breatheTimer = setInterval(() => {
          const t = Math.max(0.05, Math.min(0.95, parseFloat(targetOpacity) + dir * 0.05));
          el.style.transition = 'opacity 3s ease-in-out';
          el.style.opacity = t.toFixed(2);
          dir *= -1;
        }, TUNING.SPIRAL_BREATHE_INTERVAL_MS);
      }
    }, { once: true });
    el.src = pick.base + pick.path;
    el.currentTime = 0;
    el.play().catch(() => {});
    // Stall watchdog: if currentTime hasn't moved in 2s (buffering stuck,
    // a failed loop restart, or anything else) force a hard restart from
    // the top - covers "holds the last frame for the rest of the window"
    // regardless of which of those it actually was.
    spiralLastCurrentTime = -1;
    clearInterval(spiralStallTimer);
    spiralStallTimer = setInterval(() => {
      if (!spiralActive || el.paused) return;
      if (el.currentTime === spiralLastCurrentTime) {
        el.currentTime = 0;
        el.play().catch(() => {});
      }
      spiralLastCurrentTime = el.currentTime;
    }, SPIRAL_STALL_CHECK_MS);
    const holdMs = TUNING.SPIRAL_HOLD_MIN_MS + Math.random() * TUNING.SPIRAL_HOLD_RANGE_MS;
    setTimeout(() => {
      clearInterval(breatheTimer);
      el.style.transition = 'opacity ' + (fadeMs / 1000).toFixed(2) + 's ease-in-out';
      el.style.opacity = '0';
      setTimeout(() => {
        el.pause();
        el.onended = null;
        clearInterval(spiralStallTimer);
        spiralActive = false;
      }, fadeMs);
    }, holdMs);
  });
}

// Heart multiplier gives spirals a direct path of their own, not just
// the mega+/milestone jackpot gate above - "more hearts... more chance
// of [a] Spiral." Small per-check odds (4% per point of multiplier,
// checked every 20s) since a spiral now runs a genuinely long time
// (30-60s hold); maybeTriggerSpiralOverlay's own spiralActive guard
// still applies, so this never interrupts one already running.

function maybeTriggerSpiralFromHearts() {
  if (heartMultiplier <= 0 || spiralActive) return;
  if (Math.random() < 0.04 * heartMultiplier * (1 + autopilotAmbientBoost)) maybeTriggerSpiralOverlay();
}
setInterval(maybeTriggerSpiralFromHearts, TUNING.HEART_SPIRAL_CHECK_MS);

// ---- Color Rush ----
// A rare, short multi-color event combining several pieces at once:
// falling color streaks, a hue-cycling glow around the screen's edge,
// every tile's own glow pulsing on its own independent beat (not
// synced - a real disco floor, not a wash), a subtle whole-screen
// heartbeat pulse, and a confetti burst. Deliberately the heaviest
// visual effect in this file (several concurrent CSS animations plus
// DOM-spawned confetti) - accepted on purpose rather than the usual
// opacity/transform-only restraint elsewhere, since it's rare and
// short-lived rather than ambient/constant.
const COLOR_RUSH_STREAK_COUNT = 28;
const COLOR_RUSH_HUES = [340, 280, 220, 160, 90, 40]; // pink, purple, blue, green, lime, gold
let colorRushActive = false;

function maybeTriggerColorRush() {
  if (!anticipationFxEnabled || colorRushActive) return;
  if (Math.random() < TUNING.COLOR_RUSH_PROBABILITY * oddsMultiplier() * autopilotZoneMultiplier('colorRush')) triggerColorRush();
}

// The full event is just these pieces fired together - each one also
// works completely standalone (see fireColorSplashPiece below), so the
// same "cool effect" can show up as a small flourish on a streak/
// unlock/bonus/jackpot without it always being the full intense combo.
function fireDiscoRain(durationMs) {
  const rain = document.getElementById('disco-rain');
  if (!rain) return;
  rain.innerHTML = '';
  for (let i = 0; i < COLOR_RUSH_STREAK_COUNT; i++) {
    const s = document.createElement('div');
    s.className = 'disco-streak';
    const hue = COLOR_RUSH_HUES[Math.floor(Math.random() * COLOR_RUSH_HUES.length)];
    s.style.left = (Math.random() * 100).toFixed(1) + '%';
    s.style.background = 'linear-gradient(180deg,transparent,hsla(' + hue + ',90%,65%,.9),transparent)';
    s.style.animationDuration = (1.1 + Math.random() * 1.3).toFixed(2) + 's';
    s.style.animationDelay = (-Math.random() * 2).toFixed(2) + 's'; // staggered, not all falling in sync
    rain.appendChild(s);
  }
  rain.classList.add('show');
  setTimeout(() => {
    rain.classList.remove('show');
    setTimeout(() => { rain.innerHTML = ''; }, 1000); // matches its own fade-out transition
  }, durationMs);
}

function fireDiscoBorder(durationMs) {
  const border = document.getElementById('disco-border');
  if (!border) return;
  border.classList.add('show');
  setTimeout(() => border.classList.remove('show'), durationMs);
}

function fireScreenBeat(durationMs) {
  const theater = document.getElementById('theater-box');
  if (!theater) return;
  theater.classList.add('disco-beat');
  setTimeout(() => theater.classList.remove('disco-beat'), durationMs);
}

// indexes lets a caller light up just one tile (e.g. the tile that was
// actually caught/opened) instead of the whole grid, for the smaller
// per-event flourishes.
function fireDiscoTilePulse(durationMs, indexes) {
  const targets = indexes || tileGlowEls.map((_, i) => i);
  targets.forEach(i => {
    const el = tileGlowEls[i];
    if (!el) return;
    el.style.animationDelay = (-Math.random() * 1.6).toFixed(2) + 's,' + (-Math.random() * 0.7).toFixed(2) + 's';
    el.classList.add('disco-pulse');
  });
  setTimeout(() => {
    targets.forEach(i => {
      const el = tileGlowEls[i];
      if (!el) return;
      // Just removing the class snapped opacity straight back to
      // whatever the element's other classes dictate (usually 0) the
      // instant the animation stopped - jarring. Freeze the animation's
      // current opacity as an explicit inline value first, then
      // transition that down, so the pulse actually fades away.
      const current = getComputedStyle(el).opacity;
      el.classList.remove('disco-pulse');
      el.style.animationDelay = '';
      el.style.transition = 'opacity .6s ease';
      el.style.opacity = current;
      void el.offsetWidth; // force a reflow so the transition reliably engages
      el.style.opacity = '0';
      setTimeout(() => { el.style.transition = ''; el.style.opacity = ''; }, 650);
    });
  }, durationMs);
}

function burstConfetti(count) {
  const layer = document.getElementById('fx-layer');
  if (!layer) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const hue = COLOR_RUSH_HUES[Math.floor(Math.random() * COLOR_RUSH_HUES.length)];
    p.style.left = (Math.random() * 100).toFixed(1) + '%';
    p.style.background = 'hsl(' + hue + ',85%,62%)';
    const durationS = 1.8 + Math.random() * 1.6;
    p.style.animationDuration = durationS.toFixed(2) + 's';
    p.style.animationDelay = (Math.random() * 0.4).toFixed(2) + 's';
    p.addEventListener('animationend', () => p.remove());
    layer.appendChild(p);
  }
}

function triggerColorRush() {
  if (colorRushActive || !tileElements.length) return;
  colorRushActive = true;
  toast('🌈 Color Rush!');
  fireDiscoRain(TUNING.COLOR_RUSH_DURATION_MS);
  fireDiscoBorder(TUNING.COLOR_RUSH_DURATION_MS);
  fireScreenBeat(TUNING.COLOR_RUSH_DURATION_MS);
  fireDiscoTilePulse(TUNING.COLOR_RUSH_DURATION_MS);
  burstConfetti(50);
  const midBurst = setTimeout(() => burstConfetti(30), TUNING.COLOR_RUSH_DURATION_MS / 2);
  setTimeout(() => {
    clearTimeout(midBurst);
    colorRushActive = false;
  }, TUNING.COLOR_RUSH_DURATION_MS + 1000); // +1000 covers disco-rain's own fade-out tail above
}
startTunableInterval('COLOR_RUSH_CHECK_MS', maybeTriggerColorRush);

// ---- Color splash pieces (standalone) ----
// The same pieces Color Rush combines, but fired one at a time as a
// smaller, more frequent flourish tied to other moments (a catch, a
// bonus claim, a sealed-tile open, a jackpot payoff) - "sometimes it
// can just go with the disco tiles, sometimes just the confetti,"
// instead of every reward moment reaching for the full intense combo.
const COLOR_SPLASH_PIECES = ['confetti', 'tiles', 'border', 'rain'];

function maybeTriggerColorSplashPiece() {
  if (!anticipationFxEnabled || colorRushActive) return;
  if (Math.random() < TUNING.COLOR_SPLASH_PROBABILITY * oddsMultiplier()) fireColorSplashPiece();
}
startTunableInterval('COLOR_SPLASH_CHECK_MS', maybeTriggerColorSplashPiece);

// tileIdx (optional) confines a 'tiles' piece to just that one tile -
// used when a splash is tied to a specific tile's own moment (a catch,
// an unlock) rather than firing ambient and grid-wide.
let lastColorSplashPiece = null;
function fireColorSplashPiece(pieceOverride, tileIdx) {
  if (colorRushActive || !tileElements.length) return;
  const piece = pieceOverride || COLOR_SPLASH_PIECES[Math.floor(Math.random() * COLOR_SPLASH_PIECES.length)];
  lastColorSplashPiece = piece; // read by the event log
  const duration = 3000 + Math.random() * 2000;
  if (piece === 'confetti') burstConfetti(14 + Math.floor(Math.random() * 14));
  else if (piece === 'tiles') fireDiscoTilePulse(duration, tileIdx != null ? [tileIdx] : null);
  else if (piece === 'border') fireDiscoBorder(duration);
  else if (piece === 'rain') fireDiscoRain(Math.max(duration, 4000)); // needs a bit more runway to actually read
}

// Mystery tile: a pure curiosity-gap hit, distinct from the loss-aversion
// and reward mechanics above - a tile briefly blurs under a "?" overlay
// and un-blurs on its own. Most of the time there's nothing to act on and
// no payoff behind it - but a fraction of the time (TRUE_MYSTERY_PROBABILITY)
// it tries to actually deliver on the curiosity gap for real: a server-side
// swap to a clip with play_count=0, something genuinely never shown by
// rotation before, not just a random reward roll dressed up as one. Falls
// back to the plain cosmetic reveal if the library has nothing unplayed
// left (or the request doesn't resolve before the reveal fires).
let mysteryTileIndex = -1;

function maybeTriggerMysteryTile() {
  if (!anticipationFxEnabled) return;
  if (mysteryTileIndex >= 0 || !tileElements.length || spotlightTileIndex >= 0) return;
  if (Math.random() >= TUNING.MYSTERY_TILE_PROBABILITY) return;
  const idx = Math.floor(Math.random() * tileElements.length);
  const tile = tileElements[idx];
  if (!tile) return;
  mysteryTileIndex = idx;
  tile.classList.add('mystery-tile');
  let trueMysteryPicked = false;
  if (Math.random() < TUNING.TRUE_MYSTERY_PROBABILITY) {
    fetch('/api/true_mystery?screen=' + idx)
      .then((r) => r.json())
      .then((data) => { trueMysteryPicked = !!(data && data.picked); })
      .catch(() => {});
  }
  setTimeout(() => clearMysteryTile(idx, trueMysteryPicked), TUNING.MYSTERY_TILE_DURATION_MS);
}

// Double Feature: occasionally pairs two tiles with favorited content
// instead of every tile being an independent random roll - paired by
// shared Favorites membership (both things you've hearted), not by
// folder, so it works without having to organize the library into
// folders that point at each other.
function maybeTriggerDoubleFeature() {
  if (!anticipationFxEnabled || !tileElements.length) return;
  if (Math.random() >= TUNING.DOUBLE_FEATURE_PROBABILITY) return;
  fetch('/api/double_feature')
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.picked || !Array.isArray(data.screens)) return;
      toast('🎬 Double Feature!');
      markNoveltyHappened();
      data.screens.forEach((idx) => showClaimRewardLabel(idx, '🎬 Double Feature'));
    })
    .catch(() => {});
}
startTunableInterval('DOUBLE_FEATURE_CHECK_MS', maybeTriggerDoubleFeature);

// Ambient color-breathe: purely decorative, no mechanic behind it at
// all - just a slow multi-color pulse on a random tile every so often,
// to keep an idle grid feeling a little alive even between real events.

function maybeTriggerAmbientPulse() {
  if (anticipationActive || !tileGlowEls.length) return;
  if (Math.random() >= TUNING.AMBIENT_PULSE_PROBABILITY) return;
  const idx = Math.floor(Math.random() * tileGlowEls.length);
  const el = tileGlowEls[idx];
  if (!el) return;
  el.classList.remove('ambient-breath');
  void el.offsetWidth; // restart the animation cleanly if one was already mid-cycle
  el.classList.add('ambient-breath');
  setTimeout(() => el.classList.remove('ambient-breath'), TUNING.AMBIENT_PULSE_DURATION_MS);
}

function clearMysteryTile(idx, trueMysteryReveal) {
  const tile = tileElements[idx];
  if (tile) {
    tile.classList.remove('mystery-tile');
    tile.classList.add('mystery-reveal');
    setTimeout(() => tile.classList.remove('mystery-reveal'), 300);
    if (trueMysteryReveal) {
      toast('✨ Never seen before!');
      markNoveltyHappened();
      showClaimRewardLabel(idx, '✨ New Discovery');
    }
  }
  if (mysteryTileIndex === idx) mysteryTileIndex = -1;
}

function triggerMiniPayoff(idx) {
  playChimeSound(0.7);
  burstExtraFloaters(0.5);
  nudgeEngagement(0.08);
  const mult = hiddenMultiplierFactor();
  const chainMult = registerCombo(); // Combo Chain Mechanics - see catchChaseFlash
  const spinMult = consumeSpinDouble();
  const xp = TUNING.XP_PER_BONUS_CLAIM * mult * chainMult * spinMult;
  let tag = (mult > 1 ? ' (hidden x' + mult + '!)' : '') + (spinMult > 1 ? ' (⚡x2)' : '');
  awardXp(xp);
  incrementQuestMetric('bonuses', 1);
  sessionStats.bonuses++;
  onEngagement('bonus', idx);
  const fxLabel = idx != null ? maybeFxReward(idx, TUNING.FX_REWARD_BONUS_CHANCE) : null;
  if (fxLabel) tag += ' · ' + fxLabel;
  toast('✨ Bonus! +' + xp + 'xp' + tag); // was already awarded, just wasn't shown
  // The toast says the same thing, but it's off in a corner - a label
  // right on the tile that was actually tapped shows what was won where
  // attention already is, rather than relying on the viewer to glance
  // elsewhere to find out if (and what) they were rewarded.
  if (idx != null) showClaimRewardLabel(idx, '+' + xp + 'xp' + tag);
  if (Math.random() < 0.2) fireColorSplashPiece('confetti');
}

const CLAIM_REWARD_LABEL_MS = 1400;

// Warm Glow Aging: intensity is a diminishing curve of this specific
// video's lifetime heart count (asymptotic toward 1, never reaching it),
// capped to a modest peak opacity - so a video hearted 2 times and one
// hearted 50 times both get a warm bloom, but the 50-heart one doesn't
// get a 25x-brighter flash. Directly answers the "would a big glow each
// time taint a really-liked video over time?" concern: it can't, because
// the curve flattens hard after the first few hearts instead of scaling
// linearly with count forever.
function pulseWarmGlow(idx, heartCount) {
  const el = tileClaimEls[idx];
  if (!el) return;
  const curve = 1 - Math.exp(-heartCount / 6); // 0 at 0, ~0.37 at count=3, ~0.78 at count=10, asymptotic to 1
  const peak = Math.min(0.55, 0.2 + curve * 0.4); // capped peak opacity, never a full-white flash
  el.style.setProperty('--warm-peak', peak.toFixed(2));
  el.classList.remove('warm-glow');
  void el.offsetWidth;
  el.classList.add('warm-glow');
  setTimeout(() => el.classList.remove('warm-glow'), 1600);
}

function showClaimRewardLabel(idx, text) {
  const el = tileClaimEls[idx];
  const label = el && el.querySelector('.claim-reward-label');
  if (!label) return;
  label.textContent = text;
  label.classList.remove('show');
  void label.offsetWidth; // restart the rise/fade if one's already mid-flight
  label.classList.add('show');
  setTimeout(() => label.classList.remove('show'), CLAIM_REWARD_LABEL_MS);
}

// ---- Manual spiral ----
// A spiral you pick and keep up yourself, at your own opacity, regardless
// of Auto-Pilot. It sits on its own layer (#spiral-manual) directly under
// the event spiral, so when a jackpot/heart/Overdrive spiral fires it
// blends in on top of yours instead of replacing it (the event picks a
// different clip so the two never double up). Remembered per device.
const MANUAL_SPIRAL_FADE_MS = 1500;
const MANUAL_SPIRAL_SWAP_MS = 450;
let manualSpiralEnabled = false;
let manualSpiralOpacity = 0.25;
let manualSpiralName = null; // "<source id>/<path>" as /api/spirals/list gives it
let manualSpiralStallTimer = null;
let manualSpiralLastTime = -1;
let manualSpiralOffTimer = null;

function manualSpiralEl() { return document.getElementById('spiral-manual'); }

function manualSpiralPath() {
  return manualSpiralEnabled && manualSpiralName ? '/spirals/' + manualSpiralName : null;
}

function loadManualSpiralPrefs() {
  const p = loadJsonPref('mm_manual_spiral', { enabled: false, opacity: 0.25, name: null });
  manualSpiralEnabled = !!p.enabled;
  manualSpiralOpacity = Math.max(0.05, Math.min(0.8, Number(p.opacity) || 0.25));
  manualSpiralName = typeof p.name === 'string' ? p.name : null;
  updateManualSpiralUi();
  if (manualSpiralEnabled) showManualSpiral();
}

function saveManualSpiralPrefs() {
  saveJsonPref('mm_manual_spiral', { enabled: manualSpiralEnabled, opacity: manualSpiralOpacity, name: manualSpiralName });
  updateManualSpiralUi();
}

// Loads `item` (or the remembered pick) into the layer and fades it up.
function showManualSpiral(item) {
  const el = manualSpiralEl();
  if (!el) return;
  clearTimeout(manualSpiralOffTimer);
  fetchSpiralList().then((items) => {
    if (!items.length) { toast('🌀 No spirals found in the Spirals folder', true); manualSpiralEnabled = false; saveManualSpiralPrefs(); return; }
    if (!manualSpiralEnabled) return;
    const pick = item || items.find((it) => it.path === manualSpiralName) || items[0];
    manualSpiralName = pick.path;
    saveManualSpiralPrefs();
    const url = pick.base + pick.path;
    el.muted = true;
    el.loop = true;
    el.onended = () => { el.currentTime = 0; el.play().catch(() => {}); };
    if (el.dataset.src !== url) {
      el.dataset.src = url;
      // Fade in only once a frame is decodable, same as the event spiral.
      el.addEventListener('canplay', () => fadeManualSpiral(manualSpiralOpacity, MANUAL_SPIRAL_FADE_MS), { once: true });
      el.src = url;
    } else {
      fadeManualSpiral(manualSpiralOpacity, MANUAL_SPIRAL_FADE_MS);
    }
    el.play().catch(() => {});
    startManualSpiralWatchdog();
  });
}

function fadeManualSpiral(opacity, ms) {
  const el = manualSpiralEl();
  if (!el) return;
  el.style.transition = 'opacity ' + (ms / 1000).toFixed(2) + 's ease-in-out';
  void el.offsetWidth;
  el.style.opacity = manualSpiralEnabled ? String(opacity) : '0';
}

// Same stall guard as the event spiral: a clip stuck on one frame gets
// restarted from the top.
function startManualSpiralWatchdog() {
  const el = manualSpiralEl();
  manualSpiralLastTime = -1;
  clearInterval(manualSpiralStallTimer);
  manualSpiralStallTimer = setInterval(() => {
    if (!manualSpiralEnabled || el.paused) return;
    if (el.currentTime === manualSpiralLastTime) { el.currentTime = 0; el.play().catch(() => {}); }
    manualSpiralLastTime = el.currentTime;
  }, SPIRAL_STALL_CHECK_MS);
}

function hideManualSpiral() {
  const el = manualSpiralEl();
  if (!el) return;
  fadeManualSpiral(0, MANUAL_SPIRAL_FADE_MS);
  clearTimeout(manualSpiralOffTimer);
  manualSpiralOffTimer = setTimeout(() => {
    if (manualSpiralEnabled) return;
    el.pause();
    clearInterval(manualSpiralStallTimer);
  }, MANUAL_SPIRAL_FADE_MS + 100);
}

function toggleManualSpiral() {
  manualSpiralEnabled = !manualSpiralEnabled;
  saveManualSpiralPrefs();
  if (manualSpiralEnabled) showManualSpiral(); else hideManualSpiral();
}

function setManualSpiralOpacity(v) {
  manualSpiralOpacity = Math.max(0.05, Math.min(0.8, parseInt(v, 10) / 100 || 0.25));
  saveManualSpiralPrefs();
  if (manualSpiralEnabled) fadeManualSpiral(manualSpiralOpacity, 150);
}

// Next/previous through the folder. Turns the layer on if it's off, so the
// buttons double as a browser. Dips out briefly between clips.
function stepManualSpiral(dir) {
  fetchSpiralList().then((items) => {
    if (!items.length) { toast('🌀 No spirals found in the Spirals folder', true); return; }
    const cur = Math.max(0, items.findIndex((it) => it.path === manualSpiralName));
    const next = items[(cur + dir + items.length) % items.length];
    manualSpiralName = next.path;
    if (!manualSpiralEnabled) { manualSpiralEnabled = true; saveManualSpiralPrefs(); showManualSpiral(next); return; }
    saveManualSpiralPrefs();
    fadeManualSpiral(0, MANUAL_SPIRAL_SWAP_MS);
    setTimeout(() => showManualSpiral(next), MANUAL_SPIRAL_SWAP_MS);
  });
}

function updateManualSpiralUi() {
  setToggleBadge('manual-spiral-toggle', manualSpiralEnabled);
  const input = document.getElementById('manual-spiral-opacity-input');
  if (input) input.value = Math.round(manualSpiralOpacity * 100);
  const lbl = document.getElementById('l-manual-spiral-opacity');
  if (lbl) lbl.innerText = Math.round(manualSpiralOpacity * 100) + '%';
  const name = document.getElementById('manual-spiral-name');
  if (name) {
    const list = spiralList || [];
    const idx = list.findIndex((it) => it.path === manualSpiralName);
    name.innerText = manualSpiralName
      ? (idx >= 0 ? (idx + 1) + ' / ' + list.length + ' · ' : '') + manualSpiralName.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
      : 'None picked yet - tap Next';
  }
}
