// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Auto-Pilot: arc keyframes, zones and the zone bandit, engagement signal, retention beat, and Dynamic Mosaic.

// ---- Auto-Pilot (experimental) ----
// A scripted session arc - calm, then building, a climax, then cooldown,
// repeating - that ramps pace, barrage/jackpot odds, and the floating-
// overlay count over time instead of those staying wherever you last
// set them. Driven entirely from this tab by re-using the existing
// per-session controls (pace(), /api/intensity, setFxCount), so it has
// no server-side component of its own. Deliberately does NOT touch
// Mosaic Fit (mosaicEnabled) - that used to ramp on/off with the arc too,
// but per explicit feedback Auto-Pilot no longer gets to flip it; it
// stays exactly wherever the viewer last set it manually.
const AUTOPILOT_TICK_MS = 4000;
// Polyrhythm: fx and ambient ride their own cycle length instead of the
// exact same one pace/barrage/jackpot/novelty share, so the combined
// texture keeps evolving cycle to cycle instead of everything peaking
// and bottoming out in lockstep every single time.
const FX_PERIOD_MULT = 1.3;
const AMBIENT_PERIOD_MULT = 0.7;
// Cycle length itself drifts slowly within +/-20% of the slider value
// instead of being perfectly constant, so the macro tempo doesn't feel
// metronomically exact either. A deliberately non-round drift period
// (17 real minutes) so the drift's own rhythm doesn't line up neatly
// with the cycle length a typical viewer would pick.
const CYCLE_DRIFT_FRAC = 0.2;
const CYCLE_DRIFT_PERIOD_MS = 17 * 60000;
// A rare, brief head-fake while climbing toward a climax - not just
// surface flourish, an actual temporary dip in the real curve.
const FAKEOUT_PROBABILITY_PER_TICK = 0.015;
const FAKEOUT_DURATION_MS = 6000;
const FAKEOUT_MULT = 0.3;
// Multi-cycle "season": every 3rd cycle gets a raised ceiling, but only
// once the library's actually accumulated some real hearted history
// (statsLifetimeHearts) - ties the meta-arc to actual content-layer
// progress instead of being pure abstract timing.
const SEASON_EVERY_N = 3;
const SEASON_CEILING_MULT = 1.3;
const SEASON_CONTENT_THRESHOLD = 5;

let autopilotLastMainFrac = 0;
let autopilotCycleCount = 0;
let autopilotToneFiredThisCycle = false;
let autopilotFakeoutActive = false;
let autopilotFakeoutUntil = 0;
let autopilotCurrentStatusPhrase = '';
let autopilotStatusPhraseSetAt = 0;
// The underlying trendingUp/trendingDown read is genuinely noisy tick to
// tick (engagement fluctuates in small, normal ways even when nothing
// meaningful changed) - fine for the subtle bias nudges it also drives,
// but displayed as text it read as "uncertainly hunting between states"
// (real feedback). Trend-derived phrases get a minimum hold before the
// display is allowed to change again; retention-beat phrases are real,
// deliberate state transitions (driven by their own timing, not tick
// noise) and always take over immediately regardless of the hold.
const STATUS_PHRASE_MIN_HOLD_MS = 12000;
// "ambient" ramps every client-only passive-spawn system added since this
// arc was first written (bonus window, chase flash, near-miss, spiral-
// from-hearts) via autopilotAmbientBoost below - previously those all sat
// at their own constant background rate no matter what phase the arc was
// in, so a "climax" only ever meant more barrages/floaters, never more of
// these. Shaped like the existing barrage/jackpot curve.
// novelty baseline nudged up ~0.1 across the board (shape unchanged,
// still calm->peak->calm) per explicit feedback that discovery content
// felt a bit light - this is what Auto-Pilot itself computes from while
// running, separate from VIBE_DIAL_DEFAULT (which only governs manual
// use and what Auto-Pilot hands back on stop).
const AUTOPILOT_KEYFRAMES = [
  { t: 0.00, pace: 3, barrage: 0.01, jackpot: 0.02, fx: 1, novelty: 0.20, ambient: 0.0 },
  { t: 0.35, pace: 2, barrage: 0.03, jackpot: 0.06, fx: 2, novelty: 0.25, ambient: 0.2 },
  { t: 0.60, pace: 1, barrage: 0.10, jackpot: 0.18, fx: 4, novelty: 0.40, ambient: 0.5 },
  { t: 0.75, pace: 0, barrage: 0.22, jackpot: 0.35, fx: 6, novelty: 0.60, ambient: 0.9 },
  { t: 0.85, pace: 1, barrage: 0.08, jackpot: 0.15, fx: 3, novelty: 0.40, ambient: 0.4 },
  { t: 1.00, pace: 3, barrage: 0.01, jackpot: 0.02, fx: 1, novelty: 0.20, ambient: 0.0 },
];
// Jittered per-cycle (see regenerateJitteredKeyframes) so no two cycles
// climax at exactly the same relative moment - the live table tick
// actually reads; AUTOPILOT_KEYFRAMES above stays the pristine source.
let autopilotJitteredKeyframes = AUTOPILOT_KEYFRAMES;

function regenerateJitteredKeyframes() {
  const jitterAmt = 0.03;
  autopilotJitteredKeyframes = AUTOPILOT_KEYFRAMES.map((kf, i) => {
    if (i === 0 || i === AUTOPILOT_KEYFRAMES.length - 1) return kf; // keep the endpoints anchored
    return Object.assign({}, kf, { t: Math.max(0.01, Math.min(0.99, kf.t + (Math.random() * 2 - 1) * jitterAmt)) });
  });
}

// Per-axis easing applied to the lerp fraction before interpolating -
// previously every axis moved through the exact same linear fraction,
// so everything rose and fell in lockstep. barrage/jackpot now ease in
// (slow start, sharp rise) for a punchier-feeling climb; ambient eases
// out (quick rise, long settle); fx/novelty/pace stay linear.
const AUTOPILOT_AXIS_EASING = {
  barrage: (lf) => Math.pow(lf, 1.4),
  jackpot: (lf) => Math.pow(lf, 1.4),
  ambient: (lf) => 1 - Math.pow(1 - lf, 1.6),
  fx: (lf) => lf,
  novelty: (lf) => lf,
  pace: (lf) => lf,
};

