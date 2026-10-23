import { describe, expect, it } from 'vitest';
import { benchmarkComparison, lastIndexLE, resolveBenchmark, type ResolvedBenchmark } from '../../src/calc/benchmark';
import { cashFlow } from '../../src/calc/cashflow';
import { addAssessment, evaluateCriteria, holdAssessment, watchMissing } from '../../src/calc/criteria';
import { dividendEstimate } from '../../src/calc/dividends';
import { upcomingEvents } from '../../src/calc/events';
import { buildHistory, investedSteps } from '../../src/calc/history';
import { compute } from '../../src/calc/portfolio';
import type { BfInputs } from '../../src/calc/types';
import { blankCashFlow } from '../../src/profile/schema';
import { market, profile, row } from './helpers';

const good: BfInputs = { epsT: 10, epsF: 10, fcfPs: 10, fcfTrend: 0, earnOk: true, moat: 'ok', growth: 'up' };

describe('criteria: P/E', () => {
  it('passes at exactly the forward P/E limit and fails just above', () => {
    expect(evaluateCriteria({ ...good, epsF: 10 }, 110).pePass).toBe(true); // 11.0
    expect(evaluateCriteria({ ...good, epsF: 10 }, 110.1).pePass).toBe(false);
  });
  it('requires reliable earnings', () => {
    expect(evaluateCriteria({ ...good, earnOk: false }, 50).pePass).toBe(false);
    expect(evaluateCriteria({ ...good, earnOk: undefined }, 50).pePass).toBe(true);
  });
  it('fails without forward EPS and reports trailing P/E only when EPS exists', () => {
    const c = evaluateCriteria({ ...good, epsF: null, epsT: null }, 50);
    expect(c.pePass).toBe(false);
    expect(c.peT).toBeNull();
    expect(c.peF).toBeNull();
  });
});

describe('criteria: FCF', () => {
  it('passes at exactly 8% yield and -10% trend', () => {
    expect(evaluateCriteria({ ...good, fcfPs: 8, fcfTrend: -10 }, 100).fcfPass).toBe(true);
  });
  it('fails below the yield or trend limits', () => {
    expect(evaluateCriteria({ ...good, fcfPs: 7.99, fcfTrend: 5 }, 100).fcfPass).toBe(false);
    expect(evaluateCriteria({ ...good, fcfPs: 20, fcfTrend: -10.1 }, 100).fcfPass).toBe(false);
  });
  it('uses the ROE rule when there is no FCF (financials)', () => {
    expect(evaluateCriteria({ ...good, fcfPs: undefined, roe: 15 }, 100).fcfPass).toBe(true);
    expect(evaluateCriteria({ ...good, fcfPs: undefined, roe: 14.9 }, 100).fcfPass).toBe(false);
    expect(evaluateCriteria({ ...good, fcfPs: undefined }, 100).fcfPass).toBe(false);
  });
});

describe('criteria: moat, growth and score', () => {
  it('moat passes only on ok, growth only on up', () => {
    for (const m of ['weak', 'bad', 'none', 'contested'] as const) expect(evaluateCriteria({ ...good, moat: m }, 50).moatPass).toBe(false);
    for (const g of ['slow', 'flat', 'neg', 'na'] as const) expect(evaluateCriteria({ ...good, growth: g }, 50).growthPass).toBe(false);
  });
  it('scores out of 4', () => {
    expect(evaluateCriteria(good, 50).pass).toBe(4);
    expect(evaluateCriteria({ ...good, moat: 'bad', growth: 'slow' }, 50).pass).toBe(2);
  });
});

