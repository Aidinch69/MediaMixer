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
  const sprite = { slot, el: null, timer: null, state: 'pending', currentPath: null };
  fxSprites[slot] = sprite;
  sprite.timer = setTimeout(() => activateFxSprite(sprite), delayMs);
}

function pickFxItem(items, sprite) {
  // Avoid picking something another currently-visible (or still-fading-out)
  // sprite is already showing, so two floaters don't end up playing the
  // same clip at once. Falls back to the full list if exclusion would
  // otherwise leave nothing to pick from.
  const exclude = new Set();
  fxSprites.forEach(s => {
    if (s && s !== sprite && (s.state === 'visible' || s.state === 'fading') && s.currentPath) {
      exclude.add(s.currentPath);
    }
  });
  const filtered = items.filter(it => !exclude.has(it.base + it.path));
  const pool = filtered.length ? filtered : items;
  return pool[Math.floor(Math.random() * pool.length)];
}

function activateFxSprite(sprite) {
  if (!fxEnabled) return;
  pickFxSourceList().then(items => {
    if (!fxEnabled) return;
    if (!items || !items.length) {
      sprite.timer = setTimeout(() => activateFxSprite(sprite), 4000);
      return;
    }

    const item = pickFxItem(items, sprite);
    sprite.currentPath = item.base + item.path;
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
    const lifetime = sprite.burst
      ? 3 + Math.random() * 3
      : FX_MIN_LIFETIME_S + Math.random() * (FX_MAX_LIFETIME_S - FX_MIN_LIFETIME_S);

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
        if (sprite.burst) {
          if (sprite.el && sprite.el.parentNode) sprite.el.parentNode.removeChild(sprite.el);
          const idx = fxSprites.indexOf(sprite);
          if (idx >= 0) fxSprites.splice(idx, 1);
          return;
        }
        sprite.timer = setTimeout(() => activateFxSprite(sprite), 500 + Math.random() * 3000);
      }, FX_FADE_S * 1000 + 100);
    }, Math.max(0, lifetime - FX_FADE_S) * 1000);
  });
}

