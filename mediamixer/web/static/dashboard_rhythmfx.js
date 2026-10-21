// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Rhythm FX: Stutter edits and Cascades - music-video moves built on the beat.

let rhythmFxStutter = true;
let rhythmFxCascade = true;

function rhythmFxBeatMs() {
  const bpm = rhythmActive() ? currentRhythmBpm() : rhythmEffectiveBaseBpm() * rhythmDrive;
  return 60000 / Math.max(40, bpm);
}

function rhythmFxBusyTiles() {
  return new Set([sealedTileIndex, bonusWindowTileIndex, chaseFlashTileIndex, mysteryTileIndex, slowmoTileIndex, doubleExposureTileIndex, spotlightTileIndex]
    .concat(cascade ? [cascade.source].concat(cascade.order) : [])
    .concat(typeof splitFrames !== 'undefined' && splitFrames ? [splitFrames.idx] : [])
    .concat(typeof hook !== 'undefined' && hook ? [hook.idx] : [])
    .concat(typeof replay !== 'undefined' && replay ? [replay.idx] : []).filter((i) => i >= 0));
}

// Called from onRhythmBeat on every beat.
function rhythmFxBeat(n) {
  if (cascade && cascade.onBeat) cascadeStep();
  if (n % 4 !== 0 || document.hidden || anticipationActive || floaterBarrageActive || finaleActive) return;
  const now = Date.now();
  if (rhythmFxCascade && !perfLite() && !cascade && now - cascadeLastAt > TUNING.CASCADE_COOLDOWN_MS && tileElements.length >= 4 && Math.random() < TUNING.CASCADE_CHANCE) {
    startCascade();
    return;
  }
  if (rhythmFxStutter && !perfLite() && !stutterTile.size && now - stutterLastAt > TUNING.STUTTER_COOLDOWN_MS) {
    const chance = TUNING.STUTTER_CHANCE * (rhythmDrive > 1.05 ? 1.5 : 1);
    if (Math.random() < chance) {
      const busy = rhythmFxBusyTiles();
      const free = tileElements.map((t, i) => i).filter((i) => !busy.has(i) && !pendingCuts[i]);
      if (free.length) startStutter(free[Math.floor(Math.random() * free.length)]);
    }
  }
}

// ---- Stutter ----
// Captures the next half-beat of a tile's clip as frames, then replays them
// 2-3 times in rhythm with a small punch on each repeat, then snaps back to
// the live clip. Replayed from captured frames drawn over the tile - never by
// seeking the video, which can briefly stall and read as buffering.
let stutterLastAt = 0;
const stutterTile = new Set();

