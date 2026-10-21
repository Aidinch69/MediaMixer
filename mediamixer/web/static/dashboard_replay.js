// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Heart replays and Callbacks - your hearts brought back as content.
//
// Heart replay: a moment after you heart a tile, the few seconds you just
// hearted play again once, slightly slowed, like an instant replay - then
// it's back to live. A hidden copy of the clip is lined up first (as Hooks
// do), so it never looks like buffering; if it isn't ready in time the
// replay is quietly dropped.
//
// Callbacks: a clip you hearted earlier this session comes back for a few
// seconds on another tile, starting just before the spot you hearted - the
// way a song brings back its chorus.

const replayOn = { replay: true, callbacks: true };
let replay = null; // { idx, el, badge, start, end, ... }
let replayLastAt = 0;
const sessionHeartPos = {}; // path -> clip time of its latest heart this session
const sessionHeartAt = {}; // path -> when (ms) it was last hearted
const callbackCount = {}; // path -> times called back this session
let callbackLastAt = Date.now(); // none in the first couple of minutes
const pendingStartAt = {}; // path -> clip time to start at (read by chooseStartTime)

// Called from rateScreen on every heart.
function onReplayHeart(i) {
  const path = currentPaths[i];
  const vid = getTileVideo(i);
  if (!path || !vid) return;
  sessionHeartPos[path] = vid.currentTime;
  sessionHeartAt[path] = Date.now();
  if (!replayOn.replay || replay || document.hidden) return;
  if (Date.now() - replayLastAt < TUNING.REPLAY_COOLDOWN_MS) return;
  if (Math.random() >= TUNING.REPLAY_CHANCE) return;
  startReplay(i);
}

function startReplay(i) {
  const tile = tileElements[i];
  const vid = getTileVideo(i);
  const path = currentPaths[i];
  if (!tile || !vid || !path || rhythmFxBusyTiles().has(i)) return false;
  const len = TUNING.REPLAY_SECONDS;
  const end = vid.currentTime - 0.3;
  const start = end - len;
  if (start < 0.2) return false;
  replayLastAt = Date.now();
  const el = document.createElement('video');
  el.className = 'fx-replay';
  el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
  el.style.objectFit = getComputedStyle(vid).objectFit;
  el.style.objectPosition = vid.style.objectPosition;
  let ready = false;
  const check = () => { if (el.readyState >= 3 && Math.abs(el.currentTime - start) < 0.2) ready = true; };
  el.addEventListener('loadedmetadata', () => { el.currentTime = start; }, { once: true });
  el.addEventListener('seeked', check);
  el.addEventListener('canplay', check);
  el.addEventListener('canplaythrough', check);
  el.src = mediaOrigin(i) + '/media/' + path + '?tiles=' + tileElements.length + '&cors=1';
  tile.insertBefore(el, vid.nextSibling);
  replay = { idx: i, path, el, badge: null, start, end, shown: false };
  const total = TUNING.REPLAY_DELAY_MS / 1000 + 1.5 + len / TUNING.REPLAY_SPEED + 1;
  fetch('/api/hold?screen=' + i + '&s=' + total.toFixed(1)).catch(() => {});
  const begunAt = Date.now();
  const waitReady = () => {
    if (!replay || replay.el !== el) return;
    if (currentPaths[i] !== path) { endReplay(true); return; }
    if (!ready || Date.now() - begunAt < TUNING.REPLAY_DELAY_MS) {
      if (Date.now() - begunAt > TUNING.REPLAY_DELAY_MS + 1500) { endReplay(true); return; } // not ready - drop it quietly
      setTimeout(waitReady, 80);
      return;
    }
    el.playbackRate = TUNING.REPLAY_SPEED;
    el.play().catch(() => {});
    el.classList.add('shown');
    const badge = document.createElement('div');
    badge.className = 'replay-badge';
    badge.textContent = '↺ REPLAY';
    tile.appendChild(badge);
    replay.badge = badge;
    replay.shown = true;
    if (typeof logEvent === 'function') logEvent('replay', { tile: i, len });
    const watch = () => {
      if (!replay || replay.el !== el) return;
      if (el.currentTime >= end || currentPaths[i] !== path) { endReplay(false); return; }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  };
  waitReady();
  return true;
}

function endReplay(instant) {
  if (!replay) return;
  const r = replay;
  replay = null;
  r.el.classList.remove('shown');
  if (r.badge) r.badge.classList.add('leaving');
  setTimeout(() => {
    r.el.pause(); r.el.removeAttribute('src'); r.el.load(); r.el.remove();
    if (r.badge) r.badge.remove();
  }, instant ? 0 : 300);
  fetch('/api/hold?screen=' + r.idx + '&s=0').catch(() => {});
}

// ---- Callbacks ----
function callbackCandidates() {
  const onScreen = new Set(currentPaths);
  const now = Date.now();
  return Object.keys(sessionHeartAt).filter((p) =>
    !onScreen.has(p) && now - sessionHeartAt[p] >= TUNING.CALLBACK_MIN_AGE_MS && (callbackCount[p] || 0) < 2);
}

function startCallback(force) {
  const cands = callbackCandidates();
  if (!cands.length) return false;
  // More hearts this session = more likely to come back.
  const hearts = (p) => (typeof sessionHeartsByPath !== 'undefined' && sessionHeartsByPath[p]) || 1;
  const path = weightedPick(cands, hearts);
  const busy = rhythmFxBusyTiles();
  const free = tileElements.map((t, i) => i).filter((i) => !busy.has(i) && !(replay && replay.idx === i));
  if (!free.length) return false;
  const idx = free[Math.floor(Math.random() * free.length)];
  pendingStartAt[path] = Math.max(0, (sessionHeartPos[path] || 0) - TUNING.CALLBACK_LEAD_S);
  callbackLastAt = Date.now();
  return fetch('/api/place?screen=' + idx + '&s=' + TUNING.CALLBACK_HOLD_S + '&path=' + encodeURIComponent(path))
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok || !d.placed) { delete pendingStartAt[path]; return false; }
      callbackCount[path] = (callbackCount[path] || 0) + 1;
      if (typeof logEvent === 'function') logEvent('callback', { tile: idx });
      // Mark it once it's actually on the tile.
      let tries = 0;
      const mark = () => {
        if (currentPaths[idx] === path) { showClaimRewardLabel(idx, '↩ Callback'); pulseWarmGlow(idx, 3); return; }
        if (++tries < 30) setTimeout(mark, 200);
      };
      mark();
      return true;
    })
    .catch(() => false);
}

