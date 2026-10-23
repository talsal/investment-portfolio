import { boi } from './boi';
import { cbs } from './cbs';
import { makeFinnhub } from './finnhub';
import { makeTase } from './tase';
import { makeTwelveData } from './twelvedata';
import type { CalendarProvider, CpiProvider, FundamentalsProvider, FxProvider, HistoryProvider, ProviderInfo, QuoteProvider } from './types';

export type Env = Record<string, string | undefined>;

export interface Skipped { capability: string; id: string; reason: 'missing-key' | 'licence-not-acknowledged' | 'unknown-provider' }

export interface Providers {
  fx?: FxProvider;
  history?: HistoryProvider;
  quote?: QuoteProvider;
  fundamentals?: FundamentalsProvider;
  calendar?: CalendarProvider;
  cpi?: CpiProvider;
  skipped: Skipped[];
}

/** Provider ids the owner has confirmed they may publish (repository variable DATA_LICENSE_ACK, comma separated). */
export function ackSet(env: Env): Set<string> {
  return new Set((env.DATA_LICENSE_ACK ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** The licence gate: open data always passes; anything else only when acknowledged by id. */
export function permitted(info: ProviderInfo, ack: Set<string>): boolean {
  return info.redistribution === 'open' || ack.has(info.id);
}

type Maker<T> = { info: ProviderInfo; make: () => T | null };

/**
 * Chooses a provider per capability from environment variables (so a vendor can be swapped without code changes):
 *   FX_PROVIDER=boi  CPI_PROVIDER=cbs  HISTORY_PROVIDER=twelvedata|tase  QUOTE_PROVIDER=finnhub
 *   FUNDAMENTALS_PROVIDER=finnhub  CALENDAR_PROVIDER=finnhub
 * Keys: TWELVEDATA_API_KEY, FINNHUB_API_KEY, TASE_API_KEY. Defaults apply only when the needed key exists.
 */
export function buildProviders(env: Env, now: () => Date = () => new Date()): Providers {
  const ack = ackSet(env);
  const out: Providers = { skipped: [] };
  const td = env.TWELVEDATA_API_KEY, fh = env.FINNHUB_API_KEY;
  const finnhub = fh ? makeFinnhub({ apiKey: fh, now }) : null;

  function pick<T>(capability: keyof Omit<Providers, 'skipped'>, envName: string, def: string | null, table: Record<string, Maker<T>>): T | undefined {
    const id = (env[envName] ?? def ?? '').trim().toLowerCase();
    if (!id) return undefined;
    const m = table[id];
    if (!m) { out.skipped.push({ capability, id, reason: 'unknown-provider' }); return undefined; }
    if (!permitted(m.info, ack)) { out.skipped.push({ capability, id, reason: 'licence-not-acknowledged' }); return undefined; }
    const p = m.make();
    if (!p) { out.skipped.push({ capability, id, reason: 'missing-key' }); return undefined; }
    return p;
  }

  out.fx = pick<FxProvider>('fx', 'FX_PROVIDER', 'boi', { boi: { info: boi.info, make: () => boi } });
  out.cpi = pick<CpiProvider>('cpi', 'CPI_PROVIDER', 'cbs', { cbs: { info: cbs.info, make: () => cbs } });
  const tdInfo = makeTwelveData({ apiKey: 'x' }).info;
  out.history = pick<HistoryProvider>('history', 'HISTORY_PROVIDER', td ? 'twelvedata' : null, {
    twelvedata: { info: tdInfo, make: () => (td ? makeTwelveData({ apiKey: td }) : null) },
    tase: { info: makeTase(undefined).info, make: () => makeTase(env.TASE_API_KEY) },
  });
  const fhInfo = makeFinnhub({ apiKey: 'x' }).info;
  const fhOnly = <T>(): Record<string, Maker<T>> => ({ finnhub: { info: fhInfo, make: () => finnhub as unknown as T | null } });
  out.quote = pick<QuoteProvider>('quote', 'QUOTE_PROVIDER', fh ? 'finnhub' : null, fhOnly());
  out.fundamentals = pick<FundamentalsProvider>('fundamentals', 'FUNDAMENTALS_PROVIDER', fh ? 'finnhub' : null, fhOnly());
  out.calendar = pick<CalendarProvider>('calendar', 'CALENDAR_PROVIDER', fh ? 'finnhub' : null, fhOnly());
  return out;
}
