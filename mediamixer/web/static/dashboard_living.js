// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Living Screen: breathing tiles, slow-motion moments, double exposure, and
// spirals that react to the audio.

let livingBreathe = true;
let livingSlowmo = true;
let livingDouble = true;
let livingSpiralAudio = true;

// ---- Breathing tiles ----
// Every tile's video drifts and zooms a few percent on its own slow cycle
// (a Ken Burns move that never repeats in step with its neighbours), and
// the cycle runs faster or slower with the Shared Pulse energy. Driven by
// CSS variables on the tile, so it composes with the other effects' own
// transforms (zoom kicks, VHS jitter) rather than fighting them.
const breathePhase = []; // per tile: radians along its own cycle
const breatheShape = []; // per tile: { rate, ax, ay, phaseOffset }
let breatheLastAt = performance.now();

function breatheShapeFor(i) {
  if (!breatheShape[i]) {
    breatheShape[i] = {
      rate: 0.75 + Math.random() * 0.5, // each tile slightly faster/slower
      ax: Math.random() * Math.PI * 2, ay: Math.random() * Math.PI * 2,
      dir: Math.random() < 0.5 ? -1 : 1,
    };
    breathePhase[i] = Math.random() * Math.PI * 2;
  }
  return breatheShape[i];
}

setInterval(() => {
  const now = performance.now();
  const dt = Math.min(200, now - breatheLastAt);
  breatheLastAt = now;
  const on = livingBreathe && !document.hidden;
  tileElements.forEach((tile, i) => {
    if (!tile) return;
    tile.classList.toggle('breathing', on);
    if (!on) return;
    const sh = breatheShapeFor(i);
    breathePhase[i] += (dt / TUNING.BREATHE_PERIOD_MS) * Math.PI * 2 * sh.rate * (sharedPulseEnabled ? rhythmDrive : 1);
    const p = breathePhase[i];
    const zoom = 1 + TUNING.BREATHE_ZOOM * (0.5 + 0.5 * Math.sin(p));
    const drift = TUNING.BREATHE_DRIFT * 100;
    tile.style.setProperty('--kb-s', zoom.toFixed(4));
    tile.style.setProperty('--kb-x', (Math.sin(p * 0.7 + sh.ax) * drift * sh.dir).toFixed(3) + '%');
    tile.style.setProperty('--kb-y', (Math.cos(p * 0.5 + sh.ay) * drift).toFixed(3) + '%');
  });
}, 50);

// ---- Slow-motion moments ----
// Built to read as deliberate, never as buffering: the speed eases down
// and back (never a freeze), the tile gets a motion-trail ghost, a soft
// push-in and vignette, and it only starts when the clip has several
// seconds already buffered, so a real stall can't coincide with it.
let slowmoTileIndex = -1;
let slowmoLastAt = 0;
const SLOWMO_CHECK_MS = 6000;

function slowmoBufferedAhead(vid) {
  try {
    for (let k = 0; k < vid.buffered.length; k++) {
      if (vid.buffered.start(k) <= vid.currentTime && vid.currentTime <= vid.buffered.end(k)) return vid.buffered.end(k) - vid.currentTime;
    }
  } catch (e) {}
  return 0;
}

function maybeTriggerSlowmo() {
  if (!livingSlowmo || slowmoTileIndex >= 0 || document.hidden || !tileElements.length) return;
  if (Date.now() - slowmoLastAt < TUNING.SLOWMO_COOLDOWN_MS) return;
  const energetic = rhythmDrive >= TUNING.SLOWMO_ENERGY_MIN || Date.now() - lastAnyPayoffAt < 6000;
  if (!energetic || floaterBarrageActive || finaleActive || spotlightTileIndex >= 0) return;
  if (Math.random() >= TUNING.SLOWMO_PROBABILITY) return;
  const busy = new Set([sealedTileIndex, bonusWindowTileIndex, chaseFlashTileIndex, mysteryTileIndex]);
  const candidates = tileElements.map((t, i) => i).filter((i) => !busy.has(i) && !pendingCuts[i]);
  const ready = candidates.filter((i) => { const v = getTileVideo(i); return v && v.readyState >= 3 && !v.paused && slowmoBufferedAhead(v) >= 4; });
  if (ready.length) startSlowmo(ready[Math.floor(Math.random() * ready.length)]);
}
setInterval(maybeTriggerSlowmo, SLOWMO_CHECK_MS);

