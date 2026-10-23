import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DATA_SCHEMA, type FundamentalsFile, type ManualFile } from '../../src/data/schema';
import { parseAnalysisFile, parseFundamentalsFile, parseManualFile, parseMarketFile, parseUniverseFile } from '../../src/data/validate';
import { reindex } from '../data/reindex';
import { readJson, writeJson } from '../lib/files';
import { anthropicCompleter, DEFAULT_MODEL, describeError, type Completer } from './anthropic';
import { buildUserPrompt, SYSTEM_PROMPT, type AnalysisInput } from './prompt';
import { selectSymbols, type Reason, type SkipReason } from './select';
import { toDraft } from './validate-draft';

/** Collects everything the prompt needs for one symbol from the data files; null when there are no fundamentals. */
export function loadInput(dataDir: string, symbol: string, today: string): AnalysisInput | null {
  const manual = parseManualFile(readJson(dataDir, `manual/${symbol}.json`));
  const f = fundamentalsFor(symbol, parseFundamentalsFile(readJson(dataDir, `fundamentals/${symbol}.json`)), manual);
  if (!f) return null;
  const market = parseMarketFile(readJson(dataDir, 'market.json'));
  const universe = parseUniverseFile(readJson(dataDir, 'universe.json'));
  const t = market?.tickers[symbol];
  return {
    symbol, name: t?.name ?? universe?.tickers.find((x) => x.symbol === symbol)?.name, price: t?.price, priceAsof: t?.asof, fundamentals: f,
    manual: manual ?? undefined, previous: parseAnalysisFile(readJson(dataDir, `analysis/${symbol}.json`)) ?? undefined, today,
  };
}

/** Fundamentals to use for a symbol: the provider file, else one synthesised from manual inputs, else none. */
export function fundamentalsFor(symbol: string, file: FundamentalsFile | null, manual: ManualFile | null): FundamentalsFile | null {
  if (file) return manual?.inputs ? { ...file, inputs: { ...file.inputs, ...manual.inputs } } : file;
  if (!manual?.inputs || !Object.keys(manual.inputs).length) return null;
  return { schema: DATA_SCHEMA, symbol, source: 'manual', asof: manual.asof, fetchedAt: manual.asof, inputs: manual.inputs };
}

