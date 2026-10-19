// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Engagement loops: bonus tap window, locked (sealed) tile and catch (chase flash).

// ---- Interactive bonus window ----
// Occasionally one tile gets a golden pulse; rating it 👍 within the window
// triggers a small payoff. Acting on it is what pays off, not passively
// waiting - a distinct ("operant") reward trigger from the purely passive
// jackpot/near-miss system above.
let bonusWindowTileIndex = -1;
let bonusWindowExpireAt = 0;
let bonusWindowTimer = null;

// Shared between the bonus window and chase flash below (both passive,
// ambient spawns) so they don't land at the same moment - "lets keep
// them slightly separate." Only gates a *fresh* spawn of either; doesn't
// touch chase's own hop-to-a-new-tile-after-a-catch, which is a
// continuation of an already-running chase, not a second thing starting
// at once. Spin's own activateBonusWindow call is deliberate/manual and
// bypasses this too - only the passive rolls below check it.
let lastAmbientSpawnAt = 0;

function maybeTriggerBonusWindow() {
  if (!anticipationFxEnabled) return;
  if (bonusWindowTileIndex >= 0 || !tileElements.length || spotlightTileIndex >= 0) return;
  if (Date.now() - lastAmbientSpawnAt < TUNING.AMBIENT_SPAWN_SEPARATION_MS) return;
  if (Math.random() < TUNING.BONUS_WINDOW_PROBABILITY * oddsMultiplier() * autopilotZoneMultiplier('bonus')) {
    lastAmbientSpawnAt = Date.now();
    activateBonusWindow(pickAmbientTarget());
  }
}

// Shared by the passive random roll above and the manual Spin action -
// either way, a bonus tile works the same once it's lit.
function activateBonusWindow(idx) {
  // If one's already glowing on a different tile (e.g. Spin rolled
  // "bonus" while a passive one was still active elsewhere), clear it
  // properly first - overwriting bonusWindowTileIndex without this left
  // the old tile's class on permanently, since nothing else ever
  // pointed back at it to clean it up.
  if (bonusWindowTileIndex >= 0 && bonusWindowTileIndex !== idx) {
    clearBonusWindow(bonusWindowTileIndex);
  }
  bonusWindowTileIndex = idx;
  bonusWindowExpireAt = Date.now() + TUNING.BONUS_WINDOW_DURATION_MS;
  const el = tileAmbientEls[idx];
  if (el) el.classList.add('bonus-window');
  clearTimeout(bonusWindowTimer);
  bonusWindowTimer = setTimeout(() => clearBonusWindow(idx), TUNING.BONUS_WINDOW_DURATION_MS);
}

function clearBonusWindow(idx) {
  const el = tileAmbientEls[idx];
  if (el) el.classList.remove('bonus-window');
  if (bonusWindowTileIndex === idx) bonusWindowTileIndex = -1;
  clearTimeout(bonusWindowTimer);
}

// Claiming works by tapping the glowing tile directly (see the click
// listener wired in ensureTiles), not only via the thumbs-up button -
// "tap the machine" instead of "find the right button while something's
// flashing."
const BONUS_CLAIM_CELEBRATION_MS = 2000;

function claimBonusTile(idx) {
  if (idx !== bonusWindowTileIndex || Date.now() >= bonusWindowExpireAt) return;
  clearBonusWindow(idx);
  // A ~2s rainbow pulse on the actual hit, instead of a quick white flash
  // that vanished almost as fast as it appeared - the claim itself gets
  // a real couple seconds to register and feel good, not just a blip.
  // Lives on its own tile-claim-fx element, not the shared tile-ambient-fx
  // one - that used to make the rainbow silently lose to due-aura's own
  // "animation" CSS property whenever both landed on the same tile at
  // once, leaving only a static white border (the "sometimes it just
  // goes white" report).
  const el = tileClaimEls[idx];
  if (el) {
    el.classList.add('bonus-claimed');
    setTimeout(() => el.classList.remove('bonus-claimed'), BONUS_CLAIM_CELEBRATION_MS);
  }
  const claimVid = getTileVideo(idx);
  if (claimVid) {
    setTimelineSpeedEffect(idx, claimVid, 'bonusClaim', SPEED_PRIORITY.bonusClaim, randomInRange(1.175, 1.35), TUNING.BONUS_CLAIM_SPEED_FADE_MS, BONUS_CLAIM_CELEBRATION_MS, TUNING.BONUS_CLAIM_SPEED_FADE_MS);
  }
  bumpJackpotHeat(0.5); // a smaller, flat nudge than a chase catch's - see bumpJackpotHeat
  triggerMiniPayoff(idx);
}

