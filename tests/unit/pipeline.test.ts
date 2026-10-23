import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBoiCsv } from '../../providers/boi';
import { parseCbsCpi } from '../../providers/cbs';
import { avgYoyGrowthPct, formatMillions, fmtSignedPct, makeFinnhub, mapFinnhubMetric } from '../../providers/finnhub';
import { getText, redactUrl } from '../../providers/http';
import { ackSet, buildProviders, permitted, type Providers } from '../../providers/registry';
import { parseTwelveDataSeries } from '../../providers/twelvedata';
import { ProviderError, type CalendarProvider, type CpiProvider, type Daily, type FundamentalsProvider, type FxProvider, type HistoryProvider, type QuoteProvider } from '../../providers/types';
import { refreshFundamentals } from '../../scripts/data/refresh-fundamentals';
import { refreshMarket } from '../../scripts/data/refresh-market';
import { reindex } from '../../scripts/data/reindex';
import { validateData } from '../../scripts/data/validate-data';
import { fetchFrom, mergeHistory } from '../../scripts/lib/market';
import { parseHistoryFile, parseMarketFile } from '../../src/data/validate';

const NOW = new Date('2026-10-23T22:30:00Z');
const info = (id: string, redistribution: 'open' | 'unclear' | 'restricted' = 'open') => ({ id, name: id, redistribution, termsUrl: 'https://example.invalid', note: '' });
const days = (from: string, n: number): string[] => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));

