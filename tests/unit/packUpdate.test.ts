import { describe, expect, it } from 'vitest';
import { checkPack, JUMP_PCT, STALE_DAYS } from '../../src/data/packCheck';
import { mergePack, parsePackText, sanitizePack, stampPack } from '../../src/data/pack';
import { expectedUsClose } from '../../src/data/tradingDay';
import { packWants } from '../../src/data/packTickers';
import { he } from '../../src/i18n/he';
import { profile, row } from './helpers';

const TODAY = new Date(2026, 9, 26); // 26.10.2026, local
const pk = (o: Record<string, unknown>) => sanitizePack({ asof: '26.10.2026', ...o })!;
const input = (raw: Record<string, unknown>, over: Partial<Parameters<typeof checkPack>[0]> = {}) => ({
  raw, pack: pk(raw), wanted: [] as string[], expectedCur: {} as Record<string, string>, merge: false, previous: null, typed: {}, typedFx: null, today: TODAY, ...over,
});

describe('parsePackText', () => {
  const obj = { tickers: { AAA: { price: 10 } } };
  it('reads bare JSON, a fenced block, and JSON wrapped in a sentence', () => {
    const j = JSON.stringify(obj);
    for (const text of [j, '```json\n' + j + '\n```', 'הנה התשובה:\n```\n' + j + '\n```\nבהצלחה', 'Sure! ' + j + ' Hope this helps.']) {
      expect(parsePackText(text)).toEqual({ ok: true, value: obj });
    }
  });
  it('reports empty, not-JSON and oversized text', () => {
    expect(parsePackText('   ')).toEqual({ ok: false, error: 'empty' });
    expect(parsePackText('אין לי גישה לנתונים עדכניים')).toEqual({ ok: false, error: 'notJson' });
    expect(parsePackText('{ broken')).toEqual({ ok: false, error: 'notJson' });
    expect(parsePackText('x'.repeat(2_000_000))).toEqual({ ok: false, error: 'tooBig' });
  });
});

describe('packWants and the instructions text', () => {
  const P = profile({
    rows: [
      row({ n: 'Alpha', t: 'aaa', q: '123456', k: '777' }), row({ t: 'AAA' }), row({ t: 'BB B', c: 'USD' }),
      row({ n: 'סל "ישראלי"\nשורה', t: '1234567', c: 'ILS', q: '4242' }), row({ n: 'Agorot fund', t: '7654321', c: 'AGO' }), row({ t: '' }), row({ t: 'bad key!', c: 'ILS' }),
    ],
    watchlist: ['ccc', 'bad key!'],
    cashUsd: '98765', mmf: '55555',
  });
  it('asks for every holding with the currency of its row, plus the watchlist in dollars', () => {
    expect(packWants(P)).toEqual([
      { t: '1234567', cur: 'ILS', name: 'סל ישראלי שורה' },
      { t: '7654321', cur: 'AGO', name: 'Agorot fund' },
      { t: 'AAA', cur: 'USD', name: 'Alpha' },
      { t: 'BBB', cur: 'USD', name: '' },
      { t: 'CCC', cur: 'USD', name: '' },
    ]);
  });
  it('the text for the assistant carries symbols, names, row currencies and the date, and no amounts', () => {
    const text = he.packAsk.prompt(packWants(P), '26.10.2026');
    expect(text).toContain('מניות בדולרים: AAA, BBB, CCC');
    expect(text).toContain('- 1234567 | סל ישראלי שורה | בשקלים, cur "ILS"');
    expect(text).toContain('- 7654321 | Agorot fund | באגורות, cur "AGO"');
    expect(text).toContain('26.10.2026');
    for (const secret of ['123456 ', '777', '98765', '55555', '4242']) expect(text).not.toContain(secret);
  });
  it('omits the Israeli block when there are none, and the dollar line when there are none', () => {
    const us = he.packAsk.prompt([{ t: 'AAA', cur: 'USD', name: '' }], '26.10.2026');
    expect(us).not.toContain('ניירות ישראליים (');
    const il = he.packAsk.prompt([{ t: '1234567', cur: 'ILS', name: 'X' }], '26.10.2026');
    expect(il).not.toContain('מניות בדולרים:');
    expect(il).toContain('"1234567": {');
  });
  it('the example structure in the instructions is itself readable by the strict reader once filled in', () => {
    const text = he.packAsk.prompt([{ t: 'AAA', cur: 'USD', name: '' }], '26.10.2026');
    const block = text.slice(text.indexOf('{\n'));
    const nums = ['3.1', '12.5', '0.5', '4'];
    const filled = block.replace(/<DD\.MM\.YYYY>/, '26.10.2026').replace(/<YYYY-MM-DD>/, '2026-11-03').replace(/<שם הנייר>/, 'Alpha').replace(/<טקסט קצר>/, 'Q3').replace(/<מספר>/g, () => nums.shift() as string);
    const pack = sanitizePack(JSON.parse(filled))!;
    expect(pack.fx).toBe(3.1);
    expect(pack.tickers.AAA).toMatchObject({ price: 12.5, cur: 'USD', div: { perShare: 0.5, freq: 4 }, events: [{ d: '2026-11-03', what: 'Q3', st: 'confirmed' }] });
  });
});

