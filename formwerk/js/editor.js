// Code-Editor auf Basis von CodeMirror 5: OpenSCAD-Syntax, Autovervollständigung,
// Fehlermarker und „Zahlen ziehen“ (⌥/Alt + Ziehen über eine Zahl).

import { MODULES, FUNCTIONS, KEYWORDS, ATOMS, SPECIALS, scanSymbols } from './scad-lang.js';
import { esc, isMac } from './ui.js';
import { t } from './i18n.js';

const KIND = () => ({ modul: t('modul'), funktion: t('funktion'), wort: t('wort'), wert: t('wert'), spezial: t('spezial'), eigenes: t('eigenes'), eigene: t('eigene'), variable: t('variable') });

const CM = window.CodeMirror;

const words = (list) => new RegExp(`\\b(?:${list.join('|')})\\b`);
CM.defineSimpleMode('openscad', {
  start: [
    { regex: /\/\*\s*\[[^\]]*\]\s*\*\//, token: 'header' },
    { regex: /\/\/\s*\[[^\]]*\]\s*$/, token: 'meta' },
    { regex: /\/\/.*/, token: 'comment' },
    { regex: /\/\*/, token: 'comment', next: 'comment' },
    { regex: /"(?:[^\\"]|\\.)*?(?:"|$)/, token: 'string' },
    { regex: /(include|use)(\s*)(<[^>]*>)/, token: ['keyword', null, 'string-2'] },
    { regex: /(module|function)(\s+)([A-Za-z_][\w]*)/, token: ['keyword', null, 'def'] },
    { regex: words(KEYWORDS), token: 'keyword' },
    { regex: words(ATOMS), token: 'atom' },
    { regex: new RegExp(`\\b(?:${Object.keys(MODULES).join('|')})\\b(?=\\s*\\()`), token: 'builtin' },
    { regex: new RegExp(`\\b(?:${Object.keys(FUNCTIONS).join('|')})\\b(?=\\s*\\()`), token: 'variable-3' },
    { regex: /\$[A-Za-z_]\w*/, token: 'variable-2' },
    { regex: /(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i, token: 'number' },
    { regex: /[A-Za-z_][\w]*/, token: 'variable' },
    { regex: /[-+*/%^<>=!&|?:#]+/, token: 'operator' },
    { regex: /[{[(]/, indent: true },
    { regex: /[}\])]/, dedent: true },
  ],
  comment: [
    { regex: /.*?\*\//, token: 'comment', next: 'start' },
    { regex: /.*/, token: 'comment' },
  ],
  meta: {
    lineComment: '//', blockCommentStart: '/*', blockCommentEnd: '*/',
    electricInput: /^\s*[}\])]$/, fold: 'brace',
  },
});

export class Editor {
  constructor(host, { onChange, onRun, onSave, onScrub } = {}) {
    this.onChange = onChange;
    this.onScrub = onScrub;
    this.marks = [];
    const mod = isMac ? 'Cmd' : 'Ctrl';
    this.cm = CM(host, {
      mode: 'openscad',
      theme: 'formwerk',
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      matchBrackets: true,
      autoCloseBrackets: { pairs: '()[]{}""', explode: '[]{}()' },
      styleActiveLine: true,
      foldGutter: true,
      gutters: ['cm-diag-gutter', 'CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      viewportMargin: 30,
      lineWrapping: false,
      inputStyle: 'contenteditable',
      spellcheck: false,
      autocorrect: false,
      autocapitalize: false,
      extraKeys: {
        [`${mod}-Enter`]: () => onRun?.(),
        'Shift-Enter': () => onRun?.(),
        F5: () => onRun?.(),
        F6: () => onRun?.(),
        [`${mod}-S`]: () => onSave?.(),
        [`${mod}-/`]: 'toggleComment',
        'Ctrl-Space': (cm) => this.complete(true),
        Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('  ', 'end')),
        'Shift-Tab': (cm) => cm.indentSelection('subtract'),
        'Alt-Up': () => this.bumpNumber(1),
        'Alt-Down': () => this.bumpNumber(-1),
        'Shift-Alt-Up': () => this.bumpNumber(10),
        'Shift-Alt-Down': () => this.bumpNumber(-10),
        [`${mod}-D`]: (cm) => this.duplicateLine(),
        Esc: (cm) => { if (cm.state.completionActive) cm.state.completionActive.close(); else return CM.Pass; },
      },
    });

    this.cm.on('changes', (cm, changes) => {
      if (this.silent) return;
      if (this.marks.length && changes.some((c) => c.origin !== 'setValue')) this.clearDiagnostics();
      this.onChange?.(cm.getValue(), changes);
    });
    this.cm.on('inputRead', (cm, change) => {
      if (!this.autoComplete) return;
      const ch = change.text.join('');
      if (/^[\w$]$/.test(ch)) this.complete(false);
    });
    this.autoComplete = true;
    this.installScrub();
  }

