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
  CHASE_CHECK_MS: 20000,
  CHASE_PROBABILITY: 0.22,
  CHASE_FLASH_START_MS: 1800,
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
  MYSTERY_TILE_CHECK_MS: 30000,
  MYSTERY_TILE_PROBABILITY: 0.15,
  MYSTERY_TILE_DURATION_MS: 1600,
  AMBIENT_SPAWN_SEPARATION_MS: 2500,
  JACKPOT_HEAT_DECAY_PER_TICK: 0.08,
  HEART_MULT_DECAY_PER_TICK: 0.1,
  GOLDEN_HOUR_MULTIPLIER: 2.5,
  SURGE_MULTIPLIER: 2.0,
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
  DYNAMIC_MOSAIC_CHECK_MS: 45000,
  DYNAMIC_MOSAIC_DRIFT_PROBABILITY: 0.4,
};
const TUNING = Object.assign({}, TUNING_DEFAULTS);
const TUNING_STORAGE_KEY = 'mm_tuning_overrides';
const TUNING_BACKUP_KEY = 'mm_tuning_backup';

function loadTuningOverrides() {
  try {
    const raw = localStorage.getItem(TUNING_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.keys(TUNING_DEFAULTS).forEach(k => { if (typeof saved[k] === 'number') TUNING[k] = saved[k]; });
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
  try { localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(TUNING)); } catch (e) {}
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
}

const TUNING_INTERVAL_KEYS = ['BONUS_WINDOW_CHECK_MS', 'SEALED_CHECK_MS', 'CHASE_CHECK_MS', 'COLOR_RUSH_CHECK_MS', 'COLOR_SPLASH_CHECK_MS', 'MYSTERY_TILE_CHECK_MS', 'PATIENCE_CHECK_MS', 'CHOICE_MOMENT_CHECK_MS', 'DOUBLE_FEATURE_CHECK_MS'];

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
  try { localStorage.setItem(TUNING_BACKUP_KEY, JSON.stringify(TUNING)); } catch (e) {}
  toast('🔧 Current tuning saved as your backup');
}

function restoreTuningBackup() {
  let saved = null;
  try {
    const raw = localStorage.getItem(TUNING_BACKUP_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {}
  if (!saved) { toast('🔧 No backup saved yet', true); return; }
  Object.keys(TUNING_DEFAULTS).forEach(k => { if (typeof saved[k] === 'number') TUNING[k] = saved[k]; });
  saveTuningOverrides();
  restartAllTunableIntervals();
  buildTuningUi();
  toast('🔧 Restored your saved backup');
}

// unit: 'pct' (stored 0-1, shown as %), 's' (stored ms, shown as seconds),
// 'x' (multiplier), 'n' (plain number) - purely a display/slider-step
// concern, TUNING itself always stores the raw value a usage site reads.
const TUNING_GROUPS = [
  { label: 'Spiral', keys: ['SPIRAL_OPACITY_MIN', 'SPIRAL_OPACITY_RANGE', 'SPIRAL_HOLD_MIN_MS', 'SPIRAL_HOLD_RANGE_MS', 'SPIRAL_FADE_MIN_MS', 'SPIRAL_FADE_RANGE_MS', 'SPIRAL_BREATHE_PROBABILITY', 'SPIRAL_BREATHE_INTERVAL_MS'] },
  { label: 'Sealed Tile', keys: ['SEALED_PROBABILITY', 'SEALED_CHECK_MS', 'SEALED_DURATION_MS'] },
  { label: 'Chase', keys: ['CHASE_PROBABILITY', 'CHASE_CHECK_MS', 'CHASE_FLASH_START_MS', 'CHASE_FLASH_MIN_MS', 'CHASE_HOP_DELAY_MS', 'CHASE_CAUGHT_MAX_PULSES', 'CHASE_XP_BASE', 'CHASE_XP_PER_CATCH'] },
  { label: 'Bonus Window', keys: ['BONUS_WINDOW_PROBABILITY', 'BONUS_WINDOW_CHECK_MS', 'BONUS_WINDOW_DURATION_MS'] },
  { label: 'Color Rush / Splash', keys: ['COLOR_RUSH_PROBABILITY', 'COLOR_RUSH_CHECK_MS', 'COLOR_SPLASH_PROBABILITY', 'COLOR_SPLASH_CHECK_MS'] },
  { label: 'Mystery Tile & Due-Aura', keys: ['MYSTERY_TILE_PROBABILITY', 'MYSTERY_TILE_CHECK_MS', 'MYSTERY_TILE_DURATION_MS', 'TRUE_MYSTERY_PROBABILITY', 'DUE_AURA_THRESHOLD_MS', 'DUE_AURA_MIN_HOLD_MS'] },
  { label: 'Spin & Spawning', keys: ['SPIN_COOLDOWN_MS', 'AMBIENT_SPAWN_SEPARATION_MS'] },
  { label: 'Patience Hold', keys: ['PATIENCE_CHECK_MS', 'PATIENCE_HOLD_MS', 'PATIENCE_XP'] },
  { label: 'Hold-to-Heart', keys: ['HOLD_TO_HEART_MS', 'HOLD_TO_HEART_STRENGTH'] },
  { label: 'Pace-as-Reward', keys: ['PACE_REWARD_XP', 'PACE_REWARD_COOLDOWN_MS'] },
  { label: 'Choice Moments', keys: ['CHOICE_MOMENT_CHECK_MS', 'CHOICE_MOMENT_PROBABILITY', 'CHOICE_MOMENT_WINDOW_MS', 'CHOICE_MOMENT_XP'] },
  { label: 'Lock Slowdown', keys: ['LOCK_SLOWDOWN_MULT'] },
  { label: 'Double Feature', keys: ['DOUBLE_FEATURE_CHECK_MS', 'DOUBLE_FEATURE_PROBABILITY'] },
  { label: 'Layout Fade / Dynamic Mosaic', keys: ['LAYOUT_FADE_MS', 'LAYOUT_FADE_HOLD_MS', 'DYNAMIC_MOSAIC_CHECK_MS', 'DYNAMIC_MOSAIC_DRIFT_PROBABILITY'] },
  { label: 'Multipliers & XP', keys: ['JACKPOT_HEAT_MAX', 'JACKPOT_HEAT_DECAY_PER_TICK', 'HEART_MULT_MAX', 'HEART_MULT_DECAY_PER_TICK', 'HIDDEN_MULT_PROBABILITY', 'HIDDEN_MULT_DURATION_MS', 'HIDDEN_MULT_VALUE', 'GOLDEN_HOUR_MULTIPLIER', 'SURGE_MULTIPLIER', 'XP_PER_BONUS_CLAIM', 'RATE_XP_BASE'] },
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
  SEALED_CHECK_MS: { label: 'Sealed-tile check interval', unit: 's', min: 5000, max: 90000, step: 1000 },
  SEALED_PROBABILITY: { label: 'Sealed-tile odds', unit: 'pct', min: 0, max: 0.5, step: 0.01 },
  SEALED_DURATION_MS: { label: 'Sealed-tile duration', unit: 's', min: 2000, max: 20000, step: 500 },
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
  DYNAMIC_MOSAIC_CHECK_MS: { label: 'Dynamic Mosaic check interval', unit: 's', min: 10000, max: 180000, step: 5000 },
  DYNAMIC_MOSAIC_DRIFT_PROBABILITY: { label: 'Dynamic Mosaic drift odds (per check)', unit: 'pct', min: 0, max: 1, step: 0.05 },
  JACKPOT_HEAT_DECAY_PER_TICK: { label: 'Jackpot-heat decay (per 5s tick)', unit: 'n', min: 0, max: 0.5, step: 0.01 },
  HEART_MULT_DECAY_PER_TICK: { label: 'Heart-multiplier decay (per 6s tick)', unit: 'n', min: 0, max: 0.5, step: 0.01 },
  GOLDEN_HOUR_MULTIPLIER: { label: 'Golden Hour odds multiplier', unit: 'x', min: 1, max: 5, step: 0.1 },
  SURGE_MULTIPLIER: { label: 'Surge odds multiplier', unit: 'x', min: 1, max: 5, step: 0.1 },
  RATE_XP_BASE: { label: 'Rate (👍/👎) base XP', unit: 'n', min: 1, max: 20, step: 1 },
};

function formatTuningValue(key, value) {
  const meta = TUNING_META[key];
  if (meta.unit === 'pct') return Math.round(value * 100) + '%';
  if (meta.unit === 's') return (value / 1000).toFixed(1) + 's';
  if (meta.unit === 'x') return 'x' + (Math.round(value * 10) / 10);
  return String(Math.round(value * 1000) / 1000); // avoids stray floating-point tails like 0.07999999999999999
}

// Builds the whole tab from TUNING_GROUPS/TUNING_META rather than hand-
// written HTML per slider - 27 near-identical rows would otherwise be a
// lot of markup to keep in sync with this file's own constants.
function buildTuningUi() {
  const container = document.getElementById('tuning-groups');
  if (!container) return;
  container.innerHTML = '';
  TUNING_GROUPS.forEach(group => {
    const h = document.createElement('h3');
    h.innerText = group.label;
    container.appendChild(h);
    group.keys.forEach(key => {
      const meta = TUNING_META[key];
      const row = document.createElement('div');
      row.className = 'slider';
      row.innerHTML = '<label>' + meta.label + ': <b><span id="tune-val-' + key + '"></span></b></label>' +
        '<input type="range" id="tune-input-' + key + '" min="' + meta.min + '" max="' + meta.max + '" step="' + meta.step + '">';
      container.appendChild(row);
    });
  });
  Object.keys(TUNING_META).forEach(key => {
    const input = document.getElementById('tune-input-' + key);
    const val = document.getElementById('tune-val-' + key);
    if (!input || !val) return;
    input.value = TUNING[key];
    val.innerText = formatTuningValue(key, TUNING[key]);
    input.addEventListener('input', () => setTuning(key, parseFloat(input.value)));
  });
}

function updateTuningUi(key) {
  const val = document.getElementById('tune-val-' + key);
  const input = document.getElementById('tune-input-' + key);
  if (val) val.innerText = formatTuningValue(key, TUNING[key]);
  if (input) input.value = TUNING[key];
}

const RANDOM_START_MAX_FRACTION = 0.5; // clips start somewhere in their first 0-50%
const BINAURAL_BASE_GAIN = 0.15;

// Browsers cap concurrent connections to ~6 per origin (HTTP/1.1). A big grid
// can easily want 2x its tile count in flight at once (visible + preloaded
// clip per tile), so beyond a few tiles, most requests just queue - which
// looks like stalling even though neither the network nor the PC is actually
// busy. When this page itself was loaded via a loopback address (i.e. this
// is the PC's own browser, not a phone on the LAN), we can route different
// tiles' media requests through different 127.0.0.x addresses - Windows
// treats the whole 127.0.0.0/8 block as loopback, and the browser treats
// each distinct host as a separate origin with its own 6-connection budget.
// 6 shards x Chrome's 6-connections-per-origin limit = a 36-connection
// ceiling. A 5x5 grid needs 25 main-video streams, and with preload
// (below) doubles to 50 - comfortably over 36, so requests queue waiting
// for a free connection, which shows up as stalled/non-playing video.
// 16 shards x 6 = 96, enough headroom for the largest grid plus preload
// plus everything else (audio, SSE) sharing the budget.
const LOOPBACK_SHARDS = 16;
const IS_LOOPBACK_VIEW = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

function mediaOrigin(screenIndex) {
  if (!IS_LOOPBACK_VIEW) return ''; // phone/LAN viewers: just use this page's own origin
  const shard = (screenIndex % LOOPBACK_SHARDS) + 1;
  return `${location.protocol}//127.0.0.${shard}:${location.port}`;
}

let currentLayout = null;
let currentColumns = 1;
let currentTileCount = 0;
let currentPaths = [];
let preloadEnabled = true;

// Manual playback-speed control (the "tool menu" / Display tab slider) -
// a player-facing baseline multiplier, separate from the server-driven
// tension/barrage speed (s.speed) and from Lock's own slowdown below;
// all three compose by multiplying together, with a burst-speed effect
// (see burstTileSpeed) still fully overriding this for its own window.
let manualSpeedMult = 1.0;

function setManualSpeed(v) {
  manualSpeedMult = parseFloat(v);
  const el = document.getElementById('l-manual-speed');
  if (el) el.innerText = manualSpeedMult.toFixed(2) + 'x';
  try { localStorage.setItem('mm_manual_speed', manualSpeedMult); } catch (e) {}
}

function loadManualSpeedPref() {
  let saved = 1.0;
  try {
    const raw = localStorage.getItem('mm_manual_speed');
    if (raw !== null) saved = parseFloat(raw);
  } catch (e) {}
  if (!Number.isFinite(saved)) saved = 1.0;
  const input = document.getElementById('manual-speed-input');
  if (input) input.value = saved;
  setManualSpeed(saved);
}
const PRELOAD_MAX_TILES = 9; // dual/2x2/2x3/3x3 keep deterministic preload; 4x4/5x5 skip it
let tileElements = [];
// Dedicated glow overlay divs, one per tile, cached alongside tileElements.
// All FX opacity/animation lives on these instead of box-shadow/filter on
// the tile or video itself, so effects never force a video repaint.
let tileGlowEls = [];
let tileAmbientEls = [];
let tileClaimEls = [];
let lastFilterStr = [];

// ---- Custom Loop Point ----
// Normally a clip plays through and 'ended' hands rotation to the server
// (see the tile's own 'ended' listener below). Once a video has a stored
// hearted-position range (loop_anchor_min/max, widened server-side by
// every heart's playback position - see rateScreen's &pos= param), it
// instead loops within [anchor.min - lead-in, anchor.max + trail-in]
// forever, clamped to the clip's real duration, with a minimum-duration
// floor so a single heart near either edge can't collapse it to a
// jarring few-second snippet. Directly answers two concerns raised while
// designing this: anchoring only to the LAST heart would lose content
// that's great *before* that point (hence lead-in, and the window only
// ever widening, never relocating) - and never trimming the tail would
// loop forever through a clip that degrades toward the end (hence
// trail-in instead of always playing to the natural end).
const LOOP_LEAD_IN_S = 3;
const LOOP_TRAIL_IN_S = 4;
const LOOP_MIN_DURATION_S = 15;
const loopAnchorCache = {}; // video_path -> {min,max} | null (null = confirmed none)
let tileLoopBounds = []; // per-tile index -> {start,end} | null

function computeLoopBounds(anchor, duration) {
  if (!anchor || !duration || !isFinite(duration)) return null;
  let start = Math.max(0, anchor.min - LOOP_LEAD_IN_S);
  let end = Math.min(duration, anchor.max + LOOP_TRAIL_IN_S);
  if (end - start < LOOP_MIN_DURATION_S) {
    const deficit = LOOP_MIN_DURATION_S - (end - start);
    start = Math.max(0, start - deficit / 2);
    end = Math.min(duration, end + deficit / 2);
  }
  return end > start ? { start, end } : null;
}

// Only acts if the tile is still actually showing the path this lookup
// was for - by the time an async fetch resolves, fast rotation could
// already have moved it on to something else.
function applyLoopAnchorIfReady(i, path) {
  if (currentPaths[i] !== path) return;
  const vid = tileElements[i] && tileElements[i].querySelector('#screen-' + i);
  if (!vid) return;
  const anchor = loopAnchorCache[path];
  tileLoopBounds[i] = (anchor && vid.duration) ? computeLoopBounds(anchor, vid.duration) : null;
}

// Featured Tile: a visual highlight for a tile currently playing actual
// favorited content (heart_count > 0) - "featured" meaning something
// real about the content, not a random ambient flourish the way Mosaic
// Fit's aspect-driven sizing already varies tile shape for unrelated
// reasons.
const FEATURED_HEART_THRESHOLD = 2; // 1 heart could be a slip; 2+ is a real favorite

function applyFeaturedIfReady(i, path) {
  if (currentPaths[i] !== path) return;
  const tile = tileElements[i];
  if (!tile) return;
  const heartCount = videoMetaCache[path] ? videoMetaCache[path].heart_count : 0;
  tile.classList.toggle('tile-featured', heartCount >= FEATURED_HEART_THRESHOLD);
}

// One request per clip load feeds both Custom Loop Point and Featured
// Tile - they're unrelated mechanics, but both just need to know
// something about whatever clip a tile just loaded.
const videoMetaCache = {}; // video_path -> {heart_count, loop_anchor} | null

function fetchVideoMetaFor(i, path) {
  if (Object.prototype.hasOwnProperty.call(videoMetaCache, path)) {
    applyLoopAnchorIfReady(i, path);
    applyFeaturedIfReady(i, path);
    return;
  }
  fetch('/api/video_meta?path=' + encodeURIComponent(path))
    .then((r) => r.json())
    .then((data) => {
      videoMetaCache[path] = data || null;
      loopAnchorCache[path] = (data && data.loop_anchor) || null;
      applyLoopAnchorIfReady(i, path);
      applyFeaturedIfReady(i, path);
    })
    .catch(() => { videoMetaCache[path] = null; loopAnchorCache[path] = null; });
}

// ---- Mosaic Fit (experimental) ----
// Instead of a uniform grid, size each tile by its clip's own aspect ratio -
// pack tiles into justified rows (same idea as a Flickr/Google-Photos photo
// wall) so there's much less black-bar letterboxing. Aspect ratios only
// become known once a clip's metadata loads, and clips rotate on their own
// independent schedules, so reflowing on every single change would make
// neighboring tiles constantly resize around each other; instead this
// reflows periodically (MOSAIC_REFLOW_INTERVAL_MS) plus a few explicit
// triggers (toggling on, tile count changing, window resize, and once
// shortly after a tile's *first* real aspect ratio arrives).
const MOSAIC_REFLOW_INTERVAL_MS = 8000;
const DEFAULT_ASPECT = 16 / 9;
let mosaicEnabled = false;
let aspectRatios = [];
let aspectKnown = [];
let tileSpeedBurstUntil = [];
let mosaicSettleTimer = null;

function loadMosaicPref() {
  try { mosaicEnabled = localStorage.getItem('mm_mosaic_enabled') === '1'; } catch (e) {}
  const btn = document.getElementById('mosaic-toggle');
  btn.innerText = mosaicEnabled ? 'ON' : 'OFF';
  btn.classList.toggle('active', mosaicEnabled);
}

function toggleMosaic() {
  mosaicEnabled = !mosaicEnabled;
  try { localStorage.setItem('mm_mosaic_enabled', mosaicEnabled ? '1' : '0'); } catch (e) {}
  const btn = document.getElementById('mosaic-toggle');
  btn.innerText = mosaicEnabled ? 'ON' : 'OFF';
  btn.classList.toggle('active', mosaicEnabled);
  applyLayoutMode();
}

function onAspectKnown(i) {
  const vid = tileElements[i] && tileElements[i].querySelector('#screen-' + i);
  if (!vid || !vid.videoWidth || !vid.videoHeight) return;
  const isFirstReal = !aspectKnown[i];
  aspectKnown[i] = true;
  aspectRatios[i] = vid.videoWidth / vid.videoHeight;
  if (mosaicEnabled && isFirstReal) {
    // Several tiles often get their first real aspect ratio within
    // milliseconds of each other (e.g. right after a layout switch) -
    // settle once, shortly after the last one arrives, not once per tile.
    clearTimeout(mosaicSettleTimer);
    mosaicSettleTimer = setTimeout(() => { if (mosaicEnabled) layoutMosaic(); }, 200);
  }
}

function splitEvenly(n, rows) {
  const base = Math.floor(n / rows);
  const extra = n % rows;
  const sizes = [];
  for (let r = 0; r < rows; r++) sizes.push(base + (r < extra ? 1 : 0));
  return sizes;
}

function computeMosaicRows(aspects, containerWidth, containerHeight) {
  const n = aspects.length;
  if (n === 0 || containerWidth < 1 || containerHeight < 1) return [];

  let best = null;
  for (let rows = 1; rows <= n; rows++) {
    const sizes = splitEvenly(n, rows);
    if (sizes.some(s => s === 0)) continue;
    // A single row holding every tile (or the opposite - one tall column,
    // rows===n) occasionally wins this search on pure height-matching
    // arithmetic for some aspect-ratio mixes, but it reads as everything
    // squished flat into one sliver - skip both extremes whenever there's
    // a real alternative.
    if (n > 2 && (rows === 1 || rows === n)) continue;

    let idx = 0;
    const groups = sizes.map(size => aspects.slice(idx, (idx += size)));
    const rowNaturalHeights = groups.map(g => containerWidth / g.reduce((a, b) => a + b, 0));
    const totalNaturalHeight = rowNaturalHeights.reduce((a, b) => a + b, 0);
    const diff = Math.abs(totalNaturalHeight - containerHeight);
    if (!best || diff < best.diff) best = { groups, rowNaturalHeights, totalNaturalHeight, diff };
  }
  if (!best) return [];

  // Scale row heights so they sum to exactly containerHeight (no leftover
  // vertical gap, no overflow). Width shares are computed independently,
  // as each item's fraction of its row's total aspect ratio - that ALWAYS
  // sums to exactly 100%, regardless of how far the height scale ends up
  // from 1. The cost is that a cell's forced aspect may no longer exactly
  // match its video's native aspect when the scale is far from 1; cover is
  // applied in CSS so that shows up as a touch more cropping, never as a
  // black bar or overflow.
  const scale = containerHeight / best.totalNaturalHeight;
  let index = 0;
  return best.groups.map((group, gi) => {
    const rowHeight = best.rowNaturalHeights[gi] * scale;
    const aspectSum = group.reduce((a, b) => a + b, 0);
    const items = group.map(aspect => ({
      screenIndex: index++,
      widthPct: (aspect / aspectSum) * 100,
    }));
    return { heightPx: rowHeight, items };
  });
}

function layoutMosaic() {
  const grid = document.getElementById('screen-grid');
  const rect = grid.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10 || tileElements.length === 0) return;

  grid.className = 'screen-grid mosaic';
  grid.style.gridTemplateColumns = '';
  grid.style.gridTemplateRows = '';

  const rows = computeMosaicRows(aspectRatios.slice(0, tileElements.length), rect.width, rect.height);
  grid.innerHTML = '';
  rows.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'mosaic-row';
    rowEl.style.height = row.heightPx + 'px';
    row.items.forEach(item => {
      const tile = tileElements[item.screenIndex];
      if (!tile) return;
      tile.style.flexBasis = item.widthPct + '%';
      tile.style.width = item.widthPct + '%';
      rowEl.appendChild(tile); // re-parents the existing tile (and its <video>) without reloading it
    });
    grid.appendChild(rowEl);
  });
}

