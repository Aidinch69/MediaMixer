// Loaded after the core dashboard_*.js files and dashboard_layers.js and shares their
// globals: clip transitions, Spotlight Takeover, the Overdrive meter,
// weekly arcs, the visit-streak calendar, and their trophies.
// initEvents() is called from window.onload (dashboard_boot.js).

// ---- Clip transitions ----
// When a tile's clip changes, the outgoing frame is frozen onto a canvas
// laid over the video, and that still dissolves away (crossfade), zooms
// through a closing iris (zoom-wipe), or tears apart (glitch-cut) once
// the new clip is actually playing underneath - so the swap never shows
// a black frame, at any grid size. The <video> element itself is never
// replaced, so speed effects, tile FX, and listeners are untouched.
const TRANSITION_FALLBACK_MS = 2500;

function pickTransitionStyle() {
  const weights = [
    ['crossfade', TUNING.TRANSITION_WEIGHT_CROSSFADE],
    ['zoom', TUNING.TRANSITION_WEIGHT_ZOOM],
    ['glitch', TUNING.TRANSITION_WEIGHT_GLITCH],
  ];
  const total = weights.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [name, w] of weights) {
    if (r < Math.max(0, w)) return name;
    r -= Math.max(0, w);
  }
  return 'crossfade';
}

// Must be called before the tile's src changes, while the old frame is
// still decoded.
function beginClipTransition(i, vid) {
  if (Math.random() >= TUNING.TRANSITION_PROBABILITY) return;
  const tile = tileElements[i];
  if (!tile || vid.readyState < 2 || !vid.videoWidth) return;
  const style = pickTransitionStyle();
  if (!style) return;
  const stale = tile.querySelector('.clip-transition');
  if (stale) stale.remove();
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / Math.max(vid.videoWidth, vid.videoHeight));
  canvas.width = Math.max(1, Math.round(vid.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(vid.videoHeight * scale));
  try {
    canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
  } catch (e) {
    return; // a non-CORS frame can't be read back - just hard-cut
  }
  canvas.className = 'clip-transition';
  canvas.style.setProperty('--transition-ms', TUNING.TRANSITION_DURATION_MS + 'ms');
  if (vid.style.filter) canvas.style.filter = vid.style.filter;
  tile.insertBefore(canvas, vid.nextSibling);
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    vid.removeEventListener('playing', start);
    if (!canvas.isConnected) return;
    canvas.classList.add('play-' + style);
    setTimeout(() => canvas.remove(), TUNING.TRANSITION_DURATION_MS + 80);
  };
  vid.addEventListener('playing', start);
  setTimeout(start, TRANSITION_FALLBACK_MS);
}

// ---- Spotlight Takeover ----
// Rare: one tile grows to most of the screen for 15-20s while the rest
// dim, then shrinks back. Done with a transform on the tile (not a grid
// reflow), so neither the uniform grid nor Mosaic Fit has to know about
// it. Never starts on top of another event, and has a hard minimum gap
// so it stays special.
let spotlightTileIndex = -1;
let spotlightTimer = null;
let lastSpotlightAt = 0;

function anyMajorEventActive() {
  return lastKnownBarrage > 0 || anticipationActive || finaleActive || overdriveActive ||
    bonusWindowTileIndex >= 0 || sealedTileIndex >= 0 || chaseFlashTileIndex >= 0 || mysteryTileIndex >= 0;
}

function pickSpotlightTarget() {
  const featured = [];
  tileElements.forEach((t, i) => { if (t.classList.contains('tile-featured')) featured.push(i); });
  if (featured.length && Math.random() < 0.6) return featured[Math.floor(Math.random() * featured.length)];
  return pickAmbientTarget();
}

