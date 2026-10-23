// Audio encoding and assembly with ffmpeg.wasm, the browser counterpart of src/lector/audio.py.
//
// Memory is the tight resource here (Safari reloads a tab that uses too much), so audio is
// never held as one big array: a chapter is collected as 16-bit blobs while it is read
// (PcmTrack), and ffmpeg reads blobs in place through a WORKERFS mount instead of copying
// them into its own memory, which can only ever grow. Each chapter is encoded as soon as it
// is read (AAC for M4B, MP3 for per-chapter files); the M4B is then a stream copy of the
// chapter files with chapter marks, metadata and the cover; per-chapter MP3s go into a ZIP
// that is streamed together.

import { FFmpeg } from './vendor/ffmpeg/index.js?v=60a50c5';
import { FFFSType } from './vendor/ffmpeg/types.js?v=60a50c5';
import { downloadZip } from 'https://cdn.jsdelivr.net/npm/client-zip@2.5.0/index.js';

// The ffmpeg core (32 MB), from either CDN; a complete download is kept in the browser's cache.
const CORES = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm',
];
const CORE_CACHE = 'lector-lite-ffmpeg-0.12.10';
export const RATE = 24000;

let ffmpeg = null;
let loading = null;
let core = null; // blob URLs of the ffmpeg core, fetched once per page

// Fetch into a blob, reporting progress. (The helper in @ffmpeg/util reads the body twice
// when the server sends no content length, as jsDelivr does for compressed files.)
async function download(url, type, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  return new Blob(parts, { type });
}

// One core file as a blob URL: from the cache when an earlier visit kept it, otherwise from
// the CDNs in turn, twice each. A transfer that breaks off (Firefox: "Content-Length header of
// network response exceeds response body") is simply tried again.
async function coreFile(name, type, onProgress) {
  let cache = null;
  try { cache = await caches.open(CORE_CACHE); } catch { /* no Cache Storage, e.g. private windows */ }
  const kept = await cache?.match(name).catch(() => null);
  if (kept) return URL.createObjectURL(new Blob([await kept.blob()], { type }));
  let last;
  for (const base of CORES) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const blob = await download(`${base}/${name}`, type, onProgress);
        cache?.put(name, new Response(blob, { headers: { 'content-type': type } })).catch(() => {});
        return URL.createObjectURL(blob);
      } catch (err) {
        last = err;
      }
    }
  }
  throw new Error(`ffmpeg could not be downloaded (${last?.message || last})`);
}

export function load(onProgress) {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  loading ??= (async () => {
    core ??= {
      coreURL: await coreFile('ffmpeg-core.js', 'text/javascript'),
      wasmURL: await coreFile('ffmpeg-core.wasm', 'application/wasm', onProgress),
    };
    const ff = new FFmpeg();
    await ff.load(core);
    ffmpeg = ff;
    return ff;
  })().catch((err) => { loading = null; throw err; });
  return loading;
}

// End ffmpeg's worker, which hands its memory back; the next call starts a fresh one from
// the core already in hand, which takes a moment only.
export function release() {
  ffmpeg?.terminate();
  ffmpeg = null;
  loading = null;
}

async function run(args) {
  const code = await ffmpeg.exec(args);
  if (code !== 0) throw new Error(`ffmpeg failed (${code})`);
}

const quietly = async (fn) => { try { await fn(); } catch { /* already gone */ } };

// Let ffmpeg read blobs where they are; copy them in only if the browser cannot mount.
async function mountBlobs(dir, files) {
  await ffmpeg.createDir(dir);
  try {
    await ffmpeg.mount(FFFSType.WORKERFS, { blobs: files.map((f) => ({ name: f.name, data: f.blob })) }, dir);
    return true;
  } catch {
    for (const f of files) await ffmpeg.writeFile(`${dir}/${f.name}`, new Uint8Array(await f.blob.arrayBuffer()));
    return false;
  }
}

async function unmountBlobs(dir, files, mounted) {
  if (mounted) await quietly(() => ffmpeg.unmount(dir));
  else for (const f of files) await quietly(() => ffmpeg.deleteFile(`${dir}/${f.name}`));
  await quietly(() => ffmpeg.deleteDir(dir));
}

// Float samples (-1..1) -> 16-bit samples.
export function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// The 44-byte header of a 16-bit mono WAV file with `count` samples.
export function wavHeader(count, rate = RATE) {
  const data = new DataView(new ArrayBuffer(44));
  const text = (offset, s) => [...s].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); data.setUint32(4, 36 + count * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true);
  data.setUint16(34, 16, true); text(36, 'data'); data.setUint32(40, count * 2, true);
  return new Uint8Array(data.buffer);
}

// 16-bit samples -> a playable WAV blob (for voice previews).
export const wav = (int16, rate = RATE) => new Blob([wavHeader(int16.length, rate), int16], { type: 'audio/wav' });

