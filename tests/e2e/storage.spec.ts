import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp as baseOpenApp } from './appHarness';

const openApp: typeof baseOpenApp = async (b, o) => {
  const r = await baseOpenApp(b, o);
  await r.page.evaluate(() => { const d = document.getElementById('storageCard') as HTMLDetailsElement | null; if (d) d.open = true; });
  return r;
};

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const pack = fx('pack-fake');
const profile = fx('profile-fake');
const backupText = (p: unknown, version = 3) => JSON.stringify({ app: 'portfolio-pilot', version, exportedAt: '2026-10-01T00:00:00.000Z', profile: p });
const file = (text: string, name = 'backup.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
/** The storage card is collapsed by default in browser mode. */

const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const keys = (page: Page) => page.evaluate(() => Object.keys(localStorage).sort());

test.describe('first run: choosing where data lives', () => {
  test('a new visitor must choose a storage mode before anything else', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: {}, pack, mode: 'none', seed: false });
    await expect(page.locator('#modeChooser')).toBeVisible();
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('#fileGate')).toBeHidden();
    expect(await keys(page)).toEqual([]); // nothing is written before the choice
    expect(errors).toEqual([]);
    await close();
  });

  test('choosing browser mode opens the workspace and the choice is remembered', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'none', seed: false });
    await page.click('#chooseBrowser');
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#stMode')).toContainText('בדפדפן');
    expect(await stored(page, 'portfolio.mode')).toBe('browser');
    await page.reload();
    await expect(page.locator('#modeChooser')).toBeHidden();
    await expect(page.locator('#workspace')).toBeVisible();
    await close();
  });

  test('focus moves to the new view and the browser reports whether storage is persistent', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'none', seed: false });
    await page.click('#chooseBrowser');
    await expect(page.locator('h1')).toBeFocused();
    await page.fill('[data-top="cashNis"]', '1');
    await expect(page.locator('#stPersist')).not.toHaveText('', { timeout: 5000 });
    await close();
  });

  test('choosing file mode shows the file gate', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'none', seed: false });
    await page.click('#chooseFile');
    await expect(page.locator('#fileGate')).toBeVisible();
    await expect(page.locator('#workspace')).toBeHidden();
    expect(await stored(page, 'portfolio.mode')).toBe('file');
    await close();
  });
});

test.describe('browser mode', () => {
  test('autosaves a versioned envelope, warns about site data, and restores on reload', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await expect(page.locator('#stBrowserWarn')).toContainText('ניקוי נתוני אתר');
    await page.fill('[data-top="cashNis"]', '12345');
    await page.waitForTimeout(800);
    const o = JSON.parse((await stored(page, 'portfolio.profile')) as string);
    expect(o).toMatchObject({ app: 'portfolio-pilot', version: 3 });
    expect(o.profile.cashNis).toBe('12345');
    await page.reload();
    await expect(page.locator('[data-top="cashNis"]')).toHaveValue('12345');
    await close();
  });

  test('exports a backup file with the documented format', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stExport')]);
    expect(dl.suggestedFilename()).toBe('portfolio-backup-2026-10-23.json');
    const o = JSON.parse(readFileSync((await dl.path()) as string, 'utf8'));
    expect(Object.keys(o).sort()).toEqual(['app', 'exportedAt', 'profile', 'version']);
    expect(o.version).toBe(3);
    expect(o.profile.rows).toHaveLength(10);
    await close();
  });

  test('import shows a preview, needs confirmation, and replaces the data', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { cashNis: '5' }, pack });
    await page.locator('#stFile').setInputFiles(file(backupText(profile)));
    await expect(page.locator('#importPreview')).toBeVisible();
    await expect(page.locator('#ipP')).toContainText('10 ניירות ערך');
    await expect(page.locator('[data-top="cashNis"]')).toHaveValue('5'); // nothing changed yet
    await page.click('#ipConfirm');
    await expect(page.locator('[data-top="cashNis"]')).toHaveValue('12000');
    await page.waitForTimeout(800);
    expect(JSON.parse((await stored(page, 'portfolio.profile')) as string).profile.cashNis).toBe('12000');
    await close();
  });

  test('a prototype (v2) backup is migrated and says so', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await page.locator('#stFile').setInputFiles(file(backupText(profile, 2)));
    await expect(page.locator('#ipP')).toContainText('מגרסה 2');
    await page.click('#ipConfirm');
    await expect(page.locator('#inRows .in-row')).toHaveCount(10);
    await close();
  });

  test('cancelling the preview leaves the data alone', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { cashNis: '5' }, pack });
    await page.locator('#stFile').setInputFiles(file(backupText(profile)));
    await page.click('#ipCancel');
    await expect(page.locator('#importPreview')).toBeHidden();
    await expect(page.locator('[data-top="cashNis"]')).toHaveValue('5');
    await close();
  });

  for (const [label, text, expected] of [
    ['not JSON', '{oops', 'אינו JSON תקין'],
    ['another app', JSON.stringify({ app: 'other', version: 3, profile: {} }), 'ליישום אחר'],
    ['a newer version', backupText({}, 99), 'גרסה חדשה יותר'],
    ['a file that is not a backup', '{"hello":1}', 'אינו קובץ גיבוי'],
  ] as const) {
    test(`rejects ${label} with a clear message and no state change`, async ({ browser }) => {
      const { page, errors, close } = await openApp(browser, { profile: { cashNis: '5' }, pack });
      await page.locator('#stFile').setInputFiles(file(text));
      await expect(page.locator('#stMsg')).toContainText(expected);
      await expect(page.locator('#importPreview')).toBeHidden();
      await expect(page.locator('[data-top="cashNis"]')).toHaveValue('5');
      expect(errors).toEqual([]);
      await close();
    });
  }

  test('an oversized file is refused', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack });
    await page.locator('#stFile').setInputFiles(file('x'.repeat(600 * 1024)));
    await expect(page.locator('#stMsg')).toContainText('גדול מדי');
    await close();
  });

  test('a backup dropped on the drop zone is read like a picked one', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack });
    await page.evaluate((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'dropped.json', { type: 'application/json' }));
      document.getElementById('stDrop')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, backupText(profile));
    await expect(page.locator('#importPreview')).toBeVisible();
    await close();
  });

  test('dropping a file outside the zones does not navigate away', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack });
    const prevented = await page.evaluate(() => {
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await close();
  });
});

