// EPUB öffnen, Metadaten und Cover lesen, Änderungen zurückschreiben.
import { openZip, findEntry, readEntry, rewriteZip } from './zip.js';
import { parseXML, attr, find, descendants } from './xml.js';
import { readOPF, writeOPF } from './opf.js';
import { sameValue, normalizeField } from './text.js';


const enc = new TextEncoder();

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

/** Löst einen relativen href gegenüber einem Basisordner auf (Prozent-Kodierung, „..“). */
export function resolvePath(baseDir, href) {
  let h = href.split('#')[0].split('?')[0];
  try { h = decodeURIComponent(h); } catch { /* unverändert lassen */ }
  const parts = (h.startsWith('/') ? h.slice(1) : baseDir + h).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

export function relativePath(fromDir, path) {
  const a = fromDir.split('/').filter(Boolean);
  const b = path.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].map((s) => encodeURIComponent(s).replace(/%2F/g, '/')).join('/');
}

const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
export const mimeFromName = (name) => MIME_BY_EXT[name.split('.').pop().toLowerCase()] ?? '';

async function findOPFPath(src, zip) {
  const container = findEntry(zip, 'META-INF/container.xml');
  if (container) {
    try {
      const root = parseXML(decodeText(await readEntry(src, container)));
      const rootfiles = [...descendants(root)].filter((el) => el.local === 'rootfile');
      const rf = rootfiles.find((el) => attr(el, 'media-type') === 'application/oebps-package+xml') ?? rootfiles[0];
      const path = rf && attr(rf, 'full-path');
      if (path && findEntry(zip, path)) return findEntry(zip, path).name;
    } catch { /* weiter mit der Suche */ }
  }
  const opf = zip.entries.find((e) => /\.opf$/i.test(e.name));
  if (opf) return opf.name;
  throw new Error('Keine OPF-Datei gefunden – ist das wirklich ein EPUB?');
}

async function coverFromPage(src, zip, pagePath) {
  const entry = findEntry(zip, pagePath);
  if (!entry || entry.usize > 2_000_000) return null;
  const html = decodeText(await readEntry(src, entry));
  const root = parseXML(html);
  const img = find(root, (el) => el.local === 'img' || el.local === 'image');
  if (!img) return null;
  const href = img.local === 'img' ? attr(img, 'src') : img.attrs.find((a) => /(^|:)href$/.test(a.name))?.value;
  return href ? resolvePath(dirOf(pagePath), href) : null;
}

/** Liest Metadaten und Cover-Ort, ohne die ganze Datei zu laden. */
export async function readBook(src) {
  const zip = await openZip(src);
  const opfPath = await findOPFPath(src, zip);
  const opfText = decodeText(await readEntry(src, findEntry(zip, opfPath)));
  const info = readOPF(opfText);
  const opfDir = dirOf(opfPath);

  let cover = null;
  if (info.cover) {
    const path = resolvePath(opfDir, info.cover.href);
    const entry = findEntry(zip, path);
    if (entry) cover = { path: entry.name, id: info.cover.id, mime: info.cover.mediaType || mimeFromName(path), declared: info.cover.how !== 'name' };
  }
  const coverPage = info.coverPage ? resolvePath(opfDir, info.coverPage) : '';
  if (!cover && coverPage) {
    const path = await coverFromPage(src, zip, coverPage).catch(() => null);
    const entry = path && findEntry(zip, path);
    if (entry && mimeFromName(entry.name)) {
      const item = info.manifest.find((i) => resolvePath(opfDir, i.href) === entry.name);
      cover = { path: entry.name, id: item?.id ?? '', mime: item?.mediaType || mimeFromName(entry.name), declared: false };
    }
  }

  return {
    zip,
    opfPath,
    opfText,
    version: info.version,
    v3: info.v3,
    meta: info.meta,
    descriptionHTML: info.descriptionHTML,
    uid: info.uid,
    cover,
    coverPage,
    repaired: Boolean(zip.recovered),
    encrypted: Boolean(findEntry(zip, 'META-INF/encryption.xml')),
    drm: Boolean(findEntry(zip, 'META-INF/rights.xml')),
  };
}

