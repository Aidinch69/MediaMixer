// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Background timers and window.onload - loaded last of the core files.

setInterval(updateSpinButton, 1000);

window.addEventListener('resize', () => { if (mosaicEnabled) layoutMosaic(); });
setInterval(() => { if (mosaicEnabled) layoutMosaic(); }, MOSAIC_REFLOW_INTERVAL_MS);
setInterval(maybeTriggerFakeNearMiss, FAKE_NEAR_MISS_CHECK_MS);
startTunableInterval('BONUS_WINDOW_CHECK_MS', maybeTriggerBonusWindow);
startTunableInterval('CHASE_CHECK_MS', maybeTriggerChase);
setInterval(tickSessionTimer, 1000);
setInterval(tickStreakWarning, 1000);
setInterval(tickGoldenHour, 5000);
setInterval(maybeTriggerSurge, SURGE_CHECK_MS);
setInterval(tickSurgeBadge, 5000);
setInterval(tickAnticipationMeter, 1000);
setInterval(tickDueAura, 5000);
startTunableInterval('MYSTERY_TILE_CHECK_MS', maybeTriggerMysteryTile);
setInterval(maybeTriggerAmbientPulse, AMBIENT_PULSE_CHECK_MS);

// Session-opening primer: guarantee a near-miss within the first ~15-25s
// of opening the dashboard (if anticipation/near-miss are on), so a
// session never starts cold waiting for the random checks to land one.
function runSessionPrimer() {
  if (anticipationFxEnabled && nearMissEnabled && !anticipationActive && !lastKnownBarrage && !lastKnownJackpot) {
    runAnticipationBuildUp(FAKE_NEAR_MISS_BUILD_S, false);
  }
}

window.onload = () => {
  restorePanelState();
  restorePanelTab();
  buildTuningUi();
  loadMosaicPref();
  loadFxPrefs();
  loadManualSpiralPrefs();
  loadPulsePrefs();
  loadBrainwavePrefs();
  loadTastePrefs();
  loadLivingPrefs();
  loadGesturePrefs();
  loadScenes();
  loadAnticipationPrefs();
  loadAutopilotPrefs();
  loadVibeDialPref();
  loadManualSpeedPref();
  loadDynamicMosaicPrefs();
  loadZonePayoffPrefs();
  loadSessionLengthHistory();
  document.addEventListener('visibilitychange', () => { if (document.hidden) recordSessionEnded(); });
  window.addEventListener('beforeunload', recordSessionEnded);
  loadTileAudioVolumePref();
  loadSessionTimerPref();
  applyColorTheme(0);
  loadXpState();
  scheduleGoldenHour();
  loadStats();
  loadTrophies();
  loadQuests();
  checkWelcomeBackBonus();
  lastAnyPayoffAt = sessionStartedAt;
  overlayEl = document.getElementById('overlay-audio');
  loadVolumePrefs();
  initLayers();
  initEvents();
  loadSpinState();
  fetchSpiralList(); // so Spin knows up front whether there are any spirals to land on
  armAutoUnlock();
  fetch('/api/status').then(r => r.json()).then(render);
  connectStream();
  setTimeout(runSessionPrimer, 15000 + Math.random() * 10000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
};
