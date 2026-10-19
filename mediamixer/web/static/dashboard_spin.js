// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Spin (reel, outcomes, streaks) and Spin Surge.

function rateAudio(d) { fetch('/api/rate_audio?dir=' + d).then(() => toast(d === 'up' ? '🔊 Audio rated up' : '🔇 Audio penalized', d !== 'up')); }
function nextAudio() { fetch('/api/next_audio').then(() => toast('⏭️ Audio Skipped')); }

// ---- Manual Spin: a casino "pull the lever" action always on screen,
// independent of the passive jackpot/near-miss/bonus-window rolls above -
// genuine player-initiated agency instead of only ever waiting for
// something to happen. Variable-ratio payoff (sometimes nothing, mostly
// small, occasionally a full jackpot) is deliberate - a guaranteed win
// every time would stop feeling like a pull and just become a button
// that gives xp.
let spinReadyAt = 0;

// Shows the outcome directly on the button itself for a couple seconds -
// a toast elsewhere on screen was easy to miss entirely, especially
// since the button sits apart from wherever attention happens to be.
// Held via spinResultUntil so the 1s countdown tick (updateSpinButton)
// doesn't immediately stomp over it.
let spinResultUntil = 0;

function showSpinResult(text) {
  const btn = document.getElementById('spin-btn');
  if (!btn) return;
  spinResultUntil = Date.now() + 2200;
  btn.classList.remove('spin-ready');
  btn.innerText = text;
}

// A real reel window (#spin-reel above the button) instead of symbols
// flickering inside the button text: a strip of every possible landing
// state scrolls past, decelerates, and stops on the actual outcome - so
// you watch it slow down past JACKPOT and feel each possibility go by.
// The roll itself is still decided up front; the strip is just built so
// it lands on whatever was rolled. A "so close" doesn't just land on a
// label - the reel creeps most of the way onto JACKPOT, hangs there for a
// beat, then slips back one notch.
const SPIN_REEL_CELL_PX = 40; // matches .spin-reel-cell's CSS height
const SPIN_REEL_SPIN_MS = 2400;
const SPIN_REEL_SLIP_HOLD_MS = 420; // how long a near-miss hangs on the edge of JACKPOT before slipping back
const SPIN_REEL_LINGER_MS = 2600; // how long the landed result stays in the window afterward
// Words alongside the icons, not just the icons alone - names each
// actual possible landing state so the reel reads as "here's what you
// could get" instead of an ambiguous string of emoji.
const SPIN_SYMBOLS = {
  jackpot: '🎰 JACKPOT', close: '😤 SO CLOSE', bonus: '✨ BONUS', fx: '🌈 FX BURST', spiral: '🌀 SPIRAL',
  surge: '🚀 SURGE', mantra: '💬 MANTRA', double: '⚡ x2 CATCHES', rhythm: '🥁 RHYTHM', respin: '🔁 RE-SPIN', xp: '🎉 XP', nothing: '💨 NOTHING',
};

// The roll table. Weights sum to 100, so each one reads as a percent.
// An outcome that can't happen right now (FX rewards switched off, a
// spiral already up, Rhythm Mode already running...) lands on its
// fallback instead - 'xp' unless it names one - so the odds of the
// rest never shift around underneath it.
const SPIN_OUTCOMES = [
  { key: 'jackpot', weight: 7, ok: () => !anticipationActive, fallback: 'close' },
  { key: 'close', weight: 4 },
  { key: 'surge', weight: 5, ok: () => tileElements.length > 0 && !overdriveActive && !finaleActive && Date.now() >= spinSurgeEndsAt },
  { key: 'bonus', weight: 13, ok: () => tileElements.length > 0 },
  { key: 'fx', weight: 12, ok: () => tileElements.length > 0 && fxRewardsEnabled },
  { key: 'spiral', weight: 12, ok: () => anticipationFxEnabled && !spiralActive && !(spiralList && !spiralList.length) },
  { key: 'mantra', weight: 8, ok: () => mantraEnabled },
  { key: 'double', weight: 8 },
  { key: 'rhythm', weight: 6, ok: () => !rhythmActive() && !finaleActive },
  { key: 'respin', weight: 5 },
  { key: 'xp', weight: 5 },
  { key: 'nothing', weight: 15 },
];