function maybeTriggerSpotlight() {
  if (!anticipationFxEnabled || spotlightTileIndex >= 0 || tileElements.length < 3 || document.hidden) return;
  const now = Date.now();
  // The first one can come at half the gap into a session, not instantly.
  const since = lastSpotlightAt || (sessionStartedAt - TUNING.SPOTLIGHT_MIN_GAP_MS / 2);
  if (now - since < TUNING.SPOTLIGHT_MIN_GAP_MS) return;
  if (anyMajorEventActive()) return;
  if (now - lastAmbientSpawnAt < TUNING.AMBIENT_SPAWN_SEPARATION_MS) return;
  if (Math.random() < TUNING.SPOTLIGHT_PROBABILITY) startSpotlight(pickSpotlightTarget());
}

// An element's box relative to `ancestor`, from offsets (which ignore CSS
// transforms) rather than getBoundingClientRect (which includes them).
function layoutBox(el, ancestor) {
  let left = 0, top = 0, node = el;
  const stop = ancestor.offsetParent;
  while (node && node !== stop) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return { left: left - ancestor.offsetLeft, top: top - ancestor.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
}

function startSpotlight(idx, durationMs) {
  const tile = tileElements[idx];
  const grid = document.getElementById('screen-grid');
  if (!tile || !grid || spotlightTileIndex >= 0) return false;
  // Where the tile sits in the layout, ignoring any transform it has right
  // now (still shrinking from a previous spotlight, swiped, swelled...) -
  // measuring the transformed box is what used to throw it off-screen.
  const tr = layoutBox(tile, grid);
  const gr = { left: 0, top: 0, width: grid.clientWidth, height: grid.clientHeight };
  if (!tr.width || !tr.height) return false;
  const scale = Math.max(1, Math.min(gr.width * TUNING.SPOTLIGHT_SCALE / tr.width, gr.height * TUNING.SPOTLIGHT_SCALE / tr.height));
  const dx = (gr.left + gr.width / 2) - (tr.left + tr.width / 2);
  const dy = (gr.top + gr.height / 2) - (tr.top + tr.height / 2);
  spotlightTileIndex = idx;
  lastSpotlightAt = Date.now();
  lastAmbientSpawnAt = Date.now();
  tile.style.setProperty('--spot-x', dx.toFixed(1) + 'px');
  tile.style.setProperty('--spot-y', dy.toFixed(1) + 'px');
  tile.style.setProperty('--spot-s', scale.toFixed(3));
  tile.style.setProperty('--spot-ms', TUNING.SPOTLIGHT_GROW_MS + 'ms');
  tile.classList.remove('tile-spotlight-leaving');
  tile.classList.add('tile-spotlight');
  tileElements.forEach((t, j) => {
    if (j !== idx) startFadeableOverlay(t, 'tile-dimmed', 'dim', TUNING.SPOTLIGHT_DIM_OPACITY, TUNING.SPOTLIGHT_GROW_MS);
  });
  playChimeSound(0.5, 0.85);
  setTimeout(() => showClaimRewardLabel(idx, '🔦 Spotlight - heart it for a bonus'), TUNING.SPOTLIGHT_GROW_MS);
  const ms = durationMs || TUNING.SPOTLIGHT_DURATION_MIN_MS + Math.random() * TUNING.SPOTLIGHT_DURATION_RANGE_MS;
  clearTimeout(spotlightTimer);
  spotlightTimer = setTimeout(endSpotlight, ms);
  eventsStats.spotlights++;
  saveEventsStats();
  arcMetric('spotlights', 1);
  checkTrophies();
  return true;
}

// instant: the grid is being rebuilt underneath, so skip the shrink.
function endSpotlight(instant) {
  if (spotlightTileIndex < 0) return;
  const idx = spotlightTileIndex;
  spotlightTileIndex = -1;
  clearTimeout(spotlightTimer);
  lastSpotlightAt = Date.now();
  const tile = tileElements[idx];
  const fadeMs = instant ? 0 : TUNING.SPOTLIGHT_GROW_MS;
  if (tile) {
    tile.classList.add('tile-spotlight-leaving');
    tile.classList.remove('tile-spotlight');
    setTimeout(() => {
      if (spotlightTileIndex !== idx) tile.classList.remove('tile-spotlight-leaving');
    }, fadeMs);
  }
  // A barrage that started meanwhile owns the dim now - leave its tiles alone.
  const barrageTiles = lastKnownBarrage > 0 ? lastKnownBarrageTiles : null;
  tileElements.forEach((t, j) => {
    if (j === idx || (barrageTiles && barrageTiles.length && !barrageTiles.includes(j))) return;
    endFadeableOverlay(t, 'tile-dimmed', 'dim', fadeMs || 1);
  });
}

window.addEventListener('resize', () => endSpotlight(true));

setInterval(() => {
  if (spotlightTileIndex >= tileElements.length) endSpotlight(true);
}, 500);

// ---- Overdrive ----
// A meter you fill by engaging (hearts, catches, bonus taps, sealed-tile
// opens - hearts on a Rhythm Mode beat count extra) and release when you
// choose. It never decays; only a release empties it. A release is a real
// peak: server barrage/jackpot odds spike, every tile speeds up, a Surge
// runs, a spiral fades in, a favorite gets the Spotlight, and FX fire.
const OVERDRIVE_KEY = 'mm_overdrive';
let overdriveCharge = 0;
let overdriveActive = false;
let overdriveEndsAt = 0;
let overdriveEndTimer = null;

function loadOverdrive() {
  const saved = loadJsonPref(OVERDRIVE_KEY, { charge: 0, burstEndsAt: 0 });
  overdriveCharge = Math.max(0, Math.min(100, Number(saved.charge) || 0));
  // The page closed mid-burst last time - put the server's odds back.
  if (saved.burstEndsAt && !autopilotEnabled && !finaleActive) fetch('/api/intensity?reset=1');
  saveOverdrive();
  updateOverdriveUi();
}

function saveOverdrive() {
  saveJsonPref(OVERDRIVE_KEY, { charge: overdriveCharge, burstEndsAt: overdriveActive ? overdriveEndsAt : 0 });
}

function chargeOverdrive(amount) {
  if (overdriveActive || !(amount > 0)) return;
  const was = overdriveCharge;
  overdriveCharge = Math.min(100, overdriveCharge + amount);
  if (was < 100 && overdriveCharge >= 100) {
    toast('🔥 Overdrive ready - tap the meter or press O');
    playChimeSound(0.8, 1.25);
  }
  saveOverdrive();
  updateOverdriveUi();
}

// Every engagement reward funnels through here: Overdrive charge plus the
// weekly-arc metrics that aren't already daily-quest metrics.
function onEngagement(kind, idx, strength) {
  strength = strength || 1;
  let amount = 0;
  if (kind === 'heart') {
    amount = TUNING.OVERDRIVE_PER_HEART * strength;
    if (rhythmOnBeatNow()) {
      amount *= TUNING.OVERDRIVE_ON_BEAT_MULT;
      if (idx != null) showClaimRewardLabel(idx, '🥁 On the beat! Overdrive x' + TUNING.OVERDRIVE_ON_BEAT_MULT);
    }
    if (idx != null && idx === spotlightTileIndex) {
      amount *= 2;
      awardXp(10);
      showClaimRewardLabel(idx, '🔦 Spotlight heart +10xp');
    }
    arcMetric('hearts', strength);
  } else if (kind === 'catch') {
    amount = TUNING.OVERDRIVE_PER_CATCH;
    arcMetric('catches', 1);
  } else if (kind === 'bonus') {
    amount = TUNING.OVERDRIVE_PER_BONUS;
  } else if (kind === 'unlock') {
    amount = TUNING.OVERDRIVE_PER_UNLOCK;
  }
  chargeOverdrive(amount);
}

function releaseOverdrive() {
  if (overdriveActive) return;
  if (overdriveCharge < 100) {
    toast('🔥 Overdrive ' + Math.floor(overdriveCharge) + '% - keep engaging to fill it', true);
    return;
  }
  markInteraction();
  overdriveActive = true;
  overdriveCharge = 0;
  overdriveEndsAt = Date.now() + TUNING.OVERDRIVE_BURST_MS;
  saveOverdrive();
  fetch('/api/intensity?barrage=' + TUNING.OVERDRIVE_BARRAGE_P.toFixed(3) + '&jackpot=' + TUNING.OVERDRIVE_JACKPOT_P.toFixed(3));
  surgeExpireAt = Math.max(surgeExpireAt, overdriveEndsAt);
  const rampMs = 1500;
  const holdMs = Math.max(0, TUNING.OVERDRIVE_BURST_MS - rampMs * 2);
  tileElements.forEach((t, i) => {
    const vid = getTileVideo(i);
    if (!vid) return;
    const natural = (tileNaturalBase[i] || 1) * tileSpeedMult(i);
    setTimelineSpeedEffect(i, vid, 'overdrive', SPEED_PRIORITY.overdrive, natural * TUNING.OVERDRIVE_SPEED_MULT, rampMs, holdMs, rampMs, natural);
  });
  if (anticipationFxEnabled) maybeTriggerSpiralOverlay();
  if (tileElements.length >= 3 && spotlightTileIndex < 0 && Math.random() < TUNING.OVERDRIVE_SPOTLIGHT_CHANCE) startSpotlight(pickSpotlightTarget(), TUNING.OVERDRIVE_BURST_MS - 1000);
  burstConfetti(70);
  fireColorSplashPiece('border');
  fireRandomTileFx(3);
  mantraBurst(2);
  playBassDropSound(1.5);
  document.body.classList.add('overdrive-on');
  toast('🔥 OVERDRIVE!');
  eventsStats.overdrives++;
  saveEventsStats();
  arcMetric('overdrives', 1);
  checkTrophies();
  updateOverdriveUi();
  clearTimeout(overdriveEndTimer);
  overdriveEndTimer = setTimeout(endOverdrive, TUNING.OVERDRIVE_BURST_MS);
}

function endOverdrive() {
  if (!overdriveActive) return;
  overdriveActive = false;
  overdriveEndsAt = 0;
  saveOverdrive();
  document.body.classList.remove('overdrive-on');
  if (finaleActive) {
    // The Finale's next tick re-sends its own odds.
  } else if (autopilotEnabled) {
    autopilotTick();
  } else {
    fetch('/api/intensity?reset=1');
  }
  updateOverdriveUi();
}

function updateOverdriveUi() {
  const meter = document.getElementById('overdrive-meter');
  const fill = document.getElementById('overdrive-fill');
  const label = document.getElementById('overdrive-label');
  if (!meter || !fill || !label) return;
  meter.classList.toggle('ready', !overdriveActive && overdriveCharge >= 100);
  meter.classList.toggle('active', overdriveActive);
  if (overdriveActive) {
    // Drains over the burst instead of jumping to empty.
    const left = Math.max(0, overdriveEndsAt - Date.now());
    fill.style.transition = 'none';
    fill.style.width = (left / TUNING.OVERDRIVE_BURST_MS * 100).toFixed(1) + '%';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + left + 'ms linear';
    fill.style.width = '0%';
    label.innerText = '🔥 OVERDRIVE';
  } else {
    fill.style.transition = 'width .4s ease';
    fill.style.width = overdriveCharge.toFixed(1) + '%';
    label.innerText = overdriveCharge >= 100 ? '🔥 RELEASE' : '🔥 ' + Math.floor(overdriveCharge) + '%';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'o' && e.key !== 'O') return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
  releaseOverdrive();
});

