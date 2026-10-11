// ID3v2.2/2.3/2.4 lesen, ID3v2.3/2.4 schreiben, ID3v1 und MP3-Audioinfos.
import {
  ascii, concat, decodeLatin1, decoder, decodeUtf8, isLatin1, joinValues, latin1, readU32BE, splitPair, u8, u32BE, utf16le, utf8,
} from './bytes.js';

export const GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop',
  'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game',
  'Sound Clip', 'Gospel', 'Noise', 'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative',
  'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial',
  'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave',
  'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka',
  'Retro', 'Musical', 'Rock & Roll', 'Hard Rock', 'Folk', 'Folk-Rock', 'National Folk', 'Swing',
  'Fast Fusion', 'Bebop', 'Latin', 'Revival', 'Celtic', 'Bluegrass', 'Avantgarde', 'Gothic Rock',
  'Progressive Rock', 'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band', 'Chorus',
  'Easy Listening', 'Acoustic', 'Humour', 'Speech', 'Chanson', 'Opera', 'Chamber Music', 'Sonata',
  'Symphony', 'Booty Bass', 'Primus', 'Porn Groove', 'Satire', 'Slow Jam', 'Club', 'Tango', 'Samba',
  'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul', 'Freestyle', 'Duet', 'Punk Rock', 'Drum Solo',
  'A Cappella', 'Euro-House', 'Dance Hall', 'Goa', 'Drum & Bass', 'Club-House', 'Hardcore Techno',
  'Terror', 'Indie', 'BritPop', 'Afro-Punk', 'Polsk Punk', 'Beat', 'Christian Gangsta Rap',
  'Heavy Metal', 'Black Metal', 'Crossover', 'Contemporary Christian', 'Christian Rock', 'Merengue',
  'Salsa', 'Thrash Metal', 'Anime', 'JPop', 'Synthpop', 'Abstract', 'Art Rock', 'Baroque', 'Bhangra',
  'Big Beat', 'Breakbeat', 'Chillout', 'Downtempo', 'Dub', 'EBM', 'Eclectic', 'Electro', 'Electroclash',
  'Emo', 'Experimental', 'Garage', 'Global', 'IDM', 'Illbient', 'Industro-Goth', 'Jam Band', 'Krautrock',
  'Leftfield', 'Lounge', 'Math Rock', 'New Romantic', 'Nu-Breakz', 'Post-Punk', 'Post-Rock', 'Psytrance',
  'Shoegaze', 'Space Rock', 'Trop Rock', 'World Music', 'Neoclassical', 'Audiobook', 'Audio Theatre',
  'Neue Deutsche Welle', 'Podcast', 'Indie Rock', 'G-Funk', 'Dubstep', 'Garage Rock', 'Psybient',
];

const V22_MAP = {
  TT1: 'TIT1', TT2: 'TIT2', TT3: 'TIT3', TP1: 'TPE1', TP2: 'TPE2', TP3: 'TPE3', TP4: 'TPE4',
  TAL: 'TALB', TRK: 'TRCK', TPA: 'TPOS', TYE: 'TYER', TDA: 'TDAT', TIM: 'TIME', TRD: 'TRDA',
  TCO: 'TCON', TCM: 'TCOM', TBP: 'TBPM', TEN: 'TENC', TXX: 'TXXX', TCR: 'TCOP', TPB: 'TPUB',
  TSS: 'TSSE', TLA: 'TLAN', TLE: 'TLEN', TOA: 'TOPE', TOT: 'TOAL', TKE: 'TKEY', TMT: 'TMED',
  TFT: 'TFLT', TOF: 'TOFN', TOL: 'TOLY', TOR: 'TORY', TRC: 'TSRC', TXT: 'TEXT', COM: 'COMM',
  ULT: 'USLT', UFI: 'UFID', WXX: 'WXXX', CNT: 'PCNT', POP: 'POPM', PIC: 'APIC',
};

const TEXT_IDS = {
  title: 'TIT2', artist: 'TPE1', album: 'TALB', albumartist: 'TPE2', genre: 'TCON', composer: 'TCOM', bpm: 'TBPM',
};

