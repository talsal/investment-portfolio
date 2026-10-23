import { getText } from './http';
import { ProviderError, type Daily, type FxProvider } from './types';

const BASE = 'https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS';

/**
 * Parses the Bank of Israel SDMX CSV for one series. Columns are looked up by header name, not position.
 * Rows without a numeric observation (holidays) are skipped.
 */
export function parseBoiCsv(csv: string): Daily {
  const lines = csv.trim().split(/\r?\n/);
  const head = (lines.shift() ?? '').split(',');
  const t = head.indexOf('TIME_PERIOD'), v = head.indexOf('OBS_VALUE');
  if (t < 0 || v < 0) throw new ProviderError('unexpected BoI CSV header', 'parse');
  const byDate = new Map<string, number>();
  for (const line of lines) {
    const c = line.split(',');
    const d = c[t], x = Number(c[v]);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(x) && x > 0) byDate.set(d, x);
  }
  const dates = [...byDate.keys()].sort();
  return { dates, close: dates.map((d) => byDate.get(d) as number) };
}

/**
 * Bank of Israel representative USD/ILS rate (official SDMX series RER_USD_ILS, no key needed).
 * The rate is published daily on Israeli business days and revised about 15:45 Israel time.
 * Terms: the bank's site terms reserve copyright and ask for written permission to republish, and offer no open
 * licence for the data API, so this provider is "unclear" and is only published when acknowledged.
 */
export const boi: FxProvider = {
  info: {
    id: 'boi',
    name: 'Bank of Israel representative rates',
    redistribution: 'unclear',
    termsUrl: 'https://boi.org.il/en/terms-of-use',
    note: 'Official statistical series; site terms reserve copyright and require written permission to republish. Acknowledge only after checking.',
  },
  async fetchUsdIls(from) {
    const url = `${BASE}?format=csv${from ? `&startperiod=${from}` : ''}`;
    const d = parseBoiCsv(await getText(url));
    if (!d.dates.length) throw new ProviderError('BoI returned no observations', 'parse');
    return d;
  },
};
