import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/.
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
