// One-off helper: lifts the ticker-name dictionary and glossary verbatim out of the reference engine
// so they are not retyped by hand. Re-run only if the reference engine changes.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('reference/template_generic_engine_with_demo_pack.html', 'utf8');

const m = /var TICKER_NAMES = (\{[\s\S]*?\n  \});/.exec(src);
if (!m) throw new Error('TICKER_NAMES not found');
const names = new Function(`return ${m[1]}`)();
// Israeli security numbers are deliberately not shipped in the dictionary: they can identify a specific holding.
const sorted = Object.fromEntries(Object.entries(names).filter(([k]) => !/^\d+$/.test(k)));
writeFileSync(
  'src/i18n/tickerNames.ts',
  `// Hebrew display names for common tickers and Israeli security numbers.\n// Generated from the reference engine by scripts/extract-reference-strings.mjs.\nexport const TICKER_NAMES: Readonly<Record<string, string>> = ${JSON.stringify(sorted, null, 2)};\n`,
);

const g = /<dl class="glossary">([\s\S]*?)<\/dl>/.exec(src);
if (!g) throw new Error('glossary not found');
const pairs = [...g[1].matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].map((x) => [x[1], x[2]]);
writeFileSync(
  'src/i18n/glossary.ts',
  `// Glossary entries (term, definition). Generated from the reference engine.\nexport const GLOSSARY: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(pairs, null, 2)};\n`,
);
console.log(Object.keys(names).length, 'names;', pairs.length, 'glossary entries');
