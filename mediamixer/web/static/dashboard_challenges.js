// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Challenges and achievements: three daily and three weekly challenges
// drawn from bigger pools (play-time goals included), a bonus for
// clearing all three dailies or all three weeklies, one daily swap, and a
// long list of achievements that show what's left to earn.
//
// Counts arrive two ways: arcMetric() (dashboard_events.js) forwards every
// metric it sees (hearts, catches, jackpots, bonuses, ratings, Overdrive,
// Finales, Spotlights), and logEvent is wrapped to pick up the rest
// (spins, sealed opens, MEGA jackpots, chase chains, Moments...).
// Play time comes from the engine (/api/playtime).

const CHALLENGE_KEY = 'mm_challenges';
const DAILY_COUNT = 3;
const WEEKLY_COUNT = 3;
const DAILY_SWEEP_XP = 15000;
const PERFECT_WEEK_XP = 100000;
const DAILY_SWAPS = 1;
// Bump when the pools change: today's and this week's picks re-roll
// (progress already made still counts toward the new picks).
const CHALLENGE_VERSION = 2;

// metric -> how progress is shown; anything not here is a plain count.
const MINUTE_METRICS = new Set(['minutesToday', 'minutesWeek']);
const GAUGE_METRICS = new Set(['minutesToday', 'minutesWeek', 'daysWeek', 'chainBest']); // set to the best value, not added

// Sized from real play rates (per hour of watching, roughly): ~850 hearts,
// ~120 jackpots, ~16 MEGAs, ~110 catches, ~60 Moments, ~25 spins, ~15
// Overdrives/Spotlights/sealed opens, ~880 clips. A daily is about 1-2
// hours of play on its own; a weekly about 10-20 hours.
const DAILY_POOL = [
  { id: 'd2_hearts1000', icon: '💗', desc: 'Heart 1,000 clips', metric: 'hearts', target: 1000, xp: 6000 },
  { id: 'd2_hearts2000', icon: '💗', desc: 'Heart 2,000 clips', metric: 'hearts', target: 2000, xp: 11000 },
  { id: 'd2_rate1500', icon: '👍', desc: 'Rate 1,500 clips', metric: 'rates', target: 1500, xp: 8000 },
  { id: 'd2_jackpots150', icon: '🎰', desc: 'Land 150 jackpots', metric: 'jackpots', target: 150, xp: 7000 },
  { id: 'd2_jackpots300', icon: '🎰', desc: 'Land 300 jackpots', metric: 'jackpots', target: 300, xp: 12000 },
  { id: 'd2_mega25', icon: '💥', desc: 'Land 25 MEGA jackpots', metric: 'megas', target: 25, xp: 9000 },
  { id: 'd2_catch150', icon: '🏃', desc: 'Catch 150 chase flashes', metric: 'catches', target: 150, xp: 7000 },
  { id: 'd2_chain20', icon: '⛓️', desc: 'Hit a chase chain of 20', metric: 'chainBest', target: 20, xp: 8000 },
  { id: 'd2_bonus80', icon: '✨', desc: 'Claim 80 bonus taps', metric: 'bonuses', target: 80, xp: 7000 },
  { id: 'd2_sealed25', icon: '🔓', desc: 'Open 25 sealed tiles', metric: 'sealedOpens', target: 25, xp: 7000 },
  { id: 'd2_spin40', icon: '🎡', desc: 'Spin 40 times', metric: 'spins', target: 40, xp: 6000 },
  { id: 'd2_moments100', icon: '🎆', desc: 'See 100 Moments', metric: 'moments', target: 100, xp: 7000 },
  { id: 'd2_overdrive20', icon: '🔥', desc: 'Release Overdrive 20 times', metric: 'overdrives', target: 20, xp: 7000 },
  { id: 'd2_spot20', icon: '🔦', desc: 'See 20 Spotlight Takeovers', metric: 'spotlights', target: 20, xp: 7000 },
  { id: 'd2_fx500', icon: '🌈', desc: 'Trigger 500 tile effects', metric: 'fxSeen', target: 500, xp: 6000 },
  { id: 'd2_clips1500', icon: '🎞️', desc: 'Watch 1,500 clips', metric: 'clipsSeen', target: 1500, xp: 7000 },
  { id: 'd2_hooks150', icon: '🪝', desc: 'Catch 150 hooks', metric: 'hooks', target: 150, xp: 6000 },
  { id: 'd2_spectacle30', icon: '🌀', desc: 'See 30 Color Rushes or Floater Barrages', metric: 'spectacles', target: 30, xp: 7000 },
  { id: 'd2_time60', icon: '⏱️', desc: 'Watch for 1 hour', metric: 'minutesToday', target: 60, xp: 5000 },
  { id: 'd2_time120', icon: '⏱️', desc: 'Watch for 2 hours', metric: 'minutesToday', target: 120, xp: 9000 },
  { id: 'd2_time180', icon: '⏱️', desc: 'Watch for 3 hours', metric: 'minutesToday', target: 180, xp: 13000 },
  { id: 'd2_time300', icon: '⏱️', desc: 'Watch for 5 hours', metric: 'minutesToday', target: 300, xp: 20000, rare: true },
];

