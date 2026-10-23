import { GLOSSARY } from '../i18n/glossary';
import { he } from '../i18n/he';
import { RULES } from '../config/rules';
import { html, rich, setHtml, type Part, type Raw } from './html';

const disclaimer = (): Raw => html`<p class="disclaimer" data-parity-skip>${he.app.disclaimer}</p>`;
const section = (id: string, title: string, body: Part, opts: { hidden?: boolean; note?: Part; skip?: boolean } = {}): Raw =>
  html`<div class="compare-section" id="${id}" ${opts.hidden ? 'hidden' : ''} ${opts.skip ? 'data-parity-skip' : ''}><h2>${title}</h2>${opts.note ? html`<p class="compare-note">${opts.note}</p>` : ''}${body}${disclaimer()}</div>`;

function editorCard(): Raw {
  const E = he.editor;
  const top = (key: string, label: string, ph = '') =>
    html`<label class="in-f">${label}<input class="n" type="text" inputmode="decimal" autocomplete="off" data-top="${key}" placeholder="${ph}"></label>`;
  return html`<details class="in-card" id="inCard" open>
    <summary>${E.summary}</summary>
    <p class="in-hint mt8">${E.hint}</p>
    <div class="in-grid w420">${top('fx', E.fxLabel('3.11'), '3.11')}</div>
    <h3>${E.tradeH}</h3><p class="in-hint">${E.tradeHint}</p>
    <div id="inRows"></div><div class="in-btns"><button type="button" class="toggle-btn" id="addRow">${E.addRow}</button></div>
    <h3>${E.cashH}</h3>
    <div class="in-grid">${top('cashUsd', E.cashUsd)}${top('cashNis', E.cashNis)}${top('mmf', E.mmf)}${top('tradeRate', E.tradeRate)}</div>
    <h3>${E.gemelH}</h3><p class="in-hint">${E.gemelHint}</p>
    <div id="inGemel"></div><div class="in-btns"><button type="button" class="toggle-btn" id="addGemel">${E.addGemel}</button></div>
    <h3>${E.hishH}</h3>
    <div id="inHish"></div><div class="in-btns"><button type="button" class="toggle-btn" id="addHish">${E.addHish}</button></div>
    <h3>${E.targetH}</h3>
    <div class="in-grid w420">${top('eqTarget', E.eqTarget, E.eqTargetPh)}</div>
    <h3>${he.watchlistEditor.h}</h3><p class="in-hint">${he.watchlistEditor.hint}</p>
    <div id="inWatch" class="chips"></div>
    <div class="in-btns"><label class="in-f grow">${he.watchlistEditor.label}<input type="text" dir="ltr" autocomplete="off" id="watchNew" maxlength="12"></label><button type="button" class="toggle-btn" id="addWatch">${he.watchlistEditor.add}</button></div>
    <h3>${E.tradesH}</h3><p class="in-hint">${E.tradesHint}</p>
    <div id="inTrades"></div><div class="in-btns"><button type="button" class="toggle-btn" id="addTrade">${E.addTrade}</button></div>
    <h3>${E.settingsH}</h3>
    <div class="in-grid w420"><label class="in-f">${E.benchmarkDate}<input class="n" type="date" data-setting="benchmarkDate"></label></div>
    <h3>${E.exampleH}</h3><p class="in-hint">${E.exampleHint}</p>
    <div class="in-btns">
      <button type="button" class="toggle-btn" id="btnExample">${E.loadExample}</button>
      <button type="button" class="toggle-btn" id="btnClear">${E.clearAll}</button>
      <span class="in-status" id="inStatus" role="status"></span>
    </div>
    <p class="in-msg" id="inMsg" role="status"></p>
  </details>`;
}


function chooser(): Raw {
  const C = he.storage.chooser;
  return html`<section id="modeChooser" class="in-card chooser" hidden aria-labelledby="chooserH">
    <h2 id="chooserH">${C.h}</h2><p class="in-hint">${C.intro}</p>
    <div class="choices">
      <div class="choice"><h3>${C.browserH}</h3><p>${C.browserP}</p><button type="button" class="toggle-btn" id="chooseBrowser">${C.browserBtn}</button></div>
      <div class="choice"><h3>${C.fileH}</h3><p>${C.fileP}</p><button type="button" class="toggle-btn" id="chooseFile">${C.fileBtn}</button></div>
    </div>
  </section>`;
}

function gate(): Raw {
  const G = he.storage.gate;
  return html`<section id="fileGate" class="in-card chooser" hidden aria-labelledby="gateH">
    <h2 id="gateH">${G.h}</h2><p class="in-hint">${G.p}</p>
    <div class="in-btns">
      <button type="button" class="toggle-btn" id="gateRemembered" hidden></button>
      <button type="button" class="toggle-btn" id="gateOpen">${G.openPicker}</button>
      <input type="file" id="gateFile" accept=".json,application/json" hidden aria-label="${G.fileInput}">
    </div>
    <div class="drop" id="gateDrop" tabindex="0" role="button" aria-label="${G.drop}">${G.drop}</div>
    <div class="in-btns"><button type="button" class="toggle-btn" id="gateNew">${G.startNew}</button><button type="button" class="toggle-btn" id="gateToBrowser">${G.toBrowser}</button></div>
    <p class="in-msg bad" id="gateMsg" role="alert"></p>
  </section>`;
}

