// Formwerk – Einstieg: verbindet Editor, Baukasten, OpenSCAD-Runner, 3D-Ansicht und Customizer.

import { $, $$, h, esc, icon, setIcon, hydrateIcons, toast, openModal, closeTopModal, modalOpen, confirmDialog, menu, closeMenu,
  debounce, load, store, downloadBlob, formatNumber, formatMs, modKey, MOD, isMac } from './ui.js';
import { Runner } from './runner.js';
import { Viewer } from './viewer.js';
import { Editor } from './editor.js';
import { Customizer } from './customizer.js';
import { parseLog, summarize } from './logparse.js';
import { EXAMPLES } from './examples.js';
import { fontsFor } from './fonts.js';
import { resolveLibraries, usedLibraries, LIBRARIES } from './libraries.js';
import { shareUrl, readHashToken, decodeProject } from './share.js';
import { listFiles, putFile, deleteFile } from './store.js';
import { OPENSCAD_VERSION } from '../vendor/openscad/version.js';
import { createAppleUI, isApple } from './apple.js';
import { ViewCube } from './viewcube.js';

const APP_URL = new URL('..', import.meta.url);
const mq = matchMedia('(max-width: 860px)');
const abs = (rel) => new URL(rel, APP_URL).href;

/* ------------------------------------------------------------- Zustand */

const DEFAULTS = {
  ui: 'apple', theme: 'dark', accent: 'violet', appleAccent: 'blue', sidebarOpen: true, sidebarW: 36, auto: true, delay: 450, fontSize: 13.5, modelColor: 'theme',
  viewer: { grid: true, axes: true, edges: true, wireframe: false, ortho: false },
  paramsOpen: true, consoleOpen: true, consoleH: 170, editorW: 44, autocomplete: true, wrap: false, stats: false,
};
const settings = { ...DEFAULTS, ...load('settings', {}) };
// Apple ist Standard – eine früher nur mitgespeicherte „Glas“-Einstellung gilt erst, wenn sie bewusst gewählt wurde
if (!settings.uiChosen) settings.ui = 'apple';
settings.viewer = { ...DEFAULTS.viewer, ...(settings.viewer ?? {}) };
const saveSettings = () => store('settings', settings);

const DEFAULT_DOC = () => ({ mode: 'code', name: 'Box mit Deckel', code: EXAMPLES[0].code, blocks: null, values: { code: {}, blocks: {} } });
let doc = { ...DEFAULT_DOC(), ...load('doc', {}) };
doc.values ??= { code: {}, blocks: {} };
let savedCode = load('savedCode', doc.code);
const saveDoc = debounce(() => { store('doc', doc); store('savedCode', savedCode); }, 300);

let fileHandle = null;            // File System Access (Chromium)
let blockEditor = null;
let blocksReady = null;
let generated = '';               // Code aus dem Baukasten
let lastParamSource = null;
let lastResult = null;            // { dim, mesh, off, svg, source, defines }
let renderSeq = 0;
let attachments = new Map();      // Name → Uint8Array
let librariesInUse = [];

/* ---------------------------------------------------------- Elemente */

const els = {
  workspace: $('#workspace'), editorPane: $('#editor-pane'), viewerPane: $('#viewer-pane'),
  codeHost: $('#code-host'), blocksWrap: $('#blocks-wrap'), blocksHost: $('#blocks-host'), blocksLoading: $('#blocks-loading'),
  blocksCode: $('#blocks-code'), blocksCodeBody: $('#blocks-code-body'),
  console: $('#console'), log: $('#console-log'), files: $('#console-files'),
  badgeErr: $('#badge-err'), badgeWarn: $('#badge-warn'), badgeFiles: $('#badge-files'),
  status: $('#status'), statusText: $('#status-text'), statusTris: $('#status-tris'), statusDot1: $('#status-dot1'),
  hud: $('#hud'), hudDims: $('#hud-dims'), viewerState: $('#viewer-state'),
  renderChip: $('#render-chip'), renderChipText: $('#render-chip-text'),
  boot: $('#boot'), bootBar: $('#boot-bar'), bootSub: $('#boot-sub'),
  paramsBody: $('#params-body'), paramsCount: $('#params-count'),
  fileName: $('#file-name'), fileDirty: $('#file-dirty'),
};

/* -------------------------------------------------------- Bausteine */

const runner = new Runner();
const viewer = new Viewer($('#viewer-host'));
for (const [k, v] of Object.entries(settings.viewer)) viewer.opts[k] = v;
viewer.opts.color = settings.modelColor;
viewer.setOption('grid', settings.viewer.grid);
viewer.setOption('axes', settings.viewer.axes);
if (settings.viewer.ortho) viewer.setOption('ortho', true);

const editor = new Editor(els.codeHost, {
  onChange: (text) => {
    doc.code = text;
    saveDoc();
    updateFileState();
    if (doc.mode === 'code' && settings.auto) scheduleRender();
  },
  onRun: () => renderNow(),
  onSave: () => saveFile(),
  onScrub: (active) => { if (active && doc.mode === 'code') liveRender(); },
});
editor.autoComplete = settings.autocomplete;
editor.setFontSize(settings.fontSize);
editor.setWrap(settings.wrap);
editor.setValue(doc.code);

const customizer = new Customizer(els.paramsBody);
customizer.addEventListener('params', ({ detail }) => {
  els.paramsCount.hidden = !detail.count;
  els.paramsCount.textContent = detail.count;
  els.viewerPane.classList.toggle('params-empty', !detail.count && !isMobile());
  updateViewerInsets();
});
customizer.addEventListener('change', ({ detail }) => {
  doc.values[doc.mode] = { ...detail.values };
  saveDoc();
  if (detail.render) {
    if (detail.live) liveRender(); else renderNow();
  }
});
customizer.setValues(doc.values[doc.mode]);

const appleUI = createAppleUI({
  viewer,
  viewerPane: els.viewerPane,
  editorPane: els.editorPane,
  paramsPanel: $('#params-panel'),
  splitter: $('#splitter-v'),
  isMobile: () => mq.matches,
  paramsVisible: () => customizer.count > 0 && (isMobile() || settings.paramsOpen),
  onSidebar: () => { editor.refresh(); blockEditor?.resize(); },
});
$('#btn-sidebar').onclick = () => {
  settings.sidebarOpen = !appleUI.sidebarOpen;
  saveSettings();
  appleUI.setSidebar(settings.sidebarOpen);
};

/* ------------------------------------------------------------ Rendern */

const currentSource = () => (doc.mode === 'blocks' ? generated : doc.code);

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render({ reason: 'auto' }), settings.delay);
}
scheduleRender.cancel = () => clearTimeout(renderTimer);
const liveRender = debounce(() => render({ reason: 'live' }), 70);

function renderNow() {
  scheduleRender.cancel();
  render({ reason: 'manual' });
}

async function render({ reason = 'manual', fit = false } = {}) {
  if (!runner.module) return; // wird nach dem Laden nachgeholt
  const seq = ++renderSeq;
  const source = currentSource();
  const files = {};
  for (const [name, data] of attachments) files[`/${name}`] = data;

  // Bibliotheken bei Bedarf holen
  const libs = usedLibraries(source);
  const notes = [];
  if (libs.length) {
    setBusy(true, `Lade ${libs.join(', ')} …`);
    try {
      const res = await resolveLibraries(source, {
        onProgress: ({ done }) => { if (seq === renderSeq) setBusy(true, `Lade ${libs.join(', ')} … ${done} Dateien`); },
      });
      Object.assign(files, res.files);
      for (const m of res.missing) notes.push({ level: 'warning', text: `Bibliotheksdatei nicht gefunden: ${m}` });
      if (!librariesInUse.length || librariesInUse.join() !== libs.join()) {
        notes.push({ level: 'info2', text: `${libs.join(', ')} geladen (${Object.keys(res.files).length} Dateien, von jsDelivr)` });
      }
    } catch (e) {
      notes.push({ level: 'error', text: `Bibliothek konnte nicht geladen werden (offline?): ${e.message}` });
    }
    if (seq !== renderSeq) return;
  }
  librariesInUse = libs;
  renderFiles();

  const job = {
    source,
    defines: customizer.defines(),
    files,
    fonts: fontsFor(source).map(abs),
    params: source !== lastParamSource,
  };
  setBusy(true, 'Rendere …');
  const preempt = reason === 'live' ? 250 : reason === 'auto' ? 900 : 0;
  const t0 = performance.now();
  const res = await runner.request(job, { preempt });
  if (res.superseded) return;
  if (res.cancelled) {
    if (!runner.busy) setBusy(false);
    setStatus('warn', 'Abgebrochen');
    return;
  }
  if (!runner.busy) setBusy(false);
  handleResult(res, { job, notes, fit, elapsed: performance.now() - t0 });
}

