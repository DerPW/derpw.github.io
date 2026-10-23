// Lector Lite: EPUB or text in, an audiobook out, read by Kokoro entirely in the browser.
//
// Flow: import -> pick chapters, voice, speed, format -> read chapter by chapter in a Web
// Worker (Kokoro) -> encode each chapter right away (ffmpeg.wasm) and keep it in IndexedDB
// -> put the M4B together (or zip the MP3s) -> download or share.

import { parseFile, parseText } from './book.js?v=60a50c5';
import { planChunks } from './textprep.js?v=60a50c5';
import { PcmTrack, assembleM4B, encodeChapter, load as loadEncoder, safeName, wav, zipChapters } from './encoder.js?v=60a50c5';
import * as store from './store.js?v=60a50c5';
import { duration, fileSize, getLang, languageName, setLang, t } from './i18n.js?v=60a50c5';

const VERSION = '0.14.0'; // keep in step with src/lector/__init__.py
// Characters per passage. Kokoro cuts off input beyond about 510 phoneme tokens, but memory is
// the real limit: on WebGPU a 300-character passage briefly needs 3-4 GB, 180 characters stay
// under 1 GB (measured on an M3), for about 15 % less speed.
const MAX_CHARS = 180;
const CHARS_PER_SECOND = 15; // spoken characters per second of audio, for estimates
const CHAPTER_LEAD = 0.5;
const CHAPTER_TAIL = 1.5;
const MODEL_MB = { webgpu: 330, wasm: 90 };
const HAS_GPU = 'gpu' in navigator; // a first guess; detectHardware asks for a real adapter
const IS_FIREFOX = /Firefox\//.test(navigator.userAgent);
const gpuOffered = () => (state.hw ? state.hw.webgpu : HAS_GPU);

function stored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function keep(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

// Kokoro's voices with the model card's grades; the better ones are marked.
const VOICES = [
  ['af_heart', 'A'], ['af_bella', 'A-'], ['af_nicole', 'B-'], ['af_aoede', 'C+'], ['af_kore', 'C+'],
  ['af_sarah', 'C+'], ['af_alloy', 'C'], ['af_nova', 'C'], ['af_sky', 'C-'], ['af_jessica', 'D'],
  ['af_river', 'D'], ['am_fenrir', 'C+'], ['am_michael', 'C+'], ['am_puck', 'C+'], ['am_echo', 'D'],
  ['am_eric', 'D'], ['am_liam', 'D'], ['am_onyx', 'D'], ['am_santa', 'D-'], ['am_adam', 'F+'],
  ['bf_emma', 'B-'], ['bf_isabella', 'C'], ['bf_alice', 'D'], ['bf_lily', 'D'], ['bm_fable', 'C'],
  ['bm_george', 'C'], ['bm_lewis', 'D+'], ['bm_daniel', 'D'],
].map(([id, grade]) => ({
  id,
  grade,
  name: id.slice(3).charAt(0).toUpperCase() + id.slice(4),
  accent: id[0] === 'a' ? 'us' : 'gb',
  gender: id[1] === 'f' ? 'female' : 'male',
  best: ['A', 'A-', 'B-'].includes(grade),
}));

const state = {
  book: null,
  importing: '',
  pasteOpen: false,
  selected: new Set(),
  titles: {},
  open: new Set(),
  voice: 'af_heart',
  speed: 1.0,
  format: 'm4b',
  bitrate: '64k',
  device: null, // what the model actually runs on, once loaded
  fallback: '', // why it is not on the graphics chip although that was chosen
  // 'gpu': WebGPU, fast but the model takes well over a gigabyte; 'cpu': WebAssembly, slower
  // and much lighter. Without WebGPU there is no choice.
  runOn: HAS_GPU ? stored('lectorLite.runOn', 'gpu') : 'cpu',
  job: null, // the running or finished job (see startJob)
  resume: null,
  hw: null, // what the browser tells about this device (see detectHardware)
  // Voice list filters, as in Lector.
  voiceQuery: '',
  voiceGender: '',
  voiceAccent: '',
  voiceSort: 'recommended',
  favOnly: false,
};

const favorites = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('lectorLite.favorites') || '[]')); } catch { return new Set(); }
})();
function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  keep('lectorLite.favorites', JSON.stringify([...favorites]));
}
// The model card's grades, best first, for sorting.
const GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+', 'F'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 4500);
}

function errorText(err) {
  const msg = String(err?.message || err);
  if (msg.startsWith('unsupported')) return t('err.unsupported');
  return t('err.generic', { msg });
}