// ---- Sealed tile ----
// Distinct from the bonus window: there, the *trigger* is the gamble
// but tapping it in time always pays the same flat reward. Here, the
// reward itself is the gamble - the tile just glows "locked," and
// what's actually inside (XP, a speed kick, a heat bump, a bigger
// jackpot-flavored haul, or nothing at all) is only decided the moment
// you open it. Rarer and holds longer than the bonus window so it
// reads as a different, weightier kind of pull.
let sealedTileIndex = -1;
let sealedExpireAt = 0;
let sealedTimer = null;

function maybeTriggerSealedTile() {
  if (!anticipationFxEnabled) return;
  if (sealedTileIndex >= 0 || !tileElements.length || spotlightTileIndex >= 0) return;
  if (Date.now() - lastAmbientSpawnAt < TUNING.AMBIENT_SPAWN_SEPARATION_MS) return;
  if (Math.random() < TUNING.SEALED_PROBABILITY * oddsMultiplier() * autopilotZoneMultiplier('sealed')) {
    lastAmbientSpawnAt = Date.now();
    activateSealedTile(pickAmbientTarget());
  }
}

const SEALED_LOCK_DIM_OPACITY = 0.4; // matches .tile-sealed-dim::after's old CSS default

function fadeSealedDim(idx, durationMs) {
  endFadeableOverlay(tileElements[idx], 'tile-sealed-dim', 'sealed-dim', durationMs);
}

// Smoothly ramps playbackRate from wherever it currently sits to a
// (randomized) target over fadeMs, instead of the instant snap a plain
// burstTileSpeed call would give it - playbackRate has no native CSS
// transition to lean on. holdAfterMs (if given) keeps the burst window
// open that much longer past the fade itself, so a reward can ease into
// its burst speed and then actually hold there for a beat before
// render()'s own guard lets it expire back to the server-driven speed,
// the same way every other burst in this file already naturally expires.
function activateSealedTile(idx) {
  sealedTileIndex = idx;
  sealedExpireAt = Date.now() + TUNING.SEALED_DURATION_MS;
  const el = tileAmbientEls[idx];
  if (el) el.classList.add('sealed-tile');
  // Looks actually locked, not just bordered: a dim overlay on the tile
  // itself (same opacity-only technique as the mega-barrage dim, but its
  // own class so the two never fight over who gets to clear it) plus a
  // genuine slowdown.
  const tile = tileElements[idx];
  if (tile) {
    startFadeableOverlay(tile, 'tile-sealed-dim', 'sealed-dim', SEALED_LOCK_DIM_OPACITY, 0); // instant on, same as before
    tile.classList.remove('tile-sealed-missed');
  }
  const vid = getTileVideo(idx);
  if (vid) setTimelineSpeedEffect(idx, vid, 'sealedLock', SPEED_PRIORITY.sealedLock, TUNING.SEALED_LOCK_SPEED_MULT, 0, TUNING.SEALED_DURATION_MS, 0);
  clearTimeout(sealedTimer);
  sealedTimer = setTimeout(() => missSealedTile(idx), TUNING.SEALED_DURATION_MS);
}