function burstExtraFloaters(scale) {
  if (!fxEnabled) return;
  const n = Math.min(8, Math.max(1, Math.round(3 * (scale || 1.0))));
  for (let i = 0; i < n; i++) {
    const sprite = { slot: 1000 + i, el: null, timer: null, state: 'pending', currentPath: null, burst: true };
    fxSprites.push(sprite);
    activateFxSprite(sprite);
  }
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

// ---- Anticipation / near-miss / payoff FX (experimental) ----
// "Honest" build-up: the server already tells every viewer how many barrage
// steps are left (d.barrage) before it resolves into a real jackpot - we
// just watch that count tick down and ramp a tension cue timed to peak
// around when it lands, then fire a real payoff when d.jackpot flips on.
// "Fake" near-miss: the same build-up cue, triggered by a random client-side
// timer with nothing real behind it, left to fizzle instead of pay off.
// Both are purely visual/audio flourish layered on the existing barrage/
// jackpot mechanic - nothing here changes what actually gets selected.
const FAKE_NEAR_MISS_CHECK_MS = 15000;
const FAKE_NEAR_MISS_PROBABILITY = 0.25;
const FAKE_NEAR_MISS_BUILD_S = 3.5;
const HONEST_BUILD_SAFETY_MS = 6000; // auto-fizzle if a real payoff never arrives (shouldn't normally fire)

let anticipationFxEnabled = true;
let nearMissEnabled = true;
let sfxVolume = 70;
let sfxGain = null;
let anticipationActive = false;
let anticipationRunId = 0;
let lastKnownBarrage = 0;
let lastKnownJackpot = false;

function loadAnticipationPrefs() {
  try {
    const en = localStorage.getItem('mm_anticipation_enabled');
    const nm = localStorage.getItem('mm_near_miss_enabled');
    const vol = localStorage.getItem('mm_sfx_vol');
    if (en !== null) anticipationFxEnabled = en === '1';
    if (nm !== null) nearMissEnabled = nm === '1';
    if (vol !== null) sfxVolume = parseInt(vol, 10);
  } catch (e) {}
  document.getElementById('anticipation-toggle').innerText = anticipationFxEnabled ? 'ON' : 'OFF';
  document.getElementById('anticipation-toggle').classList.toggle('active', anticipationFxEnabled);
  document.getElementById('near-miss-toggle').innerText = nearMissEnabled ? 'ON' : 'OFF';
  document.getElementById('near-miss-toggle').classList.toggle('active', nearMissEnabled);
  document.getElementById('sfx-vol-input').value = sfxVolume;
  document.getElementById('l-sfx-vol').innerText = sfxVolume + '%';
}

function toggleAnticipationFx() {
  anticipationFxEnabled = !anticipationFxEnabled;
  try { localStorage.setItem('mm_anticipation_enabled', anticipationFxEnabled ? '1' : '0'); } catch (e) {}
  document.getElementById('anticipation-toggle').innerText = anticipationFxEnabled ? 'ON' : 'OFF';
  document.getElementById('anticipation-toggle').classList.toggle('active', anticipationFxEnabled);
}

function toggleNearMiss() {
  nearMissEnabled = !nearMissEnabled;
  try { localStorage.setItem('mm_near_miss_enabled', nearMissEnabled ? '1' : '0'); } catch (e) {}
  document.getElementById('near-miss-toggle').innerText = nearMissEnabled ? 'ON' : 'OFF';
  document.getElementById('near-miss-toggle').classList.toggle('active', nearMissEnabled);
}

function setSfxVolume(v) {
  sfxVolume = parseInt(v, 10);
  document.getElementById('l-sfx-vol').innerText = sfxVolume + '%';
  try { localStorage.setItem('mm_sfx_vol', sfxVolume); } catch (e) {}
  if (sfxGain) sfxGain.gain.setTargetAtTime(sfxVolume / 100, audioCtx.currentTime, 0.05);
}

function ensureSfxBus() {
  if (!audioCtx) return null;
  if (!sfxGain) {
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = sfxVolume / 100;
    sfxGain.connect(audioCtx.destination);
  }
  return sfxGain;
}

let reverbImpulseBuffer = null;
let reverbSendGain = null;

function getReverbImpulse() {
  if (reverbImpulseBuffer) return reverbImpulseBuffer;
  // Synthesized impulse response (exponentially-decaying noise) - no audio
  // asset needed, consistent with every other sound in this file.
  const len = Math.ceil(audioCtx.sampleRate * 2.2);
  const buffer = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  reverbImpulseBuffer = buffer;
  return buffer;
}

function ensureReverbSend() {
  const bus = ensureSfxBus();
  if (!bus) return null;
  if (!reverbSendGain) {
    const convolver = audioCtx.createConvolver();
    convolver.buffer = getReverbImpulse();
    reverbSendGain = audioCtx.createGain();
    reverbSendGain.gain.value = 0.55;
    reverbSendGain.connect(convolver);
    convolver.connect(bus);
  }
  return reverbSendGain;
}

function playRiserSound(durationS) {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const tail = durationS + 0.35;

  // Pan the riser across the stereo field, speeding up as it builds (same
  // trick film sound design uses to pull attention) - routed in front of
  // the bus so both layers below move together.
  const panner = audioCtx.createStereoPanner();
  panner.connect(bus);
  const panLfo = audioCtx.createOscillator();
  panLfo.type = 'sine';
  const panLfoGain = audioCtx.createGain();
  panLfoGain.gain.value = 0.85;
  panLfo.connect(panLfoGain);
  panLfoGain.connect(panner.pan);
  panLfo.frequency.setValueAtTime(0.3, now);
  panLfo.frequency.exponentialRampToValueAtTime(3.2, now + durationS);
  panLfo.start(now);
  panLfo.stop(now + tail);

  // Main body: filtered noise that starts muffled and quiet, then opens up
  // in brightness and volume as it builds - the standard "cinematic riser"
  // technique. A raw sawtooth/square tone sweep is harmonic-rich and reads
  // as a buzzy drone (a "bee in your ear") when sustained for a few
  // seconds; filtered noise builds the same sense of rising tension
  // without that buzz.
  const bufferSize = Math.ceil(audioCtx.sampleRate * tail);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(200, now);
  filter.frequency.exponentialRampToValueAtTime(3200, now + durationS);

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.18, now + durationS * 0.9);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
  noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(panner);

  // Soft sine undertone: adds a sense of pitch rising without the harmonics
  // a sawtooth/square would add.
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(260, now + durationS);
  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.0001, now);
  oscGain.gain.exponentialRampToValueAtTime(0.09, now + durationS * 0.85);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
  osc.connect(oscGain); oscGain.connect(panner);

  noise.start(now); noise.stop(now + tail);
  osc.start(now); osc.stop(now + tail);

  scheduleHeartbeat(durationS);
}

