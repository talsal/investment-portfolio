import { ProviderError } from './types';

export interface GetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Query parameter names to scrub from error messages (API keys). */
  secretParams?: string[];
  fetchImpl?: typeof fetch;
}

/** Removes secret query parameters from a URL before it is shown in logs or errors. */
export function redactUrl(url: string, secretParams: string[] = ['apikey', 'token', 'api_key', 'key']): string {
  try {
    const u = new URL(url);
    for (const k of secretParams) if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED');
    return u.toString();
  } catch {
    return '[invalid url]';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with timeout and a few retries on network errors, 429 and 5xx. Returns the response body as text. */
export async function getText(url: string, o: GetOptions = {}): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const attempts = (o.retries ?? 2) + 1;
  let last: ProviderError | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await f(url, { headers: { 'user-agent': 'investment-portfolio-data-bot', ...o.headers }, signal: AbortSignal.timeout(o.timeoutMs ?? 20_000) });
      if (res.ok) return await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      last = new ProviderError(`HTTP ${res.status} from ${redactUrl(url, o.secretParams)}`, res.status === 429 ? 'quota' : 'http');
      if (!retryable) throw last;
    } catch (e) {
      if (e instanceof ProviderError && !(e.kind === 'quota' || /HTTP 5\d\d/.test(e.message))) throw e;
      last = e instanceof ProviderError ? e : new ProviderError(`network error for ${redactUrl(url, o.secretParams)}`, 'http');
    }
    if (i < attempts - 1) await sleep(500 * 2 ** i);
  }
  throw last ?? new ProviderError('request failed');
}

export async function getJson(url: string, o: GetOptions = {}): Promise<unknown> {
  const text = await getText(url, o);
  try { return JSON.parse(text); } catch { throw new ProviderError(`invalid JSON from ${redactUrl(url, o.secretParams)}`, 'parse'); }
}

/** Calls `fn` for each item with at least `minIntervalMs` between starts (free tiers are rate limited). */
export async function paced<T, R>(items: T[], minIntervalMs: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  for (const it of items) {
    const wait = next - Date.now();
    if (wait > 0) await sleep(wait);
    next = Date.now() + minIntervalMs;
    out.push(await fn(it));
  }
  return out;
}
