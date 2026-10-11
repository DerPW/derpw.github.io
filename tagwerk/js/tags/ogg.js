// Ogg Vorbis, Opus und Speex: Kommentar-Header lesen und Seiten neu aufbauen.
import { ascii, concat, latin1, readU16LE, readU32LE, readU64LE, u8, writeU32LE } from './bytes.js';
import {
  applyToVorbis, buildPicture, buildVorbisComment, parsePicture, parseVorbisComment, pickCover, tagsFromVorbis,
} from './vorbis.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggCrc(page) {
  let crc = 0;
  for (let i = 0; i < page.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ page[i]) & 0xff]) >>> 0;
  return crc;
}

function parsePageHeader(b, o) {
  if (o + 27 > b.length || ascii(b, o, 4) !== 'OggS') return null;
  const nseg = b[o + 26];
  if (o + 27 + nseg > b.length) return null;
  const lacing = b.subarray(o + 27, o + 27 + nseg);
  let dataLen = 0;
  for (const l of lacing) dataLen += l;
  return {
    offset: o, headerType: b[o + 5], serial: readU32LE(b, o + 14), seq: readU32LE(b, o + 18),
    lacing, headerLen: 27 + nseg, dataLen, size: 27 + nseg + dataLen,
  };
}

const CODECS = [
  { name: 'Vorbis', format: 'OGG', match: (p) => p[0] === 1 && ascii(p, 1, 6) === 'vorbis', headers: 3 },
  { name: 'Opus', format: 'OPUS', match: (p) => ascii(p, 0, 8) === 'OpusHead', headers: 2 },
  { name: 'Speex', format: 'SPX', match: (p) => ascii(p, 0, 8) === 'Speex   ', headers: 2 },
];

function codecInfo(codec, p) {
  if (codec.name === 'Vorbis') return { sampleRate: readU32LE(p, 12), channels: p[11], nominal: readU32LE(p, 20) };
  if (codec.name === 'Opus') return { sampleRate: 48000, inputRate: readU32LE(p, 12), channels: p[9], preSkip: readU16LE(p, 10) };
  return { sampleRate: readU32LE(p, 36), channels: readU32LE(p, 48) };
}

function commentFromPacket(codec, p) {
  if (codec.name === 'Vorbis') return p.subarray(7);
  if (codec.name === 'Opus') return p.subarray(8);
  return p;
}

function packetFromComment(codec, vcBytes) {
  if (codec.name === 'Vorbis') return concat([u8(3), latin1('vorbis'), vcBytes, u8(1)]);
  if (codec.name === 'Opus') return concat([latin1('OpusTags'), vcBytes]);
  return vcBytes;
}

// Liest die Header-Pakete seitenweise, ohne die ganze Datei zu laden.
async function readHeaderPackets(reader) {
  const packets = [];
  let current = [];
  let pos = 0;
  let codec = null;
  let serial = null;
  while (pos < reader.size) {
    const head = await reader.read(pos, 27 + 255);
    const page = parsePageHeader(head, 0);
    if (!page) throw new Error('Ungültige Ogg-Seite');
    if (serial === null) serial = page.serial;
    const data = page.serial === serial ? await reader.read(pos + page.headerLen, page.dataLen) : null;
    pos += page.size;
    if (!data) continue;
    let o = 0;
    for (const l of page.lacing) {
      current.push(data.subarray(o, o + l));
      o += l;
      if (l < 255) {
        packets.push(concat(current));
        current = [];
        if (packets.length === 1) {
          codec = CODECS.find((c) => c.match(packets[0]));
          if (!codec) throw new Error('Unbekannter Ogg-Codec');
        }
        if (packets.length === codec.headers) return { codec, packets, serial };
      }
    }
  }
  throw new Error('Ogg-Header unvollständig');
}

async function lastGranule(reader, serial) {
  const len = Math.min(reader.size, 65536);
  const tail = await reader.read(reader.size - len, len);
  for (let i = tail.length - 27; i >= 0; i--) {
    if (tail[i] !== 0x4f || ascii(tail, i, 4) !== 'OggS') continue;
    if (readU32LE(tail, i + 14) !== serial) continue;
    const g = readU64LE(tail, i + 6);
    if (g >= 0 && g < 2 ** 53 && !(tail[i + 6] === 0xff && tail[i + 13] === 0xff)) return g;
  }
  return 0;
}

