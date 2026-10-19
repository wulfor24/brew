// QA sheet fixes (FEED-QA, TRU, ONB, ACC, MOB, FEED-NOT): every rule here holds for every brand, card and view. No network,
// no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const { pageOf, privacyPage, termsPage, notFoundPage } = await import('../legal-pages.js');

/* ---------- FEED-QA-01: a real 404 ---------- */
test('FEED-QA-01: unknown pages and unknown /api paths are real 404s; the landing, brand pages and legal pages still open', () => {
  assert.deepEqual(pageOf('/'), { kind: 'landing' });
  assert.deepEqual(pageOf('/index.html'), { kind: 'landing' });
  assert.deepEqual(pageOf('/arata-in'), { kind: 'slug', slug: 'arata-in' });
  assert.deepEqual(pageOf('/arata-in/'), { kind: 'slug', slug: 'arata-in' });
  assert.deepEqual(pageOf('/Arata-In'), { kind: 'slug', slug: 'arata-in', redirect: true });
  assert.deepEqual(pageOf('/api/nope'), { kind: 'api' });
  assert.deepEqual(pageOf('/api'), { kind: 'api' });
  assert.deepEqual(pageOf('/no-such-page-xyz/deeper'), { kind: 'missing' });
  assert.deepEqual(pageOf('/privacy'), { kind: 'legal', page: '/privacy' });
  assert.deepEqual(pageOf('/terms/'), { kind: 'legal', page: '/terms' });
  const s = src('server.js');
  assert.doesNotMatch(s, /\|\| \(await pageFor\(''\)\)/, 'an unknown slug never falls back to the landing');
  assert.match(s, /send\(res, 404, notFoundPage\(\)/);
  assert.match(s, /pg\.kind === 'api'\) return send\(res, 404/);
  const nf = notFoundPage(); assert.match(nf, /couldn’t find that page/); assert.match(nf, /href="\/"/);
});

/* ---------- FEED-QA-23 / TRU-01: privacy and terms ---------- */
test('FEED-QA-23: privacy and terms are plain preview pages, linked from the landing and the demo landing', () => {
  const p = privacyPage(), t = termsPage();
  for (const h of [p, t]) { assert.match(h, /Preview (policy|terms)/); assert.match(h, /hello@joinsquareup\.com/); assert.match(h, /href="\/privacy"/); assert.match(h, /href="\/terms"/); }
  assert.match(p, /read-only/); assert.match(p, /Google/); assert.match(p, /Google Cloud/); assert.match(p, /Delet/);
  assert.match(p, /reviews/); assert.match(p, /rivals/); assert.match(p, /AI assistants/);
  assert.match(src('public/app.js'), /class="ob2-legal">Preview · <a href="\/privacy">Privacy<\/a> · <a href="\/terms">Terms<\/a>/);
  assert.match(src('public/demo-picker.html'), /href="\/privacy">Privacy<\/a>/);
});
