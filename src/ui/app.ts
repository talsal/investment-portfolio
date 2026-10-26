import { compute } from '../calc/portfolio';
import type { MarketData, Profile } from '../calc/types';
import { loadExampleBundle } from '../data/legacyPack';
import { applyPack } from '../data/pack';
import { DataLoader } from '../data/loader';
import { buildMailto } from '../data/mailto';
import { REQUEST_EMAIL } from '../config/site';
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
import { applyFontScale, loadFontScale, saveFontScale, type FontScale } from './prefs';
import { wireStorageUi } from './storageUi';
import { wirePackUpdate } from './packUpdate';
import { wireWizard } from './wizard';

type View = 'chooser' | 'gate' | 'workspace';

export async function startApp(root: HTMLElement): Promise<void> {
  buildShell(root);
  applyTheme(loadTheme());
  let fontScale: FontScale = loadFontScale();
  applyFontScale(fontScale);
  const ctrl = new StorageController(browserDeps());
  let P: Profile = blankProfile();
  // Reviewer preview: ?drafts=1 also loads machine drafts (clearly labelled). Visitors never see them otherwise.
  const previewDrafts = new URLSearchParams(location.search).get('drafts') === '1';
  const loader = new DataLoader('./data/', undefined, previewDrafts);
  let exampleMarket: MarketData | null = null;
  let overlay: { base: MarketData; pack: MarketData; out: MarketData } | null = null;
  const market = (): MarketData => {
    const base = P.settings.example && exampleMarket ? exampleMarket : loader.market();
    const pack = P.dataPack;
    if (!pack || (P.settings.example && exampleMarket)) return base;
    if (!overlay || overlay.base !== base || overlay.pack !== pack) overlay = { base, pack, out: applyPack(base, pack) };
    return overlay.out;
  };

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
    if (v === 'workspace') maybeOpenWizard();
  }

  // ---- first-run wizard ----
  const WZ_DONE = 'portfolio.wizardDone'; // per browser session: do not re-open the wizard after it was closed
  const wzDone = () => { try { return sessionStorage.getItem(WZ_DONE) === '1'; } catch { return false; } };
  const isBlank = () => !P.rows.length && !P.gemel.length && !P.hish.length && !P.cashUsd && !P.cashNis && !P.mmf;
  function openWizard() { $('workspace').classList.add('wizard-on'); wizard.open(); }
  function maybeOpenWizard() { if (isBlank() && !wzDone() && !P.settings.example) openWizard(); }

  function render() {
    performance.mark('render:start');
    const M = market();
    const C = compute(P, M);
    const ctx: Ctx = { P, M, C, now: new Date() };
    $('subtitle').textContent = C.total > 0 ? he.app.subtitle(C.fx.toFixed(4), fxSource(C.fxManual, M), M.asof || '') : he.app.subtitleEmpty;
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
    renderPackStatus(M);
    renderUncovered(ctx);
    fillPricePlaceholders(ctx);
    markScrollRegions();
    $('demoNotice').hidden = !M.demo;
    $('draftBanner').hidden = !previewDrafts;
    performance.measure('render', 'render:start');
  }

  /** Where the dollar rate in the subtitle comes from, so it is never mislabelled as a default. */
  function fxSource(manual: boolean, M: MarketData): { kind: 'manual' | 'default' | 'data'; label?: string } {
    if (manual) return { kind: 'manual' };
    if (!(M.fx && M.fx > 0)) return { kind: 'default' };
    const g = M.meta?.groups.fx, F = he.app.fxFrom;
    const d = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
    if (M.meta?.personalPack) return { kind: 'data', label: F.pack(d(M.meta.personalPack.asof)) };
    if (g?.source === 'boi') return { kind: 'data', label: F.boi(d(g.asof)) };
    return { kind: 'data', label: F.site(d(g?.asof)) };
  }

  function renderPackStatus(M: MarketData) {
    const n = P.dataPack ? Object.keys(P.dataPack.tickers).length : 0;
    $('packStatus').textContent = P.dataPack ? he.pack.active(n, P.dataPack.asof ?? '') : he.pack.none;
    $('packRemove').hidden = !P.dataPack;
    void M;
  }

  /** Held tickers the data does not cover: listed so the user can choose to tell the site's operator (nothing is sent by the site). */
  function renderUncovered({ M }: Ctx) {
    const syms = [...new Set(P.rows.map((r) => r.t.toUpperCase().replace(/\s+/g, '')).filter((t) => t && !M.tickers[t]))];
    show('uncSection', syms.length > 0);
    $('uncList').textContent = syms.join(', ');
    const to = REQUEST_EMAIL, mailable = to !== null && syms.length > 0;
    show('uncMail', mailable); show('uncMailHint', mailable);
    if (to && mailable) ($('uncMail') as HTMLAnchorElement).href = buildMailto(to, he.uncovered.mailSubject, he.uncovered.mailBody(syms.join(', ')));
    if (!syms.length) $('uncMsg').textContent = '';
  }

  /** A blank price shows the automatic price (from the data) as a placeholder, so nothing looks missing. */
  function fillPricePlaceholders({ C, M }: Ctx) {
    document.querySelectorAll<HTMLInputElement>('[data-g="rows"][data-f="p"]').forEach((el) => {
      const row = P.rows[Number(el.dataset.i)];
      const pk = row && row.c === 'USD' ? M.tickers[row.t.toUpperCase().replace(/\s+/g, '')] : undefined;
      el.placeholder = !row?.p && pk ? he.pack.autoPrice(pk.price.toFixed(2)) : '';
    });
    void C;
  }

  /** Tables that overflow are keyboard-scrollable regions with a name; those that fit stay out of the tab order. */
  function markScrollRegions() {
    document.querySelectorAll<HTMLElement>('.bf-wrap').forEach((el) => {
      const scrolls = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      if (scrolls && !el.hidden) {
        el.tabIndex = 0;
        el.setAttribute('role', 'region');
        const sec = el.closest('.compare-section');
        const title = sec?.querySelector('h2')?.textContent;
        const nth = sec ? [...sec.querySelectorAll<HTMLElement>('.bf-wrap')].indexOf(el) : 0;
        if (title) el.setAttribute('aria-label', nth > 0 ? `${title} (${nth + 1})` : title); // landmark names must be unique
      } else { el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label'); }
    });
  }
  window.addEventListener('resize', () => markScrollRegions());

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

  const wizard = wireWizard({
    getProfile: () => P, getMarket: market, onChange: afterEdit, mode: () => ctrl.mode,
    save: async () => { if (ctrl.mode === 'file') await ctrl.saveFile(P); else ctrl.exportBackup(P); ui.refresh(); },
    onClose: () => {
      try { sessionStorage.setItem(WZ_DONE, '1'); } catch { /* private mode: it just may reopen */ }
      $('workspace').classList.remove('wizard-on');
      rebuild(); render(); window.scrollTo(0, 0); $('results').focus();
    },
  });
  $('wzStart').addEventListener('click', openWizard);

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

  $('uncCopy').addEventListener('click', async () => {
    const text = he.uncovered.listLead + $('uncList').textContent;
    try { await navigator.clipboard.writeText(text); $('uncMsg').textContent = he.uncovered.copied; }
    catch {
      // Clipboard blocked: select the list so the user can copy it by hand.
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents($('uncList')); sel?.removeAllRanges(); sel?.addRange(range);
      $('uncMsg').textContent = he.uncovered.copyFailed;
    }
  });
  const packUpdate = wirePackUpdate({
    getProfile: () => P,
    now: () => new Date(),
    apply: (pack) => { P.dataPack = pack; afterEdit(); },
  });
  $('packImport').addEventListener('click', () => $('packFile').click());
  $('packFile').addEventListener('change', async function (this: HTMLInputElement) {
    const f = this.files?.[0]; this.value = '';
    if (f) await packUpdate.fromFile(f);
  });
  $('packRemove').addEventListener('click', () => { P.dataPack = null; $('packMsg').textContent = he.pack.removed; afterEdit(); });

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

  const fontBtn = $('btnFont');
  const paintFont = () => { fontBtn.textContent = he.app.fontSize[fontScale]; };
  paintFont();
  fontBtn.addEventListener('click', () => {
    fontScale = fontScale === 'normal' ? 'large' : fontScale === 'large' ? 'xlarge' : 'normal';
    saveFontScale(fontScale); applyFontScale(fontScale); paintFont();
    markScrollRegions();
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