function handleResult(res, { job, notes, fit, elapsed }) {
  const messages = [...notes, ...parseLog(res.logs ?? [])];
  if (res.crashed && !messages.some((m) => m.level === 'error')) messages.push({ level: 'error', text: 'OpenSCAD ist abgestürzt (zu wenig Speicher?).' });
  const sum = summarize(messages);

  // Bei Syntaxfehlern liefert OpenSCAD keine Parameter – dann die alten behalten
  if (job.params && (res.params || res.ok)) {
    lastParamSource = job.source;
    customizer.setParams(res.params);
  }

  if (doc.mode === 'code') editor.setDiagnostics(messages); else editor.clearDiagnostics();
  renderLog(messages, { ms: res.ms ?? elapsed, ok: res.ok });

  if (res.ok && res.dim === 3) {
    viewer.setMesh(res.mesh, { fit });
    lastResult = { dim: 3, mesh: res.mesh, off: res.off, source: job.source, defines: job.defines, files: job.files, fonts: job.fonts };
  } else if (res.ok && res.dim === 2) {
    viewer.setSVG(res.svg, { fit: fit || viewer.dim !== 2 });
    lastResult = { dim: 2, svg: res.svg, source: job.source, defines: job.defines, files: job.files, fonts: job.fonts };
  }

  const empty = !res.ok && messages.some((m) => /Modell ist leer/.test(m.text)) && !sum.error;
  els.viewerPane.classList.toggle('stale', !res.ok && !!viewer.model);
  if (!res.ok) {
    const first = messages.find((m) => m.level === 'error') ?? messages.find((m) => m.level === 'warning');
    showViewerState(empty ? 'empty' : 'error', {
      title: empty ? 'Nichts zu sehen' : 'Fehler beim Rendern',
      text: empty ? 'Das Modell erzeugt keine Geometrie.' : (first ? `${first.text}${first.line ? ` (Zeile ${first.line})` : ''}` : 'Details in der Konsole'),
      corner: !!viewer.model && !empty,
    });
    if (empty) { viewer.clearModel(); lastResult = null; updateHud(); }
    setStatus(empty ? 'warn' : 'error', empty ? 'Leeres Modell' : 'Fehler – siehe Konsole');
    if (!empty && settings.consoleOpen === false) toggleConsole(true);
  } else {
    showViewerState(null);
    const parts = [`Fertig in ${formatMs(res.ms ?? elapsed)}`];
    if (sum.warning) parts.push(`${sum.warning} Warnung${sum.warning > 1 ? 'en' : ''}`);
    setStatus(sum.warning ? 'warn' : 'ok', parts.join(' · '));
    updateHud();
  }
}

function setBusy(busy, text) {
  document.body.classList.toggle('is-rendering', busy);
  els.renderChip.hidden = !busy;
  if (busy) {
    els.renderChipText.textContent = text ?? 'Rendere …';
    setStatus('busy', text ?? 'Rendere …');
  }
}

let lastStatus = { kind: '', text: '' };
function setStatus(kind, text) {
  lastStatus = { kind, text };
  els.status.className = `status ${kind}`;
  els.statusText.textContent = text;
  paintSubtitle();
}
// Apple: Status und Maße unter dem Titel (wie die Aktivitätsanzeige in Xcode)
function paintSubtitle() {
  const sub = $('#file-sub');
  const s = viewer.getSize();
  const f = (n) => formatNumber(n, 1);
  const dims = lastResult && s && (lastStatus.kind === 'ok' || lastStatus.kind === 'warn')
    ? (lastResult.dim === 2 ? `${f(s.x)} × ${f(s.y)} mm` : `${f(s.x)} × ${f(s.y)} × ${f(s.z)} mm`) : '';
  sub.className = `file-sub ${lastStatus.kind}`;
  sub.textContent = dims ? `${lastStatus.text} · ${dims}` : lastStatus.text;
}

function showViewerState(kind, { title, text, corner } = {}) {
  const el = els.viewerState;
  if (!kind) { el.hidden = true; return; }
  el.className = `viewer-state ${kind} ${corner ? 'corner' : ''}`;
  el.innerHTML = `<div class="vs-ico">${icon(kind === 'error' ? 'alertCircle' : 'box')}</div><div><div class="vs-title">${esc(corner ? 'Fehler – zeige letzten Stand' : title)}</div><div class="vs-text">${esc(text)}</div></div>`;
  el.hidden = false;
  el.onclick = corner ? () => toggleConsole(true) : null;
}

function updateHud() {
  const s = viewer.getSize();
  if (!s || !lastResult) { els.hud.hidden = true; els.statusTris.textContent = ''; els.statusDot1.hidden = true; return; }
  const f = (n) => formatNumber(n, 2);
  els.hudDims.innerHTML = lastResult.dim === 2
    ? `<b>${f(s.x)}</b><i>×</i><b>${f(s.y)}</b> mm <i>· 2D</i>`
    : `<b>${f(s.x)}</b><i>×</i><b>${f(s.y)}</b><i>×</i><b>${f(s.z)}</b> mm`;
  els.hud.hidden = false;
  els.statusTris.textContent = lastResult.dim === 3 ? `${formatNumber(lastResult.mesh.triangles, 0)} Dreiecke` : '2D-Modell';
  els.statusDot1.hidden = false;
  paintSubtitle();
}

/* ------------------------------------------------------------- Konsole */

let lastMessages = [];
function renderLog(messages, { ms, ok } = {}) {
  lastMessages = messages;
  const sum = summarize(messages);
  els.badgeErr.hidden = !sum.error;
  els.badgeErr.textContent = sum.error;
  els.badgeWarn.hidden = !sum.warning;
  els.badgeWarn.textContent = sum.warning;

  const box = els.log;
  box.innerHTML = '';
  const time = new Date().toLocaleTimeString('de-DE');
  box.appendChild(h(`<div class="log-run">${esc(time)} · ${ok ? 'gerendert' : 'fehlgeschlagen'}${ms ? ` · ${esc(formatMs(ms))}` : ''}</div>`));
  const iconFor = { echo: 'chevronRight', warning: 'alert', error: 'alertCircle', trace: 'chevronRight', stat: 'info', info: 'info', info2: 'package' };
  let shown = 0;
  for (const m of messages) {
    if (m.level === 'stat' && !settings.stats) continue;
    const row = h(`<div class="log ${m.level}">${icon(iconFor[m.level] ?? 'info')}<span class="log-text"></span></div>`);
    row.querySelector('.log-text').textContent = m.text;
    if (m.original) row.title = `OpenSCAD: ${m.original}`;
    if (m.line) {
      const loc = m.file ? `${m.file.split('/').pop()}:${m.line}` : `Zeile ${m.line}`;
      const btn = h(`<button class="log-loc" title="Zur Stelle springen">${esc(loc)}</button>`);
      if (m.file) btn.disabled = true;
      else btn.onclick = () => jumpToLine(m.line);
      row.appendChild(btn);
    }
    box.appendChild(row);
    shown++;
  }
  if (!shown) box.appendChild(h(`<div class="log ok">${icon('check')}<span class="log-text">Keine Meldungen</span></div>`));
}

function jumpToLine(line) {
  if (doc.mode === 'code') {
    if (isMobile()) setMobileTab('editor');
    editor.jumpTo(line);
  } else {
    showBlocksCode(true, line);
  }
}

