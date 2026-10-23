import { RULES } from '../config/rules';
import { nz, rate } from './num';
import type { Computed } from './portfolio';
import type { Profile } from './types';

export interface Withdrawal {
  balance: number;
  months: number;
  /** Equivalent effective monthly real rate. */
  monthlyRate: number;
  /** Constant monthly withdrawal in today's purchasing power, taken at the END of each month. */
  monthly: number;
  annual: number;
}

/**
 * Level monthly withdrawal that exhausts `balance` after `months` months, withdrawals at month end:
 *   W = B * i / (1 - (1+i)^-n),   i = (1 + realAnnual)^(1/12) - 1.
 * Rates are real (after inflation), so the result is in today's money. i = 0 gives B / n.
 */
export function sustainableWithdrawal(balance: number, realAnnualPct: number, years: number): Withdrawal | null {
  if (!(balance > 0) || !(years > 0) || years > RULES.withdrawal.maxYears || !isFinite(realAnnualPct) || realAnnualPct <= -100) return null;
  const months = Math.round(years * 12);
  if (months < 1) return null;
  const i = Math.pow(1 + realAnnualPct / 100, 1 / 12) - 1;
  const monthly = Math.abs(i) < 1e-12 ? balance / months : (balance * i) / (1 - Math.pow(1 + i, -months));
  return { balance, months, monthlyRate: i, monthly, annual: monthly * 12 };
}

/** Uses the accessible portfolio (trading portfolio incl. cash and money-market); pension/gemel are excluded. */
export function withdrawalFor(P: Profile, C: Computed): Withdrawal | null {
  const r = rate(P.withdrawal.realRate);
  if (r === null) return null;
  return sustainableWithdrawal(C.tradeTotal, r, nz(P.withdrawal.years));
}
