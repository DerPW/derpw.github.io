// Bibliothek: Seitenleiste, Raster und Liste, Auswahl, Vorschaubilder.
import { h, icon, plural, mod } from './ui.js';
import {
  state, settings, setSetting, emit, on, visibleBooks, display, value, isDirty, groups, SMART, MISSING, filterTest, SORTS,
} from './state.js';
import { thumbnail, placeholderStyle } from './covers.js';
import { getFile } from './fs.js';
import { readEntry } from './epub/zip.js';
import { languageName } from './langs.js';

const lib = document.getElementById('library');
const scroller = document.getElementById('scroller');
const nav = document.getElementById('sidebar-nav');

let order = [];
const nodes = new Map();

/* --------------------------------------------------------- Vorschaubilder */

const queue = [];
let running = 0;
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    const book = state.byId.get(Number(e.target.dataset.id));
    if (book && !book.thumb && book.info?.cover && !book.thumbLoading) enqueue(book);
  }
}, { root: scroller, rootMargin: '600px 0px' });

function enqueue(book) {
  book.thumbLoading = true;
  queue.push(book);
  pump();
}

function pump() {
  while (running < 4 && queue.length) {
    const book = queue.shift();
    running++;
    loadThumb(book).finally(() => { running--; book.thumbLoading = false; pump(); });
  }
}

export async function coverBlob(book) {
  if (!book.info?.cover) return null;
  const file = await getFile(book);
  const entry = book.info.coverEntry;
  const data = await readEntry(file, entry);
  return new Blob([data], { type: book.info.cover.mime || 'image/jpeg' });
}

async function loadThumb(book) {
  try {
    const key = `${book.path}|${book.size}|${book.lastModified}|${book.info.cover.path}`;
    const t = await thumbnail(key, () => coverBlob(book));
    if (!t) return;
    book.thumb = t;
    updateBook(book.id);
    emit('thumb', book.id);
  } catch {
    book.thumb = { url: null, failed: true };
  }
}

/** Liefert die Cover-URL für die Anzeige (neues Cover vor Vorschaubild). */
export function coverURL(book) {
  return book.newCover?.url ?? book.thumb?.url ?? null;
}

export function coverNode(book, cls = 'cover') {
  const url = coverURL(book);
  if (book.status === 'pending') return h('div.skeleton');
  if (url) {
    const img = h(`img.${cls}`, { src: url, alt: '', draggable: false, decoding: 'async' });
    return img;
  }
  const d = display(book);
  return h('div.placeholder', { style: placeholderStyle(d.title, d.author), class: cls === 'cover' ? 'cover' : '' },
    h('div.ph-title', {}, d.title),
    h('div.ph-rule'),
    h('div.ph-author', {}, d.author));
}

/* ----------------------------------------------------------------- Raster */

function cardNode(book) {
  const d = display(book);
  const el = h('div.card', {
    dataset: { id: book.id }, role: 'option', 'aria-selected': String(state.selection.has(book.id)),
    class: [state.selection.has(book.id) ? 'selected' : '', book.status === 'error' ? 'card-error' : ''].join(' '),
    title: book.error ? `${book.path}\n${book.error}` : book.path,
  },
  h('div.cover-box', {},
    coverNode(book),
    book.status === 'error' ? h('span.card-badge', {}, 'Fehler') : null,
    d.series && d.seriesIndex ? h('span.card-badge.series', { title: d.series }, `#${d.seriesIndex}`) : null),
  h('div.card-text', {},
    h('div.card-title-wrap', {}, h('span.card-title', {}, isDirty(book) ? h('span.card-dot', { title: 'Ungesicherte Änderungen' }) : null, d.title)),
    h('div.card-author', {}, book.status === 'pending' ? '…' : d.author || ' ')));
  if (book.info?.cover && !book.thumb) io.observe(el);
  return el;
}

/* ------------------------------------------------------------------ Liste */

const COLUMNS = [
  { key: null, label: '' },
  { key: 'title', label: 'Titel' },
  { key: 'author', label: 'Autor' },
  { key: 'series', label: 'Reihe' },
  { key: 'year', label: 'Jahr' },
  { key: 'publisher', label: 'Verlag' },
  { key: null, label: 'Sprache' },
  { key: 'file', label: 'Datei' },
];

function listHead() {
  return h('div.list-head', { role: 'row' }, COLUMNS.map((c) => (c.key
    ? h('button', {
      class: settings.sort === c.key ? 'sorted' : '',
      onclick: () => { if (settings.sort === c.key) setSetting('sortDir', -settings.sortDir); else { setSetting('sort', c.key); setSetting('sortDir', 1); } render(); },
    }, c.label, settings.sort === c.key ? h('span', { html: icon('chevronDown'), style: { display: 'inline-flex', transform: settings.sortDir > 0 ? '' : 'rotate(180deg)' } }) : null)
    : h('span', {}, c.label))));
}