function toggleConsole(open = !settings.consoleOpen) {
  settings.consoleOpen = open;
  els.console.classList.toggle('collapsed', !open);
  saveSettings();
  requestAnimationFrame(() => { editor.refresh(); blockEditor?.resize(); });
}

$$('.console-tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.console-tab').forEach((t) => t.classList.toggle('active', t === tab));
  els.log.hidden = tab.dataset.ctab !== 'log';
  els.files.hidden = tab.dataset.ctab !== 'files';
  if (!settings.consoleOpen) toggleConsole(true);
}));
$('#btn-console-clear').onclick = () => { els.log.innerHTML = '<div class="console-empty">Konsole geleert.</div>'; };
$('#btn-console-toggle').onclick = () => toggleConsole();
$('#show-stats').checked = settings.stats;
$('#show-stats').onchange = (e) => { settings.stats = e.target.checked; saveSettings(); renderLog(lastMessages); };

/* ------------------------------------------------------ Eigene Dateien */

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

function renderFiles() {
  const box = els.files;
  box.innerHTML = '';
  box.appendChild(h('<div class="files-section">Eigene Dateien</div>'));
  if (!attachments.size) {
    box.appendChild(h('<div class="files-hint">Ziehe STL-, SVG-, DXF- oder PNG-Dateien hierher, um sie mit <code>import("name.stl")</code> oder <code>surface("bild.png")</code> zu verwenden. Sie bleiben in diesem Browser gespeichert.</div>'));
  }
  for (const [name, data] of attachments) {
    const fn = /\.(png|dat)$/i.test(name) ? `surface(file = "${name}", center = true);` : `import("${name}");`;
    const row = h(`<div class="file-row">${icon('file')}<span class="fname">${esc(name)}</span><span class="fsize">${formatSize(data.length)}</span>
      <button class="btn small ghost" data-act="insert" title="${esc(fn)} einfügen">${icon('plus')}<span>Einfügen</span></button>
      <button class="btn small icon ghost" data-act="del" title="Entfernen">${icon('trash')}</button></div>`);
    row.querySelector('[data-act=insert]').onclick = () => insertSnippet(fn);
    row.querySelector('[data-act=del]').onclick = async () => {
      attachments.delete(name);
      await deleteFile(name);
      renderFiles();
      scheduleRender();
    };
    box.appendChild(row);
  }
  const acts = h(`<div class="files-actions"><button class="btn small">${icon('upload')}<span>Datei hinzufügen</span></button></div>`);
  acts.querySelector('button').onclick = () => $('#attach-input').click();
  box.appendChild(acts);

  box.appendChild(h('<div class="files-section">Bibliotheken</div>'));
  for (const [name, lib] of Object.entries(LIBRARIES)) {
    const active = librariesInUse.includes(name);
    const row = h(`<div class="file-row lib-row">${icon('package')}<span class="fname">${esc(name)}</span><span class="lib-state">${active ? 'geladen' : ''}</span>
      <button class="btn small ghost" title="${esc(lib.example)} einfügen">${icon('plus')}<span>Einbinden</span></button>
      <a class="btn small icon ghost" href="${esc(lib.home)}" target="_blank" rel="noopener" title="Dokumentation">${icon('external')}</a></div>`);
    row.querySelector('button').onclick = () => insertSnippet(lib.example, true);
    box.appendChild(row);
  }
  box.appendChild(h('<div class="files-hint">Bibliotheken werden automatisch geladen, sobald der Code sie mit <code>include</code> oder <code>use</code> einbindet.</div>'));
  els.badgeFiles.hidden = !attachments.size;
  els.badgeFiles.textContent = attachments.size;
}

function insertSnippet(text, top = false) {
  if (doc.mode !== 'code') { toast('Im Baukasten bitte den Block „Code“ aus „Extras“ verwenden.', { type: 'info' }); return; }
  const cm = editor.cm;
  if (top) cm.replaceRange(`${text}\n`, { line: 0, ch: 0 });
  else {
    const cur = cm.getCursor();
    const line = cm.getLine(cur.line);
    cm.replaceRange(line.trim() ? `\n${text}` : text, { line: cur.line, ch: line.length });
  }
  if (isMobile()) setMobileTab('editor');
  editor.focus();
}

async function addAttachments(fileList) {
  const added = [];
  for (const file of fileList) {
    const name = file.name.replace(/[^\w.\-]+/g, '_');
    const data = new Uint8Array(await file.arrayBuffer());
    attachments.set(name, data);
    await putFile(name, data);
    added.push(name);
  }
  renderFiles();
  if (added.length) {
    const n = added[0];
    const fn = /\.(png|dat)$/i.test(n) ? `surface(file = "${n}", center = true);` : `import("${n}");`;
    toast(added.length === 1 ? `„${n}“ hinzugefügt` : `${added.length} Dateien hinzugefügt`, {
      type: 'success', detail: 'Verwende sie im Code mit import() oder surface().', action: () => insertSnippet(fn), actionLabel: 'Einfügen',
    });
    scheduleRender();
  }
}
$('#attach-input').onchange = (e) => { addAttachments([...e.target.files]); e.target.value = ''; };

/* ------------------------------------------------------- Code/Baukasten */

const modeSwitch = $('#mode-switch');
let gliderPlaced = false;
function placeGlider() {
  const active = modeSwitch.querySelector('.seg-btn.active');
  const glider = modeSwitch.querySelector('.seg-glider');
  if (isApple()) {
    appleUI.glide(modeSwitch, glider, active.offsetLeft, active.offsetWidth, !gliderPlaced);
  } else {
    glider.style.width = `${active.offsetWidth}px`;
    glider.style.transform = `translateX(${active.offsetLeft - 3}px)`;
  }
  gliderPlaced = active.offsetWidth > 0;
}

async function setMode(mode, { silent = false } = {}) {
  const prev = doc.mode;
  doc.mode = mode;
  saveDoc();
  modeSwitch.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  placeGlider();
  els.codeHost.hidden = mode !== 'code';
  els.blocksWrap.hidden = mode !== 'blocks';
  if (prev !== mode) {
    lastParamSource = null;
    customizer.setValues(doc.values[mode]);
  }
  // Anderes Modell → Ansicht neu einpassen
  const go = () => { scheduleRender.cancel(); render({ reason: 'manual', fit: true }); };
  if (mode === 'code') {
    requestAnimationFrame(() => editor.refresh());
    if (prev !== mode && !silent) go();
  } else {
    await ensureBlocks();
    blockEditor.resize();
    generated = blockEditor.code();
    updateBlocksCode();
    if (!silent) go();
  }
}

function ensureBlocks() {
  if (!blocksReady) {
    els.blocksLoading.hidden = false;
    blockEditor = new BlockEditorProxy();
    blocksReady = (async () => {
      const { BlockEditor } = await import('./blocks/blocks.js');
      const be = new BlockEditor(els.blocksHost, {
        onChange: () => onBlocksChange(),
        prompt: (message, def) => promptDialog(message, def),
      });
      await be.init(document.documentElement.dataset.theme !== 'light', isApple() ? 'apple' : 'glass');
      be.load(doc.blocks);
      blockEditor = be;
      els.blocksLoading.hidden = true;
      generated = be.code();
      if (!doc.blocks) { doc.blocks = be.save(); saveDoc(); }
    })().catch((e) => {
      blocksReady = null;
      els.blocksLoading.hidden = true;
      toast('Der Baukasten konnte nicht geladen werden', { type: 'error', detail: e.message });
      throw e;
    });
  }
  return blocksReady;
}

// Platzhalter, solange Blockly noch lädt
class BlockEditorProxy { resize() {} code() { return ''; } setTheme() {} save() { return doc.blocks; } }

const onBlocksChange = debounce(() => {
  if (!blockEditor?.ws) return;
  doc.blocks = blockEditor.save();
  saveDoc();
  const code = blockEditor.code();
  if (code === generated) return;
  generated = code;
  updateBlocksCode();
  if (doc.mode === 'blocks' && settings.auto) scheduleRender();
}, 200);

function updateBlocksCode() {
  if (!els.blocksCode.hidden) highlightInto(els.blocksCodeBody, generated);
}