test.describe('backup reminder', () => {
  test('appears after the configured number of days without a backup, and export resets it', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await expect(page.locator('#backupNudge')).toBeHidden();
    await page.evaluate(() => localStorage.setItem('portfolio.firstDataAt', String(Date.now() - 15 * 86400000)));
    await page.reload();
    await expect(page.locator('#backupNudge')).toBeVisible();
    await expect(page.locator('#backupNudge')).toContainText('ייצאת גיבוי');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#backupNudge button').first().click()]);
    expect(dl.suggestedFilename()).toMatch(/^portfolio-backup-/);
    await expect(page.locator('#backupNudge')).toBeHidden();
    await close();
  });

  test('can be snoozed', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await page.evaluate(() => localStorage.setItem('portfolio.firstDataAt', String(Date.now() - 30 * 86400000)));
    await page.reload();
    await page.locator('#backupNudge button').nth(1).click();
    await expect(page.locator('#backupNudge')).toBeHidden();
    await page.reload();
    await expect(page.locator('#backupNudge')).toBeHidden();
    await close();
  });
});

test.describe('file mode', () => {
  test('nothing about the profile is stored in the browser', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false });
    await expect(page.locator('#fileGate')).toBeVisible();
    await page.click('#gateNew');
    await page.fill('[data-top="cashNis"]', '777');
    await page.click('#addRow');
    await page.fill('[data-f="n"]', 'secret holding');
    await page.waitForTimeout(900);
    expect(await keys(page)).toEqual(['portfolio.mode']);
    const dump = await page.evaluate(async () => {
      const all = JSON.stringify(localStorage);
      const dbs = (await indexedDB.databases?.()) ?? [];
      return { all, dbs: dbs.map((d) => d.name) };
    });
    expect(dump.all).not.toContain('777');
    expect(dump.all).not.toContain('secret');
    expect(dump.dbs.filter((n) => n !== 'portfolio-file-handle')).toEqual([]);
    await close();
  });

  test('every open asks for the file; picking one loads it with no unsaved-changes flag', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false });
    await page.locator('#gateFile').setInputFiles(file(backupText(profile), 'my-portfolio.json'));
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#inRows .in-row')).toHaveCount(10);
    await expect(page.locator('#inStatus')).toContainText('נטען הקובץ my-portfolio.json');
    await page.fill('[data-top="cashNis"]', '1');
    await expect(page.locator('#inStatus')).toContainText('שינויים שלא נשמרו');
    await page.reload(); // data is gone from the page: the gate comes back
    await expect(page.locator('#fileGate')).toBeVisible();
    await expect(page.locator('#workspace')).toBeHidden();
    await close();
  });

  test('a bad file at the gate shows an error and stays at the gate', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false });
    await page.locator('#gateFile').setInputFiles(file('nope'));
    await expect(page.locator('#gateMsg')).toContainText('אינו JSON תקין');
    await expect(page.locator('#fileGate')).toBeVisible();
    await close();
  });

  test('drag and drop works at the gate', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false });
    await page.evaluate((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'dropped.json', { type: 'application/json' }));
      document.getElementById('gateDrop')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, backupText(profile));
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#inRows .in-row')).toHaveCount(10);
    await close();
  });

  test('without the File System Access API, saving downloads the file', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false, beforeLoad: NO_FS });
    await page.locator('#gateFile').setInputFiles(file(backupText(profile)));
    await page.fill('[data-top="cashNis"]', '4242');
    await expect(page.locator('#stRememberRow')).toBeHidden(); // nothing to remember without handles
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stSave')]);
    const o = JSON.parse(readFileSync((await dl.path()) as string, 'utf8'));
    expect(o.profile.cashNis).toBe('4242');
    await expect(page.locator('#inStatus')).toContainText('אין שינויים');
    await close();
  });
});

