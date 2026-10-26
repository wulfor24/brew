// Final QV round 3 (25 Oct): what a jam guest, an outsider and a Slack channel may do on a brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guestAllows } from '../feed-service.js';

const src = (f) => fs.readFileSync(f, 'utf8');
const ctx = { wids: ['w1'], changes: { c1: { workId: 'w1' } }, cards: new Set() };

test('a jam guest works on words and drafts, never a paid make on the brand\'s budget', () => {
  for (const p of ['edit', 'iterate', 'pick', 'notes', 'final/status', 'photos', 'remake']) assert.equal(guestAllows(`/api/changes/c1/${p}`, ctx), true, p); /* remake: Param, 25 Oct */
  for (const p of ['final/quote', 'final/run', 'final/checkpoint', 'video', 'listing-photos', 'image', 'variants', 'cta-make', 'discard', 'restore']) assert.equal(guestAllows(`/api/changes/c1/${p}`, ctx), false, p);
  assert.equal(guestAllows('/api/changes/c9/edit', ctx), false, 'another jam\'s change');
});

test('References and the rival read are the team\'s (and its jam guests\' for References)', () => {
  const s = src('feed-service.js');
  assert.match(s, /'\/api\/brands\/:slug\/references', async \(b, t, p\) => \{[^\n]*\n\s*if \(!\(r\?\.member \|\| r\?\.guest \|\| process\.env\.DEMO_MODE === '1'\)\) return \{ status: r\?\.email \? 403 : 401/);
  assert.match(s, /\(deck\|pulse\|engine\|remixes\|learning\|ask\|tuning\|rivals\)\$/);
});

test('in Slack, approving and saying yes to a make need the brand\'s team; anyone else is told to open the jam', () => {
  assert.match(src('feed-service.js'), /if \(\['approve', 'apply'\]\.includes\(kind\) && !\(user\.email && o\.isMemberEmail && await o\.isMemberEmail\(br\.slug, user\.email\)/);
  const r = src('slack-routes.js');
  assert.match(r, /if \(r\?\.notMember\) return tell\('Only the brand’s team can approve this\. Open the jam/);
  assert.match(r, /if \(r\?\.notMember\) return tell\('Only the brand’s team says yes to a make/);
});
