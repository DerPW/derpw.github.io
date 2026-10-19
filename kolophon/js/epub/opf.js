// Metadaten aus der OPF lesen und gezielt zurückschreiben.
// Geändert werden nur die Elemente der bearbeiteten Felder; alles andere bleibt Byte für Byte erhalten.
import { NS, parseXML, is, attr, attrNS, elements, descendants, find, textOf, startTag, Splicer, escText, escAttr } from './xml.js';
import {
  looksLikeHTML, htmlToText, descriptionToStore, normalizeISBN, isValidISBN, normalizeDate, normalizeField,
  normalizeDescription, LIST_FIELDS,
} from './text.js';

export const FIELDS = [
  'title', 'authors', 'series', 'seriesIndex', 'publisher', 'date', 'language', 'isbn',
  'description', 'subjects', 'translators', 'rights', 'titleSort', 'authorSort',
];

export function emptyMeta() {
  const m = {};
  for (const f of FIELDS) m[f] = LIST_FIELDS.has(f) ? [] : '';
  return m;
}

/* ------------------------------------------------------------- Analyse */

function analyze(src) {
  const root = parseXML(src);
  const pkg = find(root, (el) => is(el, NS.opf, 'package'));
  if (!pkg) throw new Error('OPF ohne <package>-Element');
  const version = attr(pkg, 'version') || '2.0';
  const v3 = parseFloat(version) >= 3;
  // Fehlt <metadata>, gelten alle Felder als leer; beim Schreiben wird es angelegt.
  const metadata = elements(pkg).find((el) => is(el, NS.opf, 'metadata')) ?? find(pkg, (el) => is(el, NS.opf, 'metadata'));
  const manifest = elements(pkg).find((el) => is(el, NS.opf, 'manifest'));
  const spine = elements(pkg).find((el) => is(el, NS.opf, 'spine'));
  const guide = elements(pkg).find((el) => is(el, NS.opf, 'guide'));

  const all = metadata ? [...descendants(metadata)] : [];
  const metas = all.filter((el) => is(el, NS.opf, 'meta'));
  const refines = new Map();
  for (const m of metas) {
    const r = attr(m, 'refines');
    if (!r?.startsWith('#')) continue;
    const id = r.slice(1);
    if (!refines.has(id)) refines.set(id, []);
    refines.get(id).push(m);
  }
  const ids = new Set();
  for (const el of descendants(root)) { const id = attr(el, 'id'); if (id) ids.add(id); }

  const ctx = { src, root, pkg, version, v3, metadata, manifest, spine, guide, all, metas, refines, ids };
  ctx.dc = (local) => all.filter((el) => is(el, NS.dc, local));
  ctx.text = (el) => textOf(root, el);
  ctx.refinesOf = (el, property) => {
    const id = attr(el, 'id');
    const list = id ? refines.get(id) ?? [] : [];
    return property ? list.filter((m) => attr(m, 'property') === property) : list;
  };
  ctx.refineValue = (el, property) => {
    const m = ctx.refinesOf(el, property)[0];
    return m ? ctx.text(m).trim() : null;
  };
  ctx.metaByName = (name) => metas.filter((m) => attr(m, 'name') === name);
  ctx.metaByProperty = (prop) => metas.filter((m) => attr(m, 'property') === prop && !attr(m, 'refines'));
  return ctx;
}

const roleOf = (ctx, el) => (attrNS(el, NS.opf, 'role') ?? ctx.refineValue(el, 'role') ?? '').trim().toLowerCase();
const fileAsOf = (ctx, el) => (attrNS(el, NS.opf, 'file-as') ?? ctx.refineValue(el, 'file-as') ?? '').trim();

function mainTitle(ctx) {
  const titles = ctx.dc('title');
  if (ctx.v3) {
    const main = titles.find((t) => ctx.refineValue(t, 'title-type') === 'main');
    if (main) return main;
    const plain = titles.find((t) => !ctx.refineValue(t, 'title-type'));
    if (plain) return plain;
  }
  return titles[0] ?? null;
}

const creators = (ctx) => [...ctx.dc('creator'), ...ctx.dc('contributor')].sort((a, b) => a.start - b.start);
const authorEls = (ctx) => ctx.dc('creator').filter((el) => ['', 'aut'].includes(roleOf(ctx, el)));
const translatorEls = (ctx) => creators(ctx).filter((el) => roleOf(ctx, el) === 'trl');

