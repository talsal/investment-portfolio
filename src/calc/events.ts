import type { Computed } from './portfolio';
import type { EventStatus } from './types';

export interface EventRow { d: string | null; who: string; what: string; st: EventStatus; days: number | null }

/** Earnings/events of held stocks, dated first (ascending), undated last. `today` is injected. */
export function upcomingEvents(C: Computed, today: Date): EventRow[] {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const out: EventRow[] = [];
  for (const h of C.held) {
    for (const e of h.pk?.events ?? []) {
      let days: number | null = null;
      if (e.d) {
        const [y, m, d] = e.d.split('-').map(Number) as [number, number, number];
        days = Math.round((new Date(y, m - 1, d).getTime() - t0) / 86400000);
      }
      out.push({ d: e.d || null, who: h.T, what: e.what, st: e.st || 'est', days });
    }
  }
  return out.sort((a, b) => { if (!a.d) return 1; if (!b.d) return -1; return a.d < b.d ? -1 : 1; });
}
