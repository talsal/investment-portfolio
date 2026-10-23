import { RULES } from '../config/rules';
import { nz } from './num';
import { CF_CATS, type CashFlowInput } from './types';
import type { Computed } from './portfolio';

export function cashFlow(cf: CashFlowInput, C: Computed) {
  const income = nz(cf.income), extra = nz(cf.extra);
  const target = parseInt(cf.target, 10) || RULES.cashflow.defaultCushionMonths;
  const rows = CF_CATS.map((key) => ({ key, v: nz(cf[key]) }));
  const exp = rows.reduce((a, r) => a + r.v, 0);
  const left = income - exp;
  const liquid = C.cash + C.mmf + extra;
  const months = exp > 0 ? liquid / exp : null;
  const savingsRate = income > 0 ? left / income : null;
  const need = target * exp;
  const gap = liquid - need;
  return {
    income, extra, target, rows, exp, left, liquid, months, savingsRate, need, gap,
    /** Months of saving needed to reach the cushion, when below target and saving > 0. */
    monthsToFill: gap < 0 && left > 0 ? Math.ceil(-gap / left) : null,
    hasData: income > 0 && exp > 0,
  };
}
