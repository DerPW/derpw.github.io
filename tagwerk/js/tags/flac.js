// FLAC: Metadatenblöcke lesen und neu schreiben.
import { concat, latin1, readU24BE, readU32BE, u24BE, u8 } from './bytes.js';
import { id3v2Size } from './id3.js';
import {
  applyToVorbis, buildPicture, buildVorbisComment, parsePicture, parseVorbisComment, pickCover, tagsFromVorbis,
} from './vorbis.js';

const STREAMINFO = 0, PADDING = 1, VORBIS_COMMENT = 4, PICTURE = 6;

async function readBlocks(reader) {
  let start = id3v2Size(await reader.read(0, 10));
  const magic = await reader.read(start, 4);
  if (latin1('fLaC').some((c, i) => magic[i] !== c)) throw new Error('Keine gültige FLAC-Datei');
  let pos = start + 4;
  const blocks = [];
  for (;;) {
    const h = await reader.read(pos, 4);
    if (h.length < 4) throw new Error('FLAC-Metadaten unvollständig');
    const last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const length = readU24BE(h, 1);
    const data = type === PADDING ? null : await reader.read(pos + 4, length);
    blocks.push({ type, length, data });
    pos += 4 + length;
    if (last) break;
  }
  return { blocks, audioStart: pos };
}

function streamInfo(b, fileSize) {
  const sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
  const channels = ((b[12] >> 1) & 7) + 1;
  const bitsPerSample = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
  const samples = (b[13] & 0x0f) * 2 ** 32 + readU32BE(b, 14);
  const duration = sampleRate ? samples / sampleRate : 0;
  return {
    codec: 'FLAC', sampleRate, channels, bitsPerSample, duration,
    bitrate: duration ? Math.round((fileSize * 8) / duration / 1000) : 0,
  };
}

export async function readFLAC(reader, { withCover }) {
  const { blocks } = await readBlocks(reader);
  const si = blocks.find((b) => b.type === STREAMINFO);
  const vcBlock = blocks.find((b) => b.type === VORBIS_COMMENT);
  const pictures = blocks.filter((b) => b.type === PICTURE).map((b) => parsePicture(b.data));
  return {
    format: 'FLAC',
    tagType: 'Vorbis Comment',
    info: si ? streamInfo(si.data, reader.size) : {},
    tags: vcBlock ? tagsFromVorbis(parseVorbisComment(vcBlock.data)) : {},
    hasCover: pictures.length > 0,
    cover: withCover ? pickCover(pictures) : undefined,
  };
}

const block = (type, data, last = false) => concat([u8((last ? 0x80 : 0) | type), u24BE(data.length), data]);

export async function writeFLAC(reader, merged, changed, cover) {
  const { blocks, audioStart } = await readBlocks(reader);
  const vcBlock = blocks.find((b) => b.type === VORBIS_COMMENT);
  const vc = vcBlock ? parseVorbisComment(vcBlock.data) : { vendor: 'Tagwerk', comments: [] };
  const newVC = buildVorbisComment(applyToVorbis(vc, merged, changed));

  const out = [];
  for (const b of blocks) {
    if (b.type === PADDING || b.type === VORBIS_COMMENT) continue;
    if (b.type === PICTURE && cover !== undefined) continue;
    out.push([b.type, b.data]);
    if (b.type === STREAMINFO) out.push([VORBIS_COMMENT, newVC]);
  }
  if (cover) out.push([PICTURE, buildPicture(cover)]);
  out.push([PADDING, new Uint8Array(4096)]);

  const meta = concat([latin1('fLaC'), ...out.map(([type, data], i) => block(type, data, i === out.length - 1))]);
  return new Blob([meta, reader.slice(audioStart)]);
}
