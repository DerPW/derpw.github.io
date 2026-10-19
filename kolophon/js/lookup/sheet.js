// Online-Suche: ein Buch von Hand abgleichen oder viele Bücher automatisch ergänzen.
import { h, icon, sheet, toast, plural } from '../ui.js';
import { settings, setSetting, value, apply, display, emit } from '../state.js';
import { SOURCES, SOURCE_ORDER, fetchCover } from './sources.js';
import { score, merge, AUTO_THRESHOLD, samebook, queryScore, queryFromFilename } from './match.js';
import { prepareCover, placeholderStyle, thumbnail } from '../covers.js';
import { coverURL } from '../library.js';
import { sameValue, normalizeField, normalizeISBN, isValidISBN, sortName } from '../epub/text.js';
import { languageName } from '../langs.js';

const ROWS = [
  { field: 'cover', label: 'Cover' },
  { field: 'title', label: 'Titel' },
  { field: 'authors', label: 'Autor:innen' },
  { field: 'series', label: 'Reihe' },
  { field: 'publisher', label: 'Verlag' },
  { field: 'date', label: 'Erschienen' },
  { field: 'language', label: 'Sprache' },
  { field: 'isbn', label: 'ISBN' },
  { field: 'description', label: 'Beschreibung' },
  { field: 'subjects', label: 'Schlagwörter' },
  { field: 'translators', label: 'Übersetzung' },
];

const AUTO_FIELDS = [
  ['cover', 'Cover'], ['description', 'Beschreibung'], ['publisher', 'Verlag'], ['date', 'Datum'], ['isbn', 'ISBN'],
  ['language', 'Sprache'], ['subjects', 'Schlagwörter'], ['series', 'Reihe'], ['translators', 'Übersetzung'], ['identity', 'Titel & Autor'],
];

// Welche Quelle kann welche Felder liefern (um unnötige Anfragen zu sparen)
const CAN = {
  apple: ['cover', 'description', 'subjects', 'identity'],
  dnb: ['publisher', 'date', 'isbn', 'language', 'series', 'translators', 'identity'],
  openlibrary: ['cover', 'isbn', 'publisher', 'date', 'subjects', 'language', 'identity'],
  google: ['description', 'publisher', 'date', 'isbn', 'subjects', 'language', 'identity'],
};

const SRC_LABEL = (s) => SOURCES[s]?.short ?? s;

/** Bei gleicher Übereinstimmung: Treffer mit mehr verwertbaren Angaben zuerst. */
const richness = (r) => (r.cover?.embeddable ? 2 : 0) + (r.description ? 1.5 : 0) + (r.isbn ? 0.5 : 0) + (r.publisher ? 0.3 : 0) + (r.date ? 0.2 : 0);

function current(book) {
  return {
    title: value(book, 'title'), authors: value(book, 'authors'), isbn: value(book, 'isbn'),
    language: value(book, 'language'), date: value(book, 'date'), hasCover: Boolean(book.info?.cover || book.newCover),
  };
}

const hasVal = (field, v) => {
  if (field === 'cover') return Boolean(v?.full && v.embeddable);
  const n = normalizeField(field, v);
  return Array.isArray(n) ? n.length > 0 : Boolean(n);
};

function fmt(field, v, p = {}) {
  if (field === 'cover') return '';
  if (field === 'series') return v ? `${v}${p.seriesIndex ? ` · Band ${p.seriesIndex}` : ''}` : '';
  if (field === 'language') return (v ?? []).map(languageName).join(', ');
  if (Array.isArray(v)) return v.join(', ');
  return v ?? '';
}

function bookValue(book, field) {
  if (field === 'series') return value(book, 'series');
  return value(book, field);
}

function sameAsBook(book, field, v, p) {
  if (field === 'cover') return false;
  if (field === 'series') return sameValue('series', value(book, 'series'), v) && sameValue('seriesIndex', value(book, 'seriesIndex'), p.seriesIndex ?? '');
  if (field === 'title') return normTitle(value(book, 'title')) === normTitle(v);
  return sameValue(field, value(book, field), v);
}
const normTitle = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* ------------------------------------------------------------ Suchen */

