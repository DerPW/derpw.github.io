// Tagwerk – Einstieg: verbindet Dateizugriff, Zustand, Liste, Editor und Automationen.
import { actionList, computeRename, openAction } from './actions.js';
import { forget } from './covers.js';
import { ACCENTS, openPalette, openSettings, openShortcuts } from './dialogs.js';
import { formatLongDuration, plural, TEXT_FIELDS } from './fields.js';
import {
  canAccessFS, captureDrop, download, ensurePermission, forgetFolder, getBlob, listDirectory, listingFromFiles,
  openRecent, pickFolder, pickFolderFallback, recentFolders, renameFiles, writeFile,
} from './fs.js';
import { focusFirstField, initInspector, pasteImage, stopPlayback, togglePlay } from './inspector.js';
import { openLookup } from './lookup.js';
import { cleanup } from './patterns.js';
import {
  canRedo, canUndo, clearPending, dirtyFiles, emit, isDirty, on, redo, refreshView, resetHistory, revert, select,
  selectedFiles, selectRange, setFiles, setFilter, setRename, setTags, state, undo, updateFile, value,
} from './state.js';
import { initTable, scrollToFile } from './table.js';
import { readTags, writeTags } from './tags/index.js';
import {
  $, closeTopModal, confirmDialog, contextMenu, debounce, esc, hydrateIcons, icon, load, modalOpen, modKey, setIcon,
  store, toast,
} from './ui.js';
import { makeZip } from './zip.js';

const settings = {
  theme: 'dark', accent: 'violet', motion: true, id3Version: 3,
  autoClean: true, autoTrackTotal: false, autoRename: false, renamePattern: '{track} - {title}',
  ...load('settings', {}),
};

let nextId = 1;
let saving = false;

/* ------------------------------------------------------------ Einstellungen */

function applySettings() {
  const root = document.documentElement;
  const theme = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
  root.dataset.theme = theme;
  root.dataset.accent = settings.accent;
  root.dataset.motion = settings.motion ? 'on' : 'off';
  const hue = ACCENTS.find(([v]) => v === settings.accent)?.[2] ?? 262;
  root.style.setProperty('--accent-h', hue);
  document.querySelector('meta[name=theme-color]').content = theme === 'light' ? '#eef0f7' : '#08080d';
  setIcon($('#btn-theme'), theme === 'light' ? 'sun' : 'moon');
  store('settings', settings);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  settings.theme = current === 'light' ? 'dark' : 'light';
  document.documentElement.classList.add('theme-anim');
  applySettings();
  setTimeout(() => document.documentElement.classList.remove('theme-anim'), 500);
}

/* ------------------------------------------------------------------ Laden */

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

function showLoading(done, total) {
  const el = $('#loading');
  el.hidden = total === 0;
  $('#library').classList.toggle('is-loading', total > 0);
  if (!total) return;
  $('#loading-text').textContent = `Lese Tags … ${done.toLocaleString('de-DE')} / ${total.toLocaleString('de-DE')}`;
  $('#loading-bar').style.width = `${(done / total) * 100}%`;
}

async function confirmDiscard() {
  const n = dirtyFiles().length;
  if (!n) return true;
  return confirmDialog({
    title: 'Ungespeicherte Änderungen',
    message: `${plural(n, 'Titel hat', 'Titel haben')} ungespeicherte Änderungen. Trotzdem fortfahren und verwerfen?`,
    confirmLabel: 'Verwerfen', danger: true,
  });
}

