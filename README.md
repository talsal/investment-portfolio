# תמונת מצב של ההון: personal-wealth dashboard

A Hebrew, right-to-left, static web app (GitHub Pages) that turns the holdings you enter into one picture of your wealth:
total capital and split, profit and return (cumulative and annualised), equity share against a target, estimated yearly and
monthly profit with inflation and real return, dividends, a four-criteria screen for stocks (with hold/add logic), a watchlist,
earnings dates, comparison with the S&P 500, a history chart built from your trades, cash flow, and a sustainable monthly
withdrawal estimate. It started as a single-file prototype; this repository is the multi-file, tested version.

**Your data never leaves your device.** There is no server, no account and no analytics. See [`privacy.html`](privacy.html)
(source: `src/i18n/he.ts`) and [docs/storage.md](docs/storage.md).

> Informational tool, not investment advice. Past returns are no guarantee; annualised figures over short periods are estimates.

## Using it

1. Open the site. On the first visit choose where your data lives:
   - **Browser**: saved automatically on this device (clearing site data deletes it; the site reminds you to export a backup).
   - **Personal file**: nothing is stored in the browser; you open your JSON file each visit and save it back.
2. Add holdings (quantity, cost, current price), cash, gemel / hishtalmut, optional trades and cash flow. Or press
   "load example data" to see everything with invented numbers, and clear it afterwards.
3. Prices are typed by you. Where the site has data for a ticker it can fill a blank price and show the analysis columns;
   other tickers still work, with "no analysis available" and a link to request them.
4. To refresh prices without typing them: *Prepare update instructions* gives a text for your own AI assistant (symbols and date only).
   Paste its answer back, review the checked preview (suspicious jumps, old dates, missing tickers) and confirm.

## Free by design

Nothing here needs a paid service. Hosting is GitHub Pages on a public repository (personal data is never in the repo;
`npm run audit:publication` checks the whole history). Market-data vendors do not allow public display on free tiers, so
the data pipeline has a licence gate that stays closed until you decide otherwise ([docs/data-pipeline.md](docs/data-pipeline.md)).
The qualitative analysis has a free paste-in path; the paid Claude workflow is manual-only ([docs/analysis-pipeline.md](docs/analysis-pipeline.md)).

## Develop

```bash
npm install            # also activates the git hooks (core.hooksPath=.githooks)
npm run dev            # Vite dev server
npm run build          # typecheck + production build into dist/
npm test               # unit tests (Vitest)
npm run test:e2e       # browser tests: parity, storage, data, accessibility (axe), performance, privacy
npm run test:golden    # snapshots of the reference engine (Playwright)
npm run data:validate  # strict check of every file under data/
npm run audit:publication  # scan the full git history for private data and secrets
```

Local-only checks against your real files (never committed): `npm run parity:private`, `npm run golden:private`.

### Layout

| Path | What |
|---|---|
| `src/calc/` | Pure calculations (no DOM, clock injected). Thresholds live in `config/rules.json` |
| `src/ui/`, `src/i18n/he.ts` | Rendering (escaping template helper, no inline styles or handlers) and every Hebrew string |
| `src/profile/`, `src/storage/` | Profile schema and sanitiser, versioned backup format and migrations, browser/file storage modes |
| `src/data/` | Strict readers and the on-demand loader for the static data files |
| `data/` | Static JSON the site reads (refreshed by GitHub Actions). `providers/` and `scripts/data/` are the vendor adapters and refresh jobs |
| `scripts/analysis/` | Draft generation, the free paste-in flow and human approval |
| `tests/` | `unit/`, `e2e/` (against the production build), `golden/` (the original engine as an oracle) |

### How parity with the prototype is proven

`tests/e2e/parity.spec.ts` renders the same synthetic fixtures in the original engine and in this app and compares every
section (tiles, table cells, totals, notes, chart text). Intentional differences are listed in `KNOWN_TEXT_CHANGES`; new
features are marked `data-parity-skip`. The calculation rules and which of them still need the owner's confirmation are in
[docs/rules.md](docs/rules.md).

### Security and privacy engineering

Strict CSP (`script-src 'self'`, `connect-src 'self'`, no inline script or style), all user text escaped on render, imported
files size-capped, migrated and sanitised field by field, no `eval`, no third-party requests (a test watches every request in
a full session). `reference/` and `sample-data/` are git-ignored; a pre-commit hook blocks them and a pre-push hook audits
the history.

## Docs

[storage and backup format](docs/storage.md) · [data pipeline and provider terms](docs/data-pipeline.md) ·
[analysis pipeline](docs/analysis-pipeline.md) · [rule register](docs/rules.md) · [going live](docs/go-live.md)
