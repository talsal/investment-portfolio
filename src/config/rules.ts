import raw from '../../config/rules.json';

export interface Rules {
  version: number;
  fx: { defaultUsdIls: number };
  criteria: {
    pe: { maxForward: number; requiresReliableEarnings: boolean };
    fcf: { minYieldPct: number; minTrendPctPerYear: number; roeMinPct: number };
    moat: { passesOn: string };
    growth: { passesOn: string };
    scoreOutOf: number;
  };
  hold: {
    redFlags: { moat: string[]; growth: string[]; fcfTrendBelowPct: number };
    yellowFlags: { moat: string[]; growth: string[] };
    reconsiderAtRedCount: number;
  };
  add: { requires: { pe: boolean; fcf: boolean; moat: string; growthNot: string } };
  annualization: { minHoldingDays: number; daysPerYear: number; method: 'linear' };
  dividends: { netTaxApprox: number; defaultPaymentsPerYear: number };
  cashflow: { cushionMonthsOptions: number[]; defaultCushionMonths: number };
  limits: { rows: number; funds: number; trades: number; watchlist: number };
  withdrawal: { timing: 'end-of-month'; maxYears: number };
  freshness: { staleAfterDays: Record<'fx' | 'quotes' | 'benchmark' | 'calendar' | 'cpi' | 'fundamentals' | 'history' | 'analysis' | 'pack', number> };
  history: { years: number };
  backup: { nudgeDays: number; snoozeDays: number; maxFileBytes: number };
  currency: { agorotFactor: number };
}

export const RULES = raw as unknown as Rules;