// ---- Lifetime stats for the new trophies ----
const EVENTS_STATS_KEY = 'mm_events_stats';
const eventsStats = Object.assign(
  { finales: 0, arcs: 0, overdrives: 0, spotlights: 0, bestSyncMs: 0 },
  loadJsonPref(EVENTS_STATS_KEY, {})
);

function saveEventsStats() {
  saveJsonPref(EVENTS_STATS_KEY, eventsStats);
}

function onFinaleCompleted() {
  eventsStats.finales++;
  saveEventsStats();
  arcMetric('finales', 1);
  checkTrophies();
}

// Lifetime best in-sync run, from Rhythm Mode's own per-session best.
setInterval(() => {
  if (sessionStats.rhythmBest > eventsStats.bestSyncMs) {
    eventsStats.bestSyncMs = sessionStats.rhythmBest;
    saveEventsStats();
    checkTrophies();
  }
}, 5000);

// ---- Weekly arcs ----
// One multi-stage goal per week (Monday to Sunday). Stages unlock in
// order, each pays XP, and finishing the whole arc pays a bigger bonus.
// Runs alongside the daily quests, never replacing them.
const WEEKLY_ARC_KEY = 'mm_weekly_arc';
const WEEKLY_ARC_DEFS = [
  { id: 'heartbound', name: 'Heartbound', finalXp: 25000, stages: [
    { desc: 'Heart 30 clips', metric: 'hearts', target: 30, xp: 4000 },
    { desc: 'Catch 15 chase flashes', metric: 'catches', target: 15, xp: 6000 },
    { desc: 'Land 8 jackpots', metric: 'jackpots', target: 8, xp: 8000 },
    { desc: 'Release Overdrive twice', metric: 'overdrives', target: 2, xp: 10000 },
  ] },
  { id: 'showtime', name: 'Showtime', finalXp: 30000, stages: [
    { desc: 'Rate 50 clips', metric: 'rates', target: 50, xp: 4000 },
    { desc: 'Claim 10 bonuses', metric: 'bonuses', target: 10, xp: 6000 },
    { desc: 'See 2 Spotlights', metric: 'spotlights', target: 2, xp: 8000 },
    { desc: 'Complete a Finale', metric: 'finales', target: 1, xp: 12000 },
  ] },
  { id: 'momentum', name: 'Momentum', finalXp: 30000, stages: [
    { desc: 'Heart 40 clips', metric: 'hearts', target: 40, xp: 5000 },
    { desc: 'Catch 25 chase flashes', metric: 'catches', target: 25, xp: 7000 },
    { desc: 'Release Overdrive 3 times', metric: 'overdrives', target: 3, xp: 9000 },
    { desc: 'Land 12 jackpots', metric: 'jackpots', target: 12, xp: 11000 },
  ] },
  { id: 'collector', name: 'Collector', finalXp: 28000, stages: [
    { desc: 'Rate 30 clips', metric: 'rates', target: 30, xp: 3000 },
    { desc: 'Land 5 jackpots', metric: 'jackpots', target: 5, xp: 6000 },
    { desc: 'Claim 15 bonuses', metric: 'bonuses', target: 15, xp: 8000 },
    { desc: 'See a Spotlight', metric: 'spotlights', target: 1, xp: 6000 },
    { desc: 'Release Overdrive', metric: 'overdrives', target: 1, xp: 8000 },
  ] },
];
let weeklyArc = { weekStart: '', arcId: '', stageIndex: 0, progress: 0, done: false };

