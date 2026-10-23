import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './appHarness';
import { he } from '../../src/i18n/he';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const pack = fx('pack-fake');
const profile = fx('profile-fake');

test.describe('privacy page', () => {
  test('is reachable from the footer, complete, accessible, and links back', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile, pack });
    await page.locator('footer a').click();
    await expect(page).toHaveURL(/privacy\.html$/);
    await expect(page.locator('h1')).toHaveText(he.privacy.title);
    await expect(page.locator('section.compare-section')).toHaveCount(he.privacy.sections.length);
    await expect(page.locator('main')).toContainText('נשארים במכשיר שלך');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    await page.locator('a', { hasText: he.privacy.back }).first().click();
    await expect(page.locator('h1')).toHaveText(he.app.title);
    await close();
  });

  test('ships with the same strict CSP as the app', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, url: '/privacy.html' });
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    await close();
  });
});

test.describe('what the privacy page promises is true', () => {
  test('a full session talks to no other origin, sends no user data, and sets no cookies', async ({ browser }) => {
    const { page, errors, close } = await openApp(browser, { profile: {}, pack, seed: false });
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
    await page.click('#btnExample');
    await expect(page.locator('#outMain')).toBeVisible();
    await page.fill('[data-top="cashNis"]', '987654321');
    await page.fill('#watchNew', 'ZETA');
    await page.click('#addWatch');
    await page.fill('[data-wd="years"]', '20');
    await page.locator('#storageCard summary').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stExport')]);
    await dl.path();
    await page.waitForTimeout(900);
    const origins = new Set(requests.map((r) => new URL(r.url).origin).filter((o) => o.startsWith('http')));
    expect([...origins]).toEqual(['http://localhost:4173']);
    expect(requests.every((r) => r.method === 'GET' && !r.body)).toBe(true);
    expect(requests.some((r) => r.url.includes('987654321'))).toBe(false);
    expect(await page.context().cookies()).toEqual([]);
    expect(errors).toEqual([]);
    await close();
  });

  test('in file mode no profile data reaches storage of any kind (local, session, IndexedDB, cookies)', async ({ browser }) => {
    const { page, close } = await openApp(browser, { profile: {}, pack, mode: 'file', seed: false });
    await page.click('#gateNew');
    await page.fill('[data-top="cashNis"]', '555123');
    await page.click('#addRow');
    await page.fill('[data-f="n"]', 'סודי');
    await page.waitForTimeout(900);
    const dump = await page.evaluate(async () => {
      const parts = [JSON.stringify(localStorage), JSON.stringify(sessionStorage), document.cookie];
      for (const d of (await indexedDB.databases?.()) ?? []) {
        const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(d.name as string); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        for (const name of Array.from(db.objectStoreNames)) {
          const all = await new Promise<unknown[]>((res) => { const rq = db.transaction(name).objectStore(name).getAll(); rq.onsuccess = () => res(rq.result); });
          parts.push(JSON.stringify(all));
        }
        db.close();
      }
      return parts.join('|');
    });
    expect(dump).not.toContain('555123');
    expect(dump).not.toContain('סודי');
    await close();
  });
});
