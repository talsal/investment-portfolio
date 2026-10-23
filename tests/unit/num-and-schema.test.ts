import { describe, expect, it } from 'vitest';
import { normTicker, numStr, nz, rate } from '../../src/calc/num';
import { RULES } from '../../src/config/rules';
import { blankProfile, sanitizeProfile } from '../../src/profile/schema';

describe('number parsing', () => {
  it('nz accepts positive numbers and thousands commas, else 0', () => {
    expect(nz('1,234.5')).toBe(1234.5);
    expect(nz('-5')).toBe(0);
    expect(nz('0')).toBe(0);
    expect(nz('abc')).toBe(0);
    expect(nz('')).toBe(0);
    expect(nz(undefined)).toBe(0);
  });
  it('rate allows negatives and returns null when blank/invalid', () => {
    expect(rate('-3.5')).toBe(-3.5);
    expect(rate('')).toBeNull();
    expect(rate('x')).toBeNull();
    expect(rate('0')).toBe(0);
  });
  it('numStr enforces range', () => {
    expect(numStr('5', 0, 10)).toBe('5');
    expect(numStr('11', 0, 10)).toBe('');
    expect(numStr('-1', 0, 10)).toBe('');
    expect(numStr('1e400', 0, 1e10)).toBe('');
    expect(numStr(null, 0, 10)).toBe('');
  });
  it('normTicker strips whitespace and uppercases', () => {
    expect(normTicker(' brk b ')).toBe('BRKB');
    expect(normTicker(null)).toBe('');
  });
});

describe('sanitizeProfile', () => {
  it('returns a blank profile for non-objects', () => {
    for (const bad of [null, undefined, 5, 'x', [], true]) expect(sanitizeProfile(bad)).toEqual(blankProfile());
  });
  it('drops unknown fields and coerces enums', () => {
    const p = sanitizeProfile({ rows: [{ n: 'a', t: 'x', c: 'EUR', ty: 'weird', q: '1', evil: '<script>' }], __proto__: { polluted: 1 }, junk: 1 });
    expect(p.rows[0]).toEqual({ n: 'a', t: 'x', c: 'USD', ty: 'eq', q: '1', k: '', p: '' });
    expect(Object.keys(p)).not.toContain('junk');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('caps list sizes and string lengths', () => {
    const rows = Array.from({ length: 200 }, () => ({ n: 'n'.repeat(500), t: 'T'.repeat(500) }));
    const p = sanitizeProfile({ rows });
    expect(p.rows).toHaveLength(RULES.limits.rows);
    expect(p.rows[0]?.n).toHaveLength(40);
    expect(p.rows[0]?.t).toHaveLength(12);
  });
  it('validates numeric ranges and dates', () => {
    const p = sanitizeProfile({ fx: '0.5', eqTarget: '120', cashUsd: '-1', trades: [{ d: '2026-1-1', t: 'abc', s: 'S', q: '2', p: '3' }], settings: { benchmarkDate: 'nope' } });
    expect(p.fx).toBe('');
    expect(p.eqTarget).toBe('');
    expect(p.cashUsd).toBe('');
    expect(p.trades[0]).toEqual({ d: '', t: 'ABC', s: 'S', q: '2', p: '3' });
    expect(p.settings.benchmarkDate).toBe('');
  });
  it('accepts the legacy v2 shape (no settings) and keeps a valid benchmark date', () => {
    expect(sanitizeProfile({ fx: '3.2' }).settings).toEqual({ benchmarkDate: '', example: false });
    expect(sanitizeProfile({ settings: { benchmarkDate: '2026-03-02' } }).settings.benchmarkDate).toBe('2026-03-02');
  });
  it('limits cushion months to the allowed options', () => {
    expect(sanitizeProfile({ cf: { target: '7' } }).cf.target).toBe('6');
    expect(sanitizeProfile({ cf: { target: '9' } }).cf.target).toBe('9');
  });
});

describe('rules.json', () => {
  it('holds the reference thresholds', () => {
    expect(RULES.criteria.pe.maxForward).toBe(11);
    expect(RULES.criteria.fcf).toEqual({ minYieldPct: 8, minTrendPctPerYear: -10, roeMinPct: 15 });
    expect(RULES.annualization).toMatchObject({ minHoldingDays: 30, daysPerYear: 365 });
    expect(RULES.dividends.netTaxApprox).toBe(0.25);
    expect(RULES.fx.defaultUsdIls).toBe(3.11);
    expect(RULES.currency.agorotFactor).toBe(0.01);
  });
});