function rowNode(book) {
  const d = display(book);
  const series = d.series ? `${d.series}${d.seriesIndex ? ` ${d.seriesIndex}` : ''}` : '';
  const el = h('div.row', {
    dataset: { id: book.id }, role: 'row', class: state.selection.has(book.id) ? 'selected' : '', title: book.error ?? '',
  },
  h('span.thumb', {}, coverNode(book, 'thumb-img')),
  h('span.r-title', {}, isDirty(book) ? h('span.card-dot') : null, d.title),
  h('span.r-dim', {}, d.author),
  h('span.r-dim', {}, series),
  h('span.r-num', {}, d.year),
  h('span.r-dim', {}, book.meta ? value(book, 'publisher') : ''),
  h('span.r-dim', {}, book.meta ? value(book, 'language').map(languageName).join(', ') : ''),
  h('span.r-dim', { title: book.path }, book.path));
  if (book.info?.cover && !book.thumb) io.observe(el);
  return el;
}

/* ---------------------------------------------------------------- Rendern */

export function render() {
  const list = state.loading ? state.books.filter((b) => filterTest(state.filter)(b) || b.status === 'pending') : visibleBooks();
  order = list.map((b) => b.id);
  nodes.clear();
  io.disconnect();
  const mode = settings.view;
  lib.className = `library ${mode}`;
  document.getElementById('content').classList.toggle('list-mode', mode === 'list');
  lib.style.setProperty('--card-w', `${settings.gridSize}px`);
  lib.setAttribute('role', mode === 'grid' ? 'listbox' : 'grid');
  lib.setAttribute('aria-multiselectable', 'true');
  const frag = document.createDocumentFragment();
  if (mode === 'list' && list.length) frag.append(listHead());
  for (const b of list) {
    const n = mode === 'grid' ? cardNode(b) : rowNode(b);
    nodes.set(b.id, n);
    frag.append(n);
  }
  lib.replaceChildren(frag);
  renderEmpty(list.length);
  renderSidebar();
  emit('rendered');
}

function renderEmpty(count) {
  const empty = document.getElementById('empty');
  const show = state.books.length > 0 && count === 0;
  empty.hidden = !show;
  if (!show) return;
  const searching = Boolean(state.search.trim());
  empty.replaceChildren(
    h('div.empty-icon', { html: icon(searching ? 'search' : 'checkCircle') }),
    h('h3', {}, searching ? 'Keine Treffer' : 'Nichts zu tun'),
    h('p', {}, searching ? `Kein Buch passt zu „${state.search.trim()}“.` : 'In dieser Ansicht ist gerade kein Buch.'));
}

export function updateBook(id) {
  const old = nodes.get(id);
  const book = state.byId.get(id);
  if (!old || !book) return;
  const n = settings.view === 'grid' ? cardNode(book) : rowNode(book);
  old.replaceWith(n);
  nodes.set(id, n);
}

export function updateSelection() {
  for (const [id, n] of nodes) {
    const sel = state.selection.has(id);
    n.classList.toggle('selected', sel);
    n.setAttribute('aria-selected', String(sel));
  }
}

export const visibleOrder = () => order;

/* --------------------------------------------------------------- Auswahl */

export function select(ids, { anchor, focus, scroll = true } = {}) {
  state.selection = new Set(ids);
  if (anchor !== undefined) state.anchor = anchor;
  if (focus !== undefined) state.focus = focus;
  updateSelection();
  if (scroll && state.focus != null) nodes.get(state.focus)?.scrollIntoView({ block: 'nearest' });
  emit('selection');
}

function clickSelect(id, e) {
  if (e.shiftKey && state.anchor != null) {
    const a = order.indexOf(state.anchor);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [s, t] = a < b ? [a, b] : [b, a];
      const range = order.slice(s, t + 1);
      select(mod(e) ? [...state.selection, ...range] : range, { focus: id, scroll: false });
      return;
    }
  }
  if (mod(e)) {
    const next = new Set(state.selection);
    if (next.has(id)) next.delete(id); else next.add(id);
    select(next, { anchor: id, focus: id, scroll: false });
    return;
  }
  select([id], { anchor: id, focus: id, scroll: false });
}

lib.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const el = e.target.closest('[data-id]');
  if (!el) return;
  clickSelect(Number(el.dataset.id), e);
});
lib.addEventListener('dblclick', (e) => {
  const el = e.target.closest('[data-id]');
  if (el) emit('open-book', Number(el.dataset.id));
});
scroller.addEventListener('pointerdown', (e) => {
  if (e.button === 0 && !e.target.closest('[data-id], .list-head, button, input') && !mod(e) && !e.shiftKey) select([], { scroll: false });
});
lib.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-id]');
  if (!el) return;
  e.preventDefault();
  const id = Number(el.dataset.id);
  if (!state.selection.has(id)) select([id], { anchor: id, focus: id, scroll: false });
  emit('context-menu', { x: e.clientX, y: e.clientY });
});
scroller.addEventListener('scroll', () => {
  document.getElementById('content').classList.toggle('scrolled', scroller.scrollTop > 4);
}, { passive: true });

function columnsPerRow() {
  if (settings.view !== 'grid') return 1;
  const first = nodes.get(order[0]);
  if (!first) return 1;
  const top = first.offsetTop;
  let n = 0;
  for (const id of order) { if (nodes.get(id).offsetTop !== top) break; n++; }
  return Math.max(1, n);
}

