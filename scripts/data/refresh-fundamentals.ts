import { pathToFileURL } from 'node:url';
import { DATA_SCHEMA, type FundamentalsFile } from '../../src/data/schema';
import { parseFundamentalsFile, parseUniverseFile } from '../../src/data/validate';
import { buildProviders, type Providers } from '../../providers/registry';
import { paced } from '../../providers/http';
import { errMessage } from '../lib/market';
import { readJson, writeJson } from '../lib/files';
import { reindex } from './reindex';

export interface FundamentalsOptions { dataDir: string; providers: Providers; now: Date; pacingMs?: number; log?: (l: string) => void }
export interface FundamentalsSummary { updated: string[]; failed: string[]; skipped: Providers['skipped'] }

/**
 * Weekly refresh of data/fundamentals/<SYMBOL>.json for the tracked universe. A symbol that fails keeps its
 * previous file untouched (and its old `asof`, which is what the freshness panel reports).
 */
export async function refreshFundamentals(o: FundamentalsOptions): Promise<FundamentalsSummary> {
  const log = o.log ?? (() => {});
  const universe = parseUniverseFile(readJson(o.dataDir, 'universe.json'));
  if (!universe) throw new Error('data/universe.json is missing or invalid');
  const out: FundamentalsSummary = { updated: [], failed: [], skipped: o.providers.skipped };
  const p = o.providers.fundamentals;
  if (!p) { log('fundamentals skipped: no provider available'); return out; }
  const writes: Array<{ sym: string; file: FundamentalsFile }> = [];
  await paced(universe.tickers.map((t) => t.symbol), o.pacingMs ?? 0, async (sym) => {
    try {
      const r = await p.fetchFundamentals(sym);
      const file: FundamentalsFile = { schema: DATA_SCHEMA, symbol: sym, source: p.info.id, asof: r.asof, fetchedAt: o.now.toISOString(), inputs: r.inputs, ...(r.base ? { base: r.base } : {}) };
      if (!parseFundamentalsFile(file)) throw new Error('provider data failed validation');
      writes.push({ sym, file });
    } catch (e) { out.failed.push(sym); log(`${sym}: ${errMessage(e)}`); }
  });
  for (const w of writes) { writeJson(o.dataDir, `fundamentals/${w.sym}.json`, w.file); out.updated.push(w.sym); }
  reindex(o.dataDir);
  return out;
}

async function main() {
  const s = await refreshFundamentals({ dataDir: process.env.DATA_DIR ?? 'data', providers: buildProviders(process.env), now: new Date(), pacingMs: Number(process.env.PACING_MS ?? 1100), log: (l) => console.log(l) });
  const line = `fundamentals: ${s.updated.length} updated, ${s.failed.length} failed${s.skipped.length ? `, skipped: ${s.skipped.map((x) => `${x.capability}:${x.reason}`).join(', ')}` : ''}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Fundamentals refresh\n${line}\n`);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(errMessage(e)); process.exit(1); });
