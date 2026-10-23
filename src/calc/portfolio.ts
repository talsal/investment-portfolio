import { RULES } from '../config/rules';
import { nz, normTicker, rate } from './num';
import type { AssetType, Currency, MarketData, Profile, TickerPack } from './types';

export type ItemKind = 'holding' | 'mmf' | 'cash';

export interface Item {
  kind: ItemKind;
  /** User-entered name, falling back to the ticker, or '' (UI supplies a final fallback). */
  name: string;
  ticker: string;
  valNis: number;
  usd: number;
  gain: number | null;
  gainNis: number | null;
  costNis: number | null;
  px: number;
  cur: Currency | '';
  ty: AssetType;
}

/** A USD holding with a known quantity and price: the unit the stock analysis works on. */
export interface Held {
  T: string;
  name: string;
  pk: TickerPack | null;
  qty: number;
  px: number;
  k: number;
  val: number;
  ty: AssetType;
  cur: Currency;
}

interface Pl { inv: number; cur: number }

export interface Computed {
  fx: number;
  fxManual: boolean;
  items: Item[];
  tradeTotal: number;
  eqTrade: number;
  gemelTotal: number;
  hishTotal: number;
  eqFund: number;
  unknownFunds: number;
  held: Held[];
  pl: { tr: Pl; gemel: Pl; hish: Pl };
  plMissing: number;
  cash: number;
  mmf: number;
  total: number;
  /** True when a money-market cost was entered, so the money-market fund is part of the profit figures. */
  mmfInPl: boolean;
  /** Bond value in ILS, using only prices the user entered (no pack fallback), as the reference does. */
  bond: number;
}

export function lookupPack(M: MarketData, t: unknown): TickerPack | null {
  const k = normTicker(t);
  return Object.prototype.hasOwnProperty.call(M.tickers, k) ? (M.tickers[k] ?? null) : null;
}

export function currencyFactor(c: Currency, fx: number): number {
  return c === 'ILS' ? 1 : c === 'AGO' ? RULES.currency.agorotFactor : fx;
}

export function effectiveFx(P: Profile, M: MarketData): { fx: number; manual: boolean } {
  const manual = nz(P.fx);
  if (manual) return { fx: manual, manual: true };
  return { fx: M.fx && M.fx > 0 ? M.fx : RULES.fx.defaultUsdIls, manual: false };
}

export function compute(P: Profile, M: MarketData): Computed {
  const { fx, manual } = effectiveFx(P, M);
  const C: Computed = {
    fx, fxManual: manual, items: [], tradeTotal: 0, eqTrade: 0, gemelTotal: 0, hishTotal: 0, eqFund: 0, unknownFunds: 0,
    held: [], pl: { tr: { inv: 0, cur: 0 }, gemel: { inv: 0, cur: 0 }, hish: { inv: 0, cur: 0 } },
    plMissing: 0, cash: 0, mmf: 0, total: 0, bond: 0, mmfInPl: false,
  };
  for (const r of P.rows) {
    const pk = lookupPack(M, r.t);
    const q = nz(r.q), k = nz(r.k), m = currencyFactor(r.c, fx);
    let px = nz(r.p);
    // Price fallback: only for USD rows whose pack entry is also USD.
    if (!px && pk && pk.price > 0 && r.c === 'USD' && (pk.cur || 'USD') === 'USD') px = pk.price;
    const val = q * px * m;
    if (!(val > 0)) continue;
    const it: Item = {
      kind: 'holding', name: r.n || r.t, ticker: r.t, valNis: val, usd: val / fx,
      gain: k > 0 && px > 0 ? ((px - k) / k) * 100 : null,
      gainNis: k > 0 ? q * (px - k) * m : null,
      costNis: k > 0 ? q * k * m : null,
      px, cur: r.c, ty: r.ty,
    };
    if (q > 0 && px > 0 && r.c === 'USD') C.held.push({ T: normTicker(r.t), name: r.n || r.t, pk, qty: q, px, k, val, ty: r.ty, cur: r.c });
    C.items.push(it);
    C.tradeTotal += val;
    if (r.ty === 'eq') C.eqTrade += val;
    if (k > 0) { C.pl.tr.inv += q * k * m; C.pl.tr.cur += val; } else C.plMissing++;
  }
  const cu = nz(P.cashUsd) * fx, cn = nz(P.cashNis), mm = nz(P.mmf);
  C.cash = cu + cn;
  C.mmf = mm;
  const mmCost = nz(P.mmfCost);
  if (mm > 0) {
    C.items.push({ kind: 'mmf', name: '', ticker: 'MMF', valNis: mm, usd: mm / fx, gain: mmCost > 0 ? ((mm - mmCost) / mmCost) * 100 : null, gainNis: mmCost > 0 ? mm - mmCost : null, costNis: mmCost > 0 ? mmCost : null, px: 0, cur: '', ty: 'other' });
    if (mmCost > 0) { C.pl.tr.inv += mmCost; C.pl.tr.cur += mm; C.mmfInPl = true; }
  }
  if (cu + cn > 0) C.items.push({ kind: 'cash', name: '', ticker: 'CASH', valNis: cu + cn, usd: (cu + cn) / fx, gain: null, gainNis: null, costNis: null, px: 0, cur: '', ty: 'other' });
  C.tradeTotal += cu + cn + mm;
  for (const g of ['gemel', 'hish'] as const) {
    for (const r of P[g]) {
      const b = nz(r.b);
      if (!(b > 0)) continue;
      C[g === 'gemel' ? 'gemelTotal' : 'hishTotal'] += b;
      const dp = nz(r.d);
      if (dp > 0) { C.pl[g].inv += dp; C.pl[g].cur += b; } else C.plMissing++;
      const e = rate(r.e);
      if (e === null) C.unknownFunds++; else C.eqFund += (b * Math.min(Math.max(e, 0), 100)) / 100;
    }
  }
  C.total = C.tradeTotal + C.gemelTotal + C.hishTotal;
  for (const r of P.rows) if (r.ty === 'bond') C.bond += nz(r.q) * nz(r.p) * currencyFactor(r.c, fx);
  return C;
}

/** Share of equities in total wealth, plus the optional target gap. */
export function equityShare(C: Computed, P: Profile) {
  const eq = C.eqTrade + C.eqFund;
  const eqPct = (eq / C.total) * 100;
  const bondPct = (C.bond / C.total) * 100;
  const target = rate(P.eqTarget);
  return {
    eq, eqPct, bond: C.bond, bondPct, otherPct: Math.max(0, 100 - eqPct - bondPct),
    target, gapNis: target !== null ? (Math.abs(eqPct - target) / 100) * C.total : null,
    aboveTarget: target !== null ? eqPct > target : null,
  };
}
