import type { GroupStatus, HistoryFile, MarketFile } from '../../src/data/schema';
import { DATA_SCHEMA } from '../../src/data/schema';
import type { Daily } from '../../providers/types';

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const DAY = 86400000;

/** Where to start fetching: a few days before the last stored point (to pick up revisions), else N years back. */
export function fetchFrom(prev: HistoryFile | null, years: number, now: Date, overlapDays = 5): string {
  if (prev?.dates.length) return isoDay(new Date(Date.parse(prev.dates[prev.dates.length - 1] as string) - overlapDays * DAY));
  const d = new Date(now); d.setUTCFullYear(d.getUTCFullYear() - years);
  return isoDay(d);
}

/** Merges a fresh series into stored history (fresh values win on overlap), keeping only the last N years. */
export function mergeHistory(prev: HistoryFile | null, fresh: Daily, o: { symbol: string; source: string; years: number; now: Date }): HistoryFile {
  const byDate = new Map<string, number>();
  if (prev) prev.dates.forEach((d, i) => byDate.set(d, prev.close[i] as number));
  fresh.dates.forEach((d, i) => byDate.set(d, fresh.close[i] as number));
  const cutoff = new Date(o.now); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - o.years);
  const dates = [...byDate.keys()].filter((d) => d >= isoDay(cutoff)).sort();
  return { schema: DATA_SCHEMA, symbol: o.symbol, source: o.source, asof: dates[dates.length - 1] as string, dates, close: dates.map((d) => byDate.get(d) as number) };
}

export const okGroup = (asof: string, source: string, now: Date): GroupStatus => ({ state: 'ok', asof, fetchedAt: now.toISOString(), source });

/** A group that could not be refreshed: keeps the last known date so the UI can say "as of <date>". */
export function failedGroup(prev: GroupStatus | undefined, source: string, note: string, state: 'stale' | 'unavailable' = 'unavailable'): GroupStatus {
  return { state, asof: prev?.asof ?? null, fetchedAt: prev?.fetchedAt ?? null, source, note: note.slice(0, 200) };
}

/**
 * True when two market files differ in nothing but timestamps (generatedAt, groups[*].fetchedAt). An unchanged
 * run therefore leaves the file alone and produces no git commit; the timestamps move whenever data changes.
 */
export function sameContent(a: MarketFile | null, b: MarketFile): boolean {
  if (!a) return false;
  const strip = (m: MarketFile) => JSON.stringify({ ...m, generatedAt: '', groups: Object.fromEntries(Object.entries(m.groups).map(([k, g]) => [k, { ...g, fetchedAt: '' }])) });
  return strip(a) === strip(b);
}

export const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);