function isbnFrom(ctx, el) {
  const text = ctx.text(el).trim();
  const scheme = (attrNS(el, NS.opf, 'scheme') ?? '').toLowerCase();
  const type = ctx.refineValue(el, 'identifier-type');
  const prefixed = /^(urn:isbn:|isbn[:\s])/i.test(text);
  const d = normalizeISBN(text);
  if (scheme === 'isbn' || prefixed || type === '15' || type === '02') return /^(\d{9}[\dX]|\d{13})$/.test(d) ? d : null;
  if (scheme && scheme !== 'isbn') return null;
  return isValidISBN(d) ? d : null;
}

function dateEl(ctx) {
  const dates = ctx.dc('date');
  const event = (el) => (attrNS(el, NS.opf, 'event') ?? '').toLowerCase();
  return dates.find((d) => event(d) === 'publication') ?? dates.find((d) => !event(d)) ?? dates[0] ?? null;
}

function seriesCollection(ctx) {
  return ctx.metaByProperty('belongs-to-collection').find((m) => {
    const t = ctx.refineValue(m, 'collection-type');
    return !t || t === 'series';
  }) ?? null;
}

function uidElement(ctx) {
  const uid = attr(ctx.pkg, 'unique-identifier');
  return uid ? ctx.dc('identifier').find((el) => attr(el, 'id') === uid) ?? null : null;
}

/* ----------------------------------------------------------------- Lesen */

export function readOPF(src) {
  const ctx = analyze(src);
  const m = emptyMeta();
  const title = mainTitle(ctx);
  m.title = title ? ctx.text(title).trim() : '';
  m.titleSort = (title && ctx.refineValue(title, 'file-as')) || attr(ctx.metaByName('calibre:title_sort')[0], 'content') || '';
  const authors = authorEls(ctx);
  m.authors = authors.map((el) => ctx.text(el).trim());
  m.authorSort = authors[0] ? fileAsOf(ctx, authors[0]) : '';
  m.translators = translatorEls(ctx).map((el) => ctx.text(el).trim());

  const coll = seriesCollection(ctx);
  if (coll) {
    m.series = ctx.text(coll).trim();
    m.seriesIndex = ctx.refineValue(coll, 'group-position') ?? '';
  }
  if (!m.series) {
    m.series = attr(ctx.metaByName('calibre:series')[0], 'content') ?? '';
    m.seriesIndex = m.series ? attr(ctx.metaByName('calibre:series_index')[0], 'content') ?? '' : '';
  }
  m.seriesIndex = m.series ? formatIndex(m.seriesIndex) : '';

  const first = (local) => { const el = ctx.dc(local)[0]; return el ? ctx.text(el).trim() : ''; };
  m.publisher = first('publisher');
  m.rights = first('rights');
  const d = dateEl(ctx);
  m.date = d ? normalizeDate(ctx.text(d)) : '';
  m.language = ctx.dc('language').map((el) => ctx.text(el).trim());
  m.subjects = ctx.dc('subject').map((el) => ctx.text(el).trim());

  const desc = ctx.dc('description')[0];
  const rawDesc = desc ? ctx.text(desc) : '';
  m.description = looksLikeHTML(rawDesc) ? htmlToText(rawDesc) : normalizeDescription(rawDesc);

  const uidEl = uidElement(ctx);
  const isbns = ctx.dc('identifier').map((el) => ({ el, isbn: isbnFrom(ctx, el) })).filter((x) => x.isbn);
  m.isbn = (isbns.find((x) => x.el !== uidEl) ?? isbns[0])?.isbn ?? '';

  for (const f of FIELDS) m[f] = normalizeField(f, m[f]);

  return {
    version: ctx.version,
    v3: ctx.v3,
    meta: m,
    descriptionHTML: looksLikeHTML(rawDesc),
    uid: uidEl ? ctx.text(uidEl).trim() : '',
    manifest: manifestItems(ctx),
    cover: coverCandidate(ctx),
    coverPage: coverPageHref(ctx),
    modified: ctx.metaByProperty('dcterms:modified')[0] ? ctx.text(ctx.metaByProperty('dcterms:modified')[0]).trim() : '',
  };
}

const formatIndex = (s) => {
  const t = String(s ?? '').trim();
  const n = Number(t);
  return t && Number.isFinite(n) ? String(n) : t;
};

