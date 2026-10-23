import { describe, expect, it } from 'vitest';
import { sustainableWithdrawal, withdrawalFor } from '../../src/calc/withdrawal';
import { compute } from '../../src/calc/portfolio';
import { market, profile } from './helpers';

/** Independent check: simulate month by month with end-of-month withdrawals. */
function endBalance(B: number, realPct: number, months: number, W: number): number {
  const i = Math.pow(1 + realPct / 100, 1 / 12) - 1;
  let b = B;
  for (let m = 0; m < months; m++) b = b * (1 + i) - W;
  return b;
}

describe('sustainableWithdrawal', () => {
  it('exhausts the balance exactly after the horizon (end-of-month withdrawals)', () => {
    for (const [B, r, y] of [[1_000_000, 3, 30], [250_000, 0.5, 10], [80_000, 7, 5], [500_000, -2, 20]] as const) {
      const w = sustainableWithdrawal(B, r, y)!;
      expect(w.months).toBe(y * 12);
      expect(Math.abs(endBalance(B, r, w.months, w.monthly))).toBeLessThan(1e-4);
      expect(w.annual).toBeCloseTo(w.monthly * 12, 9);
    }
  });
  it('is balance / months at a zero real rate', () => {
    expect(sustainableWithdrawal(120_000, 0, 10)!.monthly).toBe(1000);
  });
  it('matches a hand-computed annuity value', () => {
    // 6% real/yr over 1 year: (1+i)^12 = 1.06, so W = B*i / (1 - 1/1.06) with i = 1.06^(1/12) - 1.
    const i = Math.pow(1.06, 1 / 12) - 1;
    expect(sustainableWithdrawal(100_000, 6, 1)!.monthly).toBeCloseTo((100_000 * i) / (1 - 1 / 1.06), 6);
    expect(sustainableWithdrawal(100_000, 6, 1)!.monthly).toBeCloseTo(8599.34, 1);
  });
  it('withdraws more per month for a shorter horizon and for a higher rate', () => {
    expect(sustainableWithdrawal(1e6, 3, 20)!.monthly).toBeGreaterThan(sustainableWithdrawal(1e6, 3, 30)!.monthly);
    expect(sustainableWithdrawal(1e6, 5, 30)!.monthly).toBeGreaterThan(sustainableWithdrawal(1e6, 3, 30)!.monthly);
  });
  it('rejects invalid inputs', () => {
    expect(sustainableWithdrawal(0, 3, 10)).toBeNull();
    expect(sustainableWithdrawal(-5, 3, 10)).toBeNull();
    expect(sustainableWithdrawal(1000, 3, 0)).toBeNull();
    expect(sustainableWithdrawal(1000, 3, 61)).toBeNull();
    expect(sustainableWithdrawal(1000, -100, 10)).toBeNull();
    expect(sustainableWithdrawal(1000, NaN, 10)).toBeNull();
    expect(sustainableWithdrawal(1000, 3, 0.01)).toBeNull();
  });
});

describe('withdrawalFor', () => {
  it('uses the accessible trading portfolio only, and needs both inputs', () => {
    const P = profile({ fx: '1', mmf: '100000', gemel: [{ n: '', b: '900000', d: '', e: '', r: '' }], withdrawal: { years: '10', realRate: '0' } });
    const w = withdrawalFor(P, compute(P, market()))!;
    expect(w.balance).toBe(100000);
    expect(w.monthly).toBeCloseTo(100000 / 120, 9);
    expect(withdrawalFor({ ...P, withdrawal: { years: '10', realRate: '' } }, compute(P, market()))).toBeNull();
    expect(withdrawalFor({ ...P, withdrawal: { years: '', realRate: '3' } }, compute(P, market()))).toBeNull();
  });
});
