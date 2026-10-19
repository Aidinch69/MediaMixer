// ---- Event log ----
// Records what fires, when, and alongside what, so tuning can be based on
// what actually happened rather than feel - read back on the /debug page.
// Loaded LAST: it observes the other dashboard files from outside rather
// than threading log calls through them. Two mechanisms:
//   - state watchers: sampled every 500ms, log `<name>.start` / `.end`
//     (with duration) for anything that switches on and off - this also
//     catches effects started from inside async callbacks;
//   - action wrappers: re-point a global function at a wrapper that logs
//     only when the call visibly succeeded (state before vs. after).
// Top-level function declarations in classic scripts are global bindings,
// so re-assigning one here also redirects calls made inside the other
// files. Everything is wrapped in try/catch: telemetry must never be the
// reason the playground breaks.

const TELEMETRY_FLUSH_MS = 5000;
const TELEMETRY_SAMPLE_MS = 500;
let telemetryQueue = [];

function logEvent(kind, data) {
  telemetryQueue.push(data === undefined ? { t: Date.now(), k: kind } : { t: Date.now(), k: kind, d: data });
  if (telemetryQueue.length > 2000) telemetryQueue.splice(0, telemetryQueue.length - 2000);
}

function flushTelemetry(useBeacon) {
  if (!telemetryQueue.length) return;
  const batch = telemetryQueue.splice(0, 500);
  const body = JSON.stringify({ events: batch });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
    return;
  }
  fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
    .catch(() => { telemetryQueue = batch.concat(telemetryQueue); }); // engine restarting - retry next flush
}

// ---- state watchers ----
// get() returns null when the thing is off, or any other value when on
// (a change between two non-null values logs `.change`).
const TELEMETRY_WATCHERS = [
  ['barrage', () => (lastKnownBarrage > 0 ? (pendingServerTier || 'on') : null)],
  ['jackpot', () => (lastKnownJackpot ? 'on' : null)],
  ['buildup', () => (anticipationActive ? 'on' : null)],
  ['bonus', () => (bonusWindowTileIndex >= 0 ? bonusWindowTileIndex : null)],
  ['sealed', () => (sealedTileIndex >= 0 ? sealedTileIndex : null)],
  ['chase', () => (chaseFlashTileIndex >= 0 ? chaseFlashTileIndex : null)],
  ['mystery', () => (mysteryTileIndex >= 0 ? mysteryTileIndex : null)],
  ['spotlight', () => (spotlightTileIndex >= 0 ? spotlightTileIndex : null)],
  ['spiral', () => (spiralActive ? 'on' : null)],
  ['colorRush', () => (colorRushActive ? 'on' : null)],
  ['surge', () => (Date.now() < surgeExpireAt ? 'on' : null)],
  ['spinSurge', () => (Date.now() < spinSurgeEndsAt ? 'on' : null)],
  ['hiddenMult', () => (Date.now() < hiddenMultExpireAt ? 'on' : null)],
  ['overdrive', () => (overdriveActive ? 'on' : null)],
  ['finale', () => (finaleActive ? 'on' : null)],
  ['rhythm', () => (rhythmEnabled || rhythmZoneActive ? 'on' : null)],
  ['autopilot', () => (autopilotEnabled ? 'on' : null)],
  ['zone', () => autopilotZone || null],
  ['layout', () => currentLayout || null],
];
const telemetryWatchState = {};

function sampleTelemetryWatchers() {
  const now = Date.now();
  for (const [name, get] of TELEMETRY_WATCHERS) {
    let value;
    try { value = get(); } catch (e) { continue; } // a global this build doesn't have
    if (value === undefined) value = null;
    const prev = telemetryWatchState[name];
    if (prev === undefined) { telemetryWatchState[name] = { value, since: now }; if (value !== null) logEvent(name + '.start', { v: value, initial: true }); continue; }
    if (prev.value === value) continue;
    if (prev.value === null) logEvent(name + '.start', { v: value });
    else if (value === null) logEvent(name + '.end', { v: prev.value, ms: now - prev.since });
    else logEvent(name + '.change', { from: prev.value, to: value, ms: now - prev.since });
    telemetryWatchState[name] = { value, since: now };
  }
}

// ---- action wrappers ----
// spec(args, before) runs after the original call; `before` is whatever
// snap() captured just before it. Returning undefined logs nothing.
function telemetryWrap(name, snap, spec) {
  const original = window[name];
  if (typeof original !== 'function') return;
  window[name] = function (...args) {
    let before;
    try { before = snap ? snap(...args) : undefined; } catch (e) {}
    const result = original.apply(this, args);
    try {
      const out = spec(args, before, result);
      if (out) logEvent(out.k, out.d);
    } catch (e) {}
    return result;
  };
}

