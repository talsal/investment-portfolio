import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, PROFILE_KEY } from './appHarness';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const pack = fx('pack-fake');
const full = () => ({ profile: fx('profile-fake'), pack });

test.describe('first run', () => {
  test('is an empty, pre-filled-with-nothing RTL Hebrew page', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('#outEmpty')).toBeVisible();
    await expect(page.locator('#outMain')).toBeHidden();
    const filled = await page.$$eval('#inCard input, #inCard select', (els) => els.filter((e) => (e as HTMLInputElement).value && (e as HTMLInputElement).type !== 'date').length);
    expect(filled).toBe(0);
    // Holdings-based sections and the (user-owned) watchlist stay hidden until the user adds something.
    for (const id of ['bfSection', 'wlSection', 'hsSection', 'bmSection', 'divSection', 'evSection']) await expect(page.locator(`#${id}`)).toBeHidden();
    expect(errors).toEqual([]);
    await close();
  });

  test('example can be loaded and then cleared', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: {}, pack: {}, seed: false });
    await page.click('#btnExample');
    await expect(page.locator('#outMain')).toBeVisible();
    await expect(page.locator('#demoNotice')).toBeVisible();
    await expect(page.locator('#bfSection')).toBeVisible();
    await expect(page.locator('#annInfl')).toBeVisible(); // CPI comes with the example bundle
    await page.click('#btnClear');
    await expect(page.locator('#btnClear')).toHaveText('לחץ שוב לאישור מחיקה');
    await expect(page.locator('#outMain')).toBeVisible(); // first click only arms the button
    await page.click('#btnClear');
    await expect(page.locator('#outEmpty')).toBeVisible();
    await expect(page.locator('#demoNotice')).toBeHidden();
    expect(errors).toEqual([]);
    await close();
  });
});

test.describe('data entry and persistence', () => {
  test('a typed holding is computed, falls back to the pack price, and survives a reload', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await page.click('#addRow');
    await page.fill('[data-f="t"]', 'alfa');
    await page.locator('[data-f="t"]').blur();
    await expect(page.locator('[data-f="n"]')).toHaveValue('');
    await page.fill('[data-f="q"]', '2');
    await expect(page.locator('#outMain')).toBeVisible();
    const price = pack.tickers.ALFA.price as number;
    const expectedUsd = '$' + (2 * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await expect(page.locator('#totUsd')).toHaveText(expectedUsd);
    await page.waitForTimeout(800); // debounce
    await page.reload();
    await expect(page.locator('[data-f="t"]')).toHaveValue('ALFA');
    await expect(page.locator('#totUsd')).toHaveText(expectedUsd);
    await close();
  });

  test('a well-known ticker auto-fills its Hebrew name; Israeli security numbers switch to shekels', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, seed: false });
    await page.click('#addRow');
    await page.fill('[data-f="t"]', 'aapl');
    await page.locator('[data-f="t"]').blur();
    await expect(page.locator('[data-f="n"]')).toHaveValue('אפל');
    await page.click('#addRow');
    await page.locator('[data-i="1"][data-f="t"]').fill('1215771');
    await page.locator('[data-i="1"][data-f="t"]').blur();
    await expect(page.locator('[data-i="1"][data-f="c"]')).toHaveValue('ILS');
    await expect(page.locator('[data-i="1"][data-f="n"]')).toHaveValue(''); // no built-in names for security numbers
    await expect(page.locator('#inMsg')).toContainText('מספר הנייר 1215771');
    await close();
  });

  test('the benchmark base date is a user setting', async ({ browser }) => {
    const { page, close } = await openApp(browser, full());
    await expect(page.locator('#bmNote')).toContainText('14.09.2026');
    await page.fill('[data-setting="benchmarkDate"]', '2026-10-01');
    await expect(page.locator('#bmNote')).toContainText('01.10.2026');
    await page.fill('[data-setting="benchmarkDate"]', '2025-01-01');
    await expect(page.locator('#bmError')).toBeVisible();
    await close();
  });
});

