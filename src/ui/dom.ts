import { isolateSigned } from './format';
import { html, type Part, type Raw } from './html';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

export const tile = (k: Part, v: Part, sub: Part): Raw =>
  html`<div class="cf-tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;

export const th = (c: Part, num = false): Raw => html`<th class="${num ? 'num' : ''}">${c}</th>`;
export const td = (c: Part, num = false, cls = ''): Raw => html`<td class="${[num ? 'num' : '', cls].filter(Boolean).join(' ')}">${c}</td>`;
export const tr = (cells: Part[], cls = ''): Raw => html`<tr class="${cls}">${cells}</tr>`;
export const dataTable = (head: Part[], rows: Part[]): Raw =>
  html`<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;

export const why = (t: Part, cls = ''): Raw => html`<span class="bf-why ${cls}">${typeof t === 'string' ? isolateSigned(t) : t}</span>`;
export const muted = (t: Part): Raw => html`<span class="c-muted">${t}</span>`;

export function show(id: string, visible: boolean): void {
  $(id).hidden = !visible;
}
