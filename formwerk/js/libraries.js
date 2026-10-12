// Bibliotheken wie BOSL2 oder MCAD bei Bedarf nachladen: Sobald der Code
// "include <BOSL2/std.scad>" enthält, werden die nötigen Dateien (rekursiv)
// von jsDelivr geholt und unter /libraries ins virtuelle Dateisystem gelegt.

export const LIB_ROOT = '/libraries';

export const LIBRARIES = {
  BOSL2: {
    url: 'https://cdn.jsdelivr.net/gh/BelfrySCAD/BOSL2@v2.0.762/',
    home: 'https://github.com/BelfrySCAD/BOSL2',
    desc: 'Riesige Sammlung: abgerundete Formen, Gewinde, Zahnräder, Verbinder, Attachments',
    example: 'include <BOSL2/std.scad>',
    license: 'BSD-2-Clause',
  },
  MCAD: {
    url: 'https://cdn.jsdelivr.net/gh/openscad/MCAD@bd0a7ba3f042bfbced5ca1894b236cea08904e26/',
    home: 'https://github.com/openscad/MCAD',
    desc: 'Klassische Mechanik-Bibliothek: Zahnräder, Schrauben, Lager, Motoren',
    example: 'use <MCAD/involute_gears.scad>',
    license: 'LGPL-2.1',
  },
};

const cache = new Map(); // "BOSL2/std.scad" → Promise<Uint8Array|null>
const dec = new TextDecoder();

function fetchLibFile(rel, fetchFn) {
  if (!cache.has(rel)) {
    const [lib, ...rest] = rel.split('/');
    const url = LIBRARIES[lib].url + rest.map(encodeURIComponent).join('/');
    const p = fetchFn(url)
      .then((r) => (r.ok ? r.arrayBuffer().then((b) => new Uint8Array(b)) : null))
      .catch((e) => { cache.delete(rel); throw e; });
    cache.set(rel, p);
  }
  return cache.get(rel);
}

function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

export function includesOf(text) {
  const out = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const re = /\b(?:include|use)\s*<([^>]+)>/g;
  let m;
  while ((m = re.exec(clean))) out.push(m[1].trim());
  return out;
}

export function usedLibraries(source) {
  const libs = new Set();
  for (const p of includesOf(source)) {
    const first = normalize(p).split('/')[0];
    if (first in LIBRARIES) libs.add(first);
  }
  return [...libs];
}

// Liefert { files: { '/libraries/BOSL2/std.scad': Uint8Array, … }, missing: [...], libs: [...] }
export async function resolveLibraries(source, { fetchFn = fetch, onProgress } = {}) {
  const libs = usedLibraries(source);
  if (!libs.length) return { files: {}, missing: [], libs };

  const files = {};
  const missing = [];
  const seen = new Set();
  let done = 0;

  // dir: Verzeichnis der einbindenden Datei relativ zu LIB_ROOT ('' = Hauptdatei)
  async function visit(includePath, dir) {
    const candidates = [];
    if (dir) candidates.push(normalize(`${dir}/${includePath}`));
    candidates.push(normalize(includePath));
    for (const rel of candidates) {
      const lib = rel.split('/')[0];
      if (!(lib in LIBRARIES)) continue;
      if (seen.has(rel)) return;
      seen.add(rel);
      const data = await fetchLibFile(rel, fetchFn);
      if (!data) { seen.delete(rel); continue; }
      files[`${LIB_ROOT}/${rel}`] = data;
      done++;
      onProgress?.({ done, path: rel });
      const subdir = rel.split('/').slice(0, -1).join('/');
      await Promise.all(includesOf(dec.decode(data)).map((p) => visit(p, subdir)));
      return;
    }
    const first = normalize(includePath).split('/')[0];
    if (first in LIBRARIES || dir) missing.push(includePath);
  }

  await Promise.all(includesOf(source).map((p) => visit(p, '')));
  return { files, missing: [...new Set(missing)], libs };
}
