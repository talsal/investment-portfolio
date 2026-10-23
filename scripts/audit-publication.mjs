// Pre-publication audit: run before making the repository public. Scans the WHOLE git history (every commit, every
// branch), not just the working tree, for private files, secrets and your own personal data.
//
// It never prints a private value: findings are reported as file paths, counts and rule names only.
//   npm run audit:publication
//   node scripts/audit-publication.mjs --private-files path1,path2   (override the local private inputs)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const git = (a, opts = {}) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, ...opts });
const problems = [];
const notes = [];

if (!existsSync('.git')) { console.error('Not a git repository.'); process.exit(2); }
const commits = git(['rev-list', '--all']).split('\n').filter(Boolean);
if (!commits.length) { console.log('No commits yet: nothing to audit.'); process.exit(0); }

// 1. Paths that must never have existed in any commit.
const BAD_PATH = [/PRIVATE/i, /(^|\/)reference\//, /(^|\/)sample-data\//, /(^|\/)tests\/golden\/local\//, /(^|\/)\.env($|\.)/, /\.(pem|p12|pfx|key)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)/];
const paths = [...new Set(git(['log', '--all', '--name-only', '--pretty=format:']).split('\n').filter(Boolean))];
for (const p of paths) if (BAD_PATH.some((re) => re.test(p))) problems.push(`history contains a forbidden path: ${p}`);

// 2. Secret-looking strings anywhere in history (added lines only).
const SECRETS = [
  ['anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['github token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{30,}/],
  ['aws key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['key assignment with a value', /\b[A-Z][A-Z0-9_]*(API_KEY|TOKEN|SECRET)\s*[:=]\s*['"]?(?!\$\{\{)(?!['"]?\s*$)[A-Za-z0-9_\-]{16,}/],
];

// 3. Fingerprints of the owner's real data, built at run time from local private files (never stored anywhere).
// Personal values (balances, quantities, costs, typed names) are collected; public market data in those files (price
// series, FX rates) is deliberately ignored. "Strong" tokens are distinctive (5+ significant digits or decimals, not
// round) and fail the audit; "weak" ones (round or short numbers, which also occur in test fixtures) are reported as
// files to look at by hand.
function fingerprints() {
  const files = (flag('--private-files') ?? '').split(',').filter(Boolean);
  if (!files.length) {
    for (const dir of ['sample-data', 'reference']) {
      if (existsSync(dir)) for (const f of readdirSync(dir)) if (/PRIVATE/i.test(f)) files.push(join(dir, f));
    }
  }
  // Anything that also appears in the generic (non-private) template is generic by definition, not personal.
  const generic = (flag('--generic-files') ?? '').split(',').filter(Boolean);
  if (!generic.length && existsSync('reference')) for (const f of readdirSync('reference')) if (!/PRIVATE/i.test(f)) generic.push(join('reference', f));
  const genericText = generic.filter(existsSync).map((f) => readFileSync(f, 'utf8')).join('\n');
  const isGeneric = (tok) => !!genericText && genericText.includes(tok);
  const strong = new Set(), weak = new Set(), names = new Set();
  const add = (raw) => {
    const t = String(raw).replace(/,/g, '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return;
    const digits = t.replace(/^-/, '').replace('.', '').replace(/^0+/, '');
    if (digits.length < 3 || /^(19|20)\d\d$/.test(t)) return;
    const round = /^\d*0{3,}$/.test(t.split('.')[0]) && !t.includes('.');
    if (isGeneric(t.replace(/^-/, ''))) return;
    (digits.length >= 5 && !round ? strong : weak).add(t.replace(/^-/, ''));
  };
  const walk = (v, key = '') => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (typeof v === 'string' || typeof v === 'number') {
      if (typeof v === 'string' && /^(n|name)$/.test(key) && v.length >= 5) { if (!isGeneric(v)) names.add(v); }
      else if (!/^(app|version|exportedAt|updatedAt|d|date)$/.test(key)) add(v);
    }
  };
  for (const f of files) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.json')) { try { walk(JSON.parse(text)); } catch { /* not JSON */ } continue; }
    for (const m of text.matchAll(/(?<![\w.])\d{5,}(?![\w.])|(?<![\w.])\d{1,3}(?:,\d{3}){1,}(?![\w])/g)) add(m[0]);
    for (const m of text.matchAll(/(?:\bn|\bname)\s*:\s*'([^']{5,60})'/g)) if (!isGeneric(m[1])) names.add(m[1]);
  }
  return { files: files.filter(existsSync), strong: [...strong], weak: [...weak], names: [...names] };
}
const fp = fingerprints();
if (!fp.files.length) notes.push('No local private files found: the personal-data fingerprint check was skipped (run this on the machine that has reference/ and sample-data/).');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mk = (list) => (list.length ? new RegExp(`(?<![\\w.])(?:${list.map(escapeRe).join('|')})(?![\\w]|\\.\\d)`) : null);
const strongRe = mk([...fp.strong, ...fp.names]), weakRe = mk(fp.weak);

const hitsByFile = new Map(); // path -> Set(rule)
const weakByFile = new Map(); // path -> count
const note = (file, rule) => { if (!hitsByFile.has(file)) hitsByFile.set(file, new Set()); hitsByFile.get(file).add(rule); };
const log = git(['log', '--all', '-p', '--no-color', '--no-ext-diff', '--diff-filter=AM', '-U0', '--pretty=format:%x00%H']);
let file = '';
for (const line of log.split('\n')) {
  if (line.startsWith('diff --git ')) { file = line.split(' b/')[1] ?? '?'; continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  const body = line.slice(1);
  for (const [name, re] of SECRETS) if (re.test(body)) note(file, `secret: ${name}`);
  if (strongRe && strongRe.test(body)) note(file, 'matches a distinctive value from your private files');
  else if (weakRe && weakRe.test(body)) weakByFile.set(file, (weakByFile.get(file) ?? 0) + 1);
}
for (const [f, rules] of hitsByFile) problems.push(`${f}: ${[...rules].join('; ')}`);
for (const [f, n] of weakByFile) if (!hitsByFile.has(f)) notes.push(`review by hand: ${f} has ${n} line(s) with a round/short number that also occurs in your private files (likely a coincidence in test data)`);

// 4. Identity that becomes public with the first push.
const identities = new Set(git(['log', '--all', '--pretty=format:%an <%ae>%n%cn <%ce>']).split('\n').filter(Boolean));
for (const i of identities) if (!/noreply\.github\.com>$/.test(i)) notes.push(`commit identity that will be public: ${i} (to hide an email, set git config user.email to your GitHub noreply address before publishing)`);

// 5. Git-ignore safety net still in place.
const ignore = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
for (const need of ['reference/', 'sample-data/']) if (!ignore.split('\n').some((l) => l.trim() === need)) problems.push(`.gitignore no longer ignores ${need}`);

console.log(`Audited ${commits.length} commit(s), ${paths.length} historical path(s)${fp.files.length ? `, ${fp.strong.length + fp.names.length} strong / ${fp.weak.length} weak private fingerprint(s) from ${fp.files.length} local file(s)` : ''}.`);
for (const n of notes) console.log(`note: ${n}`);
if (problems.length) {
  console.error(`\nNOT SAFE TO PUBLISH. ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('OK: no private paths, secrets or personal values found in the history.');
