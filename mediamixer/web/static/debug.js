// MediaMixer debug view - reads the event log written by dashboard_telemetry.js.
// Everything is derived client-side from the raw events, so new event kinds
// show up in the counts/feed automatically even before they get a chart.

const $ = (id) => document.getElementById(id);
const ZONE_COLORS = { chase: 'var(--z-chase)', color: 'var(--z-color)', jackpot: 'var(--z-jackpot)', vault: 'var(--z-vault)', rhythm: 'var(--z-rhythm)' };
// Effect lanes on the timeline, top to bottom.
const LANES = [
  ['barrage', 'Barrage', '#ffd23f'], ['buildup', 'Build-up', '#b08a2e'], ['spiral', 'Spiral', '#d36bff'], ['manualSpiral', 'Manual spiral', '#8f5bd6'],
  ['surge', 'Surge', '#ff8a3d'], ['spinSurge', 'Spin Surge', '#3de0ff'], ['colorRush', 'Color Rush', '#ff5fa2'],
  ['overdrive', 'Overdrive', '#ff6b6b'], ['spotlight', 'Spotlight', '#ffffff'], ['bonus', 'Bonus tap', '#ffe27a'],
  ['sealed', 'Locked tile', '#4fb3ff'], ['chase', 'Catch', '#5fd38d'], ['mystery', 'Mystery', '#9aa5ff'],
  ['finale', 'Finale', '#ff9df0'], ['floaterBarrage', 'Floater Barrage', '#b48cff'], ['slowmo', 'Slow-mo', '#8cbcff'], ['cascade', 'Cascade', '#5fe0d0'], ['moment', 'Moments', '#ff9f43'], ['doubleExposure', 'Double exposure', '#ffb3d9'], ['rhythm', 'Rhythm', '#7fe0a6'],
];
const OVERLAP_KEYS = ['barrage', 'buildup', 'spiral', 'surge', 'spinSurge', 'colorRush', 'overdrive', 'spotlight', 'finale', 'floaterBarrage', 'bonus', 'sealed', 'chase', 'mystery'];
const MARKERS = {
  'chase.catch': ['#5fd38d', 4], 'chase.miss': ['#ff6b6b', 4], 'bonus.claim': ['#ffe27a', 4],
  'sealed.open': ['#4fb3ff', 4], 'sealed.miss': ['#ff6b6b', 3], 'rate': ['#ff7ab6', 3], 'nearmiss.fake': ['#8a94a7', 3],
};

let events = [];
let lastId = 0;
let sessionId = '';
let live = true;

const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDur = (s) => (s < 90 ? Math.round(s) + 's' : s < 5400 ? (s / 60).toFixed(1) + 'm' : (s / 3600).toFixed(1) + 'h');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const windowS = () => parseFloat($('window').value);
const nowS = () => Date.now() / 1000;

async function loadSessions() {
  const r = await fetch('/api/events/sessions?hours=48').then((x) => x.json());
  const sel = $('session');
  const keep = sel.value;
  sel.innerHTML = r.sessions.map((s) =>
    `<option value="${s.session}">${s.session.slice(0, 8)} · last ${fmtTime(s.last_ts)} · ${s.n} events</option>`).join('');
  if (keep && r.sessions.some((s) => s.session === keep)) sel.value = keep;
  if (!r.sessions.length) sel.innerHTML = '<option value="">no sessions yet</option>';
  return sel.value;
}

async function fetchEvents(reset) {
  if (reset) { events = []; lastId = 0; }
  const since = nowS() - windowS();
  const q = new URLSearchParams({ after: lastId, limit: 20000 });
  if (sessionId) q.set('session', sessionId);
  if (reset) q.set('since', since);
  const r = await fetch('/api/events?' + q).then((x) => x.json());
  if (!sessionId && r.session) sessionId = r.session;
  if (r.events.length) {
    events = events.concat(r.events);
    lastId = r.events[r.events.length - 1].id;
  }
  events = events.filter((e) => e.t >= since - 600); // keep a little before the window so open intervals resolve
  $('status').textContent = `${events.length} events · updated ${fmtTime(nowS())}`;
  render();
}

