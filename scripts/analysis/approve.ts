import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAnalysisFile } from '../../src/data/validate';
import { reindex } from '../data/reindex';
import { readJson, writeJson } from '../lib/files';

/**
 * Human approval: promotes `analysis/<SYMBOL>.draft.json` to the published `analysis/<SYMBOL>.json`, recording who
 * reviewed it and when. Refuses an empty reviewer name. This is the only code path that writes `approved`.
 */
export function approveDraft(o: { dataDir: string; symbol: string; by: string; now: Date }): { path: string } {
  const by = o.by.trim();
  if (!by) throw new Error('--by "Your Name" is required: approval must name the reviewer');
  const draft = parseAnalysisFile(readJson(o.dataDir, `analysis/${o.symbol}.draft.json`), 'draft');
  if (!draft) throw new Error(`no valid draft for ${o.symbol} (data/analysis/${o.symbol}.draft.json)`);
  const published = { ...draft, status: 'approved' as const, reviewedBy: by, reviewedAt: o.now.toISOString().slice(0, 10) };
  if (!parseAnalysisFile(published)) throw new Error('approved file would be invalid');
  writeJson(o.dataDir, `analysis/${o.symbol}.json`, published);
  rmSync(join(o.dataDir, `analysis/${o.symbol}.draft.json`));
  reindex(o.dataDir);
  return { path: `data/analysis/${o.symbol}.json` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const symbol = (process.argv[2] ?? '').toUpperCase();
  const i = process.argv.indexOf('--by');
  const by = i > 0 ? (process.argv[i + 1] ?? '') : '';
  try {
    if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) throw new Error('usage: npm run analysis:approve -- SYMBOL --by "Your Name"');
    console.log(`approved: ${approveDraft({ dataDir: process.env.DATA_DIR ?? 'data', symbol, by, now: new Date() }).path}`);
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
