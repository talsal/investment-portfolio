import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './appHarness';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const pack = fx('pack-fake');

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
