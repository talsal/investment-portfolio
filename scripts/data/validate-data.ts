import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAnalysisFile, parseCpiFile, parseFundamentalsFile, parseHistoryFile, parseManualFile, parseMarketFile, parseUniverseFile } from '../../src/data/validate';
import { fileExists, readJson } from '../lib/files';

const MAX_BYTES = 2 * 1024 * 1024;

/** Checks every file under data/ with the same strict readers the browser uses. Returns a list of problems. */
export function validateData(dir: string): string[] {
  const problems: string[] = [];
  const list = (sub: string): string[] => { try { return readdirSync(join(dir, sub)).filter((f) => f.endsWith('.json')); } catch { return []; } };
  const check = (rel: string, parse: (o: unknown) => { symbol?: string } | object | null, symbolFromName = false) => {
    const raw = readJson(dir, rel);
    if (raw === null) { problems.push(`${rel}: unreadable or not JSON`); return; }
    if (statSync(join(dir, rel)).size > MAX_BYTES) problems.push(`${rel}: larger than ${MAX_BYTES} bytes`);
    const v = parse(raw);
    if (!v) { problems.push(`${rel}: failed schema validation`); return; }
    if (symbolFromName && (v as { symbol?: string }).symbol !== rel.replace(/^.*\//, '').replace(/(\.draft)?\.json$/, '')) problems.push(`${rel}: symbol does not match the file name`);
  };

  if (!fileExists(dir, 'universe.json')) problems.push('universe.json: missing'); else check('universe.json', parseUniverseFile);
  if (fileExists(dir, 'market.json')) check('market.json', parseMarketFile);
  if (fileExists(dir, 'cpi.json')) check('cpi.json', parseCpiFile);
  for (const f of list('history')) check(`history/${f}`, parseHistoryFile, true);
  for (const f of list('fundamentals')) check(`fundamentals/${f}`, parseFundamentalsFile, true);
  for (const f of list('analysis')) check(`analysis/${f}`, f.endsWith('.draft.json') ? (o) => parseAnalysisFile(o, 'draft') : (o) => parseAnalysisFile(o), true);
  for (const f of list('manual')) check(`manual/${f}`, parseManualFile, true);

  const m = parseMarketFile(readJson(dir, 'market.json'));
  if (m) {
    for (const [sym, t] of Object.entries(m.tickers)) {
      for (const kind of t.has ?? []) {
        const rel = kind === 'draft' ? `analysis/${sym}.draft.json` : `${kind}/${sym}.json`;
        if (!fileExists(dir, rel)) problems.push(`market.json: ${sym} claims ${rel} which does not exist`);
      }
    }
    if (m.benchmark && !fileExists(dir, `history/${m.benchmark.symbol}.json`)) problems.push(`market.json: benchmark history history/${m.benchmark.symbol}.json is missing`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const problems = validateData(process.env.DATA_DIR ?? 'data');
  if (problems.length) { console.error(`Data validation failed:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log('data/ is valid');
}
