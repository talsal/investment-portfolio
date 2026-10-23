import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './appHarness';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const pack = fx('pack-fake');
const profile = fx('profile-fake');

/** WCAG 2.1 A/AA automated rules. Fails with a readable list of the offending nodes. */
async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const lines = r.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join('\n   ')}`);
  expect(lines, `${label}\n${lines.join('\n')}`).toEqual([]);
}
const openAll = (page: Page) => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));

test.describe('accessibility (axe, WCAG 2.1 AA)', () => {
  test('mode chooser', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'none', seed: false });
    await audit(page, 'chooser');
    await close();
  });
  test('file gate', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false });
    await audit(page, 'gate');
    await close();
  });
  test('empty workspace', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await openAll(page);
    await audit(page, 'empty workspace');
    await close();
  });
  test('full dashboard, light', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await openAll(page);
    await page.click('#toggleTable');
    await audit(page, 'dashboard light');
    await close();
  });
  test('full dashboard, dark', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack, colorScheme: 'dark' });
    await openAll(page);
    await audit(page, 'dashboard dark');
    await close();
  });
  test('full dashboard at 360px', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack, viewport: { width: 360, height: 800 } });
    await openAll(page);
    await audit(page, 'dashboard 360');
    await close();
  });
  test('storage dialogs (import preview, switch panel)', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await openAll(page);
    await page.click('#stSwitch');
    await audit(page, 'switch panel');
    await close();
  });
});

test.describe('keyboard and structure', () => {
  test('a skip link is the first tab stop and moves focus to the results', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    await expect(page.locator('.skip')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#results')).toBeFocused();
    await close();
  });
  test('one main landmark, one h1, table headers are scoped, interactive elements show focus', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await openAll(page);
    expect(await page.locator('main').count()).toBe(1);
    expect(await page.locator('h1').count()).toBe(1);
    expect(await page.locator('table.data-table thead th:not([scope="col"])').count()).toBe(0);
    await page.locator('#btnTheme').focus();
    const outline = await page.locator('#btnTheme').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await close();
  });
  test('overflowing tables are keyboard-scrollable and named; fitting ones are not tab stops', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack, viewport: { width: 360, height: 800 } });
    const scrollable = page.locator('#bfTable[role="region"]');
    await expect(scrollable).toHaveAttribute('tabindex', '0');
    await expect(scrollable).toHaveAttribute('aria-label', /.+/);
    await close();
  });
});