function startSlowmo(idx) {
  const tile = tileElements[idx];
  const vid = getTileVideo(idx);
  if (!tile || !vid) return false;
  slowmoTileIndex = idx;
  slowmoLastAt = Date.now();
  const inMs = 700, holdMs = TUNING.SLOWMO_HOLD_MS, outMs = 900;
  const total = inMs + holdMs + outMs;
  setTimelineSpeedEffect(idx, vid, 'slowmo', SPEED_PRIORITY.slowmo, TUNING.SLOWMO_SPEED, inMs, holdMs, outMs, tileNaturalBase[idx] * globalSpeedMult());
  tile.classList.add('fx-slowmo');
  // Motion-trail ghost: frames drawn over each other without clearing, so
  // movement leaves soft trails behind it.
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-slowmo-trail';
  tile.insertBefore(canvas, vid.nextSibling);
  const g = canvas.getContext('2d');
  const start = performance.now();
  let last = 0;
  function draw(ts) {
    const elapsed = ts - start;
    if (!canvas.isConnected || elapsed >= total) {
      canvas.remove();
      tile.classList.remove('fx-slowmo');
      tile.style.removeProperty('--slowmo-k');
      slowmoTileIndex = -1;
      return;
    }
    requestAnimationFrame(draw);
    const k = fxEnvelope(elapsed, total);
    tile.style.setProperty('--slowmo-k', k.toFixed(3));
    canvas.style.opacity = (0.6 * k).toFixed(3);
    if (ts - last < 40) return;
    last = ts;
    const w = Math.max(1, Math.round(tile.clientWidth / 2)), h = Math.max(1, Math.round(tile.clientHeight / 2));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const vw = vid.videoWidth, vh = vid.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(w / vw, h / vh);
    g.globalAlpha = 0.28;
    g.drawImage(vid, (w - vw * scale) / 2, (h - vh * scale) / 2, vw * scale, vh * scale);
  }
  requestAnimationFrame(draw);
  return true;
}

// ---- Double exposure ----
// A second clip fades in over one tile as a light-blended overlay, holds a
// few seconds, then separates. Revealed only once it's actually playing.
let doubleExposureTileIndex = -1;
let doubleExposureLastAt = 0;
const DOUBLE_EXPOSURE_CHECK_MS = 30000;
const DOUBLE_EXPOSURE_FADE_IN_MS = 2000;
const DOUBLE_EXPOSURE_FADE_OUT_MS = 2500;

function maybeTriggerDoubleExposure() {
  if (!livingDouble || doubleExposureTileIndex >= 0 || document.hidden || !tileElements.length) return;
  if (Date.now() - doubleExposureLastAt < TUNING.DOUBLE_EXPOSURE_COOLDOWN_MS) return;
  if (floaterBarrageActive || finaleActive || spotlightTileIndex >= 0 || lastKnownBarrage > 0) return;
  if (Math.random() >= TUNING.DOUBLE_EXPOSURE_PROBABILITY) return;
  const busy = new Set([sealedTileIndex, bonusWindowTileIndex, chaseFlashTileIndex, mysteryTileIndex, slowmoTileIndex]);
  const candidates = tileElements.map((t, i) => i).filter((i) => !busy.has(i));
  if (candidates.length) startDoubleExposure(candidates[Math.floor(Math.random() * candidates.length)]);
}
setInterval(maybeTriggerDoubleExposure, DOUBLE_EXPOSURE_CHECK_MS);