function applyUniformGrid() {
  const grid = document.getElementById('screen-grid');
  grid.className = 'screen-grid';
  grid.style.gridTemplateColumns = 'repeat(' + currentColumns + ', 1fr)';
  grid.style.gridTemplateRows = 'repeat(' + Math.ceil(currentTileCount / currentColumns) + ', 1fr)';
  grid.innerHTML = '';
  tileElements.forEach(tile => {
    tile.style.flexBasis = '';
    tile.style.width = '';
    grid.appendChild(tile);
  });
}

function applyLayoutMode() {
  if (mosaicEnabled) layoutMosaic();
  else applyUniformGrid();
}

// ---- Floating Overlay FX (experimental) ----
// A handful of video clips drift across the screen above the main grid,
// fading in, moving in a straight line at a random angle, then fading out
// and respawning elsewhere with a new clip - like a DVD logo, minus the
// bounce. Pure CSS-transition driven (one transition covers the whole
// drift, the browser interpolates it with no per-frame JS), so it's cheap
// regardless of how many sprites are running.
const FX_MIN_LIFETIME_S = 10;
const FX_MAX_LIFETIME_S = 25;
const FX_FADE_S = 1.5;
const FX_MIN_SIZE_VW = 6;
const FX_MAX_SIZE_VW = 32;
const FX_SHARD_OFFSET = 100; // keep fx sprites on their own loopback shards, separate from the main grid

let fxEnabled = false;
let fxCount = 3;
let fxOpacity = 60;
let fxSource = 'library';
let fxSourceLists = { dedicated: null, library: null };
let fxSprites = [];

function loadFxPrefs() {
  try {
    const en = localStorage.getItem('mm_fx_enabled');
    const ct = localStorage.getItem('mm_fx_count');
    const op = localStorage.getItem('mm_fx_opacity');
    const src = localStorage.getItem('mm_fx_source');
    if (en !== null) fxEnabled = en === '1';
    if (ct !== null) fxCount = parseInt(ct, 10);
    if (op !== null) fxOpacity = parseInt(op, 10);
    if (src !== null) fxSource = src;
  } catch (e) {}
  document.getElementById('fx-toggle').innerText = fxEnabled ? 'ON' : 'OFF';
  document.getElementById('fx-toggle').classList.toggle('active', fxEnabled);
  document.getElementById('fx-count-input').value = fxCount;
  document.getElementById('l-fx-count').innerText = fxCount;
  document.getElementById('fx-opacity-input').value = fxOpacity;
  document.getElementById('l-fx-opacity').innerText = fxOpacity + '%';
  updateFxSourceButtons();
  if (fxEnabled) startFx();
}

function updateFxSourceButtons() {
  ['dedicated', 'library', 'both'].forEach(s => {
    document.getElementById('fx-source-' + s).classList.toggle('active', s === fxSource);
  });
}

function toggleFx() {
  fxEnabled = !fxEnabled;
  try { localStorage.setItem('mm_fx_enabled', fxEnabled ? '1' : '0'); } catch (e) {}
  document.getElementById('fx-toggle').innerText = fxEnabled ? 'ON' : 'OFF';
  document.getElementById('fx-toggle').classList.toggle('active', fxEnabled);
  if (fxEnabled) startFx(); else stopFx();
}

function setFxSource(src) {
  fxSource = src;
  try { localStorage.setItem('mm_fx_source', src); } catch (e) {}
  updateFxSourceButtons();
  fxSourceLists = { dedicated: null, library: null };
}

function setFxCount(v) {
  fxCount = parseInt(v, 10);
  document.getElementById('l-fx-count').innerText = fxCount;
  try { localStorage.setItem('mm_fx_count', fxCount); } catch (e) {}
  if (fxEnabled) reconcileFxSpriteCount();
}

function setFxOpacity(v) {
  fxOpacity = parseInt(v, 10);
  document.getElementById('l-fx-opacity').innerText = fxOpacity + '%';
  try { localStorage.setItem('mm_fx_opacity', fxOpacity); } catch (e) {}
  fxSprites.forEach(s => { if (s && s.state === 'visible') s.el.style.opacity = String(fxOpacity / 100); });
}

function fetchFxList(source) {
  if (fxSourceLists[source]) return Promise.resolve(fxSourceLists[source]);
  return fetch('/api/overlay_fx/list?source=' + source)
    .then(r => r.json())
    .then(d => { fxSourceLists[source] = d.items || []; return fxSourceLists[source]; })
    .catch(() => []);
}

function pickFxSourceList() {
  if (fxSource === 'library') return fetchFxList('library');
  if (fxSource === 'dedicated') return fetchFxList('dedicated');
  return Promise.all([fetchFxList('dedicated'), fetchFxList('library')]).then(([a, b]) => a.concat(b));
}

function startFx() {
  document.getElementById('fx-layer').innerHTML = '';
  fxSprites = [];
  for (let i = 0; i < fxCount; i++) spawnFxSprite(i, Math.random() * 4000);
}

function stopFx() {
  fxSprites.forEach(s => s && clearTimeout(s.timer));
  fxSprites = [];
  document.getElementById('fx-layer').innerHTML = '';
}

function reconcileFxSpriteCount() {
  if (fxSprites.length < fxCount) {
    for (let i = fxSprites.length; i < fxCount; i++) spawnFxSprite(i, 0);
  } else if (fxSprites.length > fxCount) {
    fxSprites.splice(fxCount).forEach(s => {
      if (!s) return;
      clearTimeout(s.timer);
      if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    });
  }
}

function spawnFxSprite(slot, delayMs) {
  const sprite = { slot, el: null, timer: null, state: 'pending', currentPath: null };
  fxSprites[slot] = sprite;
  sprite.timer = setTimeout(() => activateFxSprite(sprite), delayMs);
}

function pickFxItem(items, sprite) {
  // Avoid picking something another currently-visible (or still-fading-out)
  // sprite is already showing, so two floaters don't end up playing the
  // same clip at once. Falls back to the full list if exclusion would
  // otherwise leave nothing to pick from.
  const exclude = new Set();
  fxSprites.forEach(s => {
    if (s && s !== sprite && (s.state === 'visible' || s.state === 'fading') && s.currentPath) {
      exclude.add(s.currentPath);
    }
  });
  const filtered = items.filter(it => !exclude.has(it.base + it.path));
  const pool = filtered.length ? filtered : items;
  return pool[Math.floor(Math.random() * pool.length)];
}

function activateFxSprite(sprite) {
  if (!fxEnabled) return;
  pickFxSourceList().then(items => {
    if (!fxEnabled) return;
    if (!items || !items.length) {
      sprite.timer = setTimeout(() => activateFxSprite(sprite), 4000);
      return;
    }

    const item = pickFxItem(items, sprite);
    sprite.currentPath = item.base + item.path;
    const layer = document.getElementById('fx-layer');
    let el = sprite.el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'fx-sprite';
      el.innerHTML = '<video muted loop playsinline></video>';
      layer.appendChild(el);
      sprite.el = el;
    }
    const vid = el.querySelector('video');
    vid.onloadedmetadata = () => {
      if (vid.videoWidth && vid.videoHeight) {
        el.style.height = (parseFloat(el.style.width) * vid.videoHeight / vid.videoWidth) + 'px';
      }
    };
    vid.src = mediaOrigin(FX_SHARD_OFFSET + sprite.slot) + item.base + item.path;
    vid.play().catch(() => {});

    const sizePx = ((FX_MIN_SIZE_VW + Math.random() * (FX_MAX_SIZE_VW - FX_MIN_SIZE_VW)) / 100) * window.innerWidth;
    el.style.width = sizePx + 'px';
    el.style.height = (sizePx * 9 / 16) + 'px'; // corrected above once real metadata loads

    const vw = window.innerWidth, vh = window.innerHeight;
    const maxX = Math.max(0, vw - sizePx);
    const maxY = Math.max(0, vh - sizePx * 9 / 16);
    const startX = Math.random() * maxX;
    const startY = Math.random() * maxY;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.max(vw, vh) * (0.3 + Math.random() * 0.4);
    // Clamped to the same bounds as the start point - an unclamped
    // endpoint could send a floater well past the edge of the viewport,
    // so for however much of its lifetime remained after that it was
    // just gone, off-screen, before it could actually be enjoyed.
    const endX = Math.max(0, Math.min(maxX, startX + Math.cos(angle) * distance));
    const endY = Math.max(0, Math.min(maxY, startY + Math.sin(angle) * distance));
    const lifetime = sprite.burst
      ? 3 + Math.random() * 3
      : FX_MIN_LIFETIME_S + Math.random() * (FX_MAX_LIFETIME_S - FX_MIN_LIFETIME_S);

    el.style.transition = 'none';
    el.style.transform = `translate(${startX}px, ${startY}px)`;
    el.style.opacity = '0';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = `transform ${lifetime}s linear, opacity ${FX_FADE_S}s ease`;
        el.style.transform = `translate(${endX}px, ${endY}px)`;
        el.style.opacity = String(fxOpacity / 100);
      });
    });

    sprite.state = 'visible';
    sprite.timer = setTimeout(() => {
      sprite.state = 'fading';
      el.style.opacity = '0'; // reuses the opacity transition declared above
      sprite.timer = setTimeout(() => {
        vid.pause();
        if (sprite.burst) {
          if (sprite.el && sprite.el.parentNode) sprite.el.parentNode.removeChild(sprite.el);
          const idx = fxSprites.indexOf(sprite);
          if (idx >= 0) fxSprites.splice(idx, 1);
          return;
        }
        sprite.timer = setTimeout(() => activateFxSprite(sprite), 500 + Math.random() * 3000);
      }, FX_FADE_S * 1000 + 100);
    }, Math.max(0, lifetime - FX_FADE_S) * 1000);
  });
}

function burstExtraFloaters(scale) {
  if (!fxEnabled) return;
  const n = Math.min(8, Math.max(1, Math.round(3 * (scale || 1.0))));
  for (let i = 0; i < n; i++) {
    const sprite = { slot: 1000 + i, el: null, timer: null, state: 'pending', currentPath: null, burst: true };
    fxSprites.push(sprite);
    activateFxSprite(sprite);
  }
}

