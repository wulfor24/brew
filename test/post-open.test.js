// Copy and open (public/post-open.js): a ready community post is copied and the exact place opens, filled in where the
// platform allows; Brew never posts for anyone. Every platform the jam drafts posts for.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/post-open.js', import.meta.url), 'utf8');
const g = {}; new Function('globalThis', src.replace(/typeof window !== 'undefined' \? window : globalThis/, 'globalThis'))(g);
const { of, said } = g.PostOpen;
const ch = (action, pkg, extra = {}) => ({ family: 'post', action: `creative.${action}`, target: { conn: null }, pkg, ...extra });
const q = (u) => Object.fromEntries(new URL(u).searchParams);

test('a Reddit reply copies and opens the exact thread', () => {
  const o = of(ch('reddit_post', { platform: 'reddit', format: 'reply', copy: 'We make it. Honest answer: give it 90 days.', where: [{ name: 'r/TeenIndia: Has anyone used it?', url: 'https://www.reddit.com/r/TeenIndia/comments/abc/x/', kind: 'thread', rule: 'Read the community rules before replying.' }] }));
  assert.equal(o.url, 'https://www.reddit.com/r/TeenIndia/comments/abc/x/'); assert.equal(o.filled, false); assert.equal(o.label, 'Copy and open the thread');
  assert.match(o.text, /90 days/); assert.match(said(o), /^Copied\. Paste it/); assert.match(said(o), /community rules/);
});

test('a new Reddit post opens the subreddit with title and text filled in', () => {
  const o = of(ch('reddit_post', { platform: 'reddit', title: 'What 90 days of serum looked like', copy: 'Week by week.', hashtags: [], where: [{ name: 'r/HairCareIndia', url: 'https://www.reddit.com/r/HairCareIndia/', kind: 'community' }] }));
  assert.equal(new URL(o.url).pathname, '/r/HairCareIndia/submit'); assert.equal(q(o.url).title, 'What 90 days of serum looked like'); assert.equal(q(o.url).text, 'Week by week.'); assert.equal(o.filled, true);
  assert.equal(o.label, 'Open r/HairCareIndia to post');
});

test('X opens the post box with the first post; the whole thread is copied', () => {
  const o = of(ch('x_post', { platform: 'x', copy: '1/ First post\n\n2/ Second post', hashtags: ['#hair'] }));
  assert.equal(new URL(o.url).host, 'x.com'); assert.equal(q(o.url).text, 'First post'); assert.match(o.text, /Second post\n\n#hair$/);
});

test('LinkedIn, Pinterest, Quora and a group', () => {
  assert.match(of(ch('linkedin_post', { copy: 'Hello' })).url, /linkedin\.com\/feed\/\?shareActive=true&text=Hello/);
  const pin = of(ch('pinterest_pin', { title: 'Curls', copy: 'Wash day' }), { brandUrl: 'https://arata.in', image: 'https://brew.joinsquareup.com/b/a/x.png' });
  assert.equal(q(pin.url).media, 'https://brew.joinsquareup.com/b/a/x.png'); assert.equal(q(pin.url).url, 'https://arata.in');
  assert.equal(of(ch('pinterest_pin', { copy: 'Wash day' })).url, 'https://www.pinterest.com/pin-builder/', 'no photo: copy and open the pin builder');
  assert.equal(of(ch('quora_answer', { copy: 'A', where: [{ name: 'Q', url: 'https://www.quora.com/Which-serum' }] })).url, 'https://www.quora.com/Which-serum');
  assert.equal(of(ch('quora_answer', { copy: 'A', where: [{ name: 'search', url: '' }] })), null, 'no real page: no button');
  assert.equal(of(ch('fb_group_post', { copy: 'A', where: [{ name: 'Curly India', url: 'https://www.facebook.com/groups/1' }] })).label, 'Copy and open the group');
});

test('not a community post: no button', () => {
  assert.equal(of(ch('x_post', { copy: 'A' }, { family: 'meta_ad' })), null);
  assert.equal(of(ch('x_post', { copy: 'A' }, { target: { conn: 'meta' } })), null);
  assert.equal(of(ch('x_post', { copy: '' })), null);
  assert.equal(of(ch('ig_post', { platform: 'instagram', copy: 'A' })), null);
});

test('the jam shows it on a ready post and runs it in the same tap', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /else if \(po\) \{ head = `Ready\$\{nm\}`/);
  assert.match(app, /if \(act === 'post-open'\) \{ const po = postOpenOf\(ch\);[^\n]*const copied = copyText\(po\.text\); const win = window\.open\(po\.url, '_blank', 'noopener'\);/);
  assert.match(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), /<script src="post-open\.js"><\/script>\n<script src="app\.js">/);
});
