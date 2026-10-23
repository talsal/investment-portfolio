import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Scenario, Snapshot } from '../golden/harness';
import { runApp } from './appHarness';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const golden = (n: string): Snapshot => JSON.parse(readFileSync(`tests/golden/snapshots/${n}.json`, 'utf8'));

/**
 * Intentional, reviewed differences from the reference engine's rendered text. Anything not listed here
 * must match exactly. Each entry maps a reference string to the new app's string.
 */
const KNOWN_TEXT_CHANGES: Array<[from: string, to: string]> = [
  [
    'אחרי כל דוח מעדכנים את נתוני הבסיס בטבלת הקריטריונים (בקש "עדכן קריטריונים" וציין את המניה).',
    'אחרי כל דוח מעדכנים את נתוני הבסיס בטבלת הקריטריונים.',
  ],
];

/** Unicode bidi isolates (U+2066..U+2069) are layout-only; the new app adds more of them than the reference. */
const stripIsolates = (s: Snapshot): Snapshot => JSON.parse(JSON.stringify(s).replace(/[\u2066-\u2069]/g, ''));

function applyKnownChanges(s: Snapshot): Snapshot {
  let text = JSON.stringify(s);
  for (const [from, to] of KNOWN_TEXT_CHANGES) text = text.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
  return stripIsolates(JSON.parse(text));
}

/**
 * Known behavioural difference: the reference shows tickers flagged `watch` in the pack; the new app shows the
 * user's own watchlist. Scenarios whose profile has no watchlist therefore waive the watchlist section.
 */
const WAIVE_WATCHLIST = new Map<string, { hidden: boolean }>([
  ['empty-profile', { hidden: true }], // no watchlist entries -> section hidden
  ['fake-empty-pack', { hidden: false }], // watchlisted ticker without analysis -> section shown with a "no analysis" note
]);

const scenarios: Record<string, () => Scenario> = {
  'fake-full': () => ({ profile: fx('profile-fake'), pack: fx('pack-fake'), hsUsd: true }),
  'fake-fx-override': () => ({ profile: fx('profile-fx-override'), pack: fx('pack-fake') }),
  'fake-cash-only': () => ({ profile: fx('profile-cash-only'), pack: fx('pack-fake') }),
  'fake-empty-pack': () => ({ profile: fx('profile-fake'), pack: {} }),
  'empty-profile': () => ({ profile: {}, pack: fx('pack-fake') }),
};

for (const [name, make] of Object.entries(scenarios)) {
  test(`parity with reference engine: ${name}`, async ({ browser }) => {
    const actual = stripIsolates(await runApp(browser, make()));
    const expected = applyKnownChanges(golden(name));
    if (WAIVE_WATCHLIST.has(name)) {
      expect(actual.sections.wlSection?.hidden).toBe((WAIVE_WATCHLIST.get(name) as { hidden: boolean }).hidden);
      delete actual.sections.wlSection; delete expected.sections.wlSection;
    }
    // Compare section by section so a failure points at the section.
    for (const id of Object.keys(expected.sections)) expect(actual.sections[id], id).toEqual(expected.sections[id]);
    expect(actual).toEqual(expected);
  });
}

// Local-only: compares the new app with a live run of the reference engine on the real (git-ignored)
// profile and market pack. Nothing is stored; run with: npm run parity:private
test('@private parity on real profile and pack', async ({ browser }) => {
  test.skip(!process.env.GOLDEN_PRIVATE, 'set GOLDEN_PRIVATE=1 to run');
  const raw = JSON.parse(readFileSync('sample-data/profile_example_PRIVATE.json', 'utf8'));
  const pack = JSON.parse(readFileSync('sample-data/market_pack_example.json', 'utf8'));
  const base = raw.profile ?? raw;
  // The reference engine shows pack-flagged tickers; give the new app the equivalent user watchlist.
  const watchlist = Object.keys(pack.tickers).filter((t) => pack.tickers[t].watch);
  const sc: Scenario = { profile: { ...base, watchlist }, pack, hsUsd: true };
  const { runReference } = await import('../golden/harness');
  const expected = applyKnownChanges(await runReference(browser, sc));
  const actual = stripIsolates(await runApp(browser, sc));
  for (const id of Object.keys(expected.sections)) expect(actual.sections[id], id).toEqual(expected.sections[id]);
  expect(actual).toEqual(expected);
});
