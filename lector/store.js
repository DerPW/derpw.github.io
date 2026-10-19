// The unfinished audiobook, kept in IndexedDB so a reload (or Safari dropping the tab)
// does not lose finished chapters. One job at a time: the book, the settings and the
// encoded chapters done so far.

const DB = 'lector-lite';
let dbPromise = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('job');
      req.result.createObjectStore('chapters');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function saveJob(job) {
  try { await tx('job', 'readwrite', (s) => s.put(job, 'current')); } catch { /* best effort */ }
}

export async function loadJob() {
  try { return (await tx('job', 'readonly', (s) => s.get('current'))) || null; } catch { return null; }
}

export async function saveChapter(index, chapter) {
  await tx('chapters', 'readwrite', (s) => s.put(chapter, index));
}

export async function loadChapters() {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const out = new Map();
      const req = d.transaction('chapters').objectStore('chapters').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(out); return; }
        out.set(cur.key, cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return new Map();
  }
}

export async function clear() {
  try {
    await tx('job', 'readwrite', (s) => s.clear());
    await tx('chapters', 'readwrite', (s) => s.clear());
  } catch { /* nothing to clear */ }
}
