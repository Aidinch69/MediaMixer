// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Tile DOM creation, render() from the status stream, SSE connection, and layout/pace/rating controls.

// Builds one fully-wired tile (markup + every listener a tile needs) -
// pulled out of ensureTiles so growing the grid can create just the new
// tiles instead of rebuilding every existing one from scratch.
function createTileElement(i) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML =
      '<video id="screen-' + i + '" autoplay></video>' +
      '<video id="preload-' + i + '" class="preload" preload="auto" muted></video>' +
      '<div class="tile-glow-fx"></div>' +
      '<div class="tile-ambient-fx"><span class="tap-badge">👆 TAP</span><span class="chase-badge">⚡ CATCH</span><span class="sealed-badge">🔒 OPEN</span><span class="chase-onemore-label"></span></div>' +
      '<div class="tile-claim-fx"><span class="claim-reward-label"></span></div>' +
      '<div class="sealed-status-label">🔒 Locked</div>' +
      '<div class="tile-overlay">' +
      '<div class="src-label" id="label-' + i + '"></div>' +
      '<div class="tile-actions">' +
      '<button class="up thumb" onclick="rateScreen(' + i + ',\'up\',this)">❤️</button>' +
      '<button class="down thumb" onclick="rateScreen(' + i + ',\'down\',this)">👎</button>' +
      '</div></div>';
    const vid = tile.querySelector('#screen-' + i);
    // CORS-mode loads (paired with the server's /media/ CORS header) so
    // this tile's audio can be routed into the audio-reactive analyser -
    // a cross-origin element without it would play silence once routed.
    // Set before any src is ever assigned; see also the &cors=1 in render.
    vid.crossOrigin = 'anonymous';
    vid.volume = tileAudioVolume; // master Tile Audio Volume slider - shared by every tile, not a per-tile solo toggle
    vid.muted = tileAudioVolume <= 0;
    vid.addEventListener('ended', () => fetch('/api/rotate?screen=' + i));
    vid.addEventListener('loadedmetadata', () => {
      onAspectKnown(i);
      applyLoopAnchorIfReady(i, currentPaths[i]); // duration is only known from here on
    });
    // Custom Loop Point's actual seek-back - a no-op whenever this tile
    // has no loop bounds set (the normal case, for any clip that's never
    // earned enough hearts to qualify), so this doesn't change behavior
    // for ordinary playback. Capped to LOOP_MAX_REPEATS passes - once hit,
    // bounds are cleared so this tile plays out to its real end and
    // rotates normally, instead of repeating forever.
    vid.addEventListener('timeupdate', () => {
      const bounds = tileLoopBounds[i];
      if (!bounds || vid.currentTime < bounds.end) return;
      tileLoopCount[i] = (tileLoopCount[i] || 0) + 1;
      if (tileLoopCount[i] >= LOOP_MAX_REPEATS) {
        tileLoopBounds[i] = null;
      } else {
        vid.currentTime = bounds.start;
      }
    });
    // Hold-to-Heart: holding the heart button past a threshold fires one
    // amplified heart instead of waiting for a plain tap - a deliberate,
    // heavier gesture for "I really mean this one," distinct from a quick
    // tap. Fires once, right at the threshold (not on release), and marks
    // the button so the pointerup's own click doesn't also fire a normal
    // heart on top of it.
    const upBtn = tile.querySelector('.up.thumb');
    let holdTimer = null;
    let holdFiredThisPress = false;
    upBtn.addEventListener('pointerdown', () => {
      holdFiredThisPress = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        // Fire first, flag after - this call must go through normally
        // (it's the hold itself); the flag is only for the click event
        // that fires afterward once the finger/mouse actually lifts.
        rateScreen(i, 'up', upBtn, TUNING.HOLD_TO_HEART_STRENGTH);
        holdFiredThisPress = true;
        upBtn.dataset.holdFired = '1';
      }, TUNING.HOLD_TO_HEART_MS);
    });
    const cancelHold = () => {
      clearTimeout(holdTimer);
      if (holdFiredThisPress) {
        holdFiredThisPress = false;
        // The trailing click (if one comes) fires synchronously right
        // after this same pointerup, before any setTimeout callback can
        // run - so this is scoped to "shortly after release," not "a
        // fixed window after the hold fired." The previous version timed
        // the clear from the hold instead of the release, so holding past
        // ~1s before letting go meant the flag had already expired by the
        // time the real click landed - the click went through unblocked
        // and silently added a second, separate heart on release.
        setTimeout(() => { upBtn.dataset.holdFired = ''; }, 300);
      }
    };
    upBtn.addEventListener('pointerup', cancelHold);
    upBtn.addEventListener('pointerleave', cancelHold);
    upBtn.addEventListener('pointercancel', cancelHold);
    const ambientEl = tile.querySelector('.tile-ambient-fx');
    ambientEl.addEventListener('click', () => {
      markInteraction();
      if (i === bonusWindowTileIndex) claimBonusTile(i);
      else if (i === chaseFlashTileIndex) catchChaseFlash(i);
      else if (i === sealedTileIndex) openSealedTile(i);
      else if (i === dueAuraTileIndex) dismissDueAura(i);
      else if (i === lastChaseMissIdx && Date.now() - lastChaseMissAt < CHASE_NEAR_MISS_GRACE_MS) {
        lastChaseMissIdx = -1;
        // On the tile itself, not a corner toast - this near-miss is about
        // that specific tile, not a global event worth a screen-wide notice.
        showClaimRewardLabel(i, '😤 So close!');
      }
    });
    return tile;
}

