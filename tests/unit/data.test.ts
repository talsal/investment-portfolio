import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { alignSeries, composeMarket, emptyBundle, mergeBf } from '../../src/data/compose';
import { freshness, worstLevel } from '../../src/data/freshness';
import { DataLoader, type Fetcher } from '../../src/data/loader';
import { parseAnalysisFile, parseCpiFile, parseFundamentalsFile, parseHistoryFile, parseManualFile, parseMarketFile, parseUniverseFile } from '../../src/data/validate';
import { packToFiles } from '../support/dataFiles';

const pack = JSON.parse(readFileSync('tests/golden/fixtures/pack-fake.json', 'utf8'));
const files = packToFiles(pack);

const market = (over: Record<string, unknown> = {}) => ({
  schema: 1, generatedAt: '2026-10-22T22:00:00Z', groups: { quotes: { state: 'ok', asof: '2026-10-22', fetchedAt: '2026-10-22T22:00:00Z', source: 'twelvedata' } },
  tickers: { AAA: { price: 10, asof: '2026-10-22', currency: 'USD' } }, ...over,
});

describe('validators', () => {
  it('accept a well-formed market file and keep only known fields', () => {
    const m = parseMarketFile(market({ tickers: { AAA: { price: 10, asof: '2026-10-22', currency: 'USD', evil: '<script>', has: ['history', 'bogus'] } } }));
    expect(m?.tickers.AAA).toEqual({ price: 10, asof: '2026-10-22', currency: 'USD', has: ['history'] });
  });
  it('reject malformed market files', () => {
    for (const bad of [
      null, [], 'x', market({ schema: 99 }), market({ schema: 0 }), market({ generatedAt: 5 }),
      market({ tickers: { aaa: { price: 1, asof: '2026-10-22', currency: 'USD' } } }), // symbol must be upper case
      market({ tickers: { AAA: { price: -1, asof: '2026-10-22', currency: 'USD' } } }),
      market({ tickers: { AAA: { price: NaN, asof: '2026-10-22', currency: 'USD' } } }),
      market({ tickers: { AAA: { price: 1, asof: '22.10.2026', currency: 'USD' } } }),
      market({ tickers: { AAA: { price: 1, asof: '2026-10-22', currency: 'EUR' } } }),
      market({ fx: { usdIls: 0, asof: '2026-10-22' } }),
      market({ groups: { fx: { state: 'weird', asof: null, fetchedAt: null, source: 'x' } } }),
      market({ tickers: { AAA: { price: 1, asof: '2026-10-22', currency: 'USD', div: { perShare: 1, freq: 99 } } } }),
    ]) expect(parseMarketFile(bad)).toBeNull();
  });
  it('validate history files strictly (order, alignment, positivity, size)', () => {
    const ok = { schema: 1, symbol: 'SPY', source: 't', asof: '2026-10-22', dates: ['2026-10-21', '2026-10-22'], close: [1, 2] };
    expect(parseHistoryFile(ok)).not.toBeNull();
    expect(parseHistoryFile({ ...ok, symbol: '_USDILS' })).not.toBeNull();
    for (const bad of [{ ...ok, close: [1] }, { ...ok, dates: ['2026-10-22', '2026-10-21'] }, { ...ok, dates: ['2026-10-22', '2026-10-22'] }, { ...ok, close: [1, 0] }, { ...ok, close: [1, null] }, { ...ok, symbol: 'bad symbol' }, { ...ok, dates: ['x', 'y'] }]) {
      expect(parseHistoryFile(bad)).toBeNull();
    }
  });
  it('validate fundamentals, analysis, manual, cpi and universe files', () => {
    expect(parseFundamentalsFile({ schema: 1, symbol: 'A', source: 's', asof: '2026-09-30', fetchedAt: 'x', inputs: { epsT: null, epsF: 3, earnOk: true }, base: ['1', '2', '3', '4', '5'] })).not.toBeNull();
    expect(parseFundamentalsFile({ schema: 1, symbol: 'A', source: 's', asof: '2026-09-30', fetchedAt: 'x', inputs: { epsF: '3' } })).toBeNull();
    expect(parseFundamentalsFile({ schema: 1, symbol: 'A', source: 's', asof: '2026-09-30', fetchedAt: 'x', inputs: {}, base: ['1'] })).toBeNull();
    expect(parseAnalysisFile({ schema: 1, symbol: 'A', status: 'approved', asof: '2026-09-30', reviewedBy: 'Owner', reviewedAt: '2026-10-01', moat: 'ok', growth: 'up' })).not.toBeNull();
    expect(parseAnalysisFile({ schema: 1, symbol: 'A', status: 'approved', asof: '2026-09-30', moat: 'ok', growth: 'up' })).toBeNull(); // approval needs a named reviewer
    expect(parseAnalysisFile({ schema: 1, symbol: 'A', status: 'published', asof: '2026-09-30' })).toBeNull();
    expect(parseAnalysisFile({ schema: 1, symbol: 'A', status: 'draft', asof: '2026-09-30', moat: 'great' })).toBeNull();
    expect(parseManualFile({ schema: 1, symbol: 'A', asof: '2026-09-30', div: { perShare: 1, freq: 4 }, events: [{ d: null, what: 'x' }] })).not.toBeNull();
    expect(parseManualFile({ schema: 1, symbol: 'A', asof: '2026-09-30', div: { perShare: -1, freq: 4 } })).toBeNull();
    expect(parseCpiFile({ schema: 1, yoyPct: 1.6, label: 'ספטמבר 2026', asof: '2026-09', fetchedAt: null, source: 'cbs' })).not.toBeNull();
    expect(parseCpiFile({ schema: 1, yoyPct: 1000, label: 'x', asof: '2026-09', fetchedAt: null, source: 'cbs' })).toBeNull();
    expect(parseUniverseFile({ schema: 1, benchmark: 'SPY', tickers: [{ symbol: 'A' }, { symbol: 'A' }] })).toBeNull();
    expect(parseUniverseFile({ schema: 1, benchmark: 'SPY', tickers: [{ symbol: 'A', name: 'x' }] })).not.toBeNull();
  });
});

