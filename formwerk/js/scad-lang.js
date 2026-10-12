// Sprachwissen über OpenSCAD: eingebaute Module, Funktionen, Schlüsselwörter.
// Wird für Syntaxfarben, Autovervollständigung und Hilfetexte genutzt.

export const MODULES = {
  cube: ['size, center', 'Würfel oder Quader – size = Zahl oder [x, y, z]'],
  sphere: ['r | d', 'Kugel mit Radius r oder Durchmesser d'],
  cylinder: ['h, r | r1, r2 | d, center', 'Zylinder oder Kegel (r1 unten, r2 oben)'],
  polyhedron: ['points, faces, convexity', 'Beliebiger Körper aus Punkten und Flächen'],
  square: ['size, center', 'Quadrat oder Rechteck (2D)'],
  circle: ['r | d', 'Kreis (2D)'],
  polygon: ['points, paths', 'Vieleck aus Punkten (2D)'],
  text: ['text, size, font, halign, valign, spacing', 'Text als 2D-Form'],
  import: ['file, convexity', 'STL, OFF, 3MF, SVG oder DXF einlesen'],
  surface: ['file, center, invert', 'Höhenkarte aus Bild oder Zahlen'],
  linear_extrude: ['height, center, twist, slices, scale', '2D-Form in die Höhe ziehen'],
  rotate_extrude: ['angle, convexity', '2D-Form um die Z-Achse drehen'],
  translate: ['[x, y, z]', 'Verschieben'],
  rotate: ['[x, y, z] | a, v', 'Drehen (Grad)'],
  scale: ['[x, y, z]', 'Skalieren'],
  resize: ['newsize, auto', 'Auf feste Größe bringen'],
  mirror: ['[x, y, z]', 'Spiegeln an der Ebene mit diesem Normalenvektor'],
  multmatrix: ['m', 'Beliebige 4×4-Transformationsmatrix'],
  color: ['c, alpha', 'Einfärben – Name, "#rrggbb" oder [r, g, b, a]'],
  offset: ['r | delta, chamfer', '2D-Kontur vergrößern oder verkleinern'],
  hull: ['', 'Konvexe Hülle aller Kinder'],
  minkowski: ['convexity', 'Minkowski-Summe (z. B. zum Abrunden)'],
  union: ['', 'Vereinigung'],
  difference: ['', 'Erstes Kind minus alle weiteren'],
  intersection: ['', 'Schnittmenge'],
  projection: ['cut', '3D auf die XY-Ebene projizieren'],
  render: ['convexity', 'Vorab vollständig berechnen'],
  children: ['index', 'Kinder eines Moduls einsetzen'],
  echo: ['…', 'Werte in der Konsole ausgeben'],
  assert: ['condition, message', 'Bedingung prüfen, sonst Fehler'],
  roof: ['method', 'Dach über 2D-Form (experimentell)'],
};

export const FUNCTIONS = {
  abs: ['x', 'Betrag'], sign: ['x', 'Vorzeichen'], sin: ['grad', 'Sinus (Grad)'], cos: ['grad', 'Kosinus (Grad)'],
  tan: ['grad', 'Tangens (Grad)'], asin: ['x', 'Arkussinus'], acos: ['x', 'Arkuskosinus'], atan: ['x', 'Arkustangens'],
  atan2: ['y, x', 'Winkel von (x, y)'], floor: ['x', 'Abrunden'], round: ['x', 'Runden'], ceil: ['x', 'Aufrunden'],
  ln: ['x', 'Natürlicher Logarithmus'], log: ['x', 'Zehnerlogarithmus'], pow: ['basis, exponent', 'Potenz'],
  sqrt: ['x', 'Quadratwurzel'], exp: ['x', 'e hoch x'], min: ['a, b, …', 'Kleinster Wert'], max: ['a, b, …', 'Größter Wert'],
  norm: ['v', 'Länge eines Vektors'], cross: ['a, b', 'Kreuzprodukt'], len: ['liste', 'Länge von Liste oder Text'],
  concat: ['a, b, …', 'Listen verbinden'], lookup: ['key, tabelle', 'Wert interpolieren'], str: ['…', 'Zu Text verbinden'],
  chr: ['code', 'Zeichen aus Code'], ord: ['zeichen', 'Code eines Zeichens'], search: ['suche, in', 'Suchen'],
  rands: ['min, max, anzahl, seed', 'Zufallszahlen'], version: ['', 'OpenSCAD-Version'], version_num: ['', 'Versionsnummer'],
  parent_module: ['n', 'Name eines Elternmoduls'], is_undef: ['x', 'Ist undef?'], is_bool: ['x', 'Ist Wahrheitswert?'],
  is_num: ['x', 'Ist Zahl?'], is_string: ['x', 'Ist Text?'], is_list: ['x', 'Ist Liste?'], is_function: ['x', 'Ist Funktion?'],
};

export const KEYWORDS = ['module', 'function', 'include', 'use', 'if', 'else', 'for', 'let', 'each', 'intersection_for', 'assert', 'echo'];
export const ATOMS = ['true', 'false', 'undef', 'PI'];
export const SPECIALS = {
  $fn: 'Anzahl Segmente für Rundungen', $fa: 'Minimaler Winkel pro Segment', $fs: 'Minimale Segmentlänge',
  $t: 'Animationszeit 0…1', $preview: 'true in der Vorschau', $children: 'Anzahl der Kinder',
  $vpr: 'Kameradrehung', $vpt: 'Kameraziel', $vpd: 'Kameraabstand', $vpf: 'Kamera-Blickwinkel',
};

// Benutzerdefinierte Module, Funktionen und Variablen aus dem Quelltext
export function scanSymbols(src) {
  const out = { modules: new Map(), functions: new Map(), variables: new Set() };
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  let m;
  const reMod = /\bmodule\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/g;
  while ((m = reMod.exec(clean))) out.modules.set(m[1], m[2].replace(/\s+/g, ' ').trim());
  const reFn = /\bfunction\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/g;
  while ((m = reFn.exec(clean))) out.functions.set(m[1], m[2].replace(/\s+/g, ' ').trim());
  const reVar = /(?:^|[;{}\n])\s*([A-Za-z_$][\w]*)\s*=(?!=)/g;
  while ((m = reVar.exec(clean))) if (!m[1].startsWith('$')) out.variables.add(m[1]);
  return out;
}

// Welche Bibliotheken bindet der Quelltext ein?
export function findIncludes(src) {
  const out = [];
  const re = /^\s*(include|use)\s*<([^>]+)>/gm;
  let m;
  while ((m = re.exec(src))) out.push({ kind: m[1], path: m[2].trim() });
  return out;
}
