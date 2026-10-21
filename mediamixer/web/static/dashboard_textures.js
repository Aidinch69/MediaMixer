// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Visual Textures: Split frames (one tile shows its clip at 2 or 4 moments
// at once), Film grain & dust (stronger when things are calm), and Edge
// bleed (each tile's colour glows into the gaps around it).

const texturesOn = { split: true, grain: true, bleed: true };

// ---- Split frames ----
// Panes are copies of the tile's own clip, each at a different point in it,
// clipped to their part of the tile. Nothing is shown until every copy is
// positioned and buffered, so it never looks like a stall - if they aren't
// ready in time the split is quietly dropped.
let splitFrames = null; // { idx, copies, lines, timer }
let splitLastAt = 0;
const SPLIT_READY_TIMEOUT_MS = 3000;

function splitPanes(tile, count) {
  // A wide tile splits side by side; a tall one top and bottom; 4 = quarters.
  if (count >= 4) return ['inset(0 50% 50% 0)', 'inset(0 0 50% 50%)', 'inset(50% 50% 0 0)', 'inset(50% 0 0 50%)'];
  return tile.clientWidth >= tile.clientHeight ? ['inset(0 50% 0 0)', 'inset(0 0 0 50%)'] : ['inset(0 0 50% 0)', 'inset(50% 0 0 0)'];
}

function startSplitFrames(idx, count) {
  if (splitFrames) return false;
  if (idx == null || idx < 0) {
    const busy = rhythmFxBusyTiles();
    const free = tileElements.map((t, i) => i).filter((i) => !busy.has(i) && getTileVideo(i) && getTileVideo(i).duration >= 8);
    if (!free.length) return false;
    idx = free[Math.floor(Math.random() * free.length)];
  }
  const tile = tileElements[idx];
  const vid = getTileVideo(idx);
  const path = currentPaths[idx];
  if (!tile || !vid || !path || !(vid.duration >= 8)) return false;
  count = count || (tile.clientWidth * tile.clientHeight > 250000 && Math.random() < 0.5 ? 4 : 2);
  splitLastAt = Date.now();
  const panes = splitPanes(tile, count);
  const dur = vid.duration;
  const t0 = vid.currentTime;
  const url = mediaOrigin(idx) + '/media/' + path + '?tiles=' + tileElements.length + '&cors=1'; // the tile's own URL, so it's cached
  const fit = getComputedStyle(vid).objectFit;
  // Pane 0 is the tile itself; the others jump ahead through the clip.
  const copies = panes.slice(1).map((clip, k) => {
    const el = document.createElement('video');
    el.className = 'fx-split';
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.loop = true;
    el.style.clipPath = clip;
    el.style.objectFit = fit;
    const at = (t0 + ((k + 1) * dur) / panes.length) % Math.max(1, dur - 0.5);
    const copy = { el, ready: false };
    el.addEventListener('loadedmetadata', () => { el.currentTime = at; }, { once: true });
    const checkReady = () => { if (el.readyState >= 3 && Math.abs(el.currentTime - at) < 0.5) copy.ready = true; };
    el.addEventListener('seeked', checkReady);
    el.addEventListener('canplay', checkReady);
    el.addEventListener('canplaythrough', checkReady);
    el.src = url;
    tile.insertBefore(el, vid.nextSibling);
    return copy;
  });
  const lines = document.createElement('div');
  lines.className = 'split-lines split-' + (count >= 4 ? 'quad' : tile.clientWidth >= tile.clientHeight ? 'cols' : 'rows');
  tile.appendChild(lines);
  splitFrames = { idx, copies, lines, path, shown: false, timer: null };
  const waitStart = Date.now();
  const waitReady = () => {
    if (!splitFrames || splitFrames.copies !== copies) return;
    if (currentPaths[idx] !== path) { endSplitFrames(true); return; }
    if (!copies.every((c) => c.ready)) {
      if (Date.now() - waitStart > SPLIT_READY_TIMEOUT_MS) { endSplitFrames(true); return; }
      setTimeout(waitReady, 100);
      return;
    }
    copies.forEach((c) => { c.el.playbackRate = vid.playbackRate || 1; c.el.play().catch(() => {}); c.el.classList.add('shown'); });
    lines.classList.add('shown');
    splitFrames.shown = true;
    fetch('/api/hold?screen=' + idx + '&s=' + Math.ceil(TUNING.SPLIT_MS / 1000 + 1)).catch(() => {});
    splitFrames.timer = setTimeout(() => endSplitFrames(false), TUNING.SPLIT_MS);
  };
  waitReady();
  return true;
}