/**
 * Installs a fake File System Access API before the app loads. Files and the permission state live in
 * sessionStorage so they survive reloads; the remembered handle is stored in the app's real IndexedDB as a
 * marker (real handles are structured-cloneable, fakes with functions are not) and rebuilt on read.
 */
const FAKE_FS = `(() => {
  const read = () => JSON.parse(sessionStorage.getItem('__files') || '{}');
  const write = (o) => sessionStorage.setItem('__files', JSON.stringify(o));
  const count = (k) => sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) || 0) + 1));
  const perm = () => sessionStorage.getItem('__perm') || 'granted';
  const mk = (name) => ({
    name,
    async getFile() { const t = read()[name] ?? ''; return { size: t.length, text: async () => t }; },
    async createWritable() { let buf = ''; return { write: async (d) => { buf += d; }, close: async () => { const f = read(); f[name] = buf; write(f); count('__writes'); } }; },
    async queryPermission() { return perm(); },
    async requestPermission() { count('__permAsks'); sessionStorage.setItem('__perm', 'granted'); return 'granted'; },
  });
  window.showOpenFilePicker = async () => { count('__open'); return [mk(sessionStorage.getItem('__openName') || 'mine.json')]; };
  window.showSaveFilePicker = async (o) => { count('__save'); return mk(sessionStorage.getItem('__saveName') || o.suggestedName); };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) { return put.call(this, v && typeof v.getFile === 'function' ? { __fakeHandle: v.name } : v, k); };
  const get = IDBObjectStore.prototype.get;
  const resultDesc = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
  IDBObjectStore.prototype.get = function (k) {
    const req = get.call(this, k);
    Object.defineProperty(req, 'result', { get() { const r = resultDesc.get.call(req); return r && r.__fakeHandle ? mk(r.__fakeHandle) : r; } });
    return req;
  };
})();`;

/** Simulates browsers without the File System Access API (Safari, Firefox): headless Chromium has it. */
const NO_FS = async (page: Page) => { await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker; }); };

const num = (page: Page, k: string) => page.evaluate((key) => Number(sessionStorage.getItem(key) || 0), k);
const setFile = (page: Page, name: string, text: string) => page.evaluate(([n, t]) => { const f = JSON.parse(sessionStorage.getItem('__files') || '{}'); f[n as string] = t; sessionStorage.setItem('__files', JSON.stringify(f)); }, [name, text]);
const getFile = (page: Page, name: string) => page.evaluate((n) => JSON.parse(sessionStorage.getItem('__files') || '{}')[n] as string, name);

