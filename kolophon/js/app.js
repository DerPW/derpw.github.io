// Einstieg: Öffnen, Einlesen, Sichern, Werkzeugleiste, Tastatur, Drag & Drop, Einstellungen.
import { h, $, icon, toast, menu, closeMenu, sheet, sheetOpen, closeTopSheet, confirmSheet, plural, mod, isMac, kbd, formatBytes } from './ui.js';
import {
  state, settings, setSetting, setBooks, on, emit, dirtyBooks, undo, redo, apply, revert, commitSaved, value,
} from './state.js';
import * as library from './library.js';
import * as inspector from './inspector.js';
import {
  canAccessFS, canPickFiles, pickFolder, pickFiles, pickFolderFallback, pickFilesFallback, captureDrop, getFile, writeFile,
  recentFolders, openRecent, forgetFolder, download,
} from './fs.js';
import { readBook, writeBook } from './epub/index.js';
import { findEntry, makeZip } from './epub/zip.js';
import { prepareCover, clearThumbCache } from './covers.js';
import { openLookup } from './lookup/sheet.js';
import { SOURCES, SOURCE_ORDER } from './lookup/sources.js';
import { demoListing } from './demo.js';

const root = document.documentElement;
const els = {
  title: $('#title'), subtitle: $('#subtitle'), status: $('#status-text'), welcome: $('#welcome'),
  save: $('#btn-save'), saveLabel: $('#save-label'), saveIcon: $('#save-icon'), saveCount: $('#save-count'),
  lookup: $('#btn-lookup'), search: $('#search-input'), scroller: $('#scroller'), progress: $('#progress'), progressBar: $('#progress-bar'),
  sizeInput: $('#size-input'), foot: $('#sidebar-foot'),
};

// Symbole in statische Knöpfe einsetzen
for (const el of document.querySelectorAll('[data-icon]')) if (!el.firstChild) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));

const narrow = matchMedia('(max-width: 980px)');

/* --------------------------------------------------------- Erscheinungsbild */

