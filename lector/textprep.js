// Text cleanup and chunking for speech, ported from src/lector/textprep.py.
//
// A chapter is a list of blocks: ['h', text] for headings and ['p', text] for paragraphs.
// planChunks turns it into the pieces the voice reads one at a time. Chunks never split a
// sentence unless the sentence alone is longer than the limit, and each chunk carries the
// pause that follows it, so headings and paragraph ends breathe like a narrator would.

export const PAUSE_SENTENCE = 0.15;
export const PAUSE_PARAGRAPH = 0.45;
export const PAUSE_HEADING = 0.9;

const INVISIBLE = /[­​‌‍⁠﻿]/g;
const SPACES = /[ \t  -   　]+/g;
const FOOTNOTE_MARK = /\[\d{1,3}\]|[¹²³⁰-⁹]+/g;
const DASHES = /\s*--\s*/g;

// Abbreviations that end with a period but do not end a sentence (German and English).
const ABBREVIATIONS = new Set([
  'z', 'b', 'u', 'a', 'd', 'h', 'o', 's', 'v', 'vgl', 'bzw', 'ca', 'usw', 'etc', 'dr', 'prof',
  'nr', 'str', 'st', 'hr', 'fr', 'mr', 'mrs', 'ms', 'jr', 'sr', 'vs', 'no', 'inkl', 'ggf',
  'evtl', 'bspw', 'sog', 'geb', 'gest', 'jh', 'jhd', 'mio', 'mrd', 'abs', 'art', 'bd', 'hrsg',
  'ff', 'f', 'e', 'i', 'al', 'dt', 'engl', 'frz', 'lat', 'min', 'max', 'approx', 'dept',
  'fig', 'gen', 'gov', 'lt', 'col', 'capt', 'sgt', 'rev', 'mt', 'ft',
]);
const SENTENCE_END = /([.!?…]+["'”’»«)\]]*)(\s+)/g;
const isLower = (ch) => ch && ch.toLowerCase() === ch && ch.toUpperCase() !== ch;

export function clean(text) {
  return text.normalize('NFC').replace(INVISIBLE, '').replace(FOOTNOTE_MARK, '')
    .replace(DASHES, ' – ').replace(/\r/g, '\n').replace(/\s*\n\s*/g, ' ')
    .replace(SPACES, ' ').trim();
}

export function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index + m[1].length;
    const before = text.slice(start, end).replace(/["'”’»«)\]]+$/, '');
    const word = before.match(/([\p{L}\p{N}_]+)\.+$/u);
    if (word && m[1].startsWith('.') && ABBREVIATIONS.has(word[1].toLowerCase())) continue;
    // "am 3. Mai", "2. Kapitel": an ordinal, not a sentence end.
    if (word && /^\d{1,2}$/.test(word[1]) && m[1] === '.') continue;
    const next = text.charAt(m.index + m[0].length);
    if (isLower(next)) continue;
    sentences.push(text.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences.filter(Boolean);
}

function splitLong(sentence, maxChars) {
  if (sentence.length <= maxChars) return [sentence];
  const out = [];
  let cur = '';
  for (const part of sentence.split(/(?<=[,;:–—])\s+/)) {
    if (part.length > maxChars) {
      if (cur) { out.push(cur); cur = ''; }
      for (const word of part.split(' ')) {
        if (cur && cur.length + 1 + word.length > maxChars) { out.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
      }
      continue;
    }
    if (cur && cur.length + 1 + part.length > maxChars) { out.push(cur); cur = part; } else cur = cur ? `${cur} ${part}` : part;
  }
  if (cur) out.push(cur);
  return out;
}

const speakable = (text) => /[\p{L}\p{N}]/u.test(text);

export function planChunks(blocks, maxChars) {
  const chunks = [];
  for (const [kind, raw] of blocks) {
    let text = clean(raw);
    if (!speakable(text)) continue;
    if (kind === 'h') {
      if (!'.!?:…'.includes(text.at(-1))) text += '.';
      for (const piece of splitLong(text, maxChars)) chunks.push({ text: piece, pause: PAUSE_SENTENCE });
      chunks.at(-1).pause = PAUSE_HEADING;
      continue;
    }
    const pieces = splitSentences(text).flatMap((s) => splitLong(s, maxChars));
    let cur = '';
    for (const piece of pieces) {
      if (cur && cur.length + 1 + piece.length > maxChars) {
        chunks.push({ text: cur, pause: PAUSE_SENTENCE });
        cur = piece;
      } else cur = cur ? `${cur} ${piece}` : piece;
    }
    if (cur) chunks.push({ text: cur, pause: PAUSE_PARAGRAPH });
  }
  // Join short paragraphs (dialogue lines) into one call; headings keep their own pause.
  const merged = [];
  for (const c of chunks) {
    const prev = merged.at(-1);
    if (prev && prev.pause === PAUSE_PARAGRAPH && c.pause !== PAUSE_HEADING
        && prev.text.length + 1 + c.text.length <= maxChars / 2) {
      prev.text = `${prev.text}\n${c.text}`;
      prev.pause = c.pause;
    } else merged.push({ ...c });
  }
  return merged;
}

const STOPWORDS = {
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'sie', 'er', 'ein', 'eine', 'zu', 'mit', 'auf', 'den', 'dem', 'sich', 'es', 'war', 'auch', 'aber', 'wie', 'noch'],
  en: ['the', 'and', 'is', 'not', 'i', 'you', 'he', 'she', 'a', 'to', 'of', 'it', 'was', 'that', 'with', 'on', 'for', 'but', 'his', 'her', 'had', 'they', 'have'],
  fr: ['le', 'la', 'les', 'et', 'est', 'ne', 'pas', 'je', 'il', 'elle', 'une', 'des', 'que'],
  es: ['el', 'la', 'los', 'las', 'y', 'es', 'no', 'que', 'de', 'un', 'una', 'por', 'con'],
  it: ['il', 'lo', 'la', 'gli', 'e', 'che', 'non', 'un', 'una', 'di', 'per', 'con', 'sono'],
};

export function guessLanguage(text) {
  const words = text.slice(0, 20000).toLowerCase().match(/[a-zäöüßàâçéèêëîïôûùÿñæœ]+/g) || [];
  let best = 'en';
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const score = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (score > bestScore) { best = lang; bestScore = score; }
  }
  return best;
}
