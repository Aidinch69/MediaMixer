// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Jackpot heat/streaks, heart and hidden multipliers, payoff reveal, push-your-luck, choice moments, golden hour and surges.

let jackpotStreak = 0;
let lastJackpotAt = 0;
let totalJackpotCount = 0;

// ---- Jackpot heat ----
// A temporary, decaying boost earned from chase-catch streaks and bonus
// taps ("higher catch streaks add a higher ability for good jackpots" /
// "bonus taps add slight increase to jackpots") - bumped in
// catchChaseFlash and claimBonusTile, decays on its own tick so it's
// momentum, not a permanent ratchet. Feeds two places: oddsMultiplier()
// (more probability-gated events - bonus windows, chase flashes,
// near-misses - in general) and pickJackpotTier() below (shifts the
// weighted pick away from "small" and toward "medium"/"mega" while hot).
let jackpotHeat = 0;
const JACKPOT_HEAT_DECAY_MS = 5000;

function bumpJackpotHeat(amount) {
  jackpotHeat = Math.min(TUNING.JACKPOT_HEAT_MAX, jackpotHeat + amount);
}
setInterval(() => { jackpotHeat = Math.max(0, jackpotHeat - TUNING.JACKPOT_HEAT_DECAY_PER_TICK); }, JACKPOT_HEAT_DECAY_MS);

// ---- Heart multiplier ----
// A slower, more persistent cousin of jackpotHeat - built specifically
// by hearting (rate-up) tiles, "more hearts provided on different or
// same vids, more chance of rewards." Builds the same whether those
// hearts land on one tile repeatedly or spread across several (unlike
// comboMultiplier, which is specifically about rapid-fire same-tile
// rating). Feeds into the same odds/tier-bias machinery as jackpotHeat,
// plus two effects of its own: a direct (if small) chance to trigger a
// spiral outright, and a chance of a little speed kick right on the
// tile that was just hearted - see rateScreen and
// maybeTriggerSpiralFromHearts below.
let heartMultiplier = 0;
const HEART_MULT_DECAY_MS = 6000;

function bumpHeartMultiplier() {
  heartMultiplier = Math.min(TUNING.HEART_MULT_MAX, heartMultiplier + 1);
}
setInterval(() => { heartMultiplier = Math.max(0, heartMultiplier - TUNING.HEART_MULT_DECAY_PER_TICK); }, HEART_MULT_DECAY_MS);

function pickJackpotTier() {
  const heat = jackpotHeat + heartMultiplier * 0.3;
  const weighted = JACKPOT_TIERS.map(t => heat <= 0 ? t.weight
    : t.name === 'small' ? t.weight / (1 + heat * 0.5)
    : t.weight * (1 + heat * 0.5));
  const total = weighted.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < JACKPOT_TIERS.length; i++) {
    if (r < weighted[i]) return JACKPOT_TIERS[i];
    r -= weighted[i];
  }
  return JACKPOT_TIERS[0];
}

// ---- Hidden multiplier window ----
// A rare, genuinely silent window where bonus/catch/sealed-tile rewards
// are secretly worth more - no badge, no toast, nothing when it starts.
// The suspense is retroactive: you only find out a particular reward
// was doubled from the extra "(hidden x2!)" tacked onto that reward's
// own toast/label after the fact, instead of a countdown you'd just sit
// and wait out. Deliberately separate from jackpotHeat/heartMultiplier,
// which are both always visible - this one only works because it isn't.
const HIDDEN_MULT_CHECK_MS = 50000;
let hiddenMultExpireAt = 0;

function maybeTriggerHiddenMultiplier() {
  if (!anticipationFxEnabled || Date.now() < hiddenMultExpireAt) return;
  if (Math.random() < TUNING.HIDDEN_MULT_PROBABILITY * oddsMultiplier()) {
    hiddenMultExpireAt = Date.now() + TUNING.HIDDEN_MULT_DURATION_MS;
  }
}
setInterval(maybeTriggerHiddenMultiplier, HIDDEN_MULT_CHECK_MS);

