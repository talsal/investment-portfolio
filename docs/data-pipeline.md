# Data pipeline (M3)

The site is static. All market data is read from JSON files under `data/`, refreshed by scheduled GitHub Actions and
committed to the repository. **No user data is ever sent anywhere**: the browser only downloads these public files.

## Files

| File | Written by | Content |
|---|---|---|
| `data/universe.json` | owner (PR / ticker-request issue) | Tickers the pipeline tracks, the benchmark symbol (`SPY`), optional `benchmarkBaseDate` |
| `data/market.json` | `npm run data:market` (daily) | Last prices, USD/ILS, benchmark, dividends, earnings dates, **per-group freshness** (`ok` / `stale` / `unavailable` + `asof`) and a `has` index of per-ticker files |
| `data/history/<SYMBOL>.json` | daily job | 5 years of daily closes (`_USDILS` = Bank of Israel rate; the benchmark has its own file). Loaded only for stocks a user holds or traded |
| `data/fundamentals/<SYMBOL>.json` | `npm run data:fundamentals` (weekly) | Numeric inputs for the criteria table (EPS, FCF per share, FCF trend, ROE, ...) |
| `data/analysis/<SYMBOL>.json` | M4 (reviewed PRs) | Qualitative fields (moat, growth, notes) with `status: draft | approved`; only `approved` is used |
| `data/manual/<SYMBOL>.json` | owner | Values providers cannot supply: dividends, event dates, forward EPS (`inputs`), `watchAdded`. Wins over provider values |
| `data/cpi.json` | daily job (re-checked weekly) | Israeli CPI, 12-month change, from the CBS |

Every file has a `schema` number and is read by strict validators (`src/data/validate.ts`); a malformed file degrades to
"no data" for that item and never breaks the page. `npm run data:validate` runs the same validators over `data/` (CI and the
workflows run it before committing or deploying).

## Failure policy

A provider failure never deletes data and never invents any. The last known value is kept and flagged with its date:

- a symbol that failed keeps its previous price with `stale: true`; the quotes group becomes `stale` (some) or `unavailable` (all);
- FX / CPI / calendar failures keep the previous value and mark that group `unavailable` with the last `asof`;
- invalid provider output (non-positive prices, unordered dates, ...) aborts the run **before anything is written**;
- an unchanged run leaves the files alone (no commit). Timestamps move only when data changes.

The page shows an "as of" line per data group (`עדכניות הנתונים`) and also marks data **stale by age** (thresholds in
`config/rules.json` -> `freshness`), so a pipeline that silently stopped is visible.

## Provider adapters (`providers/`)

Adapters implement small interfaces (`providers/types.ts`). The refresh scripts depend only on those, and the vendor
for each capability is chosen with environment variables (repository **variables** in Actions):

| Capability | Variable (default) | Adapter | Verified live? |
|---|---|---|---|
| USD/ILS | `FX_PROVIDER` (`boi`) | Bank of Israel SDMX `RER_USD_ILS` | **Yes** (keyless) |
| CPI | `CPI_PROVIDER` (`cbs`) | Israel CBS price index API | **Yes** (keyless) |
| Daily closes / history | `HISTORY_PROVIDER` (`twelvedata` if key set) | Twelve Data `time_series` | No: written from public docs, no key available |
| Quote fallback | `QUOTE_PROVIDER` (`finnhub` if key set) | Finnhub `/quote` | No |
| Fundamentals | `FUNDAMENTALS_PROVIDER` (`finnhub` if key set) | Finnhub `/stock/metric` | No |
| Earnings dates, dividends | `CALENDAR_PROVIDER` (`finnhub` if key set) | Finnhub `/calendar/earnings`, `/stock/dividend` | No |
| Israeli funds / ETFs | `HISTORY_PROVIDER=tase` | TASE Data Hub | **Not implemented** (docs/plan not verifiable) |

Secrets: `TWELVEDATA_API_KEY`, `FINNHUB_API_KEY`, `TASE_API_KEY` (Settings -> Secrets and variables -> Actions).
Unverified adapters: run `FINNHUB_API_KEY=... TWELVEDATA_API_KEY=... DATA_LICENSE_ACK=twelvedata,finnhub npm run data:probe -- AAPL`
once. It prints what was mapped and what was missing so field names can be corrected in one place
(`mapFinnhubMetric`, `parseTwelveDataSeries`). Israeli stocks, funds and ETFs work today with manual prices.

What free vendors typically do **not** provide, and how it is handled:

- *Forward EPS* (needed for the P/E rule): the P/E cell shows "no data" until you add `inputs.epsF` to `data/manual/<SYMBOL>.json`.
- *FCF trend / ROIC range*: computed from annual series when the vendor returns them, otherwise "no data".
- *`earnOk`*: derived as "trailing GAAP EPS is positive"; override it in the analysis or manual file when judgement differs.
- *Dividend frequency*: derived from payments in the last 12 months when the dividend endpoint is available, else add `div` to the manual file.