let autopilotAmbientBoost = 0;
let autopilotEnabled = false;
let autopilotCycleMinutes = 6;
let autopilotStartTime = 0;
let autopilotTimer = null;
let autopilotLastPace = null;

// A fresh zone is picked each time the cycle wraps back to its start
// (never the same zone twice in a row) so repeat cycles lean into a
// different mix of the passive systems each time, instead of every
// climax feeling identical just because it's the same arc shape. Only
// scales the odds of things that were already going to happen somewhat
// - a "quiet" zone's systems still fire, just less often, so turning
// Auto-Pilot on never silently disables something you'd otherwise see.
// tileBias is Dynamic Mosaic's zone-driven mode reading each zone's own
// already-authored "feel" instead of computing a tile count from pace/
// heat/vibe trying to agree on one number - which direction tile count
// should move is genuinely ambiguous from a single formula (more tiles
// can mean "amping up" OR "calming down" depending on what's actually
// happening), so this sidesteps that by just hand-picking per zone:
// 'low' = few tiles (vault's patient sealed-tile hunting wants focus),
// 'high' = many tiles (jackpot/color's spectacle wants breadth), 'mid'
// = chase's reflexive middle ground.
// curveBias reshapes the *arc's* own lf for however long this zone is
// running - zones aren't just different odds tables anymore, they're
// different-feeling rides. >1 stretches the climb out (vault's patient
// build), <1 sharpens it into a faster spike (jackpot's punch).
const AUTOPILOT_ZONES = {
  chase: { label: 'Chase Zone', chase: 1.9, bonus: 1.3, sealed: 0.6, colorRush: 0.5, barrage: 1.0, tileBias: 'mid', curveBias: 1.0 },
  color: { label: 'Color Zone', chase: 0.6, bonus: 0.8, sealed: 0.8, colorRush: 2.4, barrage: 1.0, tileBias: 'high', curveBias: 0.85 },
  jackpot: { label: 'Jackpot Zone', chase: 0.7, bonus: 0.9, sealed: 1.0, colorRush: 0.7, barrage: 1.6, tileBias: 'high', curveBias: 0.7 },
  vault: { label: 'Vault Zone', chase: 0.6, bonus: 0.7, sealed: 2.2, colorRush: 0.6, barrage: 0.9, tileBias: 'low', curveBias: 1.4 },
  // Engages Rhythm Mode (beat walker, tempo waves, tap-along) for as long
  // as the zone runs, even if it's switched off manually - see
  // rhythmZoneActive in dashboard_layers.js.
  rhythm: { label: 'Rhythm Zone', chase: 0.8, bonus: 1.0, sealed: 0.7, colorRush: 0.8, barrage: 1.1, tileBias: 'mid', curveBias: 0.9, rhythm: true },
};
const AUTOPILOT_ZONE_NAMES = Object.keys(AUTOPILOT_ZONES);
function zoneMap(value) {
  const map = {};
  AUTOPILOT_ZONE_NAMES.forEach((z) => { map[z] = value; });
  return map;
}
let autopilotZone = null;
let autopilotZoneStartedAt = 0;
let autopilotPrevZone = null; // for crossfade and transition-chemistry recording
let autopilotZoneChangedAt = 0;
const ZONE_CROSSFADE_MS = 15000;

// Falls back to 1 (no-op) whenever Auto-Pilot is off, so manual play is
// never affected by zone weighting at all. Crossfades from the previous
// zone's multiplier over ZONE_CROSSFADE_MS instead of an instant snap
// the moment a new zone is picked, so a zone change doesn't yank every
// odds table to its new value in one tick.
function autopilotZoneMultiplier(key) {
  if (!autopilotZone) return 1;
  const current = AUTOPILOT_ZONES[autopilotZone][key];
  if (!autopilotPrevZone) return current;
  const age = Date.now() - autopilotZoneChangedAt;
  if (age >= ZONE_CROSSFADE_MS) return current;
  return lerp(AUTOPILOT_ZONES[autopilotPrevZone][key], current, age / ZONE_CROSSFADE_MS);
}

// A small, short-lived boost layered on top of the slow zone-satiation
// clock - current combo heat (rapid rating/catches) nudges the odds up
// a bit further right now, so a zone has its own faster ripples riding
// on top of its own slower wave instead of everything moving only on
// the satiation timescale.
function autopilotMicroBoost() {
  return 1 + Math.min(0.3, (comboMultiplier() - 1) * 0.15);
}

// ---- Engagement signal ----
// A smoothed read of how the viewer is actually responding right now -
// distinct from the scripted keyframe arc above, which has no idea what
// you're doing and never did. Nudged by real actions (hearting, chase
// catches, claims, Patience Hold, dislikes/Recalibrate/skips), decays
// back toward neutral (1.0) when nothing happens - same halflife-decay
// shape bandit.py's decayed_value already uses server-side for content
// reward, just applied here to "how into this are you right now"
// instead of "how good is this clip." Tracked unconditionally (not
// gated on Auto-Pilot being on) so it already reflects real recent
// behavior the moment Auto-Pilot gets turned on mid-session, instead of
// starting blind at neutral.
let engagementScore = 1.0;
let engagementUpdatedAt = Date.now();
let engagementPrevForTrend = 1.0;
const ENGAGEMENT_HALFLIFE_MS = 45000;
const ENGAGEMENT_MIN = 0.2;
const ENGAGEMENT_MAX = 2.2;

function decayEngagementToNow() {
  const now = Date.now();
  const elapsed = now - engagementUpdatedAt;
  engagementUpdatedAt = now;
  if (elapsed <= 0) return;
  const decay = Math.pow(0.5, elapsed / ENGAGEMENT_HALFLIFE_MS);
  engagementScore = 1.0 + (engagementScore - 1.0) * decay;
}