describe('alignSeries', () => {
  const master = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'];
  it('carries values forward and back-fills before the first observation', () => {
    expect(alignSeries(master, { dates: ['2026-01-05', '2026-01-07'], close: [10, 12] })).toEqual([10, 10, 10, 12]);
  });
  it('ignores observations after the calendar and handles an exact match', () => {
    expect(alignSeries(master, { dates: master, close: [1, 2, 3, 4] })).toEqual([1, 2, 3, 4]);
    expect(alignSeries(master, { dates: ['2026-02-01'], close: [9] })).toEqual([9, 9, 9, 9]);
  });
});

describe('mergeBf', () => {
  const f = { schema: 1, symbol: 'A', source: 's', asof: '2026-09-30', fetchedAt: 'x', inputs: { epsF: 5, fcfPs: 2 } };
  const a = { schema: 1, symbol: 'A', asof: '2026-09-30', moat: 'ok', growth: 'up', moatTxt: 't', reviewedBy: 'Owner', reviewedAt: '2026-10-01' } as const;
  it('adds approved analysis text to the numbers', () => {
    expect(mergeBf(f, { ...a, status: 'approved' })).toMatchObject({ epsF: 5, moat: 'ok', growth: 'up', moatTxt: 't' });
  });
  it('never uses a draft as fact', () => {
    const bf = mergeBf(f, { ...a, status: 'draft' });
    expect(bf).toEqual({ epsF: 5, fcfPs: 2 });
    expect(mergeBf(undefined, { ...a, status: 'draft' })).toBeUndefined();
  });
  it('needs at least one source', () => { expect(mergeBf(undefined, undefined)).toBeUndefined(); });
});

