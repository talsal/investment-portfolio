import { RULES } from '../config/rules';
import type { Profile } from '../calc/types';
import { sanitizeProfile } from './schema';

/** Same app id as the prototype, so its v2 backups import into this app. */
export const APP_ID = 'portfolio-pilot';
export const CURRENT_VERSION = 3;

export type ImportError = 'tooLarge' | 'notJson' | 'notBackup' | 'wrongApp' | 'badVersion' | 'unsupportedVersion' | 'newerVersion';

export interface ImportSummary { holdings: number; funds: number; trades: number; watchlist: number; hasCash: boolean }
export type ImportResult =
  | { ok: true; profile: Profile; version: number; exportedAt: string | null; migratedFrom: number | null; summary: ImportSummary }
  | { ok: false; error: ImportError };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * One migration per source version: takes the profile object of version N and returns version N+1.
 * They operate on untrusted data and must not throw; `sanitizeProfile` runs after the whole chain.
 */
const BARE_PROFILE_KEYS = ['fx', 'cashUsd', 'cashNis', 'mmf', 'tradeRate', 'eqTarget', 'rows', 'gemel', 'hish', 'trades', 'cf'];

export const MIGRATIONS: Record<number, (p: Obj) => Obj> = {
  // v2 (prototype) -> v3: adds settings, watchlist and withdrawal inputs.
  2: (p) => ({ ...p, settings: isObj(p.settings) ? p.settings : { benchmarkDate: '', example: false }, watchlist: Array.isArray(p.watchlist) ? p.watchlist : [], withdrawal: isObj(p.withdrawal) ? p.withdrawal : { years: '', realRate: '' } }),
};

export function migrateProfile(version: number, profile: Obj): Obj {
  let p = profile;
  for (let v = version; v < CURRENT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return p;
    p = step(p);
  }
  return p;
}

export function summarize(P: Profile): ImportSummary {
  return {
    holdings: P.rows.length, funds: P.gemel.length + P.hish.length, trades: P.trades.length, watchlist: P.watchlist.length,
    hasCash: !!(P.cashUsd || P.cashNis || P.mmf),
  };
}

/**
 * Strictly parses a backup file. The file is never trusted: size-capped, envelope-checked, migrated and then
 * sanitised field by field. `allowBare` additionally accepts a bare profile object (legacy browser storage only).
 */
export function parseBackup(text: string, opts: { allowBare?: boolean } = {}): ImportResult {
  if (text.length > RULES.backup.maxFileBytes) return { ok: false, error: 'tooLarge' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'notJson' }; }
  if (!isObj(raw)) return { ok: false, error: 'notBackup' };

  let version: number, profile: unknown, exportedAt: string | null = null;
  if ('app' in raw || 'profile' in raw || 'version' in raw) {
    if (raw.app !== APP_ID) return { ok: false, error: raw.app === undefined ? 'notBackup' : 'wrongApp' };
    if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) return { ok: false, error: 'badVersion' };
    if (raw.version > CURRENT_VERSION) return { ok: false, error: 'newerVersion' };
    if (raw.version < 2) return { ok: false, error: 'unsupportedVersion' };
    if (!isObj(raw.profile)) return { ok: false, error: 'notBackup' };
    version = raw.version; profile = raw.profile;
    exportedAt = typeof raw.exportedAt === 'string' && !isNaN(Date.parse(raw.exportedAt)) ? raw.exportedAt : null;
  } else if (opts.allowBare && BARE_PROFILE_KEYS.some((k) => k in raw)) {
    version = 2; profile = raw;
  } else return { ok: false, error: 'notBackup' };

  const migrated = migrateProfile(version, profile as Obj);
  const P = sanitizeProfile(migrated);
  return { ok: true, profile: P, version, exportedAt, migratedFrom: version < CURRENT_VERSION ? version : null, summary: summarize(P) };
}

export function serializeBackup(P: Profile, now: Date): string {
  return JSON.stringify({ app: APP_ID, version: CURRENT_VERSION, exportedAt: now.toISOString(), profile: P }, null, 2);
}

export const backupFileName = (now: Date): string => `portfolio-backup-${now.toISOString().slice(0, 10)}.json`;
