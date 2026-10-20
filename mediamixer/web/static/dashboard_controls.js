// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Vibe dial, recalibrate, session timer, menu panel/tabs and toasts.

// ---- Discovery/Favorites Vibe Dial ----
// A direct manual control over the exact same exploration_bonus the
// backend's bandit selection already uses (see pick_video/exploration_score
// server-side): low = stick close to what already scores well (familiar),
// high = give lightly-played clips a real shot even against established
// favorites (discovery). Auto-Pilot's arc already blends this
// automatically on its own curve while running (the ARC table's `novelty`
// column, sent via the same /api/novelty endpoint) - that's the
// "functions could auto-blend this" half of the idea. This dial is the
// *manual* half: your own resting preference, which Auto-Pilot temporarily
// overrides while active and hands back to on stop (see stopAutopilot).
const VIBE_DIAL_KEY = 'mm_vibe_dial';
const VIBE_DIAL_DEFAULT = 0.50; // matches config.exploration_bonus_c's shipped default - nudged up for a bit more default discovery
let vibeDialValue = VIBE_DIAL_DEFAULT;

function applyVibeDial(value) {
  fetch('/api/novelty?bonus=' + value.toFixed(3));
}

function setVibeDial(v) {
  vibeDialValue = parseFloat(v);
  const el = document.getElementById('l-vibe-dial');
  if (el) el.innerText = vibeDialValue < 0.5 ? 'Familiar' : (vibeDialValue > 1.6 ? 'Discovery' : 'Balanced');
  try { localStorage.setItem(VIBE_DIAL_KEY, vibeDialValue); } catch (e) {}
  if (!autopilotEnabled) applyVibeDial(vibeDialValue);
}

// Fast-Dislike "Recalibrate": several 👎 in a row reads as "nothing
// here is landing right now," not just more negative data points to
// quietly fold into the reward average - it triggers an immediate
// reroll of everything on screen plus a brief discovery push, instead
// of leaving the viewer to keep disliking the same vein of content one
// clip at a time while the slower-moving reward averages catch up.
const RECALIBRATE_THRESHOLD = 3;
const RECALIBRATE_DISCOVERY_BONUS = 1.75;
const RECALIBRATE_DISCOVERY_HOLD_MS = 20000;
let dislikeStreak = 0;

function registerDislikeForRecalibrate() {
  dislikeStreak++;
  if (dislikeStreak >= RECALIBRATE_THRESHOLD) {
    dislikeStreak = 0;
    recalibrate();
  }
}

function recalibrate() {
  toast('🔄 Recalibrating - mixing it up');
  nudgeEngagement(-0.3); // a clear rejection signal - three dislikes in a row is not "flat," it's actively not landing
  fetch('/api/skip');
  // Deliberate recovery, not just a reroll: an active rejection gets a
  // real attempt at a palate-cleanser right now instead of waiting on
  // boredom debt's own unrelated schedule to maybe deliver one.
  fetch('/api/double_feature').catch(() => {});
  if (!autopilotEnabled) {
    applyVibeDial(Math.max(vibeDialValue, RECALIBRATE_DISCOVERY_BONUS));
    setTimeout(() => { if (!autopilotEnabled) applyVibeDial(vibeDialValue); }, RECALIBRATE_DISCOVERY_HOLD_MS);
  }
}