// Incremental: when the tile count changes, keep every tile whose index
// still exists exactly as it is (same <video> element, same playback
// position, same listeners) - only the *delta* is actually created or
// torn down. The previous version discarded and rebuilt every tile on
// any count change, which meant growing from say 4 tiles to 6 restarted
// all 4 already-playing tiles from scratch along with the 2 genuinely
// new ones. applyLayoutMode()'s later clear-and-reappend of the grid
// container only reorders these same element references - detaching and
// reattaching an existing <video> node doesn't reset or interrupt its
// playback, only discarding and recreating the element itself does.
function ensureTiles(count) {
  if (currentTileCount === count) return false;
  const oldCount = currentTileCount;
  currentTileCount = count;

  if (count > oldCount) {
    const grow = count - oldCount;
    currentPaths = currentPaths.concat(new Array(grow).fill(''));
    aspectRatios = aspectRatios.concat(new Array(grow).fill(DEFAULT_ASPECT));
    tileSpeedEffects = tileSpeedEffects.concat(new Array(grow));
    aspectKnown = aspectKnown.concat(new Array(grow).fill(false));
    tileLoopBounds = tileLoopBounds.concat(new Array(grow).fill(null));
    lastFilterStr = lastFilterStr.concat(new Array(grow).fill(''));
    tileNaturalBase = tileNaturalBase.concat(new Array(grow).fill(0));
    for (let i = oldCount; i < count; i++) {
      const tile = createTileElement(i);
      tileElements.push(tile);
      tileGlowEls.push(tile.querySelector('.tile-glow-fx'));
      tileAmbientEls.push(tile.querySelector('.tile-ambient-fx'));
      tileClaimEls.push(tile.querySelector('.tile-claim-fx'));
    }
  } else {
    // Shrinking: drop the tiles beyond the new count and clear any
    // ambient/mechanic state that was pointing at one of them - the
    // index itself is about to stop existing, not just change content.
    for (let i = count; i < oldCount; i++) {
      if (tileElements[i] && tileElements[i].parentNode) tileElements[i].parentNode.removeChild(tileElements[i]);
    }
    tileElements.length = count;
    tileGlowEls.length = count;
    tileAmbientEls.length = count;
    tileClaimEls.length = count;
    currentPaths.length = count;
    aspectRatios.length = count;
    tileSpeedEffects.length = count;
    aspectKnown.length = count;
    tileLoopBounds.length = count;
    tileLoopCount.length = count;
    lastFilterStr.length = count;
    tileNaturalBase.length = count;
    if (bonusWindowTileIndex >= count) { clearTimeout(bonusWindowTimer); bonusWindowTileIndex = -1; }
    if (sealedTileIndex >= count) { clearTimeout(sealedTimer); sealedTileIndex = -1; }
    if (chaseFlashTileIndex >= count) { clearTimeout(chaseFlashTimer); chaseFlashTileIndex = -1; chaseChain = 0; }
    if (lastChaseMissIdx >= count) lastChaseMissIdx = -1;
    if (dueAuraTileIndex >= count) dueAuraTileIndex = -1;
    if (mysteryTileIndex >= count) mysteryTileIndex = -1;
  }
  return true;
}

