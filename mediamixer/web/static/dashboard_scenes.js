// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Scenes: named snapshots of the whole look and sound (screen, flow, sound),
// stored by the engine so every device shares them, plus optional
// Auto-Pilot zone -> scene links.

// ---- capture / apply ----
// Grouped the same way as the menu tabs. Anything missing from an older
// scene is simply left as it is when applying.
const SCENE_VERSION = 1;
let scenes = []; // [{name, data, updated_at}]
let sceneZones = {}; // zone -> null | 'auto' | scene name
let activeSceneName = null;
let sceneManageMode = false;

function captureScene() {
  const st = lastStatusData || {};
  return {
    v: SCENE_VERSION,
    screen: {
      layout: currentLayout,
      pace: st.pace_idx,
      mosaicFit: mosaicEnabled,
      dynamicMosaic: { zone: dynamicMosaicZoneMode, drift: dynamicMosaicDriftMode, min: dynamicMosaicMinTiles, max: dynamicMosaicMaxTiles },
      speed: manualSpeedMult,
      floaters: { enabled: fxEnabled, count: fxCount, opacity: fxOpacity, source: fxSource },
      manualSpiral: { enabled: manualSpiralEnabled, name: manualSpiralName, opacity: manualSpiralOpacity },
      living: { breathe: livingBreathe, slowmo: livingSlowmo, double: livingDouble, spiralAudio: livingSpiralAudio, gradient: livingGradient, doubleMatch: livingDoubleMatch, colorMood: livingColorMood, smartFraming: livingSmartFraming },
      mantra: { enabled: mantraEnabled, frequency: mantraFrequency, opacity: mantraOpacity, styles: Object.assign({}, mantraStyles) },
    },
    flow: {
      pulse: sharedPulseEnabled,
      rhythm: {
        enabled: rhythmEnabled, pattern: rhythmPatternPref, bpm: rhythmBaseBpm, source: rhythmBpmSource,
        waves: rhythmWaves, speedSync: rhythmSpeedSync, reactive: rhythmReactive, sound: rhythmSound, cutOnBeat: rhythmCutOnBeat,
      },
    },
    sound: {
      binauralVolume, overlayVolume, tileAudio: tileAudioVolume, sfx: sfxVolume,
      tone: st.tone_index, beat: st.binaural_knob, brainwave: brainwaveMode,
      audioReact: { enabled: audioReactEnabled, reactivity: audioReactivity },
    },
  };
}

function setSceneInput(id, value) {
  const el = document.getElementById(id);
  if (el && value != null) el.value = value;
}

