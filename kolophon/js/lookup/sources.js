// Online-Quellen für Buch-Metadaten. Alle sind ohne Anmeldung per CORS aus dem Browser erreichbar.
// Gesendet werden nur Suchbegriffe (Titel, Autor oder ISBN).
import { parseXML, descendants, attr, textOf } from '../epub/xml.js';
import { htmlToText, normalizeISBN, isValidISBN, isbn10to13, displayName, normalizeDescription } from '../epub/text.js';
import { toBCP47, toMARC } from '../langs.js';

/* ---------------------------------------------------- Drosselung je Quelle */

const queues = new Map();
function throttled(source, gap, fn) {
  const q = queues.get(source) ?? { last: 0, chain: Promise.resolve() };
  queues.set(source, q);
  const run = q.chain.then(async () => {
    const wait = q.last + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    q.last = Date.now();
    return fn();
  });
  q.chain = run.catch(() => {});
  return run;
}

export class SourceError extends Error {
  constructor(message, { rateLimited = false } = {}) {
    super(message);
    this.rateLimited = rateLimited;
  }
}

async function getJSON(url, label, { signal } = {}) {
  let res;
  try { res = await fetch(url, { signal, referrerPolicy: 'no-referrer' }); } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new SourceError(`${label} nicht erreichbar`);
  }
  if (res.status === 429 || res.status === 403) throw new SourceError(`${label}: zu viele Anfragen – bitte kurz warten`, { rateLimited: true });
  if (!res.ok) throw new SourceError(`${label}: Fehler ${res.status}`);
  return res.json();
}

const clean = (s) => String(s ?? '').replace(/[\u0098\u009c]/g, '').replace(/\s+/g, ' ').trim();
const stripPunct = (s) => clean(s).replace(/\s*[/:;,.=]+\s*$/, '').replace(/^\[(.*)\]$/, '$1').trim();
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const validDate = (d) => {
  const y = Number((String(d ?? '').match(/\d{4}/) ?? [''])[0]);
  return y >= 1450 && y <= new Date().getFullYear() + 1 ? String(d) : '';
};

function pickISBN(list, wanted) {
  const all = uniq((list ?? []).map(normalizeISBN)).filter(isValidISBN);
  if (wanted) {
    const w13 = isbn10to13(wanted);
    const hit = all.find((i) => isbn10to13(i) === w13);
    if (hit) return isbn10to13(hit);
  }
  const i13 = all.find((i) => i.length === 13) ?? all[0];
  return i13 ? isbn10to13(i13) : '';
}

function splitAuthors(s) {
  return uniq(String(s ?? '').split(/\s*(?:&|;|,(?=\s*\S+\s+\S+)|\bund\b|\band\b)\s*/).map(clean));
}

/* ------------------------------------------------------------ Apple Books */

function appleArtwork(url, size) {
  return url ? url.replace(/\/\d+x\d+(bb|w)?\.(jpg|png|webp)$/i, `/${size}x0w.jpg`) : '';
}

const APPLE_GENRES_SKIP = new Set(['bücher', 'books', 'ebooks', 'livres', 'libros', 'libri']);

async function apple({ isbn, title, author, query }, { country = 'de', coverMax = 1600, signal } = {}) {
  const label = 'Apple Books';
  const params = (extra) => new URLSearchParams({ country, ...extra }).toString();
  const results = [];
  if (isbn) {
    const j = await throttled('apple', 3100, () => getJSON(`https://itunes.apple.com/lookup?${params({ isbn })}`, label, { signal }));
    results.push(...(j.results ?? []));
  }
  if (!results.length) {
    const term = query || [title, author].filter(Boolean).join(' ');
    if (!term) return [];
    const j = await throttled('apple', 3100, () => getJSON(`https://itunes.apple.com/search?${params({ term, media: 'ebook', entity: 'ebook', limit: '20' })}`, label, { signal }));
    results.push(...(j.results ?? []));
  }
  return results.filter((r) => r.kind === 'ebook' || r.trackName).map((r) => ({
    source: 'apple',
    id: `apple:${r.trackId}`,
    title: clean(r.trackName),
    authors: splitAuthors(r.artistName),
    // Apple setzt bei gemeinfreien Titeln Fantasiedaten (z. B. 1611) – vor 1990 gab es keine E-Books
    date: Number((r.releaseDate ?? '').slice(0, 4)) >= 1990 ? validDate((r.releaseDate ?? '').slice(0, 10)) : '',
    format: 'ebook',
    description: r.description ? htmlToText(r.description) : '',
    subjects: uniq((r.genres ?? []).filter((g) => !APPLE_GENRES_SKIP.has(String(g).toLowerCase()))),
    cover: r.artworkUrl100 ? { thumb: appleArtwork(r.artworkUrl100, 300), full: appleArtwork(r.artworkUrl100, coverMax || 3000), embeddable: true } : null,
    url: r.trackViewUrl,
  }));
}

