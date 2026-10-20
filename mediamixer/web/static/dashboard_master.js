// Part of the dashboard client - classic scripts sharing one global scope,
// loaded in the order listed in dashboard.html.
// Master Controls: every tunable (this device's TUNING sliders and the
// engine's shared settings) in one searchable list, grouped like the menu
// tabs, with changed markers, per-setting reset and a "lock it in" export.

const MASTER_AREAS = ['Screen', 'Flow', 'Rewards', 'Sound'];
// TUNING_GROUPS label -> menu area.
const MASTER_AREA_OF_GROUP = {
  'Spiral': 'Screen', 'Layout Fade / Dynamic Mosaic': 'Screen', 'Clip Transitions': 'Screen', 'Spotlight Takeover': 'Screen',
  'Floater Barrage': 'Screen', 'Custom Loop Point': 'Screen', 'Living Screen': 'Screen',
  'Auto-Pilot': 'Flow', 'Rhythm & Pulse': 'Flow', 'Taste Learning': 'Flow', 'Surges': 'Flow', 'Fresh Drops': 'Flow',
  'Audio-Reactive': 'Sound',
};
// Engine field group -> menu area (everything else lands in Rewards).
const MASTER_AREA_OF_ENGINE_GROUP = { 'Tension Curve': 'Screen', 'Selection (Bandit)': 'Flow' };
let masterFilter = 'all';
const masterOpenGroups = new Set(); // keeps groups open across rebuilds

function masterAreaOf(groupLabel) { return MASTER_AREA_OF_GROUP[groupLabel] || 'Rewards'; }
function tuningChanged(key) { return TUNING[key] !== TUNING_DEFAULTS[key]; }
function engineChanged(f) { return f.value !== f.default; }
function masterEsc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Every row as plain data: {kind, key, label, group, area, changed}.
function masterRows() {
  const rows = [];
  TUNING_GROUPS.forEach((g) => g.keys.forEach((key) => {
    if (!TUNING_META[key]) return;
    rows.push({ kind: 'tuning', key, label: TUNING_META[key].label, group: g.label, groupDesc: g.desc, area: masterAreaOf(g.label), changed: tuningChanged(key) });
  }));
  Object.keys(engineConfigFields).forEach((name) => {
    const f = engineConfigFields[name];
    rows.push({ kind: 'engine', key: name, label: f.label, group: '🖧 ' + f.group, groupDesc: 'Engine setting - shared by every device, kept across restarts.', area: MASTER_AREA_OF_ENGINE_GROUP[f.group] || 'Rewards', changed: engineChanged(f) });
  });
  return rows;
}

function setMasterFilter(f) {
  masterFilter = f;
  buildMasterUi();
}