function freshnessCard(): Raw {
  return html`<details class="in-card" id="freshness" data-parity-skip hidden>
    <summary>${he.freshness.h}: <span id="freshSummary"></span></summary>
    <ul class="fresh-list" id="freshList"></ul>
    <p class="in-msg bad" id="freshStale" hidden></p>
  </details>`;
}

function storageCard(): Raw {
  const K = he.storage.card, S = he.storage.switchPanel;
  return html`<details class="in-card" id="storageCard">
    <summary>${K.summary}</summary>
    <p class="b mt8" id="stMode"></p>
    <p class="in-hint" id="stBrowserWarn">${K.browserWarn} <span id="stPersist"></span></p>
    <div id="stFileBox" hidden>
      <p class="in-hint" id="stFileInfo"></p><p class="in-hint">${K.fileHint}</p>
      <div class="in-btns"><button type="button" class="toggle-btn" id="stSave">${K.saveFile}</button>
        <label class="in-check" id="stRememberRow"><input type="checkbox" id="stRemember" checked> ${K.remember}</label></div>
    </div>
    <div class="in-btns">
      <button type="button" class="toggle-btn" id="stExport">${K.export}</button>
      <button type="button" class="toggle-btn" id="stImport">${K.import}</button>
      <input type="file" id="stFile" accept=".json,application/json" hidden aria-label="${K.import}">
      <button type="button" class="toggle-btn" id="stSwitch"></button>
    </div>
    <div class="drop" id="stDrop" tabindex="0">${K.dropHint}</div>
    <div class="switch-panel" id="switchPanel" role="alertdialog" aria-labelledby="swH" hidden>
      <h3 id="swH"></h3><p id="swP"></p>
      <div class="in-btns"><button type="button" class="toggle-btn" id="swSave"></button><button type="button" class="toggle-btn" id="swGo"></button><button type="button" class="toggle-btn" id="swCancel">${S.cancel}</button></div>
    </div>
    <div class="switch-panel" id="importPreview" role="group" aria-labelledby="ipH" hidden>
      <h3 id="ipH">${he.storage.preview.h}</h3><p id="ipP"></p>
      <div class="in-btns"><button type="button" class="toggle-btn" id="ipConfirm">${he.storage.preview.confirm}</button><button type="button" class="toggle-btn" id="ipCancel">${he.storage.preview.cancel}</button></div>
    </div>
    <p class="in-msg" id="stMsg" role="status"></p>
    <h3>${K.eraseH}</h3>
    <div class="in-btns"><button type="button" class="toggle-btn" id="stErase">${K.erase}</button></div>
  </details>`;
}