function nudgeEngagement(amount) {
  decayEngagementToNow();
  engagementScore = Math.max(ENGAGEMENT_MIN, Math.min(ENGAGEMENT_MAX, engagementScore + amount));
}

function readEngagement() {
  decayEngagementToNow();
  return engagementScore;
}

// A much slower session-scale EMA of the same engagement readings,
// separate from the fast-decaying one above - this is what lets a
// climax's own ceiling scale with "has this session, as a whole, been
// genuinely engaged" rather than just this moment's reading. A session
// that's been consistently engaged earns a slightly higher barrage/
// jackpot ceiling at its peaks; a flatter one gets gently capped lower
// instead of being thrown full-intensity peaks it hasn't responded to.
let sessionTrust = 1.0;
function updateSessionTrust(engagement) {
  const alpha = 0.02;
  sessionTrust = (1 - alpha) * sessionTrust + alpha * engagement;
}

// ---- Zone bandit ----
// Zones used to just rotate on a fixed timer, excluding only the last
// one used - no memory of which ones actually land for this viewer.
// zonePayoff is a learned EMA of engagementScore averaged over each
// zone's own run, persisted so the preference carries across sessions.
// zoneRecentUse is a deliberate counterweight: a zone scoring well still
// gets suppressed right after it was just used, ramping back up over
// the next few rotations - the explicit "don't just keep picking the
// one good zone forever" guard, since a learned preference with no
// exploration pressure is indistinguishable from repetition.
let zonePayoff = zoneMap(1.0);
let zoneRecentUse = zoneMap(3);
let zoneTimesPicked = zoneMap(0);
// 'fromZone>toZone' -> learned engagement EMA for that specific sequence,
// not just the destination zone in isolation - order can matter as much
// as choice (does engagement tend to rise more after Vault->Chase than
// after Vault->Color?).
let zoneTransitionPayoff = {};
const COLD_ZONE_INSURANCE_PROBABILITY = 0.12;

function loadZonePayoffPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('mm_zone_payoff') || '{}');
    AUTOPILOT_ZONE_NAMES.forEach((z) => { if (Number.isFinite(saved[z])) zonePayoff[z] = saved[z]; });
  } catch (e) {}
  try {
    const saved = JSON.parse(localStorage.getItem('mm_zone_transitions') || '{}');
    Object.keys(saved).forEach((k) => { if (Number.isFinite(saved[k])) zoneTransitionPayoff[k] = saved[k]; });
  } catch (e) {}
}

// wasDisengagedCut marks a zone that got cut short specifically because
// engagement actively dropped, not one that simply ran its course or
// hit the hard ceiling - that's a real "this didn't land" signal, worth
// remembering as worse than the instantaneous engagement reading alone
// might suggest, so a genuine miss doesn't wash out as quickly as an
// ordinary so-so showing would.
function recordZonePayoff(zoneName, engagement, wasDisengagedCut, fromZone) {
  if (!zoneName) return;
  const alpha = wasDisengagedCut ? 0.5 : 0.3;
  const effective = wasDisengagedCut ? Math.min(engagement, 0.5) : engagement;
  zonePayoff[zoneName] = (1 - alpha) * zonePayoff[zoneName] + alpha * effective;
  try { localStorage.setItem('mm_zone_payoff', JSON.stringify(zonePayoff)); } catch (e) {}
  if (fromZone) {
    const key = fromZone + '>' + zoneName;
    const prev = Number.isFinite(zoneTransitionPayoff[key]) ? zoneTransitionPayoff[key] : 1.0;
    zoneTransitionPayoff[key] = 0.7 * prev + 0.3 * effective;
    try { localStorage.setItem('mm_zone_transitions', JSON.stringify(zoneTransitionPayoff)); } catch (e) {}
  }
  AUTOPILOT_ZONE_NAMES.forEach((z) => { zoneRecentUse[z] = (z === zoneName) ? 0 : zoneRecentUse[z] + 1; });
}

// Derives a rough "what this viewer responds to" read from the learned
// zone weights - not surfaced as a standalone feature, just available
// for the status readout below.
function autopilotTemperament() {
  let best = AUTOPILOT_ZONE_NAMES[0];
  AUTOPILOT_ZONE_NAMES.forEach((z) => { if (zonePayoff[z] > zonePayoff[best]) best = z; });
  return AUTOPILOT_ZONES[best].label;
}