// ---- Client-side audio engine ----
// The binaural tone (Web Audio) and the overlay track (<audio>) both play
// locally in whichever browser has this page open - including a phone on
// the same Wi-Fi - instead of coming out of the server machine's speakers.
// Volume is therefore a per-device setting, persisted in localStorage.
let audioCtx = null;
let synthNodes = null;
let overlayEl = null;
let currentAudioPath = '';
let audioUnlocked = false;
let binauralVolume = 80;
let overlayVolume = 85;

function loadVolumePrefs() {
  try {
    const bv = localStorage.getItem('mm_binaural_vol');
    const ov = localStorage.getItem('mm_overlay_vol');
    if (bv !== null) binauralVolume = parseInt(bv, 10);
    if (ov !== null) overlayVolume = parseInt(ov, 10);
  } catch (e) {}
  document.getElementById('binaural-vol-input').value = binauralVolume;
  document.getElementById('l-binaural-vol').innerText = binauralVolume + '%';
  document.getElementById('overlay-vol-input').value = overlayVolume;
  document.getElementById('l-overlay-vol').innerText = overlayVolume + '%';
}

function applyVolumes() {
  if (synthNodes && audioCtx) {
    synthNodes.masterGain.gain.setTargetAtTime(BINAURAL_BASE_GAIN * (binauralVolume / 100), audioCtx.currentTime, 0.05);
  }
  if (overlayEl) {
    overlayEl.volume = Math.max(0, Math.min(1, overlayVolume / 100));
  }
}

function setBinauralVolume(v) {
  binauralVolume = parseInt(v, 10);
  document.getElementById('l-binaural-vol').innerText = binauralVolume + '%';
  try { localStorage.setItem('mm_binaural_vol', binauralVolume); } catch (e) {}
  applyVolumes();
}

function setOverlayVolume(v) {
  overlayVolume = parseInt(v, 10);
  document.getElementById('l-overlay-vol').innerText = overlayVolume + '%';
  try { localStorage.setItem('mm_overlay_vol', overlayVolume); } catch (e) {}
  applyVolumes();
}

function buildSynthGraph() {
  const ctx = audioCtx;
  const leftOsc = ctx.createOscillator();
  const rightOsc = ctx.createOscillator();

  // Gate (isochronic pulse) - identical modulation fed to both ears via
  // AudioParam fan-in, so gate(t) = (1 - 0.5*iso) + (0.5*iso)*sin(2*pi*beat*t).
  const gateLeft = ctx.createGain(); gateLeft.gain.value = 0;
  const gateRight = ctx.createGain(); gateRight.gain.value = 0;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
  const offset = ctx.createConstantSource(); offset.offset.value = 1;
  lfo.connect(lfoGain);
  lfoGain.connect(gateLeft.gain);
  lfoGain.connect(gateRight.gain);
  offset.connect(gateLeft.gain);
  offset.connect(gateRight.gain);

  const pannerLeft = ctx.createStereoPanner(); pannerLeft.pan.value = -1;
  const pannerRight = ctx.createStereoPanner(); pannerRight.pan.value = 1;
  const masterGain = ctx.createGain();
  masterGain.gain.value = BINAURAL_BASE_GAIN * (binauralVolume / 100);

  leftOsc.connect(gateLeft); gateLeft.connect(pannerLeft); pannerLeft.connect(masterGain);
  rightOsc.connect(gateRight); gateRight.connect(pannerRight); pannerRight.connect(masterGain);
  masterGain.connect(ctx.destination);

  leftOsc.start(); rightOsc.start(); lfo.start(); offset.start();
  synthNodes = { leftOsc, rightOsc, lfo, lfoGain, offset, masterGain };
}

function updateSynthParams(synth) {
  if (!synthNodes || !synth || !audioCtx) return;
  const now = audioCtx.currentTime;
  synthNodes.leftOsc.frequency.setTargetAtTime(synth.carrier_hz, now, 0.1);
  synthNodes.rightOsc.frequency.setTargetAtTime(synth.carrier_hz + synth.beat_hz, now, 0.1);
  synthNodes.lfo.frequency.setTargetAtTime(Math.max(0.01, synth.beat_hz), now, 0.1);
  synthNodes.lfoGain.gain.setTargetAtTime(0.5 * synth.iso, now, 0.1);
  synthNodes.offset.offset.setTargetAtTime(1 - 0.5 * synth.iso, now, 0.1);
}

function enableAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    buildSynthGraph();
    applyVolumes();
  }
  audioCtx.resume().then(() => {
    audioUnlocked = true;
    document.getElementById('audio-unlock').classList.remove('show');
    if (overlayEl && overlayEl.src) overlayEl.play().catch(() => {});
  }).catch(() => {});
}

function armAutoUnlock() {
  ['click', 'touchstart'].forEach(evt => document.addEventListener(evt, enableAudio, { once: true, passive: true }));
}

// ---- Anticipation / near-miss / payoff FX (experimental) ----
// "Honest" build-up: the server already tells every viewer how many barrage
// steps are left (d.barrage) before it resolves into a real jackpot - we
// just watch that count tick down and ramp a tension cue timed to peak
// around when it lands, then fire a real payoff when d.jackpot flips on.
// "Fake" near-miss: the same build-up cue, triggered by a random client-side
// timer with nothing real behind it, left to fizzle instead of pay off.
// Both are purely visual/audio flourish layered on the existing barrage/
// jackpot mechanic - nothing here changes what actually gets selected.
const FAKE_NEAR_MISS_CHECK_MS = 15000;
const FAKE_NEAR_MISS_PROBABILITY = 0.25;
const FAKE_NEAR_MISS_BUILD_S = 3.5;
const HONEST_BUILD_SAFETY_MS = 6000; // auto-fizzle if a real payoff never arrives (shouldn't normally fire)

let anticipationFxEnabled = true;
let nearMissEnabled = true;
let sfxVolume = 70;
let sfxGain = null;
let anticipationActive = false;
let anticipationRunId = 0;
let lastKnownBarrage = 0;
let lastKnownJackpot = false;

function loadAnticipationPrefs() {
  try {
    const en = localStorage.getItem('mm_anticipation_enabled');
    const nm = localStorage.getItem('mm_near_miss_enabled');
    const vol = localStorage.getItem('mm_sfx_vol');
    if (en !== null) anticipationFxEnabled = en === '1';
    if (nm !== null) nearMissEnabled = nm === '1';
    if (vol !== null) sfxVolume = parseInt(vol, 10);
  } catch (e) {}
  document.getElementById('anticipation-toggle').innerText = anticipationFxEnabled ? 'ON' : 'OFF';
  document.getElementById('anticipation-toggle').classList.toggle('active', anticipationFxEnabled);
  document.getElementById('near-miss-toggle').innerText = nearMissEnabled ? 'ON' : 'OFF';
  document.getElementById('near-miss-toggle').classList.toggle('active', nearMissEnabled);
  document.getElementById('sfx-vol-input').value = sfxVolume;
  document.getElementById('l-sfx-vol').innerText = sfxVolume + '%';
}

function toggleAnticipationFx() {
  anticipationFxEnabled = !anticipationFxEnabled;
  try { localStorage.setItem('mm_anticipation_enabled', anticipationFxEnabled ? '1' : '0'); } catch (e) {}
  document.getElementById('anticipation-toggle').innerText = anticipationFxEnabled ? 'ON' : 'OFF';
  document.getElementById('anticipation-toggle').classList.toggle('active', anticipationFxEnabled);
}

function toggleNearMiss() {
  nearMissEnabled = !nearMissEnabled;
  try { localStorage.setItem('mm_near_miss_enabled', nearMissEnabled ? '1' : '0'); } catch (e) {}
  document.getElementById('near-miss-toggle').innerText = nearMissEnabled ? 'ON' : 'OFF';
  document.getElementById('near-miss-toggle').classList.toggle('active', nearMissEnabled);
}

function setSfxVolume(v) {
  sfxVolume = parseInt(v, 10);
  document.getElementById('l-sfx-vol').innerText = sfxVolume + '%';
  try { localStorage.setItem('mm_sfx_vol', sfxVolume); } catch (e) {}
  if (sfxGain) sfxGain.gain.setTargetAtTime(sfxVolume / 100, audioCtx.currentTime, 0.05);
}

function ensureSfxBus() {
  if (!audioCtx) return null;
  if (!sfxGain) {
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = sfxVolume / 100;
    sfxGain.connect(audioCtx.destination);
  }
  return sfxGain;
}

let reverbImpulseBuffer = null;
let reverbSendGain = null;

function getReverbImpulse() {
  if (reverbImpulseBuffer) return reverbImpulseBuffer;
  // Synthesized impulse response (exponentially-decaying noise) - no audio
  // asset needed, consistent with every other sound in this file.
  const len = Math.ceil(audioCtx.sampleRate * 2.2);
  const buffer = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  reverbImpulseBuffer = buffer;
  return buffer;
}

function ensureReverbSend() {
  const bus = ensureSfxBus();
  if (!bus) return null;
  if (!reverbSendGain) {
    const convolver = audioCtx.createConvolver();
    convolver.buffer = getReverbImpulse();
    reverbSendGain = audioCtx.createGain();
    reverbSendGain.gain.value = 0.55;
    reverbSendGain.connect(convolver);
    convolver.connect(bus);
  }
  return reverbSendGain;
}

function playRiserSound(durationS) {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const tail = durationS + 0.35;

  // Pan the riser across the stereo field, speeding up as it builds (same
  // trick film sound design uses to pull attention) - routed in front of
  // the bus so both layers below move together.
  const panner = audioCtx.createStereoPanner();
  panner.connect(bus);
  const panLfo = audioCtx.createOscillator();
  panLfo.type = 'sine';
  const panLfoGain = audioCtx.createGain();
  panLfoGain.gain.value = 0.85;
  panLfo.connect(panLfoGain);
  panLfoGain.connect(panner.pan);
  panLfo.frequency.setValueAtTime(0.3, now);
  panLfo.frequency.exponentialRampToValueAtTime(3.2, now + durationS);
  panLfo.start(now);
  panLfo.stop(now + tail);

  // Main body: filtered noise that starts muffled and quiet, then opens up
  // in brightness and volume as it builds - the standard "cinematic riser"
  // technique. A raw sawtooth/square tone sweep is harmonic-rich and reads
  // as a buzzy drone (a "bee in your ear") when sustained for a few
  // seconds; filtered noise builds the same sense of rising tension
  // without that buzz.
  const bufferSize = Math.ceil(audioCtx.sampleRate * tail);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(200, now);
  filter.frequency.exponentialRampToValueAtTime(3200, now + durationS);

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.18, now + durationS * 0.9);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
  noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(panner);

  // Soft sine undertone: adds a sense of pitch rising without the harmonics
  // a sawtooth/square would add.
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(260, now + durationS);
  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.0001, now);
  oscGain.gain.exponentialRampToValueAtTime(0.09, now + durationS * 0.85);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
  osc.connect(oscGain); oscGain.connect(panner);

  noise.start(now); noise.stop(now + tail);
  osc.start(now); osc.stop(now + tail);

  scheduleHeartbeat(durationS);
}

function scheduleHeartbeat(durationS) {
  // A low rhythmic thump that speeds up through the build-up - the
  // thriller-score trick for perceived urgency, distinct from the riser's
  // continuous pitch/brightness sweep. Scheduled all at once up front using
  // precise Web Audio timestamps (accurate; a setTimeout loop would drift).
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const minInterval = 0.14;
  const maxInterval = 0.62;
  let t = 0;
  while (t < durationS) {
    const frac = t / durationS;
    playHeartbeatThump(now + t);
    const interval = maxInterval - (maxInterval - minInterval) * (frac * frac);
    t += interval;
  }
}

function playHeartbeatThump(startTime) {
  const bus = ensureSfxBus();
  if (!bus) return;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(70, startTime);
  g.gain.setValueAtTime(0.0001, startTime);
  g.gain.exponentialRampToValueAtTime(0.16, startTime + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);
  osc.start(startTime);
  osc.stop(startTime + 0.15);
}

function playFizzleSound() {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(480, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.5);
  g.gain.setValueAtTime(0.22, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.start(now);
  osc.stop(now + 0.6);
}

function playChimeSound(scale, pitch) {
  const bus = ensureSfxBus();
  if (!bus) return;
  scale = scale || 1.0;
  pitch = pitch || 1.0; // slight upward creep for chase-catch streaks - see catchChaseFlash
  const now = audioCtx.currentTime;
  const notes = scale >= 1.3
    ? [523.25, 659.25, 783.99, 1046.5, 1318.5] // mega gets a fifth, higher note
    : [523.25, 659.25, 783.99, 1046.5];
  const reverbSend = scale >= 1.3 ? ensureReverbSend() : null; // mega only: richer, more "epic" tail
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(bus);
    if (reverbSend) g.connect(reverbSend);
    const t0 = now + i * 0.09;
    osc.frequency.setValueAtTime(freq * pitch, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.min(0.45, 0.255 * scale), t0 + 0.02); // base is already 15% quieter
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.start(t0);
    osc.stop(t0 + 0.55);
  });
}

// A short, distinct two-note blip (square wave, not the chime's triangle)
// layered on top of the normal payoff when a jackpot lands right inside
// the streak-reset warning window - a "just made it" cue, not a bigger one.
function playClutchSting() {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  [880, 1174.66].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(bus);
    const t0 = now + i * 0.07;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  });
}

function playBassDropSound(scale) {
  const bus = ensureSfxBus();
  if (!bus) return;
  scale = scale || 1.0;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(42, now + 0.25); // fast pitch drop - the "thump"
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.min(0.85, 0.5 * scale), now + 0.02); // fast attack, felt more than heard
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.start(now);
  osc.stop(now + 0.6);
}

function pickRandomTiles() {
  if (!tileElements.length) return [];
  const count = tileElements.length >= 2 && Math.random() < 0.5 ? 2 : 1;
  const indices = [];
  while (indices.length < count && indices.length < tileElements.length) {
    const idx = Math.floor(Math.random() * tileElements.length);
    if (!indices.includes(idx)) indices.push(idx);
  }
  return indices;
}

function runAnticipationBuildUp(durationS, isReal, weightedTiles, tierName) {
  if (!anticipationFxEnabled) return;
  anticipationActive = true;
  const runId = ++anticipationRunId;
  const theater = document.getElementById('theater-box');
  const theaterGlow = document.getElementById('theater-glow');
  teaseNextTheme(theater);
  // A running CSS animation on opacity/border-color wins out over this
  // loop's own inline style writes to the same element until it ends -
  // clear any ambient color-breathe in progress so it can't fight with
  // the real build-up's glow on whichever tile it happened to land on.
  tileGlowEls.forEach(el => { if (el) el.classList.remove('ambient-breath'); });
  // Variable build-up length: the shape of the tension, not just whether
  // it resolves, is part of the uncertainty. Purely a visual/audio pacing
  // change - a real jackpot's actual timing is still driven by the status
  // stream, not by this duration.
  const variedDuration = durationS * (0.7 + Math.random() * 0.9);
  playRiserSound(variedDuration);
  const start = performance.now();
  // Real barrages pass the server's actual list of screens about to get
  // new content (so the glow highlights tiles that are really about to
  // change); fake near-misses have no such list, so pick 1-2 at random
  // purely for the "something's choosing" feeling - nothing behind it.
  if (!weightedTiles) weightedTiles = pickRandomTiles();
  // Mega is a genuinely different moment, not just a louder one: the rest
  // of the grid dims slightly so attention actually goes to the screens
  // that are really about to change. A plain opacity overlay (see
  // .tile-dimmed), never filter/brightness on the video itself.
  if (isReal && tierName === 'mega' && weightedTiles.length) {
    tileElements.forEach((tile, idx) => {
      if (tile && !weightedTiles.includes(idx)) tile.classList.add('tile-dimmed');
    });
  }

  function tick() {
    if (runId !== anticipationRunId) return;
    const elapsed = (performance.now() - start) / 1000;
    const progress = Math.min(1, elapsed / variedDuration);
    const intensity = progress * progress; // ease-in: stays subtle, then ramps hard near the end
    const freq = 2 + intensity * 10;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * freq);
    // Glow is driven entirely through opacity on dedicated overlay divs
    // (never box-shadow/filter on the theater or tile/video elements
    // themselves) so this per-frame loop only ever touches a
    // compositor-only property - it doesn't force paint and so doesn't
    // compete with video decode, no matter how many tiles are on screen.
    if (theaterGlow) theaterGlow.style.opacity = Math.min(1, (0.15 + intensity * 0.65) * (0.6 + 0.4 * pulse)).toFixed(2);
    // Smooth, slow-sine glow on every tile (not a flicker/strobe - frequency
    // here tops out around 7Hz and the transition is a continuous sine, well
    // outside the 3-30Hz flash range that can trigger photosensitive seizures)
    // so the eye is drawn to the grid without any rapid on/off flashing.
    const tileGlowAlpha = (0.15 + intensity * 0.5) * (0.65 + 0.35 * pulse);
    tileGlowEls.forEach((el, idx) => {
      if (!el) return;
      const weightedFade = weightedTiles.includes(idx) ? (1 - intensity) : 0;
      el.style.opacity = Math.min(1, tileGlowAlpha + weightedFade * 0.4).toFixed(2);
    });
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else if (!isReal) {
      fizzleAnticipation(runId);
    } else {
      // Peak reached before the real jackpot landed yet - hold, then a safety
      // net in case the expected payoff status update never arrives.
      setTimeout(() => fizzleAnticipation(runId), HONEST_BUILD_SAFETY_MS);
    }
  }
  requestAnimationFrame(tick);
}

