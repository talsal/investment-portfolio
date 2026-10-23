import { tradingReturn } from '../../calc/returns';
import type { Item } from '../../calc/portfolio';
import { RULES } from '../../config/rules';
import { he } from '../../i18n/he';
import { $, dataTable, show, td, th, tr } from '../dom';
import type { Ctx } from '../context';
import { fmtNis, fmtPct, fmtUsd, iso, sgnMinus } from '../format';
import { html, rich, setHtml, type Raw } from '../html';

const SVG_NS = 'http://www.w3.org/2000/svg';
const cx = 160, cy = 160, rO = 150, rI = 92, gap = 1.6;

function polar(r: number, a: number) {
  const t = ((a - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
}
function arc(s: number, e: number): string {
  s += gap / 2; e -= gap / 2; if (e < s) e = s;
  const big = e - s > 180 ? 1 : 0;
  const p0 = polar(rO, s);
  let p1 = polar(rO, e), p2 = polar(rI, e);
  const p3 = polar(rI, s);
  if (e - s > 359.5) { e = s + 359.5; p1 = polar(rO, e); p2 = polar(rI, e); }
  return ['M', p0.x, p0.y, 'A', rO, rO, 0, big, 1, p1.x, p1.y, 'L', p2.x, p2.y, 'A', rI, rI, 0, big, 0, p3.x, p3.y, 'Z'].join(' ');
}

const itemName = (d: Item): string => (d.kind === 'mmf' ? he.app.mmf : d.kind === 'cash' ? he.app.cash : d.name || he.app.unnamed);
/** Ticker shown next to the name, unless it just repeats it. */
const tickerOf = (d: Item): string => (d.ticker && d.ticker.toUpperCase() !== itemName(d).toUpperCase() ? d.ticker : '');

function gainHtml(d: Item): Raw {
  if (d.gain === null) return html`<span class="lg-gain na">${he.trade.gainNone}</span>`;
  return html`<span class="lg-gain ${d.gain >= 0 ? 'pos' : 'neg'}">${he.trade.gainLabel}<span dir="ltr">${(d.gain >= 0 ? '+' : '') + d.gain.toFixed(2)}%</span></span>`;
}

function svgText(parent: Element, x: number, y: number, cls: string, text: string): void {
  const t = document.createElementNS(SVG_NS, 'text');
  t.setAttribute('x', String(x)); t.setAttribute('y', String(y)); t.setAttribute('class', cls);
  t.textContent = text;
  parent.appendChild(t);
}

export function renderPie({ P, C, now }: Ctx): void {
  show('trSection', C.tradeTotal > 0);
  if (!(C.tradeTotal > 0)) return;
  const svg = $('pie'), lg = $('legend'), tip = $('tooltip');
  svg.innerHTML = ''; lg.innerHTML = '';
  const sorted = C.items.slice().sort((a, b) => b.valNis - a.valNis);
  const tot = C.tradeTotal;
  let ang = 0;

  const setActive = (id: string, on: boolean) => {
    document.querySelectorAll(`[data-id="${id}"]`).forEach((el) => el.classList.toggle('hover', on));
    document.querySelectorAll('.slice').forEach((el) => el.classList.toggle('dim', on && el.getAttribute('data-id') !== id));
  };
  const moveTip = (ev: MouseEvent) => {
    let x = ev.clientX + 16, y = ev.clientY + 16;
    if (x + 230 > window.innerWidth) x = ev.clientX - 230;
    if (y + 90 > window.innerHeight) y = ev.clientY - 90;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  };

  sorted.forEach((d, i) => {
    const id = `s${i}`, slot = (i % 9) + 1, pct = (d.valNis / tot) * 100;
    const st = ang, en = ang + (pct / 100) * 360;
    ang = en;
    const name = itemName(d), tk = tickerOf(d);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', arc(st, en)); path.setAttribute('class', `slice s${slot}`); path.setAttribute('data-id', id);
    // The SVG itself is an image with a label; the focusable legend rows and the table are the accessible equivalents.
    path.setAttribute('aria-hidden', 'true');
    const showTip = (e: MouseEvent | null) => {
      setActive(id, true);
      setHtml(tip, html`<div class="t-name"><span class="t-swatch bg${slot}"></span>${name}${tk ? ` (${tk})` : ''}</div><div class="t-row">${he.trade.tipValue(fmtNis(d.valNis), fmtUsd(d.valNis / C.fx))}</div><div class="t-row">${he.trade.tipWeight(fmtPct(pct))}</div><div class="t-row">${gainHtml(d)}</div>`);
      tip.hidden = false;
      if (e) moveTip(e);
    };
    path.addEventListener('mouseenter', (e) => showTip(e));
    path.addEventListener('mousemove', moveTip);
    path.addEventListener('mouseleave', () => { setActive(id, false); tip.hidden = true; });
    svg.appendChild(path);
    if (pct >= 8) {
      const lp = polar((rO + rI) / 2, (st + en) / 2);
      svgText(svg, lp.x, lp.y, 'slice-label', Math.round(pct) + '%');
    }
    const li = document.createElement('li');
    li.setAttribute('data-id', id);
    li.tabIndex = 0;
    li.setAttribute('aria-label', `${name}${tk ? ` (${tk})` : ''}: ${fmtPct(pct)}, ${fmtNis(d.valNis)}`);
    setHtml(li, html`<span class="swatch bg${slot}"></span><span class="lg-text"><span class="lg-name">${name}${tk ? html` <span class="c-muted">${tk}</span>` : ''}</span><span class="lg-sub">${fmtNis(d.valNis)}</span><span class="lg-sub">${gainHtml(d)}</span></span><span class="lg-pct"><span class="lg-pct-l">${he.trade.weight}</span>${fmtPct(pct)}</span>`);
    li.addEventListener('mouseenter', () => setActive(id, true));
    li.addEventListener('mouseleave', () => setActive(id, false));
    li.addEventListener('focus', () => setActive(id, true));
    li.addEventListener('blur', () => setActive(id, false));
    lg.appendChild(li);
  });

  svgText(svg, cx, cy - 52, 'center-label total-caption', he.trade.centerCaption);
  svgText(svg, cx, cy - 30, 'center-label total-usd', fmtNis(tot));
  svgText(svg, cx, cy - 13, 'center-label total-nis', fmtUsd(tot / C.fx));

  const sum = $('trSummary');
  sum.textContent = '';
  const ret = tradingReturn(C, P, now.getTime());
  if (ret) {
    const { inv, cur, cum, ann, avgDays } = ret;
    const pos = cur >= inv;
    svgText(svg, cx, cy + 8, 'center-label tr-lbl', he.trade.centerReturn);
    svgText(svg, cx, cy + 26, `center-label tr-cum ${pos ? 'pos' : 'neg'}`, he.trade.centerProfit((pos ? '+' : '−') + fmtNis(Math.abs(cur - inv))));
    svgText(svg, cx, cy + 43, `center-label tr-cum ${cum >= 0 ? 'pos' : 'neg'}`, he.trade.centerCum(sgnMinus(cum)));
    if (ann !== null) svgText(svg, cx, cy + 60, `center-label tr-ann ${ann >= 0 ? 'pos' : 'neg'}`, he.trade.centerAnn(sgnMinus(ann)));
    setHtml(sum, rich(he.trade.summary({
      cum: iso(sgnMinus(cum)), gain: pos, amt: fmtNis(Math.abs(cur - inv)), inv: fmtNis(inv), ann: ann !== null ? iso(sgnMinus(ann)) : null,
      days: Math.round(avgDays), minDays: RULES.annualization.minHoldingDays,
    })));
  }

  setHtml($('tableView'), dataTable(he.trade.th.map((h, i) => th(h, i > 0)), [
    ...sorted.map((d) => tr([td(html`${itemName(d)}${tickerOf(d) ? ` (${tickerOf(d)})` : ''}`), td(fmtNis(d.valNis), true), td(fmtPct((d.valNis / tot) * 100), true), td(gainHtml(d), true)])),
    tr([td(he.trade.totalRow), td(fmtNis(tot), true), td('100.0%', true), td('-', true)], 'total-row'),
  ]));
}
