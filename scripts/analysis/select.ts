import type { AnalysisFile, FundamentalsFile, UniverseFile } from '../../src/data/schema';

export type Reason = 'missing' | 'stale' | 'newer-fundamentals' | 'requested';
export type SkipReason = 'no-fundamentals' | 'no-price' | 'draft-pending' | 'up-to-date' | 'over-limit';

export interface SelectArgs {
  universe: UniverseFile;
  /** Data lookups by symbol. */
  fundamentals: (s: string) => FundamentalsFile | null;
  published: (s: string) => AnalysisFile | null;
  draft: (s: string) => AnalysisFile | null;
  hasPrice: (s: string) => boolean;
  today: string;
  maxAgeDays: number;
  max: number;
  /** Explicit symbols: bypass the up-to-date / pending checks (still need fundamentals and a price). */
  only?: string[];
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const RANK: Record<Reason, number> = { requested: 0, missing: 1, stale: 2, 'newer-fundamentals': 3 };

/**
 * Which stocks need a (new) draft. Costs money per stock, so: only stocks with fundamentals and a price,
 * nothing already awaiting review, nothing that is current, and at most `max` per run (most urgent first).
 */
export function selectSymbols(a: SelectArgs): { selected: Array<{ symbol: string; reason: Reason }>; skipped: Array<{ symbol: string; reason: SkipReason }> } {
  const only = a.only?.length ? new Set(a.only.map((s) => s.toUpperCase())) : null;
  const pool = a.universe.tickers.map((t) => t.symbol).filter((s) => !only || only.has(s));
  const skipped: Array<{ symbol: string; reason: SkipReason }> = [];
  const wanted: Array<{ symbol: string; reason: Reason }> = [];
  for (const symbol of pool) {
    const f = a.fundamentals(symbol);
    if (!f) { skipped.push({ symbol, reason: 'no-fundamentals' }); continue; }
    if (!a.hasPrice(symbol)) { skipped.push({ symbol, reason: 'no-price' }); continue; }
    if (only) { wanted.push({ symbol, reason: 'requested' }); continue; }
    const pub = a.published(symbol);
    const approved = pub && pub.status === 'approved' ? pub : null;
    const reviewed = approved ? (approved.reviewedAt ?? approved.asof) : null;
    let reason: Reason | null = null;
    if (!approved) reason = 'missing';
    else if (days(reviewed as string, a.today) > a.maxAgeDays) reason = 'stale';
    else if (f.asof > (approved.asof as string)) reason = 'newer-fundamentals';
    if (!reason) { skipped.push({ symbol, reason: 'up-to-date' }); continue; }
    if (a.draft(symbol)) { skipped.push({ symbol, reason: 'draft-pending' }); continue; }
    wanted.push({ symbol, reason });
  }
  wanted.sort((x, y) => RANK[x.reason] - RANK[y.reason]);
  for (const w of wanted.slice(a.max)) skipped.push({ symbol: w.symbol, reason: 'over-limit' });
  return { selected: wanted.slice(0, a.max), skipped };
}
