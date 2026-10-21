// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Tile gestures: swipe a tile to swap just that one, long-press to pin it
// (keeps its clip until you long-press again), mouse wheel to change that
// tile's speed, double-tap for More like this. The heart/dislike buttons
// keep their own behaviour, and a gesture never also counts as a tap on a
// catch/bonus/locked tile.

const GESTURE_MOVE_SLOP_PX = 12;
const TILE_SPEED_MIN = 0.25;
const TILE_SPEED_MAX = 3;
let tileGesturesEnabled = true;
const tileUserSpeed = []; // per tile: the wheel's speed multiplier (reset when the clip changes)
const tileSwipeAt = []; // per tile: when it was last swiped (its swap skips Cut on the Beat)
let gesture = null;
let suppressTileClickUntil = 0;

function gestureTile(e) {
  const tile = e.target.closest && e.target.closest('.tile');
  if (!tile || e.target.closest('button, .tile-actions')) return null;
  const idx = tileElements.indexOf(tile);
  return idx < 0 ? null : { tile, idx };
}

function endGestureVisual() {
  if (!gesture) return;
  gesture.tile.classList.remove('swiping');
  gesture.tile.style.removeProperty('--swipe-x');
}

document.addEventListener('pointerdown', (e) => {
  if (!tileGesturesEnabled || e.button !== 0) return;
  const hit = gestureTile(e);
  if (!hit) return;
  gesture = { tile: hit.tile, idx: hit.idx, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  gesture.longTimer = setTimeout(() => {
    if (!gesture || gesture.moved) return;
    const idx = gesture.idx;
    endGestureVisual();
    gesture = null;
    suppressTileClickUntil = Date.now() + 600;
    toggleTilePin(idx);
  }, TUNING.GESTURE_LONG_PRESS_MS);
}, true);

document.addEventListener('pointermove', (e) => {
  if (!gesture) return;
  const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
  if (!gesture.moved && Math.hypot(dx, dy) > GESTURE_MOVE_SLOP_PX) { gesture.moved = true; clearTimeout(gesture.longTimer); }
  if (gesture.moved && Math.abs(dx) > Math.abs(dy)) {
    gesture.tile.classList.add('swiping');
    gesture.tile.style.setProperty('--swipe-x', Math.max(-60, Math.min(60, dx * 0.4)).toFixed(0) + 'px');
  }
}, true);

document.addEventListener('pointerup', (e) => {
  if (!gesture) return;
  clearTimeout(gesture.longTimer);
  const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
  const quick = performance.now() - gesture.t < 900;
  const idx = gesture.idx;
  endGestureVisual();
  gesture = null;
  if (quick && Math.abs(dx) >= TUNING.GESTURE_SWIPE_MIN_PX && Math.abs(dy) < Math.abs(dx) * 0.6) {
    suppressTileClickUntil = Date.now() + 500;
    swipeTile(idx, dx > 0 ? 1 : -1);
  }
}, true);

document.addEventListener('pointercancel', () => {
  if (!gesture) return;
  clearTimeout(gesture.longTimer);
  endGestureVisual();
  gesture = null;
}, true);

// A swipe or long-press must not also land as a click on the tile.
document.addEventListener('click', (e) => {
  if (Date.now() < suppressTileClickUntil && e.target.closest && e.target.closest('.tile')) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

document.addEventListener('wheel', (e) => {
  if (!tileGesturesEnabled) return;
  const hit = gestureTile(e);
  if (!hit) return;
  e.preventDefault();
  const cur = tileUserSpeed[hit.idx] || 1;
  setTileUserSpeed(hit.idx, cur + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

// Double-tap: More like this - look-alike clips (Clip DNA) on this tile's
// neighbours now, and picks lean toward the same look for a minute.
let likeThisTile = -1;
let likeThisTimer = null;
// A stray click-drag on a tile used to select it (a blue highlight that
// stayed until the clip changed) or start dragging the video out.
document.addEventListener('dragstart', (e) => { if (e.target.closest && e.target.closest('#screen-grid')) e.preventDefault(); }, true);
document.addEventListener('selectstart', (e) => { if (e.target.closest && e.target.closest('#screen-grid')) e.preventDefault(); }, true);

document.addEventListener('dblclick', (e) => {
  if (!tileGesturesEnabled) return;
  const hit = gestureTile(e);
  if (!hit) return;
  e.preventDefault();
  moreLikeThis(hit.idx);
}, true);

function moreLikeThis(idx) {
  const tile = tileElements[idx];
  if (!tile) return Promise.resolve(false);
  const ms = TUNING.LIKE_THIS_MS;
  return fetch('/api/dna/like_this?screen=' + idx + '&s=' + Math.round(ms / 1000)).then((r) => r.json()).then((d) => {
    if (!d.ok) return false;
    if (!d.placed && d.reason) { toast('✨ ' + d.reason, true); return false; }
    if (likeThisTile >= 0 && tileElements[likeThisTile]) tileElements[likeThisTile].classList.remove('like-this-source');
    likeThisTile = idx;
    tile.classList.add('like-this-source');
    showClaimRewardLabel(idx, '✨ More like this');
    toast('✨ More like this for ' + Math.round(ms / 1000) + 's');
    try { if (navigator.vibrate) navigator.vibrate([15, 40, 15]); } catch (err) {}
    clearTimeout(likeThisTimer);
    likeThisTimer = setTimeout(() => { if (tileElements[idx]) tileElements[idx].classList.remove('like-this-source'); likeThisTile = -1; }, ms);
    return true;
  }).catch(() => false);
}

function swipeTile(idx, dir) {
  const tile = tileElements[idx];
  if (!tile) return;
  tileSwipeAt[idx] = Date.now();
  tile.classList.remove('tile-pinned');
  tile.classList.add(dir > 0 ? 'swiped-right' : 'swiped-left');
  setTimeout(() => tile.classList.remove('swiped-right', 'swiped-left'), 420);
  fetch('/api/rotate?screen=' + idx + '&swap=1');
}

function toggleTilePin(idx) {
  const tile = tileElements[idx];
  if (!tile) return;
  const on = !tile.classList.contains('tile-pinned');
  tile.classList.toggle('tile-pinned', on);
  const vid = getTileVideo(idx);
  if (vid) vid.loop = on;
  try { if (navigator.vibrate) navigator.vibrate(20); } catch (e) {}
  showClaimRewardLabel(idx, on ? '📌 Pinned' : '📌 Unpinned');
  fetch('/api/pin?screen=' + idx + '&on=' + (on ? 1 : 0));
}

let tileSpeedLabelAt = [];
function setTileUserSpeed(idx, value) {
  const v = Math.round(Math.max(TILE_SPEED_MIN, Math.min(TILE_SPEED_MAX, value)) * 100) / 100;
  const old = tileUserSpeed[idx] || 1;
  if (v === old) return;
  tileUserSpeed[idx] = v;
  const vid = getTileVideo(idx);
  if (tileNaturalBase[idx]) tileNaturalBase[idx] = tileNaturalBase[idx] / old * v;
  if (vid) resolveAndApplyTileSpeed(idx, vid, (tileNaturalBase[idx] || v) * tileSpeedMult(idx));
  const now = Date.now();
  if (now - (tileSpeedLabelAt[idx] || 0) > 150) { tileSpeedLabelAt[idx] = now; showClaimRewardLabel(idx, (v >= 1 ? '⏩ ' : '⏪ ') + v.toFixed(1) + 'x'); }
}

function loadGesturePrefs() {
  tileGesturesEnabled = loadJsonPref('mm_gestures', { enabled: true }).enabled !== false;
  setToggleBadge('gestures-toggle', tileGesturesEnabled);
}

function toggleTileGestures() {
  tileGesturesEnabled = !tileGesturesEnabled;
  saveJsonPref('mm_gestures', { enabled: tileGesturesEnabled });
  setToggleBadge('gestures-toggle', tileGesturesEnabled);
}