/** Builds the static page skeleton. All text comes from the i18n file; ids match the reference engine. */
export function buildShell(root: HTMLElement): void {
  const T = he;
  setHtml(root, html`
    <div class="top-bar"><button type="button" class="toggle-btn" id="btnTheme" aria-live="polite"></button></div>
    <h1>${T.app.title}</h1>
    <p class="subtitle" id="subtitle">${T.app.subtitleEmpty}</p>
    ${chooser()}
    ${gate()}
    <div id="workspace" hidden>
    <div class="nudge" id="backupNudge" role="status" hidden></div>
    <p class="rate-note mnotice" data-parity-skip>${rich(T.app.notice)}</p>
    <p id="demoNotice" role="status" hidden data-parity-skip>${T.app.demoNotice}</p>
    <p id="draftBanner" class="in-msg bad b" role="status" data-parity-skip hidden>${he.draft.banner}</p>
    ${freshnessCard()}
    ${storageCard()}
    ${editorCard()}
    <div id="outEmpty" class="empty-box">${T.app.emptyBox}</div>
    <div id="outMain" hidden>
      <div class="compare-section first">
        <h2>${T.total.h}</h2>
        <p class="compare-total"><span class="ct-usd" id="totUsd"></span> · <span class="ct-nis" id="totNis"></span></p>
        <div class="compare-bar" id="splitBar" role="img" aria-label="${T.total.splitAria}"></div>
        <div class="compare-legend" id="splitLegend"></div>
      </div>
      ${section('plSection', T.pl.h, html`<div class="cf-tiles" id="plTiles"></div><div class="bf-wrap" id="plTable"></div><p class="rate-note" id="plNote"></p>`, { note: T.pl.note })}
      ${section('trSection', T.trade.h, html`
        <div class="chart-row">
          <div class="chart-wrap"><svg id="pie" viewBox="0 0 320 320" role="img" aria-label="${T.trade.pieAria}"></svg></div>
          <ul class="legend" id="legend"></ul>
        </div>
        <div class="actions"><button class="toggle-btn" id="toggleTable" type="button" aria-expanded="false">${T.trade.showTable}</button></div>
        <div id="tableView" class="bf-wrap" hidden></div>
        <p class="rate-note" id="trSummary"></p>`)}
      ${section('eqSection', T.equity.h, html`<div class="cf-tiles" id="eqTiles"></div><p class="rate-note" id="eqNote"></p>`, { note: T.equity.note })}
      ${section('annSection', T.annual.h, html`<div class="cf-tiles" id="annTiles"></div><div class="bf-wrap" id="annTable"></div><p class="compare-total" id="annInfl" data-parity-skip hidden></p><p class="rate-note" id="annNote"></p>`, { note: T.annual.note })}
      ${section('wdSection', T.withdrawal.h, html`
        <div class="cf-grid"><label>${T.withdrawal.years}<input type="text" inputmode="decimal" autocomplete="off" data-wd="years"></label><label>${T.withdrawal.rate}<input type="text" inputmode="decimal" autocomplete="off" data-wd="realRate"></label></div>
        <div class="cf-tiles" id="wdTiles"></div><p class="rate-note" id="wdNote"></p>`, { note: T.withdrawal.note, skip: true })}
    </div>
    <h2 id="anaTitle" class="ana-title" hidden>${T.analysis.h}</h2>
    <div class="ana-pending" id="anaPending" hidden></div>
    ${section('bfSection', T.criteria.h, html`<div class="bf-wrap" id="bfTable"></div><h3 class="sub-h">${T.criteria.baseH}</h3><div class="bf-wrap" id="bfBase"></div><p class="rate-note" id="bfNote"></p>`, { hidden: true, note: rich(T.criteria.note({ pe: RULES.criteria.pe.maxForward, fcf: RULES.criteria.fcf.minYieldPct })) })}
    ${section('wlSection', T.watch.h, html`<div class="bf-wrap" id="wlTable"></div><p class="ana-pending" id="wlPending" hidden></p><p class="rate-note" id="wlNote"></p>`, { hidden: true, note: T.watch.note })}
    ${section('divSection', T.dividends.h, html`<div id="divTable"></div><p class="rate-note" id="divNote"></p>`, { hidden: true, note: T.dividends.note })}
    ${section('bmSection', T.benchmark.h, html`
      <p class="in-msg bad" id="bmError" role="alert" hidden></p>
      <p class="compare-total">${T.benchmark.totalLead[0]}<span id="bmBasket"></span>${T.benchmark.totalLead[1]}<span id="bmSpy"></span>${T.benchmark.totalLead[2]}<span id="bmDiff"></span></p>
      <div class="bf-wrap" id="bmTable"></div><p class="rate-note" id="bmNote"></p>`, { hidden: true, note: T.benchmark.note })}
    ${section('hsSection', T.history.h, html`
      <div class="hs-modes"><button class="toggle-btn" id="hsBtnIls" type="button" aria-pressed="true">${T.history.ils}</button><button class="toggle-btn" id="hsBtnUsd" type="button" aria-pressed="false">${T.history.usd}</button></div>
      <p class="compare-total" id="hsSummary"></p>
      <div class="hs-legend"><span><i class="sw"></i>${T.history.legend[0]}</span><span><i class="sw spy"></i>${T.history.legend[1]}</span><span><i class="sw inv"></i>${T.history.legend[2]}</span></div>
      <div class="hs-chart" id="hsChart"></div>
      <p class="rate-note" id="hsGap"></p>
      <details class="hs-details"><summary>${T.history.showTable}</summary><div class="bf-wrap" id="hsTable"></div></details>
      <details class="hs-details"><summary>${T.history.showTrades}</summary><div class="bf-wrap" id="hsTrades"></div></details>
      <p class="rate-note" id="hsNote"></p>`, { hidden: true, note: T.history.note })}
    ${section('evSection', T.events.h, html`<div class="bf-wrap" id="evTable"></div><p class="rate-note" id="evNote"></p>`, { hidden: true, note: T.events.note })}
    ${section('cfSection', T.cashflow.h, html`
      <div class="cf-grid" id="cfInputs"></div><div class="cf-tiles" id="cfTiles"></div>
      <h3 class="cf-sub">${T.cashflow.barsH}</h3><div class="cf-bars" id="cfBars"></div>
      <div class="cf-link" id="cfLink"></div><p class="rate-note" id="cfNote"></p>
      <button type="button" class="toggle-btn mt8" id="cfClear">${T.cashflow.clear}</button>`, { note: T.cashflow.note })}
    <div class="compare-section" id="glossarySection">
      <h2>${T.glossary.h}</h2>
      <dl class="glossary">${GLOSSARY.map(([term, def]) => html`<dt>${term}</dt><dd>${def}</dd>`)}</dl>
    </div>
    </div>
    <div id="tooltip" class="tooltip" hidden></div>`);
}