function pickAutopilotZone(excludeName, fromZone) {
  const names = AUTOPILOT_ZONE_NAMES.filter((z) => z !== excludeName);
  // Cold-zone insurance: occasionally ignore every learned weight and
  // just give whichever zone has been picked least this session a fair
  // shot - otherwise an unlucky first impression could bury a zone
  // under a low EMA score it then never gets picked often enough to
  // recover from.
  if (Math.random() < COLD_ZONE_INSURANCE_PROBABILITY) {
    const minPicks = Math.min(...names.map((z) => zoneTimesPicked[z]));
    const coldest = names.filter((z) => zoneTimesPicked[z] === minPicks);
    const picked = coldest[Math.floor(Math.random() * coldest.length)];
    zoneTimesPicked[picked]++;
    return picked;
  }
  const weights = names.map((z) => {
    const recencyMult = Math.min(1, zoneRecentUse[z] / 3); // ramps back to full weight over ~3 rotations
    const transKey = (fromZone || 'none') + '>' + z;
    const transPayoff = Number.isFinite(zoneTransitionPayoff[transKey]) ? zoneTransitionPayoff[transKey] : 1.0;
    const blended = zonePayoff[z] * 0.7 + transPayoff * 0.3; // mostly per-zone preference, sequence chemistry as a secondary nudge
    return Math.max(0.05, blended * (0.3 + 0.7 * recencyMult));
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < names.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { zoneTimesPicked[names[i]]++; return names[i]; }
  }
  zoneTimesPicked[names[names.length - 1]]++;
  return names[names.length - 1];
}

// ---- Boredom debt ----
// A release valve independent of the engagement/satiation logic below -
// that logic only reacts to active rejection (low engagement), but a
// long "comfortable but flat" stretch (nothing rejected, nothing new
// either) wouldn't trip it at all. This counts ticks since anything
// genuinely novel actually happened and forces a surprise once it's
// been too long, regardless of what the engagement score says.
let ticksSinceNovelty = 0;
const BOREDOM_DEBT_LIMIT = 20; // ~80s at the 4s tick rate

function markNoveltyHappened() { ticksSinceNovelty = 0; }

function maybeReleaseBoredomDebt() {
  ticksSinceNovelty++;
  if (ticksSinceNovelty < BOREDOM_DEBT_LIMIT) return;
  ticksSinceNovelty = 0;
  if (Math.random() < 0.5) fetch('/api/double_feature').then((r) => r.json()).then((d) => { if (d && d.picked) markNoveltyHappened(); });
  else if (tileElements.length) fetch('/api/true_mystery?screen=' + Math.floor(Math.random() * tileElements.length)).then((r) => r.json()).then((d) => { if (d && d.picked) markNoveltyHappened(); });
}

// ---- Step-off prediction + retention beat ----
// Deliberately has NO fixed time anchor anywhere, not even a personalized-
// but-fixed one - per explicit feedback, a session ending shouldn't feel
// like it hits a scheduled "late mode." Instead this learns roughly how
// long THIS viewer's sessions actually tend to run (an EMA of real past
// session lengths, persisted across visits) and watches for the real
// signature of someone about to step away - engagement trending down as
// that learned point approaches - rather than switching phases on a
// clock. When that signature shows up, it runs a deliberate down-then-up
// beat: ease off for a bit (a genuine breather, not a cliff), then push
// a fresh novelty injection and faster pace to try to re-hook interest -
// an attempt to extend the session, not a graceful acceptance that it's
// ending. Because typicalSessionLenMs itself keeps growing with every
// longer session, "how close to stepping off" is always relative to
// this viewer's own actual pattern, never a constant.
let typicalSessionLenMs = 25 * 60000; // seed guess, overwritten fast by real history
let sessionRetentionBeatPhase = null; // null | 'down' | 'up'
let sessionRetentionBeatStartedAt = 0;
const RETENTION_DOWN_MS = 25000;
const RETENTION_UP_MS = 35000;
// Real-session data (2026-10-19) showed the beat re-arming the instant it
// finished and firing on noise: engagement pinned near its 2.2 cap still
// dips 0.05 tick to tick, which counted as "trending down" - so ~7 of 11
// Auto-Pilot minutes were spent "Easing back" (0.7x intensity, slower
// pace) while the viewer was as engaged as the signal can show. Now it
// needs engagement to have genuinely sagged, and rests between beats.
const RETENTION_MAX_ENGAGEMENT = 1.5;
const RETENTION_COOLDOWN_MS = 5 * 60000;
let sessionRetentionBeatEndedAt = 0;

function loadSessionLengthHistory() {
  try {
    const saved = parseFloat(localStorage.getItem('mm_typical_session_ms'));
    if (Number.isFinite(saved) && saved > 60000) typicalSessionLenMs = saved;
  } catch (e) {}
}

// Fired on an actual step-away signal (tab backgrounded/closed) rather
// than a timer - a bounce under a minute isn't a real session and
// shouldn't drag the learned average down.
function recordSessionEnded() {
  const actualLenMs = Date.now() - sessionStartedAt;
  if (actualLenMs < 60000) return;
  const alpha = 0.25;
  typicalSessionLenMs = (1 - alpha) * typicalSessionLenMs + alpha * actualLenMs;
  try { localStorage.setItem('mm_typical_session_ms', typicalSessionLenMs); } catch (e) {}
}

function stepOffProximity() {
  const elapsed = Date.now() - sessionStartedAt;
  return Math.min(1.5, elapsed / Math.max(60000, typicalSessionLenMs));
}

// Call once per autopilot tick. Advances the beat state machine; the
// actual "ramp back up" push (fresh novelty, not left to chance) fires
// the moment it enters the 'up' phase.
function updateRetentionBeat(proximity, trendingDown, engagement) {
  const now = Date.now();
  if (!sessionRetentionBeatPhase) {
    if (proximity > 0.75 && trendingDown && engagement < RETENTION_MAX_ENGAGEMENT && now - sessionRetentionBeatEndedAt > RETENTION_COOLDOWN_MS) {
      sessionRetentionBeatPhase = 'down';
      sessionRetentionBeatStartedAt = now;
    }
    return;
  }
  const age = now - sessionRetentionBeatStartedAt;
  if (sessionRetentionBeatPhase === 'down' && age > RETENTION_DOWN_MS) {
    sessionRetentionBeatPhase = 'up';
    sessionRetentionBeatStartedAt = now;
    fetch('/api/double_feature').catch(() => {});
    markNoveltyHappened();
  } else if (sessionRetentionBeatPhase === 'up' && age > RETENTION_UP_MS) {
    sessionRetentionBeatPhase = null; // one full beat per approach; proximity keeps climbing if they're still here after
    sessionRetentionBeatEndedAt = now;
  }
}

// Continuous proximity bands, not discrete phases - 'opening' and
// 'deepening' are still here in spirit (low proximity leans discovery
// since the content bandit still needs data; mid proximity stays
// neutral) but there's no hard switch between them, and the retention
// beat (when active) overrides both outright.
function autopilotNoveltyBias(proximity, beatPhase, trendingUp) {
  if (beatPhase === 'down') return -0.1;
  if (beatPhase === 'up') return 0.6;
  if (proximity < 0.3) return 0.5;
  if (proximity < 0.8) return 0.0;
  return trendingUp ? 0.1 : -0.2;
}

function loadAutopilotPrefs() {
  try {
    const cyc = localStorage.getItem('mm_autopilot_minutes');
    if (cyc !== null) autopilotCycleMinutes = parseFloat(cyc);
  } catch (e) {}
  // Deliberately doesn't auto-resume "enabled" across reloads - starting an
  // open-ended ramping mode silently on page load would be surprising.
  document.getElementById('autopilot-minutes-input').value = autopilotCycleMinutes;
  document.getElementById('l-autopilot-minutes').innerText = '~' + autopilotCycleMinutes + ' min';
  document.getElementById('autopilot-toggle').innerText = 'OFF';
}

function lerp(a, b, t) { return a + (b - a) * t; }

function autopilotPhaseAt(frac, kfs) {
  kfs = kfs || autopilotJitteredKeyframes;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (frac >= kfs[i].t && frac <= kfs[i + 1].t) {
      const span = kfs[i + 1].t - kfs[i].t || 1;
      return { a: kfs[i], b: kfs[i + 1], lf: (frac - kfs[i].t) / span };
    }
  }
  return { a: kfs[0], b: kfs[0], lf: 0 };
}