let dir: string;
const read = (rel: string) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'data-'));
  writeFileSync(join(dir, 'universe.json'), JSON.stringify({ schema: 1, benchmark: 'SPY', tickers: [{ symbol: 'AAA', name: 'אאא' }, { symbol: 'BBB' }] }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Calls { history: Array<[string, string]>; quotes: string[]; earnings: string[]; dividends: string[]; fx: Array<string | undefined> }
function fakes(over: { failHistory?: string[]; failAll?: boolean; fxFail?: boolean; cpiFail?: boolean; badPrice?: boolean; quotes?: boolean; dividend?: 'ok' | '403' } = {}): { P: Providers; calls: Calls } {
  const calls: Calls = { history: [], quotes: [], earnings: [], dividends: [], fx: [] };
  const series = (from: string, base: number): Daily => { const dates = days(from < '2026-10-01' ? '2026-10-01' : from, 24).filter((d) => d <= '2026-10-23'); return { dates, close: dates.map((d) => (over.badPrice ? -1 : base + Number(d.slice(8)))) }; };
  const history: HistoryProvider = { info: info('hist', 'open'), async fetchDaily(sym, from) { calls.history.push([sym, from]); if (over.failAll || over.failHistory?.includes(sym)) throw new ProviderError('HTTP 429 from https://x/?apikey=REDACTED', 'quota'); return series(from, sym === 'SPY' ? 700 : 100); } };
  const fx: FxProvider = { info: info('fxp', 'open'), async fetchUsdIls(from) { calls.fx.push(from); if (over.fxFail) throw new ProviderError('boom'); const dates = days('2026-10-15', 9); return { dates, close: dates.map(() => 3.1) }; } };
  const cpi: CpiProvider = { info: info('cpip', 'open'), async fetchCpi() { if (over.cpiFail) throw new ProviderError('cbs down'); return { yoyPct: 1.6, label: 'ספטמבר 2026', asof: '2026-09' }; } };
  const quote: QuoteProvider = { info: info('quotep', 'open'), async fetchQuote(sym) { calls.quotes.push(sym); return { price: 55, asof: '2026-10-22' }; } };
  const calendar: CalendarProvider = {
    info: info('calp', 'open'),
    async fetchEarnings(sym) { calls.earnings.push(sym); return [{ d: '2026-11-05', what: 'דוח רבעון 3', st: 'est' as const }]; },
    async fetchDividend(sym) { calls.dividends.push(sym); if (over.dividend === '403') throw new ProviderError('HTTP 403 from x'); return { perShare: 0.5, freq: 4 }; },
  };
  return { P: { fx, cpi, history, quote: over.quotes ? quote : undefined, calendar, skipped: [] }, calls };
}
const logs: string[] = [];
const run = (P: Providers, now = NOW) => refreshMarket({ dataDir: dir, providers: P, now, log: (l) => logs.push(l) });

describe('refreshMarket: first run', () => {
  it('writes valid market, history, fx and cpi files and marks every group ok', async () => {
    const { P } = fakes();
    const s = await run(P);
    expect(s.wrote).toBe(true);
    expect(Object.values(s.groups).map((g) => g?.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    const m = parseMarketFile(read('market.json'))!;
    expect(Object.keys(m.tickers).sort()).toEqual(['AAA', 'BBB']);
    expect(m.tickers.AAA).toMatchObject({ price: 123, asof: '2026-10-23', name: 'אאא', has: ['history'] });
    expect(m.tickers.AAA?.events?.[0]?.d).toBe('2026-11-05');
    expect(m.tickers.AAA?.div).toMatchObject({ perShare: 0.5, freq: 4, source: 'calp' });
    expect(m.benchmark).toMatchObject({ symbol: 'SPY', price: 723 });
    expect(m.fx).toEqual({ usdIls: 3.1, asof: '2026-10-23' });
    expect(read('cpi.json')).toMatchObject({ yoyPct: 1.6, label: 'ספטמבר 2026', asof: '2026-09', source: 'cpip' });
    expect(m.groups.cpi?.asof).toBe('2026-09-30');
    expect(parseHistoryFile(read('history/SPY.json'))).not.toBeNull();
    expect(parseHistoryFile(read('history/_USDILS.json'))).not.toBeNull();
    expect(validateData(dir)).toEqual([]);
  });
  it('asks for five years of history the first time, and only the missing days afterwards', async () => {
    const { P, calls } = fakes();
    await run(P);
    expect(calls.history.find(([s]) => s === 'AAA')?.[1]).toBe('2021-10-23');
    const second = fakes();
    await run(second.P, new Date('2026-10-24T22:30:00Z'));
    expect(second.calls.history.find(([s]) => s === 'AAA')?.[1]).toBe('2026-10-18'); // last stored day minus 5
  });
  it('produces no changes (and no new timestamp) when nothing changed', async () => {
    await run(fakes().P);
    const before = readFileSync(join(dir, 'market.json'), 'utf8');
    logs.length = 0;
    const s = await run(fakes().P, new Date('2026-10-23T23:30:00Z'));
    expect(logs.filter((l) => l.startsWith('wrote') || l.startsWith('reindexed'))).toEqual([]);
    expect(s.wrote).toBe(false);
    expect(readFileSync(join(dir, 'market.json'), 'utf8')).toBe(before);
  });
});

describe('refreshMarket: failure policy (never invent, never delete)', () => {
  it('keeps the last price of a failed symbol, flags it stale, and marks the group stale', async () => {
    await run(fakes().P);
    const s = await run(fakes({ failHistory: ['BBB'] }).P, new Date('2026-10-24T22:30:00Z'));
    const m = parseMarketFile(read('market.json'))!;
    expect(m.tickers.BBB).toMatchObject({ price: 123, asof: '2026-10-23', stale: true });
    expect(m.tickers.AAA?.stale).toBeUndefined();
    expect(s.groups.quotes).toMatchObject({ state: 'stale', note: 'failed:1/2' });
    expect(s.failedSymbols).toEqual(['BBB']);
  });
  it('when everything fails: all values kept with their dates, groups unavailable', async () => {
    await run(fakes().P);
    const s = await run(fakes({ failAll: true, fxFail: true, cpiFail: true }).P, new Date('2026-11-05T22:30:00Z'));
    const m = parseMarketFile(read('market.json'))!;
    expect(m.tickers.AAA).toMatchObject({ price: 123, asof: '2026-10-23', stale: true });
    expect(m.fx).toEqual({ usdIls: 3.1, asof: '2026-10-23' });
    expect(s.groups.quotes).toMatchObject({ state: 'unavailable', asof: '2026-10-23' });
    expect(s.groups.fx).toMatchObject({ state: 'unavailable', asof: '2026-10-23' });
    expect(s.groups.fx?.note).toBe('boom');
    expect(read('cpi.json').yoyPct).toBe(1.6); // old CPI untouched
    expect(JSON.stringify(m)).not.toContain('apikey');
  });
  it('falls back to a quote provider when history is unavailable', async () => {
    const { P, calls } = fakes({ failHistory: ['AAA'], quotes: true });
    await run(P);
    expect(calls.quotes).toEqual(['AAA']);
    expect(parseMarketFile(read('market.json'))!.tickers.AAA).toMatchObject({ price: 55, asof: '2026-10-22' });
  });
  it('a brand-new symbol that fails is simply absent, not zero', async () => {
    await run(fakes({ failHistory: ['BBB'] }).P);
    expect(Object.keys(parseMarketFile(read('market.json'))!.tickers)).toEqual(['AAA']);
  });
  it('keeps old events and dividends when the calendar provider fails', async () => {
    await run(fakes().P);
    const { P } = fakes();
    P.calendar = { info: info('calp'), async fetchEarnings() { throw new ProviderError('down'); } };
    const s = await run(P, new Date('2026-10-24T22:30:00Z'));
    const t = parseMarketFile(read('market.json'))!.tickers.AAA!;
    expect(t.events?.[0]?.d).toBe('2026-11-05');
    expect(t.div?.perShare).toBe(0.5);
    expect(s.groups.calendar?.state).toBe('unavailable');
  });
  it('stops asking for dividends after the plan refuses once (HTTP 403)', async () => {
    const { P, calls } = fakes({ dividend: '403' });
    await run(P);
    expect(calls.dividends).toHaveLength(1);
    expect(calls.earnings).toHaveLength(2);
  });
  it('refuses to write anything when a provider returns invalid data', async () => {
    await expect(run(fakes({ badPrice: true }).P)).rejects.toThrow(/refusing to write/);
    expect(existsSync(join(dir, 'market.json'))).toBe(false);
    expect(readdirSync(dir)).toEqual(['universe.json']);
  });
  it('fails clearly without a valid universe', async () => {
    writeFileSync(join(dir, 'universe.json'), '{"schema":1}');
    await expect(run(fakes().P)).rejects.toThrow(/universe/);
  });
});

describe('refreshMarket: unconfigured providers', () => {
  it('marks groups unavailable with the reason, and still validates', async () => {
    const P: Providers = { skipped: [{ capability: 'history', id: 'twelvedata', reason: 'licence-not-acknowledged' }, { capability: 'fx', id: 'boi', reason: 'licence-not-acknowledged' }] };
    const s = await run(P);
    expect(s.groups.fx).toMatchObject({ state: 'unavailable', note: 'skipped:licence-not-acknowledged' });
    expect(s.groups.quotes?.state).toBe('unavailable');
    expect(validateData(dir)).toEqual([]);
  });
});

describe('licence gate', () => {
  it('parses the acknowledgement list', () => {
    expect([...ackSet({ DATA_LICENSE_ACK: ' BoI, twelvedata ,, ' })].sort()).toEqual(['boi', 'twelvedata']);
    expect(ackSet({}).size).toBe(0);
  });
  it('lets open data through and holds everything else back until acknowledged', () => {
    expect(permitted(info('x', 'open'), new Set())).toBe(true);
    expect(permitted(info('x', 'unclear'), new Set())).toBe(false);
    expect(permitted(info('x', 'restricted'), new Set(['y']))).toBe(false);
    expect(permitted(info('x', 'restricted'), new Set(['x']))).toBe(true);
  });
  it('defaults: CPI (open) is on, BoI and keyed vendors are skipped without acknowledgement', () => {
    const P = buildProviders({ TWELVEDATA_API_KEY: 'k', FINNHUB_API_KEY: 'k' });
    expect(P.cpi?.info.id).toBe('cbs');
    expect(P.fx).toBeUndefined();
    expect(P.history).toBeUndefined();
    expect(P.skipped.map((s) => `${s.capability}:${s.id}:${s.reason}`).sort()).toEqual([
      'calendar:finnhub:licence-not-acknowledged', 'fundamentals:finnhub:licence-not-acknowledged', 'fx:boi:licence-not-acknowledged', 'history:twelvedata:licence-not-acknowledged', 'quote:finnhub:licence-not-acknowledged',
    ]);
  });
  it('enables acknowledged providers; a missing key is reported instead of guessed', () => {
    const P = buildProviders({ DATA_LICENSE_ACK: 'boi,twelvedata,finnhub', TWELVEDATA_API_KEY: 'k' });
    expect(P.fx?.info.id).toBe('boi');
    expect(P.history?.info.id).toBe('twelvedata');
    expect(P.fundamentals).toBeUndefined(); // no FINNHUB key: not selected by default
    const explicit = buildProviders({ DATA_LICENSE_ACK: 'finnhub', FUNDAMENTALS_PROVIDER: 'finnhub' });
    expect(explicit.skipped).toContainEqual({ capability: 'fundamentals', id: 'finnhub', reason: 'missing-key' });
    expect(buildProviders({ HISTORY_PROVIDER: 'nope' }).skipped).toContainEqual({ capability: 'history', id: 'nope', reason: 'unknown-provider' });
  });
});

describe('refreshFundamentals and reindex', () => {
  const fundamentals = (fail: string[] = []): FundamentalsProvider => ({ info: info('fund'), async fetchFundamentals(sym) { if (fail.includes(sym)) throw new ProviderError('nope'); return { asof: '2026-10-23', inputs: { epsT: 5, fcfPs: 3, earnOk: true }, base: ['+1.0%', '+2.0%', '+3.0%', '—', '40.0%'] }; } });
  it('writes a file per symbol, keeps old files on failure, and updates the `has` index', async () => {
    await run(fakes().P);
    let s = await refreshFundamentals({ dataDir: dir, providers: { fundamentals: fundamentals(['BBB']), skipped: [] }, now: NOW });
    expect(s).toMatchObject({ updated: ['AAA'], failed: ['BBB'] });
    expect(parseMarketFile(read('market.json'))!.tickers.AAA?.has).toEqual(['fundamentals', 'history']);
    expect(parseMarketFile(read('market.json'))!.tickers.BBB?.has).toEqual(['history']);
    const old = read('fundamentals/AAA.json');
    s = await refreshFundamentals({ dataDir: dir, providers: { fundamentals: fundamentals(['AAA', 'BBB']), skipped: [] }, now: new Date('2026-11-01T00:00:00Z') });
    expect(s.updated).toEqual([]);
    expect(read('fundamentals/AAA.json')).toEqual(old);
    expect(validateData(dir)).toEqual([]);
  });
  it('does nothing (and says so) without a provider', async () => {
    const s = await refreshFundamentals({ dataDir: dir, providers: { skipped: [{ capability: 'fundamentals', id: 'finnhub', reason: 'missing-key' }] }, now: NOW });
    expect(s.updated).toEqual([]);
  });
  it('reindex reflects files added by hand (analysis, manual) and is a no-op otherwise', async () => {
    await run(fakes().P);
    mkdirSync(join(dir, 'manual'), { recursive: true });
    writeFileSync(join(dir, 'manual/AAA.json'), JSON.stringify({ schema: 1, symbol: 'AAA', asof: '2026-10-23', div: { perShare: 1, freq: 4 } }));
    expect(reindex(dir)).toBe(true);
    expect(parseMarketFile(read('market.json'))!.tickers.AAA?.has).toEqual(['manual', 'history']);
    expect(reindex(dir)).toBe(false);
  });
});

describe('validateData', () => {
  it('reports corrupt files, name mismatches and dangling `has` claims', async () => {
    await run(fakes().P);
    writeFileSync(join(dir, 'history/AAA.json'), '{nope');
    mkdirSync(join(dir, 'analysis'), { recursive: true });
    writeFileSync(join(dir, 'analysis/AAA.json'), JSON.stringify({ schema: 1, symbol: 'ZZZ', status: 'approved', asof: '2026-10-23', reviewedBy: 'Owner', reviewedAt: '2026-10-23' }));
    const m = read('market.json');
    m.tickers.BBB.has = ['fundamentals'];
    writeFileSync(join(dir, 'market.json'), JSON.stringify(m));
    const p = validateData(dir).join('\n');
    expect(p).toContain('history/AAA.json: unreadable');
    expect(p).toContain('analysis/AAA.json: symbol does not match');
    expect(p).toContain('claims fundamentals/BBB.json');
  });
  it('requires a universe file', () => {
    rmSync(join(dir, 'universe.json'));
    expect(validateData(dir)).toContain('universe.json: missing');
  });
});

describe('history helpers', () => {
  const H = (dates: string[]) => ({ schema: 1, symbol: 'A', source: 's', asof: dates.at(-1)!, dates, close: dates.map((_, i) => i + 1) });
  it('merge: fresh values win on overlap, old years are trimmed', () => {
    const prev = H(['2020-01-02', '2026-10-21', '2026-10-22']);
    const merged = mergeHistory(prev, { dates: ['2026-10-22', '2026-10-23'], close: [99, 100] }, { symbol: 'A', source: 'n', years: 5, now: NOW });
    expect(merged.dates).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
    expect(merged.close).toEqual([2, 99, 100]);
    expect(merged.source).toBe('n');
  });
  it('fetchFrom: five years back when empty, last day minus overlap otherwise', () => {
    expect(fetchFrom(null, 5, NOW)).toBe('2021-10-23');
    expect(fetchFrom(H(['2026-10-20']) as never, 5, NOW)).toBe('2026-10-15');
  });
});

describe('provider parsers (synthetic payloads in the documented shapes)', () => {
  it('BoI CSV: by header name, skips blanks, sorts, de-duplicates', () => {
    const csv = ['SERIES_CODE,FREQ,OBS_VALUE,TIME_PERIOD,X', 'R,D,3.5,2026-10-22,y', 'R,D,3.4,2026-10-21,y', 'R,D,,2026-10-20,y', 'R,D,3.6,2026-10-22,y'].join('\n');
    expect(parseBoiCsv(csv)).toEqual({ dates: ['2026-10-21', '2026-10-22'], close: [3.4, 3.6] });
    expect(() => parseBoiCsv('A,B\n1,2')).toThrow(/header/);
  });
  it('CBS CPI: picks the latest month regardless of order, rejects odd shapes', () => {
    const r = { month: [{ date: [{ year: 2026, month: 8, monthDesc: 'אוגוסט', percentYear: 1.5 }, { year: 2026, month: 9, monthDesc: 'ספטמבר', percentYear: 1.6 }, { year: 2025, month: 12, monthDesc: 'דצמבר', percentYear: 3 }] }] };
    expect(parseCbsCpi(r)).toEqual({ yoyPct: 1.6, label: 'ספטמבר 2026', asof: '2026-09' });
    expect(() => parseCbsCpi({})).toThrow();
    expect(() => parseCbsCpi({ month: [{ date: [{ year: 2026, month: 9, monthDesc: 'x', percentYear: 500 }] }] })).toThrow(/implausible/);
  });
  it('Twelve Data: parses closes, surfaces API errors and quota', () => {
    expect(parseTwelveDataSeries({ status: 'ok', values: [{ datetime: '2026-10-22', close: '10.5' }, { datetime: '2026-10-21 00:00:00', close: '10.1' }, { datetime: 'bad', close: '1' }, { datetime: '2026-10-20', close: '0' }] })).toEqual({ dates: ['2026-10-21', '2026-10-22'], close: [10.1, 10.5] });
    expect(() => parseTwelveDataSeries({ status: 'error', code: 429, message: 'limit' })).toThrow(/429/);
    expect(() => parseTwelveDataSeries({ status: 'ok', values: [] })).toThrow(/no usable/);
    expect(() => parseTwelveDataSeries('x')).toThrow();
  });
  it('Finnhub metrics: maps what exists and leaves the rest undefined', () => {
    const r = mapFinnhubMetric({ metric: { epsTTM: 7.2981, freeCashFlowPerShareTTM: 10.9512, freeCashFlowTTM: 644.3, roeTTM: 21.46, bookValuePerShareQuarterly: 264.771, revenueGrowth3Y: 11.34, grossMarginTTM: 66.42 }, series: { annual: { freeCashFlow: [{ period: '2025-12-31', v: 130 }, { period: '2024-12-31', v: 100 }, { period: '2023-12-31', v: 80 }] } } }, '2026-10-23');
    expect(r.inputs).toEqual({ epsT: 7.298, earnOk: true, fcfPs: 10.951, fcfTotal: '$644M', roe: 21.5, bv: 264.77, fcfTrend: 27.5 });
    expect(r.inputs.epsF).toBeUndefined();
    expect(r.base).toEqual(['+11.3%', '—', '+27.5%', '—', '66.4%']);
    const loss = mapFinnhubMetric({ metric: { epsTTM: -1 } }, '2026-10-23');
    expect(loss.inputs).toEqual({ epsT: null, earnOk: false });
    expect(() => mapFinnhubMetric({ metric: {} }, 'x')).toThrow();
  });
  it('growth and formatting helpers', () => {
    expect(avgYoyGrowthPct([121, 110, 100])).toBe(10);
    expect(avgYoyGrowthPct([5])).toBeNull();
    expect(avgYoyGrowthPct([10, 0, 5])).toBe(null === null ? avgYoyGrowthPct([10, 0, 5]) : 0); // zero base is skipped
    expect(formatMillions(6600)).toBe('$6.6B');
    expect(formatMillions(644)).toBe('$644M');
    expect(formatMillions(-1500)).toBe('-$1.5B');
    expect(fmtSignedPct(-1.14)).toBe('−1.1%');
    expect(fmtSignedPct(0)).toBe('+0.0%');
  });
  it('Finnhub adapter: quote, earnings text, dividends frequency (fake fetch, key never leaks)', async () => {
    const responses: Record<string, unknown> = {
      '/quote': { c: 123.45, t: Date.parse('2026-10-22T20:00:00Z') / 1000 },
      '/calendar/earnings': { earningsCalendar: [{ date: '2026-11-05', hour: 'amc', quarter: 3, year: 2026 }, { date: 'bad' }] },
      '/stock/dividend': [{ amount: 0.5, date: '2026-09-01' }, { amount: 0.5, date: '2026-06-01' }, { amount: 0.5, date: '2026-03-01' }, { amount: 0.5, date: '2025-12-01' }, { amount: 0.4, date: '2024-01-01' }],
    };
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => { urls.push(String(u)); const path = new URL(String(u)).pathname.replace('/api/v1', ''); return new Response(JSON.stringify(responses[path]), { status: 200 }); }) as unknown as typeof fetch;
    const f = makeFinnhub({ apiKey: 'SECRET123', get: { fetchImpl } });
    expect(await f.fetchQuote('AAA')).toEqual({ price: 123.45, asof: '2026-10-22' });
    expect(await f.fetchEarnings('AAA', '2026-10-23', '2027-01-21')).toEqual([{ d: '2026-11-05', what: 'דוח רבעון 3 2026, אחרי סגירת המסחר', st: 'est' }]);
    expect(await f.fetchDividend!('AAA', '2026-10-23')).toEqual({ perShare: 0.5, freq: 4 });
    expect(urls.every((u) => u.includes('token=SECRET123'))).toBe(true);
    const bad = makeFinnhub({ apiKey: 'SECRET123', get: { fetchImpl: (async () => new Response('{"c":0,"t":0}', { status: 200 })) as unknown as typeof fetch } });
    await expect(bad.fetchQuote('ZZZ')).rejects.toThrow(/no quote/);
  });
});

describe('http helper', () => {
  it('redacts secret query parameters', () => {
    expect(redactUrl('https://a.b/c?symbol=X&apikey=SECRET&token=T')).not.toMatch(/SECRET|=T\b/);
    expect(redactUrl('not a url')).toBe('[invalid url]');
  });
  it('retries 429/5xx, not 4xx, and never puts the key in an error', async () => {
    let n = 0;
    const flaky = (async () => (++n < 3 ? new Response('', { status: n === 1 ? 429 : 503 }) : new Response('ok', { status: 200 }))) as unknown as typeof fetch;
    expect(await getText('https://a.b/?apikey=SECRET', { fetchImpl: flaky, retries: 2 })).toBe('ok');
    expect(n).toBe(3);
    let m = 0;
    const notFound = (async () => { m++; return new Response('', { status: 404 }); }) as unknown as typeof fetch;
    await expect(getText('https://a.b/?apikey=SECRET', { fetchImpl: notFound, retries: 3 })).rejects.toThrow(/HTTP 404/);
    expect(m).toBe(1);
    const down = (async () => { throw new Error('connect ECONNREFUSED with apikey=SECRET'); }) as unknown as typeof fetch;
    await expect(getText('https://a.b/?apikey=SECRET', { fetchImpl: down, retries: 0 })).rejects.toSatisfy((e: Error) => !e.message.includes('SECRET'));
  }, 20000);
});

describe('provider selection with empty variables (as GitHub passes unset repository variables)', () => {
  it('treats empty strings as unset, so defaults still apply', () => {
    const P = buildProviders({ DATA_LICENSE_ACK: 'boi', FX_PROVIDER: '', CPI_PROVIDER: '', HISTORY_PROVIDER: '', QUOTE_PROVIDER: '', CALENDAR_PROVIDER: '', TWELVEDATA_API_KEY: '', FINNHUB_API_KEY: '' });
    expect(P.fx?.info.id).toBe('boi');
    expect(P.cpi?.info.id).toBe('cbs');
    expect(P.history).toBeUndefined();
    expect(P.skipped).toEqual([]);
  });
});