function scheduleHeartbeat(durationS) {
  // A low rhythmic thump that speeds up through the build-up - the
  // thriller-score trick for perceived urgency, distinct from the riser's
  // continuous pitch/brightness sweep. Scheduled all at once up front using
  // precise Web Audio timestamps (accurate; a setTimeout loop would drift).
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const minInterval = 0.14;
  const maxInterval = 0.62;
  let t = 0;
  while (t < durationS) {
    const frac = t / durationS;
    playHeartbeatThump(now + t);
    const interval = maxInterval - (maxInterval - minInterval) * (frac * frac);
    t += interval;
  }
}

function playHeartbeatThump(startTime) {
  const bus = ensureSfxBus();
  if (!bus) return;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(70, startTime);
  g.gain.setValueAtTime(0.0001, startTime);
  g.gain.exponentialRampToValueAtTime(0.16, startTime + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);
  osc.start(startTime);
  osc.stop(startTime + 0.15);
}

function playFizzleSound() {
  const bus = ensureSfxBus();
  if (!bus) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(480, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.5);
  g.gain.setValueAtTime(0.22, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.start(now);
  osc.stop(now + 0.6);
}

function playChimeSound(scale) {
  const bus = ensureSfxBus();
  if (!bus) return;
  scale = scale || 1.0;
  const now = audioCtx.currentTime;
  const notes = scale >= 1.3
    ? [523.25, 659.25, 783.99, 1046.5, 1318.5] // mega gets a fifth, higher note
    : [523.25, 659.25, 783.99, 1046.5];
  const reverbSend = scale >= 1.3 ? ensureReverbSend() : null; // mega only: richer, more "epic" tail
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(bus);
    if (reverbSend) g.connect(reverbSend);
    const t0 = now + i * 0.09;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.min(0.45, 0.255 * scale), t0 + 0.02); // base is already 15% quieter
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.start(t0);
    osc.stop(t0 + 0.55);
  });
}

function playBassDropSound(scale) {
  const bus = ensureSfxBus();
  if (!bus) return;
  scale = scale || 1.0;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  const g = audioCtx.createGain();
  osc.connect(g); g.connect(bus);
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(42, now + 0.25); // fast pitch drop - the "thump"
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.min(0.85, 0.5 * scale), now + 0.02); // fast attack, felt more than heard
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.start(now);
  osc.stop(now + 0.6);
}

