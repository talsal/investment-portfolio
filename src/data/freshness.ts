import type { MarketData } from '../calc/types';
import { RULES } from '../config/rules';

export type FreshId = 'fx' | 'quotes' | 'benchmark' | 'calendar' | 'cpi' | 'fundamentals' | 'history';
export type FreshLevel = 'ok' | 'stale' | 'unavailable' | 'missing';

export interface FreshnessItem {
  id: FreshId;
  level: FreshLevel;
  /** Date the data refers to (YYYY-MM-DD or YYYY-MM for CPI), when known. */
  asof: string | null;
  ageDays: number | null;
  source: string | null;
  /** Pipeline note (machine-readable), e.g. "skipped:licence-not-acknowledged". */
  note?: string;
}

const DAY = 86400000;

function ageInDays(asof: string, now: Date): number {
  // A month ("YYYY-MM") counts from its last day.
  const d = asof.length === 7 ? new Date(Date.UTC(+asof.slice(0, 4), +asof.slice(5, 7), 0)) : new Date(asof + 'T00:00:00Z');
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - d.getTime()) / DAY));
}

function item(id: FreshId, now: Date, fileState: 'ok' | 'stale' | 'unavailable' | null, asof: string | null, source: string | null, note?: string): FreshnessItem {
  if (!asof) return { id, level: fileState === 'unavailable' ? 'unavailable' : 'missing', asof: null, ageDays: null, source, note };
  const age = ageInDays(asof, now);
  const old = age > RULES.freshness.staleAfterDays[id];
  const level: FreshLevel = fileState === 'unavailable' ? 'unavailable' : fileState === 'stale' || old ? 'stale' : 'ok';
  return { id, level, asof, ageDays: age, source, note };
}

/**
 * Freshness of every data group the page relies on. The state written by the pipeline and the age of the data
 * are both considered, so a pipeline that silently stopped running still shows up as stale.
 * `heldSymbols` limits the fundamentals check to the stocks the user actually holds.
 */
export function freshness(M: MarketData, now: Date, heldSymbols: string[] = []): FreshnessItem[] {
  const meta = M.meta;
  if (!meta) return [];
  const out: FreshnessItem[] = [];
  for (const id of ['quotes', 'fx', 'benchmark', 'calendar'] as const) {
    const g = meta.groups[id];
    if (g) out.push(item(id, now, g.state, g.asof, g.source, g.note));
  }
  if (meta.historyAsof) out.push(item('history', now, null, meta.historyAsof, null));
  const cpi = meta.groups.cpi;
  if (cpi || meta.cpiAsof) out.push(item('cpi', now, cpi?.state ?? null, meta.cpiAsof ?? cpi?.asof ?? null, cpi?.source ?? null, cpi?.note));
  const dates = heldSymbols.map((s) => meta.fundamentalsAsof[s]).filter((d): d is string => !!d).sort();
  if (dates.length) out.push(item('fundamentals', now, null, dates[0] as string, null));
  return out;
}

export const worstLevel = (items: FreshnessItem[]): FreshLevel =>
  (['unavailable', 'stale', 'missing', 'ok'] as const).find((l) => items.some((i) => i.level === l)) ?? 'ok';