function showBlocksCode(open = els.blocksCode.hidden, line) {
  els.blocksCode.hidden = !open;
  $('#btn-blocks-code').classList.toggle('active', open);
  if (open) highlightInto(els.blocksCodeBody, generated, line);
}

// Syntaxfarben ohne Editor-Instanz (CodeMirror-Tokenizer)
function highlightInto(el, text, markLine) {
  const CM = window.CodeMirror;
  const mode = CM.getMode({}, 'openscad');
  const state = CM.startState(mode);
  el.innerHTML = '';
  text.split('\n').forEach((lineText, i) => {
    const lineEl = document.createElement('div');
    if (markLine && i + 1 === markLine) lineEl.className = 'cm-line-error';
    const stream = new CM.StringStream(lineText, 2);
    if (!lineText) lineEl.appendChild(document.createTextNode('​'));
    while (!stream.eol()) {
      const style = mode.token(stream, state);
      const span = document.createElement('span');
      if (style) span.className = style.split(' ').map((s) => `cm-${s}`).join(' ');
      span.textContent = stream.current();
      lineEl.appendChild(span);
      stream.start = stream.pos;
    }
    el.appendChild(lineEl);
  });
}

modeSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn && btn.dataset.mode !== doc.mode) setMode(btn.dataset.mode);
});
$('#btn-blocks-code').onclick = () => showBlocksCode();
$('#btn-blocks-code-close').onclick = () => showBlocksCode(false);
$('#btn-blocks-code-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(generated); toast('Code kopiert', { type: 'success', duration: 2000 }); } catch { toast('Kopieren nicht möglich', { type: 'error' }); }
};
$('#btn-blocks-tidy').onclick = () => blockEditor?.cleanUp?.();
$('#btn-blocks-convert').onclick = async () => {
  if (doc.code.trim() && doc.code !== savedCode) {
    const ok = await confirmDialog({ title: 'In Code umwandeln?', message: 'Der erzeugte Code ersetzt den Inhalt des Code-Editors. Deine Blöcke bleiben im Baukasten erhalten.', confirmLabel: 'Umwandeln', iconName: 'wand' });
    if (!ok) return;
  }
  const before = doc.code;
  doc.code = generated;
  editor.setValue(generated);
  doc.values.code = { ...doc.values.blocks };
  await setMode('code');
  toast('Baukasten in Code umgewandelt', { type: 'success', action: () => { doc.code = before; editor.setValue(before); renderNow(); }, actionLabel: 'Rückgängig' });
};

function promptDialog(message, def = '') {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title: message.replace(/:$/, ''), iconName: 'puzzle', className: 'modal-small',
      body: `<input class="input" id="prompt-input" value="${esc(def)}" autocomplete="off" spellcheck="false">`,
      footer: '<div class="foot-spacer"></div><button class="btn ghost" data-act="cancel">Abbrechen</button><button class="btn primary" data-act="ok">OK</button>',
      onClose: () => { if (!done) resolve(null); },
    });
    const input = m.el.querySelector('#prompt-input');
    const ok = () => { done = true; resolve(input.value.trim() || null); m.close(); };
    m.el.querySelector('[data-act=ok]').onclick = ok;
    m.el.querySelector('[data-act=cancel]').onclick = () => m.close();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    setTimeout(() => input.select(), 40);
  });
}

/* ----------------------------------------------------------- Dateien */

function baseName() {
  return (doc.name || 'modell').replace(/\.(scad|json)$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'modell';
}

function updateFileState() {
  els.fileName.textContent = doc.name || 'Unbenannt';
  const dirty = doc.mode === 'code' && doc.code !== savedCode;
  els.fileDirty.hidden = !dirty;
  document.title = `${dirty ? '• ' : ''}${doc.name || 'Unbenannt'} – Formwerk`;
}

let undoDoc = null;
function replaceDoc(next, { message, keepMode = false } = {}) {
  undoDoc = JSON.parse(JSON.stringify({ doc, savedCode }));
  doc = { ...DEFAULT_DOC(), ...next, values: next.values ?? { code: {}, blocks: {} } };
  savedCode = doc.code;
  fileHandle = null;
  editor.setValue(doc.code);
  lastParamSource = null;
  customizer.setValues(doc.values[doc.mode]);
  if (blockEditor?.ws && next.blocks !== undefined) blockEditor.load(doc.blocks);
  saveDoc();
  updateFileState();
  viewer.bounds = null; // neu einpassen
  setMode(doc.mode, { silent: true }).then(() => render({ fit: true }));
  if (message) {
    toast(message, {
      type: 'success',
      action: () => {
        if (!undoDoc) return;
        const u = undoDoc;
        undoDoc = null;
        doc = u.doc;
        savedCode = u.savedCode;
        editor.setValue(doc.code);
        if (blockEditor?.ws) blockEditor.load(doc.blocks);
        customizer.setValues(doc.values[doc.mode]);
        lastParamSource = null;
        saveDoc();
        updateFileState();
        setMode(doc.mode, { silent: true }).then(() => render({ fit: true }));
      },
      actionLabel: 'Rückgängig',
      duration: 6000,
    });
  }
  void keepMode;
}

async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'OpenSCAD oder Baukasten', accept: { 'text/plain': ['.scad'], 'application/json': ['.json'] } }],
      });
      const file = await handle.getFile();
      await openFromFile(file, handle);
    } catch (e) { if (e.name !== 'AbortError') toast('Datei konnte nicht geöffnet werden', { type: 'error', detail: e.message }); }
  } else {
    $('#file-input').click();
  }
}
$('#file-input').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) await openFromFile(f, null);
};

async function openFromFile(file, handle) {
  const text = await file.text();
  if (/\.json$/i.test(file.name)) {
    try {
      const data = JSON.parse(text);
      if (!data.blocks && !data.formwerk) throw new Error('Keine Baukasten-Datei');
      replaceDoc({ mode: 'blocks', name: file.name.replace(/\.json$/i, '').replace(/\.formwerk$/i, ''), code: doc.code, blocks: data.blocks ?? data, values: { code: {}, blocks: data.values ?? {} } }, { message: `„${file.name}“ geöffnet` });
    } catch (e) { toast('Ungültige Baukasten-Datei', { type: 'error', detail: e.message }); }
    return;
  }
  replaceDoc({ mode: 'code', name: file.name, code: text, blocks: doc.blocks, values: { code: {}, blocks: doc.values.blocks } }, { message: `„${file.name}“ geöffnet` });
  fileHandle = handle;
}

async function saveFile({ as = false } = {}) {
  if (doc.mode === 'blocks') return saveBlocksFile();
  const name = /\.scad$/i.test(doc.name) ? doc.name : `${baseName()}.scad`;
  try {
    if (fileHandle && !as) {
      const w = await fileHandle.createWritable();
      await w.write(doc.code);
      await w.close();
    } else if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'OpenSCAD', accept: { 'text/plain': ['.scad'] } }] });
      const w = await handle.createWritable();
      await w.write(doc.code);
      await w.close();
      fileHandle = handle;
      doc.name = handle.name;
    } else {
      downloadBlob(new Blob([doc.code], { type: 'text/plain' }), name);
      doc.name = name;
    }
    savedCode = doc.code;
    saveDoc();
    updateFileState();
    toast(`„${doc.name}“ gespeichert`, { type: 'success', duration: 2200 });
  } catch (e) {
    if (e.name !== 'AbortError') toast('Speichern fehlgeschlagen', { type: 'error', detail: e.message });
  }
}

function saveBlocksFile() {
  const data = { formwerk: 1, blocks: blockEditor?.save?.() ?? doc.blocks, values: doc.values.blocks };
  downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `${baseName()}.formwerk.json`);
}

async function renameFile() {
  const name = await promptDialog('Name des Projekts:', doc.name);
  if (!name) return;
  doc.name = name;
  fileHandle = null;
  saveDoc();
  updateFileState();
}

function bindMenu(btn, open) {
  btn.addEventListener('pointerdown', (e) => {
    if (!isApple() || e.button !== 0 || e.pointerType === 'touch') return;
    e.preventDefault();
    btn.skipClick = true;
    if (btn.classList.contains('open')) closeMenu(); else open(btn);
  });
  btn.addEventListener('click', () => {
    if (btn.skipClick) { btn.skipClick = false; return; }
    if (btn.classList.contains('open')) closeMenu(); else open(btn);
  });
}

