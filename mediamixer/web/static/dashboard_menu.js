// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// The menu's helpers: per-option help (ⓘ), the search box, play time
// (tracking + the Home calendar) and the level / prestige tracker.

// ---- Per-option help ----
// One or two sentences per control, keyed by section title (without its
// emoji) and the start of the control's label. The section's longer
// write-up stays below as "📖 Full details".
const OPTION_HELP = {
  'Layout & Pace': {
    'Rotation Pace': 'How long each tile keeps a clip before changing. Fast presets change every few seconds; slow ones let clips play out.',
    'Preload Next Clip': 'Loads each tile\'s next clip in the background so changes are instant. Turn off on slow machines with big grids.',
    'Mosaic Fit': 'Sizes tiles to each clip\'s own shape to cut down on black bars, instead of an even grid.',
    'Tile Gestures': 'Swipe a tile to swap it, long-press to pin its clip, double-tap for More like this, scroll over it to change its speed.',
    'Performance': 'Auto switches this device to Light if it keeps dropping video frames. Light leaves out the heaviest effects; Full keeps everything on.',
    'Playback Speed': 'A speed multiplier for every tile on this device, on top of the engine\'s own speed changes. 1.00x leaves them untouched.',
  },
  'Dynamic Mosaic': {
    'Zone-Driven': 'Auto-Pilot\'s zone picks the tile count: Vault stays small and focused, Color and Jackpot go wide.',
    'Ambient Drift': 'Wanders the tile count around your range on a timer, with or without Auto-Pilot.',
    'Tile Range': 'The fewest and most tiles Dynamic Mosaic may use.',
  },
  'Floating Overlay': {
    'Enabled': 'Clips that drift and fade across the screen like a DVD logo.',
    'Source': 'Overlay Folder uses your Overlay Source folders, Main Library uses your tile clips, Both mixes them.',
    'Floating Count': 'How many floaters at once. Light mode caps this at 1.',
    'Opacity': 'How solid the floaters are.',
  },
  'Living Screen': {
    'Breathing Tiles': 'Each tile slowly drifts and zooms a few percent on its own cycle, faster with the Shared Pulse.',
    'Slow-Mo Moments': 'At high energy one tile eases into slow motion for a couple of seconds, with a motion trail. Only well-buffered tiles are picked.',
    'Double Exposure': 'Now and then a second clip fades in over a tile as a light blend, then separates.',
    'Spirals React to Audio': 'Hits in what you\'re hearing give the spirals a quick swell. Needs Audio-Reactive FX on.',
    'Smart Framing': 'Each tile pans gently toward where the movement is in its clip, with a slight zoom.',
    'Colour Mood': 'The edge glow, light leaks and duotone colours follow how warm or cool the clips on screen are.',
  },
  'Visual Textures': {
    'Split Frames': 'Now and then one tile splits into 2 or 4 panes of the same clip at different moments.',
    'Film Grain': 'A light film grain with the odd speck of dust, stronger in calm moments. Off in Light mode.',
    'Edge Bleed': 'Each tile\'s colour glows softly into the gaps around it. Off in Light mode.',
  },
  'Hooks & Tease': {
    'Hooks': 'A clip\'s best couple of seconds (where you hearted it, or its strongest repeating stretch) plays three times, like a song\'s hook.',
    'Tease Reveal': 'A new clip sometimes arrives zoomed in on the action, then slowly pulls back to the full frame.',
  },
  'Crop Focus & Gravity': {
    'Crop Focus': 'When Mosaic has to crop a clip, it cuts from the empty side rather than the action.',
    'Gravity': 'The tile with the most movement swells a little over its neighbours.',
  },
  'Manual Spiral': {
    'Enabled': 'Keeps one spiral of your choice over the whole screen. Prev / Next step through your Spiral Source.',
    'Opacity': 'How strong your manual spiral is.',
  },
  'Mantra Text': {
    'Enabled': 'Your own phrases appear over the screen.',
    'Frequency': 'How often phrases appear. It rises on its own during spirals, surges and Finales.',
    'Styles': 'Drift floats a phrase away, Flash is a brief centred word, On the Beat pops one on a strong hit.',
    'Max Opacity': 'The strongest a phrase can appear.',
    'Phrases': 'Your phrases, one per line.',
  },
  'Content Pulse': {
    'Energy Follows the Clips': 'When the clips on screen move more than usual, the session\'s energy (and everything on the Shared Pulse) lifts with them.',
    'Glow on Clip Peaks': 'A tile and the screen edge glow when its clip reaches one of its motion peaks.',
    'Cuts Wait for Clip Peaks': 'About half the time, a tile about to change waits until just after a peak that\'s coming up.',
  },
  'Session': {
    'Ask at the start': 'After 30+ minutes away, a card asks how you want this session: Drift, Ride, Chaos or one of your Scenes, plus an optional length.',
    'Session Timer': 'A quiet elapsed-time readout at the top of the menu.',
  },
  'Auto-Pilot': {
    'Enabled': 'Runs pace, odds, floaters and discovery through repeating calm → build → climax → cooldown cycles.',
    'Typical Pace': 'A baseline cycle length. Zones stretch while you\'re engaged and end sooner when you\'re not.',
    'Current Zone': 'What this cycle leans into: Chase, Color, Jackpot, Vault or Rhythm. Switch It Up changes it now.',
    'Zone Scenes': 'Link a zone to one of your Scenes (or Auto) so it blends in whenever that zone starts.',
  },
  'Clip DNA': {
    'Gradient Moments': 'Now and then the grid fills with clips arranged dark → light, cool → warm or calm → wild.',
    'Colour-Matched': 'Double exposures pair clips that look alike.',
  },
  'Shared Pulse': {
    'Enabled': 'One energy signal that spirals, the binaural beat and the glows all follow. Off lets each keep its own pace.',
  },
  'Rhythm Mode': {
    'Enabled': 'A steady beat the grid moves to: tiles light in a pattern and every downbeat kicks the edge glow.',
    'Tempo Source': 'Manual uses Base Tempo. Follow Audio locks onto the beat in what\'s playing. Follow Clips takes it from the clips on screen.',
    'Base Tempo': 'The beat\'s speed, in beats per minute.',
    'Tempo Waves': 'The tempo builds over about 70 seconds, then drops back to base.',
    'Speed Follows Tempo': 'Tile playback speed rides the tempo waves, from about 0.95x up to 1.25x.',
    'Stutter Edits': 'On a downbeat, a tile now and then repeats the same half-beat two or three times. Off in Light mode.',
    'Cascades': 'One tile\'s clip ripples across the grid a beat at a time. Off in Light mode.',
    'Cut on the Beat': 'Clip changes wait for the next beat (1.5s at most) so cuts land in time.',
    'Tempo Follows Energy': 'The tempo rises and falls with the session\'s energy.',
    'Beat Pattern': 'How tiles light on each beat: snake, ping-pong, scatter, ripple, heartbeat, or Mix to rotate through them.',
    'Beat Sound': 'What you hear on the beat: Kick, Tick, Heart, Tone (the binaural tone swells), or Off. Its volume is in Device Audio.',
    'Beat-Matching': 'Clips with a steady rhythm of their own are nudged up to 12% faster or slower so they move in time.',
    'Visual Tone': 'The screen softly brightens on each beat. Off in Light mode.',
  },
  'Discovery Vibe': {
    'Familiar': 'Low sticks to clips you already like; high gives lightly played clips a real chance. Auto-Pilot sets this while it runs.',
  },
  'Taste Learning': {
    'Strength': 'How hard picks lean toward the effects, beat patterns and kinds of clips you heart. 0% turns it off.',
  },
  'Fresh Drops': {
    'Enabled': 'New clips debut one at a time with a reveal. Up to 6 wait for this; the rest of a big batch plays straight away.',
  },
  'Finale': {
    'Length': 'How long a Finale runs, from build to afterglow.',
    'Offer one': 'Suggests a Finale once during a long Auto-Pilot session.',
  },
  'Barrages': {
    'Barrage odds': 'The chance per roll (about every 3 seconds) that a few tiles are highlighted while the rest dim. Auto-Pilot sets its own odds.',
  },
  '↺ Replays & Callbacks': {
    'Heart Replay': 'A moment after you heart a tile, the bit you hearted replays once, slightly slowed.',
    'Callbacks': 'A clip you hearted earlier this session comes back for about 12 seconds on another tile.',
  },
  'Moments': {
    'The Drop': 'Needs Rhythm Mode. At high energy the beat drops out for a bar, then every tile cuts together on the downbeat.',
    'Breath': 'Ten calm seconds: tiles slow, the screen dims and the beat settles to Theta.',
    'Countdown Reveal': 'Before a big jackpot, three tiles go dark and light back up 3, 2, 1.',
    'Focus Pull': 'Every tile but one goes soft, and the focus moves to a new tile each bar.',
    'Call & Response': 'Two neighbouring tiles trade the beat for two bars.',
    'Echo Trails': 'At peak energy every tile briefly leaves motion trails.',
    'Favourite Takeover': 'A clip you heart three times in a session gets the screen to itself for a few seconds.',
    'Heart Burst': 'Two quick hearts send hearts flying into the neighbouring tiles and lean picks toward that clip\'s look.',
    'Heart Echo': 'Each heart sends a soft ripple out across the screen.',
  },
  'Anticipation': {
    'Build-up & Payoff FX': 'Tension builds before a real jackpot, with a tier reveal and a payoff. Also turns on bonus, sealed and mystery tiles, XP and Golden Hour.',
    'Fake Near-Misses': 'Sometimes the build-up plays with nothing behind it.',
  },
  'Visual FX Rewards': {
    'Enabled': 'Rewards can light up a tile with a few seconds of prism, zoom pulse, VHS and more. Light mode keeps only the lightest ones.',
    'Preview': 'Tap an effect to try it on a random tile.',
  },
  'Device Audio': {
    'Carrier': 'The pitch of the binaural tone. Cycle steps through the presets.',
    'Binaural Beat': 'How far apart the two ears\' tones are - the beat you sense. Brainwave can lock it instead.',
    'Brainwave': 'Locks the beat onto Delta, Theta, Alpha, Beta or Gamma. Mood picks from the zone and energy; Free lets it drift.',
    'Binaural Tone': 'Volume of the binaural tone on this device. Headphones are needed for the binaural effect.',
    'Overlay Track': 'Volume of the overlay audio track.',
    'Beat Sound volume': 'Volume of the Rhythm Mode beat sound.',
    'Tile Audio': 'Every tile\'s own sound, all at this one level. 0% keeps tiles muted.',
    'Spatial Sound': 'Each tile\'s audio comes from where it sits on screen. Best with headphones.',
    'SFX Volume': 'Volume of chimes, risers and other reward sounds.',
  },
  'Audio-Reactive FX': {
    'Enabled': 'The screen edge glows with the loudness of what you hear, and real hits flash a tile.',
    'Reactivity': 'How strongly the glows and pulses respond.',
  },
};

