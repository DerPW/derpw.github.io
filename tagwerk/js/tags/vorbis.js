// Vorbis-Kommentare (FLAC, Ogg Vorbis, Opus) und FLAC-PICTURE-Blöcke.
import {
  ascii, concat, decodeUtf8, imageInfo, joinValues, latin1, readU32BE, readU32LE, splitPair, u32BE, u32LE, utf8,
} from './bytes.js';

const KEYS = {
  title: ['TITLE'],
  artist: ['ARTIST'],
  album: ['ALBUM'],
  albumartist: ['ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST'],
  year: ['DATE', 'YEAR'],
  genre: ['GENRE'],
  composer: ['COMPOSER'],
  comment: ['COMMENT', 'DESCRIPTION'],
  bpm: ['BPM'],
  lyrics: ['LYRICS', 'UNSYNCEDLYRICS'],
  track: ['TRACKNUMBER'],
  tracktotal: ['TRACKTOTAL', 'TOTALTRACKS'],
  disc: ['DISCNUMBER'],
  disctotal: ['DISCTOTAL', 'TOTALDISCS'],
};

export function parseVorbisComment(b) {
  let o = 0;
  const vendorLen = readU32LE(b, o);
  const vendor = decodeUtf8(b.subarray(4, 4 + vendorLen));
  o = 4 + vendorLen;
  const count = readU32LE(b, o);
  o += 4;
  const comments = [];
  for (let i = 0; i < count && o + 4 <= b.length; i++) {
    const len = readU32LE(b, o);
    const s = decodeUtf8(b.subarray(o + 4, o + 4 + len));
    o += 4 + len;
    const eq = s.indexOf('=');
    if (eq > 0) comments.push([s.slice(0, eq), s.slice(eq + 1)]);
  }
  return { vendor, comments };
}

export function buildVorbisComment({ vendor, comments }) {
  const parts = [];
  const v = utf8(vendor || 'Tagwerk');
  parts.push(u32LE(v.length), v, u32LE(comments.length));
  for (const [k, val] of comments) {
    const entry = utf8(`${k}=${val}`);
    parts.push(u32LE(entry.length), entry);
  }
  return concat(parts);
}

const getAll = (vc, key) => vc.comments.filter(([k]) => k.toUpperCase() === key).map(([, v]) => v);

export function tagsFromVorbis(vc) {
  const tags = {};
  for (const [field, aliases] of Object.entries(KEYS)) {
    for (const alias of aliases) {
      const values = getAll(vc, alias);
      if (values.length) { tags[field] = joinValues(values); break; }
    }
  }
  // TRACKNUMBER kann "3/12" enthalten
  for (const [num, total] of [['track', 'tracktotal'], ['disc', 'disctotal']]) {
    if (tags[num]?.includes('/')) {
      const [n, t] = splitPair(tags[num]);
      tags[num] = n;
      if (!tags[total] && t) tags[total] = t;
    }
  }
  for (const k of Object.keys(tags)) if (!tags[k]) delete tags[k];
  return tags;
}

export function applyToVorbis(vc, merged, changed) {
  const fields = new Set(changed);
  if (fields.has('track') || fields.has('tracktotal')) fields.add('track').add('tracktotal');
  if (fields.has('disc') || fields.has('disctotal')) fields.add('disc').add('disctotal');
  let comments = vc.comments.slice();
  for (const field of fields) {
    const aliases = KEYS[field];
    if (!aliases) continue;
    comments = comments.filter(([k]) => !aliases.includes(k.toUpperCase()));
    const value = merged[field];
    if (value) comments.push([aliases[0], value]);
  }
  return { vendor: vc.vendor, comments };
}

/* ------------------------------------------------------------ PICTURE */

export function parsePicture(b) {
  let o = 0;
  const type = readU32BE(b, o); o += 4;
  const mimeLen = readU32BE(b, o); o += 4;
  const mime = ascii(b, o, mimeLen); o += mimeLen;
  const descLen = readU32BE(b, o); o += 4 + descLen;
  o += 16; // Breite, Höhe, Farbtiefe, Palette
  const dataLen = readU32BE(b, o); o += 4;
  return { type, mime: mime || imageInfo(b.subarray(o, o + 32)).mime, data: b.subarray(o, o + dataLen) };
}

export function buildPicture(cover) {
  const info = imageInfo(cover.data);
  const mime = latin1(cover.mime || info.mime);
  return concat([
    u32BE(3), u32BE(mime.length), mime, u32BE(0),
    u32BE(info.width), u32BE(info.height), u32BE(info.depth), u32BE(0),
    u32BE(cover.data.length), cover.data,
  ]);
}

export const pickCover = (pictures) => {
  const pic = pictures.find((p) => p.type === 3) ?? pictures[0];
  return pic && pic.data.length ? { mime: pic.mime, data: pic.data } : null;
};
