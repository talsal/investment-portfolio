import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './appHarness';
import { packToFiles } from '../support/dataFiles';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));

/** Five years of daily history for the fake tickers, and a large profile: the worst realistic case. */
function heavy() {
  const pack = structuredClone(fx('pack-fake'));
  const dates: string[] = [];
  for (let d = new Date(Date.UTC(2021, 9, 25)); d <= new Date(Date.UTC(2026, 9, 22)); d = new Date(d.getTime() + 86400000)) if (d.getUTCDay() % 6 !== 0) dates.push(d.toISOString().slice(0, 10));
  const walk = (start: number, k: number) => dates.map((_, i) => Math.round((start + 20 * Math.sin(i / (30 + k)) + i * 0.03) * 100) / 100);
  pack.hist = { dates, spy: walk(400, 0), fx: dates.map((_, i) => 3.1 + 0.2 * Math.sin(i / 200)), close: Object.fromEntries(Object.keys(pack.hist.close).map((t, k) => [t, walk(60 + 20 * k, k)])) };
  pack.bm = { date: dates[0], dateLabel: '', spyBase: 0, spyCur: 0 };
  for (const t of Object.keys(pack.hist.close)) pack.tickers[t].price = pack.hist.close[t].at(-1);
  const profile = structuredClone(fx('profile-fake'));
  const syms = Object.keys(pack.hist.close);
  profile.trades = Array.from({ length: 400 }, (_, i) => ({ d: dates[(i * 3) % (dates.length - 2)], t: syms[i % syms.length], s: i % 9 === 8 ? 'S' : 'B', q: String(1 + (i % 5)), p: String(50 + (i % 40)) }));
  profile.rows = [...profile.rows, ...Array.from({ length: 40 }, (_, i) => ({ n: `נייר ${i}`, t: syms[i % syms.length], c: 'USD', ty: 'eq', q: '3', k: '50', p: '60' }))];
  return { pack, profile };
}

test.describe('performance (generous budgets: these catch order-of-magnitude regressions, not noise)', () => {
  test('5 years of history, 400 trades, 50 holdings: first render and edits stay fast', async ({ browser }) => {
    const { pack, profile } = heavy();
    const { page, errors, close } = await openApp(browser, { profile, pack, realClock: true });
    await expect(page.locator('#hsSection')).toBeVisible();
    const first = await page.evaluate(() => performance.getEntriesByName('render').map((e) => e.duration).sort((a, b) => b - a)[0] ?? 0);
    console.log('PERF first render ms:', Math.round(first));
    expect(first).toBeLessThan(1500);
    // Typing into a field triggers a full re-render: measure it.
    await page.evaluate(() => performance.clearMeasures('render'));
    await page.fill('[data-top="cashNis"]', '12345');
    await page.waitForTimeout(200);
    const edit = await page.evaluate(() => Math.max(0, ...performance.getEntriesByName('render').map((e) => e.duration)));
    console.log('PERF edit render ms:', Math.round(edit));
    expect(edit).toBeLessThan(800);
    expect(errors).toEqual([]);
    await close();
  });

  test('the built bundle stays small', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const js = readdirSync('dist/assets').filter((f) => f.endsWith('.js') && !f.endsWith('.map'));
    const largest = Math.max(...js.map((f) => statSync(`dist/assets/${f}`).size));
    expect(largest).toBeLessThan(140 * 1024); // main chunk, uncompressed (about 30 KB gzipped today)
    const css = readdirSync('dist/assets').filter((f) => f.endsWith('.css')).map((f) => statSync(`dist/assets/${f}`).size);
    expect(Math.max(...css)).toBeLessThan(40 * 1024);
  });
});