// Each step is independent: one failing (or missing from an older scene)
// never stops the rest from applying. fromZone = Auto-Pilot applied it, so
// leave alone what Auto-Pilot itself steers (pace, floater count, and the
// layout while zone-driven Dynamic Mosaic is on).
function applyScene(data, fromZone) {
  const steps = [];
  const step = (fn) => steps.push(fn);
  const scr = data.screen || {}, flow = data.flow || {}, snd = data.sound || {};
  const autopilotOwns = fromZone && autopilotEnabled;

  if (scr.layout && scr.layout !== currentLayout && !(autopilotOwns && dynamicMosaicZoneMode)) step(() => setLayout(scr.layout, !!fromZone));
  if (scr.pace != null && !autopilotOwns) step(() => { pace(scr.pace, true); setSceneInput('pace-input', scr.pace); });
  if (scr.mosaicFit != null && scr.mosaicFit !== mosaicEnabled) step(() => toggleMosaic());
  if (scr.dynamicMosaic) step(() => {
    const m = scr.dynamicMosaic;
    setDynamicMosaicZoneMode(!!m.zone);
    setDynamicMosaicDriftMode(!!m.drift);
    setDynamicMosaicRange(m.min, m.max);
    setSceneInput('dynamic-mosaic-min-input', m.min);
    setSceneInput('dynamic-mosaic-max-input', m.max);
    loadDynamicMosaicPrefs();
  });
  if (scr.speed != null) step(() => { setManualSpeed(scr.speed); setSceneInput('manual-speed-input', scr.speed); });
  if (scr.floaters) step(() => {
    const f = scr.floaters;
    if (f.source && f.source !== fxSource) setFxSource(f.source);
    if (f.opacity != null) { setFxOpacity(f.opacity); setSceneInput('fx-opacity-input', f.opacity); }
    if (f.count != null && !autopilotOwns) { setFxCount(f.count); setSceneInput('fx-count-input', f.count); }
    if (f.enabled != null && f.enabled !== fxEnabled) toggleFx();
  });
  if (scr.manualSpiral) step(() => {
    const s = scr.manualSpiral;
    if (s.opacity != null) setManualSpiralOpacity(Math.round(s.opacity * 100));
    const nameChanged = s.name && s.name !== manualSpiralName;
    if (nameChanged) manualSpiralName = s.name;
    if (s.enabled && !manualSpiralEnabled) toggleManualSpiral();
    else if (!s.enabled && manualSpiralEnabled) toggleManualSpiral();
    else if (s.enabled && nameChanged) { fadeManualSpiral(0, MANUAL_SPIRAL_SWAP_MS); setTimeout(() => showManualSpiral(), MANUAL_SPIRAL_SWAP_MS); }
    saveManualSpiralPrefs();
  });
  if (scr.living) step(() => {
    const l = scr.living;
    if (l.breathe != null && l.breathe !== livingBreathe) toggleLiving('breathe');
    if (l.slowmo != null && l.slowmo !== livingSlowmo) toggleLiving('slowmo');
    if (l.double != null && l.double !== livingDouble) toggleLiving('double');
    if (l.spiralAudio != null && l.spiralAudio !== livingSpiralAudio) toggleLiving('spiralAudio');
    if (l.gradient != null && l.gradient !== livingGradient) toggleLiving('gradient');
    if (l.doubleMatch != null && l.doubleMatch !== livingDoubleMatch) toggleLiving('doubleMatch');
    if (l.colorMood != null && l.colorMood !== livingColorMood) toggleLiving('colorMood');
    if (l.smartFraming != null && l.smartFraming !== livingSmartFraming) toggleLiving('smartFraming');
  });
  if (scr.mantra) step(() => {
    const m = scr.mantra;
    if (m.enabled != null && m.enabled !== mantraEnabled) toggleMantra();
    if (m.frequency != null) setMantraFrequency(m.frequency);
    if (m.opacity != null) { setMantraOpacity(m.opacity); setSceneInput('mantra-opacity-input', m.opacity); }
    if (m.styles) Object.keys(m.styles).forEach((k) => { if (k in mantraStyles && !!m.styles[k] !== !!mantraStyles[k]) toggleMantraStyle(k); });
  });

  if (flow.pulse != null && flow.pulse !== sharedPulseEnabled) step(() => toggleSharedPulse());
  if (flow.rhythm) step(() => {
    const r = flow.rhythm;
    if (r.enabled != null && r.enabled !== rhythmEnabled) toggleRhythm();
    if (r.pattern) setRhythmPattern(r.pattern);
    if (r.bpm != null) setRhythmBpm(r.bpm);
    if (r.source) setRhythmSource(r.source);
    if (r.waves != null && r.waves !== rhythmWaves) toggleRhythmWaves();
    if (r.speedSync != null && r.speedSync !== rhythmSpeedSync) toggleRhythmSpeedSync();
    if (r.reactive != null && r.reactive !== rhythmReactive) toggleRhythmReactive();
    if (r.sound != null && r.sound !== rhythmSound) toggleRhythmSound();
    if (r.cutOnBeat != null && r.cutOnBeat !== rhythmCutOnBeat) toggleRhythmCutOnBeat();
  });

  if (snd.binauralVolume != null) step(() => { setBinauralVolume(snd.binauralVolume); setSceneInput('binaural-vol-input', snd.binauralVolume); });
  if (snd.overlayVolume != null) step(() => { setOverlayVolume(snd.overlayVolume); setSceneInput('overlay-vol-input', snd.overlayVolume); });
  if (snd.tileAudio != null) step(() => { setTileAudioVolume(snd.tileAudio); setSceneInput('tile-audio-vol-input', snd.tileAudio); });
  if (snd.sfx != null) step(() => { setSfxVolume(snd.sfx); setSceneInput('sfx-vol-input', snd.sfx); });
  if (snd.tone != null) step(() => fetch('/api/tone?index=' + snd.tone));
  if (snd.beat != null) step(() => {
    vec('binaural', snd.beat);
    setSceneInput('beat-input', snd.beat);
    const l = document.getElementById('l-beat');
    if (l) l.innerText = (+snd.beat).toFixed(2);
  });
  if (snd.brainwave) step(() => setBrainwaveMode(snd.brainwave));
  if (snd.audioReact) step(() => {
    const a = snd.audioReact;
    if (a.enabled != null && a.enabled !== audioReactEnabled) toggleAudioReact();
    if (a.reactivity != null) { setAudioReactivity(a.reactivity); setSceneInput('audio-react-input', a.reactivity); }
  });

  let failed = 0;
  steps.forEach((fn) => { try { fn(); } catch (e) { failed++; console.warn('scene step failed', e); } });
  return failed;
}

function applySceneByName(name, source) {
  const scene = scenes.find((s) => s.name === name);
  if (!scene) return false;
  applyScene(scene.data, source === 'zone');
  activeSceneName = name;
  renderScenesUi();
  if (source !== 'zone') toast('🎬 ' + name);
  return true;
}