bindMenu($('#btn-file'), (anchor) => {
  const blocks = doc.mode === 'blocks';
  menu(0, 0, [
    { label: 'Neu', icon: 'filePlus', action: () => newProject() },
    { label: 'Öffnen …', icon: 'folderOpen', kbd: `${MOD}O`, action: () => openFile() },
    'sep',
    blocks
      ? { label: 'Baukasten speichern', sub: 'als .formwerk.json', icon: 'save', kbd: `${MOD}S`, action: () => saveBlocksFile() }
      : { label: 'Speichern', sub: fileHandle ? 'in die geöffnete Datei' : 'als .scad', icon: 'save', kbd: `${MOD}S`, action: () => saveFile() },
    !blocks && { label: 'Speichern unter …', icon: 'save', kbd: `⇧${MOD}S`, action: () => saveFile({ as: true }) },
    blocks && { label: 'Code als .scad speichern', icon: 'fileCode', action: () => downloadBlob(new Blob([generated], { type: 'text/plain' }), `${baseName()}.scad`) },
    { label: 'Umbenennen …', icon: 'fileCode', action: () => renameFile() },
  ].filter(Boolean), { anchor });
});

function newProject() {
  if (doc.mode === 'blocks') {
    replaceDoc({ ...doc, name: 'Neuer Baukasten', blocks: { blocks: { languageVersion: 0, blocks: [] } }, values: { ...doc.values, blocks: {} } }, { message: 'Neuer, leerer Baukasten' });
  } else {
    replaceDoc({ mode: 'code', name: 'Unbenannt', code: EXAMPLES.find((x) => x.id === 'empty').code, blocks: doc.blocks, values: { code: {}, blocks: doc.values.blocks } }, { message: 'Neues Projekt' });
  }
}

/* ------------------------------------------------------------- Export */

function meshToSTL(mesh) {
  const n = mesh.triangles, p = mesh.positions;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = 'Formwerk STL (OpenSCAD im Browser)';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const i = t * 9;
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, p[i + k], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return new Blob([buf], { type: 'model/stl' });
}

async function ensureFresh() {
  // Exportiert wird, was gerade zu sehen ist – ist der Code neuer, erst rendern.
  const fresh = lastResult && lastResult.source === currentSource() && JSON.stringify(lastResult.defines) === JSON.stringify(customizer.defines());
  if (fresh) return true;
  scheduleRender.cancel();
  await render({ reason: 'manual' });
  return !!lastResult;
}

async function exportVia(ext, mime, label) {
  if (!(await ensureFresh())) { toast('Erst ein gültiges Modell rendern', { type: 'warning' }); return; }
  const t = toast(`${label} wird erzeugt …`, { type: 'progress', duration: 0 });
  const res = await runner.request({
    source: lastResult.source, defines: lastResult.defines, files: lastResult.files, fonts: lastResult.fonts,
    export: { ext, format: ext === 'stl' ? 'binstl' : undefined },
  }, { exclusive: true });
  t.close();
  if (!res?.ok || !res.data) {
    toast(`${label}-Export fehlgeschlagen`, { type: 'error', detail: parseLog(res?.logs ?? []).filter((m) => m.level === 'error').map((m) => m.text).join('\n') || undefined });
    return;
  }
  downloadBlob(new Blob([res.data], { type: mime }), `${baseName()}.${ext}`);
}

async function exportAs(kind) {
  switch (kind) {
    case 'stl':
      if (!(await ensureFresh()) || lastResult.dim !== 3) return toast('STL braucht ein 3D-Modell', { type: 'warning' });
      return downloadBlob(meshToSTL(lastResult.mesh), `${baseName()}.stl`);
    case 'off':
      if (!(await ensureFresh()) || lastResult.dim !== 3) return toast('OFF braucht ein 3D-Modell', { type: 'warning' });
      return downloadBlob(new Blob([lastResult.off], { type: 'text/plain' }), `${baseName()}.off`);
    case '3mf': return exportVia('3mf', 'model/3mf', '3MF');
    case 'wrl': return exportVia('wrl', 'model/vrml', 'VRML');
    case 'svg':
      if (!(await ensureFresh()) || lastResult.dim !== 2) return toast('SVG braucht ein 2D-Modell', { type: 'warning' });
      return downloadBlob(new Blob([lastResult.svg], { type: 'image/svg+xml' }), `${baseName()}.svg`);
    case 'dxf': return exportVia('dxf', 'image/vnd.dxf', 'DXF');
    case 'png': {
      const blob = await viewer.screenshot();
      if (blob) downloadBlob(blob, `${baseName()}.png`);
      return;
    }
    case 'scad':
      return downloadBlob(new Blob([currentSource()], { type: 'text/plain' }), `${baseName()}.scad`);
  }
}

bindMenu($('#btn-export'), (anchor) => {
  const is2D = lastResult?.dim === 2;
  menu(0, 0, [
    { heading: is2D ? '2D-Modell' : '3D-Modell' },
    !is2D && { label: 'STL', sub: 'Für jeden Slicer', icon: 'download', kbd: `${MOD}E`, action: () => exportAs('stl') },
    !is2D && { label: '3MF', sub: 'Mit Farben – für Multicolor-Druck', icon: 'download', action: () => exportAs('3mf') },
    !is2D && { label: 'OFF', sub: 'Mit Farben, einfaches Textformat', icon: 'download', action: () => exportAs('off') },
    is2D && { label: 'SVG', sub: 'Für Laser, Plotter, Grafik', icon: 'download', kbd: `${MOD}E`, action: () => exportAs('svg') },
    is2D && { label: 'DXF', sub: 'Für CAD und Laser', icon: 'download', action: () => exportAs('dxf') },
    'sep',
    { label: 'Bild (PNG)', sub: 'Aktuelle Ansicht', icon: 'camera', action: () => exportAs('png') },
    { label: 'OpenSCAD-Code (.scad)', icon: 'fileCode', action: () => exportAs('scad') },
  ].filter(Boolean), { anchor });
});

/* ------------------------------------------------------------- Teilen */

async function openShare() {
  const project = { v: 1, mode: doc.mode, name: doc.name, values: doc.values[doc.mode] };
  if (doc.mode === 'blocks') project.blocks = blockEditor?.save?.() ?? doc.blocks;
  else project.code = doc.code;
  const url = await shareUrl(project);
  const long = url.length > 8000;
  const m = openModal({
    title: 'Als Link teilen', subtitle: 'Das ganze Projekt steckt im Link – kein Server, kein Konto.', iconName: 'share',
    body: `<div class="share-box"><input class="input" readonly value="${esc(url)}"><button class="btn primary" data-act="copy">${icon('copy')}<span>Kopieren</span></button></div>
      <p class="share-note">${long ? `⚠︎ Der Link ist sehr lang (${formatNumber(url.length, 0)} Zeichen) – manche Messenger kürzen ihn. Als Datei teilen ist dann sicherer.` : `${formatNumber(url.length, 0)} Zeichen. Wer den Link öffnet, bekommt eine eigene Kopie.`}${attachments.size ? ' Eigene Dateien (STL, Bilder …) sind nicht enthalten.' : ''}</p>`,
    footer: `${navigator.share ? `<button class="btn ghost" data-act="native">${icon('share')}<span>Teilen …</span></button>` : ''}<div class="foot-spacer"></div><button class="btn" data-act="close">Fertig</button>`,
  });
  const input = m.el.querySelector('input');
  setTimeout(() => input.select(), 50);
  m.el.querySelector('[data-act=copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link kopiert', { type: 'success', duration: 2000 }); m.close(); }
    catch { input.select(); toast('Bitte manuell kopieren', { type: 'warning' }); }
  };
  m.el.querySelector('[data-act=close]').onclick = () => m.close();
  m.el.querySelector('[data-act=native]')?.addEventListener('click', () => navigator.share({ title: `${doc.name} – Formwerk`, url }).catch(() => {}));
}
$('#btn-share').onclick = openShare;

