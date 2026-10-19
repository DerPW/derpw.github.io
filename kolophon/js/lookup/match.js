// Treffer bewerten und aus mehreren Quellen einen Vorschlag zusammensetzen.
import { isbn10to13, normalizeISBN, normalizeField, sortName } from '../epub/text.js';

export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/&/g, ' und ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ARTICLES = new Set(['der', 'die', 'das', 'the', 'a', 'an', 'ein', 'eine', 'le', 'la', 'les', 'el', 'und', 'and']);
const mainTitle = (s) => norm(String(s ?? '').split(/\s[:–—-]\s|:\s|\(|\[/)[0]);

function bigrams(s) {
  const out = new Map();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) ?? 0); total += n; }
  for (const n of B.values()) total += n;
  return (2 * inter) / total;
}

const words = (s) => s.split(' ').filter((w) => w && !ARTICLES.has(w));

export function titleScore(a, b) {
  const x = mainTitle(a);
  const y = mainTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const wx = words(x);
  const wy = words(y);
  const setY = new Set(wy);
  const contained = wx.length && wx.every((w) => setY.has(w));
  const setX = new Set(wx);
  const contained2 = wy.length && wy.every((w) => setX.has(w));
  const base = dice(x, y);
  return Math.max(base, contained || contained2 ? 0.88 : 0);
}

const lastName = (name) => {
  const n = norm(String(name).includes(',') ? String(name).split(',')[0] : String(name).split(/\s+/).at(-1));
  return n;
};

export function authorScore(as, bs) {
  if (!as?.length || !bs?.length) return null;
  let best = 0;
  for (const a of as) {
    for (const b of bs) {
      const la = lastName(a);
      const lb = lastName(b);
      const s = la && la === lb ? 1 : Math.max(dice(norm(a), norm(b)), dice(la, lb) * 0.9);
      best = Math.max(best, s);
    }
  }
  return best;
}

/** 0 … 1 – wie gut passt ein Treffer zu einem Buch? */
export function score(book, r) {
  const bi = book.isbn && isbn10to13(normalizeISBN(book.isbn));
  const ri = r.isbn && isbn10to13(normalizeISBN(r.isbn));
  if (bi && ri && bi === ri) { r.isbnMatch = true; return 1; }
  const t = Math.max(titleScore(book.title, r.title), r.subtitle ? titleScore(book.title, `${r.title} ${r.subtitle}`) : 0);
  const a = authorScore(book.authors, r.authors);
  let bonus = r.format === 'ebook' ? 0.02 : 0;
  const by = String(book.date ?? '').match(/\d{4}/)?.[0];
  const ry = String(r.date ?? '').match(/\d{4}/)?.[0];
  if (by && ry) bonus += by === ry ? 0.03 : -0.02;
  if (a == null) return Math.min(1, t * (book.authors?.length ? 0.75 : 0.92) + bonus);
  return Math.min(0.99, t * 0.62 + a * 0.38 - (a < 0.4 ? 0.12 : 0) + bonus);
}

export const AUTO_THRESHOLD = 0.72;

/** Reihenfolge, in der Quellen für ein Feld bevorzugt werden. */
const PRIORITY = {
  title: ['dnb', 'google', 'apple', 'openlibrary'],
  authors: ['dnb', 'google', 'apple', 'openlibrary'],
  authorSort: ['dnb'],
  translators: ['dnb'],
  cover: ['apple', 'openlibrary'],
  description: ['google', 'apple', 'openlibrary'],
  publisher: ['dnb', 'google', 'openlibrary'],
  date: ['dnb', 'google', 'openlibrary', 'apple'],
  isbn: ['dnb', 'google', 'openlibrary'],
  language: ['dnb', 'google', 'openlibrary'],
  subjects: ['apple', 'google', 'dnb', 'openlibrary'],
  series: ['dnb'],
  seriesIndex: ['dnb'],
};

export const MERGE_FIELDS = Object.keys(PRIORITY);

const hasValue = (field, v) => {
  if (field === 'cover') return Boolean(v?.embeddable && v.full);
  const n = normalizeField(field, v);
  return Array.isArray(n) ? n.length > 0 : Boolean(n);
};

// Felder, die zu einer bestimmten Ausgabe gehören – nur übernehmen, wenn eindeutig
const EDITION = new Set(['isbn', 'publisher', 'date']);

/**
 * Setzt einen Vorschlag zusammen: Was der gewählte Treffer hat, gilt. Lücken kommen aus anderen Treffern
 * zum selben Werk – ausgabenspezifische Angaben (ISBN, Verlag, Datum) nur, wenn eine Quelle dafür genau
 * einen Wert liefert (bevorzugt E-Book-Ausgaben), damit keine fremde Ausgabe hineingemischt wird.
 */
export function merge(primary, candidates, { strict = false } = {}) {
  const same = candidates.filter((c) => c !== primary && samebook(primary, c));
  const out = { sources: {}, primary };
  const take = (field, c) => { out[field] = c[field]; out.sources[field] = c.source; };
  // Automatisch gewählt und ohne ISBN-Treffer: Auch der Haupttreffer muss für Ausgabe-Felder eindeutig sein
  const isbnMatch = strict && primary.isbnMatch;
  for (const field of MERGE_FIELDS) {
    const strictHere = strict && EDITION.has(field) && !isbnMatch;
    if (hasValue(field, primary[field]) && !strictHere) { take(field, primary); continue; }
    const order = PRIORITY[field];
    const pool = [...(strictHere ? [primary] : []), ...same].filter((c) => hasValue(field, c[field])).sort((a, b) => rank(order, a.source) - rank(order, b.source));
    if (!pool.length) continue;
    if (!EDITION.has(field)) { take(field, pool[0]); continue; }
    for (const src of [...new Set(pool.map((c) => c.source))]) {
      const list = pool.filter((c) => c.source === src);
      const ebooks = list.filter((c) => c.format === 'ebook');
      const use = ebooks.length ? ebooks : list;
      const values = new Set(use.map((c) => JSON.stringify(normalizeField(field, field === 'date' ? String(c.date).slice(0, 4) : c[field]))));
      const editions = use.reduce((n, c) => n + (c.editions ?? 1), 0);
      if (values.size === 1 && (!strictHere || editions === 1)) { take(field, use[0]); break; }
    }
  }
  if (out.series && !out.seriesIndex) delete out.series;
  if (out.authors?.length && !out.authorSort) out.authorSort = sortName(out.authors[0]);
  return out;
}

const rank = (order, s) => { const i = order.indexOf(s); return i < 0 ? 99 : i; };

export function samebook(a, b) {
  const ia = a.isbn && isbn10to13(a.isbn);
  const ib = b.isbn && isbn10to13(b.isbn);
  if (ia && ib) return ia === ib || (titleScore(a.title, b.title) > 0.9 && (authorScore(a.authors, b.authors) ?? 0) > 0.85);
  return titleScore(a.title, b.title) > 0.85 && (authorScore(a.authors, b.authors) ?? 0.5) > 0.8;
}