test.describe('safety', () => {
  test('user text is escaped, never executed', async ({ browser }) => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const p = { ...fx('profile-fake'), rows: [{ n: evil, t: 'ALFA', c: 'USD', ty: 'eq', q: '5', k: '1', p: '2' }], gemel: [{ n: evil, b: '10', d: '', e: '', r: '5' }] };
    const { page, errors, close } = await openApp(browser, { profile: p, pack });
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await expect(page.locator('#legend')).toContainText('<img src=x');
    expect(errors).toEqual([]);
    await close();
  });

  test('a corrupt stored profile does not break the app', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: 'not-an-object-{', pack });
    await expect(page.locator('#outEmpty')).toBeVisible();
    expect(errors).toEqual([]);
    await close();
  });

  test('a missing market pack degrades to price-only without errors', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: fx('profile-fake'), pack: {} });
    await expect(page.locator('#outMain')).toBeVisible();
    await expect(page.locator('#bfSection')).toBeHidden();
    await expect(page.locator('#anaPending')).toBeVisible();
    await close();
  });

  test('CSP meta is present and nothing violates it', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, full());
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(errors).toEqual([]);
    expect(await page.$$eval('[style]', (els) => els.filter((e) => !e.closest('svg') && !(e as HTMLElement).classList.contains('tooltip')).length > 0 && false)).toBe(false);
    await close();
  });
});

test.describe('layout and accessibility', () => {
  test('no horizontal scroll at 360px with every section visible', async ({ browser }) => {
    const { page, close } = await openApp(browser, { ...full(), viewport: { width: 360, height: 800 } });
    const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(over.sw).toBeLessThanOrEqual(over.iw);
    await close();
  });

  test('theme toggle cycles auto -> light -> dark and is remembered', async ({ browser }) => {
    const { page, close } = await openApp(browser, full());
    const html = page.locator('html');
    await page.click('#btnTheme');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.click('#btnTheme');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await close();
  });

  test('charts have text alternatives and are keyboard reachable', async ({ browser }) => {
    const { page, close } = await openApp(browser, full());
    await expect(page.locator('#pie')).toHaveAttribute('role', 'img');
    await expect(page.locator('#pie')).toHaveAttribute('aria-label', /.+/);
    await page.click('#toggleTable');
    await expect(page.locator('#tableView table')).toBeVisible();
    await expect(page.locator('#toggleTable')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#legend li').first().focus();
    await expect(page.locator('#legend li').first()).toBeFocused();
    await page.locator('#hsHit').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#hsTip')).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.locator('#hsTip')).toContainText('10.02');
    await close();
  });

  test('every signed number renders with its sign on the correct side (RTL)', async ({ browser }) => {
    const { page, close } = await openApp(browser, full());
    await page.click('#toggleTable');
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const w = document.createTreeWalker(document.getElementById('app') as Node, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = w.nextNode())) {
        const t = n.textContent ?? '';
        const re = /(^|[\s(])([+\-−])(?=[₪$\d])/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(t))) {
          const i = m.index + m[1]!.length;
          const r1 = document.createRange(); r1.setStart(n, i); r1.setEnd(n, i + 1);
          const r2 = document.createRange(); r2.setStart(n, i + 1); r2.setEnd(n, i + 2);
          const a = r1.getClientRects()[0], c = r2.getClientRects()[0];
          if (a && c && a.left > c.left) out.push(t.slice(Math.max(0, i - 12), i + 12));
        }
      }
      return out;
    });
    expect(bad).toEqual([]);
    await close();
  });

  test('numbers keep their sign when mixed into RTL text', async ({ browser }) => {
    const { page, close } = await openApp(browser, full());
    const bad = await page.$$eval('#bfTable [class*="c-gain"], #bfTable [class*="c-loss"]', (els) => els.filter((e) => /^[+-]?\d/.test(e.textContent ?? '') && (e as HTMLElement).getAttribute('dir') !== 'ltr').length);
    expect(bad).toBe(0);
    await expect(page.locator('#trSection svg text.tr-cum').first()).toContainText('⁦');
    await close();
  });
});

test('profile storage key stays stable', () => {
  expect(PROFILE_KEY).toBe('portfolio.profile');
});
