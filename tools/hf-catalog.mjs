// Higgsfield's whole API catalog → data/higgsfield-catalog.json: every workflow's endpoint, title, usage notes and full input
// schema, read from the public docs (docs.higgsfield.ai). Run again when Higgsfield adds models: node tools/hf-catalog.mjs
// jam2/higgsfield.js validates every request against these schemas; data/higgsfield-routes.json picks the offering per job.
import fs from 'node:fs'; import path from 'node:path';
const BASE = 'https://docs.higgsfield.ai', OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'higgsfield-catalog.json');
const get = async (p) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(BASE + p); if (r.ok) return await r.text(); } catch {} await new Promise((ok) => setTimeout(ok, 800 * (i + 1))); } return ''; };
const links = (md, re) => [...new Set([...md.matchAll(/\]\((\/docs\/models\/[^)\s]+\.md)\)/g)].map((m) => m[1]).filter((p) => re.test(p)))];
const families = [];
for (const [kind, page] of [['image', '/docs/models/image-generation.md'], ['video', '/docs/models/video-generation.md']]) {
  const md = await get(page);
  for (const fam of links(md, /^\/docs\/models\/[^/]+\.md$/).filter((p) => !/generation\.md$/.test(p))) {
    const fm = await get(fam); families.push({ kind, page: fam, name: (/^# (.+)$/m.exec(fm)?.[1] || fam).replace(/ API$/, ''), about: /^> (?!##|Fetch|Use this)(.+)$/m.exec(fm)?.[1] || '', md: fm });
  }
}
const workflows = [];
for (const f of families) {
  const md = f.md; const wf = links(md, new RegExp('^' + f.page.replace(/\.md$/, '') + '/'));
  for (const w of wf) {
    const t = await get(w); if (!t) continue;
    const id = /\*\*Endpoint ID:\*\*\s*`([^`]+)`/.exec(t)?.[1]; if (!id) continue;
    const title = /^# (.+)$/m.exec(t)?.[1] || id;
    const notes = (/## Usage notes\n([\s\S]*?)\n## /.exec(t)?.[1] || '').split('\n').map((l) => l.replace(/^\*\s*/, '').replace(/\\_/g, '_').trim()).filter(Boolean).slice(0, 12);
    const js = /Complete JSON schema\*\*[\s\S]*?```json[^\n]*\n([\s\S]*?)```/.exec(t)?.[1]; let schema = null;
    if (js) { try { schema = JSON.parse(js.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n')); } catch (e) { console.warn('schema', id, e.message); } }
    const out = /result\["video"\]|result\.video/.test(t) ? 'video' : /images\[0\]|result\["images"\]|result\.images/.test(t) ? 'images' : f.kind === 'video' ? 'video' : 'images';
    workflows.push({ id, family: f.name, kind: f.kind, title: title.replace(/ API$/, ''), notes, out, schema });
    process.stdout.write('.');
  }
}
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), source: BASE, families: families.length, workflows }, null, 1) + '\n');
console.log(`\n${families.length} families, ${workflows.length} workflows → ${OUT}`);
