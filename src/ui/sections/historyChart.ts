import { buildHistory, investedSteps, type HistoryResult } from '../../calc/history';
import { he } from '../../i18n/he';
import { $, dataTable, show, td, th, tr } from '../dom';
import type { Ctx } from '../context';
import { fmtNis, fmtUsd, iso, isoDm } from '../format';
import { esc, html, raw, setHtml, type Raw } from '../html';

type Mode = 'ils' | 'usd';
let mode: Mode = 'ils';
let onModeChange: () => void = () => {};
/** Chart drawing width in px: follows the container (so text stays readable on phones), capped at the design width. */
const MAX_W = 640, MIN_W = 300, LABEL_PX = 71;
const chartWidth = (): number => Math.max(MIN_W, Math.min(MAX_W, Math.round($('hsChart').clientWidth || MAX_W)));
let drawnW = 0;

export function bindHistoryModes(rerender: () => void): void {
  onModeChange = rerender;
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (drawnW && Math.abs(chartWidth() - drawnW) > 16) onModeChange(); }).observe($('hsChart'));
  }
  const set = (m: Mode) => {
    mode = m;
    $('hsBtnIls').setAttribute('aria-pressed', String(m === 'ils'));
    $('hsBtnUsd').setAttribute('aria-pressed', String(m === 'usd'));
    onModeChange();
  };
  $('hsBtnIls').addEventListener('click', () => set('ils'));
  $('hsBtnUsd').addEventListener('click', () => set('usd'));
}

const tOf = (k: string): number => { const p = k.split('-').map(Number) as [number, number, number]; return Date.UTC(p[0], p[1] - 1, p[2]); };
const CANDIDATE_STEPS = [100, 200, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 250000, 500000, 1000000];

/** Returns true when the section is shown. */
export function renderHistory({ P, M, C }: Ctx): boolean {
  const h = buildHistory(P, M, C.fx);
  show('hsSection', !!h);
  if (!h) return false;
  draw(h);
  return true;
}