async function loadFromHash() {
  const token = readHashToken();
  if (!token) return false;
  try {
    const p = await decodeProject(token);
    history.replaceState(null, '', location.pathname + location.search);
    const next = {
      mode: p.mode === 'blocks' ? 'blocks' : 'code',
      name: p.name || 'Geteiltes Projekt',
      code: p.mode === 'blocks' ? doc.code : (p.code ?? ''),
      blocks: p.mode === 'blocks' ? p.blocks : doc.blocks,
      values: { ...doc.values, [p.mode === 'blocks' ? 'blocks' : 'code']: p.values ?? {} },
    };
    replaceDoc(next, { message: `Geteiltes Projekt „${next.name}“ geöffnet` });
    return true;
  } catch (e) {
    toast('Der Link ist beschädigt', { type: 'error', detail: e.message });
    return false;
  }
}

/* ---------------------------------------------------------- Beispiele */

function openExamples() {
  const body = h(`<div>
    <div class="ex-kind">Code</div>
    <div class="examples" data-kind="code"></div>
    <div class="ex-kind">Baukasten</div>
    <div class="examples" data-kind="blocks"></div>
  </div>`);
  const codeBox = body.querySelector('[data-kind=code]');
  for (const ex of EXAMPLES) {
    const b = h(`<button class="example"><div class="ex-ico">${icon(ex.icon)}</div><div><div class="ex-title">${esc(ex.title)}</div><div class="ex-desc">${esc(ex.desc)}</div></div></button>`);
    b.onclick = () => {
      m.close();
      replaceDoc({ mode: 'code', name: ex.title, code: ex.code, blocks: doc.blocks, values: { code: {}, blocks: doc.values.blocks } }, { message: `Beispiel „${ex.title}“ geladen` });
    };
    codeBox.appendChild(b);
  }
  const blocksBox = body.querySelector('[data-kind=blocks]');
  const be = [
    { title: 'Becher mit Henkel', desc: 'Regler, Differenz, Farben', icon: 'puzzle', blocks: null },
    { title: 'Leerer Baukasten', desc: 'Mit eigenen Blöcken starten', icon: 'filePlus', blocks: { blocks: { languageVersion: 0, blocks: [] } } },
  ];
  for (const ex of be) {
    const b = h(`<button class="example"><div class="ex-ico">${icon(ex.icon)}</div><div><div class="ex-title">${esc(ex.title)}</div><div class="ex-desc">${esc(ex.desc)}</div></div></button>`);
    b.onclick = async () => {
      m.close();
      const { STARTER } = await import('./blocks/blocks.js');
      replaceDoc({ mode: 'blocks', name: ex.title, code: doc.code, blocks: ex.blocks ?? STARTER, values: { code: doc.values.code, blocks: {} } }, { message: `„${ex.title}“ geladen` });
    };
    blocksBox.appendChild(b);
  }
  const m = openModal({ title: 'Beispiele', subtitle: 'Zum Ausprobieren und Abschauen – alle mit Reglern im Customizer.', iconName: 'book', body, className: 'modal-wide' });
}
$('#btn-examples').onclick = openExamples;

/* ------------------------------------------------------- Einstellungen */

const ACCENTS = { violet: 262, blue: 218, cyan: 190, green: 152, orange: 28, pink: 330 };
const APPLE_ACCENTS = { blue: ['#0a84ff', 'Blau'], indigo: ['#5e5ce6', 'Indigo'], purple: ['#bf5af2', 'Lila'], pink: ['#ff375f', 'Pink'], orange: ['#ff9f0a', 'Orange'], green: ['#30d158', 'Grün'], teal: ['#40c8e0', 'Türkis'] };

function applyTheme(animate = true) {
  const t = settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
  if (animate) {
    document.documentElement.classList.add('theme-anim');
    setTimeout(() => document.documentElement.classList.remove('theme-anim'), 500);
  }
  const root = document.documentElement;
  root.dataset.theme = t;
  root.dataset.ui = settings.ui === 'apple' ? 'apple' : 'glass';
  if (settings.ui === 'apple') root.dataset.accent = settings.appleAccent || 'blue';
  else if (settings.accent && settings.accent !== 'violet') root.dataset.accent = settings.accent;
  else delete root.dataset.accent;
  const apple = settings.ui === 'apple';
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? (apple ? '#f5f5f7' : '#eceef6') : (apple ? '#000000' : '#08080d');
  setIcon($('#btn-theme span'), t === 'light' ? 'sun' : 'moon');
  blockEditor?.setTheme?.(t !== 'light', apple ? 'apple' : 'glass');
}

// Zwischen den Oberflächen „Glas“ und „Apple“ wechseln
function setUI(ui) {
  settings.ui = ui;
  settings.uiChosen = true;
  saveSettings();
  applyTheme();
  if (ui === 'apple') appleUI.activate({ sidebarOpen: settings.sidebarOpen, paramsOpen: settings.paramsOpen });
  else appleUI.reset();
  if (isMobile() && document.body.dataset.mtab === 'params' && ui === 'apple') setMobileTab('viewer');
  setParamsOpen(settings.paramsOpen, { immediate: true });
  gliderPlaced = false;
  requestAnimationFrame(() => {
    placeGlider();
    editor.refresh();
    blockEditor?.resize();
    viewer.resize();
    viewer.refreshTheme();
    updateViewerInsets(true);
  });
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (settings.theme === 'system') applyTheme(); });

$('#btn-theme').onclick = () => {
  const cur = document.documentElement.dataset.theme;
  settings.theme = cur === 'light' ? 'dark' : 'light';
  saveSettings();
  applyTheme();
};

function openSettings() {
  const pills = (key, opts) => `<div class="pills" data-key="${key}">${opts.map(([v, l, ic]) => `<button class="pill ${String(settings[key]) === String(v) ? 'active' : ''}" data-v="${v}">${ic ? icon(ic) : ''}${esc(l)}</button>`).join('')}</div>`;
  const sw = (key) => `<label class="switch"><input type="checkbox" data-key="${key}" ${settings[key] ? 'checked' : ''}><span></span></label>`;
  const body = h(`<div>
    <div class="set-section">
      <div class="set-title">Darstellung</div>
      <div class="set-row"><div class="set-label"><b>Oberfläche</b><span>Zwei Gestaltungen zum Vergleichen</span></div>${pills('ui', [['glass', 'Glas'], ['apple', 'Apple']])}</div>
      <div class="set-row"><div class="set-label"><b>Design</b></div>${pills('theme', [['dark', 'Dunkel', 'moon'], ['light', 'Hell', 'sun'], ['system', 'System', 'monitor']])}</div>
      <div class="set-row"><div class="set-label"><b>Akzentfarbe</b></div><div class="swatches" id="set-swatches"></div></div>
      <div class="set-row"><div class="set-label"><b>Modellfarbe</b><span>Für Teile ohne color()</span></div>${pills('modelColor', [['theme', 'Akzent'], ['classic', 'OpenSCAD-Gelb'], ['gray', 'Grau']])}</div>
      <div class="set-row"><div class="set-label"><b>Animationen</b></div><label class="switch"><input type="checkbox" data-key="motion" ${settings.motion !== false ? 'checked' : ''}><span></span></label></div>
    </div>
    <div class="set-section">
      <div class="set-title">Rendern</div>
      <div class="set-row"><div class="set-label"><b>Automatisch rendern</b><span>Nach einer kurzen Tipp-Pause</span></div>${sw('auto')}</div>
      <div class="set-row"><div class="set-label"><b>Wartezeit</b><span>Pause, bevor neu gerendert wird</span></div>${pills('delay', [[250, 'Kurz'], [450, 'Mittel'], [900, 'Lang']])}</div>
    </div>
    <div class="set-section">
      <div class="set-title">Editor</div>
      <div class="set-row"><div class="set-label"><b>Schriftgröße</b></div>${pills('fontSize', [[12, 'S'], [13.5, 'M'], [15, 'L'], [17, 'XL']])}</div>
      <div class="set-row"><div class="set-label"><b>Vorschläge beim Tippen</b><span>Module, Funktionen, eigene Namen</span></div>${sw('autocomplete')}</div>
      <div class="set-row"><div class="set-label"><b>Zeilen umbrechen</b></div>${sw('wrap')}</div>
    </div>
  </div>`);
  const paintSwatches = () => {
    const box = body.querySelector('#set-swatches');
    box.innerHTML = settings.ui === 'apple'
      ? Object.entries(APPLE_ACCENTS).map(([k, [c, n]]) => `<button class="swatch ${settings.appleAccent === k ? 'active' : ''}" data-accent="${k}" style="background:${c};--h:0" title="${n}"></button>`).join('')
      : Object.entries(ACCENTS).map(([k, hh]) => `<button class="swatch ${settings.accent === k ? 'active' : ''}" data-accent="${k}" style="--h:${hh}" title="${k}"></button>`).join('');
  };
  paintSwatches();
  body.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (pill) {
      const key = pill.parentElement.dataset.key;
      const raw = pill.dataset.v;
      settings[key] = isNaN(Number(raw)) ? raw : Number(raw);
      pill.parentElement.querySelectorAll('.pill').forEach((p) => p.classList.toggle('active', p === pill));
      applySetting(key);
      if (key === 'ui') paintSwatches();
    }
    const swb = e.target.closest('.swatch');
    if (swb) {
      if (settings.ui === 'apple') settings.appleAccent = swb.dataset.accent; else settings.accent = swb.dataset.accent;
      body.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === swb));
      applySetting('accent');
    }
  });
  body.addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    settings[key] = e.target.checked;
    applySetting(key);
  });
  openModal({ title: 'Einstellungen', iconName: 'settings', body });
}

