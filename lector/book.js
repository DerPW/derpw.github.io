// Read EPUBs and plain text into chapters, ported from src/lector/book.py.
//
// EPUB chapters follow the book's table of contents. A TOC entry may point at a whole file or
// at an anchor inside it, so one file can hold many chapters and one chapter can span many
// files. Files the TOC does not mention start a new chapter when they open with a heading and
// continue the previous chapter otherwise. Front and back matter (cover, copyright, contents,
// index, ...) is kept in the list but left unchecked, like very short sections.

import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
import { clean, guessLanguage } from './textprep.js?v=59cf9ca';

const BLOCK_TAGS = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dd', 'dt',
  'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'main', 'table', 'tr', 'td', 'th',
  'figcaption', 'hr', 'body'];
const BLOCK = new Set(BLOCK_TAGS);
const BLOCK_SELECTOR = BLOCK_TAGS.join(',');
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SKIP = ['script', 'style', 'head', 'title', 'nav', 'svg', 'math', 'rt', 'rp', 'img'];
const NOTE_TYPES = new Set(['noteref', 'footnote', 'endnote', 'endnotes', 'rearnote', 'rearnotes', 'footnotes']);
const NON_CONTENT = new RegExp('^(cover|titlepage|title page|titel|half ?title|copyright|impressum|imprint|'
  + 'contents|table of contents|toc|inhalt|inhaltsverzeichnis|index|register|'
  + 'acknowledg(e)?ments?|danksagung|dank|about the authors?|über (den|die) autor(in)?|'
  + 'zum autor|zur autorin|also by|weitere (titel|bücher)|bibliography|bibliografie|'
  + 'literaturverzeichnis|quellen|notes|endnotes|anmerkungen|fußnoten|newsletter|'
  + 'leseprobe|excerpt|colophon|kolophon)(\\b|$)');
export const MIN_WORDS = 40;

const words = (text) => (text.match(/\S+/g) || []).length;

function chapter(title, blocks, include = true, source = '') {
  const text = blocks.map((b) => b[1]).join('\n\n');
  return { title, blocks, include, source, words: words(text), chars: text.length };
}

// --- paths ------------------------------------------------------------------------------

function normPath(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function resolve(base, href) {
  const [path, frag = ''] = decodeURIComponent(href).split('#');
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  return [normPath(path ? dir + path : base), frag];
}

const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

// --- HTML to blocks ---------------------------------------------------------------------

function parseDocument(text, mime = 'application/xhtml+xml') {
  let doc = new DOMParser().parseFromString(text, mime);
  if (doc.getElementsByTagName('parsererror').length) {
    doc = new DOMParser().parseFromString(text, 'text/html');
  }
  return doc;
}

const tag = (el) => (el.localName || '').toLowerCase();

function isNote(el) {
  const kinds = `${el.getAttribute('epub:type') || ''} ${el.getAttribute('role') || ''}`
    .split(/\s+/).map((k) => k.replace(/^doc-/, ''));
  return kinds.some((k) => NOTE_TYPES.has(k));
}

function prepare(doc) {
  for (const name of SKIP) for (const el of [...doc.getElementsByTagName(name)]) el.remove();
  for (const el of [...doc.getElementsByTagName('*')]) {
    if (!el.isConnected) continue;
    if (isNote(el)) el.remove();
    else if (tag(el) === 'sup' && /^[\s\d*†‡,]*$/.test(el.textContent)) el.remove();
  }
  for (const br of [...doc.getElementsByTagName('br')]) br.replaceWith('\n');
  return doc.body || doc.getElementsByTagName('body')[0] || doc.documentElement;
}

const hasBlock = (el) => !!el.querySelector?.(BLOCK_SELECTOR);
function ids(el) {
  const out = new Set([...el.querySelectorAll('[id]')].map((e) => e.getAttribute('id')));
  if (el.getAttribute?.('id')) out.add(el.getAttribute('id'));
  return out;
}

export function htmlToBlocks(text) {
  const root = prepare(parseDocument(text));
  const out = [];
  let pending = new Set();

  const emit = (kind, raw, idSet) => {
    const cleaned = clean(raw);
    if (cleaned) {
      out.push({ kind, text: cleaned, ids: new Set([...pending, ...idSet]) });
      pending = new Set();
    } else idSet.forEach((i) => pending.add(i));
  };

  const walk = (el) => {
    let buf = [];
    let bufIds = new Set();
    const flush = () => {
      if (buf.length) emit('p', buf.join(''), bufIds);
      buf = [];
      bufIds = new Set();
    };
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
        buf.push(child.nodeValue);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const name = tag(child);
      if (BLOCK.has(name) || hasBlock(child)) {
        flush();
        if (child.getAttribute('id')) pending.add(child.getAttribute('id'));
        if (HEADINGS.has(name) && !hasBlock(child)) emit('h', child.textContent.replace(/\s+/g, ' '), ids(child));
        else if (!hasBlock(child)) emit('p', child.textContent, ids(child));
        else walk(child);
      } else {
        buf.push(child.textContent);
        ids(child).forEach((i) => bufIds.add(i));
      }
    }
    flush();
  };
  walk(root);
  return out;
}

