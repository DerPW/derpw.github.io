// Lector Lite: EPUB or text in, an audiobook out, read by Kokoro entirely in the browser.
//
// Flow: import -> pick chapters, voice, speed, format -> read chapter by chapter in a Web
// Worker (Kokoro) -> encode each chapter right away (ffmpeg.wasm) and keep it in IndexedDB
// -> put the M4B together (or zip the MP3s) -> download or share.

import { parseFile, parseText } from './book.js';
import { planChunks } from './textprep.js';
import { RATE, assembleM4B, encodeChapter, load as loadEncoder, safeName, wav, zipChapters } from './encoder.js';
import * as store from './store.js';
import { duration, fileSize, getLang, languageName, setLang, t } from './i18n.js';

const VERSION = '0.8.1'; // keep in step with src/lector/__init__.py
const MAX_CHARS = 300; // Kokoro cuts off input beyond about 510 phoneme tokens
const CHARS_PER_SECOND = 15; // spoken characters per second of audio, for estimates
const CHAPTER_LEAD = 0.5;
const CHAPTER_TAIL = 1.5;
const MODEL_MB = { webgpu: 330, wasm: 90 };

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
  device: null,
  job: null, // the running or finished job (see startJob)
  resume: null,
};

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

  function start() {
    worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress' || data.type === 'ready') listeners.forEach((fn) => fn(data));
      if (data.type === 'ready') waiting.get('load')?.resolve(data);
      if (data.type === 'audio') waiting.get(data.id)?.resolve(data);
      if (data.type === 'error') (waiting.get(data.id ?? 'load') || waiting.get('load'))?.reject(new Error(data.message));
      if (data.type !== 'progress' && waiting.has(data.id ?? 'load')) waiting.delete(data.id ?? 'load');
    };
  }

  return {
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    load() {
      if (!worker) start();
      ready ??= new Promise((resolve, reject) => {
        waiting.set('load', { resolve, reject });
        worker.postMessage({ type: 'load' });
      }).then((info) => { state.device = info.device; return info; }, (err) => { ready = null; throw err; });
      return ready;
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

// --- rendering --------------------------------------------------------------------------

function render() {
  $('#tagline').textContent = t('tagline');
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
      <div class="voices">${VOICES.map(renderVoice).join('')}</div>
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

function renderVoice(v) {
  const sub = [t(`voice.${v.accent}`), t(`voice.${v.gender}`), v.best ? t('voice.best') : ''].filter(Boolean).join(' · ');
  return `<div class="voice ${v.id === state.voice ? 'on' : ''}" data-action="voice" data-voice="${v.id}" role="button" tabindex="0">
    <span class="vtext"><span class="vname">${esc(v.name)}</span><span class="vsub">${esc(sub)}</span></span>
    <button class="icon-btn play" data-action="preview" data-voice="${v.id}" aria-label="${esc(t('voice.play'))}">${icon('play')}</button>
  </div>`;
}

function selectedChars() {
  return state.book.chapters.reduce((n, c, i) => n + (state.selected.has(i) ? c.chars : 0), 0);
}

function renderGo() {
  const n = state.selected.size;
  const seconds = selectedChars() / CHARS_PER_SECOND / state.speed;
  const bytes = seconds * parseInt(state.bitrate, 10) * 125;
  const mb = MODEL_MB[state.device || 'wasm'];
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
  if (step === 'loading' && j.download) return `${duration(spent)} · ${t('step.downloading', { p: j.download })}`;
  if (step === 'export') return `${duration(spent)} · ${Math.round((j.exportProgress || 0) * 100)} %`;
  return duration(spent);
}

function renderJobView() {
  const j = state.job;
  const at = STEPS.indexOf(j.step);
  const left = remaining(j);
  const sizes = j.chapters.map((c) => c.chars || 1);
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  let before = 0;
  const bar = j.chapters.map((c, i) => {
    const fill = c.done ? 1 : Math.min(1, Math.max(0, (j.doneChars - before) / sizes[i]));
    before += sizes[i];
    return `<div class="seg ${i === j.current && j.step === 'synth' ? 'current' : ''}" style="flex:${sizes[i] / total}" title="${esc(`${i + 1}. ${c.title}`)}"><div style="width:${(fill * 100).toFixed(1)}%"></div></div>`;
  }).join('');
  const summary = j.step === 'done'
    ? `${t('time.took', { d: duration(jobElapsed(j)) })} · ${duration(j.audioSeconds)} · ${fileSize(j.result?.size || 0)}`
    : [t('time.runningFor', { d: duration(jobElapsed(j)) }), left != null ? t('time.left', { d: duration(left) }) : ''].filter(Boolean).join(' · ');
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
      <div class="job-status"><span id="job-summary">${esc(summary)}</span></div>
      <ol class="steps">${steps}</ol>
      ${j.step !== 'done' ? `<div class="chapter-bar">${bar}</div>
        <div class="job-detail faint small">${esc(t('chapter.of', { c: Math.min(j.current + 1, j.chapters.length), n: j.chapters.length }))}</div>
        <div class="notice info">${esc(t('keep.open'))}</div>` : ''}
      ${j.error ? `<div class="job-error">${esc(t('job.failed', { msg: j.error }))}</div>` : ''}
      <div class="row">
        ${j.step === 'done'
    ? `<div class="done-actions"><a class="btn primary" href="${j.resultUrl}" download="${esc(j.fileName)}">${icon('download')} ${esc(t('job.download'))}</a>
          ${navigator.canShare?.({ files: [new File([], 'x.m4b')] }) ? `<button class="btn" data-action="share">${icon('share')} ${esc(t('job.share'))}</button>` : ''}</div>
          <button class="btn ghost" data-action="new">${esc(t('job.new'))}</button>`
    : `<span class="faint small">${esc(state.device ? t(`model.device.${state.device}`) : '')}</span>
          ${j.error ? `<button class="btn primary" data-action="resume-job">${esc(t('resume.go'))}</button>` : `<button class="btn ghost danger" data-action="cancel">${icon('stop')} ${esc(t('job.cancel'))}</button>`}`}
      </div>
    </div>
  </div>`;
}

function updateJobView() {
  if (!state.job) return;
  $('#view').innerHTML = renderJobView();
  updateTab();
}

function updateTab() {
  const j = state.job;
  if (!j) { document.title = 'Lector Lite'; return; }
  if (j.step === 'done') {
    document.title = document.hidden ? `✓ ${t('tab.done', { title: j.title })} – Lector Lite` : 'Lector Lite';
    return;
  }
  const left = remaining(j);
  const spent = jobElapsed(j);
  const pct = left != null && spent + left > 0 ? Math.round((spent / (spent + left)) * 100) : 0;
  document.title = `${pct} % · ${t(`step.${j.step}`)}${left != null ? ` · ${t('time.left', { d: duration(left) })}` : ''} – Lector Lite`;
}

setInterval(() => {
  if (state.job && state.job.step !== 'done') {
    const j = state.job;
    const summary = $('#job-summary');
    const left = remaining(j);
    if (summary) summary.textContent = [t('time.runningFor', { d: duration(jobElapsed(j)) }), left != null ? t('time.left', { d: duration(left) }) : ''].filter(Boolean).join(' · ');
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
    runSeconds: 0, runStarted: Date.now(), sessionChars: 0, sessionSecs: 0, download: null,
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
  await keepAwake(true);
  updateJobView();
  try {
    // Load the voice model and the encoder; both download once and are then cached.
    const stop = tts.onProgress((p) => {
      if (p.type === 'progress' && p.total > 5e6) { j.download = Math.round((p.loaded / p.total) * 100); }
    });
    await Promise.all([tts.load(), loadEncoder()]);
    stop();
    j.download = null;
    enterStep(j, 'synth');
    updateJobView();

    const codec = j.format === 'm4b' ? 'aac' : 'mp3';
    for (let ci = 0; ci < j.chapters.length; ci += 1) {
      const ch = j.chapters[ci];
      if (ch.done) continue;
      j.current = ci;
      updateJobView();
      const parts = [new Float32Array(Math.round(CHAPTER_LEAD * RATE))];
      const before = j.chapters.reduce((n, c) => n + (c.done ? c.chars : 0), 0);
      let read = 0;
      for (const chunk of planChunks(ch.blocks, MAX_CHARS)) {
        if (j.cancel) throw new Error('cancelled');
        const t0 = performance.now();
        const { audio } = await tts.generate(chunk.text, j.voice, j.speed);
        j.sessionSecs += (performance.now() - t0) / 1000;
        j.sessionChars += chunk.text.length;
        parts.push(audio, new Float32Array(Math.round(chunk.pause * RATE)));
        read += chunk.text.length;
        j.doneChars = before + Math.min(ch.chars, read);
        updateBar(j);
      }
      parts.push(new Float32Array(Math.round(CHAPTER_TAIL * RATE)));
      const samples = concat(parts);
      const bytes = await encodeChapter(samples, codec, j.bitrate, { title: ch.title, album: j.title, artist: j.author, track: `${ci + 1}/${j.chapters.length}` });
      const record = { blob: new Blob([bytes], { type: codec === 'aac' ? 'audio/mp4' : 'audio/mpeg' }), seconds: samples.length / RATE, title: ch.title };
      await store.saveChapter(ci, record);
      doneMap.set(ci, record);
      ch.done = true;
      j.doneChars = j.chapters.reduce((n, c) => n + (c.done ? c.chars : 0), 0);
    }

    enterStep(j, 'export');
    j.exportProgress = 0;
    updateJobView();
    const chapters = j.chapters.map((c, i) => ({ ...doneMap.get(i), title: c.title }));
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
    j.resultUrl = URL.createObjectURL(j.result);
    if (j.runStarted) { j.runSeconds += (Date.now() - j.runStarted) / 1000; j.runStarted = null; }
    enterStep(j, 'done');
    await store.saveJob({ ...strip(j), finished: true, result: j.result, fileName: j.fileName,
      audioSeconds: j.audioSeconds, runSeconds: j.runSeconds });
  } catch (err) {
    if (j.runStarted) { j.runSeconds += (Date.now() - j.runStarted) / 1000; j.runStarted = null; }
    if (String(err?.message) === 'cancelled') {
      state.job = null;
      await loadResume();
      render();
    } else {
      j.error = String(err?.message || err);
    }
  } finally {
    await keepAwake(false);
    if (state.job) updateJobView();
  }
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

function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
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
async function preview(voice, btn) {
  const player = $('#player');
  if (playing === voice) { player.pause(); playing = null; markPlaying(); return; }
  player.pause();
  playing = null;
  markPlaying();
  btn.classList.add('busy');
  try {
    const { audio } = await tts.generate(t('voice.sample'), voice, state.speed);
    player.src = URL.createObjectURL(new Blob([wav(audio)], { type: 'audio/wav' }));
    playing = voice;
    await player.play();
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
  if (['preview', 'expand'].includes(action)) ev.preventDefault();
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
      case 'format':
      case 'bitrate':
        state[action] = el.dataset.value;
        $$(`[data-action="${action}"]`).forEach((b) => b.classList.toggle('on', b === el));
        refreshGo();
        break;
      case 'start': await startJob(); break;
      case 'cancel':
        if (await ask({ title: t('job.cancelTitle'), message: t('job.cancelText'), confirm: t('job.cancel') })) {
          state.job.cancel = true;
        }
        break;
      case 'resume':
      case 'resume-job':
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
