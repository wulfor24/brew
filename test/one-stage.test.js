// One stage for every deliverable (25 Oct): the header names the piece and where it goes and what card it is for; the stage holds
// only the piece; the bar under it is the one next step, the same three steps on every jam; the Studio set-up lives in the
// panel; a card with a jam opens on that jam, never the old list of packages
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const cs = fs.readFileSync(new URL('../public/creative-stage.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/parts.css', import.meta.url), 'utf8');
const fn = (name, src = app) => { const i = src.indexOf(`const ${name} = `); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n  const ', i + 10)); };

test('the header: the piece and where it goes, then the card it is for; an organic post is never on Meta Ads', () => {
  const w = fn('stWhere');
  assert.match(w, /ch\.family === 'social' \? 'Instagram'/);
  assert.match(w, /!\/\\bon \[A-Z\]\/\.test\(lab\)/, 'a label that names its place is not told twice');
  assert.match(app, /class="st-for" data-tab="iterate"[^\n]*For: \$\{esc\(cutW\(cardOf\(RX\.p\)\.title, 90\)\)\}/);
  assert.ok(!/\$\{esc\(ch\.familyName\)\} · \$\{studioFrom\(ch\)\}/.test(app), 'the widget family is not in the header');
});

test('the stage holds only the piece: the Studio set-up is the panel’s Set-up tab, and Make it is on the bar', () => {
  const st = fn('studioStage');
  assert.ok(!/cs\.html\(ch\)/.test(st), 'no composer on the stage');
  assert.match(st, /shipBar\(ch, viewing\)/, 'the bar shows before anything is made');
  assert.match(st, /st\.frames/, 'the preview has as many frames as the set-up makes');
  assert.match(app, /\['adjust', ch\.studio \? 'Set-up' : 'Adjust'\], \['details', 'Details'\]/);
  assert.match(app, /ch\.studio && !studioMade\(ch\) && edit \? 'adjust' : 'iterate'/, 'a Studio piece not made yet opens on its set-up');
  assert.match(app, /data-cs-make/); assert.match(cs, /make: \(\) => go\(false\)/);
  assert.ok(!/data-cs-go/.test(cs.slice(cs.indexOf('function full()'), cs.indexOf('function full()') + 9000)), 'no second Generate in the set-up');
  assert.match(cs, /frames: Array\.isArray\(S\.spec\?\.set\)/);
});

test('the bar: Draft › Make › Send on every jam, every fix listed, the status never cut to one line', () => {
  const sb = fn('stepBar');
  assert.match(sb, /const steps = media \|\| ch\.studio \? \['Draft', 'Make', 'Send'\] : \['Draft', 'Send'\]/);
  assert.ok(!/'Set up', 'Made'|'Final'\]/.test(sb), 'no other step names');
  assert.match(sb, /class="ship-fixes"/, 'more than one fix: each is listed');
  assert.match(css, /\.ship\.one \.ship-l\{white-space:normal;[^}]*-webkit-line-clamp:3/);
  assert.ok(!/Make the final \$\{what\}/.test(app), 'the make step says Make it');
});

test('the chat says the next step nowhere: the bar does; the case folds its why and plan', () => {
  const cb = fn('caseBrief');
  assert.ok(!/case-next/.test(cb)); assert.match(cb, /<details class="case-s case-why"/); assert.match(cb, /<details class="case-s case-plan"/);
  assert.match(app, /!\(m\.rewrite && \(ch\.versions \|\| \[\]\)\.length > 1\)/, 'the starting-point note goes once there is a newer version');
});

