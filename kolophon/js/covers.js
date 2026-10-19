// Vorschaubilder (mit Zwischenspeicher in IndexedDB), Bildaufbereitung und Platzhalter-Cover.

const THUMB_H = 420;

async function decode(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob); } catch { /* Fallback über <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dims = (img) => ({ width: img.width || img.naturalWidth, height: img.height || img.naturalHeight });

function canvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function toBlob(c, type, quality) {
  if (c.convertToBlob) return c.convertToBlob({ type, quality });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht kodiert werden'))), type, quality));
}

async function scaled(blob, maxW, maxH) {
  const img = await decode(blob);
  const { width, height } = dims(img);
  if (!width || !height) throw new Error('Leeres Bild');
  const s = Math.min(1, maxW / width, maxH / height);
  const w = Math.max(1, Math.round(width * s));
  const hgt = Math.max(1, Math.round(height * s));
  const c = canvas(w, hgt);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, hgt);
  img.close?.();
  return { canvas: c, width: w, height: hgt, origWidth: width, origHeight: height };
}

/* ------------------------------------------------------------- Cache */

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('kolophon-thumbs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('thumbs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function cacheGet(key) {
  try {
    const d = await db();
    return await new Promise((res) => {
      const r = d.transaction('thumbs').objectStore('thumbs').get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}

async function cachePut(key, value) {
  try {
    const d = await db();
    d.transaction('thumbs', 'readwrite').objectStore('thumbs').put(value, key);
  } catch { /* privates Fenster o. Ä. */ }
}

export async function clearThumbCache() {
  try {
    const d = await db();
    d.transaction('thumbs', 'readwrite').objectStore('thumbs').clear();
  } catch { /* egal */ }
}

/** Liefert eine Objekt-URL für ein kleines Vorschaubild. `key` identifiziert Datei + Stand. */
export async function thumbnail(key, getBlob) {
  const hit = key && (await cacheGet(key));
  if (hit?.blob) return { url: URL.createObjectURL(hit.blob), width: hit.width, height: hit.height };
  const blob = await getBlob();
  if (!blob) return null;
  const s = await scaled(blob, THUMB_H * 0.8, THUMB_H);
  const type = 'image/webp';
  let out = await toBlob(s.canvas, type, 0.82);
  if (out.type !== type) out = await toBlob(s.canvas, 'image/jpeg', 0.84);
  const value = { blob: out, width: s.origWidth, height: s.origHeight, time: Date.now() };
  if (key) cachePut(key, value);
  return { url: URL.createObjectURL(out), width: s.origWidth, height: s.origHeight };
}

export async function imageSize(blob) {
  const img = await decode(blob);
  const d = dims(img);
  img.close?.();
  return d;
}

/**
 * Bereitet ein Bild als Cover auf: optional verkleinern, in den gewünschten Typ umwandeln.
 * Gibt { blob, bytes, mime, width, height } zurück.
 */
export async function prepareCover(blob, { maxWidth = 1600, mime } = {}) {
  const target = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const { width, height } = await imageSize(blob);
  const fits = !maxWidth || width <= maxWidth;
  if (fits && blob.type === target) {
    return { blob, bytes: new Uint8Array(await blob.arrayBuffer()), mime: target, width, height };
  }
  const s = await scaled(blob, maxWidth || width, Infinity);
  const ctx = s.canvas.getContext('2d');
  if (target === 'image/jpeg') {
    // Transparenz auf Weiß legen, sonst wird sie schwarz
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, s.width, s.height);
  }
  const out = await toBlob(s.canvas, target, 0.9);
  return { blob: out, bytes: new Uint8Array(await out.arrayBuffer()), mime: target, width: s.width, height: s.height };
}

/* ------------------------------------------------------- Platzhalter */

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}

/** Farbton für Platzhalter-Cover – ruhig, wie die neutralen Cover in Apple Books. */
export function placeholderStyle(title, author) {
  const n = hash(`${title}|${author}`);
  const hues = [8, 24, 38, 150, 172, 200, 214, 232, 262, 292, 330, 350];
  const hue = hues[n % hues.length];
  const sat = 28 + (n >> 8) % 22;
  return `--ph-h:${hue};--ph-s:${sat}%`;
}
