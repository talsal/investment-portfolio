import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/** Strict CSP for the production build. GitHub Pages cannot set headers, so it ships as a <meta> tag. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Serves ./data at /data in dev, copies it into dist/data on build, and injects the CSP meta tag in builds. */
function staticDataAndCsp(): Plugin {
  const dataDir = resolve('data');
  return {
    name: 'static-data-and-csp',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const file = resolve(dataDir, '.' + decodeURIComponent((req.url ?? '/').split('?')[0] as string));
        if (!file.startsWith(dataDir) || !existsSync(file)) return next();
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        return ctx.server ? html : html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
      },
    },
    closeBundle() {
      if (existsSync(dataDir)) cpSync(dataDir, resolve('dist/data'), { recursive: true });
    },
  };
}

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/.
  base: './',
  plugins: [staticDataAndCsp()],
  build: {
    target: 'es2022', sourcemap: true, assetsInlineLimit: 0, modulePreload: { polyfill: false },
    rollupOptions: { input: { main: resolve('index.html'), privacy: resolve('privacy.html') } },
  },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
