// UI-Bausteine: Icons, Toasts, Modals, Kontextmenüs, kleine Helfer.

const P = (d) => `<path d="${d}"/>`;
const ICONS = {
  tag: P('M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z') + '<circle cx="7.5" cy="7.5" r=".9" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="8"/>' + P('m21 21-4.3-4.3'),
  folder: P('M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'),
  folderOpen: P('m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2'),
  save: P('M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z') + P('M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7') + P('M7 3v4a1 1 0 0 0 1 1h7'),
  sparkles: P('M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z') + P('M20 3v4') + P('M22 5h-4') + P('M4 17v2') + P('M5 18H3'),
  undo: P('M9 14 4 9l5-5') + P('M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'),
  redo: P('m15 14 5-5-5-5') + P('M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13'),
  sun: '<circle cx="12" cy="12" r="4"/>' + P('M12 2v2') + P('M12 20v2') + P('m4.93 4.93 1.41 1.41') + P('m17.66 17.66 1.41 1.41') + P('M2 12h2') + P('M20 12h2') + P('m6.34 17.66-1.41 1.41') + P('m19.07 4.93-1.41 1.41'),
  moon: P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'),
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/>' + P('M8 21h8') + P('M12 17v4'),
  settings: P('M21 4h-7') + P('M10 4H3') + P('M21 12h-9') + P('M8 12H3') + P('M21 20h-5') + P('M12 20H3') + P('M14 2v4') + P('M8 10v4') + P('M16 18v4'),
  x: P('M18 6 6 18') + P('m6 6 12 12'),
  check: P('M20 6 9 17l-5-5'),
  chevronRight: P('m9 18 6-6-6-6'),
  chevronDown: P('m6 9 6 6 6-6'),
  chevronUp: P('m18 15-6-6-6 6'),
  music: P('M9 18V5l12-2v13') + '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/>' + P('m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'),
  trash: P('M3 6h18') + P('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6') + P('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'),
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1.2" fill="currentColor" stroke="none"/>',
  upload: P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') + P('M17 8l-5-5-5 5') + P('M12 3v12'),
  download: P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') + P('m7 10 5 5 5-5') + P('M12 15V3'),
  filePen: P('M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10') + P('M14 2v4a2 2 0 0 0 2 2h4') + P('M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z'),
  fileInput: P('M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4') + P('M14 2v4a2 2 0 0 0 2 2h4') + P('M2 15h10') + P('m9 18 3-3-3-3'),
  hash: P('M4 9h16') + P('M4 15h16') + P('M10 3 8 21') + P('M16 3l-2 18'),
  type: P('M4 7V4h16v3') + P('M9 20h6') + P('M12 4v16'),
  replace: P('M14 4a2 2 0 0 1 2-2') + P('M16 10a2 2 0 0 1-2-2') + P('M20 2a2 2 0 0 1 2 2') + P('M22 8a2 2 0 0 1-2 2') + P('m3 7 3 3 3-3') + P('M6 10V5a3 3 0 0 1 3-3h1') + '<rect x="2" y="14" width="8" height="8" rx="2"/>',
  eraser: P('m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21') + P('M22 21H7') + P('m5 11 9 9'),
  users: P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2') + '<circle cx="9" cy="7" r="4"/>' + P('M22 21v-2a4 4 0 0 0-3-3.87') + P('M16 3.13a4 4 0 0 1 0 7.75'),
  braces: P('M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1') + P('M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1'),
  arrowRight: P('M5 12h14') + P('m12 5 7 7-7 7'),
  rotate: P('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8') + P('M3 3v5h5'),
  refresh: P('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8') + P('M21 3v5h-5') + P('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16') + P('M8 16H3v5'),
  alert: P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3') + P('M12 9v4') + P('M12 17h.01'),
  info: '<circle cx="12" cy="12" r="10"/>' + P('M12 16v-4') + P('M12 8h.01'),
  zap: P('M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'),
  command: P('M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3'),
  shield: P('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z') + P('m9 12 2 2 4-4'),
  layers: P('m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z') + P('m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65') + P('m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'),
  external: P('M15 3h6v6') + P('M10 14 21 3') + P('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'),
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/>' + P('M15 3v18'),
  github: P('M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4') + P('M9 18c-4.51 2-5-2-7-2'),
  wand: P('m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72') + P('m14 7 3 3') + P('M5 6v4') + P('M19 14v4') + P('M10 2v2') + P('M7 8H3') + P('M21 16h-4') + P('M11 3H9'),
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
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(`tagwerk.${key}`);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function store(key, value) {
  try { localStorage.setItem(`tagwerk.${key}`, JSON.stringify(value)); } catch { /* privat/voll */ }
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
      <button class="toast-close" aria-label="Schließen">${icon('x')}</button>
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
  return {
    close,
    update(msg, opts = {}) {
      el.querySelector('.toast-msg').textContent = msg;
      if (opts.type) {
        el.className = `toast toast-${opts.type}`;
        el.querySelector('.toast-icon').innerHTML = icon({ success: 'check', error: 'alert', warning: 'alert', info: 'info' }[opts.type] ?? 'info');
      }
      if (opts.duration) arm(opts.duration);
    },
  };
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
          <button class="btn icon ghost modal-x" aria-label="Schließen">${icon('x')}</button>
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
      backdrop.classList.add('leaving');
      setTimeout(() => backdrop.remove(), 200);
      prevFocus?.focus?.({ preventScroll: true });
      onClose?.();
    },
  };
  backdrop.querySelector('.modal-x').onclick = api.close;
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) api.close(); });
  modalStack.push(api);
  requestAnimationFrame(() => {
    const first = api.el.querySelector('[autofocus]') ?? api.el.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select');
    first?.focus();
  });
  return api;
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}

export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Abbrechen', danger = false, iconName = 'alert' }) {
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

/* ---------------------------------------------------------- Kontextmenü */

let openMenu = null;
export function contextMenu(x, y, items) {
  openMenu?.remove();
  const el = h('<div class="menu glass" role="menu"></div>');
  for (const item of items) {
    if (item === 'sep') { el.appendChild(h('<div class="menu-sep"></div>')); continue; }
    const btn = h(`<button class="menu-item ${item.danger ? 'danger' : ''}" ${item.disabled ? 'disabled' : ''}>
      ${icon(item.icon ?? 'chevronRight')}<span>${esc(item.label)}</span>${item.kbd ? `<span class="kbd">${esc(item.kbd)}</span>` : ''}
    </button>`);
    btn.onclick = () => { close(); item.action(); };
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  el.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  openMenu = el;
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 140);
    if (openMenu === el) openMenu = null;
    removeEventListener('mousedown', outside, true);
    removeEventListener('keydown', onKey, true);
  };
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => {
    addEventListener('mousedown', outside, true);
    addEventListener('keydown', onKey, true);
  });
  return close;
}