/* ---------------------------------------------------------------- Lesen */

const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function unsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let o = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[o++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, o);
}

// Gesamtgröße eines ID3v2-Tags inkl. Header und Footer (aus den ersten 10 Bytes).
export function id3v2Size(head) {
  if (head.length < 10 || ascii(head, 0, 3) !== 'ID3') return 0;
  return 10 + syncsafe(head, 6) + (head[5] & 0x10 ? 10 : 0);
}

const isFrameId = (b, o, len) => {
  for (let i = 0; i < len; i++) {
    const c = b[o + i];
    if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39))) return false;
  }
  return true;
};

export function parseID3v2(bytes) {
  const version = bytes[3];
  const flags = bytes[5];
  const size = syncsafe(bytes, 6);
  let body = bytes.subarray(10, 10 + size);
  if (version < 2 || version > 4) throw new Error(`ID3v2.${version} wird nicht unterstützt`);
  if (flags & 0x80 && version < 4) body = unsync(body);

  let pos = 0;
  if (flags & 0x40 && version >= 3) {
    pos = version === 3 ? 4 + readU32BE(body, 0) : syncsafe(body, 0);
  }

  const frames = [];
  const idLen = version === 2 ? 3 : 4;
  const headLen = version === 2 ? 6 : 10;
  while (pos + headLen <= body.length) {
    if (body[pos] === 0) break; // Padding
    if (!isFrameId(body, pos, idLen)) break;
    let id = ascii(body, pos, idLen);
    let frameSize;
    let fflags = u8(0, 0);
    if (version === 2) {
      frameSize = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5];
    } else if (version === 3) {
      frameSize = readU32BE(body, pos + 4);
      fflags = body.slice(pos + 8, pos + 10);
    } else {
      frameSize = syncsafe(body, pos + 4);
      // Manche Programme schreiben in v2.4 keine syncsafe-Größen – heuristisch erkennen.
      const raw = readU32BE(body, pos + 4);
      if (raw !== frameSize) {
        const next = pos + headLen + frameSize;
        const nextRaw = pos + headLen + raw;
        const ok = (n) => n === body.length || (n + headLen <= body.length && (body[n] === 0 || isFrameId(body, n, 4)));
        if (!ok(next) && ok(nextRaw)) frameSize = raw;
      }
      fflags = body.slice(pos + 8, pos + 10);
    }
    const start = pos + headLen;
    const end = start + frameSize;
    if (end > body.length) break;
    let data = body.subarray(start, end);
    pos = end;

    let opaque = false;
    if (version === 3) {
      if (fflags[1] & 0xc0) opaque = true; // komprimiert oder verschlüsselt
      else if (fflags[1] & 0x20) data = data.subarray(1); // Gruppierung
    } else if (version === 4) {
      if (fflags[1] & 0x0c) opaque = true;
      else {
        if (fflags[1] & 0x40) data = data.subarray(1);
        if (fflags[1] & 0x01) data = data.subarray(4);
        if (fflags[1] & 0x02 || flags & 0x80) data = unsync(data);
      }
    }

    if (version === 2) {
      const mapped = V22_MAP[id];
      if (!mapped) continue; // Unbekannte v2.2-Frames lassen sich nicht übertragen
      if (id === 'PIC') data = convertPIC(data);
      id = mapped;
    }
    frames.push({ id, data: opaque ? data : data.slice(), flags: fflags, opaque });
  }
  return { version: version === 2 ? 3 : version, sourceVersion: version, frames };
}

function convertPIC(d) {
  const format = ascii(d, 1, 3).toUpperCase();
  const mime = format === 'PNG' ? 'image/png' : 'image/jpeg';
  return concat([u8(d[0]), latin1(mime), u8(0), d.subarray(4)]);
}

const termLen = (enc) => (enc === 1 || enc === 2 ? 2 : 1);

function findTerm(enc, b, from = 0) {
  if (termLen(enc) === 1) {
    const i = b.indexOf(0, from);
    return i < 0 ? b.length : i;
  }
  for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
  return b.length;
}

