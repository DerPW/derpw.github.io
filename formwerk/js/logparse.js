// Ordnet die Textausgabe von OpenSCAD in Meldungen mit Stufe, Datei und Zeile.

export const MAIN_FILE = '/input.scad';

// Zeilen, die im Browser nur Lärm sind
const NOISE = [
  /^Could not initialize localization/,
  /^Fontconfig error: Cannot load default config file/,
  /^Current top level object is not a [23]D object\.?$/,
  /^Can't parse file/,
  /^Execution aborted/,
];

// Häufige Meldungen auf Deutsch (das Original bleibt als Tooltip erhalten)
const GERMAN = [
  [/^Parser error: syntax error$/, () => 'Syntaxfehler – fehlt ein Semikolon, eine Klammer oder ein Wert?'],
  [/^Parser error: (.*)$/, (m) => `Syntaxfehler: ${m[1]}`],
  [/^Ignoring unknown module '([^']+)'$/, (m) => `Unbekanntes Modul „${m[1]}“ – wird ignoriert`],
  [/^Ignoring unknown function '([^']+)'$/, (m) => `Unbekannte Funktion „${m[1]}“`],
  [/^Ignoring unknown variable "([^"]+)"$/, (m) => `Unbekannte Variable „${m[1]}“`],
  [/^undefined operation \((.*)\)$/, (m) => `Rechnung nicht möglich (${m[1]})`],
  [/^Can't open (?:import |include |library |use )?file '([^']+)'!?$/, (m) => `Datei „${m[1]}“ nicht gefunden`],
  [/^Can't open library '([^']+)'\.?$/, (m) => `Bibliothek „${m[1]}“ nicht gefunden`],
  [/^Recursion detected/, () => 'Endlose Rekursion – ruft sich ein Modul oder eine Funktion selbst auf?'],
  [/^Assertion '(.*)' failed(?:: (.*))?$/, (m) => `Bedingung nicht erfüllt: ${m[2] ?? m[1]}`],
];

const STATS = [
  /^Geometries in cache:/, /^Geometry cache size in bytes:/, /^CGAL Polyhedrons in cache:/,
  /^CGAL cache size in bytes:/, /^Total rendering time:/, /^\s*Top level object is/, /^\s+(Status|Genus|Vertices|Facets|Triangles|Convex|Contours|Volumes|Halfedges|Edges|Halffacets|Simple):/,
  /^Rendering Polygon Mesh/, /^Normalized tree/, /^Compiling design/, /^Parsing design/,
];

export function parseLine(raw) {
  const text = raw.replace(/\s+$/, '');
  if (!text) return null;
  if (NOISE.some((r) => r.test(text))) return null;

  let level = 'info';
  let msg = text;
  let m;
  if ((m = /^ECHO: ?(.*)$/s.exec(text))) { level = 'echo'; msg = m[1]; }
  else if ((m = /^WARNING: ?(.*)$/s.exec(text))) { level = 'warning'; msg = m[1]; }
  else if ((m = /^DEPRECATED: ?(.*)$/s.exec(text))) { level = 'warning'; msg = m[1]; }
  else if ((m = /^(?:ERROR|FATAL): ?(.*)$/s.exec(text))) { level = 'error'; msg = m[1]; }
  else if ((m = /^TRACE: ?(.*)$/s.exec(text))) { level = 'trace'; msg = m[1]; }
  else if (/^Can't parse file/.test(text)) { level = 'error'; }
  else if (/^Current top level object is empty/.test(text)) { level = 'warning'; msg = 'Das Modell ist leer – es wurde nichts erzeugt.'; }
  else if (STATS.some((r) => r.test(text))) { level = 'stat'; }

  let file = null, line = null;
  if ((m = /,? in file (.+?), line (\d+)\.?/.exec(msg))) {
    file = m[1];
    line = Number(m[2]);
    msg = msg.replace(m[0], '').trim();
  }
  if (file === MAIN_FILE) file = null;
  let original = null;
  if (level === 'error' || level === 'warning') {
    for (const [re, fn] of GERMAN) {
      const g = re.exec(msg);
      if (g) { original = msg; msg = fn(g); break; }
    }
  }
  return { level, text: msg, file, line, original };
}

export function parseLog(lines) {
  const out = [];
  for (const l of lines) {
    const p = parseLine(l);
    if (p) out.push(p);
  }
  return out;
}

export function summarize(messages) {
  const s = { error: 0, warning: 0, echo: 0 };
  for (const m of messages) if (m.level in s) s[m.level]++;
  return s;
}
