// Binär-Hilfsfunktionen für die Tag-Engine (ohne DOM-Abhängigkeiten).

const decoders = {};
export function decoder(label) {
  return (decoders[label] ??= new TextDecoder(label));
}
const utf8Encoder = new TextEncoder();

export const utf8 = (str) => utf8Encoder.encode(str);
export const decodeUtf8 = (bytes) => decoder('utf-8').decode(bytes);

export function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[i] = c < 256 ? c : 0x3f;
  }
  return out;
}

export function decodeLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export const isLatin1 = (str) => /^[\x00-\xff]*$/.test(str);

export function utf16le(str, bom = true) {
  const out = new Uint8Array(str.length * 2 + (bom ? 2 : 0));
  let o = 0;
  if (bom) { out[0] = 0xff; out[1] = 0xfe; o = 2; }
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[o++] = c & 0xff;
    out[o++] = c >> 8;
  }
  return out;
}

export function ascii(bytes, offset, length) {
  let s = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const u8 = (...values) => Uint8Array.from(values);

export const readU16BE = (b, o) => (b[o] << 8) | b[o + 1];
export const readU16LE = (b, o) => b[o] | (b[o + 1] << 8);
export const readU24BE = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
export const readU32BE = (b, o) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
export const readU32LE = (b, o) => ((b[o + 3] << 24) >>> 0) + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o]);
export const readU64BE = (b, o) => readU32BE(b, o) * 2 ** 32 + readU32BE(b, o + 4);
export const readU64LE = (b, o) => readU32LE(b, o + 4) * 2 ** 32 + readU32LE(b, o);

export function u16BE(n) { return u8((n >> 8) & 0xff, n & 0xff); }
export function u16LE(n) { return u8(n & 0xff, (n >> 8) & 0xff); }
export function u24BE(n) { return u8((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff); }
export function u32BE(n) { return u8((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff); }
export function u32LE(n) { return u8(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff); }
export function writeU32BE(b, o, n) { b[o] = (n >>> 24) & 0xff; b[o + 1] = (n >>> 16) & 0xff; b[o + 2] = (n >>> 8) & 0xff; b[o + 3] = n & 0xff; }
export function writeU32LE(b, o, n) { b[o] = n & 0xff; b[o + 1] = (n >>> 8) & 0xff; b[o + 2] = (n >>> 16) & 0xff; b[o + 3] = (n >>> 24) & 0xff; }
export function writeU64BE(b, o, n) { writeU32BE(b, o, Math.floor(n / 2 ** 32)); writeU32BE(b, o + 4, n >>> 0); }

// Liest Bereiche aus einem Blob/File, ohne die ganze Datei zu laden.
export class BlobReader {
  constructor(blob) {
    this.blob = blob;
    this.size = blob.size;
  }
  async read(offset, length) {
    const start = Math.max(0, offset);
    const end = Math.min(this.size, offset + length);
    if (end <= start) return new Uint8Array(0);
    return new Uint8Array(await this.blob.slice(start, end).arrayBuffer());
  }
  slice(start, end) {
    return this.blob.slice(start, end);
  }
}

export function indexOfBytes(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

// Bildtyp und -abmessungen aus den ersten Bytes bestimmen.
export function imageInfo(b) {
  const info = { mime: 'image/jpeg', width: 0, height: 0, depth: 24 };
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    info.mime = 'image/png';
    info.width = readU32BE(b, 16);
    info.height = readU32BE(b, 20);
    const bitDepth = b[24], colorType = b[25];
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 3;
    info.depth = bitDepth * channels;
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = readU16BE(b, o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        info.height = readU16BE(b, o + 5);
        info.width = readU16BE(b, o + 7);
        info.depth = b[o + 4] * b[o + 9];
        break;
      }
      o += 2 + len;
    }
  } else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    info.mime = 'image/gif';
    info.width = readU16LE(b, 6);
    info.height = readU16LE(b, 8);
  } else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    info.mime = 'image/webp';
  } else if (b[0] === 0x42 && b[1] === 0x4d) {
    info.mime = 'image/bmp';
  }
  return info;
}

export const sniffImage = (b) => imageInfo(b).mime;

// Erst trimmen, dann leere Werte entfernen – mehrere Werte werden mit "; " verbunden.
export function joinValues(values) {
  return values.map((v) => String(v ?? '').replace(/\0+$/g, '').trim()).filter(Boolean).join('; ');
}

export function splitPair(value) {
  const s = String(value ?? '').trim();
  const i = s.indexOf('/');
  if (i < 0) return [s, ''];
  return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
}

export function toInt(value) {
  const n = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