function clearTileGlow() {
  tileGlowEls.forEach(el => { if (el) el.style.opacity = '0'; });
  tileElements.forEach(tile => { if (tile) tile.classList.remove('tile-dimmed'); });
}

function fizzleAnticipation(runId) {
  if (runId !== anticipationRunId || !anticipationActive) return;
  const theater = document.getElementById('theater-box');
  const theaterGlow = document.getElementById('theater-glow');
  if (theaterGlow) { theaterGlow.style.transition = 'opacity 0.6s ease'; theaterGlow.style.opacity = '0'; }
  clearTileGlow();
  theater.classList.add('glitch');
  playFizzleSound();
  setTimeout(() => {
    theater.classList.remove('glitch');
    if (theaterGlow) theaterGlow.style.transition = '';
    anticipationActive = false;
  }, 650);
}

// Jackpot tiers: magnitude is uncertain too, not just timing - bigger tiers
// get a brighter flash, a fuller chime, more bass, a bigger floater burst,
// and (mega only) a brief screen shake. Picked client-side purely for the
// celebration's scale; doesn't affect what actually gets selected.
const JACKPOT_TIERS = [
  { name: 'small', weight: 65, flash: 1.0, chime: 1.0, burst: 1.0, bass: 1.0, shake: false },
  { name: 'medium', weight: 28, flash: 1.3, chime: 1.15, burst: 1.6, bass: 1.25, shake: false },
  { name: 'mega', weight: 7, flash: 1.7, chime: 1.3, burst: 2.4, bass: 1.6, shake: true },
];
const MILESTONE_TIER = { name: 'milestone', flash: 2.2, chime: 1.5, burst: 3.5, bass: 2.0, shake: true };
const MILESTONE_COUNTS = [5, 10, 25, 50, 100, 200, 500, 1000];
const STREAK_RESET_MS = 180000; // 3 minutes without a jackpot resets the streak back to 0
const STREAK_WARNING_S = 30; // show the "at risk" countdown in the last 30s before that reset
const TIER_REVEAL_DELAYS = [70, 70, 80, 90, 110, 140, 180, 230, 320]; // speeds up then settles, like a reel stopping
const TIER_LABELS = { small: 'JACKPOT', medium: 'BIG JACKPOT', mega: 'MEGA JACKPOT', milestone: 'MILESTONE' };

// Rotating color themes: each real jackpot shifts the palette for the next
// build-up/payoff cycle. Partly "craft and variety" (keeps a long session
// feeling fresh), partly functional - identical repeated stimuli habituate
// the reward response, so novelty here also keeps the payoff itself from
// going stale.
const COLOR_THEMES = [
  { glow: '255,70,30', flash: '255,220,120', after: '255,190,100' }, // ember
  { glow: '190,60,255', flash: '220,160,255', after: '200,140,255' }, // violet
  { glow: '40,220,130', flash: '160,255,200', after: '120,255,180' }, // emerald
  { glow: '40,140,255', flash: '160,210,255', after: '120,190,255' }, // azure
  { glow: '255,60,110', flash: '255,170,200', after: '255,150,190' }, // rose
];
let colorThemeIndex = 0;

function applyColorTheme(idx) {
  const theme = COLOR_THEMES[((idx % COLOR_THEMES.length) + COLOR_THEMES.length) % COLOR_THEMES.length];
  const root = document.documentElement.style;
  root.setProperty('--theme-glow', theme.glow);
  root.setProperty('--theme-flash', theme.flash);
  root.setProperty('--theme-after', theme.after);
}

function rotateColorTheme() {
  colorThemeIndex++;
  applyColorTheme(colorThemeIndex);
}

// Flash-forward teaser: a sub-second glimpse of the *next* theme in the
// rotation, right as a build-up starts - like a coming-attractions sting.
// Safe to overwrite --theme-flash here: a real payoff always calls
// rotateColorTheme() -> applyColorTheme() before using it, which resets it.
function teaseNextTheme(theater) {
  const preview = COLOR_THEMES[(colorThemeIndex + 1) % COLOR_THEMES.length];
  theater.style.setProperty('--theme-flash', preview.flash);
  theater.classList.add('theme-teaser');
  setTimeout(() => theater.classList.remove('theme-teaser'), 150);
}

// Always-on anticipation meter: a persistent charge bar that fills up the
// longer it's been since the last jackpot, instead of tension only
// becoming visible once a barrage is already underway. Purely a feeling -
// it doesn't change real odds - but it ticks faster during Golden
// Hour/Surge/combo since those *do* raise real odds, so it stays honest
// about when things are actually hotter.
const ANTICIPATION_METER_FULL_MS = 90000;
let lastAnyPayoffAt = 0;

function tickAnticipationMeter() {
  const fill = document.getElementById('anticipation-meter-fill');
  if (!fill) return;
  const effectiveElapsed = (Date.now() - lastAnyPayoffAt) * oddsMultiplier();
  const pct = Math.min(100, (effectiveElapsed / ANTICIPATION_METER_FULL_MS) * 100);
  fill.style.width = pct + '%';
}

// "Due" tile aura: tiles that haven't been rated in a while get a faint,
// slow pulsing aura - leans into the (not literally true) sense that a
// quiet tile is "due," drawing the eye back to it. Once a tile is picked,
// it holds that spot for at least TUNING.DUE_AURA_MIN_HOLD_MS before
// another tile is allowed to take over - without this, recomputing "most
// idle" fresh every single tick could hand the glow to a different tile
// before you'd even gotten to the one it was just on, which read as
// chasing a moving target around the screen rather than something you
// could actually act on.
let tileLastRatedAt = {};

let dueAuraTileIndex = -1;
let dueAuraSetAt = 0;

function tickDueAura() {
  // Only ever the single most-idle tile, not every tile past the threshold -
  // an infinite box-shadow animation on every tile in the grid at once was
  // heavy enough to visibly stall video playback across the whole screen.
  const now = Date.now();
  let mostIdleTile = -1;
  let mostIdleMs = TUNING.DUE_AURA_THRESHOLD_MS;
  tileElements.forEach((tile, i) => {
    if (!tile) return;
    const idleMs = now - (tileLastRatedAt[i] || sessionStartedAt);
    if (idleMs > mostIdleMs) {
      mostIdleMs = idleMs;
      mostIdleTile = i;
    }
  });

  if (dueAuraTileIndex >= 0 && mostIdleTile !== dueAuraTileIndex) {
    const currentIdleMs = now - (tileLastRatedAt[dueAuraTileIndex] || sessionStartedAt);
    const currentStillQualifies = currentIdleMs > TUNING.DUE_AURA_THRESHOLD_MS;
    if (currentStillQualifies && now - dueAuraSetAt < TUNING.DUE_AURA_MIN_HOLD_MS) {
      mostIdleTile = dueAuraTileIndex; // not time to hand it off yet
    }
  }

  if (mostIdleTile !== dueAuraTileIndex) dueAuraSetAt = now;
  dueAuraTileIndex = mostIdleTile;
  tileAmbientEls.forEach((el, i) => {
    if (el) el.classList.toggle('due-aura', i === mostIdleTile);
  });
}

// Tapping a due-aura tile acknowledges it without forcing an actual
// up/down rating - sometimes you just don't feel strongly either way,
// and being nagged with no "leave me alone" option but a real rating
// wasn't great. Resets its idle clock the same as a real rating would,
// so it stops glowing, but sends nothing to the server.
function dismissDueAura(idx) {
  if (idx !== dueAuraTileIndex) return;
  tileLastRatedAt[idx] = Date.now();
  const el = tileAmbientEls[idx];
  if (el) el.classList.remove('due-aura');
  dueAuraTileIndex = -1;
  toast('👁 Noted - won\'t ask about this one for a while');
}

// Plain-language readout of whatever's currently active, in priority
// order (most specific/time-limited first) - see #status-bar's CSS
// comment for why this exists. Polled rather than purely event-driven
// so it self-corrects if a state ends without an explicit "clear" path
// ever running (e.g. a tab backgrounded through a setTimeout).
function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  if (!bar) return;
  let text = null;
  if (anticipationActive) {
    // pendingServerTier is known as soon as a real (server-driven) build-up
    // starts - read without consuming it (only resolveTier() clears it) so
    // this can say what's actually coming instead of staying vague. Fake
    // near-misses have no server tier at all, so they stay vague on
    // purpose - revealing "this one's fake" would spoil the point of them.
    text = pendingServerTier ? ('🔥 Building... (' + pendingServerTier + ' incoming)') : '🔥 Something\'s building...';
  } else if (sealedTileIndex >= 0) {
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
  } else if (jackpotStreak > 1 && Date.now() - lastJackpotAt < STREAK_RESET_MS) {
    text = '🔥 Jackpot streak x' + jackpotStreak;
  } else if (heartMultiplier >= 2) {
    text = '❤️ Heart multiplier x' + Math.floor(heartMultiplier);
  } else if (jackpotHeat > 1.2) {
    // Otherwise bumpJackpotHeat's whole effect (catch streaks/bonus taps
    // nudging odds toward bigger jackpots) would be invisible - nothing
    // to notice means nothing to feel rewarded by.
    text = '🔥 Odds heating up';
  } else if (autopilotZone) {
    // Lowest priority - only shown when nothing more pressing is. Auto-
    // Pilot's zone otherwise only showed in the panel itself, which
    // "can't tell if you're not in the menu."
    text = '🎬 ' + AUTOPILOT_ZONES[autopilotZone].label;
  }
  if (text) {
    el.innerText = text;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}
setInterval(updateModeBadge, 1000);

// Leveling/XP: a persistent long-horizon progress bar across sessions,
// separate from any single jackpot - the point is a number that only ever
// goes up, so coming back later always has somewhere to pick up from.
const XP_STORAGE_KEY = 'mm_xp_state';
const XP_PER_TIER = { small: 10, medium: 20, mega: 40, milestone: 60 };
const PRESTIGE_LEVEL_CAP = 20;
let xpTotal = 0;
let xpLevel = 1;
let prestigeCount = 0;

function xpForLevel(level) {
  // Gentle escalating curve: level N needs 100*N^1.4 cumulative XP.
  return Math.round(100 * Math.pow(level, 1.4));
}

function loadXpState() {
  try {
    const saved = JSON.parse(localStorage.getItem(XP_STORAGE_KEY) || '{}');
    xpTotal = Number(saved.xpTotal) || 0;
    prestigeCount = Number(saved.prestigeCount) || 0;
  } catch (e) { xpTotal = 0; prestigeCount = 0; }
  recomputeLevel();
  updateLevelUi();
}

function saveXpState() {
  try { localStorage.setItem(XP_STORAGE_KEY, JSON.stringify({ xpTotal, prestigeCount })); } catch (e) {}
}

function recomputeLevel() {
  let level = 1;
  while (xpTotal >= xpForLevel(level)) level++;
  xpLevel = level;
}

function updateLevelUi() {
  const el = document.getElementById('level-readout');
  if (el) {
    const curFloor = xpLevel > 1 ? xpForLevel(xpLevel - 1) : 0;
    const nextCeil = xpForLevel(xpLevel);
    const pct = Math.min(100, Math.round(((xpTotal - curFloor) / (nextCeil - curFloor)) * 100));
    const stars = prestigeCount > 0 ? '★'.repeat(Math.min(prestigeCount, 5)) + ' ' : '';
    const legacyTag = prestigeCount > 0 ? ' +' + Math.round((legacyBonusMultiplier() - 1) * 100) + '%xp' : '';
    el.innerText = stars + 'LV ' + xpLevel + ' · ' + xpTotal + 'xp (' + pct + '% to ' + (xpLevel + 1) + ')' + legacyTag;
  }
  const btn = document.getElementById('prestige-btn');
  if (btn) btn.style.display = xpLevel >= PRESTIGE_LEVEL_CAP ? 'inline-block' : 'none';
}

// Prestige Legacy Carry-over: each star is a permanent +5% XP bonus (capped
// at 50% / 10 stars) rather than prestiging being a pure reset - "trading
// back to 0" should leave something behind that keeps paying off, not just
// a cosmetic star.
const LEGACY_BONUS_PER_STAR = 0.05;
const LEGACY_BONUS_CAP = 0.5;

function legacyBonusMultiplier() {
  return 1 + Math.min(prestigeCount, 10) * LEGACY_BONUS_PER_STAR;
}

function awardXp(amount) {
  const beforeLevel = xpLevel;
  xpTotal += Math.round(amount * legacyBonusMultiplier());
  recomputeLevel();
  updateLevelUi();
  saveXpState();
  if (xpLevel > beforeLevel) toast('⭐ Level ' + xpLevel + '!');
}

// Prestige: once the level cap is hit, trade it back to 0 for a permanent
// star rank instead of the number just climbing forever uncapped - keeps
// "leveling up" meaningful again after the curve would otherwise flatten.
function prestige() {
  if (xpLevel < PRESTIGE_LEVEL_CAP) return;
  prestigeCount++;
  xpTotal = 0;
  recomputeLevel();
  updateLevelUi();
  saveXpState();
  toast('🌟 Prestige ' + prestigeCount + '! +' + Math.round(LEGACY_BONUS_PER_STAR * 100) + '% permanent XP');
  checkTrophies();
}

// Combo Chain Mechanics: any rewarding action in quick succession - rating,
// a chase catch, a bonus claim, a non-empty sealed tile - builds one shared
// short-lived multiplier (capped 3x) on XP and on near-miss/bonus-window
// odds, so a burst of activity feels electric regardless of which mechanic
// it's coming through, instead of each mechanic tracking its own isolated
// streak that never interacts with the others.
const COMBO_WINDOW_MS = 4000;
let comboCount = 0;
let comboExpireAt = 0;

function registerCombo() {
  const now = Date.now();
  comboCount = now < comboExpireAt ? comboCount + 1 : 1;
  comboExpireAt = now + COMBO_WINDOW_MS;
  updateComboUi();
  return comboMultiplier();
}

function comboMultiplier() {
  return Date.now() < comboExpireAt ? Math.min(3, 1 + (comboCount - 1) * 0.25) : 1;
}

function updateComboUi() {
  const el = document.getElementById('combo-readout');
  if (!el) return;
  el.innerText = comboCount > 1 && Date.now() < comboExpireAt ? ('x' + comboMultiplier().toFixed(2) + ' combo') : '';
}

// Patience Hold: a slower-paced counterpart to the combo/chase mechanics
// above, which all reward rapid activity - this rewards the opposite,
// a sustained stretch of NOT touching any control while still actually
// watching (tab visible). Session-wide, not per-tile, since the point is
// "you've been calmly present for a while," not tied to any one clip.
let lastAnyInteractionAt = Date.now();
let patienceAwardedAt = Date.now();

function markInteraction() { lastAnyInteractionAt = Date.now(); }

function maybeAwardPatience() {
  if (document.hidden) return; // can't call it "patiently watching" from a backgrounded tab
  const now = Date.now();
  if (now - lastAnyInteractionAt >= TUNING.PATIENCE_HOLD_MS && now - patienceAwardedAt >= TUNING.PATIENCE_HOLD_MS) {
    patienceAwardedAt = now;
    awardXp(TUNING.PATIENCE_XP);
    toast('🧘 Patience +' + TUNING.PATIENCE_XP + 'xp');
  }
}
startTunableInterval('PATIENCE_CHECK_MS', maybeAwardPatience);