function endSplitFrames(instant) {
  if (!splitFrames) return;
  const { copies, lines, timer } = splitFrames;
  clearTimeout(timer);
  splitFrames = null;
  copies.forEach((c) => c.el.classList.remove('shown'));
  lines.classList.remove('shown');
  setTimeout(() => {
    copies.forEach((c) => { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.el.remove(); });
    lines.remove();
  }, instant ? 0 : 450);
}

setInterval(() => {
  if (splitFrames && currentPaths[splitFrames.idx] !== splitFrames.path) { endSplitFrames(true); return; }
  if (!texturesOn.split || perfLite() || splitFrames || document.hidden || anticipationActive || floaterBarrageActive || finaleActive || cascade) return;
  if (typeof activeMoment !== 'undefined' && activeMoment) return;
  if (Date.now() - splitLastAt < TUNING.SPLIT_COOLDOWN_MS || tileElements.length < 2) return;
  if (Math.random() < TUNING.SPLIT_CHANCE * windDownOddsMult()) startSplitFrames();
}, 15000);

// ---- Film grain & dust ----
// How calm things are right now: Vault zone, a Drift session, a wind-down.
function textureCalm() {
  let k = 0;
  if (typeof autopilotZone !== 'undefined' && autopilotEnabled && autopilotZone === 'vault') k = 1;
  if (typeof sessionIntentKey !== 'undefined' && sessionIntentKey === 'drift') k = Math.max(k, 1);
  if (typeof windDownK === 'function') k = Math.max(k, windDownK());
  if (typeof breathBandUntil !== 'undefined' && Date.now() < breathBandUntil) k = Math.max(k, 0.7);
  return k;
}

let grainEl = null;
let dustCanvas = null;
let grainTimer = null;

