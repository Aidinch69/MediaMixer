// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Tuning table (the backdoor master controls) and the live engine-settings UI.

// ---- Tuning (backdoor master controls) ----
// A scoped set of constants - just the ones actually iterated on this
// session (spiral opacity/timing, sealed/chase/bonus/color-rush odds,
// the various multipliers, bonus xp) - exposed as live sliders in the
// panel's Tuning tab, instead of editing source + restarting the
// server to feel out a number. Deliberately not every constant in this
// file. Every other usage site below reads TUNING.KEY instead of a
// bare constant, so a slider drag takes effect on the very next check/
// roll - no reload needed.
//
// Overrides persist in localStorage (mm_tuning_overrides) so they
// survive a reload instead of resetting to shipped defaults every
// time. A separate manual snapshot (mm_tuning_backup) lets you save a
// point you're happy with and get back to it later - independent of
// "reset to shipped defaults," which is always available below via
// TUNING_DEFAULTS.
const TUNING_DEFAULTS = {
  XP_PER_BONUS_CLAIM: 15,
  JACKPOT_HEAT_MAX: 3,
  HEART_MULT_MAX: 5,
  HIDDEN_MULT_PROBABILITY: 0.05,
  HIDDEN_MULT_DURATION_MS: 18000,
  HIDDEN_MULT_VALUE: 2,
  BONUS_WINDOW_CHECK_MS: 25000,
  BONUS_WINDOW_PROBABILITY: 0.25,
  BONUS_WINDOW_DURATION_MS: 5000,
  SEALED_CHECK_MS: 35000,
  SEALED_PROBABILITY: 0.10,
  SEALED_DURATION_MS: 6000,
  SEALED_LOCK_SPEED_MULT: 0.5,
  SEALED_MISS_HOLD_MS: 15000,
  SEALED_MISS_FADE_MS: 5000,
  SEALED_UNLOCK_FADE_MS: 3000,
  CHASE_CHECK_MS: 20000,
  CHASE_PROBABILITY: 0.22,
  CHASE_FLASH_START_MS: 2500, // was 1800 - 0 of 5 caught in real sessions, often under 3+ other effects
  CHASE_FLASH_MIN_MS: 900,
  SPIRAL_OPACITY_MIN: 0.15,
  SPIRAL_OPACITY_RANGE: 0.15,
  SPIRAL_HOLD_MIN_MS: 30000,
  SPIRAL_HOLD_RANGE_MS: 30000,
  SPIRAL_FADE_MIN_MS: 6000,
  SPIRAL_FADE_RANGE_MS: 4000,
  SPIRAL_BREATHE_PROBABILITY: 0.5,
  SPIRAL_BREATHE_INTERVAL_MS: 10000,
  COLOR_RUSH_CHECK_MS: 45000,
  COLOR_RUSH_PROBABILITY: 0.06,
  COLOR_SPLASH_CHECK_MS: 25000,
  COLOR_SPLASH_PROBABILITY: 0.12,
  RATE_XP_BASE: 2,
  CHASE_XP_BASE: 5,
  CHASE_XP_PER_CATCH: 2,
  CHASE_HOP_DELAY_MS: 450,
  CHASE_CAUGHT_MAX_PULSES: 3,
  DUE_AURA_THRESHOLD_MS: 45000,
  DUE_AURA_MIN_HOLD_MS: 15000,
  DUE_AURA_EXIT_FADE_MS: 2000,
  MYSTERY_TILE_CHECK_MS: 30000,
  MYSTERY_TILE_PROBABILITY: 0.15,
  MYSTERY_TILE_DURATION_MS: 1600,
  AMBIENT_SPAWN_SEPARATION_MS: 2500,
  JACKPOT_HEAT_DECAY_PER_TICK: 0.08,
  HEART_MULT_DECAY_PER_TICK: 0.1,
  GOLDEN_HOUR_MULTIPLIER: 2.5,
  SURGE_MULTIPLIER: 2.0,
  FLOATER_BARRAGE_CHECK_MS: 30000,
  FLOATER_BARRAGE_PROBABILITY: 0.06,
  FLOATER_BARRAGE_COOLDOWN_MS: 240000,
  FLOATER_BARRAGE_COUNT: 20,
  FLOATER_BARRAGE_MIN_MS: 10000,
  FLOATER_BARRAGE_RANGE_MS: 5000,
  FLOATER_BARRAGE_DIM: 0.85,
  FLOATER_BARRAGE_SIZE_MULT: 1.4,
  SURGE_COOLDOWN_MS: 120000, // rest after any surge ends before a random one can start
  SPIN_COOLDOWN_MS: 45000,
  PATIENCE_CHECK_MS: 15000,
  PATIENCE_HOLD_MS: 90000,
  PATIENCE_XP: 15,
  HOLD_TO_HEART_MS: 550,
  HOLD_TO_HEART_STRENGTH: 3,
  PACE_REWARD_XP: 5,
  PACE_REWARD_COOLDOWN_MS: 15000,
  CHOICE_MOMENT_CHECK_MS: 90000,
  CHOICE_MOMENT_PROBABILITY: 0.15,
  CHOICE_MOMENT_WINDOW_MS: 8000,
  CHOICE_MOMENT_XP: 10,
  LOCK_SLOWDOWN_MULT: 0.70,
  TRUE_MYSTERY_PROBABILITY: 0.35,
  DOUBLE_FEATURE_CHECK_MS: 120000,
  DOUBLE_FEATURE_PROBABILITY: 0.12,
  LAYOUT_FADE_MS: 350,
  LAYOUT_FADE_HOLD_MS: 450,
  LAYOUT_CHANGE_COOLDOWN_MS: 20000,
  DYNAMIC_MOSAIC_CHECK_MS: 10000,
  DYNAMIC_MOSAIC_DRIFT_PROBABILITY: 0.1,
  BARRAGE_SPEED_FADE_MS: 3000,
  BARRAGE_DIM_OPACITY: 0.6,
  BARRAGE_DIM_FADE_IN_MS: 1500,
  BARRAGE_DIM_FADE_OUT_MS: 3000,
  BARRAGE_DIM_SPEED_MULT: 0.65,
  BONUS_CLAIM_SPEED_FADE_MS: 2000,
  FX_REWARD_BONUS_CHANCE: 0.35,
  FX_REWARD_SEALED_CHANCE: 0.3,
  FX_REWARD_CATCH_CHANCE: 0.12,
  CHASE_MILESTONE_XP_MULT: 3,
  FRESH_DROP_CHECK_MS: 45000,
  FRESH_DROP_PROBABILITY: 0.35,
  FRESH_DROP_FIRST_DELAY_MS: 90000,
  FRESH_DROP_MIN_GAP_MS: 180000,
  FRESH_DROP_SESSION_CAP: 4,
  AUDIO_REACT_PULSE_GAP_MS: 320,
  TRANSITION_PROBABILITY: 0.9,
  TRANSITION_DURATION_MS: 600,
  TRANSITION_WEIGHT_CROSSFADE: 5,
  TRANSITION_WEIGHT_ZOOM: 3,
  TRANSITION_WEIGHT_GLITCH: 2,
  SPOTLIGHT_CHECK_MS: 60000,
  SPOTLIGHT_PROBABILITY: 0.12,
  SPOTLIGHT_MIN_GAP_MS: 480000,
  SPOTLIGHT_DURATION_MIN_MS: 15000,
  SPOTLIGHT_DURATION_RANGE_MS: 5000,
  SPOTLIGHT_SCALE: 0.85,
  SPOTLIGHT_GROW_MS: 900,
  SPOTLIGHT_DIM_OPACITY: 0.7,
  OVERDRIVE_PER_HEART: 4,
  OVERDRIVE_PER_CATCH: 6,
  OVERDRIVE_PER_BONUS: 8,
  OVERDRIVE_PER_UNLOCK: 8,
  OVERDRIVE_ON_BEAT_MULT: 2,
  OVERDRIVE_BURST_MS: 14000,
  OVERDRIVE_SPEED_MULT: 1.3,
  OVERDRIVE_BARRAGE_P: 0.35,
  OVERDRIVE_JACKPOT_P: 0.6,
  OVERDRIVE_SPOTLIGHT_CHANCE: 0.2, // was always - a takeover hid the FX landing on every other tile
  // Promoted from hardcoded constants for Master Controls (same values).
  SURGE_PROBABILITY: 0.08,
  RHYTHM_WAVE_PERIOD_MS: 80000,
  RHYTHM_WAVE_DEPTH: 0.45,
  RHYTHM_DRIVE_MIN: 0.85,
  RHYTHM_DRIVE_MAX: 1.3,
  RHYTHM_DRIVE_RISE_MS: 8000,
  RHYTHM_DRIVE_FALL_MS: 20000,
  RHYTHM_PAYOFF_GLOW_ADD: 0.07,
  RHYTHM_PAYOFF_GLOW_CAP: 0.14,
  RHYTHM_PAYOFF_GLOW_HALFLIFE_MS: 12000,
  RHYTHM_MAX_BPM: 180,
  RHYTHM_PATTERN_SWITCH_BEATS: 16,
  RHYTHM_PATTERN_SWITCH_CHANCE: 0.6,
  PULSE_SPIRAL_RATE_MIN: 0.75,
  PULSE_SPIRAL_RATE_MAX: 1.45,
  BLOOM_PEAK_OPACITY: 0.7,
  DUOTONE_PEAK_OPACITY: 0.85,
  LIGHT_LEAK_PEAK_OPACITY: 0.75,
  TASTE_PRIOR_LIKES: 4,
  TASTE_LOAD_DECAY: 0.85,
  TASTE_LOW_ENGAGEMENT: 1.4,
  AUTOPILOT_MAX_BARRAGE_P: 0.4,
  AUTOPILOT_MAX_JACKPOT_P: 0.5,
  BOREDOM_DEBT_LIMIT: 20,
  STATUS_PHRASE_MIN_HOLD_MS: 12000,
  ENGAGEMENT_HALFLIFE_MS: 45000,
  ENGAGEMENT_SOFTCAP_CURVE: 1.5,
  ENGAGEMENT_TREND_THRESHOLD: 0.12,
  ENGAGEMENT_TREND_ALPHA: 0.13,
  RETENTION_MAX_ENGAGEMENT: 1.5,
  RETENTION_COOLDOWN_MS: 300000,
  LOOP_HEART_THRESHOLD: 5,
  LOOP_TOP_FRACTION: 0.05,
  LOOP_CHANCE: 0.35,
  LOOP_MAX_REPEATS: 2,
};
const TUNING = Object.assign({}, TUNING_DEFAULTS);
const TUNING_STORAGE_KEY = 'mm_tuning_overrides';
const TUNING_BACKUP_KEY = 'mm_tuning_backup';