// ---- derived data ----
function buildIntervals(evs, endT) {
  const open = {};
  const out = {};
  const push = (name, start, end, v) => (out[name] = out[name] || []).push({ start, end, v });
  for (const e of evs) {
    // A page load (or reload) resets everything the dashboard had running;
    // the watchers re-announce whatever is on again with fresh .start events.
    // Older logs have no page.load marker - their session.open came first.
    if (e.k === 'page.load' || (e.k === 'session.open' && !(e.d && e.d.tuning))) {
      for (const name in open) push(name, open[name].start, e.t, open[name].v);
      for (const name in open) delete open[name];
      continue;
    }
    const dot = e.k.lastIndexOf('.');
    const name = e.k.slice(0, dot);
    const phase = e.k.slice(dot + 1);
    if (phase === 'start') { if (open[name]) push(name, open[name].start, e.t, open[name].v); open[name] = { start: e.t, v: e.d && e.d.v }; }
    else if (phase === 'end') { if (open[name]) push(name, open[name].start, e.t, open[name].v); else if (e.d && e.d.ms) push(name, e.t - e.d.ms / 1000, e.t, e.d.v); delete open[name]; }
    else if (phase === 'change' && name !== 'zone.forced') {
      if (open[name]) push(name, open[name].start, e.t, open[name].v);
      else if (e.d && e.d.ms) push(name, e.t - e.d.ms / 1000, e.t, e.d.from);
      open[name] = { start: e.t, v: e.d && e.d.to };
    }
  }
  for (const name in open) push(name, open[name].start, endT, open[name].v, true);
  return out;
}

const count = (k, from) => events.filter((e) => e.k === k && e.t >= from).length;

// ---- render ----
function render() {
  const end = nowS();
  const start = end - windowS();
  const inWin = events.filter((e) => e.t >= start);
  if (!events.length) {
    $('main').querySelectorAll('section').forEach((s) => (s.style.display = 'none'));
    if (!$('empty')) $('main').insertAdjacentHTML('beforeend', '<div id="empty">No events yet. Open the dashboard and play for a bit - events arrive every few seconds.</div>');
    return;
  }
  $('main').querySelectorAll('section').forEach((s) => (s.style.display = ''));
  if ($('empty')) $('empty').remove();

  // A session that's gone quiet (dashboard closed) shouldn't show effects
  // as still running - close open intervals at its last event instead.
  const lastT = events[events.length - 1].t;
  const liveEnd = end - lastT > 20 ? lastT : end;
  const intervals = buildIntervals(events, liveEnd);
  renderNow(intervals, liveEnd);
  renderLoops(start);
  renderRewards(start, inWin, intervals, liveEnd);
  // Don't squash a short session into a sliver at the right edge.
  renderTimeline(Math.max(start, Math.min(end - 120, events[0].t - 5)), end, intervals, inWin);
  renderLikes(Math.max(start, events[0].t), liveEnd, intervals, inWin);
  renderZones(start, intervals);
  renderOverlaps(Math.max(start, events[0].t), liveEnd, intervals);
  renderCounts(inWin);
  renderFeed(inWin);
}

function renderNow(intervals, end) {
  const tick = [...events].reverse().find((e) => e.k === 'autopilot.tick');
  const lastEvent = events[events.length - 1];
  const stale = nowS() - lastEvent.t > 20;
  const rows = [['Last event', fmtTime(lastEvent.t) + (stale ? ' <span class="warn">(quiet - dashboard closed or idle?)</span>' : '')]];
  if (tick && !stale && end - tick.t < 15) {
    const d = tick.d;
    rows.push(
      ['Zone', `<b style="color:${ZONE_COLORS[d.zone] || 'inherit'}">${esc(d.zone || '-')}</b> · ${fmtDur(d.zoneAgeS)} in (natural length ~${fmtDur(d.cycleS)})`],
      ['State', esc(d.phrase || '—')],
      ['Engagement', `${d.engagement} <span class="muted">(trust ${d.trust}, step-off ${d.proximity})</span>`],
      ['Arc', `cycle ${d.cycle} · ${Math.round(d.frac * 100)}% through${d.fakeout ? ' · <span class="warn">fake-out</span>' : ''}${d.season ? ' · big season' : ''}${d.beat ? ' · retention ' + d.beat : ''}`],
      ['Odds', `barrage ${(d.barrageP * 100).toFixed(1)}% · jackpot ${(d.jackpotP * 100).toFixed(1)}%`],
      ['Discovery', `novelty bonus ${d.novelty} · ambient ×${d.ambient} · floaters ${d.fx} · pace ${d.pace}`],
      ['Boredom debt', `${d.debt} / 20 ticks`],
    );
  } else {
    rows.push(['Auto-Pilot', '<span class="muted">off (no recent ticks)</span>']);
  }
  $('now').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  const active = Object.entries(intervals)
    .filter(([, list]) => list.length && list[list.length - 1].end >= end - 0.01)
    .map(([name, list]) => { const iv = list[list.length - 1]; return `<span class="chip live">${esc(name)}${iv.v != null && iv.v !== 'on' ? ' · ' + esc(iv.v) : ''} · ${fmtDur(end - iv.start)}</span>`; });
  $('active').innerHTML = stale ? '<span class="muted">session idle</span>' : active.join('') || '<span class="muted">nothing running</span>';
}

