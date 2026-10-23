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

// --- self-test: does the graphics chip really speak? ---------------------------------------
//
// Some browser and graphics chip pairs run the model on WebGPU without an error but return noise
// and crackle (seen in Zen, a Firefox fork). So after loading on WebGPU a short sentence is read
// and compared with how it sounds when all is well: the loudness curve (25 ms frames, log RMS,
// measured in Chrome on an M3; WebAssembly gives the same curve), the length, how often loud
// passages cross zero (speech about 0.15, noise 0.5), and no clipped or invalid samples.
const CHECK_TEXT = 'Hello, this is a quick test.';
const CHECK_VOICE = 'af_heart';
const CHECK_CURVE = [
  -4, -4, -4, -4, -4, -4, -4, -4, -3.95, -3.8, -3.48, -2.79, -2.07, -1.7, -0.85, -0.8, -0.88,
  -0.91, -0.85, -0.81, -0.8, -0.83, -0.84, -0.82, -0.84, -0.89, -0.96, -1.02, -1.01, -1.29,
  -1.55, -1.43, -0.85, -0.86, -1.03, -1.27, -1.23, -1.54, -1.1, -1.16, -1.27, -1.18, -0.97,
  -1.4, -2.45, -1.96, -1.78, -1.8, -0.93, -1.09, -1.49, -2.7, -2.47, -2.99, -1.87, -1.43,
  -1.67, -1.07, -1.03, -1.09, -1.29, -1.55, -1.72, -1.85, -1.59, -1.49, -1.49, -1.39, -1.69,
  -2.43, -1.6, -2.45, -3.21, -3.44, -3.55, -3.56, -3.73, -3.89, -3.96, -3.96, -3.99, -4, -4,
  -4, -4, -4, -4, -4, -4
];

function curve(samples, rate) {
  const n = Math.round(rate * 0.025);
  const out = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let e = 0;
    for (let k = i; k < i + n; k += 1) e += samples[k] * samples[k];
    out.push(Math.log10(Math.sqrt(e / n) + 1e-4));
  }
  return out;
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  const at = (x, i) => x[Math.min(x.length - 1, Math.round((i * (x.length - 1)) / Math.max(1, n - 1)))];
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) { ma += at(a, i) / n; mb += at(b, i) / n; }
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = at(a, i) - ma;
    const y = at(b, i) - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// What is wrong with a reading of CHECK_TEXT, or '' when it sounds like speech.
export function checkReading(samples, rate) {
  let bad = 0;
  let clipped = 0;
  for (const v of samples) {
    if (!Number.isFinite(v)) bad += 1;
    else if (Math.abs(v) >= 0.99) clipped += 1;
  }
  if (bad) return 'invalid samples';
  if (clipped > samples.length * 0.005) return 'clipping';
  const c = curve(samples, rate);
  const length = c.length / CHECK_CURVE.length;
  if (length < 0.7 || length > 1.3) return `length ${length.toFixed(2)}`;
  const n = Math.round(rate * 0.025);
  let crossings = 0;
  let counted = 0;
  for (let f = 0; f < c.length; f += 1) {
    if (c[f] < Math.log10(0.03)) continue;
    for (let k = f * n + 1; k < (f + 1) * n; k += 1) if ((samples[k] >= 0) !== (samples[k - 1] >= 0)) crossings += 1;
    counted += n - 1;
  }
  if (!counted) return 'silence';
  const zcr = crossings / counted;
  if (zcr > 0.25) return `noise (${zcr.toFixed(2)})`;
  const r = correlation(c, CHECK_CURVE);
  return r < 0.7 ? `loudness curve ${r.toFixed(2)}` : '';
}

async function soundsRight() {
  const out = await tts.generate(CHECK_TEXT, { voice: CHECK_VOICE });
  return checkReading(out.audio, out.sampling_rate);
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
      if (dev === 'webgpu') {
        const wrong = await soundsRight();
        if (wrong) {
          fallback = 'garbled';
          console.warn(`Lector Lite: WebGPU reads garbled audio here (${wrong}); using WebAssembly`);
          try { await tts.model?.dispose?.(); } catch { /* best effort */ }
          tts = null;
          continue;
        }
      }
      device = dev;
      return;
    } catch (err) {
      last = err;
      tts = null;
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