// Saved tuning holds only the keys you've actually changed ({v: 2,
// overrides}), so a new shipped default reaches you unless you've tuned
// that specific key. The original format saved a snapshot of every key,
// which silently pinned every default as of the first slider touch - when
// reading one of those, a value that equals the current default or any
// earlier shipped default (below, from git history) is treated as
// untouched and dropped; anything else is a genuine override.
// When changing a default in TUNING_DEFAULTS, add its old value here.
const TUNING_PREVIOUS_DEFAULTS = {
  SEALED_LOCK_SPEED_MULT: [0.51, 0.6],
  LAYOUT_CHANGE_COOLDOWN_MS: [12000],
  DYNAMIC_MOSAIC_CHECK_MS: [45000],
  DYNAMIC_MOSAIC_DRIFT_PROBABILITY: [0.4],
  CHASE_FLASH_START_MS: [1800],
};

function tuningOverridesFrom(saved) {
  if (!saved || typeof saved !== 'object') return {};
  const legacy = saved.v !== 2;
  const source = legacy ? saved : (saved.overrides || {});
  const out = {};
  Object.keys(TUNING_DEFAULTS).forEach((k) => {
    const v = source[k];
    if (typeof v !== 'number' || v === TUNING_DEFAULTS[k]) return;
    if (legacy && (TUNING_PREVIOUS_DEFAULTS[k] || []).includes(v)) return;
    out[k] = v;
  });
  return out;
}

function tuningOverridesNow() {
  const out = {};
  Object.keys(TUNING_DEFAULTS).forEach((k) => { if (TUNING[k] !== TUNING_DEFAULTS[k]) out[k] = TUNING[k]; });
  return out;
}

function loadTuningOverrides() {
  try {
    const raw = localStorage.getItem(TUNING_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(TUNING, tuningOverridesFrom(saved));
    if (saved.v !== 2) saveTuningOverrides(); // migrate the old full-snapshot format once
  } catch (e) {}
}
// Runs immediately (not deferred to window.onload) - the five *_CHECK_MS
// keys below each drive a setInterval registered at top-level script
// execution, before onload ever fires. If a saved override weren't
// applied until onload, those intervals would already be locked in at
// the shipped-default cadence by then, changeable only through this
// same restart machinery (see startTunableInterval) rather than a
// reload ever actually restoring a changed interval on its own.
loadTuningOverrides();

function saveTuningOverrides() {
  try { localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify({ v: 2, overrides: tuningOverridesNow() })); } catch (e) {}
}