// --- EPUB -------------------------------------------------------------------------------

function isNonContent(title, source) {
  const t = title.trim().toLowerCase();
  const stem = basename(source).replace(/\.[^.]+$/, '').toLowerCase();
  return t.includes('project gutenberg') || NON_CONTENT.test(t)
    || /^(cover|title|titlepage|copyright|toc|nav|contents|index|colophon)(\b|$)/.test(stem);
}

function tocEntries(zipText, opfDir, manifest, spineToc) {
  const entries = [];
  const nav = manifest.find((m) => (m.properties || '').split(/\s+/).includes('nav'));
  return (async () => {
    if (nav) {
      const doc = parseDocument(await zipText(nav.path));
      const navs = [...doc.getElementsByTagName('nav')];
      const toc = navs.find((n) => (n.getAttribute('epub:type') || '').includes('toc')) || navs[0];
      for (const a of toc ? toc.getElementsByTagName('a') : []) {
        if (a.getAttribute('href')) {
          const [path, frag] = resolve(nav.path, a.getAttribute('href'));
          entries.push([path, frag, a.textContent.replace(/\s+/g, ' ').trim()]);
        }
      }
    }
    const ncx = manifest.find((m) => m.id === spineToc) || manifest.find((m) => m.type === 'application/x-dtbncx+xml');
    if (!entries.length && ncx) {
      const doc = parseDocument(await zipText(ncx.path), 'application/xml');
      for (const point of doc.getElementsByTagNameNS('*', 'navPoint')) {
        const label = point.getElementsByTagNameNS('*', 'text')[0]?.textContent || '';
        const src = point.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src');
        if (src) {
          const [path, frag] = resolve(ncx.path, src);
          entries.push([path, frag, label.replace(/\s+/g, ' ').trim()]);
        }
      }
    }
    return entries;
  })();
}

export async function parseEpub(file) {
  const zip = await JSZip.loadAsync(file);
  const zipText = async (path) => {
    const entry = zip.file(path) || zip.file(decodeURIComponent(path));
    if (!entry) throw new Error(`missing ${path}`);
    return entry.async('string');
  };
  const container = parseDocument(await zipText('META-INF/container.xml'), 'application/xml');
  const opfPath = container.getElementsByTagNameNS('*', 'rootfile')[0].getAttribute('full-path');
  const opf = parseDocument(await zipText(opfPath), 'application/xml');
  const meta = (name) => opf.getElementsByTagNameNS('*', name)[0]?.textContent.trim() || '';
  const manifest = [...opf.getElementsByTagNameNS('*', 'item')].map((it) => ({
    id: it.getAttribute('id'),
    path: resolve(opfPath, it.getAttribute('href'))[0],
    type: it.getAttribute('media-type') || '',
    properties: it.getAttribute('properties') || '',
  }));
  const byId = Object.fromEntries(manifest.map((m) => [m.id, m]));
  const spineEl = opf.getElementsByTagNameNS('*', 'spine')[0];
  const spine = [...opf.getElementsByTagNameNS('*', 'itemref')].map((r) => byId[r.getAttribute('idref')]).filter(Boolean);

  const toc = await tocEntries(zipText, opfPath, manifest, spineEl?.getAttribute('toc'));
  const tocFiles = new Map();
  for (const [path, frag, title] of toc) {
    if (!tocFiles.has(path)) tocFiles.set(path, []);
    tocFiles.get(path).push([frag, title]);
  }
  const tocBase = new Map([...tocFiles.keys()].map((p) => [basename(p), p]));

  const sections = [];
  let current = null;
  const start = (title, source) => {
    current = { title, blocks: [], source };
    sections.push(current);
    return current;
  };
  for (const item of spine) {
    if (!/x?html/.test(item.type) || (item.properties || '').includes('nav')) continue;
    let blocks;
    try {
      blocks = htmlToBlocks(await zipText(item.path));
    } catch {
      continue;
    }
    if (!blocks.length) continue;
    const entries = tocFiles.get(item.path) || tocFiles.get(tocBase.get(basename(item.path)));
    const starts = new Map();
    for (const [frag, title] of entries || []) {
      if (!frag) { if (!starts.has(0)) starts.set(0, title); continue; }
      const i = blocks.findIndex((b) => b.ids.has(frag));
      if (i >= 0 && !starts.has(i)) starts.set(i, title);
    }
    if (entries && !starts.size) starts.set(0, entries[0][1]);
    blocks.forEach((b, i) => {
      if (starts.has(i)) start(starts.get(i) || b.text.slice(0, 80), item.path);
      else if (i === 0 && (!current || b.kind === 'h')) start(b.kind === 'h' ? b.text.slice(0, 80) : '', item.path);
      current.blocks.push(b);
    });
  }

  // A section that is only a title (a part page like "Teil I") joins the next one.
  const merged = [];
  let carry = [];
  sections.forEach((sec, i) => {
    const blocks = [...carry, ...sec.blocks];
    carry = [];
    const w = sec.blocks.reduce((n, b) => n + words(b.text), 0);
    if (w <= 12 && i < sections.length - 1 && sec.blocks.every((b) => b.kind === 'h')) carry = blocks;
    else merged.push({ ...sec, blocks });
  });

  const chapters = merged.map((sec, n) => {
    let title = (sec.title || '').trim() || sec.blocks.find((b) => b.kind === 'h')?.text || '';
    title = title.slice(0, 120) || String(n + 1);
    const pairs = sec.blocks.map((b) => [b.kind, b.text]);
    const first = pairs[0]?.[1] || '';
    // Make sure the chapter title is spoken once at the start.
    if (!pairs.length || (pairs[0][0] !== 'h' && !first.toLowerCase().startsWith(title.toLowerCase()))) {
      pairs.unshift(['h', title]);
    }
    const ch = chapter(title, pairs, true, sec.source);
    if (isNonContent(title, sec.source) || ch.words < MIN_WORDS) ch.include = false;
    return ch;
  });

  let language = (meta('language') || '').toLowerCase().split('-')[0];
  if (!language) language = guessLanguage(chapters.slice(0, 5).map((c) => c.blocks.map((b) => b[1]).join(' ')).join(' '));

  let coverItem = manifest.find((m) => m.properties.split(/\s+/).includes('cover-image'));
  if (!coverItem) {
    const coverMeta = [...opf.getElementsByTagNameNS('*', 'meta')].find((m) => m.getAttribute('name') === 'cover');
    coverItem = coverMeta && byId[coverMeta.getAttribute('content')];
  }
  if (!coverItem) coverItem = manifest.find((m) => m.type.startsWith('image/') && /cover/i.test(m.id + m.path));
  let cover = null;
  if (coverItem && coverItem.type.startsWith('image/') && zip.file(coverItem.path)) {
    cover = new Blob([await zip.file(coverItem.path).async('uint8array')], { type: coverItem.type });
  }
  return {
    title: meta('title') || file.name.replace(/\.epub$/i, ''),
    author: meta('creator'),
    language,
    chapters,
    cover,
  };
}

