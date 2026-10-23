import { compute } from '../calc/portfolio';
import type { MarketData, Profile } from '../calc/types';
import { loadExampleBundle } from '../data/legacyPack';
import { DataLoader } from '../data/loader';
import { he } from '../i18n/he';
import { blankProfile, sanitizeProfile } from '../profile/schema';
import { browserDeps } from '../storage/browserDeps';
import { StorageController } from '../storage/controller';
import { loadTheme, saveTheme, type Theme } from '../storage/browserStore';
import { $, show } from './dom';
import { buildEditor, setMsg, syncTopFields, wireEditor } from './editor';
import type { Ctx } from './context';
import { buildShell } from './shell';
import { buildCashFlowInputs, renderCashFlow } from './sections/cashflow';
import { renderAnalysis } from './sections/criteria';
import { bindHistoryModes, renderHistory } from './sections/historyChart';
import { renderPie } from './sections/pie';
import { renderBenchmark, renderDividends, renderEquity, renderAnnual, renderEvents, renderProfitTotal, renderTotals } from './sections/summary';
import { renderFreshness } from './sections/freshnessPanel';
import { renderWithdrawal, syncWithdrawalInputs } from './sections/withdrawal';
import { wireStorageUi } from './storageUi';

type View = 'chooser' | 'gate' | 'workspace';

export async function startApp(root: HTMLElement): Promise<void> {
  buildShell(root);
  applyTheme(loadTheme());
  const ctrl = new StorageController(browserDeps());
  let P: Profile = blankProfile();
  const loader = new DataLoader();
  let exampleMarket: MarketData | null = null;
  const market = (): MarketData => (P.settings.example && exampleMarket ? exampleMarket : loader.market());

  /** Loads per-ticker data files for what the user holds, traded or follows; re-renders when something new arrived. */
  function ensureData() {
    const held = P.rows.filter((r) => r.c === 'USD').map((r) => r.t.toUpperCase().replace(/\s+/g, ''));
    const traded = P.trades.map((t) => t.t);
    void loader.ensure({ held, traded, watch: P.watchlist }).then((changed) => { if (changed) render(); });
  }
  const setStatus = (t: string) => { $('inStatus').textContent = t; };

  let firstView = true;
  function showView(v: View) {
    show('modeChooser', v === 'chooser');
    show('fileGate', v === 'gate');
    show('workspace', v === 'workspace');
    // Keyboard and screen-reader users: move focus to the new view's heading (not on first paint).
    if (!firstView) {
      const target = v === 'chooser' ? $('chooserH') : v === 'gate' ? $('gateH') : document.querySelector<HTMLElement>('h1');
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: false }); }
    }
    firstView = false;
  }

  function render() {
    const M = market();
    const C = compute(P, M);
    const ctx: Ctx = { P, M, C, now: new Date() };
    $('subtitle').textContent = C.total > 0 ? he.app.subtitle(C.fx.toFixed(4), C.fxManual, M.asof || '') : he.app.subtitleEmpty;
    show('outEmpty', !(C.total > 0));
    show('outMain', C.total > 0);
    if (C.total > 0) {
      renderTotals(ctx); renderProfitTotal(ctx); renderPie(ctx); renderEquity(ctx); renderAnnual(ctx); renderWithdrawal(ctx);
    }
    let any = renderAnalysis(ctx);
    renderDividends(ctx); renderBenchmark(ctx); renderEvents(ctx);
    any = renderHistory(ctx) || any || !$('divSection').hidden || !$('bmSection').hidden || !$('evSection').hidden;
    show('anaTitle', any);
    renderCashFlow(ctx);
    renderFreshness(ctx);
    $('demoNotice').hidden = !M.demo;
  }

  function rebuild() { buildEditor(P); buildCashFlowInputs(P); syncWithdrawalInputs(P); syncTopFields(P); }

  ctrl.onPersistChange = () => ui.refresh();
  const ui = wireStorageUi(ctrl, {
    getProfile: () => P,
    applyProfile(next, markChanged) {
      P = next;
      rebuild();
      if (P.settings.example && !exampleMarket) void loadExampleBundle().then((b) => { exampleMarket = b.market; render(); });
      if (markChanged) afterEdit(); else { render(); ui.refresh(); ensureData(); }
    },
    showState: showView,
    setStatus,
    blank: blankProfile,
  });

  /** Every change to the profile goes through here: persist according to the storage mode, then re-render. */
  function afterEdit() {
    if (ctrl.mode === 'browser') {
      setStatus(he.editor.saving);
      ctrl.noteEdit(() => P, (ok) => { setStatus(ok ? he.editor.saved : he.editor.saveFailed); ui.refresh(); });
    } else if (ctrl.mode === 'file') {
      ctrl.noteEdit(() => P, () => {});
      setStatus(he.storage.status.fileDirty);
    }
    render();
    ui.refresh();
    ensureData();
  }

  wireEditor(() => P, { onEdit: afterEdit, onStructure: () => { buildEditor(P); afterEdit(); } });
  bindHistoryModes(render);

  $('toggleTable').addEventListener('click', function (this: HTMLElement) {
    const view = $('tableView');
    const showIt = view.hidden;
    view.hidden = !showIt;
    this.setAttribute('aria-expanded', String(showIt));
    this.textContent = showIt ? he.trade.hideTable : he.trade.showTable;
  });
  $('cfInputs').addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.cf;
    if (!k) return;
    (P.cf as unknown as Record<string, string>)[k] = el.value;
    afterEdit();
  });
  $('cfClear').addEventListener('click', () => { P.cf = blankProfile().cf; buildCashFlowInputs(P); afterEdit(); });
  document.querySelectorAll<HTMLInputElement>('[data-wd]').forEach((el) => el.addEventListener('input', () => {
    P.withdrawal[el.dataset.wd as 'years' | 'realRate'] = el.value;
    afterEdit();
  }));

  $('btnExample').addEventListener('click', async () => {
    const ex = await loadExampleBundle();
    exampleMarket = ex.market;
    P = sanitizeProfile(ex.profile);
    P.settings.example = true;
    rebuild();
    afterEdit();
    setMsg(he.editor.exampleLoaded);
  });
  let armed = false;
  $('btnClear').addEventListener('click', function (this: HTMLElement) {
    if (!armed) {
      armed = true;
      this.textContent = he.editor.clearConfirm;
      setTimeout(() => { armed = false; this.textContent = he.editor.clearAll; }, 6000);
      return;
    }
    armed = false;
    this.textContent = he.editor.clearAll;
    P = blankProfile();
    rebuild();
    afterEdit();
    setMsg(he.editor.cleared);
  });

  let theme: Theme = loadTheme();
  const themeBtn = $('btnTheme');
  const paintTheme = () => { themeBtn.textContent = he.app.theme[theme]; };
  paintTheme();
  themeBtn.addEventListener('click', () => {
    theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    saveTheme(theme); applyTheme(theme); paintTheme();
  });

  rebuild();
  const init = await ctrl.init();
  if (init.state === 'ready') { P = init.profile; rebuild(); showView('workspace'); }
  else if (init.state === 'fileGate') ui.showGate(init.remembered);
  else showView('chooser');
  ui.refresh();
  render();
  await loader.loadCore();
  if (P.settings.example) exampleMarket = (await loadExampleBundle()).market;
  render();
  ensureData();
}

function applyTheme(t: Theme): void {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
