// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Content Pulse: the clips on screen lead. Each tile's movement right now -
// read from its Clip DNA pulse curve at the current playback position, or
// sampled live from tiny frames for clips not analysed yet - becomes one
// screen-wide level that:
//  - lifts and settles the session energy (so the binaural beat, spirals
//    and everything else on the Shared Pulse follow the footage);
//  - glows the tile and the screen edge as a clip hits one of its peaks;
//  - lets some cuts wait until just after a clip's peak;
//  - with Rhythm Mode's tempo source on "Follow Clips", sets the beat to
//    the rhythm of the clip that's moving most (its DNA tempo).

const contentOn = { energy: true, peaks: true, peakCuts: true, beatMatch: true, visualTone: true };
const CONTENT_TICK_MS = 125;
const CONTENT_LIVE_W = 16, CONTENT_LIVE_H = 9;
let contentLevel = 0; // 0..1, screen-wide movement right now
let contentBaseline = 0.4; // its slow average, so energy follows changes rather than a clip's style
let contentSeeded = false;
let contentHero = -1; // the tile moving most (leads Follow Clips)
let contentHeroSince = 0;
let contentTempo = null; // smoothed BPM from the hero's rhythm
const contentPulseCache = new Map(); // path -> Uint8Array (4 Hz, 0..255)
const contentLive = {}; // tile -> { prev, max } for clips without a DNA pulse
const contentLastT = {}; // tile -> last currentTime seen (peak crossings)
const contentTileLevels = []; // tile -> its level on the last tick (null = unknown), read by Gravity
const contentSampler = document.createElement('canvas');
contentSampler.width = CONTENT_LIVE_W;
contentSampler.height = CONTENT_LIVE_H;

function contentDna(i) {
  const meta = videoMetaCache[currentPaths[i]];
  return meta && meta.dna ? meta.dna : null;
}

function contentPulseArray(path, hex) {
  let a = contentPulseCache.get(path);
  if (!a) {
    a = new Uint8Array(hex.length / 2);
    for (let k = 0; k < a.length; k++) a[k] = parseInt(hex.substr(k * 2, 2), 16);
    if (contentPulseCache.size > 64) contentPulseCache.delete(contentPulseCache.keys().next().value);
    contentPulseCache.set(path, a);
  }
  return a;
}

// 0..1: how much this tile's clip is moving right now, relative to itself.
function tileContentLevel(i) {
  const vid = getTileVideo(i);
  if (!vid || vid.paused || vid.readyState < 2) return null;
  const dna = contentDna(i);
  if (dna && dna.pulse) {
    const a = contentPulseArray(currentPaths[i], dna.pulse);
    const x = vid.currentTime * 4;
    const k = Math.floor(x);
    if (k >= a.length) return null;
    const v = k + 1 < a.length ? a[k] + (a[k + 1] - a[k]) * (x - k) : a[k];
    return v / 255;
  }
  return liveTileLevel(i, vid);
}

// Fallback: change between two tiny frames, scaled by the biggest change
// this clip has shown so far (so it's relative to itself, like the DNA curve).
function liveTileLevel(i, vid) {
  if (!vid.videoWidth) return null;
  try {
    const g = contentSampler.getContext('2d', { willReadFrequently: true });
    g.drawImage(vid, 0, 0, CONTENT_LIVE_W, CONTENT_LIVE_H);
    const d = g.getImageData(0, 0, CONTENT_LIVE_W, CONTENT_LIVE_H).data;
    const luma = new Float32Array(CONTENT_LIVE_W * CONTENT_LIVE_H);
    for (let p = 0, q = 0; p < d.length; p += 4, q++) luma[q] = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
    const s = contentLive[i] && contentLive[i].path === currentPaths[i] ? contentLive[i] : (contentLive[i] = { path: currentPaths[i], prev: null, max: 4 });
    const prev = s.prev;
    s.prev = luma;
    if (!prev) return null;
    let diff = 0;
    for (let q = 0; q < luma.length; q++) diff += Math.abs(luma[q] - prev[q]);
    diff /= luma.length;
    s.max = Math.max(s.max * 0.999, diff);
    return Math.min(1, diff / s.max);
  } catch (e) {
    return null;
  }
}

function tileArea(i) {
  const t = tileElements[i];
  return t ? Math.max(1, t.clientWidth * t.clientHeight) : 1;
}