function ask({ title, message = '', confirm, danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}
      <div class="dialog-actions"><button class="btn ghost" value="cancel" ${danger ? 'autofocus' : ''}>${esc(t('dialog.cancel'))}</button>
      <button class="btn ${danger ? 'danger-solid' : 'primary'}" value="ok" ${danger ? '' : 'autofocus'}>${esc(confirm)}</button></div></form>`;
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close('cancel'); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// --- Kokoro worker ----------------------------------------------------------------------

const tts = (() => {
  let worker = null;
  let ready = null;
  let seq = 0;
  const waiting = new Map();
  const listeners = new Set();
  const files = new Map(); // file -> {loaded, total} while the model downloads

  function start() {
    worker = new Worker(new URL('./tts-worker.js?v=60a50c5', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') files.set(data.file, { loaded: data.loaded, total: data.total });
      if (data.type === 'ready' || data.type === 'error') files.clear();
      if (['progress', 'ready', 'error'].includes(data.type)) listeners.forEach((fn) => fn(data));
      if (data.type === 'ready') waiting.get('load')?.resolve(data);
      if (data.type === 'audio') waiting.get(data.id)?.resolve(data);
      if (data.type === 'error') (waiting.get(data.id ?? 'load') || waiting.get('load'))?.reject(new Error(data.message));
      if (data.type !== 'progress' && waiting.has(data.id ?? 'load')) waiting.delete(data.id ?? 'load');
    };
  }

  return {
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // How far the model download is, all files together; null when nothing big is loading.
    download() {
      let loaded = 0;
      let total = 0;
      files.forEach((f) => { loaded += f.loaded; total += f.total; });
      return total > 5e6 ? { loaded, total } : null;
    },
    load() {
      if (!worker) start();
      ready ??= new Promise((resolve, reject) => {
        waiting.set('load', { resolve, reject });
        worker.postMessage({ type: 'load', prefer: state.runOn === 'cpu' || !gpuOffered() ? 'wasm' : undefined });
      }).then((info) => {
        state.device = info.device;
        state.fallback = info.device === 'wasm' && state.runOn === 'gpu' ? info.fallback || '' : '';
        if (state.fallback === 'garbled') {
          // The graphics chip gave noise here: stay on the processor from now on (switching back
          // by hand checks again) and say why.
          state.runOn = 'cpu';
          keep('lectorLite.runOn', 'cpu');
          toast(fallbackText());
          const field = $('#run-on');
          if (field) field.outerHTML = renderRunOn();
        }
        return info;
      }, (err) => { ready = null; throw err; });
      return ready;
    },
    // Drop the loaded model (and the memory it holds); the next use loads it as now set.
    reset() {
      worker?.terminate();
      worker = null;
      ready = null;
      files.clear();
      listeners.forEach((fn) => fn({ type: 'reset' }));
      waiting.forEach((w) => w.reject(new Error('reset')));
      waiting.clear();
      state.device = null;
      state.fallback = '';
    },
    async generate(text, voice, speed) {
      await this.load();
      const id = ++seq;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        worker.postMessage({ type: 'generate', id, text, voice, speed });
      });
    },
  };
})();

// --- the device ---------------------------------------------------------------------------

// Browsers share little about the machine: WebGPU says only the vendor ("apple"), the chip
// name comes from WebGL (Chromium browsers name it, Safari says "Apple GPU"), memory only from
// Chromium browsers and never above 8 GB, the core count from all of them.
function gpuName(renderer) {
  // "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)" -> "Apple M3"
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11)"
  const angle = /^ANGLE \((.*)\)$/.exec(renderer);
  const name = angle ? angle[1].split(', ')[1] || '' : renderer;
  const clean = name.replace(/^ANGLE [^:]*: /, '').replace(/ \(0x[0-9a-f]+\)/i, '')
    .replace(/ (Direct3D|vs_|OpenGL|Vulkan).*$/, '').replace(/, or similar$/, '').trim();
  // Firefox reports every Apple chip as "Apple M1" to make machines harder to tell apart.
  return IS_FIREFOX && /^Apple M\d/.test(clean) ? 'Apple Silicon' : clean;
}

async function detectHardware() {
  let gpu = '';
  try {
    // Firefox names the chip in RENDERER (and deprecates the debug extension); Chrome and
    // Safari answer "WebKit WebGL" there and name it only through the extension.
    const gl = document.createElement('canvas').getContext('webgl');
    let renderer = gl?.getParameter(gl.RENDERER) || '';
    if (/^(WebKit WebGL|Mozilla)?$/i.test(renderer)) {
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      if (info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    }
    gpu = gpuName(renderer);
  } catch { /* no WebGL */ }
  let webgpu = false;
  try { webgpu = !!(await navigator.gpu?.requestAdapter()); } catch { /* no WebGPU */ }
  return { gpu, cores: navigator.hardwareConcurrency || 0, memory: navigator.deviceMemory || 0, webgpu };
}

function hardwareText(hw) {
  if (!hw) return '';
  return [
    hw.gpu,
    hw.memory ? `${hw.memory >= 8 ? '8+' : hw.memory} GB` : '',
    hw.cores ? t('hw.cores', { n: hw.cores }) : '',
    hw.webgpu ? 'WebGPU' : 'WebAssembly',
  ].filter(Boolean).join(' · ');
}

// --- the model download ----------------------------------------------------------------------

// "120 of 326 MB" while the model downloads, or '' when nothing is loading.
function downloadText(key) {
  const d = tts.download();
  if (!d) return '';
  const mb = (n) => Math.round(n / 1e6).toLocaleString(getLang());
  return t(key, { done: mb(d.loaded), total: mb(d.total) });
}

// The first preview downloads the whole model; without this banner nothing would seem to happen.
// The job view shows the same in its "Load model" step instead.
function updateModelBanner() {
  const d = tts.download();
  let el = $('#model-load');
  if (!d || (state.job && state.job.step === 'loading')) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'model-load';
    el.className = 'toast loading';
    $('#toasts').append(el);
  }
  el.innerHTML = `<strong>${esc(t('model.loading'))}</strong><span>${esc(downloadText('model.loadingMb'))}</span>
    <div class="progress"><div style="width:${((d.loaded / d.total) * 100).toFixed(1)}%"></div></div>`;
}
tts.onProgress(updateModelBanner);

// --- rendering --------------------------------------------------------------------------

function renderChip() {
  const chip = $('#tagline');
  chip.textContent = hardwareText(state.hw) || t('tagline');
  chip.title = state.hw ? `${t('tagline')}. ${t('hw.note')}` : '';
}

function render() {
  renderChip();
  $('#lang-toggle').textContent = t('lang.switch');
  $('#footer-version').textContent = `Lector Lite ${VERSION}`;
  const main = $('#view');
  if (state.job) main.innerHTML = renderJobView();
  else if (state.book) main.innerHTML = renderBook();
  else main.innerHTML = renderSource();
}

function renderSource() {
  const r = state.resume;
  return `<div>
    <div class="hero"><h1>${esc(t('hero.title'))}</h1><p>${esc(t('hero.lead'))}</p></div>
    ${r ? `<div class="card resume"><div><strong>${esc(t('resume.title'))}</strong>
      <div class="muted small">${esc(t('resume.text', { title: r.job.title, done: r.done, total: r.job.chapters.length }))}</div></div>
      <div class="done-actions"><button class="btn primary" data-action="resume">${esc(t('resume.go'))}</button>
      <button class="btn ghost danger" data-action="discard">${esc(t('resume.discard'))}</button></div></div>` : ''}
    <label class="drop" id="drop">
      <input type="file" id="file" accept=".epub,.txt,.md,.text,application/epub+zip,text/plain" hidden>
      <div class="drop-icon">${icon('upload')}</div>
      <strong>${esc(state.importing ? t('drop.reading', { name: state.importing }) : t('drop.title'))}</strong>
      <span>${esc(t('drop.hint'))}</span>
    </label>
    <div class="or">${esc(t('or'))}</div>
    ${state.pasteOpen ? `<div class="card paste-card">
      <label class="field"><span>${esc(t('paste.title'))}</span><input class="input" id="paste-title"></label>
      <textarea class="input" id="paste-text" placeholder="${esc(t('paste.placeholder'))}"></textarea>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" data-action="paste-go">${esc(t('paste.go'))}</button></div>
    </div>` : `<div style="text-align:center"><button class="btn" data-action="paste-open">${icon('text')} ${esc(t('paste.open'))}</button></div>`}
    <p class="lite-footer-note">${esc(t('full'))}</p>
  </div>`;
}

function coverHtml(url, title, cls = 'cover') {
  return url ? `<img class="${cls}" src="${url}" alt="">` : `<div class="${cls} placeholder">${esc((title || '').slice(0, 60))}</div>`;
}

function renderBook() {
  const b = state.book;
  const langs = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl'];
  if (!langs.includes(b.language)) langs.unshift(b.language);
  return `<div>
    <div class="book-head">
      ${coverHtml(b.coverUrl, b.title)}
      <div class="book-meta">
        <input class="inline-edit title" id="book-title" value="${esc(b.title)}" aria-label="Title">
        <input class="inline-edit author" id="book-author" value="${esc(b.author)}" aria-label="Author">
        <div class="book-facts"><span>${esc(t('book.language'))}</span>
          <select id="book-lang">${langs.map((l) => `<option value="${l}" ${l === b.language ? 'selected' : ''}>${esc(languageName(l))}</option>`).join('')}</select>
          <button class="link" data-action="other-book">${esc(t('book.other'))}</button></div>
        ${b.language !== 'en' ? `<div class="notice">${esc(t('book.notEnglish', { lang: languageName(b.language) }))}</div>` : ''}
      </div>
    </div>
    ${renderChapters()}
    <section class="section">
      <div class="section-head"><h2>${esc(t('voice'))}</h2></div>
      ${renderVoiceTools()}
      ${renderVoiceList()}
      <div class="settings-grid" style="margin-top:22px">
        <label class="field"><span>${esc(t('speed'))}</span>
          <div class="speed"><input type="range" id="speed" min="0.7" max="1.4" step="0.05" value="${state.speed}">
          <output id="speed-out">${state.speed.toFixed(2)}×</output></div></label>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>${esc(t('output'))}</h2></div>
      <div class="settings-grid">
        <div class="field"><span>Format</span><div class="segmented">${['m4b', 'mp3'].map((f) => `<button data-action="format" data-value="${f}" class="${f === state.format ? 'on' : ''}">${esc(t(`format.${f}`))} <small>${esc(t(`format.${f}.sub`))}</small></button>`).join('')}</div></div>
        <div class="field"><span>${esc(t('quality'))}</span><div class="segmented">${['48k', '64k', '96k'].map((q) => `<button data-action="bitrate" data-value="${q}" class="${q === state.bitrate ? 'on' : ''}">${esc(t(`quality.${q}`))} <small>${q}</small></button>`).join('')}</div></div>
        ${renderRunOn()}
      </div>
    </section>
    ${renderGo()}
  </div>`;
}

function renderChapter(c, i) {
  const on = state.selected.has(i);
  const open = state.open.has(i);
  const minutes = Math.max(1, Math.round(c.chars / CHARS_PER_SECOND / 60 / state.speed));
  return `<div class="chapter ${on ? '' : 'off'} ${open ? 'open' : ''}" data-index="${i}">
    <div class="chapter-row">
      <input type="checkbox" class="check" data-action="toggle-chapter" ${on ? 'checked' : ''} aria-label="include">
      <span class="num">${i + 1}</span>
      <input class="ctitle" data-role="chapter-title" value="${esc(state.titles[i] ?? c.title)}">
      <span class="cmeta">${esc(t('chapters.words', { n: c.words.toLocaleString(getLang()) }))} · ${minutes} min</span>
      <button class="icon-btn expand" data-action="expand" aria-label="${esc(t('chapters.show'))}">${icon('chevron')}</button>
    </div>
    ${open ? `<div class="chapter-preview">${esc(c.blocks.map((b) => b[1]).join('\n\n').slice(0, 3000))}</div>` : ''}
  </div>`;
}

function renderChapters() {
  const b = state.book;
  return `<section class="section">
    <div class="section-head"><h2>${esc(t('chapters'))} <span class="faint" id="chapter-count">· ${esc(t('chapters.selected', { n: state.selected.size, total: b.chapters.length }))}</span></h2>
      <div class="actions"><button class="link" data-action="select-all">${esc(t('chapters.all'))}</button>
      <button class="link" data-action="select-none">${esc(t('chapters.none'))}</button></div></div>
    <div class="card chapters">${b.chapters.map(renderChapter).join('')}</div>
  </section>`;
}

function renderVoiceTools() {
  const seg = (value, label) => `<button data-action="voice-gender" data-gender="${value}" class="${state.voiceGender === value ? 'on' : ''}">${esc(label)}</button>`;
  return `<div class="voice-tools">
    <input class="input" id="voice-query" type="search" placeholder="${esc(t('voices.search'))}" value="${esc(state.voiceQuery)}">
    <div class="segmented compact">${seg('', t('voices.all'))}${seg('female', t('voices.female'))}${seg('male', t('voices.male'))}</div>
    <select class="input compact" id="voice-accent" aria-label="${esc(t('voices.accent'))}">
      <option value="">${esc(t('voices.allAccents'))}</option>
      ${['us', 'gb'].map((a) => `<option value="${a}" ${a === state.voiceAccent ? 'selected' : ''}>${esc(t(`voices.accent.${a}`))}</option>`).join('')}
    </select>
    <select class="input compact" id="voice-sort" aria-label="${esc(t('voices.sort'))}">
      ${['recommended', 'name', 'accent'].map((o) => `<option value="${o}" ${o === state.voiceSort ? 'selected' : ''}>${esc(t(`voices.sort.${o}`))}</option>`).join('')}
    </select>
    <label class="toggle"><input type="checkbox" class="check" id="fav-only" ${state.favOnly ? 'checked' : ''}> ${esc(t('voices.favorites'))}</label>
  </div>`;
}

function shownVoices() {
  const q = state.voiceQuery.trim().toLowerCase();
  const list = VOICES.filter((v) => (!q || v.name.toLowerCase().includes(q))
    && (!state.voiceGender || v.gender === state.voiceGender)
    && (!state.voiceAccent || v.accent === state.voiceAccent)
    && (!state.favOnly || favorites.has(v.id)));
  const grade = (v) => GRADES.indexOf(v.grade);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const order = {
    recommended: (a, b) => (favorites.has(b.id) - favorites.has(a.id)) || grade(a) - grade(b) || byName(a, b),
    name: byName,
    accent: (a, b) => a.accent.localeCompare(b.accent) || grade(a) - grade(b) || byName(a, b),
  }[state.voiceSort] || byName;
  return list.sort(order);
}

function renderVoiceList() {
  const list = shownVoices();
  return `<div id="voice-list">
    <div class="voices-count faint small">${esc(t('voices.count', { n: list.length, total: VOICES.length }))}</div>
    ${list.length ? `<div class="voices">${list.map(renderVoice).join('')}</div>` : `<div class="empty">${esc(t('voices.noMatch'))}</div>`}
  </div>`;
}

function refreshVoices() {
  const el = $('#voice-list');
  if (el) el.outerHTML = renderVoiceList();
  markPlaying();
}

function renderVoice(v) {
  // Short accent codes, so "best" still fits on the narrow cards.
  const sub = [v.accent.toUpperCase(), t(`voice.${v.gender}`), v.best ? t('voice.best') : ''].filter(Boolean).join(' · ');
  const fav = favorites.has(v.id);
  return `<div class="voice ${v.id === state.voice ? 'on' : ''}" data-action="voice" data-voice="${v.id}" role="button" tabindex="0">
    <button class="star ${fav ? 'on' : ''}" data-action="favorite" data-voice="${v.id}" aria-label="${esc(t('voices.favorite'))}" aria-pressed="${fav}">${icon('star')}</button>
    <span class="vtext"><span class="vname">${esc(v.name)}</span><span class="vsub">${esc(sub)}</span></span>
    <button class="icon-btn play" data-action="preview" data-voice="${v.id}" aria-label="${esc(t('voice.play'))}">${icon('play')}</button>
  </div>`;
}

function renderRunOn() {
  if (!gpuOffered()) {
    return `<div class="field" id="run-on"><span>${esc(t('runOn'))}</span><span class="faint small">${esc(t('runOn.noGpu'))}</span></div>`;
  }
  const note = [t('runOn.note'), IS_FIREFOX ? t('runOn.firefox') : ''].filter(Boolean).join(' ');
  return `<div class="field" id="run-on"><span>${esc(t('runOn'))}</span><div class="segmented">${['gpu', 'cpu'].map((r) => `<button data-action="run-on" data-value="${r}" class="${r === state.runOn ? 'on' : ''}">${esc(t(`runOn.${r}`))} <small>${esc(t(`runOn.${r}.sub`))}</small></button>`).join('')}</div>
    <span class="faint small">${esc(note)}</span></div>`;
}

// What the model runs on and how fast it reads, measured while it reads.
function deviceText(j) {
  if (!state.device) return '';
  const speed = j.sessionSecs > 5 ? j.sessionAudio / j.sessionSecs : null;
  return [t(`model.device.${state.device}`),
    speed ? t('speed.realtime', { x: speed.toLocaleString(getLang(), { maximumFractionDigits: 1 }) }) : '']
    .filter(Boolean).join(' · ');
}

function fallbackText() {
  if (!state.fallback) return '';
  const why = ['no-adapter', 'no-webgpu', 'garbled'].includes(state.fallback) ? t(`runOn.why.${state.fallback}`) : state.fallback;
  return t('runOn.fallback', { why });
}

function selectedChars() {
  return state.book.chapters.reduce((n, c, i) => n + (state.selected.has(i) ? c.chars : 0), 0);
}

function renderGo() {
  const n = state.selected.size;
  const seconds = selectedChars() / CHARS_PER_SECOND / state.speed;
  const bytes = seconds * parseInt(state.bitrate, 10) * 125;
  const mb = MODEL_MB[state.runOn === 'gpu' ? 'webgpu' : 'wasm'];
  return `<div class="card go">
    <div class="summary"><strong>${esc(t('summary', { n, d: duration(seconds), s: fileSize(bytes) }))}</strong>
      <span class="muted small">${esc(t('model.note', { mb }))}</span></div>
    <button class="btn primary big" data-action="start" ${n ? '' : 'disabled'}>${esc(t('start'))}</button>
  </div>`;
}

function refreshGo() {
  const go = $('.go');
  if (go) go.outerHTML = renderGo();
  const count = $('#chapter-count');
  if (count) count.textContent = `· ${t('chapters.selected', { n: state.selected.size, total: state.book.chapters.length })}`;
}

// --- job view ---------------------------------------------------------------------------

const STEPS = ['loading', 'synth', 'export', 'done'];

function jobElapsed(j) {
  return j.runSeconds + (j.runStarted ? (Date.now() - j.runStarted) / 1000 : 0);
}

function remaining(j) {
  if (j.step === 'done') return 0;
  const cps = j.sessionSecs > 0 && j.sessionChars > 0 ? j.sessionChars / j.sessionSecs : null;
  const synth = cps ? (j.totalChars - j.doneChars) / cps : null;
  const exportSecs = (j.totalChars / CHARS_PER_SECOND / j.speed) / 400 + 5;
  if (j.step === 'export') return exportSecs * (1 - (j.exportProgress || 0));
  return synth == null ? null : synth + exportSecs;
}

function stepText(j, step, i, at) {
  if (step === 'done') return '';
  if (i < at) return j.stepSeconds[step] >= 1 ? duration(j.stepSeconds[step]) : '✓';
  if (i > at) return '';
  const spent = j.stepSeconds[step] + (j.stepStarted ? (Date.now() - j.stepStarted) / 1000 : 0);
  const download = step === 'loading' ? downloadText('step.downloadingMb') : '';
  if (download) return `${duration(spent)} · ${download}`;
  if (step === 'export') return `${duration(spent)} · ${Math.round((j.exportProgress || 0) * 100)} %`;
  return duration(spent);
}

function jobStatus(j) {
  if (j.step === 'done') return 'done';
  if (j.cancel) return 'deleting';
  if (j.error) return 'error';
  if (j.paused) return 'paused';
  return j.pauseRequested ? 'pausing' : 'running';
}

function summaryText(j) {
  if (j.step === 'done') return `${t('time.took', { d: duration(jobElapsed(j)) })} · ${duration(j.audioSeconds)} · ${fileSize(j.result?.size || 0)}`;
  // A pause or delete takes effect after the passage being read; say that it is on its way.
  if (j.cancel) return t('job.deleting');
  if (j.pauseRequested) return t('job.pausing');
  if (j.paused && j.step === 'loading' && tts.download()) return downloadText('job.pausedLoading');
  const left = j.paused || j.error ? null : remaining(j);
  return [t('time.runningFor', { d: duration(jobElapsed(j)) }), left != null ? t('time.left', { d: duration(left) }) : ''].filter(Boolean).join(' · ');
}

function jobActions(j, status) {
  const actions = [];
  if (status === 'deleting') return '';
  if (status === 'running' && j.step !== 'export') actions.push(`<button class="icon-btn" data-action="job-pause" title="${esc(t('job.pause'))}" aria-label="${esc(t('job.pause'))}">${icon('pause')}</button>`);
  if (status === 'paused' || status === 'error') actions.push(`<button class="btn" data-action="job-resume">${icon('resume')} ${esc(t(status === 'error' ? 'job.retry' : 'job.resume'))}</button>`);
  actions.push(`<button class="icon-btn" data-action="job-delete" title="${esc(t('job.delete'))}" aria-label="${esc(t('job.delete'))}">${icon('trash')}</button>`);
  return actions.join('');
}

function renderJobView() {
  const j = state.job;
  const at = STEPS.indexOf(j.step);
  const status = jobStatus(j);
  const pill = { running: 'accent', pausing: 'warn', deleting: 'warn', paused: 'warn', error: 'bad', done: 'ok' }[status];
  const sizes = j.chapters.map((c) => c.chars || 1);
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  let before = 0;
  const bar = j.chapters.map((c, i) => {
    const fill = c.done ? 1 : Math.min(1, Math.max(0, (j.doneChars - before) / sizes[i]));
    before += sizes[i];
    return `<div class="seg ${i === j.current && j.step === 'synth' ? 'current' : ''}" style="flex:${sizes[i] / total}" title="${esc(`${i + 1}. ${c.title}`)}"><div style="width:${(fill * 100).toFixed(1)}%"></div></div>`;
  }).join('');
  const steps = STEPS.map((step, i) => {
    const cls = i < at || j.step === 'done' ? 'done' : i === at ? 'current' : 'todo';
    return `<li class="step ${cls}"><span class="step-dot">${cls === 'done' ? icon('check') : ''}</span>
      <span class="step-text"><span class="step-name">${esc(t(`step.${step}`))}</span><span class="step-time" data-step="${step}">${esc(stepText(j, step, i, at))}</span></span></li>`;
  }).join('');
  return `<div>
    <div class="book-head">
      ${coverHtml(j.coverUrl, j.title)}
      <div class="book-meta"><div class="job-title" style="font-size:26px">${esc(j.title)}</div>
        <div class="job-sub">${esc([j.author, VOICES.find((v) => v.id === j.voice)?.name, 'Kokoro'].filter(Boolean).join(' · '))}</div></div>
    </div>
    <div class="card job-panel">
      ${j.step === 'done' ? `<h3>${esc(t('job.done'))}</h3>` : ''}
      <div class="job-status"><span class="pill ${pill}">${esc(t(`status.${status}`))}</span><span id="job-summary">${esc(summaryText(j))}</span></div>
      <ol class="steps">${steps}</ol>
      ${j.step !== 'done' ? `<div class="chapter-bar">${bar}</div>
        <div class="job-detail faint small">${esc(t('chapter.of', { c: Math.min(j.current + 1, j.chapters.length), n: j.chapters.length }))}</div>
        ${['running', 'pausing'].includes(status) ? `<div class="notice info">${esc(t('keep.open'))}</div>` : ''}` : ''}
      ${j.error ? `<div class="job-error">${esc(t('job.failed', { msg: j.error }))}</div>` : ''}
      ${j.step !== 'done' && state.fallback ? `<div class="notice">${esc(fallbackText())}</div>` : ''}
      <div class="row">
        ${j.step === 'done'
    ? `<div class="done-actions"><a class="btn primary" href="${j.resultUrl}" download="${esc(j.fileName)}">${icon('download')} ${esc(t('job.download'))}</a>
          ${navigator.canShare?.({ files: [new File([], 'x.m4b')] }) ? `<button class="btn" data-action="share">${icon('share')} ${esc(t('job.share'))}</button>` : ''}</div>
          <button class="btn ghost" data-action="new">${esc(t('job.new'))}</button>`
    : `<span class="faint small" id="job-device">${esc(deviceText(j))}</span>
          <div class="job-actions">${jobActions(j, status)}</div>`}
      </div>
    </div>
  </div>`;
}

function updateJobView() {
  if (!state.job) return;
  $('#view').innerHTML = renderJobView();
  updateTab();
}

// The tab shows the progress as a ring in place of the logo, like Lector does. A PNG, because
// Safari shows no SVG tab icons.
const BASE_ICON = 'favicon.png';
const ringCache = new Map();

function setFavicon(href) {
  const link = $('link[rel=icon]');
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
}

function progressIcon(pct) {
  if (!ringCache.has(pct)) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(128,128,128,.35)';
    g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4531a';
    g.lineCap = 'round';
    g.beginPath(); g.arc(32, 32, 25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, pct / 100)); g.stroke();
    ringCache.set(pct, c.toDataURL('image/png'));
  }
  return ringCache.get(pct);
}

function updateTab() {
  const j = state.job;
  if (!j || j.step === 'done' || j.paused || j.error) setFavicon(BASE_ICON);
  if (!j) { document.title = 'Lector Lite'; return; }
  if (j.step === 'done') {
    document.title = document.hidden ? `✓ ${t('tab.done', { title: j.title })} – Lector Lite` : 'Lector Lite';
    return;
  }
  if (j.paused || j.error) {
    document.title = `${t(`status.${jobStatus(j)}`)} · ${j.title} – Lector Lite`;
    return;
  }
  const left = remaining(j);
  const spent = jobElapsed(j);
  const pct = left != null && spent + left > 0 ? Math.round((spent / (spent + left)) * 100) : 0;
  document.title = `${pct} % · ${t(`step.${j.step}`)}${left != null ? ` · ${t('time.left', { d: duration(left) })}` : ''} – Lector Lite`;
  setFavicon(progressIcon(pct));
}

setInterval(() => {
  if (state.job && state.job.step !== 'done') {
    const j = state.job;
    const summary = $('#job-summary');
    if (summary) summary.textContent = summaryText(j);
    const device = $('#job-device');
    if (device) device.textContent = deviceText(j);
    const at = STEPS.indexOf(j.step);
    STEPS.forEach((step, i) => {
      const el = $(`[data-step="${step}"]`);
      if (el) el.textContent = stepText(j, step, i, at);
    });
    updateTab();
  }
}, 1000);

// --- screen wake lock: an iPad must not lock its screen in the middle of a book ---------

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed right now; try again when visible */ }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.job && state.job.step !== 'done') keepAwake(true);
  updateTab();
});

// --- the job ----------------------------------------------------------------------------

function newJob() {
  const b = state.book;
  const chapters = b.chapters.map((c, i) => ({ ...c, title: (state.titles[i] ?? c.title).trim() || c.title }))
    .filter((_, i) => state.selected.has(i))
    .map((c) => ({ title: c.title, blocks: c.blocks, chars: c.chars, done: false }));
  return {
    title: b.title, author: b.author, language: b.language, cover: b.cover,
    voice: state.voice, speed: state.speed, format: state.format, bitrate: state.bitrate,
    chapters, created: Date.now(),
  };
}

function runtime(saved, doneMap) {
  const chapters = saved.chapters.map((c, i) => ({ ...c, done: doneMap.has(i) }));
  const totalChars = chapters.reduce((n, c) => n + c.chars, 0);
  const doneChars = chapters.reduce((n, c) => n + (c.done ? c.chars : 0), 0);
  return {
    ...saved, chapters, totalChars, doneChars, current: chapters.findIndex((c) => !c.done),
    step: 'loading', stepSeconds: { loading: 0, synth: 0, export: 0 }, stepStarted: Date.now(),
    runSeconds: 0, runStarted: Date.now(), sessionChars: 0, sessionSecs: 0, sessionAudio: 0,
    download: null,
    coverUrl: saved.cover ? URL.createObjectURL(saved.cover) : '', cancel: false, error: '',
  };
}

function enterStep(j, step) {
  const now = Date.now();
  if (j.stepStarted && j.step in j.stepSeconds) j.stepSeconds[j.step] += (now - j.stepStarted) / 1000;
  j.step = step;
  j.stepStarted = step === 'done' ? null : now;
}

async function run(j, doneMap) {
  j.running = true;
  await keepAwake(true);
  updateJobView();
  try {
    // Load the voice model and the encoder; both download once and are then cached.
    // Pause and Delete act at once here: pausing lets the download go on in the background
    // (it is needed afterwards anyway), deleting stops it.
    const loading = Promise.all([tts.load(), loadEncoder()]);
    loading.catch(() => {});
    while (!await untilSignal(j, loading)) {
      if (j.cancel) throw new Error('cancelled');
      await pausePoint(j);
    }
    await loading;
    enterStep(j, 'synth');
    updateJobView();

    const codec = j.format === 'm4b' ? 'aac' : 'mp3';
    for (let ci = 0; ci < j.chapters.length; ci += 1) {
      const ch = j.chapters[ci];
      if (ch.done) continue;
      j.current = ci;
      updateJobView();
      const track = new PcmTrack();
      track.pause(CHAPTER_LEAD);
      const before = j.chapters.reduce((n, c) => n + (c.done ? c.chars : 0), 0);
      let read = 0;
      for (const chunk of planChunks(ch.blocks, MAX_CHARS)) {
        await pausePoint(j);
        if (j.cancel) throw new Error('cancelled');
        const t0 = performance.now();
        const { audio, rate } = await tts.generate(chunk.text, j.voice, j.speed);
        j.sessionSecs += (performance.now() - t0) / 1000;
        j.sessionChars += chunk.text.length;
        j.sessionAudio += audio.length / rate;
        track.add(audio);
        track.pause(chunk.pause);
        read += chunk.text.length;
        j.doneChars = before + Math.min(ch.chars, read);
        updateBar(j);
      }
      track.pause(CHAPTER_TAIL);
      const bytes = await encodeChapter(track, codec, j.bitrate, { title: ch.title, album: j.title, artist: j.author, track: `${ci + 1}/${j.chapters.length}` });
      await store.saveChapter(ci, { blob: new Blob([bytes], { type: codec === 'aac' ? 'audio/mp4' : 'audio/mpeg' }), seconds: track.seconds, title: ch.title });
      // Only the length stays in memory; the audio is in IndexedDB until the book is put together.
      doneMap.set(ci, { seconds: track.seconds, title: ch.title });
      ch.done = true;
      j.doneChars = j.chapters.reduce((n, c) => n + (c.done ? c.chars : 0), 0);
    }

    enterStep(j, 'export');
    j.exportProgress = 0;
    updateJobView();
    const saved = await store.loadChapters();
    const chapters = j.chapters.map((c, i) => {
      if (!saved.get(i)?.blob) throw new Error(t('err.chapterLost', { n: i + 1 }));
      return { ...saved.get(i), title: c.title };
    });
    j.audioSeconds = chapters.reduce((n, c) => n + c.seconds, 0);
    const base = safeName(j.author ? `${j.author} - ${j.title}` : j.title, 120);
    if (j.format === 'm4b') {
      j.result = await assembleM4B(chapters, {
        title: j.title, artist: j.author, album_artist: j.author, album: j.title, genre: 'Audiobook',
        comment: 'Read by Kokoro with Lector Lite',
      }, j.cover, (p) => { j.exportProgress = p; });
      j.fileName = `${base}.m4b`;
    } else {
      j.result = await zipChapters(chapters, base, j.cover);
      j.fileName = `${base}.zip`;
    }
    if (j.cancel) throw new Error('cancelled');
    if (j.runStarted) { j.runSeconds += (Date.now() - j.runStarted) / 1000; j.runStarted = null; }
    enterStep(j, 'done');
    await store.saveJob({ ...strip(j), finished: true, result: j.result, fileName: j.fileName,
      audioSeconds: j.audioSeconds, runSeconds: j.runSeconds });
    // Take the copy IndexedDB keeps on disk, so the book is not held in memory as well.
    j.result = (await store.loadJob())?.result || j.result;
    j.resultUrl = URL.createObjectURL(j.result);
  } catch (err) {
    if (j.runStarted) { j.runSeconds += (Date.now() - j.runStarted) / 1000; j.runStarted = null; }
    if (j.cancel) {
      if (!state.device) tts.reset(); // deleted while the model was still downloading: stop that
      await discardJob();
      return;
    }
    j.error = String(err?.message || err);
  } finally {
    j.running = false;
    await keepAwake(false);
    if (state.job === j) updateJobView();
  }
}

// Wait for `promise`, but come back early when Pause or Delete is pressed: true once it settled.
function untilSignal(j, promise) {
  return new Promise((resolve) => {
    j.signal = () => resolve(false);
    promise.then(() => resolve(true), () => resolve(true));
  }).finally(() => { j.signal = null; });
}

// Pause between passages: the clocks stop and the page may sleep until Continue is pressed.
async function pausePoint(j) {
  if (!j.pauseRequested || j.cancel) return;
  const now = Date.now();
  if (j.runStarted) { j.runSeconds += (now - j.runStarted) / 1000; j.runStarted = null; }
  if (j.stepStarted) { j.stepSeconds[j.step] += (now - j.stepStarted) / 1000; j.stepStarted = null; }
  j.pauseRequested = false;
  j.paused = true;
  await keepAwake(false);
  updateJobView();
  await new Promise((resolve) => { j.wake = resolve; });
  j.wake = null;
  j.paused = false;
  j.runStarted = Date.now();
  j.stepStarted = Date.now();
  if (!j.cancel) await keepAwake(true);
  updateJobView();
}

async function discardJob() {
  await store.clear();
  state.job = null;
  state.resume = null;
  render();
  updateTab();
}

function updateBar(j) {
  const segs = $$('.chapter-bar .seg');
  if (!segs.length) return;
  let before = 0;
  j.chapters.forEach((c, i) => {
    const fill = c.done ? 1 : Math.min(1, Math.max(0, (j.doneChars - before) / (c.chars || 1)));
    before += c.chars || 1;
    const inner = segs[i]?.firstElementChild;
    if (inner) inner.style.width = `${(fill * 100).toFixed(1)}%`;
  });
}

const strip = (j) => ({
  title: j.title, author: j.author, language: j.language, cover: j.cover, voice: j.voice,
  speed: j.speed, format: j.format, bitrate: j.bitrate, created: j.created,
  chapters: j.chapters.map(({ title, blocks, chars }) => ({ title, blocks, chars })),
});

async function startJob() {
  await store.clear();
  const saved = newJob();
  await store.saveJob(saved);
  state.job = runtime(saved, new Map());
  run(state.job, new Map());
}

async function resumeJob() {
  const saved = await store.loadJob();
  if (!saved) return;
  const doneMap = await store.loadChapters();
  if (saved.finished) {
    state.job = { ...runtime(saved, doneMap), step: 'done', result: saved.result, fileName: saved.fileName,
      resultUrl: URL.createObjectURL(saved.result), audioSeconds: saved.audioSeconds, runSeconds: saved.runSeconds, runStarted: null };
    render();
    return;
  }
  state.job = runtime(saved, doneMap);
  run(state.job, doneMap);
}

async function loadResume() {
  const saved = await store.loadJob();
  if (!saved) { state.resume = null; return; }
  const done = (await store.loadChapters()).size;
  state.resume = { job: saved, done: saved.finished ? saved.chapters.length : done, finished: !!saved.finished };
}

// --- book import --------------------------------------------------------------------------

function setBook(book) {
  if (!book.chapters.length || !book.chapters.some((c) => c.words)) throw new Error(t('err.empty'));
  book.coverUrl = book.cover ? URL.createObjectURL(book.cover) : '';
  state.book = book;
  state.selected = new Set(book.chapters.map((c, i) => (c.include ? i : -1)).filter((i) => i >= 0));
  state.titles = {};
  state.open = new Set();
  state.format = book.chapters.length > 1 ? 'm4b' : 'mp3';
  render();
  window.scrollTo({ top: 0 });
}

async function importFile(file) {
  if (!file) return;
  state.importing = file.name;
  render();
  try {
    setBook(await parseFile(file));
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    state.importing = '';
    if (!state.book) render();
  }
}

// --- previews -----------------------------------------------------------------------------

let playing = null;
const samples = new Map(); // `${voice}|${speed}|${lang}` -> blob URL of a finished preview
let silence = null;

// Browsers let audio start only shortly after a click, and the first preview may first spend a
// minute or more downloading the model. Playing a moment of silence right in the click unlocks
// the player for later; should a browser still refuse, the finished sample waits for a second click.
function unlockPlayer(player) {
  silence ??= URL.createObjectURL(wav(new Int16Array(2400)));
  player.src = silence;
  player.play().catch(() => {});
}

async function preview(voice, btn) {
  const player = $('#player');
  if (playing === voice) { player.pause(); playing = null; markPlaying(); return; }
  player.pause();
  playing = null;
  markPlaying();
  const key = `${voice}|${state.speed}|${getLang()}`;
  if (!samples.has(key)) unlockPlayer(player);
  btn.classList.add('busy');
  try {
    if (!samples.has(key)) {
      const { audio } = await tts.generate(t('voice.sample'), voice, state.speed);
      samples.set(key, URL.createObjectURL(wav(audio)));
    }
    player.src = samples.get(key);
    playing = voice;
    try {
      await player.play();
    } catch (err) {
      playing = null;
      if (err?.name !== 'NotAllowedError') throw err;
      toast(t('voice.tapAgain'));
    }
    markPlaying();
    refreshGo();
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    btn.classList.remove('busy');
  }
}

function markPlaying() {
  $$('[data-action="preview"]').forEach((b) => {
    b.classList.toggle('playing', b.dataset.voice === playing);
    b.innerHTML = icon(b.dataset.voice === playing ? 'stop' : 'play');
  });
}

// --- events -------------------------------------------------------------------------------

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (['preview', 'expand', 'favorite'].includes(action)) ev.preventDefault();
  const chapterEl = el.closest('.chapter');
  const index = chapterEl ? Number(chapterEl.dataset.index) : null;
  try {
    switch (action) {
      case 'paste-open': state.pasteOpen = true; render(); $('#paste-text')?.focus(); break;
      case 'paste-go': {
        const text = $('#paste-text').value;
        if (text.trim()) setBook(parseText(text, $('#paste-title').value));
        break;
      }
      case 'other-book': state.book = null; render(); break;
      case 'toggle-chapter':
        if (el.checked) state.selected.add(index); else state.selected.delete(index);
        chapterEl.classList.toggle('off', !el.checked);
        refreshGo();
        break;
      case 'select-all':
      case 'select-none':
        state.selected = action === 'select-all' ? new Set(state.book.chapters.map((_, i) => i)) : new Set();
        $$('.chapter').forEach((c) => {
          const on = state.selected.has(Number(c.dataset.index));
          c.classList.toggle('off', !on);
          $('.check', c).checked = on;
        });
        refreshGo();
        break;
      case 'expand':
        if (state.open.has(index)) state.open.delete(index); else state.open.add(index);
        chapterEl.outerHTML = renderChapter(state.book.chapters[index], index);
        break;
      case 'voice':
        state.voice = el.dataset.voice;
        $$('.voice').forEach((v) => v.classList.toggle('on', v === el));
        break;
      case 'preview': await preview(el.dataset.voice, el); break;
      case 'favorite':
        toggleFavorite(el.dataset.voice);
        if (state.favOnly) refreshVoices();
        else {
          const on = favorites.has(el.dataset.voice);
          el.classList.toggle('on', on);
          el.setAttribute('aria-pressed', String(on));
        }
        break;
      case 'voice-gender':
        state.voiceGender = el.dataset.gender;
        $$('[data-action="voice-gender"]').forEach((b) => b.classList.toggle('on', b === el));
        refreshVoices();
        break;
      case 'format':
      case 'bitrate':
        state[action] = el.dataset.value;
        $$(`[data-action="${action}"]`).forEach((b) => b.classList.toggle('on', b === el));
        refreshGo();
        break;
      case 'start': await startJob(); break;
      case 'job-pause':
        state.job.pauseRequested = true;
        state.job.signal?.();
        updateJobView();
        break;
      case 'job-resume': {
        const j = state.job;
        if (j.paused) j.wake();
        else if (j.error && !j.running) { state.resume = null; await resumeJob(); }
        break;
      }
      case 'job-delete': {
        if (!await ask({ title: t('job.deleteTitle', { title: state.job.title }), message: t('job.deleteText'), confirm: t('job.delete'), danger: true })) break;
        const j = state.job;
        if (!j) break;
        if (!j.running) { await discardJob(); break; }
        j.cancel = true;
        j.pauseRequested = false;
        j.wake?.();
        j.signal?.();
        updateJobView();
        break;
      }
      case 'run-on':
        state.runOn = el.dataset.value;
        keep('lectorLite.runOn', state.runOn);
        $$('[data-action="run-on"]').forEach((b) => b.classList.toggle('on', b === el));
        if (state.device && state.device !== (state.runOn === 'cpu' ? 'wasm' : 'webgpu')) tts.reset();
        refreshGo();
        break;
      case 'resume':
        state.resume = null;
        await resumeJob();
        break;
      case 'discard':
        if (await ask({ title: t('resume.discardTitle'), message: t('resume.discardText'), confirm: t('resume.discard'), danger: true })) {
          await store.clear();
          state.resume = null;
          render();
        }
        break;
      case 'share': {
        const j = state.job;
        await navigator.share({ files: [new File([j.result], j.fileName, { type: j.result.type })], title: j.title });
        break;
      }
      case 'new':
        await store.clear();
        state.job = null;
        state.book = null;
        state.resume = null;
        render();
        break;
      default: break;
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast(errorText(err), 'error');
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'book-title') state.book.title = el.value;
  else if (el.id === 'book-author') state.book.author = el.value;
  else if (el.dataset.role === 'chapter-title') state.titles[Number(el.closest('.chapter').dataset.index)] = el.value;
  else if (el.id === 'voice-query') { state.voiceQuery = el.value; refreshVoices(); }
  else if (el.id === 'speed') {
    state.speed = Number(el.value);
    $('#speed-out').textContent = `${state.speed.toFixed(2)}×`;
    refreshGo();
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.id === 'file') importFile(el.files[0]);
  else if (el.id === 'book-lang') { state.book.language = el.value; render(); }
  else if (el.id === 'voice-accent') { state.voiceAccent = el.value; refreshVoices(); }
  else if (el.id === 'voice-sort') { state.voiceSort = el.value; refreshVoices(); }
  else if (el.id === 'fav-only') { state.favOnly = el.checked; refreshVoices(); }
});

document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList?.contains('voice')) { ev.preventDefault(); ev.target.click(); }
});

['dragenter', 'dragover'].forEach((type) => document.addEventListener(type, (ev) => {
  if (state.book || state.job) return;
  ev.preventDefault();
  $('#drop')?.classList.add('over');
}));
['dragleave', 'drop'].forEach((type) => document.addEventListener(type, (ev) => {
  if (state.book || state.job) return;
  ev.preventDefault();
  if (type === 'dragleave' && ev.relatedTarget) return;
  $('#drop')?.classList.remove('over');
  if (type === 'drop') importFile(ev.dataTransfer.files[0]);
}));

$('#player').addEventListener('ended', () => { playing = null; markPlaying(); });
$('#lang-toggle').addEventListener('click', () => { setLang(getLang() === 'de' ? 'en' : 'de'); render(); });

setLang(getLang());
await loadResume();
render();
// Probing the graphics chip makes Firefox lay the page out, so it waits until the page has
// loaded; then only the parts that depend on it change, not text being typed.
const loaded = document.readyState === 'complete' ? Promise.resolve()
  : new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
loaded.then(detectHardware).then((hw) => {
  state.hw = hw;
  renderChip();
  const runOn = $('#run-on');
  if (runOn) runOn.outerHTML = renderRunOn();
}, () => {});
