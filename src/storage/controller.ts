import type { Profile } from '../calc/types';
import { RULES } from '../config/rules';
import { backupFileName, parseBackup, serializeBackup, summarize, type ImportResult } from '../profile/backup';
import { blankProfile } from '../profile/schema';
import type { FileHandleLike, StorageDeps, StorageMode } from './types';

export const KEYS = {
  mode: 'portfolio.mode',
  profile: 'portfolio.profile',
  lastBackup: 'portfolio.lastBackupAt',
  firstData: 'portfolio.firstDataAt',
  snooze: 'portfolio.nudgeSnoozedAt',
} as const;

const DAY = 86400000;
const SAVE_DEBOUNCE_MS = 600;

export type InitResult =
  | { state: 'chooser' }
  | { state: 'ready'; profile: Profile }
  /** File mode, no file loaded yet. `remembered` is the name of a remembered file, if any. */
  | { state: 'fileGate'; remembered: string | null };

export type FileOutcome =
  | { ok: true; result: Extract<ImportResult, { ok: true }>; fileName: string }
  | { ok: false; error: Extract<ImportResult, { ok: false }>['error'] | 'cancelled' | 'denied' | 'missing' | 'unsupported' | 'failed' };

const hasData = (P: Profile): boolean => {
  const s = summarize(P);
  return s.holdings + s.funds + s.trades + s.watchlist > 0 || s.hasCash || !!(P.cf.income || P.cf.rent);
};

export class StorageController {
  mode: StorageMode | null = null;
  /** File mode: there are changes not yet written to the user's file. */
  dirty = false;
  fileName: string | null = null;
  persisted: boolean | null = null;
  private persistAsked = false;
  /** Called when the browser's answer to the persistent-storage request arrives. */
  onPersistChange: () => void = () => {};
  private handle: FileHandleLike | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Remember the chosen file handle for next time (where the browser supports it). */
  rememberFile = true;

  constructor(private d: StorageDeps) {}

  get fsSupported(): boolean { return !!this.d.fs; }

  async init(): Promise<InitResult> {
    const m = this.d.kv.get(KEYS.mode);
    this.mode = m === 'browser' || m === 'file' ? m : null;
    if (!this.mode && this.d.kv.get(KEYS.profile) !== null) { this.mode = 'browser'; this.d.kv.set(KEYS.mode, 'browser'); } // data from before modes existed
    if (this.mode === 'browser') return { state: 'ready', profile: this.loadBrowserProfile() };
    if (this.mode === 'file') {
      let remembered: string | null = null;
      try { const h = await this.d.handles?.get(); if (h) { this.handle = h; remembered = h.name; } } catch { /* no remembered file */ }
      return { state: 'fileGate', remembered };
    }
    return { state: 'chooser' };
  }

  private loadBrowserProfile(): Profile {
    const raw = this.d.kv.get(KEYS.profile);
    if (raw === null) return blankProfile();
    const r = parseBackup(raw, { allowBare: true });
    return r.ok ? r.profile : blankProfile();
  }

  choose(mode: StorageMode): void {
    this.mode = mode;
    this.d.kv.set(KEYS.mode, mode);
  }

  // ---------- change tracking ----------