  getValue() { return this.cm.getValue(); }

  setValue(text, { keepHistory = false } = {}) {
    this.silent = true;
    const cursor = this.cm.getCursor();
    const scroll = this.cm.getScrollInfo();
    this.cm.setValue(text);
    if (!keepHistory) this.cm.clearHistory();
    else { this.cm.setCursor(cursor); this.cm.scrollTo(scroll.left, scroll.top); }
    this.silent = false;
    this.clearDiagnostics();
  }

  // Ersetzt den Text als eine rückgängig machbare Änderung
  replaceAll(text) {
    const doc = this.cm.getDoc();
    doc.replaceRange(text, { line: 0, ch: 0 }, { line: doc.lastLine(), ch: doc.getLine(doc.lastLine()).length }, 'replace');
  }

  focus() { this.cm.focus(); }
  refresh() { this.cm.refresh(); }
  setReadOnly(ro) { this.cm.setOption('readOnly', ro); }
  setFontSize(px) { this.cm.getWrapperElement().style.fontSize = `${px}px`; this.cm.refresh(); }
  setWrap(on) { this.cm.setOption('lineWrapping', on); }

  jumpTo(line, ch = 0) {
    const l = Math.max(0, line - 1);
    this.cm.focus();
    this.cm.setCursor({ line: l, ch });
    this.cm.scrollIntoView({ line: l, ch }, 120);
    const handle = this.cm.addLineClass(l, 'background', 'cm-line-flash');
    setTimeout(() => this.cm.removeLineClass(handle, 'background', 'cm-line-flash'), 1200);
  }

  /* --------------------------------------------------------- Diagnosen */

  clearDiagnostics() {
    for (const m of this.marks) {
      this.cm.removeLineClass(m.handle, 'background', m.cls);
      this.cm.setGutterMarker(m.handle, 'cm-diag-gutter', null);
    }
    this.marks = [];
  }

  setDiagnostics(messages) {
    this.clearDiagnostics();
    const byLine = new Map();
    for (const m of messages) {
      if (!m.line || m.file || !['error', 'warning'].includes(m.level)) continue;
      const l = m.line - 1;
      if (l < 0 || l > this.cm.lastLine()) continue;
      const e = byLine.get(l) ?? { level: 'warning', texts: [] };
      if (m.level === 'error') e.level = 'error';
      e.texts.push(m.text);
      byLine.set(l, e);
    }
    for (const [l, e] of byLine) {
      const cls = e.level === 'error' ? 'cm-line-error' : 'cm-line-warning';
      const handle = this.cm.addLineClass(l, 'background', cls);
      const marker = document.createElement('div');
      marker.className = `cm-diag cm-diag-${e.level}`;
      marker.title = e.texts.join('\n');
      this.cm.setGutterMarker(handle, 'cm-diag-gutter', marker);
      this.marks.push({ handle, cls });
    }
  }

  /* -------------------------------------------------- Autovervollständigung */

  complete(explicit) {
    const cm = this.cm;
    const cur = cm.getCursor();
    const tok = cm.getTokenAt(cur);
    if (!explicit && (tok.type === 'comment' || tok.type === 'string' || tok.type === 'meta' || tok.type === 'number')) return;
    cm.showHint({
      hint: (cm) => this.hints(cm),
      completeSingle: false,
      closeCharacters: /[\s()[\]{};:>,.=+\-*/]/,
      alignWithWord: true,
    });
  }

