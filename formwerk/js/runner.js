// Verwaltet den OpenSCAD-Worker: WebAssembly einmal laden und kompilieren,
// Aufträge nacheinander abarbeiten, laufende Aufträge abbrechen können.

import { WASM_SIZE } from '../vendor/openscad/version.js';

const WASM_URL = new URL('../vendor/openscad/openscad.wasm', import.meta.url);
const WORKER_URL = new URL('./worker.js', import.meta.url);

export class Runner extends EventTarget {
  constructor() {
    super();
    this.module = null;
    this.worker = null;
    this.ready = null;
    this.current = null;   // { id, job, resolve, started }
    this.pending = null;   // nächster Auftrag (ersetzt ältere)
    this.queue = [];       // Exporte: werden nie ersetzt
    this.seq = 0;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // Lädt das WebAssembly mit Fortschritt und kompiliert es einmal.
  async load() {
    if (this.module) return;
    const res = await fetch(WASM_URL);
    if (!res.ok) throw new Error(`OpenSCAD konnte nicht geladen werden (${res.status})`);
    let bytes;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        this.emit('progress', { loaded: got, total: WASM_SIZE });
      }
      bytes = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { bytes.set(c, o); o += c.length; }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    this.emit('progress', { loaded: WASM_SIZE, total: WASM_SIZE, compiling: true });
    this.module = await WebAssembly.compile(bytes);
    this.spawn();
    await this.ready;
  }

  spawn() {
    this.worker?.terminate();
    const w = new Worker(WORKER_URL, { type: 'module' });
    this.worker = w;
    let started = false;
    let fail;
    this.ready = new Promise((resolve, reject) => {
      fail = reject;
      const onMsg = ({ data }) => {
        if (data.type === 'ready') { started = true; w.removeEventListener('message', onMsg); resolve(); }
      };
      w.addEventListener('message', onMsg);
    });
    this.ready.catch(() => {});
    w.addEventListener('message', ({ data }) => {
      if (data.type === 'result') this.finish(data.id, data.result);
    });
    w.addEventListener('error', (e) => {
      e.preventDefault?.();
      if (!started) { fail(new Error(e.message || 'Der OpenSCAD-Thread konnte nicht starten.')); return; }
      if (w !== this.worker) return;
      const cur = this.current;
      this.spawn();
      if (cur) this.finish(cur.id, { type: 'render', ok: false, crashed: true, logs: [`ERROR: Der OpenSCAD-Thread ist abgestürzt (${e.message || 'unbekannt'}).`] });
    });
    w.postMessage({ type: 'init', module: this.module });
  }

  get busy() { return !!this.current; }

  // Stellt einen Auftrag ein. Ein noch wartender älterer Auftrag wird ersetzt
  // (sein Promise liefert dann { superseded: true }).
  request(job, { preempt = 0, exclusive = false } = {}) {
    return new Promise((resolve) => {
      if (exclusive) {
        this.queue.push({ job, resolve });
        if (!this.current) this.next();
        return;
      }
      if (this.pending) this.pending.resolve({ superseded: true });
      this.pending = { job, resolve };
      if (!this.current) this.next();
      else if (preempt && performance.now() - this.current.started > preempt && !this.current.job.export) {
        // Laufender Auftrag ist veraltet und dauert schon länger → abbrechen
        this.abortCurrent({ superseded: true });
        this.next();
      }
    });
  }

  async next() {
    if (this.current || (!this.pending && !this.queue.length)) return;
    let item;
    if (this.queue.length) item = this.queue.shift();
    else { item = this.pending; this.pending = null; }
    const { job, resolve } = item;
    const id = ++this.seq;
    this.current = { id, job, resolve, started: performance.now() };
    this.emit('busy', { busy: true, job });
    try { await this.ready; } catch (e) {
      this.finish(id, { type: 'render', ok: false, crashed: true, logs: [`ERROR: ${e.message}`] });
      return;
    }
    if (this.current?.id === id) this.worker.postMessage({ type: 'job', id, job });
  }

  finish(id, result) {
    if (!this.current || this.current.id !== id) return;
    const { resolve } = this.current;
    this.current = null;
    this.emit('busy', { busy: false });
    resolve(result);
    this.next();
  }

  abortCurrent(result = { cancelled: true }) {
    if (!this.current) return false;
    const { resolve } = this.current;
    this.current = null;
    this.spawn();
    this.emit('busy', { busy: false });
    resolve(result);
    return true;
  }

  // Bricht alles ab (Esc / Abbrechen-Knopf).
  cancel() {
    if (this.pending) { this.pending.resolve({ cancelled: true }); this.pending = null; }
    for (const q of this.queue.splice(0)) q.resolve({ cancelled: true });
    return this.abortCurrent();
  }
}