function applyRandomStart(vid, idx) {
  const onMeta = () => {
    vid.removeEventListener('loadedmetadata', onMeta);
    if (isFinite(vid.duration) && vid.duration > 0) {
      vid.currentTime = Math.random() * RANDOM_START_MAX_FRACTION * vid.duration;
    }
    // Loading a new .src resets playbackRate back to 1 even though a
    // held speed effect (most notably a sealed-tile miss-hold, which can
    // run up to 15s - long enough for the clip underneath to rotate on
    // its own mid-hold) hasn't actually expired yet. Without this, the
    // tile still looked locked (dim, badge gone) but had silently sped
    // back up to normal the moment its content happened to change. Just
    // re-resolving against whatever's actually registered picks the
    // right value automatically, the same way every other tick does.
    resolveAndApplyTileSpeed(idx, vid, vid.playbackRate);
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
  if (tilesRebuilt || columnsChanged) { endSpotlight(true); applyLayoutMode(); }
  if (tilesRebuilt) hookAllTileAudio();

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
      if (currentPaths[i]) beginClipTransition(i, vid);
      currentPaths[i] = s.path;
      tileLoopBounds[i] = null; // the old tile's bounds don't apply to whatever's loading now
      tileLoopCount[i] = 0;
      const oldTile = tileElements[i];
      if (oldTile) oldTile.classList.remove('tile-featured'); // ditto for Featured Tile's highlight
      fetchVideoMetaFor(i, s.path);
      // Tells the server how many tiles are active, so dense layouts
      // (4x4/5x5) get a cached low-res proxy instead of the full-size
      // source - matches PRELOAD_MAX_TILES: same grids that skip preload
      // also get the lighter file.
      // &cors=1 keeps CORS-mode requests (see crossOrigin in
      // createTileElement) off any cached copy fetched before the server
      // started sending the CORS header, which would otherwise fail.
      vid.src = mediaOrigin(i) + '/media/' + s.path + '?tiles=' + d.screens.length + '&cors=1';
      applyRandomStart(vid, i);
    }
    const label = document.getElementById('label-' + i);
    if (label) label.innerText = s.name || '';

    // Preload doubles the number of simultaneous <video> elements (one
    // playing + one buffering per tile), and decode/network load scales
    // with that total count, not just connection slots. On big grids
    // (4x4/5x5) that doubling is the difference between comfortably
    // within the machine's decode budget and well past it, so skip the
    // dedicated preload buffer there - rotations may hitch slightly
    // instead of being seamless, trading that for everything actually
    // staying playable.
    if (preloadEnabled && s.next_path && currentTileCount <= PRELOAD_MAX_TILES) {
      const pre = document.getElementById('preload-' + i);
      // Shift the preload's shard off the main video's so a tile's own two
      // requests (current + preloading-next) don't compete for the same
      // origin's connection budget either.
      const nextUrl = mediaOrigin(i + 3) + '/media/' + s.next_path;
      if (pre && pre.getAttribute('src') !== nextUrl) pre.src = nextUrl;
    }

    // Lock already signals "stay on this one longer" - slowing it down
    // too leans into that same intent instead of just holding it fixed
    // at normal speed. Composes with the player's own manual speed
    // slider rather than overriding it.
    const lockMult = d.locked ? TUNING.LOCK_SLOWDOWN_MULT : 1;
    // globalSpeedMult (Rhythm Mode's tempo waves, Finale's speed arc) is
    // kept separate in tileNaturalBase so its own tick can re-apply it
    // between status pushes - see dashboard_layers.js.
    tileNaturalBase[i] = s.speed * lockMult * manualSpeedMult;
    const naturalSpeed = tileNaturalBase[i] * globalSpeedMult();
    const barrageTiles = d.barrage > 0 ? (d.barrage_tiles || []) : [];
    const isSelected = barrageTiles.includes(i);
    const isDimmed = barrageTiles.length > 0 && !isSelected;
    // Only tiles that are, or just were, actually part of a barrage ever
    // get a live effect registered - a tile that's never been near one
    // has no entry in tileSpeedEffects at all, so resolveAndApplyTileSpeed
    // takes its cheap early-exit path instead of evaluating anything.
    if (isSelected || tileSpeedEffects[i] && tileSpeedEffects[i].has('barrageBoost')) {
      setLiveSpeedEffect(i, vid, 'barrageBoost', SPEED_PRIORITY.barrageBoost, isSelected, naturalSpeed, TUNING.BARRAGE_SPEED_FADE_MS, TUNING.BARRAGE_SPEED_FADE_MS);
    }
    if (isDimmed || tileSpeedEffects[i] && tileSpeedEffects[i].has('barrageDim')) {
      setLiveSpeedEffect(i, vid, 'barrageDim', SPEED_PRIORITY.barrageDim, isDimmed, TUNING.BARRAGE_DIM_SPEED_MULT * lockMult * manualSpeedMult * globalSpeedMult(),TUNING.BARRAGE_DIM_FADE_IN_MS, TUNING.BARRAGE_DIM_FADE_OUT_MS);
    }
    resolveAndApplyTileSpeed(i, vid, naturalSpeed);
    tileTension[i] = s.tension;
    applyTileTensionFilter(i, vid);
  });
}