const WEEKLY_POOL = [
  { id: 'w2_time5h', icon: '⏱️', desc: 'Watch 5 hours this week', metric: 'minutesWeek', target: 300, xp: 25000, time: true },
  { id: 'w2_time10h', icon: '⏱️', desc: 'Watch 10 hours this week', metric: 'minutesWeek', target: 600, xp: 50000, time: true },
  { id: 'w2_time20h', icon: '⏱️', desc: 'Watch 20 hours this week', metric: 'minutesWeek', target: 1200, xp: 90000, time: true },
  { id: 'w2_time35h', icon: '⏱️', desc: 'Watch 35 hours this week', metric: 'minutesWeek', target: 2100, xp: 140000, time: true },
  { id: 'w2_time50h', icon: '🏁', desc: 'Watch 50 hours this week', metric: 'minutesWeek', target: 3000, xp: 200000, time: true, rare: true },
  { id: 'w2_days5', icon: '📅', desc: 'Play on 5 different days', metric: 'daysWeek', target: 5, xp: 30000 },
  { id: 'w2_days7', icon: '📅', desc: 'Play every day this week', metric: 'daysWeek', target: 7, xp: 60000 },
  { id: 'w2_hearts10k', icon: '💗', desc: 'Heart 10,000 clips', metric: 'hearts', target: 10000, xp: 60000 },
  { id: 'w2_jackpots1200', icon: '🎰', desc: 'Land 1,200 jackpots', metric: 'jackpots', target: 1200, xp: 60000 },
  { id: 'w2_mega150', icon: '💥', desc: 'Land 150 MEGA jackpots', metric: 'megas', target: 150, xp: 60000 },
  { id: 'w2_catch1200', icon: '🏃', desc: 'Catch 1,200 chase flashes', metric: 'catches', target: 1200, xp: 60000 },
  { id: 'w2_chain30', icon: '⛓️', desc: 'Hit a chase chain of 30', metric: 'chainBest', target: 30, xp: 50000 },
  { id: 'w2_overdrive150', icon: '🔥', desc: 'Release Overdrive 150 times', metric: 'overdrives', target: 150, xp: 50000 },
  { id: 'w2_finale5', icon: '🎆', desc: 'Complete 5 Finales', metric: 'finales', target: 5, xp: 40000 },
  { id: 'w2_moments700', icon: '🎆', desc: 'See 700 Moments', metric: 'moments', target: 700, xp: 50000 },
  { id: 'w2_dailies15', icon: '☀️', desc: 'Complete 15 daily challenges', metric: 'dailiesDone', target: 15, xp: 50000 },
  { id: 'w2_spins250', icon: '🎡', desc: 'Spin 250 times', metric: 'spins', target: 250, xp: 40000 },
  { id: 'w2_spot150', icon: '🔦', desc: 'See 150 Spotlight Takeovers', metric: 'spotlights', target: 150, xp: 50000 },
  { id: 'w2_sealed150', icon: '🔓', desc: 'Open 150 sealed tiles', metric: 'sealedOpens', target: 150, xp: 50000 },
];

let challenges = null;
// Play time, refreshed from the engine.
const ptStats = { today: 0, week: 0, all: 0, bestDay: 0, bestWeek: 0, daysPlayed: 0, daysWeek: 0 };

