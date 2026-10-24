// 3.4: the free first look runs no picture or video model and charges nothing
import test from 'node:test'; import assert from 'node:assert/strict';
import { createStudio } from '../jam2/studio.js';

test('first look: words over the real photo, shot list for video, no paid engine', async () => {
  const ran = []; const engines = { run: async (cap) => { ran.push(cap); return {}; }, quote: async () => ({ usd: 1 }) };
  const maker = { write: async () => ({ headline: 'Dermat-approved hair care', sub: 'Thicker in 30 days', shots: [{ sec: 3, see: 'bottle on a sink', vo: 'Meet it' }] }),
    composeScene: (o) => ({ w: o.size.w, h: o.size.h, layers: o.cut ? [{ kind: 'product', src: o.cut.file }] : [] }), render: async () => 'gen/look.jpg' };
  const st = createStudio({ engines, maker });
  const ctx = { bbv: { kit: {} }, source: '' };
  const pic = await st.sketch(ctx, { kind: 'image', product: { name: 'Serum', img: 'p.png' } });
  assert.equal(pic.file, 'gen/look.jpg'); assert.equal(pic.usd, 0); assert.deepEqual(pic.shots, []);
  assert.ok(pic.flags.length, 'an unbacked claim is named'); 
  const vid = await st.sketch({ bbv: { kit: {} } }, { kind: 'video' });
  assert.equal(vid.shots.length, 1); assert.equal(ran.length, 0, 'no engine ran');
});