export function moveSelection(key, e) {
  if (!order.length) return false;
  const cols = columnsPerRow();
  const cur = order.indexOf(state.focus ?? -1);
  let next;
  if (cur < 0) next = 0;
  else if (key === 'ArrowRight') next = cur + 1;
  else if (key === 'ArrowLeft') next = cur - 1;
  else if (key === 'ArrowDown') next = cur + cols;
  else if (key === 'ArrowUp') next = cur - cols;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = order.length - 1;
  else return false;
  if (settings.view === 'list' && (key === 'ArrowLeft' || key === 'ArrowRight')) return false;
  next = Math.max(0, Math.min(order.length - 1, next));
  const id = order[next];
  if (e.shiftKey && state.anchor != null) {
    const a = order.indexOf(state.anchor);
    const [s, t] = a < next ? [a, next] : [next, a];
    select(order.slice(s, t + 1), { focus: id });
  } else {
    select([id], { anchor: id, focus: id });
  }
  return true;
}

/* ---------------------------------------------------------- Seitenleiste */

const collapsed = new Set(JSON.parse(localStorage.getItem('kolophon.collapsed') || '["authors"]'));

function navItem({ kind, value: v = null, label, iconName, count, cls = '' }) {
  const active = state.filter.kind === kind && state.filter.value === v;
  return h('button.nav-item', {
    class: [active ? 'active' : '', cls].join(' '),
    onclick: () => { state.filter = { kind, value: v }; emit('filter'); },
    title: label,
  }, h('span', { html: icon(iconName) }), h('span.nav-label', {}, label), count != null ? h('span.nav-count', {}, count.toLocaleString('de-DE')) : null);
}

function section(id, title, items, { limit } = {}) {
  const isCollapsed = collapsed.has(id);
  const sec = h('div.nav-section', { class: isCollapsed ? 'collapsed' : '' },
    h('button.nav-header', {
      onclick: () => {
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        localStorage.setItem('kolophon.collapsed', JSON.stringify([...collapsed]));
        renderSidebar();
      },
    }, title, h('span.chev', { html: icon('chevronDown', 'small') })),
    h('div.nav-items', {}, limit && items.length > limit && !expanded.has(id)
      ? [...items.slice(0, limit), h('button.nav-item.nav-more', { onclick: () => { expanded.add(id); renderSidebar(); } }, h('span', { html: icon('ellipsis') }), h('span.nav-label', {}, `${items.length - limit} weitere`))]
      : items));
  return sec;
}
const expanded = new Set();

export function renderSidebar() {
  if (!state.books.length) { nav.replaceChildren(); return; }
  const ready = state.books.filter((b) => b.meta);
  const lib1 = SMART.map((f) => navItem({ kind: f.kind, label: f.label, iconName: f.icon, count: f.kind === 'all' ? state.books.length : ready.filter(f.test).length, cls: f.kind === 'dirty' && !ready.some(f.test) ? 'dim' : '' }));
  const missing = MISSING.map((f) => {
    const n = state.books.filter(f.test).length;
    if (f.hideEmpty && !n) return null;
    return navItem({ kind: f.kind, label: f.label, iconName: f.icon, count: n, cls: f.kind === 'errors' ? 'err' : n ? 'warn' : 'dim' });
  }).filter(Boolean);
  const g = groups();
  const out = [section('library', 'Bibliothek', lib1), section('missing', 'Fehlende Angaben', missing)];
  if (g.series.length) out.push(section('series', 'Reihen', g.series.map(([name, n]) => navItem({ kind: 'series', value: name, label: name, iconName: 'stack', count: n })), { limit: 12 }));
  if (g.authors.length) out.push(section('authors', 'Autoren', g.authors.map(([name, n]) => navItem({ kind: 'author', value: name, label: name, iconName: 'person', count: n })), { limit: 12 }));
  nav.replaceChildren(...out);
}

/* ---------------------------------------------------------------- Titel */

export function filterLabel() {
  const f = state.filter;
  if (f.kind === 'series' || f.kind === 'author') return f.value;
  return [...SMART, ...MISSING].find((x) => x.kind === f.kind)?.label ?? 'Bibliothek';
}

export function statusText() {
  const n = order.length;
  const sel = state.selection.size;
  const parts = [plural(n, 'Buch', 'Bücher')];
  if (sel) parts.push(`${sel.toLocaleString('de-DE')} ausgewählt`);
  return parts.join(', ');
}

export function sortMenuItems(rerender) {
  return [
    { header: 'Sortieren nach' },
    ...Object.entries(SORTS).map(([key, s]) => ({ label: s.label, checked: settings.sort === key, run: () => { setSetting('sort', key); rerender(); } })),
    '-',
    { label: 'Aufsteigend', checked: settings.sortDir > 0, run: () => { setSetting('sortDir', 1); rerender(); } },
    { label: 'Absteigend', checked: settings.sortDir < 0, run: () => { setSetting('sortDir', -1); rerender(); } },
  ];
}

on('edits', ({ ids }) => {
  for (const id of ids) updateBook(id);
  renderSidebar();
});

