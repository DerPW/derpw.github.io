// UI-Bausteine: Icons, Toasts, Modals, Menüs, kleine Helfer.

import { t, locale } from './i18n.js';

const P = (d) => `<path d="${d}"/>`;
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const ICONS = {
  box: P('M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z') + P('m3.3 7 8.7 5 8.7-5') + P('M12 22V12'),
  code: P('m16 18 6-6-6-6') + P('m8 6-6 6 6 6'),
  puzzle: P('M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z'),
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  folderOpen: P('m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2'),
  save: P('M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z') + P('M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7') + P('M7 3v4a1 1 0 0 0 1 1h7'),
  download: P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') + P('m7 10 5 5 5-5') + P('M12 15V3'),
  upload: P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') + P('M17 8l-5-5-5 5') + P('M12 3v12'),
  share: C(18, 5, 3) + C(6, 12, 3) + C(18, 19, 3) + P('m8.59 13.51 6.83 3.98') + P('m15.41 6.51-6.82 3.98'),
  link: P('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71') + P('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'),
  sun: C(12, 12, 4) + P('M12 2v2') + P('M12 20v2') + P('m4.93 4.93 1.41 1.41') + P('m17.66 17.66 1.41 1.41') + P('M2 12h2') + P('M20 12h2') + P('m6.34 17.66-1.41 1.41') + P('m19.07 4.93-1.41 1.41'),
  moon: P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'),
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/>' + P('M8 21h8') + P('M12 17v4'),
  sliders: P('M21 4h-7') + P('M10 4H3') + P('M21 12h-9') + P('M8 12H3') + P('M21 20h-5') + P('M12 20H3') + P('M14 2v4') + P('M8 10v4') + P('M16 18v4'),
  settings: P('M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z') + C(12, 12, 3),
  terminal: P('m4 17 6-6-6-6') + P('M12 19h8'),
  file: P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z') + P('M14 2v4a2 2 0 0 0 2 2h4'),
  fileCode: P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z') + P('M14 2v4a2 2 0 0 0 2 2h4') + P('m10 13-2 2 2 2') + P('m14 17 2-2-2-2'),
  filePlus: P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z') + P('M14 2v4a2 2 0 0 0 2 2h4') + P('M9 15h6') + P('M12 18v-6'),
  book: P('M12 7v14') + P('M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'),
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/>' + P('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'),
  grid: '<rect width="18" height="18" x="3" y="3" rx="2"/>' + P('M3 9h18') + P('M3 15h18') + P('M9 3v18') + P('M15 3v18'),
  globe: C(12, 12, 10) + P('M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20') + P('M2 12h20'),
  axes: P('M4 4v16h16') + P('m4 20 7-7'),
  edges: P('M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z'),
  focus: P('M3 7V5a2 2 0 0 1 2-2h2') + P('M17 3h2a2 2 0 0 1 2 2v2') + P('M21 17v2a2 2 0 0 1-2 2h-2') + P('M7 21H5a2 2 0 0 1-2-2v-2') + C(12, 12, 1),
  camera: P('M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z') + C(12, 13, 3),
  ruler: P('M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z') + P('m14.5 12.5 2-2') + P('m11.5 9.5 2-2') + P('m8.5 6.5 2-2') + P('m17.5 15.5 2-2'),
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/>' + P('M6 8h.01') + P('M10 8h.01') + P('M14 8h.01') + P('M18 8h.01') + P('M8 12h.01') + P('M12 12h.01') + P('M16 12h.01') + P('M7 16h10'),
  package: P('m7.5 4.27 9 5.15') + P('M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z') + P('m3.3 7 8.7 5 8.7-5') + P('M12 22V12'),
  x: P('M18 6 6 18') + P('m6 6 12 12'),
  check: P('M20 6 9 17l-5-5'),
  plus: P('M5 12h14') + P('M12 5v14'),
  chevronRight: P('m9 18 6-6-6-6'),
  chevronDown: P('m6 9 6 6 6-6'),
  alert: P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3') + P('M12 9v4') + P('M12 17h.01'),
  alertCircle: C(12, 12, 10) + P('M12 8v4') + P('M12 16h.01'),
  info: C(12, 12, 10) + P('M12 16v-4') + P('M12 8h.01'),
  refresh: P('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8') + P('M21 3v5h-5') + P('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16') + P('M8 16H3v5'),
  rotate: P('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8') + P('M3 3v5h5'),
  trash: P('M3 6h18') + P('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6') + P('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'),
  sparkles: P('M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z') + P('M20 3v4') + P('M22 5h-4'),
  zap: P('M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'),
  wand: P('m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72') + P('m14 7 3 3') + P('M5 6v4') + P('M19 14v4') + P('M10 2v2') + P('M7 8H3') + P('M21 16h-4') + P('M11 3H9'),
  external: P('M15 3h6v6') + P('M10 14 21 3') + P('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'),
  clock: C(12, 12, 10) + P('M12 6v6l4 2'),
  layers: P('m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z') + P('m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65') + P('m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'),
  wifiOff: P('M12 20h.01') + P('M8.5 16.429a5 5 0 0 1 7 0') + P('M5 12.859a10 10 0 0 1 5.17-2.69') + P('M19 12.859a10 10 0 0 0-2.007-1.523') + P('M2 8.82a15 15 0 0 1 4.177-2.643') + P('M22 8.82a15 15 0 0 0-11.288-3.764') + P('m2 2 20 20'),
  panelBottom: '<rect width="18" height="18" x="3" y="3" rx="2"/>' + P('M3 15h18'),
  sidebar: '<rect width="18" height="18" x="3" y="3" rx="2"/>' + P('M9 3v18'),
  menu: P('M4 12h16') + P('M4 6h16') + P('M4 18h16'),
  more: C(12, 12, 1) + C(19, 12, 1) + C(5, 12, 1),
  github: P('M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4') + P('M9 18c-4.51 2-5-2-7-2'),
};

