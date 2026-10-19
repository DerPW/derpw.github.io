// Kleiner, nachsichtiger XML-Parser, der sich die Lage jedes Knotens im Quelltext merkt.
// So lassen sich gezielt einzelne Elemente ändern, ohne den Rest der Datei neu zu schreiben.

export const NS = {
  xml: 'http://www.w3.org/XML/1998/namespace',
  opf: 'http://www.idpf.org/2007/opf',
  dc: 'http://purl.org/dc/elements/1.1/',
  container: 'urn:oasis:names:tc:opendocument:xmlns:container',
  xlink: 'http://www.w3.org/1999/xlink',
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e] ?? m;
  });
}

export const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

const isSpace = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r';

function splitName(name) {
  const i = name.indexOf(':');
  return i < 0 ? ['', name] : [name.slice(0, i), name.slice(i + 1)];
}

function parseStartTag(src, lt) {
  const n = src.length;
  let i = lt + 1;
  while (i < n && !isSpace(src[i]) && src[i] !== '>' && src[i] !== '/') i++;
  const name = src.slice(lt + 1, i);
  const attrs = [];
  while (i < n) {
    while (i < n && isSpace(src[i])) i++;
    if (src[i] === '>') return { name, attrs, end: i + 1, selfClosing: false };
    if (src[i] === '/' && src[i + 1] === '>') return { name, attrs, end: i + 2, selfClosing: true };
    if (src[i] === '/') { i++; continue; }
    const ns = i;
    while (i < n && !isSpace(src[i]) && src[i] !== '=' && src[i] !== '>' && !(src[i] === '/' && src[i + 1] === '>')) i++;
    const aname = src.slice(ns, i);
    while (i < n && isSpace(src[i])) i++;
    let value = '';
    let quote = '"';
    if (src[i] === '=') {
      i++;
      while (i < n && isSpace(src[i])) i++;
      if (src[i] === '"' || src[i] === "'") {
        quote = src[i];
        const close = src.indexOf(quote, i + 1);
        const e = close < 0 ? n : close;
        value = src.slice(i + 1, e);
        i = e + 1;
      } else {
        const vs = i;
        while (i < n && !isSpace(src[i]) && src[i] !== '>') i++;
        value = src.slice(vs, i);
      }
    }
    if (aname) attrs.push({ name: aname, raw: value, value: decodeEntities(value), quote });
  }
  return { name, attrs, end: n, selfClosing: false };
}

export function parseXML(src) {
  const root = { type: 'root', name: '#root', children: [], start: 0, end: src.length, parent: null, attrs: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const push = (node) => { node.parent = top(); top().children.push(node); return node; };
  const n = src.length;
  let i = 0;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { push({ type: 'text', start: i, end: n }); break; }
    if (lt > i) push({ type: 'text', start: i, end: lt });

    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      const end = e < 0 ? n : e + 3;
      push({ type: 'comment', start: lt, end });
      i = end;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      const end = e < 0 ? n : e + 3;
      push({ type: 'cdata', start: lt, end, value: src.slice(lt + 9, e < 0 ? n : e) });
      i = end;
    } else if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt + 2);
      const end = e < 0 ? n : e + 2;
      push({ type: 'pi', start: lt, end });
      i = end;
    } else if (src.startsWith('<!', lt)) {
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '"' || c === "'") { const q = src.indexOf(c, j + 1); j = q < 0 ? n : q; }
        else if (c === '>' && depth <= 0) break;
        j++;
      }
      push({ type: 'doctype', start: lt, end: Math.min(n, j + 1) });
      i = j + 1;
    } else if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt);
      const end = gt < 0 ? n : gt + 1;
      const name = src.slice(lt + 2, gt < 0 ? n : gt).trim();
      let k = stack.length - 1;
      while (k > 0 && stack[k].name !== name) k--;
      if (k > 0) {
        for (let m = stack.length - 1; m > k; m--) { stack[m].closeStart = lt; stack[m].end = lt; }
        stack[k].closeStart = lt;
        stack[k].end = end;
        stack.length = k;
      }
      i = end;
    } else {
      const tag = parseStartTag(src, lt);
      const [prefix, local] = splitName(tag.name);
      const el = push({
        type: 'el', name: tag.name, prefix, local, attrs: tag.attrs,
        start: lt, openEnd: tag.end, closeStart: tag.end, end: tag.end,
        selfClosing: tag.selfClosing, children: [],
      });
      if (!tag.selfClosing) stack.push(el);
      i = tag.end;
    }
  }
  for (let m = stack.length - 1; m > 0; m--) { stack[m].closeStart = n; stack[m].end = n; }
  root.src = src;
  return root;
}