function runAnticipationBuildUp(durationS, isReal) {
  if (!anticipationFxEnabled) return;
  anticipationActive = true;
  const runId = ++anticipationRunId;
  const theater = document.getElementById('theater-box');
  theater.style.transition = 'none';
  playRiserSound(durationS);
  const start = performance.now();

  function tick() {
    if (runId !== anticipationRunId) return;
    const elapsed = (performance.now() - start) / 1000;
    const progress = Math.min(1, elapsed / durationS);
    const intensity = progress * progress; // ease-in: stays subtle, then ramps hard near the end
    const freq = 2 + intensity * 10;
    const glow = 10 + intensity * 55;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * freq);
    theater.style.boxShadow = `0 0 ${(glow * pulse).toFixed(1)}px rgba(255,70,30,${(0.25 + intensity * 0.55).toFixed(2)})`;
    // Smooth, slow-sine glow on every tile (not a flicker/strobe - frequency
    // here tops out around 7Hz and the transition is a continuous sine, well
    // outside the 3-30Hz flash range that can trigger photosensitive seizures)
    // so the eye is drawn to the grid without any rapid on/off flashing.
    const tileGlowPx = (6 + intensity * 20) * pulse;
    const tileGlowAlpha = (0.15 + intensity * 0.5).toFixed(2);
    tileElements.forEach(t => { t.style.boxShadow = `0 0 ${tileGlowPx.toFixed(1)}px rgba(255,130,40,${tileGlowAlpha})`; });
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else if (!isReal) {
      fizzleAnticipation(runId);
    } else {
      // Peak reached before the real jackpot landed yet - hold, then a safety
      // net in case the expected payoff status update never arrives.
      setTimeout(() => fizzleAnticipation(runId), HONEST_BUILD_SAFETY_MS);
    }
  }
  requestAnimationFrame(tick);
}

function clearTileGlow() {
  tileElements.forEach(t => { t.style.boxShadow = ''; });
}

function fizzleAnticipation(runId) {
  if (runId !== anticipationRunId || !anticipationActive) return;
  const theater = document.getElementById('theater-box');
  theater.style.transition = 'box-shadow 0.6s ease';
  theater.style.boxShadow = 'none';
  clearTileGlow();
  theater.classList.add('glitch');
  playFizzleSound();
  setTimeout(() => {
    theater.classList.remove('glitch');
    theater.style.transition = '';
    anticipationActive = false;
  }, 650);
}

// Jackpot tiers: magnitude is uncertain too, not just timing - bigger tiers
// get a brighter flash, a fuller chime, more bass, a bigger floater burst,
// and (mega only) a brief screen shake. Picked client-side purely for the
// celebration's scale; doesn't affect what actually gets selected.
const JACKPOT_TIERS = [
  { name: 'small', weight: 65, flash: 1.0, chime: 1.0, burst: 1.0, bass: 1.0, shake: false },
  { name: 'medium', weight: 28, flash: 1.3, chime: 1.15, burst: 1.6, bass: 1.25, shake: false },
  { name: 'mega', weight: 7, flash: 1.7, chime: 1.3, burst: 2.4, bass: 1.6, shake: true },
];
const MILESTONE_TIER = { name: 'milestone', flash: 2.2, chime: 1.5, burst: 3.5, bass: 2.0, shake: true };
const MILESTONE_COUNTS = [5, 10, 25, 50, 100, 200, 500, 1000];
const STREAK_RESET_MS = 180000; // 3 minutes without a jackpot resets the streak back to 0
const TIER_REVEAL_DELAYS = [70, 70, 80, 90, 110, 140, 180, 230, 320]; // speeds up then settles, like a reel stopping
const TIER_LABELS = { small: 'JACKPOT', medium: 'BIG JACKPOT', mega: 'MEGA JACKPOT', milestone: 'MILESTONE' };
let jackpotStreak = 0;
let lastJackpotAt = 0;
let totalJackpotCount = 0;

function pickJackpotTier() {
  const total = JACKPOT_TIERS.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * total;
  for (const tier of JACKPOT_TIERS) {
    if (r < tier.weight) return tier;
    r -= tier.weight;
  }
  return JACKPOT_TIERS[0];
}

