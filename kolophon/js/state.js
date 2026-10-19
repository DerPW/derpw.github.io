// Zustand: Bücher, Auswahl, ausstehende Änderungen, Verlauf, Filter und Einstellungen.
import { normalizeField, sameValue, yearOf, LIST_FIELDS } from './epub/text.js';

const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
export function emit(event, data) {
  for (const fn of listeners.get(event) ?? []) fn(data);
}

/* ------------------------------------------------------- Einstellungen */

const SETTINGS_KEY = 'kolophon.settings';
const DEFAULTS = {
  theme: 'system',
  view: 'grid',
  sort: 'title',
  sortDir: 1,
  sidebar: true,
  inspector: true,
  sources: { apple: true, openlibrary: true, dnb: true, google: true },
  country: (navigator.language || 'de').split('-')[1]?.toLowerCase() || 'de',
  googleKey: '',
  coverMax: 1600,
  autoSort: true,
  onlyEmpty: true,
  autoFields: ['cover', 'description', 'publisher', 'date', 'isbn', 'language', 'subjects', 'series', 'identity'],
  gridSize: 150,
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULTS, ...s, sources: { ...DEFAULTS.sources, ...(s.sources ?? {}) } };
  } catch { return { ...DEFAULTS }; }
}

export const settings = loadSettings();
export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* privat */ }
  emit('settings', key);
}

/* ---------------------------------------------------------------- Bücher */

export const state = {
  source: null,
  books: [],
  byId: new Map(),
  selection: new Set(),
  anchor: null,
  focus: null,
  filter: { kind: 'all', value: null },
  search: '',
  loading: null,
};

let nextId = 1;

export function setBooks(source, entries) {
  for (const b of state.books) {
    if (b.thumb?.url) URL.revokeObjectURL(b.thumb.url);
    if (b.newCover?.url) URL.revokeObjectURL(b.newCover.url);
  }
  state.source = source;
  state.books = entries.map((e) => ({
    id: nextId++, ...e, status: 'pending', info: null, meta: null, edits: {}, newCover: null, thumb: null, error: null,
  }));
  state.byId = new Map(state.books.map((b) => [b.id, b]));
  state.selection.clear();
  state.anchor = state.focus = null;
  state.filter = { kind: 'all', value: null };
  history.length = 0;
  future.length = 0;
  emit('books');
}

export const getBook = (id) => state.byId.get(id);

export function value(book, field) {
  if (!book.meta) return LIST_FIELDS.has(field) ? [] : '';
  return Object.prototype.hasOwnProperty.call(book.edits, field) ? book.edits[field] : book.meta[field];
}

export const isDirty = (book) => Object.keys(book.edits).length > 0 || Boolean(book.newCover);
export const dirtyBooks = () => state.books.filter(isDirty);
export const isFieldDirty = (book, field) => (field === 'cover' ? Boolean(book.newCover) : Object.prototype.hasOwnProperty.call(book.edits, field));

/** Kurzform für Anzeige und Suche */
export function display(book) {
  const authors = value(book, 'authors');
  return {
    title: value(book, 'title') || book.name.replace(/\.epub$/i, ''),
    author: authors.join(', '),
    series: value(book, 'series'),
    seriesIndex: value(book, 'seriesIndex'),
    year: yearOf(value(book, 'date')),
  };
}

/* ------------------------------------------------------------ Änderungen */

const history = [];
const future = [];

function setRaw(book, field, v) {
  if (field === 'cover') {
    book.newCover = v;
    return;
  }
  if (sameValue(field, v, book.meta[field])) delete book.edits[field];
  else book.edits[field] = normalizeField(field, v);
}

/**
 * Änderungen anwenden. patch: [{ id, field, value }]. Bildet einen Schritt im Verlauf.
 */
export function apply(patch, label = 'Änderung') {
  const step = [];
  for (const { id, field, value: v } of patch) {
    const book = getBook(id);
    if (!book?.meta) continue;
    const before = field === 'cover' ? book.newCover : (Object.prototype.hasOwnProperty.call(book.edits, field) ? book.edits[field] : undefined);
    const prevValue = field === 'cover' ? null : value(book, field);
    if (field !== 'cover' && sameValue(field, prevValue, v)) continue;
    setRaw(book, field, v);
    step.push({ id, field, before, after: field === 'cover' ? book.newCover : book.edits[field] });
  }
  if (!step.length) return false;
  const last = history.at(-1);
  // Tippen in einem Feld zu einem Schritt zusammenfassen
  if (last && last.coalesce && label === last.label && Date.now() - last.time < 1200 && sameTargets(last.step, step)) {
    for (const s of step) {
      const old = last.step.find((x) => x.id === s.id && x.field === s.field);
      old.after = s.after;
    }
    last.time = Date.now();
  } else {
    history.push({ step, label, time: Date.now(), coalesce: label.startsWith('Tippen') });
    if (history.length > 300) history.shift();
  }
  future.length = 0;
  emit('edits', { ids: new Set(step.map((s) => s.id)), fields: new Set(step.map((s) => s.field)) });
  return true;
}

function sameTargets(a, b) {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.field === b[i].field);
}

function restore(entries, key) {
  for (const s of entries) {
    const book = getBook(s.id);
    if (!book) continue;
    const v = s[key];
    if (s.field === 'cover') book.newCover = v ?? null;
    else if (v === undefined) delete book.edits[s.field];
    else book.edits[s.field] = v;
  }
  emit('edits', { ids: new Set(entries.map((s) => s.id)), fields: new Set(entries.map((s) => s.field)) });
}

