import type { BfInputs, MarketData, TickerPack } from '../calc/types';

/**
 * The personal data pack: a market-data bundle (prices, S&P history, dividends, earnings dates, fundamentals,
 * qualitative analysis) that lives inside the user's own profile file instead of the public /data folder. It never
 * leaves the device, so it can hold data the site could not publish. It is read with the same strictness as any
 * imported file: every field is whitelisted, typed and length-capped.
 */
export const MAX_PACK_CHARS = 300_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SYM = /^[A-Z0-9][A-Z0-9.\-_]{0,11}$/;
const strList = (v: unknown, n: number, max: number): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => str(x, max)).slice(0, n) : undefined;

function bf(o: unknown): BfInputs | undefined {
  if (!isObj(o)) return undefined;
  const b: BfInputs = {};
  for (const k of ['epsT', 'epsF'] as const) { if (o[k] === null) b[k] = null; else if (num(o[k])) b[k] = o[k] as number; }
  for (const k of ['epsN', 'fcfPs', 'fcfTrend', 'roe', 'bv'] as const) if (num(o[k])) b[k] = o[k] as number;
  if (str(o.fcfTotal, 20)) b.fcfTotal = o.fcfTotal;
  if (typeof o.earnOk === 'boolean') b.earnOk = o.earnOk;
  if (typeof o.cyclical === 'boolean') b.cyclical = o.cyclical;
  for (const k of ['pen', 'moatTxt', 'growthTxt', 'track', 'next'] as const) if (str(o[k], 600)) b[k] = o[k] as string;
  if (typeof o.moat === 'string' && ['ok', 'weak', 'bad', 'none', 'contested'].includes(o.moat)) b.moat = o.moat as BfInputs['moat'];
  if (typeof o.growth === 'string' && ['up', 'slow', 'flat', 'neg', 'na'].includes(o.growth)) b.growth = o.growth as BfInputs['growth'];
  const pn = strList(o.peNotes, 8, 300), fn = strList(o.fcfNotes, 8, 300);
  if (pn) b.peNotes = pn;
  if (fn) b.fcfNotes = fn;
  return b;
}

function ticker(o: unknown): TickerPack | null {
  if (!isObj(o) || !pos(o.price)) return null;
  const t: TickerPack = { price: o.price };
  if (str(o.name, 80)) t.name = o.name;
  if (str(o.cur, 8)) t.cur = o.cur;
  const b = bf(o.bf);
  if (b && Object.keys(b).length) t.bf = b;
  if (Array.isArray(o.base) && o.base.length === 5 && o.base.every((x) => str(x, 40))) t.base = o.base as string[];
  if (pos(o.baseClose)) t.baseClose = o.baseClose;
  if (Array.isArray(o.events)) {
    t.events = o.events.slice(0, 20).flatMap((e) => (isObj(e) && (e.d === null || (typeof e.d === 'string' && ISO.test(e.d))) && str(e.what, 300)
      ? [{ d: e.d as string | null, what: e.what as string, ...(e.st === 'confirmed' || e.st === 'est' || e.st === 'unk' ? { st: e.st } : {}) }] : []));
  }
  if (isObj(o.div) && num(o.div.perShare) && o.div.perShare >= 0) t.div = { perShare: o.div.perShare, ...(num(o.div.freq) && o.div.freq >= 1 && o.div.freq <= 12 ? { freq: o.div.freq } : {}) };
  const ta = typeof o.asof === 'string' ? (ISO.test(o.asof) ? o.asof : dmyToIso(o.asof)) : null;
  if (ta) t.asof = ta;
  if (o.watch === true) t.watch = true;
  if (isObj(o.watchAdded) && str(o.watchAdded.date, 20) && pos(o.watchAdded.px)) t.watchAdded = { date: o.watchAdded.date, px: o.watchAdded.px };
  return t;
}

function hist(o: unknown): MarketData['hist'] {
  if (!isObj(o) || !Array.isArray(o.dates) || !Array.isArray(o.spy) || !isObj(o.close)) return undefined;
  const n = o.dates.length;
  if (n < 2 || n > 3000 || o.spy.length !== n) return undefined;
  let prev = '';
  for (const d of o.dates) { if (typeof d !== 'string' || !ISO.test(d) || d <= prev) return undefined; prev = d; }
  if (!o.spy.every(pos)) return undefined;
  const close: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(o.close)) {
    const key = k.toUpperCase();
    if (SYM.test(key) && Array.isArray(v) && v.length === n && v.every(pos)) close[key] = v as number[];
  }
  const fx = Array.isArray(o.fx) && o.fx.length === n && o.fx.every(pos) ? (o.fx as number[]) : undefined;
  return { dates: o.dates as string[], spy: o.spy as number[], close, fx };
}