function contentTick() {
  if (document.hidden || !tileElements.length) return;
  contentTileLevels.length = tileElements.length;
  let heroScore = -1, hero = -1;
  const vals = [];
  tileElements.forEach((t, i) => {
    const v = tileContentLevel(i);
    contentTileLevels[i] = v;
    if (v == null) return;
    const w = tileArea(i);
    vals.push([v, w]);
    const score = v * w;
    if (score > heroScore) { heroScore = score; hero = i; }
    if (contentOn.peaks) checkContentPeak(i);
  });
  if (!vals.length) return;
  // The most active third of the screen is what catches the eye - a plain
  // average over many tiles would flatten every swing.
  vals.sort((a, b) => b[0] - a[0]);
  const top = vals.slice(0, Math.max(1, Math.ceil(vals.length / 3)));
  const level = top.reduce((s, x) => s + x[0] * x[1], 0) / top.reduce((s, x) => s + x[1], 0);
  const dt = CONTENT_TICK_MS / 1000;
  if (!contentSeeded) { contentSeeded = true; contentLevel = contentBaseline = level; }
  contentLevel += (level - contentLevel) * (1 - Math.exp(-dt / 0.6));
  contentBaseline += (contentLevel - contentBaseline) * (1 - Math.exp(-dt / 30));
  // The hero changes only when another tile clearly takes over and the
  // current one has led for a while - the beat shouldn't flick between clips.
  if (hero >= 0 && hero !== contentHero && (contentHero < 0 || Date.now() - contentHeroSince > TUNING.CONTENT_HERO_HOLD_MS)) {
    contentHero = hero;
    contentHeroSince = Date.now();
  }
  updateContentTempo();
}

// Energy shift for rhythmDriveTarget: up while the clips move more than
// usual, down while they settle.
function contentEnergy() {
  if (!contentOn.energy) return 0;
  const d = (contentLevel - contentBaseline) * TUNING.CONTENT_ENERGY_GAIN;
  return Math.max(-TUNING.CONTENT_ENERGY_MAX, Math.min(TUNING.CONTENT_ENERGY_MAX, d));
}

// A clip crossing one of its own motion peaks: its tile flares and the
// screen edge glows with it.
function checkContentPeak(i) {
  const vid = getTileVideo(i);
  const dna = contentDna(i);
  const now = vid ? vid.currentTime : 0;
  const last = contentLastT[i];
  contentLastT[i] = now;
  if (!dna || !dna.peaks || last == null || now < last || now - last > 1) return; // a seek or loop, not playback
  if (!dna.peaks.some((p) => p > last && p <= now)) return;
  const tile = tileElements[i];
  let glow = tile.querySelector('.content-peak-glow');
  if (!glow) { glow = document.createElement('div'); glow.className = 'content-peak-glow'; tile.appendChild(glow); }
  glow.style.animation = 'none';
  void glow.offsetWidth;
  glow.style.animation = '';
  audioGlowKick = Math.max(audioGlowKick, TUNING.CONTENT_PEAK_GLOW);
  if (typeof onContentPeak === 'function') onContentPeak(i);
}

// ---- Follow Clips tempo ----
// The hero clip's own rhythm (its DNA tempo at this point in the clip),
// folded into a playable range and glided so it never jumps.
function contentHeroBpm() {
  // A clip the beat has locked onto leads, at its live (measured) tempo.
  const lead = typeof rhythmLead !== 'undefined' && rhythmLead >= 0 ? beatLocks[rhythmLead] : null;
  if (lead && lead.locked && lead.liveBpm) return foldBpm(lead.liveBpm);
  if (contentHero < 0) return null;
  // Whole-clip tempo - the 8s windows made the beat wander with the clip.
  const dna = contentDna(contentHero);
  let bpm = dna && dna.tempo;
  if (!bpm) return null;
  while (bpm < 70) bpm *= 2;
  while (bpm > 140) bpm /= 2;
  return bpm;
}

function updateContentTempo() {
  const target = contentHeroBpm();
  if (!target) return;
  if (!contentTempo) { contentTempo = target; return; }
  // Glide ~4s, and take the octave nearest the current tempo.
  let t = target;
  if (t / contentTempo > 1.5) t /= 2;
  else if (contentTempo / t > 1.5) t *= 2;
  contentTempo += (t - contentTempo) * (1 - Math.exp(-(CONTENT_TICK_MS / 1000) / 4));
}