function rollSpinOutcome() {
  const total = SPIN_OUTCOMES.reduce((sum, o) => sum + o.weight, 0);
  let r = Math.random() * total;
  for (const o of SPIN_OUTCOMES) {
    if (r < o.weight) return !o.ok || o.ok() ? o.key : (o.fallback || 'xp');
    r -= o.weight;
  }
  return 'xp';
}

// Spin streak: every pull that pays anything (not Nothing, not So Close)
// adds a pip; SPIN_STREAK_TARGET - 1 in a row makes the next pull a
// guaranteed jackpot. If a build-up is mid-flight when that pull comes,
// the streak just stays charged for the one after. Any jackpot, rolled
// or guaranteed, cashes the streak in.
const SPIN_STREAK_TARGET = 5;
const SPIN_DOUBLE_CHARGES = 3; // catches/claims/unlocks the x2 outcome covers
const SPIN_RHYTHM_MS = 90000; // a little over one full tempo wave
const SPIN_MANTRA_RUSH_MS = 20000;
let spinStreak = 0;
let spinDoubleCharges = 0;
let spinRhythmUntil = 0; // read by rhythmActive() in dashboard_layers.js
let spinMantraRushUntil = 0; // read by mantraIntensity() in dashboard_layers.js

// Spin Surge: a rare high-end pull, one notch under Overdrive. Every tile
// ramps up to a shared random 1.15-1.3x for SPIN_SURGE_MS (then eases
// back), colors run richer through the tension filter render() already
// writes (so it never fights Prism/VHS for the filter), the passive
// Surge odds boost runs alongside it, and a cyan edge glow marks it.
const SPIN_SURGE_MS = 18000;
const SPIN_SURGE_RAMP_MS = 1500;
let spinSurgeStartedAt = 0;
let spinSurgeEndsAt = 0;
let spinSurgeEndTimer = null;

// 0..1, eased in and (over the last 2.5s) back out - see fxEnvelope.
function spinSurgeColorBoost() {
  const now = Date.now();
  if (now >= spinSurgeEndsAt) return 0;
  return fxEnvelope(now - spinSurgeStartedAt, spinSurgeEndsAt - spinSurgeStartedAt);
}

function startSpinSurge() {
  const now = Date.now();
  spinSurgeStartedAt = now;
  spinSurgeEndsAt = now + SPIN_SURGE_MS;
  surgeExpireAt = Math.max(surgeExpireAt, spinSurgeEndsAt);
  const mult = randomInRange(1.15, 1.3);
  tileElements.forEach((t, i) => {
    const vid = getTileVideo(i);
    if (!vid) return;
    const natural = (tileNaturalBase[i] || 1) * globalSpeedMult();
    setTimelineSpeedEffect(i, vid, 'spinSurge', SPEED_PRIORITY.spinSurge, natural * mult, SPIN_SURGE_RAMP_MS, SPIN_SURGE_MS - SPIN_SURGE_RAMP_MS * 2, SPIN_SURGE_RAMP_MS, natural);
  });
  document.body.classList.add('spin-surge-on');
  fireColorSplashPiece('border');
  playBassDropSound(1.1);
  // render() only runs on status pushes - re-apply the filter on a
  // steady beat of our own so the color boost eases in and out smoothly.
  const colorTick = setInterval(() => {
    if (Date.now() >= spinSurgeEndsAt + 300) clearInterval(colorTick);
    tileElements.forEach((t, i) => { const v = getTileVideo(i); if (v) applyTileTensionFilter(i, v); });
  }, 200);
  clearTimeout(spinSurgeEndTimer);
  spinSurgeEndTimer = setTimeout(() => document.body.classList.remove('spin-surge-on'), SPIN_SURGE_MS - FX_FADE_OUT_MS);
  return mult;
}