export function icon(name, cls = '') {
  const body = ICONS[name] ?? ICONS.info;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone !== el.dataset.icon) setIcon(el, el.dataset.icon);
  });
}

export function setIcon(el, name) {
  el.querySelector(':scope > svg.ico')?.remove();
  el.insertAdjacentHTML('afterbegin', icon(name));
  el.dataset.icon = el.dataset.iconDone = name;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const el = t.content.firstElementChild;
  hydrateIcons(t.content);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
export const MOD = isMac ? '⌘' : 'Strg+';

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(`formwerk.${key}`);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function store(key, value) {
  try { localStorage.setItem(`formwerk.${key}`, JSON.stringify(value)); } catch { /* privat/voll */ }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function formatNumber(n, digits = 2) {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString(locale(), { maximumFractionDigits: digits });
}

export function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} s`;
  const m = Math.floor(ms / 60000);
  return `${m} min ${Math.round((ms % 60000) / 1000)} s`;
}

/* ---------------------------------------------------------------- Toasts */

export function toast(message, { type = 'info', action, actionLabel, duration = 4200, detail } = {}) {
  const root = document.getElementById('toasts');
  const iconName = { info: 'info', success: 'check', error: 'alert', warning: 'alert', progress: 'refresh' }[type];
  const el = h(`
    <div class="toast toast-${type}">
      <div class="toast-icon">${icon(iconName)}</div>
      <div class="toast-body">
        <div class="toast-msg"></div>
        ${detail ? '<div class="toast-detail"></div>' : ''}
      </div>
      ${action ? `<button class="toast-action">${esc(actionLabel)}</button>` : ''}
      <button class="toast-close" aria-label="${esc(t('Schließen'))}">${icon('x')}</button>
      ${duration ? `<div class="toast-timer" style="animation-duration:${duration}ms"></div>` : ''}
    </div>`);
  el.querySelector('.toast-msg').textContent = message;
  if (detail) el.querySelector('.toast-detail').textContent = detail;
  root.appendChild(el);

  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 260);
  };
  const arm = (ms) => { if (ms) timer = setTimeout(close, ms); };
  el.querySelector('.toast-close').onclick = close;
  if (action) el.querySelector('.toast-action').onclick = () => { close(); action(); };
  el.addEventListener('mouseenter', () => { clearTimeout(timer); el.classList.add('paused'); });
  el.addEventListener('mouseleave', () => { el.classList.remove('paused'); arm(1800); });
  arm(duration);
  return { close };
}

/* ---------------------------------------------------------------- Modals */

const modalStack = [];
export const modalOpen = () => modalStack.length > 0;

export function openModal({ title, subtitle = '', iconName = 'sparkles', body, footer = '', className = '', onClose }) {
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal glass ${className}" role="dialog" aria-modal="true">
        <header class="modal-head">
          <div class="modal-icon">${icon(iconName)}</div>
          <div class="modal-titles">
            <h2 class="modal-title">${esc(title)}</h2>
            ${subtitle ? `<p class="modal-sub">${esc(subtitle)}</p>` : ''}
          </div>
          <button class="btn icon ghost modal-x" aria-label="${esc(t('Schließen'))}">${icon('x')}</button>
        </header>
        <div class="modal-body"></div>
        ${footer ? '<footer class="modal-foot"></footer>' : ''}
      </div>
    </div>`);
  const bodyEl = backdrop.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  if (footer) {
    const foot = backdrop.querySelector('.modal-foot');
    if (typeof footer === 'string') foot.innerHTML = footer; else foot.appendChild(footer);
  }
  hydrateIcons(backdrop);
  document.getElementById('layer').appendChild(backdrop);
  const prevFocus = document.activeElement;

  const api = {
    el: backdrop.querySelector('.modal'),
    body: bodyEl,
    close() {
      const i = modalStack.indexOf(api);
      if (i < 0) return;
      modalStack.splice(i, 1);
      if (!modalStack.length) document.body.classList.remove('modal-open');
      backdrop.classList.add('leaving');
      setTimeout(() => backdrop.remove(), 200);
      prevFocus?.focus?.({ preventScroll: true });
      onClose?.();
    },
  };
  backdrop.querySelector('.modal-x').onclick = api.close;
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) api.close(); });
  modalStack.push(api);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    const first = api.el.querySelector('[autofocus]') ?? api.el.querySelector('input:not([type=checkbox]):not([type=radio]):not([readonly]), textarea:not([readonly]), select');
    first?.focus();
  });
  return api;
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}