function menuSectionKey(section) {
  const t = section.querySelector('.section-title');
  if (!t) return '';
  const clone = t.cloneNode(true);
  clone.querySelectorAll('.experimental-pill').forEach((p) => p.remove());
  return clone.textContent.trim().replace(/^[^\w↺]+/u, '').trim();
}

function labelText(label) {
  return label.textContent
    .replace(/[0-9#*]️?⃣/gu, '') // keycap emoji like 3️⃣
    .replace(/[\u{1F300}-\u{1FAFF}☀-➿️〰ⓘ]/gu, '') // emoji, and our own ⓘ
    .trim();
}

function addOptionHelp() {
  document.querySelectorAll('.panel-tab:not([data-tab="controls"]) .settings-section').forEach((section) => {
    const help = OPTION_HELP[menuSectionKey(section)];
    if (!help) return;
    section.querySelectorAll('.settings-section-body label').forEach((label) => {
      if (label.querySelector('.opt-help-btn')) return;
      const text = labelText(label);
      const key = Object.keys(help).find((k) => text.startsWith(k));
      if (!key) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt-help-btn';
      btn.textContent = 'ⓘ';
      btn.title = help[key];
      const row = label.closest('.slider') || label.parentElement;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = row.nextElementSibling;
        if (next && next.classList.contains('opt-help')) { next.remove(); return; }
        const box = document.createElement('div');
        box.className = 'opt-help';
        box.textContent = help[key];
        row.after(box);
      });
      label.appendChild(btn);
    });
  });
}