function autopilotTick() {
  if (!autopilotEnabled) return;
  // Finale takes over every control this tick would otherwise drive
  // (pace, intensity, novelty, floater count) for its own one-shot arc,
  // then hands back - see finaleTick/endFinale.
  if (finaleActive) { updateAutopilotZoneUi(); return; }
  const now = Date.now();

  // Drifting cycle length: wanders slowly within +/-20% of the slider
  // value instead of being perfectly constant.
  const baseS = Math.max(30, autopilotCycleMinutes * 60);
  const driftPhase = ((now - autopilotStartTime) % CYCLE_DRIFT_PERIOD_MS) / CYCLE_DRIFT_PERIOD_MS;
  const cycleS = baseS * (1 + CYCLE_DRIFT_FRAC * Math.sin(driftPhase * Math.PI * 2));

  const elapsedS = (now - autopilotStartTime) / 1000;
  const mainFrac = (elapsedS % cycleS) / cycleS;
  if (mainFrac < autopilotLastMainFrac) {
    // Cycle wrapped - fresh jitter for the next lap, and count it for seasons.
    regenerateJitteredKeyframes();
    autopilotCycleCount++;
    autopilotToneFiredThisCycle = false;
  }
  autopilotLastMainFrac = mainFrac;

  const engagement = readEngagement();
  updateSessionTrust(engagement);
  const trendingUp = engagement > engagementPrevForTrend + 0.02;
  const trendingDown = engagement < engagementPrevForTrend - 0.02;
  engagementPrevForTrend = engagement;

  const proximity = stepOffProximity();
  updateRetentionBeat(proximity, trendingDown, engagement);

  // Zone duration is engagement-aware instead of a fixed wrap-the-cycle
  // timer - see the satiation/bandit comments above. A zone extends
  // itself while it's genuinely working, but the bar to keep extending
  // rises the longer it's already run, with a hard ceiling that fires
  // regardless of engagement - "enough of a good thing" is a real
  // limit, not just a suggestion.
  if (!autopilotZone) {
    autopilotZone = pickAutopilotZone(null, autopilotPrevZone);
    autopilotZoneStartedAt = now;
    autopilotZoneChangedAt = now;
    maybeApplyZoneDrivenMosaic(autopilotZone);
    markNoveltyHappened();
  } else {
    const zoneAgeMs = now - autopilotZoneStartedAt;
    const naturalMs = cycleS * 1000;
    // Ceiling trimmed from 2.5x to 2.0x, and the stay-bar now rises
    // faster relative to satiation (1.2 -> 1.5) - per feedback that a
    // zone could still run a bit long under genuine sustained
    // engagement, even at a short Typical Pace. A zone that's really
    // working still gets real extra room, just a tighter one.
    const hardCeilingMs = naturalMs * 2.0;
    const satiationFrac = Math.min(1.5, zoneAgeMs / hardCeilingMs);
    const stayThreshold = 1.0 + satiationFrac * 1.5; // rises toward 2.25 (near the engagement cap) as satiation climbs, faster than before
    const pastHardCeiling = zoneAgeMs > hardCeilingMs;
    const disengaged = engagement < 0.6 && zoneAgeMs > naturalMs * 0.4; // don't cut absurdly early on a brief dip
    const naturallyDue = zoneAgeMs > naturalMs && engagement < stayThreshold;
    if (pastHardCeiling || disengaged || naturallyDue) {
      const endingZone = autopilotZone;
      if (typeof logEvent === 'function') {
        logEvent('zone.decision', {
          from: endingZone,
          reason: pastHardCeiling ? 'ceiling' : disengaged ? 'disengaged' : 'natural',
          ageS: Math.round(zoneAgeMs / 1000), naturalS: Math.round(naturalMs / 1000),
          engagement: +engagement.toFixed(2), stayThreshold: +stayThreshold.toFixed(2),
        });
      }
      recordZonePayoff(endingZone, engagement, disengaged && !pastHardCeiling, autopilotPrevZone);
      // Guaranteed de-escalation: a genuine disengagement cut picks a
      // calming zone directly rather than leaving it to the bandit's
      // roll, which could unluckily land on another intense one.
      const nextZone = (disengaged && !pastHardCeiling && endingZone !== 'vault')
        ? 'vault'
        : pickAutopilotZone(endingZone, endingZone);
      if (disengaged && !pastHardCeiling) fetch('/api/double_feature').catch(() => {}); // deliberate recovery, not left to boredom debt's own schedule
      autopilotPrevZone = endingZone;
      autopilotZone = nextZone;
      autopilotZoneStartedAt = now;
      autopilotZoneChangedAt = now;
      maybeApplyZoneDrivenMosaic(autopilotZone);
      markNoveltyHappened();
    }
  }

  if (sessionRetentionBeatPhase === 'down') {
    autopilotCurrentStatusPhrase = '😌 Easing back';
    autopilotStatusPhraseSetAt = now;
  } else if (sessionRetentionBeatPhase === 'up') {
    autopilotCurrentStatusPhrase = '✨ Mixing it up';
    autopilotStatusPhraseSetAt = now;
  } else {
    const desiredTrendPhrase = trendingDown ? '🔄 Recalibrating feel' : trendingUp ? '📈 Leaning in' : '';
    if (desiredTrendPhrase !== autopilotCurrentStatusPhrase && now - autopilotStatusPhraseSetAt > STATUS_PHRASE_MIN_HOLD_MS) {
      autopilotCurrentStatusPhrase = desiredTrendPhrase;
      autopilotStatusPhraseSetAt = now;
    }
  }
  updateAutopilotZoneUi();
  maybeReleaseBoredomDebt();
  rhythmZoneActive = !!(autopilotZone && AUTOPILOT_ZONES[autopilotZone].rhythm);

  // Per-zone curveBias reshapes the arc's own progress through itself -
  // a zone isn't just a different odds table, it's a different-feeling
  // ride (vault stretches the climb out, jackpot sharpens it).
  const curveBias = autopilotZone ? AUTOPILOT_ZONES[autopilotZone].curveBias : 1.0;
  const mainCurvedFrac = Math.pow(mainFrac, curveBias);
  const { a, b, lf } = autopilotPhaseAt(mainCurvedFrac);

  // fx/ambient ride their own polyrhythm period, each getting their own
  // phase lookup instead of sharing the main lf.
  const fxCycleS = cycleS * FX_PERIOD_MULT;
  const fxFrac = (elapsedS % fxCycleS) / fxCycleS;
  const { a: fxA, b: fxB, lf: fxLf } = autopilotPhaseAt(fxFrac);
  const ambientCycleS = cycleS * AMBIENT_PERIOD_MULT;
  const ambientFrac = (elapsedS % ambientCycleS) / ambientCycleS;
  const { a: ambA, b: ambB, lf: ambLf } = autopilotPhaseAt(ambientFrac);

  // Rare head-fake while climbing: a brief real dip, not just a visual flourish.
  if (!autopilotFakeoutActive && lf > 0.3 && lf < 0.65 && Math.random() < FAKEOUT_PROBABILITY_PER_TICK) {
    autopilotFakeoutActive = true;
    autopilotFakeoutUntil = now + FAKEOUT_DURATION_MS;
  }
  if (autopilotFakeoutActive && now > autopilotFakeoutUntil) autopilotFakeoutActive = false;
  const fakeoutMult = autopilotFakeoutActive ? FAKEOUT_MULT : 1;

  // Multi-cycle season: every Nth cycle gets a raised ceiling, gated on
  // the library actually having accumulated some real hearted history.
  const isBigSeason = (autopilotCycleCount % SEASON_EVERY_N === SEASON_EVERY_N - 1) && statsLifetimeHearts >= SEASON_CONTENT_THRESHOLD;
  const seasonMult = isBigSeason ? SEASON_CEILING_MULT : 1;

  // Session trust: a session that's been consistently engaged overall
  // earns a slightly higher ceiling at its peaks than a flatter one.
  const trustMult = 0.85 + Math.min(1.5, sessionTrust) * 0.2;

  // Retention beat directly scales intensity too, not just novelty -
  // ease off for real during 'down', then genuinely push pace/odds back
  // up during 'up' instead of only nudging content novelty.
  const retentionMult = sessionRetentionBeatPhase === 'up' ? 1.4 : sessionRetentionBeatPhase === 'down' ? 0.7 : 1;

  const barrageEasedLf = AUTOPILOT_AXIS_EASING.barrage(lf);
  const jackpotEasedLf = AUTOPILOT_AXIS_EASING.jackpot(lf);
  const comboMicroBoost = autopilotMicroBoost();
  const intensityMult = autopilotZoneMultiplier('barrage') * comboMicroBoost * fakeoutMult * seasonMult * trustMult * retentionMult;
  const barrageP = lerp(a.barrage, b.barrage, barrageEasedLf) * intensityMult;
  const jackpotP = lerp(a.jackpot, b.jackpot, jackpotEasedLf) * intensityMult;

  const noveltyLean = autopilotNoveltyBias(proximity, sessionRetentionBeatPhase, trendingUp);
  const noveltyBonus = Math.max(0, lerp(a.novelty, b.novelty, AUTOPILOT_AXIS_EASING.novelty(lf)) + noveltyLean);
  const fxTarget = Math.round(lerp(fxA.fx, fxB.fx, AUTOPILOT_AXIS_EASING.fx(fxLf)));
  autopilotAmbientBoost = lerp(ambA.ambient, ambB.ambient, AUTOPILOT_AXIS_EASING.ambient(ambLf));

  // Pace decoupled from the intensity curve: still arc-driven as a base,
  // but nudged further by novelty-lean (discovery wants faster sampling,
  // familiar wants slower savoring) and by the retention beat directly
  // ("more pace" is explicitly part of the re-hook push).
  let targetPace = lf < 0.5 ? a.pace : b.pace;
  if (sessionRetentionBeatPhase === 'up') targetPace = 0;
  else if (sessionRetentionBeatPhase === 'down') targetPace = Math.min(3, targetPace + 1);
  else if (noveltyLean > 0.2) targetPace = Math.max(0, targetPace - 1);
  else if (noveltyLean < -0.15) targetPace = Math.min(3, targetPace + 1);

  // A quiet audio tell right as a climax resolves into its taper, once
  // per cycle - compared against this cycle's own jittered keyframe
  // object (what autopilotPhaseAt actually hands back), not the
  // pristine source table, since jitter rebuilds fresh objects for
  // every middle keyframe each cycle.
  if (!autopilotToneFiredThisCycle && a === autopilotJitteredKeyframes[3] && lf > 0.05) {
    autopilotToneFiredThisCycle = true;
    cycleTone();
  }

  if (!overdriveActive) fetch('/api/intensity?barrage=' + barrageP.toFixed(3) + '&jackpot=' + jackpotP.toFixed(3));
  fetch('/api/novelty?bonus=' + noveltyBonus.toFixed(3));
  if (targetPace !== autopilotLastPace) { autopilotLastPace = targetPace; pace(targetPace, true); }
  if (fxCount !== fxTarget) setFxCount(fxTarget);

  if (typeof logEvent === 'function') {
    logEvent('autopilot.tick', {
      zone: autopilotZone, phrase: autopilotCurrentStatusPhrase,
      zoneAgeS: Math.round((now - autopilotZoneStartedAt) / 1000), cycleS: Math.round(cycleS), cycle: autopilotCycleCount,
      frac: +mainFrac.toFixed(3), lf: +lf.toFixed(2),
      engagement: +engagement.toFixed(2), trust: +sessionTrust.toFixed(2), proximity: +proximity.toFixed(2),
      beat: sessionRetentionBeatPhase, fakeout: autopilotFakeoutActive, season: isBigSeason,
      barrageP: +barrageP.toFixed(3), jackpotP: +jackpotP.toFixed(3), novelty: +noveltyBonus.toFixed(2),
      ambient: +autopilotAmbientBoost.toFixed(2), fx: fxTarget, pace: targetPace, debt: ticksSinceNovelty,
    });
  }
}

