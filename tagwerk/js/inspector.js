// Rechte Seitenleiste: Cover, Player, Tag-Felder (Einzel- und Mehrfachbearbeitung), Dateiinfos.
import { loadCover, loadThumb, readyThumb } from './covers.js';
import { FIELDS, formatChannels, formatDuration, formatLongDuration, formatRate, formatSize, plural } from './fields.js';
import { download, getBlob } from './fs.js';
import {
  displayPath, emit, focusedFile, isDirty, isFieldDirty, on, pendingCover, revert, selectedFiles, setCover, setTags, state, value,
} from './state.js';
import { imageInfo } from './tags/bytes.js';
import { GENRES } from './tags/id3.js';
import { $, $$, esc, icon, setIcon, toast } from './ui.js';

let root;
let callbacks = {};
let editStart = false;
const audio = new Audio();
let audioUrl = null;

const field = (key, { list = false, cls = '' } = {}) => `
  <label class="field ${cls}" data-field="${key}">
    <span class="field-label"><span>${FIELDS[key].label}</span>${fieldActs()}</span>
    ${FIELDS[key].multiline
      ? `<textarea class="input" name="${key}" rows="${key === 'lyrics' ? 8 : 3}" spellcheck="false"></textarea>`
      : `<input class="input" name="${key}" autocomplete="off" spellcheck="false" ${list ? `list="dl-${key}"` : ''} ${FIELDS[key].numeric ? 'inputmode="numeric"' : ''}>`}
  </label>`;

const fieldActs = () => `<span class="field-acts">
  <button type="button" class="fa" data-act="revert" title="Änderung zurücksetzen" tabindex="-1">${icon('rotate')}</button>
  <button type="button" class="fa" data-act="clear" title="Feld leeren" tabindex="-1">${icon('x')}</button>
</span>`;

const pair = (key, totalKey, label) => `
  <div class="field pair" data-field="${key}" data-keys="${key},${totalKey}">
    <span class="field-label"><span>${label}</span>${fieldActs()}</span>
    <div class="pair-inputs">
      <input class="input" name="${key}" inputmode="numeric" autocomplete="off">
      <span class="pair-sep">/</span>
      <input class="input" name="${totalKey}" inputmode="numeric" autocomplete="off" title="Gesamt">
    </div>
  </div>`;

const TEMPLATE = `
  <div class="insp-empty">
    <div class="insp-empty-art">${icon('music')}</div>
    <h3>Nichts ausgewählt</h3>
    <p>Wähle einen oder mehrere Titel aus, um ihre Tags zu bearbeiten.</p>
    <div class="hint-list">
      <div><span class="kbd">⌘A</span><span>Alle auswählen</span></div>
      <div><span class="kbd">⇧ Klick</span><span>Bereich auswählen</span></div>
      <div><span class="kbd">⌘ Klick</span><span>Einzeln hinzufügen</span></div>
      <div><span class="kbd">⌘K</span><span>Automationen</span></div>
    </div>
  </div>
  <div class="insp-content">
    <div class="insp-scroll">
      <section class="cover-section">
        <div class="cover-ambient"><img alt=""></div>
        <div class="cover-zone" tabindex="0" title="Klicken, einfügen (⌘V) oder Bild hierher ziehen">
          <div class="cover-stack">
            <div class="cover-card c3"><img alt=""></div>
            <div class="cover-card c2"><img alt=""></div>
            <div class="cover-card c1">
              <div class="cover-ph">${icon('disc')}</div>
              <img class="cover-img" alt="">
              <div class="cover-badge"></div>
            </div>
          </div>
          <div class="cover-drop">${icon('upload')}<span>Bild ablegen</span></div>
        </div>
        <div class="cover-tools">
          <button class="chip-btn" data-cover="upload" title="Bild auswählen">${icon('upload')}<span>Bild</span></button>
          <button class="chip-btn" data-cover="folder" title="cover.jpg / folder.jpg aus dem Ordner übernehmen">${icon('folder')}<span>Aus Ordner</span></button>
          <button class="chip-btn icon" data-cover="export" title="Cover herunterladen">${icon('download')}</button>
          <button class="chip-btn icon danger" data-cover="remove" title="Cover entfernen">${icon('trash')}</button>
          <button class="chip-btn icon" data-cover="revert" title="Cover-Änderung zurücksetzen">${icon('rotate')}</button>
        </div>
        <div class="cover-meta"></div>
      </section>

      <section class="sel-head">
        <div class="sel-title"></div>
        <div class="sel-sub"></div>
        <button class="lookup-btn" title="Fehlende Tags und Cover online suchen">${icon('search')}<span>Online nachschlagen</span></button>
      </section>

      <div class="player">
        <button class="play-btn" title="Abspielen (Leertaste)">${icon('play')}</button>
        <div class="player-main">
          <div class="player-line"><span class="pl-label">Vorschau</span><span class="pl-time tabular">0:00</span></div>
          <div class="seek"><div class="seek-fill"></div><input type="range" min="0" max="1000" value="0" aria-label="Position"></div>
        </div>
      </div>

      <form class="fields" autocomplete="off" onsubmit="return false">
        ${field('title')}
        ${field('artist', { list: true })}
        ${field('album', { list: true })}
        ${field('albumartist', { list: true })}
        <div class="field-row three">
          ${pair('track', 'tracktotal', 'Track')}
          ${pair('disc', 'disctotal', 'Disc')}
          ${field('year', { list: true })}
        </div>
        <div class="field-row two">
          ${field('genre', { list: true })}
          ${field('bpm')}
        </div>
        ${field('composer', { list: true })}
        ${field('comment')}
        <details class="more">
          <summary>${icon('chevronRight')}<span>Liedtext</span><span class="more-dot"></span></summary>
          ${field('lyrics')}
        </details>
      </form>

      <section class="file-info"></section>
    </div>
    <footer class="insp-foot">
      <button class="btn ghost" data-foot="revert">${icon('rotate')}<span>Verwerfen</span></button>
      <button class="btn primary" data-foot="save">${icon('save')}<span>Auswahl speichern</span></button>
    </footer>
  </div>
  <input type="file" accept="image/*" class="cover-input" hidden>
  <div class="datalists"></div>`;

