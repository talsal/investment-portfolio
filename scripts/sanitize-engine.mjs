// Produces tests/golden/engine/engine_generic.html: the reference generic engine with its embedded
// market pack emptied, so it can be committed. The golden harness injects fixture packs at load time.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('reference/template_generic_engine_with_demo_pack.html', 'utf8');
const re = /(<script type="application\/json" id="marketData">)[\s\S]*?(<\/script>)/;
if (!re.test(src)) throw new Error('marketData script not found');
writeFileSync('tests/golden/engine/engine_generic.html', src.replace(re, '$1{}$2'));
console.log('wrote tests/golden/engine/engine_generic.html');
