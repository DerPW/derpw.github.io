// Audio encoding and assembly with ffmpeg.wasm, the browser counterpart of src/lector/audio.py.
//
// Each chapter is encoded as soon as it is read (AAC for M4B, MP3 for per-chapter files), so
// raw audio never piles up in memory. The M4B is then a stream copy of the chapter files with
// chapter marks, metadata and the cover; per-chapter MP3s are packed into a ZIP.

import { FFmpeg } from './vendor/ffmpeg/index.js?v=97a1a93';
import { FFFSType } from './vendor/ffmpeg/types.js?v=97a1a93';
import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
export const RATE = 24000;

let ffmpeg = null;
let loading = null;

// Fetch into a blob URL, reporting progress. (The helper in @ffmpeg/util reads the body
// twice when the server sends no content length, as jsDelivr does for compressed files.)
async function blobURL(url, type, onProgress) {
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
  return URL.createObjectURL(new Blob(parts, { type }));
}

export function load(onProgress) {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  loading ??= (async () => {
    const ff = new FFmpeg();
    const coreURL = await blobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await blobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm', onProgress);
    await ff.load({ coreURL, wasmURL });
    ffmpeg = ff;
    return ff;
  })().catch((err) => { loading = null; throw err; });
  return loading;
}

async function run(args) {
  const code = await ffmpeg.exec(args);
  if (code !== 0) throw new Error(`ffmpeg failed (${code})`);
}

// Float samples (-1..1) -> 16-bit mono WAV bytes.
export function wav(samples, rate = RATE) {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset, s) => [...s].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); data.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true);
  data.setUint16(34, 16, true); text(36, 'data'); data.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(data.buffer);
}

// Encode one chapter: 'aac' for the M4B, 'mp3' for per-chapter files. Returns the file bytes.
export async function encodeChapter(samples, codec, bitrate, meta = {}) {
  await load();
  const out = codec === 'aac' ? 'chapter.m4a' : 'chapter.mp3';
  await ffmpeg.writeFile('chapter.wav', wav(samples));
  const tags = Object.entries(meta).filter(([, v]) => v).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  await run(['-i', 'chapter.wav', ...tags,
    ...(codec === 'aac' ? ['-c:a', 'aac', '-b:a', bitrate] : ['-c:a', 'libmp3lame', '-b:a', bitrate, '-id3v2_version', '3']),
    out]);
  const data = await ffmpeg.readFile(out);
  await ffmpeg.deleteFile('chapter.wav');
  await ffmpeg.deleteFile(out);
  return data;
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
  // The chapter files are mounted, not copied, so a long book does not need twice the memory.
  const names = chapters.map((_, i) => `c${String(i).padStart(4, '0')}.m4a`);
  let mounted = false;
  try {
    await ffmpeg.createDir('/in');
    await ffmpeg.mount(FFFSType.WORKERFS, { blobs: chapters.map((c, i) => ({ name: names[i], data: c.blob })) }, '/in');
    mounted = true;
  } catch {
    for (let i = 0; i < chapters.length; i += 1) {
      await ffmpeg.writeFile(`/in/${names[i]}`, new Uint8Array(await chapters[i].blob.arrayBuffer()));
    }
  }
  await ffmpeg.writeFile('list.txt', names.map((n) => `file '/in/${n}'`).join('\n'));
  await ffmpeg.writeFile('meta.txt', lines.join('\n'));
  const coverArgs = [];
  if (cover) {
    await ffmpeg.writeFile('cover.img', new Uint8Array(await cover.arrayBuffer()));
    coverArgs.push('-i', 'cover.img');
  }
  const progress = ({ progress: p }) => onProgress?.(Math.max(0, Math.min(1, p)));
  ffmpeg.on('progress', progress);
  try {
    await run(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'meta.txt', ...coverArgs,
      '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1',
      ...(cover ? ['-map', '2:v', '-c:v', 'mjpeg', '-vf', "scale='min(1000,iw)':-2", '-disposition:v:0', 'attached_pic'] : []),
      '-c:a', 'copy', '-movflags', '+faststart', '-f', 'mp4', 'book.m4b']);
  } finally {
    ffmpeg.off('progress', progress);
  }
  const data = await ffmpeg.readFile('book.m4b');
  const quietly = async (fn) => { try { await fn(); } catch { /* already gone */ } };
  for (const f of ['book.m4b', 'list.txt', 'meta.txt', ...(cover ? ['cover.img'] : [])]) await quietly(() => ffmpeg.deleteFile(f));
  if (mounted) await quietly(() => ffmpeg.unmount('/in'));
  else for (const n of names) await quietly(() => ffmpeg.deleteFile(`/in/${n}`));
  await quietly(() => ffmpeg.deleteDir('/in'));
  return new Blob([data], { type: 'audio/mp4' });
}

// Pack per-chapter MP3s (and the cover) into a ZIP, one folder named after the book.
export async function zipChapters(chapters, folder, cover) {
  const zip = new JSZip();
  const dir = zip.folder(folder);
  const width = Math.max(2, String(chapters.length).length);
  chapters.forEach((c, i) => {
    dir.file(`${String(i + 1).padStart(width, '0')} - ${safeName(c.title, 60)}.mp3`, c.blob);
  });
  if (cover) dir.file(`cover.${cover.type.includes('png') ? 'png' : 'jpg'}`, cover);
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export function safeName(text, limit = 80) {
  const keep = [...text].map((c) => (/[\p{L}\p{N} \-_.,()']/u.test(c) ? c : '_')).join('')
    .replace(/^[ ._]+|[ ._]+$/g, '');
  return keep.slice(0, limit).replace(/[ ._]+$/, '') || 'audio';
}
