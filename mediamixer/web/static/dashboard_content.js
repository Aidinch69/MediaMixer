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

const contentOn = { energy: true, peaks: true, peakCuts: true };
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
  let heroScore = -1, hero = -1;
  const vals = [];
  tileElements.forEach((t, i) => {
    const v = tileContentLevel(i);
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
  if (contentHero < 0) return null;
  const dna = contentDna(contentHero);
  const vid = getTileVideo(contentHero);
  if (!dna || !vid) return null;
  let bpm = null;
  if (dna.tempo_track) {
    const t = vid.currentTime;
    const w = dna.tempo_track.filter((x) => x[1] && x[0] <= t && t <= x[0] + 8).sort((a, b) => b[2] - a[2])[0];
    if (w) bpm = w[1];
  }
  bpm = bpm || dna.tempo;
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

setInterval(() => { contentTick(); checkPeakCuts(); }, CONTENT_TICK_MS);

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
      (contentTempo ? ' · clip rhythm ~' + Math.round(contentTempo) + ' BPM' : dna ? ' · lead clip has no steady rhythm' : '');
  }
}
setInterval(() => { if (document.getElementById('content-status')) updateContentUi(); }, 2000);
