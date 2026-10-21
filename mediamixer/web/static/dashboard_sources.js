// 📁 Sources (menu: More): which folders each kind of media comes from.
// The engine scans every folder recursively; this just edits the list per
// kind via /api/sources/set and browses the PC's folders via
// /api/sources/browse (folder names only - the browser can't hand over a
// real path itself).

let sourcesData = null;
let sourcesBrowseKind = null;
const SOURCE_KIND_ORDER = ['tiles', 'spirals', 'overlay', 'audio'];

function sourcesEsc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadSources() {
  return fetch('/api/sources').then((r) => r.json()).then((d) => {
    sourcesData = d;
    renderSources();
  }).catch(() => {
    const el = document.getElementById('sources-prep');
    if (el) el.innerText = 'Could not reach the engine.';
  });
}

function renderSourcesPrep(prep) {
  const el = document.getElementById('sources-prep');
  if (!el || !prep) return;
  const pct = (a, b) => (b ? Math.floor((a / b) * 100) : 100) + '%';
  el.innerHTML = '🎞️ Proxies ' + prep.proxied + ' / ' + prep.videos + ' (' + pct(prep.proxied, prep.videos) + ')'
    + ' · 🧬 DNA ' + prep.dna_done + ' / ' + prep.dna_total + ' (' + pct(prep.dna_done, prep.dna_total) + ')'
    + (prep.proxy_running ? ' · building proxies' : '')
    + (prep.dna_running ? ' · analysing now' : '')
    + '<br><span style="opacity:.7">Proxy folder: ' + sourcesEsc(sourcesData.proxy_dir) + '</span>';
}

function renderSources() {
  const list = document.getElementById('sources-list');
  if (!list || !sourcesData) return;
  renderSourcesPrep(sourcesData.prep);
  const box = document.getElementById('sources-browser');
  if (box && list.contains(box)) list.after(box); // keep it out of the innerHTML rebuild below
  list.innerHTML = SOURCE_KIND_ORDER.filter((kind) => sourcesData.sources[kind]).map((kind) => {
    const s = sourcesData.sources[kind];
    const rows = s.folders.map((f, idx) => '<div class="sources-row">'
      + '<span class="sources-path' + (f.exists ? '' : ' sources-missing') + '" title="' + sourcesEsc(f.path) + '">'
      + (f.exists ? '' : '⚠️ not found · ') + sourcesEsc(f.path) + '</span>'
      + (s.using_default ? '<span class="sources-default">default</span>'
        : '<button class="badge" onclick="removeSourceFolder(\'' + kind + '\',' + idx + ')" title="Remove">✕</button>')
      + '</div>').join('');
    return '<div class="sources-kind" data-kind="' + kind + '"><div class="sources-kind-title">' + sourcesEsc(s.label) + '</div>' + rows
      + '<div class="grid" style="grid-template-columns:1fr 1fr">'
      + '<button class="badge" onclick="openSourceBrowser(\'' + kind + '\')">＋ Add folder</button>'
      + (s.using_default ? '' : '<button class="badge" onclick="resetSourceFolders(\'' + kind + '\')">↺ Use default</button>')
      + '</div></div>';
  }).join('');
}

function saveSourceFolders(kind, folders) {
  return fetch('/api/sources/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, folders }),
  }).then((r) => r.json()).then((d) => {
    if (!d.ok) { alert(d.error || 'Could not save that folder.'); return; }
    sourcesData.sources = d.sources;
    sourcesData.prep = d.prep;
    renderSources();
    if (kind === 'tiles') showSourcesNote('Library rescanned. Reload the page to refresh the Categories list.');
    if (kind === 'spirals') { spiralList = null; spiralListPromise = null; }
    if (kind === 'overlay' || kind === 'tiles') fxSourceLists = { dedicated: null, library: null };
    // Picking overlay folders means you want them used: point the floaters
    // at them if they were still on the main library.
    if (kind === 'overlay' && folders.length && fxSource === 'library') {
      setFxSource('dedicated');
      showSourcesNote('Floating Overlay now uses these folders (Screen → Floating Overlay to change).');
    }
  });
}

function showSourcesNote(text) {
  const el = document.getElementById('sources-prep');
  if (el) el.insertAdjacentHTML('beforeend', '<br><span style="color:#ffd27a">' + sourcesEsc(text) + '</span>');
}

function currentChosen(kind) {
  const s = sourcesData.sources[kind];
  return s.using_default ? [] : s.folders.map((f) => f.path);
}

function removeSourceFolder(kind, idx) {
  const folders = currentChosen(kind);
  folders.splice(idx, 1);
  saveSourceFolders(kind, folders);
}

function resetSourceFolders(kind) {
  saveSourceFolders(kind, []);
}

function openSourceBrowser(kind) {
  sourcesBrowseKind = kind;
  const s = sourcesData.sources[kind];
  browseSourceFolder(s.folders.length ? s.folders[s.folders.length - 1].path : '');
}

function browseSourceFolder(path) {
  fetch('/api/sources/browse?path=' + encodeURIComponent(path || ''))
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) { if (path) browseSourceFolder(''); return; }
      const box = document.getElementById('sources-browser');
      const kindEl = document.querySelector('.sources-kind[data-kind="' + sourcesBrowseKind + '"]');
      if (kindEl && kindEl.nextElementSibling !== box) kindEl.after(box); // open under the source being edited
      box.style.display = '';
      box.dataset.path = d.path;
      const up = d.parent === null ? '' : '<button class="badge" data-path="' + sourcesEsc(d.parent) + '" onclick="browseSourceFolder(this.dataset.path)">⬆ Up</button>';
      const items = d.folders.map((f) => '<div class="sources-folder" data-path="' + sourcesEsc(f.path) + '" onclick="browseSourceFolder(this.dataset.path)">📁 ' + sourcesEsc(f.name) + '</div>').join('')
        || '<div class="metric" style="opacity:.6">No subfolders</div>';
      box.innerHTML = '<div class="sources-kind-title">Add to ' + sourcesEsc(sourcesData.sources[sourcesBrowseKind].label) + '</div>'
        + '<div class="sources-path">' + (d.path ? sourcesEsc(d.path) : 'This PC') + '</div>'
        + '<div class="sources-folders">' + items + '</div>'
        + '<div class="grid" style="grid-template-columns:1fr 1fr 1fr">' + up
        + (d.path ? '<button class="badge" onclick="chooseBrowsedFolder()">✓ Use this folder</button>' : '')
        + '<button class="badge" onclick="closeSourceBrowser()">Cancel</button></div>';
    });
}

function chooseBrowsedFolder() {
  const box = document.getElementById('sources-browser');
  const folders = currentChosen(sourcesBrowseKind);
  folders.push(box.dataset.path);
  saveSourceFolders(sourcesBrowseKind, folders).then(closeSourceBrowser);
}

function closeSourceBrowser() {
  const box = document.getElementById('sources-browser');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  sourcesBrowseKind = null;
}

// While the section is open, the prep counts refresh on their own.
let sourcesPrepTimer = null;

function initSources() {
  const section = document.getElementById('sources-section');
  if (!section) return;
  section.addEventListener('toggle', () => {
    clearInterval(sourcesPrepTimer);
    sourcesPrepTimer = null;
    if (!section.open) return;
    loadSources();
    sourcesPrepTimer = setInterval(() => {
      if (document.hidden || sourcesBrowseKind) return; // don't redraw under an open folder browser
      fetch('/api/sources').then((r) => r.json()).then((d) => { sourcesData = d; renderSourcesPrep(d.prep); }).catch(() => {});
    }, 5000);
  });
}

initSources();
