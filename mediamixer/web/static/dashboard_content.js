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
// A clip's own rhythm at its current position: the most confident DNA
// tempo window covering it, else its overall tempo (null = no steady rhythm).
function clipTempoAt(i) {
  const dna = contentDna(i);
  const vid = getTileVideo(i);
  if (!dna || !vid) return null;
  if (dna.tempo_track) {
    const t = vid.currentTime;
    const w = dna.tempo_track.filter((x) => x[1] && x[0] <= t && t <= x[0] + 8).sort((a, b) => b[2] - a[2])[0];
    if (w) return w[1];
  }
  return dna.tempo || null;
}

function contentHeroBpm() {
  if (contentHero < 0) return null;
  let bpm = clipTempoAt(contentHero);
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

// ---- Beat-matching ----
// While Rhythm Mode runs, clips with a steady rhythm of their own are nudged
// a few percent faster or slower so their movement falls in time with the
// beat (or twice / half as fast - whichever is nearest). Only when it's a
// small nudge (TUNING.BEAT_MATCH_MAX); a clip far off the beat is left
// alone rather than visibly sped up. Glided, so it's never a jump.
const beatMatch = []; // tile -> { path, m }

function beatMatchMult(i) {
  const b = beatMatch[i];
  return b && b.path === currentPaths[i] ? b.m : 1;
}

function beatMatchTarget(i) {
  if (!contentOn.beatMatch || !rhythmActive()) return 1;
  const clipBpm = clipTempoAt(i);
  if (!clipBpm) return 1;
  // How fast its rhythm plays right now, before any beat-match nudge.
  const playing = clipBpm * (tileNaturalBase[i] || 1) * globalSpeedMult();
  const beat = currentRhythmBpm();
  // The nudge to the nearest of half / same / double the beat, if it's small.
  const m = [0.5, 1, 2].map((k) => (beat * k) / playing).sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1))[0];
  return Math.abs(m - 1) <= TUNING.BEAT_MATCH_MAX ? m : 1;
}

function beatMatchTick(dt) {
  tileElements.forEach((t, i) => {
    const path = currentPaths[i];
    let b = beatMatch[i];
    if (!b || b.path !== path) b = beatMatch[i] = { path, m: 1 };
    const target = beatMatchTarget(i);
    b.m += (target - b.m) * (1 - Math.exp(-dt / 1500));
    if (Math.abs(b.m - 1) < 0.001 && target === 1) b.m = 1;
  });
  beatMatch.length = tileElements.length;
}

// How many tiles are locked to the beat right now (for the menu / log).
function beatMatchedCount() {
  return beatMatch.filter((b, i) => b && b.path === currentPaths[i] && Math.abs(b.m - 1) > 0.002).length;
}

// ---- Visual Tone ----
// The screen breathes with the beat: a soft light over the screens and the
// edge glow swell on each beat with the same shape as the Tone voice
// (quick rise, easing back over a third of the beat), downbeats a bit more.
let beatVeil = null;

function visualToneBeat(downbeat) {
  if (!contentOn.visualTone || perfLite() || document.hidden) return;
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