// ---- Cut after the peak ----
// When a tile is about to change and its clip has a motion peak just ahead,
// some of the time it's held until just after the peak - so the cut lands
// on the payoff instead of leaving the clip mid-build.
const peakCutDecided = {}; // tile -> path it was decided for

function checkPeakCuts() {
  if (!lastStatusData || !lastStatusData.screens || !contentOn.peakCuts) return;
  const sinceStatus = (Date.now() - lastStatusAt) / 1000;
  lastStatusData.screens.forEach((s, i) => {
    if (s.expires_in == null || s.held || s.pinned) return;
    const left = s.expires_in - sinceStatus;
    if (left > 1.2 || left < 0) return;
    const path = currentPaths[i];
    if (!path || peakCutDecided[i] === path) return;
    peakCutDecided[i] = path; // one decision per clip
    if (Math.random() >= TUNING.PEAK_CUT_CHANCE) return;
    const dna = contentDna(i);
    const vid = getTileVideo(i);
    if (!dna || !dna.peaks || !vid) return;
    const t = vid.currentTime, rate = vid.playbackRate || 1;
    if (dna.peaks.some((p) => p <= t && t - p < 1.5)) return; // just past a peak already - cut as planned
    const next = dna.peaks.find((p) => p > t);
    if (next == null) return;
    const wait = (next - t) / rate;
    if (wait > TUNING.PEAK_CUT_MAX_WAIT_S) return;
    const hold = wait + TUNING.PEAK_CUT_AFTER_S;
    fetch('/api/hold?screen=' + i + '&s=' + hold.toFixed(2)).catch(() => {});
    logEvent('cut.afterPeak', { tile: i, wait: +wait.toFixed(2) });
  });
}

// ---- Beat-matching (phase-locked, live) ----
// Two lessons from real clips: matching speed alone left clips hitting
// between beats and drifting, and the tempo from Clip DNA is often too
// unsure to steer by. So each candidate tile's movement is read live, one
// sample per decoded video frame (a tiny frame difference), kept for the
// last few seconds:
//  1. every second its own current tempo is measured (autocorrelation) with
//     a confidence - in each of six regions of the frame as well as the whole
//     (the rhythmic action is usually in one part of it, and camera moves
//     and other people smear a whole-frame reading). A tile only locks after
//     three steady readings in a row; its tempo is then frozen (re-reading
//     it while locked made it steer away), and the lock is only let go
//     after its rhythm has stayed weak for a while (no flicker);
//  2. a locked tile's timing is compared with the beat (quadrature
//     demodulation: angle = how early/late its bursts land, magnitude = how
//     rhythmic) and a gentle PI controller nudges its speed so its bursts
//     land on the beat, at half / same / double time, whichever is nearest.
// With Follow Clips the beat follows the most clearly rhythmic clip on
// screen (the rhythm lead): it takes that clip's live tempo and slides its
// timing onto that clip's bursts - the clip itself is never sped up - and
// the lead tile glows softly on each beat so you can see what it follows.
// Tiles under another speed effect (slow-mo, Breath...) are skipped - their
// rhythm is distorted while it runs.
const BEAT_LOCK_MAX_TILES = 6; // tiles listened to at once, biggest first
const BEAT_LOCK_W = 24, BEAT_LOCK_H = 14;
const BEAT_LOCK_FS = 30; // resampled rate for the tempo search
const BEAT_LOCK_WINDOW_S = 8;
const BEAT_LOCK_CELLS = [[0, 0, 24, 14]].concat([0, 1, 2].flatMap((cx) => [0, 1].map((cy) => [cx * 8, cy * 7, cx * 8 + 8, cy * 7 + 7]))); // whole frame + 3x2 regions
const beatLocks = []; // tile -> lock state
let rhythmLead = -1; // Follow Clips: the locked tile the beat follows
let rhythmLeadSince = 0;
const beatLockSampler = document.createElement('canvas');
beatLockSampler.width = BEAT_LOCK_W;
beatLockSampler.height = BEAT_LOCK_H;

// Where the beat clock is, in beats (continuous: 12.25 = a quarter past beat 12).
function beatPhaseNow(now) {
  const interval = 60000 / Math.max(30, currentRhythmBpm());
  return rhythmBeatCount - (rhythmNextBeatAt - now) / interval;
}