// --- plain text -------------------------------------------------------------------------

const HEADING_LINE = /^(#{1,3}\s+.+|(kapitel|chapter|teil|part|buch|book|prolog|prologue|epilog|epilogue|vorwort|nachwort|foreword|afterword|einleitung|introduction)\b.{0,70}|[IVXLC]{1,7}\.?|\d{1,3}\.?)$/i;
const GUTENBERG_START = /\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG.*?\*\*\*/i;
const GUTENBERG_END = /\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i;

function paragraphs(text) {
  text = text.replace(/\r\n?/g, '\n').replace(/(\p{L})-\n(\p{L})/gu, '$1$2');
  const paras = text.trim().includes('\n\n') ? text.split(/\n\s*\n/) : text.split('\n');
  return paras.map((p) => p.trim()).filter(Boolean);
}

export function parseText(text, title = '', author = '') {
  let m = text.match(GUTENBERG_START);
  if (m) text = text.slice(m.index + m[0].length);
  m = text.match(GUTENBERG_END);
  if (m) text = text.slice(0, m.index);
  const sections = [];
  let current = [];
  let currentTitle = '';
  for (const para of paragraphs(text)) {
    if (!para.includes('\n') && para.length <= 80 && HEADING_LINE.test(para.trim())) {
      const heading = para.replace(/^#+/, '').trim();
      if (current.length) sections.push([currentTitle, current]);
      current = [['h', heading]];
      currentTitle = heading;
    } else current.push(['p', para]);
  }
  if (current.length) sections.push([currentTitle, current]);
  title = title.trim() || sections[0]?.[0] || 'Text';
  let chapters;
  if (sections.length <= 1) chapters = [chapter(title, sections[0]?.[1] || [])];
  else {
    chapters = sections.map(([t, blocks], i) => {
      const ch = chapter(t || (i === 0 ? title : String(i + 1)), blocks);
      if (ch.words < 5) ch.include = false;
      return ch;
    });
  }
  return { title, author, language: guessLanguage(text), chapters, cover: null };
}

function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export async function parseFile(file) {
  if (/\.epub$/i.test(file.name)) return parseEpub(file);
  if (/\.(txt|md|text)$/i.test(file.name) || !file.name.includes('.')) {
    return parseText(decode(await file.arrayBuffer()), file.name.replace(/\.[^.]+$/, ''));
  }
  throw new Error(`unsupported:${file.name}`);
}