function manifestItems(ctx) {
  if (!ctx.manifest) return [];
  return elements(ctx.manifest).filter((el) => is(el, NS.opf, 'item')).map((el) => ({
    el,
    id: attr(el, 'id') ?? '',
    href: attr(el, 'href') ?? '',
    mediaType: (attr(el, 'media-type') ?? '').toLowerCase(),
    properties: (attr(el, 'properties') ?? '').split(/\s+/).filter(Boolean),
  }));
}

const isImage = (it) => it?.mediaType.startsWith('image/');
const stripFrag = (href) => href.split('#')[0];

function coverCandidate(ctx) {
  const items = manifestItems(ctx);
  let it = items.find((i) => i.properties.includes('cover-image') && isImage(i));
  let how = 'property';
  if (!it) {
    const content = attr(ctx.metaByName('cover')[0], 'content');
    if (content) { it = items.find((i) => i.id === content && isImage(i)) ?? items.find((i) => i.href === content && isImage(i)); how = 'meta'; }
  }
  if (!it && ctx.guide) {
    const ref = elements(ctx.guide).find((r) => (attr(r, 'type') ?? '').toLowerCase() === 'cover');
    const href = ref && stripFrag(attr(ref, 'href') ?? '');
    const target = href && items.find((i) => i.href === href);
    if (isImage(target)) { it = target; how = 'guide'; }
  }
  if (!it) { it = items.find((i) => isImage(i) && /cover|umschlag|titelbild|frontcover/i.test(`${i.id} ${i.href}`)); how = 'name'; }
  return it ? { id: it.id, href: it.href, mediaType: it.mediaType, how } : null;
}

function coverPageHref(ctx) {
  const items = manifestItems(ctx);
  const xhtml = (i) => /x?html/.test(i?.mediaType ?? '');
  if (ctx.guide) {
    const ref = elements(ctx.guide).find((r) => ['cover', 'title-page'].includes((attr(r, 'type') ?? '').toLowerCase()));
    if (ref) return stripFrag(attr(ref, 'href') ?? '');
  }
  const named = items.find((i) => xhtml(i) && /cover|titlepage|umschlag/i.test(`${i.id} ${i.href}`));
  if (named) return named.href;
  const firstRef = ctx.spine && elements(ctx.spine).find((r) => is(r, NS.opf, 'itemref'));
  const first = firstRef && items.find((i) => i.id === attr(firstRef, 'idref'));
  return xhtml(first) ? first.href : '';
}

/* -------------------------------------------------------------- Schreiben */

function prefixFor(ctx, uri) {
  for (let e = ctx.metadata; e && e.type === 'el'; e = e.parent) {
    for (const a of e.attrs) if (a.name.startsWith('xmlns:') && a.value === uri) return a.name.slice(6);
  }
  return null;
}

/**
 * Schreibt geänderte Felder in die OPF.
 * changes: { feld: wert } – nur die Felder, die sich geändert haben.
 * options.cover: { add: { href, mediaType } } | { id, setMediaType } | { id, declare: true }
 */
export function writeOPF(src, changes, options = {}) {
  const pre = analyze(src);
  if (!pre.metadata) {
    const p = pre.pkg.prefix ? `${pre.pkg.prefix}:` : '';
    const block = `\n  <${p}metadata xmlns:dc="${NS.dc}" xmlns:opf="${NS.opf}">\n  </${p}metadata>`;
    return writeOPF(src.slice(0, pre.pkg.openEnd) + block + src.slice(pre.pkg.openEnd), changes, options);
  }
  return writeAnalyzed(pre, changes, options);
}

