import { DATA_SCHEMA, type AnalysisFile, type CpiFile, type FundamentalsFile, type GroupId, type GroupStatus, type HistoryFile, type ManualFile, type MarketFile, type MarketTicker, type UniverseFile } from './schema';

/**
 * Strict readers for the data files. They return null (never throw) when a file is malformed, so a bad file
 * degrades to "unavailable" instead of breaking the app, and the refresh scripts can refuse to publish it.
 */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && !isNaN(Date.parse(v));
const SYMBOL = /^[A-Z0-9][A-Z0-9.\-_]{0,11}$/;
export const isSymbol = (v: unknown): v is string => typeof v === 'string' && SYMBOL.test(v);
const schemaOk = (o: Obj): boolean => num(o.schema) && o.schema >= 1 && o.schema <= DATA_SCHEMA;

const GROUPS: GroupId[] = ['fx', 'quotes', 'benchmark', 'calendar', 'cpi'];

function group(v: unknown): GroupStatus | null {
  if (!isObj(v) || !(v.state === 'ok' || v.state === 'stale' || v.state === 'unavailable')) return null;
  if (!(v.asof === null || isoDate(v.asof)) || !(v.fetchedAt === null || str(v.fetchedAt, 40)) || !str(v.source, 40)) return null;
  return { state: v.state, asof: v.asof as string | null, fetchedAt: v.fetchedAt as string | null, source: v.source, ...(str(v.note, 200) ? { note: v.note } : {}) };
}

function events(v: unknown): MarketTicker['events'] | null | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) return null;
  const out: NonNullable<MarketTicker['events']> = [];
  for (const e of v) {
    if (!isObj(e) || !(e.d === null || isoDate(e.d)) || !str(e.what, 300)) return null;
    out.push({ d: e.d as string | null, what: e.what, ...(e.st === 'confirmed' || e.st === 'est' || e.st === 'unk' ? { st: e.st } : {}) });
  }
  return out;
}

function div(v: unknown): { perShare: number; freq: number } | null | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v) || !num(v.perShare) || v.perShare < 0 || !num(v.freq) || v.freq < 1 || v.freq > 12) return null;
  return { perShare: v.perShare, freq: v.freq };
}

export function parseMarketFile(o: unknown): MarketFile | null {
  if (!isObj(o) || !schemaOk(o) || !str(o.generatedAt, 40) || !isObj(o.groups) || !isObj(o.tickers)) return null;
  const groups: MarketFile['groups'] = {};
  for (const id of GROUPS) {
    if (o.groups[id] === undefined) continue;
    const g = group(o.groups[id]);
    if (!g) return null;
    groups[id] = g;
  }
  const out: MarketFile = { schema: o.schema as number, generatedAt: o.generatedAt, groups, tickers: {} };
  if (o.fx !== undefined) {
    if (!isObj(o.fx) || !num(o.fx.usdIls) || o.fx.usdIls <= 0 || !isoDate(o.fx.asof)) return null;
    out.fx = { usdIls: o.fx.usdIls, asof: o.fx.asof };
  }
  if (o.benchmark !== undefined) {
    const b = o.benchmark;
    if (!isObj(b) || !isSymbol(b.symbol) || !num(b.price) || b.price <= 0 || !isoDate(b.asof) || !(b.baseDate === undefined || isoDate(b.baseDate))) return null;
    out.benchmark = { symbol: b.symbol, price: b.price, asof: b.asof, ...(b.baseDate ? { baseDate: b.baseDate as string } : {}) };
  }
  for (const [sym, t] of Object.entries(o.tickers)) {
    if (!isSymbol(sym) || !isObj(t) || !num(t.price) || t.price <= 0 || !isoDate(t.asof) || t.currency !== 'USD') return null;
    const ev = events(t.events), dv = div(t.div);
    if (ev === null || dv === null) return null;
    out.tickers[sym] = {
      price: t.price, asof: t.asof, currency: 'USD',
      ...(str(t.name, 80) ? { name: t.name } : {}), ...(dv ? { div: { ...dv, ...(isoDate((t.div as Obj).asof) ? { asof: (t.div as Obj).asof as string } : {}), ...(str((t.div as Obj).source, 30) ? { source: (t.div as Obj).source as string } : {}) } } : {}),
      ...(ev ? { events: ev } : {}), ...(t.stale === true ? { stale: true } : {}),
      ...(Array.isArray(t.has) ? { has: (t.has as unknown[]).filter((x): x is 'fundamentals' | 'analysis' | 'manual' | 'history' => x === 'fundamentals' || x === 'analysis' || x === 'manual' || x === 'history') } : {}),
    };
  }
  return out;
}

export function parseHistoryFile(o: unknown): HistoryFile | null {
  if (!isObj(o) || !schemaOk(o) || !(isSymbol(o.symbol) || o.symbol === '_USDILS') || !str(o.source, 40) || !isoDate(o.asof) || !Array.isArray(o.dates) || !Array.isArray(o.close)) return null;
  const n = o.dates.length;
  if (n !== o.close.length || n > 5000) return null;
  let prev = '';
  for (let i = 0; i < n; i++) {
    const d = o.dates[i], c = o.close[i];
    if (!isoDate(d) || d <= prev || !num(c) || c <= 0) return null;
    prev = d;
  }
  return { schema: o.schema as number, symbol: o.symbol, source: o.source, asof: o.asof, dates: o.dates as string[], close: o.close as number[] };
}

