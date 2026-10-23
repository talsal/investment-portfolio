import { compute } from '../calc/portfolio';
import type { MarketData, Profile } from '../calc/types';
import { loadExampleBundle, loadMarket } from '../data/loader';
import { he } from '../i18n/he';
import { blankProfile, sanitizeProfile } from '../profile/schema';
import { loadProfile, loadTheme, saveProfile, saveTheme, type Theme } from '../storage/browserStore';
import { $, show } from './dom';
import { buildEditor, setMsg, syncTopFields, wireEditor } from './editor';
import type { Ctx } from './context';
import { buildShell } from './shell';
import { buildCashFlowInputs, renderCashFlow } from './sections/cashflow';
import { renderAnalysis } from './sections/criteria';
import { bindHistoryModes, renderHistory } from './sections/historyChart';
import { renderPie } from './sections/pie';
import { renderBenchmark, renderDividends, renderEquity, renderAnnual, renderEvents, renderProfitTotal, renderTotals } from './sections/summary';

const SAVE_DEBOUNCE_MS = 600;

export async function startApp(root: HTMLElement): Promise<void> {
  buildShell(root);
  applyTheme(loadTheme());
  let P: Profile = loadProfile();
  let liveMarket: MarketData = { tickers: {} };
  let exampleMarket: MarketData | null = null;
  const market = (): MarketData => (P.settings.example && exampleMarket ? exampleMarket : liveMarket);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const status = $('inStatus');
  function scheduleSave() {
    clearTimeout(saveTimer);
    status.textContent = he.editor.saving;
    saveTimer = setTimeout(() => {
      P.updatedAt = Date.now();
      status.textContent = saveProfile(P) ? he.editor.saved : he.editor.saveFailed;
    }, SAVE_DEBOUNCE_MS);
  }

  function render() {
    const M = market();
    const C = compute(P, M);
    const ctx: Ctx = { P, M, C, now: new Date() };
    $('subtitle').textContent = C.total > 0
      ? he.app.subtitle(C.fx.toFixed(4), C.fxManual, M.asof || '')
      : he.app.subtitleEmpty;
    show('outEmpty', !(C.total > 0));
    show('outMain', C.total > 0);
    if (C.total > 0) {
      renderTotals(ctx); renderProfitTotal(ctx); renderPie(ctx); renderEquity(ctx); renderAnnual(ctx);
    }
    let any = renderAnalysis(ctx);
    renderDividends(ctx); renderBenchmark(ctx); renderEvents(ctx);
    any = renderHistory(ctx) || any || !$('divSection').hidden || !$('bmSection').hidden || !$('evSection').hidden;
    show('anaTitle', any);
    renderCashFlow(ctx);
    $('demoNotice').hidden = !M.demo;
  }

  function rebuild() { buildEditor(P); buildCashFlowInputs(P); }

  wireEditor(() => P, {
    onEdit: () => { scheduleSave(); render(); },
    onStructure: () => { buildEditor(P); scheduleSave(); render(); },
  });
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
    scheduleSave(); render();
  });
  $('cfClear').addEventListener('click', () => {
    P.cf = blankProfile().cf;
    buildCashFlowInputs(P); scheduleSave(); render();
  });

  $('btnExample').addEventListener('click', async () => {
    const ex = await loadExampleBundle();
    exampleMarket = ex.market;
    P = sanitizeProfile(ex.profile);
    P.settings.example = true;
    rebuild(); scheduleSave(); render();
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
    rebuild(); scheduleSave(); render();
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
  syncTopFields(P);
  render();
  const loaded = await loadMarket();
  liveMarket = loaded.M;
  if (P.settings.example) exampleMarket = (await loadExampleBundle()).market;
  render();
}

function applyTheme(t: Theme): void {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
