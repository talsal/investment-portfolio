import type { Profile } from '../calc/types';
import type { ImportResult } from '../profile/backup';
import { he } from '../i18n/he';
import type { FileOutcome, StorageController } from '../storage/controller';
import { $ } from './dom';

export interface StorageUiHooks {
  getProfile(): Profile;
  /** Replace the whole profile (after an import / new file). */
  applyProfile(P: Profile, markChanged: boolean): void;
  /** Move the UI between the chooser, the file gate and the workspace. */
  showState(s: 'chooser' | 'gate' | 'workspace'): void;
  setStatus(text: string): void;
  /** Blank profile for "start fresh". */
  blank(): Profile;
}

type OkResult = Extract<ImportResult, { ok: true }>;
const errText = (e: string): string => (he.storage.error as Record<string, string>)[e] ?? he.storage.error.failed;
const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('he-IL');

/** Wires chooser, file gate, storage card, import preview, drag and drop, and mode switching. */
export function wireStorageUi(ctrl: StorageController, h: StorageUiHooks): { refresh(): void; showGate(remembered: string | null): void } {
  const msg = (t: string, bad = false) => { const m = $('stMsg'); m.textContent = t; m.className = 'in-msg' + (bad ? ' bad' : ''); };
  const gateMsg = (t: string) => { $('gateMsg').textContent = t; };
  let pending: { result: OkResult; fileName: string } | null = null;
  let eraseArmed = false;

  function refresh(): void {
    const file = ctrl.mode === 'file';
    $('stMode').textContent = file ? he.storage.card.modeFile : he.storage.card.modeBrowser;
    $('stBrowserWarn').hidden = file;
    $('stFileBox').hidden = !file;
    $('stFileInfo').textContent = he.storage.card.fileInfo(ctrl.fileName);
    $('stRememberRow').hidden = !ctrl.fsSupported;
    $('stSwitch').textContent = file ? he.storage.card.toBrowser : he.storage.card.toFile;
    $('stPersist').textContent = file || ctrl.persisted === null ? '' : ctrl.persisted ? he.storage.card.persistYes : he.storage.card.persistNo;
    renderNudge();
  }

  function renderNudge(): void {
    const el = $('backupNudge');
    const n = ctrl.backupNudge(h.getProfile());
    el.hidden = !n.show;
    if (!n.show) return;
    const N = he.storage.nudge;
    el.innerHTML = '';
    const span = document.createElement('span'); span.textContent = N.text(n.days, n.never);
    const now = document.createElement('button'); now.type = 'button'; now.className = 'toggle-btn'; now.textContent = N.now;
    now.addEventListener('click', () => { ctrl.exportBackup(h.getProfile()); msg(he.storage.status.exported); renderNudge(); });
    const later = document.createElement('button'); later.type = 'button'; later.className = 'toggle-btn'; later.textContent = N.later;
    later.addEventListener('click', () => { ctrl.snoozeNudge(); renderNudge(); });
    el.append(span, now, later);
  }

  // ---------- chooser ----------
  $('chooseBrowser').addEventListener('click', () => {
    ctrl.choose('browser');
    h.applyProfile(h.blank(), false);
    h.showState('workspace');
    refresh();
  });
  $('chooseFile').addEventListener('click', async () => {
    ctrl.choose('file');
    await ctrl.forgetRemembered();
    showGate(null);
  });

  // ---------- file gate ----------
  function showGate(remembered: string | null): void {
    h.showState('gate');
    const btn = $('gateRemembered');
    btn.hidden = !remembered;
    if (remembered) btn.textContent = he.storage.gate.openRemembered(remembered);
    $('gateOpen').hidden = false;
    gateMsg('');
  }

  async function loadIntoWorkspace(out: FileOutcome, fail: (t: string) => void): Promise<void> {
    if (!out.ok) { fail(errText(out.error)); return; }
    ctrl.loaded(out.fileName);
    h.applyProfile(out.result.profile, false);
    h.showState('workspace');
    h.setStatus(he.storage.status.loadedFile(out.fileName));
    refresh();
  }

  $('gateRemembered').addEventListener('click', async () => loadIntoWorkspace(await ctrl.openRemembered(), gateMsg));
  $('gateOpen').addEventListener('click', async () => {
    if (ctrl.fsSupported) {
      const out = await ctrl.openWithPicker();
      if (!out.ok && out.error === 'cancelled') return;
      await loadIntoWorkspace(out, gateMsg);
    } else $('gateFile').click();
  });
  $('gateFile').addEventListener('change', async function (this: HTMLInputElement) {
    const f = this.files?.[0]; this.value = '';
    if (f) await loadIntoWorkspace(await ctrl.readFileObject(f), gateMsg);
  });
  $('gateNew').addEventListener('click', () => {
    ctrl.loaded(null);
    h.applyProfile(h.blank(), false);
    h.showState('workspace');
    h.setStatus(he.storage.status.started);
    refresh();
  });
  $('gateToBrowser').addEventListener('click', async () => {
    await ctrl.switchToBrowser(h.blank());
    h.applyProfile(h.blank(), false);
    h.showState('workspace');
    refresh();
  });

  // ---------- drag and drop ----------
  const prevent = (e: Event) => e.preventDefault();
  // Dropping a file anywhere else must not make the browser navigate away from the app.
  window.addEventListener('dragover', prevent);
  window.addEventListener('drop', prevent);
  function dropZone(id: string, onFile: (f: File) => void): void {
    const z = $(id);
    z.addEventListener('dragover', (e) => { prevent(e); z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', (e) => {
      prevent(e); z.classList.remove('over');
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) onFile(f);
    });
    z.addEventListener('keydown', (e) => { const k = (e as KeyboardEvent).key; if (k === 'Enter' || k === ' ') { prevent(e); z.click(); } });
  }
  dropZone('gateDrop', async (f) => loadIntoWorkspace(await ctrl.readFileObject(f), gateMsg));
  $('gateDrop').addEventListener('click', () => $('gateOpen').click());

  // ---------- storage card: import with confirmation ----------
  function showPreview(out: FileOutcome): void {
    if (!out.ok) { msg(errText(out.error), true); return; }
    pending = { result: out.result, fileName: out.fileName };
    const r = out.result, P = he.storage.preview;
    $('ipP').textContent = [P.counts(r.summary), r.exportedAt ? P.exportedAt(fmtDate(r.exportedAt)) : '', r.migratedFrom ? P.migrated(r.migratedFrom) : ''].filter(Boolean).join(' ');
    $('importPreview').hidden = false;
    msg('');
  }
  $('stImport').addEventListener('click', () => $('stFile').click());
  $('stFile').addEventListener('change', async function (this: HTMLInputElement) {
    const f = this.files?.[0]; this.value = '';
    if (f) showPreview(await ctrl.readFileObject(f));
  });
  dropZone('stDrop', async (f) => showPreview(await ctrl.readFileObject(f)));
  $('stDrop').addEventListener('click', () => $('stImport').click());
  $('ipCancel').addEventListener('click', () => { pending = null; $('importPreview').hidden = true; });
  $('ipConfirm').addEventListener('click', () => {
    if (!pending) return;
    h.applyProfile(pending.result.profile, true);
    pending = null;
    $('importPreview').hidden = true;
    msg(he.storage.preview.done);
    refresh();
  });

  // ---------- export / save ----------
  $('stExport').addEventListener('click', () => { ctrl.exportBackup(h.getProfile()); msg(he.storage.status.exported); refresh(); });
  $('stSave').addEventListener('click', async () => {
    const r = await ctrl.saveFile(h.getProfile());
    if (!('fileName' in r)) msg(r.how === 'failed' ? he.storage.error.saveFailed : he.storage.error.cancelled, r.how === 'failed');
    else { msg(he.storage.status.saved(r.how, r.fileName)); h.setStatus(he.storage.status.fileClean); }
    refresh();
  });
  $('stRemember').addEventListener('change', (e) => { ctrl.rememberFile = (e.target as HTMLInputElement).checked; });

  // ---------- switching modes ----------
  const panel = $('switchPanel');
  $('stSwitch').addEventListener('click', () => {
    const toFile = ctrl.mode !== 'file', S = he.storage.switchPanel;
    $('swH').textContent = toFile ? S.toFileH : S.toBrowserH;
    $('swP').textContent = toFile ? S.toFileP : S.toBrowserP;
    $('swSave').hidden = !toFile;
    $('swSave').textContent = S.toFileSave;
    $('swGo').textContent = toFile ? S.toFileNoSave : S.toBrowserGo;
    panel.hidden = false;
  });
  $('swCancel').addEventListener('click', () => { panel.hidden = true; });
  $('swSave').addEventListener('click', async () => {
    const r = await ctrl.saveFile(h.getProfile());
    if (!('fileName' in r)) { msg(r.how === 'failed' ? he.storage.error.saveFailed : he.storage.error.cancelled, r.how === 'failed'); return; }
    ctrl.switchToFile(); ctrl.loaded(r.fileName); panel.hidden = true;
    msg(he.storage.status.saved(r.how, r.fileName)); h.setStatus(he.storage.status.fileClean); refresh();
  });
  $('swGo').addEventListener('click', async () => {
    panel.hidden = true;
    if (ctrl.mode === 'file') { await ctrl.switchToBrowser(h.getProfile()); h.setStatus(he.editor.saved); }
    else { ctrl.switchToFile(); h.setStatus(he.storage.status.fileDirty); }
    refresh();
  });

  // ---------- erase ----------
  $('stErase').addEventListener('click', async function (this: HTMLElement) {
    if (!eraseArmed) {
      eraseArmed = true; this.textContent = he.storage.card.eraseConfirm;
      setTimeout(() => { eraseArmed = false; this.textContent = he.storage.card.erase; }, 6000);
      return;
    }
    eraseArmed = false;
    await ctrl.eraseBrowserData();
    location.reload();
  });

  window.addEventListener('beforeunload', (e) => {
    if (ctrl.mode === 'file' && ctrl.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  return { refresh, showGate };
}

