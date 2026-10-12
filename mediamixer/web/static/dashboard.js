const RANDOM_START_MAX_FRACTION = 0.5; // clips start somewhere in their first 0-50%
const BINAURAL_BASE_GAIN = 0.15;

// Browsers cap concurrent connections to ~6 per origin (HTTP/1.1). A big grid
// can easily want 2x its tile count in flight at once (visible + preloaded
// clip per tile), so beyond a few tiles, most requests just queue - which
// looks like stalling even though neither the network nor the PC is actually
// busy. When this page itself was loaded via a loopback address (i.e. this
// is the PC's own browser, not a phone on the LAN), we can route different
// tiles' media requests through different 127.0.0.x addresses - Windows
// treats the whole 127.0.0.0/8 block as loopback, and the browser treats
// each distinct host as a separate origin with its own 6-connection budget.
const LOOPBACK_SHARDS = 6;
const IS_LOOPBACK_VIEW = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

function mediaOrigin(screenIndex) {
  if (!IS_LOOPBACK_VIEW) return ''; // phone/LAN viewers: just use this page's own origin
  const shard = (screenIndex % LOOPBACK_SHARDS) + 1;
  return `${location.protocol}//127.0.0.${shard}:${location.port}`;
}

let currentLayout = null;
let currentColumns = 1;
let currentTileCount = 0;
let currentPaths = [];
let preloadEnabled = true;
let tileElements = [];

// ---- Mosaic Fit (experimental) ----
// Instead of a uniform grid, size each tile by its clip's own aspect ratio -
// pack tiles into justified rows (same idea as a Flickr/Google-Photos photo
// wall) so there's much less black-bar letterboxing. Aspect ratios only
// become known once a clip's metadata loads, and clips rotate on their own
// independent schedules, so reflowing on every single change would make
// neighboring tiles constantly resize around each other; instead this
// reflows periodically (MOSAIC_REFLOW_INTERVAL_MS) plus a few explicit
// triggers (toggling on, tile count changing, window resize, and once
// shortly after a tile's *first* real aspect ratio arrives).
const MOSAIC_REFLOW_INTERVAL_MS = 8000;
const DEFAULT_ASPECT = 16 / 9;
let mosaicEnabled = false;
let aspectRatios = [];
let aspectKnown = [];
let mosaicSettleTimer = null;

function loadMosaicPref() {
  try { mosaicEnabled = localStorage.getItem('mm_mosaic_enabled') === '1'; } catch (e) {}
  const btn = document.getElementById('mosaic-toggle');
  btn.innerText = mosaicEnabled ? 'ON' : 'OFF';
  btn.classList.toggle('active', mosaicEnabled);
}

function toggleMosaic() {
  mosaicEnabled = !mosaicEnabled;
  try { localStorage.setItem('mm_mosaic_enabled', mosaicEnabled ? '1' : '0'); } catch (e) {}
  const btn = document.getElementById('mosaic-toggle');
  btn.innerText = mosaicEnabled ? 'ON' : 'OFF';
  btn.classList.toggle('active', mosaicEnabled);
  applyLayoutMode();
}

function onAspectKnown(i) {
  const vid = tileElements[i] && tileElements[i].querySelector('#screen-' + i);
  if (!vid || !vid.videoWidth || !vid.videoHeight) return;
  const isFirstReal = !aspectKnown[i];
  aspectKnown[i] = true;
  aspectRatios[i] = vid.videoWidth / vid.videoHeight;
  if (mosaicEnabled && isFirstReal) {
    // Several tiles often get their first real aspect ratio within
    // milliseconds of each other (e.g. right after a layout switch) -
    // settle once, shortly after the last one arrives, not once per tile.
    clearTimeout(mosaicSettleTimer);
    mosaicSettleTimer = setTimeout(() => { if (mosaicEnabled) layoutMosaic(); }, 200);
  }
}

function splitEvenly(n, rows) {
  const base = Math.floor(n / rows);
  const extra = n % rows;
  const sizes = [];
  for (let r = 0; r < rows; r++) sizes.push(base + (r < extra ? 1 : 0));
  return sizes;
}