function decodeString(enc, b) {
  if (enc === 0) return decodeLatin1(b);
  if (enc === 3) return decodeUtf8(b);
  if (enc === 2) return decoder('utf-16be').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return decoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0xff && b[1] === 0xfe) return decoder('utf-16le').decode(b.subarray(2));
  return decoder('utf-16le').decode(b);
}

function decodeStrings(enc, b) {
  const out = [];
  let pos = 0;
  while (pos < b.length) {
    const t = findTerm(enc, b, pos);
    out.push(decodeString(enc, b.subarray(pos, t)));
    pos = t + termLen(enc);
  }
  return out;
}

const frameText = (f) => (f ? decodeStrings(f.data[0], f.data.subarray(1)).filter((s) => s !== '') : []);

function decodeLangFrame(f) {
  const enc = f.data[0];
  const rest = f.data.subarray(4);
  const t = findTerm(enc, rest);
  return {
    lang: ascii(f.data, 1, 3),
    desc: decodeString(enc, rest.subarray(0, t)),
    text: decodeString(enc, rest.subarray(t + termLen(enc))).replace(/\0+$/, ''),
  };
}

function decodeAPIC(f) {
  const d = f.data;
  const enc = d[0];
  const mimeEnd = d.indexOf(0, 1);
  const mime = decodeLatin1(d.subarray(1, mimeEnd)) || 'image/jpeg';
  const type = d[mimeEnd + 1];
  const rest = d.subarray(mimeEnd + 2);
  const t = findTerm(enc, rest);
  return { mime: mime.includes('/') ? mime : `image/${mime.toLowerCase().replace('jpg', 'jpeg')}`, type, data: rest.subarray(t + termLen(enc)) };
}

function resolveGenre(value) {
  // "(17)", "(17)Rock", "17" oder "Rock"
  return value.replace(/\((\d+)\)/g, (m, n) => (GENRES[+n] ? `${GENRES[+n]} ` : m)).replace(/^\d+$/, (n) => GENRES[+n] ?? n).trim();
}

export function tagsFromID3(id3) {
  const tags = {};
  const get = (id) => id3.frames.find((f) => f.id === id && !f.opaque);
  for (const [key, id] of Object.entries(TEXT_IDS)) {
    const values = frameText(get(id));
    if (values.length) tags[key] = joinValues(key === 'genre' ? values.map(resolveGenre) : values);
  }
  const year = frameText(get('TDRC'))[0] ?? frameText(get('TYER'))[0];
  if (year) tags.year = year.trim();
  [tags.track, tags.tracktotal] = splitPair(frameText(get('TRCK'))[0]);
  [tags.disc, tags.disctotal] = splitPair(frameText(get('TPOS'))[0]);
  const comms = id3.frames.filter((f) => f.id === 'COMM' && !f.opaque).map(decodeLangFrame);
  const comm = comms.find((c) => c.desc === '') ?? comms.find((c) => !/^(iTun|ID3v1)/i.test(c.desc));
  if (comm?.text) tags.comment = comm.text;
  else {
    const txxx = id3.frames.filter((f) => f.id === 'TXXX' && !f.opaque).map(frameText).find((v) => /^comment$/i.test(v[0] ?? ''));
    if (txxx?.[1]) tags.comment = txxx.slice(1).join('; ');
  }
  const uslt = id3.frames.find((f) => f.id === 'USLT' && !f.opaque);
  if (uslt) tags.lyrics = decodeLangFrame(uslt).text;
  for (const k of Object.keys(tags)) if (!tags[k]) delete tags[k];
  return tags;
}

export function coverFromID3(id3) {
  const pics = id3.frames.filter((f) => f.id === 'APIC' && !f.opaque).map(decodeAPIC);
  const pic = pics.find((p) => p.type === 3) ?? pics[0];
  return pic && pic.data.length ? { mime: pic.mime, data: pic.data } : null;
}

export const hasID3Cover = (id3) => id3.frames.some((f) => f.id === 'APIC');

/* -------------------------------------------------------------- Schreiben */

const pickEncoding = (str, version) => (version === 4 ? 3 : isLatin1(str) ? 0 : 1);
const encodeString = (str, enc) => (enc === 0 ? latin1(str) : enc === 3 ? utf8(str) : utf16le(str));
const terminator = (enc) => (termLen(enc) === 2 ? u8(0, 0) : u8(0));

