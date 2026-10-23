import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runReference, type Scenario, type Snapshot } from './harness';

const fx = (n: string) => JSON.parse(readFileSync(`tests/golden/fixtures/${n}.json`, 'utf8'));
const SNAP_DIR = 'tests/golden/snapshots';

function check(name: string, snap: Snapshot, dir = SNAP_DIR) {
  const file = `${dir}/${name}.json`;
  const text = JSON.stringify(snap, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

const scenarios: Record<string, () => Scenario> = {
  'fake-full': () => ({ profile: fx('profile-fake'), pack: fx('pack-fake'), hsUsd: true }),
  'fake-fx-override': () => ({ profile: fx('profile-fx-override'), pack: fx('pack-fake') }),
  'fake-cash-only': () => ({ profile: fx('profile-cash-only'), pack: fx('pack-fake') }),
  'fake-empty-pack': () => ({ profile: fx('profile-fake'), pack: {} }),
  'empty-profile': () => ({ profile: {}, pack: fx('pack-fake') }),
};

for (const [name, make] of Object.entries(scenarios)) {
  test(`reference engine snapshot: ${name}`, async ({ browser }) => {
    const snap = await runReference(browser, make());
    check(name, snap);
  });
}

test('reference engine output is deterministic across runs', async ({ browser }) => {
  const a = await runReference(browser, scenarios['fake-full']!());
  const b = await runReference(browser, scenarios['fake-full']!());
  expect(b).toEqual(a);
});

test('full fixture exercises every section', async ({ browser }) => {
  const snap = await runReference(browser, scenarios['fake-full']!());
  expect(snap.empty).toBe(false);
  for (const id of ['plSection', 'trSection', 'eqSection', 'annSection', 'bfSection', 'wlSection', 'divSection', 'bmSection', 'hsSection', 'evSection', 'cfSection']) {
    expect(snap.sections[id]?.hidden, `${id} should be visible`).toBe(false);
  }
  expect(snap.pie.legend.length).toBeGreaterThan(5);
  expect(snap.hsUsd?.hidden).toBe(false);
});

test('empty profile shows the empty state', async ({ browser }) => {
  const snap = await runReference(browser, scenarios['empty-profile']!());
  expect(snap.empty).toBe(true);
});

// Local-only: runs the reference against the real (git-ignored) profile and pack. Output goes to
// tests/golden/local/, which is git-ignored. Run with: npm run golden:private
test('@private reference snapshot of real profile', async ({ browser }) => {
  test.skip(!process.env.GOLDEN_PRIVATE, 'set GOLDEN_PRIVATE=1 to run');
  const profileFile = JSON.parse(readFileSync('sample-data/profile_example_PRIVATE.json', 'utf8'));
  const pack = JSON.parse(readFileSync('sample-data/market_pack_example.json', 'utf8'));
  const snap = await runReference(browser, { profile: profileFile.profile ?? profileFile, pack, hsUsd: true });
  check('private-full', snap, 'tests/golden/local');
});