function newBeatLock(path) {
  return {
    path, c: 0, locked: false, weakSince: 0, hist: [], tempos: [], liveBpm: null, conf: 0, cell: 0, steady: 0,
    I: 0, Q: 0, A: 0, eSlow: null, prev: null, lastAt: 0, integ: 0, m: 1, coh: 0, err: 0, vfc: null,
  };
}

function beatLockFrameEnergy(vid, lock) {
  try {
    const g = beatLockSampler.getContext('2d', { willReadFrequently: true });
    g.drawImage(vid, 0, 0, BEAT_LOCK_W, BEAT_LOCK_H);
    const d = g.getImageData(0, 0, BEAT_LOCK_W, BEAT_LOCK_H).data;
    const luma = new Float32Array(BEAT_LOCK_W * BEAT_LOCK_H);
    for (let p = 0, q = 0; p < d.length; p += 4, q++) luma[q] = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
    const prev = lock.prev;
    lock.prev = luma;
    if (!prev) return null;
    // Movement in the whole frame and in each region.
    return BEAT_LOCK_CELLS.map(([x0, y0, x1, y1]) => {
      let e = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = y * BEAT_LOCK_W + x; e += Math.abs(luma[q] - prev[q]); }
      return e / ((x1 - x0) * (y1 - y0));
    });
  } catch (err) {
    return null;
  }
}

// One callback per frame the video actually presents - no repeated frames.
function beatLockListen(i, lock) {
  const vid = getTileVideo(i);
  if (!vid || typeof vid.requestVideoFrameCallback !== 'function') return;
  const onFrame = (now, meta) => {
    if (beatLocks[i] !== lock || getTileVideo(i) !== vid) return;
    lock.vfc = vid.requestVideoFrameCallback(onFrame);
    if (!rhythmActive() || !contentOn.beatMatch || document.hidden) return;
    const fx = tileSpeedEffects[i];
    if (fx && fx.size) { lock.hist = []; lock.prev = null; lock.lastAt = 0; return; } // slow-mo etc. distort its rhythm
    const cells = beatLockFrameEnergy(vid, lock);
    if (cells == null) return;
    // A repeated frame (footage shot at a lower rate, padded to 30 fps) reads
    // as no movement at all, on a regular pattern - which looked like a
    // rhythm. Skip them; the gap is filled from the frames either side.
    lock.eMean = lock.eMean == null ? cells[0] : lock.eMean + (cells[0] - lock.eMean) * 0.05;
    if (cells[0] < lock.eMean * 0.08) return;
    const t = performance.now();
    lock.hist.push([t, cells]);
    while (lock.hist.length && t - lock.hist[0][0] > BEAT_LOCK_WINDOW_S * 1000) lock.hist.shift();
    if (lock.locked) {
      const dt = lock.lastAt ? Math.min(200, t - lock.lastAt) : 33;
      beatLockDemod(lock, cells[lock.cell], beatPhaseNow(t), dt);
    }
    lock.lastAt = t;
  };
  lock.vfc = vid.requestVideoFrameCallback(onFrame);
}

// The tile's own tempo right now (wall-clock BPM, as it plays) + confidence,
// from the most rhythmic region (or `onlyCell` while locked).
function beatLockMeasure(lock, onlyCell) {
  const h = lock.hist;
  if (h.length < 20 || h[h.length - 1][0] - h[0][0] < BEAT_LOCK_WINDOW_S * 700) return null;
  let best = null;
  const cells = onlyCell != null ? [onlyCell] : BEAT_LOCK_CELLS.map((c, i) => i);
  for (const cell of cells) {
    const m = beatLockMeasureSeries(h, cell);
    if (m && (!best || m.conf > best.conf)) best = Object.assign(m, { cell });
  }
  return best;
}