// Nudge: a subtle visual cue pulling attention back to Spin specifically
// when it's been sitting ready and unused for a while - the one control
// that's purely player-initiated with no passive trigger of its own, so
// it's the one most likely to go unnoticed once the ambient mechanics
// are already keeping things busy.
const NUDGE_CHECK_MS = 60000;
const NUDGE_IDLE_MS = 120000;

function maybeNudgeSpin() {
  if (document.hidden) return;
  const btn = document.getElementById('spin-btn');
  if (!btn) return;
  const now = Date.now();
  if (now >= spinReadyAt && now - Math.max(spinReadyAt, sessionStartedAt) > NUDGE_IDLE_MS) {
    btn.classList.remove('spin-nudge');
    void btn.offsetWidth;
    btn.classList.add('spin-nudge');
    setTimeout(() => btn.classList.remove('spin-nudge'), 1200);
  }
}
setInterval(maybeNudgeSpin, NUDGE_CHECK_MS);

// Welcome Back Bonus: a one-time-per-return bonus scaled with how long
// you were away (capped), checked once at load against a timestamp left
// behind by the last visit - purely a "glad you're back" moment, not
// something that can be farmed by reloading the page repeatedly, since
// the gap has to actually clear the minimum threshold each time.
const WELCOME_BACK_KEY = 'mm_last_visit';
const WELCOME_BACK_MIN_GAP_MS = 4 * 60 * 60 * 1000; // 4h+ away counts as "back"
const WELCOME_BACK_MAX_GAP_MS = 72 * 60 * 60 * 1000; // gap beyond this doesn't earn more
const WELCOME_BACK_MIN_XP = 10;
const WELCOME_BACK_MAX_XP = 50;

function checkWelcomeBackBonus() {
  try {
    const last = Number(localStorage.getItem(WELCOME_BACK_KEY)) || 0;
    const now = Date.now();
    if (last && now - last >= WELCOME_BACK_MIN_GAP_MS) {
      const frac = Math.min(1, (now - last) / WELCOME_BACK_MAX_GAP_MS);
      const bonus = Math.round(WELCOME_BACK_MIN_XP + frac * (WELCOME_BACK_MAX_XP - WELCOME_BACK_MIN_XP));
      awardXp(bonus);
      toast('👋 Welcome back! +' + bonus + 'xp');
    }
  } catch (e) {}
  try { localStorage.setItem(WELCOME_BACK_KEY, String(Date.now())); } catch (e) {}
}

// Personal bests: lifetime stats that only ever improve, persisted across
// sessions - self-competition against your own history rather than a
// social leaderboard.
const STATS_STORAGE_KEY = 'mm_stats';
let statsBestStreak = 0;
let statsLifetimeJackpots = 0;
let statsBestMilestoneSeconds = {};
let statsLifetimeHearts = 0;
let statsBestChaseChain = 0;

function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_STORAGE_KEY) || '{}');
    statsBestStreak = Number(saved.bestStreak) || 0;
    statsLifetimeJackpots = Number(saved.lifetimeJackpots) || 0;
    statsBestMilestoneSeconds = saved.bestMilestoneSeconds || {};
    statsLifetimeHearts = Number(saved.lifetimeHearts) || 0;
    statsBestChaseChain = Number(saved.bestChaseChain) || 0;
  } catch (e) {
    statsBestStreak = 0; statsLifetimeJackpots = 0; statsBestMilestoneSeconds = {};
    statsLifetimeHearts = 0; statsBestChaseChain = 0;
  }
  updateStatsUi();
}

function saveStats() {
  try {
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify({
      bestStreak: statsBestStreak, lifetimeJackpots: statsLifetimeJackpots, bestMilestoneSeconds: statsBestMilestoneSeconds,
      lifetimeHearts: statsLifetimeHearts, bestChaseChain: statsBestChaseChain,
    }));
  } catch (e) {}
}

// Milestone Trophy: a small permanent trophy case built on top of the
// personal-best stats above - crossing a threshold once unlocks it forever,
// persisted separately from the stats themselves so a later stat reset
// (there isn't one today, but defensively) wouldn't silently re-lock an
// already-earned trophy.
const TROPHY_STORAGE_KEY = 'mm_trophies';
const TROPHY_DEFS = [
  { id: 'heart10', label: '💗 Fond', desc: '10 lifetime hearts', check: () => statsLifetimeHearts >= 10 },
  { id: 'heart50', label: '💗 Devoted', desc: '50 lifetime hearts', check: () => statsLifetimeHearts >= 50 },
  { id: 'heart200', label: '💗 Obsessed', desc: '200 lifetime hearts', check: () => statsLifetimeHearts >= 200 },
  { id: 'jackpot10', label: '🎰 Lucky', desc: '10 lifetime jackpots', check: () => statsLifetimeJackpots >= 10 },
  { id: 'jackpot50', label: '🎰 High Roller', desc: '50 lifetime jackpots', check: () => statsLifetimeJackpots >= 50 },
  { id: 'chain10', label: '🏃 Relentless', desc: 'Chase chain of 10', check: () => statsBestChaseChain >= 10 },
  { id: 'chain20', label: '🏃 Unstoppable', desc: 'Chase chain of 20', check: () => statsBestChaseChain >= 20 },
  { id: 'prestige1', label: '🌟 Reborn', desc: 'First Prestige', check: () => prestigeCount >= 1 },
  { id: 'prestige5', label: '🌟 Legend', desc: 'Prestige 5 times', check: () => prestigeCount >= 5 },
];
let unlockedTrophies = {};

function loadTrophies() {
  try { unlockedTrophies = JSON.parse(localStorage.getItem(TROPHY_STORAGE_KEY) || '{}'); } catch (e) { unlockedTrophies = {}; }
  updateTrophyUi();
}

function checkTrophies() {
  let changed = false;
  for (const t of TROPHY_DEFS) {
    if (!unlockedTrophies[t.id] && t.check()) {
      unlockedTrophies[t.id] = Date.now();
      changed = true;
      toast('🏆 Trophy unlocked: ' + t.label + ' (' + t.desc + ')');
    }
  }
  if (changed) {
    try { localStorage.setItem(TROPHY_STORAGE_KEY, JSON.stringify(unlockedTrophies)); } catch (e) {}
    updateTrophyUi();
  }
}

function updateTrophyUi() {
  const el = document.getElementById('trophy-case');
  if (!el) return;
  el.innerHTML = TROPHY_DEFS.map((t) => {
    const got = !!unlockedTrophies[t.id];
    return '<span class="trophy-chip' + (got ? ' earned' : '') + '" title="' + t.desc + '">' + (got ? t.label : '🔒 ???') + '</span>';
  }).join('');
}

function recordPayoffStats(streak, milestoneCount) {
  statsLifetimeJackpots++;
  if (streak > statsBestStreak) statsBestStreak = streak;
  if (milestoneCount) {
    const elapsedS = Math.round((Date.now() - sessionStartedAt) / 1000);
    const prevBest = statsBestMilestoneSeconds[milestoneCount];
    if (prevBest === undefined || elapsedS < prevBest) {
      statsBestMilestoneSeconds[milestoneCount] = elapsedS;
      toast('🏅 New best: ' + milestoneCount + 'th jackpot in ' + elapsedS + 's!');
    }
  }
  saveStats();
  updateStatsUi();
  checkTrophies();
}

function updateStatsUi() {
  const el = document.getElementById('personal-best');
  if (!el) return;
  el.innerText = 'Best streak: ' + statsBestStreak + ' · Lifetime jackpots: ' + statsLifetimeJackpots +
    ' · Hearts: ' + statsLifetimeHearts + ' · Best chain: ' + statsBestChaseChain;
}

// Daily quests: a couple of lightweight in-app checklist items, re-rolled
// once per real day, claimed automatically for XP the moment a counter
// hits its target. Entirely self-contained - nothing reminds you of these
// outside an open tab.
const QUEST_STORAGE_KEY = 'mm_quests';
const QUEST_DEFS = [
  { id: 'rate15', desc: 'Rate 15 clips', target: 15, metric: 'rates', xp: 30 },
  { id: 'rate40', desc: 'Rate 40 clips', target: 40, metric: 'rates', xp: 70 },
  { id: 'bonus3', desc: 'Catch 3 bonus windows', target: 3, metric: 'bonuses', xp: 40 },
  { id: 'jackpot2', desc: 'Land 2 jackpots', target: 2, metric: 'jackpots', xp: 50 },
  { id: 'jackpot5', desc: 'Land 5 jackpots', target: 5, metric: 'jackpots', xp: 90 },
];
let questState = { day: '', quests: [], counters: {} };

function loadQuests() {
  const today = new Date().toDateString();
  try {
    const saved = JSON.parse(localStorage.getItem(QUEST_STORAGE_KEY) || '{}');
    if (saved.day === today && Array.isArray(saved.quests)) {
      questState = saved;
      updateQuestUi();
      return;
    }
  } catch (e) {}
  const shuffled = QUEST_DEFS.slice().sort(() => Math.random() - 0.5);
  questState = {
    day: today,
    quests: shuffled.slice(0, 2).map(q => ({ id: q.id, progress: 0, claimed: false })),
    counters: { rates: 0, bonuses: 0, jackpots: 0 },
  };
  saveQuests();
  updateQuestUi();
}

function saveQuests() {
  try { localStorage.setItem(QUEST_STORAGE_KEY, JSON.stringify(questState)); } catch (e) {}
}

function incrementQuestMetric(metric, amount) {
  questState.counters[metric] = (questState.counters[metric] || 0) + (amount || 1);
  let changed = false;
  for (const entry of questState.quests) {
    if (entry.claimed) continue;
    const def = QUEST_DEFS.find(q => q.id === entry.id);
    if (!def || def.metric !== metric) continue;
    entry.progress = questState.counters[metric];
    changed = true;
    if (entry.progress >= def.target) {
      entry.claimed = true;
      awardXp(def.xp);
      toast('✅ Quest complete: ' + def.desc);
    }
  }
  if (changed) { saveQuests(); updateQuestUi(); }
}

function updateQuestUi() {
  const el = document.getElementById('quest-list');
  if (!el) return;
  el.innerHTML = questState.quests.map(entry => {
    const def = QUEST_DEFS.find(q => q.id === entry.id);
    if (!def) return '';
    const mark = entry.claimed ? '✅' : '▫️';
    return mark + ' ' + def.desc + ' (' + Math.min(entry.progress, def.target) + '/' + def.target + ')';
  }).join('<br>');
}

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
  revealTier(tier, () => {
    const willChain = decideChain(tier, chainDepth);
    applyPayoffEffects(tier, streak, milestoneCount, wasAtRisk, chainDepth, willChain);
    if (willChain) setTimeout(() => runPayoff(chainDepth + 1), 900);
  });
}

