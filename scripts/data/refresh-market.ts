import { pathToFileURL } from 'node:url';
import { DATA_SCHEMA, type CpiFile, type GroupId, type GroupStatus, type MarketFile, type MarketTicker } from '../../src/data/schema';
import { parseCpiFile, parseHistoryFile, parseMarketFile, parseUniverseFile } from '../../src/data/validate';
import { RULES } from '../../src/config/rules';
import { buildProviders, type Providers } from '../../providers/registry';
import { paced } from '../../providers/http';
import { errMessage, failedGroup, fetchFrom, isoDay, mergeHistory, okGroup, sameContent } from '../lib/market';
import { readJson, writeJson } from '../lib/files';
import { reindex } from './reindex';

export interface RefreshOptions {
  dataDir: string;
  providers: Providers;
  now: Date;
  /** Minimum gap between provider calls that hit a rate-limited vendor. */
  pacingMs?: number;
  log?: (line: string) => void;
}

export interface RefreshSummary {
  wrote: boolean;
  groups: Partial<Record<GroupId, GroupStatus>>;
  failedSymbols: string[];
  skipped: Providers['skipped'];
}

/**
 * Daily refresh of market.json and the history files. Failure policy: a provider error never deletes data. The
 * last known value is kept and flagged (stale / unavailable) together with its date, and nothing is invented.
 * Everything is computed and validated in memory first; files are written only if all of them are valid.
 */