const silences = new Map();
function silence(count) {
  if (!silences.has(count)) silences.set(count, new Blob([new Int16Array(count)]));
  return silences.get(count);
}

// One chapter's audio while it is read: a list of small 16-bit blobs, which the browser keeps
// outside the page's own memory, joined only when ffmpeg reads them.
export class PcmTrack {
  constructor() {
    this.parts = [];
    this.samples = 0;
  }

  add(int16) {
    this.parts.push(new Blob([int16]));
    this.samples += int16.length;
  }

  pause(seconds) {
    const count = Math.round(seconds * RATE);
    if (count > 0) this.parts.push(silence(count));
    this.samples += Math.max(0, count);
  }

  get seconds() { return this.samples / RATE; }

  wav() { return new Blob([wavHeader(this.samples), ...this.parts], { type: 'audio/wav' }); }
}

// Encode one chapter: 'aac' for the M4B, 'mp3' for per-chapter files. Returns the file bytes.
export async function encodeChapter(track, codec, bitrate, meta = {}) {
  await load();
  const out = codec === 'aac' ? 'chapter.m4a' : 'chapter.mp3';
  const files = [{ name: 'chapter.wav', blob: track.wav() }];
  const mounted = await mountBlobs('/pcm', files);
  const tags = Object.entries(meta).filter(([, v]) => v).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  try {
    await run(['-i', '/pcm/chapter.wav', ...tags,
      ...(codec === 'aac' ? ['-c:a', 'aac', '-b:a', bitrate] : ['-c:a', 'libmp3lame', '-b:a', bitrate, '-id3v2_version', '3']),
      out]);
    const data = await ffmpeg.readFile(out);
    await ffmpeg.deleteFile(out);
    return data;
  } finally {
    await unmountBlobs('/pcm', files, mounted);
  }
}

const escapeMeta = (v) => String(v).replace(/[\\=;#\n]/g, (c) => `\\${c}`);

// Join encoded AAC chapters into one M4B with chapter marks, tags and cover.
export async function assembleM4B(chapters, meta, cover, onProgress) {
  await load();
  let pos = 0;
  const lines = [';FFMETADATA1'];
  for (const [k, v] of Object.entries(meta)) if (v) lines.push(`${k}=${escapeMeta(v)}`);
  for (const c of chapters) {
    const end = pos + Math.round(c.seconds * 1000);
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${pos}`, `END=${end}`, `title=${escapeMeta(c.title)}`);
    pos = end;
  }
  const files = chapters.map((c, i) => ({ name: `c${String(i).padStart(4, '0')}.m4a`, blob: c.blob }));
  const mounted = await mountBlobs('/in', files);
  await ffmpeg.writeFile('list.txt', files.map((f) => `file '/in/${f.name}'`).join('\n'));
  await ffmpeg.writeFile('meta.txt', lines.join('\n'));
  const coverArgs = [];
  if (cover) {
    await ffmpeg.writeFile('cover.img', new Uint8Array(await cover.arrayBuffer()));
    coverArgs.push('-i', 'cover.img');
  }
  const progress = ({ progress: p }) => onProgress?.(Math.max(0, Math.min(1, p)));
  ffmpeg.on('progress', progress);
  let data;
  try {
    await run(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'meta.txt', ...coverArgs,
      '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1',
      ...(cover ? ['-map', '2:v', '-c:v', 'mjpeg', '-vf', "scale='min(1000,iw)':-2", '-disposition:v:0', 'attached_pic'] : []),
      '-c:a', 'copy', '-movflags', '+faststart', '-f', 'mp4', 'book.m4b']);
    data = await ffmpeg.readFile('book.m4b');
  } finally {
    ffmpeg.off('progress', progress);
    await unmountBlobs('/in', files, mounted);
    // The finished book filled ffmpeg's memory; ending the worker is the only way to free it.
    release();
  }
  return new Blob([data], { type: 'audio/mp4' });
}

// Pack per-chapter MP3s (and the cover) into a ZIP, one folder named after the book. The ZIP
// is streamed from the chapter blobs, so they are not all read into memory at once.
export async function zipChapters(chapters, folder, cover) {
  const width = Math.max(2, String(chapters.length).length);
  const files = chapters.map((c, i) => ({
    name: `${folder}/${String(i + 1).padStart(width, '0')} - ${safeName(c.title, 60)}.mp3`,
    input: c.blob,
    lastModified: new Date(),
  }));
  if (cover) files.push({ name: `${folder}/cover.${cover.type.includes('png') ? 'png' : 'jpg'}`, input: cover, lastModified: new Date() });
  return downloadZip(files).blob();
}

export function safeName(text, limit = 80) {
  const keep = [...text].map((c) => (/[\p{L}\p{N} \-_.,()']/u.test(c) ? c : '_')).join('')
    .replace(/^[ ._]+|[ ._]+$/g, '');
  return keep.slice(0, limit).replace(/[ ._]+$/, '') || 'audio';
}
