// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Crop focus and Gravity.
//
// Crop focus (Mosaic): Mosaic fills each tile edge to edge, so part of every
// clip is cut off. Instead of always cutting evenly from both sides, each
// tile's crop slides toward where the action is (Clip DNA motion track), so
// the cut-off part is the empty part. Glided over a couple of seconds.
//
// Gravity: the tile where the most is happening swells a little over its
// neighbours. It's led by the movement in the clips (Content Pulse); hearts
// only add a small nudge that fades within seconds, so hearting a run of
// tiles doesn't shuffle anything. One tile at a time, and it holds for a
// while before another can take over.

const gravityOn = { cropFocus: true, gravity: true };
const cropPos = []; // tile -> { x, y } in 0..100 (object-position %)
const gravityLevel = []; // tile -> smoothed movement
const gravityNudge = []; // tile -> heart nudge, decaying
let gravityHero = -1;
let gravityHeroSince = 0;
const GRAVITY_TICK_MS = 150;

function gravityPaused() {
  return spotlightTileIndex >= 0 || anticipationActive || finaleActive || lastKnownBarrage > 0 || floaterBarrageActive || document.hidden
    || (typeof activeMoment !== 'undefined' && (activeMoment === 'drop' || activeMoment === 'focus' || activeMoment === 'favorite'));
}

function cropFocusTick(dt) {
  const on = gravityOn.cropFocus && mosaicEnabled;
  tileElements.forEach((tile, i) => {
    const videos = tile ? tile.querySelectorAll('video:not(.preload)') : [];
    if (!on) {
      if (cropPos[i]) { videos.forEach((v) => { v.style.objectPosition = ''; }); cropPos[i] = null; }
      return;
    }
    const dna = contentDna(i);
    const vid = getTileVideo(i);
    let tx = 50, ty = 50;
    if (dna && dna.track && dna.track.length && vid) {
      const k = Math.max(0, Math.min(dna.track.length - 1, Math.floor((vid.currentTime || 0) / 2)));
      const [, motion, cx, cy] = dna.track[k];
      const sure = Math.min(1, motion / 0.02); // little movement = no clear subject: stay central
      tx = 50 + (cx * 100 - 50) * sure;
      ty = 50 + (cy * 100 - 50) * sure;
    }
    const cur = cropPos[i] || { x: 50, y: 50 };
    const a = 1 - Math.exp(-dt / 2200);
    cropPos[i] = { x: cur.x + (tx - cur.x) * a, y: cur.y + (ty - cur.y) * a };
    const pos = cropPos[i].x.toFixed(1) + '% ' + cropPos[i].y.toFixed(1) + '%';
    videos.forEach((v) => { if (v.style.objectPosition !== pos) v.style.objectPosition = pos; });
  });
}

function gravityHeart(i) {
  gravityNudge[i] = Math.min(TUNING.GRAVITY_HEART_NUDGE * 2.5, (gravityNudge[i] || 0) + TUNING.GRAVITY_HEART_NUDGE);
}

function setGravityHero(idx) {
  if (gravityHero === idx) return;
  if (gravityHero >= 0 && tileElements[gravityHero]) tileElements[gravityHero].classList.remove('gravity-hero');
  gravityHero = idx;
  gravityHeroSince = Date.now();
  const tile = tileElements[idx];
  if (!tile) return;
  // Grows from its centre; at a screen edge it shifts inward by the overhang
  // so it stays on screen (the translate property composes with the
  // tile's own transform, e.g. Spotlight's).
  const grid = document.getElementById('screen-grid').getBoundingClientRect();
  const r = tile.getBoundingClientRect();
  const s = TUNING.GRAVITY_SCALE;
  const overX = ((s - 1) / 2) * r.width, overY = ((s - 1) / 2) * r.height;
  const tx = r.left - grid.left < 4 ? overX : grid.right - r.right < 4 ? -overX : 0;
  const ty = r.top - grid.top < 4 ? overY : grid.bottom - r.bottom < 4 ? -overY : 0;
  tile.style.setProperty('--gravity-s', s.toFixed(3));
  tile.style.setProperty('--gravity-tx', tx.toFixed(1) + 'px');
  tile.style.setProperty('--gravity-ty', ty.toFixed(1) + 'px');
  tile.classList.add('gravity-hero');
}

function clearGravity() {
  if (gravityHero >= 0 && tileElements[gravityHero]) tileElements[gravityHero].classList.remove('gravity-hero');
  gravityHero = -1;
}

function gravityTick(dt) {
  const half = Math.pow(0.5, dt / 4000);
  for (let i = 0; i < tileElements.length; i++) {
    gravityNudge[i] = (gravityNudge[i] || 0) * half;
    const v = contentTileLevels[i];
    if (v != null) gravityLevel[i] = gravityLevel[i] == null ? v : gravityLevel[i] + (v - gravityLevel[i]) * (1 - Math.exp(-dt / 1500));
  }
  gravityLevel.length = gravityNudge.length = tileElements.length;
  if (!gravityOn.gravity || tileElements.length < 3 || gravityPaused()) { clearGravity(); return; }
  const score = (i) => (gravityLevel[i] || 0) + (gravityNudge[i] || 0);
  let best = -1;
  for (let i = 0; i < tileElements.length; i++) if (best < 0 || score(i) > score(best)) best = i;
  if (best < 0 || score(best) < 0.35) { if (gravityHero >= 0 && Date.now() - gravityHeroSince > TUNING.GRAVITY_MIN_HOLD_MS) clearGravity(); return; }
  if (gravityHero < 0 || gravityHero >= tileElements.length) { setGravityHero(best); return; }
  // A challenger has to clearly lead, and the current one has to have had its moment.
  if (best !== gravityHero && Date.now() - gravityHeroSince > TUNING.GRAVITY_MIN_HOLD_MS && score(best) > score(gravityHero) * 1.25) setGravityHero(best);
}

let gravityLastAt = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(500, now - gravityLastAt);
  gravityLastAt = now;
  if (!tileElements.length) return;
  cropFocusTick(dt);
  gravityTick(dt);
}, GRAVITY_TICK_MS);

// ---- prefs ----
function loadGravityPrefs() {
  const p = loadJsonPref('mm_gravity', {});
  Object.keys(gravityOn).forEach((k) => { if (typeof p[k] === 'boolean') gravityOn[k] = p[k]; });
  updateGravityUi();
}

function toggleGravityPref(k) {
  gravityOn[k] = !gravityOn[k];
  saveJsonPref('mm_gravity', gravityOn);
  updateGravityUi();
}

function updateGravityUi() {
  Object.keys(gravityOn).forEach((k) => setToggleBadge('gravity-' + k + '-toggle', gravityOn[k]));
  const el = document.getElementById('mosaic-crop-status');
  if (el) {
    if (!mosaicEnabled) { el.innerText = 'Mosaic Fit is off (Screen → Layout & Pace).'; return; }
    const grid = document.getElementById('screen-grid').getBoundingClientRect();
    const aspects = aspectRatios.slice(0, tileElements.length);
    const old = evenSplitCrop(aspects, grid.width, grid.height);
    el.innerText = 'Cropped away right now: ' + Math.round(mosaicCropNow * 100) + '% of each clip (the old even rows would cut ' + Math.round(old * 100) + '%).';
  }
}
setInterval(() => { if (document.getElementById('mosaic-crop-status')) updateGravityUi(); }, 3000);