function computeMosaicRows(aspects, containerWidth, containerHeight) {
  const n = aspects.length;
  if (n === 0 || containerWidth < 1 || containerHeight < 1) return [];

  let best = null;
  for (let rows = 1; rows <= n; rows++) {
    const sizes = splitEvenly(n, rows);
    if (sizes.some(s => s === 0)) continue;

    let idx = 0;
    const groups = sizes.map(size => aspects.slice(idx, (idx += size)));
    const rowNaturalHeights = groups.map(g => containerWidth / g.reduce((a, b) => a + b, 0));
    const totalNaturalHeight = rowNaturalHeights.reduce((a, b) => a + b, 0);
    const diff = Math.abs(totalNaturalHeight - containerHeight);
    if (!best || diff < best.diff) best = { groups, rowNaturalHeights, totalNaturalHeight, diff };
  }
  if (!best) return [];

  // Scale row heights so they sum to exactly containerHeight (no leftover
  // vertical gap, no overflow). Width shares are computed independently,
  // as each item's fraction of its row's total aspect ratio - that ALWAYS
  // sums to exactly 100%, regardless of how far the height scale ends up
  // from 1. The cost is that a cell's forced aspect may no longer exactly
  // match its video's native aspect when the scale is far from 1; cover is
  // applied in CSS so that shows up as a touch more cropping, never as a
  // black bar or overflow.
  const scale = containerHeight / best.totalNaturalHeight;
  let index = 0;
  return best.groups.map((group, gi) => {
    const rowHeight = best.rowNaturalHeights[gi] * scale;
    const aspectSum = group.reduce((a, b) => a + b, 0);
    const items = group.map(aspect => ({
      screenIndex: index++,
      widthPct: (aspect / aspectSum) * 100,
    }));
    return { heightPx: rowHeight, items };
  });
}

function layoutMosaic() {
  const grid = document.getElementById('screen-grid');
  const rect = grid.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10 || tileElements.length === 0) return;

  grid.className = 'screen-grid mosaic';
  grid.style.gridTemplateColumns = '';
  grid.style.gridTemplateRows = '';

  const rows = computeMosaicRows(aspectRatios.slice(0, tileElements.length), rect.width, rect.height);
  grid.innerHTML = '';
  rows.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'mosaic-row';
    rowEl.style.height = row.heightPx + 'px';
    row.items.forEach(item => {
      const tile = tileElements[item.screenIndex];
      if (!tile) return;
      tile.style.flexBasis = item.widthPct + '%';
      tile.style.width = item.widthPct + '%';
      rowEl.appendChild(tile); // re-parents the existing tile (and its <video>) without reloading it
    });
    grid.appendChild(rowEl);
  });
}

function applyUniformGrid() {
  const grid = document.getElementById('screen-grid');
  grid.className = 'screen-grid';
  grid.style.gridTemplateColumns = 'repeat(' + currentColumns + ', 1fr)';
  grid.style.gridTemplateRows = 'repeat(' + Math.ceil(currentTileCount / currentColumns) + ', 1fr)';
  grid.innerHTML = '';
  tileElements.forEach(tile => {
    tile.style.flexBasis = '';
    tile.style.width = '';
    grid.appendChild(tile);
  });
}

function applyLayoutMode() {
  if (mosaicEnabled) layoutMosaic();
  else applyUniformGrid();
}

// ---- Floating Overlay FX (experimental) ----
// A handful of video clips drift across the screen above the main grid,
// fading in, moving in a straight line at a random angle, then fading out
// and respawning elsewhere with a new clip - like a DVD logo, minus the
// bounce. Pure CSS-transition driven (one transition covers the whole
// drift, the browser interpolates it with no per-frame JS), so it's cheap
// regardless of how many sprites are running.
const FX_MIN_LIFETIME_S = 10;
const FX_MAX_LIFETIME_S = 25;
const FX_FADE_S = 1.5;
const FX_MIN_SIZE_VW = 6;
const FX_MAX_SIZE_VW = 32;
const FX_SHARD_OFFSET = 100; // keep fx sprites on their own loopback shards, separate from the main grid

let fxEnabled = false;
let fxCount = 3;
let fxOpacity = 60;
let fxSource = 'library';
let fxSourceLists = { dedicated: null, library: null };
let fxSprites = [];

