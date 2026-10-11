// Befehlspalette (⌘K), Einstellungen und Tastenkürzel-Übersicht.
import { $, $$, esc, h, icon, openModal } from './ui.js';

/* ------------------------------------------------------------ Palette */

export function openPalette(commands) {
  const body = h(`
    <div class="palette-body">
      <label class="palette-search">${icon('search')}<input placeholder="Befehl oder Automation suchen …" autocomplete="off" spellcheck="false"><span class="kbd">esc</span></label>
      <div class="palette-list"></div>
    </div>`);
  const modal = openModal({ title: 'Befehle', iconName: 'command', body, className: 'palette' });
  const input = $('input', body);
  const list = $('.palette-list', body);
  let items = [];
  let active = 0;

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const render = () => {
    const q = norm(input.value.trim());
    items = commands.filter((c) => !c.hidden && (!q || q.split(/\s+/).every((t) => norm(`${c.title} ${c.desc ?? ''} ${c.group}`).includes(t))));
    active = Math.min(active, Math.max(0, items.length - 1));
    let group = null;
    list.innerHTML = items.map((c, i) => {
      const head = c.group !== group ? `<div class="palette-group">${esc((group = c.group))}</div>` : '';
      return `${head}<button class="palette-item ${i === active ? 'active' : ''}" data-i="${i}" ${c.disabled ? 'disabled' : ''}>
        <span class="pi-icon">${icon(c.icon)}</span>
        <span class="pi-text"><b>${esc(c.title)}</b>${c.desc ? `<small>${esc(c.desc)}</small>` : ''}</span>
        ${c.kbd ? `<span class="kbd">${esc(c.kbd)}</span>` : ''}
      </button>`;
    }).join('') || '<div class="palette-empty">Nichts gefunden</div>';
  };
  const run = (i) => {
    const c = items[i];
    if (!c || c.disabled) return;
    modal.close();
    setTimeout(() => c.run(), 60);
  };
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
      render();
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.palette-item');
    if (btn) run(+btn.dataset.i);
  });
  list.addEventListener('mousemove', (e) => {
    const btn = e.target.closest('.palette-item');
    if (btn && +btn.dataset.i !== active) {
      active = +btn.dataset.i;
      $$('.palette-item', list).forEach((b) => b.classList.toggle('active', +b.dataset.i === active));
    }
  });
  render();
}

/* -------------------------------------------------------- Einstellungen */

export const ACCENTS = [
  ['violet', 'Violett', 262], ['blue', 'Blau', 218], ['teal', 'Türkis', 172],
  ['green', 'Grün', 145], ['amber', 'Bernstein', 36], ['pink', 'Pink', 330],
];