function registerJackpotStreak() {
  const now = Date.now();
  if (now - lastJackpotAt > STREAK_RESET_MS) jackpotStreak = 0;
  jackpotStreak++;
  lastJackpotAt = now;
  const el = document.getElementById('jackpot-streak');
  if (el) el.innerText = jackpotStreak > 1 ? ('🔥 ' + jackpotStreak) : '';
  return jackpotStreak;
}

function registerMilestone() {
  totalJackpotCount++;
  return MILESTONE_COUNTS.includes(totalJackpotCount) ? totalJackpotCount : null;
}

// Rolling tier reveal: flickers through tier names before settling on the
// real one, like a slot-machine reel - a second layer of dopamine-relevant
// uncertainty (how big, not just whether) resolved right before the actual
// celebration fires.
function revealTier(tier, onDone) {
  const el = document.getElementById('tier-reveal');
  const order = ['small', 'medium', 'mega'];
  el.style.display = 'block';
  requestAnimationFrame(() => el.classList.add('show'));
  let i = 0;
  function step(n) {
    const isLast = n >= TIER_REVEAL_DELAYS.length - 1;
    const name = isLast ? tier.name : order[i++ % order.length];
    el.innerText = TIER_LABELS[name] || name.toUpperCase();
    el.className = 'show tier-' + name;
    if (!isLast) {
      setTimeout(() => step(n + 1), TIER_REVEAL_DELAYS[n]);
    } else {
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => { el.style.display = 'none'; }, 300);
        onDone();
      }, 500);
    }
  }
  step(0);
}

function runPayoff() {
  anticipationRunId++; // invalidate any in-flight build-up loop (real or fake)
  anticipationActive = false;
  clearTileGlow();
  const milestoneCount = registerMilestone();
  const tier = milestoneCount ? MILESTONE_TIER : pickJackpotTier();
  const streak = registerJackpotStreak();
  revealTier(tier, () => applyPayoffEffects(tier, streak, milestoneCount));
}

function applyPayoffEffects(tier, streak, milestoneCount) {
  const theater = document.getElementById('theater-box');
  theater.style.setProperty('--flash-opacity', Math.min(0.9, 0.6 * tier.flash).toFixed(2));
  theater.style.setProperty('--flash-duration', (0.65 * Math.min(1.3, tier.flash)).toFixed(2) + 's');
  theater.style.transition = 'box-shadow 0.5s ease';
  theater.style.boxShadow = 'none';
  theater.classList.add('payoff-flash');
  if (tier.shake) {
    theater.classList.add('shake-mega');
    setTimeout(() => theater.classList.remove('shake-mega'), 450);
  }
  setTimeout(() => { theater.classList.remove('payoff-flash'); theater.style.transition = ''; }, 650);

  // Afterglow: a slow-fading warm wash instead of snapping straight back to
  // normal, so the peak lingers a little rather than cutting off instantly.
  theater.classList.remove('afterglow');
  void theater.offsetWidth; // force reflow so the animation restarts if one was already fading
  theater.style.setProperty('--afterglow-duration', (milestoneCount ? 22 : 10 + tier.flash * 4) + 's');
  theater.classList.add('afterglow');

  uiFlare();
  playChimeSound(tier.chime);
  playBassDropSound(tier.bass);
  burstExtraFloaters(tier.burst);
  const label = milestoneCount ? ('🏆 MILESTONE: ' + milestoneCount + ' JACKPOTS!') : '🎰 ' + (tier.name === 'mega' ? 'MEGA JACKPOT' : tier.name === 'medium' ? 'Jackpot!' : 'Jackpot');
  toast(label + (streak > 1 ? ' (streak ' + streak + ')' : ''));
}

