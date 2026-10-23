import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './appHarness';
import { packToFiles } from '../support/dataFiles';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const pack = fx('pack-fake');
const profile = fx('profile-fake');
const base = () => structuredClone(packToFiles(pack)) as Record<string, any>;

test.describe('data freshness', () => {
  test('shows an "as of" line for every data group', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile, pack });
    await page.evaluate(() => { (document.getElementById('freshness') as HTMLDetailsElement).open = true; });
    const text = await page.locator('#freshList').innerText();
    for (const label of ['מחירי מניות', 'שער דולר-שקל', 'מדד S&P 500', 'היסטוריית מחירים', 'נתוני יסוד לניתוח']) expect(text).toContain(label);
    expect(text).toContain('נכון ל-22.10.2026');
    await expect(page.locator('#freshSummary')).toHaveText('כל הנתונים עדכניים');
    expect(errors).toEqual([]);
    await close();
  });

  test('the bundled example has no provenance, so no freshness panel', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await page.click('#btnExample');
    await expect(page.locator('#outMain')).toBeVisible();
    await expect(page.locator('#freshness')).toBeHidden();
    await close();
  });

  test('old data is shown as stale even if the pipeline said ok', async ({ browser }) => {
    const files = base();
    for (const g of Object.values<any>(files['market.json'].groups)) g.asof = '2026-09-01';
    const { page, close } = await openApp(browser, { profile, pack, files });
    await expect(page.locator('#freshSummary')).toHaveText('חלק מהנתונים אינם עדכניים');
    await page.evaluate(() => { (document.getElementById('freshness') as HTMLDetailsElement).open = true; });
    await expect(page.locator('#freshList')).toContainText('לא עודכן מאז 01.09.2026');
    await close();
  });

  test('a failed provider shows the last known value with its date, and carried-over prices are named', async ({ browser }) => {
    const files = base();
    files['market.json'].groups.fx = { state: 'unavailable', asof: '2026-10-20', fetchedAt: '2026-10-20T22:00:00Z', source: 'boi', note: 'HTTP 500' };
    files['market.json'].tickers.ALFA.stale = true;
    const { page, close } = await openApp(browser, { profile, pack, files });
    await expect(page.locator('#freshSummary')).toHaveText('חלק מהנתונים אינם זמינים');
    await page.evaluate(() => { (document.getElementById('freshness') as HTMLDetailsElement).open = true; });
    await expect(page.locator('#freshList')).toContainText('לא זמין כרגע. מוצג הערך האחרון, מ-20.10.2026');
    await expect(page.locator('#freshStale')).toContainText('ALFA');
    await expect(page.locator('#outMain')).toBeVisible(); // everything keeps working with the last known values
    await close();
  });

  test('a stale price of a stock you do not hold is not flagged', async ({ browser }) => {
    const files = base();
    files['market.json'].tickers.ZETA.stale = true;
    const { page, close } = await openApp(browser, { profile, pack, files });
    await expect(page.locator('#freshStale')).toBeHidden();
    await close();
  });
});

test('data that was never available says why (licence gate, no universe)', async ({ browser }) => {
  const files = base();
  files['market.json'].groups.fx = { state: 'unavailable', asof: null, fetchedAt: null, source: 'boi', note: 'skipped:licence-not-acknowledged' };
  const { page, close } = await openApp(browser, { profile, pack, files });
  await page.evaluate(() => { (document.getElementById('freshness') as HTMLDetailsElement).open = true; });
  await expect(page.locator('#freshList')).toContainText('מקור הנתונים טרם אושר לפרסום');
  await close();
});