  /** Call after every edit. Browser mode: debounced autosave. File mode: just marks the file dirty. */
  noteEdit(getProfile: () => Profile, onSaved: (ok: boolean) => void): void {
    if (this.mode === 'file') { this.dirty = true; return; }
    if (this.mode !== 'browser') return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => onSaved(this.writeBrowser(getProfile())), SAVE_DEBOUNCE_MS);
  }

  writeBrowser(P: Profile): boolean {
    clearTimeout(this.saveTimer);
    P.updatedAt = this.d.now();
    const ok = this.d.kv.set(KEYS.profile, serializeBackup(P, new Date(this.d.now())));
    if (ok && hasData(P) && this.d.kv.get(KEYS.firstData) === null) this.d.kv.set(KEYS.firstData, String(this.d.now()));
    if (ok && !this.persistAsked) {
      this.persistAsked = true;
      this.d.requestPersistence().then((v) => { this.persisted = v; this.onPersistChange(); }, () => { this.persisted = false; this.onPersistChange(); });
    }
    return ok;
  }

  // ---------- backup / export ----------

  /** Downloads a backup file and records the time (resets the backup reminder). */
  exportBackup(P: Profile): void {
    const now = new Date(this.d.now());
    this.d.download(backupFileName(now), serializeBackup(P, now));
    this.d.kv.set(KEYS.lastBackup, String(this.d.now()));
  }

  backupNudge(P: Profile): { show: boolean; days: number; never: boolean } {
    const off = { show: false, days: 0, never: false };
    if (this.mode !== 'browser' || !hasData(P)) return off;
    const last = Number(this.d.kv.get(KEYS.lastBackup)) || 0, first = Number(this.d.kv.get(KEYS.firstData)) || 0;
    const base = last || first;
    if (!base) return off;
    const days = Math.floor((this.d.now() - base) / DAY);
    const snoozed = Number(this.d.kv.get(KEYS.snooze)) || 0;
    if (snoozed && this.d.now() - snoozed < RULES.backup.snoozeDays * DAY) return off;
    return { show: days >= RULES.backup.nudgeDays, days, never: !last };
  }

  snoozeNudge(): void { this.d.kv.set(KEYS.snooze, String(this.d.now())); }

  // ---------- file mode ----------

  private async readHandle(h: FileHandleLike): Promise<FileOutcome> {
    try {
      const f = await h.getFile();
      if (f.size > RULES.backup.maxFileBytes) return { ok: false, error: 'tooLarge' };
      const r = parseBackup(await f.text());
      return r.ok ? { ok: true, result: r, fileName: h.name } : { ok: false, error: r.error };
    } catch (e) {
      return { ok: false, error: (e as { name?: string })?.name === 'NotFoundError' ? 'missing' : 'failed' };
    }
  }

  /** Reads a plain File (picker fallback or drag and drop). */
  async readFileObject(f: { name: string; size: number; text(): Promise<string> }): Promise<FileOutcome> {
    if (f.size > RULES.backup.maxFileBytes) return { ok: false, error: 'tooLarge' };
    try {
      const r = parseBackup(await f.text());
      return r.ok ? { ok: true, result: r, fileName: f.name } : { ok: false, error: r.error };
    } catch { return { ok: false, error: 'failed' }; }
  }

  /** Opens the system file picker (File System Access API) and reads the chosen file. */
  async openWithPicker(): Promise<FileOutcome> {
    if (!this.d.fs) return { ok: false, error: 'unsupported' };
    let h: FileHandleLike | null;
    try { h = await this.d.fs.pickOpen(); } catch { return { ok: false, error: 'cancelled' }; }
    if (!h) return { ok: false, error: 'cancelled' };
    const out = await this.readHandle(h);
    if (out.ok) await this.adopt(h);
    return out;
  }

  /** Re-opens the remembered file. Must be called from a user gesture so the browser can re-ask for permission. */
  async openRemembered(): Promise<FileOutcome> {
    const h = this.handle;
    if (!h) return { ok: false, error: 'missing' };
    try {
      let perm = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
      if (perm !== 'granted') perm = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
      if (perm !== 'granted') return { ok: false, error: 'denied' };
    } catch { return { ok: false, error: 'denied' }; }
    const out = await this.readHandle(h);
    if (out.ok) this.fileName = h.name;
    return out;
  }

  async forgetRemembered(): Promise<void> {
    this.handle = null;
    try { await this.d.handles?.clear(); } catch { /* nothing to forget */ }
  }

  private async adopt(h: FileHandleLike): Promise<void> {
    this.handle = h;
    this.fileName = h.name;
    if (this.rememberFile) { try { await this.d.handles?.set(h); } catch { /* remembering is best effort */ } }
  }

  /** Marks the loaded file as the current one (after the UI applies the imported profile). */
  loaded(fileName: string | null): void { this.dirty = false; this.fileName = fileName; }

  /**
   * Saves to the user's file: overwrites the remembered/open file when possible, otherwise asks where to save
   * (File System Access API) or falls back to a download. Must be called from a user gesture.
   */
  async saveFile(P: Profile): Promise<{ how: 'overwrote' | 'saved-as' | 'downloaded'; fileName: string } | { how: 'failed' | 'cancelled' }> {
    const now = new Date(this.d.now());
    P.updatedAt = this.d.now();
    const text = serializeBackup(P, now);
    try {
      let h = this.handle, how: 'overwrote' | 'saved-as' = 'overwrote';
      if (h) {
        let perm = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
        if (perm !== 'granted') perm = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
        if (perm !== 'granted') h = null;
      }
      if (!h && this.d.fs) {
        h = await this.d.fs.pickSave(backupFileName(now));
        if (!h) return { how: 'cancelled' };
        how = 'saved-as';
        await this.adopt(h);
      }
      if (h) {
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
        this.dirty = false;
        return { how, fileName: h.name };
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return { how: 'cancelled' };
      return { how: 'failed' };
    }
    const name = backupFileName(now);
    this.d.download(name, text);
    this.dirty = false;
    return { how: 'downloaded', fileName: name };
  }

  // ---------- switching modes ----------

  /** Browser -> file. Removes the browser copy of the profile: in file mode nothing is kept in the browser. */
  switchToFile(): void {
    clearTimeout(this.saveTimer);
    this.d.kv.remove(KEYS.profile);
    this.d.kv.remove(KEYS.lastBackup);
    this.d.kv.remove(KEYS.firstData);
    this.d.kv.remove(KEYS.snooze);
    this.choose('file');
    this.dirty = true;
  }

  /** File -> browser. The in-memory profile becomes the browser copy; any remembered file pointer is dropped. */
  async switchToBrowser(P: Profile): Promise<boolean> {
    this.choose('browser');
    await this.forgetRemembered();
    this.fileName = null;
    this.dirty = false;
    return this.writeBrowser(P);
  }

  /** Wipes everything this app stored in the browser (profile, preferences, remembered file pointer). */
  async eraseBrowserData(): Promise<void> {
    clearTimeout(this.saveTimer);
    for (const k of Object.values(KEYS)) this.d.kv.remove(k);
    await this.forgetRemembered();
  }
}
