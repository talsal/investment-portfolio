import { describe, expect, it } from 'vitest';
import { checkPack, JUMP_PCT, STALE_DAYS } from '../../src/data/packCheck';
import { parsePackText, sanitizePack } from '../../src/data/pack';
import { packTickers } from '../../src/data/packTickers';
import { he } from '../../src/i18n/he';
import { profile, row } from './helpers';

const TODAY = new Date(2026, 9, 26); // 26.10.2026, local
const pk = (o: Record<string, unknown>) => sanitizePack({ asof: '26.10.2026', ...o })!;
const input = (raw: Record<string, unknown>, over: Partial<Parameters<typeof checkPack>[0]> = {}) => ({
  raw, pack: pk(raw), wanted: [] as string[], previous: null, typed: {}, typedFx: null, today: TODAY, ...over,
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

describe('packTickers and the instructions text', () => {
  const P = profile({
    rows: [row({ t: 'aaa', q: '123456', k: '777' }), row({ t: 'AAA' }), row({ t: 'BB B', c: 'USD' }), row({ t: '1234567', c: 'ILS' }), row({ t: 'ZZZ', c: 'AGO' }), row({ t: '' })],
    watchlist: ['ccc', 'bad key!'],
    cashUsd: '98765', mmf: '55555',
  });
  it('asks only for dollar holdings and the watchlist, as symbols', () => {
    expect(packTickers(P)).toEqual(['AAA', 'BBB', 'CCC']);
  });
  it('the text for the assistant carries symbols and the date, and nothing else from the profile', () => {
    const text = he.packAsk.prompt(packTickers(P), '26.10.2026');
    expect(text).toContain('AAA, BBB, CCC');
    expect(text).toContain('26.10.2026');
    for (const secret of ['123456', '777', '98765', '55555', '1234567']) expect(text).not.toContain(secret);
  });
  it('the example structure in the instructions is itself readable by the strict reader once filled in', () => {
    const text = he.packAsk.prompt(['AAA'], '26.10.2026');
    const block = text.slice(text.indexOf('{\n'));
    const nums = ['3.1', '12.5', '0.5', '4'];
    const filled = block.replace(/<DD\.MM\.YYYY>/, '26.10.2026').replace(/<YYYY-MM-DD>/, '2026-11-03').replace(/<שם החברה>/, 'Alpha').replace(/<טקסט קצר>/, 'Q3').replace(/<מספר>/g, () => nums.shift() as string);
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
  it('flags a large move in the dollar rate and a pack priced in a currency other than dollars', () => {
    const r = checkPack(input({ asof: '26.10.2026', fx: 3.5, tickers: { AAA: { price: 10, cur: 'ILS' } } }, { typedFx: 3.0 }));
    expect(r.fx).toMatchObject({ jump: true });
    expect(r.rows[0]).toMatchObject({ notUsd: true });
    expect(r.clean).toBe(false);
    expect(checkPack(input({ asof: '26.10.2026', fx: 3.05, tickers: { AAA: { price: 10 } } }, { typedFx: 3.0 })).fx).toMatchObject({ jump: false });
  });
  it('reports nothing wrong for a sensible answer', () => {
    const previous = pk({ tickers: { AAA: { price: 10 } } });
    const r = checkPack(input({ asof: '26.10.2026', tickers: { AAA: { price: 10.4 } } }, { wanted: ['AAA'], previous }));
    expect(r.clean).toBe(true);
  });
});