/* ------------------------------------------------------------ Open Library */

const OL_FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'publisher', 'isbn', 'language', 'cover_i', 'subject',
  'editions', 'editions.key', 'editions.title', 'editions.subtitle', 'editions.publisher', 'editions.publish_date',
  'editions.isbn', 'editions.language', 'editions.cover_i',
].join(',');

async function openlibrary({ isbn, title, author, query }, { signal } = {}) {
  const label = 'Open Library';
  const p = new URLSearchParams({ fields: OL_FIELDS, limit: '12' });
  if (isbn) p.set('q', `isbn:${isbn}`);
  else if (query) p.set('q', query);
  else {
    if (title) p.set('title', title);
    if (author) p.set('author', author);
    if (!title && !author) return [];
  }
  const lang = (navigator.language || 'de').slice(0, 2);
  p.set('lang', lang);
  const j = await throttled('openlibrary', 400, () => getJSON(`https://openlibrary.org/search.json?${p}`, label, { signal }));
  return (j.docs ?? []).map((d) => {
    const ed = d.editions?.docs?.[0] ?? {};
    const coverId = ed.cover_i ?? d.cover_i;
    const isbnList = ed.isbn?.length ? ed.isbn : d.isbn;
    const t = clean(ed.title ?? d.title);
    const sub = clean(ed.subtitle ?? d.subtitle);
    return {
      source: 'openlibrary',
      id: `ol:${ed.key ?? d.key}`,
      workKey: d.key,
      title: t,
      subtitle: sub,
      authors: uniq((d.author_name ?? []).map(clean)),
      publisher: clean((ed.publisher ?? d.publisher ?? [])[0]),
      date: validDate(clean((ed.publish_date ?? [])[0] ?? (d.first_publish_year ? String(d.first_publish_year) : ''))),
      isbn: pickISBN(isbnList, isbn),
      language: uniq((ed.language ?? d.language ?? []).slice(0, 1).map(toBCP47)),
      subjects: uniq((d.subject ?? []).map(clean).filter((s) => s.length < 40 && !/[:=]/.test(s))).slice(0, 8),
      cover: coverId ? { thumb: `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`, full: `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`, embeddable: true } : null,
      url: `https://openlibrary.org${ed.key ?? d.key}`,
      more: () => openlibraryDetails(d.key, signal),
    };
  });
}

async function openlibraryDetails(workKey, signal) {
  if (!workKey) return {};
  const j = await throttled('openlibrary', 400, () => getJSON(`https://openlibrary.org${workKey}.json`, 'Open Library', { signal }));
  const d = typeof j.description === 'string' ? j.description : j.description?.value ?? '';
  const text = normalizeDescription(d.replace(/\(\[source\]\[\d+\]\)[\s\S]*$/, '').replace(/-{3,}[\s\S]*$/, '').replace(/^Von der Buchrückseite:\s*/i, ''));
  return text ? { description: text } : {};
}

/* ------------------------------------------------- Deutsche Nationalbibliothek */

function marcRecords(xml) {
  const root = parseXML(xml);
  const records = [];
  for (const rec of descendants(root)) {
    if (rec.local !== 'record' || !rec.children.some((c) => c.type === 'el' && (c.local === 'datafield' || c.local === 'controlfield'))) continue;
    const fields = [];
    let id = '';
    for (const f of rec.children) {
      if (f.type !== 'el') continue;
      if (f.local === 'controlfield' && attr(f, 'tag') === '001') id = textOf(root, f).trim();
      if (f.local !== 'datafield') continue;
      const subs = {};
      for (const s of f.children) {
        if (s.type !== 'el' || s.local !== 'subfield') continue;
        const code = attr(s, 'code');
        (subs[code] ??= []).push(textOf(root, s));
      }
      fields.push({ tag: attr(f, 'tag'), subs });
    }
    records.push({ id, fields });
  }
  return records;
}

