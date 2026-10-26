# Going live (free setup)

Everything below costs nothing. GitHub Pages on the Free plan serves **public** repositories only, so the repository is
made public. That is safe here because your personal data never goes into the repository (it is git-ignored, a hook blocks
it, and the audit below checks the full history).

1. **Audit the history, on the machine that has your private files**
   `npm run audit:publication`. It must end with `OK`. It scans every commit for private paths, secrets and values from your
   `reference/` and `sample-data/` files (without ever printing them). Lines starting with `review by hand` are round numbers
   that also occur in test data; glance at them. Fix anything it reports before going further.
2. **Decide which email becomes public.** Every commit carries its author email, and the first push publishes them. To use
   your GitHub noreply address (Settings -> Emails shows `ID+username@users.noreply.github.com`):
   `git config user.email "ID+username@users.noreply.github.com"`. The existing commits still carry the old address; since
   nothing is pushed yet they can be rewritten (`git rebase -r --root --exec 'git commit --amend --reset-author --no-edit'`),
   but do that only if you are comfortable with rewriting history, and re-run the audit afterwards.
3. **Create the repository** on GitHub (public, empty, no README), then
   `git remote add origin git@github.com:<you>/<repo>.git` and `git push -u origin main`. The `pre-push` hook re-runs the audit.
4. **Turn on Pages:** Settings -> Pages -> Source: **GitHub Actions**. The `Deploy to GitHub Pages` workflow builds, tests and
   publishes on every push to `main` and whenever a data workflow finishes. Your URL is `https://<you>.github.io/<repo>/`.
5. **Check the live site** (the checklist at the bottom).
6. **Optional, later:**
   - Data: edit `data/universe.json`; set `DATA_LICENSE_ACK` and API keys only if you obtain display rights (see `docs/data-pipeline.md`).
     With nothing configured the site works with prices typed in by users, and the CPI from the CBS.
   - Ticker requests by mail: set the repository variable `REQUEST_EMAIL` (Settings -> Secrets and variables -> Actions -> Variables) to a
     dedicated address. It is built into the public site, so do not use your personal one. Without it the mail button is hidden.
   - Analysis: use the free paste-in path (`docs/analysis-pipeline.md`). Do not enable the paid workflow unless you want to.
   - A licence: with no `LICENSE` file the code is "all rights reserved" by default. Add one if you want others to reuse it.

## Live-site checklist

- The page loads, in Hebrew, right to left; the theme button works; the privacy page opens from the footer.
- First visit asks where to save data; choosing "file" keeps everything out of the browser (DevTools -> Application -> Storage shows only the mode/theme).
- DevTools -> Network: every request is to your own origin (no third parties), and no request contains anything you typed.
- Add a holding, reload: it is still there (browser mode). Export, clear, import: it comes back.
- The freshness card says which data is missing and why (for example "מקור הנתונים טרם אושר לפרסום").
- Open `/?drafts=1` only when reviewing drafts; never share that link.
