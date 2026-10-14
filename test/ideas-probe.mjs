// One real ideas run for a brand pack (needs ANTHROPIC_API_KEY and treg): prints each idea compactly and the total spend.
// node test/ideas-probe.mjs [slug] [n] [--next] [--json out.json]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAI } from '../ai.js';
import { createTreg } from '../treg.js';
import { createPacks } from '../brand-pack.js';
import { createIdeas } from '../ideas.js';
for (const l of fs.readFileSync(new URL('../../ugc-factory/.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (k) => args.includes(k), val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--json'));
const slug = pos[0] || 'wearcomet-com', n = +(pos[1] || 12);
const quiet = { info: () => {}, warn: (...a) => console.warn('  !', ...a), error: console.error };
const packs = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
const ai = createAI({ log: { ...quiet, info: (s) => console.log('  ', s) } }), treg = createTreg({ log: quiet });
const I = createIdeas({ slug, packs, ai, treg, log: quiet });
const t0 = Date.now();
console.log('PLATFORMS');
for (const p of await I.platformsFor()) console.log(`  ${p.label.padEnd(16)} w${p.weight} [${p.formats.join(', ')}] ${p.why}`);
const r = flag('--next') ? await I.next({ n }) : await I.generate({ n });
console.log(`\n${r.ideas.length} IDEAS · ${r.threads} live threads · communities: ${r.communities.join(', ')}\n`);
for (const i of r.ideas) {
  console.log(`■ ${i.platformLabel} ${i.format} · ${i.title}${i.checked ? ` [${i.checked}]` : ''}${i.gated ? ` [gated: ${i.gated.join(', ')}]` : ''}`);
  console.log(`  hook: ${i.hook}`);
  console.log(`  copy: ${i.copy.replace(/\n+/g, ' ⏎ ').slice(0, 420)}${i.copy.length > 420 ? '…' : ''}`);
  console.log(`  media: ${i.media.kind}${i.media.slides.length ? ` (${i.media.slides.length} slides)` : ''}${i.media.script.length ? ` (${i.media.script.length} beats)` : ''}${i.media.product ? ' · ' + i.media.product.title : ''} · tags: ${i.hashtags.join(' ')}`);
  for (const w of i.where) console.log(`  where [${w.kind}] ${w.name} ${w.url}${w.rule ? ' · rule: ' + w.rule.slice(0, 120) : ''}`);
  for (const e of i.evidence) console.log(`  ev: ${e.label}: "${e.value.slice(0, 110)}"`);
  console.log(`  moves: ${i.moves.join(', ')} ${i.moveCards.join(' ')} · measure: ${i.measure.metric} · post: ${i.postAt}\n`);
}
for (const x of r.dropped || []) console.log(`✕ dropped ${x.platform}: ${x.title} · ${x.why.join('; ')}`);
const cards = I.toCards(r.ideas);
console.log('CARD SAMPLE', JSON.stringify({ ...cards[0], post: '…' }, null, 1).slice(0, 1200));
if (val('--json')) fs.writeFileSync(val('--json'), JSON.stringify({ ...r, cards }, null, 1));
console.log(`\nUSD ai $${I.spend.ai.toFixed(3)} · treg $${I.spend.treg.toFixed(4)} · total $${(I.spend.ai + I.spend.treg).toFixed(3)} · ${((Date.now() - t0) / 1e3).toFixed(0)}s`);