function fromMarc(rec, wantedISBN) {
  const get = (tag) => rec.fields.filter((f) => f.tag === tag);
  const sub = (f, code) => f?.subs[code]?.[0] ?? '';
  const t245 = get('245')[0];
  const title = stripPunct(sub(t245, 'a'));
  const parts = [sub(t245, 'n'), sub(t245, 'p')].map(stripPunct).filter(Boolean);
  const subtitle = stripPunct(sub(t245, 'b'));
  const isRole = (f, codes, words) => (f.subs['4'] ?? []).some((c) => codes.includes(c)) || (f.subs.e ?? []).some((e) => words.test(e));
  const people = [...get('100'), ...get('700')];
  const authorsRaw = people.filter((f) => f.tag === '100' || isRole(f, ['aut'], /verfasser/i)).map((f) => stripPunct(sub(f, 'a')));
  const translators = people.filter((f) => isRole(f, ['trl'], /übersetz/i)).map((f) => displayName(stripPunct(sub(f, 'a'))));
  const pub = get('264').find((f) => f.subs.b) ?? get('260')[0];
  const year = (sub(pub, 'c').match(/\d{4}/) ?? [''])[0];
  const isbns = get('020').flatMap((f) => [...(f.subs.a ?? []), ...(f.subs['9'] ?? [])]);
  const langs = get('041').flatMap((f) => f.subs.a ?? []).map(toBCP47);
  // Reihen: Nur echte Werkreihen übernehmen (800 = Reihe einer Person, oder der Reihenname steckt im Titel).
  // Verlagsreihen wie „Klassiker ; 21“ oder „Fischer ; 16453“ fallen damit heraus.
  let series = '';
  let seriesIndex = '';
  const indexOf = (f) => {
    const v = sub(f, 'v').replace(/[[\]]/g, '').replace(/^(bd\.|band|vol\.|teil|nr\.)\s*/i, '').trim();
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n < 1000 ? String(n) : '';
  };
  const s800 = get('800').find((f) => f.subs.t);
  const titleWords = new Set(clean(title).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const inTitle = (name) => {
    const w = clean(name).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x && !['der', 'die', 'das', 'the'].includes(x));
    return w.length > 0 && w.every((x) => titleWords.has(x));
  };
  if (s800) { series = stripPunct(sub(s800, 't')); seriesIndex = indexOf(s800); }
  else {
    for (const f of [...get('490'), ...get('830')]) {
      const name = stripPunct(sub(f, 'a'));
      if (name && inTitle(name) && clean(name).toLowerCase() !== clean(title).toLowerCase()) { series = name; seriesIndex = indexOf(f); break; }
    }
  }
  const subjects = uniq([...get('689'), ...get('650')].map((f) => stripPunct(sub(f, 'a')))).slice(0, 8);
  const isbn = pickISBN(isbns, wantedISBN);
  const content = get('336').flatMap((f) => f.subs.b ?? []);
  const media = get('337').flatMap((f) => f.subs.b ?? []);
  return {
    source: 'dnb',
    text: !content.length || content.includes('txt'),
    format: media.includes('c') ? 'ebook' : 'print',
    id: `dnb:${rec.id}`,
    title: parts.length ? `${title}. ${parts.join('. ')}` : title,
    subtitle,
    authors: uniq(authorsRaw.map(displayName)),
    authorSort: authorsRaw[0] ?? '',
    translators: uniq(translators),
    publisher: stripPunct(sub(pub, 'b')).replace(/^e-?book by\s*/i, '').replace(/(\S)&(\S)/g, '$1 & $2'),
    date: validDate(year),
    isbn,
    language: uniq(langs),
    series,
    seriesIndex,
    subjects,
    cover: isbn ? { thumb: `https://portal.dnb.de/opac/mvb/cover?isbn=${isbn}`, embeddable: false } : null,
    url: rec.id ? `https://d-nb.info/${rec.id}` : '',
  };
}

const cql = (s) => `"${String(s).replace(/["\\]/g, ' ').trim()}"`;