export async function readCover(src, book) {
  if (!book.cover) return null;
  const entry = findEntry(book.zip, book.cover.path);
  if (!entry) return null;
  const data = await readEntry(src, entry);
  return new Blob([data], { type: book.cover.mime || mimeFromName(entry.name) || 'image/jpeg' });
}

// Cover-Seiten mit festem SVG-Rahmen an das Seitenverhältnis des neuen Bildes anpassen.
function fitSvgCoverPage(html, coverName, width, height) {
  if (!/<svg\b/i.test(html) || !html.includes(coverName)) return null;
  let changed = false;
  const out = html
    .replace(/(<svg\b[^>]*?\bviewBox\s*=\s*["'])\s*0\s+0\s+[\d.]+\s+[\d.]+\s*(["'])/i, (m, a, b) => { changed = true; return `${a}0 0 ${width} ${height}${b}`; })
    .replace(/<image\b[^>]*>/gi, (tag) => {
      if (!tag.includes(coverName)) return tag;
      changed = true;
      return tag.replace(/\bwidth\s*=\s*["'][^"']*["']/i, `width="${width}"`).replace(/\bheight\s*=\s*["'][^"']*["']/i, `height="${height}"`);
    });
  return changed && out !== html ? out : null;
}

/**
 * Schreibt die Änderungen und gibt das neue EPUB als Uint8Array zurück.
 * changes: { feld: wert }, newCover: { bytes: Uint8Array, mime, width, height } | null
 */
export async function writeBook(src, book, changes, newCover = null) {
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(await src.arrayBuffer());
  const zip = await openZip(bytes);
  const opfDir = dirOf(book.opfPath);
  const files = new Map();
  let coverPlan = null;

  if (newCover) {
    if (book.cover) {
      files.set(book.cover.path, newCover.bytes);
      coverPlan = { id: book.cover.id, declare: !book.cover.declared };
      if (newCover.mime && newCover.mime !== book.cover.mime) coverPlan.setMediaType = newCover.mime;
    } else {
      const ext = newCover.mime === 'image/png' ? 'png' : 'jpg';
      let path = `${opfDir}cover.${ext}`;
      for (let i = 2; findEntry(zip, path); i++) path = `${opfDir}cover-${i}.${ext}`;
      files.set(path, newCover.bytes);
      coverPlan = { add: { href: relativePath(opfDir, path), mediaType: newCover.mime || 'image/jpeg' } };
    }
    if (book.cover && newCover.width && newCover.height && book.coverPage) {
      const page = findEntry(zip, book.coverPage);
      if (page && page.usize < 2_000_000) {
        const html = decodeText(await readEntry(bytes, page));
        const name = book.cover.path.split('/').pop();
        const fitted = fitSvgCoverPage(html, name, newCover.width, newCover.height);
        if (fitted) files.set(page.name, enc.encode(fitted));
      }
    }
  }

  const opf = writeOPF(book.opfText, changes, { cover: coverPlan, descriptionHTML: book.descriptionHTML });
  files.set(book.opfPath, enc.encode(opf));
  const out = await rewriteZip(bytes, zip, files);

  // Gegenprobe: Ergebnis neu einlesen und die geänderten Felder vergleichen.
  const check = await readBook(out);
  for (const [field, value] of Object.entries(changes)) {
    if (field === 'title' && !normalizeField('title', value)) continue;
    if (field === 'language' && !normalizeField('language', value).length) continue;
    if (field === 'seriesIndex' && !check.meta.series) continue;
    if (!sameValue(field, check.meta[field], value)) {
      throw new Error(`Gegenprobe fehlgeschlagen für „${field}“ – Datei wurde nicht verändert`);
    }
  }
  if (newCover && !check.cover) throw new Error('Gegenprobe fehlgeschlagen: Cover nicht gefunden');
  return out;
}
