// ZIP lesen und neu schreiben, ohne unveränderte Einträge anzufassen.
// Lesen holt nur die nötigen Stücke aus der Datei (Ende, Verzeichnis, einzelne Einträge),
// Schreiben übernimmt die komprimierten Daten aller übrigen Einträge unverändert.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_END64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;

const utf8 = new TextEncoder();
const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodeName(bytes, flags) {
  if (flags & 0x800) return new TextDecoder().decode(bytes);
  try { return utf8Fatal.decode(bytes); } catch { /* kein UTF-8 */ }
  let s = '';
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : CP437[b - 128];
  return s;
}

async function readRange(blob, start, end) {
  if (blob instanceof Uint8Array) return blob.subarray(start, end);
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const sizeOf = (src) => (src instanceof Uint8Array ? src.length : src.size);

/** Liest das zentrale Verzeichnis. `src` ist ein Blob/File oder Uint8Array. */
export async function openZip(src) {
  const size = sizeOf(src);
  if (size < 22) throw new Error('Keine ZIP-Datei');
  const tailStart = Math.max(0, size - 65557);
  const tail = await readRange(src, tailStart, size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_END && i + 22 + tv.getUint16(i + 20, true) <= tail.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei (Verzeichnisende fehlt)');
  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  const comment = tail.slice(eocd + 22, eocd + 22 + tv.getUint16(eocd + 20, true));

  // ZIP64-Verzeichnisende (selten bei EPUB, aber z. B. bei sehr vielen Dateien)
  if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocd >= 20 && tv.getUint32(eocd - 20, true) === SIG_LOC64) {
    const off64 = Number(tv.getBigUint64(eocd - 12, true));
    const rec = await readRange(src, off64, off64 + 56);
    const rv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    if (rv.getUint32(0, true) === SIG_END64) {
      count = Number(rv.getBigUint64(32, true));
      cdSize = Number(rv.getBigUint64(40, true));
      cdOffset = Number(rv.getBigUint64(48, true));
    }
  }
  // Manche Werkzeuge hängen Daten vor das ZIP: Versatz aus der Lage des Verzeichnisses ableiten.
  const eocdAbs = tailStart + eocd;
  const shift = eocdAbs - cdSize - cdOffset > 0 && count > 0 ? eocdAbs - cdSize - cdOffset : 0;

  const cd = await readRange(src, cdOffset + shift, cdOffset + shift + cdSize);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cv.getUint32(p, true) !== SIG_CENTRAL) throw new Error('Beschädigtes ZIP-Verzeichnis');
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    const flags = cv.getUint16(p + 8, true);
    const nameBytes = cd.slice(p + 46, p + 46 + nameLen);
    const e = {
      name: decodeName(nameBytes, flags),
      nameBytes,
      madeBy: cv.getUint16(p + 4, true),
      needed: cv.getUint16(p + 6, true),
      flags,
      method: cv.getUint16(p + 10, true),
      time: cv.getUint16(p + 12, true),
      date: cv.getUint16(p + 14, true),
      crc: cv.getUint32(p + 16, true),
      csize: cv.getUint32(p + 20, true),
      usize: cv.getUint32(p + 24, true),
      internal: cv.getUint16(p + 36, true),
      external: cv.getUint32(p + 38, true),
      offset: cv.getUint32(p + 42, true),
      comment: cd.slice(p + 46 + nameLen + extraLen, p + 46 + nameLen + extraLen + commentLen),
    };
    // ZIP64-Zusatzfeld: echte Größen und Versatz
    let q = p + 46 + nameLen;
    const qEnd = q + extraLen;
    while (q + 4 <= qEnd) {
      const id = cv.getUint16(q, true);
      const len = cv.getUint16(q + 2, true);
      if (id === 0x0001) {
        let r = q + 4;
        if (e.usize === 0xffffffff) { e.usize = Number(cv.getBigUint64(r, true)); r += 8; }
        if (e.csize === 0xffffffff) { e.csize = Number(cv.getBigUint64(r, true)); r += 8; }
        if (e.offset === 0xffffffff) { e.offset = Number(cv.getBigUint64(r, true)); }
      }
      q += 4 + len;
    }
    e.offset += shift;
    entries.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  const byName = new Map();
  for (const e of entries) if (!byName.has(e.name)) byName.set(e.name, e);
  return { size, entries, byName, comment };
}

/** Findet einen Eintrag – exakt oder ohne Beachtung der Groß-/Kleinschreibung. */
export function findEntry(zip, name) {
  const exact = zip.byName.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return zip.entries.find((e) => e.name.toLowerCase() === lower) ?? null;
}

async function dataStart(src, e) {
  const head = await readRange(src, e.offset, e.offset + 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head.length < 30 || hv.getUint32(0, true) !== SIG_LOCAL) throw new Error(`Beschädigter Eintrag: ${e.name}`);
  return e.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
}