/* ------------------------------------------------------------- Abfragen */

export function nsURI(el, prefix) {
  const key = prefix ? `xmlns:${prefix}` : 'xmlns';
  for (let e = el; e && e.type === 'el'; e = e.parent) {
    const a = e.attrs.find((x) => x.name === key);
    if (a) return a.value;
  }
  if (prefix === 'xml') return NS.xml;
  return null;
}

export const elNS = (el) => nsURI(el, el.prefix);

/** Prüft Namensraum und lokalen Namen; `opf` passt auch bei fehlender Deklaration. */
export function is(el, ns, local) {
  if (!el || el.type !== 'el' || el.local.toLowerCase() !== local.toLowerCase()) return false;
  const uri = elNS(el);
  if (uri === ns) return true;
  if (uri == null) {
    if (ns === NS.dc) return el.prefix === 'dc';
    if (ns === NS.opf) return el.prefix === '' || el.prefix === 'opf';
  }
  return false;
}

export function attr(el, name) {
  const a = el?.attrs?.find((x) => x.name === name);
  return a ? a.value : null;
}

/** Attribut über lokalen Namen und Namensraum (z. B. opf:role). Unpräfixiert zählt mit, wenn erlaubt. */
export function attrNS(el, ns, local, { allowPlain = false } = {}) {
  for (const a of el.attrs) {
    const [prefix, name] = splitName(a.name);
    if (name !== local) continue;
    if (!prefix) { if (allowPlain) return a.value; continue; }
    const uri = nsURI(el, prefix);
    if (uri === ns || (uri == null && ns === NS.opf && prefix === 'opf')) return a.value;
  }
  return null;
}

export const elements = (node) => (node?.children ?? []).filter((c) => c.type === 'el');

export function* descendants(node) {
  for (const c of node.children ?? []) {
    if (c.type !== 'el') continue;
    yield c;
    yield* descendants(c);
  }
}

export function find(node, pred) {
  for (const el of descendants(node)) if (pred(el)) return el;
  return null;
}

export function textOf(root, el) {
  if (el.selfClosing) return '';
  let s = '';
  const walk = (node) => {
    for (const c of node.children) {
      if (c.type === 'text') s += decodeEntities(root.src.slice(c.start, c.end));
      else if (c.type === 'cdata') s += c.value;
      else if (c.type === 'el') walk(c);
    }
  };
  walk(el);
  return s;
}

/** Baut den Start-Tag aus den (geänderten) Attributen neu auf. */
export function startTag(el, attrs = el.attrs) {
  const parts = attrs.map((a) => {
    const raw = a.raw ?? escAttr(a.value);
    const q = a.quote === "'" && !raw.includes("'") ? "'" : '"';
    return ` ${a.name}=${q}${q === '"' ? raw.replace(/"/g, '&quot;') : raw}${q}`;
  });
  return `<${el.name}${parts.join('')}${el.selfClosing ? '/>' : '>'}`;
}

/** Änderungen als Ersetzungen im Quelltext, die am Ende in einem Zug angewendet werden. */
export class Splicer {
  constructor(src) { this.src = src; this.ops = []; }
  replace(start, end, text) { this.ops.push({ start, end, text, seq: this.ops.length }); }
  insert(pos, text) { this.replace(pos, pos, text); }
  apply() {
    const ops = [...this.ops].sort((a, b) => a.start - b.start || a.end - b.end || a.seq - b.seq);
    let out = '';
    let p = 0;
    for (const op of ops) {
      if (op.start < p) throw new Error('Überlappende Änderungen im XML');
      out += this.src.slice(p, op.start) + op.text;
      p = op.end;
    }
    return out + this.src.slice(p);
  }
}
