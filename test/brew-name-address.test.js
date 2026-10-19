import test from 'node:test';
import assert from 'node:assert/strict';
import { brewText, brewFile } from '../brew-name.js';

// the ShopOS → Brew rename is for copy; an email, link or domain is a name and stays as written (invites to @shopos.ai)
test('the rename leaves emails, links and domains alone', () => {
  for (const s of ['sai@shopos.ai', 'shopos@gmail.com', 'https://shopos.ai/pricing', 'www.shopos.ai', 'shopos.ai']) assert.equal(brewText(s), s);
  const m = JSON.parse(brewFile('private/members.json', Buffer.from(JSON.stringify({ invites: [{ email: 'marketing@shopos.ai' }], note: 'ShopOS team' }))).toString());
  assert.equal(m.invites[0].email, 'marketing@shopos.ai');
  assert.equal(m.note, 'Brew team');
});

test('old copy still reads as Brew', () => {
  assert.equal(brewText('ShopOS team'), 'Brew team');
  assert.equal(brewText('SHOPOS.AI × Arata'), 'BREW × Arata');
  assert.equal(brewText('the shopos agent, done.'), 'the brew agent, done.');
});