function handleAnticipationStatus(d) {
  if (anticipationFxEnabled) {
    if (d.barrage > 0 && !anticipationActive) {
      runAnticipationBuildUp(Math.max(1.5, d.barrage * 1.8), true);
    }
    if (d.jackpot && !lastKnownJackpot) {
      runPayoff();
    }
  }
  lastKnownBarrage = d.barrage;
  lastKnownJackpot = d.jackpot;
}

function maybeTriggerFakeNearMiss() {
  if (!anticipationFxEnabled || !nearMissEnabled || anticipationActive) return;
  if (lastKnownBarrage > 0 || lastKnownJackpot) return; // don't step on a real one
  if (Math.random() < FAKE_NEAR_MISS_PROBABILITY) {
    runAnticipationBuildUp(FAKE_NEAR_MISS_BUILD_S, false);
  }
}

// ---- Auto-Pilot (experimental) ----
// A scripted session arc - calm, then building, a climax, then cooldown,
// repeating - that ramps pace, barrage/jackpot odds, mosaic, and the
// floating-overlay count over time instead of those staying wherever you
// last set them. Driven entirely from this tab by re-using the existing
// per-session controls (pace(), /api/intensity, toggleMosaic/setFxCount),
// so it has no server-side component of its own.
const AUTOPILOT_TICK_MS = 4000;
const AUTOPILOT_KEYFRAMES = [
  { t: 0.00, pace: 3, barrage: 0.01, jackpot: 0.02, mosaic: false, fx: 1, novelty: 0.10 },
  { t: 0.35, pace: 2, barrage: 0.03, jackpot: 0.06, mosaic: false, fx: 2, novelty: 0.15 },
  { t: 0.60, pace: 1, barrage: 0.10, jackpot: 0.18, mosaic: true, fx: 4, novelty: 0.30 },
  { t: 0.75, pace: 0, barrage: 0.22, jackpot: 0.35, mosaic: true, fx: 6, novelty: 0.50 },
  { t: 0.85, pace: 1, barrage: 0.08, jackpot: 0.15, mosaic: true, fx: 3, novelty: 0.30 },
  { t: 1.00, pace: 3, barrage: 0.01, jackpot: 0.02, mosaic: false, fx: 1, novelty: 0.10 },
];

let autopilotEnabled = false;
let autopilotCycleMinutes = 6;
let autopilotStartTime = 0;
let autopilotTimer = null;
let autopilotLastPace = null;
let autopilotLastMosaic = null;

function loadAutopilotPrefs() {
  try {
    const cyc = localStorage.getItem('mm_autopilot_minutes');
    if (cyc !== null) autopilotCycleMinutes = parseFloat(cyc);
  } catch (e) {}
  // Deliberately doesn't auto-resume "enabled" across reloads - starting an
  // open-ended ramping mode silently on page load would be surprising.
  document.getElementById('autopilot-minutes-input').value = autopilotCycleMinutes;
  document.getElementById('l-autopilot-minutes').innerText = autopilotCycleMinutes + ' min';
  document.getElementById('autopilot-toggle').innerText = 'OFF';
}

function lerp(a, b, t) { return a + (b - a) * t; }

function autopilotPhaseAt(frac) {
  const kfs = AUTOPILOT_KEYFRAMES;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (frac >= kfs[i].t && frac <= kfs[i + 1].t) {
      const span = kfs[i + 1].t - kfs[i].t || 1;
      return { a: kfs[i], b: kfs[i + 1], lf: (frac - kfs[i].t) / span };
    }
  }
  return { a: kfs[0], b: kfs[0], lf: 0 };
}