describe('hold and add assessment', () => {
  it('no flags -> hold', () => {
    expect(holdAssessment(good)).toEqual({ level: 'hold', red: [], yellow: [] });
  });
  it('yellow flags only -> hold and watch', () => {
    const h = holdAssessment({ ...good, moat: 'weak', growth: 'slow' });
    expect(h.level).toBe('holdWatch');
    expect(h.yellow).toEqual(['moatWeak', 'growthSlow']);
  });
  it('one red flag -> check; two or more -> reconsider', () => {
    expect(holdAssessment({ ...good, moat: 'bad' }).level).toBe('checkOne');
    expect(holdAssessment({ ...good, moat: 'bad', growth: 'neg' }).level).toBe('reconsider');
    expect(holdAssessment({ ...good, fcfTrend: -0.1 }).red).toEqual(['fcfFalling']);
    expect(holdAssessment({ ...good, fcfTrend: 0 }).red).toEqual([]);
  });
  it('cyclical overrides the level but keeps the flags', () => {
    const h = holdAssessment({ ...good, cyclical: true, moat: 'bad', growth: 'neg' });
    expect(h.level).toBe('cyclical');
    expect(h.red).toHaveLength(2);
  });
  it('add candidate needs P/E, FCF, moat ok and non-negative growth', () => {
    expect(addAssessment(good, evaluateCriteria(good, 50)).candidate).toBe(true);
    // growth "slow" does not block adding
    const slow = { ...good, growth: 'slow' as const };
    expect(addAssessment(slow, evaluateCriteria(slow, 50)).candidate).toBe(true);
    const neg = { ...good, growth: 'neg' as const };
    expect(addAssessment(neg, evaluateCriteria(neg, 50)).reasons).toEqual(['growthNeg']);
    const weak = { ...good, moat: 'weak' as const };
    expect(addAssessment(weak, evaluateCriteria(weak, 50)).reasons).toEqual(['moatWeak']);
    expect(addAssessment(good, evaluateCriteria(good, 500)).reasons).toEqual(['pe', 'fcf']);
  });
  it('lists the criteria a watchlist stock still misses', () => {
    const inp = { ...good, moat: 'contested' as const, growth: 'slow' as const };
    expect(watchMissing(inp, evaluateCriteria(inp, 50))).toEqual(['moat', 'growth']);
  });
});

describe('dividendEstimate', () => {
  const M = market({ tickers: { AAA: { price: 10, div: { perShare: 0.5, freq: 4 } }, BBB: { price: 10, div: { perShare: 1 } }, CCC: { price: 10 } } });
  it('annualises per-share dividends over held quantities and defaults to quarterly', () => {
    const P = profile({ fx: '4', rows: [row({ t: 'AAA', q: '10', p: '10' }), row({ t: 'BBB', q: '5', p: '10' }), row({ t: 'CCC', q: '5', p: '10' })] });
    const d = dividendEstimate(compute(P, M))!;
    expect(d.rows.map((r) => r.annUsd)).toEqual([20, 20]);
    expect(d.annUsd).toBe(40);
    expect(d.annNis).toBe(160);
    expect(d.monthlyNis).toBeCloseTo(160 / 12);
    expect(d.netMonthlyNis).toBeCloseTo((160 * 0.75) / 12);
    expect(d.yieldOnTradePct).toBeCloseTo((160 / (200 * 4)) * 100, 6);
  });
  it('is null when no held stock pays a dividend', () => {
    expect(dividendEstimate(compute(profile({ rows: [row({ t: 'CCC', q: '5', p: '10' })] }), M))).toBeNull();
  });
});

