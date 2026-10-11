// Zentraler Zustand: Dateien, ausstehende Änderungen, Auswahl, Ansicht, Verlauf.
import { FIELD_KEYS, TEXT_FIELDS } from './fields.js';

const listeners = {};
export const on = (evt, fn) => (listeners[evt] ??= new Set()).add(fn);
export const emit = (evt, data) => listeners[evt]?.forEach((fn) => fn(data));

export const state = {
  source: null,           // { mode: 'fsa' | 'download', name, root, canWrite }
  files: [],
  byId: new Map(),
  pending: new Map(),     // id -> { tags: {feld: wert}, cover?: {mime,data,url} | null, rename?: 'neuer/pfad.mp3' }
  selection: new Set(),
  anchor: null,
  focus: null,
  sort: { key: 'default', dir: 1 },
  filter: '',
  view: [],
  playing: null,
};

/* ---------------------------------------------------------------- Werte */

export function value(file, key) {
  const p = state.pending.get(file.id);
  return p && key in p.tags ? p.tags[key] : (file.tags[key] ?? '');
}
export const isDirty = (file) => state.pending.has(file.id);
export const isFieldDirty = (file, key) => key in (state.pending.get(file.id)?.tags ?? {});
export const pendingCover = (file) => state.pending.get(file.id)?.cover;
export const displayPath = (file) => state.pending.get(file.id)?.rename ?? file.path;

export function effectiveTags(file) {
  const tags = {};
  for (const k of FIELD_KEYS) tags[k] = value(file, k);
  return tags;
}

/* -------------------------------------------------------------- Verlauf */

const undoStack = [];
const redoStack = [];

