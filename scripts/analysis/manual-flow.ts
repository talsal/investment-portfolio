import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseAnalysisFile } from '../../src/data/validate';
import { reindex } from '../data/reindex';
import { writeJson } from '../lib/files';
import { loadInput } from './generate';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';
import { toDraft } from './validate-draft';

/**
 * Zero-cost path: no API key and no spend. `prompt` prints the exact text the automated job would send; paste it
 * into any chat assistant you already use, then `import` the JSON it answers with. The reply goes through the same
 * validation as an API reply (schema, Hebrew, no advice wording, number check) and becomes a draft that still needs
 * human approval.
 */
export function manualPrompt(dataDir: string, symbol: string, today: string): string {
  const input = loadInput(dataDir, symbol, today);
  if (!input) throw new Error(`no fundamentals for ${symbol}: add numbers to data/manual/${symbol}.json (inputs) or run the fundamentals job`);
  return `${SYSTEM_PROMPT}\n\n${buildUserPrompt(input)}\n\n(Reply with only the JSON object, no code fence and no commentary.)`;
}

/** Accepts the raw chat reply: tolerates a ```json fence or text around the object. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1];
  const braces = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  for (const c of [fenced, braces]) { if (!c) continue; try { return JSON.parse(c); } catch { /* try next */ } }
  throw new Error('could not find a JSON object in the reply');
}

export function importReply(o: { dataDir: string; symbol: string; text: string; now: Date; model?: string }): { path: string; flags: string[] } {
  const today = o.now.toISOString().slice(0, 10);
  const input = loadInput(o.dataDir, o.symbol, today);
  if (!input) throw new Error(`no fundamentals for ${o.symbol}`);
  const r = toDraft(extractJson(o.text), input, buildUserPrompt(input), { model: o.model ?? 'manual-chat', now: o.now });
  if (!r.ok) throw new Error(`reply rejected: ${r.reason}`);
  if (!parseAnalysisFile(r.draft, 'draft')) throw new Error('draft failed validation');
  writeJson(o.dataDir, `analysis/${o.symbol}.draft.json`, r.draft);
  reindex(o.dataDir);
  return { path: `data/analysis/${o.symbol}.draft.json`, flags: r.draft.flags ?? [] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, rawSymbol, file] = process.argv.slice(2);
  const symbol = (rawSymbol ?? '').toUpperCase();
  const dataDir = process.env.DATA_DIR ?? 'data';
  try {
    if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) throw new Error('usage: analysis:prompt -- SYMBOL | analysis:import -- SYMBOL reply.json (or - for stdin)');
    if (cmd === 'prompt') console.log(manualPrompt(dataDir, symbol, new Date().toISOString().slice(0, 10)));
    else if (cmd === 'import') {
      const text = readFileSync(!file || file === '-' ? 0 : file, 'utf8');
      const r = importReply({ dataDir, symbol, text, now: new Date(), model: process.env.ANALYSIS_MODEL_LABEL });
      console.log(`draft written: ${r.path}${r.flags.length ? `\nflags: ${r.flags.join('; ')}` : ''}\nnext: review it, then npm run analysis:approve -- ${symbol} --by "Your Name"`);
    } else throw new Error('unknown command');
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
