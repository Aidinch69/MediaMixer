// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Hooks and Tease reveals - two ways a clip pulls you in.
//
// Hook: when a clip reaches its best bit (where you've hearted it, or its
// Clip DNA hook), that stretch repeats a few times before it plays on - the
// way a song repeats its hook. Two hidden copies of the clip wait at the
// start of the stretch and take turns, so every repeat starts instantly
// (no seeking on screen, nothing that could look like buffering). When the
// clip has a steady rhythm, the stretch is a whole number of its beats, so
// the repeat lands in time.
//
// Tease reveal: some clips arrive pushed in close on where the action is
// and slowly pull back to the full frame.

const hooksOn = { hooks: true, tease: true };
let hook = null; // { idx, path, at, len, reps, copies, phase, ... }
let hookLastAt = 0;
const hookDecided = {}; // tile -> path decided for (one roll per clip)

function hookPointFor(i) {
  const meta = videoMetaCache[currentPaths[i]];
  if (!meta) return null;
  // Where you've hearted it beats the analysis.
  if (meta.loop_anchor && (meta.heart_count || 0) >= 2) return { at: meta.loop_anchor.min, kind: 'hearted' };
  if (meta.dna && meta.dna.hook_at != null) return { at: meta.dna.hook_at, kind: 'dna' };
  return null;
}

function hookLength(i, at) {
  const dna = contentDna(i);
  let bpm = null;
  if (dna && dna.tempo_track) {
    const w = dna.tempo_track.filter((x) => x[1] && x[0] <= at && at <= x[0] + 8).sort((a, b) => b[2] - a[2])[0];
    if (w) bpm = w[1];
  }
  bpm = bpm || (dna && dna.tempo);
  if (!bpm) return TUNING.HOOK_SECONDS;
  const beat = 60 / bpm;
  return beat * Math.max(1, Math.round(TUNING.HOOK_SECONDS / beat));
}

function hookTick() {
  if (hook) { hookStep(); return; }
  if (!hooksOn.hooks || document.hidden || anticipationActive || finaleActive || cascade || splitFrames) return;
  if (typeof activeMoment !== 'undefined' && activeMoment) return;
  if (Date.now() - hookLastAt < TUNING.HOOK_COOLDOWN_MS) return;
  const busy = rhythmFxBusyTiles();
  for (let i = 0; i < tileElements.length; i++) {
    const path = currentPaths[i];
    if (!path || busy.has(i) || hookDecided[i] === path) continue;
    const vid = getTileVideo(i);
    const point = hookPointFor(i);
    if (!vid || !point || !isFinite(vid.duration)) continue;
    const ahead = (point.at - vid.currentTime) / (vid.playbackRate || 1);
    if (ahead < 0.3 || ahead > 4) continue; // decide once it's close
    hookDecided[i] = path;
    if (Math.random() >= TUNING.HOOK_CHANCE * windDownOddsMult()) continue;
    const len = hookLength(i, point.at);
    if (point.at + len > vid.duration - 0.3) continue;
    prepareHook(i, point, len);
    return;
  }
}

function prepareHook(i, point, len) {
  const tile = tileElements[i];
  const vid = getTileVideo(i);
  const path = currentPaths[i];
  const url = mediaOrigin(i) + '/media/' + path + '?tiles=' + tileElements.length + '&cors=1';
  const reps = Math.round(TUNING.HOOK_REPEATS);
  const copies = [0, 1].map(() => {
    const el = document.createElement('video');
    el.className = 'fx-hook';
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
    el.style.objectFit = getComputedStyle(vid).objectFit;
    const c = { el, ready: false };
    const check = () => { if (el.readyState >= 3 && Math.abs(el.currentTime - point.at) < 0.15) c.ready = true; };
    el.addEventListener('loadedmetadata', () => { el.currentTime = point.at; }, { once: true });
    el.addEventListener('seeked', check);
    el.addEventListener('canplay', check);
    el.addEventListener('canplaythrough', check);
    el.src = url;
    tile.insertBefore(el, vid.nextSibling);
    return c;
  });
  hook = { idx: i, path, at: point.at, kind: point.kind, len, reps, copies, phase: 'waiting', rep: 0, active: -1, released: false };
  hookLastAt = Date.now();
  const total = (point.at - vid.currentTime + len * reps) / (vid.playbackRate || 1) + 2;
  fetch('/api/hold?screen=' + i + '&s=' + total.toFixed(1)).catch(() => {});
}

function hookShow(k) {
  const vid = getTileVideo(hook.idx);
  const c = hook.copies[k];
  c.el.playbackRate = (vid && vid.playbackRate) || 1;
  c.el.play().catch(() => {});
  c.el.classList.add('shown');
  const other = hook.copies[1 - k];
  if (hook.active >= 0) {
    other.el.classList.remove('shown');
    other.el.pause();
    other.ready = false;
    other.el.currentTime = hook.at; // ready again for the repeat after next
  }
  hook.active = k;
  hook.repStartedAt = c.el.currentTime;
}

function hookStep() {
  const vid = getTileVideo(hook.idx);
  if (!vid || currentPaths[hook.idx] !== hook.path) { endHook(true); return; }
  if (hook.phase === 'waiting') {
    if (vid.currentTime < hook.at) return;
    // Missed the moment (copies not ready in time) - drop it quietly.
    if (vid.currentTime > hook.at + 0.5 || !hook.copies[0].ready) { endHook(true); return; }
    hook.phase = 'running';
    hook.rep = 1;
    hookShow(0);
    hookLastAt = Date.now();
    if (typeof logEvent === 'function') logEvent('hook.start', { tile: hook.idx, kind: hook.kind, len: +hook.len.toFixed(2), reps: hook.reps });
    return;
  }
  const cur = hook.copies[hook.active];
  if (cur.el.currentTime < hook.at + hook.len) return;
  if (hook.rep >= hook.reps) { endHook(false); return; }
  const next = hook.copies[1 - hook.active];
  if (!next.ready) return; // keep playing a moment longer rather than show a stall
  hook.rep++;
  // The last repeat: put the real video back at the start underneath, so
  // when the copy goes it carries on from exactly where the repeat ends.
  if (hook.rep === hook.reps) vid.currentTime = hook.at;
  hookShow(1 - hook.active);
}