function loadSpinState() {
  try {
    const saved = JSON.parse(localStorage.getItem('mm_spin') || '{}');
    spinStreak = Math.max(0, Math.min(SPIN_STREAK_TARGET - 1, saved.streak | 0));
    spinDoubleCharges = Math.max(0, Math.min(SPIN_DOUBLE_CHARGES * 3, saved.doubles | 0));
  } catch (e) {}
  updateSpinStatus();
}

function saveSpinState() {
  try { localStorage.setItem('mm_spin', JSON.stringify({ streak: spinStreak, doubles: spinDoubleCharges })); } catch (e) {}
  updateSpinStatus();
}

function updateSpinStatus() {
  const el = document.getElementById('spin-status');
  if (!el) return;
  const charged = spinStreak >= SPIN_STREAK_TARGET - 1;
  let pips = '';
  for (let i = 0; i < SPIN_STREAK_TARGET; i++) {
    const cls = i < spinStreak ? 'on' : (i === SPIN_STREAK_TARGET - 1 ? 'goal' : '');
    pips += '<span class="spin-pip ' + cls + '"></span>';
  }
  el.innerHTML = '<span class="spin-pips' + (charged ? ' charged' : '') + '" title="Spin streak - ' + (SPIN_STREAK_TARGET - 1) + ' paying spins in a row makes the next one a guaranteed JACKPOT">' + pips + '</span>'
    + (spinDoubleCharges > 0 ? '<span class="spin-double" title="Your next catches, bonus claims and unlocks pay double">⚡x2 ×' + spinDoubleCharges + '</span>' : '');
  el.classList.toggle('charged', charged);
}

// Called by every catch/claim/unlock payout: uses up one x2 charge if
// there are any, and returns the factor to multiply that payout by.
function consumeSpinDouble() {
  if (spinDoubleCharges <= 0) return 1;
  spinDoubleCharges--;
  saveSpinState();
  return 2;
}
const SPIN_SYMBOL_KEYS = Object.keys(SPIN_SYMBOLS);
let spinReelHideTimer = null;

function randomSpinSymbol(avoid) {
  const pool = SPIN_SYMBOL_KEYS.filter((k) => k !== avoid);
  return pool[Math.floor(Math.random() * pool.length)];
}