setInterval(() => {
  if (!replayOn.callbacks || document.hidden || anticipationActive || finaleActive || spotlightTileIndex >= 0) return;
  if (typeof activeMoment !== 'undefined' && activeMoment) return;
  if (Date.now() - callbackLastAt < TUNING.CALLBACK_COOLDOWN_MS) return;
  if (Math.random() < TUNING.CALLBACK_CHANCE) startCallback();
}, 20000);

// ---- prefs ----
function loadReplayPrefs() {
  const p = loadJsonPref('mm_replay', {});
  Object.keys(replayOn).forEach((k) => { if (typeof p[k] === 'boolean') replayOn[k] = p[k]; });
  updateReplayUi();
}

function toggleReplayPref(k) {
  replayOn[k] = !replayOn[k];
  saveJsonPref('mm_replay', replayOn);
  if (k === 'replay' && !replayOn.replay) endReplay(false);
  updateReplayUi();
}

function updateReplayUi() {
  Object.keys(replayOn).forEach((key) => setToggleBadge('replay-' + key + '-toggle', replayOn[key]));
}

function previewReplay() {
  const busy = rhythmFxBusyTiles();
  const i = tileElements.map((t, k) => k).find((k) => !busy.has(k) && getTileVideo(k) && getTileVideo(k).currentTime > TUNING.REPLAY_SECONDS + 1);
  if (i == null) return false;
  replayLastAt = 0;
  return startReplay(i);
}

function previewCallback() {
  const saved = TUNING.CALLBACK_MIN_AGE_MS;
  TUNING.CALLBACK_MIN_AGE_MS = 0;
  const p = startCallback(true);
  TUNING.CALLBACK_MIN_AGE_MS = saved;
  if (p === false) toast('↩ Heart a few clips first - callbacks bring those back', true);
  return p;
}