function startStutter(idx) {
  const tile = tileElements[idx];
  const vid = getTileVideo(idx);
  if (!tile || !vid || stutterTile.has(idx) || vid.readyState < 2 || !vid.videoWidth) return false;
  stutterTile.add(idx);
  stutterLastAt = Date.now();
  const segMs = Math.max(150, Math.min(420, rhythmFxBeatMs() / 2));
  const repeats = Math.round(TUNING.STUTTER_REPEATS);
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-stutter-canvas';
  tile.insertBefore(canvas, vid.nextSibling);
  const w = Math.max(1, Math.round(tile.clientWidth / 2)), h = Math.max(1, Math.round(tile.clientHeight / 2));
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  const frames = [];
  const start = performance.now();
  const drawFrom = (src, ctx) => {
    const vw = vid.videoWidth, vh = vid.videoHeight, scale = Math.min(w / vw, h / vh);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, (w - vw * scale) / 2, (h - vh * scale) / 2, vw * scale, vh * scale);
  };
  function capture(ts) {
    if (!canvas.isConnected) { stutterTile.delete(idx); return; }
    if (ts - start < segMs && frames.length < 24) {
      const f = document.createElement('canvas');
      f.width = w; f.height = h;
      drawFrom(vid, f.getContext('2d'));
      frames.push(f);
      requestAnimationFrame(capture);
      return;
    }
    if (!frames.length) { canvas.remove(); stutterTile.delete(idx); return; }
    replay(performance.now());
  }
  function replay(t0) {
    canvas.style.opacity = '1';
    let lastLoop = -1;
    function step(ts) {
      // A frame's timestamp can be a hair earlier than the performance.now()
      // that started the replay - a negative elapsed picked frames[-n].
      const elapsed = Math.max(0, ts - t0);
      const loop = Math.floor(elapsed / segMs);
      // No frames captured (the clip changed first) - nothing to replay.
      if (!canvas.isConnected || loop >= repeats || !frames.length) { canvas.remove(); stutterTile.delete(idx); return; }
      if (loop !== lastLoop) {
        lastLoop = loop;
        if (canvas.animate) canvas.animate([{ transform: 'scale(1.045)', filter: 'brightness(1.25)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: Math.min(220, segMs), easing: 'ease-out' });
      }
      const f = frames[Math.min(frames.length - 1, Math.floor(((elapsed % segMs) / segMs) * frames.length))];
      g.clearRect(0, 0, w, h);
      g.drawImage(f, 0, 0);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(capture);
  return true;
}

// ---- Cascade ----
// One tile's clip ripples across the grid a beat at a time - each tile shows
// the same clip one beat behind the last, like a canon - along the beat path
// or outward in rings, holds a few bars, then hands back one beat at a time.
// Every copy is loaded and positioned before its turn; one that isn't ready
// in time sits the wave out rather than showing black.
let cascade = null;
let cascadeLastAt = 0;
const CASCADE_MAX_TILES = 12;

function cascadeSourceTile() {
  // Favour the most-hearted clip on screen - a cascade of something you love.
  let best = -1, bestHearts = -1;
  tileElements.forEach((t, i) => {
    const m = videoMetaCache[currentPaths[i]];
    const h = (m && m.heart_count) || 0;
    if (getTileVideo(i) && getTileVideo(i).readyState >= 2 && h > bestHearts) { best = i; bestHearts = h; }
  });
  return best;
}

function cascadeOrder(src, mode) {
  const n = tileElements.length;
  if (mode === 'rings') {
    const cols = Math.max(1, currentColumns || 1);
    const [sr, sc] = [Math.floor(src / cols), src % cols];
    return tileElements.map((t, i) => i).filter((i) => i !== src)
      .sort((a, b) => Math.hypot(Math.floor(a / cols) - sr, (a % cols) - sc) - Math.hypot(Math.floor(b / cols) - sr, (b % cols) - sc));
  }
  const walk = rhythmWalkOrder();
  const k = walk.indexOf(src);
  return walk.slice(k + 1).concat(walk.slice(0, k)).filter((i) => i !== src && i < n);
}

function startCascade(sourceIdx, mode) {
  if (cascade || tileElements.length < 4) return false;
  const src = sourceIdx != null && sourceIdx >= 0 ? sourceIdx : cascadeSourceTile();
  const srcVid = getTileVideo(src);
  const path = currentPaths[src];
  if (src < 0 || !srcVid || !path) return false;
  mode = mode || (Math.random() < 0.5 ? 'path' : 'rings');
  const busy = rhythmFxBusyTiles();
  const order = cascadeOrder(src, mode).filter((i) => !busy.has(i)).slice(0, CASCADE_MAX_TILES - 1);
  if (order.length < 3) return false;
  cascadeLastAt = Date.now();
  const t0 = srcVid.currentTime;
  const rate = srcVid.playbackRate || 1;
  const url = mediaOrigin(src) + '/media/' + path + '?tiles=' + tileElements.length + '&cors=1'; // same URL as the source tile, so it's cached
  const copies = order.map((i) => {
    const tile = tileElements[i];
    const vid = getTileVideo(i);
    const el = document.createElement('video');
    el.className = 'fx-cascade';
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
    const copy = { idx: i, el, ready: false, shown: false };
    el.addEventListener('loadedmetadata', () => { el.currentTime = Math.min(t0, Math.max(0, el.duration - 0.5)); }, { once: true });
    // Ready = positioned AND buffered enough to start the moment it's revealed;
    // otherwise copies wait on data and start in lockstep instead of a beat apart.
    const checkReady = () => { if (el.readyState >= 3 && Math.abs(el.currentTime - t0) < 0.5) copy.ready = true; };
    el.addEventListener('seeked', checkReady);
    el.addEventListener('canplay', checkReady);
    el.addEventListener('canplaythrough', checkReady);
    el.src = url;
    if (tile && vid) tile.insertBefore(el, vid.nextSibling);
    return copy;
  });
  const beatMs = rhythmFxBeatMs();
  // The source keeps its clip (and loops) for the whole cascade.
  const totalS = Math.ceil(((order.length * 2 + TUNING.CASCADE_HOLD_BEATS) * beatMs) / 1000) + 3;
  fetch('/api/hold?screen=' + src + '&s=' + totalS).catch(() => {});
  srcVid.loop = true;
  cascade = {
    source: src, order, copies, mode, step: 0, phase: 'reveal', rate,
    holdBeats: Math.round(TUNING.CASCADE_HOLD_BEATS), onBeat: rhythmActive(), timer: null,
  };
  if (!cascade.onBeat) cascade.timer = setInterval(cascadeStep, beatMs); // no Rhythm Mode: keep time ourselves
  toast(mode === 'rings' ? '🌊 Cascade - rippling out' : '🌊 Cascade');
  return true;
}

function cascadeStep() {
  const c = cascade;
  if (!c) return;
  if (c.phase === 'reveal') {
    const copy = c.copies[c.step];
    if (copy) {
      if (copy.ready && copy.el.isConnected) {
        copy.el.playbackRate = c.rate;
        copy.el.play().catch(() => {});
        copy.el.style.opacity = '1';
        copy.shown = true;
      } else {
        copy.el.remove(); // not ready in time - this tile sits the wave out
      }
    }
    c.step++;
    if (c.step >= c.copies.length) { c.phase = 'hold'; c.step = 0; }
    return;
  }
  if (c.phase === 'hold') {
    if (++c.step >= c.holdBeats) { c.phase = 'release'; c.step = 0; }
    return;
  }
  const copy = c.copies[c.step];
  if (copy && copy.el.isConnected) {
    copy.el.style.opacity = '0';
    setTimeout(() => { copy.el.pause(); copy.el.removeAttribute('src'); copy.el.load(); copy.el.remove(); }, 400);
  }
  c.step++;
  if (c.step >= c.copies.length) endCascade();
}

function endCascade() {
  if (!cascade) return;
  clearInterval(cascade.timer);
  cascade.copies.forEach((copy) => { if (copy.el.isConnected) { copy.el.pause(); copy.el.remove(); } });
  cascade = null;
}

// Safety net: a cascade never outlives its own length by much (tab hidden, rhythm stopped mid-way).
setInterval(() => {
  if (!cascade) return;
  if (cascade.onBeat && !rhythmActive()) { cascade.onBeat = false; cascade.timer = setInterval(cascadeStep, rhythmFxBeatMs()); }
  const maxMs = (cascade.copies.length * 2 + cascade.holdBeats + 8) * 1000;
  if (Date.now() - cascadeLastAt > maxMs) endCascade();
}, 1000);

// ---- prefs ----
function loadRhythmFxPrefs() {
  const p = loadJsonPref('mm_rhythm_fx', { stutter: true, cascade: true });
  rhythmFxStutter = p.stutter !== false;
  rhythmFxCascade = p.cascade !== false;
  updateRhythmFxUi();
}

function toggleRhythmFx(which) {
  if (which === 'stutter') rhythmFxStutter = !rhythmFxStutter;
  else if (which === 'cascade') rhythmFxCascade = !rhythmFxCascade;
  saveJsonPref('mm_rhythm_fx', { stutter: rhythmFxStutter, cascade: rhythmFxCascade });
  updateRhythmFxUi();
}

function updateRhythmFxUi() {
  setToggleBadge('rhythmfx-stutter-toggle', rhythmFxStutter);
  setToggleBadge('rhythmfx-cascade-toggle', rhythmFxCascade);
}
