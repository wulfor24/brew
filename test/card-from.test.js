// Where a card came from (card-from.js): what it rests on, never the team it was routed to. A Reddit question routed to the
// AI answers team read "From AI answers"; a pack-price fix routed to signals read "From your customers" (Param, 20 Oct).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cardFrom, moveFrom, FROM_SKILL } from '../card-from.js';

const MOVES = { 11: { skill: 'seo-audit', group: 'found', kicker: 'SEO · MOVE 11' }, 15: { skill: 'ai-seo', group: 'found', kicker: 'AI ANSWERS · MOVE 15' },
  1: { skill: 'product-marketing', group: 'know' }, 2: { skill: 'customer-research', group: 'know' }, 1001: { skill: 'emails', group: 'auto' },
  1007: { skill: 'social', group: 'listen' }, 60: { skill: 'ads', group: 'reach', kicker: 'WEATHER TRIGGERS · MOVE 60' }, 61: { skill: 'social', group: 'learn' } };

test('a listening question says where it was asked, not AI answers', () => {
  const q = { id: 'heard-q-1', agent: 'visibility', sector: 'visibility', origin: 'listen', stream: 'heard', heard: { kind: 'thread' }, post: { platform: 'reddit' } };
  assert.equal(cardFrom(q), 'Asked on Reddit');
  assert.equal(cardFrom({ ...q, post: { platform: 'youtube' } }), 'Asked on YouTube');
  assert.equal(cardFrom({ ...q, heard: { kind: 'theme' } }), 'Heard online');
});

test('a move card says its move discipline, whatever team it was routed to', () => {
  assert.equal(cardFrom({ id: 'm11-2', sector: 'visibility' }, MOVES), 'From Google search');
  assert.equal(cardFrom({ id: 'm15-1', sector: 'visibility' }, MOVES), 'From AI answers');
  assert.equal(cardFrom({ id: 'm01-1', sector: 'signals' }, MOVES), 'Your positioning');
  assert.equal(cardFrom({ id: 'm02-1', sector: 'creatives' }, MOVES), 'From your customers');
  assert.equal(cardFrom({ id: 'm1001-1-p', sector: 'signals' }, MOVES), 'Saves you time', 'a private rewrite reads its move too');
  assert.equal(cardFrom({ id: 'm1007-1' }, MOVES), 'Heard online');
  assert.equal(cardFrom({ id: 'm60-1' }, MOVES), 'From the weather');
  assert.equal(cardFrom({ id: 'm61-1' }, MOVES), 'From your team');
  assert.equal(cardFrom({ id: 'm99-1' }, MOVES), null, 'no move doc: the page falls back');
});

test('the team, ideas and Brew news say so', () => {
  assert.equal(cardFrom({ id: 'told-1', origin: 'told', sector: 'ads' }), 'From your team');
  assert.equal(cardFrom({ id: 'idea-1', origin: 'ideas', sector: 'visibility' }), 'New idea for you');
  assert.equal(cardFrom({ id: 'b-1', origin: 'build', sector: 'signals', type: 'report' }), 'From us');
  assert.equal(cardFrom({ id: 'b-2', origin: 'build', campaign: 'From your ad plan' }), null);
});

test('every move skill has a plain line', () => {
  const skills = new Set([...fs.readFileSync(new URL('../moves-engine.js', import.meta.url), 'utf8').matchAll(/skill: '([a-z-]+)'/g), ...fs.readFileSync(new URL('../moves-cadence.js', import.meta.url), 'utf8').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  for (const s of ['ai-seo', 'seo-audit', 'cro', 'emails', 'customer-research', 'seasonal-planning', 'community-research', 'sales-enablement']) assert.ok(FROM_SKILL[s], s);
  assert.ok(skills.size);
  assert.equal(moveFrom(null), null);
});

test('the page reads card.from, and the AI line only rides on AI answers cards', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(src, /if \(c\.from\) return c\.from;/);
  assert.match(src, /const aisLine = \(p\) => \{ if \(fromLabel\(p\) !== 'From AI answers'\) return '';/);
  assert.doesNotMatch(src, /c\.type === 'idea' \|\| c\.agent === 'creative'/, 'a decision is not an idea');
  assert.match(fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8'), /cardFrom\(c0, /);
});

test('served cards say their source even though the workspace stores them with origin "seed"', () => {
  assert.equal(cardFrom({ id: 'idea-412e9b86ba', origin: 'seed', stream: 'ideas', sector: 'visibility' }), 'New idea for you');
  assert.equal(cardFrom({ id: 'build-moves', origin: 'seed', family: 'result' }), 'From us');
  assert.equal(cardFrom({ id: 'ow-own-long-2026-10-19', origin: 'seed' }), 'From your ads');
  assert.equal(cardFrom({ id: 'lv-vis-score-2026-10-18' }), 'From AI answers');
  assert.equal(cardFrom({ id: 'lv-cat-oos-1' }), 'From your store');
  assert.equal(cardFrom({ id: 'r-tr-38b068178a', research: { kind: 'trend' } }), 'Trending in your category');
  assert.equal(cardFrom({ id: 'read-4', sector: 'creatives', type: 'report', title: 'Fix missing tracking to win back lost shoppers' }), 'From your ads');
  assert.equal(cardFrom({ id: 'read-1', sector: 'visibility', title: 'Claim tea time search rankings' }), 'From Google search');
  assert.equal(cardFrom({ id: 'read-2', sector: 'ads', type: 'competitor', title: 'Maintain lead over competitors on Meta' }), 'From your competitors');
  assert.equal(cardFrom({ id: 'statics-batch', origin: 'build', campaign: 'From your ad plan' }), null);
});

test('the page puts the card\'s own source before the generic family label', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = src.indexOf('if (c.from) return c.from;'), j = src.indexOf('if (FROM_FAMILY[c.family]) return FROM_FAMILY[c.family];');
  assert.ok(i > 0 && j > i);
});

test('viral and rival-ad research cards say where they came from', () => {
  assert.equal(cardFrom({ id: 'r-viral-tt-1', research: { kind: 'viral', id: 'tt:1', platform: 'tiktok' } }), 'Viral on TikTok');
  assert.equal(cardFrom({ id: 'r-viral-ig-1', research: { kind: 'viral', id: 'ig:1' }, src: 'Instagram · 30× usual views' }), 'Viral on Instagram');
  assert.equal(cardFrom({ id: 'r-ad-9', research: { kind: 'ad', id: '9' } }), 'From your competitors');
});
