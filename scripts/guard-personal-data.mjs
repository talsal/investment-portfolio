// Fails when private files are tracked or staged. Used by the pre-commit hook and CI.
import { execFileSync } from 'node:child_process';

const staged = process.argv.includes('--staged');
const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files'];
const files = execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
const bad = files.filter(
  (f) => /PRIVATE/i.test(f) || f.startsWith('reference/') || f.startsWith('tests/golden/local/') || /(^|\/)\.env/.test(f),
);
if (bad.length) {
  console.error('Refusing: private/reference files are tracked or staged:\n  ' + bad.join('\n  '));
  process.exit(1);
}