function applyPayoffEffects(tier, streak, milestoneCount, wasAtRisk, chainDepth, willChain) {
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
  if (focusModeActive >= 0) return; // Focus Mode's clean room
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
    if (!autopilotEnabled) applyVibeDial(Math.min(2, vibeDialValue + 0.5));
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

function maybeTriggerSurge() {
  if (Date.now() < surgeExpireAt) return;
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
    * (1 + autopilotAmbientBoost); // Auto-Pilot's climax phase nudges it too, see autopilotTick
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

// ---- Auto-Pilot (experimental) ----
// A scripted session arc - calm, then building, a climax, then cooldown,
// repeating - that ramps pace, barrage/jackpot odds, mosaic, and the
// floating-overlay count over time instead of those staying wherever you
// last set them. Driven entirely from this tab by re-using the existing
// per-session controls (pace(), /api/intensity, toggleMosaic/setFxCount),
// so it has no server-side component of its own.
const AUTOPILOT_TICK_MS = 4000;
// "ambient" ramps every client-only passive-spawn system added since this
// arc was first written (bonus window, chase flash, near-miss, spiral-
// from-hearts) via autopilotAmbientBoost below - previously those all sat
// at their own constant background rate no matter what phase the arc was
// in, so a "climax" only ever meant more barrages/floaters, never more of
// these. Shaped like the existing barrage/jackpot curve.
const AUTOPILOT_KEYFRAMES = [
  { t: 0.00, pace: 3, barrage: 0.01, jackpot: 0.02, mosaic: false, fx: 1, novelty: 0.10, ambient: 0.0 },
  { t: 0.35, pace: 2, barrage: 0.03, jackpot: 0.06, mosaic: false, fx: 2, novelty: 0.15, ambient: 0.2 },
  { t: 0.60, pace: 1, barrage: 0.10, jackpot: 0.18, mosaic: true, fx: 4, novelty: 0.30, ambient: 0.5 },
  { t: 0.75, pace: 0, barrage: 0.22, jackpot: 0.35, mosaic: true, fx: 6, novelty: 0.50, ambient: 0.9 },
  { t: 0.85, pace: 1, barrage: 0.08, jackpot: 0.15, mosaic: true, fx: 3, novelty: 0.30, ambient: 0.4 },
  { t: 1.00, pace: 3, barrage: 0.01, jackpot: 0.02, mosaic: false, fx: 1, novelty: 0.10, ambient: 0.0 },
];

let autopilotAmbientBoost = 0;
let autopilotEnabled = false;
let autopilotCycleMinutes = 6;
let autopilotStartTime = 0;
let autopilotTimer = null;
let autopilotLastPace = null;
let autopilotLastMosaic = null;

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
const AUTOPILOT_ZONES = {
  chase: { label: 'Chase Zone', chase: 1.9, bonus: 1.3, sealed: 0.6, colorRush: 0.5, barrage: 1.0, tileBias: 'mid' },
  color: { label: 'Color Zone', chase: 0.6, bonus: 0.8, sealed: 0.8, colorRush: 2.4, barrage: 1.0, tileBias: 'high' },
  jackpot: { label: 'Jackpot Zone', chase: 0.7, bonus: 0.9, sealed: 1.0, colorRush: 0.7, barrage: 1.6, tileBias: 'high' },
  vault: { label: 'Vault Zone', chase: 0.6, bonus: 0.7, sealed: 2.2, colorRush: 0.6, barrage: 0.9, tileBias: 'low' },
};
const AUTOPILOT_ZONE_NAMES = Object.keys(AUTOPILOT_ZONES);
let autopilotZone = null;
let autopilotLastFrac = 0;

function pickAutopilotZone(excludeName) {
  const choices = AUTOPILOT_ZONE_NAMES.filter(n => n !== excludeName);
  return choices[Math.floor(Math.random() * choices.length)];
}

// Falls back to 1 (no-op) whenever Auto-Pilot is off, so manual play is
// never affected by zone weighting at all.
function autopilotZoneMultiplier(key) {
  return autopilotZone ? AUTOPILOT_ZONES[autopilotZone][key] : 1;
}

function loadAutopilotPrefs() {
  try {
    const cyc = localStorage.getItem('mm_autopilot_minutes');
    if (cyc !== null) autopilotCycleMinutes = parseFloat(cyc);
  } catch (e) {}
  // Deliberately doesn't auto-resume "enabled" across reloads - starting an
  // open-ended ramping mode silently on page load would be surprising.
  document.getElementById('autopilot-minutes-input').value = autopilotCycleMinutes;
  document.getElementById('l-autopilot-minutes').innerText = autopilotCycleMinutes + ' min';
  document.getElementById('autopilot-toggle').innerText = 'OFF';
}

function lerp(a, b, t) { return a + (b - a) * t; }

function autopilotPhaseAt(frac) {
  const kfs = AUTOPILOT_KEYFRAMES;
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
  const cycleS = Math.max(30, autopilotCycleMinutes * 60);
  const elapsed = (Date.now() - autopilotStartTime) / 1000;
  const frac = (elapsed % cycleS) / cycleS;
  const { a, b, lf } = autopilotPhaseAt(frac);

  // A new zone whenever the cycle wraps back to its start (frac drops
  // below where it was last tick) - not on every tick, so the zone
  // holds steady for a whole cycle's calm->climax->cooldown arc rather
  // than flickering between zones mid-arc.
  if (!autopilotZone || frac < autopilotLastFrac) {
    autopilotZone = pickAutopilotZone(autopilotZone);
    maybeApplyZoneDrivenMosaic(autopilotZone);
  }
  autopilotLastFrac = frac;
  updateAutopilotZoneUi();

  const barrageP = lerp(a.barrage, b.barrage, lf) * autopilotZoneMultiplier('barrage');
  const jackpotP = lerp(a.jackpot, b.jackpot, lf) * autopilotZoneMultiplier('barrage');
  const noveltyBonus = lerp(a.novelty, b.novelty, lf);
  const fxTarget = Math.round(lerp(a.fx, b.fx, lf));
  const targetPace = lf < 0.5 ? a.pace : b.pace;
  const targetMosaic = lf < 0.5 ? a.mosaic : b.mosaic;
  autopilotAmbientBoost = lerp(a.ambient, b.ambient, lf);

  fetch('/api/intensity?barrage=' + barrageP.toFixed(3) + '&jackpot=' + jackpotP.toFixed(3));
  fetch('/api/novelty?bonus=' + noveltyBonus.toFixed(3));
  if (targetPace !== autopilotLastPace) { autopilotLastPace = targetPace; pace(targetPace, true); }
  if (targetMosaic !== autopilotLastMosaic) {
    autopilotLastMosaic = targetMosaic;
    if (mosaicEnabled !== targetMosaic) toggleMosaic();
  }
  if (fxCount !== fxTarget) setFxCount(fxTarget);
}

function updateAutopilotZoneUi() {
  const el = document.getElementById('l-autopilot-zone');
  const row = document.getElementById('autopilot-zone-row');
  if (el) el.innerText = autopilotZone ? AUTOPILOT_ZONES[autopilotZone].label : '';
  if (row) row.style.display = autopilotZone ? 'flex' : 'none';
}

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
  autopilotLastMosaic = null;
  autopilotZone = null;
  autopilotLastFrac = 0;
  if (!fxEnabled) toggleFx();
  autopilotTick();
  autopilotTimer = setInterval(autopilotTick, AUTOPILOT_TICK_MS);
}

function stopAutopilot() {
  clearInterval(autopilotTimer);
  autopilotTimer = null;
  autopilotAmbientBoost = 0;
  autopilotZone = null;
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
  document.getElementById('l-autopilot-minutes').innerText = autopilotCycleMinutes + ' min';
  try { localStorage.setItem('mm_autopilot_minutes', autopilotCycleMinutes); } catch (e) {}
}

// ---- Discovery/Favorites Vibe Dial ----
// A direct manual control over the exact same exploration_bonus the
// backend's bandit selection already uses (see pick_video/exploration_score
// server-side): low = stick close to what already scores well (familiar),
// high = give lightly-played clips a real shot even against established
// favorites (discovery). Auto-Pilot's arc already blends this
// automatically on its own curve while running (the ARC table's `novelty`
// column, sent via the same /api/novelty endpoint) - that's the
// "functions could auto-blend this" half of the idea. This dial is the
// *manual* half: your own resting preference, which Auto-Pilot temporarily
// overrides while active and hands back to on stop (see stopAutopilot).
const VIBE_DIAL_KEY = 'mm_vibe_dial';
const VIBE_DIAL_DEFAULT = 0.35; // matches config.exploration_bonus_c's shipped default
let vibeDialValue = VIBE_DIAL_DEFAULT;

function applyVibeDial(value) {
  fetch('/api/novelty?bonus=' + value.toFixed(3));
}

function setVibeDial(v) {
  vibeDialValue = parseFloat(v);
  const el = document.getElementById('l-vibe-dial');
  if (el) el.innerText = vibeDialValue < 0.5 ? 'Familiar' : (vibeDialValue > 1.3 ? 'Discovery' : 'Balanced');
  try { localStorage.setItem(VIBE_DIAL_KEY, vibeDialValue); } catch (e) {}
  if (!autopilotEnabled) applyVibeDial(vibeDialValue);
}

// Fast-Dislike "Recalibrate": several 👎 in a row reads as "nothing
// here is landing right now," not just more negative data points to
// quietly fold into the reward average - it triggers an immediate
// reroll of everything on screen plus a brief discovery push, instead
// of leaving the viewer to keep disliking the same vein of content one
// clip at a time while the slower-moving reward averages catch up.
const RECALIBRATE_THRESHOLD = 3;
const RECALIBRATE_DISCOVERY_BONUS = 1.4;
const RECALIBRATE_DISCOVERY_HOLD_MS = 20000;
let dislikeStreak = 0;

function registerDislikeForRecalibrate() {
  dislikeStreak++;
  if (dislikeStreak >= RECALIBRATE_THRESHOLD) {
    dislikeStreak = 0;
    recalibrate();
  }
}

function recalibrate() {
  toast('🔄 Recalibrating - mixing it up');
  fetch('/api/skip');
  if (!autopilotEnabled) {
    applyVibeDial(Math.max(vibeDialValue, RECALIBRATE_DISCOVERY_BONUS));
    setTimeout(() => { if (!autopilotEnabled) applyVibeDial(vibeDialValue); }, RECALIBRATE_DISCOVERY_HOLD_MS);
  }
}

function loadVibeDialPref() {
  let saved = VIBE_DIAL_DEFAULT;
  try {
    const raw = localStorage.getItem(VIBE_DIAL_KEY);
    if (raw !== null) saved = parseFloat(raw);
  } catch (e) {}
  if (!Number.isFinite(saved)) saved = VIBE_DIAL_DEFAULT;
  vibeDialValue = saved;
  const input = document.getElementById('vibe-dial-input');
  if (input) input.value = saved;
  setVibeDial(saved);
}

// ---- Session timer (opt-in, off by default) ----
// Just a quiet elapsed-time readout - no nagging, no popups. Entirely
// optional; exists so time awareness is available at a glance during an
// intense Auto-Pilot climax if you want it, without fighting the rest of
// the experience if you don't.
let sessionTimerEnabled = false;
const sessionStartMs = Date.now();

function loadSessionTimerPref() {
  try { sessionTimerEnabled = localStorage.getItem('mm_session_timer') === '1'; } catch (e) {}
  applySessionTimerUi();
}

function toggleSessionTimer() {
  sessionTimerEnabled = !sessionTimerEnabled;
  try { localStorage.setItem('mm_session_timer', sessionTimerEnabled ? '1' : '0'); } catch (e) {}
  applySessionTimerUi();
}

function applySessionTimerUi() {
  const btn = document.getElementById('session-timer-toggle');
  btn.innerText = sessionTimerEnabled ? 'ON' : 'OFF';
  btn.classList.toggle('active', sessionTimerEnabled);
  document.getElementById('session-timer-readout').style.display = sessionTimerEnabled ? 'block' : 'none';
}

function tickSessionTimer() {
  if (!sessionTimerEnabled) return;
  const elapsedS = Math.floor((Date.now() - sessionStartMs) / 1000);
  const h = Math.floor(elapsedS / 3600);
  const m = Math.floor((elapsedS % 3600) / 60);
  const s = elapsedS % 60;
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('session-timer-readout').innerText = '⏱️ ' + (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
}

function copyPhoneUrl() {
  const el = document.getElementById('phone-url');
  const text = el.innerText;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Copied: ' + text)).catch(() => toast('Copy failed', true));
  } else {
    toast('Copy failed', true);
  }
}

function togglePanel() {
  const panel = document.getElementById('panel');
  const collapsed = panel.classList.toggle('collapsed');
  document.getElementById('panel-toggle').innerText = collapsed ? '☰' : '✕';
  try { localStorage.setItem('mm_panel_collapsed', collapsed ? '1' : '0'); } catch (e) {}
}

function restorePanelState() {
  let collapsed = false;
  try { collapsed = localStorage.getItem('mm_panel_collapsed') === '1'; } catch (e) {}
  document.getElementById('panel').classList.toggle('collapsed', collapsed);
  document.getElementById('panel-toggle').innerText = collapsed ? '☰' : '✕';
}

const PANEL_TAB_NAMES = ['display', 'engagement', 'audio', 'more', 'tuning'];

function switchPanelTab(name) {
  if (!PANEL_TAB_NAMES.includes(name)) name = PANEL_TAB_NAMES[0];
  document.querySelectorAll('.panel-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === name));
  document.querySelectorAll('.panel-tab-btn').forEach(el => el.classList.toggle('active', el.dataset.tab === name));
  try { localStorage.setItem('mm_panel_tab', name); } catch (e) {}
}

function restorePanelTab() {
  let name = PANEL_TAB_NAMES[0];
  try { name = localStorage.getItem('mm_panel_tab') || name; } catch (e) {}
  switchPanelTab(name);
}

let toastHideTimer = null;

function toast(msg, neg) {
  const box = document.getElementById('toast');
  box.innerText = msg;
  box.style.borderColor = neg ? '#ff4d4d' : '#b84dff';
  box.style.display = 'block';
  // A second toast fired while an earlier one was still mid-countdown
  // (e.g. a jackpot's own toast, then Bank/Push clicked a second later)
  // left that first toast's hide timer running - it would still fire on
  // schedule and yank the SECOND toast's text away early, well short of
  // the intended 1.8s, reported as "the result text quickly disappears."
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => box.style.display = 'none', 1800);
}

function uiFlare() {
  const t = document.getElementById('theater-box');
  t.classList.add('flare');
  setTimeout(() => t.classList.remove('flare'), 400);
}

function uiGlitch() {
  const t = document.getElementById('theater-box');
  t.classList.add('glitch');
  setTimeout(() => t.classList.remove('glitch'), 600);
}

function scrambleText(element, newText) {
  if (element.getAttribute('data-val') === newText) return;
  element.setAttribute('data-val', newText);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let iters = 0;
  const interval = setInterval(() => {
    element.innerText = newText.split('').map((c, i) => (i < iters ? c : chars[Math.floor(Math.random() * chars.length)])).join('');
    if (iters >= newText.length) {
      clearInterval(interval);
      element.innerText = newText;
    }
    iters += 1 / 1.5;
  }, 25);
}

function setConnected(ok) {
  document.getElementById('conn-dot').classList.toggle('down', !ok);
  document.getElementById('conn-label').innerText = ok ? 'Connected' : 'Reconnecting…';
}

// Builds one fully-wired tile (markup + every listener a tile needs) -
// pulled out of ensureTiles so growing the grid can create just the new
// tiles instead of rebuilding every existing one from scratch.
function createTileElement(i) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML =
      '<video id="screen-' + i + '" autoplay></video>' +
      '<video id="preload-' + i + '" class="preload" preload="auto" muted></video>' +
      '<div class="tile-glow-fx"></div>' +
      '<div class="tile-ambient-fx"><span class="tap-badge">👆 TAP</span><span class="chase-badge">⚡ CATCH</span><span class="sealed-badge">🔒 OPEN</span></div>' +
      '<div class="tile-claim-fx"><span class="claim-reward-label"></span></div>' +
      '<div class="tile-overlay">' +
      '<div class="src-label" id="label-' + i + '"></div>' +
      '<div class="tile-actions">' +
      '<button class="up thumb" onclick="rateScreen(' + i + ',\'up\',this)">❤️</button>' +
      '<button class="down thumb" onclick="rateScreen(' + i + ',\'down\',this)">👎</button>' +
      '<button class="focus thumb" id="focus-btn-' + i + '" onclick="toggleFocusMode(' + i + ')">🔍</button>' +
      '</div></div>';
    const vid = tile.querySelector('#screen-' + i);
    vid.volume = tileAudioVolume; // master Tile Audio Volume slider - shared by every tile, not a per-tile solo toggle
    vid.muted = tileAudioVolume <= 0;
    vid.addEventListener('ended', () => fetch('/api/rotate?screen=' + i));
    vid.addEventListener('loadedmetadata', () => {
      onAspectKnown(i);
      applyLoopAnchorIfReady(i, currentPaths[i]); // duration is only known from here on
    });
    // Custom Loop Point's actual seek-back - a no-op whenever this tile
    // has no loop bounds set (the normal case, for any clip that's never
    // been hearted), so this doesn't change behavior for ordinary playback.
    vid.addEventListener('timeupdate', () => {
      const bounds = tileLoopBounds[i];
      if (bounds && vid.currentTime >= bounds.end) vid.currentTime = bounds.start;
    });
    // Hold-to-Heart: holding the heart button past a threshold fires one
    // amplified heart instead of waiting for a plain tap - a deliberate,
    // heavier gesture for "I really mean this one," distinct from a quick
    // tap. Fires once, right at the threshold (not on release), and marks
    // the button so the pointerup's own click doesn't also fire a normal
    // heart on top of it.
    const upBtn = tile.querySelector('.up.thumb');
    let holdTimer = null;
    let holdFiredThisPress = false;
    upBtn.addEventListener('pointerdown', () => {
      holdFiredThisPress = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        // Fire first, flag after - this call must go through normally
        // (it's the hold itself); the flag is only for the click event
        // that fires afterward once the finger/mouse actually lifts.
        rateScreen(i, 'up', upBtn, TUNING.HOLD_TO_HEART_STRENGTH);
        holdFiredThisPress = true;
        upBtn.dataset.holdFired = '1';
      }, TUNING.HOLD_TO_HEART_MS);
    });
    const cancelHold = () => {
      clearTimeout(holdTimer);
      if (holdFiredThisPress) {
        holdFiredThisPress = false;
        // The trailing click (if one comes) fires synchronously right
        // after this same pointerup, before any setTimeout callback can
        // run - so this is scoped to "shortly after release," not "a
        // fixed window after the hold fired." The previous version timed
        // the clear from the hold instead of the release, so holding past
        // ~1s before letting go meant the flag had already expired by the
        // time the real click landed - the click went through unblocked
        // and silently added a second, separate heart on release.
        setTimeout(() => { upBtn.dataset.holdFired = ''; }, 300);
      }
    };
    upBtn.addEventListener('pointerup', cancelHold);
    upBtn.addEventListener('pointerleave', cancelHold);
    upBtn.addEventListener('pointercancel', cancelHold);
    const ambientEl = tile.querySelector('.tile-ambient-fx');
    ambientEl.addEventListener('click', () => {
      markInteraction();
      if (i === bonusWindowTileIndex) claimBonusTile(i);
      else if (i === chaseFlashTileIndex) catchChaseFlash(i);
      else if (i === sealedTileIndex) openSealedTile(i);
      else if (i === dueAuraTileIndex) dismissDueAura(i);
      else if (i === lastChaseMissIdx && Date.now() - lastChaseMissAt < CHASE_NEAR_MISS_GRACE_MS) {
        lastChaseMissIdx = -1;
        toast('😤 So close! Missed it by a hair', true);
        showClaimRewardLabel(i, '😤 So close!');
      }
    });
    return tile;
}

// Incremental: when the tile count changes, keep every tile whose index
// still exists exactly as it is (same <video> element, same playback
// position, same listeners) - only the *delta* is actually created or
// torn down. The previous version discarded and rebuilt every tile on
// any count change, which meant growing from say 4 tiles to 6 restarted
// all 4 already-playing tiles from scratch along with the 2 genuinely
// new ones. applyLayoutMode()'s later clear-and-reappend of the grid
// container only reorders these same element references - detaching and
// reattaching an existing <video> node doesn't reset or interrupt its
// playback, only discarding and recreating the element itself does.
function ensureTiles(count) {
  if (currentTileCount === count) return false;
  const oldCount = currentTileCount;
  currentTileCount = count;

  if (count > oldCount) {
    const grow = count - oldCount;
    currentPaths = currentPaths.concat(new Array(grow).fill(''));
    aspectRatios = aspectRatios.concat(new Array(grow).fill(DEFAULT_ASPECT));
    tileSpeedBurstUntil = tileSpeedBurstUntil.concat(new Array(grow).fill(0));
    aspectKnown = aspectKnown.concat(new Array(grow).fill(false));
    tileLoopBounds = tileLoopBounds.concat(new Array(grow).fill(null));
    lastFilterStr = lastFilterStr.concat(new Array(grow).fill(''));
    for (let i = oldCount; i < count; i++) {
      const tile = createTileElement(i);
      tileElements.push(tile);
      tileGlowEls.push(tile.querySelector('.tile-glow-fx'));
      tileAmbientEls.push(tile.querySelector('.tile-ambient-fx'));
      tileClaimEls.push(tile.querySelector('.tile-claim-fx'));
    }
  } else {
    // Shrinking: drop the tiles beyond the new count and clear any
    // ambient/mechanic state that was pointing at one of them - the
    // index itself is about to stop existing, not just change content.
    for (let i = count; i < oldCount; i++) {
      if (tileElements[i] && tileElements[i].parentNode) tileElements[i].parentNode.removeChild(tileElements[i]);
    }
    tileElements.length = count;
    tileGlowEls.length = count;
    tileAmbientEls.length = count;
    tileClaimEls.length = count;
    currentPaths.length = count;
    aspectRatios.length = count;
    tileSpeedBurstUntil.length = count;
    aspectKnown.length = count;
    tileLoopBounds.length = count;
    lastFilterStr.length = count;
    if (bonusWindowTileIndex >= count) { clearTimeout(bonusWindowTimer); bonusWindowTileIndex = -1; }
    if (sealedTileIndex >= count) { clearTimeout(sealedTimer); sealedTileIndex = -1; }
    if (chaseFlashTileIndex >= count) { clearTimeout(chaseFlashTimer); chaseFlashTileIndex = -1; chaseChain = 0; }
    if (lastChaseMissIdx >= count) lastChaseMissIdx = -1;
    if (dueAuraTileIndex >= count) dueAuraTileIndex = -1;
    if (mysteryTileIndex >= count) mysteryTileIndex = -1;
    if (focusModeActive >= count) { anticipationFxEnabled = focusModeSavedAnticipation; focusModeActive = -1; }
  }
  return true;
}