describe('checkPack', () => {
  it('flags a price that moved more than the threshold against the previous pack, and not one inside it', () => {
    const previous = pk({ tickers: { AAA: { price: 100 }, BBB: { price: 100 } } });
    const raw = { asof: '26.10.2026', tickers: { AAA: { price: 100 * (1 + (JUMP_PCT + 1) / 100) }, BBB: { price: 100 * (1 + (JUMP_PCT - 1) / 100) } } };
    const r = checkPack(input(raw, { previous }));
    expect(r.rows.find((x) => x.t === 'AAA')).toMatchObject({ jump: true, refFrom: 'pack' });
    expect(r.rows.find((x) => x.t === 'BBB')).toMatchObject({ jump: false });
    expect(r.clean).toBe(false);
  });
  it('falls back to the price the user typed, and says when there is nothing to compare with', () => {
    const raw = { asof: '26.10.2026', tickers: { AAA: { price: 10 }, BBB: { price: 10 } } };
    const r = checkPack(input(raw, { typed: { AAA: 5 } }));
    expect(r.rows.find((x) => x.t === 'AAA')).toMatchObject({ ref: 5, refFrom: 'typed', changePct: 100, jump: true });
    expect(r.rows.find((x) => x.t === 'BBB')).toMatchObject({ ref: null, refFrom: null, changePct: null, jump: false });
  });
  it('lists wanted tickers that are missing, entries the strict reader rejected, and ones that would disappear', () => {
    const previous = pk({ tickers: { OLD: { price: 3 }, AAA: { price: 10 } } });
    const raw = { asof: '26.10.2026', tickers: { AAA: { price: 10 }, BAD: { price: -4 }, EXTRA: { price: 2 } } };
    const r = checkPack(input(raw, { wanted: ['AAA', 'CCC', 'BAD'], previous }));
    expect(r.missing).toEqual(['CCC']);
    expect(r.rejected).toEqual(['BAD']);
    expect(r.dropped).toEqual(['OLD']);
    expect(r.extra).toBe(1);
  });
  it('checks the data date: missing, old, in the future, and today is fine', () => {
    const tk = { AAA: { price: 10 } };
    expect(checkPack(input({ tickers: tk }, { pack: sanitizePack({ tickers: tk })! })).noDate).toBe(true);
    expect(checkPack(input({ asof: '26.10.2026', tickers: tk })).clean).toBe(true);
    const old = checkPack(input({ asof: '15.10.2026', tickers: tk }));
    expect(old.stale).toBe(true); expect(old.ageDays).toBe(11);
    expect(checkPack(input({ asof: `${26 - STALE_DAYS}.10.2026`, tickers: tk })).stale).toBe(false);
    expect(checkPack(input({ asof: '09.11.2026', tickers: tk })).future).toBe(true);
  });
  it('flags a large move in the dollar rate', () => {
    expect(checkPack(input({ asof: '26.10.2026', fx: 3.5, tickers: { AAA: { price: 10 } } }, { typedFx: 3.0 })).fx).toMatchObject({ jump: true });
    expect(checkPack(input({ asof: '26.10.2026', fx: 3.05, tickers: { AAA: { price: 10 } } }, { typedFx: 3.0 })).fx).toMatchObject({ jump: false });
  });
  it('flags a currency that differs from the row, and treats a missing currency as dollars', () => {
    const raw = { asof: '26.10.2026', tickers: { US: { price: 1 }, IL: { price: 2, cur: 'ILS' }, AG: { price: 3, cur: 'ILS' }, NOCUR: { price: 4 } } };
    const r = checkPack(input(raw, { expectedCur: { IL: 'ILS', AG: 'AGO', NOCUR: 'ILS' } }));
    const by = (t: string) => r.rows.find((x) => x.t === t)!;
    expect(by('US')).toMatchObject({ curMismatch: false, expected: 'USD' });
    expect(by('IL')).toMatchObject({ curMismatch: false });
    expect(by('AG')).toMatchObject({ curMismatch: true, expected: 'AGO', stated: 'ILS' });
    expect(by('NOCUR')).toMatchObject({ curMismatch: true, stated: null });
    expect(r.clean).toBe(false);
  });
  it('spots a probable agorot/shekel mix-up: a price about 100x or 1/100 of the reference', () => {
    const raw = { asof: '26.10.2026', tickers: { UP: { price: 4250 }, DOWN: { price: 0.4 }, NORMAL: { price: 60 }, BIG: { price: 700 } } };
    const r = checkPack(input(raw, { typed: { UP: 42.5, DOWN: 40, NORMAL: 42.5, BIG: 7 } }));
    const by = (t: string) => r.rows.find((x) => x.t === t)!;
    expect(by('UP')).toMatchObject({ unitMix: true, jump: true });
    expect(by('DOWN')).toMatchObject({ unitMix: true, jump: true });
    expect(by('NORMAL')).toMatchObject({ unitMix: false, jump: true });
    expect(by('BIG')).toMatchObject({ unitMix: true });
  });
  it('reports nothing wrong for a sensible answer', () => {
    const previous = pk({ tickers: { AAA: { price: 10 } } });
    const r = checkPack(input({ asof: '26.10.2026', tickers: { AAA: { price: 10.4 } } }, { wanted: ['AAA'], previous }));
    expect(r.clean).toBe(true);
  });
});

