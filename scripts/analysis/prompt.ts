import type { AnalysisFile, FundamentalsFile, ManualFile } from '../../src/data/schema';

/** Everything the model is allowed to know about a stock: only what is in our own data files. */
export interface AnalysisInput {
  symbol: string;
  name?: string;
  price?: number;
  priceAsof?: string;
  fundamentals: FundamentalsFile;
  manual?: ManualFile;
  /** The currently published (approved) analysis, if any, so a refresh stays consistent with it. */
  previous?: AnalysisFile;
  today: string;
}

/**
 * Stable instructions (identical for every symbol). The states below are the exact vocabulary the site's
 * criteria table uses; the definitions must stay in sync with src/i18n/he.ts and config/rules.json.
 */
export const SYSTEM_PROMPT = `You draft the qualitative columns of a rules-based stock screen for a personal, informational dashboard. A human reviews every draft before it is published. Your output is one JSON object.

Hard rules
- No recommendations. Never say or imply buy, sell, hold, add, trim, "attractive", "cheap", "undervalued" or a price target. You describe the business and its trajectory; the site's own rules decide everything else.
- Use only facts you are confident about. The only numbers you may quote are those in the INPUT block, or well-known facts you are sure of. If a figure is not in the input, do not give it. Never invent figures, dates, products, customers or events.
- Your knowledge has a cutoff and today's date is given in the input. Do not assert recent developments you cannot be sure of. When a judgement depends on something that may have changed, say so in "uncertainties" and lower "confidence".
- Be concise and neutral. Each text field is one or two short Hebrew sentences or fragments, in the style: "צר, מתפתח ↑ · ROIC עלה, מעל עלות ההון" (moat) or "הכנסות +11% בשנה; כעת האטה, חלק מרכישות" (growth). Hebrew only in text fields; ticker symbols and units stay in Latin characters.
- If you do not know the company well enough, use moat "none"/growth "na", confidence "low", and say why in "uncertainties". Do not guess.

Vocabulary (use the enum values exactly)
moat - durable competitive advantage, judged for a holder today:
  "ok"        intact or strengthening: no problem
  "weak"      narrow/weak but stable
  "contested" real advantage under credible threat
  "bad"       eroding (shrinking margins, share loss, commoditisation)
  "none"      no meaningful moat, or not applicable
growth - direction of revenue/cash-flow growth:
  "up"   accelerating
  "slow" positive but decelerating
  "flat" stable and low
  "neg"  shrinking
  "na"   not applicable or cannot tell
cyclical: true only if earnings swing with an industry cycle rather than business quality.

Fields
moat, moatTxt, growth, growthTxt, track (what an investor should watch next, one short phrase), cyclical,
next (optional: one short note on the next report, only if it is in the input), confidence ("low"|"medium"|"high"),
uncertainties (array of short strings, may be empty), peNotes and fcfNotes (arrays of short notes about the P/E or
free-cash-flow numbers, may be empty; only about numbers present in the input).`;

const fmt = (v: unknown): string => (v === undefined || v === null ? 'n/a' : String(v));

/** The per-stock part of the prompt. Pure; no clock, no I/O. */
export function buildUserPrompt(i: AnalysisInput): string {
  const f = i.fundamentals.inputs;
  const lines = [
    `Today: ${i.today}`,
    `Symbol: ${i.symbol}${i.name ? ` (${i.name})` : ''}`,
    i.price === undefined ? 'Last price: n/a' : `Last price: ${i.price} USD (as of ${i.priceAsof})`,
    `Fundamentals as of ${i.fundamentals.asof} (source: ${i.fundamentals.source}); n/a = not available:`,
    `  trailing EPS: ${fmt(f.epsT)}`,
    `  forward EPS: ${fmt(f.epsF ?? i.manual?.inputs?.epsF)}`,
    `  free cash flow per share: ${fmt(f.fcfPs)}`,
    `  free cash flow total: ${fmt(f.fcfTotal)}`,
    `  FCF trend (avg yearly change, %): ${fmt(f.fcfTrend)}`,
    `  ROE (%): ${fmt(f.roe)}`,
    `  book value per share: ${fmt(f.bv)}`,
  ];
  if (i.fundamentals.base) {
    lines.push(`  4-year base table (revenue growth, EPS growth, FCF growth, ROIC range, gross margin): ${i.fundamentals.base.join(' | ')}`);
  }
  if (i.previous) {
    lines.push('Currently published analysis (human-approved; keep consistent unless the data clearly changed):');
    lines.push(`  moat=${fmt(i.previous.moat)} "${fmt(i.previous.moatTxt)}"; growth=${fmt(i.previous.growth)} "${fmt(i.previous.growthTxt)}"; reviewed ${fmt(i.previous.reviewedAt)}`);
  }
  return `INPUT\n${lines.join('\n')}\n\nReturn the JSON object only.`;
}

/** JSON Schema for structured outputs. Length limits are enforced by our own validator, not here. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    moat: { type: 'string', enum: ['ok', 'weak', 'bad', 'none', 'contested'] },
    moatTxt: { type: 'string' },
    growth: { type: 'string', enum: ['up', 'slow', 'flat', 'neg', 'na'] },
    growthTxt: { type: 'string' },
    track: { type: 'string' },
    cyclical: { type: 'boolean' },
    next: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    uncertainties: { type: 'array', items: { type: 'string' } },
    peNotes: { type: 'array', items: { type: 'string' } },
    fcfNotes: { type: 'array', items: { type: 'string' } },
  },
  required: ['moat', 'moatTxt', 'growth', 'growthTxt', 'track', 'cyclical', 'confidence', 'uncertainties', 'peNotes', 'fcfNotes'],
  additionalProperties: false,
} as const;
