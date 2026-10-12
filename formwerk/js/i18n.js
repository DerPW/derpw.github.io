// Sprache: Deutsch oder Englisch. Automatisch nach Systemsprache, umstellbar in den Einstellungen.
// Der deutsche Text ist der Schlüssel – fehlt eine Übersetzung, bleibt er stehen.
// Platzhalter in geschweiften Klammern: t('Fertig in {ms}', { ms: '80 ms' })

import { EN } from './i18n-en.js';

export const LANGS = { de: 'Deutsch', en: 'English' };

function readPref() {
  try {
    const s = JSON.parse(localStorage.getItem('formwerk.settings') || '{}');
    return s.lang || 'auto';
  } catch { return 'auto'; }
}

// Erste bevorzugte Sprache, die wir können; sonst Englisch
export function systemLang() {
  const list = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  const first = list.find((l) => /^(de|en)\b/i.test(l || ''));
  return first && /^de/i.test(first) ? 'de' : 'en';
}

export function resolveLang(pref = 'auto') {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  if (q === 'de' || q === 'en') return q;
  if (pref === 'de' || pref === 'en') return pref;
  return systemLang();
}

// globalThis.__FW_LANG erlaubt Tests, die Sprache festzulegen
export let lang = globalThis.__FW_LANG ?? (typeof localStorage !== 'undefined' && typeof location !== 'undefined' ? resolveLang(readPref()) : 'de');
export const locale = () => (lang === 'en' ? 'en-US' : 'de-DE');

// Für Tests
export function setLang(l) { lang = l; }

export function t(de, vars) {
  let s = lang === 'en' ? (EN[de] ?? de) : de;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// Statisches HTML übersetzen: Textknoten und Attribute, deren deutscher Text im Wörterbuch steht
export function translateDocument(root = document.body) {
  document.documentElement.lang = lang;
  if (lang === 'de') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.CodeMirror, [translate="no"], script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue;
    const key = raw.trim();
    if (key && EN[key]) n.nodeValue = raw.replace(key, EN[key]);
  }
  for (const el of root.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const a of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && EN[v]) el.setAttribute(a, EN[v]);
    }
  }
  const desc = document.querySelector('meta[name=description]');
  if (desc && EN[desc.content]) desc.content = EN[desc.content];
  if (EN[document.title]) document.title = EN[document.title];
}