async function loadListing(listing) {
  const entries = listing.entries;
  if (!entries.length) {
    toast('In diesem Ordner wurden keine Audiodateien gefunden.', { type: 'warning' });
    return;
  }
  stopPlayback();
  const files = new Array(entries.length);
  let done = 0;
  let raf = 0;
  showLoading(0, entries.length);
  await pool(entries, 6, async (entry, i) => {
    const file = {
      id: nextId++, path: entry.path, name: entry.name, dir: entry.dir, ext: entry.ext,
      handle: entry.handle ?? null, parent: entry.parent ?? null, blob: entry.blob ?? null,
      format: entry.ext.toUpperCase(), tagType: '', info: {}, tags: {}, hasCover: false, size: 0, mtime: 0,
    };
    try {
      const blob = await getBlob(file);
      file.size = blob.size;
      file.mtime = blob.lastModified;
      const meta = await readTags(blob, { name: file.name });
      Object.assign(file, { format: meta.format, tagType: meta.tagType, info: meta.info, tags: meta.tags, hasCover: meta.hasCover });
    } catch (err) {
      file.error = err.message || String(err);
    }
    files[i] = file;
    done++;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; showLoading(done, entries.length); });
  });
  cancelAnimationFrame(raf);
  showLoading(0, 0);
  setFiles({ ...listing.source, images: listing.images }, files);
  const broken = files.filter((f) => f.error).length;
  toast(`${plural(files.length, 'Titel', 'Titel')} geladen`, {
    type: broken ? 'warning' : 'success', duration: 2600,
    detail: broken ? `${plural(broken, 'Datei konnte', 'Dateien konnten')} nicht gelesen werden` : undefined,
  });
  if (listing.source.mode === 'download' && !sessionStorage.getItem('tagwerk.dlhint')) {
    sessionStorage.setItem('tagwerk.dlhint', '1');
    toast('Download-Modus: Dein Browser erlaubt keinen direkten Dateizugriff. Geänderte Dateien werden beim Speichern heruntergeladen.', { type: 'info', duration: 9000 });
  }
}

async function openFolder() {
  if (!(await confirmDiscard())) return;
  try {
    await loadListing(canAccessFS ? await pickFolder() : await pickFolderFallback());
  } catch (err) {
    if (err.name !== 'AbortError') toast(err.message, { type: 'error' });
  }
}

async function reloadFolder() {
  if (!state.source?.root) return;
  if (!(await confirmDiscard())) return;
  try {
    if (!(await ensurePermission(state.source.root))) return;
    await loadListing(await listDirectory(state.source.root));
  } catch (err) { toast(err.message, { type: 'error' }); }
}

/* --------------------------------------------------------------- Speichern */

function applyAutoRules(files) {
  const changes = [];
  for (const f of files) {
    const tags = {};
    if (settings.autoClean) {
      for (const k of TEXT_FIELDS) {
        const v = value(f, k);
        const c = cleanup(v, { spaces: true });
        if (c !== v) tags[k] = c;
      }
    }
    if (settings.autoTrackTotal && value(f, 'track') && !value(f, 'tracktotal')) {
      const album = value(f, 'album');
      tags.tracktotal = String(state.files.filter((o) => o.dir === f.dir && value(o, 'album') === album).length);
    }
    if (Object.keys(tags).length) changes.push({ id: f.id, tags });
  }
  if (changes.length) setTags(changes, { record: false });
}

function buildOutput(file, p) {
  const changed = Object.keys(p.tags);
  const cover = p.cover === undefined ? undefined : p.cover && { mime: p.cover.mime, data: p.cover.data };
  return { changed, cover, tags: { ...file.tags, ...p.tags } };
}

