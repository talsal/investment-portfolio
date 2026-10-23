import { RULES } from '../config/rules';
import type { Computed } from './portfolio';

export function dividendEstimate(C: Computed) {
  const rows = C.held
    .filter((h) => h.pk?.div && h.pk.div.perShare > 0)
    .map((h) => {
      const div = h.pk!.div!;
      const freq = div.freq || RULES.dividends.defaultPaymentsPerYear;
      return { held: h, perShare: div.perShare, freq, annUsd: div.perShare * freq * h.qty };
    });
  if (!rows.length) return null;
  const annUsd = rows.reduce((s, r) => s + r.annUsd, 0);
  const stocksVal = C.held.reduce((s, h) => (h.ty === 'eq' ? s + h.val : s), 0);
  const annNis = annUsd * C.fx;
  return {
    rows, annUsd, annNis, monthlyNis: annNis / 12, netMonthlyNis: (annUsd * (1 - RULES.dividends.netTaxApprox) * C.fx) / 12,
    yieldOnTradePct: C.tradeTotal > 0 ? (annNis / C.tradeTotal) * 100 : 0,
    yieldOnStocksPct: stocksVal > 0 ? (annNis / stocksVal) * 100 : null,
  };
}
