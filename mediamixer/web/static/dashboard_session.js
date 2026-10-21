// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Shaping a session: a "how do you want this one?" card at the start of a
// new session (Drift / Ride / Chaos / one of your Scenes, plus an optional
// length), and a wind-down that eases everything toward calm.

// ---- Wind-down ----
// Over a few minutes: energy and tempo settle, pace moves to longer clips,
// floaters thin out, barrage/jackpot odds fall, build-ups and Living
// Screen moments pause, the beat goes to Theta and the screen dims a
// little. Nothing stops playing, nothing saved is changed, and Keep going
// puts it all back exactly as it was.
const WIND_DOWN_DEFAULT_MS = 5 * 60000;
const WIND_DOWN_MAX_DIM = 0.45;
let windDown = null;
let windDownScheduledAt = 0; // when a chosen session length starts its wind-down
let windDownLastIntensityAt = 0;

function windDownK() {
  if (!windDown) return 0;
  return fxSmoothstep(Math.min(1, (Date.now() - windDown.startedAt) / windDown.ms));
}

// Called from autopilotTick so Auto-Pilot and the wind-down don't fight.
function windDownPaceFloor() {
  const k = windDownK();
  return k > 0.65 ? 3 : k > 0.25 ? 2 : 0;
}
function windDownFxCap() {
  return windDown ? Math.max(1, Math.round((windDown.saved.fxCount || 3) * (1 - windDownK()))) : Infinity;
}
function windDownOddsMult() { return 1 - 0.85 * windDownK(); }

function startWindDown(ms) {
  if (windDown) return;
  windDownScheduledAt = 0;
  windDown = {
    startedAt: Date.now(), ms: ms || WIND_DOWN_DEFAULT_MS, finished: false,
    saved: {
      pace: lastStatusData ? lastStatusData.pace_idx : 2, fxCount, anticipation: anticipationFxEnabled,
      slowmo: livingSlowmo, double: livingDouble, brainwave: brainwaveMode,
    },
  };
  toast('🌙 Winding down over ' + Math.round(windDown.ms / 60000) + ' min');
  updateSessionUi();
}

function cancelWindDown() {
  if (!windDown) return;
  const s = windDown.saved;
  windDown = null;
  if (!autopilotEnabled) { pace(s.pace, true); setSceneInput('pace-input', s.pace); fetch('/api/intensity?reset=1'); }
  if (fxEnabled && fxCount !== s.fxCount) { setFxCount(s.fxCount); setSceneInput('fx-count-input', s.fxCount); }
  anticipationFxEnabled = s.anticipation;
  livingSlowmo = s.slowmo;
  livingDouble = s.double;
  if (brainwaveMode !== s.brainwave) setBrainwaveMode(s.brainwave);
  document.getElementById('wind-down-dim').style.opacity = '0';
  toast('🌊 Back in it');
  updateSessionUi();
}

setInterval(() => {
  if (!windDown && windDownScheduledAt && Date.now() >= windDownScheduledAt) startWindDown();
  if (!windDown) return;
  const k = windDownK();
  document.getElementById('wind-down-dim').style.opacity = (WIND_DOWN_MAX_DIM * k).toFixed(3);
  if (!autopilotEnabled) {
    const want = Math.max(windDown.saved.pace, windDownPaceFloor());
    if (lastStatusData && lastStatusData.pace_idx !== want) { pace(want, true); setSceneInput('pace-input', want); }
    if (fxEnabled && fxCount > windDownFxCap()) setFxCount(windDownFxCap());
    if (Date.now() - windDownLastIntensityAt > 10000) {
      windDownLastIntensityAt = Date.now();
      const f = engineConfigFields || {};
      const base = (name, d) => (f[name] ? f[name].value : d);
      fetch('/api/intensity?barrage=' + (base('barrage_probability', 0.05) * windDownOddsMult()).toFixed(3) + '&jackpot=' + (base('jackpot_probability', 0.1) * windDownOddsMult()).toFixed(3));
    }
  }
  if (k > 0.55) { anticipationFxEnabled = false; livingSlowmo = false; livingDouble = false; }
  if (k > 0.35 && brainwaveMode !== 'theta') {
    brainwaveMode = 'theta'; // temporary - not saved; Keep going restores the real setting
    if (lastSynthParams) updateSynthParams(lastSynthParams);
  }
  if (k >= 1 && !windDown.finished) { windDown.finished = true; toast('🌙 All wound down - Keep going whenever you want back in'); showSessionRecap('🌙 Wound down - your session'); }
  updateSessionUi();
}, 2000);