function weekStartKey(d) {
  d = d || new Date();
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return monday.toDateString();
}

function currentArcDef() {
  return WEEKLY_ARC_DEFS.find(a => a.id === weeklyArc.arcId) || WEEKLY_ARC_DEFS[0];
}

function loadWeeklyArc() {
  const week = weekStartKey();
  const saved = loadJsonPref(WEEKLY_ARC_KEY, null);
  if (saved && saved.weekStart === week && WEEKLY_ARC_DEFS.some(a => a.id === saved.arcId)) {
    weeklyArc = saved;
  } else {
    const pool = WEEKLY_ARC_DEFS.filter(a => !saved || a.id !== saved.arcId);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    weeklyArc = { weekStart: week, arcId: pick.id, stageIndex: 0, progress: 0, done: false };
    saveJsonPref(WEEKLY_ARC_KEY, weeklyArc);
    if (saved) toast('🗺️ New weekly arc: ' + pick.name);
  }
  updateWeeklyArcUi();
}

function arcMetric(metric, amount) {
  if (typeof challengeMetric === 'function') challengeMetric(metric, amount || 1);
  if (weeklyArc.done || !weeklyArc.arcId) return;
  const def = currentArcDef();
  const stage = def.stages[weeklyArc.stageIndex];
  if (!stage || stage.metric !== metric) return;
  weeklyArc.progress += amount || 1;
  if (weeklyArc.progress >= stage.target) {
    awardXp(stage.xp);
    weeklyArc.stageIndex++;
    weeklyArc.progress = 0;
    if (weeklyArc.stageIndex >= def.stages.length) {
      weeklyArc.done = true;
      awardXp(def.finalXp);
      toast('🗺️ Weekly arc complete: ' + def.name + '! +' + def.finalXp.toLocaleString() + 'xp');
      burstConfetti(60);
      playChimeSound(1, 1.2);
      eventsStats.arcs++;
      saveEventsStats();
      checkTrophies();
    } else {
      toast('🗺️ ' + def.name + ' stage ' + weeklyArc.stageIndex + '/' + def.stages.length + ' done: ' + stage.desc + ' +' + stage.xp.toLocaleString() + 'xp');
      playChimeSound(0.7, 1.1);
    }
  }
  saveJsonPref(WEEKLY_ARC_KEY, weeklyArc);
  updateWeeklyArcUi();
}