function renderLoops(from) {
  const best = Math.max(0, ...events.filter((e) => e.k === 'chase.catch' && e.t >= from).map((e) => e.d.chain || 0));
  const rows = [
    // [label, appeared, hit, missed, note, isSkill (colour the hit rate)]
    ['Bonus tap', count('bonus.start', from), count('bonus.claim', from), null, '', true],
    ['Catch', count('chase.start', from), count('chase.catch', from), count('chase.miss', from), best ? 'best streak ' + best : '', true],
    ['Locked tile', count('sealed.start', from), count('sealed.open', from), count('sealed.miss', from), '', true],
    ['Push your luck', count('push.push', from) + count('push.bank', from), count('push.push', from), count('push.bank', from), 'hit = pushed, missed = banked', false],
    ['Mystery tile', count('mystery.start', from), null, null, '', false],
    ['Spin', count('spin', from), null, null, '', false],
  ];
  $('loops').innerHTML = '<tr><th></th><th class="num">appeared</th><th class="num">hit</th><th class="num">missed</th><th class="num">hit rate</th></tr>' +
    rows.map(([name, seen, hit, miss, note, skill]) => {
      const rate = hit != null && seen ? Math.round((hit / seen) * 100) : null;
      const cls = rate == null || !skill ? '' : rate < 25 ? 'bad' : rate > 90 ? 'warn' : 'good';
      return `<tr><td>${name}${note ? ' <span class="muted note">· ' + note + '</span>' : ''}</td><td class="num">${seen}</td><td class="num">${hit ?? '–'}</td><td class="num">${miss ?? '–'}</td><td class="num ${cls}">${rate == null ? '–' : rate + '%'}</td></tr>`;
    }).join('');
}

function renderRewards(from, inWin, intervals, end) {
  const hours = Math.max(1 / 60, (end - Math.max(from, inWin.length ? inWin[0].t : from)) / 3600);
  const xp = inWin.filter((e) => e.k === 'xp').reduce((s, e) => s + (e.d.amount || 0), 0);
  const payoffs = inWin.filter((e) => e.k === 'payoff');
  const byTier = {};
  payoffs.forEach((e) => (byTier[e.d.tier] = (byTier[e.d.tier] || 0) + 1));
  const shakes = payoffs.filter((e) => e.d.shake);
  // One per barrage.start - a tier change mid-barrage splits its interval.
  const barrages = inWin.filter((e) => e.k === 'barrage.start');
  // Each barrage counted once, by the tier it ended on (the tier label can
  // arrive or change after it starts).
  const barrageTiers = {};
  let curTier = null;
  inWin.forEach((e) => {
    if (e.k === 'barrage.start') curTier = e.d.v;
    else if (e.k === 'barrage.change') curTier = e.d.to;
    else if (e.k === 'barrage.end' && curTier != null) {
      const tier = curTier === 'on' ? 'untiered' : curTier;
      barrageTiers[tier] = (barrageTiers[tier] || 0) + 1;
      curTier = null;
    }
  });
  const barrageTime = (intervals.barrage || []).reduce((s, iv) => s + Math.max(0, iv.end - Math.max(iv.start, from)), 0);
  // Gaps between "something good happened to me" moments - the variable-ratio
  // schedule as actually experienced. CV near 0 = predictable, ~1 = random.
  const rewardTimes = inWin.filter((e) => ['bonus.claim', 'chase.catch', 'sealed.open', 'payoff', 'payoff.mini'].includes(e.k)).map((e) => e.t);
  const gaps = rewardTimes.slice(1).map((t, i) => t - rewardTimes[i]);
  const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const cv = gaps.length > 2 ? Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length) / mean : null;
  const spirals = (intervals.spiral || []).filter((iv) => iv.end >= from);
  const fmtMap = (m) => Object.entries(m).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || '0';
  const rows = [
    ['XP earned', `${xp} <span class="muted">(${Math.round(xp / hours)}/h)</span>`],
    ['Jackpot payoffs', `${payoffs.length} <span class="muted">(${fmtMap(byTier)})</span>`],
    ['Screen shakes', `${shakes.length}${shakes.length ? ' <span class="muted">· from ' + fmtMap(shakes.reduce((m, e) => ((m[e.d.tier] = (m[e.d.tier] || 0) + 1), m), {})) + ' payoffs · last ' + fmtTime(shakes[shakes.length - 1].t) + '</span>' : ''}`],
    ['Barrages', `${barrages.length} <span class="muted">(${fmtMap(barrageTiers)}) · on screen ${Math.round((barrageTime / Math.max(1, hours * 3600)) * 100)}% of the time</span>`],
    ['Build-ups', `${count('buildup.real', from)} real · ${count('buildup.fake', from)} fake · ${count('nearmiss.fake', from)} near-miss`],
    ['Spirals', `${spirals.length}${spirals.length ? ' <span class="muted">· avg ' + fmtDur(spirals.reduce((s, iv) => s + iv.end - iv.start, 0) / spirals.length) + '</span>' : ''}`],
    ['Reward rhythm', gaps.length ? `one every ${fmtDur(mean)}${cv != null ? ' <span class="muted">· variability ' + cv.toFixed(2) + (cv < 0.5 ? ' (predictable)' : cv > 1.2 ? ' (very streaky)' : ' (nicely variable)') + '</span>' : ''}` : '<span class="muted">not enough yet</span>'],
    ['Ratings', `${inWin.filter((e) => e.k === 'rate' && e.d.dir === 'up').length} up · ${inWin.filter((e) => e.k === 'rate' && e.d.dir !== 'up').length} down · ${count('skip', from)} skips`],
    ['Layout changes', `${(intervals.layout || []).filter((iv) => iv.start >= from).length}`],
  ];
  $('rewards').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
}

