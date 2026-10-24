import test from 'node:test';
import assert from 'node:assert/strict';
import { ownAccount } from '../reader/stages/socials.js';

const scrub = { name: 'Scrubroom', brandName: 'Scrubroom', host: 'scrubroom.in' };

test('a searched account is the brand’s only when its handle or name is the brand’s; posts and lookalikes are skipped', () => {
  assert.equal(ownAccount([{ url: 'https://www.instagram.com/p/abc/', title: 'Scrubroom' }, { url: 'https://www.instagram.com/scrubroom.in/', title: 'Scrub Room (@scrubroom.in) • Instagram photos and videos' }], 'instagram', scrub), 'https://www.instagram.com/scrubroom.in');
  assert.equal(ownAccount([{ url: 'https://www.instagram.com/scrubsindia/', title: 'Scrubs India' }], 'instagram', scrub), null);
  assert.equal(ownAccount([{ url: 'https://www.youtube.com/channel/UCmrdobwH0i4Gh7yINyZ_zMQ', title: 'Scissors N Scrubs' }, { url: 'https://www.youtube.com/hashtag/scrubhaul', title: 'scrubhaul' }], 'youtube', scrub), null);
  assert.equal(ownAccount([{ url: 'https://www.youtube.com/channel/UC123', title: 'Scrub Room - YouTube' }], 'youtube', scrub), 'https://www.youtube.com/channel/UC123');
  assert.equal(ownAccount([{ url: 'https://www.instagram.com/arata_official/', title: 'ARATA' }], 'instagram', { name: 'Arata', host: 'arata.in' }), 'https://www.instagram.com/arata_official');
  assert.equal(ownAccount([{ url: 'https://www.youtube.com/channel/UCegupLbI0uF_ykORbe2f8JQ', title: 'CozyUnfiltered' }], 'youtube', { name: 'Cozy Snugglet', host: 'cozysnugglet.shop' }), null);
});
