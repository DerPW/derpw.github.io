// Lichtkegel folgt dem Mauszeiger über die Karten.
const grid = document.getElementById('projects');

grid.addEventListener('pointermove', (e) => {
  for (const card of grid.children) {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }
});

// Hell/Dunkel: folgt dem System, bis man selbst umschaltet (dann gespeichert).
const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const THEME_KEY = 'start.theme';

function storedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch { return null; }
}

function applyTheme(theme, animate) {
  if (animate && !reduceMotion.matches) {
    root.classList.add('theme-anim');
    clearTimeout(applyTheme.timer);
    applyTheme.timer = setTimeout(() => root.classList.remove('theme-anim'), 500);
  }
  root.dataset.theme = theme;
  themeMeta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
  const label = theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren';
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

applyTheme(storedTheme() || (systemDark.matches ? 'dark' : 'light'), false);

toggle.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next, true);
});

systemDark.addEventListener('change', (e) => {
  if (!storedTheme()) applyTheme(e.matches ? 'dark' : 'light', true);
});

// Zählscheibe: ein Punkt je Projekt, der Punkt der aktiven Karte leuchtet auf.
const dial = document.getElementById('dial');
const dots = document.getElementById('dial-dots');
const cards = [...grid.querySelectorAll('.card')];

document.getElementById('dial-count').textContent = cards.length;
cards.forEach((card, n) => {
  const dot = document.createElement('i');
  dot.style.setProperty('--a', `${(360 / cards.length) * n}deg`);
  dot.style.setProperty('--n', n);
  dots.append(dot);
});

function highlight(card) {
  const n = cards.indexOf(card);
  dial.classList.toggle('is-active', n >= 0);
  [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i === n));
}

grid.addEventListener('pointerover', (e) => highlight(e.target.closest('.card')));
grid.addEventListener('pointerleave', () => highlight(null));
grid.addEventListener('focusin', (e) => highlight(e.target.closest('.card')));
grid.addEventListener('focusout', (e) => { if (!grid.contains(e.relatedTarget)) highlight(null); });