// ---- Search ----
// Every control in every section, plus every Master Controls setting.
function menuSearchIndex() {
  const items = [];
  document.querySelectorAll('.panel-tab').forEach((tabEl) => {
    const tab = tabEl.dataset.tab;
    if (tab === 'controls') return; // Master is searched from its own rows below
    const tabName = (document.querySelector('.panel-tab-btn[data-tab="' + tab + '"]') || {}).textContent || tab;
    tabEl.querySelectorAll('.settings-section').forEach((section) => {
      const title = menuSectionKey(section);
      const desc = (section.querySelector('.settings-section-desc') || {}).textContent || '';
      items.push({ tab, tabName, title, label: '', text: (title + ' ' + desc).toLowerCase(), section, row: null });
      const help = OPTION_HELP[title] || {};
      section.querySelectorAll('.settings-section-body label').forEach((label) => {
        const text = labelText(label);
        const key = Object.keys(help).find((k) => text.startsWith(k));
        items.push({ tab, tabName, title, label: text.split(':')[0], text: (title + ' ' + text + ' ' + (key ? help[key] : '')).toLowerCase(), section, row: label.closest('.slider') || label.parentElement });
      });
    });
  });
  // The Now Playing bar's buttons, so "next audio" or "lock" finds them.
  [['Next audio track', 'next skip audio track song'], ['Lock 60s', 'lock hold freeze tiles'], ['Skip all', 'skip all tiles change now'],
    ['Performance mode', 'performance light full auto lag stutter'], ['Quick switches', 'auto-pilot pulse rhythm spiral quick switch']]
    .forEach(([label, words]) => items.push({ tab: null, tabName: '▶ Now Playing', title: 'Top of the menu', label, text: (label + ' ' + words).toLowerCase(), row: document.querySelector('.now-playing') }));
  if (typeof masterRows === 'function') {
    masterRows().forEach((r) => items.push({ tab: 'controls', tabName: '🔧 Master', title: r.group, label: r.label, text: (r.label + ' ' + r.group + ' ' + (r.key || '')).toLowerCase(), master: r.label }));
  }
  return items;
}