// A miss no longer disappears the instant the tap window closes - it
// holds the locked look (still dim, still slow) for a while longer,
// genuinely un-tappable now but not yet visually resolved, before
// fading itself back to normal instead of snapping straight from
// "locked" to "normal" the moment the window expires.
function missSealedTile(idx) {
  if (idx !== sealedTileIndex) return;
  const el = tileAmbientEls[idx];
  if (el) el.classList.remove('sealed-tile'); // no longer tappable - the pulse/badge goes immediately
  const tile = tileElements[idx];
  if (tile) tile.classList.add('tile-sealed-missed'); // bottom-left "locked" label while the miss-hold plays out
  sealedTileIndex = -1;
  // One timeline effect now covers the whole hold-then-fade: replacing
  // the 'sealedLock' effect still already registered (from
  // activateSealedTile) with a fresh one holding at the same locked
  // speed for the full miss-hold, then fading to normal, means the
  // speed side no longer needs its own separate deferred call the way
  // the old tileSpeedBurstUntil-extension + setTimeout(fadeTileSpeedTo)
  // pairing did - the effect just runs its own timeline on its own.
  const vid = getTileVideo(idx);
  if (vid) setTimelineSpeedEffect(idx, vid, 'sealedLock', SPEED_PRIORITY.sealedLock, TUNING.SEALED_LOCK_SPEED_MULT, 0, TUNING.SEALED_MISS_HOLD_MS, TUNING.SEALED_MISS_FADE_MS);
  setTimeout(() => {
    if (sealedTileIndex === idx) return; // this tile got sealed again before the old hold finished - don't fade it out from under the new one
    if (tile) tile.classList.remove('tile-sealed-missed');
    fadeSealedDim(idx, TUNING.SEALED_MISS_FADE_MS);
  }, TUNING.SEALED_MISS_HOLD_MS);
}

// The actual roll: each outcome names its own odds, xp, speed range (or
// null) and heat bump (or 0) so the table itself is the whole design -
// no separate branches to keep in sync with it.
const SEALED_OUTCOMES = [
  { chance: 0.10, label: '📦 Empty...', xp: 0, speed: null, heat: 0, negative: true },
  { chance: 0.35, label: null, xp: [10, 20], speed: null, heat: 0 },
  { chance: 0.30, label: null, xp: [25, 40], speed: [1.1, 1.2], heat: 0.3 }, // tapered per direct feedback
  { chance: 0.20, label: null, xp: [15, 25], speed: [1.2, 1.35], heat: 0.8 },
  { chance: 0.05, label: '🎰 Jackpot inside!', xp: [50, 80], speed: [1.35, 1.6], heat: 1.6 },
];

function rollSealedOutcome() {
  let r = Math.random();
  for (const o of SEALED_OUTCOMES) {
    if (r < o.chance) return o;
    r -= o.chance;
  }
  return SEALED_OUTCOMES[1];
}

