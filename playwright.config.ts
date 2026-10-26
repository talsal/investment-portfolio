import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: ['golden/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  fullyParallel: true,
  reporter: [['list']],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false, // a stale preview server would silently test an old build
    timeout: 120_000,
    // Lets the request-a-ticker link and the mail button render in tests.
    env: { VITE_REPO_URL: 'https://github.com/example-owner/portfolio-site', VITE_REQUEST_EMAIL: 'requests@example.test' },
  },
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    colorScheme: 'light',
  },
});