// Tension (from the server) plus Spin Surge's color boost. Also called
// on Spin Surge's own tick, between status pushes, so the boost eases
// in and out smoothly.
let tileTension = [];
function applyTileTensionFilter(i, vid) {
  const tension = tileTension[i] == null ? 1 : tileTension[i];
  const surgeK = spinSurgeColorBoost();
  const sat = Math.floor((tension - 1.0) * 60 + 100 + surgeK * 30);
  const cont = Math.floor((tension - 1.0) * 40 + 100 + surgeK * 10);
  const filterStr = `saturate(${sat}%) contrast(${cont}%)`;
  // The status stream pushes several times a second; tension often comes
  // back unchanged between polls, so skip the write (and the repaint it'd
  // force on a <video>) unless the computed filter actually moved.
  if (filterStr !== lastFilterStr[i]) {
    lastFilterStr[i] = filterStr;
    vid.style.filter = filterStr;
  }
}

function connectStream() {
  const source = new EventSource('/api/stream');
  source.onmessage = (evt) => { setConnected(true); render(JSON.parse(evt.data)); };
  source.onerror = () => setConnected(false);
  return source;
}

function skip() { nudgeEngagement(-0.05); fetch('/api/skip').then(() => toast('⬇️ Skipped All', true)); }
function lock() { fetch('/api/lock').then(() => toast('60s Locked')); }
function cycleTone() { fetch('/api/cycle_tone'); }
function cat(f) { fetch('/api/folder?folder=' + encodeURIComponent(f)).then(() => toast('Category: ' + f.toUpperCase())); }
// Dip-to-dim: bridges a visual rearrangement (layout/tile-count change)
// with a brief fade to black instead of cutting straight to the new
// arrangement - see the CSS comment on
// #layout-fade-overlay for why a full dim rather than an animated reflow.
// `changeFn` runs right at the bottom of the dip, `atDip` (for a caller
// that itself does something async, e.g. an API call) defaults to firing
// `changeFn` inline - not perfectly synced to the moment new content
// actually appears, just a fixed, tunable dip-and-return.
function fadeTransition(changeFn) {
  const overlay = document.getElementById('layout-fade-overlay');
  if (!overlay || TUNING.LAYOUT_FADE_MS <= 0) { changeFn(); return; }
  overlay.style.transition = 'opacity ' + (TUNING.LAYOUT_FADE_MS / 1000) + 's ease';
  overlay.style.opacity = '1';
  setTimeout(() => {
    changeFn();
    setTimeout(() => { overlay.style.opacity = '0'; }, TUNING.LAYOUT_FADE_HOLD_MS);
  }, TUNING.LAYOUT_FADE_MS);
}

let lastLayoutChangeAt = 0;

// `quiet` is the same flag Dynamic Mosaic's zone-driven/drift triggers
// already pass for automatic changes - a manual click always goes
// through immediately, but automatic triggers respect a cooldown since
// the actual reported problem (several tile-count changes landing back
// to back - zone-driven and drift can both fire independently) only
// ever came from that side, not from someone manually clicking fast.
function setLayout(mode, quiet) {
  const now = Date.now();
  // An automatic (quiet) layout change used to fire mid-barrage without
  // any awareness of it - Dynamic Mosaic's own drift timer doesn't know
  // or care what else is going on, so a build-up/hype window could get
  // its tile rebuilt (and dipped through the layout fade) right out from
  // under it, reported as "it refreshed the state and changed" a few
  // seconds into a hype event. Manual clicks still always go through -
  // only automatic ones defer to whatever's actively playing out.
  if (quiet && (now - lastLayoutChangeAt < TUNING.LAYOUT_CHANGE_COOLDOWN_MS || anticipationActive)) return;
  lastLayoutChangeAt = now;
  fadeTransition(() => {
    fetch('/api/layout?mode=' + mode).then(() => { if (!quiet) toast('Layout: ' + mode.toUpperCase()); });
  });
}
function togglePreload() {
  const next = !preloadEnabled;
  fetch('/api/preload?enabled=' + next).then(() => toast('Preload: ' + (next ? 'ON' : 'OFF')));
}
// Pace-as-Reward: deliberately dialing in your own pace is itself worth
// a small reward, not just a background control with no feedback of its
// own. Gated to real manual changes only - `quiet` is what Auto-Pilot's
// own arc passes when it drives pace automatically (see autopilotTick),
// and a flat per-change cooldown stops the reward being farmable by just
// dragging the slider back and forth rapidly.
let paceRewardReadyAt = 0;