export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = t('Abbrechen'), danger = false, iconName = 'alert' }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, iconName, className: 'modal-small',
      body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<div class="foot-spacer"></div><button class="btn ghost" data-act="cancel">${esc(cancelLabel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok" autofocus>${esc(confirmLabel)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.el.querySelector('[data-act=cancel]').onclick = () => m.close();
    m.el.querySelector('[data-act=ok]').onclick = () => { done = true; resolve(true); m.close(); };
    setTimeout(() => m.el.querySelector('[data-act=ok]').focus(), 30);
  });
}

/* ------------------------------------------------------------------ Menüs */

let openMenuEl = null;
export function menu(x, y, items, { anchor } = {}) {
  closeMenu();
  const el = h('<div class="menu glass" role="menu"></div>');
  for (const item of items) {
    if (item === 'sep') { el.appendChild(h('<div class="menu-sep"></div>')); continue; }
    if (item.heading) { el.appendChild(h(`<div class="menu-heading">${esc(item.heading)}</div>`)); continue; }
    const btn = h(`<button class="menu-item ${item.danger ? 'danger' : ''} ${item.checked ? 'checked' : ''}" role="menuitem" ${item.disabled ? 'disabled' : ''}>
      ${icon(item.checked ? 'check' : (item.icon ?? 'chevronRight'))}
      <span class="menu-label"><span class="menu-title">${esc(item.label)}</span>${item.sub ? `<span class="menu-sub">${esc(item.sub)}</span>` : ''}</span>
      ${item.kbd ? `<span class="kbd">${esc(item.kbd)}</span>` : ''}
    </button>`);
    btn.onclick = () => { close(); item.action?.(); };
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    x = Math.min(a.right - r.width, innerWidth - r.width - 8);
    x = Math.max(8, x);
    y = a.bottom + 6;
    if (y + r.height > innerHeight - 8) y = Math.max(8, a.top - r.height - 6);
    el.style.transformOrigin = 'top right';
  } else {
    x = Math.min(x, innerWidth - r.width - 8);
    y = Math.min(y, innerHeight - r.height - 8);
  }
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  openMenuEl = el;
  anchor?.classList.add('open');
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 140);
    anchor?.classList.remove('open');
    if (openMenuEl === el) openMenuEl = null;
    removeEventListener('mousedown', outside, true);
    removeEventListener('keydown', onKey, true);
    el._close = null;
  };
  el._close = close;
  const outside = (e) => { if (!el.contains(e.target) && !anchor?.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => {
    addEventListener('mousedown', outside, true);
    addEventListener('keydown', onKey, true);
  });
  el.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
  return close;
}
export function closeMenu() { openMenuEl?._close?.(); }
