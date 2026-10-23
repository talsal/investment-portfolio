export type StorageMode = 'browser' | 'file';

/** The subset of the File System Access API's FileSystemFileHandle that the app uses. */
export interface FileHandleLike {
  readonly name: string;
  getFile(): Promise<{ size: number; text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export interface FsAccess {
  pickOpen(): Promise<FileHandleLike | null>;
  pickSave(suggestedName: string): Promise<FileHandleLike | null>;
}

/** Synchronous key/value storage for small preferences and the browser-mode profile (localStorage-like). */
export interface KeyValue {
  get(key: string): string | null;
  /** Returns false when the write fails (quota, private mode, blocked storage). */
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

/** Persists a single remembered file handle (a pointer to the user's file, not the data itself). */
export interface HandleStore {
  get(): Promise<FileHandleLike | null>;
  set(h: FileHandleLike): Promise<void>;
  clear(): Promise<void>;
}

export interface StorageDeps {
  kv: KeyValue;
  handles: HandleStore | null;
  fs: FsAccess | null;
  now(): number;
  download(filename: string, text: string): void;
  requestPersistence(): Promise<boolean>;
}
