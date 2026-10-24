// The founder storyboard: a film brief timed shot by shot, the founder's script, captions, and the pack files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardOf, isFilm, lengthOf, whoOf } from '../film-board.js';
import { buildPack } from '../publish-pack.js';

const film = (pkg) => ({ family: 'brief', action: 'creative.film_brief', pkg });
const PKG = { title: 'Why I made it: a 30-second film', deliverables: ['One 30s film, 9:16', 'Two 15s cuts, 9:16 and 4:5'],
  scenes: [{ shot: 'Founder to camera in the kitchen', line: '“I made this because my own hair broke every winter.”' }, { shot: 'Hands apply the serum', line: 'Two drops, every night.' },
    { shot: 'Founder to camera, close', line: '“Three months later, this is my hair.”' }, { shot: 'Pack shot with price', line: 'Arata Serum, ₹599.' }], talent: 'To confirm', location: 'Home kitchen', deadline: 'This week' };

test('only a film brief gets a storyboard', () => {
  assert.equal(isFilm(film(PKG)), true);
  assert.equal(isFilm({ family: 'brief', action: 'creative.creative_brief', pkg: PKG }), false);
  assert.equal(boardOf({ family: 'post', action: 'creative.short_video', pkg: PKG }), null);
  assert.equal(boardOf(film({ ...PKG, scenes: [] })), null, 'no shots, no board');
});

test('the shots are timed to the asked length and say who is on camera', () => {
  const b = boardOf(film(PKG));
  assert.equal(b.total, 30); assert.equal(b.format, '9:16'); assert.equal(b.founder, true); assert.equal(b.talent, 'The founder');
  assert.equal(b.shots[0].from, 0); assert.equal(b.shots.at(-1).to, 30, 'the shots add up to the film');
  for (let i = 1; i < b.shots.length; i++) assert.equal(b.shots[i].from, b.shots[i - 1].to);
  assert.deepEqual(b.shots.map((s) => s.who), ['person', 'hands', 'person', 'product']);
  assert.match(b.script, /my own hair broke/); assert.doesNotMatch(b.script, /Two drops/, 'the script is what is said to camera');
  assert.doesNotMatch(b.script, /[“”]/);
  assert.match(b.srt, /^1\n00:00:00,000 --> /); assert.equal(b.srt.match(/-->/g).length, 4);
  assert.equal(lengthOf(film({ ...PKG, title: 'A 15 second founder film' })), 15);
  assert.equal(boardOf(film({ ...PKG, talent: 'Riya, co-founder' })).talent, 'Riya, co-founder');
});

test('a film with nobody on camera reads as a voiceover', () => {
  const b = boardOf(film({ ...PKG, title: 'Product film', scenes: [{ shot: 'Close-up of the bottle', line: 'Made for dry winters.' }, { shot: 'Pack shot', line: 'Arata Serum.' }] }));
  assert.equal(b.vo, true); assert.equal(b.founder, false); assert.match(b.script, /dry winters[\s\S]*Arata Serum/);
  assert.equal(whoOf('A slow pan across the bathroom shelf'), 'scene');
});

test('the pack carries the storyboard, the script and captions', async () => {
  const made = await buildPack({ ch: film(PKG), family: 'brief', pkg: PKG, brand: { name: 'Arata' } });
  const names = made.entries.map((e) => e.name);
  for (const n of ['shot-list.md', 'storyboard.md', 'script.txt', 'captions.srt']) assert.ok(names.includes(n), n);
  assert.match(made.entries.find((e) => e.name === 'storyboard.md').data.toString(), /0–\d+(\.5)? s · Founder to camera/);
  const other = await buildPack({ ch: { family: 'brief', action: 'creative.creative_brief' }, family: 'brief', pkg: PKG, brand: { name: 'Arata' } });
  assert.ok(!other.entries.some((e) => e.name === 'storyboard.md'), 'a creatives brief has no storyboard');
});

test('a video jam can open the same card as a film brief', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(src, /b\.as === 'film' && !r0\.conflict/, 'the remix route opens a film brief on as: film');
  assert.match(src, /filmOk:/, 'a video jam says it can be filmed instead');
  const app = (await import('node:fs')).readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-film-alt/); assert.match(app, /as: 'film', fast: true/);
});

test('a film brief with no AI draft starts founder-first, with short lines', async () => {
  const { runIn } = await import('../brand-ctx.js'); const { mockPkg } = await import('../studio.js'); const { catalogOf } = await import('../product-match.js');
  const long = 'Powered by 3% Redensyl to stimulate dormant follicle stem cells, 3% Procapil to help limit DHT impact at the root, and 5% Kopexil to support stronger anchoring and longer hair';
  const profile = { catalog: { products: [{ title: 'Hair Growth Serum', priceLabel: '₹943', url: 'https://hair.test/products/serum', img: 'https://cdn.hair.test/1.jpg', claims: [long] }] } };
  const BR = { slug: 'hair.test', name: 'Hair Co', host: 'hair.test', sym: '₹', catalog: catalogOf(profile), config: { laneProducts: { serum: { name: 'Hair Growth Serum', short: 'the serum', price: '₹943', claim: long, hook: 'Hair that stays', page: 'https://hair.test/', photo: 'The serum' } } }, seed: { brand: { name: 'Hair Co', host: 'hair.test' } } };
  const pkg = runIn(BR, () => mockPkg('brief', 'creative.film_brief', { title: 'Put a review in our ads', lane: 'serum' }, 0, '', {}));
  const b = boardOf(film(pkg));
  assert.equal(b.shots[0].who, 'person'); assert.equal(b.talent, 'The founder');
  for (const s of b.shots) assert.ok(s.line.length <= 80, `short line: ${s.line}`);
});

test('every shot in one row is read back as one row per shot', () => {
  const row = { shot: "Shot 1: Founder to camera holding the roller. Line: 'If your serum isn't enough, the missing step is the scalp.' | Shot 2: Close-up of the roller. Line: 'It opens tiny channels.' | Shot 3: Pack shot of the combo. Line: 'Get the combo.'", line: '' };
  const b = boardOf(film({ ...PKG, scenes: [row] }));
  assert.equal(b.shots.length, 3); assert.deepEqual(b.shots.map((s) => s.who), ['person', 'product', 'product']);
  assert.equal(b.shots[0].shot, 'Founder to camera holding the roller'); assert.match(b.shots[0].line, /^“If your serum isn't enough/);
  assert.equal(b.shots[2].line, 'Get the combo.');
});