function loadFxPrefs() {
  try {
    const en = localStorage.getItem('mm_fx_enabled');
    const ct = localStorage.getItem('mm_fx_count');
    const op = localStorage.getItem('mm_fx_opacity');
    const src = localStorage.getItem('mm_fx_source');
    if (en !== null) fxEnabled = en === '1';
    if (ct !== null) fxCount = parseInt(ct, 10);
    if (op !== null) fxOpacity = parseInt(op, 10);
    if (src !== null) fxSource = src;
  } catch (e) {}
  document.getElementById('fx-toggle').innerText = fxEnabled ? 'ON' : 'OFF';
  document.getElementById('fx-toggle').classList.toggle('active', fxEnabled);
  document.getElementById('fx-count-input').value = fxCount;
  document.getElementById('l-fx-count').innerText = fxCount;
  document.getElementById('fx-opacity-input').value = fxOpacity;
  document.getElementById('l-fx-opacity').innerText = fxOpacity + '%';
  updateFxSourceButtons();
  if (fxEnabled) startFx();
}

function updateFxSourceButtons() {
  ['dedicated', 'library', 'both'].forEach(s => {
    document.getElementById('fx-source-' + s).classList.toggle('active', s === fxSource);
  });
}

function toggleFx() {
  fxEnabled = !fxEnabled;
  try { localStorage.setItem('mm_fx_enabled', fxEnabled ? '1' : '0'); } catch (e) {}
  document.getElementById('fx-toggle').innerText = fxEnabled ? 'ON' : 'OFF';
  document.getElementById('fx-toggle').classList.toggle('active', fxEnabled);
  if (fxEnabled) startFx(); else stopFx();
}

function setFxSource(src) {
  fxSource = src;
  try { localStorage.setItem('mm_fx_source', src); } catch (e) {}
  updateFxSourceButtons();
  fxSourceLists = { dedicated: null, library: null };
}

function setFxCount(v) {
  fxCount = parseInt(v, 10);
  document.getElementById('l-fx-count').innerText = fxCount;
  try { localStorage.setItem('mm_fx_count', fxCount); } catch (e) {}
  if (fxEnabled) reconcileFxSpriteCount();
}

function setFxOpacity(v) {
  fxOpacity = parseInt(v, 10);
  document.getElementById('l-fx-opacity').innerText = fxOpacity + '%';
  try { localStorage.setItem('mm_fx_opacity', fxOpacity); } catch (e) {}
  fxSprites.forEach(s => { if (s && s.state === 'visible') s.el.style.opacity = String(fxOpacity / 100); });
}

function fetchFxList(source) {
  if (fxSourceLists[source]) return Promise.resolve(fxSourceLists[source]);
  return fetch('/api/overlay_fx/list?source=' + source)
    .then(r => r.json())
    .then(d => { fxSourceLists[source] = d.items || []; return fxSourceLists[source]; })
    .catch(() => []);
}

function pickFxSourceList() {
  if (fxSource === 'library') return fetchFxList('library');
  if (fxSource === 'dedicated') return fetchFxList('dedicated');
  return Promise.all([fetchFxList('dedicated'), fetchFxList('library')]).then(([a, b]) => a.concat(b));
}

function startFx() {
  document.getElementById('fx-layer').innerHTML = '';
  fxSprites = [];
  for (let i = 0; i < fxCount; i++) spawnFxSprite(i, Math.random() * 4000);
}

function stopFx() {
  fxSprites.forEach(s => s && clearTimeout(s.timer));
  fxSprites = [];
  document.getElementById('fx-layer').innerHTML = '';
}

function reconcileFxSpriteCount() {
  if (fxSprites.length < fxCount) {
    for (let i = fxSprites.length; i < fxCount; i++) spawnFxSprite(i, 0);
  } else if (fxSprites.length > fxCount) {
    fxSprites.splice(fxCount).forEach(s => {
      if (!s) return;
      clearTimeout(s.timer);
      if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    });
  }
}

function spawnFxSprite(slot, delayMs) {
  const sprite = { slot, el: null, timer: null, state: 'pending' };
  fxSprites[slot] = sprite;
  sprite.timer = setTimeout(() => activateFxSprite(sprite), delayMs);
}