function autopilotTick() {
  if (!autopilotEnabled) return;
  const cycleS = Math.max(30, autopilotCycleMinutes * 60);
  const elapsed = (Date.now() - autopilotStartTime) / 1000;
  const frac = (elapsed % cycleS) / cycleS;
  const { a, b, lf } = autopilotPhaseAt(frac);

  const barrageP = lerp(a.barrage, b.barrage, lf);
  const jackpotP = lerp(a.jackpot, b.jackpot, lf);
  const noveltyBonus = lerp(a.novelty, b.novelty, lf);
  const fxTarget = Math.round(lerp(a.fx, b.fx, lf));
  const targetPace = lf < 0.5 ? a.pace : b.pace;
  const targetMosaic = lf < 0.5 ? a.mosaic : b.mosaic;

  fetch('/api/intensity?barrage=' + barrageP.toFixed(3) + '&jackpot=' + jackpotP.toFixed(3));
  fetch('/api/novelty?bonus=' + noveltyBonus.toFixed(3));
  if (targetPace !== autopilotLastPace) { autopilotLastPace = targetPace; pace(targetPace, true); }
  if (targetMosaic !== autopilotLastMosaic) {
    autopilotLastMosaic = targetMosaic;
    if (mosaicEnabled !== targetMosaic) toggleMosaic();
  }
  if (fxCount !== fxTarget) setFxCount(fxTarget);
}

function startAutopilot() {
  autopilotStartTime = Date.now();
  autopilotLastPace = null;
  autopilotLastMosaic = null;
  if (!fxEnabled) toggleFx();
  autopilotTick();
  autopilotTimer = setInterval(autopilotTick, AUTOPILOT_TICK_MS);
}

function stopAutopilot() {
  clearInterval(autopilotTimer);
  autopilotTimer = null;
}

function toggleAutopilot() {
  autopilotEnabled = !autopilotEnabled;
  document.getElementById('autopilot-toggle').innerText = autopilotEnabled ? 'ON' : 'OFF';
  document.getElementById('autopilot-toggle').classList.toggle('active', autopilotEnabled);
  if (autopilotEnabled) startAutopilot(); else stopAutopilot();
}

function setAutopilotMinutes(v) {
  autopilotCycleMinutes = parseFloat(v);
  document.getElementById('l-autopilot-minutes').innerText = autopilotCycleMinutes + ' min';
  try { localStorage.setItem('mm_autopilot_minutes', autopilotCycleMinutes); } catch (e) {}
}

// ---- Session timer (opt-in, off by default) ----
// Just a quiet elapsed-time readout - no nagging, no popups. Entirely
// optional; exists so time awareness is available at a glance during an
// intense Auto-Pilot climax if you want it, without fighting the rest of
// the experience if you don't.
let sessionTimerEnabled = false;
const sessionStartMs = Date.now();

function loadSessionTimerPref() {
  try { sessionTimerEnabled = localStorage.getItem('mm_session_timer') === '1'; } catch (e) {}
  applySessionTimerUi();
}

function toggleSessionTimer() {
  sessionTimerEnabled = !sessionTimerEnabled;
  try { localStorage.setItem('mm_session_timer', sessionTimerEnabled ? '1' : '0'); } catch (e) {}
  applySessionTimerUi();
}

function applySessionTimerUi() {
  const btn = document.getElementById('session-timer-toggle');
  btn.innerText = sessionTimerEnabled ? 'ON' : 'OFF';
  btn.classList.toggle('active', sessionTimerEnabled);
  document.getElementById('session-timer-readout').style.display = sessionTimerEnabled ? 'block' : 'none';
}