function renderTimeline(start, end, intervals, inWin) {
  const svg = $('timeline');
  const W = svg.clientWidth || 900;
  const L = 86, R = 8;
  const x = (t) => L + ((t - start) / (end - start)) * (W - L - R);
  const laneH = 11, gap = 3;
  const zoneY = 4, chartY = 34, chartH = 80;
  const lanes = LANES.filter(([k]) => (intervals[k] || []).some((iv) => iv.end >= start));
  const lanesY = chartY + chartH + 14;
  const markY = lanesY + lanes.length * (laneH + gap) + 6;
  const H = markY + 24;
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let out = '';

  // time grid
  const step = [60, 300, 600, 900, 1800, 3600, 7200].find((s) => (end - start) / s <= 8) || 7200;
  for (let t = Math.ceil(start / step) * step; t < end; t += step) {
    out += `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 14}" stroke="#262c38"/><text x="${x(t) + 3}" y="${H - 2}">${fmtTime(t).slice(0, 5)}</text>`;
  }
  // zone band
  out += `<text x="0" y="${zoneY + 13}">Zone</text>`;
  for (const iv of intervals.zone || []) {
    if (iv.end < start) continue;
    const x1 = x(Math.max(iv.start, start)), x2 = x(iv.end);
    out += `<rect x="${x1}" y="${zoneY}" width="${Math.max(1, x2 - x1)}" height="20" rx="3" fill="${ZONE_COLORS[iv.v] || '#555'}" opacity=".8"><title>${esc(iv.v)} · ${fmtDur(iv.end - iv.start)}</title></rect>`;
    if (x2 - x1 > 46) out += `<text x="${x1 + 4}" y="${zoneY + 14}" style="fill:#111;font-weight:600">${esc(iv.v)}</text>`;
  }
  // engagement + odds chart
  out += `<text x="0" y="${chartY + 12}">Engagement</text><text x="0" y="${chartY + 26}" style="fill:#ffd23f">Odds</text>`;
  out += `<rect x="${L}" y="${chartY}" width="${W - L - R}" height="${chartH}" fill="none" stroke="#262c38"/>`;
  const ticks = inWin.filter((e) => e.k === 'autopilot.tick');
  const line = (vals, color, lo, hi) => {
    const pts = ticks.map((e) => `${x(e.t).toFixed(1)},${(chartY + chartH - ((vals(e.d) - lo) / (hi - lo)) * chartH).toFixed(1)}`).join(' ');
    return pts ? `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>` : '';
  };
  const neutral = chartY + chartH - ((1 - 0.2) / 2) * chartH;
  out += `<line x1="${L}" x2="${W - R}" y1="${neutral}" y2="${neutral}" stroke="#3a4253" stroke-dasharray="3 3"/>`;
  out += line((d) => d.engagement, '#7aa2ff', 0.2, 2.2);
  out += line((d) => Math.min(0.6, d.barrageP + d.jackpotP), '#ffd23f', 0, 0.6);
  if (!ticks.length) out += `<text x="${L + 8}" y="${chartY + chartH / 2}">Auto-Pilot off - no engagement/odds samples in this window</text>`;
  // effect lanes
  lanes.forEach(([k, label, color], i) => {
    const y = lanesY + i * (laneH + gap);
    out += `<text x="0" y="${y + 9}">${label}</text>`;
    for (const iv of intervals[k]) {
      if (iv.end < start) continue;
      const x1 = x(Math.max(iv.start, start)), x2 = x(iv.end);
      out += `<rect x="${x1}" y="${y}" width="${Math.max(2, x2 - x1)}" height="${laneH}" rx="2" fill="${color}" opacity=".75"><title>${label}${iv.v != null && iv.v !== 'on' ? ' (' + esc(iv.v) + ')' : ''} · ${fmtTime(iv.start)} · ${fmtDur(iv.end - iv.start)}</title></rect>`;
    }
  });
  // point markers
  out += `<text x="0" y="${markY + 9}">Moments</text>`;
  for (const e of inWin) {
    if (e.k === 'payoff') {
      out += `<circle cx="${x(e.t)}" cy="${markY + 5}" r="${e.d.shake ? 7 : 5}" fill="${e.d.shake ? '#ff6b6b' : '#ffd23f'}"><title>${esc(e.d.tier)} payoff${e.d.shake ? ' (screen shake)' : ''} · ${fmtTime(e.t)}</title></circle>`;
    } else if (MARKERS[e.k]) {
      const [c, r] = MARKERS[e.k];
      out += `<circle cx="${x(e.t)}" cy="${markY + 5}" r="${r}" fill="${c}" opacity=".85"><title>${e.k} · ${fmtTime(e.t)}</title></circle>`;
    }
  }
  svg.innerHTML = out;
  $('legend').innerHTML = Object.entries(ZONE_COLORS).map(([z, c]) => `<span><i style="background:${c}"></i>${z}</span>`).join('') +
    '<span><i style="background:#7aa2ff"></i>engagement (dashed = neutral)</span><span><i style="background:#ffd23f"></i>barrage+jackpot odds</span>' +
    '<span><i style="background:#ff6b6b;border-radius:50%"></i>shake payoff</span><span><i style="background:#5fd38d;border-radius:50%"></i>catch</span>';
}

