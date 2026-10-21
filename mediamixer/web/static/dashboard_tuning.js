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
  // Living Screen
  BREATHE_ZOOM: 0.05,
  BREATHE_DRIFT: 0.012,
  BREATHE_PERIOD_MS: 28000,
  SLOWMO_PROBABILITY: 0.3,
  SLOWMO_COOLDOWN_MS: 75000,
  SLOWMO_ENERGY_MIN: 1.1,
  SLOWMO_SPEED: 0.4,
  SLOWMO_HOLD_MS: 2400,
  DOUBLE_EXPOSURE_PROBABILITY: 0.15,
  DOUBLE_EXPOSURE_COOLDOWN_MS: 120000,
  DOUBLE_EXPOSURE_MS: 9000,
  DOUBLE_EXPOSURE_OPACITY: 0.55,
  GRADIENT_PROBABILITY: 0.06,
  GRADIENT_COOLDOWN_MS: 360000,
  GRADIENT_HOLD_MS: 20000,
  BEST_START_CHANCE: 0.6,
  BEST_START_LEAD_S: 8,
  BEST_START_MIN_LEFT_S: 15,
  SMART_FRAMING_STRENGTH: 0.8,
  SMART_FRAMING_ZOOM: 0.06,
  LIKE_THIS_MS: 60000,
  STUTTER_CHANCE: 0.1,
  STUTTER_COOLDOWN_MS: 20000,
  STUTTER_REPEATS: 3,
  CASCADE_CHANCE: 0.04,
  CASCADE_COOLDOWN_MS: 180000,
  CASCADE_HOLD_BEATS: 16,
  DROP_CHANCE: 0.05,
  DROP_MIN_ENERGY: 1.08,
  DROP_COOLDOWN_MS: 240000,
  BREATH_CHANCE: 0.06,
  BREATH_COOLDOWN_MS: 360000,
  BREATH_MS: 10000,
  BREATH_SPEED: 0.55,
  FOCUS_PULL_CHANCE: 0.08,
  FOCUS_PULL_COOLDOWN_MS: 240000,
  FOCUS_PULL_BARS: 5,
  CALL_RESPONSE_CHANCE: 0.03,
  CALL_RESPONSE_COOLDOWN_MS: 120000,
  ECHO_CHANCE: 0.25,
  ECHO_MIN_ENERGY: 1.15,
  ECHO_COOLDOWN_MS: 180000,
  ECHO_MS: 4500,
  FAVORITE_TAKEOVER_HEARTS: 3,
  FAVORITE_TAKEOVER_MS: 9000,
  FAVORITE_TAKEOVER_COOLDOWN_MS: 240000,
  HEART_BURST_WINDOW_MS: 1200,
  HEART_BURST_COOLDOWN_MS: 30000,
  HEART_BURST_LEAN_MS: 30000,
  HEART_BURST_LEAN_SHARE: 0.4,
  SPLIT_CHANCE: 0.12,
  SPLIT_COOLDOWN_MS: 150000,
  SPLIT_MS: 6000,
  GRAIN_OPACITY: 0.05,
  GRAIN_CALM_BOOST: 2.5,
  DUST_RATE: 0.04,
  EDGE_BLEED_OPACITY: 0.55,
  CONTENT_ENERGY_GAIN: 1.0,
  CONTENT_ENERGY_MAX: 0.12,
  CONTENT_PEAK_GLOW: 0.45,
  CONTENT_HERO_HOLD_MS: 8000,
  PEAK_CUT_CHANCE: 0.65,
  PEAK_CUT_MAX_WAIT_S: 6,
  PEAK_CUT_AFTER_S: 0.8,
  HOOK_CHANCE: 0.25,
  HOOK_COOLDOWN_MS: 40000,
  HOOK_SECONDS: 2.5,
  HOOK_REPEATS: 3,
  TEASE_CHANCE: 0.15,
  TEASE_COOLDOWN_MS: 20000,
  TEASE_ZOOM: 1.7,
  TEASE_MS: 6000,
  GRAVITY_SCALE: 1.08,
  GRAVITY_MIN_HOLD_MS: 6000,
  GRAVITY_HEART_NUDGE: 0.08,
  BEAT_MATCH_MAX: 0.12,
  VISUAL_TONE_STRENGTH: 0.22,
  REPLAY_CHANCE: 0.35,
  REPLAY_COOLDOWN_MS: 30000,
  REPLAY_SECONDS: 3,
  REPLAY_SPEED: 0.85,
  REPLAY_DELAY_MS: 600,
  CALLBACK_CHANCE: 0.4,
  CALLBACK_COOLDOWN_MS: 120000,
  CALLBACK_MIN_AGE_MS: 180000,
  CALLBACK_HOLD_S: 12,
  CALLBACK_LEAD_S: 2,
  SPATIAL_WIDTH: 0.8,
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
  CALL_RESPONSE_CHANCE: [0.06],
  CALL_RESPONSE_COOLDOWN_MS: [60000],
  PEAK_CUT_CHANCE: [0.5],
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
  { label: 'Spatial Sound', desc: 'How far left and right the tiles’ sound is spread.', keys: ['SPATIAL_WIDTH'] },
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
  { label: 'Living Screen', desc: 'Breathing tiles, slow-motion moments and double exposures.', keys: ['BREATHE_ZOOM', 'BREATHE_DRIFT', 'BREATHE_PERIOD_MS', 'SLOWMO_PROBABILITY', 'SLOWMO_COOLDOWN_MS', 'SLOWMO_ENERGY_MIN', 'SLOWMO_SPEED', 'SLOWMO_HOLD_MS', 'DOUBLE_EXPOSURE_PROBABILITY', 'DOUBLE_EXPOSURE_COOLDOWN_MS', 'DOUBLE_EXPOSURE_MS', 'DOUBLE_EXPOSURE_OPACITY', 'GRADIENT_PROBABILITY', 'GRADIENT_COOLDOWN_MS', 'GRADIENT_HOLD_MS', 'BEST_START_CHANCE', 'BEST_START_LEAD_S', 'BEST_START_MIN_LEFT_S', 'SMART_FRAMING_STRENGTH', 'SMART_FRAMING_ZOOM', 'LIKE_THIS_MS'] },
  { label: 'Rhythm FX', desc: 'Stutter edits and Cascades - how often, how long, how many repeats.', keys: ['STUTTER_CHANCE', 'STUTTER_COOLDOWN_MS', 'STUTTER_REPEATS', 'CASCADE_CHANCE', 'CASCADE_COOLDOWN_MS', 'CASCADE_HOLD_BEATS'] },
  { label: 'Content Pulse', desc: 'How much the movement in the clips on screen leads the energy, peak glow and Follow Clips tempo.', keys: ['CONTENT_ENERGY_GAIN', 'CONTENT_ENERGY_MAX', 'CONTENT_PEAK_GLOW', 'CONTENT_HERO_HOLD_MS', 'PEAK_CUT_CHANCE', 'PEAK_CUT_MAX_WAIT_S', 'PEAK_CUT_AFTER_S', 'BEAT_MATCH_MAX', 'VISUAL_TONE_STRENGTH'] },
  { label: 'Hooks & Tease', desc: 'How often a clip repeats its best bit, and how often a new clip arrives pushed in close.', keys: ['HOOK_CHANCE', 'HOOK_COOLDOWN_MS', 'HOOK_SECONDS', 'HOOK_REPEATS', 'TEASE_CHANCE', 'TEASE_COOLDOWN_MS', 'TEASE_ZOOM', 'TEASE_MS'] },
  { label: 'Gravity', desc: 'How much the liveliest tile swells, how long it holds the lead, and how little a heart moves it.', keys: ['GRAVITY_SCALE', 'GRAVITY_MIN_HOLD_MS', 'GRAVITY_HEART_NUDGE'] },
  { label: 'Replays & Callbacks', desc: 'How often a heart gets an instant replay, and how often an earlier favourite comes back.', keys: ['REPLAY_CHANCE', 'REPLAY_COOLDOWN_MS', 'REPLAY_SECONDS', 'REPLAY_SPEED', 'REPLAY_DELAY_MS', 'CALLBACK_CHANCE', 'CALLBACK_COOLDOWN_MS', 'CALLBACK_MIN_AGE_MS', 'CALLBACK_HOLD_S', 'CALLBACK_LEAD_S'] },
  { label: 'Visual Textures', desc: 'Split frames, film grain & dust, and edge bleed - odds, strength and how much calm moments add.', keys: ['SPLIT_CHANCE', 'SPLIT_COOLDOWN_MS', 'SPLIT_MS', 'GRAIN_OPACITY', 'GRAIN_CALM_BOOST', 'DUST_RATE', 'EDGE_BLEED_OPACITY'] },
  { label: 'Moments', desc: 'The Drop, Breath, Focus pull, Call & response, Echo trails, Favourite takeover and Heart burst - odds, rests and lengths.', keys: ['DROP_CHANCE', 'DROP_MIN_ENERGY', 'DROP_COOLDOWN_MS', 'BREATH_CHANCE', 'BREATH_COOLDOWN_MS', 'BREATH_MS', 'BREATH_SPEED', 'FOCUS_PULL_CHANCE', 'FOCUS_PULL_COOLDOWN_MS', 'FOCUS_PULL_BARS', 'CALL_RESPONSE_CHANCE', 'CALL_RESPONSE_COOLDOWN_MS', 'ECHO_CHANCE', 'ECHO_MIN_ENERGY', 'ECHO_COOLDOWN_MS', 'ECHO_MS', 'FAVORITE_TAKEOVER_HEARTS', 'FAVORITE_TAKEOVER_MS', 'FAVORITE_TAKEOVER_COOLDOWN_MS', 'HEART_BURST_WINDOW_MS', 'HEART_BURST_COOLDOWN_MS', 'HEART_BURST_LEAN_MS', 'HEART_BURST_LEAN_SHARE'] },
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
  BREATHE_ZOOM: { label: 'Breathing zoom', unit: 'pct', min: 0, max: 0.2, step: 0.005 },
  BREATHE_DRIFT: { label: 'Breathing drift', unit: 'pct', min: 0, max: 0.06, step: 0.002 },
  BREATHE_PERIOD_MS: { label: 'Breathing cycle', unit: 's', min: 6000, max: 90000, step: 1000 },
  SLOWMO_PROBABILITY: { label: 'Slow-mo chance per check (every 6s)', unit: 'pct', min: 0, max: 1, step: 0.05 },
  SLOWMO_COOLDOWN_MS: { label: 'Rest between slow-mo moments', unit: 's', min: 10000, max: 600000, step: 5000 },
  SLOWMO_ENERGY_MIN: { label: 'Slow-mo needs energy above', unit: 'x', min: 0.85, max: 1.3, step: 0.01 },
  SLOWMO_SPEED: { label: 'Slow-mo speed', unit: 'x', min: 0.2, max: 0.8, step: 0.05 },
  SLOWMO_HOLD_MS: { label: 'Slow-mo hold', unit: 's', min: 1000, max: 6000, step: 200 },
  DOUBLE_EXPOSURE_PROBABILITY: { label: 'Double exposure chance per check (every 30s)', unit: 'pct', min: 0, max: 1, step: 0.05 },
  DOUBLE_EXPOSURE_COOLDOWN_MS: { label: 'Rest between double exposures', unit: 's', min: 15000, max: 900000, step: 15000 },
  DOUBLE_EXPOSURE_MS: { label: 'Double exposure length', unit: 's', min: 3000, max: 30000, step: 1000 },
  DOUBLE_EXPOSURE_OPACITY: { label: 'Double exposure strength', unit: 'pct', min: 0.1, max: 1, step: 0.05 },
  GRADIENT_PROBABILITY: { label: 'Gradient moment chance per check (every 45s)', unit: 'pct', min: 0, max: 1, step: 0.01 },
  BEST_START_CHANCE: { label: 'Best-moment start chance', unit: 'pct', min: 0, max: 1, step: 0.05 },
  BEST_START_LEAD_S: { label: 'Best-moment lead-in (seconds before)', unit: '', min: 0, max: 30, step: 1 },
  BEST_START_MIN_LEFT_S: { label: 'Best-moment: always leave at least (seconds)', unit: '', min: 5, max: 60, step: 1 },
  SMART_FRAMING_STRENGTH: { label: 'Smart framing: how far it follows the action', unit: 'pct', min: 0, max: 1.5, step: 0.05 },
  SMART_FRAMING_ZOOM: { label: 'Smart framing: extra zoom for room to move', unit: 'pct', min: 0, max: 0.2, step: 0.01 },
  DROP_CHANCE: { label: 'The Drop: chance per bar (at high energy)', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  DROP_MIN_ENERGY: { label: 'The Drop: needs energy above', unit: 'x', min: 0.85, max: 1.3, step: 0.01 },
  DROP_COOLDOWN_MS: { label: 'Rest between Drops', unit: 's', min: 30000, max: 1800000, step: 15000 },
  BREATH_CHANCE: { label: 'Breath: chance per check (every 20s)', unit: 'pct', min: 0, max: 1, step: 0.01 },
  BREATH_COOLDOWN_MS: { label: 'Rest between Breaths', unit: 's', min: 60000, max: 1800000, step: 30000 },
  BREATH_MS: { label: 'Breath length', unit: 's', min: 4000, max: 30000, step: 1000 },
  BREATH_SPEED: { label: 'Breath: tile speed', unit: 'x', min: 0.2, max: 1, step: 0.05 },
  FOCUS_PULL_CHANCE: { label: 'Focus pull: chance per check (every 20s)', unit: 'pct', min: 0, max: 1, step: 0.01 },
  FOCUS_PULL_COOLDOWN_MS: { label: 'Rest between focus pulls', unit: 's', min: 30000, max: 1800000, step: 15000 },
  FOCUS_PULL_BARS: { label: 'Focus pull: how many moves', unit: '', min: 2, max: 16, step: 1 },
  CALL_RESPONSE_CHANCE: { label: 'Call & response: chance per bar', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  CALL_RESPONSE_COOLDOWN_MS: { label: 'Rest between call & responses', unit: 's', min: 10000, max: 600000, step: 5000 },
  ECHO_CHANCE: { label: 'Echo trails: chance per check at peak', unit: 'pct', min: 0, max: 1, step: 0.01 },
  ECHO_MIN_ENERGY: { label: 'Echo trails: needs energy above', unit: 'x', min: 0.85, max: 1.3, step: 0.01 },
  ECHO_COOLDOWN_MS: { label: 'Rest between echo trails', unit: 's', min: 30000, max: 1800000, step: 15000 },
  ECHO_MS: { label: 'Echo trails length', unit: 's', min: 1500, max: 15000, step: 500 },
  FAVORITE_TAKEOVER_HEARTS: { label: 'Favourite takeover: hearts on one clip this session', unit: '', min: 2, max: 10, step: 1 },
  FAVORITE_TAKEOVER_MS: { label: 'Favourite takeover length', unit: 's', min: 4000, max: 30000, step: 1000 },
  FAVORITE_TAKEOVER_COOLDOWN_MS: { label: 'Rest between favourite takeovers', unit: 's', min: 30000, max: 1800000, step: 15000 },
  HEART_BURST_WINDOW_MS: { label: 'Heart burst: two hearts within', unit: 's', min: 400, max: 3000, step: 100 },
  HEART_BURST_COOLDOWN_MS: { label: 'Rest between heart bursts', unit: 's', min: 5000, max: 300000, step: 5000 },
  HEART_BURST_LEAN_MS: { label: 'Heart burst: picks lean toward that look for', unit: 's', min: 0, max: 120000, step: 5000 },
  CONTENT_ENERGY_GAIN: { label: 'Content pulse: how strongly clip movement moves the energy', unit: 'x', min: 0, max: 2, step: 0.05 },
  CONTENT_ENERGY_MAX: { label: 'Content pulse: most it can lift or settle the energy', unit: 'x', min: 0, max: 0.3, step: 0.01 },
  CONTENT_PEAK_GLOW: { label: 'Clip peak: screen-edge glow', unit: 'pct', min: 0, max: 1, step: 0.05 },
  CONTENT_HERO_HOLD_MS: { label: 'Follow Clips: least time one clip leads the beat', unit: 's', min: 2000, max: 60000, step: 1000 },
  PEAK_CUT_CHANCE: { label: 'Cut after the peak: share of cuts that wait for one', unit: 'pct', min: 0, max: 1, step: 0.05 },
  PEAK_CUT_MAX_WAIT_S: { label: 'Cut after the peak: longest wait for it', unit: '', min: 1, max: 15, step: 0.5 },
  PEAK_CUT_AFTER_S: { label: 'Cut after the peak: cut this long after it', unit: '', min: 0, max: 3, step: 0.1 },
  HOOK_CHANCE: { label: 'Hook: chance when a clip nears its best bit', unit: 'pct', min: 0, max: 1, step: 0.05 },
  HOOK_COOLDOWN_MS: { label: 'Rest between hooks', unit: 's', min: 5000, max: 600000, step: 5000 },
  HOOK_SECONDS: { label: 'Hook length (snaps to the clip’s own beats)', unit: '', min: 1, max: 6, step: 0.25 },
  HOOK_REPEATS: { label: 'Hook: times it plays', unit: '', min: 2, max: 6, step: 1 },
  TEASE_CHANCE: { label: 'Tease reveal: chance per new clip', unit: 'pct', min: 0, max: 1, step: 0.05 },
  TEASE_COOLDOWN_MS: { label: 'Rest between tease reveals', unit: 's', min: 0, max: 300000, step: 5000 },
  TEASE_ZOOM: { label: 'Tease reveal: how close it starts', unit: 'x', min: 1.1, max: 3, step: 0.05 },
  TEASE_MS: { label: 'Tease reveal length', unit: 's', min: 2000, max: 15000, step: 500 },
  GRAVITY_SCALE: { label: 'Gravity: how much the lead tile swells', unit: 'x', min: 1, max: 1.3, step: 0.01 },
  GRAVITY_MIN_HOLD_MS: { label: 'Gravity: least time one tile holds the lead', unit: 's', min: 2000, max: 60000, step: 1000 },
  GRAVITY_HEART_NUDGE: { label: 'Gravity: nudge from a heart (fades in seconds)', unit: '', min: 0, max: 0.4, step: 0.01 },
  BEAT_MATCH_MAX: { label: 'Beat-matching: most a clip is sped up or slowed', unit: 'pct', min: 0, max: 0.2, step: 0.01 },
  VISUAL_TONE_STRENGTH: { label: 'Visual Tone: how much the screen swells on each beat', unit: 'pct', min: 0, max: 0.6, step: 0.01 },
  REPLAY_CHANCE: { label: 'Heart replay: chance per heart', unit: 'pct', min: 0, max: 1, step: 0.05 },
  REPLAY_COOLDOWN_MS: { label: 'Rest between heart replays', unit: 's', min: 5000, max: 300000, step: 5000 },
  REPLAY_SECONDS: { label: 'Heart replay: seconds replayed', unit: '', min: 1, max: 8, step: 0.5 },
  REPLAY_SPEED: { label: 'Heart replay: speed', unit: 'x', min: 0.5, max: 1, step: 0.05 },
  REPLAY_DELAY_MS: { label: 'Heart replay: pause before it plays', unit: 's', min: 0, max: 3000, step: 100 },
  CALLBACK_CHANCE: { label: 'Callback: chance per check (every 20s)', unit: 'pct', min: 0, max: 1, step: 0.05 },
  CALLBACK_COOLDOWN_MS: { label: 'Rest between callbacks', unit: 's', min: 30000, max: 1800000, step: 15000 },
  CALLBACK_MIN_AGE_MS: { label: 'Callback: hearted at least this long ago', unit: 's', min: 30000, max: 1800000, step: 30000 },
  CALLBACK_HOLD_S: { label: 'Callback: seconds it stays', unit: '', min: 4, max: 60, step: 1 },
  CALLBACK_LEAD_S: { label: 'Callback: start this long before the hearted spot', unit: '', min: 0, max: 8, step: 0.5 },
  SPATIAL_WIDTH: { label: 'Spatial sound: how wide the tiles are spread (1 = edge tiles fully in one ear)', unit: 'pct', min: 0, max: 1, step: 0.05 },
  SPLIT_CHANCE: { label: 'Split frames: chance per check (every 15s)', unit: 'pct', min: 0, max: 1, step: 0.01 },
  SPLIT_COOLDOWN_MS: { label: 'Rest between split frames', unit: 's', min: 15000, max: 1800000, step: 15000 },
  SPLIT_MS: { label: 'Split frames length', unit: 's', min: 2000, max: 20000, step: 500 },
  GRAIN_OPACITY: { label: 'Film grain strength', unit: 'pct', min: 0, max: 0.3, step: 0.01 },
  GRAIN_CALM_BOOST: { label: 'Grain & dust: boost in calm moments (Vault, Drift, wind-down)', unit: 'x', min: 1, max: 5, step: 0.1 },
  DUST_RATE: { label: 'Dust: how often specks appear', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  EDGE_BLEED_OPACITY: { label: 'Edge bleed strength', unit: 'pct', min: 0, max: 1, step: 0.05 },
  HEART_BURST_LEAN_SHARE: { label: 'Heart burst: how much of the picking leans', unit: 'pct', min: 0, max: 1, step: 0.05 },
  STUTTER_CHANCE: { label: 'Stutter chance per bar', unit: 'pct', min: 0, max: 1, step: 0.01 },
  STUTTER_COOLDOWN_MS: { label: 'Rest between stutters', unit: 's', min: 2000, max: 300000, step: 1000 },
  STUTTER_REPEATS: { label: 'Stutter repeats', unit: '', min: 1, max: 6, step: 1 },
  CASCADE_CHANCE: { label: 'Cascade chance per bar', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  CASCADE_COOLDOWN_MS: { label: 'Rest between cascades', unit: 's', min: 15000, max: 1800000, step: 15000 },
  CASCADE_HOLD_BEATS: { label: 'Cascade hold (beats)', unit: '', min: 4, max: 64, step: 1 },
  LIKE_THIS_MS: { label: 'More like this: how long it lasts', unit: 's', min: 15000, max: 300000, step: 15000 },
  GRADIENT_HOLD_MS: { label: 'Gradient hold (before tiles rotate on)', unit: 's', min: 5000, max: 90000, step: 1000 },
  GRADIENT_COOLDOWN_MS: { label: 'Rest between Gradient moments', unit: 's', min: 30000, max: 1800000, step: 30000 },
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

function buildEngineTuningUi() { buildMasterUi(); updateBarrageSlider(); }

// Rewards -> Barrages: the engine's barrage odds as a plain slider.
function updateBarrageSlider() {
  const f = engineConfigFields.barrage_probability;
  const input = document.getElementById('barrage-odds-input');
  const lbl = document.getElementById('l-barrage-odds');
  if (!f || !input) return;
  input.value = f.value;
  if (lbl) lbl.innerText = barrageOddsLabel(f.value);
}

function barrageOddsLabel(v) {
  const perMin = v * 20; // one roll every ~3s
  return (v * 100).toFixed(1) + '% per roll (~' + (perMin >= 1 ? perMin.toFixed(1) + ' a minute' : 'one every ' + Math.round(1 / Math.max(perMin, 0.001)) + ' min') + ', before the rest between them)';
}

let barrageSliderTimer = null;
function setBarrageOdds(v) {
  const lbl = document.getElementById('l-barrage-odds');
  if (lbl) lbl.innerText = barrageOddsLabel(+v);
  clearTimeout(barrageSliderTimer);
  barrageSliderTimer = setTimeout(() => setEngineConfig('barrage_probability', v), 250);
}

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
