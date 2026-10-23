/**
 * Minimal safe HTML templating. Static template text is trusted; every interpolated value is escaped
 * unless it is already a `Raw` (the result of another `html` call). Arrays are concatenated.
 */
export class Raw {
  constructor(readonly s: string) {}
  toString(): string { return this.s; }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ESC[c] as string);
}

export type Part = Raw | string | number | null | undefined | false | Part[];

function part(v: Part): string {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...vals: Part[]): Raw {
  let out = strings[0] as string;
  vals.forEach((v, i) => { out += part(v) + (strings[i + 1] as string); });
  return new Raw(out);
}

/** Marks a string as trusted HTML. Only for compile-time constants, never for data. */
export const raw = (s: string): Raw => new Raw(s);

export function setHtml(el: Element, content: Raw | string): void {
  el.innerHTML = content instanceof Raw ? content.s : esc(content);
}

/** Wraps a value in a left-to-right isolate so signs and percent marks render correctly inside RTL text. */
export const ltr = (v: Part): Raw => html`<span dir="ltr">${v}</span>`;

/** Escapes plain text and turns `**bold**` into <b>bold</b>. For i18n strings with emphasis. */
export function rich(s: string): Raw {
  return new Raw(esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'));
}