export function initInspector(cbs) {
  callbacks = cbs;
  root = document.getElementById('inspector');
  root.innerHTML = TEMPLATE;
  root.classList.add('is-empty');

  const form = $('.fields', root);
  form.addEventListener('focusin', (e) => { if (e.target.matches('.input')) editStart = true; });
  form.addEventListener('input', onInput);
  form.addEventListener('keydown', onKeyDown);
  form.addEventListener('click', onFieldAction);

  // Cover
  const zone = $('.cover-zone', root);
  const fileInput = $('.cover-input', root);
  zone.addEventListener('click', () => fileInput.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) await applyImageFile(file);
  });
  zone.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) return;
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', async (e) => {
    const img = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    zone.classList.remove('dragging');
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    await applyImageFile(img);
  });
  $('.cover-tools', root).addEventListener('click', onCoverTool);

  // Player
  $('.play-btn', root).addEventListener('click', togglePlay);
  const seek = $('.seek input', root);
  seek.addEventListener('input', () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; });
  audio.addEventListener('timeupdate', updatePlayer);
  audio.addEventListener('play', updatePlayer);
  audio.addEventListener('pause', updatePlayer);
  audio.addEventListener('ended', () => { state.playing = null; emit('playing'); updatePlayer(); });
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    toast('Dieses Format kann dein Browser nicht abspielen.', { type: 'warning' });
    state.playing = null;
    emit('playing');
    updatePlayer();
  });

  $('.lookup-btn', root).addEventListener('click', () => callbacks.lookup?.());

  // Fußleiste
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-foot]');
    if (!btn) return;
    const ids = selectedFiles().map((f) => f.id);
    if (btn.dataset.foot === 'revert') revert(ids);
    else callbacks.save?.(ids);
  });

  on('selection', render);
  on('pending', render);
  on('files', () => { buildDatalists(); render(); });
  on('saved', () => { buildDatalists(); render(); });
  on('focus-field', focusField);
}

/* ---------------------------------------------------------------- Felder */

function onInput(e) {
  const input = e.target;
  const key = input.name;
  if (!key) return;
  let v = input.value;
  if (FIELDS[key].numeric) {
    const cleaned = v.replace(key === 'track' || key === 'disc' ? /[^\d/]/g : /[^\d.]/g, '');
    if (cleaned !== v) { v = cleaned; input.value = v; }
  }
  let tags = { [key]: v };
  if ((key === 'track' || key === 'disc') && v.includes('/')) {
    const [n, t] = v.split('/');
    tags = { [key]: n.trim(), [`${key}total`]: t.trim() };
    input.value = n.trim();
    const totalInput = $(`[name=${key}total]`, root);
    totalInput.value = t.trim();
    if (!t) totalInput.focus();
  }
  const ids = selectedFiles().map((f) => f.id);
  setTags(ids.map((id) => ({ id, tags })), { record: editStart });
  editStart = false;
}

