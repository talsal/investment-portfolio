import { CF_CATS, type AssetType, type CashFlowInput, type Currency, type Profile } from '../calc/types';
import { numStr } from '../calc/num';
import { RULES } from '../config/rules';

const TYPES: Record<string, true> = { eq: true, bond: true, other: true };
const txt = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');

export function blankCashFlow(): CashFlowInput {
  const cf = { income: '', extra: '', target: String(RULES.cashflow.defaultCushionMonths) } as CashFlowInput;
  for (const c of CF_CATS) cf[c] = '';
  return cf;
}

export function blankProfile(): Profile {
  return {
    fx: '', cashUsd: '', cashNis: '', mmf: '', mmfCost: '', tradeRate: '', eqTarget: '',
    rows: [], gemel: [], hish: [], trades: [], cf: blankCashFlow(), settings: { benchmarkDate: '', example: false },
    watchlist: [], withdrawal: { years: '', realRate: '' }, updatedAt: 0,
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/**
 * Sanitises an untrusted profile object (from storage or an imported file) into a well-formed Profile.
 * Never throws; unknown fields are dropped. Accepts the legacy v2 shape (no `settings`).
 */
export function sanitizeProfile(o: unknown): Profile {
  const P = blankProfile();
  if (!isObj(o)) return P;
  const L = RULES.limits;
  P.fx = numStr(o.fx, 1, 10); P.cashUsd = numStr(o.cashUsd, 0, 1e10); P.cashNis = numStr(o.cashNis, 0, 1e10); P.mmf = numStr(o.mmf, 0, 1e10); P.mmfCost = numStr(o.mmfCost, 0, 1e10);
  P.tradeRate = numStr(o.tradeRate, -100, 1000); P.eqTarget = numStr(o.eqTarget, 0, 100);
  for (const r of arr(o.rows, L.rows)) {
    if (!isObj(r)) continue;
    P.rows.push({
      n: txt(r.n, 40), t: txt(r.t, 12),
      c: (r.c === 'ILS' || r.c === 'AGO' ? r.c : 'USD') as Currency,
      ty: (typeof r.ty === 'string' && TYPES[r.ty] ? r.ty : 'eq') as AssetType,
      q: numStr(r.q, 0, 1e10), k: numStr(r.k, 0, 1e10), p: numStr(r.p, 0, 1e10),
    });
  }
  for (const g of ['gemel', 'hish'] as const) {
    for (const r of arr(o[g], L.funds)) {
      if (!isObj(r)) continue;
      P[g].push({ n: txt(r.n, 50), b: numStr(r.b, 0, 1e11), d: numStr(r.d, 0, 1e11), e: numStr(r.e, 0, 100), r: numStr(r.r, -100, 1000) });
    }
  }
  for (const t of arr(o.trades, L.trades)) {
    if (!isObj(t)) continue;
    P.trades.push({
      d: /^\d{4}-\d{2}-\d{2}$/.test(String(t.d ?? '')) ? String(t.d) : '',
      t: txt(t.t, 12).toUpperCase(), s: t.s === 'S' ? 'S' : 'B', q: numStr(t.q, 0, 1e10), p: numStr(t.p, 0, 1e10),
    });
  }
  if (isObj(o.cf)) {
    P.cf.income = numStr(o.cf.income, 0, 1e8); P.cf.extra = numStr(o.cf.extra, 0, 1e8);
    const opts = RULES.cashflow.cushionMonthsOptions.map(String);
    P.cf.target = opts.includes(String(o.cf.target)) ? String(o.cf.target) : String(RULES.cashflow.defaultCushionMonths);
    for (const c of CF_CATS) P.cf[c] = numStr(o.cf[c], 0, 1e8);
  }
  if (isObj(o.settings) && typeof o.settings.benchmarkDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.settings.benchmarkDate)) {
    P.settings.benchmarkDate = o.settings.benchmarkDate;
  }
  if (isObj(o.settings) && o.settings.example === true) P.settings.example = true;
  const seen = new Set<string>();
  for (const w of arr(o.watchlist, L.watchlist)) {
    const t = txt(w, 12).trim().toUpperCase().replace(/\s+/g, '');
    if (t && !seen.has(t)) { seen.add(t); P.watchlist.push(t); }
  }
  if (isObj(o.withdrawal)) {
    P.withdrawal.years = numStr(o.withdrawal.years, 0, RULES.withdrawal.maxYears);
    P.withdrawal.realRate = numStr(o.withdrawal.realRate, -50, 100);
  }
  if (typeof o.updatedAt === 'number' && isFinite(o.updatedAt)) P.updatedAt = o.updatedAt;
  return P;
}