function draw(h: HistoryResult): void {
  const T = he.history;
  const ils = mode === 'ils';
  const S = ils ? h.ils : h.usd, gr = ils ? h.grossIls : h.grossUsd;
  const dates = h.dates, N = dates.length, last = N - 1;
  const fmtCur = (v: number) => (ils ? fmtNis(v) : fmtUsd(v));
  const fmtSgn = (v: number) => (v >= 0 ? '+' : '−') + fmtCur(Math.abs(v));
  const fmtK = (v: number) => (ils ? '₪' : '$') + (v >= 1000 ? v / 1000 + 'K' : v);
  const hDate = (i: number) => isoDm(dates[i] as string);
  const hPct = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
  const col = (v: number) => (v >= 0 ? 'c-gain' : 'c-loss');
  const V = S.val[last] as number, A = S.alt[last] as number, I = S.inv[last] as number;
  const vRet = gr > 0 ? ((V - I) / gr) * 100 : 0, aRet = gr > 0 ? ((A - I) / gr) * 100 : 0, gap = V - A;
  const sp = T.summary({
    from: hDate(0), to: hDate(last), net: fmtCur(I), gross: fmtCur(gr), val: fmtCur(V), profit: fmtSgn(V - I), profitPct: hPct(vRet),
    alt: fmtCur(A), altProfit: fmtSgn(A - I), altPct: hPct(aRet), gap: fmtSgn(gap), spyWins: gap < 0,
  }).parts;
  setHtml($('hsSummary'), html`${sp[0]}<span dir="ltr" class="b6 ${col(V - I)}">${sp[1]}</span>${sp[2]}<span dir="ltr" class="b6 ${col(A - I)}">${sp[3]}</span>${sp[4]}<span dir="ltr" class="b6 ${col(gap)}">${sp[5]}</span>${sp[6]}`);

  const W = chartWidth(), Hh = 300, mL = 44, mR = 14, mT = 14, mB = 28, pw = W - mL - mR, ph = Hh - mT - mB;
  drawnW = W;
  const hsT0 = tOf(dates[0] as string), hsEnd = Math.max(tOf(dates[last] as string), hsT0 + 86400000), hsT1 = hsEnd + ((hsEnd - hsT0) * LABEL_PX) / (pw - LABEL_PX);
  const steps = investedSteps(h, ils);
  const hiV = Math.max(1, ...S.val, ...S.alt, ...S.inv);
  let step = CANDIDATE_STEPS[CANDIDATE_STEPS.length - 1] as number;
  for (const c of CANDIDATE_STEPS) { if (c >= hiV / 5) { step = c; break; } }
  const yMin = 0, yMax = Math.ceil((hiV * 1.04) / step) * step;
  const X = (i: number) => mL + ((tOf(dates[i] as string) - hsT0) / (hsT1 - hsT0)) * pw;
  const XD = (k: string) => mL + ((tOf(k) - hsT0) / (hsT1 - hsT0)) * pw;
  const Y = (v: number) => mT + ((yMax - v) / (yMax - yMin)) * ph;
  const path = (arr: number[]) => arr.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('');
  const stepPath = steps.map((p, i) => (i ? 'L' : 'M') + XD(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');

  let svg = '';
  for (let gv = yMin; gv <= yMax + 0.001; gv += step) {
    svg += `<line class="hs-grid" x1="${mL}" x2="${W - mR}" y1="${Y(gv).toFixed(1)}" y2="${Y(gv).toFixed(1)}"/><text x="${mL - 6}" y="${(Y(gv) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtK(gv))}</text>`;
  }
  const d0 = new Date(hsT0), months: Array<[number, number]> = [];
  for (let my = d0.getUTCFullYear(), mm = d0.getUTCMonth() + 1; Date.UTC(my, mm, 1) <= hsEnd; mm++) {
    if (mm > 11) { mm = 0; my++; }
    months.push([my, mm]);
    if (months.length > 60) break;
  }
  const everyN = Math.max(1, Math.ceil(months.length / (W < 500 ? 4 : 8)));
  months.forEach((m, k) => {
    const mx = mL + ((Date.UTC(m[0], m[1], 1) - hsT0) / (hsT1 - hsT0)) * pw;
    svg += `<line class="hs-grid" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${Hh - mB}" y2="${Hh - mB + 4}"/>`;
    if (k % everyN === 0) svg += `<text x="${mx.toFixed(1)}" y="${Hh - 8}" text-anchor="middle">${esc(T.months[m[1]] as string)}${m[1] === 0 ? ' ' + String(m[0]).slice(2) : ''}</text>`;
  });
  svg += `<path class="hs-invl" d="${stepPath}"/><path class="hs-spy" d="${path(S.alt)}"/><path class="hs-basket" d="${path(S.val)}"/>`;
  const labels = [
    { k: T.labelActual, v: V, y: Y(V), strong: true, cls: 'dot-actual' },
    { k: T.labelSpy, v: A, y: Y(A), strong: false, cls: 'dot-spy' },
    { k: T.labelNet, v: I, y: Y(I), strong: false, cls: 'dot-inv' },
  ].sort((a, b) => a.y - b.y);
  let ly = labels.map((l) => l.y);
  for (let li = 1; li < ly.length; li++) { if ((ly[li] as number) - (ly[li - 1] as number) < 27) ly[li] = (ly[li - 1] as number) + 27; }
  const shift = Math.max(0, (ly[ly.length - 1] as number) - (Hh - mB - 8));
  ly = ly.map((y) => y - shift);
  labels.forEach((l, idx) => {
    svg += `<circle class="hs-ring ${l.cls}" cx="${X(last).toFixed(1)}" cy="${l.y.toFixed(1)}" r="4"/><text class="${l.strong ? 'hs-lbl-strong' : ''}" x="${(X(last) + 9).toFixed(1)}" y="${((ly[idx] as number) - 1).toFixed(1)}">${esc(l.k)}</text><text x="${(X(last) + 9).toFixed(1)}" y="${((ly[idx] as number) + 11).toFixed(1)}">${ils ? '₪' : '$'}${(l.v / 1000).toFixed(1)}K</text>`;
  });
  svg += `<line id="hsCur" class="hs-grid hs-cur" x1="0" x2="0" y1="${mT}" y2="${Hh - mB}" visibility="hidden"/><circle id="hsDotS" class="hs-ring dot-spy" r="4" visibility="hidden"/><circle id="hsDotB" class="hs-ring dot-actual" r="4" visibility="hidden"/><circle id="hsDotI" class="hs-ring dot-inv" r="3.5" visibility="hidden"/><rect id="hsHit" class="hs-hit" x="${mL}" y="${mT}" width="${pw}" height="${ph}" fill="transparent" tabindex="0" role="application" aria-label="${esc(T.aria)}"/>`;
  setHtml($('hsChart'), raw(`<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(T.aria)}">${svg}</svg><div class="hs-tip" id="hsTip"></div>`));

  const wrap = $('hsChart');
  const svgEl = wrap.querySelector('svg') as SVGSVGElement, tip = $('hsTip');
  const cur = $('hsCur') as unknown as SVGElement, dotS = $('hsDotS') as unknown as SVGElement, dotB = $('hsDotB') as unknown as SVGElement, dotI = $('hsDotI') as unknown as SVGElement;
  const marks = [cur, dotS, dotB, dotI];
  let idx = last;
  function showAt(i: number, clientX?: number) {
    idx = i;
    cur.setAttribute('x1', String(X(i))); cur.setAttribute('x2', String(X(i)));
    dotS.setAttribute('cx', String(X(i))); dotS.setAttribute('cy', String(Y(S.alt[i] as number)));
    dotB.setAttribute('cx', String(X(i))); dotB.setAttribute('cy', String(Y(S.val[i] as number)));
    dotI.setAttribute('cx', String(X(i))); dotI.setAttribute('cy', String(Y(S.inv[i] as number)));
    marks.forEach((e) => e.setAttribute('visibility', 'visible'));
    setHtml(tip, html`<b dir="ltr">${hDate(i)}.${(dates[i] as string).slice(0, 4)}</b><br>${T.tipActual}<span dir="ltr">${fmtCur(S.val[i] as number)}</span><br><span dir="ltr">${T.labelSpy}: ${fmtCur(S.alt[i] as number)}</span><br>${T.tipNet}<span dir="ltr">${fmtCur(S.inv[i] as number)}</span>`);
    tip.style.display = 'block';
    const r = svgEl.getBoundingClientRect();
    const px = (X(i) / W) * r.width, tw = tip.offsetWidth;
    tip.style.left = `${px > r.width / 2 ? px - tw - 12 : px + 12}px`;
    void clientX;
  }
  function leave() { tip.style.display = 'none'; marks.forEach((e) => e.setAttribute('visibility', 'hidden')); }
  function nearest(clientX: number): number {
    const r = svgEl.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W, tt = hsT0 + ((x - mL) / pw) * (hsT1 - hsT0);
    let best = Infinity, bi = 0;
    for (let j = 0; j < N; j++) { const dj = Math.abs(tOf(dates[j] as string) - tt); if (dj < best) { best = dj; bi = j; } }
    return bi;
  }
  const hit = $('hsHit');
  hit.addEventListener('pointermove', (e) => showAt(nearest((e as PointerEvent).clientX)));
  hit.addEventListener('pointerdown', (e) => showAt(nearest((e as PointerEvent).clientX)));
  hit.addEventListener('pointerleave', leave);
  hit.addEventListener('blur', leave);
  hit.addEventListener('focus', () => showAt(idx));
  hit.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    // The chart is drawn left-to-right (time flows rightwards), so ArrowRight moves later.
    if (k === 'ArrowRight') showAt(Math.min(last, idx + 1));
    else if (k === 'ArrowLeft') showAt(Math.max(0, idx - 1));
    else if (k === 'Home') showAt(0);
    else if (k === 'End') showAt(last);
    else return;
    e.preventDefault();
  });

  const gaps = S.val.map((v, i) => v - (S.alt[i] as number));
  let iMax = 0, iMin = 0;
  gaps.forEach((v, i) => { if (v > (gaps[iMax] as number)) iMax = i; if (v < (gaps[iMin] as number)) iMin = i; });
  $('hsGap').textContent = T.gap(iso(fmtSgn(gaps[iMax] as number)), hDate(iMax), iso(fmtSgn(gaps[iMin] as number)), hDate(iMin));
  const lt = (v: Raw | string) => html`<span dir="ltr">${v}</span>`;
  setHtml($('hsTable'), dataTable(T.th.map((x, i) => th(x, i > 0)), dates.map((k, i) =>
    tr([td(lt(`${hDate(i)}.${k.slice(0, 4)}`)), td(lt(fmtCur(S.val[i] as number)), true), td(lt(fmtCur(S.alt[i] as number)), true), td(lt(fmtCur(S.inv[i] as number)), true),
      td(html`<span dir="ltr" class="${col((S.val[i] as number) - (S.alt[i] as number))}">${fmtSgn((S.val[i] as number) - (S.alt[i] as number))}</span>`, true)])).reverse()));
  setHtml($('hsTrades'), dataTable(T.tradesTh.map((x, i) => th(x, i > 2)), h.trades.map((t) =>
    tr([td(lt(`${isoDm(t[0])}.${t[0].slice(0, 4)}`)), td(t[1]), td(t[2] === 'B' ? T.buy : T.sell), td(String(t[3]), true), td(fmtUsd(t[4]), true), td(fmtUsd(t[3] * t[4]), true)]))));
  $('hsNote').textContent = T.foot(h.skipped);
}