function applySetting(key) {
  saveSettings();
  switch (key) {
    case 'theme': case 'accent': applyTheme(); viewer.refreshTheme(); break;
    case 'ui': setUI(settings.ui); break;
    case 'modelColor': viewer.setOption('color', settings.modelColor); break;
    case 'motion':
      if (settings.motion === false) document.documentElement.dataset.motion = 'off'; else delete document.documentElement.dataset.motion;
      break;
    case 'auto': updateAutoButton(); break;
    case 'fontSize': editor.setFontSize(settings.fontSize); break;
    case 'autocomplete': editor.autoComplete = settings.autocomplete; break;
    case 'wrap': editor.setWrap(settings.wrap); break;
  }
}

function updateAutoButton() {
  const b = $('#btn-auto');
  b.setAttribute('aria-pressed', String(!!settings.auto));
  b.title = settings.auto ? 'Automatisch rendern: an' : 'Automatisch rendern: aus';
}
$('#btn-auto').onclick = () => {
  settings.auto = !settings.auto;
  saveSettings();
  updateAutoButton();
  toast(settings.auto ? 'Automatisches Rendern an' : 'Automatisches Rendern aus – rendern mit ⌘↵ oder F5', { type: 'info', duration: 2400 });
  if (settings.auto) scheduleRender();
};

function openShortcuts() {
  const k = (keys, label) => `<span>${esc(label)}</span><span class="kbd">${esc(keys)}</span>`;
  openModal({
    title: 'Tastenkürzel', iconName: 'keyboard', className: 'modal-small',
    body: `<div class="keys">
      <div class="k-head">Allgemein</div>
      ${k(`${MOD}↵  /  F5`, 'Rendern')}${k('Esc', 'Rendern abbrechen')}${k(`${MOD}S`, 'Speichern')}${k(`${MOD}O`, 'Öffnen')}${k(`${MOD}E`, 'Exportieren (STL/SVG)')}
      <div class="k-head">Editor</div>
      ${k(isMac ? '⌥ + Ziehen' : 'Alt + Ziehen', 'Zahl unter der Maus verändern')}${k(isMac ? '⌥↑ / ⌥↓' : 'Alt+↑ / Alt+↓', 'Zahl um 1 ändern (⇧ = 10)')}${k('Strg+Leertaste', 'Vorschläge')}${k(`${MOD}/`, 'Kommentar an/aus')}${k(`${MOD}D`, 'Zeile duplizieren')}${k(`${MOD}F`, 'Suchen')}
      <div class="k-head">3D-Ansicht</div>
      ${k('F', 'Einpassen')}${k('0 / 7 / 1 / 3', 'Iso / Oben / Vorne / Rechts')}${k('5', 'Ortho / Perspektive')}${k('G', 'Raster')}
    </div>`,
  });
}

function openAbout() {
  openModal({
    title: 'Über Formwerk', subtitle: `OpenSCAD ${OPENSCAD_VERSION} · WebAssembly`, iconName: 'box',
    body: `<div class="about">
      <p>Formwerk führt <a href="https://openscad.org" target="_blank" rel="noopener">OpenSCAD</a> vollständig in deinem Browser aus – als WebAssembly in einem eigenen Thread. Es gibt keinen Server: Code, Modelle und Dateien bleiben auf deinem Gerät. Nur Bibliotheken wie BOSL2 werden bei Bedarf von jsDelivr geladen.</p>
      <p>Mitgeliefert und genutzt:</p>
      <ul>
        <li>OpenSCAD ${OPENSCAD_VERSION} – GPL v2, <a href="https://github.com/openscad/openscad" target="_blank" rel="noopener">Quellcode</a></li>
        <li>three.js – MIT · CodeMirror 5 – MIT · Blockly – Apache 2.0</li>
        <li>Liberation Fonts – SIL Open Font License</li>
        <li>Bei Bedarf: BOSL2 (BSD-2) · MCAD (LGPL 2.1)</li>
      </ul>
    </div>`,
  });
}

bindMenu($('#btn-menu'), (anchor) => {
  menu(0, 0, [
    { label: 'Beispiele', icon: 'book', action: openExamples },
    { label: 'Als Link teilen', icon: 'share', action: openShare },
    { label: 'Hell/Dunkel', icon: 'sun', action: () => $('#btn-theme').click() },
    { label: settings.ui === 'apple' ? 'Oberfläche: Glas' : 'Oberfläche: Apple', sub: 'Zweite Gestaltung zum Vergleichen', icon: 'layers', action: () => setUI(settings.ui === 'apple' ? 'glass' : 'apple') },
    'sep',
    { label: 'Einstellungen', icon: 'settings', action: openSettings },
    { label: 'Tastenkürzel', icon: 'keyboard', kbd: '?', action: openShortcuts },
    { label: 'Über Formwerk', icon: 'info', action: openAbout },
  ], { anchor });
});

/* ------------------------------------------------------------ Ansicht */

function syncViewerButtons() {
  $$('#vt-tools [data-opt]').forEach((b) => b.classList.toggle('on', !!viewer.opts[b.dataset.opt]));
}
$$('#vt-tools [data-opt]').forEach((b) => b.addEventListener('click', () => toggleViewOpt(b.dataset.opt)));
function toggleViewOpt(key) {
  const v = !viewer.opts[key];
  viewer.setOption(key, v);
  settings.viewer[key] = v;
  saveSettings();
  syncViewerButtons();
}
new ViewCube(els.viewerPane, viewer);
$('#vt-iso').onclick = () => viewer.view('iso');
$('#vt-fit').onclick = () => viewer.fit(undefined, true);
$('#vt-shot').onclick = () => exportAs('png');
$('#vt-params').onclick = () => setParamsOpen(!settings.paramsOpen);
$('#btn-params-close').onclick = () => (isMobile() ? setMobileTab('viewer') : setParamsOpen(false));
function setParamsOpen(open, { immediate = false } = {}) {
  settings.paramsOpen = open;
  saveSettings();
  els.viewerPane.classList.toggle('params-hidden', !open);
  $('#vt-params').classList.toggle('on', open);
  if (isApple()) appleUI.setInspector(open, { immediate });
  updateViewerInsets();
}
function updateViewerInsets(immediate = false) {
  if (isApple()) { appleUI.layout(immediate); return; }
  if (isMobile()) {
    const sheet = document.body.dataset.mtab === 'params' ? $('#params-panel').offsetHeight + 8 : 0;
    viewer.setInsets({ bottom: sheet });
    return;
  }
  const visible = settings.paramsOpen && customizer.count > 0;
  viewer.setInsets({ right: visible ? 324 : 0 });
}
viewer.addEventListener('bounds', () => updateHud());

