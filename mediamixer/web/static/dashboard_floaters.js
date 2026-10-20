// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Floating overlay FX (floaters) and the Floater Barrage.

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

// Every floater sharing the exact same opacity read as flatter/more
// uniform than intended - each one now gets its own randomized value
// within a band under the configured ceiling, so a handful on screen at
// once show some genuine variety instead of looking like identical
// copies at different positions.
function randomFloaterOpacity() {
  const maxOp = fxOpacity / 100;
  const minOp = maxOp * 0.65; // nudged up per feedback that the floor read as too faint
  return minOp + Math.random() * (maxOp - minOp);
}

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
  fxSprites.forEach(s => { if (s && s.state === 'visible') { s.opacity = randomFloaterOpacity(); s.el.style.opacity = String(s.opacity); } });
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
    const maxX = Math.max(0, vw - sizePx);
    const maxY = Math.max(0, vh - sizePx * 9 / 16);
    const startX = Math.random() * maxX;
    const startY = Math.random() * maxY;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.max(vw, vh) * (0.3 + Math.random() * 0.4);
    // Clamped to the same bounds as the start point - an unclamped
    // endpoint could send a floater well past the edge of the viewport,
    // so for however much of its lifetime remained after that it was
    // just gone, off-screen, before it could actually be enjoyed.
    const endX = Math.max(0, Math.min(maxX, startX + Math.cos(angle) * distance));
    const endY = Math.max(0, Math.min(maxY, startY + Math.sin(angle) * distance));
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
        sprite.opacity = randomFloaterOpacity();
        el.style.opacity = String(sprite.opacity);
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

// ---- Floater Barrage ----
// A rare whole-screen moment: the grid dims nearly to black and ~20
// floaters bloom across it at 80-100% opacity, laid out on a jittered grid
// so they fill the dark space evenly instead of clumping, drifting a little
// while they're up, then everything fades back. Works whether or not the
// regular floaters are on, and leaves the barrage tile-dim alone - it has
// its own full-screen dim layer (#floater-barrage-dim) under #fx-layer.
const FLOATER_BARRAGE_FADE_MS = 1600;
const FLOATER_BARRAGE_STAGGER_MS = 1200; // floaters arrive/leave spread over this
let floaterBarrageActive = false;
let floaterBarrageEndsAt = 0;
let floaterBarrageEls = [];

function maybeTriggerFloaterBarrage() {
  if (floaterBarrageActive || document.hidden || !tileElements.length) return;
  if (Date.now() < floaterBarrageEndsAt + TUNING.FLOATER_BARRAGE_COOLDOWN_MS) return;
  // Never on top of another full-screen moment.
  if (lastKnownBarrage > 0 || anticipationActive || finaleActive || overdriveActive || colorRushActive || spotlightTileIndex >= 0) return;
  if (Math.random() < TUNING.FLOATER_BARRAGE_PROBABILITY * autopilotZoneMultiplier('colorRush')) startFloaterBarrage();
}
startTunableInterval('FLOATER_BARRAGE_CHECK_MS', maybeTriggerFloaterBarrage);

