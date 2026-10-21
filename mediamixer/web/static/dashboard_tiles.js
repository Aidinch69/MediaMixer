// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Tile/layout state, custom loop points, featured clips, Mosaic fit and the tile speed controller.

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
// 6 shards x Chrome's 6-connections-per-origin limit = a 36-connection
// ceiling. A 5x5 grid needs 25 main-video streams, and with preload
// (below) doubles to 50 - comfortably over 36, so requests queue waiting
// for a free connection, which shows up as stalled/non-playing video.
// 16 shards x 6 = 96, enough headroom for the largest grid plus preload
// plus everything else (audio, SSE) sharing the budget.
const LOOPBACK_SHARDS = 16;
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

// Manual playback-speed control (the "tool menu" / Display tab slider) -
// a player-facing baseline multiplier, separate from the server-driven
// tension/barrage speed (s.speed) and from Lock's own slowdown below;
// all three compose by multiplying together, with a burst-speed effect
// (see burstTileSpeed) still fully overriding this for its own window.
let manualSpeedMult = 1.0;

function setManualSpeed(v) {
  manualSpeedMult = parseFloat(v);
  const el = document.getElementById('l-manual-speed');
  if (el) el.innerText = manualSpeedMult.toFixed(2) + 'x';
  try { localStorage.setItem('mm_manual_speed', manualSpeedMult); } catch (e) {}
}

function loadManualSpeedPref() {
  let saved = 1.0;
  try {
    const raw = localStorage.getItem('mm_manual_speed');
    if (raw !== null) saved = parseFloat(raw);
  } catch (e) {}
  if (!Number.isFinite(saved)) saved = 1.0;
  const input = document.getElementById('manual-speed-input');
  if (input) input.value = saved;
  setManualSpeed(saved);
}
const PRELOAD_MAX_TILES = 9; // dual/2x2/2x3/3x3 keep deterministic preload; 4x4/5x5 skip it
let tileElements = [];
// Dedicated glow overlay divs, one per tile, cached alongside tileElements.
// All FX opacity/animation lives on these instead of box-shadow/filter on
// the tile or video itself, so effects never force a video repaint.
let tileGlowEls = [];
let tileAmbientEls = [];
let tileClaimEls = [];
let lastFilterStr = [];

// ---- Custom Loop Point ----
// Normally a clip plays through and 'ended' hands rotation to the server
// (see the tile's own 'ended' listener below). Once a video has a stored
// hearted-position range (loop_anchor_min/max, widened server-side by
// every heart's playback position - see rateScreen's &pos= param), it
// instead loops within [anchor.min - lead-in, anchor.max + trail-in]
// forever, clamped to the clip's real duration, with a minimum-duration
// floor so a single heart near either edge can't collapse it to a
// jarring few-second snippet. Directly answers two concerns raised while
// designing this: anchoring only to the LAST heart would lose content
// that's great *before* that point (hence lead-in, and the window only
// ever widening, never relocating) - and never trimming the tail would
// loop forever through a clip that degrades toward the end (hence
// trail-in instead of always playing to the natural end).
const LOOP_LEAD_IN_S = 3;
const LOOP_TRAIL_IN_S = 4;
const LOOP_MIN_DURATION_S = 15;
// Looping was unconditional on any heart at all, and forever once it
// started - per direct feedback, a single heart (or even a couple)
// shouldn't be enough to lock a tile into repeating indefinitely. Now
// gated on the same "real favorite" bar Featured Tile uses, raised a
// bit further since looping is a much bigger commitment than a visual
// highlight, and capped to a handful of passes before it's allowed to
// finish normally and rotate on, same as anything else.
//
// The fixed 5-heart bar was outgrown: with heavy hearting ~300 clips
// qualified and repeated their segment 3x, read as "videos repeating back
// to back to back". Now: only the top 5% most-hearted clips (relative to
// the library, so it doesn't drift as hearts pile up), only on about a
// third of their plays, and 2 passes at most.
const loopAnchorCache = {}; // video_path -> {min,max} | null (null = confirmed none)
let tileLoopBounds = []; // per-tile index -> {start,end} | null
let tileLoopCount = []; // per-tile index -> completed passes through the bounded segment so far

