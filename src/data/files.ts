// Attachment blobs live in IndexedDB (localStorage is too small for files). Metadata lives in the Db.
const DB_NAME = 'pyc-files';
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export function putBlobs(entries: { id: string; blob: Blob }[]): Promise<unknown> {
  return tx('readwrite', (s) => {
    for (const e of entries) s.put(e.blob, e.id);
  });
}

export function getBlob(id: string): Promise<Blob | undefined> {
  return tx<Blob>('readonly', (s) => s.get(id));
}

export function deleteBlobs(ids: string[]): Promise<unknown> {
  if (ids.length === 0) return Promise.resolve();
  return tx('readwrite', (s) => {
    for (const id of ids) s.delete(id);
  });
}

export function clearBlobs(): Promise<unknown> {
  return tx('readwrite', (s) => {
    s.clear();
  });
}
