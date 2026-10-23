import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: ['golden/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  fullyParallel: true,
  reporter: [['list']],
  use: {
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    colorScheme: 'light',
  },
});