function beatLockMeasureSeries(h, cell) {
  const xs = [];
  let k = 0;
  for (let t = h[0][0]; t <= h[h.length - 1][0]; t += 1000 / BEAT_LOCK_FS) {
    while (k < h.length - 1 && h[k + 1][0] <= t) k++;
    xs.push(h[k][1][cell]);
  }
  const w = BEAT_LOCK_FS; // remove a 2s moving average - only repetition stays
  const d = xs.map((x, j) => {
    const lo = Math.max(0, j - w), hi = Math.min(xs.length, j + w + 1);
    let s = 0;
    for (let q = lo; q < hi; q++) s += xs[q];
    return x - s / (hi - lo);
  });
  let r0 = 0;
  for (const v of d) r0 += v * v;
  if (r0 <= 1e-9) return null;
  const lo = Math.floor(BEAT_LOCK_FS * 60 / 160), hi = Math.ceil(BEAT_LOCK_FS * 60 / 40);
  const r = {};
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0;
    for (let j = 0; j + lag < d.length; j++) s += d[j] * d[j + lag];
    r[lag] = s / r0;
  }
  let best = lo;
  for (let lag = lo; lag <= hi; lag++) if (r[lag] > r[best]) best = lag;
  if (!(r[best] > r[best - 1] && r[best] >= r[best + 1])) return { bpm: null, conf: Math.max(0, r[best]) };
  const a = r[best - 1], b = r[best], c = r[best + 1];
  const den = a - 2 * b + c;
  const lag = best + (den ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0);
  return { bpm: 60 * BEAT_LOCK_FS / lag, conf: b };
}

// Pure maths on the lock state (unit-testable): one movement sample `e` at
// beat phase `p` (beats), `dtMs` after the last.
function beatLockDemod(lock, e, p, dtMs) {
  const beatMs = 60000 / Math.max(30, currentRhythmBpm());
  lock.eSlow = lock.eSlow == null ? e : lock.eSlow + (e - lock.eSlow) * (1 - Math.exp(-dtMs / 1200));
  const x = e - lock.eSlow;
  const decay = Math.exp(-dtMs / (beatMs * TUNING.BEAT_LOCK_MEMORY_BEATS));
  const ang = 2 * Math.PI * lock.c * p;
  lock.I = lock.I * decay + x * Math.cos(ang);
  lock.Q = lock.Q * decay + x * Math.sin(ang);
  lock.A = lock.A * decay + Math.abs(x);
  lock.coh = lock.A > 1e-9 ? Math.hypot(lock.I, lock.Q) / lock.A : 0; // ~0.64 for a pure rhythm, ~0 for noise
  let err = Math.atan2(lock.Q, lock.I) / (2 * Math.PI) - TUNING.BEAT_MATCH_PHASE;
  err -= Math.round(err);
  lock.err = err; // how late its bursts land, in cycles of its own rhythm
}

function beatLockControl(lock, freqMult, dtMs) {
  const lockedness = Math.max(0, Math.min(1, (lock.coh - 0.12) / 0.2));
  lock.integ = Math.max(-0.04, Math.min(0.04, lock.integ * Math.exp(-dtMs / 20000) + lockedness * lock.err * TUNING.BEAT_LOCK_KI * dtMs / 1000));
  const target = freqMult * (1 + lockedness * (TUNING.BEAT_LOCK_KP * lock.err + lock.integ));
  const max = TUNING.BEAT_MATCH_MAX;
  const clamped = Math.max(1 - max, Math.min(1 + max, target));
  lock.m += (clamped - lock.m) * (1 - Math.exp(-dtMs / 400));
  return lock.m;
}

function beatMatchMult(i) {
  const lock = beatLocks[i];
  return lock && lock.path === currentPaths[i] && lock.locked && !lock.isHero ? lock.m : 1;
}

