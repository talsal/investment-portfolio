// Generates deterministic, fully synthetic fixtures (fake tickers, fake numbers) for golden tests.
// Nothing here derives from real holdings. Output: tests/golden/fixtures/*.json
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'tests/golden/fixtures';
mkdirSync(OUT, { recursive: true });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (x) => Math.round(x * 100) / 100;

// Business days 2026-01-02 .. 2026-10-22 (weekdays only, no holiday calendar).
const dates = [];
for (let d = new Date(Date.UTC(2026, 0, 2)); d <= new Date(Date.UTC(2026, 9, 22)); d = new Date(d.getTime() + 86400000)) {
  if (d.getUTCDay() % 6 !== 0) dates.push(d.toISOString().slice(0, 10));
}
const rand = rng(20261023);
function walk(start, vol, drift = 0) {
  const out = [];
  let v = start;
  for (let i = 0; i < dates.length; i++) {
    v *= 1 + drift + (rand() - 0.5) * vol;
    out.push(r2(v));
  }
  return out;
}

const spy = walk(650, 0.012, 0.0006);
const fx = walk(3.2, 0.006, -0.0002).map((v) => Math.round(v * 10000) / 10000);
const close = {
  ALFA: walk(80, 0.03, 0.001),
  BETA: walk(190, 0.02, 0.0005),
  DELT: walk(70, 0.025, -0.0004),
  GAMA: walk(50, 0.035, 0.0008),
  EPSI: walk(150, 0.02, -0.0003),
};
const last = (a) => a[a.length - 1];
const baseIdx = dates.indexOf('2026-09-14');

const tickers = {
  ALFA: {
    name: 'אלפא תעשיות', cur: 'USD', price: last(close.ALFA),
    bf: { epsT: 12.1, epsF: 13.4, fcfPs: 14.2, fcfTotal: '$1.1B', fcfTrend: 5.2, earnOk: true, fcfNotes: ['חוב: אין'], moat: 'ok', moatTxt: 'רחב ויציב ↔ · דוגמה סינתטית', growth: 'up', growthTxt: 'הכנסות +14% בשנה (נתון סינתטי)', track: 'שולי תפעול' },
    base: ['+14.0%', '+16.1%', '+5.2%', '18.0% - 24.0%', '55.0% ← 56.1%'], baseClose: close.ALFA[baseIdx],
    events: [{ d: '2026-11-12', what: 'דוח רבעון 3 (סינתטי)', st: 'confirmed' }], div: { perShare: 0.5, freq: 4 },
  },
  BETA: {
    name: 'בטא פיננסים', cur: 'USD', price: last(close.BETA),
    bf: { epsT: 14.0, epsF: 15.5, roe: 18.2, bv: 120.4, earnOk: true, fcfNotes: ['במקום FCF: ROE'], moat: 'ok', moatTxt: 'צר ↔ · סינתטי', growth: 'slow', growthTxt: 'הכנסות +5% (סינתטי)', track: 'ריבית נטו', epsN: 14.9, peNotes: ['הערת P/E סינתטית'] },
    base: ['+5.0%', '+4.0%', 'לא רלוונטי', '9.0% - 14.0%', 'לא רלוונטי'], baseClose: close.BETA[baseIdx],
    events: [{ d: '2026-10-30', what: 'דוח רבעון 3, אחרי הסגירה (סינתטי)', st: 'est' }], div: { perShare: 1.1, freq: 4 },
  },
  GAMA: {
    name: 'גמא אנרגיה', cur: 'USD', price: last(close.GAMA),
    bf: { epsT: null, epsF: 6.0, fcfPs: 4.0, fcfTotal: '$2.0B', fcfTrend: -15.7, earnOk: false, pen: 'על רווח בשיא מחזור', fcfNotes: ['תלויה בסחורה'], moat: 'none', moatTxt: 'אין ↔ · סינתטי', growth: 'na', growthTxt: 'הכנסות −4% (סינתטי)', track: 'מחיר הסחורה', cyclical: true },
    base: ['−4.0%', '+0.6%', '−15.7%', '4.0% - 26.0%', '62.0% ← 69.0%'], baseClose: close.GAMA[baseIdx],
    events: [{ d: '2026-11-09', what: 'דוח רבעון 3 (סינתטי)', st: 'confirmed' }],
  },
  DELT: {
    name: 'דלתא קמעונאות', cur: 'USD', price: last(close.DELT),
    bf: { epsT: 5.3, epsF: 5.5, fcfPs: 7.7, fcfTotal: '$6.6B', fcfTrend: -3.3, earnOk: true, moat: 'bad', moatTxt: 'צר ונשחק ↓ (סינתטי)', growth: 'neg', growthTxt: 'הכנסות −1% (סינתטי)', track: 'מכירות' },
    base: ['−1.0%', '+11.3%', '−3.3%', '13.5% - 23.7%', '47.0% ← 41.5%'], baseClose: close.DELT[baseIdx],
    events: [{ d: null, what: 'דוח רבעון 3. לא נמצא תאריך (סינתטי)', st: 'unk' }], div: { perShare: 0.14, freq: 4 },
  },
  EPSI: {
    name: 'אפסילון מזון', cur: 'USD', price: last(close.EPSI),
    bf: { epsT: null, epsF: 10.0, fcfPs: 9.8, fcfTotal: '$4.5B', fcfTrend: 2.0, earnOk: true, moat: 'weak', moatTxt: 'חלש ↔ (סינתטי)', growth: 'flat', growthTxt: 'הכנסות 0% (סינתטי)', track: 'נפח' },
    base: ['0.0%', '−2.0%', '+2.0%', '12.0% - 20.0%', '29.0% ← 28.0%'], baseClose: close.EPSI[baseIdx],
    events: [{ d: '2026-10-23', what: 'דוח היום (סינתטי)', st: 'confirmed' }, { d: '2026-10-20', what: 'אירוע שעבר (סינתטי)', st: 'est' }],
  },
  ZETA: {
    name: 'זטא תוכנה', cur: 'USD', price: 270.55, watch: true, watchAdded: { date: '20.10.2026', px: 247.09 },
    bf: { epsT: 17.9, epsF: 26.9, fcfPs: 27.2, fcfTotal: '$10.6B', fcfTrend: 9.4, earnOk: true, peNotes: ['הערה סינתטית'], fcfNotes: ['הערה סינתטית'], moat: 'contested', moatTxt: 'תחת איום (סינתטי)', growth: 'slow', growthTxt: 'הכנסות +10% (סינתטי)', track: 'ARR', next: 'דוח רבעון 4, משוער (סינתטי)' },
  },
  ETFX: { name: 'קרן דוגמה', cur: 'USD', price: 410.5 },
};

