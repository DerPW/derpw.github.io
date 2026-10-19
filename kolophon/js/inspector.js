// Inspektor: Cover, Felder (einzeln und für mehrere Bücher), Datei-Informationen.
import { h, icon, formatBytes, plural, menu } from './ui.js';
import { state, settings, value, apply, emit, on, isFieldDirty, display, revert } from './state.js';
import { coverNode, coverURL, coverBlob } from './library.js';
import { languageName, parseLanguage, COMMON_LANGUAGES } from './langs.js';
import { isValidISBN, normalizeISBN, sortName, sameValue, LIST_FIELDS } from './epub/text.js';
import { placeholderStyle } from './covers.js';
import { renameMode } from './fs.js';
import { fileNameFor } from './lookup/sheet.js';

const root = document.getElementById('inspector');

const DEF = {
  title: { label: 'Titel', type: 'text', placeholder: 'Titel' },
  authors: { label: 'Autor:innen', type: 'tokens', placeholder: 'Name hinzufügen', split: /[;\n]/, suggest: () => collect('authors') },
  series: { label: 'Reihe', type: 'text', placeholder: 'Keine', suggest: () => collect('series') },
  seriesIndex: { label: 'Band', type: 'text', placeholder: '–', inputmode: 'decimal' },
  publisher: { label: 'Verlag', type: 'text', placeholder: 'Verlag', suggest: () => collect('publisher') },
  date: { label: 'Erschienen', type: 'text', placeholder: 'JJJJ-MM-TT' },
  language: { label: 'Sprache', type: 'tokens', placeholder: 'z. B. Deutsch', split: /[;,\n]/, format: languageName, parse: parseLanguage, suggest: () => [...new Set([...collect('language'), ...COMMON_LANGUAGES])], suggestLabel: languageName },
  isbn: { label: 'ISBN', type: 'isbn', placeholder: '978…' },
  description: { label: 'Beschreibung', type: 'textarea', placeholder: 'Klappentext' },
  subjects: { label: 'Schlagwörter', type: 'tokens', placeholder: 'Hinzufügen', split: /[;,\n]/, suggest: () => collect('subjects') },
  translators: { label: 'Übersetzung', type: 'tokens', placeholder: 'Name hinzufügen', split: /[;\n]/, suggest: () => collect('translators') },
  rights: { label: 'Rechte', type: 'text', placeholder: '© …' },
  titleSort: { label: 'Sortiertitel', type: 'text', placeholder: 'wie Titel' },
  authorSort: { label: 'Sortierautor', type: 'text', placeholder: 'Nachname, Vorname' },
};

const GROUPS = [
  { id: 'book', title: 'Buch', rows: [['title'], ['authors'], ['series', 'seriesIndex']] },
  { id: 'edition', title: 'Ausgabe', rows: [['publisher'], ['date', 'language'], ['isbn']] },
  { id: 'content', title: 'Inhalt', rows: [['description'], ['subjects']] },
  { id: 'more', title: 'Weitere Angaben', collapsible: true, rows: [['translators'], ['rights'], ['titleSort'], ['authorSort']] },
];

const collapsedGroups = new Set(JSON.parse(localStorage.getItem('kolophon.inspector.collapsed') || '["more"]'));