export function parseFundamentalsInputs(v: unknown): FundamentalsFile['inputs'] | null {
  if (!isObj(v)) return null;
  const i = v, inputs: FundamentalsFile['inputs'] = {};
  for (const k of ['epsT', 'epsF'] as const) { if (i[k] === null) inputs[k] = null; else if (num(i[k])) inputs[k] = i[k] as number; else if (i[k] !== undefined) return null; }
  for (const k of ['epsN', 'fcfPs', 'fcfTrend', 'roe', 'bv'] as const) { if (num(i[k])) inputs[k] = i[k] as number; else if (i[k] !== undefined) return null; }
  if (i.fcfTotal !== undefined) { if (!str(i.fcfTotal, 20)) return null; inputs.fcfTotal = i.fcfTotal; }
  if (i.earnOk !== undefined) { if (typeof i.earnOk !== 'boolean') return null; inputs.earnOk = i.earnOk; }
  return inputs;
}

export function parseFundamentalsFile(o: unknown): FundamentalsFile | null {
  if (!isObj(o) || !schemaOk(o) || !isSymbol(o.symbol) || !str(o.source, 40) || !isoDate(o.asof) || !str(o.fetchedAt, 40) || !isObj(o.inputs)) return null;
  const inputs = parseFundamentalsInputs(o.inputs);
  if (!inputs) return null;
  const out: FundamentalsFile = { schema: o.schema as number, symbol: o.symbol, source: o.source, asof: o.asof, fetchedAt: o.fetchedAt, inputs };
  if (o.base !== undefined) {
    if (!Array.isArray(o.base) || o.base.length !== 5 || !o.base.every((x) => str(x, 40))) return null;
    out.base = o.base as string[];
  }
  return out;
}

const MOAT = ['ok', 'weak', 'bad', 'none', 'contested'], GROWTH = ['up', 'slow', 'flat', 'neg', 'na'];
export function parseAnalysisFile(o: unknown): AnalysisFile | null {
  if (!isObj(o) || !schemaOk(o) || !isSymbol(o.symbol) || !(o.status === 'draft' || o.status === 'approved') || !isoDate(o.asof)) return null;
  const out: AnalysisFile = { schema: o.schema as number, symbol: o.symbol, status: o.status, asof: o.asof };
  if (o.moat !== undefined) { if (!MOAT.includes(o.moat as string)) return null; out.moat = o.moat as AnalysisFile['moat']; }
  if (o.growth !== undefined) { if (!GROWTH.includes(o.growth as string)) return null; out.growth = o.growth as AnalysisFile['growth']; }
  for (const k of ['moatTxt', 'growthTxt', 'track', 'next', 'pen'] as const) { if (o[k] !== undefined) { if (!str(o[k], 600)) return null; out[k] = o[k] as string; } }
  if (o.cyclical !== undefined) { if (typeof o.cyclical !== 'boolean') return null; out.cyclical = o.cyclical; }
  for (const k of ['peNotes', 'fcfNotes'] as const) { if (o[k] !== undefined) { if (!Array.isArray(o[k]) || (o[k] as unknown[]).length > 8 || !(o[k] as unknown[]).every((x) => str(x, 300))) return null; out[k] = o[k] as string[]; } }
  return out;
}

export function parseManualFile(o: unknown): ManualFile | null {
  if (!isObj(o) || !schemaOk(o) || !isSymbol(o.symbol) || !isoDate(o.asof)) return null;
  const out: ManualFile = { schema: o.schema as number, symbol: o.symbol, asof: o.asof };
  const dv = div(o.div), ev = events(o.events);
  if (dv === null || ev === null) return null;
  if (dv) out.div = dv;
  if (ev) out.events = ev;
  if (o.inputs !== undefined) {
    const f = parseFundamentalsInputs(o.inputs);
    if (!f) return null;
    out.inputs = f;
  }
  if (o.watchAdded !== undefined) {
    if (!isObj(o.watchAdded) || !str(o.watchAdded.date, 20) || !num(o.watchAdded.px) || o.watchAdded.px <= 0) return null;
    out.watchAdded = { date: o.watchAdded.date, px: o.watchAdded.px };
  }
  return out;
}

export function parseCpiFile(o: unknown): CpiFile | null {
  if (!isObj(o) || !schemaOk(o) || !(o.yoyPct === null || (num(o.yoyPct) && Math.abs(o.yoyPct) < 100)) || !str(o.label, 40) || !(o.asof === null || (typeof o.asof === 'string' && /^\d{4}-\d{2}$/.test(o.asof))) || !(o.fetchedAt === null || str(o.fetchedAt, 40)) || !str(o.source, 40)) return null;
  return { schema: o.schema as number, yoyPct: o.yoyPct as number | null, label: o.label, asof: o.asof as string | null, fetchedAt: o.fetchedAt as string | null, source: o.source };
}

export function parseUniverseFile(o: unknown): UniverseFile | null {
  if (!isObj(o) || !schemaOk(o) || !isSymbol(o.benchmark) || !Array.isArray(o.tickers) || o.tickers.length > 200 || !(o.benchmarkBaseDate === undefined || isoDate(o.benchmarkBaseDate))) return null;
  const seen = new Set<string>(), tickers: UniverseFile['tickers'] = [];
  for (const t of o.tickers) {
    if (!isObj(t) || !isSymbol(t.symbol) || seen.has(t.symbol) || !(t.name === undefined || str(t.name, 80))) return null;
    seen.add(t.symbol);
    tickers.push({ symbol: t.symbol, ...(t.name ? { name: t.name as string } : {}) });
  }
  return { schema: o.schema as number, benchmark: o.benchmark, ...(o.benchmarkBaseDate ? { benchmarkBaseDate: o.benchmarkBaseDate as string } : {}), tickers };
}
