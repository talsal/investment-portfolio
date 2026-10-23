import { describe, expect, it } from 'vitest';
import { compute, effectiveFx, equityShare } from '../../src/calc/portfolio';
import { annualEstimate, realReturnPct, totalProfit, tradingReturn } from '../../src/calc/returns';
import { market, profile, row } from './helpers';

describe('effectiveFx', () => {
  it('prefers the user value, then the pack, then the default', () => {
    expect(effectiveFx(profile({ fx: '3.5' }), market({ fx: 3 }))).toEqual({ fx: 3.5, manual: true });
    expect(effectiveFx(profile(), market({ fx: 3 }))).toEqual({ fx: 3, manual: false });
    expect(effectiveFx(profile(), market())).toEqual({ fx: 3.11, manual: false });
  });
});

describe('compute', () => {
  it('values a USD holding and its gain', () => {
    const C = compute(profile({ fx: '3', rows: [row({ t: 'AAA', q: '10', k: '100', p: '120' })] }), market());
    expect(C.tradeTotal).toBe(3600);
    expect(C.items[0]?.gain).toBeCloseTo(20, 10);
    expect(C.items[0]?.gainNis).toBe(10 * 20 * 3);
    expect(C.pl.tr).toEqual({ inv: 3000, cur: 3600 });
    expect(C.total).toBe(3600);
  });
  it('handles shekel and agorot currencies', () => {
    const C = compute(profile({ rows: [row({ c: 'ILS', t: '1234567', q: '10', p: '50' }), row({ c: 'AGO', t: '7654321', q: '10', p: '5000' })] }), market());
    expect(C.items.map((i) => i.valNis).sort()).toEqual([500, 500]);
  });
  it('falls back to the pack price only for USD rows with a blank price', () => {
    const M = market({ tickers: { AAA: { price: 50, cur: 'USD' }, BBB: { price: 50, cur: 'ILS' } } });
    const C = compute(profile({ fx: '2', rows: [row({ t: 'aaa', q: '2' }), row({ t: 'BBB', q: '2' }), row({ t: 'AAA', c: 'ILS', q: '2' })] }), M);
    expect(C.items).toHaveLength(1);
    expect(C.items[0]?.valNis).toBe(200);
    expect(C.held[0]?.px).toBe(50);
  });
  it('skips rows without a positive value', () => {
    const C = compute(profile({ rows: [row({ q: '0', p: '5' }), row({ q: '5' }), row({ q: '-1', p: '2' })] }), market());
    expect(C.items).toHaveLength(0);
    expect(C.total).toBe(0);
  });
  it('adds cash and money-market to the trading total as separate items', () => {
    const C = compute(profile({ fx: '3', cashUsd: '100', cashNis: '50', mmf: '1000' }), market());
    expect(C.cash).toBe(350);
    expect(C.tradeTotal).toBe(1350);
    expect(C.items.map((i) => i.kind).sort()).toEqual(['cash', 'mmf']);
  });
  it('counts funds, their equity share and missing cost basis', () => {
    const C = compute(profile({
      gemel: [{ n: 'g', b: '1000', d: '800', e: '50', r: '' }, { n: 'g2', b: '500', d: '', e: '', r: '' }],
      hish: [{ n: 'h', b: '2000', d: '1000', e: '150', r: '' }],
    }), market());
    expect(C.gemelTotal).toBe(1500);
    expect(C.hishTotal).toBe(2000);
    expect(C.eqFund).toBe(500 + 2000); // equity % is clamped to 100
    expect(C.unknownFunds).toBe(1);
    expect(C.plMissing).toBe(1);
    expect(C.pl.gemel).toEqual({ inv: 800, cur: 1000 });
    expect(C.total).toBe(3500);
  });
  it('tracks bonds from user-entered prices only', () => {
    const C = compute(profile({ fx: '3', rows: [row({ ty: 'bond', q: '10', p: '10' })] }), market());
    expect(C.bond).toBe(300);
  });
});