function searchParams(book, query) {
  const cur = current(book);
  const q = String(query ?? '').trim();
  const isbn = normalizeISBN(q);
  if (q && isValidISBN(isbn)) return [{ isbn, language: cur.language[0] }];
  if (q && q !== autoQuery(book)) return [{ query: q }];
  const list = [];
  if (cur.isbn && isValidISBN(cur.isbn)) list.push({ isbn: cur.isbn, language: cur.language[0] });
  if (cur.title) list.push({ title: cur.title, author: cur.authors[0] ?? '', language: cur.language[0] });
  return list;
}

const autoQuery = (book) => [value(book, 'title'), value(book, 'authors')[0]].filter(Boolean).join(' ');

function sourceOptions(signal) {
  return { country: settings.country, coverMax: settings.coverMax || 3000, googleKey: settings.googleKey, signal };
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Abgebrochen', 'AbortError')); }, { once: true });
});

async function searchSource(key, paramsList, signal, { retry = false, onWait } = {}) {
  const out = [];
  const ids = new Set();
  const byKey = new Map();
  let lastErr = null;
  for (const p of paramsList) {
    try {
      let res;
      try {
        res = await SOURCES[key].search(p, sourceOptions(signal));
      } catch (err) {
        // Gedrosselt (v. a. Apple: ca. 20 Anfragen/Minute): in der Automatik einmal kurz warten und erneut fragen
        if (!retry || !err.rateLimited) throw err;
        onWait?.(`${SOURCES[key].short} bremst – kurz warten …`);
        await wait(20000, signal);
        res = await SOURCES[key].search(p, sourceOptions(signal));
      }
      for (const r of res) {
        // Gleiche Ausgaben (Titel, Autor, Verlag, Jahr) nur einmal zeigen – aber mitzählen
        const k = [r.title, r.authors.join(','), r.publisher, String(r.date ?? '').slice(0, 4), r.format].join('|').toLowerCase();
        if (ids.has(r.id)) continue;
        ids.add(r.id);
        if (byKey.has(k)) { byKey.get(k).editions++; continue; }
        r.editions = 1;
        byKey.set(k, r);
        out.push(r);
      }
      if (p.isbn && res.length) break; // ISBN-Treffer genügt
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  if (!out.length && lastErr) throw lastErr;
  return out;
}

/* ------------------------------------------------------- Cover anwenden */

async function coverPatch(book, url, sourceLabel, signal) {
  const blob = await fetchCover(url, signal);
  const target = book.info?.cover?.mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const prepared = await prepareCover(blob, { maxWidth: settings.coverMax, mime: target });
  const thumbUrl = (await thumbnail(null, async () => prepared.blob))?.url;
  return { id: book.id, field: 'cover', value: { ...prepared, url: URL.createObjectURL(prepared.blob), thumbUrl, source: sourceLabel } };
}

function fieldPatch(book, field, proposal) {
  const out = [];
  if (field === 'series') {
    out.push({ id: book.id, field: 'series', value: proposal.series });
    out.push({ id: book.id, field: 'seriesIndex', value: proposal.seriesIndex ?? '' });
  } else if (field === 'authors') {
    out.push({ id: book.id, field: 'authors', value: proposal.authors });
    const oldFirst = value(book, 'authors')[0] ?? '';
    const sort = value(book, 'authorSort');
    if (!sort || sort === sortName(oldFirst)) out.push({ id: book.id, field: 'authorSort', value: proposal.authorSort || sortName(proposal.authors[0] ?? '') });
  } else {
    out.push({ id: book.id, field, value: proposal[field] });
  }
  return out;
}

/* ================================================================ Manuell */

/** Dateiname „Autor – Titel.epub“ ohne Zeichen, die Dateisysteme nicht mögen. */
export function fileNameFor(p) {
  const base = [p.authors?.slice(0, 2).join(', '), p.title].filter(Boolean).join(' - ');
  const clean = base.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return clean ? `${clean}.epub` : '';
}

/**
 * Ein Buch von Hand abgleichen. Lässt sich die Datei nicht öffnen (book.meta fehlt), wird nur
 * identifiziert: Kolophon merkt sich den Treffer und kann die Datei passend umbenennen.
 * options.rename: 'move' | 'download' | null – was „Umbenennen“ in dieser Umgebung bedeutet.
 */
export function openManual(book, { onApplied, rename = null } = {}) {
  const controller = new AbortController();
  const identify = !book.meta;
  const cur = current(book);
  const results = new Map();
  let selected = null;
  let userPicked = false;
  let combine = true;
  let mode = {};
  const overrides = new Map();
  const status = new Map();
  const detailsLoaded = new Set();

  const initialQuery = identify || !cur.title
    ? queryFromFilename(book.name)
    : cur.isbn && isValidISBN(cur.isbn) ? cur.isbn : autoQuery(book);
  const queryInput = h('input', { type: 'search', value: initialQuery, placeholder: 'Titel, Autor oder ISBN', spellcheck: 'false', autofocus: true });
  const pills = h('div.lk-sources');
  const resultsEl = h('div.lk-results');
  const detailEl = h('div.lk-detail');
  const footLeft = h('div.foot-left');
  const applyBtn = h('button.btn.primary', { onclick: () => (identify ? doIdentify(Boolean(rename)) : doApply()), disabled: true }, identify ? 'Zuordnen' : 'Übernehmen');
  const assignBtn = identify && rename ? h('button.btn', { onclick: () => doIdentify(false), disabled: true }, 'Nur zuordnen') : null;

  // Wonach wird bewertet? Eigene Suchbegriffe zählen mehr als die (evtl. falschen) Angaben im Buch.
  function modeFor(query) {
    const q = String(query ?? '').trim();
    const isbn = normalizeISBN(q);
    if (q && isValidISBN(isbn)) return { isbn, params: [{ isbn, language: cur.language[0] }] };
    if (identify || !cur.title || q !== initialQuery) return { query: q, params: q ? [{ query: q }] : [] };
    return { params: searchParams(book, '') };
  }
  const scoreOf = (r) => (mode.isbn ? score({ ...cur, isbn: mode.isbn }, r) : mode.query != null ? queryScore(mode.query, r) : score(cur, r));
  // Gesucht wurde mit eigenen Begriffen und der Treffer passt nicht zu den Angaben im Buch: neu identifizieren
  const reidentify = (r) => !identify && mode.query != null && score(cur, r) < 0.5;

  function paintPills() {
    pills.replaceChildren(...SOURCE_ORDER.map((key) => {
      const on = settings.sources[key];
      const st = status.get(key);
      return h('button.pill', {
        class: [on ? 'on' : '', st?.error ? 'err' : ''].join(' '),
        title: st?.error ?? SOURCES[key].hint,
        onclick: () => {
          setSetting('sources', { ...settings.sources, [key]: !on });
          paintPills();
          if (!on) runSource(key, mode.params ?? []);
          else { for (const [id, r] of results) if (r.r.source === key) results.delete(id); paintResults(); }
        },
      }, h('span.src-state', { html: st?.loading ? '<span class="spinner"></span>' : st?.error ? icon('alert') : on ? icon('check') : '' }),
      SOURCES[key].short, st && !st.loading && !st.error && on ? h('span', { style: { opacity: '.6' } }, String(st.count)) : null);
    }));
  }

  const ranked = () => [...results.values()].sort((a, b) => b.s - a.s || richness(b.r) - richness(a.r));

  function paintResults() {
    const list = ranked();
    if (!list.length) {
      const busy = [...status.values()].some((x) => x.loading);
      const failed = [...status.values()].filter((x) => x.error).length;
      resultsEl.replaceChildren(h('div.lk-placeholder', {},
        busy ? h('span.spinner.big') : h('span', { html: icon('search') }),
        busy ? 'Suche läuft …' : failed && failed === status.size ? 'Keine Quelle erreichbar. Später noch einmal versuchen?' : 'Keine Treffer. Andere Suchbegriffe probieren – z. B. nur Titel oder Nachname?'));
      if (!busy) { selected = null; paintDetail(); }
      return;
    }
    if (!userPicked || !selected || !results.has(selected.id)) selected = list[0].r;
    resultsEl.replaceChildren(...list.map(({ r, s }) => h('button.lk-result', {
      class: selected?.id === r.id ? 'active' : '',
      onclick: () => { selected = r; userPicked = true; overrides.clear(); paintResults(); },
    },
    h('span.r-cover', {}, r.cover?.thumb ? h('img', { src: r.cover.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => { e.target.replaceWith(h('span', { html: icon('book') })); } }) : h('span', { html: icon('book') })),
    h('span.r-text', {},
      h('div.r-title', {}, r.title + (r.subtitle ? ` – ${r.subtitle}` : '')),
      h('div.r-author', {}, r.authors.join(', ') || '–'),
      h('div.r-meta', {},
        h('span.src-badge', {}, SRC_LABEL(r.source)),
        h('span.match', { class: s >= AUTO_THRESHOLD ? 'good' : 'ok', title: mode.query != null ? 'Übereinstimmung mit den Suchbegriffen' : 'Übereinstimmung mit den Angaben im Buch' }, `${Math.round(s * 100)} %`),
        [r.date && r.date.slice(0, 4), r.publisher, r.format === 'ebook' ? 'E-Book' : null].filter(Boolean).join(' · '))))));
    resultsEl.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    paintDetail();
  }

  function proposalFor(r) {
    if (!r) return null;
    if (!combine) return { ...r, sources: Object.fromEntries(ROWS.map((x) => [x.field, r.source])) };
    return merge(r, [...results.values()].map((x) => x.r));
  }

  function isChecked(field, p) {
    if (overrides.has(field)) return overrides.get(field);
    const v = p[field];
    if (!hasVal(field, v)) return false;
    if (field === 'cover') return !cur.hasCover || reidentify(selected);
    if (sameAsBook(book, field, v, p)) return false;
    if (reidentify(selected)) return true;
    return !hasVal(field, bookValue(book, field));
  }

  async function loadMore(r) {
    if (!r?.more || detailsLoaded.has(r.id)) return;
    detailsLoaded.add(r.id);
    try {
      Object.assign(r, await r.more());
      if (!controller.signal.aborted && (selected === r || combine)) paintDetail();
    } catch { /* ohne Beschreibung */ }
  }

  function coverFigure(p) {
    const curUrl = coverURL(book);
    const d = display(book);
    const oldCover = curUrl ? h('div.cover-frame', {}, h('img', { src: curUrl, alt: '' })) : h('div.placeholder', { style: placeholderStyle(d.title, d.author) }, h('div.ph-title', {}, identify ? 'Nicht lesbar' : d.title));
    const newCover = p.cover?.thumb ? h('div.cover-frame', {}, h('img', { src: p.cover.thumb, alt: '', referrerPolicy: 'no-referrer' })) : h('div.placeholder', { style: placeholderStyle(p.title, p.authors?.join(', ') ?? '') }, h('div.ph-title', {}, 'Kein Cover'));
    const caption = p.cover ? (p.cover.embeddable || identify ? `Von ${SRC_LABEL(p.sources?.cover ?? selected.source)}` : 'Nur Vorschau') : 'Keins gefunden';
    return h('div.lk-covers', {},
      h('figure', {}, oldCover, h('figcaption', {}, identify ? 'Datei' : 'Aktuell')),
      h('span.arrow', { html: icon('chevronRight') }),
      h('figure', {}, newCover, h('figcaption', {}, identify ? null : checkbox(isChecked('cover', p), !hasVal('cover', p.cover), (on) => { overrides.set('cover', on); paintDetail(); }), caption)));
  }

  function paintDetail() {
    if (!selected) {
      detailEl.replaceChildren(h('div.lk-placeholder', {}, 'Treffer links auswählen'));
      applyBtn.disabled = true;
      applyBtn.title = '';
      applyBtn.textContent = identify ? (rename ? (rename === 'download' ? 'Mit neuem Namen laden' : 'Umbenennen') : 'Zuordnen') : 'Übernehmen';
      if (assignBtn) assignBtn.disabled = true;
      footLeft.replaceChildren();
      return;
    }
    loadMore(selected);
    if (combine) for (const { r } of results.values()) if (r !== selected && r.more && samebook(selected, r)) loadMore(r);
    const p = proposalFor(selected);
    const rows = ROWS.filter((x) => x.field !== 'cover').map(({ field, label }) => {
      const nv = p[field];
      const has = hasVal(field, nv);
      if (identify) {
        return has ? h('tr', {}, h('td.c-field', {}, label), h('td.c-new', { colSpan: 3 }, h('div.clamp', {}, fmt(field, nv, p)), p.sources?.[field] && p.sources[field] !== selected.source ? h('span.src-badge.src', {}, SRC_LABEL(p.sources[field])) : null)) : null;
      }
      const same = has && sameAsBook(book, field, nv, p);
      const on = has && !same && isChecked(field, p);
      const old = fmt(field, bookValue(book, field), { seriesIndex: value(book, 'seriesIndex') });
      return h('tr', { class: [same ? 'same' : '', !on ? 'off' : ''].join(' ') },
        h('td.c-check', {}, checkbox(on, !has || same, (v) => { overrides.set(field, v); paintDetail(); })),
        h('td.c-field', {}, label),
        h('td.c-old', {}, old ? h('div.clamp', {}, old) : h('span.empty-val', {}, '–')),
        h('td.c-new', {}, has ? [h('div.clamp', {}, same ? 'unverändert' : fmt(field, nv, p)), !same && p.sources?.[field] && p.sources[field] !== selected.source ? h('span.src-badge.src', {}, SRC_LABEL(p.sources[field])) : null] : h('span.empty-val', {}, '–')));
    });
    const table = identify
      ? h('table.cmp', {}, h('tbody', {}, rows))
      : h('table.cmp', {}, h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'Feld'), h('th', {}, 'Aktuell'), h('th', {}, 'Neu'))), h('tbody', {}, rows));
    const combineSwitch = h('label.switch', {}, h('input', { type: 'checkbox', checked: combine, onchange: (e) => { combine = e.target.checked; overrides.clear(); paintDetail(); } }), h('span'));
    const note = identify
      ? h('p.lk-note', {}, h('span', { html: icon('info') }), h('span', {}, `Die Datei lässt sich nicht öffnen (${book.error}). Kolophon kann sie deshalb nicht ändern, merkt sich aber, welches Buch es ist${rename ? ', und benennt sie auf Wunsch passend um' : ''}.`))
      : reidentify(selected) ? h('p.lk-note', {}, h('span', { html: icon('info') }), h('span', {}, 'Der Treffer passt nicht zu den bisherigen Angaben – alle Felder sind zum Ersetzen vorgemerkt.')) : null;
    detailEl.replaceChildren(...[note, coverFigure(p), table, h('div.lk-combine', {}, combineSwitch, 'Lücken aus anderen Quellen zum selben Buch ergänzen')].filter(Boolean));
    if (identify) {
      const name = fileNameFor(p);
      applyBtn.disabled = Boolean(rename) && !name;
      applyBtn.title = name ? `Neuer Name: ${name}` : '';
      if (rename) applyBtn.textContent = `${rename === 'download' ? 'Laden als' : 'Umbenennen in'} „${name.length > 38 ? `${name.slice(0, 36)}…` : name}“`;
      if (assignBtn) assignBtn.disabled = false;
    } else {
      applyBtn.disabled = !ROWS.some(({ field }) => hasVal(field, p[field]) && !sameAsBook(book, field, p[field], p) && isChecked(field, p) && (field !== 'cover' || p.cover?.embeddable));
    }
    footLeft.replaceChildren(selected.url ? h('a.btn.small', { href: selected.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { html: icon('link') }), `Bei ${SRC_LABEL(selected.source)} ansehen`) : '');
  }

  async function runSource(key, params) {
    status.set(key, { loading: true });
    paintPills();
    try {
      const res = await searchSource(key, params, controller.signal);
      if (controller.signal.aborted) return;
      for (const r of res) results.set(r.id, { r, s: scoreOf(r) });
      status.set(key, { count: res.length });
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) return;
      status.set(key, { error: err.message });
    }
    paintPills();
    paintResults();
  }

  function run() {
    results.clear();
    userPicked = false;
    overrides.clear();
    status.clear();
    mode = modeFor(queryInput.value);
    if (!mode.params.length) { paintResults(); return; }
    for (const key of SOURCE_ORDER) if (settings.sources[key]) runSource(key, mode.params);
    paintResults();
  }

  async function doApply() {
    const p = proposalFor(selected);
    const patch = [];
    for (const { field } of ROWS) {
      if (field === 'cover') continue;
      if (hasVal(field, p[field]) && !sameAsBook(book, field, p[field], p) && isChecked(field, p)) patch.push(...fieldPatch(book, field, p));
    }
    applyBtn.disabled = true;
    applyBtn.replaceChildren(h('span.spinner'), 'Übernehmen');
    if (isChecked('cover', p) && p.cover?.embeddable) {
      try {
        patch.push(await coverPatch(book, p.cover.full, SRC_LABEL(p.sources?.cover ?? selected.source), controller.signal));
      } catch (err) {
        if (controller.signal.aborted) return;
        toast(`Cover nicht übernommen: ${err.message}`, { kind: 'error' });
      }
    }
    if (controller.signal.aborted) return; // Sheet wurde inzwischen geschlossen
    if (patch.length) apply(patch, 'Online-Metadaten');
    s.close(true);
    onApplied?.(patch.length);
    if (patch.length) toast(`${plural(new Set(patch.map((x) => x.field)).size, 'Feld', 'Felder')} übernommen – noch nicht gesichert`, { kind: 'success' });
  }

  function doIdentify(withRename) {
    const p = proposalFor(selected);
    const identified = {
      title: p.title, authors: p.authors ?? [], cover: p.cover?.thumb ?? null, source: SRC_LABEL(selected.source),
      url: selected.url ?? '', date: p.date ?? '', publisher: p.publisher ?? '', isbn: p.isbn ?? '',
    };
    s.close(true);
    emit('identified', { id: book.id, identified, rename: withRename ? fileNameFor(p) : null });
    onApplied?.(1);
  }

  queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  const d = display(book);
  const s = sheet({
    title: identify ? 'Buch identifizieren' : 'Metadaten suchen',
    subtitle: identify ? book.name : [d.title, d.author].filter(Boolean).join(' – '),
    width: 980,
    className: 'lookup',
    body: [
      h('div.lk-bar', {}, h('label.lk-query', {}, h('span', { html: icon('search') }), queryInput), pills, h('button.btn', { onclick: run }, 'Suchen')),
      h('div.lk-main', {}, resultsEl, detailEl),
    ],
    footer: [footLeft, h('button.btn', { onclick: () => s.close() }, 'Abbrechen'), assignBtn, applyBtn].filter(Boolean),
    onClose: () => controller.abort(),
  });
  paintPills();
  run();
  // Suchtext markieren: Tippen ersetzt ihn, Pfeiltasten behalten ihn
  setTimeout(() => queryInput.select(), 80);
  return s;
}