function activateFxSprite(sprite) {
  if (!fxEnabled) return;
  pickFxSourceList().then(items => {
    if (!fxEnabled) return;
    if (!items || !items.length) {
      sprite.timer = setTimeout(() => activateFxSprite(sprite), 4000);
      return;
    }

    const item = items[Math.floor(Math.random() * items.length)];
    const layer = document.getElementById('fx-layer');
    let el = sprite.el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'fx-sprite';
      el.innerHTML = '<video muted loop playsinline></video>';
      layer.appendChild(el);
      sprite.el = el;
    }
    const vid = el.querySelector('video');
    vid.onloadedmetadata = () => {
      if (vid.videoWidth && vid.videoHeight) {
        el.style.height = (parseFloat(el.style.width) * vid.videoHeight / vid.videoWidth) + 'px';
      }
    };
    vid.src = mediaOrigin(FX_SHARD_OFFSET + sprite.slot) + item.base + item.path;
    vid.play().catch(() => {});

    const sizePx = ((FX_MIN_SIZE_VW + Math.random() * (FX_MAX_SIZE_VW - FX_MIN_SIZE_VW)) / 100) * window.innerWidth;
    el.style.width = sizePx + 'px';
    el.style.height = (sizePx * 9 / 16) + 'px'; // corrected above once real metadata loads

    const vw = window.innerWidth, vh = window.innerHeight;
    const startX = Math.random() * Math.max(0, vw - sizePx);
    const startY = Math.random() * Math.max(0, vh - sizePx * 9 / 16);
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.max(vw, vh) * (0.3 + Math.random() * 0.4);
    const endX = startX + Math.cos(angle) * distance;
    const endY = startY + Math.sin(angle) * distance;
    const lifetime = FX_MIN_LIFETIME_S + Math.random() * (FX_MAX_LIFETIME_S - FX_MIN_LIFETIME_S);

    el.style.transition = 'none';
    el.style.transform = `translate(${startX}px, ${startY}px)`;
    el.style.opacity = '0';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = `transform ${lifetime}s linear, opacity ${FX_FADE_S}s ease`;
        el.style.transform = `translate(${endX}px, ${endY}px)`;
        el.style.opacity = String(fxOpacity / 100);
      });
    });

    sprite.state = 'visible';
    sprite.timer = setTimeout(() => {
      sprite.state = 'fading';
      el.style.opacity = '0'; // reuses the opacity transition declared above
      sprite.timer = setTimeout(() => {
        vid.pause();
        sprite.timer = setTimeout(() => activateFxSprite(sprite), 500 + Math.random() * 3000);
      }, FX_FADE_S * 1000 + 100);
    }, Math.max(0, lifetime - FX_FADE_S) * 1000);
  });
}

// ---- Client-side audio engine ----
// The binaural tone (Web Audio) and the overlay track (<audio>) both play
// locally in whichever browser has this page open - including a phone on
// the same Wi-Fi - instead of coming out of the server machine's speakers.
// Volume is therefore a per-device setting, persisted in localStorage.
let audioCtx = null;
let synthNodes = null;
let overlayEl = null;
let currentAudioPath = '';
let audioUnlocked = false;
let binauralVolume = 80;
let overlayVolume = 85;

function loadVolumePrefs() {
  try {
    const bv = localStorage.getItem('mm_binaural_vol');
    const ov = localStorage.getItem('mm_overlay_vol');
    if (bv !== null) binauralVolume = parseInt(bv, 10);
    if (ov !== null) overlayVolume = parseInt(ov, 10);
  } catch (e) {}
  document.getElementById('binaural-vol-input').value = binauralVolume;
  document.getElementById('l-binaural-vol').innerText = binauralVolume + '%';
  document.getElementById('overlay-vol-input').value = overlayVolume;
  document.getElementById('l-overlay-vol').innerText = overlayVolume + '%';
}

function applyVolumes() {
  if (synthNodes && audioCtx) {
    synthNodes.masterGain.gain.setTargetAtTime(BINAURAL_BASE_GAIN * (binauralVolume / 100), audioCtx.currentTime, 0.05);
  }
  if (overlayEl) {
    overlayEl.volume = Math.max(0, Math.min(1, overlayVolume / 100));
  }
}

