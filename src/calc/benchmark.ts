import { normTicker } from './num';
import type { Computed } from './portfolio';
import type { MarketData, Profile } from './types';

export interface ResolvedBenchmark {
  date: string;
  dateLabel: string;
  spyBase: number;
  spyCur: number;
  baseCloseOf(ticker: string, pack: { baseClose?: number } | null): number | undefined;
  custom: boolean;
}

const isoToLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Index of the last history date <= d (0 when d precedes the first date). */
export function lastIndexLE(dates: string[], d: string): number {
  let lo = 0, hi = dates.length - 1, k = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((dates[mid] as string) <= d) { k = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return k;
}

export type BenchmarkError = 'noHistory' | 'beforeHistory';

/**
 * Resolves the benchmark base. With no user date the pack's own `bm` block is used (reference behaviour).
 * With a user date the base is derived from price history: last close on or before that date.
 * Returns null when there is nothing to compare, or an error when the chosen date cannot be served.
 */
export function resolveBenchmark(M: MarketData, P: Profile): ResolvedBenchmark | { error: BenchmarkError } | null {
  const userDate = P.settings.benchmarkDate;
  const H = M.hist;
  const fromHistory = (date: string, custom: boolean): ResolvedBenchmark | { error: BenchmarkError } | null => {
    if (!H || !H.dates.length || !H.spy.length) return custom ? { error: 'noHistory' } : null;
    if (date < (H.dates[0] as string)) {
      if (custom) return { error: 'beforeHistory' };
      date = H.dates[0] as string; // default date older than the data: start of the data
    }
    const i = lastIndexLE(H.dates, date);
    const spyBase = H.spy[i] as number;
    const spyCur = M.spyNow ?? M.bm?.spyCur ?? (H.spy[H.spy.length - 1] as number);
    return {
      date: H.dates[i] as string, dateLabel: isoToLabel(H.dates[i] as string), spyBase, spyCur, custom,
      baseCloseOf: (t) => H.close[normTicker(t)]?.[i],
    };
  };
  if (userDate) return fromHistory(userDate, true);
  const bm = M.bm;
  if (bm) {
    return {
      date: bm.date, dateLabel: bm.dateLabel || bm.date, spyBase: bm.spyBase, spyCur: bm.spyCur, custom: false,
      baseCloseOf: (_t, pack) => pack?.baseClose,
    };
  }
  return M.benchmarkDefaultDate ? fromHistory(M.benchmarkDefaultDate, false) : null;
}

export function benchmarkComparison(C: Computed, bm: ResolvedBenchmark) {
  const rows = C.held
    .map((h) => ({ h, base: bm.baseCloseOf(h.T, h.pk) }))
    .filter((x): x is { h: (typeof C.held)[number]; base: number } => !!x.base && x.base > 0);
  if (!rows.length) return null;
  let vb = 0, vc = 0;
  for (const x of rows) { vb += x.h.qty * x.base; vc += x.h.qty * x.h.px; }
  const basketPct = (vc / vb - 1) * 100;
  const spyPct = (bm.spyCur / bm.spyBase - 1) * 100;
  return {
    rows: rows.map((x) => { const ch = (x.h.px / x.base - 1) * 100; return { T: x.h.T, base: x.base, px: x.h.px, changePct: ch, vsSpy: ch - spyPct }; }),
    vb, vc, basketPct, spyPct, diff: basketPct - spyPct,
  };
}
