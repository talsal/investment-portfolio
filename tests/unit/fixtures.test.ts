import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const load = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));

describe('synthetic golden fixtures', () => {
  const pack = load('pack-fake');
  const profile = load('profile-fake');

  it('pack history arrays are aligned', () => {
    const n = pack.hist.dates.length;
    expect(pack.hist.fx).toHaveLength(n);
    expect(pack.hist.spy).toHaveLength(n);
    for (const [t, arr] of Object.entries(pack.hist.close)) expect(arr, t).toHaveLength(n);
  });

  it('uses only fake tickers (guard against copying real holdings)', () => {
    const allowed = new Set(['ALFA', 'BETA', 'GAMA', 'DELT', 'EPSI', 'ZETA', 'ETFX', 'BNDX', 'QQQQ', '1234567', '7654321']);
    for (const t of Object.keys(pack.tickers)) expect(allowed.has(t), t).toBe(true);
    for (const r of profile.rows) expect(allowed.has(r.t), r.t).toBe(true);
    for (const tr of profile.trades) expect(allowed.has(tr.t), tr.t).toBe(true);
  });
});