function startDoubleExposure(idx) {
  const tile = tileElements[idx];
  const vid = getTileVideo(idx);
  if (!tile || !vid || doubleExposureTileIndex >= 0) return false;
  doubleExposureTileIndex = idx;
  doubleExposureLastAt = Date.now();
  fetchFxList('library').then((items) => {
    const onScreen = new Set(currentPaths);
    const pool = (items || []).filter((it) => !onScreen.has(it.path));
    if (!pool.length || !tile.isConnected) { doubleExposureTileIndex = -1; return; }
    const item = pool[Math.floor(Math.random() * pool.length)];
    const over = document.createElement('video');
    over.className = 'fx-double-exposure';
    over.muted = true; over.loop = true; over.playsInline = true;
    tile.insertBefore(over, vid.nextSibling);
    const ms = TUNING.DOUBLE_EXPOSURE_MS;
    let start = null;
    const finish = () => { over.pause(); over.removeAttribute('src'); over.load(); over.remove(); doubleExposureTileIndex = -1; };
    over.addEventListener('playing', () => {
      if (start !== null) return;
      start = performance.now();
      const step = (ts) => {
        const elapsed = ts - start;
        if (!over.isConnected || elapsed >= ms) { finish(); return; }
        // Slow in, slow out - a second clip appearing should drift into
        // view, not pop (the shared FX envelope's 0.4s fade-in is too quick).
        const fadeIn = Math.min(1, elapsed / DOUBLE_EXPOSURE_FADE_IN_MS);
        const fadeOut = Math.min(1, (ms - elapsed) / DOUBLE_EXPOSURE_FADE_OUT_MS);
        const k = fxSmoothstep(Math.max(0, fadeIn)) * fxSmoothstep(Math.max(0, fadeOut));
        over.style.opacity = (k * TUNING.DOUBLE_EXPOSURE_OPACITY).toFixed(3);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    over.addEventListener('loadedmetadata', () => { if (isFinite(over.duration)) over.currentTime = Math.random() * over.duration * 0.5; });
    over.src = mediaOrigin(idx + 50) + item.base + item.path;
    over.play().catch(() => {});
    setTimeout(() => { if (start === null && over.isConnected) finish(); }, 8000); // never loaded - give up quietly
  });
  return true;
}

// ---- Spirals react to the audio ----
// Hits in what you're hearing give the spirals a quick swell, on top of the
// Shared Pulse's downbeat brighten.
let spiralAudioLastAt = 0;
onAudioOnset((strength) => {
  if (!livingSpiralAudio || !audioReactEnabled) return;
  const now = performance.now();
  if (now - spiralAudioLastAt < 180) return;
  spiralAudioLastAt = now;
  spiralLayers().forEach((el) => {
    if (parseFloat(getComputedStyle(el).opacity) < 0.02 || !el.animate) return;
    const b = 1 + Math.min(0.5, 0.15 + strength * 0.35);
    el.animate([{ filter: 'brightness(' + b.toFixed(2) + ')' }, { filter: 'brightness(1)' }], { duration: 320, easing: 'ease-out' });
  });
});

// ---- prefs / UI ----
function loadLivingPrefs() {
  const p = loadJsonPref('mm_living', { breathe: true, slowmo: true, double: true, spiralAudio: true });
  livingBreathe = p.breathe !== false;
  livingSlowmo = p.slowmo !== false;
  livingDouble = p.double !== false;
  livingSpiralAudio = p.spiralAudio !== false;
  updateLivingUi();
}

function saveLivingPrefs() {
  saveJsonPref('mm_living', { breathe: livingBreathe, slowmo: livingSlowmo, double: livingDouble, spiralAudio: livingSpiralAudio });
  updateLivingUi();
}

function toggleLiving(which) {
  if (which === 'breathe') livingBreathe = !livingBreathe;
  else if (which === 'slowmo') livingSlowmo = !livingSlowmo;
  else if (which === 'double') livingDouble = !livingDouble;
  else if (which === 'spiralAudio') livingSpiralAudio = !livingSpiralAudio;
  saveLivingPrefs();
}

function updateLivingUi() {
  setToggleBadge('living-breathe-toggle', livingBreathe);
  setToggleBadge('living-slowmo-toggle', livingSlowmo);
  setToggleBadge('living-double-toggle', livingDouble);
  setToggleBadge('living-spiral-audio-toggle', livingSpiralAudio);
}
