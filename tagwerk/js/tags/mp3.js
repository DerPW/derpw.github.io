// MP3: ID3v2 am Dateianfang, optional ID3v1 am Ende.
import { ascii } from './bytes.js';
import {
  applyToID3, buildID3v1, buildID3v2, coverFromID3, emptyID3, hasID3Cover, id3v2Size, mp3Info, parseID3v1,
  parseID3v2, tagsFromID3,
} from './id3.js';

async function readV1(reader) {
  if (reader.size < 128) return { v1: null, raw: null };
  const raw = await reader.read(reader.size - 128, 128);
  return ascii(raw, 0, 3) === 'TAG' ? { v1: parseID3v1(raw), raw } : { v1: null, raw: null };
}

export async function readMP3(reader, { withCover }) {
  const tagSize = id3v2Size(await reader.read(0, 10));
  const id3 = tagSize ? parseID3v2(await reader.read(0, tagSize)) : null;
  const { v1, raw } = await readV1(reader);
  const audioEnd = reader.size - (raw ? 128 : 0);
  const info = mp3Info(await reader.read(tagSize, 16384), audioEnd - tagSize);
  return {
    format: 'MP3',
    tagType: id3 ? `ID3v2.${id3.sourceVersion}${v1 ? ' + v1' : ''}` : v1 ? 'ID3v1' : '—',
    info,
    tags: { ...(v1 ?? {}), ...(id3 ? tagsFromID3(id3) : {}) },
    hasCover: id3 ? hasID3Cover(id3) : false,
    cover: withCover ? (id3 ? coverFromID3(id3) : null) : undefined,
  };
}

export async function writeMP3(reader, merged, changed, cover, { id3Version = 3 } = {}) {
  const tagSize = id3v2Size(await reader.read(0, 10));
  let id3 = tagSize ? parseID3v2(await reader.read(0, tagSize)) : emptyID3(id3Version);
  id3 = applyToID3(id3, merged, changed, cover);
  const { raw } = await readV1(reader);
  const parts = [buildID3v2(id3), reader.slice(tagSize, reader.size - (raw ? 128 : 0))];
  if (raw) parts.push(buildID3v1(merged, raw));
  return new Blob(parts);
}
