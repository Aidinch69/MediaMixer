// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// XP, levels/prestige, combos, patience, welcome-back bonus, stats, trophies and quests.

// Leveling/XP: a persistent long-horizon progress bar across sessions,
// separate from any single jackpot - the point is a number that only ever
// goes up, so coming back later always has somewhere to pick up from.
const XP_STORAGE_KEY = 'mm_xp_state';
const XP_PER_TIER = { small: 10, medium: 20, mega: 40, milestone: 60 };
let xpTotal = 0;
let xpLevel = 1;
let prestigeCount = 0;

function xpForLevel(level) {
  // Level N+1 needs BASE * N^EXPONENT cumulative XP. With the defaults
  // (2000, 1.9) level 5 is a couple of hours in and level 20 about a day.
  return Math.round(TUNING.XP_LEVEL_BASE * Math.pow(level, TUNING.XP_LEVEL_EXPONENT));
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
    const rank = prestigeCount > 0 ? '🌟P' + prestigeCount + ' · ' : '';
    const legacyTag = prestigeCount > 0 ? ' +' + Math.round((legacyBonusMultiplier() - 1) * 100) + '%xp' : '';
    el.innerText = rank + 'LV ' + xpLevel + ' · ' + xpTotal.toLocaleString() + 'xp (' + pct + '% to ' + (xpLevel + 1) + ')' + legacyTag;
  }
  const btn = document.getElementById('prestige-btn');
  if (btn) btn.style.display = xpLevel >= TUNING.PRESTIGE_LEVEL_CAP ? 'inline-block' : 'none';
  if (typeof renderPrestigeTracker === 'function') renderPrestigeTracker();
  if (typeof noteLevelReached === 'function') noteLevelReached(xpLevel);
}

// Prestige Legacy Carry-over: each star is a permanent +5% XP bonus (capped
// at 50% / 10 stars) rather than prestiging being a pure reset - "trading
// back to 0" should leave something behind that keeps paying off, not just
// a cosmetic star.

function legacyBonusMultiplier() {
  return 1 + Math.min(prestigeCount * TUNING.LEGACY_BONUS_PER_STAR, TUNING.LEGACY_BONUS_CAP);
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
  if (xpLevel < TUNING.PRESTIGE_LEVEL_CAP) return;
  prestigeCount++;
  xpTotal = 0;
  recomputeLevel();
  updateLevelUi();
  saveXpState();
  toast('🌟 Prestige ' + prestigeCount + '! +' + Math.round(TUNING.LEGACY_BONUS_PER_STAR * 100) + '% permanent XP');
  checkTrophies();
}

// Combo Chain Mechanics: any rewarding action in quick succession - rating,
// a chase catch, a bonus claim, a non-empty sealed tile - builds one shared
// short-lived multiplier (capped 3x) on XP and on near-miss/bonus-window
// odds, so a burst of activity feels electric regardless of which mechanic
// it's coming through, instead of each mechanic tracking its own isolated
// streak that never interacts with the others.
let comboCount = 0;
let comboExpireAt = 0;

function registerCombo() {
  const now = Date.now();
  comboCount = now < comboExpireAt ? comboCount + 1 : 1;
  comboExpireAt = now + TUNING.COMBO_WINDOW_MS;
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
    nudgeEngagement(0.15); // settled/absorbed is still real engagement, not idleness
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
  if (typeof renderAchievements === 'function') renderAchievements();
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

// Daily quests grew into the Challenges system (dashboard_challenges.js).
// These names stay because other files call them.
function loadQuests() {
  if (typeof loadChallenges === 'function') loadChallenges();
}

function incrementQuestMetric(metric, amount) {
  arcMetric(metric, amount || 1);
}

function updateQuestUi() {
  if (typeof renderChallenges === 'function') renderChallenges();
}
