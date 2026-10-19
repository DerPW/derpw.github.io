// Kokoro speech synthesis in a Web Worker, so the page stays responsive while it reads.
//
// Messages in:  {type: 'load'} | {type: 'generate', id, text, voice, speed}
// Messages out: {type: 'progress', file, loaded, total} while the model downloads,
//               {type: 'ready', device} | {type: 'audio', id, audio, rate} | {type: 'error', id?, message}
//
// WebGPU is used where the browser offers it (fp32 weights, recommended for WebGPU),
// otherwise WebAssembly with 8-bit weights. Weights and voices are cached by the browser.

import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts = null;
let device = 'wasm';

async function hasWebGPU() {
  try {
    return !!(self.navigator?.gpu && await self.navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

function progress(info) {
  if (info?.status === 'progress' && info.total) {
    self.postMessage({ type: 'progress', file: info.file, loaded: info.loaded, total: info.total });
  }
}

async function load(prefer) {
  if (tts) return;
  const tries = [];
  if (prefer !== 'wasm' && await hasWebGPU()) tries.push(['webgpu', 'fp32']);
  tries.push(['wasm', 'q8']);
  let last;
  for (const [dev, dtype] of tries) {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL, { dtype, device: dev, progress_callback: progress });
      device = dev;
      return;
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(data.prefer);
      self.postMessage({ type: 'ready', device });
    } else if (data.type === 'generate') {
      await load();
      const out = await tts.generate(data.text, { voice: data.voice, speed: data.speed || 1 });
      const audio = out.audio instanceof Float32Array ? out.audio : new Float32Array(out.audio);
      self.postMessage({ type: 'audio', id: data.id, audio, rate: out.sampling_rate }, [audio.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message || err) });
  }
};