function textFrame(id, value, version) {
  const enc = pickEncoding(value, version);
  return { id, data: concat([u8(enc), encodeString(value, enc)]), flags: u8(0, 0), opaque: false };
}

function langFrame(id, text, version) {
  const enc = pickEncoding(text, version);
  return {
    id,
    data: concat([u8(enc), latin1('eng'), encodeString('', enc), terminator(enc), encodeString(text, enc)]),
    flags: u8(0, 0),
    opaque: false,
  };
}

function apicFrame(cover) {
  return {
    id: 'APIC',
    data: concat([u8(0), latin1(cover.mime || 'image/jpeg'), u8(0), u8(3), u8(0), cover.data]),
    flags: u8(0, 0),
    opaque: false,
  };
}

const pair = (n, t) => (n ? (t ? `${n}/${t}` : n) : '');

// Ändert nur die Frames der geänderten Felder; alles andere bleibt erhalten.
export function applyToID3(id3, merged, changed, cover) {
  const version = id3.version;
  let frames = id3.frames.filter((f) => !(f.opaque && id3.sourceVersion !== version));
  const drop = (pred) => { frames = frames.filter((f) => !pred(f)); };
  const set = (id, value) => {
    drop((f) => f.id === id);
    if (value) frames.push(textFrame(id, value, version));
  };

  for (const field of changed) {
    const value = merged[field] ?? '';
    if (TEXT_IDS[field]) set(TEXT_IDS[field], value);
    else if (field === 'year') {
      drop((f) => ['TDRC', 'TYER', 'TDAT', 'TIME', 'TRDA'].includes(f.id));
      if (value && version === 4) frames.push(textFrame('TDRC', value, version));
      else if (value) {
        const m = value.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
        frames.push(textFrame('TYER', m ? m[1] : value, version));
        if (m?.[2]) frames.push(textFrame('TDAT', m[3] + m[2], version));
      }
    } else if (field === 'track' || field === 'tracktotal') set('TRCK', pair(merged.track, merged.tracktotal));
    else if (field === 'disc' || field === 'disctotal') set('TPOS', pair(merged.disc, merged.disctotal));
    else if (field === 'comment') {
      drop((f) => f.id === 'COMM' && !f.opaque && decodeLangFrame(f).desc === '');
      drop((f) => f.id === 'TXXX' && !f.opaque && /^comment$/i.test(frameText(f)[0] ?? ''));
      if (value) frames.push(langFrame('COMM', value, version));
    } else if (field === 'lyrics') {
      drop((f) => f.id === 'USLT');
      if (value) frames.push(langFrame('USLT', value, version));
    }
  }

  if (cover !== undefined) {
    drop((f) => f.id === 'APIC');
    if (cover) frames.push(apicFrame(cover));
  }
  return { ...id3, frames };
}

