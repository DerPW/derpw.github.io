// Dateizugriff: File System Access API (Chrome/Edge) mit Fallback auf Einlesen + Download.
import { AUDIO_EXTENSIONS, extOf } from './tags/index.js';

export const canAccessFS = typeof window.showDirectoryPicker === 'function';
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];

const splitPath = (path) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
};

function emptyListing(source) {
  return { source, entries: [], images: new Map() };
}

function addImage(listing, dir, item) {
  if (!listing.images.has(dir)) listing.images.set(dir, []);
  listing.images.get(dir).push(item);
}

/* ------------------------------------------------- File System Access API */

export async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

export async function listDirectory(root, { recursive = true } = {}) {
  const listing = emptyListing({ mode: 'fsa', name: root.name, root, canWrite: true });
  async function walk(dir, prefix) {
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (handle.kind === 'directory') {
        if (recursive) await walk(handle, `${prefix}${name}/`);
        continue;
      }
      const ext = extOf(name);
      const relDir = prefix.slice(0, -1);
      if (AUDIO_EXTENSIONS.includes(ext)) listing.entries.push({ path: prefix + name, name, dir: relDir, ext, handle, parent: dir });
      else if (IMAGE_EXT.includes(ext)) addImage(listing, relDir, { name, getBlob: () => handle.getFile() });
    }
  }
  await walk(root, '');
  return listing;
}

export async function pickFolder() {
  const root = await window.showDirectoryPicker({ id: 'tagwerk-library', mode: 'readwrite', startIn: 'music' });
  rememberFolder(root).catch(() => {});
  return listDirectory(root);
}

/* -------------------------------------------- Fallback: Einlesen + Download */

export function listingFromFiles(files, name) {
  const listing = emptyListing({ mode: 'download', name, root: null, canWrite: false });
  for (const { file, path } of files) {
    const [dir, fname] = splitPath(path);
    if (fname.startsWith('.') || path.split('/').some((s) => s.startsWith('.'))) continue;
    const ext = extOf(fname);
    if (AUDIO_EXTENSIONS.includes(ext)) listing.entries.push({ path, name: fname, dir, ext, blob: file });
    else if (IMAGE_EXT.includes(ext)) addImage(listing, dir, { name: fname, getBlob: async () => file });
  }
  return listing;
}

export function pickFolderFallback() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.onchange = () => {
      const files = [...input.files];
      if (!files.length) return reject(new DOMException('Keine Dateien', 'AbortError'));
      const rootName = files[0].webkitRelativePath.split('/')[0] || 'Auswahl';
      resolve(listingFromFiles(files.map((file) => ({ file, path: file.webkitRelativePath.split('/').slice(1).join('/') || file.name })), rootName));
    };
    input.oncancel = () => reject(new DOMException('Abgebrochen', 'AbortError'));
    input.click();
  });
}

/* ------------------------------------------------------------ Drag & Drop */

// Muss synchron im drop-Handler aufgerufen werden – danach sind die Items ungültig.
export function captureDrop(dataTransfer) {
  const items = [...dataTransfer.items].filter((i) => i.kind === 'file');
  if (canAccessFS && items.length && 'getAsFileSystemHandle' in items[0]) {
    const promises = items.map((i) => i.getAsFileSystemHandle());
    return async () => {
      const handles = (await Promise.all(promises)).filter(Boolean);
      if (handles.length === 1 && handles[0].kind === 'directory') {
        if (!(await ensurePermission(handles[0]))) throw new Error('Kein Schreibzugriff auf den Ordner erteilt');
        rememberFolder(handles[0]).catch(() => {});
        return listDirectory(handles[0]);
      }
      const listing = emptyListing({ mode: 'fsa', name: 'Abgelegte Dateien', root: null, canWrite: true });
      for (const h of handles) {
        if (h.kind === 'directory') {
          const sub = await listDirectory(h);
          for (const e of sub.entries) listing.entries.push({ ...e, path: `${h.name}/${e.path}`, dir: e.dir ? `${h.name}/${e.dir}` : h.name });
        } else if (AUDIO_EXTENSIONS.includes(extOf(h.name))) {
          listing.entries.push({ path: h.name, name: h.name, dir: '', ext: extOf(h.name), handle: h, parent: null });
        }
      }
      return listing;
    };
  }
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  return async () => {
    const files = [];
    const readAll = (reader) => new Promise((res, rej) => {
      const out = [];
      const next = () => reader.readEntries((batch) => (batch.length ? (out.push(...batch), next()) : res(out)), rej);
      next();
    });
    async function walk(entry, prefix) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        files.push({ file, path: prefix + entry.name });
      } else if (entry.isDirectory) {
        for (const child of await readAll(entry.createReader())) await walk(child, `${prefix}${entry.name}/`);
      }
    }
    const single = entries.length === 1 && entries[0].isDirectory;
    if (single) {
      for (const child of await readAll(entries[0].createReader())) await walk(child, '');
      return listingFromFiles(files, entries[0].name);
    }
    for (const e of entries) await walk(e, '');
    return listingFromFiles(files, 'Abgelegte Dateien');
  };
}

/* -------------------------------------------------------- Lesen/Schreiben */

export async function getBlob(file) {
  return file.handle ? file.handle.getFile() : file.blob;
}

export async function writeFile(file, blob) {
  // Erst komplett in den Speicher holen: Die Quelle ist evtl. dieselbe Datei, die gleich ersetzt wird.
  const data = await blob.arrayBuffer();
  const writable = await file.handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (err) {
    await writable.abort?.().catch(() => {});
    throw err;
  }
  return file.handle.getFile();
}

