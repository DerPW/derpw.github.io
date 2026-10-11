// WAV (RIFF) und AIFF: ID3-Chunk lesen/schreiben, LIST/INFO als Rückfallebene.
import { ascii, concat, decodeLatin1, latin1, readU16BE, readU16LE, readU32BE, readU32LE, u32BE, u32LE, utf8 } from './bytes.js';
import { applyToID3, buildID3v2, coverFromID3, emptyID3, hasID3Cover, parseID3v2, tagsFromID3 } from './id3.js';

const INFO_KEYS = { INAM: 'title', IART: 'artist', IPRD: 'album', ICRD: 'year', IGNR: 'genre', ICMT: 'comment', ITRK: 'track' };

async function readChunks(reader, le) {
  const chunks = [];
  let pos = 12;
  while (pos + 8 <= reader.size) {
    const h = await reader.read(pos, 8);
    const size = Math.min(le ? readU32LE(h, 4) : readU32BE(h, 4), reader.size - pos - 8);
    chunks.push({ id: ascii(h, 0, 4), offset: pos, size });
    pos += 8 + size + (size & 1);
  }
  return chunks;
}

const isID3Chunk = (c) => c.id === 'id3 ' || c.id === 'ID3 ';

function decodeInfoString(b) {
  const trimmed = b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(trimmed).trim(); } catch { return decodeLatin1(trimmed).trim(); }
}

function parseInfo(b) {
  const tags = {};
  for (let o = 4; o + 8 <= b.length;) {
    const id = ascii(b, o, 4);
    const size = readU32LE(b, o + 4);
    const field = INFO_KEYS[id] ?? (id === 'IPRT' ? 'track' : null);
    if (field && !tags[field]) tags[field] = decodeInfoString(b.subarray(o + 8, o + 8 + size));
    o += 8 + size + (size & 1);
  }
  for (const k of Object.keys(tags)) if (!tags[k]) delete tags[k];
  return tags;
}

function buildInfo(b, merged, changed) {
  const entries = [];
  for (let o = 4; o + 8 <= b.length;) {
    const id = ascii(b, o, 4);
    const size = readU32LE(b, o + 4);
    entries.push([id, b.subarray(o + 8, o + 8 + size)]);
    o += 8 + size + (size & 1);
  }
  for (const [id, field] of Object.entries(INFO_KEYS)) {
    if (!changed.includes(field)) continue;
    const i = entries.findIndex(([eid]) => eid === id);
    const value = merged[field] ? concat([utf8(merged[field]), new Uint8Array(1)]) : null;
    if (i >= 0 && value) entries[i][1] = value;
    else if (i >= 0) entries.splice(i, 1);
    else if (value) entries.push([id, value]);
  }
  const parts = [latin1('INFO')];
  for (const [id, data] of entries) {
    parts.push(latin1(id), u32LE(data.length), data);
    if (data.length & 1) parts.push(new Uint8Array(1));
  }
  return concat(parts);
}

function ext80(b, o) {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  const mant = readU32BE(b, o + 2) * 2 ** 32 + readU32BE(b, o + 6);
  if (!exp && !mant) return 0;
  return (b[o] & 0x80 ? -1 : 1) * mant * 2 ** (exp - 16383 - 63);
}

export async function readRIFF(reader, { withCover }) {
  const head = await reader.read(0, 12);
  const isWav = ascii(head, 0, 4) === 'RIFF';
  const chunks = await readChunks(reader, isWav);
  const info = { codec: 'PCM', duration: 0, sampleRate: 0, channels: 0, bitrate: 0 };

  if (isWav) {
    const fmt = chunks.find((c) => c.id === 'fmt ');
    const data = chunks.find((c) => c.id === 'data');
    if (fmt) {
      const f = await reader.read(fmt.offset + 8, 16);
      const tag = readU16LE(f, 0);
      info.codec = tag === 3 ? 'PCM Float' : tag === 1 || tag === 0xfffe ? 'PCM' : `WAV 0x${tag.toString(16)}`;
      info.channels = readU16LE(f, 2);
      info.sampleRate = readU32LE(f, 4);
      info.bitsPerSample = readU16LE(f, 14);
      const byteRate = readU32LE(f, 8);
      info.bitrate = Math.round((byteRate * 8) / 1000);
      if (data && byteRate) info.duration = data.size / byteRate;
    }
  } else {
    const comm = chunks.find((c) => c.id === 'COMM');
    if (comm) {
      const c = await reader.read(comm.offset + 8, 18);
      info.channels = readU16BE(c, 0);
      const frames = readU32BE(c, 2);
      info.bitsPerSample = readU16BE(c, 6);
      info.sampleRate = Math.round(ext80(c, 8));
      if (info.sampleRate) info.duration = frames / info.sampleRate;
      info.bitrate = Math.round((info.sampleRate * info.channels * info.bitsPerSample) / 1000);
    }
  }

  let tags = {};
  let tagType = '—';
  let cover = null;
  let hasCover = false;
  const id3Chunk = chunks.find(isID3Chunk);
  if (id3Chunk) {
    const id3 = parseID3v2(await reader.read(id3Chunk.offset + 8, id3Chunk.size));
    tags = tagsFromID3(id3);
    tagType = `ID3v2.${id3.sourceVersion}`;
    hasCover = hasID3Cover(id3);
    if (withCover) cover = coverFromID3(id3);
  }
  const list = isWav && chunks.find((c) => c.id === 'LIST');
  if (list) {
    const b = await reader.read(list.offset + 8, list.size);
    if (ascii(b, 0, 4) === 'INFO') {
      tags = { ...parseInfo(b), ...tags };
      if (!id3Chunk) tagType = 'RIFF INFO';
    }
  }
  return { format: isWav ? 'WAV' : 'AIFF', tagType, info, tags, hasCover, cover: withCover ? cover : undefined };
}

export async function writeRIFF(reader, merged, changed, cover, { id3Version = 3 } = {}) {
  const head = await reader.read(0, 12);
  const isWav = ascii(head, 0, 4) === 'RIFF';
  const sizeBytes = isWav ? u32LE : u32BE;
  const chunks = await readChunks(reader, isWav);

  const id3Chunk = chunks.find(isID3Chunk);
  let id3 = id3Chunk ? parseID3v2(await reader.read(id3Chunk.offset + 8, id3Chunk.size)) : emptyID3(id3Version);
  id3 = applyToID3(id3, merged, changed, cover);
  const id3Data = buildID3v2(id3, 0);

  const parts = [];
  let total = 4;
  const push = (part, len) => { parts.push(part); total += len; };
  for (const c of chunks) {
    if (isID3Chunk(c)) continue;
    if (isWav && c.id === 'LIST') {
      const b = await reader.read(c.offset + 8, c.size);
      if (ascii(b, 0, 4) === 'INFO') {
        const info = buildInfo(b, merged, changed);
        push(concat([latin1('LIST'), u32LE(info.length), info]), 8 + info.length);
        continue;
      }
    }
    const len = 8 + c.size;
    push(reader.slice(c.offset, c.offset + len), len);
    if (c.size & 1) push(new Uint8Array(1), 1);
  }
  push(concat([latin1(isWav ? 'id3 ' : 'ID3 '), sizeBytes(id3Data.length), id3Data]), 8 + id3Data.length);
  if (id3Data.length & 1) push(new Uint8Array(1), 1);

  return new Blob([latin1(isWav ? 'RIFF' : 'FORM'), sizeBytes(total), head.subarray(8, 12), ...parts]);
}

