/** Parses a user-typed number: strips thousands commas; positive finite numbers only, else 0. */
export function nz(s: unknown): number {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return isFinite(n) && n > 0 ? n : 0;
}

/** Parses a user-typed rate (may be negative); null when blank or invalid. */
export function rate(s: unknown): number | null {
  if (s === '' || s === undefined || s === null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

/** Normalised numeric string within [lo, hi], or '' when blank/invalid/out of range. */
export function numStr(v: unknown, lo: number, hi: number): string {
  if (v === null || v === undefined || v === '') return '';
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) && n >= lo && n <= hi ? String(n) : '';
}

export function normTicker(t: unknown): string {
  return String(t ?? '').toUpperCase().replace(/\s+/g, '');
}