// ---- Session intent ----
const SESSION_NEW_AFTER_MS = 30 * 60000; // away this long = a new session, so ask again
const SESSION_INTENTS = {
  drift: {
    label: '🌊 Drift', autopilot: false,
    scene: { screen: { pace: 2, floaters: { enabled: true, count: 2, opacity: 50 }, living: { breathe: true, slowmo: true, double: true, spiralAudio: true } }, flow: { pulse: true, rhythm: { enabled: false } }, sound: { brainwave: 'theta' } },
  },
  ride: {
    label: '🎢 Ride', autopilot: true, autopilotMinutes: 6,
    scene: { flow: { pulse: true, rhythm: { enabled: true, pattern: 'mix', cutOnBeat: true } }, sound: { brainwave: 'mood' } },
  },
  chaos: {
    label: '⚡ Chaos', autopilot: true, autopilotMinutes: 3,
    scene: { screen: { pace: 1, floaters: { enabled: true, count: 6, opacity: 80 } }, flow: { pulse: true, rhythm: { enabled: true, pattern: 'mix', bpm: 120, cutOnBeat: true } }, sound: { brainwave: 'beta' } },
  },
};
let sessionAskEnabled = true;
let sessionLengthMin = 0; // 0 = open-ended

function setSessionLength(min) {
  sessionLengthMin = min;
  document.querySelectorAll('.session-length-btn').forEach((b) => b.classList.toggle('active', +b.dataset.min === min));
}

function scheduleSessionLength() {
  windDownScheduledAt = sessionLengthMin ? Date.now() + Math.max(1, sessionLengthMin - WIND_DOWN_DEFAULT_MS / 60000) * 60000 : 0;
  if (sessionLengthMin) toast('🕐 ' + sessionLengthMin + ' min session - wind-down starts in ' + Math.round((windDownScheduledAt - Date.now()) / 60000) + ' min');
}

let sessionIntentKey = null; // the intent picked for this session (read by Visual Textures)
function chooseSessionIntent(key) {
  const intent = SESSION_INTENTS[key];
  if (!intent) return;
  sessionIntentKey = key;
  if (windDown) cancelWindDown();
  applyScene(intent.scene, false);
  if (intent.autopilotMinutes) { setAutopilotMinutes(intent.autopilotMinutes); setSceneInput('autopilot-minutes-input', intent.autopilotMinutes); }
  if (intent.autopilot !== autopilotEnabled) toggleAutopilot();
  scheduleSessionLength();
  closeSessionIntent();
  toast(intent.label + ' - enjoy');
  updateSessionUi();
}

function chooseSessionScene(name) {
  if (windDown) cancelWindDown();
  applySceneByName(name);
  scheduleSessionLength();
  closeSessionIntent();
}

function openSessionIntent() {
  const box = document.getElementById('session-intent');
  if (!box) return;
  const chips = document.getElementById('session-intent-scenes');
  if (chips) {
    chips.innerHTML = scenes.length
      ? scenes.map((s, i) => '<button class="scene-chip" onclick="chooseSessionScene(scenes[' + i + '].name)">🎬 ' + escapeSceneText(s.name) + '</button>').join('')
      : '';
  }
  setSessionLength(sessionLengthMin);
  box.style.display = 'flex';
}

function closeSessionIntent() {
  const box = document.getElementById('session-intent');
  if (box) box.style.display = 'none';
}

function toggleSessionAsk() {
  sessionAskEnabled = !sessionAskEnabled;
  saveJsonPref('mm_session_ask', { enabled: sessionAskEnabled });
  updateSessionUi();
}

// Last-active heartbeat, so a reload mid-session doesn't ask again.
setInterval(() => { if (!document.hidden) { try { localStorage.setItem('mm_last_active', Date.now()); } catch (e) {} } }, 30000);

function loadSessionPrefs() {
  sessionAskEnabled = loadJsonPref('mm_session_ask', { enabled: true }).enabled !== false;
  let lastActive = 0;
  try { lastActive = parseInt(localStorage.getItem('mm_last_active') || '0', 10) || 0; } catch (e) {}
  try { localStorage.setItem('mm_last_active', Date.now()); } catch (e) {}
  updateSessionUi();
  // Scenes load async - give them a moment so their chips can appear in the card.
  if (sessionAskEnabled && Date.now() - lastActive > SESSION_NEW_AFTER_MS) setTimeout(openSessionIntent, 1200);
}

function updateSessionUi() {
  setToggleBadge('session-ask-toggle', sessionAskEnabled);
  const el = document.getElementById('session-status');
  if (!el) return;
  if (windDown) {
    const k = windDownK();
    el.innerText = k >= 1 ? '🌙 Wound down - Keep going to pick back up' : '🌙 Winding down · ' + Math.round(k * 100) + '%';
  } else if (windDownScheduledAt) {
    el.innerText = '🕐 Wind-down starts in ' + Math.max(0, Math.round((windDownScheduledAt - Date.now()) / 60000)) + ' min';
  } else {
    el.innerText = 'Open-ended session';
  }
  const keep = document.getElementById('session-keep-going');
  if (keep) keep.style.display = windDown ? '' : 'none';
}