function updateWeeklyArcUi() {
  const el = document.getElementById('weekly-arc');
  if (!el || !weeklyArc.arcId) return;
  const def = currentArcDef();
  const next = new Date(weekStartKey());
  next.setDate(next.getDate() + 7);
  const daysLeft = Math.max(1, Math.ceil((next - Date.now()) / 86400000));
  const pips = def.stages.map((s, n) => {
    const cls = n < weeklyArc.stageIndex ? ' earned' : n === weeklyArc.stageIndex && !weeklyArc.done ? ' current' : '';
    return '<span class="trophy-chip arc-pip' + cls + '" title="' + s.desc + '">' + (n < weeklyArc.stageIndex ? '✓' : n + 1) + '</span>';
  }).join('');
  let body;
  if (weeklyArc.done) {
    body = '<div class="arc-stage">✅ Complete - a new arc starts Monday</div>';
  } else {
    const stage = def.stages[weeklyArc.stageIndex];
    const pct = Math.min(100, weeklyArc.progress / stage.target * 100);
    body = '<div class="arc-stage">' + stage.desc + ' (' + Math.min(weeklyArc.progress, stage.target) + '/' + stage.target + ') · +' + stage.xp.toLocaleString() + 'xp</div>' +
      '<div class="audio-react-meter"><div class="arc-progress-fill" style="width:' + pct.toFixed(1) + '%"></div></div>';
  }
  el.innerHTML = '<div class="arc-title">🗺️ Weekly Arc: <b>' + def.name + '</b> <span class="arc-sub">' + daysLeft + 'd left · finish for +' + def.finalXp.toLocaleString() + 'xp</span></div>' +
    '<div class="arc-pips">' + pips + '</div>' + body;
}