describe('equityShare', () => {
  it('splits equities, bonds and the rest, with a target gap', () => {
    const P = profile({ fx: '1', eqTarget: '50', rows: [row({ q: '60', p: '1' }), row({ ty: 'bond', q: '20', p: '1' })], mmf: '20' });
    const e = equityShare(compute(P, market()), P);
    expect(e.eqPct).toBeCloseTo(60);
    expect(e.bondPct).toBeCloseTo(20);
    expect(e.otherPct).toBeCloseTo(20);
    expect(e.aboveTarget).toBe(true);
    expect(e.gapNis).toBeCloseTo(10);
  });
  it('has no gap without a target', () => {
    const P = profile({ rows: [row({ q: '1', p: '1' })] });
    expect(equityShare(compute(P, market()), P).target).toBeNull();
  });
});

describe('tradingReturn', () => {
  const DAY = 86400000;
  const now = Date.parse('2026-10-23T00:00:00Z');
  const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString().slice(0, 10);
  const base = (trades: Array<[string, string, string]>) =>
    profile({ fx: '1', rows: [row({ t: 'A', q: '10', k: '100', p: '110' })], trades: trades.map(([d, q, p]) => ({ d, t: 'A', s: 'B', q, p })) });

  it('is null without a cost basis', () => {
    const P = profile({ rows: [row({ q: '1', p: '1' })] });
    expect(tradingReturn(compute(P, market()), P, now)).toBeNull();
  });
  it('annualises linearly using the purchase-weighted holding period', () => {
    const P = base([[iso(100), '5', '100'], [iso(300), '5', '300']]); // amounts 500 and 1500 -> weights 1:3
    const r = tradingReturn(compute(P, market()), P, now)!;
    expect(r.cum).toBeCloseTo(10);
    expect(r.avgDays).toBeCloseTo((500 * 100 + 1500 * 300) / 2000, 6);
    expect(r.ann).toBeCloseTo((10 * 365) / r.avgDays, 6);
  });
  it('shows only the cumulative return under 30 days or with no dated buys', () => {
    const young = base([[iso(29), '5', '100']]);
    expect(tradingReturn(compute(young, market()), young, now)!.ann).toBeNull();
    const none = base([]);
    const r = tradingReturn(compute(none, market()), none, now)!;
    expect(r.ann).toBeNull();
    expect(r.avgDays).toBe(0);
  });
  it('uses 30 days as an inclusive threshold and ignores sells', () => {
    const P = base([[iso(30), '5', '100']]);
    P.trades.push({ d: iso(1), t: 'A', s: 'S', q: '1', p: '999' });
    expect(tradingReturn(compute(P, market()), P, now)!.ann).not.toBeNull();
  });
});

describe('totalProfit / annualEstimate / realReturn', () => {
  it('sums only parts with a cost basis', () => {
    const P = profile({ fx: '1', rows: [row({ q: '10', k: '10', p: '12' })], gemel: [{ n: '', b: '300', d: '200', e: '', r: '' }], hish: [{ n: '', b: '100', d: '', e: '', r: '' }] });
    const t = totalProfit(compute(P, market()))!;
    expect(t.inv).toBe(300);
    expect(t.cur).toBe(420);
    expect(t.profit).toBe(120);
    expect(t.retPct).toBeCloseTo(40);
    expect(t.parts.map((p) => p.key)).toEqual(['tr', 'gemel']);
  });
  it('is null when nothing has a cost basis', () => {
    expect(totalProfit(compute(profile({ mmf: '5' }), market()))).toBeNull();
  });
  it('estimates annual and monthly profit from the entered rates', () => {
    const P = profile({ mmf: '1000', tradeRate: '5', gemel: [{ n: 'g', b: '1000', d: '', e: '', r: '10' }, { n: 'no rate', b: '1000', d: '', e: '', r: '' }] });
    const a = annualEstimate(compute(P, market()), P)!;
    expect(a.bal).toBe(2000);
    expect(a.profit).toBeCloseTo(150);
    expect(a.monthly).toBeCloseTo(12.5);
    expect(a.weightedPct).toBeCloseTo(7.5);
  });
  it('computes real return as (1+nominal)/(1+inflation)-1', () => {
    expect(realReturnPct(6, 2)).toBeCloseTo((1.06 / 1.02 - 1) * 100, 10);
    expect(realReturnPct(0, 5)).toBeCloseTo(-4.7619, 3);
    expect(realReturnPct(2, 2)).toBeCloseTo(0, 10);
  });
});
