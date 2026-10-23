import { cashFlow } from '../../calc/cashflow';
import { CF_CATS, type CfCat } from '../../calc/types';
import { RULES } from '../../config/rules';
import { he } from '../../i18n/he';
import { $, tile } from '../dom';
import type { Ctx } from '../context';
import { fmtNis, ltr } from '../format';
import { html, setHtml } from '../html';

/** Builds the cash-flow input grid. Values come from the profile; input events are wired by the app. */
export function buildCashFlowInputs(P: Ctx['P']): void {
  const field = (id: string, label: string, ph: string) =>
    html`<label>${label}<input type="text" inputmode="decimal" autocomplete="off" data-cf="${id}" placeholder="${ph}" value="${P.cf[id as 'income']}"></label>`;
  setHtml($('cfInputs'), html`${[
    field('income', he.cashflow.income, he.cashflow.perMonth),
    CF_CATS.map((c: CfCat) => field(c, he.cashflow.cats[c], he.cashflow.perMonth)),
    field('extra', he.cashflow.extra, he.cashflow.extraPh),
    html`<label>${he.cashflow.target}<select data-cf="target">${RULES.cashflow.cushionMonthsOptions.map((m) => html`<option value="${m}" ${String(m) === P.cf.target ? 'selected' : ''}>${he.cashflow.targetOpt(m)}</option>`)}</select></label>`,
  ]}`);
}

export function renderCashFlow({ P, C }: Ctx): void {
  const f = cashFlow(P.cf, C), T = he.cashflow;
  setHtml($('cfTiles'), html`${[
    tile(T.tileLeft, f.hasData ? ltr((f.left < 0 ? '-' : '') + fmtNis(Math.abs(f.left))) : '-', f.left < 0 && f.hasData ? T.tileLeftOver : T.tileLeftSub),
    tile(T.tileRate, f.savingsRate !== null && f.exp > 0 ? (f.savingsRate * 100).toFixed(0) + '%' : '-', T.tileRateSub),
    tile(T.tileCushion, f.months !== null ? T.tileCushionVal(f.months.toFixed(1)) : '-', T.tileCushionSub(fmtNis(f.liquid))),
    tile(T.tileExp, f.exp > 0 ? fmtNis(f.exp) : '-', T.tileExpSub),
  ]}`);
  const sorted = f.rows.filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
  const max = sorted.length ? (sorted[0] as { v: number }).v : 1;
  setHtml($('cfBars'), sorted.length
    ? html`${sorted.map((r) => html`<div class="cf-bar"><span>${T.cats[r.key].replace(/ \(.*\)/, '')}</span><div class="track"><div class="fill" data-w="${((r.v / max) * 100).toFixed(1)}"></div></div><span class="val">${fmtNis(r.v)} <small>${((r.v / f.exp) * 100).toFixed(0)}%</small></span></div>`)}`
    : html`<p class="rate-note muted0">${T.barsEmpty}</p>`);
  $('cfBars').querySelectorAll<HTMLElement>('.fill[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });

  let link;
  if (f.exp <= 0) link = T.linkNoExp;
  else if (f.gap >= 0) link = T.linkAbove({ target: f.target, need: fmtNis(f.need), liquid: fmtNis(f.liquid), gap: fmtNis(f.gap), left: fmtNis(Math.max(f.left, 0)) });
  else link = T.linkBelow({ target: f.target, need: fmtNis(f.need), liquid: fmtNis(f.liquid), gap: fmtNis(-f.gap), fill: f.monthsToFill !== null ? T.fillMonths(f.monthsToFill) : T.fillNone });
  setHtml($('cfLink'), html`<b>${T.linkLead}</b> ${link}`);
  $('cfNote').textContent = T.foot({ mmf: fmtNis(C.mmf), cash: fmtNis(C.cash), extra: f.extra > 0 ? fmtNis(f.extra) : null });
}
