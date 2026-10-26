import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './appHarness';
import { packToFiles } from '../support/dataFiles';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const pack = fx('pack-fake');
const base = () => structuredClone(packToFiles(pack)) as Record<string, any>;

test.describe('watchlist (user-owned)', () => {
  test('add, analyse, de-duplicate, remove and persist', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await expect(page.locator('#wlSection')).toBeHidden();
    await page.fill('#watchNew', 'zeta');
    await page.press('#watchNew', 'Enter');
    await expect(page.locator('#inWatch .chip')).toHaveCount(1);
    await expect(page.locator('#wlSection')).toBeVisible();
    await expect(page.locator('#wlTable')).toContainText('ZETA');
    await page.fill('#watchNew', ' Zeta ');
    await page.click('#addWatch');
    await expect(page.locator('#inWatch .chip')).toHaveCount(1); // duplicate ignored
    await page.fill('#watchNew', 'nope');
    await page.click('#addWatch');
    await expect(page.locator('#wlPending')).toContainText('אין עדיין ניתוח עבור: NOPE');
    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.locator('#inWatch .chip')).toHaveCount(2);
    await page.locator('#inWatch .chip button').first().click();
    await page.locator('#inWatch .chip button').first().click();
    await expect(page.locator('#wlSection')).toBeHidden();
    expect(errors).toEqual([]);
    await close();
  });

  test('a stock you hold is not shown on the watchlist', async ({ browser }) => {
    const p = { rows: [{ n: 'Z', t: 'ZETA', c: 'USD', ty: 'eq', q: '1', k: '', p: '' }], watchlist: ['ZETA'] };
    const { page, close } = await openApp(browser, { profile: p, pack });
    await expect(page.locator('#wlSection')).toBeHidden();
    await close();
  });
});

test.describe('sustainable withdrawal', () => {
  test('computes a level end-of-month withdrawal from the liquid portfolio', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { mmf: '120000' }, pack });
    await expect(page.locator('#wdNote')).toContainText('הזן אופק');
    await page.fill('[data-wd="years"]', '10');
    await page.fill('[data-wd="realRate"]', '0');
    await expect(page.locator('#wdTiles')).toContainText('₪1,000'); // 120000 / 120 months
    await expect(page.locator('#wdTiles')).toContainText('120 חודשים');
    await page.fill('[data-wd="realRate"]', '3');
    const text = await page.locator('#wdTiles').textContent();
    const m = Number(/₪([\d,]+)/.exec(text ?? '')?.[1]?.replace(/,/g, ''));
    expect(m).toBeGreaterThan(1000); // positive real return lets you take more per month than a plain split
    expect(m).toBeLessThan(1300);
    await close();
  });

  test('excludes gemel and hishtalmut, and survives reload', async ({ browser }) => {
    const p = { mmf: '60000', gemel: [{ n: 'g', b: '900000', d: '', e: '', r: '' }], withdrawal: { years: '5', realRate: '0' } };
    const { page, close } = await openApp(browser, { profile: p, pack });
    await expect(page.locator('#wdTiles')).toContainText('₪1,000'); // 60000 / 60
    await expect(page.locator('[data-wd="years"]')).toHaveValue('5');
    await close();
  });

  test('is excluded from the parity-compared sections', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { mmf: '1' }, pack });
    expect(await page.locator('#wdSection').getAttribute('data-parity-skip')).not.toBeNull();
    await close();
  });
});

test.describe('collapsible income and expenses', () => {
  test('opens by default, closes and reopens from its heading, with an arrow like the other cards', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
    const sec = page.locator('#cfSection');
    await expect(sec).toHaveJSProperty('open', true);
    await expect(page.locator('#cfInputs')).toBeVisible();
    await page.locator('#cfSection > summary').click();
    await expect(sec).toHaveJSProperty('open', false);
    await expect(page.locator('#cfInputs')).toBeHidden();
    await expect(page.locator('#cfSection > summary')).toBeVisible();
    await page.locator('#cfSection > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cfInputs')).toBeVisible();
    expect(await page.locator('#cfSection > summary').evaluate((el) => getComputedStyle(el).display)).toBe('list-item'); // native arrow marker
    await close();
  });
});

test('the glossary opens and closes like the other collapsible sections (starts closed)', async ({ browser }) => {
  const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
  await expect(page.locator('#glossarySection')).toHaveJSProperty('open', false);
  await expect(page.locator('#glossarySection dl')).toBeHidden();
  await page.locator('#glossarySection > summary').click();
  await expect(page.locator('#glossarySection dl')).toBeVisible();
  await expect(page.locator('#glossarySection dt').first()).toContainText('מכפיל רווח');
  await page.locator('#glossarySection > summary').click();
  await expect(page.locator('#glossarySection dl')).toBeHidden();
  await close();
});