function computeLoopBounds(anchor, duration) {
  if (!anchor || !duration || !isFinite(duration)) return null;
  let start = Math.max(0, anchor.min - LOOP_LEAD_IN_S);
  let end = Math.min(duration, anchor.max + LOOP_TRAIL_IN_S);
  if (end - start < LOOP_MIN_DURATION_S) {
    const deficit = LOOP_MIN_DURATION_S - (end - start);
    start = Math.max(0, start - deficit / 2);
    end = Math.min(duration, end + deficit / 2);
  }
  return end > start ? { start, end } : null;
}

// Only acts if the tile is still actually showing the path this lookup
// was for - by the time an async fetch resolves, fast rotation could
// already have moved it on to something else.
function applyLoopAnchorIfReady(i, path) {
  if (currentPaths[i] !== path) return;
  const vid = tileElements[i] && tileElements[i].querySelector('#screen-' + i);
  if (!vid) return;
  const meta = videoMetaCache[path] || {};
  const topFrac = meta.heart_top_frac == null ? 1 : meta.heart_top_frac;
  const eligible = (meta.heart_count || 0) >= TUNING.LOOP_HEART_THRESHOLD && topFrac <= TUNING.LOOP_TOP_FRACTION && Math.random() < TUNING.LOOP_CHANCE;
  const anchor = eligible ? loopAnchorCache[path] : null;
  tileLoopBounds[i] = (anchor && vid.duration) ? computeLoopBounds(anchor, vid.duration) : null;
  tileLoopCount[i] = 0;
}

// Featured Tile: a visual highlight for a tile currently playing actual
// favorited content (heart_count > 0) - "featured" meaning something
// real about the content, not a random ambient flourish the way Mosaic
// Fit's aspect-driven sizing already varies tile shape for unrelated
// reasons.

function applyFeaturedIfReady(i, path) {
  if (currentPaths[i] !== path) return;
  const tile = tileElements[i];
  if (!tile) return;
  const heartCount = videoMetaCache[path] ? videoMetaCache[path].heart_count : 0;
  tile.classList.toggle('tile-featured', heartCount >= TUNING.FEATURED_HEART_THRESHOLD);
}

// One request per clip load feeds both Custom Loop Point and Featured
// Tile - they're unrelated mechanics, but both just need to know
// something about whatever clip a tile just loaded.
const videoMetaCache = {}; // video_path -> {heart_count, loop_anchor} | null

function fetchVideoMetaFor(i, path) {
  if (Object.prototype.hasOwnProperty.call(videoMetaCache, path)) {
    applyLoopAnchorIfReady(i, path);
    applyFeaturedIfReady(i, path);
    return;
  }
  fetch('/api/video_meta?path=' + encodeURIComponent(path))
    .then((r) => r.json())
    .then((data) => {
      videoMetaCache[path] = data || null;
      loopAnchorCache[path] = (data && data.loop_anchor) || null;
      applyLoopAnchorIfReady(i, path);
      applyFeaturedIfReady(i, path);
    })
    .catch(() => { videoMetaCache[path] = null; loopAnchorCache[path] = null; });
}

// ---- Mosaic Fit (experimental) ----
// Instead of a uniform grid, size each tile by its clip's own aspect ratio -
// pack tiles into justified rows (same idea as a Flickr/Google-Photos photo
// wall) so there's much less black-bar letterboxing. Aspect ratios only
// become known once a clip's metadata loads, and clips rotate on their own
// independent schedules, so reflowing on every single change would make
// neighboring tiles constantly resize around each other; instead this
// reflows periodically (TUNING.MOSAIC_REFLOW_INTERVAL_MS) plus a few explicit
// triggers (toggling on, tile count changing, window resize, and once
// shortly after a tile's *first* real aspect ratio arrives).
const DEFAULT_ASPECT = 16 / 9;
let mosaicEnabled = true;
let aspectRatios = [];
let aspectKnown = [];
let mosaicSettleTimer = null;

