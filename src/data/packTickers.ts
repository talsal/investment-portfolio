import type { Profile } from '../calc/types';

const SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,11}$/;

/** Tickers worth asking for: holdings in dollars and the watchlist. Symbols only; quantities and costs never leave the profile. */
export function packTickers(P: Profile): string[] {
  const out = new Set<string>();
  for (const r of P.rows) {
    const t = r.t.toUpperCase().replace(/\s+/g, '');
    if (r.c === 'USD' && SYM.test(t)) out.add(t);
  }
  for (const w of P.watchlist) { const t = w.toUpperCase().replace(/\s+/g, ''); if (SYM.test(t)) out.add(t); }
  return [...out].sort();
}