function applyTheme() {
  const t = settings.theme;
  root.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

function applyPanels() {
  if (narrow.matches) {
    root.dataset.sidebar = 'on';
    root.dataset.inspector = 'on';
  } else {
    root.dataset.sidebar = settings.sidebar ? 'on' : 'off';
    root.dataset.inspector = settings.inspector ? 'on' : 'off';
    delete root.dataset.sidebarOverlay;
    delete root.dataset.inspectorOverlay;
  }
}
narrow.addEventListener('change', applyPanels);

function togglePanel(which) {
  if (narrow.matches) {
    const key = which === 'sidebar' ? 'sidebarOverlay' : 'inspectorOverlay';
    const other = which === 'sidebar' ? 'inspectorOverlay' : 'sidebarOverlay';
    root.dataset[key] = root.dataset[key] === 'on' ? 'off' : 'on';
    root.dataset[other] = 'off';
    return;
  }
  setSetting(which, !settings[which]);
  applyPanels();
}

/* ------------------------------------------------------------ Kopfzeile */

function updateChrome() {
  const hasBooks = state.books.length > 0;
  els.welcome.hidden = hasBooks;
  $('#content').classList.toggle('no-books', !hasBooks);
  $('#statusbar').hidden = !hasBooks;
  els.title.textContent = hasBooks ? library.filterLabel() : 'Kolophon';
  const src = state.source;
  if (state.loading) {
    els.subtitle.textContent = `Lese ${state.loading.done.toLocaleString('de-DE')} von ${state.loading.total.toLocaleString('de-DE')} …`;
  } else if (hasBooks) {
    els.subtitle.textContent = `${src?.name ?? ''}${src?.mode === 'copy' ? ' · Kopien' : ''}`;
  } else {
    els.subtitle.textContent = 'EPUB-Metadaten bearbeiten';
  }
  els.status.textContent = hasBooks ? library.statusText() : '';
  const dirty = dirtyBooks().length;
  els.save.disabled = !dirty || Boolean(state.saving);
  els.saveCount.hidden = !dirty;
  els.saveCount.textContent = dirty;
  const copy = src?.mode === 'copy';
  els.saveLabel.textContent = copy ? 'Laden' : 'Sichern';
  els.save.title = copy ? `Geänderte Bücher als Kopie herunterladen (${kbd('⌘S')})` : `Änderungen in die Dateien schreiben (${kbd('⌘S')})`;
  els.saveIcon.innerHTML = icon(copy ? 'download' : 'save');
  els.lookup.disabled = !hasBooks || Boolean(state.loading);
  els.lookup.title = state.selection.size > 1 ? `Ausgewählte Bücher online ergänzen (${kbd('⌘K')})` : state.selection.size ? `Online-Metadaten suchen (${kbd('⌘K')})` : `Alle Bücher dieser Ansicht online ergänzen (${kbd('⌘K')})`;
  for (const b of document.querySelectorAll('#view-switch [data-view]')) b.setAttribute('aria-checked', String(b.dataset.view === settings.view));
  $('#view-switch .seg-thumb').style.transform = settings.view === 'list' ? 'translateX(36px)' : '';
  els.sizeInput.value = settings.gridSize;
  renderSourceFoot();
}

function renderSourceFoot() {
  const src = state.source;
  if (!src) { els.foot.replaceChildren(); return; }
  els.foot.replaceChildren(
    h('button.source-btn', { title: 'Anderen Ordner öffnen', onclick: (e) => openMenu(e.currentTarget) },
      h('span', { html: icon(src.root ? 'folder' : 'books') }),
      h('span.source-text', {}, h('span.source-name', {}, src.name), h('span.source-mode', {}, src.demo ? 'Beispiel · nur im Browser' : src.mode === 'copy' ? 'Kopien · Sichern lädt herunter' : 'Direkt in den Dateien'))),
    h('button.icon-btn', { title: 'Einstellungen', html: icon('gear'), onclick: openSettings }));
}

/* ---------------------------------------------------------------- Laden */

async function confirmDiscard() {
  const n = dirtyBooks().length;
  if (!n) return true;
  return confirmSheet({
    title: 'Ungesicherte Änderungen verwerfen?',
    message: `${plural(n, 'Buch hat', 'Bücher haben')} noch ungesicherte Änderungen. Wenn du jetzt etwas anderes öffnest, gehen sie verloren.`,
    confirm: 'Verwerfen', danger: true,
  });
}

async function openListing(promise) {
  let listing;
  try {
    listing = await promise;
  } catch (err) {
    if (err?.name !== 'AbortError') toast(err.message || String(err), { kind: 'error' });
    return;
  }
  if (!listing.entries.length) {
    toast('Keine EPUB-Dateien gefunden.', { kind: 'error' });
    return;
  }
  if (!(await confirmDiscard())) return;
  setBooks(listing.source, listing.entries);
  await readAll();
}

async function readOne(book) {
  try {
    const file = await getFile(book);
    book.size = file.size;
    book.lastModified = file.lastModified;
    const info = await readBook(file);
    info.coverEntry = info.cover ? findEntry(info.zip, info.cover.path) : null;
    delete info.zip;
    book.info = info;
    book.meta = info.meta;
    book.status = 'ready';
  } catch (err) {
    book.status = 'error';
    book.error = err.message || String(err);
  }
}

async function readAll() {
  const books = state.books;
  state.loading = { done: 0, total: books.length };
  els.progress.hidden = false;
  library.render();
  updateChrome();
  let i = 0;
  let lastPaint = 0;
  const worker = async () => {
    while (i < books.length) {
      const b = books[i++];
      await readOne(b);
      state.loading.done++;
      if (state.books !== books) return;
      library.updateBook(b.id);
      const now = performance.now();
      if (now - lastPaint > 120) {
        lastPaint = now;
        els.progressBar.style.width = `${(state.loading.done / state.loading.total) * 100}%`;
        updateChrome();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, books.length) }, worker));
  if (state.books !== books) return;
  state.loading = null;
  els.progressBar.style.width = '100%';
  setTimeout(() => { els.progress.hidden = true; els.progressBar.style.width = '0'; }, 400);
  library.render();
  const errors = books.filter((b) => b.status === 'error').length;
  if (errors) toast(`${plural(errors, 'Datei ließ', 'Dateien ließen')} sich nicht lesen.`, { kind: 'error', timeout: 6000, action: { label: 'Zeigen', run: () => { state.filter = { kind: 'errors', value: null }; emit('filter'); } } });
  if (!state.selection.size && library.visibleOrder().length) {
    const first = library.visibleOrder()[0];
    library.select([first], { anchor: first, focus: first });
  }
  updateChrome();
  inspector.render();
}

