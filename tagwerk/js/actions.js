// Automationen: jede Aktion hat ein Formular, berechnet eine Vorschau und wendet sie gesammelt an.
import { FIELDS, label, plural } from './fields.js';
import { pickFolderImage } from './inspector.js';
import {
  buildPath, changeCase, cleanup, compileParser, formatPattern, parsePath, stripTrackPrefix, TOKENS, tokenValues,
} from './patterns.js';
import { displayPath, selectedFiles, setCover, setTags, state, value } from './state.js';
import { imageInfo } from './tags/bytes.js';
import { $, $$, debounce, esc, h, icon, load, openModal, store, toast } from './ui.js';

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const num = (v) => parseInt(v, 10) || 0;
const rootName = () => state.source?.name ?? '';
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/* ------------------------------------------------------- Formularbausteine */

const input = (name, val, { placeholder = '', mono = false, type = 'text' } = {}) =>
  `<input class="input ${mono ? 'mono' : ''}" type="${type}" name="${name}" value="${esc(val)}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off">`;

const row = (lbl, content, hint = '') => `<div class="form-row"><label class="lbl">${lbl}</label>${content}${hint ? `<p class="help">${hint}</p>` : ''}</div>`;

const seg = (name, value, options) => `<div class="seg">${options.map(([v, l]) => `
  <label><input type="radio" name="${name}" value="${v}" ${String(v) === String(value) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;

const check = (name, checked, text) => `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span class="box">${icon('check')}</span><span>${text}</span></label>`;

const fieldChecks = (selected, keys) => `<div class="check-grid">${keys.map((k) => `
  <label class="check pill"><input type="checkbox" name="fields[]" value="${k}" ${selected.includes(k) ? 'checked' : ''}><span class="box">${icon('check')}</span><span>${label(k)}</span></label>`).join('')}</div>`;

const tokenChips = (target, extra = []) => `<div class="tokens" data-target="${target}">${[...TOKENS, ...extra].map(([t, l]) =>
  `<button type="button" class="token" data-token="{${t}}" title="{${t}}">${esc(l)}</button>`).join('')}</div>`;

const presetChips = (target, presets) => `<div class="presets"><span class="presets-label">Vorlagen</span>${presets.map((p) =>
  `<button type="button" class="preset mono" data-target="${target}" data-value="${esc(p)}">${esc(p)}</button>`).join('')}</div>`;

const SYNTAX_HELP = '<b>{feld}</b> Wert · <b>{track:3}</b> auffüllen · <b>{albumartist|artist}</b> Alternative · <b>[ … ]</b> optional, entfällt bei leeren Feldern';

/* ---------------------------------------------------------------- Aktionen */

function tagRows(files, fn) {
  const rows = [];
  for (const file of files) {
    const next = fn(file);
    if (!next) continue;
    const changes = {};
    for (const [k, v] of Object.entries(next)) if (v !== value(file, k)) changes[k] = v;
    if (Object.keys(changes).length) rows.push({ file, changes });
  }
  return rows;
}

export function computeRename(files, pattern) {
  const nested = pattern.includes('/');
  const rows = [];
  let unchanged = 0;
  for (const file of files) {
    const rel = buildPath(pattern, tokenValues(file, value, rootName()));
    const from = displayPath(file);
    if (!rel) { rows.push({ file, from, target: null, conflict: 'Ergibt einen leeren Namen' }); continue; }
    const base = nested ? '' : dirOf(from);
    const target = `${base ? `${base}/` : ''}${rel}.${file.ext}`;
    if (target === from) { unchanged++; continue; }
    rows.push({ file, from, target });
  }
  const moving = new Set(rows.map((r) => r.file.id));
  const occupied = new Set(state.files.filter((f) => !moving.has(f.id)).map((f) => displayPath(f).toLowerCase()));
  const counts = new Map();
  for (const r of rows) if (r.target) counts.set(r.target.toLowerCase(), (counts.get(r.target.toLowerCase()) ?? 0) + 1);
  for (const r of rows) {
    if (!r.target || r.conflict) continue;
    const k = r.target.toLowerCase();
    if (counts.get(k) > 1) r.conflict = 'Mehrere Dateien bekommen denselben Namen';
    else if (occupied.has(k)) r.conflict = 'Zieldatei existiert bereits';
  }
  return { rows, unchanged };
}

const ACTIONS = [
  {
    id: 'rename',
    kind: 'rename',
    title: 'Dateien umbenennen',
    desc: 'Dateinamen aus Tags erzeugen – „/“ im Muster legt Unterordner an',
    icon: 'filePen',
    defaults: { pattern: '{track} - {title}', removeEmpty: true },
    form: (o) => `
      ${row('Muster', input('pattern', o.pattern, { mono: true }), SYNTAX_HELP)}
      ${tokenChips('pattern')}
      ${presetChips('pattern', ['{track} - {title}', '{artist} - {title}', '{track} - {artist} - {title}', '{albumartist|artist}/{album}/{track} - {title}', '{albumartist|artist}/[{year} - ]{album}/[{disc}-]{track} {title}'])}
      ${check('removeEmpty', o.removeEmpty, 'Leere Ordner danach entfernen')}`,
    compute: (files, o) => computeRename(files, o.pattern),
  },
  {
    id: 'fromName',
    kind: 'tags',
    title: 'Tags aus Dateiname',
    desc: 'Felder aus Datei- und Ordnernamen auslesen',
    icon: 'fileInput',
    defaults: { pattern: '{track} - {title}' },
    form: (o) => `
      ${row('Muster', input('pattern', o.pattern, { mono: true }), 'Mit „/“ werden Ordnernamen einbezogen. Teile, die übersprungen werden sollen: <b>{*}</b>')}
      ${tokenChips('pattern', [['*', 'Überspringen']])}
      ${presetChips('pattern', ['{track} - {title}', '{artist} - {title}', '{track} - {artist} - {title}', '{track}. {title}', '{album}/{track} - {title}', '{artist}/{album}/{track} - {title}'])}`,
    compute(files, o) {
      const parser = compileParser(o.pattern);
      let miss = 0;
      const rows = tagRows(files, (f) => {
        const parsed = parsePath(parser, f, rootName());
        if (!parsed) miss++;
        return parsed;
      });
      return { rows, note: miss ? `${plural(miss, 'Datei passt', 'Dateien passen')} nicht zum Muster` : '' };
    },
  },
  {
    id: 'number',
    kind: 'tags',
    title: 'Tracknummern vergeben',
    desc: 'Automatisch durchnummerieren – pro Ordner, pro Album oder fortlaufend',
    icon: 'hash',
    defaults: { order: 'view', group: 'folder', start: 1, total: true },
    form: (o) => `
      ${row('Reihenfolge', seg('order', o.order, [['view', 'Wie in der Liste'], ['name', 'Dateiname'], ['track', 'Bisherige Nr.']]))}
      ${row('Gruppierung', seg('group', o.group, [['folder', 'Pro Ordner'], ['album', 'Pro Album'], ['none', 'Fortlaufend']]))}
      ${row('Beginnen bei', input('start', o.start, { type: 'number' }))}
      ${check('total', o.total, 'Gesamtzahl der Tracks setzen (z. B. 3/12)')}`,
    compute(files, o) {
      const groups = new Map();
      for (const f of files) {
        const k = o.group === 'folder' ? f.dir : o.group === 'album' ? `${value(f, 'album')}|${value(f, 'albumartist') || f.dir}` : '';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(f);
      }
      const start = Math.max(0, parseInt(o.start, 10) || 1);
      const next = new Map();
      for (const list of groups.values()) {
        if (o.order === 'name') list.sort((a, b) => collator.compare(a.name, b.name));
        if (o.order === 'track') list.sort((a, b) => num(value(a, 'disc')) - num(value(b, 'disc')) || num(value(a, 'track')) - num(value(b, 'track')) || collator.compare(a.name, b.name));
        list.forEach((f, i) => next.set(f, { track: String(start + i), ...(o.total ? { tracktotal: String(start + list.length - 1) } : {}) }));
      }
      return { rows: tagRows(files, (f) => next.get(f)) };
    },
  },
  {
    id: 'format',
    kind: 'tags',
    title: 'Feld per Muster setzen',
    desc: 'z. B. Album = {folder} oder Titel = {title} ({year})',
    icon: 'braces',
    defaults: { field: 'album', pattern: '{folder}' },
    form: (o) => `
      ${row('Feld', `<select class="input" name="field">${Object.keys(FIELDS).map((k) => `<option value="${k}" ${k === o.field ? 'selected' : ''}>${label(k)}</option>`).join('')}</select>`)}
      ${row('Wert', input('pattern', o.pattern, { mono: true, placeholder: 'leer = Feld löschen' }), SYNTAX_HELP)}
      ${tokenChips('pattern')}
      <div class="presets"><span class="presets-label">Vorlagen</span>
        <button type="button" class="preset" data-set='{"field":"album","pattern":"{folder}"}'>Album = Ordnername</button>
        <button type="button" class="preset" data-set='{"field":"title","pattern":"{filename}"}'>Titel = Dateiname</button>
        <button type="button" class="preset" data-set='{"field":"albumartist","pattern":"{artist}"}'>Album-Interpret = Interpret</button>
        <button type="button" class="preset" data-set='{"field":"comment","pattern":""}'>Kommentar leeren</button>
      </div>`,
    compute: (files, o) => ({ rows: tagRows(files, (f) => ({ [o.field]: formatPattern(o.pattern, tokenValues(f, value, rootName())).trim() })) }),
  },
  {
    id: 'albumartist',
    kind: 'tags',
    title: 'Album-Interpret ergänzen',
    desc: 'Interpret übernehmen – oder „Various Artists“ bei Samplern',
    icon: 'users',
    defaults: { only: 'empty', various: 'Various Artists', group: 'album' },
    form: (o) => `
      ${row('Anwenden auf', seg('only', o.only, [['empty', 'Nur leere Felder'], ['all', 'Alle überschreiben']]))}
      ${row('Album erkennen', seg('group', o.group, [['album', 'Albumname + Ordner'], ['folder', 'Nur Ordner']]))}
      ${row('Bei mehreren Interpreten', input('various', o.various))}`,
    compute(files, o) {
      const groups = new Map();
      for (const f of files) {
        const k = o.group === 'album' ? `${f.dir}|${value(f, 'album')}` : f.dir;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(f);
      }
      const next = new Map();
      for (const list of groups.values()) {
        const artists = new Set(list.map((f) => value(f, 'artist')).filter(Boolean));
        const aa = artists.size === 1 ? [...artists][0] : artists.size > 1 ? o.various.trim() : '';
        for (const f of list) if (aa && (o.only === 'all' || !value(f, 'albumartist'))) next.set(f, { albumartist: aa });
      }
      return { rows: tagRows(files, (f) => next.get(f)) };
    },
  },
  {
    id: 'case',
    kind: 'tags',
    title: 'Groß-/Kleinschreibung',
    desc: 'Jedes Wort groß, Satzanfang, klein oder GROSS',
    icon: 'type',
    defaults: { mode: 'title', keepUpper: true, fields: ['title', 'artist', 'album', 'albumartist'] },
    form: (o) => `
      ${row('Schreibweise', seg('mode', o.mode, [['title', 'Jedes Wort'], ['sentence', 'Satzanfang'], ['lower', 'klein'], ['upper', 'GROSS']]))}
      ${row('Felder', fieldChecks(o.fields, ['title', 'artist', 'album', 'albumartist', 'genre', 'composer']))}
      ${check('keepUpper', o.keepUpper, 'Abkürzungen in Großbuchstaben beibehalten (AC/DC, DJ, II)')}`,
    compute: (files, o) => ({ rows: tagRows(files, (f) => Object.fromEntries(o.fields.map((k) => [k, changeCase(value(f, k), o.mode, o.keepUpper)]))) }),
  },
  {
    id: 'replace',
    kind: 'tags',
    title: 'Suchen & Ersetzen',
    desc: 'Text in ausgewählten Feldern ersetzen – auch mit regulären Ausdrücken',
    icon: 'replace',
    defaults: { find: '', replace: '', regex: false, cs: false, fields: ['title', 'artist', 'album', 'albumartist'] },
    form: (o) => `
      ${row('Suchen', input('find', o.find, { placeholder: 'z. B. (Remastered)' }))}
      ${row('Ersetzen durch', input('replace', o.replace, { placeholder: 'leer = entfernen' }))}
      ${row('Felder', fieldChecks(o.fields, ['title', 'artist', 'album', 'albumartist', 'genre', 'composer', 'comment']))}
      <div class="check-row">${check('regex', o.regex, 'Regulärer Ausdruck')}${check('cs', o.cs, 'Groß-/Kleinschreibung beachten')}</div>`,
    compute(files, o) {
      if (!o.find) return { rows: [], note: 'Suchbegriff eingeben' };
      let re;
      try {
        re = new RegExp(o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), `g${o.cs ? '' : 'i'}u`);
      } catch (err) {
        return { rows: [], error: `Ungültiger Ausdruck: ${err.message}` };
      }
      const rep = o.regex ? o.replace : o.replace.replace(/\$/g, '$$$$');
      return { rows: tagRows(files, (f) => Object.fromEntries(o.fields.map((k) => [k, value(f, k).replace(re, rep).replace(/\s{2,}/g, ' ').trim()]))) };
    },
  },
  {
    id: 'cleanup',
    kind: 'tags',
    title: 'Aufräumen',
    desc: 'Leerzeichen, Unterstriche, Nummern im Titel, feat.-Schreibweise',
    icon: 'eraser',
    defaults: { spaces: true, underscores: true, trackPrefix: false, feat: false, junk: false, fields: ['title', 'artist', 'album', 'albumartist', 'genre', 'composer'] },
    form: (o) => `
      <div class="check-col">
        ${check('spaces', o.spaces, 'Doppelte und überflüssige Leerzeichen entfernen')}
        ${check('underscores', o.underscores, 'Unterstriche durch Leerzeichen ersetzen')}
        ${check('trackPrefix', o.trackPrefix, 'Tracknummer am Titelanfang entfernen („01 - Titel“ → „Titel“)')}
        ${check('feat', o.feat, '„ft.“, „Feat“, „featuring“ → „feat.“')}
        ${check('junk', o.junk, 'Zusätze wie „(Official Video)“ oder „[HD]“ entfernen')}
      </div>
      ${row('Felder', fieldChecks(o.fields, ['title', 'artist', 'album', 'albumartist', 'genre', 'composer', 'comment']))}`,
    compute: (files, o) => ({
      rows: tagRows(files, (f) => Object.fromEntries(o.fields.map((k) => {
        let v = cleanup(value(f, k), o);
        if (k === 'title' && o.trackPrefix) v = stripTrackPrefix(v);
        return [k, v];
      }))),
    }),
  },
  {
    id: 'folderCover',
    kind: 'cover',
    title: 'Cover aus Ordner',
    desc: 'cover.jpg, folder.jpg oder front.png in die Dateien einbetten',
    icon: 'image',
    defaults: { onlyMissing: true },
    form: (o) => `
      ${check('onlyMissing', o.onlyMissing, 'Nur Titel ohne Cover')}
      <p class="help">Gesucht wird im Ordner jedes Titels – bevorzugt nach <b>cover</b>, <b>folder</b>, <b>front</b>, <b>album</b> (JPEG oder PNG), sonst das erste Bild.</p>`,
    async compute(files, o) {
      const byDir = new Map();
      for (const f of files) {
        const pc = state.pending.get(f.id)?.cover;
        const has = pc === undefined ? f.hasCover : pc !== null;
        if (o.onlyMissing && has) continue;
        if (!byDir.has(f.dir)) byDir.set(f.dir, []);
        byDir.get(f.dir).push(f);
      }
      const rows = [];
      let missing = 0;
      for (const [dir, list] of byDir) {
        const pick = pickFolderImage(state.source?.images?.get(dir));
        if (!pick) { missing += list.length; continue; }
        rows.push({ dir, pick, files: list });
      }
      return { rows, note: missing ? `Für ${plural(missing, 'Titel', 'Titel')} wurde kein Bild gefunden` : '' };
    },
  },
];