async function saveFiles(ids) {
  if (saving || !state.source) return;
  let files = (ids ? ids.map((id) => state.byId.get(id)) : dirtyFiles()).filter((f) => f && isDirty(f));
  if (!files.length) return;
  applyAutoRules(files);
  files = files.filter(isDirty);
  if (state.source.mode === 'download') return exportFiles(files);

  saving = true;
  document.body.classList.add('is-saving');
  const root = state.source.root;
  const progress = files.length > 2 ? toast(`Speichere ${files.length} Titel …`, { type: 'progress', duration: 0 }) : null;
  const errors = [];
  const saved = [];
  try {
    if (root && !(await ensurePermission(root))) throw new Error('Kein Schreibzugriff auf den Ordner erteilt');
    let n = 0;
    for (const file of files) {
      const p = state.pending.get(file.id);
      n++;
      if (!p || (!Object.keys(p.tags).length && p.cover === undefined)) continue;
      try {
        if (file.error) throw new Error(`Datei nicht lesbar: ${file.error}`);
        if (!root && !(await ensurePermission(file.handle))) throw new Error('Kein Schreibzugriff');
        const { changed, cover, tags } = buildOutput(file, p);
        const out = await writeTags(await getBlob(file), { name: file.name, tags, changed, cover, id3Version: settings.id3Version });
        const fresh = await writeFile(file, out);
        const meta = await readTags(fresh, { name: file.name });
        forget(file);
        updateFile(file, { size: fresh.size, mtime: fresh.lastModified, tags: meta.tags, info: meta.info, hasCover: meta.hasCover, tagType: meta.tagType, format: meta.format });
        clearPending(file.id);
        saved.push(file);
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
      if (progress && n % 3 === 0) progress.update(`Speichere … ${n} / ${files.length}`);
    }
  } catch (err) {
    errors.push(err.message);
  } finally {
    saving = false;
    document.body.classList.remove('is-saving');
    progress?.close();
  }
  resetHistory();
  refreshView();
  emit('pending');
  emit('saved');
  if (saved.length) toast(`${plural(saved.length, 'Titel', 'Titel')} gespeichert`, { type: 'success', duration: 2600 });
  if (errors.length) toast(`${plural(errors.length, 'Datei', 'Dateien')} nicht gespeichert`, { type: 'error', duration: 9000, detail: errors.slice(0, 3).join('\n') });
  if (settings.autoRename && settings.renamePattern && saved.length && root) {
    const { rows } = computeRename(saved, settings.renamePattern);
    const valid = rows.filter((r) => !r.conflict);
    if (valid.length) await renameRows(valid, { auto: true });
  }
}

async function exportFiles(files) {
  saving = true;
  const progress = toast('Bereite Download vor …', { type: 'progress', duration: 0 });
  try {
    const outputs = [];
    for (const file of files) {
      const p = state.pending.get(file.id);
      let blob = await getBlob(file);
      const { changed, cover, tags } = buildOutput(file, p);
      if (changed.length || cover !== undefined) blob = await writeTags(blob, { name: file.name, tags, changed, cover, id3Version: settings.id3Version });
      outputs.push({ file, blob, path: p.rename ?? file.path });
    }
    if (outputs.length === 1) download(outputs[0].blob, outputs[0].path.split('/').pop());
    else download(await makeZip(outputs.map((o) => ({ name: `${state.source.name}/${o.path}`, blob: o.blob }))), `${state.source.name} – Tagwerk.zip`);
    for (const { file, blob, path } of outputs) {
      const name = path.split('/').pop();
      const meta = await readTags(blob, { name });
      forget(file);
      const now = Date.now();
      updateFile(file, {
        blob: new File([blob], name, { lastModified: now }), path, name, dir: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
        size: blob.size, mtime: now, tags: meta.tags, info: meta.info, hasCover: meta.hasCover, tagType: meta.tagType,
      });
      clearPending(file.id);
    }
    resetHistory();
    refreshView();
    emit('pending');
    emit('saved');
    toast(outputs.length === 1 ? 'Datei heruntergeladen' : `${plural(outputs.length, 'Datei', 'Dateien')} als ZIP heruntergeladen`, { type: 'success' });
  } catch (err) {
    toast(`Export fehlgeschlagen: ${err.message}`, { type: 'error' });
  } finally {
    saving = false;
    progress.close();
  }
}

/* ------------------------------------------------------------- Umbenennen */

async function renameRows(rows, { removeEmptyDirs = true, auto = false } = {}) {
  if (!rows.length) return;
  if (state.source.mode === 'download') {
    setRename(rows.map((r) => ({ id: r.file.id, path: r.target })));
    toast(`${plural(rows.length, 'neuer Name', 'neue Namen')} vorgemerkt – wird beim Speichern (Download) übernommen`, { type: 'success' });
    return;
  }
  const root = state.source.root;
  if (!root) {
    toast('Umbenennen geht nur, wenn ein ganzer Ordner geöffnet wurde.', { type: 'warning' });
    return;
  }
  if (!(await ensurePermission(root))) return;
  if (rows.some((r) => r.file.id === state.playing)) stopPlayback();
  const results = await renameFiles(root, rows.map((r) => ({ file: r.file, target: r.target })), { removeEmptyDirs });
  const undoRows = [];
  const errors = [];
  for (const r of rows) {
    const res = results.get(r.file.id);
    if (!res) continue;
    if (!res.ok) { errors.push(`${r.file.name}: ${res.error}`); continue; }
    undoRows.push({ file: r.file, target: r.from });
    updateFile(r.file, { handle: res.handle, parent: res.parent, path: res.path, name: res.name, dir: res.dir });
  }
  refreshView();
  emit('saved');
  if (undoRows.length) {
    toast(`${plural(undoRows.length, 'Datei', 'Dateien')} ${auto ? 'automatisch ' : ''}umbenannt`, {
      type: 'success', duration: 7000, actionLabel: 'Rückgängig',
      action: () => renameRows(undoRows.map((u) => ({ ...u, from: u.file.path })), { removeEmptyDirs: true }),
    });
  }
  if (errors.length) toast(`${plural(errors.length, 'Datei', 'Dateien')} nicht umbenannt`, { type: 'error', duration: 9000, detail: errors.slice(0, 3).join('\n') });
}

/* --------------------------------------------------------------- Oberfläche */

const actionCtx = { save: () => saveFiles(), rename: (rows, opts) => renameRows(rows, opts) };

function updateToolbar() {
  const n = dirtyFiles().length;
  const btn = $('#btn-save');
  btn.disabled = n === 0;
  btn.classList.toggle('has-changes', n > 0);
  const badge = $('#save-count');
  if (badge.textContent !== String(n)) {
    badge.textContent = n;
    badge.classList.remove('pop');
    void badge.offsetWidth;
    badge.classList.add('pop');
  }
  btn.title = state.source?.mode === 'download' ? 'Geänderte Dateien herunterladen (⌘S)' : 'Speichern (⌘S)';
  btn.querySelector('.btn-label').textContent = state.source?.mode === 'download' ? 'Download' : 'Speichern';
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
}

function renderStatus() {
  const el = $('#statusbar');
  if (!state.source) {
    el.innerHTML = `<span class="status-left">${canAccessFS ? `${icon('shield')} Läuft komplett lokal – keine Uploads` : `${icon('info')} Download-Modus – für direktes Speichern Chrome, Edge oder Brave nutzen`}</span>
      <span class="status-right"><button class="status-link" data-status="keys">${icon('command')} Tastenkürzel</button></span>`;
    return;
  }
  const sel = selectedFiles();
  const dirty = dirtyFiles().length;
  const duration = state.view.reduce((s, f) => s + (f.info?.duration || 0), 0);
  const mode = state.source.mode === 'fsa'
    ? `<span class="mode ok"><i></i>Direkter Dateizugriff</span>`
    : `<span class="mode dl"><i></i>Download-Modus</span>`;
  el.innerHTML = `
    <span class="status-left">
      <span>${plural(state.view.length, 'Titel', 'Titel')}${state.filter ? ` von ${state.files.length}` : ''}</span>
      ${sel.length ? `<span class="dot"></span><span>${sel.length} ausgewählt</span>` : ''}
      ${dirty ? `<span class="dot"></span><span class="accent">${dirty} geändert</span>` : ''}
      <span class="dot"></span><span>${formatLongDuration(duration)}</span>
    </span>
    <span class="status-right">${mode}<button class="status-link" data-status="keys">${icon('command')} Tastenkürzel</button></span>`;
}

function updatePath() {
  const label = $('#path-label');
  label.textContent = state.source ? state.source.name : 'Ordner öffnen';
  $('#btn-open').classList.toggle('has-path', !!state.source);
  $('#welcome').hidden = !!state.source;
  $('#library').classList.toggle('has-files', !!state.source);
  document.body.classList.toggle('no-source', !state.source);
}

async function renderWelcome() {
  const el = $('#welcome');
  const recent = await recentFolders();
  el.innerHTML = `
    <div class="welcome-inner">
      <div class="hero-art">
        <div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>
        <div class="hero-disc">${icon('tag')}</div>
      </div>
      <h1>Musik-Tags. <span class="grad">Schön einfach.</span></h1>
      <p class="lead">Titel, Interpreten, Alben und Cover bearbeiten – einzeln oder hunderte auf einmal. Direkt im Browser, deine Dateien verlassen nie deinen Rechner.</p>
      <div class="cta">
        <button class="btn primary big" data-welcome="open">${icon('folderOpen')}<span>Ordner öffnen</span></button>
        <span class="cta-or">oder einfach hierher ziehen</span>
      </div>
      ${recent.length ? `<div class="recent"><span class="recent-label">Zuletzt geöffnet</span>${recent.map((r) => `
        <span class="recent-item"><button data-recent="${r.id}">${icon('folder')}<span>${esc(r.name)}</span></button><button class="recent-x" data-forget="${r.id}" title="Aus Liste entfernen">${icon('x')}</button></span>`).join('')}</div>` : ''}
      <div class="features">
        <div class="feature"><span class="f-ico">${icon('layers')}</span><b>Mehrfachbearbeitung</b><span>Gemeinsame Felder für beliebig viele Titel</span></div>
        <div class="feature"><span class="f-ico">${icon('sparkles')}</span><b>Automationen</b><span>Umbenennen, Tracknummern, Aufräumen</span></div>
        <div class="feature"><span class="f-ico">${icon('search')}</span><b>Online-Metadaten</b><span>Fehlendes von MusicBrainz &amp; iTunes</span></div>
        <div class="feature"><span class="f-ico">${icon('image')}</span><b>Cover</b><span>Drag &amp; Drop, Einfügen oder online</span></div>
      </div>
      <div class="formats">MP3 · FLAC · M4A · OGG · OPUS · WAV · AIFF</div>
      ${canAccessFS ? '' : `<div class="browser-note">${icon('info')}<span>Dein Browser erlaubt keinen direkten Dateizugriff – Änderungen werden als Download gespeichert. Für direktes Speichern und Umbenennen <b>Chrome, Edge oder Brave</b> verwenden.</span></div>`}
    </div>`;
  el.onclick = async (e) => {
    const t = e.target.closest('[data-welcome],[data-recent],[data-forget]');
    if (!t) return;
    if (t.dataset.welcome) return openFolder();
    if (t.dataset.forget) { await forgetFolder(+t.dataset.forget); return renderWelcome(); }
    const entry = recent.find((r) => r.id === +t.dataset.recent);
    try { await loadListing(await openRecent(entry)); } catch (err) { if (err.name !== 'AbortError') toast(err.message, { type: 'error' }); }
  };
}

function selectAll() {
  select(state.view.map((f) => f.id), { anchor: state.view[0]?.id ?? null });
}

async function discardAll() {
  const n = dirtyFiles().length;
  if (!n) return;
  if (await confirmDialog({ title: 'Alle Änderungen verwerfen?', message: `Die Änderungen an ${plural(n, 'Titel', 'Titeln')} gehen verloren.`, confirmLabel: 'Verwerfen', danger: true })) {
    revert(dirtyFiles().map((f) => f.id));
  }
}

function commands() {
  const hasFiles = state.files.length > 0;
  return [
    { group: 'Automationen', title: 'Online nachschlagen', desc: 'Fehlende Tags und Cover von MusicBrainz oder iTunes laden', icon: 'search', disabled: !hasFiles, run: () => openLookup(actionCtx) },
    ...actionList.map((a) => ({ group: 'Automationen', title: a.title, desc: a.desc, icon: a.icon, disabled: !hasFiles, run: () => openAction(a.id, actionCtx) })),
    { group: 'Allgemein', title: 'Ordner öffnen', icon: 'folderOpen', kbd: '⌘O', run: openFolder },
    { group: 'Allgemein', title: 'Ordner neu einlesen', icon: 'refresh', hidden: !state.source?.root, run: reloadFolder },
    { group: 'Allgemein', title: 'Speichern', icon: 'save', kbd: '⌘S', disabled: !dirtyFiles().length, run: () => saveFiles() },
    { group: 'Allgemein', title: 'Alle auswählen', icon: 'layers', kbd: '⌘A', disabled: !hasFiles, run: selectAll },
    { group: 'Allgemein', title: 'Alle Änderungen verwerfen', icon: 'rotate', disabled: !dirtyFiles().length, run: discardAll },
    { group: 'Ansicht', title: 'Hell / Dunkel umschalten', icon: 'moon', run: toggleTheme },
    { group: 'Ansicht', title: 'Einstellungen', icon: 'settings', run: () => openSettings(settings, onSettings) },
    { group: 'Ansicht', title: 'Tastenkürzel', icon: 'command', kbd: '?', run: openShortcuts },
  ];
}

function onSettings(next) {
  Object.assign(settings, next);
  applySettings();
}

function rowMenu({ x, y }) {
  const files = selectedFiles();
  const n = files.length;
  const run = (id) => () => openAction(id, actionCtx);
  contextMenu(x, y, [
    { label: 'Online nachschlagen …', icon: 'search', action: () => openLookup(actionCtx) },
    { label: n > 1 ? `${n} Titel umbenennen …` : 'Umbenennen …', icon: 'filePen', action: run('rename') },
    { label: 'Tracknummern vergeben …', icon: 'hash', action: run('number') },
    { label: 'Tags aus Dateiname …', icon: 'fileInput', action: run('fromName') },
    { label: 'Groß-/Kleinschreibung …', icon: 'type', action: run('case') },
    'sep',
    { label: 'Abspielen', icon: 'play', kbd: 'Leertaste', disabled: n !== 1, action: togglePlay },
    { label: 'Auswahl speichern', icon: 'save', disabled: !files.some(isDirty), action: () => saveFiles(files.map((f) => f.id)) },
    { label: 'Änderungen verwerfen', icon: 'rotate', disabled: !files.some(isDirty), danger: true, action: () => revert(files.map((f) => f.id)) },
  ]);
}

/* ------------------------------------------------------------ Tastatur */

function moveSelection(delta, extend) {
  const list = state.view;
  if (!list.length) return;
  let idx = list.findIndex((f) => f.id === state.focus);
  idx = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, idx + delta));
  const id = list[idx].id;
  if (extend) selectRange(state.anchor ?? id, id);
  else select([id], { anchor: id, focus: id });
  scrollToFile(id);
}