function setBinauralVolume(v) {
  binauralVolume = parseInt(v, 10);
  document.getElementById('l-binaural-vol').innerText = binauralVolume + '%';
  try { localStorage.setItem('mm_binaural_vol', binauralVolume); } catch (e) {}
  applyVolumes();
}

function setOverlayVolume(v) {
  overlayVolume = parseInt(v, 10);
  document.getElementById('l-overlay-vol').innerText = overlayVolume + '%';
  try { localStorage.setItem('mm_overlay_vol', overlayVolume); } catch (e) {}
  applyVolumes();
}

function buildSynthGraph() {
  const ctx = audioCtx;
  const leftOsc = ctx.createOscillator();
  const rightOsc = ctx.createOscillator();

  // Gate (isochronic pulse) - identical modulation fed to both ears via
  // AudioParam fan-in, so gate(t) = (1 - 0.5*iso) + (0.5*iso)*sin(2*pi*beat*t).
  const gateLeft = ctx.createGain(); gateLeft.gain.value = 0;
  const gateRight = ctx.createGain(); gateRight.gain.value = 0;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
  const offset = ctx.createConstantSource(); offset.offset.value = 1;
  lfo.connect(lfoGain);
  lfoGain.connect(gateLeft.gain);
  lfoGain.connect(gateRight.gain);
  offset.connect(gateLeft.gain);
  offset.connect(gateRight.gain);

  const pannerLeft = ctx.createStereoPanner(); pannerLeft.pan.value = -1;
  const pannerRight = ctx.createStereoPanner(); pannerRight.pan.value = 1;
  const masterGain = ctx.createGain();
  masterGain.gain.value = BINAURAL_BASE_GAIN * (binauralVolume / 100);

  leftOsc.connect(gateLeft); gateLeft.connect(pannerLeft); pannerLeft.connect(masterGain);
  rightOsc.connect(gateRight); gateRight.connect(pannerRight); pannerRight.connect(masterGain);
  masterGain.connect(ctx.destination);

  leftOsc.start(); rightOsc.start(); lfo.start(); offset.start();
  synthNodes = { leftOsc, rightOsc, lfo, lfoGain, offset, masterGain };
}

function updateSynthParams(synth) {
  if (!synthNodes || !synth || !audioCtx) return;
  const now = audioCtx.currentTime;
  synthNodes.leftOsc.frequency.setTargetAtTime(synth.carrier_hz, now, 0.1);
  synthNodes.rightOsc.frequency.setTargetAtTime(synth.carrier_hz + synth.beat_hz, now, 0.1);
  synthNodes.lfo.frequency.setTargetAtTime(Math.max(0.01, synth.beat_hz), now, 0.1);
  synthNodes.lfoGain.gain.setTargetAtTime(0.5 * synth.iso, now, 0.1);
  synthNodes.offset.offset.setTargetAtTime(1 - 0.5 * synth.iso, now, 0.1);
}

function enableAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    buildSynthGraph();
    applyVolumes();
  }
  audioCtx.resume().then(() => {
    audioUnlocked = true;
    document.getElementById('audio-unlock').classList.remove('show');
    if (overlayEl && overlayEl.src) overlayEl.play().catch(() => {});
  }).catch(() => {});
}

function armAutoUnlock() {
  ['click', 'touchstart'].forEach(evt => document.addEventListener(evt, enableAudio, { once: true, passive: true }));
}

function copyPhoneUrl() {
  const el = document.getElementById('phone-url');
  const text = el.innerText;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Copied: ' + text)).catch(() => toast('Copy failed', true));
  } else {
    toast('Copy failed', true);
  }
}

function togglePanel() {
  const panel = document.getElementById('panel');
  const collapsed = panel.classList.toggle('collapsed');
  document.getElementById('panel-toggle').innerText = collapsed ? '☰' : '✕';
  try { localStorage.setItem('mm_panel_collapsed', collapsed ? '1' : '0'); } catch (e) {}
}

function restorePanelState() {
  let collapsed = false;
  try { collapsed = localStorage.getItem('mm_panel_collapsed') === '1'; } catch (e) {}
  document.getElementById('panel').classList.toggle('collapsed', collapsed);
  document.getElementById('panel-toggle').innerText = collapsed ? '☰' : '✕';
}