/* -------------------------------------------------------- Layout */

function initSplitters() {
  const ws = els.workspace;
  document.documentElement.style.setProperty('--editor-w', `${settings.editorW}%`);
  document.documentElement.style.setProperty('--sidebar-w', `${settings.sidebarW}%`);
  document.documentElement.style.setProperty('--console-h', `${settings.consoleH}px`);
  els.console.classList.toggle('collapsed', !settings.consoleOpen);

  const v = $('#splitter-v');
  v.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    v.setPointerCapture(e.pointerId);
    v.classList.add('dragging');
    document.body.classList.add('resizing');
    const rect = ws.getBoundingClientRect();
    const move = (ev) => {
      const pct = Math.round(Math.min(75, Math.max(isApple() ? 18 : 22, ((ev.clientX - rect.left) / rect.width) * 100)) * 10) / 10;
      if (isApple()) {
        settings.sidebarW = pct;
        document.documentElement.style.setProperty('--sidebar-w', `${pct}%`);
        updateViewerInsets(true);
      } else {
        settings.editorW = pct;
        document.documentElement.style.setProperty('--editor-w', `${pct}%`);
      }
    };
    const up = () => {
      v.classList.remove('dragging');
      document.body.classList.remove('resizing');
      v.removeEventListener('pointermove', move);
      saveSettings();
      editor.refresh();
      blockEditor?.resize();
      placeGlider();
    };
    v.addEventListener('pointermove', move);
    v.addEventListener('pointerup', up, { once: true });
  });
  v.addEventListener('dblclick', () => { settings.editorW = DEFAULTS.editorW; document.documentElement.style.setProperty('--editor-w', `${settings.editorW}%`); saveSettings(); editor.refresh(); });

  const hs = $('#splitter-h');
  hs.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hs.setPointerCapture(e.pointerId);
    hs.classList.add('dragging');
    document.body.classList.add('resizing-h');
    if (!settings.consoleOpen) toggleConsole(true);
    const pane = els.editorPane.getBoundingClientRect();
    const move = (ev) => {
      const hgt = Math.min(pane.height - 120, Math.max(60, pane.bottom - ev.clientY));
      settings.consoleH = Math.round(hgt);
      document.documentElement.style.setProperty('--console-h', `${settings.consoleH}px`);
      editor.refresh();
    };
    const up = () => {
      hs.classList.remove('dragging');
      document.body.classList.remove('resizing-h');
      hs.removeEventListener('pointermove', move);
      saveSettings();
      blockEditor?.resize();
    };
    hs.addEventListener('pointermove', move);
    hs.addEventListener('pointerup', up, { once: true });
  });
}

const isMobile = () => mq.matches;
function setMobileTab(tab) {
  if (tab === 'params' && isApple()) { tab = 'viewer'; appleUI.snapSheet('half'); }
  document.body.dataset.mtab = tab;
  $$('#mobile-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mtab === tab));
  requestAnimationFrame(() => {
    if (tab === 'editor') { editor.refresh(); blockEditor?.resize(); }
    else viewer.resize();
    updateViewerInsets();
  });
}
$$('#mobile-tabs button').forEach((b) => b.addEventListener('click', () => setMobileTab(b.dataset.mtab)));
mq.addEventListener('change', () => {
  els.viewerPane.classList.toggle('params-empty', !customizer.count && !isMobile());
  updateViewerInsets();
  placeGlider();
  editor.refresh();
});

new ResizeObserver(() => { blockEditor?.resize(); }).observe(els.blocksWrap);
new ResizeObserver(() => { if (isApple()) updateViewerInsets(true); }).observe(els.viewerPane);

/* ------------------------------------------------------ Drag & Drop */

let dragDepth = 0;
addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  $('#drop-overlay').hidden = false;
});
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  const files = [...e.dataTransfer.files];
  const project = files.find((f) => /\.(scad|json)$/i.test(f.name));
  const rest = files.filter((f) => f !== project);
  if (project) await openFromFile(project, null);
  if (rest.length) await addAttachments(rest);
});

/* ----------------------------------------------------------- Tastatur */

const inField = (el) => el && (el.closest('.CodeMirror') || el.closest('input, textarea, select, [contenteditable=true]') || el.closest('.blocklyWidgetDiv, .blocklyDropDownDiv'));

addEventListener('keydown', (e) => {
  const mod = modKey(e);
  if ((mod && e.key === 'Enter') || e.key === 'F5' || e.key === 'F6') { e.preventDefault(); renderNow(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile({ as: e.shiftKey }); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); return; }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); exportAs(lastResult?.dim === 2 ? 'svg' : 'stl'); return; }
  if (e.key === 'Escape') {
    if (modalOpen()) { closeTopModal(); return; }
    if (runner.busy) { runner.cancel(); setBusy(false); setStatus('warn', 'Abgebrochen'); return; }
    if (!els.blocksCode.hidden) { showBlocksCode(false); return; }
  }
  if (mod || e.altKey || inField(e.target) || modalOpen()) return;
  const views = { 0: 'iso', 7: 'top', 1: 'front', 3: 'right', 9: 'bottom', 4: 'left', 6: 'right', 2: 'front', 8: 'back' };
  if (e.key in views) { viewer.view(views[e.key]); return; }
  switch (e.key.toLowerCase()) {
    case 'f': viewer.fit(undefined, true); break;
    case '5': toggleViewOpt('ortho'); break;
    case 'g': toggleViewOpt('grid'); break;
    case '?': openShortcuts(); break;
  }
});

$('#btn-render').onclick = () => renderNow();
$('#btn-cancel').onclick = () => { runner.cancel(); setBusy(false); setStatus('warn', 'Abgebrochen'); };

/* ------------------------------------------------------------- Start */

async function boot() {
  // ?ui=apple bzw. ?ui=glass zum direkten Verlinken einer Oberfläche
  const qUI = new URLSearchParams(location.search).get('ui');
  if (qUI === 'apple' || qUI === 'glass') settings.ui = qUI;
  applyTheme(false);
  hydrateIcons();
  initSplitters();
  updateAutoButton();
  syncViewerButtons();
  if (isApple()) appleUI.activate({ sidebarOpen: settings.sidebarOpen, paramsOpen: settings.paramsOpen });
  setParamsOpen(settings.paramsOpen, { immediate: true });
  setMobileTab('editor');
  updateFileState();
  $('#status-version').textContent = `OpenSCAD ${OPENSCAD_VERSION}`;
  document.body.classList.add('ready');
  requestAnimationFrame(placeGlider);
  document.fonts?.ready?.then(placeGlider);

  // Gespeicherte Dateien laden
  listFiles().then((list) => {
    for (const f of list) attachments.set(f.name, f.data);
    renderFiles();
  });
  renderFiles();

  const fromHash = await loadFromHash();
  if (!fromHash && doc.mode === 'blocks') setMode('blocks', { silent: true }).catch(() => setMode('code', { silent: true }));

  runner.addEventListener('progress', ({ detail }) => {
    const pct = Math.min(100, Math.round((detail.loaded / detail.total) * 100));
    els.bootBar.style.width = `${pct}%`;
    els.bootSub.textContent = detail.compiling ? 'Wird vorbereitet …' : `${pct} % · ${formatSize(detail.loaded)} von ${formatSize(detail.total)}`;
  });
  try {
    await runner.load();
    els.boot.classList.add('done');
    setTimeout(() => els.boot.remove(), 600);
    if (doc.mode === 'blocks') await blocksReady?.catch(() => {});
    render({ fit: true });
  } catch (e) {
    els.bootSub.textContent = `Fehler: ${e.message}`;
    setStatus('error', 'OpenSCAD konnte nicht geladen werden');
    toast('OpenSCAD konnte nicht geladen werden', { type: 'error', detail: e.message, duration: 0 });
  }
}

boot();

// Für Fehlersuche in der Browser-Konsole
window.formwerk = { get blocks() { return blockEditor; }, get doc() { return doc; }, render: (o) => render(o), viewer, runner, customizer };

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
