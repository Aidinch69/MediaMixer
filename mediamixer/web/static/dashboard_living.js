// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Living Screen: breathing tiles, slow-motion moments, double exposure,
// spirals that react to the audio, and Clip DNA's Gradient moment.

let livingBreathe = true;
let livingSmartFraming = true;
const framingPan = []; // per tile: smoothed { x, y } pan toward the action, in % of the tile
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
  const on = (livingBreathe || livingSmartFraming) && !document.hidden;
  tileElements.forEach((tile, i) => {
    if (!tile) return;
    tile.classList.toggle('breathing', on);
    if (!on) return;
    const sh = breatheShapeFor(i);
    breathePhase[i] += (dt / TUNING.BREATHE_PERIOD_MS) * Math.PI * 2 * sh.rate * (sharedPulseEnabled ? rhythmDrive : 1);
    const p = breathePhase[i];
    let zoom = 1, x = 0, y = 0;
    if (livingBreathe) {
      zoom += TUNING.BREATHE_ZOOM * (0.5 + 0.5 * Math.sin(p));
      const drift = TUNING.BREATHE_DRIFT * 100;
      x = Math.sin(p * 0.7 + sh.ax) * drift * sh.dir;
      y = Math.cos(p * 0.5 + sh.ay) * drift;
    }
    const pan = smartFramingPan(i, dt);
    if (pan) {
      zoom += TUNING.SMART_FRAMING_ZOOM;
      const room = (zoom - 1) / 2 * 100; // how far it can pan before an edge shows
      x = Math.max(-room, Math.min(room, x + pan.x * room));
      y = Math.max(-room, Math.min(room, y + pan.y * room));
    }
    tile.style.setProperty('--kb-s', zoom.toFixed(4));
    tile.style.setProperty('--kb-x', x.toFixed(3) + '%');
    tile.style.setProperty('--kb-y', y.toFixed(3) + '%');
  });
}, 50);

