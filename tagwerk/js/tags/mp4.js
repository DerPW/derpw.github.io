// MP4/M4A (iTunes-Metadaten in moov/udta/meta/ilst).
import {
  ascii, concat, decoder, decodeUtf8, imageInfo, joinValues, latin1, readU16BE, readU32BE, readU64BE,
  toInt, u16BE, u32BE, utf8, writeU32BE, writeU64BE,
} from './bytes.js';
import { GENRES } from './id3.js';

const TEXT_ITEMS = {
  '©nam': 'title', '©ART': 'artist', '©alb': 'album', aART: 'albumartist', '©day': 'year',
  '©gen': 'genre', '©wrt': 'composer', '©cmt': 'comment', '©lyr': 'lyrics',
};
const FIELD_ITEMS = Object.fromEntries(Object.entries(TEXT_ITEMS).map(([k, v]) => [v, k]));
const CODECS = { mp4a: 'AAC', alac: 'ALAC', 'ac-3': 'AC-3', 'ec-3': 'E-AC-3', fLaC: 'FLAC', Opus: 'Opus', mp3: 'MP3' };

/* ------------------------------------------------------------ Struktur */

async function topLevelAtoms(reader) {
  const atoms = [];
  let pos = 0;
  while (pos + 8 <= reader.size) {
    const h = await reader.read(pos, 16);
    let size = readU32BE(h, 0);
    let headerSize = 8;
    if (size === 1) { size = readU64BE(h, 8); headerSize = 16; } else if (size === 0) size = reader.size - pos;
    if (size < headerSize) throw new Error('Ungültige MP4-Struktur');
    atoms.push({ type: ascii(h, 4, 4), offset: pos, size, headerSize });
    pos += size;
  }
  return atoms;
}

function parseBoxes(b, start, end) {
  const boxes = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = readU32BE(b, pos);
    let headerSize = 8;
    if (size === 1) { size = readU64BE(b, pos + 8); headerSize = 16; } else if (size === 0) size = end - pos;
    if (size < headerSize || pos + size > end) break;
    boxes.push({ type: ascii(b, pos + 4, 4), start: pos, end: pos + size, headerSize });
    pos += size;
  }
  return boxes;
}

// "meta" ist bei iTunes eine Full-Box (4 Byte Version/Flags), bei QuickTime nicht.
const metaPrefix = (b, box) => (ascii(b, box.start + box.headerSize + 4, 4) === 'hdlr' ? 0 : 4);
const contentStart = (b, box) => box.start + box.headerSize + (box.type === 'meta' ? metaPrefix(b, box) : 0);
const children = (b, box) => parseBoxes(b, contentStart(b, box), box.end);
const child = (b, box, type) => box && children(b, box).find((c) => c.type === type);

function findPath(b, box, path) {
  let cur = box;
  for (const type of path) {
    cur = child(b, cur, type);
    if (!cur) return null;
  }
  return cur;
}

const makeBox = (type, payload) => concat([u32BE(payload.length + 8), latin1(type), payload]);

/* ------------------------------------------------------------ Lesen */

function ilstOf(b, moov) {
  return findPath(b, moov, ['udta', 'meta', 'ilst']) ?? findPath(b, moov, ['meta', 'ilst']);
}

function dataBoxes(b, item) {
  return children(b, item)
    .filter((c) => c.type === 'data')
    .map((d) => ({ type: readU32BE(b, d.start + 8) & 0xffffff, value: b.subarray(d.start + 16, d.end) }));
}

function readIlst(b, ilst, withCover) {
  const tags = {};
  const covers = [];
  if (!ilst) return { tags, covers };
  for (const item of children(b, ilst)) {
    const datas = dataBoxes(b, item);
    if (!datas.length) continue;
    const field = TEXT_ITEMS[item.type];
    if (field) {
      tags[field] = joinValues(datas.map((d) => (d.type === 2 ? decoder('utf-16be').decode(d.value) : decodeUtf8(d.value))));
    } else if (item.type === 'trkn' || item.type === 'disk') {
      const v = datas[0].value;
      if (v.length >= 6) {
        const n = readU16BE(v, 2), t = readU16BE(v, 4);
        const [nk, tk] = item.type === 'trkn' ? ['track', 'tracktotal'] : ['disc', 'disctotal'];
        if (n) tags[nk] = String(n);
        if (t) tags[tk] = String(t);
      }
    } else if (item.type === 'tmpo') {
      const v = datas[0].value;
      const n = v.length === 1 ? v[0] : v.length === 2 ? readU16BE(v, 0) : v.length >= 4 ? readU32BE(v, v.length - 4) : 0;
      if (n) tags.bpm = String(n);
    } else if (item.type === 'gnre' && !tags.genre) {
      const g = GENRES[readU16BE(datas[0].value, 0) - 1];
      if (g) tags.genre = g;
    } else if (item.type === 'covr') {
      for (const d of datas) {
        if (!d.value.length) continue;
        covers.push(withCover ? { mime: d.type === 14 ? 'image/png' : d.type === 13 ? 'image/jpeg' : imageInfo(d.value).mime, data: d.value } : true);
      }
    }
  }
  for (const k of Object.keys(tags)) if (!tags[k]) delete tags[k];
  return { tags, covers };
}

