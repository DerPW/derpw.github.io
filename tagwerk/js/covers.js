// Cover laden (nur bei Bedarf) und kleine Vorschaubilder erzeugen – mit Cache und Mengenbegrenzung.
import { getBlob } from './fs.js';
import { readTags } from './tags/index.js';

const covers = new Map();     // key -> Promise<{ url, mime, data, width, height } | null>
const thumbs = new Map();     // key -> Promise<url | null>
const bySignature = new Map(); // gleiche Bilder (z. B. ein Album) teilen sich ein Vorschaubild
const ready = new Map();       // key -> fertige Vorschau-URL (für flackerfreies Neuzeichnen)

const key = (file) => `${file.id}:${file.mtime}:${file.size}`;

let active = 0;
const queue = [];
function limit(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try { resolve(await fn()); } catch (e) { reject(e); } finally {
        active--;
        queue.shift()?.();
      }
    };
    if (active < 4) run(); else queue.push(run);
  });
}

function signature(data) {
  let s = `${data.length}:`;
  const step = Math.max(1, Math.floor(data.length / 24));
  for (let i = 0; i < data.length; i += step) s += data[i].toString(36);
  return s;
}

export function loadCover(file) {
  if (!file.hasCover) return Promise.resolve(null);
  const k = key(file);
  if (!covers.has(k)) {
    covers.set(k, limit(async () => {
      const { cover } = await readTags(await getBlob(file), { name: file.name, withCover: true });
      if (!cover) return null;
      const blob = new Blob([cover.data], { type: cover.mime });
      return { ...cover, blob, url: URL.createObjectURL(blob), sig: signature(cover.data) };
    }).catch(() => null));
  }
  return covers.get(k);
}

async function makeThumb(blob, size = 96) {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const s = Math.min(bmp.width, bmp.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  bmp.close?.();
  const out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
  return URL.createObjectURL(out);
}

export function loadThumb(file) {
  if (!file.hasCover) return Promise.resolve(null);
  const k = key(file);
  if (!thumbs.has(k)) {
    thumbs.set(k, (async () => {
      const cover = await loadCover(file);
      if (!cover) return null;
      if (!bySignature.has(cover.sig)) bySignature.set(cover.sig, makeThumb(cover.blob).catch(() => cover.url));
      const url = await bySignature.get(cover.sig);
      ready.set(k, url);
      return url;
    })().catch(() => null));
  }
  return thumbs.get(k);
}

export const readyThumb = (file) => ready.get(key(file));

export function forget(file) {
  const k = key(file);
  covers.delete(k);
  thumbs.delete(k);
  ready.delete(k);
}