/* ---------------------------------------------------------- Umbenennen */

async function dirAt(root, relDir, create) {
  let dir = root;
  for (const seg of relDir.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(seg, { create });
  return dir;
}

async function tryGetFile(dir, name) {
  try { return await dir.getFileHandle(name); } catch { return null; }
}

async function moveHandle(handle, srcDir, srcName, dstDir, dstName) {
  if (typeof handle.move === 'function') {
    try {
      if (await srcDir.isSameEntry(dstDir)) await handle.move(dstName);
      else await handle.move(dstDir, dstName);
      return await dstDir.getFileHandle(dstName);
    } catch (err) {
      if (err.name === 'NoModificationAllowedError' || err.name === 'InvalidModificationError') throw err;
      // sonst: Kopieren + Löschen als Rückfallebene
    }
  }
  const target = await dstDir.getFileHandle(dstName, { create: true });
  const writable = await target.createWritable();
  await writable.write(await handle.getFile());
  await writable.close();
  await srcDir.removeEntry(srcName);
  return target;
}

// ops: [{ file, target }] – target ist ein Pfad relativ zum Wurzelordner.
export async function renameFiles(root, ops, { removeEmptyDirs = true } = {}) {
  const results = new Map();
  const fail = (op, msg) => results.set(op.file.id, { ok: false, error: msg });
  const seen = new Map();
  let needsTemp = false;
  const plan = [];

  for (const op of ops) {
    const key = op.target.toLowerCase();
    if (seen.has(key)) { fail(op, 'Doppelter Zielname'); continue; }
    seen.set(key, op);
    const [dstPath, dstName] = splitPath(op.target);
    let dstDir = null;
    try { dstDir = await dirAt(root, dstPath, false); } catch { /* Ordner entsteht neu */ }
    const existing = dstDir && (await tryGetFile(dstDir, dstName));
    if (existing) {
      const self = await existing.isSameEntry(op.file.handle);
      let other = false;
      if (!self) for (const o of ops) if (o !== op && (await existing.isSameEntry(o.file.handle))) { other = true; break; }
      if (!self && !other) { fail(op, 'Zieldatei existiert bereits'); continue; }
      needsTemp = true;
    }
    plan.push({ ...op, dstPath, dstName });
  }

  const moved = [];
  if (needsTemp) {
    for (const p of plan) {
      try {
        p.tmpName = `.tagwerk-${Math.random().toString(36).slice(2, 8)}-${p.file.name}`;
        p.handle = await moveHandle(p.file.handle, p.file.parent, p.file.name, p.file.parent, p.tmpName);
      } catch (err) { fail(p, err.message); p.skip = true; }
    }
  }
  for (const p of plan) {
    if (p.skip) continue;
    try {
      const dstDir = await dirAt(root, p.dstPath, true);
      const existing = await tryGetFile(dstDir, p.dstName);
      if (existing && !(await existing.isSameEntry(p.handle ?? p.file.handle))) throw new Error('Zieldatei existiert bereits');
      const handle = await moveHandle(p.handle ?? p.file.handle, p.file.parent, p.tmpName ?? p.file.name, dstDir, p.dstName);
      results.set(p.file.id, { ok: true, handle, parent: dstDir, path: p.target, name: p.dstName, dir: p.dstPath, oldDir: p.file.dir });
      moved.push(p);
    } catch (err) {
      fail(p, err.message);
      // Temporären Namen wieder zurücksetzen, damit keine Datei "verschwindet".
      if (p.tmpName) await moveHandle(p.handle, p.file.parent, p.tmpName, p.file.parent, p.file.name).catch(() => {});
    }
  }

  if (removeEmptyDirs) {
    const dirs = [...new Set(moved.map((p) => p.file.dir).filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const d of dirs) await removeIfEmpty(root, d).catch(() => {});
  }
  return results;
}

async function removeIfEmpty(root, relDir) {
  let path = relDir;
  while (path) {
    const [parentPath, name] = splitPath(path);
    const parent = await dirAt(root, parentPath, false);
    const dir = await parent.getDirectoryHandle(name);
    let empty = true;
    for await (const [entry] of dir.entries()) if (entry !== '.DS_Store' && entry !== 'Thumbs.db') { empty = false; break; }
    if (!empty) return;
    await parent.removeEntry(name, { recursive: true });
    path = parentPath;
  }
}

/* ---------------------------------------------------- Zuletzt geöffnet */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tagwerk', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recent', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recent', mode);
    const result = fn(t.objectStore('recent'));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export async function recentFolders() {
  if (!canAccessFS) return [];
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.time - a.time);
  } catch { return []; }
}

export async function rememberFolder(handle) {
  const list = await recentFolders();
  for (const r of list) if (await r.handle.isSameEntry(handle)) await tx('readwrite', (s) => s.delete(r.id));
  await tx('readwrite', (s) => s.put({ id: Date.now(), name: handle.name, handle, time: Date.now() }));
  const rest = (await recentFolders()).slice(6);
  for (const r of rest) await tx('readwrite', (s) => s.delete(r.id));
}

export async function forgetFolder(id) {
  await tx('readwrite', (s) => s.delete(id));
}

export async function openRecent(entry) {
  if (!(await ensurePermission(entry.handle))) throw new Error('Kein Zugriff auf den Ordner erteilt');
  rememberFolder(entry.handle).catch(() => {});
  return listDirectory(entry.handle);
}

/* ------------------------------------------------------------ Download */

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