test.describe('personal data pack', () => {
  const emptySite = () => { const f = base(); for (const k of Object.keys(f)) if (k !== 'cpi.json') delete f[k]; f['market.json'] = { schema: 1, generatedAt: 'x', groups: {}, tickers: {} }; return f; };
  const packFile = () => ({ name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
  const rows = [{ n: 'A', t: 'ALFA', c: 'USD', ty: 'eq', q: '10', k: '50', p: '' }, { n: 'B', t: 'BETA', c: 'USD', ty: 'eq', q: '5', k: '100', p: '' }];

  test('with no site data at all, importing a pack gives the full analysis, labelled as the personal pack', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: { rows }, pack, files: emptySite() });
    await expect(page.locator('#bfSection')).toBeHidden();
    await page.locator('#storageCard summary').click();
    await page.locator('#packFile').setInputFiles(packFile());
    await page.click('#pvConfirm');
    await expect(page.locator('#paMsg')).toContainText('החבילה עודכנה');
    await expect(page.locator('#bfSection')).toBeVisible();
    await expect(page.locator('#bfTable')).toContainText('ALFA');
    await expect(page.locator('#bmSection')).toBeVisible();
    await expect(page.locator('#hsSection')).toBeHidden(); // no trades entered
    await expect(page.locator('#packStatus')).toContainText('חבילה אישית פעילה');
    await page.locator('#freshness summary').click();
    await expect(page.locator('#freshList')).toContainText('חבילת הנתונים האישית שלך');
    expect(errors).toEqual([]);
    await close();
  });

  test('blank prices show the automatic price as a placeholder and use it', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows, dataPack: pack }, pack, files: emptySite() });
    const expected = (pack.tickers.ALFA.price as number).toFixed(2);
    await expect(page.locator('[data-g="rows"][data-i="0"][data-f="p"]')).toHaveAttribute('placeholder', new RegExp(`${expected.replace('.', '\\.')}.*\\(אוטומטי\\)`));
    const total = 10 * pack.tickers.ALFA.price + 5 * pack.tickers.BETA.price;
    await expect(page.locator('#totUsd')).toContainText(Math.floor(total).toLocaleString('en-US'));
    await close();
  });

  test('the pack is saved inside the profile, survives reload, and can be removed', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows }, pack, files: emptySite() });
    await page.locator('#storageCard summary').click();
    await page.locator('#packFile').setInputFiles(packFile());
    await page.click('#pvConfirm');
    await expect(page.locator('#bfSection')).toBeVisible();
    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.locator('#bfSection')).toBeVisible();
    await page.locator('#storageCard summary').click();
    await page.click('#packRemove');
    await expect(page.locator('#bfSection')).toBeHidden();
    await expect(page.locator('#packStatus')).toContainText('אין חבילה אישית');
    await close();
  });

  test('a pack that is not a pack is refused with a message and changes nothing', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows }, pack, files: emptySite() });
    await page.locator('#storageCard summary').click();
    await page.locator('#packFile').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await expect(page.locator('#paMsg')).toContainText('אינו חבילת נתונים תקינה');
    await page.locator('#packFile').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
    await expect(page.locator('#paMsg')).toContainText('לא נמצא JSON');
    await expect(page.locator('#packStatus')).toContainText('אין חבילה אישית');
    await close();
  });

  test('in file mode the pack goes into the exported file and into nothing stored in the browser', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false, files: emptySite() });
    await page.click('#gateNew');
    await page.locator('#storageCard summary').click();
    await page.locator('#packFile').setInputFiles(packFile());
    await page.click('#pvConfirm');
    await expect(page.locator('#packStatus')).toContainText('חבילה אישית פעילה');
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['portfolio.mode']);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stExport')]);
    const o = JSON.parse(readFileSync((await dl.path()) as string, 'utf8'));
    expect(Object.keys(o.profile.dataPack.tickers).sort()).toEqual(Object.keys(pack.tickers).sort());
    await close();
  });
});

test.describe('uncovered tickers', () => {
  const rows = [
    { n: 'A', t: 'ALFA', c: 'USD', ty: 'eq', q: '1', k: '', p: '' },
    { n: 'Z', t: 'ZZZZ', c: 'USD', ty: 'eq', q: '2', k: '', p: '10' },
    { n: 'Y', t: 'yyyy 2', c: 'USD', ty: 'eq', q: '3', k: '', p: '5' },
  ];
  test('lists only tickers with no data, copies symbols only, and sends nothing', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: { rows }, pack });
    await expect(page.locator('#uncSection')).toBeVisible();
    await expect(page.locator('#uncList')).toHaveText('ZZZZ, YYYY2');
    await page.evaluate(() => { (window as any).__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as any).__copied = t; } }, configurable: true }); });
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.click('#uncCopy');
    await expect(page.locator('#uncMsg')).toContainText('הועתק');
    expect(await page.evaluate(() => (window as any).__copied)).toBe('סימולים: ZZZZ, YYYY2');
    expect(requests).toEqual([]); // the copy button makes no network request
    expect(errors).toEqual([]);
    await close();
  });
  test('the mail button opens a prefilled message with the symbols only, and the site sends nothing itself', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows }, pack });
    const href = await page.getAttribute('#uncMail', 'href');
    expect(href).toMatch(/^mailto:requests@example\.test\?subject=/);
    const body = decodeURIComponent(href!.split('&body=')[1]!);
    expect(body).toContain('ZZZZ, YYYY2');
    expect(body).not.toMatch(/\b(q|k|p)\s*[:=]/);
    await expect(page.locator('#uncMailHint')).toContainText('חושפת את כתובת הדואר');
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.evaluate(() => document.getElementById('uncMail')!.addEventListener('click', (e) => e.preventDefault()));
    await page.click('#uncMail');
    expect(requests).toEqual([]);
    await close();
  });
  test('is hidden when every held ticker is covered, and when a personal pack covers the rest', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows: rows.slice(0, 1) }, pack });
    await expect(page.locator('#uncSection')).toBeHidden();
    await close();
    const two = await openApp(browser, { profile: { rows, dataPack: { tickers: { ZZZZ: { price: 1 }, YYYY2: { price: 1 } } } }, pack });
    await expect(two.page.locator('#uncSection')).toBeHidden();
    await two.close();
  });
  test('the clipboard failing is handled', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows }, pack });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('blocked'); } }, configurable: true }));
    await page.click('#uncCopy');
    await expect(page.locator('#uncMsg')).toContainText('ההעתקה לא הצליחה');
    await close();
  });
});
