import { addAssessment, evaluateCriteria, holdAssessment, watchMissing, type Criteria } from '../../calc/criteria';
import type { Held } from '../../calc/portfolio';
import type { BfInputs, TickerPack } from '../../calc/types';
import { RULES } from '../../config/rules';
import { REQUEST_TICKER_URL } from '../../config/site';
import { he } from '../../i18n/he';
import { $, dataTable, show, td, th, tr, why } from '../dom';
import type { Ctx } from '../context';
import { fmtNis, fmtUsd } from '../format';
import { html, setHtml, type Raw } from '../html';

const MOAT_TONE: Record<string, string> = { ok: 'c-gain', weak: 'c-sec', bad: 'c-loss', none: 'c-muted', contested: 'c-sec', unavailable: 'c-muted' };
const GROWTH_TONE: Record<string, string> = { up: 'c-gain', slow: 'c-sec', flat: 'c-sec', neg: 'c-loss', na: 'c-muted', unavailable: 'c-muted' };
const tag = (cls: string, t: string): Raw => html`<span class="tag ${cls}">${t}</span>`;
const verdict = (pass: boolean, na = false): Raw =>
  na ? html`<span class="tag c-muted">${he.criteria.na}</span>` : html`<span class="${pass ? 'bf-pass' : 'bf-fail'}">${pass ? he.criteria.pass : he.criteria.fail}</span>`;

/** The four criteria cells (P/E, FCF, moat, growth) shared by the holdings and watchlist tables. */
function criteriaCells(inp: BfInputs, px: number, c: Criteria) {
  const T = he.criteria;
  const peNotes = [...(inp.peNotes ?? [])];
  if (inp.epsN) peNotes.push(T.peNoCovers((px / inp.epsN).toFixed(1)));
  if (inp.bv) peNotes.push(T.peBook((px / inp.bv).toFixed(2)));
  if (inp.pen) peNotes.push(inp.pen);
  const pe = td(html`${verdict(c.pePass, c.peNa)}${why(T.peLine(c.peT !== null ? c.peT.toFixed(1) : null, c.peF !== null ? c.peF.toFixed(1) : null))}${peNotes.map((n) => why(n))}`, false, 'minw');
  const trend = inp.fcfTrend ?? 0;
  const fcfLines = inp.fcfPs
    ? [inp.fcfTotal ? T.fcfCash(inp.fcfTotal) : '', T.fcfYield((c.fcfYield as number).toFixed(1)), inp.fcfTrend === undefined || inp.fcfTrend === null ? T.trendNA : T.fcfTrend(trend >= 0, Math.abs(trend))].filter(Boolean)
    : [T.fcfNA(inp.roe)];
  const fcf = td(html`${verdict(c.fcfPass, c.fcfNa)}${[...fcfLines, ...(inp.fcfNotes ?? [])].map((n) => why(n))}`, false, 'minw');
  const moatKey = (inp.moat === undefined ? 'unavailable' : inp.moat in T.moat ? inp.moat : 'none') as keyof typeof T.moat;
  const growthKey = (inp.growth === undefined ? 'unavailable' : inp.growth in T.growth ? inp.growth : 'na') as keyof typeof T.growth;
  const moat = td(html`${tag(MOAT_TONE[moatKey] as string, T.moat[moatKey])}${why(inp.moatTxt || '')}`);
  const growth = td(html`${tag(GROWTH_TONE[growthKey] as string, T.growth[growthKey])}${why(inp.growthTxt || '')}${inp.track ? why(T.track(inp.track)) : ''}`);
  return { pe, fcf, moat, growth };
}

/** " Request this ticker" link to the repository's issue form, when the site knows its repository. */
const requestLink = (): Raw | '' => (REQUEST_TICKER_URL ? html` <a href="${REQUEST_TICKER_URL}" target="_blank" rel="noopener noreferrer">${he.request.link}</a>` : '');

const signedPct = (v: number) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(1) + '%';

function holdingRow(h: Held, pk: TickerPack, ctx: Ctx): Raw {
  const { C } = ctx, inp = pk.bf as BfInputs, T = he.criteria;
  const crit = evaluateCriteria(inp, h.px), c = criteriaCells(inp, h.px, crit);
  const weight = C.tradeTotal > 0 ? (h.val / C.tradeTotal) * 100 : 0;
  const gUsd = h.k > 0 ? h.qty * (h.px - h.k) : null, gp = h.k > 0 ? ((h.px - h.k) / h.k) * 100 : null;
  const gainCell = gp === null || gUsd === null
    ? td(why(T.gainNone, 'end'), true)
    : td(html`<span dir="ltr" class="b6 ${gp >= 0 ? 'c-gain' : 'c-loss'}">${signedPct(gp)}</span>${why(html`<span dir="ltr">${(gUsd >= 0 ? '+' : '-') + fmtUsd(Math.abs(gUsd))}</span>`, 'end')}${why(html`<span dir="ltr">${(gUsd >= 0 ? '+' : '-') + fmtNis(Math.abs(gUsd) * C.fx)}</span>`, 'end')}`, true);
  const add = addAssessment(inp, crit);
  const addCell = add.candidate
    ? td(html`${tag('c-gain', T.addYes)}${why(T.addWeight(weight.toFixed(1)))}`)
    : td(html`${tag('c-sec', T.addNo)}${why(add.reasons.map((r) => T.addReason[r]).join(' · '))}`);
  const hold = holdAssessment(inp);
  const redTxt = hold.red.map((f) => T.flag[f]);
  const yellowTxt = hold.yellow.map((f) => T.flag[f]);
  const holdWhy = hold.level === 'cyclical' ? T.holdWhy.cyclicalPrefix + redTxt.join(' · ')
    : hold.level === 'reconsider' ? redTxt.join(' · ')
    : hold.level === 'checkOne' ? [...redTxt, ...yellowTxt].join(' · ')
    : hold.level === 'holdWatch' ? yellowTxt.join(' · ')
    : T.holdWhy.none;
  const holdTone = { cyclical: 'c-sec', reconsider: 'c-loss', checkOne: 'c-primary', holdWatch: 'c-gain', hold: 'c-gain' }[hold.level];
  const holdCell = td(html`${tag(holdTone, T.holdLabel[hold.level])}${why(holdWhy)}`);
  return tr([
    td(html`${h.name || he.app.unnamed} <span class="c-muted">${h.T}</span>`), gainCell, c.pe, c.fcf, c.moat, c.growth,
    td(html`<span dir="ltr">${crit.pass}/${RULES.criteria.scoreOutOf}</span>`, true, 'b6'), holdCell, addCell,
  ]);
}

