import { describe, expect, it, vi } from 'vitest';
import { KEYS, StorageController } from '../../src/storage/controller';
import type { FileHandleLike, FsAccess, HandleStore, KeyValue, StorageDeps } from '../../src/storage/types';
import { APP_ID, serializeBackup } from '../../src/profile/backup';
import { blankProfile, sanitizeProfile } from '../../src/profile/schema';

const DAY = 86400000;
const T0 = Date.parse('2026-10-23T09:00:00Z');

class FakeKv implements KeyValue {
  data = new Map<string, string>();
  failWrites = false;
  get(k: string) { return this.data.get(k) ?? null; }
  set(k: string, v: string) { if (this.failWrites) return false; this.data.set(k, v); return true; }
  remove(k: string) { this.data.delete(k); }
}
class FakeFile implements FileHandleLike {
  writes: string[] = [];
  perm: 'granted' | 'denied' | 'prompt' = 'granted';
  constructor(public name: string, public content: string) {}
  async getFile() { return { size: this.content.length, text: async () => this.content }; }
  async createWritable() { return { write: async (d: string) => { this.writes.push(d); this.content = d; }, close: async () => {} }; }
  async queryPermission() { return this.perm; }
  async requestPermission() { return this.perm === 'prompt' ? 'granted' as const : this.perm; }
}
function setup(over: Partial<StorageDeps> = {}, opts: { handle?: FakeFile | null } = {}) {
  const kv = new FakeKv();
  let now = T0;
  const downloads: Array<[string, string]> = [];
  let stored: FileHandleLike | null = opts.handle ?? null;
  const handles: HandleStore = { get: async () => stored, set: async (h) => { stored = h; }, clear: async () => { stored = null; } };
  const fs: FsAccess = { pickOpen: async () => opts.handle ?? null, pickSave: async () => null };
  const deps: StorageDeps = { kv, handles, fs, now: () => now, download: (n, t) => downloads.push([n, t]), requestPersistence: async () => true, ...over };
  const c = new StorageController(deps);
  return { c, kv, downloads, advance: (ms: number) => { now += ms; }, getStored: () => stored, fs, deps };
}
const withData = () => sanitizeProfile({ rows: [{ n: 'a', t: 'AAA', q: '1', p: '2' }] });

describe('first run and mode choice', () => {
  it('asks for a mode when nothing is stored', async () => {
    expect((await setup().c.init()).state).toBe('chooser');
  });
  it('adopts browser mode silently for data stored before modes existed', async () => {
    const { c, kv } = setup();
    kv.set(KEYS.profile, JSON.stringify({ rows: [{ n: 'legacy', q: '1', p: '1' }] }));
    const r = await c.init();
    expect(r.state === 'ready' && r.profile.rows[0]?.n).toBe('legacy');
    expect(kv.get(KEYS.mode)).toBe('browser');
  });
  it('remembers the chosen mode', async () => {
    const { c, kv } = setup();
    c.choose('file');
    expect(kv.get(KEYS.mode)).toBe('file');
  });
  it('ignores an invalid stored mode', async () => {
    const { c, kv } = setup();
    kv.set(KEYS.mode, 'cloud');
    expect((await c.init()).state).toBe('chooser');
  });
});

describe('browser mode', () => {
  it('debounces autosave and writes the versioned envelope', async () => {
    vi.useFakeTimers();
    try {
      const { c, kv } = setup();
      c.choose('browser');
      await c.init();
      const P = withData();
      const saved = vi.fn();
      c.noteEdit(() => P, saved);
      c.noteEdit(() => P, saved);
      c.noteEdit(() => P, saved);
      expect(kv.get(KEYS.profile)).toBeNull();
      vi.advanceTimersByTime(700);
      expect(saved).toHaveBeenCalledTimes(1);
      expect(saved).toHaveBeenCalledWith(true);
      const o = JSON.parse(kv.get(KEYS.profile) as string);
      expect(o).toMatchObject({ app: APP_ID, version: 3 });
      expect(o.profile.rows[0].n).toBe('a');
    } finally { vi.useRealTimers(); }
  });
  it('reports a failed write and keeps working', () => {
    const { c, kv } = setup();
    c.choose('browser');
    kv.failWrites = true;
    expect(c.writeBrowser(withData())).toBe(false);
  });
  it('loads the saved profile on the next visit', async () => {
    const { c, kv } = setup();
    c.choose('browser');
    c.writeBrowser(withData());
    const c2 = new StorageController({ ...setup().deps, kv });
    const r = await c2.init();
    expect(r.state === 'ready' && r.profile.rows).toHaveLength(1);
  });
  it('falls back to an empty profile when the stored value is corrupt', async () => {
    const { c, kv } = setup();
    kv.set(KEYS.mode, 'browser');
    kv.set(KEYS.profile, '{corrupt');
    const r = await c.init();
    expect(r.state === 'ready' && r.profile).toEqual(blankProfile());
  });
  it('requests persistent storage once, after the first successful save', async () => {
    const requestPersistence = vi.fn(async () => true);
    const { c } = setup({ requestPersistence });
    c.choose('browser');
    c.writeBrowser(withData());
    c.writeBrowser(withData());
    expect(requestPersistence).toHaveBeenCalledTimes(1);
  });
});

