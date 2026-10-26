// The jam page's sharing, brief, tabs and first paint (QV 26 Oct, docs/qv/jam.md): every link opens the exact jam on its brand's
// page, a tab's dot says what the bar says, the brief has one owner, one audience and the piece's own files in order, the maker
// reads the brand's real colours in words, and the header names the server's product from the first paint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jamPath, shareToken } from '../handoff.js';
import { createTeamBrief, ownerIn, realAudience, namesIn } from '../team-brief.js';
import { contextOf, colourName, kitColours } from '../jam2/context.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/* one of app.js's arrow functions, as a value (its body only reads what is passed in) */
const fnSrc = (name) => { const i = app.indexOf(`const ${name} = `); assert.ok(i >= 0, name); return app.slice(i + `const ${name} = `.length, app.indexOf('\n  const ', i + 10)).trim().replace(/;\s*(\/\*(?:(?!\*\/)[\s\S])*\*\/\s*)*$/, ''); };
const fnOf = (name, deps = {}) => new Function(...Object.keys(deps), `return (${fnSrc(name)});`)(...Object.values(deps));

test('P0-3: every share link carries the brand path and opens the jam itself', () => {
  const t = { id: 't_ab12', brandId: 'arata-in', cards: new Map([['m1007-1', {}]]), changes: { ch_1: { id: 'ch_1', cardId: 'm1007-1' } } };
  assert.match(jamPath(t, { id: 'wk_1', cardId: 'm1007-1', changeId: 'ch_1' }), /^\/arata-in#remix=m1007-1\/ch_1&s=t_ab12~wk_1~/);
  assert.match(app, /const brandPath = \(\) => \(LANDING \? '\/' : `\/\$\{encodeURIComponent\(BR\)\}`\)/);
  assert.match(fnSrc('linkFor'), /\$\{location\.origin\}\$\{brandPath\(\)\}\$\{hashOf\(p, w\)\}/, 'never `${origin}/#card=…`');
  assert.match(fnSrc('jamLink'), /\$\{location\.origin\}\$\{brandPath\(\)\}#remix=/);
  assert.doesNotMatch(app, /\$\{location\.origin\}\/\$\{hashOf/);
  assert.match(app, /if \(k === 'share'\) \{ paintStudio\(\); return copyJamLink\(RX\.p\); \}/, '⋯ → Share copies this jam\'s own link, not the card sheet');
  /* the share route names the page each link belongs on, for a guest, a teammate and someone who must sign in first */
  const fs0 = src('feed-service.js'); const route = fs0.slice(fs0.indexOf("const sm = u.pathname.match(/^\\/api\\/share"), fs0.indexOf('if (!/^\\/api\\/(tenants|cards'));
  assert.match(route, /const path = w \? jamPath\(t, w\)/); assert.equal((route.match(/\bpath[,} ]/g) || []).length >= 3, true);
  assert.match(route, /signin: true, jam: tok\.wid, path/); assert.match(route, /member: true, jam: w\.id, path/);
  /* the read-only brief's "Open in the studio" is the jam path too (it was /#remix=…) */
  assert.match(src('handoff.js'), /studio: pkg \? abs\(jamPath\(t, w, pkg\.id\), b\) : null/);
});

test('P0-3: a link opened on another path moves to the brand page; a teammate lands on the exact tab', () => {
  const sharePath = fnOf('sharePath');
  /* an old link made on the root, opened by anyone: it moves to /<brand>, onto the jam, the token kept so the brand page adopts it */
  assert.deepEqual(sharePath('/arata-in#remix=m1/ch_1&s=TOK', '/', '#card=m1&s=TOK'), { go: true, path: '/arata-in', hash: '#remix=m1/ch_1&s=TOK' });
  /* a link that names its tab keeps that tab */
  assert.deepEqual(sharePath('/arata-in#remix=m1/ch_1&s=TOK', '/', '#remix=m1/ch_9&s=TOK'), { go: true, path: '/arata-in', hash: '#remix=m1/ch_9&s=TOK' });
  /* already on the brand page: no move */
  assert.equal(sharePath('/arata-in#remix=m1/ch_1&s=TOK', '/arata-in', '#remix=m1/ch_1&s=TOK').go, false);
  /* an old token with no jam: the brand's page, the hash as it came */
  assert.deepEqual(sharePath('/nutrova-com', '/', '#card=c1&s=T2'), { go: true, path: '/nutrova-com', hash: '#card=c1&s=T2' });
  const as = app.slice(app.indexOf('const adoptShare = '), app.indexOf('// real connected accounts'));
  assert.match(as, /if \(at\.go\) \{ location\.replace\(at\.path \+ at\.hash\)/);
  assert.match(as, /r\.member && r\.jam\) \{ history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{at\.hash\.replace\(\/&s=\[\^&\]\*\/, ''\)/, 'a teammate: the jam\'s hash, no token, never #jam= on the landing page');
  assert.match(app, /\/\^#\(jam\|card\|work\|remix\)=\/\.test\(location\.hash\)\) \{ S\.onboarded = true; save\(\); \}/, 'a signed-in teammate on a jam link skips the setup steps');
  assert.ok(shareToken('t_1', 'wk_1').startsWith('t_1~wk_1~'));
});

test('P1-14: a tab\'s dot says what the bar says, never red over "Nothing is made or paid"', () => {
  const blockOf = fnOf('blockOf'), lookOf = fnOf('lookOf'), dlDot = fnOf('dlDot', { blockOf, lookOf });
  const base = { versions: [{ id: 'v1' }], head: 'v1', checks: [] };
  assert.equal(dlDot({ ...base, studio: 'image', checks: [{ k: 'price', ok: false }] }), 'todo', 'a Studio piece not made yet: the bar says nothing is made, so no red');
  assert.equal(dlDot({ ...base, copyPending: true }), 'writing');
  assert.equal(dlDot({ ...base, verdict: 'fix', fixes: ['x'] }), 'fix', 'the bar shows the fix line');
  assert.equal(dlDot({ ...base, checks: [{ k: 'withdrawn budget', ok: false }] }), 'fix', 'a block: the bar says it can\'t ship');
  assert.equal(dlDot({ ...base, checks: [{ k: 'claims', ok: false, fix: 'rewrite' }] }), 'ready', 'a check the bar doesn\'t show as red is not red');
  const made = { ...base, studio: 'image', versions: [{ id: 'v1', studio: { quality: 'standard' } }] };
  assert.equal(dlDot({ ...made, publish: { made: true, parts: [], checks: [{ t: 'Claims your store doesn’t make', ok: false }] } }), 'fix', 'a red check on a made piece: red, as the bar');
  assert.equal(dlDot({ ...made, publish: { made: true, parts: [], checks: [{ t: 'Headline over 40', ok: false, soft: true }] } }), 'ready', 'amber is advice, never a red dot');
  assert.match(app, /dot === 'todo' \? 'Not made yet'/);
});

test('P1-18/P1-19: the header and Brew\'s line name the server\'s product from the first paint, never an empty one', () => {
  const jpProduct = fnOf('jpProduct');
  assert.equal(jpProduct({ product: { name: 'Sleek Hair Styling Stick - 15 ml' } }, { productName: 'Anti-Hair Fall Intensive Shampoo - 200 ml' }), 'Sleek Hair Styling Stick - 15 ml', 'the server (jamProduct) wins over Studio\'s spec');
  assert.equal(jpProduct({ product: null }, null), '', 'before anything loads: nothing, never "of the ,"');
  assert.equal(jpProduct({ product: { name: ' , ' } }, { productName: 'De-Knot Conditioner' }), 'De-Knot Conditioner', 'a blank name never interpolates');
  assert.match(fnSrc('stSub'), /pr = jpProduct\(ch, st\)/); assert.match(app, /const pn = jpProduct\(ch, st\)\.split/);
  assert.doesNotMatch(app, /st\?\.productName \|\| ch\.product\?\.name/);
});

test('P1-16: the brief has one owner and one audience, the piece\'s own files in slide order, and stops rewriting itself on every open', async () => {
  assert.equal(ownerIn('Budget: none set. Owner: Param Jain. Starts Monday.', ''), 'Budget: none set.\nStarts Monday.\nOwner: to confirm.');
  assert.equal(ownerIn('To confirm.', 'Sai'), 'Budget and timing: to confirm.\nOwner: Sai.');
  assert.equal(realAudience('arata.in'), '', 'a site is where it runs, not who it is for'); assert.equal(realAudience('young men, 20 to 30'), 'young men, 20 to 30');
  let t0 = 1000, calls = 0;
  const X = { title: 'Stories', brand: 'Arata', memo: {}, card: { title: 'Launch Baal Ki Baat on Instagram', sub: 'Baal Ki Baat is the brand’s hair series', rows: [], why: [] }, page: {}, brief: { md: '', missing: [] }, questions: [],
    pkg: { id: 'ch1', version: 3, action: 'Instagram Stories', fields: [], assets: [{ kind: 'image', label: 'Slide 1', url: '/gen/aaaaaaaa1.png' }, { kind: 'image', label: 'Slide 2', url: '/gen/aaaaaaaa2.png' }, { kind: 'image', label: 'Slide 3', url: '/gen/aaaaaaaa3.png' },
      { kind: 'image', label: 'The card this came from', url: '/b/arata-in/serum.png', card: true }, { kind: 'image', label: 'Product photo (reference, keep the label exact)', url: '/b/arata-in/lane.png', card: true }] } };
  const TB = createTeamBrief({ isMock: () => true, now: () => t0, handoff: { build: async () => { calls++; return X; } } });
  const w = { id: 'w1', doc: { rev: 2, plan: { audience: 'arata.in' }, missing: ['Who owns it'] } };
  const { x } = await TB.build({}, w); const v = TB.view(w, x), sec = (k) => v.sections.find((s) => s.k === k).t;
  assert.deepEqual(v.creatives.map((c) => c.label), ['Slide 1', 'Slide 2', 'Slide 3'], 'slides in order; never the card\'s picture of another product');
  assert.match(sec('when'), /Owner: to confirm\./); assert.match(sec('open'), /Who owns it/, 'the same owner gap Before you post shows');
  assert.equal(sec('who'), 'To confirm.', 'never "arata.in" as the audience');
  assert.match(v.title, /Baal Ki Baat/, 'names kept on the offline title too');
  const before = w.teamBrief; t0 += 60e3; await TB.build({}, w); assert.equal(w.teamBrief, before, 'an offline brief is not written again on the next open');
  t0 += 20 * 60e3; await TB.build({}, w); assert.equal(w.teamBrief, before, 'tried again after 15 minutes; still offline, the brief stays as it was');
  w.doc.plan = { audience: 'Men 20–30 with hair fall', owner: 'Sai' }; await TB.build({}, w, { fresh: true });
  const v2 = TB.view(w, x); assert.equal(v2.sections.find((s) => s.k === 'who').t, 'Men 20–30 with hair fall'); assert.match(v2.sections.find((s) => s.k === 'when').t, /Owner: Sai\./);
  /* the remix package lists slide 1 first, as a slide (it came third, as "Creative, 9:16") */
  const rx = src('remix.js'); assert.match(rx, /slides\.forEach\(\(u, i\) => out\.push\(\{ kind: 'image', label: `Slide \$\{i \+ 1\}`, url: u \}\)\)/); assert.match(rx, /&& !slides\.includes\(p\.image\)\) out\.push\(/);
  assert.match(rx, /'The card this came from', url: u, card: true/);
  /* the stage doesn't POST the PDF again when this state's PDF is made */
  assert.match(fnSrc('tbWarm'), /if \(TBS\.brief\?\.pdf\?\.url\) \{ TBS\.pdf = TBS\.brief\.pdf;/);
});

test('P2-3: a brief title keeps the brand\'s own names', async () => {
  assert.deepEqual(namesIn(['Launch Baal Ki Baat on Instagram. Read it.']), ['Baal', 'Ki', 'Baat', 'Instagram']);
  const X = { title: 'x', brand: 'Arata', memo: {}, card: { title: 'Launch Baal Ki Baat hair education on Instagram', sub: 'Our Baal Ki Baat series', rows: [], why: [] }, page: {}, brief: { md: '' }, questions: [], pkg: { id: 'c', version: 1, fields: [], assets: [] } };
  const TB = createTeamBrief({ isMock: () => false, spend: () => true, now: () => 5, handoff: { build: async () => X },
    claudeTool: async () => ({ title: 'Launch Baal Ki Baat Hair Education On Instagram', what: 'a', why: 'b', who: 'c', creative: 'd', specs: 'e', rules: 'f', when: 'g', done: 'h', open: [], evidence: [] }) });
  const w = { id: 'w', doc: {} }; const { x } = await TB.build({}, w);
  assert.equal(TB.view(w, x).title, 'Launch Baal Ki Baat hair education on Instagram');
});

test('P1-17: the maker reads the brand\'s real colours in words, cleanly joined, or is told they are missing', () => {
  assert.equal(colourName('#0e7c7b'), 'deep teal'); assert.equal(colourName('#f4efe6'), 'off-white'); assert.equal(colourName('#82b1ff'), 'blue'); assert.equal(colourName('nope'), '');
  assert.deepEqual(kitColours({ kit: { colors: ['#82b1ff', '#3b82f6', '#0e7c7b'] } }), ['#0e7c7b'], 'a framework\'s stock blues are not the brand\'s');
  assert.deepEqual(kitColours({ kit: { colors: ['#3b82f6'], colorsBy: 'team' } }), ['#3b82f6'], 'the team chose it: it is theirs');
  assert.deepEqual(kitColours({ kit: { colors: ['#3b82f6'] }, src: { 'kit.colors': 'shopify' } }), ['#3b82f6'], 'the store\'s own settings');
  const d0 = { kind: 'image', style: 'in-use' }, ctx = (colors) => ({ card: { title: 'x' }, bbv: { kit: { colors, logo: 'l.png' }, never: ['Dermat-approved.', 'cure;'] }, product: { name: 'Sleek Hair Styling Stick', img: 'p.png' }, v1: { headline: 'Evening routine > morning wash.' } });
  const a = contextOf(ctx(['#82b1ff', '#3b82f6', '#343a40']), d0); const dir = a.slots.direction.value;
  assert.doesNotMatch(dir, /#[0-9a-f]{3,6}/i, 'never hex'); assert.match(dir, /No brand colours in the Brand Book yet/); assert.ok(a.missing.some((m) => /No brand colours/.test(m.text)));
  assert.doesNotMatch(dir, /\.;|”\.”|\.”\.|\.\./, `clean joins: ${dir}`); assert.match(dir, /Built around: “Evening routine > morning wash”\./); assert.match(dir, /Never: Dermat-approved; cure\./);
  const b = contextOf(ctx(['#0e7c7b', '#f4efe6']), d0); assert.match(b.slots.direction.value, /In the brand’s deep teal and off-white\./); assert.deepEqual(b.slots.brand.value.colors, ['#0e7c7b', '#f4efe6']);
  const set = contextOf(ctx(['#0e7c7b']), { kind: 'image', set: ['studio-white', 'in-use', 'flatlay'] }).slots.direction.value; assert.doesNotMatch(set, /\.;|;\s*[A-Z]/, `a set's looks end once each: ${set}`);
  assert.match(src('jam2/studio.js'), /const colours = kitColours\(ctx\.bbv \|\| \{\}\)/, 'the picture prompt reads the same colours');
});

test('P2-1, P2-2, P2-11: cuts end once, a fix\'s version is named for what it fixed, the switcher\'s count is the picker\'s', () => {
  const cutW = fnOf('cutW'); assert.equal(cutW('Built for the lab work. And then much more after that', 26), 'Built for the lab work…'); assert.equal(cutW('Harry Potter Jersey... in Meta Ads', 24), 'Harry Potter Jersey…');
  const vLabel = fnOf('vLabel');
  assert.equal(vLabel({ n: 3, reason: 'Fix this before it goes: Claims your store doesn’t make: “Dermat-approved” needs its proof.' }), 'Fixed: Claims your store…');
  assert.equal(vLabel({ n: 2, reason: 'Fix the headline before it goes: Headline over 40 characters.' }), 'Fixed: Headline over 40…');
  assert.equal(vLabel({ n: 2, reason: 'Make it warmer and shorter please' }), 'Make it warmer and…'); assert.equal(vLabel({ n: 1, reason: 'x' }), 'First draft');
  assert.match(fnSrc('jpSwPop'), /RX\.dl\.add\?\.length \? `Any of \$\{RX\.dl\.add\.length\}: search` : 'Search'/); assert.doesNotMatch(app, /\|\| 228\}/);
});

test('P2-16: on a phone the header keeps the piece, its product and its version', () => {
  const css = fs.readFileSync(new URL('../public/jam-page.css', import.meta.url), 'utf8'), i = css.indexOf('QV P2-16'), blk = css.slice(i, css.indexOf('\n}', i));
  assert.ok(i > 0); assert.match(blk, /\.jp \.jp-ttl > span > em\{display:block/); assert.match(blk, /\.jp \.jp-hd \.jp-ver\{display:inline-flex\}/); assert.match(blk, /flex-wrap:wrap/);
});