function loadVibeDialPref() {
  let saved = VIBE_DIAL_DEFAULT;
  try {
    const raw = localStorage.getItem(VIBE_DIAL_KEY);
    if (raw !== null) saved = parseFloat(raw);
  } catch (e) {}
  if (!Number.isFinite(saved)) saved = VIBE_DIAL_DEFAULT;
  vibeDialValue = saved;
  const input = document.getElementById('vibe-dial-input');
  if (input) input.value = saved;
  setVibeDial(saved);
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

const PANEL_TAB_NAMES = ['screen', 'flow', 'rewards', 'sound', 'controls'];
// Tabs from before the regroup, so a remembered tab still opens somewhere sensible.
const PANEL_TAB_RENAMES = { display: 'screen', autopilot: 'flow', engagement: 'rewards', audio: 'sound', more: 'screen', tuning: 'controls' };

function switchPanelTab(name) {
  name = PANEL_TAB_RENAMES[name] || name;
  if (!PANEL_TAB_NAMES.includes(name)) name = PANEL_TAB_NAMES[0];
  document.querySelectorAll('.panel-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === name));
  document.querySelectorAll('.panel-tab-btn').forEach(el => el.classList.toggle('active', el.dataset.tab === name));
  try { localStorage.setItem('mm_panel_tab', name); } catch (e) {}
  if (name === 'controls') loadEngineConfig();
}

function restorePanelTab() {
  let name = PANEL_TAB_NAMES[0];
  try { name = localStorage.getItem('mm_panel_tab') || name; } catch (e) {}
  switchPanelTab(name);
}

let toastHideTimer = null;

function toast(msg, neg) {
  const box = document.getElementById('toast');
  box.innerText = msg;
  box.style.borderColor = neg ? '#ff4d4d' : '#b84dff';
  box.style.display = 'block';
  // A second toast fired while an earlier one was still mid-countdown
  // (e.g. a jackpot's own toast, then Bank/Push clicked a second later)
  // left that first toast's hide timer running - it would still fire on
  // schedule and yank the SECOND toast's text away early, well short of
  // the intended 1.8s, reported as "the result text quickly disappears."
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => box.style.display = 'none', 1800);
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

// ---- Menu polish: quick switches, on/off switches, live section status ----
// One 500ms pass keeps all three in step with the real state, however it
// changed (a click, a Scene, Auto-Pilot, another device's prefs on reload).
const QUICK_SWITCH_STATE = {
  autopilot: () => autopilotEnabled,
  pulse: () => sharedPulseEnabled,
  rhythm: () => rhythmActive(),
  spiral: () => manualSpiralEnabled,
};

const SECTION_LIVE = {
  layout: () => (currentLayout || '').replace('grid', '').replace('dual', '2 tiles') + (lastStatusData ? ' · ' + ['10s', 'rapid', 'balanced', 'full'][lastStatusData.pace_idx] : ''),
  mosaic: () => (dynamicMosaicDriftMode ? 'drifting' : dynamicMosaicZoneMode ? 'zone-driven' : 'off'),
  floaters: () => (fxEnabled ? fxCount + ' · ' + fxOpacity + '%' : 'off'),
  spiral: () => (manualSpiralEnabled ? Math.round(manualSpiralOpacity * 100) + '%' : 'off'),
  autopilot: () => (autopilotEnabled ? (autopilotZone ? AUTOPILOT_ZONES[autopilotZone].label : 'on') : 'off'),
  pulse: () => (sharedPulseEnabled ? 'energy ×' + rhythmDrive.toFixed(2) : 'off'),
  rhythm: () => (rhythmActive() ? Math.round(currentRhythmBpm()) + ' BPM · ' + RHYTHM_PATTERNS[rhythmPattern].label : 'off'),
  taste: () => (tasteStrength > 0 ? Math.round(tasteStrength * 100) + '%' : 'off'),
  sound: () => (lastSynthParams ? Math.round(lastSynthParams.carrier_hz) + ' Hz · beat ' + pulseBinauralHz(lastSynthParams).toFixed(1) + ' Hz' : ''),
};

function updateMenuState() {
  document.querySelectorAll('.quick-switch').forEach((b) => {
    const get = QUICK_SWITCH_STATE[b.dataset.quick];
    try { b.classList.toggle('on', !!(get && get())); } catch (e) {}
  });
  // Every ON/OFF button is drawn as a switch; its text is the source of truth.
  document.querySelectorAll('button.badge[id$="-toggle"]').forEach((b) => {
    b.classList.add('switch');
    b.classList.toggle('on', b.innerText.trim().toUpperCase() === 'ON');
  });
  document.querySelectorAll('.section-live[data-live]').forEach((el) => {
    const get = SECTION_LIVE[el.dataset.live];
    let text = '';
    try { text = get ? get() : ''; } catch (e) {}
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('off', text === 'off');
  });
}
setInterval(updateMenuState, 500);