// A soft blip each time a cell passes the window, scheduled up front on
// the audio clock along the same deceleration curve as the strip itself,
// so the clicks slow down in step with what you see.
function playReelTicks(totalCells, durationMs) {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  // Inverse of the strip's ease-out: cell k passes at roughly
  // t = duration * (1 - sqrt(1 - k/total)), so ticks bunch at the start
  // and spread out toward the stop.
  for (let k = 1; k <= totalCells; k++) {
    const t = (durationMs / 1000) * (1 - Math.sqrt(1 - k / totalCells));
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(bus);
    const t0 = now + t;
    osc.frequency.setValueAtTime(1500 + (k % 2) * 220, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
    osc.start(t0);
    osc.stop(t0 + 0.04);
  }
}

function runSpinReel(outcome, onLanded) {
  const reel = document.getElementById('spin-reel');
  const strip = document.getElementById('spin-reel-strip');
  if (!reel || !strip) { onLanded(); return; }
  const cells = [];
  const fillerCount = 24 + Math.floor(Math.random() * 6);
  // JACKPOT shows up a few times on the way down, so it actually goes by
  // instead of only ever existing as an unseen possibility.
  for (let i = 0; i < fillerCount; i++) {
    cells.push(i % 5 === 2 ? 'jackpot' : randomSpinSymbol(cells[i - 1]));
  }
  // The cell right before the landing spot is never JACKPOT unless it's
  // a near-miss; then the cell right after is, so the reel can creep onto it.
  if (cells[fillerCount - 1] === 'jackpot') cells[fillerCount - 1] = randomSpinSymbol('jackpot');
  cells.push(outcome);
  cells.push(outcome === 'close' ? 'jackpot' : randomSpinSymbol(outcome));
  cells.push(randomSpinSymbol());
  strip.innerHTML = cells.map((k) => '<div class="spin-reel-cell spin-cell-' + k + '">' + SPIN_SYMBOLS[k] + '</div>').join('');

  const landIdx = fillerCount;
  const slip = outcome === 'close';
  clearTimeout(spinReelHideTimer);
  strip.style.transition = 'none';
  strip.style.transform = 'translateY(0)';
  reel.classList.remove('landed');
  reel.classList.add('show');
  void strip.offsetWidth; // force a reflow so the scroll below starts from the top, not wherever the last spin left it
  const stopAt = slip ? landIdx + 0.62 : landIdx;
  strip.style.transition = 'transform ' + SPIN_REEL_SPIN_MS + 'ms cubic-bezier(.12,.62,.22,1)';
  strip.style.transform = 'translateY(' + (-stopAt * SPIN_REEL_CELL_PX) + 'px)';
  playReelTicks(Math.floor(stopAt), SPIN_REEL_SPIN_MS);

  const land = () => {
    reel.classList.add('landed');
    onLanded();
    spinReelHideTimer = setTimeout(() => reel.classList.remove('show', 'landed'), SPIN_REEL_LINGER_MS);
  };
  setTimeout(() => {
    if (!slip) { land(); return; }
    setTimeout(() => {
      strip.style.transition = 'transform 380ms cubic-bezier(.5,0,.4,1.5)';
      strip.style.transform = 'translateY(' + (-landIdx * SPIN_REEL_CELL_PX) + 'px)';
      playFizzleSound();
      setTimeout(land, 400);
    }, SPIN_REEL_SLIP_HOLD_MS);
  }, SPIN_REEL_SPIN_MS);
}

function spin() {
  markInteraction();
  const now = Date.now();
  if (now < spinReadyAt) {
    toast('🎰 Still cooling down (' + Math.ceil((spinReadyAt - now) / 1000) + 's)');
    return;
  }
  spinReadyAt = now + TUNING.SPIN_COOLDOWN_MS;
  const theater = document.getElementById('theater-box');
  teaseNextTheme(theater); // quick visual "tick" regardless of outcome

  const guaranteed = spinStreak >= SPIN_STREAK_TARGET - 1 && !anticipationActive;
  const outcome = guaranteed ? 'jackpot' : rollSpinOutcome();

  const btn = document.getElementById('spin-btn');
  if (btn) {
    btn.disabled = true;
    btn.classList.remove('spin-ready');
    btn.classList.add('spin-rolling');
    btn.innerText = '🎰 Spinning…';
  }
  // Covers the whole reel run plus the result display after it, so the
  // 1s countdown tick (updateSpinButton) can't stomp the button mid-spin.
  spinResultUntil = Date.now() + SPIN_REEL_SPIN_MS + SPIN_REEL_SLIP_HOLD_MS + 3000;

  runSpinReel(outcome, () => {
    if (btn) btn.classList.remove('spin-rolling');
    const streakBefore = spinStreak;
    if (outcome === 'jackpot') spinStreak = 0;
    else if (outcome === 'close' || outcome === 'nothing') spinStreak = 0;
    else spinStreak = Math.min(SPIN_STREAK_TARGET - 1, spinStreak + 1);
    saveSpinState();
    const streakLost = spinStreak === 0 && streakBefore > 0 && outcome !== 'jackpot' ? ' (streak of ' + streakBefore + ' lost)' : '';

    if (outcome === 'jackpot') {
      showSpinResult(guaranteed ? '🔥 STREAK JACKPOT!' : '🎉 JACKPOT!');
      if (guaranteed) toast('🔥 ' + (SPIN_STREAK_TARGET - 1) + ' in a row - guaranteed JACKPOT!');
      runPayoff(); // full jackpot-tier celebration - the rare big pull
    } else if (outcome === 'close') {
      // Nothing behind it (same philosophy as the fake build-up near-
      // misses), but the reel itself just showed how close it came.
      showSpinResult('😤 SO CLOSE!');
      toast('😤 So close to a JACKPOT!' + streakLost, true);
    } else if (outcome === 'surge') {
      const mult = startSpinSurge();
      showSpinResult('🚀 SURGE!');
      toast('🚀 Surge! Everything ' + mult.toFixed(2) + 'x for ' + SPIN_SURGE_MS / 1000 + 's, odds up');
    } else if (outcome === 'spiral') {
      maybeTriggerSpiralOverlay();
      playChimeSound(0.7, 0.9);
      showSpinResult('🌀 Spiral!');
      toast('🌀 Spiral!');
    } else if (outcome === 'mantra') {
      // A center trance line, a burst around it, then mantras keep coming
      // faster than usual for SPIN_MANTRA_RUSH_MS.
      spinMantraRushUntil = Date.now() + SPIN_MANTRA_RUSH_MS;
      showMantra('trance');
      setTimeout(() => mantraBurst(5), 700);
      scheduleNextMantra();
      showSpinResult('💬 Mantra!');
      toast('💬 Mantra rush for ' + SPIN_MANTRA_RUSH_MS / 1000 + 's');
    } else if (outcome === 'double') {
      spinDoubleCharges += SPIN_DOUBLE_CHARGES;
      saveSpinState();
      playChimeSound(0.8, 1.1);
      showSpinResult('⚡ x2 Catches!');
      toast('⚡ Your next ' + SPIN_DOUBLE_CHARGES + ' catches, claims or unlocks pay double (' + spinDoubleCharges + ' banked)');
    } else if (outcome === 'rhythm') {
      spinRhythmUntil = Date.now() + SPIN_RHYTHM_MS;
      showSpinResult('🥁 Rhythm!');
      toast('🥁 Rhythm Mode for ' + SPIN_RHYTHM_MS / 1000 + 's - ride the wave');
    } else if (outcome === 'respin') {
      spinReadyAt = Date.now();
      playChimeSound(0.6, 1.2);
      showSpinResult('🔁 Spin again!');
      toast('🔁 Free re-spin - pull again!');
    } else if (outcome === 'bonus') {
      activateBonusWindow(pickAmbientTarget());
      showSpinResult('✨ Tap the tile!');
      toast('✨ A tile just lit up - tap it!');
    } else if (outcome === 'fx') {
      fireRandomTileFx(3);
      playChimeSound(0.8);
      awardXp(5);
      showSpinResult('🌈 FX Burst!');
      toast('🌈 FX Burst! +5xp');
    } else if (outcome === 'xp') {
      const amount = Math.round(8 + Math.random() * 12);
      playChimeSound(0.6);
      awardXp(amount);
      showSpinResult('🎉 +' + amount + 'xp');
      toast('🎉 +' + amount + 'xp!');
    } else {
      showSpinResult('💨 Nothing');
      toast('💨 Nothing this time...' + streakLost, true);
    }
    if (spinStreak === SPIN_STREAK_TARGET - 1 && streakBefore < spinStreak) toast('🔥 Streak maxed - next Spin is a guaranteed JACKPOT!');
    // Independent of the roll above - a spin can also shake up Auto-
    // Pilot's current zone, same mechanism as the manual "Switch It Up"
    // button (minus the Double Feature push, which stays exclusive to
    // a deliberate press), so Spin feels tied into the rest of the
    // system instead of being its own separate island.
    if (autopilotEnabled && autopilotZone && !finaleActive && Math.random() < 0.18) {
      rollNewAutopilotZone();
      toast('🎰🔀 Spin shook up the zone - ' + AUTOPILOT_ZONES[autopilotZone].label);
    }
  });
}

function updateSpinButton() {
  const btn = document.getElementById('spin-btn');
  if (!btn) return;
  if (Date.now() < spinResultUntil) return;
  const remaining = Math.ceil((spinReadyAt - Date.now()) / 1000);
  if (remaining > 0) {
    btn.disabled = true;
    btn.classList.remove('spin-ready');
    btn.innerText = '🎰 ' + remaining + 's';
  } else {
    btn.disabled = false;
    btn.classList.add('spin-ready');
    btn.innerText = '🎰 Spin';
  }
}