describe('backup reminder', () => {
  it('stays quiet at first, then nudges after the configured number of days, and resets on export', () => {
    const { c, advance } = setup();
    c.choose('browser');
    const P = withData();
    expect(c.backupNudge(P).show).toBe(false); // nothing saved yet
    c.writeBrowser(P);
    advance(13 * DAY);
    expect(c.backupNudge(P).show).toBe(false);
    advance(1 * DAY);
    expect(c.backupNudge(P)).toMatchObject({ show: true, days: 14, never: true });
    c.exportBackup(P);
    expect(c.backupNudge(P).show).toBe(false);
    advance(14 * DAY);
    expect(c.backupNudge(P)).toMatchObject({ show: true, never: false });
  });
  it('can be snoozed and then returns', () => {
    const { c, advance } = setup();
    c.choose('browser');
    const P = withData();
    c.writeBrowser(P);
    advance(20 * DAY);
    c.snoozeNudge();
    expect(c.backupNudge(P).show).toBe(false);
    advance(4 * DAY);
    expect(c.backupNudge(P).show).toBe(true);
  });
  it('does not nag when there is no data, or in file mode', () => {
    const { c, advance } = setup();
    c.choose('browser');
    c.writeBrowser(blankProfile());
    advance(100 * DAY);
    expect(c.backupNudge(blankProfile()).show).toBe(false);
    c.choose('file');
    expect(c.backupNudge(withData()).show).toBe(false);
  });
  it('exports a dated file', () => {
    const { c, downloads } = setup();
    c.exportBackup(withData());
    expect(downloads[0]?.[0]).toBe('portfolio-backup-2026-10-23.json');
    expect(JSON.parse(downloads[0]?.[1] as string).app).toBe(APP_ID);
  });
});

