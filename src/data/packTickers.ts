import type { Currency, Profile } from '../calc/types';

const SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,11}$/;

export interface PackWant { t: string; cur: Currency; name: string }

/** The name the user typed, made safe to put in a sentence: one line, no quotes or backticks, at most 60 characters. */
const cleanName = (n: string): string => n.replace(/[\u0000-\u001f"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * What to ask the user's assistant for: every holding (symbol or security number, the currency the row is priced in, and
 * the name the user typed) plus the watchlist (dollars). Quantities, costs and balances are never part of it.
 */
export function packWants(P: Profile): PackWant[] {
  const out = new Map<string, PackWant>();
  for (const r of P.rows) {
    const t = r.t.toUpperCase().replace(/\s+/g, '');
    if (SYM.test(t) && !out.has(t)) out.set(t, { t, cur: r.c, name: cleanName(r.n) });
  }
  for (const w of P.watchlist) {
    const t = w.toUpperCase().replace(/\s+/g, '');
    if (SYM.test(t) && !out.has(t)) out.set(t, { t, cur: 'USD', name: '' });
  }
  return [...out.values()].sort((a, b) => a.t.localeCompare(b.t));
}
