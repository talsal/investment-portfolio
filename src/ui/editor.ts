import type { Profile } from '../calc/types';
import { RULES } from '../config/rules';
import { he } from '../i18n/he';
import { TICKER_NAMES } from '../i18n/tickerNames';
import { $ } from './dom';
import { html, raw, setHtml, type Part, type Raw } from './html';

const AUTO_NAMES = new Set(Object.values(TICKER_NAMES));
const nameFor = (t: string): string => {
  const k = t.toUpperCase().replace(/\s+/g, '');
  return Object.prototype.hasOwnProperty.call(TICKER_NAMES, k) ? (TICKER_NAMES[k] as string) : '';
};

const field = (cls: string, label: string, attrs: Record<string, string>, val: string, extra = ''): Raw => {
  const a = Object.entries(attrs).map(([k, v]) => html` ${k}="${v}"`);
  return html`<label class="in-f ${extra}">${label}<input class="${cls}" type="text" autocomplete="off" ${cls === 'n' ? raw('inputmode="decimal"') : ''}${a} value="${val}"></label>`;
};
const select = (label: string, attrs: Record<string, string>, opts: Array<[string, string]>, cur: string): Raw => {
  const a = Object.entries(attrs).map(([k, v]) => html` ${k}="${v}"`);
  return html`<label class="in-f">${label}<select${a}>${opts.map(([v, t]) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`)}</select></label>`;
};
const delBtn = (g: string, i: number): Raw => html`<button type="button" class="toggle-btn in-x" data-del="${g}" data-i="${i}" aria-label="${he.editor.f.del}">×</button>`;

type G = 'rows' | 'gemel' | 'hish' | 'trades';
const attr = (g: G, i: number, f: string, extra: Record<string, string> = {}) => ({ 'data-g': g, 'data-i': String(i), 'data-f': f, ...extra });

/** Rebuilds the repeating rows from the profile (called on load, add, delete, import, clear). */
export function buildEditor(P: Profile): void {
  const F = he.editor.f, E = he.editor;
  setHtml($('inRows'), html`${P.rows.map((r, i) => html`<div class="in-row">${[
    field('', F.name, attr('rows', i, 'n', { placeholder: F.namePh }), r.n, 'in-wide'),
    field('', F.ticker, attr('rows', i, 't', { dir: 'ltr', placeholder: F.tickerPh }), r.t),
    select(F.currency, attr('rows', i, 'c'), [['USD', E.cur.USD], ['ILS', E.cur.ILS], ['AGO', E.cur.AGO]], r.c),
    select(F.type, attr('rows', i, 'ty'), [['eq', E.type.eq], ['bond', E.type.bond], ['other', E.type.other]], r.ty),
    field('n', F.qty, attr('rows', i, 'q'), r.q), field('n', F.cost, attr('rows', i, 'k'), r.k), field('n', F.price, attr('rows', i, 'p'), r.p),
    delBtn('rows', i),
  ] as Part[]}</div>`)}`);
  for (const g of ['gemel', 'hish'] as const) {
    setHtml($(g === 'gemel' ? 'inGemel' : 'inHish'), html`${P[g].map((r, i) => html`<div class="in-row g">${[
      field('', F.nameFund, attr(g, i, 'n'), r.n, 'in-wide'), field('n', F.balance, attr(g, i, 'b'), r.b), field('n', F.deposited, attr(g, i, 'd'), r.d),
      field('n', F.eqPct, attr(g, i, 'e'), r.e), field('n', F.yearly, attr(g, i, 'r'), r.r), delBtn(g, i),
    ] as Part[]}</div>`)}`);
  }
  setHtml($('inTrades'), html`${P.trades.map((r, i) => html`<div class="in-row t">${[
    html`<label class="in-f">${F.date}<input class="n" type="date" data-g="trades" data-i="${i}" data-f="d" value="${r.d}"></label>`,
    field('', F.symbol, attr('trades', i, 't', { dir: 'ltr' }), r.t),
    select(F.action, attr('trades', i, 's'), [['B', E.side.B], ['S', E.side.S]], r.s),
    field('n', F.qty, attr('trades', i, 'q'), r.q), field('n', F.priceUsd, attr('trades', i, 'p'), r.p), delBtn('trades', i),
  ] as Part[]}</div>`)}`);
  setHtml($('inWatch'), html`${P.watchlist.map((t, i) => html`<span class="chip">${t}<button type="button" data-del="watchlist" data-i="${i}" aria-label="${he.watchlistEditor.remove(t)}">×</button></span>`)}`);
  syncTopFields(P);
}

export function syncTopFields(P: Profile): void {
  document.querySelectorAll<HTMLInputElement>('[data-top]').forEach((el) => { el.value = P[el.dataset.top as 'fx'] ?? ''; });
  document.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((el) => { el.value = (P.settings as unknown as Record<string, string>)[el.dataset.setting as string] ?? ''; });
}

export function setMsg(text: string, bad = false): void {
  const m = $('inMsg');
  m.textContent = text;
  m.className = 'in-msg' + (bad ? ' bad' : '');
}

export interface EditorHooks {
  /** Values changed in place (no row structure change): save and re-render. */
  onEdit(): void;
  /** Row added/removed: rebuild the editor, save and re-render. */
  onStructure(): void;
}

/** Wires delegated events on the editor card. The profile object is mutated in place. */
export function wireEditor(P: () => Profile, hooks: EditorHooks): void {
  const card = $('inCard');
  card.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const top = t.dataset.top, g = t.dataset.g, setting = t.dataset.setting;
    if (top) (P() as unknown as Record<string, string>)[top] = t.value;
    else if (setting) (P().settings as unknown as Record<string, string>)[setting] = t.value;
    else if (g) { const row = (P()[g as G] as unknown as Array<Record<string, string>>)[Number(t.dataset.i)]; if (row) row[t.dataset.f as string] = t.value; }
    else return;
    hooks.onEdit();
  });
  card.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const g = t.dataset.g as G | undefined, f = t.dataset.f;
    if (!g) return;
    const i = Number(t.dataset.i);
    if (g === 'rows' && f === 't') {
      const row = P().rows[i];
      if (!row) return;
      row.t = t.value.trim().toUpperCase();
      t.value = row.t;
      const nm = nameFor(row.t), cur = (row.n || '').trim(), isIl = /^\d{5,9}$/.test(row.t.replace(/\s+/g, ''));
      if (isIl) {
        row.t = row.t.replace(/\s+/g, '');
        t.value = row.t;
        if (row.c === 'USD') row.c = 'ILS';
        const ci = document.querySelector<HTMLSelectElement>(`[data-g="rows"][data-i="${i}"][data-f="c"]`);
        if (ci) ci.value = row.c;
      }
      const note = isIl ? he.editor.ilNote : '';
      if (nm && (cur === '' || AUTO_NAMES.has(cur))) {
        row.n = nm;
        const ni = document.querySelector<HTMLInputElement>(`[data-g="rows"][data-i="${i}"][data-f="n"]`);
        if (ni) ni.value = nm;
        setMsg(he.editor.nameFilled(nm) + note);
      } else if (!nm && row.t && cur === '') setMsg(he.editor.unknownTicker(isIl, row.t) + note);
      else if (note) setMsg(note.trim());
      hooks.onEdit();
      return;
    }
    if (g === 'trades' && f === 't') {
      const tr = P().trades[i];
      if (tr) { tr.t = t.value.trim().toUpperCase(); t.value = tr.t; hooks.onEdit(); }
      return;
    }
    if (t.tagName !== 'SELECT') return;
    const row2 = (P()[g] as unknown as Array<Record<string, string>>)[i];
    if (row2) { row2[f as string] = t.value; hooks.onEdit(); }
  });
  card.addEventListener('click', (e) => {
    const d = (e.target as HTMLElement).dataset?.del as G | 'watchlist' | undefined;
    if (!d) return;
    (P()[d] as unknown[]).splice(Number((e.target as HTMLElement).dataset.i), 1);
    hooks.onStructure();
  });
  const addWatch = () => {
    const input = $<HTMLInputElement>('watchNew');
    const t = input.value.trim().toUpperCase().replace(/\s+/g, '');
    input.value = '';
    const list = P().watchlist;
    if (!t || list.includes(t) || list.length >= RULES.limits.watchlist) return;
    list.push(t);
    hooks.onStructure();
  };
  $('addWatch').addEventListener('click', addWatch);
  $('watchNew').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); addWatch(); } });
  const add = (id: string, fn: () => void) => $(id).addEventListener('click', () => { fn(); hooks.onStructure(); });
  add('addRow', () => P().rows.push({ n: '', t: '', c: 'USD', ty: 'eq', q: '', k: '', p: '' }));
  add('addGemel', () => P().gemel.push({ n: '', b: '', d: '', e: '', r: '' }));
  add('addHish', () => P().hish.push({ n: '', b: '', d: '', e: '', r: '' }));
  add('addTrade', () => P().trades.push({ d: '', t: '', s: 'B', q: '', p: '' }));
}