function hiddenMultiplierFactor() {
  return Date.now() < hiddenMultExpireAt ? TUNING.HIDDEN_MULT_VALUE : 1;
}

// Prefers the tier the server actually used for the content that just
// changed (set by handleAnticipationStatus); only falls back to an
// independent random pick for a "surprise" jackpot that had no build-up
// at all, where there's no server tier to match in the first place.
function resolveTier() {
  if (pendingServerTier) {
    const found = JACKPOT_TIERS.find(t => t.name === pendingServerTier);
    pendingServerTier = null;
    if (found) return found;
  }
  return pickJackpotTier();
}

function registerJackpotStreak() {
  const now = Date.now();
  if (now - lastJackpotAt > STREAK_RESET_MS) jackpotStreak = 0;
  jackpotStreak++;
  lastJackpotAt = now;
  const el = document.getElementById('jackpot-streak');
  if (el) { el.innerText = jackpotStreak > 1 ? ('🔥 ' + jackpotStreak) : ''; el.style.color = '#ffcc55'; }
  return jackpotStreak;
}

// Loss-aversion countdown: once a streak is close to expiring, say so and
// count down, instead of it just silently resetting next time you check.
function tickStreakWarning() {
  const el = document.getElementById('jackpot-streak');
  if (!el || jackpotStreak <= 1) return;
  const remaining = (lastJackpotAt + STREAK_RESET_MS - Date.now()) / 1000;
  if (remaining <= 0) {
    jackpotStreak = 0;
    el.innerText = '';
  } else if (remaining <= STREAK_WARNING_S) {
    el.innerText = '⚠️ Streak ' + jackpotStreak + ' resets in ' + Math.ceil(remaining) + 's!';
    el.style.color = '#ff6b6b';
  }
}

function registerMilestone() {
  totalJackpotCount++;
  return MILESTONE_COUNTS.includes(totalJackpotCount) ? totalJackpotCount : null;
}

// Rolling tier reveal: flickers through tier names before settling on the
// real one, like a slot-machine reel - a second layer of dopamine-relevant
// uncertainty (how big, not just whether) resolved right before the actual
// celebration fires.
// Fake-downgrade reveals: the reel-stop flicker occasionally holds on MEGA
// before snapping down to the actual (lower) tier - the near-miss idea
// applied to the reveal animation itself, not just the lead-up to it.
const FAKE_DOWNGRADE_PROBABILITY = 0.2;

function revealTier(tier, onDone) {
  const el = document.getElementById('tier-reveal');
  const order = ['small', 'medium', 'mega'];
  el.style.display = 'block';
  requestAnimationFrame(() => el.classList.add('show'));
  const fakeDowngrade = (tier.name === 'small' || tier.name === 'medium') && Math.random() < FAKE_DOWNGRADE_PROBABILITY;
  let i = 0;
  function lockIn() {
    el.innerText = TIER_LABELS[tier.name] || tier.name.toUpperCase();
    el.className = fakeDowngrade ? ('show snap tier-' + tier.name) : ('show tier-' + tier.name);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.style.display = 'none'; }, 300);
      onDone();
    }, 500);
  }
  function step(n) {
    const isLast = n >= TIER_REVEAL_DELAYS.length - 1;
    const name = isLast ? (fakeDowngrade ? 'mega' : tier.name) : order[i++ % order.length];
    el.innerText = TIER_LABELS[name] || name.toUpperCase();
    el.className = 'show tier-' + name;
    if (!isLast) {
      setTimeout(() => step(n + 1), TIER_REVEAL_DELAYS[n]);
    } else if (fakeDowngrade) {
      setTimeout(lockIn, 480); // extra dwell on the fake MEGA hold before the downgrade snaps in
    } else {
      setTimeout(lockIn, 500);
    }
  }
  step(0);
}

// Jackpot chain re-triggers: mega/milestone payoffs get a shrinking chance
// to immediately re-fire into another payoff (slot-machine "re-spin"
// feel), capped so a chain can't run away indefinitely.
const CHAIN_BASE_PROBABILITY = 0.3;
const MAX_CHAIN_DEPTH = 2;