// ---- Smart framing ----
// Clip DNA's motion track says where in the frame things are moving, every
// 2 seconds. The tile pans gently toward it (and zooms a touch to have room),
// glided over ~2s so it reads like a slow camera operator, not a jolt.
// Returns the pan as -1..1 of the available room, or null when off/unknown.
function smartFramingPan(i, dt) {
  if (!livingSmartFraming) { framingPan[i] = null; return null; }
  const meta = videoMetaCache[currentPaths[i]];
  const track = meta && meta.dna && meta.dna.track;
  const vid = getTileVideo(i);
  if (!track || !track.length || !vid) return framingPan[i] || null;
  const k = Math.max(0, Math.min(track.length - 1, Math.floor((vid.currentTime || 0) / 2)));
  const [, motion, cx, cy] = track[k];
  // Little movement = no clear subject: drift back toward centre.
  const sure = Math.min(1, motion / 0.03);
  const tx = Math.max(-1, Math.min(1, (0.5 - cx) * 2 * sure)) * TUNING.SMART_FRAMING_STRENGTH;
  const ty = Math.max(-1, Math.min(1, (0.5 - cy) * 2 * sure)) * TUNING.SMART_FRAMING_STRENGTH;
  const cur = framingPan[i] || { x: 0, y: 0 };
  const a = 1 - Math.exp(-dt / 2000);
  framingPan[i] = { x: cur.x + (tx - cur.x) * a, y: cur.y + (ty - cur.y) * a };
  return framingPan[i];
}

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
  const similar = livingDoubleMatch && currentPaths[idx]
    ? fetch('/api/dna/similar?n=10&path=' + encodeURIComponent(currentPaths[idx])).then((r) => r.json()).then((d) => d.items || []).catch(() => [])
    : Promise.resolve([]);
  similar.then((matched) => (matched.length ? matched : fetchFxList('library'))).then((items) => {
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

// ---- Clip DNA: Gradient moment ----
// The grid fills with clips spread evenly along one trait - dark -> light,
// cool -> warm, or calm -> wild - lowest in the first tile. With Rhythm
// Mode on, the tiles reveal one per beat so the gradient sweeps across.
const GRADIENT_KINDS = {
  brightness: '🎨 Gradient · dark → light',
  warmth: '🎨 Gradient · cool → warm',
  motion: '🎨 Gradient · calm → wild',
};
const GRADIENT_CHECK_MS = 45000;
let livingGradient = true;
let livingDoubleMatch = true;
let gradientLastAt = 0;
let gradientCascadeUntil = 0; // while set, Cut on the Beat reveals one tile per beat

function maybeTriggerGradient() {
  if (!livingGradient || document.hidden || !tileElements.length || tileElements.length < 4) return;
  if (Date.now() - gradientLastAt < TUNING.GRADIENT_COOLDOWN_MS) return;
  if (floaterBarrageActive || finaleActive || spotlightTileIndex >= 0 || lastKnownBarrage > 0 || anticipationActive) return;
  if (Math.random() >= TUNING.GRADIENT_PROBABILITY) return;
  const kinds = Object.keys(GRADIENT_KINDS);
  startGradient(kinds[Math.floor(Math.random() * kinds.length)]);
}
setInterval(maybeTriggerGradient, GRADIENT_CHECK_MS);

function startGradient(metric) {
  gradientLastAt = Date.now();
  // Cascade mode goes on before asking: the status push carrying the new
  // clips can arrive ahead of this reply, and must already reveal one per beat.
  flushPendingCuts(false); // anything already waiting goes now, not mixed into the sweep
  if (cutOnBeatActive()) gradientCascadeUntil = Date.now() + 60000 / Math.max(40, currentRhythmBpm()) * (tileElements.length + 2) + 3000;
  return fetch('/api/dna/gradient?metric=' + metric + '&hold=' + Math.round(TUNING.GRADIENT_HOLD_MS / 1000)).then((r) => r.json()).then((d) => {
    if (!d.ok || !d.placed) { gradientCascadeUntil = 0; if (d.reason) toast('🎨 ' + d.reason, true); return false; }
    toast(GRADIENT_KINDS[metric] || '🎨 Gradient');
    const sweep = document.createElement('div');
    sweep.className = 'gradient-sweep';
    document.getElementById('theater-box').appendChild(sweep);
    sweep.addEventListener('animationend', () => sweep.remove());
    return true;
  }).catch(() => false);
}

// ---- Clip DNA: report the session energy so picks can lean with it ----
let dnaEnergySentAt = 0;
let dnaEnergySent = 1;
setInterval(() => {
  const now = Date.now();
  if (Math.abs(rhythmDrive - dnaEnergySent) < 0.02 && now - dnaEnergySentAt < 30000) return;
  dnaEnergySent = rhythmDrive;
  dnaEnergySentAt = now;
  fetch('/api/energy?e=' + rhythmDrive.toFixed(3)).catch(() => {});
}, 5000);

function updateDnaStatus() {
  const el = document.getElementById('dna-status');
  if (!el) return;
  fetch('/api/dna/status').then((r) => r.json()).then((d) => {
    const pct = d.total ? Math.round(d.analysed / d.total * 100) : 0;
    el.innerText = d.analysed >= d.total - d.failed
      ? '🧬 All ' + d.analysed.toLocaleString() + ' clips analysed' + (d.failed ? ' (' + d.failed + ' couldn’t be read)' : '')
      : '🧬 Analysing in the background: ' + d.analysed.toLocaleString() + ' / ' + d.total.toLocaleString() + ' (' + pct + '%)' + (d.running ? '' : ' - paused');
  }).catch(() => {});
}
setInterval(updateDnaStatus, 10000);

// ---- Colour mood ----
// The ambient colour follows what's on screen: the average warmth of the
// visible clips (from Clip DNA) tints the screen-edge glow, warms or cools
// Light Leaks, and steers Duotone toward matching palettes - glided over
// several seconds. Payoff flashes keep the rotating jackpot themes.
const MOOD_STOPS = [ // warmth 0 (cool) .. 1 (warm)
  [0, [70, 150, 255]], // azure
  [0.5, [190, 95, 255]], // violet
  [1, [255, 135, 60]], // amber
];
let livingColorMood = true;
let moodWarmth = 0.5; // 0 cool .. 1 warm, smoothed

function moodTargetWarmth() {
  const ws = currentPaths.map((p) => (videoMetaCache[p] && videoMetaCache[p].dna ? videoMetaCache[p].dna.warmth : null)).filter((w) => w != null);
  if (!ws.length) return null;
  const avg = ws.reduce((a, b) => a + b, 0) / ws.length;
  return Math.max(0, Math.min(1, (avg - 0.06) / 0.18)); // library p10..p90 warmth -> 0..1
}

function moodRgb(t) {
  for (let k = 1; k < MOOD_STOPS.length; k++) {
    const [t0, c0] = MOOD_STOPS[k - 1], [t1, c1] = MOOD_STOPS[k];
    if (t <= t1) { const f = (t - t0) / (t1 - t0); return c0.map((v, i) => Math.round(v + (c1[i] - v) * f)); }
  }
  return MOOD_STOPS[MOOD_STOPS.length - 1][1];
}

setInterval(() => {
  const root = document.documentElement.style;
  if (!livingColorMood) { root.removeProperty('--mood-glow'); return; }
  const target = moodTargetWarmth();
  if (target == null) return;
  moodWarmth += (target - moodWarmth) * 0.12; // ~8s glide at this 500ms tick
  root.setProperty('--mood-glow', moodRgb(moodWarmth).join(','));
}, 500);

// Duotone palette that suits the mood: warm themes over warm clips, cool over cool.
const MOOD_WARM_THEMES = [0, 4]; // ember, rose
const MOOD_COOL_THEMES = [1, 2, 3]; // violet, emerald, azure
function moodDuotoneTheme() {
  if (!livingColorMood || Math.random() < 0.25) return COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)]; // keep some surprise
  const pool = moodWarmth >= 0.5 ? MOOD_WARM_THEMES : MOOD_COOL_THEMES;
  return COLOR_THEMES[pool[Math.floor(Math.random() * pool.length)]];
}

