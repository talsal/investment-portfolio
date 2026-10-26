import type { MarketData, Profile } from '../calc/types';
import { nz } from '../calc/num';
import { checkPack, type PackCheck } from '../data/packCheck';
import { MAX_PACK_CHARS, parsePackText, sanitizePack } from '../data/pack';
import { packWants } from '../data/packTickers';
import { he } from '../i18n/he';
import { $ } from './dom';

export interface PackUpdateHooks {
  getProfile(): Profile;
  /** Replaces the personal pack and persists according to the storage mode. */
  apply(pack: MarketData): void;
  now(): Date;
}

const dmy = (d: Date): string => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
/** Date, weekday and local time with the time zone, so the assistant knows whether the US market has closed today. */
const stamp = (d: Date): string => {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* unknown zone: leave it out */ }
  return `${dmy(d)}, ${d.toLocaleDateString('he-IL', { weekday: 'long' })}, ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })}${zone ? ` (${zone})` : ''}`;
};
const isoToDmy = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const pct = (n: number): string => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

/** The guided update: instructions for the user's own assistant, paste or file in, a checked preview, confirm to apply. */
export function wirePackUpdate(h: PackUpdateHooks): { open(): void; fromFile(f: File): Promise<void> } {
  const A = he.packAsk, C = he.packCheck;
  let pending: MarketData | null = null;
  const msg = (t: string, bad = false) => { const m = $('paMsg'); m.textContent = t; m.className = 'in-msg' + (bad ? ' bad' : ''); };
  const resetPreview = () => { pending = null; $('paPreview').hidden = true; };

  function open(): void {
    const details = $('storageCard') as HTMLDetailsElement;
    details.open = true;
    const wants = packWants(h.getProfile());
    $('paNone').hidden = wants.length > 0;
    $('paFlow').hidden = wants.length === 0;
    ($('paPrompt') as HTMLTextAreaElement).value = wants.length ? A.prompt(wants, stamp(h.now())) : '';
    resetPreview();
    msg('');
    $('packAskBox').hidden = false;
    const target = $('paH'); target.tabIndex = -1; target.focus();
  }

  function preview(pack: MarketData, raw: unknown): void {
    const P = h.getProfile();
    const typed: Record<string, number> = {};
    for (const r of P.rows) {
      const t = r.t.toUpperCase().replace(/\s+/g, '');
      if (nz(r.p) > 0 && !(t in typed)) typed[t] = nz(r.p);
    }
    const wants = packWants(P);
    const res = checkPack({ raw, pack, wanted: wants.map((w) => w.t), expectedCur: Object.fromEntries(wants.map((w) => [w.t, w.cur])), previous: P.dataPack, typed, typedFx: nz(P.fx) > 0 ? nz(P.fx) : null, today: h.now() });
    pending = pack;
    paint(res, pack);
  }

  function paint(res: PackCheck, pack: MarketData): void {
    $('pvSummary').textContent = C.summary(res.rows.length, pack.asof ?? '');
    const table = $('pvTable') as HTMLTableElement; table.replaceChildren();
    const head = table.createTHead().insertRow();
    for (const t of [C.colTicker, C.colPrice, C.colRef, C.colChange, C.colNote]) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = t; head.append(th); }
    const body = table.createTBody();
    for (const r of res.rows) {
      const tr = body.insertRow();
      const cell = (text: string, cls = '', ltr = false) => { const td = tr.insertCell(); td.textContent = text; if (cls) td.className = cls; if (ltr) td.dir = 'ltr'; return td; };
      cell(r.t, '', true);
      cell(r.price.toFixed(2), 'num', true);
      cell(r.ref ? `${r.ref.toFixed(2)}` : '-', 'num', true).title = r.refFrom === 'pack' ? C.refPack : r.refFrom === 'typed' ? C.refTyped : C.noRef;
      cell(r.changePct === null ? '-' : pct(r.changePct), `num${r.jump ? ' pv-bad' : ''}`, true);
      const notes = [
        ...(r.unitMix ? [C.unitMix] : r.jump && r.changePct !== null ? [C.jump(Math.round(Math.abs(r.changePct)))] : []),
        ...(r.curMismatch ? [C.curMismatch(r.stated ?? C.noCur, r.expected)] : []),
        ...(!r.ref && !r.curMismatch ? [C.noRef] : []),
      ];
      cell(notes.join(' '), r.jump || r.curMismatch ? 'pv-bad' : 'pv-ok');
    }
    const W = C.warn, list = $('pvWarns'); list.replaceChildren();
    const add = (t: string, bad = true) => { const li = document.createElement('li'); li.textContent = t; if (bad) li.className = 'bad'; list.append(li); };
    if (res.noDate) add(W.noDate);
    if (res.stale && res.ageDays !== null) add(W.stale(res.ageDays));
    if (res.future) add(W.future);
    if (res.behindMarket) add(W.behind(isoToDmy(res.behindMarket)));
    if (res.fx?.jump) add(W.fx(res.fx.value.toFixed(3), res.fx.ref.toFixed(3)));
    if (res.missing.length) add(W.missing(res.missing.join(', ')));
    if (res.rejected.length) add(W.rejected(res.rejected.join(', ')));
    if (res.dropped.length) add(W.dropped(res.dropped.join(', ')), false);
    if (res.extra > 0) add(W.extra(res.extra), false);
    if (res.clean) add(C.clean, false);
    $('paPreview').hidden = false;
    const hd = $('pvH'); hd.focus();
  }

  function checkText(text: string): void {
    resetPreview();
    const r = parsePackText(text);
    if (!r.ok) { msg(r.error === 'empty' ? A.empty : r.error === 'tooBig' ? C.tooBig : C.notJson, true); return; }
    const pack = sanitizePack(r.value);
    if (!pack) { msg(he.pack.error.invalid, true); return; }
    msg('');
    preview(pack, r.value);
  }

  $('packAsk').addEventListener('click', open);
  $('uncAsk').addEventListener('click', open);
  $('paClose').addEventListener('click', () => { $('packAskBox').hidden = true; resetPreview(); });
  $('paCopy').addEventListener('click', async () => {
    const ta = $('paPrompt') as HTMLTextAreaElement;
    try { await navigator.clipboard.writeText(ta.value); msg(A.copied); }
    catch { ta.focus(); ta.select(); msg(A.copyFailed); }
  });
  $('paCheck').addEventListener('click', () => checkText(($('paPaste') as HTMLTextAreaElement).value));
  $('paFile').addEventListener('click', () => $('packFile').click());
  $('pvCancel').addEventListener('click', () => { resetPreview(); msg(''); });
  $('pvConfirm').addEventListener('click', () => {
    if (!pending) return;
    const pack = pending, n = Object.keys(pack.tickers).length;
    resetPreview();
    ($('paPaste') as HTMLTextAreaElement).value = '';
    h.apply(pack);
    msg(C.applied(n));
  });

  /** The file picker shares the same checked preview as pasting. */
  async function fromFile(f: File): Promise<void> {
    $('packAskBox').hidden = false;
    ($('storageCard') as HTMLDetailsElement).open = true;
    if (f.size > MAX_PACK_CHARS * 1.5) { msg(he.pack.error.invalid, true); return; }
    checkText(await f.text());
  }
  return { open, fromFile };
}