// Vorschläge einmal je Darstellung des Inspektors berechnen, nicht bei jedem Tastendruck
const collected = new Map();
function collect(field) {
  if (collected.has(field)) return collected.get(field);
  const out = new Map();
  for (const b of state.books) {
    if (!b.meta) continue;
    const v = value(b, field);
    for (const x of Array.isArray(v) ? v : [v]) if (x) out.set(x, (out.get(x) ?? 0) + 1);
  }
  const list = [...out.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  collected.set(field, list);
  return list;
}

const selectedBooks = () => [...state.selection].map((id) => state.byId.get(id)).filter((b) => b?.meta);

// Bücher, für die die gerade gezeichneten Felder gelten. Jedes Feld merkt sich diese Liste:
// Ein Eintrag, der erst beim Verlassen des Felds übernommen wird, landet so nie beim nächsten Buch.
let renderIds = [];

function common(books, field) {
  const first = value(books[0], field);
  const mixed = books.some((b) => !sameValue(field, value(b, field), first));
  return { value: mixed ? (LIST_FIELDS.has(field) ? [] : '') : first, mixed };
}

/* ---------------------------------------------------------------- Ändern */

let ownEdit = false;

function change(field, v, { typing = false, ids = renderIds } = {}) {
  const books = ids.map((id) => state.byId.get(id)).filter((b) => b?.meta);
  const patch = [];
  for (const b of books) {
    patch.push({ id: b.id, field, value: v });
    if (field === 'authors' && settings.autoSort) {
      const oldFirst = value(b, 'authors')[0] ?? '';
      const sort = value(b, 'authorSort');
      if (!sort || sort === sortName(oldFirst)) patch.push({ id: b.id, field: 'authorSort', value: v[0] ? sortName(v[0]) : '' });
    }
  }
  ownEdit = true;
  try { apply(patch, typing ? `Tippen ${field}` : DEF[field]?.label ?? field); } finally { ownEdit = false; }
  markDirty();
}

function markDirty() {
  const books = selectedBooks();
  for (const el of root.querySelectorAll('[data-field]')) {
    const f = el.dataset.field;
    el.classList.toggle('dirty', books.some((b) => isFieldDirty(b, f)));
  }
  updateHead();
}

/* ------------------------------------------------------------- Bausteine */

function fieldLabel(field, extra) {
  return h('div.field-label', {},
    h('span.dirty-dot'),
    h('span.lbl', {}, DEF[field].label),
    extra,
    h('button.revert', {
      title: 'Änderung verwerfen', html: icon('revert'),
      onclick: () => { revert([...state.selection], [field]); },
    }));
}

function autosize(t) {
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight + 2, 420)}px`;
  t.style.overflowY = t.scrollHeight > 420 ? 'auto' : 'hidden';
}

let suggestEl = null;
function closeSuggest() { suggestEl?.remove(); suggestEl = null; }

function attachSuggest(input, getItems, { label = (x) => x, onPick, exclude = () => [] }) {
  let items = [];
  let active = -1;
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const ex = new Set(exclude().map((x) => String(x).toLowerCase()));
    items = getItems().filter((x) => {
      const l = String(label(x)).toLowerCase();
      return !ex.has(String(x).toLowerCase()) && (q ? l.includes(q) || String(x).toLowerCase().startsWith(q) : true) && l !== q;
    }).slice(0, 8);
    closeSuggest();
    if (!items.length || (!q && document.activeElement !== input)) return;
    if (!q && !input.dataset.suggestEmpty) return;
    active = -1;
    suggestEl = h('div.suggest', {}, items.map((x, i) => h('button', {
      onpointerdown: (e) => { e.preventDefault(); onPick(x); closeSuggest(); },
      dataset: { i },
    }, h('span', {}, label(x)), label(x) !== x ? h('span.s-detail', {}, x) : null)));
    document.body.append(suggestEl);
    const r = input.getBoundingClientRect();
    suggestEl.style.left = `${r.left - 4}px`;
    suggestEl.style.top = `${r.bottom + 4}px`;
    suggestEl.style.minWidth = `${Math.max(180, r.width)}px`;
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', () => { if (input.dataset.suggestEmpty) show(); });
  input.addEventListener('blur', () => setTimeout(closeSuggest, 120));
  input.addEventListener('keydown', (e) => {
    if (!suggestEl) return;
    const buttons = [...suggestEl.querySelectorAll('button')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons.forEach((b, i) => b.classList.toggle('active', i === active));
    } else if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      onPick(items[active]);
      closeSuggest();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeSuggest();
    }
  });
}

function textField(field, { value: v, mixed }) {
  const d = DEF[field];
  const ids = renderIds;
  const tag = d.type === 'textarea' ? 'textarea' : 'input';
  const input = h(`${tag}.input`, {
    value: v ?? '', placeholder: mixed ? 'Verschiedene Werte' : d.placeholder ?? '', class: mixed ? 'mixed' : '',
    spellcheck: d.type === 'textarea' ? 'true' : 'false', autocomplete: 'off', inputmode: d.inputmode,
    dataset: { key: field }, rows: d.type === 'textarea' ? 3 : undefined, 'aria-label': d.label,
  });
  if (tag === 'textarea') {
    input.value = v ?? '';
    requestAnimationFrame(() => autosize(input));
  }
  input.addEventListener('input', () => {
    if (tag === 'textarea') autosize(input);
    change(field, input.value, { typing: true, ids });
    if (field === 'isbn') updateISBNState(input);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && tag === 'input') { e.preventDefault(); focusNext(input); }
    if (e.key === 'Escape') { e.preventDefault(); input.blur(); document.getElementById('scroller').focus(); }
  });
  if (d.suggest) attachSuggest(input, d.suggest, { onPick: (x) => { input.value = x; change(field, x, { ids }); } });
  if (field === 'isbn') {
    const wrap = h('div.input-wrap', {}, input, h('span.state'));
    updateISBNState(input, wrap);
    return wrap;
  }
  return input;
}

function updateISBNState(input, wrap = input.parentElement) {
  const st = wrap?.querySelector('.state');
  if (!st) return;
  const v = normalizeISBN(input.value);
  if (!v) { st.className = 'state'; st.innerHTML = ''; st.title = ''; return; }
  const ok = isValidISBN(v);
  st.className = `state ${ok ? 'ok' : 'bad'}`;
  st.innerHTML = icon(ok ? 'checkCircle' : 'alert');
  st.title = ok ? 'Gültige ISBN' : 'Prüfziffer passt nicht – Tippfehler?';
}

function tokenField(field, { value: values, mixed }) {
  const d = DEF[field];
  const ids = renderIds;
  let list = [...(values ?? [])];
  const wrap = h('div.tokens', { class: mixed ? 'mixed' : '' });
  const input = h('input', { autocomplete: 'off', spellcheck: 'false', dataset: { key: field }, 'aria-label': d.label });
  if (field === 'language') input.dataset.suggestEmpty = '1';
  const fmt = d.format ?? ((x) => x);
  let dragFrom = -1;

  const emitChange = () => change(field, list, { ids });
  function paint() {
    wrap.querySelectorAll('.token').forEach((n) => n.remove());
    list.forEach((v, i) => {
      const t = h('span.token', { draggable: list.length > 1 ? 'true' : 'false', title: v },
        h('span.t-text', {}, fmt(v)),
        h('button', { tabIndex: -1, title: 'Entfernen', html: icon('x'), onclick: (e) => { e.stopPropagation(); list.splice(i, 1); paint(); emitChange(); } }));
      t.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', v); });
      t.addEventListener('dragover', (e) => { if (dragFrom >= 0) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
      t.addEventListener('drop', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        e.stopPropagation();
        const [moved] = list.splice(dragFrom, 1);
        list.splice(i, 0, moved);
        dragFrom = -1;
        paint();
        emitChange();
      });
      t.addEventListener('dragend', () => { dragFrom = -1; });
      wrap.insertBefore(t, input);
    });
    input.placeholder = list.length ? '' : mixed ? 'Verschiedene Werte' : d.placeholder;
  }
  function commit() {
    const raw = input.value.trim();
    if (!raw) return false;
    const parts = raw.split(d.split ?? /[;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => (d.parse ? d.parse(s) : s));
    for (const p of parts) if (!list.some((x) => x.toLowerCase() === p.toLowerCase())) list.push(p);
    input.value = '';
    paint();
    emitChange();
    return true;
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!commit()) focusNext(input);
    } else if (e.key === 'Tab' && input.value.trim()) {
      commit();
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      const last = wrap.querySelector('.token:last-of-type');
      if (last?.classList.contains('selected')) { list.pop(); paint(); emitChange(); } else last?.classList.add('selected');
    } else if (e.key === 'Escape') {
      input.blur();
    } else {
      wrap.querySelector('.token.selected')?.classList.remove('selected');
    }
  });
  input.addEventListener('blur', () => { setTimeout(() => commit(), 130); wrap.querySelector('.token.selected')?.classList.remove('selected'); });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text');
    if (/[;\n]/.test(text)) { e.preventDefault(); input.value = text; commit(); }
  });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) { e.preventDefault(); input.focus(); } });
  if (d.suggest) {
    attachSuggest(input, d.suggest, {
      label: d.suggestLabel ?? ((x) => x),
      exclude: () => list,
      onPick: (x) => { input.value = ''; if (!list.includes(x)) list.push(x); paint(); emitChange(); },
    });
  }
  wrap.append(input);
  paint();
  return wrap;
}

function focusNext(el) {
  const all = [...root.querySelectorAll('input:not([type=checkbox]), textarea')];
  const i = all.indexOf(el);
  (all[i + 1] ?? all[0])?.focus();
}

function fieldCell(field, books, cls = 'field') {
  const c = common(books, field);
  const d = DEF[field];
  let extra = null;
  if (field === 'authorSort' && books.length === 1) {
    const suggestion = sortName(value(books[0], 'authors')[0] ?? '');
    if (suggestion && suggestion !== value(books[0], 'authorSort')) {
      extra = h('button.hint-btn', { title: `Vorschlag: ${suggestion}`, onclick: () => { change('authorSort', suggestion); render(); } }, 'Vorschlag');
    }
  }
  const control = d.type === 'tokens' ? tokenField(field, c) : textField(field, c);
  return h(`div.${cls}`, { dataset: { field }, class: books.some((b) => isFieldDirty(b, field)) ? 'dirty' : '' },
    fieldLabel(field, extra), control,
    field === 'date' && c.value && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(c.value) ? h('div.field-help', {}, 'Empfohlen: JJJJ oder JJJJ-MM-TT') : null);
}

function groupNode(g, books) {
  const isCollapsed = g.collapsible && collapsedGroups.has(g.id);
  const rows = g.rows.map((row) => (row.length === 1
    ? fieldCell(row[0], books)
    : h('div.field.field-row', {}, row.map((f, i) => fieldCell(f, books, `field-cell${i > 0 && f === 'seriesIndex' ? '.narrow' : ''}`)))));
  return h('section', { class: isCollapsed ? 'collapsed' : '' },
    g.collapsible
      ? h('button.group-title', {
        onclick: (e) => {
          const sec = e.currentTarget.parentElement;
          sec.classList.toggle('collapsed');
          if (sec.classList.contains('collapsed')) collapsedGroups.add(g.id); else collapsedGroups.delete(g.id);
          localStorage.setItem('kolophon.inspector.collapsed', JSON.stringify([...collapsedGroups]));
        },
      }, h('span', { html: icon('chevronDown') }), g.title)
      : h('div.group-title', {}, g.title),
    h('div.group', {}, rows));
}

/* ----------------------------------------------------------------- Cover */

let fullCover = { key: null, url: null };
const fullKey = (book) => `${book.id}|${book.size}|${book.lastModified}`;

async function loadFullCover(book, frameImg) {
  if (book.newCover || !book.info?.cover) return;
  if (fullCover.key === fullKey(book) && fullCover.url) { frameImg.src = fullCover.url; return; }
  try {
    const blob = await coverBlob(book);
    if (!blob) return;
    if (fullCover.url) URL.revokeObjectURL(fullCover.url);
    fullCover = { key: fullKey(book), url: URL.createObjectURL(blob) };
    if (state.selection.size === 1 && state.selection.has(book.id)) frameImg.src = fullCover.url;
  } catch { /* Vorschaubild bleibt */ }
}

function coverWell(books) {
  const well = h('div.cover-well', { title: 'Bild hierher ziehen, einfügen (⌘V) oder auswählen' });
  if (books.length === 1) {
    const b = books[0];
    const url = b.newCover?.url ?? coverURL(b);
    if (url || b.info?.cover) {
      const img = h('img', { src: url ?? '', alt: 'Cover', draggable: false });
      well.append(h('div.cover-frame', {}, img));
      loadFullCover(b, img);
    } else {
      well.append(coverNode(b, 'well'));
    }
    if (b.newCover) well.append(h('span.cover-new', {}, b.newCover.source ? `Neu · ${b.newCover.source}` : 'Neues Cover'));
  } else {
    const stack = h('div.cover-stack');
    for (const b of books.slice(0, 3).reverse()) {
      const url = coverURL(b);
      const d = display(b);
      stack.append(url ? h('div.cover-frame', {}, h('img', { src: url, alt: '' })) : h('div.placeholder', { style: placeholderStyle(d.title, d.author) }, h('div.ph-title', {}, d.title)));
    }
    well.className = 'cover-stack-wrap';
    well.append(stack);
  }
  well.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file' && i.type.startsWith('image/')) || e.dataTransfer.types.includes('text/uri-list')) {
      e.preventDefault();
      e.stopPropagation();
      well.classList.add('drag');
    }
  });
  well.addEventListener('dragleave', () => well.classList.remove('drag'));
  well.addEventListener('drop', (e) => {
    well.classList.remove('drag');
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      e.stopPropagation();
      emit('set-cover', { blob: file, source: 'Datei' });
    }
  });
  return well;
}

function coverActions(books) {
  const hasNew = books.some((b) => b.newCover);
  return h('div.cover-actions', {},
    h('button.btn.small', { onclick: () => emit('pick-cover') }, h('span', { html: icon('photo') }), 'Bild wählen …'),
    h('button.btn.small', { title: 'Cover aus der Zwischenablage (⌘V)', onclick: () => emit('paste-cover') }, h('span', { html: icon('paste') }), 'Einfügen'),
    h('button.btn.small', {
      title: 'Weitere Aktionen',
      html: icon('ellipsis'),
      onclick: (e) => menu(e.currentTarget, [
        { label: 'Online nach Cover suchen …', icon: 'sparkles', run: () => emit('lookup') },
        books.length === 1 && (books[0].info?.cover || books[0].newCover) ? { label: 'Cover als Bild sichern …', icon: 'download', run: () => emit('export-cover', books[0].id) } : null,
        hasNew ? '-' : null,
        hasNew ? { label: 'Neues Cover verwerfen', icon: 'revert', run: () => revert([...state.selection], ['cover']) } : null,
      ]),
    }));
}

/* ------------------------------------------------------------- Rendern */

function headNode(books) {
  if (books.length === 1) {
    const b = books[0];
    const d = display(b);
    const chips = [
      h('span.chip', {}, `EPUB ${b.info.version.replace(/\.0$/, '')}`),
      h('span.chip', {}, formatBytes(b.size)),
      b.info.drm ? h('span.chip.warn', { title: 'Das Buch ist kopiergeschützt. Metadaten lassen sich trotzdem ändern.' }, 'DRM') : null,
      state.source?.mode === 'copy' ? h('span.chip', { title: 'Firefox/Safari: Änderungen werden als Kopie heruntergeladen' }, 'Kopie') : null,
    ];
    return h('div.insp-head', {},
      h('div.insp-title', { id: 'insp-title' }, d.title),
      h('div.insp-sub', { id: 'insp-sub' }, [d.author, d.year].filter(Boolean).join(' · ') || ' '),
      h('div.insp-chips', {}, chips),
      b.info.repaired
        ? h('div.insp-notice', {}, h('span', { html: icon('alert') }), h('div', {},
          h('div', {}, 'Die Datei ist beschädigt (z. B. ein abgebrochener Download), ließ sich aber retten. Beim Sichern schreibt Kolophon wieder ein heiles EPUB.'),
          h('button.btn.small', { onclick: () => emit('repair', [b.id]) }, isDirtyBook(b) ? 'Jetzt sichern und reparieren' : 'Jetzt reparieren')))
        : null);
  }
  const size = books.reduce((s, b) => s + (b.size ?? 0), 0);
  return h('div.insp-head', {},
    h('div.insp-title', {}, `${plural(books.length, 'Buch', 'Bücher')} ausgewählt`),
    h('div.insp-sub', {}, `${formatBytes(size)} · Änderungen gelten für alle`));
}

function updateHead() {
  const books = selectedBooks();
  if (books.length !== 1) return;
  const d = display(books[0]);
  const t = root.querySelector('#insp-title');
  const s = root.querySelector('#insp-sub');
  if (t) t.textContent = d.title;
  if (s) s.textContent = [d.author, d.year].filter(Boolean).join(' · ') || ' ';
}

function infoNode(b) {
  const row = (k, v, mono) => (v ? h('div.info-row', {}, h('span.k', {}, k), h('span.v', { class: mono ? 'mono' : '' }, v)) : null);
  const modified = b.lastModified ? new Date(b.lastModified).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return h('section', {},
    h('div.group-title', {}, 'Datei'),
    h('div.group.info-rows', {},
      row('Datei', b.path),
      row('Größe', formatBytes(b.size)),
      row('Geändert', modified),
      row('Format', `EPUB ${b.info.version}`),
      row('Kennung', b.info.uid, true),
      row('Paketdatei', b.info.opfPath, true),
      row('Cover', b.info.cover ? `${b.info.cover.path.split('/').pop()}${b.info.cover.declared ? '' : ' (erkannt)'}` : 'keins')));
}

const isDirtyBook = (b) => Object.keys(b.edits).length > 0 || Boolean(b.newCover);

/* ------------------------------------------------ Nicht lesbare Dateien */

function errorPanel(list) {
  if (list.length > 1) {
    return h('div.insp-empty', {},
      h('span', { html: icon('alert') }),
      h('div', {}, `${plural(list.length, 'Datei lässt', 'Dateien lassen')} sich nicht öffnen.`),
      h('button.btn.small', { onclick: () => emit('retry', list.map((b) => b.id)) }, h('span', { html: icon('revert') }), 'Erneut lesen'));
  }
  const b = list[0];
  const d = display(b);
  const id = b.identified;
  const mode = renameMode(b, state.source);
  const name = id ? fileNameFor(id) : '';
  const cover = id?.cover
    ? h('div.cover-frame', {}, h('img', { src: id.cover, alt: '', referrerPolicy: 'no-referrer' }))
    : h('div.placeholder', { style: placeholderStyle(d.title, d.author) }, h('div.ph-title', {}, d.title), h('div.ph-rule'), h('div.ph-author', {}, d.author));
  const row = (k, v) => (v ? h('div.info-row', {}, h('span.k', {}, k), h('span.v', {}, v)) : null);
  const modified = b.lastModified ? new Date(b.lastModified).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return h('div.insp-scroll', {},
    h('div.cover-well', {}, cover),
    h('div.insp-head', {},
      h('div.insp-title', {}, d.title),
      h('div.insp-sub', {}, id ? [d.author, `erkannt über ${id.source}`].filter(Boolean).join(' · ') : 'Lässt sich nicht öffnen'),
      h('div.insp-notice.err', {}, h('span', { html: icon('alert') }), h('div', {},
        h('div', {}, b.error),
        h('div.hint', {}, id
          ? 'Kolophon kann die Datei nicht ändern. Am besten das Buch neu herunterladen oder aus einer anderen Quelle ersetzen.'
          : 'Online lässt sich trotzdem herausfinden, welches Buch das ist – gesucht wird mit dem Dateinamen.')))),
    h('button.btn.tinted.insp-lookup', { onclick: () => emit('lookup') }, h('span', { html: icon('sparkles') }), id ? 'Erneut identifizieren …' : 'Online identifizieren …'),
    h('div.cover-actions', {},
      h('button.btn.small', { onclick: () => emit('retry', [b.id]) }, h('span', { html: icon('revert') }), 'Erneut lesen'),
      id && name && name !== b.name && mode
        ? h('button.btn.small', { title: name, onclick: () => emit('rename', { id: b.id, name }) }, h('span', { html: icon(mode === 'download' ? 'download' : 'doc') }), mode === 'download' ? 'Mit neuem Namen laden' : 'Umbenennen')
        : null),
    h('section', {}, h('div.group-title', {}, 'Datei'), h('div.group.info-rows', {},
      row('Datei', b.path), row('Größe', formatBytes(b.size)), row('Geändert', modified),
      id ? row('Erkannt als', [id.title, id.authors.join(', ')].filter(Boolean).join(' – ')) : null,
      id ? row('Verlag', [id.publisher, id.date?.slice(0, 4)].filter(Boolean).join(', ')) : null,
      id ? row('ISBN', id.isbn) : null,
      id && name && name !== b.name ? row('Passender Name', name) : null)));
}

export function render() {
  closeSuggest();
  collected.clear();
  const books = selectedBooks();
  renderIds = books.map((b) => b.id);
  const focusKey = document.activeElement?.closest?.('#inspector') ? document.activeElement.dataset?.key : null;
  const scrollTop = root.querySelector('.insp-scroll')?.scrollTop ?? 0;
  if (!books.length) {
    const sel = [...state.selection].map((id) => state.byId.get(id)).filter(Boolean);
    const errors = sel.filter((b) => b.status === 'error');
    if (errors.length) { root.replaceChildren(errorPanel(errors)); return; }
    const pending = sel.some((b) => b.status === 'pending');
    root.replaceChildren(h('div.insp-empty', {},
      h('span', { html: icon('book') }),
      h('div', {}, pending ? 'Wird gelesen …' : state.books.length ? 'Kein Buch ausgewählt' : 'Noch keine Bücher geöffnet')));
    return;
  }
  const lookup = h('button.btn.tinted.insp-lookup', { onclick: () => emit('lookup') }, h('span', { html: icon('sparkles') }), books.length > 1 ? 'Online ergänzen …' : 'Online-Metadaten suchen …');
  const scroll = h('div.insp-scroll', {},
    coverWell(books), coverActions(books), headNode(books), lookup,
    GROUPS.map((g) => groupNode(g, books)),
    books.length === 1 ? infoNode(books[0]) : null);
  root.replaceChildren(scroll);
  scroll.scrollTop = scrollTop;
  if (focusKey) {
    const el = root.querySelector(`[data-key="${focusKey}"]`);
    if (el) { el.focus({ preventScroll: true }); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); }
  }
}

export function focusField(field = 'title') {
  root.querySelector(`[data-key="${field}"]`)?.focus();
}

on('selection', render);
on('edits', ({ ids, fields }) => {
  if (ownEdit) return;
  if ([...ids].some((id) => state.selection.has(id))) render();
  else if (fields.has('cover')) render();
});
on('identified', ({ id }) => { if (state.selection.has(id)) setTimeout(render, 0); });
on('book-changed', (id) => { if (state.selection.has(id)) render(); });
on('thumb', (id) => {
  if (state.selection.has(id) && state.selection.size > 1) render();
});

