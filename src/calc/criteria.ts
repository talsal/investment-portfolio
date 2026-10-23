import { RULES } from '../config/rules';
import type { BfInputs } from './types';

/** Machine-readable reasons; the UI maps each code to Hebrew text. */
export type FlagCode = 'moatBad' | 'growthNeg' | 'fcfFalling' | 'moatWeak' | 'moatContested' | 'growthSlow' | 'growthFlat';
export type AddReason = 'pe' | 'fcf' | 'moatBad' | 'moatWeak' | 'moatContested' | 'moatNone' | 'growthNeg';
export type HoldLevel = 'cyclical' | 'reconsider' | 'checkOne' | 'holdWatch' | 'hold';

export interface Criteria {
  peT: number | null;
  peF: number | null;
  pePass: boolean;
  /** True when an input the P/E rule needs is missing: shown as "no data" rather than a failure. Still scores 0. */
  peNa: boolean;
  fcfYield: number | null;
  fcfPass: boolean;
  /** Same for the FCF rule (needs FCF and its trend, or ROE for financials). */
  fcfNa: boolean;
  moatPass: boolean;
  growthPass: boolean;
  /** Number of criteria passed, out of 4. A partial state counts as not passing. */
  pass: number;
}

/**
 * The four screening criteria. Thresholds come from config/rules.json:
 * P/E: forward P/E <= max and earnings reliable; FCF: yield >= min and trend >= min (or ROE rule when no FCF);
 * moat passes only on "ok"; growth passes only on "up".
 */
export function evaluateCriteria(inp: BfInputs, px: number): Criteria {
  const R = RULES.criteria;
  const peT = inp.epsT ? px / inp.epsT : null;
  const peF = inp.epsF ? px / inp.epsF : null;
  const pePass = peF !== null && peF <= R.pe.maxForward && (!R.pe.requiresReliableEarnings || inp.earnOk !== false);
  const fcfYield = inp.fcfPs ? (inp.fcfPs / px) * 100 : null;
  const fcfPass = inp.fcfPs
    ? (fcfYield as number) >= R.fcf.minYieldPct && (inp.fcfTrend ?? NaN) >= R.fcf.minTrendPctPerYear
    : (inp.roe ?? NaN) >= R.fcf.roeMinPct;
  const peNa = !inp.epsF;
  const fcfNa = inp.fcfPs ? inp.fcfTrend === undefined || inp.fcfTrend === null : inp.roe === undefined || inp.roe === null;
  const moatPass = inp.moat === R.moat.passesOn;
  const growthPass = inp.growth === R.growth.passesOn;
  return { peT, peF, pePass, peNa, fcfYield, fcfPass, fcfNa, moatPass, growthPass, pass: +pePass + +fcfPass + +moatPass + +growthPass };
}

export function holdAssessment(inp: BfInputs) {
  const H = RULES.hold;
  const red: FlagCode[] = [], yellow: FlagCode[] = [];
  if (inp.moat && H.redFlags.moat.includes(inp.moat)) red.push('moatBad');
  if (inp.growth && H.redFlags.growth.includes(inp.growth)) red.push('growthNeg');
  if (inp.fcfPs && (inp.fcfTrend ?? NaN) < H.redFlags.fcfTrendBelowPct) red.push('fcfFalling');
  if (inp.moat === 'weak' && H.yellowFlags.moat.includes('weak')) yellow.push('moatWeak');
  if (inp.moat === 'contested' && H.yellowFlags.moat.includes('contested')) yellow.push('moatContested');
  if (inp.growth === 'slow' && H.yellowFlags.growth.includes('slow')) yellow.push('growthSlow');
  if (inp.growth === 'flat' && H.yellowFlags.growth.includes('flat')) yellow.push('growthFlat');
  let level: HoldLevel;
  if (inp.cyclical) level = 'cyclical';
  else if (red.length >= H.reconsiderAtRedCount) level = 'reconsider';
  else if (red.length === 1) level = 'checkOne';
  else if (yellow.length) level = 'holdWatch';
  else level = 'hold';
  return { level, red, yellow };
}

/** "Add" candidate: P/E and FCF pass, moat "ok", growth not negative. Not a buy instruction. */
export function addAssessment(inp: BfInputs, c: Criteria) {
  const reasons: AddReason[] = [];
  if (!c.pePass) reasons.push('pe');
  if (!c.fcfPass) reasons.push('fcf');
  if (inp.moat !== RULES.add.requires.moat) {
    reasons.push(inp.moat === 'bad' ? 'moatBad' : inp.moat === 'weak' ? 'moatWeak' : inp.moat === 'contested' ? 'moatContested' : 'moatNone');
  }
  if (inp.growth === RULES.add.requires.growthNot) reasons.push('growthNeg');
  return { candidate: reasons.length === 0, reasons };
}

/** Criteria still missing for a watchlist stock. */
export function watchMissing(inp: BfInputs, c: Criteria): Array<'pe' | 'fcf' | 'moat' | 'growth'> {
  const miss: Array<'pe' | 'fcf' | 'moat' | 'growth'> = [];
  if (!c.pePass) miss.push('pe');
  if (!c.fcfPass) miss.push('fcf');
  if (inp.moat !== RULES.criteria.moat.passesOn) miss.push('moat');
  if (inp.growth !== RULES.criteria.growth.passesOn) miss.push('growth');
  return miss;
}
