// Baukasten-Modus: Blockly mit eigenen OpenSCAD-Blöcken (Scratch-ähnlich, Zelos-Darstellung).
// Blockly wird erst geladen, wenn man den Modus zum ersten Mal öffnet.

import { createGenerator } from './generator.js';

const BASE = new URL('../../vendor/blockly/', import.meta.url).href;

function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = BASE + src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${src} konnte nicht geladen werden`));
    document.head.appendChild(s);
  });
}

let loading = null;
export function loadBlockly() {
  if (!loading) {
    loading = (async () => {
      await script('blockly_compressed.js');
      await script('blocks_compressed.js');
      await script('msg/de.js');
      const B = window.Blockly;
      setupBlockly(B);
      return B;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

// Eigene Blöcke und Texte registrieren (auch für die Node-Tests)
export function setupBlockly(B) {
  tweakMessages(B);
  defineBlocks(B);
}

/* ------------------------------------------------------------- Icons */

const svg = (inner) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`);
const ICON = {
  cube: svg('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
  sphere: svg('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/>'),
  cylinder: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14a8 3 0 0 0 16 0V5"/>'),
  cone: svg('<path d="M12 3 4 18"/><path d="m12 3 8 15"/><ellipse cx="12" cy="18" rx="8" ry="3"/>'),
  torus: svg('<ellipse cx="12" cy="12" rx="10" ry="6"/><ellipse cx="12" cy="11.5" rx="4" ry="1.8"/>'),
  text: svg('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  square: svg('<rect x="4" y="4" width="16" height="16" rx="1.5"/>'),
  circle: svg('<circle cx="12" cy="12" r="9"/>'),
  hexagon: svg('<path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/>'),
  star: svg('<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>'),
  move: svg('<path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/>'),
  rotate: svg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
  scale: svg('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>'),
  mirror: svg('<path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>'),
  color: svg('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>'),
  union: svg('<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>'),
  difference: svg('<rect x="3" y="3" width="13" height="13" rx="2"/><circle cx="16" cy="16" r="5.5" stroke-dasharray="2.5 2"/>'),
  intersection: svg('<circle cx="9" cy="12" r="6" stroke-dasharray="2.5 2"/><circle cx="15" cy="12" r="6" stroke-dasharray="2.5 2"/><path d="M12 6.8a6 6 0 0 1 0 10.4 6 6 0 0 1 0-10.4z" fill="#fff"/>'),
  hull: svg('<path d="M3 17 8 6h8l5 11z"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>'),
  minkowski: svg('<rect x="5" y="5" width="14" height="14" rx="5"/><circle cx="12" cy="12" r="2"/>'),
  extrude: svg('<path d="M12 3v11"/><path d="m8 7 4-4 4 4"/><rect x="4" y="17" width="16" height="4" rx="1"/>'),
  revolve: svg('<path d="M12 2v20"/><path d="M17 8.5a7 3 0 1 1-10 0"/><path d="m15 6 2 2.5-2.8 1"/>'),
  offset: svg('<rect x="7.5" y="7.5" width="9" height="9" rx="1"/><rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="2.5 2"/>'),
  ring: svg('<circle cx="12" cy="4.5" r="2"/><circle cx="18.5" cy="15.5" r="2"/><circle cx="5.5" cy="15.5" r="2"/><path d="M15 5.5a8 8 0 0 1 4.5 6.5" /><path d="M15 19.5a8 8 0 0 1-6 0"/><path d="M4.5 12A8 8 0 0 1 9 5.5"/>'),
  line: svg('<rect x="2" y="8" width="5" height="8" rx="1"/><rect x="9.5" y="8" width="5" height="8" rx="1"/><rect x="17" y="8" width="5" height="8" rx="1"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  slider: svg('<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>'),
  smooth: svg('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>'),
  echo: svg('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>'),
  code: svg('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
};
const img = (name) => ({ type: 'field_image', src: ICON[name], width: 20, height: 20, alt: '' });

const swatch = (hex) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="${hex}" stroke="#fff" stroke-width="1.5"/></svg>`);
export const COLORS = [
  ['Rot', '#ef4444'], ['Orange', '#f97316'], ['Gelb', '#facc15'], ['Grün', '#22c55e'], ['Türkis', '#14b8a6'],
  ['Hellblau', '#38bdf8'], ['Blau', '#3b82f6'], ['Lila', '#8b5cf6'], ['Pink', '#ec4899'], ['Braun', '#a16207'],
  ['Weiß', '#f8fafc'], ['Grau', '#94a3b8'], ['Schwarz', '#1e293b'],
];

/* ------------------------------------------------------------ Blöcke */

const N = (name) => ({ type: 'input_value', name, check: 'Number' });
const T = (name) => ({ type: 'input_value', name, check: 'String' });
const ANY = (name) => ({ type: 'input_value', name });
const DO = (name = 'DO') => ({ type: 'input_statement', name });
const CHECK = (name = 'CENTER', checked = false) => ({ type: 'field_checkbox', name, checked });
const STMT = { previousStatement: null, nextStatement: null, inputsInline: true };

function defineBlocks(B) {
  const defs = [
    // Körper
    { type: 'fw_cube', message0: '%1 Quader  B %2 T %3 H %4 zentriert %5', args0: [img('cube'), N('X'), N('Y'), N('Z'), CHECK()], style: 'shape3d_blocks', tooltip: 'Quader mit Breite, Tiefe und Höhe (cube)' },
    { type: 'fw_sphere', message0: '%1 Kugel  Radius %2', args0: [img('sphere'), N('R')], style: 'shape3d_blocks', tooltip: 'Kugel (sphere)' },
    { type: 'fw_cylinder', message0: '%1 Zylinder  Höhe %2 Radius %3 zentriert %4', args0: [img('cylinder'), N('H'), N('R'), CHECK()], style: 'shape3d_blocks', tooltip: 'Zylinder (cylinder)' },
    { type: 'fw_cone', message0: '%1 Kegel  Höhe %2 Radius unten %3 oben %4 zentriert %5', args0: [img('cone'), N('H'), N('R1'), N('R2'), CHECK()], style: 'shape3d_blocks', tooltip: 'Kegel oder Kegelstumpf (cylinder mit r1/r2)' },
    { type: 'fw_torus', message0: '%1 Ring  Radius %2 Dicke %3', args0: [img('torus'), N('R'), N('T')], style: 'shape3d_blocks', tooltip: 'Ring/Donut (Torus)' },
    { type: 'fw_text3d', message0: '%1 3D-Text %2 Größe %3 Höhe %4', args0: [img('text'), T('TEXT'), N('S'), N('H')], style: 'shape3d_blocks', tooltip: 'Text als Körper' },
    // Flächen
    { type: 'fw_square', message0: '%1 Rechteck  B %2 T %3 zentriert %4', args0: [img('square'), N('X'), N('Y'), CHECK()], style: 'shape2d_blocks', tooltip: '2D-Rechteck (square)' },
    { type: 'fw_circle', message0: '%1 Kreis  Radius %2', args0: [img('circle'), N('R')], style: 'shape2d_blocks', tooltip: '2D-Kreis (circle)' },
    { type: 'fw_ngon', message0: '%1 Vieleck  Ecken %2 Radius %3', args0: [img('hexagon'), N('N'), N('R')], style: 'shape2d_blocks', tooltip: 'Regelmäßiges Vieleck' },
    { type: 'fw_star', message0: '%1 Stern  Zacken %2 außen %3 innen %4', args0: [img('star'), N('N'), N('A'), N('I')], style: 'shape2d_blocks', tooltip: 'Stern mit äußeren und inneren Radius' },
    { type: 'fw_text2d', message0: '%1 Text %2 Größe %3 Schrift %4', args0: [img('text'), T('TEXT'), N('S'), { type: 'field_dropdown', name: 'FONT', options: [['Sans fett', 'Liberation Sans:style=Bold'], ['Sans', 'Liberation Sans'], ['Serif', 'Liberation Serif'], ['Serif fett', 'Liberation Serif:style=Bold'], ['Mono', 'Liberation Mono'], ['Mono fett', 'Liberation Mono:style=Bold']] }], style: 'shape2d_blocks', tooltip: '2D-Text' },
    // Bewegen
    { type: 'fw_translate', message0: '%1 verschiebe  x %2 y %3 z %4', args0: [img('move'), N('X'), N('Y'), N('Z')], message1: '%1', args1: [DO()], style: 'transform_blocks', tooltip: 'Verschieben (translate)' },
    { type: 'fw_rotate', message0: '%1 drehe  x %2 ° y %3 ° z %4 °', args0: [img('rotate'), N('X'), N('Y'), N('Z')], message1: '%1', args1: [DO()], style: 'transform_blocks', tooltip: 'Drehen um die Achsen (rotate)' },
    { type: 'fw_scale', message0: '%1 skaliere  x %2 y %3 z %4', args0: [img('scale'), N('X'), N('Y'), N('Z')], message1: '%1', args1: [DO()], style: 'transform_blocks', tooltip: 'Strecken oder stauchen (scale)' },
    { type: 'fw_mirror', message0: '%1 spiegle  %2', args0: [img('mirror'), { type: 'field_dropdown', name: 'AXIS', options: [['links ↔ rechts (X)', '[1, 0, 0]'], ['vorne ↔ hinten (Y)', '[0, 1, 0]'], ['oben ↔ unten (Z)', '[0, 0, 1]']] }], message1: '%1', args1: [DO()], style: 'transform_blocks', tooltip: 'Spiegeln (mirror)' },
    { type: 'fw_color', message0: '%1 färbe  %2 Deckkraft %3 %', args0: [img('color'), { type: 'field_dropdown', name: 'COLOR', options: COLORS.map(([n, hex]) => [{ src: swatch(hex), width: 18, height: 18, alt: n }, hex]) }, N('ALPHA')], message1: '%1', args1: [DO()], style: 'transform_blocks', tooltip: 'Einfärben (color)' },
    // Kombinieren
    { type: 'fw_union', message0: '%1 vereinige', args0: [img('union')], message1: '%1', args1: [DO()], style: 'combine_blocks', tooltip: 'Alles zu einem Körper verbinden (union)' },
    { type: 'fw_difference', message0: '%1 nimm', args0: [img('difference')], message1: '%1', args1: [DO('BASE')], message2: 'und ziehe ab', message3: '%1', args3: [DO('SUB')], style: 'combine_blocks', tooltip: 'Vom ersten Teil alles Weitere abziehen (difference)' },
    { type: 'fw_intersection', message0: '%1 Schnittmenge', args0: [img('intersection')], message1: '%1', args1: [DO()], style: 'combine_blocks', tooltip: 'Nur was alle gemeinsam haben (intersection)' },
    { type: 'fw_hull', message0: '%1 Hülle um', args0: [img('hull')], message1: '%1', args1: [DO()], style: 'combine_blocks', tooltip: 'Konvexe Hülle – wie Folie drumherum (hull)' },
    { type: 'fw_minkowski', message0: '%1 Minkowski-Summe', args0: [img('minkowski')], message1: '%1', args1: [DO()], style: 'combine_blocks', tooltip: 'Form um eine zweite „herumfahren“, z. B. zum Abrunden (minkowski)' },
    // Extrudieren
    { type: 'fw_linear_extrude', message0: '%1 ziehe hoch  Höhe %2 Drehung %3 ° Skalierung %4', args0: [img('extrude'), N('H'), N('TWIST'), N('SCALE')], message1: '%1', args1: [DO()], style: 'extrude_blocks', tooltip: '2D-Formen in die Höhe ziehen (linear_extrude)' },
    { type: 'fw_rotate_extrude', message0: '%1 drehe um die Z-Achse  Winkel %2 °', args0: [img('revolve'), N('A')], message1: '%1', args1: [DO()], style: 'extrude_blocks', tooltip: '2D-Profil zu einem Drehkörper (rotate_extrude) – Profil rechts der Y-Achse platzieren' },
    { type: 'fw_offset', message0: '%1 Kontur  versetzen um %2', args0: [img('offset'), N('D')], message1: '%1', args1: [DO()], style: 'extrude_blocks', tooltip: '2D-Kontur wachsen (+) oder schrumpfen (−) lassen, gerundet (offset)' },
    // Wiederholen
    { type: 'fw_repeat_circle', message0: '%1 wiederhole %2 mal im Kreis', args0: [img('ring'), N('N')], message1: '%1', args1: [DO()], style: 'loop_blocks', tooltip: 'Kopien gleichmäßig um die Z-Achse verteilen' },
    { type: 'fw_repeat_line', message0: '%1 wiederhole %2 mal  Abstand x %3 y %4 z %5', args0: [img('line'), N('N'), N('X'), N('Y'), N('Z')], message1: '%1', args1: [DO()], style: 'loop_blocks', tooltip: 'Kopien in einer Reihe' },
    { type: 'fw_repeat_grid', message0: '%1 Raster  %2 × %3 Abstand %4', args0: [img('grid'), N('NX'), N('NY'), N('D')], message1: '%1', args1: [DO()], style: 'loop_blocks', tooltip: 'Kopien in einem Raster' },
    // Variablen & Extras
    { type: 'fw_param', message0: '%1 Regler %2 = %3 von %4 bis %5', args0: [img('slider'), { type: 'field_variable', name: 'VAR', variable: 'groesse' }, { type: 'field_number', name: 'VALUE', value: 20 }, { type: 'field_number', name: 'MIN', value: 1 }, { type: 'field_number', name: 'MAX', value: 100 }], style: 'variable_blocks', tooltip: 'Variable mit Regler im Customizer (rechts). Lege Regler frei auf die Arbeitsfläche.', ...STMT },
    { type: 'fw_resolution', message0: '%1 Rundungen glätten  %2 Segmente', args0: [img('smooth'), N('N')], style: 'extra_blocks', tooltip: 'Wie fein Kreise und Kugeln aufgelöst werden ($fn)' },
    { type: 'fw_echo', message0: '%1 gib aus %2', args0: [img('echo'), ANY('VALUE')], style: 'extra_blocks', tooltip: 'Wert in der Konsole anzeigen (echo)' },
    { type: 'fw_code', message0: '%1 Code %2', args0: [img('code'), { type: 'field_input', name: 'CODE', text: 'cube(5);', spellcheck: false }], style: 'extra_blocks', tooltip: 'Beliebiger OpenSCAD-Code' },
  ];
  for (const d of defs) Object.assign(d, { ...STMT, ...d });
  B.common.defineBlocksWithJsonArray(defs);
}

function tweakMessages(B) {
  const M = B.Msg;
  Object.assign(M, {
    PROCEDURES_DEFNORETURN_TITLE: 'Baustein',
    PROCEDURES_DEFNORETURN_PROCEDURE: 'mein_teil',
    PROCEDURES_BEFORE_PARAMS: 'mit:',
    PROCEDURES_CALL_BEFORE_PARAMS: 'mit:',
    PROCEDURES_DEFNORETURN_TOOLTIP: 'Eigener Baustein (OpenSCAD-Modul), den du mehrfach verwenden kannst',
    PROCEDURES_CALLNORETURN_TOOLTIP: 'Eigenen Baustein einsetzen',
    PROCEDURES_DEFNORETURN_COMMENT: 'Beschreibe den Baustein …',
    CONTROLS_FOR_TITLE: 'zähle %1 von %2 bis %3 in Schritten von %4',
    CONTROLS_IF_MSG_IF: 'falls',
    CONTROLS_IF_MSG_ELSE: 'sonst',
    NEW_VARIABLE: 'Variable erstellen …',
    NEW_VARIABLE_TITLE: 'Name der neuen Variable:',
  });
}

/* ------------------------------------------------------------ Themes */

const STYLES = {
  shape3d: '#7c6cf0', shape2d: '#2fa8e0', transform: '#f08c3c', combine: '#e9558a', extrude: '#22b58a',
  loop: '#d9a520', logic: '#5b8def', math: '#3fae9e', text: '#9a7bd6', variable: '#f2694f',
  procedure: '#b65fd6', extra: '#7d84a3', list: '#8a6ed8', colour: '#c7608a', variable_dynamic: '#f2694f',
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const mix = f < 0 ? 0 : 255, t = Math.abs(f);
  r = Math.round(r + (mix - r) * t); g = Math.round(g + (mix - g) * t); b = Math.round(b + (mix - b) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function makeTheme(B, dark) {
  const blockStyles = {}, categoryStyles = {};
  for (const [k, c] of Object.entries(STYLES)) {
    blockStyles[`${k}_blocks`] = { colourPrimary: c, colourSecondary: shade(c, 0.35), colourTertiary: shade(c, -0.25), hat: '' };
    categoryStyles[`${k}_category`] = { colour: c };
  }
  return B.Theme.defineTheme(dark ? 'formwerk-dark' : 'formwerk-light', {
    base: B.Themes.Classic,
    blockStyles,
    categoryStyles,
    componentStyles: dark ? {
      workspaceBackgroundColour: 'rgba(0,0,0,0)',
      toolboxBackgroundColour: 'rgba(0,0,0,0)',
      toolboxForegroundColour: 'rgba(240,240,255,.85)',
      flyoutBackgroundColour: '#171724',
      flyoutForegroundColour: '#ddd',
      flyoutOpacity: 0.94,
      scrollbarColour: 'rgba(255,255,255,.25)',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#ffffff',
      insertionMarkerOpacity: 0.35,
      cursorColour: '#d0d0ff',
    } : {
      workspaceBackgroundColour: 'rgba(0,0,0,0)',
      toolboxBackgroundColour: 'rgba(0,0,0,0)',
      toolboxForegroundColour: 'rgba(20,20,40,.85)',
      flyoutBackgroundColour: '#f4f5fb',
      flyoutForegroundColour: '#333',
      flyoutOpacity: 0.96,
      scrollbarColour: 'rgba(20,20,60,.25)',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#000000',
      insertionMarkerOpacity: 0.2,
      cursorColour: '#5040c0',
    },
    fontStyle: { family: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif', weight: '600', size: 11.5 },
    startHats: false,
  });
}

/* ----------------------------------------------------------- Toolbox */

const num = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const str = (s) => ({ shadow: { type: 'text', fields: { TEXT: s } } });
const blk = (type, inputs = {}, fields) => ({ kind: 'block', type, inputs, ...(fields ? { fields } : {}) });

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'Körper', categorystyle: 'shape3d_category', contents: [
      blk('fw_cube', { X: num(20), Y: num(20), Z: num(20) }),
      blk('fw_sphere', { R: num(10) }),
      blk('fw_cylinder', { H: num(20), R: num(10) }),
      blk('fw_cone', { H: num(20), R1: num(10), R2: num(0) }),
      blk('fw_torus', { R: num(15), T: num(5) }),
      blk('fw_text3d', { TEXT: str('Hallo'), S: num(10), H: num(3) }),
    ] },
    { kind: 'category', name: 'Flächen', categorystyle: 'shape2d_category', contents: [
      { kind: 'label', text: '2D – mit „ziehe hoch“ zu Körpern machen' },
      blk('fw_square', { X: num(20), Y: num(10) }),
      blk('fw_circle', { R: num(10) }),
      blk('fw_ngon', { N: num(6), R: num(10) }),
      blk('fw_star', { N: num(5), A: num(20), I: num(9) }),
      blk('fw_text2d', { TEXT: str('Hallo'), S: num(10) }),
    ] },
    { kind: 'category', name: 'Bewegen', categorystyle: 'transform_category', contents: [
      blk('fw_translate', { X: num(10), Y: num(0), Z: num(0) }),
      blk('fw_rotate', { X: num(0), Y: num(0), Z: num(45) }),
      blk('fw_scale', { X: num(1), Y: num(1), Z: num(2) }),
      blk('fw_mirror'),
      blk('fw_color', { ALPHA: num(100) }, { COLOR: '#8b5cf6' }),
    ] },
    { kind: 'category', name: 'Kombinieren', categorystyle: 'combine_category', contents: [
      blk('fw_difference'),
      blk('fw_union'),
      blk('fw_intersection'),
      blk('fw_hull'),
      blk('fw_minkowski'),
    ] },
    { kind: 'category', name: 'Formen', categorystyle: 'extrude_category', contents: [
      blk('fw_linear_extrude', { H: num(10), TWIST: num(0), SCALE: num(1) }),
      blk('fw_rotate_extrude', { A: num(360) }),
      blk('fw_offset', { D: num(2) }),
    ] },
    { kind: 'category', name: 'Wiederholen', categorystyle: 'loop_category', contents: [
      blk('fw_repeat_circle', { N: num(6) }),
      blk('fw_repeat_line', { N: num(4), X: num(25), Y: num(0), Z: num(0) }),
      blk('fw_repeat_grid', { NX: num(3), NY: num(3), D: num(25) }),
      blk('controls_for', { FROM: num(1), TO: num(5), BY: num(1) }),
    ] },
    { kind: 'category', name: 'Logik', categorystyle: 'logic_category', contents: [
      blk('controls_if'),
      { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
      blk('logic_compare'),
      blk('logic_operation'),
      blk('logic_negate'),
      blk('logic_boolean'),
      blk('logic_ternary'),
    ] },
    { kind: 'category', name: 'Mathe', categorystyle: 'math_category', contents: [
      blk('math_number'),
      blk('math_arithmetic', { A: num(1), B: num(1) }),
      blk('math_single', { NUM: num(9) }),
      blk('math_trig', { NUM: num(45) }),
      blk('math_constant'),
      blk('math_round', { NUM: num(3.1) }),
      blk('math_modulo', { DIVIDEND: num(10), DIVISOR: num(3) }),
      blk('math_constrain', { VALUE: num(50), LOW: num(1), HIGH: num(100) }),
      blk('math_random_int', { FROM: num(1), TO: num(10) }),
    ] },
    { kind: 'category', name: 'Text', categorystyle: 'text_category', contents: [
      blk('text'),
      blk('text_join'),
    ] },
    { kind: 'sep' },
    { kind: 'category', name: 'Variablen', categorystyle: 'variable_category', custom: 'FW_VARIABLES' },
    { kind: 'category', name: 'Bausteine', categorystyle: 'procedure_category', custom: 'FW_MODULES' },
    { kind: 'category', name: 'Extras', categorystyle: 'extra_category', contents: [
      blk('fw_resolution', { N: num(64) }),
      blk('fw_echo', { VALUE: str('Hallo') }),
      blk('fw_code'),
    ] },
  ],
};

/* -------------------------------------------------- Startprojekt */

// Kleiner Bauplan-Helfer, damit das Startprojekt lesbar bleibt
const nb = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const vget = (id) => ({ block: { type: 'variables_get', fields: { VAR: { id } } } });
const arith = (op, a, b) => ({ block: { type: 'math_arithmetic', fields: { OP: op }, inputs: { A: a, B: b } } });
const withNum = (input, n) => ({ ...input, shadow: { type: 'math_number', fields: { NUM: n } } });

export const STARTER = {
  variables: [{ name: 'hoehe', id: 'v_hoehe' }, { name: 'radius', id: 'v_radius' }, { name: 'wand', id: 'v_wand' }],
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'fw_param', x: 30, y: 30, fields: { VAR: { id: 'v_hoehe' }, VALUE: 80, MIN: 30, MAX: 150 },
        next: { block: {
          type: 'fw_param', fields: { VAR: { id: 'v_radius' }, VALUE: 32, MIN: 15, MAX: 60 },
          next: { block: { type: 'fw_param', fields: { VAR: { id: 'v_wand' }, VALUE: 2.5, MIN: 1, MAX: 6 } } },
        } },
      },
      {
        type: 'fw_resolution', x: 30, y: 190, inputs: { N: nb(96) },
        next: { block: {
          type: 'fw_color', fields: { COLOR: '#8b5cf6' }, inputs: { ALPHA: nb(100), DO: { block: {
            type: 'fw_difference',
            inputs: {
              BASE: { block: { type: 'fw_cylinder', inputs: { H: withNum(vget('v_hoehe'), 80), R: withNum(vget('v_radius'), 30) } } },
              SUB: { block: {
                type: 'fw_translate', inputs: { X: nb(0), Y: nb(0), Z: withNum(vget('v_wand'), 2),
                  DO: { block: { type: 'fw_cylinder', inputs: {
                    H: withNum(vget('v_hoehe'), 80),
                    R: withNum(arith('MINUS', withNum(vget('v_radius'), 30), withNum(vget('v_wand'), 2)), 28),
                  } } } },
              } },
            },
          } } },
          next: { block: {
            type: 'fw_translate', inputs: { X: withNum(arith('ADD', withNum(vget('v_radius'), 30), nb(1)), 31), Y: nb(0), Z: withNum(arith('DIVIDE', withNum(vget('v_hoehe'), 80), nb(2)), 40),
              DO: { block: { type: 'fw_rotate', inputs: { X: nb(90), Y: nb(0), Z: nb(0),
                DO: { block: { type: 'fw_color', fields: { COLOR: '#f97316' }, inputs: { ALPHA: nb(100),
                  DO: { block: { type: 'fw_torus', inputs: { R: withNum(arith('DIVIDE', withNum(vget('v_hoehe'), 80), nb(4)), 20), T: nb(7) } } } } } } } } } },
          } },
        } },
      },
    ],
  },
};

/* ------------------------------------------------------------ Editor */

export class BlockEditor {
  constructor(host, { onChange, prompt } = {}) {
    this.host = host;
    this.onChange = onChange;
    this.prompt = prompt;
    this.ws = null;
  }

  async init(dark) {
    const B = await loadBlockly();
    this.B = B;
    this.gen = createGenerator(B);
    this.themes = { dark: makeTheme(B, true), light: makeTheme(B, false) };
    if (this.prompt) {
      B.dialog.setPrompt((message, def, cb) => this.prompt(message, def).then(cb));
    }
    this.ws = B.inject(this.host, {
      toolbox: TOOLBOX,
      renderer: 'zelos',
      theme: dark ? this.themes.dark : this.themes.light,
      media: BASE + 'media/',
      grid: { spacing: 28, length: 3, colour: dark ? 'rgba(255,255,255,.07)' : 'rgba(20,20,60,.08)', snap: false },
      zoom: { controls: true, wheel: true, startScale: 0.72, maxScale: 2, minScale: 0.3, scaleSpeed: 1.15, pinch: true },
      move: { scrollbars: true, drag: true, wheel: true },
      trashcan: true,
      sounds: false,
      toolboxPosition: 'start',
      maxTrashcanContents: 30,
    });
    this.ws.registerToolboxCategoryCallback('FW_VARIABLES', (ws) => this.variablesFlyout(ws));
    this.ws.registerToolboxCategoryCallback('FW_MODULES', (ws) => this.modulesFlyout(ws));
    this.ws.registerButtonCallback('FW_NEW_VAR', (btn) => B.Variables.createVariableButtonHandler(btn.getTargetWorkspace(), null, ''));
    this.ws.addChangeListener((e) => {
      if (e.isUiEvent || this.loading) return;
      this.onChange?.();
    });
    return this;
  }

  variablesFlyout(ws) {
    const out = [
      { kind: 'button', text: 'Variable erstellen …', callbackkey: 'FW_NEW_VAR' },
    ];
    const vars = ws.getVariableMap().getVariablesOfType('');
    if (vars.length) {
      const first = vars[0];
      out.push({ kind: 'label', text: 'Regler erscheinen rechts im Customizer' });
      out.push({ kind: 'block', type: 'fw_param', fields: { VAR: { id: first.getId() }, VALUE: 20, MIN: 1, MAX: 100 } });
      out.push({ kind: 'block', type: 'variables_set', fields: { VAR: { id: first.getId() } }, inputs: { VALUE: num(10) } });
      for (const v of vars.sort((a, b) => a.getName().localeCompare(b.getName()))) {
        out.push({ kind: 'block', type: 'variables_get', fields: { VAR: { id: v.getId() } } });
      }
    } else {
      out.push({ kind: 'label', text: 'Noch keine Variablen' });
      out.push({ kind: 'block', type: 'fw_param', fields: { VAR: { name: 'groesse' }, VALUE: 20, MIN: 1, MAX: 100 } });
    }
    return out;
  }

  modulesFlyout(ws) {
    const B = this.B;
    const out = [
      { kind: 'label', text: 'Eigene Bausteine (Module) bauen und wiederverwenden' },
      { kind: 'block', type: 'procedures_defnoreturn', fields: { NAME: 'mein_teil' } },
    ];
    const [noReturn] = B.Procedures.allProcedures(ws);
    for (const [name, args] of noReturn) {
      out.push({ kind: 'block', type: 'procedures_callnoreturn', extraState: { name, params: args } });
    }
    return out;
  }

  code() { return this.ws ? this.gen.generate(this.ws) : ''; }

  save() { return this.ws ? this.B.serialization.workspaces.save(this.ws) : null; }

  load(state) {
    // Beim Laden keine Änderungs-Events auslösen (die kämen sonst verzögert an)
    this.B.Events.disable();
    try {
      this.ws.clear();
      this.B.serialization.workspaces.load(state ?? STARTER, this.ws);
    } finally {
      this.B.Events.enable();
    }
    this.ws.clearUndo();
  }

  isEmpty() { return !this.ws || this.ws.getTopBlocks(false).length === 0; }

  clear() { this.ws?.clear(); }

  resize() { if (this.ws) this.B.svgResize(this.ws); }

  setTheme(dark) {
    if (!this.ws) return;
    this.ws.setTheme(dark ? this.themes.dark : this.themes.light);
    // Rasterfarbe gehört nicht zum Theme
    for (const l of this.host.querySelectorAll('pattern line')) l.setAttribute('stroke', dark ? 'rgba(255,255,255,.07)' : 'rgba(20,20,60,.08)');
  }

  undo(redo = false) { this.ws?.undo(redo); }

  cleanUp() { this.ws?.cleanUp(); }
}