describe('composeMarket', () => {
  function bundleFromFiles() {
    const b = emptyBundle();
    b.market = parseMarketFile(files['market.json']);
    b.cpi = parseCpiFile(files['cpi.json']);
    b.spy = parseHistoryFile(files['history/SPY.json']);
    b.usdIls = parseHistoryFile(files['history/_USDILS.json']);
    for (const sym of Object.keys(pack.tickers)) {
      const h = files[`history/${sym}.json`], f = files[`fundamentals/${sym}.json`], a = files[`analysis/${sym}.json`], m = files[`manual/${sym}.json`];
      if (h) b.history[sym] = parseHistoryFile(h)!;
      if (f) b.fundamentals[sym] = parseFundamentalsFile(f)!;
      if (a) b.analysis[sym] = parseAnalysisFile(a)!;
      if (m) b.manual[sym] = parseManualFile(m)!;
    }
    return b;
  }

  it('reassembles the prototype pack from the file layout without losing anything', () => {
    const M = composeMarket(bundleFromFiles());
    expect(M.asof).toBe(pack.asof);
    expect(M.fx).toBe(pack.fx);
    expect(M.hist).toEqual(pack.hist);
    for (const [sym, t] of Object.entries<any>(pack.tickers)) {
      const got = M.tickers[sym]!;
      expect(got.price, sym).toBe(t.price);
      expect(got.name, sym).toBe(t.name);
      expect(got.bf, sym).toEqual(t.bf);
      expect(got.base, sym).toEqual(t.base);
      expect(got.div, sym).toEqual(t.div);
      expect(got.events, sym).toEqual(t.events);
      expect(got.watchAdded, sym).toEqual(t.watchAdded);
    }
    expect(M.benchmarkDefaultDate).toBe(pack.bm.date);
    expect(M.spyNow).toBe(pack.hist.spy.at(-1));
  });

  it('defaults the benchmark base to the first day of the data year when none is configured', () => {
    const b = bundleFromFiles();
    delete (b.market!.benchmark as any).baseDate;
    expect(composeMarket(b).benchmarkDefaultDate).toBe('2026-01-01');
  });

  it('is empty without market.json', () => {
    expect(composeMarket(emptyBundle())).toEqual({ tickers: {} });
  });
  it('exposes carried-over prices for the freshness panel', () => {
    const b = bundleFromFiles();
    b.market!.tickers.ALFA!.stale = true;
    expect(composeMarket(b).meta?.stalePrices).toEqual(['ALFA']);
  });
});

describe('DataLoader', () => {
  function fake(extra: Record<string, unknown> = {}) {
    const requests: string[] = [];
    const all = { ...files, ...extra };
    const get: Fetcher = async (url) => { const rel = url.replace('./data/', ''); requests.push(rel); return rel in all ? all[rel] : null; };
    return { loader: new DataLoader('./data/', get), requests };
  }
  it('loads the core files first and only the per-ticker files that exist', async () => {
    const { loader, requests } = fake();
    expect(await loader.loadCore()).toBe(true);
    expect(requests.sort()).toEqual(['cpi.json', 'market.json']);
    requests.length = 0;
    expect(await loader.ensure({ held: ['ALFA', 'ETFX'], traded: [], watch: [] })).toBe(true);
    expect(requests).toContain('fundamentals/ALFA.json');
    expect(requests).toContain('history/ALFA.json');
    expect(requests).toContain('history/SPY.json');
    expect(requests).not.toContain('manual/ALFA.json'); // `has` says there is none
    expect(requests.some((r) => r.includes('ETFX'))).toBe(false); // ETFX has no per-ticker files
    expect(requests.some((r) => r.includes('ZETA'))).toBe(false);
  });
  it('does not fetch history for watchlist-only tickers, and fetches it for traded ones', async () => {
    const { loader, requests } = fake();
    await loader.loadCore();
    await loader.ensure({ held: [], traded: [], watch: ['ZETA'] });
    expect(requests.some((r) => r.startsWith('history/'))).toBe(false);
    expect(requests).toContain('manual/ZETA.json');
    await loader.ensure({ held: [], traded: ['DELT'], watch: [] });
    expect(requests).toContain('history/DELT.json');
  });
  it('never refetches, ignores unknown or invalid symbols, and reports whether anything changed', async () => {
    const { loader, requests } = fake();
    await loader.loadCore();
    expect(await loader.ensure({ held: ['ALFA'], traded: [], watch: [] })).toBe(true);
    const n = requests.length;
    expect(await loader.ensure({ held: ['ALFA'], traded: [], watch: [] })).toBe(false);
    expect(await loader.ensure({ held: ['../../etc/passwd', 'NOPE', 'alfa'], traded: [], watch: [] })).toBe(false);
    expect(requests.length).toBe(n);
  });
  it('degrades quietly when files are missing or malformed', async () => {
    const { loader } = fake({ 'market.json': { schema: 1 } });
    expect(await loader.loadCore()).toBe(false);
    expect(loader.market()).toEqual({ tickers: {} });
    expect(await loader.ensure({ held: ['ALFA'], traded: [], watch: [] })).toBe(false);
    const bad = fake({ 'fundamentals/ALFA.json': { nonsense: true } });
    await bad.loader.loadCore();
    await bad.loader.ensure({ held: ['ALFA'], traded: [], watch: [] });
    expect(bad.loader.market().tickers.ALFA?.bf?.epsF).toBeUndefined();
  });
  it('composes lazily and recomposes when new data arrives', async () => {
    const { loader } = fake();
    await loader.loadCore();
    const first = loader.market();
    expect(loader.market()).toBe(first);
    expect(first.tickers.ALFA?.bf).toBeUndefined();
    await loader.ensure({ held: ['ALFA'], traded: [], watch: [] });
    expect(loader.market().tickers.ALFA?.bf?.moat).toBe('ok');
  });
});

