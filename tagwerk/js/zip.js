// Minimaler ZIP-Schreiber (ohne Kompression – Audio lässt sich ohnehin kaum packen).
import { concat, u16LE, u32LE, utf8 } from './tags/bytes.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [time, day];
}

// files: [{ name: 'Ordner/Datei.mp3', blob }]
export async function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const [time, day] = dosDateTime(new Date());
  for (const { name, blob } of files) {
    const nameBytes = utf8(name);
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const size = blob.size;
    const local = concat([
      u32LE(0x04034b50), u16LE(20), u16LE(0x0800), u16LE(0), u16LE(time), u16LE(day),
      u32LE(crc), u32LE(size), u32LE(size), u16LE(nameBytes.length), u16LE(0), nameBytes,
    ]);
    parts.push(local, blob);
    central.push(concat([
      u32LE(0x02014b50), u16LE(20), u16LE(20), u16LE(0x0800), u16LE(0), u16LE(time), u16LE(day),
      u32LE(crc), u32LE(size), u32LE(size), u16LE(nameBytes.length), u16LE(0), u16LE(0), u16LE(0), u16LE(0),
      u32LE(0), u32LE(offset), nameBytes,
    ]));
    offset += local.length + size;
  }
  const cd = concat(central);
  const end = concat([
    u32LE(0x06054b50), u16LE(0), u16LE(0), u16LE(files.length), u16LE(files.length),
    u32LE(cd.length), u32LE(offset), u16LE(0),
  ]);
  return new Blob([...parts, cd, end], { type: 'application/zip' });
}