// ---- Tile Speed Controller ----
// Every mechanic that wants to override a tile's natural (server-driven)
// playback speed - sealed tile's lock/miss-hold/unlock, bonus/chase
// speed bursts, the heart-tap kick, barrage boost/dim - used to each
// manage their own copy of "set playbackRate, remember a single
// tileSpeedBurstUntil timestamp, hope nothing else touches it in the
// meantime." That worked as long as only one mechanic ever wanted a
// tile at once, but had no real answer for what should happen if two
// ever overlapped (a sealed-locked tile also getting barrage-selected,
// say) beyond "whichever wrote last wins" - never actually decided on
// purpose, just whatever order the code happened to run in.
//
// This replaces all of that with one per-tile map of named, prioritized
// effects. Two shapes cover every real case:
//   - "timeline" effects (sealed lock/miss/unlock, bonus claim, chase
//     catch, heart-tap kick): registered once with a fixed fade-in ->
//     hold -> fade-out timeline, computed purely from their own start
//     time, removing themselves once that timeline completes.
//   - "live" effects (barrage boost/dim): re-asserted every render tick
//     with a live target and an active/inactive flag; the controller
//     tracks the rising/falling edge itself, fading between wherever
//     the tile's actually displaying and the new target either way.
// Each tick, resolveAndApplyTileSpeed picks whichever registered effect
// has the highest priority and is still live; with none active, the
// tile just plays at its natural (server-driven) speed. The priority
// order itself is a real, visible decision now instead of an accident:
// a sealed-locked tile should never have its speed hijacked by a
// barrage dim, for instance, so sealedLock outranks everything else.
const SPEED_PRIORITY = { sealedLock: 40, slowmo: 30, breath: 28, barrageBoost: 25, overdrive: 22, spinSurge: 21, bonusClaim: 20, chaseCatch: 20, barrageDim: 15, heartKick: 10 };
let tileSpeedEffects = []; // per-tile: Map<id, effectState> | undefined (lazy)

