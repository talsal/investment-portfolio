import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/audit-publication.mjs');
let repo: string;
const sh = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@users.noreply.github.com', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@users.noreply.github.com' } });
const commit = (files: Record<string, string>, msg = 'c') => {
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(repo, p, '..'), { recursive: true }); writeFileSync(join(repo, p), c); }
  sh('add', '-f', '-A', '--', '.', ':(exclude)priv-local.json'); sh('commit', '-q', '-m', msg);
};
const audit = (extra: string[] = []) => spawnSync('node', [SCRIPT, ...extra], { cwd: repo, encoding: 'utf8' });
const GITIGNORE = 'reference/\nsample-data/\n';
const PRIVATE_FILE = () => join(repo, 'priv-local.json'); // lives outside git (untracked, never committed)

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'audit-'));
  sh('init', '-q', '-b', 'main');
  writeFileSync(PRIVATE_FILE(), JSON.stringify({ profile: { cashNis: '48271.55', rows: [{ n: 'My Secret Fund', q: '1234.5678', k: '90210' }] } }));
  commit({ '.gitignore': GITIGNORE + 'priv-local.json\n' }, 'init');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('publication audit', () => {
  it('passes a clean history', () => {
    commit({ 'src/a.ts': 'export const x = 1;' });
    const r = audit(['--private-files', PRIVATE_FILE()]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  it('fails when a distinctive private value appears anywhere in history, even if later deleted, and never prints it', () => {
    commit({ 'notes.txt': 'balance was 48271.55 last week' }, 'oops');
    commit({ 'notes.txt': 'removed' }, 'cleanup');
    const r = audit(['--private-files', PRIVATE_FILE()]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('notes.txt');
    expect(r.stdout + r.stderr).not.toContain('48271');
    expect(r.stdout + r.stderr).not.toContain('Secret Fund');
  });

  it('catches typed names and quantities too', () => {
    commit({ 'a.json': '{"n":"My Secret Fund"}' });
    expect(audit(['--private-files', PRIVATE_FILE()]).status).toBe(1);
    rmSync(join(repo, 'a.json'));
    sh('add', '-A'); sh('commit', '-q', '-m', 'rm');
    // the earlier commit still holds it
    expect(audit(['--private-files', PRIVATE_FILE()]).status).toBe(1);
  });

  it('ignores values that also appear in the generic template', () => {
    const generic = join(repo, 'generic.html');
    writeFileSync(generic, 'palette 1234.5678');
    commit({ 'b.txt': 'x 1234.5678 y' });
    expect(audit(['--private-files', PRIVATE_FILE(), '--generic-files', generic]).status).toBe(0);
  });

  it('flags forbidden paths in history', () => {
    commit({ 'reference/owner_PRIVATE.html': 'x', 'ok.txt': 'y' });
    const r = audit(['--private-files', PRIVATE_FILE()]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('forbidden path: reference/owner_PRIVATE.html');
  });

  it('flags secret-looking strings but not workflow placeholders or empty assignments', () => {
    commit({ 'wf.yml': 'TWELVEDATA_API_KEY: ${{ secrets.TWELVEDATA_API_KEY }}\nANTHROPIC_API_KEY=\n' });
    expect(audit(['--private-files', PRIVATE_FILE()]).status).toBe(0);
    commit({ 'leak.env.txt': 'ANTHROPIC_API_KEY=sk-ant-' + 'a'.repeat(40) });
    const r = audit(['--private-files', PRIVATE_FILE()]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('secret');
    expect(r.stdout + r.stderr).not.toContain('a'.repeat(40));
  });

  it('fails if the git-ignore safety net is removed, and notes a public email identity', () => {
    commit({ '.gitignore': 'node_modules/\n' });
    expect(audit(['--private-files', PRIVATE_FILE()]).stderr).toContain('.gitignore no longer ignores');
    const out = audit(['--private-files', PRIVATE_FILE()]);
    expect(out.stdout).not.toContain('commit identity'); // noreply identities are fine
  });

  it('without local private files it says the fingerprint check was skipped instead of passing silently', () => {
    const r = audit(['--private-files', join(repo, 'does-not-exist.json')]);
    expect(r.stdout).toContain('skipped');
  });
});