function initTelemetry() {
  // Tile claims/catches/misses: success = the tile's slot actually cleared.
  telemetryWrap('claimBonusTile', () => bonusWindowTileIndex,
    ([idx], before) => (before === idx && bonusWindowTileIndex !== idx ? { k: 'bonus.claim', d: { tile: idx } } : undefined));
  telemetryWrap('openSealedTile', () => sealedTileIndex,
    ([idx], before) => (before === idx && sealedTileIndex !== idx ? { k: 'sealed.open', d: { tile: idx } } : undefined));
  telemetryWrap('missSealedTile', () => sealedTileIndex,
    ([idx], before) => (before === idx ? { k: 'sealed.miss', d: { tile: idx } } : undefined));
  telemetryWrap('catchChaseFlash', () => chaseFlashTileIndex,
    ([idx], before) => (before === idx && chaseFlashTileIndex !== idx ? { k: 'chase.catch', d: { tile: idx, chain: chaseChain } } : undefined));
  telemetryWrap('missChaseFlash', () => chaseChain,
    ([idx], chainBefore) => ({ k: 'chase.miss', d: { tile: idx, lostChain: chainBefore } }));

  // Rewards and payoffs.
  telemetryWrap('awardXp', null, ([amount]) => (amount ? { k: 'xp', d: { amount } } : undefined));
  telemetryWrap('applyPayoffEffects', null, ([tier, streak, milestones, wasAtRisk, chainDepth]) => ({
    k: 'payoff', d: { tier: tier && tier.name, shake: !!(tier && tier.shake), streak, chainDepth },
  }));
  telemetryWrap('triggerMiniPayoff', null, ([idx]) => ({ k: 'payoff.mini', d: { tile: idx } }));
  telemetryWrap('runAnticipationBuildUp', null, ([durationS, isReal, tiles, tier]) => ({
    k: isReal ? 'buildup.real' : 'buildup.fake', d: { s: Math.round(durationS * 10) / 10, tier: tier || null },
  }));
  telemetryWrap('maybeTriggerFakeNearMiss', () => lastNearMissAt,
    (args, before) => (lastNearMissAt !== before ? { k: 'nearmiss.fake' } : undefined));
  telemetryWrap('fireTileFx', null, ([idx, kind], before, fired) => (fired ? { k: 'fx.tile', d: { tile: idx, kind } } : undefined));
  telemetryWrap('fireColorSplashPiece', () => colorRushActive,
    ([piece], rushing) => (rushing ? undefined : { k: 'splash.piece', d: { piece: piece || 'random' } }));
  telemetryWrap('showMantra', null, ([style]) => ({ k: 'mantra', d: { style } }));

  // Spin / bank-or-push.
  telemetryWrap('spin', null, () => ({ k: 'spin' }));
  telemetryWrap('showSpinResult', null, ([text]) => ({ k: 'spin.result', d: { text: String(text).slice(0, 60) } }));
  telemetryWrap('bankWin', null, ([quiet]) => ({ k: 'push.bank', d: { auto: !!quiet } }));
  telemetryWrap('pushLuck', null, () => ({ k: 'push.push' }));

  // Viewer actions.
  telemetryWrap('rateScreen', null, ([i, dir, btn, strength]) => ({ k: 'rate', d: { tile: i, dir, strength: strength || 1 } }));
  telemetryWrap('pace', null, ([v, quiet]) => ({ k: 'pace', d: { v, auto: !!quiet } }));
  telemetryWrap('skip', null, () => ({ k: 'skip' }));
  telemetryWrap('switchItUp', null, () => ({ k: 'zone.switchItUp' }));
  telemetryWrap('rollNewAutopilotZone', () => autopilotZone,
    (args, before) => ({ k: 'zone.forced', d: { from: before, to: autopilotZone } }));

  logEvent('session.open', { w: window.innerWidth, h: window.innerHeight, tiles: tileElements.length });
  sampleTelemetryWatchers();
  setInterval(sampleTelemetryWatchers, TELEMETRY_SAMPLE_MS);
  setInterval(() => flushTelemetry(false), TELEMETRY_FLUSH_MS);
  addEventListener('pagehide', () => { logEvent('session.hide'); flushTelemetry(true); });
  document.addEventListener('visibilitychange', () => {
    logEvent(document.hidden ? 'session.hide' : 'session.show');
    if (document.hidden) flushTelemetry(true);
  });
}

initTelemetry();
