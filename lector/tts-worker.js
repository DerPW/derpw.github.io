// Kokoro speech synthesis in a Web Worker, so the page stays responsive while it reads.
//
// Messages in:  {type: 'load', prefer?: 'wasm'} | {type: 'generate', id, text, voice, speed}
// Messages out: {type: 'progress', file, loaded, total} while the model downloads,
//               {type: 'ready', device, fallback?} | {type: 'audio', id, audio (Int16Array), rate}
//               | {type: 'error', id?, message}
//
// WebGPU is used where the browser offers it (fp32 weights, recommended for WebGPU),
// otherwise, or when asked to save memory, WebAssembly with 8-bit weights. Weights and
// voices are cached by the browser. Audio goes out as 16-bit samples, half the size of floats.

const KOKORO = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// Free GPU buffers ONNX Runtime may keep per size class above 1 MB (it allows up to 50).
const KEEP_FREE = 1;
const BIG = 1 << 20;
let KokoroTTS = null;
let tts = null;
// Why WebGPU was not used although it was wanted: 'no-adapter' (the browser offers WebGPU but
// hands out no graphics adapter, as Firefox does on some machines) or the loader's error.
let fallback = '';
let device = 'wasm';

async function hasWebGPU() {
  if (!self.navigator?.gpu) return false;
  try {
    return !!(await self.navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// The loader reports every network chunk: thousands of messages for the model, enough to choke
// the page (clicks and dialogs answered seconds late). A few a second is plenty to show.
let lastProgress = 0;
function progress(info) {
  if (info?.status !== 'progress' || !info.total) return;
  const now = performance.now();
  if (now - lastProgress < 250 && info.loaded < info.total) return;
  lastProgress = now;
  self.postMessage({ type: 'progress', file: info.file, loaded: info.loaded, total: info.total });
}

// ONNX Runtime keeps freed GPU buffers for reuse, by size class: up to six of 160 MB, six of
// 128 MB, 22 of 32 MB and so on, several gigabytes in all. Kokoro's buffer sizes change with
// every passage, so that cache fills up within a minute and takes 2-3 GB on top of the model:
// enough to make Safari reload the tab, or an 8 GB Mac stall. The size table sits in the
// bundled runtime, so the bundle is fetched, the table capped, and the copy imported. Should
// the table ever not be found, the library loads as published.
function capBufferCache(table) {
  const pairs = JSON.parse(table.slice('new Map('.length, -1));
  return `new Map(${JSON.stringify(pairs.map(([size, count]) => [size, size > BIG ? Math.min(count, KEEP_FREE) : count]))})`;
}

async function importKokoro() {
  try {
    const source = await (await fetch(KOKORO)).text();
    const patched = source.replace(/new Map\(\[\[64,250\],[\d,[\]]+\]\]\)/, capBufferCache);
    if (patched !== source) return await import(URL.createObjectURL(new Blob([patched], { type: 'text/javascript' })));
  } catch { /* use the library as published */ }
  return import(KOKORO);
}

async function load(prefer) {
  if (tts) return;
  ({ KokoroTTS } = await importKokoro());
  const tries = [];
  fallback = '';
  if (prefer !== 'wasm') {
    if (await hasWebGPU()) tries.push(['webgpu', 'fp32']);
    else fallback = self.navigator?.gpu ? 'no-adapter' : 'no-webgpu';
  }
  tries.push(['wasm', 'q8']);
  let last;
  for (const [dev, dtype] of tries) {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL, { dtype, device: dev, progress_callback: progress });
      device = dev;
      return;
    } catch (err) {
      last = err;
      if (dev === 'webgpu') fallback = String(err?.message || err).slice(0, 200);
    }
  }
  throw last;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(data.prefer);
      self.postMessage({ type: 'ready', device, fallback });
    } else if (data.type === 'generate') {
      await load();
      const out = await tts.generate(data.text, { voice: data.voice, speed: data.speed || 1 });
      const audio = toInt16(out.audio);
      self.postMessage({ type: 'audio', id: data.id, audio, rate: out.sampling_rate }, [audio.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message || err) });
  }
};