// Once a second: who to listen to, and lock / unlock from the live tempo.
function beatLockReview() {
  const on = contentOn.beatMatch && rhythmActive() && !document.hidden;
  // Clips Clip DNA thinks are rhythmic first, then the biggest tiles.
  const order = tileElements.map((t, i) => i).sort((x, y) => {
    const dx = contentDna(x), dy = contentDna(y);
    const rx = dx && dx.tempo ? 1 : 0, ry = dy && dy.tempo ? 1 : 0;
    return ry - rx || tileArea(y) - tileArea(x);
  });
  const listen = new Set(on ? order.slice(0, BEAT_LOCK_MAX_TILES) : []);
  const now = Date.now();
  tileElements.forEach((t, i) => {
    let lock = beatLocks[i];
    if (lock && (lock.path !== currentPaths[i] || !listen.has(i))) lock = beatLocks[i] = null;
    if (!listen.has(i) || !currentPaths[i]) return;
    if (!lock) { lock = beatLocks[i] = newBeatLock(currentPaths[i]); beatLockListen(i, lock); return; }
    const meas = beatLockMeasure(lock, lock.locked ? lock.cell : null);
    if (!meas) return;
    lock.conf = meas.conf;
    const strong = meas.bpm && meas.conf >= TUNING.BEAT_LOCK_MIN_CONF;
    if (!lock.locked) {
      // Three steady readings in a row (same region, tempo within 6%) before locking.
      const bpm = strong ? meas.bpm : null;
      const same = bpm && lock.tempos.length && meas.cell === lock.cell && Math.abs(bpm / lock.tempos[lock.tempos.length - 1] - 1) < 0.06;
      lock.tempos = bpm ? (same ? lock.tempos.concat(bpm).slice(-3) : [bpm]) : [];
      lock.cell = meas.cell;
      if (lock.tempos.length < 3) return;
      lock.liveBpm = [...lock.tempos].sort((a, b) => a - b)[1]; // frozen while locked
      const following = rhythmBpmSource === 'content';
      // Following the clips, the beat will come to it: cycles per beat from
      // folding its tempo into 70-140. Otherwise the nearest of half / same /
      // double the current beat, if close enough.
      const beat = following ? foldBpm(lock.liveBpm) : currentRhythmBpm();
      let bestC = 0, bestOff = Infinity;
      for (const c of [0.25, 0.5, 1, 2]) {
        const off = Math.abs((c * beat) / lock.liveBpm - 1);
        if (off < bestOff) { bestC = c; bestOff = off; }
      }
      if (bestOff <= (following ? 0.02 : TUNING.BEAT_MATCH_MAX)) {
        Object.assign(lock, { locked: true, c: bestC, I: 0, Q: 0, A: 0, integ: 0, weakSince: 0, eSlow: null });
      }
    } else {
      if (strong) lock.weakSince = 0;
      else if (!lock.weakSince) lock.weakSince = now;
      else if (now - lock.weakSince > TUNING.BEAT_LOCK_RELEASE_MS) Object.assign(lock, { locked: false, tempos: [], liveBpm: null }); // its rhythm has faded - let it go
    }
  });
  beatLocks.length = tileElements.length;
  pickRhythmLead();
}
setInterval(beatLockReview, 1000);

function foldBpm(bpm) {
  while (bpm < 70) bpm *= 2;
  while (bpm >= 140) bpm /= 2;
  return bpm;
}

// Follow Clips: the most clearly rhythmic locked tile leads the beat. Kept
// while it stays locked (at least CONTENT_HERO_HOLD_MS before another can
// take over, and only if clearly more rhythmic). Real footage rarely holds
// a rhythm for long, so the beat is the steady anchor: a new lead has to be
// within reach of the current beat, unless there's been no lead for a while
// and a clip is clearly rhythmic - only then does the beat retune.
let rhythmLeadLostAt = 0;
function pickRhythmLead() {
  if (rhythmBpmSource !== 'content' || !rhythmActive()) { rhythmLead = -1; return; }
  const beat = currentRhythmBpm();
  const free = rhythmLead < 0 && Date.now() - rhythmLeadLostAt > TUNING.CONTENT_HERO_HOLD_MS;
  const score = (i) => {
    const l = beatLocks[i];
    if (!(l && l.locked && l.path === currentPaths[i] && l.liveBpm)) return -1;
    if (i === rhythmLead) return l.conf;
    const near = Math.abs(foldBpm(l.liveBpm) / beat - 1) <= TUNING.BEAT_MATCH_MAX;
    return near || (free && l.conf >= 0.4) ? l.conf : -1;
  };
  let best = -1;
  beatLocks.forEach((l, i) => { if (score(i) > 0 && (best < 0 || score(i) > score(best))) best = i; });
  const cur = rhythmLead >= 0 && score(rhythmLead) > 0 ? rhythmLead : -1;
  if (cur < 0) {
    if (rhythmLead >= 0) rhythmLeadLostAt = Date.now();
    rhythmLead = best;
    rhythmLeadSince = Date.now();
  }
  else if (best !== cur && best >= 0 && Date.now() - rhythmLeadSince > TUNING.CONTENT_HERO_HOLD_MS && score(best) > score(cur) * 1.3) { rhythmLead = best; rhythmLeadSince = Date.now(); }
  beatLocks.forEach((l, i) => { if (l) l.isHero = i === rhythmLead; });
}