// Light Leak hue nudge: warmer over warm clips, cooler (pinker/violet) over cool ones.
function moodLeakHueDeg() {
  return livingColorMood ? Math.round((0.5 - moodWarmth) * 50) : 0;
}

// ---- prefs / UI ----
function loadLivingPrefs() {
  const p = loadJsonPref('mm_living', { breathe: true, slowmo: true, double: true, spiralAudio: true, gradient: true, doubleMatch: true, colorMood: true, smartFraming: true });
  livingBreathe = p.breathe !== false;
  livingSlowmo = p.slowmo !== false;
  livingDouble = p.double !== false;
  livingSpiralAudio = p.spiralAudio !== false;
  livingGradient = p.gradient !== false;
  livingDoubleMatch = p.doubleMatch !== false;
  livingColorMood = p.colorMood !== false;
  livingSmartFraming = p.smartFraming !== false;
  updateLivingUi();
  updateDnaStatus();
}

function saveLivingPrefs() {
  saveJsonPref('mm_living', { breathe: livingBreathe, slowmo: livingSlowmo, double: livingDouble, spiralAudio: livingSpiralAudio, gradient: livingGradient, doubleMatch: livingDoubleMatch, colorMood: livingColorMood, smartFraming: livingSmartFraming });
  updateLivingUi();
}

function toggleLiving(which) {
  if (which === 'breathe') livingBreathe = !livingBreathe;
  else if (which === 'slowmo') livingSlowmo = !livingSlowmo;
  else if (which === 'double') livingDouble = !livingDouble;
  else if (which === 'spiralAudio') livingSpiralAudio = !livingSpiralAudio;
  else if (which === 'gradient') livingGradient = !livingGradient;
  else if (which === 'doubleMatch') livingDoubleMatch = !livingDoubleMatch;
  else if (which === 'colorMood') livingColorMood = !livingColorMood;
  else if (which === 'smartFraming') livingSmartFraming = !livingSmartFraming;
  saveLivingPrefs();
}

function updateLivingUi() {
  setToggleBadge('living-breathe-toggle', livingBreathe);
  setToggleBadge('living-slowmo-toggle', livingSlowmo);
  setToggleBadge('living-double-toggle', livingDouble);
  setToggleBadge('living-spiral-audio-toggle', livingSpiralAudio);
  setToggleBadge('dna-gradient-toggle', livingGradient);
  setToggleBadge('dna-match-toggle', livingDoubleMatch);
  setToggleBadge('living-mood-toggle', livingColorMood);
  setToggleBadge('living-framing-toggle', livingSmartFraming);
}
