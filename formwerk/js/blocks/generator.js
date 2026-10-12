// Übersetzt den Baukasten (Blockly-Arbeitsfläche) in OpenSCAD-Code.

import { MODULES, FUNCTIONS, KEYWORDS, ATOMS } from '../scad-lang.js';
import { t } from '../i18n.js';

const RESERVED = new Set([...Object.keys(MODULES), ...Object.keys(FUNCTIONS), ...KEYWORDS, ...ATOMS]);
const TRANSLIT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };

// Blockly-Namen ("Höhe innen") → gültige OpenSCAD-Bezeichner ("Hoehe_innen")
export function safeName(name) {
  let s = String(name ?? '').trim().replace(/[äöüÄÖÜß]/g, (c) => TRANSLIT[c]);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = 'wert';
  if (/^\d/.test(s)) s = '_' + s;
  if (RESERVED.has(s)) s += '_';
  return s;
}

export function createGenerator(Blockly) {
  const G = new Blockly.CodeGenerator('OpenSCAD');
  const O = { ATOMIC: 0, CALL: 1, UNARY: 2, MULT: 3, ADD: 4, REL: 5, EQ: 6, AND: 7, OR: 8, COND: 9, NONE: 99 };
  G.ORDER = O;
  G.INDENT = '  ';
  G.isInitialized = true;

  G.scrub_ = function (block, code, thisOnly) {
    const next = block.nextConnection && block.nextConnection.targetBlock();
    return code + (next && !thisOnly ? G.blockToCode(next) : '');
  };

  const val = (b, name, order = O.NONE, def = '0') => G.valueToCode(b, name, order) || def;
  const body = (b, name) => G.statementToCode(b, name);
  const wrap = (head, inner) => (inner.trim() ? `${head} {\n${inner}}\n` : '');
  const center = (b) => (b.getFieldValue('CENTER') === 'TRUE' ? ', center = true' : '');
  const varName = (b, field = 'VAR') => safeName(b.getField(field)?.getText());
  const chainLength = (b, input) => {
    let n = 0;
    for (let c = b.getInputTargetBlock(input); c; c = c.getNextBlock()) if (c.isEnabled()) n++;
    return n;
  };
  const f = G.forBlock;

  /* ------------------------------------------------------------ Körper */
  f.fw_cube = (b) => `cube([${val(b, 'X')}, ${val(b, 'Y')}, ${val(b, 'Z')}]${center(b)});\n`;
  f.fw_sphere = (b) => `sphere(r = ${val(b, 'R')});\n`;
  f.fw_cylinder = (b) => `cylinder(h = ${val(b, 'H')}, r = ${val(b, 'R')}${center(b)});\n`;
  f.fw_cone = (b) => `cylinder(h = ${val(b, 'H')}, r1 = ${val(b, 'R1')}, r2 = ${val(b, 'R2')}${center(b)});\n`;
  f.fw_torus = (b) => `rotate_extrude() translate([${val(b, 'R')}, 0]) circle(r = ${val(b, 'T', O.MULT)} / 2);\n`;
  f.fw_text3d = (b) => `linear_extrude(${val(b, 'H')}) text(${val(b, 'TEXT', O.NONE, '""')}, size = ${val(b, 'S')}, halign = "center", valign = "center");\n`;

  /* ------------------------------------------------------------ Flächen */
  f.fw_square = (b) => `square([${val(b, 'X')}, ${val(b, 'Y')}]${center(b)});\n`;
  f.fw_circle = (b) => `circle(r = ${val(b, 'R')});\n`;
  f.fw_ngon = (b) => `circle(r = ${val(b, 'R')}, $fn = ${val(b, 'N')});\n`;
  f.fw_star = (b) => {
    const n = val(b, 'N', O.MULT), a = val(b, 'A'), i = val(b, 'I');
    return `polygon([for (i_ = [0 : 2 * ${n} - 1]) (i_ % 2 == 0 ? ${a} : ${i}) * [cos(90 + i_ * 180 / ${n}), sin(90 + i_ * 180 / ${n})]]);\n`;
  };
  f.fw_text2d = (b) => `text(${val(b, 'TEXT', O.NONE, '""')}, size = ${val(b, 'S')}, font = ${JSON.stringify(b.getFieldValue('FONT'))}, halign = "center", valign = "center");\n`;

  /* ------------------------------------------------------ Bewegen */
  f.fw_translate = (b) => wrap(`translate([${val(b, 'X')}, ${val(b, 'Y')}, ${val(b, 'Z')}])`, body(b, 'DO'));
  f.fw_rotate = (b) => wrap(`rotate([${val(b, 'X')}, ${val(b, 'Y')}, ${val(b, 'Z')}])`, body(b, 'DO'));
  f.fw_scale = (b) => wrap(`scale([${val(b, 'X', O.NONE, '1')}, ${val(b, 'Y', O.NONE, '1')}, ${val(b, 'Z', O.NONE, '1')}])`, body(b, 'DO'));
  f.fw_mirror = (b) => wrap(`mirror(${b.getFieldValue('AXIS')})`, body(b, 'DO'));
  f.fw_color = (b) => {
    const a = val(b, 'ALPHA', O.MULT, '100');
    return wrap(a === '100' ? `color("${b.getFieldValue('COLOR')}")` : `color("${b.getFieldValue('COLOR')}", ${a} / 100)`, body(b, 'DO'));
  };

  /* --------------------------------------------------- Kombinieren */
  f.fw_union = (b) => wrap('union()', body(b, 'DO'));
  f.fw_intersection = (b) => wrap('intersection()', body(b, 'DO'));
  f.fw_hull = (b) => wrap('hull()', body(b, 'DO'));
  f.fw_minkowski = (b) => wrap('minkowski()', body(b, 'DO'));
  f.fw_difference = (b) => {
    let base = body(b, 'BASE');
    const sub = body(b, 'SUB');
    if (!base.trim()) return '';
    if (!sub.trim()) return base.replace(/^ {2}/gm, '');
    if (chainLength(b, 'BASE') > 1) base = `${G.INDENT}union() {\n${G.prefixLines(base, G.INDENT)}${G.INDENT}}\n`;
    return `difference() {\n${base}${sub}}\n`;
  };

  /* ---------------------------------------------------- Extrudieren */
  f.fw_linear_extrude = (b) => {
    const h = val(b, 'H'), t = val(b, 'TWIST'), s = val(b, 'SCALE', O.NONE, '1');
    let args = `height = ${h}`;
    if (t !== '0') args += `, twist = ${t}, slices = 60`;
    if (s !== '1') args += `, scale = ${s}`;
    return wrap(`linear_extrude(${args})`, body(b, 'DO'));
  };
  f.fw_rotate_extrude = (b) => {
    const a = val(b, 'A', O.NONE, '360');
    return wrap(a === '360' ? 'rotate_extrude()' : `rotate_extrude(angle = ${a})`, body(b, 'DO'));
  };
  f.fw_offset = (b) => wrap(`offset(r = ${val(b, 'D')})`, body(b, 'DO'));

  /* ---------------------------------------------------- Wiederholen */
  f.fw_repeat_circle = (b) => wrap(`for (i_ = [0 : ${val(b, 'N', O.ADD)} - 1]) rotate([0, 0, i_ * 360 / ${val(b, 'N', O.MULT)}])`, body(b, 'DO'));
  f.fw_repeat_line = (b) => wrap(`for (i_ = [0 : ${val(b, 'N', O.ADD)} - 1]) translate([i_ * ${val(b, 'X', O.MULT)}, i_ * ${val(b, 'Y', O.MULT)}, i_ * ${val(b, 'Z', O.MULT)}])`, body(b, 'DO'));
  f.fw_repeat_grid = (b) => wrap(`for (i_ = [0 : ${val(b, 'NX', O.ADD)} - 1], j_ = [0 : ${val(b, 'NY', O.ADD)} - 1]) translate([i_ * ${val(b, 'D', O.MULT)}, j_ * ${val(b, 'D', O.MULT)}, 0])`, body(b, 'DO'));

  /* -------------------------------------------- Variablen & Extras */
  f.fw_param = (b) => {
    const name = varName(b);
    const v = Number(b.getFieldValue('VALUE')), lo = Number(b.getFieldValue('MIN')), hi = Number(b.getFieldValue('MAX'));
    const dec = Math.max(...[v, lo, hi].map((x) => (String(x).split('.')[1] ?? '').length));
    const range = dec ? `[${lo}:${Math.pow(10, -dec).toFixed(dec)}:${hi}]` : `[${lo}:${hi}]`;
    const line = `${name} = ${v}; // ${range}\n`;
    // Regler oben auf der Arbeitsfläche landen im Customizer
    if (!b.getSurroundParent()) { G.params_.push(line); return ''; }
    return `${name} = ${v};\n`;
  };
  f.fw_resolution = (b) => `$fn = ${val(b, 'N', O.NONE, '48')};\n`;
  f.fw_echo = (b) => `echo(${val(b, 'VALUE', O.NONE, '""')});\n`;
  f.fw_code = (b) => {
    const c = String(b.getFieldValue('CODE') ?? '').trim();
    return c ? (/[;}]$/.test(c) ? c : c + ';') + '\n' : '';
  };

  f.variables_get = (b) => [varName(b), O.ATOMIC];
  f.variables_set = (b) => `${varName(b)} = ${val(b, 'VALUE')};\n`;

  /* --------------------------------------------------------- Mathe */
  f.math_number = (b) => {
    const n = Number(b.getFieldValue('NUM'));
    return [String(n), n < 0 ? O.UNARY : O.ATOMIC];
  };
  f.math_arithmetic = (b) => {
    const op = b.getFieldValue('OP');
    if (op === 'POWER') return [`pow(${val(b, 'A')}, ${val(b, 'B')})`, O.CALL];
    const [sym, ord] = { ADD: [' + ', O.ADD], MINUS: [' - ', O.ADD], MULTIPLY: [' * ', O.MULT], DIVIDE: [' / ', O.MULT] }[op];
    return [`${val(b, 'A', ord)}${sym}${val(b, 'B', ord + (op === 'MINUS' || op === 'DIVIDE' ? -0.5 : 0))}`, ord];
  };
  f.math_single = (b) => {
    const op = b.getFieldValue('OP');
    if (op === 'NEG') return [`-${val(b, 'NUM', O.UNARY)}`, O.UNARY];
    const fn = { ROOT: 'sqrt', ABS: 'abs', LN: 'ln', LOG10: 'log', EXP: 'exp' }[op];
    if (op === 'POW10') return [`pow(10, ${val(b, 'NUM')})`, O.CALL];
    return [`${fn}(${val(b, 'NUM')})`, O.CALL];
  };
  f.math_trig = (b) => [`${b.getFieldValue('OP').toLowerCase()}(${val(b, 'NUM')})`, O.CALL];
  f.math_round = (b) => [`${{ ROUND: 'round', ROUNDUP: 'ceil', ROUNDDOWN: 'floor' }[b.getFieldValue('OP')]}(${val(b, 'NUM')})`, O.CALL];
  f.math_modulo = (b) => [`${val(b, 'DIVIDEND', O.MULT)} % ${val(b, 'DIVISOR', O.MULT - 0.5)}`, O.MULT];
  f.math_constant = (b) => ({
    PI: ['PI', O.ATOMIC], E: ['exp(1)', O.CALL], GOLDEN_RATIO: ['(1 + sqrt(5)) / 2', O.MULT],
    SQRT2: ['sqrt(2)', O.CALL], SQRT1_2: ['sqrt(0.5)', O.CALL], INFINITY: ['1e200', O.ATOMIC],
  }[b.getFieldValue('CONSTANT')]);
  f.math_random_int = (b) => [`round(rands(${val(b, 'FROM')}, ${val(b, 'TO')}, 1)[0])`, O.CALL];
  f.math_random_float = () => ['rands(0, 1, 1)[0]', O.CALL];
  f.math_constrain = (b) => [`min(max(${val(b, 'VALUE')}, ${val(b, 'LOW')}), ${val(b, 'HIGH')})`, O.CALL];

  /* ---------------------------------------------------------- Logik */
  f.logic_boolean = (b) => [b.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', O.ATOMIC];
  f.logic_compare = (b) => {
    const op = b.getFieldValue('OP');
    const [sym, ord] = { EQ: ['==', O.EQ], NEQ: ['!=', O.EQ], LT: ['<', O.REL], LTE: ['<=', O.REL], GT: ['>', O.REL], GTE: ['>=', O.REL] }[op];
    return [`${val(b, 'A', ord)} ${sym} ${val(b, 'B', ord)}`, ord];
  };
  f.logic_operation = (b) => {
    const and = b.getFieldValue('OP') === 'AND';
    const ord = and ? O.AND : O.OR;
    return [`${val(b, 'A', ord, 'false')} ${and ? '&&' : '||'} ${val(b, 'B', ord, 'false')}`, ord];
  };
  f.logic_negate = (b) => [`!${val(b, 'BOOL', O.UNARY, 'true')}`, O.UNARY];
  f.logic_ternary = (b) => [`${val(b, 'IF', O.COND, 'false')} ? ${val(b, 'THEN', O.COND)} : ${val(b, 'ELSE', O.COND)}`, O.COND];
  f.controls_if = (b) => {
    let code = '';
    for (let n = 0; b.getInput('IF' + n); n++) {
      code += `${n ? ' else ' : ''}if (${val(b, 'IF' + n, O.NONE, 'false')}) {\n${body(b, 'DO' + n)}}`;
    }
    if (b.getInput('ELSE')) code += ` else {\n${body(b, 'ELSE')}}`;
    return code + '\n';
  };
  f.controls_for = (b) => {
    const v = varName(b), from = val(b, 'FROM'), to = val(b, 'TO'), by = val(b, 'BY', O.NONE, '1');
    return wrap(`for (${v} = [${from} : ${by === '1' ? '' : `${by} : `}${to}])`, body(b, 'DO'));
  };
  f.controls_repeat_ext = (b) => wrap(`for (i_ = [1 : ${val(b, 'TIMES')}])`, body(b, 'DO'));

  /* ----------------------------------------------------------- Text */
  f.text = (b) => [JSON.stringify(b.getFieldValue('TEXT') ?? ''), O.ATOMIC];
  f.text_join = (b) => {
    const items = [];
    for (let i = 0; i < (b.itemCount_ ?? 0); i++) items.push(val(b, 'ADD' + i, O.NONE, '""'));
    return [`str(${items.join(', ')})`, O.CALL];
  };

  /* ------------------------------------------------ Eigene Bausteine */
  f.procedures_defnoreturn = (b) => {
    const name = safeName(b.getFieldValue('NAME'));
    const args = (b.getVars?.() ?? []).map(safeName);
    G.defs_.push(`module ${name}(${args.join(', ')}) {\n${body(b, 'STACK')}}\n`);
    return '';
  };
  f.procedures_callnoreturn = (b) => {
    const name = safeName(b.getFieldValue('NAME'));
    const args = [];
    for (let i = 0; i < (b.arguments_?.length ?? 0); i++) args.push(val(b, 'ARG' + i, O.NONE, 'undef'));
    return `${name}(${args.join(', ')});\n`;
  };

  // Ganze Arbeitsfläche: Regler zuerst (Customizer), dann Bausteine, dann das Modell
  G.generate = (ws) => {
    G.params_ = [];
    G.defs_ = [];
    let main = '';
    for (const b of ws.getTopBlocks(true)) {
      if (b.outputConnection) continue; // lose Werte-Blöcke ignorieren
      main += G.blockToCode(b);
    }
    const parts = [`// ${t('Erzeugt mit dem Formwerk-Baukasten')}\n`];
    if (G.params_.length) parts.push(G.params_.join(''));
    if (G.defs_.length) parts.push(G.defs_.join('\n'));
    if (main.trim()) parts.push(main);
    return parts.join('\n');
  };

  return G;
}