// Older fx.tile events (before durations were logged) fall back to these.
const FX_DEFAULT_MS = { prism: 8000, bloom: 7000, duotone: 7500, leak: 8500, kaleido: 6500, zoom: 9000, rgb: 8000, vhs: 7500 };
const LIKE_STATE_LABELS = {
  barrage: 'Barrage / jackpot hype', spiral: 'Spiral', surge: 'Surge', spinSurge: 'Spin Surge', colorRush: 'Color Rush',
  overdrive: 'Overdrive', hiddenMult: 'Hidden multiplier', rhythm: 'Rhythm mode', finale: 'Finale', floaterBarrage: 'Floater Barrage', manualSpiral: 'Manual spiral',
};
const tilesForLayout = (name) => { if (name === 'dual') return 2; const m = /grid(\d+)x(\d+)/.exec(name || ''); return m ? +m[1] * +m[2] : 2; };

function renderLikes(start, end, intervals, inWin) {
  const ratings = inWin.filter((e) => e.k === 'rate' && e.d && 'fx' in e.d); // ones logged with context
  if (!ratings.length) { $('likes').innerHTML = '<tr><td class="muted">No ratings with context yet - rate a few tiles (this needs the dashboard to be reloaded once after the update).</td></tr>'; return; }
  const clip = (a, b) => Math.max(0, Math.min(b, end) - Math.max(a, start));
  // Tile-seconds on screen, from layout intervals (tile count can change).
  const layouts = (intervals.layout || []).filter((iv) => iv.end > start);
  const tilesAt = (t) => { const iv = layouts.find((x) => x.start <= t && t <= x.end); return iv ? tilesForLayout(iv.v) : (ratings[0].d.tiles || 2); };
  const totalTileS = layouts.length ? layouts.reduce((s, iv) => s + clip(iv.start, iv.end) * tilesForLayout(iv.v), 0) : (end - start) * tilesAt(start);
  const likes = ratings.filter((e) => e.d.dir === 'up');
  const dislikes = ratings.filter((e) => e.d.dir !== 'up');
  const perMin = (n, tileS) => (tileS > 0 ? n / (tileS / 60) : 0);
  const rows = [];
  const row = (label, exposureS, inLikes, inDislikes, outLikes, outS, group) => {
    const rIn = perMin(inLikes, exposureS), rOut = perMin(outLikes, outS);
    rows.push({ label, exposureS, inLikes, inDislikes, rIn, lift: rOut > 0 ? rIn / rOut : null, group });
  };

  // Tile FX: exposure is per tile, from each effect's own run.
  const fxEvents = inWin.filter((e) => e.k === 'fx.tile' && e.d.kind !== 'shock');
  const fxExposure = {};
  fxEvents.forEach((e) => { const k = e.d.kind; fxExposure[k] = (fxExposure[k] || 0) + Math.min(e.d.ms || FX_DEFAULT_MS[k] || 7000, (end - e.t) * 1000) / 1000; });
  const fxTotal = Object.values(fxExposure).reduce((a, b) => a + b, 0);
  const noFxLikes = likes.filter((e) => !e.d.fx).length;
  row('No tile effect', totalTileS - fxTotal, noFxLikes, dislikes.filter((e) => !e.d.fx).length, likes.length - noFxLikes, fxTotal, 'Tile effects');
  Object.keys(fxExposure).sort().forEach((k) => {
    const n = likes.filter((e) => e.d.fx === k).length;
    row(k[0].toUpperCase() + k.slice(1), fxExposure[k], n, dislikes.filter((e) => e.d.fx === k).length, likes.length - n, totalTileS - fxExposure[k], 'Tile effects');
  });

  // Whole-screen states: exposure = time on x tiles showing at the time.
  Object.keys(LIKE_STATE_LABELS).forEach((s) => {
    const exp = (intervals[s] || []).reduce((sum, iv) => sum + clip(iv.start, iv.end) * tilesAt(iv.start), 0);
    if (exp <= 0) return;
    const n = likes.filter((e) => e.d.states.includes(s)).length;
    row(LIKE_STATE_LABELS[s], exp, n, dislikes.filter((e) => e.d.states.includes(s)).length, likes.length - n, totalTileS - exp, 'On screen');
  });

  // Zones.
  const zoneExp = {};
  (intervals.zone || []).forEach((iv) => { zoneExp[iv.v] = (zoneExp[iv.v] || 0) + clip(iv.start, iv.end) * tilesAt(iv.start); });
  Object.keys(zoneExp).forEach((z) => {
    if (zoneExp[z] <= 0) return;
    const n = likes.filter((e) => e.d.zone === z).length;
    row(z[0].toUpperCase() + z.slice(1) + ' zone', zoneExp[z], n, dislikes.filter((e) => e.d.zone === z).length, likes.length - n, totalTileS - zoneExp[z], 'Auto-Pilot zone');
  });

  // Rhythm beat patterns, from the rhythmPattern watcher's intervals.
  const patExp = {};
  (intervals.rhythmPattern || []).forEach((iv) => { if (iv.v) patExp[iv.v] = (patExp[iv.v] || 0) + clip(iv.start, iv.end) * tilesAt(iv.start); });
  Object.keys(patExp).sort().forEach((p) => {
    if (patExp[p] <= 0) return;
    const n = likes.filter((e) => e.d.rhythmPattern === p).length;
    row(p[0].toUpperCase() + p.slice(1), patExp[p], n, dislikes.filter((e) => e.d.rhythmPattern === p).length, likes.length - n, totalTileS - patExp[p], 'Rhythm beat pattern');
  });

  // Speed has no exposure record, so just show where likes landed.
  const band = (e) => (e.d.speed == null ? null : e.d.speed < 0.95 ? 'slowed' : e.d.speed > 1.05 ? 'sped up' : 'normal');
  const speedCounts = {};
  ratings.forEach((e) => { const b = band(e); if (!b) return; speedCounts[b] = speedCounts[b] || { up: 0, down: 0 }; speedCounts[b][e.d.dir === 'up' ? 'up' : 'down']++; });
  const special = [
    ['Spotlighted tile', likes.filter((e) => e.d.states.includes('spotlightTile')).length, dislikes.filter((e) => e.d.states.includes('spotlightTile')).length],
    ['Highlighted barrage tile', likes.filter((e) => e.d.states.includes('barrageTile')).length, dislikes.filter((e) => e.d.states.includes('barrageTile')).length],
    ['Tile in slow-mo', likes.filter((e) => e.d.states.includes('slowmoTile')).length, dislikes.filter((e) => e.d.states.includes('slowmoTile')).length],
    ['Tile in double exposure', likes.filter((e) => e.d.states.includes('doubleExposureTile')).length, dislikes.filter((e) => e.d.states.includes('doubleExposureTile')).length],
  ];

  let group = '';
  let html = '<tr><th></th><th class="num">on screen (tile-min)</th><th class="num">likes</th><th class="num">dislikes</th><th class="num">likes / tile-min</th><th class="num">vs rest of the time</th></tr>';
  for (const r of rows) {
    if (r.group !== group) { group = r.group; html += `<tr><td colspan="6" class="muted" style="padding-top:10px">${group}</td></tr>`; }
    const thin = r.inLikes < 5;
    const liftTxt = r.lift == null ? '–' : '×' + r.lift.toFixed(2);
    const cls = thin || r.lift == null ? '' : r.lift >= 1.25 ? 'good' : r.lift <= 0.8 ? 'bad' : '';
    html += `<tr style="${thin ? 'opacity:.45' : ''}"><td>${esc(r.label)}</td><td class="num">${(r.exposureS / 60).toFixed(1)}</td><td class="num">${r.inLikes}</td><td class="num">${r.inDislikes}</td><td class="num">${r.rIn.toFixed(2)}</td><td class="num ${cls}">${liftTxt}</td></tr>`;
  }
  html += '<tr><td colspan="6" class="muted" style="padding-top:10px">Where likes landed</td></tr>';
  for (const [label, up, down] of special) html += `<tr><td>${label}</td><td class="num muted">–</td><td class="num">${up}</td><td class="num">${down}</td><td></td><td></td></tr>`;
  for (const b of ['slowed', 'normal', 'sped up']) if (speedCounts[b]) html += `<tr><td>Tile ${b}</td><td class="num muted">–</td><td class="num">${speedCounts[b].up}</td><td class="num">${speedCounts[b].down}</td><td></td><td></td></tr>`;
  $('likes').innerHTML = html;
}

