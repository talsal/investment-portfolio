import { getJson, type GetOptions } from './http';
import { ProviderError, type Daily, type HistoryProvider, type ProviderInfo } from './types';

export const twelveDataInfo: ProviderInfo = {
  id: 'twelvedata',
  name: 'Twelve Data',
  redistribution: 'restricted',
  termsUrl: 'https://twelvedata.com/terms',
  note: 'Free tier: no commercial use and no external display of data (terms 2.2e, 2.3l). Publishing needs a plan or add-on that permits external display.',
};

/** Parses a Twelve Data time_series response (single symbol). Throws ProviderError on API errors or bad shape. */
export function parseTwelveDataSeries(o: unknown): Daily {
  const r = o as { status?: unknown; code?: unknown; message?: unknown; values?: unknown };
  if (!r || typeof r !== 'object') throw new ProviderError('unexpected Twelve Data response', 'parse');
  if (r.status === 'error') throw new ProviderError(`Twelve Data error ${String(r.code ?? '')}`.trim(), r.code === 429 ? 'quota' : 'http');
  if (!Array.isArray(r.values)) throw new ProviderError('Twelve Data response has no values', 'parse');
  const byDate = new Map<string, number>();
  for (const v of r.values as Array<{ datetime?: unknown; close?: unknown }>) {
    const d = typeof v.datetime === 'string' ? v.datetime.slice(0, 10) : '', c = Number(v.close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(c) && c > 0) byDate.set(d, c);
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) throw new ProviderError('Twelve Data returned no usable rows', 'parse');
  return { dates, close: dates.map((d) => byDate.get(d) as number) };
}

export interface TwelveDataOptions { apiKey: string; get?: Partial<GetOptions> }

/** Daily closes (unadjusted) for US symbols. Key via TWELVEDATA_API_KEY. Not verified against the live API. */
export function makeTwelveData(o: TwelveDataOptions): HistoryProvider {
  return {
    info: twelveDataInfo,
    async fetchDaily(symbol, from) {
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&order=asc&outputsize=5000&start_date=${from}&apikey=${encodeURIComponent(o.apiKey)}`;
      return parseTwelveDataSeries(await getJson(url, { secretParams: ['apikey'], ...o.get }));
    },
  };
}
