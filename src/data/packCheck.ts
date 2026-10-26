import type { MarketData } from '../calc/types';
import { dmyToIso } from './pack';

/** A price that moved more than this since the reference is shown as suspicious (not blocked). */
export const JUMP_PCT = 25;
/** The dollar rate rarely moves this much between two updates. */
export const FX_JUMP_PCT = 5;
/** Data older than this many days is flagged. */
export const STALE_DAYS = 7;

export interface PackCheckRow {
  t: string; price: number; cur: string | null;
  ref: number | null; refFrom: 'pack' | 'typed' | null;
  changePct: number | null; jump: boolean; notUsd: boolean;
}
export interface PackCheck {
  rows: PackCheckRow[];
  /** Wanted (held or followed, in dollars) but not in the new pack. */
  missing: string[];
  /** Present in the raw answer but dropped by the strict reader. */
  rejected: string[];
  /** In the previous pack, absent from the new one (they disappear on import). */
  dropped: string[];
  extra: number;
  asofIso: string | null; ageDays: number | null;
  noDate: boolean; stale: boolean; future: boolean;
  fx: { value: number; ref: number; jump: boolean } | null;
  /** True when nothing needs the user's attention. */
  clean: boolean;
}

export interface PackCheckInput {
  raw: unknown;
  pack: MarketData;
  /** Tickers the user holds in dollars or follows. */
  wanted: string[];
  /** Previous pack (if any) and the prices the user typed, used as references. */
  previous: MarketData | null;
  typed: Record<string, number>;
  typedFx: number | null;
  today: Date;
}

const DAY = 86_400_000;

/** Compares an imported pack with what the user already has and flags what looks wrong. The pack is applied only on confirmation. */
export function checkPack(i: PackCheckInput): PackCheck {
  const rows: PackCheckRow[] = Object.entries(i.pack.tickers).map(([t, p]) => {
    const prevPrice = i.previous?.tickers[t]?.price;
    const typed = i.typed[t];
    const ref = prevPrice && prevPrice > 0 ? prevPrice : typed && typed > 0 ? typed : null;
    const refFrom = prevPrice && prevPrice > 0 ? 'pack' : ref ? 'typed' : null;
    const changePct = ref ? ((p.price - ref) / ref) * 100 : null;
    return { t, price: p.price, cur: p.cur ?? null, ref, refFrom, changePct, jump: changePct !== null && Math.abs(changePct) > JUMP_PCT, notUsd: !!p.cur && p.cur !== 'USD' };
  });
  const have = new Set(Object.keys(i.pack.tickers));
  const rawTickers = (i.raw && typeof i.raw === 'object' ? (i.raw as { tickers?: unknown }).tickers : undefined);
  const rejected = rawTickers && typeof rawTickers === 'object' && !Array.isArray(rawTickers)
    ? Object.keys(rawTickers as object).map((k) => k.toUpperCase()).filter((k) => !have.has(k)) : [];
  const wantedSet = new Set(i.wanted);
  const missing = i.wanted.filter((t) => !have.has(t) && !rejected.includes(t));
  const dropped = i.previous ? Object.keys(i.previous.tickers).filter((t) => !have.has(t)) : [];
  const extra = [...have].filter((t) => !wantedSet.has(t)).length;

  const asofIso = dmyToIso(i.pack.asof);
  const t0 = Date.UTC(i.today.getFullYear(), i.today.getMonth(), i.today.getDate());
  const ageDays = asofIso ? Math.round((t0 - Date.parse(asofIso)) / DAY) : null;
  const noDate = !asofIso;
  const stale = ageDays !== null && ageDays > STALE_DAYS;
  const future = ageDays !== null && ageDays < -1;

  const fxRef = i.typedFx ?? i.previous?.fx ?? null;
  const fx = i.pack.fx && fxRef ? { value: i.pack.fx, ref: fxRef, jump: Math.abs((i.pack.fx - fxRef) / fxRef) * 100 > FX_JUMP_PCT } : null;

  const clean = !rows.some((r) => r.jump || r.notUsd) && !missing.length && !rejected.length && !noDate && !stale && !future && !fx?.jump;
  return { rows, missing, rejected, dropped, extra, asofIso, ageDays, noDate, stale, future, fx, clean };
}
