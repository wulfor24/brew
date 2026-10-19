// QA 19 Oct (FEED-ARV-05 / STF-01): V1 hides Storefront everywhere, not only the deck column; ?storefront=1 shows it all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sfReq } from '../feed-service.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), fsvc = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8');

test('the server shows storefront cards only when the page asked for them', () => {
  assert.equal(sfReq({ headers: {} }, new URL('http://x/api/tenants/t/feed')), false);
  assert.equal(sfReq({ headers: {} }, new URL('http://x/api/tenants/t/feed?sf=1')), true);
  assert.equal(sfReq({ headers: { referer: 'http://x/arata-in?storefront=1#v=deck' } }, new URL('http://x/api/tenants/t/feed')), true);
  assert.match(fsvc, /const visible = \(t, c\) => seatOk\(t, c\) && \(c\.sector !== 'storefront' \|\| storefrontOn\(\)\)/, 'feed, deck and stories all rank through visible()');
});

test('the client hides the Storefront ring row, the roster agent and the tag unless ?storefront=1', () => {
  assert.match(app, /if \(!SF_ON\) \{ h\.rings = h\.rings\.filter\(\(r\) => r\.k !== 'Storefront'\)/);
  assert.doesNotMatch(app, /\['creative', 'performance', 'storefront', 'visibility', 'crm'\]\.map/, 'rosters use AGENTS_ON');
  assert.match(app, /\.\.\.\(SF_ON \? \{ storefront: 'Storefront' \} : \{\}\)/);
  assert.match(app, /catalog: 'Catalog'/, 'one name for the catalog column and the card page');
});