function onKeyDown(e) {
  const mod = modKey(e);
  const key = e.key.toLowerCase();
  const inField = e.target.matches?.('input, textarea, select, [contenteditable="true"]');
  if (e.key === 'Escape') {
    if (closeTopModal()) { e.preventDefault(); return; }
    if (inField) { if (e.target.id === 'search-input' && e.target.value) { e.target.value = ''; setFilter(''); } e.target.blur(); return; }
    if (state.selection.size) select([]);
    return;
  }
  if (mod && key === 's') { e.preventDefault(); if (!modalOpen()) saveFiles(); return; }
  if (mod && key === 'o') { e.preventDefault(); if (!modalOpen()) openFolder(); return; }
  if (mod && key === 'k') { e.preventDefault(); if (!closeTopModal()) openPalette(commands()); return; }
  if (modalOpen()) return;
  if (mod && key === 'f') { e.preventDefault(); $('#search-input').focus(); $('#search-input').select(); return; }
  if (inField) {
    if (mod && e.key === 'Enter') { e.preventDefault(); e.target.blur(); saveFiles(); }
    return;
  }
  if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && key === 'y') { e.preventDefault(); redo(); return; }
  if (mod && key === 'a') { e.preventDefault(); selectAll(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSelection(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey); return; }
  if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); moveSelection(e.key === 'Home' ? -1e9 : 1e9, e.shiftKey); return; }
  if (e.key === 'Enter' && state.selection.size) { e.preventDefault(); focusFirstField(); return; }
  if (e.key === ' ' && state.selection.size) { e.preventDefault(); togglePlay(); return; }
  if (e.key === '?') { openShortcuts(); }
}