describe('freshness', () => {
  const now = new Date(2026, 9, 23, 12);
  const M = (g: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ tickers: {}, meta: { groups: g, fundamentalsAsof: {}, stalePrices: [], cpiAsof: null, historyAsof: null, ...extra } }) as any;
  const grp = (state: string, asof: string | null) => ({ state, asof, fetchedAt: null, source: 'x' });

  it('marks fresh data ok and old data stale by the configured thresholds', () => {
    const items = freshness(M({ quotes: grp('ok', '2026-10-22'), fx: grp('ok', '2026-10-18'), benchmark: grp('ok', '2026-10-19') }), now);
    expect(items.find((i) => i.id === 'quotes')?.level).toBe('ok');
    expect(items.find((i) => i.id === 'fx')).toMatchObject({ level: 'stale', ageDays: 5 });
    expect(items.find((i) => i.id === 'benchmark')).toMatchObject({ level: 'ok', ageDays: 4 }); // the limit itself is still fresh
  });
  it('treats the pipeline saying stale/unavailable as such even when the date looks fine', () => {
    const items = freshness(M({ quotes: grp('stale', '2026-10-22'), fx: grp('unavailable', '2026-10-01'), calendar: grp('unavailable', null) }), now);
    expect(items.map((i) => i.level)).toEqual(['stale', 'unavailable', 'unavailable']);
    expect(worstLevel(items)).toBe('unavailable');
  });
  it('counts CPI from the end of its month and checks fundamentals only for held stocks', () => {
    const items = freshness(M({ cpi: grp('ok', '2026-09') }, { cpiAsof: '2026-09', fundamentalsAsof: { AAA: '2026-03-01', BBB: '2026-10-01' } }), now, ['BBB']);
    expect(items.find((i) => i.id === 'cpi')?.level).toBe('ok'); // 23 days after Sept 30
    expect(items.find((i) => i.id === 'fundamentals')).toMatchObject({ level: 'ok', asof: '2026-10-01' });
    const old = freshness(M({}, { fundamentalsAsof: { AAA: '2026-03-01' } }), now, ['AAA']);
    expect(old.find((i) => i.id === 'fundamentals')?.level).toBe('stale');
  });
  it('reports nothing when there is no provenance (bundled example)', () => {
    expect(freshness({ tickers: {} }, now)).toEqual([]);
    expect(worstLevel([])).toBe('ok');
  });
});

describe('freshness: reasons', () => {
  it('passes the pipeline note through so the UI can explain why data is missing', () => {
    const items = freshness({ tickers: {}, meta: { groups: { fx: { state: 'unavailable', asof: null, fetchedAt: null, source: 'boi', note: 'skipped:licence-not-acknowledged' } }, fundamentalsAsof: {}, stalePrices: [], cpiAsof: null, historyAsof: null } } as any, new Date(2026, 9, 23));
    expect(items[0]).toMatchObject({ id: 'fx', level: 'unavailable', note: 'skipped:licence-not-acknowledged' });
  });
});
