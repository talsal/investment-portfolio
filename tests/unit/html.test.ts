import { describe, expect, it } from 'vitest';
import { esc, html, ltr, raw, rich } from '../../src/ui/html';
import { fmtNis, fmtPct, fmtUsd, pcs, sgn, sgnMinus } from '../../src/ui/format';

describe('html templating', () => {
  it('escapes interpolated values but not template text', () => {
    expect(html`<b>${'<script>alert(1)</script>'}</b>`.s).toBe('<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>');
    expect(html`<i title="${'" onmouseover="x'}"></i>`.s).toBe('<i title="&quot; onmouseover=&quot;x"></i>');
  });
  it('passes nested Raw through, joins arrays, drops empty values', () => {
    expect(html`${[html`<a>${'&'}</a>`, 'x<', null, false, undefined, 3]}`.s).toBe('<a>&amp;</a>x&lt;3');
    expect(html`${raw('<hr>')}`.s).toBe('<hr>');
  });
  it('rich() escapes first and then applies **bold**', () => {
    expect(rich('a **b** <c>').s).toBe('a <b>b</b> &lt;c&gt;');
  });
  it('wraps values in an LTR isolate', () => {
    expect(ltr('+5%').s).toBe('<span dir="ltr">+5%</span>');
    expect(esc("'")).toBe('&#39;');
  });
});

describe('formatting', () => {
  it('formats money and percents', () => {
    expect(fmtUsd(1234.5)).toBe('$1,234.50');
    expect(fmtNis(1234.5)).toBe('₪1,235');
    expect(fmtPct(12.345)).toBe('12.3%');
  });
  it('uses the right minus signs per context', () => {
    expect(sgn(-1.26)).toBe('-1.3%');
    expect(sgn(0)).toBe('+0.0%');
    expect(sgnMinus(-1.26)).toBe('−1.3%');
    expect(pcs(-1.234)).toBe('−1.23%');
  });
});

import { isolateSigned } from '../../src/ui/format';
describe('isolateSigned', () => {
  it('isolates signed numbers in free text but leaves ranges and prefixes alone', () => {
    expect(isolateSigned('הכנסות +11.3% בשנה')).toBe('הכנסות ⁦+11.3%⁩ בשנה');
    expect(isolateSigned('(−4.5%)')).toBe('(⁦−4.5%⁩)');
    expect(isolateSigned('ROIC 13-15% ב-2025')).toBe('ROIC 13-15% ב-2025');
    expect(isolateSigned('-2.6 נקודות')).toBe('⁦-2.6⁩ נקודות');
  });
});