export const actionList = ACTIONS;

/* ------------------------------------------------------------------ Dialog */

function readForm(form) {
  const o = {};
  for (const el of $$('[name]', form)) {
    const name = el.name;
    if (name.endsWith('[]')) {
      const key = name.slice(0, -2);
      o[key] ??= [];
      if (el.checked) o[key].push(el.value);
    } else if (el.type === 'checkbox') o[name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[name] = el.value; } else o[name] = el.value;
  }
  return o;
}

const MAX_ROWS = 300;

function renderTagRows(rows) {
  return rows.slice(0, MAX_ROWS).map(({ file, changes }) => `
    <div class="pv-row">
      <div class="pv-file" title="${esc(displayPath(file))}">${icon('music')}<span>${esc(displayPath(file).split('/').pop())}</span></div>
      <div class="pv-changes">${Object.entries(changes).map(([k, v]) => {
        const old = value(file, k);
        return `<span class="chg"><em>${label(k)}</em>${old ? `<s>${esc(old)}</s>` : '<s class="empty">leer</s>'}${icon('arrowRight')}${v ? `<ins>${esc(v)}</ins>` : '<ins class="empty">entfernt</ins>'}</span>`;
      }).join('')}</div>
    </div>`).join('');
}

function renderRenameRows(rows) {
  return rows.slice(0, MAX_ROWS).map((r) => `
    <div class="pv-row rename ${r.conflict ? 'conflict' : ''}">
      <div class="pv-old mono" title="${esc(r.from)}">${esc(r.from)}</div>
      <div class="pv-arrow">${icon('arrowRight')}</div>
      <div class="pv-new mono" title="${esc(r.target ?? '')}">${esc(r.target ?? '—')}${r.conflict ? `<span class="pv-conflict">${icon('alert')}${esc(r.conflict)}</span>` : ''}</div>
    </div>`).join('');
}