const openFolder = () => openListing(canAccessFS ? pickFolder() : pickFolderFallback());
const openFiles = () => openListing(canPickFiles ? pickFiles() : pickFilesFallback());
const openDemo = () => openListing(demoListing());

async function openMenu(anchor) {
  const recent = await recentFolders();
  menu(anchor, [
    { label: 'Ordner öffnen …', icon: 'folder', shortcut: '⌘O', run: openFolder },
    { label: 'Dateien öffnen …', icon: 'doc', shortcut: '⇧⌘O', run: openFiles },
    recent.length ? '-' : null,
    recent.length ? { header: 'Zuletzt geöffnet' } : null,
    ...recent.map((r) => ({ label: r.name, icon: 'folder', detail: relTime(r.time), run: () => openListing(openRecent(r)) })),
    '-',
    { label: 'Beispielbibliothek', icon: 'books', run: openDemo },
  ], { minWidth: 240 });
}

function relTime(t) {
  const d = (Date.now() - t) / 1000;
  const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
  if (d < 3600) return rtf.format(-Math.max(1, Math.round(d / 60)), 'minute');
  if (d < 86400) return rtf.format(-Math.round(d / 3600), 'hour');
  return rtf.format(-Math.round(d / 86400), 'day');
}

/* --------------------------------------------------------------- Sichern */

async function bytesFor(book) {
  const file = await getFile(book);
  if (book.handle && (file.lastModified !== book.lastModified || file.size !== book.size)) {
    throw new Error('Die Datei wurde inzwischen außerhalb von Kolophon geändert. Bitte den Ordner neu öffnen.');
  }
  const src = new Uint8Array(await file.arrayBuffer());
  const cover = book.newCover ? { bytes: book.newCover.bytes, mime: book.newCover.mime, width: book.newCover.width, height: book.newCover.height } : null;
  return writeBook(src, book.info, { ...book.edits }, cover);
}

async function afterWrite(book, file) {
  book.size = file.size;
  book.lastModified = file.lastModified;
  const info = await readBook(file);
  info.coverEntry = info.cover ? findEntry(info.zip, info.cover.path) : null;
  delete info.zip;
  if (book.thumb?.url && book.newCover) { URL.revokeObjectURL(book.thumb.url); book.thumb = null; }
  const newThumb = book.newCover ? { url: URL.createObjectURL(book.newCover.blob), width: book.newCover.width, height: book.newCover.height } : null;
  commitSaved(book, info);
  if (newThumb) book.thumb = newThumb;
}

