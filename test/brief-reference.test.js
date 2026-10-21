// Send brief for "Make our version": the reference goes with it (where to watch it, the clip, Brew's read), and the card's
// { label, url } source link is a link, never "[object Object]" (Param, 21 Oct)
import test from 'node:test';
import assert from 'node:assert/strict';
import { briefParts } from '../brief-status.js';

test('a remake brief carries the reference link, clip and read; the card link is a real link', () => {
  const x = { card: { link: { label: 'Watch it on TikTok', url: 'https://www.tiktok.com/@a/video/1' }, images: [] },
    pkg: { action: 'Short video', target: 'Instagram', fields: [], checks: [], assets: [
      { kind: 'link', label: 'Reference: watch the viral TikTok video this remakes, by @a', url: 'https://www.tiktok.com/@a/video/1', ref: true },
      { kind: 'video', label: 'Reference clip', url: 'https://brew.example/research/v.mp4', ref: true },
      { kind: 'copy', label: 'How the reference is made', text: 'Their hook: wait for it\nFormat: talking head', ref: true }] } };
  const p = briefParts(x);
  assert.ok(p.assets.some((a) => a.url === 'https://brew.example/research/v.mp4' && /video/.test(a.label)), 'the clip goes');
  assert.ok(p.assets.some((a) => a.url === 'https://www.tiktok.com/@a/video/1'), 'the reference link goes');
  assert.ok(!p.assets.some((a) => String(a.url).includes('[object')), 'no [object Object]');
  assert.deepEqual(p.reference, ['Their hook: wait for it\nFormat: talking head']);
  const q = briefParts({ card: { link: { label: 'Ad Library', url: 'https://facebook.com/ads/library/?id=9' }, images: [] } });
  assert.equal(q.assets[0].url, 'https://facebook.com/ads/library/?id=9'); assert.equal(q.assets[0].label, 'Ad Library');
});
