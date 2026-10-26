#!/usr/bin/env node
// Builds data/deliverables.json from docs/deliverables-catalog.txt: every deliverable a card could ask for (228 on 26 Oct).
// A row is: name | platform | tier (C common, S sometimes, N niche) | layout | action (an existing one, or NEW) | what Brew makes |
// the checks | who ships it | the hand-off files. A NEW row becomes a planning deliverable: Brew writes it, checks it and hands
// over a brief; a person makes and ships it. Run it after the catalogue changes: node tools/deliverables.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'docs/deliverables-catalog.txt'), 'utf8');

/* the agent a planning deliverable belongs to, by catalogue section */
const agentOf = (sec) => /^Social|^Creators|^Creative/.test(sec) ? 'creative' : /^Paid|^Ops/.test(sec) ? 'performance' : /^Marketplaces|^Owned web/.test(sec) ? 'storefront' : 'crm';
/* the package a planning deliverable is written as, by layout: the families every jam already draws, checks and briefs */
const FAMILY = { pic: 'post', post: 'post', set: 'brief', reel: 'brief', brief: 'brief', msg: 'crm', mail: 'crm', page: 'store', check: 'setup', acct: 'setup' };
const PREVIEW = { post: 'copy', brief: 'checklist', crm: 'chat', store: 'copy', setup: 'checklist' };

const rows = [], seen = new Set();
let section = '';
for (const line of src.split('\n')) {
  if (line.startsWith('## ')) { section = line.slice(3).trim(); continue; }
  const f = line.split('|').map((x) => x.trim()); if (f.length !== 9) continue;
  const [name, platform, tier, layout, act, what, checks, who, handoff] = f;
  if (!FAMILY[layout]) throw new Error(`unknown layout "${layout}" on "${name}"`);
  let slug = name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40).replace(/_$/, ''), n = 2;
  while (seen.has(slug)) slug = `${slug.replace(/_\d+$/, '')}_${n++}`; seen.add(slug);
  const action = act !== 'NEW' && !/^brew\./.test(act) ? act.split(',')[0].trim() : null; /* Brew's own decision pages are not a deliverable to add */
  const agent = agentOf(section), family = action ? null : FAMILY[layout];
  rows.push({ id: slug, name, platform, tier, layout, section, what, checks, who, handoff, action, ...(action ? {} : { key: `${agent}.p_${slug}`, agent, family, preview: PREVIEW[family] }) });
}
if (rows.length < 200) throw new Error(`only ${rows.length} rows read: the catalogue format changed`);
fs.writeFileSync(path.join(root, 'data/deliverables.json'), JSON.stringify({ v: 1, from: 'docs/deliverables-catalog.txt', rows }, null, 1) + '\n');
console.log(`${rows.length} deliverables (${rows.filter((r) => r.action).length} made by an existing action, ${rows.filter((r) => !r.action).length} planned)`);