function decideChain(tier, chainDepth) {
  if (chainDepth >= MAX_CHAIN_DEPTH) return false;
  if (tier.name !== 'mega' && tier.name !== 'milestone') return false;
  return Math.random() < CHAIN_BASE_PROBABILITY * Math.pow(0.5, chainDepth);
}

function runPayoff(chainDepth) {
  chainDepth = chainDepth || 0;
  anticipationRunId++; // invalidate any in-flight build-up loop (real or fake)
  anticipationActive = false;
  clearTileGlow();
  rotateColorTheme();
  // Snapshot before registerJackpotStreak() overwrites lastJackpotAt/jackpotStreak,
  // so a jackpot landing inside the streak-reset warning window reads as a "save".
  const wasAtRisk = jackpotStreak > 1 && (Date.now() - lastJackpotAt) >= (STREAK_RESET_MS - STREAK_WARNING_S * 1000);
  const milestoneCount = registerMilestone();
  const tier = milestoneCount ? MILESTONE_TIER : resolveTier();
  const streak = registerJackpotStreak();
  lastAnyPayoffAt = Date.now();
  awardXp((XP_PER_TIER[tier.name] || 10) * (milestoneCount ? 3 : 1));
  recordPayoffStats(streak, milestoneCount);
  incrementQuestMetric('jackpots', 1);
  sessionStats.jackpots++;
  revealTier(tier, () => {
    const willChain = decideChain(tier, chainDepth);
    applyPayoffEffects(tier, streak, milestoneCount, wasAtRisk, chainDepth, willChain);
    if (willChain) setTimeout(() => runPayoff(chainDepth + 1), 900);
  });
}

function applyPayoffEffects(tier, streak, milestoneCount, wasAtRisk, chainDepth, willChain) {
  nudgeEngagement(0.2 * tier.flash);
  markNoveltyHappened(); // a real jackpot landing is exactly the kind of thing boredom debt exists to not need to force
  const theater = document.getElementById('theater-box');
  const theaterGlow = document.getElementById('theater-glow');
  theater.style.setProperty('--flash-opacity', Math.min(0.9, 0.6 * tier.flash).toFixed(2));
  theater.style.setProperty('--flash-duration', (0.65 * Math.min(1.3, tier.flash)).toFixed(2) + 's');
  if (theaterGlow) { theaterGlow.style.transition = 'opacity 0.5s ease'; theaterGlow.style.opacity = '0'; }
  theater.classList.add('payoff-flash');
  if (tier.shake) {
    theater.classList.add('shake-mega');
    setTimeout(() => theater.classList.remove('shake-mega'), 450);
    maybeTriggerSpiralOverlay(); // mega+/milestone only - the same "big" threshold shake already uses
  }
  setTimeout(() => { theater.classList.remove('payoff-flash'); if (theaterGlow) theaterGlow.style.transition = ''; }, 650);

  // Afterglow: a slow-fading warm wash instead of snapping straight back to
  // normal, so the peak lingers a little rather than cutting off instantly.
  theater.classList.remove('afterglow');
  void theater.offsetWidth; // force reflow so the animation restarts if one was already fading
  theater.style.setProperty('--afterglow-duration', (milestoneCount ? 22 : 10 + tier.flash * 4) + 's');
  theater.classList.add('afterglow');

  uiFlare();
  playChimeSound(tier.chime);
  playBassDropSound(tier.bass);
  burstExtraFloaters(tier.burst);
  if (wasAtRisk) playClutchSting();
  if (Math.random() < 0.12 * tier.flash) fireColorSplashPiece(); // bigger tiers roll a bit more often
  // Medium+ also lights a couple of tiles with a visual FX moment, and a
  // short burst of mantra text rides along with anything mega or bigger.
  if (tier.name !== 'small') fireRandomTileFx(tier.shake ? 3 : 2);
  if (tier.shake) mantraBurst(3);
  const label = milestoneCount ? ('🏆 MILESTONE: ' + milestoneCount + ' JACKPOTS!') : '🎰 ' + (tier.name === 'mega' ? 'MEGA JACKPOT' : tier.name === 'medium' ? 'Jackpot!' : 'Jackpot');
  const prefix = (chainDepth > 0 ? '⛓ CHAIN! ' : '') + (wasAtRisk ? '🔥 SAVED! ' : '');
  // Explicitly ties the screen-shake to what just happened, in the same
  // message that fires at the same moment the shake does - the shake
  // alone (even with the tier-reveal text) apparently wasn't making that
  // connection obvious on its own.
  const shakeNote = tier.shake ? ' 💥 (mega+ jackpots shake the screen)' : '';
  toast(prefix + label + shakeNote + (streak > 1 ? ' (streak ' + streak + ')' : ''));
  if (!willChain) showPushLuckPrompt();
}