/** Strictly reads an untrusted pack. Returns null when it is not a pack, too large, or has no usable content. */
export function sanitizePack(o: unknown): MarketData | null {
  if (!isObj(o)) return null;
  try { if (JSON.stringify(o).length > MAX_PACK_CHARS) return null; } catch { return null; }
  const M: MarketData = { tickers: {} };
  if (str(o.asof, 20)) M.asof = o.asof;
  if (num(o.fx) && o.fx >= 1 && o.fx <= 10) M.fx = o.fx;
  if (isObj(o.bm) && typeof o.bm.date === 'string' && ISO.test(o.bm.date) && pos(o.bm.spyBase) && pos(o.bm.spyCur)) {
    M.bm = { date: o.bm.date, dateLabel: str(o.bm.dateLabel, 20) ? o.bm.dateLabel : undefined, spyBase: o.bm.spyBase, spyCur: o.bm.spyCur };
  }
  const h = hist(o.hist);
  if (h) M.hist = h;
  if (isObj(o.tickers)) for (const [k, v] of Object.entries(o.tickers)) { const key = k.toUpperCase(); const t = SYM.test(key) ? ticker(v) : null; if (t) M.tickers[key] = t; }
  if (isObj(o.cpi) && num(o.cpi.yoyPct) && Math.abs(o.cpi.yoyPct) < 100 && str(o.cpi.label, 40)) M.cpi = { yoyPct: o.cpi.yoyPct, label: o.cpi.label };
  if (o.demo === true) M.demo = true;
  const useful = Object.keys(M.tickers).length > 0 || !!M.hist || !!M.fx || !!M.cpi;
  return useful ? M : null;
}

export const dmyToIso = (s: string | undefined): string | null => (s && /^\d{2}\.\d{2}\.\d{4}$/.test(s) ? `${s.slice(6)}-${s.slice(3, 5)}-${s.slice(0, 2)}` : null);

/** Layers the personal pack over the site's data: anything the pack provides wins, the rest stays. */
export function applyPack(base: MarketData, pack: MarketData): MarketData {
  const M: MarketData = { ...base, tickers: { ...base.tickers, ...pack.tickers } };
  if (pack.asof) M.asof = pack.asof;
  if (pack.fx) M.fx = pack.fx;
  if (pack.cpi) M.cpi = pack.cpi;
  if (pack.demo) M.demo = true;
  if (pack.hist) {
    M.hist = pack.hist;
    M.spyNow = undefined;
    M.benchmarkDefaultDate = pack.asof ? `${(dmyToIso(pack.asof) ?? '2026-01-01').slice(0, 4)}-01-01` : base.benchmarkDefaultDate;
    M.bm = undefined;
  }
  if (pack.bm) M.bm = pack.bm;
  M.meta = {
    groups: {}, fundamentalsAsof: {}, analysisAsof: {}, draftsShown: [], stalePrices: [], cpiAsof: null, historyAsof: null,
    personalPack: { asof: dmyToIso(pack.asof) },
  };
  // Entries kept from an earlier update are named on the dashboard like any carried-over price.
  const packIso = dmyToIso(pack.asof);
  if (packIso) M.meta.stalePrices = Object.entries(pack.tickers).filter(([, t]) => t.asof && t.asof < packIso).map(([k]) => k);
  return M;
}

export type PackTextResult = { ok: true; value: unknown } | { ok: false; error: 'empty' | 'tooBig' | 'notJson' };

/** Reads what a chat assistant typically returns: bare JSON, a ```json fence, or JSON with a sentence around it. */
export function parsePackText(text: string): PackTextResult {
  const t = text.trim();
  if (!t) return { ok: false, error: 'empty' };
  if (t.length > MAX_PACK_CHARS * 1.5) return { ok: false, error: 'tooBig' };
  const tries: string[] = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence?.[1]) tries.push(fence[1].trim());
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const c of tries) { try { return { ok: true, value: JSON.parse(c) }; } catch { /* try the next shape */ } }
  return { ok: false, error: 'notJson' };
}

/** Gives every entry its own date (the pack's date unless it already has one), so later merges know how old each price is. */
export function stampPack(p: MarketData): MarketData {
  const iso = dmyToIso(p.asof);
  if (!iso) return p;
  return { ...p, tickers: Object.fromEntries(Object.entries(p.tickers).map(([k, t]) => [k, t.asof ? t : { ...t, asof: iso }])) };
}

/**
 * Completes the existing pack with a newer, possibly partial one: new entries win, entries the new answer did not
 * include stay with their own (older) date, and the other pack-wide fields come from the new one when it has them.
 */
export function mergePack(prev: MarketData | null, next: MarketData): MarketData {
  const n = stampPack(next);
  if (!prev) return n;
  const p = stampPack(prev);
  const M: MarketData = { ...p, tickers: { ...p.tickers, ...n.tickers } };
  if (n.fx !== undefined) M.fx = n.fx;
  if (n.cpi !== undefined) M.cpi = n.cpi;
  if (n.bm !== undefined) M.bm = n.bm;
  if (n.hist !== undefined) M.hist = n.hist;
  if (n.demo !== undefined) M.demo = n.demo;
  const a = dmyToIso(n.asof), b = dmyToIso(p.asof);
  if (n.asof && (!b || (a && a >= b))) M.asof = n.asof;
  return M;
}
