// Teilen per Link: Projekt als komprimiertes JSON im URL-Fragment (#p=…).
// Das Fragment wird nie an einen Server geschickt.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function encodeProject(project) {
  const json = enc.encode(JSON.stringify(project));
  if (typeof CompressionStream === 'function') {
    return 'z' + toB64url(await pipe(json, new CompressionStream('deflate-raw')));
  }
  return 'j' + toB64url(json);
}

export async function decodeProject(token) {
  const kind = token[0];
  const bytes = fromB64url(token.slice(1));
  const json = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(dec.decode(json));
}

export async function shareUrl(project) {
  const url = new URL(location.href);
  url.hash = 'p=' + (await encodeProject(project));
  return url.toString();
}

export function readHashToken() {
  const m = /^#p=([A-Za-z0-9_-]+)$/.exec(location.hash);
  return m ? m[1] : null;
}