// Each of these five keys has a persistent setInterval tied to its
// value - unlike every other tunable here (read fresh at call time by
// whatever function checks it next), an interval's own delay is fixed
// the moment it's created. Changing one of these needs to tear down and
// recreate that specific interval, not just update the TUNING value.
const TUNING_INTERVAL_HANDLES = {};
function startTunableInterval(key, fn) {
  clearInterval(TUNING_INTERVAL_HANDLES[key]);
  TUNING_INTERVAL_HANDLES[key] = setInterval(fn, TUNING[key]);
}
function restartAllTunableIntervals() {
  startTunableInterval('BONUS_WINDOW_CHECK_MS', maybeTriggerBonusWindow);
  startTunableInterval('SEALED_CHECK_MS', maybeTriggerSealedTile);
  startTunableInterval('CHASE_CHECK_MS', maybeTriggerChase);
  startTunableInterval('COLOR_RUSH_CHECK_MS', maybeTriggerColorRush);
  startTunableInterval('COLOR_SPLASH_CHECK_MS', maybeTriggerColorSplashPiece);
  startTunableInterval('MYSTERY_TILE_CHECK_MS', maybeTriggerMysteryTile);
  startTunableInterval('FRESH_DROP_CHECK_MS', maybeTriggerFreshDrop);
  startTunableInterval('SPOTLIGHT_CHECK_MS', maybeTriggerSpotlight);
  startTunableInterval('FLOATER_BARRAGE_CHECK_MS', maybeTriggerFloaterBarrage);
}

const TUNING_INTERVAL_KEYS = ['BONUS_WINDOW_CHECK_MS', 'SEALED_CHECK_MS', 'CHASE_CHECK_MS', 'COLOR_RUSH_CHECK_MS', 'COLOR_SPLASH_CHECK_MS', 'MYSTERY_TILE_CHECK_MS', 'PATIENCE_CHECK_MS', 'CHOICE_MOMENT_CHECK_MS', 'DOUBLE_FEATURE_CHECK_MS', 'FRESH_DROP_CHECK_MS', 'SPOTLIGHT_CHECK_MS', 'FLOATER_BARRAGE_CHECK_MS'];

function setTuning(key, value) {
  TUNING[key] = value;
  saveTuningOverrides();
  updateTuningUi(key);
  if (TUNING_INTERVAL_KEYS.includes(key)) restartAllTunableIntervals();
}

function resetTuningToDefaults() {
  Object.assign(TUNING, TUNING_DEFAULTS);
  saveTuningOverrides();
  restartAllTunableIntervals();
  buildTuningUi();
  toast('🔧 Tuning reset to shipped defaults');
}

function backupTuningNow() {
  try { localStorage.setItem(TUNING_BACKUP_KEY, JSON.stringify({ v: 2, overrides: tuningOverridesNow() })); } catch (e) {}
  toast('🔧 Current tuning saved as your backup');
}

