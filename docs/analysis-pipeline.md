# Qualitative analysis pipeline (M4)

The criteria table has two qualitative columns, **moat** and **growth** (plus short notes). Numbers (P/E, FCF) are
computed from data; these two are judgements. They are drafted by a model (or by you), **reviewed by a human**, and only
then shown. Nothing is ever published automatically.

## What is shown, and when

| File | Meaning | Shown to visitors? |
|---|---|---|
| `data/analysis/<SYMBOL>.json` with `status: "approved"`, `reviewedBy`, `reviewedAt` | Reviewed analysis | **Yes** |
| the same file without a named reviewer and review date | Claims approval but no human is named | No (rejected by the reader and by `npm run data:validate`) |
| `data/analysis/<SYMBOL>.draft.json` | Machine/pasted draft | **No**, the site does not even request it. A reviewer can open the site with `?drafts=1` to preview it, labelled "טיוטה", with a banner |

A stock with no approved analysis shows its numbers and "– אין ניתוח" for moat and growth, plus a link to request the ticker.
A refresh never replaces a live approved file: the new draft sits next to it until you approve it.

## Free path (no API key, no spend)

1. Put the numbers you have into `data/manual/<SYMBOL>.json` (`inputs`: `epsF`, `fcfPs`, `fcfTrend`, `roe`, ... and
   optionally `price: {value, asof}`), and the symbol into `data/universe.json`.
2. `npm run analysis:prompt -- SYMBOL` prints exactly what the automated job would send.
3. Paste it into any chat assistant you already have, and save its JSON reply to `reply.json`.
4. `npm run analysis:import -- SYMBOL reply.json` (or `-` to read stdin). The reply goes through the same checks as an API
   reply and becomes `data/analysis/SYMBOL.draft.json`.
5. Review, then `npm run analysis:approve -- SYMBOL --by "Your Name"`.

## Automated path (paid, manual only)

`Actions -> Draft analysis -> Run workflow` calls the Anthropic API for stocks that need analysis, then opens a pull
request containing only draft files. It is never scheduled. With no `ANTHROPIC_API_KEY` secret it does nothing and costs nothing.

- Model: `claude-opus-5-5` by default (set the repository variable `ANALYSIS_MODEL` to change it). Opus 5.5 lists at
  $4 / $20 per million input / output tokens; one stock is roughly 2-3k input and 1-3k output tokens including reasoning,
  so a few cents per stock. `claude-haiku-5-5` ($0.10 / $0.50) is far cheaper but less careful. The cost figures are
  estimates; **the live call has not been run** (no key was used during development: the code is tested with a mocked client).
- Which stocks: those with fundamentals (or manual numbers) and no approved analysis, or analysis older than 100 days,
  or fundamentals newer than the analysis. At most `max` per run (default 3), nothing with a draft already waiting.
- Request: structured output (JSON schema), adaptive thinking (always on for this model), effort `medium`, and the
  server-side `fallbacks: "default"` opt-in so a safety-classifier decline is retried on another model instead of failing.
  Prompt caching is not used: the stable prompt is below the minimum cacheable size.
- Repository setup: Settings -> Actions -> General -> "Allow GitHub Actions to create and approve pull requests". Do not enable
  auto-merge on these PRs.

## Safeguards (all unit-tested)

- The generator cannot approve: it only writes `*.draft.json`, ignores any `status`/`reviewedBy` in the model's reply, and
  `npm run analysis:approve` is the only code that writes `approved`. It refuses an empty reviewer name.
- Replies must be valid JSON in the schema, Hebrew text, each field at most 280 characters, no markup or links.
- Advice wording (buy/sell/should add/price target/undervalued/attractive..., English and Hebrew) rejects the draft.
- Numbers in the text that are not in the supplied inputs are **flagged** for the reviewer (not rejected), as is low
  confidence. Years and quarter numbers are ignored by that check.
- The prompt contains only data from `data/` (no portfolio, no personal data) and tells the model to say "n/a" rather than guess.
- The model has no internet access and a knowledge cutoff. Check facts yourself. Possible later improvement: give it the web
  search tool with citations (more cost and more review surface).

## Vocabulary

- **moat**: `ok` intact or strengthening; `weak` narrow but stable; `contested` real advantage under credible threat; `bad` eroding;
  `none` no meaningful moat or not applicable. Only `ok` passes the moat criterion (see `config/rules.json`).
- **growth**: `up` accelerating (only this passes); `slow` positive but decelerating; `flat` stable and low; `neg` shrinking; `na`.
- **cyclical**: earnings swing with an industry cycle rather than business quality.