// Press-your-luck: after a payoff settles, a short voluntary window to
// either bank the win as-is or push for a second roll that can grant a
// bonus or cost the current streak. Entirely optional - doing nothing
// auto-banks, so there's no penalty for ignoring it.
const PUSH_LUCK_WINDOW_MS = 6000;
let pushLuckTimer = null;

function showPushLuckPrompt() {
  if (pushLuckTimer) bankWin(true); // a prior prompt was still open; settle it quietly first
  const box = document.getElementById('push-luck-prompt');
  if (!box) return;
  box.style.display = 'flex';
  void box.offsetWidth; // force reflow so the entrance transition actually plays instead of snapping in
  box.classList.add('show');
  const fill = box.querySelector('.push-luck-timer-fill');
  if (fill) {
    fill.style.transition = 'none';
    fill.style.width = '100%';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + (PUSH_LUCK_WINDOW_MS / 1000) + 's linear';
    fill.style.width = '0%';
  }
  pushLuckTimer = setTimeout(() => bankWin(), PUSH_LUCK_WINDOW_MS);
}

function hidePushLuckPrompt() {
  const box = document.getElementById('push-luck-prompt');
  if (box) {
    box.classList.remove('show');
    setTimeout(() => { if (!box.classList.contains('show')) box.style.display = 'none'; }, 260);
  }
  clearTimeout(pushLuckTimer);
  pushLuckTimer = null;
}

function bankWin(quiet) {
  hidePushLuckPrompt();
  if (!quiet) toast('🏦 Banked.');
}

// ---- Choice Moments ----
// A periodic, entirely optional prompt offering a real decision about
// where things go next - distinct from push-your-luck (bank/push a
// payoff you already earned) and from the Recalibrate/Vibe-Dial
// mechanics it reuses under the hood: this is the direct, player-facing
// moment of agency over Core content direction. Ignoring it costs
// nothing and it just fades away, same "no penalty for doing nothing"
// philosophy as push-your-luck.
let choiceMomentTimer = null;

function maybeTriggerChoiceMoment() {
  if (choiceMomentTimer) return; // one at a time
  if (Math.random() < TUNING.CHOICE_MOMENT_PROBABILITY) showChoiceMoment();
}
startTunableInterval('CHOICE_MOMENT_CHECK_MS', maybeTriggerChoiceMoment);

function showChoiceMoment() {
  const box = document.getElementById('choice-moment-prompt');
  if (!box) return;
  box.style.display = 'flex';
  void box.offsetWidth;
  box.classList.add('show');
  const fill = box.querySelector('.choice-moment-timer-fill');
  if (fill) {
    fill.style.transition = 'none';
    fill.style.width = '100%';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + (TUNING.CHOICE_MOMENT_WINDOW_MS / 1000) + 's linear';
    fill.style.width = '0%';
  }
  choiceMomentTimer = setTimeout(hideChoiceMoment, TUNING.CHOICE_MOMENT_WINDOW_MS);
}

function hideChoiceMoment() {
  const box = document.getElementById('choice-moment-prompt');
  if (box) {
    box.classList.remove('show');
    setTimeout(() => { if (!box.classList.contains('show')) box.style.display = 'none'; }, 260);
  }
  clearTimeout(choiceMomentTimer);
  choiceMomentTimer = null;
}

