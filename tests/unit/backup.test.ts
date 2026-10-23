import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_ID, CURRENT_VERSION, backupFileName, migrateProfile, parseBackup, serializeBackup } from '../../src/profile/backup';
import { blankProfile, sanitizeProfile } from '../../src/profile/schema';

const fakeProfile = JSON.parse(readFileSync('tests/golden/fixtures/profile-fake.json', 'utf8'));
const envelope = (o: Record<string, unknown>) => JSON.stringify({ app: APP_ID, version: 3, exportedAt: '2026-10-23T00:00:00.000Z', profile: {}, ...o });
const err = (text: string, opts?: { allowBare?: boolean }) => { const r = parseBackup(text, opts); return r.ok ? 'ok' : r.error; };

describe('export / import round trip', () => {
  it('serialises the documented envelope', () => {
    const now = new Date('2026-10-23T09:00:00Z');
    const o = JSON.parse(serializeBackup(sanitizeProfile(fakeProfile), now));
    expect(Object.keys(o).sort()).toEqual(['app', 'exportedAt', 'profile', 'version']);
    expect(o.app).toBe('portfolio-pilot');
    expect(o.version).toBe(CURRENT_VERSION);
    expect(o.exportedAt).toBe('2026-10-23T09:00:00.000Z');
    expect(backupFileName(now)).toBe('portfolio-backup-2026-10-23.json');
  });
  it('imports what it exported, losslessly', () => {
    const P = sanitizeProfile({ ...fakeProfile, watchlist: ['zeta'], withdrawal: { years: '25', realRate: '3' }, settings: { benchmarkDate: '2026-03-02', example: false } });
    const r = parseBackup(serializeBackup(P, new Date()));
    expect(r.ok && r.profile).toEqual(P);
    expect(r.ok && r.migratedFrom).toBeNull();
    expect(r.ok && r.summary).toMatchObject({ holdings: 10, funds: 3, trades: 7, watchlist: 1, hasCash: true });
  });
});

describe('migrations', () => {
  it('reads a prototype (v2) backup and upgrades it', () => {
    const { watchlist: _w, ...v2Profile } = fakeProfile; // a v2 profile predates the watchlist
    const r = parseBackup(JSON.stringify({ app: 'portfolio-pilot', version: 2, exportedAt: '2026-01-01T00:00:00Z', profile: v2Profile }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(2);
    expect(r.profile.rows).toHaveLength(10);
    expect(r.profile.settings).toEqual({ benchmarkDate: '', example: false });
    expect(r.profile.watchlist).toEqual([]);
    expect(r.profile.withdrawal).toEqual({ years: '', realRate: '' });
  });
  it('has a migration for every historical version below the current one', () => {
    for (let v = 2; v < CURRENT_VERSION; v++) expect(typeof migrateProfile(v, {})).toBe('object');
    expect(migrateProfile(2, {})).toHaveProperty('watchlist');
  });
  it('keeps user values that already exist in a v2 file', () => {
    expect(migrateProfile(2, { settings: { benchmarkDate: '2026-01-01' } }).settings).toEqual({ benchmarkDate: '2026-01-01' });
  });
});

describe('strict validation', () => {
  it('rejects non-JSON, non-objects and files that are not backups', () => {
    expect(err('{nope')).toBe('notJson');
    expect(err('')).toBe('notJson');
    expect(err('[]')).toBe('notBackup');
    expect(err('5')).toBe('notBackup');
    expect(err('null')).toBe('notBackup');
    expect(err('{"hello":1}')).toBe('notBackup');
  });
  it('rejects the wrong app id and bad or unsupported versions', () => {
    expect(err(envelope({ app: 'other' }))).toBe('wrongApp');
    expect(err(envelope({ app: undefined }))).toBe('notBackup');
    for (const v of ['3', 2.5, -1, 0, null, NaN]) expect(err(envelope({ version: v })), String(v)).toBe('badVersion');
    expect(err(envelope({ version: 1 }))).toBe('unsupportedVersion');
    expect(err(envelope({ version: CURRENT_VERSION + 1 }))).toBe('newerVersion');
  });
  it('rejects a missing or non-object profile', () => {
    for (const p of [null, 'x', [], 5]) expect(err(envelope({ profile: p }))).toBe('notBackup');
  });
  it('rejects oversized files before parsing', () => {
    expect(err('x'.repeat(600 * 1024))).toBe('tooLarge');
  });
  it('accepts a bare profile only when explicitly allowed (legacy browser storage)', () => {
    const bare = JSON.stringify(fakeProfile);
    expect(err(bare)).toBe('notBackup');
    expect(err(bare, { allowBare: true })).toBe('ok');
    expect(err('{"hello":1}', { allowBare: true })).toBe('notBackup');
  });
  it('ignores an invalid exportedAt', () => {
    const r = parseBackup(envelope({ exportedAt: 'yesterday' }));
    expect(r.ok && r.exportedAt).toBeNull();
  });
});

describe('hostile content', () => {
  it('never pollutes prototypes and drops unknown or oversized fields', () => {
    const text = '{"app":"portfolio-pilot","version":3,"profile":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"rows":[{"n":"<img src=x onerror=alert(1)>","t":"A","__proto__":{"x":1}}],"extra":{"deep":1}}}';
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (!r.ok) return;
    expect(Object.keys(r.profile).sort()).toEqual(Object.keys(blankProfile()).sort());
    expect(r.profile.rows[0]?.n).toBe('<img src=x onerror=alert(1)>'); // kept as inert text; escaped at render
  });
  it('clamps huge lists and long strings', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ n: 'x'.repeat(100), t: String(i), q: '1e999' }));
    const r = parseBackup(envelope({ profile: { rows, watchlist: Array.from({ length: 500 }, (_, i) => `T${i}`) } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.rows.length).toBeLessThanOrEqual(60);
    expect(r.profile.rows[0]?.n.length).toBe(40);
    expect(r.profile.watchlist.length).toBeLessThanOrEqual(30);
    expect(r.profile.rows[0]?.q).toBe('');
  });
});

describe('watchlist and withdrawal sanitising', () => {
  it('normalises and de-duplicates watchlist tickers', () => {
    expect(sanitizeProfile({ watchlist: [' adbe ', 'ADBE', 'br k b', '', 5, null] }).watchlist).toEqual(['ADBE', 'BRKB']);
  });
  it('bounds the withdrawal inputs', () => {
    expect(sanitizeProfile({ withdrawal: { years: '100', realRate: '3' } }).withdrawal).toEqual({ years: '', realRate: '3' });
    expect(sanitizeProfile({ withdrawal: { years: '30', realRate: '-60' } }).withdrawal).toEqual({ years: '30', realRate: '' });
  });
});