function timing(b, box) {
  const s = box.start + box.headerSize;
  const v = b[s];
  return v === 1
    ? { timescale: readU32BE(b, s + 20), duration: readU64BE(b, s + 24) }
    : { timescale: readU32BE(b, s + 12), duration: readU32BE(b, s + 16) };
}

function audioInfo(b, moov, fileSize) {
  const info = { codec: 'MP4', duration: 0, sampleRate: 0, channels: 0, bitrate: 0 };
  const mvhd = child(b, moov, 'mvhd');
  if (mvhd) {
    const t = timing(b, mvhd);
    if (t.timescale) info.duration = t.duration / t.timescale;
  }
  for (const trak of children(b, moov).filter((c) => c.type === 'trak')) {
    const mdia = child(b, trak, 'mdia');
    const hdlr = child(b, mdia, 'hdlr');
    if (!hdlr || ascii(b, hdlr.start + hdlr.headerSize + 8, 4) !== 'soun') continue;
    const mdhd = child(b, mdia, 'mdhd');
    if (mdhd) {
      const t = timing(b, mdhd);
      if (t.timescale && t.duration) info.duration = t.duration / t.timescale;
    }
    const stsd = findPath(b, mdia, ['minf', 'stbl', 'stsd']);
    if (stsd) {
      const e = stsd.start + stsd.headerSize + 8;
      const type = ascii(b, e + 4, 4);
      info.codec = CODECS[type] ?? type;
      info.channels = readU16BE(b, e + 24);
      info.bitsPerSample = readU16BE(b, e + 26) || undefined;
      info.sampleRate = readU16BE(b, e + 32);
      if (type === 'alac') {
        const end = e + readU32BE(b, e);
        for (let p = e + 36; p + 36 <= end; p++) {
          if (ascii(b, p + 4, 4) !== 'alac') continue;
          info.bitsPerSample = b[p + 17];
          info.channels = b[p + 21];
          info.sampleRate = readU32BE(b, p + 32);
          break;
        }
      }
    }
    break;
  }
  if (info.duration) info.bitrate = Math.round((fileSize * 8) / info.duration / 1000);
  return info;
}

async function loadMoov(reader) {
  const atoms = await topLevelAtoms(reader);
  const moovAtom = atoms.find((a) => a.type === 'moov');
  if (!moovAtom) throw new Error('MP4 ohne moov-Atom');
  const b = await reader.read(moovAtom.offset, moovAtom.size);
  const moov = { type: 'moov', start: 0, end: b.length, headerSize: moovAtom.headerSize };
  return { atoms, moovAtom, b, moov };
}

export async function readMP4(reader, { withCover, ext }) {
  const { b, moov } = await loadMoov(reader);
  const { tags, covers } = readIlst(b, ilstOf(b, moov), withCover);
  return {
    format: ext === 'm4b' ? 'M4B' : 'M4A',
    tagType: 'iTunes MP4',
    info: audioInfo(b, moov, reader.size),
    tags,
    hasCover: covers.length > 0,
    cover: withCover ? (covers[0] ?? null) : undefined,
  };
}

/* ------------------------------------------------------------ Schreiben */

const dataBox = (typeCode, value) => makeBox('data', concat([u32BE(typeCode), u32BE(0), value]));
const textItem = (type, value) => makeBox(type, dataBox(1, utf8(value)));