function pace(v, quiet) {
  const labels = ['10s Hard Switching', '5s - 30s (Rapid)', '30s - 120s (Balanced)', 'Full Video (Continuous)'];
  document.getElementById('l-pace').innerText = labels[v];
  document.getElementById('pace-input').value = v;
  fetch('/api/pace?mode=' + v).then(() => { if (!quiet) toast('Pace updated'); });
  if (!quiet) {
    markInteraction();
    const now = Date.now();
    if (now >= paceRewardReadyAt) {
      paceRewardReadyAt = now + TUNING.PACE_REWARD_COOLDOWN_MS;
      awardXp(TUNING.PACE_REWARD_XP);
    }
  }
}
function vec(k, v) { fetch('/api/vector?key=' + k + '&val=' + v); }
function rateScreen(i, dir, btn, strength) {
  // Hold-to-Heart already fired an amplified heart for this same press -
  // the subsequent click (pointerup naturally fires one) would otherwise
  // double-count it as a second, separate heart.
  if (dir === 'up' && btn && btn.dataset.holdFired === '1') {
    btn.dataset.holdFired = '';
    return;
  }
  strength = strength || 1;
  markInteraction();
  if (dir === 'up') tasteNoteLike(i);
  if (dir === 'up') {
    claimBonusTile(i);
    bumpHeartMultiplier();
    // Hearting one of the tiles a real barrage actually picked out -
    // while it's live, not just coincidentally at some point during it -
    // is rewarded beyond a normal heart: an extra multiplier bump, a
    // flat XP bonus, and a bit of heat, so reacting to the highlight
    // itself (not just whatever happens to be on screen) pays off.
    if (lastKnownBarrage > 0 && lastKnownBarrageTiles.includes(i)) {
      bumpHeartMultiplier();
      awardXp(15);
      bumpJackpotHeat(0.3);
      fireColorSplashPiece(null, i);
      toast('❤️🔥 Highlighted tile! Bonus heart multiplier');
    }
    onEngagement('heart', i, strength);
    statsLifetimeHearts += strength;
    sessionStats.hearts += strength;
    saveStats();
    updateStatsUi();
    checkTrophies();
    // A little bonus XP and an occasional speed kick right on the
    // hearted tile, both scaling with the multiplier - "more hearts...
    // more chance of rewards" landing on the heart itself, not just the
    // odds of other systems elsewhere.
    if (heartMultiplier > 1) awardXp(Math.round(heartMultiplier));
    if (Math.random() < 0.10 + heartMultiplier * 0.07) {
      const kickVid = getTileVideo(i);
      if (kickVid) setTimelineSpeedEffect(i, kickVid, 'heartKick', SPEED_PRIORITY.heartKick, randomInRange(1.05 + heartMultiplier * 0.02, 1.15 + heartMultiplier * 0.03), 0, 1500, 0);
    }
    dislikeStreak = 0;
    nudgeEngagement(0.12 * strength);
  } else {
    nudgeEngagement(-0.08);
    registerDislikeForRecalibrate();
  }
  const mult = registerCombo();
  awardXp(Math.round(TUNING.RATE_XP_BASE * mult * strength));
  incrementQuestMetric('rates', 1);
  tileLastRatedAt[i] = Date.now();
  // Otherwise this tile's due-aura (if it had one) would keep glowing
  // until tickDueAura's next 5s poll noticed it no longer qualifies -
  // reported as "takes about 4 seconds to clear" after rating it.
  if (i === dueAuraTileIndex) {
    startDueAuraExitFade(i);
    dueAuraTileIndex = -1;
  }
  pulseTileGlow(i, mult, dir !== 'up');
  if (btn) {
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }
  const strengthParam = dir === 'up' && strength > 1 ? '&strength=' + strength : '';
  // Custom Loop Point needs WHERE in the clip this heart landed, not just
  // that it happened - the server tracks it separately from the wall-clock
  // first/last_heart_at timestamps above (see loop_anchor_min/max in db.py).
  const vidEl = tileElements[i] && tileElements[i].querySelector('#screen-' + i);
  const posParam = dir === 'up' && vidEl && isFinite(vidEl.currentTime) ? '&pos=' + vidEl.currentTime.toFixed(2) : '';
  fetch('/api/rate?screen=' + i + '&dir=' + dir + strengthParam + posParam)
    .then((r) => r.json())
    .then((data) => {
      toast(dir === 'up' ? (strength > 1 ? '💞 Deep Heart!' : '❤️ Reinforced') : '👎 Penalized', dir !== 'up');
      if (data && data.heart && data.heart.heart_count >= 2) {
        showClaimRewardLabel(i, (strength > 1 ? '💞 Deep Heart x' : '💗 Heart Streak x') + data.heart.heart_count);
        pulseWarmGlow(i, data.heart.heart_count);
      }
      if (data && data.heart && vidEl) {
        const path = currentPaths[i];
        if (data.loop_anchor) loopAnchorCache[path] = data.loop_anchor;
        // This heart may have just pushed the clip's heart_count past
        // FEATURED_HEART_THRESHOLD - keep the cache in sync so Featured
        // Tile's highlight can pick that up right away instead of only
        // on the clip's next load.
        videoMetaCache[path] = Object.assign({}, videoMetaCache[path], { heart_count: data.heart.heart_count });
        applyLoopAnchorIfReady(i, path);
        applyFeaturedIfReady(i, path);
      }
    })
    .catch(() => {});
}

