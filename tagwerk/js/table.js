// Virtualisierte Dateiliste mit Sortierung, Mehrfachauswahl und Kontextmenü.
import { loadThumb, readyThumb } from './covers.js';
import { COLUMNS, formatDuration } from './fields.js';
import {
  displayPath, emit, isDirty, isFieldDirty, on, pendingCover, select, selectRange, setSort, state, toggleSelect, value,
} from './state.js';
import { esc, icon } from './ui.js';

const ROW_H = 42;
const OVERSCAN = 8;

let head, body, spacer, layer;
let columns = COLUMNS;
const rows = new Map(); // index -> element
let dragging = null;

export function initTable() {
  head = document.getElementById('table-head');
  body = document.getElementById('table-body');
  spacer = document.getElementById('table-spacer');
  layer = document.createElement('div');
  layer.className = 'table-rows';
  body.appendChild(layer);

  new ResizeObserver(() => { updateColumns(); render(true); }).observe(body);
  body.addEventListener('scroll', () => render(), { passive: true });

  head.addEventListener('click', (e) => {
    const col = e.target.closest('[data-sort]');
    if (col) setSort(col.dataset.sort);
  });

  body.addEventListener('mousedown', onMouseDown);
  body.addEventListener('mouseover', (e) => {
    if (!dragging) return;
    const row = e.target.closest('.row');
    if (row && row.dataset.id !== dragging.last) {
      dragging.last = row.dataset.id;
      selectRange(dragging.anchor, +row.dataset.id, dragging.additive);
    }
  });
  addEventListener('mouseup', () => { dragging = null; });
  body.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.cell');
    if (cell?.dataset.field) emit('focus-field', cell.dataset.field);
  });
  body.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    emit('row-menu', { x: e.clientX, y: e.clientY });
  });

  on('view', () => render(true));
  on('pending', () => render(true));
  on('selection', () => render());
  on('files', () => { body.scrollTop = 0; render(true); });
  on('playing', () => render(true));
  updateColumns();
}

function onMouseDown(e) {
  const row = e.target.closest('.row');
  if (!row || e.button > 2) return;
  const id = +row.dataset.id;
  body.focus({ preventScroll: true });
  if (e.button === 2) {
    if (!state.selection.has(id)) select([id], { anchor: id, focus: id });
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (e.shiftKey && state.anchor != null) selectRange(state.anchor, id, mod);
  else if (mod) toggleSelect(id);
  else {
    if (!(state.selection.has(id) && state.selection.size === 1)) select([id], { anchor: id, focus: id });
    else state.focus = id;
    dragging = { anchor: id, additive: false, last: String(id) };
  }
}

function updateColumns() {
  const width = body.clientWidth || 1200;
  columns = COLUMNS.filter((c) => !c.min || width >= c.min);
  const template = columns.map((c) => c.width).join(' ');
  document.getElementById('library').style.setProperty('--cols', template);
  renderHead();
}

function renderHead() {
  const { key, dir } = state.sort;
  head.innerHTML = columns.map((c) => {
    if (c.key === 'cover') return '<div class="th"></div>';
    const active = key === c.key;
    return `<button class="th ${c.align === 'end' ? 'end' : ''} ${active ? 'active' : ''}" data-sort="${c.key}">
      <span>${esc(c.label)}</span>${active ? icon(dir === 1 ? 'chevronUp' : 'chevronDown', 'sort-ico') : ''}
    </button>`;
  }).join('');
}

function cellHTML(file, col) {
  switch (col.key) {
    case 'cover': {
      const playing = state.playing === file.id;
      return `<div class="cell c-cover"><div class="thumb">${icon('music')}<img alt="" draggable="false">${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}</div></div>`;
    }
    case 'track': {
      const t = value(file, 'track');
      return `<div class="cell c-track end ${isFieldDirty(file, 'track') ? 'dirty' : ''}" data-field="track">${esc(t)}</div>`;
    }
    case 'duration':
      return `<div class="cell end muted tabular">${formatDuration(file.info?.duration)}</div>`;
    case 'name': {
      const renamed = state.pending.get(file.id)?.rename;
      const name = (renamed ?? file.path).split('/').pop();
      return `<div class="cell c-name ${renamed ? 'dirty' : ''}" title="${esc(displayPath(file))}">${esc(name)}</div>`;
    }
    case 'format':
      return `<div class="cell"><span class="fmt fmt-${(file.format || 'x').toLowerCase()}">${esc(file.format || '?')}</span></div>`;
    case 'title': {
      const v = value(file, 'title');
      const err = file.error ? `<span class="row-err" title="${esc(file.error)}">${icon('alert')}</span>` : '';
      return `<div class="cell c-title ${isFieldDirty(file, 'title') ? 'dirty' : ''}" data-field="title">${err}${v ? esc(v) : `<span class="placeholder">${esc(file.name.replace(/\.[^.]+$/, ''))}</span>`}</div>`;
    }
    default: {
      const v = value(file, col.key);
      return `<div class="cell ${isFieldDirty(file, col.key) ? 'dirty' : ''} ${col.key === 'year' ? 'tabular' : ''}" data-field="${col.key}">${esc(v)}</div>`;
    }
  }
}

function fillThumb(row, file) {
  const img = row.querySelector('img');
  const thumb = row.querySelector('.thumb');
  if (!img) return;
  const pc = pendingCover(file);
  if (pc === null) { thumb.classList.remove('has-img'); return; }
  if (pc) { img.src = pc.url; thumb.classList.add('has-img'); return; }
  if (!file.hasCover) return;
  const cached = readyThumb(file);
  if (cached) { img.src = cached; thumb.classList.add('has-img', 'instant'); return; }
  loadThumb(file).then((url) => {
    if (!url || row.dataset.id !== String(file.id) || !row.isConnected) return;
    img.onload = () => thumb.classList.add('has-img');
    img.src = url;
  });
}

function render(force = false) {
  if (!body) return;
  const list = state.view;
  spacer.style.height = `${list.length * ROW_H + 12}px`;
  const top = body.scrollTop;
  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const end = Math.min(list.length, Math.ceil((top + body.clientHeight) / ROW_H) + OVERSCAN);

  for (const [i, el] of rows) {
    if (i < start || i >= end) { el.remove(); rows.delete(i); }
  }
  for (let i = start; i < end; i++) {
    const file = list[i];
    let el = rows.get(i);
    const sig = `${file.id}|${file.mtime}|${force ? Math.random() : ''}`;
    if (!el) {
      el = document.createElement('div');
      el.className = 'row';
      rows.set(i, el);
      layer.appendChild(el);
    }
    if (el.dataset.sig !== sig || force) {
      el.dataset.sig = sig;
      el.dataset.id = file.id;
      el.style.transform = `translateY(${i * ROW_H + 6}px)`;
      el.innerHTML = columns.map((c) => cellHTML(file, c)).join('');
      fillThumb(el, file);
    }
    el.classList.toggle('selected', state.selection.has(file.id));
    el.classList.toggle('focused', state.focus === file.id && state.selection.size > 1);
    el.classList.toggle('dirty', isDirty(file));
    el.classList.toggle('odd', i % 2 === 1);
  }
}

export function scrollToFile(id) {
  const i = state.view.findIndex((f) => f.id === id);
  if (i < 0) return;
  const y = i * ROW_H + 6;
  if (y < body.scrollTop) body.scrollTop = y - 6;
  else if (y + ROW_H > body.scrollTop + body.clientHeight) body.scrollTop = y + ROW_H - body.clientHeight + 6;
}

export const ROW_HEIGHT = ROW_H;
