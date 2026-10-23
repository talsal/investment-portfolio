import { localKv } from '../storage/browserDeps';

// Display preferences (theme, text size). They are not user data, so they are kept in the browser in both storage modes.
export type FontScale = 'normal' | 'large' | 'xlarge';
const KEY = 'portfolio.fontScale';

export const loadFontScale = (): FontScale => {
  const v = localKv.get(KEY);
  return v === 'large' || v === 'xlarge' ? v : 'normal';
};
export const saveFontScale = (v: FontScale): void => { localKv.set(KEY, v); };

/** `normal` is the default scale in CSS; the others set data-fs on <html>. */
export function applyFontScale(v: FontScale): void {
  if (v === 'normal') document.documentElement.removeAttribute('data-fs');
  else document.documentElement.setAttribute('data-fs', v);
}
