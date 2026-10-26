import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './appHarness';
import { packToFiles } from '../support/dataFiles';

const pack = JSON.parse(readFileSync('tests/golden/fixtures/pack-fake.json', 'utf8'));
const emptySite = () => { const f = structuredClone(packToFiles(pack)) as Record<string, unknown>; for (const k of Object.keys(f)) if (k !== 'cpi.json') delete f[k]; f['market.json'] = { schema: 1, generatedAt: 'x', groups: {}, tickers: {} }; return f; };
const rows = [
  { n: 'Alfa', t: 'ALFA', c: 'USD', ty: 'eq', q: '7919', k: '40', p: '50' },
  { n: 'Beta', t: 'BETA', c: 'USD', ty: 'eq', q: '31', k: '90', p: '' },
  { n: 'Il', t: '1234567', c: 'ILS', ty: 'eq', q: '4242', k: '1', p: '2' },
];
const answer = (o: Record<string, unknown>) => 'הנה הנתונים:\n```json\n' + JSON.stringify(o) + '\n```\nבהצלחה!';
const good = { asof: '23.10.2026', fx: 3.1, tickers: { ALFA: { name: 'Alfa', cur: 'USD', price: 52 }, BETA: { name: 'Beta', cur: 'USD', price: 101 }, '1234567': { name: 'Il', cur: 'ILS', price: 2.1 } } };

async function openAsk(page: import('@playwright/test').Page) {
  await page.locator('#storageCard summary').click();
  await page.click('#packAsk');
}