function openSealedTile(idx) {
  if (idx !== sealedTileIndex || Date.now() >= sealedExpireAt) return;
  const ambientEl = tileAmbientEls[idx];
  if (ambientEl) ambientEl.classList.remove('sealed-tile');
  clearTimeout(sealedTimer);
  sealedTileIndex = -1;

  const outcome = rollSealedOutcome();
  const mult = outcome.negative ? 1 : hiddenMultiplierFactor(); // nothing to double on an empty pull
  // Combo Chain Mechanics - see catchChaseFlash. An empty pull doesn't
  // feed the chain; only an actual payoff should keep it alive.
  const chainMult = outcome.negative ? 1 : registerCombo();
  const spinMult = outcome.negative ? 1 : consumeSpinDouble(); // an empty pull doesn't burn a charge
  nudgeEngagement(outcome.negative ? -0.03 : 0.08);
  const xpAmount = (Array.isArray(outcome.xp) ? Math.round(outcome.xp[0] + Math.random() * (outcome.xp[1] - outcome.xp[0])) : outcome.xp) * mult * chainMult * spinMult;
  const claimEl = tileClaimEls[idx];
  if (claimEl) {
    claimEl.classList.add('sealed-opened');
    setTimeout(() => claimEl.classList.remove('sealed-opened'), 1200);
  }
  if (xpAmount > 0) awardXp(xpAmount);
  // Unlocking fades the lock look away instead of snapping it off -
  // speed eases back to normal (or into the reward's own burst range,
  // held for the same 1800ms a plain reward burst already would) over
  // SEALED_UNLOCK_FADE_MS, same timing for the dim.
  fadeSealedDim(idx, TUNING.SEALED_UNLOCK_FADE_MS);
  const unlockVid = getTileVideo(idx);
  if (unlockVid) {
    if (outcome.speed) setTimelineSpeedEffect(idx, unlockVid, 'sealedLock', SPEED_PRIORITY.sealedLock, randomInRange(outcome.speed[0], outcome.speed[1]), TUNING.SEALED_UNLOCK_FADE_MS, 1800, 0);
    else setTimelineSpeedEffect(idx, unlockVid, 'sealedLock', SPEED_PRIORITY.sealedLock, 1, TUNING.SEALED_UNLOCK_FADE_MS, 0, 0);
  }
  if (outcome.heat > 0) bumpJackpotHeat(outcome.heat);
  playChimeSound(outcome.negative ? 0.4 : 0.7 + outcome.heat * 0.2);
  incrementQuestMetric('bonuses', 1);
  if (!outcome.negative) onEngagement('unlock', idx);
  const fxLabel = outcome.negative ? null : maybeFxReward(idx, TUNING.FX_REWARD_SEALED_CHANCE);
  const tag = (mult > 1 ? ' (hidden x' + mult + '!)' : '') + (spinMult > 1 ? ' (⚡x2)' : '') + (fxLabel ? ' · ' + fxLabel : '');
  const label = outcome.label || ('+' + xpAmount + 'xp' + (outcome.speed ? ' ⚡' : '') + tag);
  showClaimRewardLabel(idx, label);
  toast((outcome.negative ? '📦 Sealed tile was empty' : '🔓 Sealed tile: ' + label), outcome.negative);
  if (!outcome.negative && Math.random() < 0.3) fireColorSplashPiece(null, idx);
}
startTunableInterval('SEALED_CHECK_MS', maybeTriggerSealedTile);

// ---- Chase flash ----
// A fast, hopping glow you have to actually chase around the grid - tap
// it before it moves on and it immediately jumps to a new random tile
// with a growing chain count and a shrinking window, instead of sitting
// still like the bonus window above. Miss it (let it expire) and the
// chain resets to zero. Distinct from the bonus window (single slow
// static glow) and the due-aura (idle-driven, no time pressure) - this
// one is pure reflexes/chase, asked for as "another way to interact...
// makes them want to chase something."
const CHASE_CAUGHT_CELEBRATION_MS = 320; // matches .chase-caught-flash's CSS duration
let chaseFlashTileIndex = -1;
let chaseFlashExpireAt = 0;
let chaseFlashTimer = null;
let chaseChain = 0;
// Set right as a flash is missed, read by the shared ambient click
// listener in ensureTiles - a tap landing on the same tile shortly
// after it closed used to do nothing at all (the shared click handler
// found no matching active state and silently gave up), so a near-miss
// here never actually registered as "you almost had it." Short grace
// window only, not a real extended catch window.
let lastChaseMissIdx = -1;
let lastChaseMissAt = 0;
const CHASE_NEAR_MISS_GRACE_MS = 700;

function maybeTriggerChase() {
  if (!anticipationFxEnabled) return;
  if (chaseFlashTileIndex >= 0 || !tileElements.length || spotlightTileIndex >= 0) return;
  if (Date.now() - lastAmbientSpawnAt < TUNING.AMBIENT_SPAWN_SEPARATION_MS) return;
  if (Math.random() < TUNING.CHASE_PROBABILITY * oddsMultiplier() * autopilotZoneMultiplier('chase')) {
    lastAmbientSpawnAt = Date.now();
    activateChaseFlash(pickAmbientTarget());
  }
}