function chooseMoment(kind) {
  hideChoiceMoment();
  markInteraction();
  awardXp(TUNING.CHOICE_MOMENT_XP);
  if (kind === 'more') {
    toast('🔥 More like this');
    if (!autopilotEnabled) applyVibeDial(Math.max(0, vibeDialValue - 0.5));
  } else if (kind === 'new') {
    toast('🌱 Something different');
    fetch('/api/skip');
    if (!autopilotEnabled) applyVibeDial(Math.min(2.5, vibeDialValue + 0.5));
  } else {
    toast('🎲 Surprise me!');
    fetch('/api/skip');
    fireColorSplashPiece('confetti');
  }
}

function pushLuck() {
  hidePushLuckPrompt();
  const won = Math.random() < 0.5;
  if (won) {
    const bonus = Math.round(25 * comboMultiplier());
    awardXp(bonus);
    burstExtraFloaters(0.6);
    playChimeSound(0.8);
    toast('🎉 Pushed and won +' + bonus + 'xp!');
  } else {
    jackpotStreak = 0;
    const el = document.getElementById('jackpot-streak');
    if (el) el.innerText = '';
    toast('💥 Pushed and lost the streak!', true);
  }
}

// Set when a real (server-driven) build-up starts, read once by runPayoff
// when the reveal fires - so the visual tier always matches the tier the
// server actually used to decide tile_count/jackpot_picks/speed, instead
// of an independent random guess made at the same time. Cleared after
// use so a chain re-trigger (or a later "surprise" jackpot with no
// build-up at all) falls back to its own random tier as before.
let pendingServerTier = null;

function handleAnticipationStatus(d) {
  if (anticipationFxEnabled) {
    // d.barrage is now ticks remaining in the server's hype window (0.5s
    // each), not a small count of screens still left to force-rotate - so
    // the duration here is a direct unit conversion, not the old loose
    // *1.8 fudge factor. d.barrage_tiles names the actual screens getting
    // real content, so the "something's choosing" glow highlights the
    // tiles that are really about to change instead of a disconnected
    // random guess.
    if (d.barrage > 0 && !anticipationActive) {
      pendingServerTier = d.barrage_tier || null;
      runAnticipationBuildUp(Math.max(1.5, d.barrage * 0.5), true, d.barrage_tiles || [], pendingServerTier);
    }
    if (d.jackpot && !lastKnownJackpot) {
      runPayoff();
    }
  }
  lastKnownBarrage = d.barrage;
  lastKnownBarrageTiles = d.barrage > 0 ? (d.barrage_tiles || []) : [];
  lastKnownJackpot = d.jackpot;
}

// Adaptive personalization: the longer a session runs uninterrupted, the
// more often near-misses/bonus windows fire - ramping 1x to 2x over the
// first 30 minutes - instead of a flat rate regardless of how locked-in
// the viewer already is.
const ENGAGEMENT_RAMP_MS = 30 * 60 * 1000;
const sessionStartedAt = Date.now();

function engagementMultiplier() {
  const elapsed = Date.now() - sessionStartedAt;
  return 1 + Math.min(1, elapsed / ENGAGEMENT_RAMP_MS);
}

// Golden Hour: a randomized ~20-minute FOMO window, scheduled once per day
// and persisted, during which near-miss/bonus-window odds get an extra
// boost and a badge says so - there to reward happening to be present for
// it, not to pull anyone in from outside (nothing here notifies off-app).
const GOLDEN_HOUR_STORAGE_KEY = 'mm_golden_hour';
const GOLDEN_HOUR_DURATION_MS = 20 * 60 * 1000;
let goldenHourStart = 0;