test.describe('guided data update', () => {
  test('the instructions name the dollar tickers and the date, and carry nothing else from the profile', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: { rows, cashUsd: '98765', mmf: '55555' }, pack, files: emptySite() });
    await openAsk(page);
    const text = await page.inputValue('#paPrompt');
    expect(text).toContain('מניות בדולרים: ALFA, BETA');
    expect(text).toContain('- 1234567 | Il | בשקלים, cur "ILS"');
    expect(text).toContain('23.10.2026');
    for (const secret of ['7919', '4242', '98765', '55555']) expect(text).not.toContain(secret);
    expect(errors).toEqual([]);
    await close();
  });

  test('copying uses the clipboard and makes no network request', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows }, pack, files: emptySite() });
    await page.evaluate(() => { (window as any).__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { (window as any).__copied = t; } }, configurable: true }); });
    await openAsk(page);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.click('#paCopy');
    await expect(page.locator('#paMsg')).toContainText('הועתק');
    expect(await page.evaluate(() => (window as any).__copied)).toBe(await page.inputValue('#paPrompt'));
    expect(requests).toEqual([]);
    await close();
  });

  test('a pasted answer is checked first, applied only on confirmation, and then used for prices', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: { rows }, pack, files: emptySite() });
    await openAsk(page);
    await page.fill('#paPaste', answer(good));
    await page.click('#paCheck');
    await expect(page.locator('#paPreview')).toBeVisible();
    await expect(page.locator('#pvTable')).toContainText('ALFA');
    await expect(page.locator('#pvTable')).toContainText('+4.0%'); // 52 vs the typed 50
    await expect(page.locator('#pvWarns')).toContainText('לא נמצאו ערכים חשודים');
    await expect(page.locator('#packStatus')).toContainText('אין חבילה אישית'); // nothing applied yet
    await page.click('#pvConfirm');
    await expect(page.locator('#paMsg')).toContainText('החבילה עודכנה (3 ניירות)');
    await expect(page.locator('#packStatus')).toContainText('חבילה אישית פעילה');
    await expect(page.locator('[data-g="rows"][data-i="1"][data-f="p"]')).toHaveAttribute('placeholder', /101\.00.*\(אוטומטי\)/);
    expect(errors).toEqual([]);
    await close();
  });

  test('suspicious values are flagged: a big jump, an old date, a missing ticker, a moved dollar rate', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows: rows.map((r) => (r.t === 'ALFA' ? { ...r, p: '50' } : r)), fx: '3.0' }, pack, files: emptySite() });
    await openAsk(page);
    await page.fill('#paPaste', answer({ asof: '01.10.2026', fx: 3.5, tickers: { ALFA: { price: 500 } } }));
    await page.click('#paCheck');
    await expect(page.locator('#pvTable')).toContainText('+900.0%');
    const warns = page.locator('#pvWarns');
    await expect(warns).toContainText('הנתונים ישנים');
    await expect(warns).toContainText('לא התקבל מחיר עבור: 1234567, BETA');
    await expect(warns).toContainText('שער הדולר');
    await expect(page.locator('#pvTable')).toContainText('שינוי חריג של 900%');
    await expect(warns).not.toContainText('לא נמצאו ערכים חשודים');
    await close();
  });

  test('cancel changes nothing; text that is not JSON gets a clear message', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows }, pack, files: emptySite() });
    await openAsk(page);
    await page.click('#paCheck');
    await expect(page.locator('#paMsg')).toContainText('הדבק קודם');
    await page.fill('#paPaste', 'אין לי גישה לנתונים עדכניים');
    await page.click('#paCheck');
    await expect(page.locator('#paMsg')).toContainText('לא נמצא JSON');
    await expect(page.locator('#paPreview')).toBeHidden();
    await page.fill('#paPaste', answer(good));
    await page.click('#paCheck');
    await page.click('#pvCancel');
    await expect(page.locator('#paPreview')).toBeHidden();
    await expect(page.locator('#packStatus')).toContainText('אין חבילה אישית');
    await close();
  });

  test('replacing a pack warns about tickers that would disappear', async ({ browser }) => {
    const prev = { asof: '22.10.2026', tickers: { ALFA: { price: 50 }, BETA: { price: 100 } } };
    const { page, close } = await openApp(browser, { profile: { rows, dataPack: prev }, pack, files: emptySite() });
    await openAsk(page);
    await page.fill('#paPaste', answer({ asof: '23.10.2026', tickers: { ALFA: { price: 51 } } }));
    await page.click('#paCheck');
    await expect(page.locator('#pvWarns')).toContainText('ייעלמו: BETA');
    await close();
  });

  test('with nothing in the portfolio there is nothing to ask for, and the uncovered list opens the same panel', async ({ browser }) => {
    const none = await openApp(browser, { profile: { rows: [] }, pack, files: emptySite() });
    await openAsk(none.page);
    await expect(none.page.locator('#paNone')).toBeVisible();
    await expect(none.page.locator('#paFlow')).toBeHidden();
    await none.close();
    const unc = await openApp(browser, { profile: { rows: [{ n: 'Z', t: 'ZZZZ', c: 'USD', ty: 'eq', q: '2', k: '', p: '10' }] }, pack, files: emptySite() });
    await unc.page.click('#uncAsk');
    await expect(unc.page.locator('#packAskBox')).toBeVisible();
    await expect(unc.page.inputValue('#paPrompt')).resolves.toContain('ZZZZ');
    await unc.close();
  });

  test('Israeli securities: a shekel price is used, a wrong currency is flagged and not used, an agorot mix-up is called out', async ({ browser }) => {
    const il = [
      { n: 'Il', t: '1234567', c: 'ILS', ty: 'eq', q: '10', k: '40', p: '' },
      { n: 'Ag', t: '7654321', c: 'AGO', ty: 'eq', q: '10', k: '4000', p: '4000' },
    ];
    const { page, errors, close } = await openApp(browser, { profile: { rows: il }, pack, files: emptySite() });
    await openAsk(page);
    const text = await page.inputValue('#paPrompt');
    expect(text).toContain('- 7654321 | Ag | באגורות, cur "AGO"');
    await page.fill('#paPaste', answer({ asof: '23.10.2026', tickers: { '1234567': { cur: 'ILS', price: 42.5 }, '7654321': { cur: 'ILS', price: 40.5 } } }));
    await page.click('#paCheck');
    await expect(page.locator('#pvTable')).toContainText('המטבע בתשובה (ILS) שונה ממטבע השורה בטופס (AGO)');
    await page.fill('#paPaste', answer({ asof: '23.10.2026', tickers: { '1234567': { cur: 'ILS', price: 42.5 }, '7654321': { cur: 'AGO', price: 40.5 } } }));
    await page.click('#paCheck');
    await expect(page.locator('#pvTable')).toContainText('ערבוב בין אגורות לשקלים'); // 40.5 against the typed 4000 agorot
    await page.fill('#paPaste', answer({ asof: '23.10.2026', tickers: { '1234567': { cur: 'ILS', price: 42.5 }, '7654321': { cur: 'AGO', price: 4050 } } }));
    await page.click('#paCheck');
    await expect(page.locator('#pvWarns')).toContainText('לא נמצאו ערכים חשודים');
    await page.click('#pvConfirm');
    await expect(page.locator('[data-g="rows"][data-i="0"][data-f="p"]')).toHaveAttribute('placeholder', /42\.50.*\(אוטומטי\)/);
    await expect(page.locator('#uncSection')).toBeHidden();
    expect(errors).toEqual([]);
    await close();
  });

  test('fits a 360px phone screen with the preview open (no horizontal page scroll)', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows }, pack, files: emptySite(), viewport: { width: 360, height: 780 } });
    await openAsk(page);
    await page.fill('#paPaste', answer({ asof: '01.10.2026', fx: 3.5, tickers: { ALFA: { price: 500 }, BETA: { price: 101 } } }));
    await page.click('#paCheck');
    await expect(page.locator('#paPreview')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await close();
  });
});
