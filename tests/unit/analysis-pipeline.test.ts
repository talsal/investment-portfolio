import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeError, type Completer } from '../../scripts/analysis/anthropic';
import { approveDraft } from '../../scripts/analysis/approve';
import { generateDrafts, prBody } from '../../scripts/analysis/generate';
import { buildUserPrompt, OUTPUT_SCHEMA, SYSTEM_PROMPT, type AnalysisInput } from '../../scripts/analysis/prompt';
import { selectSymbols } from '../../scripts/analysis/select';
import { toDraft, ungroundedNumbers } from '../../scripts/analysis/validate-draft';
import { validateData } from '../../scripts/data/validate-data';
import { composeMarket, emptyBundle } from '../../src/data/compose';
import { freshness } from '../../src/data/freshness';
import { DataLoader, type Fetcher } from '../../src/data/loader';
import { parseAnalysisFile, parseMarketFile } from '../../src/data/validate';
import type { AnalysisFile, FundamentalsFile } from '../../src/data/schema';

const NOW = new Date('2026-10-23T09:00:00Z');
const fund = (asof = '2026-10-20'): FundamentalsFile => ({ schema: 1, symbol: 'AAA', source: 'finnhub', asof, fetchedAt: 'x', inputs: { epsT: 7.298, epsF: 11.99, fcfPs: 10.95, fcfTrend: 12.4, roe: 21.5 }, base: ['+11.3%', '+34.2%', '+12.4%', '10.3% ← 18.7%', '67.5% ← 66.4%'] });
const input = (over: Partial<AnalysisInput> = {}): AnalysisInput => ({ symbol: 'AAA', name: 'אאא', price: 117.15, priceAsof: '2026-10-22', fundamentals: fund(), today: '2026-10-23', ...over });
const good = { moat: 'ok', moatTxt: 'צר, מתפתח · ROIC עלה', growth: 'slow', growthTxt: 'הכנסות +11.3% בשנה; כעת האטה', track: 'צמיחת הענן', cyclical: false, confidence: 'medium', uncertainties: ['לא ידוע על שינויים אחרונים'], peNotes: [], fcfNotes: [] };
const approved = (extra: Partial<AnalysisFile> = {}): AnalysisFile => ({ schema: 1, symbol: 'AAA', status: 'approved', asof: '2026-06-01', reviewedBy: 'Owner', reviewedAt: '2026-06-02', moat: 'ok', growth: 'up', ...extra });

describe('parseAnalysisFile: approval needs a human', () => {
  const base = { schema: 1, symbol: 'AAA', asof: '2026-10-01', moat: 'ok' };
  it('ignores an approved file with no reviewer or no review date', () => {
    expect(parseAnalysisFile({ ...base, status: 'approved' })).toBeNull();
    expect(parseAnalysisFile({ ...base, status: 'approved', reviewedBy: 'X' })).toBeNull();
    expect(parseAnalysisFile({ ...base, status: 'approved', reviewedBy: '   ', reviewedAt: '2026-10-02' })).toBeNull();
    expect(parseAnalysisFile({ ...base, status: 'approved', reviewedBy: 'X', reviewedAt: 'yesterday' })).toBeNull();
    expect(parseAnalysisFile({ ...base, status: 'approved', reviewedBy: 'X', reviewedAt: '2026-10-02' })).not.toBeNull();
  });
  it('a .draft.json must be a draft', () => {
    expect(parseAnalysisFile({ ...base, status: 'approved', reviewedBy: 'X', reviewedAt: '2026-10-02' }, 'draft')).toBeNull();
    expect(parseAnalysisFile({ ...base, status: 'draft' }, 'draft')).not.toBeNull();
  });
  it('validates provenance fields', () => {
    expect(parseAnalysisFile({ ...base, status: 'draft', confidence: 'certain' })).toBeNull();
    expect(parseAnalysisFile({ ...base, status: 'draft', flags: ['a'], uncertainties: ['b'], model: 'm', generatedAt: 't', confidence: 'low' })).not.toBeNull();
    expect(parseAnalysisFile({ ...base, status: 'draft', flags: Array(20).fill('x') })).toBeNull();
  });
});