function applyRandomStart(vid) {
  const onMeta = () => {
    vid.removeEventListener('loadedmetadata', onMeta);
    if (isFinite(vid.duration) && vid.duration > 0) {
      vid.currentTime = Math.random() * RANDOM_START_MAX_FRACTION * vid.duration;
    }
    vid.play().catch(() => {});
  };
  vid.addEventListener('loadedmetadata', onMeta);
}

function render(d) {
  if (!d.screens || !d.screens.length) return;
  const tilesRebuilt = ensureTiles(d.screens.length);
  const columnsChanged = d.columns !== currentColumns;
  currentLayout = d.layout;
  currentColumns = d.columns;
  if (tilesRebuilt || columnsChanged) applyLayoutMode();

  scrambleText(document.getElementById('t-audio'), d.audio_name);
  document.getElementById('t-lock').innerText = d.lock_label;
  document.getElementById('jackpot-tag').style.display = d.jackpot ? 'inline-block' : 'none';
  document.getElementById('t-barrage').innerText = d.barrage > 0 ? '⚠️ BARRAGE MODE ACTIVE: ' + d.barrage : '';
  document.getElementById('audio-offline').classList.toggle('show', !d.audio_available);
  document.getElementById('audio-unlock').classList.toggle('show', !audioUnlocked);

  updateSynthParams(d.synth);
  if (d.audio_path && d.audio_path !== currentAudioPath) {
    currentAudioPath = d.audio_path;
    overlayEl.src = '/audio/' + d.audio_path;
    if (audioUnlocked) overlayEl.play().catch(() => {});
  }

  preloadEnabled = d.preload_enabled;
  const preloadToggle = document.getElementById('preload-toggle');
  preloadToggle.innerText = preloadEnabled ? 'ON' : 'OFF';
  preloadToggle.classList.toggle('active', preloadEnabled);

  if (d.barrage > 0) uiGlitch();
  handleAnticipationStatus(d);

  const persistentBadges = new Set([
    'preload-toggle', 'mosaic-toggle', 'fx-toggle', 'fx-source-dedicated', 'fx-source-library', 'fx-source-both',
    'anticipation-toggle', 'near-miss-toggle', 'autopilot-toggle', 'session-timer-toggle',
  ]);
  document.querySelectorAll('.badge').forEach(b => { if (!persistentBadges.has(b.id)) b.classList.remove('active'); });
  const activeFolder = document.getElementById('folder-' + d.folder);
  if (activeFolder) activeFolder.classList.add('active');
  const activeLayout = document.getElementById('layout-' + d.layout);
  if (activeLayout) activeLayout.classList.add('active');

  d.screens.forEach((s, i) => {
    const vid = document.getElementById('screen-' + i);
    if (!vid) return;
    if (s.path && s.path !== currentPaths[i]) {
      currentPaths[i] = s.path;
      tileLoopBounds[i] = null; // the old tile's bounds don't apply to whatever's loading now
      const oldTile = tileElements[i];
      if (oldTile) oldTile.classList.remove('tile-featured'); // ditto for Featured Tile's highlight
      fetchVideoMetaFor(i, s.path);
      // Tells the server how many tiles are active, so dense layouts
      // (4x4/5x5) get a cached low-res proxy instead of the full-size
      // source - matches PRELOAD_MAX_TILES: same grids that skip preload
      // also get the lighter file.
      vid.src = mediaOrigin(i) + '/media/' + s.path + '?tiles=' + d.screens.length;
      applyRandomStart(vid);
    }
    const label = document.getElementById('label-' + i);
    if (label) label.innerText = s.name || '';

    // Preload doubles the number of simultaneous <video> elements (one
    // playing + one buffering per tile), and decode/network load scales
    // with that total count, not just connection slots. On big grids
    // (4x4/5x5) that doubling is the difference between comfortably
    // within the machine's decode budget and well past it, so skip the
    // dedicated preload buffer there - rotations may hitch slightly
    // instead of being seamless, trading that for everything actually
    // staying playable.
    if (preloadEnabled && s.next_path && currentTileCount <= PRELOAD_MAX_TILES) {
      const pre = document.getElementById('preload-' + i);
      // Shift the preload's shard off the main video's so a tile's own two
      // requests (current + preloading-next) don't compete for the same
      // origin's connection budget either.
      const nextUrl = mediaOrigin(i + 3) + '/media/' + s.next_path;
      if (pre && pre.getAttribute('src') !== nextUrl) pre.src = nextUrl;
    }

    // A bonus-claim speed burst (see burstTileSpeed) temporarily owns this
    // tile's rate - skip the server-driven sync for its duration instead
    // of stomping it the very next poll (every ~0.3s).
    if (!tileSpeedBurstUntil[i] || Date.now() >= tileSpeedBurstUntil[i]) {
      // Lock already signals "stay on this one longer" - slowing it down
      // too leans into that same intent instead of just holding it fixed
      // at normal speed. Composes with the player's own manual speed
      // slider rather than overriding it.
      const lockMult = d.locked ? TUNING.LOCK_SLOWDOWN_MULT : 1;
      vid.playbackRate = s.speed * lockMult * manualSpeedMult;
    }
    const sat = Math.floor((s.tension - 1.0) * 60 + 100);
    const cont = Math.floor((s.tension - 1.0) * 40 + 100);
    const filterStr = `saturate(${sat}%) contrast(${cont}%)`;
    // The status stream pushes several times a second; tension often comes
    // back unchanged between polls, so skip the write (and the repaint it'd
    // force on a <video>) unless the computed filter actually moved.
    if (filterStr !== lastFilterStr[i]) {
      lastFilterStr[i] = filterStr;
      vid.style.filter = filterStr;
    }
  });
}

function connectStream() {
  const source = new EventSource('/api/stream');
  source.onmessage = (evt) => { setConnected(true); render(JSON.parse(evt.data)); };
  source.onerror = () => setConnected(false);
  return source;
}

function skip() { fetch('/api/skip').then(() => toast('⬇️ Skipped All', true)); }
function lock() { fetch('/api/lock').then(() => toast('60s Locked')); }
function cycleTone() { fetch('/api/cycle_tone'); }
function cat(f) { fetch('/api/folder?folder=' + encodeURIComponent(f)).then(() => toast('Category: ' + f.toUpperCase())); }
// Dip-to-dim: bridges a visual rearrangement (layout/tile-count change,
// or Focus Mode's own takeover below) with a brief fade to black instead
// of cutting straight to the new arrangement - see the CSS comment on
// #layout-fade-overlay for why a full dim rather than an animated reflow.
// `changeFn` runs right at the bottom of the dip, `atDip` (for a caller
// that itself does something async, e.g. an API call) defaults to firing
// `changeFn` inline - not perfectly synced to the moment new content
// actually appears, just a fixed, tunable dip-and-return.
function fadeTransition(changeFn) {
  const overlay = document.getElementById('layout-fade-overlay');
  if (!overlay || TUNING.LAYOUT_FADE_MS <= 0) { changeFn(); return; }
  overlay.style.transition = 'opacity ' + (TUNING.LAYOUT_FADE_MS / 1000) + 's ease';
  overlay.style.opacity = '1';
  setTimeout(() => {
    changeFn();
    setTimeout(() => { overlay.style.opacity = '0'; }, TUNING.LAYOUT_FADE_HOLD_MS);
  }, TUNING.LAYOUT_FADE_MS);
}

function setLayout(mode, quiet) {
  fadeTransition(() => {
    fetch('/api/layout?mode=' + mode).then(() => { if (!quiet) toast('Layout: ' + mode.toUpperCase()); });
  });
}
function togglePreload() {
  const next = !preloadEnabled;
  fetch('/api/preload?enabled=' + next).then(() => toast('Preload: ' + (next ? 'ON' : 'OFF')));
}
// Pace-as-Reward: deliberately dialing in your own pace is itself worth
// a small reward, not just a background control with no feedback of its
// own. Gated to real manual changes only - `quiet` is what Auto-Pilot's
// own arc passes when it drives pace automatically (see autopilotTick),
// and a flat per-change cooldown stops the reward being farmable by just
// dragging the slider back and forth rapidly.
let paceRewardReadyAt = 0;

function pace(v, quiet) {
  const labels = ['10s Hard Switching', '5s - 30s (Rapid)', '30s - 120s (Balanced)', 'Full Video (Continuous)'];
  document.getElementById('l-pace').innerText = labels[v];
  document.getElementById('pace-input').value = v;
  fetch('/api/pace?mode=' + v).then(() => { if (!quiet) toast('Pace updated'); });
  if (!quiet) {
    markInteraction();
    const now = Date.now();
    if (now >= paceRewardReadyAt) {
      paceRewardReadyAt = now + TUNING.PACE_REWARD_COOLDOWN_MS;
      awardXp(TUNING.PACE_REWARD_XP);
    }
  }
}
function vec(k, v) { fetch('/api/vector?key=' + k + '&val=' + v); }
function rateScreen(i, dir, btn, strength) {
  // Hold-to-Heart already fired an amplified heart for this same press -
  // the subsequent click (pointerup naturally fires one) would otherwise
  // double-count it as a second, separate heart.
  if (dir === 'up' && btn && btn.dataset.holdFired === '1') {
    btn.dataset.holdFired = '';
    return;
  }
  strength = strength || 1;
  markInteraction();
  if (dir === 'up') {
    claimBonusTile(i);
    bumpHeartMultiplier();
    statsLifetimeHearts += strength;
    saveStats();
    updateStatsUi();
    checkTrophies();
    // A little bonus XP and an occasional speed kick right on the
    // hearted tile, both scaling with the multiplier - "more hearts...
    // more chance of rewards" landing on the heart itself, not just the
    // odds of other systems elsewhere.
    if (heartMultiplier > 1) awardXp(Math.round(heartMultiplier));
    if (Math.random() < 0.10 + heartMultiplier * 0.07) {
      burstTileSpeed(i, 1500, 1.05 + heartMultiplier * 0.02, 1.15 + heartMultiplier * 0.03);
    }
    dislikeStreak = 0;
  } else {
    registerDislikeForRecalibrate();
  }
  const mult = registerCombo();
  awardXp(Math.round(TUNING.RATE_XP_BASE * mult * strength));
  incrementQuestMetric('rates', 1);
  tileLastRatedAt[i] = Date.now();
  pulseTileGlow(i, mult, dir !== 'up');
  if (btn) {
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }
  const strengthParam = dir === 'up' && strength > 1 ? '&strength=' + strength : '';
  // Custom Loop Point needs WHERE in the clip this heart landed, not just
  // that it happened - the server tracks it separately from the wall-clock
  // first/last_heart_at timestamps above (see loop_anchor_min/max in db.py).
  const vidEl = tileElements[i] && tileElements[i].querySelector('#screen-' + i);
  const posParam = dir === 'up' && vidEl && isFinite(vidEl.currentTime) ? '&pos=' + vidEl.currentTime.toFixed(2) : '';
  fetch('/api/rate?screen=' + i + '&dir=' + dir + strengthParam + posParam)
    .then((r) => r.json())
    .then((data) => {
      toast(dir === 'up' ? (strength > 1 ? '💞 Deep Heart!' : '❤️ Reinforced') : '👎 Penalized', dir !== 'up');
      if (data && data.heart && data.heart.heart_count >= 2) {
        showClaimRewardLabel(i, (strength > 1 ? '💞 Deep Heart x' : '💗 Heart Streak x') + data.heart.heart_count);
        pulseWarmGlow(i, data.heart.heart_count);
      }
      if (data && data.heart && vidEl) {
        const path = currentPaths[i];
        if (data.loop_anchor) loopAnchorCache[path] = data.loop_anchor;
        // This heart may have just pushed the clip's heart_count past
        // FEATURED_HEART_THRESHOLD - keep the cache in sync so Featured
        // Tile's highlight can pick that up right away instead of only
        // on the clip's next load.
        videoMetaCache[path] = Object.assign({}, videoMetaCache[path], { heart_count: data.heart.heart_count });
        applyLoopAnchorIfReady(i, path);
        applyFeaturedIfReady(i, path);
      }
    })
    .catch(() => {});
}

// A quick border-glow flash on the tile that was just rated, scaling
// with the current combo multiplier - ties the interaction itself
// directly to the same "lit boundary" visual language the jackpot/
// barrage system uses, instead of feedback living only in the XP
// counter. Opacity only, same compositor-only technique as the rest of
// the glow system.
// Tile Audio: each tile's own <video> carries its real audio (separate
// from the ambient overlay track/binaural synth). Replaced the earlier
// per-tile solo toggle with one master volume shared by every tile -
// at 0 every tile stays muted (the original default), above 0 every
// tile plays at the same level together rather than only ever one at a
// time. volume/muted are plain properties on each <video> element and
// survive that element's src changing to a new clip, so this only needs
// applying once per tile creation, not on every rotation.
let tileAudioVolume = 0;

function setTileAudioVolume(v) {
  tileAudioVolume = Math.max(0, Math.min(100, parseFloat(v))) / 100;
  const el = document.getElementById('l-tile-audio-vol');
  if (el) el.innerText = Math.round(tileAudioVolume * 100) + '%';
  tileElements.forEach((tile, i) => {
    const vid = tile.querySelector('#screen-' + i);
    if (vid) { vid.volume = tileAudioVolume; vid.muted = tileAudioVolume <= 0; }
  });
  try { localStorage.setItem('mm_tile_audio_vol', tileAudioVolume); } catch (e) {}
}

function loadTileAudioVolumePref() {
  let saved = 0;
  try {
    const raw = localStorage.getItem('mm_tile_audio_vol');
    if (raw !== null) saved = parseFloat(raw);
  } catch (e) {}
  if (!Number.isFinite(saved)) saved = 0;
  tileAudioVolume = saved;
  const input = document.getElementById('tile-audio-vol-input');
  if (input) input.value = Math.round(saved * 100);
  const el = document.getElementById('l-tile-audio-vol');
  if (el) el.innerText = Math.round(saved * 100) + '%';
}

// Focus Mode: a deliberate, manual "clean room" for one tile - takes it
// full-screen and strips every flashy overlay mechanic (jackpot build-up,
// chase/bonus/sealed windows, spiral, Color Rush, mystery tile...) by
// temporarily forcing anticipationFxEnabled off, the one flag nearly all
// of them already gate on. The rest of the grid stays visible but dimmed
// and un-interactive, rather than hidden outright, so the pull of the
// grid doesn't vanish entirely - it just steps back. The focused screen's
// own rotation is frozen server-side (/api/focus) so it can't get yanked
// away mid-focus by its normal expiry timer; the rest of the grid keeps
// rotating normally underneath.
let focusModeActive = -1;
let focusModeSavedAnticipation = true;

function toggleFocusMode(i) {
  markInteraction();
  if (focusModeActive === i) {
    exitFocusMode(i);
  } else {
    if (focusModeActive >= 0) exitFocusMode(focusModeActive);
    enterFocusMode(i);
  }
}