function writeAnalyzed(ctx, changes, { modified = new Date(), cover = null, descriptionHTML = false } = {}) {
  const { src } = ctx;
  const { v3, metadata } = ctx;
  const S = new Splicer(src);
  const removed = new Set();
  const usedWS = new Set();
  const tagEdits = new Map();
  const wholeReplaced = new Set();
  const needNS = new Map();

  const childEls = elements(metadata);
  const wsBefore = (el) => {
    const sibs = el.parent.children;
    const prev = sibs[sibs.indexOf(el) - 1];
    return prev?.type === 'text' && /^\s*$/.test(src.slice(prev.start, prev.end)) ? prev : null;
  };
  const indentOf = (el) => {
    const ws = el && wsBefore(el);
    const s = ws ? src.slice(ws.start, ws.end) : '';
    return s.includes('\n') ? s.slice(s.lastIndexOf('\n')) : s;
  };
  const indent = indentOf(childEls.at(-1) ?? null) || indentOf(childEls[0] ?? null) || (childEls.length ? '' : '\n    ');

  let dcPrefix = prefixFor(ctx, NS.dc);
  if (!dcPrefix) { dcPrefix = 'dc'; needNS.set('xmlns:dc', NS.dc); }
  let opfPrefix = prefixFor(ctx, NS.opf);
  const opfAttr = (local) => {
    if (!opfPrefix) { opfPrefix = 'opf'; needNS.set('xmlns:opf', NS.opf); }
    return `${opfPrefix}:${local}`;
  };
  const metaName = metadata.prefix ? `${metadata.prefix}:meta` : 'meta';

  const attrStr = (attrs) => Object.entries(attrs).filter(([, v]) => v != null && v !== '').map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const dcTag = (local, text, attrs = {}) => `<${dcPrefix}:${local}${attrStr(attrs)}>${escText(text)}</${dcPrefix}:${local}>`;
  const metaTag = (attrs, text) => (text == null ? `<${metaName}${attrStr(attrs)}/>` : `<${metaName}${attrStr(attrs)}>${escText(text)}</${metaName}>`);

  const newId = (base) => {
    let id = base;
    for (let i = 2; ctx.ids.has(id); i++) id = `${base}-${i}`;
    ctx.ids.add(id);
    return id;
  };

  function remove(el) {
    if (!el || removed.has(el)) return;
    removed.add(el);
    const ws = wsBefore(el);
    const start = ws && !usedWS.has(ws) ? (usedWS.add(ws), ws.start) : el.start;
    S.replace(start, el.end, '');
    for (const r of ctx.refinesOf(el)) remove(r);
  }

  function editAttrs(el, fn) {
    if (!tagEdits.has(el)) tagEdits.set(el, el.attrs.map((a) => ({ ...a })));
    tagEdits.set(el, fn(tagEdits.get(el)));
  }
  const setAttr = (el, name, value) => editAttrs(el, (attrs) => {
    const i = attrs.findIndex((a) => a.name === name);
    if (value == null || value === '') return i < 0 ? attrs : attrs.filter((_, j) => j !== i);
    const a = { name, value, raw: escAttr(value), quote: '"' };
    if (i < 0) return [...attrs, a];
    attrs[i] = a;
    return attrs;
  });
  const ensureId = (el, base) => {
    const id = attr(el, 'id') ?? tagEdits.get(el)?.find((a) => a.name === 'id')?.value;
    if (id) return id;
    const nid = newId(base);
    setAttr(el, 'id', nid);
    return nid;
  };

  function setText(el, value) {
    if (el.selfClosing) {
      wholeReplaced.add(el);
      S.replace(el.start, el.end, `${startTag({ ...el, selfClosing: false }, tagEdits.get(el) ?? el.attrs)}${escText(value)}</${el.name}>`);
    } else {
      S.replace(el.openEnd, el.closeStart, escText(value));
    }
  }

  const lastDC = () => childEls.filter((el) => el.prefix === dcPrefix || is(el, NS.dc, el.local)).at(-1) ?? childEls.at(-1);
  function insertAfter(anchor, strings) {
    if (!strings.length) return;
    const pos = anchor ? anchor.end : metadata.openEnd;
    S.insert(pos, strings.map((s) => indent + s).join(''));
  }

  function replaceGroup(oldEls, strings, anchor = lastDC()) {
    const [first, ...rest] = oldEls;
    if (first && strings.length) {
      removed.add(first);
      wholeReplaced.add(first);
      S.replace(first.start, first.end, strings.join(indent));
      for (const r of ctx.refinesOf(first)) remove(r);
    } else if (first) {
      remove(first);
    } else {
      insertAfter(anchor, strings);
    }
    rest.forEach(remove);
  }

  function setSingle(el, local, value, attrs = {}) {
    if (!value) { remove(el); return; }
    if (el) setText(el, value);
    else insertAfter(lastDC(), [dcTag(local, value, attrs)]);
  }

  function setFileAs(el, value, base) {
    const refs = ctx.refinesOf(el, 'file-as');
    const attrName = el.attrs.find((a) => /(^|:)file-as$/.test(a.name) && a.name.includes(':'))?.name;
    let done = false;
    if (refs.length) {
      if (value) setText(refs[0], value); else remove(refs[0]);
      refs.slice(1).forEach(remove);
      done = true;
    }
    if (attrName) { setAttr(el, attrName, value); done = true; }
    if (!done && value) {
      if (v3) S.insert(el.end, indent + metaTag({ refines: `#${ensureId(el, base)}`, property: 'file-as' }, value));
      else setAttr(el, opfAttr('file-as'), value);
    }
  }

  function writePeople(oldEls, names, role, local, sortFirst) {
    const oldSort = new Map(oldEls.map((el) => [ctx.text(el).trim(), fileAsOf(ctx, el)]));
    const strings = [];
    names.forEach((name, i) => {
      const fileAs = i === 0 && sortFirst !== undefined ? sortFirst : oldSort.get(name) ?? '';
      if (v3) {
        const id = newId(role === 'aut' ? 'author' : 'translator');
        strings.push(dcTag(local, name, { id }));
        strings.push(metaTag({ refines: `#${id}`, property: 'role', scheme: 'marc:relators' }, role));
        if (fileAs) strings.push(metaTag({ refines: `#${id}`, property: 'file-as' }, fileAs));
      } else {
        const attrs = { [opfAttr('role')]: role };
        if (fileAs) attrs[opfAttr('file-as')] = fileAs;
        strings.push(dcTag(local, name, attrs));
      }
    });
    const anchor = (role === 'aut' ? null : authorEls(ctx).at(-1)) ?? ctx.dc('title').at(-1) ?? lastDC();
    replaceGroup(oldEls, strings, anchor);
  }

  const has = (f) => Object.prototype.hasOwnProperty.call(changes, f);
  const val = (f) => normalizeField(f, changes[f]);

  /* Titel */
  const title = mainTitle(ctx);
  if (has('title') && val('title')) {
    if (title) setText(title, val('title'));
    else insertAfter(lastDC(), [dcTag('title', val('title'))]);
  }
  if (has('titleSort')) {
    const v = val('titleSort');
    if (title) {
      const refs = ctx.refinesOf(title, 'file-as');
      if (refs.length || v3) setFileAs(title, v, 'title');
    }
    const cal = ctx.metaByName('calibre:title_sort');
    if (cal.length) { if (v) setAttr(cal[0], 'content', v); else remove(cal[0]); cal.slice(1).forEach(remove); }
    else if (v && !v3) insertAfter(childEls.at(-1), [metaTag({ name: 'calibre:title_sort', content: v })]);
  }

  /* Personen */
  const authors = authorEls(ctx);
  if (has('authors')) {
    writePeople(authors, val('authors'), 'aut', 'creator', has('authorSort') ? val('authorSort') : undefined);
  } else if (has('authorSort') && authors[0]) {
    setFileAs(authors[0], val('authorSort'), 'author');
  }
  if (has('translators')) {
    const old = translatorEls(ctx);
    writePeople(old, val('translators'), 'trl', old[0]?.local ?? 'contributor');
  }

  /* Reihe */
  if (has('series') || has('seriesIndex')) {
    const name = has('series') ? val('series') : readOPF(src).meta.series;
    const index = name ? (has('seriesIndex') ? val('seriesIndex') : readOPF(src).meta.seriesIndex) : '';
    const coll = seriesCollection(ctx);
    const calS = ctx.metaByName('calibre:series');
    const calI = ctx.metaByName('calibre:series_index');
    if (!name) {
      if (coll) remove(coll);
      calS.forEach(remove);
      calI.forEach(remove);
    } else {
      const add = [];
      if (coll) {
        setText(coll, name);
        const pos = ctx.refinesOf(coll, 'group-position');
        if (pos.length) { if (index) setText(pos[0], index); else remove(pos[0]); }
        else if (index) S.insert(coll.end, indent + metaTag({ refines: `#${ensureId(coll, 'series')}`, property: 'group-position' }, index));
      } else if (v3) {
        const id = newId('series');
        add.push(metaTag({ property: 'belongs-to-collection', id }, name));
        add.push(metaTag({ refines: `#${id}`, property: 'collection-type' }, 'series'));
        if (index) add.push(metaTag({ refines: `#${id}`, property: 'group-position' }, index));
      }
      if (calS.length) { setAttr(calS[0], 'content', name); calS.slice(1).forEach(remove); }
      else add.push(metaTag({ name: 'calibre:series', content: name }));
      if (calI.length) { if (index) setAttr(calI[0], 'content', index); else remove(calI[0]); calI.slice(1).forEach(remove); }
      else if (index) add.push(metaTag({ name: 'calibre:series_index', content: index }));
      insertAfter(childEls.at(-1), add);
    }
  }

  /* Einfache Felder */
  if (has('publisher')) setSingle(ctx.dc('publisher')[0], 'publisher', val('publisher'));
  if (has('rights')) setSingle(ctx.dc('rights')[0], 'rights', val('rights'));
  if (has('date')) setSingle(dateEl(ctx), 'date', val('date'));
  if (has('description')) setSingle(ctx.dc('description')[0], 'description', descriptionToStore(val('description'), descriptionHTML));

  if (has('language') && val('language').length) {
    replaceGroup(ctx.dc('language'), val('language').map((l) => dcTag('language', l)));
  }
  if (has('subjects')) replaceGroup(ctx.dc('subject'), val('subjects').map((s) => dcTag('subject', s)));

  if (has('isbn')) {
    const v = val('isbn');
    const uidEl = uidElement(ctx);
    const managed = ctx.dc('identifier').filter((el) => el !== uidEl && isbnFrom(ctx, el));
    if (managed.length) {
      const el = managed[0];
      if (!v) remove(el);
      else {
        const old = ctx.text(el).trim();
        const prefix = (old.match(/^(urn:isbn:|isbn[:\s]*)/i) ?? [''])[0];
        setText(el, prefix + v);
      }
    } else if (v && v !== (uidEl ? isbnFrom(ctx, uidEl) : null)) {
      const tag = v3
        ? dcTag('identifier', `urn:isbn:${v}`, { id: newId('isbn') })
        : dcTag('identifier', v, { [opfAttr('scheme')]: 'ISBN' });
      const anchor = ctx.dc('identifier').at(-1) ?? lastDC();
      insertAfter(anchor, [tag]);
    }
  }

  /* Cover im Manifest */
  if (cover && ctx.manifest) {
    const items = manifestItems(ctx);
    const metaCover = ctx.metaByName('cover');
    if (cover.add) {
      const id = newId('cover-image');
      const props = v3 ? { properties: 'cover-image' } : {};
      const itemName = elements(ctx.manifest)[0]?.name ?? (ctx.manifest.prefix ? `${ctx.manifest.prefix}:item` : 'item');
      const tag = `<${itemName}${attrStr({ id, href: cover.add.href, 'media-type': cover.add.mediaType, ...props })}/>`;
      const lastItem = elements(ctx.manifest).at(-1);
      const mIndent = indentOf(lastItem) || indent;
      S.insert(lastItem ? lastItem.end : ctx.manifest.openEnd, mIndent + tag);
      if (metaCover.length) setAttr(metaCover[0], 'content', id);
      else insertAfter(childEls.at(-1), [metaTag({ name: 'cover', content: id })]);
    } else if (cover.id) {
      const it = items.find((i) => i.id === cover.id);
      if (it && cover.setMediaType) setAttr(it.el, 'media-type', cover.setMediaType);
      if (it && cover.declare) {
        if (v3 && !it.properties.includes('cover-image')) setAttr(it.el, 'properties', [...it.properties, 'cover-image'].join(' '));
        if (!metaCover.length) insertAfter(childEls.at(-1), [metaTag({ name: 'cover', content: it.id })]);
      }
    }
  }

  /* Änderungsdatum (EPUB 3 verlangt es) */
  if (v3) {
    const stamp = modified.toISOString().replace(/\.\d+Z$/, 'Z');
    const mod = ctx.metaByProperty('dcterms:modified');
    if (mod.length) { setText(mod[0], stamp); mod.slice(1).forEach(remove); }
    else insertAfter(childEls.at(-1), [metaTag({ property: 'dcterms:modified' }, stamp)]);
  }

  for (const [name, value] of needNS) setAttr(metadata, name, value);
  for (const [el, attrs] of tagEdits) {
    if (removed.has(el) || wholeReplaced.has(el)) continue;
    S.replace(el.start, el.openEnd, startTag(el, attrs));
  }

  let out = S.apply();
  out = out.replace(/^(﻿?<\?xml[^>]*encoding\s*=\s*["'])([^"']+)(["'])/i, (m, a, enc, b) => (/^utf-?8$/i.test(enc) ? m : `${a}UTF-8${b}`));
  return out;
}