function menuSearch(query) {
  const box = document.getElementById('menu-search-results');
  if (!box) return;
  const q = query.trim().toLowerCase();
  if (q.length < 2) { box.innerHTML = ''; box.style.display = 'none'; return; }
  const words = q.split(/\s+/);
  const hits = menuSearchIndex().filter((it) => words.every((w) => it.text.includes(w)));
  // Menu controls first, then whole sections, then Master settings.
  hits.sort((a, b) => (a.master ? 2 : a.label ? 0 : 1) - (b.master ? 2 : b.label ? 0 : 1));
  box.style.display = 'block';
  box._hits = hits.slice(0, 30);
  box.innerHTML = box._hits.length
    ? box._hits.map((h, i) => '<div class="menu-search-hit" data-i="' + i + '"><span class="msh-where">' + masterEsc(h.tabName.trim()) + ' › ' + masterEsc(h.title) + '</span>' + (h.label ? '<span class="msh-label">' + masterEsc(h.label) + '</span>' : '') + '</div>').join('')
    : '<div class="menu-search-empty">Nothing matches "' + masterEsc(query) + '"</div>';
  box.querySelectorAll('.menu-search-hit').forEach((el) => el.addEventListener('click', () => openSearchHit(box._hits[+el.dataset.i])));
}