function renderZones(from, intervals) {
  const decisions = events.filter((e) => e.k === 'zone.decision' || e.k === 'zone.forced');
  const ticks = events.filter((e) => e.k === 'autopilot.tick');
  const runs = (intervals.zone || []).filter((iv) => iv.end >= from).reverse();
  if (!runs.length) { $('zones').innerHTML = '<tr><td class="muted">No Auto-Pilot zones in this window.</td></tr>'; return; }
  const end = nowS();
  $('zones').innerHTML = '<tr><th>zone</th><th>started</th><th class="num">length</th><th class="num">avg eng.</th><th>state flips</th><th>ended because</th></tr>' +
    runs.map((iv) => {
      const why = decisions.find((d) => Math.abs(d.t - iv.end) < 6);
      const reason = iv.end >= end - 0.01 && end - events[events.length - 1].t < 20 ? '<span class="good">running</span>'
        : !why ? '<span class="muted">auto-pilot stopped</span>'
        : why.k === 'zone.forced' ? 'Switch It Up / Spin'
        : why.d.reason === 'natural' ? `ran its course <span class="muted">(eng ${why.d.engagement} < stay bar ${why.d.stayThreshold})</span>`
        : why.d.reason === 'ceiling' ? `<span class="warn">hit hard ceiling</span> <span class="muted">(${fmtDur(why.d.ageS)})</span>`
        : `<span class="bad">engagement dropped</span> <span class="muted">(${why.d.engagement})</span>`;
      const zt = ticks.filter((e) => e.t >= iv.start && e.t <= iv.end);
      const avg = zt.length ? (zt.reduce((s, e) => s + e.d.engagement, 0) / zt.length).toFixed(2) : '–';
      let flips = 0;
      for (let i = 1; i < zt.length; i++) if (zt[i].d.phrase !== zt[i - 1].d.phrase) flips++;
      const perMin = zt.length > 1 ? flips / Math.max(1, (iv.end - iv.start) / 60) : 0;
      return `<tr><td style="color:${ZONE_COLORS[iv.v] || 'inherit'}">${esc(iv.v)}</td><td>${fmtTime(iv.start)}</td><td class="num">${fmtDur(iv.end - iv.start)}</td><td class="num">${avg}</td><td class="${perMin > 2 ? 'warn' : 'muted'}">${flips}${perMin > 2 ? ' (hunting)' : ''}</td><td>${reason}</td></tr>`;
    }).join('');
}