// Shared by every passive ambient spawn (bonus window, chase flash,
// sealed tile) - avoids landing on a tile that's already doing
// something else, so the shared ambient element and its click handler
// never has to guess which mechanic a tap was meant for.
function pickAmbientTarget(exclude) {
  const n = tileElements.length;
  if (n <= 1) return 0;
  // Bounded, not an unconditional do-while - with few tiles (e.g. a 2-tile
  // dual-screen layout) and several ambient states active at once, every
  // index can legitimately be excluded at the same time, which hung the
  // whole tab (an infinite loop on the main thread, caught live as a
  // "Page Unresponsive" dialog). After a bounded number of misses, just
  // settle for a random tile rather than guaranteeing a valid one - a
  // rare visual overlap is a far smaller problem than freezing the page.
  for (let attempt = 0; attempt < 20; attempt++) {
    const idx = Math.floor(Math.random() * n);
    if (idx !== exclude && idx !== bonusWindowTileIndex && idx !== dueAuraTileIndex && idx !== sealedTileIndex) return idx;
  }
  return Math.floor(Math.random() * n);
}

function chaseFlashDurationForChain() {
  return Math.max(TUNING.CHASE_FLASH_MIN_MS, TUNING.CHASE_FLASH_START_MS - chaseChain * 120);
}

function activateChaseFlash(idx) {
  chaseFlashTileIndex = idx;
  const durationMs = chaseFlashDurationForChain();
  chaseFlashExpireAt = Date.now() + durationMs;
  const el = tileAmbientEls[idx];
  if (el) {
    el.classList.add('chase-flash');
    // "One more": when catching this flash would land a streak milestone,
    // say so right on it - the moment the chain is most worth protecting
    // is exactly when it should be most visible what's at stake.
    const nextChain = chaseChain + 1;
    const oneAway = CHASE_MILESTONES.includes(nextChain);
    el.classList.toggle('chase-onemore', oneAway);
    const lbl = el.querySelector('.chase-onemore-label');
    if (lbl && oneAway) lbl.textContent = '🔥 1 more → x' + nextChain + ' bonus!';
  }
  clearTimeout(chaseFlashTimer);
  chaseFlashTimer = setTimeout(() => missChaseFlash(idx), durationMs);
}

function clearChaseFlashVisual(idx) {
  const el = tileAmbientEls[idx];
  if (el) el.classList.remove('chase-flash', 'chase-onemore');
  clearTimeout(chaseFlashTimer);
}

function missChaseFlash(idx) {
  if (idx !== chaseFlashTileIndex) return;
  clearChaseFlashVisual(idx);
  chaseFlashTileIndex = -1;
  lastChaseMissIdx = idx;
  lastChaseMissAt = Date.now();
  // clearChaseFlashVisual already dropped pointer-events back to none
  // with the 'chase-flash' class - this keeps the tile tappable for
  // just the grace window above so a beat-late tap can still reach the
  // click handler and register as a near-miss instead of passing
  // straight through to whatever's underneath.
  const el = tileAmbientEls[idx];
  if (el) {
    el.classList.add('near-miss-grace');
    setTimeout(() => el.classList.remove('near-miss-grace'), CHASE_NEAR_MISS_GRACE_MS);
  }
  if (chaseChain > 0) toast('💨 Chain broken (was x' + chaseChain + ')', true);
  if (chaseChain > 0 && CHASE_MILESTONES.includes(chaseChain + 1)) {
    showClaimRewardLabel(idx, '💔 1 away from the x' + (chaseChain + 1) + ' bonus!');
  }
  chaseChain = 0;
}

