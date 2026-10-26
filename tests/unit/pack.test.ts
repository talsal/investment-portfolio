import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyPack, MAX_PACK_CHARS, sanitizePack } from '../../src/data/pack';
import { freshness } from '../../src/data/freshness';
import { parseBackup, serializeBackup } from '../../src/profile/backup';
import { sanitizeProfile } from '../../src/profile/schema';
import { compute } from '../../src/calc/portfolio';
import { market, profile, row } from './helpers';

const pack = JSON.parse(readFileSync('tests/golden/fixtures/pack-fake.json', 'utf8'));

describe('sanitizePack', () => {
  it('keeps a valid pack, losslessly for the fields the app uses', () => {
    const p = sanitizePack(pack)!;
    expect(p.asof).toBe(pack.asof);
    expect(p.fx).toBe(pack.fx);
    expect(p.hist).toEqual(pack.hist);
    expect(p.bm).toMatchObject({ date: pack.bm.date, spyBase: pack.bm.spyBase, spyCur: pack.bm.spyCur });
    for (const [s, t] of Object.entries<any>(pack.tickers)) {
      expect(p.tickers[s]?.price).toBe(t.price);
      expect(p.tickers[s]?.bf).toEqual(t.bf);
      expect(p.tickers[s]?.events).toEqual(t.events);
      expect(p.tickers[s]?.div).toEqual(t.div);
      expect(p.tickers[s]?.base).toEqual(t.base);
    }
  });
  it('rejects things that are not packs, are empty, or are too large', () => {
    for (const bad of [null, 5, 'x', [], {}, { tickers: {} }, { tickers: { A: { price: -1 } } }]) expect(sanitizePack(bad)).toBeNull();
    expect(sanitizePack({ tickers: { A: { price: 1, name: 'x'.repeat(MAX_PACK_CHARS) } } })).toBeNull();
  });
  it('drops unknown fields, bad types and markup-bearing keys; keeps good siblings', () => {
    const p = sanitizePack({ evil: '<script>', tickers: { 'bad key!': { price: 5 }, aaa: { price: 10, name: 5, cur: 'USD', __proto__: { x: 1 }, bf: { moat: 'great', growth: 'up', epsF: '7', fcfPs: 3, extra: 1 }, events: [{ d: 'x', what: 'a' }, { d: '2026-11-01', what: 'ok', st: 'confirmed' }], div: { perShare: -1 } } } })!;
    expect(Object.keys(p.tickers)).toEqual(['AAA']);
    expect(p.tickers.AAA).toEqual({ price: 10, cur: 'USD', bf: { growth: 'up', fcfPs: 3 }, events: [{ d: '2026-11-01', what: 'ok', st: 'confirmed' }] });
    expect(({} as any).x).toBeUndefined();
  });
  it('validates history strictly (alignment, order, positivity)', () => {
    const base = { tickers: { A: { price: 1 } } };
    expect(sanitizePack({ ...base, hist: { dates: ['2026-01-02', '2026-01-03'], spy: [1, 2], close: { A: [1, 2], B: [1] } } })!.hist?.close).toEqual({ A: [1, 2] });
    for (const hist of [{ dates: ['2026-01-03', '2026-01-02'], spy: [1, 2], close: {} }, { dates: ['2026-01-02', '2026-01-03'], spy: [1, 0], close: {} }, { dates: ['x', 'y'], spy: [1, 2], close: {} }, { dates: ['2026-01-02'], spy: [1], close: {} }]) {
      expect(sanitizePack({ ...base, hist })!.hist).toBeUndefined();
    }
  });
});

describe('applyPack', () => {
  const site = market({ asof: '01.01.2026', fx: 3, cpi: { yoyPct: 1, label: 'x' }, tickers: { AAA: { price: 1 }, SITE: { price: 2 } }, meta: { groups: {}, fundamentalsAsof: {}, analysisAsof: {}, draftsShown: [], stalePrices: [], cpiAsof: null, historyAsof: null } });
  it('pack values win, site-only tickers stay, provenance becomes the pack', () => {
    const M = applyPack(site, sanitizePack({ asof: '23.10.2026', fx: 3.2, tickers: { AAA: { price: 9 } } })!);
    expect(M.tickers.AAA?.price).toBe(9);
    expect(M.tickers.SITE?.price).toBe(2);
    expect(M.fx).toBe(3.2);
    expect(M.asof).toBe('23.10.2026');
    expect(M.cpi).toEqual({ yoyPct: 1, label: 'x' });
    expect(M.meta?.personalPack).toEqual({ asof: '2026-10-23' });
  });
  it('a price left blank in the profile is filled from the pack', () => {
    const M = applyPack(site, sanitizePack({ tickers: { AAA: { price: 9 } } })!);
    const C = compute(profile({ fx: '1', rows: [row({ t: 'AAA', q: '2' }), row({ t: 'AAA', q: '2', p: '100' })] }), M);
    expect(C.items.map((i) => i.valNis).sort((a, b) => a - b)).toEqual([18, 200]);
  });
  it('does not change the site data object', () => {
    const before = JSON.stringify(site);
    applyPack(site, sanitizePack({ tickers: { AAA: { price: 9 } } })!);
    expect(JSON.stringify(site)).toBe(before);
  });
  it('freshness shows only the pack, with its date', () => {
    const M = applyPack(site, sanitizePack({ asof: '23.10.2026', tickers: { AAA: { price: 9 } } })!);
    const items = freshness(M, new Date(2026, 9, 23));
    expect(items).toEqual([{ id: 'pack', level: 'ok', asof: '2026-10-23', ageDays: 0, source: null }]);
    expect(freshness(M, new Date(2026, 9, 30))[0]?.level).toBe('stale');
  });
});

describe('the pack travels inside the profile file', () => {
  it('survives sanitising, export and import; oversized packs are dropped, not truncated', () => {
    const P = sanitizeProfile({ dataPack: pack });
    expect(P.dataPack?.tickers.ALFA?.price).toBe(pack.tickers.ALFA.price);
    const r = parseBackup(serializeBackup(P, new Date()));
    expect(r.ok && r.profile.dataPack).toEqual(P.dataPack);
    expect(sanitizeProfile({ dataPack: { tickers: { A: { price: 1, name: 'x'.repeat(MAX_PACK_CHARS) } } } }).dataPack).toBeNull();
    expect(sanitizeProfile({}).dataPack).toBeNull();
  });
});