function checkbox(checked, disabled, onchange) {
  return h('span.check', {}, h('input', { type: 'checkbox', checked, disabled, onchange: (e) => onchange(e.target.checked) }), h('span', { html: icon('check') }).firstChild);
}

/* ============================================================ Automatisch */

export function openAuto(books) {
  const controller = new AbortController();
  let onlyEmpty = settings.onlyEmpty;
  let fields = new Set(settings.autoFields);
  const rows = books.map((book) => ({ book, status: 'wait', checked: true }));
  const list = h('div.auto-list');
  const progress = h('div.foot-left');
  const applyBtn = h('button.btn.primary', { onclick: doApply, disabled: true }, 'Übernehmen');
  const fieldChips = h('div.auto-fields');

  function needed(book) {
    const cur = current(book);
    const need = new Set();
    for (const f of fields) {
      if (f === 'identity') { if (!onlyEmpty || !cur.title || !cur.authors.length) need.add(f); continue; }
      if (!onlyEmpty) { need.add(f); continue; }
      if (f === 'cover' ? !cur.hasCover : !hasVal(f, value(book, f))) need.add(f);
    }
    return need;
  }

  function changesFor(book, p) {
    const out = [];
    const want = (f) => fields.has(f);
    const consider = (field) => {
      const v = p[field];
      if (!hasVal(field, v)) return;
      if (field === 'cover') {
        if (onlyEmpty && current(book).hasCover) return;
        out.push('cover');
        return;
      }
      const cur = bookValue(book, field);
      if (onlyEmpty && hasVal(field, cur)) return;
      if (sameAsBook(book, field, v, p)) return;
      out.push(field);
    };
    for (const f of ['cover', 'description', 'publisher', 'date', 'isbn', 'language', 'subjects', 'series', 'translators']) if (want(f)) consider(f);
    if (want('identity')) { consider('title'); consider('authors'); }
    return out;
  }

  function paintChips() {
    fieldChips.replaceChildren(...AUTO_FIELDS.map(([f, label]) => h('button.pill', {
      class: fields.has(f) ? 'on' : '',
      onclick: () => {
        if (fields.has(f)) fields.delete(f); else fields.add(f);
        setSetting('autoFields', [...fields]);
        paintChips();
        recompute();
      },
    }, h('span.src-state', { html: fields.has(f) ? icon('check') : '' }), label)));
  }

  function recompute() {
    for (const r of rows) if (r.proposal) r.changes = changesFor(r.book, r.proposal);
    paint();
  }

  function statusCells(r) {
    const plain = (iconName, text, title) => [h('span'), h('span'), h('div.a-status', { title: title ?? '' }, iconName ? h('span', { html: iconName === 'spinner' ? '<span class="spinner"></span>' : icon(iconName) }) : null, text)];
    switch (r.status) {
      case 'wait': return plain(null, 'Wartet …');
      case 'search': return plain('spinner', r.waitNote ?? 'Suche …');
      case 'error': return plain('alert', 'Keine Quelle erreichbar', r.error);
      case 'none': return plain(null, 'Nichts Passendes gefunden – klicken zum Suchen von Hand', r.error ? `Teilweise nicht erreichbar: ${r.error}` : '');
      case 'complete': return plain('checkCircle', 'Schon vollständig');
      case 'manual': return plain('checkCircle', 'Von Hand übernommen');
      default: break;
    }
    const p = r.proposal;
    const curUrl = coverURL(r.book);
    const newCover = p.cover?.thumb && r.changes.includes('cover') ? h('img', { src: p.cover.thumb, alt: '', referrerPolicy: 'no-referrer' }) : curUrl ? h('img', { src: curUrl, alt: '' }) : h('div.placeholder', { style: placeholderStyle(p.title, '') });
    return [
      h('span.a-arrow', { html: icon('chevronRight') }),
      h('div.a-cover.a-new-cover', {}, newCover),
      h('div.a-text', {},
        h('div.a-title', {}, p.title, ' ', h('span.match', { class: r.score >= AUTO_THRESHOLD ? 'good' : 'ok', title: 'Übereinstimmung' }, `${Math.round(r.score * 100)} %`)),
        h('div.a-sub', {}, [p.authors?.join(', '), p.date?.slice(0, 4), p.publisher].filter(Boolean).join(' · ')),
        h('div.a-fields', {}, r.changes.length ? r.changes.map((f) => h('span.chip', {}, ROWS.find((x) => x.field === f)?.label ?? f)) : h('span.chip', {}, 'Nichts zu ergänzen'))),
    ];
  }

  function rowNode(r) {
    const d = display(r.book);
    const curUrl = coverURL(r.book);
    const cover = curUrl ? h('img', { src: curUrl, alt: '' }) : h('div.placeholder', { style: placeholderStyle(d.title, d.author) });
    const canApply = r.status === 'done' && r.changes?.length;
    return h('div.auto-row', {
      class: [r.status === 'none' ? 'none' : '', r.status === 'done' && r.score < AUTO_THRESHOLD ? 'unsure' : ''].join(' '),
      title: 'Klicken zum Abgleichen von Hand',
      onclick: (e) => {
        if (e.target.closest('.check')) return;
        openManual(r.book, { onApplied: (n) => { if (n) { r.status = 'manual'; r.checked = false; update(r); } } });
      },
    },
    checkbox(Boolean(canApply && r.checked), !canApply, (v) => { r.checked = v; paintFoot(); }),
    h('div.a-cover', {}, cover),
    h('div.a-text', {}, h('div.a-title', {}, d.title), h('div.a-sub', {}, d.author || 'Unbekannt')),
    ...statusCells(r));
  }

  // Nur die geänderte Zeile neu zeichnen – bei Hunderten Büchern sonst spürbar langsam
  function update(r) {
    const n = rowNode(r);
    if (r.node?.isConnected) r.node.replaceWith(n); else list.append(n);
    r.node = n;
    paintFoot();
  }

  function paintFoot() {
    const done = rows.filter((r) => !['wait', 'search'].includes(r.status)).length;
    const ready = rows.filter((r) => r.status === 'done' && r.checked && r.changes?.length);
    progress.replaceChildren(done < rows.length ? h('span.spinner') : h('span', { html: icon('checkCircle') }), `${done} von ${rows.length} gesucht`);
    applyBtn.disabled = !ready.length;
    applyBtn.textContent = ready.length ? `${plural(ready.length, 'Buch', 'Bücher')} ergänzen` : 'Übernehmen';
  }

  function paint() {
    list.replaceChildren();
    for (const r of rows) { r.node = null; update(r); }
  }

  async function searchBook(r) {
    r.status = 'search';
    update(r);
    const need = needed(r.book);
    if (!need.size) { r.status = 'complete'; update(r); return; }
    const params = searchParams(r.book, '');
    const keys = SOURCE_ORDER.filter((k) => settings.sources[k] && CAN[k].some((f) => need.has(f)));
    const cur = current(r.book);
    const all = [];
    const errors = [];
    await Promise.all(keys.map(async (k) => {
      const onWait = (note) => { r.waitNote = note; update(r); };
      try { all.push(...(await searchSource(k, params, controller.signal, { retry: true, onWait }))); } catch (err) { if (err.name !== 'AbortError') errors.push(err.message); }
    }));
    if (controller.signal.aborted) return;
    r.waitNote = null;
    const scored = all.map((x) => ({ x, s: score(cur, x) })).sort((a, b) => b.s - a.s || richness(b.x) - richness(a.x));
    const best = scored[0];
    if (!best || best.s < 0.55) {
      // „Fehler“ nur, wenn keine einzige Quelle geantwortet hat – sonst gab es schlicht keinen Treffer
      r.status = errors.length && errors.length === keys.length ? 'error' : 'none';
      r.error = errors.join(' · ');
      update(r);
      return;
    }
    const pool = scored.filter((e) => e.s >= 0.55).map((e) => e.x);
    for (const c of pool) if (c.more && !c.description && need.has('description')) { try { Object.assign(c, await c.more()); } catch { /* egal */ } break; }
    r.proposal = merge(best.x, pool, { strict: true });
    r.score = best.s;
    r.changes = changesFor(r.book, r.proposal);
    r.checked = best.s >= AUTO_THRESHOLD;
    r.status = 'done';
    update(r);
  }

  async function runAll() {
    let i = 0;
    const worker = async () => {
      while (i < rows.length && !controller.signal.aborted) {
        const r = rows[i++];
        await searchBook(r);
      }
    };
    await Promise.all([worker(), worker()]);
  }

  async function doApply() {
    const ready = rows.filter((r) => r.status === 'done' && r.checked && r.changes?.length);
    applyBtn.disabled = true;
    applyBtn.replaceChildren(h('span.spinner'), 'Cover werden geladen …');
    const patch = [];
    const coverJobs = [];
    for (const r of ready) {
      for (const f of r.changes) {
        if (f === 'cover') coverJobs.push(r);
        else patch.push(...fieldPatch(r.book, f, r.proposal));
      }
    }
    let failed = 0;
    let k = 0;
    await Promise.all([0, 1, 2].map(async () => {
      while (k < coverJobs.length) {
        const r = coverJobs[k++];
        try { patch.push(await coverPatch(r.book, r.proposal.cover.full, SRC_LABEL(r.proposal.sources?.cover ?? r.proposal.primary.source), controller.signal)); } catch { failed++; }
      }
    }));
    if (patch.length) apply(patch, 'Online-Metadaten');
    s.close(true);
    toast(`${plural(new Set(patch.map((x) => x.id)).size, 'Buch', 'Bücher')} ergänzt${failed ? `, ${failed} Cover nicht ladbar` : ''} – noch nicht gesichert`, { kind: failed ? 'info' : 'success', timeout: 5000 });
  }

  const onlyEmptySwitch = h('label.switch', {}, h('input', {
    type: 'checkbox', checked: onlyEmpty,
    onchange: (e) => { onlyEmpty = e.target.checked; setSetting('onlyEmpty', onlyEmpty); recompute(); },
  }), h('span'));
  const s = sheet({
    title: 'Metadaten automatisch ergänzen',
    subtitle: `${plural(books.length, 'Buch', 'Bücher')} · ${SOURCE_ORDER.filter((k) => settings.sources[k]).map(SRC_LABEL).join(', ') || 'keine Quelle aktiv'}`,
    width: 920,
    className: 'auto',
    body: [
      h('div.auto-opts', {}, h('label.opt', {}, onlyEmptySwitch, 'Nur leere Felder füllen'), fieldChips),
      list,
    ],
    footer: [progress, h('button.btn', { onclick: () => s.close() }, 'Abbrechen'), applyBtn],
    onClose: () => controller.abort(),
  });
  paintChips();
  paint();
  runAll();
  return s;
}

export function openLookup(books, options = {}) {
  if (!books.length) return null;
  if (!Object.values(settings.sources).some(Boolean)) {
    toast('Alle Online-Quellen sind ausgeschaltet (Einstellungen).', { kind: 'error' });
    return null;
  }
  return books.length === 1 ? openManual(books[0], options) : openAuto(books);
}