// A quick border-glow flash on the tile that was just rated, scaling
// with the current combo multiplier - ties the interaction itself
// directly to the same "lit boundary" visual language the jackpot/
// barrage system uses, instead of feedback living only in the XP
// counter. Opacity only, same compositor-only technique as the rest of
// the glow system.
// Tile Audio: each tile's own <video> carries its real audio (separate
// from the ambient overlay track/binaural synth). Replaced the earlier
// per-tile solo toggle with one master volume shared by every tile -
// at 0 every tile stays muted (the original default), above 0 every
// tile plays at the same level together rather than only ever one at a
// time. volume/muted are plain properties on each <video> element and
// survive that element's src changing to a new clip, so this only needs
// applying once per tile creation, not on every rotation.
let tileAudioVolume = 0;

function setTileAudioVolume(v) {
  tileAudioVolume = Math.max(0, Math.min(100, parseFloat(v))) / 100;
  const el = document.getElementById('l-tile-audio-vol');
  if (el) el.innerText = Math.round(tileAudioVolume * 100) + '%';
  hookAllTileAudio();
  tileElements.forEach((tile, i) => {
    const vid = tile.querySelector('#screen-' + i);
    // A tile already routed into the analyser gets its level from the
    // shared tileAudioGainNode instead (see hookTileAudio).
    if (vid) { vid.volume = tileSourceNodes.has(vid) ? 1 : tileAudioVolume; vid.muted = tileAudioVolume <= 0; }
  });
  if (tileAudioGainNode && audioCtx) tileAudioGainNode.gain.setTargetAtTime(tileAudioVolume, audioCtx.currentTime, 0.05);
  try { localStorage.setItem('mm_tile_audio_vol', tileAudioVolume); } catch (e) {}
}

function loadTileAudioVolumePref() {
  let saved = 0;
  try {
    const raw = localStorage.getItem('mm_tile_audio_vol');
    if (raw !== null) saved = parseFloat(raw);
  } catch (e) {}
  if (!Number.isFinite(saved)) saved = 0;
  tileAudioVolume = saved;
  const input = document.getElementById('tile-audio-vol-input');
  if (input) input.value = Math.round(saved * 100);
  const el = document.getElementById('l-tile-audio-vol');
  if (el) el.innerText = Math.round(saved * 100) + '%';
}

function pulseTileGlow(idx, multiplier, negative) {
  const el = tileGlowEls[idx];
  if (!el) return;
  el.style.transition = 'opacity .12s ease-out';
  if (negative) el.style.borderColor = 'rgba(255,90,90,.95)';
  el.style.opacity = Math.min(1, 0.45 + (multiplier - 1) * 0.35).toFixed(2);
  const holdMs = 140 + (multiplier - 1) * 70;
  setTimeout(() => {
    el.style.transition = 'opacity .5s ease-out';
    el.style.opacity = '0';
    setTimeout(() => {
      el.style.transition = '';
      if (negative) el.style.borderColor = '';
    }, 500);
  }, holdMs);
}