describe('prompt', () => {
  it('contains the supplied numbers, the date, and the previous approved text', () => {
    const p = buildUserPrompt(input({ previous: approved({ moatTxt: 'טקסט קודם' }) }));
    for (const x of ['2026-10-23', 'AAA (אאא)', '117.15', '7.298', '11.99', '10.95', '12.4', '21.5', '+11.3%', 'טקסט קודם', 'reviewed 2026-06-02']) expect(p).toContain(x);
    expect(p).not.toContain('undefined');
    expect(p).not.toContain('null');
  });
  it('says n/a for missing inputs instead of inventing them', () => {
    const f = { ...fund(), inputs: { epsT: null } };
    expect(buildUserPrompt(input({ fundamentals: f }))).toMatch(/forward EPS: n\/a/);
  });
  it('uses forward EPS from the owner-supplied manual file when the provider lacks it', () => {
    const f = { ...fund(), inputs: {} };
    const p = buildUserPrompt(input({ fundamentals: f, manual: { schema: 1, symbol: 'AAA', asof: '2026-10-01', inputs: { epsF: 13.4 } } }));
    expect(p).toMatch(/forward EPS: 13.4/);
  });
  it('the system prompt forbids advice and lists every enum value the schema allows', () => {
    expect(SYSTEM_PROMPT).toMatch(/No recommendations/);
    for (const v of [...OUTPUT_SCHEMA.properties.moat.enum, ...OUTPUT_SCHEMA.properties.growth.enum]) expect(SYSTEM_PROMPT).toContain(`"${v}"`);
  });
  it('never contains personal data (guard against pasting real holdings into the prompt)', () => {
    expect(SYSTEM_PROMPT + buildUserPrompt(input())).not.toMatch(/₪|portfolio|quantity|shares owned/i);
  });
  it('schema and the app agree on the vocabulary', () => {
    for (const m of OUTPUT_SCHEMA.properties.moat.enum) expect(parseAnalysisFile({ schema: 1, symbol: 'A', status: 'draft', asof: '2026-10-01', moat: m })).not.toBeNull();
    for (const g of OUTPUT_SCHEMA.properties.growth.enum) expect(parseAnalysisFile({ schema: 1, symbol: 'A', status: 'draft', asof: '2026-10-01', growth: g })).not.toBeNull();
  });
});

