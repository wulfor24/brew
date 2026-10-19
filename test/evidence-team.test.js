// What the team told Brew, on the proof sheet (evidence.js teamOf) and the label rule (feed-service toldCard)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEvidence, teamOf } from '../evidence.js';
import { refine } from '../proof-logic.js';

const L = [
  { text: 'They plan to offer a direct-to-consumer 90-day pack exclusively on arata.in.', quote: 'a 90-day pack only on arata.in', source: 'Upload (plan.pdf), added by Sam, 2026-10-19', at: 1, kind: 'goal', hash: 'h1' },
  { text: 'Branded content ads suffered fatigue as identical creator assets were heavily scaled.', quote: 'same assets absorbed more budget', source: 'Upload (audit.pdf), added by Sam, 2026-10-19', at: 1, kind: 'tried', hash: 'h1' },
  { text: 'They prohibit fake transformations, AI testimonials or doctor endorsements.', quote: 'No fake transformations', source: 'Upload (plan.pdf), added by Sam, 2026-10-19', at: 1, kind: 'belief', hash: 'h1' }];
const T = { items: L, up: { 'm5-1': { why: 'The team wants a direct 90-day pack on the site.', hash: 'h1' } }, hide: { 'm6-1': { why: 'It repeats what the team said did not work: branded content fatigue.', hash: 'h1' } }, add: [] };
const M = { 7: { title: 'Creators', meta: { because: 'What the team told us (Upload): no doctor endorsements', changes: ['Learned: They prohibit fake transformations, AI testimonials or doctor endorsements.'] } } };

test('a card the learnings made, lifted, stepped back or rewrote shows the team’s own words and source', () => {
  const told = teamOf({ id: 'told-ab-1', origin: 'told', rows: [['The team said', 'They plan to offer a direct-to-consumer 90-day pack exclusively on arata.in.']] }, T);
  assert.equal(told.items[0].label, 'Your plan'); assert.match(told.items[0].source, /plan\.pdf/);
  assert.match(teamOf({ id: 'm5-1-p', title: 'Sell the 90-day pack on the site', sub: '' }, T).items[0].text, /90-day pack/, 'a private twin matches its public card');
  const hid = teamOf({ id: 'm6-1', title: 'New ad hook', sub: '' }, T); assert.match(hid.contra, /did not work/); assert.equal(hid.items[0].label, 'Your team said this doesn’t work');
  assert.match(teamOf({ id: 'm7-1', title: 'Brief creators', sub: '' }, T, [7], M).items[0].text, /doctor endorsements/);
  assert.equal(teamOf({ id: 'r1', title: 'Rival: branded content ads fatigue creator assets scaled', research: { kind: 'ad' } }, T).items.length, 0, 'shared words alone never count');
});

test('the sheet lists the team first and counts it as sourced; outside the team it is never shown', () => {
  const E = createEvidence({ factsOf: () => ({}), movesOf: () => M, numsOf: () => [], learnedOf: () => T });
  const c = { id: 'told-ab-1', origin: 'told', title: 'Launch the 90-day pack', sub: 'Only on arata.in', rows: [['The team said', 'They plan to offer a direct-to-consumer 90-day pack exclusively on arata.in.']] };
  const e = E.evidenceOf(c); assert.equal(e.items[0].kind, 'team'); assert.equal(e.told, true); assert.ok(e.sourced >= 1);
  assert.equal(E.evidenceOf(c, { team: false }).items.some((x) => x.kind === 'team'), false);
  assert.ok(refine(c, e, {}).items.some((x) => x.kind === 'team'), 'the proof filter keeps it');
});

test('the label only shows on cards that rest on the learnings, never a rival ad or a listening find, never by shared words', () => {
  const s = fs.readFileSync(new URL('../feed-service.js', import.meta.url), 'utf8'), rule = s.slice(s.indexOf('const toldCard'), s.indexOf('\n', s.indexOf('const toldCard')));
  assert.match(rule, /research\?\.kind === 'ad'/); assert.doesNotMatch(rule, /toldOf\(c\)/);
  assert.equal((s.match(/team: toldSeen\(t\)/g) || []).length, 3, 'every proof call keeps the team’s words to the team');
});

test('a page sharing only the words on most of a brand’s cards is not proof of one card', () => {
  const corpus = Array.from({ length: 20 }, (_, i) => ({ title: `MitoActive serum idea ${i}`, sub: 'hair growth' }));
  const c = { title: 'Build a press page for MitoActive serum', sub: 'Journalists need assets' };
  const e = { items: [{ kind: 'source', label: 'Most-watched YouTube videos: MitoActive serum hair growth', value: '', url: 'https://youtube.com/x' }], why: { because: 'Our audit shows no press page.' } };
  assert.equal(refine(c, e, { corpus }).items.length, 0); assert.equal(refine(c, e, {}).items.length, 1, 'without the brand’s cards it stays as before');
});