function freshTotals() {
  return { dailies: 0, weeklies: 0, sweeps: 0, perfectWeeks: 0, catches: 0, megas: 0, spins: 0, moments: 0, maxLevel: 1 };
}

function challengeDayKey() { return new Date().toDateString(); }

function pickChallenges(pool, count, mustTime) {
  const picks = [];
  const used = new Set();
  const take = (list) => {
    const options = list.filter((d) => !used.has(d.metric) && !picks.includes(d));
    if (!options.length) return;
    // Rare ones (50 hours a week) come up about a third as often.
    const weights = options.map((d) => (d.rare ? 0.35 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (r > weights[i] && i < options.length - 1) { r -= weights[i]; i++; }
    picks.push(options[i]);
    used.add(options[i].metric);
  };
  if (mustTime) take(pool.filter((d) => d.time));
  while (picks.length < count) {
    const before = picks.length;
    take(pool);
    if (picks.length === before) break;
  }
  return picks.map((d) => ({ id: d.id, done: false }));
}

function saveChallenges() { saveJsonPref(CHALLENGE_KEY, challenges); }

function loadChallenges() {
  const saved = loadJsonPref(CHALLENGE_KEY, {});
  challenges = Object.assign({ day: '', week: '', daily: [], weekly: [], dayCounts: {}, weekCounts: {}, swapsLeft: DAILY_SWAPS, swept: false, perfect: false }, saved);
  challenges.totals = Object.assign(freshTotals(), saved.totals || {});
  if (challenges.version !== CHALLENGE_VERSION) {
    challenges.version = CHALLENGE_VERSION;
    if (challenges.day === challengeDayKey()) {
      challenges.daily = pickChallenges(DAILY_POOL, DAILY_COUNT, false);
      challenges.swapsLeft = DAILY_SWAPS;
      challenges.swept = false;
    }
    if (challenges.week === weekStartKey()) {
      challenges.weekly = pickChallenges(WEEKLY_POOL, WEEKLY_COUNT, true);
      challenges.perfect = false;
    }
    saveChallenges();
  }
  rollChallengePeriods();
}

function rollChallengePeriods() {
  let changed = false;
  if (challenges.day !== challengeDayKey()) {
    challenges.day = challengeDayKey();
    challenges.daily = pickChallenges(DAILY_POOL, DAILY_COUNT, false);
    challenges.dayCounts = {};
    challenges.swapsLeft = DAILY_SWAPS;
    challenges.swept = false;
    changed = true;
  }
  if (challenges.week !== weekStartKey()) {
    challenges.week = weekStartKey();
    challenges.weekly = pickChallenges(WEEKLY_POOL, WEEKLY_COUNT, true);
    challenges.weekCounts = {};
    challenges.perfect = false;
    changed = true;
  }
  if (changed) {
    applyPlaytimeGauges();
    saveChallenges();
  }
  renderChallenges();
}

function challengeDef(id) { return DAILY_POOL.find((d) => d.id === id) || WEEKLY_POOL.find((d) => d.id === id); }

function bumpChallengeCount(counts, metric, amount) {
  counts[metric] = GAUGE_METRICS.has(metric) ? Math.max(counts[metric] || 0, amount) : (counts[metric] || 0) + amount;
}

function challengeMetric(metric, amount) {
  if (!challenges) return;
  amount = amount == null ? 1 : amount;
  bumpChallengeCount(challenges.dayCounts, metric, amount);
  bumpChallengeCount(challenges.weekCounts, metric, amount);
  if (metric in challenges.totals && !GAUGE_METRICS.has(metric)) challenges.totals[metric] += amount;
  evaluateChallenges();
}

function evaluateChallenges() {
  let changed = false;
  challenges.daily.forEach((c) => {
    const def = challengeDef(c.id);
    if (c.done || !def || (challenges.dayCounts[def.metric] || 0) < def.target) return;
    c.done = true;
    changed = true;
    challenges.totals.dailies++;
    awardXp(def.xp);
    toast('☀️ Daily challenge done: ' + def.desc + ' +' + def.xp.toLocaleString() + 'xp');
    if (typeof playChimeSound === 'function') playChimeSound(0.7, 1.1);
    bumpChallengeCount(challenges.weekCounts, 'dailiesDone', 1);
  });
  if (!challenges.swept && challenges.daily.length && challenges.daily.every((c) => c.done)) {
    challenges.swept = true;
    challenges.totals.sweeps++;
    awardXp(DAILY_SWEEP_XP);
    toast('🌞 Daily sweep! All three done +' + DAILY_SWEEP_XP.toLocaleString() + 'xp');
    if (typeof burstConfetti === 'function') burstConfetti(40);
    changed = true;
  }
  challenges.weekly.forEach((c) => {
    const def = challengeDef(c.id);
    if (c.done || !def || (challenges.weekCounts[def.metric] || 0) < def.target) return;
    c.done = true;
    changed = true;
    challenges.totals.weeklies++;
    awardXp(def.xp);
    toast('📆 Weekly challenge done: ' + def.desc + ' +' + def.xp.toLocaleString() + 'xp');
    if (typeof burstConfetti === 'function') burstConfetti(50);
  });
  if (!challenges.perfect && challenges.weekly.length && challenges.weekly.every((c) => c.done)) {
    challenges.perfect = true;
    challenges.totals.perfectWeeks++;
    awardXp(PERFECT_WEEK_XP);
    toast('🏆 Perfect week! Every weekly challenge done +' + PERFECT_WEEK_XP.toLocaleString() + 'xp');
    if (typeof burstConfetti === 'function') burstConfetti(90);
    changed = true;
  }
  if (changed) checkTrophies();
  saveChallenges();
  renderChallenges();
}

function swapDailyChallenge(i) {
  const c = challenges.daily[i];
  if (!c || c.done || challenges.swapsLeft <= 0) return;
  const inUse = new Set(challenges.daily.map((x) => challengeDef(x.id).metric));
  inUse.delete(challengeDef(c.id).metric);
  const options = DAILY_POOL.filter((d) => !inUse.has(d.metric) && d.id !== c.id);
  if (!options.length) return;
  challenges.daily[i] = { id: options[Math.floor(Math.random() * options.length)].id, done: false };
  challenges.swapsLeft--;
  evaluateChallenges();
}

// ---- Play time -> challenges and achievements ----
function applyPlaytimeGauges() {
  if (!challenges) return;
  challenges.dayCounts.minutesToday = ptStats.today;
  challenges.weekCounts.minutesWeek = ptStats.week;
  challenges.weekCounts.daysWeek = ptStats.daysWeek;
}

function refreshPlaytimeStats() {
  return fetch('/api/playtime?days=400').then((r) => r.json()).then((d) => {
    const monday = new Date(weekStartKey());
    const isoMonday = monday.getFullYear() + '-' + String(monday.getMonth() + 1).padStart(2, '0') + '-' + String(monday.getDate()).padStart(2, '0');
    const weeks = {};
    let bestDay = 0, daysWeek = 0;
    d.days.forEach((x) => {
      bestDay = Math.max(bestDay, x.minutes);
      if (x.day >= isoMonday && x.minutes >= 1) daysWeek++;
      const dt = new Date(x.day + 'T00:00:00');
      dt.setDate(dt.getDate() - (dt.getDay() + 6) % 7);
      const wk = dt.toDateString();
      weeks[wk] = (weeks[wk] || 0) + x.minutes;
    });
    Object.assign(ptStats, {
      today: d.today, week: d.week, all: d.all, bestDay,
      bestWeek: Math.max(0, ...Object.values(weeks)), daysPlayed: d.days_played, daysWeek,
    });
    applyPlaytimeGauges();
    evaluateChallenges();
    checkTrophies();
    renderAchievements();
  }).catch(() => {});
}

// ---- Achievements ----
// [label, description, value getter, target] - earned once value >= target.
// Each shows its progress while locked, so there's always something to aim at.
const hours = (h) => h * 60; // achievements count minutes
const ACHIEVEMENTS = [
  ['⏱️ First Hour', 'Watch 1 hour in all', () => ptStats.all, hours(1)],
  ['⏱️ Regular Viewer', 'Watch 10 hours in all', () => ptStats.all, hours(10)],
  ['⏱️ Dedicated', 'Watch 50 hours in all', () => ptStats.all, hours(50)],
  ['⏱️ Centurion of Time', 'Watch 100 hours in all', () => ptStats.all, hours(100)],
  ['⏱️ Lifer', 'Watch 250 hours in all', () => ptStats.all, hours(250)],
  ['⏱️ Timeless', 'Watch 500 hours in all', () => ptStats.all, hours(500)],
  ['⏱️ Eternal', 'Watch 1,000 hours in all', () => ptStats.all, hours(1000)],
  ['🌙 Long Night', 'Watch 2 hours in one day', () => ptStats.bestDay, hours(2)],
  ['🌙 All-Nighter', 'Watch 4 hours in one day', () => ptStats.bestDay, hours(4)],
  ['🌙 Lost in It', 'Watch 8 hours in one day', () => ptStats.bestDay, hours(8)],
  ['📆 Big Week', 'Watch 10 hours in one week', () => ptStats.bestWeek, hours(10)],
  ['📆 Huge Week', 'Watch 25 hours in one week', () => ptStats.bestWeek, hours(25)],
  ['🏁 Marathon Week', 'Watch 50 hours in one week', () => ptStats.bestWeek, hours(50)],
  ['📅 Week of Play', 'Play on 7 different days', () => ptStats.daysPlayed, 7],
  ['📅 Month of Play', 'Play on 30 different days', () => ptStats.daysPlayed, 30],
  ['📅 Hundred Days', 'Play on 100 different days', () => ptStats.daysPlayed, 100],
  ['📅 A Year of It', 'Play on 365 different days', () => ptStats.daysPlayed, 365],
  ['⭐ Rising', 'Reach level 5', () => challenges.totals.maxLevel, 5],
  ['⭐ Seasoned', 'Reach level 10', () => challenges.totals.maxLevel, 10],
  ['⭐ Veteran', 'Reach level 15', () => challenges.totals.maxLevel, 15],
  ['⭐ Peak', 'Reach level 20', () => challenges.totals.maxLevel, 20],
  ['🌟 Ascendant', 'Prestige 3 times', () => prestigeCount, 3],
  ['🌟 Mythic', 'Prestige 10 times', () => prestigeCount, 10],
  ['🌟 Transcendent', 'Prestige 25 times', () => prestigeCount, 25],
  ['💗 Smitten', '500 lifetime hearts', () => statsLifetimeHearts, 500],
  ['💗 Head Over Heels', '1,000 lifetime hearts', () => statsLifetimeHearts, 1000],
  ['💗 Heartstorm', '5,000 lifetime hearts', () => statsLifetimeHearts, 5000],
  ['💗 Infinite Love', '10,000 lifetime hearts', () => statsLifetimeHearts, 10000],
  ['🎰 Jackpot Junkie', '250 lifetime jackpots', () => statsLifetimeJackpots, 250],
  ['🎰 Casino Royale', '1,000 lifetime jackpots', () => statsLifetimeJackpots, 1000],
  ['💥 Mega Maker', '10 MEGA jackpots', () => challenges.totals.megas, 10],
  ['💥 Mega Machine', '50 MEGA jackpots', () => challenges.totals.megas, 50],
  ['🏃 Chaser', 'Catch 100 chase flashes', () => challenges.totals.catches, 100],
  ['🏃 Hunter', 'Catch 1,000 chase flashes', () => challenges.totals.catches, 1000],
  ['🎡 Spinner', 'Spin 100 times', () => challenges.totals.spins, 100],
  ['🎡 Wheel Master', 'Spin 500 times', () => challenges.totals.spins, 500],
  ['🎆 Momentous', 'See 100 Moments', () => challenges.totals.moments, 100],
  ['☀️ Daily Driver', 'Complete 10 daily challenges', () => challenges.totals.dailies, 10],
  ['☀️ Daily Devotion', 'Complete 50 daily challenges', () => challenges.totals.dailies, 50],
  ['☀️ Daily Legend', 'Complete 200 daily challenges', () => challenges.totals.dailies, 200],
  ['🌞 Clean Sweep', 'Clear all three dailies in a day', () => challenges.totals.sweeps, 1],
  ['🌞 Sweeper', 'Clear all three dailies on 10 days', () => challenges.totals.sweeps, 10],
  ['📆 Weekly Warrior', 'Complete 5 weekly challenges', () => challenges.totals.weeklies, 5],
  ['📆 Weekly Legend', 'Complete 25 weekly challenges', () => challenges.totals.weeklies, 25],
  ['🏆 Perfect Week', 'Finish all three weekly challenges in a week', () => challenges.totals.perfectWeeks, 1],
  ['🏆 Perfectionist', 'Have 5 perfect weeks', () => challenges.totals.perfectWeeks, 5],
];
ACHIEVEMENTS.forEach(([label, desc, value, target]) => {
  TROPHY_DEFS.push({ id: 'ach_' + desc.replace(/\W+/g, ''), label, desc, progress: () => [challenges ? value() : 0, target], check: () => !!challenges && value() >= target });
});

function noteLevelReached(level) {
  if (!challenges || level <= challenges.totals.maxLevel) return;
  challenges.totals.maxLevel = level;
  saveChallenges();
  checkTrophies();
}
// Progress for the original trophies too.
const TROPHY_PROGRESS = {
  heart10: () => [statsLifetimeHearts, 10], heart50: () => [statsLifetimeHearts, 50], heart200: () => [statsLifetimeHearts, 200],
  jackpot10: () => [statsLifetimeJackpots, 10], jackpot50: () => [statsLifetimeJackpots, 50], jackpot100: () => [statsLifetimeJackpots, 100],
  chain10: () => [statsBestChaseChain, 10], chain20: () => [statsBestChaseChain, 20], chain30: () => [statsBestChaseChain, 30],
  prestige1: () => [prestigeCount, 1], prestige5: () => [prestigeCount, 5],
  finale1: () => [eventsStats.finales, 1], finale10: () => [eventsStats.finales, 10], arc1: () => [eventsStats.arcs, 1], arc5: () => [eventsStats.arcs, 5],
  visit7: () => [visitStreak.best, 7], visit30: () => [visitStreak.best, 30],
  overdrive1: () => [eventsStats.overdrives, 1], overdrive25: () => [eventsStats.overdrives, 25], spot1: () => [eventsStats.spotlights, 1],
  sync5: () => [Math.floor(eventsStats.bestSyncMs / 60000), 5], sync15: () => [Math.floor(eventsStats.bestSyncMs / 60000), 15],
};

function trophyProgress(t) {
  const fn = t.progress || TROPHY_PROGRESS[t.id];
  try { return fn ? fn() : null; } catch (e) { return null; }
}

function fmtProgressValue(desc, v) {
  return /hour/i.test(desc) ? fmtMinutes(v) : Math.floor(v).toLocaleString();
}

// Replaces the trophy case: earned badges, then what's closest to earning.
function renderAchievements() {
  const el = document.getElementById('trophy-case');
  if (!el) return;
  const earned = TROPHY_DEFS.filter((t) => unlockedTrophies[t.id]);
  const locked = TROPHY_DEFS.filter((t) => !unlockedTrophies[t.id]).map((t) => {
    const p = trophyProgress(t);
    return { t, p, frac: p ? Math.min(0.999, p[0] / p[1]) : 0 };
  }).sort((a, b) => b.frac - a.frac);
  el.innerHTML =
    '<div class="ach-head">🏆 <b>' + earned.length + '</b> / ' + TROPHY_DEFS.length + ' achievements</div>' +
    '<div class="ach-earned">' + (earned.map((t) => '<span class="trophy-chip earned" title="' + masterEsc(t.desc) + '">' + t.label + '</span>').join('') || '<span class="ach-none">None yet - here\'s what\'s closest:</span>') + '</div>' +
    '<div class="ach-locked">' + locked.map(({ t, p, frac }) =>
      '<div class="ach-row"><span class="ach-label">🔒 ' + t.label.replace(/^\S+\s/, '') + '</span><span class="ach-desc">' + masterEsc(t.desc) +
      (p ? ' · ' + fmtProgressValue(t.desc, p[0]) + ' / ' + fmtProgressValue(t.desc, p[1]) : '') + '</span>' +
      (p ? '<div class="ach-bar"><div style="width:' + (frac * 100).toFixed(1) + '%"></div></div>' : '') + '</div>').join('') + '</div>';
}

// ---- Rendering ----
function untilText(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h >= 24 ? Math.ceil(h / 24) + 'd' : h ? h + 'h ' + m + 'm' : m + 'm';
}

function challengeRow(c, counts, i, daily) {
  const def = challengeDef(c.id);
  if (!def) return '';
  const value = Math.min(counts[def.metric] || 0, def.target);
  const shown = MINUTE_METRICS.has(def.metric) ? fmtMinutes(value) + ' / ' + fmtMinutes(def.target) : Math.floor(value).toLocaleString() + ' / ' + def.target.toLocaleString();
  const swap = daily && !c.done && challenges.swapsLeft > 0
    ? '<button class="ch-swap" onclick="swapDailyChallenge(' + i + ')" title="Swap for a different challenge (' + challenges.swapsLeft + ' left today)">🎲</button>' : '';
  return '<div class="ch-row' + (c.done ? ' ch-done' : '') + '"><div class="ch-top"><span>' + (c.done ? '✅' : def.icon) + ' ' + def.desc + '</span>' + swap + '</div>' +
    '<div class="ch-bar"><div style="width:' + (value / def.target * 100).toFixed(1) + '%"></div></div>' +
    '<div class="ch-sub">' + shown + ' · +' + def.xp.toLocaleString() + ' XP</div></div>';
}

function renderChallenges() {
  const el = document.getElementById('challenge-list');
  if (!el || !challenges) return;
  const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
  const nextWeek = new Date(weekStartKey()); nextWeek.setDate(nextWeek.getDate() + 7);
  el.innerHTML =
    '<div class="ch-head">☀️ Daily <span>resets in ' + untilText(tomorrow - Date.now()) + (challenges.swapsLeft ? ' · 🎲 ' + challenges.swapsLeft + ' swap' : '') + '</span></div>' +
    challenges.daily.map((c, i) => challengeRow(c, challenges.dayCounts, i, true)).join('') +
    '<div class="ch-bonus">' + (challenges.swept ? '🌞 Daily sweep earned' : 'Clear all three for +' + DAILY_SWEEP_XP.toLocaleString() + ' XP') + '</div>' +
    '<div class="ch-head">📆 Weekly <span>' + untilText(nextWeek - Date.now()) + ' left</span></div>' +
    challenges.weekly.map((c, i) => challengeRow(c, challenges.weekCounts, i, false)).join('') +
    '<div class="ch-bonus">' + (challenges.perfect ? '🏆 Perfect week earned' : 'Finish all three for +' + PERFECT_WEEK_XP.toLocaleString() + ' XP') + '</div>';
}

// ---- Wiring ----
// Events that become challenge metrics (the arc's metrics arrive via arcMetric).
function challengeFromEvent(kind, d) {
  d = d || {};
  if (kind === 'spin') challengeMetric('spins');
  else if (kind === 'sealed.open') challengeMetric('sealedOpens');
  else if (kind === 'payoff' && (d.tier === 'mega' || d.tier === 'milestone')) challengeMetric('megas');
  else if (kind === 'chase.catch' && d.chain) challengeMetric('chainBest', d.chain);
  else if (kind === 'fx.tile' && d.kind !== 'shock') challengeMetric('fxSeen');
  else if (kind === 'clip.start') challengeMetric('clipsSeen');
  else if (kind === 'hook.start' && d.kind) challengeMetric('hooks');
  else if (kind === 'moment.start') challengeMetric('moments');
  else if (kind === 'colorRush.start' || kind === 'floaterBarrage.start') challengeMetric('spectacles');
}

function initChallenges() {
  if (!challenges) loadChallenges();
  noteLevelReached(xpLevel);
  if (typeof logEvent === 'function') {
    const original = logEvent;
    logEvent = function (kind, data) {
      try { challengeFromEvent(kind, data); } catch (e) {}
      return original(kind, data);
    };
  }
  refreshPlaytimeStats();
  setInterval(refreshPlaytimeStats, 120000);
  setInterval(() => { if (challenges) rollChallengePeriods(); }, 60000);
  // Locked achievements show live progress; refresh while Home is open.
  setInterval(() => { if (!document.hidden && document.querySelector('.panel-tab.active[data-tab="home"]')) renderAchievements(); }, 15000);
  renderAchievements();
}
addEventListener('load', initChallenges);
