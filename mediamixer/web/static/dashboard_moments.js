// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Moments: The Drop, Breath, Countdown reveal, Focus pull, Call & response
// and Echo trails - structured, beat-aware moments that never overlap.

const momentsOn = { drop: true, breath: true, countdown: true, focus: true, callResponse: true, echo: true };
let activeMoment = null; // name of the moment running now
let momentEnergyShift = 0; // added to the energy target while a moment wants it
let momentEnergyUntil = 0;
const momentLastAt = {};

function momentBusy() {
  return !!(activeMoment || floaterBarrageActive || finaleActive || cascade || spotlightTileIndex >= 0 || anticipationActive || document.hidden || !tileElements.length);
}

function momentReady(name, cooldownKey) {
  return momentsOn[name] && !momentBusy() && Date.now() - (momentLastAt[name] || 0) > TUNING[cooldownKey];
}

// Read by rhythmDriveTarget.
function momentEnergy() { return Date.now() < momentEnergyUntil ? momentEnergyShift : 0; }

function beatMsNow() { return rhythmFxBeatMs(); }

function freeTiles(exclude) {
  const busy = rhythmFxBusyTiles();
  return tileElements.map((t, i) => i).filter((i) => !busy.has(i) && !(exclude && exclude.has(i)));
}

// Called from onRhythmBeat on every beat.
function momentsBeat(n) {
  const downbeat = n % 4 === 0;
  if (drop) dropBeat(downbeat);
  if (callResponse) callResponseBeat();
  if (focusPull && focusPull.onBeat && downbeat) focusPullStep();
  if (!downbeat) return;
  if (momentReady('drop', 'DROP_COOLDOWN_MS') && rhythmDrive >= TUNING.DROP_MIN_ENERGY && Math.random() < TUNING.DROP_CHANCE) startDrop();
  else if (momentReady('callResponse', 'CALL_RESPONSE_COOLDOWN_MS') && Math.random() < TUNING.CALL_RESPONSE_CHANCE) startCallResponse();
}

// Moments that don't need the beat roll on a timer.
setInterval(() => {
  if (momentReady('breath', 'BREATH_COOLDOWN_MS') && rhythmDrive >= 1.05 && Math.random() < TUNING.BREATH_CHANCE) startBreath();
  else if (momentReady('focus', 'FOCUS_PULL_COOLDOWN_MS') && tileElements.length >= 4 && Math.random() < TUNING.FOCUS_PULL_CHANCE) startFocusPull();
  else if (momentReady('echo', 'ECHO_COOLDOWN_MS') && rhythmDrive >= TUNING.ECHO_MIN_ENERGY && Math.random() < TUNING.ECHO_CHANCE) startEchoTrails();
}, 20000);

function momentVeil(id, opacity, ms) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transition = 'opacity ' + ms + 'ms ease';
  el.style.opacity = String(opacity);
}

// ---- The Drop ----
// A bar where the beat drops out (pulses stop, the grid dims and settles),
// then on the next downbeat everything hits at once: every free tile cuts
// together, a flash, a shockwave on every tile, and the energy jumps.
let drop = null;
let dropHoldCuts = false; // queued clip changes wait for the drop beat

function startDrop() {
  if (drop || !rhythmActive()) return false;
  activeMoment = 'drop';
  momentLastAt.drop = Date.now();
  drop = { phase: 'armed', beats: 0 };
  return true;
}

function dropMuted() { return !!(drop && drop.phase === 'hold'); }

function dropBeat(downbeat) {
  if (drop.phase === 'armed') {
    if (!downbeat) return;
    drop.phase = 'hold';
    drop.beats = 0;
    // Ask for the new clips now and hold every change for the drop beat - the
    // status push that carries them can take longer than one beat to arrive.
    dropHoldCuts = true;
    fetch('/api/rotate_all').catch(() => {});
    momentVeil('moment-dim', 0.38, 400);
    momentEnergyShift = -0.12; momentEnergyUntil = Date.now() + 5000;
    toast('🔇 …');
    return;
  }
  if (drop.phase === 'hold') {
    drop.beats++;
    if (drop.beats >= 4 && downbeat) dropHit();
  }
}

