# Rule register

Every calculation rule, where it lives, and whether it comes from your original tool or is an assumption that needs
your confirmation. Thresholds are in `config/rules.json`; each rule has unit tests (`tests/unit/`). A rule is never changed
silently: change it in `config/rules.json`, update this table, and the Hebrew text updates itself.

## From the reference tool (confirmed by its code; parity-tested)

| Rule | Value | Code |
|---|---|---|
| P/E passes | forward P/E <= 11 **and** earnings reliable (`earnOk` is not false) | `calc/criteria.ts` |
| FCF passes | FCF yield >= 8% **and** FCF trend >= -10% a year; financials with no FCF: ROE >= 15% | `calc/criteria.ts` |
| Moat passes | only `ok` | `calc/criteria.ts` |
| Growth passes | only `up` ("partial" counts as not passing); score is out of 4 | `calc/criteria.ts` |
| Hold flags | red: moat `bad`, growth `neg`, FCF trend < 0; yellow: moat `weak`/`contested`, growth `slow`/`flat`. 0 red + 0 yellow: hold; yellow only: hold and watch; 1 red: hold and check; 2+ red: reconsider; cyclical overrides the label | `calc/criteria.ts` |
| Add candidate | P/E and FCF pass, moat `ok`, growth not `neg` | `calc/criteria.ts` |
| Annualisation | linear: cumulative x 365 / purchase-weighted average holding days; shown only from 30 days; cumulative only if no dated buys | `calc/returns.ts` |
| Real return | (1 + nominal) / (1 + inflation) - 1 | `calc/returns.ts` |
| Dividends | annual = last payment x payments per year x quantity (default 4); net view uses ~25% tax | `calc/dividends.ts` |
| Default USD/ILS | 3.11 when neither the user nor the data gives a rate | `calc/portfolio.ts` |
| Equity share | funds count by their entered equity %; a fund without a % counts as non-equity; bonds use only user-entered prices | `calc/portfolio.ts` |
| Currency | `AGO` = agorot (x 0.01); a blank price falls back to the data's price only when the data states the same currency as the row (an entry with no currency counts as USD). Extended from "USD rows only" with the owner's approval (2026-10-26) so a personal pack can price Israeli securities; the update preview flags a 100x ratio as a probable agorot/shekel mix-up | `calc/portfolio.ts` |

Preserved quirks (flagged in the plan, kept for parity): annualisation uses only the trades you entered while the cumulative
return covers every holding with a cost; the bond bucket ignores the price fallback.

## Changes and additions, and what is still unconfirmed

| Item | What it is | Status |
|---|---|---|
| Benchmark base date | Now a user setting. Default when unset: first trading day of the data's year (the reference hard-coded one date) | **Default needs your OK** |
| Sustainable withdrawal | `W = B*i / (1-(1+i)^-n)`, `i = (1+real annual)^(1/12)-1`, end-of-month, real terms, liquid portfolio only | **My formula, not in either of your files: please confirm** |
| `earnOk` from data | Derived as "trailing GAAP EPS is positive". The reference had it typed by hand | **Assumption: confirm or give the real rule** |
| Missing inputs | A missing forward EPS / FCF trend / ROE shows "no data" instead of a red failure. The score still counts it as not passed | Presentation only, thresholds unchanged |
| Inflation line | Real return and real monthly profit from the CBS CPI (only in your private tool before) | Added, parity-excluded |
| Analysis gating | Qualitative text is shown only when approved by a named human (`docs/analysis-pipeline.md`) | New |
| Watchlist | Your own list instead of tickers flagged in the data | Changed at your request |