async function save() {
  const books = dirtyBooks();
  if (!books.length || state.saving) return;
  state.saving = true;
  updateChrome();
  const copy = state.source?.mode === 'copy';
  const errors = [];
  const outputs = [];
  els.progress.hidden = false;
  let done = 0;
  try {
    for (const book of books) {
      try {
        const bytes = await bytesFor(book);
        if (copy) {
          const file = new File([bytes], book.name, { type: 'application/epub+zip', lastModified: Date.now() });
          outputs.push({ name: book.path, blob: file });
          book.file = file;
          await afterWrite(book, file);
        } else {
          const file = await writeFile(book, bytes);
          await afterWrite(book, file);
        }
      } catch (err) {
        errors.push({ book, err });
      }
      done++;
      els.progressBar.style.width = `${(done / books.length) * 100}%`;
      library.updateBook(book.id);
    }
    if (copy && outputs.length === 1) download(outputs[0].blob, outputs[0].blob.name);
    else if (copy && outputs.length > 1) {
      const zip = await makeZip(outputs);
      download(new Blob([zip], { type: 'application/zip' }), `Kolophon – ${outputs.length} Bücher.zip`);
    }
  } finally {
    state.saving = false;
    setTimeout(() => { els.progress.hidden = true; els.progressBar.style.width = '0'; }, 400);
  }
  const ok = books.length - errors.length;
  if (errors.length) {
    console.error(errors);
    toast(`${errors.length} nicht gesichert: ${errors[0].err.message}`, { kind: 'error', timeout: 8000 });
  }
  if (ok) toast(copy ? `${plural(ok, 'Buch', 'Bücher')} als Kopie heruntergeladen` : `${plural(ok, 'Buch', 'Bücher')} gesichert`, { kind: 'success' });
  library.renderSidebar();
  updateChrome();
  inspector.render();
}

/* ----------------------------------------------------------------- Cover */

const selected = () => [...state.selection].map((id) => state.byId.get(id)).filter((b) => b?.meta);

async function setCover(blob, sourceLabel = '') {
  const books = selected();
  if (!books.length) { toast('Erst ein Buch auswählen.'); return; }
  try {
    const patch = [];
    const cache = new Map();
    for (const b of books) {
      const mime = b.info?.cover?.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      if (!cache.has(mime)) cache.set(mime, await prepareCover(blob, { maxWidth: settings.coverMax, mime }));
      const p = cache.get(mime);
      patch.push({ id: b.id, field: 'cover', value: { ...p, url: URL.createObjectURL(p.blob), source: sourceLabel } });
    }
    apply(patch, 'Cover');
    const p = patch[0].value;
    toast(`Neues Cover (${p.width} × ${p.height}, ${formatBytes(p.bytes.length)}) – noch nicht gesichert`);
  } catch (err) {
    toast(`Bild nicht verwendbar: ${err.message}`, { kind: 'error' });
  }
}

function pickCover() {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif', style: { display: 'none' } });
  input.onchange = () => { const f = input.files[0]; input.remove(); if (f) setCover(f, 'Datei'); };
  document.body.append(input);
  input.click();
}

async function pasteCover() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) { setCover(await item.getType(type), 'Zwischenablage'); return; }
    }
    toast('In der Zwischenablage ist kein Bild.');
  } catch {
    toast(`Zum Einfügen ${kbd('⌘V')} drücken, während kein Textfeld aktiv ist.`);
  }
}

async function exportCover(id) {
  const b = state.byId.get(id);
  if (!b) return;
  const blob = b.newCover?.blob ?? await library.coverBlob(b);
  if (!blob) return;
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  download(blob, `${b.name.replace(/\.epub$/i, '')} – Cover.${ext}`);
}

/* ---------------------------------------------------------- Online-Suche */

function lookup() {
  if (!state.books.length || state.loading) return;
  let books = selected();
  if (!books.length) books = library.visibleOrder().map((id) => state.byId.get(id)).filter((b) => b?.meta);
  if (!books.length) return;
  openLookup(books);
}

/* ------------------------------------------------------------ Kontextmenü */

on('context-menu', ({ x, y }) => {
  const books = selected();
  if (!books.length) return;
  const dirty = books.some((b) => Object.keys(b.edits).length || b.newCover);
  menu({ x, y }, [
    { label: books.length > 1 ? `${books.length} Bücher online ergänzen …` : 'Online-Metadaten suchen …', icon: 'sparkles', shortcut: '⌘K', run: lookup },
    { label: 'Informationen', icon: 'info', shortcut: '⌘I', run: () => { if (!settings.inspector && !narrow.matches) togglePanel('inspector'); if (narrow.matches) root.dataset.inspectorOverlay = 'on'; inspector.focusField('title'); } },
    '-',
    { label: 'Cover wählen …', icon: 'photo', run: pickCover },
    books.length === 1 && (books[0].info?.cover || books[0].newCover) ? { label: 'Cover als Bild sichern …', icon: 'download', run: () => exportCover(books[0].id) } : null,
    { label: 'Als Kopie herunterladen', icon: 'download', run: () => downloadCopies(books) },
    dirty ? '-' : null,
    dirty ? { label: 'Änderungen verwerfen', icon: 'revert', danger: true, run: () => revert(books.map((b) => b.id)) } : null,
  ]);
});