const pack = {
  asof: '22.10.2026', fx: last(fx),
  bm: { date: dates[baseIdx], dateLabel: '14.09.2026', spyBase: spy[baseIdx], spyCur: last(spy) },
  hist: { dates, fx, spy, close },
  tickers,
};

const row = (n, t, c, ty, q, k, p) => ({ n, t, c, ty, q, k, p });
const profile = {
  fx: '', cashUsd: '1500', cashNis: '12000', mmf: '30000', tradeRate: '6', eqTarget: '70',
  rows: [
    row('אלפא תעשיות', 'ALFA', 'USD', 'eq', '40', '80', '105'),
    row('בטא פיננסים', 'BETA', 'USD', 'eq', '15', '200', ''),
    row('גמא אנרגיה', 'GAMA', 'USD', 'eq', '100', '', '55'),
    row('דלתא קמעונאות', 'DELT', 'USD', 'eq', '60', '70', '62'),
    row('אפסילון מזון', 'EPSI', 'USD', 'eq', '25', '150', '140'),
    row('קרן דוגמה', 'ETFX', 'USD', 'eq', '10', '400', '410'),
    row('אג"ח דוגמה', 'BNDX', 'USD', 'bond', '30', '70', '72'),
    row('סל ישראלי דוגמה', '1234567', 'ILS', 'eq', '200', '105', '110'),
    row('סל באגורות דוגמה', '7654321', 'AGO', 'eq', '500', '2100', '2250'),
    row('מניה בלי ניתוח', 'QQQQ', 'USD', 'eq', '5', '10', '12'),
  ],
  gemel: [
    { n: 'גמל דוגמה א', b: '80000', d: '60000', e: '60', r: '5' },
    { n: 'גמל דוגמה ב', b: '20000', d: '', e: '', r: '' },
  ],
  hish: [{ n: 'השתלמות דוגמה', b: '150000', d: '110000', e: '30', r: '7' }],
  trades: [
    { d: '2026-02-10', t: 'ALFA', s: 'B', q: '25', p: '78' },
    { d: '2026-04-15', t: 'ALFA', s: 'B', q: '15', p: '84' },
    { d: '2026-03-02', t: 'BETA', s: 'B', q: '20', p: '190' },
    { d: '2026-07-01', t: 'BETA', s: 'S', q: '5', p: '215' },
    { d: '2026-05-20', t: 'DELT', s: 'B', q: '60', p: '70' },
    { d: '2026-06-11', t: 'GAMA', s: 'B', q: '100', p: '48' },
    { d: '2026-08-03', t: 'QQQQ', s: 'B', q: '5', p: '10' },
  ],
  cf: { income: '18000', extra: '5000', target: '6', rent: '5500', food: '2500', out: '1200', car: '1800', bills: '1500', kids: '', health: '300', other: '700' },
  updatedAt: 0,
};

const write = (n, o) => writeFileSync(`${OUT}/${n}.json`, JSON.stringify(o, null, 2) + '\n');
write('pack-fake', pack);
write('profile-fake', profile);
write('profile-cash-only', { ...profile, rows: [], gemel: [], hish: [], trades: [], cf: { ...profile.cf, income: '', rent: '', food: '', out: '', car: '', bills: '', health: '', other: '', extra: '' } });
write('profile-fx-override', { ...profile, fx: '3.5', tradeRate: '' });
// The in-app "load example" bundle is the same synthetic data, with CPI and a demo marker added to the pack.
mkdirSync('src/example', { recursive: true });
writeFileSync('src/example/pack.json', JSON.stringify({ ...pack, demo: true, cpi: { yoyPct: 2.0, label: 'דוגמה' } }) + '\n');
writeFileSync('src/example/profile.json', JSON.stringify(profile, null, 2) + '\n');
console.log('fixtures written to', OUT);
