// Muster für Dateinamen und Felder, Parser für "Tags aus Dateiname", Textumwandlungen.
//
// Syntax:  {feld}           Feldwert, z. B. {title}
//          {feld:3}         Zahl auf 3 Stellen auffüllen ({track} wird automatisch 2-stellig)
//          {a|b}            erster nicht leerer Wert, z. B. {albumartist|artist}
//          [ … ]            optionaler Abschnitt – entfällt, wenn ein Feld darin leer ist
import { FIELD_KEYS } from './fields.js';

export const TOKENS = [
  ['track', 'Track'], ['title', 'Titel'], ['artist', 'Interpret'], ['album', 'Album'],
  ['albumartist|artist', 'Album-Interpret'], ['year', 'Jahr'], ['disc', 'Disc'], ['genre', 'Genre'],
  ['composer', 'Komponist'], ['tracktotal', 'Tracks gesamt'], ['filename', 'Dateiname'], ['folder', 'Ordner'],
];

const NUMERIC = new Set(['track', 'tracktotal', 'disc', 'disctotal', 'year', 'bpm']);

export function tokenValues(file, valueOf, rootName = '') {
  const vals = {};
  for (const k of FIELD_KEYS) vals[k] = valueOf(file, k);
  vals.filename = file.name.replace(/\.[^.]+$/, '');
  vals.folder = file.dir ? file.dir.split('/').pop() : rootName;
  vals.ext = file.ext;
  return vals;
}

export function sanitizeSegment(s) {
  return String(s)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '-')
    .replace(/:\s/g, ' - ')
    .replace(/:/g, '-')
    .replace(/"/g, "'")
    .replace(/[*?<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveToken(inner, vals, forPath) {
  const [names, pad] = inner.split(':');
  const alternatives = names.split('|').map((n) => n.trim());
  let v = '';
  for (const n of alternatives) {
    v = String(vals[n] ?? '').trim();
    if (v) break;
  }
  if (/^\d+$/.test(v)) {
    const width = pad ? parseInt(pad, 10) : alternatives[0] === 'track' ? Math.max(2, String(parseInt(vals.tracktotal, 10) || '').length) : 0;
    if (width) v = v.replace(/^0+(?=\d)/, '').padStart(width, '0');
  }
  return forPath ? sanitizeSegment(v) : v;
}

export function formatPattern(pattern, vals, { forPath = false } = {}) {
  const render = (str) => {
    let missing = false;
    const out = str.replace(/\{([^{}]+)\}/g, (m, inner) => {
      const v = resolveToken(inner, vals, forPath);
      if (!v) missing = true;
      return v;
    });
    return { out, missing };
  };
  const withGroups = pattern.replace(/\[([^[\]]*)\]/g, (m, inner) => {
    const r = render(inner);
    return r.missing ? '' : r.out;
  });
  return render(withGroups).out;
}

// Relativer Pfad (ohne Endung) aus einem Muster; "/" im Muster erzeugt Unterordner.
export function buildPath(pattern, vals) {
  return formatPattern(pattern, vals, { forPath: true })
    .split('/')
    .map((seg) => seg.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '').slice(0, 180))
    .filter(Boolean)
    .join('/');
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileParser(pattern) {
  const fields = [];
  let re = '';
  for (const part of pattern.split(/(\{[^{}]+\})/)) {
    if (!part) continue;
    const m = part.match(/^\{([^{}]+)\}$/);
    if (m) {
      const name = m[1].trim().toLowerCase();
      fields.push(name);
      re += NUMERIC.has(name) ? '(\\d+)' : '([^/]+?)';
    } else {
      re += escapeRegex(part).replace(/\s+/g, '\\s+');
    }
  }
  return { regex: new RegExp(`^${re}$`, 'iu'), fields, depth: (pattern.match(/\//g) || []).length };
}

export function parsePath(parser, file, rootName) {
  const segments = [rootName, ...file.path.split('/')].filter(Boolean);
  const str = segments.slice(-(parser.depth + 1)).join('/').replace(/\.[^./]+$/, '');
  const m = parser.regex.exec(str);
  if (!m) return null;
  const result = {};
  parser.fields.forEach((f, i) => {
    if (!FIELD_KEYS.includes(f)) return;
    let v = m[i + 1].trim();
    if (NUMERIC.has(f) && /^\d+$/.test(v) && f !== 'year') v = String(parseInt(v, 10));
    result[f] = v;
  });
  return result;
}

/* ------------------------------------------------------- Textumwandlungen */

export function changeCase(s, mode, keepUpper = true) {
  if (!s) return s;
  if (mode === 'lower') return s.toLocaleLowerCase('de');
  if (mode === 'upper') return s.toLocaleUpperCase('de');
  if (mode === 'sentence') {
    const lower = s.toLocaleLowerCase('de');
    return lower.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (m, pre, c) => pre + c.toLocaleUpperCase('de'));
  }
  return s.replace(/[\p{L}\p{N}'’]+/gu, (word) => {
    if (keepUpper && word.length > 1 && /\p{Lu}/u.test(word) && word === word.toLocaleUpperCase('de')) return word;
    const lower = word.toLocaleLowerCase('de');
    return lower.charAt(0).toLocaleUpperCase('de') + lower.slice(1);
  });
}

const JUNK = /\s*[([](?:official\s+(?:music\s+)?(?:video|audio|lyric\s+video|visualizer)|lyrics?(?:\s+video)?|audio|hd|hq|4k|visualizer|video\s+oficial)[)\]]/gi;

export function cleanup(s, opts) {
  let v = s;
  if (opts.underscores) v = v.replace(/_/g, ' ');
  if (opts.junk) v = v.replace(JUNK, '');
  if (opts.feat) v = v.replace(/\b(?:featuring|feat|ft)\b\.?/gi, 'feat.');
  if (opts.spaces) v = v.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
  return v;
}

export const stripTrackPrefix = (s) => s.replace(/^\s*\d{1,3}\s*[-–._)]\s*(?=\S)/, '');