async function dnb({ isbn, title, author, query, language }, { signal } = {}) {
  let q;
  if (isbn) q = `num=${isbn}`;
  else if (query) q = `woe=${cql(query)}`;
  else if (title) q = `tit=${cql(title)}${author ? ` and per=${cql(author.split(/[,&]/)[0])}` : ''}`;
  else return [];
  const spr = !isbn && toMARC(language);
  if (spr) q += ` and spr=${spr}`;
  const p = new URLSearchParams({ version: '1.1', operation: 'searchRetrieve', query: q, recordSchema: 'MARC21-xml', maximumRecords: '12' });
  let res;
  try { res = await throttled('dnb', 300, () => fetch(`https://services.dnb.de/sru/dnb?${p}`, { signal, referrerPolicy: 'no-referrer' })); } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new SourceError('DNB nicht erreichbar');
  }
  if (!res.ok) throw new SourceError(`DNB: Fehler ${res.status}`);
  // „Deutsche Nationalbibliothek“ als Verlag: Archiv- und Digitalisierungssätze (meist Hörfassungen), keine Buchausgabe
  const list = marcRecords(await res.text()).map((r) => fromMarc(r, isbn)).filter((r) => r.title && r.text && !/^deutsche nationalbibliothek$/i.test(r.publisher));
  // E-Book-Ausgaben zuerst: Deren ISBN gehört zur EPUB-Datei
  return list.sort((a, b) => (b.format === 'ebook') - (a.format === 'ebook'));
}

/* ------------------------------------------------------------ Google Books */

async function google({ isbn, title, author, query }, { googleKey, signal } = {}) {
  let q;
  if (isbn) q = `isbn:${isbn}`;
  else if (query) q = query;
  else q = [title && `intitle:${title}`, author && `inauthor:${author}`].filter(Boolean).join(' ');
  if (!q) return [];
  const p = new URLSearchParams({ q, maxResults: '15', printType: 'books' });
  if (googleKey) p.set('key', googleKey);
  let j;
  try {
    j = await throttled('google', 300, () => getJSON(`https://www.googleapis.com/books/v1/volumes?${p}`, 'Google Books', { signal }));
  } catch (err) {
    if (err.rateLimited && !googleKey) throw new SourceError('Google Books: Tageslimit erreicht – eigener API-Schlüssel in den Einstellungen hilft', { rateLimited: true });
    throw err;
  }
  return (j.items ?? []).map((it) => {
    const v = it.volumeInfo ?? {};
    const img = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? '';
    return {
      source: 'google',
      id: `google:${it.id}`,
      title: clean(v.title),
      subtitle: clean(v.subtitle),
      authors: uniq((v.authors ?? []).map(clean)),
      publisher: clean(v.publisher),
      date: validDate(clean(v.publishedDate)),
      isbn: pickISBN((v.industryIdentifiers ?? []).filter((x) => /ISBN/.test(x.type)).map((x) => x.identifier), isbn),
      language: v.language ? [toBCP47(v.language)] : [],
      description: v.description ? htmlToText(v.description) : '',
      subjects: uniq((v.categories ?? []).flatMap((c) => c.split(/\s*\/\s*/)).filter((c) => c && c !== 'General')).slice(0, 6),
      cover: img ? { thumb: img.replace(/^http:/, 'https:'), embeddable: false } : null,
      url: v.infoLink,
    };
  });
}

export const SOURCES = {
  apple: { label: 'Apple Books', short: 'Apple', search: apple, hint: 'Große Cover, Beschreibungen' },
  dnb: { label: 'Deutsche Nationalbibliothek', short: 'DNB', search: dnb, hint: 'Verlag, Datum, ISBN, Reihe' },
  openlibrary: { label: 'Open Library', short: 'Open Library', search: openlibrary, hint: 'Cover, ISBN, Schlagwörter' },
  google: { label: 'Google Books', short: 'Google', search: google, hint: 'Beschreibungen, Verlag' },
};

export const SOURCE_ORDER = ['apple', 'dnb', 'openlibrary', 'google'];

/** Lädt ein Cover als Blob (nur bei Quellen mit CORS). */
export async function fetchCover(url, signal) {
  const res = await fetch(url, { signal, referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`Cover nicht ladbar (${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/') || blob.size < 1200) throw new Error('Kein Cover vorhanden');
  return blob;
}
