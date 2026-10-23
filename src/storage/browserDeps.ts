import type { FileHandleLike, FsAccess, HandleStore, KeyValue, StorageDeps } from './types';

export const localKv: KeyValue = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

const DB = 'portfolio-file-handle', STORE = 'h', KEY = 'file';
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((res, rej) => { const rq = fn(db.transaction(STORE, mode).objectStore(STORE)); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  } finally { db.close(); }
}

/** Remembered file handle in IndexedDB. Stores a pointer to the user's file, never the profile data. */
export const idbHandles: HandleStore | null = typeof indexedDB === 'undefined' ? null : {
  async get() { return ((await tx('readonly', (s) => s.get(KEY))) as FileHandleLike | undefined) ?? null; },
  async set(h) { await tx('readwrite', (s) => s.put(h, KEY)); },
  async clear() { await tx('readwrite', (s) => s.delete(KEY)); },
};

interface PickerWindow {
  showOpenFilePicker?: (o: unknown) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FileHandleLike>;
}
const JSON_TYPES = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];

/** File System Access API (Chromium). Null elsewhere: the app then uses the file input and downloads. */
export function detectFs(w: PickerWindow = window as unknown as PickerWindow): FsAccess | null {
  if (typeof w.showOpenFilePicker !== 'function' || typeof w.showSaveFilePicker !== 'function') return null;
  return {
    async pickOpen() { const [h] = await (w.showOpenFilePicker as NonNullable<PickerWindow['showOpenFilePicker']>)({ types: JSON_TYPES, multiple: false }); return h ?? null; },
    async pickSave(name) { return (w.showSaveFilePicker as NonNullable<PickerWindow['showSaveFilePicker']>)({ suggestedName: name, types: JSON_TYPES }); },
  };
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function browserDeps(): StorageDeps {
  return {
    kv: localKv, handles: idbHandles, fs: detectFs(), now: () => Date.now(), download: downloadText,
    requestPersistence: async () => { try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; } },
  };
}
