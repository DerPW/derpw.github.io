// Customizer: zeigt die Parameter, die OpenSCAD aus dem Quelltext liest
// (Kommentare wie "// [10:100]" oder "/* [Gruppe] */"), als Regler und Felder.
// Geänderte Werte gehen als -D name=wert an OpenSCAD.

import { esc, h, icon } from './ui.js';

export function toLiteral(v) {
  if (Array.isArray(v)) return `[${v.map(toLiteral).join(', ')}]`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  return JSON.stringify(String(v));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const prettyName = (n) => n.replace(/_/g, ' ').replace(/^\$/, '$');

export class Customizer extends EventTarget {
  constructor(root) {
    super();
    this.root = root;
    this.params = [];
    this.values = {};      // nur vom Nutzer geänderte Werte
    this.collapsed = new Set();
    this.title = '';
  }

  // Liste aus OpenSCADs param-Export übernehmen; Nutzerwerte bleiben, solange es den Parameter noch gibt
  setParams(json) {
    // $fn & Co. nur zeigen, wenn sie ausdrücklich einen Bereich oder eine Auswahl haben
    const list = (json?.parameters ?? []).filter((p) => p.group !== 'Hidden' && (!p.name.startsWith('$') || p.max != null || p.options));
    const keep = {};
    for (const p of list) {
      if (p.name in this.values && typeof this.values[p.name] === typeof p.initial && Array.isArray(this.values[p.name]) === Array.isArray(p.initial)) {
        keep[p.name] = this.values[p.name];
      }
    }
    const changed = !same(this.params.map((p) => [p.name, p.type, p.min, p.max, p.step, p.options, p.initial, p.group, p.caption]),
      list.map((p) => [p.name, p.type, p.min, p.max, p.step, p.options, p.initial, p.group, p.caption]));
    this.params = list;
    const valuesChanged = !same(keep, this.values);
    this.values = keep;
    if (changed) this.render();
    this.dispatchEvent(new CustomEvent('params', { detail: { count: list.length } }));
    if (valuesChanged) this.emitChange(false);
  }

  get count() { return this.params.length; }

  defines() {
    const out = {};
    for (const [k, v] of Object.entries(this.values)) out[k] = toLiteral(v);
    return out;
  }

  setValues(values) {
    this.values = { ...(values ?? {}) };
    this.render();
  }

  reset(name) {
    if (name) delete this.values[name]; else this.values = {};
    this.render();
    this.emitChange(true);
  }

  emitChange(render = true) {
    this.dispatchEvent(new CustomEvent('change', { detail: { values: this.values, render } }));
  }

  set(name, value, { live = false } = {}) {
    const p = this.params.find((x) => x.name === name);
    if (!p) return;
    if (same(value, p.initial)) delete this.values[name];
    else this.values[name] = value;
    this.root.querySelector(`[data-param="${CSS.escape(name)}"]`)?.classList.toggle('changed', name in this.values);
    this.updateResetAll();
    this.dispatchEvent(new CustomEvent('change', { detail: { values: this.values, render: true, live } }));
  }

  updateResetAll() {
    const btn = this.root.querySelector('.cz-reset-all');
    if (btn) btn.disabled = !Object.keys(this.values).length;
  }

  render() {
    const root = this.root;
    root.innerHTML = '';
    if (!this.params.length) {
      root.appendChild(h(`<div class="cz-empty">
        <div class="cz-empty-ico">${icon('sliders')}</div>
        <div class="cz-empty-title">Keine Parameter</div>
        <div class="cz-empty-text">Variablen oben im Code werden hier zu Reglern, z.&nbsp;B.<br><code>breite = 40; // [10:100]</code><br><code>/* [Gruppe] */</code> ordnet sie.</div>
      </div>`));
      return;
    }
    const head = h(`<div class="cz-head">
      <span class="cz-count">${this.params.length} Parameter</span>
      <button class="btn ghost small cz-reset-all" ${Object.keys(this.values).length ? '' : 'disabled'}>${icon('rotate')}<span>Alle zurücksetzen</span></button>
    </div>`);
    head.querySelector('.cz-reset-all').onclick = () => this.reset();
    root.appendChild(head);

    const groups = new Map();
    for (const p of this.params) {
      const g = p.group || 'Parameter';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    for (const [g, list] of groups) {
      const label = g === 'Parameters' ? 'Parameter' : g;
      const sec = h(`<section class="cz-group ${this.collapsed.has(g) ? 'collapsed' : ''}">
        <button class="cz-group-head">${icon('chevronDown')}<span>${esc(label)}</span><span class="cz-group-n">${list.length}</span></button>
        <div class="cz-group-body"></div>
      </section>`);
      sec.querySelector('.cz-group-head').onclick = () => {
        sec.classList.toggle('collapsed');
        if (sec.classList.contains('collapsed')) this.collapsed.add(g); else this.collapsed.delete(g);
      };
      const body = sec.querySelector('.cz-group-body');
      for (const p of list) body.appendChild(this.control(p));
      root.appendChild(sec);
    }
  }

  control(p) {
    const value = p.name in this.values ? this.values[p.name] : p.initial;
    const row = h(`<div class="cz-param ${p.name in this.values ? 'changed' : ''}" data-param="${esc(p.name)}">
      <div class="cz-label">
        <span class="cz-name" title="${esc(p.name)}">${esc(p.caption || prettyName(p.name))}</span>
        <button class="cz-reset" title="Auf ${esc(toLiteral(p.initial))} zurücksetzen">${icon('rotate')}</button>
      </div>
      <div class="cz-input"></div>
      ${p.caption ? `<div class="cz-var">${esc(p.name)}</div>` : ''}
    </div>`);
    row.querySelector('.cz-reset').onclick = () => {
      delete this.values[p.name];
      row.replaceWith(this.control(p));
      this.updateResetAll();
      this.emitChange(true);
    };
    const box = row.querySelector('.cz-input');

    if (p.options) {
      const sel = h(`<select class="input">${p.options.map((o, i) => `<option value="${i}">${esc(o.name ?? o.value)}</option>`).join('')}</select>`);
      sel.selectedIndex = Math.max(0, p.options.findIndex((o) => same(o.value, value)));
      sel.onchange = () => this.set(p.name, p.options[sel.selectedIndex].value);
      box.appendChild(sel);
    } else if (p.type === 'boolean') {
      const sw = h(`<label class="switch"><input type="checkbox" ${value ? 'checked' : ''}><span></span></label>`);
      sw.querySelector('input').onchange = (e) => this.set(p.name, e.target.checked);
      box.appendChild(sw);
    } else if (p.type === 'number' && Array.isArray(value)) {
      const wrap = h('<div class="cz-vector"></div>');
      const vals = [...value];
      vals.forEach((v, i) => {
        const inp = h(`<input class="input num" type="number" step="${p.step ?? 'any'}" ${p.min != null ? `min="${p.min}"` : ''} ${p.max != null ? `max="${p.max}"` : ''} value="${v}">`);
        inp.oninput = () => {
          const n = Number(inp.value);
          if (inp.value === '' || !Number.isFinite(n)) return;
          vals[i] = n;
          this.set(p.name, [...vals], { live: true });
        };
        wrap.appendChild(inp);
      });
      box.appendChild(wrap);
    } else if (p.type === 'number') {
      const hasRange = p.min != null && p.max != null;
      const step = p.step ?? (Number.isInteger(p.initial) ? 1 : 0.1);
      const num = h(`<input class="input num" type="number" step="${step}" value="${value}">`);
      if (hasRange) {
        const range = h(`<input class="range" type="range" min="${p.min}" max="${p.max}" step="${step}" value="${value}">`);
        const paint = () => {
          const t = (Number(range.value) - p.min) / ((p.max - p.min) || 1);
          range.style.setProperty('--t', `${Math.max(0, Math.min(1, t)) * 100}%`);
        };
        paint();
        range.oninput = () => { num.value = range.value; paint(); this.set(p.name, Number(range.value), { live: true }); };
        num.oninput = () => {
          const n = Number(num.value);
          if (num.value === '' || !Number.isFinite(n)) return;
          range.value = n; paint();
          this.set(p.name, n, { live: true });
        };
        box.classList.add('has-range');
        box.append(range, num);
      } else {
        num.oninput = () => {
          const n = Number(num.value);
          if (num.value === '' || !Number.isFinite(n)) return;
          this.set(p.name, n, { live: true });
        };
        box.appendChild(num);
      }
    } else {
      const inp = h(`<input class="input" type="text" value="${esc(value)}" ${p.maxLength ? `maxlength="${p.maxLength}"` : ''}>`);
      inp.oninput = () => this.set(p.name, inp.value, { live: true });
      box.appendChild(inp);
    }
    return row;
  }
}
