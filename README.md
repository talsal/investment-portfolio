# investment-portfolio

Hebrew RTL personal-wealth dashboard. Static site (GitHub Pages), all user data stays on the device.

Status: **M4 done** (analysis drafts + human approval). M3: data pipeline + freshness UI. M2: storage modes. M1: parity port. See `PROMPT_for_Claude_Code.md` for the full brief and milestones.

## Develop

```bash
npm install            # also activates the pre-commit guard (core.hooksPath=.githooks)
npm run dev            # Vite dev server
npm run build          # typecheck + production build into dist/
npm test               # unit tests (Vitest)
npm run test:e2e       # parity + behaviour tests (Playwright; builds and serves dist/)
npm run test:golden    # reference-engine snapshots (Playwright)
npm run data:market    # refresh data/ (needs provider keys / licence acknowledgement; see docs)
npm run data:validate  # strict check of every file under data/
```

## Layout

- `src/calc/` pure calculations (no DOM, clock injected). `config/rules.json` holds every threshold.
- `src/ui/` rendering (safe `html` templating, no inline styles/handlers), `src/i18n/he.ts` all Hebrew strings.
- `src/profile/` schema, sanitiser and the versioned backup format; `src/storage/` the storage controller (browser and file modes); `src/data/` market-data loader. See `docs/storage.md`.
- `scripts/analysis/` draft generation, free paste-in path and approval (see `docs/analysis-pipeline.md`).
- `data/` static JSON read by the app, refreshed by GitHub Actions; `providers/` vendor adapters; `scripts/data/` the refresh jobs. See `docs/data-pipeline.md` (including provider terms and the licence gate).
- `tests/golden/` the original engine run headless on synthetic fixtures; `tests/e2e/parity.spec.ts` proves the new app renders identical text.

## Parity with the reference engine

`tests/e2e/parity.spec.ts` renders the same fixtures in the original engine and in the new app and compares every
section (tiles, table cells, totals, notes, chart text). Reviewed, intentional differences are listed in
`KNOWN_TEXT_CHANGES` in that file; Unicode bidi isolates are ignored. New features are marked
`data-parity-skip` (inflation/real return, disclaimers, demo notice).

## Private data

`reference/` and `sample-data/` are git-ignored and guarded by `scripts/guard-personal-data.mjs`. Real-data checks run
locally only: `npm run golden:private`, `npm run parity:private`.
