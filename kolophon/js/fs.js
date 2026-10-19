// Dateizugriff: File System Access API (Chrome, Edge, Arc …) mit Rückfallebene für Firefox und Safari.
// Dort werden Kopien eingelesen und geänderte Bücher als Download gesichert.

export const canAccessFS = typeof window.showDirectoryPicker === 'function';
export const canPickFiles = typeof window.showOpenFilePicker === 'function';

const isEpub = (name) => /\.epub$/i.test(name) && !name.startsWith('.');
const splitPath = (path) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
};

/* ------------------------------------------------- File System Access API */

export async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

export async function listDirectory(root) {
  const entries = [];
  async function walk(dir, prefix) {
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`);
      else if (isEpub(name)) entries.push({ path: prefix + name, name, dir: prefix.slice(0, -1), handle, parent: dir });
    }
  }
  await walk(root, '');
  return { source: { mode: 'fsa', name: root.name, root, canWrite: true }, entries };
}

export async function pickFolder() {
  const root = await window.showDirectoryPicker({ id: 'kolophon-library', mode: 'readwrite', startIn: 'documents' });
  rememberFolder(root).catch(() => {});
  return listDirectory(root);
}

export async function pickFiles() {
  const handles = await window.showOpenFilePicker({
    id: 'kolophon-files', multiple: true, startIn: 'documents',
    types: [{ description: 'EPUB-Bücher', accept: { 'application/epub+zip': ['.epub'] } }],
  });
  return {
    source: { mode: 'fsa', name: handles.length === 1 ? handles[0].name : `${handles.length} Dateien`, root: null, canWrite: true },
    entries: handles.map((h) => ({ path: h.name, name: h.name, dir: '', handle: h, parent: null })),
  };
}

/* -------------------------------------------- Rückfallebene: Kopien + Download */

export function listingFromFiles(files, name) {
  const entries = [];
  for (const { file, path } of files) {
    const [dir, fname] = splitPath(path);
    if (!isEpub(fname) || path.split('/').some((s) => s.startsWith('.'))) continue;
    entries.push({ path, name: fname, dir, file });
  }
  return { source: { mode: 'copy', name, root: null, canWrite: false }, entries };
}

function inputPicker({ directory }) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (directory) input.webkitdirectory = true;
    else input.accept = '.epub,application/epub+zip';
    input.style.display = 'none';
    document.body.append(input);
    input.onchange = () => {
      const files = [...input.files];
      input.remove();
      if (!files.length) return reject(new DOMException('Keine Dateien', 'AbortError'));
      if (directory) {
        const rootName = files[0].webkitRelativePath.split('/')[0] || 'Auswahl';
        resolve(listingFromFiles(files.map((file) => ({ file, path: file.webkitRelativePath.split('/').slice(1).join('/') || file.name })), rootName));
      } else {
        resolve(listingFromFiles(files.map((file) => ({ file, path: file.name })), files.length === 1 ? files[0].name : `${files.length} Dateien`));
      }
    };
    input.oncancel = () => { input.remove(); reject(new DOMException('Abgebrochen', 'AbortError')); };
    input.click();
  });
}

export const pickFolderFallback = () => inputPicker({ directory: true });
export const pickFilesFallback = () => inputPicker({ directory: false });

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
      const listing = { source: { mode: 'fsa', name: 'Abgelegte Dateien', root: null, canWrite: true }, entries: [] };
      for (const h of handles) {
        if (h.kind === 'directory') {
          const sub = await listDirectory(h);
          for (const e of sub.entries) listing.entries.push({ ...e, path: `${h.name}/${e.path}`, dir: e.dir ? `${h.name}/${e.dir}` : h.name });
        } else if (isEpub(h.name)) {
          listing.entries.push({ path: h.name, name: h.name, dir: '', handle: h, parent: null });
        }
      }
      if (listing.entries.length === 1) listing.source.name = listing.entries[0].name;
      return listing;
    };
  }
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const loose = entries.length ? [] : [...dataTransfer.files];
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
    if (loose.length) return listingFromFiles(loose.map((file) => ({ file, path: file.name })), 'Abgelegte Dateien');
    if (entries.length === 1 && entries[0].isDirectory) {
      for (const child of await readAll(entries[0].createReader())) await walk(child, '');
      return listingFromFiles(files, entries[0].name);
    }
    for (const e of entries) await walk(e, '');
    const listing = listingFromFiles(files, 'Abgelegte Dateien');
    if (listing.entries.length === 1) listing.source.name = listing.entries[0].name;
    return listing;
  };
}

/* -------------------------------------------------------- Lesen/Schreiben */

export async function getFile(entry) {
  return entry.handle ? entry.handle.getFile() : entry.file;
}

export async function writeFile(entry, bytes) {
  if (!(await ensurePermission(entry.handle))) throw new Error('Kein Schreibzugriff erteilt');
  const writable = await entry.handle.createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (err) {
    await writable.abort?.().catch(() => {});
    throw err;
  }
  return entry.handle.getFile();
}

/* ---------------------------------------------------------- Umbenennen */

/** 'move' wenn die Datei im Ordner umbenannt werden kann, 'download' für Kopien, sonst null. */
export function renameMode(entry, source) {
  if (source?.mode === 'copy') return 'download';
  if (entry.handle && (entry.parent || typeof entry.handle.move === 'function')) return 'move';
  return null;
}

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

/** Benennt eine Datei im selben Ordner um und gibt den neuen Handle zurück. */
export async function renameEntry(entry, newName) {
  if (newName === entry.name) return entry.handle;
  if (!(await ensurePermission(entry.handle))) throw new Error('Kein Schreibzugriff erteilt');
  if (entry.parent && (await exists(entry.parent, newName))) throw new Error(`„${newName}“ gibt es in diesem Ordner schon`);
  if (typeof entry.handle.move === 'function') {
    try {
      await entry.handle.move(newName);
      return entry.handle;
    } catch (err) {
      if (!entry.parent) throw err;
    }
  }
  // Rückfallebene: kopieren und Original löschen
  const target = await entry.parent.getFileHandle(newName, { create: true });
  const writable = await target.createWritable();
  await writable.write(await entry.handle.getFile());
  await writable.close();
  await entry.parent.removeEntry(entry.name);
  return target;
}

/* ---------------------------------------------------- Zuletzt geöffnet */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kolophon-recent', 1);
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
  for (const r of (await recentFolders()).slice(6)) await tx('readwrite', (s) => s.delete(r.id));
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