function onKeyDown(e) {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const inputs = $$('.fields .input', root).filter((i) => i.offsetParent);
    inputs[inputs.indexOf(e.target) + (e.shiftKey ? -1 : 1)]?.focus();
  } else if (e.key === 'Escape') {
    e.target.blur();
    document.getElementById('table-body').focus({ preventScroll: true });
  }
}

function onFieldAction(e) {
  const btn = e.target.closest('.fa');
  if (!btn) return;
  e.preventDefault();
  const fieldEl = btn.closest('.field');
  const keys = fieldEl.dataset.keys?.split(',') ?? [fieldEl.dataset.field];
  const ids = selectedFiles().map((f) => f.id);
  if (btn.dataset.act === 'revert') revert(ids, { fields: keys });
  else setTags(ids.map((id) => ({ id, tags: Object.fromEntries(keys.map((k) => [k, ''])) })));
}

function focusField(key) {
  const input = $(`[name=${key}]`, root);
  if (!input || root.classList.contains('is-empty')) return;
  if (key === 'lyrics') $('.more', root).open = true;
  input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  input.focus();
  input.select?.();
  const f = input.closest('.field');
  f.classList.remove('flash');
  void f.offsetWidth;
  f.classList.add('flash');
}

export function focusFirstField() {
  focusField('title');
}