describe('expectedUsClose (the latest US session that should already be published)', () => {
  const at = (iso: string) => expectedUsClose(new Date(iso));
  it('uses today once the session has closed, and the previous weekday before the close', () => {
    expect(at('2026-10-26T21:00:00Z')).toBe('2026-10-26');  // Monday 17:00 New York (summer time): closed
    expect(at('2026-10-26T20:10:00Z')).toBe('2026-10-23');  // Monday 16:10: inside the publishing allowance, still Friday
    expect(at('2026-10-26T14:00:00Z')).toBe('2026-10-23');  // Monday 10:00: open, last close is Friday
  });
  it('rolls weekends back to Friday and a Tuesday morning back to Monday', () => {
    expect(at('2026-10-24T18:00:00Z')).toBe('2026-10-23');  // Saturday
    expect(at('2026-10-25T18:00:00Z')).toBe('2026-10-23');  // Sunday
    expect(at('2026-10-27T08:00:00Z')).toBe('2026-10-26');  // Tuesday 04:00 New York
  });
  it('follows New York time across the daylight-saving change', () => {
    expect(at('2026-11-03T21:30:00Z')).toBe('2026-11-03');  // Tuesday 16:30 EST
    expect(at('2026-11-03T21:20:00Z')).toBe('2026-11-02');  // 16:20 EST: not yet
  });
});

describe('checkPack: answer older than the latest published close', () => {
  const answer = (asof: string) => ({ asof, tickers: { AAA: { price: 10 } } });
  const now = new Date('2026-10-26T20:09:00Z'); // Monday 23:09 in Israel (winter time), 16:09 in New York (summer time)
  const later = new Date('2026-10-26T21:09:00Z'); // an hour later: the close is published
  it('flags Friday data after Monday\'s close, and accepts it before', () => {
    expect(checkPack(input(answer('23.10.2026'), { today: later })).behindMarket).toBe('2026-10-26');
    expect(checkPack(input(answer('23.10.2026'), { today: later })).clean).toBe(false);
    expect(checkPack(input(answer('23.10.2026'), { today: now })).behindMarket).toBeNull();
    expect(checkPack(input(answer('26.10.2026'), { today: later })).behindMarket).toBeNull();
  });
  it('does not apply to an answer with no dollar entries', () => {
    const raw = { asof: '23.10.2026', tickers: { '111': { price: 10, cur: 'ILS' } } };
    expect(checkPack(input(raw, { today: later })).behindMarket).toBeNull();
  });
});