function buildIlst(b, ilst, merged, changed, cover) {
  let items = ilst ? children(b, ilst).map((c) => ({ type: c.type, bytes: b.subarray(c.start, c.end) })) : [];
  const set = (type, bytes) => {
    items = items.filter((i) => i.type !== type);
    if (bytes) items.push({ type, bytes });
  };
  const fields = new Set(changed);
  for (const field of fields) {
    const value = merged[field] ?? '';
    if (FIELD_ITEMS[field]) {
      if (field === 'genre') set('gnre', null);
      set(FIELD_ITEMS[field], value ? textItem(FIELD_ITEMS[field], value) : null);
    } else if (field === 'track' || field === 'tracktotal') {
      const n = toInt(merged.track), t = toInt(merged.tracktotal);
      set('trkn', n || t ? makeBox('trkn', dataBox(0, concat([u16BE(0), u16BE(n), u16BE(t), u16BE(0)]))) : null);
    } else if (field === 'disc' || field === 'disctotal') {
      const n = toInt(merged.disc), t = toInt(merged.disctotal);
      set('disk', n || t ? makeBox('disk', dataBox(0, concat([u16BE(0), u16BE(n), u16BE(t)]))) : null);
    } else if (field === 'bpm') {
      const n = Math.round(parseFloat(value));
      set('tmpo', n > 0 ? makeBox('tmpo', dataBox(21, u16BE(Math.min(n, 65535)))) : null);
    }
  }
  if (cover !== undefined) {
    const png = cover && imageInfo(cover.data).mime === 'image/png';
    set('covr', cover ? makeBox('covr', dataBox(png ? 14 : 13, cover.data)) : null);
  }
  return makeBox('ilst', concat(items.map((i) => i.bytes)));
}

const HDLR = makeBox('hdlr', concat([new Uint8Array(8), latin1('mdirappl'), new Uint8Array(9)]));

function createPath(path, leaf) {
  if (!path.length) return leaf;
  const [type, ...rest] = path;
  const inner = createPath(rest, leaf);
  if (type === 'meta') return makeBox('meta', concat([new Uint8Array(4), HDLR, inner]));
  return makeBox(type, inner);
}

// Baut eine Box neu auf und ersetzt dabei den Knoten am Ende von "path".
function rebuild(b, box, path, leaf) {
  const prefix = b.subarray(box.start + box.headerSize, contentStart(b, box));
  const [next, ...rest] = path;
  let found = false;
  const parts = children(b, box).map((c) => {
    if (found || c.type !== next) return b.subarray(c.start, c.end);
    found = true;
    return rest.length ? rebuild(b, c, rest, leaf) : leaf;
  });
  if (!found) parts.push(createPath(path, leaf));
  return makeBox(box.type, concat([prefix, ...parts]));
}

// stco/co64-Einträge verschieben, wenn moov vor den Audiodaten liegt und seine Größe ändert.
function patchChunkOffsets(b, delta, moovOffset) {
  const walk = (start, end) => {
    for (const box of parseBoxes(b, start, end)) {
      const s = box.start + box.headerSize;
      if (['trak', 'mdia', 'minf', 'stbl'].includes(box.type)) walk(s, box.end);
      else if (box.type === 'stco' || box.type === 'co64') {
        const count = readU32BE(b, s + 4);
        const wide = box.type === 'co64';
        for (let i = 0; i < count; i++) {
          const o = s + 8 + i * (wide ? 8 : 4);
          const v = wide ? readU64BE(b, o) : readU32BE(b, o);
          if (v <= moovOffset) continue;
          const nv = v + delta;
          if (!wide && nv > 0xffffffff) throw new Error('Chunk-Offset zu groß für stco');
          if (wide) writeU64BE(b, o, nv); else writeU32BE(b, o, nv);
        }
      }
    }
  };
  walk(8, b.length);
}

export async function writeMP4(reader, merged, changed, cover) {
  const { atoms, moovAtom, b, moov } = await loadMoov(reader);
  if (atoms.some((a) => a.type === 'moof')) throw new Error('Fragmentierte MP4-Dateien werden nicht unterstützt');

  const path = findPath(b, moov, ['udta', 'meta', 'ilst']) || !findPath(b, moov, ['meta', 'ilst']) ? ['udta', 'meta', 'ilst'] : ['meta', 'ilst'];
  const ilst = findPath(b, moov, path);
  const newMoov = rebuild(b, moov, path, buildIlst(b, ilst, merged, changed, cover));

  const delta = newMoov.length - b.length;
  if (delta && atoms.some((a) => a.type === 'mdat' && a.offset > moovAtom.offset)) {
    patchChunkOffsets(newMoov, delta, moovAtom.offset);
  }
  return new Blob([reader.slice(0, moovAtom.offset), newMoov, reader.slice(moovAtom.offset + moovAtom.size)]);
}