function restoreTuningBackup() {
  let saved = null;
  try {
    const raw = localStorage.getItem(TUNING_BACKUP_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {}
  if (!saved) { toast('🔧 No backup saved yet', true); return; }
  Object.assign(TUNING, TUNING_DEFAULTS, tuningOverridesFrom(saved));
  saveTuningOverrides();
  restartAllTunableIntervals();
  buildTuningUi();
  toast('🔧 Restored your saved backup');
}

// unit: 'pct' (stored 0-1, shown as %), 's' (stored ms, shown as seconds),
// 'x' (multiplier), 'n' (plain number) - purely a display/slider-step
// concern, TUNING itself always stores the raw value a usage site reads.
const TUNING_GROUPS = [
  { label: 'Spiral', desc: 'Full-screen spiral overlay opacity, hold, and fade timing.', keys: ['SPIRAL_OPACITY_MIN', 'SPIRAL_OPACITY_RANGE', 'SPIRAL_HOLD_MIN_MS', 'SPIRAL_HOLD_RANGE_MS', 'SPIRAL_FADE_MIN_MS', 'SPIRAL_FADE_RANGE_MS', 'SPIRAL_BREATHE_PROBABILITY', 'SPIRAL_BREATHE_INTERVAL_MS'] },
  { label: 'Sealed Tile', desc: 'Lock odds, duration, slowdown, and miss/unlock fade timing.', keys: ['SEALED_PROBABILITY', 'SEALED_CHECK_MS', 'SEALED_DURATION_MS', 'SEALED_LOCK_SPEED_MULT', 'SEALED_MISS_HOLD_MS', 'SEALED_MISS_FADE_MS', 'SEALED_UNLOCK_FADE_MS'] },
  { label: 'Chase', desc: 'Chase-flash odds, window timing, hop delay, and catch XP.', keys: ['CHASE_PROBABILITY', 'CHASE_CHECK_MS', 'CHASE_FLASH_START_MS', 'CHASE_FLASH_MIN_MS', 'CHASE_HOP_DELAY_MS', 'CHASE_CAUGHT_MAX_PULSES', 'CHASE_XP_BASE', 'CHASE_XP_PER_CATCH'] },
  { label: 'Bonus Window', desc: 'Bonus-tile odds, check interval, duration, and claim speed fade.', keys: ['BONUS_WINDOW_PROBABILITY', 'BONUS_WINDOW_CHECK_MS', 'BONUS_WINDOW_DURATION_MS', 'BONUS_CLAIM_SPEED_FADE_MS'] },
  { label: 'Color Rush / Splash', desc: 'Odds and check intervals for both color effects.', keys: ['COLOR_RUSH_PROBABILITY', 'COLOR_RUSH_CHECK_MS', 'COLOR_SPLASH_PROBABILITY', 'COLOR_SPLASH_CHECK_MS'] },
  { label: 'Mystery Tile & Due-Aura', desc: 'Mystery-tile odds/duration and the idle due-aura threshold/fade.', keys: ['MYSTERY_TILE_PROBABILITY', 'MYSTERY_TILE_CHECK_MS', 'MYSTERY_TILE_DURATION_MS', 'TRUE_MYSTERY_PROBABILITY', 'DUE_AURA_THRESHOLD_MS', 'DUE_AURA_MIN_HOLD_MS', 'DUE_AURA_EXIT_FADE_MS'] },
  { label: 'Spin & Spawning', desc: 'Spin cooldown and the minimum gap between ambient spawns.', keys: ['SPIN_COOLDOWN_MS', 'AMBIENT_SPAWN_SEPARATION_MS'] },
  { label: 'Patience Hold', desc: 'No-touch idle threshold, check interval, and bonus XP.', keys: ['PATIENCE_CHECK_MS', 'PATIENCE_HOLD_MS', 'PATIENCE_XP'] },
  { label: 'Hold-to-Heart', desc: 'Press duration and strength of a held heart tap.', keys: ['HOLD_TO_HEART_MS', 'HOLD_TO_HEART_STRENGTH'] },
  { label: 'Pace-as-Reward', desc: 'XP and cooldown for changing rotation pace.', keys: ['PACE_REWARD_XP', 'PACE_REWARD_COOLDOWN_MS'] },
  { label: 'Choice Moments', desc: "Odds, check interval, window, and XP for the 'where next' prompt.", keys: ['CHOICE_MOMENT_CHECK_MS', 'CHOICE_MOMENT_PROBABILITY', 'CHOICE_MOMENT_WINDOW_MS', 'CHOICE_MOMENT_XP'] },
  { label: 'Lock Slowdown', desc: 'How much a locked screen slows down.', keys: ['LOCK_SLOWDOWN_MULT'] },
  { label: 'Double Feature', desc: 'Odds and check interval for a surprise second feature.', keys: ['DOUBLE_FEATURE_CHECK_MS', 'DOUBLE_FEATURE_PROBABILITY'] },
  { label: 'Layout Fade / Dynamic Mosaic', desc: 'Fade timing and the automatic-layout-change cooldown/cadence.', keys: ['LAYOUT_FADE_MS', 'LAYOUT_FADE_HOLD_MS', 'LAYOUT_CHANGE_COOLDOWN_MS', 'DYNAMIC_MOSAIC_CHECK_MS', 'DYNAMIC_MOSAIC_DRIFT_PROBABILITY'] },
  { label: 'Barrage/Jackpot Hype', desc: 'Speed-up fade timing, plus the non-selected tiles\' dim/slowdown.', keys: ['BARRAGE_SPEED_FADE_MS', 'BARRAGE_DIM_OPACITY', 'BARRAGE_DIM_FADE_IN_MS', 'BARRAGE_DIM_FADE_OUT_MS', 'BARRAGE_DIM_SPEED_MULT'] },
  { label: 'Multipliers & XP', desc: 'Heat/heart multiplier caps and decay, hidden-window odds, XP amounts.', keys: ['JACKPOT_HEAT_MAX', 'JACKPOT_HEAT_DECAY_PER_TICK', 'HEART_MULT_MAX', 'HEART_MULT_DECAY_PER_TICK', 'HIDDEN_MULT_PROBABILITY', 'HIDDEN_MULT_DURATION_MS', 'HIDDEN_MULT_VALUE', 'GOLDEN_HOUR_MULTIPLIER', 'SURGE_MULTIPLIER', 'XP_PER_BONUS_CLAIM', 'RATE_XP_BASE'] },
  { label: 'Visual FX Rewards', desc: 'Odds a tile effect (prism, bloom, VHS...) rides along with a reward.', keys: ['FX_REWARD_BONUS_CHANCE', 'FX_REWARD_SEALED_CHANCE', 'FX_REWARD_CATCH_CHANCE', 'CHASE_MILESTONE_XP_MULT', 'BLOOM_PEAK_OPACITY', 'DUOTONE_PEAK_OPACITY', 'LIGHT_LEAK_PEAK_OPACITY'] },
  { label: 'Fresh Drops', desc: 'How new clips get rationed out - check rate, odds, spacing, per-session cap.', keys: ['FRESH_DROP_CHECK_MS', 'FRESH_DROP_PROBABILITY', 'FRESH_DROP_FIRST_DELAY_MS', 'FRESH_DROP_MIN_GAP_MS', 'FRESH_DROP_SESSION_CAP'] },
  { label: 'Audio-Reactive', desc: 'Minimum gap between audio-triggered tile pulses.', keys: ['AUDIO_REACT_PULSE_GAP_MS'] },
  { label: 'Clip Transitions', desc: 'How often clip changes get a transition, how long, and the mix of styles.', keys: ['TRANSITION_PROBABILITY', 'TRANSITION_DURATION_MS', 'TRANSITION_WEIGHT_CROSSFADE', 'TRANSITION_WEIGHT_ZOOM', 'TRANSITION_WEIGHT_GLITCH'] },
  { label: 'Spotlight Takeover', desc: 'The rare one-tile takeover - odds, minimum gap, length, and size.', keys: ['SPOTLIGHT_CHECK_MS', 'SPOTLIGHT_PROBABILITY', 'SPOTLIGHT_MIN_GAP_MS', 'SPOTLIGHT_DURATION_MIN_MS', 'SPOTLIGHT_DURATION_RANGE_MS', 'SPOTLIGHT_SCALE', 'SPOTLIGHT_GROW_MS', 'SPOTLIGHT_DIM_OPACITY'] },
  { label: 'Floater Barrage', desc: 'The rare dim-the-grid, fill-the-screen-with-floaters moment - odds, rest, count, length and dim.', keys: ['FLOATER_BARRAGE_PROBABILITY', 'FLOATER_BARRAGE_CHECK_MS', 'FLOATER_BARRAGE_COOLDOWN_MS', 'FLOATER_BARRAGE_COUNT', 'FLOATER_BARRAGE_MIN_MS', 'FLOATER_BARRAGE_RANGE_MS', 'FLOATER_BARRAGE_DIM', 'FLOATER_BARRAGE_SIZE_MULT'] },
  { label: 'Overdrive', desc: 'How fast the meter charges and what a release does.', keys: ['OVERDRIVE_PER_HEART', 'OVERDRIVE_PER_CATCH', 'OVERDRIVE_PER_BONUS', 'OVERDRIVE_PER_UNLOCK', 'OVERDRIVE_ON_BEAT_MULT', 'OVERDRIVE_BURST_MS', 'OVERDRIVE_SPEED_MULT', 'OVERDRIVE_BARRAGE_P', 'OVERDRIVE_JACKPOT_P', 'OVERDRIVE_SPOTLIGHT_CHANCE'] },
  { label: 'Auto-Pilot', desc: 'Odds caps, boredom release, status text, engagement signal and the retention beat.', keys: ['AUTOPILOT_MAX_BARRAGE_P', 'AUTOPILOT_MAX_JACKPOT_P', 'BOREDOM_DEBT_LIMIT', 'STATUS_PHRASE_MIN_HOLD_MS', 'ENGAGEMENT_HALFLIFE_MS', 'ENGAGEMENT_SOFTCAP_CURVE', 'ENGAGEMENT_TREND_THRESHOLD', 'ENGAGEMENT_TREND_ALPHA', 'RETENTION_MAX_ENGAGEMENT', 'RETENTION_COOLDOWN_MS'] },
  { label: 'Rhythm & Pulse', desc: 'Tempo waves, the energy signal (range, rise/settle, jackpot swells), Mix pattern changes, and how far spirals follow the pulse.', keys: ['RHYTHM_WAVE_PERIOD_MS', 'RHYTHM_WAVE_DEPTH', 'RHYTHM_DRIVE_MIN', 'RHYTHM_DRIVE_MAX', 'RHYTHM_DRIVE_RISE_MS', 'RHYTHM_DRIVE_FALL_MS', 'RHYTHM_PAYOFF_GLOW_ADD', 'RHYTHM_PAYOFF_GLOW_CAP', 'RHYTHM_PAYOFF_GLOW_HALFLIFE_MS', 'RHYTHM_MAX_BPM', 'RHYTHM_PATTERN_SWITCH_BEATS', 'RHYTHM_PATTERN_SWITCH_CHANCE', 'PULSE_SPIRAL_RATE_MIN', 'PULSE_SPIRAL_RATE_MAX'] },
  { label: 'Taste Learning', desc: 'How much evidence it wants, how fast it forgets, and when it leans harder. Strength itself is in Flow -> Taste Learning.', keys: ['TASTE_PRIOR_LIKES', 'TASTE_LOAD_DECAY', 'TASTE_LOW_ENGAGEMENT'] },
  { label: 'Surges', desc: 'Random surges - odds and the rest between them (the odds boost itself is under Multipliers & XP).', keys: ['SURGE_PROBABILITY', 'SURGE_COOLDOWN_MS'] },
  { label: 'Custom Loop Point', desc: 'Which favourites replay their best section, how often, and how many times.', keys: ['LOOP_HEART_THRESHOLD', 'LOOP_TOP_FRACTION', 'LOOP_CHANCE', 'LOOP_MAX_REPEATS'] },
];
const TUNING_META = {
  XP_PER_BONUS_CLAIM: { label: 'Bonus-tap XP', unit: 'n', min: 5, max: 50, step: 1 },
  JACKPOT_HEAT_MAX: { label: 'Jackpot-heat cap', unit: 'x', min: 0.5, max: 6, step: 0.5 },
  HEART_MULT_MAX: { label: 'Heart-multiplier cap', unit: 'x', min: 1, max: 10, step: 1 },
  HIDDEN_MULT_PROBABILITY: { label: 'Hidden-window odds', unit: 'pct', min: 0, max: 0.3, step: 0.01 },
  HIDDEN_MULT_DURATION_MS: { label: 'Hidden-window duration', unit: 's', min: 5000, max: 60000, step: 1000 },
  HIDDEN_MULT_VALUE: { label: 'Hidden-window multiplier', unit: 'x', min: 1.2, max: 4, step: 0.1 },
  BONUS_WINDOW_CHECK_MS: { label: 'Bonus-window check interval', unit: 's', min: 5000, max: 60000, step: 1000 },
  BONUS_WINDOW_PROBABILITY: { label: 'Bonus-window odds', unit: 'pct', min: 0, max: 0.6, step: 0.01 },
  BONUS_WINDOW_DURATION_MS: { label: 'Bonus-window duration', unit: 's', min: 1000, max: 15000, step: 500 },
  BONUS_CLAIM_SPEED_FADE_MS: { label: 'Bonus claim speed fade (up & down)', unit: 's', min: 250, max: 6000, step: 250 },
  SEALED_CHECK_MS: { label: 'Sealed-tile check interval', unit: 's', min: 5000, max: 90000, step: 1000 },
  SEALED_PROBABILITY: { label: 'Sealed-tile odds', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  SEALED_DURATION_MS: { label: 'Sealed-tile duration', unit: 's', min: 2000, max: 20000, step: 500 },
  SEALED_LOCK_SPEED_MULT: { label: 'Sealed-tile lock speed', unit: 'x', min: 0.3, max: 1, step: 0.05 },
  SEALED_MISS_HOLD_MS: { label: 'Sealed-tile miss hold (before fading)', unit: 's', min: 2000, max: 30000, step: 1000 },
  SEALED_MISS_FADE_MS: { label: 'Sealed-tile miss fade-out', unit: 's', min: 1000, max: 15000, step: 500 },
  SEALED_UNLOCK_FADE_MS: { label: 'Sealed-tile unlock fade', unit: 's', min: 500, max: 10000, step: 500 },
  CHASE_CHECK_MS: { label: 'Chase check interval', unit: 's', min: 5000, max: 60000, step: 1000 },
  CHASE_PROBABILITY: { label: 'Chase odds', unit: 'pct', min: 0, max: 0.6, step: 0.01 },
  CHASE_FLASH_START_MS: { label: 'Chase window (start)', unit: 's', min: 500, max: 4000, step: 100 },
  CHASE_FLASH_MIN_MS: { label: 'Chase window (floor)', unit: 's', min: 200, max: 3000, step: 100 },
  SPIRAL_OPACITY_MIN: { label: 'Spiral opacity (min)', unit: 'pct', min: 0.05, max: 0.6, step: 0.01 },
  SPIRAL_OPACITY_RANGE: { label: 'Spiral opacity (added range)', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  SPIRAL_HOLD_MIN_MS: { label: 'Spiral hold (min)', unit: 's', min: 5000, max: 90000, step: 1000 },
  SPIRAL_HOLD_RANGE_MS: { label: 'Spiral hold (added range)', unit: 's', min: 0, max: 90000, step: 1000 },
  SPIRAL_FADE_MIN_MS: { label: 'Spiral fade (min)', unit: 's', min: 1000, max: 20000, step: 500 },
  SPIRAL_FADE_RANGE_MS: { label: 'Spiral fade (added range)', unit: 's', min: 0, max: 20000, step: 500 },
  SPIRAL_BREATHE_PROBABILITY: { label: 'Spiral breathing odds', unit: 'pct', min: 0, max: 1, step: 0.05 },
  SPIRAL_BREATHE_INTERVAL_MS: { label: 'Spiral breathing interval', unit: 's', min: 3000, max: 30000, step: 1000 },
  COLOR_RUSH_CHECK_MS: { label: 'Color Rush check interval', unit: 's', min: 10000, max: 120000, step: 5000 },
  COLOR_RUSH_PROBABILITY: { label: 'Color Rush odds', unit: 'pct', min: 0, max: 0.3, step: 0.01 },
  COLOR_SPLASH_CHECK_MS: { label: 'Color splash check interval', unit: 's', min: 5000, max: 60000, step: 1000 },
  COLOR_SPLASH_PROBABILITY: { label: 'Color splash odds', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  CHASE_HOP_DELAY_MS: { label: 'Chase hop delay (after a catch)', unit: 's', min: 100, max: 2000, step: 50 },
  CHASE_CAUGHT_MAX_PULSES: { label: 'Chase catch pulses (cap)', unit: 'n', min: 1, max: 8, step: 1 },
  CHASE_XP_BASE: { label: 'Chase catch XP (base)', unit: 'n', min: 1, max: 30, step: 1 },
  CHASE_XP_PER_CATCH: { label: 'Chase catch XP (added per streak)', unit: 'n', min: 0, max: 10, step: 1 },
  MYSTERY_TILE_PROBABILITY: { label: 'Mystery-tile odds', unit: 'pct', min: 0, max: 0.6, step: 0.01 },
  MYSTERY_TILE_CHECK_MS: { label: 'Mystery-tile check interval', unit: 's', min: 5000, max: 90000, step: 1000 },
  MYSTERY_TILE_DURATION_MS: { label: 'Mystery-tile duration', unit: 's', min: 500, max: 5000, step: 100 },
  TRUE_MYSTERY_PROBABILITY: { label: 'True Mystery odds (of a trigger)', unit: 'pct', min: 0, max: 1, step: 0.05 },
  DUE_AURA_THRESHOLD_MS: { label: 'Due-aura idle threshold', unit: 's', min: 10000, max: 180000, step: 5000 },
  DUE_AURA_MIN_HOLD_MS: { label: 'Due-aura min hold (before handoff)', unit: 's', min: 2000, max: 60000, step: 1000 },
  DUE_AURA_EXIT_FADE_MS: { label: 'Due-aura exit fade (handoff or rated away)', unit: 's', min: 500, max: 6000, step: 250 },
  SPIN_COOLDOWN_MS: { label: 'Spin cooldown', unit: 's', min: 5000, max: 120000, step: 5000 },
  AMBIENT_SPAWN_SEPARATION_MS: { label: 'Ambient-spawn separation', unit: 's', min: 0, max: 10000, step: 250 },
  PATIENCE_CHECK_MS: { label: 'Patience check interval', unit: 's', min: 5000, max: 60000, step: 1000 },
  PATIENCE_HOLD_MS: { label: 'Patience hold (no-touch threshold)', unit: 's', min: 20000, max: 300000, step: 5000 },
  PATIENCE_XP: { label: 'Patience bonus XP', unit: 'n', min: 5, max: 60, step: 1 },
  HOLD_TO_HEART_MS: { label: 'Hold-to-Heart press duration', unit: 's', min: 200, max: 2000, step: 50 },
  HOLD_TO_HEART_STRENGTH: { label: 'Hold-to-Heart strength', unit: 'n', min: 2, max: 5, step: 1 },
  PACE_REWARD_XP: { label: 'Pace-change bonus XP', unit: 'n', min: 1, max: 30, step: 1 },
  PACE_REWARD_COOLDOWN_MS: { label: 'Pace-change reward cooldown', unit: 's', min: 5000, max: 60000, step: 5000 },
  CHOICE_MOMENT_CHECK_MS: { label: 'Choice Moment check interval', unit: 's', min: 30000, max: 240000, step: 10000 },
  CHOICE_MOMENT_PROBABILITY: { label: 'Choice Moment odds', unit: 'pct', min: 0, max: 0.6, step: 0.01 },
  CHOICE_MOMENT_WINDOW_MS: { label: 'Choice Moment window', unit: 's', min: 3000, max: 20000, step: 1000 },
  CHOICE_MOMENT_XP: { label: 'Choice Moment XP', unit: 'n', min: 1, max: 40, step: 1 },
  LOCK_SLOWDOWN_MULT: { label: 'Lock slowdown (25-35% slower = 0.65-0.75)', unit: 'x', min: 0.5, max: 1, step: 0.01 },
  DOUBLE_FEATURE_CHECK_MS: { label: 'Double Feature check interval', unit: 's', min: 30000, max: 300000, step: 15000 },
  DOUBLE_FEATURE_PROBABILITY: { label: 'Double Feature odds', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  LAYOUT_FADE_MS: { label: 'Layout fade (one-way)', unit: 's', min: 0, max: 1500, step: 50 },
  LAYOUT_FADE_HOLD_MS: { label: 'Layout fade hold (dimmed)', unit: 's', min: 0, max: 2000, step: 50 },
  LAYOUT_CHANGE_COOLDOWN_MS: { label: 'Layout change cooldown (automatic only)', unit: 's', min: 0, max: 60000, step: 2000 },
  DYNAMIC_MOSAIC_CHECK_MS: { label: 'Dynamic Mosaic check interval', unit: 's', min: 10000, max: 180000, step: 5000 },
  DYNAMIC_MOSAIC_DRIFT_PROBABILITY: { label: 'Dynamic Mosaic drift odds (per check)', unit: 'pct', min: 0, max: 1, step: 0.05 },
  BARRAGE_SPEED_FADE_MS: { label: 'Barrage/Jackpot hype speed fade (up & down)', unit: 's', min: 500, max: 8000, step: 250 },
  BARRAGE_DIM_OPACITY: { label: 'Barrage non-selected dim amount', unit: 'pct', min: 0, max: 1, step: 0.05 },
  BARRAGE_DIM_FADE_IN_MS: { label: 'Barrage dim/slowdown fade in', unit: 's', min: 250, max: 6000, step: 250 },
  BARRAGE_DIM_FADE_OUT_MS: { label: 'Barrage dim/slowdown fade out', unit: 's', min: 250, max: 8000, step: 250 },
  BARRAGE_DIM_SPEED_MULT: { label: 'Barrage non-selected slowdown', unit: 'x', min: 0.3, max: 1, step: 0.05 },
  JACKPOT_HEAT_DECAY_PER_TICK: { label: 'Jackpot-heat decay (per 5s tick)', unit: 'n', min: 0, max: 0.5, step: 0.01 },
  HEART_MULT_DECAY_PER_TICK: { label: 'Heart-multiplier decay (per 6s tick)', unit: 'n', min: 0, max: 0.5, step: 0.01 },
  GOLDEN_HOUR_MULTIPLIER: { label: 'Golden Hour odds multiplier', unit: 'x', min: 1, max: 5, step: 0.1 },
  SURGE_MULTIPLIER: { label: 'Surge odds multiplier', unit: 'x', min: 1, max: 5, step: 0.1 },
  FLOATER_BARRAGE_PROBABILITY: { label: 'Floater Barrage chance per check', unit: 'pct', min: 0, max: 1, step: 0.01 },
  FLOATER_BARRAGE_CHECK_MS: { label: 'Floater Barrage check interval', unit: 's', min: 5000, max: 180000, step: 5000 },
  FLOATER_BARRAGE_COOLDOWN_MS: { label: 'Rest between Floater Barrages', unit: 's', min: 0, max: 900000, step: 15000 },
  FLOATER_BARRAGE_COUNT: { label: 'Floaters in a barrage', unit: '', min: 6, max: 36, step: 1 },
  FLOATER_BARRAGE_MIN_MS: { label: 'Floater Barrage length (min)', unit: 's', min: 4000, max: 30000, step: 1000 },
  FLOATER_BARRAGE_RANGE_MS: { label: 'Floater Barrage length (random extra)', unit: 's', min: 0, max: 20000, step: 1000 },
  FLOATER_BARRAGE_DIM: { label: 'Grid dim during Floater Barrage', unit: 'pct', min: 0.3, max: 1, step: 0.05 },
  FLOATER_BARRAGE_SIZE_MULT: { label: 'Floater Barrage floater size', unit: 'x', min: 0.6, max: 2.5, step: 0.05 },
  SURGE_COOLDOWN_MS: { label: 'Rest between random surges', unit: 's', min: 0, max: 600000, step: 15000 },
  RATE_XP_BASE: { label: 'Rate (👍/👎) base XP', unit: 'n', min: 1, max: 20, step: 1 },
  FX_REWARD_BONUS_CHANCE: { label: 'FX with a bonus tap', unit: 'pct', min: 0, max: 1, step: 0.05 },
  FX_REWARD_SEALED_CHANCE: { label: 'FX with a sealed-tile open', unit: 'pct', min: 0, max: 1, step: 0.05 },
  FX_REWARD_CATCH_CHANCE: { label: 'FX with a chase catch', unit: 'pct', min: 0, max: 1, step: 0.01 },
  CHASE_MILESTONE_XP_MULT: { label: 'Catch-streak milestone XP (x streak)', unit: 'n', min: 1, max: 10, step: 0.5 },
  FRESH_DROP_CHECK_MS: { label: 'Fresh Drop check interval', unit: 's', min: 15000, max: 180000, step: 5000 },
  FRESH_DROP_PROBABILITY: { label: 'Fresh Drop odds (per check)', unit: 'pct', min: 0, max: 1, step: 0.05 },
  FRESH_DROP_FIRST_DELAY_MS: { label: 'Fresh Drop earliest (after session start)', unit: 's', min: 0, max: 600000, step: 15000 },
  FRESH_DROP_MIN_GAP_MS: { label: 'Fresh Drop minimum gap', unit: 's', min: 30000, max: 900000, step: 15000 },
  FRESH_DROP_SESSION_CAP: { label: 'Fresh Drops per session (cap)', unit: 'n', min: 1, max: 20, step: 1 },
  AUDIO_REACT_PULSE_GAP_MS: { label: 'Audio pulse minimum gap', unit: 's', min: 100, max: 2000, step: 20 },
  TRANSITION_PROBABILITY: { label: 'Clip changes with a transition', unit: 'pct', min: 0, max: 1, step: 0.05 },
  TRANSITION_DURATION_MS: { label: 'Transition length', unit: 's', min: 150, max: 2000, step: 50 },
  TRANSITION_WEIGHT_CROSSFADE: { label: 'Crossfade weight', unit: 'n', min: 0, max: 10, step: 1 },
  TRANSITION_WEIGHT_ZOOM: { label: 'Zoom-wipe weight', unit: 'n', min: 0, max: 10, step: 1 },
  TRANSITION_WEIGHT_GLITCH: { label: 'Glitch-cut weight', unit: 'n', min: 0, max: 10, step: 1 },
  SPOTLIGHT_CHECK_MS: { label: 'Spotlight check interval', unit: 's', min: 15000, max: 300000, step: 5000 },
  SPOTLIGHT_PROBABILITY: { label: 'Spotlight odds (per check)', unit: 'pct', min: 0, max: 1, step: 0.01 },
  SPOTLIGHT_MIN_GAP_MS: { label: 'Spotlight minimum gap', unit: 's', min: 60000, max: 1800000, step: 30000 },
  SPOTLIGHT_DURATION_MIN_MS: { label: 'Spotlight length (min)', unit: 's', min: 5000, max: 40000, step: 1000 },
  SPOTLIGHT_DURATION_RANGE_MS: { label: 'Spotlight length (added range)', unit: 's', min: 0, max: 20000, step: 1000 },
  SPOTLIGHT_SCALE: { label: 'Spotlight size (share of screen)', unit: 'pct', min: 0.4, max: 1, step: 0.05 },
  SPOTLIGHT_GROW_MS: { label: 'Spotlight grow/shrink time', unit: 's', min: 200, max: 3000, step: 100 },
  SPOTLIGHT_DIM_OPACITY: { label: 'Spotlight dim on other tiles', unit: 'pct', min: 0, max: 1, step: 0.05 },
  OVERDRIVE_PER_HEART: { label: 'Charge per heart', unit: 'n', min: 0, max: 25, step: 1 },
  OVERDRIVE_PER_CATCH: { label: 'Charge per chase catch', unit: 'n', min: 0, max: 25, step: 1 },
  OVERDRIVE_PER_BONUS: { label: 'Charge per bonus tap', unit: 'n', min: 0, max: 25, step: 1 },
  OVERDRIVE_PER_UNLOCK: { label: 'Charge per sealed-tile open', unit: 'n', min: 0, max: 25, step: 1 },
  OVERDRIVE_ON_BEAT_MULT: { label: 'On-the-beat heart charge multiplier', unit: 'x', min: 1, max: 4, step: 0.5 },
  OVERDRIVE_BURST_MS: { label: 'Overdrive burst length', unit: 's', min: 5000, max: 40000, step: 1000 },
  OVERDRIVE_SPEED_MULT: { label: 'Overdrive speed boost', unit: 'x', min: 1, max: 2, step: 0.05 },
  OVERDRIVE_BARRAGE_P: { label: 'Overdrive barrage chance', unit: 'pct', min: 0, max: 1, step: 0.05 },
  OVERDRIVE_JACKPOT_P: { label: 'Overdrive jackpot chance', unit: 'pct', min: 0, max: 1, step: 0.05 },
  OVERDRIVE_SPOTLIGHT_CHANCE: { label: 'Overdrive Spotlight chance', unit: 'pct', min: 0, max: 1, step: 0.05 },
  SURGE_PROBABILITY: { label: 'Random surge chance per check (every 20s)', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  RHYTHM_WAVE_PERIOD_MS: { label: 'Tempo wave length', unit: 's', min: 20000, max: 240000, step: 5000 },
  RHYTHM_WAVE_DEPTH: { label: 'Tempo wave height', unit: 'pct', min: 0, max: 1, step: 0.05 },
  RHYTHM_DRIVE_MIN: { label: 'Energy floor', unit: 'x', min: 0.5, max: 1, step: 0.05 },
  RHYTHM_DRIVE_MAX: { label: 'Energy ceiling', unit: 'x', min: 1, max: 2, step: 0.05 },
  RHYTHM_DRIVE_RISE_MS: { label: 'Energy rise time', unit: 's', min: 1000, max: 30000, step: 500 },
  RHYTHM_DRIVE_FALL_MS: { label: 'Energy settle time', unit: 's', min: 1000, max: 60000, step: 1000 },
  RHYTHM_PAYOFF_GLOW_ADD: { label: 'Jackpot energy swell (per payoff)', unit: '', min: 0, max: 0.3, step: 0.01 },
  RHYTHM_PAYOFF_GLOW_CAP: { label: 'Jackpot energy swell (max)', unit: '', min: 0, max: 0.5, step: 0.01 },
  RHYTHM_PAYOFF_GLOW_HALFLIFE_MS: { label: 'Jackpot energy swell fade (half-life)', unit: 's', min: 2000, max: 60000, step: 1000 },
  RHYTHM_MAX_BPM: { label: 'Max rhythm tempo (BPM)', unit: '', min: 90, max: 240, step: 5 },
  RHYTHM_PATTERN_SWITCH_BEATS: { label: 'Mix: beats between pattern changes', unit: '', min: 4, max: 64, step: 4 },
  RHYTHM_PATTERN_SWITCH_CHANCE: { label: 'Mix: chance to change pattern', unit: 'pct', min: 0, max: 1, step: 0.05 },
  PULSE_SPIRAL_RATE_MIN: { label: 'Pulse: slowest spiral speed', unit: 'x', min: 0.25, max: 1, step: 0.05 },
  PULSE_SPIRAL_RATE_MAX: { label: 'Pulse: fastest spiral speed', unit: 'x', min: 1, max: 3, step: 0.05 },
  BLOOM_PEAK_OPACITY: { label: 'Dreamy Bloom strength', unit: 'pct', min: 0.1, max: 1, step: 0.05 },
  DUOTONE_PEAK_OPACITY: { label: 'Duotone strength', unit: 'pct', min: 0.1, max: 1, step: 0.05 },
  LIGHT_LEAK_PEAK_OPACITY: { label: 'Light Leak strength', unit: 'pct', min: 0.1, max: 1, step: 0.05 },
  TASTE_PRIOR_LIKES: { label: 'Evidence needed before leaning (pseudo-likes)', unit: '', min: 0, max: 20, step: 1 },
  TASTE_LOAD_DECAY: { label: 'Memory kept per page load', unit: 'pct', min: 0.5, max: 1, step: 0.01 },
  TASTE_LOW_ENGAGEMENT: { label: 'Lean harder below this engagement', unit: '', min: 0.5, max: 2.2, step: 0.05 },
  AUTOPILOT_MAX_BARRAGE_P: { label: 'Max barrage odds per check', unit: 'pct', min: 0, max: 1, step: 0.01 },
  AUTOPILOT_MAX_JACKPOT_P: { label: 'Max jackpot odds per rotation', unit: 'pct', min: 0, max: 1, step: 0.01 },
  BOREDOM_DEBT_LIMIT: { label: 'Boredom limit (4s ticks with nothing new)', unit: '', min: 5, max: 60, step: 1 },
  STATUS_PHRASE_MIN_HOLD_MS: { label: 'Status text minimum hold', unit: 's', min: 0, max: 60000, step: 1000 },
  ENGAGEMENT_HALFLIFE_MS: { label: 'Engagement memory (half-life)', unit: 's', min: 5000, max: 180000, step: 5000 },
  ENGAGEMENT_SOFTCAP_CURVE: { label: 'Engagement soft cap (0 = none, higher = harder to max)', unit: '', min: 0, max: 4, step: 0.1 },
  ENGAGEMENT_TREND_THRESHOLD: { label: 'Trend sensitivity (min change)', unit: '', min: 0, max: 0.5, step: 0.01 },
  ENGAGEMENT_TREND_ALPHA: { label: 'Trend smoothing (lower = smoother)', unit: '', min: 0.02, max: 1, step: 0.01 },
  RETENTION_MAX_ENGAGEMENT: { label: 'Retention beat only below this engagement', unit: '', min: 0.5, max: 2.2, step: 0.05 },
  RETENTION_COOLDOWN_MS: { label: 'Retention beat rest', unit: 's', min: 0, max: 1800000, step: 30000 },
  LOOP_HEART_THRESHOLD: { label: 'Minimum hearts to loop', unit: '', min: 1, max: 50, step: 1 },
  LOOP_TOP_FRACTION: { label: 'Only the top % most-hearted clips loop', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  LOOP_CHANCE: { label: 'Chance an eligible clip loops', unit: 'pct', min: 0, max: 1, step: 0.05 },
  LOOP_MAX_REPEATS: { label: 'Max passes through the loop', unit: '', min: 1, max: 6, step: 1 },
};

function formatTuningValue(key, value) {
  const meta = TUNING_META[key];
  if (meta.unit === 'pct') return (meta.step < 0.01 ? (value * 100).toFixed(1) : Math.round(value * 100)) + '%';
  if (meta.unit === 's') return (value / 1000).toFixed(1) + 's';
  if (meta.unit === 'x') return 'x' + (Math.round(value * 100) / 100);
  return String(Math.round(value * 1000) / 1000); // avoids stray floating-point tails like 0.07999999999999999
}

// The sliders themselves are drawn by Master Controls (dashboard_master.js).
function buildTuningUi() { buildMasterUi(); }

// ---- Engine (server) settings ----
// The backend's own config.py tunables, live via /api/config. They're
// shared by every device and saved server-side (config_overrides.json),
// so they survive restarts until copied into config.py.
let engineConfigFields = {};

function formatEngineValue(f) {
  return String(Math.round(f.value * 10000) / 10000);
}

function loadEngineConfig() {
  return fetch('/api/config').then(r => r.json()).then(d => {
    engineConfigFields = d.fields || {};
    buildEngineTuningUi();
  }).catch(() => {});
}

function buildEngineTuningUi() { buildMasterUi(); }

function setEngineConfig(name, value) {
  fetch('/api/config?name=' + encodeURIComponent(name) + '&value=' + encodeURIComponent(value))
    .then(r => r.json())
    .then(d => {
      if (!d.ok) { toast('🖧 ' + (d.error || 'Rejected'), true); return; }
      engineConfigFields[name].value = d.value;
      buildEngineTuningUi();
    })
    .catch(() => toast('🖧 Engine unreachable', true));
}

function resetEngineConfig() {
  fetch('/api/config?reset=1').then(r => r.json()).then(d => {
    engineConfigFields = d.fields || {};
    buildEngineTuningUi();
    toast('🖧 Engine settings back to config.py defaults');
  }).catch(() => {});
}

function copyEngineConfig() {
  const lines = Object.keys(engineConfigFields)
    .filter(n => engineConfigFields[n].value !== engineConfigFields[n].default)
    .map(n => n + ' = ' + engineConfigFields[n].value);
  const text = lines.length ? lines.join('\n') : '(everything is at its config.py default)';
  const out = document.getElementById('engine-config-copy');
  if (out) { out.value = text; out.style.display = 'block'; out.select(); }
  try { navigator.clipboard.writeText(text); toast('🖧 Changed values copied'); } catch (e) {}
}

function updateTuningUi(key) {
  const val = document.getElementById('tune-val-' + key);
  const input = document.getElementById('tune-input-' + key);
  if (val) val.innerText = formatTuningValue(key, TUNING[key]);
  if (input) input.value = TUNING[key];
}