export function openSettings(settings, onChange) {
  const body = h(`
    <form class="settings" onsubmit="return false">
      <section>
        <h3>Darstellung</h3>
        <div class="set-row"><div><b>Design</b><small>Dunkel ist Standard, „System“ folgt deinem Betriebssystem.</small></div>
          <div class="seg">${[['dark', 'Dunkel', 'moon'], ['light', 'Hell', 'sun'], ['system', 'System', 'monitor']].map(([v, l, ic]) => `
            <label><input type="radio" name="theme" value="${v}" ${settings.theme === v ? 'checked' : ''}><span>${icon(ic)}${l}</span></label>`).join('')}</div>
        </div>
        <div class="set-row"><div><b>Akzentfarbe</b><small>Färbt Auswahl, Buttons und den Hintergrund.</small></div>
          <div class="swatches">${ACCENTS.map(([v, l, hue]) => `
            <label class="swatch" title="${l}" style="--sw:${hue}"><input type="radio" name="accent" value="${v}" ${settings.accent === v ? 'checked' : ''}><span></span></label>`).join('')}</div>
        </div>
        <div class="set-row"><div><b>Animationen</b><small>Bewegter Hintergrund und Übergänge.</small></div>
          <label class="switch"><input type="checkbox" name="motion" ${settings.motion ? 'checked' : ''}><span></span></label>
        </div>
      </section>
      <section>
        <h3>Speichern</h3>
        <div class="set-row"><div><b>ID3-Version für MP3/WAV/AIFF</b><small>2.3 ist am kompatibelsten (Windows, ältere Player). Vorhandene Tags behalten ihre Version.</small></div>
          <div class="seg">${[[3, 'ID3v2.3'], [4, 'ID3v2.4']].map(([v, l]) => `<label><input type="radio" name="id3Version" value="${v}" ${settings.id3Version === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        </div>
      </section>
      <section>
        <h3>${icon('zap')} Automatik beim Speichern</h3>
        <div class="set-row"><div><b>Leerzeichen bereinigen</b><small>Doppelte und überflüssige Leerzeichen in Textfeldern entfernen.</small></div>
          <label class="switch"><input type="checkbox" name="autoClean" ${settings.autoClean ? 'checked' : ''}><span></span></label>
        </div>
        <div class="set-row"><div><b>„Tracks gesamt“ ergänzen</b><small>Fehlt die Gesamtzahl, wird sie aus der Anzahl der Titel im Album-Ordner ermittelt.</small></div>
          <label class="switch"><input type="checkbox" name="autoTrackTotal" ${settings.autoTrackTotal ? 'checked' : ''}><span></span></label>
        </div>
        <div class="set-row"><div><b>Dateien automatisch umbenennen</b><small>Nach jedem Speichern werden die Dateinamen aus den Tags erzeugt.</small></div>
          <label class="switch"><input type="checkbox" name="autoRename" ${settings.autoRename ? 'checked' : ''}><span></span></label>
        </div>
        <div class="set-row sub ${settings.autoRename ? '' : 'disabled'}" data-dep="autoRename">
          <div><b>Muster</b><small>z. B. {track} - {title} oder {albumartist|artist}/{album}/{track} - {title}</small></div>
          <input class="input mono" name="renamePattern" value="${esc(settings.renamePattern)}" spellcheck="false">
        </div>
      </section>
    </form>`);
  openModal({ title: 'Einstellungen', iconName: 'settings', body, className: 'modal-settings' });
  body.addEventListener('input', (e) => {
    const el = e.target;
    const v = el.type === 'checkbox' ? el.checked : el.name === 'id3Version' ? +el.value : el.value;
    settings[el.name] = v;
    $$('[data-dep]', body).forEach((row) => row.classList.toggle('disabled', !settings[row.dataset.dep]));
    onChange(settings);
  });
}

/* --------------------------------------------------------- Tastenkürzel */

export function openShortcuts() {
  const groups = [
    ['Allgemein', [['⌘ O', 'Ordner öffnen'], ['⌘ S', 'Speichern'], ['⌘ K', 'Befehle & Automationen'], ['⌘ F', 'Suchen'], ['⌘ Z / ⇧⌘ Z', 'Rückgängig / Wiederholen'], ['?', 'Diese Übersicht']]],
    ['Liste', [['↑ ↓', 'Titel wechseln'], ['⇧ ↑ ↓', 'Auswahl erweitern'], ['⌘ A', 'Alle auswählen'], ['⇧ Klick / ⌘ Klick', 'Bereich / einzeln'], ['Doppelklick', 'Feld bearbeiten'], ['Esc', 'Auswahl aufheben']]],
    ['Bearbeiten', [['Enter', 'Zum ersten Feld / nächstes Feld'], ['⇧ Enter', 'Vorheriges Feld'], ['Leertaste', 'Vorschau abspielen'], ['⌘ V', 'Cover einfügen'], ['3/12', 'Track und Gesamtzahl auf einmal']]],
  ];
  openModal({
    title: 'Tastenkürzel', iconName: 'command', className: 'modal-small modal-keys',
    body: groups.map(([g, rows]) => `<div class="keys-group"><h4>${g}</h4>${rows.map(([k, l]) => `<div class="keys-row"><span>${l}</span><span class="kbd">${k}</span></div>`).join('')}</div>`).join(''),
  });
}
