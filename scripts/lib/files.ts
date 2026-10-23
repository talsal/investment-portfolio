import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const readJson = (dir: string, rel: string): unknown | null => {
  try { return JSON.parse(readFileSync(join(dir, rel), 'utf8')); } catch { return null; }
};
export const fileExists = (dir: string, rel: string): boolean => existsSync(join(dir, rel));

/**
 * Writes via a temp file and rename so a crash never leaves half a JSON file in the repo. Skips the write (and
 * returns false) when the file already has exactly this content, so unchanged runs produce no git diff.
 */
export function writeJson(dir: string, rel: string, value: unknown, compact = false): boolean {
  const path = join(dir, rel);
  const text = (compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)) + '\n';
  try { if (readFileSync(path, 'utf8') === text) return false; } catch { /* new file */ }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return true;
}