describe('benchmark', () => {
  const dates = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-09'];
  const M = market({
    bm: { date: '2026-01-05', spyBase: 200, spyCur: 220 },
    hist: { dates, spy: [190, 200, 205, 220], close: { AAA: [8, 10, 11, 12] } },
    tickers: { AAA: { price: 12, baseClose: 10 } },
  });
  const P = profile({ rows: [row({ t: 'AAA', q: '10', p: '12' })] });

  it('uses the pack base by default', () => {
    const bm = resolveBenchmark(M, P) as ResolvedBenchmark;
    expect(bm.custom).toBe(false);
    const c = benchmarkComparison(compute(P, M), bm)!;
    expect(c.basketPct).toBeCloseTo(20);
    expect(c.spyPct).toBeCloseTo(10);
    expect(c.diff).toBeCloseTo(10);
  });
  it('derives the base from history for a user date (last close on or before it)', () => {
    const P2 = profile({ ...P, settings: { benchmarkDate: '2026-01-07', example: false } });
    const bm = resolveBenchmark(M, P2) as ResolvedBenchmark;
    expect(bm.custom).toBe(true);
    expect(bm.date).toBe('2026-01-06');
    expect(bm.spyBase).toBe(205);
    const c = benchmarkComparison(compute(P2, M), bm)!;
    expect(c.basketPct).toBeCloseTo((12 / 11 - 1) * 100);
  });
  it('reports unavailable dates instead of silently using the default', () => {
    const early = profile({ ...P, settings: { benchmarkDate: '2025-12-31', example: false } });
    expect(resolveBenchmark(M, early)).toEqual({ error: 'beforeHistory' });
    const noHist = profile({ ...P, settings: { benchmarkDate: '2026-01-06', example: false } });
    expect(resolveBenchmark(market({ bm: M.bm }), noHist)).toEqual({ error: 'noHistory' });
  });
  it('is null when there is no benchmark at all, and excludes stocks without a base', () => {
    expect(resolveBenchmark(market(), P)).toBeNull();
    const bm = resolveBenchmark(M, P) as ResolvedBenchmark;
    const P3 = profile({ rows: [row({ t: 'ZZZ', q: '1', p: '1' })] });
    expect(benchmarkComparison(compute(P3, M), bm)).toBeNull();
  });
  it('lastIndexLE returns 0 before the first date', () => {
    expect(lastIndexLE(dates, '2025-01-01')).toBe(0);
    expect(lastIndexLE(dates, '2026-01-06')).toBe(2);
    expect(lastIndexLE(dates, '2030-01-01')).toBe(3);
  });
});

describe('upcomingEvents', () => {
  const M = market({
    tickers: {
      AAA: { price: 1, events: [{ d: '2026-11-01', what: 'later', st: 'est' }, { d: null, what: 'unknown', st: 'unk' }, { d: '2026-10-20', what: 'past', st: 'confirmed' }] },
      BBB: { price: 1, events: [{ d: '2026-10-23', what: 'today', st: 'confirmed' }] },
    },
  });
  it('sorts dated events first and counts days from local midnight', () => {
    const P = profile({ rows: [row({ t: 'AAA', q: '1', p: '1' }), row({ t: 'BBB', q: '1', p: '1' })] });
    const ev = upcomingEvents(compute(P, M), new Date(2026, 9, 23, 15, 30));
    expect(ev.map((e) => e.what)).toEqual(['past', 'today', 'later', 'unknown']);
    expect(ev.map((e) => e.days)).toEqual([-3, 0, 9, null]);
  });
});

describe('cashFlow', () => {
  const cf = (o: Record<string, string>) => ({ ...blankCashFlow(), ...o });
  it('computes remainder, savings rate and cushion', () => {
    const P = profile({ cashNis: '6000', mmf: '4000', cf: cf({ income: '10000', rent: '4000', food: '1000', extra: '2000', target: '6' }) });
    const f = cashFlow(P.cf, compute(P, market()));
    expect(f.exp).toBe(5000);
    expect(f.left).toBe(5000);
    expect(f.savingsRate).toBe(0.5);
    expect(f.liquid).toBe(12000);
    expect(f.months).toBe(2.4);
    expect(f.need).toBe(30000);
    expect(f.gap).toBe(-18000);
    expect(f.monthsToFill).toBe(4);
  });
  it('has no fill estimate when saving is not positive, and no months without expenses', () => {
    const P = profile({ cf: cf({ income: '1000', rent: '2000' }) });
    const f = cashFlow(P.cf, compute(P, market()));
    expect(f.left).toBe(-1000);
    expect(f.monthsToFill).toBeNull();
    expect(cashFlow(blankCashFlow(), compute(profile(), market())).months).toBeNull();
  });
});