// ---- Visit streak ----
const VISIT_KEY = 'mm_visit_streak';
const VISIT_MILESTONES = [3, 7, 14, 30, 60, 100, 365];
const VISIT_CALENDAR_DAYS = 21;
let visitStreak = { days: [], current: 0, best: 0 };

function recordVisitDay() {
  visitStreak = Object.assign({ days: [], current: 0, best: 0 }, loadJsonPref(VISIT_KEY, {}));
  const today = new Date().toDateString();
  if (visitStreak.days.includes(today)) { updateVisitCalendarUi(); return; }
  const y = new Date();
  y.setDate(y.getDate() - 1);
  visitStreak.current = visitStreak.days.includes(y.toDateString()) ? visitStreak.current + 1 : 1;
  visitStreak.best = Math.max(visitStreak.best, visitStreak.current);
  visitStreak.days.push(today);
  if (visitStreak.days.length > 120) visitStreak.days = visitStreak.days.slice(-120);
  saveJsonPref(VISIT_KEY, visitStreak);
  if (VISIT_MILESTONES.includes(visitStreak.current)) {
    const xp = visitStreak.current * 5;
    awardXp(xp);
    toast('📅 ' + visitStreak.current + '-day visit streak! +' + xp + 'xp');
  } else if (visitStreak.current > 1) {
    toast('📅 Day ' + visitStreak.current + ' in a row');
  }
  checkTrophies();
  updateVisitCalendarUi();
}