function toast(msg, neg) {
  const box = document.getElementById('toast');
  box.innerText = msg;
  box.style.borderColor = neg ? '#ff4d4d' : '#b84dff';
  box.style.display = 'block';
  setTimeout(() => box.style.display = 'none', 1800);
}

function uiFlare() {
  const t = document.getElementById('theater-box');
  t.classList.add('flare');
  setTimeout(() => t.classList.remove('flare'), 400);
}

function uiGlitch() {
  const t = document.getElementById('theater-box');
  t.classList.add('glitch');
  setTimeout(() => t.classList.remove('glitch'), 600);
}

function scrambleText(element, newText) {
  if (element.getAttribute('data-val') === newText) return;
  element.setAttribute('data-val', newText);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let iters = 0;
  const interval = setInterval(() => {
    element.innerText = newText.split('').map((c, i) => (i < iters ? c : chars[Math.floor(Math.random() * chars.length)])).join('');
    if (iters >= newText.length) {
      clearInterval(interval);
      element.innerText = newText;
    }
    iters += 1 / 1.5;
  }, 25);
}

function setConnected(ok) {
  document.getElementById('conn-dot').classList.toggle('down', !ok);
  document.getElementById('conn-label').innerText = ok ? 'Connected' : 'Reconnecting…';
}

function ensureTiles(count) {
  if (currentTileCount === count) return false;
  currentTileCount = count;
  currentPaths = new Array(count).fill('');
  aspectRatios = new Array(count).fill(DEFAULT_ASPECT);
  aspectKnown = new Array(count).fill(false);
  tileElements = [];
  for (let i = 0; i < count; i++) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML =
      '<video id="screen-' + i + '" autoplay controls></video>' +
      '<video id="preload-' + i + '" class="preload" preload="auto" muted></video>' +
      '<div class="tile-overlay">' +
      '<div class="src-label" id="label-' + i + '"></div>' +
      '<div class="tile-actions">' +
      '<button class="up thumb" onclick="rateScreen(' + i + ',\'up\')">👍</button>' +
      '<button class="down thumb" onclick="rateScreen(' + i + ',\'down\')">👎</button>' +
      '</div></div>';
    const vid = tile.querySelector('#screen-' + i);
    vid.addEventListener('ended', () => fetch('/api/rotate?screen=' + i));
    vid.addEventListener('loadedmetadata', () => onAspectKnown(i));
    tileElements.push(tile);
  }
  return true;
}

function applyRandomStart(vid) {
  const onMeta = () => {
    vid.removeEventListener('loadedmetadata', onMeta);
    if (isFinite(vid.duration) && vid.duration > 0) {
      vid.currentTime = Math.random() * RANDOM_START_MAX_FRACTION * vid.duration;
    }
    vid.play().catch(() => {});
  };
  vid.addEventListener('loadedmetadata', onMeta);
}

