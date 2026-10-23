import './ui/styles.css';
import { he } from './i18n/he';
import { startApp } from './ui/app';

const root = document.getElementById('app');
if (root) void startApp(root);

// Footer lives outside <main>: it is the page's contentinfo landmark.
const foot = document.createElement('footer');
foot.className = 'site-foot viz-root';
foot.setAttribute('dir', 'rtl');
foot.setAttribute('lang', 'he');
const link = document.createElement('a');
link.href = './privacy.html';
link.textContent = he.footer.privacy;
foot.append(link, document.createTextNode(` · ${he.footer.note}`));
document.body.append(foot);
