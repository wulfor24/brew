// every move and every card resolves to a canvas (blocks) and a kind of measure for its brief — so whatever the feed
// suggests, the jam can show it and the shared brief says how it will be known
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFamilies } from '../measure-families.js';

const F = createFamilies({});
const LIB = JSON.parse(fs.readFileSync('public/data/canvas-blocks.json', 'utf8'));
const root = ['.brands', '../feed/.brands'].find((d) => fs.existsSync(d));
const cards = [];
for (const slug of root ? fs.readdirSync(root) : []) for (const f of ['seed.json', 'pools.json']) { const p = path.join(root, slug, f); if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, 'utf8')); (f === 'seed.json' ? j.posts || [] : Object.values(j).flat()).filter((c) => c?.title).forEach((c) => cards.push(c)); }
const moves = fs.readdirSync('sources/moves').filter((x) => /^\d\d /.test(x)).map((x) => ({ id: `m${x.slice(0, 2)}-1`, title: x.slice(3).replace(/\.txt$/, ''), sub: '' }));

test('every family has canvas blocks and quick turns', () => {
  for (const f of F.all()) { assert.ok(LIB.families[f.id]?.length, `no canvas for ${f.id}`); assert.ok(LIB.turns[f.id]?.length, `no turns for ${f.id}`);
    for (const b of LIB.families[f.id]) assert.ok(LIB.blocks[b], `${f.id} names unknown block ${b}`); }
});
test('every move and card resolves to blocks and a family', () => {
  const all = [...moves, ...cards]; assert.ok(all.length > 50);
  for (const c of all) { const fam = F.classify(c).family, blocks = LIB.families[fam] || LIB.fallback;
    assert.ok(blocks.length, `${c.title}: no blocks`);
    assert.ok(F.byId(fam)); }
});