function tickSessionTimer() {
  if (!sessionTimerEnabled) return;
  const elapsedS = Math.floor((Date.now() - sessionStartMs) / 1000);
  const h = Math.floor(elapsedS / 3600);
  const m = Math.floor((elapsedS % 3600) / 60);
  const s = elapsedS % 60;
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('session-timer-readout').innerText = '⏱️ ' + (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
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
  clearTimeout(bonusWindowTimer);
  bonusWindowTileIndex = -1; // old tile references are about to be discarded
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
  handleAnticipationStatus(d);

  const persistentBadges = new Set([
    'preload-toggle', 'mosaic-toggle', 'fx-toggle', 'fx-source-dedicated', 'fx-source-library', 'fx-source-both',
    'anticipation-toggle', 'near-miss-toggle', 'autopilot-toggle', 'session-timer-toggle',
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
function pace(v, quiet) {
  const labels = ['10s Hard Switching', '5s - 30s (Rapid)', '30s - 120s (Balanced)', 'Full Video (Continuous)'];
  document.getElementById('l-pace').innerText = labels[v];
  document.getElementById('pace-input').value = v;
  fetch('/api/pace?mode=' + v).then(() => { if (!quiet) toast('Pace updated'); });
}
function vec(k, v) { fetch('/api/vector?key=' + k + '&val=' + v); }
function rateScreen(i, dir) {
  if (dir === 'up' && i === bonusWindowTileIndex && Date.now() < bonusWindowExpireAt) {
    clearBonusWindow(i);
    triggerMiniPayoff();
  }
  fetch('/api/rate?screen=' + i + '&dir=' + dir).then(() => toast(dir === 'up' ? '👍 Reinforced' : '👎 Penalized', dir !== 'up'));
}

// ---- Interactive bonus window ----
// Occasionally one tile gets a golden pulse; rating it 👍 within the window
// triggers a small payoff. Acting on it is what pays off, not passively
// waiting - a distinct ("operant") reward trigger from the purely passive
// jackpot/near-miss system above.
const BONUS_WINDOW_CHECK_MS = 25000;
const BONUS_WINDOW_PROBABILITY = 0.3;
const BONUS_WINDOW_DURATION_MS = 5000;
let bonusWindowTileIndex = -1;
let bonusWindowExpireAt = 0;
let bonusWindowTimer = null;

function maybeTriggerBonusWindow() {
  if (!anticipationFxEnabled) return;
  if (bonusWindowTileIndex >= 0 || !tileElements.length) return;
  if (Math.random() < BONUS_WINDOW_PROBABILITY) {
    const idx = Math.floor(Math.random() * tileElements.length);
    bonusWindowTileIndex = idx;
    bonusWindowExpireAt = Date.now() + BONUS_WINDOW_DURATION_MS;
    const tile = tileElements[idx];
    if (tile) tile.classList.add('bonus-window');
    bonusWindowTimer = setTimeout(() => clearBonusWindow(idx), BONUS_WINDOW_DURATION_MS);
  }
}

function clearBonusWindow(idx) {
  const tile = tileElements[idx];
  if (tile) tile.classList.remove('bonus-window');
  if (bonusWindowTileIndex === idx) bonusWindowTileIndex = -1;
  clearTimeout(bonusWindowTimer);
}

function triggerMiniPayoff() {
  playChimeSound(0.7);
  burstExtraFloaters(0.5);
  toast('✨ Bonus!');
}
function rateAudio(d) { fetch('/api/rate_audio?dir=' + d).then(() => toast(d === 'up' ? '🔊 Audio rated up' : '🔇 Audio penalized', d !== 'up')); }
function nextAudio() { fetch('/api/next_audio').then(() => toast('⏭️ Audio Skipped')); }

window.addEventListener('resize', () => { if (mosaicEnabled) layoutMosaic(); });
setInterval(() => { if (mosaicEnabled) layoutMosaic(); }, MOSAIC_REFLOW_INTERVAL_MS);
setInterval(maybeTriggerFakeNearMiss, FAKE_NEAR_MISS_CHECK_MS);
setInterval(maybeTriggerBonusWindow, BONUS_WINDOW_CHECK_MS);
setInterval(tickSessionTimer, 1000);

window.onload = () => {
  restorePanelState();
  loadMosaicPref();
  loadFxPrefs();
  loadAnticipationPrefs();
  loadAutopilotPrefs();
  loadSessionTimerPref();
  overlayEl = document.getElementById('overlay-audio');
  loadVolumePrefs();
  armAutoUnlock();
  fetch('/api/status').then(r => r.json()).then(render);
  connectStream();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
};