test('one version: a card with a jam opens on it, never the What should this card become list', () => {
  assert.match(app, /const lead = RX\.list\[0\]; if \(lead\?\.id\) \{ PRE_CH\.set\(lead\.id, lead\); return openStudio\(lead\.id/);
  assert.match(fn('backToOptions'), /return openStudio\(lead\.id, \{ deep: true, replace: true \}\)/);
});

test('words set into a draft picture are never printed over it again', () => {
  assert.match(app, /!\(p\.draft\?\.as === 'carousel' && \(p\.draft\.images \|\| \[\]\)\.includes\(img\)\)/);
  assert.match(app, /\(p\.draft && !p\.draft\.text && \(p\.draft\.images \|\| \[\]\)\.includes\(imgOf\(ch\)\)\)/, 'a reel’s hook over a draft picture');
});

test('QA 25 Oct: organic videos, pack offers, review replies, capital buttons and draft shapes', async () => {
  const { isAdVideo, cleanPkg } = await import('../studio.js'); const { recipeOfCard } = await import('../remix.js');
  assert.equal(isAdVideo({ title: 'Post a short family comedy video on YouTube', sub: 'Meta video ads cost too much' }), false, 'an organic YouTube post is never a Meta video ad');
  assert.equal(isAdVideo({ title: 'Use a warm comedy video', sub: 'Run it as Meta video ads' }), true);
  assert.equal(recipeOfCard({ title: 'Sell an exclusive ninety-day pack only on arata.in', cta: { label: 'Work on this' }, sector: 'catalog', agent: 'brew', type: 'idea' }).primary, 'storefront.bundle_offer');
  assert.equal(recipeOfCard({ title: 'Launch cold gifting email to US tech HR managers', agent: 'crm', sector: 'signals', cta: { label: 'Draft the email' } }).primary, 'crm.outreach_email');
  const rmx = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(rmx, /ch\.target\?\.object === 'Review reply'\) \{ if \(ch\.actionLabel !== 'Reply to reviews'\)/, 'a review reply is named for the reviews app, never YouTube');
  assert.match(rmx, /const capsBtn = new Set/, 'a saved button in capitals is never shouting copy');
  const p = cleanPkg ? cleanPkg('crm', 'crm.flow_copy', { message: 'Hi', buttons: ['SHOP NOW', 'View Pack of 3'] }) : null;
  if (p) assert.deepEqual(p.buttons, ['Shop now', 'View Pack of 3']);
  assert.match(app, /const drShape = /, 'a frame takes the shape of its draft pictures'); assert.match(app, /\(drShape \|\| p\.format \|\| '1:1'\)/);
  assert.match(fn('stWhere'), /comment reply\|replies\|reply\|post\|thread\|answer\|short video/, '"YouTube comment reply" is on YouTube');
});

test('a capital call to action on its own line is a button, inside a sentence it is shouting', async () => {
  const { copyFlags } = await import('../claims.js');
  assert.deepEqual(copyFlags('Swap real weekly routines.\n\nSHOP NOW', {}), []);
  assert.deepEqual(copyFlags('Get your Pack of 3 on arata.in. SHOP NOW.', {}), []);
  assert.ok(copyFlags('BUY NOW before it ends.', {}).length);
  assert.match(fs.readFileSync(new URL('../public/parts.css', import.meta.url), 'utf8'), /@container canvas \(max-width:640px\)\{\.ship\.one\{flex-wrap:nowrap\}/, 'a narrow stage stacks the bar in one column');
});

test('the plan’s copy of the first draft keeps its product, so Studio sets up the product the draft shows', () => {
  const cp = fs.readFileSync(new URL('../card-plan.js', import.meta.url), 'utf8');
  assert.match(cp, /copy: draft\.copy \|\| '', product: draft\.product \|\| null/);
  assert.match(fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8'), /const dp = ch\.pkg\?\.draft\?\.product \|\| \(ch\.v0 === 'draft' \? o\.planOf\?\.\(t, c\)\?\.draft\?\.product : null\)[^\n]*\n[^\n]*cardProduct\(c, cat0[^\n]*\n\s*const P = productFor\(c, FACTS, named \|\| !dp \? words : dp\)/);
});

test('the draft view keeps the product its pictures show', async () => {
  const { draftView } = await import('../drafts-bg.js');
  assert.equal(draftView({ as: 'carousel', kind: 'stories', slides: [{ image: 'gen/a.jpg' }], product: 'Anti-Hair Fall Intensive Shampoo', title: 'x' }).product, 'Anti-Hair Fall Intensive Shampoo');
});

test('a made piece that needs a look says what, on the bar', () => {
  assert.match(fn('stepBar'), /things to look at before you post it/); assert.match(fn('stepBar'), /`Needs a look: \$\{esc\(look\[0\]\)\}`/);
});

test('a made Studio piece: the stage is the piece, Details holds the checklist, the bar offers the full one, Set-up is Studio only', () => {
  assert.ok(!/publishPanel\(/.test(fn('studioStage')), 'no checklist under the piece');
  assert.match(fn('detailsTab'), /ch\.studio && ch\.publish\?\.made[^\n]*publishPanel\(ch, pkgCh\)/, 'Details opens on it');
  assert.match(app, /const lookOf = \(ch\) =>/); assert.match(fn('stepBar'), /lookOf\(ch\)/); assert.match(fn('publishPanel'), /lookOf\(ch\)/);
  assert.match(fn('stepBar'), /data-cs-full/, 'a preview’s next step is the full one'); assert.match(cs, /makeFull: \(\) => makeFull\(\)/);
  assert.ok(!/adjustTab0/.test(fn('adjustTab').split(':').slice(0, -1).join(':')), 'no v1 knobs on a Studio piece');
  assert.match(cs, /Your set · \$\{sl\.length\} slides/); assert.match(cs, /<small>Made with<\/small>/);
});

test('chat on a Studio piece: asks go to Studio made or not, the answer and a landed make stay in the thread, no slide-count chips', () => {
  assert.match(app, /path === 'iterate' && !body && ch\.studio && window\.CreativeStage\?\.state\(ch\.id\) && !window\.CreativeStage\.state\(ch\.id\)\.making/);
  assert.ok(!/!window\.CreativeStage\.state\(ch\.id\)\.made && !window\.CreativeStage/.test(app), 'a made piece’s asks go to Studio too');
  const routes = fs.readFileSync(new URL('../jam2/routes.js', import.meta.url), 'utf8'); assert.match(routes, /ch1\.thread\.push\(\{ from: 'you', text, at \}/);
  const rmx = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8'); assert.match(rmx, /text: `Made \$\{n\}/); assert.match(rmx, /The make didn’t go through/);
  assert.match(app, /const COUNT_CHIP = /); assert.ok(new RegExp(app.match(/const COUNT_CHIP = \/(.+)\/i;/)[1], 'i').test('Three stories'));
});

test('the stage presents a set: one slide big (arrows, dots, keys) or all, the pick shared with Set-up', () => {
  assert.match(app, /const stageFrames = \(\) =>/); assert.match(app, /stageFrames\(\); \/\* a set of slides/);
  assert.match(fn('stageFrames'), /data-stg-mode/); assert.match(fn('stageFrames'), /data-stg-go/); assert.match(fn('stageFrames'), /cs\?\.sel/);
  assert.match(cs, /select: \(i\) => \{ if \(S\) S\.sel = \+i \|\| 0; \}/); assert.match(cs, /sel: S\.sel \?\? 0/);
  assert.match(css, /\.std \.st-asset\[data-stg="one"\] \.as-swipe > figure:not\(\[data-on\]\)\{display:none\}/);
});