function makeNoiseTile(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

function ensureGrainLayers() {
  const theater = document.getElementById('theater-box');
  if (!theater) return false;
  if (!grainEl) {
    grainEl = document.createElement('div');
    grainEl.id = 'film-grain';
    grainEl.style.backgroundImage = 'url(' + makeNoiseTile(192) + ')';
    theater.appendChild(grainEl);
  }
  if (!dustCanvas) {
    dustCanvas = document.createElement('canvas');
    dustCanvas.id = 'film-dust';
    theater.appendChild(dustCanvas);
  }
  return true;
}

function grainFrame() {
  if (!grainEl || document.hidden) return;
  const calm = textureCalm();
  const strength = TUNING.GRAIN_OPACITY * (1 + (TUNING.GRAIN_CALM_BOOST - 1) * calm);
  grainEl.style.opacity = strength.toFixed(3);
  grainEl.style.backgroundPosition = Math.floor(Math.random() * 192) + 'px ' + Math.floor(Math.random() * 192) + 'px';
  // Dust: a few specks and the odd hair, each for a frame or two.
  const w = dustCanvas.clientWidth, h = dustCanvas.clientHeight;
  if (dustCanvas.width !== w || dustCanvas.height !== h) { dustCanvas.width = w; dustCanvas.height = h; }
  const g = dustCanvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  const rate = TUNING.DUST_RATE * (1 + 4 * calm);
  if (Math.random() < rate) {
    const specks = 1 + Math.floor(Math.random() * 3);
    for (let s = 0; s < specks; s++) {
      g.fillStyle = Math.random() < 0.6 ? 'rgba(10,8,6,.55)' : 'rgba(255,250,235,.45)';
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, 0.6 + Math.random() * 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (Math.random() < rate * 0.15) {
    const x = Math.random() * w, y = Math.random() * h, len = 20 + Math.random() * 50;
    g.strokeStyle = 'rgba(15,12,10,.35)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + len * 0.3, y - len * 0.4, x + len * 0.6, y + len * 0.3, x + len, y - len * 0.1);
    g.stroke();
  }
}

function applyGrain() {
  clearInterval(grainTimer);
  grainTimer = null;
  if (!texturesOn.grain || perfLite()) {
    if (grainEl) grainEl.style.opacity = '0';
    if (dustCanvas) dustCanvas.getContext('2d').clearRect(0, 0, dustCanvas.width, dustCanvas.height);
    return;
  }
  if (!ensureGrainLayers()) return;
  grainTimer = setInterval(grainFrame, 80);
}

// ---- Edge bleed ----
// Each tile's average colour, drawn behind the grid and blurred, so the gaps
// between tiles glow with what's on screen next to them.
let bleedCanvas = null;
let bleedTimer = null;
const bleedColors = [];
const bleedSampler = document.createElement('canvas');
bleedSampler.width = bleedSampler.height = 8;

function tileAverageColor(vid) {
  if (!vid || vid.readyState < 2 || !vid.videoWidth) return null;
  try {
    const g = bleedSampler.getContext('2d', { willReadFrequently: true });
    g.drawImage(vid, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    r /= n; gr /= n; b /= n;
    // Lift dark frames so the glow reads as colour, not as a smudge.
    const lift = Math.min(2.4, 210 / Math.max(1, r, gr, b));
    return [r * lift, gr * lift, b * lift];
  } catch (e) {
    return null;
  }
}

function bleedFrame() {
  if (!bleedCanvas || document.hidden) return;
  const theater = document.getElementById('theater-box');
  const tr = theater.getBoundingClientRect();
  const w = Math.max(1, Math.round(tr.width / 4)), h = Math.max(1, Math.round(tr.height / 4));
  if (bleedCanvas.width !== w || bleedCanvas.height !== h) { bleedCanvas.width = w; bleedCanvas.height = h; }
  const g = bleedCanvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  bleedCanvas.style.opacity = TUNING.EDGE_BLEED_OPACITY.toFixed(2);
  tileElements.forEach((tile, i) => {
    const target = tileAverageColor(getTileVideo(i));
    const prev = bleedColors[i];
    if (target) bleedColors[i] = prev ? prev.map((v, k) => v + (target[k] - v) * 0.35) : target;
    const c = bleedColors[i];
    if (!c) return;
    const q = tile.getBoundingClientRect();
    const pad = 4; // a little past the tile edge, into the gap
    g.fillStyle = 'rgb(' + c.map((v) => Math.round(Math.min(255, v))).join(',') + ')';
    g.fillRect((q.left - tr.left) / 4 - pad, (q.top - tr.top) / 4 - pad, q.width / 4 + pad * 2, q.height / 4 + pad * 2);
  });
  bleedColors.length = tileElements.length;
}

function applyBleed() {
  clearInterval(bleedTimer);
  bleedTimer = null;
  if (!texturesOn.bleed || perfLite()) {
    if (bleedCanvas) bleedCanvas.style.opacity = '0';
    return;
  }
  const theater = document.getElementById('theater-box');
  if (!theater) return;
  if (!bleedCanvas) {
    bleedCanvas = document.createElement('canvas');
    bleedCanvas.id = 'edge-bleed';
    theater.insertBefore(bleedCanvas, theater.firstChild); // under the tiles
  }
  bleedTimer = setInterval(bleedFrame, 400);
}

// ---- prefs ----
function loadTexturePrefs() {
  const p = loadJsonPref('mm_textures', {});
  Object.keys(texturesOn).forEach((k) => { if (typeof p[k] === 'boolean') texturesOn[k] = p[k]; });
  updateTextureUi();
  applyGrain();
  applyBleed();
}

function toggleTexture(k) {
  texturesOn[k] = !texturesOn[k];
  saveJsonPref('mm_textures', texturesOn);
  if (k === 'grain') applyGrain();
  if (k === 'bleed') applyBleed();
  if (k === 'split' && !texturesOn.split) endSplitFrames(false);
  updateTextureUi();
}

function updateTextureUi() {
  Object.keys(texturesOn).forEach((k) => setToggleBadge('texture-' + k + '-toggle', texturesOn[k]));
}