function updateAutopilotZoneUi() {
  const el = document.getElementById('l-autopilot-zone');
  const row = document.getElementById('autopilot-zone-row');
  if (el) el.innerText = finaleActive ? finaleStatusText() : autopilotZone ? (AUTOPILOT_ZONES[autopilotZone].label + (autopilotCurrentStatusPhrase ? ' · ' + autopilotCurrentStatusPhrase : '')) : '';
  if (row) row.style.display = autopilotZone || finaleActive ? 'flex' : 'none';
}

// Manual escape hatch: the satiation/bandit logic above has genuinely
// good judgment about when to move on, but "good judgment, eventually"
// isn't the same as "right now, if I want it" - this forces an
// immediate zone change (still recording the outgoing zone's real
// payoff, just not flagged as a disengagement cut - the viewer asking
// for a change isn't the same signal as the system detecting rejection)
// plus a fresh novelty push, instead of waiting out the satiation clock.
// Shared by the manual "Switch It Up" button and Spin's own occasional
// zone shuffle (see spin()) - forces an immediate zone change, bypassing
// the satiation/engagement logic that would otherwise decide when.
function rollNewAutopilotZone() {
  const engagement = readEngagement();
  const endingZone = autopilotZone;
  recordZonePayoff(endingZone, engagement, false, autopilotPrevZone);
  autopilotPrevZone = endingZone;
  autopilotZone = pickAutopilotZone(endingZone, endingZone);
  autopilotZoneStartedAt = Date.now();
  autopilotZoneChangedAt = Date.now();
  maybeApplyZoneDrivenMosaic(autopilotZone);
  markNoveltyHappened();
  updateAutopilotZoneUi();
}