function getTileVideo(idx) {
  return tileElements[idx] && tileElements[idx].querySelector('#screen-' + idx);
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function getTileSpeedEffects(i) {
  if (!tileSpeedEffects[i]) tileSpeedEffects[i] = new Map();
  return tileSpeedEffects[i];
}

function evalSpeedEffect(effect, now) {
  const elapsed = now - effect.startAt;
  if (effect.kind === 'live') {
    if (elapsed < effect.fadeInMs) return effect.fromRate + (effect.targetSpeed - effect.fromRate) * (elapsed / effect.fadeInMs);
    return effect.targetSpeed; // holds indefinitely while the caller keeps asserting it active
  }
  if (effect.kind === 'release') {
    if (elapsed >= effect.fadeOutMs) return null; // fully faded out - remove, hand control back
    const t = effect.fadeOutMs > 0 ? elapsed / effect.fadeOutMs : 1;
    return effect.fromRate + (effect.releaseTo - effect.fromRate) * t;
  }
  // 'timeline': fade in, hold, fade out, then remove itself
  const t1 = effect.fadeInMs, t2 = t1 + effect.holdMs, t3 = t2 + effect.fadeOutMs;
  if (elapsed >= t3) return null;
  if (elapsed < t1) { const t = t1 > 0 ? elapsed / t1 : 1; return effect.fromRate + (effect.targetSpeed - effect.fromRate) * t; }
  if (elapsed < t2) return effect.targetSpeed;
  const t = effect.fadeOutMs > 0 ? (elapsed - t2) / effect.fadeOutMs : 1;
  return effect.targetSpeed + (effect.releaseTo - effect.targetSpeed) * t;
}

// One-shot: snap or fade to targetSpeed, hold, then snap or fade back to
// releaseTo (1 = normal), after which this effect removes itself.
// Re-registering the same id (e.g. a sealed tile getting missed while
// its lock effect is still running) just replaces it with a fresh
// timeline starting from the tile's current displayed speed, so it
// composes smoothly instead of fighting the old one.
function setTimelineSpeedEffect(i, vid, id, priority, targetSpeed, fadeInMs, holdMs, fadeOutMs, releaseTo) {
  getTileSpeedEffects(i).set(id, {
    kind: 'timeline', priority, startAt: Date.now(), fromRate: vid.playbackRate,
    targetSpeed, fadeInMs, holdMs, fadeOutMs, releaseTo: releaseTo == null ? 1 : releaseTo,
  });
  // These are called from one-off triggers (a tap, a catch, a heart),
  // not from render()'s own per-tick loop - applying right away instead
  // of waiting for the next status poll (up to ~0.3s later) is what
  // made the old direct-assignment versions of these feel instant.
  resolveAndApplyTileSpeed(i, vid, vid.playbackRate);
}

// Live: called every render tick. `active` false either releases (fades
// to releaseTo over fadeOutMs, then removes itself) or is a no-op if
// this effect was never active to begin with. `active` true either
// starts a fresh fade-in or, if already active, just updates the live
// target in place - so a barrage's own evolving speed target keeps
// tracking smoothly without restarting the fade every tick.
function setLiveSpeedEffect(i, vid, id, priority, active, targetSpeed, fadeInMs, fadeOutMs, releaseTo) {
  releaseTo = releaseTo == null ? 1 : releaseTo;
  const effects = getTileSpeedEffects(i);
  const existing = effects.get(id);
  if (active) {
    if (existing && existing.kind === 'live') existing.targetSpeed = targetSpeed;
    else effects.set(id, { kind: 'live', priority, startAt: Date.now(), fromRate: vid.playbackRate, targetSpeed, fadeInMs });
  } else if (existing && existing.kind !== 'release') {
    // Only starts the release countdown on the actual falling edge - if
    // this is called again (as it will be, every tick) while it's still
    // releasing, leave the existing countdown alone. Restarting it from
    // "now" every single tick would mean it never actually finishes,
    // since playbackRate has barely moved from one tick to the next.
    effects.set(id, { kind: 'release', priority, startAt: Date.now(), fromRate: vid.playbackRate, fadeOutMs, releaseTo });
  }
}

// The single source of truth for "what should this tile's playbackRate
// actually be right now" - render() calls this every tick instead of
// writing s.speed (or a burst value) directly.
function resolveAndApplyTileSpeed(i, vid, naturalSpeed) {
  const effects = tileSpeedEffects[i];
  if (!effects || !effects.size) { vid.playbackRate = naturalSpeed; return; }
  const now = Date.now();
  let winner = null, winnerPriority = -Infinity;
  effects.forEach((effect, id) => {
    const rate = evalSpeedEffect(effect, now);
    if (rate === null) { effects.delete(id); return; }
    if (effect.priority > winnerPriority) { winner = rate; winnerPriority = effect.priority; }
  });
  vid.playbackRate = winner === null ? naturalSpeed : winner;
}

// Speed effects are purely client-side state the server has no idea
// about, but render() - the only other thing that was calling
// resolveAndApplyTileSpeed - only runs when an SSE push actually
// arrives, and the server only pushes real data when its OWN payload
// changes (see api_stream's payload != last check in app.py) - a
// keep-alive comment line doesn't trigger onmessage at all. With
// nothing else happening server-side, that gap can run well past a
// second, which starved every fade built on top of
// resolveAndApplyTileSpeed of the frequent re-evaluation it needs to
// actually animate - exactly what the old fadeTileSpeedTo's own
// requestAnimationFrame loop existed to avoid, and what got lost when
// this replaced it. This restores that independence: every tile that
// currently has at least one registered effect gets re-resolved here
// too, on its own fixed clock, regardless of whatever the SSE stream
// is or isn't doing. Tiles with no effects registered are skipped
// entirely (tileSpeedEffects is a sparse array - forEach skips holes).
setInterval(() => {
  tileSpeedEffects.forEach((effects, i) => {
    if (!effects || !effects.size) return;
    const vid = getTileVideo(i);
    if (vid) resolveAndApplyTileSpeed(i, vid, vid.playbackRate);
  });
}, 100);

function loadMosaicPref() {
  try { const v = localStorage.getItem('mm_mosaic_enabled'); if (v !== null) mosaicEnabled = v === '1'; } catch (e) {}
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

// Crop-aware Mosaic: tiles are arranged as nested splits - a row can hold
// columns, a column can hold rows - so each clip's cell can keep (close to)
// the clip's own shape. Side by side, two parts share a height and their
// shapes add up; stacked, they share a width. Any arrangement whose overall
// shape matches the screen needs no crop at all; otherwise every tile is
// stretched by the same small amount (cover crops it). Tiles stay in order
// (nothing jumps across the screen), the search keeps arrangements that
// don't leave one tile tiny next to a huge one, and it sticks with the last
// arrangement unless a new one is clearly better (MOSAIC_KEEP_BONUS).
const MOSAIC_KEEP_BONUS = 0.04;
const MOSAIC_BALANCE = 0.06; // cost per e-fold between the biggest and smallest tile
const MOSAIC_BUCKETS_PER_E = 6; // candidate shapes kept per interval, by log-aspect
let mosaicLastSig = null;
let mosaicCropNow = 0; // share of each clip cropped away right now, for the menu

function mosaicCombine(L, R, dir) {
  const sL = dir === 'h' ? L.a / (L.a + R.a) : (1 / L.a) / (1 / L.a + 1 / R.a);
  return {
    dir, l: L, r: R,
    a: dir === 'h' ? L.a + R.a : 1 / (1 / L.a + 1 / R.a),
    minS: Math.min(sL * L.minS, (1 - sL) * R.minS),
    maxS: Math.max(sL * L.maxS, (1 - sL) * R.maxS),
  };
}

function mosaicSig(node) {
  return node.leaf != null ? String(node.leaf) : node.dir + '(' + mosaicSig(node.l) + ',' + mosaicSig(node.r) + ')';
}

// Rebuild a previous arrangement with today's aspect ratios.
function mosaicFromSig(sig, aspects) {
  let pos = 0;
  const parse = () => {
    if (sig[pos] === 'h' || sig[pos] === 'v') {
      const dir = sig[pos];
      pos += 2; // "h("
      const L = parse();
      pos += 1; // ","
      const R = parse();
      pos += 1; // ")"
      return L && R ? mosaicCombine(L, R, dir) : null;
    }
    let num = '';
    while (pos < sig.length && /[0-9]/.test(sig[pos])) num += sig[pos++];
    const i = +num;
    return i < aspects.length ? { leaf: i, a: aspects[i], minS: 1, maxS: 1 } : null;
  };
  try { return parse(); } catch (e) { return null; }
}

function mosaicCost(node, screenAspect) {
  return Math.abs(Math.log(node.a / screenAspect)) + MOSAIC_BALANCE * Math.log(node.maxS / node.minS);
}

function computeMosaicTree(aspects, containerWidth, containerHeight) {
  const n = aspects.length;
  if (!n || containerWidth < 1 || containerHeight < 1) return null;
  const screenAspect = containerWidth / containerHeight;
  // cands[i][j]: a few arrangements of tiles i..j, one per shape bucket,
  // keeping the most balanced in each.
  const cands = [];
  for (let i = 0; i < n; i++) { cands[i] = []; cands[i][i] = [{ leaf: i, a: aspects[i], minS: 1, maxS: 1 }]; }
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      const buckets = new Map();
      for (let k = i; k < j; k++) {
        for (const L of cands[i][k]) for (const R of cands[k + 1][j]) for (const dir of ['h', 'v']) {
          const c = mosaicCombine(L, R, dir);
          if (c.minS < 1 / (len * 5)) continue; // a sliver - never worth it
          const key = Math.round(Math.log(c.a) * MOSAIC_BUCKETS_PER_E);
          const prev = buckets.get(key);
          if (!prev || c.maxS / c.minS < prev.maxS / prev.minS) buckets.set(key, c);
        }
      }
      cands[i][j] = [...buckets.values()];
    }
  }
  let best = null, bestCost = Infinity;
  for (const c of cands[0][n - 1]) {
    const cost = mosaicCost(c, screenAspect);
    if (cost < bestCost) { best = c; bestCost = cost; }
  }
  if (!best) return null;
  if (mosaicLastSig) {
    const prev = mosaicFromSig(mosaicLastSig, aspects);
    // Only if it still covers exactly these tiles (the tile count may have changed).
    const leaves = (prev && mosaicLastSig.match(/[0-9]+/g)) || [];
    const covers = leaves.length === n && new Set(leaves).size === n;
    if (prev && covers && mosaicSig(prev) === mosaicLastSig && mosaicCost(prev, screenAspect) - MOSAIC_KEEP_BONUS <= bestCost) best = prev;
  }
  mosaicLastSig = mosaicSig(best);
  const r = best.a / screenAspect;
  mosaicCropNow = 1 - Math.min(r, 1 / r);
  return best;
}