describe('file mode', () => {
  it('stores nothing in the browser while editing', async () => {
    const { c, kv } = setup();
    c.choose('file');
    const P = withData();
    c.noteEdit(() => P, () => {});
    c.noteEdit(() => P, () => {});
    expect(c.dirty).toBe(true);
    await new Promise((r) => setTimeout(r, 750));
    expect(kv.get(KEYS.profile)).toBeNull();
    expect([...kv.data.keys()]).toEqual([KEYS.mode]);
  });
  it('shows the file gate on every open, offering a remembered file', async () => {
    const file = new FakeFile('mine.json', serializeBackup(withData(), new Date(T0)));
    const { c, kv } = setup({}, { handle: file });
    kv.set(KEYS.mode, 'file');
    expect(await c.init()).toEqual({ state: 'fileGate', remembered: 'mine.json' });
    const c2 = setup().c;
    c2.choose('file');
    expect(await c2.init()).toEqual({ state: 'fileGate', remembered: null });
  });
  it('re-asks permission for the remembered file and reads it', async () => {
    const file = new FakeFile('mine.json', serializeBackup(withData(), new Date(T0)));
    file.perm = 'prompt';
    const { c, kv } = setup({}, { handle: file });
    kv.set(KEYS.mode, 'file');
    await c.init();
    const out = await c.openRemembered();
    expect(out.ok && out.result.profile.rows).toHaveLength(1);
    expect(out.ok && out.fileName).toBe('mine.json');
  });
  it('degrades when permission is denied or the file is gone', async () => {
    const file = new FakeFile('mine.json', '');
    file.perm = 'denied';
    const { c, kv } = setup({}, { handle: file });
    kv.set(KEYS.mode, 'file');
    await c.init();
    expect(await c.openRemembered()).toEqual({ ok: false, error: 'denied' });
    file.perm = 'granted';
    file.getFile = async () => { throw Object.assign(new Error('gone'), { name: 'NotFoundError' }); };
    expect(await c.openRemembered()).toEqual({ ok: false, error: 'missing' });
  });
  it('rejects bad, oversized and foreign files without touching state', async () => {
    const { c } = setup();
    c.choose('file');
    expect(await c.readFileObject({ name: 'x', size: 10, text: async () => 'nope' })).toEqual({ ok: false, error: 'notJson' });
    expect(await c.readFileObject({ name: 'x', size: 10_000_000, text: async () => '' })).toEqual({ ok: false, error: 'tooLarge' });
    expect(await c.readFileObject({ name: 'x', size: 10, text: async () => JSON.stringify({ app: 'other', version: 3, profile: {} }) })).toEqual({ ok: false, error: 'wrongApp' });
    expect(await c.readFileObject({ name: 'x', size: 1, text: async () => { throw new Error('io'); } })).toEqual({ ok: false, error: 'failed' });
  });
  it('overwrites the open file on save, and clears the dirty flag', async () => {
    const file = new FakeFile('mine.json', serializeBackup(blankProfile(), new Date(T0)));
    const { c, kv } = setup({}, { handle: file });
    kv.set(KEYS.mode, 'file');
    await c.init();
    c.noteEdit(() => withData(), () => {});
    expect(c.dirty).toBe(true);
    const r = await c.saveFile(withData());
    expect(r).toEqual({ how: 'overwrote', fileName: 'mine.json' });
    expect(file.writes).toHaveLength(1);
    expect(JSON.parse(file.content).profile.rows).toHaveLength(1);
    expect(c.dirty).toBe(false);
  });
  it('asks where to save when no file is remembered, and remembers the answer', async () => {
    const target = new FakeFile('new.json', '');
    const { c, fs, getStored } = setup();
    c.choose('file');
    fs.pickSave = async () => target;
    expect(await c.saveFile(withData())).toEqual({ how: 'saved-as', fileName: 'new.json' });
    expect(getStored()).toBe(target);
  });
  it('does not remember the file when the user opts out', async () => {
    const target = new FakeFile('new.json', '');
    const { c, fs, getStored } = setup();
    c.choose('file');
    c.rememberFile = false;
    fs.pickSave = async () => target;
    await c.saveFile(withData());
    expect(getStored()).toBeNull();
  });
  it('falls back to a download where the File System Access API is missing', async () => {
    const { c, downloads } = setup({ fs: null });
    c.choose('file');
    const r = await c.saveFile(withData());
    expect(r.how).toBe('downloaded');
    expect(downloads).toHaveLength(1);
    expect(c.dirty).toBe(false);
  });
  it('treats a cancelled save dialog as cancelled, keeping the dirty flag', async () => {
    const { c, fs } = setup();
    c.choose('file');
    c.dirty = true;
    fs.pickSave = async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); };
    expect(await c.saveFile(withData())).toEqual({ how: 'cancelled' });
    expect(c.dirty).toBe(true);
  });
  it('falls back to save-as when write permission on the remembered file is refused', async () => {
    const old = new FakeFile('old.json', '');
    old.perm = 'denied';
    const fresh = new FakeFile('fresh.json', '');
    const { c, kv, fs } = setup({}, { handle: old });
    kv.set(KEYS.mode, 'file');
    await c.init();
    fs.pickSave = async () => fresh;
    expect(await c.saveFile(withData())).toEqual({ how: 'saved-as', fileName: 'fresh.json' });
  });
});

describe('switching modes', () => {
  it('browser -> file removes the browser copy and its bookkeeping', () => {
    const { c, kv } = setup();
    c.choose('browser');
    c.writeBrowser(withData());
    c.exportBackup(withData());
    c.switchToFile();
    expect(kv.get(KEYS.profile)).toBeNull();
    expect(kv.get(KEYS.lastBackup)).toBeNull();
    expect(kv.get(KEYS.firstData)).toBeNull();
    expect(kv.get(KEYS.mode)).toBe('file');
    expect(c.dirty).toBe(true);
  });
  it('file -> browser stores the in-memory profile and forgets the file pointer', async () => {
    const file = new FakeFile('mine.json', '');
    const { c, kv, getStored } = setup({}, { handle: file });
    kv.set(KEYS.mode, 'file');
    await c.init();
    expect(await c.switchToBrowser(withData())).toBe(true);
    expect(kv.get(KEYS.mode)).toBe('browser');
    expect(JSON.parse(kv.get(KEYS.profile) as string).profile.rows).toHaveLength(1);
    expect(getStored()).toBeNull();
  });
  it('can erase everything the app stored', async () => {
    const { c, kv, getStored } = setup({}, { handle: new FakeFile('x', '') });
    c.choose('browser');
    c.writeBrowser(withData());
    await c.eraseBrowserData();
    expect([...kv.data.keys()]).toEqual([]);
    expect(getStored()).toBeNull();
  });
});