function openSearchHit(hit) {
  const input = document.getElementById('menu-search');
  if (input) input.value = '';
  menuSearch('');
  if (hit.tab) switchPanelTab(hit.tab);
  if (hit.master) {
    const ms = document.getElementById('master-search');
    if (ms) { ms.value = hit.master; buildMasterUi(); ms.scrollIntoView({ block: 'center' }); }
    return;
  }
  if (hit.section) hit.section.open = true;
  const target = hit.row || hit.section;
  setTimeout(() => {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('search-flash');
    setTimeout(() => target.classList.remove('search-flash'), 1800);
  }, 60);
}

// ---- Play time ----
// The engine adds up time this dashboard is visible and in use (any input
// within TUNING.PLAYTIME_IDLE_CAP_MS). Several dashboards at once count once.
const PLAYTIME_REPORT_MS = 30000;
let playtimeLastInput = Date.now();
let playtimeLastTick = Date.now();

['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach((type) => {
  addEventListener(type, () => { playtimeLastInput = Date.now(); }, { passive: true, capture: true });
});

function playtimeActiveSpan(now) {
  // Only the stretch since the last report that was within the idle cap.
  const activeUntil = Math.min(now, playtimeLastInput + TUNING.PLAYTIME_IDLE_CAP_MS);
  return activeUntil > playtimeLastTick ? [playtimeLastTick, activeUntil] : null;
}

function reportPlaytime(useBeacon) {
  const now = Date.now();
  const span = document.hidden && !useBeacon ? null : playtimeActiveSpan(now);
  playtimeLastTick = now;
  if (!span || span[1] - span[0] < 1000) return;
  const body = JSON.stringify({ from: span[0] / 1000, to: span[1] / 1000 });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon('/api/playtime', new Blob([body], { type: 'application/json' }));
  } else {
    fetch('/api/playtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
  }
}
setInterval(() => reportPlaytime(false), PLAYTIME_REPORT_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) reportPlaytime(true);
  else { playtimeLastTick = Date.now(); playtimeLastInput = Date.now(); }
});
addEventListener('pagehide', () => reportPlaytime(true));

function fmtMinutes(m) {
  if (m < 60) return Math.round(m) + 'm';
  const h = Math.floor(m / 60);
  return h + 'h ' + String(Math.round(m - h * 60)).padStart(2, '0') + 'm';
}

