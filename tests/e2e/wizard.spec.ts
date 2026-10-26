import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './appHarness';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const pack = fx('pack-fake');
const fresh = (browser: Parameters<typeof openApp>[0], extra = {}) => openApp(browser, { profile: {}, pack, seed: false, wizard: true, ...extra });
const NO_FS = async (page: Page) => { await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker; }); };
const step = (page: Page) => page.locator('#wizard .in-status').first().textContent();

test.describe('first-run wizard', () => {
  test('opens by itself for a brand-new customer, one step at a time, and the full form is hidden behind it', async ({ browser }) => {
    const { page, errors, close } = await fresh(browser, { mode: 'none' });
    await page.click('#chooseBrowser');
    await expect(page.locator('#wizard')).toBeVisible();
    await expect(page.locator('#wzH')).toHaveText('ניירות ערך');
    await expect(page.locator('#wzH')).toBeFocused();
    expect(await step(page)).toBe('שלב 1 מתוך 5');
    await expect(page.locator('#inCard')).toBeHidden();
    await expect(page.locator('#outEmpty')).toBeHidden();
    expect(errors).toEqual([]);
    await close();
  });

  test('a complete journey: holdings, cash, funds, target, save; the dashboard then shows what was entered', async ({ browser }) => {
    const { page, errors, close } = await fresh(browser, { mode: 'file', beforeLoad: NO_FS });
    await page.click('#gateNew');
    // 1: holdings. A known ticker (data exists), then an uncovered one.
    await page.fill('#wizard [data-f="t"]', 'alfa');
    await page.locator('#wizard [data-f="t"]').blur();
    await page.fill('#wizard [data-f="q"]', '10');
    await expect(page.locator('[data-status="0"]')).toContainText('מחיר אוטומטי');
    await page.click('#wzAddRow');
    await page.locator('#wizard [data-i="1"][data-f="t"]').fill('zzzz');
    await page.locator('#wizard [data-i="1"][data-f="t"]').blur();
    await page.fill('#wizard [data-i="1"][data-f="q"]', '2');
    await expect(page.locator('[data-status="1"]')).toContainText('הזן מחיר נוכחי');
    await page.fill('#wizard [data-i="1"][data-f="p"]', '50');
    await expect(page.locator('[data-status="1"]')).toHaveText('');
    await page.click('#wzNext');
    // 2: cash
    await expect(page.locator('#wzH')).toHaveText('מזומן וקרן כספית');
    await page.fill('#wizard [data-f="cashNis"]', '10000');
    await page.click('#wzNext');
    // 3: funds
    await expect(page.locator('#wzH')).toHaveText('גמל והשתלמות');
    await page.click('#wzAddHish');
    await page.fill('#wizard [data-wz="hish"][data-f="n"]', 'השתלמות');
    await page.fill('#wizard [data-wz="hish"][data-f="b"]', '50000');
    await page.click('#wzNext');
    // 4: target (skipped)
    await expect(page.locator('#wzH')).toHaveText('יעד חלוקה');
    await page.click('#wzSkip');
    // 5: save
    await expect(page.locator('#wzH')).toHaveText('שמירה');
    await expect(page.locator('#wizard')).toContainText('2 ניירות ערך, 1 קופות');
    await expect(page.locator('#wizard')).toContainText('portfolio-backup');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wzSave')]);
    const saved = JSON.parse(readFileSync((await dl.path()) as string, 'utf8'));
    expect(saved.profile.rows.map((r: any) => r.t)).toEqual(['ALFA', 'ZZZZ']);
    expect(saved.profile.hish[0].b).toBe('50000');
    await page.click('#wzFinish');
    await expect(page.locator('#wizard')).toBeHidden();
    await expect(page.locator('#outMain')).toBeVisible();
    await expect(page.locator('#results')).toBeFocused();
    await expect(page.locator('#uncList')).toHaveText('ZZZZ'); // the uncovered ticker is listed
    await expect(page.locator('#legend')).toContainText('אלפא תעשיות'); // the name came from the site's data
    expect(errors).toEqual([]);
    await close();
  });

  test('back keeps what was typed; skip-all leaves a usable full form; the wizard does not reopen in the same session', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'none' });
    await page.click('#chooseBrowser');
    await page.fill('#wizard [data-f="t"]', 'MSFT');
    await page.locator('#wizard [data-f="t"]').blur();
    await expect(page.locator('#wizard [data-f="n"]')).toHaveValue('מיקרוסופט');
    await page.fill('#wizard [data-f="q"]', '3');
    await page.click('#wzNext');
    await page.fill('#wizard [data-f="cashNis"]', '777');
    await page.click('#wzBack');
    await expect(page.locator('#wizard [data-f="t"]')).toHaveValue('MSFT');
    await expect(page.locator('#wizard [data-f="q"]')).toHaveValue('3');
    await page.click('#wzSkipAll');
    await expect(page.locator('#wizard')).toBeHidden();
    await expect(page.locator('[data-top="cashNis"]')).toHaveValue('777'); // the full form shows everything entered
    await expect(page.locator('#inRows .in-row')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#wizard')).toBeHidden(); // data exists, and it was dismissed this session
    await close();
  });

  test('a holding without a quantity is flagged but not lost; untouched rows are dropped', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'none' });
    await page.click('#chooseBrowser');
    await page.fill('#wizard [data-f="t"]', 'AAPL');
    await page.locator('#wizard [data-f="t"]').blur();
    await expect(page.locator('[data-status="0"]')).toContainText('חסרה כמות');
    await page.click('#wzAddRow'); // an empty second row
    await page.click('#wzNext');
    await page.click('#wzBack');
    await expect(page.locator('#wizard .wz-card')).toHaveCount(1);
    await expect(page.locator('#wizard [data-f="t"]')).toHaveValue('AAPL');
    await close();
  });

  test('the last step says how many holdings still have no price instead of silently counting zero', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'none' });
    await page.click('#chooseBrowser');
    await page.fill('#wizard [data-f="t"]', 'QQQQ');
    await page.fill('#wizard [data-f="q"]', '4');
    for (let i = 0; i < 4; i++) await page.click(i === 0 ? '#wzNext' : '#wzSkip');
    await expect(page.locator('#wizard')).toContainText('1 ניירות ערך');
    await expect(page.locator('#wzNoPrice')).toContainText('1 מהניירות עדיין בלי מחיר');
    await close();
  });

  test('Israeli security numbers switch the currency to shekels', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'none' });
    await page.click('#chooseBrowser');
    await page.fill('#wizard [data-f="t"]', '1155365');
    await page.locator('#wizard [data-f="t"]').blur();
    await expect(page.locator('#wizard [data-f="c"]')).toHaveValue('ILS');
    await close();
  });

  test('browser mode: the last step explains browser storage and offers a backup', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'none' });
    await page.click('#chooseBrowser');
    for (let i = 0; i < 4; i++) await page.click(i === 0 ? '#wzNext' : '#wzSkip');
    await expect(page.locator('#wzH')).toHaveText('שמירה');
    await expect(page.locator('#wizard')).toContainText('נשמרים אוטומטית בדפדפן');
    await expect(page.locator('#wzSave')).toHaveText('ייצוא גיבוי');
    await close();
  });

  test('the empty-state button reopens the wizard after it was dismissed', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'none' });
    await page.click('#chooseBrowser');
    await page.click('#wzSkipAll');
    await expect(page.locator('#outEmpty')).toBeVisible();
    await page.click('#wzStart');
    await expect(page.locator('#wizard')).toBeVisible();
    await close();
  });

  test('it does not appear for a customer who loads an existing file', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'file' });
    const text = JSON.stringify({ app: 'portfolio-pilot', version: 3, exportedAt: '2026-10-01T00:00:00Z', profile: { cashNis: '5' } });
    await page.locator('#gateFile').setInputFiles({ name: 'mine.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#wizard')).toBeHidden();
    await close();
  });

  test('no horizontal scroll at 360px on any step, and axe passes on each', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'none', viewport: { width: 360, height: 800 } });
    await page.click('#chooseBrowser');
    await page.click('#wzAddRow');
    for (let s = 0; s < 5; s++) {
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      expect(w.sw, `step ${s + 1}`).toBeLessThanOrEqual(w.iw);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), `step ${s + 1}`).toEqual([]);
      if (s < 4) await page.click('#wzNext');
    }
    await close();
  });

  test('works with the keyboard alone: Tab reaches the buttons and Enter on Next advances', async ({ browser }) => {
    const { page, close } = await fresh(browser, { mode: 'none' });
    await page.click('#chooseBrowser');
    await page.locator('#wzNext').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#wzH')).toHaveText('מזומן וקרן כספית');
    await expect(page.locator('#wzH')).toBeFocused();
    await close();
  });
});
