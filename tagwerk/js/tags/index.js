// Einheitliche Schnittstelle der Tag-Engine.
//
//   readTags(blob, { name, withCover }) -> { format, tagType, info, tags, hasCover, cover? }
//   writeTags(blob, { name, tags, changed, cover, id3Version }) -> Blob
//
// tags:  vollständiger Satz der Feldwerte (alt + neu), changed: Liste der geänderten Felder.
// cover: undefined = unverändert, null = entfernen, { mime, data } = setzen.
import { ascii, BlobReader } from './bytes.js';
import { readFLAC, writeFLAC } from './flac.js';
import { id3v2Size } from './id3.js';
import { readMP3, writeMP3 } from './mp3.js';
import { readMP4, writeMP4 } from './mp4.js';
import { readOgg, writeOgg } from './ogg.js';
import { readRIFF, writeRIFF } from './riff.js';

export const FIELD_KEYS = [
  'title', 'artist', 'album', 'albumartist', 'track', 'tracktotal', 'disc', 'disctotal',
  'year', 'genre', 'composer', 'bpm', 'comment', 'lyrics',
];

export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'm4b', 'mp4', 'ogg', 'oga', 'opus', 'spx', 'wav', 'aif', 'aiff', 'aifc'];

const BY_EXT = { mp3: 'mp3', flac: 'flac', m4a: 'mp4', m4b: 'mp4', mp4: 'mp4', ogg: 'ogg', oga: 'ogg', opus: 'ogg', spx: 'ogg', wav: 'riff', aif: 'riff', aiff: 'riff', aifc: 'riff' };

const FORMATS = {
  mp3: [readMP3, writeMP3],
  flac: [readFLAC, writeFLAC],
  mp4: [readMP4, writeMP4],
  ogg: [readOgg, writeOgg],
  riff: [readRIFF, writeRIFF],
};

export const extOf = (name) => (name.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase();

async function detect(reader, ext) {
  const head = await reader.read(0, 12);
  const magic = ascii(head, 0, 4);
  if (magic === 'ID3') {
    const after = await reader.read(id3v2Size(head), 4);
    return ascii(after, 0, 4) === 'fLaC' ? 'flac' : 'mp3';
  }
  if (magic === 'fLaC') return 'flac';
  if (magic === 'OggS') return 'ogg';
  if (ascii(head, 4, 4) === 'ftyp') return 'mp4';
  if (magic === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return 'riff';
  if (magic === 'FORM' && /^AIF[FC]$/.test(ascii(head, 8, 4))) return 'riff';
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3';
  return BY_EXT[ext] ?? null;
}

async function formatFor(reader, name) {
  const kind = await detect(reader, extOf(name));
  if (!kind) throw new Error('Dateiformat wird nicht unterstützt');
  return FORMATS[kind];
}

export async function readTags(blob, { name = '', withCover = false } = {}) {
  const reader = new BlobReader(blob);
  const [read] = await formatFor(reader, name);
  const result = await read(reader, { withCover, ext: extOf(name) });
  for (const key of FIELD_KEYS) result.tags[key] = String(result.tags[key] ?? '').trim();
  return result;
}

export async function writeTags(blob, { name = '', tags, changed, cover, id3Version = 3 }) {
  const reader = new BlobReader(blob);
  const [, write] = await formatFor(reader, name);
  const merged = {};
  for (const key of FIELD_KEYS) merged[key] = String(tags[key] ?? '').replace(/\r\n?/g, '\n').trim();
  const fields = changed.filter((f) => FIELD_KEYS.includes(f));
  return write(reader, merged, fields, cover, { id3Version });
}
