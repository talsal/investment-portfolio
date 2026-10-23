import type { Browser, Page } from '@playwright/test';
import { FROZEN_NOW, extract, type Scenario, type Snapshot } from '../golden/harness';
import { packToFiles } from '../support/dataFiles';

export const PROFILE_KEY = 'portfolio.profile';

export interface OpenOpts extends Scenario {
  viewport?: { width: number; height: number };
  /** When false the profile is not seeded (fresh visitor). */
  seed?: boolean;
  colorScheme?: 'light' | 'dark';
  /** Storage mode preset before the app starts: 'none' = fresh visitor who has not chosen yet. Default 'browser'. */
  mode?: 'browser' | 'file' | 'none';
  /** Overrides the served data files (path relative to data/ -> JSON). Default: derived from `pack`. */
  files?: Record<string, unknown>;
  /** Skip the frozen clock (needed to measure real durations: a fixed clock also freezes performance.now). */
  realClock?: boolean;
  /** Page to open (default '/'), e.g. '/?drafts=1'. */
  url?: string;
  /** Runs before the app loads (e.g. to install browser API fakes). */
  beforeLoad?: (page: Page) => Promise<void>;
}

/** Opens the built app with a stubbed market pack, a frozen clock and (optionally) a seeded profile. */
export async function openApp(browser: Browser, o: OpenOpts): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem', colorScheme: o.colorScheme ?? 'light',
    viewport: o.viewport ?? { width: 1100, height: 900 }, baseURL: 'http://localhost:4173',
  });
  const page = await ctx.newPage();
  if (!o.realClock) await page.clock.setFixedTime(new Date(FROZEN_NOW));
  // Serve the synthetic pack through the real file layout (market.json, history/, fundamentals/, analysis/, ...).
  const files = o.files ?? packToFiles(o.pack as Record<string, unknown>);
  await page.route('**/data/**', (r) => {
    const rel = new URL(r.request().url()).pathname.replace(/^.*\/data\//, '');
    return rel in files ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(files[rel]) }) : r.fulfill({ status: 404, body: '' });
  });
  const mode = o.mode ?? 'browser';
  await page.addInitScript(([k, v, m, doSeed]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    if (m !== 'none') localStorage.setItem('portfolio.mode', m as string);
    if (doSeed === '1') localStorage.setItem(k as string, v as string);
  }, [PROFILE_KEY, typeof o.profile === 'string' ? o.profile : JSON.stringify(o.profile), mode, o.seed !== false && mode === 'browser' ? '1' : '0']);
  await o.beforeLoad?.(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(o.url ?? '/');
  await page.waitForLoadState('networkidle');
  if (!(o.url ?? '/').includes('privacy')) await page.waitForSelector('#outMain, #outEmpty', { state: 'attached' });
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
