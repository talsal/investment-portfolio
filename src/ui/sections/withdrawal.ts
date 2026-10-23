import { withdrawalFor } from '../../calc/withdrawal';
import { he } from '../../i18n/he';
import { $, tile } from '../dom';
import type { Ctx } from '../context';
import { fmtNis } from '../format';
import { html, setHtml } from '../html';

export function syncWithdrawalInputs(P: Ctx['P']): void {
  document.querySelectorAll<HTMLInputElement>('[data-wd]').forEach((el) => { el.value = P.withdrawal[el.dataset.wd as 'years' | 'realRate']; });
}

export function renderWithdrawal({ P, C }: Ctx): void {
  const w = withdrawalFor(P, C);
  const T = he.withdrawal;
  if (!w) {
    setHtml($('wdTiles'), '');
    $('wdNote').textContent = T.empty;
    return;
  }
  setHtml($('wdTiles'), html`${[
    tile(T.tileMonthly, fmtNis(w.monthly), T.tileMonthlySub),
    tile(T.tileAnnual, fmtNis(w.annual), T.tileAnnualSub),
    tile(T.tileBase, fmtNis(w.balance), T.tileBaseSub),
    tile(T.tileHorizon, T.tileHorizonVal(w.months), ''),
  ]}`);
  $('wdNote').textContent = T.foot;
}
