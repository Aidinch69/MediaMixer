// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Performance mode: Full, Light, or Auto (the default).
//
// On integrated graphics (most laptops) the full set of effects is too much
// to draw: full-screen layers blended over playing video (film grain, the
// beat veil, edge bleed), canvas copies of tiles (bloom, slow-mo trails,
// split frames, double exposures, stutter, cascade) and SVG filters (RGB
// split, duotone) make the GPU redo the whole screen on every video frame,
// so the videos themselves drop frames and stall. The worst single cost
// measured was the feathered mask on each floater. Light mode leaves those
// out (floaters get rounded corners instead) and keeps everything else. Auto watches dropped frames and switches
// this device to Light if it keeps falling behind - remembered from then on.

const PERF_KEY = 'mm_perf';
const PERF_CHECK_MS = 10000;
const PERF_MIN_FRAMES = 120; // too little played to judge
const PERF_LIGHT_FX = ['prism', 'zoom', 'vhs']; // CSS-only tile effects - no canvas copies or SVG filters
const PERF_LIGHT_FLOATERS = 1;
const PERF_LIGHT_FLOATER_BARRAGE = 4;

let perfMode = 'auto'; // 'auto' | 'full' | 'light'
let perfAutoLight = false; // Auto decided this device needs Light
let perfBadWindows = 0;
let perfLastDropRatio = null;
const perfFrameTotals = {};

function perfLite() {
  return perfMode === 'light' || (perfMode === 'auto' && perfAutoLight);
}

function effectiveFxCount() {
  return perfLite() ? Math.min(fxCount, PERF_LIGHT_FLOATERS) : fxCount;
}

function loadPerfPrefs() {
  const p = loadJsonPref(PERF_KEY, { mode: 'auto', autoLight: false });
  perfMode = ['auto', 'full', 'light'].includes(p.mode) ? p.mode : 'auto';
  perfAutoLight = !!p.autoLight;
  applyPerf();
}

function savePerfPrefs() {
  saveJsonPref(PERF_KEY, { mode: perfMode, autoLight: perfAutoLight });
}

function setPerfMode(mode) {
  perfMode = mode;
  if (mode === 'auto') perfAutoLight = false; // choosing Auto again = measure afresh
  perfBadWindows = 0;
  savePerfPrefs();
  applyPerf();
}

// Puts the current mode into effect right away (effects already running
// finish on their own; new ones follow the mode).
function applyPerf() {
  const lite = perfLite();
  document.body.classList.toggle('perf-light', lite);
  if (typeof applyGrain === 'function') applyGrain();
  if (typeof applyBleed === 'function') applyBleed();
  if (lite && typeof splitFrames !== 'undefined' && splitFrames && typeof endSplitFrames === 'function') endSplitFrames(false);
  if (typeof reconcileFxSpriteCount === 'function' && typeof fxEnabled !== 'undefined' && fxEnabled) reconcileFxSpriteCount();
  if (typeof tileElements !== 'undefined') {
    tileElements.forEach((_t, i) => {
      const v = getTileVideo(i);
      if (v) { lastFilterStr[i] = null; applyTileTensionFilter(i, v); }
    });
  }
  updatePerfUi();
}

function perfCheck() {
  if (document.hidden || typeof tileElements === 'undefined') return;
  let frames = 0, dropped = 0;
  tileElements.forEach((_t, i) => {
    const v = getTileVideo(i);
    if (!v || !v.getVideoPlaybackQuality) return;
    const q = v.getVideoPlaybackQuality();
    const prev = perfFrameTotals[i] || { total: 0, dropped: 0 };
    // The counters restart whenever the tile loads a new clip.
    const restarted = q.totalVideoFrames < prev.total || q.droppedVideoFrames < prev.dropped;
    frames += restarted ? q.totalVideoFrames : q.totalVideoFrames - prev.total;
    dropped += restarted ? q.droppedVideoFrames : q.droppedVideoFrames - prev.dropped;
    perfFrameTotals[i] = { total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
  });
  if (frames < PERF_MIN_FRAMES) return;
  perfLastDropRatio = dropped / frames;
  updatePerfUi();
  if (perfMode !== 'auto' || perfAutoLight) return;
  perfBadWindows = perfLastDropRatio > TUNING.PERF_DROP_LIMIT ? perfBadWindows + 1 : 0;
  if (perfBadWindows < TUNING.PERF_BAD_WINDOWS) return;
  perfAutoLight = true;
  savePerfPrefs();
  if (typeof logEvent === 'function') logEvent('perf.light', { auto: true, dropped: +perfLastDropRatio.toFixed(2) });
  try { applyPerf(); } catch (e) { if (typeof logEvent === 'function') logEvent('perf.error', { msg: String(e) }); }
  toast('⚡ Light mode on - this device was dropping video frames. Change it in Screen → Layout & Pace.');
}

function cyclePerfMode() {
  setPerfMode({ auto: 'full', full: 'light', light: 'auto' }[perfMode] || 'auto');
  toast('⚡ Performance: ' + { auto: 'Auto', full: 'Full', light: 'Light' }[perfMode]);
}

function updatePerfUi() {
  const chip = document.getElementById('np-perf');
  if (chip) {
    chip.textContent = '⚡ ' + (perfMode === 'auto' ? 'Auto · ' + (perfAutoLight ? 'Light' : 'Full') : perfMode === 'full' ? 'Full' : 'Light');
    chip.classList.toggle('np-chip-light', perfLite());
  }
  ['auto', 'full', 'light'].forEach((m) => {
    const b = document.getElementById('perf-' + m);
    if (b) b.classList.toggle('active', perfMode === m);
  });
  const status = document.getElementById('perf-status');
  if (!status) return;
  const drop = perfLastDropRatio == null ? '' : ' · ' + Math.round(perfLastDropRatio * 100) + '% of frames dropped lately';
  status.innerText = (perfMode === 'auto'
    ? (perfAutoLight ? 'Auto: Light on this device (it was dropping frames)' : 'Auto: full effects - watching for dropped frames')
    : perfMode === 'light' ? 'Light: heavy effects off' : 'Full: every effect on') + drop;
}

setInterval(perfCheck, PERF_CHECK_MS);