function scheduleGoldenHour() {
  try {
    const saved = JSON.parse(localStorage.getItem(GOLDEN_HOUR_STORAGE_KEY) || '{}');
    const today = new Date().toDateString();
    if (saved.day === today && saved.start) {
      goldenHourStart = saved.start;
      return;
    }
  } catch (e) {}
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Anywhere from now (if already past some of the day) through end of day.
  const earliest = Math.max(now.getTime(), dayStart);
  const latest = dayStart + 24 * 60 * 60 * 1000 - GOLDEN_HOUR_DURATION_MS;
  goldenHourStart = latest > earliest ? (earliest + Math.random() * (latest - earliest)) : now.getTime();
  try {
    localStorage.setItem(GOLDEN_HOUR_STORAGE_KEY, JSON.stringify({ day: now.toDateString(), start: goldenHourStart }));
  } catch (e) {}
}

function isGoldenHourActive() {
  const now = Date.now();
  return now >= goldenHourStart && now < goldenHourStart + GOLDEN_HOUR_DURATION_MS;
}

function tickGoldenHour() {
  const badge = document.getElementById('golden-hour-badge');
  if (!badge) return;
  badge.classList.toggle('show', isGoldenHourActive());
}

// Surge: a short, unscheduled surprise window (unlike Golden Hour's fixed
// daily slot) that randomly doubles the same odds for a minute or two -
// stacks unscheduled variable-ratio surprise on top of the scheduled one.
const SURGE_CHECK_MS = 20000;
const SURGE_PROBABILITY = 0.08;
const SURGE_DURATION_RANGE_MS = [60000, 90000];
let surgeExpireAt = 0;

// surgeExpireAt doubles as "when the last surge ended" - Overdrive, Spin
// Surge and Finale all extend it too, so a random surge also rests after
// those. A 36-minute session had random surges (60-90s each) running
// roughly every 4 minutes on top of Overdrive's own.
function maybeTriggerSurge() {
  if (Date.now() < surgeExpireAt + TUNING.SURGE_COOLDOWN_MS) return;
  if (Math.random() < SURGE_PROBABILITY) {
    const [lo, hi] = SURGE_DURATION_RANGE_MS;
    surgeExpireAt = Date.now() + lo + Math.random() * (hi - lo);
    toast('⚡ Surge! Odds doubled for a bit');
  }
}

function isSurgeActive() {
  return Date.now() < surgeExpireAt;
}

function tickSurgeBadge() {
  const badge = document.getElementById('surge-badge');
  if (!badge) return;
  badge.classList.toggle('show', isSurgeActive());
}

function oddsMultiplier() {
  // These stack multiplicatively and can combine into a huge number (up to
  // ~30x at the extreme), which was pushing fake-near-miss/bonus-window
  // odds past 100% per check - firing the expensive per-tile glow loop on
  // almost every 15s tick instead of occasionally, which showed up as
  // frequent playback lag. Capped so the boosts still stack and feel
  // noticeable without letting the triggers run back-to-back.
  const raw = engagementMultiplier()
    * (isGoldenHourActive() ? TUNING.GOLDEN_HOUR_MULTIPLIER : 1)
    * (isSurgeActive() ? TUNING.SURGE_MULTIPLIER : 1)
    * comboMultiplier()
    * (1 + jackpotHeat * 0.15) // catch streaks/bonus taps nudge this up too, see bumpJackpotHeat
    * (1 + heartMultiplier * 0.08) // hearts nudge it too, see bumpHeartMultiplier
    * (1 + autopilotAmbientBoost) // Auto-Pilot's climax phase nudges it too, see autopilotTick
    * (1 + finaleAmbientBoost()); // so does Finale's build/peak, see dashboard_layers.js
  return Math.min(3, raw);
}

const NEAR_MISS_COOLDOWN_MS = 20000;
let lastNearMissAt = 0;

function maybeTriggerFakeNearMiss() {
  if (!anticipationFxEnabled || !nearMissEnabled || anticipationActive) return;
  if (lastKnownBarrage > 0 || lastKnownJackpot) return; // don't step on a real one
  if (Date.now() - lastNearMissAt < NEAR_MISS_COOLDOWN_MS) return; // even at max odds, leave breathing room
  if (Math.random() < FAKE_NEAR_MISS_PROBABILITY * oddsMultiplier()) {
    lastNearMissAt = Date.now();
    runAnticipationBuildUp(FAKE_NEAR_MISS_BUILD_S, false);
  }
}