describe('toDraft', () => {
  const run = (raw: unknown, i = input()) => toDraft(raw, i, buildUserPrompt(i), { model: 'claude-opus-5-5', now: NOW });
  it('turns a good response into a draft with provenance, never approved', () => {
    const r = run({ ...good, status: 'approved', reviewedBy: 'model', reviewedAt: '2026-10-23' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft).toMatchObject({ status: 'draft', symbol: 'AAA', asof: '2026-10-23', model: 'claude-opus-5-5', generatedAt: NOW.toISOString(), moat: 'ok', growth: 'slow' });
    expect(r.draft.reviewedBy).toBeUndefined();
    expect(r.draft.reviewedAt).toBeUndefined();
    expect(r.draft.flags).toBeUndefined();
  });
  it('rejects structurally bad responses', () => {
    for (const bad of [null, 'x', [], { ...good, moat: 'great' }, { ...good, growth: 'boom' }, { ...good, moatTxt: '' }, { ...good, track: '   ' }, { ...good, confidence: 'sure' }, { ...good, cyclical: 'no' }]) {
      expect(run(bad).ok, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
  it('rejects text that is not Hebrew, too long, or contains markup or links', () => {
    expect(run({ ...good, moatTxt: 'a narrow moat' })).toMatchObject({ ok: false, reason: expect.stringContaining('not Hebrew') });
    expect(run({ ...good, growthTxt: 'א'.repeat(300) })).toMatchObject({ ok: false, reason: expect.stringContaining('longer') });
    expect(run({ ...good, moatTxt: 'צר <b>מאוד</b>' })).toMatchObject({ ok: false, reason: expect.stringContaining('markup') });
    expect(run({ ...good, track: 'ראו https://example.com' })).toMatchObject({ ok: false, reason: expect.stringContaining('link') });
  });
  it('rejects anything that reads as advice, in Hebrew or English', () => {
    for (const t of ['מומלץ לקנות את המניה', 'כדאי למכור בקרוב', 'מחיר יעד גבוה', 'המניה מוערכת בחסר', 'המניה אטרקטיבית', 'a clear buy', 'overweight vs peers']) {
      const r = run({ ...good, moatTxt: `חפיר צר. ${t}`, growthTxt: good.growthTxt });
      expect(r, t).toMatchObject({ ok: false, reason: 'text reads as investment advice' });
    }
    // describing the business is fine, including the word "מכירות" (sales)
    expect(run({ ...good, growthTxt: 'מכירות באותן חנויות +3.8%; הכנסות יציבות' }).ok).toBe(true);
  });
  it('flags (does not reject) numbers that are not in the supplied inputs, and low confidence', () => {
    const r = run({ ...good, growthTxt: 'הכנסות +14% בשנה ו-ROIC 19%', confidence: 'low' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.flags?.join(' ')).toMatch(/not in the supplied inputs: 14, 19/);
    expect(r.draft.flags).toContain('model reported low confidence');
  });
  it('caps and cleans list fields', () => {
    const r = run({ ...good, uncertainties: ['', ...Array(12).fill('נקודה')], peNotes: [5, 'הערה'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.uncertainties?.length).toBe(8);
    expect(r.draft.peNotes).toEqual(['הערה']);
  });
});

describe('ungroundedNumbers', () => {
  it('knows numbers from the input, ignores years and quarter numbers, normalises formats', () => {
    const inputText = 'EPS 7.298 FCF 12.4 revenue +11.3%';
    expect(ungroundedNumbers(['הכנסות 11.3% ו-12.40'], inputText)).toEqual([]);
    expect(ungroundedNumbers(['דוח רבעון 3 2026'], inputText)).toEqual([]);
    expect(ungroundedNumbers(['מרווח 31,5%', 'ROIC 19%'], inputText)).toEqual(['19', '31.5']);
  });
});

describe('selectSymbols', () => {
  const universe = { schema: 1, benchmark: 'SPY', tickers: ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((symbol) => ({ symbol })) };
  const base = (over: Record<string, unknown> = {}) => ({
    universe, today: '2026-10-23', maxAgeDays: 100, max: 5,
    fundamentals: (s: string) => ({ ...fund('2026-10-20'), symbol: s }), published: () => null, draft: () => null, hasPrice: () => true, ...over,
  }) as Parameters<typeof selectSymbols>[0];
  it('selects stocks without approved analysis', () => {
    const r = selectSymbols(base());
    expect(r.selected.map((x) => x.symbol)).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
    expect(r.selected.every((x) => x.reason === 'missing')).toBe(true);
  });
  it('treats a draft-status published file as missing', () => {
    const r = selectSymbols(base({ published: () => approved({ status: 'draft', reviewedBy: undefined, reviewedAt: undefined }) }));
    expect(r.selected).toHaveLength(5);
  });
  it('skips current analysis, selects stale and newer-fundamentals ones, most urgent first', () => {
    const pub: Record<string, AnalysisFile | null> = {
      AAA: approved({ asof: '2026-10-01', reviewedAt: '2026-10-02' }), // current
      BBB: approved({ asof: '2026-05-01', reviewedAt: '2026-05-02' }), // stale (>100 days)
      CCC: approved({ asof: '2026-10-01', reviewedAt: '2026-10-02' }), // fundamentals newer (10-20 > 10-01)
      DDD: null,
    };
    const r = selectSymbols(base({ published: (s: string) => pub[s] ?? null, fundamentals: (s: string) => ({ ...fund(s === 'AAA' ? '2026-09-30' : '2026-10-20'), symbol: s }) }));
    expect(r.selected).toEqual([{ symbol: 'DDD', reason: 'missing' }, { symbol: 'EEE', reason: 'missing' }, { symbol: 'BBB', reason: 'stale' }, { symbol: 'CCC', reason: 'newer-fundamentals' }]);
    expect(r.skipped).toContainEqual({ symbol: 'AAA', reason: 'up-to-date' });
  });
  it('needs fundamentals and a price; leaves pending drafts alone; honours the limit', () => {
    const r = selectSymbols(base({ max: 1, fundamentals: (s: string) => (s === 'AAA' ? null : { ...fund(), symbol: s }), hasPrice: (s: string) => s !== 'BBB', draft: (s: string) => (s === 'CCC' ? approved({ status: 'draft' }) : null) }));
    expect(r.selected).toEqual([{ symbol: 'DDD', reason: 'missing' }]);
    expect(r.skipped).toEqual(expect.arrayContaining([{ symbol: 'AAA', reason: 'no-fundamentals' }, { symbol: 'BBB', reason: 'no-price' }, { symbol: 'CCC', reason: 'draft-pending' }, { symbol: 'EEE', reason: 'over-limit' }]));
  });
  it('explicit symbols bypass up-to-date and pending checks but not data requirements', () => {
    const r = selectSymbols(base({ only: ['aaa', 'ccc'], published: () => approved({ asof: '2026-10-22', reviewedAt: '2026-10-22' }), draft: () => approved({ status: 'draft' }), fundamentals: (s: string) => (s === 'CCC' ? null : { ...fund(), symbol: s }) }));
    expect(r.selected).toEqual([{ symbol: 'AAA', reason: 'requested' }]);
    expect(r.skipped).toEqual([{ symbol: 'CCC', reason: 'no-fundamentals' }]);
  });
});

describe('generateDrafts', () => {
  let dir: string;
  const read = (rel: string) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));
  const put = (rel: string, v: unknown) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), JSON.stringify(v)); };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ana-'));
    put('universe.json', { schema: 1, benchmark: 'SPY', tickers: [{ symbol: 'AAA', name: 'אאא' }, { symbol: 'BBB' }] });
    put('market.json', { schema: 1, generatedAt: 'x', groups: {}, tickers: { AAA: { price: 117.15, asof: '2026-10-22', currency: 'USD' }, BBB: { price: 50, asof: '2026-10-22', currency: 'USD' } } });
    put('fundamentals/AAA.json', fund());
    put('fundamentals/BBB.json', { ...fund(), symbol: 'BBB' });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const calls: Array<[string, string]> = [];
  const completer = (reply: (u: string) => string | Error): Completer => async (s, u) => { calls.push([s, u]); const r = reply(u); if (r instanceof Error) throw r; return { text: r, model: 'claude-opus-5-5', usage: { input: 1000, output: 400 } }; };
  const opts = (c: Completer | null, extra = {}) => ({ dataDir: dir, completer: c, model: 'claude-opus-5-5', now: NOW, max: 5, maxAgeDays: 100, ...extra });

  it('writes drafts only; never a published file, never approved', async () => {
    calls.length = 0;
    const s = await generateDrafts(opts(completer(() => JSON.stringify(good))));
    expect(s.outcomes.map((o) => o.status)).toEqual(['drafted', 'drafted']);
    expect(existsSync(join(dir, 'analysis/AAA.json'))).toBe(false);
    const d = read('analysis/AAA.draft.json');
    expect(d.status).toBe('draft');
    expect(d.reviewedBy).toBeUndefined();
    expect(parseMarketFile(read('market.json'))!.tickers.AAA?.has).toEqual(['fundamentals', 'draft']);
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toBe(SYSTEM_PROMPT);
    expect(validateData(dir).filter((p) => !p.includes('universe'))).toEqual([]);
  });
  it('leaves an existing approved analysis untouched', async () => {
    put('analysis/AAA.json', approved({ asof: '2026-05-01', reviewedAt: '2026-05-02' }));
    const before = readFileSync(join(dir, 'analysis/AAA.json'), 'utf8');
    await generateDrafts(opts(completer(() => JSON.stringify(good)), { only: ['AAA'] }));
    expect(readFileSync(join(dir, 'analysis/AAA.json'), 'utf8')).toBe(before);
    expect(existsSync(join(dir, 'analysis/AAA.draft.json'))).toBe(true);
  });
  it('rejects bad model output without writing, and reports errors without leaking them', async () => {
    const s = await generateDrafts(opts(completer((u) => (u.includes('Symbol: AAA') ? 'not json' : JSON.stringify({ ...good, moatTxt: 'כדאי לקנות עכשיו' })))));
    expect(s.outcomes.map((o) => `${o.symbol}:${o.status}`)).toEqual(['AAA:rejected', 'BBB:rejected']);
    expect(existsSync(join(dir, 'analysis'))).toBe(false);
    const e = await generateDrafts(opts(completer(() => new Error('boom'))));
    expect(e.outcomes.every((o) => o.status === 'error')).toBe(true);
  });
  it('dry run calls nothing and writes nothing', async () => {
    calls.length = 0;
    const logs: string[] = [];
    const s = await generateDrafts(opts(null, { dryRun: true, log: (l: string) => logs.push(l) }));
    expect(s.outcomes).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(logs.join('\n')).toContain('INPUT');
    expect(existsSync(join(dir, 'analysis'))).toBe(false);
  });
  it('does not redo a stock that already has a pending draft, and respects the limit', async () => {
    put('analysis/AAA.draft.json', { schema: 1, symbol: 'AAA', status: 'draft', asof: '2026-10-01' });
    const s = await generateDrafts(opts(completer(() => JSON.stringify(good)), { max: 1 }));
    expect(s.outcomes.map((o) => o.symbol)).toEqual(['BBB']);
    expect(s.skipped).toContainEqual({ symbol: 'AAA', reason: 'draft-pending' });
  });
  it('builds a PR body with the table, warnings and approval steps', async () => {
    const s = await generateDrafts(opts(completer(() => JSON.stringify({ ...good, growthTxt: 'הכנסות +14%' }))));
    const body = prBody(s, '2026-10-23');
    for (const x of ['Nothing in this PR is published', '| AAA | drafted', 'numbers in the text', 'analysis:approve -- SYMBOL --by', '?drafts=1', 'Do not enable auto-merge', 'לא ידוע על שינויים אחרונים']) expect(body).toContain(x);
  });
  it('fails clearly without a universe', async () => {
    rmSync(join(dir, 'universe.json'));
    await expect(generateDrafts(opts(null))).rejects.toThrow(/universe/);
  });
});

describe('approveDraft: the only way to approved', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apr-'));
    mkdirSync(join(dir, 'analysis'), { recursive: true });
    writeFileSync(join(dir, 'analysis/AAA.draft.json'), JSON.stringify({ schema: 1, symbol: 'AAA', status: 'draft', asof: '2026-10-23', moat: 'ok', moatTxt: 'צר', model: 'm', confidence: 'medium', flags: ['f'] }));
    writeFileSync(join(dir, 'market.json'), JSON.stringify({ schema: 1, generatedAt: 'x', groups: {}, tickers: { AAA: { price: 1, asof: '2026-10-22', currency: 'USD', has: ['draft'] } } }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it('promotes the draft, records the reviewer and date, removes the draft, updates the index', () => {
    approveDraft({ dataDir: dir, symbol: 'AAA', by: ' Tal ', now: NOW });
    const p = JSON.parse(readFileSync(join(dir, 'analysis/AAA.json'), 'utf8'));
    expect(p).toMatchObject({ status: 'approved', reviewedBy: 'Tal', reviewedAt: '2026-10-23', moat: 'ok', model: 'm' });
    expect(parseAnalysisFile(p)).not.toBeNull();
    expect(existsSync(join(dir, 'analysis/AAA.draft.json'))).toBe(false);
    expect(parseMarketFile(JSON.parse(readFileSync(join(dir, 'market.json'), 'utf8')))!.tickers.AAA?.has).toEqual(['analysis']);
  });
  it('refuses without a reviewer name, without a draft, and for a corrupt draft', () => {
    expect(() => approveDraft({ dataDir: dir, symbol: 'AAA', by: '  ', now: NOW })).toThrow(/reviewer/);
    expect(() => approveDraft({ dataDir: dir, symbol: 'ZZZ', by: 'Tal', now: NOW })).toThrow(/no valid draft/);
    writeFileSync(join(dir, 'analysis/AAA.draft.json'), '{"schema":1}');
    expect(() => approveDraft({ dataDir: dir, symbol: 'AAA', by: 'Tal', now: NOW })).toThrow(/no valid draft/);
    expect(existsSync(join(dir, 'analysis/AAA.json'))).toBe(false);
  });
  it('validateData rejects a hand-edited approved file without review, and a draft claiming approval', () => {
    writeFileSync(join(dir, 'universe.json'), JSON.stringify({ schema: 1, benchmark: 'SPY', tickers: [] }));
    writeFileSync(join(dir, 'analysis/AAA.json'), JSON.stringify({ schema: 1, symbol: 'AAA', status: 'approved', asof: '2026-10-23' }));
    writeFileSync(join(dir, 'analysis/AAA.draft.json'), JSON.stringify({ schema: 1, symbol: 'AAA', status: 'approved', asof: '2026-10-23', reviewedBy: 'x', reviewedAt: '2026-10-23' }));
    const p = validateData(dir).join('\n');
    expect(p).toContain('analysis/AAA.json: failed schema validation');
    expect(p).toContain('analysis/AAA.draft.json: failed schema validation');
  });
});

describe('draft preview in the app model', () => {
  const draft: AnalysisFile = { schema: 1, symbol: 'AAA', status: 'draft', asof: '2026-10-23', moat: 'bad', moatTxt: 'טיוטה' };
  const bundle = () => {
    const b = emptyBundle();
    b.market = parseMarketFile({ schema: 1, generatedAt: 'x', groups: {}, tickers: { AAA: { price: 10, asof: '2026-10-22', currency: 'USD', has: ['fundamentals', 'analysis', 'draft'] } } });
    b.fundamentals.AAA = fund();
    b.analysis.AAA = approved({ moat: 'ok', moatTxt: 'מאושר' });
    return b;
  };
  it('shows the approved text by default and never a draft', () => {
    const M = composeMarket(bundle());
    expect(M.tickers.AAA?.bf).toMatchObject({ moat: 'ok', moatTxt: 'מאושר' });
    expect(M.tickers.AAA?.bf?.draft).toBeUndefined();
  });
  it('preview mode shows the draft over the approved text, labelled', () => {
    const b = bundle(); b.drafts.AAA = draft;
    const M = composeMarket(b);
    expect(M.tickers.AAA?.bf).toMatchObject({ moat: 'bad', moatTxt: 'טיוטה', draft: true });
    expect(M.meta?.draftsShown).toEqual(['AAA']);
  });
  it('an analysis file that is only a draft (published slot) is not shown', () => {
    const b = bundle(); b.analysis.AAA = { ...approved(), status: 'draft' };
    expect(composeMarket(b).tickers.AAA?.bf?.moat).toBeUndefined();
  });
  it('the loader fetches draft files only in preview mode', async () => {
    const files: Record<string, unknown> = {
      'market.json': { schema: 1, generatedAt: 'x', groups: {}, tickers: { AAA: { price: 10, asof: '2026-10-22', currency: 'USD', has: ['draft'] } } },
      'cpi.json': { schema: 1, yoyPct: null, label: '', asof: null, fetchedAt: null, source: 'cbs' },
      'analysis/AAA.draft.json': draft,
    };
    const seen: string[] = [];
    const get: Fetcher = async (u) => { const r = u.replace('./data/', ''); seen.push(r); return files[r] ?? null; };
    const normal = new DataLoader('./data/', get, false);
    await normal.loadCore(); await normal.ensure({ held: ['AAA'], traded: [], watch: [] });
    expect(seen.some((s) => s.includes('draft'))).toBe(false);
    seen.length = 0;
    const preview = new DataLoader('./data/', get, true);
    await preview.loadCore(); await preview.ensure({ held: ['AAA'], traded: [], watch: [] });
    expect(seen).toContain('analysis/AAA.draft.json');
    expect(preview.market().tickers.AAA?.bf?.draft).toBe(true);
  });
  it('reviewed analysis appears in the freshness list for held stocks', () => {
    const M = composeMarket({ ...bundle(), market: parseMarketFile({ schema: 1, generatedAt: 'x', groups: { quotes: { state: 'ok', asof: '2026-10-22', fetchedAt: null, source: 'x' } }, tickers: { AAA: { price: 10, asof: '2026-10-22', currency: 'USD' } } }) });
    const items = freshness(M, new Date(2026, 9, 23), ['AAA']);
    expect(items.find((i) => i.id === 'analysis')).toMatchObject({ asof: '2026-06-02', level: 'ok' });
    expect(freshness(M, new Date(2027, 5, 1), ['AAA']).find((i) => i.id === 'analysis')?.level).toBe('stale');
  });
});

describe('describeError', () => {
  it('maps SDK errors to short messages that cannot contain secrets', () => {
    const mk = (cls: new (...a: never[]) => Error) => Object.create(cls.prototype) as Error;
    expect(describeError(mk(Anthropic.AuthenticationError as never))).toMatch(/authentication failed/);
    expect(describeError(mk(Anthropic.RateLimitError as never))).toMatch(/rate limited/);
    expect(describeError(mk(Anthropic.APIConnectionError as never))).toMatch(/could not reach/);
    expect(describeError(new Error('x'.repeat(500))).length).toBeLessThanOrEqual(200);
  });
});

import { extractJson, importReply, manualPrompt } from '../../scripts/analysis/manual-flow';
import { fundamentalsFor } from '../../scripts/analysis/generate';
import { refreshMarket } from '../../scripts/data/refresh-market';
import { parseManualFile } from '../../src/data/validate';

describe('zero-cost mode (no API key, no spend)', () => {
  let dir: string;
  const put = (rel: string, v: unknown) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), JSON.stringify(v)); };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'free-'));
    put('universe.json', { schema: 1, benchmark: 'SPY', tickers: [{ symbol: 'AAA', name: 'אאא' }] });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('builds fundamentals from numbers the owner typed, and lets them override provider values', () => {
    const manual = { schema: 1, symbol: 'AAA', asof: '2026-10-01', inputs: { epsF: 13.4, fcfPs: 9 } };
    expect(fundamentalsFor('AAA', null, manual)).toMatchObject({ source: 'manual', asof: '2026-10-01', inputs: { epsF: 13.4, fcfPs: 9 } });
    expect(fundamentalsFor('AAA', fund(), manual)?.inputs).toMatchObject({ epsT: 7.298, epsF: 13.4, fcfPs: 9 });
    expect(fundamentalsFor('AAA', null, null)).toBeNull();
    expect(fundamentalsFor('AAA', null, { schema: 1, symbol: 'AAA', asof: '2026-10-01', inputs: {} })).toBeNull();
  });

  it('prompt: prints the same text the automated job sends, works with manual numbers only, and says what is missing', () => {
    expect(() => manualPrompt(dir, 'AAA', '2026-10-23')).toThrow(/no fundamentals/);
    put('manual/AAA.json', { schema: 1, symbol: 'AAA', asof: '2026-10-01', inputs: { epsF: 13.4 } });
    const p = manualPrompt(dir, 'AAA', '2026-10-23');
    expect(p).toContain(SYSTEM_PROMPT);
    expect(p).toContain('forward EPS: 13.4');
    expect(p).toContain('Last price: n/a');
    expect(p).toContain('Reply with only the JSON');
  });

  it('extractJson tolerates fences and surrounding chatter, and refuses non-JSON', () => {
    const obj = { a: 1 };
    expect(extractJson(JSON.stringify(obj))).toEqual(obj);
    expect(extractJson('```json\n{"a":1}\n```')).toEqual(obj);
    expect(extractJson('Sure! Here it is:\n{"a":1}\nHope that helps.')).toEqual(obj);
    expect(() => extractJson('no json here')).toThrow(/could not find/);
  });

  it('import: validates a pasted reply like an API reply and writes a draft that still needs approval', () => {
    put('manual/AAA.json', { schema: 1, symbol: 'AAA', asof: '2026-10-01', inputs: { epsF: 13.4 } });
    const r = importReply({ dataDir: dir, symbol: 'AAA', text: '```json\n' + JSON.stringify({ ...good, growthTxt: 'הכנסות +14%' }) + '\n```', now: NOW });
    expect(r.path).toBe('data/analysis/AAA.draft.json');
    expect(r.flags.join(' ')).toMatch(/not in the supplied inputs/);
    const d = JSON.parse(readFileSync(join(dir, 'analysis/AAA.draft.json'), 'utf8'));
    expect(d).toMatchObject({ status: 'draft', model: 'manual-chat' });
    expect(existsSync(join(dir, 'analysis/AAA.json'))).toBe(false);
    expect(() => importReply({ dataDir: dir, symbol: 'AAA', text: JSON.stringify({ ...good, moatTxt: 'כדאי למכור' }), now: NOW })).toThrow(/advice/);
    expect(() => importReply({ dataDir: dir, symbol: 'ZZZ', text: '{}', now: NOW })).toThrow(/no fundamentals/);
  });

  it('a manual price puts a stock into market.json without any provider (source "manual")', async () => {
    put('manual/AAA.json', { schema: 1, symbol: 'AAA', asof: '2026-10-22', price: { value: 117.15, asof: '2026-10-22' } });
    const s = await refreshMarket({ dataDir: dir, providers: { skipped: [] }, now: NOW });
    const m = parseMarketFile(JSON.parse(readFileSync(join(dir, 'market.json'), 'utf8')))!;
    expect(m.tickers.AAA).toMatchObject({ price: 117.15, asof: '2026-10-22', name: 'אאא', has: ['manual'] });
    expect(m.tickers.AAA?.stale).toBeUndefined();
    expect(s.groups.quotes).toMatchObject({ state: 'ok', source: 'manual', asof: '2026-10-22' });
    expect(s.failedSymbols).toEqual(['SPY']); // the benchmark has no manual price: reported, not invented
  });

  it('validates the manual price field', () => {
    const ok = { schema: 1, symbol: 'A', asof: '2026-10-01' };
    expect(parseManualFile({ ...ok, price: { value: 10, asof: '2026-10-01' } })).not.toBeNull();
    for (const bad of [{ value: 0, asof: '2026-10-01' }, { value: -1, asof: '2026-10-01' }, { value: 10, asof: 'x' }, { value: '10', asof: '2026-10-01' }, 5]) {
      expect(parseManualFile({ ...ok, price: bad })).toBeNull();
    }
  });
});
