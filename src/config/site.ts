/**
 * Link for requesting a ticker (GitHub issue form). The repository URL is injected at build time
 * (VITE_REPO_URL, set by the deploy workflow); without it the link is simply not shown.
 */
const repo = (import.meta.env.VITE_REPO_URL as string | undefined) ?? '';
export const REQUEST_TICKER_URL: string | null = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo) ? `${repo}/issues/new?template=request-ticker.yml` : null;

/**
 * Address that receives ticker requests (VITE_REQUEST_EMAIL, set by the deploy workflow from the REQUEST_EMAIL repository
 * variable). It is public once built into the site, so use a dedicated address. Without it the mail button is not shown.
 */
const mail = (import.meta.env.VITE_REQUEST_EMAIL as string | undefined) ?? '';
export const REQUEST_EMAIL: string | null = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(mail) ? mail : null;