const encodeSyncsafe = (n) => u8((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);

export function buildID3v2(id3, padding = 1024) {
  const { version } = id3;
  const parts = [];
  for (const f of id3.frames) {
    parts.push(latin1(f.id), version === 4 ? encodeSyncsafe(f.data.length) : u32BE(f.data.length), f.opaque ? f.flags : u8(0, 0), f.data);
  }
  const body = concat(parts);
  return concat([latin1('ID3'), u8(version, 0, 0), encodeSyncsafe(body.length + padding), body, new Uint8Array(padding)]);
}

export const emptyID3 = (version = 3) => ({ version, sourceVersion: version, frames: [] });

/* ----------------------------------------------------------------- ID3v1 */

export function parseID3v1(b) {
  if (b.length !== 128 || ascii(b, 0, 3) !== 'TAG') return null;
  const str = (o, l) => decodeLatin1(b.subarray(o, o + l)).replace(/\0.*$/s, '').trim();
  const tags = { title: str(3, 30), artist: str(33, 30), album: str(63, 30), year: str(93, 4) };
  if (b[125] === 0 && b[126] !== 0) {
    tags.comment = str(97, 28);
    tags.track = String(b[126]);
  } else tags.comment = str(97, 30);
  if (GENRES[b[127]]) tags.genre = GENRES[b[127]];
  for (const k of Object.keys(tags)) if (!tags[k]) delete tags[k];
  return tags;
}

export function buildID3v1(merged, old) {
  const b = new Uint8Array(128);
  b.set(latin1('TAG'));
  const put = (o, l, v) => b.set(latin1(String(v ?? '')).subarray(0, l), o);
  put(3, 30, merged.title);
  put(33, 30, merged.artist);
  put(63, 30, merged.album);
  put(93, 4, merged.year);
  put(97, 28, merged.comment);
  const track = parseInt(merged.track, 10);
  if (track > 0 && track < 256) { b[125] = 0; b[126] = track; }
  const g = GENRES.findIndex((x) => x.toLowerCase() === String(merged.genre ?? '').toLowerCase());
  b[127] = g >= 0 ? g : old ? old[127] : 255;
  return b;
}

/* ---------------------------------------------------------------- MP3-Info */

const BITRATES = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
BITRATES['2-3'] = BITRATES['2-2'];
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

function frameHeader(b, o) {
  if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const verBits = (b[o + 1] >> 3) & 3;
  const layerBits = (b[o + 1] >> 1) & 3;
  const brIndex = b[o + 2] >> 4;
  const srIndex = (b[o + 2] >> 2) & 3;
  if (verBits === 1 || layerBits === 0 || brIndex === 0 || brIndex === 15 || srIndex === 3) return null;
  const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 25;
  const layer = 4 - layerBits;
  const bitrate = BITRATES[`${version === 1 ? 1 : 2}-${layer}`][brIndex];
  const sampleRate = SAMPLE_RATES[version][srIndex];
  const padding = (b[o + 2] >> 1) & 1;
  const channelMode = b[o + 3] >> 6;
  let length;
  if (layer === 1) length = (Math.floor((12000 * bitrate) / sampleRate) + padding) * 4;
  else if (layer === 3 && version !== 1) length = Math.floor((72000 * bitrate) / sampleRate) + padding;
  else length = Math.floor((144000 * bitrate) / sampleRate) + padding;
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
  return { version, layer, bitrate, sampleRate, channels: channelMode === 3 ? 1 : 2, length, samples, channelMode };
}

export function mp3Info(buf, audioBytes) {
  let o = 0;
  let h = null;
  for (; o + 4 < buf.length; o++) {
    h = frameHeader(buf, o);
    if (!h) continue;
    const next = o + h.length;
    if (next + 4 > buf.length || frameHeader(buf, next)) break;
    h = null;
  }
  if (!h) return { duration: 0, bitrate: 0, sampleRate: 0, channels: 0, codec: 'MP3' };
  const info = { sampleRate: h.sampleRate, channels: h.channels, codec: `MPEG-${h.version === 25 ? '2.5' : h.version} Layer ${h.layer}`, bitrate: h.bitrate, duration: 0, vbr: false };
  const sideInfo = h.version === 1 ? (h.channels === 1 ? 17 : 32) : h.channels === 1 ? 9 : 17;
  const x = o + 4 + sideInfo;
  const tag = ascii(buf, x, 4);
  let frames = 0;
  let bytes = 0;
  if (tag === 'Xing' || tag === 'Info') {
    const flags = readU32BE(buf, x + 4);
    let p = x + 8;
    if (flags & 1) { frames = readU32BE(buf, p); p += 4; }
    if (flags & 2) bytes = readU32BE(buf, p);
    info.vbr = tag === 'Xing';
  } else if (ascii(buf, o + 36, 4) === 'VBRI') {
    bytes = readU32BE(buf, o + 36 + 10);
    frames = readU32BE(buf, o + 36 + 14);
    info.vbr = true;
  }
  if (frames) {
    info.duration = (frames * h.samples) / h.sampleRate;
    info.bitrate = Math.round(((bytes || audioBytes) * 8) / info.duration / 1000);
  } else {
    info.duration = (audioBytes * 8) / (h.bitrate * 1000);
  }
  return info;
}