/* ------------------------------------------------------------ Drag & Drop */

function initDrop() {
  const overlay = $('#drop-overlay');
  let depth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' && !i.type.startsWith('image/'));
  addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    depth++;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('show'));
  });
  addEventListener('dragleave', () => {
    if (--depth > 0) return;
    depth = 0;
    overlay.classList.remove('show');
    setTimeout(() => { if (!depth) overlay.hidden = true; }, 180);
  });
  addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    overlay.hidden = true;
    if (!isFileDrag(e)) return;
    const run = captureDrop(e.dataTransfer);
    if (!(await confirmDiscard())) return;
    try { await loadListing(await run()); } catch (err) { if (err.name !== 'AbortError') toast(err.message, { type: 'error' }); }
  });
}

/* ------------------------------------------------------------------ Start */

function init() {
  hydrateIcons();
  applySettings();
  initTable();
  initInspector({ save: (ids) => saveFiles(ids), lookup: () => openLookup(actionCtx) });
  renderWelcome();
  updatePath();
  renderStatus();
  updateToolbar();

  $('#btn-open').onclick = openFolder;
  $('#btn-save').onclick = () => saveFiles();
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-actions').onclick = () => openPalette(commands());
  $('#btn-theme').onclick = toggleTheme;
  $('#btn-settings').onclick = () => openSettings(settings, onSettings);
  $('#btn-panel').onclick = () => document.body.classList.toggle('show-inspector');
  $('#statusbar').addEventListener('click', (e) => { if (e.target.closest('[data-status=keys]')) openShortcuts(); });
  const search = $('#search-input');
  search.addEventListener('input', debounce(() => setFilter(search.value), 120));

  on('pending', () => { updateToolbar(); renderStatus(); });
  on('selection', renderStatus);
  on('view', renderStatus);
  on('files', () => { updatePath(); renderStatus(); updateToolbar(); });
  on('saved', renderStatus);
  on('row-menu', rowMenu);
  on('selection', () => { if (state.selection.size && innerWidth < 980) document.body.classList.add('show-inspector'); });

  addEventListener('keydown', onKeyDown);
  addEventListener('paste', async (e) => {
    if (e.target.matches?.('input, textarea')) return;
    if (await pasteImage(e.clipboardData)) e.preventDefault();
  });
  addEventListener('beforeunload', (e) => {
    if (dirtyFiles().length) { e.preventDefault(); e.returnValue = ''; }
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (settings.theme === 'system') applySettings(); });
  initDrop();
  requestAnimationFrame(() => document.body.classList.add('ready'));

  // Haken für Tests und Entwicklung (siehe tests/demo.js)
  window.tagwerk = {
    state,
    openFiles: (files, name = 'Test') => loadListing(listingFromFiles(files, name)),
    openDirectory: async (handle) => loadListing(await listDirectory(handle)),
    save: saveFiles,
    rename: renameRows,
  };
}

init();
