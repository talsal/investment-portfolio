import { benchmarkComparison, resolveBenchmark } from '../../calc/benchmark';
import { dividendEstimate } from '../../calc/dividends';
import { upcomingEvents } from '../../calc/events';
import { equityShare } from '../../calc/portfolio';
import { annualEstimate, realReturnPct, totalProfit } from '../../calc/returns';
import { RULES } from '../../config/rules';
import { he } from '../../i18n/he';
import { $, dataTable, show, td, th, tile, tr } from '../dom';
import type { Ctx } from '../context';
import { colored, fmtNis, fmtPct, fmtUsd, iso, isolateSigned, isoToDmy, ltr, pcs, sgn, tone } from '../format';
import { html, setHtml } from '../html';

/** Total capital + split bar. Segment widths are applied through CSSOM (CSP forbids inline style attributes). */
export function renderTotals({ C }: Ctx): void {
  $('totNis').textContent = fmtNis(C.total);
  $('totUsd').textContent = fmtUsd(C.total / C.fx);
  const parts = ([[he.total.trade, C.tradeTotal, 1], [he.total.gemel, C.gemelTotal, 3], [he.total.hish, C.hishTotal, 4]] as const).filter((x) => x[1] > 0);
  setHtml($('splitBar'), html`${parts.map(([, v, slot]) => { const p = (v / C.total) * 100; return html`<div class="compare-seg bg${slot}" data-w="${p}">${p >= 12 ? html`<span class="seg-t">${Math.round(p) + '%'}</span>` : ''}</div>`; })}`);
  $('splitBar').querySelectorAll<HTMLElement>('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
  setHtml($('splitLegend'), html`${parts.map(([name, v, slot]) => html`<div class="cl-item"><span class="cl-swatch bg${slot}"></span><span class="cl-text"><span class="cl-name">${name}</span><span class="cl-sub">${fmtNis(v)} (${fmtPct((v / C.total) * 100)})</span></span></div>`)}`);
}

export function renderProfitTotal({ C }: Ctx): void {
  const t = totalProfit(C);
  show('plSection', !!t);
  if (!t) return;
  const sgnNis = (v: number) => (v < 0 ? '-' : '+') + fmtNis(Math.abs(v));
  setHtml($('plTiles'), html`${[
    tile(he.pl.tileProfit, colored(t.profit, sgnNis(t.profit)), he.pl.tileProfitSub),
    tile(he.pl.tileReturn, colored(t.retPct, sgn(t.retPct)), he.pl.tileReturnSub(fmtNis(t.inv))),
    tile(he.pl.tileValue, fmtNis(t.cur), he.pl.tileValueSub(fmtNis(C.total))),
  ]}`);
  setHtml($('plTable'), dataTable(he.pl.th.map((h, i) => th(h, i > 0)), t.parts.map((x) => {
    const g = x.cur - x.inv, p = (g / x.inv) * 100;
    return tr([td(he.pl.part[x.key]), td(fmtNis(x.inv), true), td(fmtNis(x.cur), true), td(colored(g, sgnNis(g), 'b6'), true), td(colored(p, sgn(p), 'b6'), true)]);
  })));
  $('plNote').textContent = he.pl.foot(C.plMissing, C.mmfInPl);
}

export function renderEquity({ P, C }: Ctx): void {
  const e = equityShare(C, P);
  setHtml($('eqTiles'), html`${[
    tile(he.equity.tileEq, fmtPct(e.eqPct), fmtNis(e.eq)),
    tile(he.equity.tileBond, fmtPct(e.bondPct), fmtNis(e.bond)),
    tile(he.equity.tileOther, fmtPct(e.otherPct), he.equity.tileOtherSub),
    e.target !== null ? tile(he.equity.tileGap(String(e.target)), ltr((e.aboveTarget ? '+' : '-') + fmtNis(e.gapNis as number)), e.aboveTarget ? he.equity.above : he.equity.below) : '',
  ]}`);
  $('eqNote').textContent = he.equity.foot(C.unknownFunds);
}

export function renderAnnual({ P, M, C }: Ctx): void {
  const a = annualEstimate(C, P);
  show('annSection', !!a);
  if (!a) return;
  const sgnNisPlain = (v: number) => (v < 0 ? '-' : '') + fmtNis(Math.abs(v));
  setHtml($('annTiles'), html`${[
    tile(he.annual.tileProfit, ltr(sgnNisPlain(a.profit)), he.annual.tileProfitSub),
    tile(he.annual.tileMonthly, ltr(sgnNisPlain(a.profit / 12)), he.annual.tileMonthlySub),
    tile(he.annual.tileWeighted, ltr(sgn(a.weightedPct)), he.annual.tileWeightedSub(fmtNis(a.bal))),
  ]}`);
  setHtml($('annTable'), dataTable(he.annual.th.map((h, i) => th(h, i > 0)), a.rows.map((x) =>
    tr([td(x.kind === 'trade' ? he.annual.trade : (x.kind === 'gemel' ? he.annual.gemel : he.annual.hish) + (x.name || he.annual.noName)), td(fmtNis(x.bal), true),
      td(colored(x.ratePct, sgn(x.ratePct), 'b6'), true), td(fmtNis((x.bal * x.ratePct) / 100), true)]))));
  $('annNote').textContent = he.annual.foot;
  // New vs. the generic reference: inflation and real return (data/cpi.json). Skipped by the parity comparison.
  const infl = $('annInfl');
  if (M.cpi) {
    const real = realReturnPct(a.weightedPct, M.cpi.yoyPct);
    infl.hidden = false;
    infl.textContent = he.annual.inflation(iso(M.cpi.yoyPct.toFixed(1) + '%'), M.cpi.label, iso(sgn(real)), fmtNis((a.bal * real) / 100 / 12));
  } else infl.hidden = true;
}

export function renderDividends({ C }: Ctx): void {
  const d = dividendEstimate(C);
  show('divSection', !!d);
  if (!d) return;
  setHtml($('divTable'), dataTable(he.dividends.th.map((h, i) => th(h, i > 0)), [
    ...d.rows.map((r) => tr([td(html`${r.held.name || r.held.T} <span class="c-muted">${r.held.T}</span>`), td(fmtUsd(r.perShare), true), td(String(r.freq), true), td(fmtUsd(r.annUsd), true), td(fmtNis(r.annUsd * C.fx), true)])),
    tr([td(he.dividends.totalRow), td('-', true), td('-', true), td(fmtUsd(d.annUsd), true), td(fmtNis(d.annNis), true)], 'total-row'),
  ]));
  $('divNote').textContent = he.dividends.foot({
    annual: fmtNis(d.annNis), monthly: fmtNis(d.monthlyNis), netMonthly: fmtNis(d.netMonthlyNis), tax: Math.round(RULES.dividends.netTaxApprox * 100),
    yTrade: d.yieldOnTradePct.toFixed(1), yStocks: d.yieldOnStocksPct !== null ? d.yieldOnStocksPct.toFixed(1) : null,
  });
}

export function renderBenchmark({ P, M, C }: Ctx): void {
  const bm = resolveBenchmark(M, P);
  const msg = $('bmError');
  msg.textContent = bm && 'error' in bm ? (bm.error === 'noHistory' ? he.benchmark.errNoHistory : he.benchmark.errBefore) : '';
  msg.hidden = !msg.textContent;
  const useBm = bm && !('error' in bm) ? bm : null;
  const cmp = useBm ? benchmarkComparison(C, useBm) : null;
  show('bmSection', !!(useBm && cmp) || !!msg.textContent);
  if (!useBm || !cmp) { for (const id of ['bmBasket', 'bmSpy', 'bmDiff', 'bmTable']) $(id).textContent = ''; $('bmNote').textContent = ''; return; }
  const bs = (v: number) => colored(v, pcs(v), 'b6');
  const dfc = (v: number, unit: (n: string) => string) => html`<span dir="ltr" class="${tone(v)} b6">${unit((v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2))}</span>`;
  setHtml($('bmBasket'), bs(cmp.basketPct));
  setHtml($('bmSpy'), bs(cmp.spyPct));
  setHtml($('bmDiff'), dfc(cmp.diff, he.benchmark.points));
  setHtml($('bmTable'), dataTable([th(he.benchmark.th.stock), th(he.benchmark.th.base(useBm.dateLabel), true), th(he.benchmark.th.cur, true), th(he.benchmark.th.change, true), th(he.benchmark.th.vs, true)], [
    ...cmp.rows.map((r) => tr([td(r.T), td(ltr(fmtUsd(r.base)), true), td(ltr(fmtUsd(r.px)), true), td(bs(r.changePct), true), td(dfc(r.vsSpy, he.benchmark.pts), true)])),
    tr([td(he.benchmark.totalRow), td(ltr(fmtUsd(cmp.vb)), true), td(ltr(fmtUsd(cmp.vc)), true), td(bs(cmp.basketPct), true), td(dfc(cmp.diff, he.benchmark.pts), true)], 'b6'),
    tr([td(he.benchmark.spyRow), td(ltr(fmtUsd(useBm.spyBase)), true), td(ltr(fmtUsd(useBm.spyCur)), true), td(bs(cmp.spyPct), true), td('-', true)]),
  ]));
  $('bmNote').textContent = he.benchmark.foot(useBm.dateLabel);
}

export function renderEvents({ C, now }: Ctx): void {
  const evs = upcomingEvents(C, now);
  show('evSection', evs.length > 0);
  if (!evs.length) return;
  setHtml($('evTable'), dataTable(he.events.th.map((h, i) => th(h, i === 4)), evs.map((e) =>
    tr([td(e.d ? ltr(isoToDmy(e.d)) : '-'), td(e.who), td(isolateSigned(e.what)), td(he.events.status[e.st] ?? ''), td(e.days === null ? '-' : he.events.days(e.days), true)]))));
  $('evNote').textContent = he.events.foot;
}