## Provider terms and the licence gate

Terms were read on 2026-10-23. They change; re-check before relying on this. Not legal advice.

| Provider | May a public site show its data? | Source |
|---|---|---|
| Israel CBS (CPI) | **Yes**: open licence; copyright does not extend to facts or data themselves (credit the CBS) | [CBS open licence](https://www.cbs.gov.il/en/Pages/Enduser-license.aspx) |
| Bank of Israel (FX) | **Unclear**: the site's terms claim ownership of content and ask for written permission to copy or publish; no open data licence found. The API page itself was not machine-readable (bot protection) | [BoI terms](https://boi.org.il/en/terms-of-use), [API guide](https://www.boi.org.il/media/upqgqpuv/extracting-representative-exchange-rates-from-the-new-series-database.pdf) |
| Twelve Data | **No on the free tier**: no commercial use, and external display needs a plan/add-on that allows it (terms 2.2e, 2.3l) | [terms](https://twelvedata.com/terms) |
| Finnhub | **No on personal plans**: no redistributing or sharing data or derived results; no business use | [terms](https://finnhub.io/terms-of-service) |
| Alpha Vantage (evaluated, no adapter) | **No on the free key**: personal, non-commercial; letting others access the information counts as commercial | [terms](https://www.alphavantage.co/terms_of_service/) |
| TASE Data Hub | Not verified | [datahub.tase.co.il](https://datahub.tase.co.il/) |

Publishing prices that anyone can open on a Pages site is redistribution. So the pipeline has a **licence gate**:
a provider whose data is not clearly open is used **only if its id is listed in the repository variable
`DATA_LICENSE_ACK`** (comma separated, e.g. `boi,twelvedata`). Without it the group is `unavailable` with
`note: skipped:licence-not-acknowledged`, nothing is fetched, and the page says so. Acknowledging means: "I hold, or have
obtained, the right to display this data". Practical options:

1. Get a vendor plan that permits external display, acknowledge it, and keep the site as is.
2. Ask the Bank of Israel for written permission (or decide the representative rate is a plain public fact), then add `boi`.
3. Do not publish vendor prices at all: leave the gate closed. Everything still works with prices the user types in
   (that is how the app behaves today); only the automatic fallback price, analysis and history need vendor data.

Note: GitHub Pages from a *private* repository needs a paid GitHub plan, and the published site is still reachable by anyone with
the URL unless you use an Enterprise access-controlled Pages site.

## Operating it

1. Edit `data/universe.json` (symbols, optional Hebrew `name`). Keep it small: free tiers allow few calls per minute
   (`PACING_MS`, default 8000 ms between symbols, matches Twelve Data's free 8 calls/minute).
2. Add secrets and the variables above, run **Actions -> Refresh market data -> Run workflow** once, then the fundamentals workflow.
3. Daily cron: `15 22 * * 1-5` UTC (after the US close in winter and summer time, after the Bank of Israel's ~15:45 revision).
   Weekly fundamentals: Sundays 06:00 UTC. GitHub pauses scheduled workflows in repositories with 60 days without activity;
   data commits count as activity, but a failing pipeline would eventually pause itself.
4. Data commits made with `GITHUB_TOKEN` do not trigger `push` workflows, so the deploy workflow also runs when a data
   workflow finishes.

Local runs: `npm run data:market`, `npm run data:fundamentals`, `npm run data:validate`, `npm run data:reindex`
(`DATA_DIR` overrides the folder, useful for trying things in a scratch directory).

## Tickers outside `data/`

The static site can only analyse tickers present in `data/`. For anything else the user's own prices are used and the
row says "no analysis available", with a link to the *Request a ticker* issue form (shown when the site was built with
`VITE_REPO_URL`, which the deploy workflow sets). Future option: a small serverless function that fetches a symbol on demand
(rate-limited, no user data in the request); not built, and subject to the same licence question.

## Customer-side update (bring your own AI)

For people who load their own file, the site does not distribute third-party prices. Instead the storage card has
*Prepare update instructions*: it builds a text containing only the dollar tickers (holdings and watchlist) and today's
date, which the user pastes into their own assistant. The answer is pasted back (or imported from a file) and goes through
`parsePackText` (bare JSON, a fenced block, or JSON inside a sentence), the strict `sanitizePack`, and `checkPack`
(`src/data/packCheck.ts`) before anything is applied. The preview shows each price against the previous pack or the price
the user typed, and flags: a move above `JUMP_PCT` (25%), data older than `STALE_DAYS` (7), a missing or future date, a
dollar rate that moved more than 5%, requested tickers that did not arrive, entries the reader rejected, a non-dollar
currency, and tickers that exist in the old pack but would disappear. Nothing is applied until the user confirms, and the
site sends nothing: the user copies and pastes. Thresholds are sanity checks, not calculation rules.

The text asks for prices, dividends, next earnings dates and the dollar rate only; fundamentals and qualitative analysis
are not requested from a user's assistant because they cannot be sanity-checked the same way.
