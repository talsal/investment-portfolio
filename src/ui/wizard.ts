import { compute } from '../calc/portfolio';
import type { MarketData, Profile } from '../calc/types';
import { he } from '../i18n/he';
import { $ } from './dom';
import { completeTicker } from './editor';
import { fmtNis } from './format';
import { html, setHtml, type Part, type Raw } from './html';

export interface WizardHooks {
  getProfile(): Profile;
  getMarket(): MarketData;
  /** A value changed: save according to the storage mode and refresh the dashboard behind the wizard. */
  onChange(): void;
  mode(): 'browser' | 'file' | null;
  /** Runs the same save / export action as the storage card buttons. */
  save(): Promise<void> | void;
  /** Called when the wizard closes (finished or skipped). */
  onClose(): void;
}

const STEPS = he.wizard.steps.length;

/**
 * Step-by-step first-run flow. It edits the same profile as the full form, so nothing is lost by skipping or
 * leaving: whatever was entered stays, and the full form shows it. No network requests, no extra storage.
 */
export function wireWizard(h: WizardHooks): { open(): void; close(): void; isOpen(): boolean } {
  const root = $('wizard');
  let step = 0;
  let open = false;

  const field = (label: string, attrs: Record<string, string>, val: string, o: { ltr?: boolean; ph?: string; hint?: Part } = {}): Raw => {
    const a = Object.entries(attrs).map(([k, v]) => html` ${k}="${v}"`);
    return html`<label class="in-f">${label}<input type="text" class="${o.ltr === false ? '' : 'n'}" inputmode="decimal" autocomplete="off" placeholder="${o.ph ?? ''}" value="${val}"${a}></label>${o.hint ?? ''}`;
  };
  const textField = (label: string, attrs: Record<string, string>, val: string, ph = '', ltr = false): Raw => {
    const a = Object.entries(attrs).map(([k, v]) => html` ${k}="${v}"`);
    return html`<label class="in-f">${label}<input type="text" autocomplete="off" ${ltr ? 'dir="ltr"' : ''} placeholder="${ph}" value="${val}"${a}></label>`;
  };

  // ---------- step bodies ----------
  function holdingsStep(P: Profile, M: MarketData): Raw {
    const W = he.wizard.holdings, F = he.editor.f;
    if (!P.rows.length) P.rows.push({ n: '', t: '', c: 'USD', ty: 'eq', q: '', k: '', p: '' });
    return html`<p class="in-hint">${W.intro}</p>${P.rows.map((r, i) => {
      const pk = M.tickers[r.t.toUpperCase().replace(/\s+/g, '')];
      const status = rowStatus(r, M);
      const a = (f: string) => ({ 'data-wz': 'rows', 'data-i': String(i), 'data-f': f });
      return html`<div class="wz-card" data-row="${i}">
        <div class="in-grid">
          ${textField(W.symbol, a('t'), r.t, W.symbolPh, true)}${textField(W.name, a('n'), r.n)}
          <label class="in-f">${W.currency}<select data-wz="rows" data-i="${i}" data-f="c">${(['USD', 'ILS', 'AGO'] as const).map((c) => html`<option value="${c}" ${r.c === c ? 'selected' : ''}>${he.editor.cur[c]}</option>`)}</select></label>
          ${field(W.qty, a('q'), r.q)}${field(W.cost, a('k'), r.k)}${field(W.price, a('p'), r.p, { ph: pk && r.c === 'USD' ? pk.price.toFixed(2) : '' })}
        </div>
        <p class="in-hint wz-status" data-status="${i}">${status}${r.t && !nzOk(r.q) ? html` ${W.incomplete}` : ''}</p>
        <button type="button" class="toggle-btn" data-wz-del="rows" data-i="${i}" aria-label="${W.remove(r.t || String(i + 1))}">${F.del} ×</button>
      </div>`;
    })}<div class="in-btns"><button type="button" class="toggle-btn" id="wzAddRow">${W.add}</button></div>`;
  }
  /** Price line under a holding: automatic price available, or a price is needed. */
  function rowStatus(r: { t: string; p: string; c: string }, M: MarketData): string {
    if (!r.t || r.p) return '';
    const pk = M.tickers[r.t.toUpperCase().replace(/\s+/g, '')];
    return pk && r.c === 'USD' ? he.wizard.holdings.priceAuto(`$${pk.price.toFixed(2)}`) : he.wizard.holdings.priceNeeded;
  }
  /** Updates the status line and price placeholder of one row in place, so focus is never lost while typing. */
  function refreshRow(i: number) {
    const P = h.getProfile(), M = h.getMarket(), r = P.rows[i];
    const card = root.querySelector(`[data-row="${i}"]`);
    if (!r || !card) return;
    const pk = M.tickers[r.t.toUpperCase().replace(/\s+/g, '')];
    const st = card.querySelector('[data-status]'); if (st) st.textContent = rowStatus(r, M) + (r.t && !nzOk(r.q) ? ` ${he.wizard.holdings.incomplete}` : '');
    const px = card.querySelector<HTMLInputElement>('[data-f="p"]'); if (px) px.placeholder = pk && r.c === 'USD' ? pk.price.toFixed(2) : '';
  }
  const nzOk = (q: string) => Number(q.replace(/,/g, '')) > 0;

  function cashStep(P: Profile): Raw {
    const W = he.wizard.cash;
    const t = (k: string) => ({ 'data-wz': 'top', 'data-f': k });
    return html`<p class="in-hint">${W.intro}</p><div class="in-grid">${field(W.usd, t('cashUsd'), P.cashUsd)}${field(W.nis, t('cashNis'), P.cashNis)}${field(W.mmf, t('mmf'), P.mmf)}${field(W.mmfCost, t('mmfCost'), P.mmfCost)}</div>`;
  }

  function fundsStep(P: Profile): Raw {
    const W = he.wizard.funds;
    const list = (g: 'gemel' | 'hish', title: string, add: string, addId: string) => html`<h3>${title}</h3>${P[g].map((r, i) => {
      const a = (f: string) => ({ 'data-wz': g, 'data-i': String(i), 'data-f': f });
      return html`<div class="wz-card"><div class="in-grid">${textField(W.name, a('n'), r.n)}${field(W.balance, a('b'), r.b)}${field(W.deposited, a('d'), r.d)}${field(W.eq, a('e'), r.e)}</div>
        <button type="button" class="toggle-btn" data-wz-del="${g}" data-i="${i}" aria-label="${W.remove}">${W.remove} ×</button></div>`;
    })}<div class="in-btns"><button type="button" class="toggle-btn" id="${addId}">${add}</button></div>`;
    return html`<p class="in-hint">${W.intro}</p>${list('gemel', W.gemel, W.addGemel, 'wzAddGemel')}${list('hish', W.hish, W.addHish, 'wzAddHish')}`;
  }

  function targetStep(P: Profile): Raw {
    const W = he.wizard.target;
    return html`<p class="in-hint">${W.intro}</p><div class="in-grid w420">${field(W.label, { 'data-wz': 'top', 'data-f': 'eqTarget' }, P.eqTarget, { ph: W.ph })}</div><p class="in-hint">${W.more}</p>`;
  }

  function saveStep(P: Profile, M: MarketData): Raw {
    const W = he.wizard.save, C = compute(P, M);
    const file = h.mode() === 'file';
    return html`<p class="in-hint">${W.intro}</p>
      <p class="b">${W.summary({ holdings: P.rows.filter((r) => r.t || r.q).length, funds: P.gemel.length + P.hish.length, total: fmtNis(C.total) })}</p>
      ${C.items.filter((x) => x.kind === 'holding').length < P.rows.filter((r) => r.t && nzOk(r.q)).length ? html`<p class="in-msg bad" id="wzNoPrice">${W.noPrice(P.rows.filter((r) => r.t && nzOk(r.q)).length - C.items.filter((x) => x.kind === 'holding').length)}</p>` : ''}
      <h3>${W.fileH}</h3><p class="in-hint">${file ? W.fileP : W.browserP}</p>
      <div class="in-btns"><button type="button" class="toggle-btn" id="wzSave">${file ? W.saveFile : W.exportBackup}</button><span class="in-status" id="wzSaved" role="status"></span></div>`;
  }

  // ---------- frame ----------
  function render(moveFocus: boolean) {
    const P = h.getProfile(), M = h.getMarket(), W = he.wizard;
    const body = [holdingsStep, cashStep, fundsStep, targetStep, saveStep][step] as (p: Profile, m: MarketData) => Raw;
    setHtml(root, html`
      <div class="wz-top"><span class="in-status" aria-live="polite">${W.progress(step + 1, STEPS)}</span>
        <button type="button" class="toggle-btn" id="wzSkipAll">${W.skipAll}</button></div>
      <h2 id="wzH" tabindex="-1">${W.steps[step]}</h2>
      <div class="wz-body">${body(P, M)}</div>
      <div class="in-btns wz-nav">
        ${step > 0 ? html`<button type="button" class="toggle-btn" id="wzBack">${W.back}</button>` : ''}
        ${step < STEPS - 1 ? html`<button type="button" class="toggle-btn wz-primary" id="wzNext">${W.next}</button>${step > 0 ? html`<button type="button" class="toggle-btn" id="wzSkip">${W.skipStep}</button>` : ''}`
          : html`<button type="button" class="toggle-btn wz-primary" id="wzFinish">${W.finish}</button>`}
      </div>`);
    if (moveFocus) $('wzH').focus();
  }

  function tidyHoldings(P: Profile) {
    // Drop rows the user never touched; keep half-filled ones (they are flagged, not deleted).
    P.rows = P.rows.filter((r) => r.t || r.n || r.q || r.k || r.p);
  }

  function go(to: number) {
    const P = h.getProfile();
    if (step === 0) tidyHoldings(P);
    step = Math.max(0, Math.min(STEPS - 1, to));
    if (step === 0 && !P.rows.length) P.rows.push({ n: '', t: '', c: 'USD', ty: 'eq', q: '', k: '', p: '' });
    h.onChange();
    render(true);
  }

  function close() {
    const P = h.getProfile();
    tidyHoldings(P);
    P.gemel = P.gemel.filter((r) => r.n || r.b || r.d || r.e);
    P.hish = P.hish.filter((r) => r.n || r.b || r.d || r.e);
    open = false;
    root.hidden = true;
    h.onChange();
    h.onClose();
  }

  // ---------- events (delegated; the step body is re-rendered, the listeners are not) ----------
  const rowOf = (el: HTMLElement): Record<string, string> | undefined => {
    const g = el.dataset.wz as 'rows' | 'gemel' | 'hish' | undefined;
    return g ? (h.getProfile()[g] as unknown as Array<Record<string, string>>)[Number(el.dataset.i)] : undefined;
  };
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.wz) return;
    if (el.dataset.wz === 'top') (h.getProfile() as unknown as Record<string, string>)[el.dataset.f as string] = el.value;
    else { const row = rowOf(el); if (row) row[el.dataset.f as string] = el.value; }
    h.onChange();
    if (el.dataset.wz === 'rows') refreshRow(Number(el.dataset.i));
  });
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.wz === 'rows' && el.dataset.f === 't') {
      const row = h.getProfile().rows[Number(el.dataset.i)];
      if (!row) return;
      completeTicker(row);
      // A name from the site's data fills in when the dictionary had none.
      if (!row.n.trim()) { const pk = h.getMarket().tickers[row.t.toUpperCase().replace(/\s+/g, '')]; if (pk?.name) row.n = pk.name; }
      el.value = row.t;
      const card = el.closest('.wz-card');
      const set = (f: string, v: string) => { const x = card?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-f="${f}"]`); if (x) x.value = v; };
      set('n', row.n); set('c', row.c);
      h.onChange();
      refreshRow(Number(el.dataset.i));
    } else if (el.dataset.wz === 'rows' && el.dataset.f === 'c') { h.onChange(); refreshRow(Number(el.dataset.i)); }
  });
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button');
    if (!t) return;
    const P = h.getProfile();
    if (t.id === 'wzNext') go(step + 1);
    else if (t.id === 'wzSkip') go(step + 1);
    else if (t.id === 'wzBack') go(step - 1);
    else if (t.id === 'wzFinish' || t.id === 'wzSkipAll') close();
    else if (t.id === 'wzAddRow') { P.rows.push({ n: '', t: '', c: 'USD', ty: 'eq', q: '', k: '', p: '' }); render(false); root.querySelectorAll<HTMLInputElement>('[data-f="t"]')[P.rows.length - 1]?.focus(); }
    else if (t.id === 'wzAddGemel') { P.gemel.push({ n: '', b: '', d: '', e: '', r: '' }); render(false); }
    else if (t.id === 'wzAddHish') { P.hish.push({ n: '', b: '', d: '', e: '', r: '' }); render(false); }
    else if (t.id === 'wzSave') void Promise.resolve(h.save()).then(() => { $('wzSaved').textContent = he.wizard.save.saved; });
    else if (t.dataset.wzDel) { (P[t.dataset.wzDel as 'rows' | 'gemel' | 'hish'] as unknown[]).splice(Number(t.dataset.i), 1); h.onChange(); render(false); }
  });

  return {
    open() { open = true; step = 0; root.hidden = false; const P = h.getProfile(); if (!P.rows.length) P.rows.push({ n: '', t: '', c: 'USD', ty: 'eq', q: '', k: '', p: '' }); render(true); },
    close,
    isOpen: () => open,
  };
}