// Tapping the flash directly (same "tap the machine" pattern as the
// bonus window) catches it, grows the chain, and hops it to a fresh
// tile after a short beat instead of just ending the round.
function catchChaseFlash(idx) {
  if (idx !== chaseFlashTileIndex || Date.now() >= chaseFlashExpireAt) return;
  clearChaseFlashVisual(idx);
  chaseFlashTileIndex = -1;
  chaseChain++;
  nudgeEngagement(0.1);
  if (chaseChain > statsBestChaseChain) {
    statsBestChaseChain = chaseChain;
    saveStats();
    checkTrophies();
  }
  // A quick, punchy cyan-to-gold pop on its own tile-claim-fx element -
  // a different flavor of "that felt good" from the bonus tap's slow
  // rainbow, matching chase's faster, more reflex-driven pace. XP grows
  // a little with the chain (5, 7, 9, ...) same as the catch window
  // shrinks - both already scale with chaseChain, just needed a visible
  // payoff to actually register as the chain climbing.
  // One pulse per catch in the current streak (capped so a long chain
  // doesn't turn into an absurdly long animation) - 1 catch is a single
  // pop, a chain of 3 is three quick pops in a row, building visually
  // the same way the chain count itself builds.
  const pulses = Math.min(chaseChain, TUNING.CHASE_CAUGHT_MAX_PULSES);
  const el = tileClaimEls[idx];
  if (el) {
    el.style.animationIterationCount = pulses;
    el.classList.add('chase-caught');
    setTimeout(() => {
      el.classList.remove('chase-caught');
      el.style.animationIterationCount = '';
    }, CHASE_CAUGHT_CELEBRATION_MS * pulses);
  }
  // Pitch creeps up very slightly with the streak too, on top of the
  // existing volume scaling - a small rising note each catch, like
  // momentum building rather than the same sound on repeat.
  playChimeSound(0.5 + Math.min(chaseChain, 5) * 0.08, 1 + Math.min(chaseChain, 10) * 0.015);
  // A speed burst on the caught tile too, same idea as the bonus tap's -
  // base 5%-15% (trimmed 5pts off both ends), plus another 5%-10%
  // (also trimmed 5pts) stacked on for every catch in the current chain
  // (capped at 8 catches' worth so it can't run away).
  const chainForSpeed = Math.min(chaseChain, 8);
  // Base increase-over-normal (was 0.05-0.15) trimmed 10%; the per-streak
  // addition on top (was 0.05-0.10) trimmed a further 5%.
  const chainSpeedExtra = chainForSpeed * (0.0375 + Math.random() * 0.0375); // tapered per direct feedback
  const chaseVid = getTileVideo(idx);
  if (chaseVid) setTimelineSpeedEffect(idx, chaseVid, 'chaseCatch', SPEED_PRIORITY.chaseCatch, randomInRange(1.045 + chainSpeedExtra, 1.125 + chainSpeedExtra), 0, CHASE_CAUGHT_CELEBRATION_MS * pulses, 0);
  const catchMult = hiddenMultiplierFactor();
  // Combo Chain Mechanics: a catch here feeds the same shared combo meter
  // rating-in-succession builds (registerCombo/comboMultiplier), so bursts
  // of activity across different mechanics - not just rapid-fire rating -
  // ramp the one multiplier together instead of each tracking its own
  // isolated streak.
  const chainMult = registerCombo();
  const spinMult = consumeSpinDouble();
  awardXp((TUNING.CHASE_XP_BASE + chaseChain * TUNING.CHASE_XP_PER_CATCH) * catchMult * chainMult * spinMult);
  incrementQuestMetric('bonuses', 1);
  onEngagement('catch', idx);
  bumpJackpotHeat(chaseChain * 0.4); // longer chains nudge the odds toward bigger jackpots - see bumpJackpotHeat
  const chainTag = (catchMult > 1 ? ' (hidden x' + catchMult + '!)' : '') + (spinMult > 1 ? ' (⚡x2)' : '');
  toast('🏃 Caught! Chain x' + chaseChain + chainTag);
  // The corner toast is easy to miss on a denser grid - right on the
  // tile that was actually caught is where attention already is.
  showClaimRewardLabel(idx, 'Chain x' + chaseChain + chainTag);
  sessionStats.catches++;
  sessionStats.bestChain = Math.max(sessionStats.bestChain, chaseChain);
  if (CHASE_MILESTONES.includes(chaseChain)) awardChaseMilestone(idx, chaseChain); // after the label above, so the milestone's own label wins
  else if (maybeFxReward(idx, TUNING.FX_REWARD_CATCH_CHANCE)) { /* label-free - the catch label is already up */ }
  if (Math.random() < 0.25) fireColorSplashPiece('tiles', idx); // small, occasional flourish - see Color Rush section
  setTimeout(() => {
    if (!tileElements.length) { chaseChain = 0; return; }
    activateChaseFlash(pickAmbientTarget(idx));
  }, TUNING.CHASE_HOP_DELAY_MS);
}