function buildDatalists() {
  const keys = ['artist', 'album', 'albumartist', 'year', 'genre', 'composer'];
  const html = keys.map((k) => {
    const set = new Set();
    for (const f of state.files) { const v = value(f, k); if (v) set.add(v); }
    if (k === 'genre') GENRES.forEach((g) => set.add(g));
    const values = [...set].sort((a, b) => a.localeCompare(b, 'de')).slice(0, 800);
    return `<datalist id="dl-${k}">${values.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
  }).join('');
  $('.datalists', root).innerHTML = html;
}

/* ---------------------------------------------------------------- Render */

function render() {
  const files = selectedFiles();
  root.classList.toggle('is-empty', files.length === 0);
  if (!files.length) return;
  const multi = files.length > 1;
  root.classList.toggle('is-multi', multi);

  for (const input of $$('.fields .input', root)) {
    const key = input.name;
    const values = new Set(files.map((f) => value(f, key)));
    const mixed = values.size > 1;
    if (document.activeElement !== input) input.value = mixed ? '' : [...values][0];
    input.placeholder = mixed ? 'Verschiedene' : '';
    input.classList.toggle('mixed', mixed);
  }
  for (const fieldEl of $$('.fields .field', root)) {
    const keys = fieldEl.dataset.keys?.split(',') ?? [fieldEl.dataset.field];
    const dirty = files.some((f) => keys.some((k) => isFieldDirty(f, k)));
    const hasValue = files.some((f) => keys.some((k) => value(f, k)));
    fieldEl.classList.toggle('dirty', dirty);
    fieldEl.classList.toggle('has-value', hasValue);
  }
  $('.more-dot', root).classList.toggle('on', files.some((f) => value(f, 'lyrics')));

  renderHeader(files);
  renderCover(files);
  renderInfo(files);
  updatePlayer();
  root.querySelector('.insp-foot').classList.toggle('show', files.some(isDirty));
}

function renderHeader(files) {
  const title = $('.sel-title', root);
  const sub = $('.sel-sub', root);
  if (files.length === 1) {
    const f = files[0];
    title.textContent = value(f, 'title') || f.name.replace(/\.[^.]+$/, '');
    sub.textContent = [value(f, 'artist'), value(f, 'album')].filter(Boolean).join(' — ') || 'Keine Angaben';
  } else {
    title.textContent = plural(files.length, 'Titel ausgewählt', 'Titel ausgewählt');
    const albums = new Set(files.map((f) => value(f, 'album')).filter(Boolean));
    const duration = files.reduce((s, f) => s + (f.info?.duration || 0), 0);
    sub.textContent = [albums.size ? plural(albums.size, 'Album', 'Alben') : null, formatLongDuration(duration)].filter(Boolean).join(' · ');
  }
}

function hueOf(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

let coverToken = 0;
function renderCover(files) {
  const focus = files.includes(focusedFile()) ? focusedFile() : files[0];
  const token = ++coverToken;
  const card = $('.cover-card.c1', root);
  const img = $('.cover-img', root);
  const ambient = $('.cover-ambient img', root);
  const meta = $('.cover-meta', root);
  const stack = $('.cover-stack', root);
  const hue = hueOf(value(focus, 'album') || value(focus, 'artist') || focus.name);
  card.style.setProperty('--ph-hue', hue);

  stack.classList.toggle('stacked', files.length > 1);
  $('.cover-badge', root).textContent = files.length > 1 ? `${files.length}` : '';
  const others = files.filter((f) => f !== focus).slice(0, 2);
  $$('.cover-card.c2 img, .cover-card.c3 img', root).forEach((el, i) => {
    const f = others[i];
    el.removeAttribute('src');
    el.parentElement.style.setProperty('--ph-hue', f ? hueOf(value(f, 'album') || f.name) : hue + 40);
    if (!f) return;
    const pc = pendingCover(f);
    if (pc) el.src = pc.url;
    else if (pc !== null && f.hasCover) loadThumb(f).then((url) => { if (token === coverToken && url) el.src = url; });
  });

  const show = (url, text) => {
    if (token !== coverToken) return;
    if (url) { img.src = url; ambient.src = url; } else { img.removeAttribute('src'); ambient.removeAttribute('src'); }
    card.classList.toggle('has-img', !!url);
    root.classList.toggle('has-cover', !!url);
    meta.innerHTML = text;
  };
  const pc = pendingCover(focus);
  const anyPending = files.some((f) => pendingCover(f) !== undefined);
  $('[data-cover=revert]', root).hidden = !anyPending;
  $('[data-cover=export]', root).hidden = !(pc || (pc === undefined && focus.hasCover));
  $('[data-cover=remove]', root).hidden = !files.some((f) => (pendingCover(f) === undefined ? f.hasCover : pendingCover(f) !== null));
  $('[data-cover=folder]', root).hidden = !files.some((f) => state.source?.images?.has(f.dir));

  if (pc === null) return show(null, `<span class="dirty-text">${icon('trash')} Cover wird entfernt</span>`);
  if (pc) {
    const info = imageInfo(pc.data);
    return show(pc.url, `<span class="dirty-text">${icon('sparkles')} Neues Cover · ${info.width}×${info.height} · ${formatSize(pc.data.length)}</span>`);
  }
  if (!focus.hasCover) return show(null, files.length > 1 ? '' : '<span>Kein Cover</span>');
  const quick = readyThumb(focus);
  if (quick && !img.src) show(quick, meta.innerHTML);
  loadCover(focus).then((c) => {
    if (!c) return show(null, '<span>Cover nicht lesbar</span>');
    const info = imageInfo(c.data);
    show(c.url, `<span>${info.width}×${info.height} · ${info.mime.split('/')[1].toUpperCase()} · ${formatSize(c.data.length)}</span>`);
  });
}

function renderInfo(files) {
  const el = $('.file-info', root);
  if (files.length === 1) {
    const f = files[0];
    const i = f.info ?? {};
    const quality = [i.bitrate ? `${i.bitrate} kbps` : '', formatRate(i.sampleRate), i.bitsPerSample ? `${i.bitsPerSample} Bit` : '', formatChannels(i.channels)].filter(Boolean).join(' · ');
    el.innerHTML = `
      <div class="info-title">Datei</div>
      <div class="info-grid">
        <span>Format</span><b>${esc(f.format)}${i.codec && i.codec !== f.format ? ` · ${esc(i.codec)}` : ''}</b>
        <span>Qualität</span><b>${esc(quality || '–')}</b>
        <span>Dauer</span><b>${formatDuration(i.duration)} · ${formatSize(f.size)}</b>
        <span>Tags</span><b>${esc(f.tagType || '–')}</b>
        <span>Pfad</span><b class="mono" title="${esc(displayPath(f))}">${esc(displayPath(f))}</b>
        ${f.error ? `<span>Fehler</span><b class="err">${esc(f.error)}</b>` : ''}
      </div>`;
  } else {
    const formats = {};
    let size = 0;
    for (const f of files) { formats[f.format] = (formats[f.format] ?? 0) + 1; size += f.size; }
    el.innerHTML = `
      <div class="info-title">Auswahl</div>
      <div class="info-grid">
        <span>Formate</span><b>${Object.entries(formats).map(([k, n]) => `${n}× ${esc(k)}`).join(', ')}</b>
        <span>Größe</span><b>${formatSize(size)}</b>
        <span>Geändert</span><b>${files.filter(isDirty).length} von ${files.length}</b>
      </div>`;
  }
}

/* ----------------------------------------------------------------- Cover */

async function applyImageFile(file) {
  if (!file.type.startsWith('image/')) return toast('Bitte eine Bilddatei wählen.', { type: 'warning' });
  const data = new Uint8Array(await file.arrayBuffer());
  const info = imageInfo(data);
  if (!['image/jpeg', 'image/png'].includes(info.mime)) {
    toast('Bitte JPEG oder PNG verwenden – andere Formate unterstützen viele Player nicht.', { type: 'warning' });
    return;
  }
  const ids = selectedFiles().map((f) => f.id);
  setCover(ids, { mime: info.mime, data });
  toast(`Cover für ${plural(ids.length, 'Titel', 'Titel')} gesetzt`, { type: 'success', duration: 2200 });
}

export async function pasteImage(clipboardData) {
  const item = [...clipboardData.items].find((i) => i.type.startsWith('image/'));
  if (!item || !selectedFiles().length) return false;
  await applyImageFile(item.getAsFile());
  return true;
}

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall', 'artwork'];
export function pickFolderImage(images) {
  if (!images?.length) return null;
  const rank = (img) => {
    const base = img.name.toLowerCase().replace(/\.[^.]+$/, '');
    const i = COVER_NAMES.indexOf(base);
    return i >= 0 ? i : COVER_NAMES.some((n) => base.includes(n)) ? 20 : 50;
  };
  return [...images].sort((a, b) => rank(a) - rank(b))[0];
}

export async function coverFromFolder(files, { onlyMissing = false } = {}) {
  const byDir = new Map();
  for (const f of files) {
    if (onlyMissing && (pendingCover(f) ?? (f.hasCover || null))) continue;
    if (!byDir.has(f.dir)) byDir.set(f.dir, []);
    byDir.get(f.dir).push(f);
  }
  let count = 0;
  let first = true;
  for (const [dir, list] of byDir) {
    const pick = pickFolderImage(state.source?.images?.get(dir));
    if (!pick) continue;
    const data = new Uint8Array(await (await pick.getBlob()).arrayBuffer());
    const info = imageInfo(data);
    if (!['image/jpeg', 'image/png'].includes(info.mime)) continue;
    setCover(list.map((f) => f.id), { mime: info.mime, data }, { record: first });
    first = false;
    count += list.length;
  }
  return count;
}

async function onCoverTool(e) {
  const btn = e.target.closest('[data-cover]');
  if (!btn) return;
  const files = selectedFiles();
  const ids = files.map((f) => f.id);
  switch (btn.dataset.cover) {
    case 'upload': $('.cover-input', root).click(); break;
    case 'remove': setCover(ids, null); break;
    case 'revert': revert(ids, { cover: true }); break;
    case 'folder': {
      const n = await coverFromFolder(files);
      toast(n ? `Ordner-Cover für ${plural(n, 'Titel', 'Titel')} übernommen` : 'Kein passendes Bild (JPEG/PNG) im Ordner gefunden', { type: n ? 'success' : 'warning' });
      break;
    }
    case 'export': {
      const f = files.includes(focusedFile()) ? focusedFile() : files[0];
      const pc = pendingCover(f);
      const c = pc ?? (await loadCover(f));
      if (!c) return;
      const ext = c.mime === 'image/png' ? 'png' : 'jpg';
      const base = (value(f, 'album') || value(f, 'title') || 'cover').replace(/[\\/:*?"<>|]/g, '-');
      download(new Blob([c.data], { type: c.mime }), `${base}.${ext}`);
      break;
    }
  }
}

/* ---------------------------------------------------------------- Player */

export async function togglePlay() {
  const files = selectedFiles();
  const target = files.includes(focusedFile()) ? focusedFile() : files[0];
  if (!target) return;
  if (state.playing === target.id) {
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    return;
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(await getBlob(target));
  audio.src = audioUrl;
  state.playing = target.id;
  emit('playing');
  audio.play().catch(() => {});
}

export function stopPlayback() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.playing = null;
  emit('playing');
}

function updatePlayer() {
  if (!root) return;
  const files = selectedFiles();
  const target = files.includes(focusedFile()) ? focusedFile() : files[0];
  const active = target && state.playing === target.id;
  const playing = active && !audio.paused;
  const btn = $('.play-btn', root);
  setIcon(btn, playing ? 'pause' : 'play');
  btn.classList.toggle('playing', playing);
  root.querySelector('.player').classList.toggle('active', !!active);
  const dur = active && audio.duration ? audio.duration : target?.info?.duration ?? 0;
  const cur = active ? audio.currentTime : 0;
  const clock = (sec) => (sec >= 1 ? formatDuration(sec) : '0:00');
  $('.pl-time', root).textContent = active ? `${clock(cur)} / ${clock(dur)}` : clock(dur);
  $('.pl-label', root).textContent = active ? (playing ? 'Wird abgespielt' : 'Pausiert') : 'Vorschau';
  const pct = dur ? (cur / dur) * 100 : 0;
  $('.seek-fill', root).style.width = `${pct}%`;
  if (document.activeElement !== $('.seek input', root)) $('.seek input', root).value = Math.round(pct * 10);
}

