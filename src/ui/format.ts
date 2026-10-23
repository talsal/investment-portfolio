import { html, ltr, type Raw } from './html';

const en = 'en-US';
export const fmtUsd = (v: number): string => '$' + v.toLocaleString(en, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtNis = (v: number): string => '₪' + v.toLocaleString(en, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const fmtPct = (v: number): string => v.toLocaleString(en, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

/** Signed percent with ASCII hyphen, as used in tiles and tables. */
export const sgn = (v: number, d = 1): string => (v < 0 ? '-' : '+') + Math.abs(v).toFixed(d) + '%';
/** Signed percent with a true minus sign, as used in the pie centre and the history chart. */
export const sgnMinus = (v: number, d = 1): string => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%';
/** Signed percent, two decimals (benchmark section). */
export const pcs = (v: number): string => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';

export const tone = (v: number): 'c-gain' | 'c-loss' => (v < 0 ? 'c-loss' : 'c-gain');

/** Coloured, left-to-right isolated signed amount/percent. */
export function colored(v: number, text: string, extra = ''): Raw {
  return html`<span dir="ltr" class="${tone(v)} ${extra}">${text}</span>`;
}

/** Unicode isolate around a signed number inside plain text (the HTML equivalent is `ltr`). */
export const iso = (s: string): string => `\u2066${s}\u2069`;

/**
 * Wraps signed numbers inside free Hebrew text (e.g. "הכנסות +11.3% בשנה") in bidi isolates so the sign stays
 * on the correct side. Used for text that comes from data files rather than from our own templates.
 */
export const isolateSigned = (text: string): string => text.replace(/(^|[\s(])([+\-−]\d[\d.,]*%?)/g, '$1\u2066$2\u2069');

export { ltr };

/** dd.mm.yyyy from an ISO date. */
export const isoToDmy = (iso: string): string => {
  const p = iso.split('-');
  return `${p[2]}.${p[1]}.${p[0]}`;
};
/** dd.mm from an ISO date. */
export const isoDm = (k: string): string => k.slice(8, 10) + '.' + k.slice(5, 7);