export interface GenerateOptions {
  dataDir: string;
  completer: Completer | null;
  model: string;
  now: Date;
  max: number;
  maxAgeDays: number;
  only?: string[];
  /** Print the prompts and stop: no API call, nothing written. */
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface DraftOutcome {
  symbol: string;
  reason: Reason;
  status: 'drafted' | 'rejected' | 'error';
  detail?: string;
  confidence?: string;
  flags?: string[];
  uncertainties?: string[];
  tokens?: { input: number; output: number };
}
export interface GenerateSummary { outcomes: DraftOutcome[]; skipped: Array<{ symbol: string; reason: SkipReason }>; model: string }

/**
 * Drafts qualitative analysis with Claude and writes `data/analysis/<SYMBOL>.draft.json`. It never writes the
 * published `<SYMBOL>.json` and never sets `approved`: a human promotes a draft with `npm run analysis:approve`.
 */
export async function generateDrafts(o: GenerateOptions): Promise<GenerateSummary> {
  const log = o.log ?? (() => {});
  const universe = parseUniverseFile(readJson(o.dataDir, 'universe.json'));
  if (!universe) throw new Error('data/universe.json is missing or invalid');
  const market = parseMarketFile(readJson(o.dataDir, 'market.json'));
  const today = o.now.toISOString().slice(0, 10);
  const manualOf = (s: string) => parseManualFile(readJson(o.dataDir, `manual/${s}.json`));
  /** Provider fundamentals, or (zero-cost mode) a file built from the numbers the owner typed in data/manual. */
  const fundamentals = (s: string) => fundamentalsFor(s, parseFundamentalsFile(readJson(o.dataDir, `fundamentals/${s}.json`)), manualOf(s));
  const published = (s: string) => parseAnalysisFile(readJson(o.dataDir, `analysis/${s}.json`));
  const draft = (s: string) => parseAnalysisFile(readJson(o.dataDir, `analysis/${s}.draft.json`), 'draft');

  const { selected, skipped } = selectSymbols({
    universe, fundamentals, published, draft, hasPrice: () => true, today, maxAgeDays: o.maxAgeDays, max: o.max, only: o.only,
  });
  const outcomes: DraftOutcome[] = [];
  for (const { symbol, reason } of selected) {
    const f = fundamentals(symbol) as NonNullable<ReturnType<typeof fundamentals>>;
    const t = market?.tickers[symbol];
    const input: AnalysisInput = {
      symbol, name: t?.name ?? universe.tickers.find((x) => x.symbol === symbol)?.name, price: t?.price, priceAsof: t?.asof, fundamentals: f,
      manual: manualOf(symbol) ?? undefined, previous: published(symbol) ?? undefined, today,
    };
    const user = buildUserPrompt(input);
    if (o.dryRun || !o.completer) { log(`--- ${symbol} (${reason}) ---\n${user}\n`); continue; }
    try {
      const c = await o.completer(SYSTEM_PROMPT, user);
      let json: unknown;
      try { json = JSON.parse(c.text); } catch { outcomes.push({ symbol, reason, status: 'rejected', detail: 'response was not valid JSON' }); continue; }
      const r = toDraft(json, input, user, { model: c.model, now: o.now });
      if (!r.ok) { outcomes.push({ symbol, reason, status: 'rejected', detail: r.reason, tokens: c.usage }); log(`${symbol}: rejected (${r.reason})`); continue; }
      writeJson(o.dataDir, `analysis/${symbol}.draft.json`, r.draft);
      outcomes.push({ symbol, reason, status: 'drafted', confidence: r.draft.confidence, flags: r.draft.flags, uncertainties: r.draft.uncertainties, tokens: c.usage });
      log(`${symbol}: drafted`);
    } catch (e) {
      outcomes.push({ symbol, reason, status: 'error', detail: describeError(e) });
      log(`${symbol}: ${describeError(e)}`);
    }
  }
  if (!o.dryRun && outcomes.some((x) => x.status === 'drafted')) reindex(o.dataDir);
  return { outcomes, skipped, model: o.model };
}

/** Markdown for the pull request: what was drafted, what needs attention, and exactly how to approve. English. */
export function prBody(s: GenerateSummary, date: string): string {
  const drafted = s.outcomes.filter((x) => x.status === 'drafted');
  const row = (x: DraftOutcome) => `| ${x.symbol} | ${x.status}${x.detail ? ` (${x.detail})` : ''} | ${x.confidence ?? '-'} | ${x.flags?.length ? x.flags.join('; ') : '-'} |`;
  return [
    `## Draft qualitative analysis, ${date}`,
    '',
    `Generated by \`${s.model}\`. **Nothing in this PR is published or shown to visitors.** Drafts live in \`data/analysis/<SYMBOL>.draft.json\`, which the site never reads. They become visible only after a human approves them.`,
    '',
    '| Symbol | Result | Model confidence | Automatic flags |',
    '|---|---|---|---|',
    ...s.outcomes.map(row),
    '',
    drafted.some((x) => x.uncertainties?.length) ? ['### What the model could not verify', ...drafted.filter((x) => x.uncertainties?.length).map((x) => `- **${x.symbol}**: ${x.uncertainties!.join('; ')}`), ''].join('\n') : '',
    '### How to review',
    '1. Read each draft file. Check the facts yourself (the model has no internet access and a knowledge cutoff), check there is no advice-like wording, and check `moat` / `growth` match the definitions in `docs/analysis-pipeline.md`.',
    '2. Optional preview: run the site locally (`npm run dev`), add the stock to your holdings, open `/?drafts=1`. Drafts appear labelled "טיוטה".',
    '3. Edit the JSON where the draft is wrong.',
    '4. Approve with `npm run analysis:approve -- SYMBOL --by "Your Name"` on this branch. It turns the draft into `data/analysis/SYMBOL.json` with `reviewedBy` and `reviewedAt` (required for anything to be shown). Delete a draft file to reject it.',
    '5. Merge. Only approved files change the site. Do not enable auto-merge for this PR.',
    '',
    s.skipped.length ? `<sub>Skipped: ${s.skipped.map((k) => `${k.symbol} (${k.reason})`).join(', ')}</sub>` : '',
    '',
    '<sub>Informational tool, not investment advice. Drafts are machine-written and may contain errors.</sub>',
  ].filter((l) => l !== undefined).join('\n');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const model = process.env.ANALYSIS_MODEL || DEFAULT_MODEL;
  const now = new Date();
  const s = await generateDrafts({
    dataDir: process.env.DATA_DIR ?? 'data', model, now, dryRun,
    completer: dryRun ? null : anthropicCompleter(model),
    max: Number(process.env.ANALYSIS_MAX ?? 5), maxAgeDays: Number(process.env.ANALYSIS_MAX_AGE_DAYS ?? 100),
    only: (process.env.ANALYSIS_SYMBOLS ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
    log: (l) => console.log(l),
  });
  const body = prBody(s, now.toISOString().slice(0, 10));
  if (!dryRun) writeFileSync(process.env.ANALYSIS_PR_BODY ?? 'analysis-pr-body.md', body + '\n');
  const counts = (st: string) => s.outcomes.filter((x) => x.status === st).length;
  const tokens = s.outcomes.reduce((a, x) => ({ input: a.input + (x.tokens?.input ?? 0), output: a.output + (x.tokens?.output ?? 0) }), { input: 0, output: 0 });
  console.log(`analysis: ${counts('drafted')} drafted, ${counts('rejected')} rejected, ${counts('error')} errors, ${s.skipped.length} skipped; tokens in/out ${tokens.input}/${tokens.output}`);
  if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Analysis drafts\n${body}\n`);
  if (s.outcomes.length && !counts('drafted')) process.exit(1); // nothing usable: do not open an empty PR
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(describeError(e)); process.exit(1); });
