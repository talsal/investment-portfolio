import './ui/styles.css';
import { he } from './i18n/he';
import { loadTheme } from './storage/browserStore';
import { html, setHtml } from './ui/html';

const t = loadTheme();
if (t !== 'auto') document.documentElement.setAttribute('data-theme', t);

const P = he.privacy;
const root = document.getElementById('app');
if (root) {
  setHtml(root, html`
    <p><a href="./">${P.back}</a></p>
    <h1>${P.title}</h1>
    ${P.sections.map((s) => html`<section class="compare-section"><h2>${s.h}</h2>${s.p.map((x) => html`<p class="compare-note">${x}</p>`)}${'list' in s && s.list ? html`<ul class="priv-list">${s.list.map((x) => html`<li>${x}</li>`)}</ul>` : ''}</section>`)}
    <p><a href="./">${P.back}</a></p>`);
}
