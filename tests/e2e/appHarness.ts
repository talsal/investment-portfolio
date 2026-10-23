import type { Browser, Page } from '@playwright/test';
import { FROZEN_NOW, extract, type Scenario, type Snapshot } from '../golden/harness';

export const PROFILE_KEY = 'portfolio.profile';

export interface OpenOpts extends Scenario {
  viewport?: { width: number; height: number };
  /** When false the profile is not seeded (fresh visitor). */
  seed?: boolean;
  colorScheme?: 'light' | 'dark';
}

/** Opens the built app with a stubbed market pack, a frozen clock and (optionally) a seeded profile. */
export async function openApp(browser: Browser, o: OpenOpts): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem', colorScheme: o.colorScheme ?? 'light',
    viewport: o.viewport ?? { width: 1100, height: 900 }, baseURL: 'http://localhost:4173',
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FROZEN_NOW));
  await page.route('**/data/market-pack.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o.pack) }));
  await page.route('**/data/cpi.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"yoyPct":null,"label":""}' }));
  if (o.seed !== false) await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k as string, v as string); sessionStorage.setItem('seeded', '1'); } }, [PROFILE_KEY, JSON.stringify(o.profile)]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('#outMain, #outEmpty', { state: 'attached' });
  return { page, errors, close: () => ctx.close() };
}

/** Runs the new app with the same inputs as the reference engine and extracts the same outputs. */
export async function runApp(browser: Browser, sc: Scenario): Promise<Snapshot> {
  const { page, errors, close } = await openApp(browser, sc);
  const snap = await page.evaluate(extract);
  if (sc.hsUsd && !snap.sections.hsSection?.hidden) {
    await page.click('#hsBtnUsd');
    snap.hsUsd = (await page.evaluate(extract)).sections.hsSection;
  }
  await close();
  if (errors.length) throw new Error('App raised errors:\n' + errors.join('\n'));
  return snap;
}