async function streamThrough(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const inflate = (bytes) => streamThrough(bytes, new DecompressionStream('deflate-raw'));
export const deflate = (bytes) => streamThrough(bytes, new CompressionStream('deflate-raw'));

/** Liest die rohen (komprimierten) Daten eines Eintrags. */
export async function readRaw(src, e) {
  const start = await dataStart(src, e);
  return readRange(src, start, start + e.csize);
}

/** Liest und entpackt einen Eintrag. */
export async function readEntry(src, e) {
  if (e.flags & 1) throw new Error(`Verschlüsselter Eintrag: ${e.name}`);
  const raw = await readRaw(src, e);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflate(raw);
  throw new Error(`Nicht unterstützte Kompression (${e.method}) in ${e.name}`);
}

/* --------------------------------------------------------------- Schreiben */

function dosNow() {
  const d = new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);
const NO_COMPRESS = /\.(jpe?g|png|gif|webp|avif|mp3|m4a|mp4|woff2?|zip|epub)$/i;

/**
 * Schreibt das ZIP neu.
 * changes: Map<name, Uint8Array | null>  – null entfernt den Eintrag, ein unbekannter Name wird angehängt.
 * Der Eintrag „mimetype“ landet immer unkomprimiert an erster Stelle (OCF-Vorgabe).
 */
export async function rewriteZip(src, zip, changes = new Map()) {
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(await src.arrayBuffer());
  const pending = new Map(changes);
  const now = dosNow();
  const items = [];

  const fresh = async (name, data, old) => {
    const store = name === 'mimetype' || NO_COMPRESS.test(name) || data.length < 64;
    let payload = data;
    let method = 0;
    if (!store) {
      const packed = await deflate(data);
      if (packed.length < data.length) { payload = packed; method = 8; }
    }
    const nameBytes = old?.nameBytes ?? utf8.encode(name);
    return {
      name, nameBytes, method, payload,
      crc: crc32(data), csize: payload.length, usize: data.length,
      flags: old ? old.flags & 0x800 : isAscii(name) ? 0 : 0x800, needed: 20,
      madeBy: old?.madeBy ?? 20, time: now.time, date: now.date,
      internal: old?.internal ?? 0, external: old?.external ?? 0, comment: old?.comment ?? new Uint8Array(0),
    };
  };

  const ordered = [...zip.entries];
  const mi = ordered.findIndex((e) => e.name === 'mimetype');
  if (mi > 0) ordered.unshift(...ordered.splice(mi, 1));

  for (const e of ordered) {
    if (pending.has(e.name)) {
      const data = pending.get(e.name);
      pending.delete(e.name);
      if (data) items.push(await fresh(e.name, data, e));
      continue;
    }
    if (e.name === 'mimetype' && e.method !== 0) {
      items.push(await fresh(e.name, await readEntry(bytes, e), e));
      continue;
    }
    const start = await dataStart(bytes, e);
    items.push({
      ...e,
      flags: e.flags & ~0x0008, // Größen stehen im neuen Kopf – kein Datendeskriptor mehr
      needed: Math.min(e.needed, 20) || 20,
      payload: bytes.subarray(start, start + e.csize),
    });
  }
  for (const [name, data] of pending) if (data) items.push(await fresh(name, data, null));

  let total = 22;
  for (const it of items) total += 30 + it.nameBytes.length + it.csize + 46 + it.nameBytes.length + it.comment.length;
  total += zip.comment.length;
  if (total > 0xffffffff || items.length > 0xffff) throw new Error('Datei zu groß für das ZIP-Format ohne ZIP64');

  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  let p = 0;
  const offsets = [];
  for (const it of items) {
    offsets.push(p);
    v.setUint32(p, SIG_LOCAL, true);
    v.setUint16(p + 4, it.needed, true);
    v.setUint16(p + 6, it.flags, true);
    v.setUint16(p + 8, it.method, true);
    v.setUint16(p + 10, it.time, true);
    v.setUint16(p + 12, it.date, true);
    v.setUint32(p + 14, it.crc, true);
    v.setUint32(p + 18, it.csize, true);
    v.setUint32(p + 22, it.usize, true);
    v.setUint16(p + 26, it.nameBytes.length, true);
    v.setUint16(p + 28, 0, true);
    out.set(it.nameBytes, p + 30);
    p += 30 + it.nameBytes.length;
    out.set(it.payload, p);
    p += it.csize;
  }
  const cdStart = p;
  items.forEach((it, i) => {
    v.setUint32(p, SIG_CENTRAL, true);
    v.setUint16(p + 4, it.madeBy, true);
    v.setUint16(p + 6, it.needed, true);
    v.setUint16(p + 8, it.flags, true);
    v.setUint16(p + 10, it.method, true);
    v.setUint16(p + 12, it.time, true);
    v.setUint16(p + 14, it.date, true);
    v.setUint32(p + 16, it.crc, true);
    v.setUint32(p + 20, it.csize, true);
    v.setUint32(p + 24, it.usize, true);
    v.setUint16(p + 28, it.nameBytes.length, true);
    v.setUint16(p + 30, 0, true);
    v.setUint16(p + 32, it.comment.length, true);
    v.setUint16(p + 34, 0, true);
    v.setUint16(p + 36, it.internal, true);
    v.setUint32(p + 38, it.external, true);
    v.setUint32(p + 42, offsets[i], true);
    out.set(it.nameBytes, p + 46);
    out.set(it.comment, p + 46 + it.nameBytes.length);
    p += 46 + it.nameBytes.length + it.comment.length;
  });
  const cdSize = p - cdStart;
  v.setUint32(p, SIG_END, true);
  v.setUint16(p + 8, items.length, true);
  v.setUint16(p + 10, items.length, true);
  v.setUint32(p + 12, cdSize, true);
  v.setUint32(p + 16, cdStart, true);
  v.setUint16(p + 20, zip.comment.length, true);
  out.set(zip.comment, p + 22);
  return out;
}

/** Einfaches ZIP aus mehreren Dateien (unkomprimiert) – für Downloads mehrerer Bücher. */
export async function makeZip(files) {
  const empty = { entries: [], byName: new Map(), comment: new Uint8Array(0) };
  const changes = new Map();
  for (const { name, blob } of files) changes.set(name, new Uint8Array(await blob.arrayBuffer()));
  // .epub ist bereits gepackt – nicht noch einmal komprimieren.
  return rewriteZip(new Uint8Array(0), empty, changes);
}