function renderOverlaps(start, end, intervals) {
  // Sweep line over every effect interval to find how much was stacked at once.
  const pts = [];
  for (const k of OVERLAP_KEYS) for (const iv of intervals[k] || []) {
    if (iv.end < start) continue;
    pts.push([Math.max(iv.start, start), 1], [iv.end, -1]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let level = 0, prevT = start, maxLevel = 0;
  const timeAt = {};
  for (const [t, delta] of pts) {
    timeAt[level] = (timeAt[level] || 0) + (t - prevT);
    level += delta; prevT = t; maxLevel = Math.max(maxLevel, level);
  }
  const total = Math.max(1, end - start);
  const busy = Object.entries(timeAt).filter(([l]) => l >= 3).reduce((s, [, v]) => s + v, 0);
  $('overlapSummary').innerHTML = [
    ['Most at once', maxLevel],
    ['Time with 3+ running', `${fmtDur(busy)} <span class="muted">(${Math.round((busy / total) * 100)}% of play time)</span>`],
    ['Time with nothing', `${fmtDur(timeAt[0] || 0)} <span class="muted">(${Math.round(((timeAt[0] || 0) / total) * 100)}%)</span>`],
  ].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  // Which things start while another is already running - candidates for
  // "these step on each other".
  const pairs = {};
  for (const a of OVERLAP_KEYS) for (const ia of intervals[a] || []) {
    if (ia.start < start) continue;
    for (const b of OVERLAP_KEYS) {
      if (a === b) continue;
      if ((intervals[b] || []).some((ib) => ib.start < ia.start && ib.end > ia.start)) {
        const key = a + ' during ' + b;
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
  }
  const top = Object.entries(pairs).sort((p, q) => q[1] - p[1]).slice(0, 8);
  $('overlaps').innerHTML = top.length
    ? '<tr><th>started…</th><th class="num">times</th></tr>' + top.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`).join('')
    : '<tr><td class="muted">No overlapping starts in this window.</td></tr>';
}

function renderCounts(inWin) {
  const c = {};
  inWin.forEach((e) => (c[e.k] = (c[e.k] || 0) + 1));
  const hours = Math.max(1 / 60, windowS() / 3600);
  $('counts').innerHTML = '<tr><th>event</th><th class="num">count</th><th class="num">per hour</th></tr>' +
    Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td><td class="num">${(n / hours).toFixed(1)}</td></tr>`).join('');
}

function renderFeed(inWin) {
  const f = $('filter').value.trim().toLowerCase();
  const rows = inWin.filter((e) => e.k !== 'autopilot.tick' || f.includes('tick'))
    .filter((e) => !f || e.k.toLowerCase().includes(f) || JSON.stringify(e.d || '').toLowerCase().includes(f))
    .slice(-300).reverse();
  $('feed').innerHTML = rows.map((e) => `<tr><td>${fmtTime(e.t)}</td><td>${esc(e.k)}</td><td class="muted" style="white-space:normal">${e.d ? esc(JSON.stringify(e.d)) : ''}</td></tr>`).join('');
}

function loadDnaTaste() {
  fetch('/api/dna/taste').then((r) => r.json()).then((d) => {
    const el = $('dnaTaste');
    if (!d.ready) { el.innerHTML = '<tr><td class="muted">Clip DNA is still analysing the library.</td></tr>'; return; }
    el.innerHTML = '<tr><th></th><th class="num">low third</th><th class="num">middle</th><th class="num">high third</th></tr>' +
      Object.entries(d.traits).map(([trait, t]) => '<tr><td>' + trait + '</td>' + t.lifts.map((x, k) => {
        const cls = x >= 1.2 ? 'good' : x <= 0.83 ? 'bad' : '';
        return '<td class="num ' + cls + '">' + t.labels[k] + ' ×' + x.toFixed(2) + '</td>';
      }).join('') + '</tr>').join('');
  }).catch(() => {});
}

// ---- wiring ----
$('session').addEventListener('change', () => { sessionId = $('session').value; fetchEvents(true); });
$('window').addEventListener('change', () => fetchEvents(true));
$('filter').addEventListener('input', render);
$('live').addEventListener('click', () => { live = !live; $('live').classList.toggle('on', live); $('live').textContent = live ? '● Live' : '○ Paused'; });
addEventListener('resize', render);

(async () => {
  loadDnaTaste();
  sessionId = await loadSessions();
  await fetchEvents(true);
  setInterval(() => { if (live) fetchEvents(false); }, 3000);
  setInterval(() => { if (live) loadSessions(); }, 30000);
})();