function decodeBase64(s) {
  const bin = atob(s.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const COVER_KEYS = ['METADATA_BLOCK_PICTURE', 'COVERART', 'COVERARTMIME'];

function coverFromComments(vc) {
  const pics = [];
  for (const [k, v] of vc.comments) {
    try {
      if (k.toUpperCase() === 'METADATA_BLOCK_PICTURE') pics.push(parsePicture(decodeBase64(v)));
      else if (k.toUpperCase() === 'COVERART') pics.push({ type: 3, mime: 'image/jpeg', data: decodeBase64(v) });
    } catch { /* defektes Bild ignorieren */ }
  }
  return pickCover(pics);
}

export async function readOgg(reader, { withCover }) {
  const { codec, packets, serial } = await readHeaderPackets(reader);
  const ci = codecInfo(codec, packets[0]);
  const vc = parseVorbisComment(commentFromPacket(codec, packets[1]));
  const granule = await lastGranule(reader, serial);
  const duration = ci.sampleRate ? Math.max(0, granule - (ci.preSkip ?? 0)) / ci.sampleRate : 0;
  return {
    format: codec.format,
    tagType: 'Vorbis Comment',
    info: {
      codec: codec.name,
      sampleRate: ci.inputRate || ci.sampleRate,
      channels: ci.channels,
      duration,
      bitrate: duration ? Math.round((reader.size * 8) / duration / 1000) : Math.round((ci.nominal || 0) / 1000),
    },
    tags: tagsFromVorbis(vc),
    hasCover: vc.comments.some(([k]) => ['METADATA_BLOCK_PICTURE', 'COVERART'].includes(k.toUpperCase())),
    cover: withCover ? coverFromComments(vc) : undefined,
  };
}

const GRANULE_ZERO = new Uint8Array(8);
const GRANULE_NONE = new Uint8Array(8).fill(0xff);

function buildPage(headerType, granule, serial, seq, lacing, data) {
  const page = new Uint8Array(27 + lacing.length + data.length);
  page.set(latin1('OggS'));
  page[5] = headerType;
  page.set(granule, 6);
  writeU32LE(page, 14, serial);
  writeU32LE(page, 18, seq);
  page[26] = lacing.length;
  page.set(lacing, 27);
  page.set(data, 27 + lacing.length);
  writeU32LE(page, 22, oggCrc(page));
  return page;
}

// Jedes Paket beginnt auf einer neuen Seite (gültig für Vorbis, Opus und Speex).
function paginate(packets, serial, startSeq) {
  const pages = [];
  let seq = startSeq;
  for (const packet of packets) {
    const lacing = [];
    for (let n = packet.length; ; n -= 255) {
      if (n >= 255) lacing.push(255);
      else { lacing.push(n); break; }
    }
    let dataPos = 0;
    for (let i = 0; i < lacing.length; i += 255) {
      const chunk = lacing.slice(i, i + 255);
      const size = chunk.reduce((a, b) => a + b, 0);
      const ends = i + chunk.length === lacing.length;
      pages.push(buildPage(i > 0 ? 1 : 0, ends ? GRANULE_ZERO : GRANULE_NONE, serial, seq++, Uint8Array.from(chunk), packet.subarray(dataPos, dataPos + size)));
      dataPos += size;
    }
  }
  return { pages, nextSeq: seq };
}

export async function writeOgg(reader, merged, changed, cover) {
  const all = await reader.read(0, reader.size);
  const pages = [];
  for (let o = 0; o < all.length;) {
    const p = parsePageHeader(all, o);
    if (!p) throw new Error('Ungültige Ogg-Seite');
    pages.push(p);
    o += p.size;
  }
  const serial = pages[0].serial;
  if (pages.some((p) => p.serial !== serial)) throw new Error('Ogg-Dateien mit mehreren Streams werden nicht unterstützt');

  // Header-Pakete zusammensetzen und die Seite finden, auf der der letzte Header endet.
  const packets = [];
  let current = [];
  let codec = null;
  let lastHeaderPage = -1;
  for (let i = 0; i < pages.length && lastHeaderPage < 0; i++) {
    const p = pages[i];
    let o = p.offset + p.headerLen;
    for (let s = 0; s < p.lacing.length; s++) {
      const l = p.lacing[s];
      current.push(all.subarray(o, o + l));
      o += l;
      if (l < 255) {
        packets.push(concat(current));
        current = [];
        if (packets.length === 1) codec = CODECS.find((c) => c.match(packets[0]));
        if (!codec) throw new Error('Unbekannter Ogg-Codec');
        if (packets.length === codec.headers) {
          if (s !== p.lacing.length - 1) throw new Error('Audiodaten beginnen auf einer Header-Seite – Datei wird nicht verändert');
          lastHeaderPage = i;
          break;
        }
      }
    }
  }
  if (lastHeaderPage < 1) throw new Error('Ogg-Header unvollständig');

  let vc = parseVorbisComment(commentFromPacket(codec, packets[1]));
  vc = applyToVorbis(vc, merged, changed);
  if (cover !== undefined) {
    vc.comments = vc.comments.filter(([k]) => !COVER_KEYS.includes(k.toUpperCase()));
    if (cover) vc.comments.push(['METADATA_BLOCK_PICTURE', encodeBase64(buildPicture(cover))]);
  }
  const newPackets = [packetFromComment(codec, buildVorbisComment(vc)), ...packets.slice(2)];
  const { pages: headerPages, nextSeq } = paginate(newPackets, serial, 1);

  const first = pages[0];
  const parts = [all.subarray(0, first.size), ...headerPages];
  const restStart = pages[lastHeaderPage].offset + pages[lastHeaderPage].size;
  const delta = nextSeq - (pages[lastHeaderPage].seq + 1);
  if (delta === 0) {
    parts.push(all.subarray(restStart));
  } else {
    // Sequenznummern aller folgenden Seiten verschieben und CRC neu berechnen.
    for (let i = lastHeaderPage + 1; i < pages.length; i++) {
      const p = pages[i];
      const page = all.subarray(p.offset, p.offset + p.size);
      writeU32LE(page, 18, p.seq + delta);
      writeU32LE(page, 22, 0);
      writeU32LE(page, 22, oggCrc(page));
      parts.push(page);
    }
  }
  return new Blob(parts);
}
