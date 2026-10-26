/** US regular session closes at 16:00 New York time; allow a little time for sources to publish the close. */
const CLOSE_HOUR = 16, CLOSE_MIN = 30;

const iso = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * The date of the most recent US session whose close should already be published at `now`: today after the close on a
 * weekday, otherwise the previous weekday. Holidays are not known, so on those days the answer can be one session too late.
 */
export function expectedUsClose(now: Date): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, Number(x.value)])) as Record<string, number>;
  const d = new Date(Date.UTC(p.year!, p.month! - 1, p.day!));
  const weekday = d.getUTCDay();
  const afterClose = p.hour! > CLOSE_HOUR || (p.hour === CLOSE_HOUR && p.minute! >= CLOSE_MIN);
  if (!(weekday >= 1 && weekday <= 5 && afterClose)) {
    do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  }
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