/** Renders holdings criteria + watchlist. Returns whether anything analysis-related is visible. */
export function renderAnalysis(ctx: Ctx): boolean {
  const { C, M } = ctx, T = he.criteria;
  let hasAny = false;
  const bfHeld = C.held.filter((h) => h.pk?.bf);
  const pending = C.held.filter((h) => h.ty === 'eq' && h.cur === 'USD' && !h.pk?.bf).map((h) => h.T || h.name);
  show('bfSection', bfHeld.length > 0);
  if (bfHeld.length) {
    hasAny = true;
    setHtml($('bfTable'), dataTable([
      th(T.th.stock), th(T.th.gain, true), th(T.th.pe), th(html`${T.th.fcf}${why(T.th.fcfSub)}`), th(T.th.moat), th(T.th.growth), th(T.th.score, true), th(T.th.hold), th(T.th.add),
    ], bfHeld.map((h) => holdingRow(h, h.pk as TickerPack, ctx))));
    const baseRows = bfHeld.filter((h) => h.pk?.base);
    setHtml($('bfBase'), baseRows.length
      ? dataTable(T.baseTh.map((x, i) => th(x, i > 0)), baseRows.map((h) => tr([td(h.T), ...(h.pk?.base ?? []).map((v) => td(html`<span dir="ltr">${v}</span>`, true))])))
      : '');
    $('bfNote').textContent = T.foot(M.asof || '', {
      pe: RULES.criteria.pe.maxForward, fcf: RULES.criteria.fcf.minYieldPct, trend: Math.abs(RULES.criteria.fcf.minTrendPctPerYear),
    });
  }
  const pend = $('anaPending');
  pend.hidden = !pending.length;
  if (pending.length) setHtml(pend, html`${he.analysis.pending(pending.join(', '))}${requestLink()}`);

  // Watchlist: the user's own list, minus anything already held. Tickers without analysis are listed as such.
  const heldT = new Set(C.held.map((h) => h.T));
  const mine = ctx.P.watchlist.filter((t) => !heldT.has(t));
  const wl = mine.filter((t) => M.tickers[t]?.bf);
  const noAnalysis = mine.filter((t) => !M.tickers[t]?.bf);
  show('wlSection', mine.length > 0);
  const wlPend = $('wlPending');
  wlPend.hidden = !noAnalysis.length;
  if (noAnalysis.length) setHtml(wlPend, html`${he.watch.noAnalysis(noAnalysis.join(', '))}${requestLink()}`);
  if (!wl.length) { setHtml($('wlTable'), ''); $('wlNote').textContent = ''; }
  if (wl.length) {
    hasAny = true;
    const W = he.watch;
    setHtml($('wlTable'), dataTable([
      th(W.th.stock), th(W.th.price, true), th(W.th.pe), th(html`${W.th.fcf}${why(T.th.fcfSub)}`), th(W.th.moat), th(W.th.growth), th(W.th.score, true), th(W.th.status),
    ], wl.map((t) => {
      const pk = M.tickers[t] as TickerPack, inp = pk.bf as BfInputs, px = pk.price;
      const crit = evaluateCriteria(inp, px), cells = criteriaCells(inp, px, crit);
      const miss = watchMissing(inp, crit).map((m) => W.miss[m]);
      const added = pk.watchAdded, chg = added ? (px / added.px - 1) * 100 : null;
      const priceCell = td(html`<span dir="ltr" class="b6">${fmtUsd(px)}</span>${why(html`<span dir="ltr">${fmtNis(px * C.fx)}</span>`, 'end')}${chg !== null && added ? why(html`${W.since(added.date)}<span dir="ltr" class="${chg >= 0 ? 'c-gain' : 'c-loss'}">${(chg >= 0 ? '+' : '-') + Math.abs(chg).toFixed(1) + '%'}</span>`, 'end') : ''}`, true);
      const status = td(html`${tag('c-primary', W.tracking)}${miss.length ? why(W.missing(miss.join(' · '))) : why(W.allPass)}${inp.next ? why(W.check(inp.next)) : ''}`);
      return tr([td(html`${pk.name || t} <span class="c-muted">${t}</span>`), priceCell, cells.pe, cells.fcf, cells.moat, cells.growth, td(html`<span dir="ltr">${crit.pass}/${RULES.criteria.scoreOutOf}</span>`, true, 'b6'), status]);
    })));
    $('wlNote').textContent = W.foot(M.asof || '');
  }
  return hasAny;
}
