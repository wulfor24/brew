// QV round 2 of the feed pages (26 Oct night): each fix kept from coming back, for any brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isCdn, cdnExpiry, cdnDead, keepName, createCdnKeep, keepRes } from '../cdn-keep.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const hex = (iso) => Math.floor(Date.parse(iso) / 1000).toString(16).toUpperCase();
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);

/* ---------- 1. CDN pictures ---------- */
test('CDN links: fbcdn, cdninstagram and scontent are known, their expiry read; other hosts are left alone', () => {
  const fb = `https://scontent-bom1-1.xx.fbcdn.net/v/t39.30808-1/1_n.jpg?stp=x&oe=${hex('2026-10-29T07:53:00Z')}&_nc_sid=1`;
  const ig = `https://scontent-ord5-1.cdninstagram.com/v/t51.2885-15/2_n.jpg?oe=${hex('2026-10-29T10:00:00Z')}`;
  assert.ok(isCdn(fb) && isCdn(ig) && isCdn('https://scontent.fdel1-1.fna.fbcdn.net/a.png'));
  assert.ok(!isCdn('https://www.facebook.com/ads/library/?id=1') && !isCdn('https://cdn.shopify.com/x.jpg?oe=6AE30BEC') && !isCdn('research/abc.jpg'));
  assert.equal(cdnExpiry(fb), Date.parse('2026-10-29T07:53:00Z')); assert.equal(cdnExpiry(ig), Date.parse('2026-10-29T10:00:00Z'));
  assert.ok(cdnDead(fb, Date.parse('2026-10-30'))); assert.ok(!cdnDead(fb, Date.parse('2026-10-26')));
  assert.equal(keepName(fb), keepName(fb.replace('scontent-bom1-1.xx', 'scontent-del2-1.xx').replace(/oe=\w+/, 'oe=AAAAAAAA')), 'one name per picture, whatever host or signature');
  assert.match(keepName(fb), /^[a-f0-9]{20}\.jpg$/); assert.match(keepName('https://x.fbcdn.net/a/b.png?oe=1'), /\.png$/);
});

test('CDN links: a live one is copied in the background and then served from our storage; an expired one is dropped', async () => {
  let clock = Date.parse('2026-10-26T18:00:00Z'); const saved = new Map(), fetched = [];
  const K = createCdnKeep({ now: () => clock, has: async (n) => saved.has(n), save: async (n, b) => saved.set(n, b), fetchBuf: async (u) => { fetched.push(u); if (/gone/.test(u)) throw new Error('fetch 403'); if (/html/.test(u)) return Buffer.from('<html>error page</html>'.repeat(5)); return JPG; }, log: {} });
  const live = `https://scontent-bom1-1.xx.fbcdn.net/v/logo.jpg?oe=${hex('2026-10-29T07:53:00Z')}`, old = `https://scontent.cdninstagram.com/v/old.jpg?oe=${hex('2026-10-20T00:00:00Z')}`;
  const body = { rivals: [{ name: 'Rival', avatar: live }, { name: 'Gone', avatar: old }], tagged: [{ image: old, text: 'hi' }], images: [live, old, 'research/x.jpg'], note: `see ${old} here` };
  const first = K.deep(body);
  assert.equal(first.rivals[0].avatar, live, 'not copied yet: served while it still loads');
  assert.equal(first.rivals[1].avatar, null, 'expired: no picture, the page shows the name');
  assert.equal(first.tagged[0].image, null); assert.deepEqual(first.images, [live, 'research/x.jpg'], 'a dead picture leaves a list');
  assert.equal(first.note, 'see  here');
  await K.idle();
  assert.equal(saved.size, 1, 'the live link was copied, the expired one never fetched'); assert.ok(!fetched.includes(old));
  const again = K.deep(body); assert.equal(again.rivals[0].avatar, `research/${keepName(live)}`);
  clock = Date.parse('2026-11-02'); assert.equal(K.deep(body).rivals[0].avatar, `research/${keepName(live)}`, 'our copy outlives the link');
  const s = K.body(JSON.stringify(body)); assert.ok(!/fbcdn|cdninstagram/.test(s), s);
  /* refused or not a picture: dropped, never saved */
  const gone = `https://x.fbcdn.net/gone.jpg?oe=${hex('2026-12-01T00:00:00Z')}`, html = `https://x.fbcdn.net/html.jpg?oe=${hex('2026-12-01T00:00:00Z')}`;
  clock = Date.parse('2026-10-26T18:00:00Z'); K.keep(gone); K.keep(html); await K.idle();
  assert.equal(K.keep(gone), null, 'a 403 is a dead link'); assert.equal(saved.has(keepName(html)), false, 'an error page is never kept');
});

test('CDN links: a copy another instance made is found in storage, not fetched again; boot scan queues saved reads', async () => {
  const live = `https://scontent.xx.fbcdn.net/v/a.jpg?oe=${hex('2026-12-01T00:00:00Z')}`, dead = `https://scontent.xx.fbcdn.net/v/b.jpg?oe=${hex('2026-10-01T00:00:00Z')}`;
  let fetches = 0; const K = createCdnKeep({ now: () => Date.parse('2026-10-26'), has: async (n) => n === keepName(live) || n === keepName(dead), fetchBuf: async () => { fetches++; return JPG; }, log: {} });
  assert.equal(K.scan({ ads: { brands: [{ avatar: live }, { avatar: dead }] } }), 1, 'expired links are not queued on boot'); await K.idle();
  assert.equal(fetches, 0); assert.equal(K.keep(live), `research/${keepName(live)}`);
  K.keep(dead); await K.idle(); assert.equal(K.keep(dead), `research/${keepName(dead)}`, 'an expired link we copied before is still served from storage');
});

test('CDN links: every server answer goes through keepRes, and the research tick copies logos for moved brands too', () => {
  const K = createCdnKeep({ now: () => Date.parse('2026-10-26'), log: {} }); const out = [];
  const res = { end(b) { out.push(b); }, write(b) { out.push(b); } }; keepRes(res, K);
  const dead = `https://scontent.xx.fbcdn.net/v/b.jpg?oe=${hex('2026-10-01T00:00:00Z')}`;
  res.end(JSON.stringify({ a: dead, b: 'ok' })); res.write(`data: ${JSON.stringify({ img: dead })}\n\n`);
  assert.deepEqual(JSON.parse(out[0]), { a: null, b: 'ok' }); assert.equal(out[1], 'data: {"img":null}\n\n');
  const srv = read('server.js'); assert.match(srv, /zipRes\(req, res\);\n\s*keepRes\(res, CDN\);/); assert.match(srv, /CDN\.scan\(x\.research\.get\(\)\)/);
  assert.match(read('research.js'), /if \(!isLeader\(\)\) return; healLogos\(\)\.catch\(\(\) => \{\}\); if \(movedAway\(brand\.slug\)\) return;/);
});
