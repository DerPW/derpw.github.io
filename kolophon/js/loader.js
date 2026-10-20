// Ladeanzeige: eine Karte in der Mitte (Ordner durchsuchen) oder eine Kapsel unter der Werkzeugleiste
// (Bücher lesen, sichern, neu einlesen). Kurze Vorgänge blitzen nicht auf: sichtbar erst nach `delay`.
// Die Elemente werden einmal gebaut und danach nur noch beschriftet – so bleibt „Abbrechen“ klickbar.
import { h, icon } from './ui.js';

const host = document.getElementById('loader');
let current = null;

/**
 * Startet eine Anzeige und gibt { update, done } zurück.
 * options: { mode: 'center' | 'pill', title, detail, sub, progress (0…1), onCancel, delay, hidden }
 */
export function startTask(options) {
  current?.done();
  const state = { mode: 'center', delay: 200, ...options };
  const pill = state.mode === 'pill';
  const parts = {
    title: h(pill ? 'span.loader-title' : 'div.loader-title'),
    detail: h(pill ? 'span.loader-detail' : 'div.loader-detail'),
    sub: h('div.loader-sub'),
    bar: h('div.loader-bar', {}, h('i')),
    cancel: pill
      ? h('button.loader-x', { title: 'Abbrechen', html: icon('x'), onclick: () => state.onCancel?.() })
      : h('button.btn.small', { onclick: () => state.onCancel?.() }, 'Abbrechen'),
  };
  const el = h('div', { class: `loader-${state.mode}`, role: 'status' },
    h(pill ? 'span.spinner' : 'span.spinner.big'), parts.title, parts.detail, pill ? null : parts.sub, parts.bar, parts.cancel);
  host.className = `loader ${state.mode}`;
  host.replaceChildren(el);
  let visible = false;
  let finished = false;
  let timer = null;

  function set(node, text) {
    node.hidden = !text;
    if (node.textContent !== text) node.textContent = text ?? '';
  }

  function paint() {
    set(parts.title, state.title);
    set(parts.detail, state.detail);
    set(parts.sub, state.sub);
    parts.sub.title = state.sub ?? '';
    const pct = state.progress == null ? null : Math.max(0, Math.min(1, state.progress));
    parts.bar.hidden = pct == null;
    if (pct != null) parts.bar.firstChild.style.width = `${pct * 100}%`;
    parts.cancel.hidden = !state.onCancel;
  }

  function show() {
    if (finished || visible) return;
    visible = true;
    host.hidden = false;
    requestAnimationFrame(() => { if (current === task) host.classList.add('in'); });
  }

  const task = {
    update(patch) {
      if (finished) return;
      Object.assign(state, patch);
      paint();
      if (patch.show) show();
    },
    done() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (current === task) current = null;
      host.classList.remove('in');
      setTimeout(() => { if (!current) { host.hidden = true; host.replaceChildren(); } }, 220);
    },
  };
  current = task;
  paint();
  if (!state.hidden) timer = setTimeout(show, state.delay);
  return task;
}

export const fmt = (n) => Number(n ?? 0).toLocaleString('de-DE');