const coverPreviewUrls = new Map();
function renderCoverRows(rows) {
  return rows.map((r) => {
    const key = `${r.dir}/${r.pick.name}`;
    return `<div class="pv-row cover-row" data-key="${esc(key)}">
      <div class="pv-thumb"><img alt="" ${coverPreviewUrls.has(key) ? `src="${coverPreviewUrls.get(key)}"` : ''}></div>
      <div class="pv-cover-info"><b>${esc(r.dir || rootName())}</b><span>${esc(r.pick.name)} · ${plural(r.files.length, 'Titel', 'Titel')}</span></div>
    </div>`;
  }).join('');
}

export function openAction(id, ctx = {}) {
  const spec = ACTIONS.find((a) => a.id === id);
  if (!spec) return;
  if (!state.files.length) { toast('Öffne zuerst einen Ordner mit Musik.', { type: 'info' }); return; }
  const selCount = selectedFiles().length;
  let scope = selCount ? 'selection' : 'all';
  const opts = { ...spec.defaults, ...load(`action.${id}`, {}) };

  const body = h(`
    <div class="action">
      <div class="action-side">
        <div class="seg scope">
          <label><input type="radio" name="__scope" value="selection" ${scope === 'selection' ? 'checked' : ''} ${selCount ? '' : 'disabled'}><span>Auswahl <b>${selCount}</b></span></label>
          <label><input type="radio" name="__scope" value="all" ${scope === 'all' ? 'checked' : ''}><span>Alle sichtbaren <b>${state.view.length}</b></span></label>
        </div>
        <form class="action-form" onsubmit="return false">${spec.form(opts)}</form>
      </div>
      <div class="preview">
        <div class="preview-head"><span>Vorschau</span><span class="preview-count"></span></div>
        <div class="preview-list"></div>
      </div>
    </div>`);
  const footer = h(`<div class="foot-wrap">
      <span class="foot-info"></span><div class="foot-spacer"></div>
      <button class="btn ghost" data-act="cancel">Abbrechen</button>
      <button class="btn primary" data-act="apply" disabled>${icon('check')}<span>Anwenden</span></button>
    </div>`);
  const modal = openModal({ title: spec.title, subtitle: spec.desc, iconName: spec.icon, body, footer, className: 'modal-action' });
  const form = $('.action-form', body);
  const list = $('.preview-list', body);
  const count = $('.preview-count', body);
  const info = $('.foot-info', footer);
  const applyBtn = $('[data-act=apply]', footer);
  let result = { rows: [] };
  let seq = 0;

  const update = debounce(async () => {
    const o = readForm(form);
    store(`action.${id}`, o);
    const files = scope === 'selection' ? selectedFiles() : state.view;
    const my = ++seq;
    result = await spec.compute(files, o);
    if (my !== seq) return;
    const valid = spec.kind === 'rename' ? result.rows.filter((r) => !r.conflict) : result.rows;
    const affected = spec.kind === 'cover' ? result.rows.reduce((s, r) => s + r.files.length, 0) : valid.length;

    if (result.error) list.innerHTML = `<div class="pv-empty error">${icon('alert')}<span>${esc(result.error)}</span></div>`;
    else if (!result.rows.length) list.innerHTML = `<div class="pv-empty">${icon('check')}<span>${esc(result.note || 'Keine Änderungen – alles ist bereits so.')}</span></div>`;
    else {
      list.innerHTML = spec.kind === 'rename' ? renderRenameRows(result.rows) : spec.kind === 'cover' ? renderCoverRows(result.rows) : renderTagRows(result.rows);
      if (result.rows.length > MAX_ROWS) list.insertAdjacentHTML('beforeend', `<div class="pv-more">… und ${result.rows.length - MAX_ROWS} weitere</div>`);
      if (spec.kind === 'cover') loadCoverPreviews(result.rows, list);
    }
    const conflicts = spec.kind === 'rename' ? result.rows.length - valid.length : 0;
    count.textContent = affected ? plural(affected, 'Titel', 'Titel') : '';
    info.innerHTML = [
      result.note && result.rows.length ? `<span class="note">${icon('info')}${esc(result.note)}</span>` : '',
      conflicts ? `<span class="note warn">${icon('alert')}${plural(conflicts, 'Konflikt wird', 'Konflikte werden')} übersprungen</span>` : '',
      spec.kind === 'rename' && result.unchanged ? `<span class="note">${plural(result.unchanged, 'Datei bleibt', 'Dateien bleiben')} unverändert</span>` : '',
    ].join('');
    applyBtn.disabled = affected === 0;
    applyBtn.querySelector('span').textContent = affected ? `${spec.kind === 'rename' ? 'Umbenennen' : 'Anwenden'} (${affected})` : 'Anwenden';
  }, 70);

  body.addEventListener('input', (e) => {
    if (e.target.name === '__scope') scope = e.target.value;
    update();
  });
  body.addEventListener('click', (e) => {
    const token = e.target.closest('.token');
    const preset = e.target.closest('.preset');
    if (token) {
      const target = $(`[name=${token.closest('.tokens').dataset.target}]`, form);
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      target.value = target.value.slice(0, start) + token.dataset.token + target.value.slice(end);
      target.focus();
      target.setSelectionRange(start + token.dataset.token.length, start + token.dataset.token.length);
      update();
    } else if (preset) {
      if (preset.dataset.set) {
        for (const [k, v] of Object.entries(JSON.parse(preset.dataset.set))) $(`[name=${k}]`, form).value = v;
      } else $(`[name=${preset.dataset.target}]`, form).value = preset.dataset.value;
      update();
    }
  });
  footer.querySelector('[data-act=cancel]').onclick = () => modal.close();
  applyBtn.onclick = async () => {
    applyBtn.disabled = true;
    const o = readForm(form);
    if (spec.kind === 'tags') {
      setTags(result.rows.map((r) => ({ id: r.file.id, tags: r.changes })));
      modal.close();
      toast(`${plural(result.rows.length, 'Titel', 'Titel')} geändert – noch nicht gespeichert`, { type: 'success', action: ctx.save, actionLabel: 'Speichern' });
    } else if (spec.kind === 'rename') {
      modal.close();
      await ctx.rename?.(result.rows.filter((r) => !r.conflict), { removeEmptyDirs: o.removeEmpty });
    } else if (spec.kind === 'cover') {
      let first = true;
      let n = 0;
      for (const r of result.rows) {
        const data = new Uint8Array(await (await r.pick.getBlob()).arrayBuffer());
        const info = imageInfo(data);
        if (!['image/jpeg', 'image/png'].includes(info.mime)) continue;
        setCover(r.files.map((f) => f.id), { mime: info.mime, data }, { record: first });
        first = false;
        n += r.files.length;
      }
      modal.close();
      toast(`Cover für ${plural(n, 'Titel', 'Titel')} übernommen – noch nicht gespeichert`, { type: 'success', action: ctx.save, actionLabel: 'Speichern' });
    }
  };
  update();
}

async function loadCoverPreviews(rows, list) {
  for (const r of rows) {
    const key = `${r.dir}/${r.pick.name}`;
    if (!coverPreviewUrls.has(key)) coverPreviewUrls.set(key, URL.createObjectURL(await r.pick.getBlob()));
    const img = list.querySelector(`[data-key="${CSS.escape(key)}"] img`);
    if (img && !img.src) img.src = coverPreviewUrls.get(key);
  }
}
