import { DATA_SCHEMA, type MarketFile } from '../../src/data/schema';
import { parseMarketFile } from '../../src/data/validate';
import { fileExists, readJson, writeJson } from '../lib/files';

/**
 * Records in market.json which per-ticker files exist (`has`), so the browser only requests files that are there.
 * Run after any job that adds or removes files under fundamentals/, analysis/, manual/ or history/.
 * Returns true when market.json changed. The generation timestamp is left alone.
 */
export function reindex(dataDir: string): boolean {
  const m = parseMarketFile(readJson(dataDir, 'market.json'));
  if (!m) return false;
  let changed = false;
  const next: MarketFile = { ...m, schema: DATA_SCHEMA, tickers: {} };
  for (const [sym, t] of Object.entries(m.tickers)) {
    const has: NonNullable<typeof t.has> = [];
    if (fileExists(dataDir, `fundamentals/${sym}.json`)) has.push('fundamentals');
    if (fileExists(dataDir, `analysis/${sym}.json`)) has.push('analysis');
    if (fileExists(dataDir, `manual/${sym}.json`)) has.push('manual');
    if (fileExists(dataDir, `history/${sym}.json`)) has.push('history');
    if (JSON.stringify(has) !== JSON.stringify(t.has ?? [])) changed = true;
    next.tickers[sym] = { ...t, has };
  }
  if (changed) writeJson(dataDir, 'market.json', next);
  return changed;
}
