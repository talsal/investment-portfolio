import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser } from '@playwright/test';

/** Fixed "now" so day-count and holding-period outputs are reproducible. */
export const FROZEN_NOW = '2026-10-23T09:00:00+03:00';

const ENGINE_PATH = resolve('tests/golden/engine/engine_generic.html');
const ORIGIN = 'http://golden.test';
const STORAGE_KEY = 'pilot_profile_v2';

export interface Scenario {
  profile: unknown;
  pack: unknown;
  /** Also capture the USD view of the history chart. */
  hsUsd?: boolean;
}

export interface Snapshot {
  empty: boolean;
  subtitle: string;
  sections: Record<string, SectionSnapshot>;
  pie: { texts: string[]; legend: string[] };
  hsUsd?: SectionSnapshot;
}

export interface SectionSnapshot {
  hidden: boolean;
  tiles: string[][];
  tables: string[][][];
  totals: string[];
  notes: string[];
  svgTexts: string[];
}

function loadEngineHtml(pack: unknown): string {
  const html = readFileSync(ENGINE_PATH, 'utf8');
  const json = JSON.stringify(pack).replace(/</g, '\\u003c');
  const open = '<script type="application/json" id="marketData">';
  return html.replace(/<script type="application\/json" id="marketData">[\s\S]*?<\/script>/, () => `${open}${json}</script>`);
}

/** Runs the reference generic engine headless with the given inputs and extracts every rendered output. */
export async function runReference(browser: Browser, sc: Scenario): Promise<Snapshot> {
  const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', colorScheme: 'light', viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FROZEN_NOW));
  const html = loadEngineHtml(sc.pack);
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.addInitScript(([key, val]) => localStorage.setItem(key as string, val as string), [STORAGE_KEY, JSON.stringify(sc.profile)]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector('#outEmpty, #outMain', { state: 'attached' });
  const snap = await page.evaluate(extract);
  if (sc.hsUsd && !snap.sections.hsSection?.hidden) {
    await page.click('#hsBtnUsd');
    snap.hsUsd = (await page.evaluate(extract)).sections.hsSection;
  }
  await ctx.close();
  if (errors.length) throw new Error('Reference engine raised page errors:\n' + errors.join('\n'));
  return snap;
}

/**
 * Runs inside the page. Must stay self-contained (no imports, no closures). Shared by the reference-engine
 * harness and the new-app parity test. Elements marked data-parity-skip (new features) are ignored.
 */
export function extract(): Snapshot {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const sectionIds = ['plSection', 'trSection', 'eqSection', 'annSection', 'bfSection', 'wlSection', 'divSection', 'bmSection', 'hsSection', 'evSection', 'cfSection'];
  const sections: Record<string, SectionSnapshot> = {};
  const snapSection = (el: Element): SectionSnapshot => ({
    hidden: !!(el as HTMLElement).hidden,
    tiles: [...el.querySelectorAll('.cf-tile')].map((t) => [...t.querySelectorAll('.k, .v, .s')].map((c) => norm(c.textContent))),
    tables: [...el.querySelectorAll('table')].map((tb) => [...tb.rows].map((r) => [...r.cells].map((c) => norm(c.textContent)))),
    totals: [...el.querySelectorAll('.compare-total')].filter((c) => !c.closest('[data-parity-skip]')).map((c) => norm(c.textContent)),
    notes: [...el.querySelectorAll('.rate-note')].filter((c) => !c.closest('[data-parity-skip]')).map((c) => norm(c.textContent)),
    svgTexts: [...el.querySelectorAll('svg text')].map((c) => norm(c.textContent)),
  });
  for (const id of sectionIds) {
    const el = document.getElementById(id);
    if (el) sections[id] = snapSection(el);
  }
  const main = document.getElementById('outMain');
  if (main) {
    const total = main.querySelector('.compare-section');
    if (total) sections['totalSection'] = { ...snapSection(total), tiles: [], tables: [], svgTexts: [...main.querySelectorAll('#splitLegend .cl-item')].map((c) => norm(c.textContent)) };
  }
  const pie = document.getElementById('pie');
  const legend = document.getElementById('legend');
  return {
    empty: document.getElementById('outEmpty')?.hidden === false,
    subtitle: norm(document.getElementById('subtitle')?.textContent),
    sections,
    pie: {
      texts: pie ? [...pie.querySelectorAll('text')].map((t) => norm(t.textContent)) : [],
      legend: legend ? [...legend.querySelectorAll('li')].map((li) => norm(li.textContent)) : [],
    },
  };
}