function endHook(instant) {
  if (!hook) return;
  const h = hook;
  hook = null;
  h.copies.forEach((c) => c.el.classList.remove('shown'));
  setTimeout(() => h.copies.forEach((c) => { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.el.remove(); }), instant ? 0 : 250);
  fetch('/api/hold?screen=' + h.idx + '&s=0').catch(() => {});
}

// Checked every animation frame while a hook runs (the boundaries need to
// be tight), and on a slower timer otherwise.
function hookFrame() {
  if (hook && hook.phase === 'running') hookStep();
  requestAnimationFrame(hookFrame);
}
requestAnimationFrame(hookFrame);
setInterval(hookTick, 100);

// ---- Tease reveal ----
const teaseSeen = {}; // tile -> path
let teaseLastAt = 0;

function maybeTease(i) {
  const path = currentPaths[i];
  if (!path || teaseSeen[i] === path) return;
  teaseSeen[i] = path;
  if (!hooksOn.tease || document.hidden || Date.now() - teaseLastAt < TUNING.TEASE_COOLDOWN_MS) return;
  if (Math.random() >= TUNING.TEASE_CHANCE) return;
  if (rhythmFxBusyTiles().has(i) || (hook && hook.idx === i)) return;
  const vid = getTileVideo(i);
  if (!vid) return;
  teaseLastAt = Date.now();
  // Where the action is at the start, from the clip's motion track.
  const dna = contentDna(i);
  let cx = 0.5, cy = 0.5;
  if (dna && dna.track && dna.track.length) {
    const k = Math.max(0, Math.min(dna.track.length - 1, Math.floor((vid.currentTime || 0) / 2)));
    if (dna.track[k][1] > 0.01) { cx = dna.track[k][2]; cy = dna.track[k][3]; }
  }
  runTease(i, cx, cy, TUNING.TEASE_ZOOM, TUNING.TEASE_MS);
}

function runTease(i, cx, cy, zoom, ms) {
  const tile = tileElements[i];
  if (!tile) return;
  const path = currentPaths[i];
  tile.classList.add('teasing');
  const start = performance.now();
  if (typeof logEvent === 'function') logEvent('tease', { tile: i });
  const step = (ts) => {
    const k = Math.min(1, (ts - start) / ms);
    if (k >= 1 || currentPaths[i] !== path || !tile.isConnected) {
      tile.classList.remove('teasing');
      ['--tease-s', '--tease-x', '--tease-y'].forEach((v) => tile.style.removeProperty(v));
      return;
    }
    // Hold close for the first fifth, then a long ease out to the full frame.
    const e = k < 0.2 ? 0 : fxSmoothstep((k - 0.2) / 0.8);
    const s = zoom + (1 - zoom) * e;
    const room = (s - 1) / 2; // how far it can shift before an edge shows
    const tx = Math.max(-room, Math.min(room, (0.5 - cx) * s));
    const ty = Math.max(-room, Math.min(room, (0.5 - cy) * s));
    tile.style.setProperty('--tease-s', s.toFixed(4));
    tile.style.setProperty('--tease-x', (tx * 100).toFixed(2) + '%');
    tile.style.setProperty('--tease-y', (ty * 100).toFixed(2) + '%');
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// A new clip on a tile: wait until it's actually playing at its start point.
setInterval(() => {
  tileElements.forEach((t, i) => {
    const vid = getTileVideo(i);
    if (vid && currentPaths[i] && teaseSeen[i] !== currentPaths[i] && vid.readyState >= 3 && !vid.paused) maybeTease(i);
  });
}, 150);

// ---- prefs ----
function loadHookPrefs() {
  const p = loadJsonPref('mm_hooks', {});
  Object.keys(hooksOn).forEach((k) => { if (typeof p[k] === 'boolean') hooksOn[k] = p[k]; });
  updateHookUi();
}

function toggleHookPref(k) {
  hooksOn[k] = !hooksOn[k];
  saveJsonPref('mm_hooks', hooksOn);
  if (k === 'hooks' && !hooksOn.hooks) endHook(false);
  updateHookUi();
}

function updateHookUi() {
  Object.keys(hooksOn).forEach((k) => setToggleBadge('hooks-' + k + '-toggle', hooksOn[k]));
}

// Preview helpers (menu buttons).
function previewHook() {
  const busy = rhythmFxBusyTiles();
  for (let i = 0; i < tileElements.length; i++) {
    const vid = getTileVideo(i);
    if (busy.has(i) || !vid || !isFinite(vid.duration) || hook) continue;
    const at = Math.min(vid.duration - 4, vid.currentTime + 1.2);
    if (at <= vid.currentTime) continue;
    hookDecided[i] = currentPaths[i];
    prepareHook(i, { at, kind: 'preview' }, hookLength(i, at));
    return true;
  }
  return false;
}

function previewTease() {
  const i = Math.floor(Math.random() * tileElements.length);
  teaseLastAt = 0;
  teaseSeen[i] = null;
  const saved = TUNING.TEASE_CHANCE;
  TUNING.TEASE_CHANCE = 1;
  // Re-run as if the clip just arrived (from the start of its tease window).
  maybeTease(i);
  TUNING.TEASE_CHANCE = saved;
}
