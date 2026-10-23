import { localKv } from './browserDeps';

// Theme is a display preference, not user data, so it is kept in the browser in both storage modes.
export const THEME_KEY = 'portfolio.theme';

export type Theme = 'auto' | 'light' | 'dark';
export function loadTheme(): Theme {
  const t = localKv.get(THEME_KEY);
  return t === 'light' || t === 'dark' ? t : 'auto';
}
export function saveTheme(t: Theme): void {
  localKv.set(THEME_KEY, t);
}
