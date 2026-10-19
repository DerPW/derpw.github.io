// Normalisierung von Feldwerten und Umgang mit HTML-Beschreibungen.

const HTML_ENTITIES = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  copy: '©', reg: '®', trade: '™', deg: '°', para: '¶', sect: '§', euro: '€', pound: '£', times: '×', divide: '÷',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', ecirc: 'ê',
  aacute: 'á', agrave: 'à', acirc: 'â', iacute: 'í', oacute: 'ó', uacute: 'ú', ccedil: 'ç', ntilde: 'ñ', oslash: 'ø',
  aring: 'å', aelig: 'æ', Eacute: 'É', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

export function decodeHTML(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return HTML_ENTITIES[e] ?? m;
  });
}

const HTML_RE = /<\/?(p|br|div|span|b|i|em|strong|u|ul|ol|li|h[1-6]|a|blockquote|small|sup|sub|font)\b[^>]*>/i;
export const looksLikeHTML = (s) => HTML_RE.test(s);

export function htmlToText(html) {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|ul|ol|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return normalizeDescription(decodeHTML(s));
}

export function normalizeDescription(s) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n[ \t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escHTML = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Beschreibung für die OPF: Absätze als HTML (wie Calibre), einzelne Zeile als reiner Text. */
export function descriptionToStore(text, preferHTML) {
  const t = normalizeDescription(text);
  if (!t) return '';
  if (!preferHTML && !t.includes('\n')) return t;
  return t.split(/\n\n/).map((p) => `<p>${escHTML(p).replace(/\n/g, '<br/>')}</p>`).join('');
}

export function normalizeISBN(s) {
  return String(s ?? '').replace(/^(urn:isbn:|isbn[:\s]*)/i, '').replace(/[\s\-‐‑–]/g, '').toUpperCase();
}

export function isValidISBN(s) {
  const d = normalizeISBN(s);
  if (/^\d{9}[\dX]$/.test(d)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (d[i] === 'X' ? 10 : +d[i]) * (10 - i);
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(d)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += +d[i] * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  return false;
}

export function isbn10to13(s) {
  const d = normalizeISBN(s);
  if (!/^\d{9}[\dX]$/.test(d)) return d;
  const base = `978${d.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +base[i] * (i % 2 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

/** Datum lesbar machen: Calibre-Zeitstempel kürzen, Platzhalter „0101-01-01“ verwerfen. */
export function normalizeDate(s) {
  let d = String(s ?? '').trim();
  if (!d || /^0?101-01-01/.test(d) || /^0000/.test(d)) return '';
  d = d.replace(/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|[+-]00:?00)?$/, '$1');
  return d;
}

export const yearOf = (s) => (String(s ?? '').match(/\d{4}/) ?? [''])[0];

export const LIST_FIELDS = new Set(['authors', 'translators', 'language', 'subjects']);

export function normalizeField(field, value) {
  if (LIST_FIELDS.has(field)) {
    const seen = new Set();
    const out = [];
    for (const v of Array.isArray(value) ? value : value ? [value] : []) {
      const t = String(v).replace(/\s+/g, ' ').trim();
      if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
    }
    return out;
  }
  if (field === 'description') return normalizeDescription(value);
  if (field === 'isbn') return normalizeISBN(value);
  if (field === 'date') return normalizeDate(value);
  if (field === 'seriesIndex') {
    const t = String(value ?? '').trim().replace(',', '.');
    const n = Number(t);
    return t && Number.isFinite(n) ? String(n) : t;
  }
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function sameValue(field, a, b) {
  const x = normalizeField(field, a);
  const y = normalizeField(field, b);
  return Array.isArray(x) ? x.length === y.length && x.every((v, i) => v === y[i]) : x === y;
}

/** „Vorname Nachname“ → „Nachname, Vorname“ (für Sortierfelder). */
export function sortName(name) {
  const n = String(name ?? '').trim();
  if (!n || n.includes(',')) return n;
  const parts = n.split(/\s+/);
  if (parts.length < 2) return n;
  const particles = new Set(['von', 'van', 'de', 'der', 'den', 'du', 'da', 'di', 'zu', 'le', 'la', 'ten', 'ter']);
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts.at(-1)) ? parts.pop() : '';
  let i = parts.length - 1;
  while (i > 1 && particles.has(parts[i - 1].toLowerCase())) i--;
  const last = parts.slice(i).join(' ');
  const first = parts.slice(0, i).join(' ');
  return `${last}, ${first}${suffix ? `, ${suffix}` : ''}`;
}

/** „Nachname, Vorname“ → „Vorname Nachname“. */
export function displayName(name) {
  const n = String(name ?? '').trim();
  const m = n.match(/^([^,]+),\s*([^,]+)$/);
  return m ? `${m[2]} ${m[1]}` : n;
}
