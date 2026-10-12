// Eigene Dateien (STL, SVG, DXF, PNG …) für import()/surface() dauerhaft im Browser
// speichern – IndexedDB, mit Rückfall auf den Arbeitsspeicher.

const DB_NAME = 'formwerk';
const STORE = 'files';
const memory = new Map();
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

function tx(d, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function listFiles() {
  const d = await db();
  if (!d) return [...memory.entries()].map(([name, data]) => ({ name, data }));
  try {
    const out = [];
    await new Promise((resolve, reject) => {
      const t = d.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out.push({ name: c.key, data: new Uint8Array(c.value) }); c.continue(); }
      };
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [...memory.entries()].map(([name, data]) => ({ name, data }));
  }
}

export async function putFile(name, data) {
  memory.set(name, data);
  const d = await db();
  if (!d) return;
  try { await tx(d, 'readwrite', (s) => s.put(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), name)); } catch { /* voll/privat */ }
}

export async function deleteFile(name) {
  memory.delete(name);
  const d = await db();
  if (!d) return;
  try { await tx(d, 'readwrite', (s) => s.delete(name)); } catch { /* egal */ }
}