export function checkpoint() {
  undoStack.push(new Map(state.pending));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(new Map(state.pending));
  state.pending = undoStack.pop();
  emit('pending');
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(new Map(state.pending));
  state.pending = redoStack.pop();
  emit('pending');
  return true;
}
export function resetHistory() {
  undoStack.length = redoStack.length = 0;
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

/* ---------------------------------------------------------- Änderungen */

// Pending-Objekte werden nie verändert, sondern ersetzt – so reicht für den Verlauf eine flache Kopie der Map.
function commit(id, p) {
  if (!Object.keys(p.tags).length && p.cover === undefined && !p.rename) state.pending.delete(id);
  else state.pending.set(id, p);
}

function nextPending(id) {
  const p = state.pending.get(id);
  return p ? { ...p, tags: { ...p.tags } } : { tags: {} };
}

export function setTags(changes, { record = true } = {}) {
  if (record) checkpoint();
  for (const { id, tags } of changes) {
    const file = state.byId.get(id);
    if (!file) continue;
    const p = nextPending(id);
    for (const [k, v] of Object.entries(tags)) {
      const val = String(v ?? '');
      if (val === (file.tags[k] ?? '')) delete p.tags[k];
      else p.tags[k] = val;
    }
    commit(id, p);
  }
  emit('pending');
}

export function setCover(ids, cover, { record = true } = {}) {
  if (record) checkpoint();
  const entry = cover ? { ...cover, url: URL.createObjectURL(new Blob([cover.data], { type: cover.mime })) } : null;
  for (const id of ids) {
    const p = nextPending(id);
    const file = state.byId.get(id);
    p.cover = !entry && !file?.hasCover ? undefined : entry;
    commit(id, p);
  }
  emit('pending');
}

export function setRename(changes, { record = true } = {}) {
  if (record) checkpoint();
  for (const { id, path } of changes) {
    const file = state.byId.get(id);
    const p = nextPending(id);
    if (path === file.path) delete p.rename; else p.rename = path;
    commit(id, p);
  }
  emit('pending');
}

export function revert(ids, { fields, cover = false, record = true } = {}) {
  if (record) checkpoint();
  for (const id of ids) {
    if (!fields && !cover) { state.pending.delete(id); continue; }
    const p = nextPending(id);
    for (const f of fields ?? []) delete p.tags[f];
    if (cover) delete p.cover;
    commit(id, p);
  }
  emit('pending');
}

export function clearPending(id) {
  state.pending.delete(id);
}

/* -------------------------------------------------------------- Dateien */

export function setFiles(source, files) {
  state.source = source;
  state.files = files;
  state.byId = new Map(files.map((f) => [f.id, f]));
  state.pending = new Map();
  state.selection = new Set();
  state.anchor = state.focus = null;
  state.playing = null;
  undoStack.length = redoStack.length = 0;
  refreshView();
  emit('files');
  emit('pending');
  emit('selection');
}

export function updateFile(file, data) {
  Object.assign(file, data);
}

/* --------------------------------------------------------- Ansicht/Sort */

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const num = (v) => parseInt(v, 10) || 0;
const trackNo = (f) => parseInt(value(f, 'track'), 10) || 1e6; // ohne Nummer ans Ende

function compare(a, b, key) {
  switch (key) {
    case 'default':
      return collator.compare(a.dir, b.dir) || num(value(a, 'disc')) - num(value(b, 'disc'))
        || trackNo(a) - trackNo(b) || collator.compare(a.name, b.name);
    case 'track':
      return num(value(a, 'disc')) - num(value(b, 'disc')) || trackNo(a) - trackNo(b);
    case 'duration':
      return (a.info?.duration ?? 0) - (b.info?.duration ?? 0);
    case 'name':
      return collator.compare(displayPath(a), displayPath(b));
    case 'format':
      return collator.compare(a.format ?? '', b.format ?? '');
    default: {
      const va = value(a, key), vb = value(b, key);
      if (!va !== !vb) return va ? -1 : 1; // leere Werte immer ans Ende
      return collator.compare(va, vb);
    }
  }
}

function searchText(file) {
  return [displayPath(file), ...TEXT_FIELDS.map((k) => value(file, k)), value(file, 'year')].join('\n').toLowerCase();
}

export function refreshView() {
  const terms = state.filter.toLowerCase().split(/\s+/).filter(Boolean);
  let list = terms.length ? state.files.filter((f) => { const t = searchText(f); return terms.every((x) => t.includes(x)); }) : state.files.slice();
  const { key, dir } = state.sort;
  list.sort((a, b) => compare(a, b, key) * dir || (key !== 'default' ? compare(a, b, 'default') : 0));
  state.view = list;
  const visible = new Set(list.map((f) => f.id));
  let pruned = false;
  for (const id of state.selection) if (!visible.has(id)) { state.selection.delete(id); pruned = true; }
  emit('view');
  if (pruned) emit('selection');
}

export function setSort(key) {
  if (state.sort.key === key) {
    if (state.sort.dir === 1) state.sort.dir = -1;
    else state.sort = { key: 'default', dir: 1 };
  } else state.sort = { key, dir: 1 };
  refreshView();
}

export function setFilter(text) {
  state.filter = text;
  refreshView();
}

/* -------------------------------------------------------------- Auswahl */

export function select(ids, { anchor, focus } = {}) {
  state.selection = new Set(ids);
  if (anchor !== undefined) state.anchor = anchor;
  if (focus !== undefined) state.focus = focus;
  else if (!state.selection.has(state.focus)) state.focus = ids[ids.length - 1] ?? null;
  emit('selection');
}

export function selectRange(fromId, toId, additive = false) {
  const ids = state.view.map((f) => f.id);
  let a = ids.indexOf(fromId), b = ids.indexOf(toId);
  if (a < 0) a = b;
  const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  select(additive ? [...new Set([...state.selection, ...range])] : range, { focus: toId });
}

export function toggleSelect(id) {
  const next = new Set(state.selection);
  if (next.has(id)) next.delete(id); else next.add(id);
  select([...next], { anchor: id, focus: next.has(id) ? id : undefined });
}

export const selectedFiles = () => state.view.filter((f) => state.selection.has(f.id));
export const focusedFile = () => state.byId.get(state.focus) ?? selectedFiles()[0] ?? null;
export const dirtyFiles = () => state.files.filter((f) => state.pending.has(f.id));