test.describe('file mode with the File System Access API', () => {
  const withFs = (browser: Parameters<typeof openApp>[0]) =>
    openApp(browser, { profile: {}, pack, mode: 'file', seed: false, beforeLoad: async (page) => { await page.addInitScript(FAKE_FS); } });

  test('open with the picker, edit, save overwrites the same file (no dialog)', async ({ browser }) => {
    const { page, errors, close } = await withFs(browser);
    await setFile(page, 'mine.json', backupText(profile));
    await page.click('#gateOpen');
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#stFileInfo')).toContainText('mine.json');
    await page.fill('[data-top="cashNis"]', '999');
    await page.click('#stSave');
    await expect(page.locator('#stMsg')).toContainText('mine.json עודכן');
    const saved = JSON.parse(await getFile(page, 'mine.json'));
    expect(saved.profile.cashNis).toBe('999');
    expect(saved.version).toBe(3);
    expect(await num(page, '__save')).toBe(0);
    expect(await num(page, '__writes')).toBe(1);
    expect(errors).toEqual([]);
    await close();
  });

  test('save with no file yet asks where to save, and the file is remembered for the next visit', async ({ browser }) => {
    const { page, close } = await withFs(browser);
    await page.click('#gateNew');
    await page.fill('[data-top="cashNis"]', '555');
    await page.click('#stSave');
    await expect(page.locator('#stFileInfo')).toContainText('portfolio-backup-2026-10-23.json');
    expect(await num(page, '__save')).toBe(1);
    await page.reload();
    await expect(page.locator('#gateRemembered')).toBeVisible();
    await expect(page.locator('#gateRemembered')).toContainText('portfolio-backup-2026-10-23.json');
    await close();
  });

  test('the remembered file re-asks for permission, then loads cleanly', async ({ browser }) => {
    const { page, close } = await withFs(browser);
    await page.click('#gateNew');
    await page.fill('[data-top="cashNis"]', '321');
    await page.click('#stSave');
    await expect(page.locator('#stMsg')).toContainText('נשמר בקובץ');
    await page.evaluate(() => sessionStorage.setItem('__perm', 'prompt'));
    await page.reload();
    await page.click('#gateRemembered');
    await expect(page.locator('#workspace')).toBeVisible();
    expect(await num(page, '__permAsks')).toBe(1);
    await expect(page.locator('[data-top="cashNis"]')).toHaveValue('321');
    await expect(page.locator('#inStatus')).toContainText('נטען הקובץ');
    await close();
  });

  test('"remember my file" can be switched off', async ({ browser }) => {
    const { page, close } = await withFs(browser);
    await page.click('#gateNew');
    await page.uncheck('#stRemember');
    await page.click('#stSave');
    await expect(page.locator('#stMsg')).toContainText('נשמר בקובץ');
    await page.reload();
    await expect(page.locator('#gateRemembered')).toBeHidden();
    await close();
  });

  test('a remembered file that no longer exists falls back to choosing another', async ({ browser }) => {
    const { page, close } = await withFs(browser);
    await page.click('#gateNew');
    await page.click('#stSave');
    await expect(page.locator('#stMsg')).toContainText('נשמר בקובץ');
    await page.evaluate(() => sessionStorage.setItem('__files', '{}')); // the file's content is gone -> empty text
    await page.reload();
    await page.click('#gateRemembered');
    await expect(page.locator('#gateMsg')).not.toHaveText('');
    await expect(page.locator('#fileGate')).toBeVisible();
    await close();
  });
});

test.describe('switching modes', () => {
  test('browser -> file: saves first, then removes the browser copy', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack, beforeLoad: NO_FS });
    await page.waitForTimeout(100);
    await page.click('#stSwitch');
    await expect(page.locator('#switchPanel')).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#swSave')]);
    expect(dl.suggestedFilename()).toMatch(/^portfolio-backup-/);
    await expect(page.locator('#stMode')).toContainText('קובץ אישי');
    expect(await keys(page)).toEqual(['portfolio.mode']);
    expect(await stored(page, 'portfolio.mode')).toBe('file');
    await close();
  });

  test('browser -> file without saving still removes the browser copy, and flags unsaved changes', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await page.click('#stSwitch');
    await page.click('#swGo');
    expect(await stored(page, 'portfolio.profile')).toBeNull();
    await expect(page.locator('#inStatus')).toContainText('שינויים שלא נשמרו');
    await close();
  });

  test('file -> browser keeps the in-memory data and stores it', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false });
    await page.locator('#gateFile').setInputFiles(file(backupText(profile)));
    await page.click('#stSwitch');
    await page.click('#swGo');
    await expect(page.locator('#stMode')).toContainText('בדפדפן');
    const o = JSON.parse((await stored(page, 'portfolio.profile')) as string);
    expect(o.profile.rows).toHaveLength(10);
    await page.reload();
    await expect(page.locator('#inRows .in-row')).toHaveCount(10);
    await close();
  });

  test('cancel leaves everything as it was', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await page.click('#stSwitch');
    await page.click('#swCancel');
    await expect(page.locator('#switchPanel')).toBeHidden();
    await expect(page.locator('#stMode')).toContainText('בדפדפן');
    await close();
  });

  test('erase removes everything the app stored and returns to the chooser', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await page.click('#stErase');
    await page.click('#stErase');
    await expect(page.locator('#modeChooser')).toBeVisible();
    expect((await keys(page)).filter((k) => k !== 'portfolio.theme')).toEqual([]);
    await close();
  });
});

// Local-only: the owner's real prototype (v2) backup must load through the file gate. Run: npm run parity:private
test('@private real v2 backup loads through the file gate and migrates', async ({ browser }) => {
  test.skip(!process.env.GOLDEN_PRIVATE, 'set GOLDEN_PRIVATE=1 to run');
  const { page, errors, close } = await openApp(browser, { profile: {}, pack: JSON.parse(readFileSync('sample-data/market_pack_example.json', 'utf8')), mode: 'file', seed: false });
  await page.locator('#gateFile').setInputFiles('sample-data/profile_example_PRIVATE.json');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#outMain')).toBeVisible();
  await expect(page.locator('#inStatus')).toContainText('נטען הקובץ');
  expect(errors).toEqual([]);
  await close();
});