// What the old even-rows Mosaic would crop, for comparison in the menu.
function evenSplitCrop(aspects, containerWidth, containerHeight) {
  const n = aspects.length;
  let best = null;
  for (let rows = 1; rows <= n; rows++) {
    if (n > 2 && (rows === 1 || rows === n)) continue;
    let idx = 0;
    const total = splitEvenly(n, rows).reduce((acc, size) => acc + containerWidth / aspects.slice(idx, (idx += size)).reduce((x, y) => x + y, 0), 0);
    const diff = Math.abs(total - containerHeight);
    const stretch = containerHeight / total;
    if (!best || diff < best.diff) best = { diff, crop: 1 - Math.min(stretch, 1 / stretch) };
  }
  return best ? best.crop : 0;
}

function buildMosaicNode(node) {
  if (node.leaf != null) {
    const tile = tileElements[node.leaf];
    if (tile) { tile.style.width = ''; tile.style.height = ''; }
    return tile;
  }
  const el = document.createElement('div');
  el.className = 'mosaic-node ' + node.dir;
  const sL = node.dir === 'h' ? node.l.a / node.a : (1 / node.l.a) / (1 / node.a);
  [[node.l, sL], [node.r, 1 - sL]].forEach(([child, share]) => {
    const c = buildMosaicNode(child);
    if (!c) return;
    c.style.flexBasis = (share * 100).toFixed(4) + '%';
    el.appendChild(c); // re-parents an existing tile (and its <video>) without reloading it
  });
  return el;
}

function layoutMosaic() {
  // Never move tiles under a Spotlight - its offset to the centre was worked
  // out from where the tile was; the periodic reflow catches up after.
  if (typeof spotlightTileIndex !== 'undefined' && spotlightTileIndex >= 0) return;
  const grid = document.getElementById('screen-grid');
  const rect = grid.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10 || tileElements.length === 0) return;
  grid.className = 'screen-grid mosaic';
  grid.style.gridTemplateColumns = '';
  grid.style.gridTemplateRows = '';
  const tree = computeMosaicTree(aspectRatios.slice(0, tileElements.length), rect.width, rect.height);
  if (!tree) return;
  let root = buildMosaicNode(tree);
  if (tree.leaf != null) { // a single tile still needs a container to fill
    const wrap = document.createElement('div');
    wrap.className = 'mosaic-node h';
    root.style.flexBasis = '100%';
    wrap.appendChild(root);
    root = wrap;
  }
  root.classList.add('mosaic-root');
  grid.innerHTML = '';
  grid.appendChild(root);
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
