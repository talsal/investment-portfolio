import type { Profile } from '../calc/types';
import { blankProfile, sanitizeProfile } from '../profile/schema';

// M1: plain localStorage persistence. M2 replaces this with the two storage modes and the versioned format.
export const PROFILE_KEY = 'portfolio.profile';
export const THEME_KEY = 'portfolio.theme';

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? sanitizeProfile(JSON.parse(raw)) : blankProfile();
  } catch {
    return blankProfile();
  }
}

export function saveProfile(P: Profile): boolean {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(P));
    return true;
  } catch {
    return false;
  }
}

export type Theme = 'auto' | 'light' | 'dark';
export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}
export function saveTheme(t: Theme): void {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable: theme just won't persist */ }
}