function enterFocusMode(i) {
  fadeTransition(() => {
    const tile = tileElements[i];
    if (!tile) return;
    focusModeActive = i;
    focusModeSavedAnticipation = anticipationFxEnabled;
    anticipationFxEnabled = false;
    tile.classList.add('focus-active');
    tileElements.forEach((t, idx) => { if (idx !== i) t.classList.add('dimmed-by-focus'); });
    const btn = document.getElementById('focus-btn-' + i);
    if (btn) btn.innerText = '✕';
    fetch('/api/focus?screen=' + i + '&on=true');
    toast('🔍 Focus Mode');
  });
}

function exitFocusMode(i) {
  fadeTransition(() => {
    const tile = tileElements[i];
    if (tile) tile.classList.remove('focus-active');
    tileElements.forEach((t) => t.classList.remove('dimmed-by-focus'));
    anticipationFxEnabled = focusModeSavedAnticipation;
    focusModeActive = -1;
    const btn = document.getElementById('focus-btn-' + i);
    if (btn) btn.innerText = '🔍';
    fetch('/api/focus?screen=' + i + '&on=false');
  });
}

function pulseTileGlow(idx, multiplier, negative) {
  const el = tileGlowEls[idx];
  if (!el) return;
  el.style.transition = 'opacity .12s ease-out';
  if (negative) el.style.borderColor = 'rgba(255,90,90,.95)';
  el.style.opacity = Math.min(1, 0.45 + (multiplier - 1) * 0.35).toFixed(2);
  const holdMs = 140 + (multiplier - 1) * 70;
  setTimeout(() => {
    el.style.transition = 'opacity .5s ease-out';
    el.style.opacity = '0';
    setTimeout(() => {
      el.style.transition = '';
      if (negative) el.style.borderColor = '';
    }, 500);
  }, holdMs);
}

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
  if (bonusWindowTileIndex >= 0 || !tileElements.length) return;
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
  burstTileSpeed(idx, BONUS_CLAIM_CELEBRATION_MS, 1.20, 1.95); // trimmed 5pts off both ends (was 1.25-2.0)
  bumpJackpotHeat(0.5); // a smaller, flat nudge than a chase catch's - see bumpJackpotHeat
  triggerMiniPayoff(idx);
}

// Random speed-up on the claimed tile, synced with the claim's visual
// celebration - a little extra kinetic payoff for the hit itself, not
// just a border glow. See the tileSpeedBurstUntil guard in render() -
// without it, the next status poll (every ~0.3s) would immediately
// overwrite this with the server-driven speed again.
function burstTileSpeed(idx, durationMs, minMult, maxMult) {
  const vid = tileElements[idx] && tileElements[idx].querySelector('#screen-' + idx);
  if (!vid) return;
  minMult = minMult == null ? 1.25 : minMult;
  maxMult = maxMult == null ? 2.0 : maxMult;
  vid.playbackRate = minMult + Math.random() * (maxMult - minMult);
  tileSpeedBurstUntil[idx] = Date.now() + durationMs;
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
  if (sealedTileIndex >= 0 || !tileElements.length) return;
  if (Date.now() - lastAmbientSpawnAt < TUNING.AMBIENT_SPAWN_SEPARATION_MS) return;
  if (Math.random() < TUNING.SEALED_PROBABILITY * oddsMultiplier() * autopilotZoneMultiplier('sealed')) {
    lastAmbientSpawnAt = Date.now();
    activateSealedTile(pickAmbientTarget());
  }
}

function activateSealedTile(idx) {
  sealedTileIndex = idx;
  sealedExpireAt = Date.now() + TUNING.SEALED_DURATION_MS;
  const el = tileAmbientEls[idx];
  if (el) el.classList.add('sealed-tile');
  // Looks actually locked, not just bordered: a dim overlay on the tile
  // itself (same opacity-only technique as the mega-barrage dim, but its
  // own class so the two never fight over who gets to clear it) plus a
  // genuine 25% slowdown - burstTileSpeed doubles as a slow-down here
  // since min/max are both 0.75.
  const tile = tileElements[idx];
  if (tile) tile.classList.add('tile-sealed-dim');
  burstTileSpeed(idx, TUNING.SEALED_DURATION_MS, 0.75, 0.75);
  clearTimeout(sealedTimer);
  sealedTimer = setTimeout(() => missSealedTile(idx), TUNING.SEALED_DURATION_MS);
}

function missSealedTile(idx) {
  if (idx !== sealedTileIndex) return;
  const el = tileAmbientEls[idx];
  if (el) el.classList.remove('sealed-tile');
  const tile = tileElements[idx];
  if (tile) tile.classList.remove('tile-sealed-dim');
  sealedTileIndex = -1;
}

// The actual roll: each outcome names its own odds, xp, speed range (or
// null) and heat bump (or 0) so the table itself is the whole design -
// no separate branches to keep in sync with it.
const SEALED_OUTCOMES = [
  { chance: 0.10, label: '📦 Empty...', xp: 0, speed: null, heat: 0, negative: true },
  { chance: 0.35, label: null, xp: [10, 20], speed: null, heat: 0 },
  { chance: 0.30, label: null, xp: [25, 40], speed: [1.10, 1.25], heat: 0.3 },
  { chance: 0.20, label: null, xp: [15, 25], speed: [1.20, 1.45], heat: 0.8 },
  { chance: 0.05, label: '🎰 Jackpot inside!', xp: [50, 80], speed: [1.30, 1.60], heat: 1.6 },
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
  const tile = tileElements[idx];
  if (tile) tile.classList.remove('tile-sealed-dim');
  // Clears the 0.75x lock-slowdown's burst window outright rather than
  // waiting for it to expire on its own schedule - opening early (before
  // the full seal duration) with an outcome that has no speed component
  // of its own would otherwise leave the video looking stuck at 75%
  // speed with no sealed badge left to explain why.
  tileSpeedBurstUntil[idx] = 0;
  clearTimeout(sealedTimer);
  sealedTileIndex = -1;

  const outcome = rollSealedOutcome();
  const mult = outcome.negative ? 1 : hiddenMultiplierFactor(); // nothing to double on an empty pull
  // Combo Chain Mechanics - see catchChaseFlash. An empty pull doesn't
  // feed the chain; only an actual payoff should keep it alive.
  const chainMult = outcome.negative ? 1 : registerCombo();
  const xpAmount = (Array.isArray(outcome.xp) ? Math.round(outcome.xp[0] + Math.random() * (outcome.xp[1] - outcome.xp[0])) : outcome.xp) * mult * chainMult;
  const claimEl = tileClaimEls[idx];
  if (claimEl) {
    claimEl.classList.add('sealed-opened');
    setTimeout(() => claimEl.classList.remove('sealed-opened'), 1200);
  }
  if (xpAmount > 0) awardXp(xpAmount);
  if (outcome.speed) burstTileSpeed(idx, 1800, outcome.speed[0], outcome.speed[1]);
  if (outcome.heat > 0) bumpJackpotHeat(outcome.heat);
  playChimeSound(outcome.negative ? 0.4 : 0.7 + outcome.heat * 0.2);
  incrementQuestMetric('bonuses', 1);
  const tag = mult > 1 ? ' (hidden x' + mult + '!)' : '';
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
  if (chaseFlashTileIndex >= 0 || !tileElements.length) return;
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
  if (el) el.classList.add('chase-flash');
  clearTimeout(chaseFlashTimer);
  chaseFlashTimer = setTimeout(() => missChaseFlash(idx), durationMs);
}

function clearChaseFlashVisual(idx) {
  const el = tileAmbientEls[idx];
  if (el) el.classList.remove('chase-flash');
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
  const chainSpeedExtra = chainForSpeed * (0.05 + Math.random() * 0.05);
  burstTileSpeed(idx, CHASE_CAUGHT_CELEBRATION_MS * pulses, 1.05 + chainSpeedExtra, 1.15 + chainSpeedExtra);
  const catchMult = hiddenMultiplierFactor();
  // Combo Chain Mechanics: a catch here feeds the same shared combo meter
  // rating-in-succession builds (registerCombo/comboMultiplier), so bursts
  // of activity across different mechanics - not just rapid-fire rating -
  // ramp the one multiplier together instead of each tracking its own
  // isolated streak.
  const chainMult = registerCombo();
  awardXp((TUNING.CHASE_XP_BASE + chaseChain * TUNING.CHASE_XP_PER_CATCH) * catchMult * chainMult);
  incrementQuestMetric('bonuses', 1);
  bumpJackpotHeat(chaseChain * 0.4); // longer chains nudge the odds toward bigger jackpots - see bumpJackpotHeat
  const chainTag = catchMult > 1 ? ' (hidden x' + catchMult + '!)' : '';
  toast('🏃 Caught! Chain x' + chaseChain + chainTag);
  // The corner toast is easy to miss on a denser grid - right on the
  // tile that was actually caught is where attention already is.
  showClaimRewardLabel(idx, 'Chain x' + chaseChain + chainTag);
  if (Math.random() < 0.25) fireColorSplashPiece('tiles', idx); // small, occasional flourish - see Color Rush section
  setTimeout(() => {
    if (!tileElements.length) { chaseChain = 0; return; }
    activateChaseFlash(pickAmbientTarget(idx));
  }, TUNING.CHASE_HOP_DELAY_MS);
}

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
    const pick = items[Math.floor(Math.random() * items.length)];
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
const HEART_SPIRAL_CHECK_MS = 20000;

function maybeTriggerSpiralFromHearts() {
  if (heartMultiplier <= 0 || spiralActive) return;
  if (Math.random() < 0.04 * heartMultiplier * (1 + autopilotAmbientBoost)) maybeTriggerSpiralOverlay();
}
setInterval(maybeTriggerSpiralFromHearts, HEART_SPIRAL_CHECK_MS);

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
const COLOR_RUSH_DURATION_MS = 12000;
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
  fireDiscoRain(COLOR_RUSH_DURATION_MS);
  fireDiscoBorder(COLOR_RUSH_DURATION_MS);
  fireScreenBeat(COLOR_RUSH_DURATION_MS);
  fireDiscoTilePulse(COLOR_RUSH_DURATION_MS);
  burstConfetti(50);
  const midBurst = setTimeout(() => burstConfetti(30), COLOR_RUSH_DURATION_MS / 2);
  setTimeout(() => {
    clearTimeout(midBurst);
    colorRushActive = false;
  }, COLOR_RUSH_DURATION_MS + 1000); // +1000 covers disco-rain's own fade-out tail above
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
function fireColorSplashPiece(pieceOverride, tileIdx) {
  if (colorRushActive || !tileElements.length) return;
  const piece = pieceOverride || COLOR_SPLASH_PIECES[Math.floor(Math.random() * COLOR_SPLASH_PIECES.length)];
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
  if (mysteryTileIndex >= 0 || !tileElements.length) return;
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
      data.screens.forEach((idx) => showClaimRewardLabel(idx, '🎬 Double Feature'));
    })
    .catch(() => {});
}
startTunableInterval('DOUBLE_FEATURE_CHECK_MS', maybeTriggerDoubleFeature);

// Ambient color-breathe: purely decorative, no mechanic behind it at
// all - just a slow multi-color pulse on a random tile every so often,
// to keep an idle grid feeling a little alive even between real events.
const AMBIENT_PULSE_CHECK_MS = 25000;
const AMBIENT_PULSE_PROBABILITY = 0.3;
const AMBIENT_PULSE_DURATION_MS = 12000;

function maybeTriggerAmbientPulse() {
  if (focusModeActive >= 0) return; // Focus Mode's clean room
  if (anticipationActive || !tileGlowEls.length) return;
  if (Math.random() >= AMBIENT_PULSE_PROBABILITY) return;
  const idx = Math.floor(Math.random() * tileGlowEls.length);
  const el = tileGlowEls[idx];
  if (!el) return;
  el.classList.remove('ambient-breath');
  void el.offsetWidth; // restart the animation cleanly if one was already mid-cycle
  el.classList.add('ambient-breath');
  setTimeout(() => el.classList.remove('ambient-breath'), AMBIENT_PULSE_DURATION_MS);
}

function clearMysteryTile(idx, trueMysteryReveal) {
  const tile = tileElements[idx];
  if (tile) {
    tile.classList.remove('mystery-tile');
    tile.classList.add('mystery-reveal');
    setTimeout(() => tile.classList.remove('mystery-reveal'), 300);
    if (trueMysteryReveal) {
      toast('✨ Never seen before!');
      showClaimRewardLabel(idx, '✨ New Discovery');
    }
  }
  if (mysteryTileIndex === idx) mysteryTileIndex = -1;
}

function triggerMiniPayoff(idx) {
  playChimeSound(0.7);
  burstExtraFloaters(0.5);
  const mult = hiddenMultiplierFactor();
  const chainMult = registerCombo(); // Combo Chain Mechanics - see catchChaseFlash
  const xp = TUNING.XP_PER_BONUS_CLAIM * mult * chainMult;
  const tag = mult > 1 ? ' (hidden x' + mult + '!)' : '';
  awardXp(xp);
  incrementQuestMetric('bonuses', 1);
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

const SPIN_ROLL_DELAY_MS = 900; // was 500 - needs enough room for the reel below to actually read as cycling
const SPIN_REEL_TICK_MS = 110;
// Words alongside the icons, not just the icons alone - names each
// actual possible landing state so the cycling reads as "here's what
// you could get" instead of an ambiguous string of emoji.
const SPIN_REEL_SYMBOLS = ['🎰 JACKPOT', '😤 SO CLOSE', '✨ BONUS', '🎉 XP', '💨 NOTHING'];

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

  // A brief "rolling" wobble before the outcome reveals - an instant,
  // flat result didn't read as an actual pull, just a button press. The
  // symbols cycling through are cosmetic only (the real roll is already
  // fixed below) but let you feel the possible outcomes going by, like
  // an actual reel, instead of a cloak-and-dagger wait for one number.
  const btn = document.getElementById('spin-btn');
  let reelTimer = null;
  if (btn) {
    btn.disabled = true;
    btn.classList.remove('spin-ready');
    btn.classList.add('spin-rolling');
    let reelIdx = 0;
    btn.innerText = SPIN_REEL_SYMBOLS[0];
    reelTimer = setInterval(() => {
      reelIdx = (reelIdx + 1) % SPIN_REEL_SYMBOLS.length;
      btn.innerText = SPIN_REEL_SYMBOLS[reelIdx];
    }, SPIN_REEL_TICK_MS);
    // Covers the rolling window too, not just the result display after it -
    // otherwise the 1s countdown tick (updateSpinButton) could land inside
    // this gap and stomp the reel with a premature countdown before the
    // outcome even reveals.
    spinResultUntil = Date.now() + SPIN_ROLL_DELAY_MS + 2500;
  }

  const roll = Math.random();
  setTimeout(() => {
    clearInterval(reelTimer);
    if (btn) btn.classList.remove('spin-rolling');
    if (roll < 0.08 && !anticipationActive) {
      showSpinResult('🎉 JACKPOT!');
      runPayoff(); // full jackpot-tier celebration - the rare big pull
    } else if (roll < 0.12) {
      // A genuine near-miss slice right past the jackpot cutoff - nothing
      // behind it (same philosophy as the fake build-up near-misses), but
      // naming how close the roll actually was is the whole point: Spin's
      // outcome used to be totally invisible, so a near-miss here never
      // registered as "almost" anything, just as "nothing."
      showSpinResult('😤 SO CLOSE!');
      toast('😤 So close to a JACKPOT! (rolled ' + (roll * 100).toFixed(1) + '%, needed under 8%)', true);
    } else if (roll < 0.44 && tileElements.length) {
      activateBonusWindow(pickAmbientTarget());
      showSpinResult('✨ Tap the tile!');
      toast('✨ A tile just lit up - tap it!');
    } else if (roll < 0.79) {
      const amount = Math.round(8 + Math.random() * 12);
      playChimeSound(0.6);
      awardXp(amount);
      showSpinResult('🎉 +' + amount + 'xp');
      toast('🎉 +' + amount + 'xp!');
    } else {
      showSpinResult('💨 Nothing');
      toast('💨 Nothing this time...', true);
    }
  }, SPIN_ROLL_DELAY_MS);
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
  loadAnticipationPrefs();
  loadAutopilotPrefs();
  loadVibeDialPref();
  loadManualSpeedPref();
  loadDynamicMosaicPrefs();
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
  armAutoUnlock();
  fetch('/api/status').then(r => r.json()).then(render);
  connectStream();
  setTimeout(runSessionPrimer, 15000 + Math.random() * 10000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
};