function dropHit() {
  drop = null;
  dropHoldCuts = false;
  momentVeil('moment-dim', 0, 120);
  flushPendingCuts(false);
  const theater = document.getElementById('theater-box');
  theater.classList.add('payoff-flash');
  setTimeout(() => theater.classList.remove('payoff-flash'), 650);
  const grid = document.getElementById('screen-grid');
  if (grid && grid.animate) grid.animate([{ transform: 'scale(1.035)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1)' });
  tileElements.forEach((t, i) => setTimeout(() => fireTileFx(i, 'shock'), i * 25));
  burstConfetti(22);
  audioGlowKick = 1;
  momentEnergyShift = 0.18; momentEnergyUntil = Date.now() + 9000;
  toast('💥 DROP');
  activeMoment = null;
}

// ---- Breath ----
// The quiet counterpart: ten seconds where everything slows, dims softly and
// settles (the beat on Theta if a brainwave preset is on), then releases.
let breath = null;
let breathBandUntil = 0; // read by brainwaveBand

function startBreath() {
  if (breath) return false;
  activeMoment = 'breath';
  momentLastAt.breath = Date.now();
  const ms = TUNING.BREATH_MS;
  breath = { until: Date.now() + ms };
  momentVeil('moment-dim', 0.28, 1500);
  momentEnergyShift = -0.25; momentEnergyUntil = Date.now() + ms;
  breathBandUntil = Date.now() + ms;
  if (lastSynthParams) updateSynthParams(lastSynthParams);
  tileElements.forEach((t, i) => {
    const vid = getTileVideo(i);
    if (vid) setTimelineSpeedEffect(i, vid, 'breath', SPEED_PRIORITY.breath, TUNING.BREATH_SPEED, 1500, Math.max(0, ms - 3000), 1500, (tileNaturalBase[i] || 1) * globalSpeedMult());
  });
  toast('🌬️ Breathe');
  setTimeout(() => momentVeil('moment-dim', 0, 1500), Math.max(0, ms - 1500));
  setTimeout(() => { breath = null; activeMoment = null; if (lastSynthParams) updateSynthParams(lastSynthParams); }, ms);
  return true;
}

// ---- Countdown reveal ----
// Before a big jackpot lands, three tiles go dark and light back up one per
// beat - 3, 2, 1 - with the payoff on the last.
function scheduleCountdown(durationS, tierName) {
  if (!momentsOn.countdown) return;
  if (!(tierName === 'mega' || (tierName === 'medium' && Math.random() < 0.4))) return;
  const beat = Math.min(900, beatMsNow());
  const startIn = durationS * 1000 - 3 * beat - 150;
  if (startIn < 300) return;
  setTimeout(() => {
    if (!anticipationActive) return;
    const pool = freeTiles();
    const picks = [];
    while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    if (picks.length < 3) return;
    const veils = picks.map((i) => {
      const v = document.createElement('div');
      v.className = 'countdown-veil';
      tileElements[i].appendChild(v);
      return v;
    });
    [3, 2, 1].forEach((num, k) => setTimeout(() => {
      const v = veils[k];
      v.textContent = String(num);
      v.classList.add('lit');
      setTimeout(() => { v.classList.add('gone'); setTimeout(() => v.remove(), 450); }, Math.min(350, beat * 0.6));
    }, k * beat));
  }, startIn);
}

// ---- Focus pull ----
// Every tile goes softly out of focus except one, which pulls sharp; the
// focus moves to a new tile each bar, favouring clips you've hearted.
let focusPull = null;

function startFocusPull() {
  if (focusPull || tileElements.length < 4) return false;
  activeMoment = 'focus';
  momentLastAt.focus = Date.now();
  focusPull = { steps: Math.round(TUNING.FOCUS_PULL_BARS), focus: -1, onBeat: rhythmActive(), timer: null };
  tileElements.forEach((t) => t.classList.add('focus-soft'));
  focusPullStep();
  if (!focusPull.onBeat) focusPull.timer = setInterval(focusPullStep, 2600);
  return true;
}

function focusPullStep() {
  const f = focusPull;
  if (!f) return;
  if (f.steps-- <= 0) { endFocusPull(); return; }
  const candidates = tileElements.map((t, i) => i).filter((i) => i !== f.focus);
  const weight = (i) => 1 + Math.min(4, ((videoMetaCache[currentPaths[i]] || {}).heart_count || 0) / 5);
  let roll = Math.random() * candidates.reduce((s, i) => s + weight(i), 0);
  let next = candidates[candidates.length - 1];
  for (const i of candidates) { roll -= weight(i); if (roll <= 0) { next = i; break; } }
  if (f.focus >= 0 && tileElements[f.focus]) tileElements[f.focus].classList.add('focus-soft');
  f.focus = next;
  tileElements[next].classList.remove('focus-soft');
}

function endFocusPull() {
  if (!focusPull) return;
  clearInterval(focusPull.timer);
  tileElements.forEach((t) => t.classList.remove('focus-soft'));
  focusPull = null;
  activeMoment = null;
}

// ---- Call and response ----
// Two neighbouring tiles trade the beat: one brightens while the other dips,
// then they swap, for two bars.
let callResponse = null;

function startCallResponse() {
  if (callResponse || tileElements.length < 2) return false;
  const free = freeTiles();
  if (free.length < 2) return false;
  const cols = Math.max(1, currentColumns || 1);
  const a = free[Math.floor(Math.random() * free.length)];
  const neighbours = free.filter((i) => i !== a && (Math.abs(i - a) === 1 && Math.floor(i / cols) === Math.floor(a / cols) || Math.abs(i - a) === cols));
  const b = neighbours.length ? neighbours[Math.floor(Math.random() * neighbours.length)] : free.find((i) => i !== a);
  activeMoment = 'callResponse';
  momentLastAt.callResponse = Date.now();
  callResponse = { a, b, beats: 8, lead: 0, timer: null };
  if (!rhythmActive()) callResponse.timer = setInterval(callResponseBeat, beatMsNow());
  callResponseBeat();
  return true;
}

function callResponseBeat() {
  const c = callResponse;
  if (!c) return;
  const [lead, quiet] = c.lead ? [c.b, c.a] : [c.a, c.b];
  [c.a, c.b].forEach((i) => tileElements[i] && tileElements[i].classList.remove('cr-lead', 'cr-quiet'));
  if (c.beats-- <= 0) {
    clearInterval(c.timer);
    callResponse = null;
    activeMoment = null;
    return;
  }
  if (tileElements[lead]) tileElements[lead].classList.add('cr-lead');
  if (tileElements[quiet]) tileElements[quiet].classList.add('cr-quiet');
  reactPulseTile(lead, 0.8);
  c.lead ^= 1;
}

// ---- Echo trails ----
// At peak energy, every tile briefly leaves motion trails at full speed.
function startEchoTrails(ms) {
  ms = ms || TUNING.ECHO_MS;
  activeMoment = 'echo';
  momentLastAt.echo = Date.now();
  tileElements.forEach((tile, i) => {
    const vid = getTileVideo(i);
    if (!tile || !vid || !vid.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-slowmo-trail fx-echo-trail';
    tile.insertBefore(canvas, vid.nextSibling);
    const g = canvas.getContext('2d');
    const start = performance.now();
    let last = 0;
    const draw = (ts) => {
      const elapsed = ts - start;
      if (!canvas.isConnected || elapsed >= ms) { canvas.remove(); return; }
      requestAnimationFrame(draw);
      canvas.style.opacity = (0.65 * fxEnvelope(elapsed, ms)).toFixed(3);
      if (ts - last < 40) return;
      last = ts;
      const w = Math.max(1, Math.round(tile.clientWidth / 2)), h = Math.max(1, Math.round(tile.clientHeight / 2));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const vw = vid.videoWidth, vh = vid.videoHeight;
      if (!vw || !vh) return;
      const scale = Math.min(w / vw, h / vh);
      g.globalAlpha = 0.22;
      g.drawImage(vid, (w - vw * scale) / 2, (h - vh * scale) / 2, vw * scale, vh * scale);
    };
    requestAnimationFrame(draw);
  });
  toast('〰️ Echo');
  setTimeout(() => { activeMoment = null; }, ms);
  return true;
}

// ---- prefs ----
function loadMomentPrefs() {
  const p = loadJsonPref('mm_moments', {});
  Object.keys(momentsOn).forEach((k) => { if (typeof p[k] === 'boolean') momentsOn[k] = p[k]; });
  updateMomentUi();
}

function toggleMoment(k) {
  momentsOn[k] = !momentsOn[k];
  saveJsonPref('mm_moments', momentsOn);
  updateMomentUi();
}

function updateMomentUi() {
  Object.keys(momentsOn).forEach((k) => setToggleBadge('moment-' + k + '-toggle', momentsOn[k]));
}