  hints(cm) {
    const cur = cm.getCursor();
    const line = cm.getLine(cur.line);
    let start = cur.ch;
    while (start > 0 && /[\w$]/.test(line[start - 1])) start--;
    const word = line.slice(start, cur.ch);
    if (!word && !cm.state.completionActive?.options?.explicit) { /* leer: alles zeigen */ }
    const syms = scanSymbols(cm.getValue());
    const list = [];
    const add = (text, kind, sig, doc, call) => list.push({ text, kind, sig, doc, call });
    for (const [k, [sig, doc]] of Object.entries(MODULES)) add(k, 'modul', sig, doc, true);
    for (const [k, [sig, doc]] of Object.entries(FUNCTIONS)) add(k, 'funktion', sig, doc, true);
    for (const k of KEYWORDS) add(k, 'wort', '', '', false);
    for (const k of ATOMS) add(k, 'wert', '', '', false);
    for (const [k, doc] of Object.entries(SPECIALS)) add(k, 'spezial', '', doc, false);
    for (const [k, sig] of syms.modules) add(k, 'eigenes', sig, t('Eigenes Modul'), true);
    for (const [k, sig] of syms.functions) add(k, 'eigene', sig, t('Eigene Funktion'), true);
    for (const k of syms.variables) if (k !== word) add(k, 'variable', '', '', false);

    const lw = word.toLowerCase();
    const seen = new Set();
    const matches = list
      .filter((c) => {
        if (seen.has(c.text)) return false;
        seen.add(c.text);
        return !lw || c.text.toLowerCase().startsWith(lw) || (lw.length > 2 && c.text.toLowerCase().includes(lw));
      })
      .sort((a, b) => {
        const ap = a.text.toLowerCase().startsWith(lw) ? 0 : 1, bp = b.text.toLowerCase().startsWith(lw) ? 0 : 1;
        return ap - bp || a.text.length - b.text.length || a.text.localeCompare(b.text);
      })
      .slice(0, 60);
    if (!matches.length || (matches.length === 1 && matches[0].text === word)) return null;

    const kinds = KIND();
    return {
      from: CM.Pos(cur.line, start),
      to: CM.Pos(cur.line, cur.ch),
      list: matches.map((c) => ({
        text: c.text,
        render: (el) => {
          el.innerHTML = `<span class="hint-kind hint-${c.kind}">${esc(kinds[c.kind] ?? c.kind)}</span><span class="hint-name">${esc(c.text)}</span>${c.sig || c.call ? `<span class="hint-sig">(${esc(c.sig)})</span>` : ''}${c.doc ? `<span class="hint-doc">${esc(t(c.doc))}</span>` : ''}`;
        },
        hint: (cm, data, completion) => {
          const after = cm.getLine(data.to.line).slice(data.to.ch);
          if (c.call && !after.startsWith('(')) {
            cm.replaceRange(`${c.text}()`, data.from, data.to, 'complete');
            const p = cm.getCursor();
            cm.setCursor({ line: p.line, ch: p.ch - 1 });
          } else {
            cm.replaceRange(c.text, data.from, data.to, 'complete');
          }
        },
      })),
    };
  }

  /* -------------------------------------------------------- Zahlen ändern */