test.describe('loading and degradation', () => {
  test('only the files a user needs are requested', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { rows: [{ n: 'A', t: 'ALFA', c: 'USD', ty: 'eq', q: '1', k: '', p: '' }] }, pack });
    const urls: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/data/')) urls.push(r.url().replace(/^.*\/data\//, '')); });
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(urls).toContain('market.json');
    expect(urls).toContain('fundamentals/ALFA.json');
    expect(urls).toContain('history/ALFA.json');
    expect(urls.some((u) => u.includes('BETA'))).toBe(false);
    expect(urls.some((u) => u.includes('ZETA'))).toBe(false);
    await close();
  });

  test('no history is downloaded for a profile with no holdings', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: { mmf: '5' }, pack });
    const urls: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/data/')) urls.push(r.url()); });
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(urls.filter((u) => u.includes('/history/'))).toEqual([]);
    await close();
  });

  test('picking up a newly typed ticker loads its data and renders the analysis', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await page.click('#addRow');
    await page.fill('[data-f="t"]', 'ALFA');
    await page.fill('[data-f="q"]', '3');
    await page.locator('[data-f="t"]').blur();
    await expect(page.locator('#bfSection')).toBeVisible();
    await expect(page.locator('#bfTable')).toContainText('ALFA');
    await close();
  });

  test('a corrupt market.json degrades to price-only without errors', async ({ browser }) => {
    const files = base();
    files['market.json'] = { schema: 1, nonsense: true };
    const { page, errors, close } = await openApp(browser, { profile, pack, files });
    await expect(page.locator('#outMain')).toBeVisible();
    await expect(page.locator('#bfSection')).toBeHidden();
    await expect(page.locator('#freshness')).toBeHidden();
    expect(errors).toEqual([]);
    await close();
  });

  test('a file from a newer schema is ignored rather than misread', async ({ browser }) => {
    const files = base();
    files['market.json'].schema = 99;
    const { page, close } = await openApp(browser, { profile, pack, files });
    await expect(page.locator('#bfSection')).toBeHidden();
    await close();
  });

  test('a malformed per-ticker file only loses that ticker\'s analysis', async ({ browser }) => {
    const files = base();
    files['fundamentals/ALFA.json'] = { nonsense: 1 };
    const { page, errors, close } = await openApp(browser, { profile, pack, files });
    await expect(page.locator('#bfTable')).toContainText('BETA');
    expect(errors).toEqual([]);
    await close();
  });
});

test.describe('analysis gating and missing data', () => {
  test('a draft analysis is never shown as fact', async ({ browser }) => {
    const files = base();
    files['analysis/ALFA.json'].status = 'draft';
    const { page, close } = await openApp(browser, { profile, pack, files });
    const row = page.locator('#bfTable tbody tr', { hasText: 'ALFA' });
    await expect(row).toContainText('– אין ניתוח');
    await expect(row).not.toContainText('אין בעיה');
    await close();
  });

  test('missing forward EPS shows "no data" instead of a failure', async ({ browser }) => {
    const files = base();
    delete files['fundamentals/ALFA.json'].inputs.epsF;
    const { page, close } = await openApp(browser, { profile, pack, files });
    const row = page.locator('#bfTable tbody tr', { hasText: 'ALFA' });
    await expect(row).toContainText('– אין נתון');
    await close();
  });

  test('owner-supplied manual inputs fill what providers lack', async ({ browser }) => {
    const files = base();
    delete files['fundamentals/ALFA.json'].inputs.epsF;
    files['manual/ALFA.json'] = { schema: 1, symbol: 'ALFA', asof: '2026-10-22', inputs: { epsF: 13.4 } };
    files['market.json'].tickers.ALFA.has.push('manual');
    const { page, close } = await openApp(browser, { profile, pack, files });
    const row = page.locator('#bfTable tbody tr', { hasText: 'ALFA' });
    await expect(row).not.toContainText('– אין נתון');
    await expect(row).toContainText('עתידי 7.8');
    await close();
  });

  test('stocks without analysis offer a link to request the ticker', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    const link = page.locator('#anaPending a');
    await expect(link).toHaveAttribute('href', 'https://github.com/example-owner/portfolio-site/issues/new?template=request-ticker.yml');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
    await close();
  });
});

test.describe('benchmark base date', () => {
  test('defaults to the first trading day of the year when the data does not configure one', async ({ browser }) => {
    const files = base();
    delete files['market.json'].benchmark.baseDate;
    const { page, close } = await openApp(browser, { profile, pack, files });
    await expect(page.locator('#bmNote')).toContainText('02.01.2026');
    await close();
  });
});