describe('buildHistory', () => {
  const dates = ['2026-01-02', '2026-01-05', '2026-01-06'];
  const M = market({ hist: { dates, spy: [100, 110, 121], fx: [3, 3, 4], close: { AAA: [10, 12, 15] } } });

  it('compares actual value with the same amounts in the S&P 500', () => {
    const P = profile({ trades: [{ d: '2026-01-02', t: 'AAA', s: 'B', q: '10', p: '10' }] });
    const h = buildHistory(P, M, 3)!;
    expect(h.usd.val).toEqual([100, 120, 150]);
    expect(h.usd.inv).toEqual([100, 100, 100]);
    expect(h.usd.alt[0]).toBeCloseTo(100);
    expect(h.usd.alt[2]).toBeCloseTo(121);
    expect(h.ils.val).toEqual([300, 360, 600]); // converted at each day's rate
    expect(h.ils.inv).toEqual([300, 300, 300]); // invested at the buy-date rate
    expect(h.grossUsd).toBe(100);
  });
  it('reduces net invested on sales but keeps gross purchases', () => {
    const P = profile({ trades: [{ d: '2026-01-02', t: 'AAA', s: 'B', q: '10', p: '10' }, { d: '2026-01-05', t: 'AAA', s: 'S', q: '5', p: '12' }] });
    const h = buildHistory(P, M, 3)!;
    expect(h.usd.inv).toEqual([100, 40, 40]);
    expect(h.usd.val).toEqual([100, 60, 75]);
    expect(h.grossUsd).toBe(100);
    expect(investedSteps(h, false)).toEqual([['2026-01-02', 0], ['2026-01-02', 100], ['2026-01-05', 100], ['2026-01-05', 40], ['2026-01-06', 40]]);
  });
  it('skips tickers without history and invalid trades; null when nothing remains', () => {
    const P = profile({ trades: [{ d: '2026-01-02', t: 'ZZZ', s: 'B', q: '1', p: '1' }, { d: '', t: 'AAA', s: 'B', q: '1', p: '1' }, { d: '2026-01-02', t: 'AAA', s: 'B', q: '0', p: '1' }] });
    expect(buildHistory(P, M, 3)).toBeNull();
    const P2 = profile({ trades: [{ d: '2026-01-02', t: 'ZZZ', s: 'B', q: '1', p: '1' }, { d: '2026-01-02', t: 'AAA', s: 'B', q: '1', p: '10' }] });
    expect(buildHistory(P2, M, 3)!.skipped).toEqual(['ZZZ']);
  });
  it('needs at least two history points after the first trade', () => {
    const P = profile({ trades: [{ d: '2026-01-06', t: 'AAA', s: 'B', q: '1', p: '10' }] });
    expect(buildHistory(P, M, 3)).toBeNull();
    expect(buildHistory(profile(), M, 3)).toBeNull();
  });
});

describe('missing inputs are "no data", not failures', () => {
  it('flags P/E as n/a without forward EPS, but still scores it as not passed', () => {
    const c = evaluateCriteria({ ...good, epsF: null }, 50);
    expect(c.peNa).toBe(true);
    expect(c.pePass).toBe(false);
    expect(c.pass).toBe(3);
    expect(evaluateCriteria(good, 50).peNa).toBe(false);
  });
  it('flags FCF as n/a when the trend (or ROE for financials) is missing', () => {
    expect(evaluateCriteria({ ...good, fcfTrend: undefined }, 100).fcfNa).toBe(true);
    expect(evaluateCriteria({ ...good, fcfPs: undefined, roe: undefined }, 100).fcfNa).toBe(true);
    expect(evaluateCriteria({ ...good, fcfPs: undefined, roe: 20 }, 100).fcfNa).toBe(false);
    expect(evaluateCriteria({ ...good, fcfTrend: undefined }, 100).fcfPass).toBe(false);
  });
});