export async function refreshMarket(o: RefreshOptions): Promise<RefreshSummary> {
  const { dataDir, providers: P, now } = o;
  const log = o.log ?? (() => {});
  const years = RULES.history.years;
  const universe = parseUniverseFile(readJson(dataDir, 'universe.json'));
  if (!universe) throw new Error('data/universe.json is missing or invalid');
  const prev = parseMarketFile(readJson(dataDir, 'market.json'));
  const writes: Array<{ rel: string; value: unknown; compact?: boolean }> = [];
  const groups: MarketFile['groups'] = {};
  const next: MarketFile = { schema: DATA_SCHEMA, generatedAt: now.toISOString(), groups, tickers: {} };
  const skippedFor = (cap: string) => P.skipped.find((s) => s.capability === cap);

  // ---- FX (USD/ILS) ----
  next.fx = prev?.fx;
  if (P.fx) {
    try {
      const old = parseHistoryFile(readJson(dataDir, 'history/_USDILS.json'));
      const d = await P.fx.fetchUsdIls(fetchFrom(old, years, now));
      const h = mergeHistory(old, d, { symbol: '_USDILS', source: P.fx.info.id, years, now });
      writes.push({ rel: 'history/_USDILS.json', value: h, compact: true });
      next.fx = { usdIls: h.close[h.close.length - 1] as number, asof: h.asof };
      groups.fx = okGroup(h.asof, P.fx.info.id, now);
    } catch (e) { groups.fx = failedGroup(prev?.groups.fx, P.fx.info.id, errMessage(e)); log(`fx failed: ${errMessage(e)}`); }
  } else { const s = skippedFor('fx'); groups.fx = failedGroup(prev?.groups.fx, s?.id ?? 'none', `skipped:${s?.reason ?? 'not-configured'}`); }

  // ---- Prices + history (tickers and the benchmark) ----
  const symbols = [...new Set([universe.benchmark, ...universe.tickers.map((t) => t.symbol)])];
  const names = new Map(universe.tickers.map((t) => [t.symbol, t.name]));
  const failedSymbols: string[] = [];
  let refreshed = 0;
  const priced: Record<string, MarketTicker> = {};
  if (P.history || P.quote) {
    await paced(symbols, o.pacingMs ?? 0, async (sym) => {
      const old = parseHistoryFile(readJson(dataDir, `history/${sym}.json`));
      const keep = prev?.tickers[sym];
      try {
        if (!P.history) throw new Error('no history provider');
        const d = await P.history.fetchDaily(sym, fetchFrom(old, years, now));
        const h = mergeHistory(old, d, { symbol: sym, source: P.history.info.id, years, now });
        writes.push({ rel: `history/${sym}.json`, value: h, compact: true });
        priced[sym] = { ...(keep ?? {}), price: h.close[h.close.length - 1] as number, asof: h.asof, currency: 'USD' };
        delete priced[sym]!.stale;
        refreshed++;
      } catch (e1) {
        try {
          if (!P.quote) throw e1;
          const q = await P.quote.fetchQuote(sym);
          priced[sym] = { ...(keep ?? {}), price: q.price, asof: q.asof, currency: 'USD' };
          delete priced[sym]!.stale;
          refreshed++;
        } catch (e2) {
          failedSymbols.push(sym);
          log(`${sym}: ${errMessage(e2)}`);
          if (keep) priced[sym] = { ...keep, stale: true };
        }
      }
    });
  } else {
    const s = skippedFor('history');
    for (const sym of symbols) { failedSymbols.push(sym); const keep = prev?.tickers[sym]; if (keep) priced[sym] = { ...keep, stale: true }; }
    log(`prices skipped: ${s?.reason ?? 'no provider configured'}`);
  }
  const quotesSource = P.history?.info.id ?? P.quote?.info.id ?? skippedFor('history')?.id ?? 'none';
  for (const sym of symbols) {
    if (sym === universe.benchmark) continue;
    const t = priced[sym];
    if (t) next.tickers[sym] = { ...t, ...(names.get(sym) ? { name: names.get(sym) } : {}) };
  }
  const latest = (xs: Array<{ asof: string }>) => xs.map((x) => x.asof).sort().pop() ?? null;
  const n = universe.tickers.length;
  const fresh = Object.values(next.tickers).filter((t) => !t.stale);
  const failedTickers = n - fresh.length;
  if (!n) groups.quotes = failedGroup(prev?.groups.quotes, quotesSource, 'empty-universe');
  else if (fresh.length === n) groups.quotes = okGroup(latest(fresh) as string, quotesSource, now);
  else if (fresh.length > 0) groups.quotes = { state: 'stale', asof: latest(fresh), fetchedAt: now.toISOString(), source: quotesSource, note: `failed:${failedTickers}/${n}` };
  else groups.quotes = failedGroup(prev?.groups.quotes, quotesSource, `failed:${failedTickers}/${n}`);

  const bench = priced[universe.benchmark];
  if (bench && !bench.stale) {
    next.benchmark = { symbol: universe.benchmark, price: bench.price, asof: bench.asof, ...(universe.benchmarkBaseDate ? { baseDate: universe.benchmarkBaseDate } : {}) };
    groups.benchmark = okGroup(bench.asof, quotesSource, now);
  } else {
    next.benchmark = prev?.benchmark ? { ...prev.benchmark, ...(universe.benchmarkBaseDate ? { baseDate: universe.benchmarkBaseDate } : {}) } : undefined;
    groups.benchmark = failedGroup(prev?.groups.benchmark, quotesSource, 'benchmark-not-refreshed');
  }

  // ---- Earnings dates and dividends ----
  if (P.calendar) {
    const from = isoDay(now), to = isoDay(new Date(now.getTime() + 90 * 86400000));
    let okCount = 0, tried = 0, divUnsupported = false;
    await paced(universe.tickers.map((t) => t.symbol).filter((s) => next.tickers[s]), o.pacingMs ?? 0, async (sym) => {
      tried++;
      const t = next.tickers[sym] as MarketTicker;
      try {
        const ev = await P.calendar!.fetchEarnings(sym, from, to);
        if (ev.length) t.events = ev; else delete t.events;
        okCount++;
      } catch (e) { log(`${sym} earnings: ${errMessage(e)}`); }
      if (P.calendar!.fetchDividend && !divUnsupported) {
        try {
          const dv = await P.calendar!.fetchDividend(sym, isoDay(now));
          if (dv) t.div = { ...dv, asof: isoDay(now), source: P.calendar!.info.id }; else delete t.div;
        } catch (e) {
          // A plan without dividend access fails the same way for every symbol: stop asking.
          if (/HTTP 40[13]/.test(errMessage(e))) divUnsupported = true;
          log(`${sym} dividend: ${errMessage(e)}`);
        }
      }
    });
    groups.calendar = !tried || okCount === tried ? okGroup(isoDay(now), P.calendar.info.id, now) : failedGroup(prev?.groups.calendar, P.calendar.info.id, `failed:${tried - okCount}/${tried}`, okCount ? 'stale' : 'unavailable');
  } else { const s = skippedFor('calendar'); groups.calendar = failedGroup(prev?.groups.calendar, s?.id ?? 'none', `skipped:${s?.reason ?? 'not-configured'}`); }
  // Dividends/earnings that a failed run could not refresh are kept from the previous file.
  for (const [sym, t] of Object.entries(next.tickers)) {
    const keep = prev?.tickers[sym];
    if (keep && groups.calendar?.state !== 'ok') { if (!t.events && keep.events) t.events = keep.events; if (!t.div && keep.div) t.div = keep.div; }
  }

  // ---- CPI ----
  const oldCpi = parseCpiFile(readJson(dataDir, 'cpi.json'));
  const cpiAgeDays = oldCpi?.fetchedAt ? (now.getTime() - Date.parse(oldCpi.fetchedAt)) / 86400000 : Infinity;
  const monthEnd = (ym: string) => isoDay(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)));
  if (P.cpi && cpiAgeDays > 6) {
    try {
      const c = await P.cpi.fetchCpi();
      writes.push({ rel: 'cpi.json', value: { schema: DATA_SCHEMA, yoyPct: c.yoyPct, label: c.label, asof: c.asof, fetchedAt: now.toISOString(), source: P.cpi.info.id } satisfies CpiFile });
      groups.cpi = okGroup(monthEnd(c.asof), P.cpi.info.id, now);
    } catch (e) {
      groups.cpi = failedGroup(oldCpi?.asof ? { ...(prev?.groups.cpi as GroupStatus), asof: monthEnd(oldCpi.asof), fetchedAt: oldCpi.fetchedAt, state: 'stale', source: oldCpi.source } : undefined, P.cpi.info.id, errMessage(e), oldCpi?.yoyPct != null ? 'stale' : 'unavailable');
    }
  } else if (oldCpi?.asof) groups.cpi = { state: prev?.groups.cpi?.state ?? 'ok', asof: monthEnd(oldCpi.asof), fetchedAt: oldCpi.fetchedAt, source: oldCpi.source, ...(prev?.groups.cpi?.note ? { note: prev.groups.cpi.note } : {}) };
  else { const s = skippedFor('cpi'); groups.cpi = failedGroup(undefined, s?.id ?? 'none', `skipped:${s?.reason ?? 'not-configured'}`); }

  // ---- Validate everything, then write ----
  const changed = !sameContent(prev, { ...next, generatedAt: prev?.generatedAt ?? next.generatedAt });
  const outMarket: MarketFile = changed ? next : (prev as MarketFile);
  if (!parseMarketFile(outMarket)) throw new Error('refusing to write: market.json would be invalid');
  for (const w of writes) {
    const ok = w.rel.startsWith('history/') ? parseHistoryFile(w.value) : w.rel === 'cpi.json' ? parseCpiFile(w.value) : w.value;
    if (!ok) throw new Error(`refusing to write: ${w.rel} would be invalid`);
  }
  let wrote = false;
  for (const w of writes) { const c = writeJson(dataDir, w.rel, w.value, w.compact); if (c) log(`wrote ${w.rel}`); wrote = c || wrote; }
  if (changed) { const c = writeJson(dataDir, 'market.json', outMarket); if (c) log('wrote market.json'); wrote = c || wrote; }
  const r = reindex(dataDir);
  if (r) log('reindexed market.json');
  wrote = r || wrote;
  return { wrote, groups, failedSymbols, skipped: P.skipped };
}

async function main() {
  const dataDir = process.env.DATA_DIR ?? 'data';
  const providers = buildProviders(process.env);
  const log = (l: string) => console.log(l);
  const s = await refreshMarket({ dataDir, providers, now: new Date(), pacingMs: Number(process.env.PACING_MS ?? 8000), log });
  for (const sk of s.skipped) log(`skipped ${sk.capability}: ${sk.id} (${sk.reason})`);
  const lines = Object.entries(s.groups).map(([k, g]) => `- ${k}: ${g?.state}${g?.asof ? ` (as of ${g.asof})` : ''}${g?.note ? ` [${g.note}]` : ''}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Market data refresh\n${lines.join('\n')}\n`);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(errMessage(e)); process.exit(1); });