function switchItUp() {
  if (!autopilotEnabled || !autopilotZone) { toast('🔀 Turn Auto-Pilot on first', true); return; }
  markInteraction();
  rollNewAutopilotZone();
  fetch('/api/double_feature').catch(() => {});
  toast('🔀 Switching it up - ' + AUTOPILOT_ZONES[autopilotZone].label);
}

// A plain-text live readout of what Auto-Pilot currently thinks is
// happening and why - not meant to be polished, just enough to actually
// see the engagement/satiation/bandit machinery working instead of
// having to trust it blindly. Runs on its own timer (not gated on a
// tick firing) so it still shows a true "off" state immediately.
function updateAutopilotDebugUi() {
  const el = document.getElementById('autopilot-debug');
  if (!el) return;
  if (!autopilotEnabled) { el.innerText = 'Auto-Pilot is off.'; return; }
  const engagement = readEngagement();
  const trendArrow = engagement > engagementPrevForTrend ? ' ↑' : engagement < engagementPrevForTrend ? ' ↓' : '';
  const zoneAgeS = autopilotZone ? Math.round((Date.now() - autopilotZoneStartedAt) / 1000) : 0;
  const lines = [
    'Zone: ' + (autopilotZone ? AUTOPILOT_ZONES[autopilotZone].label : '-') + ' (' + zoneAgeS + 's in)',
    'Engagement: ' + engagement.toFixed(2) + trendArrow,
    'Session trust: ' + sessionTrust.toFixed(2),
    'Step-off proximity: ' + stepOffProximity().toFixed(2) + (sessionRetentionBeatPhase ? '  (retention beat: ' + sessionRetentionBeatPhase + ')' : ''),
    'Cycle #' + autopilotCycleCount + (autopilotFakeoutActive ? '  (fakeout active)' : ''),
    'Boredom debt: ' + ticksSinceNovelty + ' / ' + BOREDOM_DEBT_LIMIT,
    'Temperament (top zone): ' + autopilotTemperament(),
    'Zone payoff: ' + AUTOPILOT_ZONE_NAMES.map((z) => z + '=' + zonePayoff[z].toFixed(2)).join('  '),
  ];
  el.innerText = lines.join('\n');
}
setInterval(updateAutopilotDebugUi, 1000);

// ---- Dynamic Mosaic ----
// Two independent toggles rather than one auto-computed formula, since
// "ramp tile count" doesn't have one right direction - see AUTOPILOT_ZONES'
// tileBias comment. Zone-driven only matters while Auto-Pilot is on;
// ambient drift works with or without it and takes over whenever zone-
// driven isn't actively steering (so the two don't fight over the same
// layout moments apart).
let dynamicMosaicZoneMode = false;
let dynamicMosaicDriftMode = false;
let dynamicMosaicMinTiles = 2;
let dynamicMosaicMaxTiles = 16;

function layoutsInRange(min, max) {
  return (window.LAYOUT_PRESETS || []).filter((p) => p.tile_count >= min && p.tile_count <= max);
}

function pickLayoutForTileCount(targetCount) {
  const presets = window.LAYOUT_PRESETS || [];
  if (!presets.length) return null;
  let best = presets[0];
  let bestDiff = Math.abs(best.tile_count - targetCount);
  for (const p of presets) {
    const diff = Math.abs(p.tile_count - targetCount);
    if (diff < bestDiff) { best = p; bestDiff = diff; }
  }
  return best;
}

function maybeApplyZoneDrivenMosaic(zoneName) {
  if (!dynamicMosaicZoneMode || !zoneName) return;
  const bias = AUTOPILOT_ZONES[zoneName].tileBias;
  const min = dynamicMosaicMinTiles, max = dynamicMosaicMaxTiles;
  const target = bias === 'low' ? min : bias === 'high' ? max : Math.round((min + max) / 2);
  const preset = pickLayoutForTileCount(target);
  if (preset && preset.name !== currentLayout) setLayout(preset.name, true);
}

