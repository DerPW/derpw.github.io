// Kleine UI-Bausteine: Elemente, Symbole, Menüs, Sheets, Toasts.

export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

/* ------------------------------------------------------------- Symbole */

const P = {
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  books: '<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="8" y="4" width="4" height="16" rx="1"/><path d="m13.6 6.3 3.8-1 3.8 14.6-3.8 1z"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>',
  sparkles: '<path d="M10 3.5 11.6 8a3 3 0 0 0 1.9 1.9L18 11.5l-4.5 1.6a3 3 0 0 0-1.9 1.9L10 19.5 8.4 15a3 3 0 0 0-1.9-1.9L2 11.5l4.5-1.6A3 3 0 0 0 8.4 8z"/><path d="M19 2.5v4M21 4.5h-4"/>',
  wand: '<path d="m4 20 11.5-11.5"/><path d="m13.5 6.5 4 4"/><path d="M18 2.5v3M19.5 4h-3M21 9v2M22 10h-2M12 2v2M13 3h-2"/>',
  save: '<path d="M12 3v11"/><path d="m7.5 9.5 4.5 4.5 4.5-4.5"/><path d="M5 15v3.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V15"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9.5 4v16"/>',
  inspector: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M14.5 4v16"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8" fill="currentColor"/><circle cx="4.5" cy="12" r=".8" fill="currentColor"/><circle cx="4.5" cy="18" r=".8" fill="currentColor"/>',
  sort: '<path d="M7 4v16M3.5 7.5 7 4l3.5 3.5"/><path d="M17 20V4M13.5 16.5 17 20l3.5-3.5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.3 9.5"/>',
  alert: '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 15.5-4.6-4.6a1.5 1.5 0 0 0-2.1 0L5 20"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  stack: '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  tag: '<path d="M3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7.5 7.5a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L3.6 13.6A2 2 0 0 1 3 12.2z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  ellipsis: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  revert: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4.2h4.2"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  circleDashed: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
  dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2.5"/><path d="M9 4.5V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5v1"/>',
  textQuote: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] ?? P.circleDashed}</svg>`;
}

export function iconEl(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstElementChild;
}

/* -------------------------------------------------------- Formatierung */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

export const plural = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);
export const kbd = (s) => (isMac ? s : s.replace(/⌘/g, 'Strg+').replace(/⇧/g, 'Umschalt+').replace(/⌥/g, 'Alt+'));

/* ------------------------------------------------------------- Toasts */

export function toast(message, { kind = 'info', timeout = 3600, action } = {}) {
  const host = $('#toasts');
  const el = h('div.toast', { class: kind, role: 'status' },
    h('span.toast-icon', { html: icon(kind === 'error' ? 'alert' : kind === 'success' ? 'checkCircle' : 'info') }),
    h('span.toast-text', {}, message),
    action && h('button.toast-action', { onclick: () => { action.run(); close(); } }, action.label));
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  let timer = setTimeout(close, timeout);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { timer = setTimeout(close, 1600); });
  function close() {
    el.classList.remove('in');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }
  return close;
}

/* --------------------------------------------------------------- Menüs */

let openMenu = null;

export function closeMenu() {
  if (!openMenu) return;
  const m = openMenu;
  openMenu = null;
  m.el.classList.remove('in');
  m.anchor?.classList.remove('pressed');
  setTimeout(() => m.el.remove(), 160);
  m.onClose?.();
}

/**
 * items: [{ label, icon, shortcut, checked, disabled, danger, run }, '-', { header }]
 * at: Element (Anker) oder { x, y }
 */
export function menu(at, items, { align = 'start', onClose, minWidth } = {}) {
  closeMenu();
  const el = h('div.menu', { role: 'menu' });
  if (minWidth) el.style.minWidth = `${minWidth}px`;
  const buttons = [];
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { el.append(h('div.menu-sep')); continue; }
    if (it.header) { el.append(h('div.menu-header', {}, it.header)); continue; }
    const b = h('button.menu-item', {
      role: it.checked != null ? 'menuitemcheckbox' : 'menuitem', disabled: it.disabled, class: it.danger ? 'danger' : '',
      onclick: () => { closeMenu(); it.run?.(); },
    },
    h('span.menu-check', { html: it.checked ? icon('check') : '' }),
    it.icon ? h('span.menu-icon', { html: icon(it.icon) }) : null,
    h('span.menu-label', {}, it.label),
    it.detail ? h('span.menu-detail', {}, it.detail) : null,
    it.shortcut ? h('span.menu-shortcut', {}, kbd(it.shortcut)) : null);
    buttons.push(b);
    el.append(b);
  }
  if (!items.some((i) => i && i.checked != null)) el.classList.add('no-checks');
  document.body.append(el);
  const r = at instanceof Element ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y, width: 0 };
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  let x = align === 'end' ? r.right - mw : r.left;
  let y = r.bottom + (at instanceof Element ? 6 : 0);
  if (x + mw > innerWidth - 8) x = innerWidth - mw - 8;
  if (y + mh > innerHeight - 8) y = Math.max(8, (at instanceof Element ? r.top - 6 : r.top) - mh);
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${y}px`;
  el.style.transformOrigin = `${align === 'end' ? 'right' : 'left'} top`;
  if (at instanceof Element) at.classList.add('pressed');
  openMenu = { el, anchor: at instanceof Element ? at : null, onClose };
  requestAnimationFrame(() => el.classList.add('in'));

  let idx = -1;
  const focus = (i) => { idx = (i + buttons.length) % buttons.length; buttons[idx]?.focus(); };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(idx - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); at instanceof Element && at.focus(); }
  });
  setTimeout(() => el.focus({ preventScroll: true }), 0);
  el.tabIndex = -1;
  return el;
}

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor?.contains(e.target)) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