// ---- storage (engine) ----
function sceneRequest(url, body) {
  return fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'request failed'); return d; }))
    .then((d) => { scenes = d.scenes || []; sceneZones = d.zones || {}; renderScenesUi(); return d; });
}

function loadScenes() { return sceneRequest('/api/scenes').catch(() => {}); }

function saveCurrentAsScene() {
  const suggested = activeSceneName || '';
  const name = (window.prompt('Name this scene (saving over an existing name updates it):', suggested) || '').trim();
  if (!name) return;
  sceneRequest('/api/scenes', { name, data: captureScene() })
    .then(() => { activeSceneName = name; renderScenesUi(); toast('🎬 Saved "' + name + '"'); })
    .catch((e) => toast('🎬 ' + e.message, true));
}

function updateScene(name) {
  sceneRequest('/api/scenes', { name, data: captureScene() }).then(() => toast('🎬 Updated "' + name + '" to how things are now'));
}

function renameScene(name) {
  const to = (window.prompt('Rename "' + name + '" to:', name) || '').trim();
  if (!to || to === name) return;
  sceneRequest('/api/scenes/rename', { from: name, to })
    .then(() => { if (activeSceneName === name) activeSceneName = to; renderScenesUi(); })
    .catch((e) => toast('🎬 ' + e.message, true));
}

function deleteScene(name) {
  if (!window.confirm('Delete the scene "' + name + '"?')) return;
  sceneRequest('/api/scenes/delete', { name }).then(() => { if (activeSceneName === name) activeSceneName = null; renderScenesUi(); });
}

function setSceneZone(zone, value) {
  sceneRequest('/api/scenes/zones', { zone, value: value === '' ? null : value }).catch((e) => toast('🎬 ' + e.message, true));
}

function toggleSceneManage() { sceneManageMode = !sceneManageMode; renderScenesUi(); }

// ---- Auto-Pilot zone links ----
// When a zone starts and it's linked, its scene blends in: a named one, or
// 'auto' = one of your scenes at random (not the one already up).
let sceneZoneSeen = null;
setInterval(() => {
  const zone = autopilotEnabled ? autopilotZone : null;
  if (zone === sceneZoneSeen) return;
  sceneZoneSeen = zone;
  if (!zone) return;
  const link = sceneZones[zone];
  if (!link || !scenes.length) return;
  let name = link;
  if (link === 'auto') {
    const pool = scenes.filter((s) => s.name !== activeSceneName);
    name = (pool.length ? pool : scenes)[Math.floor(Math.random() * (pool.length || scenes.length))].name;
  }
  if (applySceneByName(name, 'zone')) toast('🎬 ' + AUTOPILOT_ZONES[zone].label + ' → ' + name);
}, 1000);

// ---- UI ----
function escapeSceneText(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderScenesUi() {
  const bar = document.getElementById('scene-chips');
  if (bar) {
    const chips = scenes.map((s, i) => {
      const active = s.name === activeSceneName ? ' active' : '';
      const manage = sceneManageMode
        ? '<span class="scene-chip-tools"><button title="Update to current" onclick="event.stopPropagation();updateScene(scenes[' + i + '].name)">💾</button>'
          + '<button title="Rename" onclick="event.stopPropagation();renameScene(scenes[' + i + '].name)">✏️</button>'
          + '<button title="Delete" onclick="event.stopPropagation();deleteScene(scenes[' + i + '].name)">🗑</button></span>'
        : '';
      return '<button class="scene-chip' + active + '" onclick="applySceneByName(scenes[' + i + '].name)">' + escapeSceneText(s.name) + manage + '</button>';
    }).join('');
    bar.innerHTML = (chips || '<span class="scene-empty">No scenes yet - set things up how you like, then save.</span>')
      + '<button class="scene-chip scene-add" onclick="saveCurrentAsScene()">＋ Save current</button>'
      + (scenes.length ? '<button class="scene-chip scene-manage' + (sceneManageMode ? ' active' : '') + '" onclick="toggleSceneManage()">' + (sceneManageMode ? 'Done' : '✎ Manage') + '</button>' : '');
  }
  const zones = document.getElementById('scene-zone-links');
  if (zones) {
    const options = (cur) => '<option value=""' + (!cur ? ' selected' : '') + '>None</option>'
      + '<option value="auto"' + (cur === 'auto' ? ' selected' : '') + '>Auto (any of my scenes)</option>'
      + scenes.map((s) => '<option value="' + escapeSceneText(s.name) + '"' + (cur === s.name ? ' selected' : '') + '>' + escapeSceneText(s.name) + '</option>').join('');
    zones.innerHTML = AUTOPILOT_ZONE_NAMES.map((z) =>
      '<label class="scene-zone-row"><span>' + AUTOPILOT_ZONES[z].label + '</span><select onchange="setSceneZone(\'' + z + '\', this.value)">' + options(sceneZones[z]) + '</select></label>'
    ).join('');
  }
}