function loadPlaytime() {
  const totals = document.getElementById('playtime-totals');
  if (!totals) return;
  fetch('/api/playtime?days=35').then((r) => r.json()).then((d) => {
    totals.innerHTML = [['Today', d.today], ['This week', d.week], ['This month', d.month], ['All time', d.all]]
      .map(([k, v]) => '<div class="pt-total"><span>' + k + '</span><b>' + fmtMinutes(v) + '</b></div>').join('');
    const max = Math.max(30, ...d.days.map((x) => x.minutes));
    // Five weeks, Monday-first columns, oldest at the top.
    const first = new Date(d.days[0].day + 'T00:00:00');
    const pad = (first.getDay() + 6) % 7;
    const cells = [];
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((n) => cells.push('<span class="pt-head">' + n + '</span>'));
    for (let i = 0; i < pad; i++) cells.push('<span class="pt-day pt-blank"></span>');
    d.days.forEach((x, i) => {
      const level = x.minutes <= 0 ? 0 : Math.min(4, 1 + Math.floor((x.minutes / max) * 4));
      const date = new Date(x.day + 'T00:00:00');
      const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ': ' + (x.minutes ? fmtMinutes(x.minutes) : 'nothing');
      cells.push('<span class="pt-day pt-l' + level + (i === d.days.length - 1 ? ' pt-today' : '') + '" title="' + label + '">' + (x.minutes >= 1 ? fmtMinutes(x.minutes).replace(' ', '') : '') + '</span>');
    });
    document.getElementById('playtime-calendar').innerHTML = cells.join('');
    const streak = document.getElementById('playtime-streak');
    if (streak && typeof visitStreak !== 'undefined') {
      streak.innerHTML = '📅 Visit streak: <b>' + visitStreak.current + ' day' + (visitStreak.current === 1 ? '' : 's') + '</b> · best ' + visitStreak.best + ' · ' + d.days_played + ' days played in all';
    }
  }).catch(() => { totals.innerText = 'Play time unavailable'; });
}

// ---- Level & prestige ----
function renderPrestigeTracker() {
  const el = document.getElementById('prestige-tracker');
  if (!el || typeof xpForLevel !== 'function') return;
  const cap = TUNING.PRESTIGE_LEVEL_CAP;
  const floor = xpLevel > 1 ? xpForLevel(xpLevel - 1) : 0;
  const ceil = xpForLevel(xpLevel);
  const pct = Math.max(0, Math.min(100, ((xpTotal - floor) / (ceil - floor)) * 100));
  const bonus = Math.round((legacyBonusMultiplier() - 1) * 100);
  const bonusCap = Math.round(TUNING.LEGACY_BONUS_CAP * 100);
  const perStar = Math.round(TUNING.LEGACY_BONUS_PER_STAR * 100);
  const toCap = Math.max(0, xpForLevel(cap - 1) - xpTotal);
  el.innerHTML =
    '<div class="pr-row"><span class="pr-level">Level ' + xpLevel + '</span><span class="pr-stars">' + (prestigeCount ? '★'.repeat(Math.min(prestigeCount, 10)) + (prestigeCount > 10 ? ' ×' + prestigeCount : '') : 'No prestige yet') + '</span></div>' +
    '<div class="pr-bar"><div style="width:' + pct.toFixed(1) + '%"></div></div>' +
    '<div class="pr-sub">' + (xpTotal - floor) + ' / ' + (ceil - floor) + ' XP to level ' + (xpLevel + 1) + '</div>' +
    '<div class="pr-grid">' +
    '<div><span>XP bonus</span><b>+' + bonus + '%</b></div>' +
    '<div><span>Bonus cap</span><b>+' + bonusCap + '%</b></div>' +
    '<div><span>Prestige at</span><b>Level ' + cap + '</b></div>' +
    '<div><span>' + (xpLevel >= cap ? 'Ready' : 'XP to go') + '</span><b>' + (xpLevel >= cap ? '⭐ now' : toCap.toLocaleString()) + '</b></div>' +
    '</div>' +
    '<div class="pr-sub">Each prestige resets your level to 1 and adds a permanent +' + perStar + '% to all XP you earn (up to +' + bonusCap + '% in total). Both are adjustable in Master → Progress &amp; Prestige.</div>';
}

// ---- Wiring ----
function initMenu() {
  addOptionHelp();
  renderPrestigeTracker();
  loadPlaytime();
  setInterval(() => { if (!document.hidden && document.querySelector('.panel-tab.active[data-tab="home"]')) loadPlaytime(); }, 60000);
  document.addEventListener('click', (e) => {
    const box = document.getElementById('menu-search-results');
    if (box && !e.target.closest('.menu-search')) { box.innerHTML = ''; box.style.display = 'none'; }
  });
}
addEventListener('load', initMenu);