function render(d) {
  if (!d.screens || !d.screens.length) return;
  const tilesRebuilt = ensureTiles(d.screens.length);
  const columnsChanged = d.columns !== currentColumns;
  currentLayout = d.layout;
  currentColumns = d.columns;
  if (tilesRebuilt || columnsChanged) applyLayoutMode();

  scrambleText(document.getElementById('t-audio'), d.audio_name);
  document.getElementById('t-lock').innerText = d.lock_label;
  document.getElementById('jackpot-tag').style.display = d.jackpot ? 'inline-block' : 'none';
  document.getElementById('t-barrage').innerText = d.barrage > 0 ? '⚠️ BARRAGE MODE ACTIVE: ' + d.barrage : '';
  document.getElementById('audio-offline').classList.toggle('show', !d.audio_available);
  document.getElementById('audio-unlock').classList.toggle('show', !audioUnlocked);

  updateSynthParams(d.synth);
  if (d.audio_path && d.audio_path !== currentAudioPath) {
    currentAudioPath = d.audio_path;
    overlayEl.src = '/audio/' + d.audio_path;
    if (audioUnlocked) overlayEl.play().catch(() => {});
  }

  preloadEnabled = d.preload_enabled;
  const preloadToggle = document.getElementById('preload-toggle');
  preloadToggle.innerText = preloadEnabled ? 'ON' : 'OFF';
  preloadToggle.classList.toggle('active', preloadEnabled);

  if (d.barrage > 0) uiGlitch();

  const persistentBadges = new Set([
    'preload-toggle', 'mosaic-toggle', 'fx-toggle', 'fx-source-dedicated', 'fx-source-library', 'fx-source-both',
  ]);
  document.querySelectorAll('.badge').forEach(b => { if (!persistentBadges.has(b.id)) b.classList.remove('active'); });
  const activeFolder = document.getElementById('folder-' + d.folder);
  if (activeFolder) activeFolder.classList.add('active');
  const activeLayout = document.getElementById('layout-' + d.layout);
  if (activeLayout) activeLayout.classList.add('active');

  d.screens.forEach((s, i) => {
    const vid = document.getElementById('screen-' + i);
    if (!vid) return;
    if (s.path && s.path !== currentPaths[i]) {
      currentPaths[i] = s.path;
      vid.src = mediaOrigin(i) + '/media/' + s.path;
      applyRandomStart(vid);
    }
    const label = document.getElementById('label-' + i);
    if (label) label.innerText = s.name || '';

    if (preloadEnabled && s.next_path) {
      const pre = document.getElementById('preload-' + i);
      // Shift the preload's shard off the main video's so a tile's own two
      // requests (current + preloading-next) don't compete for the same
      // origin's connection budget either.
      const nextUrl = mediaOrigin(i + 3) + '/media/' + s.next_path;
      if (pre && pre.getAttribute('src') !== nextUrl) pre.src = nextUrl;
    }

    vid.playbackRate = s.speed;
    const sat = Math.floor((s.tension - 1.0) * 60 + 100);
    const cont = Math.floor((s.tension - 1.0) * 40 + 100);
    vid.style.filter = `saturate(${sat}%) contrast(${cont}%)`;
  });
}

function connectStream() {
  const source = new EventSource('/api/stream');
  source.onmessage = (evt) => { setConnected(true); render(JSON.parse(evt.data)); };
  source.onerror = () => setConnected(false);
  return source;
}

function skip() { fetch('/api/skip').then(() => toast('⬇️ Skipped All', true)); }
function lock() { fetch('/api/lock').then(() => toast('60s Locked')); }
function cycleTone() { fetch('/api/cycle_tone'); }
function cat(f) { fetch('/api/folder?folder=' + encodeURIComponent(f)).then(() => toast('Category: ' + f.toUpperCase())); }
function setLayout(mode) { fetch('/api/layout?mode=' + mode).then(() => toast('Layout: ' + mode.toUpperCase())); }
function togglePreload() {
  const next = !preloadEnabled;
  fetch('/api/preload?enabled=' + next).then(() => toast('Preload: ' + (next ? 'ON' : 'OFF')));
}
function pace(v) {
  const labels = ['10s Hard Switching', '5s - 30s (Rapid)', '30s - 120s (Balanced)', 'Full Video (Continuous)'];
  document.getElementById('l-pace').innerText = labels[v];
  fetch('/api/pace?mode=' + v).then(() => toast('Pace updated'));
}
function vec(k, v) { fetch('/api/vector?key=' + k + '&val=' + v); }
function rateScreen(i, dir) { fetch('/api/rate?screen=' + i + '&dir=' + dir).then(() => toast(dir === 'up' ? '👍 Reinforced' : '👎 Penalized', dir !== 'up')); }
function rateAudio(d) { fetch('/api/rate_audio?dir=' + d).then(() => toast(d === 'up' ? '🔊 Audio rated up' : '🔇 Audio penalized', d !== 'up')); }
function nextAudio() { fetch('/api/next_audio').then(() => toast('⏭️ Audio Skipped')); }

window.addEventListener('resize', () => { if (mosaicEnabled) layoutMosaic(); });
setInterval(() => { if (mosaicEnabled) layoutMosaic(); }, MOSAIC_REFLOW_INTERVAL_MS);

window.onload = () => {
  restorePanelState();
  loadMosaicPref();
  loadFxPrefs();
  overlayEl = document.getElementById('overlay-audio');
  loadVolumePrefs();
  armAutoUnlock();
  fetch('/api/status').then(r => r.json()).then(render);
  connectStream();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
};