  numberAt(pos) {
    const line = this.cm.getLine(pos.line);
    const re = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
    let m;
    while ((m = re.exec(line))) {
      let s = m.index, e = s + m[0].length;
      // Minus nur, wenn es kein binärer Operator ist (z. B. "a-1")
      if (m[0][0] === '-' && s > 0 && /[\w)\]]/.test(line.slice(0, s).trimEnd().slice(-1))) { s++; }
      // Teil eines Bezeichners wie "x1"?
      if (s > 0 && /[A-Za-z_$]/.test(line[s - 1])) continue;
      if (pos.ch >= s && pos.ch <= e) return { line: pos.line, start: s, end: e, text: line.slice(s, e) };
    }
    return null;
  }

  static stepFor(text) {
    const dot = text.indexOf('.');
    if (dot < 0 || /e/i.test(text)) return 1;
    return Math.pow(10, -(text.length - dot - 1));
  }

  static formatLike(value, step) {
    const decimals = step >= 1 ? 0 : Math.round(-Math.log10(step));
    let s = value.toFixed(decimals);
    if (s === '-0' || /^-0\.0*$/.test(s)) s = s.slice(1);
    return s;
  }

  bumpNumber(factor) {
    const cm = this.cm;
    const n = this.numberAt(cm.getCursor());
    if (!n) return CM.Pass;
    const step = Editor.stepFor(n.text);
    const v = Number(n.text) + step * factor;
    const s = Editor.formatLike(v, step);
    cm.replaceRange(s, { line: n.line, ch: n.start }, { line: n.line, ch: n.end }, '+bump');
    cm.setSelection({ line: n.line, ch: n.start }, { line: n.line, ch: n.start + s.length });
  }

  duplicateLine() {
    const cm = this.cm;
    const sel = cm.listSelections()[0];
    const from = Math.min(sel.anchor.line, sel.head.line), to = Math.max(sel.anchor.line, sel.head.line);
    const text = cm.getRange({ line: from, ch: 0 }, { line: to, ch: cm.getLine(to).length });
    cm.replaceRange(`\n${text}`, { line: to, ch: cm.getLine(to).length }, null, '+dup');
  }

  // ⌥/Alt gedrückt halten und über einer Zahl ziehen
  installScrub() {
    const cm = this.cm;
    const wrap = cm.getWrapperElement();
    let hoverMark = null;
    const clearHover = () => { hoverMark?.clear(); hoverMark = null; wrap.classList.remove('scrub-ready'); };

    wrap.addEventListener('mousemove', (e) => {
      if (this.scrubbing) return;
      if (!e.altKey) { if (hoverMark) clearHover(); return; }
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
      const n = this.numberAt(pos);
      clearHover();
      if (n) {
        hoverMark = cm.markText({ line: n.line, ch: n.start }, { line: n.line, ch: n.end }, { className: 'cm-scrub' });
        wrap.classList.add('scrub-ready');
      }
    });
    addEventListener('keyup', (e) => { if (e.key === 'Alt') clearHover(); });
    wrap.addEventListener('mouseleave', () => { if (!this.scrubbing) clearHover(); });

    wrap.addEventListener('mousedown', (e) => {
      if (!e.altKey || e.button !== 0 || cm.getOption('readOnly')) return;
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
      const n = this.numberAt(pos);
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      clearHover();
      this.scrubbing = true;
      wrap.classList.add('scrubbing');
      const step = Editor.stepFor(n.text);
      const startVal = Number(n.text);
      const x0 = e.clientX;
      let cur = { ...n };
      let mark = cm.markText({ line: cur.line, ch: cur.start }, { line: cur.line, ch: cur.end }, { className: 'cm-scrub active' });
      let first = true;
      const move = (ev) => {
        const dx = ev.clientX - x0;
        const fine = ev.shiftKey ? 0.1 : 1;
        const v = startVal + Math.round(dx / 5 * fine) * step;
        const s = Editor.formatLike(v, step);
        if (s === cm.getRange({ line: cur.line, ch: cur.start }, { line: cur.line, ch: cur.end })) return;
        mark.clear();
        cm.replaceRange(s, { line: cur.line, ch: cur.start }, { line: cur.line, ch: cur.end }, first ? 'scrub' : '*scrub');
        first = false;
        cur = { ...cur, end: cur.start + s.length };
        mark = cm.markText({ line: cur.line, ch: cur.start }, { line: cur.line, ch: cur.end }, { className: 'cm-scrub active' });
        this.onScrub?.(true);
      };
      const up = () => {
        removeEventListener('mousemove', move, true);
        removeEventListener('mouseup', up, true);
        mark.clear();
        this.scrubbing = false;
        wrap.classList.remove('scrubbing');
        this.onScrub?.(false);
      };
      addEventListener('mousemove', move, true);
      addEventListener('mouseup', up, true);
    }, true);
  }
}
