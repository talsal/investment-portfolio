# Prompt for Claude Code: portfolio web app (GitHub Pages)

Copy everything below the line into Claude Code, from inside a **new private working folder** that contains the `reference/` and `sample-data/` folders of this handoff.

---

## Role and goal

You are building a production-quality, static web app (hosted on GitHub Pages) from an existing prototype. The prototype is a Hebrew, right-to-left personal-wealth dashboard that I built as single-file HTML pages. It must become a normal multi-file web app that any user can open on any device (phone, tablet, desktop), enter their own data, and see exactly the same analysis and sections that my prototype shows.

Work in plan-first mode: read the reference files, write a short plan with milestones, wait for my approval, then build milestone by milestone with tests.

## Reference files (read these first)

- `reference/template_generic_engine_with_demo_pack.html`: the generic, empty-start engine. All logic is vanilla JS inside one file. The embedded `<script type="application/json" id="marketData">` is the "market pack". This is the behavior to reproduce.
- `reference/owner_tool_reference_PRIVATE.html`: my personal version (hard-coded holdings). Use only to see sections that exist in the original. **Contains my real financial data: never copy its numbers into the app, the repo, tests, or docs.**
- `sample-data/market_pack_example*.json`: examples of the market-pack schema (tickers, fundamentals inputs `bf`, `base`, `baseClose`, `events`, `div`, `hist`, `bm`).
- `sample-data/profile_example_PRIVATE.json`: example user profile (export format). Real personal data: use it only locally for golden tests, never commit it. Create a fake anonymized profile for the repo.

## Hard requirements

1. **Parity.** Every section and calculation in the generic engine must exist and produce the same numbers for the same inputs: total capital and split, pie chart with center return (cumulative, annualized, profit in ₪), legend, total profit table ("רווח כולל"), annual-profit estimate with monthly average, inflation and real-return, equity share vs target, dividends, Buffett 4-criteria table with hold/add logic, watchlist, earnings-events calendar, benchmark-vs-S&P section, history chart vs S&P (ILS/USD toggle) built from the user's trades, cash-flow section (income, expenses, investable remainder), glossary. Also keep: price fallback from the market pack when the user leaves a price blank, ticker-name dictionary, Israeli security numbers, agorot ("AGO") currency option, light/dark theme, accessibility (aria labels, keyboard, tables as alternative to charts).
2. **Hebrew RTL UI**, code and comments in English. Put all user-visible strings in one i18n file. Numbers inside RTL text must be wrapped so signs and percent marks render correctly (`dir="ltr"` / Unicode isolates).
3. **Two storage modes, chosen on first run and switchable later:**
   - **Browser mode:** data stays in the browser (IndexedDB or localStorage), auto-saved with debounce. Show a clear warning that clearing site data deletes it, and a nudge to export a backup every N days.
   - **File mode:** the user keeps a JSON file. On every open the app asks them to import it (drag-and-drop and file picker). Where the File System Access API exists, offer "remember my file" with a re-permission prompt, with graceful fallback to manual import. "Save" always downloads or overwrites the file. Nothing is auto-stored in the browser in this mode.
   - Both modes use the same versioned export format (`{app, version, profile, exportedAt}`) with a migration function per version and strict validation/sanitization on import (never trust file contents; escape on render).
4. **No user data ever leaves the device.** No analytics that include user data, no server storage in v1.
5. **First-run experience:** empty state with a guided input form (holdings, cost, quantities, currency, cash, pension/gemel/hishtalmut balances, optional trades, optional cash-flow). Nothing is pre-filled except a visible example the user can load and clear.

## Data architecture (GitHub Pages is static, so no backend)

- The app reads **static JSON files** from the repo's `/data` folder: `market.json` (prices, FX, S&P, inflation, dividends, earnings dates), `fundamentals/<TICKER>.json`, `analysis/<TICKER>.json` (qualitative fields: moat, growth, notes, with `status: draft|approved`).
- A **GitHub Actions scheduled workflow** (cron, after the US close) refreshes `market.json` and commits it. A weekly workflow refreshes fundamentals. Build this with pluggable provider adapters (`providers/`), so I can swap data vendors without touching the UI. Start with: Bank of Israel public exchange-rate feed for USD/ILS; a free-tier market-data API for US prices (make the vendor configurable via secrets); CPI as a small manually-updated JSON until a reliable source is chosen. **Do not scrape websites.** Check each provider's terms and note in the README whether commercial display is allowed.
- Israeli ETFs and funds: support manual price entry and a provider adapter for TASE DataHub (API key via secret), optional.
- A separate script generates **draft qualitative analysis** by calling the Claude API (key in Actions secrets) and opens a pull request for me to review. Only `approved` analysis is shown in the UI; drafts are labeled. Never auto-publish.
- Limitation to handle explicitly: the static site can only analyze tickers present in `/data`. For other tickers, show price-only rows with a clear "no analysis available" state and a link to request the ticker (GitHub issue template). Document the future option of a small serverless function.
- The UI shows data freshness ("as of …") for every data group and degrades gracefully when a file is stale or missing.

## Calculation rules (must be extracted into `config/rules.json` + unit tests)

Read these from the reference code and do not change them silently: P/E passes if forward P/E ≤ 11 and earnings are reliable; FCF passes if FCF yield ≥ 8% and trend ≥ −10%/yr (or ROE rule for financials); moat passes only if "ok"; growth passes only if "up"; "add candidate" and "hold flags" (red flags: moat bad, negative growth, falling FCF; yellow: weak/contested moat, slowing growth); annualization of the trading portfolio (average holding period weighted by purchase amount from the user's trades; show only cumulative if there are no trades or less than 30 days); real return = (1+nominal)/(1+inflation)−1; monthly sustainable withdrawal assumes end-of-month withdrawals. The benchmark base date must become a **user setting** (the prototype hard-codes one date).

## Engineering expectations

- Vanilla ES modules or Vite + TypeScript (propose one, justify briefly). No heavy UI framework unless you justify it. Charts as accessible SVG. Mobile-first, no horizontal scroll at 360px.
- Repo layout: `src/` (calc, storage, ui, i18n), `data/`, `scripts/`, `tests/`, `.github/workflows/` (deploy to Pages, scheduled data jobs, CI).
- **Tests:** unit tests for every calculation; a **golden test** that loads the reference generic engine in headless Playwright with `sample-data` inputs, extracts the key outputs, and asserts the new app matches (keep golden values local; commit only anonymized fixtures). Also tests for import validation, migrations, both storage modes, RTL rendering, and empty states.
- Security: strict CSP, escape all user strings, validate numeric inputs, no `eval`, no inline handlers.
- Privacy: a short privacy page (all data stays on the device in both modes).
- A visible **disclaimer** on every analysis section: informational tool, not investment advice; historical returns are not a guarantee; annualized figures over short periods are estimates.

## Milestones

1. Port with parity, in-browser only, golden tests green.
2. Both storage modes, versioned export/import, migrations.
3. Data pipeline (Actions + provider adapters + freshness UI).
4. Analysis pipeline (draft generation, review via PR, approved-only display).
5. Polish: accessibility audit, performance, README, privacy page, deploy to GitHub Pages.

After each milestone, summarize what was done, what is untested, and what you need from me.

## Things you must not do

- Do not embed any real personal numbers from the reference files in the repo.
- Do not call third-party services from the browser with the user's portfolio data.
- Do not invent financial data; if a provider fails, show "unavailable" with the last known value and its date.
- Do not change a calculation rule without flagging it to me first.