function beatMatchTick(dt) {
  beatLocks.forEach((lock, i) => {
    if (!lock || !lock.locked || !lock.liveBpm) { if (lock) lock.m += (1 - lock.m) * (1 - Math.exp(-dt / 600)); return; }
    if (lock.isHero) {
      // Follow Clips: slide the beat clock toward the lead clip's bursts
      // instead of changing the clip - a few ms per tick at most.
      const lockedness = Math.max(0, Math.min(1, (lock.coh - 0.12) / 0.2));
      const interval = 60000 / Math.max(30, currentRhythmBpm());
      rhythmNextBeatAt += Math.max(-12, Math.min(12, lockedness * (lock.err / lock.c) * interval * 0.08));
      lock.m = 1;
      return;
    }
    beatLockControl(lock, (lock.c * currentRhythmBpm()) / lock.liveBpm, dt);
  });
}

// Tiles whose movement is on the beat right now (for the menu / log).
function beatMatchedCount() {
  return beatLocks.filter((l, i) => l && l.locked && l.path === currentPaths[i] && l.coh > 0.25 && Math.abs(l.err) < 0.12).length;
}

// ---- Visual Tone ----
// The screen breathes with the beat: a soft light over the screens and the
// edge glow swell on each beat with the same shape as the Tone voice
// (quick rise, easing back over a third of the beat), downbeats a bit more.
let beatVeil = null;

// Follow Clips: the tile the beat follows glows softly on each beat.
function rhythmLeadBeat(downbeat) {
  if (rhythmBpmSource !== 'content' || rhythmLead < 0) return;
  const tile = tileElements[rhythmLead];
  if (!tile) return;
  let glow = tile.querySelector('.content-peak-glow');
  if (!glow) { glow = document.createElement('div'); glow.className = 'content-peak-glow'; tile.appendChild(glow); }
  glow.animate([{ opacity: 0 }, { opacity: downbeat ? 0.9 : 0.55, offset: 0.12 }, { opacity: 0 }],
    { duration: Math.min(900, 60000 / Math.max(30, currentRhythmBpm()) * 0.9), easing: 'ease-out' });
}

function visualToneBeat(downbeat) {
  rhythmLeadBeat(downbeat);
  if (!contentOn.visualTone || document.hidden) return;
  if (!beatVeil) {
    const theater = document.getElementById('theater-box');
    if (!theater) return;
    beatVeil = document.createElement('div');
    beatVeil.id = 'beat-veil';
    theater.appendChild(beatVeil);
  }
  const k = TUNING.VISUAL_TONE_STRENGTH * (downbeat ? 1 : 0.65);
  const beatMs = Math.min(1000, 60000 / Math.max(30, currentRhythmBpm()));
  beatVeil.animate([
    { opacity: 0 },
    { opacity: k, offset: Math.min(0.2, 40 / beatMs) },
    { opacity: 0 },
  ], { duration: beatMs * 0.95, easing: 'ease-out' });
  audioGlowKick = Math.max(audioGlowKick, Math.min(0.9, k * 2.6));
}

let contentLastTickAt = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(500, now - contentLastTickAt);
  contentLastTickAt = now;
  contentTick();
  checkPeakCuts();
  beatMatchTick(dt);
}, CONTENT_TICK_MS);

// ---- prefs ----
function loadContentPrefs() {
  const p = loadJsonPref('mm_content', {});
  Object.keys(contentOn).forEach((k) => { if (typeof p[k] === 'boolean') contentOn[k] = p[k]; });
  updateContentUi();
}

function toggleContent(k) {
  contentOn[k] = !contentOn[k];
  saveJsonPref('mm_content', contentOn);
  updateContentUi();
}

function updateContentUi() {
  Object.keys(contentOn).forEach((k) => setToggleBadge('content-' + k + '-toggle', contentOn[k]));
  const el = document.getElementById('content-status');
  if (el) {
    const dna = contentHero >= 0 ? contentDna(contentHero) : null;
    el.innerText = 'Movement now ' + Math.round(contentLevel * 100) + '% (usual ' + Math.round(contentBaseline * 100) + '%)' +
      (contentTempo ? ' · clip rhythm ~' + Math.round(contentTempo) + ' BPM' : dna ? ' · lead clip has no steady rhythm' : '') +
      (rhythmActive() && contentOn.beatMatch ? ' · ' + beatMatchedCount() + ' tile(s) moving in time with the beat' : '');
  }
}
setInterval(() => { if (document.getElementById('content-status')) updateContentUi(); }, 2000);
