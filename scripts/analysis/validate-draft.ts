import { DATA_SCHEMA, type AnalysisFile } from '../../src/data/schema';
import { parseAnalysisFile } from '../../src/data/validate';
import type { AnalysisInput } from './prompt';

const HEBREW = /[֐-׿]/;
const MAX_TEXT = 280;

/**
 * Wording that reads as advice. Drafts containing it are rejected outright: the site gives no recommendations.
 * (Hebrew: recommend/should buy/sell/add/trim/undervalued/cheap/attractive/price target.)
 */
const ADVICE: RegExp[] = [
  /\b(buy|sell|overweight|underweight|price target|undervalued|overvalued)\b/i,
  /(מומלץ|כדאי|מוטב|עדיף)\s+(ל?קנות|ל?מכור|להוסיף|לצמצם|לעבות|להחזיק)/,
  /(קנייה|מכירה)\s+מומלצת|המלצת\s+(קנייה|מכירה)|מחיר\s+יעד|זולה\s+מדי|יקרה\s+מדי|אטרקטיבית|בחסר\s+בערכה|מוערכת\s+בחסר|מוערכת\s+ביתר/,
];

export type DraftResult = { ok: true; draft: AnalysisFile } | { ok: false; reason: string };

const TEXT_FIELDS = ['moatTxt', 'growthTxt', 'track', 'next'] as const;
const LIST_FIELDS = ['peNotes', 'fcfNotes', 'uncertainties'] as const;

/** Numbers in the model's text that are not in what we supplied (normalised: no thousands separators). */
export function ungroundedNumbers(texts: string[], inputText: string): string[] {
  const known = new Set((inputText.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(parseFloat(n))));
  const found = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) found.add(String(parseFloat(m[0].replace(',', '.'))));
  // Years and quarter numbers are not financial figures.
  return [...found].filter((n) => !known.has(n) && !/^(19|20)\d\d$/.test(n) && !['1', '2', '3', '4'].includes(n)).sort();
}

/**
 * Turns the model's JSON into a draft file, or says why it cannot. Never produces `approved`: review fields
 * are only ever added by a human (see scripts/analysis/approve.ts).
 */
export function toDraft(raw: unknown, input: AnalysisInput, inputText: string, meta: { model: string; now: Date }): DraftResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'response is not a JSON object' };
  const r = raw as Record<string, unknown>;
  const candidate: Record<string, unknown> = {
    schema: DATA_SCHEMA, symbol: input.symbol, status: 'draft', asof: input.today,
    generatedAt: meta.now.toISOString(), model: meta.model,
    moat: r.moat, moatTxt: r.moatTxt, growth: r.growth, growthTxt: r.growthTxt, track: r.track, cyclical: r.cyclical, confidence: r.confidence,
  };
  if (typeof r.next === 'string' && r.next.trim()) candidate.next = r.next;
  for (const k of LIST_FIELDS) candidate[k] = Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x) => typeof x === 'string' && x.trim()).slice(0, 8) : [];
  if ((candidate.uncertainties as unknown[]).length === 0) delete candidate.uncertainties;
  for (const k of ['peNotes', 'fcfNotes'] as const) if ((candidate[k] as unknown[]).length === 0) delete candidate[k];

  for (const k of ['moatTxt', 'growthTxt', 'track'] as const) {
    const v = candidate[k];
    if (typeof v !== 'string' || !v.trim()) return { ok: false, reason: `${k} is empty` };
    if (!HEBREW.test(v)) return { ok: false, reason: `${k} is not Hebrew` };
  }
  const texts = [...TEXT_FIELDS, ...LIST_FIELDS].flatMap((k) => { const v = candidate[k]; return typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : []; });
  for (const t of texts) {
    if (t.length > MAX_TEXT) return { ok: false, reason: `a text field is longer than ${MAX_TEXT} characters` };
    if (/[<>]/.test(t) || /https?:\/\//i.test(t)) return { ok: false, reason: 'text contains markup or a link' };
    if (ADVICE.some((re) => re.test(t))) return { ok: false, reason: 'text reads as investment advice' };
  }
  const flags: string[] = [];
  const odd = ungroundedNumbers(texts, inputText);
  if (odd.length) flags.push(`numbers in the text that are not in the supplied inputs: ${odd.join(', ')}`);
  if (candidate.confidence === 'low') flags.push('model reported low confidence');
  if (flags.length) candidate.flags = flags;

  const parsed = parseAnalysisFile(candidate, 'draft');
  return parsed ? { ok: true, draft: parsed } : { ok: false, reason: 'draft failed schema validation' };
}