function masterMatches(row, q) {
  if (masterFilter === 'changed' && !row.changed) return false;
  if (!q) return true;
  const hay = (row.label + ' ' + row.group + ' ' + row.area + ' ' + row.key).toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function masterRowHtml(row) {
  const reset = row.changed ? '<button class="master-reset" title="Back to default" onclick="masterReset(\'' + row.kind + '\',\'' + row.key + '\')">↺</button>' : '';
  const dot = row.changed ? '<span class="master-dot" title="Changed from default">●</span>' : '';
  if (row.kind === 'tuning') {
    const meta = TUNING_META[row.key];
    return '<div class="slider master-row' + (row.changed ? ' changed' : '') + '"><label>' + dot + masterEsc(meta.label)
      + ': <b><span id="tune-val-' + row.key + '">' + formatTuningValue(row.key, TUNING[row.key]) + '</span></b>'
      + '<span class="master-default">default ' + formatTuningValue(row.key, TUNING_DEFAULTS[row.key]) + '</span>' + reset + '</label>'
      + '<input type="range" id="tune-input-' + row.key + '" data-tune="' + row.key + '" min="' + meta.min + '" max="' + meta.max + '" step="' + meta.step + '" value="' + TUNING[row.key] + '"></div>';
  }
  const f = engineConfigFields[row.key];
  return '<div class="slider master-row' + (row.changed ? ' changed' : '') + '"><label>' + dot + masterEsc(f.label)
    + ': <b><span id="engine-val-' + row.key + '">' + formatEngineValue(f) + '</span></b>'
    + '<span class="master-default">default ' + f.default + '</span><span class="master-shared">🖧 shared</span>' + reset + '</label>'
    + '<input type="range" data-engine="' + row.key + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + f.value + '"></div>';
}

function buildMasterUi() {
  const container = document.getElementById('master-groups');
  if (!container) return;
  const search = document.getElementById('master-search');
  const q = (search ? search.value : '').trim().toLowerCase();
  const all = masterRows();
  const rows = all.filter((r) => masterMatches(r, q));
  let html = '';
  MASTER_AREAS.forEach((area) => {
    const inArea = rows.filter((r) => r.area === area);
    if (!inArea.length) return;
    html += '<div class="master-area">' + area + '</div>';
    const groups = [...new Set(inArea.map((r) => r.group))];
    groups.forEach((g) => {
      const gRows = inArea.filter((r) => r.group === g);
      const changed = gRows.filter((r) => r.changed).length;
      // Open while searching/filtering, or if the viewer opened it.
      const open = q || masterFilter === 'changed' || masterOpenGroups.has(g) ? ' open' : '';
      html += '<details class="settings-section master-group"' + open + ' data-group="' + masterEsc(g) + '"><summary><span class="section-title">' + masterEsc(g) + '</span>'
        + '<span class="section-live">' + gRows.length + ' setting' + (gRows.length === 1 ? '' : 's') + (changed ? ' · ' + changed + ' changed' : '') + '</span>'
        + '<span class="settings-section-desc">' + masterEsc(gRows[0].groupDesc || '') + '</span></summary><div class="settings-section-body">'
        + gRows.map(masterRowHtml).join('') + '</div></details>';
    });
  });
  container.innerHTML = html || '<div class="metric">Nothing matches' + (masterFilter === 'changed' ? ' among your changed settings' : '') + '.</div>';
  const changedCount = all.filter((r) => r.changed).length;
  const count = document.getElementById('master-count');
  if (count) count.innerText = rows.length + ' of ' + all.length + ' settings shown · ' + changedCount + ' changed from default';
  ['all', 'changed'].forEach((f) => { const b = document.getElementById('master-filter-' + f); if (b) b.classList.toggle('active', masterFilter === f); });

  container.querySelectorAll('details.master-group').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) masterOpenGroups.add(d.dataset.group); else masterOpenGroups.delete(d.dataset.group);
  }));
  container.querySelectorAll('input[data-tune]').forEach((input) => {
    const key = input.dataset.tune;
    input.addEventListener('input', () => setTuning(key, parseFloat(input.value)));
    input.addEventListener('change', () => buildMasterUi()); // refresh changed markers once the drag ends
  });
  container.querySelectorAll('input[data-engine]').forEach((input) => {
    const name = input.dataset.engine;
    const val = document.getElementById('engine-val-' + name);
    input.addEventListener('input', () => { if (val) val.innerText = input.value; });
    input.addEventListener('change', () => setEngineConfig(name, input.value));
  });
}

function masterReset(kind, key) {
  if (kind === 'tuning') { setTuning(key, TUNING_DEFAULTS[key]); buildMasterUi(); }
  else setEngineConfig(key, engineConfigFields[key].default);
}

// Everything changed from the shipped defaults, ready to paste back so the
// values that feel right can become the new defaults.
function lockItIn() {
  const t = Object.keys(TUNING_DEFAULTS).filter(tuningChanged);
  const e = Object.keys(engineConfigFields).filter((n) => engineChanged(engineConfigFields[n]));
  const lines = ['MediaMixer settings changed from defaults (' + new Date().toLocaleString() + '):'];
  if (t.length) {
    lines.push('', 'Dashboard (this device):');
    t.forEach((k) => lines.push('  ' + k + ': ' + TUNING[k] + '   (default ' + TUNING_DEFAULTS[k] + ' · ' + (TUNING_META[k] ? TUNING_META[k].label : k) + ')'));
  }
  if (e.length) {
    lines.push('', 'Engine (shared):');
    e.forEach((n) => lines.push('  ' + n + ' = ' + engineConfigFields[n].value + '   (default ' + engineConfigFields[n].default + ' · ' + engineConfigFields[n].label + ')'));
  }
  if (!t.length && !e.length) lines.push('', 'Everything is at its default.');
  const text = lines.join('\n');
  const out = document.getElementById('master-lockin');
  if (out) { out.value = text; out.style.display = 'block'; out.rows = Math.min(16, lines.length + 1); }
  const n = t.length + e.length;
  const copied = () => toast('📋 ' + n + ' changed setting' + (n === 1 ? '' : 's') + ' copied - paste them to Claude to lock in');
  const manual = () => { if (out) out.select(); toast('📋 Copy the text below and paste it to Claude', true); };
  try { navigator.clipboard.writeText(text).then(copied, manual); } catch (err) { manual(); }
}
