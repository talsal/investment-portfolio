import { describe, expect, it } from 'vitest';
import { buildMailto } from '../../src/data/mailto';

describe('buildMailto', () => {
  it('encodes subject and body, including Hebrew, line breaks and symbols', () => {
    const url = buildMailto('a@b.test', 'בקשה & עוד', 'שורה 1\nAAA, BBB');
    expect(url.startsWith('mailto:a@b.test?subject=')).toBe(true);
    const [, subject, body] = /subject=([^&]*)&body=(.*)$/s.exec(url)!;
    expect(decodeURIComponent(subject!)).toBe('בקשה & עוד');
    expect(decodeURIComponent(body!)).toBe('שורה 1\nAAA, BBB');
    expect(url).not.toMatch(/[\s<>"]/);
  });
});
