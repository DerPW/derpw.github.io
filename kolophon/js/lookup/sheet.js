// Online-Suche: ein Buch von Hand abgleichen oder viele Bücher automatisch ergänzen.
import { h, icon, sheet, toast, plural } from '../ui.js';
import { settings, setSetting, value, apply, display } from '../state.js';
import { SOURCES, SOURCE_ORDER, fetchCover } from './sources.js';
import { score, merge, AUTO_THRESHOLD, samebook } from './match.js';
import { prepareCover, placeholderStyle } from '../covers.js';
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

async function searchSource(key, paramsList, signal) {
  const out = [];
  const ids = new Set();
  const byKey = new Map();
  let lastErr = null;
  for (const p of paramsList) {
    try {
      const res = await SOURCES[key].search(p, sourceOptions(signal));
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
  return { id: book.id, field: 'cover', value: { ...prepared, url: URL.createObjectURL(prepared.blob), source: sourceLabel } };
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

export function openManual(book, { onApplied } = {}) {
  const controller = new AbortController();
  const results = new Map();
  let selected = null;
  let userPicked = false;
  let combine = true;
  const overrides = new Map();
  const status = new Map();
  let detailsLoaded = new Set();

  const queryInput = h('input', { type: 'search', value: value(book, 'isbn') && isValidISBN(value(book, 'isbn')) ? value(book, 'isbn') : autoQuery(book), placeholder: 'Titel, Autor oder ISBN', spellcheck: 'false', autofocus: true });
  const pills = h('div.lk-sources');
  const resultsEl = h('div.lk-results');
  const detailEl = h('div.lk-detail');
  const footLeft = h('div.foot-left');
  const applyBtn = h('button.btn.primary', { onclick: doApply, disabled: true }, 'Übernehmen');

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
          if (!on) runSource(key, searchParams(book, queryInput.value));
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
      const busy = [...status.values()].some((s) => s.loading);
      resultsEl.replaceChildren(h('div.lk-placeholder', {}, busy ? h('span.spinner.big') : h('span', { html: icon('search') }), busy ? 'Suche läuft …' : 'Keine Treffer. Andere Suchbegriffe probieren?'));
      if (!busy) { selected = null; paintDetail(); }
      return;
    }
    if (!userPicked || !selected || !results.has(selected.id)) selected = list[0].r;
    resultsEl.replaceChildren(...list.map(({ r, s }) => h('button.lk-result', {
      class: selected?.id === r.id ? 'active' : '',
      onclick: () => { selected = r; userPicked = true; overrides.clear(); paintResults(); paintDetail(); },
    },
    h('span.r-cover', {}, r.cover?.thumb ? h('img', { src: r.cover.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => { e.target.replaceWith(h('span', { html: icon('book') })); } }) : h('span', { html: icon('book') })),
    h('span.r-text', {},
      h('div.r-title', {}, r.title + (r.subtitle ? ` – ${r.subtitle}` : '')),
      h('div.r-author', {}, r.authors.join(', ') || '–'),
      h('div.r-meta', {},
        h('span.src-badge', {}, SRC_LABEL(r.source)),
        s >= AUTO_THRESHOLD ? h('span.match.good', { title: 'Passt sehr wahrscheinlich' }, `${Math.round(s * 100)} %`) : h('span.match.ok', { title: 'Passt vielleicht' }, `${Math.round(s * 100)} %`),
        [r.date && r.date.slice(0, 4), r.publisher, r.format === 'ebook' ? 'E-Book' : null].filter(Boolean).join(' · '))))));
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
    if (field === 'cover') return !current(book).hasCover;
    if (sameAsBook(book, field, v, p)) return false;
    const cur = bookValue(book, field);
    return !hasVal(field, cur);
  }

  async function loadMore(r) {
    if (!r?.more || detailsLoaded.has(r.id)) return;
    detailsLoaded.add(r.id);
    try {
      Object.assign(r, await r.more());
      if (selected === r || combine) paintDetail();
    } catch { /* ohne Beschreibung */ }
  }

  function paintDetail() {
    if (!selected) {
      detailEl.replaceChildren(h('div.lk-placeholder', {}, 'Treffer links auswählen'));
      applyBtn.disabled = true;
      footLeft.replaceChildren();
      return;
    }
    loadMore(selected);
    if (combine) for (const { r } of results.values()) if (r !== selected && r.more && samebook(selected, r)) loadMore(r);
    const p = proposalFor(selected);
    const curUrl = coverURL(book);
    const d = display(book);
    const oldCover = curUrl ? h('div.cover-frame', {}, h('img', { src: curUrl, alt: '' })) : h('div.placeholder', { style: placeholderStyle(d.title, d.author) }, h('div.ph-title', {}, d.title));
    const newCover = p.cover?.thumb ? h('div.cover-frame', {}, h('img', { src: p.cover.thumb, alt: '', referrerPolicy: 'no-referrer' })) : h('div.placeholder', { style: placeholderStyle(p.title, p.authors?.join(', ') ?? '') }, h('div.ph-title', {}, 'Kein Cover'));
    const coverCheck = checkbox(isChecked('cover', p), !hasVal('cover', p.cover), (on) => { overrides.set('cover', on); paintDetail(); });
    const covers = h('div.lk-covers', {},
      h('figure', {}, oldCover, h('figcaption', {}, 'Aktuell')),
      h('span.arrow', { html: icon('chevronRight') }),
      h('figure', {}, newCover, h('figcaption', {}, coverCheck, p.cover ? (p.cover.embeddable ? `Von ${SRC_LABEL(p.sources?.cover ?? selected.source)}` : 'Nur Vorschau') : 'Keins gefunden')));

    const rows = ROWS.filter((x) => x.field !== 'cover').map(({ field, label }) => {
      const nv = p[field];
      const has = hasVal(field, nv);
      const same = has && sameAsBook(book, field, nv, p);
      const on = has && !same && isChecked(field, p);
      const cur = fmt(field, bookValue(book, field), { seriesIndex: value(book, 'seriesIndex') });
      return h('tr', { class: [same ? 'same' : '', !on ? 'off' : ''].join(' ') },
        h('td.c-check', {}, checkbox(on, !has || same, (v) => { overrides.set(field, v); paintDetail(); })),
        h('td.c-field', {}, label),
        h('td.c-old', {}, cur ? h('div.clamp', {}, cur) : h('span.empty-val', {}, '–')),
        h('td.c-new', {}, has ? [h('div.clamp', {}, same ? 'unverändert' : fmt(field, nv, p)), !same && p.sources?.[field] && p.sources[field] !== selected.source ? h('span.src-badge.src', {}, SRC_LABEL(p.sources[field])) : null] : h('span.empty-val', {}, '–')));
    });
    const anyOn = ROWS.some(({ field }) => hasVal(field, p[field]) && !sameAsBook(book, field, p[field], p) && isChecked(field, p) && (field !== 'cover' || p.cover?.embeddable));
    applyBtn.disabled = !anyOn;
    const combineSwitch = h('label.switch', {}, h('input', { type: 'checkbox', checked: combine, onchange: (e) => { combine = e.target.checked; overrides.clear(); paintDetail(); } }), h('span'));
    detailEl.replaceChildren(covers,
      h('table.cmp', {}, h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'Feld'), h('th', {}, 'Aktuell'), h('th', {}, 'Neu'))), h('tbody', {}, rows)),
      h('div.lk-combine', {}, combineSwitch, 'Lücken aus anderen Quellen zum selben Buch ergänzen'));
    footLeft.replaceChildren(selected.url ? h('a.btn.small', { href: selected.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { html: icon('link') }), `Bei ${SRC_LABEL(selected.source)} ansehen`) : '');
  }

  async function runSource(key, params) {
    status.set(key, { loading: true });
    paintPills();
    try {
      const res = await searchSource(key, params, controller.signal);
      const cur = current(book);
      for (const r of res) results.set(r.id, { r, s: score(cur, r) });
      status.set(key, { count: res.length });
    } catch (err) {
      if (err.name === 'AbortError') return;
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
    const params = searchParams(book, queryInput.value);
    if (!params.length) { paintResults(); return; }
    for (const key of SOURCE_ORDER) if (settings.sources[key]) runSource(key, params);
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
        toast(`Cover nicht übernommen: ${err.message}`, { kind: 'error' });
      }
    }
    if (patch.length) apply(patch, 'Online-Metadaten');
    s.close(true);
    onApplied?.(patch.length);
    if (patch.length) toast(`${plural(new Set(patch.map((x) => x.field)).size, 'Feld', 'Felder')} übernommen – noch nicht gesichert`, { kind: 'success' });
  }

  queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  const d = display(book);
  const s = sheet({
    title: 'Metadaten suchen',
    subtitle: [d.title, d.author].filter(Boolean).join(' – '),
    width: 980,
    className: 'lookup',
    body: [
      h('div.lk-bar', {}, h('label.lk-query', {}, h('span', { html: icon('search') }), queryInput), pills, h('button.btn', { onclick: run }, 'Suchen')),
      h('div.lk-main', { style: { height: 'min(560px, calc(100vh - 220px))' } }, resultsEl, detailEl),
    ],
    footer: [footLeft, h('button.btn', { onclick: () => s.close() }, 'Abbrechen'), applyBtn],
    onClose: () => controller.abort(),
  });
  paintPills();
  run();
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

  function rowNode(r) {
    const d = display(r.book);
    const curUrl = coverURL(r.book);
    const cover = curUrl ? h('img', { src: curUrl, alt: '' }) : h('div.placeholder', { style: placeholderStyle(d.title, d.author) });
    const p = r.proposal;
    let right;
    if (r.status === 'wait') right = [h('span'), h('span'), h('div.a-status', {}, 'Wartet …')];
    else if (r.status === 'search') right = [h('span'), h('span'), h('div.a-status', {}, h('span.spinner'), 'Suche …')];
    else if (r.status === 'error') right = [h('span'), h('span'), h('div.a-status', { title: r.error }, h('span', { html: icon('alert') }), r.error)];
    else if (r.status === 'none') right = [h('span'), h('span'), h('div.a-status', {}, 'Nichts Passendes gefunden')];
    else if (r.status === 'complete') right = [h('span'), h('span'), h('div.a-status', {}, h('span', { html: icon('checkCircle') }), 'Schon vollständig')];
    else {
      const newCover = p.cover?.thumb && r.changes.includes('cover') ? h('img', { src: p.cover.thumb, alt: '', referrerPolicy: 'no-referrer' }) : curUrl ? h('img', { src: curUrl, alt: '' }) : h('div.placeholder', { style: placeholderStyle(p.title, '') });
      right = [
        h('span.a-arrow', { html: icon('chevronRight') }),
        h('div.a-cover.a-new-cover', {}, newCover),
        h('div.a-text', {},
          h('div.a-title', {}, p.title, ' ', h('span.match', { class: r.score >= AUTO_THRESHOLD ? 'good' : 'ok', title: 'Übereinstimmung' }, `${Math.round(r.score * 100)} %`)),
          h('div.a-sub', {}, [p.authors?.join(', '), p.date?.slice(0, 4), p.publisher].filter(Boolean).join(' · ')),
          h('div.a-fields', {}, r.changes.length ? r.changes.map((f) => h('span.chip', {}, ROWS.find((x) => x.field === f)?.label ?? f)) : h('span.chip', {}, 'Nichts zu ergänzen'))),
      ];
    }
    const canApply = r.status === 'done' && r.changes?.length;
    return h('div.auto-row', {
      class: [r.status === 'none' ? 'none' : '', r.status === 'done' && r.score < AUTO_THRESHOLD ? 'unsure' : ''].join(' '),
      title: 'Klicken zum Abgleichen von Hand',
      onclick: (e) => {
        if (e.target.closest('.check')) return;
        openManual(r.book, { onApplied: (n) => { if (n) { r.status = 'manual'; r.checked = false; paint(); } } });
      },
    },
    checkbox(Boolean(canApply && r.checked), !canApply, (v) => { r.checked = v; paint(); }),
    h('div.a-cover', {}, cover),
    h('div.a-text', {}, h('div.a-title', {}, d.title), h('div.a-sub', {}, d.author || 'Unbekannt')),
    ...(r.status === 'manual' ? [h('span'), h('span'), h('div.a-status', {}, h('span', { html: icon('checkCircle') }), 'Von Hand übernommen')] : right));
  }

  function paint() {
    list.replaceChildren(...rows.map(rowNode));
    const done = rows.filter((r) => !['wait', 'search'].includes(r.status)).length;
    const ready = rows.filter((r) => r.status === 'done' && r.checked && r.changes?.length);
    progress.replaceChildren(done < rows.length ? h('span.spinner') : h('span', { html: icon('checkCircle') }), `${done} von ${rows.length} gesucht`);
    applyBtn.disabled = !ready.length;
    applyBtn.textContent = ready.length ? `${plural(ready.length, 'Buch', 'Bücher')} ergänzen` : 'Übernehmen';
  }

  async function searchBook(r) {
    r.status = 'search';
    paint();
    const need = needed(r.book);
    if (!need.size) { r.status = 'complete'; paint(); return; }
    const params = searchParams(r.book, '');
    const keys = SOURCE_ORDER.filter((k) => settings.sources[k] && CAN[k].some((f) => need.has(f) || (f === 'identity' && need.has('identity'))));
    const cur = current(r.book);
    const all = [];
    const errors = [];
    await Promise.all(keys.map(async (k) => {
      try { all.push(...(await searchSource(k, params, controller.signal))); } catch (err) { if (err.name !== 'AbortError') errors.push(err.message); }
    }));
    if (controller.signal.aborted) return;
    const scored = all.map((x) => ({ x, s: score(cur, x) })).sort((a, b) => b.s - a.s || richness(b.x) - richness(a.x));
    const best = scored[0];
    if (!best || best.s < 0.55) {
      r.status = errors.length && !all.length ? 'error' : 'none';
      r.error = errors[0];
      paint();
      return;
    }
    const pool = scored.filter((e) => e.s >= 0.55).map((e) => e.x);
    for (const c of pool) if (c.more && !c.description && need.has('description')) { try { Object.assign(c, await c.more()); } catch { /* egal */ } break; }
    r.proposal = merge(best.x, pool, { strict: true });
    r.score = best.s;
    r.changes = changesFor(r.book, r.proposal);
    r.checked = best.s >= AUTO_THRESHOLD;
    r.status = 'done';
    paint();
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
      h('div', { style: { display: 'flex', flexDirection: 'column', height: 'min(520px, calc(100vh - 230px))', minHeight: '0' } }, list),
    ],
    footer: [progress, h('button.btn', { onclick: () => s.close() }, 'Abbrechen'), applyBtn],
    onClose: () => controller.abort(),
  });
  list.style.flex = '1';
  paintChips();
  paint();
  runAll();
  return s;
}

export function openLookup(books) {
  if (!books.length) return null;
  if (!Object.values(settings.sources).some(Boolean)) {
    toast('Alle Online-Quellen sind ausgeschaltet (Einstellungen).', { kind: 'error' });
    return null;
  }
  return books.length === 1 ? openManual(books[0]) : openAuto(books);
}

