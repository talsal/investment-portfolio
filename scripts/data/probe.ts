import { buildProviders } from '../../providers/registry';
import { errMessage } from '../lib/market';

/**
 * Owner tool: calls the configured vendors for ONE symbol and prints what was mapped and what was missing, so
 * adapter field names can be checked against the live API (they were written from public docs, without a key).
 *   FINNHUB_API_KEY=... TWELVEDATA_API_KEY=... npm run data:probe -- AAPL
 */
async function main() {
  const symbol = (process.argv[2] ?? '').toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) { console.error('usage: npm run data:probe -- SYMBOL'); process.exit(2); }
  const P = buildProviders({ ...process.env, DATA_LICENSE_ACK: 'twelvedata,finnhub,boi' });
  const show = async (label: string, fn: () => Promise<unknown>) => {
    try { console.log(`${label}:`, JSON.stringify(await fn(), null, 1)); } catch (e) { console.log(`${label}: FAILED (${errMessage(e)})`); }
  };
  if (P.history) await show('history (last 3 days)', async () => { const d = await P.history!.fetchDaily(symbol, new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)); return { dates: d.dates.slice(-3), close: d.close.slice(-3) }; });
  if (P.fundamentals) await show('fundamentals', () => P.fundamentals!.fetchFundamentals(symbol));
  if (P.calendar) await show('earnings (next 90d)', () => P.calendar!.fetchEarnings(symbol, new Date().toISOString().slice(0, 10), new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)));
  if (P.calendar?.fetchDividend) await show('dividend', () => P.calendar!.fetchDividend!(symbol, new Date().toISOString().slice(0, 10)));
  if (P.skipped.length) console.log('skipped:', P.skipped);
}
main().catch((e) => { console.error(errMessage(e)); process.exit(1); });
