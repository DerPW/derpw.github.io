// Sprachcodes: Anzeige-Namen und Umrechnung von ISO 639-2 (MARC, Open Library) nach BCP 47.

const ISO2 = {
  ger: 'de', deu: 'de', eng: 'en', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', dut: 'nl', nld: 'nl', por: 'pt',
  swe: 'sv', dan: 'da', nor: 'no', nob: 'nb', nno: 'nn', fin: 'fi', pol: 'pl', cze: 'cs', ces: 'cs', slo: 'sk',
  slk: 'sk', hun: 'hu', rum: 'ro', ron: 'ro', gre: 'el', ell: 'el', tur: 'tr', rus: 'ru', ukr: 'uk', bul: 'bg',
  hrv: 'hr', srp: 'sr', slv: 'sl', lit: 'lt', lav: 'lv', est: 'et', ice: 'is', isl: 'is', gle: 'ga', wel: 'cy',
  cym: 'cy', lat: 'la', heb: 'he', ara: 'ar', per: 'fa', fas: 'fa', hin: 'hi', chi: 'zh', zho: 'zh', jpn: 'ja',
  kor: 'ko', vie: 'vi', tha: 'th', ind: 'id', may: 'ms', msa: 'ms', cat: 'ca', baq: 'eu', eus: 'eu', glg: 'gl',
  epo: 'eo', afr: 'af', ltz: 'lb', gsw: 'gsw', yid: 'yi',
};

const MARC = { de: 'ger', en: 'eng', fr: 'fre', es: 'spa', it: 'ita', nl: 'dut', pt: 'por', sv: 'swe', da: 'dan', no: 'nor', nb: 'nob', fi: 'fin', pl: 'pol', cs: 'cze', hu: 'hun', ru: 'rus', tr: 'tur', el: 'gre', la: 'lat', ja: 'jpn', zh: 'chi' };
export const toMARC = (code) => MARC[String(code ?? '').toLowerCase().split('-')[0]] ?? '';

export function toBCP47(code) {
  const c = String(code ?? '').trim();
  if (!c) return '';
  const lower = c.toLowerCase();
  if (ISO2[lower]) return ISO2[lower];
  return /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(c) ? c.replace(/_/g, '-') : '';
}

let names = null;
try { names = new Intl.DisplayNames(['de'], { type: 'language' }); } catch { /* alter Browser */ }

export function languageName(code) {
  const c = toBCP47(code) || code;
  try {
    const n = names?.of(c);
    if (n && n.toLowerCase() !== c.toLowerCase()) return n;
  } catch { /* ungültiger Code */ }
  return code;
}

export const COMMON_LANGUAGES = ['de', 'en', 'fr', 'es', 'it', 'nl', 'pt', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'ru', 'tr', 'ja', 'zh', 'la'];

/** Nimmt „Deutsch“, „german“, „de-DE“ oder „ger“ und gibt einen Code zurück. */
export function parseLanguage(input) {
  const t = String(input ?? '').trim();
  if (!t) return '';
  const code = toBCP47(t);
  if (code && (code.length <= 3 || code.includes('-'))) {
    if (languageName(code) !== code || code.includes('-')) return code;
  }
  const lower = t.toLowerCase();
  const all = [...new Set([...COMMON_LANGUAGES, ...Object.values(ISO2)])];
  for (const c of all) {
    if (languageName(c).toLowerCase() === lower) return c;
    try {
      if (new Intl.DisplayNames(['en'], { type: 'language' }).of(c).toLowerCase() === lower) return c;
    } catch { /* weiter */ }
  }
  return code || t;
}
