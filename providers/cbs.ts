import { getJson } from './http';
import { ProviderError, type CpiProvider } from './types';

const URL = 'https://api.cbs.gov.il/index/data/price?id=120010&format=json&download=false&last=3&coef=false';

interface CbsMonth { year?: unknown; month?: unknown; monthDesc?: unknown; percentYear?: unknown }

/** Picks the most recent month in a CBS price-index response and returns the 12-month change. */
export function parseCbsCpi(o: unknown): { yoyPct: number; label: string; asof: string } {
  const months = ((o as { month?: Array<{ date?: CbsMonth[] }> })?.month?.[0]?.date ?? []) as CbsMonth[];
  const valid = months.filter((m) => typeof m.year === 'number' && typeof m.month === 'number' && typeof m.percentYear === 'number' && typeof m.monthDesc === 'string');
  if (!valid.length) throw new ProviderError('unexpected CBS CPI response', 'parse');
  valid.sort((a, b) => (a.year as number) * 12 + (a.month as number) - ((b.year as number) * 12 + (b.month as number)));
  const m = valid[valid.length - 1] as Required<CbsMonth> & { year: number; month: number; monthDesc: string; percentYear: number };
  if (Math.abs(m.percentYear) >= 100) throw new ProviderError('implausible CPI value', 'parse');
  return { yoyPct: m.percentYear, label: `${m.monthDesc} ${m.year}`, asof: `${m.year}-${String(m.month).padStart(2, '0')}` };
}

/**
 * Israel CBS consumer price index (general), 12-month change. Licence: the CBS open licence states that copyright
 * does not extend to facts or data themselves, so this provider is "open" (credit the CBS as the source).
 */
export const cbs: CpiProvider = {
  info: {
    id: 'cbs',
    name: 'Israel Central Bureau of Statistics',
    redistribution: 'open',
    termsUrl: 'https://www.cbs.gov.il/en/Pages/Enduser-license.aspx',
    note: 'Open licence for facts and data; credit the CBS.',
  },
  async fetchCpi() { return parseCbsCpi(await getJson(URL)); },
};