async function downloadCopies(books) {
  const out = [];
  for (const b of books) {
    try {
      const dirty = Object.keys(b.edits).length || b.newCover;
      const bytes = dirty ? await bytesFor(b) : new Uint8Array(await (await getFile(b)).arrayBuffer());
      out.push({ name: b.path, blob: new File([bytes], b.name, { type: 'application/epub+zip' }) });
    } catch (err) {
      toast(`${b.name}: ${err.message}`, { kind: 'error' });
    }
  }
  if (out.length === 1) download(out[0].blob, out[0].blob.name);
  else if (out.length) download(new Blob([await makeZip(out)], { type: 'application/zip' }), `Kolophon – ${out.length} Bücher.zip`);
}

/* ------------------------------------------------------------ Einstellungen */

function openSettings() {
  const seg = (options, current, onPick) => {
    const wrap = h('div.seg-inline');
    const paint = (v) => wrap.replaceChildren(...options.map(([val, label]) => h('button', { class: val === v ? 'on' : '', onclick: () => { onPick(val); paint(val); } }, label)));
    paint(current);
    return wrap;
  };
  const sw = (checked, onchange) => h('label.switch', {}, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span'));
  const row = (label, hint, control) => h('div.settings-row', {}, h('div.s-text', {}, h('div.s-label', {}, label), hint ? h('div.s-hint', {}, hint) : null), control);
  const countries = [['de', 'Deutschland'], ['at', 'Österreich'], ['ch', 'Schweiz'], ['us', 'USA'], ['gb', 'Großbritannien'], ['fr', 'Frankreich'], ['es', 'Spanien'], ['it', 'Italien'], ['nl', 'Niederlande']];
  const country = h('select', { onchange: (e) => setSetting('country', e.target.value) }, countries.map(([v, l]) => h('option', { value: v, selected: settings.country === v }, l)));
  const coverMax = h('select', { onchange: (e) => setSetting('coverMax', Number(e.target.value)) }, [[0, 'Originalgröße'], [2400, '2400 px'], [1600, '1600 px'], [1200, '1200 px']].map(([v, l]) => h('option', { value: v, selected: settings.coverMax === v }, l)));
  const key = h('input.input', { value: settings.googleKey, placeholder: 'optional', style: { width: '220px' }, spellcheck: 'false', autocomplete: 'off', onchange: (e) => setSetting('googleKey', e.target.value.trim()) });

  const s = sheet({
    title: 'Einstellungen', width: 560,
    body: [
      h('div.settings-group', {}, h('h3', {}, 'Darstellung'), h('div.group', {},
        row('Erscheinungsbild', null, seg([['system', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']], settings.theme, (v) => { setSetting('theme', v); applyTheme(); })))),
      h('div.settings-group', {}, h('h3', {}, 'Online-Suche'), h('div.group', {},
        ...SOURCE_ORDER.map((k) => row(SOURCES[k].label, SOURCES[k].hint, sw(settings.sources[k], (v) => setSetting('sources', { ...settings.sources, [k]: v })))),
        row('Apple-Books-Store', 'Land für Treffer, Preise und Cover', country),
        row('Google-Books-API-Schlüssel', 'Ohne Schlüssel ist das gemeinsame Tageslimit oft schnell erreicht', key))),
      h('div.settings-group', {}, h('h3', {}, 'Bearbeiten'), h('div.group', {},
        row('Cover verkleinern auf', 'Große Bilder machen das Buch unnötig schwer', coverMax),
        row('Sortierautor automatisch', '„Nachname, Vorname“ beim Ändern der Autor:innen nachführen', sw(settings.autoSort, (v) => setSetting('autoSort', v))))),
      h('div.settings-group', {}, h('h3', {}, 'Speicher'), h('div.group', {},
        row('Vorschaubilder', 'Werden im Browser zwischengespeichert, damit große Bibliotheken schnell öffnen', h('button.btn.small', { onclick: async () => { await clearThumbCache(); toast('Zwischenspeicher geleert'); } }, 'Leeren')))),
      h('p.welcome-foot', { style: { textAlign: 'left', margin: '4px 4px 0' } }, 'Kolophon arbeitet vollständig im Browser. Deine Bücher werden nirgendwo hochgeladen – die Online-Suche sendet nur Titel, Autor oder ISBN an die gewählten Dienste.'),
    ],
    footer: [h('button.btn.primary', { onclick: () => s.close() }, 'Fertig')],
  });
}

/* ------------------------------------------------------------ Willkommen */

async function renderWelcome() {
  const recent = await recentFolders();
  const note = !canAccessFS
    ? h('div.browser-note', {}, h('span', { html: icon('info') }), h('span', {}, 'Dieser Browser erlaubt keinen direkten Schreibzugriff auf Dateien. Kolophon liest deshalb Kopien ein und lädt geänderte Bücher beim Sichern herunter. Direkt in die Dateien speichern geht in Chrome, Edge, Arc oder Brave.'))
    : null;
  els.welcome.replaceChildren(...[
    h('img.welcome-icon', { src: 'assets/icon.svg', alt: '' }),
    h('h2', {}, 'EPUB-Metadaten bearbeiten'),
    h('p.lead', {}, 'Titel, Autor:innen, Reihen, Cover und Beschreibungen ändern – für ein Buch oder die ganze Bibliothek. Fehlendes sucht Kolophon bei Apple Books, der Deutschen Nationalbibliothek, Open Library und Google Books.'),
    h('div.welcome-actions', {},
      h('button.btn.primary.large', { onclick: openFolder }, h('span', { html: icon('folder') }), 'Ordner öffnen …'),
      h('button.btn.large', { onclick: openFiles }, h('span', { html: icon('doc') }), 'Dateien öffnen …'),
      h('button.btn.large', { onclick: openDemo }, h('span', { html: icon('books') }), 'Beispiel ansehen')),
    recent.length ? h('div.recent', {}, h('div.recent-title', {}, 'Zuletzt geöffnet'), h('div.recent-list', {}, recent.map((r) => h('button.recent-item', { onclick: () => openListing(openRecent(r)) },
      h('span', { html: icon('folder') }), h('span.recent-name', {}, r.name), h('span.recent-time', {}, relTime(r.time)),
      h('span.icon-btn.forget', { title: 'Aus der Liste entfernen', html: icon('x'), onclick: async (e) => { e.stopPropagation(); await forgetFolder(r.id); renderWelcome(); } }))))) : null,
    note,
    h('p.welcome-foot', {}, `Oder Ordner bzw. EPUB-Dateien ins Fenster ziehen. Deine Dateien bleiben auf deinem ${isMac ? 'Mac' : 'Gerät'}.`)].filter(Boolean));
}

/* ------------------------------------------------------------- Ereignisse */

$('#btn-sidebar').addEventListener('click', () => togglePanel('sidebar'));
$('#btn-inspector').addEventListener('click', () => togglePanel('inspector'));
els.save.addEventListener('click', save);
els.lookup.addEventListener('click', lookup);
$('#btn-sort').addEventListener('click', (e) => menu(e.currentTarget, library.sortMenuItems(() => library.render()), { align: 'end' }));
for (const b of document.querySelectorAll('#view-switch [data-view]')) {
  b.addEventListener('click', () => { setSetting('view', b.dataset.view); library.render(); updateChrome(); });
}
els.sizeInput.addEventListener('input', () => {
  setSetting('gridSize', Number(els.sizeInput.value));
  $('#library').style.setProperty('--card-w', `${settings.gridSize}px`);
});

let searchTimer;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = els.search.value; library.render(); updateChrome(); }, 90);
});
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { els.search.value = ''; state.search = ''; library.render(); updateChrome(); els.scroller.focus(); }
  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); els.scroller.focus(); library.moveSelection('Home', e); }
});