export function undo() {
  const h = history.pop();
  if (!h) return null;
  restore(h.step, 'before');
  future.push(h);
  return h.label;
}

export function redo() {
  const h = future.pop();
  if (!h) return null;
  restore(h.step, 'after');
  history.push(h);
  return h.label;
}

export const canUndo = () => history.length > 0;
export const canRedo = () => future.length > 0;

export function revert(ids, fields = null) {
  const patch = [];
  for (const id of ids) {
    const b = getBook(id);
    if (!b) continue;
    for (const f of fields ?? [...Object.keys(b.edits), ...(b.newCover ? ['cover'] : [])]) {
      if (f === 'cover') { if (b.newCover) patch.push({ id, field: 'cover', value: null }); }
      else if (f in b.edits) patch.push({ id, field: f, value: b.meta[f] });
    }
  }
  return apply(patch, 'Zurücksetzen');
}

/** Nach dem Sichern: neuer Ausgangsstand, Verlauf für dieses Buch verwerfen. */
export function commitSaved(book, info) {
  book.info = info;
  book.meta = info.meta;
  book.edits = {};
  if (book.newCover?.url) URL.revokeObjectURL(book.newCover.url);
  book.newCover = null;
  for (const list of [history, future]) {
    for (let i = list.length - 1; i >= 0; i--) {
      list[i].step = list[i].step.filter((s) => s.id !== book.id);
      if (!list[i].step.length) list.splice(i, 1);
    }
  }
}

/* --------------------------------------------------- Filter und Sortierung */

export const SMART = [
  { kind: 'all', label: 'Alle Bücher', icon: 'books' },
  { kind: 'dirty', label: 'Ungesichert', icon: 'clock', test: isDirty },
];
export const MISSING = [
  { kind: 'no-cover', label: 'Ohne Cover', icon: 'photo', test: (b) => !b.info?.cover && !b.newCover },
  { kind: 'no-author', label: 'Ohne Autor', icon: 'person', test: (b) => !value(b, 'authors').length },
  { kind: 'no-description', label: 'Ohne Beschreibung', icon: 'textQuote', test: (b) => !value(b, 'description') },
  { kind: 'no-isbn', label: 'Ohne ISBN', icon: 'tag', test: (b) => !value(b, 'isbn') },
  { kind: 'errors', label: 'Fehler', icon: 'alert', test: (b) => b.status === 'error', hideEmpty: true },
];

export function filterTest(filter) {
  const smart = [...SMART, ...MISSING].find((f) => f.kind === filter.kind);
  if (smart) return smart.test ?? (() => true);
  if (filter.kind === 'series') return (b) => value(b, 'series') === filter.value;
  if (filter.kind === 'author') return (b) => value(b, 'authors').includes(filter.value);
  return () => true;
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const stripArticle = (s) => s.replace(/^(der|die|das|the|a|an|le|la|les|el|ein|eine)\s+/i, '');

export const SORTS = {
  title: { label: 'Titel', key: (b) => stripArticle(value(b, 'titleSort') || display(b).title) },
  author: { label: 'Autor', key: (b) => value(b, 'authorSort') || (value(b, 'authors')[0] ?? '').split(' ').reverse().join(' ') || '￿', then: 'series' },
  series: { label: 'Reihe', key: (b) => value(b, 'series') || '￿', then: 'seriesIndex' },
  year: { label: 'Erscheinungsjahr', key: (b) => yearOf(value(b, 'date')) || '9999' },
  publisher: { label: 'Verlag', key: (b) => value(b, 'publisher') || '￿' },
  file: { label: 'Dateiname', key: (b) => b.path },
  modified: { label: 'Zuletzt geändert', key: (b) => String(1e13 - (b.lastModified ?? 0)).padStart(14, '0') },
};

export function visibleBooks() {
  const test = filterTest(state.filter);
  const q = state.search.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  let list = state.books.filter((b) => {
    if (b.status === 'pending') return state.filter.kind === 'all' && !terms.length;
    if (!test(b)) return false;
    if (!terms.length) return true;
    const hay = [
      display(b).title, ...value(b, 'authors'), value(b, 'series'), value(b, 'publisher'), value(b, 'isbn'),
      ...value(b, 'subjects'), b.path, yearOf(value(b, 'date')),
    ].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const sort = SORTS[settings.sort] ?? SORTS.title;
  const dir = settings.sortDir;
  const decorated = list.map((b) => ({ b, k: sort.key(b), t: sort.then === 'seriesIndex' ? Number(value(b, 'seriesIndex')) || 0 : sort.then === 'series' ? `${value(b, 'series')}\u0000${String(Number(value(b, 'seriesIndex')) || 0).padStart(6, '0')}` : '' }));
  decorated.sort((x, y) => (collator.compare(x.k, y.k) || (typeof x.t === 'number' ? x.t - y.t : collator.compare(x.t, y.t)) || collator.compare(x.b.path, y.b.path)) * dir);
  list = decorated.map((d) => d.b);
  return list;
}

export function groups() {
  const series = new Map();
  const authors = new Map();
  for (const b of state.books) {
    if (!b.meta) continue;
    const s = value(b, 'series');
    if (s) series.set(s, (series.get(s) ?? 0) + 1);
    for (const a of value(b, 'authors')) authors.set(a, (authors.get(a) ?? 0) + 1);
  }
  const sorted = (m) => [...m.entries()].sort((a, b) => collator.compare(a[0], b[0]));
  return { series: sorted(series), authors: sorted(authors) };
}

