// One real listen run for a brand pack (default wearcomet-com) on every source (PAID=0 for free sources only). Needs ANTHROPIC_API_KEY for the
// filter and the tags (from ../ugc-factory/.env). Usage: node test/listen-probe.mjs [slug] ; FRESH=1 rebuilds listen/config.json,
// ONLY=tiktok,news reads just those, CAP=0.6 is the per-run cap, TAGMAX=120 caps how many new items Claude tags, ASKED=1 also re-reads asked threads.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAI } from '../ai.js';
import { createTreg } from '../treg.js';
import { createPacks } from '../brand-pack.js';
import { createListenWatch } from '../listen-watch.js';
for (const l of fs.readFileSync(new URL('../../ugc-factory/.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2] || 'wearcomet-com';
const quiet = { log: () => {}, info: () => {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
const packs = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
const ai = createAI({ log: quiet }), treg = createTreg({ client: 'shopos-feed', log: quiet });
const W = createListenWatch({ slug, packs, treg, ai, log: quiet });
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '?');
const t0 = Date.now();
const c = await W.config({ fresh: process.env.FRESH === '1' });
console.log(`\n== ${c.name} (${c.host}) ${c.country} · ${c.category} · noun "${c.noun}"\nproducts: ${c.products.join(' | ')}\nrivals: ${c.rivals.join(', ')}\nterms: ${JSON.stringify(c.terms)}\nfilter (${c.filter.by}): strong=${c.filter.strong.join('/')} weak=${c.filter.weak.join('/')} must=${c.filter.must.join(',')} junk=${c.filter.junk.join(',')}`);
const r = await W.run({ paid: process.env.PAID !== '0', capUsd: +(process.env.CAP || 0.6), only: process.env.ONLY ? process.env.ONLY.split(',') : null, tagMax: +(process.env.TAGMAX || 120) });
const s = r.status;
console.log(`\n== sources (${((Date.now() - t0) / 1e3).toFixed(0)}s)`);
for (const [k, x] of Object.entries(s.sources)) console.log(`${k.padEnd(10)} ${x.name.padEnd(19)} ${x.state.padEnd(8)} fetched ${String(x.got).padStart(4)} · kept ${String(x.kept).padStart(4)} · in store ${String(x.total ?? 0).padStart(4)}${x.error ? ' · ' + x.error : ''}${x.detail ? ' · ' + JSON.stringify(x.detail) : ''}${x.notes?.length ? `\n         notes: ${x.notes.slice(0, 3).join(' | ')}` : ''}`);
const ab = {}; r.items.forEach((x) => { ab[x.about] = (ab[x.about] || 0) + 1; });
console.log(`items ${s.items} (${JSON.stringify(ab)}), tagged this run ${s.tagged ?? 0}, dropped by tag ${s.droppedByTag}, untagged ${s.untagged}`);
console.log('\n== top 8 themes');
for (const t of r.themes.slice(0, 8)) console.log(`${t.name.padEnd(22)} n=${t.n} share=${(t.share * 100).toFixed(1)}% +${t.pos}/-${t.neg} brand=${t.brand} wk=${t.wow.week} vs ${t.wow.lastWeek}${t.sinceLastRun ? ` Δrun=${t.sinceLastRun.n}` : ''}\n    “${(t.quote || '').slice(0, 150)}”`);
console.log('\n== top 10 threads');
for (const t of r.threads.slice(0, 10)) console.log(`${t.where.padEnd(22)} ${day(t.lastActive)} replies=${t.replies} ${t.about}/${t.intent} · ${t.title.slice(0, 80)}\n    ${t.url}\n    “${t.quote.slice(0, 130)}”`);
console.log('\n== top 10 communities');
for (const m of r.communities.slice(0, 10)) console.log(`${m.name.padEnd(24)} posts=${m.posts} threads=${m.threads} last=${day(m.lastActive)} · ${m.why}\n    ${m.url}`);
const h = await W.heard({ intent: 'question', about: 'brand', limit: 3 });
console.log(`\n== heard(intent=question, about=brand): ${h.n}`); h.items.forEach((x) => console.log(`  [${x.platform} ${x.sub || ''}] ${String(x.text).slice(0, 120)}`));
const hv = await W.itemsView({ limit: 1 }); console.log(`\n== heard by source: ${hv.sources.map((x) => `${x.name} ${x.n}`).join(' · ')} · modes ${JSON.stringify(hv.modes)}`);
const hist = await W.history({ days: 30 }); console.log(`== history: ${hist.days.map((d) => `${d.day} ${d.total}`).join(', ')}`);
if (process.env.ASKED === '1') console.log('== asked', JSON.stringify(await W.askedRun()));
console.log(`\n== USD: ai $${s.usd.ai} · treg $${s.usd.treg} · total $${s.usd.total} (config filter $${(c.usd || 0).toFixed(4)} when first built)`);