describe('per-entry dates, stamping and merging', () => {
  const A = pk({ asof: '23.10.2026', fx: 3.0, tickers: { AAA: { price: 10 }, BBB: { price: 20 }, CCC: { price: 30 } } });
  const B = pk({ asof: '26.10.2026', fx: 3.1, tickers: { AAA: { price: 11 }, DDD: { price: 40 } } });
  it('reads an entry date in either format and drops a malformed one', () => {
    const p = sanitizePack({ tickers: { A1: { price: 1, asof: '2026-10-20' }, A2: { price: 1, asof: '20.10.2026' }, A3: { price: 1, asof: 'yesterday' } } })!;
    expect([p.tickers.A1?.asof, p.tickers.A2?.asof, p.tickers.A3?.asof]).toEqual(['2026-10-20', '2026-10-20', undefined]);
  });
  it('stamps every entry with the pack date unless it has its own, and does nothing without a pack date', () => {
    const s = stampPack(pk({ asof: '26.10.2026', tickers: { X: { price: 1 }, Y: { price: 2, asof: '2026-10-20' } } }));
    expect([s.tickers.X?.asof, s.tickers.Y?.asof]).toEqual(['2026-10-26', '2026-10-20']);
    const none = sanitizePack({ tickers: { X: { price: 1 } } })!;
    expect(stampPack(none)).toBe(none);
  });
  it('a merge keeps what the new answer lacks (with its own date), lets new entries win, and takes pack-wide values from the new one', () => {
    const M = mergePack(A, B);
    expect(Object.keys(M.tickers).sort()).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(M.tickers.AAA).toMatchObject({ price: 11, asof: '2026-10-26' });
    expect(M.tickers.BBB).toMatchObject({ price: 20, asof: '2026-10-23' });
    expect(M.tickers.DDD).toMatchObject({ price: 40, asof: '2026-10-26' });
    expect(M.fx).toBe(3.1);
    expect(M.asof).toBe('26.10.2026');
  });
  it('keeps the previous fx and history when the new answer has none, and never moves the pack date backwards', () => {
    const older = pk({ asof: '20.10.2026', tickers: { ZZZ: { price: 5 } } });
    const M = mergePack(A, older);
    expect(M.fx).toBe(3.0);
    expect(M.asof).toBe('23.10.2026');
    expect(mergePack(null, B).tickers.AAA?.asof).toBe('2026-10-26');
  });
  it('the check lists kept entries with their age in merge mode, drops them from "missing", and flags old ones', () => {
    const raw = { asof: '26.10.2026', tickers: { AAA: { price: 11 } } };
    const m = checkPack(input(raw, { previous: A, merge: true, wanted: ['AAA', 'BBB', 'ZZZ'] }));
    expect(m.kept.map((k) => [k.t, k.asofIso, k.ageDays])).toEqual([['BBB', '2026-10-23', 3], ['CCC', '2026-10-23', 3]]);
    expect(m.missing).toEqual(['ZZZ']);
    expect(m.dropped).toEqual([]);
    const r = checkPack(input(raw, { previous: A, merge: false, wanted: ['AAA', 'BBB'] }));
    expect(r.kept).toEqual([]);
    expect(r.dropped).toEqual(['BBB', 'CCC']);
    expect(r.missing).toEqual(['BBB']);
    const old = checkPack(input({ asof: '26.10.2026', tickers: { AAA: { price: 11 } } }, { previous: pk({ asof: '01.10.2026', tickers: { AAA: { price: 10 }, OLD: { price: 3 } } }), merge: true }));
    expect(old.kept[0]).toMatchObject({ t: 'OLD', ageDays: 25 });
    expect(old.clean).toBe(false);
  });
});