on('filter', () => { library.render(); updateChrome(); els.scroller.scrollTop = 0; if (narrow.matches) root.dataset.sidebarOverlay = 'off'; });
on('selection', updateChrome);
on('edits', updateChrome);
on('rendered', updateChrome);
on('lookup', lookup);
on('pick-cover', pickCover);
on('paste-cover', pasteCover);
on('export-cover', exportCover);
on('set-cover', ({ blob, source }) => setCover(blob, source));
on('open-book', () => {
  if (narrow.matches) root.dataset.inspectorOverlay = 'on';
  else if (!settings.inspector) togglePanel('inspector');
  inspector.focusField('title');
});

const inText = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (document.querySelector('.menu')) { closeMenu(); return; }
    if (closeTopSheet()) { e.preventDefault(); return; }
    if (narrow.matches && (root.dataset.inspectorOverlay === 'on' || root.dataset.sidebarOverlay === 'on')) { root.dataset.inspectorOverlay = 'off'; root.dataset.sidebarOverlay = 'off'; return; }
  }
  if (sheetOpen()) return;
  if (mod(e)) {
    if (k === 's' && e.ctrlKey && e.metaKey) { e.preventDefault(); togglePanel('sidebar'); return; }
    if (k === 's' && !e.shiftKey) { e.preventDefault(); save(); return; }
    if (k === 'o') { e.preventDefault(); if (e.shiftKey) openFiles(); else openFolder(); return; }
    if (k === 'k') { e.preventDefault(); lookup(); return; }
    if (k === 'f') { e.preventDefault(); els.search.focus(); els.search.select(); return; }
    if (k === 'i') { e.preventDefault(); togglePanel('inspector'); return; }
    if (k === '1' || k === '2') { e.preventDefault(); setSetting('view', k === '1' ? 'grid' : 'list'); library.render(); updateChrome(); return; }
    if (inText(document.activeElement)) return;
    if (k === 'a') { e.preventDefault(); const ids = library.visibleOrder(); library.select(ids, { anchor: ids[0], focus: ids.at(-1), scroll: false }); return; }
    if (k === 'z') {
      e.preventDefault();
      const label = e.shiftKey ? redo() : undo();
      if (label) toast(`${e.shiftKey ? 'Wiederholt' : 'Widerrufen'}: ${label.replace(/^Tippen /, '')}`, { timeout: 1600 });
      return;
    }
    return;
  }
  if (inText(document.activeElement)) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    if (library.moveSelection(e.key, e)) { e.preventDefault(); els.scroller.focus({ preventScroll: true }); }
  } else if (e.key === 'Enter' && state.selection.size) {
    e.preventDefault();
    emit('open-book');
  }
});

// Bild einfügen, wenn kein Textfeld aktiv ist
document.addEventListener('paste', (e) => {
  if (inText(document.activeElement) || sheetOpen()) return;
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (file) { e.preventDefault(); setCover(file, 'Zwischenablage'); }
});

/* ------------------------------------------------------------ Drag & Drop */

const overlay = $('#drop-overlay');
let dragDepth = 0;
const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
const isImageOnly = (e) => {
  const items = [...(e.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file');
  return items.length > 0 && items.every((i) => i.type.startsWith('image/'));
};
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e) || isImageOnly(e) || sheetOpen()) return;
  e.preventDefault();
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  if (isImageOnly(e)) {
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file && state.selection.size) setCover(file, 'Datei');
    return;
  }
  const run = captureDrop(e.dataTransfer);
  openListing(run());
});

window.addEventListener('beforeunload', (e) => {
  if (dirtyBooks().length) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------------------------------------------------------------- Start */

applyTheme();
applyPanels();
updateChrome();
renderWelcome();
inspector.render();
if (new URLSearchParams(location.search).has('demo')) openDemo();

// Für Tests im Browser
window.kolophon = { state, settings, openListing, openDemo, save, value, apply };