function maybeTriggerMosaicDrift() {
  if (!dynamicMosaicDriftMode) return;
  if (dynamicMosaicZoneMode && autopilotEnabled && autopilotZone) return; // zone-driven owns it right now
  if (Math.random() >= TUNING.DYNAMIC_MOSAIC_DRIFT_PROBABILITY) return;
  const candidates = layoutsInRange(dynamicMosaicMinTiles, dynamicMosaicMaxTiles).filter((p) => p.name !== currentLayout);
  if (!candidates.length) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  setLayout(pick.name, true);
}
startTunableInterval('DYNAMIC_MOSAIC_CHECK_MS', maybeTriggerMosaicDrift);

function setDynamicMosaicZoneMode(enabled) {
  dynamicMosaicZoneMode = enabled;
  saveDynamicMosaicPrefs();
}

function setDynamicMosaicDriftMode(enabled) {
  dynamicMosaicDriftMode = enabled;
  saveDynamicMosaicPrefs();
}

function setDynamicMosaicRange(min, max) {
  dynamicMosaicMinTiles = Math.max(1, parseInt(min, 10) || 1);
  dynamicMosaicMaxTiles = Math.max(dynamicMosaicMinTiles, parseInt(max, 10) || dynamicMosaicMinTiles);
  const lbl = document.getElementById('l-dynamic-mosaic-range');
  if (lbl) lbl.innerText = dynamicMosaicMinTiles + ' - ' + dynamicMosaicMaxTiles;
  saveDynamicMosaicPrefs();
}

function saveDynamicMosaicPrefs() {
  try {
    localStorage.setItem('mm_dynamic_mosaic', JSON.stringify({
      zoneMode: dynamicMosaicZoneMode, driftMode: dynamicMosaicDriftMode,
      min: dynamicMosaicMinTiles, max: dynamicMosaicMaxTiles,
    }));
  } catch (e) {}
}

function loadDynamicMosaicPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('mm_dynamic_mosaic') || '{}');
    dynamicMosaicZoneMode = !!saved.zoneMode;
    dynamicMosaicDriftMode = !!saved.driftMode;
    dynamicMosaicMinTiles = Number.isFinite(saved.min) ? saved.min : 2;
    dynamicMosaicMaxTiles = Number.isFinite(saved.max) ? saved.max : 16;
  } catch (e) {}
  const zoneBtn = document.getElementById('dynamic-mosaic-zone-toggle');
  if (zoneBtn) { zoneBtn.innerText = dynamicMosaicZoneMode ? 'ON' : 'OFF'; zoneBtn.classList.toggle('active', dynamicMosaicZoneMode); }
  const driftBtn = document.getElementById('dynamic-mosaic-drift-toggle');
  if (driftBtn) { driftBtn.innerText = dynamicMosaicDriftMode ? 'ON' : 'OFF'; driftBtn.classList.toggle('active', dynamicMosaicDriftMode); }
  const minInput = document.getElementById('dynamic-mosaic-min-input');
  if (minInput) minInput.value = dynamicMosaicMinTiles;
  const maxInput = document.getElementById('dynamic-mosaic-max-input');
  if (maxInput) maxInput.value = dynamicMosaicMaxTiles;
  const lbl = document.getElementById('l-dynamic-mosaic-range');
  if (lbl) lbl.innerText = dynamicMosaicMinTiles + ' - ' + dynamicMosaicMaxTiles;
}

function toggleDynamicMosaicZone() { setDynamicMosaicZoneMode(!dynamicMosaicZoneMode); loadDynamicMosaicPrefs(); }
function toggleDynamicMosaicDrift() { setDynamicMosaicDriftMode(!dynamicMosaicDriftMode); loadDynamicMosaicPrefs(); }

function startAutopilot() {
  autopilotStartTime = Date.now();
  autopilotLastPace = null;
  autopilotZone = null;
  autopilotPrevZone = null;
  autopilotZoneStartedAt = 0;
  autopilotZoneChangedAt = 0;
  autopilotLastMainFrac = 0;
  autopilotCycleCount = 0;
  autopilotToneFiredThisCycle = false;
  autopilotFakeoutActive = false;
  sessionRetentionBeatPhase = null;
  regenerateJitteredKeyframes();
  ticksSinceNovelty = 0;
  if (!fxEnabled) toggleFx();
  autopilotTick();
  autopilotTimer = setInterval(autopilotTick, AUTOPILOT_TICK_MS);
}

function stopAutopilot() {
  clearInterval(autopilotTimer);
  autopilotTimer = null;
  autopilotAmbientBoost = 0;
  rhythmZoneActive = false;
  if (autopilotZone) recordZonePayoff(autopilotZone, readEngagement(), false, autopilotPrevZone); // learn from however long this one actually ran, even cut short
  autopilotZone = null;
  autopilotCurrentStatusPhrase = '';
  autopilotStatusPhraseSetAt = 0;
  updateAutopilotZoneUi();
  // Auto-Pilot's arc drives novelty/exploration on its own curve while
  // running (see the ARC table's `novelty` column) - handing it back to
  // whatever the viewer had manually set on the Vibe Dial before turning
  // Auto-Pilot on, instead of just leaving the backend wherever the arc's
  // last tick happened to leave it.
  applyVibeDial(vibeDialValue);
}

function toggleAutopilot() {
  autopilotEnabled = !autopilotEnabled;
  document.getElementById('autopilot-toggle').innerText = autopilotEnabled ? 'ON' : 'OFF';
  document.getElementById('autopilot-toggle').classList.toggle('active', autopilotEnabled);
  if (autopilotEnabled) startAutopilot(); else stopAutopilot();
}

function setAutopilotMinutes(v) {
  autopilotCycleMinutes = parseFloat(v);
  document.getElementById('l-autopilot-minutes').innerText = '~' + autopilotCycleMinutes + ' min';
  try { localStorage.setItem('mm_autopilot_minutes', autopilotCycleMinutes); } catch (e) {}
}
