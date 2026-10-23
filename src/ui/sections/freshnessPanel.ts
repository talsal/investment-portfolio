import { freshness, worstLevel, type FreshnessItem } from '../../data/freshness';
import { he } from '../../i18n/he';
import { $ } from '../dom';
import type { Ctx } from '../context';
import { isoToDmy } from '../format';
import { html, setHtml } from '../html';

const fmtAsof = (a: string): string => (a.length === 7 ? `${a.slice(5, 7)}.${a.slice(0, 4)}` : isoToDmy(a));

function line(i: FreshnessItem): string {
  const L = he.freshness.line;
  const date = i.asof ? fmtAsof(i.asof) : null;
  if (i.level === 'ok') return L.ok(date as string);
  if (i.level === 'stale') return L.stale(date as string, i.ageDays ?? 0);
  if (i.level === 'unavailable') { const why = i.note ? he.freshness.reason[i.note] : undefined; return why && !date ? why : L.unavailable(date); }
  return L.missing;
}

/** "As of" line for every data group, with the worst state in the summary. Hidden for the bundled example. */
export function renderFreshness({ M, C, now }: Ctx): void {
  const panel = $('freshness');
  const items = freshness(M, now, C.held.map((h) => h.T));
  panel.hidden = !items.length;
  if (!items.length) return;
  const worst = worstLevel(items);
  $('freshSummary').textContent = he.freshness.summary[worst];
  $('freshSummary').className = worst === 'ok' ? 'c-gain' : worst === 'stale' ? 'c-sec' : 'c-loss';
  const stale = M.meta?.stalePrices ?? [];
  setHtml($('freshList'), html`${items.map((i) => html`<li class="fresh-${i.level}"><span class="fl-name">${he.freshness.label[i.id]}</span><span class="fl-val">${line(i)}${i.source && (he.freshness.source as Record<string, string>)[i.source] ? html` <span class="c-muted">· ${he.freshness.sourceLead}${(he.freshness.source as Record<string, string>)[i.source]}</span>` : ''}</span></li>`)}`);
  const sp = $('freshStale');
  const heldStale = stale.filter((s) => C.held.some((h) => h.T === s));
  sp.hidden = !heldStale.length;
  if (heldStale.length) sp.textContent = he.freshness.stalePrices(heldStale.join(', '));
}