function updateVisitCalendarUi() {
  const el = document.getElementById('visit-calendar');
  if (!el) return;
  const visited = new Set(visitStreak.days);
  const cells = [];
  for (let n = VISIT_CALENDAR_DAYS - 1; n >= 0; n--) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const key = d.toDateString();
    const cls = (visited.has(key) ? ' hit' : '') + (n === 0 ? ' today' : '');
    cells.push('<span class="visit-day' + cls + '" title="' + key + '"></span>');
  }
  const next = VISIT_MILESTONES.find(m => m > visitStreak.current);
  el.innerHTML = '<div class="arc-title">📅 Visit streak: <b>' + visitStreak.current + ' day' + (visitStreak.current === 1 ? '' : 's') + '</b>' +
    ' <span class="arc-sub">best ' + visitStreak.best + (next ? ' · next bonus at ' + next : '') + '</span></div>' +
    '<div class="visit-calendar">' + cells.join('') + '</div>';
}

// Midnight / Monday rollover while the tab stays open.
setInterval(() => {
  if (weeklyArc.weekStart && weeklyArc.weekStart !== weekStartKey()) loadWeeklyArc();
  if (!visitStreak.days.includes(new Date().toDateString())) recordVisitDay();
  updateWeeklyArcUi();
}, 10 * 60000);

// ---- Trophies ----
TROPHY_DEFS.push(
  { id: 'finale1', label: '🎆 Grand Finale', desc: 'Complete a Finale', check: () => eventsStats.finales >= 1 },
  { id: 'finale10', label: '🎆 Showrunner', desc: 'Complete 10 Finales', check: () => eventsStats.finales >= 10 },
  { id: 'arc1', label: '🗺️ Arc Walker', desc: 'Finish a weekly arc', check: () => eventsStats.arcs >= 1 },
  { id: 'arc5', label: '🗺️ Saga', desc: 'Finish 5 weekly arcs', check: () => eventsStats.arcs >= 5 },
  { id: 'visit7', label: '📅 Regular', desc: '7-day visit streak', check: () => visitStreak.best >= 7 },
  { id: 'visit30', label: '📅 Devotee', desc: '30-day visit streak', check: () => visitStreak.best >= 30 },
  { id: 'sync5', label: '🥁 Locked In', desc: '5-minute in-sync run in Rhythm Mode', check: () => eventsStats.bestSyncMs >= 300000 },
  { id: 'sync15', label: '🥁 Metronome', desc: '15-minute in-sync run in Rhythm Mode', check: () => eventsStats.bestSyncMs >= 900000 },
  { id: 'chain30', label: '🏃 Untouchable', desc: 'Chase chain of 30', check: () => statsBestChaseChain >= 30 },
  { id: 'jackpot100', label: '🎰 Centurion', desc: '100 lifetime jackpots', check: () => statsLifetimeJackpots >= 100 },
  { id: 'overdrive1', label: '🔥 Ignition', desc: 'Release Overdrive', check: () => eventsStats.overdrives >= 1 },
  { id: 'overdrive25', label: '🔥 Pyromaniac', desc: 'Release Overdrive 25 times', check: () => eventsStats.overdrives >= 25 },
  { id: 'spot1', label: '🔦 Center Stage', desc: 'See a Spotlight Takeover', check: () => eventsStats.spotlights >= 1 },
);

startTunableInterval('SPOTLIGHT_CHECK_MS', maybeTriggerSpotlight);

function initEvents() {
  loadOverdrive();
  loadWeeklyArc();
  recordVisitDay();
  updateTrophyUi();
}
