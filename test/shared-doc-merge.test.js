// QV 25 Oct: two instances change the same jam at once (two people reply in its thread within the same second): both replies stay,
// on both instances, after each one pulls the other's write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocSync, mergeItem } from '../shared-doc.js';

/* one stored document in parts, shared by both "instances" */
function store() {
  let parts = new Map();
  return { async patchParts(slug, name, set, del, { order }) { for (const [p, b] of set) parts.set(p, b); for (const p of del) parts.delete(p); const o = new Map(order.map((p, i) => [p, i])); parts = new Map([...parts].sort((a, b) => (o.get(a[0]) ?? 1e9) - (o.get(b[0]) ?? 1e9))); return 1; },
    async getParts() { return [...parts].map(([part, b], ord) => ({ part, ord, body: Buffer.from(b) })); } };
}

test('a jam both instances changed keeps both new thread messages', async () => {
  const packs = store(), jam = () => ({ id: 'j1', title: 'Serum reel', thread: [{ id: 'm1', at: 1, text: 'first' }] });
  const A = { jams: [jam()] }, B = { jams: [jam()] };
  const a = createDocSync({ packs, slug: 'arata-in', name: 'private/jams.json', fields: ['jams'] }), b = createDocSync({ packs, slug: 'arata-in', name: 'private/jams.json', fields: ['jams'] });
  await a.push(A); a.settle(A); b.settle(B);
  A.jams[0].thread.push({ id: 'm2', at: 2, text: 'from Ana' });   /* instance 1 */
  B.jams[0].thread.push({ id: 'm3', at: 3, text: 'from Ravi' });  /* instance 2, before it heard of m2 */
  await a.push(A);            /* instance 1 writes first */
  await b.pull(B); await b.push(B); /* instance 2 hears it, merges, writes */
  await a.pull(A);
  for (const s of [A, B]) assert.deepEqual(s.jams[0].thread.map((m) => m.id), ['m1', 'm2', 'm3']);
});

test('mergeItem: lists with ids take the other side\'s new items in time order; plain fields stay this side\'s', () => {
  const m = mergeItem({ title: 'mine', thread: [{ id: 1, at: 1 }, { id: 3, at: 3 }], tags: ['a'] }, { title: 'theirs', thread: [{ id: 1, at: 1 }, { id: 2, at: 2 }], tags: ['b'], extra: 5 });
  assert.equal(m.title, 'mine'); assert.deepEqual(m.thread.map((x) => x.id), [1, 2, 3]); assert.deepEqual(m.tags, ['a']); assert.equal(m.extra, 5);
});