function floaterBarrageSlots(n) {
  // Jittered grid sized to the screen's aspect, n cells picked at random.
  const vw = window.innerWidth, vh = window.innerHeight;
  const cols = Math.max(1, Math.round(Math.sqrt(n * vw / vh)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  const cw = vw / cols, ch = vh / rows;
  return cells.slice(0, n).map(([c, r]) => {
    // Overlap neighbours so the dark fills in; FLOATER_BARRAGE_SIZE_MULT
    // scales them all (1.4 = 40% bigger, per first-look feedback).
    const w = cw * (1.15 + Math.random() * 0.45) * TUNING.FLOATER_BARRAGE_SIZE_MULT;
    const h = w * 9 / 16;
    const cx = (c + 0.5 + (Math.random() - 0.5) * 0.5) * cw;
    const cy = (r + 0.5 + (Math.random() - 0.5) * 0.5) * ch;
    const x = Math.max(-w * 0.1, Math.min(vw - w * 0.9, cx - w / 2));
    const y = Math.max(-h * 0.1, Math.min(vh - h * 0.9, cy - h / 2));
    const drift = vw * (0.015 + Math.random() * 0.03), angle = Math.random() * Math.PI * 2;
    return { x, y, w, h, dx: Math.cos(angle) * drift, dy: Math.sin(angle) * drift };
  });
}

function startFloaterBarrage(durationMs) {
  if (floaterBarrageActive || !tileElements.length) return false;
  const ms = durationMs || TUNING.FLOATER_BARRAGE_MIN_MS + Math.random() * TUNING.FLOATER_BARRAGE_RANGE_MS;
  floaterBarrageActive = true;
  floaterBarrageEndsAt = Date.now() + ms;
  const dim = document.getElementById('floater-barrage-dim');
  dim.style.transition = 'opacity ' + FLOATER_BARRAGE_FADE_MS + 'ms ease';
  dim.style.opacity = String(TUNING.FLOATER_BARRAGE_DIM);
  toast('🌌 Floater Barrage');

  const source = fxSource === 'dedicated' ? pickFxSourceList() : fetchFxList('library');
  source.then((items) => (items && items.length ? items : fetchFxList('library'))).then((items) => {
    if (!floaterBarrageActive || !items || !items.length) return;
    const layer = document.getElementById('fx-layer');
    const pool = items.slice();
    floaterBarrageSlots(Math.round(TUNING.FLOATER_BARRAGE_COUNT)).forEach((slot, i) => {
      if (!pool.length) pool.push(...items);
      const item = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const el = document.createElement('div');
      el.className = 'fx-sprite fx-barrage-sprite';
      el.innerHTML = '<video muted loop playsinline></video>';
      el.style.width = slot.w + 'px';
      el.style.height = slot.h + 'px';
      el.style.transform = `translate(${slot.x}px, ${slot.y}px)`;
      el.style.opacity = '0';
      layer.appendChild(el);
      floaterBarrageEls.push(el);
      const vid = el.querySelector('video');
      vid.onloadedmetadata = () => {
        if (vid.duration && isFinite(vid.duration)) vid.currentTime = Math.random() * vid.duration * 0.6;
      };
      // Only fade in once real frames are playing - 20 clips can't all load
      // instantly, and one revealed early is just a black box on the dark
      // screen. A floater that isn't ready before the fade-out stays hidden.
      const startedAt = Date.now();
      const outAt = ms - FLOATER_BARRAGE_FADE_MS - Math.random() * FLOATER_BARRAGE_STAGGER_MS;
      let revealed = false;
      vid.addEventListener('playing', () => {
        if (revealed || !el.isConnected) return;
        const elapsed = Date.now() - startedAt;
        if (elapsed > outAt - 1500) return; // too late to be worth a flash
        revealed = true;
        setTimeout(() => {
          if (!el.isConnected) return;
          el.style.transition = `transform ${(ms - elapsed) / 1000}s linear, opacity ${FLOATER_BARRAGE_FADE_MS}ms ease`;
          el.style.transform = `translate(${slot.x + slot.dx}px, ${slot.y + slot.dy}px)`;
          el.style.opacity = (0.8 + Math.random() * 0.2).toFixed(2);
        }, Math.random() * Math.max(0, FLOATER_BARRAGE_STAGGER_MS - elapsed));
      });
      vid.src = mediaOrigin(FX_SHARD_OFFSET + 200 + i) + item.base + item.path;
      vid.play().catch(() => {});
      setTimeout(() => { if (el.isConnected) el.style.opacity = '0'; }, outAt);
    });
  });

  setTimeout(endFloaterBarrage, ms);
  return true;
}

function endFloaterBarrage() {
  if (!floaterBarrageActive) return;
  const dim = document.getElementById('floater-barrage-dim');
  dim.style.opacity = '0';
  const els = floaterBarrageEls;
  floaterBarrageEls = [];
  els.forEach((el) => { el.style.opacity = '0'; });
  setTimeout(() => {
    els.forEach((el) => {
      const vid = el.querySelector('video');
      if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); } // release the decoder
      el.remove();
    });
    floaterBarrageActive = false;
  }, FLOATER_BARRAGE_FADE_MS + 100);
}