/* --------------------------------------------------------------- Sheets */

const sheets = [];

export function sheet({ title, subtitle, body, footer, width = 560, className = '', onClose, dismissible = true }) {
  const backdrop = h('div.sheet-backdrop');
  const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, class: className, style: { width: `min(${width}px, calc(100vw - 24px))` } },
    title ? h('header.sheet-head', {},
      h('div.sheet-titles', {}, h('h2.sheet-title', {}, title), subtitle ? h('div.sheet-subtitle', {}, subtitle) : null),
      dismissible ? h('button.icon-btn.sheet-close', { title: 'Schließen (Esc)', html: icon('x'), onclick: () => close() }) : null) : null,
    h('div.sheet-body', {}, body),
    footer ? h('footer.sheet-foot', {}, footer) : null);
  backdrop.append(panel);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('in'));
  const prevFocus = document.activeElement;
  const entry = { close, dismissible, panel };
  sheets.push(entry);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop && dismissible) close(); });
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    sheets.splice(sheets.indexOf(entry), 1);
    backdrop.classList.remove('in');
    setTimeout(() => backdrop.remove(), 260);
    prevFocus?.focus?.({ preventScroll: true });
    onClose?.(result);
  }
  setTimeout(() => (panel.querySelector('[autofocus]') ?? panel.querySelector('input, textarea, button.primary') ?? panel).focus?.(), 60);
  return { close, panel };
}

export const sheetOpen = () => sheets.length > 0;
export function closeTopSheet() {
  const s = sheets.at(-1);
  if (s?.dismissible) { s.close(); return true; }
  return false;
}

export function confirmSheet({ title, message, confirm = 'OK', cancel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    const ok = h('button.btn.primary', { class: danger ? 'danger' : '', onclick: () => s.close(true) }, confirm);
    const s = sheet({
      title, width: 420, className: 'alert',
      body: h('p.alert-text', {}, message),
      footer: [h('button.btn', { onclick: () => s.close(false) }, cancel), ok],
      onClose: (r) => resolve(Boolean(r)),
    });
    setTimeout(() => ok.focus(), 80);
  });
}
