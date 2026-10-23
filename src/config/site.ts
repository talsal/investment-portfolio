/**
 * Link for requesting a ticker (GitHub issue form). The repository URL is injected at build time
 * (VITE_REPO_URL, set by the deploy workflow); without it the link is simply not shown.
 */
const repo = (import.meta.env.VITE_REPO_URL as string | undefined) ?? '';
export const REQUEST_TICKER_URL: string | null = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo) ? `${repo}/issues/new?template=request-ticker.yml` : null;
