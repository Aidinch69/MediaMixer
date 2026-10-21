// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Top status bar and mode badge.

// Plain-language readout of whatever's currently active, in priority
// order (most specific/time-limited first) - see #status-bar's CSS
// comment for why this exists. Polled rather than purely event-driven
// so it self-corrects if a state ends without an explicit "clear" path
// ever running (e.g. a tab backgrounded through a setTimeout).
function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  if (!bar) return;
  let text = null;
  // anticipationActive used to also show its own "building" text here,
  // duplicating updateModeBadge's persistent "🎰 Building..." badge at
  // the same time - two notifications for the one event read as a
  // glitch, not as two separate pieces of information. The mode-badge
  // already owns this (and already names the tier once known), so this
  // rotating bar just stays on whatever's next in line during a build-up.
  if (sealedTileIndex >= 0) {
    text = '🔒 Sealed tile - open it to see what\'s inside!';
  } else if (bonusWindowTileIndex >= 0) {
    text = '✨ Bonus tile glowing - tap it before it fades!';
  } else if (chaseFlashTileIndex >= 0) {
    text = '🏃 Chase it! Tap the flash before it hops' + (chaseChain > 0 ? ' (chain x' + chaseChain + ')' : '');
  } else if (mysteryTileIndex >= 0) {
    text = '🔮 Mystery tile - just a curiosity, nothing behind it';
  } else if (isSurgeActive()) {
    text = '⚡ Surge - odds boosted for a bit';
  } else if (isGoldenHourActive()) {
    text = '✨ Golden Hour - better odds while it lasts';
  } else if (dueAuraTileIndex >= 0) {
    text = '💤 A tile hasn\'t been rated in a while - 👍/👎 it, or tap its glow to dismiss';
  }
  if (text) {
    bar.innerText = text;
    bar.classList.add('show');
  } else {
    bar.classList.remove('show');
  }
}
setInterval(updateStatusBar, 1000);

// A separate, persistent "what mode/jackpot state is this" readout,
// distinct from the status bar above - that bar cycles through whatever
// transient prompt has priority right now (a bonus tile, due-aura, a
// mystery tile...), which could bury "a build-up toward a medium jackpot
// is running" under some unrelated one-off notice. This stays fixed on
// the ongoing jackpot context (an active build-up, or a live streak)
// while the status bar keeps rotating through its own notifications.
function updateModeBadge() {
  const el = document.getElementById('mode-badge');
  if (!el) return;
  let text = null;
  if (anticipationActive) {
    text = pendingServerTier ? ('🎰 ' + pendingServerTier.toUpperCase() + ' building...') : '🎰 Building...';
  } else if (finaleActive) {
    text = finaleStatusText();
  } else if (jackpotStreak > 1 && Date.now() - lastJackpotAt < TUNING.STREAK_RESET_MS) {
    text = '🔥 Jackpot streak x' + jackpotStreak;
  } else if (heartMultiplier >= 2) {
    text = '❤️ Heart multiplier x' + Math.floor(heartMultiplier);
  } else if (jackpotHeat > 1.2) {
    // Otherwise bumpJackpotHeat's whole effect (catch streaks/bonus taps
    // nudging odds toward bigger jackpots) would be invisible - nothing
    // to notice means nothing to feel rewarded by.
    text = '🔥 Odds heating up';
  }
  // Auto-Pilot's zone/phrase used to be this badge's lowest-priority
  // fallback - which meant it vanished behind a jackpot streak, heart
  // multiplier, or heating-odds badge any time one of those was also
  // active, reported as the zone readout "hiding." It now has its own
  // permanent spot (#autopilot-zone-live, in the status-badges row) that
  // doesn't compete with this badge's own jackpot-specific priority
  // chain at all - see updateAutopilotZoneLive.
  if (text) {
    el.innerText = text;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}
setInterval(updateModeBadge, 1000);

// Its own permanent spot, independent of mode-badge's jackpot-specific
// priority chain - shows whenever Auto-Pilot has a live zone, full stop,
// instead of being bumped off by a jackpot streak/heat/heart-multiplier
// badge that happens to also be active at the same time.
function updateAutopilotZoneLive() {
  const el = document.getElementById('autopilot-zone-live');
  if (!el) return;
  if (finaleActive) {
    el.innerText = finaleStatusText();
    el.style.display = '';
  } else if (autopilotEnabled && autopilotZone) {
    el.innerText = '🎬 ' + AUTOPILOT_ZONES[autopilotZone].label + (autopilotCurrentStatusPhrase ? ' · ' + autopilotCurrentStatusPhrase : '');
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}
setInterval(updateAutopilotZoneLive, 1000);
